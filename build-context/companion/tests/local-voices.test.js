const test = require('node:test');
const assert = require('node:assert/strict');
const { JarvisClient } = require('../src/jarvisClient');
test('local voices send speech only to fixed loopback and preserve WAV media type', async () => {
  let seen;
  const j = new JarvisClient({ config: {}, fetchImpl: async (url, opts) => {
    seen = { url, body: JSON.parse(opts.body) };
    return new Response(Buffer.from('RIFFtest'), { headers: { 'content-type': 'audio/wav' } });
  }});
  const audio = await j.speak('Hello driver.', 'en-GB-Kokoro-bm_george', 1);
  assert.equal(seen.url, 'http://127.0.0.1:4312/speak');
  assert.deepEqual(seen.body, { text: 'Hello driver.', voice: 'en-GB-Kokoro-bm_george', rate: 1 });
  assert.equal(audio.contentType, 'audio/wav');
});
test('unavailable local library falls back to existing relay catalog', async () => {
  const calls = [];
  const j = new JarvisClient({ config: {}, fetchImpl: async url => {
    calls.push(url);
    if (url.includes(':4312/')) throw Error('Offline');
    return new Response(JSON.stringify({ enabled: false, voices: [] }), { headers: { 'content-type': 'application/json' } });
  }});
  assert.equal((await j.voices()).enabled, false);
  assert.equal(calls.length, 2);
});
