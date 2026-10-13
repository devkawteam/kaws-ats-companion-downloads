// Trip routes: the road actually driven on each job, for recap cards and route replays.
// While a job is active the truck's exact position (ATS map projection) is sampled every 10 s and
// saved to data/routes/<trip id>.json when the trip finishes. Older files have only [lon, lat, t].

const fs = require('node:fs');
const path = require('node:path');
const { atsToLonLat } = require('./atsProjection');

const DIR = path.join(process.cwd(), 'data', 'routes');
const SAMPLE_MS = 10000;
const MAX_POINTS = 4000;
const safe = v => String(v || '').replace(/[^\w-]/g, '').slice(0, 80);

class TripRoutes {
  constructor() {
    this.points = [];
    this.lastAt = 0;
    try { fs.mkdirSync(DIR, { recursive: true }); } catch {}
  }

  observe(state) {
    if (!state.connected || !state.job?.active) return;
    const now = Date.now();
    if (now - this.lastAt < SAMPLE_MS) return;
    const p = atsToLonLat(Number(state.positioning?.x), Number(state.positioning?.z));
    if (!p) return;
    this.lastAt = now;
    const last = this.points.at(-1);
    // Skip while parked (under ~0.2 mi from the last point).
    if (last && Math.hypot((p.lon - last[0]) * 53, (p.lat - last[1]) * 69) < 0.2) return;
    // [lon, lat, unix seconds, game speed mph, odometer miles] — the last two drive the replay page.
    const mph = Number(state.truck?.speedMph), odo = Number(state.truck?.odometerMiles);
    this.points.push([Math.round(p.lon * 1e5) / 1e5, Math.round(p.lat * 1e5) / 1e5, Math.round(now / 1000), Number.isFinite(mph) ? Math.round(mph) : null, Number.isFinite(odo) ? Math.round(odo * 10) / 10 : null]);
    if (this.points.length > MAX_POINTS) this.points = this.points.filter((_, i) => i % 2 === 0);
  }

  onJobStarted() { this.points = []; this.lastAt = 0; }

  onTripFinished(trip) {
    if (!trip?.id) return;
    const points = this.points;
    this.points = [];
    if (points.length < 2) return;
    try { fs.writeFileSync(path.join(DIR, `${safe(trip.id)}.json`), JSON.stringify({ tripId: trip.id, points })); } catch (e) { console.error('[ROUTES]', e.message); }
  }

  load(tripId) {
    try { return JSON.parse(fs.readFileSync(path.join(DIR, `${safe(tripId)}.json`), 'utf8')).points || []; } catch { return []; }
  }

  current() { return this.points; }
}

module.exports = { TripRoutes };
