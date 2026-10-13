// OBS / streaming overlay. URL options:
//   ?w=speed,route,convoy,alerts,eco,map   widgets in order (default speed,route,alerts)
//   &pos=bl|br|tl|tr   corner (default bl)     &scale=1.2   size
//   &theme=dark|light  card style              &bg=green    chroma-key background instead of transparent
//   &layout=vertical   9:16 preset for TikTok / Shorts / Reels (Aitum Vertical)   pos also takes tc|bc
//   new widgets: minimap, events, poll, countdown, ticker (see Overlay 2.0 below)
(() => {
  const P = new URLSearchParams(location.search);
  const vertical = P.get('layout') === 'vertical';
  if (vertical) document.body.classList.add('vertical');
  const widgets = (P.get('w') || (vertical ? 'events,poll,route,speed,minimap' : 'speed,route,alerts')).split(',').map(s => s.trim()).filter(Boolean);
  const stack = document.getElementById('stack');
  stack.className = `stack pos-${['tl', 'tr', 'bl', 'br', 'tc', 'bc'].includes(P.get('pos')) ? P.get('pos') : vertical ? 'bc' : 'bl'}`;
  document.documentElement.style.setProperty('--scale', Math.max(0.5, Math.min(3, Number(P.get('scale')) || (vertical ? 1.35 : 1))));
  if (P.get('theme') === 'light') document.body.classList.add('theme-light');
  if (P.get('bg') === 'green') document.body.classList.add('bg-green');

  const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const fin = v => v !== null && v !== undefined && Number.isFinite(Number(v));
  const gt = min => { if (!fin(min)) return '—'; const m = Math.max(0, Math.round(min)); return m >= 60 ? `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, '0')}m` : `${m}m`; };
  const el = {};
  for (const w of widgets) { const d = document.createElement('div'); d.className = `card ${w}`; d.dataset.w = w; stack.append(d); el[w] = d; }

  function render(d) {
    const t = d.truck || {}, n = d.navigation || {}, j = d.job || {}, al = d.alerts || {};
    if (el.speed) {
      const limit = Number(n.speedLimitMph);
      el.speed.innerHTML = `<div class="speed ${al.overspeed?.active ? 'over' : ''}"><div><div class="v">${d.connected ? Math.round(t.speedMph || 0) : '—'}</div><div class="u">MPH</div></div>${limit > 5 ? `<div class="sign"><span>SPEED<br>LIMIT</span><b>${Math.round(limit / 5) * 5}</b></div>` : ''}<div class="gear">${esc(t.displayedGear ?? t.gear ?? '')}</div></div>`;
    }
    if (el.route) {
      el.route.classList.toggle('hidden', !j.active);
      if (j.active) el.route.innerHTML = `<div class="k">Hauling ${esc(j.cargo || 'cargo')}</div><div class="t">${esc(j.originCity || '?')} → ${esc(j.destinationCity || '?')}</div><div class="d">${fin(n.distanceMiles) ? `${n.distanceMiles.toFixed(0)} mi left` : ''}${fin(n.etaSeconds) ? ` · ETA ${gt(n.etaSeconds / 60)}` : ''}</div><div class="bar"><span style="width:${Math.max(0, Math.min(100, Number(n.progressPercent) || 0))}%"></span></div>`;
    }
    if (el.alerts) {
      const a = (al.active || []).find(x => x.severity === 'critical') || (al.active || [])[0];
      el.alerts.classList.toggle('hidden', !a);
      if (a) { el.alerts.className = `card alerts alert ${a.severity}`; el.alerts.innerHTML = `<div class="t">${esc(a.title)}</div><div class="d">${esc(a.detail)}</div>`; }
    }
    if (el.shift) {
      const s = d.shift;
      el.shift.classList.toggle('hidden', !s?.available);
      if (s?.available) {
        const col = s.action === 'UPSHIFT' ? 'var(--green)' : s.action === 'DOWNSHIFT' ? 'var(--yellow)' : 'var(--blue)';
        const arrow = s.action === 'UPSHIFT' ? '▲' : s.action === 'DOWNSHIFT' ? '▼' : '■';
        el.shift.innerHTML = `<div class="k">Gear</div><div style="display:flex;align-items:center;gap:12px"><div class="v" style="font-size:calc(40px*var(--scale));font-weight:800">${esc(s.displayedGear || s.gear || 'N')}</div><div style="color:${col};font-weight:800;font-size:calc(16px*var(--scale))">${arrow} ${esc(s.advice)}</div></div><div class="d" style="font-size:calc(12px*var(--scale));color:var(--muted)">${Math.round(s.rpm)} rpm · ${esc(s.bandLabel)} band</div>`;
      }
    }
    if (el.eco) {
      const e = d.trip?.eco;
      el.eco.classList.toggle('hidden', !e);
      if (e) el.eco.innerHTML = `<div class="k">Eco score</div><div class="v">${e.score}<span style="font-size:.5em;color:var(--muted)"> ${e.grade}</span></div>`;
    }
    if (el.convoy) {
      const roster = (d.convoy?.roster || []).filter(r => r.online);
      el.convoy.classList.toggle('hidden', roster.length < 2);
      el.convoy.innerHTML = `<div class="k">Convoy · ${roster.length} online</div>` + roster.slice(0, 8).map(r => `<div class="row"><span><span class="dot"></span>${esc(r.driverName)}${r.isLocal ? ' (me)' : ''}</span><b>${fin(r.truck?.speedMph) ? Math.round(r.truck.speedMph) + ' mph' : ''}</b></div>`).join('');
    }
  }

  // Mini convoy map (uses the hub data and the bundled geography).
  let geo = null, paths = null;
  const B = { minLon: -125.5, maxLon: -86.5, minLat: 25.2, maxLat: 49.6 }, W = 1000, H = 640;
  const proj = (lon, lat) => { const mid = (B.minLat + B.maxLat) / 2 * Math.PI / 180; const s = Math.min(W / ((B.maxLon - B.minLon) * Math.cos(mid)), H / (B.maxLat - B.minLat)); return [(lon - B.minLon) * Math.cos(mid) * s, (B.maxLat - lat) * s]; };
  async function renderMap() {
    if (!el.map) return;
    try {
      if (!geo) { geo = await (await fetch('/natural-earth-na.json')).json(); paths = geo.regions.filter(r => r.country === 'USA' && !['AK', 'HI'].includes(r.code)).map(r => ({ code: r.code, d: r.parts.map(ring => ring.map(([lo, la], i) => { const [x, y] = proj(lo, la); return `${i ? 'L' : 'M'}${x.toFixed(0)},${y.toFixed(0)}`; }).join('') + 'Z').join('') })); }
      const h = await (await fetch('/api/hub', { cache: 'no-store' })).json();
      const cov = Object.fromEntries((h.dlc?.coverage || []).map(c => [c.code, c]));
      const fill = c => !cov[c] ? 'rgba(255,255,255,.08)' : cov[c].everyone ? 'rgba(62,224,122,.55)' : cov[c].have?.length ? 'rgba(255,210,87,.45)' : 'rgba(74,163,255,.25)';
      const dots = (h.drivers || []).filter(d => d.online && d.location).map(d => { const [x, y] = proj(d.location.lon, d.location.lat); return `<circle cx="${x.toFixed(0)}" cy="${y.toFixed(0)}" r="${d.isLocal ? 10 : 8}" fill="${d.isLocal ? '#3ee07a' : '#4aa3ff'}" stroke="#fff" stroke-width="3"/><text x="${x.toFixed(0)}" y="${(y - 16).toFixed(0)}" text-anchor="middle">${esc(d.driverName)}</text>`; }).join('');
      el.map.innerHTML = `<svg viewBox="0 0 ${W} ${H}">${paths.map(p => `<path d="${p.d}" fill="${fill(p.code)}"/>`).join('')}${dots}</svg>`;
    } catch {}
  }

  async function poll() {
    try { render(await (await fetch('/api/telemetry', { cache: 'no-store' })).json()); } catch {}
  }
  // ---------- Overlay 2.0 widgets ----------
  // minimap  : real map / ATS game map with every convoy truck   (&map=atsgame|dark|satellite|road &zoom=9)
  // events   : pop-ups for deliveries, achievements, crashes, fuel stops, joins, viewer effects (&sound=0 to mute)
  // poll     : live viewer vote bars          countdown : next convoy          ticker : scrolling info line
  let latest = null;
  const mb = n => Math.round(Number(n) || 0).toLocaleString('en-US');

  // Minimap (Leaflet; the ATS game map look uses MapLibre + PMTiles served by the Companion).
  const mini = { map: null, me: null, mates: new Map(), ready: false };
  const loadJs = src => new Promise((ok, bad) => { const s = document.createElement('script'); s.src = src; s.onload = ok; s.onerror = bad; document.head.append(s); });
  const loadCss = href => { const l = document.createElement('link'); l.rel = 'stylesheet'; l.href = href; document.head.append(l); };
  const tile = service => `https://server.arcgisonline.com/ArcGIS/rest/services/${service}/MapServer/tile/{z}/{y}/{x}`;
  const MINI_STYLES = { dark: ['Canvas/World_Dark_Gray_Base', 'Canvas/World_Dark_Gray_Reference'], road: ['World_Street_Map'], satellite: ['World_Imagery', 'Reference/World_Transportation'], atsgame: ['Canvas/World_Dark_Gray_Base'] };
  const bearing = rot => (fin(rot) ? ((1 - Number(rot)) * 360 % 360 + 360) % 360 : 0);
  const truckHtml = (deg, me, label) => `<div class="mt ${me ? 'me' : ''}" style="transform:rotate(${deg}deg)"><svg viewBox="0 0 34 34" width="30" height="30"><circle cx="17" cy="17" r="12"/><path d="M17 5 L25 25 L17 20.5 L9 25 Z"/></svg></div>${label ? `<span class="ml">${esc(label)}</span>` : ''}`;
  async function initMini() {
    if (!el.minimap || mini.ready) return;
    mini.ready = true;
    el.minimap.innerHTML = '<div class="mm" id="mm"></div>';
    loadCss('/vendor/leaflet/leaflet.css');
    await loadJs('/vendor/leaflet/leaflet.js');
    const L = window.L;
    const styleId = MINI_STYLES[P.get('map')] ? P.get('map') : 'dark';
    mini.map = L.map('mm', { zoomControl: false, attributionControl: false, dragging: false, scrollWheelZoom: false, doubleClickZoom: false, boxZoom: false, keyboard: false, touchZoom: false }).setView([37, -115], Number(P.get('zoom')) || 9);
    for (const s of MINI_STYLES[styleId]) L.tileLayer(tile(s), { maxZoom: 16, crossOrigin: true }).addTo(mini.map);
    if (styleId === 'atsgame') {
      try {
        const st = await (await fetch('/api/atsmap')).json();
        if (st.installed) {
          loadCss('/vendor/maplibre/maplibre-gl.css');
          await loadJs('/vendor/maplibre/maplibre-gl.js'); await loadJs('/vendor/pmtiles/pmtiles.js'); await loadJs('/vendor/maplibre/leaflet-maplibre-gl.js');
          window.maplibregl.addProtocol('pmtiles', new window.pmtiles.Protocol().tile);
          const pane = mini.map.createPane('game'); pane.style.zIndex = 250;
          const is = t => ['==', ['get', 'type'], t];
          L.maplibreGL({ pane: 'game', interactive: false, attributionControl: false, style: { version: 8, glyphs: 'https://fonts.openmaptiles.org/{fontstack}/{range}.pbf', sources: { ats: { type: 'vector', url: `pmtiles://${location.origin}/maps/ats.pmtiles` } }, layers: [
            { id: 'r', type: 'line', source: 'ats', 'source-layer': 'ats', filter: ['all', is('road'), ['!=', ['get', 'hidden'], true]], layout: { 'line-cap': 'round' }, paint: { 'line-color': ['match', ['get', 'roadType'], 'freeway', '#ffb000', 'divided', '#ffcf5c', '#dfe8f0'], 'line-width': ['interpolate', ['linear'], ['zoom'], 5, 1, 12, 5] } },
            { id: 'c', type: 'symbol', source: 'ats', 'source-layer': 'ats', filter: is('city'), layout: { 'text-field': ['get', 'name'], 'text-font': ['Open Sans Bold'], 'text-size': 13 }, paint: { 'text-color': '#fff', 'text-halo-color': '#000', 'text-halo-width': 1.5 } }] } }).addTo(mini.map);
        }
      } catch {}
    }
  }
  function renderMini(d) {
    if (!mini.map || !d) return;
    const L = window.L;
    if (d.geo && fin(d.geo.lat)) {
      const ll = [d.geo.lat, d.geo.lon];
      const icon = L.divIcon({ className: 'mti', iconSize: [30, 30], iconAnchor: [15, 15], html: truckHtml(bearing(d.positioning?.rotationX), true, '') });
      if (!mini.me) mini.me = L.marker(ll, { icon }).addTo(mini.map); else { mini.me.setLatLng(ll); mini.me.setIcon(icon); }
      mini.map.panTo(ll, { animate: true, duration: 0.5 });
    }
    const seen = new Set();
    for (const m of d.mapMates || []) {
      seen.add(m.id);
      const icon = L.divIcon({ className: 'mti', iconSize: [30, 30], iconAnchor: [15, 15], html: truckHtml(bearing(m.rotationX), false, m.driverName) });
      const mk = mini.mates.get(m.id);
      if (mk) { mk.setLatLng([m.lat, m.lon]); mk.setIcon(icon); } else mini.mates.set(m.id, L.marker([m.lat, m.lon], { icon }).addTo(mini.map));
    }
    for (const [id, mk] of mini.mates) if (!seen.has(id)) { mini.map.removeLayer(mk); mini.mates.delete(id); }
  }

  // Sounds and confetti for viewer effects (OBS: tick "Control audio via OBS" to mix them).
  const sound = P.get('sound') !== '0';
  let ac = null;
  const audio = () => (ac ||= new (window.AudioContext || window.webkitAudioContext)());
  function horn() {
    if (!sound) return;
    try {
      const a = audio(), t = a.currentTime, g = a.createGain();
      g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(0.22, t + 0.04); g.gain.setValueAtTime(0.22, t + 1.05); g.gain.linearRampToValueAtTime(0, t + 1.35);
      g.connect(a.destination);
      for (const f of [185, 233, 277]) { const o = a.createOscillator(), lp = a.createBiquadFilter(); o.type = 'sawtooth'; o.frequency.value = f; lp.type = 'lowpass'; lp.frequency.value = 1500; o.connect(lp); lp.connect(g); o.start(t); o.stop(t + 1.4); }
    } catch {}
  }
  function chime(up = true) {
    if (!sound) return;
    try {
      const a = audio(), t = a.currentTime;
      [0, 0.12, 0.24].forEach((dt, i) => { const o = a.createOscillator(), g = a.createGain(); o.type = 'triangle'; o.frequency.value = (up ? [660, 880, 1175] : [440, 370, 311])[i]; g.gain.setValueAtTime(0.0001, t + dt); g.gain.exponentialRampToValueAtTime(0.18, t + dt + 0.02); g.gain.exponentialRampToValueAtTime(0.0001, t + dt + 0.35); o.connect(g); g.connect(a.destination); o.start(t + dt); o.stop(t + dt + 0.4); });
    } catch {}
  }
  function confetti() {
    const c = document.createElement('canvas');
    c.className = 'confetti'; c.width = innerWidth; c.height = innerHeight;
    document.body.append(c);
    const x = c.getContext('2d'), colors = ['#3ee07a', '#4aa3ff', '#ffd257', '#ff5d5d', '#c77dff', '#ffffff'];
    const parts = Array.from({ length: 180 }, () => ({ x: innerWidth / 2 + (Math.random() - 0.5) * innerWidth * 0.3, y: innerHeight * 0.35, vx: (Math.random() - 0.5) * 16, vy: -Math.random() * 16 - 6, r: Math.random() * 6 + 4, c: colors[Math.floor(Math.random() * colors.length)], a: Math.random() * 6 }));
    const t0 = performance.now();
    (function frame(now) {
      const dt = now - t0;
      x.clearRect(0, 0, c.width, c.height);
      for (const p of parts) { p.vy += 0.45; p.x += p.vx; p.y += p.vy; p.a += 0.2; x.save(); x.translate(p.x, p.y); x.rotate(p.a); x.fillStyle = p.c; x.globalAlpha = Math.max(0, 1 - dt / 3500); x.fillRect(-p.r / 2, -p.r / 4, p.r, p.r / 2); x.restore(); }
      if (dt < 3500) requestAnimationFrame(frame); else c.remove();
    })(t0);
  }

  // Event pop-ups from the Companion's Stream Hub (Server-Sent Events).
  const TONE = { delivery: 'good', achievement: 'gold', crash: 'bad', fuel: 'info', rest: 'info', convoyJoin: 'info', convoyStart: 'good', effect: 'fx', vote: 'info', job: 'info', cancelled: 'bad', stream: 'info', paused: 'info' };
  const queue = [];
  let showing = false;
  function showNext() {
    if (!el.events || showing || !queue.length) return;
    showing = true;
    const e = queue.shift();
    el.events.className = `card events pop ${TONE[e.type] || 'info'}`;
    el.events.innerHTML = `<div class="pi">${esc(e.icon)}</div><div><div class="pt">${esc(e.title)}</div>${e.detail ? `<div class="pd">${esc(e.detail)}</div>` : ''}</div>`;
    el.events.classList.remove('hidden');
    setTimeout(() => { el.events.classList.add('out'); setTimeout(() => { el.events.classList.add('hidden'); el.events.classList.remove('out'); showing = false; showNext(); }, 450); }, e.type === 'crash' ? 4500 : 6500);
  }
  const quiet = new Set((P.get('skip') || 'paused,stream').split(',').map(s => s.trim()));
  function onStreamEvent(e) {
    if (e.type === 'vote') {
      if (el.poll) refreshPoll(e.data);
      // Pop up when a vote opens or closes, not on every tally update.
      const show = e.data?.state === 'closed' || (e.data?.state === 'open' && String(e.detail).includes(')'));
      if (show && !quiet.has('vote')) queue.push(e);
    }
    else if (!quiet.has(e.type)) queue.push(e);
    if (e.type === 'effect' && e.data?.effect === 'horn') horn();
    if (e.type === 'effect' && e.data?.effect === 'confetti') confetti();
    if (e.type === 'delivery' || e.type === 'achievement') { chime(true); if (P.get('celebrate') !== '0') confetti(); }
    if (e.type === 'crash') chime(false);
    showNext();
  }
  if (el.events || el.poll) {
    if (el.events) el.events.classList.add('hidden');
    const es = new EventSource('/api/stream/events');
    let first = true;
    es.addEventListener('stream', m => { try { const e = JSON.parse(m.data); if (first && Date.now() - Date.parse(e.at) > 15000) return; onStreamEvent(e); } catch {} });
    es.onopen = () => { setTimeout(() => { first = false; }, 1500); };
  }

  // Live poll bars.
  async function refreshPoll(data) {
    if (!el.poll) return;
    let v = data?.poll ? data : null;
    if (!v) { try { v = await (await fetch('/api/stream/poll', { cache: 'no-store' })).json(); } catch { return; } }
    const pollData = v.poll, tally = v.tally || { counts: [], total: 0 };
    el.poll.classList.toggle('hidden', !pollData || v.state === 'closed');
    if (!pollData) return;
    const total = Math.max(1, tally.total || 0);
    const left = pollData.closesAt ? Math.max(0, Math.round((Date.parse(pollData.closesAt) - Date.now()) / 1000)) : null;
    el.poll.innerHTML = `<div class="k">Chat vote${left !== null ? ` · ${Math.floor(left / 60)}:${String(left % 60).padStart(2, '0')}` : ''}</div><div class="pq">${esc(pollData.question)}</div>` +
      pollData.options.map((o, i) => { const n = tally.counts?.[i] || 0; return `<div class="po"><div class="pl"><span>${i + 1}) ${esc(o)}</span><b>${n}</b></div><div class="bar"><span style="width:${Math.round(n / total * 100)}%"></span></div></div>`; }).join('') +
      `<div class="d" style="font-size:calc(12px*var(--scale));color:var(--muted);margin-top:4px">Type !vote 1-${pollData.options.length} in chat</div>`;
  }

  // Next convoy countdown.
  let nextEvent = null;
  async function refreshEvents() {
    if (!el.countdown && !el.ticker) return;
    try {
      const r = await (await fetch('/api/events', { cache: 'no-store' })).json();
      nextEvent = (r.events || []).filter(e => e.departureTime && Date.parse(e.departureTime) > Date.now() - 30 * 60000 && e.status !== 'cancelled' && e.status !== 'finished').sort((a, b) => Date.parse(a.departureTime) - Date.parse(b.departureTime))[0] || null;
    } catch {}
  }
  function renderCountdown() {
    if (!el.countdown) return;
    el.countdown.classList.toggle('hidden', !nextEvent);
    if (!nextEvent) return;
    const s = Math.round((Date.parse(nextEvent.departureTime) - Date.now()) / 1000);
    const txt = s <= 0 ? 'Rolling out now!' : `${s >= 86400 ? `${Math.floor(s / 86400)}d ` : ''}${String(Math.floor(s % 86400 / 3600)).padStart(2, '0')}:${String(Math.floor(s % 3600 / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
    el.countdown.innerHTML = `<div class="k">Next convoy</div><div class="ct">${esc(nextEvent.name || 'Convoy')}</div><div class="cv">${txt}</div>${nextEvent.meetPoint || nextEvent.destination ? `<div class="d" style="font-size:calc(13px*var(--scale));color:var(--muted)">${esc([nextEvent.meetPoint, nextEvent.destination].filter(Boolean).join(' → '))}</div>` : ''}`;
  }

  // Ticker: scrolling line with the route, truck, next convoy and chat commands.
  function renderTicker(d) {
    if (!el.ticker || !d) return;
    const j = d.job || {}, t = d.truck || {};
    const parts = [
      j.active ? `Hauling ${j.cargo || 'cargo'} ${j.originCity || ''} → ${j.destinationCity || ''}` : 'Between jobs',
      [t.make, t.model].filter(Boolean).join(' '),
      fin(d.navigation?.distanceMiles) && j.active ? `${mb(d.navigation.distanceMiles)} mi to go` : '',
      d.geo?.near ? `Near ${d.geo.near}${d.geo.nearState ? ', ' + d.geo.nearState : ''}` : '',
      nextEvent ? `Next convoy: ${nextEvent.name || 'Convoy'}` : '',
      P.get('cmds') !== '0' ? 'Chat: !eta !route !load !where !vote !horn' : ''
    ].filter(Boolean);
    const text = parts.join('   •   ');
    if (el.ticker.dataset.text === text) return;
    el.ticker.dataset.text = text;
    el.ticker.innerHTML = `<div class="tk"><span>${esc(text)}   •   </span><span>${esc(text)}   •   </span></div>`;
  }

  const baseRender = render;
  render = d => { latest = d; baseRender(d); renderMini(d); renderTicker(d); };
  initMini();
  refreshPoll(); refreshEvents();
  setInterval(refreshPoll, 5000);
  setInterval(refreshEvents, 30000);
  setInterval(renderCountdown, 1000);

  poll(); renderMap();
  setInterval(poll, 500);
  setInterval(renderMap, 5000);
  if (P.get('brand') !== '0') { const b = document.createElement('div'); b.className = 'brand'; b.textContent = "KAW'S ATS PLAYGROUND"; stack.append(b); }
})();
