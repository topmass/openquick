import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { bold, fail } from './util';

export interface Domain {
  host: string;
  zone: string;
  wildcard: boolean;
}

export interface Config {
  accountId: string;
  workerName: string;
  platformUrl: string;
  token: string;
  domains: Domain[];
}

export const configDir = join(
  process.env.XDG_CONFIG_HOME || join(homedir(), '.config'),
  'openquick',
);
const configPath = join(configDir, 'config.json');

export function loadConfig(): Config | null {
  if (!existsSync(configPath)) return null;
  try {
    const config = JSON.parse(readFileSync(configPath, 'utf8')) as Config;
    config.domains ??= [];
    return config;
  } catch {
    return null;
  }
}

export function requireConfig(): Config {
  const config = loadConfig();
  if (!config) fail(`not set up yet – run ${bold('oquick setup')} first`);
  return config;
}

export function saveConfig(config: Config) {
  mkdirSync(configDir, { recursive: true });
  writeFileSync(configPath, JSON.stringify(config, null, 2) + '\n', { mode: 0o600 });
}

/** The wrangler config the CLI generates for the user's platform worker. */
export function wranglerConfig(workerName: string, domains: Domain[]) {
  const routes = domains.flatMap((d) => [
    { pattern: `${d.host}/*`, zone_name: d.zone },
    ...(d.wildcard ? [{ pattern: `*.${d.host}/*`, zone_name: d.zone }] : []),
  ]);
  return {
    name: workerName,
    main: 'worker.js',
    compatibility_date: '2026-06-01',
    workers_dev: true,
    durable_objects: { bindings: [{ name: 'SITE', class_name: 'SiteDO' }] },
    migrations: [{ tag: 'v1', new_sqlite_classes: ['SiteDO'] }],
    ai: { binding: 'AI' },
    observability: { enabled: true },
    vars: {
      PATH_HOSTS: domains.map((d) => d.host).join(','),
      WILDCARD_BASES: domains.filter((d) => d.wildcard).map((d) => d.host).join(','),
    },
    ...(routes.length ? { routes } : {}),
  };
}
