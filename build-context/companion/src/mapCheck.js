// Map pack check: which ATS states you own, and which ones your saved plans, shared convoy routes,
// convoy events, current job and convoy friends need. Owned states come from the DLC files in your
// game folder (localScanner). Author: Kaw.
'use strict';
const { MAP_DLC, BASE_STATES } = require('./localScanner');
const { findCity, stateAt } = require('./mapCalibration');

const ALL_STATES = [...BASE_STATES, ...Object.values(MAP_DLC)];
const DLC_OF = Object.fromEntries(Object.entries(MAP_DLC).map(([token, state]) => [state, token]));

function cityState(name, hint) {
  const c = findCity(name, hint);
  if (!c) return null;
  return stateAt(c.lon, c.lat)?.name || null;
}

/* input: { ownedStates, scanned (bool: game folder found), plans: [{name, states}], shared: [{from, route}],
   events: [{name, meetPoint, destination}], job: {originCity, destinationCity}, roster } */
function mapCheck({ ownedStates = [], scanned = true, plans = [], shared = [], events = [], job = null, roster = [] } = {}) {
  const owned = new Set(ownedStates);
  const states = ALL_STATES.map(s => ({ state: s, base: BASE_STATES.includes(s), dlc: DLC_OF[s] || null, owned: BASE_STATES.includes(s) || owned.has(s) }));
  const needs = [];
  const add = (source, label, list) => {
    const uniq = [...new Set(list.filter(Boolean))].filter(s => ALL_STATES.includes(s));
    if (uniq.length) needs.push({ source, label, states: uniq, missing: scanned ? uniq.filter(s => !BASE_STATES.includes(s) && !owned.has(s)) : [] });
  };
  if (job?.originCity || job?.destinationCity) add('job', `Current job: ${job.originCity || '?'} → ${job.destinationCity || '?'}`, [cityState(job.originCity), cityState(job.destinationCity)]);
  for (const p of plans) add('plan', `Saved plan: ${p.name}`, p.states || []);
  for (const s of shared) add('shared', `${s.from}'s shared route: ${s.route.name}`, s.route.stops.map(x => stateAt(x.lon, x.lat)?.name));
  for (const e of events) add('event', `Convoy event: ${e.name}`, [cityState(e.meetPoint), cityState(e.destination)]);
  const friends = roster.filter(r => !r.isLocal && r.online && r.location?.state);
  if (friends.length) add('convoy', `Friends driving now (${friends.map(r => r.driverName).slice(0, 4).join(', ')}${friends.length > 4 ? '…' : ''})`, friends.map(r => r.location.state));
  const missingAll = [...new Set(needs.flatMap(n => n.missing))];
  return { scanned, ownedCount: states.filter(s => s.owned).length, total: states.length, states, needs, missingAll };
}

module.exports = { mapCheck, ALL_STATES };
