// v1.7 extras API: route planner + convoy route sharing, formation coach, real-world weather,
// fuel & money, map pack check. Author: Kaw.
'use strict';
const { json, readBody } = require('./apiDrive');
const { trustedLocal } = require('./apiAi');
const { saveConfigSection } = require('./config');
const { plan } = require('./routePlanner');
const { findCity } = require('./mapCalibration');
const { moneyStats } = require('./moneyStats');
const { mapCheck } = require('./mapCheck');

const ROUTES = ['/api/planner', '/api/formation', '/api/weather', '/api/money', '/api/mapcheck', '/api/jarvis', '/api/calendar', '/api/h2h'];

// City names for the planner's autocomplete (ATS supplement + Natural Earth cities inside the US box).
let cityNames = null;
function cities() {
  if (cityNames) return cityNames;
  const set = new Set(require('./atsCities').map(c => c[0]));
  try {
    const ne = require('../public/natural-earth-na.json');
    for (const c of ne.cities || []) if (c.lon < -66 && c.lat > 24 && c.lat < 50 && findCity(c.name)) set.add(c.name);
  } catch {}
  return (cityNames = [...set].sort());
}
// The same cities with coordinates (for the rest-stop alarm).
let cityPts = null;
function cityPoints() {
  if (cityPts) return cityPts;
  return (cityPts = cities().map(n => { const c = findCity(n); return c && { name: c.name, lon: c.lon, lat: c.lat, state: c.state || null }; }).filter(Boolean));
}

function planWith(s, b) {
  const scan = s.intelligence?.getScan?.() || {};
  return plan(b.stops, {
    speedMph: b.speedMph, driveHoursBeforeRest: b.driveHoursBeforeRest,
    fuelRangeMiles: b.useLiveFuel === false ? 0 : s.state?.truck?.fuelRangeMiles,
    restDueMinutes: b.useLiveFuel === false ? 0 : s.state?.navigation?.restStopMinutes,
    ownedStates: scan.capabilities?.mapStates || [],
    trips: s.trips?.getRecent?.(1000) || []
  });
}
const myName = s => (s.convoy?.getRoster?.() || []).find(r => r.isLocal)?.driverName || s.config?.driverName || 'Driver';

async function handlePlus(req, res, url, s) {
  const p = url.pathname, m = req.method;
  if (!ROUTES.some(r => p === r || p.startsWith(r + '/'))) return false;
  const write = m !== 'GET';
  if (write && !trustedLocal(req) && p !== '/api/jarvis/chat' && p !== '/api/jarvis/speak') return json(res, { ok: false, error: 'Change this on the PC running the Companion.' }, 403);
  try {
    // ---- route planner ----
    if (p === '/api/planner/cities' && m === 'GET') {
      const job = s.state?.job || {};
      return json(res, { ok: true, cities: cities(), job: job.active ? { from: job.originCity, to: job.destinationCity } : null });
    }
    if (p === '/api/planner/plan' && m === 'POST') {
      const result = planWith(s, await readBody(req));
      return json(res, result, result.ok ? 200 : 400);
    }

    // ---- convoy route sharing + the plan I follow (rest-stop alarm) ----
    if (p === '/api/planner/shared' && m === 'GET') {
      const rs = s.routeShare;
      return json(res, { ok: true, mine: rs?.mine || null, active: rs?.active || null, convoy: rs?.fromRoster(s.convoy?.getRoster?.() || []) || [] });
    }
    if ((p === '/api/planner/share' || p === '/api/planner/follow') && m === 'POST') {
      const b = await readBody(req);
      let route;
      if (b.route) route = require('./routeShare').cleanRoute(b.route);     // following a friend's shared route
      else { const result = planWith(s, b); if (!result.ok) return json(res, result, 400); route = s.routeShare.fromPlan(result, { name: b.name, note: b.note, by: myName(s) }); }
      if (!route) return json(res, { ok: false, error: 'That route is not valid.' }, 400);
      if (p === '/api/planner/share') { if (b.route) return json(res, { ok: false, error: 'Share your own plan.' }, 400); return json(res, { ok: true, mine: s.routeShare.share(route) }); }
      return json(res, { ok: true, active: s.routeShare.follow(route) });
    }
    if (p === '/api/planner/share/stop' && m === 'POST') { s.routeShare.stopSharing(); return json(res, { ok: true }); }
    if (p === '/api/planner/unfollow' && m === 'POST') { s.routeShare.unfollow(); return json(res, { ok: true }); }
    if (p === '/api/planner/rest' && m === 'GET') return json(res, { ok: true, ...(s.restStatus?.() || { active: false }) });

    // ---- fuel & money ----
    if (p === '/api/money' && m === 'GET') {
      const days = Math.max(0, Math.min(3650, Number(url.searchParams.get('days') ?? 30) || 0));
      const fuelPrice = Number(s.config?.money?.fuelPrice) || 4.2;
      return json(res, { ok: true, ...moneyStats(s.trips?.getRecent?.(5000) || [], { fuelPrice, days }) });
    }
    if (p === '/api/money/settings' && m === 'POST') {
      const b = await readBody(req);
      const fuelPrice = Number(b.fuelPrice);
      if (!(fuelPrice > 0 && fuelPrice <= 20)) return json(res, { ok: false, error: 'Fuel price must be between $0.01 and $20 per gallon.' }, 400);
      const next = { fuelPrice: Math.round(fuelPrice * 100) / 100 };
      saveConfigSection('money', next);
      if (s.config) s.config.money = next;
      return json(res, { ok: true, ...next });
    }

    // ---- Jarvis (KAW's office assistant, via the relay) ----
    if (p === '/api/jarvis/status' && m === 'GET') return json(res, await s.jarvis.status());
    if (p === '/api/jarvis/chat' && m === 'POST') {
      const b = await readBody(req);
      try { return json(res, { ok: true, ...(await s.jarvis.chat(b.messages, s.state, s.calibration?.locate?.(s.state?.positioning))) }); }
      catch (e) { return json(res, { ok: false, error: e.message }, 502); }
    }
    if (p === '/api/jarvis/voices' && m === 'GET') return json(res, await s.jarvis.voices());
    if (p === '/api/jarvis/speak' && m === 'POST') {
      const b = await readBody(req);
      try {
        const audio = await s.jarvis.speak(b.text, b.voice, Number(b.rate) || 1);
        res.writeHead(200, { 'content-type': audio.contentType || 'audio/mpeg', 'content-length': audio.length, 'cache-control': 'no-store' });
        res.end(audio); return true;
      } catch (e) { return json(res, { ok: false, error: e.message }, 502); }
    }
    // Trip briefing (built locally from the Companion's own data).
    if (p === '/api/jarvis/briefing' && m === 'GET') {
      const { buildBriefing } = require('./tripBriefing');
      const scan = s.intelligence?.getScan?.() || {};
      let weather = null;
      if (s.weather?.enabled) { const g = s.calibration?.locate?.(s.state?.positioning); if (g) weather = await s.weather.at(g.lon, g.lat).catch(() => null); }
      const roster = s.convoy?.getRoster?.() || [];
      return json(res, { ok: true, ...buildBriefing({ state: s.state, trips: s.trips?.getRecent?.(1000) || [], ownedStates: scan.capabilities?.mapStates || [], weather, active: s.routeShare?.active, events: s.events?.list?.(roster) || [], driverName: myName(s) }) });
    }
    // Things the driver asked Jarvis to remember (this PC only).
    if (p.startsWith('/api/jarvis/memory')) {
      if (!trustedLocal(req)) return json(res, { ok: false, error: 'Manage what Jarvis remembers on the PC running the Companion.' }, 403);
      const mem = s.jarvisMemory;
      if (p === '/api/jarvis/memory' && m === 'GET') return json(res, { ok: true, items: mem.list() });
      const b = await readBody(req);
      try {
        if (p === '/api/jarvis/memory' && m === 'POST') return json(res, { ok: true, item: mem.add(b.text), items: mem.list() });
        if (p === '/api/jarvis/memory/update' && m === 'POST') return json(res, { ok: true, item: mem.update(String(b.id || ''), b.text), items: mem.list() });
        if (p === '/api/jarvis/memory/delete' && m === 'POST') { mem.remove(String(b.id || '')); return json(res, { ok: true, items: mem.list() }); }
        if (p === '/api/jarvis/memory/clear' && m === 'POST') { mem.clear(); return json(res, { ok: true, items: [] }); }
      } catch (e) { return json(res, { ok: false, error: e.message }, 400); }
    }
    if (p === '/api/jarvis/settings' && m === 'POST') {
      const b = await readBody(req);
      const next = { ...(s.config?.jarvis || {}) };
      if ('enabled' in b) next.enabled = b.enabled !== false;
      if ('url' in b) {
        const url = require('./jarvisClient').cleanJarvisUrl(b.url);
        if (url === null) return json(res, { ok: false, error: 'Use an https:// address for the Jarvis server (or leave it empty to use your convoy relay).' }, 400);
        next.url = url;
      }
      saveConfigSection('jarvis', next);
      if (s.config) s.config.jarvis = next;
      return json(res, { ok: true, ...next });
    }

    // ---- convoy calendar ----
    if (p === '/api/calendar' && m === 'GET') {
      const roster = s.convoy?.getRoster?.() || [];
      return json(res, { ok: true, ...(await s.calendar.upcoming(s.events?.list?.(roster) || [], Math.max(1, Math.min(90, Number(url.searchParams.get('days')) || 30)))) });
    }
    if (p === '/api/calendar/ics' && m === 'GET') {
      const { toIcs } = require('./convoyCalendar');
      const all = (await s.calendar.upcoming(s.events?.list?.(s.convoy?.getRoster?.() || []) || [], 90)).events;
      const id = url.searchParams.get('id');
      const pick = id ? all.filter(e => e.id === id) : all;
      if (!pick.length) return json(res, { ok: false, error: 'Event not found.' }, 404);
      res.writeHead(200, { 'content-type': 'text/calendar; charset=utf-8', 'content-disposition': `attachment; filename="${id ? 'kaw-convoy' : 'kaw-convoys'}.ics"`, 'cache-control': 'no-store' });
      return res.end(toIcs(pick));
    }
    if (p === '/api/calendar/settings' && m === 'GET') return json(res, { ok: true, feeds: s.calendar.feeds() });
    if (p === '/api/calendar/settings' && m === 'POST') {
      const { cleanFeedUrl } = require('./convoyCalendar');
      const b = await readBody(req);
      const feeds = (Array.isArray(b.feeds) ? b.feeds : []).slice(0, 3).map(f => ({ name: String(f.name || 'Calendar').slice(0, 40), url: cleanFeedUrl(f.url) }));
      if (feeds.some(f => !f.url)) return json(res, { ok: false, error: 'Use a public https (or webcal) calendar link.' }, 400);
      saveConfigSection('calendar', { feeds });
      if (s.config) s.config.calendar = { feeds }; s.calendar.settings = { feeds }; s.calendar.cache.clear();
      return json(res, { ok: true, feeds });
    }

    // ---- head-to-head ----
    if (p === '/api/h2h' && m === 'GET') return json(res, { ok: true, ...s.headToHead.status(s.convoy?.getRoster?.() || [], s.driverStats?.() || {}, myName(s)) });
    if (p.startsWith('/api/h2h/') && m === 'POST') {
      const b = await readBody(req);
      const week = s.driverStats?.()?.week?.key || '';
      if (p === '/api/h2h/challenge') return json(res, { ok: true, challenge: s.headToHead.challenge(b.to, b.metric, week) });
      if (p === '/api/h2h/accept') { s.headToHead.accept(String(b.from || ''), String(b.id || ''), week, String(b.metric || '')); return json(res, { ok: true }); }
      if (p === '/api/h2h/cancel') { s.headToHead.cancel(String(b.id || '')); return json(res, { ok: true }); }
    }

    // ---- map pack check ----
    if (p === '/api/mapcheck' && m === 'GET') {
      const scan = s.intelligence?.getScan?.() || {};
      const roster = s.convoy?.getRoster?.() || [];
      const plans = (s.routePlans?.list || []).slice(0, 30).map(pl => { const r = plan(pl.stops, {}); return { name: pl.name, states: r.ok ? r.states : [] }; });
      if (s.routeShare?.active) plans.unshift({ name: `${s.routeShare.active.name} (following)`, states: s.routeShare.active.stops.map(x => require('./mapCalibration').stateAt(x.lon, x.lat)?.name) });
      const job = s.state?.job?.active ? s.state.job : null;
      return json(res, { ok: true, ...mapCheck({ ownedStates: scan.capabilities?.mapStates || [], scanned: Boolean(scan.gameRoot), plans, shared: s.routeShare?.fromRoster(roster) || [], events: s.events?.list?.(roster) || [], job, roster }) });
    }
    if (p === '/api/planner/plans' && m === 'GET') return json(res, { ok: true, plans: s.routePlans?.list || [] });
    if (p === '/api/planner/plans' && m === 'POST') {
      const b = await readBody(req);
      if (!Array.isArray(b.stops) || b.stops.length < 2) return json(res, { ok: false, error: 'A plan needs at least two stops.' }, 400);
      return json(res, { ok: true, plan: s.routePlans.add(b.name, b.stops, b.speedMph) });
    }
    if (p === '/api/planner/plans/delete' && m === 'POST') { const b = await readBody(req); return json(res, { ok: s.routePlans.remove(String(b.id || '')) }); }

    // ---- formation coach ----
    if (p === '/api/formation' && m === 'GET') return json(res, { ok: true, ...(s.formation?.status?.() || { active: false }) });
    if (p === '/api/formation/settings' && m === 'POST') {
      const b = await readBody(req);
      const next = { followSeconds: Math.max(2, Math.min(10, Number(b.followSeconds) || 4)) };
      saveConfigSection('formation', next);
      if (s.config) s.config.formation = next;
      if (s.formation) s.formation.settings = { ...s.formation.settings, ...next };
      return json(res, { ok: true, ...next });
    }

    // ---- real-world weather (opt-in) ----
    if (p === '/api/weather' && m === 'GET') {
      if (!s.weather?.enabled) return json(res, { ok: true, enabled: false });
      const geo = s.calibration?.locate?.(s.state?.positioning);
      if (!geo) return json(res, { ok: true, enabled: true, waiting: true, error: 'No position yet. Drive in ATS with telemetry connected.' });
      return json(res, { ok: true, near: geo.near, state: geo.state, ...(await s.weather.at(geo.lon, geo.lat)) });
    }
    if (p === '/api/weather/settings' && m === 'POST') {
      const b = await readBody(req);
      const next = { enabled: b.enabled === true };
      saveConfigSection('weather', next);
      if (s.config) s.config.weather = next;
      if (s.weather) s.weather.settings = next;
      return json(res, { ok: true, ...next });
    }
    return false;
  } catch (e) {
    return json(res, { ok: false, error: e.message }, 400);
  }
}

module.exports = { handlePlus, cities, cityPoints };
