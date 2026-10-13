// Voice packs: own recordings and imported packs. Runs in a temp folder; never touches real data.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'kaw-vp-'));
const cwd = process.cwd();
process.chdir(tmp);
const { VoicePacks, sniff, keyFor, KEYS } = require('../src/voicePack');
process.chdir(cwd);

// A tiny valid WAV (44-byte header + 0.1 s of silence).
function wav() {
  const data = Buffer.alloc(1600);
  const h = Buffer.alloc(44);
  h.write('RIFF', 0); h.writeUInt32LE(36 + data.length, 4); h.write('WAVE', 8); h.write('fmt ', 12);
  h.writeUInt32LE(16, 16); h.writeUInt16LE(1, 20); h.writeUInt16LE(1, 22); h.writeUInt32LE(8000, 24); h.writeUInt32LE(16000, 28); h.writeUInt16LE(2, 32); h.writeUInt16LE(16, 34);
  h.write('data', 36); h.writeUInt32LE(data.length, 40);
  return Buffer.concat([h, data]).toString('base64');
}

test('audio is identified by content, and file names map to callouts', () => {
  assert.equal(sniff(Buffer.from(wav(), 'base64')), 'wav');
  assert.equal(sniff(Buffer.from('OggS' + 'x'.repeat(20))), 'ogg');
  assert.equal(sniff(Buffer.from([0x1a, 0x45, 0xdf, 0xa3, 0, 0, 0, 0, 0, 0, 0, 0])), 'webm');
  assert.equal(sniff(Buffer.from('ID3' + 'x'.repeat(20))), 'mp3');
  assert.equal(sniff(Buffer.from('<html>not audio</html>')), null);
  assert.equal(keyFor('Speed_Limit.wav'), 'speedLimit');
  assert.equal(keyFor('FUEL.mp3'), 'fuel');
  assert.equal(keyFor('job-start.ogg'), 'jobStart');
  assert.equal(keyFor('random.wav'), null);
  assert.equal(KEYS.length, 16);
});

test('recordings are validated, stored per callout and replaced, never outside the pack folder', () => {
  const vp = new VoicePacks();
  assert.throws(() => vp.saveClip('my-voice', 'notACallout', wav()), /Unknown callout/);
  assert.throws(() => vp.saveClip('my-voice', 'fuel', Buffer.from('<script>').toString('base64')), /WAV, OGG, MP3 or WebM/);
  assert.throws(() => vp.saveClip('my-voice', 'fuel', 'not base64!!'), /not valid audio/);
  assert.throws(() => vp.saveClip('my-voice', 'fuel', Buffer.alloc(2 * 1024 * 1024).toString('base64')), /too long/);
  const r = vp.saveClip('my-voice', 'fuel', wav());
  assert.equal(r.ext, 'wav');
  vp.saveClip('my-voice', 'fuel', wav());
  const pack = vp.list().find(p => p.id === 'my-voice');
  assert.equal(pack.name, 'My voice');
  assert.deepEqual(Object.keys(pack.clips), ['fuel']);
  assert.equal(vp.clip('my-voice', 'fuel').type, 'audio/wav');
  assert.equal(vp.clip('../../etc', 'fuel'), null);
  assert.equal(vp.clip('my-voice', '../config'), null);
  assert.ok(fs.existsSync(path.join(tmp, 'data', 'voicepacks', 'my-voice', 'fuel.wav')));
});

test('imported packs match file names, report skipped files and can be activated and deleted', () => {
  const vp = new VoicePacks();
  const res = vp.importPack('Trucker Joe', 'Joe (with permission)', [{ name: 'halfway.wav', audio: wav() }, { name: 'Fuel.WAV', audio: wav() }, { name: 'readme.wav', audio: wav() }]);
  assert.equal(res.id, 'trucker-joe');
  assert.deepEqual(res.imported.sort(), ['fuel', 'halfway']);
  assert.match(res.skipped[0], /readme/);
  assert.throws(() => vp.importPack('My voice', '', [{ name: 'fuel.wav', audio: wav() }]), /not "My voice"/);
  assert.throws(() => vp.importPack('Empty', '', [{ name: 'nope.wav', audio: wav() }]), /No clips matched/);
  assert.equal(vp.list().some(p => p.id === 'empty'), false, 'a failed import leaves no empty pack');
  assert.throws(() => vp.update({ active: 'missing-pack' }), /does not exist/);
  assert.equal(vp.update({ active: 'trucker-joe', speakDetails: false }).active, 'trucker-joe');
  vp.deleteClip('trucker-joe');
  assert.equal(vp.settings.active, '', 'deleting the active pack switches back to the normal voice');
  assert.equal(vp.list().some(p => p.id === 'trucker-joe'), false);
});

test('voice pack routes are local-only and accept large uploads', async () => {
  process.chdir(tmp);
  const { handleAi } = require('../src/apiAi');
  process.chdir(cwd);
  const vp = new VoicePacks();
  const call = (method, pathname, body, remote = '127.0.0.1', host = '127.0.0.1:4280') => new Promise(resolve => {
    const chunks = body ? [Buffer.from(JSON.stringify(body))] : [];
    const req = { method, headers: { host }, socket: { remoteAddress: remote }, on(ev, fn) { if (ev === 'data') chunks.forEach(c => fn(c)); if (ev === 'end') setImmediate(fn); return this; }, destroy() {} };
    const res = { status: 0, headers: {}, writeHead(s, h) { this.status = s; Object.assign(this.headers, h || {}); }, setHeader() {}, end(b) { resolve({ status: this.status, body: b }); } };
    handleAi(req, res, new URL(`http://127.0.0.1:4280${pathname}`), { voicePacks: vp, config: {}, state: {}, ai: { settings: {} } });
  });
  const lan = await call('GET', '/api/ai/voicepack', null, '192.168.1.20', '192.168.1.5:4280');
  assert.equal(lan.status, 403);
  const big = await call('POST', '/api/ai/voicepack/clip', { pack: 'my-voice', key: 'rest', audio: wav() });
  assert.equal(big.status, 200);
  const clip = await call('GET', '/api/ai/voicepack/clip?pack=my-voice&key=rest');
  assert.equal(clip.status, 200);
  assert.equal(Buffer.from(clip.body).toString('latin1', 0, 4), 'RIFF');
});
