// Builds the CLI into a single executable and bundles the platform worker
// source + site templates into the npm package.
import { build } from 'esbuild';
import { chmodSync, cpSync, mkdirSync, readFileSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execSync } from 'node:child_process';

const here = dirname(fileURLToPath(import.meta.url));
const pkgDir = join(here, '..');
const repoRoot = join(pkgDir, '..', '..');
const platformPkg = join(repoRoot, 'packages', 'platform');
const version = JSON.parse(readFileSync(join(pkgDir, 'package.json'), 'utf8')).version;

// 1. Make sure the SDK is built and embedded into the platform source.
execSync('pnpm --filter @openquick/sdk build', { cwd: repoRoot, stdio: 'inherit' });
execSync('pnpm --filter @openquick/platform run embed-sdk', { cwd: repoRoot, stdio: 'inherit' });

// 2. Bundle the CLI.
await build({
  entryPoints: [join(pkgDir, 'src', 'index.ts')],
  outfile: join(pkgDir, 'dist', 'oquick.cjs'),
  bundle: true,
  platform: 'node',
  target: 'node18',
  format: 'cjs',
  banner: { js: '#!/usr/bin/env node' },
  define: { VERSION: JSON.stringify(version) },
  external: ['wrangler'],
  logLevel: 'info',
});
chmodSync(join(pkgDir, 'dist', 'oquick.cjs'), 0o755);

// 3. Pre-bundle the platform worker to a single ESM file (resolves jose etc.
// here, so the deploy dir needs no node_modules – wrangler just uploads it).
rmSync(join(pkgDir, 'platform'), { recursive: true, force: true });
mkdirSync(join(pkgDir, 'platform'), { recursive: true });
await build({
  entryPoints: [join(platformPkg, 'src', 'index.ts')],
  outfile: join(pkgDir, 'platform', 'worker.js'),
  bundle: true,
  format: 'esm',
  target: 'es2022',
  conditions: ['workerd', 'worker', 'browser'],
  external: ['cloudflare:*'],
  logLevel: 'info',
});

// 4. Bundle the site templates.
rmSync(join(pkgDir, 'templates'), { recursive: true, force: true });
cpSync(join(repoRoot, 'templates'), join(pkgDir, 'templates'), { recursive: true });

console.log('cli build complete');
