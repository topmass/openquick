import { cpSync, existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { join } from 'node:path';
import { configDir, loadConfig, saveConfig, wranglerConfig, type Config } from './config';
import { runWrangler, whoami, type Account } from './wrangler';
import { ask, bold, cyan, dim, fail, green, yellow } from './util';

export const platformDir = join(configDir, 'platform');

/** Where the platform worker source ships inside the installed npm package. */
function bundledPlatformDir(): string {
  return join(__dirname, '..', 'platform');
}

export function writePlatform(workerName: string, domains: Config['domains']) {
  const src = bundledPlatformDir();
  if (!existsSync(join(src, 'worker.js'))) {
    fail(`bundled platform worker missing at ${src} – reinstall openquick`);
  }
  rmSync(platformDir, { recursive: true, force: true });
  mkdirSync(platformDir, { recursive: true });
  cpSync(join(src, 'worker.js'), join(platformDir, 'worker.js'));
  writeFileSync(
    join(platformDir, 'wrangler.json'),
    JSON.stringify(wranglerConfig(workerName, domains), null, 2) + '\n',
  );
}

export async function deployPlatform(config: Config): Promise<string> {
  writePlatform(config.workerName, config.domains);
  const { code, output } = await runWrangler(['deploy'], {
    cwd: platformDir,
    accountId: config.accountId,
  });
  if (code !== 0) {
    if (/register a workers\.dev subdomain|subdomain/i.test(output) && !config.platformUrl) {
      fail(
        `wrangler could not register a workers.dev subdomain non-interactively.\n` +
          `  Visit ${cyan('https://dash.cloudflare.com')} → Workers, set your workers.dev subdomain, then re-run ${bold('oquick setup')}.`,
      );
    }
    fail('wrangler deploy failed (see output above)');
  }
  const match = output.match(/https:\/\/[a-z0-9-]+\.[a-z0-9-]+\.workers\.dev/i);
  if (match) return match[0];
  if (config.platformUrl) return config.platformUrl;
  fail('could not determine the workers.dev URL from wrangler output');
}

async function pickAccount(accounts: Account[], existing: string | undefined): Promise<string> {
  if (process.env.CLOUDFLARE_ACCOUNT_ID) return process.env.CLOUDFLARE_ACCOUNT_ID;
  if (existing && accounts.some((a) => a.id === existing)) return existing;
  if (accounts.length === 1) return accounts[0].id;
  if (accounts.length === 0) fail('no Cloudflare accounts found on this wrangler login');
  console.log(`\nYour wrangler login can deploy to ${accounts.length} accounts:`);
  accounts.forEach((a, i) => console.log(`  ${bold(String(i + 1))}. ${a.name} ${dim(a.id)}`));
  const answer = await ask(`Deploy OpenQuick to which account? ${dim(`[1-${accounts.length}]`)} `);
  const index = Number(answer) - 1;
  if (!accounts[index]) fail('invalid choice');
  return accounts[index].id;
}

export async function setup(flags: Record<string, string | boolean>) {
  console.log(bold('\n⚡ OpenQuick setup\n'));

  let who = await whoami();
  if (!who.loggedIn) {
    console.log(`${yellow('!')} wrangler is not logged in – opening Cloudflare login…\n`);
    await runWrangler(['login']);
    who = await whoami();
    if (!who.loggedIn) fail('wrangler login did not complete');
  }

  const existing = loadConfig();
  const workerName =
    typeof flags['worker-name'] === 'string' ? flags['worker-name'] : existing?.workerName ?? 'openquick';
  const accountId = await pickAccount(who.accounts, existing?.accountId);
  const accountName = who.accounts.find((a) => a.id === accountId)?.name ?? accountId;
  console.log(`\nDeploying platform worker ${bold(workerName)} to ${bold(accountName)}…\n`);

  const config: Config = {
    accountId,
    workerName,
    platformUrl: existing?.platformUrl ?? '',
    token: existing?.token ?? randomBytes(32).toString('hex'),
    domains: existing?.domains ?? [],
  };

  config.platformUrl = await deployPlatform(config);

  const secret = await runWrangler(['secret', 'put', 'DEPLOY_TOKEN', '--name', workerName], {
    cwd: platformDir,
    accountId,
    stdin: config.token,
    quiet: true,
  });
  if (secret.code !== 0) fail(`could not set the deploy token:\n${secret.output}`);

  // workers.dev can take a moment to propagate on a first deploy.
  let health: { ok?: boolean } | null = null;
  for (let attempt = 0; attempt < 10 && !health?.ok; attempt++) {
    if (attempt > 0) await new Promise((r) => setTimeout(r, 3000));
    health = await fetch(`${config.platformUrl}/__platform/health`)
      .then((r) => r.json() as Promise<{ ok?: boolean }>)
      .catch(() => null);
  }
  if (!health?.ok) fail(`platform deployed but health check failed at ${config.platformUrl}`);

  saveConfig(config);

  console.log(`\n${green('✔')} OpenQuick is live at ${bold(cyan(config.platformUrl))}\n`);
  console.log(`Next steps:`);
  console.log(`  ${bold('oquick init mysite')}   scaffold a site (with agent docs)`);
  console.log(`  ${bold('oquick deploy')}        deploy the current folder`);
  console.log(`  ${bold('oquick domain add quick.yourdomain.com')}   pretty URLs ${dim('(optional)')}\n`);
}
