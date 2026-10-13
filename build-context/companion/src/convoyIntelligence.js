const { STATE_TO_DLC, BASE_STATES } = require('./localScanner');

const GRAPH = {
  'California':['Nevada','Arizona','Oregon'],
  'Nevada':['California','Arizona','Oregon','Idaho','Utah'],
  'Arizona':['California','Nevada','Utah','New Mexico'],
  'New Mexico':['Arizona','Colorado','Oklahoma','Texas'],
  'Oregon':['California','Nevada','Washington','Idaho'],
  'Washington':['Oregon','Idaho'],
  'Utah':['Nevada','Arizona','Idaho','Wyoming','Colorado'],
  'Idaho':['Nevada','Oregon','Washington','Utah','Wyoming','Montana'],
  'Colorado':['Utah','Wyoming','Nebraska','Kansas','Oklahoma','New Mexico'],
  'Wyoming':['Idaho','Utah','Colorado','Nebraska','South Dakota','Montana'],
  'Montana':['Idaho','Wyoming','South Dakota'],
  'Texas':['New Mexico','Oklahoma','Arkansas','Louisiana'],
  'Oklahoma':['Texas','New Mexico','Colorado','Kansas','Arkansas','Missouri'],
  'Kansas':['Colorado','Nebraska','Missouri','Oklahoma'],
  'Nebraska':['Colorado','Wyoming','South Dakota','Iowa','Missouri','Kansas'],
  'Arkansas':['Texas','Oklahoma','Missouri','Tennessee','Mississippi','Louisiana'],
  'Missouri':['Iowa','Illinois','Kentucky','Tennessee','Arkansas','Oklahoma','Kansas','Nebraska'],
  'Iowa':['Nebraska','South Dakota','Minnesota','Wisconsin','Illinois','Missouri'],
  'Louisiana':['Texas','Arkansas','Mississippi'],
  'Illinois':['Iowa','Missouri','Kentucky','Indiana','Wisconsin']
};

const RELEASED = new Set([
  'California','Nevada','Arizona','New Mexico','Oregon','Washington','Utah','Idaho',
  'Colorado','Wyoming','Montana','Texas','Oklahoma','Kansas','Nebraska','Arkansas',
  'Missouri','Iowa','Louisiana','Illinois'
]);

function bfs(start, end, allowed = RELEASED) {
  if (start === end) return [start];
  if (!GRAPH[start] || !GRAPH[end]) return null;
  const q = [[start]];
  const seen = new Set([start]);
  while (q.length) {
    const path = q.shift();
    const node = path[path.length-1];
    for (const next of GRAPH[node] || []) {
      if (!allowed.has(next) || seen.has(next)) continue;
      const p = [...path,next];
      if (next === end) return p;
      seen.add(next); q.push(p);
    }
  }
  return null;
}

function requiredDlcForStates(states) {
  return states
    .filter(s=>!BASE_STATES.includes(s))
    .map(s=>({ state:s, token:STATE_TO_DLC[s] || null }))
    .filter(x=>x.token);
}

function commonMapStates(roster) {
  const online = roster.filter(r=>r.online);
  if (!online.length) return [];
  const lists = online.map(r=>new Set(r.capabilities?.mapStates || []));
  return [...lists[0]].filter(state=>lists.every(set=>set.has(state))).sort();
}

function evaluateRoute(origin, destination, roster) {
  const path = bfs(origin,destination);
  if (!path) return { origin,destination,path:null,requiredDlc:[],compatible:false,drivers:[],reason:'No released-state compatibility path in planner graph.' };

  const requiredDlc = requiredDlcForStates(path);
  const drivers = roster.filter(r=>r.online).map(r=>{
    const owned = new Set(r.capabilities?.mapDlcTokens || []);
    const missing = requiredDlc.filter(x=>!owned.has(x.token));
    return {
      id:r.id, driverName:r.driverName, isLocal:r.isLocal,
      compatible:missing.length===0,
      missing
    };
  });

  return {
    origin,destination,path,requiredDlc,
    compatible:drivers.every(d=>d.compatible),
    compatibleDrivers:drivers.filter(d=>d.compatible).length,
    totalDrivers:drivers.length,
    drivers
  };
}

function readiness(roster, localScan) {
  const online = roster.filter(r=>r.online);
  const localCaps = localScan?.capabilities || {};
  const commonStates = commonMapStates(roster);
  const versions = [...new Set(online.map(r=>r.capabilities?.gameVersion).filter(Boolean))];
  const gameVersionMatch = versions.length <= 1;

  return {
    generatedAt:new Date().toISOString(),
    onlineDrivers:online.length,
    allKnownDrivers:roster.length,
    commonMapStates:commonStates,
    commonMapDlcTokens:Object.entries(STATE_TO_DLC).filter(([state])=>commonStates.includes(state)).map(([,token])=>token),
    gameVersions:versions,
    gameVersionMatch,
    localInstalledDlcCount:localCaps.dlcTokens?.length || 0,
    localMapDlcCount:localCaps.mapDlcTokens?.length || 0,
    localMods:localCaps.localModNames?.length || 0,
    localWorkshopMods:localCaps.workshopIds?.length || 0,
    localActiveRefs:localCaps.activeModRefs?.length || 0
  };
}

function classifyLoadKg(kg) {
  kg = Number(kg)||0;
  if (kg <= 0) return 'UNKNOWN';
  if (kg < 18000) return 'LIGHT';
  if (kg < 30000) return 'STANDARD';
  if (kg < 45000) return 'HEAVY';
  return 'EXTREME';
}

function truckLoadAdvice(truck, job, profile = {}) {
  const kg = Number(job?.cargoMassKg)||0;
  const hp = Number(profile.horsepower)||500;
  const drivenAxles = Number(profile.drivenAxles)||2;
  const trans = String(profile.transmission || '18');
  const category = classifyLoadKg(kg);

  let score = 100;
  const notes = [];

  if (category === 'STANDARD' && hp < 400) { score -= 20; notes.push('Low horsepower for a standard gross cargo load.'); }
  if (category === 'HEAVY') {
    if (hp < 500) { score -= 30; notes.push('500+ HP is preferred for heavy loads.'); }
    if (drivenAxles < 2) { score -= 25; notes.push('A 6x4 or stronger driven-axle setup is preferred.'); }
    if (!['13','18'].includes(trans)) { score -= 10; notes.push('13/18-speed gearing gives better control on heavy loads.'); }
  }
  if (category === 'EXTREME') {
    if (hp < 600) { score -= 35; notes.push('600+ HP is preferred for extreme/heavy-haul loads.'); }
    if (drivenAxles < 2) { score -= 30; notes.push('Multiple driven axles are strongly recommended.'); }
    if (trans !== '18') { score -= 15; notes.push('18-speed gearing is preferred for extreme loads.'); }
  }
  if (kg > 0 && category === 'LIGHT' && hp > 650) notes.push('Truck is more than capable; this load should be easy on power demand.');
  if (!kg) notes.push('No active cargo mass is available, so load suitability cannot be calculated yet.');

  score = Math.max(0,Math.min(100,score));
  const rating = score >= 90 ? 'EXCELLENT' : score >= 75 ? 'GOOD' : score >= 55 ? 'MARGINAL' : 'NOT RECOMMENDED';

  return {
    truck:[truck?.make,truck?.model].filter(Boolean).join(' ') || 'Unknown truck',
    cargo:job?.cargo || null,
    cargoMassKg:kg,
    loadClass:category,
    profile:{ horsepower:hp, drivenAxles, transmission:trans },
    score,rating,notes,
    disclaimer:'Advisory only. ATS/modded truck physics, chassis, engine, transmission, trailer and route grade can change actual performance.'
  };
}

module.exports={ GRAPH, RELEASED, evaluateRoute, readiness, commonMapStates, truckLoadAdvice };
