// Convoy Hub: one answer to "who is on, where are they, who has what DLC, where can we all go,
// and what mods do I need (and where do I get them)?" — built from the live convoy roster.

const { MAP_DLC, BASE_STATES } = require('./localScanner');

const STATE_CODES = {
  California: 'CA', Nevada: 'NV', Arizona: 'AZ', 'New Mexico': 'NM', Oregon: 'OR', Washington: 'WA', Utah: 'UT', Idaho: 'ID',
  Colorado: 'CO', Wyoming: 'WY', Montana: 'MT', Texas: 'TX', Oklahoma: 'OK', Kansas: 'KS', Nebraska: 'NE', Arkansas: 'AR',
  Missouri: 'MO', Iowa: 'IA', Louisiana: 'LA', Illinois: 'IL'
};
const ALL_STATES = [...BASE_STATES, ...Object.values(MAP_DLC)];
const safeUrl = v => (/^https:\/\/[^\s"'<>]+$/i.test(String(v || '')) ? String(v) : null);

function workshopLinks(id) {
  const clean = String(id || '').replace(/\D/g, '');
  return clean ? { web: `https://steamcommunity.com/sharedfiles/filedetails/?id=${clean}`, steam: `steam://url/CommunityFilePage/${clean}` } : null;
}

function dlcStoreLink(state) {
  return `https://store.steampowered.com/search/?term=${encodeURIComponent(`American Truck Simulator ${state}`)}&category1=21`;
}

function buildHub({ roster = [], localScan = {}, preflight, calibration, relay, workshop = {}, prices = {} }) {
  const online = roster.filter(r => r.online);

  // Who is on + where.
  const drivers = roster.map(r => {
    const caps = r.isLocal ? localScan.capabilities : r.capabilities;
    const where = calibration.locate(r.positioning) || r.location || null;
    return {
      id: r.id,
      driverName: r.driverName,
      isLocal: Boolean(r.isLocal),
      online: Boolean(r.online),
      ageSeconds: r.ageSeconds ?? 0,
      companionVersion: r.companionVersion || (r.isLocal ? 'local' : null),
      truck: [r.truck?.make, r.truck?.model].filter(Boolean).join(' ') || null,
      speedMph: r.truck?.speedMph ?? null,
      job: r.job?.active ? { cargo: r.job.cargo, from: r.job.originCity, to: r.job.destinationCity, remainingMiles: r.navigation?.distanceMiles ?? null } : null,
      location: where ? { lon: where.lon, lat: where.lat, near: where.near, nearState: where.nearState || null, state: where.state, stateCode: where.stateCode, accuracyMiles: where.accuracyMiles ?? null } : null,
      sharesMods: Boolean(caps),
      mapStates: caps?.mapStates || null,
      gameVersion: caps?.gameVersion || null
    };
  });

  // Who has what DLC, and where can the whole (online) convoy go.
  const known = drivers.filter(d => d.online && d.mapStates);
  const coverage = ALL_STATES.map(state => {
    const have = known.filter(d => d.mapStates.includes(state)).map(d => d.driverName);
    const missing = known.filter(d => !d.mapStates.includes(state)).map(d => d.driverName);
    return {
      state, code: STATE_CODES[state], base: BASE_STATES.includes(state),
      dlcToken: Object.entries(MAP_DLC).find(([, s]) => s === state)?.[0] || null,
      have, missing,
      everyone: known.length > 0 && missing.length === 0,
      storeUrl: BASE_STATES.includes(state) ? null : dlcStoreLink(state)
    };
  });
  const everyone = coverage.filter(c => c.everyone).map(c => c.state);
  const unknownDrivers = drivers.filter(d => d.online && !d.mapStates).map(d => d.driverName);
  const versions = [...new Set(known.map(d => d.gameVersion).filter(Boolean))];

  // Suggested convoy regions: states everyone owns, grouped into connected areas.
  const { GRAPH } = require('./convoyIntelligence');
  const everyoneSet = new Set(everyone);
  const regions = [];
  const seen = new Set();
  for (const s of everyone) {
    if (seen.has(s)) continue;
    const group = [];
    const stack = [s];
    seen.add(s);
    while (stack.length) {
      const cur = stack.pop();
      group.push(cur);
      for (const n of GRAPH[cur] || []) if (everyoneSet.has(n) && !seen.has(n)) { seen.add(n); stack.push(n); }
    }
    regions.push(group.sort());
  }
  regions.sort((a, b) => b.length - a.length);

  // Mods: every convoy manifest shared by a driver (plus our own), and what *I* am missing from each.
  const myCaps = localScan.capabilities || {};
  const manifests = [];
  const localActive = preflight.getActive();
  if (localActive) manifests.push({ from: 'You', isLocal: true, manifest: localActive });
  for (const r of roster) {
    if (r.isLocal || !r.online || !r.convoyManifest?.id) continue;
    if (manifests.some(m => m.manifest.id === r.convoyManifest.id)) continue;
    manifests.push({ from: r.driverName, isLocal: false, manifest: r.convoyManifest });
  }
  const modPacks = manifests.map(({ from, isLocal, manifest }) => {
    const check = preflight.compareCapabilities(myCaps, manifest);
    const missingIds = new Set((check.missingMods || []).map(m => m.id));
    return {
      from, isLocal,
      id: manifest.id, name: manifest.name, notes: manifest.notes || '', gameVersion: manifest.gameVersion || '',
      status: check.status, score: check.score,
      requiredDlc: (manifest.requiredDlcTokens || []).map(token => ({ token, state: MAP_DLC[token] || null, missing: (check.missingDlc || []).includes(token), storeUrl: MAP_DLC[token] ? dlcStoreLink(MAP_DLC[token]) : `https://store.steampowered.com/search/?term=${encodeURIComponent('American Truck Simulator ' + token.replace(/^dlc_/, '').replace(/_/g, ' '))}&category1=21` })),
      mods: (manifest.mods || []).map(m => {
        const w = workshop[String(m.workshopId || '').replace(/\D/g, '')] || null;
        const steam = w && !w.missing ? { title: w.title, sizeBytes: w.sizeBytes, updatedAt: w.updatedAt, previewUrl: w.previewUrl, subscriptions: w.subscriptions, isAts: w.isAts } : null;
        return {
          order: m.order, name: m.name || steam?.title || (m.workshopId ? `Workshop item ${m.workshopId}` : 'Mod'), workshopId: m.workshopId || null,
          version: m.version || '', required: m.required !== false, notes: m.notes || '',
          missing: missingIds.has(m.id), links: workshopLinks(m.workshopId), downloadUrl: safeUrl(m.url),
          steam,
          removedFromWorkshop: Boolean(w?.missing),
          notForAts: steam?.isAts === false,
          // The mod changed on Steam after the host saved the pack: versions may no longer match.
          updatedSincePack: Boolean(steam?.updatedAt && m.workshopUpdatedAt && Date.parse(steam.updatedAt) > Date.parse(m.workshopUpdatedAt))
        };
      }),
      orderIssues: check.orderIssues || []
    };
  });

  // DLC helper: what each driver could buy, ranked by how many states it opens up for the whole convoy.
  const shopping = known.map(d => {
    const items = coverage.filter(c => !c.base && c.missing.includes(d.driverName)).map(c => {
      const onlyMissing = c.missing.length === 1;
      // Would buying this connect to the convoy's shared area (a neighbour everyone already owns)?
      const connects = (GRAPH[c.state] || []).some(n => everyoneSet.has(n));
      const price = d.isLocal ? prices[c.state] || null : null;
      return { state: c.state, dlcToken: c.dlcToken, storeUrl: price?.url || c.storeUrl, price, unlocksForEveryone: onlyMissing, connectsToConvoyArea: connects, othersMissing: c.missing.filter(n => n !== d.driverName) };
    }).sort((a, b) => (b.unlocksForEveryone - a.unlocksForEveryone) || (b.connectsToConvoyArea - a.connectsToConvoyArea) || ((b.price?.discountPercent || 0) - (a.price?.discountPercent || 0)));
    return { driverName: d.driverName, isLocal: d.isLocal, items };
  }).filter(x => x.items.length);

  return {
    generatedAt: new Date().toISOString(),
    shopping,
    online: online.length,
    total: roster.length,
    drivers,
    map: calibration.status(),
    dlc: { coverage, everyone, regions, unknownDrivers, gameVersions: versions, gameVersionMatch: versions.length <= 1, knownDrivers: known.length },
    modPacks,
    relay
  };
}

module.exports = { buildHub, workshopLinks, dlcStoreLink, STATE_CODES };
