// Convoy together: lost contact, wrong turn, catch-up, regroup, roll call, who's missing, convoy line,
// invite link and the recent replay.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { ConvoyTogether, cleanRegroup } = require('../src/convoyTogether');
const { inviteLink } = require('../src/apiTogether');
const { TrackRecorder } = require('../src/trackRecorder');

const MILE = 1609.344;
const tmp = () => path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'kaw-tg-')), 'together.json');
// Simple flat "map": 1 game mile east = +0.02 lon, 1 mile north (negative z) = +0.0145 lat around Reno.
const locate = p => ({ lat: 39.5 - Number(p.z) / MILE * 0.0145, lon: -119.8 + Number(p.x) / MILE * 0.02, near: 'Reno' });
const drv = (id, name, x, z, speed, extra = {}) => ({ id, driverName: name, online: true, positioning: { x: x + 20000, z: z + 20000, rotationX: extra.rot ?? 0.75 }, truck: { speedMph: speed }, ...extra });

function rig() { let t = 1_000_000; const tg = new ConvoyTogether({ file: tmp(), now: () => t }); return { tg, step: ms => { t += ms; }, now: () => t }; }

test('lost contact while moving is announced, and "back" when they return; parked drivers going offline are not', () => {
  const { tg, step } = rig();
  const me = drv('local', 'Kaw', 0, 0, 60, { isLocal: true });
  tg.evaluate({ roster: [me, drv('d', 'Dusty', -800, 0, 58), drv('p', 'Parked', -900, 0, 0)], locate });
  step(5000);
  const a = tg.evaluate({ roster: [me, { ...drv('d', 'Dusty', -800, 0, 58), online: false }, { ...drv('p', 'Parked', -900, 0, 0), online: false }], locate });
  const lost = a.find(x => x.id === 'together-lost-d');
  assert.ok(lost); assert.match(lost.title, /Dusty dropped out/); assert.match(lost.detail, /near Reno/); assert.match(lost.detail, /58 mph/);
  assert.ok(!a.some(x => x.id === 'together-lost-p'), 'a parked driver closing the game is not an alarm');
  step(5000);
  const b = tg.evaluate({ roster: [me, drv('d', 'Dusty', -700, 0, 55)], locate });
  assert.ok(b.some(x => x.id === 'together-back-d')); assert.ok(!b.some(x => x.id === 'together-lost-d'));
});

test('wrong turn: further from the leader for minutes while heading another way', () => {
  const { tg, step } = rig();
  const leader = { id: 'L', driverName: 'Lead' };
  for (let i = 0; i <= 36; i++) {          // 3 minutes, 5 s steps
    const lead = drv('L', 'Lead', i * 140, 0, 60, { rot: 0.75 });            // heading east
    const rook = drv('r', 'Rook', -600, i * 140, 60, { rot: 0.5 });          // heading south, away
    const me = drv('local', 'Kaw', i * 140 - 500, 0, 60, { isLocal: true, rot: 0.75 });
    var out = tg.evaluate({ roster: [me, lead, rook], leader, locate });
    step(5000);
  }
  assert.ok(out.some(a => a.id === 'together-wrongturn-r' && /Rook may have taken a wrong turn/.test(a.title)));
  assert.ok(!out.some(a => a.id === 'together-wrongturn-local'), 'I am following correctly');
  assert.equal(tg.status().wrongTurns[0].driverName, 'Rook');
});

test('catch-up guidance never asks for more than the speed limit', () => {
  const { tg } = rig();
  const leader = { id: 'L', driverName: 'Lead' };
  const me = drv('local', 'Kaw', 0, 0, 55, { isLocal: true });
  const lead = drv('L', 'Lead', 3.2 * MILE, 0, 58);
  tg.evaluate({ roster: [me, lead], leader, gapWarnMiles: 2, state: { navigation: { speedLimitMph: 65 } }, locate });
  let c = tg.status().catchUp;
  assert.equal(c.targetMph, 64); assert.equal(c.gapMiles, 3.2); assert.equal(c.minutes, 32); assert.match(c.text, /within the speed limit/);
  tg.evaluate({ roster: [me, { ...lead, truck: { speedMph: 65 } }], leader, gapWarnMiles: 2, state: { navigation: { speedLimitMph: 65 } }, locate });
  c = tg.status().catchUp; assert.equal(c.minutes, null); assert.match(c.text, /Don't speed/);
  tg.evaluate({ roster: [me, drv('L', 'Lead', 0.3 * MILE, 0, 58)], leader, gapWarnMiles: 2, locate });
  assert.equal(tg.status().catchUp, null, 'close enough: no tip');
});

test('regroup: newest wins, distances for everyone, dismiss, and unsafe input is cleaned', () => {
  const { tg, step } = rig();
  const me = drv('local', 'Kaw', 0, 0, 50, { isLocal: true });
  tg.setRegroup({ name: 'Truckee rest area', lat: 39.33, lon: -120.18 }, 'Kaw');
  step(1000);
  const peer = drv('d', 'Dusty', 1000, 0, 50, { together: { regroup: { id: 'rg-peer', name: '<b>Boise</b>', lat: 43.6, lon: -116.2, by: 'Dusty', at: 1_001_500 } } });
  step(1000);
  const a = tg.evaluate({ roster: [me, peer], locate });
  const g = tg.status().regroup;
  assert.equal(g.id, 'rg-peer'); assert.equal(g.name, 'bBoise/b', 'markup stripped'); assert.ok(g.miles > 200); assert.equal(g.drivers.length, 2);
  assert.ok(a.some(x => x.id === 'together-regroup-rg-peer'), 'announced');
  tg.clearRegroup();                                    // not mine: hidden for me only
  tg.evaluate({ roster: [me, peer], locate });
  assert.equal(tg.status().regroup.name, 'Truckee rest area', 'my own point shows again');
  tg.clearRegroup();                                    // mine: removed
  tg.evaluate({ roster: [me, peer], locate });
  assert.equal(tg.status().regroup, null);
  assert.equal(tg.shareable().regroup, null);
  assert.equal(cleanRegroup({ lat: 0, lon: 0 }), null, 'outside North America');
});

test('roll call: my answer is automatic, the table shows everyone, and shared data does not churn', () => {
  const { tg, step } = rig();
  const me = drv('local', 'Kaw', 0, 0, 0, { isLocal: true });
  const call = { id: 'rc-1', by: 'Lead', at: 1_000_000 };
  const lead = drv('L', 'Lead', 100, 0, 0, { together: { rollCall: call, rollAnswer: { id: 'rc-1', ready: true, checks: { inTruck: true, jobLoaded: true, sharingLocation: true } } } });
  const state = { connected: true, job: { active: true, destinationCity: 'Boise' } };
  const a = tg.evaluate({ roster: [me, lead, drv('x', 'Quiet', 200, 0, 0)], state, privacy: { shareLocation: true }, locate });
  assert.ok(a.some(x => x.id === 'together-rollcall-rc-1'));
  const rc = tg.status().rollCall;
  assert.equal(rc.total, 3); assert.deepEqual(rc.waiting, ['Quiet']);
  const mine = rc.answers.find(x => x.isLocal); assert.equal(mine.ready, true); assert.equal(mine.confirmed, false); assert.equal(mine.checks.destination, 'Boise');
  const s1 = JSON.stringify(tg.shareable()); step(5000); tg.evaluate({ roster: [me, lead], state, privacy: { shareLocation: true }, locate });
  assert.equal(JSON.stringify(tg.shareable()), s1, 'same answer, same shared data (no resend every tick)');
  tg.setReady(true); tg.evaluate({ roster: [me, lead], state, locate });
  assert.equal(tg.shareable().rollAnswer.ready, true);
});

test("who's missing from a planned convoy, with the likely reason", () => {
  const { tg } = rig();
  const events = [{ name: 'Friday Night Run', status: 'active', host: 'Lead', rsvps: [{ driverName: 'Kaw', status: 'going' }, { driverName: 'Dusty', status: 'going' }, { driverName: 'Rook', status: 'maybe' }, { driverName: 'Nova', status: 'going' }, { driverName: 'Gone', status: 'no' }] }];
  const roster = [drv('local', 'Kaw', 0, 0, 0, { isLocal: true }), drv('L', 'Lead', 10, 0, 0), { id: 'r', driverName: 'Rook', online: true, positioning: {}, truck: {} }, { id: 'n', driverName: 'Nova', online: false, ageSeconds: 600, positioning: { x: 1, z: 1 } }];
  tg.evaluate({ roster, events, locate });
  const m = Object.fromEntries(tg.status().missing.map(x => [x.driverName, x.reason]));
  assert.deepEqual(Object.keys(m).sort(), ['Dusty', 'Nova', 'Rook']);
  assert.match(m.Dusty, /Not connected/); assert.match(m.Rook, /no position/); assert.match(m.Nova, /10 min ago/);
});

test('convoy line follows the formation order with gap colours', () => {
  const { tg } = rig();
  const roster = [drv('local', 'Kaw', 0, 0, 60, { isLocal: true }), drv('L', 'Lead', 800, 0, 60), drv('d', 'Dusty', -3 * MILE, 0, 60)];
  const formation = { active: true, members: [{ id: 'L', driverName: 'Lead', isLeader: true }, { id: 'local', driverName: 'Kaw', isLocal: true, gapMiles: 0.5, status: 'good' }, { id: 'd', driverName: 'Dusty', gapMiles: 3, status: 'broken' }] };
  tg.evaluate({ roster, formation, gapWarnMiles: 2, locate });
  assert.deepEqual(tg.status().line.map(x => `${x.driverName}:${x.color}`), ['Lead:leader', 'Kaw:green', 'Dusty:red']);
});

test('invite link carries relay, key and convoy code; needs a convoy code', () => {
  const cfg = { driverName: 'Kaw', pairingCode: 'FRIDAY', remote: { endpoint: 'https://relay.example/api/telemetry', apiKey: 'k123', backupEndpoints: [] } };
  const r = inviteLink(cfg);
  assert.match(r.link, /^http:\/\/127\.0\.0\.1:4280\/\?connect=/);
  const payload = JSON.parse(Buffer.from(r.link.split('connect=')[1].replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString());
  assert.deepEqual([payload.endpoint, payload.apiKey, payload.pairingCode], ['https://relay.example/api/telemetry', 'k123', 'FRIDAY']); assert.equal(r.includesKey, true);
  assert.throws(() => inviteLink({ ...cfg, pairingCode: '' }), /convoy code/);
});

test('replay of the last 45 minutes without a convoy event', () => {
  const tr = new TrackRecorder();
  const t0 = Date.now() - 60000;
  tr.live.set('a', { name: 'Kaw', isLocal: true, points: [[t0, 0, 0], [t0 + 5000, 100, 0], [t0 + 10000, 200, 0]] });
  tr.live.set('b', { name: 'Dusty', isLocal: false, points: [[t0, -500, 0], [t0 + 10000, -300, 0]] });
  const r = tr.replay('recent', { locate });
  assert.equal(r.frames.length, 3);
  assert.deepEqual(r.frames[1].drivers.map(d => d.name).sort(), ['Dusty', 'Kaw'], 'Dusty carried forward between samples');
});
