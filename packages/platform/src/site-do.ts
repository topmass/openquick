import { DurableObject } from 'cloudflare:workers';
import { assetCandidates } from './routing';
import { limitsFromEnv, MAX_DO_FILE, MAX_R2_FILE, SPILL_THRESHOLD, type Env } from './env';

const CHUNK_SIZE = 1_500_000; // well under the 2 MB SQLite per-value limit
export const MAX_FILE_BYTES = MAX_DO_FILE;
const DEFAULT_SITE_QUOTA = 1024 * 1024 * 1024; // 1 GiB
const MAX_FILES_PER_SITE = 2000;
const STAGED_TTL_MS = 60 * 60 * 1000;
const MAX_SUBS = 16;
const MAX_CHANNELS = 8;
const WS_WINDOW_MS = 10_000;
const WS_WINDOW_MAX = 200;

interface ManifestEntry {
  path: string;
  hash: string;
  size: number;
  ct: string;
  storage?: 'do' | 'r2';
}

interface Attachment {
  cid: string;
  ip: string;
  n: string | null;
  subs: string[];
  chans: string[];
}

const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json' } });
const err = (status: number, message: string) => json({ error: message }, status);

export class SiteDO extends DurableObject<Env> {
  private sql: SqlStorage;
  private wsBuckets = new Map<string, { count: number; start: number }>();

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    this.sql = ctx.storage.sql;
    this.initSchema();
    ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair('ping', 'pong'));
  }

  private initSchema() {
    this.sql.exec(`
      CREATE TABLE IF NOT EXISTS meta(key TEXT PRIMARY KEY, value TEXT);
      CREATE TABLE IF NOT EXISTS assets(path TEXT PRIMARY KEY, hash TEXT NOT NULL, size INTEGER NOT NULL, content_type TEXT NOT NULL, storage TEXT NOT NULL DEFAULT 'do');
      CREATE TABLE IF NOT EXISTS asset_chunks(hash TEXT NOT NULL, idx INTEGER NOT NULL, data BLOB NOT NULL, PRIMARY KEY(hash, idx));
      CREATE TABLE IF NOT EXISTS staged_manifest(upload_id TEXT PRIMARY KEY, manifest TEXT NOT NULL, created_at INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS staged_chunks(upload_id TEXT NOT NULL, hash TEXT NOT NULL, idx INTEGER NOT NULL, data BLOB NOT NULL, PRIMARY KEY(upload_id, hash, idx));
      CREATE TABLE IF NOT EXISTS documents(collection TEXT NOT NULL, id TEXT NOT NULL, json TEXT NOT NULL, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL, PRIMARY KEY(collection, id));
      CREATE TABLE IF NOT EXISTS uploads(id TEXT PRIMARY KEY, name TEXT NOT NULL, content_type TEXT NOT NULL, size INTEGER NOT NULL, created_at INTEGER NOT NULL, storage TEXT NOT NULL DEFAULT 'do');
      CREATE TABLE IF NOT EXISTS upload_chunks(id TEXT NOT NULL, idx INTEGER NOT NULL, data BLOB NOT NULL, PRIMARY KEY(id, idx));
      CREATE TABLE IF NOT EXISTS counters(key TEXT PRIMARY KEY, day TEXT NOT NULL, count INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS sites(name TEXT PRIMARY KEY, bytes INTEGER NOT NULL, files INTEGER NOT NULL, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL);
    `);
    // Older deployments created these tables without the storage column.
    for (const table of ['assets', 'uploads']) {
      try {
        this.sql.exec(`ALTER TABLE ${table} ADD COLUMN storage TEXT NOT NULL DEFAULT 'do'`);
      } catch {
        /* column already exists */
      }
    }
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const path = url.pathname;
    const method = request.method;

    try {
      if (path === '/ws') return this.handleWebSocket(request);
      if (path === '/asset') return this.handleAsset(request, url);
      if (path === '/deploy/start' && method === 'POST') return this.deployStart(request);
      if (path === '/deploy/file' && method === 'PUT') return this.deployFile(request, url);
      if (path === '/deploy/pending') return this.deployPending(url);
      if (path === '/deploy/commit' && method === 'POST') return this.deployCommit(request);
      if (path === '/upload/register' && method === 'POST') return this.registerUpload(request);
      if (path === '/destroy' && method === 'POST') return this.destroy();
      if (path === '/usage') return this.usage();
      if (path.startsWith('/db/')) return this.handleDb(request, url);
      if (path === '/upload' && method === 'POST') return this.handleUpload(request, url);
      if (path.startsWith('/upload/')) return this.serveUpload(path.slice('/upload/'.length));
      if (path === '/limit' && method === 'POST') return this.handleLimit(request);
      if (path === '/registry/upsert' && method === 'POST') return this.registryUpsert(request);
      if (path === '/registry/remove' && method === 'POST') return this.registryRemove(request);
      if (path === '/registry/list') return this.registryList();
      return err(404, 'not found');
    } catch (e) {
      return err(500, e instanceof Error ? e.message : 'internal error');
    }
  }

  // ---------- static assets ----------

  private handleAsset(request: Request, url: URL): Response {
    const sitePath = url.searchParams.get('path') ?? '/';
    const inm = request.headers.get('if-none-match');

    for (const key of assetCandidates(sitePath)) {
      const row = this.sql
        .exec('SELECT hash, size, content_type, storage FROM assets WHERE path = ?', key)
        .toArray()[0] as
        | { hash: string; size: number; content_type: string; storage: string }
        | undefined;
      if (!row) continue;
      const etag = `"${row.hash}"`;
      if (inm === etag) return new Response(null, { status: 304, headers: { etag } });
      if (row.storage === 'r2') {
        // Body lives in the shared bucket – hand the worker a marker to stream it.
        return new Response(null, {
          status: 200,
          headers: { 'content-type': row.content_type, etag, 'x-oq-r2': row.hash },
        });
      }
      return new Response(this.readChunks('asset_chunks', 'hash', row.hash, row.size), {
        status: 200,
        headers: { 'content-type': row.content_type, etag },
      });
    }

    const notFound = this.sql
      .exec('SELECT hash, size, content_type FROM assets WHERE path = ?', '404.html')
      .toArray()[0] as { hash: string; size: number; content_type: string } | undefined;
    if (notFound) {
      return new Response(this.readChunks('asset_chunks', 'hash', notFound.hash, notFound.size), {
        status: 404,
        headers: { 'content-type': notFound.content_type },
      });
    }
    const empty = this.sql.exec('SELECT COUNT(*) AS c FROM assets').one().c as number;
    return err(404, empty === 0 ? 'site has no files yet' : 'file not found');
  }

  private readChunks(table: string, keyCol: string, key: string, size: number): Uint8Array {
    const out = new Uint8Array(size);
    let offset = 0;
    for (const row of this.sql.exec(
      `SELECT data FROM ${table} WHERE ${keyCol} = ? ORDER BY idx`,
      key,
    )) {
      const data = new Uint8Array(row.data as ArrayBuffer);
      out.set(data, offset);
      offset += data.length;
    }
    return out.subarray(0, offset);
  }

  private writeChunks(table: string, keyVals: (string | number)[], bytes: Uint8Array) {
    for (let idx = 0; idx * CHUNK_SIZE < bytes.length || idx === 0; idx++) {
      const slice = bytes.slice(idx * CHUNK_SIZE, (idx + 1) * CHUNK_SIZE);
      this.sql.exec(
        `INSERT OR REPLACE INTO ${table} VALUES (${keyVals.map(() => '?').join(',')}, ?, ?)`,
        ...keyVals,
        idx,
        slice.buffer,
      );
      if ((idx + 1) * CHUNK_SIZE >= bytes.length) break;
    }
  }

  // ---------- deploys ----------

  private async deployStart(request: Request): Promise<Response> {
    const body = (await request.json()) as { manifest: ManifestEntry[]; r2Available?: boolean };
    const manifest = body.manifest;
    const r2 = !!body.r2Available;
    if (!Array.isArray(manifest)) return err(400, 'manifest required');
    if (manifest.length > MAX_FILES_PER_SITE) return err(400, `too many files (max ${MAX_FILES_PER_SITE})`);

    let total = 0;
    for (const f of manifest) {
      if (typeof f.path !== 'string' || f.path.length > 512 || f.path.includes('..') || f.path.startsWith('/')) {
        return err(400, `bad path: ${f.path}`);
      }
      if (!/^[0-9a-f]{64}$/.test(f.hash)) return err(400, `bad hash for ${f.path}`);
      if (!Number.isInteger(f.size) || f.size < 0) return err(400, `bad size for ${f.path}`);
      const max = r2 ? MAX_R2_FILE : MAX_DO_FILE;
      if (f.size > max) {
        return err(
          400,
          r2
            ? `file too large: ${f.path} (max ${MAX_R2_FILE} bytes)`
            : `file too large: ${f.path} (max ${MAX_DO_FILE} bytes without R2 – enable R2 on the Cloudflare account and re-run oquick setup for files up to ${MAX_R2_FILE} bytes)`,
        );
      }
      f.storage = r2 && f.size > SPILL_THRESHOLD ? 'r2' : 'do';
      total += f.size;
    }
    const quota = Number(this.env.SITE_QUOTA_BYTES) || DEFAULT_SITE_QUOTA;
    if (total > quota) return err(400, `site exceeds quota (${quota} bytes)`);

    this.sql.exec('DELETE FROM staged_manifest WHERE created_at < ?', Date.now() - STAGED_TTL_MS);
    this.sql.exec(
      'DELETE FROM staged_chunks WHERE upload_id NOT IN (SELECT upload_id FROM staged_manifest)',
    );

    const have = this.existingAssetKeys();
    const needed = manifest.filter((f) => !have.has(`${f.storage}:${f.hash}`) && f.size > 0);

    const uploadId = crypto.randomUUID();
    this.sql.exec(
      'INSERT INTO staged_manifest VALUES (?, ?, ?)',
      uploadId,
      JSON.stringify(manifest),
      Date.now(),
    );
    return json({
      uploadId,
      needed: needed.map((f) => ({ path: f.path, hash: f.hash, storage: f.storage, ct: f.ct })),
    });
  }

  /** Set of "storage:hash" pairs already present in the live asset table. */
  private existingAssetKeys(): Set<string> {
    return new Set(
      this.sql
        .exec('SELECT DISTINCT storage, hash FROM assets')
        .toArray()
        .map((r) => `${r.storage}:${r.hash}`),
    );
  }

  private deployPending(url: URL): Response {
    const uploadId = url.searchParams.get('uploadId') ?? '';
    const row = this.sql
      .exec('SELECT manifest FROM staged_manifest WHERE upload_id = ?', uploadId)
      .toArray()[0];
    if (!row) return err(404, 'unknown uploadId');
    const manifest = JSON.parse(row.manifest as string) as ManifestEntry[];
    const have = this.existingAssetKeys();
    const r2New = manifest.filter((f) => f.storage === 'r2' && !have.has(`r2:${f.hash}`));
    return json({ r2: [...new Set(r2New.map((f) => f.hash))] });
  }

  private async deployFile(request: Request, url: URL): Promise<Response> {
    const uploadId = url.searchParams.get('uploadId') ?? '';
    const hash = url.searchParams.get('hash') ?? '';
    const exists = this.sql
      .exec('SELECT 1 FROM staged_manifest WHERE upload_id = ?', uploadId)
      .toArray().length;
    if (!exists) return err(404, 'unknown uploadId (deploy may have expired, retry)');

    const bytes = new Uint8Array(await request.arrayBuffer());
    if (bytes.length > MAX_FILE_BYTES) return err(400, 'file too large');
    this.sql.exec('DELETE FROM staged_chunks WHERE upload_id = ? AND hash = ?', uploadId, hash);
    this.writeChunks('staged_chunks', [uploadId, hash], bytes);
    return json({ ok: true });
  }

  private async deployCommit(request: Request): Promise<Response> {
    const { uploadId, r2Verified = [] } = (await request.json()) as {
      uploadId: string;
      r2Verified?: string[];
    };
    const row = this.sql
      .exec('SELECT manifest FROM staged_manifest WHERE upload_id = ?', uploadId)
      .toArray()[0];
    if (!row) return err(404, 'unknown uploadId');
    const manifest = JSON.parse(row.manifest as string) as ManifestEntry[];

    const have = this.existingAssetKeys();
    const staged = new Set(
      this.sql
        .exec('SELECT DISTINCT hash FROM staged_chunks WHERE upload_id = ?', uploadId)
        .toArray()
        .map((r) => r.hash as string),
    );
    const verified = new Set(r2Verified);
    const missing = manifest.filter((f) => {
      if (f.size === 0 || have.has(`${f.storage}:${f.hash}`)) return false;
      return f.storage === 'r2' ? !verified.has(f.hash) : !staged.has(f.hash);
    });
    if (missing.length) {
      return err(400, `missing uploads: ${missing.map((f) => f.path).join(', ')}`);
    }

    this.ctx.storage.transactionSync(() => {
      this.sql.exec('DELETE FROM assets');
      for (const f of manifest) {
        this.sql.exec(
          'INSERT OR REPLACE INTO assets (path, hash, size, content_type, storage) VALUES (?, ?, ?, ?, ?)',
          f.path,
          f.hash,
          f.size,
          f.ct,
          f.storage ?? 'do',
        );
        if (f.size === 0) {
          this.sql.exec('INSERT OR REPLACE INTO asset_chunks VALUES (?, 0, ?)', f.hash, new ArrayBuffer(0));
        }
      }
      this.sql.exec(
        `INSERT OR IGNORE INTO asset_chunks SELECT hash, idx, data FROM staged_chunks WHERE upload_id = ?`,
        uploadId,
      );
      this.sql.exec(
        "DELETE FROM asset_chunks WHERE hash NOT IN (SELECT DISTINCT hash FROM assets WHERE storage = 'do')",
      );
      this.sql.exec('DELETE FROM staged_chunks WHERE upload_id = ?', uploadId);
      this.sql.exec('DELETE FROM staged_manifest WHERE upload_id = ?', uploadId);
      this.sql.exec(
        "INSERT OR REPLACE INTO meta VALUES ('updated_at', ?)",
        String(Date.now()),
      );
    });

    const bytes = manifest.reduce((a, f) => a + f.size, 0);
    const r2Hashes = [...new Set(manifest.filter((f) => f.storage === 'r2').map((f) => f.hash))];
    return json({ files: manifest.length, bytes, r2Hashes });
  }

  private async destroy(): Promise<Response> {
    for (const ws of this.ctx.getWebSockets()) {
      try {
        ws.close(1001, 'site deleted');
      } catch {
        /* already closed */
      }
    }
    await this.ctx.storage.deleteAll();
    this.initSchema();
    return json({ ok: true });
  }

  private usage(): Response {
    const a = this.sql.exec('SELECT COUNT(*) AS files, COALESCE(SUM(size),0) AS bytes FROM assets').one();
    const u = this.sql.exec('SELECT COUNT(*) AS n, COALESCE(SUM(size),0) AS bytes FROM uploads').one();
    const d = this.sql.exec('SELECT COUNT(*) AS n FROM documents').one();
    return json({
      files: a.files,
      bytes: (a.bytes as number) + (u.bytes as number),
      uploads: u.n,
      documents: d.n,
    });
  }

  // ---------- database ----------

  private async handleDb(request: Request, url: URL): Promise<Response> {
    const parts = url.pathname.slice('/db/'.length).split('/');
    const collection = decodeURIComponent(parts[0] ?? '');
    const id = parts[1] ? decodeURIComponent(parts[1]) : null;
    if (!collection || collection.length > 128) return err(400, 'bad collection name');
    const ip = request.headers.get('x-oq-ip') ?? 'unknown';
    const method = request.method;

    if (method === 'GET' && id) {
      const row = this.docRow(collection, id);
      return row ? json(this.docOut(row)) : err(404, 'not found');
    }

    if (method === 'GET') {
      const limit = Math.min(Number(url.searchParams.get('limit')) || 100, 1000);
      const offset = Number(url.searchParams.get('offset')) || 0;
      const order = url.searchParams.get('order') === 'desc' ? 'DESC' : 'ASC';
      let where = 'collection = ?';
      const params: (string | number)[] = [collection];
      const filterRaw = url.searchParams.get('filter');
      if (filterRaw) {
        let filter: Record<string, unknown>;
        try {
          filter = JSON.parse(filterRaw);
        } catch {
          return err(400, 'filter must be JSON');
        }
        for (const [k, v] of Object.entries(filter).slice(0, 8)) {
          where += ` AND json_extract(json, '$.' || ?) = ?`;
          params.push(k, typeof v === 'boolean' ? Number(v) : (v as string | number));
        }
      }
      const rows = this.sql
        .exec(
          `SELECT id, json, created_at, updated_at FROM documents WHERE ${where} ORDER BY created_at ${order}, id ${order} LIMIT ? OFFSET ?`,
          ...params,
          limit,
          offset,
        )
        .toArray();
      return json({ docs: rows.map((r) => this.docOut(r)) });
    }

    if (!(await this.allow('db_write', ip))) return err(429, 'daily write limit reached');

    if (method === 'POST') {
      const body = await this.readDoc(request);
      if (body instanceof Response) return body;
      const docId = typeof body.id === 'string' && body.id.length <= 128 ? body.id : crypto.randomUUID();
      delete body.id;
      const exists = this.docRow(collection, docId);
      if (exists) return err(409, `document ${docId} already exists`);
      const now = Date.now();
      this.sql.exec(
        'INSERT INTO documents VALUES (?, ?, ?, ?, ?)',
        collection,
        docId,
        JSON.stringify(body),
        now,
        now,
      );
      const doc = { id: docId, createdAt: now, updatedAt: now, ...body };
      this.broadcastDb(collection, 'create', { doc });
      return json(doc, 201);
    }

    if (method === 'PATCH' && id) {
      const body = await this.readDoc(request);
      if (body instanceof Response) return body;
      const row = this.docRow(collection, id);
      if (!row) return err(404, 'not found');
      delete body.id;
      const merged = { ...JSON.parse(row.json as string), ...body };
      const now = Date.now();
      this.sql.exec(
        'UPDATE documents SET json = ?, updated_at = ? WHERE collection = ? AND id = ?',
        JSON.stringify(merged),
        now,
        collection,
        id,
      );
      const doc = { id, createdAt: row.created_at as number, updatedAt: now, ...merged };
      this.broadcastDb(collection, 'update', { doc });
      return json(doc);
    }

    if (method === 'DELETE' && id) {
      const res = this.sql.exec('DELETE FROM documents WHERE collection = ? AND id = ?', collection, id);
      if (res.rowsWritten === 0) return err(404, 'not found');
      this.broadcastDb(collection, 'delete', { id });
      return json({ ok: true });
    }

    return err(405, 'method not allowed');
  }

  private docRow(collection: string, id: string) {
    return this.sql
      .exec('SELECT id, json, created_at, updated_at FROM documents WHERE collection = ? AND id = ?', collection, id)
      .toArray()[0];
  }

  private docOut(row: Record<string, unknown>) {
    return {
      id: row.id,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      ...JSON.parse(row.json as string),
    };
  }

  private async readDoc(request: Request): Promise<Record<string, unknown> | Response> {
    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return err(400, 'body must be JSON');
    }
    if (typeof body !== 'object' || body === null || Array.isArray(body)) {
      return err(400, 'document must be a JSON object');
    }
    const text = JSON.stringify(body);
    if (text.length > 256 * 1024) return err(400, 'document too large (max 256KB)');
    return body as Record<string, unknown>;
  }

  // ---------- file uploads ----------

  private async handleUpload(request: Request, url: URL): Promise<Response> {
    const ip = request.headers.get('x-oq-ip') ?? 'unknown';
    if (!(await this.allow('upload', ip))) return err(429, 'daily upload limit reached');
    const name = (url.searchParams.get('name') || 'file').slice(0, 128).replace(/[/\\]/g, '_');
    const ct = request.headers.get('content-type') || 'application/octet-stream';
    const bytes = new Uint8Array(await request.arrayBuffer());
    if (bytes.length === 0) return err(400, 'empty file');
    if (bytes.length > MAX_FILE_BYTES) return err(400, `file too large (max ${MAX_FILE_BYTES} bytes)`);
    const id = crypto.randomUUID();
    this.sql.exec(
      "INSERT INTO uploads (id, name, content_type, size, created_at, storage) VALUES (?, ?, ?, ?, ?, 'do')",
      id,
      name,
      ct,
      bytes.length,
      Date.now(),
    );
    this.writeChunks('upload_chunks', [id], bytes);
    return json({ id, name, size: bytes.length, type: ct }, 201);
  }

  /** Records metadata for an upload whose body the worker streamed to R2. */
  private async registerUpload(request: Request): Promise<Response> {
    const { id, name, ct, size, ip } = (await request.json()) as {
      id: string;
      name: string;
      ct: string;
      size: number;
      ip: string;
    };
    if (!(await this.allow('upload', ip))) return err(429, 'daily upload limit reached');
    this.sql.exec(
      "INSERT INTO uploads (id, name, content_type, size, created_at, storage) VALUES (?, ?, ?, ?, ?, 'r2')",
      id,
      name.slice(0, 128).replace(/[/\\]/g, '_'),
      ct,
      size,
      Date.now(),
    );
    return json({ id, name, size, type: ct }, 201);
  }

  private serveUpload(id: string): Response {
    const uploadId = id.split('/')[0];
    const row = this.sql
      .exec('SELECT name, content_type, size, storage FROM uploads WHERE id = ?', uploadId)
      .toArray()[0] as
      | { name: string; content_type: string; size: number; storage: string }
      | undefined;
    if (!row) return err(404, 'not found');
    if (row.storage === 'r2') {
      return new Response(null, {
        status: 200,
        headers: { 'content-type': row.content_type, 'x-oq-r2': uploadId, 'x-oq-immutable': '1' },
      });
    }
    return new Response(this.readChunks('upload_chunks', 'id', uploadId, row.size), {
      headers: { 'content-type': row.content_type, 'x-oq-immutable': '1' },
    });
  }

  // ---------- rate limiting ----------

  private async handleLimit(request: Request): Promise<Response> {
    const { kind, ip } = (await request.json()) as { kind: string; ip: string };
    return (await this.allow(kind, ip)) ? json({ ok: true }) : err(429, 'rate limit reached');
  }

  private async allow(kind: string, ip: string): Promise<boolean> {
    const limits = limitsFromEnv(this.env);
    const day = new Date().toISOString().slice(0, 10);
    const bump = (key: string, max: number | undefined): boolean => {
      if (!max) return true;
      const row = this.sql.exec('SELECT day, count FROM counters WHERE key = ?', key).toArray()[0];
      const count = row && row.day === day ? (row.count as number) : 0;
      if (count >= max) return false;
      this.sql.exec('INSERT OR REPLACE INTO counters VALUES (?, ?, ?)', key, day, count + 1);
      return true;
    };
    if (!bump(`${kind}|ip|${ip}`, limits[`${kind}_ip`])) return false;
    if (!bump(`${kind}|site`, limits[`${kind}_site`])) return false;
    return true;
  }

  // ---------- websockets: db subscriptions + channels ----------

  private handleWebSocket(request: Request): Response {
    if (request.headers.get('upgrade')?.toLowerCase() !== 'websocket') {
      return err(426, 'expected websocket');
    }
    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair) as [WebSocket, WebSocket];
    this.ctx.acceptWebSocket(server);
    const att: Attachment = {
      cid: crypto.randomUUID().slice(0, 8),
      ip: request.headers.get('x-oq-ip') ?? 'unknown',
      n: null,
      subs: [],
      chans: [],
    };
    server.serializeAttachment(att);
    server.send(JSON.stringify({ t: 'hello', cid: att.cid }));
    return new Response(null, { status: 101, webSocket: client });
  }

  async webSocketMessage(ws: WebSocket, message: string | ArrayBuffer) {
    if (typeof message !== 'string' || message.length > 64 * 1024) return;
    const att = ws.deserializeAttachment() as Attachment;

    const bucket = this.wsBuckets.get(att.cid) ?? { count: 0, start: Date.now() };
    if (Date.now() - bucket.start > WS_WINDOW_MS) {
      bucket.count = 0;
      bucket.start = Date.now();
    }
    if (++bucket.count > WS_WINDOW_MAX) return;
    this.wsBuckets.set(att.cid, bucket);

    let msg: { t: string; col?: string; ch?: string; name?: string; data?: unknown };
    try {
      msg = JSON.parse(message);
    } catch {
      return;
    }
    const send = (data: unknown) => {
      try {
        ws.send(JSON.stringify(data));
      } catch {
        /* socket gone */
      }
    };

    switch (msg.t) {
      case 'sub': {
        if (typeof msg.col !== 'string') return;
        if (!att.subs.includes(msg.col)) {
          if (att.subs.length >= MAX_SUBS) return send({ t: 'err', msg: `max ${MAX_SUBS} subscriptions` });
          att.subs.push(msg.col);
          ws.serializeAttachment(att);
        }
        return;
      }
      case 'unsub': {
        att.subs = att.subs.filter((c) => c !== msg.col);
        ws.serializeAttachment(att);
        return;
      }
      case 'name': {
        att.n = String(msg.name ?? '').slice(0, 32) || null;
        ws.serializeAttachment(att);
        return;
      }
      case 'join': {
        if (typeof msg.ch !== 'string' || msg.ch.length > 64) return;
        if (!att.chans.includes(msg.ch)) {
          if (att.chans.length >= MAX_CHANNELS) return send({ t: 'err', msg: `max ${MAX_CHANNELS} channels` });
          att.chans.push(msg.ch);
          if (msg.name) att.n = String(msg.name).slice(0, 32);
          ws.serializeAttachment(att);
        }
        const members = this.channelMembers(msg.ch);
        send({ t: 'presence', ch: msg.ch, ev: 'you', who: { cid: att.cid, name: att.n }, members });
        this.broadcastChannel(msg.ch, { t: 'presence', ch: msg.ch, ev: 'join', who: { cid: att.cid, name: att.n }, members }, att.cid);
        return;
      }
      case 'leave': {
        if (typeof msg.ch !== 'string') return;
        att.chans = att.chans.filter((c) => c !== msg.ch);
        ws.serializeAttachment(att);
        const members = this.channelMembers(msg.ch);
        this.broadcastChannel(msg.ch, { t: 'presence', ch: msg.ch, ev: 'leave', who: { cid: att.cid, name: att.n }, members }, att.cid);
        return;
      }
      case 'pub': {
        if (typeof msg.ch !== 'string' || !att.chans.includes(msg.ch)) return;
        this.broadcastChannel(
          msg.ch,
          { t: 'msg', ch: msg.ch, from: { cid: att.cid, name: att.n }, data: msg.data },
          att.cid,
        );
        return;
      }
    }
  }

  async webSocketClose(ws: WebSocket) {
    const att = ws.deserializeAttachment() as Attachment | null;
    if (!att) return;
    for (const ch of att.chans) {
      this.broadcastChannel(
        ch,
        { t: 'presence', ch, ev: 'leave', who: { cid: att.cid, name: att.n }, members: this.channelMembers(ch, att.cid) },
        att.cid,
      );
    }
    this.wsBuckets.delete(att.cid);
  }

  private channelMembers(ch: string, excludeCid?: string) {
    const members: { cid: string; name: string | null }[] = [];
    for (const ws of this.ctx.getWebSockets()) {
      const att = ws.deserializeAttachment() as Attachment | null;
      if (att && att.chans.includes(ch) && att.cid !== excludeCid) {
        members.push({ cid: att.cid, name: att.n });
      }
    }
    return members;
  }

  private broadcastChannel(ch: string, data: unknown, excludeCid?: string) {
    const text = JSON.stringify(data);
    for (const ws of this.ctx.getWebSockets()) {
      const att = ws.deserializeAttachment() as Attachment | null;
      if (att && att.chans.includes(ch) && att.cid !== excludeCid) {
        try {
          ws.send(text);
        } catch {
          /* socket gone */
        }
      }
    }
  }

  private broadcastDb(collection: string, ev: string, payload: Record<string, unknown>) {
    const text = JSON.stringify({ t: 'db', col: collection, ev, ...payload });
    for (const ws of this.ctx.getWebSockets()) {
      const att = ws.deserializeAttachment() as Attachment | null;
      if (att && att.subs.includes(collection)) {
        try {
          ws.send(text);
        } catch {
          /* socket gone */
        }
      }
    }
  }

  // ---------- registry (used only by the reserved __registry__ instance) ----------

  private async registryUpsert(request: Request): Promise<Response> {
    const { site, bytes, files } = (await request.json()) as { site: string; bytes: number; files: number };
    const now = Date.now();
    const existing = this.sql.exec('SELECT created_at FROM sites WHERE name = ?', site).toArray()[0];
    this.sql.exec(
      'INSERT OR REPLACE INTO sites VALUES (?, ?, ?, ?, ?)',
      site,
      bytes,
      files,
      existing ? (existing.created_at as number) : now,
      now,
    );
    return json({ ok: true });
  }

  private async registryRemove(request: Request): Promise<Response> {
    const { site } = (await request.json()) as { site: string };
    this.sql.exec('DELETE FROM sites WHERE name = ?', site);
    return json({ ok: true });
  }

  private registryList(): Response {
    const sites = this.sql
      .exec('SELECT name, bytes, files, created_at, updated_at FROM sites ORDER BY updated_at DESC')
      .toArray();
    return json({ sites });
  }
}
