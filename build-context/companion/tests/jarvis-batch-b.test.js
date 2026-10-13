// Jarvis in Discord (service + relay bot lane) and Radio DJ lines.
const test = require('node:test');
const assert = require('node:assert/strict');
const { createJarvisDiscord, normalizeJarvis } = require('../../bot/src/services/jarvisDiscord');
const { createJarvis } = require('../../relay-server/jarvis');
const DJ = require('../public/app-radiodj');

test('Discord Jarvis: off by default, anonymous id, cooldown, short memory, no pings, links only', async () => {
  assert.equal(normalizeJarvis({}).enabled, false);
  assert.equal(normalizeJarvis({ channelId: 'not-a-number' }).channelId, '');
  let clock = 0, sent = [];
  const fetchImpl = async (url, opts) => { sent.push({ url, headers: opts.headers, body: JSON.parse(opts.body) }); return { ok: true, status: 200, headers: new Headers({ 'content-type': 'application/json' }), json: async () => ({ ok: true, reply: 'Ten-four!', sources: [{ title: 'W900', url: 'https://en.wikipedia.org/wiki/Kenworth_W900' }, { url: 'javascript:alert(1)' }] }) }; };
  const j = createJarvisDiscord(normalizeJarvis({ enabled: true, relayUrl: 'https://relay.example/', botKey: 'k'.repeat(24), cooldownSeconds: 10 }), { fetchImpl, now: () => clock });
  const out = await j.ask('123456789', 'Ann <@everyone>', 'hello');
  assert.equal(sent[0].url, 'https://relay.example/api/jarvis/chat');
  assert.match(sent[0].body.installId, /^discord-[0-9a-f]{32}$/); assert.ok(!sent[0].body.installId.includes('123456789'), 'real Discord id is not sent');
  assert.equal(sent[0].headers['x-jarvis-bot-key'], 'k'.repeat(24));
  await assert.rejects(j.ask('123456789', 'Ann', 'again'), /Give Jarvis \d+ more second/);
  clock += 11000; await j.ask('123456789', 'Ann', 'second');
  assert.deepEqual(sent[1].body.messages.map(m => m.role), ['user', 'assistant', 'user'], 'remembers the last few messages');
  const text = j.format(out);
  assert.match(text, /^Ten-four!/); assert.match(text, /<https:\/\/en\.wikipedia\.org\/wiki\/Kenworth_W900>/); assert.doesNotMatch(text, /javascript/);
  assert.ok(text.length < 2000);
  j.forget('123456789'); clock += 11000; await j.ask('123456789', 'Ann', 'fresh');
  assert.equal(sent[2].body.messages.length, 1, 'forget clears memory');
  const off = createJarvisDiscord(normalizeJarvis({}));
  await assert.rejects(off.ask('1', 'x', 'hi'), /not switched on/);
  const html = createJarvisDiscord(normalizeJarvis({ enabled: true, relayUrl: 'https://r.example' }), { fetchImpl: async () => ({ ok: true, status: 200, headers: new Headers({ 'content-type': 'text/html' }), json: async () => ({}) }) });
  await assert.rejects(html.ask('2', 'x', 'hi'), /web page instead of an answer/);
});

test('relay: the bot key gives the Discord bot its own lane; wrong or short keys do not', async () => {
  const fetchImpl = async url => ({ ok: true, status: 200, json: async () => (url.endsWith('/api/tags') ? {} : { message: { content: 'hi' } }) });
  const j = createJarvis({ env: { JARVIS_OLLAMA_URL: 'https://ai.example', JARVIS_WEB: 'false', JARVIS_PER_IP_HOUR: '2', JARVIS_BOT_KEY: 'b'.repeat(24), JARVIS_BOT_PER_HOUR: '5' }, fetchImpl });
  const call = (id, key) => new Promise(resolve => j.handle({ method: 'POST', headers: { host: 'r', 'x-forwarded-for': '198.51.100.1', ...(key ? { 'x-jarvis-bot-key': key } : {}) }, socket: {} }, {}, new URL('http://r/api/jarvis/chat'), { readJson: async () => ({ installId: id, messages: [{ role: 'user', content: 'hi' }] }), sendJson: (_r, status) => resolve(status) }));
  assert.equal(await call('discord-aaaaaaaa1'), 200); assert.equal(await call('discord-aaaaaaaa2'), 200);
  assert.equal(await call('discord-aaaaaaaa3'), 429, 'without the key the shared address is limited');
  assert.equal(await call('discord-aaaaaaaa4', 'b'.repeat(24)), 200, 'bot lane');
  assert.equal(await call('discord-aaaaaaaa5', 'wrong'.repeat(5)), 429, 'wrong key is not the bot');
});

test('Radio DJ: welcomes newcomers, trip progress, convoy and weather — built from local data', () => {
  const first = DJ.joinedSince(null, [{ driverName: 'Ann', online: true }]);
  assert.deepEqual(first.joined, [], 'no welcome for people already online at start');
  const next = DJ.joinedSince(first.online, [{ driverName: 'Ann', online: true }, { driverName: 'Bob', online: true }, { driverName: 'Me', online: true, isLocal: true }]);
  assert.deepEqual(next.joined, ['Bob']);
  assert.equal(DJ.djLine({}, { kind: 'joins', joined: ['Bob', 'Cy'] }), "Welcome to the convoy, Bob and Cy! Pull up a chair, the radio's on.");
  const now = Date.parse('2026-10-07T18:00:00Z');
  const line = DJ.djLine({ job: { active: true, destinationCity: 'Elko' }, navigation: { distanceMiles: 212, restStopMinutes: 45 }, convoy: { roster: [{ online: true }, { online: true }] } }, { stationName: 'Truckin FM', now, events: [{ name: 'Friday Haul', departureTime: '2026-10-07T19:30:00Z' }], weather: { enabled: true, now: { temperatureF: 61, short: 'Light Rain' } } });
  assert.match(line, /Truckin FM/); assert.match(line, /212 miles to go to Elko/); assert.match(line, /Rest break due in about 45 minutes/);
  assert.match(line, /2 drivers on the relay/); assert.match(line, /Friday Haul convoy rolls out in 90 minutes/); assert.match(line, /61 degrees and light rain/);
  assert.doesNotMatch(DJ.djLine({}, { weather: { enabled: false, now: { temperatureF: 1 } } }), /degrees/, 'weather only when turned on');
});
