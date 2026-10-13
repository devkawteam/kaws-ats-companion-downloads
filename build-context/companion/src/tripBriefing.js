// Jarvis trip briefing: a short spoken summary when a job starts, built only from the Companion's own
// data (job, route plan, real weather if the driver turned it on, followed route, convoy events).
// No AI or internet needed beyond what those features already use. Author: Kaw.
'use strict';
const { plan } = require('./routePlanner');

const mi = n => `${Math.round(n).toLocaleString('en-US')} mile${Math.round(n) === 1 ? '' : 's'}`;
const hm = min => { const m = Math.round(min); const h = Math.floor(m / 60); return h ? `${h} hour${h === 1 ? '' : 's'}${m % 60 >= 10 ? ` ${m % 60} minutes` : ''}` : `${m} minutes`; };

/* input: { state, trips, ownedStates, weather (result of RealWeather.at or null), active (followed route),
   events (upcoming convoy events), driverName } → { text, parts } */
function buildBriefing({ state = {}, trips = [], ownedStates = [], weather = null, active = null, events = [], driverName = 'driver', now = Date.now() } = {}) {
  const j = state.job || {}, nav = state.navigation || {}, t = state.truck || {};
  const parts = [];
  if (!j.active) return { text: "You don't have a job right now. Take one in the game and I'll brief you.", parts: ['no-job'] };
  const cargo = j.cargo || 'your load';
  const weight = Number(j.cargoMassKg) > 0 ? ` (${Math.round(j.cargoMassKg * 2.20462 / 1000)}k pounds)` : '';
  parts.push(`Alright ${driverName}, ${cargo}${weight} from ${j.originCity || 'here'} to ${j.destinationCity || 'the destination'}${j.destinationCompany ? ` for ${j.destinationCompany}` : ''}.`);
  const miles = Number(nav.distanceMiles) > 0 ? nav.distanceMiles : Number(j.plannedDistanceMiles) || 0;
  if (miles) parts.push(`That's about ${mi(miles)}${Number(nav.etaSeconds) > 0 ? `, roughly ${hm(nav.etaSeconds / 60)} of driving` : ''}.`);
  if (Number(nav.deadlineMinutesRemaining) > 0) parts.push(`Delivery is due in ${hm(nav.deadlineMinutesRemaining)}.`);
  // Stops from the planner (uses live fuel and rest timer).
  if (j.originCity && j.destinationCity) {
    try {
      const p = plan([j.originCity, j.destinationCity], { fuelRangeMiles: t.fuelRangeMiles, restDueMinutes: nav.restStopMinutes, ownedStates, trips });
      if (p.ok) {
        const rest = p.stops.filter(s => s.kind === 'rest').length, fuel = p.stops.filter(s => s.kind === 'fuel').length;
        if (rest || fuel) parts.push(`Plan on ${[rest ? `${rest} sleep stop${rest === 1 ? '' : 's'}` : '', fuel ? `${fuel} fuel stop${fuel === 1 ? '' : 's'}` : ''].filter(Boolean).join(' and ')}${p.stops[0] ? `, the first around mile ${p.stops[0].mileFromStart}` : ''}.`);
        else parts.push('No sleep or fuel stops needed on the way, going by your tank and rest timer.');
        if (p.missingStates?.length) parts.push(`Heads up: the route passes ${p.missingStates.join(' and ')}, which you don't own the map for.`);
      }
    } catch {}
  }
  if (Number(nav.restStopMinutes) > 0 && nav.restStopMinutes < 120) parts.push(`You'll need rest in ${hm(nav.restStopMinutes)}, so keep an eye out.`);
  if (weather?.enabled && weather.now) {
    const w = weather.now;
    parts.push(`Real weather where you are: ${w.temperatureF} degrees and ${String(w.short || '').toLowerCase()}.${weather.alerts?.length ? ` There's a ${weather.alerts[0].event} in effect.` : ''}`);
  }
  if (active?.stops?.length) parts.push(`You're following the plan "${active.name}".`);
  const soon = events.filter(e => e.departureTime && Date.parse(e.departureTime) > now && Date.parse(e.departureTime) - now < 24 * 3600000).sort((a, b) => Date.parse(a.departureTime) - Date.parse(b.departureTime))[0];
  if (soon) { const inMin = (Date.parse(soon.departureTime) - now) / 60000; parts.push(`Don't forget the ${soon.name} convoy in ${hm(inMin)}${soon.meetPoint ? `, meeting at ${soon.meetPoint}` : ''}.`); }
  parts.push('Drive safe!');
  return { text: parts.join(' '), parts };
}

module.exports = { buildBriefing };
