/* KAW'S ATS Companion v1.6 — real tile maps for Navigation and the Convoy Hub.
   Drivers pick the look: road, night road, light road, satellite, satellite + roads or terrain,
   or keep one of the classic KAW views. Leaflet is bundled (public/vendor/leaflet) and only loaded
   when a tile style is picked; the tiles themselves need an internet connection.
   Registers with app-v16.js through window.KAW16. */
(() => {
  'use strict';
  const K = window.KAW16;
  if (!K) return;
  const { q, esc, fin } = K;

  // Keyless tile services only: drivers should never need an account or API key.
  const OSM = '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a> contributors';
  const ESRI = 'Tiles &copy; Esri';
  const esri = (service, credit = '', max = 18) => ({ url: `https://server.arcgisonline.com/ArcGIS/rest/services/${service}/MapServer/tile/{z}/{y}/{x}`, attr: `${ESRI}${credit ? ` — ${credit}` : ''}`, max });
  const STYLES = {
    // The game's own roads (vector tiles built from ATS files, downloaded once, served by the Companion)
    // drawn over a dark real-world canvas. See atsGameLayer() below.
    atsgame: { label: 'ATS game map', dark: true, game: true, layers: [esri('Canvas/World_Dark_Gray_Base', 'Esri, HERE, Garmin, OpenStreetMap contributors', 16)] },
    road: { label: 'Road map', dark: false, layers: [esri('World_Street_Map', 'Esri, HERE, Garmin, USGS, OpenStreetMap contributors')] },
    dark: { label: 'Night road map', dark: true, layers: [esri('Canvas/World_Dark_Gray_Base', 'Esri, HERE, Garmin, OpenStreetMap contributors', 16), esri('Canvas/World_Dark_Gray_Reference', '', 16)] },
    light: { label: 'Light road map', dark: false, layers: [esri('Canvas/World_Light_Gray_Base', 'Esri, HERE, Garmin, OpenStreetMap contributors', 16), esri('Canvas/World_Light_Gray_Reference', '', 16)] },
    satellite: { label: 'Satellite', dark: true, layers: [esri('World_Imagery', 'Esri, Maxar, Earthstar Geographics, GIS User Community')] },
    hybrid: { label: 'Satellite + roads', dark: true, layers: [esri('World_Imagery', 'Esri, Maxar, Earthstar Geographics, GIS User Community'), esri('Reference/World_Transportation'), esri('Reference/World_Boundaries_and_Places')] },
    natgeo: { label: 'National Geographic', dark: false, layers: [esri('NatGeo_World_Map', 'National Geographic, Esri, Garmin, HERE, UNEP-WCMC, USGS, NASA', 16)] },
    topo: { label: 'Topographic', dark: false, layers: [esri('World_Topo_Map', 'Esri, HERE, Garmin, USGS, OpenStreetMap contributors')] },
    terrain: { label: 'Terrain', dark: false, layers: [{ url: 'https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png', attr: `Map data: ${OSM}, SRTM | Style: &copy; <a href="https://opentopomap.org" target="_blank" rel="noopener">OpenTopoMap</a> (CC-BY-SA)`, sub: 'abc', max: 17 }] }
  };
  const isTile = id => Object.prototype.hasOwnProperty.call(STYLES, id);
  const NA_BOUNDS = [[25, -125], [49.5, -89]];

  // SCS heading: 0 = north, 0.25 = west, 0.5 = south, 0.75 = east (counter-clockwise). Convert to a compass bearing.
  const bearing = rot => (fin(rot) ? ((1 - Number(rot)) * 360 % 360 + 360) % 360 : null);
  K.bearing = bearing;

  // ---------- Leaflet (lazy) ----------
  let leafletPromise = null;
  function loadLeaflet() {
    if (window.L) return Promise.resolve(window.L);
    if (leafletPromise) return leafletPromise;
    leafletPromise = new Promise((resolve, reject) => {
      const css = document.createElement('link');
      css.rel = 'stylesheet';
      css.href = '/vendor/leaflet/leaflet.css';
      document.head.appendChild(css);
      const s = document.createElement('script');
      s.src = '/vendor/leaflet/leaflet.js';
      s.onload = () => resolve(window.L);
      s.onerror = () => { leafletPromise = null; reject(new Error('The map library did not load.')); };
      document.head.appendChild(s);
    });
    return leafletPromise;
  }

  // One Leaflet map with a swappable base style and an on-map style picker.
  function createTileMap(el, { onStyle, extraOptions = [] } = {}) {
    const L = window.L;
    const map = L.map(el, { zoomControl: true, attributionControl: true, worldCopyJump: false, minZoom: 3 });
    map.fitBounds(NA_BOUNDS);
    // The ATS game map draws above the base tiles and below routes/markers.
    const gamePane = map.createPane('kawGame');
    gamePane.style.zIndex = 250;
    gamePane.style.pointerEvents = 'none';
    let base = null, styleId = null, tileErrors = 0, tileOk = 0;
    const note = L.control({ position: 'bottomleft' });
    note.onAdd = () => { const d = L.DomUtil.create('div', 'kaw-map-note'); d.style.display = 'none'; return d; };
    note.addTo(map);
    const showNote = text => { const d = note.getContainer(); d.textContent = text || ''; d.style.display = text ? '' : 'none'; };

    const picker = L.control({ position: 'topright' });
    picker.onAdd = () => {
      const wrap = L.DomUtil.create('div', 'kaw-map-ctl');
      const opts = [...extraOptions, ...Object.entries(STYLES).map(([id, s]) => ({ id, label: s.label }))];
      wrap.innerHTML = `<label>Map style <select aria-label="Map style">${opts.map(o => `<option value="${esc(o.id)}">${esc(o.label)}</option>`).join('')}</select></label>`;
      L.DomEvent.disableClickPropagation(wrap);
      L.DomEvent.disableScrollPropagation(wrap);
      wrap.querySelector('select').addEventListener('change', e => onStyle?.(e.target.value));
      return wrap;
    };
    picker.addTo(map);

    function setStyle(id) {
      if (!isTile(id) || id === styleId) { syncPicker(id); return; }
      styleId = id;
      if (base) map.removeLayer(base);
      tileErrors = 0; tileOk = 0; showNote('');
      base = L.layerGroup(STYLES[id].layers.map(l => {
        const t = L.tileLayer(l.url, { attribution: l.attr, subdomains: l.sub || 'abc', maxZoom: l.max || 18, maxNativeZoom: l.max || 18, crossOrigin: true });
        t.on('tileerror', () => { tileErrors++; if (!tileOk && tileErrors > 6) showNote('Map tiles need an internet connection. Pick a Classic KAW view to drive offline.'); });
        t.on('tileload', () => { tileOk++; if (tileOk === 1) showNote(''); });
        return t;
      })).addTo(map);
      map.setMaxZoom(STYLES[id].game ? 18 : Math.max(...STYLES[id].layers.map(l => l.max || 18)));
      // Game tiles start at zoom 4 (MapLibre runs one level below Leaflet), so don't zoom out past 5.
      map.setMinZoom(STYLES[id].game ? 5 : 3);
      el.classList.toggle('kaw-map-dark', STYLES[id].dark);
      gamePanel(false);
      if (STYLES[id].game) {
        const group = base;
        atsGameLayer().then(layer => { if (styleId === id && base === group) { group.addLayer(layer); gamePanel(false); } })
          .catch(e => { if (styleId === id) gamePanel(true, e.status || null, e.message); });
      }
      syncPicker(id);
    }
    function syncPicker(id) { const s = picker.getContainer()?.querySelector('select'); if (s && s.value !== id) s.value = id; }

    // "Install the ATS game map" card, shown when the tiles are not downloaded yet.
    const cta = L.control({ position: 'topleft' });
    cta.onAdd = () => { const d = L.DomUtil.create('div', 'kaw-map-cta'); d.style.display = 'none'; L.DomEvent.disableClickPropagation(d); return d; };
    cta.addTo(map);
    let poll = null;
    function gamePanel(show, st = null, message = '') {
      const d = cta.getContainer();
      clearTimeout(poll);
      if (!show) { d.style.display = 'none'; return; }
      d.style.display = '';
      const mb = n => `${Math.round((n || 0) / 1048576)} MB`;
      if (st?.downloading) {
        const pct = st.totalBytes ? Math.round(st.receivedBytes / st.totalBytes * 100) : null;
        d.innerHTML = `<b>Downloading the ATS game map…</b><div class="kaw-cta-bar"><i style="width:${pct ?? 5}%"></i></div><span>${mb(st.receivedBytes)}${st.totalBytes ? ` of ${mb(st.totalBytes)}` : ''}</span>`;
        poll = setTimeout(() => refreshGame(), 1000);
        return;
      }
      const canInstall = ['127.0.0.1', 'localhost', '[::1]'].includes(location.hostname);
      d.innerHTML = `<b>ATS game map</b><span>The game's own roads, cities and DLC states. One-time download (about 10 MB), then it works offline.</span>${st?.error ? `<span class="err">${esc(st.error)}</span>` : message && !st ? `<span class="err">${esc(message)}</span>` : ''}${canInstall ? '<button type="button" class="cmd small">Download ATS game map</button>' : '<span>Install it from the PC running the Companion.</span>'}`;
      d.querySelector('button')?.addEventListener('click', async () => {
        d.querySelector('button').disabled = true;
        try { const r = await fetch('/api/atsmap', { method: 'POST' }); gamePanel(true, await r.json()); } catch (e) { gamePanel(true, null, e.message); }
      });
    }
    async function refreshGame() {
      if (!STYLES[styleId]?.game) return;
      const st = await fetch('/api/atsmap').then(r => r.json()).catch(() => null);
      if (st?.installed && !st.downloading) { const id = styleId; styleId = null; setStyle(id); return; }
      gamePanel(true, st);
    }
    return { map, setStyle, syncPicker, showNote, get styleId() { return styleId; } };
  }

  // ---------- ATS game map (MapLibre vector layer inside Leaflet) ----------
  const loadScript = src => new Promise((resolve, reject) => {
    if (document.querySelector(`script[src="${src}"]`)?.dataset.loaded) return resolve();
    const s = document.createElement('script');
    s.src = src;
    s.onload = () => { s.dataset.loaded = '1'; resolve(); };
    s.onerror = () => reject(new Error(`Could not load ${src}`));
    document.head.appendChild(s);
  });
  let gameLibs = null;
  function loadGameLibs() {
    if (gameLibs) return gameLibs;
    const css = document.createElement('link');
    css.rel = 'stylesheet'; css.href = '/vendor/maplibre/maplibre-gl.css';
    document.head.appendChild(css);
    gameLibs = loadScript('/vendor/maplibre/maplibre-gl.js')
      .then(() => loadScript('/vendor/pmtiles/pmtiles.js'))
      .then(() => loadScript('/vendor/maplibre/leaflet-maplibre-gl.js'))
      .then(() => { window.maplibregl.addProtocol('pmtiles', new window.pmtiles.Protocol().tile); })
      .catch(e => { gameLibs = null; throw e; });
    return gameLibs;
  }

  // Our own style for the tiles built by .github/workflows/ats-map.yml (one layer, "ats"; features
  // carry a `type`: mapArea, prefab, road, ferry, train, city, poi, ...).
  function atsGameStyle() {
    const is = t => ['==', ['get', 'type'], t];
    const zoomWidth = (a, b, c) => ['interpolate', ['exponential', 1.6], ['zoom'], 5, a, 9, b, 13, c];
    return {
      version: 8,
      glyphs: 'https://fonts.openmaptiles.org/{fontstack}/{range}.pbf',
      sources: { ats: { type: 'vector', url: `pmtiles://${location.origin}/maps/ats.pmtiles`, attribution: 'Map data from American Truck Simulator © SCS Software' } },
      layers: [
        { id: 'ats-area', type: 'fill', source: 'ats', 'source-layer': 'ats', filter: ['all', is('mapArea'), ['!=', ['get', 'hidden'], true]], paint: { 'fill-color': ['match', ['get', 'color'], 0, '#34495c', 1, '#3f566b', 2, '#26394a', 3, '#284a3a', 4, '#3a3a52', 5, '#4a3f33', 6, '#1f4a5c', 7, '#4a2f3a', '#34495c'], 'fill-opacity': 0.75 } },
        { id: 'ats-prefab', type: 'fill', source: 'ats', 'source-layer': 'ats', filter: is('prefab'), paint: { 'fill-color': '#8aa3b8' } },
        { id: 'ats-ferry', type: 'line', source: 'ats', 'source-layer': 'ats', filter: is('ferry'), paint: { 'line-color': '#27d7ff', 'line-width': 1.5, 'line-dasharray': [3, 3] } },
        { id: 'ats-rail', type: 'line', source: 'ats', 'source-layer': 'ats', filter: ['any', is('train'), ['==', ['get', 'roadType'], 'train']], minzoom: 8, paint: { 'line-color': '#6b7c8c', 'line-width': 1, 'line-dasharray': [4, 2] } },
        { id: 'ats-road-case', type: 'line', source: 'ats', 'source-layer': 'ats', filter: ['all', is('road'), ['!=', ['get', 'roadType'], 'train'], ['!=', ['get', 'hidden'], true]], layout: { 'line-cap': 'round', 'line-join': 'round' }, paint: { 'line-color': '#05121c', 'line-width': zoomWidth(1.6, 4, 14) } },
        { id: 'ats-road', type: 'line', source: 'ats', 'source-layer': 'ats', filter: ['all', is('road'), ['!=', ['get', 'roadType'], 'train'], ['!=', ['get', 'hidden'], true]], layout: { 'line-cap': 'round', 'line-join': 'round' }, paint: { 'line-color': ['match', ['get', 'roadType'], 'freeway', '#ffb000', 'divided', '#ffcf5c', 'local', '#c9d6e2', '#e3ecf4'], 'line-width': zoomWidth(0.8, 2.4, 10) } },
        { id: 'ats-city', type: 'symbol', source: 'ats', 'source-layer': 'ats', filter: is('city'), layout: { 'text-field': ['get', 'name'], 'text-font': ['Open Sans Bold'], 'text-size': ['interpolate', ['linear'], ['zoom'], 5, 11, 10, 16], 'text-allow-overlap': false }, paint: { 'text-color': '#ffffff', 'text-halo-color': '#02111c', 'text-halo-width': 1.6 } }
      ]
    };
  }

  let gameStatusCache = null;
  async function atsGameLayer() {
    const st = await fetch('/api/atsmap').then(r => r.json());
    gameStatusCache = st;
    if (!st.installed || st.downloading) { const e = new Error(st.error || 'The ATS game map is not installed yet.'); e.status = st; throw e; }
    await loadGameLibs();
    return window.L.maplibreGL({ style: atsGameStyle(), interactive: false, attributionControl: { customAttribution: 'Map data from American Truck Simulator &copy; SCS Software' }, pane: 'kawGame' });
  }

  const truckIcon = (deg, me = true, label = '') => window.L.divIcon({
    className: 'kaw-truck-icon',
    iconSize: [34, 34],
    iconAnchor: [17, 17],
    html: `<div class="kaw-truck ${me ? 'me' : 'mate'}" style="transform:rotate(${fin(deg) ? deg : 0}deg)"><svg viewBox="0 0 34 34" width="34" height="34"><circle cx="17" cy="17" r="12" class="ring"/>${fin(deg) ? '<path d="M17 5 L25 25 L17 20.5 L9 25 Z" class="arrow"/>' : '<circle cx="17" cy="17" r="5" class="arrow"/>'}</svg></div>${label ? `<span class="kaw-truck-label">${esc(label)}</span>` : ''}`
  });
  const pin = (cls, text) => window.L.divIcon({ className: 'kaw-pin-icon', iconSize: [14, 14], iconAnchor: [7, 7], html: `<div class="kaw-pin ${cls}"></div><span class="kaw-pin-label">${esc(text)}</span>` });

  // Page globals from index.html (classic script) — guarded so the module never breaks the dashboard.
  const prefsObj = () => (typeof prefs !== 'undefined' ? prefs : null);
  const save = () => { try { if (typeof savePrefs === 'function') savePrefs(); } catch {} };
  const city = name => { try { return typeof findMapCity === 'function' ? findMapCity(name) : null; } catch { return null; } };
  const progressOf = d => { try { return typeof liveRouteProgress === 'function' ? liveRouteProgress(d) : Math.max(0, Math.min(1, Number(d?.navigation?.progressPercent || 0) / 100)); } catch { return 0; } };

  // ---------- Navigation page ----------
  const NAV = { el: null, tm: null, layers: null, me: null, trail: [], trailLine: null, routeKey: '', userMoved: false, framedOnce: false, lastPage: null, loading: false, mates: new Map() };

  function navElements() {
    const canvas = q('#routeCanvas');
    if (!canvas) return {};
    if (!NAV.el) {
      NAV.el = document.createElement('div');
      NAV.el.id = 'kawNavMap';
      NAV.el.className = 'kaw-tilemap';
      NAV.el.style.display = 'none';
      canvas.insertAdjacentElement('afterend', NAV.el);
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.id = 'kawNavRecenter';
      btn.className = 'cmd small kaw-recenter';
      btn.textContent = '⌖ Recenter on my truck';
      btn.style.display = 'none';
      btn.onclick = () => { NAV.userMoved = false; btn.style.display = 'none'; navUpdate(K.telem(), true); };
      NAV.el.insertAdjacentElement('afterend', btn);
    }
    return { canvas, el: NAV.el, recenter: q('#kawNavRecenter') };
  }

  function setNavStyle(id) {
    const p = prefsObj();
    if (!p) return;
    p.navMapStyle = id;
    save();
    const sel = q('#navMapStyle');
    if (sel && sel.value !== id) sel.value = id;
    navToggle();
  }

  function navToggle() {
    const p = prefsObj();
    const { canvas, el } = navElements();
    if (!p || !canvas) return;
    const tile = isTile(p.navMapStyle);
    syncNavToolbar(p.navMapStyle);
    canvas.style.display = tile ? 'none' : '';
    el.style.display = tile ? '' : 'none';
    if (!tile) { q('#kawNavRecenter').style.display = 'none'; try { if (typeof drawRouteTrace === 'function') drawRouteTrace(K.telem()?.positioning || {}, K.telem()); } catch {} return; }
    if (NAV.loading) return;
    NAV.loading = true;
    loadLeaflet().then(() => {
      NAV.loading = false;
      if (!NAV.tm) {
        NAV.tm = createTileMap(el, { onStyle: setNavStyle, extraOptions: [{ id: 'geographic', label: 'Classic KAW map' }] });
        NAV.layers = window.L.layerGroup().addTo(NAV.tm.map);
        // Stop auto-framing once the driver pans or zooms by hand; "Recenter" turns it back on.
        const moved = () => { if (NAV.framing) return; NAV.userMoved = true; const b = q('#kawNavRecenter'); if (b) b.style.display = ''; };
        NAV.tm.map.on('dragstart', moved);
        el.addEventListener('wheel', moved, { passive: true });
        el.addEventListener('touchstart', e => { if (e.touches.length > 1) moved(); }, { passive: true });
        el.querySelector('.leaflet-control-zoom')?.addEventListener('click', moved);
      }
      NAV.tm.setStyle(p.navMapStyle);
      setTimeout(() => { NAV.tm.map.invalidateSize(); navUpdate(K.telem(), true); }, 30);
    }).catch(e => {
      NAV.loading = false;
      canvas.style.display = ''; el.style.display = 'none';
      const s = q('#mapAccuracy'); if (s) s.textContent = `${e.message} Showing the classic map.`;
    });
  }

  function frame(map, fn) { NAV.framing = true; try { fn(); } finally { setTimeout(() => { NAV.framing = false; }, 400); } }

  function navUpdate(d, force = false) {
    const p = prefsObj();
    if (!NAV.tm || !p || !isTile(p.navMapStyle) || !d) return;
    const L = window.L, map = NAV.tm.map;
    const origin = city(d.job?.originCity), dest = city(d.job?.destinationCity);
    const routeKey = [d.job?.originCity, d.job?.destinationCity].join('|');
    let me = null, exact = false;
    if (d.geo && fin(d.geo.lat) && fin(d.geo.lon)) { me = [d.geo.lat, d.geo.lon]; exact = true; }
    else if (origin && dest) { const t = progressOf(d); me = [origin.lat + (dest.lat - origin.lat) * t, origin.lon + (dest.lon - origin.lon) * t]; }
    const deg = bearing(d.positioning?.rotationX);

    // Route + endpoints (redrawn only when the job changes).
    if (routeKey !== NAV.routeKey) {
      NAV.routeKey = routeKey;
      NAV.layers.clearLayers();
      NAV.framedOnce = false;
      if (origin && dest) {
        L.polyline([[origin.lat, origin.lon], [dest.lat, dest.lon]], { color: '#ffb000', weight: 4, opacity: 0.85, dashArray: '8 10' }).addTo(NAV.layers);
        L.marker([origin.lat, origin.lon], { icon: pin('from', d.job.originCity), keyboard: false }).addTo(NAV.layers);
        L.marker([dest.lat, dest.lon], { icon: pin('to', d.job.destinationCity), keyboard: false }).addTo(NAV.layers);
      }
    }

    // My trail (only from calibrated positions — estimates would draw a straight line anyway).
    if (exact) {
      const last = NAV.trail.at(-1);
      if (!last || Math.hypot(last[0] - me[0], last[1] - me[1]) > 0.004) { NAV.trail.push(me); if (NAV.trail.length > 1500) NAV.trail.shift(); }
      if (!NAV.trailLine) NAV.trailLine = L.polyline(NAV.trail, { color: '#27d7ff', weight: 4, opacity: 0.9 }).addTo(map);
      else NAV.trailLine.setLatLngs(NAV.trail);
    }

    // My truck.
    if (me) {
      const icon = truckIcon(deg, true);
      if (!NAV.me) NAV.me = L.marker(me, { icon, zIndexOffset: 1000, keyboard: false }).addTo(map);
      else { NAV.me.setLatLng(me); NAV.me.setIcon(icon); }
      NAV.me.getElement()?.classList.toggle('estimated', !exact);
    } else if (NAV.me) { map.removeLayer(NAV.me); NAV.me = null; }

    // Convoy mates.
    const seen = new Set();
    for (const m of d.mapMates || []) {
      seen.add(m.id);
      const icon = truckIcon(bearing(m.rotationX), false, m.driverName);
      const existing = NAV.mates.get(m.id);
      if (existing) { existing.setLatLng([m.lat, m.lon]); existing.setIcon(icon); }
      else NAV.mates.set(m.id, L.marker([m.lat, m.lon], { icon, keyboard: false, title: m.driverName }).addTo(map));
    }
    for (const [id, marker] of NAV.mates) if (!seen.has(id)) { map.removeLayer(marker); NAV.mates.delete(id); }

    // Convoy line (driving order, gap colours) and the shared regroup point.
    const tg = d.together || {};
    const COLORS = { green: '#3ee07a', yellow: '#ffca3a', red: '#ff5f57', leader: '#27d7ff' };
    NAV.lineLayer ||= L.layerGroup().addTo(map);
    NAV.lineLayer.clearLayers();
    const line = Array.isArray(tg.line) ? tg.line : [];
    for (let i = 1; i < line.length; i++) {
      L.polyline([[line[i - 1].lat, line[i - 1].lon], [line[i].lat, line[i].lon]], { color: COLORS[line[i].color] || '#ffffff', weight: 5, opacity: 0.85, dashArray: line[i].color === 'red' ? '6 8' : null })
        .bindTooltip(`${esc(line[i].driverName)}: ${line[i].gapMiles ?? '?'} mi behind ${esc(line[i - 1].driverName)}`, { sticky: true }).addTo(NAV.lineLayer);
    }
    if (tg.regroup && fin(tg.regroup.lat) && fin(tg.regroup.lon)) {
      L.marker([tg.regroup.lat, tg.regroup.lon], { icon: pin('to', `Regroup: ${tg.regroup.name}`), keyboard: false, zIndexOffset: 900 })
        .bindTooltip(`Regroup: ${esc(tg.regroup.name)}${tg.regroup.by ? ` (set by ${esc(tg.regroup.by)})` : ''}${tg.regroup.miles != null ? ` · ${tg.regroup.miles} mi` : ''}`).addTo(NAV.lineLayer);
    }

    // Framing: follow the truck, fit the route, or show North America — until the driver pans the map.
    if (!NAV.userMoved) {
      const mode = p.navMapFrame || 'route';
      frame(map, () => {
        if (mode === 'follow' && me) map.setView(me, Math.max(map.getZoom(), 10), { animate: !force });
        else if (mode === 'convoy') {
          const pts = [me, ...(d.mapMates || []).map(m => [m.lat, m.lon])].filter(Boolean);
          if (pts.length > 1 && (force || !NAV.convoyFitAt || Date.now() - NAV.convoyFitAt > 8000)) { NAV.convoyFitAt = Date.now(); map.fitBounds(pts, { padding: [50, 50], maxZoom: 12 }); }
          else if (pts.length === 1) map.setView(pts[0], Math.max(map.getZoom(), 10), { animate: !force });
        } else if (mode === 'leader') {
          const lead = line.find(x => x.isLeader);
          const at = lead ? [lead.lat, lead.lon] : me;
          if (at) map.setView(at, Math.max(map.getZoom(), 10), { animate: !force });
        }
        else if (mode === 'region') { if (!NAV.framedOnce || force) map.fitBounds(NA_BOUNDS); }
        else if (!NAV.framedOnce || force) {
          const pts = [origin && [origin.lat, origin.lon], dest && [dest.lat, dest.lon], me].filter(Boolean);
          if (pts.length > 1) map.fitBounds(pts, { padding: [40, 40], maxZoom: 11 });
          else if (pts.length) map.setView(pts[0], 9);
          else map.fitBounds(NA_BOUNDS);
        } else if (me && !map.getBounds().pad(-0.1).contains(me)) map.panTo(me);
      });
      NAV.framedOnce = true;
    }

    const s = q('#mapAccuracy');
    if (s) {
      const ms = d.mapStatus || {};
      s.textContent = !d.connected ? `${STYLES[p.navMapStyle].label} • waiting for ATS`
        : exact ? `${STYLES[p.navMapStyle].label} • live GPS position${d.geo.exact ? '' : ` • ±${d.geo.accuracyMiles ?? ms.errorMiles ?? '?'} mi`}${d.geo.near ? ` • near ${d.geo.near}` : ''}`
        : `${STYLES[p.navMapStyle].label} • estimated along the route (no position from ATS yet)`;
    }
  }

  // Skip drawing the hidden classic canvas while a tile style is active.
  function wrapClassicDraw() {
    if (typeof drawRouteTrace !== 'function' || drawRouteTrace.__kawMap) return;
    const original = drawRouteTrace;
    const wrapped = function (pos, d) { const p = prefsObj(); if (p && isTile(p.navMapStyle)) return; return original.apply(this, arguments); };
    wrapped.__kawMap = true;
    window.drawRouteTrace = wrapped;
  }

  function upgradeStyleSelect() {
    const sel = q('#navMapStyle');
    if (!sel || sel.dataset.kawMap) return;
    sel.dataset.kawMap = '1';
    const classic = [...sel.options].map(o => `<option value="${esc(o.value)}">${esc(o.textContent)}</option>`).join('');
    sel.innerHTML = `<optgroup label="Real maps">${Object.entries(STYLES).map(([id, s]) => `<option value="${id}">${esc(s.label)}</option>`).join('')}</optgroup><optgroup label="Classic KAW">${classic}</optgroup>`;
    const p = prefsObj();
    // v1.6: real maps become the default once; drivers who picked a classic view other than the old default keep it.
    if (p && !p.mapStyleV2) { if (!p.navMapStyle || p.navMapStyle === 'geographic') p.navMapStyle = 'road'; p.mapStyleV2 = 1; save(); }
    if (p) sel.value = p.navMapStyle;
    addNavToolbar(sel);
    sel.addEventListener('change', () => { navToggle(); });
    const frameSel = q('#navMapFrame');
    frameSel?.addEventListener('change', () => { NAV.userMoved = false; const b = q('#kawNavRecenter'); if (b) b.style.display = 'none'; navUpdate(K.telem(), true); });
  }
  function addNavToolbar(original) {
    const canvas = q('#routeCanvas');
    if (!canvas || q('#kawMapToolbar')) return;
    const bar = document.createElement('div'); bar.id = 'kawMapToolbar'; bar.className = 'kaw-map-toolbar';
    bar.innerHTML = `<div class="kaw-map-toolbar-main"><label for="kawMapStyleAlways"><b>Map style</b></label><select id="kawMapStyleAlways" class="v16-input">${original.innerHTML}</select><button type="button" class="cmd small" id="kawMapReset">Reset to Road map</button><button type="button" class="cmd small" id="kawMapVoice">Voice &amp; speed warnings</button></div><div class="kaw-map-style-chips">${[['road','Road'],['dark','Night'],['satellite','Satellite'],['atsgame','ATS map'],['geographic','Classic / offline']].map(([id, name]) => `<button type="button" class="cmd small" data-map-style="${id}">${name}</button>`).join('')}</div><div class="v16-note">Change the look here any time. Road, satellite and terrain tiles need Internet; the ATS map needs its one-time download.</div>`;
    canvas.insertAdjacentElement('beforebegin', bar);
    q('#kawMapStyleAlways').onchange = e => setNavStyle(e.target.value);
    q('#kawMapReset').onclick = () => setNavStyle('road');
    q('#kawMapVoice').onclick = () => K.go('codriver');
    bar.querySelectorAll('[data-map-style]').forEach(button => { button.onclick = () => setNavStyle(button.dataset.mapStyle); });
    syncNavToolbar(prefsObj()?.navMapStyle || 'road');
  }
  function syncNavToolbar(id) {
    const select = q('#kawMapStyleAlways'); if (select) select.value = id;
    document.querySelectorAll('#kawMapToolbar [data-map-style]').forEach(b => { b.setAttribute('aria-pressed', String(b.dataset.mapStyle === id)); b.classList.toggle('primary', b.dataset.mapStyle === id); });
  }

  // ---------- Convoy Hub ----------
  const HUB = { el: null, tm: null, states: null, dots: null, trails: null, last: null, lastTrails: [], framed: false };
  const HUB_COLORS = { everyone: '#2ecc71', some: '#f1c40f', none: '#e74c3c', unknown: '#3498db' };
  const hubStyle = () => { try { return localStorage.getItem('kawHubMap') || 'coverage'; } catch { return 'coverage'; } };

  function hubElements() {
    const svg = q('#hubMap');
    if (!svg) return {};
    if (!HUB.el) {
      HUB.el = document.createElement('div');
      HUB.el.id = 'kawHubTileMap';
      HUB.el.className = 'kaw-tilemap hub';
      HUB.el.style.display = 'none';
      svg.insertAdjacentElement('afterend', HUB.el);
      const head = q('#hubMapNote');
      if (head && !q('#hubMapStyle')) {
        const sel = document.createElement('select');
        sel.id = 'hubMapStyle';
        sel.className = 'kaw-inline-select';
        sel.setAttribute('aria-label', 'Convoy map style');
        sel.innerHTML = `<option value="coverage">DLC coverage map</option>${Object.entries(STYLES).map(([id, s]) => `<option value="${id}">${esc(s.label)}</option>`).join('')}`;
        sel.value = hubStyle();
        sel.onchange = () => setHubStyle(sel.value);
        const bar = document.createElement('div'); bar.className = 'kaw-map-toolbar kaw-map-toolbar-main';
        const label = document.createElement('label'); label.htmlFor = sel.id; label.textContent = 'Convoy map style';
        const reset = document.createElement('button'); reset.type = 'button'; reset.className = 'cmd small'; reset.textContent = 'Reset to DLC coverage'; reset.onclick = () => setHubStyle('coverage');
        bar.append(label, sel, reset); head.insertAdjacentElement('beforebegin', bar);
      }
    }
    return { svg, el: HUB.el };
  }

  function setHubStyle(id) {
    try { localStorage.setItem('kawHubMap', id); } catch {}
    const sel = q('#hubMapStyle'); if (sel && sel.value !== id) sel.value = id;
    hubToggle();
  }

  function hubToggle() {
    const { svg, el } = hubElements();
    if (!svg) return;
    const id = hubStyle(), tile = isTile(id);
    svg.style.display = tile ? 'none' : '';
    el.style.display = tile ? '' : 'none';
    if (!tile) return;
    loadLeaflet().then(() => {
      if (!HUB.tm) {
        HUB.tm = createTileMap(el, { onStyle: setHubStyle, extraOptions: [{ id: 'coverage', label: 'DLC coverage map' }] });
        HUB.states = window.L.layerGroup().addTo(HUB.tm.map);
        HUB.trails = window.L.layerGroup().addTo(HUB.tm.map);
        HUB.dots = window.L.layerGroup().addTo(HUB.tm.map);
      }
      HUB.tm.setStyle(id);
      setTimeout(() => { HUB.tm.map.invalidateSize(); if (HUB.last) hubRender(HUB.last, HUB.lastTrails); }, 30);
    }).catch(() => setHubStyle('coverage'));
  }

  // Called by app-hub.js after every hub refresh.
  function hubRender(h, trails = []) {
    HUB.last = h; HUB.lastTrails = trails || [];
    if (!HUB.el) hubToggle();
    if (!HUB.tm || !isTile(hubStyle()) || !h) return;
    const L = window.L;
    const cov = Object.fromEntries((h.dlc?.coverage || []).map(c => [c.code, c]));
    const regions = window.KAW16?.map?.geoRegions?.() || [];
    HUB.states.clearLayers();
    for (const r of regions) {
      if (r.country !== 'USA') continue;
      const c = cov[r.code];
      if (!c) continue;
      const color = !h.dlc.knownDrivers ? HUB_COLORS.unknown : c.everyone ? HUB_COLORS.everyone : c.have.length ? HUB_COLORS.some : HUB_COLORS.none;
      const rings = (r.parts || []).map(ring => ring.map(([lon, lat]) => [lat, lon]));
      L.polygon(rings, { color, weight: 1, opacity: 0.7, fillColor: color, fillOpacity: 0.22, interactive: true })
        .bindTooltip(`${esc(r.name)} — ${c.everyone ? 'everyone can drive' : c.have.length ? `${c.have.length} of ${h.dlc.knownDrivers} drivers` : h.dlc.knownDrivers ? 'nobody owns it yet' : 'ATS state'}`, { sticky: true })
        .addTo(HUB.states);
    }
    HUB.trails.clearLayers();
    for (const t of HUB.lastTrails) L.polyline((t.points || []).map(([lon, lat]) => [lat, lon]), { color: t.isLocal ? '#27d7ff' : '#ffca3a', weight: 3, opacity: 0.8 }).bindTooltip(`${esc(t.driverName)} — last 45 min`).addTo(HUB.trails);
    HUB.dots.clearLayers();
    const pts = [];
    for (const d of (h.drivers || []).filter(x => x.online && x.location)) {
      const ll = [d.location.lat, d.location.lon];
      pts.push(ll);
      L.marker(ll, { icon: truckIcon(null, d.isLocal, d.driverName), zIndexOffset: d.isLocal ? 1000 : 0, keyboard: false })
        .bindTooltip(`${esc(d.driverName)} — near ${esc(d.location.near || '?')}${d.location.nearState ? ', ' + esc(d.location.nearState) : ''}${d.speedMph != null ? ` · ${Math.round(d.speedMph)} mph` : ''}`)
        .addTo(HUB.dots);
    }
    if (!HUB.framed) { HUB.framed = true; if (pts.length > 1) HUB.tm.map.fitBounds(pts, { padding: [50, 50], maxZoom: 9 }); else if (pts.length) HUB.tm.map.setView(pts[0], 8); else HUB.tm.map.fitBounds(NA_BOUNDS); }
  }

  K.tileMap = { STYLES, isTile, loadLeaflet, createTileMap, hub: hubRender, setNavStyle, setHubStyle };

  K.onReady.push(() => {
    wrapClassicDraw();
    upgradeStyleSelect();
    navToggle();
  });
  K.onTick.push((d, page) => {
    if (page !== NAV.lastPage) {
      NAV.lastPage = page;
      if (page === 'navigation' && NAV.tm) setTimeout(() => { NAV.tm.map.invalidateSize(); navUpdate(K.telem(), true); }, 60);
      if (page === 'hub') setTimeout(() => { hubToggle(); HUB.tm?.map.invalidateSize(); }, 60);
    }
    if (page === 'navigation') navUpdate(d);
  });
})();
