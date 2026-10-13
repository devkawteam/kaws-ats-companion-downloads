/* KAW'S ATS Companion v1.6 — Journal, Leaderboard, Company (VTC), convoy events & RSVP, convoy replay. */
(() => {
  'use strict';
  const K = window.KAW16;
  if (!K) return;
  const { q, qa, esc, cash, ago, dateTime, api, guard, notify, go } = K;
  const money = v => cash(v);

  // =====================================================================
  // Screenshot journal
  // =====================================================================
  K.pages.push({
    name: 'journal', icon: '📷', label: 'Journal', group: 'Work', index: 3,
    html: `<div class="panel"><div class="panel-head"><div class="panel-title">Screenshot Journal</div><div class="muted" id="jNote" style="font-size:12px"></div></div><div id="jBody"></div></div>`,
    load: guard(async () => {
      const j = await api('/api/journal');
      q('#jNote').textContent = j.available ? `${j.shots.length} screenshots · ${j.folder}` : '';
      if (!j.available) { q('#jBody').innerHTML = `<div class="v16-empty"><b>No screenshot folder yet</b>Take a screenshot in ATS (F10 by default) and it will show up here, attached to the trip you were on.<div class="v16-note" style="margin-top:6px">Looking in: ${esc(j.folder)}</div></div>`; return; }
      if (!j.shots.length) { q('#jBody').innerHTML = '<div class="v16-empty"><b>No screenshots yet</b>Press F10 in ATS while you drive — they appear here and in your Discord trip summary.</div>'; return; }
      const groups = [];
      for (const s of j.shots) {
        const k = s.trip?.id || `day-${s.takenAt.slice(0, 10)}`;
        let g = groups.find(x => x.k === k);
        if (!g) groups.push(g = { k, trip: s.trip, day: s.takenAt.slice(0, 10), shots: [] });
        g.shots.push(s);
      }
      q('#jBody').innerHTML = groups.map(g => `<div class="j-group"><div class="j-title">${g.trip ? `🚚 ${esc(g.trip.cargo || 'Trip')} · ${esc(g.trip.originCity || '?')} → ${esc(g.trip.destinationCity || '?')} <span class="muted">${dateTime(g.trip.endedAt)}</span>` : `📅 ${new Date(g.day + 'T12:00').toLocaleDateString([], { weekday: 'long', month: 'short', day: 'numeric' })}`}</div>
        <div class="j-grid">${g.shots.map(s => `<button class="j-shot" type="button" data-shot="${esc(s.name)}" title="${esc(dateTime(s.takenAt))}"><img src="/api/journal/image/${encodeURIComponent(s.name)}" alt="Screenshot ${esc(dateTime(s.takenAt))}" loading="lazy"></button>`).join('')}</div></div>`).join('');
      qa('[data-shot]').forEach(b => b.onclick = () => {
        q('#v16ModalTitle').textContent = b.title;
        q('#v16ModalBody').innerHTML = `<img src="/api/journal/image/${encodeURIComponent(b.dataset.shot)}" alt="" style="width:100%;border-radius:10px">`;
        q('#v16Modal').classList.add('open');
      });
    })
  });

  // =====================================================================
  // Leaderboard
  // =====================================================================
  let lbPeriod = 'week';
  const loadLeaderboard = guard(async () => {
    const [b, st] = await Promise.all([api(`/api/leaderboard?period=${lbPeriod}`), api('/api/settings')]);
    qa('[data-lb]').forEach(x => x.classList.toggle('primary', x.dataset.lb === lbPeriod));
    q('#lbTitle').textContent = `${b.title} · ${b.drivers} driver${b.drivers === 1 ? '' : 's'}`;
    const medal = i => ['🥇', '🥈', '🥉'][i] || `<span class="lb-rank">${i + 1}</span>`;
    q('#lbBoards').innerHTML = b.boards.map(x => `<div class="panel"><div class="panel-head"><div class="panel-title">${esc(x.label)}</div></div><div class="v16-list">${x.rows.length ? x.rows.map((r, i) => `<div class="v16-item ${r.isLocal ? 'lb-me' : ''}"><div class="lb-medal">${medal(i)}</div><div class="grow"><div class="t">${esc(r.driverName)}${r.isLocal ? ' <span class="muted">(you)</span>' : ''}</div></div><b>${esc(r.display)}</b></div>`).join('') : '<div class="v16-empty">No data yet.</div>'}</div></div>`).join('');
    const d = st.discord || {};
    q('#lbRecap').checked = Boolean(d.weeklyRecap);
    q('#lbRecap').disabled = st.canEdit === false || !d.configured;
    q('#lbRecapNote').textContent = d.configured ? 'Posts last week\'s top 3 in each category every Monday.' : 'Set up Discord on the Alerts & Discord page first.';
  });
  K.pages.push({
    name: 'leaderboard', icon: '🏆', label: 'Leaderboard', group: 'Convoy', index: 2,
    html: `<div class="panel" style="margin-bottom:12px"><div class="v16-body v16-row" style="justify-content:space-between"><div class="v16-row">${[['week', 'This week'], ['lastWeek', 'Last week'], ['season', 'Season'], ['allTime', 'All time']].map(([k, l]) => `<button class="cmd small" data-lb="${k}" type="button">${l}</button>`).join('')}<span class="muted" id="lbTitle" style="font-size:13px"></span></div>
      <label class="v16-toggle" style="gap:10px;padding:0"><span><b>Weekly Discord recap</b><div class="v16-note" id="lbRecapNote"></div></span><input type="checkbox" id="lbRecap"></label></div></div>
      <div class="v16-grid v16-3" id="lbBoards"></div>
      <div class="v16-note" style="margin-top:10px">Seasons run by calendar month. Drivers appear once they are on Companion v1.6+ and connected to the same convoy relay.</div>`,
    load: loadLeaderboard,
    init() {
      qa('[data-lb]').forEach(b => b.onclick = () => { lbPeriod = b.dataset.lb; loadLeaderboard(); });
      q('#lbRecap').onchange = guard(async e => { await api('/api/settings/discord', { method: 'PATCH', body: { weeklyRecap: e.target.checked } }); notify(e.target.checked ? 'Weekly recap on' : 'Weekly recap off', '', 'join'); });
    }
  });

  // =====================================================================
  // Virtual trucking company
  // =====================================================================
  const loadCompany = guard(async () => {
    const v = await api('/api/vtc');
    // Jobs assigned to me (from any company)
    q('#coIncoming').innerHTML = v.incoming.length ? v.incoming.map(a => `<div class="v16-item"><div class="grow"><div class="t">[${esc(a.company?.tag || 'VTC')}] ${esc(a.origin || '?')} → ${esc(a.destination || '?')}</div><div class="d">${esc(a.cargo || 'Any cargo')} · ${money(a.pay)} · from ${esc(a.dispatcher)} (${esc(a.company?.name || '')})${a.dueBy ? ` · due ${dateTime(a.dueBy)}` : ''}${a.notes ? ` · ${esc(a.notes)}` : ''}</div></div>
      ${a.myStatus === 'accepted' ? '<span class="v16-pill info">Accepted</span>' : a.myStatus === 'completed' ? '<span class="v16-pill good">Delivered</span>' : a.myStatus === 'declined' ? '<span class="v16-pill muted">Declined</span>' : `<button class="cmd small primary" data-acc="${esc(a.id)}" type="button">Accept</button><button class="cmd small" data-dec="${esc(a.id)}" type="button">Decline</button>`}</div>`).join('')
      : '<div class="v16-empty">No jobs assigned to you. When a company dispatcher assigns you a load, it shows up here.</div>';
    qa('[data-acc]').forEach(b => b.onclick = guard(async () => { await api(`/api/vtc/incoming/${encodeURIComponent(b.dataset.acc)}/accept`, { method: 'POST' }); notify('Job accepted', 'Added to your Dispatch page.', 'join'); loadCompany(); }));
    qa('[data-dec]').forEach(b => b.onclick = guard(async () => { await api(`/api/vtc/incoming/${encodeURIComponent(b.dataset.dec)}/decline`, { method: 'POST' }); loadCompany(); }));

    q('#coSetup').style.display = v.isDispatcher ? 'none' : '';
    q('#coOffice').style.display = v.isDispatcher ? '' : 'none';
    if (!v.isDispatcher) return;
    const c = v.company;
    q('#coName').textContent = `${c.name}${c.tag ? ` [${c.tag}]` : ''}`;
    q('#coKpis').innerHTML = [['Company bank', money(v.bank)], ['Revenue', money(v.revenue)], ['Company cut', `${c.cutPercent}%`], ['Open jobs', v.assignments.filter(a => ['assigned', 'accepted'].includes(a.status)).length]].map(([k, val]) => `<div><div class="k">${k}</div><div class="v">${val}</div></div>`).join('');
    const drivers = [...new Set([...v.drivers.map(d => d.driverName), c.dispatcher])];
    if (document.activeElement !== q('#coDriver')) q('#coDriverList').innerHTML = drivers.map(n => `<option value="${esc(n)}">`).join('');
    const pill = st => `<span class="v16-pill ${({ assigned: 'muted', accepted: 'info', completed: 'good', declined: 'bad', cancelled: 'bad' })[st] || 'muted'}">${esc(st)}</span>`;
    q('#coJobs').innerHTML = v.assignments.length ? v.assignments.map(a => `<tr><td>${esc(a.driver)}</td><td>${esc(a.origin || '?')} → ${esc(a.destination || '?')}</td><td>${esc(a.cargo || '—')}</td><td>${money(a.income ?? a.pay)}</td><td>${pill(a.status)}</td><td>${ago(a.completedAt || a.acceptedAt || a.createdAt)}</td><td>${['assigned', 'accepted'].includes(a.status) ? `<button class="cmd small danger" data-cancel="${esc(a.id)}" type="button">Cancel</button>` : ''}</td></tr>`).join('') : '<tr><td colspan="7" class="muted">No jobs yet — assign one above.</td></tr>';
    qa('[data-cancel]').forEach(b => b.onclick = guard(async () => { await api(`/api/vtc/assignments/${encodeURIComponent(b.dataset.cancel)}/cancel`, { method: 'POST' }); loadCompany(); }));
    q('#coPayroll').innerHTML = v.payroll.length ? v.payroll.map(p => `<div class="v16-item"><div class="grow"><div class="t">${esc(p.driver)}</div><div class="d">${p.jobs} job(s) · ${money(p.gross)} gross</div></div><b>${money(p.pay)}</b></div>`).join('') : '<div class="v16-empty">Payroll fills in as drivers deliver company jobs.</div>';
  });
  K.pages.push({
    name: 'company', icon: '🏢', label: 'Company', group: 'Work', index: 4,
    html: `<div class="v16-grid v16-2">
        <div class="panel"><div class="panel-head"><div class="panel-title">Jobs assigned to you</div></div><div id="coIncoming" class="v16-list"></div></div>
        <div class="panel" id="coSetup"><div class="panel-head"><div class="panel-title">Start a trucking company</div></div><div class="v16-body v16-stack">
          <div class="v16-note">Become the dispatcher: assign loads to drivers in your convoy, track who's hauling what, and keep a company bank and payroll. Drivers need Companion v1.6+ on the same convoy relay.</div>
          <div class="v16-grid v16-3"><div class="v16-field"><label for="coNewName">Company name</label><input id="coNewName" class="v16-input" placeholder="KAW Logistics"></div><div class="v16-field"><label for="coNewTag">Tag</label><input id="coNewTag" class="v16-input" maxlength="8" placeholder="KAW"></div><div class="v16-field"><label for="coNewCut">Company cut (%)</label><input id="coNewCut" class="v16-input" type="number" min="0" max="90" value="25"></div></div>
          <div class="v16-row"><button class="cmd primary" id="coCreate" type="button">Create company</button></div></div></div>
      </div>
      <div id="coOffice" style="display:none;margin-top:12px">
        <div class="panel"><div class="panel-head"><div class="panel-title" id="coName">Company</div><button class="cmd small danger" id="coClose" type="button">Close company</button></div><div class="v16-kpis" id="coKpis"></div></div>
        <div class="v16-grid v16-2" style="margin-top:12px">
          <div class="panel"><div class="panel-head"><div class="panel-title">Assign a job</div></div><div class="v16-body v16-stack">
            <div class="v16-grid v16-2"><div class="v16-field"><label for="coDriver">Driver</label><input id="coDriver" class="v16-input" list="coDriverList" placeholder="Driver name"><datalist id="coDriverList"></datalist></div><div class="v16-field"><label for="coPay">Pay ($)</label><input id="coPay" class="v16-input" type="number" min="0"></div></div>
            <div class="v16-grid v16-3"><div class="v16-field"><label for="coFrom">From</label><input id="coFrom" class="v16-input"></div><div class="v16-field"><label for="coTo">To</label><input id="coTo" class="v16-input"></div><div class="v16-field"><label for="coCargo">Cargo</label><input id="coCargo" class="v16-input"></div></div>
            <div class="v16-grid v16-2"><div class="v16-field"><label for="coDue">Due by (optional)</label><input id="coDue" class="v16-input" type="datetime-local"></div><div class="v16-field"><label for="coNotes">Notes</label><input id="coNotes" class="v16-input"></div></div>
            <div class="v16-row"><button class="cmd primary" id="coAssign" type="button">Assign job</button></div></div></div>
          <div class="panel"><div class="panel-head"><div class="panel-title">Payroll</div></div><div id="coPayroll" class="v16-list"></div></div>
        </div>
        <div class="panel" style="margin-top:12px"><div class="panel-head"><div class="panel-title">Company jobs</div></div><div class="table-wrap"><table class="table"><thead><tr><th>Driver</th><th>Route</th><th>Cargo</th><th>Pay</th><th>Status</th><th>Updated</th><th></th></tr></thead><tbody id="coJobs"></tbody></table></div></div>
      </div>`,
    load: loadCompany,
    init() {
      q('#coCreate').onclick = guard(async () => { await api('/api/vtc/company', { method: 'POST', body: { name: q('#coNewName').value, tag: q('#coNewTag').value, cutPercent: Number(q('#coNewCut').value) } }); notify('Company created', 'You are the dispatcher.', 'join'); loadCompany(); });
      q('#coClose').onclick = guard(async () => { if (!confirm('Close your company? Assignments stop being shared.')) return; await api('/api/vtc/company', { method: 'DELETE' }); loadCompany(); });
      q('#coAssign').onclick = guard(async () => {
        const due = q('#coDue').value;
        await api('/api/vtc/assignments', { method: 'POST', body: { driver: q('#coDriver').value, origin: q('#coFrom').value, destination: q('#coTo').value, cargo: q('#coCargo').value, pay: Number(q('#coPay').value || 0), notes: q('#coNotes').value, dueBy: due ? new Date(due).toISOString() : null } });
        for (const id of ['coFrom', 'coTo', 'coCargo', 'coPay', 'coNotes', 'coDue']) q('#' + id).value = '';
        notify('Job assigned', `Sent to ${q('#coDriver').value}`, 'join');
        loadCompany();
      });
    }
  });
  K.onTick.push((d, page) => { if (page === 'company' && Date.now() % 5000 < 500 && !document.activeElement?.matches?.('input,textarea,select')) loadCompany(); });

  // =====================================================================
  // Convoy events & RSVP (top of the Convoy Sessions page) + replay
  // =====================================================================
  const until = m => (m === null ? 'No time set' : m > 1440 ? `in ${Math.round(m / 1440)} day(s)` : m > 90 ? `in ${Math.round(m / 60)} h` : m > 0 ? `in ${m} min` : m > -60 ? 'departing now' : 'started');
  const loadEvents = guard(async () => {
    const box = q('#evList');
    if (!box) return;
    const { events } = await api('/api/events');
    const upcoming = events.filter(e => ['planned', 'active'].includes(e.status));
    box.innerHTML = upcoming.length ? upcoming.map(e => `<div class="ev-card ${e.status}">
      <div class="v16-row" style="justify-content:space-between"><div><div style="font-size:17px;font-weight:800">${esc(e.name)} ${e.status === 'active' ? '<span class="v16-pill good">Rolling now</span>' : ''}</div>
        <div class="muted" style="font-size:12.5px">${e.departureTime ? dateTime(e.departureTime) + ' · ' : ''}${e.status === 'active' ? `rolling since ${ago(e.startedAt)}` : until(e.minutesUntil)} · host ${esc(e.host)}${e.mine ? ' (you)' : ''}</div>
        <div style="font-size:13px;margin-top:4px">📍 ${esc(e.meetPoint || 'Meet point TBA')}${e.destination ? ` → 🏁 ${esc(e.destination)}` : ''}</div>${e.notes ? `<div class="v16-note">${esc(e.notes)}</div>` : ''}</div>
        <div class="v16-row">${['going', 'maybe', 'no'].map(st => `<button class="cmd small ${e.myRsvp === st ? 'primary' : ''}" data-rsvp="${esc(e.id)}" data-st="${st}" type="button">${st === 'going' ? '✔ Going' : st === 'maybe' ? '? Maybe' : '✘ Can\'t'}</button>`).join('')}</div></div>
      <div class="v16-row" style="margin-top:8px;gap:6px"><span class="muted" style="font-size:12px">${e.going} going · ${e.maybe} maybe:</span>${e.rsvps.filter(a => a.status !== 'no').map(a => `<span class="v16-pill ${a.status === 'going' ? 'good' : 'warn'}" style="font-size:10.5px">${esc(a.driverName)}</span>`).join('') || '<span class="muted" style="font-size:12px">be the first</span>'}</div></div>`).join('')
      : '<div class="v16-empty"><b>No convoys planned</b>Plan one below — everyone on the relay sees it here and can RSVP. Reminders go out 30 and 5 minutes before departure.</div>';
    qa('[data-rsvp]').forEach(b => b.onclick = guard(async () => { await api(`/api/events/${encodeURIComponent(b.dataset.rsvp)}/rsvp`, { method: 'POST', body: { status: b.dataset.st } }); loadEvents(); }));
  });

  // Replay a recorded convoy on the live map.
  let replayTimer = null;
  K.openReplay = (id, name) => openReplay(id, name);
  async function openReplay(id, name) {
    await K.map.geoReady;
    let r;
    try { r = await api(`/api/tracks/session/${encodeURIComponent(id)}`); } catch (e) { notify('No replay available', e.message, 'leave'); return; }
    const paths = K.map.buildStatePaths() || [];
    q('#v16ModalTitle').textContent = `Replay: ${name}`;
    q('#v16ModalBody').innerHTML = `<svg id="rpMap" viewBox="0 0 ${K.map.W} ${K.map.H}" style="width:100%;background:var(--panel2);border-radius:10px"></svg>
      <div class="v16-row" style="margin-top:10px"><button class="cmd small primary" id="rpPlay" type="button">▶ Play</button><input id="rpSlider" type="range" min="0" max="${r.frames.length - 1}" value="0" style="flex:1"><span id="rpTime" class="muted" style="font-size:12.5px;min-width:150px;text-align:right"></span></div>`;
    q('#v16Modal').classList.add('open');
    const base = paths.map(p => `<path d="${p.d}" class="hub-state" fill="var(--panel)"></path>`).join('');
    const colors = ['#4aa3ff', '#3ee07a', '#ffd257', '#ff9d3c', '#b07bff', '#ff5d5d', '#5ee4ff'];
    const names = [...new Set(r.frames.flatMap(f => f.drivers.map(d => d.name)))];
    const color = n => colors[names.indexOf(n) % colors.length];
    const draw = i => {
      const upto = r.frames.slice(0, i + 1);
      const trails = names.map(n => { const pts = upto.map(f => f.drivers.find(d => d.name === n)).filter(Boolean).map(d => K.map.project(d.lon, d.lat).map(v => v.toFixed(1)).join(',')); return pts.length > 1 ? `<polyline points="${pts.join(' ')}" fill="none" stroke="${color(n)}" stroke-width="3" opacity=".7"/>` : ''; }).join('');
      const dots = r.frames[i].drivers.map(d => { const [x, y] = K.map.project(d.lon, d.lat); return `<g transform="translate(${x.toFixed(1)},${y.toFixed(1)})"><circle r="7" fill="${color(d.name)}" stroke="#fff" stroke-width="2"/><text y="-12" text-anchor="middle" class="hub-dot-label">${esc(d.name)}</text></g>`; }).join('');
      q('#rpMap').innerHTML = base + trails + dots;
      q('#rpTime').textContent = new Date(r.frames[i].t).toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
      q('#rpSlider').value = i;
    };
    draw(0);
    q('#rpSlider').oninput = e => draw(Number(e.target.value));
    q('#rpPlay').onclick = () => {
      if (replayTimer) { clearInterval(replayTimer); replayTimer = null; q('#rpPlay').textContent = '▶ Play'; return; }
      q('#rpPlay').textContent = '⏸ Pause';
      replayTimer = setInterval(() => { const i = Number(q('#rpSlider')?.value || 0) + 1; if (!q('#rpSlider') || i >= r.frames.length) { clearInterval(replayTimer); replayTimer = null; if (q('#rpPlay')) q('#rpPlay').textContent = '▶ Play'; return; } draw(i); }, 80);
    };
  }

  // =====================================================================
  // Streamer overlay builder (Settings)
  // =====================================================================
  K.onReady.push(() => {
    const grid = q('#page-settings .settings-grid');
    if (!grid) return;
    const W = [['speed', 'Speed + limit sign'], ['route', 'Route progress'], ['alerts', 'Alerts'], ['convoy', 'Convoy list'], ['eco', 'Eco score'], ['shift', 'Shift advice'], ['map', 'Convoy map']];
    const panel = document.createElement('div');
    panel.className = 'panel setting';
    panel.style.gridColumn = '1/-1';
    panel.innerHTML = `<div><b>Streamer overlay (OBS)</b><div class="muted setting-help">Add a live overlay to your stream: in OBS add a <b>Browser Source</b>, paste the link below, and set it to your canvas size (e.g. 1920×1080). The background is transparent — no ATS mods needed.</div></div>
      <div class="v16-row" style="margin-top:10px">${W.map(([k, l]) => `<label class="v16-row" style="gap:6px;font-size:13px"><input type="checkbox" data-ow="${k}" ${['speed', 'route', 'alerts'].includes(k) ? 'checked' : ''}>${l}</label>`).join('')}</div>
      <div class="v16-row" style="margin-top:8px"><select id="ovPos" class="v16-input" style="width:auto"><option value="bl">Bottom left</option><option value="br">Bottom right</option><option value="tl">Top left</option><option value="tr">Top right</option></select>
        <select id="ovScale" class="v16-input" style="width:auto"><option value="0.8">Small</option><option value="1" selected>Normal</option><option value="1.3">Large</option><option value="1.7">Extra large</option></select>
        <select id="ovTheme" class="v16-input" style="width:auto"><option value="dark">Dark cards</option><option value="light">Light cards</option></select></div>
      <div class="v16-row" style="margin-top:8px"><input id="ovUrl" class="v16-input" readonly style="flex:1;font-family:ui-monospace,Consolas,monospace;font-size:12.5px"><button class="cmd small primary" id="ovCopy" type="button">Copy link</button><button class="cmd small" id="ovOpen" type="button">Preview</button></div>`;
    grid.insertBefore(panel, grid.children[2] || null);
    const build = () => {
      const w = qa('[data-ow]').filter(i => i.checked).map(i => i.dataset.ow);
      q('#ovUrl').value = `${location.origin}/overlay.html?w=${w.join(',') || 'speed'}&pos=${q('#ovPos').value}&scale=${q('#ovScale').value}${q('#ovTheme').value === 'light' ? '&theme=light' : ''}`;
    };
    qa('[data-ow],#ovPos,#ovScale,#ovTheme').forEach(i => i.onchange = build);
    q('#ovCopy').onclick = async () => { try { await navigator.clipboard.writeText(q('#ovUrl').value); notify('Overlay link copied', 'Paste it into an OBS Browser Source.', 'join'); } catch { q('#ovUrl').select(); } };
    q('#ovOpen').onclick = () => window.open(q('#ovUrl').value, 'kawOverlay', 'noopener,width=1280,height=720');
    build();
  });

  K.onReady.push(() => {
    // Events panel at the top of Convoy Sessions.
    q('#page-sessions')?.insertAdjacentHTML('afterbegin', '<div class="panel" style="margin-bottom:12px"><div class="panel-head"><div class="panel-title">Upcoming convoys</div><div class="muted" style="font-size:12px">Shared with everyone on the relay · RSVP</div></div><div class="v16-body v16-stack" id="evList"></div></div>');
    const originalSessions = K.loaders.sessions;
    K.loaders.sessions = async () => {
      await Promise.all([originalSessions?.(), loadEvents()]);
      // Replay buttons on finished / running convoys.
      for (const item of qa('#sRecent .v16-item')) {
        if (item.querySelector('[data-replay]')) continue;
        const title = item.querySelector('.t')?.textContent || 'Convoy';
        const pill = item.querySelector('.v16-pill')?.textContent || '';
        if (!/completed|active/i.test(pill)) continue;
        const start = item.querySelector('[data-sstart]');
        const id = item.dataset.sid || start?.dataset.sstart;
        if (id) item.insertAdjacentHTML('beforeend', `<button class="cmd small" data-replay="${esc(id)}" data-name="${esc(title)}" type="button">▶ Replay</button>`);
      }
      qa('[data-replay]').forEach(b => b.onclick = () => openReplay(b.dataset.replay, b.dataset.name));
    };
    q('#v16Close')?.addEventListener('click', () => { if (replayTimer) { clearInterval(replayTimer); replayTimer = null; } });
  });
})();
