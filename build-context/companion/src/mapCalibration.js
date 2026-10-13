// Live map positioning for ATS.
// v1.6: positions now come from the game's own map projection (atsProjection.js), which is exact from
// the first second. The city-pair fit below is still learned and shared as a sanity check, and still
// validates convoy points, but no longer decides where a truck is drawn.
// ATS telemetry only reports game-world coordinates. Every time a driver starts or delivers a job
// we know the truck's game coordinates AND the real city it is in, so we record that pair. With
// three or more well-spread cities we fit an affine transform game(x,z) -> (lon,lat), which lets the
// Companion place every convoy driver on a real US map and name the nearest city. Convoy members
// share their points through the relay, so the map calibrates itself for the whole community.

const fs = require('node:fs');
const { atsToLonLat } = require('./atsProjection');
const path = require('node:path');

const DATA_FILE = path.join(process.cwd(), 'data', 'map-calibration.json');
const GEO_FILE = path.join(process.cwd(), 'public', 'natural-earth-na.json');
const MAX_POINTS = 200;
const fin = v => v !== null && v !== undefined && Number.isFinite(Number(v));
const key = v => String(v || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '');

let geo = null;
function loadGeo() {
  if (geo) return geo;
  try {
    const raw = JSON.parse(fs.readFileSync(GEO_FILE, 'utf8'));
    geo = { cities: raw.cities || [], regions: (raw.regions || []).filter(r => r.country === 'USA' || r.country === 'US' || /^[A-Z]{2}$/.test(r.code || '') && r.country !== 'CAN' && r.country !== 'MEX') };
  } catch (e) {
    console.error('[MAP] Could not load geography:', e.message);
    geo = { cities: [], regions: [] };
  }
  return geo;
}

function pointInRing(lon, lat, ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i], [xj, yj] = ring[j];
    if ((yi > lat) !== (yj > lat) && lon < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

function stateAt(lon, lat) {
  for (const r of loadGeo().regions) {
    for (const part of r.parts || []) {
      const ring = Array.isArray(part[0]?.[0]) ? part[0] : part;
      if (pointInRing(lon, lat, ring)) return { name: r.name, code: r.code };
    }
  }
  return null;
}

const ATS_CITIES = require('./atsCities').map(([name, state, lat, lon]) => ({ name, state, lat, lon }));

// Every known city with this name (ATS supplement first, then Natural Earth cities in the US).
function cityCandidates(name) {
  const k = key(name);
  if (!k) return [];
  const out = ATS_CITIES.filter(c => key(c.name) === k);
  for (const c of loadGeo().cities) {
    if (key(c.name) !== k || c.lon > -66 || c.lat < 24 || c.lat > 50) continue;
    if (!out.some(o => Math.hypot(o.lon - c.lon, o.lat - c.lat) < 0.5)) out.push(c);
  }
  return out;
}

// Resolve a city name; ambiguous names (e.g. Springfield) need a position hint to pick the right one.
function findCity(name, hint = null) {
  const list = cityCandidates(name);
  if (list.length <= 1) return list[0] || null;
  if (!hint) return null;
  return list.reduce((best, c) => (Math.hypot(c.lon - hint.lon, c.lat - hint.lat) < Math.hypot(best.lon - hint.lon, best.lat - hint.lat) ? c : best));
}

// Solve a 3x3 linear system (Cramer's rule).
function solve3(m, v) {
  const det = a => a[0][0] * (a[1][1] * a[2][2] - a[1][2] * a[2][1]) - a[0][1] * (a[1][0] * a[2][2] - a[1][2] * a[2][0]) + a[0][2] * (a[1][0] * a[2][1] - a[1][1] * a[2][0]);
  const D = det(m);
  if (Math.abs(D) < 1e-9) return null;
  return [0, 1, 2].map(col => det(m.map((row, i) => row.map((x, j) => (j === col ? v[i] : x)))) / D);
}

class MapCalibration {
  constructor() {
    this.points = [];
    this.fit = null;
    this.dirty = false;
    try {
      const saved = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
      this.points = Array.isArray(saved.points) ? saved.points : [];
    } catch {}
    this.refit();
  }

  save() {
    if (!this.dirty) return;
    try {
      fs.mkdirSync(path.dirname(DATA_FILE), { recursive: true });
      fs.writeFileSync(DATA_FILE, JSON.stringify({ points: this.points }, null, 2), 'utf8');
      this.dirty = false;
    } catch (e) { console.error('[MAP]', e.message); }
  }

  // Record "the truck is in <city> right now".
  learn(cityName, positioning, source = 'local') {
    if (!positioning || !fin(positioning.x) || !fin(positioning.z)) return false;
    const city = findCity(cityName, this.locate(positioning));
    if (!city) return false;
    return this.addPoint({ city: city.name, lon: city.lon, lat: city.lat, x: Number(positioning.x), z: Number(positioning.z), source });
  }

  addPoint(p) {
    if (![p?.x, p?.z, p?.lon, p?.lat].every(fin) || !p.city) return false;
    // Once the map is well calibrated, reject points that disagree wildly (bad data or a mod map).
    if (this.fit && this.fit.cities >= 5) {
      const guess = this.locate({ x: p.x, z: p.z });
      if (!guess || Math.hypot((guess.lon - p.lon) * 53, (guess.lat - p.lat) * 69) > 150) return false;
    }
    const k = key(p.city);
    // Keep up to 5 samples per city so one odd depot position does not dominate.
    const same = this.points.filter(q => key(q.city) === k);
    if (same.some(q => Math.hypot(q.x - p.x, q.z - p.z) < 50)) return false;
    if (same.length >= 5) this.points.splice(this.points.indexOf(same[0]), 1);
    this.points.push({ city: String(p.city).slice(0, 60), lon: Number(p.lon), lat: Number(p.lat), x: Number(p.x), z: Number(p.z), source: p.source === 'local' ? 'local' : 'convoy', at: new Date().toISOString() });
    this.points = this.points.slice(-MAX_POINTS);
    this.dirty = true;
    this.refit();
    return true;
  }

  // Accept calibration points shared by other convoy drivers (validated against our own city list).
  mergePeerPoints(points = []) {
    let added = 0;
    for (const p of (Array.isArray(points) ? points : []).slice(0, 40)) {
      if (!fin(p?.x) || !fin(p?.z)) continue;
      const city = findCity(p.city, this.locate({ x: p.x, z: p.z }));
      if (!city) continue;
      if (this.addPoint({ city: city.name, lon: city.lon, lat: city.lat, x: p.x, z: p.z, source: 'convoy' })) added++;
    }
    return added;
  }

  refit() {
    // Average samples per city first, then least-squares fit lon/lat = a*x + b*z + c.
    const byCity = new Map();
    for (const p of this.points) {
      const k = key(p.city);
      const e = byCity.get(k) || { lon: p.lon, lat: p.lat, x: 0, z: 0, n: 0, city: p.city };
      e.x += p.x; e.z += p.z; e.n++;
      byCity.set(k, e);
    }
    const pts = [...byCity.values()].map(e => ({ ...e, x: e.x / e.n, z: e.z / e.n }));
    this.fit = null;
    if (pts.length < 3) return;
    const S = (f) => pts.reduce((s, p) => s + f(p), 0);
    const M = [[S(p => p.x * p.x), S(p => p.x * p.z), S(p => p.x)], [S(p => p.x * p.z), S(p => p.z * p.z), S(p => p.z)], [S(p => p.x), S(p => p.z), pts.length]];
    const lonC = solve3(M, [S(p => p.x * p.lon), S(p => p.z * p.lon), S(p => p.lon)]);
    const latC = solve3(M, [S(p => p.x * p.lat), S(p => p.z * p.lat), S(p => p.lat)]);
    if (!lonC || !latC) return;
    const apply = (x, z) => [lonC[0] * x + lonC[1] * z + lonC[2], latC[0] * x + latC[1] * z + latC[2]];
    const errMiles = Math.sqrt(S(p => { const [lo, la] = apply(p.x, p.z); return ((lo - p.lon) * 53) ** 2 + ((la - p.lat) * 69) ** 2; }) / pts.length);
    this.fit = { lonC, latC, cities: pts.length, errorMiles: errMiles };
  }

  status() {
    return { cities: this.fit?.cities || new Set(this.points.map(p => key(p.city))).size, points: this.points.length, ready: true, exact: true, errorMiles: 0, fitErrorMiles: this.fit ? Math.round(this.fit.errorMiles) : null, needed: 0 };
  }

  // game coordinates -> { lon, lat, near, state, approx }
  locate(positioning) {
    if (!positioning || !fin(positioning.x) || !fin(positioning.z)) return null;
    const x = Number(positioning.x), z = Number(positioning.z);
    if (x === 0 && z === 0) return null;
    const { lon, lat } = atsToLonLat(x, z) || {};
    if (!(lon > -170 && lon < -50 && lat > 15 && lat < 72)) return null;
    let near = null, best = Infinity;
    for (const c of [...ATS_CITIES, ...loadGeo().cities]) {
      const d = Math.hypot((c.lon - lon) * 53, (c.lat - lat) * 69);
      if (d < best) { best = d; near = c; }
    }
    const st = stateAt(lon, lat);
    const nearState = near ? (near.state || stateAt(near.lon, near.lat)?.code || null) : null;
    return { lon, lat, near: near?.name || null, nearState, nearMiles: Number.isFinite(best) ? Math.round(best) : null, state: st?.name || null, stateCode: st?.code || null, accuracyMiles: 0, exact: true };
  }

  // A compact sample to share with the convoy.
  shareable() {
    return this.points.filter(p => p.source === 'local').slice(-30).map(({ city, x, z }) => ({ city, x: Math.round(x), z: Math.round(z) }));
  }
}

module.exports = { MapCalibration, stateAt, findCity };
