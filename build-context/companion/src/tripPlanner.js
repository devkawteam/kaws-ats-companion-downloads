// Fuel & rest planner: can I make the destination before I need sleep or fuel, and will I be on time?
// ATS route ETA, rest timer and deadline are all in game minutes, so they compare directly.

const fin = v => v !== null && v !== undefined && Number.isFinite(Number(v));
const fmt = min => { const m = Math.max(0, Math.round(min)); const h = Math.floor(m / 60); return h ? `${h}h ${String(m % 60).padStart(2, '0')}m` : `${m}m`; };
const mi = v => `${Math.max(0, Math.round(v))} mi`;

function plan(state) {
  const nav = state.navigation || {}, t = state.truck || {}, job = state.job || {};
  const dist = Number(nav.distanceMiles), etaMin = fin(nav.etaSeconds) ? Number(nav.etaSeconds) / 60 : null;
  const rest = fin(nav.restStopMinutes) && Number(nav.restStopMinutes) > 0 ? Number(nav.restStopMinutes) : null;
  const range = fin(t.fuelRangeMiles) ? Number(t.fuelRangeMiles) : null;
  const deadline = fin(nav.deadlineMinutesRemaining) && Math.abs(nav.deadlineMinutesRemaining) < 5e6 ? Number(nav.deadlineMinutesRemaining) : null;
  const onRoute = job.active && fin(dist) && dist > 0.5 && etaMin;
  const out = { active: Boolean(onRoute), items: [], summary: null };
  if (!onRoute) { out.summary = job.active ? 'Set a route in the GPS to plan fuel and rest.' : 'No active job.'; return out; }

  // Rest
  let restMiles = null;
  if (rest !== null) {
    if (rest >= etaMin) out.items.push({ key: 'rest', ok: true, title: 'Rest', text: `You can make it before sleep (${fmt(rest - etaMin)} to spare).` });
    else {
      restMiles = dist * (rest / etaMin);
      out.items.push({ key: 'rest', ok: false, title: 'Rest', text: `You need to sleep before arriving — in ${fmt(rest)}, about ${mi(restMiles)} from here.`, miles: Math.round(restMiles) });
    }
  }

  // Fuel (keep a 30 mi reserve)
  let fuelMiles = null;
  if (range !== null) {
    if (range - 30 >= dist) out.items.push({ key: 'fuel', ok: true, title: 'Fuel', text: `Enough fuel to the destination (${mi(range - dist)} spare).` });
    else {
      fuelMiles = Math.max(0, range - 30);
      out.items.push({ key: 'fuel', ok: false, title: 'Fuel', text: `Refuel within ${mi(fuelMiles)} (range ${mi(range)}, ${mi(dist)} to go).`, miles: Math.round(fuelMiles) });
    }
  }

  // Deadline (only when a rest is needed does it add sleep time: ~9 h game time incl. the stop)
  if (deadline !== null) {
    const extra = restMiles !== null ? 540 : 0;
    const slack = deadline - etaMin - extra;
    out.items.push({ key: 'deadline', ok: slack >= 0, title: 'Deadline', text: slack >= 0 ? `On time with ${fmt(slack)} to spare${extra ? ' (including sleep)' : ''}.` : `Running ${fmt(-slack)} late${extra ? ' once you sleep' : ''} — cut stops short or pick up the pace.` });
  }

  // Combined stop
  if (restMiles !== null && fuelMiles !== null) {
    const at = Math.min(restMiles, fuelMiles);
    out.items.push({ key: 'combo', ok: null, title: 'Tip', text: `Combine fuel and sleep at one truck stop in about ${mi(at)}.` });
  }
  const problems = out.items.filter(i => i.ok === false);
  out.summary = problems.length ? problems.map(p => p.text).join(' ') : 'All good: fuel, rest and deadline are covered for this run.';
  return out;
}

module.exports = { plan };
