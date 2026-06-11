# ⚡ OpenQuick

**Drop a folder of HTML, get a URL. Plus a zero-config database, realtime, file uploads and AI – all on your own Cloudflare account, on the free tier.**

OpenQuick is an open-source, self-hosted take on [Quick](https://shopify.engineering/quick), Shopify's internal hosting platform that changed how their teams build and share ("demos over memos"). Shopify runs Quick on a single $200/month VM behind their IAP. OpenQuick gives you the same experience on Cloudflare Workers for $0.

```sh
pnpm add -g openquick      # or: npm i -g openquick
oquick setup               # one-time: deploys the platform to YOUR Cloudflare account
oquick init lunch-poll
cd lunch-poll
oquick deploy              # → https://openquick.<you>.workers.dev/lunch-poll/
```

The only requirement is a Cloudflare account. `oquick setup` uses wrangler (bundled) – if you're not logged in it opens the browser login for you.

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
same idea translated to Cloudflare primitives – chosen so that **everything fits in the default
wrangler OAuth scopes** (no R2, no DNS writes needed):

| Quick (Shopify)                | OpenQuick (your Cloudflare account)            |
| ------------------------------ | ---------------------------------------------- |
| NGINX + GCS bucket + gcsfuse   | one Worker serving assets from SQLite          |
| small node/Go API server       | the same Worker, `/__api/*`                    |
| CloudSQL "big JSON store"      | one **Durable Object per site** (SQLite)       |
| websockets                     | the same DO, hibernating WebSockets            |
| AI proxy, keys on the server   | Workers AI binding                             |
| IAP identity                   | anonymous ids, or Cloudflare Access (optional) |
| `quick deploy` (rsync wrapper) | `oquick deploy` (hash-diff upload, FTP feel)   |
| $200/month VM                  | $0 (free tier) / $5 Workers Paid               |

Each site is one Durable Object: its files, documents, uploads and live websocket connections
all live together – "namespace per site", exactly like Quick's data model. Deploys are atomic
(a manifest swap in one transaction) and diffed (unchanged files never re-upload).

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
oquick setup                            provision/upgrade the platform worker
oquick init [name]                      scaffold a site + agent docs
oquick deploy [dir] [--name x]          deploy a folder (diff upload) → URL
oquick list                             all sites with size + last deploy
oquick open <site>                      open in browser
oquick delete <site> [-y]               delete a site and all its data
oquick dev [dir] [--port 4400]          local server against the real deployed API
oquick domain add|list|remove           custom domains
```

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

## Limits (Cloudflare free plan)

- 100k requests/day to the worker and 100k DO requests/day (an asset hit costs one of each)
- 5 GB total storage across all sites; 25 MB max per file; 256 KB per document
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
