/* KAW'S ATS Companion v1.6 front-end module.
   Adds the grouped navigation, live KPI strip, alert banner, speed-limit sign, and the
   Dispatch, Career, Earnings, Pre-Flight, Convoy Sessions and Alerts & Discord pages.
   Runs after the main inline script and reuses its globals (showPage, toast, sound, prefs,
   latestTelemetry) without redeclaring anything. */
(() => {
  'use strict';

  // ---------- helpers ----------
  const q = (s, r = document) => r.querySelector(s);
  const qa = (s, r = document) => [...r.querySelectorAll(s)];
  const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const fin = v => v !== null && v !== undefined && v !== '' && Number.isFinite(Number(v));
  const cash = v => '$' + Math.round(Number(v) || 0).toLocaleString('en-US');
  const f1 = v => (Number(v) || 0).toFixed(1);
  const int = v => Math.round(Number(v) || 0).toLocaleString('en-US');
  const gameTime = min => { if (!fin(min)) return '—'; const m = Math.max(0, Math.round(min)); const h = Math.floor(m / 60); return h ? `${h}h ${String(m % 60).padStart(2, '0')}m` : `${m}m`; };
  const ago = iso => { if (!iso) return '—'; const s = Math.max(0, (Date.now() - new Date(iso)) / 1000); if (s < 60) return 'just now'; if (s < 3600) return `${Math.floor(s / 60)}m ago`; if (s < 86400) return `${Math.floor(s / 3600)}h ago`; return new Date(iso).toLocaleDateString(); };
  const dateTime = iso => iso ? new Date(iso).toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : '—';
  const telem = () => (typeof latestTelemetry !== 'undefined' ? latestTelemetry : null);
  const notify = (title, sub = '', type = '') => (typeof toast === 'function' ? toast(title, sub, type) : console.log(title, sub));
  const go = page => (typeof showPage === 'function' ? showPage(page) : null);
  const statusPill = st => {
    const cls = { active: 'info', planned: 'muted', paused: 'warn', completed: 'good', delivered: 'good', cancelled: 'bad', ended: 'muted', READY: 'good', REVIEW: 'warn', 'NOT READY': 'bad', 'NO MANIFEST': 'muted' }[st] || 'muted';
    return `<span class="v16-pill ${cls}">${esc(st)}</span>`;
  };
  async function api(path, opts = {}) {
    const init = { cache: 'no-store', ...opts };
    if (opts.body && typeof opts.body !== 'string') { init.body = JSON.stringify(opts.body); init.headers = { 'content-type': 'application/json' }; }
    const r = await fetch(path, init);
    const data = await r.json().catch(() => ({}));
    if (!r.ok || data.ok === false) throw new Error(data.error || `Request failed (HTTP ${r.status})`);
    return data;
  }
  const guard = fn => async (...args) => { try { return await fn(...args); } catch (e) { notify('Something went wrong', e.message, 'critical'); } };

  // Extension point for other v1.6 modules (e.g. app-hub.js): helpers plus page/tick registration.
  const ext = window.KAW16 = { q, qa, esc, fin, cash, f1, int, gameTime, ago, dateTime, telem, notify, go, api, guard, statusPill: st => statusPill(st), pages: [], onTick: [], onReady: [], currentPage: () => currentPage };

  // ---------- navigation ----------
  const NEW_PAGES = {
    dispatch: ['⛟', 'Dispatch & BOL'],
    career: ['★', 'Career'],
    sessions: ['⚑', 'Convoy Sessions'],
    preflight: ['✔', 'Convoy Pre-Flight'],
    alerts: ['⚠', 'Alerts & Discord']
  };
  const GROUPS = [
    ['Drive', ['drive', 'navigation', 'truck', 'hood', 'shift']],
    ['Work', ['dispatch', 'trips', 'stats', 'career']],
    ['Convoy', ['convoy', 'radar', 'sessions', 'preflight', 'intelligence', 'commands', 'radio']],
    ['Stream', []],
    ['Setup', ['alerts', 'studio', 'mods', 'settings', 'suggestions']]
  ];
  const RENAME = { stats: 'Earnings & Stats', trips: 'Trip History', intelligence: 'Convoy Intelligence' };

  function buildNav() {
    const nav = q('#sideNav');
    if (!nav) return;
    const existing = new Map(qa('.nav-btn[data-page]', nav).map(b => [b.dataset.page, b]));
    const make = page => {
      const [ico, label] = NEW_PAGES[page];
      const b = document.createElement('button');
      b.className = 'nav-btn'; b.dataset.page = page;
      b.innerHTML = `<span class="nav-ico">${ico}</span>${esc(label)}`;
      b.onclick = () => go(page);
      return b;
    };
    const frag = document.createDocumentFragment();
    const placed = new Set();
    for (const [group, pages] of GROUPS) {
      const h = document.createElement('div'); h.className = 'nav-group'; h.textContent = group; frag.append(h);
      for (const page of pages) {
        const b = existing.get(page) || (NEW_PAGES[page] && make(page));
        if (!b) continue;
        if (RENAME[page]) b.lastChild.textContent = RENAME[page];
        if (page === 'alerts') b.insertAdjacentHTML('beforeend', '<span class="nav-badge" id="v16AlertBadge"></span>');
        frag.append(b); placed.add(page);
      }
    }
    for (const [page, b] of existing) if (!placed.has(page)) frag.append(b);
    nav.replaceChildren(frag);

    const more = q('.mobile-more-grid');
    if (more) for (const [page, [ico, label]] of Object.entries(NEW_PAGES)) {
      const b = document.createElement('button'); b.dataset.page = page; b.textContent = `${ico} ${label}`; b.onclick = () => go(page); more.prepend(b);
    }
  }

  // ---------- top bar: KPI strip, alert banner, theme toggle ----------
  function buildChrome() {
    const top = q('.topbar');
    if (!top) return;
    const status = q('.top-status', top);
    const actions = document.createElement('div');
    actions.className = 'top-actions';
    actions.innerHTML = '<button class="icon-btn" id="v16Theme" type="button" title="Switch light / dark">◐</button>';
    top.append(actions);
    if (status) actions.prepend(status);

    top.insertAdjacentHTML('afterend', `
      <div class="kpi-strip" id="v16Kpis">
        <div class="limit-sign none" id="v16Limit" title="Current speed limit"><div class="ls-t">SPEED<br>LIMIT</div><div class="ls-v">—</div></div>
        <div class="kpi" id="kSpeed"><div class="kpi-k">Speed</div><div class="kpi-v">—</div></div>
        <div class="kpi" id="kFuel"><div class="kpi-k">Fuel</div><div class="kpi-v">—</div></div>
        <div class="kpi" id="kRoute"><div class="kpi-k">To destination</div><div class="kpi-v">—</div></div>
        <div class="kpi opt opt2" id="kRest"><div class="kpi-k">Next rest</div><div class="kpi-v">—</div></div>
        <div class="kpi opt opt2" id="kDeadline"><div class="kpi-k">Deadline</div><div class="kpi-v">—</div></div>
        <div class="kpi opt" id="kEco" title="Eco-driving score for this trip"><div class="kpi-k">Eco score</div><div class="kpi-v">—</div></div>
        <div class="kpi opt" id="kAlerts"><div class="kpi-k">Alerts</div><div class="kpi-v">0</div></div>
      </div>
      <div class="alert-bar" id="v16AlertBar"></div>`);

    q('#v16Theme').onclick = () => {
      const sel = document.getElementById('themeSelect');
      if (!sel || typeof prefs === 'undefined') return;
      let lastDark = 'kaw';
      try { lastDark = localStorage.getItem('kawV16LastDark') || 'kaw'; } catch {}
      if (prefs.theme === 'daylight') sel.value = lastDark;
      else { try { localStorage.setItem('kawV16LastDark', prefs.theme || 'kaw'); } catch {} sel.value = 'daylight'; }
      sel.dispatchEvent(new Event('change'));
    };
    q('#kAlerts').style.cursor = 'pointer';
    q('#kAlerts').onclick = () => go('alerts');
  }

  const setKpi = (id, value, level = '') => {
    const el = q('#' + id); if (!el) return;
    q('.kpi-v', el).innerHTML = value;
    el.classList.toggle('warn', level === 'warn');
    el.classList.toggle('crit', level === 'crit');
  };

  let seenAlerts = null;
  function renderChrome(d) {
    if (!d || !d.updatedAt) return;
    const t = d.truck || {}, nav = d.navigation || {}, job = d.job || {}, al = d.alerts || {};
    const active = al.active || [];
    const byId = Object.fromEntries(active.map(a => [a.id, a]));
    const lvl = id => byId[id] ? (byId[id].severity === 'critical' ? 'crit' : 'warn') : '';

    const limit = Number(nav.speedLimitMph);
    const sign = q('#v16Limit');
    if (sign) {
      q('.ls-v', sign).textContent = limit > 5 ? Math.round(limit / 5) * 5 : '—';
      sign.classList.toggle('none', !(limit > 5));
      sign.classList.toggle('over', Boolean(al.overspeed?.active));
    }
    setKpi('kSpeed', d.connected ? `${Math.round(t.speedMph || 0)}<small>mph</small>` : '<small>offline</small>', lvl('overspeed'));
    const pct = fin(t.fuelGallons) && Number(t.fuelCapacityGallons) ? (t.fuelGallons / t.fuelCapacityGallons) * 100 : null;
    setKpi('kFuel', pct === null ? '—' : `${Math.round(pct)}%<small>${fin(t.fuelRangeMiles) ? int(t.fuelRangeMiles) + ' mi' : ''}</small>`, lvl('fuel'));
    setKpi('kRoute', job.active && fin(nav.distanceMiles) ? `${f1(nav.distanceMiles)}<small>mi · ${gameTime((nav.etaSeconds || 0) / 60)}</small>` : '<small>no job</small>');
    setKpi('kRest', fin(nav.restStopMinutes) && nav.restStopMinutes > 0 ? gameTime(nav.restStopMinutes) : '—', lvl('fatigue'));
    const left = nav.deadlineMinutesRemaining;
    setKpi('kDeadline', job.active && fin(left) && Math.abs(left) < 5e6 ? (left < 0 ? 'LATE' : gameTime(left)) : '—', lvl('deadline'));
    const eco = d.trip?.eco;
    setKpi('kEco', eco && (d.trip.movingSeconds || 0) > 60 ? `${eco.score}<small>${eco.grade}</small>` : '—', eco && d.trip.movingSeconds > 60 ? (eco.score < 60 ? 'crit' : eco.score < 75 ? 'warn' : '') : '');
    setKpi('kAlerts', String(active.length), active.some(a => a.severity === 'critical') ? 'crit' : active.length ? 'warn' : '');

    const badge = q('#v16AlertBadge');
    if (badge) { badge.textContent = active.length; badge.classList.toggle('show', active.length > 0); }

    const bar = q('#v16AlertBar');
    if (bar) {
      // The Drive-page banner shows the three most important alerts; speeding is shown by the sign.
      const shown = active.filter(a => a.id !== 'overspeed' || a.severity === 'critical').slice(0, 3);
      bar.innerHTML = shown.map(a => `<div class="alert-chip ${a.severity}"><div class="ai">${a.severity === 'critical' ? '!' : 'i'}</div><div><b>${esc(a.title)}</b><span>${esc(a.detail)}</span></div><div class="ax">${ago(a.since)}</div></div>`).join('');
    }

    // Toast + chime for newly raised critical alerts (not for ones already active when the page opened).
    const ids = new Set(active.map(a => `${a.id}:${a.severity}`));
    for (const a of active) {
      const key = `${a.id}:${a.severity}`;
      if (seenAlerts && !seenAlerts.has(key) && a.severity === 'critical') {
        notify(a.title, a.detail, 'critical');
        if (typeof sound === 'function') sound('critical');
      }
    }
    seenAlerts = ids;
  }

  // ---------- page shells ----------
  const PAGES = {
    dispatch: `
      <div class="v16-grid v16-2">
        <div class="v16-stack">
          <div class="panel"><div class="panel-head"><div class="panel-title">Active Dispatch</div><div id="dActiveStatus"></div></div><div id="dActive"></div></div>
          <div class="panel"><div class="panel-head"><div class="panel-title">Plan a Dispatch</div><div class="muted" style="font-size:12px">Single or multi-stop runs</div></div>
            <div class="v16-body v16-stack">
              <div class="v16-field"><label for="dTitle">Title</label><input id="dTitle" class="v16-input" placeholder="e.g. Nevada lumber run"></div>
              <div class="v16-section-title">Stops</div>
              <div id="dStops" class="v16-stack"></div>
              <div class="v16-row"><button class="cmd small" id="dAddStop" type="button">+ Add stop</button><button class="cmd small" id="dFromJob" type="button">Use current job</button></div>
              <div class="v16-field"><label for="dNotes">Notes</label><textarea id="dNotes" class="v16-input" placeholder="Optional"></textarea></div>
              <div class="v16-row"><button class="cmd primary" id="dCreateStart" type="button">Create &amp; start</button><button class="cmd" id="dCreate" type="button">Save as planned</button></div>
            </div></div>
        </div>
        <div class="v16-stack">
          <div class="panel"><div class="panel-head"><div class="panel-title">Recent Dispatches</div><div class="muted" id="dCounts" style="font-size:12px"></div></div><div id="dRecent" class="v16-list"></div></div>
          <div class="panel"><div class="panel-head"><div class="panel-title">Bills of Lading</div><div class="muted" style="font-size:12px">Saved when a dispatch completes</div></div><div id="dBols" class="v16-list"></div></div>
        </div>
      </div>`,
    career: `
      <div class="v16-grid v16-2">
        <div class="panel"><div class="panel-head"><div class="panel-title">Driver Career</div><div class="muted" id="cUpdated" style="font-size:12px"></div></div>
          <div class="v16-body" style="display:grid;grid-template-columns:150px 1fr;gap:18px;align-items:center">
            <div class="level-ring" id="cRing"><div><span>LEVEL</span><b id="cLevel">1</b></div></div>
            <div class="v16-stack"><div><div style="font-size:22px;font-weight:800" id="cName">Driver</div><div class="muted" id="cXp">0 XP</div></div><div class="v16-bar"><span id="cXpBar" style="width:0"></span></div><div class="v16-note" id="cNext"></div></div>
          </div>
          <div class="v16-kpis" id="cStats"></div>
        </div>
        <div class="panel"><div class="panel-head"><div class="panel-title">How XP works</div></div><div class="v16-body v16-note">
          Every completed dispatch earns <b>100 XP</b> plus <b>1 XP per mile</b>. Clean deliveries (1% cargo damage or less) add <b>50 XP</b>, and multi-stop runs add <b>150 XP</b>.
          Dispatches are created automatically when you take a job in ATS, or plan your own on the Dispatch page.</div></div>
      </div>
      <div class="panel" style="margin-top:12px"><div class="panel-head"><div class="panel-title">Achievements</div><div class="muted" id="cAchCount" style="font-size:12px"></div></div><div class="ach-grid" id="cAch"></div></div>`,
    preflight: `
      <div class="panel"><div class="panel-head"><div class="panel-title">Convoy Readiness</div><div id="pOverall"></div></div>
        <div class="v16-kpis" id="pKpis"></div>
        <div class="table-wrap"><table class="table"><thead><tr><th>Driver</th><th>Status</th><th>Score</th><th>Game</th><th>Missing DLC</th><th>Missing mods</th><th>Load order</th></tr></thead><tbody id="pRows"></tbody></table></div>
      </div>
      <div class="v16-grid v16-2" style="margin-top:12px">
        <div class="panel"><div class="panel-head"><div class="panel-title">Convoy Manifest</div><div class="muted" id="pEditing" style="font-size:12px">New manifest</div></div>
          <div class="v16-body v16-stack">
            <div class="v16-grid v16-2"><div class="v16-field"><label for="pName">Name</label><input id="pName" class="v16-input" placeholder="Friday night convoy"></div><div class="v16-field"><label for="pVer">Game version</label><input id="pVer" class="v16-input" placeholder="Any"></div></div>
            <div class="v16-field"><label for="pDlc">Required DLC (comma separated)</label><input id="pDlc" class="v16-input" placeholder="dlc_nm, dlc_ut, dlc_id"></div>
            <div class="v16-section-title">Mods (in load order)</div>
            <div id="pMods" class="v16-stack"></div>
            <div class="v16-row"><button class="cmd small" id="pAddMod" type="button">+ Add mod</button><button class="cmd small" id="pFromMine" type="button">Copy my current setup</button></div>
            <div class="v16-field"><label for="pNotes">Notes for drivers</label><textarea id="pNotes" class="v16-input"></textarea></div>
            <div class="v16-row"><button class="cmd primary" id="pSave" type="button">Save manifest</button><button class="cmd" id="pNew" type="button">Start new</button></div>
          </div></div>
        <div class="panel"><div class="panel-head"><div class="panel-title">Saved Manifests</div></div><div id="pList" class="v16-list"></div></div>
      </div>`,
    sessions: `
      <div class="v16-grid v16-2">
        <div class="panel"><div class="panel-head"><div class="panel-title">Active Convoy Session</div><div id="sStatus"></div></div><div id="sActive"></div></div>
        <div class="panel"><div class="panel-head"><div class="panel-title">Plan a Convoy</div></div>
          <div class="v16-body v16-stack">
            <div class="v16-grid v16-2"><div class="v16-field"><label for="sName">Convoy name</label><input id="sName" class="v16-input" placeholder="KAW Convoy"></div><div class="v16-field"><label for="sHost">Host</label><input id="sHost" class="v16-input"></div></div>
            <div class="v16-grid v16-2"><div class="v16-field"><label for="sMeet">Meet point</label><input id="sMeet" class="v16-input" placeholder="Sacramento truck stop"></div><div class="v16-field"><label for="sDest">Destination</label><input id="sDest" class="v16-input" placeholder="Las Vegas"></div></div>
            <div class="v16-field"><label for="sTime">Departure</label><input id="sTime" class="v16-input" type="datetime-local"></div>
            <div class="v16-field"><label for="sNotes">Notes</label><textarea id="sNotes" class="v16-input"></textarea></div>
            <div class="v16-row"><button class="cmd primary" id="sCreate" type="button">Create convoy</button></div>
          </div></div>
      </div>
      <div class="panel" style="margin-top:12px"><div class="panel-head"><div class="panel-title">Convoy History</div></div><div id="sRecent" class="v16-list"></div></div>`,
    alerts: `
      <div class="v16-grid v16-2">
        <div class="v16-stack">
          <div class="panel"><div class="panel-head"><div class="panel-title">Active Alerts</div><div class="muted" style="font-size:12px">Live</div></div><div id="aActive" class="v16-list"></div></div>
          <div class="panel"><div class="panel-head"><div class="panel-title">Alert History</div></div><div id="aHistory" class="v16-list"></div></div>
        </div>
        <div class="v16-stack">
          <div class="panel"><div class="panel-head"><div class="panel-title">Alert Thresholds</div><div id="aEditNote" class="muted" style="font-size:12px"></div></div>
            <div class="v16-body v16-stack" id="aForm">
              <label class="v16-toggle"><span><b>Driver alerts</b><div class="v16-note">Fuel, rest, damage, cargo, speed, deadline and warning lights</div></span><input type="checkbox" id="aEnabled"></label>
              <div class="v16-grid v16-3">
                <div class="v16-field"><label for="aFuel">Low fuel at (%)</label><input id="aFuel" class="v16-input" type="number" min="5" max="50"></div>
                <div class="v16-field"><label for="aRest">Rest warning (min)</label><input id="aRest" class="v16-input" type="number" min="15" max="240"></div>
                <div class="v16-field"><label for="aDmg">Truck damage (%)</label><input id="aDmg" class="v16-input" type="number" min="1" max="90"></div>
                <div class="v16-field"><label for="aCargo">Cargo damage (%)</label><input id="aCargo" class="v16-input" type="number" min="1" max="90"></div>
                <div class="v16-field"><label for="aSpeed">Speed tolerance (mph)</label><input id="aSpeed" class="v16-input" type="number" min="0" max="15"></div>
                <div class="v16-field"><label for="aDead">Deadline warning (min)</label><input id="aDead" class="v16-input" type="number" min="10" max="600"></div>
              </div>
              <div class="v16-row"><button class="cmd primary" id="aSave" type="button">Save thresholds</button></div>
            </div></div>
          <div class="panel"><div class="panel-head"><div class="panel-title">Discord Trip Summaries</div><div id="aDiscordState"></div></div>
            <div class="v16-body v16-stack" id="aDiscordForm">
              <label class="v16-toggle"><span><b>Post to Discord</b><div class="v16-note">A summary card after every delivery or cancelled job</div></span><input type="checkbox" id="aDEnabled"></label>
              <div class="v16-field"><label for="aDUrl">Channel webhook URL</label><input id="aDUrl" class="v16-input" type="password" autocomplete="off" placeholder="https://discord.com/api/webhooks/…"></div>
              <div class="v16-note">Discord → Channel settings → Integrations → Webhooks → Copy URL. It is stored only in this PC's config.json and is never shown again or sent to the convoy relay.</div>
              <label class="v16-toggle"><span>Trip summaries</span><input type="checkbox" id="aDTrips"></label>
              <label class="v16-toggle"><span>Achievement unlocks</span><input type="checkbox" id="aDAch"></label>
              <label class="v16-toggle"><span>Include income</span><input type="checkbox" id="aDIncome"></label>
              <div class="v16-row"><button class="cmd primary" id="aDSave" type="button">Save</button><button class="cmd" id="aDTest" type="button">Send test</button><button class="cmd danger" id="aDClear" type="button">Remove webhook</button></div>
            </div></div>
          <div class="panel"><div class="panel-head"><div class="panel-title">Voice Dispatcher</div><div class="muted" style="font-size:12px">Windows speech</div></div>
            <div class="v16-body v16-stack" id="aVoiceForm">
              <label class="v16-toggle"><span><b>Spoken alerts</b><div class="v16-note">Job events, stops, achievements and critical alerts read aloud on this PC</div></span><input type="checkbox" id="aVEnabled"></label>
              <div class="v16-grid v16-3">
                <div class="v16-field"><label for="aVRate">Rate (-10 to 10)</label><input id="aVRate" class="v16-input" type="number" min="-10" max="10"></div>
                <div class="v16-field"><label for="aVVol">Volume (0-100)</label><input id="aVVol" class="v16-input" type="number" min="0" max="100"></div>
                <div class="v16-field"><label for="aVPrefix">Call sign</label><input id="aVPrefix" class="v16-input" maxlength="60"></div>
              </div>
              <div class="v16-row"><button class="cmd primary" id="aVSave" type="button">Save</button><button class="cmd" id="aVTest" type="button">Test voice</button></div>
            </div></div>
        </div>
      </div>`
  };

  function buildPages() {
    const footer = q('.main .footer');
    for (const [name, html] of Object.entries(PAGES)) {
      const s = document.createElement('section');
      s.id = `page-${name}`; s.className = 'page'; s.innerHTML = html;
      footer ? footer.before(s) : q('.main').append(s);
    }

    // Earnings analytics on top of the Stats page.
    q('#page-stats')?.insertAdjacentHTML('afterbegin', `
      <div class="panel" style="margin-bottom:12px"><div class="panel-head"><div class="panel-title">Earnings</div>
        <div class="v16-row"><select id="eRange" class="v16-input" style="width:auto;min-height:36px;padding:5px 10px"><option value="7">Last 7 days</option><option value="30" selected>Last 30 days</option><option value="90">Last 90 days</option><option value="0">All time</option></select><a class="cmd small" href="/api/trips.csv" download style="text-decoration:none;display:inline-grid;place-items:center">Export CSV</a></div></div>
        <div class="v16-kpis" id="eKpis"></div>
        <div class="v16-body"><div class="v16-section-title">Income per day</div><svg class="chart" id="eChart" role="img" aria-label="Income per day"></svg></div>
      </div>
      <div class="v16-grid v16-3" style="margin-bottom:12px">
        <div class="panel"><div class="panel-head"><div class="panel-title">Top cargo by income</div></div><div class="v16-body" id="eCargo"></div></div>
        <div class="panel"><div class="panel-head"><div class="panel-title">Most driven routes</div></div><div class="v16-body" id="eRoutes"></div></div>
        <div class="panel"><div class="panel-head"><div class="panel-title">Records</div></div><div class="v16-body" id="eRecords"></div></div>
      </div>
      <div class="v16-section-title" style="margin:0 0 8px">All-time totals</div>`);

    // Search + export on Trip History.
    const tripsHead = q('#page-trips .panel-head');
    if (tripsHead) {
      const extra = document.createElement('div'); extra.className = 'v16-row';
      extra.innerHTML = '<input id="tSearch" class="v16-input" style="width:220px;min-height:36px;padding:5px 10px" placeholder="Search cargo or city"><a class="cmd small" href="/api/trips.csv" download style="text-decoration:none;display:inline-grid;place-items:center">Export CSV</a>';
      tripsHead.lastElementChild.replaceWith(extra);
      q('#tSearch').oninput = filterTrips;
    }

    // Live roster cards on the Convoy page.
    q('#page-convoy')?.insertAdjacentHTML('afterbegin', `<div class="panel" style="margin-bottom:12px"><div class="panel-head"><div class="panel-title">Live Roster</div><div class="muted" id="rSummary" style="font-size:12px"></div></div><div class="roster-grid" id="rGrid"></div></div>`);

    document.body.insertAdjacentHTML('beforeend', '<div class="v16-modal" id="v16Modal" role="dialog" aria-modal="true"><div class="v16-modal-card"><div class="v16-row" style="justify-content:space-between;margin-bottom:10px"><b id="v16ModalTitle"></b><div class="v16-row"><button class="cmd small" id="v16Print" type="button">Print</button><button class="cmd small" id="v16Close" type="button">Close</button></div></div><div id="v16ModalBody"></div></div></div>');
    q('#v16Close').onclick = () => q('#v16Modal').classList.remove('open');
    q('#v16Modal').onclick = e => { if (e.target.id === 'v16Modal') q('#v16Modal').classList.remove('open'); };
    q('#v16Print').onclick = () => window.print();
  }

  function filterTrips() {
    const term = (q('#tSearch')?.value || '').trim().toLowerCase();
    for (const tr of qa('#tripRows tr')) tr.style.display = !term || tr.textContent.toLowerCase().includes(term) ? '' : 'none';
  }

  // ---------- Dispatch ----------
  const stopRow = (s = {}) => {
    const row = document.createElement('div');
    row.className = 'stop-editor';
    row.innerHTML = `
      <div class="v16-field"><label>From</label><input class="v16-input" data-k="origin" value="${esc(s.origin)}" placeholder="Origin city"></div>
      <div class="v16-field"><label>To</label><input class="v16-input" data-k="destination" value="${esc(s.destination)}" placeholder="Destination city"></div>
      <div class="v16-field"><label>Cargo</label><input class="v16-input" data-k="cargo" value="${esc(s.cargo)}"></div>
      <div class="v16-field"><label>Miles</label><input class="v16-input" data-k="plannedMiles" type="number" min="0" value="${esc(s.plannedMiles || '')}"></div>
      <div class="v16-field"><label>Pay ($)</label><input class="v16-input" data-k="plannedIncome" type="number" min="0" value="${esc(s.plannedIncome || '')}"></div>
      <button class="cmd small danger" type="button" title="Remove stop" aria-label="Remove stop">✕</button>`;
    q('button', row).onclick = () => { row.remove(); if (!qa('#dStops .stop-editor').length) q('#dStops').append(stopRow()); };
    return row;
  };
  const readStops = () => qa('#dStops .stop-editor').map(r => Object.fromEntries(qa('input', r).map(i => [i.dataset.k, i.type === 'number' ? Number(i.value || 0) : i.value.trim()])));

  async function createDispatch(start) {
    const body = { title: q('#dTitle').value.trim(), notes: q('#dNotes').value.trim(), stops: readStops() };
    const { dispatch } = await api('/api/dispatch', { method: 'POST', body });
    if (start) await api(`/api/dispatch/${encodeURIComponent(dispatch.id)}/start`, { method: 'POST' });
    q('#dTitle').value = ''; q('#dNotes').value = ''; q('#dStops').replaceChildren(stopRow());
    notify(start ? 'Dispatch started' : 'Dispatch saved', dispatch.title, 'join');
    loadDispatch();
  }

  function renderActiveDispatch(active) {
    q('#dActiveStatus').innerHTML = active ? statusPill(active.status) : '';
    if (!active) { q('#dActive').innerHTML = '<div class="v16-empty"><b>No active dispatch</b>Take a job in ATS and one is created automatically, or plan a run below.</div>'; return; }
    const stops = active.stops || [];
    const done = stops.filter(s => s.status === 'completed').length;
    q('#dActive').innerHTML = `
      <div class="v16-body" style="padding-bottom:4px"><div style="font-size:19px;font-weight:800">${esc(active.title)}</div><div class="muted" style="font-size:12.5px;margin-top:3px">${done} of ${stops.length} stops · started ${ago(active.startedAt)}</div>
        <div class="v16-bar" style="margin-top:10px"><span style="width:${stops.length ? (done / stops.length) * 100 : 0}%"></span></div></div>
      <div class="stop-track">${stops.map((s, i) => `<div class="stop ${esc(s.status)}"><div class="dot">${s.status === 'completed' ? '✓' : i + 1}</div><div><div style="font-weight:700">${esc(s.origin || '?')} → ${esc(s.destination || '?')}</div><div class="muted" style="font-size:12.5px">${esc(s.cargo || 'Cargo')} · ${int(s.actualMiles || s.plannedMiles)} mi</div></div><div style="text-align:right;font-weight:700">${cash(s.actualIncome || s.plannedIncome)}</div></div>`).join('')}</div>
      <div class="v16-body v16-row" style="padding-top:0"><button class="cmd primary" id="dComplete" type="button">Complete current stop</button><button class="cmd danger" id="dCancel" type="button">Cancel dispatch</button></div>`;
    q('#dComplete').onclick = guard(async () => { const d = telem(); await api(`/api/dispatch/${encodeURIComponent(active.id)}/complete-stop`, { method: 'POST', body: { damagePercent: d?.damage?.cargoPercent || 0 } }); notify('Stop completed', '', 'join'); loadDispatch(); });
    q('#dCancel').onclick = guard(async () => { if (!confirm('Cancel this dispatch?')) return; await api(`/api/dispatch/${encodeURIComponent(active.id)}/cancel`, { method: 'POST' }); loadDispatch(); });
  }

  const loadDispatch = guard(async () => {
    const [summary, bols] = await Promise.all([api('/api/dispatch'), api('/api/bols?limit=25')]);
    renderActiveDispatch(summary.active);
    q('#dCounts').textContent = Object.entries(summary.counts || {}).map(([k, v]) => `${v} ${k}`).join(' · ');
    const recent = summary.recent || [];
    q('#dRecent').innerHTML = recent.length ? recent.map(d => `<div class="v16-item"><div class="grow"><div class="t">${esc(d.title)}</div><div class="d">${(d.stops || []).length} stop(s) · ${esc(d.source === 'telemetry-auto' ? 'from ATS job' : 'planned')} · ${ago(d.updatedAt)}</div></div>${statusPill(d.status)}${['planned', 'paused'].includes(d.status) ? `<button class="cmd small" data-start="${esc(d.id)}" type="button">Start</button>` : ''}</div>`).join('') : '<div class="v16-empty">No dispatches yet.</div>';
    qa('[data-start]', q('#dRecent')).forEach(b => b.onclick = guard(async () => { await api(`/api/dispatch/${encodeURIComponent(b.dataset.start)}/start`, { method: 'POST' }); loadDispatch(); }));
    q('#dBols').innerHTML = bols.length ? bols.map(b => `<div class="v16-item"><div class="grow"><div class="t">${esc(b.number)}</div><div class="d">${esc(b.origin)} → ${esc(b.destination)} · ${int(b.actualMiles || b.plannedMiles)} mi · ${cash(b.actualIncome || b.plannedIncome)}</div></div><div class="muted" style="font-size:12px">${dateTime(b.completedAt)}</div><button class="cmd small" data-bol="${esc(b.id)}" type="button">View</button></div>`).join('') : '<div class="v16-empty">Bills of lading appear here after a dispatch is completed.</div>';
    qa('[data-bol]', q('#dBols')).forEach(b => b.onclick = () => showBol(bols.find(x => x.id === b.dataset.bol)));
  });

  function showBol(b) {
    if (!b) return;
    q('#v16ModalTitle').textContent = `Bill of Lading ${b.number}`;
    q('#v16ModalBody').innerHTML = `<div class="bol-doc"><h2>BILL OF LADING</h2><div>No. <b>${esc(b.number)}</b> · ${dateTime(b.completedAt)}</div>
      <table><tr><th>Carrier / driver</th><td>${esc(b.driver)}</td><th>Truck</th><td>${esc([b.truck?.make, b.truck?.model].filter(Boolean).join(' ') || '—')}${b.truck?.licensePlate ? ` (${esc(b.truck.licensePlate)})` : ''}</td></tr>
      <tr><th>Shipper</th><td>${esc(b.origin)}</td><th>Consignee</th><td>${esc(b.destination)}</td></tr>
      <tr><th>Commodity</th><td colspan="3">${esc(b.cargo || '—')}</td></tr></table>
      <table><thead><tr><th>#</th><th>From</th><th>To</th><th>Cargo</th><th>Miles</th><th>Freight</th><th>Delivered</th></tr></thead><tbody>${(b.stops || []).map(s => `<tr><td>${s.order}</td><td>${esc(s.origin)}</td><td>${esc(s.destination)}</td><td>${esc(s.cargo)}</td><td>${int(s.actualMiles || s.plannedMiles)}</td><td>${cash(s.actualIncome || s.plannedIncome)}</td><td>${dateTime(s.completedAt)}</td></tr>`).join('')}</tbody>
      <tfoot><tr><th colspan="4">Total</th><th>${int(b.actualMiles || b.plannedMiles)}</th><th>${cash(b.actualIncome || b.plannedIncome)}</th><th></th></tr></tfoot></table>
      <p style="font-size:11px;color:#555;margin-top:14px">Generated by KAW'S ATS Playground Companion. For in-game record keeping only.</p></div>`;
    q('#v16Modal').classList.add('open');
  }

  // ---------- Career ----------
  const ACH_ICONS = { first_delivery: '🚚', road_regular: '🛣️', century_club: '💯', thousand_miler: '🧭', multi_stop_master: '📦', clean_machine: '✨', high_earner: '💰', fifty_loads: '🏁', ten_thousand_miler: '🌎', long_hauler: '🌙', spotless_25: '🛡️', millionaire_x5: '👑', convoy_rookie: '🚛', convoy_regular: '🛻', convoy_legend: '🦅', perfect_formation: '🏅', convoy_long_haul: '🗺️', big_convoy: '🎺', challenger: '🎯', challenge_streak: '🔥' };
  const loadCareer = guard(async () => {
    const c = await api('/api/career');
    const prevLevelXp = Math.pow(Math.max(0, (c.level || 1) - 1), 2) * 500;
    const p = c.nextLevelXp > prevLevelXp ? ((c.xp - prevLevelXp) / (c.nextLevelXp - prevLevelXp)) * 100 : 0;
    q('#cLevel').textContent = c.level || 1;
    q('#cRing').style.setProperty('--p', Math.max(0, Math.min(100, p)).toFixed(1));
    q('#cName').textContent = c.driverName || 'Driver';
    q('#cXp').textContent = `${int(c.xp)} XP`;
    q('#cXpBar').style.width = `${Math.max(0, Math.min(100, p))}%`;
    q('#cNext').textContent = `${int(Math.max(0, c.nextLevelXp - c.xp))} XP to level ${(c.level || 1) + 1}`;
    q('#cUpdated').textContent = c.updatedAt ? `Updated ${ago(c.updatedAt)}` : '';
    const r = c.records || {};
    q('#cStats').innerHTML = [['Deliveries', int(c.deliveries)], ['Miles', int(c.totalMiles)], ['Income', cash(c.totalIncome)], ['Clean deliveries', int(c.cleanDeliveries)], ['Multi-stop runs', int(c.multiStopRuns)], ['Longest run', `${int(r.longestRunMiles)} mi`], ['Best payout', cash(r.bestIncome)]].map(([k, v]) => `<div><div class="k">${k}</div><div class="v">${v}</div></div>`).join('');
    const all = c.availableAchievements || [];
    const when = Object.fromEntries((c.achievements || []).map(a => [a.id, a.unlockedAt]));
    q('#cAchCount').textContent = `${all.filter(a => a.unlocked).length} of ${all.length} unlocked`;
    q('#cAch').innerHTML = all.map(a => `<div class="ach ${a.unlocked ? 'unlocked' : ''}"><div class="ai">${ACH_ICONS[a.id] || '🏆'}</div><div><b>${esc(a.name)}</b><span>${a.unlocked ? `Unlocked ${ago(when[a.id])}` : 'Locked'}</span></div></div>`).join('');
  });

  // ---------- Earnings ----------
  function barChart(svg, rows) {
    const W = svg.clientWidth || 800, H = 220, pad = { l: 56, r: 8, t: 10, b: 24 };
    const max = Math.max(1, ...rows.map(r => r.income));
    const step = Math.pow(10, Math.floor(Math.log10(max)));
    const top = Math.ceil(max / step) * step;
    const bw = (W - pad.l - pad.r) / Math.max(1, rows.length);
    const y = v => pad.t + (H - pad.t - pad.b) * (1 - v / top);
    const grid = [0, .25, .5, .75, 1].map(f => `<line class="grid" x1="${pad.l}" x2="${W - pad.r}" y1="${y(top * f)}" y2="${y(top * f)}"/><text class="axis" x="${pad.l - 6}" y="${y(top * f) + 3}" text-anchor="end">${top * f >= 1000 ? '$' + Math.round(top * f / 1000) + 'k' : '$' + Math.round(top * f)}</text>`).join('');
    const labelEvery = Math.ceil(rows.length / 10);
    const bars = rows.map((r, i) => {
      const x = pad.l + i * bw + bw * 0.15, h = Math.max(0, y(0) - y(r.income));
      const label = i % labelEvery === 0 ? `<text class="axis" x="${x + bw * 0.35}" y="${H - 6}" text-anchor="middle">${new Date(r.date + 'T12:00').toLocaleDateString([], { month: 'numeric', day: 'numeric' })}</text>` : '';
      return `<rect class="bar" x="${x}" y="${y(0) - h}" width="${Math.max(1, bw * 0.7)}" height="${h}" rx="3"><title>${r.date}: ${cash(r.income)} · ${r.trips} trip(s) · ${f1(r.miles)} mi</title></rect>${label}`;
    }).join('');
    svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
    svg.innerHTML = grid + bars;
  }
  const hbars = (list, fmt) => {
    if (!list?.length) return '<div class="v16-note">No data yet.</div>';
    const max = Math.max(...list.map(x => x.value), 1);
    return list.map(x => `<div class="hbar"><div class="n" title="${esc(x.name)}">${esc(x.name)}</div><div class="val">${fmt(x.value)}</div><div class="v16-bar"><span style="width:${(x.value / max) * 100}%"></span></div></div>`).join('');
  };
  const loadEarnings = guard(async () => {
    const a = await api(`/api/analytics?days=${q('#eRange').value}`);
    q('#eKpis').innerHTML = [
      ['Income', cash(a.income), `${a.delivered} delivered · ${a.cancelled} cancelled`],
      ['Miles', int(a.miles), `${f1(a.drivingHours)} h driving`],
      ['Per mile', `$${(a.incomePerMile || 0).toFixed(2)}`, `${cash(a.avgIncome)} per load`],
      ['Fuel economy', `${(a.mpg || 0).toFixed(2)} mpg`, `${int(a.fuelGallons)} gal used`],
      ['Avg speed', `${Math.round(a.avgSpeedMph || 0)} mph`, `${Math.round(a.speedingMinutes || 0)} min speeding`],
      ['Clean loads', `${Math.round(a.cleanDeliveryPercent || 0)}%`, '≤ 1% cargo damage'],
      ['Eco score', a.ecoScore == null ? '—' : `${a.ecoScore}/100`, 'Average driving efficiency']
    ].map(([k, v, s]) => `<div><div class="k">${k}</div><div class="v">${v}</div><div class="s">${s}</div></div>`).join('');
    barChart(q('#eChart'), a.daily || []);
    q('#eCargo').innerHTML = hbars(a.topCargo, cash);
    q('#eRoutes').innerHTML = hbars(a.topRoutes, v => `${v} trip${v === 1 ? '' : 's'}`);
    const rec = (label, t, val) => t ? `<div class="v16-item" style="padding:9px 0"><div class="grow"><div class="t">${label}</div><div class="d">${esc(t.originCity || '?')} → ${esc(t.destinationCity || '?')} · ${esc(t.cargo || '')}</div></div><b>${val}</b></div>` : '';
    q('#eRecords').innerHTML = (rec('Best payout', a.bestTrip, cash(a.bestTrip?.deliveredIncome)) + rec('Longest trip', a.longestTrip, `${f1(a.longestTrip?.milesDriven)} mi`)) || '<div class="v16-note">Complete a delivery to set your first record.</div>';
  });

  // ---------- Pre-flight ----------
  let editingManifestId = null;
  const modRow = (m = {}) => {
    const row = document.createElement('div');
    row.className = 'v16-row';
    row.innerHTML = `<input class="v16-input" data-k="name" style="flex:2;min-width:140px" placeholder="Mod name" value="${esc(m.name)}"><input class="v16-input" data-k="workshopId" style="flex:1;min-width:110px" placeholder="Workshop ID or link" value="${esc(m.workshopId)}"><input class="v16-input" data-k="url" style="flex:1.4;min-width:140px" placeholder="Download link (non-Workshop)" value="${esc(m.url)}"><label class="v16-row" style="font-size:12px;color:var(--muted)"><input type="checkbox" data-k="required" ${m.required === false ? '' : 'checked'}> Required</label><button class="cmd small danger" type="button" aria-label="Remove mod">✕</button>`;
    q('button', row).onclick = () => row.remove();
    // Paste a Workshop link or ID and the real mod name comes straight from Steam.
    const wsInput = q('[data-k=workshopId]', row), nameInput = q('[data-k=name]', row);
    wsInput.onchange = guard(async () => {
      const id = (wsInput.value.match(/(\d{6,})/) || [])[1];
      if (!id) return;
      wsInput.value = id;
      const info = (await api(`/api/steam/workshop?ids=${id}`))[id];
      if (!info || info.missing) { wsInput.title = 'Not found on the Steam Workshop'; wsInput.style.borderColor = 'var(--red)'; return; }
      wsInput.style.borderColor = info.isAts === false ? 'var(--yellow)' : 'var(--green)';
      wsInput.title = info.isAts === false ? 'This Workshop item is not for ATS' : `${info.title} — updated ${new Date(info.updatedAt).toLocaleDateString()}`;
      if (!nameInput.value.trim()) nameInput.value = info.title;
    });
    return row;
  };
  const fillManifest = (m = null) => {
    editingManifestId = m?.id || null;
    q('#pEditing').textContent = m ? `Editing “${m.name}”` : 'New manifest';
    q('#pName').value = m?.name || ''; q('#pVer').value = m?.gameVersion || ''; q('#pDlc').value = (m?.requiredDlcTokens || []).join(', '); q('#pNotes').value = m?.notes || '';
    q('#pMods').replaceChildren(...(m?.mods || []).map(modRow));
  };
  const loadPreflight = guard(async () => {
    const [ev, man] = await Promise.all([api('/api/preflight'), api('/api/preflight/manifest')]);
    q('#pOverall').innerHTML = statusPill(ev.overall);
    q('#pKpis').innerHTML = [['Manifest', esc(ev.manifest?.name || 'None active')], ['Ready drivers', `${ev.readyCount} / ${ev.onlineCount}`], ['Required mods', (ev.manifest?.mods || []).filter(x => x.required).length], ['Required DLC', (ev.manifest?.requiredDlcTokens || []).length]].map(([k, v]) => `<div><div class="k">${k}</div><div class="v" style="font-size:18px">${v}</div></div>`).join('');
    q('#pRows').innerHTML = (ev.drivers || []).map(d => {
      const r = d.result || {}, g = (r.checks || []).find(c => c.key === 'gameVersion');
      return `<tr><td><b>${esc(d.driverName)}</b>${d.isLocal ? ' <span class="muted">(you)</span>' : ''}${d.online ? '' : ' <span class="muted">offline</span>'}</td><td>${statusPill(r.status)}</td><td>${r.score ?? '—'}</td><td class="${g?.ok === false ? 'bad' : ''}">${esc(g?.actual || '—')}</td><td class="${(r.missingDlc || []).length ? 'bad' : ''}">${esc((r.missingDlc || []).join(', ') || '—')}</td><td class="${(r.missingMods || []).length ? 'bad' : ''}">${esc((r.missingMods || []).map(m => m.name || m.workshopId).join(', ') || '—')}</td><td class="${(r.orderIssues || []).length ? 'warn' : ''}">${esc((r.orderIssues || []).join(', ') || 'OK')}</td></tr>`;
    }).join('') || '<tr><td colspan="7" class="muted">No drivers yet.</td></tr>';
    const activeId = man.active?.id;
    q('#pList').innerHTML = (man.manifests || []).length ? man.manifests.map(m => `<div class="v16-item"><div class="grow"><div class="t">${esc(m.name)}</div><div class="d">${(m.mods || []).length} mods · ${(m.requiredDlcTokens || []).length} DLC · updated ${ago(m.updatedAt)}</div></div>${m.id === activeId ? '<span class="v16-pill good">Active</span>' : `<button class="cmd small" data-act="${esc(m.id)}" type="button">Activate</button>`}<button class="cmd small" data-edit="${esc(m.id)}" type="button">Edit</button><button class="cmd small danger" data-del="${esc(m.id)}" type="button" aria-label="Delete">✕</button></div>`).join('') : '<div class="v16-empty"><b>No manifests</b>Create one so every driver can check their DLC and mods before the convoy.</div>';
    qa('[data-act]', q('#pList')).forEach(b => b.onclick = guard(async () => { await api(`/api/preflight/manifest/${encodeURIComponent(b.dataset.act)}/activate`, { method: 'POST' }); loadPreflight(); }));
    qa('[data-edit]', q('#pList')).forEach(b => b.onclick = () => fillManifest(man.manifests.find(m => m.id === b.dataset.edit)));
    qa('[data-del]', q('#pList')).forEach(b => b.onclick = guard(async () => { if (!confirm('Delete this manifest?')) return; await api(`/api/preflight/manifest/${encodeURIComponent(b.dataset.del)}`, { method: 'DELETE' }); if (editingManifestId === b.dataset.del) fillManifest(); loadPreflight(); }));
  });
  const saveManifest = guard(async () => {
    const body = {
      name: q('#pName').value.trim() || 'Convoy manifest', gameVersion: q('#pVer').value.trim(), notes: q('#pNotes').value.trim(),
      requiredDlcTokens: q('#pDlc').value.split(',').map(x => x.trim()).filter(Boolean),
      mods: qa('#pMods .v16-row').map((r, i) => ({ order: i + 1, name: q('[data-k=name]', r).value.trim(), workshopId: (q('[data-k=workshopId]', r).value.match(/(?:id=)?(\d{6,})/) || [])[1] || '', url: q('[data-k=url]', r).value.trim(), required: q('[data-k=required]', r).checked })).filter(m => m.name || m.workshopId || m.url)
    };
    const res = editingManifestId
      ? await api(`/api/preflight/manifest/${encodeURIComponent(editingManifestId)}`, { method: 'PATCH', body })
      : await api('/api/preflight/manifest', { method: 'POST', body });
    fillManifest(res.manifest);
    notify('Manifest saved', res.manifest.name, 'join');
    loadPreflight();
  });
  const copyMySetup = guard(async () => {
    const scan = await api('/api/intelligence/scan');
    const caps = scan.capabilities || {};
    q('#pDlc').value = (caps.dlcTokens || []).join(', ');
    if (caps.gameVersion) q('#pVer').value = caps.gameVersion;
    const mods = [...(caps.workshopIds || []).map(id => ({ workshopId: id, name: '' })), ...(caps.localModNames || []).map(name => ({ name }))];
    q('#pMods').replaceChildren(...mods.map(modRow));
    notify('Copied your setup', `${(caps.dlcTokens || []).length} DLC · ${mods.length} mods`, 'join');
  });

  // ---------- Convoy sessions ----------
  const loadSessions = guard(async () => {
    const s = await api('/api/convoy-sessions');
    const a = s.active;
    q('#sStatus').innerHTML = a ? statusPill('active') : '';
    if (!a) q('#sActive').innerHTML = '<div class="v16-empty"><b>No convoy running</b>Plan one on the right, then press Start when everyone is at the meet point.</div>';
    else {
      q('#sActive').innerHTML = `<div class="v16-body v16-stack"><div><div style="font-size:19px;font-weight:800">${esc(a.name)}</div><div class="muted" style="font-size:12.5px">Host ${esc(a.host)} · ${esc(a.meetPoint || '?')} → ${esc(a.destination || '?')} · started ${ago(a.startedAt)}</div></div>
        <div class="v16-section-title">Drivers (${(a.participants || []).length})</div><div class="v16-row">${(a.participants || []).map(p => `<span class="v16-pill ${p.online ? 'good' : 'muted'}">${esc(p.driverName)}</span>`).join('') || '<span class="muted">Roster snapshots are taken every minute.</span>'}</div>
        <div class="v16-section-title">Checkpoints</div><div class="v16-list">${(a.checkpoints || []).map(c => `<div class="v16-item" style="padding:8px 0"><div class="grow"><div class="t">${c.status === 'completed' ? '✓ ' : ''}${esc(c.name)}</div><div class="d">${esc(c.location || '')}${c.completedAt ? ` · reached ${ago(c.completedAt)}` : ''}</div></div>${c.status === 'completed' ? statusPill('completed') : `<button class="cmd small" data-cp="${esc(c.id)}" type="button">Reached</button>`}</div>`).join('') || '<div class="v16-note">No checkpoints yet.</div>'}</div>
        <div class="v16-row"><input class="v16-input" id="sCpName" style="flex:1" placeholder="Checkpoint name, e.g. Fuel at Barstow"><button class="cmd small" id="sCpAdd" type="button">Add</button></div>
        <div class="v16-row"><button class="cmd danger" id="sEnd" type="button">End convoy</button></div></div>`;
      qa('[data-cp]', q('#sActive')).forEach(b => b.onclick = guard(async () => { await api(`/api/convoy-sessions/${encodeURIComponent(a.id)}/checkpoints/${encodeURIComponent(b.dataset.cp)}/complete`, { method: 'POST' }); loadSessions(); }));
      q('#sCpAdd').onclick = guard(async () => { const name = q('#sCpName').value.trim(); if (!name) return; await api(`/api/convoy-sessions/${encodeURIComponent(a.id)}/checkpoints`, { method: 'POST', body: { name } }); loadSessions(); });
      q('#sEnd').onclick = guard(async () => { if (!confirm('End this convoy?')) return; await api(`/api/convoy-sessions/${encodeURIComponent(a.id)}/end`, { method: 'POST' }); notify('Convoy ended', a.name, 'leave'); loadSessions(); });
    }
    const recent = s.recent || [];
    q('#sRecent').innerHTML = recent.length ? recent.map(x => `<div class="v16-item" data-sid="${esc(x.id)}"><div class="grow"><div class="t">${esc(x.name)}</div><div class="d">${esc(x.meetPoint || '?')} → ${esc(x.destination || '?')} · ${x.departureTime ? 'departs ' + dateTime(x.departureTime) : 'created ' + ago(x.createdAt)} · ${(x.participants || []).length} drivers</div></div>${statusPill(x.status)}${x.status === 'planned' ? `<button class="cmd small primary" data-sstart="${esc(x.id)}" type="button">Start</button>` : ''}</div>`).join('') : '<div class="v16-empty">No convoys yet.</div>';
    qa('[data-sstart]', q('#sRecent')).forEach(b => b.onclick = guard(async () => { await api(`/api/convoy-sessions/${encodeURIComponent(b.dataset.sstart)}/start`, { method: 'POST' }); notify('Convoy started', '', 'join'); loadSessions(); }));
  });

  // ---------- Alerts & Discord ----------
  const alertItem = a => `<div class="v16-item"><div class="alert-chip ${a.severity}" style="padding:0;background:none;border:0"><div class="ai">${a.severity === 'critical' ? '!' : 'i'}</div></div><div class="grow"><div class="t">${esc(a.title)}</div><div class="d">${esc(a.detail)}</div></div><div class="muted" style="font-size:12px">${ago(a.raisedAt || a.since)}</div></div>`;
  function renderAlertLists(al) {
    if (!q('#aActive')) return;
    q('#aActive').innerHTML = (al?.active || []).length ? al.active.map(alertItem).join('') : '<div class="v16-empty"><b>All clear</b>No active alerts. Drive safe.</div>';
    q('#aHistory').innerHTML = (al?.history || []).length ? al.history.map(alertItem).join('') : '<div class="v16-empty">No alerts this session.</div>';
  }
  const loadSettings = guard(async () => {
    const s = await api('/api/settings');
    const a = s.alerts || {}, v = s.voice || {}, d = s.discord || {};
    q('#aEnabled').checked = a.enabled !== false;
    q('#aFuel').value = a.lowFuelPercent; q('#aRest').value = a.fatigueWarnMinutes; q('#aDmg').value = a.damageWarnPercent;
    q('#aCargo').value = a.cargoDamageWarnPercent; q('#aSpeed').value = a.overspeedToleranceMph; q('#aDead').value = a.deadlineWarnMinutes;
    q('#aVEnabled').checked = Boolean(v.enabled); q('#aVRate').value = v.rate ?? 0; q('#aVVol').value = v.volume ?? 85; q('#aVPrefix').value = v.prefix ?? '';
    q('#aDEnabled').checked = Boolean(d.enabled); q('#aDTrips').checked = d.tripSummaries !== false; q('#aDAch').checked = d.achievements !== false; q('#aDIncome').checked = d.includeIncome !== false;
    q('#aDUrl').value = ''; q('#aDUrl').placeholder = d.configured ? 'Webhook saved — paste a new one to replace it' : 'https://discord.com/api/webhooks/…';
    q('#aDiscordState').innerHTML = d.enabled && d.configured ? `<span class="v16-pill good">On</span>` : d.configured ? '<span class="v16-pill muted">Off</span>' : '<span class="v16-pill muted">Not set up</span>';
    if (d.lastError) q('#aDiscordState').innerHTML += ` <span class="v16-pill bad" title="${esc(d.lastError)}">Last post failed</span>`;
    const canEdit = s.canEdit !== false;
    for (const el of qa('#aForm input, #aForm button, #aDiscordForm input, #aDiscordForm button, #aVoiceForm input, #aVoiceForm button')) el.disabled = !canEdit;
    q('#aEditNote').textContent = canEdit ? '' : 'View only — change settings on the PC running the Companion';
  });
  const saveSection = (section, body, label) => guard(async () => { await api(`/api/settings/${section}`, { method: 'PATCH', body: body() }); notify(`${label} saved`, '', 'join'); loadSettings(); });

  // ---------- Convoy roster cards ----------
  function renderRoster(d) {
    const grid = q('#rGrid');
    if (!grid || !q('#page-convoy')?.classList.contains('active')) return;
    const c = d?.convoy || {}, roster = c.roster || [];
    q('#rSummary').textContent = `${c.online || 0} online · ${c.total || 0} drivers · ${c.sameRoute || 0} on your route`;
    const relCls = r => ({ 'YOUR ROUTE': 'info', 'SAME ROUTE': 'good', 'SAME DESTINATION': 'good', 'SAME ORIGIN': 'warn' }[r] || 'muted');
    grid.innerHTML = roster.map(p => {
      const t = p.truck || {}, j = p.job || {}, n = p.navigation || {};
      const fuel = fin(t.fuelGallons) && Number(t.fuelCapacityGallons) ? `${Math.round(t.fuelGallons / t.fuelCapacityGallons * 100)}%` : '—';
      const initials = String(p.driverName || '?').split(/\s+/).map(w => w[0]).join('').slice(0, 2).toUpperCase();
      return `<div class="driver-card ${p.isLocal ? 'local' : ''} ${p.online ? '' : 'offline'}">
        <div class="driver-top"><div class="avatar">${esc(initials)}<i class="${p.online ? 'on' : ''}"></i></div><div style="min-width:0;flex:1"><div class="driver-name">${esc(p.driverName)}${p.isLocal ? ' <span class="muted" style="font-weight:600">(you)</span>' : ''}</div><div class="driver-sub">${esc([t.make, t.model].filter(Boolean).join(' ') || 'Truck unknown')}</div></div><span class="v16-pill ${relCls(p.relation)}">${esc(p.relation || '')}</span></div>
        <div class="driver-sub">${j.active ? `${esc(j.cargo || 'Cargo')} · ${esc(j.originCity || '?')} → ${esc(j.destinationCity || '?')}` : 'No active job'}</div>
        <div class="driver-stats"><div><div class="k">Speed</div><div class="v">${fin(t.speedMph) ? Math.round(t.speedMph) : '—'}</div></div><div><div class="k">Left</div><div class="v">${fin(n.distanceMiles) ? f1(n.distanceMiles) : '—'}</div></div><div><div class="k">${p.isLocal ? 'Fuel' : 'Seen'}</div><div class="v">${p.isLocal ? fuel : (p.ageSeconds ?? 0) < 60 ? `${p.ageSeconds ?? 0}s` : `${Math.round((p.ageSeconds || 0) / 60)}m`}</div></div></div>
      </div>`;
    }).join('') || '<div class="v16-empty"><b>Just you so far</b>Drivers appear here when they pair with the same convoy relay.</div>';
  }

  // ---------- page lifecycle ----------
  const LOADERS = ext.loaders = { dispatch: loadDispatch, career: loadCareer, stats: loadEarnings, preflight: loadPreflight, sessions: loadSessions, alerts: loadSettings };
  let currentPage = null;
  function onPage(name) {
    currentPage = name;
    LOADERS[name]?.();
    if (name === 'alerts') renderAlertLists(telem()?.alerts);
  }

  function wire() {
    q('#dStops').append(stopRow());
    q('#dAddStop').onclick = () => q('#dStops').append(stopRow());
    q('#dFromJob').onclick = () => {
      const j = telem()?.job || {};
      if (!j.active) return notify('No active job', 'Take a job in ATS first.', 'leave');
      const rows = qa('#dStops .stop-editor');
      const blank = rows.find(r => !qa('input', r).some(i => i.value)) || (q('#dStops').append(stopRow()), qa('#dStops .stop-editor').at(-1));
      blank.replaceWith(stopRow({ origin: j.originCity, destination: j.destinationCity, cargo: j.cargo, plannedMiles: Math.round(j.plannedDistanceMiles || 0), plannedIncome: Number(j.income || 0) }));
      if (!q('#dTitle').value) q('#dTitle').value = `${j.originCity || ''} → ${j.destinationCity || ''}`;
    };
    q('#dCreate').onclick = guard(() => createDispatch(false));
    q('#dCreateStart').onclick = guard(() => createDispatch(true));
    q('#eRange').onchange = loadEarnings;
    q('#pAddMod').onclick = () => q('#pMods').append(modRow());
    q('#pFromMine').onclick = copyMySetup;
    q('#pSave').onclick = saveManifest;
    q('#pNew').onclick = () => fillManifest();
    q('#sCreate').onclick = guard(async () => {
      const t = q('#sTime').value;
      const body = { name: q('#sName').value.trim() || 'KAW Convoy', host: q('#sHost').value.trim() || undefined, meetPoint: q('#sMeet').value.trim(), destination: q('#sDest').value.trim(), departureTime: t ? new Date(t).toISOString() : null, notes: q('#sNotes').value.trim() };
      await api('/api/convoy-sessions', { method: 'POST', body });
      for (const id of ['sName', 'sMeet', 'sDest', 'sTime', 'sNotes']) q('#' + id).value = '';
      notify('Convoy planned', body.name, 'join');
      loadSessions();
    });
    q('#aSave').onclick = saveSection('alerts', () => ({ enabled: q('#aEnabled').checked, lowFuelPercent: +q('#aFuel').value, fatigueWarnMinutes: +q('#aRest').value, damageWarnPercent: +q('#aDmg').value, cargoDamageWarnPercent: +q('#aCargo').value, overspeedToleranceMph: +q('#aSpeed').value, deadlineWarnMinutes: +q('#aDead').value }), 'Alert thresholds');
    q('#aVSave').onclick = saveSection('voice', () => ({ enabled: q('#aVEnabled').checked, rate: +q('#aVRate').value, volume: +q('#aVVol').value, prefix: q('#aVPrefix').value }), 'Voice settings');
    q('#aVTest').onclick = guard(async () => { const r = await api('/api/settings/voice/test', { method: 'POST' }); notify(r.ok ? 'Speaking…' : 'Voice is off', r.ok ? '' : 'Turn on spoken alerts and save first.', r.ok ? 'join' : 'leave'); });
    q('#aDSave').onclick = saveSection('discord', () => ({ enabled: q('#aDEnabled').checked, webhookUrl: q('#aDUrl').value.trim(), tripSummaries: q('#aDTrips').checked, achievements: q('#aDAch').checked, includeIncome: q('#aDIncome').checked }), 'Discord settings');
    q('#aDTest').onclick = guard(async () => { await api('/api/settings/discord/test', { method: 'POST' }); notify('Test sent to Discord', 'Check your channel.', 'join'); loadSettings(); });
    q('#aDClear').onclick = guard(async () => { if (!confirm('Remove the saved Discord webhook?')) return; await api('/api/settings/discord', { method: 'PATCH', body: { webhookUrl: 'clear', enabled: false } }); notify('Webhook removed', '', 'leave'); loadSettings(); });
  }

  function init() {
    // Pages registered by extension modules: { name, icon, label, group, index, html, load, init }
    for (const pg of ext.pages) {
      NEW_PAGES[pg.name] = [pg.icon, pg.label];
      PAGES[pg.name] = pg.html;
      if (pg.load) LOADERS[pg.name] = pg.load;
      const grp = GROUPS.find(g => g[0] === pg.group) || GROUPS[GROUPS.length - 1];
      grp[1].splice(Math.max(0, Math.min(grp[1].length, pg.index ?? grp[1].length)), 0, pg.name);
    }
    buildNav();
    buildChrome();
    buildPages();
    wire();
    for (const pg of ext.pages) { try { pg.init?.(); } catch (e) { console.error('[KAW16]', pg.name, e); } }
    for (const fn of ext.onReady) { try { fn(); } catch (e) { console.error('[KAW16 ready]', e); } }

    // Hook page changes (showPage is a global function declaration, so reassigning it is seen by every caller).
    if (typeof showPage === 'function') {
      const original = showPage;
      window.showPage = name => { original(name); onPage(name); };
      const start = qa('.page.active')[0]?.id?.replace('page-', '');
      const requested = new URLSearchParams(location.search).get('page') || (() => { try { return localStorage.getItem('kawPage'); } catch { return null; } })();
      if (requested && NEW_PAGES[requested]) window.showPage(requested); else if (start) onPage(start);
    }

    // Live refresh: chrome + roster + alert lists every 500 ms; open data pages every 5 s.
    setInterval(() => {
      const d = telem();
      renderChrome(d);
      renderRoster(d);
      if (currentPage === 'alerts') renderAlertLists(d?.alerts);
      filterTrips();
      for (const fn of ext.onTick) { try { fn(d, currentPage); } catch (e) { console.error('[KAW16 tick]', e); } }
    }, 500);
    setInterval(() => { if (['dispatch', 'career', 'preflight', 'sessions'].includes(currentPage) && !document.activeElement?.matches?.('input,textarea,select')) LOADERS[currentPage]?.(); }, 5000);
    window.addEventListener('resize', () => { if (currentPage === 'stats') loadEarnings(); });
  }

  // Wait for DOMContentLoaded so deferred extension modules can register their pages first.
  if (document.readyState === 'complete') init(); else document.addEventListener('DOMContentLoaded', init);
})();
