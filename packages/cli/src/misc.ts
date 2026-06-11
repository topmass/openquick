import { spawn } from 'node:child_process';
import { requireConfig } from './config';
import { bold, confirm, cyan, dim, fail, formatBytes, green } from './util';

interface SiteRow {
  name: string;
  bytes: number;
  files: number;
  updated_at: number;
}

export async function list() {
  const config = requireConfig();
  const res = await fetch(`${config.platformUrl}/__platform/list`, {
    headers: { authorization: `Bearer ${config.token}` },
  });
  if (!res.ok) fail(`could not list sites (HTTP ${res.status})`);
  const { sites } = (await res.json()) as { sites: SiteRow[] };
  if (!sites.length) {
    console.log(`no sites yet – try ${bold('oquick init mysite')}`);
    return;
  }
  const width = Math.max(...sites.map((s) => s.name.length), 4);
  console.log(`${bold('site'.padEnd(width))}  ${bold('files')}  ${bold('size'.padEnd(9))}  ${bold('updated')}`);
  for (const s of sites) {
    console.log(
      `${s.name.padEnd(width)}  ${String(s.files).padStart(5)}  ${formatBytes(s.bytes).padEnd(9)}  ${dim(
        new Date(s.updated_at).toLocaleString(),
      )}`,
    );
  }
  console.log(dim(`\n${config.platformUrl}/<site>/`));
}

export async function deleteSite(site: string | undefined, flags: Record<string, string | boolean>) {
  const config = requireConfig();
  if (!site) fail('usage: oquick delete <site>');
  if (!flags.yes && !(await confirm(`Delete ${bold(site)} and all of its data?`))) return;
  const res = await fetch(`${config.platformUrl}/__platform/delete`, {
    method: 'POST',
    headers: { authorization: `Bearer ${config.token}`, 'content-type': 'application/json' },
    body: JSON.stringify({ site }),
  });
  if (!res.ok) fail(`delete failed (HTTP ${res.status})`);
  console.log(`${green('✔')} deleted ${site}`);
}

export function siteUrl(site: string): string {
  const config = requireConfig();
  const wildcard = config.domains.find((d) => d.wildcard);
  if (wildcard) return `https://${site}.${wildcard.host}/`;
  const pathHost = config.domains[0];
  if (pathHost) return `https://${pathHost.host}/${site}/`;
  return `${config.platformUrl}/${site}/`;
}

export async function open(site: string | undefined) {
  if (!site) fail('usage: oquick open <site>');
  const url = siteUrl(site);
  console.log(cyan(url));
  const opener = process.platform === 'darwin' ? 'open' : 'xdg-open';
  spawn(opener, [url], { detached: true, stdio: 'ignore' }).unref();
}
