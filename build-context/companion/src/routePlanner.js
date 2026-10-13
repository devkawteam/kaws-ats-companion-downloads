// Multi-stop route planner for the ATS map. There is no road network in the Companion, so legs are
// city-to-city estimates: great-circle miles x a factor learned from YOUR finished deliveries
// (the game's planned job distance between two known cities), so estimates match ATS distances over
// time. Rest and fuel stops, map-DLC ownership per state, saved plans. Author: Kaw.
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { findCity, stateAt } = require('./mapCalibration');

const DEFAULT_FACTOR = 1.25;     // typical road-vs-straight-line ratio before any deliveries are learned
const num = v => (Number.isFinite(Number(v)) ? Number(v) : 0);

function greatCircleMiles(a, b) {
  const r = Math.PI / 180, dLat = (b.lat - a.lat) * r, dLon = (b.lon - a.lon) * r;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * r) * Math.cos(b.lat * r) * Math.sin(dLon / 2) ** 2;
  return 3958.8 * 2 * Math.asin(Math.min(1, Math.sqrt(h)));
}

function resolve(name, hint) {
  const c = findCity(name, hint);
  if (!c) return null;
  const st = stateAt(c.lon, c.lat);
  return { name: c.name, lon: c.lon, lat: c.lat, state: st?.name || null, stateCode: c.state || st?.code || null };
}

// Learn the ATS-distance factor from trips: median of plannedDistance / straight-line distance.
function learnFactor(trips = []) {
  const ratios = [];
  for (const t of trips) {
    if (!(num(t.plannedDistanceMiles) > 20) || !t.originCity || !t.destinationCity) continue;
    const a = resolve(t.originCity), b = resolve(t.destinationCity, a);
    if (!a || !b) continue;
    const gc = greatCircleMiles(a, b);
    if (gc < 15) continue;
    const r = num(t.plannedDistanceMiles) / gc;
    if (r > 0.3 && r < 4) ratios.push(r);
  }
  if (ratios.length < 3) return { factor: DEFAULT_FACTOR, learned: false, samples: ratios.length };
  ratios.sort((x, y) => x - y);
  const mid = ratios.length >> 1;
  const factor = ratios.length % 2 ? ratios[mid] : (ratios[mid - 1] + ratios[mid]) / 2;
  return { factor: Math.round(factor * 1000) / 1000, learned: true, samples: ratios.length };
}

/* stops: city names (2..12). opts: { speedMph, fuelRangeMiles, tankRangeMiles, driveHoursBeforeRest,
   restDueMinutes (from the game), ownedStates [state names], trips } */
function plan(stops, opts = {}) {
  const names = (Array.isArray(stops) ? stops : []).map(s => String(s || '').trim().slice(0, 60)).filter(Boolean).slice(0, 12);
  if (names.length < 2) throw new Error('Add at least a start and a destination.');
  const speed = Math.max(20, Math.min(80, num(opts.speedMph) || 55));
  const restEvery = Math.max(4, Math.min(14, num(opts.driveHoursBeforeRest) || 11)) * 60;
  const tank = Math.max(100, num(opts.tankRangeMiles) || 1000);
  const { factor, learned, samples } = learnFactor(opts.trips || []);
  const owned = new Set(opts.ownedStates || []);
  const points = [], unknown = [];
  for (const n of names) {
    const p = resolve(n, points[points.length - 1]);
    if (p) points.push({ ...p, asked: n }); else unknown.push(n);
  }
  if (unknown.length) return { ok: false, unknown, error: `Unknown or ambiguous city: ${unknown.join(', ')}. Try the exact ATS city name.` };
  const legs = [], stopsOut = [];
  let total = 0, minutes = 0, fuelLeft = num(opts.fuelRangeMiles) > 0 ? num(opts.fuelRangeMiles) : tank;
  let restLeft = num(opts.restDueMinutes) > 0 ? num(opts.restDueMinutes) : restEvery;
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1], b = points[i];
    const miles = Math.round(greatCircleMiles(a, b) * factor);
    const legMinutes = miles / speed * 60;
    // Walk the leg, dropping rest and fuel stops where they fall due.
    let done = 0;
    while (true) {
      const toRest = restLeft / 60 * speed, toFuel = Math.max(0, fuelLeft - 50);   // keep a 50 mi reserve
      const next = Math.min(toRest, toFuel);
      if (done + next >= miles) break;
      done += next;
      const kind = next === toRest ? 'rest' : 'fuel';
      const at = { lon: a.lon + (b.lon - a.lon) * done / miles, lat: a.lat + (b.lat - a.lat) * done / miles };
      stopsOut.push({ kind, leg: i, mileFromStart: Math.round(total + done), ...at, near: `${Math.round(done)} mi after ${a.name}` });
      fuelLeft -= next; restLeft -= next / speed * 60;
      if (kind === 'rest') restLeft = restEvery; else fuelLeft = tank;
    }
    fuelLeft -= miles - done; restLeft -= (miles - done) / speed * 60;
    total += miles; minutes += legMinutes;
    legs.push({ from: a.name, to: b.name, fromState: a.stateCode, toState: b.stateCode, miles, minutes: Math.round(legMinutes) });
  }
  const states = [...new Set(points.map(p => p.state).filter(Boolean))];
  const missing = owned.size ? states.filter(s => !owned.has(s)) : [];
  const restMinutes = stopsOut.filter(s => s.kind === 'rest').length * 9 * 60;   // ATS sleep ~9 game hours
  return {
    ok: true, points, legs, stops: stopsOut, states, missingStates: missing,
    totalMiles: total, driveMinutes: Math.round(minutes), totalGameMinutes: Math.round(minutes + restMinutes + stopsOut.filter(s => s.kind === 'fuel').length * 15),
    speedMph: speed, factor, learned, samples
  };
}

// Saved plans (data/route-plans.json), newest first, max 50.
class RoutePlans {
  constructor(file = path.join(process.cwd(), 'data', 'route-plans.json')) {
    this.file = file;
    try { this.list = JSON.parse(fs.readFileSync(file, 'utf8')); if (!Array.isArray(this.list)) this.list = []; } catch { this.list = []; }
  }
  save() { fs.mkdirSync(path.dirname(this.file), { recursive: true }); fs.writeFileSync(this.file, JSON.stringify(this.list, null, 2)); }
  add(name, stops, speedMph) {
    const entry = { id: `rp_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`, name: String(name || stops.join(' → ')).slice(0, 80), stops: stops.map(s => String(s).slice(0, 60)).slice(0, 12), speedMph: num(speedMph) || 55, savedAt: new Date().toISOString() };
    this.list.unshift(entry); this.list = this.list.slice(0, 50); this.save();
    return entry;
  }
  remove(id) { const n = this.list.length; this.list = this.list.filter(p => p.id !== id); if (this.list.length !== n) this.save(); return n !== this.list.length; }
}

module.exports = { plan, learnFactor, greatCircleMiles, RoutePlans, DEFAULT_FACTOR };
