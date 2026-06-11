// Pure host/path routing for the three URL modes. No platform imports so it
// stays unit-testable with plain vitest.

export interface HostConfig {
  /** Extra hosts (besides *.workers.dev) that serve path-mode URLs. */
  pathHosts: string[];
  /** Bases where <site>.<base> serves a site (wildcard subdomain mode). */
  wildcardBases: string[];
}

export type Target =
  | { kind: 'platform'; path: string }
  | { kind: 'site'; site: string; sitePath: string; mode: 'path' | 'subdomain'; base: string }
  | { kind: 'redirect'; location: string }
  | { kind: 'invalid-site'; site: string }
  | { kind: 'unknown-host' };

const SITE_NAME_RE = /^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$/;
const RESERVED = new Set(['www', 'api', 'admin', 'mail', 'ftp', 'oquick', 'openquick']);

export function isValidSiteName(name: string): boolean {
  return SITE_NAME_RE.test(name) && !RESERVED.has(name) && !name.startsWith('__');
}

export function parseHostConfig(pathHosts?: string, wildcardBases?: string): HostConfig {
  const split = (s?: string) =>
    (s ?? '')
      .split(',')
      .map((h) => h.trim().toLowerCase())
      .filter(Boolean);
  return { pathHosts: split(pathHosts), wildcardBases: split(wildcardBases) };
}

export function resolveTarget(hostHeader: string, pathname: string, cfg: HostConfig): Target {
  const host = hostHeader.toLowerCase().split(':')[0];

  const isPathHost = host.endsWith('.workers.dev') || cfg.pathHosts.includes(host);
  if (isPathHost) {
    if (pathname === '/' || pathname.startsWith('/__')) {
      return { kind: 'platform', path: pathname };
    }
    const segments = pathname.slice(1).split('/');
    const site = segments[0].toLowerCase();
    if (!isValidSiteName(site)) return { kind: 'invalid-site', site };
    if (segments.length === 1) return { kind: 'redirect', location: `/${site}/` };
    const sitePath = pathname.slice(site.length + 1) || '/';
    return { kind: 'site', site, sitePath, mode: 'path', base: `/${site}` };
  }

  for (const base of cfg.wildcardBases) {
    if (host.endsWith(`.${base}`)) {
      const label = host.slice(0, -(base.length + 1));
      if (label.includes('.')) continue; // only one level deep
      if (!isValidSiteName(label)) return { kind: 'invalid-site', site: label };
      return { kind: 'site', site: label, sitePath: pathname, mode: 'subdomain', base: '' };
    }
  }

  return { kind: 'unknown-host' };
}

/** Resolve a request path to candidate asset keys, in lookup order. */
export function assetCandidates(sitePath: string): string[] {
  let p = sitePath.replace(/^\/+/, '');
  try {
    p = decodeURIComponent(p);
  } catch {
    /* keep raw */
  }
  if (p === '') return ['index.html'];
  if (p.endsWith('/')) return [`${p}index.html`];
  const last = p.split('/').pop() ?? '';
  if (!last.includes('.')) return [p, `${p}/index.html`];
  return [p];
}
