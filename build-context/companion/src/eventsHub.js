// Convoy events & RSVP.
// Events are the convoy sessions a host plans (Convoy Sessions page). The host's Companion shares them
// with the convoy; every driver can RSVP; RSVPs travel back the same way. Reminders fire 30 and 5
// minutes before departure, and the 30-minute reminder includes a pre-flight check against the host's
// mod pack.

const fs = require('node:fs');
const path = require('node:path');

const RSVP_FILE = path.join(process.cwd(), 'data', 'rsvps.json');
const STATE_FILE = path.join(process.cwd(), 'data', 'events-state.json');
const STATES = new Set(['going', 'maybe', 'no']);
const key = v => String(v || '').trim().toLowerCase();

class EventsHub {
  constructor({ sessions, preflight, driverName, discord, voice }) {
    Object.assign(this, { sessions, preflight, driverName, discord, voice });
    this.rsvps = {};
    try { this.rsvps = JSON.parse(fs.readFileSync(RSVP_FILE, 'utf8')) || {}; } catch {}
    // Remember what was already announced/reminded so a restart never re-posts to Discord.
    let st = null;
    try { st = JSON.parse(fs.readFileSync(STATE_FILE, 'utf8')); } catch {}
    this.reminded = new Set(st?.reminded || []);
    this.announced = new Set(st?.announced || (st ? [] : this.shareable().map(e => e.id)));
    if (!st) this.saveState();
  }

  saveState() { try { fs.mkdirSync(path.dirname(STATE_FILE), { recursive: true }); fs.writeFileSync(STATE_FILE, JSON.stringify({ announced: [...this.announced].slice(-200), reminded: [...this.reminded].slice(-400) })); } catch {} }

  saveRsvps() { try { fs.mkdirSync(path.dirname(RSVP_FILE), { recursive: true }); fs.writeFileSync(RSVP_FILE, JSON.stringify(this.rsvps, null, 2)); } catch {} }

  // Events I host, in the compact shape shared with the convoy.
  shareable() {
    return this.sessions.list(30).filter(s => ['planned', 'active'].includes(s.status)).slice(0, 10).map(s => ({
      id: s.id, name: s.name, host: s.host, meetPoint: s.meetPoint, destination: s.destination, departureTime: s.departureTime,
      notes: String(s.notes || '').slice(0, 500), status: s.status, startedAt: s.startedAt,
      checkpoints: (s.checkpoints || []).slice(0, 20).map(c => ({ id: c.id, name: c.name, status: c.status }))
    }));
  }

  rsvp(eventId, status) {
    if (!STATES.has(status)) throw new Error('RSVP must be going, maybe or no');
    this.rsvps[String(eventId).slice(0, 80)] = status;
    this.saveRsvps();
    return this.rsvps;
  }

  // All known events (mine + shared by others) with everyone's RSVPs.
  list(roster = []) {
    const events = new Map();
    for (const e of this.shareable()) events.set(e.id, { ...e, mine: true, from: 'You' });
    for (const r of roster) {
      if (r.isLocal) continue;
      for (const e of Array.isArray(r.convoyEvents) ? r.convoyEvents : []) {
        if (!e?.id || events.has(e.id)) continue;
        events.set(e.id, { ...e, mine: false, from: r.driverName, hostOnline: Boolean(r.online) });
      }
    }
    const out = [];
    for (const e of events.values()) {
      const answers = [];
      const mineAnswer = this.rsvps[e.id] || (e.mine ? 'going' : null);
      if (mineAnswer) answers.push({ driverName: this.driverName, status: mineAnswer, isLocal: true });
      for (const r of roster) {
        if (r.isLocal) continue;
        const st = r.rsvps?.[e.id] || (key(r.driverName) === key(e.host) ? 'going' : null);
        if (STATES.has(st)) answers.push({ driverName: r.driverName, status: st, online: Boolean(r.online) });
      }
      const count = s => answers.filter(a => a.status === s).length;
      const dep = e.departureTime ? Date.parse(e.departureTime) : null;
      out.push({ ...e, myRsvp: this.rsvps[e.id] || (e.mine ? 'going' : null), rsvps: answers, going: count('going'), maybe: count('maybe'), declined: count('no'), minutesUntil: dep ? Math.round((dep - Date.now()) / 60000) : null });
    }
    return out.sort((a, b) => (a.status === 'active' ? -1 : 0) - (b.status === 'active' ? -1 : 0) || (Date.parse(a.departureTime || 0) || 9e15) - (Date.parse(b.departureTime || 0) || 9e15));
  }

  // The convoy everyone should be in right now (running event I host or said I'm going to).
  activeEvent(roster = []) {
    return this.list(roster).find(e => e.status === 'active' && (e.mine || ['going', 'maybe'].includes(e.myRsvp))) || null;
  }

  // Called every 30 s: reminders as alerts/voice/Discord. Returns alerts for the alerts engine.
  tick(roster = [], localCaps = {}) {
    const alerts = [];
    for (const e of this.list(roster)) {
      if (e.status !== 'planned' || e.minutesUntil === null || e.minutesUntil < -15) continue;
      if (!e.mine && !['going', 'maybe'].includes(e.myRsvp)) continue;
      const m = e.minutesUntil;
      if (m <= 30 && m > 5 && !this.reminded.has(`${e.id}:30`)) {
        this.reminded.add(`${e.id}:30`); this.saveState();
        // Pre-flight against the host's shared mod pack (or my own if I host).
        const host = roster.find(r => key(r.driverName) === key(e.host));
        const manifest = e.mine ? this.preflight.getActive() : host?.convoyManifest || null;
        const check = manifest ? this.preflight.compareCapabilities(localCaps, manifest) : null;
        const ready = !check || check.status === 'READY';
        this.voice?.speak(`Convoy ${e.name} departs in ${m} minutes from ${e.meetPoint || 'the meet point'}.${ready ? '' : ' Your mods are not ready.'}`, `event-${e.id}-30`, 0);
        if (e.mine) this.discord?.eventReminder?.(e, m);
        e._preflight = check;
      }
      if (m <= 5 && !this.reminded.has(`${e.id}:5`)) {
        this.reminded.add(`${e.id}:5`); this.saveState();
        this.voice?.speak(`Convoy ${e.name} departs in ${Math.max(0, m)} minutes.`, `event-${e.id}-5`, 0);
      }
      if (m <= 30) {
        const host = roster.find(r => key(r.driverName) === key(e.host));
        const manifest = e.mine ? this.preflight.getActive() : host?.convoyManifest || null;
        const check = manifest ? this.preflight.compareCapabilities(localCaps, manifest) : null;
        const notReady = check && check.status !== 'READY';
        alerts.push({ id: `event-${e.id}`, severity: m <= 5 || notReady ? 'critical' : 'warn', title: m > 0 ? `Convoy in ${m} min: ${e.name}` : `Convoy ${e.name} is departing`, detail: `${e.meetPoint || 'Meet point TBA'}${e.destination ? ` → ${e.destination}` : ''}${notReady ? ` · you need ${(check.missingMods || []).length} mod(s) — open Convoy Hub` : ' · pre-flight ready'}` });
      }
    }
    // Announce newly planned events I host (once).
    for (const e of this.shareable()) {
      if (e.status === 'planned' && !this.announced.has(e.id)) { this.announced.add(e.id); this.saveState(); this.discord?.eventAnnouncement?.(e); }
    }
    return alerts;
  }
}

module.exports = { EventsHub };
