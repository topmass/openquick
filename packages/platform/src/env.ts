export interface Env {
  SITE: DurableObjectNamespace;
  AI: Ai;
  DEPLOY_TOKEN?: string;
  PATH_HOSTS?: string;
  WILDCARD_BASES?: string;
  CHAT_MODEL?: string;
  IMAGE_MODEL?: string;
  LIMITS?: string;
  SITE_QUOTA_BYTES?: string;
  ACCESS_TEAM_DOMAIN?: string;
  ACCESS_AUD?: string;
}

export const DEFAULT_CHAT_MODEL = '@cf/meta/llama-4-scout-17b-16e-instruct';
// flux-2 models expect multipart input; flux-1-schnell takes a plain prompt.
export const DEFAULT_IMAGE_MODEL = '@cf/black-forest-labs/flux-1-schnell';

export const DEFAULT_LIMITS: Record<string, number> = {
  db_write_ip: 5000,
  upload_ip: 100,
  ai_chat_ip: 100,
  ai_chat_site: 1000,
  ai_image_ip: 30,
  ai_image_site: 300,
};

export function limitsFromEnv(env: Env): Record<string, number> {
  if (!env.LIMITS) return DEFAULT_LIMITS;
  try {
    return { ...DEFAULT_LIMITS, ...JSON.parse(env.LIMITS) };
  } catch {
    return DEFAULT_LIMITS;
  }
}
