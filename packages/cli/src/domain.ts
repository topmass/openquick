import { requireConfig, saveConfig } from './config';
import { deployPlatform } from './setup';
import { ask, bold, cyan, dim, fail, green, yellow } from './util';

async function dohResolve(name: string): Promise<boolean> {
  for (const type of ['A', 'AAAA']) {
    const res = await fetch(
      `https://cloudflare-dns.com/dns-query?name=${encodeURIComponent(name)}&type=${type}`,
      { headers: { accept: 'application/dns-json' } },
    ).catch(() => null);
    if (!res?.ok) continue;
    const data = (await res.json()) as { Status: number; Answer?: unknown[] };
    if (data.Status === 0 && data.Answer?.length) return true;
  }
  return false;
}

function deriveZone(host: string): string {
  const labels = host.split('.');
  return labels.length <= 2 ? host : labels.slice(1).join('.');
}

export async function domain(args: string[], flags: Record<string, string | boolean>) {
  const config = requireConfig();
  const [action, host] = args;

  if (action === 'list' || !action) {
    if (!config.domains.length) {
      console.log(`no custom domains – sites live at ${cyan(`${config.platformUrl}/<site>/`)}`);
      console.log(`add one with ${bold('oquick domain add quick.yourdomain.com [--wildcard]')}`);
      return;
    }
    for (const d of config.domains) {
      console.log(`${bold(d.host)}  ${d.wildcard ? 'sites at <site>.' + d.host : 'sites at ' + d.host + '/<site>/'} ${dim(`zone: ${d.zone}`)}`);
    }
    return;
  }

  if (action === 'remove' && host) {
    config.domains = config.domains.filter((d) => d.host !== host.toLowerCase());
    saveConfig(config);
    console.log('Updating worker routes…');
    await deployPlatform(config);
    console.log(`${green('✔')} removed ${host} (the DNS record can now be deleted in the dashboard)`);
    return;
  }

  if (action !== 'add' || !host) fail('usage: oquick domain add <host> [--wildcard] [--zone <zone>]');

  const cleanHost = host.toLowerCase().replace(/^\*\./, '');
  const wildcard = !!flags.wildcard || host.startsWith('*.');
  const zone = typeof flags.zone === 'string' ? flags.zone : deriveZone(cleanHost);
  const firstLabel = cleanHost === zone ? '@' : cleanHost.slice(0, -(zone.length + 1));

  console.log(`\nAdding ${bold(wildcard ? `*.${cleanHost}` : cleanHost)} ${dim(`(zone ${zone})`)}\n`);

  if (wildcard && cleanHost !== zone) {
    console.log(
      `${yellow('!')} ${bold(`*.${cleanHost}`)} is a second-level wildcard. Cloudflare Universal SSL only covers`,
    );
    console.log(
      `  one subdomain level, so browsers will see certificate errors unless the zone has`,
    );
    console.log(
      `  Advanced Certificate Manager (~$10/mo) with a cert for *.${cleanHost}.`,
    );
    console.log(`  A dedicated zone (e.g. *.myquickdomain.com) gets wildcard SSL for free.\n`);
  }

  console.log(`Your wrangler login cannot edit DNS, so add ${wildcard ? 'these records' : 'this record'} in the`);
  console.log(`Cloudflare dashboard (${cyan(`https://dash.cloudflare.com → ${zone} → DNS`)}):\n`);
  console.log(`  Type   Name${' '.repeat(Math.max(1, firstLabel.length))}      Content   Proxy`);
  console.log(`  AAAA   ${firstLabel.padEnd(Math.max(8, firstLabel.length + 4))}  100::     ${green('Proxied')}`);
  if (wildcard) {
    const wild = firstLabel === '@' ? '*' : `*.${firstLabel}`;
    console.log(`  AAAA   ${wild.padEnd(Math.max(8, firstLabel.length + 4))}  100::     ${green('Proxied')}`);
  }
  console.log(dim('\n(100:: is a discard address – the worker route answers before it is ever used)\n'));

  await ask(`Press enter once the record exists (or to continue anyway)… `);

  const probe = wildcard ? `oq-probe-x9.${cleanHost}` : cleanHost;
  const ok = await dohResolve(probe);
  console.log(ok ? `${green('✔')} DNS resolves` : `${yellow('!')} DNS does not resolve yet – routes will start working once it does`);

  config.domains = config.domains.filter((d) => d.host !== cleanHost);
  config.domains.push({ host: cleanHost, zone, wildcard });
  saveConfig(config);

  console.log('\nDeploying worker with the new routes…\n');
  await deployPlatform(config);

  console.log(`\n${green('✔')} done – sites are now also available at:`);
  console.log(`  ${bold(cyan(`https://${cleanHost}/<site>/`))}`);
  if (wildcard) console.log(`  ${bold(cyan(`https://<site>.${cleanHost}/`))}`);
}
