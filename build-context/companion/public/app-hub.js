/* KAW'S ATS Companion v1.6 — Convoy Hub, CB radio status, layout customizer and multi-screen launcher.
   Registers with app-v16.js through window.KAW16. */
(() => {
  'use strict';
  const K = window.KAW16;
  if (!K) return;
  const { q, qa, esc, fin, f1, ago, api, guard, notify, go } = K;

  // ---------- geography (shared Natural Earth file) ----------
  let geo = null;
  const geoReady = fetch('/natural-earth-na.json').then(r => r.json()).then(j => { geo = j; }).catch(() => {});
  const BOUNDS = { minLon: -125.5, maxLon: -86.5, minLat: 25.2, maxLat: 49.6 };
  const W = 1000, H = 640;
  const project = (lon, lat) => {
    const midLat = (BOUNDS.minLat + BOUNDS.maxLat) / 2 * Math.PI / 180;
    const sx = W / ((BOUNDS.maxLon - BOUNDS.minLon) * Math.cos(midLat));
    const sy = H / (BOUNDS.maxLat - BOUNDS.minLat);
    const s = Math.min(sx, sy);
    const ox = (W - (BOUNDS.maxLon - BOUNDS.minLon) * Math.cos(midLat) * s) / 2;
    return [ox + (lon - BOUNDS.minLon) * Math.cos(midLat) * s, (BOUNDS.maxLat - lat) * s];
  };
  let statePaths = null;
  function buildStatePaths() {
    if (statePaths || !geo) return statePaths;
    statePaths = (geo.regions || []).filter(r => r.country === 'USA' && r.code !== 'AK' && r.code !== 'HI').map(r => {
      const d = (r.parts || []).map(ring => ring.map(([lon, lat], i) => { const [x, y] = project(lon, lat); return `${i ? 'L' : 'M'}${x.toFixed(1)},${y.toFixed(1)}`; }).join('') + 'Z').join('');
      // Label position: centroid of the largest ring's bounding box.
      const big = (r.parts || []).reduce((a, b) => (b.length > a.length ? b : a), []);
      const lons = big.map(p => p[0]), lats = big.map(p => p[1]);
      const [lx, ly] = project((Math.min(...lons) + Math.max(...lons)) / 2, (Math.min(...lats) + Math.max(...lats)) / 2);
      return { code: r.code, name: r.name, d, lx, ly };
    });
    return statePaths;
  }

  K.map = { project, buildStatePaths, geoReady, W, H, geoRegions: () => geo?.regions || [] };

  // ---------- page ----------
  const HTML = `
    <div class="hub-top v16-row" style="justify-content:space-between;margin-bottom:12px">
      <div class="v16-row"><span id="hubRelay"></span><span class="muted" id="hubCounts" style="font-size:13px"></span></div>
      <div class="v16-row">
        <label class="v16-toggle" style="gap:8px;padding:0"><span style="font-size:13px">Share my DLC &amp; mods</span><input type="checkbox" id="hubShareMods"></label>
        <label class="v16-toggle" style="gap:8px;padding:0"><span style="font-size:13px">Share my mod pack</span><input type="checkbox" id="hubShareManifest"></label>
        <button class="cmd small" id="hubFull" type="button" title="Open the convoy map on another screen">⧉ Map on 2nd screen</button>
      </div>
    </div>
    <div class="v16-grid hub-grid">
      <div class="panel hub-map-panel"><div class="panel-head"><div class="panel-title">Who's on &amp; where</div><div class="muted" id="hubMapNote" style="font-size:12px"></div></div>
        <div class="hub-map-wrap"><svg id="hubMap" viewBox="0 0 ${W} ${H}" role="img" aria-label="Convoy map"></svg>
          <div class="hub-legend"><span><i style="background:var(--green)"></i>Everyone can drive</span><span><i style="background:var(--yellow)"></i>Some drivers</span><span><i style="background:color-mix(in srgb,var(--red) 60%,var(--panel2))"></i>Nobody yet</span><span><i style="background:var(--panel2)"></i>Not in ATS</span></div></div>
      </div>
      <div class="v16-stack"><div class="panel"><div class="panel-head"><div class="panel-title">Drivers</div><div class="muted" id="hubDriverNote" style="font-size:12px"></div></div><div id="hubDrivers" class="v16-list"></div></div>
        <div class="panel"><div class="panel-head"><div class="panel-title">Convoy leader &amp; gaps</div><div class="muted" id="hubGapNote" style="font-size:12px"></div></div><div class="v16-body v16-stack"><div class="v16-row"><select id="hubLeader" class="v16-input" style="flex:1"></select></div><div id="hubGaps" class="v16-note"></div></div></div></div>
    </div>
    <div class="v16-grid v16-2" style="margin-top:12px">
      <div class="panel"><div class="panel-head"><div class="panel-title">Where can we go?</div><div id="hubGoNote" class="muted" style="font-size:12px"></div></div><div class="v16-body v16-stack" id="hubGo"></div></div>
      <div class="panel"><div class="panel-head"><div class="panel-title">Who has what DLC</div><div class="muted" style="font-size:12px">Map expansions</div></div><div class="table-wrap" style="max-height:430px"><table class="table dlc-matrix" id="hubMatrix"></table></div></div>
    </div>
    <div class="panel" style="margin-top:12px"><div class="panel-head"><div class="panel-title">What mods do I need?</div><div class="v16-row"><span class="muted" style="font-size:12px">Convoy mod packs shared by drivers</span><button class="cmd small" type="button" id="hubMakePack">Create a mod pack</button></div></div><div id="hubPacks"></div></div>`;

  let lastHub = null;
  let lastTrails = [];

  // Gap keeper: choose the convoy leader and see everyone's distance.
  function renderGap(h, g) {
    const sel = q('#hubLeader');
    if (!sel || !g) return;
    const online = (h.drivers || []).filter(d => d.online);
    if (document.activeElement !== sel) {
      sel.innerHTML = `<option value="">${g.leader && g.source !== 'chosen' ? `Automatic (${esc(g.leader.driverName)}, ${esc(g.source)})` : 'No leader (gap alerts off)'}</option>` + online.map(d => `<option value="${esc(d.driverName)}" ${g.manualLeader === d.driverName ? 'selected' : ''}>${esc(d.driverName)}${d.isLocal ? ' (you)' : ''} leads</option>`).join('');
    }
    q('#hubGapNote').textContent = g.leader ? `Warn beyond ${g.gapWarnMiles} mi` : '';
    q('#hubGaps').innerHTML = !g.leader ? 'Pick a leader, or start a convoy event — its host leads automatically.' : g.gaps.length ? g.gaps.map(x => `<div class="v16-row" style="justify-content:space-between"><span>${esc(x.driverName)}</span><b class="${x.miles > g.gapWarnMiles ? 'bad' : 'good'}">${x.miles.toFixed(1)} mi</b></div>`).join('') : 'Waiting for positions…';
  }
  let sharing = null;

  const relayPill = r => {
    if (!r || !r.configured) return '<span class="v16-pill muted" title="Set remote.endpoint in config.json to join a convoy relay">Relay not set up</span>';
    const map = { online: ['good', 'Relay online'], suspended: ['bad', 'Relay suspended'], 'sleeping-or-down': ['warn', 'Relay down'], unreachable: ['bad', 'Relay unreachable'], 'sign-in-page': ['bad', 'Relay address needs sign-in'], error: ['bad', 'Relay error'], checking: ['muted', 'Checking relay…'] };
    if (r.up && r.pushState === 'rejected') return `<span class="v16-pill bad" title="${esc(r.pushDetail || '')}">Not in the convoy — relay refused this Companion</span>`;
    if (r.up && r.pushState === 'off') return `<span class="v16-pill warn" title="${esc(r.pushDetail || '')}">Convoy sharing is off</span>`;
    if (r.usingBackup && r.up) return `<span class="v16-pill warn" title="Main relay: ${esc(r.primary?.status || 'down')} · using ${esc(r.origin)}">Backup relay</span>`;
    const [cls, label] = map[r.status] || ['muted', r.status];
    return `<span class="v16-pill ${cls}" title="${esc(r.detail || r.origin || '')}">${label}</span>${r.enabled ? '' : ' <span class="v16-pill muted" title="remote.enabled is false in config.json">Not connected</span>'}`;
  };

  function renderMap(h) {
    K.tileMap?.hub?.(h, lastTrails); // real tile map (app-map.js), when the driver picked one
    const svg = q('#hubMap');
    const paths = buildStatePaths();
    if (!svg || !paths) return;
    const cov = Object.fromEntries((h.dlc.coverage || []).map(c => [c.code, c]));
    const fillFor = code => {
      const c = cov[code];
      if (!c) return 'var(--panel2)';
      if (!h.dlc.knownDrivers) return 'color-mix(in srgb,var(--blue) 18%,var(--panel2))';
      if (c.everyone) return 'color-mix(in srgb,var(--green) 55%,var(--panel2))';
      if (c.have.length) return 'color-mix(in srgb,var(--yellow) 45%,var(--panel2))';
      return 'color-mix(in srgb,var(--red) 35%,var(--panel2))';
    };
    const states = paths.map(p => `<path d="${p.d}" fill="${fillFor(p.code)}" class="hub-state${cov[p.code] ? ' ats' : ''}"><title>${esc(p.name)}${cov[p.code] ? ` — ${cov[p.code].everyone ? 'everyone can drive' : cov[p.code].have.length ? `${cov[p.code].have.length} of ${h.dlc.knownDrivers} drivers` : 'nobody owns it yet'}` : ' — not in ATS yet'}</title></path>`).join('');
    const labels = paths.filter(p => cov[p.code]).map(p => `<text x="${p.lx.toFixed(0)}" y="${p.ly.toFixed(0)}" class="hub-state-label">${p.code}</text>`).join('');
    const dots = (h.drivers || []).filter(d => d.location && d.online).map(d => {
      const [x, y] = project(d.location.lon, d.location.lat);
      return `<g class="hub-dot ${d.isLocal ? 'me' : ''}" transform="translate(${x.toFixed(1)},${y.toFixed(1)})"><circle r="${d.isLocal ? 9 : 7}"></circle><circle r="${d.isLocal ? 16 : 13}" class="halo"></circle><text y="-16" text-anchor="middle">${esc(d.driverName)}</text><title>${esc(d.driverName)} — near ${esc(d.location.near || '?')}${d.location.nearState ? ', ' + esc(d.location.nearState) : ''}</title></g>`;
    }).join('');
    const trails = (lastTrails || []).map(t => `<polyline class="hub-trail ${t.isLocal ? 'me' : ''}" points="${t.points.map(([lon, lat]) => project(lon, lat).map(v => v.toFixed(1)).join(',')).join(' ')}"><title>${esc(t.driverName)} — last 45 min</title></polyline>`).join('');
    svg.innerHTML = `<g>${states}</g><g>${labels}</g><g>${trails}</g><g>${dots}</g>`;
    const m = h.map || {};
    q('#hubMapNote').textContent = m.exact ? `Live positions · exact ATS coordinates` : m.ready ? `Live positions · ±${m.errorMiles ?? '?'} mi · ${m.cities} cities learned` : `Map calibrating: deliver to ${m.needed} more cit${m.needed === 1 ? 'y' : 'ies'} to see live positions`;
  }

  function renderDrivers(h) {
    const list = h.drivers || [];
    q('#hubCounts').textContent = `${h.online} online · ${h.total} in convoy`;
    q('#hubDriverNote').textContent = list.some(d => d.online && !d.sharesMods) ? 'Some drivers are not sharing DLC' : '';
    q('#hubDrivers').innerHTML = list.map(d => {
      const where = d.location ? `Near ${esc(d.location.near || '?')}${d.location.nearState ? ', ' + esc(d.location.nearState) : ''}${d.location.state ? ` <span class="muted">· in ${esc(d.location.state)}</span>` : ''}` : d.job ? `On a job ${esc(d.job.from || '?')} → ${esc(d.job.to || '?')}` : 'Location unknown';
      const initials = String(d.driverName || '?').split(/\s+/).map(w => w[0]).join('').slice(0, 2).toUpperCase();
      return `<div class="v16-item ${d.online ? '' : 'hub-off'}"><div class="avatar">${esc(initials)}<i class="${d.online ? 'on' : ''}"></i></div><div class="grow"><div class="t">${esc(d.driverName)}${d.isLocal ? ' <span class="muted">(you)</span>' : ''}</div><div class="d">📍 ${where}</div><div class="d">${d.job ? `🚚 ${esc(d.job.cargo || 'Cargo')} · ${fin(d.job.remainingMiles) ? f1(d.job.remainingMiles) + ' mi left' : ''}` : 'No active job'}${fin(d.speedMph) && d.online ? ` · ${Math.round(d.speedMph)} mph` : ''}</div></div><div style="text-align:right">${d.online ? '<span class="v16-pill good">Online</span>' : `<span class="v16-pill muted">${ago(new Date(Date.now() - (d.ageSeconds || 0) * 1000).toISOString())}</span>`}<div class="muted" style="font-size:11px;margin-top:4px">${esc(d.gameVersion || '')}</div></div></div>`;
    }).join('') || '<div class="v16-empty">No drivers yet.</div>';
  }

  function renderGo(h) {
    const dlc = h.dlc || {};
    if (!dlc.knownDrivers) {
      q('#hubGo').innerHTML = '<div class="v16-empty"><b>Waiting for drivers</b>When convoy members share their DLC, this shows exactly where everyone can drive together.</div>';
      q('#hubGoNote').textContent = '';
      return;
    }
    q('#hubGoNote').textContent = `${dlc.knownDrivers} driver${dlc.knownDrivers === 1 ? '' : 's'} sharing DLC`;
    const blocked = (dlc.coverage || []).filter(c => !c.everyone && c.have.length);
    const region = (dlc.regions || [])[0] || [];
    q('#hubGo').innerHTML = `
      <div><div class="v16-section-title">Everyone can drive</div><div class="v16-row" style="margin-top:6px">${(dlc.everyone || []).map(s => `<span class="v16-pill good">${esc(s)}</span>`).join('') || '<span class="muted">Only the base map (CA · NV · AZ)</span>'}</div></div>
      ${region.length > 1 ? `<div class="hub-callout">🗺️ <b>Best convoy area:</b> ${region.map(esc).join(' · ')}<div class="v16-note">These states connect by road and every online driver owns them.</div></div>` : ''}
      ${dlc.gameVersionMatch ? '' : `<div class="hub-callout warn">⚠️ <b>Game versions differ:</b> ${dlc.gameVersions.map(esc).join(' vs ')}. Mods and multiplayer can break — update everyone to the same version.</div>`}
      ${dlc.unknownDrivers?.length ? `<div class="v16-note">Not sharing DLC: ${dlc.unknownDrivers.map(esc).join(', ')} (they need Companion v1.6+ with “Share my DLC” on).</div>` : ''}
      ${renderShopping(h, blocked)}`;
  }

  const fmtBytes = b => (b >= 1e9 ? `${(b / 1e9).toFixed(1)} GB` : b >= 1e6 ? `${Math.round(b / 1e6)} MB` : `${Math.max(1, Math.round(b / 1e3))} KB`);
  const money = (v, cur = 'USD') => (Number.isFinite(v) ? v.toLocaleString('en-US', { style: 'currency', currency: cur }) : '');

  // DLC helper: your own shopping list with prices, plus what other drivers are missing.
  function renderShopping(h, blocked) {
    const mine = (h.shopping || []).find(s => s.isLocal);
    const others = (h.shopping || []).filter(s => !s.isLocal);
    const tag = (on, text, cls = 'good') => (on ? `<span class="v16-pill ${cls}" style="font-size:10.5px">${text}</span>` : '');
    const myList = mine?.items?.length ? `<div><div class="v16-section-title">Your DLC shopping list</div>${mine.items.slice(0, 5).map(i => `
      <div class="v16-item" style="padding:9px 0"><div class="grow"><div class="t">${esc(i.state)}</div>
        <div class="v16-row" style="gap:5px;margin-top:4px">${tag(i.unlocksForEveryone, 'Unlocks it for everyone')}${tag(!i.unlocksForEveryone && i.connectsToConvoyArea, 'Next to your convoy area', 'info')}${i.othersMissing.length ? `<span class="muted" style="font-size:12px">Also missing: ${i.othersMissing.map(esc).join(', ')}</span>` : ''}</div></div>
        <div style="text-align:right">${i.price?.price != null ? `<div style="font-weight:800">${money(i.price.price, i.price.currency)}${i.price.discountPercent ? ` <span class="v16-pill bad" style="font-size:10.5px">-${i.price.discountPercent}%</span>` : ''}</div>${i.price.discountPercent ? `<div class="muted" style="font-size:11px;text-decoration:line-through">${money(i.price.initial, i.price.currency)}</div>` : ''}` : ''}
        <a class="cmd small" href="${esc(i.storeUrl)}" target="_blank" rel="noopener" style="margin-top:4px">${i.price?.discountPercent ? 'On sale — view' : 'Get on Steam'}</a></div></div>`).join('')}</div>` : '';
    const otherList = others.length ? `<div><div class="v16-section-title">What others could add</div>${others.map(o => `<div class="v16-note" style="margin-top:4px"><b>${esc(o.driverName)}:</b> ${o.items.slice(0, 5).map(i => `${esc(i.state)}${i.unlocksForEveryone ? ' ★' : ''}`).join(', ')}</div>`).join('')}<div class="v16-note">★ = the only driver missing it — buying it unlocks that state for the whole convoy.</div></div>` : '';
    if (myList || otherList) return myList + otherList;
    return blocked.length ? `<div><div class="v16-section-title">Unlock more of the map</div>${blocked.map(c => `<div class="v16-item" style="padding:8px 0"><div class="grow"><div class="t">${esc(c.state)}</div><div class="d">Missing for ${c.missing.map(esc).join(', ')}</div></div>${c.storeUrl ? `<a class="cmd small" href="${esc(c.storeUrl)}" target="_blank" rel="noopener">Get on Steam</a>` : ''}</div>`).join('')}</div>` : '';
  }

  function renderMatrix(h) {
    const drivers = (h.drivers || []).filter(d => d.online && d.mapStates);
    const t = q('#hubMatrix');
    if (!drivers.length) { t.innerHTML = '<tbody><tr><td class="muted" style="padding:16px">No DLC shared yet.</td></tr></tbody>'; return; }
    t.innerHTML = `<thead><tr><th>State</th>${drivers.map(d => `<th title="${esc(d.driverName)}">${esc(d.driverName.slice(0, 10))}</th>`).join('')}</tr></thead><tbody>${(h.dlc.coverage || []).map(c => `<tr><td><b>${esc(c.state)}</b>${c.base ? ' <span class="muted" style="font-size:11px">base</span>' : ''}</td>${drivers.map(d => d.mapStates.includes(c.state) ? '<td class="good" style="text-align:center">✔</td>' : `<td class="bad" style="text-align:center">${c.storeUrl ? `<a href="${esc(c.storeUrl)}" target="_blank" rel="noopener" class="bad" title="Get ${esc(c.state)} on Steam" style="text-decoration:none">✘</a>` : '✘'}</td>`).join('')}</tr>`).join('')}</tbody>`;
  }

  function renderPacks(h) {
    const packs = h.modPacks || [];
    if (!packs.length) {
      q('#hubPacks').innerHTML = '<div class="v16-empty"><b>No mod packs shared yet</b>The convoy host creates a mod pack on the Convoy Pre-Flight page. Everyone in the convoy then sees it here with one-click Steam Workshop links for anything they are missing.</div>';
      return;
    }
    q('#hubPacks').innerHTML = packs.map((p, idx) => {
      const missing = p.mods.filter(m => m.missing);
      const missingDlc = p.requiredDlc.filter(d => d.missing);
      const statusCls = p.status === 'READY' ? 'good' : p.status === 'REVIEW' ? 'warn' : 'bad';
      return `<div class="hub-pack"><div class="v16-row" style="justify-content:space-between"><div><div style="font-size:17px;font-weight:800">${esc(p.name)}</div><div class="muted" style="font-size:12.5px">Shared by ${esc(p.from)}${p.gameVersion ? ` · game ${esc(p.gameVersion)}` : ''} · ${p.mods.length} mods · ${p.requiredDlc.length} DLC</div></div>
        <div class="v16-row"><span class="v16-pill ${statusCls}">${p.status === 'READY' ? 'You are ready' : `You need ${missing.length} mod${missing.length === 1 ? '' : 's'}${missingDlc.length ? ` + ${missingDlc.length} DLC` : ''}`}</span>
        ${missing.some(m => m.links) ? `<button class="cmd small primary" data-openall="${idx}" type="button">Open all missing in Steam</button>` : ''}
        ${p.isLocal ? '' : `<button class="cmd small" data-adopt="${esc(p.id)}" type="button">Use this pack</button>`}</div></div>
        ${p.notes ? `<div class="v16-note" style="margin-top:6px">${esc(p.notes)}</div>` : ''}
        ${p.requiredDlc.length ? `<div class="v16-row" style="margin-top:10px">${p.requiredDlc.map(d => d.missing ? `<a class="v16-pill bad" href="${esc(d.storeUrl)}" target="_blank" rel="noopener" style="text-decoration:none">✘ ${esc(d.state || d.token)} — get it</a>` : `<span class="v16-pill good">✔ ${esc(d.state || d.token)}</span>`).join('')}</div>` : ''}
        <div class="hub-mods">${p.mods.map(m => `<div class="hub-mod ${m.missing ? 'missing' : ''}">${m.steam?.previewUrl ? `<img class="hub-mod-img" src="${esc(m.steam.previewUrl)}" alt="" loading="lazy" referrerpolicy="no-referrer">` : ''}<div class="n">${m.missing ? '✘' : '✔'} <b>${esc(m.name)}</b>${m.required ? '' : ' <span class="muted">(optional)</span>'}${m.version ? ` <span class="muted">v${esc(m.version)}</span>` : ''}
          ${m.steam ? `<div class="hub-mod-meta">${m.steam.sizeBytes ? fmtBytes(m.steam.sizeBytes) + ' · ' : ''}updated ${ago(m.steam.updatedAt)}${m.steam.subscriptions ? ` · ${m.steam.subscriptions.toLocaleString()} subscribers` : ''}</div>` : ''}
          ${m.updatedSincePack ? '<div class="hub-mod-warn">⚠ Updated on Steam after this pack was made — everyone should update so versions match.</div>' : ''}
          ${m.removedFromWorkshop ? '<div class="hub-mod-warn bad">✘ No longer on the Workshop (removed or private).</div>' : ''}
          ${m.notForAts ? '<div class="hub-mod-warn bad">✘ This Workshop item is not for American Truck Simulator.</div>' : ''}</div>
          <div class="v16-row">${m.links ? `<a class="cmd small" href="${esc(m.links.steam)}" title="Opens the Steam client so you can Subscribe">Open in Steam</a><a class="cmd small" href="${esc(m.links.web)}" target="_blank" rel="noopener">Workshop page</a>` : ''}${m.downloadUrl ? `<a class="cmd small" href="${esc(m.downloadUrl)}" target="_blank" rel="noopener">Download</a>` : ''}${!m.links && !m.downloadUrl ? '<span class="muted" style="font-size:12px">Ask the host where to get it</span>' : ''}</div></div>`).join('')}</div>
        ${p.orderIssues.length ? `<div class="hub-callout warn" style="margin-top:8px">↕️ Load order differs for: ${p.orderIssues.map(esc).join(', ')} — match the host's order in the in-game Mod Manager.</div>` : ''}
        <div class="v16-note" style="margin-top:8px">How to install: click <b>Open in Steam</b> → <b>Subscribe</b>. Then in ATS open <b>Mod Manager</b>, enable the mods and put them in the order shown here.</div></div>`;
    }).join('');
    qa('[data-openall]').forEach(b => b.onclick = () => {
      const p = packs[Number(b.dataset.openall)];
      const links = p.mods.filter(m => m.missing && m.links).map(m => m.links.web);
      links.forEach((u, i) => setTimeout(() => window.open(u, '_blank', 'noopener'), i * 400));
      notify('Opening Workshop pages', `${links.length} tab(s) — press Subscribe on each`, 'join');
    });
    qa('[data-adopt]').forEach(b => b.onclick = guard(async () => {
      await api('/api/preflight/adopt', { method: 'POST', body: { manifestId: b.dataset.adopt } });
      notify('Mod pack saved', 'It is now your active pre-flight manifest.', 'join');
      loadHub();
    }));
  }

  const loadHub = guard(async () => {
    await geoReady;
    const [h, settings, tr, gap] = await Promise.all([api('/api/hub'), sharing ? null : api('/api/settings'), api('/api/tracks/live').catch(() => ({ trails: [] })), api('/api/gap').catch(() => null)]);
    lastTrails = tr.trails || [];
    if (settings) {
      sharing = settings.sharing || { mods: true, manifest: true };
      q('#hubShareMods').checked = sharing.mods !== false;
      q('#hubShareManifest').checked = sharing.manifest !== false;
      q('#hubShareMods').disabled = q('#hubShareManifest').disabled = settings.canEdit === false;
    }
    lastHub = h;
    q('#hubRelay').innerHTML = relayPill(h.relay);
    renderMap(h);
    renderDrivers(h);
    renderGo(h);
    renderMatrix(h);
    renderGap(h, gap);
    renderPacks(h);
  });

  const saveSharing = guard(async () => {
    const body = { mods: q('#hubShareMods').checked, manifest: q('#hubShareManifest').checked };
    await api('/api/settings/sharing', { method: 'PATCH', body });
    sharing = body;
    notify('Sharing updated', body.mods ? 'Your DLC & mod list is shared with the convoy.' : 'Your DLC & mod list is private.', 'join');
  });

  K.pages.push({
    name: 'hub', icon: '◉', label: 'Convoy Hub', group: 'Convoy', index: 0, html: HTML, load: loadHub,
    init() {
      q('#hubShareMods').onchange = saveSharing;
      q('#hubShareManifest').onchange = saveSharing;
      q('#hubFull').onclick = () => window.open('/?mode=hub', 'kawHubScreen', 'noopener');
      q('#hubMakePack').onclick = () => go('preflight');
      q('#hubLeader').onchange = guard(async e => { await api('/api/gap/leader', { method: 'POST', body: { driverName: e.target.value || null } }); loadHub(); });
    }
  });
  let hubTick = 0;
  K.onTick.push((d, page) => { if (page === 'hub' && ++hubTick % 6 === 0 && !document.activeElement?.matches?.('input,textarea,select')) loadHub(); });

  // ---------- CB radio: show real relay status instead of a dead page ----------
  const loadRadio = guard(async () => {
    const page = q('#page-radio');
    if (!page) return;
    let banner = q('#cbStatus');
    if (!banner) { page.insertAdjacentHTML('afterbegin', '<div id="cbStatus" style="margin-bottom:12px"></div>'); banner = q('#cbStatus'); }
    const r = await api('/api/relay?check=1');
    const frame = q('.radio-frame', page), open = q('.radio-open', page);
    if (r.radioUrl) { if (frame && frame.getAttribute('src') !== r.radioUrl) frame.setAttribute('src', r.radioUrl); if (open) open.href = r.radioUrl; }
    const inviteLink = r.discordInviteUrl && r.discordInviteUrl !== r.discordVoiceUrl ? `<a class="cb-invite" href="${esc(r.discordInviteUrl)}" target="_blank" rel="noopener">Not in KAW Gaming yet? Join the server first</a>` : '';
    const discordBtn = r.discordVoiceUrl ? `<span class="cb-discord-wrap"><a class="cmd primary cb-discord" href="${esc(r.discordVoiceUrl)}" target="_blank" rel="noopener">🎧 Join ATS Convoy voice on Discord</a>${inviteLink}</span>` : '';
    if (open) open.style.display = r.up ? '' : 'none';
    if (r.up) {
      if (frame) frame.style.display = '';
      banner.innerHTML = r.usingBackup
        ? `<div class="hub-callout warn">🛟 <b>Main relay is down — the convoy is on the backup relay.</b> The CB below runs on the backup and everyone switches back automatically when the main relay returns. ${discordBtn}</div>`
        : '';
      return;
    }
    if (frame) frame.style.display = 'none';
    const steps = r.status === 'sign-in-page'
      ? '<div class="v16-note" style="margin-top:10px">This address is protected (for example by Cloudflare Access), so the Companion and drivers cannot use it. In <b>Settings → CB &amp; relay backup</b> set the relay&#39;s public address, or ask KAW for the current one.</div>'
      : r.status === 'suspended'
      ? '<ol class="v16-note" style="margin:8px 0 0 18px;line-height:1.8"><li>Sign in at <a href="https://dashboard.render.com" target="_blank" rel="noopener">dashboard.render.com</a> with the account that owns the relay.</li><li>Open the relay web service (<b>kaws-ats-playground</b>).</li><li>A Hobby workspace is suspended when it uses its 5 GB of free monthly bandwidth: add a card (pay per extra GB) or upgrade, then resume the service.</li><li>Update the relay and every driver to Companion v1.6+, which uses about 93% less relay bandwidth.</li><li>Come back here and press <b>Check again</b>.</li></ol>'
      : r.configured ? `<div class="v16-note" style="margin-top:10px">${r.backups?.length ? 'The backup relay is down too. ' : 'No backup relay is set up (Settings → CB & relay backup). '}Free services can take up to a minute to wake — press Check again in a moment.</div>`
        : '<div class="v16-note" style="margin-top:6px">Set <code>remote.endpoint</code> and <code>remote.enabled</code> in config.json to your convoy relay to use the CB.</div>';
    const fallback = discordBtn
      ? `<div class="cb-fallback"><div><b>Keep talking while it's down</b><div class="v16-note">Jump into the convoy's Discord voice channel — free, works on phone and PC.</div></div>${discordBtn}</div>`
      : '<div class="v16-note" style="margin-top:8px">Tip: add your Discord voice channel link in <b>Settings → CB &amp; relay backup</b> so drivers get a one-click fallback here.</div>';
    banner.innerHTML = `<div class="panel"><div class="v16-body"><div class="v16-row" style="justify-content:space-between"><div><div style="font-size:18px;font-weight:800">📻 CB radio is offline</div><div class="muted" style="font-size:13px;margin-top:3px">${esc(r.detail || 'The convoy relay that hosts the CB is not reachable.')}</div></div><button class="cmd" id="cbRetry" type="button">Check again</button></div>${fallback}${steps}<div class="v16-note" style="margin-top:8px">Relay: ${esc(r.origin || 'not configured')} · last checked ${ago(r.checkedAt)}${r.lastUpAt ? ` · last online ${ago(r.lastUpAt)}` : ''}</div></div></div>`;
    q('#cbRetry').onclick = loadRadio;
  });
  K.loaders.radio = loadRadio;

  // ---------- Layout customizer + multi-screen launcher (Settings page) ----------
  const LAYOUT_KEY = 'kawV16Layout';
  const readLayout = () => { try { return JSON.parse(localStorage.getItem(LAYOUT_KEY) || '{}'); } catch { return {}; } };
  const writeLayout = v => { try { localStorage.setItem(LAYOUT_KEY, JSON.stringify(v)); } catch {} };
  const KPIS = [['v16Limit', 'Speed limit sign'], ['kSpeed', 'Speed'], ['kFuel', 'Fuel'], ['kRoute', 'To destination'], ['kRest', 'Next rest'], ['kDeadline', 'Deadline'], ['kEco', 'Eco score'], ['kAlerts', 'Alerts']];
  function applyLayout() {
    const L = readLayout();
    for (const [id] of KPIS) { const el = document.getElementById(id); if (el) el.style.display = (L.hiddenKpis || []).includes(id) ? 'none' : ''; }
    const strip = q('#v16Kpis'); if (strip) strip.style.display = L.hideStrip ? 'none' : '';
    const bar = q('#v16AlertBar'); if (bar) bar.style.visibility = L.hideAlertBar ? 'hidden' : '';
    if (bar) bar.style.display = L.hideAlertBar ? 'none' : '';
    for (const b of qa('#sideNav .nav-btn[data-page]')) b.style.display = (L.hiddenPages || []).includes(b.dataset.page) ? 'none' : '';
    document.body.classList.toggle('v16-compact-nav', Boolean(L.compactNav));
  }
  function buildLayoutPanel() {
    const grid = q('#page-settings .settings-grid');
    if (!grid) return;
    const L = readLayout();
    const pages = qa('#sideNav .nav-btn[data-page]').map(b => [b.dataset.page, [...b.childNodes].filter(n => n.nodeType === 3).map(n => n.textContent).join('').trim() || b.dataset.page]);
    const origin = location.origin;
    grid.insertAdjacentHTML('afterbegin', `
      <div class="panel setting" style="grid-column:1/-1" id="relayBackupPanel"><div class="v16-row" style="justify-content:space-between"><div><b>CB &amp; relay backup</b><div class="muted setting-help">If the main convoy relay goes down, the Companion switches every driver to the backup automatically and moves back when the main relay returns. Drivers should use the same backup address.</div></div><div id="relayBackupState"></div></div>
        <div class="v16-grid v16-2" style="margin-top:10px">
          <div class="v16-field"><label for="relayMainUrl">Main relay URL</label><input id="relayMainUrl" class="v16-input" placeholder="https://your-relay.example.com/api/telemetry" autocomplete="off"><div class="v16-note">Use the convoy relay address ending in /api/telemetry.</div></div>
          <label class="v16-toggle"><span>Share with convoy</span><input id="relaySharingEnabled" type="checkbox"></label>
          <div class="v16-field"><label for="relayBackupUrl">Backup relay URL</label><input id="relayBackupUrl" class="v16-input" placeholder="https://cb-backup.example.com/api/telemetry" autocomplete="off"><div class="v16-note">Leave empty for none. Setup instructions: CB-RELAY-SETUP.md (included in this package).</div></div>
          <div class="v16-field"><label for="relayDiscordUrl">Discord voice channel (CB fallback)</label><input id="relayDiscordUrl" class="v16-input" placeholder="https://discord.com/channels/server/channel" autocomplete="off"><div class="v16-note">Shown as a one-click button on the CB page whenever the relay is down.</div></div>
          <div class="v16-field"><label for="relayInviteUrl">Discord server invite</label><input id="relayInviteUrl" class="v16-input" placeholder="https://discord.gg/yourcode" autocomplete="off"><div class="v16-note">For drivers who are not in the server yet.</div></div>
        </div>
        <div class="v16-row" style="margin-top:10px"><button class="cmd primary" id="relayBackupSave" type="button">Save</button><span class="muted" id="relayMain" style="font-size:12.5px"></span></div></div>
      <div class="panel setting" style="grid-column:1/-1"><div class="v16-row" style="justify-content:space-between"><div><b>Multi-screen setup</b><div class="muted setting-help">Open any view on another monitor, a tablet or a phone. On other devices use this PC's network address instead of ${esc(origin)} (enable LAN mode below).</div></div></div>
        <div class="screen-grid">
          ${[['🚚', 'Driving HUD', 'Big gauges only', '/?mode=hud'], ['🧭', 'Navigation screen', 'Full-screen route map', '/?mode=second-screen'], ['🗺️', 'Convoy map', 'Live map of every driver', '/?mode=hub'], ['⚠️', 'Alerts board', 'Warnings and deadline', '/?page=alerts&mode=kiosk'], ['📋', 'Dispatch board', 'Stops and bills of lading', '/?page=dispatch&mode=kiosk'], ['📻', 'CB radio', 'Talk to the convoy', '/?page=radio&mode=kiosk']].map(([i, t, d, u]) => `<button class="screen-card" type="button" data-screen="${u}"><span>${i}</span><b>${t}</b><small>${d}</small></button>`).join('')}
        </div></div>
      <div class="panel setting"><b>Top status strip</b><div class="muted setting-help">Choose the live readouts shown above every page.</div>
        <div class="v16-stack" style="margin-top:8px">${KPIS.map(([id, label]) => `<label class="v16-toggle"><span>${label}</span><input type="checkbox" data-kpi="${id}" ${(L.hiddenKpis || []).includes(id) ? '' : 'checked'}></label>`).join('')}
        <label class="v16-toggle"><span><b>Show the strip</b></span><input type="checkbox" id="layStrip" ${L.hideStrip ? '' : 'checked'}></label><label class="v16-toggle"><span><b>Show alert banner</b></span><input type="checkbox" id="layAlerts" ${L.hideAlertBar ? '' : 'checked'}></label></div></div>
      <div class="panel setting"><b>Menu pages</b><div class="muted setting-help">Hide pages you never use. They stay reachable from links.</div>
        <div class="v16-stack" style="margin-top:8px;max-height:360px;overflow:auto">${pages.map(([p, label]) => `<label class="v16-toggle"><span>${esc(label)}</span><input type="checkbox" data-navpage="${esc(p)}" ${(L.hiddenPages || []).includes(p) ? '' : 'checked'} ${p === 'settings' ? 'disabled' : ''}></label>`).join('')}
        <label class="v16-toggle"><span><b>Compact menu</b></span><input type="checkbox" id="layCompact" ${L.compactNav ? 'checked' : ''}></label></div></div>`);
    const save = () => {
      writeLayout({
        hiddenKpis: qa('[data-kpi]').filter(i => !i.checked).map(i => i.dataset.kpi),
        hiddenPages: qa('[data-navpage]').filter(i => !i.checked).map(i => i.dataset.navpage),
        hideStrip: !q('#layStrip').checked, hideAlertBar: !q('#layAlerts').checked, compactNav: q('#layCompact').checked
      });
      applyLayout();
    };
    qa('[data-kpi],[data-navpage],#layStrip,#layAlerts,#layCompact').forEach(i => i.onchange = save);
    const loadRelaySettings = guard(async () => {
      const [st, rel] = await Promise.all([api('/api/settings'), api('/api/relay')]);
      q('#relayMainUrl').value = st.relay?.endpoint || '';
      q('#relaySharingEnabled').checked = Boolean(st.relay?.enabled);
      q('#relayBackupUrl').value = (st.relay?.backupEndpoints || []).join(', ');
      q('#relayDiscordUrl').value = st.relay?.discordVoiceUrl || '';
      q('#relayInviteUrl').value = st.relay?.discordInviteUrl || '';
      q('#relayMain').textContent = `Main relay: ${st.relay?.endpoint || 'not set'} · ${rel.primary?.status || rel.status}${rel.usingBackup ? ' · convoy is on the backup' : ''}`;
      q('#relayBackupState').innerHTML = relayPill(rel);
      for (const el of qa('#relayBackupPanel input, #relayBackupPanel button')) el.disabled = st.canEdit === false;
    });
    q('#relayBackupSave').onclick = guard(async () => {
      await api('/api/settings/relay', { method: 'PATCH', body: { endpoint: q('#relayMainUrl').value.trim(), enabled: q('#relaySharingEnabled').checked, backupEndpoints: q('#relayBackupUrl').value.trim(), discordVoiceUrl: q('#relayDiscordUrl').value.trim(), discordInviteUrl: q('#relayInviteUrl').value.trim() } });
      notify('Relay settings saved', q('#relayBackupUrl').value.trim() ? 'Automatic failover is on.' : 'No backup relay set.', 'join');
      loadRelaySettings();
    });
    loadRelaySettings();
    qa('[data-screen]').forEach(b => b.onclick = () => window.open(b.dataset.screen, `kaw-${b.dataset.screen.replace(/\W+/g, '')}`, 'noopener'));
  }

  // ---------- screen modes: ?mode=hub (full-screen convoy map) and ?mode=kiosk (one page, no menus) ----------
  const mode = new URLSearchParams(location.search).get('mode');
  K.onReady.push(() => {
    buildLayoutPanel();
    applyLayout();
    if (mode === 'hub') { document.body.classList.add('hub-screen', 'kiosk-screen'); go('hub'); }
    else if (mode === 'kiosk') document.body.classList.add('kiosk-screen');
  });
})();
