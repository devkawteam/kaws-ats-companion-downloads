// v1.7 extras: weekly challenges, formation coach, route planner, real weather, setup cards, API guard.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'kaw-plus-'));
require('../src/mapCalibration');        // loads the city list relative to the app folder
const cwd = process.cwd();
process.chdir(tmp);                     // funManager/RoutePlans write under ./data — keep it in a temp folder
const { FunManager, WEEKLY_POOL, weekKey, weekStart } = require('../src/funManager');
process.chdir(cwd);
const { FormationCoach } = require('../src/formationCoach');
const { plan, learnFactor, greatCircleMiles, RoutePlans, DEFAULT_FACTOR } = require('../src/routePlanner');
const { RealWeather, drivingTip } = require('../src/realWeather');
const S = require('../public/setupcard-core');
const { handlePlus } = require('../src/apiPlus');

test('weekly board: ISO week keys, Monday start, 4 stable picks, progress and one-time XP', () => {
  assert.equal(weekKey(new Date(2026, 9, 6)), '2026-W41');
  assert.equal(weekKey(new Date(2021, 0, 3)), '2020-W53', 'Jan 3 2021 belongs to the last ISO week of 2020');
  assert.equal(weekStart(new Date(2026, 9, 11, 15)).getDay(), 1, 'week starts on Monday');
  assert.equal(weekStart(new Date(2026, 9, 11, 15)).getDate(), 5);
  const now = new Date(2026, 9, 7, 12);
  const at = h => new Date(2026, 9, 6, h).toISOString();
  const trips = [
    ...Array.from({ length: 16 }, (_, i) => ({ status: 'delivered', startedAt: at(1), endedAt: at(2 + (i % 10)), milesDriven: 200, deliveredIncome: 20000, endCargoDamage: 0, speedingSeconds: 0, cargoMassKg: 20000, eco: { score: 90 }, destinationCity: ['Las Vegas', 'Bakersfield', 'Reno', 'Phoenix', 'Tucson', 'Fresno', 'Sacramento', 'Flagstaff', 'Elko'][i % 9] })),
    { status: 'delivered', startedAt: '2026-09-01T00:00:00Z', endedAt: '2026-09-01T05:00:00Z', milesDriven: 9999 }   // last month: ignored
  ];
  const bonuses = [];
  const fun = new FunManager({ trips: { getRecent: () => trips, getCurrent: () => null }, career: { addBonus: (k, xp) => bonuses.push([k, xp]) }, discord: null, journal: null, settings: {} });
  fun.save = () => {};
  const ctx = fun.weekContext(now);
  assert.equal(ctx.miles, 3200); assert.equal(ctx.deliveries, 16); assert.equal(ctx.cities, 9);
  assert.ok(ctx.states >= 3, `states counted from city lookup (got ${ctx.states})`);
  assert.equal(ctx.heavy, 16); assert.equal(ctx.eco80, 16);
  const w = fun.weekly(now);
  assert.equal(w.week, '2026-W41'); assert.equal(w.items.length, 4);
  assert.deepEqual(fun.thisWeek('2026-W41').map(c => c.id), w.items.map(c => c.id), 'same picks all week');
  assert.ok(w.items.every(c => WEEKLY_POOL.some(p => p.id === c.id)));
  const done = w.items.filter(c => c.done).length;
  assert.equal(bonuses.length, done);
  fun.weekly(now);
  assert.equal(bonuses.length, done, 'XP is only awarded once per challenge per week');
  assert.ok(w.resetsIn > 0 && w.resetsIn <= 7 * 1440);
  assert.equal(new FunManager({ trips: { getRecent: () => [], getCurrent: () => null }, settings: { challenges: false } }).weekly().enabled, false);
});

// Positions are offset from (0,0), which telemetry uses for 'no position yet'.
function roster(list) { return list.map(([id, name, x, z, mph, isLocal = false]) => ({ id, driverName: name, isLocal, online: true, positioning: { x: x + 5000, z: z + 5000, rotationX: 0 }, truck: { speedMph: mph } })); }

test('formation coach orders the convoy behind the leader and coaches the local driver', () => {
  let t = 0;
  const coach = new FormationCoach({ followSeconds: 4, gapWarnMiles: 2 }, () => t);
  // Driving north (-z). Leader at z=0; heading set by movement history.
  coach.evaluate(roster([['L', 'Lead', 0, 100, 60], ['A', 'Ann', 0, 200, 60], ['M', 'Me', 0, 300, 60, true]]), { id: 'L' });
  t = 5000;
  let s = coach.evaluate(roster([['L', 'Lead', 0, 0, 60], ['M', 'Me', 0, 30, 60, true], ['A', 'Ann', 0, 400, 60]]), { id: 'L' });
  assert.equal(s.active, true);
  assert.deepEqual(s.members.map(m => m.driverName), ['Lead', 'Me', 'Ann'], 'order by distance along the direction of travel');
  const me = s.members.find(m => m.isLocal);
  assert.equal(me.status, 'too-close');                      // 30 m at 26.8 m/s ≈ 1.1 s
  assert.match(s.tip.text, /Too close/);
  assert.equal(s.members[2].status, 'good', 'under 400 m is never called loose');
  assert.deepEqual(coach.alerts(), [], 'no alert for a brief squeeze');
  t = 14000; coach.evaluate(roster([['L', 'Lead', 0, -200, 60], ['M', 'Me', 0, -170, 60, true], ['A', 'Ann', 0, 200, 60]]), { id: 'L' });
  assert.equal(coach.alerts()[0]?.id, 'formation-close', 'alert after 8 s too close');
  // Falling far behind -> broken; leader gets told about the straggler.
  t = 20000; s = coach.evaluate(roster([['L', 'Lead', 0, -400, 60, true], ['A', 'Ann', 0, 4000, 60]]), { id: 'L' });
  assert.equal(s.members[1].status, 'broken'); assert.match(s.tip.text, /Ann is 2\.\d+ mi back/);
  // No leader chosen.
  assert.equal(new FormationCoach().evaluate(roster([['M', 'Me', 0, 0, 0, true], ['A', 'Ann', 0, 10, 0]]), null).active, false);
});

test('route planner: real distances, learned factor, rest/fuel stops, DLC states, unknown cities', () => {
  const lv = { lat: 36.1648, lon: -115.1514 }, la = { lat: 34.05, lon: -118.24 };
  assert.ok(Math.abs(greatCircleMiles(lv, la) - 228) < 6, 'Las Vegas–Los Angeles ≈ 228 mi straight line');
  assert.deepEqual(learnFactor([]), { factor: DEFAULT_FACTOR, learned: false, samples: 0 });
  const trips = [['Las Vegas', 'Bakersfield', 330], ['Phoenix', 'Tucson', 140], ['Reno', 'Sacramento', 160], ['Fresno', 'Bakersfield', 130]].map(([a, b, d]) => ({ originCity: a, destinationCity: b, plannedDistanceMiles: d }));
  const f = learnFactor(trips);
  assert.equal(f.learned, true); assert.ok(f.factor > 1 && f.factor < 1.6, `factor ${f.factor}`);
  const r = plan(['Las Vegas', 'Bakersfield', 'Sacramento', 'Reno', 'Elko'], { speedMph: 55, fuelRangeMiles: 300, tankRangeMiles: 900, driveHoursBeforeRest: 11, restDueMinutes: 120, ownedStates: ['California', 'Nevada', 'Arizona'], trips });
  assert.equal(r.ok, true); assert.equal(r.legs.length, 4); assert.equal(r.learned, true);
  assert.equal(r.totalMiles, r.legs.reduce((s, l) => s + l.miles, 0));
  assert.ok(r.stops.some(s => s.kind === 'rest' && s.mileFromStart <= 115), 'first sleep when the live rest timer runs out (2 h at 55 mph)');
  assert.ok(r.stops.some(s => s.kind === 'fuel' && s.mileFromStart <= 250), 'first refuel before the 50 mi reserve');
  assert.deepEqual(r.missingStates, []);
  const r2 = plan(['Las Vegas', 'Boise'], { ownedStates: ['California', 'Nevada', 'Arizona'] });
  assert.ok(r2.missingStates.includes('Idaho'), 'flags states without the map DLC');
  const bad = plan(['Las Vegas', 'Atlantis'], {});
  assert.equal(bad.ok, false); assert.deepEqual(bad.unknown, ['Atlantis']);
  assert.throws(() => plan(['Las Vegas']), /at least a start/);
  const store = new RoutePlans(path.join(tmp, 'plans.json'));
  const saved = store.add('Test run', ['Las Vegas', 'Reno'], 60);
  assert.equal(new RoutePlans(path.join(tmp, 'plans.json')).list[0].name, 'Test run');
  assert.equal(store.remove(saved.id), true); assert.equal(store.list.length, 0);
});

test('real weather: off by default, rounds the point, parses NWS data, caches, gives a tip', async () => {
  const calls = [];
  const fake = async (url, opts) => {
    calls.push(url); assert.match(opts.headers['user-agent'], /KAWs-ATS-Companion/);
    const u = new URL(url);
    const body = u.pathname.startsWith('/points/') ? { properties: { forecastHourly: 'https://api.weather.gov/gridpoints/VEF/123,98/forecast/hourly', cwa: 'VEF', relativeLocation: { properties: { city: 'Las Vegas', state: 'NV' } } } }
      : u.pathname.includes('/forecast/hourly') ? { properties: { periods: [{ startTime: '2026-10-06T12:00:00-07:00', temperature: 101, temperatureUnit: 'F', windSpeed: '10 mph', windDirection: 'SW', shortForecast: 'Sunny', probabilityOfPrecipitation: { value: 0 }, isDaytime: true }] } }
      : { features: [{ properties: { event: 'Excessive Heat Warning', severity: 'Severe', headline: 'Hot' } }] };
    return { ok: true, status: 200, json: async () => body };
  };
  const off = new RealWeather({}, { fetchImpl: fake });
  assert.deepEqual(await off.at(-115.15, 36.17), { enabled: false });
  assert.equal(calls.length, 0, 'nothing is sent while off');
  const w = new RealWeather({ enabled: true }, { fetchImpl: fake });
  const r = await w.at(-115.151234, 36.169876);
  assert.ok(calls[0].endsWith('/points/36.17,-115.15'), 'position rounded to ~1 mile');
  assert.equal(r.place, 'Las Vegas, NV'); assert.equal(r.now.temperatureF, 101); assert.equal(r.alerts[0].event, 'Excessive Heat Warning');
  assert.match(r.tip, /heat/i);
  const n = calls.length; await w.at(-115.151, 36.17); assert.equal(calls.length, n, 'cached for 10 minutes');
  await assert.rejects(w.at(0, 0), /No position/);
  assert.match(drivingTip({ short: 'Heavy Snow' }, []), /Snow/);
  assert.match(drivingTip({ short: 'Sunny', wind: '35 mph' }, []), /wind/i);
});

test('setup cards: round-trip, strict validation, no plate, comparison', () => {
  const d = { driverName: 'Kaw', truck: { make: 'Peterbilt', model: '579', transmissionType: 'manual', forwardGears: 18, differentialRatio: 3.36, wheelCount: 10, licensePlate: 'SECRET1' }, trailer: { attached: true, brand: 'SCS', name: 'Box 53', chainType: 'single', wheelCount: 8 }, buildProfile: { engine: 'PACCAR MX-13', hp: '510', brakes: 'Stock' }, positioning: { x: 1, z: 2 } };
  const card = S.fromTelemetry(d, { title: 'Midnight Hauler', note: 'Runs <script> great', livery: 'KAW Flames' });
  const code = S.encode(card);
  assert.ok(code.startsWith('KAWSETUP1.')); assert.ok(!code.includes('SECRET1'));
  const back = S.decode(`Check my rig!\n${code}\n`);
  assert.deepEqual(back, card);
  assert.ok(!JSON.stringify(back).includes('SECRET1') && !('positioning' in back), 'plate and position never included');
  assert.equal(back.truck.gears, 18); assert.equal(back.trailer.name, 'Box 53'); assert.equal(back.build.engine, 'PACCAR MX-13');
  assert.throws(() => S.decode('hello'), /not a KAW setup code/);
  assert.throws(() => S.decode('KAWSETUP1.!!!'), /damaged/);
  assert.throws(() => S.decode('KAWSETUP1.' + Buffer.from('{"v":2}').toString('base64url')), /newer Companion/);
  const evil = S.decode('KAWSETUP1.' + Buffer.from(JSON.stringify({ v: 1, truck: { make: 'x'.repeat(500), gears: 9999 }, extra: { a: 1 } })).toString('base64url'));
  assert.equal(evil.truck.make.length, 40); assert.equal(evil.truck.gears, undefined); assert.equal(evil.extra, undefined);
  const rows = S.compare(card, { ...card, truck: { ...card.truck, model: 'W900' } });
  assert.equal(rows.find(r => r.key === 'truck.model').same, false);
  assert.equal(rows.find(r => r.key === 'truck.make').same, true);
});

test('extras API: reads are open on the dashboard, changes need the local PC', async () => {
  const s = { state: { job: { active: true, originCity: 'Reno', destinationCity: 'Elko' }, truck: {}, navigation: {} }, trips: { getRecent: () => [] }, intelligence: { getScan: () => ({ capabilities: { mapStates: ['California', 'Nevada'] } }) }, routePlans: new RoutePlans(path.join(tmp, 'api-plans.json')), formation: new FormationCoach(), weather: new RealWeather({}), calibration: { locate: () => null }, config: {} };
  const server = http.createServer((req, res) => handlePlus(req, res, new URL(req.url, `http://${req.headers.host}`), s).then(r => { if (r === false) { res.statusCode = 404; res.end(); } }));
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  const call = (p, body, headers = {}) => fetch(base + p, body === undefined ? { headers } : { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body) }).then(async r => ({ status: r.status, ...(await r.json()) }));
  try {
    const c = await call('/api/planner/cities');
    assert.ok(c.cities.includes('Las Vegas') && c.cities.includes('Bakersfield')); assert.deepEqual(c.job, { from: 'Reno', to: 'Elko' });
    const p = await call('/api/planner/plan', { stops: ['Reno', 'Elko'] });
    assert.equal(p.ok, true); assert.equal(p.legs.length, 1); assert.ok(p.totalMiles > 230 && p.totalMiles < 330, `Reno–Elko ${p.totalMiles} mi`);
    assert.equal((await call('/api/planner/plans', { name: 'x', stops: ['Reno', 'Elko'] })).ok, true);
    assert.equal((await call('/api/planner/plans')).plans.length, 1);
    assert.equal((await call('/api/formation')).active, false);
    assert.deepEqual(await call('/api/weather'), { status: 200, ok: true, enabled: false });
    assert.equal((await call('/api/weather/settings', { enabled: true }, { origin: 'http://evil.example' })).status, 403, 'cross-site change refused');
    assert.equal((await fetch(base + '/api/nope')).status, 404, 'other routes are left to the next handler');
  } finally { server.close(); }
});
