// Convoy calendar (iCal), head-to-head challenges and the preview self-update.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { ConvoyCalendar, parseIcs, cleanFeedUrl, toIcs } = require('../src/convoyCalendar');
const { HeadToHead, cleanChallenge } = require('../src/headToHead');
const { SelfUpdate } = require('../src/selfUpdate');

const ICS = ['BEGIN:VCALENDAR', 'BEGIN:VEVENT', 'UID:a1', 'DTSTART:20261009T200000Z', 'DTEND:20261009T220000Z', 'SUMMARY:Friday Night Haul\\, Reno to Elko', 'LOCATION:Reno', 'DESCRIPTION:Bring a ', ' reefer\\nSee you', 'END:VEVENT',
  'BEGIN:VEVENT', 'UID:a2', 'DTSTART;VALUE=DATE:20261012', 'SUMMARY:Community day', 'RRULE:FREQ=WEEKLY', 'END:VEVENT',
  'BEGIN:VEVENT', 'UID:a3', 'DTSTART:20261010T180000Z', 'SUMMARY:Cancelled run', 'STATUS:CANCELLED', 'END:VEVENT', 'END:VCALENDAR'].join('\r\n');

test('iCal parsing: escapes, folded lines, all-day, repeats, cancelled events skipped', () => {
  const ev = parseIcs(ICS, 'KAW');
  assert.equal(ev.length, 2);
  assert.equal(ev[0].title, 'Friday Night Haul, Reno to Elko'); assert.equal(ev[0].start, '2026-10-09T20:00:00.000Z'); assert.equal(ev[0].description, 'Bring a reefer See you');
  assert.equal(ev[1].allDay, true); assert.equal(ev[1].repeats, true);
  assert.equal(cleanFeedUrl('webcal://calendar.example.com/a.ics'), 'https://calendar.example.com/a.ics');
  for (const bad of ['http://x.example/a.ics', 'file:///c:/a.ics', 'https://u:p@x.example/a.ics', 'nope']) assert.equal(cleanFeedUrl(bad), null, bad);
  const round = parseIcs(toIcs([{ id: 'kaw:1', title: 'Test; run, ok', start: '2026-10-09T20:00:00Z', location: 'Reno' }]));
  assert.equal(round[0].title, 'Test; run, ok'); assert.equal(round[0].start, '2026-10-09T20:00:00.000Z');
});

test('calendar merges Companion events and feeds, keeps the next 30 days, reports feed problems honestly', async () => {
  const now = Date.parse('2026-10-08T12:00:00Z');
  const fetchImpl = async url => url.includes('good') ? { ok: true, status: 200, headers: new Headers(), text: async () => ICS } : { ok: true, status: 200, headers: new Headers(), text: async () => '<html>login</html>' };
  const cal = new ConvoyCalendar({ feeds: [{ name: 'KAW', url: 'https://good.example/a.ics' }, { name: 'Broken', url: 'https://bad.example/b.ics' }, { name: 'Insecure', url: 'http://x.example' }] }, { fetchImpl, now: () => now });
  const r = await cal.upcoming([{ id: 'e1', name: 'Saturday Sunset Run', departureTime: '2026-10-10T23:00:00Z', meetPoint: 'Barstow', destination: 'Vegas', host: 'Ann', myRsvp: 'going', going: 3 }, { id: 'old', name: 'Last month', departureTime: '2026-09-01T00:00:00Z' }]);
  assert.deepEqual(r.events.map(e => e.title), ['Friday Night Haul, Reno to Elko', 'Saturday Sunset Run', 'Community day']);
  assert.equal(r.events[1].rsvp, true); assert.equal(r.events[1].location, 'Barstow → Vegas');
  assert.equal(r.feeds.length, 2, 'insecure feed ignored'); assert.match(r.errors[0], /Broken: not an iCal feed/);
});

test('head-to-head: challenge a friend, they accept, both see live standings; bad peer data ignored', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kaw-h2h-'));
  const me = new HeadToHead(path.join(dir, 'me.json')), ann = new HeadToHead(path.join(dir, 'ann.json'));
  const week = '2026-W41';
  const c = me.challenge('Ann', 'miles', week);
  assert.throws(() => me.challenge('Ann', 'miles', week), /already challenged/);
  assert.throws(() => me.challenge('Ann', 'speed', week), /Pick miles/);
  const myStats = { week: { key: week, miles: 820, deliveries: 4, clean: 3, income: 52000 } };
  const annStats = { week: { key: week, miles: 910, deliveries: 3, clean: 3, income: 40000 } };
  // Ann sees the incoming challenge (it travels in my shared h2h data).
  let st = ann.status([{ driverName: 'Kaw', online: true, driverStats: myStats.week ? myStats : {}, h2h: me.shareable(week) }], annStats, 'Ann');
  assert.equal(st.incoming.length, 1); assert.equal(st.incoming[0].other, 'Kaw'); assert.equal(st.incoming[0].leader, 'you');
  ann.accept('Kaw', c.id, week, 'miles');
  st = ann.status([{ driverName: 'Kaw', online: true, driverStats: myStats, h2h: me.shareable(week) }], annStats, 'Ann');
  assert.equal(st.incoming.length, 0); assert.equal(st.matchups[0].accepted, true);
  // I see that Ann accepted and that she leads.
  const mine = me.status([{ driverName: 'Ann', online: true, driverStats: annStats, h2h: ann.shareable(week) }], myStats, 'Kaw');
  assert.equal(mine.matchups[0].accepted, true); assert.equal(mine.matchups[0].leader, 'them'); assert.equal(mine.matchups[0].theirs, 910);
  // New week: old challenges drop off.
  assert.equal(me.status([], { week: { key: '2026-W42' } }, 'Kaw').matchups.length, 0);
  // Hostile peer data.
  assert.equal(cleanChallenge({ id: 'x', to: 'Ann', metric: 'miles', week }), null);
  assert.equal(cleanChallenge({ id: 'h2h_abcdef12', to: 'Ann', metric: 'rm -rf', week }), null);
});

test('self-update: only git copies, refuses local changes, fast-forwards and refreshes add-ons when needed', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kaw-upd-')), comp = path.join(dir, 'companion');
  fs.mkdirSync(comp);
  assert.equal((await new SelfUpdate({ companionDir: comp, runImpl: async () => ({ ok: true, out: '' }) }).status()).git, false, 'installed copy: no git');
  fs.mkdirSync(path.join(dir, '.git'));
  const calls = [];
  const fake = (state) => async (cmd, args) => {
    calls.push([cmd, ...args].join(' '));
    const a = args.slice(2).join(' ');
    if (a.startsWith('rev-parse --abbrev-ref')) return { ok: true, out: 'codex/free-local-ai-codriver' };
    if (a.startsWith('fetch')) return { ok: true, out: '' };
    if (a.startsWith('rev-list')) return { ok: true, out: `0\t${state.behind}` };
    if (a.startsWith('status --porcelain')) return { ok: true, out: state.dirty ? ' M companion/src/x.js' : '' };
    if (a.startsWith('log -1')) return { ok: true, out: 'abc1234 Something new' };
    if (a === 'rev-parse HEAD') return { ok: true, out: 'deadbeefcafe' };
    if (a.startsWith('pull --ff-only')) { state.pulled = true; return { ok: true, out: 'Fast-forward' }; }
    if (a.startsWith('diff --name-only')) return { ok: true, out: 'companion/public/app.js\ncompanion/src/x.js' };
    return { ok: true, out: '' };
  };
  const dirty = new SelfUpdate({ companionDir: comp, runImpl: fake({ behind: 2, dirty: true }) });
  assert.equal((await dirty.status()).dirty, true);
  await assert.rejects(dirty.apply(), /local changes/);
  const st = { behind: 2, dirty: false };
  const clean = new SelfUpdate({ companionDir: comp, runImpl: fake(st) });
  assert.match((await clean.status()).message, /2 new updates/);
  const r = await clean.apply();
  assert.equal(r.updated, true); assert.equal(st.pulled, true); assert.equal(r.dependencies, null, 'no npm install when package files did not change');
  assert.ok(calls.every(c => /^git -C /.test(c)), 'only git commands ran');
  assert.ok(calls.some(c => c.includes('pull --ff-only origin codex/free-local-ai-codriver')));
});
