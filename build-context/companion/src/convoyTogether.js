// Convoy "together" features: lost-contact and wrong-turn warnings, catch-up guidance, a shared
// regroup point, roll call, who's missing from a planned convoy, and the convoy line for the map.
// Shared parts travel in each driver's relay static data under `together` (no relay change needed).
// Author: Kaw.
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const MILE = 1609.344;
const fin = v => Number.isFinite(Number(v));
const key = s => String(s || '').trim().toLowerCase();
const hasPos = r => r?.positioning && fin(r.positioning.x) && fin(r.positioning.z) && !(Number(r.positioning.x) === 0 && Number(r.positioning.z) === 0);
const gameMiles = (a, b) => Math.hypot(Number(a.x) - Number(b.x), Number(a.z) - Number(b.z)) / MILE;
// SCS heading 0..1 (counter-clockwise from north) -> compass degrees.
const heading = rot => (fin(rot) ? ((1 - Number(rot)) * 360 % 360 + 360) % 360 : null);
const angleDiff = (a, b) => { const d = Math.abs(a - b) % 360; return d > 180 ? 360 - d : d; };
function haversineMiles(a, b) {
  const R = 3958.8, rad = x => x * Math.PI / 180;
  const dLat = rad(b.lat - a.lat), dLon = rad(b.lon - a.lon);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}
const cleanText = (s, n) => String(s ?? '').replace(/[\u0000-\u001f<>]/g, '').trim().slice(0, n);

// Sanitise what other drivers send us (it is shown in the UI and spoken).
function cleanRegroup(g) {
  if (!g || typeof g !== 'object' || !fin(g.lat) || !fin(g.lon)) return null;
  const lat = Number(g.lat), lon = Number(g.lon);
  if (lat < 10 || lat > 75 || lon < -170 || lon > -50) return null;
  return { id: cleanText(g.id, 40) || null, name: cleanText(g.name, 60) || 'Regroup point', lat: Math.round(lat * 1e5) / 1e5, lon: Math.round(lon * 1e5) / 1e5, by: cleanText(g.by, 40), at: fin(g.at) ? Number(g.at) : 0, note: cleanText(g.note, 120) };
}
function cleanRollCall(c) {
  if (!c || typeof c !== 'object' || !c.id) return null;
  return { id: cleanText(c.id, 40), by: cleanText(c.by, 40), at: fin(c.at) ? Number(c.at) : 0 };
}
function cleanAnswer(a) {
  if (!a || typeof a !== 'object' || !a.id) return null;
  const ch = a.checks || {};
  return { id: cleanText(a.id, 40), ready: a.ready === true ? true : a.ready === false ? false : null, at: fin(a.at) ? Number(a.at) : 0,
    checks: { inTruck: Boolean(ch.inTruck), jobLoaded: Boolean(ch.jobLoaded), sharingLocation: Boolean(ch.sharingLocation), mapsOk: ch.mapsOk === undefined ? null : Boolean(ch.mapsOk), destination: cleanText(ch.destination, 60) || null } };
}

class ConvoyTogether {
  constructor({ file = path.join(process.cwd(), 'data', 'convoy-together.json'), now = () => Date.now() } = {}) {
    this.file = file; this.now = now;
    this.mine = { regroup: null, rollCall: null, ready: null, dismissed: [] };
    try { Object.assign(this.mine, JSON.parse(fs.readFileSync(file, 'utf8'))); } catch {}
    this.prev = new Map();          // peer id -> { online, moving, name, near, speed, at }
    this.lost = new Map();          // peer id -> { name, near, speed, at }
    this.back = new Map();          // peer id -> { name, at }
    this.history = new Map();       // peer id -> [[t, milesToRef, heading, refHeading]]
    this.wrong = new Map();         // peer id -> { name, at, detail }
    this.firstSeen = new Map();     // regroup / roll call id -> when this Companion first saw it
    this.last = { line: [], catchUp: null, missing: [], regroup: null, rollCall: null, wrongTurns: [], lost: [] };
    this.myAnswer = null;
  }
  save() { try { fs.mkdirSync(path.dirname(this.file), { recursive: true }); fs.writeFileSync(this.file, JSON.stringify(this.mine)); } catch {} }

  // ---- actions (local UI) ----
  setRegroup({ name, lat, lon, note } = {}, by = '') {
    const g = cleanRegroup({ id: `rg-${crypto.randomUUID().slice(0, 8)}`, name, lat, lon, note, by, at: this.now() });
    if (!g) throw new Error('Pick a place on the map or a city for the regroup point.');
    this.mine.regroup = g; this.mine.dismissed = []; this.save(); return g;
  }
  // Clear acts on the point on screen: my own is removed for everyone; someone else's is hidden for me.
  clearRegroup() {
    const current = this.last.regroup;
    if (current && !current.mine && current.id) this.mine.dismissed = [...new Set([...(this.mine.dismissed || []), current.id])].slice(-20);
    else this.mine.regroup = null;
    this.save();
  }
  startRollCall(by = '') { this.mine.rollCall = { id: `rc-${crypto.randomUUID().slice(0, 8)}`, by: cleanText(by, 40), at: this.now() }; this.mine.ready = null; this.save(); return this.mine.rollCall; }
  endRollCall() { this.mine.rollCall = null; this.save(); }
  setReady(v) { this.mine.ready = v === true ? true : v === false ? false : null; this.save(); }

  // What this Companion shares with the convoy (relay static data).
  shareable() {
    const fresh = x => x && this.now() - x.at < 3 * 3600000 ? x : null;
    return { regroup: fresh(this.mine.regroup), rollCall: fresh(this.mine.rollCall), rollAnswer: this.myAnswer };
  }

  // ---- evaluation, every few seconds from the convoy loop ----
  // ctx: { roster, leader, formation, gapWarnMiles, state, privacy, locate, events: [{...}], mapsOk }
  evaluate(ctx = {}) {
    const t = this.now();
    const roster = ctx.roster || [];
    const me = roster.find(r => r.isLocal) || null;
    const peers = roster.filter(r => !r.isLocal);
    const locate = ctx.locate || (() => null);
    const near = r => (hasPos(r) ? locate(r.positioning)?.near || null : null);
    const alerts = [];

    // 1. Lost contact: a driver who was moving drops off the relay.
    for (const p of peers) {
      const moving = p.online && Number(p.truck?.speedMph) > 5;
      const was = this.prev.get(p.id);
      if (was?.online && was.moving && !p.online && !this.lost.has(p.id)) this.lost.set(p.id, { name: p.driverName, near: was.near, speed: was.speed, at: t });
      if (p.online && this.lost.has(p.id)) { this.lost.delete(p.id); this.back.set(p.id, { name: p.driverName, at: t }); }
      this.prev.set(p.id, { online: Boolean(p.online), moving, name: p.driverName, near: near(p) || was?.near || null, speed: Math.round(Number(p.truck?.speedMph) || 0), at: t });
    }
    for (const [id, l] of this.lost) {
      const mins = Math.max(1, Math.round((t - l.at) / 60000));
      if (t - l.at > 10 * 60000) { this.lost.delete(id); continue; }
      alerts.push({ id: `together-lost-${id}`, severity: 'warn', title: `${l.name} dropped out of the convoy`, detail: `Last seen ${mins} min ago${l.near ? ` near ${l.near}` : ''}${l.speed ? `, doing ${l.speed} mph` : ''}. Their game or Companion may have closed.` });
    }
    for (const [id, b] of this.back) {
      if (t - b.at > 60000) { this.back.delete(id); continue; }
      alerts.push({ id: `together-back-${id}`, severity: 'info', title: `${b.name} is back in the convoy`, detail: 'Their position is coming through again.' });
    }

    // 2. Wrong turn: getting further from the reference driver while heading a different way.
    const leader = ctx.leader ? roster.find(r => r.id === ctx.leader.id || key(r.driverName) === key(ctx.leader.driverName)) : null;
    const wrongTurns = [];
    if (leader && hasPos(leader)) {
      for (const p of roster.filter(r => r.online && r !== leader && hasPos(r))) {
        const ref = leader;
        const h = (this.history.get(p.id) || []).filter(x => t - x[0] < 4 * 60000);
        const hp = heading(p.positioning.rotationX), hr = heading(ref.positioning.rotationX);
        h.push([t, gameMiles(p.positioning, ref.positioning), hp, hr, Number(p.truck?.speedMph) || 0, Number(ref.truck?.speedMph) || 0]);
        this.history.set(p.id, h);
        const old = h.find(x => t - x[0] >= 2.5 * 60000);
        const cur = h.at(-1);
        const bothMoving = cur[4] > 20 && cur[5] > 20;
        const away = old ? cur[1] - old[1] : 0;
        const diverging = hp !== null && hr !== null && angleDiff(hp, hr) > 60;
        if (old && bothMoving && away > 1.5 && diverging) this.wrong.set(p.id, { name: p.driverName, at: t, isLocal: Boolean(p.isLocal), detail: `${away.toFixed(1)} mi further from ${ref.driverName} in the last ${Math.round((t - old[0]) / 60000)} min, heading a different way.` });
        else if (this.wrong.has(p.id) && (away < 0.2 || !diverging)) this.wrong.delete(p.id);
      }
      for (const [id, w] of this.wrong) {
        if (t - w.at > 5 * 60000) { this.wrong.delete(id); continue; }
        wrongTurns.push({ id, driverName: w.name, detail: w.detail });
        alerts.push({ id: `together-wrongturn-${id}`, severity: 'warn', title: w.isLocal ? 'You may have taken a wrong turn' : `${w.name} may have taken a wrong turn`, detail: w.detail });
      }
    }

    // 3. Catch-up guidance for me (never above the speed limit).
    let catchUp = null;
    if (leader && me && leader !== me && hasPos(me) && hasPos(leader)) {
      const gap = gameMiles(me.positioning, leader.positioning);
      const warn = Number(ctx.gapWarnMiles) || 2;
      const lead = Math.round(Number(leader.truck?.speedMph) || 0);
      const limit = Number(ctx.state?.navigation?.speedLimitMph) || null;
      if (gap > Math.max(0.75, warn / 2)) {
        const target = Math.round(limit ? Math.min(limit, lead + 6) : lead + 6);
        const closing = target - lead;
        if (lead > 5 && closing >= 2) {
          const minutes = Math.round(gap / closing * 60);
          catchUp = { gapMiles: Math.round(gap * 10) / 10, leader: leader.driverName, leaderMph: lead, targetMph: target, minutes, text: `You're ${gap.toFixed(1)} mi behind ${leader.driverName} (${lead} mph). Hold about ${target} mph and you'll close up in about ${minutes} min${limit ? ' — within the speed limit' : ''}.` };
        } else if (lead > 5) {
          catchUp = { gapMiles: Math.round(gap * 10) / 10, leader: leader.driverName, leaderMph: lead, targetMph: limit || lead, minutes: null, text: `You're ${gap.toFixed(1)} mi behind ${leader.driverName}, who is at the speed limit. Hold the limit — you'll close up when they slow down. Don't speed.` };
        } else {
          catchUp = { gapMiles: Math.round(gap * 10) / 10, leader: leader.driverName, leaderMph: lead, targetMph: limit, minutes: null, text: `${leader.driverName} has stopped ${gap.toFixed(1)} mi ahead — drive normally and you'll catch up.` };
        }
      }
    }

    // 4. Regroup point: the newest one from me or anyone in the convoy (unless I dismissed it).
    const fresh = x => x && t - x.at < 3 * 3600000;
    const candidates = [this.mine.regroup, ...peers.filter(p => p.online).map(p => cleanRegroup(p.together?.regroup))].filter(fresh);
    let regroup = candidates.filter(g => !(this.mine.dismissed || []).includes(g.id)).sort((a, b) => b.at - a.at)[0] || null;
    if (regroup) {
      const myGeo = me && hasPos(me) ? locate(me.positioning) : null;
      const miles = myGeo ? haversineMiles(myGeo, regroup) * 1.2 : null;
      const speed = Math.max(40, Number(me?.truck?.speedMph) || 0);
      regroup = { ...regroup, mine: this.mine.regroup?.id === regroup.id, miles: miles == null ? null : Math.round(miles), etaMinutes: miles == null ? null : Math.round(miles / speed * 60),
        drivers: roster.filter(r => r.online && hasPos(r)).map(r => { const g = locate(r.positioning); return g ? { driverName: r.driverName, isLocal: Boolean(r.isLocal), miles: Math.round(haversineMiles(g, regroup) * 1.2) } : null; }).filter(Boolean).sort((a, b) => a.miles - b.miles) };
      // Announce for the first minute after this Companion first sees it (spoken once by the Co-Driver).
      if (!this.firstSeen.has(regroup.id)) this.firstSeen.set(regroup.id, t);
      if (!regroup.mine && t - this.firstSeen.get(regroup.id) < 60000) alerts.push({ id: `together-regroup-${regroup.id}`, severity: 'info', title: `Regroup at ${regroup.name}`, detail: `${regroup.by || 'The convoy'} set a regroup point${regroup.miles != null ? `, about ${regroup.miles} mi away` : ''}.` });
    }

    // 5. Roll call: the newest from me or anyone; my answer is filled in automatically.
    const calls = [this.mine.rollCall, ...peers.filter(p => p.online).map(p => cleanRollCall(p.together?.rollCall))].filter(c => c && t - c.at < 60 * 60000);
    const call = calls.sort((a, b) => b.at - a.at)[0] || null;
    let rollCall = null;
    if (call) {
      const st = ctx.state || {};
      const myChecks = { inTruck: Boolean(st.connected), jobLoaded: Boolean(st.job?.active), sharingLocation: ctx.privacy?.shareLocation !== false, mapsOk: ctx.mapsOk ?? null, destination: st.job?.active ? cleanText(st.job.destinationCity, 60) : null };
      if (this.mine.rollCallSeen !== call.id) { this.mine.rollCallSeen = call.id; if (this.mine.rollCall?.id !== call.id) this.mine.ready = null; }
      this.myAnswer = { id: call.id, ready: this.mine.ready, checks: myChecks };
      const answers = roster.filter(r => r.online).map(r => {
        const a = r.isLocal ? this.myAnswer : cleanAnswer(r.together?.rollAnswer);
        const answered = a && a.id === call.id;
        const ch = answered ? a.checks : null;
        const auto = ch ? ch.inTruck && ch.jobLoaded && ch.sharingLocation && ch.mapsOk !== false : false;
        return { driverName: r.driverName, isLocal: Boolean(r.isLocal), answered: Boolean(answered), ready: answered ? (a.ready ?? auto) : null, confirmed: answered ? a.ready === true : false, checks: ch };
      });
      rollCall = { ...call, mine: this.mine.rollCall?.id === call.id, answers, readyCount: answers.filter(a => a.ready).length, total: answers.length, waiting: answers.filter(a => !a.answered).map(a => a.driverName) };
      if (!this.firstSeen.has(call.id)) this.firstSeen.set(call.id, t);
      if (!rollCall.mine && t - this.firstSeen.get(call.id) < 60000) {
        alerts.push({ id: `together-rollcall-${call.id}`, severity: 'info', title: `Roll call from ${call.by || 'the leader'}`, detail: 'Your Companion answered with your status. Press “I’m ready” on the Convoy page when you are.' });
      }
    } else this.myAnswer = null;

    // 6. Who's missing from the planned convoy (RSVP'd going/maybe, not here).
    const missing = [];
    const ev = (ctx.events || []).find(e => e.status === 'active') || (ctx.events || []).find(e => e.minutesUntil != null && e.minutesUntil <= 60 && e.minutesUntil >= -5);
    if (ev) {
      const expected = (ev.rsvps || []).filter(a => ['going', 'maybe'].includes(a.status)).map(a => a.driverName);
      if (ev.host && !expected.some(n => key(n) === key(ev.host))) expected.push(ev.host);
      for (const name of expected) {
        if (me && key(name) === key(me.driverName)) continue;
        const r = peers.find(p => key(p.driverName) === key(name));
        if (r?.online && hasPos(r)) continue;
        missing.push({ driverName: name, event: ev.name || ev.title || 'convoy',
          reason: !r ? 'Not connected to this convoy. They should open “Can my convoy see me?”: sharing on, same convoy code, relay key accepted.'
            : r.online ? 'Connected, but no position yet: ATS not running yet, or “Share location” is off.'
            : `Was here ${Math.max(1, Math.round((r.ageSeconds || 0) / 60))} min ago — Companion or game closed, or the relay stopped accepting them.` });
      }
    }

    // 7. The convoy line for the map: driving order with gap colours.
    const line = [];
    const members = ctx.formation?.active ? ctx.formation.members || [] : [];
    const warnMiles = Number(ctx.gapWarnMiles) || 2;
    for (const m of members) {
      const r = roster.find(x => x.id === m.id) || roster.find(x => key(x.driverName) === key(m.driverName));
      const g = r && hasPos(r) ? locate(r.positioning) : null;
      if (!g) continue;
      const gm = m.gapMiles ?? null;
      line.push({ id: m.id, driverName: m.driverName, isLocal: Boolean(m.isLocal), isLeader: Boolean(m.isLeader), lat: g.lat, lon: g.lon, gapMiles: gm, color: gm == null ? 'leader' : gm > warnMiles ? 'red' : gm > warnMiles / 2 || m.status === 'loose' || m.status === 'too-close' ? 'yellow' : 'green' });
    }

    this.last = { line, catchUp, missing, regroup, rollCall, wrongTurns, lost: [...this.lost.values()].map(l => ({ driverName: l.name, near: l.near, minutesAgo: Math.round((t - l.at) / 60000) })), leader: ctx.leader?.driverName || null };
    this.alertList = alerts;
    return alerts;
  }

  alerts() { return this.alertList || []; }
  status() { return { ...this.last, myReady: this.mine.ready, hasMyRegroup: Boolean(this.mine.regroup), hasMyRollCall: Boolean(this.mine.rollCall) }; }
}

module.exports = { ConvoyTogether, haversineMiles, heading, cleanRegroup, cleanRollCall, cleanAnswer };
