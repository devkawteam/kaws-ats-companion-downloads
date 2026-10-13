// Real-world weather where your truck is in ATS, from the free US National Weather Service API
// (api.weather.gov, no key). Off by default: when turned on, only the real-world equivalent of your
// game position (rounded to ~1 mile) is sent to weather.gov. Cached 10 minutes. Author: Kaw.
'use strict';

const BASE = 'https://api.weather.gov';
const UA = 'KAWs-ATS-Companion/1.7 (personal desktop app; weather for game location)';
const TTL = 10 * 60 * 1000;

class RealWeather {
  constructor(settings = {}, { fetchImpl = fetch, now = () => Date.now() } = {}) {
    this.settings = settings;
    this.fetch = fetchImpl;
    this.now = now;
    this.cache = new Map();
  }

  get enabled() { return this.settings?.enabled === true; }

  async get(path) {
    const r = await this.fetch(`${BASE}${path}`, { headers: { 'user-agent': UA, accept: 'application/geo+json' }, redirect: 'follow', signal: AbortSignal.timeout(12000) });
    if (!r.ok) throw new Error(r.status === 404 ? 'No US weather data for this spot (outside the USA?).' : `weather.gov answered HTTP ${r.status}`);
    return r.json();
  }

  // lon/lat: the real-world point matching the truck's game position.
  async at(lon, lat) {
    if (!this.enabled) return { enabled: false };
    if (!(lon > -180 && lon < -60 && lat > 15 && lat < 72)) throw new Error('No position yet. Drive in ATS with telemetry connected.');
    const la = Math.round(lat * 100) / 100, lo = Math.round(lon * 100) / 100;   // ~1 mile, and what NWS accepts
    const k = `${la},${lo}`, hit = this.cache.get(k);
    if (hit && this.now() - hit.at < TTL) return hit.value;
    const point = await this.get(`/points/${la},${lo}`);
    const p = point.properties || {};
    const [hourly, alerts] = await Promise.all([
      p.forecastHourly ? this.get(new URL(p.forecastHourly).pathname) : null,
      this.get(`/alerts/active?point=${la},${lo}`).catch(() => ({ features: [] }))
    ]);
    const periods = (hourly?.properties?.periods || []).slice(0, 8).map(x => ({
      start: x.startTime, temperatureF: x.temperatureUnit === 'C' ? Math.round(x.temperature * 9 / 5 + 32) : x.temperature,
      wind: [x.windSpeed, x.windDirection].filter(Boolean).join(' '), short: x.shortForecast, rainChance: x.probabilityOfPrecipitation?.value ?? null, isDaytime: x.isDaytime
    }));
    const rel = p.relativeLocation?.properties || {};
    const value = {
      enabled: true, lat: la, lon: lo, place: [rel.city, rel.state].filter(Boolean).join(', ') || null, office: p.cwa || null,
      now: periods[0] || null, hourly: periods,
      alerts: (alerts?.features || []).slice(0, 6).map(f => ({ event: f.properties?.event, severity: f.properties?.severity, headline: f.properties?.headline, ends: f.properties?.ends || f.properties?.expires })),
      tip: drivingTip(periods[0], alerts?.features || []), fetchedAt: new Date(this.now()).toISOString(), source: 'National Weather Service (weather.gov)'
    };
    this.cache.set(k, { at: this.now(), value });
    if (this.cache.size > 50) this.cache.delete(this.cache.keys().next().value);
    return value;
  }
}

// A short role-play tip: what a real trucker would do in this weather.
function drivingTip(now, alerts) {
  const text = `${now?.short || ''} ${alerts.map(a => a.properties?.event || '').join(' ')}`.toLowerCase();
  const wind = Number(String(now?.wind || '').match(/(\d+)\s*mph/)?.[1] || 0);
  if (/blizzard|winter storm|ice|freezing/.test(text)) return 'Real-world winter hazard here: chains-up mindset, slow down, double your following distance.';
  if (/tornado|severe thunderstorm/.test(text)) return 'Severe storms nearby in real life — a good moment for a rest stop in the game.';
  if (/high wind|wind advisory/.test(text) || wind >= 30) return 'Strong real-world winds: empty trailers sway, so keep speed down.';
  if (/snow/.test(text)) return 'Snow in the real world here — drive gently and keep extra distance.';
  if (/rain|shower|storm/.test(text)) return 'Wet roads in real life here: longer braking distances, lights on.';
  if (/fog|haze|smoke/.test(text)) return 'Low visibility in real life: lights on and extra spacing.';
  if (now && now.temperatureF >= 100) return 'Extreme heat today — in real life tyres and brakes work hard. Stay hydrated, driver!';
  return 'Clear sailing in the real world here.';
}

module.exports = { RealWeather, drivingTip };
