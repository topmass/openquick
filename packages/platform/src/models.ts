// Curated Workers AI catalog: recent models (chat ≈ last 3 months, image ≈ last
// 6 months) with neuron-cost context. freePerDay ≈ calls that fit in the 10k
// free daily neurons at ~1k input + 300 output tokens (or one 1024px image).
// Any full @cf/ id outside this list still works per-request.

export interface CatalogModel {
  id: string;
  kind: 'chat' | 'image';
  label: string;
  blurb: string;
  freePerDay: number;
  alias?: 'default' | 'fast' | 'best' | 'image';
  /** flux-2 family models take multipart input instead of a JSON prompt. */
  multipart?: boolean;
}

export const MODEL_CATALOG: CatalogModel[] = [
  {
    id: '@cf/google/gemma-4-26b-a4b-it',
    kind: 'chat',
    alias: 'default',
    label: 'Gemma 4 26B (MoE)',
    blurb: 'Google – top-tier quality from a tiny active size; the balanced default',
    freePerDay: 580,
  },
  {
    id: '@cf/zai-org/glm-4.7-flash',
    kind: 'chat',
    alias: 'fast',
    label: 'GLM-4.7 Flash',
    blurb: 'Zhipu – snappy and nearly free, 131k context',
    freePerDay: 610,
  },
  {
    id: '@cf/moonshotai/kimi-k2.6',
    kind: 'chat',
    alias: 'best',
    label: 'Kimi K2.6 (1T)',
    blurb: 'Moonshot – frontier open model, leads agentic + coding benchmarks; spendy',
    freePerDay: 50,
  },
  {
    id: '@cf/qwen/qwen3-30b-a3b-fp8',
    kind: 'chat',
    label: 'Qwen3 30B (MoE)',
    blurb: 'cheapest of all – great for high-volume toys',
    freePerDay: 700,
  },
  {
    id: '@cf/nvidia/nemotron-3-120b-a12b',
    kind: 'chat',
    label: 'Nemotron 3 120B (MoE)',
    blurb: 'NVIDIA – strong reasoning, fresh March 2026 release',
    freePerDay: 115,
  },
  {
    id: '@cf/openai/gpt-oss-120b',
    kind: 'chat',
    label: 'gpt-oss 120B',
    blurb: 'OpenAI – solid reasoning all-rounder',
    freePerDay: 190,
  },
  {
    id: '@cf/openai/gpt-oss-20b',
    kind: 'chat',
    label: 'gpt-oss 20B',
    blurb: 'OpenAI – light and quick',
    freePerDay: 380,
  },
  {
    id: '@cf/black-forest-labs/flux-2-klein-4b',
    kind: 'image',
    alias: 'image',
    label: 'FLUX.2 Klein 4B',
    blurb: 'newest fast image model – crisp 1024px',
    freePerDay: 90,
    multipart: true,
  },
  {
    id: '@cf/black-forest-labs/flux-1-schnell',
    kind: 'image',
    label: 'FLUX.1 Schnell',
    blurb: 'budget classic – the most images per day',
    freePerDay: 170,
  },
  {
    id: '@cf/black-forest-labs/flux-2-klein-9b',
    kind: 'image',
    label: 'FLUX.2 Klein 9B',
    blurb: 'highest quality – burns ~1.4k neurons per image',
    freePerDay: 7,
    multipart: true,
  },
];

export const DEFAULT_MODEL_ALIASES: Record<string, string> = Object.fromEntries(
  MODEL_CATALOG.filter((m) => m.alias).map((m) => [m.alias as string, m.id]),
);

export function isMultipartModel(id: string): boolean {
  return MODEL_CATALOG.find((m) => m.id === id)?.multipart ?? id.includes('flux-2');
}
