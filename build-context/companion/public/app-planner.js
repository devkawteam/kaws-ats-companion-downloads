// Route planner on the ATS map + real-world weather where you drive (NOAA, opt-in). Author: Kaw.
(() => {
  const K = window.KAW16; if (!K) return;
  const { q, api, esc, guard, notify, telem } = K;
  const local = ['127.0.0.1', 'localhost', '[::1]'].includes(location.hostname);
  const hm = min => { const m = Math.round(min || 0); return `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, '0')}m`; };
  const mi = n => `${Math.round(n || 0).toLocaleString('en-US')} mi`;

  async function makeMap(el) {
    await K.tileMap.loadLeaflet();
    let tm = null;
    tm = K.tileMap.createTileMap(el, { onStyle: id => tm.setStyle(id) });
    tm.setStyle('atsgame');
    return tm;
  }

  // ------------------------------------------------------------ Route planner
  let stops = ['', ''], tm = null, layer = null, last = null, cityList = [];
  const plannerHtml = `<div class="panel"><div class="panel-head"><div class="panel-title">Route Planner</div></div><div class="v16-body">
    <p>Plan a multi-stop run across the ATS map: legs, driving time, and where you'll need to sleep and refuel. Distances are estimates between cities (straight line × a road factor). The factor learns from your finished deliveries, so estimates get closer to the game's own distances over time. Use the in-game GPS for the exact roads.</p>
    <datalist id="rpCities"></datalist>
    <div id="rpStops"></div>
    <div class="v16-row"><button class="cmd" id="rpAdd">+ Add stop</button><button class="cmd" id="rpJob">Use my current job</button><button class="cmd" id="rpReverse">Reverse</button></div>
    <div class="v16-row"><label style="flex:1 1 140px">Average speed (mph) <input class="v16-input" id="rpSpeed" type="number" min="20" max="80" value="55"></label><label style="flex:1 1 160px">Sleep after (driving hours) <input class="v16-input" id="rpRest" type="number" min="4" max="14" value="11"></label></div>
    <label class="v16-toggle"><span>Start from my truck's live fuel and rest timer</span><input type="checkbox" id="rpLive" checked></label>
    <div class="v16-row"><button class="cmd" id="rpPlan">Plan route</button><button class="cmd" id="rpSave" disabled>Save plan</button><button class="cmd" id="rpCopy" disabled>Copy for Discord</button><button class="cmd" id="rpShare" disabled>Share with convoy</button><button class="cmd" id="rpFollow" disabled>Follow this plan</button></div>
    <div id="rpRestNow" class="v16-note" role="status"></div>
    <p id="rpStatus" role="status"></p>
    <div id="rpResult"></div>
    <div id="rpMap" style="height:440px;border-radius:10px;margin-top:10px"></div>
    <h3>Convoy routes</h3><p class="v16-note">Share a plan and everyone on your convoy relay sees it here. "Follow" a plan to get rest-stop warnings that name the next town on it.</p><div id="rpShared"></div>
    <h3>Saved plans</h3><div id="rpSaved"></div>
  </div></div>`;

  function renderStops() {
    q('#rpStops').innerHTML = stops.map((s, i) => `<div class="v16-row" style="margin:4px 0"><span style="width:84px">${i === 0 ? 'Start' : i === stops.length - 1 ? 'Destination' : `Stop ${i}`}</span>
      <input class="v16-input" style="flex:1 1 200px;width:auto" list="rpCities" data-stop="${i}" value="${esc(s)}" placeholder="City name" aria-label="${i === 0 ? 'Start city' : `Stop ${i} city`}">
      <button class="cmd" data-up="${i}" title="Move up" aria-label="Move up" ${i === 0 ? 'disabled' : ''}>▲</button><button class="cmd" data-rm="${i}" title="Remove" aria-label="Remove stop" ${stops.length <= 2 ? 'disabled' : ''}>✕</button></div>`).join('');
    q('#rpStops').querySelectorAll('[data-stop]').forEach(el => el.oninput = () => { stops[+el.dataset.stop] = el.value; });
    q('#rpStops').querySelectorAll('[data-up]').forEach(b => b.onclick = () => { const i = +b.dataset.up; [stops[i - 1], stops[i]] = [stops[i], stops[i - 1]]; renderStops(); });
    q('#rpStops').querySelectorAll('[data-rm]').forEach(b => b.onclick = () => { stops.splice(+b.dataset.rm, 1); renderStops(); });
  }

  function draw(r) {
    if (!tm) return;
    const L = window.L;
    if (layer) tm.map.removeLayer(layer);
    layer = L.layerGroup().addTo(tm.map);
    const pts = r.points.map(p => [p.lat, p.lon]);
    L.polyline(pts, { color: '#ffb000', weight: 4, dashArray: '10 8', opacity: 0.95 }).addTo(layer);
    r.points.forEach((p, i) => L.circleMarker([p.lat, p.lon], { radius: 8, color: '#111', weight: 2, fillColor: i === 0 ? '#2ecc71' : i === r.points.length - 1 ? '#e74c3c' : '#4aa3ff', fillOpacity: 1 })
      .bindTooltip(`${i === 0 ? 'Start' : i === r.points.length - 1 ? 'Destination' : `Stop ${i}`}: ${esc(p.name)}${p.stateCode ? `, ${esc(p.stateCode)}` : ''}`).addTo(layer));
    for (const s of r.stops) L.marker([s.lat, s.lon], { icon: L.divIcon({ className: '', html: `<div style="font-size:20px;filter:drop-shadow(0 1px 2px #000)">${s.kind === 'rest' ? '🛏️' : '⛽'}</div>`, iconSize: [22, 22], iconAnchor: [11, 11] }) })
      .bindTooltip(`${s.kind === 'rest' ? 'Sleep' : 'Refuel'} around mile ${s.mileFromStart} (${esc(s.near)})`).addTo(layer);
    tm.map.fitBounds(L.latLngBounds(pts).pad(0.25));
  }

  function renderResult(r) {
    const missing = r.missingStates?.length ? `<p class="v16-pill warn" style="display:inline-block">Map DLC not found for: ${r.missingStates.map(esc).join(', ')}</p>` : '';
    q('#rpResult').innerHTML = `<div class="v16-row" style="gap:18px;margin:8px 0"><b>${mi(r.totalMiles)}</b><span>Driving ${hm(r.driveMinutes)}</span><span>With stops ≈ ${hm(r.totalGameMinutes)} game time</span><span>${r.stops.filter(s => s.kind === 'rest').length} sleep · ${r.stops.filter(s => s.kind === 'fuel').length} fuel</span></div>${missing}
      <table style="width:100%;border-collapse:collapse"><thead><tr><th align="left">Leg</th><th align="right">Miles</th><th align="right">Time</th></tr></thead><tbody>
      ${r.legs.map(l => `<tr><td>${esc(l.from)}${l.fromState ? `, ${esc(l.fromState)}` : ''} → ${esc(l.to)}${l.toState ? `, ${esc(l.toState)}` : ''}</td><td align="right">${mi(l.miles)}</td><td align="right">${hm(l.minutes)}</td></tr>`).join('')}</tbody></table>
      ${r.stops.length ? `<ul>${r.stops.map(s => `<li>${s.kind === 'rest' ? '🛏️ Sleep' : '⛽ Refuel'} at about mile ${s.mileFromStart.toLocaleString('en-US')} — ${esc(s.near)}</li>`).join('')}</ul>` : ''}
      <p class="v16-note">Distance factor ${r.factor}× ${r.learned ? `(learned from ${r.samples} of your deliveries)` : '(default; it learns after 3 deliveries between known cities)'}.</p>`;
  }

  const shareText = r => `🛣️ Route plan: ${r.points.map(p => p.name).join(' → ')}\n${mi(r.totalMiles)} · driving ${hm(r.driveMinutes)} · ${r.stops.filter(s => s.kind === 'rest').length} sleep / ${r.stops.filter(s => s.kind === 'fuel').length} fuel stops\n` + r.legs.map(l => `• ${l.from} → ${l.to}: ${mi(l.miles)} (${hm(l.minutes)})`).join('\n');

  async function doPlan() {
    const list = stops.map(s => s.trim()).filter(Boolean);
    if (list.length < 2) throw new Error('Enter a start and a destination.');
    q('#rpStatus').textContent = 'Planning…';
    const r = await fetch('/api/planner/plan', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ stops: list, speedMph: +q('#rpSpeed').value, driveHoursBeforeRest: +q('#rpRest').value, useLiveFuel: q('#rpLive').checked }) }).then(x => x.json());
    if (!r.ok) { q('#rpStatus').textContent = r.error || 'Could not plan that route.'; last = null; q('#rpSave').disabled = q('#rpCopy').disabled = q('#rpShare').disabled = q('#rpFollow').disabled = true; return; }
    last = r; q('#rpStatus').textContent = ''; renderResult(r); draw(r);
    q('#rpSave').disabled = q('#rpShare').disabled = q('#rpFollow').disabled = !local; q('#rpCopy').disabled = false;
  }

  async function loadSaved() {
    const r = await api('/api/planner/plans');
    q('#rpSaved').innerHTML = r.plans.length ? r.plans.map(p => `<div class="v16-row" style="margin:4px 0"><span style="flex:1">${esc(p.name)} <span class="v16-note">${esc(new Date(p.savedAt).toLocaleDateString())}</span></span><button class="cmd" data-open="${esc(p.id)}">Open</button>${local ? `<button class="cmd" data-del="${esc(p.id)}">Delete</button>` : ''}</div>`).join('') : '<p class="v16-note">No saved plans yet.</p>';
    q('#rpSaved').querySelectorAll('[data-open]').forEach(b => b.onclick = guard(async () => { const p = r.plans.find(x => x.id === b.dataset.open); stops = [...p.stops]; q('#rpSpeed').value = p.speedMph; renderStops(); await doPlan(); }));
    q('#rpSaved').querySelectorAll('[data-del]').forEach(b => b.onclick = guard(async () => { if (!confirm('Delete this saved plan?')) return; await api('/api/planner/plans/delete', { method: 'POST', body: { id: b.dataset.del } }); loadSaved(); }));
  }

  // ---- convoy route sharing + following ----
  let sharedLayer = null;
  function drawShared(route, colour = '#b36bff') {
    if (!tm) return;
    const L = window.L;
    if (sharedLayer) tm.map.removeLayer(sharedLayer);
    sharedLayer = L.layerGroup().addTo(tm.map);
    const pts = route.stops.map(s => [s.lat, s.lon]);
    L.polyline(pts, { color: colour, weight: 4, dashArray: '4 8' }).bindTooltip(esc(route.name)).addTo(sharedLayer);
    route.stops.forEach((s, i) => L.circleMarker([s.lat, s.lon], { radius: 6, color: '#111', weight: 2, fillColor: colour, fillOpacity: 1 }).bindTooltip(`${i + 1}. ${esc(s.name)}`).addTo(sharedLayer));
    tm.map.fitBounds(L.latLngBounds(pts).pad(0.25));
  }
  const routeLine = r => `${esc(r.name)} <span class="v16-note">${r.stops.map(s => esc(s.name)).join(' → ')}${r.totalMiles ? ` · ${mi(r.totalMiles)}` : ''}</span>`;
  async function loadShared() {
    const r = await api('/api/planner/shared');
    const rows = [];
    if (r.mine) rows.push(`<div class="v16-row" style="margin:4px 0"><span style="flex:1">📣 You're sharing: ${routeLine(r.mine)}</span><button class="cmd" data-show="mine">Show</button>${local ? '<button class="cmd" id="rpStopShare">Stop sharing</button>' : ''}</div>`);
    if (r.active) rows.push(`<div class="v16-row" style="margin:4px 0"><span style="flex:1">🧭 Following: ${routeLine(r.active)}</span><button class="cmd" data-show="active">Show</button>${local ? '<button class="cmd" id="rpUnfollow">Stop following</button>' : ''}</div>`);
    r.convoy.forEach((c, i) => rows.push(`<div class="v16-row" style="margin:4px 0"><span style="flex:1">🚚 ${esc(c.from)}: ${routeLine(c.route)}</span><button class="cmd" data-show="c${i}">Show</button>${local ? `<button class="cmd" data-follow="${i}">Follow</button>` : ''}</div>`));
    q('#rpShared').innerHTML = rows.join('') || '<p class="v16-note">No shared routes right now.</p>';
    q('#rpShared').querySelectorAll('[data-show]').forEach(b => b.onclick = () => { const k = b.dataset.show; drawShared(k === 'mine' ? r.mine : k === 'active' ? r.active : r.convoy[+k.slice(1)].route); });
    q('#rpShared').querySelectorAll('[data-follow]').forEach(b => b.onclick = guard(async () => { await api('/api/planner/follow', { method: 'POST', body: { route: r.convoy[+b.dataset.follow].route } }); notify('Following route', r.convoy[+b.dataset.follow].route.name, 'join'); loadShared(); }));
    if (q('#rpStopShare')) q('#rpStopShare').onclick = guard(async () => { await api('/api/planner/share/stop', { method: 'POST' }); loadShared(); });
    if (q('#rpUnfollow')) q('#rpUnfollow').onclick = guard(async () => { await api('/api/planner/unfollow', { method: 'POST' }); loadShared(); });
  }
  async function loadRest() {
    const r = await api('/api/planner/rest').catch(() => null);
    q('#rpRestNow').textContent = !r?.active ? '' : r.stop ? `🛏️ Rest needed in ${r.restMinutes} min — ${r.stop.name}${r.stop.stateCode ? `, ${r.stop.stateCode}` : ''} is about ${r.stop.miles} mi ahead (${r.stop.minutes} min)${r.stop.fromPlan ? ' on your plan' : ''}.` : `🛏️ Rest needed in ${r.restMinutes} min.`;
  }
  const planBody = () => ({ stops: last.points.map(p => p.asked), speedMph: last.speedMph, driveHoursBeforeRest: +q('#rpRest').value || 11 });

  let plannerReady = null;
  async function plannerInit() {
    renderStops();
    const c = await api('/api/planner/cities'); cityList = c.cities;
    q('#rpCities').innerHTML = cityList.map(n => `<option value="${esc(n)}">`).join('');
    if (c.job?.from && c.job?.to && stops.every(s => !s)) { stops = [c.job.from, c.job.to]; renderStops(); }
    q('#rpAdd').onclick = () => { stops.splice(stops.length - 1, 0, ''); renderStops(); };
    q('#rpReverse').onclick = () => { stops.reverse(); renderStops(); };
    q('#rpJob').onclick = guard(async () => { const j = (await api('/api/planner/cities')).job; if (!j) throw new Error('No active job in the game.'); stops = [j.from, j.to]; renderStops(); await doPlan(); });
    q('#rpPlan').onclick = guard(doPlan);
    q('#rpSave').onclick = guard(async () => { if (!last) return; const name = prompt('Name this plan', last.points.map(p => p.name).join(' → ')); if (name === null) return; await api('/api/planner/plans', { method: 'POST', body: { name, stops: last.points.map(p => p.asked), speedMph: last.speedMph } }); notify('Plan saved', name, 'join'); loadSaved(); });
    q('#rpCopy').onclick = guard(async () => { const t = shareText(last); try { await navigator.clipboard.writeText(t); notify('Copied', 'Paste it into Discord.', 'join'); } catch { prompt('Copy the plan:', t); } });
    q('#rpShare').onclick = guard(async () => { if (!last) return; const name = prompt('Name for the convoy', last.points.map(p => p.name).join(' → ')); if (name === null) return; await api('/api/planner/share', { method: 'POST', body: { ...planBody(), name } }); notify('Route shared', 'Your convoy will see it within a few seconds.', 'join'); loadShared(); });
    q('#rpFollow').onclick = guard(async () => { if (!last) return; await api('/api/planner/follow', { method: 'POST', body: { ...planBody(), name: last.points.map(p => p.name).join(' → ') } }); notify('Following this plan', 'Rest warnings will name stops on it.', 'join'); loadShared(); });
    await loadSaved();
    tm = await makeMap(q('#rpMap'));
    await loadShared();
  }
  K.pages.push({ name: 'planner', icon: '⇢', label: 'Route Planner', group: 'Drive', index: 2, html: plannerHtml,
    load: () => { plannerReady ||= plannerInit().catch(e => { plannerReady = null; q('#rpStatus').textContent = e.message; }); return plannerReady.then(() => { tm?.map.invalidateSize(); loadShared().catch(() => {}); loadRest(); }); } });
  setInterval(() => { if (K.currentPage() === 'planner' && plannerReady) { loadShared().catch(() => {}); loadRest(); } }, 15000);

  // ------------------------------------------------------------ Real-world weather
  let wtm = null, truck = null, radar = null, wTimer = null;
  const weatherHtml = `<div class="panel"><div class="panel-head"><div class="panel-title">Real Weather</div></div><div class="v16-body">
    <p>See the real-world weather at the spot that matches your truck's position in ATS, from the US National Weather Service (free, no account). Use it for role-play: real storms, wind and snow where you drive.</p>
    <label class="v16-toggle"><span>Get real weather from weather.gov</span><input type="checkbox" id="wxOn"></label>
    <p class="v16-note">Off by default. When on, the Companion sends the real-world point matching your game position (rounded to about a mile) to api.weather.gov, and the radar layer loads images from NOAA. Nothing about you or your PC is sent.</p>
    <div id="wxBody"></div>
    <label class="v16-toggle"><span>Show NOAA weather radar on the map</span><input type="checkbox" id="wxRadar" checked></label>
    <div id="wxMap" style="height:420px;border-radius:10px;margin-top:8px"></div>
  </div></div>`;

  function renderWeather(w) {
    const box = q('#wxBody');
    if (!w.enabled) { box.innerHTML = '<p>Real weather is off.</p>'; return; }
    if (w.waiting || w.error) { box.innerHTML = `<p>${esc(w.error || 'Waiting for your position…')}</p>`; return; }
    const n = w.now || {};
    box.innerHTML = `<div class="v16-row" style="gap:18px;align-items:center;margin:10px 0"><div style="font-size:42px;font-weight:800">${n.temperatureF ?? '—'}°F</div><div><b>${esc(n.short || '')}</b><div class="v16-note">${esc(w.place || w.near || '')}${w.state ? ` · ${esc(w.state)}` : ''} · wind ${esc(n.wind || '—')}${n.rainChance != null ? ` · ${n.rainChance}% rain` : ''}</div></div></div>
      <p>🚚 ${esc(w.tip)}</p>
      ${(w.alerts || []).map(a => `<div class="panel" style="padding:10px;margin:6px 0;border-left:4px solid ${a.severity === 'Extreme' || a.severity === 'Severe' ? '#e74c3c' : '#f1c40f'}"><b>⚠️ ${esc(a.event)}</b><div class="v16-note">${esc(a.headline || '')}</div></div>`).join('')}
      <div class="v16-row" style="gap:8px;overflow:auto">${(w.hourly || []).slice(1, 8).map(h => `<div class="panel" style="padding:8px 10px;min-width:92px;text-align:center"><div class="v16-note">${esc(new Date(h.start).toLocaleTimeString([], { hour: 'numeric' }))}</div><b>${h.temperatureF}°</b><div class="v16-note">${esc(h.short)}</div></div>`).join('')}</div>
      <p class="v16-note">${esc(w.source)} · updated ${esc(new Date(w.fetchedAt).toLocaleTimeString())}</p>`;
  }
  function radarLayer(on) {
    const L = window.L; if (!wtm || !L) return;
    if (radar) { wtm.map.removeLayer(radar); radar = null; }
    if (!on) return;
    radar = L.tileLayer.wms('https://opengeo.ncep.noaa.gov/geoserver/conus/conus_bref_qcd/ows', { layers: 'conus_bref_qcd', format: 'image/png', transparent: true, opacity: 0.65, attribution: 'Radar: NOAA/NWS' }).addTo(wtm.map);
  }
  function placeTruck() {
    const g = telem()?.geo; if (!wtm || !g) return;
    const L = window.L;
    if (!truck) truck = L.circleMarker([g.lat, g.lon], { radius: 9, color: '#111', weight: 2, fillColor: '#ffb000', fillOpacity: 1 }).bindTooltip('Your truck').addTo(wtm.map);
    else truck.setLatLng([g.lat, g.lon]);
  }
  async function refreshWeather(first = false) {
    try {
      const w = await api('/api/weather');
      q('#wxOn').checked = !!w.enabled; q('#wxOn').disabled = !local;
      renderWeather(w);
      radarLayer(w.enabled && q('#wxRadar').checked);
      placeTruck();
      const g = telem()?.geo; if (first && g && wtm) wtm.map.setView([g.lat, g.lon], 7);
    } catch (e) { q('#wxBody').innerHTML = `<p>${esc(e.message)}</p>`; }
  }
  let weatherReady = null;
  async function weatherInit() {
    q('#wxOn').onchange = guard(async () => { await api('/api/weather/settings', { method: 'POST', body: { enabled: q('#wxOn').checked } }); await refreshWeather(true); });
    q('#wxRadar').onchange = () => refreshWeather();
    wtm = await makeMap(q('#wxMap'));
    await refreshWeather(true);
  }
  K.pages.push({ name: 'weather', icon: '☁', label: 'Real Weather', group: 'Drive', index: 3, html: weatherHtml,
    load: () => {
      weatherReady ||= weatherInit().catch(e => { weatherReady = null; q('#wxBody').textContent = e.message; });
      clearInterval(wTimer); wTimer = setInterval(() => { if (K.currentPage() === 'weather') refreshWeather(); else clearInterval(wTimer); }, 5 * 60000);
      return weatherReady.then(() => { wtm?.map.invalidateSize(); refreshWeather(); });
    } });
  K.onTick.push(() => { if (K.currentPage() === 'weather') placeTruck(); });
})();
