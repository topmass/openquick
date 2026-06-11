# OpenQuick – Project Specsheet (source of truth)

Last updated: 2026-06-11. All features below are deployed and verified live on the
Matt@northwave.ai Cloudflare account: https://openquick.nwave.workers.dev

## What this is

An open-source, self-hosted clone of Shopify's internal "Quick" platform
(https://shopify.engineering/quick): drop a folder of static files → instant URL, plus a
zero-config browser API (`quick.js`) giving every site a JSON database with realtime
subscriptions, websocket channels with presence, file uploads, and Workers AI – no API keys,
no per-site provisioning. Distributed as the npm package `openquick` (CLI `oquick`); each user
runs `oquick setup` and the whole platform deploys into **their own** Cloudflare account
(free tier is enough).

## Architecture (one worker, one DO per site, one R2 bucket)

```
Browser ──► Worker "openquick" (packages/platform)
              ├── routing.ts      host/path → platform | site (3 URL modes)
              ├── index.ts        platform API, site API, AI proxy, R2 serving, hub
              ├── landing.ts      the hub page (HTML string)
              ├── site-do.ts      SiteDO – one Durable Object PER SITE (SQLite)
              ├── models.ts       curated AI model catalog (single source for CLI too)
              ├── env.ts          Env type, limits, model resolution, R2 keys, size caps
              └── generated/sdk.ts  quick.js embedded as a string (built artifact)
R2 bucket "openquick-files": big files only (sites/<site>/<sha256>, uploads/<site>/<id>)
```

- **SiteDO** (`idFromName(siteName)`) holds a site's assets (chunked ≤1.5MB rows; SQLite has a
  2MB/value limit), JSON documents, uploads, live hibernating WebSockets, and rate counters.
  One reserved instance `__registry__` holds the site directory + platform-wide AI counters.
- **R2 spillover**: files >5MB (`SPILL_THRESHOLD`) stream to R2 instead of SQLite rows; the DO
  manifest records `storage:'r2'`. Caps: 25MB/file without R2, 95MB with (Workers body limit).
  Commit head-verifies R2 objects and garbage-collects orphans; site delete wipes both prefixes.
- **URL modes** (all simultaneously, `routing.ts resolveTarget`): workers.dev path mode
  (`/<site>/...`), custom-domain path mode, wildcard subdomains (`<site>.<base>`). Wildcards on
  a shared zone need ACM ($10/mo) – Universal SSL covers only one subdomain level. Never route
  `*.<apex>` of a zone with other subdomains (it would intercept them).

## Deploy protocol (CLI, hub, and dev all speak it)

1. `POST /__platform/deploy/start` `{site, manifest:[{path, sha256 hash, size, ct}]}` →
   `{uploadId, needed:[{path,hash,storage,ct}]}` – the DO diffs against existing
   `storage:hash` pairs, classifies >5MB files as `r2`.
2. `PUT /__platform/deploy/file?site&uploadId&hash[&storage=r2&ct=]` per needed file –
   worker streams r2-bound bodies straight to the bucket, others into staged DO chunks.
3. `POST /__platform/deploy/commit` `{site, uploadId}` – worker fetches `/deploy/pending`,
   head-verifies R2 hashes, DO swaps the manifest in ONE `transactionSync` (atomic deploys),
   registry upserted, R2 orphans GC'd. Returns `{urls}`.

All deploy/delete routes require `Authorization: Bearer <DEPLOY_TOKEN>` (worker secret,
generated at setup, stored in `~/.config/openquick/config.json`). Hashes are computed
client-side (10ms CPU limit on free workers). Overwrite = takeover, like Quick.

## The browser SDK (packages/sdk/src/quick.ts → served at `<site>/__quick.js`)

`quick.db.collection(c)` .create/.get/.list/.update/.delete/.subscribe (realtime via one
multiplexed WS to the site's DO) · `quick.channel(name)` send/on('message'|'presence')/leave ·
`quick.files.upload(file)` · `quick.ai.chat(input, {model, system, onToken})` /
`quick.ai.image(prompt, {model, width, height})` · `quick.id()` + `quick.id.setName()`.
Base URL auto-detected from the script src; `window.__QUICK_BASE__` overrides (used by
`oquick dev`). SDK is built by esbuild then embedded into the worker by
`packages/platform/scripts/embed-sdk.mjs` → `src/generated/sdk.ts` (gitignored).

## AI integration

- Binding `env.AI` (account-level, keyless – Quick's "keys live on the server" model).
- **Catalog**: `packages/platform/src/models.ts` – THE single source. Aliases: `default`
  (Gemma 4 26B), `fast` (GLM-4.7 Flash), `best` (Kimi K2.6), image (FLUX.2 Klein 4B).
  Per-call: alias or any full `@cf/` id. Quick-wide: `oquick models chat|image <n|@id>`
  (writes CHAT_MODEL/IMAGE_MODEL vars + redeploys); `MODELS` var remaps aliases.
- **Response normalization**: `extractText()` in index.ts handles llama (`response`),
  gpt-oss (responses-API `output[]`), and chat-completions (`choices[0].message.content`)
  shapes – glm/kimi/gpt-oss return EMPTY without it. SDK stream parser mirrors this.
- **flux-2 models need multipart input**: FormData → `{multipart:{body, contentType}}`
  (see `handleAiImage`); `isMultipartModel()` decides. flux-1 takes `{prompt}` JSON.
- **Free usage**: 10k neurons/day on free AND paid plans (paid bills $0.011/1k overage,
  free hard-stops = unbillable). Caps (DO counters, `LIMITS` var merges over
  `DEFAULT_LIMITS` in env.ts): per-IP 100 chat / 30 img, per-site 1000/300,
  **account-wide 2000/300** (`ai_*_platform_site` keys, counted in the registry DO).

## The hub (landing.ts)

Quick-article-styled page (Pacifico sticker wordmark, indigo grid, neo-brutalist cards,
confetti) served at the platform root. Drag & drop deploys from the browser using the same
deploy protocol; site directory with open/delete. Token UX: `oquick` opens
`platformUrl/#token=<t>` → page moves it to localStorage (`oq:token`) and scrubs the URL;
teammates paste the token (from `oquick token`) once. 401s surface the unlock card.
KNOWN TRADEOFF: in workers.dev path mode all sites share the hub's origin, so hosted sites'
JS can read that localStorage token – same trust bubble as sharing the token at all;
disappears in subdomain mode.

## CLI (packages/cli – npm package `openquick`, bin `oquick`)

setup (provision/upgrade; R2 bucket create with not-enabled fallback; `--chat-model
--image-model --limits`) · init (template + AGENTS.md/CLAUDE.md agent docs – the `quick init`
agent-skills move) · deploy / `.` / any dir path · list · open · delete · token · models ·
ui|hub · dev (local server proxying the deployed API via `__QUICK_BASE__`) · domain
add/list/remove (prints the manual DNS record – wrangler OAuth has no DNS-write scope –
attaches routes via wrangler, warns on second-level wildcard SSL).

Build chain (`packages/cli/scripts/build.mjs`): sdk esbuild → embed into platform →
CLI bundled to **dist/oquick.cjs** (CJS because the package is `type:module`) → platform
pre-bundled to `platform/worker.js` (esbuild resolves `jose` etc.; the deploy dir has NO
node_modules) → templates copied in. wrangler is a pinned regular dependency, spawned via
`createRequire(__filename).resolve('wrangler/bin/wrangler.js')`. Setup writes
`~/.config/openquick/platform/{worker.js, wrangler.json}` – wrangler.json is GENERATED from
`wranglerConfig()` in `packages/cli/src/config.ts`; never hand-edit it.

## Rules / gotchas (hard-won – do not relearn these)

1. **wrangler OAuth scopes**: there is no separate R2 scope; R2 management works under the
   workers scopes. R2 just needs one-time enablement on the account (payment method, free tier).
   No DNS-write scope though – DNS records are always manual instructions.
2. **Cache API is a no-op on workers.dev** – don't reach for `caches.default` unless on a
   custom domain. ETag/304 happens in the DO instead.
3. SQLite DO: 2MB/value (hence 1.5MB chunks), 10GB/object, **5GB account-wide on free**.
4. New AI models break silently: always run content through `extractText()` and test new
   model IDs live before adding to the catalog (`curl …/__api/ai/chat -d '{"model":"@cf/…"}'`).
5. flux-2* = multipart input. flux-1/schnell = `{prompt}`.
6. The CLI bin MUST stay `.cjs`; `import.meta.url` dies in the CJS bundle (use `__filename`).
7. Templates and the worker ship inside the npm package – `pnpm --filter openquick build`
   regenerates `packages/cli/{platform,templates,dist}` (all gitignored).
8. Site names: `^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$`, no `__` prefix, reserved list in
   routing.ts. Sites must use RELATIVE asset paths (path-mode serves under `/<site>/`).
9. Compatibility date pinned 2026-06-01 in BOTH packages/platform/wrangler.jsonc and
   `wranglerConfig()` – keep in sync.
10. Pin npm deps to versions ≥7 days old (supply-chain rule; pnpm settings + manual pins).

## How to verify changes (the process that actually works)

1. `pnpm --filter @openquick/platform build && pnpm --filter @openquick/platform test`
   (18 routing unit tests) then `cd packages/cli && node scripts/build.mjs && npx tsc`.
2. Redeploy: `CLOUDFLARE_ACCOUNT_ID=<id> node packages/cli/dist/oquick.cjs setup` (idempotent).
3. Curl the live surface: `/__platform/health`, a site page, `/__api/db/...` CRUD, an AI call.
4. For UI/realtime: `browser-use --profile=Default` against the live URL – post a guestbook
   entry, curl a second entry in, watch it appear without reload (proves WS fan-out).
5. `oquick` (global pnpm link from packages/cli) for hub/CLI smoke tests.

## Roadmap / explicitly out of scope

Next up (user-requested): **org mode** – Cloudflare Access in front of a custom domain; worker
accepts the Access JWT for deploys (no token), identity returns verified emails (jose validation
already scaffolded in `identity()`, needs ACCESS_TEAM_DOMAIN + ACCESS_AUD vars).
Out of scope by philosophy (Quick's "say no"): custom backends, cron, permissions/site owners,
build pipelines, BigQuery analog.
