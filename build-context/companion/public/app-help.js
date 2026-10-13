// First-use tour, Help / How to use page, and connection indicators (Jarvis · CB relay · community knowledge).
// The tour never turns on the microphone or plays sound; it only moves between pages when you press Next.
// Author: Kaw.
(() => {
  const K = window.KAW16; if (!K) return;
  const { q, esc, api } = K;
  const DONE = 'kawTourDone';
  const stored = k => { try { return localStorage.getItem(k); } catch { return null; } };
  const store = (k, v) => { try { localStorage.setItem(k, v); } catch {} };

  // ------------------------------------------------------------ connection indicators
  const css = document.createElement('style');
  css.textContent = `
  #kawConn { display:flex; gap:6px; flex-wrap:wrap; align-items:center }
  #kawConn .kc { font-size:11.5px; padding:3px 8px; border-radius:999px; border:1px solid color-mix(in srgb,var(--muted) 40%,transparent); background:transparent; color:var(--text); cursor:pointer }
  #kawConn .kc.good { border-color:var(--green) } #kawConn .kc.bad { border-color:var(--red) } #kawConn .kc.warn { border-color:var(--yellow) }
  #kawTour { position:fixed; z-index:9999; right:16px; bottom:16px; width:min(420px, calc(100vw - 32px)); background:var(--panel, #12161d); color:var(--text); border:1px solid var(--blue); border-radius:14px; box-shadow:0 10px 40px rgba(0,0,0,.45); padding:14px 16px }
  #kawTour h3 { margin:0 0 6px; font-size:16px } #kawTour p { margin:0 0 10px; line-height:1.5; font-size:14px }
  #kawTour .row { display:flex; gap:8px; justify-content:space-between; align-items:center; flex-wrap:wrap }
  .kaw-tour-target { outline:3px solid var(--yellow) !important; outline-offset:3px; border-radius:6px }
  @media (max-width:600px) { #kawTour { left:12px; right:12px; bottom:12px; width:auto } }
  .kaw-help h3 { margin:14px 0 6px } .kaw-help li { margin:4px 0; line-height:1.5 }`;
  document.head.append(css);

  const conn = { jarvis: null, relay: null };
  function pill(id, cls, label, title) { return `<button type="button" class="kc ${cls}" data-kc="${id}" title="${esc(title)}" aria-label="${esc(label + ': ' + title)}">${esc(label)}</button>`; }
  function renderConn() {
    const box = q('#kawConn'); if (!box) return;
    const j = conn.jarvis, r = conn.relay, k = j?.knowledge;
    box.innerHTML =
      pill('jarvis', !j ? '' : j.online ? 'good' : 'bad', j?.online ? '☎ Jarvis' : '☎ Jarvis off', j?.message || 'Checking Jarvis…') +
      ((r && r.up && (r.pushState === 'rejected' || r.pushState === 'off'))
        ? pill('relay', r.pushState === 'rejected' ? 'bad' : 'warn', r.pushState === 'rejected' ? '📻 Not in convoy' : '📻 Sharing off', r.pushDetail || '')
        : pill('relay', !r ? '' : r.up ? (r.usingBackup ? 'warn' : 'good') : r.configured === false ? '' : 'bad', r?.up ? (r.usingBackup ? '📻 CB backup' : '📻 CB') : '📻 CB off', r ? (r.up ? `Relay ${r.origin || ''}` : r.detail || r.status || 'Relay not set up') : 'Checking relay…')) +
      pill('knowledge', !k ? '' : k.connected ? 'good' : 'warn', k?.connected ? '📘 Community' : '📘 Community n/a', k?.message || (j?.online ? 'Community knowledge status unknown.' : 'Needs Jarvis.'));
    box.querySelectorAll('[data-kc]').forEach(b => b.onclick = () => { K.go?.(b.dataset.kc === 'relay' ? 'radio' : b.dataset.kc === 'jarvis' ? 'jarvis' : 'help'); if (b.dataset.kc === 'knowledge') setTimeout(() => q('#hlpFixes')?.scrollIntoView({ block: 'start' }), 200); });
  }
  async function refreshConn() {
    try { conn.jarvis = await api('/api/jarvis/status'); } catch (e) { conn.jarvis = { online: false, message: e.message }; }
    try { conn.relay = await api('/api/relay'); } catch { conn.relay = null; }
    renderConn();
  }

  // ------------------------------------------------------------ tour
  const STEPS = [
    { title: "Welcome to KAW's ATS Playground Companion", text: 'A quick tour of the main parts (about a minute). It won\'t turn on your microphone or play any sound. Skip any time — you can replay it from Help.' },
    { page: 'drive', sel: '#v16Kpis', title: 'Dashboard & telemetry', text: 'Live speed, fuel, route and rest come from American Truck Simulator while the game and the telemetry plugin run. Dashes mean the game isn\'t sending data yet.' },
    { sel: '[data-page="trips"]', title: 'Trips', text: 'Every delivery is saved here with distance, income and a replay. Nothing leaves your PC unless you share it.' },
    { sel: '[data-page="convoy"]', title: 'Convoy tools', text: 'Join a convoy with a pairing code, see drivers on the radar, plan formations and check mods before you roll.' },
    { sel: '[data-page="radio"]', title: 'CB radio & Discord fallback', text: 'Talk to the convoy over the Companion CB. If the relay is down, use the “Join ATS Convoy voice on Discord” link — that\'s a manual switch, not automatic.' },
    { sel: '[data-page="jarvis"]', title: 'Jarvis — public assistant', text: "Jarvis is KAW's public assistant for everyone: chat about trucking, ATS and KAW's ATS Playground. He is NOT Kenny's private personal assistant and can't see any private mail, calendars, briefings or systems." },
    { page: 'jarvis', sel: '#jvVoice', title: 'Talking to Jarvis', text: 'Press Start conversation, allow the microphone when the browser asks, then talk. The green “Mic ON” badge shows when he is listening. “Pause before answering” sets how long he waits when you pause mid-sentence (1–8 s) — it is waiting time, not mic volume.' },
    { page: 'jarvis', sel: '#jvStop', title: 'Stopping', text: 'Stop conversation (or Esc, or saying “goodbye”) turns the microphone off and stops speech straight away. Leaving the Jarvis page also stops it.' },
    { sel: '#kawConn', title: 'Connection lights', text: 'Jarvis, CB relay and Community knowledge. Green = connected, yellow = partly, red/grey = off. Click a light for details and fixes.' },
    { sel: '#kawHelpBtn', title: 'Help any time', text: 'The ? button opens Help / How to use: quick instructions and fixes for microphone, voice and connection problems.' }
  ];
  let step = -1, lastTarget = null;
  function clearTarget() { lastTarget?.classList.remove('kaw-tour-target'); lastTarget = null; }
  function showStep(i) {
    step = Math.max(0, Math.min(STEPS.length - 1, i));
    const s = STEPS[step];
    if (s.page) K.go?.(s.page);
    clearTarget();
    setTimeout(() => { const t = s.sel && q(s.sel); if (t) { t.classList.add('kaw-tour-target'); t.scrollIntoView?.({ block: 'nearest', behavior: 'smooth' }); lastTarget = t; } }, s.page ? 250 : 0);
    let box = q('#kawTour');
    if (!box) { box = document.createElement('div'); box.id = 'kawTour'; box.setAttribute('role', 'dialog'); box.setAttribute('aria-modal', 'false'); box.setAttribute('aria-labelledby', 'kawTourTitle'); document.body.append(box); }
    const last = step === STEPS.length - 1;
    box.innerHTML = `<div class="muted" style="font-size:12px">Step ${step + 1} of ${STEPS.length}</div><h3 id="kawTourTitle">${esc(s.title)}</h3><p>${esc(s.text)}</p>
      <div class="row"><button class="cmd" id="kawTourSkip" type="button">Skip tour</button><span><button class="cmd" id="kawTourBack" type="button" ${step === 0 ? 'disabled' : ''}>Back</button> <button class="cmd" id="kawTourNext" type="button">${last ? 'Finish' : 'Next'}</button></span></div>`;
    q('#kawTourSkip').onclick = () => endTour();
    q('#kawTourBack').onclick = () => showStep(step - 1);
    q('#kawTourNext').onclick = () => last ? endTour() : showStep(step + 1);
    q('#kawTourNext').focus({ preventScroll: true });
  }
  function endTour() { clearTarget(); q('#kawTour')?.remove(); step = -1; store(DONE, '1'); }
  function startTour() { showStep(0); }
  document.addEventListener('keydown', e => {
    if (step < 0) return;
    if (e.key === 'Escape') endTour();
    else if (e.key === 'ArrowRight' && !/INPUT|TEXTAREA|SELECT/.test(document.activeElement?.tagName || '')) showStep(step + 1);
    else if (e.key === 'ArrowLeft' && !/INPUT|TEXTAREA|SELECT/.test(document.activeElement?.tagName || '')) showStep(step - 1);
  });

  // ------------------------------------------------------------ Help page
  const html = `<div class="panel"><div class="panel-head"><div class="panel-title">Help / How to use</div><button class="cmd" id="hlpTour" type="button">▶ Show the tour again</button></div><div class="v16-body kaw-help">
    <h3>Getting started</h3><ol>
      <li>Start American Truck Simulator with the telemetry plugin installed; the dashboard fills in once you're driving.</li>
      <li>Convoy: enter the pairing code your convoy uses in Settings, then open Convoy and CB.</li>
      <li>Jarvis: open Jarvis, press <b>Start conversation</b>, allow the microphone, and talk. Or just type.</li></ol>
    <h3>Jarvis vs Kenny's private assistant</h3>
    <p>Jarvis is the <b>public</b> assistant everyone with the Companion can use. He answers from public information and KAW's approved community knowledge. He has no access to Kenny's private personal assistant, mail, calendars, briefings, files or other systems — asking, or claiming to be Kenny, won't change that.</p>
    <p><button class="btn" id="hlpPrivacy" type="button">Privacy &amp; disclaimers</button> — Read before using AI, voice or community services.</p>
    <h3>Best practice for voice</h3><ul>
      <li>Microsoft Edge is the verified browser for talking to Jarvis. Chrome works for many people too.</li>
      <li>Use a headset or keep speakers low so Jarvis doesn't hear himself. He never listens while he is speaking.</li>
      <li>If he cuts you off, raise <b>Pause before answering</b> (1–8 s) or press <b>Done speaking</b> when you've finished.</li>
      <li>Stop conversation, Esc, “goodbye”, or leaving the page always turns the mic off. The mic badge shows the truth.</li>
      <li>Keep your eyes on the road — use voice, not typing, while driving.</li></ul>
    <h3 id="hlpFixes">Fixes</h3><ul>
      <li><b>Microphone blocked:</b> click the lock icon left of the address → Microphone → Allow, reload. Also check Windows Settings → Privacy &amp; security → Microphone → let the browser use it.</li>
      <li><b>Speech recognition unavailable:</b> the browser's speech service needs the internet. Firefox has none — use Edge. On a phone or another PC, open the secure (https) link.</li>
      <li><b>Jarvis is silent:</b> check the volume / output device, that the Co-Driver isn't set to “ATS voice only” (game-only audio), and click once on the page (browsers block sound until you do).</li>
      <li><b>Missing voice:</b> chosen voices are per browser. Pick another in “Jarvis's voice”; natural voices need KAW's relay to have them turned on.</li>
      <li><b>CB / relay disconnected:</b> open Companion CB and press Check again. A “needs sign-in” message means the relay address is protected — set the public relay address. Meanwhile use the Discord voice link.</li>
      <li><b>Community info unavailable:</b> Jarvis says so rather than guessing. Live player counts, server status and convoy dates only come from connected live sources.</li></ul>
    <h3>Connections now</h3><div id="hlpConn" class="v16-note">Checking…</div>
  </div></div>`;
  K.pages.push({ name: 'help', icon: '?', label: 'Help / How to use', group: 'Setup', index: 0, html,
    init() { q('#hlpTour').onclick = startTour; },
    load: async () => {
      await refreshConn();
      const j = conn.jarvis || {}, r = conn.relay || {}, k = j.knowledge || {};
      q('#hlpConn').innerHTML = `<ul><li>Jarvis: ${esc(j.online ? 'online' : 'offline')} — ${esc(j.message || '')}</li><li>CB relay: ${esc(r.up ? 'online' : r.status || 'not set up')}${r.detail ? ` — ${esc(r.detail)}` : ''}</li><li>Community knowledge: ${esc(k.message || 'not reported')}${(k.documents || []).length ? ` (${k.documents.map(d => `${esc(d.title)} rev ${esc(d.revision || '?')}`).join(', ')})` : ''}</li></ul>`;
    } });

  K.onReady.push(() => {
    const actions = q('.top-actions');
    if (actions) {
      actions.insertAdjacentHTML('afterbegin', '<div id="kawConn" aria-label="Connections"></div><button class="icon-btn" id="kawHelpBtn" type="button" title="Help / How to use" aria-label="Help / How to use">?</button>');
      q('#kawHelpBtn').onclick = () => K.go?.('help');
    }
    renderConn(); refreshConn(); setInterval(refreshConn, 60000);
    // The convoy light is local and cheap: keep it current (joining/leaving shows within seconds).
    setInterval(async () => { try { conn.relay = await api('/api/relay'); renderConn(); } catch {} }, 10000);
    // First visit on this device: offer the tour — but not while the truck is moving.
    if (!stored(DONE)) setTimeout(() => { const d = K.telem?.() || {}; if (step < 0 && !(d.connected && Number(d.truck?.speedMph) > 3)) startTour(); }, 1500);
  });
  window.KAWTour = { start: startTour, end: endTour, steps: STEPS.length };
})();
