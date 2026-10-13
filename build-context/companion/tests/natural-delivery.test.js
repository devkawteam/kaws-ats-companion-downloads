// Natural-voice delivery: short first segment, ramped segment sizes, one-ahead prefetch, Stop aborts everything.
const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');

const tick = () => new Promise(r => setImmediate(r));
async function settle(n = 40) { for (let i = 0; i < n; i++) await tick(); }

function load() {
  const fetches = [], audios = [];
  const el = () => ({ value: '', checked: false, innerHTML: '', textContent: '', style: {}, dataset: {}, classList: { toggle() {}, add() {}, remove() {} }, addEventListener() {}, insertAdjacentHTML() {}, closest() { return this; }, querySelectorAll() { return []; }, setAttribute() {}, append() {}, prepend() {} });
  const els = new Map(); const q = id => { if (!els.has(id)) els.set(id, el()); return els.get(id); };
  const K = { q, qa: () => [], esc: s => String(s), fin: Number.isFinite, f1: n => String(n), int: n => String(n), cash: n => String(n), guard: fn => fn, notify() {}, go() {}, telem: () => ({}), pages: [], onTick: [], onReady: [],
    api: async route => (route === '/api/settings' ? { voice: { promptSource: 'both' } } : {}) };
  class Audio {
    constructor(src) { this.src = src; this.duration = 5; audios.push(this); }
    play() { this.played = true; setImmediate(() => this.onplaying?.()); return Promise.resolve(); }
    pause() { this.paused = true; }
  }
  const fetchImpl = async (url, opts = {}) => {
    if (String(url) !== '/api/jarvis/speak') return { ok: true, json: async () => ({}) };
    const body = JSON.parse(opts.body);
    const entry = { text: body.text, voice: body.voice, signal: opts.signal };
    fetches.push(entry);
    await tick();
    if (opts.signal?.aborted) throw Object.assign(new Error('aborted'), { name: 'AbortError' });
    return { ok: true, status: 200, headers: { get: () => 'audio/wav' }, blob: async () => ({ size: 10 }), json: async () => ({}) };
  };
  const context = { window: { KAW16: K, KAWSpeedWarning: require('../public/speed-warning'), addEventListener() {}, speechSynthesis: { getVoices: () => [], cancel() {}, speak() {}, speaking: false } },
    document: { activeElement: null }, navigator: { getGamepads: () => [] }, localStorage: { getItem: () => null, setItem() {} },
    SpeechSynthesisUtterance: function (t) { this.text = t; }, setInterval: () => 0, clearInterval() {}, setTimeout, clearTimeout, Date, console, AbortController, AbortSignal,
    fetch: fetchImpl, Audio, URL: { createObjectURL: () => 'blob:x', revokeObjectURL() {} }, performance };
  context.window.fetch = fetchImpl;
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '..', 'public', 'app-voice.js'), 'utf8'), context);
  return { cd: K.coDriver, fetches, audios };
}
const OPTS = { natural: 'en-US-Kokoro-am_michael', voiceURI: '', rate: 1 };
const LONG = "Evening driver, here's the plan for tonight's haul from Reno to Sacramento. Take Interstate 80 over Donner Pass and keep the speed down on the grade, the brakes will thank you. Fuel is usually cheaper in Nevada, so top up before the state line. There's a good rest area near Truckee if the fatigue meter climbs, and the scales at the border are usually open. Have a smooth run and keep the shiny side up out there tonight.";

test('segments: short first, ramped, bounded, nothing lost; next one prefetched while the current plays', async () => {
  const { cd, fetches, audios } = load();
  let done = false;
  cd.speakAndWait(LONG, OPTS).then(() => { done = true; });
  await settle();
  assert.equal(fetches.length, 2, 'segment 1 fetched, segment 2 prefetched once segment 1 started playing');
  assert.equal(audios.length, 1);
  for (let i = 0; i < 20 && !done; i++) { audios.at(-1).onended?.(); await settle(); }
  assert.equal(done, true);
  const texts = fetches.map(f => f.text);
  assert.ok(texts[0].length <= 120, `first segment ${texts[0].length} chars`);
  assert.ok(texts.every(t => t.length <= 220));
  for (let i = 1; i < texts.length; i++) assert.ok(texts[i].length <= Math.max(60, Math.round(texts[i - 1].length * 1.5)), `segment ${i + 1} ramps (${texts[i - 1].length} -> ${texts[i].length})`);
  assert.equal(texts.join(' ').replace(/\s+/g, ' '), LONG, 'every word spoken once, in order');
  assert.equal(new Set(texts).size, texts.length, 'no segment fetched twice (prefetch was used)');
  const log = cd.speechTimings();
  assert.equal(log.length, texts.length); assert.equal(log[0].prefetched, false); assert.ok(log.slice(1).every(x => x.prefetched));
});

test('Stop during playback aborts the prefetch: nothing else is fetched or played, and the call returns', async () => {
  const { cd, fetches, audios } = load();
  let done = false;
  cd.speakAndWait(LONG, OPTS).then(() => { done = true; });
  await settle();
  assert.equal(fetches.length, 2);
  cd.stopSpeaking();
  await settle(60);
  assert.equal(done, true, 'speakAndWait resolves (the voice session can continue or end)');
  assert.equal(fetches[1].signal.aborted, true, 'prefetch aborted');
  assert.equal(audios.length, 1, 'no further audio played'); assert.equal(audios[0].paused, true);
  assert.equal(fetches.length, 2, 'no more segments requested');
  assert.equal(cd.busy(), false);
});
