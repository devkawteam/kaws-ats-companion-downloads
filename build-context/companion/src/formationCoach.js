// Convoy formation coach: works out the running order behind the leader, the time gap between each
// truck and the one ahead, and gives the local driver one clear tip (ease off / close up / hold).
// Uses ATS game coordinates (metres) and speeds, so time gaps are real game-physics seconds. Author: Kaw.
'use strict';

const fin = v => v !== null && v !== undefined && Number.isFinite(Number(v));
const key = v => String(v || '').trim().toLowerCase();
const MPS_PER_MPH = 0.44704;

class FormationCoach {
  constructor(settings = {}, now = () => Date.now()) {
    this.settings = settings;
    this.now = now;
    this.trail = new Map();      // id -> [{x, z, t}] recent positions, for direction of travel
    this.closeSince = null;
    this.last = { active: false, members: [], tip: null, score: null };
  }

  get followSeconds() { return Math.max(2, Math.min(10, Number(this.settings.followSeconds) || 4)); }

  // Direction the leader is driving: from recent movement, else from the heading in telemetry.
  direction(m) {
    const t = this.trail.get(m.id) || [];
    const p = m.positioning;
    for (let i = 0; i < t.length; i++) {
      const dx = p.x - t[i].x, dz = p.z - t[i].z, d = Math.hypot(dx, dz);
      if (d > 40) return { x: dx / d, z: dz / d };
    }
    // SCS heading: 0 = north (-z), increasing anticlockwise; 0..1 of a full turn.
    if (fin(p.rotationX)) { const a = Number(p.rotationX) * 2 * Math.PI; return { x: -Math.sin(a), z: -Math.cos(a) }; }
    return null;
  }

  remember(members) {
    const t = this.now();
    for (const m of members) {
      const list = this.trail.get(m.id) || [];
      list.push({ x: m.positioning.x, z: m.positioning.z, t });
      while (list.length && t - list[0].t > 30000) list.shift();
      this.trail.set(m.id, list);
    }
  }

  // roster: convoy roster (getRoster); leader: { id } from the gap keeper (or null).
  evaluate(roster = [], leader = null) {
    const members = roster.filter(r => (r.online || r.isLocal) && r.positioning && fin(r.positioning.x) && fin(r.positioning.z) && !(Number(r.positioning.x) === 0 && Number(r.positioning.z) === 0))
      .map(r => ({ id: r.id, driverName: r.driverName, isLocal: Boolean(r.isLocal), positioning: { x: Number(r.positioning.x), z: Number(r.positioning.z), rotationX: r.positioning.rotationX }, speedMph: Math.max(0, Number(r.truck?.speedMph) || 0) }));
    this.remember(members);
    const lead = leader && members.find(m => m.id === leader.id || key(m.driverName) === key(leader.driverName));
    const me = members.find(m => m.isLocal);
    if (!lead || members.length < 2 || !me) {
      this.closeSince = null;
      this.last = { active: false, reason: !lead ? 'Choose a convoy leader on the Convoy Hub (or join an event) to start the coach.' : 'Waiting for another driver online.', members: [], tip: null, score: null, followSeconds: this.followSeconds };
      return this.last;
    }
    const dir = this.direction(lead) || { x: 0, z: -1 };
    // Along-track distance from the leader (negative = behind) and sideways offset.
    for (const m of members) {
      const dx = m.positioning.x - lead.positioning.x, dz = m.positioning.z - lead.positioning.z;
      m.along = dx * dir.x + dz * dir.z;
      m.side = dx * -dir.z + dz * dir.x;
    }
    const order = [lead, ...members.filter(m => m !== lead).sort((a, b) => b.along - a.along)];
    const target = this.followSeconds, warnMiles = Number(this.settings.gapWarnMiles) || 2;
    let good = 0, pairs = 0;
    const out = order.map((m, i) => {
      const row = { position: i + 1, id: m.id, driverName: m.driverName, isLocal: m.isLocal, isLeader: m === lead, speedMph: Math.round(m.speedMph), behindLeaderMiles: Math.round(Math.max(0, -m.along) / 1609.344 * 100) / 100 };
      if (m === lead) return { ...row, status: 'leader' };
      const ahead = order[i - 1];
      const gapM = Math.hypot(m.positioning.x - ahead.positioning.x, m.positioning.z - ahead.positioning.z);
      const speed = m.speedMph * MPS_PER_MPH;
      const seconds = speed > 2 ? gapM / speed : null;
      let status;
      if (m.along > 30) status = 'ahead-of-leader';
      else if (gapM / 1609.344 > warnMiles) status = 'broken';
      else if (seconds !== null && m.speedMph > 20 && seconds < Math.max(1.5, target / 2)) status = 'too-close';
      else if (seconds !== null && m.speedMph > 20 && seconds > target * 3 && gapM > 400) status = 'loose';
      else status = 'good';
      pairs++; if (status === 'good') good++;
      return { ...row, aheadName: ahead.driverName, gapFeet: Math.round(gapM * 3.28084), gapMiles: Math.round(gapM / 1609.344 * 100) / 100, gapSeconds: seconds === null ? null : Math.round(seconds * 10) / 10, status, _ahead: ahead, _gapM: gapM };
    });
    const mine = out.find(r => r.isLocal);
    let tip = null;
    if (mine?.isLeader) {
      const worst = out.filter(r => r.status === 'broken' || r.status === 'loose').sort((a, b) => b._gapM - a._gapM)[0];
      tip = worst ? { level: worst.status === 'broken' ? 'critical' : 'warn', text: `You're leading. ${worst.driverName} is ${worst.gapMiles} mi back — ease off a little so the group can close up.` } : { level: 'good', text: `You're leading a tidy formation of ${out.length}. Keep a steady speed and signal early.` };
    } else if (mine) {
      const ahead = mine._ahead;
      const want = Math.max(ahead.speedMph, 1) * MPS_PER_MPH * target;
      const suggest = Math.round(Math.max(0, ahead.speedMph + (mine._gapM - want) / 1609.344 * 60 * 2));   // close the error over ~30 s
      if (mine.status === 'too-close') tip = { level: 'critical', text: `Too close: ${mine.gapSeconds}s behind ${ahead.driverName}. Ease off — aim for ${target}s (${Math.round(want * 3.28084)} ft).` };
      else if (mine.status === 'broken') tip = { level: 'critical', text: `You've lost the convoy: ${mine.gapMiles} mi behind ${ahead.driverName}. Catch up safely${suggest ? ` (about ${Math.min(suggest, ahead.speedMph + 10)} mph)` : ''}.` };
      else if (mine.status === 'loose') tip = { level: 'warn', text: `${mine.gapSeconds}s behind ${ahead.driverName}. Close up to about ${target}s — try ${Math.min(suggest, ahead.speedMph + 8)} mph for a bit.` };
      else if (mine.status === 'ahead-of-leader') tip = { level: 'warn', text: `You're ahead of the leader (${lead.driverName}). Let them back in front.` };
      else tip = { level: 'good', text: `Good spacing: ${mine.gapSeconds ?? '—'}s behind ${ahead.driverName}. Position ${mine.position} of ${out.length}.` };
    }
    // Only alert about following too closely after it lasts 8 s (no nagging on a brief squeeze).
    if (mine?.status === 'too-close') this.closeSince ??= this.now(); else this.closeSince = null;
    this.last = {
      active: true, leader: lead.driverName, followSeconds: target, gapWarnMiles: warnMiles,
      score: pairs ? Math.round(good / pairs * 100) : 100,
      members: out.map(({ _ahead, _gapM, ...r }) => r), tip
    };
    return this.last;
  }

  alerts() {
    if (!this.closeSince || this.now() - this.closeSince < 8000 || !this.last.tip) return [];
    return [{ id: 'formation-close', severity: 'warn', title: 'Following too closely', detail: this.last.tip.text }];
  }

  status() { return this.last; }
}

module.exports = { FormationCoach };
