import { existsSync, statSync } from 'node:fs';
import { setup } from './setup';
import { deploy } from './deploy';
import { init } from './scaffold';
import { deleteSite, list, open } from './misc';
import { domain } from './domain';
import { dev } from './dev';
import { ui } from './ui';
import { loadConfig } from './config';
import { bold, dim, fail } from './util';

declare const VERSION: string;

const BOOL_FLAGS = new Set(['yes', 'wildcard', 'help', 'version', 'no-open']);

function parseArgs(argv: string[]): { positionals: string[]; flags: Record<string, string | boolean> } {
  const positionals: string[] = [];
  const flags: Record<string, string | boolean> = {};
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '-y') flags.yes = true;
    else if (arg.startsWith('--')) {
      const eq = arg.indexOf('=');
      if (eq !== -1) flags[arg.slice(2, eq)] = arg.slice(eq + 1);
      else if (BOOL_FLAGS.has(arg.slice(2))) flags[arg.slice(2)] = true;
      else flags[arg.slice(2)] = argv[++i] ?? '';
    } else positionals.push(arg);
  }
  return { positionals, flags };
}

const HELP = `${bold('oquick')} – instant sites with batteries included, on your own Cloudflare account

${bold('usage')}
  oquick                            open the web UI (drag & drop deploys)
  oquick .                          deploy the current folder (any dir path works)
  oquick setup                      provision the platform (needs wrangler login)
  oquick init [name]                scaffold a site + agent docs
  oquick deploy [dir] [--name x]    deploy a folder → URL
  oquick list                       list all sites
  oquick open <site>                open a site in the browser
  oquick delete <site> [-y]         delete a site and its data
  oquick ui [--port 4500]           the drag & drop web UI
  oquick dev [dir] [--port 4400]    local server against the real deployed API
  oquick domain add <host> [--wildcard] [--zone z]
                                    serve sites from your own domain
  oquick domain list | remove <host>

${dim('every site gets quick.js: a zero-config database, realtime, file uploads and AI.')}
${dim('inspired by Shopify\'s internal Quick – https://shopify.engineering/quick')}`;

async function main() {
  const { positionals, flags } = parseArgs(process.argv.slice(2));
  const [command, ...rest] = positionals;

  if (flags.version) {
    console.log(VERSION);
    return;
  }
  if (flags.help || command === 'help') {
    console.log(HELP);
    return;
  }
  if (!command) {
    // Bare `oquick`: web UI once set up, help before that.
    if (loadConfig()) return ui(flags);
    console.log(HELP);
    return;
  }

  switch (command) {
    case 'setup':
      return setup(flags);
    case 'init':
      return init(rest[0], flags);
    case 'deploy':
      return deploy(rest[0], flags);
    case 'list':
    case 'ls':
      return list();
    case 'delete':
    case 'rm':
      return deleteSite(rest[0], flags);
    case 'open':
      return open(rest[0]);
    case 'ui':
      return ui(flags);
    case 'dev':
      return dev(rest[0], flags);
    case 'domain':
      return domain(rest, flags);
    default:
      // `oquick .` / `oquick some/folder` deploys that directory.
      if (command === '.' || (existsSync(command) && statSync(command).isDirectory())) {
        return deploy(command, flags);
      }
      fail(`unknown command "${command}" – try ${bold('oquick help')}`);
  }
}

main().catch((e) => fail(e instanceof Error ? e.message : String(e)));
