// Livery Wizard renderer + local API (mod-folder install, local-only Stable Diffusion proxy).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const R = require('../public/livery/livery-render');
const { handleLivery, safeZipName, localSdUrl } = require('../src/apiLivery');

// A 2D context that records every call, so drawing can be checked without a browser.
function recorder() {
  const calls = [];
  const gradient = () => Object.defineProperty({ gradient: true }, 'addColorStop', { value: (...a) => calls.push(['stop', ...a]) });
  const ctx = new Proxy({}, {
    get(t, k) {
      if (k === 'calls') return calls;
      if (k === 'createLinearGradient' || k === 'createRadialGradient') return (...a) => { calls.push([k, ...a]); return gradient(); };
      if (k in t) return t[k];
      return (...a) => calls.push([k, ...a]);
    },
    set(t, k, v) { t[k] = v; calls.push(['set', k, v]); return true; }
  });
  return ctx;
}

test('layers are created with defaults and unique ids, and copies get new ids', () => {
  const a = R.makeLayer('text'), b = R.makeLayer('text', { ...a, id: undefined, text: 'B' });
  assert.equal(a.type, 'text'); assert.equal(a.text, 'KAW'); assert.ok(a.id && b.id && a.id !== b.id);
  assert.equal(b.text, 'B');
  assert.equal(R.makeLayer('stripe', { type: 'text' }).type, 'stripe', 'type cannot be overridden');
  assert.throws(() => R.makeLayer('script'), /Unknown layer type/);
});

test('loaded designs are cleaned: unknown layers dropped, colours/numbers/images checked', () => {
  const d = R.normalizeDesign({ layers: [
    { type: 'fill', c1: 'red', opacity: 7, blend: 'evil' },
    { type: 'nope' },
    { type: 'image', src: 'javascript:alert(1)' },
    { type: 'image', src: 'data:image/png;base64,AAAA' },
    { type: 'pattern', kind: 'unknown', scale: 99 },
    { type: 'text', text: 'x'.repeat(500), font: 'Comic<script>' },
    { type: 'stripe', count: 99 }
  ] });
  assert.equal(d.layers.length, 6);
  const [fill, bad, good, pat, txt, stripe] = d.layers;
  assert.equal(fill.c1, '#1f4fbf'); assert.equal(fill.opacity, 1); assert.equal(fill.blend, 'source-over');
  assert.equal(bad.src, ''); assert.equal(good.src, 'data:image/png;base64,AAAA');
  assert.equal(pat.kind, 'camo'); assert.equal(pat.scale, 1);
  assert.equal(txt.text.length, 80); assert.equal(txt.font, 'Arial Black');
  assert.equal(stripe.count, 12);
  assert.equal(R.normalizeDesign({ layers: Array.from({ length: 100 }, () => ({ type: 'fill' })) }).layers.length, 64);
});

test('rendering is resolution-independent and patterns are repeatable', () => {
  const design = { layers: [R.makeLayer('fill', { mode: 'linear' }), R.makeLayer('stripe', { x: 0.25, y: 0.5, width: 0.1, length: 0.5 }), R.makeLayer('text', { x: 0.5, y: 0.75, size: 0.1 }), R.makeLayer('pattern', { kind: 'checker', visible: false })] };
  const small = recorder(), big = recorder();
  R.render(small, design, 100, 100); R.render(big, design, 4000, 4000);
  const pick = (c, k) => c.calls.filter(x => x[0] === k);
  assert.deepEqual(pick(small, 'translate')[0], ['translate', 25, 50]);
  assert.deepEqual(pick(big, 'translate')[0], ['translate', 1000, 2000], 'stripe lands at the same relative place');
  assert.deepEqual(pick(big, 'fillText')[0].slice(1), ['KAW', 0, 0]);
  assert.ok(big.calls.some(x => x[0] === 'set' && x[1] === 'font' && /400px/.test(x[2])), 'text size scales with the texture');
  assert.equal(pick(big, 'fillRect').length, 2, 'hidden pattern layer is skipped');
  for (const kind of R.PATTERNS) {
    const l = R.makeLayer('pattern', { kind, seed: 42 }), c1 = recorder(), c2 = recorder(), c3 = recorder();
    R.drawLayer(c1, l, 512, 256); R.drawLayer(c2, l, 512, 256); R.drawLayer(c3, { ...l, seed: 43 }, 512, 256);
    assert.ok(c1.calls.length > 5, `${kind} draws something`);
    assert.deepEqual(c1.calls, c2.calls, `${kind} is repeatable`);
    if (kind === 'camo' || kind === 'flames') assert.notDeepEqual(c1.calls, c3.calls, `${kind} changes with the variation number`);
  }
  // Selection bounds for movable layers only.
  assert.equal(R.bounds(R.makeLayer('fill'), 100, 100), null);
  assert.deepEqual(R.bounds(R.makeLayer('stripe', { x: 0.2, y: 0.3, width: 0.1, gap: 0, count: 1, length: 0.4, angle: 0 }), 100, 100), { x: 0.2, y: 0.3, w: 0.4, h: 0.1, angle: 0 });
});

test('mod names are plain file names and Stable Diffusion must be on this PC', () => {
  assert.equal(safeZipName('KAW Flames'), 'KAW Flames.zip');
  assert.equal(safeZipName('../../Windows/evil.zip'), 'Windowsevil.zip');
  assert.equal(safeZipName('..'), null);
  assert.equal(safeZipName(''), null);
  assert.equal(localSdUrl('http://127.0.0.1:7860/'), 'http://127.0.0.1:7860');
  assert.equal(localSdUrl('http://localhost:7861'), 'http://localhost:7861');
  assert.equal(localSdUrl('http://192.168.1.20:7860'), null);
  assert.equal(localSdUrl('https://api.example.com'), null);
  assert.equal(localSdUrl('file:///etc/passwd'), null);
});

function serve(handler) {
  return new Promise(r => { const s = http.createServer(handler); s.listen(0, '127.0.0.1', () => r(s)); });
}

test('install saves only ZIPs into the mod folder, refuses overwrite unless asked, and is local-only', async () => {
  const modDir = fs.mkdtempSync(path.join(os.tmpdir(), 'kaw-livery-'));
  const server = await serve((req, res) => handleLivery(req, res, new URL(req.url, `http://${req.headers.host}`), { modDir }).then(r => { if (r === false) { res.statusCode = 404; res.end(); } }));
  const base = `http://127.0.0.1:${server.address().port}`;
  const zip = Buffer.concat([Buffer.from('504b0304', 'hex'), Buffer.alloc(100, 1)]);
  const post = (q, body, type = 'application/zip', headers = {}) => fetch(`${base}/api/livery/install?${q}`, { method: 'POST', headers: { 'content-type': type, ...headers }, body }).then(async r => ({ status: r.status, ...(await r.json()) }));
  try {
    let r = await post('name=KAW%20Flames', zip);
    assert.equal(r.ok, true); assert.equal(r.path, path.join(modDir, 'KAW Flames.zip')); assert.equal(fs.readFileSync(r.path).length, 104);
    r = await post('name=KAW%20Flames', zip); assert.equal(r.ok, false); assert.match(r.error, /already exists/);
    r = await post('name=KAW%20Flames&overwrite=1', Buffer.concat([zip, zip])); assert.equal(r.ok, true); assert.equal(fs.readFileSync(r.path).length, 208);
    r = await post('name=bad', Buffer.from('<html>')); assert.equal(r.ok, false); assert.match(r.error, /not a ZIP/);
    r = await post('name=..%2F..%2Fescape', zip); assert.equal(r.ok, true); assert.equal(path.dirname(r.path), modDir, 'never writes outside the mod folder');
    r = await post('name=x', zip, 'text/plain'); assert.equal(r.status, 415);
    r = await post('name=x', zip, 'application/zip', { origin: 'http://evil.example' }); assert.equal(r.status, 403, 'cross-site pages are refused');
    assert.deepEqual(fs.readdirSync(modDir).sort(), ['KAW Flames.zip', 'escape.zip'], 'no temp files or rejected uploads left behind');
    const s = await fetch(`${base}/api/livery/status`).then(x => x.json());
    assert.equal(s.modDir, modDir); assert.equal(s.modDirExists, true);
  } finally { server.close(); }
});

test('the AI pattern proxy forwards to local Stable Diffusion and reports when it is offline', async () => {
  let seen = null;
  const sd = await serve((req, res) => {
    let b = ''; req.on('data', c => b += c); req.on('end', () => {
      if (req.url === '/sdapi/v1/options') return res.end('{}');
      seen = { url: req.url, body: JSON.parse(b) }; res.setHeader('content-type', 'application/json'); res.end(JSON.stringify({ images: ['iVBORw0KGgo='] }));
    });
  });
  const sdUrl = `http://127.0.0.1:${sd.address().port}`;
  let config = { livery: { sdUrl } };
  const server = await serve((req, res) => handleLivery(req, res, new URL(req.url, `http://${req.headers.host}`), { modDir: os.tmpdir(), config }));
  const base = `http://127.0.0.1:${server.address().port}`;
  const gen = body => fetch(`${base}/api/livery/sd`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }).then(r => r.json());
  try {
    assert.equal((await fetch(`${base}/api/livery/status`).then(r => r.json())).sd.reachable, true);
    const r = await gen({ prompt: 'blue lightning', width: 5000, height: 100 });
    assert.equal(r.ok, true); assert.equal(r.image, 'data:image/png;base64,iVBORw0KGgo=');
    assert.equal(seen.url, '/sdapi/v1/txt2img'); assert.equal(seen.body.width, 1024); assert.equal(seen.body.height, 256); assert.equal(seen.body.tiling, true);
    assert.match((await gen({ prompt: '  ' })).error, /Describe/);
    sd.close(); await new Promise(r => setTimeout(r, 50));
    config.livery.sdUrl = 'http://127.0.0.1:1';
    assert.match((await gen({ prompt: 'x' })).error, /not running/);
    config.livery.sdUrl = 'http://10.0.0.5:7860';
    assert.match((await gen({ prompt: 'x' })).error, /on this PC/);
  } finally { server.close(); sd.close(); }
});
