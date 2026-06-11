import { MODEL_CATALOG } from '../../platform/src/models';
import { requireConfig, saveConfig } from './config';
import { deployPlatform } from './setup';
import { bold, cyan, dim, fail, green } from './util';

function currentDefault(kind: 'chat' | 'image', config: { chatModel?: string | null; imageModel?: string | null }) {
  const configured = kind === 'chat' ? config.chatModel : config.imageModel;
  if (configured) return configured;
  const alias = kind === 'chat' ? 'default' : 'image';
  return MODEL_CATALOG.find((m) => m.alias === alias)?.id ?? '';
}

function printList(config: { chatModel?: string | null; imageModel?: string | null }) {
  for (const kind of ['chat', 'image'] as const) {
    const active = currentDefault(kind, config);
    console.log(bold(`\n${kind} models`) + dim('  (≈ free calls/day within the 10k daily neurons)'));
    MODEL_CATALOG.filter((m) => m.kind === kind).forEach((m, i) => {
      const marker = m.id === active ? green('●') : dim('○');
      const alias = m.alias && m.alias !== 'image' && m.alias !== 'default' ? dim(` [alias: ${m.alias}]`) : '';
      console.log(`  ${marker} ${bold(String(i + 1))}. ${m.label.padEnd(22)} ${dim(`~${m.freePerDay}/day`)}${alias}`);
      console.log(`       ${dim(m.id)} – ${m.blurb}`);
    });
  }
  console.log(`\nset the quick-wide default: ${bold('oquick models chat <n>')} or ${bold('oquick models image <n>')}`);
  console.log(
    `any other Workers AI model works by full id, e.g. ${bold('oquick models chat @cf/qwen/qwq-32b')}`,
  );
  console.log(dim('full catalog: https://developers.cloudflare.com/workers-ai/models'));
  console.log(dim('sites can still pick per call: quick.ai.chat(p, {model: "fast" | "best" | "@cf/…"})'));
}

export async function models(args: string[]) {
  const config = requireConfig();
  const [kind, pick] = args;

  if (!kind) return printList(config);
  if (kind !== 'chat' && kind !== 'image') fail('usage: oquick models [chat|image <number|@cf/model-id>]');
  if (!pick) fail(`pick a model: oquick models ${kind} <number|@cf/model-id> (see oquick models)`);

  const list = MODEL_CATALOG.filter((m) => m.kind === kind);
  const chosen = pick.startsWith('@') ? pick : list[Number(pick) - 1]?.id;
  if (!chosen) fail(`invalid choice "${pick}" – run oquick models to see the list`);

  if (kind === 'chat') config.chatModel = chosen;
  else config.imageModel = chosen;
  saveConfig(config);

  console.log(`Setting the quick-wide ${kind} default to ${bold(chosen)} – redeploying…\n`);
  await deployPlatform(config);
  console.log(`\n${green('✔')} every site now uses ${cyan(chosen)} for ${kind} by default`);
}
