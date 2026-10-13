/* KAW'S ATS Companion v1.6 — fun & community: daily challenges, celebrations (confetti + voice),
   convoy history, phone push setup, shared convoy radio, TruckersMP, public live link, company livery,
   and desktop notifications. */
(() => {
  'use strict';
  const K = window.KAW16;
  if (!K) return;
  const { q, qa, esc, cash, ago, dateTime, api, guard, notify, go } = K;
  const voice = () => K.coDriver;

  // ---------------------------------------------------------------- confetti
  function confetti(ms = 2600) {
    if (matchMedia('(prefers-reduced-motion: reduce)').matches || document.body.classList.contains('reduce-motion')) return;
    const c = document.createElement('canvas');
    c.className = 'fun-confetti';
    c.width = innerWidth; c.height = innerHeight;
    document.body.append(c);
    const ctx = c.getContext('2d');
    const colors = ['#4aa3ff', '#3ee07a', '#ffd257', '#ff9d3c', '#b07bff', '#ff5d5d'];
    const bits = Array.from({ length: 160 }, () => ({ x: Math.random() * c.width, y: -20 - Math.random() * c.height * 0.4, vx: (Math.random() - 0.5) * 4, vy: 2 + Math.random() * 4, s: 5 + Math.random() * 6, r: Math.random() * 6, vr: (Math.random() - 0.5) * 0.3, col: colors[Math.floor(Math.random() * colors.length)] }));
    const t0 = performance.now();
    (function frame(t) {
      ctx.clearRect(0, 0, c.width, c.height);
      for (const b of bits) { b.x += b.vx; b.y += b.vy; b.vy += 0.05; b.r += b.vr; ctx.save(); ctx.translate(b.x, b.y); ctx.rotate(b.r); ctx.fillStyle = b.col; ctx.fillRect(-b.s / 2, -b.s / 4, b.s, b.s / 2); ctx.restore(); }
      if (t - t0 < ms) requestAnimationFrame(frame); else c.remove();
    })(t0);
  }

  // ---------------------------------------------------------------- desktop notifications
  function desktopNotify(title, body) {
    if (!('Notification' in window) || Notification.permission !== 'granted' || !document.hidden) return;
    try { new Notification(title, { body, icon: '/kaws-ats-companion-logo.png', tag: title }); } catch {}
  }
  let lastCritical = null;
  K.onTick.push(d => {
    const crit = (d?.alerts?.active || []).filter(a => a.severity === 'critical').map(a => a.id);
    if (lastCritical) for (const a of (d.alerts.active || [])) if (a.severity === 'critical' && !lastCritical.includes(a.id)) desktopNotify(a.title, a.detail);
    lastCritical = crit;
  });

  // ---------------------------------------------------------------- moments (celebrations)
  let seenMoments = null;
  async function pollMoments() {
    try {
      const f = await api('/api/fun');
      const ms = f.moments || [];
      if (seenMoments) {
        for (const m of ms.filter(x => !seenMoments.has(x.id)).reverse()) {
          confetti(m.type === 'delivered' ? 2600 : 3400);
          notify(m.title, m.detail, 'join');
          desktopNotify(m.title, m.detail);
          const cd = voice();
          if (cd && cd.cfg().callouts.fun !== false) {
            if (m.type === 'delivered') cd.speak(cd.say('delivered', `$${Math.round(m.income || 0).toLocaleString('en-US')}`, m.eco) + (m.clean ? ' Clean delivery, not a scratch on it.' : ''), { priority: 2 });
            else cd.speak(m.title.replace(/[🎉🏁📦]/gu, ''), { priority: 2 });
          }
        }
      }
      seenMoments = new Set(ms.map(x => x.id));
      renderChallenges(f);
    } catch {}
  }
  setInterval(pollMoments, 5000);
  K.onReady.push(pollMoments);

  // ---------------------------------------------------------------- Career: challenges + convoy history
  function renderChallenges(f) {
    const box = q('#funChallenges');
    if (!box) return;
    const ch = f.challenges || {};
    if (!ch.enabled) { box.innerHTML = '<div class="v16-empty">Daily challenges are turned off in Settings.</div>'; return; }
    q('#funReset').textContent = `New challenges in ${Math.floor(ch.resetsIn / 60)}h ${ch.resetsIn % 60}m`;
    box.innerHTML = ch.items.map(c => `<div class="fun-ch ${c.done ? 'done' : ''}"><div class="fun-ch-top"><b>${c.done ? '✅' : '🎯'} ${esc(c.title)}</b><span class="v16-pill ${c.done ? 'good' : 'info'}">+${c.xp} XP</span></div><div class="muted" style="font-size:13px">${esc(c.text)}</div><div class="v16-bar" style="margin-top:8px"><span style="width:${Math.min(100, (c.value / c.target) * 100)}%"></span></div><div class="muted" style="font-size:11.5px;margin-top:4px">${c.done ? `Completed ${ago(c.claimedAt)}` : `${Number(c.value).toLocaleString('en-US')} / ${Number(c.target).toLocaleString('en-US')}`}</div></div>`).join('');
    renderWeekly(f.weekly);
    const hist = q('#funConvoys');
    if (hist) hist.innerHTML = (f.activeConvoy ? `<div class="v16-item"><div class="grow"><div class="t">🟢 ${esc(f.activeConvoy.name)} (rolling)</div><div class="d">${f.activeConvoy.miles} mi so far · ${f.activeConvoy.drivers} drivers · widest gap ${f.activeConvoy.maxGapMiles} mi</div></div></div>` : '') + ((f.convoys || []).map(c => `<div class="v16-item"><div class="grow"><div class="t">${c.perfect ? '🏅 ' : ''}${esc(c.name)}</div><div class="d">${dateTime(c.startedAt)} · ${c.miles} mi · ${c.minutes} min · ${c.drivers} drivers · widest gap ${c.maxGapMiles} mi</div></div>${c.perfect ? '<span class="v16-pill good">Perfect formation</span>' : ''}</div>`).join('') || (f.activeConvoy ? '' : '<div class="v16-empty">Join a convoy event to start your convoy log.</div>'));
  }
  // Weekly board: four bigger goals, Monday to Sunday, plus recent weeks.
  function renderWeekly(w) {
    const box = q('#funWeekly');
    if (!box) return;
    if (!w?.enabled) { box.innerHTML = '<div class="v16-empty">Weekly challenges are turned off with daily challenges in Settings.</div>'; q('#funWeekHead').textContent = ''; return; }
    const d = Math.floor(w.resetsIn / 1440), h = Math.floor((w.resetsIn % 1440) / 60);
    q('#funWeekHead').textContent = `${w.week} · ${w.xpEarned.toLocaleString('en-US')} / ${w.xpAvailable.toLocaleString('en-US')} XP · new board in ${d ? d + 'd ' : ''}${h}h`;
    box.innerHTML = '<div class="fun-chs" style="display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:10px">' + w.items.map(c => `<div class="fun-ch ${c.done ? 'done' : ''}"><div class="fun-ch-top"><b>${c.done ? '🏆' : '🗓️'} ${esc(c.title)}</b><span class="v16-pill ${c.done ? 'good' : 'info'}">+${c.xp} XP</span></div><div class="muted" style="font-size:13px">${esc(c.text)}</div><div class="v16-bar" style="margin-top:8px"><span style="width:${Math.min(100, (c.value / c.target) * 100)}%"></span></div><div class="muted" style="font-size:11.5px;margin-top:4px">${c.done ? `Completed ${ago(c.claimedAt)}` : `${Number(c.value).toLocaleString('en-US')} / ${Number(c.target).toLocaleString('en-US')}`}</div></div>`).join('') + '</div>'
      + (w.history?.length ? `<div class="muted" style="font-size:12px;margin-top:10px">Recent weeks: ${w.history.map(x => `${esc(x.week)} ${'★'.repeat(x.done)}${'☆'.repeat(Math.max(0, 4 - x.done))}`).join(' · ')}</div>` : '');
  }
  K.onReady.push(() => {
    q('#page-career')?.insertAdjacentHTML('afterbegin', `<div class="panel" style="margin-bottom:12px"><div class="panel-head"><div class="panel-title">Weekly challenges</div><div class="muted" id="funWeekHead" style="font-size:12px"></div></div><div class="v16-body" id="funWeekly"></div></div>`);
  });
  K.onReady.push(() => {
    q('#page-career')?.insertAdjacentHTML('afterbegin', `<div class="v16-grid v16-2" style="margin-bottom:12px"><div class="panel"><div class="panel-head"><div class="panel-title">Daily challenges</div><div class="muted" id="funReset" style="font-size:12px"></div></div><div class="v16-body fun-chs" id="funChallenges"></div></div>
      <div class="panel"><div class="panel-head"><div class="panel-title">Convoy log</div><div class="muted" style="font-size:12px">Counts toward convoy achievements</div></div><div id="funConvoys" class="v16-list"></div></div></div>`);
  });

  // ---------------------------------------------------------------- Alerts page: phone push (ntfy) + desktop notifications
  const loadPush = guard(async () => {
    const p = await api('/api/push');
    q('#puEnabled').checked = p.enabled; q('#puTopic').value = p.topic || p.suggestedTopic; q('#puServer').value = p.server;
    qa('[data-pucat]').forEach(i => i.checked = p.categories?.[i.dataset.pucat] !== false);
    q('#puState').innerHTML = p.ready ? '<span class="v16-pill good">On</span>' : '<span class="v16-pill muted">Off</span>';
    if (p.lastError) q('#puState').innerHTML += ` <span class="v16-pill bad" title="${esc(p.lastError)}">Last push failed</span>`;
    q('#puLink').innerHTML = `Subscribe in the ntfy app to <b>${esc(p.topic || q('#puTopic').value)}</b>${p.subscribeUrl ? ` · <a href="${esc(p.subscribeUrl)}" target="_blank" rel="noopener">open topic</a>` : ''}`;
    for (const el of qa('#puForm input, #puForm button')) el.disabled = p.canEdit === false;
    q('#dnState').textContent = !('Notification' in window) ? 'Not supported in this browser' : Notification.permission === 'granted' ? 'Allowed' : Notification.permission === 'denied' ? 'Blocked in browser settings' : 'Not allowed yet';
  });
  K.onReady.push(() => {
    const col = q('#page-alerts .v16-grid > .v16-stack:last-child');
    col?.insertAdjacentHTML('afterbegin', `<div class="panel"><div class="panel-head"><div class="panel-title">Phone notifications</div><div id="puState"></div></div><div class="v16-body v16-stack" id="puForm">
      <div class="v16-note">Get alerts on your phone even when the dashboard is closed: install the free <b>ntfy</b> app (<a href="https://ntfy.sh" target="_blank" rel="noopener">ntfy.sh</a>, Android &amp; iPhone), tap <b>+</b>, and subscribe to your private topic below. Treat the topic like a password.</div>
      <label class="v16-toggle"><span><b>Send push notifications</b></span><input type="checkbox" id="puEnabled"></label>
      <div class="v16-grid v16-2"><div class="v16-field"><label for="puTopic">Private topic</label><input id="puTopic" class="v16-input" autocomplete="off"></div><div class="v16-field"><label for="puServer">Server</label><input id="puServer" class="v16-input"></div></div>
      <div class="v16-row">${[['critical', 'Critical alerts'], ['convoy', 'Convoy reminders'], ['jobs', 'Company jobs'], ['friends', 'Friends online'], ['trips', 'Delivery summaries']].map(([k, l]) => `<label class="v16-row" style="gap:6px;font-size:13px"><input type="checkbox" data-pucat="${k}">${l}</label>`).join('')}</div>
      <div class="v16-note" id="puLink"></div>
      <div class="v16-row"><button class="cmd primary" id="puSave" type="button">Save</button><button class="cmd" id="puTest" type="button">Send test</button></div>
      <div class="v16-row" style="justify-content:space-between;border-top:1px solid color-mix(in srgb,var(--line) 30%,transparent);padding-top:10px"><span><b>Desktop notifications</b> <span class="muted" id="dnState" style="font-size:12.5px"></span></span><button class="cmd small" id="dnAllow" type="button">Allow</button></div></div></div>`);
    q('#puSave').onclick = guard(async () => { await api('/api/push', { method: 'PATCH', body: { enabled: q('#puEnabled').checked, topic: q('#puTopic').value.trim(), server: q('#puServer').value.trim(), categories: Object.fromEntries(qa('[data-pucat]').map(i => [i.dataset.pucat, i.checked])) } }); notify('Push settings saved', '', 'join'); loadPush(); });
    q('#puTest').onclick = guard(async () => { await api('/api/push/test', { method: 'POST' }); notify('Test push sent', 'Check your phone.', 'join'); loadPush(); });
    q('#dnAllow').onclick = async () => { try { await Notification.requestPermission(); } catch {} loadPush(); };
    const orig = K.loaders.alerts;
    K.loaders.alerts = async () => { await Promise.all([orig?.(), loadPush()]); };
  });

  // ---------------------------------------------------------------- CB page: shared convoy radio
  const audio = new Audio();
  audio.preload = 'none';
  let tunedUrl = null;
  function play(st) {
    if (!st?.url) return;
    if (tunedUrl === st.url && !audio.paused) { audio.pause(); tunedUrl = null; renderRadio(); return; }
    audio.src = st.url; tunedUrl = st.url;
    audio.volume = Number(q('#crVol')?.value || 0.6);
    audio.play().catch(() => notify('Could not play this station', 'It may be offline or blocked — try another.', 'leave'));
    renderRadio();
  }
  let radioData = { shared: [] }, results = [];
  function renderRadio() {
    const box = q('#crShared');
    if (!box) return;
    box.innerHTML = radioData.shared.length ? radioData.shared.map((s, i) => `<div class="v16-item"><img class="cr-logo" src="${esc(s.favicon || '/kaws-ats-companion-logo.png')}" alt="" loading="lazy" referrerpolicy="no-referrer" onerror="this.src='/kaws-ats-companion-logo.png'"><div class="grow"><div class="t">${esc(s.name)}</div><div class="d">Picked by ${esc(s.from)} · ${ago(s.setAt)}${s.tags ? ` · ${esc(s.tags)}` : ''}</div></div><button class="cmd small ${tunedUrl === s.url && !audio.paused ? 'danger' : 'primary'}" data-play="${i}" type="button">${tunedUrl === s.url && !audio.paused ? '⏸ Stop' : '▶ Tune in'}</button>${s.isLocal ? '<button class="cmd small" id="crClear" type="button">Stop sharing</button>' : ''}</div>`).join('')
      : '<div class="v16-empty">No convoy station yet. Search below and press “Share with convoy” — everyone can tune in.</div>';
    qa('[data-play]', box).forEach(b => b.onclick = () => play(radioData.shared[Number(b.dataset.play)]));
    q('#crClear') && (q('#crClear').onclick = guard(async () => { await api('/api/radio/convoy', { method: 'POST', body: { station: null } }); loadRadioShared(); }));
    const rbox = q('#crResults');
    rbox.innerHTML = results.map((s, i) => `<div class="v16-item"><img class="cr-logo" src="${esc(s.favicon || '/kaws-ats-companion-logo.png')}" alt="" loading="lazy" referrerpolicy="no-referrer" onerror="this.src='/kaws-ats-companion-logo.png'"><div class="grow"><div class="t">${esc(s.name)}</div><div class="d">${esc(s.country)}${s.tags ? ` · ${esc(s.tags)}` : ''}${s.bitrate ? ` · ${s.bitrate} kbps` : ''}</div></div><button class="cmd small" data-preview="${i}" type="button">${tunedUrl === s.url && !audio.paused ? '⏸' : '▶'}</button><button class="cmd small primary" data-share="${i}" type="button">Share with convoy</button></div>`).join('');
    qa('[data-preview]', rbox).forEach(b => b.onclick = () => play(results[Number(b.dataset.preview)]));
    qa('[data-share]', rbox).forEach(b => b.onclick = guard(async () => { const st = results[Number(b.dataset.share)]; await api('/api/radio/convoy', { method: 'POST', body: { station: st } }); notify('Station shared', `${st.name} — the convoy can tune in now.`, 'join'); voice()?.speak(`Convoy radio: ${st.name}.`); loadRadioShared(); }));
  }
  const loadRadioShared = guard(async () => { radioData = await api('/api/radio/convoy'); renderRadio(); });
  const searchRadio = guard(async (qStr, tag) => { q('#crResults').innerHTML = '<div class="v16-empty">Searching…</div>'; results = (await api(`/api/radio/stations?q=${encodeURIComponent(qStr || '')}&tag=${encodeURIComponent(tag || '')}`)).stations; renderRadio(); });
  K.onReady.push(() => {
    q('#page-radio')?.insertAdjacentHTML('beforeend', `<div class="panel" style="margin-top:12px"><div class="panel-head"><div class="panel-title">Convoy radio</div><label class="v16-row" style="gap:6px;font-size:12.5px">🔊 <input id="crVol" type="range" min="0" max="1" step="0.05" value="0.6" style="width:110px"></label></div>
      <div class="v16-list" id="crShared"></div>
      <div class="v16-body v16-stack"><div class="v16-row"><input id="crSearch" class="v16-input" style="flex:1" placeholder="Search stations — country, rock, trucking, a city…"><button class="cmd primary" id="crGo" type="button">Search</button></div>
      <div class="v16-row">${['country', 'classic rock', 'trucking', 'rock', 'hip hop', 'oldies', 'talk', 'lofi'].map(t => `<button class="cmd small" data-tag="${t}" type="button">${t}</button>`).join('')}</div>
      <div class="v16-list" id="crResults"></div><div class="v16-note">Stations come from the free radio-browser.info directory and stream straight from the station — the convoy relay carries no audio.</div></div></div>`);
    q('#crGo').onclick = () => searchRadio(q('#crSearch').value.trim(), '');
    q('#crSearch').onkeydown = e => { if (e.key === 'Enter') searchRadio(q('#crSearch').value.trim(), ''); };
    qa('[data-tag]').forEach(b => b.onclick = () => searchRadio('', b.dataset.tag));
    q('#crVol').oninput = e => { audio.volume = Number(e.target.value); };
    const orig = K.loaders.radio;
    K.loaders.radio = async () => { await Promise.all([orig?.(), loadRadioShared()]); };
  });
  audio.onpause = audio.onplay = () => renderRadio();
  // Shared with the Radio DJ: the player, whether a station is playing, and its name.
  K.radio = { audio, playing: () => Boolean(tunedUrl) && !audio.paused, stationName: () => [...(radioData.shared || []), ...results].find(s => s.url === tunedUrl)?.name || null };

  // ---------------------------------------------------------------- Convoy Hub: TruckersMP + public live link + fun toggles
  const loadTmp = guard(async () => {
    const box = q('#tmpBody');
    if (!box) return;
    const t = await api('/api/tmp');
    const p = t.player || {};
    box.innerHTML = `<div class="v16-grid v16-2"><div class="v16-stack">
        ${p.found ? `<div class="v16-row">${p.avatar ? `<img src="${esc(p.avatar)}" alt="" class="cr-logo" referrerpolicy="no-referrer">` : ''}<div><div style="font-weight:800">${esc(p.name)} <span class="muted">#${p.id}</span></div><div class="muted" style="font-size:12.5px">${esc(p.group || 'Player')}${p.vtc ? ` · VTC ${esc(p.vtc.name)} [${esc(p.vtc.tag)}]` : ''}${p.banned ? ' · <span class="bad">banned</span>' : ''} · joined ${esc(String(p.joined || '').slice(0, 10))}</div><a href="${esc(p.profileUrl)}" target="_blank" rel="noopener" style="font-size:12.5px">TruckersMP profile</a></div></div>`
          : `<div class="v16-note">${esc(p.reason || 'Not linked.')}</div>`}
        <div class="v16-row"><input id="tmpId" class="v16-input" style="flex:1" placeholder="TruckersMP ID or Steam64 ID"><button class="cmd small" id="tmpSet" type="button">Link</button></div>
        ${t.multiplayer ? '<span class="v16-pill info">Multiplayer session detected</span>' : ''}
        ${t.convoy.length ? `<div class="v16-section-title">Convoy on TruckersMP</div>${t.convoy.map(c => `<div class="v16-note"><b>${esc(c.driverName)}</b> → <a href="${esc(c.profileUrl)}" target="_blank" rel="noopener">${esc(c.name)}</a>${c.vtc ? ` [${esc(c.vtc)}]` : ''}</div>`).join('')}` : ''}
      </div><div class="v16-stack"><div class="v16-section-title">ATS servers right now</div>
        ${t.servers.map(s => `<div class="v16-item" style="padding:6px 0"><div class="grow"><div class="t">${esc(s.name)} ${t.suggested?.id === s.id ? '<span class="v16-pill good" style="font-size:10px">Suggested for the convoy</span>' : ''}</div><div class="d">${s.online ? `${s.players.toLocaleString()} / ${s.max.toLocaleString()} drivers${s.queue ? ` · queue ${s.queue}` : ''}` : 'offline'}${s.speedLimiter ? ' · speed limiter' : ''}${s.collisions ? '' : ' · no collisions'}</div></div><div class="v16-bar" style="width:90px"><span style="width:${Math.min(100, (s.players / Math.max(1, s.max)) * 100)}%"></span></div></div>`).join('') || '<div class="v16-note">TruckersMP server list unavailable.</div>'}</div></div>`;
    q('#tmpSet').onclick = guard(async () => {
      const raw = q('#tmpId').value.trim();
      if (!/\d/.test(raw)) throw new Error('Type your TruckersMP ID (a number) or Steam64 ID first.');
      q('#tmpSet').disabled = true; q('#tmpSet').textContent = 'Linking…';
      try {
        await api('/api/tmp/player', { method: 'POST', body: { id: raw } });
        const after = (await api('/api/tmp')).player || {};
        if (after.found) notify(`Linked to ${after.name}`, 'Saved — it stays linked after a restart.', 'join');
        else notify('TruckersMP player not found', after.reason || 'Check the ID and try again.', 'critical');
      } finally { await loadTmp(); }
    });
  });
  const loadPublic = guard(async () => {
    const [f, r] = await Promise.all([api('/api/fun'), api('/api/relay')]);
    q('#plToggle').checked = Boolean(f.settings?.publicLive);
    q('#plLink').innerHTML = r.publicLiveUrl ? `<a href="${esc(r.publicLiveUrl)}" target="_blank" rel="noopener">${esc(r.publicLiveUrl)}</a> <button class="cmd small" id="plCopy" type="button">Copy</button>` : '<span class="muted">Connect to a convoy relay to get a link.</span>';
    q('#plCopy') && (q('#plCopy').onclick = async () => { try { await navigator.clipboard.writeText(r.publicLiveUrl); notify('Live link copied', 'Post it in Discord!', 'join'); } catch {} });
  });
  K.onReady.push(() => {
    q('#page-hub')?.insertAdjacentHTML('beforeend', `<div class="v16-grid v16-2" style="margin-top:12px">
      <div class="panel"><div class="panel-head"><div class="panel-title">TruckersMP</div><button class="cmd small" id="tmpRefresh" type="button">Refresh</button></div><div class="v16-body" id="tmpBody"><div class="v16-note">Loading…</div></div></div>
      <div class="panel"><div class="panel-head"><div class="panel-title">Public live page</div></div><div class="v16-body v16-stack">
        <div class="v16-note">A read-only “who's trucking now” page for your Discord or friends — no install needed. Only drivers who switch this on appear; your pairing code is never shown.</div>
        <label class="v16-toggle"><span><b>Show me on the public live page</b></span><input type="checkbox" id="plToggle"></label>
        <div class="v16-note" id="plLink"></div></div></div></div>`);
    q('#tmpRefresh').onclick = loadTmp;
    q('#plToggle').onchange = guard(async e => { await api('/api/fun/settings', { method: 'PATCH', body: { publicLive: e.target.checked } }); notify(e.target.checked ? 'You are on the public live page' : 'Removed from the public page', '', 'join'); loadPublic(); });
    // TruckersMP and the public link load once per visit to the hub (the hub itself refreshes often).
    const orig = K.loaders.hub;
    K.loaders.hub = async () => { await orig?.(); loadTmp(); loadPublic(); };
  });

  // ---------------------------------------------------------------- One-click connect (link from the Discord bot)
  // http://127.0.0.1:4280/?connect=<base64url JSON {endpoint, apiKey, backupEndpoints, pairingCode, server}>
  K.onReady.push(() => {
    const raw = new URLSearchParams(location.search).get('connect');
    if (!raw) return;
    let cfg = null;
    try { cfg = JSON.parse(decodeURIComponent(escape(atob(raw.replace(/-/g, '+').replace(/_/g, '/'))))); } catch {}
    history.replaceState(null, '', location.pathname);
    if (!cfg?.endpoint) return notify('Connect link not recognised', 'Ask the bot for a new one with /companion setup.', 'leave');
    const host = (() => { try { return new URL(cfg.endpoint).host; } catch { return '?'; } })();
    q('#v16ModalTitle').textContent = 'Connect your Companion to the convoy?';
    q('#v16ModalBody').innerHTML = `<div class="v16-stack">
      <div class="v16-note">This link came from <b>${esc(cfg.server || 'your Discord server')}</b>. Only continue if you trust it — it sets where this Companion shares your convoy data.</div>
      <div class="v16-kpis"><div><div class="k">Relay</div><div class="v" style="font-size:16px">${esc(host)}</div></div><div><div class="k">Convoy code</div><div class="v" style="font-size:16px">${esc(cfg.pairingCode || '—')}</div></div><div><div class="k">Backups</div><div class="v" style="font-size:16px">${(cfg.backupEndpoints || []).length}</div></div></div>
      <div class="v16-row"><button class="cmd primary" id="cnYes" type="button">Connect</button><button class="cmd" id="cnNo" type="button">Cancel</button></div></div>`;
    q('#v16Print').style.display = 'none';
    q('#v16Modal').classList.add('open');
    const close = () => { q('#v16Modal').classList.remove('open'); q('#v16Print').style.display = ''; };
    q('#v16Close').addEventListener('click', () => { q('#v16Print').style.display = ''; }, { once: true });
    q('#cnNo').onclick = close;
    q('#cnYes').onclick = guard(async () => {
      await api('/api/settings/relay', { method: 'PATCH', body: { endpoint: cfg.endpoint, apiKey: cfg.apiKey || '', pairingCode: cfg.pairingCode, backupEndpoints: (cfg.backupEndpoints || []).join(','), enabled: true } });
      close();
      notify('Connected to the convoy relay', `${host} · code ${cfg.pairingCode}`, 'join');
      confetti(1800);
      go('hub');
    });
  });

  // ---------------------------------------------------------------- Settings: fun toggles
  K.onReady.push(() => {
    const grid = q('#page-settings .settings-grid');
    if (!grid) return;
    grid.insertAdjacentHTML('beforeend', `<div class="panel setting"><b>Fun &amp; community</b><div class="muted setting-help">Challenges, celebrations and sharing.</div><div class="v16-stack" style="margin-top:8px">
      <label class="v16-toggle"><span>Daily challenges</span><input type="checkbox" data-fun="challenges"></label>
      <label class="v16-toggle"><span>Milestone celebrations</span><input type="checkbox" data-fun="milestones"></label>
      <label class="v16-toggle"><span>Convoy photo wall (post my screenshots to Discord during convoys)</span><input type="checkbox" data-fun="photoWall"></label></div></div>`);
    api('/api/fun').then(f => qa('[data-fun]').forEach(i => { i.checked = f.settings?.[i.dataset.fun] !== false && (i.dataset.fun !== 'photoWall' || Boolean(f.settings?.photoWall)); i.onchange = guard(async () => { await api('/api/fun/settings', { method: 'PATCH', body: { [i.dataset.fun]: i.checked } }); notify('Saved', '', 'join'); }); })).catch(() => {});
  });

  // ---------------------------------------------------------------- Company livery + ranks
  K.onReady.push(() => {
    const cut = q('#coNewCut')?.closest('.v16-field');
    cut?.insertAdjacentHTML('afterend', `<div class="v16-field"><label for="coNewColor">Company colour</label><input id="coNewColor" class="v16-input" type="color" value="#4aa3ff" style="padding:4px;height:42px"></div>`);
    q('#coNewCut')?.closest('.v16-grid')?.insertAdjacentHTML('afterend', `<div class="v16-field"><label for="coNewLogo">Logo image URL (https, optional)</label><input id="coNewLogo" class="v16-input" placeholder="https://…/logo.png"></div>`);
    const btn = q('#coCreate');
    if (btn) btn.onclick = guard(async () => { await api('/api/vtc/company', { method: 'POST', body: { name: q('#coNewName').value, tag: q('#coNewTag').value, cutPercent: Number(q('#coNewCut').value), color: q('#coNewColor').value, logoUrl: q('#coNewLogo').value.trim() } }); notify('Company created', 'You are the dispatcher.', 'join'); K.loaders.company?.(); });
    const orig = K.loaders.company;
    K.loaders.company = async () => {
      await orig?.();
      const v = await api('/api/vtc').catch(() => null);
      if (!v?.company) return;
      const name = q('#coName');
      if (name && !name.dataset.livery) {
        name.dataset.livery = '1';
        name.insertAdjacentHTML('afterbegin', v.company.logoUrl ? `<img src="${esc(v.company.logoUrl)}" alt="" class="co-logo" referrerpolicy="no-referrer">` : '');
      }
      q('#coOffice .panel')?.style.setProperty('border-top', `4px solid ${v.company.color || '#4aa3ff'}`);
      const pay = q('#coPayroll');
      if (pay && v.payroll.length) pay.innerHTML = v.payroll.map(p => `<div class="v16-item"><div class="grow"><div class="t">${esc(p.driver)} <span class="v16-pill info" style="font-size:10px">${esc(p.rank.name)}</span></div><div class="d">${p.jobs} job(s) · ${cash(p.gross)} gross${p.rank.next ? ` · ${p.rank.next.at - p.jobs} more to ${esc(p.rank.next.name)}` : ''}</div></div><b>${cash(p.pay)}</b></div>`).join('');
    };
  });

})();
