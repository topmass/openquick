import { parseHostConfig, resolveTarget, isValidSiteName, type Target } from './routing';
import { SiteDO } from './site-do';
import {
  MAX_R2_FILE,
  SPILL_THRESHOLD,
  r2SiteKey,
  r2UploadKey,
  resolveModel,
  type Env,
} from './env';
import { isMultipartModel } from './models';
import { SDK_SOURCE } from './generated/sdk';
import { landingPage } from './landing';

export { SiteDO };

const VERSION = '0.1.0';
const REGISTRY = '__registry__';

const json = (data: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json', ...headers },
  });
const err = (status: number, message: string, headers: Record<string, string> = {}) =>
  json({ error: message }, status, headers);

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const cfg = parseHostConfig(env.PATH_HOSTS, env.WILDCARD_BASES);
    const target = resolveTarget(request.headers.get('host') ?? url.host, url.pathname, cfg);

    try {
      const denied = await accessGate(request, env, cfg);
      if (denied) return denied;
      switch (target.kind) {
        case 'platform':
          return await handlePlatform(request, env, target.path, url);
        case 'site':
          return await handleSite(request, env, target, url);
        case 'redirect':
          return Response.redirect(new URL(target.location, url).toString(), 301);
        case 'invalid-site':
          return err(404, `"${target.site}" is not a valid site name`);
        case 'unknown-host':
          return err(404, 'host not configured for openquick');
      }
    } catch (e) {
      return err(500, e instanceof Error ? e.message : 'internal error');
    }
  },
};

function siteStub(env: Env, site: string) {
  return env.SITE.get(env.SITE.idFromName(site));
}

function forward(request: Request, doPath: string, extraHeaders: Record<string, string> = {}) {
  const fwd = new Request(`https://do${doPath}`, request);
  fwd.headers.set('x-oq-ip', request.headers.get('cf-connecting-ip') ?? 'unknown');
  for (const [k, v] of Object.entries(extraHeaders)) fwd.headers.set(k, v);
  return fwd;
}

// ---------- platform routes (landing page + token-gated deploy API) ----------

async function handlePlatform(request: Request, env: Env, path: string, url: URL): Promise<Response> {
  if (path === '/' && request.method === 'GET') {
    if (env.HUB_DISABLED === '1') {
      return json({ ok: true, hub: false, hint: 'this OpenQuick serves sites only – deploy with the oquick CLI' });
    }
    return new Response(landingPage(), {
      headers: { 'content-type': 'text/html;charset=utf-8', 'cache-control': 'no-cache' },
    });
  }
  if (path === '/__platform/health') {
    return json({
      ok: true,
      version: VERSION,
      tokenConfigured: !!env.DEPLOY_TOKEN,
      access: env.REQUIRE_ACCESS === '1',
      email: env.REQUIRE_ACCESS === '1' ? (await verifyAccessJwt(request, env))?.email ?? null : null,
    });
  }
  if (path === '/__platform/list' && request.method === 'GET') {
    const res = await siteStub(env, REGISTRY).fetch('https://do/registry/list');
    return new Response(res.body, { status: res.status, headers: { 'content-type': 'application/json' } });
  }

  const denied = await checkToken(request, env);
  if (denied) return denied;

  if (path === '/__platform/deploy/start' && request.method === 'POST') {
    const body = (await request.json()) as { site?: string; manifest?: unknown };
    if (!body.site || !isValidSiteName(body.site)) return err(400, 'invalid site name');
    const res = await siteStub(env, body.site).fetch('https://do/deploy/start', {
      method: 'POST',
      body: JSON.stringify({ manifest: body.manifest, r2Available: !!env.FILES }),
    });
    return res;
  }

  if (path === '/__platform/deploy/file' && (request.method === 'PUT' || request.method === 'POST')) {
    const site = url.searchParams.get('site') ?? '';
    if (!isValidSiteName(site)) return err(400, 'invalid site name');
    const hash = url.searchParams.get('hash') ?? '';
    if (url.searchParams.get('storage') === 'r2') {
      if (!env.FILES) return err(400, 'R2 is not configured on this platform');
      await env.FILES.put(r2SiteKey(site, hash), request.body, {
        httpMetadata: { contentType: url.searchParams.get('ct') || 'application/octet-stream' },
      });
      return json({ ok: true });
    }
    const doUrl = `https://do/deploy/file?uploadId=${encodeURIComponent(
      url.searchParams.get('uploadId') ?? '',
    )}&hash=${encodeURIComponent(hash)}`;
    return siteStub(env, site).fetch(doUrl, { method: 'PUT', body: request.body });
  }

  if (path === '/__platform/deploy/commit' && request.method === 'POST') {
    const body = (await request.json()) as { site?: string; uploadId?: string };
    if (!body.site || !isValidSiteName(body.site)) return err(400, 'invalid site name');
    const stub = siteStub(env, body.site);

    // Confirm any R2-bound files actually landed before committing the manifest.
    let r2Verified: string[] = [];
    if (env.FILES) {
      const pending = await stub.fetch(
        `https://do/deploy/pending?uploadId=${encodeURIComponent(body.uploadId ?? '')}`,
      );
      if (!pending.ok) return pending;
      const { r2 } = (await pending.json()) as { r2: string[] };
      for (const hash of r2) {
        if (await env.FILES.head(r2SiteKey(body.site, hash))) r2Verified.push(hash);
      }
    }

    const res = await stub.fetch('https://do/deploy/commit', {
      method: 'POST',
      body: JSON.stringify({ uploadId: body.uploadId, r2Verified }),
    });
    if (!res.ok) return res;
    const { files, bytes, r2Hashes } = (await res.json()) as {
      files: number;
      bytes: number;
      r2Hashes: string[];
    };
    await siteStub(env, REGISTRY).fetch('https://do/registry/upsert', {
      method: 'POST',
      body: JSON.stringify({ site: body.site, files, bytes }),
    });
    await gcR2Assets(env, body.site, new Set(r2Hashes));
    return json({ site: body.site, files, bytes, urls: siteUrls(env, body.site, url.host) });
  }

  if (path === '/__platform/delete' && request.method === 'POST') {
    const body = (await request.json()) as { site?: string };
    if (!body.site || !isValidSiteName(body.site)) return err(400, 'invalid site name');
    await siteStub(env, body.site).fetch('https://do/destroy', { method: 'POST' });
    await siteStub(env, REGISTRY).fetch('https://do/registry/remove', {
      method: 'POST',
      body: JSON.stringify({ site: body.site }),
    });
    await deleteR2Prefix(env, `sites/${body.site}/`);
    await deleteR2Prefix(env, `uploads/${body.site}/`);
    return json({ ok: true });
  }

  return err(404, 'unknown platform route');
}

async function checkToken(request: Request, env: Env): Promise<Response | null> {
  if (!env.DEPLOY_TOKEN) return err(503, 'DEPLOY_TOKEN secret is not configured on the worker');
  if (hasValidToken(request, env)) return null;
  // Org mode: an Access-authenticated user is a trusted deployer – no token needed.
  if (env.REQUIRE_ACCESS === '1' && (await verifyAccessJwt(request, env))) return null;
  return err(401, 'invalid deploy token');
}

function hasValidToken(request: Request, env: Env): boolean {
  if (!env.DEPLOY_TOKEN) return false;
  const auth = request.headers.get('authorization') ?? '';
  const given = auth.startsWith('Bearer ') ? auth.slice(7) : '';
  return timingSafeEqual(given, env.DEPLOY_TOKEN);
}

/**
 * Org mode (REQUIRE_ACCESS=1): every request must carry a Cloudflare Access JWT
 * – sites, APIs, websockets and the hub alike, exactly like Quick behind IAP.
 * CLI deploys keep working anywhere via the bearer token.
 */
async function accessGate(
  request: Request,
  env: Env,
  cfg: ReturnType<typeof parseHostConfig>,
): Promise<Response | null> {
  if (env.REQUIRE_ACCESS !== '1') return null;
  if (hasValidToken(request, env)) return null;
  if (await verifyAccessJwt(request, env)) return null;
  const home = cfg.pathHosts[0] ? `https://${cfg.pathHosts[0]}/` : null;
  if ((request.headers.get('accept') ?? '').includes('text/html')) {
    return new Response(
      `<!doctype html><meta charset="utf-8"><title>Protected</title>
<body style="font-family:system-ui;max-width:30rem;margin:20vh auto;text-align:center">
<h1>🔒</h1><p>This OpenQuick is protected by Cloudflare Access.</p>
${home ? `<p>Sign in at <a href="${home}">${home}</a></p>` : '<p>Visit it through its protected domain to sign in.</p>'}
</body>`,
      { status: 403, headers: { 'content-type': 'text/html;charset=utf-8' } },
    );
  }
  return err(403, 'protected by Cloudflare Access – authenticate through the protected domain');
}

function timingSafeEqual(a: string, b: string): boolean {
  const enc = new TextEncoder();
  const ab = enc.encode(a);
  const bb = enc.encode(b);
  if (ab.length !== bb.length) return false;
  let diff = 0;
  for (let i = 0; i < ab.length; i++) diff |= ab[i] ^ bb[i];
  return diff === 0;
}

async function deleteR2Prefix(env: Env, prefix: string) {
  if (!env.FILES) return;
  let cursor: string | undefined;
  do {
    const listing = await env.FILES.list({ prefix, cursor, limit: 1000 });
    if (listing.objects.length) await env.FILES.delete(listing.objects.map((o) => o.key));
    cursor = listing.truncated ? listing.cursor : undefined;
  } while (cursor);
}

/** Remove R2 objects for a site that the freshly committed manifest no longer references. */
async function gcR2Assets(env: Env, site: string, liveHashes: Set<string>) {
  if (!env.FILES) return;
  let cursor: string | undefined;
  do {
    const listing = await env.FILES.list({ prefix: `sites/${site}/`, cursor, limit: 1000 });
    const stale = listing.objects.filter((o) => !liveHashes.has(o.key.split('/').pop() ?? '')).map((o) => o.key);
    if (stale.length) await env.FILES.delete(stale);
    cursor = listing.truncated ? listing.cursor : undefined;
  } while (cursor);
}

/** Stream an R2 object honoring a simple single-range request (video seeking etc.). */
async function serveR2(
  env: Env,
  key: string,
  request: Request,
  baseHeaders: Record<string, string>,
): Promise<Response> {
  if (!env.FILES) return err(500, 'R2 is not configured on this platform');
  const rangeHeader = request.headers.get('range');
  const match = rangeHeader?.match(/^bytes=(\d*)-(\d*)$/);

  if (match && (match[1] || match[2])) {
    const head = await env.FILES.head(key);
    if (!head) return err(404, 'file not found');
    const size = head.size;
    const start = match[1] ? Number(match[1]) : size - Number(match[2]);
    const end = match[1] && match[2] ? Math.min(Number(match[2]), size - 1) : size - 1;
    if (start < 0 || start > end) {
      return new Response(null, { status: 416, headers: { 'content-range': `bytes */${size}` } });
    }
    const obj = await env.FILES.get(key, { range: { offset: start, length: end - start + 1 } });
    if (!obj) return err(404, 'file not found');
    return new Response(obj.body, {
      status: 206,
      headers: {
        ...baseHeaders,
        'accept-ranges': 'bytes',
        'content-range': `bytes ${start}-${end}/${size}`,
        'content-length': String(end - start + 1),
      },
    });
  }

  const obj = await env.FILES.get(key);
  if (!obj) return err(404, 'file not found');
  return new Response(request.method === 'HEAD' ? null : obj.body, {
    status: 200,
    headers: { ...baseHeaders, 'accept-ranges': 'bytes', 'content-length': String(obj.size) },
  });
}

function siteUrls(env: Env, site: string, requestHost: string): string[] {
  const cfg = parseHostConfig(env.PATH_HOSTS, env.WILDCARD_BASES);
  const urls = new Set<string>();
  if (requestHost.endsWith('.workers.dev')) urls.add(`https://${requestHost}/${site}/`);
  for (const h of cfg.pathHosts) urls.add(`https://${h}/${site}/`);
  for (const b of cfg.wildcardBases) urls.add(`https://${site}.${b}/`);
  return [...urls];
}

// ---------- site routes (static assets + zero-config browser API) ----------

type SiteTarget = Extract<Target, { kind: 'site' }>;

async function handleSite(request: Request, env: Env, target: SiteTarget, url: URL): Promise<Response> {
  const { site, sitePath } = target;

  if (sitePath === '/__quick.js') {
    return new Response(SDK_SOURCE, {
      headers: {
        'content-type': 'application/javascript;charset=utf-8',
        'cache-control': 'no-cache',
        'access-control-allow-origin': '*',
      },
    });
  }

  if (sitePath.startsWith('/__api/') || sitePath === '/__api') {
    return handleApi(request, env, target, url);
  }

  if (sitePath.startsWith('/__files/')) {
    const id = sitePath.slice('/__files/'.length);
    const res = await siteStub(env, site).fetch(`https://do/upload/${id}`);
    if (!res.ok) return res;
    const base = {
      'content-type': res.headers.get('content-type') ?? 'application/octet-stream',
      'cache-control': 'public, max-age=31536000, immutable',
      'access-control-allow-origin': '*',
    };
    const r2Id = res.headers.get('x-oq-r2');
    if (r2Id) return serveR2(env, r2UploadKey(site, r2Id), request, base);
    const headers = new Headers(res.headers);
    headers.set('cache-control', base['cache-control']);
    headers.set('access-control-allow-origin', '*');
    headers.delete('x-oq-immutable');
    return new Response(res.body, { status: res.status, headers });
  }

  if (request.method !== 'GET' && request.method !== 'HEAD') return err(405, 'method not allowed');
  const res = await siteStub(env, site).fetch(
    forward(request, `/asset?path=${encodeURIComponent(sitePath)}`, {}),
  );
  const r2Hash = res.headers.get('x-oq-r2');
  if (res.ok && r2Hash) {
    return serveR2(env, r2SiteKey(site, r2Hash), request, {
      'content-type': res.headers.get('content-type') ?? 'application/octet-stream',
      etag: res.headers.get('etag') ?? '',
      'cache-control': 'no-cache',
      'access-control-allow-origin': '*',
    });
  }
  const headers = new Headers(res.headers);
  headers.set('cache-control', 'no-cache');
  headers.set('access-control-allow-origin', '*');
  if (request.method === 'HEAD') return new Response(null, { status: res.status, headers });
  return new Response(res.body, { status: res.status, headers });
}

async function handleApi(request: Request, env: Env, target: SiteTarget, url: URL): Promise<Response> {
  const { site, sitePath } = target;
  const cors = corsFor(request);
  if (cors === 'forbidden') return err(403, 'cross-origin calls are not allowed');
  if (request.method === 'OPTIONS') {
    return new Response(null, {
      status: 204,
      headers: {
        ...cors,
        'access-control-allow-methods': 'GET,POST,PATCH,DELETE,OPTIONS',
        'access-control-allow-headers': 'content-type',
        'access-control-max-age': '86400',
      },
    });
  }

  const api = sitePath.slice('/__api'.length) || '/';

  if (api === '/ws') {
    if (request.headers.get('upgrade')?.toLowerCase() !== 'websocket') {
      return err(426, 'expected websocket upgrade');
    }
    return siteStub(env, site).fetch(forward(request, '/ws'));
  }

  if (api.startsWith('/db/')) {
    const res = await siteStub(env, site).fetch(forward(request, api));
    return withCors(res, cors);
  }

  if (api === '/files' && request.method === 'POST') {
    const name = url.searchParams.get('name') ?? 'file';
    const length = Number(request.headers.get('content-length') || 0);

    // Big uploads stream straight to R2; the DO only records the metadata.
    if (env.FILES && length > SPILL_THRESHOLD) {
      if (length > MAX_R2_FILE) return err(400, `file too large (max ${MAX_R2_FILE} bytes)`, cors);
      const id = crypto.randomUUID();
      const ct = request.headers.get('content-type') || 'application/octet-stream';
      await env.FILES.put(r2UploadKey(site, id), request.body, { httpMetadata: { contentType: ct } });
      const res = await siteStub(env, site).fetch('https://do/upload/register', {
        method: 'POST',
        body: JSON.stringify({
          id,
          name,
          ct,
          size: length,
          ip: request.headers.get('cf-connecting-ip') ?? 'unknown',
        }),
      });
      if (!res.ok) {
        await env.FILES.delete(r2UploadKey(site, id));
        return withCors(res, cors);
      }
      const meta = (await res.json()) as { id: string; name: string; size: number; type: string };
      const fileUrl = `${target.base}/__files/${meta.id}/${encodeURIComponent(meta.name)}`;
      return json({ ...meta, url: fileUrl }, 201, cors);
    }

    const res = await siteStub(env, site).fetch(
      forward(request, `/upload?name=${encodeURIComponent(name)}`, {}),
    );
    if (!res.ok) return withCors(res, cors);
    const meta = (await res.json()) as { id: string; name: string; size: number; type: string };
    const fileUrl = `${target.base}/__files/${meta.id}/${encodeURIComponent(meta.name)}`;
    return json({ ...meta, url: fileUrl }, 201, cors);
  }

  if (api === '/ai/chat' && request.method === 'POST') {
    return handleAiChat(request, env, site, cors);
  }
  if (api === '/ai/image' && request.method === 'POST') {
    return handleAiImage(request, env, site, cors);
  }

  if (api === '/identity' && request.method === 'GET') {
    return json(await identity(request, env), 200, cors);
  }

  return err(404, 'unknown api route', cors);
}

function corsFor(request: Request): Record<string, string> | 'forbidden' {
  const origin = request.headers.get('origin');
  if (!origin) return {};
  let parsed: URL;
  try {
    parsed = new URL(origin);
  } catch {
    return 'forbidden';
  }
  const reqHost = (request.headers.get('host') ?? '').toLowerCase();
  if (parsed.host.toLowerCase() === reqHost) return {};
  if (['localhost', '127.0.0.1', '[::1]'].includes(parsed.hostname)) {
    return { 'access-control-allow-origin': origin, vary: 'origin' };
  }
  return 'forbidden';
}

function withCors(res: Response, cors: Record<string, string>): Response {
  if (!Object.keys(cors).length) return res;
  const headers = new Headers(res.headers);
  for (const [k, v] of Object.entries(cors)) headers.set(k, v);
  return new Response(res.body, { status: res.status, headers });
}

// ---------- AI (the account's Workers AI binding – keys never leave the server) ----------

async function aiAllowed(env: Env, site: string, request: Request, kind: string): Promise<Response | null> {
  const ip = request.headers.get('cf-connecting-ip') ?? 'unknown';
  const res = await siteStub(env, site).fetch('https://do/limit', {
    method: 'POST',
    body: JSON.stringify({ kind, ip }),
  });
  if (res.status === 429) return err(429, 'AI rate limit reached for today');
  // Account-wide ceiling across all sites (counted in the registry instance).
  const platform = await siteStub(env, REGISTRY).fetch('https://do/limit', {
    method: 'POST',
    body: JSON.stringify({ kind: `${kind}_platform`, ip: '-' }),
  });
  if (platform.status === 429) return err(429, 'this platform reached its AI budget for today');
  return null;
}

/** Workers AI response shapes vary by model family – normalize to plain text. */
function extractText(result: unknown): string {
  const r = result as Record<string, unknown> & {
    response?: string;
    output_text?: string;
    output?: { type?: string; content?: { type?: string; text?: string }[] }[];
    choices?: { message?: { content?: string } }[];
  };
  if (typeof r?.response === 'string' && r.response) return r.response;
  if (typeof r?.output_text === 'string' && r.output_text) return r.output_text;
  if (Array.isArray(r?.output)) {
    const parts: string[] = [];
    for (const item of r.output) {
      if (item?.type === 'message' && Array.isArray(item.content)) {
        for (const c of item.content) {
          if (typeof c?.text === 'string' && c.type !== 'reasoning_text') parts.push(c.text);
        }
      }
    }
    if (parts.length) return parts.join('');
  }
  const cc = r?.choices?.[0]?.message?.content;
  if (typeof cc === 'string' && cc) return cc;
  return '';
}

async function handleAiChat(request: Request, env: Env, site: string, cors: Record<string, string>): Promise<Response> {
  const limited = await aiAllowed(env, site, request, 'ai_chat');
  if (limited) return withCors(limited, cors);
  const body = (await request.json()) as {
    messages?: { role: string; content: string }[];
    prompt?: string;
    system?: string;
    model?: string;
    stream?: boolean;
  };
  let messages = body.messages;
  if (!messages && typeof body.prompt === 'string') {
    messages = [{ role: 'user', content: body.prompt }];
  }
  if (!Array.isArray(messages) || messages.length === 0) return err(400, 'messages or prompt required', cors);
  if (body.system) messages = [{ role: 'system', content: body.system }, ...messages];
  const model = resolveModel(env, body.model, 'chat');

  try {
    if (body.stream) {
      const stream = (await env.AI.run(model as keyof AiModels, { messages, stream: true } as never)) as ReadableStream;
      return new Response(stream, {
        headers: { 'content-type': 'text/event-stream', ...cors },
      });
    }
    const result = (await env.AI.run(model as keyof AiModels, { messages } as never)) as {
      usage?: unknown;
    };
    const content = extractText(result).trim();
    // Unknown shape: hand the raw result over so site code can still use it.
    return json(
      { content, usage: result.usage ?? null, model, ...(content ? {} : { raw: result }) },
      200,
      cors,
    );
  } catch (e) {
    return err(502, `AI error: ${e instanceof Error ? e.message : 'unknown'}`, cors);
  }
}

async function handleAiImage(request: Request, env: Env, site: string, cors: Record<string, string>): Promise<Response> {
  const limited = await aiAllowed(env, site, request, 'ai_image');
  if (limited) return withCors(limited, cors);
  const body = (await request.json()) as {
    prompt?: string;
    model?: string;
    width?: number;
    height?: number;
  };
  if (!body.prompt) return err(400, 'prompt required', cors);
  const model = resolveModel(env, body.model, 'image');
  const clamp = (n: unknown, fallback: number) =>
    Math.min(1024, Math.max(256, Math.round((Number(n) || fallback) / 32) * 32));
  try {
    let input: Record<string, unknown>;
    if (isMultipartModel(model)) {
      // flux-2 family takes multipart form input instead of a JSON prompt.
      const form = new FormData();
      form.append('prompt', body.prompt);
      form.append('width', String(clamp(body.width, 1024)));
      form.append('height', String(clamp(body.height, 1024)));
      const formResponse = new Response(form);
      input = {
        multipart: {
          body: formResponse.body,
          contentType: formResponse.headers.get('content-type'),
        },
      };
    } else {
      input = { prompt: body.prompt };
    }
    const result = (await env.AI.run(model as keyof AiModels, input as never)) as
      | { image?: string }
      | ReadableStream;
    if (result instanceof ReadableStream) {
      return new Response(result, { headers: { 'content-type': 'image/jpeg', ...cors } });
    }
    if (!result.image) return err(502, 'model returned no image', cors);
    const bytes = Uint8Array.from(atob(result.image), (c) => c.charCodeAt(0));
    const type = bytes[0] === 0xff && bytes[1] === 0xd8 ? 'image/jpeg' : 'image/png';
    return new Response(bytes, { headers: { 'content-type': type, ...cors } });
  } catch (e) {
    return err(502, `AI error: ${e instanceof Error ? e.message : 'unknown'}`, cors);
  }
}

// ---------- identity (real when behind Cloudflare Access, anonymous otherwise) ----------

const jwksCache = new Map<string, ReturnType<typeof import('jose').createRemoteJWKSet>>();

/** Validate the Cloudflare Access JWT, if present and Access is configured. */
async function verifyAccessJwt(request: Request, env: Env): Promise<{ email?: string } | null> {
  if (!env.ACCESS_TEAM_DOMAIN || !env.ACCESS_AUD) return null;
  const token = request.headers.get('cf-access-jwt-assertion');
  if (!token) return null;
  try {
    const { createRemoteJWKSet, jwtVerify } = await import('jose');
    let jwks = jwksCache.get(env.ACCESS_TEAM_DOMAIN);
    if (!jwks) {
      jwks = createRemoteJWKSet(
        new URL(`https://${env.ACCESS_TEAM_DOMAIN}.cloudflareaccess.com/cdn-cgi/access/certs`),
      );
      jwksCache.set(env.ACCESS_TEAM_DOMAIN, jwks);
    }
    const { payload } = await jwtVerify(token, jwks, { audience: env.ACCESS_AUD });
    return { email: typeof payload.email === 'string' ? payload.email : undefined };
  } catch {
    return null;
  }
}

async function identity(request: Request, env: Env): Promise<{ email?: string }> {
  return (await verifyAccessJwt(request, env)) ?? {};
}
