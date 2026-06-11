import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { spawn } from 'node:child_process';
import { requireConfig } from './config';
import { UI_HTML } from './ui-html';
import { bold, cyan, dim } from './util';

function readBody(req: IncomingMessage): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on('data', (c: Buffer) => chunks.push(c));
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

export async function ui(flags: Record<string, string | boolean>) {
  const config = requireConfig();
  const port = Number(flags.port) || 4500;

  // The page never sees the deploy token – this local server adds it.
  const forward = async (path: string, init: RequestInit, res: ServerResponse) => {
    const upstream = await fetch(`${config.platformUrl}${path}`, {
      ...init,
      headers: { authorization: `Bearer ${config.token}`, ...(init.headers ?? {}) },
    });
    const body = Buffer.from(await upstream.arrayBuffer());
    res.writeHead(upstream.status, { 'content-type': 'application/json' });
    res.end(body);
  };

  const server = createServer(async (req, res) => {
    const url = new URL(req.url ?? '/', `http://127.0.0.1:${port}`);
    try {
      if (url.pathname === '/' && req.method === 'GET') {
        res.writeHead(200, { 'content-type': 'text/html;charset=utf-8' });
        res.end(UI_HTML);
        return;
      }
      if (url.pathname === '/api/info' && req.method === 'GET') {
        const list = await fetch(`${config.platformUrl}/__platform/list`).then(
          (r) => r.json() as Promise<{ sites: unknown[] }>,
          () => ({ sites: [] }),
        );
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ platformUrl: config.platformUrl, sites: list.sites ?? [] }));
        return;
      }
      if (url.pathname === '/api/deploy/start' && req.method === 'POST') {
        return forward('/__platform/deploy/start', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: await readBody(req),
        }, res);
      }
      if (url.pathname === '/api/deploy/file' && req.method === 'PUT') {
        return forward(`/__platform/deploy/file?${url.searchParams}`, {
          method: 'PUT',
          headers: { 'content-type': 'application/octet-stream' },
          body: new Uint8Array(await readBody(req)),
        }, res);
      }
      if (url.pathname === '/api/deploy/commit' && req.method === 'POST') {
        return forward('/__platform/deploy/commit', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: await readBody(req),
        }, res);
      }
      if (url.pathname === '/api/delete' && req.method === 'POST') {
        return forward('/__platform/delete', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: await readBody(req),
        }, res);
      }
      res.writeHead(404, { 'content-type': 'application/json' });
      res.end('{"error":"not found"}');
    } catch (e) {
      res.writeHead(500, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ error: e instanceof Error ? e.message : 'internal error' }));
    }
  });

  server.listen(port, '127.0.0.1', () => {
    const local = `http://localhost:${port}/`;
    console.log(`${bold('⚡ OpenQuick')} ${dim(config.platformUrl)}`);
    console.log(`  drag & drop deploys at ${bold(cyan(local))} ${dim('(ctrl-c to stop)')}`);
    if (!flags['no-open']) {
      const opener = process.platform === 'darwin' ? 'open' : 'xdg-open';
      spawn(opener, [local], { detached: true, stdio: 'ignore' }).unref();
    }
  });
}
