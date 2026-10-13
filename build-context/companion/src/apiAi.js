// Local-only AI and optional speech bridge. Author: Kaw.
const { json, readBody } = require('./apiDrive');
const { normalizeAi, telemetryContext } = require('./localAi');
const { saveConfigSection } = require('./config');
const SPEECH = 'http://127.0.0.1:4281';
const loopback = address => ['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(address);
function trustedLocal(req) {
  if (!loopback(req.socket.remoteAddress)) return false;
  try {
    const host = new URL(`http://${req.headers.host}`).hostname;
    if (!['localhost', '127.0.0.1', '[::1]'].includes(host)) return false;
    if (req.headers.origin && req.headers.origin !== `http://${req.headers.host}`) return false;
    if (req.headers['sec-fetch-site'] === 'cross-site') return false;
    return true;
  } catch { return false; }
}
async function bridge(route, body) {
  const response = await fetch(`${SPEECH}${route}`, { method: body === undefined ? 'GET' : 'POST', redirect: 'error', signal: AbortSignal.timeout(route === '/health' || route === '/voices' ? 3000 : 60000), headers: { 'content-type': 'application/json' }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  if (!response.ok) { const detail = await response.json().catch(() => ({})); throw new Error(detail.error || `Speech bridge HTTP ${response.status}`); }
  return response;
}
// Audio uploads need more room than the default 256 KB JSON limit.
function readBig(req, limit) {
  return new Promise((resolve, reject) => {
    const chunks = []; let size = 0;
    req.on('data', c => { size += c.length; if (size > limit) { reject(new Error('Upload is too large.')); req.destroy(); } else chunks.push(c); });
    req.on('end', () => { try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}')); } catch (e) { reject(e); } });
    req.on('error', reject);
  });
}
async function handleAi(req, res, url, s) {
  if (!url.pathname.startsWith('/api/ai/')) return false;
  if (!trustedLocal(req)) return json(res, { ok: false, error: 'Use http://127.0.0.1:4280 on the PC running the Companion for local AI and offline speech.' }, 403);
  try {
    if (url.pathname === '/api/ai/status' && req.method === 'GET') return json(res, { ok: true, ...(await s.ai.models()), telemetry: telemetryContext(s.state) });
    if (url.pathname === '/api/ai/settings' && req.method === 'POST') {
      const next = normalizeAi({ ...s.ai.settings, ...(await readBody(req)) });
      saveConfigSection('ai', next); s.ai.settings = next; s.config.ai = next;
      return json(res, { ok: true, settings: next });
    }
    if (url.pathname === '/api/ai/chat' && req.method === 'POST') {
      const b = await readBody(req);
      return json(res, { ok: true, ...(await s.ai.ask(b.question, s.state, b.personality)) });
    }
    if (url.pathname === '/api/ai/speech' && req.method === 'GET') {
      try { const r = await bridge('/health'); return json(res, { ok: true, ...(await r.json()) }); }
      catch { return json(res, { ok: true, available: false, voices: [], error: 'Start the optional local speech bridge on port 4281.' }); }
    }
    if (url.pathname === '/api/ai/speak' && req.method === 'POST') {
      const b = await readBody(req);
      if (typeof b.text !== 'string' || !b.text.trim() || b.text.length > 1800 || !/^[\w.-]{1,100}$/.test(b.voice || '')) return json(res, { ok: false, error: 'Select a downloaded voice and enter a short message.' }, 400);
      const r = await bridge('/speak', { text: b.text, voice: b.voice });
      const audio = Buffer.from(await r.arrayBuffer());
      res.writeHead(200, { 'content-type': 'audio/wav', 'cache-control': 'no-store' }); return res.end(audio);
    }
    if (url.pathname === '/api/ai/transcribe' && req.method === 'POST') {
      const b = await readBody(req);
      if (typeof b.audio !== 'string' || b.audio.length > 240000 || !/^[A-Za-z0-9+/]*={0,2}$/.test(b.audio)) return json(res, { ok: false, error: 'Recording is too large. Record a shorter question.' }, 400);
      const r = await bridge('/transcribe', { audio: b.audio });
      return json(res, { ok: true, ...(await r.json()) });
    }
    // ---- voice packs (own recordings / imported packs; local PC only) ----
    const vp = s.voicePacks;
    if (vp && url.pathname.startsWith('/api/ai/voicepack')) {
      const p = url.pathname;
      if (p === '/api/ai/voicepack' && req.method === 'GET') return json(res, { ok: true, ...vp.view() });
      if (p === '/api/ai/voicepack/clip' && req.method === 'GET') {
        const clip = vp.clip(url.searchParams.get('pack'), url.searchParams.get('key'));
        if (!clip) return json(res, { ok: false, error: 'No clip recorded for that callout.' }, 404);
        res.writeHead(200, { 'content-type': clip.type, 'cache-control': 'no-store' }); return res.end(clip.body);
      }
      if (req.method !== 'POST') return json(res, { ok: false, error: 'Method not allowed' }, 405);
      if (p === '/api/ai/voicepack/settings') { const settings = vp.update(await readBody(req)); saveConfigSection('voicePack', settings); s.config.voicePack = settings; return json(res, { ok: true, ...vp.view() }); }
      if (p === '/api/ai/voicepack/clip') { const b = await readBig(req, 3 * 1024 * 1024); return json(res, { ok: true, clip: vp.saveClip(b.pack || 'my-voice', b.key, b.audio), ...vp.view() }); }
      if (p === '/api/ai/voicepack/delete') { const b = await readBody(req); vp.deleteClip(b.pack, b.key); saveConfigSection('voicePack', vp.settings); return json(res, { ok: true, ...vp.view() }); }
      if (p === '/api/ai/voicepack/import') { const b = await readBig(req, 40 * 1024 * 1024); return json(res, { ok: true, result: vp.importPack(b.name, b.author, b.files), ...vp.view() }); }
      return json(res, { ok: false, error: 'Unknown voice pack route.' }, 404);
    }
    return json(res, { ok: false, error: 'Unknown AI route or method.' }, 404);
  } catch (e) { return json(res, { ok: false, error: e.message }, 400); }
}
module.exports = { handleAi, trustedLocal };
