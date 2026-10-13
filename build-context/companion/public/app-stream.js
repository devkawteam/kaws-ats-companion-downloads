/* KAW'S ATS Companion v1.6 — Stream Studio: go live, chat commands for every chatbot, viewer polls,
   viewer effects, OBS overlay / screen links and YouTube chapters. Registers with app-v16.js. */
(() => {
  'use strict';
  const K = window.KAW16;
  if (!K) return;
  const { q, qa, esc, api, guard, notify } = K;

  const WIDGETS = [['speed', 'Speed + limit'], ['route', 'Route + progress'], ['alerts', 'Driver alerts'], ['events', 'Event pop-ups'], ['poll', 'Chat vote'], ['countdown', 'Next convoy countdown'], ['minimap', 'Convoy minimap'], ['convoy', 'Convoy list'], ['shift', 'Gear / shift coach'], ['eco', 'Eco score'], ['ticker', 'Info ticker']];
  const TESTS = [['delivery', '📦 Delivery'], ['achievement', '🏆 Achievement'], ['crash', '💥 Crash'], ['convoyJoin', '👋 Driver joined'], ['fuel', '⛽ Fuel stop'], ['horn', '📯 Horn'], ['confetti', '🎉 Confetti']];
  let chat = null, bot = (() => { try { return localStorage.getItem('kawBot') || 'nightbot'; } catch { return 'nightbot'; } })();

  // One click: create (or update) a Browser Source in the current OBS scene (needs Mixer & OBS connected).
  const addToObs = guard(async (name, url) => {
    const local = url.replace(location.origin, 'http://127.0.0.1:' + (location.port || '80'));
    const r = await api('/api/stream/obs/browser', { method: 'POST', body: { name, url: local, vertical: /layout=vertical|format=vertical/.test(url) } });
    notify('Added to OBS', `${r.inputName} → scene "${r.scene}"`, 'join');
  });
  const copy = async (text, what = 'Copied') => { try { await navigator.clipboard.writeText(text); notify(what, '', 'join'); } catch { prompt('Copy this:', text); } };

  const HTML = `
    <div class="v16-grid v16-2">
      <div class="panel"><div class="panel-head"><div class="panel-title">Go live</div><div id="stLive"></div></div>
        <div class="v16-body v16-stack">
          <div class="v16-row"><select id="stPlatform" class="v16-input" style="max-width:170px"></select><input id="stUrl" class="v16-input" placeholder="https://twitch.tv/yourname" autocomplete="off"></div>
          <input id="stTitle" class="v16-input" placeholder="Stream title (optional)" maxlength="100">
          <label class="v16-toggle"><span>I'm live now <span class="muted" style="font-size:12px">(shows you as live to the convoy and Discord)</span></span><input type="checkbox" id="stManual"></label>
          <label class="v16-toggle"><span>Go live automatically when OBS starts streaming</span><input type="checkbox" id="stAuto"></label>
          <div class="v16-row" id="stTvRow"></div>
          <div class="v16-row"><button class="cmd primary" id="stSave" type="button">Save</button><button class="cmd" id="stSession" type="button">Start chapter log</button><span class="muted" id="stSessionNote" style="font-size:12px"></span></div>
        </div></div>
      <div class="panel"><div class="panel-head"><div class="panel-title">Viewer vote</div><div class="muted" id="stPollState" style="font-size:12px"></div></div>
        <div class="v16-body v16-stack">
          <input id="stPollQ" class="v16-input" placeholder="Where should we go next?" maxlength="120">
          <input id="stPollO" class="v16-input" placeholder="Options, comma separated: Reno, Phoenix, Salt Lake City">
          <div class="v16-row"><select id="stPollMin" class="v16-input" style="max-width:130px"><option value="2">2 minutes</option><option value="5" selected>5 minutes</option><option value="10">10 minutes</option><option value="20">20 minutes</option></select><button class="cmd primary" id="stPollStart" type="button">Start vote</button><button class="cmd" id="stPollClose" type="button">Close vote</button></div>
          <div id="stPollBars"></div>
        </div></div>
    </div>

    <div class="panel" style="margin-top:12px"><div class="panel-head"><div class="panel-title">Chat commands</div><div class="v16-row"><span class="muted" style="font-size:12px" id="stCmdNote"></span><button class="cmd small" id="stRotate" type="button" title="Makes all old command links stop working">New private key</button></div></div>
      <div class="v16-body v16-stack">
        <div class="v16-note">Pick your chatbot, then add each command in its dashboard (or copy the text straight into a custom command). Viewers type <b>!eta</b>, <b>!route</b>, <b>!vote 2</b>… and your bot answers with live truck data from the convoy relay. Your link has a private key — don't show it on stream.</div>
        <div class="v16-row" id="stBots"></div>
        <div id="stBotNote" class="muted" style="font-size:12px"></div>
        <div class="table-wrap"><table class="table" id="stCmds"><thead><tr><th>Command</th><th>What it does</th><th>Paste into your bot</th></tr></thead><tbody></tbody></table></div>
      </div></div>

    <div class="v16-grid v16-2" style="margin-top:12px">
      <div class="panel"><div class="panel-head"><div class="panel-title">Viewer effects</div></div>
        <div class="v16-body v16-stack">
          <label class="v16-toggle"><span>📯 !horn — horn sound on the overlay</span><input type="checkbox" data-fx="horn"></label>
          <label class="v16-toggle"><span>🎉 !confetti — confetti on the overlay</span><input type="checkbox" data-fx="confetti"></label>
          <label class="v16-toggle"><span>📻 !shoutout — message pop-up</span><input type="checkbox" data-fx="shoutout"></label>
          <label class="v16-toggle"><span>🔊 Read shoutouts aloud with the co-driver voice</span><input type="checkbox" data-fx="shoutoutVoice"></label>
          <div class="v16-section-title">Test your overlay</div>
          <div class="v16-row" id="stTests"></div>
        </div></div>
      <div class="panel"><div class="panel-head"><div class="panel-title">YouTube chapters</div><select id="stSessions" class="v16-input" style="max-width:230px"></select></div>
        <div class="v16-body v16-stack">
          <div class="v16-note">Every stream is logged. Paste these timestamps into your YouTube VOD description to get chapters (YouTube needs at least 3).</div>
          <textarea id="stChapters" class="v16-input" rows="8" readonly style="font-family:ui-monospace,Consolas,monospace"></textarea>
          <div class="v16-row"><button class="cmd primary" id="stCopyChapters" type="button">Copy chapters</button><span class="muted" id="stChapNote" style="font-size:12px"></span></div>
        </div></div>
    </div>

    <div class="panel" style="margin-top:12px"><div class="panel-head"><div class="panel-title">Twitch</div><div id="twState"></div></div>
      <div class="v16-body v16-stack">
        <div class="v16-note">Connect your Twitch channel for automatic <b>stream markers</b> (job start, delivery, crash, achievements), a <b>clip on every crash</b>, and an <b>“On time?” prediction</b> on each job (Affiliate/Partner). You sign in on twitch.tv with a short code — no password is ever typed here.</div>
        <div class="v16-row" id="twLogin"></div>
        <label class="v16-toggle"><span>📍 Stream markers</span><input type="checkbox" data-tw="markers"></label>
        <label class="v16-toggle"><span>🎬 Clip crashes</span><input type="checkbox" data-tw="clips"></label>
        <label class="v16-toggle"><span>🔮 “On time?” prediction for each job</span><input type="checkbox" data-tw="predictions"></label>
        <div id="twLog" class="muted" style="font-size:12px"></div>
      </div></div>

    <div class="panel" style="margin-top:12px"><div class="panel-head"><div class="panel-title">Overlays &amp; stream screens</div><div class="muted" style="font-size:12px">OBS / Streamlabs → add a <b>Browser Source</b></div></div>
      <div class="v16-body v16-stack">
        <div class="v16-row" id="stWidgets" style="flex-wrap:wrap"></div>
        <div class="v16-row" style="flex-wrap:wrap">
          <select id="stPos" class="v16-input" style="max-width:150px"><option value="bl">Bottom left</option><option value="br">Bottom right</option><option value="tl">Top left</option><option value="tr">Top right</option><option value="bc">Bottom center</option><option value="tc">Top center</option></select>
          <select id="stScale" class="v16-input" style="max-width:120px"><option value="0.8">Small</option><option value="1" selected>Normal</option><option value="1.3">Large</option><option value="1.6">Huge</option></select>
          <select id="stMap" class="v16-input" style="max-width:170px"><option value="dark">Minimap: dark</option><option value="atsgame">Minimap: ATS game map</option><option value="road">Minimap: road</option><option value="satellite">Minimap: satellite</option></select>
          <select id="stLayout" class="v16-input" style="max-width:190px"><option value="">Landscape 16:9</option><option value="vertical">Vertical 9:16 (TikTok, Shorts)</option></select>
          <label class="v16-toggle" style="padding:0;gap:8px"><span style="font-size:13px">Sounds</span><input type="checkbox" id="stSound" checked></label>
          <label class="v16-toggle" style="padding:0;gap:8px"><span style="font-size:13px">Light cards</span><input type="checkbox" id="stLight"></label>
        </div>
        <div class="v16-row"><input id="stOverlayUrl" class="v16-input" readonly><button class="cmd primary" id="stCopyOverlay" type="button">Copy</button><button class="cmd" id="stOpenOverlay" type="button">Preview</button><button class="cmd" id="stAddOverlayObs" type="button" title="Adds it as a Browser Source to your current OBS scene">Add to OBS</button></div>
        <div class="v16-note">Browser Source size: <b>1920×1080</b> (vertical: <b>1080×1920</b>). Tick <b>Control audio via OBS</b> so horn and chimes go through your mixer. Background is transparent.</div>
        <div class="v16-section-title">Full-screen scenes</div>
        <div id="stScreens" class="v16-stack"></div>
      </div></div>`;

  function overlayUrl() {
    const w = qa('#stWidgets input:checked').map(i => i.value);
    const p = new URLSearchParams({ w: w.join(',') || 'speed,route', pos: q('#stPos').value, scale: q('#stScale').value });
    if (w.includes('minimap')) p.set('map', q('#stMap').value);
    if (q('#stLayout').value) p.set('layout', q('#stLayout').value);
    if (!q('#stSound').checked) p.set('sound', '0');
    if (q('#stLight').checked) p.set('theme', 'light');
    return `${location.origin}/overlay.html?${p}`;
  }
  function renderOverlayBuilder() {
    q('#stOverlayUrl').value = overlayUrl();
    const vert = q('#stLayout').value === 'vertical' ? '&layout=vertical' : '';
    const map = `&map=${encodeURIComponent(q('#stMap').value)}`;
    q('#stScreens').innerHTML = [['starting', 'Starting soon', '&minutes=5'], ['brb', 'Be right back', '&minutes=3'], ['ending', 'Ending / thanks', '']].map(([id, label, extra]) => {
      const url = `${location.origin}/screens.html?screen=${id}${extra}${map}${vert}`;
      return `<div class="v16-row"><b style="min-width:130px">${label}</b><input class="v16-input" readonly value="${esc(url)}"><button class="cmd small" data-copy="${esc(url)}" type="button">Copy</button><button class="cmd small" data-open="${esc(url)}" type="button">Preview</button><button class="cmd small" data-obs="${esc(url)}" data-name="KAW ${esc(label)}" type="button">Add to OBS</button></div>`;
    }).join('') + recapRows();
  }
  // Route replay for outros, and the trip recap card image (TikTok / Shorts / Instagram / Discord).
  function recapRows() {
    const fmt = q('#stLayout').value === 'vertical' ? 'vertical' : 'landscape';
    const replay = `${location.origin}/recap.html?trip=last&animate=1&obs=1&format=${fmt}`;
    const card = `${location.origin}/recap.html?trip=last&format=${fmt}`;
    return `<div class="v16-row"><b style="min-width:130px">Route replay (outro)</b><input class="v16-input" readonly value="${esc(replay)}"><button class="cmd small" data-copy="${esc(replay)}" type="button">Copy</button><button class="cmd small" data-open="${esc(replay)}" type="button">Preview</button></div>` +
      `<div class="v16-row"><b style="min-width:130px">Trip recap card</b><span class="muted" style="font-size:13px">Image for TikTok, Shorts, Instagram and Discord</span><button class="cmd small primary" data-open="${esc(card)}" type="button">Make recap card</button></div>`;
  }

  function renderBots() {
    if (!chat) return;
    q('#stBots').innerHTML = Object.entries(chat.bots || {}).map(([id, b]) => `<button type="button" class="cmd small ${id === bot ? 'primary' : ''}" data-bot="${id}">${esc(b.name)}</button>`).join('');
    const b = chat.bots?.[bot];
    q('#stBotNote').textContent = b ? `Works on: ${b.platforms}` : '';
    const rows = (chat.commands || []).map(c => `<tr><td style="white-space:nowrap"><b>${esc(c.command)}</b> <button class="cmd small" type="button" data-copy="${esc(c.bots[bot] || '')}">Copy</button></td><td class="muted">${esc(c.what)}</td><td><code style="font-size:12px;word-break:break-all;white-space:normal">${esc(c.bots[bot] || '')}</code></td></tr>`);
    q('#stCmds tbody').innerHTML = rows.join('') || `<tr><td colspan="3" class="muted">Open this page on the PC running the Companion to see your commands.</td></tr>`;
    q('#stCmdNote').textContent = chat.relayConnected ? 'Answers come from the convoy relay' : 'Turn on the convoy relay (Settings) so chatbots can reach your truck';
  }

  function renderPoll(v) {
    const p = v?.poll, t = v?.tally || { counts: [], total: 0 };
    q('#stPollState').textContent = p ? `Open · closes ${new Date(p.closesAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}` : 'No vote open';
    q('#stPollBars').innerHTML = p ? p.options.map((o, i) => { const n = t.counts?.[i] || 0, pct = t.total ? Math.round(n / t.total * 100) : 0; return `<div style="margin:6px 0"><div class="v16-row" style="justify-content:space-between"><span>${i + 1}) ${esc(o)}</span><b>${n}</b></div><div class="bar"><span style="width:${pct}%;display:block;height:8px;border-radius:99px;background:var(--blue,#4aa3ff)"></span></div></div>`; }).join('') + `<div class="muted" style="font-size:12px">${t.total} vote${t.total === 1 ? '' : 's'} · viewers type !vote 1-${p.options.length}</div>` : '';
  }

  async function loadChapters() {
    const s = await api('/api/stream/sessions');
    const sel = q('#stSessions');
    const cur = sel.value;
    sel.innerHTML = (s.sessions || []).map(x => `<option value="${esc(x.id)}">${x.live ? '🔴 ' : ''}${esc(new Date(x.startedAt).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }))}${x.title ? ' · ' + esc(x.title) : ''}</option>`).join('') || '<option value="">No streams yet</option>';
    if (cur && [...sel.options].some(o => o.value === cur)) sel.value = cur;
    const c = await api(`/api/stream/chapters${sel.value ? `?id=${encodeURIComponent(sel.value)}` : ''}`).catch(e => ({ text: '', note: e.message }));
    q('#stChapters').value = c.text || '';
    q('#stChapNote').textContent = c.note || (c.count ? `${c.count} chapters` : '');
  }

  const load = guard(async () => {
    chat = await api('/api/stream/chat');
    q('#stPlatform').innerHTML = (chat.platforms || []).map(p => `<option value="${p}">${p[0].toUpperCase() + p.slice(1)}</option>`).join('');
    if (document.activeElement?.closest?.('#page-stream') == null) {
      q('#stPlatform').value = chat.platform; q('#stUrl').value = chat.url || ''; q('#stTitle').value = chat.title || '';
      q('#stManual').checked = Boolean(chat.manualLive); q('#stAuto').checked = chat.autoLive !== false;
      for (const i of qa('[data-fx]')) i.checked = Boolean(chat.effects?.[i.dataset.fx]);
    }
    q('#stTvRow').innerHTML = chat.convoyTvUrl ? `<b style="min-width:110px">📺 Convoy TV</b><input class="v16-input" readonly value="${esc(chat.convoyTvUrl)}"><button class="cmd small" type="button" data-copy="${esc(chat.convoyTvUrl)}">Copy</button><button class="cmd small" type="button" data-open="${esc(chat.convoyTvUrl)}">Open</button>${chat.publicLive ? '' : '<span class="muted" style="font-size:12px">Turn on the public live page (Fun settings) to appear on it.</span>'}` : '';
    q('#stLive').innerHTML = chat.live ? '<span class="v16-pill good">🔴 LIVE</span>' : '<span class="v16-pill muted">Offline</span>';
    renderBots();
    renderPoll(chat);
    const st = await api('/api/stream/status');
    q('#stSession').textContent = st.session ? 'Stop chapter log' : 'Start chapter log';
    q('#stSessionNote').textContent = st.session ? `Logging since ${new Date(st.session.startedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}` : 'Starts on its own when OBS goes live';
    await loadChapters();
    await loadTwitch();
  });

  async function loadTwitch() {
    const t = await api('/api/stream/twitch');
    q('#twState').innerHTML = t.connected ? `<span class="v16-pill good">Connected · ${esc(t.user?.name || t.user?.login || '')}</span>` : '<span class="v16-pill muted">Not connected</span>';
    for (const i of qa('[data-tw]')) i.checked = Boolean(t[i.dataset.tw]);
    let html = '';
    if (!t.configured) html = '<span class="muted" style="font-size:13px">The KAW Twitch app is being set up — this lights up in a coming update.</span>';
    else if (t.login) html = `<span>Go to <a href="${esc(t.login.verificationUri)}" target="_blank" rel="noopener"><b>${esc(t.login.verificationUri.replace(/^https?:\/\//, ''))}</b></a> and enter</span><b style="font-size:22px;letter-spacing:.12em">${esc(t.login.userCode)}</b><span class="muted" style="font-size:12px">Waiting for you to approve…</span>`;
    else if (t.connected) html = '<button class="cmd small" type="button" id="twDisconnect">Disconnect</button>';
    else html = '<button class="cmd primary" type="button" id="twConnect">Connect Twitch</button>';
    q('#twLogin').innerHTML = html + (t.error ? `<span class="muted" style="font-size:12px;color:#ff8a7a">${esc(t.error)}</span>` : '');
    q('#twLog').innerHTML = (t.log || []).map(l => `${esc(new Date(l.at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }))} · ${esc(l.msg)}`).join('<br>');
    const c = q('#twConnect'); if (c) c.onclick = guard(async () => { const r = await api('/api/stream/twitch', { method: 'POST', body: { action: 'connect' } }); window.open(r.verificationUri, '_blank', 'noopener'); loadTwitch(); });
    const d = q('#twDisconnect'); if (d) d.onclick = guard(async () => { await api('/api/stream/twitch', { method: 'POST', body: { action: 'disconnect' } }); loadTwitch(); });
  }

  K.pages.push({
    name: 'stream', icon: '🎥', label: 'Stream Studio', group: 'Stream', index: 0, html: HTML, load,
    init() {
      q('#stWidgets').innerHTML = WIDGETS.map(([id, label]) => `<label class="v16-toggle" style="padding:0 10px 0 0;gap:6px"><input type="checkbox" value="${id}" ${['speed', 'route', 'events', 'poll'].includes(id) ? 'checked' : ''}><span style="font-size:13px">${esc(label)}</span></label>`).join('');
      q('#stTests').innerHTML = TESTS.map(([id, label]) => `<button class="cmd small" type="button" data-test="${id}">${label}</button>`).join('');
      for (const sel of ['#stWidgets', '#stPos', '#stScale', '#stMap', '#stLayout', '#stSound', '#stLight']) q(sel).addEventListener('change', renderOverlayBuilder);
      renderOverlayBuilder();
      q('#page-stream').addEventListener('click', e => {
        const b = e.target.closest('button');
        if (!b) return;
        if (b.dataset.copy !== undefined) copy(b.dataset.copy);
        if (b.dataset.open) window.open(b.dataset.open, '_blank', 'noopener,width=1280,height=760');
        if (b.dataset.bot) { bot = b.dataset.bot; try { localStorage.setItem('kawBot', bot); } catch {} renderBots(); }
        if (b.dataset.obs) addToObs(b.dataset.name || 'KAW Scene', b.dataset.obs);
        if (b.dataset.test) guard(async () => { await api('/api/stream/test', { method: 'POST', body: { type: b.dataset.test } }); notify('Sent to your overlay', 'Open the overlay preview to see it.', 'join'); })();
      });
      q('#stAddOverlayObs').onclick = () => addToObs(q('#stLayout').value === 'vertical' ? 'KAW Overlay (vertical)' : 'KAW Overlay', q('#stOverlayUrl').value);
      q('#stCopyOverlay').onclick = () => copy(q('#stOverlayUrl').value, 'Overlay link copied');
      q('#stOpenOverlay').onclick = () => window.open(q('#stOverlayUrl').value, '_blank', 'noopener,width=1280,height=760');
      q('#stSave').onclick = guard(async () => {
        const effects = Object.fromEntries(qa('[data-fx]').map(i => [i.dataset.fx, i.checked]));
        await api('/api/stream/chat', { method: 'POST', body: { platform: q('#stPlatform').value, url: q('#stUrl').value.trim(), title: q('#stTitle').value.trim(), live: q('#stManual').checked, autoLive: q('#stAuto').checked, effects } });
        notify('Stream settings saved', '', 'join'); load();
      });
      for (const i of qa('[data-fx]')) i.addEventListener('change', () => q('#stSave').click());
      q('#stSession').onclick = guard(async () => { const st = await api('/api/stream/status'); await api('/api/stream/session', { method: 'POST', body: { action: st.session ? 'stop' : 'start', title: q('#stTitle').value.trim() } }); load(); });
      q('#stRotate').onclick = guard(async () => { if (!confirm('Make a new private key? Every chatbot command you already added stops working until you paste the new ones.')) return; await api('/api/stream/chat/rotate', { method: 'POST' }); notify('New key created', 'Re-paste your chat commands.', 'join'); load(); });
      q('#stPollStart').onclick = guard(async () => { const r = await api('/api/stream/poll', { method: 'POST', body: { question: q('#stPollQ').value, options: q('#stPollO').value, minutes: q('#stPollMin').value } }); renderPoll(r); notify('Vote started', 'Viewers type !vote 1, 2, 3…', 'join'); });
      q('#stPollClose').onclick = guard(async () => { const r = await api('/api/stream/poll', { method: 'POST', body: { action: 'close' } }); renderPoll(null); notify(r.winners?.length ? `Chat picked ${r.winners.join(' / ')}` : 'Vote closed', '', 'join'); });
      q('#stSessions').onchange = guard(loadChapters);
      for (const i of qa('[data-tw]')) i.addEventListener('change', guard(async () => { await api('/api/stream/twitch', { method: 'POST', body: Object.fromEntries(qa('[data-tw]').map(x => [x.dataset.tw, x.checked])) }); loadTwitch(); }));
      q('#stCopyChapters').onclick = () => copy(q('#stChapters').value, 'Chapters copied');
    }
  });
  let tick = 0;
  K.onTick.push((d, page) => { if (page === 'stream' && ++tick % 6 === 0) { guard(async () => renderPoll(await api('/api/stream/poll')))(); if (q('#twLogin')?.textContent.includes('Waiting')) guard(loadTwitch)(); } });
})();
