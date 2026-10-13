// Convoy gap keeper: followers are told when they drift too far from the leader; the leader is
// told when someone falls behind or stops. Distances use ATS game coordinates (same as the radar).

const fin = v => v !== null && v !== undefined && Number.isFinite(Number(v));
const miles = (a, b) => (a && b && fin(a.x) && fin(a.z) && fin(b.x) && fin(b.z) ? Math.hypot(b.x - a.x, b.z - a.z) / 1609.344 : null);
const key = v => String(v || '').trim().toLowerCase();

class GapKeeper {
  constructor(settings = {}) {
    this.settings = settings;
    this.manualLeader = null;   // chosen on the Convoy Hub
    this.stoppedSince = new Map();
    this.last = { leader: null, source: null, gaps: [] };
  }

  setLeader(name) { this.manualLeader = name ? String(name).slice(0, 80) : null; }

  // Leader: manual choice > host of the active convoy event > none.
  pickLeader(roster, activeEvent) {
    const online = roster.filter(r => r.online);
    const find = n => online.find(r => key(r.driverName) === key(n));
    if (this.manualLeader && find(this.manualLeader)) return { leader: find(this.manualLeader), source: 'chosen' };
    if (activeEvent?.host && find(activeEvent.host)) return { leader: find(activeEvent.host), source: 'convoy host' };
    return { leader: null, source: null };
  }

  evaluate(roster = [], activeEvent = null) {
    const gapMax = Number(this.settings.gapWarnMiles) || 2;
    const { leader, source } = this.pickLeader(roster, activeEvent);
    const me = roster.find(r => r.isLocal);
    const alerts = [];
    const gaps = [];
    if (leader && me) {
      const followers = roster.filter(r => r.online && !r.isLocal && r.id !== leader.id);
      if (!me.isLocal || leader.id !== me.id) {
        // I'm following.
        const d = miles(me.positioning, leader.positioning);
        if (d !== null) {
          gaps.push({ driverName: me.driverName, miles: d });
          if (d > gapMax) alerts.push({ id: 'gap', severity: d > gapMax * 2 ? 'critical' : 'warn', title: 'Close up the gap', detail: `${d.toFixed(1)} mi from the leader (${leader.driverName})` });
        }
      }
      if (leader.id === me.id || leader.isLocal) {
        // I'm leading: watch everyone else.
        const now = Date.now();
        const leaderMoving = Number(me.truck?.speedMph) > 5;
        for (const f of followers) {
          const d = miles(me.positioning, f.positioning);
          if (d === null) continue;
          gaps.push({ driverName: f.driverName, miles: d });
          if (d > gapMax) alerts.push({ id: `straggler-${f.id}`, severity: d > gapMax * 2 ? 'critical' : 'warn', title: `${f.driverName} is falling behind`, detail: `${d.toFixed(1)} mi back — slow down or hold` });
          const stopped = Number(f.truck?.speedMph) < 1;
          if (stopped && leaderMoving) { if (!this.stoppedSince.has(f.id)) this.stoppedSince.set(f.id, now); }
          else this.stoppedSince.delete(f.id);
          if (this.stoppedSince.has(f.id) && now - this.stoppedSince.get(f.id) > 60000) alerts.push({ id: `stopped-${f.id}`, severity: 'warn', title: `${f.driverName} has stopped`, detail: `Stopped for ${Math.round((now - this.stoppedSince.get(f.id)) / 60000) || 1} min, ${d.toFixed(1)} mi back` });
        }
      }
    }
    this.last = { leader: leader ? { id: leader.id, driverName: leader.driverName, isLocal: Boolean(leader.isLocal) } : null, source, gapWarnMiles: gapMax, gaps: gaps.map(g => ({ ...g, miles: Math.round(g.miles * 10) / 10 })) };
    return alerts;
  }

  status() { return { ...this.last, manualLeader: this.manualLeader }; }
}

module.exports = { GapKeeper };
