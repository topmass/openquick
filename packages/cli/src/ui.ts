import { spawn } from 'node:child_process';
import { requireConfig, saveConfig } from './config';
import { deployPlatform } from './setup';
import { bold, cyan, dim, fail, green, yellow } from './util';

/**
 * The hub (drag & drop deploys, site directory) is served by the platform
 * worker itself. We just open it, handing the deploy token over in the URL
 * fragment – fragments never leave the browser, and the page moves the token
 * into localStorage immediately.
 */
export function ui(flags: Record<string, string | boolean>) {
  const config = requireConfig();
  const url = `${config.platformUrl}/#token=${config.token}`;
  console.log(`${bold('⚡ OpenQuick hub')}  ${cyan(config.platformUrl)}`);
  console.log(dim('  drag & drop a folder to deploy – opening in your browser…'));
  if (!flags['no-open']) {
    const opener = process.platform === 'darwin' ? 'open' : 'xdg-open';
    spawn(opener, [url], { detached: true, stdio: 'ignore' }).unref();
  } else {
    console.log(dim(`  ${url}`));
  }
}

/**
 * oquick token            – print the deploy token (for teammates using the hub)
 * oquick token open       – anyone may deploy/update sites, no token (delete stays gated)
 * oquick token require    – back to token-gated deploys (the default)
 */
export async function token(args: string[]) {
  const config = requireConfig();
  const [action] = args;

  if (action === 'open' || action === 'require') {
    config.openDeploys = action === 'open';
    saveConfig(config);
    console.log(
      config.openDeploys
        ? `Opening deploys to everyone ${dim('(per-IP daily caps + site limit apply; delete keeps needing the token)')} – redeploying…\n`
        : 'Requiring the token for deploys again – redeploying…\n',
    );
    await deployPlatform(config);
    console.log(
      `\n${green('✔')} ${
        config.openDeploys
          ? `anyone can now deploy at ${bold(cyan(`${config.platformUrl}/`))} – a true open playground`
          : 'deploys are token-gated again'
      }`,
    );
    return;
  }
  if (action) fail('usage: oquick token [open|require]');

  console.log(config.token);
  console.error(
    `${yellow('!')} anyone with this token can deploy, overwrite and delete every site on this platform – share accordingly`,
  );
  if (config.openDeploys) {
    console.error(dim('  note: deploys are currently OPEN to everyone (oquick token require restores the gate)'));
  }
}
