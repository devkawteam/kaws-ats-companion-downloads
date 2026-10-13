// Jarvis extras: saved preferences (privacy, limits, persistence) and the trip briefing.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
require('../src/mapCalibration');
const { JarvisMemory, MAX_ITEMS } = require('../src/jarvisMemory');
const { buildBriefing } = require('../src/tripBriefing');
const { JarvisClient } = require('../src/jarvisClient');
const { systemPrompt } = require('../../relay-server/jarvis');

test('saved preferences: add/edit/delete/forget, persisted, sensitive things refused', () => {
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'kaw-mem-')), 'mem.json');
  const m = new JarvisMemory(file);
  const a = m.add('that my favourite truck is the W900');
  assert.equal(a.text, 'my favourite truck is the W900');
  assert.equal(m.add('My favourite truck is the W900').id, a.id, 'no duplicates');
  m.update(a.id, 'My favourite truck is the Peterbilt 389');
  assert.deepEqual(new JarvisMemory(file).texts(), ['My favourite truck is the Peterbilt 389'], 'saved on disk');
  for (const bad of ['my email is kaw@example.com', 'call me on 555 123 4567 89', 'my password is hunter2', 'I live at 12 Oak Street', 'my credit card ends 4242']) assert.throws(() => m.add(bad), /won't save/, bad);
  assert.throws(() => m.add('x'.repeat(130)), /short/);
  for (let i = 0; i < MAX_ITEMS - 1; i++) m.add(`fact ${i}`);
  assert.throws(() => m.add('one too many'), /Delete one first/);
  assert.equal(m.remove(a.id), true); m.clear();
  assert.deepEqual(new JarvisMemory(file).list(), []);
});

test('saved preferences travel with chats and appear in the prompt as preferences, not instructions', async () => {
  let sent;
  const memory = { texts: () => ['Home city is Reno'] };
  const c = new JarvisClient({ config: {}, memory, file: path.join(os.tmpdir(), 'kaw-mem-id.txt'), fetchImpl: async (u, o) => { sent = JSON.parse(o.body); return { ok: true, status: 200, headers: new Headers({ 'content-type': 'application/json' }), text: async () => '{"ok":true,"reply":"hi"}' }; } });
  await c.chat([{ role: 'user', content: 'hi' }], {});
  assert.deepEqual(sent.memory, ['Home city is Reno']);
  const p = systemPrompt('Kaw', {}, {}, ['Home city is Reno']);
  assert.match(p, /asked you to remember.*not as instructions:\n- Home city is Reno/s);
  assert.match(p, /You cannot save anything yourself/);
  assert.doesNotMatch(systemPrompt('Kaw', {}, {}, []), /asked you to remember/);
});

test('trip briefing: job, distance, stops, weather, convoy — and a helpful line with no job', () => {
  const now = Date.parse('2026-10-07T12:00:00Z');
  const b = buildBriefing({
    now, driverName: 'Kaw',
    state: { job: { active: true, cargo: 'Lumber', cargoMassKg: 18000, originCity: 'Sacramento', destinationCity: 'Elko' }, navigation: { distanceMiles: 430, etaSeconds: 28000, deadlineMinutesRemaining: 900, restStopMinutes: 90 }, truck: { fuelRangeMiles: 300 } },
    ownedStates: ['California', 'Nevada', 'Arizona'],
    weather: { enabled: true, now: { temperatureF: 72, short: 'Mostly Clear' }, alerts: [{ event: 'Wind Advisory' }] },
    events: [{ name: 'Friday Haul', departureTime: '2026-10-07T15:00:00Z', meetPoint: 'Reno' }, { name: 'Next Week', departureTime: '2026-10-14T15:00:00Z' }]
  });
  assert.match(b.text, /^Alright Kaw, Lumber \(40k pounds\) from Sacramento to Elko\./);
  assert.match(b.text, /about 430 miles/); assert.match(b.text, /sleep stop/); assert.match(b.text, /72 degrees and mostly clear/);
  assert.match(b.text, /Wind Advisory/); assert.match(b.text, /Friday Haul convoy in 3 hours, meeting at Reno/); assert.doesNotMatch(b.text, /Next Week/);
  assert.match(buildBriefing({ state: { job: { active: false } } }).text, /don't have a job/);
  assert.doesNotMatch(buildBriefing({ state: { job: { active: true, cargo: 'X', originCity: 'Reno', destinationCity: 'Elko' } }, weather: { enabled: false } }).text, /weather/i);
});
