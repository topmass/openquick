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

export function writePlatform(config: Config) {
  const src = bundledPlatformDir();
  if (!existsSync(join(src, 'worker.js'))) {
    fail(`bundled platform worker missing at ${src} – reinstall openquick`);
  }
  rmSync(platformDir, { recursive: true, force: true });
  mkdirSync(platformDir, { recursive: true });
  cpSync(join(src, 'worker.js'), join(platformDir, 'worker.js'));
  writeFileSync(
    join(platformDir, 'wrangler.json'),
    JSON.stringify(wranglerConfig(config), null, 2) + '\n',
  );
}

/**
 * Ensure the shared spillover bucket exists. Returns its name, or null when R2
 * isn't enabled on the account (sites then keep the 25 MB per-file cap).
 */
async function ensureBucket(workerName: string, accountId: string): Promise<string | null> {
  const bucket = `${workerName}-files`;
  const { code, output } = await runWrangler(['r2', 'bucket', 'create', bucket], {
    accountId,
    quiet: true,
  });
  if (code === 0 || /already (exists|owned)/i.test(output)) return bucket;
  console.log(
    `${yellow('!')} R2 is not available on this account (enable it once at ${cyan(
      'https://dash.cloudflare.com → R2',
    )}, then re-run ${bold('oquick setup')}).`,
  );
  console.log(`  Sites still work – files are just capped at 25 MB each until then.\n`);
  return null;
}

export async function deployPlatform(config: Config): Promise<string> {
  writePlatform(config);
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

  let limits = existing?.limits ?? null;
  if (typeof flags.limits === 'string') {
    try {
      limits = JSON.parse(flags.limits);
    } catch {
      fail('--limits must be JSON, e.g. \'{"ai_chat_platform_site":5000}\'');
    }
  }

  const config: Config = {
    accountId,
    workerName,
    platformUrl: existing?.platformUrl ?? '',
    token: existing?.token ?? randomBytes(32).toString('hex'),
    domains: existing?.domains ?? [],
    r2Bucket: existing?.r2Bucket ?? null,
    chatModel: typeof flags['chat-model'] === 'string' ? flags['chat-model'] : existing?.chatModel ?? null,
    imageModel: typeof flags['image-model'] === 'string' ? flags['image-model'] : existing?.imageModel ?? null,
    limits,
    hub: flags['no-hub'] ? false : flags.hub ? true : existing?.hub ?? true,
    accessTeam: typeof flags['access-team'] === 'string' ? flags['access-team'] : existing?.accessTeam ?? null,
    accessAud: typeof flags['access-aud'] === 'string' ? flags['access-aud'] : existing?.accessAud ?? null,
    requireAccess: flags.private ? true : flags.public ? false : existing?.requireAccess ?? false,
  };
  if (config.requireAccess && (!config.accessTeam || !config.accessAud)) {
    fail(`--private needs Cloudflare Access configured – run ${bold('oquick auth enable')} for the guided steps`);
  }

  config.r2Bucket = config.r2Bucket ?? (await ensureBucket(workerName, accountId));
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
    health = await fetch(`${config.platformUrl}/__platform/health`, {
      headers: { authorization: `Bearer ${config.token}` },
    })
      .then((r) => r.json() as Promise<{ ok?: boolean }>)
      .catch(() => null);
  }
  if (!health?.ok) fail(`platform deployed but health check failed at ${config.platformUrl}`);

  saveConfig(config);

  console.log(`\n${green('✔')} OpenQuick is live at ${bold(cyan(config.platformUrl))}\n`);
  console.log(`AI (Workers AI, 10k free neurons/day on every plan):`);
  console.log(
    `  models: default ${bold(config.chatModel ?? 'Gemma 4 26B')} · fast GLM-4.7 Flash · best Kimi K2.6 · image ${
      config.imageModel ?? 'FLUX.2 Klein'
    }`,
  );
  console.log(
    `  caps:   ${dim('per visitor/day:')} 100 chat, 30 images   ${dim('account-wide/day:')} 2000 chat, 300 images`,
  );
  console.log(
    dim(`  change: oquick models (pick quick-wide defaults from a list) · --limits '{"ai_chat_platform_site":5000}'\n`),
  );
  console.log(`Next steps:`);
  console.log(`  ${bold('oquick init mysite')}   scaffold a site (with agent docs)`);
  console.log(`  ${bold('oquick deploy')}        deploy the current folder`);
  console.log(`  ${bold('oquick domain add quick.yourdomain.com')}   pretty URLs ${dim('(optional)')}\n`);
}
