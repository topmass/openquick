import { parseHostConfig, resolveTarget, isValidSiteName, type Target } from './routing';
import { SiteDO, MAX_FILE_BYTES } from './site-do';
import { DEFAULT_CHAT_MODEL, DEFAULT_IMAGE_MODEL, type Env } from './env';
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
    return new Response(landingPage(url.host), {
      headers: { 'content-type': 'text/html;charset=utf-8' },
    });
  }
  if (path === '/__platform/health') {
    return json({ ok: true, version: VERSION, tokenConfigured: !!env.DEPLOY_TOKEN });
  }
  if (path === '/__platform/list' && request.method === 'GET') {
    const res = await siteStub(env, REGISTRY).fetch('https://do/registry/list');
    return new Response(res.body, { status: res.status, headers: { 'content-type': 'application/json' } });
  }

  const denied = checkToken(request, env);
  if (denied) return denied;

  if (path === '/__platform/deploy/start' && request.method === 'POST') {
    const body = (await request.json()) as { site?: string; manifest?: unknown };
    if (!body.site || !isValidSiteName(body.site)) return err(400, 'invalid site name');
    const res = await siteStub(env, body.site).fetch('https://do/deploy/start', {
      method: 'POST',
      body: JSON.stringify({ manifest: body.manifest }),
    });
    return res;
  }

  if (path === '/__platform/deploy/file' && (request.method === 'PUT' || request.method === 'POST')) {
    const site = url.searchParams.get('site') ?? '';
    if (!isValidSiteName(site)) return err(400, 'invalid site name');
    const doUrl = `https://do/deploy/file?uploadId=${encodeURIComponent(
      url.searchParams.get('uploadId') ?? '',
    )}&hash=${encodeURIComponent(url.searchParams.get('hash') ?? '')}`;
    return siteStub(env, site).fetch(doUrl, { method: 'PUT', body: request.body });
  }

  if (path === '/__platform/deploy/commit' && request.method === 'POST') {
    const body = (await request.json()) as { site?: string; uploadId?: string };
    if (!body.site || !isValidSiteName(body.site)) return err(400, 'invalid site name');
    const res = await siteStub(env, body.site).fetch('https://do/deploy/commit', {
      method: 'POST',
      body: JSON.stringify({ uploadId: body.uploadId }),
    });
    if (!res.ok) return res;
    const { files, bytes } = (await res.json()) as { files: number; bytes: number };
    await siteStub(env, REGISTRY).fetch('https://do/registry/upsert', {
      method: 'POST',
      body: JSON.stringify({ site: body.site, files, bytes }),
    });
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
    return json({ ok: true });
  }

  return err(404, 'unknown platform route');
}

function checkToken(request: Request, env: Env): Response | null {
  if (!env.DEPLOY_TOKEN) return err(503, 'DEPLOY_TOKEN secret is not configured on the worker');
  const auth = request.headers.get('authorization') ?? '';
  const given = auth.startsWith('Bearer ') ? auth.slice(7) : '';
  if (!timingSafeEqual(given, env.DEPLOY_TOKEN)) return err(401, 'invalid deploy token');
  return null;
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
    const headers = new Headers(res.headers);
    headers.set('cache-control', 'public, max-age=31536000, immutable');
    headers.set('access-control-allow-origin', '*');
    headers.delete('x-oq-immutable');
    return new Response(res.body, { status: res.status, headers });
  }

  if (request.method !== 'GET' && request.method !== 'HEAD') return err(405, 'method not allowed');
  const res = await siteStub(env, site).fetch(
    forward(request, `/asset?path=${encodeURIComponent(sitePath)}`, {}),
  );
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
  return null;
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
  const model = body.model || env.CHAT_MODEL || DEFAULT_CHAT_MODEL;

  try {
    if (body.stream) {
      const stream = (await env.AI.run(model as keyof AiModels, { messages, stream: true } as never)) as ReadableStream;
      return new Response(stream, {
        headers: { 'content-type': 'text/event-stream', ...cors },
      });
    }
    const result = (await env.AI.run(model as keyof AiModels, { messages } as never)) as {
      response?: string;
      usage?: unknown;
    };
    return json({ content: result.response ?? '', usage: result.usage ?? null, model }, 200, cors);
  } catch (e) {
    return err(502, `AI error: ${e instanceof Error ? e.message : 'unknown'}`, cors);
  }
}

async function handleAiImage(request: Request, env: Env, site: string, cors: Record<string, string>): Promise<Response> {
  const limited = await aiAllowed(env, site, request, 'ai_image');
  if (limited) return withCors(limited, cors);
  const body = (await request.json()) as { prompt?: string; model?: string };
  if (!body.prompt) return err(400, 'prompt required', cors);
  const model = body.model || env.IMAGE_MODEL || DEFAULT_IMAGE_MODEL;
  try {
    const result = (await env.AI.run(model as keyof AiModels, { prompt: body.prompt } as never)) as
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

async function identity(request: Request, env: Env): Promise<{ email?: string }> {
  if (!env.ACCESS_TEAM_DOMAIN || !env.ACCESS_AUD) return {};
  const token = request.headers.get('cf-access-jwt-assertion');
  if (!token) return {};
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
    return {};
  }
}

export { MAX_FILE_BYTES };
