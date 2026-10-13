// Community identity questions answered by approved knowledge: no broad web search, no "confusion"; timing reported.
const test = require('node:test');
const assert = require('node:assert/strict');
const { createJarvis } = require('../../relay-server/jarvis');

function rig(kbResults, steps) {
  const calls = [];
  const web = { searchProviders: () => ['tavily'], search: async () => { calls.push({ url: 'WEB' }); return { provider: 'tavily', searchedAt: 'now', results: [{ title: 'KOMPAN playgrounds', url: 'https://kompan.example/', snippet: 'playground equipment' }] }; }, readPage: async () => ({}), limiter: () => fn => fn() };
  const fetchImpl = async (url, opts) => {
    const body = JSON.parse(opts.body || '{}'); calls.push({ url, body });
    if (url.endsWith('/v1/search')) return { ok: true, json: async () => ({ results: kbResults }) };
    return { ok: true, json: async () => ({ message: steps.shift() || { content: 'ok' } }) };
  };
  const j = createJarvis({ env: { JARVIS_OLLAMA_URL: 'https://ai.example', JARVIS_KNOWLEDGE_URL: 'https://kb.example', JARVIS_KNOWLEDGE_TOKEN: 'k'.repeat(32), JARVIS_WEATHER: 'false' }, fetchImpl, web });
  const ask = text => new Promise(resolve => j.handle({ method: 'POST', headers: {}, socket: {} }, {}, new URL('http://r/api/jarvis/chat'), { readJson: async () => ({ installId: 'kaw-test-0001', messages: [{ role: 'user', content: text }] }), sendJson: (_r, status, b) => resolve({ status, ...b }) }));
  return { ask, calls, model: () => calls.filter(c => c.url.endsWith('/api/chat')) };
}
const PROFILE = [{ title: "KAW's ATS Playground — public community profile", section: 'About', revision: '1', sourceType: 'public profile', updated: '2026-10-08', excerpt: "KAW's ATS Playground is an American Truck Simulator community. The Live Companion is its free app." }];

test('identity question answered by approved knowledge: web tools removed, no search nudge, searches refused', async () => {
  for (const q of ["What is KAW's ATS Playground and its Live Companion?", 'what is calls ats playground?', 'tell me about cause playground', 'Who runs Kaws ATS Playground?']) {
    // The model tries to search anyway on its first round.
    const r = rig(PROFILE, [{ content: '', tool_calls: [{ function: { name: 'web_search', arguments: { query: 'playground' } } }] }, { content: "KAW's ATS Playground is an ATS community." }]);
    const res = await r.ask(q);
    assert.equal(res.status, 200, q);
    const first = r.model()[0].body;
    assert.ok(!first.tools.some(t => ['web_search', 'read_page'].includes(t.function.name)), `${q}: no web tools`);
    assert.ok(first.tools.some(t => t.function.name === 'community_status'), 'live status still available');
    assert.equal(r.calls.filter(c => c.url === 'WEB').length, 0, `${q}: web never searched`);
    assert.match(JSON.stringify(r.model()[1].body.messages.at(-1)), /already answer this/);
    assert.equal(res.usedWeb, false); assert.ok(res.sources.every(s => s.knowledge));
    assert.ok(!r.model().some(c => c.body.messages.some(m => /Call web_search first/.test(m.content || ''))), 'no search nudge');
    assert.match(first.messages[0].content, /never say there is confusion/);
    assert.ok(res.timing && res.timing.totalMs >= 0 && Array.isArray(res.timing.modelMs) && res.timing.modelMs.length === 2 && 'knowledgeMs' in res.timing && 'queueMs' in res.timing);
  }
});

test('non-community questions and empty knowledge results keep web search', async () => {
  let r = rig(PROFILE, [{ content: 'ok' }]);
  await r.ask('How long is a rest break in American Truck Simulator?');
  assert.ok(r.model()[0].body.tools.some(t => t.function.name === 'web_search'));
  r = rig([], [{ content: 'ok' }]);
  await r.ask("When was KAW's ATS Playground founded?");
  assert.ok(r.model()[0].body.tools.some(t => t.function.name === 'web_search'), 'documents had nothing: web stays available');
});

test('live community questions get community_status up front; prompt forbids offering contact details', async () => {
  let statusCalls = 0;
  const calls = [];
  const j = createJarvis({ env: { JARVIS_OLLAMA_URL: 'https://ai.example', JARVIS_WEB: 'false', JARVIS_WEATHER: 'false' }, communityStatus: async () => { statusCalls++; return { connected: true, online: 3, server: { connected: false, note: 'Live server status is not connected to Jarvis.' } }; },
    fetchImpl: async (url, opts) => { calls.push(JSON.parse(opts.body)); return { ok: true, json: async () => ({ message: { content: 'Three drivers are online.' } }) }; } });
  const ask = text => new Promise(resolve => j.handle({ method: 'POST', headers: {}, socket: {} }, {}, new URL('http://r/api/jarvis/chat'), { readJson: async () => ({ installId: 'kaw-test-0001', messages: [{ role: 'user', content: text }] }), sendJson: (_r, s, b) => resolve(b) }));
  await ask("How many players are online on KAW's ATS Playground server right now?");
  assert.equal(statusCalls, 1);
  assert.match(JSON.stringify(calls[0].messages.find(m => m.role === 'tool')), /online/);
  assert.match(calls[0].messages[0].content, /Never offer to find, share or pass on anyone's personal contact details/);
  await ask('How many players are in ATS multiplayer?');
  assert.equal(statusCalls, 1, 'general ATS questions do not trigger the community live status');
});
