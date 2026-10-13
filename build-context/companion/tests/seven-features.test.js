// Route sharing, delivery replay data, fuel & money, livery gallery, rest-stop alarm, map pack check.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');

require('../src/mapCalibration');          // loads the city list relative to the app folder
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'kaw-seven-'));
const { RouteShare, cleanRoute } = require('../src/routeShare');
const { plan } = require('../src/routePlanner');
const { moneyStats } = require('../src/moneyStats');
const { advise, bearingOf, bearingTo } = require('../src/restAdvisor');
const { mapCheck, ALL_STATES } = require('../src/mapCheck');
const { relayParts, mergePeerStatic } = require('../src/remote');
const { LiveryGallery, handleLivery } = require('../src/apiLivery');
const { cityPoints } = require('../src/apiPlus');

test('route sharing: plan -> shared route -> relay static -> peer roster, with strict cleaning', () => {
  const rs = new RouteShare(path.join(tmp, 'share.json'));
  const result = plan(['Sacramento', 'Reno', 'Elko'], {});
  const route = rs.share(rs.fromPlan(result, { name: 'Friday run', by: 'Kaw' }));
  assert.equal(route.stops.length, 3); assert.equal(route.by, 'Kaw'); assert.equal(route.name, 'Friday run');
  assert.deepEqual(new RouteShare(path.join(tmp, 'share.json')).mine, route, 'persists across restarts');
  // Travels in the relay's static block and comes back on the peer.
  const { statics } = relayParts({ sharedRoute: rs.shareable(), truck: {}, trailer: {}, job: {} });
  assert.deepEqual(statics.sharedRoute, route);
  const { peer } = mergePeerStatic({ connected: true, truck: { speedMph: 60 } }, statics);
  assert.deepEqual(peer.sharedRoute, route);
  const shared = rs.fromRoster([{ isLocal: true, online: true, sharedRoute: route }, { driverName: 'Ann', online: true, sharedRoute: peer.sharedRoute }, { driverName: 'Off', online: false, sharedRoute: route }]);
  assert.equal(shared.length, 1); assert.equal(shared[0].from, 'Ann');
  // Hostile peer data is cleaned or dropped.
  assert.equal(cleanRoute({ stops: [{ name: 'X', lat: 999, lon: 0 }] }), null);
  const evil = cleanRoute({ name: '<b>x</b>'.repeat(50), stops: Array.from({ length: 40 }, (_, i) => ({ name: `C${i}\u0000`, lat: 36, lon: -115 })), totalMiles: 'lots' });
  assert.equal(evil.stops.length, 12); assert.equal(evil.name.length, 80); assert.equal(evil.totalMiles, null); assert.ok(!evil.stops[0].name.includes('\u0000'));
  rs.stopSharing(); assert.equal(rs.shareable(), null);
});

test('fuel & money: per-trip net, per-mile figures, groupings, period filter', () => {
  const now = Date.parse('2026-10-06T12:00:00Z');
  const t = (id, cargo, miles, gal, income, daysAgo, route = ['Reno', 'Elko']) => ({ id, status: 'delivered', cargo, milesDriven: miles, fuelUsedGallons: gal, deliveredIncome: income, endedAt: new Date(now - daysAgo * 86400000).toISOString(), originCity: route[0], destinationCity: route[1], truckMake: 'Peterbilt', truckModel: '579' });
  const trips = [t('a', 'Lumber', 300, 50, 30000, 1), t('b', 'Lumber', 200, 40, 15000, 2), t('c', 'Cars', 100, 20, 20000, 3, ['Fresno', 'Reno']), t('d', 'Old', 500, 90, 1000, 60), { id: 'x', status: 'cancelled', milesDriven: 99 }];
  const r = moneyStats(trips, { fuelPrice: 4, days: 30, now });
  assert.equal(r.totals.trips, 3); assert.equal(r.totals.income, 65000); assert.equal(r.totals.fuelCost, 440); assert.equal(r.totals.net, 64560);
  assert.equal(r.totals.mpg, 5.45); assert.equal(r.totals.netPerMile, 107.6);
  assert.equal(r.byCargo[0].key, 'Cars', 'sorted by net per mile'); assert.equal(r.byCargo.find(c => c.key === 'Lumber').trips, 2);
  assert.equal(r.byRoute.length, 2); assert.equal(r.byTruck[0].key, 'Peterbilt 579');
  assert.equal(r.best[0].id, 'c'); assert.equal(r.daily.length, 3);
  assert.equal(moneyStats(trips, { fuelPrice: 4, days: 0, now }).totals.trips, 4, 'all time includes old trips');
  assert.equal(moneyStats(trips, { fuelPrice: 999, days: 30, now }).fuelPrice, 20, 'fuel price is clamped');
});

test('rest-stop alarm: names a reachable place ahead, prefers the followed plan, stays quiet early', () => {
  assert.equal(bearingOf(0), 0); assert.equal(bearingOf(0.25), 270, 'SCS 0.25 = west'); assert.equal(bearingOf(0.75), 90);
  assert.ok(Math.abs(bearingTo({ lat: 39.53, lon: -119.82 }, { lat: 40.83, lon: -115.76 }) - 66) < 5, 'Reno -> Elko is roughly ENE');
  const geo = { lat: 39.53, lon: -119.82 };   // Reno, heading east
  const state = rest => ({ connected: true, positioning: { rotationX: 0.75 }, navigation: { restStopMinutes: rest, distanceMiles: 300, etaSeconds: 300 * 60 } });  // 1 mile per game minute
  const cities = cityPoints();
  assert.ok(cities.length > 100);
  assert.equal(advise({ state: state(300), geo, cities }).active, false, 'quiet when rest is far away');
  // Long rest window (warning set to 3 h): a town ahead that can be reached in time.
  const a = advise({ state: state(200), geo, cities, factor: 1.2, warnMinutes: 180 });
  assert.equal(a.active, true); assert.ok(a.stop, 'found a stop');
  assert.ok(a.stop.minutes <= 190, `reachable before rest (${a.stop.minutes} min)`);
  assert.ok(bearingTo(geo, cities.find(c => c.name === a.stop.name)) < 160, 'stop is ahead (east), not behind');
  assert.equal(a.alert.id, 'rest-plan'); assert.match(a.alert.detail, /Rest needed in 200 min/);
  // Nothing reachable in 80 min east of Reno: say so instead of naming a town too far away.
  const late = advise({ state: state(80), geo, cities, factor: 1.2 });
  assert.match(late.alert.title, /before the next town/); assert.equal(late.alert.severity, 'critical');
  const lovelock = { name: 'Lovelock', stateCode: 'NV', lat: 40.18, lon: -118.47 };
  const p = advise({ state: state(85), geo, cities, plan: { stops: [lovelock] }, factor: 1.2 });
  assert.equal(p.stop.name, 'Lovelock'); assert.equal(p.stop.fromPlan, true, 'plan stop wins when reachable');
  assert.equal(advise({ state: { connected: false }, geo, cities }).active, false);
});

test('map pack check: owned vs needed states from job, plans, shared routes, events and friends', () => {
  assert.ok(ALL_STATES.includes('California') && ALL_STATES.includes('Idaho') && ALL_STATES.length >= 20);
  const r = mapCheck({
    ownedStates: ['California', 'Nevada', 'Arizona', 'Oregon'], scanned: true,
    job: { originCity: 'Reno', destinationCity: 'Boise' },
    plans: [{ name: 'Coast', states: ['California', 'Oregon', 'Washington'] }],
    shared: [{ from: 'Ann', route: { name: 'Utah run', stops: [{ name: 'Elko', lat: 40.83, lon: -115.76 }, { name: 'Salt Lake City', lat: 40.76, lon: -111.89 }] } }],
    events: [{ name: 'Friday convoy', meetPoint: 'Las Vegas', destination: 'Phoenix' }],
    roster: [{ driverName: 'Bob', online: true, location: { state: 'Texas' } }, { isLocal: true, online: true, location: { state: 'Nevada' } }]
  });
  const need = src => r.needs.find(n => n.source === src);
  assert.deepEqual(need('job').missing, ['Idaho']);
  assert.deepEqual(need('plan').missing, ['Washington']);
  assert.deepEqual(need('shared').missing, ['Utah']);
  assert.deepEqual(need('event').missing, []);
  assert.deepEqual(need('convoy').missing, ['Texas']);
  assert.deepEqual(r.missingAll.sort(), ['Idaho', 'Texas', 'Utah', 'Washington']);
  assert.equal(r.states.find(s => s.state === 'Oregon').owned, true);
  assert.deepEqual(mapCheck({ scanned: false, plans: [{ name: 'x', states: ['Idaho'] }] }).missingAll, [], 'unknown ownership never claims missing DLC');
});

test('livery gallery: save, list with thumbnail, open, update in place, delete, local only', async () => {
  const dir = path.join(tmp, 'liveries');
  const project = { name: 'KAW Flames', author: 'Kaw', vehicles: ['peterbilt.579'], designs: { 'peterbilt.579|cabin:a': { w: 4096, h: 4096, layers: [] } } };
  const s = { galleryDir: dir, modDir: tmp };
  const server = http.createServer((req, res) => handleLivery(req, res, new URL(req.url, `http://${req.headers.host}`), s));
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  const post = (p, body, headers = {}) => fetch(base + p, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body) }).then(async r => ({ status: r.status, ...(await r.json()) }));
  try {
    const saved = await post('/api/livery/gallery', { project, thumb: 'data:image/jpeg;base64,/9j/AAAA' });
    assert.equal(saved.ok, true); assert.match(saved.id, /^lv_[a-z0-9]+$/);
    let list = await fetch(base + '/api/livery/gallery').then(r => r.json());
    assert.equal(list.items.length, 1); assert.equal(list.items[0].thumb, 'data:image/jpeg;base64,/9j/AAAA'); assert.equal(list.items[0].project, undefined, 'list stays small');
    const item = await fetch(`${base}/api/livery/gallery/item?id=${saved.id}`).then(r => r.json());
    assert.deepEqual(item.item.project, project);
    const again = await post('/api/livery/gallery', { id: saved.id, project: { ...project, name: 'KAW Flames v2' }, thumb: 'javascript:alert(1)' });
    assert.equal(again.id, saved.id, 'saving again updates the same entry');
    list = await fetch(base + '/api/livery/gallery').then(r => r.json());
    assert.equal(list.items.length, 1); assert.equal(list.items[0].name, 'KAW Flames v2'); assert.equal(list.items[0].thumb, null, 'bad thumbnails dropped');
    assert.equal((await post('/api/livery/gallery', { project: 'nope' })).status, 400);
    assert.equal((await fetch(`${base}/api/livery/gallery/item?id=../../etc`)).status, 404, 'ids cannot reach other files');
    assert.equal((await post('/api/livery/gallery', { project }, { origin: 'http://evil.example' })).status, 403);
    assert.equal((await post('/api/livery/gallery/delete', { id: saved.id })).ok, true);
    assert.equal(new LiveryGallery(dir).list().length, 0);
  } finally { server.close(); }
});

test('trip routes record speed and odometer for the replay', () => {
  const cwd = process.cwd(); process.chdir(tmp);
  try {
    delete require.cache[require.resolve('../src/tripRoutes')];
    const { TripRoutes } = require('../src/tripRoutes');
    const tr = new TripRoutes();
    tr.observe({ connected: true, job: { active: true }, positioning: { x: -88150, z: -5040 }, truck: { speedMph: 61.4, odometerMiles: 12345.67 } });
    const p = tr.current()[0];
    assert.equal(p.length, 5); assert.equal(p[3], 61); assert.equal(p[4], 12345.7);
  } finally { process.chdir(cwd); }
});
