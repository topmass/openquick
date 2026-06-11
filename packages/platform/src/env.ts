import { DEFAULT_MODEL_ALIASES } from './models';

export interface Env {
  SITE: DurableObjectNamespace;
  AI: Ai;
  /** Optional shared R2 bucket – big files spill here; absent if R2 isn't enabled. */
  FILES?: R2Bucket;
  DEPLOY_TOKEN?: string;
  PATH_HOSTS?: string;
  WILDCARD_BASES?: string;
  CHAT_MODEL?: string;
  IMAGE_MODEL?: string;
  /** JSON object remapping model aliases, e.g. {"fast":"@cf/...","best":"@cf/..."} */
  MODELS?: string;
  LIMITS?: string;
  SITE_QUOTA_BYTES?: string;
  ACCESS_TEAM_DOMAIN?: string;
  ACCESS_AUD?: string;
  /** "1" disables the hub page at the platform root (sites still serve). */
  HUB_DISABLED?: string;
  /** "1" requires a valid Cloudflare Access JWT on EVERY request (org mode). */
  REQUIRE_ACCESS?: string;
}

// Sites pass an alias ('fast' | 'best') or any full @cf/ id per call; aliases
// and quick-wide defaults are remappable via the MODELS/CHAT_MODEL/IMAGE_MODEL vars.
export function resolveModel(env: Env, requested: string | undefined, kind: 'chat' | 'image'): string {
  const aliases = { ...DEFAULT_MODEL_ALIASES };
  if (env.MODELS) {
    try {
      Object.assign(aliases, JSON.parse(env.MODELS));
    } catch {
      /* keep defaults */
    }
  }
  if (env.CHAT_MODEL) aliases.default = env.CHAT_MODEL;
  if (env.IMAGE_MODEL) aliases.image = env.IMAGE_MODEL;
  if (!requested) return kind === 'image' ? aliases.image : aliases.default;
  if (requested.startsWith('@')) return requested;
  return aliases[requested] ?? (kind === 'image' ? aliases.image : aliases.default);
}

// Files larger than this spill from DO SQLite to R2 (when a bucket is bound).
export const SPILL_THRESHOLD = 5 * 1024 * 1024;
// Hard per-file caps: SQLite chunking without R2, Workers request body limit with it.
export const MAX_DO_FILE = 25 * 1024 * 1024;
export const MAX_R2_FILE = 95 * 1024 * 1024;

export const r2SiteKey = (site: string, hash: string) => `sites/${site}/${hash}`;
export const r2UploadKey = (site: string, id: string) => `uploads/${site}/${id}`;

export const DEFAULT_LIMITS: Record<string, number> = {
  db_write_ip: 5000,
  upload_ip: 100,
  ai_chat_ip: 100,
  ai_chat_site: 1000,
  ai_image_ip: 30,
  ai_image_site: 300,
  // Account-wide daily ceilings across ALL sites – the drain guard for Workers
  // Paid, where neurons beyond the free 10k/day bill at $0.011/1k. Worst case
  // with default models ≈ a couple of dollars/day, not an open tap.
  ai_chat_platform_site: 2000,
  ai_image_platform_site: 300,
};

export function limitsFromEnv(env: Env): Record<string, number> {
  if (!env.LIMITS) return DEFAULT_LIMITS;
  try {
    return { ...DEFAULT_LIMITS, ...JSON.parse(env.LIMITS) };
  } catch {
    return DEFAULT_LIMITS;
  }
}
