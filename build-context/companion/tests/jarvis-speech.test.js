// Optional natural voice (relay → Google TTS): off by default, only reply text leaves, hard limits, key stays put.
const test = require('node:test');
const assert = require('node:assert/strict');
const { createSpeech, speakable, describeVoice } = require('../../relay-server/jarvisSpeech');
const { JarvisClient } = require('../src/jarvisClient');

const KEY = 'g'.repeat(39);
function relay(env = {}, { fail = false } = {}) {
  const calls = [];
  const fetchImpl = async (url, opts) => { calls.push({ url, headers: opts.headers, body: JSON.parse(opts.body) }); if (fail) return { ok: false, status: 500 }; return { ok: true, status: 200, json: async () => ({ audioContent: Buffer.from('MP3DATA').toString('base64') }) }; };
  const sp = createSpeech({ env: { JARVIS_TTS: 'google', JARVIS_TTS_GOOGLE_KEY: KEY, ...env }, fetchImpl });
  const call = (method, path, body, ip = '1.2.3.4') => new Promise(resolve => {
    const res = { writeHead(status, h) { this.status = status; this.h = h; }, end(b) { resolve({ status: this.status, type: this.h['content-type'], body: b }); } };
    sp.handle({ method, headers: { 'x-forwarded-for': ip }, socket: {} }, res, new URL('http://r' + path), { readJson: async () => body, sendJson: (_r, status, j) => resolve({ status, json: j }) })
      .then(handled => { if (!handled) resolve({ status: 'unhandled' }); });
  });
  return { sp, call, calls };
}

test('natural voice is off unless the owner configures it; voices are English-first with accent and gender', async () => {
  const off = createSpeech({ env: {} });
  const r = await new Promise(resolve => off.handle({ method: 'GET', headers: {}, socket: {} }, {}, new URL('http://r/api/jarvis/voices'), { sendJson: (_r, s, j) => resolve(j) }));
  assert.equal(r.enabled, false); assert.deepEqual(r.voices, []);
  const { call } = relay();
  const v = (await call('GET', '/api/jarvis/voices')).json;
  assert.equal(v.enabled, true);
  assert.ok(v.voices.some(x => x.id === 'en-GB-Chirp3-HD-Charon' && x.accent === 'British English' && x.gender === 'male'));
  assert.ok(v.voices.some(x => x.id === 'en-US-Chirp3-HD-Charon' && x.accent === 'American English'));
  assert.ok(!JSON.stringify(v).includes(KEY), 'key never in a response');
  assert.equal(describeVoice('not a voice'), null);
});

test('speak: only the cleaned reply text goes to the provider; audio comes back; samples are cached', async () => {
  const { call, calls } = relay();
  const body = { installId: 'kaw-test-0001', driverName: 'Ann', voice: 'en-GB-Chirp3-HD-Charon', text: 'Good evening, **driver**. See https://example.com 🚚 for more.' };
  const r = await call('POST', '/api/jarvis/speak', body);
  assert.equal(r.status, 200); assert.equal(r.type, 'audio/mpeg'); assert.equal(String(r.body), 'MP3DATA');
  assert.equal(calls.length, 1);
  assert.equal(calls[0].headers['x-goog-api-key'], KEY);
  assert.deepEqual(Object.keys(calls[0].body).sort(), ['audioConfig', 'input', 'voice']);
  assert.equal(calls[0].body.input.text, 'Good evening, driver. See for more.');
  assert.ok(!JSON.stringify(calls[0].body).includes('kaw-test-0001') && !JSON.stringify(calls[0].body).includes('Ann'), 'no install ID or name to the provider');
  await call('POST', '/api/jarvis/speak', body);
  assert.equal(calls.length, 1, 'the same sample is served from cache');
  assert.equal((await call('POST', '/api/jarvis/speak', { ...body, voice: 'en-US-Evil-Voice' })).status, 400);
  assert.equal((await call('POST', '/api/jarvis/speak', { ...body, installId: '' })).status, 400);
});

test('limits: per driver per hour and the monthly allowance; provider failure is a clean 502', async () => {
  const { call } = relay({ JARVIS_TTS_DRIVER_CHARS_HOUR: '50', JARVIS_TTS_MONTH_CHARS: '100000' });
  const say = (t, id = 'kaw-test-0001') => call('POST', '/api/jarvis/speak', { installId: id, voice: 'en-US-Chirp3-HD-Charon', text: t });
  assert.equal((await say('x'.repeat(40))).status, 200);
  const limited = await say('y'.repeat(40));
  assert.equal(limited.status, 429); assert.match(limited.json.error, /browser voice/);
  assert.equal((await say('z'.repeat(40), 'kaw-test-0002')).status, 200, 'another driver still has allowance');
  const month = relay({ JARVIS_TTS_MONTH_CHARS: '30' });
  assert.equal((await month.call('POST', '/api/jarvis/speak', { installId: 'kaw-test-0001', voice: 'en-US-Chirp3-HD-Charon', text: 'a'.repeat(40) })).json.error.includes('month'), true);
  assert.equal(month.calls.length, 0, 'over the allowance: the provider is never called');
  const bad = relay({}, { fail: true });
  const e = await bad.call('POST', '/api/jarvis/speak', { installId: 'kaw-test-0001', voice: 'en-US-Chirp3-HD-Charon', text: 'hello' });
  assert.equal(e.status, 502); assert.ok(!JSON.stringify(e.json).includes(KEY));
  assert.equal(speakable('One. Two. ' + 'x'.repeat(800), 100).length <= 101, true);
});

test('Companion client: lists only well-formed voices and returns audio bytes', async () => {
  const fetchImpl = async (url, opts) => url.endsWith('/voices')
    ? { ok: true, status: 200, headers: { get: () => 'application/json' }, text: async () => JSON.stringify({ enabled: true, voices: [{ id: 'en-GB-Chirp3-HD-Charon', name: 'Charon', english: true, gender: 'male' }, { id: '<script>', name: 'x' }] }) }
    : { ok: true, status: 200, headers: { get: () => 'audio/mpeg' }, arrayBuffer: async () => new TextEncoder().encode('MP3').buffer, body: opts.body };
  const c = new JarvisClient({ config: { jarvis: { url: 'https://relay.example' } }, fetchImpl, file: require('node:path').join(require('node:os').tmpdir(), 'kaw-jv-id.txt') });
  const v = await c.voices();
  assert.equal(v.voices.length, 1); assert.equal(v.enabled, true);
  assert.equal(String(await c.speak('Hello', 'en-GB-Chirp3-HD-Charon')), 'MP3');
});
