// Jarvis: relay side (KAW's AI behind Cloudflare Access) and Companion side (what leaves the PC).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createJarvis, systemPrompt } = require('../../relay-server/jarvis');
const { JarvisClient, cleanJarvisUrl } = require('../src/jarvisClient');

// Minimal req/res doubles shaped like the relay's.
function call(jarvis, method, pathname, body, headers = {}) {
  return new Promise(resolve => {
    const req = { method, headers: { 'x-forwarded-for': headers.ip || '203.0.113.5', ...headers }, socket: { remoteAddress: '10.0.0.1' } };
    const res = {};
    const sendJson = (_res, status, json) => resolve({ status, ...json });
    jarvis.handle(req, res, new URL(`http://relay${pathname}`), { readJson: async () => body || {}, sendJson }).then(handled => { if (!handled) resolve({ status: 'unhandled' }); });
  });
}
const ENV = { JARVIS_OLLAMA_URL: 'https://kaw-ai.example.com/', JARVIS_CF_CLIENT_ID: 'id.access', JARVIS_CF_CLIENT_SECRET: 'top-secret', JARVIS_ADMIN_KEY: 'owner-key-123', JARVIS_PER_DRIVER_HOUR: '3', JARVIS_PER_IP_HOUR: '5', JARVIS_GLOBAL_HOUR: '100' };
const msg = t => ({ installId: 'kaw-test-install-1', driverName: 'Ann', messages: [{ role: 'user', content: t }], context: { truck: 'Peterbilt 579', cargo: 'Lumber', speedMph: 61, secretField: 'nope' } });

test('relay Jarvis: talks to KAW\'s AI with the Access token, own instructions, no secrets in the prompt', async () => {
  const seen = [];
  const fakeAi = async (url, opts) => {
    seen.push({ url, opts });
    if (url.endsWith('/api/tags')) return { ok: true, status: 200, json: async () => ({ models: [] }) };
    return { ok: true, status: 200, json: async () => ({ message: { content: '<think>hmm</think>Ten-four, Ann! Lumber to the coast?' } }) };
  };
  const j = createJarvis({ env: ENV, fetchImpl: fakeAi });
  const st = await call(j, 'GET', '/api/jarvis/status');
  assert.equal(st.online, true); assert.equal(st.name, 'Jarvis');
  const r = await call(j, 'POST', '/api/jarvis/chat', msg('Hi Jarvis!'));
  assert.equal(r.status, 200); assert.equal(r.reply, 'Ten-four, Ann! Lumber to the coast?', 'thinking is stripped');
  const chatCall = seen.find(s => s.url.endsWith('/api/chat'));
  assert.equal(chatCall.url, 'https://kaw-ai.example.com/api/chat');
  assert.equal(chatCall.opts.headers['CF-Access-Client-Id'], 'id.access'); assert.equal(chatCall.opts.headers['CF-Access-Client-Secret'], 'top-secret');
  const body = JSON.parse(chatCall.opts.body);
  assert.equal(body.model, 'qwen3:8b'); assert.equal(body.think, false); assert.equal(body.stream, false);
  const sys = body.messages[0];
  assert.equal(sys.role, 'system'); assert.match(sys.content, /You are Jarvis, KAW's assistant/); assert.match(sys.content, /I do not have access to that information/); assert.match(sys.content, /no permanent memory/);
  assert.match(sys.content, /Peterbilt 579/); assert.doesNotMatch(sys.content, /nope|top-secret|kaw-ai\.example/, 'only allowlisted facts, never secrets or the address');
  assert.equal(body.messages.length, 2, 'system + the driver message');
  assert.ok(!JSON.stringify(r).includes('top-secret'));
});

test('relay Jarvis: bad input, fair-use limits, one answer at a time, owner pause', async () => {
  let release;
  const slow = async url => url.endsWith('/api/tags') ? { ok: true, status: 200, json: async () => ({}) } : new Promise(res => { release = () => res({ ok: true, status: 200, json: async () => ({ message: { content: 'ok' } }) }); });
  const j = createJarvis({ env: { ...ENV, JARVIS_MAX_QUEUE: '1' }, fetchImpl: slow });
  assert.equal((await call(j, 'POST', '/api/jarvis/chat', { ...msg('x'), installId: 'bad id!' })).status, 400);
  assert.equal((await call(j, 'POST', '/api/jarvis/chat', { installId: 'kaw-test-install-1', messages: [{ role: 'assistant', content: 'x' }] })).status, 400, 'last message must be the driver');
  // First chat runs, second waits in line, third is told Jarvis is busy.
  const first = call(j, 'POST', '/api/jarvis/chat', msg('one'));
  await new Promise(r => setTimeout(r, 10));
  const second = call(j, 'POST', '/api/jarvis/chat', { ...msg('two'), installId: 'kaw-test-install-2' });
  await new Promise(r => setTimeout(r, 10));
  assert.equal((await call(j, 'POST', '/api/jarvis/chat', { ...msg('three'), installId: 'kaw-test-install-3' })).status, 503);
  release(); assert.equal((await first).reply, 'ok');
  await new Promise(r => setTimeout(r, 10)); release(); assert.equal((await second).reply, 'ok');
  // Per-driver limit (3/hour; this driver has used 1).
  const fast = createJarvis({ env: ENV, fetchImpl: async () => ({ ok: true, status: 200, json: async () => ({ message: { content: 'hi' } }) }) });
  for (let i = 0; i < 3; i++) assert.equal((await call(fast, 'POST', '/api/jarvis/chat', msg(`m${i}`))).status, 200);
  assert.equal((await call(fast, 'POST', '/api/jarvis/chat', msg('again'))).status, 429, 'per-driver limit');
  // Same IP, new installs: 2 more fit under the 5/hour IP limit (refused requests don't count), then the IP is capped.
  assert.equal((await call(fast, 'POST', '/api/jarvis/chat', { ...msg('new id same ip'), installId: 'kaw-test-install-9' })).status, 200);
  assert.equal((await call(fast, 'POST', '/api/jarvis/chat', { ...msg('again'), installId: 'kaw-test-install-9' })).status, 200);
  assert.equal((await call(fast, 'POST', '/api/jarvis/chat', { ...msg('x'), installId: 'kaw-test-install-8' })).status, 429, 'per-IP limit (5/hour)');
  // Owner controls.
  assert.equal((await call(fast, 'POST', '/api/jarvis/admin/pause', {}, { authorization: 'Bearer wrong-key-xyz' })).status, 403);
  assert.equal((await call(fast, 'POST', '/api/jarvis/admin/pause', {}, { authorization: 'Bearer owner-key-123' })).paused, true);
  const paused = await call(fast, 'GET', '/api/jarvis/status');
  assert.equal(paused.online, false); assert.match(paused.message, /stepped out/);
  assert.equal((await call(fast, 'POST', '/api/jarvis/chat', { ...msg('hi'), installId: 'kaw-test-install-7', }, { ip: '198.51.100.9' })).status, 503);
  const stats = await call(fast, 'GET', '/api/jarvis/admin/stats', null, { authorization: 'Bearer owner-key-123' });
  assert.equal(stats.chats, 5); assert.ok(stats.limited >= 2); assert.equal(stats.paused, true);
  assert.equal(JSON.stringify(stats).includes('m0'), false, 'chat text is never kept');
});

test('relay Jarvis: off until set up, and reports the AI being down', async () => {
  assert.equal((await call(createJarvis({ env: {} }), 'GET', '/api/jarvis/status')).online, false);
  const down = createJarvis({ env: ENV, fetchImpl: async () => { throw new TypeError('fetch failed'); } });
  assert.equal((await call(down, 'GET', '/api/jarvis/status')).online, false);
  const r = await call(down, 'POST', '/api/jarvis/chat', msg('hello?'));
  assert.equal(r.status, 503); assert.match(r.error, /can't reach the office/);
  assert.equal((await call(down, 'GET', '/api/other')).status, 'unhandled');
  assert.match(systemPrompt('Bob', {}), /person's name is Bob\./);
});

test('Companion Jarvis client: stable install ID, safe trip facts only, sensible relay address', async () => {
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'kaw-jarvis-')), 'id.txt');
  let sent = null;
  const c = new JarvisClient({ config: { driverName: 'Kaw', remote: { endpoint: 'https://ats.kawsplayground.online/api/telemetry', apiKey: 'relay-key' }, jarvis: {} }, file, fetchImpl: async (url, opts) => { sent = { url, body: JSON.parse(opts.body) }; return { ok: true, status: 200, headers: new Headers({ 'content-type': 'application/json' }), text: async () => JSON.stringify({ ok: true, reply: 'Howdy!' }) }; } });
  const id = c.installId(); assert.match(id, /^kaw-[0-9a-f-]{36}$/); assert.equal(c.installId(), id, 'same ID every time');
  const state = { connected: true, truck: { make: 'Kenworth', model: 'W900', speedMph: 55.4, licensePlate: 'SECRET' }, job: { active: true, cargo: 'Cars', originCity: 'Reno', destinationCity: 'Elko', income: 99999 }, positioning: { x: 1, z: 2 } };
  const r = await c.chat([{ role: 'user', content: 'hi' }], state, { near: 'Lovelock', state: 'Nevada', lon: -118, lat: 40 });
  assert.equal(r.reply, 'Howdy!');
  assert.equal(sent.url, 'https://ats.kawsplayground.online/api/jarvis/chat');
  assert.deepEqual(sent.body.context, { truck: 'Kenworth W900', speedMph: 55, cargo: 'Cars', from: 'Reno', to: 'Elko', near: 'Lovelock', state: 'Nevada' });
  const raw = JSON.stringify(sent.body);
  for (const secret of ['SECRET', '99999', 'relay-key', '-118']) assert.ok(!raw.includes(secret), `${secret} never leaves the PC`);
  assert.equal(new JarvisClient({ config: { jarvis: { url: 'http://evil.example' } } }).base(), 'https://p01--kaw-relay--4h7w2xmhzqqq.code.run', 'plain-http relays are refused');
  assert.equal(new JarvisClient({ config: { jarvis: { enabled: false } } }).enabled, false);
});

test('Companion Jarvis client: a sign-in web page or redirect gives a clear wrong-address message', async () => {
  const page = '<!DOCTYPE html><html><title>Sign in ・ Cloudflare Access</title></html>';
  const html = new JarvisClient({ config: { jarvis: { url: 'https://ats.kawsplayground.online' } }, file: path.join(os.tmpdir(), 'kaw-j-id.txt'), fetchImpl: async () => ({ ok: true, status: 200, headers: new Headers({ 'content-type': 'text/html' }), text: async () => page }) });
  const st = await html.status();
  assert.equal(st.online, false); assert.match(st.message, /answered with a web page \(a sign-in \/ Cloudflare Access page\)/); assert.equal(st.custom, true); assert.equal(st.relay, 'https://ats.kawsplayground.online');
  await assert.rejects(html.chat([{ role: 'user', content: 'hi' }], {}), /sign-in \/ Cloudflare Access page/);
  const redirect = new JarvisClient({ config: {}, file: path.join(os.tmpdir(), 'kaw-j-id.txt'), fetchImpl: async () => ({ ok: false, status: 302, headers: new Headers(), text: async () => '' }) });
  assert.match((await redirect.status()).message, /redirected to a sign-in page/);
  const slow = new JarvisClient({ config: {}, file: path.join(os.tmpdir(), 'kaw-j-id.txt'), fetchImpl: async () => { throw Object.assign(new Error('t'), { name: 'TimeoutError' }); } });
  await assert.rejects(slow.chat([{ role: 'user', content: 'hi' }], {}), /took too long/);
  const limited = new JarvisClient({ config: {}, file: path.join(os.tmpdir(), 'kaw-j-id.txt'), fetchImpl: async () => ({ ok: false, status: 429, headers: new Headers({ 'content-type': 'application/json' }), text: async () => JSON.stringify({ ok: false, error: 'Jarvis needs a coffee break' }) }) });
  await assert.rejects(limited.chat([{ role: 'user', content: 'hi' }], {}), /coffee break/);
  // Jarvis-only address: https or a local test relay, never plain http elsewhere; '' = convoy relay.
  assert.equal(cleanJarvisUrl('https://p01--kaw-jarvis-preview.code.run/some/path'), 'https://p01--kaw-jarvis-preview.code.run');
  assert.equal(cleanJarvisUrl(''), ''); assert.equal(cleanJarvisUrl('http://evil.example'), null); assert.equal(cleanJarvisUrl('javascript:alert(1)'), null);
  assert.equal(cleanJarvisUrl('http://127.0.0.1:4391'), 'http://127.0.0.1:4391');
  const convoy = new JarvisClient({ config: { remote: { endpoint: 'https://backup.example/api/telemetry' } } });
  assert.equal(convoy.base(), 'https://backup.example'); assert.equal(convoy.custom, false);
});
