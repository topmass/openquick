export const UI_HTML = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>OpenQuick</title>
<style>
  :root { color-scheme: light dark; }
  body { font-family: system-ui, sans-serif; max-width: 680px; margin: 2.5rem auto; padding: 0 1rem; line-height: 1.55; }
  h1 { font-size: 1.5rem; display: flex; align-items: baseline; gap: .5rem; }
  h1 small { font-size: .55em; opacity: .5; font-weight: normal; }
  #drop { border: 2px dashed rgba(125,125,125,.5); border-radius: 14px; padding: 2.2rem 1rem; text-align: center; cursor: pointer; transition: all .15s; margin: 1rem 0; }
  #drop.over { border-color: #8b5cf6; background: rgba(139,92,246,.08); }
  #drop p { margin: .3rem 0; } #drop .muted { opacity: .5; font-size: .85em; }
  .row { display: flex; gap: .5rem; align-items: center; margin: .8rem 0; }
  input[type=text] { flex: 1; padding: .5rem .7rem; border-radius: 8px; border: 1px solid rgba(125,125,125,.4); font: inherit; background: transparent; }
  button { padding: .5rem 1rem; border-radius: 8px; border: none; background: #6d28d9; color: #fff; font: inherit; cursor: pointer; }
  button:disabled { opacity: .45; cursor: default; }
  button.danger { background: transparent; color: #ef4444; border: 1px solid rgba(239,68,68,.4); padding: .25rem .6rem; font-size: .85em; }
  #log { font-family: ui-monospace, monospace; font-size: .82em; white-space: pre-wrap; background: rgba(125,125,125,.1); border-radius: 10px; padding: .7rem .9rem; margin: .8rem 0; display: none; max-height: 240px; overflow-y: auto; }
  #result { display: none; padding: .7rem .9rem; border-radius: 10px; background: rgba(34,197,94,.12); margin: .8rem 0; }
  #result a { font-weight: 700; }
  table { border-collapse: collapse; width: 100%; margin-top: .6rem; }
  td, th { text-align: left; padding: .35em .5em; border-bottom: 1px solid rgba(125,125,125,.22); font-size: .92em; }
  .muted { opacity: .55; font-size: .85em; }
</style>
</head>
<body>
<h1>⚡ OpenQuick <small id="platform"></small></h1>

<div id="drop">
  <p><b>Drop a folder here</b> (or individual files)</p>
  <p class="muted">html, css, js, images, video, fonts… anything static. Click to pick a folder instead.</p>
  <input type="file" id="dirPick" webkitdirectory multiple hidden>
</div>

<div class="row">
  <label for="site">Site name</label>
  <input type="text" id="site" placeholder="my-site" spellcheck="false">
  <button id="deployBtn" disabled>Deploy</button>
</div>
<div class="muted" id="picked"></div>
<div id="log"></div>
<div id="result"></div>

<h2 style="font-size:1.1rem">Sites</h2>
<table id="sites"><tr><td class="muted">loading…</td></tr></table>

<script>
const $ = (id) => document.getElementById(id);
let pending = [];   // [{path, file}]
let platformUrl = '';

const SKIP_DIRS = ['node_modules', '.git', '.wrangler'];
const fmt = (n) => n >= 1048576 ? (n/1048576).toFixed(1)+' MB' : n >= 1024 ? (n/1024).toFixed(1)+' KB' : n+' B';
const validName = (s) => /^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$/.test(s) && !s.startsWith('__');
const slug = (s) => s.toLowerCase().replace(/[^a-z0-9-]+/g,'-').replace(/-+/g,'-').replace(/^-|-$/g,'').slice(0,63);

async function sha256(buf) {
  const d = await crypto.subtle.digest('SHA-256', buf);
  return [...new Uint8Array(d)].map(b => b.toString(16).padStart(2, '0')).join('');
}

function log(line) { const el = $('log'); el.style.display = 'block'; el.textContent += line + '\\n'; el.scrollTop = el.scrollHeight; }

// ---- collecting files (drag & drop with folder traversal, or picker) ----
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
  $('picked').textContent = files.length
    ? files.length + ' files, ' + fmt(files.reduce((a, f) => a + f.file.size, 0)) + ' – ' + files.slice(0, 6).map(f => f.path).join(', ') + (files.length > 6 ? ', …' : '')
    : '';
  if (suggestedName && !$('site').value) $('site').value = slug(suggestedName);
  $('deployBtn').disabled = !files.length;
}

const drop = $('drop');
drop.addEventListener('click', () => $('dirPick').click());
drop.addEventListener('dragover', (e) => { e.preventDefault(); drop.classList.add('over'); });
drop.addEventListener('dragleave', () => drop.classList.remove('over'));
drop.addEventListener('drop', async (e) => {
  e.preventDefault();
  drop.classList.remove('over');
  const items = [...e.dataTransfer.items].map(i => i.webkitGetAsEntry()).filter(Boolean);
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
  const name = $('dirPick').files[0]?.webkitRelativePath?.split('/')[0] ?? null;
  setPending(files, name);
});

// ---- deploy (same protocol as the CLI, proxied through the local server) ----
async function deployFiles(files, site) {
  if (!validName(site)) throw new Error('"' + site + '" is not a valid site name (lowercase, digits, hyphens)');
  if (!files.length) throw new Error('no files to deploy');
  log('hashing ' + files.length + ' files…');
  const manifest = [];
  for (const f of files) {
    f.buf = await f.file.arrayBuffer();
    manifest.push({ path: f.path, hash: await sha256(f.buf), size: f.buf.byteLength, ct: f.file.type || 'application/octet-stream' });
  }
  const start = await jfetch('/api/deploy/start', { method: 'POST', body: JSON.stringify({ site, manifest }) });
  const byPath = new Map(files.map((f, i) => [f.path, { f, m: manifest[i] }]));
  for (const item of start.needed) {
    const entry = byPath.get(item.path);
    const q = new URLSearchParams({ site, uploadId: start.uploadId, hash: item.hash });
    if (item.storage === 'r2') { q.set('storage', 'r2'); q.set('ct', entry.m.ct); }
    await jfetch('/api/deploy/file?' + q, { method: 'PUT', body: entry.f.buf, raw: true });
    log('  ↑ ' + item.path + ' (' + fmt(entry.m.size) + (item.storage === 'r2' ? ' → R2' : '') + ')');
  }
  if (start.needed.length < manifest.length) log('  ' + (manifest.length - start.needed.length) + ' unchanged files skipped');
  const commit = await jfetch('/api/deploy/commit', { method: 'POST', body: JSON.stringify({ site, uploadId: start.uploadId }) });
  return commit.urls;
}
window.oqDeploy = deployFiles; // exposed for scripted testing

async function jfetch(path, init = {}) {
  const headers = init.raw ? {} : { 'content-type': 'application/json' };
  const res = await fetch(path, { ...init, headers });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || ('HTTP ' + res.status));
  return data;
}

$('deployBtn').addEventListener('click', async () => {
  const btn = $('deployBtn');
  btn.disabled = true;
  $('log').textContent = '';
  $('result').style.display = 'none';
  try {
    const urls = await deployFiles(pending, $('site').value.trim());
    $('result').style.display = 'block';
    $('result').innerHTML = '✔ live at ' + urls.map(u => '<a href="' + u + '" target="_blank">' + u + '</a>').join(' · ');
    loadSites();
  } catch (e) {
    log('✖ ' + e.message);
  } finally {
    btn.disabled = !pending.length;
  }
});

// ---- site list ----
async function loadSites() {
  const { platformUrl: p, sites } = await jfetch('/api/info');
  platformUrl = p;
  $('platform').textContent = p.replace('https://', '');
  const t = $('sites');
  if (!sites.length) { t.innerHTML = '<tr><td class="muted">no sites yet</td></tr>'; return; }
  t.innerHTML = '<tr><th>site</th><th>files</th><th>size</th><th>updated</th><th></th></tr>' + sites.map(s =>
    '<tr><td><a href="' + platformUrl + '/' + s.name + '/" target="_blank">' + s.name + '</a></td>' +
    '<td>' + s.files + '</td><td>' + fmt(s.bytes) + '</td>' +
    '<td class="muted">' + new Date(s.updated_at).toLocaleString() + '</td>' +
    '<td><button class="danger" data-site="' + s.name + '">delete</button></td></tr>').join('');
  t.querySelectorAll('button[data-site]').forEach(b => b.addEventListener('click', async () => {
    const site = b.dataset.site;
    if (!confirm('Delete "' + site + '" and all of its data?')) return;
    await jfetch('/api/delete', { method: 'POST', body: JSON.stringify({ site }) });
    loadSites();
  }));
}
loadSites();
</script>
</body>
</html>`;
