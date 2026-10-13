// Delivery replay: play a finished trip back on the ATS map with a timeline, speed and screenshots.
// Uses the route the Companion records during each job (data/routes). Author: Kaw.
(() => {
  const K = window.KAW16; if (!K) return;
  const { q, api, esc, guard, dateTime } = K;
  let tm = null, layer = null, marker = null, data = null, idx = 0, playing = false, timer = null, shots = [];
  const SPEEDS = [[30, '30×'], [60, '60×'], [120, '120×'], [300, '300×']];

  const html = `<div class="panel"><div class="panel-head"><div class="panel-title">Delivery Replay</div></div><div class="v16-body">
    <p>Watch a finished delivery again on the ATS map: where you drove, how fast, and where you took screenshots. Trips are recorded automatically while you have a job.</p>
    <div class="v16-row"><label style="flex:2 1 260px">Trip <select class="v16-input" id="rvTrip"></select></label><label style="flex:0 1 120px">Playback <select class="v16-input" id="rvSpeed">${SPEEDS.map(([v, l]) => `<option value="${v}" ${v === 60 ? 'selected' : ''}>${l}</option>`).join('')}</select></label></div>
    <div class="v16-row" style="margin:8px 0"><button class="cmd" id="rvPlay">▶ Play</button><button class="cmd" id="rvStart">⏮ Start</button><input type="range" id="rvSlider" min="0" max="0" value="0" style="flex:1 1 300px" aria-label="Replay position"><button class="cmd" id="rvAlbum">📸 Photo album</button><button class="cmd" id="rvAlbumShare">Share…</button><a class="cmd" id="rvRecap" target="_blank" rel="noopener">Stream recap card ↗</a></div>
    <div class="v16-row" id="rvStats" style="gap:20px;margin:6px 0"></div>
    <div id="rvMap" style="height:480px;border-radius:10px"></div>
    <div id="rvSummary" class="v16-note" style="margin-top:8px"></div>
  </div></div>`;

  const hm = s => { s = Math.max(0, Math.round(s)); const h = Math.floor(s / 3600), m = Math.floor(s % 3600 / 60); return h ? `${h}h ${String(m).padStart(2, '0')}m` : `${m}m ${String(s % 60).padStart(2, '0')}s`; };

  function stats() {
    const pts = data.points, p = pts[idx], first = pts[0];
    const elapsed = p[2] - first[2];
    const hasOdo = Number.isFinite(p[4]) && Number.isFinite(first[4]);
    const miles = hasOdo ? p[4] - first[4] : (Number(data.trip.milesDriven) || 0) * (idx / Math.max(1, pts.length - 1));
    const speed = Number.isFinite(p[3]) ? `${p[3]} mph` : '—';
    q('#rvStats').innerHTML = `<span>🕒 ${esc(new Date(p[2] * 1000).toLocaleTimeString())}</span><span>⏱ ${hm(elapsed)} in</span><span>🛣 ${miles.toFixed(1)} mi${hasOdo ? '' : ' (est.)'}</span><span>🚚 ${speed}</span>`;
    q('#rvSlider').value = idx;
    marker?.setLatLng([p[1], p[0]]);
  }
  function step() {
    if (!playing || !data) return;
    if (idx >= data.points.length - 1) { pause(); return; }
    idx++; stats();
    // Points are ~10 s apart in real time; playback factor divides that.
    const dt = Math.max(16, (data.points[idx][2] - data.points[idx - 1][2]) * 1000 / Number(q('#rvSpeed').value));
    timer = setTimeout(step, Math.min(dt, 1500));
  }
  function play() { if (!data) return; if (idx >= data.points.length - 1) idx = 0; playing = true; q('#rvPlay').textContent = '⏸ Pause'; step(); }
  function pause() { playing = false; clearTimeout(timer); q('#rvPlay').textContent = '▶ Play'; }

  function draw() {
    const L = window.L;
    if (layer) tm.map.removeLayer(layer);
    layer = L.layerGroup().addTo(tm.map); marker = null;
    const pts = data.points;
    if (pts.length < 2) { q('#rvSummary').textContent = 'No route was recorded for this trip (it may be from before route recording, or too short).'; q('#rvStats').innerHTML = ''; return; }
    // Colour each segment by speed when recorded: green steady, amber fast, red over 70 mph.
    for (let i = 1; i < pts.length; i++) {
      const v = pts[i][3];
      L.polyline([[pts[i - 1][1], pts[i - 1][0]], [pts[i][1], pts[i][0]]], { color: !Number.isFinite(v) ? '#4aa3ff' : v > 70 ? '#e74c3c' : v > 60 ? '#f1c40f' : '#2ecc71', weight: 4, opacity: 0.9 }).addTo(layer);
    }
    L.circleMarker([pts[0][1], pts[0][0]], { radius: 7, color: '#111', weight: 2, fillColor: '#2ecc71', fillOpacity: 1 }).bindTooltip(`Start: ${esc(data.trip.originCity || '')}`).addTo(layer);
    L.circleMarker([pts.at(-1)[1], pts.at(-1)[0]], { radius: 7, color: '#111', weight: 2, fillColor: '#e74c3c', fillOpacity: 1 }).bindTooltip(`Delivered: ${esc(data.trip.destinationCity || '')}`).addTo(layer);
    // Screenshots at the point nearest in time.
    for (const s of shots.filter(s => (data.trip.screenshots || []).includes(s.name))) {
      const t = Date.parse(s.takenAt) / 1000;
      const near = pts.reduce((b, p, i) => (Math.abs(p[2] - t) < Math.abs(pts[b][2] - t) ? i : b), 0);
      L.marker([pts[near][1], pts[near][0]], { icon: L.divIcon({ className: '', html: '<div style="font-size:18px">📸</div>', iconSize: [20, 20], iconAnchor: [10, 10] }) })
        .bindPopup(`<img src="/api/journal/image/${encodeURIComponent(s.name)}" alt="" style="width:240px;border-radius:6px"><br>${esc(dateTime(s.takenAt))}`)
        .on('click', () => { pause(); idx = near; stats(); }).addTo(layer);
    }
    marker = L.circleMarker([pts[0][1], pts[0][0]], { radius: 9, color: '#fff', weight: 3, fillColor: '#ffb000', fillOpacity: 1 }).addTo(layer);
    tm.map.fitBounds(L.latLngBounds(pts.map(p => [p[1], p[0]])).pad(0.15));
    const t = data.trip;
    q('#rvSummary').textContent = `${t.cargo || 'Load'} · ${t.originCity || '?'} → ${t.destinationCity || '?'} · ${Math.round(t.milesDriven || 0)} mi · ${hm(t.durationSeconds || (pts.at(-1)[2] - pts[0][2]))} · top speed ${Math.round(t.maxSpeedMph || 0)} mph · ${pts.length} route points. Colours: green under 60, amber 60–70, red over 70 mph.`;
    q('#rvSlider').max = pts.length - 1; idx = 0; stats();
  }

  // ---- Trip photo album: one shareable picture — route, stats and up to six screenshots of this trip ----
  const loadImg = src => new Promise(resolve => { const i = new Image(); i.onload = () => resolve(i); i.onerror = () => resolve(null); i.src = src; });
  async function makeAlbum() {
    if (!data?.trip) throw new Error('Pick a finished trip first.');
    const t = data.trip, pts = data.points || [];
    const tripShots = shots.filter(s => (t.screenshots || []).includes(s.name)).slice(0, 6);
    const imgs = (await Promise.all(tripShots.map(s => loadImg(`/api/journal/image/${encodeURIComponent(s.name)}`)))).filter(Boolean);
    const W = 1600, H = 1000, c = document.createElement('canvas'); c.width = W; c.height = H;
    const x = c.getContext('2d');
    const g = x.createLinearGradient(0, 0, W, H); g.addColorStop(0, '#0b1626'); g.addColorStop(1, '#1b2b4a'); x.fillStyle = g; x.fillRect(0, 0, W, H);
    x.fillStyle = '#ffb000'; x.fillRect(0, 0, W, 10);
    x.fillStyle = '#9fb8d8'; x.font = '600 24px "Segoe UI", Arial, sans-serif'; x.fillText("KAW'S ATS · TRIP ALBUM", 48, 62);
    x.fillStyle = '#fff'; x.font = '900 52px "Segoe UI", Arial, sans-serif'; x.fillText(`${t.originCity || '?'} → ${t.destinationCity || '?'}`.slice(0, 40), 48, 128);
    x.font = '500 26px "Segoe UI", Arial, sans-serif'; x.fillStyle = '#cfe0f5';
    const when = t.endedAt ? new Date(t.endedAt).toLocaleDateString([], { year: 'numeric', month: 'short', day: 'numeric' }) : '';
    x.fillText([t.cargo, `${Math.round(t.milesDriven || 0)} mi`, hm(t.durationSeconds || 0), t.deliveredIncome ? `$${Math.round(t.deliveredIncome).toLocaleString('en-US')}` : '', when].filter(Boolean).join('  ·  '), 48, 172);
    // Route panel (simple map projection; speed colours as on the replay).
    const R = { x: 48, y: 210, w: 620, h: 720 };
    x.fillStyle = '#ffffff10'; x.fillRect(R.x, R.y, R.w, R.h);
    if (pts.length > 1) {
      const lons = pts.map(p => p[0]), lats = pts.map(p => p[1]);
      const [a, b, cMin, d] = [Math.min(...lons), Math.max(...lons), Math.min(...lats), Math.max(...lats)];
      const k = Math.min((R.w - 60) / Math.max(1e-6, (b - a) * Math.cos(((cMin + d) / 2) * Math.PI / 180)), (R.h - 60) / Math.max(1e-6, d - cMin));
      const px = p => [R.x + 30 + (p[0] - a) * Math.cos(((cMin + d) / 2) * Math.PI / 180) * k, R.y + R.h - 30 - (p[1] - cMin) * k];
      x.lineWidth = 6; x.lineCap = 'round';
      for (let i = 1; i < pts.length; i++) { const v = pts[i][3]; x.strokeStyle = !Number.isFinite(v) ? '#4aa3ff' : v > 70 ? '#e74c3c' : v > 60 ? '#f1c40f' : '#2ecc71'; x.beginPath(); x.moveTo(...px(pts[i - 1])); x.lineTo(...px(pts[i])); x.stroke(); }
      const dot = (p, col) => { const [u, v] = px(p); x.fillStyle = col; x.beginPath(); x.arc(u, v, 12, 0, 7); x.fill(); x.strokeStyle = '#111'; x.lineWidth = 3; x.stroke(); };
      dot(pts[0], '#2ecc71'); dot(pts.at(-1), '#e74c3c');
    } else { x.fillStyle = '#cfe0f5'; x.font = '500 24px "Segoe UI", Arial, sans-serif'; x.fillText('No route recorded for this trip', R.x + 30, R.y + 60); }
    // Screenshot grid.
    const G = { x: 700, y: 210, w: 852, h: 720 }, cols = imgs.length > 4 ? 3 : 2, rows = Math.max(1, Math.ceil(imgs.length / cols)), gap = 14;
    const cw = (G.w - gap * (cols - 1)) / cols, ch = Math.min((G.h - gap * (rows - 1)) / rows, cw * 9 / 16);
    if (!imgs.length) { x.fillStyle = '#ffffff10'; x.fillRect(G.x, G.y, G.w, G.h); x.fillStyle = '#cfe0f5'; x.font = '500 26px "Segoe UI", Arial, sans-serif'; x.fillText('No screenshots on this trip — press F10 in ATS next time!', G.x + 30, G.y + 60); }
    imgs.forEach((img, i) => {
      const cx = G.x + (i % cols) * (cw + gap), cy = G.y + Math.floor(i / cols) * (ch + gap);
      const s = Math.max(cw / img.width, ch / img.height), sw = cw / s, sh = ch / s;
      x.save(); x.beginPath(); x.roundRect(cx, cy, cw, ch, 12); x.clip();
      x.drawImage(img, (img.width - sw) / 2, (img.height - sh) / 2, sw, sh, cx, cy, cw, ch); x.restore();
    });
    x.fillStyle = '#9fb8d8'; x.font = '500 20px "Segoe UI", Arial, sans-serif'; x.fillText(`${data.driverName || 'Driver'} · KAW'S ATS PLAYGROUND Companion`, 48, H - 30);
    return c;
  }
  async function albumAction(kind) {
    const c = await makeAlbum();
    const blob = await new Promise(r => c.toBlob(r, 'image/png'));
    const name = `kaw-trip-${(data.trip.originCity || 'trip')}-${(data.trip.destinationCity || '')}.png`.replace(/[^\w.-]+/g, '-');
    if (kind === 'share' && navigator.canShare?.({ files: [new File([blob], name, { type: 'image/png' })] })) return navigator.share({ files: [new File([blob], name, { type: 'image/png' })], title: 'My ATS trip' });
    const a = document.createElement('a'), u = URL.createObjectURL(blob); a.href = u; a.download = name; a.click(); setTimeout(() => URL.revokeObjectURL(u), 2000);
  }
  window.KAWReplayAlbum = makeAlbum;   // used by the browser test harness

  async function loadTrip(id) {
    pause();
    const r = await fetch(`/api/stream/recap?trip=${encodeURIComponent(id || 'last')}`).then(x => x.json());
    if (r.ok === false) { q('#rvSummary').textContent = r.error; q('#rvTrip').innerHTML = '<option>No finished trips yet</option>'; return; }
    data = r;
    if (r.trips?.length && !q('#rvTrip').options.length) q('#rvTrip').innerHTML = r.trips.map(t => `<option value="${esc(t.id)}">${esc(t.label)}</option>`).join('');
    q('#rvTrip').value = r.trip.id;
    q('#rvRecap').href = `/recap.html?trip=${encodeURIComponent(r.trip.id)}&animate=1`;
    draw();
  }

  let ready = null;
  async function init() {
    await K.tileMap.loadLeaflet();
    let m = null; m = K.tileMap.createTileMap(q('#rvMap'), { onStyle: id => m.setStyle(id) }); m.setStyle('atsgame'); tm = m;
    try { shots = (await api('/api/journal?limit=500')).shots || []; } catch { shots = []; }
    q('#rvTrip').onchange = guard(() => loadTrip(q('#rvTrip').value));
    q('#rvPlay').onclick = () => (playing ? pause() : play());
    q('#rvStart').onclick = () => { pause(); idx = 0; data && stats(); };
    q('#rvAlbum').onclick = guard(() => albumAction('download'));
    q('#rvAlbumShare').onclick = guard(() => albumAction('share'));
    q('#rvSlider').oninput = () => { pause(); idx = +q('#rvSlider').value; data && stats(); };
    await loadTrip('last');
  }
  K.pages.push({ name: 'replay', icon: '⟲', label: 'Delivery Replay', group: 'Work', index: 2, html,
    load: () => { ready ||= init().catch(e => { ready = null; q('#rvSummary').textContent = e.message; }); return ready.then(() => tm?.map.invalidateSize()); } });
})();
