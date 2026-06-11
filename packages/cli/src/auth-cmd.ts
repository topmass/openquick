import { requireConfig, saveConfig } from './config';
import { deployPlatform } from './setup';
import { bold, cyan, dim, fail, green, yellow } from './util';

/**
 * Org mode: Cloudflare Access (free ≤50 users) in front of the entire platform –
 * sites, APIs and the hub all require a login, org members deploy from the hub
 * with no token, and quick.id() returns verified emails. The IAP-style Quick.
 */
export async function auth(args: string[], flags: Record<string, string | boolean>) {
  const config = requireConfig();
  const [action] = args;

  if (action === 'status' || !action) {
    if (config.requireAccess) {
      console.log(`${green('●')} org mode ON – team ${bold(config.accessTeam ?? '?')}, everything requires an Access login`);
    } else if (config.accessTeam && config.accessAud) {
      console.log(`${yellow('●')} Access configured (identity only) – sites are public, quick.id() returns emails behind Access`);
    } else {
      console.log(`${dim('○')} open mode – sites are public, deploys are token-gated (the default)`);
    }
    if (config.openDeploys) {
      console.log(`${yellow('●')} deploys are OPEN – anyone can create/update sites (delete still needs the token)`);
    }
    console.log(dim(`\noquick auth enable --team <team> --aud <tag>   |   oquick auth disable`));
    return;
  }

  if (action === 'disable') {
    config.requireAccess = false;
    saveConfig(config);
    console.log('Turning org mode off – redeploying…\n');
    await deployPlatform(config);
    console.log(`\n${green('✔')} platform is open again (deploys still token-gated)`);
    return;
  }

  if (action !== 'enable') fail('usage: oquick auth [status|enable --team <team> --aud <tag>|disable]');

  const team = typeof flags.team === 'string' ? flags.team : config.accessTeam;
  const aud = typeof flags.aud === 'string' ? flags.aud : config.accessAud;
  const domain = config.domains[0];

  if (!team || !aud) {
    console.log(bold('\n🔒 Org mode – one-time Cloudflare Access setup\n'));
    if (!domain) {
      console.log(`${yellow('1.')} Access can't protect workers.dev – add a domain first:`);
      console.log(`   ${bold('oquick domain add quick.yourdomain.com')}\n`);
    }
    console.log(`${yellow(domain ? '1.' : '2.')} In ${cyan('https://one.dash.cloudflare.com')} → Access → Applications → Add:`);
    console.log(`   self-hosted app covering ${bold(domain ? domain.host : 'your-domain')}${domain?.wildcard ? ` and *.${domain.host}` : ''}`);
    console.log(`   with a policy for the people/org you want to allow (free up to 50 users).`);
    console.log(`${yellow(domain ? '2.' : '3.')} Copy the team domain (the <team> in <team>.cloudflareaccess.com) and the`);
    console.log(`   application's ${bold('AUD tag')} (in the app's overview).`);
    console.log(`\nThen: ${bold('oquick auth enable --team <team> --aud <aud-tag>')}\n`);
    return;
  }

  config.accessTeam = team;
  config.accessAud = aud;
  config.requireAccess = true;
  saveConfig(config);
  console.log(`Enabling org mode (team ${bold(team)}) – redeploying…\n`);
  await deployPlatform(config);
  console.log(`\n${green('✔')} everything now requires a Cloudflare Access login.`);
  if (domain) console.log(`  Your org signs in at ${bold(cyan(`https://${domain.host}/`))} – deploys from the hub need no token.`);
  console.log(dim(`  Note: ${config.platformUrl} now answers 403 for everyone except CLI deploys (by design).`));
  console.log(dim(`  Undo any time: oquick auth disable`));
}
