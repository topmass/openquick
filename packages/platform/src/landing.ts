// The OpenQuick hub – served at the platform root. Drag & drop deploys from
// the browser (no CLI needed), site directory, and a celebration when a site
// goes live. Visual language is an homage to Shopify's Quick: electric indigo,
// grid paper, sticker-style cards, confetti.

export function landingPage(): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>OpenQuick</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link href="https://fonts.googleapis.com/css2?family=Pacifico&display=swap" rel="stylesheet">
<style>
  :root {
    --bg: #5d5bf2;
    --ink: #16132e;
    --card: #fffdf6;
    --accent: #ffd83d;
    --good: #2fd66a;
    --bad: #ff5d5d;
  }
  * { box-sizing: border-box; }
  body {
    margin: 0;
    min-height: 100vh;
    font-family: system-ui, -apple-system, sans-serif;
    color: var(--ink);
    background-color: var(--bg);
    background-image:
      linear-gradient(rgba(255,255,255,.13) 1px, transparent 1px),
      linear-gradient(90deg, rgba(255,255,255,.13) 1px, transparent 1px);
    background-size: 34px 34px;
  }
  main { max-width: 760px; margin: 0 auto; padding: 2.5rem 1.2rem 4rem; }

  .wordmark {
    font-family: 'Pacifico', cursive;
    font-size: clamp(3.2rem, 10vw, 5.4rem);
    text-align: center;
    color: #fff;
    margin: 1.2rem 0 .4rem;
    line-height: 1.3;
    padding-bottom: .35em;
    text-shadow:
      -2px -2px 0 var(--ink), 2px -2px 0 var(--ink), -2px 2px 0 var(--ink), 2px 2px 0 var(--ink),
      4px 4px 0 var(--ink), 7px 7px 0 var(--ink), 10px 10px 0 rgba(22,19,46,.55);
    transform: rotate(-3deg);
  }
  .tag {
    text-align: center;
    color: #fff;
    font-weight: 600;
    margin: 0 0 2rem;
    position: relative;
    z-index: 1;
    text-shadow: 1px 2px 0 rgba(22,19,46,.5);
  }

  .card {
    background: var(--card);
    border: 3px solid var(--ink);
    border-radius: 18px;
    box-shadow: 7px 7px 0 var(--ink);
    padding: 1.1rem 1.3rem;
    margin: 1.2rem 0;
  }

  #drop { text-align: center; padding: 2.4rem 1.3rem; cursor: pointer; transition: transform .12s; }
  #drop.over { transform: scale(1.02); background: #fff7d6; }
  #drop h2 { margin: 0 0 .3rem; font-size: 1.3rem; }
  #drop p { margin: .2rem 0; opacity: .65; font-size: .9em; }

  .row { display: flex; gap: .7rem; align-items: center; flex-wrap: wrap; }
  input[type=text], input[type=password] {
    flex: 1; min-width: 180px;
    font: inherit; font-family: ui-monospace, monospace;
    padding: .55rem .8rem;
    border: 3px solid var(--ink); border-radius: 12px; background: #fff;
  }
  input:focus { outline: 3px solid var(--accent); }
  button {
    font: inherit; font-weight: 700;
    padding: .55rem 1.3rem;
    border: 3px solid var(--ink); border-radius: 12px;
    background: var(--accent); color: var(--ink);
    box-shadow: 4px 4px 0 var(--ink);
    cursor: pointer;
    transition: transform .08s, box-shadow .08s;
  }
  button:hover { transform: translate(-1px,-1px); box-shadow: 5px 5px 0 var(--ink); }
  button:active { transform: translate(3px,3px); box-shadow: 1px 1px 0 var(--ink); }
  button:disabled { opacity: .45; cursor: default; transform: none; box-shadow: 4px 4px 0 var(--ink); }
  button.small { padding: .25rem .7rem; font-size: .82em; box-shadow: 3px 3px 0 var(--ink); }
  button.danger { background: #fff; color: var(--bad); }

  #log { font-family: ui-monospace, monospace; font-size: .82em; white-space: pre-wrap; max-height: 220px; overflow-y: auto; display: none; }
  #live { display: none; text-align: center; }
  #live .url { font-family: ui-monospace, monospace; font-weight: 700; font-size: 1.05em; }
  #live h2 { margin: .2rem 0 .6rem; }
  #live a { color: var(--ink); }

  .muted { opacity: .6; font-size: .85em; }
  h2.section { color: #fff; text-shadow: 1px 2px 0 rgba(22,19,46,.5); margin-top: 2.6rem; }
  .sitegrid { display: grid; grid-template-columns: repeat(auto-fill, minmax(210px, 1fr)); gap: 1rem; }
  .site { padding: .9rem 1rem; margin: 0; }
  .site .name { font-weight: 800; font-size: 1.05em; text-decoration: none; color: var(--ink); display: block; margin-bottom: .15rem; overflow-wrap: anywhere; }
  .site .meta { font-size: .8em; opacity: .6; margin-bottom: .6rem; }
  footer { text-align: center; color: #fff; opacity: .85; margin-top: 3.5rem; font-size: .85em; text-shadow: 1px 1px 0 rgba(22,19,46,.5); }
  footer a { color: #fff; }
  #tokenCard { display: none; }
  .confetti { position: fixed; width: 10px; height: 14px; top: -20px; z-index: 9; pointer-events: none; animation: fall linear forwards; }
  @keyframes fall { to { transform: translateY(105vh) rotate(720deg); opacity: .9; } }
  code { background: rgba(22,19,46,.08); border-radius: 6px; padding: .1em .35em; font-size: .92em; }
</style>
</head>
<body>
<main>
  <h1 class="wordmark">OpenQuick</h1>
  <p class="tag">drop a folder → get a site · database, realtime, files &amp; AI included ⚡</p>

  <div class="card" id="drop">
    <h2>Drop a folder here</h2>
    <p>or individual files – html, css, js, images, video… anything static</p>
    <p class="muted">click to pick a folder instead</p>
    <input type="file" id="dirPick" webkitdirectory multiple hidden>
  </div>

  <div class="card" id="deployCard" style="display:none">
    <div class="row">
      <input type="text" id="site" placeholder="site-name" spellcheck="false">
      <button id="deployBtn">Deploy 🚀</button>
    </div>
    <p class="muted" id="picked"></p>
    <div id="log"></div>
  </div>

  <div class="card" id="tokenCard">
    <b>🔑 One-time unlock</b>
    <p class="muted">Deploys need this account's deploy token. Whoever set up OpenQuick can run
    <code>oquick token</code> and share it with you. It stays in this browser.</p>
    <div class="row">
      <input type="password" id="tokenInput" placeholder="paste deploy token">
      <button id="tokenSave">Save</button>
    </div>
  </div>

  <div class="card" id="live">
    <h2>🎉 Your site is live!</h2>
    <div class="url">👉 <a id="liveUrl" target="_blank"></a> 👈</div>
  </div>

  <h2 class="section">Sites</h2>
  <div class="sitegrid" id="sites"></div>

  <footer>
    an open-source homage to <a href="https://shopify.engineering/quick" target="_blank">Shopify's Quick</a>,
    running entirely on this Cloudflare account ·
    <a href="https://github.com/topmass/openquick" target="_blank">openquick</a>
  </footer>
</main>

<script>
const $ = (id) => document.getElementById(id);
const TOKEN_KEY = 'oq:token';
let pending = [];
let accessMode = false;

// In org mode (Cloudflare Access) your login is the auth – no token needed.
fetch('/__platform/health').then(r => r.json()).then(h => {
  accessMode = !!h.access;
  if (accessMode && h.email) {
    const tag = document.querySelector('.tag');
    tag.textContent = '🔒 ' + h.email + ' · ' + tag.textContent;
  }
}).catch(() => {});

// CLI handoff: oquick opens the hub as /#token=…
if (location.hash.startsWith('#token=')) {
  localStorage.setItem(TOKEN_KEY, location.hash.slice(7));
  history.replaceState(null, '', location.pathname);
}
const token = () => localStorage.getItem(TOKEN_KEY);

const SKIP_DIRS = ['node_modules', '.git', '.wrangler'];
const fmt = (n) => n >= 1048576 ? (n/1048576).toFixed(1)+' MB' : n >= 1024 ? (n/1024).toFixed(1)+' KB' : n+' B';
const validName = (s) => /^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$/.test(s) && !s.startsWith('__');
const slug = (s) => s.toLowerCase().replace(/[^a-z0-9-]+/g,'-').replace(/-+/g,'-').replace(/^-|-$/g,'').slice(0,63);
const log = (line) => { const el = $('log'); el.style.display = 'block'; el.textContent += line + '\\n'; el.scrollTop = el.scrollHeight; };

async function sha256(buf) {
  const d = await crypto.subtle.digest('SHA-256', buf);
  return [...new Uint8Array(d)].map(b => b.toString(16).padStart(2, '0')).join('');
}

async function api(path, init = {}, raw = false) {
  const headers = { authorization: 'Bearer ' + (token() || ''), ...(raw ? {} : { 'content-type': 'application/json' }) };
  const res = await fetch(path, { ...init, headers });
  const data = await res.json().catch(() => ({}));
  if (res.status === 401 && !accessMode) { $('tokenCard').style.display = 'block'; throw new Error('deploy token missing or wrong – unlock below 👇'); }
  if (!res.ok) throw new Error(data.error || ('HTTP ' + res.status));
  return data;
}

// ---- collect files ----
async function walkEntry(entry, prefix, out) {
  if (entry.name.startsWith('.') || entry.name === 'oquick.json') return;
  if (entry.isFile) {
    const file = await new Promise((res, rej) => entry.file(res, rej));
    out.push({ path: prefix + file.name, file });
  } else if (entry.isDirectory && !SKIP_DIRS.includes(entry.name)) {
    const reader = entry.createReader();
    for (;;) {
      const batch = await new Promise((res, rej) => reader.readEntries(res, rej));
      if (!batch.length) break;
      for (const e of batch) await walkEntry(e, prefix + entry.name + '/', out);
    }
  }
}

function setPending(files, suggestedName) {
  pending = files;
  $('deployCard').style.display = files.length ? 'block' : 'none';
  $('live').style.display = 'none';
  $('picked').textContent = files.length
    ? files.length + ' files · ' + fmt(files.reduce((a, f) => a + f.file.size, 0)) + ' — ' + files.slice(0, 5).map(f => f.path).join(', ') + (files.length > 5 ? ', …' : '')
    : '';
  if (suggestedName) $('site').value = slug(suggestedName);
  if (files.length) $('site').focus();
}

const drop = $('drop');
drop.addEventListener('click', () => $('dirPick').click());
drop.addEventListener('dragover', (e) => { e.preventDefault(); drop.classList.add('over'); });
drop.addEventListener('dragleave', () => drop.classList.remove('over'));
drop.addEventListener('drop', async (e) => {
  e.preventDefault();
  drop.classList.remove('over');
  const items = [...e.dataTransfer.items].map(i => i.webkitGetAsEntry && i.webkitGetAsEntry()).filter(Boolean);
  const out = [];
  let name = null;
  if (items.length === 1 && items[0].isDirectory) {
    name = items[0].name;
    const reader = items[0].createReader();
    for (;;) {
      const batch = await new Promise((res, rej) => reader.readEntries(res, rej));
      if (!batch.length) break;
      for (const child of batch) await walkEntry(child, '', out);
    }
  } else {
    for (const entry of items) await walkEntry(entry, '', out);
  }
  setPending(out, name);
});
$('dirPick').addEventListener('change', () => {
  const files = [...$('dirPick').files]
    .map(f => ({ path: f.webkitRelativePath ? f.webkitRelativePath.split('/').slice(1).join('/') : f.name, file: f }))
    .filter(f => f.path && !f.path.split('/').some(p => p.startsWith('.') || SKIP_DIRS.includes(p)) && f.path !== 'oquick.json');
  setPending(files, $('dirPick').files[0]?.webkitRelativePath?.split('/')[0] ?? null);
});

// ---- deploy (the same protocol the CLI speaks) ----
async function deployFiles(files, site) {
  if (!validName(site)) throw new Error('"' + site + '" is not a valid site name (lowercase, digits, hyphens)');
  if (!files.length) throw new Error('no files selected');
  log('hashing ' + files.length + ' files…');
  const manifest = [];
  for (const f of files) {
    f.buf = await f.file.arrayBuffer();
    manifest.push({ path: f.path, hash: await sha256(f.buf), size: f.buf.byteLength, ct: f.file.type || 'application/octet-stream' });
  }
  const start = await api('/__platform/deploy/start', { method: 'POST', body: JSON.stringify({ site, manifest }) });
  const byPath = new Map(files.map((f, i) => [f.path, { f, m: manifest[i] }]));
  for (const item of start.needed) {
    const entry = byPath.get(item.path);
    const q = new URLSearchParams({ site, uploadId: start.uploadId, hash: item.hash });
    if (item.storage === 'r2') { q.set('storage', 'r2'); q.set('ct', entry.m.ct); }
    await api('/__platform/deploy/file?' + q, { method: 'PUT', body: entry.f.buf }, true);
    log('  ↑ ' + item.path + ' (' + fmt(entry.m.size) + (item.storage === 'r2' ? ' → R2' : '') + ')');
  }
  if (start.needed.length < manifest.length) log('  ' + (manifest.length - start.needed.length) + ' unchanged files skipped');
  const commit = await api('/__platform/deploy/commit', { method: 'POST', body: JSON.stringify({ site, uploadId: start.uploadId }) });
  return commit.urls;
}
window.oqDeploy = deployFiles; // for scripting/tests

function confetti() {
  const colors = ['#ffd83d', '#2fd66a', '#ff5d5d', '#5dd4ff', '#ff9d5d', '#f25dff', '#ffffff'];
  for (let i = 0; i < 90; i++) {
    const c = document.createElement('span');
    c.className = 'confetti';
    c.style.left = Math.random() * 100 + 'vw';
    c.style.background = colors[i % colors.length];
    c.style.animationDuration = 1.6 + Math.random() * 1.8 + 's';
    c.style.animationDelay = Math.random() * 0.4 + 's';
    c.style.transform = 'rotate(' + Math.random() * 360 + 'deg)';
    document.body.appendChild(c);
    setTimeout(() => c.remove(), 4200);
  }
}

$('deployBtn').addEventListener('click', async () => {
  const btn = $('deployBtn');
  btn.disabled = true;
  $('log').textContent = '';
  try {
    const urls = await deployFiles(pending, $('site').value.trim());
    const a = $('liveUrl');
    a.href = urls[0];
    a.textContent = urls[0];
    $('live').style.display = 'block';
    confetti();
    loadSites();
  } catch (e) {
    log('✖ ' + e.message);
  } finally {
    btn.disabled = false;
  }
});

$('tokenSave').addEventListener('click', () => {
  const v = $('tokenInput').value.trim();
  if (!v) return;
  localStorage.setItem(TOKEN_KEY, v);
  $('tokenCard').style.display = 'none';
  log('🔑 token saved – hit Deploy again');
});

// ---- site directory ----
async function loadSites() {
  const { sites } = await fetch('/__platform/list').then(r => r.json()).catch(() => ({ sites: [] }));
  const grid = $('sites');
  if (!sites || !sites.length) {
    grid.innerHTML = '<div class="card site"><span class="muted">no sites yet – drop a folder up there 👆</span></div>';
    return;
  }
  grid.innerHTML = sites.map(s =>
    '<div class="card site">' +
    '<a class="name" href="/' + s.name + '/" target="_blank">' + s.name + '</a>' +
    '<div class="meta">' + s.files + ' files · ' + fmt(s.bytes) + '<br>' + new Date(s.updated_at).toLocaleString() + '</div>' +
    '<div class="row"><button class="small" onclick="window.open(\\'/' + s.name + '/\\')">open</button>' +
    '<button class="small danger" data-del="' + s.name + '">delete</button></div></div>'
  ).join('');
  grid.querySelectorAll('button[data-del]').forEach(b => b.addEventListener('click', async () => {
    const site = b.dataset.del;
    if (!confirm('Delete "' + site + '" and all of its data?')) return;
    try {
      await api('/__platform/delete', { method: 'POST', body: JSON.stringify({ site }) });
      loadSites();
    } catch (e) { alert(e.message); }
  }));
}
loadSites();
</script>
</body>
</html>`;
}
