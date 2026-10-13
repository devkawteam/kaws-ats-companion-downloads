// v1.7 release batch: weather tool, knowledge export workflow, knowledge status, tour/help safety, greeting/rest guards.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createWeather } = require('../../relay-server/weatherTool');
const { exportProfile, main: exportMain } = require('../../knowledge-service/export');
const { createJarvis } = require('../../relay-server/jarvis');

const pub = f => fs.readFileSync(path.join(__dirname, '..', 'public', f), 'utf8');

test('weather: real observation with place, units and time; stale or non-US is "unavailable"', async () => {
  const t0 = Date.parse('2026-10-07T20:00:00Z');
  const routes = obsAge => async url => {
    const body = url.includes('geocoding') ? { results: [{ name: 'Reno', admin1: 'Nevada', latitude: 39.53, longitude: -119.81 }] }
      : url.includes('/points/') ? { properties: { observationStations: 'https://api.weather.gov/gridpoints/REV/1,1/stations' } }
      : url.endsWith('/stations') ? { features: [{ id: 'https://api.weather.gov/stations/KRNO', properties: { name: 'Reno Airport' } }] }
      : { properties: { timestamp: new Date(t0 - obsAge * 60000).toISOString(), temperature: { value: 20 }, windSpeed: { value: 16.09 }, relativeHumidity: { value: 30 }, textDescription: 'Clear' } };
    return { ok: true, status: 200, json: async () => body };
  };
  const w = await createWeather({ fetchImpl: routes(20), now: () => t0 })('Reno, NV');
  assert.equal(w.available, true); assert.equal(w.place, 'Reno, Nevada'); assert.equal(w.temperatureF, 68); assert.equal(w.windMph, 10); assert.equal(w.minutesAgo, 20); assert.match(w.source, /National Weather Service/);
  assert.equal((await createWeather({ fetchImpl: routes(600), now: () => t0 })('Reno')).available, false, 'a 10-hour-old reading is not "current"');
  const none = await createWeather({ fetchImpl: async () => ({ ok: true, json: async () => ({}) }), now: () => t0 })('Paris, France');
  assert.equal(none.available, false); assert.match(none.note, /US places/);
});

test('Jarvis has the weather tool and is told never to give weather from snippets or memory', async () => {
  const calls = [];
  const j = createJarvis({ env: { JARVIS_OLLAMA_URL: 'https://ai.example', JARVIS_WEB: 'false' }, fetchImpl: async (url, o) => { calls.push(JSON.parse(o.body)); return { ok: true, json: async () => ({ message: { content: 'ok' } }) }; }, weatherImpl: async () => ({ available: false }) });
  await new Promise(r => j.handle({ method: 'POST', headers: {}, socket: {} }, {}, new URL('http://r/api/jarvis/chat'), { readJson: async () => ({ installId: 'kaw-test-0001', messages: [{ role: 'user', content: 'what is the weather in Reno?' }] }), sendJson: r }));
  assert.ok(calls[0].tools.some(t => t.function.name === 'current_weather'));
  assert.match(calls[0].messages[0].content, /Never give current weather from a search snippet or from memory/);
});

test('knowledge export: facts kept, Jarvis instructions and private material dropped whole, approval is separate', () => {
  const md = "# KAW's ATS Playground\n\nA friendly ATS community.\n\n## Names\n\nAlso called Kaws or the Playground.\n\n## Boundaries for Jarvis\n\nNever share credentials or calendars.\n\n## Joining\n\n- Never post your password.\n\n## Hosting\n\nIt runs on port :3004.\n\n## Convoys\n\nConvoys are announced in the Discord.";
  const r = exportProfile(md);
  assert.deepEqual(r.dropped.map(d => d.heading), ['Boundaries for Jarvis', 'Joining', 'Hosting']);
  assert.match(r.text, /Also called Kaws/); assert.match(r.text, /Convoys are announced/); assert.doesNotMatch(r.text, /credentials|password|3004/);
  assert.equal(r.problem, null);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kaw-export-'));
  const src = path.join(dir, 'Community-Profile.md'); fs.writeFileSync(src, md);
  const out = path.join(dir, 'kb');
  const log = console.log; console.log = () => {};
  try {
    assert.equal(exportMain(['node', 'export', src, '--dir', out]), 0);
    let man = JSON.parse(fs.readFileSync(path.join(out, 'manifest.json'), 'utf8'));
    assert.equal(man.documents[0].approved, false, 'not served until the owner approves');
    assert.equal(exportMain(['node', 'export', src, '--dir', out, '--approve']), 0);
    man = JSON.parse(fs.readFileSync(path.join(out, 'manifest.json'), 'utf8'));
    assert.equal(man.documents[0].approved, true); assert.equal(man.documents[0].revision, '1');
    fs.writeFileSync(src, md + '\n\n## Server\n\nMembers can join the dedicated server.');
    assert.equal(exportMain(['node', 'export', src, '--dir', out]), 0);
    man = JSON.parse(fs.readFileSync(path.join(out, 'manifest.json'), 'utf8'));
    assert.equal(man.documents[0].revision, '2'); assert.equal(man.documents[0].approved, false, 'a changed document needs approval again');
  } finally { console.log = log; }
});

test('Jarvis status reports community knowledge connection with public titles/revisions only', async () => {
  const mk = env => createJarvis({ env: { JARVIS_OLLAMA_URL: 'https://ai.example', ...env }, fetchImpl: async url => url.endsWith('/v1/health') ? { ok: true, json: async () => ({ documents: [{ id: 'p', title: 'Community profile', revision: '4', updated: '2026-10-07' }], refused: ['master.md: refused'] }) } : { ok: true, json: async () => ({ models: [] }) } });
  const status = j => new Promise(r => j.handle({ method: 'GET', headers: {}, socket: {} }, {}, new URL('http://r/api/jarvis/status'), { sendJson: (_r, s, b) => r(b) }));
  const off = await status(mk({}));
  assert.equal(off.knowledge.connected, false);
  const on = await status(mk({ JARVIS_KNOWLEDGE_URL: 'https://kb.example', JARVIS_KNOWLEDGE_TOKEN: 'k'.repeat(32) }));
  assert.equal(on.knowledge.connected, true); assert.deepEqual(on.knowledge.documents, [{ title: 'Community profile', revision: '4', updated: '2026-10-07' }]);
  assert.ok(!JSON.stringify(on).includes('refused') && !JSON.stringify(on).includes('k'.repeat(32)));
});

test('tour/help never touch the microphone or speech; greeting and rest guards are in place', () => {
  const help = pub('app-help.js');
  assert.doesNotMatch(help, /getUserMedia|SpeechRecognition|speechSynthesis|\.speak\(|new Audio|\.play\(/, 'no mic or audio in the tour/help');
  assert.match(help, /kawTourDone/); assert.match(help, /Skip tour/); assert.match(help, /Show the tour again/); assert.match(help, /aria-modal', 'false'/);
  assert.match(help, /speedMph\) > 3/, 'no auto-start while driving');
  const voice = pub('app-voice.js');
  assert.match(voice, /Welcome to KAW's ATS Playground Live Companion\. Glad you're here\. Please drive safely\./);
  assert.match(voice, /if \(greeted\) return; greeted = true;/, 'once per page load');
  assert.match(voice, /speak\(WELCOME, \{ priority: 2, welcome: true/, 'normal queue respects speech settings; welcome goes before warnings');
  assert.match(pub('index.html'), /d\?\.connected&&finite\(n\.restStopMinutes\)&&Number\(n\.restStopMinutes\)>0/);
  const jv = pub('app-jarvis.js');
  assert.match(jv, /id="jvPause" min="1" max="8"/); assert.match(jv, /let pauseSec = 3;/); assert.match(jv, /not microphone volume or sensitivity/);
  assert.match(pub('index.html'), /app-help\.js/); assert.match(pub('sw.js'), /app-help\.js/);
});
