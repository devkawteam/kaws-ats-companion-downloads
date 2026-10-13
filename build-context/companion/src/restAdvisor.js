// Rest-stop alarm: before the game's own "rest soon" warning, name a real place ahead where you can
// sleep — the next stop on the plan you follow, or a city ahead of you on the map. Distances use the
// planner's learned factor (game GPS miles per straight-line mile) and the game's own navigation pace
// (GPS miles per game minute), so the estimate is in the units the game shows you. Author: Kaw.
'use strict';
const { greatCircleMiles } = require('./routePlanner');

const fin = v => v !== null && v !== undefined && Number.isFinite(Number(v));
// SCS heading (0 = north, counter-clockwise, 0..1) -> compass bearing in degrees.
const bearingOf = rot => (fin(rot) ? ((1 - Number(rot)) * 360 % 360 + 360) % 360 : null);
function bearingTo(a, b) {
  const r = Math.PI / 180, y = Math.sin((b.lon - a.lon) * r) * Math.cos(b.lat * r);
  const x = Math.cos(a.lat * r) * Math.sin(b.lat * r) - Math.sin(a.lat * r) * Math.cos(b.lat * r) * Math.cos((b.lon - a.lon) * r);
  return (Math.atan2(y, x) / r + 360) % 360;
}
const angleDiff = (a, b) => Math.abs(((a - b + 540) % 360) - 180);

/* input: { state, geo: {lon, lat}, cities: [{name, lon, lat, state}], plan: cleaned shared/active route,
   factor (planner), leadMinutes: how far ahead of the game's own rest warning to speak (default 30),
   warnMinutes: the alerts fatigue threshold } */
function advise({ state, geo, cities = [], plan = null, factor = 1.25, warnMinutes = 60, leadMinutes = 30 } = {}) {
  const rest = Number(state?.navigation?.restStopMinutes);
  if (!state?.connected || !fin(rest) || rest <= 0 || !geo) return { active: false };
  const window = warnMinutes + leadMinutes;
  if (rest > window) return { active: false, restMinutes: Math.round(rest) };
  // Pace: GPS miles per game minute from the active job's route, else a 55 mph assumption.
  const nav = state.navigation || {};
  const pace = fin(nav.distanceMiles) && fin(nav.etaSeconds) && nav.etaSeconds > 60 && nav.distanceMiles > 1 ? nav.distanceMiles / (nav.etaSeconds / 60) : 55 / 60;
  const heading = bearingOf(state.positioning?.rotationX);
  const ahead = c => heading === null || angleDiff(bearingTo(geo, c), heading) <= 70;
  const candidates = [];
  for (const s of plan?.stops || []) candidates.push({ ...s, fromPlan: true });
  for (const c of cities) candidates.push({ name: c.name, lat: c.lat, lon: c.lon, stateCode: c.state || null, fromPlan: false });
  const scored = candidates.filter(c => fin(c.lat) && fin(c.lon)).map(c => {
    const miles = greatCircleMiles(geo, c) * factor;
    return { ...c, miles: Math.round(miles), minutes: Math.round(miles / pace) };
  }).filter(c => c.miles >= 3 && c.miles <= 400 && ahead(c));
  // Best: the furthest place you can still reach with 10 min to spare; plan stops win ties.
  const reachable = scored.filter(c => c.minutes <= rest - 10).sort((a, b) => (b.fromPlan - a.fromPlan) || (b.miles - a.miles));
  const pick = reachable[0] || scored.sort((a, b) => a.miles - b.miles)[0] || null;
  if (!pick) return { active: true, restMinutes: Math.round(rest), stop: null };
  const late = pick.minutes > rest;
  return {
    active: true, restMinutes: Math.round(rest), stop: { name: pick.name, stateCode: pick.stateCode, miles: pick.miles, minutes: pick.minutes, fromPlan: pick.fromPlan },
    alert: {
      id: 'rest-plan', severity: late || rest <= 20 ? 'critical' : 'warn',
      title: late ? 'Rest needed before the next town' : `Plan your rest: ${pick.name}`,
      detail: late ? `You need rest in ${Math.round(rest)} min; ${pick.name} is about ${pick.miles} mi away (${pick.minutes} min). Look for a rest area or truck stop sooner.`
        : `${pick.name}${pick.stateCode ? `, ${pick.stateCode}` : ''} is about ${pick.miles} mi ahead (${pick.minutes} min). Rest needed in ${Math.round(rest)} min.`
    }
  };
}

module.exports = { advise, bearingOf, bearingTo, angleDiff };
