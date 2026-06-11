import { createServer } from 'node:http';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { join, normalize, resolve } from 'node:path';
import { requireConfig } from './config';
import { resolveSiteName } from './deploy';
import { bold, contentType, cyan, dim, fail } from './util';

export async function dev(dirArg: string | undefined, flags: Record<string, string | boolean>) {
  const config = requireConfig();
  const dir = resolve(dirArg ?? '.');
  if (!existsSync(dir)) fail(`${dir} does not exist`);
  const site = resolveSiteName(dir, typeof flags.name === 'string' ? flags.name : undefined);
  const port = Number(flags.port) || 4400;
  const remoteBase = `${config.platformUrl}/${site}`;

  const sdkSource = await fetch(`${remoteBase}/__quick.js`).then(
    (r) => (r.ok ? r.text() : null),
    () => null,
  );
  if (!sdkSource) fail(`could not fetch the SDK from ${remoteBase}/__quick.js – run oquick deploy once first`);

  const server = createServer((req, res) => {
    const url = new URL(req.url ?? '/', `http://localhost:${port}`);
    let pathname = decodeURIComponent(url.pathname);

    if (pathname === '/__quick.js') {
      res.writeHead(200, { 'content-type': 'application/javascript;charset=utf-8' });
      res.end(`window.__QUICK_BASE__ = ${JSON.stringify(remoteBase)};\n${sdkSource}`);
      return;
    }

    if (pathname.endsWith('/')) pathname += 'index.html';
    const candidates = [pathname, `${pathname}/index.html`];
    for (const candidate of candidates) {
      const file = join(dir, normalize(candidate).replace(/^([/\\])+/, ''));
      if (!file.startsWith(dir)) break;
      if (existsSync(file) && statSync(file).isFile()) {
        res.writeHead(200, { 'content-type': contentType(file), 'cache-control': 'no-store' });
        res.end(readFileSync(file));
        return;
      }
    }
    res.writeHead(404, { 'content-type': 'text/plain' });
    res.end('not found');
  });

  server.listen(port, () => {
    console.log(`${bold('oquick dev')} serving ${dir}`);
    console.log(`  local:   ${bold(cyan(`http://localhost:${port}/`))}`);
    console.log(`  backend: ${dim(`${remoteBase}/__api (deployed worker – db/ai/ws are real)`)}`);
  });
}
