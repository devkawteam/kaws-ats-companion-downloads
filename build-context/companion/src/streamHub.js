// Stream Hub: the timeline behind every streaming feature.
// Turns telemetry and Companion events into stream events (job started, delivery, crash, fuel stop,
// rest, convoy join, achievement, chat effects, votes), feeds them live to OBS overlays over SSE,
// and records stream sessions so the Companion can write YouTube chapters afterwards.

const fs = require('node:fs');
const path = require('node:path');

const FILE = path.join(process.cwd(), 'data', 'stream-sessions.json');
const MAX_EVENTS = 300;
const fin = v => v !== null && v !== undefined && Number.isFinite(Number(v));
const money = n => `$${Math.round(Number(n) || 0).toLocaleString('en-US')}`;

// What each event looks like on an overlay pop-up, and whether it becomes a YouTube chapter.
const KINDS = {
  job: { icon: '🚛', chapter: true },
  delivery: { icon: '📦', chapter: true },
  cancelled: { icon: '✖', chapter: true },
  achievement: { icon: '🏆', chapter: false },
  crash: { icon: '💥', chapter: false },
  fuel: { icon: '⛽', chapter: true },
  rest: { icon: '🛏', chapter: true },
  convoyJoin: { icon: '👋', chapter: false },
  convoyStart: { icon: '🚚', chapter: true },
  paused: { icon: '⏸', chapter: false },
  effect: { icon: '✨', chapter: false },
  vote: { icon: '🗳', chapter: false },
  stream: { icon: '🔴', chapter: false },
  info: { icon: 'ℹ', chapter: false }
};

class StreamHub {
  constructor() {
    this.events = [];
    this.subscribers = new Set();
    this.listeners = [];
    this.seq = 0;
    this.session = null;
    this.sessions = [];
    try { const saved = JSON.parse(fs.readFileSync(FILE, 'utf8')); this.sessions = saved.sessions || []; this.session = saved.active || null; } catch {}
    this.prev = null;
    this.parkedSince = null;
    this.restAnnounced = false;
    this.pausedSince = null;
  }

  save() {
    try {
      fs.mkdirSync(path.dirname(FILE), { recursive: true });
      fs.writeFileSync(FILE, JSON.stringify({ active: this.session, sessions: this.sessions.slice(-20) }, null, 2));
    } catch (e) { console.error('[STREAM]', e.message); }
  }

  // ---- events ----
  emit(type, title, detail = '', data = {}) {
    const ev = { id: ++this.seq, type, icon: KINDS[type]?.icon || '•', title: String(title).slice(0, 120), detail: String(detail || '').slice(0, 240), data, at: new Date().toISOString() };
    this.events.push(ev);
    if (this.events.length > MAX_EVENTS) this.events.shift();
    if (this.session) {
      this.session.events.push({ type, title: ev.title, detail: ev.detail, at: ev.at });
      if (this.session.events.length > 2000) this.session.events.shift();
      if (KINDS[type]?.chapter) this.save();
    }
    for (const fn of this.listeners) { try { fn(ev); } catch (e) { console.error('[STREAM]', e.message); } }
    const line = `id: ${ev.id}\nevent: stream\ndata: ${JSON.stringify(ev)}\n\n`;
    for (const res of this.subscribers) { try { res.write(line); } catch { this.subscribers.delete(res); } }
    return ev;
  }

  listen(fn) { this.listeners.push(fn); }

  recent(limit = 30, since = 0) { return this.events.filter(e => e.id > since).slice(-limit); }

  // Server-Sent Events for overlays (OBS browser sources reconnect on their own).
  subscribe(req, res) {
    res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-store', connection: 'keep-alive', 'access-control-allow-origin': '*' });
    res.write(`retry: 3000\n\n`);
    const last = Number(req.headers['last-event-id']) || 0;
    for (const ev of this.recent(10, last)) res.write(`id: ${ev.id}\nevent: stream\ndata: ${JSON.stringify(ev)}\n\n`);
    this.subscribers.add(res);
    const ping = setInterval(() => { try { res.write(': ping\n\n'); } catch {} }, 20000);
    req.on('close', () => { clearInterval(ping); this.subscribers.delete(res); });
  }

  // ---- telemetry-derived events ----
  observe(state) {
    const t = state.truck || {}, dmg = state.damage || {};
    const now = Date.now();
    const speed = Number(t.speedMph) || 0;
    const truckDamage = Math.max(...['enginePercent', 'cabinPercent', 'chassisPercent'].map(k => Number(dmg[k]) || 0));
    const cargoDamage = Number(dmg.cargoPercent) || 0;
    const paused = Boolean(state.sdk?.paused);
    const p = this.prev;
    if (p && state.connected) {
      // Crash: a sudden damage jump (truck or cargo).
      const jump = Math.max(truckDamage - p.truckDamage, cargoDamage - p.cargoDamage);
      if (jump >= 1.5 && now - (this.lastCrashAt || 0) > 20000) {
        this.lastCrashAt = now;
        this.emit('crash', 'Ouch! Damage taken', `+${jump.toFixed(1)}% damage at ${Math.round(p.speed)} mph`, { jump, speed: p.speed });
      }
      // Fuel stop: fuel went up noticeably while (nearly) stopped.
      if (fin(t.fuelGallons) && fin(p.fuel) && t.fuelGallons - p.fuel > 5 && speed < 3) {
        if (now - (this.lastFuelAt || 0) > 120000) {
          this.lastFuelAt = now;
          this.emit('fuel', 'Fuel stop', `Topped up ${Math.round(t.fuelGallons - (this.fuelBefore ?? p.fuel))} gal`, { gallons: t.fuelGallons });
        }
      } else if (speed >= 3) this.fuelBefore = t.fuelGallons;
      // Pause / resume.
      if (paused && !p.paused) { this.pausedSince = now; this.emit('paused', 'Game paused', 'Be right back', { paused: true }); }
      if (!paused && p.paused) { this.pausedSince = null; this.emit('paused', 'Back on the road', '', { paused: false }); }
    }
    // Rest: parked with the engine off for 3+ minutes.
    if (state.connected && speed < 1 && t.engineOn === false) {
      this.parkedSince ??= now;
      if (!this.restAnnounced && now - this.parkedSince > 180000) { this.restAnnounced = true; this.emit('rest', 'Rest stop', state.job?.destinationCity ? `On the way to ${state.job.destinationCity}` : ''); }
    } else if (speed > 5) { this.parkedSince = null; this.restAnnounced = false; }
    this.prev = { truckDamage, cargoDamage, speed, fuel: t.fuelGallons, paused };
  }

  status(state) {
    const t = state.truck || {};
    return {
      parked: Boolean(state.connected && (Number(t.speedMph) || 0) < 1),
      driving: Boolean(state.connected && (Number(t.speedMph) || 0) >= 1 && !state.sdk?.paused),
      paused: Boolean(state.sdk?.paused),
      connected: Boolean(state.connected)
    };
  }

  // ---- stream sessions & YouTube chapters ----
  startSession(source = 'manual', title = '') {
    if (this.session) return this.session;
    this.session = { id: `s${Date.now().toString(36)}`, title: String(title || '').slice(0, 100), source, startedAt: new Date().toISOString(), endedAt: null, events: [] };
    this.save();
    this.emit('stream', 'Stream started', '', { live: true });
    return this.session;
  }

  stopSession() {
    if (!this.session) return null;
    this.emit('stream', 'Stream ended', '', { live: false });
    this.session.endedAt = new Date().toISOString();
    this.sessions.push(this.session);
    const done = this.session;
    this.session = null;
    this.save();
    return done;
  }

  sessionList() {
    return [...(this.session ? [this.session] : []), ...this.sessions.slice().reverse()].map(s => ({ id: s.id, title: s.title, source: s.source, startedAt: s.startedAt, endedAt: s.endedAt, live: !s.endedAt, events: s.events.length }));
  }

  // YouTube rules: first chapter at 0:00, at least 3 chapters, each at least 10 seconds long.
  chapters(id) {
    const s = id ? [this.session, ...this.sessions].find(x => x && x.id === id) : (this.session || this.sessions.at(-1));
    if (!s) return { ok: false, error: 'No stream session recorded yet.' };
    const start = Date.parse(s.startedAt);
    const fmt = ms => { const t = Math.max(0, Math.floor(ms / 1000)); const h = Math.floor(t / 3600), m = Math.floor(t % 3600 / 60), sec = t % 60; return h ? `${h}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}` : `${m}:${String(sec).padStart(2, '0')}`; };
    const list = [{ offset: 0, label: 'Pre-trip & hello' }];
    for (const e of s.events) {
      if (!KINDS[e.type]?.chapter) continue;
      const offset = Date.parse(e.at) - start;
      const label = e.detail && e.type !== 'fuel' ? `${e.title}: ${e.detail}` : e.title;
      const last = list.at(-1);
      if (offset - last.offset < 10000) { if (e.type === 'job' || e.type === 'delivery') last.label = label; continue; }
      list.push({ offset, label: label.slice(0, 90) });
    }
    const text = list.map(c => `${fmt(c.offset)} ${c.label}`).join('\n');
    return { ok: true, id: s.id, title: s.title, startedAt: s.startedAt, endedAt: s.endedAt, count: list.length, valid: list.length >= 3, text, note: list.length < 3 ? 'YouTube needs at least 3 chapters — drive a job or two first.' : null };
  }

  // Hooks from the rest of the Companion.
  onJobStarted(job) { this.emit('job', `Left ${job?.originCity || 'the depot'}`, `${job?.cargo || 'Cargo'} to ${job?.destinationCity || '?'}`, { cargo: job?.cargo, from: job?.originCity, to: job?.destinationCity }); }
  onTripFinished(trip) {
    if (trip.status === 'delivered') this.emit('delivery', `Delivered to ${trip.destinationCity || 'destination'}`, `${trip.cargo || 'Cargo'} · ${money(trip.deliveredIncome)} · ${Math.round(trip.milesDriven || 0)} mi`, { income: trip.deliveredIncome, miles: trip.milesDriven, cargo: trip.cargo });
    else this.emit('cancelled', 'Job cancelled', `${trip.cargo || 'Cargo'} to ${trip.destinationCity || '?'}`);
  }
  onAchievement(a) { this.emit('achievement', 'Achievement unlocked', a?.name || '', { id: a?.id }); }
  onConvoyJoin(name) { this.emit('convoyJoin', `${name} joined the convoy`, '', { driver: name }); }
}

module.exports = { StreamHub, KINDS };
