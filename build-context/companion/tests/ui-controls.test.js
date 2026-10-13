// Browser-control behavior harness. Uses a small fake DOM, not visual rendering.
const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const speed = require('../public/speed-warning');

function element() {
  return { value: '', checked: false, innerHTML: '', textContent: '', style: {}, dataset: {}, classList: { toggle() {}, add() {}, remove() {} }, addEventListener() {}, insertAdjacentHTML() {}, closest() { return this; }, querySelectorAll() { return []; }, setAttribute() {} };
}
function coDriver({ greeting = false } = {}) {
  const elements = new Map(), stored = new Map(), calls = [], spoken = [];
  const timers = [], listeners = new Map(), utterances = [];
  const q = id => { if (!elements.has(id)) elements.set(id, element()); return elements.get(id); };
  let source = 'both';
  const K = { q, qa: () => [], esc: s => String(s), fin: Number.isFinite, f1: n => String(n), int: n => String(n), cash: n => String(n),
    guard: fn => fn, notify() {}, go() {}, telem: () => ({}), pages: [], onTick: [],
    api: async (route, options) => {
      calls.push({ route, options });
      if (route === '/api/settings/voice') { source = options.body.promptSource; return { ok: true }; }
      if (route === '/api/settings') return { voice: { promptSource: source } };
      if (route === '/api/ai/status') return { enabled: true, available: true, model: 'qwen3:8b', models: ['qwen3:8b'] };
      if (route === '/api/ai/speech') return { voices: ['test-voice'] };
      if (route === '/api/ai/chat') return { answer: 'A local AI answer.' };
      return {};
    } };
  const context = { window: { KAW16: K, KAWSpeedWarning: speed, addEventListener() {}, speechSynthesis: { getVoices: () => [], cancel() {}, speak(u) { spoken.push(u.text); utterances.push(u); } } },
    document: { activeElement: null }, navigator: { getGamepads: () => [] }, localStorage: { getItem: k => stored.get(k) || null, setItem: (k, v) => stored.set(k, v) },
    SpeechSynthesisUtterance: function(text) { this.text = text; }, setInterval() {}, clearInterval() {}, setTimeout(fn) { if (greeting) timers.push(fn); }, clearTimeout() {}, Date, console, fetch, AbortSignal };
  if (greeting) {
    context.addEventListener = (name, fn) => listeners.set(name, fn);
    context.removeEventListener = name => listeners.delete(name);
  }
  vm.runInNewContext(fs.readFileSync(require.resolve('../public/app-voice'), 'utf8'), context);
  K.pages[0].init();
  return { K, q, calls, spoken, stored, utterances, listeners, timers };
}

test('welcome is the first speech and queued warnings wait until it finishes', async () => {
  const h = coDriver({greeting:true});
  h.K.coDriverSpeech('Real fuel warning.');
  assert.equal(h.spoken.length,0,'no warning before the first click');
  h.listeners.get('pointerdown')();
  while(h.timers.length) h.timers.shift()();
  await new Promise(resolve=>setImmediate(resolve));
  assert.deepEqual(h.spoken,["Welcome to KAW's ATS Playground Live Companion. Glad you're here. Please drive safely."]);
  h.utterances[0].onend();
  while(h.timers.length) h.timers.shift()();
  assert.equal(h.spoken[1],'Real fuel warning.');
});
test('Co-Driver asks local AI and renders an answer through existing speech', async () => {
  const h = coDriver();
  h.q('#cdAsk').value = 'Explain trailer backing';
  h.q('#cdAskAi').onclick();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(h.calls.find(x => x.route === '/api/ai/chat').options.body.question, 'explain trailer backing');
  assert.ok(h.spoken.includes('A local AI answer.'));
});
test('ATS voice mode mutes even manual Companion speech and saves source choice', async () => {
  const h = coDriver();
  await h.q('#cdPromptSource').onchange({ target: { value: 'game' } });
  h.K.coDriverSpeech('This must stay silent.');
  assert.equal(h.spoken.length, 0);
  assert.equal(h.calls.find(x => x.route === '/api/settings/voice').options.body.promptSource, 'game');
  assert.match(h.q('#cdLog').innerHTML, /This must stay silent/);
});
test('speed threshold edits persist and display a concrete example', () => {
  const h = coDriver();
  h.q('#cdOverMph').onchange({ target: { value: '10' } });
  const saved = JSON.parse(h.stored.get('kawCoDriver'));
  assert.equal(saved.overspeedMph, 10);
  assert.match(h.q('#cdSpeedExample').textContent, /65 MPH/);
  h.q('#cdOverMph').onchange({ target: { value: '999' } });
  assert.equal(JSON.parse(h.stored.get('kawCoDriver')).overspeedMph, 30);
});
test('legacy navigation warning controls are hidden and link opens unified controls', () => {
  const h = coDriver();
  assert.equal(h.q('#navOverspeed').hidden, true);
  assert.equal(h.q('#navVoiceFrequency').hidden, true);
  assert.equal(h.q('#navVoiceToggle').textContent, 'Voice & speed settings');
});
test('map style changes save and synchronize both persistent selectors', async () => {
  const elements = new Map();
  const q = id => elements.get(id) || null;
  const canvas = element();
  canvas.insertAdjacentElement = (_position, node) => { if (node.id) elements.set('#' + node.id, node); };
  elements.set('#routeCanvas', canvas);
  for (const id of ['#navMapStyle', '#navMapFrame', '#kawMapStyleAlways', '#kawMapReset', '#kawMapVoice']) elements.set(id, element());
  elements.get('#navMapStyle').options = [{ value: 'geographic', textContent: 'Geographic' }, { value: 'tactical', textContent: 'Tactical' }];
  let saves = 0;
  const prefs = { navMapStyle: 'geographic', mapStyleV2: 1 };
  const K = { q, esc: String, fin: Number.isFinite, onReady: [], onTick: [], telem: () => ({}), go() {} };
  const context = { window: { KAW16: K }, prefs, savePrefs() { saves++; }, document: { createElement: () => { const el = element(); el.insertAdjacentElement = (_position, node) => { if (node.id) elements.set('#' + node.id, node); }; return el; }, querySelectorAll: () => [], head: { appendChild() {} } }, localStorage: { getItem() {} }, console, setTimeout() {} };
  vm.runInNewContext(fs.readFileSync(require.resolve('../public/app-map'), 'utf8'), context);
  K.onReady[0]();
  assert.ok(q('#kawMapToolbar'));
  assert.match(q('#kawMapToolbar').innerHTML, /Reset to Road map/);
  K.tileMap.setNavStyle('tactical');
  assert.equal(prefs.navMapStyle, 'tactical');
  assert.equal(q('#navMapStyle').value, 'tactical');
  assert.equal(q('#kawMapStyleAlways').value, 'tactical');
  assert.ok(saves > 0);
});
