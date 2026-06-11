import { createInterface } from 'node:readline/promises';

export const bold = (s: string) => `\x1b[1m${s}\x1b[0m`;
export const dim = (s: string) => `\x1b[2m${s}\x1b[0m`;
export const green = (s: string) => `\x1b[32m${s}\x1b[0m`;
export const red = (s: string) => `\x1b[31m${s}\x1b[0m`;
export const yellow = (s: string) => `\x1b[33m${s}\x1b[0m`;
export const cyan = (s: string) => `\x1b[36m${s}\x1b[0m`;

export function fail(message: string): never {
  console.error(`${red('✖')} ${message}`);
  process.exit(1);
}

export async function ask(question: string): Promise<string> {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const answer = await rl.question(question);
  rl.close();
  return answer.trim();
}

export async function confirm(question: string): Promise<boolean> {
  const answer = await ask(`${question} ${dim('[y/N]')} `);
  return /^y(es)?$/i.test(answer);
}

const SITE_NAME_RE = /^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$/;

export function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 63);
}

export function validSiteName(name: string): boolean {
  return SITE_NAME_RE.test(name) && !name.startsWith('__');
}

const MIME: Record<string, string> = {
  html: 'text/html;charset=utf-8',
  htm: 'text/html;charset=utf-8',
  css: 'text/css;charset=utf-8',
  js: 'application/javascript;charset=utf-8',
  mjs: 'application/javascript;charset=utf-8',
  json: 'application/json',
  txt: 'text/plain;charset=utf-8',
  md: 'text/markdown;charset=utf-8',
  xml: 'application/xml',
  svg: 'image/svg+xml',
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
  avif: 'image/avif',
  ico: 'image/x-icon',
  woff: 'font/woff',
  woff2: 'font/woff2',
  ttf: 'font/ttf',
  otf: 'font/otf',
  mp3: 'audio/mpeg',
  wav: 'audio/wav',
  ogg: 'audio/ogg',
  mp4: 'video/mp4',
  webm: 'video/webm',
  pdf: 'application/pdf',
  wasm: 'application/wasm',
  map: 'application/json',
  // Source/config files serve as plain text so they render in the browser
  // (nothing executes server-side – OpenQuick sites are static + quick.js).
  py: 'text/plain;charset=utf-8',
  rb: 'text/plain;charset=utf-8',
  sh: 'text/plain;charset=utf-8',
  ts: 'text/plain;charset=utf-8',
  tsx: 'text/plain;charset=utf-8',
  jsx: 'text/plain;charset=utf-8',
  yaml: 'text/plain;charset=utf-8',
  yml: 'text/plain;charset=utf-8',
  toml: 'text/plain;charset=utf-8',
  ini: 'text/plain;charset=utf-8',
  csv: 'text/csv;charset=utf-8',
};

export function contentType(path: string): string {
  const ext = path.split('.').pop()?.toLowerCase() ?? '';
  return MIME[ext] ?? 'application/octet-stream';
}

export function formatBytes(n: number): string {
  if (n >= 1048576) return `${(n / 1048576).toFixed(1)} MB`;
  if (n >= 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${n} B`;
}
