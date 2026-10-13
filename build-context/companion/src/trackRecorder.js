// Breadcrumb trails and convoy replay.
// Samples every online driver's game position every 5 s: the last 45 minutes stay in memory for live
// trails, and while a convoy event is running the samples are saved to data/tracks/<event>.json.
// Positions are stored as game coordinates and converted with the live map calibration when shown.

const fs = require('node:fs');
const path = require('node:path');

const DIR = path.join(process.cwd(), 'data', 'tracks');
const SAMPLE_MS = 5000;
const LIVE_MS = 45 * 60 * 1000;
const MAX_SESSION_FRAMES = 6000; // ~8 h at 5 s
const safe = v => String(v || '').replace(/[^\w-]/g, '').slice(0, 80);

class TrackRecorder {
  constructor() {
    this.live = new Map();     // driver id -> { name, isLocal, points: [[t, x, z]] }
    this.session = null;       // { id, frames: [[t, [[name, x, z], ...]]], dirty }
    fs.mkdirSync(DIR, { recursive: true });
  }

  sample(roster = [], activeEventId = null) {
    const t = Date.now();
    const frame = [];
    for (const r of roster) {
      const p = r.positioning;
      if (!r.online || !p || !Number.isFinite(Number(p.x)) || !Number.isFinite(Number(p.z)) || (p.x === 0 && p.z === 0)) continue;
      const x = Math.round(p.x), z = Math.round(p.z);
      const entry = this.live.get(r.id) || { name: r.driverName, isLocal: Boolean(r.isLocal), points: [] };
      const lastPt = entry.points.at(-1);
      if (!lastPt || Math.hypot(lastPt[1] - x, lastPt[2] - z) > 15) entry.points.push([t, x, z]);
      entry.points = entry.points.filter(q => t - q[0] < LIVE_MS);
      entry.name = r.driverName;
      this.live.set(r.id, entry);
      frame.push([r.driverName, x, z]);
    }
    this.recordSession(activeEventId, t, frame);
  }

  recordSession(eventId, t, frame) {
    if (!eventId) { this.flush(); this.session = null; return; }
    if (this.session?.id !== eventId) {
      this.flush();
      this.session = { id: eventId, frames: this.load(eventId)?.frames || [], dirty: false, lastWrite: 0 };
    }
    if (frame.length) {
      this.session.frames.push([t, frame]);
      if (this.session.frames.length > MAX_SESSION_FRAMES) this.session.frames.splice(0, this.session.frames.length - MAX_SESSION_FRAMES);
      this.session.dirty = true;
    }
    if (Date.now() - this.session.lastWrite > 30000) this.flush();
  }

  flush() {
    if (!this.session?.dirty) return;
    try {
      fs.writeFileSync(path.join(DIR, `${safe(this.session.id)}.json`), JSON.stringify({ id: this.session.id, frames: this.session.frames }), 'utf8');
      this.session.dirty = false;
      this.session.lastWrite = Date.now();
    } catch (e) { console.error('[TRACKS]', e.message); }
  }

  load(id) {
    try { return JSON.parse(fs.readFileSync(path.join(DIR, `${safe(id)}.json`), 'utf8')); } catch { return null; }
  }

  hasReplay(id) { return fs.existsSync(path.join(DIR, `${safe(id)}.json`)); }

  // Live trails as lon/lat, downsampled to at most `max` points per driver.
  liveTrails(calibration, max = 120) {
    const out = [];
    for (const [id, e] of this.live) {
      const step = Math.max(1, Math.ceil(e.points.length / max));
      const pts = e.points.filter((_, i) => i % step === 0 || i === e.points.length - 1)
        .map(([t, x, z]) => { const g = calibration.locate({ x, z }); return g ? [Math.round(g.lon * 1e4) / 1e4, Math.round(g.lat * 1e4) / 1e4, t] : null; })
        .filter(Boolean);
      if (pts.length > 1) out.push({ id, driverName: e.name, isLocal: e.isLocal, points: pts });
    }
    return out;
  }

  // A saved convoy as replay frames: [{ t, drivers: [{ name, lon, lat }] }], max `max` frames.
  // The last 45 minutes of everyone in memory, as replay frames (no convoy event needed).
  recentFrames() {
    const byT = new Map();
    for (const e of this.live.values()) for (const [t, x, z] of e.points) {
      const k = Math.round(t / SAMPLE_MS) * SAMPLE_MS;
      if (!byT.has(k)) byT.set(k, new Map());
      byT.get(k).set(e.name, [e.name, x, z]);
    }
    // Carry each driver's last position forward so dots don't blink between samples.
    const last = new Map();
    return [...byT.keys()].sort((a, b) => a - b).map(t => { for (const [n, v] of byT.get(t)) last.set(n, v); return [t, [...last.values()]]; });
  }

  replay(id, calibration, max = 600) {
    const data = id === 'recent' ? { frames: this.recentFrames() } : this.session?.id === id ? { frames: this.session.frames } : this.load(id);
    if (!data?.frames?.length) return null;
    const step = Math.max(1, Math.ceil(data.frames.length / max));
    const frames = data.frames.filter((_, i) => i % step === 0 || i === data.frames.length - 1).map(([t, list]) => ({
      t, drivers: list.map(([name, x, z]) => { const g = calibration.locate({ x, z }); return g ? { name, lon: Math.round(g.lon * 1e4) / 1e4, lat: Math.round(g.lat * 1e4) / 1e4 } : null; }).filter(Boolean)
    }));
    return { id, startedAt: new Date(frames[0].t).toISOString(), endedAt: new Date(frames.at(-1).t).toISOString(), frames };
  }

  start(getRoster, getActiveEventId) {
    this.timer = setInterval(() => { try { this.sample(getRoster(), getActiveEventId()); } catch (e) { console.error('[TRACKS]', e.message); } }, SAMPLE_MS);
    this.timer.unref?.();
  }
}

module.exports = { TrackRecorder };
