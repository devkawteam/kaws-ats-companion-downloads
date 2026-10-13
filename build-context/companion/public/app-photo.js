// Photo mode helper: game-clock light (golden / blue hour), shot ideas from what you're hauling and
// where you are, a classic shot list, and your latest ATS screenshots. Author: Kaw.
(() => {
  const K = window.KAW16; if (!K) return;
  const { q, api, esc, telem, dateTime } = K;
  const LIST_KEY = 'kawPhotoShotList';
  // Approximate light windows on the ATS game clock (minutes after midnight).
  const PHASES = [
    { name: 'Night', from: 0, to: 315, color: '#1b2a4a', tip: 'Use headlights, cab lights and city glow. Long, steady shots.' },
    { name: 'Blue hour', from: 315, to: 345, color: '#3d5a99', tip: 'Soft blue sky with lights still on — great for truck stops and cities.' },
    { name: 'Golden hour', from: 345, to: 435, color: '#e3a33b', tip: 'Warm low sun: shoot side profiles and chrome with the sun behind you.' },
    { name: 'Daylight', from: 435, to: 1095, color: '#7fb3e6', tip: 'Bright and contrasty: try landscapes, high angles and shade under bridges.' },
    { name: 'Golden hour', from: 1095, to: 1185, color: '#e3a33b', tip: 'Warm low sun: backlit dust, long shadows, glowing paint.' },
    { name: 'Blue hour', from: 1185, to: 1215, color: '#3d5a99', tip: 'Lights on against a deep blue sky — the classic night-shift look.' },
    { name: 'Night', from: 1215, to: 1440, color: '#1b2a4a', tip: 'Use headlights, cab lights and city glow. Long, steady shots.' }
  ];
  const SHOTS = ['Front three-quarter, low angle', 'Side profile at golden hour', 'Rolling shot on an open highway', 'Convoy line from a bridge or hill', 'Cab interior with dash lights at night', 'Close-up of the cargo or trailer', 'Truck stop at blue hour', 'Wide landscape with the truck small in frame', 'Mirror shot looking back down the road', 'Rain or fog mood shot'];
  const IDEAS = [
    c => `Park the ${c.truck} at an angle and shoot low from the front corner, ${c.place ? `with ${c.place} behind it` : 'with the road leading into the frame'}.`,
    c => c.cargo ? `Tell the story of the load: a close-up of the ${c.cargo} on the trailer, then a wide shot of the whole rig.` : 'Bobtail portrait: shoot the tractor alone, side-on, filling two-thirds of the frame.',
    c => `${c.phase === 'Golden hour' ? 'Golden hour now — ' : ''}put the sun behind the camera and frame the side of the ${c.truck} on the right third.`,
    c => `Find a curve${c.state ? ` in ${c.state}` : ''} and shoot the rig bending through it from the outside of the bend.`,
    c => 'Use the road lines as leading lines: centre the vanishing point, truck slightly off-centre.',
    c => c.convoy ? 'Convoy shot: ask everyone to hold 3-4 seconds apart and shoot the line from behind the last truck.' : 'Reflection shot: catch the truck in a puddle, window or a shiny trailer.',
    c => `${c.phase === 'Night' || c.phase === 'Blue hour' ? 'It\'s dark: ' : ''}try a rear shot with the tail lights glowing and the road disappearing ahead.`,
    c => 'Frame inside a frame: shoot through a bridge, gate or between two other trucks.'
  ];
  let rate = null, samples = [], ideaN = 0, shotList = {};
  try { shotList = JSON.parse(localStorage.getItem(LIST_KEY) || '{}') || {}; } catch {}

  const html = `<div class="panel"><div class="panel-head"><div class="panel-title">Photo Mode Helper</div></div><div class="v16-body">
    <div class="v16-row" style="gap:16px;align-items:stretch">
      <div id="phLight" class="panel" style="flex:1 1 260px;padding:14px"></div>
      <div id="phScene" class="panel" style="flex:1 1 260px;padding:14px"></div>
    </div>
    <h3>Shot idea</h3>
    <div class="panel" style="padding:14px"><p id="phIdea" style="font-size:16px;margin:0 0 10px"></p><button class="cmd" id="phNext">Another idea</button></div>
    <h3>Shot list</h3><p class="v16-note">Tick them off as you take them. Saved on this device.</p><div id="phList" style="columns:2 240px"></div><button class="cmd" id="phReset">Clear ticks</button>
    <h3>Tips</h3><ul class="v16-note" style="font-size:13px">
      <li>Stop somewhere safe first and use the game's photo mode or free camera (check Options → Controls for its key).</li>
      <li>Rule of thirds: put the truck on a third line, not dead centre. Leave space in the direction it faces.</li>
      <li>Shoot low for power, high for scenery. A longer lens (zoomed in) flattens the background and makes trucks look heroic.</li>
      <li>Light is everything: golden and blue hour beat midday. You can wait in the game or adjust time with the sleep option.</li></ul>
    <h3>Latest screenshots</h3><div id="phShots" style="display:grid;grid-template-columns:repeat(auto-fill,minmax(150px,1fr));gap:8px"></div>
  </div></div>`;

  const clock = m => `${String(Math.floor(m / 60) % 24).padStart(2, '0')}:${String(Math.floor(m % 60)).padStart(2, '0')}`;
  function phaseAt(tod) { return PHASES.find(p => tod >= p.from && tod < p.to) || PHASES[0]; }
  function nextGolden(tod) {
    const starts = [345, 1095, 345 + 1440];
    const s = starts.find(x => x > tod) ?? starts[2];
    return s - tod;
  }
  // Measure how fast game time runs compared to real time (depends on the game's time settings).
  function sample(min) {
    const now = Date.now();
    samples.push([now, min]); samples = samples.filter(([t]) => now - t < 120000);
    const [t0, m0] = samples[0];
    if (now - t0 > 15000 && min > m0) rate = (min - m0) / ((now - t0) / 60000);
  }
  function context() {
    const d = telem() || {};
    const tod = Number(d.sdk?.gameTimeMinutes) % 1440;
    return {
      d, tod: Number.isFinite(tod) ? tod : null,
      truck: [d.truck?.make, d.truck?.model].filter(Boolean).join(' ') || 'truck',
      cargo: d.job?.active ? d.job.cargo : null,
      place: d.geo?.near || null, state: d.geo?.state || null,
      convoy: (d.mapMates?.length || 0) > 0,
      phase: null
    };
  }
  function renderLive() {
    const c = context();
    if (c.tod !== null && Number.isFinite(c.tod)) {
      sample(Number(c.d.sdk.gameTimeMinutes));
      const p = phaseAt(c.tod); c.phase = p.name;
      const wait = nextGolden(c.tod);
      const real = rate ? Math.round(wait / rate) : null;
      q('#phLight').style.borderLeft = `6px solid ${p.color}`;
      q('#phLight').innerHTML = `<div class="v16-note">Game clock</div><div style="font-size:34px;font-weight:800">${clock(c.tod)}</div><b>${p.name}</b><p style="margin:6px 0">${p.tip}</p>
        <div class="v16-note">${p.name === 'Golden hour' ? 'Golden hour now — go!' : `Next golden hour in ${Math.floor(wait / 60)}h ${String(Math.round(wait % 60)).padStart(2, '0')}m game time${real !== null ? ` (about ${real} real minute${real === 1 ? '' : 's'})` : ''}`}. Light times are approximate.</div>`;
    } else q('#phLight').innerHTML = '<b>Start ATS</b><p class="v16-note">The game clock appears once telemetry is connected.</p>';
    const speed = Number(c.d.truck?.speedMph) || 0;
    q('#phScene').innerHTML = `<div class="v16-note">Scene</div><b>${esc(c.truck)}</b>${c.cargo ? `<div>Hauling ${esc(c.cargo)}</div>` : '<div>No load</div>'}<div>${c.place ? `Near ${esc(c.place)}${c.state ? `, ${esc(c.state)}` : ''}` : 'Location unknown'}</div>
      <p style="margin:8px 0 0">${speed > 3 ? '🛑 Pull over somewhere safe before you start shooting.' : '✅ Stopped — good time for photo mode.'}</p>`;
    return c;
  }
  function idea() { const c = renderLive(); q('#phIdea').textContent = IDEAS[ideaN++ % IDEAS.length](c); }
  function renderList() {
    q('#phList').innerHTML = SHOTS.map((s, i) => `<label style="display:block;break-inside:avoid;padding:3px 0"><input type="checkbox" data-shot="${i}" ${shotList[s] ? 'checked' : ''}> ${esc(s)}${shotList[s] ? ` <span class="v16-note">(${esc(new Date(shotList[s]).toLocaleDateString())})</span>` : ''}</label>`).join('');
    q('#phList').querySelectorAll('[data-shot]').forEach(b => b.onchange = () => { const s = SHOTS[+b.dataset.shot]; if (b.checked) shotList[s] = new Date().toISOString(); else delete shotList[s]; try { localStorage.setItem(LIST_KEY, JSON.stringify(shotList)); } catch {} renderList(); });
  }
  async function loadShots() {
    try {
      const j = await api('/api/journal?limit=12');
      q('#phShots').innerHTML = !j.available ? '<p class="v16-note">ATS screenshot folder not found on this PC yet. Take a screenshot in the game and it will show here.</p>'
        : j.shots.length ? j.shots.map(s => `<a href="/api/journal/image/${encodeURIComponent(s.name)}" target="_blank" rel="noopener" style="display:block"><img src="/api/journal/image/${encodeURIComponent(s.name)}" alt="Screenshot ${esc(dateTime(s.takenAt))}" loading="lazy" style="width:100%;aspect-ratio:16/9;object-fit:cover;border-radius:8px"><div class="v16-note">${esc(dateTime(s.takenAt))}${s.trip?.destinationCity ? ` · → ${esc(s.trip.destinationCity)}` : ''}</div></a>`).join('')
        : '<p class="v16-note">No screenshots yet.</p>';
    } catch (e) { q('#phShots').textContent = e.message; }
  }

  K.pages.push({ name: 'photo', icon: '◉', label: 'Photo Mode', group: 'Stream', html,
    init() { q('#phNext').onclick = idea; q('#phReset').onclick = () => { if (!confirm('Clear all ticks?')) return; shotList = {}; try { localStorage.removeItem(LIST_KEY); } catch {} renderList(); }; },
    load: () => { renderList(); idea(); return loadShots(); } });
  K.onTick.push(() => { if (K.currentPage() === 'photo') renderLive(); });
})();
