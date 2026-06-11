import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { fail } from './util';

function wranglerBin(): string {
  // The CLI is bundled to CJS, so __filename resolves relative to dist/.
  const require = createRequire(__filename);
  try {
    return require.resolve('wrangler/bin/wrangler.js');
  } catch {
    fail('bundled wrangler not found – reinstall openquick');
  }
}

export interface RunResult {
  code: number;
  output: string;
}

/**
 * Run wrangler, streaming output to the terminal while capturing it.
 * stdin stays attached so wrangler's interactive prompts still work.
 */
export function runWrangler(
  args: string[],
  opts: { cwd?: string; accountId?: string; stdin?: string; quiet?: boolean } = {},
): Promise<RunResult> {
  return new Promise((resolve) => {
    const env = { ...process.env };
    if (opts.accountId) env.CLOUDFLARE_ACCOUNT_ID = opts.accountId;
    const child = spawn(process.execPath, [wranglerBin(), ...args], {
      cwd: opts.cwd,
      env,
      stdio: [opts.stdin === undefined ? 'inherit' : 'pipe', 'pipe', 'pipe'],
    });
    if (opts.stdin !== undefined) {
      child.stdin!.write(opts.stdin);
      child.stdin!.end();
    }
    let output = '';
    const onData = (chunk: Buffer) => {
      output += chunk.toString();
      if (!opts.quiet) process.stdout.write(chunk);
    };
    child.stdout!.on('data', onData);
    child.stderr!.on('data', onData);
    child.on('close', (code) => resolve({ code: code ?? 1, output }));
  });
}

export interface Account {
  name: string;
  id: string;
}

export async function whoami(): Promise<{ loggedIn: boolean; accounts: Account[] }> {
  const { code, output } = await runWrangler(['whoami'], { quiet: true });
  if (code !== 0 || /not authenticated|not logged in/i.test(output)) {
    return { loggedIn: false, accounts: [] };
  }
  const accounts: Account[] = [];
  for (const match of output.matchAll(/│\s*(.+?)\s*│\s*([0-9a-f]{32})\s*│/g)) {
    if (!/account name/i.test(match[1])) accounts.push({ name: match[1], id: match[2] });
  }
  return { loggedIn: /logged in/i.test(output) || accounts.length > 0, accounts };
}
