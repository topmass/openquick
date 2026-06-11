import { describe, expect, it } from 'vitest';
import { assetCandidates, isValidSiteName, parseHostConfig, resolveTarget } from '../src/routing';

const cfg = parseHostConfig('quick.northwave.ai', 'quick.northwave.ai');
const bare = parseHostConfig(undefined, undefined);

describe('site names', () => {
  it('accepts normal names', () => {
    expect(isValidSiteName('mysite')).toBe(true);
    expect(isValidSiteName('lunch-poll-2')).toBe(true);
  });
  it('rejects reserved and malformed names', () => {
    for (const bad of ['__registry__', 'www', '-x', 'x-', 'UPPER', 'a'.repeat(64), 'a b', '']) {
      expect(isValidSiteName(bad)).toBe(false);
    }
  });
});

describe('workers.dev path mode', () => {
  it('routes root to platform', () => {
    expect(resolveTarget('openquick.matt.workers.dev', '/', bare)).toEqual({ kind: 'platform', path: '/' });
  });
  it('routes __platform paths to platform', () => {
    expect(resolveTarget('openquick.matt.workers.dev', '/__platform/health', bare)).toEqual({
      kind: 'platform',
      path: '/__platform/health',
    });
  });
  it('redirects bare site to trailing slash', () => {
    expect(resolveTarget('openquick.matt.workers.dev', '/mysite', bare)).toEqual({
      kind: 'redirect',
      location: '/mysite/',
    });
  });
  it('routes site paths', () => {
    expect(resolveTarget('openquick.matt.workers.dev', '/mysite/css/app.css', bare)).toEqual({
      kind: 'site',
      site: 'mysite',
      sitePath: '/css/app.css',
      mode: 'path',
      base: '/mysite',
    });
  });
  it('routes site api paths', () => {
    const t = resolveTarget('openquick.matt.workers.dev', '/mysite/__api/db/posts', bare);
    expect(t).toMatchObject({ kind: 'site', site: 'mysite', sitePath: '/__api/db/posts' });
  });
  it('rejects invalid site names', () => {
    expect(resolveTarget('openquick.matt.workers.dev', '/Bad_Name/x', bare)).toMatchObject({
      kind: 'invalid-site',
    });
  });
});

describe('custom domain modes', () => {
  it('path host serves path mode', () => {
    expect(resolveTarget('quick.northwave.ai', '/mysite/index.html', cfg)).toMatchObject({
      kind: 'site',
      site: 'mysite',
      mode: 'path',
    });
  });
  it('wildcard base serves subdomain mode', () => {
    expect(resolveTarget('mysite.quick.northwave.ai', '/about.html', cfg)).toEqual({
      kind: 'site',
      site: 'mysite',
      sitePath: '/about.html',
      mode: 'subdomain',
      base: '',
    });
  });
  it('subdomain root path', () => {
    expect(resolveTarget('mysite.quick.northwave.ai', '/', cfg)).toMatchObject({
      kind: 'site',
      sitePath: '/',
      mode: 'subdomain',
    });
  });
  it('ignores deeper labels', () => {
    expect(resolveTarget('a.b.quick.northwave.ai', '/', cfg)).toEqual({ kind: 'unknown-host' });
  });
  it('unknown hosts rejected', () => {
    expect(resolveTarget('evil.example.com', '/', cfg)).toEqual({ kind: 'unknown-host' });
  });
  it('handles host header with port', () => {
    expect(resolveTarget('quick.northwave.ai:443', '/mysite/', cfg)).toMatchObject({ site: 'mysite' });
  });
});

describe('asset candidates', () => {
  it('root serves index.html', () => {
    expect(assetCandidates('/')).toEqual(['index.html']);
  });
  it('directory paths serve index.html', () => {
    expect(assetCandidates('/docs/')).toEqual(['docs/index.html']);
  });
  it('extensionless paths try file then directory', () => {
    expect(assetCandidates('/about')).toEqual(['about', 'about/index.html']);
  });
  it('files resolve exactly', () => {
    expect(assetCandidates('/css/app.css')).toEqual(['css/app.css']);
  });
});
