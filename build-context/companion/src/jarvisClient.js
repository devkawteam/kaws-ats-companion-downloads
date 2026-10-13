// Jarvis chat: passes the driver's messages to KAW's relay, which talks to KAW's office AI.
// Only a random install ID (for fair-use limits), the driver name and a few trip facts go along;
// never config, keys, pairing codes or other drivers. Author: Kaw.
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const { DEFAULT_RELAY } = require('./relayDefaults');

// The Jarvis-only server address: https (or a local test relay), no path, or '' for "use the convoy relay".
function cleanJarvisUrl(raw) {
  const v = String(raw || '').trim();
  if (!v) return '';
  try {
    const u = new URL(v);
    if (u.protocol === 'https:' || (u.protocol === 'http:' && ['127.0.0.1', 'localhost'].includes(u.hostname))) return u.origin;
  } catch {}
  return null;
}

class JarvisClient {
  constructor({ config, relayClient, memory = null, file = path.join(process.cwd(), 'data', 'jarvis-id.txt'), fetchImpl = fetch } = {}) {
    Object.assign(this, { config, relayClient, memory, file, fetch: fetchImpl });
  }

  installId() {
    try { const id = fs.readFileSync(this.file, 'utf8').trim(); if (/^[a-z0-9-]{8,64}$/.test(id)) return id; } catch {}
    const id = `kaw-${crypto.randomUUID()}`;
    try { fs.mkdirSync(path.dirname(this.file), { recursive: true }); fs.writeFileSync(this.file, id); } catch {}
    return id;
  }

  // The relay that answers for Jarvis: the Jarvis-only setting, else the convoy relay in use, else KAW's main relay.
  get custom() { return Boolean(cleanJarvisUrl(this.config?.jarvis?.url)); }
  base() {
    const pick = cleanJarvisUrl(this.config?.jarvis?.url) || this.relayClient?.activeEndpoint?.() || this.config?.remote?.endpoint || DEFAULT_RELAY;
    try { const u = new URL(pick); return u.protocol === 'https:' || ['127.0.0.1', 'localhost'].includes(u.hostname) ? u.origin : DEFAULT_RELAY; } catch { return DEFAULT_RELAY; }
  }

  get enabled() { return this.config?.jarvis?.enabled !== false; }

  // Read a relay answer, recognising a web page (e.g. a Cloudflare Access sign-in) instead of Jarvis.
  async read(r) {
    const text = await r.text();
    const type = String(r.headers?.get?.('content-type') || '');
    if (/text\/html/i.test(type) || /^\s*</.test(text)) {
      const signIn = /cloudflare|access|sign ?in|login/i.test(text);
      throw Object.assign(new Error(`The Jarvis server at ${this.base()} answered with a web page${signIn ? ' (a sign-in / Cloudflare Access page)' : ''} instead of Jarvis. That address is protected or wrong for Jarvis — set the correct Jarvis server in Jarvis settings.`), { wrongAddress: true });
    }
    try { return JSON.parse(text); } catch { throw new Error(`The Jarvis server at ${this.base()} sent an unreadable answer (HTTP ${r.status}).`); }
  }

  async status() {
    const where = { relay: this.base(), custom: this.custom };
    if (!this.enabled) return { ok: true, online: false, disabled: true, message: 'Jarvis is turned off on this PC.', ...where };
    let r;
    try { r = await this.fetch(`${this.base()}/api/jarvis/status`, { signal: AbortSignal.timeout(8000), redirect: 'manual' }); }
    catch { return { ok: true, online: false, message: "Can't reach KAW's office right now. Check your internet connection.", ...where }; }
    if (r.status >= 300 && r.status < 400) return { ok: true, online: false, message: `The Jarvis server at ${this.base()} redirected to a sign-in page. Set the correct Jarvis server in Jarvis settings.`, ...where };
    if (r.status === 404) return { ok: true, online: false, message: "This relay doesn't have Jarvis yet. Set the Jarvis server in Jarvis settings.", ...where };
    try { return { ...(await this.read(r)), ...where }; }
    catch (e) { return { ok: true, online: false, message: e.message, ...where }; }
  }

  // Safe trip facts only (allowlist).
  static context(state = {}) {
    if (!state.connected) return {};
    const t = state.truck || {}, j = state.job || {}, g = state.geo || {};
    return {
      truck: [t.make, t.model].filter(Boolean).join(' ') || undefined, speedMph: Number.isFinite(Number(t.speedMph)) ? Math.round(Number(t.speedMph)) : undefined,
      cargo: j.active ? j.cargo : undefined, from: j.active ? j.originCity : undefined, to: j.active ? j.destinationCity : undefined,
      near: g.near || undefined, state: g.state || undefined
    };
  }

  async chat(messages, state, geo) {
    if (!this.enabled) throw new Error('Jarvis is turned off on this PC.');
    const body = { installId: this.installId(), driverName: this.config?.driverName || 'Driver', messages: (Array.isArray(messages) ? messages : []).slice(-12), context: JarvisClient.context({ ...state, geo }), memory: this.memory?.texts?.() || [] };
    let r;
    try { r = await this.fetch(`${this.base()}/api/jarvis/chat`, { method: 'POST', redirect: 'manual', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body), signal: AbortSignal.timeout(120000) }); }
    catch (e) { throw new Error(e.name === 'TimeoutError' ? 'Jarvis took too long to answer (the office AI may be busy). Try again in a moment.' : "Can't reach KAW's office right now. Check your internet connection."); }
    if (r.status >= 300 && r.status < 400) throw new Error(`The Jarvis server at ${this.base()} redirected to a sign-in page. Set the correct Jarvis server in Jarvis settings.`);
    const j = await this.read(r).catch(e => { if (e.wrongAddress || /unreadable/.test(e.message)) throw e; return {}; });
    if (!r.ok || !j.ok) throw new Error(j.error || `Jarvis is unavailable (HTTP ${r.status}).`);
    // Public sources Jarvis used (shown as links in the app). Only well-formed http(s) links pass.
    const sources = (Array.isArray(j.sources) ? j.sources : []).slice(0, 6).map(x => {
      // Approved community documents have no web link: title, revision and date only.
      if (x && x.knowledge === true) return { knowledge: true, title: String(x.title || 'Community document').slice(0, 160), revision: x.revision ? String(x.revision).slice(0, 20) : null, published: x.published ? String(x.published).slice(0, 40) : null, sourceType: x.sourceType ? String(x.sourceType).slice(0, 40) : null };
      try { const u = new URL(String(x.url)); if (!/^https?:$/.test(u.protocol)) return null; return { title: String(x.title || u.hostname).slice(0, 160), url: u.href, site: u.hostname.replace(/^www\./, ''), published: x.published ? String(x.published).slice(0, 40) : null, retrievedAt: x.retrievedAt ? String(x.retrievedAt).slice(0, 30) : null, read: Boolean(x.read) }; } catch { return null; }
    }).filter(Boolean);
    // Timing breakdown from the relay (numbers only) for Voice diagnostics.
    const n = v => (Number.isFinite(Number(v)) ? Math.max(0, Math.round(Number(v))) : null);
    const timing = j.timing && typeof j.timing === 'object' ? { queueMs: n(j.timing.queueMs), knowledgeMs: n(j.timing.knowledgeMs), toolsMs: n(j.timing.toolsMs), totalMs: n(j.timing.totalMs), modelMs: (Array.isArray(j.timing.modelMs) ? j.timing.modelMs : []).slice(0, 5).map(n) } : null;
    return { reply: j.reply, sources, usedWeb: Boolean(j.usedWeb), timing };
  }

  // Natural voices offered by the relay (empty when the owner hasn't turned them on).
  async voices() {
    if (!this.enabled) return { ok: true, enabled: false, voices: [] };
    try {
      const local = await this.fetch('http://127.0.0.1:4312/voices', { redirect: 'error', signal: AbortSignal.timeout(1500) });
      if (local.ok) { const j = await local.json(); if (j.enabled && Array.isArray(j.voices)) return { ok: true, ...j }; }
    } catch {}
    try {
      const r = await this.fetch(`${this.base()}/api/jarvis/voices`, { redirect: 'manual', signal: AbortSignal.timeout(8000) });
      if (r.status === 404) return { ok: true, enabled: false, voices: [], note: 'This relay has no natural voices yet.' };
      const j = await this.read(r);
      const voices = (Array.isArray(j.voices) ? j.voices : []).slice(0, 40).filter(v => v && /^[a-z]{2,3}-[A-Z]{2}-[A-Za-z0-9_-]{2,40}$/.test(String(v.id)))
        .map(v => ({ id: String(v.id), name: String(v.name || '').slice(0, 30), lang: String(v.lang || '').slice(0, 10), accent: String(v.accent || '').slice(0, 30), english: Boolean(v.english), gender: v.gender === 'male' ? 'male' : 'female', provider: String(v.provider || '').slice(0, 60) }));
      return { ok: true, enabled: Boolean(j.enabled) && voices.length > 0, provider: j.provider || null, voices, note: String(j.note || '').slice(0, 200) };
    } catch (e) { return { ok: true, enabled: false, voices: [], note: 'Natural voices are unavailable right now.' }; }
  }

  // Reply text → MP3 from the relay. Only the text to speak, the voice and the install ID go along.
  async speak(text, voice, rate = 1) {
    if (!this.enabled) throw new Error('Jarvis is turned off on this PC.');
    if (/^en-(US|GB)-Kokoro-[ab][fm]_[a-z]+$/.test(String(voice))) {
      try {
      const r = await this.fetch('http://127.0.0.1:4312/speak', { method: 'POST', redirect: 'error', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ text, voice, rate }), signal: AbortSignal.timeout(30000) });
      if (!r.ok || !/^audio\/wav/.test(r.headers.get('content-type') || '')) throw new Error('Local voices are unavailable or busy.');
      const audio = Buffer.from(await r.arrayBuffer()); audio.contentType = 'audio/wav'; return audio;
      } catch {}
    }
    const r = await this.fetch(`${this.base()}/api/jarvis/speak`, { method: 'POST', redirect: 'manual', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ installId: this.installId(), voice: String(voice || ''), text: String(text || '').slice(0, 2000), rate }), signal: AbortSignal.timeout(20000) });
    const type = String(r.headers?.get?.('content-type') || '');
    if (r.ok && /^audio\//.test(type)) { const audio = Buffer.from(await r.arrayBuffer()); audio.contentType = /^audio\/wav/.test(type) ? 'audio/wav' : 'audio/mpeg'; return audio; }
    let msg = `Natural voice unavailable (HTTP ${r.status}).`;
    try { if (/json/.test(type)) msg = (await r.json()).error || msg; } catch {}
    throw new Error(msg);
  }
}

module.exports = { JarvisClient, DEFAULT_RELAY, cleanJarvisUrl };
