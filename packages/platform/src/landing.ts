export function landingPage(host: string): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>OpenQuick</title>
<style>
  :root { color-scheme: light dark; }
  body { font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; max-width: 720px; margin: 3rem auto; padding: 0 1rem; line-height: 1.6; }
  h1 { font-size: 1.6rem; } h1 span { opacity: .5; }
  code, pre { background: rgba(125,125,125,.12); border-radius: 6px; padding: .15em .4em; }
  pre { padding: .8em 1em; overflow-x: auto; }
  table { border-collapse: collapse; width: 100%; margin-top: 1rem; }
  td, th { text-align: left; padding: .35em .6em; border-bottom: 1px solid rgba(125,125,125,.25); }
  a { color: inherit; }
  .muted { opacity: .55; font-size: .85em; }
</style>
</head>
<body>
<h1>⚡ OpenQuick <span>is running</span></h1>
<p>Drop a folder of HTML, get a site. Zero-config database, files, AI and websockets included.</p>
<pre>oquick init mysite
cd mysite
oquick deploy   →  https://${host}/mysite/</pre>
<h2>Sites</h2>
<table id="sites"><tr><td class="muted">loading…</td></tr></table>
<p class="muted">An open-source take on Shopify's internal Quick platform, running entirely on this Cloudflare account.
<a href="https://github.com/openquick/openquick">openquick</a> · inspired by <a href="https://shopify.engineering/quick">shopify.engineering/quick</a></p>
<script>
fetch('/__platform/list').then(r => r.json()).then(({ sites }) => {
  const t = document.getElementById('sites');
  if (!sites || !sites.length) { t.innerHTML = '<tr><td class="muted">no sites yet</td></tr>'; return; }
  const fmt = (n) => n > 1048576 ? (n/1048576).toFixed(1) + ' MB' : (n/1024).toFixed(1) + ' KB';
  t.innerHTML = '<tr><th>site</th><th>files</th><th>size</th><th>updated</th></tr>' + sites.map(s =>
    '<tr><td><a href="/' + s.name + '/">' + s.name + '</a></td><td>' + s.files + '</td><td>' +
    fmt(s.bytes) + '</td><td class="muted">' + new Date(s.updated_at).toLocaleString() + '</td></tr>'
  ).join('');
});
</script>
</body>
</html>`;
}
