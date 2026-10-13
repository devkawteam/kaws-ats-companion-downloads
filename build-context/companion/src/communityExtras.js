// Shared convoy radio + TruckersMP integration.
//  - Convoy radio: the host picks an internet radio station (radio-browser.info directory); it is shared
//    with the convoy through the relay's static cache and everyone can tune in. Audio streams straight
//    from the station, so the relay carries no audio.
//  - TruckersMP: finds this PC's Steam ID, looks up the TruckersMP profile and lists live ATS servers.

const fs = require('node:fs');
const path = require('node:path');

const RADIO_API = 'https://de1.api.radio-browser.info/json';
const UA = { 'user-agent': 'KAW-ATS-Companion/1.6' };
const httpsOrHttp = v => (/^https?:\/\/[^\s"'<>]+$/i.test(String(v || '')) ? String(v) : null);

class ConvoyRadio {
  constructor(driverName) { this.driverName = driverName; this.station = null; }

  async search(term = '', tag = '') {
    const qs = new URLSearchParams({ limit: '24', hidebroken: 'true', order: 'clickcount', reverse: 'true' });
    if (term) qs.set('name', String(term).slice(0, 60));
    if (tag) qs.set('tag', String(tag).slice(0, 30));
    const res = await fetch(`${RADIO_API}/stations/search?${qs}`, { headers: UA, signal: AbortSignal.timeout(10000) });
    if (!res.ok) throw new Error(`Radio directory HTTP ${res.status}`);
    return (await res.json()).map(s => ({ id: s.stationuuid, name: String(s.name || '').trim().slice(0, 80), url: httpsOrHttp(s.url_resolved || s.url), favicon: /^https:\/\//.test(s.favicon || '') ? s.favicon : null, country: s.countrycode || '', tags: String(s.tags || '').split(',').slice(0, 4).join(', '), codec: s.codec, bitrate: s.bitrate })).filter(s => s.url);
  }

  set(station) {
    if (!station) { this.station = null; return null; }
    const url = httpsOrHttp(station.url);
    if (!url) throw new Error('Station needs a stream URL');
    this.station = { id: String(station.id || '').slice(0, 64), name: String(station.name || 'Radio').slice(0, 80), url, favicon: /^https:\/\//.test(station.favicon || '') ? station.favicon : null, tags: String(station.tags || '').slice(0, 80), setBy: this.driverName, setAt: new Date().toISOString() };
    return this.station;
  }

  // My station plus stations shared by other drivers (most recent first).
  list(roster = []) {
    const out = [];
    if (this.station) out.push({ ...this.station, from: 'You', isLocal: true });
    for (const r of roster) if (!r.isLocal && r.online && r.convoyRadio?.url && httpsOrHttp(r.convoyRadio.url)) out.push({ ...r.convoyRadio, from: r.driverName, isLocal: false });
    return out.sort((a, b) => Date.parse(b.setAt || 0) - Date.parse(a.setAt || 0));
  }
}

// ---------------------------------------------------------------- TruckersMP
// Steam's real folder from the registry (it is often on another drive), then the usual places.
function steamRoots() {
  const roots = [];
  if (process.platform === 'win32') {
    try {
      const out = require('node:child_process').execFileSync('reg', ['query', 'HKCU\\Software\\Valve\\Steam', '/v', 'SteamPath'], { encoding: 'utf8', timeout: 3000, windowsHide: true, stdio: ['ignore', 'pipe', 'ignore'] });
      const m = /SteamPath\s+REG_SZ\s+(.+)/i.exec(out);
      if (m) roots.push(path.normalize(m[1].trim()));
    } catch {}
  }
  roots.push('C:\\Program Files (x86)\\Steam', 'C:\\Program Files\\Steam');
  return [...new Set(roots)];
}

function steamIdFromThisPc() {
  for (const root of steamRoots()) {
    try {
      const text = fs.readFileSync(path.join(root, 'config', 'loginusers.vdf'), 'utf8');
      const users = [...text.matchAll(/"(\d{17})"\s*\{([^}]*)\}/g)].map(m => ({ id: m[1], body: m[2] }));
      const recent = users.find(u => /"MostRecent"\s*"1"/i.test(u.body)) || users[0];
      if (recent) return { steamId: recent.id, name: (recent.body.match(/"PersonaName"\s*"([^"]*)"/i) || [])[1] || null };
    } catch {}
  }
  return null;
}

// TruckersMP answers JSON; anything else (a Cloudflare page, an outage) gets a clear message.
async function tmpJson(url, fetchFn = fetch) {
  let r;
  try { r = await fetchFn(url, { headers: UA, signal: AbortSignal.timeout(10000) }); }
  catch { throw new Error("Couldn't reach TruckersMP. Check this PC's internet connection and try again."); }
  const text = await r.text();
  try { return JSON.parse(text); }
  catch { throw new Error(`TruckersMP's website didn't answer normally (HTTP ${r.status}). Try again in a few minutes.`); }
}

class TruckersMp {
  // settings: { playerId } from config.json; save(next) keeps a new link across restarts.
  constructor(settings = {}, save = null, fetchFn = fetch) {
    this.cache = new Map(); this.save = save; this.fetch = fetchFn;
    this.override = /^\d{1,20}$/.test(String(settings?.playerId || '')) ? String(settings.playerId) : null;
  }
  // Accepts a plain ID or a pasted profile link (truckersmp.com/user/123 or steamcommunity.com/profiles/7656…).
  setPlayerId(v) {
    const id = String(v || '').replace(/\D/g, '').slice(0, 20);
    this.override = id || null; this.cache.delete('player');
    try { this.save?.({ playerId: this.override }); } catch (e) { console.error('[TMP]', e.message); }
    return this.override;
  }

  async cached(key, ttl, fn) {
    const hit = this.cache.get(key);
    if (hit && Date.now() - hit.at < ttl) return hit.value;
    try { const value = await fn(); this.cache.set(key, { at: Date.now(), value }); return value; }
    catch (e) { if (hit) return hit.value; throw e; }
  }

  async servers() {
    return this.cached('servers', 60000, async () => {
      const j = await tmpJson('https://api.truckersmp.com/v2/servers', this.fetch);
      return (j.response || []).filter(s => s.game === 'ATS').map(s => ({ id: s.id, name: s.name, short: s.shortname, online: Boolean(s.online), players: s.players, max: s.maxplayers, queue: s.queue, speedLimiter: Boolean(s.speedlimiter), collisions: Boolean(s.collisions), event: Boolean(s.event) }));
    });
  }

  async player() {
    const local = steamIdFromThisPc();
    const id = this.override || local?.steamId;
    if (!id) return { found: false, reason: "Steam wasn't found on this PC. Type your TruckersMP ID (the number in your truckersmp.com/user/… link) or your Steam64 ID below and press Link." };
    return this.cached('player', 10 * 60000, async () => {
      const j = await tmpJson(`https://api.truckersmp.com/v2/player/${id}`, this.fetch);
      if (j.error || !j.response) return { found: false, steamId: local?.steamId || null, triedId: id, reason: this.override ? `No TruckersMP player found for ID ${id}. Check the number on your truckersmp.com profile and try again.` : `No TruckersMP account is linked to the Steam account on this PC (${id}). Type your TruckersMP ID below and press Link.` };
      const p = j.response;
      return { found: true, id: p.id, name: p.name, avatar: /^https:\/\//.test(p.avatar || '') ? p.avatar : null, joined: p.joinDate, banned: Boolean(p.banned), group: p.groupName || null, vtc: p.vtc?.inVTC ? { name: p.vtc.name, tag: p.vtc.tag } : null, profileUrl: `https://truckersmp.com/user/${p.id}` };
    });
  }
}

// Suggest a convoy server: the busiest online "simulation" server with room to spare.
function suggestServer(servers = []) {
  const ok = servers.filter(s => s.online && !s.event && s.players < s.max * 0.9);
  const sim = ok.filter(s => /sim/i.test(s.short || s.name));
  return (sim.length ? sim : ok).sort((a, b) => b.players - a.players)[0] || null;
}

module.exports = { ConvoyRadio, TruckersMp, suggestServer, steamIdFromThisPc, steamRoots };
