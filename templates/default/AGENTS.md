# __SITE_NAME__ – an OpenQuick site

This folder is a static website deployed with `oquick deploy` (run it from this directory).
It is served at: __SITE_URL__

OpenQuick sites are plain HTML/CSS/JS – no build step, no framework required, no server code.
Backend functionality (database, realtime, files, AI) comes from the zero-config `quick.js` API.

## Rules

- **Use relative URLs** for every asset and link (`css/app.css`, not `/css/app.css`). Sites can be
  served under a path prefix, so absolute paths break.
- `index.html` is the entry point. `404.html` (optional) is served for missing paths.
- No server-side code. Everything runs in the browser; `quick.js` is the backend.
- Files up to 95 MB each (25 MB if the platform has no R2 bucket; big files spill to R2
  automatically – no configuration needed). Don't commit `node_modules`; there is no npm here.
- Anyone with the URL can read this site and write to its database. Don't store secrets.

## The quick.js API

Include it once (note: relative path, no leading slash):

```html
<script src="__quick.js"></script>
```

Then `window.quick` provides:

### Database – Firebase-style JSON document store, namespaced to this site

```js
const posts = quick.db.collection('posts');

const doc = await posts.create({ title: 'Hello', votes: 0 });   // → {id, createdAt, updatedAt, ...}
const one = await posts.get(doc.id);
const all = await posts.list({ limit: 100, order: 'desc' });     // newest first
const some = await posts.list({ filter: { title: 'Hello' } });   // equality filters
await posts.update(doc.id, { votes: 1 });                        // shallow merge
await posts.delete(doc.id);
```

Documents are arbitrary JSON objects (max 256 KB each). `id`, `createdAt`, `updatedAt` are
reserved. Pass your own `id` to `create` for fixed keys (e.g. `{ id: 'settings', theme: 'dark' }`).

### Realtime – live updates over websockets

```js
const unsubscribe = posts.subscribe({
  onCreate: (doc) => console.log('new', doc),
  onUpdate: (doc) => console.log('changed', doc),
  onDelete: (id) => console.log('gone', id),
});
```

Events fire for every client, including the one that made the change.

### Channels – multiplayer pub/sub with presence

```js
const room = quick.channel('lobby');
room.send({ x: 10, y: 20 });                          // broadcast to everyone else
room.on('message', (data, from) => { /* from = {cid, name} */ });
room.on('presence', ({ ev, who, members }) => { /* ev: 'you' | 'join' | 'leave' */ });
room.leave();
```

### Files

```js
const { url } = await quick.files.upload(fileInput.files[0]);   // → permanent URL
```

### AI – served by Workers AI on this Cloudflare account, no API keys

```js
const text = await quick.ai.chat('Summarize this in one line: …');
const text2 = await quick.ai.chat([{ role: 'user', content: 'hi' }], { system: 'Be terse.' });
await quick.ai.chat('Tell a story', { onToken: (t) => out.append(t) });   // streaming
const { url } = await quick.ai.image('a watercolor fox');                  // generated image
```

AI calls are rate-limited per visitor per day – handle errors gracefully.

### Identity

```js
const me = await quick.id();      // { id, name } – stable anonymous id per browser
quick.id.setName('Matt');         // shown to others in channels/presence
```

`me.email` is set only when the platform runs behind Cloudflare Access.

## Deploying

```sh
oquick deploy          # from this directory – prints the live URL
```

Deploys are diffs – only changed files upload. Redeploying overwrites the site.
