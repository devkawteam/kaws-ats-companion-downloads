// KAW Livery Wizard: design an ATS paint job and build the mod on this PC. Author: Kaw.
// Free and local: drawing, DDS encoding and ZIP packing all happen in the browser. The optional
// AI design helper uses the driver's own local AI (Ollama). If a Stable Diffusion WebUI happens to run on
// this PC, an extra image option appears; otherwise it stays hidden.
(() => {
  const K = window.KAW16, R = window.KAWLiveryRender; if (!K || !R) return;
  const { q, api, esc, guard, notify } = K;
  const STORE = 'kawLiveryProject';
  const SIZES = [[4096, 4096], [4096, 2048], [2048, 2048], [2048, 1024], [8192, 1024], [8192, 2048], [1024, 1024]];
  const PREVIEW = 1024;
  let cat = [], P = null, cur = { vehicle: '', part: '' }, sel = '', saveWarned = false, built = null, sdReady = false, local = true;
  const templates = new Map(), images = new Map();

  const newProject = () => ({ name: 'KAW Paint Job', author: 'Kaw', version: '1.0', description: '', price: 5000, unlock: 0, baseColor: '#ffffff', baseColorUnlocked: false, vehicles: ['peterbilt.579'], designs: {} });
  const vehicle = p => cat.find(v => v.path === p);
  const keyOf = (v = cur.vehicle, part = cur.part) => `${v}|${part}`;
  function partsOf(v) {
    if (!v) return [];
    const main = v.separate && v.cabins?.length ? v.cabins.map(c => ({ key: `cabin:${c.code}`, label: `Cabin: ${c.name}` })) : [{ key: 'main', label: v.type === 'truck' ? 'Truck body' : 'Trailer body' }];
    return [...main, ...Object.keys(v.accessories || {}).map(g => ({ key: `acc:${g}`, label: `Part: ${g}` }))];
  }
  const defaultSize = v => (v?.type === 'trailer_owned' ? [4096, 2048] : [4096, 4096]);
  function design(k = keyOf()) {
    if (!P.designs[k]) {
      const [w, h] = defaultSize(vehicle(k.split('|')[0]));
      P.designs[k] = { w, h, layers: [] };
    }
    return P.designs[k];
  }
  const layer = () => design().layers.find(l => l.id === sel);
  const painted = d => d?.layers?.some(l => l.visible && l.opacity > 0);

  // ------------------------------------------------------------ storage (this browser only)
  function save() {
    try { localStorage.setItem(STORE, JSON.stringify(P)); }
    catch { if (!saveWarned) { saveWarned = true; notify('Autosave is full', 'Big logos do not fit in browser storage. Use “Save project file” to keep your work.', 'leave'); } }
  }
  function cleanProject(raw) {
    const p = { ...newProject(), ...(raw && typeof raw === 'object' ? raw : {}) };
    for (const k of ['name', 'author', 'version', 'description']) p[k] = String(p[k] ?? '').slice(0, k === 'description' ? 500 : 60);
    p.price = Math.max(0, Math.min(10000000, Math.round(Number(p.price) || 0)));
    p.unlock = Math.max(0, Math.min(100, Math.round(Number(p.unlock) || 0)));
    p.baseColor = /^#[0-9a-f]{6}$/i.test(p.baseColor) ? p.baseColor : '#ffffff';
    p.baseColorUnlocked = p.baseColorUnlocked === true;
    p.vehicles = (Array.isArray(p.vehicles) ? p.vehicles : []).filter(x => vehicle(x));
    const designs = {};
    for (const [k, d] of Object.entries(p.designs || {})) {
      const [vp, part] = k.split('|');
      if (!vehicle(vp) || !partsOf(vehicle(vp)).some(x => x.key === part)) continue;
      const size = SIZES.find(([w, h]) => w === d.w && h === d.h) || defaultSize(vehicle(vp));
      designs[k] = { w: size[0], h: size[1], ...R.normalizeDesign(d) };
    }
    p.designs = designs;
    return p;
  }
  function loadImage(src) {
    if (!src || images.has(src)) return images.get(src)?.ready || Promise.resolve();
    const img = new Image();
    img.ready = new Promise(res => { img.onload = () => { res(); draw(); }; img.onerror = () => res(); });
    img.src = src; images.set(src, img);
    return img.ready;
  }

  // ------------------------------------------------------------ HTML
  const html = `<div class="panel"><div class="panel-head"><div class="panel-title">KAW Livery Wizard</div></div><div class="v16-body" id="lvRoot">
    <p>Design your own paint job for trucks and trailers, then build a real ATS mod (DDS textures, definitions, icon) right here. Nothing is uploaded.</p>
    <details id="lvHelp"><summary>How it works (first time? read this)</summary>
      <p>1. Choose the vehicles. 2. Pick a part and add layers: background, stripes, patterns, text and your own logos. Drag on the picture to move the selected layer, mouse wheel to resize, Shift + wheel to rotate.
      3. Load the matching <b>paint job template</b> for each part so you can see where the doors, windows and panels are. SCS does not publish official templates; use the free community templates (for example Carsmaniac's ATS paint job templates). The template is only a guide and is never exported.
      4. Build the paint job, then download the ZIP or save it straight into your ATS mod folder and enable it in the Mod Manager. Transparent areas show the base colour you pick in the game.</p>
      <p class="v16-note">Vehicle list from Paint Job Packer by Carsmaniac (MIT licence). Textures are DXT5 with mipmaps, which every ATS version loads. Test in single player first.</p></details>
    <h3>Paint job details</h3>
    <div class="v16-row"><label style="flex:2 1 220px">Name <input class="v16-input" id="lvName" maxlength="60"></label><label style="flex:1 1 140px">Author <input class="v16-input" id="lvAuthor" maxlength="60"></label><label style="flex:0 1 90px">Version <input class="v16-input" id="lvVersion" maxlength="12"></label></div>
    <div class="v16-row"><label style="flex:1 1 120px">Price ($) <input class="v16-input" id="lvPrice" type="number" min="0" step="100"></label><label style="flex:1 1 120px">Unlock at level <input class="v16-input" id="lvUnlock" type="number" min="0" max="100"></label><label style="flex:0 1 120px">Base colour <input class="v16-input" id="lvBase" type="color"></label></div>
    <label class="v16-toggle"><span>Let drivers change the base colour in the game</span><input type="checkbox" id="lvBaseFree"></label>
    <label>Description <textarea class="v16-input" id="lvDesc" maxlength="500"></textarea></label>
    <h3>Vehicles</h3>
    <input class="v16-input" id="lvFind" placeholder="Search trucks and trailers" aria-label="Search vehicles">
    <div id="lvVehicles" style="max-height:220px;overflow:auto;columns:2 220px;margin:8px 0"></div>
    <h3>Paint</h3>
    <div class="v16-row"><label style="flex:1 1 200px">Vehicle <select class="v16-input" id="lvVehicle"></select></label><label style="flex:1 1 200px">Part <select class="v16-input" id="lvPart"></select></label><label style="flex:0 1 150px">Texture size <select class="v16-input" id="lvSize"></select></label></div>
    <div class="v16-row"><label class="cmd" style="cursor:pointer">Load template image…<input type="file" id="lvTemplate" accept="image/png,image/jpeg,image/webp" hidden></label>
      <label style="flex:1 1 160px">Template visibility <input type="range" id="lvTplOpacity" min="0" max="1" step="0.05" value="0.6"></label>
      <button class="cmd" id="lvCopyParts">Copy design to all parts</button><button class="cmd" id="lvCopyVehicles">Copy to all chosen vehicles</button></div>
    <div class="v16-row" style="align-items:flex-start;margin-top:10px">
      <div style="flex:3 1 420px;min-width:0"><canvas id="lvCanvas" width="1024" height="1024" style="width:100%;max-width:820px;display:block;border-radius:8px;touch-action:none;cursor:move;background:repeating-conic-gradient(#8884 0 25%,#0000 0 50%) 0 0/24px 24px" aria-label="Paint job preview"></canvas>
        <p class="v16-note" id="lvCanvasNote"></p></div>
      <div style="flex:2 1 280px;min-width:0">
        <div class="v16-row"><button class="cmd" data-add="fill">+ Background</button><button class="cmd" data-add="stripe">+ Stripe</button><button class="cmd" data-add="pattern">+ Pattern</button><button class="cmd" data-add="text">+ Text</button><label class="cmd" style="cursor:pointer">+ Logo…<input type="file" id="lvLogo" accept="image/png,image/jpeg,image/webp,image/gif" hidden></label></div>
        <div id="lvLayers" style="margin:8px 0"></div>
        <div id="lvProps"></div>
      </div>
    </div>
    <div class="panel" style="padding:12px;margin:10px 0"><b>✨ AI design helper</b>
      <p class="v16-note" style="margin:4px 0 8px">Describe a paint job and your own local AI (the same Ollama your Co-Driver uses) builds it as layers you can then move and tweak. Free, and nothing leaves your PC.</p>
      <div class="v16-row"><input class="v16-input" id="lvAiPrompt" style="flex:3 1 260px" maxlength="500" placeholder="e.g. black with orange flames and two gold pinstripes, KAW TRUCKING on the side"><button class="cmd" id="lvAiGo">Design it</button></div>
      <label class="v16-toggle"><span>Replace the layers on this part (off = add on top)</span><input type="checkbox" id="lvAiReplace" checked></label>
      <p id="lvAiStatus" class="v16-note" role="status"></p></div>
    <details id="lvSdBox" hidden><summary>AI image (Stable Diffusion WebUI detected on this PC)</summary>
      <p>A Stable Diffusion WebUI is running on this PC, so you can also generate a picture and use it as a layer. Nothing leaves your PC.</p>
      <div class="v16-row"><input class="v16-input" id="lvSdPrompt" style="flex:3 1 260px" maxlength="600" placeholder="e.g. seamless blue lightning on black, airbrush, vector style"><button class="cmd" id="lvSdGo">Generate</button></div>
      <div class="v16-row"><label style="flex:1 1 220px">Stable Diffusion address <input class="v16-input" id="lvSdUrl" placeholder="http://127.0.0.1:7860"></label><button class="cmd" id="lvSdSave">Save address</button></div>
      <p id="lvSdStatus" class="v16-note" role="status"></p></details>
    <h3>Build</h3>
    <div class="v16-row"><button class="cmd" id="lvBuild">Build paint job</button><button class="cmd" id="lvDownload" disabled>Download ZIP</button><button class="cmd" id="lvInstall" disabled>Save to ATS mod folder</button></div>
    <progress id="lvProgress" max="1" value="0" style="width:100%" hidden></progress><p id="lvStatus" role="status"></p>
    <h3>Project</h3>
    <div class="v16-row"><button class="cmd" id="lvSaveFile">Save project file</button><label class="cmd" style="cursor:pointer">Open project file…<input type="file" id="lvOpenFile" accept=".json,application/json" hidden></label><button class="cmd" id="lvNew">Start over</button></div>
    <p class="v16-note">Your design autosaves in this browser. Template images are not saved; load them again after a restart.</p>
    <h3>Gallery</h3>
    <p class="v16-note">Paint jobs saved on this PC. To share one, use Download or Share and send the file; your friend opens it with “Open project file…”.</p>
    <div class="v16-row"><button class="cmd" id="lvGallerySave">Save to gallery</button></div>
    <div id="lvGallery" style="display:grid;grid-template-columns:repeat(auto-fill,minmax(210px,1fr));gap:10px;margin-top:8px"></div>
  </div></div>`;

  // ------------------------------------------------------------ rendering
  let raf = 0;
  function draw() { if (!raf) raf = requestAnimationFrame(() => { raf = 0; paint(); }); }
  function paint() {
    const c = q('#lvCanvas'); if (!c || !P) return;
    const d = design(), W = PREVIEW, H = Math.round(PREVIEW * d.h / d.w);
    if (c.width !== W || c.height !== H) { c.width = W; c.height = H; }
    const ctx = c.getContext('2d');
    R.render(ctx, d, W, H, images);
    const t = templates.get(keyOf());
    if (t) { ctx.save(); ctx.globalAlpha = +q('#lvTplOpacity').value; ctx.drawImage(t.img, 0, 0, W, H); ctx.restore(); }
    const l = layer(), b = l && R.bounds(l, W, H, images, ctx);
    if (b) {
      ctx.save(); ctx.translate(b.x * W, b.y * H); ctx.rotate((b.angle || 0) * Math.PI / 180);
      ctx.setLineDash([10, 6]); ctx.lineWidth = 2; ctx.strokeStyle = '#00e0ff';
      ctx.strokeRect(-b.w * W / 2 - 4, -b.h * H / 2 - 4, b.w * W + 8, b.h * H + 8); ctx.restore();
    }
    q('#lvCanvasNote').textContent = `${d.w} × ${d.h} texture${t ? ` · template ${t.w} × ${t.h}${t.w / t.h !== d.w / d.h ? ' (different shape — check the texture size)' : ''}` : ' · no template loaded for this part'}`;
  }

  // ------------------------------------------------------------ panels
  function renderDetails() {
    q('#lvName').value = P.name; q('#lvAuthor').value = P.author; q('#lvVersion').value = P.version; q('#lvPrice').value = P.price; q('#lvUnlock').value = P.unlock;
    q('#lvBase').value = P.baseColor; q('#lvBaseFree').checked = P.baseColorUnlocked; q('#lvDesc').value = P.description;
  }
  function renderVehicles() {
    const f = q('#lvFind').value.trim().toLowerCase();
    const row = v => `<label style="display:block;break-inside:avoid;padding:2px 0"><input type="checkbox" data-veh="${esc(v.path)}" ${P.vehicles.includes(v.path) ? 'checked' : ''}> ${esc(v.name)}</label>`;
    const group = (title, list) => list.length ? `<b style="display:block">${title}</b>${list.map(row).join('')}` : '';
    const match = cat.filter(v => !f || v.name.toLowerCase().includes(f));
    q('#lvVehicles').innerHTML = group('Trucks', match.filter(v => v.type === 'truck')) + group('Trailers', match.filter(v => v.type !== 'truck')) || '<p>No match.</p>';
    q('#lvVehicles').querySelectorAll('[data-veh]').forEach(b => b.onchange = () => {
      P.vehicles = b.checked ? [...new Set([...P.vehicles, b.dataset.veh])] : P.vehicles.filter(x => x !== b.dataset.veh);
      save(); renderPicker(); invalidate();
    });
  }
  function renderPicker() {
    if (!P.vehicles.includes(cur.vehicle)) cur.vehicle = P.vehicles[0] || '';
    q('#lvVehicle').innerHTML = P.vehicles.map(p => `<option value="${esc(p)}">${esc(vehicle(p).name)}</option>`).join('') || '<option value="">Choose a vehicle above</option>';
    q('#lvVehicle').value = cur.vehicle;
    const parts = partsOf(vehicle(cur.vehicle));
    if (!parts.some(p => p.key === cur.part)) cur.part = parts[0]?.key || '';
    q('#lvPart').innerHTML = parts.map(p => `<option value="${esc(p.key)}">${painted(P.designs[keyOf(cur.vehicle, p.key)]) ? '● ' : ''}${esc(p.label)}</option>`).join('');
    q('#lvPart').value = cur.part;
    const editable = Boolean(cur.vehicle && cur.part);
    q('#lvRoot').querySelectorAll('[data-add],#lvSize,#lvCopyParts,#lvCopyVehicles').forEach(el => el.disabled = !editable);
    if (!editable) { q('#lvLayers').innerHTML = '<p>Choose at least one vehicle.</p>'; q('#lvProps').innerHTML = ''; return; }
    const d = design();
    q('#lvSize').innerHTML = SIZES.map(([w, h]) => `<option value="${w}x${h}">${w} × ${h}</option>`).join('');
    q('#lvSize').value = `${d.w}x${d.h}`;
    renderLayers(); draw();
  }
  function renderLayers() {
    const d = design();
    if (!d.layers.some(l => l.id === sel)) sel = d.layers[d.layers.length - 1]?.id || '';
    q('#lvLayers').innerHTML = d.layers.length ? [...d.layers].reverse().map(l => `<div class="v16-row" style="padding:4px 6px;border-radius:6px;${l.id === sel ? 'background:color-mix(in srgb,var(--blue) 22%,transparent)' : ''}">
      <input type="checkbox" data-vis="${l.id}" ${l.visible ? 'checked' : ''} aria-label="Show ${esc(l.name)}">
      <button class="cmd" style="flex:1;text-align:left" data-sel="${l.id}">${esc(l.name)}</button>
      <button class="cmd" data-move="${l.id}:1" aria-label="Move up" title="Move up">▲</button><button class="cmd" data-move="${l.id}:-1" aria-label="Move down" title="Move down">▼</button>
      <button class="cmd" data-dup="${l.id}" aria-label="Duplicate" title="Duplicate">⧉</button><button class="cmd" data-del="${l.id}" aria-label="Delete" title="Delete">✕</button></div>`).join('')
      : '<p>No layers yet. Start with “+ Background”.</p>';
    const root = q('#lvLayers');
    root.querySelectorAll('[data-sel]').forEach(b => b.onclick = () => { sel = b.dataset.sel; renderLayers(); draw(); });
    root.querySelectorAll('[data-vis]').forEach(b => b.onchange = () => { const l = d.layers.find(x => x.id === b.dataset.vis); l.visible = b.checked; changed(); });
    root.querySelectorAll('[data-move]').forEach(b => b.onclick = () => {
      const [id, dir] = b.dataset.move.split(':'), i = d.layers.findIndex(x => x.id === id), j = i + Number(dir);
      if (j < 0 || j >= d.layers.length) return; [d.layers[i], d.layers[j]] = [d.layers[j], d.layers[i]]; renderLayers(); changed();
    });
    root.querySelectorAll('[data-dup]').forEach(b => b.onclick = () => {
      const i = d.layers.findIndex(x => x.id === b.dataset.dup), copy = R.makeLayer(d.layers[i].type, { ...d.layers[i], id: undefined, name: `${d.layers[i].name} copy` });
      d.layers.splice(i + 1, 0, copy); sel = copy.id; renderLayers(); changed();
    });
    root.querySelectorAll('[data-del]').forEach(b => b.onclick = () => { d.layers = d.layers.filter(x => x.id !== b.dataset.del); renderLayers(); changed(); });
    renderProps();
  }

  const pct = [0, 1, 0.001];
  const FIELDS = {
    fill: [['mode', 'Fill', 'select', ['solid', 'linear', 'radial']], ['c1', 'Colour 1', 'color'], ['c2', 'Colour 2', 'color'], ['angle', 'Gradient angle', 'range', 0, 360, 1]],
    stripe: [['color', 'Colour', 'color'], ['count', 'Number of stripes', 'range', 1, 12, 1], ['width', 'Thickness', 'range', 0.002, 0.5, 0.001], ['gap', 'Gap', 'range', 0, 0.2, 0.001], ['length', 'Length', 'range', 0.05, 2, 0.01], ['x', 'Left / right', 'range', ...pct], ['y', 'Up / down', 'range', ...pct], ['angle', 'Angle', 'range', -180, 180, 1]],
    pattern: [['kind', 'Pattern', 'select', R.PATTERNS], ['c1', 'Colour 1', 'color'], ['c2', 'Colour 2', 'color'], ['c3', 'Colour 3', 'color'], ['scale', 'Size', 'range', 0.01, 0.5, 0.005], ['seed', 'Variation', 'number'], ['angle', 'Angle', 'range', -180, 180, 1], ['x', 'Shift left / right', 'range', -0.5, 0.5, 0.001], ['y', 'Shift up / down', 'range', -0.5, 0.5, 0.001]],
    text: [['text', 'Text', 'text'], ['font', 'Font', 'select', R.FONTS], ['size', 'Size', 'range', 0.01, 0.8, 0.005], ['color', 'Colour', 'color'], ['outline', 'Outline colour', 'color'], ['outlineWidth', 'Outline thickness', 'range', 0, 0.4, 0.01], ['italic', 'Italic', 'check'], ['mirror', 'Mirror (for the other side)', 'check'], ['x', 'Left / right', 'range', ...pct], ['y', 'Up / down', 'range', ...pct], ['angle', 'Angle', 'range', -180, 180, 1]],
    image: [['scale', 'Size', 'range', 0.02, 2, 0.01], ['mirror', 'Mirror (for the other side)', 'check'], ['x', 'Left / right', 'range', ...pct], ['y', 'Up / down', 'range', ...pct], ['angle', 'Angle', 'range', -180, 180, 1]]
  };
  const COMMON = [['name', 'Layer name', 'text'], ['opacity', 'Opacity', 'range', 0, 1, 0.01], ['blend', 'Blend', 'select', R.BLENDS]];
  function renderProps() {
    const l = layer();
    if (!l) { q('#lvProps').innerHTML = ''; return; }
    const field = ([k, label, type, a, b, c]) => {
      const id = `lvP_${k}`, v = l[k];
      if (type === 'select') return `<label>${label} <select class="v16-input" id="${id}" data-k="${k}">${a.map(o => `<option ${o === v ? 'selected' : ''}>${esc(o)}</option>`).join('')}</select></label>`;
      if (type === 'check') return `<label class="v16-toggle"><span>${label}</span><input type="checkbox" id="${id}" data-k="${k}" ${v ? 'checked' : ''}></label>`;
      if (type === 'range') return `<label>${label} <input type="range" style="width:100%" id="${id}" data-k="${k}" min="${a}" max="${b}" step="${c}" value="${esc(v)}"></label>`;
      return `<label>${label} <input class="v16-input" type="${type}" id="${id}" data-k="${k}" value="${esc(v)}" ${type === 'text' ? 'maxlength="80"' : ''}></label>`;
    };
    q('#lvProps').innerHTML = `<h4 style="margin:6px 0">${esc(l.name)}</h4>` + [...FIELDS[l.type], ...COMMON].map(field).join('');
    q('#lvProps').querySelectorAll('[data-k]').forEach(el => el.oninput = el.onchange = () => {
      const k = el.dataset.k;
      l[k] = el.type === 'checkbox' ? el.checked : el.type === 'range' || el.type === 'number' ? Number(el.value) : el.value;
      if (k === 'name') q('#lvLayers').querySelector(`[data-sel="${l.id}"]`).textContent = l.name;
      changed(false);
    });
  }
  function syncProps() {
    const l = layer(); if (!l) return;
    for (const k of ['x', 'y', 'scale', 'size', 'width', 'angle']) { const el = q(`#lvP_${k}`); if (el) el.value = l[k]; }
  }
  function invalidate() {
    built = null; q('#lvDownload').disabled = q('#lvInstall').disabled = true;
  }
  let saveTimer = 0;
  function changed(relist = true) {
    invalidate(); draw();
    if (relist) renderPickerParts();
    clearTimeout(saveTimer); saveTimer = setTimeout(save, 400);
  }
  function renderPickerParts() {
    const parts = partsOf(vehicle(cur.vehicle));
    [...q('#lvPart').options].forEach((o, i) => { o.textContent = `${painted(P.designs[keyOf(cur.vehicle, parts[i].key)]) ? '● ' : ''}${parts[i].label}`; });
  }
  function addLayer(type, props) {
    const l = R.makeLayer(type, props); design().layers.push(l); sel = l.id; renderLayers(); changed();
    return l;
  }

  // ------------------------------------------------------------ canvas interaction
  function canvasPoint(e) { const r = q('#lvCanvas').getBoundingClientRect(); return { x: (e.clientX - r.left) / r.width, y: (e.clientY - r.top) / r.height }; }
  function hit(p) {
    const c = q('#lvCanvas'), W = c.width, H = c.height;
    for (const l of [...design().layers].reverse()) {
      const b = l.visible && R.bounds(l, W, H, images, c.getContext('2d')); if (!b) continue;
      const a = -(b.angle || 0) * Math.PI / 180, dx = (p.x - b.x) * W, dy = (p.y - b.y) * H;
      const rx = dx * Math.cos(a) - dy * Math.sin(a), ry = dx * Math.sin(a) + dy * Math.cos(a);
      if (Math.abs(rx) <= b.w * W / 2 + 6 && Math.abs(ry) <= b.h * H / 2 + 6) return l;
    }
    return null;
  }
  function wireCanvas() {
    const c = q('#lvCanvas'); let drag = null;
    c.onpointerdown = e => {
      if (!cur.part) return;
      const p = canvasPoint(e), h = hit(p);
      if (h && h.id !== sel) { sel = h.id; renderLayers(); }
      const l = layer(); if (!l || l.type === 'fill') return;
      drag = { p, x: l.x, y: l.y }; c.setPointerCapture(e.pointerId);
    };
    c.onpointermove = e => {
      if (!drag) return; const l = layer(), p = canvasPoint(e);
      l.x = +(drag.x + p.x - drag.p.x).toFixed(4); l.y = +(drag.y + p.y - drag.p.y).toFixed(4);
      syncProps(); invalidate(); draw();
    };
    c.onpointerup = c.onpointercancel = () => { if (drag) { drag = null; changed(false); } };
    c.onwheel = e => {
      const l = layer(); if (!l || l.type === 'fill') return;
      e.preventDefault();
      if (e.shiftKey) l.angle = Math.round(((l.angle || 0) + (e.deltaY > 0 ? 3 : -3) + 540) % 360 - 180);
      else { const k = l.type === 'text' ? 'size' : l.type === 'stripe' ? 'width' : 'scale'; l[k] = +Math.max(0.002, l[k] * (e.deltaY > 0 ? 0.95 : 1.05)).toFixed(4); }
      syncProps(); changed(false);
    };
  }

  // ------------------------------------------------------------ files in
  const readAsDataUrl = file => new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(r.result); r.onerror = () => rej(r.error); r.readAsDataURL(file); });
  // Logos are shrunk to at most 2048 px so projects stay a sensible size.
  async function shrink(file, max = 2048) {
    const bmp = await createImageBitmap(file), k = Math.min(1, max / Math.max(bmp.width, bmp.height));
    if (k === 1 && file.size < 3e6) return readAsDataUrl(file);
    const c = document.createElement('canvas'); c.width = Math.round(bmp.width * k); c.height = Math.round(bmp.height * k);
    c.getContext('2d').drawImage(bmp, 0, 0, c.width, c.height);
    return c.toDataURL('image/png');
  }

  // ------------------------------------------------------------ build
  let worker = null, jobId = 0;
  const jobs = new Map();
  function run(op, payload, transfer = [], onProgress) {
    if (!worker) {
      worker = new Worker('/livery/livery-worker.js');
      worker.onmessage = e => { const m = e.data, j = jobs.get(m.id); if (!j) return; if ('progress' in m) return j.onProgress?.(m.progress); jobs.delete(m.id); m.ok ? j.resolve(m) : j.reject(new Error(m.error)); };
      worker.onerror = e => { for (const j of jobs.values()) j.reject(new Error(e.message || 'Export worker failed.')); jobs.clear(); worker = null; };
    }
    const id = ++jobId;
    return new Promise((resolve, reject) => { jobs.set(id, { resolve, reject, onProgress }); worker.postMessage({ id, op, ...payload }, transfer); });
  }
  function renderTo(d, W, H) {
    const c = document.createElement('canvas'); c.width = W; c.height = H;
    const ctx = c.getContext('2d', { willReadFrequently: true });
    R.render(ctx, d, W, H, images);
    return c;
  }
  const canvasBlob = (c, type, quality) => new Promise(res => c.toBlob(b => res(b), type, quality));
  async function build() {
    if (!P.name.trim()) throw new Error('Give the paint job a name first.');
    const jobsList = [];
    for (const p of P.vehicles) for (const part of partsOf(vehicle(p))) { const d = P.designs[keyOf(p, part.key)]; if (painted(d)) jobsList.push({ p, part, d }); }
    if (!jobsList.length) throw new Error('Paint at least one part first.');
    const missing = P.vehicles.filter(p => !jobsList.some(j => j.p === p && !j.part.key.startsWith('acc:')));
    if (missing.length) throw new Error(`Paint the body or a cabin of: ${missing.map(p => vehicle(p).name).join(', ')} (or untick it).`);
    await Promise.all(Object.values(P.designs).flatMap(d => d.layers.filter(l => l.type === 'image').map(l => loadImage(l.src))));
    const bar = q('#lvProgress'); bar.hidden = false; bar.value = 0;
    const steps = jobsList.length + 2; let done = 0;
    const vehicles = new Map();
    for (const j of jobsList) {
      q('#lvStatus').textContent = `Encoding ${vehicle(j.p).name} — ${j.part.label} (${j.d.w} × ${j.d.h})…`;
      const rgba = renderTo(j.d, j.d.w, j.d.h).getContext('2d').getImageData(0, 0, j.d.w, j.d.h).data.buffer;
      const r = await run('dds', { rgba, w: j.d.w, h: j.d.h }, [rgba], p => { bar.value = (done + p) / steps; });
      if (!vehicles.has(j.p)) vehicles.set(j.p, { vehicle: vehicle(j.p), parts: {} });
      vehicles.get(j.p).parts[j.part.key] = r.data;
      bar.value = ++done / steps;
    }
    // Icon (256 x 64) and mod manager picture (276 x 162) from the first painted body.
    const first = (jobsList.find(j => !j.part.key.startsWith('acc:')) || jobsList[0]).d;
    const art = renderTo(first, 1024, Math.round(1024 * first.h / first.w));
    const cover = (W, H) => {
      const c = document.createElement('canvas'); c.width = W; c.height = H; const ctx = c.getContext('2d');
      ctx.fillStyle = P.baseColor; ctx.fillRect(0, 0, W, H);
      const k = Math.max(W / art.width, H / art.height); ctx.drawImage(art, (W - art.width * k) / 2, (H - art.height * k) / 2, art.width * k, art.height * k);
      return c;
    };
    const icon = cover(256, 64).getContext('2d').getImageData(0, 0, 256, 64).data.buffer;
    const iconDds = (await run('dds', { rgba: icon, w: 256, h: 64, mips: false }, [icon])).data;
    const pic = cover(276, 162), pctx = pic.getContext('2d');
    pctx.fillStyle = 'rgba(0,0,0,.55)'; pctx.fillRect(0, 122, 276, 40);
    pctx.fillStyle = '#fff'; pctx.font = '700 16px "Segoe UI", Arial, sans-serif'; pctx.textBaseline = 'middle'; pctx.fillText(P.name.slice(0, 30), 10, 135);
    pctx.font = '12px "Segoe UI", Arial, sans-serif'; pctx.fillText(`by ${P.author || 'Kaw'} · KAW Livery Wizard`, 10, 152);
    const modImageJpg = new Uint8Array(await (await canvasBlob(pic, 'image/jpeg', 0.92)).arrayBuffer());
    bar.value = ++done / steps;
    q('#lvStatus').textContent = 'Packing the mod…';
    const spec = { name: P.name, author: P.author, version: P.version, description: P.description, price: P.price, unlock: P.unlock, baseColor: P.baseColor, baseColorUnlocked: P.baseColorUnlocked, vehicles: [...vehicles.values()], modImageJpg, iconDds };
    const r = await run('mod', { spec });
    bar.value = 1;
    built = { zip: r.data, files: r.files, name: window.KAWLivery.sanitize(P.name) || 'KAW Paint Job' };
    q('#lvDownload').disabled = false; q('#lvInstall').disabled = !local;
    q('#lvStatus').textContent = `Ready: ${built.name}.zip — ${(built.zip.length / 1048576).toFixed(1)} MB, ${built.files.length} files, ${jobsList.length} texture${jobsList.length === 1 ? '' : 's'} for ${vehicles.size} vehicle${vehicles.size === 1 ? '' : 's'}.`;
  }
  function download() {
    const a = document.createElement('a'), url = URL.createObjectURL(new Blob([built.zip], { type: 'application/zip' }));
    a.href = url; a.download = `${built.name}.zip`; document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 5000);
  }
  async function install(overwrite = false) {
    const r = await fetch(`/api/livery/install?name=${encodeURIComponent(built.name)}${overwrite ? '&overwrite=1' : ''}`, { method: 'POST', headers: { 'content-type': 'application/zip' }, body: built.zip });
    const j = await r.json().catch(() => ({ ok: false, error: `HTTP ${r.status}` }));
    if (!j.ok && /already exists/.test(j.error || '') && !overwrite) { if (confirm(`${built.name}.zip is already in your mod folder. Replace it?`)) return install(true); return; }
    if (!j.ok) throw new Error(j.error);
    q('#lvStatus').textContent = `Saved to ${j.path}. Open ATS → Mod Manager, enable “${P.name}”, then buy it in a truck or trailer dealer's paint shop.`;
    notify('Paint job installed', 'Enable it in the ATS Mod Manager.', 'join');
  }

  // ------------------------------------------------------------ gallery (this PC, data/liveries)
  let galleryId = null;
  function thumbnail() {
    const k = Object.keys(P.designs).find(k => painted(P.designs[k]) && !k.includes('|acc:')) || Object.keys(P.designs).find(k => painted(P.designs[k]));
    if (!k) return null;
    const d = P.designs[k], W = 320, H = Math.round(320 * d.h / d.w), c = renderTo(d, W, H), out = document.createElement('canvas');
    out.width = W; out.height = H; const x = out.getContext('2d'); x.fillStyle = P.baseColor; x.fillRect(0, 0, W, H); x.drawImage(c, 0, 0);
    return out.toDataURL('image/jpeg', 0.8);
  }
  const fileOf = proj => new Blob([JSON.stringify({ format: 'KAW-Livery', version: 1, project: proj }, null, 1)], { type: 'application/json' });
  const fileName = proj => `${window.KAWLivery.sanitize(proj.name) || 'KAW Paint Job'}.kawlivery.json`;
  async function galleryLoad() {
    if (!local) { q('#lvGallery').innerHTML = '<p class="v16-note">The gallery is on the PC running the Companion.</p>'; q('#lvGallerySave').disabled = true; return; }
    const r = await api('/api/livery/gallery');
    q('#lvGallery').innerHTML = r.items.length ? r.items.map(it => `<div class="panel" style="padding:8px">${it.thumb ? `<img src="${esc(it.thumb)}" alt="" style="width:100%;border-radius:6px;display:block">` : ''}<b style="display:block;margin-top:6px">${esc(it.name)}</b>
      <div class="v16-note">${esc(it.author || '')} · ${it.vehicles.length} vehicle${it.vehicles.length === 1 ? '' : 's'} · ${esc(new Date(it.savedAt).toLocaleDateString())}</div>
      <div class="v16-row" style="margin-top:6px"><button class="cmd" data-gopen="${esc(it.id)}">Open</button><button class="cmd" data-gdl="${esc(it.id)}">Download</button><button class="cmd" data-gshare="${esc(it.id)}">Share…</button><button class="cmd" data-gdel="${esc(it.id)}" aria-label="Delete">✕</button></div></div>`).join('')
      : '<p class="v16-note">Nothing saved yet. Press “Save to gallery”.</p>';
    const item = async id => (await api(`/api/livery/gallery/item?id=${encodeURIComponent(id)}`)).item;
    q('#lvGallery').querySelectorAll('[data-gopen]').forEach(b => b.onclick = guard(async () => {
      if (!confirm('Open this paint job? Your current design is replaced (save it to the gallery first if you want to keep it).')) return;
      const it = await item(b.dataset.gopen); P = cleanProject(it.project); galleryId = it.id; cur = { vehicle: '', part: '' }; sel = ''; templates.clear(); save(); start(); notify('Opened from gallery', P.name, 'join');
    }));
    q('#lvGallery').querySelectorAll('[data-gdl]').forEach(b => b.onclick = guard(async () => { const it = await item(b.dataset.gdl); const a = document.createElement('a'), u = URL.createObjectURL(fileOf(it.project)); a.href = u; a.download = fileName(it.project); a.click(); setTimeout(() => URL.revokeObjectURL(u), 2000); }));
    q('#lvGallery').querySelectorAll('[data-gshare]').forEach(b => b.onclick = guard(async () => {
      const it = await item(b.dataset.gshare), f = new File([fileOf(it.project)], fileName(it.project), { type: 'application/json' });
      if (navigator.canShare?.({ files: [f] })) await navigator.share({ files: [f], title: it.name, text: `My ATS paint job “${it.name}” — open it in KAW Livery Wizard.` });
      else throw new Error('Sharing files is not available here — use Download and send the file.');
    }));
    q('#lvGallery').querySelectorAll('[data-gdel]').forEach(b => b.onclick = guard(async () => { if (!confirm('Delete this paint job from the gallery?')) return; await api('/api/livery/gallery/delete', { method: 'POST', body: { id: b.dataset.gdel } }); if (galleryId === b.dataset.gdel) galleryId = null; await galleryLoad(); }));
  }
  async function gallerySave() {
    await Promise.all(Object.values(P.designs).flatMap(d => d.layers.filter(l => l.type === 'image').map(l => loadImage(l.src))));
    const r = await fetch('/api/livery/gallery', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ id: galleryId, project: P, thumb: thumbnail() }) }).then(x => x.json());
    if (!r.ok) throw new Error(r.error || 'Could not save.');
    galleryId = r.id; notify('Saved to gallery', r.name, 'join'); await galleryLoad();
  }

  // ------------------------------------------------------------ AI design helper (local Ollama)
  async function aiDesign() {
    const prompt = q('#lvAiPrompt').value.trim();
    if (!prompt) throw new Error('Describe the paint job first.');
    if (!cur.part) throw new Error('Choose a vehicle and part first.');
    const btn = q('#lvAiGo'); btn.disabled = true;
    q('#lvAiStatus').textContent = 'Your local AI is designing… this can take up to a minute the first time.';
    try {
      const r = await fetch('/api/livery/design', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ prompt }) }).then(x => x.json());
      if (!r.ok) { q('#lvAiStatus').textContent = r.error || 'The AI could not design that.'; return; }
      const fresh = R.normalizeDesign({ layers: r.layers }).layers.map(l => R.makeLayer(l.type, { ...l, id: undefined }));
      const d = design();
      d.layers = q('#lvAiReplace').checked ? fresh : [...d.layers, ...fresh];
      sel = fresh.at(-1)?.id || ''; renderLayers(); changed();
      q('#lvAiStatus').textContent = `Done: ${fresh.length} layer${fresh.length === 1 ? '' : 's'}. Click a layer to adjust it, or press “Design it” again for another idea.`;
    } finally { btn.disabled = false; }
  }

  // ------------------------------------------------------------ Stable Diffusion WebUI (only when detected)
  async function sdStatus() {
    try {
      const s = await api('/api/livery/status'); sdReady = s.sd?.reachable;
      q('#lvSdUrl').value = s.sd?.url || '';
      q('#lvSdStatus').textContent = sdReady ? `Connected to ${s.sd.url}.` : `Not running at ${s.sd?.url || 'the address above'}.`;
      q('#lvSdGo').disabled = !sdReady;
      if (sdReady) q('#lvSdBox').hidden = false;
    } catch (e) { q('#lvSdStatus').textContent = e.message; q('#lvSdGo').disabled = true; }
  }
  async function sdGenerate() {
    const prompt = q('#lvSdPrompt').value.trim(); if (!prompt) throw new Error('Describe the pattern first.');
    q('#lvSdStatus').textContent = 'Generating on your PC… this can take a minute.'; q('#lvSdGo').disabled = true;
    try {
      const d = design(), w = d.w >= d.h ? 768 : Math.round(768 * d.w / d.h / 64) * 64, h = d.h >= d.w ? 768 : Math.round(768 * d.h / d.w / 64) * 64;
      const r = await api('/api/livery/sd', { method: 'POST', body: { prompt, width: w, height: h, tiling: true } });
      await loadImage(r.image);
      addLayer('image', { src: r.image, name: `AI: ${prompt.slice(0, 24)}`, scale: 1, x: 0.5, y: 0.5 });
      q('#lvSdStatus').textContent = 'Added as a new layer. Resize it with the mouse wheel.';
    } finally { q('#lvSdGo').disabled = !sdReady; }
  }

  // ------------------------------------------------------------ wiring
  function wire() {
    const bind = (id, k, conv = v => v) => { q(id).oninput = () => { P[k] = conv(q(id).type === 'checkbox' ? q(id).checked : q(id).value); invalidate(); clearTimeout(saveTimer); saveTimer = setTimeout(save, 400); }; q(id).onchange = q(id).oninput; };
    bind('#lvName', 'name'); bind('#lvAuthor', 'author'); bind('#lvVersion', 'version'); bind('#lvDesc', 'description'); bind('#lvBase', 'baseColor'); bind('#lvBaseFree', 'baseColorUnlocked');
    bind('#lvPrice', 'price', v => Math.max(0, Math.round(Number(v) || 0))); bind('#lvUnlock', 'unlock', v => Math.max(0, Math.min(100, Math.round(Number(v) || 0))));
    q('#lvFind').oninput = renderVehicles;
    q('#lvVehicle').onchange = () => { cur.vehicle = q('#lvVehicle').value; cur.part = ''; renderPicker(); };
    q('#lvPart').onchange = () => { cur.part = q('#lvPart').value; renderPicker(); };
    q('#lvSize').onchange = () => { const [w, h] = q('#lvSize').value.split('x').map(Number); Object.assign(design(), { w, h }); changed(false); };
    q('#lvTplOpacity').oninput = draw;
    q('#lvTemplate').onchange = guard(async () => {
      const f = q('#lvTemplate').files[0]; q('#lvTemplate').value = ''; if (!f) return;
      const img = await createImageBitmap(f); templates.set(keyOf(), { img, w: img.width, h: img.height });
      const size = SIZES.find(([w, h]) => w === img.width && h === img.height);
      if (size) { Object.assign(design(), { w: size[0], h: size[1] }); q('#lvSize').value = `${size[0]}x${size[1]}`; invalidate(); save(); }
      else notify('Template loaded', `It is ${img.width} × ${img.height}. Pick the texture size that matches its shape.`, 'leave');
      draw();
    });
    q('#lvLogo').onchange = guard(async () => {
      const f = q('#lvLogo').files[0]; q('#lvLogo').value = ''; if (!f) return;
      const src = await shrink(f); await loadImage(src);
      addLayer('image', { src, name: f.name.replace(/\.[^.]+$/, '').slice(0, 40) || 'Logo' });
    });
    q('#lvRoot').querySelectorAll('[data-add]').forEach(b => b.onclick = () => addLayer(b.dataset.add));
    const copyTo = keys => {
      const src = design(); let n = 0;
      for (const k of keys) { if (k === keyOf()) continue; const d = design(k); d.layers = src.layers.map(l => R.makeLayer(l.type, { ...l, id: undefined })); n++; }
      changed(); notify('Design copied', `${n} part${n === 1 ? '' : 's'} updated. Each truck's template is different, so check every part.`, 'join');
    };
    q('#lvCopyParts').onclick = () => { if (confirm('Replace the design on every other part of this vehicle?')) copyTo(partsOf(vehicle(cur.vehicle)).map(p => keyOf(cur.vehicle, p.key))); };
    q('#lvCopyVehicles').onclick = () => { if (confirm('Replace the body/cabin design on every chosen vehicle?')) copyTo(P.vehicles.flatMap(v => partsOf(vehicle(v)).filter(p => !p.key.startsWith('acc:')).map(p => keyOf(v, p.key)))); };
    q('#lvBuild').onclick = guard(async () => {
      q('#lvBuild').disabled = true; invalidate();
      try { await build(); } catch (e) { q('#lvStatus').textContent = e.message; throw e; } finally { q('#lvBuild').disabled = false; q('#lvProgress').hidden = true; }
    });
    q('#lvDownload').onclick = () => built && download();
    q('#lvInstall').onclick = guard(async () => built && install());
    q('#lvSaveFile').onclick = () => {
      const a = document.createElement('a'), url = URL.createObjectURL(new Blob([JSON.stringify({ format: 'KAW-Livery', version: 1, project: P }, null, 1)], { type: 'application/json' }));
      a.href = url; a.download = `${window.KAWLivery.sanitize(P.name) || 'KAW Paint Job'}.kawlivery.json`; a.click(); setTimeout(() => URL.revokeObjectURL(url), 2000);
    };
    q('#lvOpenFile').onchange = guard(async () => {
      const f = q('#lvOpenFile').files[0]; q('#lvOpenFile').value = ''; if (!f) return;
      if (f.size > 80e6) throw new Error('That project file is too large.');
      const j = JSON.parse(await f.text()); if (j.format !== 'KAW-Livery') throw new Error('That is not a KAW Livery project file.');
      P = cleanProject(j.project); galleryId = null; cur = { vehicle: '', part: '' }; sel = ''; save(); start();
      notify('Project opened', P.name, 'join');
    });
    q('#lvGallerySave').onclick = guard(gallerySave);
    q('#lvNew').onclick = () => { if (!confirm('Start a new paint job? Save a project file first if you want to keep this one.')) return; galleryId = null; P = newProject(); cur = { vehicle: '', part: '' }; sel = ''; templates.clear(); save(); start(); };
    q('#lvAiGo').onclick = guard(aiDesign);
    q('#lvAiPrompt').onkeydown = e => { if (e.key === 'Enter') q('#lvAiGo').click(); };
    q('#lvSdGo').onclick = guard(sdGenerate);
    q('#lvSdSave').onclick = guard(async () => { await api('/api/livery/settings', { method: 'POST', body: { sdUrl: q('#lvSdUrl').value.trim() } }); await sdStatus(); });
    q('#lvSdBox').ontoggle = () => q('#lvSdBox').open && sdStatus();
    wireCanvas();
  }
  function start() {
    for (const d of Object.values(P.designs)) for (const l of d.layers) if (l.type === 'image') loadImage(l.src);
    renderDetails(); renderVehicles(); renderPicker(); invalidate();
  }
  let ready = null;
  async function init() {
    const r = await fetch('/livery/vehicles.json'); if (!r.ok) throw new Error('Vehicle list missing.');
    cat = (await r.json()).vehicles;
    let saved = null; try { saved = JSON.parse(localStorage.getItem(STORE) || 'null'); } catch {}
    P = cleanProject(saved);
    local = ['127.0.0.1', 'localhost', '[::1]'].includes(location.hostname);
    if (!local) q('#lvInstall').title = 'Only available on the PC running the Companion.';
    wire(); start();
    galleryLoad().catch(e => { q('#lvGallery').textContent = e.message; });
    if (local) sdStatus();   // reveals the extra image option only if a Stable Diffusion WebUI is running
  }

  K.pages.push({ name: 'livery', icon: '✎', label: 'Livery Wizard', group: 'Setup', index: 3, html, load: () => { ready ||= init().catch(e => { ready = null; q('#lvStatus').textContent = e.message; }); return ready.then(() => P && draw()); } });
  // Exposed for the browser test harness.
  window.KAWLiveryApp = { project: () => P, build: () => build(), select: (v, part) => { cur = { vehicle: v, part }; renderPicker(); }, addLayer, built: () => built };
})();
