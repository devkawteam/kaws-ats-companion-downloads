// Convoy visibility: per-install relay ID (same-named drivers don't hide each other), "am I really in the
// convoy" push state (refused/off is not shown as online), and connect links with the blocked address.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const { RelayClient, isSelf, loadDriverId } = require('../src/remote');
const { RelayMonitor } = require('../src/relayMonitor');
const { liveEndpoint, MAIN_RELAY } = require('../src/relayDefaults');

test('each install gets a stable random convoy ID, sent with every update', async () => {
  const f = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'kaw-id-')), 'relay-driver-id.txt');
  const a = loadDriverId(f), b = loadDriverId(f);
  assert.match(a, /^drv-[a-f0-9-]{36}$/); assert.equal(a, b, 'stable across restarts');
  const bodies = [];
  const srv = http.createServer((req, res) => { let s = ''; req.on('data', d => s += d).on('end', () => { const body = JSON.parse(s); bodies.push(body); res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify({ ok: true, driverId: body.driverId, roster: [] })); }); });
  await new Promise(r => srv.listen(0, '127.0.0.1', r));
  try {
    const c = new RelayClient({ driverName: 'User', pairingCode: 'x', remote: { enabled: true, endpoint: `http://127.0.0.1:${srv.address().port}/api/telemetry` } }, { driverId: a });
    await c.send({});
    assert.equal(bodies[0].driverId, a); assert.equal(c.myRelayId, a);
  } finally { srv.close(); }
});

test('a different driver with the SAME name is not mistaken for me', () => {
  const me = { myRelayId: 'drv-1111' };
  assert.equal(isSelf({ id: 'drv-1111', driverName: 'User' }, me, 'User'), true);
  assert.equal(isSelf({ id: 'drv-2222', driverName: 'User' }, me, 'User'), false, 'same name, other install: shown');
  assert.equal(isSelf({ id: 'user', driverName: 'User' }, { myRelayId: null }, 'User'), true, 'old relay without IDs: by name');
});

test('push state: sharing off and relay refusal are reported, not shown as "online"', () => {
  const cfg = { remote: { enabled: false, endpoint: 'https://r.example/api/telemetry' } };
  const m = new RelayMonitor(cfg);
  assert.equal(m.pushState().pushState, 'off');
  cfg.remote.enabled = true;
  assert.equal(m.pushState().pushState, 'waiting');
  m.pushResult(false, 'Relay HTTP 401');
  const r = m.pushState(); assert.equal(r.pushState, 'rejected'); assert.match(r.pushDetail, /NOT in the convoy/); assert.match(r.pushDetail, /relay key/);
  m.pushResult(false, 'Relay HTTP 403'); assert.match(m.pushState().pushDetail, /convoy secret/);
  m.pushResult(false, 'fetch failed'); assert.equal(m.pushState().pushState, 'failing');
  m.pushResult(true); assert.equal(m.pushState().pushState, 'ok');
  assert.equal(m.get().pushState, 'ok', 'exposed by /api/relay');
});

test('a connect link with the blocked relay address uses the working relay at once', () => {
  assert.equal(liveEndpoint('https://ats.kawsplayground.online/api/telemetry'), MAIN_RELAY);
  assert.equal(liveEndpoint('https://ats.kawsplayground.online/api/telemetry/'), MAIN_RELAY);
  assert.equal(liveEndpoint('https://my-relay.example/api/telemetry'), 'https://my-relay.example/api/telemetry', 'custom relays untouched');
});

test('the checklist, lights and hub badge know about refusal and sharing off', () => {
  const pub = f => fs.readFileSync(path.join(__dirname, '..', 'public', f), 'utf8');
  assert.match(pub('app-help.js'), /Not in convoy/); assert.match(pub('app-hub.js'), /Not in the convoy — relay refused this Companion/);
  const cc = pub('app-convoycheck.js');
  for (const s of ['Can my convoy see me?', 'Join a convoy', '/api/settings/relay', 'Location sharing is off', 'same convoy code']) assert.ok(cc.includes(s), s);
  assert.match(pub('index.html'), /app-convoycheck\.js/); assert.match(pub('sw.js'), /app-convoycheck\.js/);
});

test('a driver who stopped sending goes offline on time, even while the relay still lists them', () => {
  const { ConvoyManager } = require('../src/convoyManager');
  const cm = new ConvoyManager('Kaw');
  cm.peers = {};
  const realNow = Date.now;
  let t = realNow();
  Date.now = () => t;
  const RealDate = global.Date;
  try {
    cm.ingestPeer({ id: 'drv-a', driverName: 'Dusty', relaySeenAt: '2026-10-09T10:00:00.000Z', positioning: { x: 1, z: 1 } });
    cm.peers['drv-a'].updatedAt = new RealDate(t - 40000).toISOString();          // last real update 40 s ago
    cm.ingestPeer({ id: 'drv-a', driverName: 'Dusty', relaySeenAt: '2026-10-09T10:00:00.000Z', positioning: { x: 1, z: 1 } });   // same stamp again
    assert.equal(cm.getRoster().find(r => r.id === 'drv-a').online, false, 'same relay stamp = not freshly seen');
    cm.ingestPeer({ id: 'drv-a', driverName: 'Dusty', relaySeenAt: '2026-10-09T10:00:41.000Z', positioning: { x: 1, z: 1 } });
    assert.equal(cm.getRoster().find(r => r.id === 'drv-a').online, true, 'new stamp = seen now');
    cm.ingestPeer({ id: 'drv-b', driverName: 'Old', positioning: { x: 1, z: 1 } });
    assert.equal(cm.getRoster().find(r => r.id === 'drv-b').online, true, 'older relays without stamps still work');
  } finally { Date.now = realNow; }
});
