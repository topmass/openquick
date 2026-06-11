import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { loadConfig } from './config';
import { bold, cyan, dim, fail, green, slugify, validSiteName } from './util';

function templatesDir(): string {
  return join(__dirname, '..', 'templates');
}

export function init(nameArg: string | undefined, flags: Record<string, string | boolean>) {
  const name = slugify(nameArg ?? 'my-quick-site');
  if (!validSiteName(name)) fail(`"${name}" is not a valid site name`);
  const dir = resolve(typeof flags.dir === 'string' ? flags.dir : name);
  if (existsSync(dir) && readdirSync(dir).length > 0) fail(`${dir} already exists and is not empty`);

  const template = join(templatesDir(), 'default');
  if (!existsSync(template)) fail(`bundled templates missing at ${template} – reinstall openquick`);
  mkdirSync(dir, { recursive: true });
  cpSync(template, dir, { recursive: true });

  // Personalize the scaffold for this site.
  const config = loadConfig();
  const baseUrl = config ? `${config.platformUrl}/${name}/` : '<run oquick setup first>';
  for (const file of ['index.html', 'AGENTS.md', 'CLAUDE.md', 'oquick.json']) {
    const path = join(dir, file);
    if (!existsSync(path)) continue;
    writeFileSync(
      path,
      readFileSync(path, 'utf8').replaceAll('__SITE_NAME__', name).replaceAll('__SITE_URL__', baseUrl),
    );
  }

  console.log(`${green('✔')} created ${bold(dir)}`);
  console.log(`\n  cd ${name}`);
  console.log(`  ${bold('oquick deploy')}   ${dim(`→ ${baseUrl}`)}`);
  console.log(
    `\n${dim('AGENTS.md / CLAUDE.md document the full quick.js API – point your coding agent at the folder and build.')}`,
  );
}
