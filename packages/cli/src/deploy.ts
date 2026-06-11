import { createHash } from 'node:crypto';
import { existsSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { basename, join, relative, resolve } from 'node:path';
import { requireConfig, type Config } from './config';
import { bold, contentType, cyan, dim, fail, formatBytes, green, slugify, validSiteName } from './util';

const MAX_FILE_BYTES = 25 * 1024 * 1024;
const SKIP_DIRS = new Set(['.git', 'node_modules', '.wrangler']);

interface ManifestEntry {
  path: string;
  hash: string;
  size: number;
  ct: string;
  abs: string;
}

export function readSiteConfig(dir: string): { name?: string; exclude?: string[] } {
  const path = join(dir, 'oquick.json');
  if (!existsSync(path)) return {};
  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch {
    fail(`could not parse ${path}`);
  }
}

export function resolveSiteName(dir: string, flagName: string | undefined): string {
  const name = flagName ?? readSiteConfig(dir).name ?? slugify(basename(resolve(dir)));
  if (!validSiteName(name)) {
    fail(`"${name}" is not a valid site name (lowercase letters, digits, hyphens, max 63 chars)`);
  }
  return name;
}

function walk(dir: string, root: string, exclude: string[], out: ManifestEntry[]) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name.startsWith('.') || entry.name === 'oquick.json') continue;
    const abs = join(dir, entry.name);
    const rel = relative(root, abs).split('\\').join('/');
    if (exclude.some((p) => rel === p || rel.startsWith(`${p}/`))) continue;
    if (entry.isDirectory()) {
      if (!SKIP_DIRS.has(entry.name)) walk(abs, root, exclude, out);
      continue;
    }
    if (!entry.isFile()) continue;
    const size = statSync(abs).size;
    if (size > MAX_FILE_BYTES) {
      fail(`${rel} is ${formatBytes(size)} – the max file size is ${formatBytes(MAX_FILE_BYTES)}`);
    }
    const hash = createHash('sha256').update(readFileSync(abs)).digest('hex');
    out.push({ path: rel, hash, size, ct: contentType(rel), abs });
  }
}

async function api<T>(config: Config, path: string, init: RequestInit): Promise<T> {
  const res = await fetch(`${config.platformUrl}${path}`, {
    ...init,
    headers: { authorization: `Bearer ${config.token}`, ...(init.headers ?? {}) },
  });
  if (!res.ok) {
    let message = `HTTP ${res.status}`;
    try {
      message = ((await res.json()) as { error?: string }).error ?? message;
    } catch {
      /* not json */
    }
    if (res.status === 401) message += ` – your local token does not match the worker (re-run ${bold('oquick setup')})`;
    fail(`deploy failed: ${message}`);
  }
  return res.json() as Promise<T>;
}

export async function deploy(dirArg: string | undefined, flags: Record<string, string | boolean>) {
  const config = requireConfig();
  const dir = resolve(dirArg ?? '.');
  if (!existsSync(dir) || !statSync(dir).isDirectory()) fail(`${dir} is not a directory`);
  const siteConfig = readSiteConfig(dir);
  const site = resolveSiteName(dir, typeof flags.name === 'string' ? flags.name : undefined);

  const manifest: ManifestEntry[] = [];
  walk(dir, dir, siteConfig.exclude ?? [], manifest);
  if (!manifest.length) fail(`no files found in ${dir}`);
  const totalBytes = manifest.reduce((a, f) => a + f.size, 0);
  console.log(
    `Deploying ${bold(site)} ${dim(`(${manifest.length} files, ${formatBytes(totalBytes)})`)}…`,
  );

  const start = await api<{ uploadId: string; needed: { path: string; hash: string }[] }>(
    config,
    '/__platform/deploy/start',
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ site, manifest: manifest.map(({ abs: _abs, ...m }) => m) }),
    },
  );

  const byPath = new Map(manifest.map((m) => [m.path, m]));
  const queue = [...start.needed];
  const workers = Array.from({ length: Math.min(4, queue.length) }, async () => {
    for (;;) {
      const item = queue.shift();
      if (!item) return;
      const file = byPath.get(item.path);
      if (!file) fail(`server requested unknown path ${item.path}`);
      const params = new URLSearchParams({ site, uploadId: start.uploadId, hash: item.hash });
      await api(config, `/__platform/deploy/file?${params}`, {
        method: 'PUT',
        headers: { 'content-type': 'application/octet-stream' },
        body: new Uint8Array(readFileSync(file.abs)),
      });
      console.log(`  ${green('↑')} ${item.path} ${dim(formatBytes(file.size))}`);
    }
  });
  await Promise.all(workers);
  if (start.needed.length < manifest.length) {
    console.log(dim(`  ${manifest.length - start.needed.length} unchanged files skipped`));
  }

  const commit = await api<{ urls: string[] }>(config, '/__platform/deploy/commit', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ site, uploadId: start.uploadId }),
  });

  if (!siteConfig.name && !flags.name) {
    writeFileSync(join(dir, 'oquick.json'), JSON.stringify({ name: site }, null, 2) + '\n');
  }

  console.log(`\n${green('✔')} live at:`);
  for (const url of commit.urls) console.log(`  ${bold(cyan(url))}`);
}
