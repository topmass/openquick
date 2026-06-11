# ⚡ OpenQuick

**Drop a folder of HTML, get a URL. Plus a zero-config database, realtime, file uploads and AI – all on your own Cloudflare account, on the free tier.**

OpenQuick is an open-source, self-hosted take on [Quick](https://shopify.engineering/quick), Shopify's internal hosting platform that changed how their teams build and share ("demos over memos"). Shopify runs Quick on a single $200/month VM behind their IAP. OpenQuick gives you the same experience on Cloudflare Workers for $0.

## Get started (2 minutes)

```sh
pnpm add -g openquick      # or: npm i -g openquick
oquick setup               # one-time: deploys the platform to YOUR Cloudflare account
oquick init lunch-poll
cd lunch-poll
oquick deploy              # → https://openquick.<you>.workers.dev/lunch-poll/
```

That's the whole thing. The only requirement is a Cloudflare account – `oquick setup` uses
wrangler (bundled) and opens the browser login if needed. The defaults give you:

- the **hub** at your platform URL – drag & drop deploys from the browser, site directory
- public sites (anyone with a URL can view), **token-gated deploys** (only you can publish)
- AI, database, realtime and file APIs on every site, rate-limited inside the free tier

Tune the install with flags, at setup time or any time later (re-running is safe):

```sh
oquick setup --no-hub        # no hub page – sites only ("--hub" brings it back)
oquick setup --private       # org mode: require Cloudflare Access logins for EVERYTHING
                             # (guided one-time setup: oquick auth enable)
oquick models                # pick different default AI models from a list
oquick domain add quick.you.com   # pretty URLs on your own domain
```

**Org mode** (`oquick auth enable`) is the full Shopify-Quick experience: everything behind a
login (free ≤50 users via Cloudflare Zero Trust), teammates deploy from the hub with no token,
and `quick.id()` returns verified emails. Needs a custom domain; `oquick auth enable` walks
you through the two dashboard steps. `oquick auth disable` reopens the platform.

## What every site gets

Include one script tag and `window.quick` is your backend:

```html
<script src="__quick.js"></script>
```

```js
// Firebase-style JSON database, namespaced per site
const posts = quick.db.collection('posts');
const doc = await posts.create({ title: 'Hello Quick DB' });
await posts.update(doc.id, { status: 'published' });
const all = await posts.list({ order: 'desc' });

// Realtime: changes sync to every connected client
posts.subscribe({
  onCreate: (doc) => console.log('new:', doc),
  onUpdate: (doc) => console.log('changed:', doc),
  onDelete: (id) => console.log('gone:', id),
});

// Multiplayer channels with presence
const room = quick.channel('lobby');
room.send({ cursor: [x, y] });
room.on('message', (data, from) => { ... });

// File uploads
const { url } = await quick.files.upload(file);

// AI – Workers AI on your account, zero API keys in the client
const text = await quick.ai.chat('haiku about deploys');
const { url: img } = await quick.ai.image('a watercolor fox');

// Identity
const me = await quick.id();   // stable anonymous id (+ email behind Cloudflare Access)
```

No schemas, no migrations, no API keys, no per-site provisioning. `oquick init` also drops an
`AGENTS.md`/`CLAUDE.md` with the full API reference, so any coding agent can build sites
out of the box – same trick as Quick's `quick init`.

## How it works

Shopify's Quick is NGINX + a GCS bucket + one small API server + one database. OpenQuick is the
same idea translated to Cloudflare primitives, needing nothing beyond a normal `wrangler login`:

| Quick (Shopify)                | OpenQuick (your Cloudflare account)            |
| ------------------------------ | ---------------------------------------------- |
| NGINX + GCS bucket + gcsfuse   | one Worker serving assets from SQLite          |
| small node/Go API server       | the same Worker, `/__api/*`                    |
| CloudSQL "big JSON store"      | one **Durable Object per site** (SQLite)       |
| big files in the bucket        | shared R2 bucket, folder per site (automatic)  |
| websockets                     | the same DO, hibernating WebSockets            |
| AI proxy, keys on the server   | Workers AI binding                             |
| IAP identity                   | anonymous ids, or Cloudflare Access (optional) |
| `quick deploy` (rsync wrapper) | `oquick deploy` (hash-diff upload, FTP feel)   |
| $200/month VM                  | $0 (free tier) / $5 Workers Paid               |

Each site is one Durable Object: its files, documents, uploads and live websocket connections
all live together – "namespace per site", exactly like Quick's data model. Deploys are atomic
(a manifest swap in one transaction) and diffed (unchanged files never re-upload).

**Big files spill to R2 automatically.** Files over 5 MB skip SQLite and land in a shared R2
bucket under the site's folder (`sites/<site>/…`) – Shopify's exact bucket-of-folders layout –
raising the per-file cap from 25 MB to ~95 MB with zero configuration. Setup creates the bucket
if the account has R2 enabled (free 10 GB tier, one-time enable in the dashboard); without it,
everything still works with the 25 MB cap. `oquick delete` removes the site's R2 folder along
with its Durable Object.

## URL modes

1. **workers.dev (default, zero config):** `https://openquick.<you>.workers.dev/<site>/`
2. **Your domain, path mode (free):** `oquick domain add quick.yourdomain.com` →
   `https://quick.yourdomain.com/<site>/` – needs one proxied DNS record (the CLI walks you through it).
3. **Wildcard subdomains (the true Quick feel):** `oquick domain add quick.yourdomain.com --wildcard` →
   `https://<site>.quick.yourdomain.com/`. Note: Universal SSL only covers one subdomain level –
   use a dedicated zone (`*.myquicksites.com` is free) or Advanced Certificate Manager for
   second-level wildcards.

## Commands

```
oquick                                  open your hub: drag & drop a folder, get a URL
oquick .                                deploy the current folder (any dir path works)
oquick setup                            provision/upgrade the platform worker
oquick init [name]                      scaffold a site + agent docs
oquick deploy [dir] [--name x]          deploy a folder (diff upload) → URL
oquick list                             all sites with size + last deploy
oquick open <site>                      open in browser
oquick delete <site> [-y]               delete a site and all its data
oquick token                            print the deploy token (for hub teammates)
oquick dev [dir] [--port 4400]          local server against the real deployed API
oquick domain add|list|remove           custom domains
```

## The hub

The platform's root URL **is** a deploy surface: a Quick-style hub where anyone you choose can
drag & drop a folder and get a site – no CLI, no node, nothing installed. It shows every site
on the platform, celebrates fresh deploys with confetti, and deletes sites too.

Sharing it: run `oquick token`, send a teammate the hub URL + token, they paste it once
(it stays in their browser's localStorage). Deploys and deletes require the token; browsing
sites doesn't. `oquick` opens the hub with your token handed over automatically via the URL
fragment (fragments never leave the browser).

**Roadmap – org mode:** Cloudflare Access in front of the hub + sites (free ≤50 users), so
anyone on the Cloudflare account just logs in with their identity provider and deploys from
the hub with no token at all – the full IAP-style Quick experience.

## What can you deploy?

Anything static – a file is just bytes served back with the right content type. HTML, CSS, JS,
images (png/jpg/webp/avif/svg/gif), video and audio (mp4/webm/mp3 – big files get Range support,
so seeking works), fonts, JSON, WASM, PDFs. Unknown extensions download as files; source files
like `.py` serve as readable plain text.

What does **not** work: anything that needs a server to execute. A Python script, PHP file, or
Express app will upload and be *served*, but nothing runs it – there is no server runtime by
design. The backend is exclusively the `quick.js` APIs (db, realtime, files, AI, channels).
Client-side code is the loophole: JS and WASM run in the browser, so even Python works if you
load it with [Pyodide](https://pyodide.org).

## Security model (read this)

Quick works because it sits behind Shopify's identity proxy – everything is trusted. Your
OpenQuick is on the public internet, so the defaults differ:

- **Deploys/deletes require a bearer token**, generated at setup, stored in
  `~/.config/openquick/config.json` and as a Worker secret. Only you can publish sites.
- **Site APIs (db/files/ai/channels) are open** to anyone who has a site's URL – that's the
  zero-config magic, same trade Quick makes. Guardrails: per-visitor daily rate limits
  (AI is limited hardest), per-site caps, and cross-origin calls are blocked.
- Don't put secrets in documents; don't treat the db as private.
- **Private mode (optional):** put Cloudflare Access (free up to 50 users) in front of a custom
  domain and set `ACCESS_TEAM_DOMAIN` + `ACCESS_AUD` vars on the worker – then sites are
  IAP-protected exactly like Shopify's, and `quick.id()` returns verified emails.

## AI: models, free usage, and caps

Every Cloudflare account – free **and** paid – gets **10,000 free Workers AI neurons per day**.
On the free plan AI simply stops when they're spent (no bill possible); on Workers Paid,
overage costs $0.011/1k neurons, so OpenQuick adds account-wide ceilings (below) to keep the
worst case at pocket change.

Sites pick models per call with an alias or any full catalog id; the platform owner picks the
quick-wide defaults from a curated list of recent models with **`oquick models`**:

| alias     | model                                   | ≈ free calls/day* |
| --------- | --------------------------------------- | ----------------- |
| (default) | `@cf/google/gemma-4-26b-a4b-it`         | ~580              |
| `fast`    | `@cf/zai-org/glm-4.7-flash`             | ~610              |
| `best`    | `@cf/moonshotai/kimi-k2.6`              | ~50               |
| image     | `@cf/black-forest-labs/flux-2-klein-4b` | ~90 images        |

*at ~1k input + 300 output tokens per call (or one 1024px image), within the daily 10k free
neurons. The list also includes Qwen3 30B (~700/day, the cheapest), Nemotron 3 120B, the
gpt-oss pair and FLUX.1 Schnell / FLUX.2 Klein 9B for images – `oquick models chat <n>` /
`oquick models image <n>` switches the default and redeploys.

Caps are merged over sensible defaults:

```sh
oquick setup --limits '{"ai_chat_platform_site":5000,"ai_chat_ip":250}'
```

Default caps: 100 chat + 30 image calls per visitor/day, 1000 + 300 per site/day,
**2000 chat + 300 images account-wide/day** (the drain guard – ≈$1–2/day worst case on paid,
$0 on free). The `MODELS` var can also remap the `fast`/`best` aliases.

## Limits (Cloudflare free plan)

- 100k requests/day to the worker and 100k DO requests/day (an asset hit costs one of each)
- 5 GB total DO storage across all sites + 10 GB free R2; 95 MB max per file (25 MB without R2);
  256 KB per document
- Workers AI free allocation: 10k neurons/day
- All caps reset daily; `$5/mo Workers Paid` raises them to 10M+ requests and unlimited storage

Heavy traffic to one site? Workers Paid + a custom domain (which enables edge caching) is the
upgrade path.

## Repo layout

```
packages/platform   the Worker + SiteDO (Durable Object) – the entire backend
packages/sdk        quick.js, the browser SDK (served by the worker at /__quick.js)
packages/cli        oquick – setup, deploy, domains, dev server
templates/          what `oquick init` scaffolds (incl. agent docs)
examples/guestbook  realtime guestbook with AI – try `oquick deploy examples/guestbook`
```

## Non-goals

Per Quick's philosophy ("we've gotten really good at saying no… the constraints are the whole
point"): no custom backends, no cron jobs, no permissions/site owners, no build pipelines.
Compose the primitives instead.

## Credits

Inspired by [Quick: An internal hosting platform for the AI era](https://shopify.engineering/quick)
by Daniel Beauchamp & Alex Pilon, and Daniel's
[thread](https://x.com/pushmatrix/status/2064722585019969727) on how a folder of files, a
lightweight API and some trust changed how Shopify builds. MIT licensed; not affiliated with
Shopify or Cloudflare.
