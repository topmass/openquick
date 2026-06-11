import { spawn } from 'node:child_process';
import { requireConfig } from './config';
import { bold, cyan, dim, yellow } from './util';

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

/** Print the deploy token so it can be shared with teammates using the hub. */
export function token() {
  const config = requireConfig();
  console.log(config.token);
  console.error(
    `${yellow('!')} anyone with this token can deploy, overwrite and delete every site on this platform – share accordingly`,
  );
}
