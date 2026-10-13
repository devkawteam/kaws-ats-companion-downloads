// Convoy route sharing: the leader (or anyone) shares a planned route with the convoy over the relay.
// Rides along in the relay's cached "static" data, so it costs nothing per update. Routes from other
// drivers are untrusted and strictly cleaned before display. Author: Kaw.
'use strict';
const fs = require('node:fs');
const path = require('node:path');

const str = (v, n) => String(v ?? '').replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, n);
const num = (v, lo, hi) => { const x = Number(v); return Number.isFinite(x) && x >= lo && x <= hi ? x : null; };

// Clean a route (from us or from a peer). Returns null if it is not a usable route.
function cleanRoute(r) {
  if (!r || typeof r !== 'object' || !Array.isArray(r.stops)) return null;
  const stops = r.stops.slice(0, 12).map(s => ({ name: str(s?.name, 60), stateCode: str(s?.stateCode, 3) || null, lat: num(s?.lat, 15, 72), lon: num(s?.lon, -170, -50) }))
    .filter(s => s.name && s.lat !== null && s.lon !== null);
  if (stops.length < 2) return null;
  return {
    id: str(r.id, 40) || null, name: str(r.name, 80) || stops.map(s => s.name).join(' → '), by: str(r.by, 40) || null,
    stops, totalMiles: num(r.totalMiles, 0, 20000), driveMinutes: num(r.driveMinutes, 0, 100000), note: str(r.note, 200),
    sharedAt: str(r.sharedAt, 30) || null
  };
}

class RouteShare {
  constructor(file = path.join(process.cwd(), 'data', 'shared-route.json')) {
    this.file = file;
    this.active = null;     // the plan I follow (for the rest-stop alarm)
    this.mine = null;       // the plan I share with the convoy
    try { const d = JSON.parse(fs.readFileSync(file, 'utf8')); this.mine = cleanRoute(d.mine); this.active = cleanRoute(d.active); } catch {}
  }
  save() { try { fs.mkdirSync(path.dirname(this.file), { recursive: true }); fs.writeFileSync(this.file, JSON.stringify({ mine: this.mine, active: this.active }, null, 2)); } catch (e) { console.error('[ROUTESHARE]', e.message); } }

  // result: output of routePlanner.plan()
  fromPlan(result, extra = {}) {
    return cleanRoute({
      id: `rs_${Date.now().toString(36)}`, name: extra.name, by: extra.by, note: extra.note, sharedAt: new Date().toISOString(),
      stops: (result.points || []).map(p => ({ name: p.name, stateCode: p.stateCode, lat: p.lat, lon: p.lon })),
      totalMiles: result.totalMiles, driveMinutes: result.driveMinutes
    });
  }
  share(route) { this.mine = cleanRoute(route); this.save(); return this.mine; }
  stopSharing() { this.mine = null; this.save(); }
  follow(route) { this.active = cleanRoute(route); this.save(); return this.active; }
  unfollow() { this.active = null; this.save(); }

  // What goes to the relay (static data).
  shareable() { return this.mine; }

  // Routes other online drivers are sharing.
  fromRoster(roster = []) {
    return roster.filter(r => !r.isLocal && r.online && r.sharedRoute).map(r => ({ from: str(r.driverName, 40), route: cleanRoute(r.sharedRoute) })).filter(x => x.route);
  }
}

module.exports = { RouteShare, cleanRoute };
