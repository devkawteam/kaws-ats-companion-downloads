// Fixes from KAW's first test run: AI design helper (local Ollama), TruckersMP link, QR button guidance.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { designWithAi } = require('../src/apiLivery');
const { TruckersMp } = require('../src/communityExtras');

const ollama = content => async (url, opts) => {
  assert.equal(url, 'http://127.0.0.1:11434/api/chat', 'only the local Ollama is called');
  const body = JSON.parse(opts.body);
  assert.equal(body.format, 'json'); assert.match(body.messages[1].content, /flames/);
  return { ok: true, status: 200, json: async () => ({ message: { content } }) };
};

test('AI design helper turns the local AI answer into clean layers', async () => {
  const answer = JSON.stringify({ layers: [
    { type: 'fill', mode: 'linear', c1: '#000000', c2: '#202020', angle: 90 },
    { type: 'pattern', kind: 'flames', c1: '#ffcc00', c2: '#ff3300', c3: '#000000', scale: 0.1, opacity: 0.9 },
    { type: 'stripe', color: '#d4af37', count: 2, y: 0.7 },
    { type: 'text', text: 'KAW TRUCKING', color: '#ffffff', size: 0.1 },
    { type: 'script', evil: true },
    { type: 'image', src: 'https://evil.example/x.png' }
  ] });
  const layers = await designWithAi('black with orange flames and gold pinstripes', { model: 'qwen3:8b' }, ollama(answer));
  assert.deepEqual(layers.map(l => l.type), ['fill', 'pattern', 'stripe', 'text', 'image']);
  assert.equal(layers[4].src, '', 'outside images are never loaded');
  assert.equal(layers[3].text, 'KAW TRUCKING');
  // Bare array answers and <think> blocks are tolerated.
  assert.equal((await designWithAi('flames', {}, ollama('<think>hm</think>[{"type":"fill","c1":"#112233"}]'))).length, 1);
  await assert.rejects(designWithAi('flames', {}, ollama('not json')), /not a design/);
  await assert.rejects(designWithAi('flames', {}, ollama('{"layers":[{"type":"nope"}]}')), /no usable layers|did not return/i);
  await assert.rejects(designWithAi('  ', {}, ollama('{}')), /Describe/);
  await assert.rejects(designWithAi('flames', {}, async () => { throw new TypeError('fetch failed'); }), /Ollama\) is not running/);
  await assert.rejects(designWithAi('flames', { model: 'big:70b' }, async () => ({ ok: false, status: 404 })), /"big:70b" is not installed/);
});

test('TruckersMP link: saved across restarts, clear messages for bad IDs and website problems', async () => {
  const saved = [];
  const api = async url => {
    const id = url.split('/').pop();
    if (url.endsWith('/servers')) return { status: 200, text: async () => JSON.stringify({ response: [{ id: 1, game: 'ATS', name: 'Simulation', shortname: 'SIM', online: true, players: 5, maxplayers: 1000 }] }) };
    if (id === '12345') return { status: 200, text: async () => JSON.stringify({ error: false, response: { id: 12345, name: 'Kaw', avatar: 'https://static.truckersmp.com/a.png', joinDate: '2020-01-01', groupName: 'Player', vtc: { inVTC: true, name: 'KAW Logistics', tag: 'KAW' } } }) };
    if (id === '666') return { status: 403, text: async () => '<html>Just a moment...</html>' };
    return { status: 404, text: async () => JSON.stringify({ error: true, response: 'Unable to find player with that ID.' }) };
  };
  const tmp = new TruckersMp({}, next => saved.push(next), api);
  assert.equal(tmp.setPlayerId('https://truckersmp.com/user/12345'), '12345', 'a pasted profile link works');
  assert.deepEqual(saved.at(-1), { playerId: '12345' });
  const p = await tmp.player();
  assert.equal(p.found, true); assert.equal(p.name, 'Kaw'); assert.deepEqual(p.vtc, { name: 'KAW Logistics', tag: 'KAW' });
  assert.equal((await new TruckersMp({ playerId: '12345' }, null, api).player()).name, 'Kaw', 'saved ID is used after a restart');
  tmp.setPlayerId('999');
  const missing = await tmp.player();
  assert.equal(missing.found, false); assert.match(missing.reason, /No TruckersMP player found for ID 999/);
  tmp.setPlayerId('666');
  await assert.rejects(tmp.player(), /didn't answer normally \(HTTP 403\)/);
  assert.equal((await tmp.servers())[0].name, 'Simulation');
  tmp.setPlayerId(''); assert.deepEqual(saved.at(-1), { playerId: null }, 'clearing the link is saved too');
});

test('QR button explains what to do instead of silently doing nothing', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'public', 'app-devices.js'), 'utf8');
  assert.doesNotMatch(src, /q\('#dvCreate'\)\.disabled\s*=/, 'the Create QR code button is never silently disabled');
  assert.match(src, /if \(blocked\) \{[^}]*dvWhy/, 'clicking while blocked shows the reason');
  assert.match(src, /press Ctrl\+C, then run npm start again/, 'restart steps for npm start users');
  assert.match(src, /Close the Companion window and open it again/, 'restart steps for the installed app');
});
