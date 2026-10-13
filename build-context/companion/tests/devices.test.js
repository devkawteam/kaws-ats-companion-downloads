const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const vm = require('node:vm');
const { DeviceHub, privateAddresses } = require('../src/deviceHub');
const { handleDevices, displayAccess } = require('../src/apiDevices');
function fixture(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kaw-devices-')); t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  let time = 100000; const file = path.join(dir, 'devices.json');
  const hub = new DeviceHub({ file, now: () => time });
  return { hub, file, advance: n => time += n };
}
function invite(hub) { return new URL(hub.invite('192.168.1.20', 4280, 'navigation').url).hash.slice('#token='.length); }
test('QR invitations expire and are single use; sessions persist without storing raw secrets', t => {
  const { hub, file, advance } = fixture(t), token = invite(hub);
  const { session, device } = hub.pair(token, 'My iPad', true);
  assert.equal(device.screen, 'navigation'); assert.equal(device.name, 'My iPad');
  assert.throws(() => hub.pair(token, 'Other', false), /expired or was used/);
  assert.ok(!fs.readFileSync(file, 'utf8').includes(session)); assert.ok(!fs.readFileSync(file, 'utf8').includes(token));
  const restarted = new DeviceHub({ file }); const saved = restarted.authenticate(`kawDevice=${session}`);
  assert.equal(saved.name, 'My iPad'); assert.equal(restarted.view(saved).online, false);
  const expired = invite(hub); advance(300001); assert.throws(() => hub.pair(expired, 'Phone', false), /expired/);
});
test('device commands need permission and an open page; acknowledgement, isolation and revocation work', t => {
  const { hub, advance } = fixture(t), a = hub.pair(invite(hub), 'A', false), b = hub.pair(invite(hub), 'B', true);
  const da = hub.authenticate(`kawDevice=${a.session}`), db = hub.authenticate(`kawDevice=${b.session}`);
  assert.throws(() => hub.send(da.id, 'drive'), /Allow screen changes/);
  hub.heartbeat(da, { allowSwitch: true }); const command = hub.send(da.id, 'truck');
  assert.equal(hub.heartbeat(db, {}).command, null);
  assert.equal(hub.heartbeat(da, {}).command.id, command.id);
  assert.equal(hub.heartbeat(da, { ack: command.id, screen: 'truck' }).command, null);
  hub.send(da.id, 'drive'); hub.heartbeat(da, { allowSwitch: false }); assert.equal(hub.heartbeat(da, {}).command, null);
  advance(20001); assert.throws(() => hub.send(db.id, 'drive'), /Open the Companion/);
  hub.revoke(da.id); assert.equal(hub.authenticate(`kawDevice=${a.session}`), undefined);
});
test('private address suggestions omit external, loopback, link-local and IPv6 interfaces', () => {
  const entries = ['127.0.0.1', '192.168.1.2', '10.0.0.2', '172.16.2.3', '172.31.2.3', '172.32.2.3', '8.8.8.8', '169.254.1.1'].map(address => ({ address, internal: address.startsWith('127.'), family: 'IPv4' }));
  assert.deepEqual(privateAddresses({ eth: entries, other: [{ address: '::1', family: 'IPv6', internal: false }] }), ['192.168.1.2', '10.0.0.2', '172.16.2.3', '172.31.2.3']);
});
test('paired displays can view supported data but cannot change settings or issue commands', t => {
  const { hub } = fixture(t), { session } = hub.pair(invite(hub), 'Phone', false);
  const req = { socket: { remoteAddress: '192.168.1.5' }, headers: { host: '192.168.1.20:4280', cookie: `kawDevice=${session}` }, method: 'GET' };
  assert.equal(displayAccess(req, new URL('http://pc/api/telemetry'), hub), true);
  for (const p of ['/api/settings', '/api/streamdeck/DEPART', '/api/relay']) assert.equal(displayAccess(req, new URL('http://pc' + p), hub), false);
  req.method = 'POST'; assert.equal(displayAccess(req, new URL('http://pc/api/convoy/command'), hub), false);
  req.method = 'GET'; req.headers.origin = 'https://foreign.example'; assert.equal(displayAccess(req, new URL('http://pc/api/telemetry'), hub), false);
  delete req.headers.origin; delete req.headers.cookie; assert.equal(displayAccess(req, new URL('http://pc/api/telemetry'), hub), false);
});
test('paired phones can talk to Jarvis, but not change his memory, settings or anything else', t => {
  const { hub } = fixture(t), { session } = hub.pair(invite(hub), 'Phone', false);
  const req = (method, cookie = `kawDevice=${session}`, origin) => ({ socket: { remoteAddress: '192.168.1.5' }, headers: { host: '192.168.1.20:4280', ...(cookie ? { cookie } : {}), ...(origin ? { origin } : {}) }, method });
  const can = (method, p, ...rest) => displayAccess(req(method, ...rest), new URL('http://pc' + p), hub);
  assert.equal(can('POST', '/api/jarvis/chat'), true); assert.equal(can('GET', '/api/jarvis/status'), true); assert.equal(can('GET', '/api/jarvis/briefing'), true);
  for (const [m, p] of [['GET', '/api/jarvis/memory'], ['POST', '/api/jarvis/memory'], ['POST', '/api/jarvis/settings'], ['POST', '/api/jarvis/memory/clear'], ['GET', '/api/jarvis/chat']]) assert.equal(can(m, p), false, `${m} ${p}`);
  assert.equal(can('POST', '/api/jarvis/chat', null), false, 'not paired');
  assert.equal(can('POST', '/api/jarvis/chat', `kawDevice=${session}`, 'https://foreign.example'), false, 'other websites');
});
test('HTTP pairing sets a persistent HttpOnly cookie and rejects cross-origin pairing and replay', async t => {
  const { hub } = fixture(t);
  const server = http.createServer(async (req, res) => { await handleDevices(req, res, new URL(req.url, 'http://localhost'), hub, 4280, '0.0.0.0'); });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve)); t.after(() => new Promise(resolve => server.close(resolve)));
  const base = `http://127.0.0.1:${server.address().port}`, token = invite(hub), body = JSON.stringify({ token, name: 'Android', allowSwitch: true });
  const bad = await fetch(base + '/api/devices/pair', { method: 'POST', headers: { origin: 'https://evil.example' }, body }); assert.equal(bad.status, 403);
  const r = await fetch(base + '/api/devices/pair', { method: 'POST', headers: { 'content-type': 'application/json' }, body });
  assert.equal(r.status, 200); assert.match(r.headers.get('set-cookie'), /HttpOnly; SameSite=Strict; Path=\/; Max-Age=/);
  const cookie = r.headers.get('set-cookie').split(';')[0];
  const heartbeat = await fetch(base + '/api/devices/heartbeat', { method: 'POST', headers: { cookie }, body: '{}' }); assert.equal((await heartbeat.json()).device.name, 'Android');
  assert.equal((await fetch(base + '/api/devices/pair', { method: 'POST', body })).status, 400);
});
test('vendored QR generator encodes the pairing URL with a quiet-zone compatible square matrix', () => {
  const ctx = { document: { documentElement: { tagName: 'html' } }, navigator: { userAgent: '' } }; vm.createContext(ctx);
  vm.runInContext(fs.readFileSync(path.join(__dirname, '../public/vendor/qrcode.min.js'), 'utf8'), ctx);
  const el = { title: '', style: {}, childNodes: [{ offsetWidth: 240, offsetHeight: 240 }] };
  const url = 'http://192.168.1.20:4280/pair.html#token=' + 'a'.repeat(64);
  const qr = new ctx.QRCode(el, { text: url, width: 240, height: 240, correctLevel: ctx.QRCode.CorrectLevel.M });
  assert.equal(el.title, url); assert.ok(qr._oQRCode.moduleCount > 21); assert.equal(qr._oQRCode.modules.length, qr._oQRCode.moduleCount);
  // Finder patterns are required for camera recognition.
  const modules = qr._oQRCode.modules;
  for (const [r, c] of [[0, 0], [0, modules.length - 7], [modules.length - 7, 0]]) {
    assert.equal(modules[r][c], true); assert.equal(modules[r + 1][c + 1], false); assert.equal(modules[r + 3][c + 3], true);
  }
});
test('camera link removes the secret from browser history, waits for consent and opens the selected screen', async () => {
  const token = 'a'.repeat(64), nodes = { '#status': {}, '#name': { value: 'My phone' }, '#switch': { checked: true } }, button = {};
  nodes['#pairForm'] = { querySelector: () => button };
  let removed = false, requested = null, target = null;
  const ctx = { URLSearchParams, document: { querySelector: s => nodes[s] }, history: { replaceState: () => { removed = true; } }, location: { hash: '#token=' + token, pathname: '/pair.html', replace: s => { target = s; } }, fetch: async (url, opts) => { requested = { url, body: JSON.parse(opts.body) }; return { ok: true, json: async () => ({ ok: true, device: { screen: 'navigation' } }) }; } };
  vm.createContext(ctx); vm.runInContext(fs.readFileSync(path.join(__dirname, '../public/pair.js'), 'utf8'), ctx);
  assert.equal(removed, true); assert.equal(requested, null);
  await nodes['#pairForm'].onsubmit({ preventDefault() {} });
  assert.equal(requested.body.token, token); assert.equal(requested.body.allowSwitch, true); assert.equal(target, '/?page=navigation&paired=1');
});
test('secure pairing: https links, https origins accepted only over TLS, and kaw-companion.local', t => {
  const { hub } = fixture(t);
  const secure = hub.invite('kaw-companion.local', 4443, 'drive', 'https');
  assert.match(secure.url, /^https:\/\/kaw-companion\.local:4443\/pair\.html#token=/);
  assert.equal(secure.secure, true);
  assert.match(hub.invite('192.168.1.20', 4280, 'drive').url, /^http:\/\//);
  const { session } = hub.pair(new URL(secure.url).hash.slice('#token='.length), 'iPhone', false);
  const req = { socket: { remoteAddress: '192.168.1.7', encrypted: true }, headers: { host: 'kaw-companion.local:4443', origin: 'https://kaw-companion.local:4443', cookie: `kawDevice=${session}` }, method: 'GET' };
  assert.equal(displayAccess(req, new URL('https://pc/api/telemetry'), hub), true, 'https page on the TLS port');
  req.socket.encrypted = false;
  assert.equal(displayAccess(req, new URL('http://pc/api/telemetry'), hub), false, 'https origin claimed over plain http is refused');
  req.socket.encrypted = true; req.headers.origin = 'https://evil.example';
  assert.equal(displayAccess(req, new URL('https://pc/api/telemetry'), hub), false);
});
