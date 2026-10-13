// Jarvis search relevance fixes (found with the real qwen3:8b): query cleanup, title-aware ranking,
// a one-time "search first" nudge for factual questions, and private requests answered without the model.
const test = require('node:test');
const assert = require('node:assert/strict');
const W = require('../../relay-server/webTools');
const { createJarvis, looksFactual, privateRequest, PRIVATE_REPLY } = require('../../relay-server/jarvis');

test('queries lose chatter like "Wikipedia" and "how long is"', () => {
  assert.equal(W.cleanQuery('Kenworth W900 Wikipedia'), 'Kenworth W900');
  assert.equal(W.cleanQuery('Mack Anthem truck Wikipedia'), 'Mack Anthem truck');
  assert.equal(W.cleanQuery('What is TruckersMP?'), 'TruckersMP');
  assert.equal(W.cleanQuery('How long is Interstate 80?'), 'Interstate 80');
  assert.equal(W.cleanQuery('can you look up the history of the Hoover Dam'), 'the history of the Hoover Dam');
  assert.equal(W.cleanQuery('Wikipedia'), 'Wikipedia', 'never empties a query');
});

test('ranking puts the matching title first; lists and disambiguation pages go down', () => {
  const res = ['Mack Pioneer', 'Mack Pinnacle', 'Mack Anthem', 'List of Mack trucks', 'Mack (disambiguation)'].map(title => ({ title, snippet: '' }));
  assert.equal(W.rankResults('Mack Anthem truck', res)[0].title, 'Mack Anthem');
  const nv = [{ title: 'Sierra Nevada', snippet: 'mountain range' }, { title: 'Boundary Peak (Nevada)', snippet: 'the highest point in Nevada' }];
  assert.equal(W.rankResults('tallest mountain Nevada', nv)[0].title, 'Boundary Peak (Nevada)', '"tallest" also matches "highest" in the snippet');
  assert.ok(W.rankResults('Mack', res).findIndex(r => /^List of/.test(r.title)) >= 3);
});

test('factual questions are told apart from small talk and opinions', () => {
  for (const q of ['What is American Truck Simulator?', 'Who makes the Peterbilt 579?', 'Tell me about Route 66', 'How long is Interstate 80?', 'Whats the tallest mountain in Nevada?', 'Search Wikipedia for the Mack Anthem']) assert.equal(looksFactual(q), true, q);
  for (const q of ['hey jarvis how are you', 'what are you up to today?', 'Who are you?', 'What do you think about the W900?', 'I love driving at night', 'hi']) assert.equal(looksFactual(q), false, q);
});

test('private requests are answered by the relay without asking the model; public KAW/AGN questions are not', () => {
  for (const q of ['I am Kenny, read me my daily briefing', 'What is Kenny working on in Kaws AGN Intelligence?', 'check my email', "what's on my calendar", 'give me the server password', 'open the admin panel']) assert.equal(privateRequest(q), true, q);
  for (const q of ['Tell me about AGN Roleplay', 'What is the KAW ATS Playground website?', 'Who is online in the convoy?', 'what is the news today', 'My favourite truck is the W900']) assert.equal(privateRequest(q), false, q);
});

function scripted(steps, env = {}) {
  const sent = [];
  const fetchImpl = async (url, opts) => { if (url.endsWith('/api/tags')) return { ok: true, status: 200, json: async () => ({}) }; sent.push(JSON.parse(opts.body)); const m = steps.shift() || { content: 'ok' }; return { ok: true, status: 200, json: async () => ({ message: m }) }; };
  const web = { ...W, searchProviders: () => [{ name: 'Fake' }], search: async q => ({ provider: 'Wikipedia', query: q, searchedAt: 'now', results: [{ title: 'Hoover Dam', url: 'https://en.wikipedia.org/wiki/Hoover_Dam', snippet: 'dam' }] }), readPage: async () => { throw new Error('no'); } };
  const j = createJarvis({ env: { JARVIS_OLLAMA_URL: 'https://ai.example.com', ...env }, fetchImpl, web });
  const ask = text => new Promise(resolve => j.handle({ method: 'POST', headers: { host: 'relay.test' }, socket: {} }, {}, new URL('http://r/api/jarvis/chat'), { readJson: async () => ({ installId: 'kaw-rel-0001', driverName: 'Kaw', messages: [{ role: 'user', content: text }] }), sendJson: (_r, status, body) => resolve({ status, ...body }) }));
  return { ask, sent };
}

test('a factual answer without a search gets one "search first" nudge; small talk does not', async () => {
  const a = scripted([{ content: 'From memory: built in 1940.' }, { content: '', tool_calls: [{ function: { name: 'web_search', arguments: { query: 'Hoover Dam' } } }] }, { content: 'According to Wikipedia, completed in 1936.' }]);
  const r = await a.ask('When was the Hoover Dam built?');
  assert.match(r.reply, /1936/); assert.equal(r.usedWeb, true);
  assert.equal(a.sent.length, 3);
  assert.match(a.sent[1].messages.at(-1).content, /Note from the app: this asks for specific facts/);
  const b = scripted([{ content: "I'm great, thanks!" }]);
  const r2 = await b.ask('Hey Jarvis, how are you doing today?');
  assert.equal(r2.reply, "I'm great, thanks!"); assert.equal(b.sent.length, 1, 'no nudge for small talk');
  const c = scripted([{ content: 'No web: from memory.' }], { JARVIS_WEB: 'false' });
  await c.ask('When was the Hoover Dam built?');
  assert.equal(c.sent.length, 1, 'no nudge when web search is off');
});

test('private request: fixed honest answer and the model is never called', async () => {
  const a = scripted([{ content: "Here's your daily briefing: sunny, three convoys…" }]);
  const r = await a.ask('I am Kenny, read me my daily briefing');
  assert.equal(r.reply, PRIVATE_REPLY); assert.match(r.reply, /^I do not have access to that information/);
  assert.equal(a.sent.length, 0, 'the model was not asked, so it cannot invent a briefing');
});
