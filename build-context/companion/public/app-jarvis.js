// Jarvis: chat with KAW's assistant in the office (KAW's own AI, through the relay). Author: Kaw.
// Voice conversation (listen → answer → listen), one-shot mic, typed chat, Jarvis voice picker,
// and voice diagnostics. The turn-taking logic lives in jarvis-voice.js.
(() => {
  const K = window.KAW16, V = window.KAWJarvisVoice; if (!K || !V) return;
  const { q, api, esc, guard } = K;
  const UI_BUILD = 'jarvis-voice-2';
  const STORE = 'kawJarvisChat', SPEAK = 'kawJarvisSpeak', VOICE = 'kawJarvisVoice', EXTRAS = 'kawJarvisExtras', PAUSE = 'kawJarvisPause';
  // Pause before answering (seconds of quiet before Jarvis treats your turn as finished), saved on this device.
  let pauseSec = 3;
  try { const p = Number(localStorage.getItem(PAUSE)); if (p >= 1 && p <= 8) pauseSec = p; } catch {}
  let extras = { wake: false, brief: false, copilot: false };
  try { extras = { ...extras, ...JSON.parse(localStorage.getItem(EXTRAS) || '{}') }; } catch {}
  const keepExtras = () => { try { localStorage.setItem(EXTRAS, JSON.stringify(extras)); } catch {} };
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  const local = ['127.0.0.1', 'localhost', '[::1]'].includes(location.hostname);
  const ua = navigator.userAgent;
  const browser = /Edg\//.test(ua) ? 'Microsoft Edge' : /OPR\//.test(ua) ? 'Opera' : /Chrome\//.test(ua) ? 'Google Chrome' : /Firefox\//.test(ua) ? 'Firefox' : 'this browser';
  const speechProvider = /Edg\//.test(ua) ? "Microsoft's online speech service" : /Chrome\//.test(ua) ? "Google's online speech service" : 'the browser speech service';
  let chat = [], sending = false, online = false, speakOn = false, session = null, diagLog = [], phase = 'off', voicePref = { voiceURI: '', name: '', natural: '', rate: 1, pitch: 1 }, natural = { enabled: false, voices: [], note: '' };
  try {
    chat = JSON.parse(localStorage.getItem(STORE) || '[]').filter(m => m && (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string').slice(-40);
    speakOn = localStorage.getItem(SPEAK) === '1';
    voicePref = { ...voicePref, ...JSON.parse(localStorage.getItem(VOICE) || '{}') };
  } catch {}
  const keep = () => { try { localStorage.setItem(STORE, JSON.stringify(chat.slice(-40))); } catch {} };

  const html = `<div class="panel"><div class="panel-head"><div class="panel-title">Jarvis — KAW's office</div><div id="jvState" class="muted" style="font-size:12px"></div></div><div class="v16-body">
    <p>Jarvis is KAW's assistant in the office. Talk with him while you drive: about anything friendly, your trip, or American Truck Simulator questions.</p>
    <div class="panel" id="jvVoice" style="padding:12px;margin:8px 0">
      <div class="v16-row" style="gap:10px;align-items:center">
        <span id="jvMicBadge" class="v16-pill" style="font-weight:700" aria-live="polite">🎤 Mic off</span>
        <button class="cmd" id="jvStart" style="font-size:15px">▶ Start conversation</button>
        <button class="cmd" id="jvStop" style="font-size:15px" disabled>⏹ Stop conversation</button>
        <button class="cmd" id="jvTalk" style="font-size:15px" hidden>✋ Interrupt / Talk</button>
        <button class="cmd" id="jvDone" style="font-size:15px" hidden title="Send what you said now, without waiting for the pause">✔ Done speaking</button>
        <label style="flex:1 1 220px;min-width:200px" for="jvPause"><b>Pause before answering:</b> <span id="jvPauseVal"></span>
          <input type="range" id="jvPause" min="1" max="8" step="0.5" style="width:100%" aria-describedby="jvPauseHelp"></label>
      </div>
      <p class="v16-note" id="jvPauseHelp" style="margin:4px 0 0">How long Jarvis waits after you stop talking before he answers — raise it if he cuts you off mid-sentence. It is waiting time only, not microphone volume or sensitivity. Or press “Done speaking”.</p>
      <div style="margin-top:8px"><b id="jvPhase">Off</b> <span id="jvTurns" class="v16-note"></span><div id="jvCaption" class="v16-note" aria-live="polite"></div></div>
      <div id="jvError" class="panel" style="padding:10px;margin-top:8px;border-left:5px solid #e74c3c" role="alert" hidden></div>
      <p class="v16-note" style="margin:8px 0 0">Press Start, allow the microphone, then just talk. When you've been quiet for the pause you set, Jarvis answers out loud and listens again. Say “goodbye” or press Stop to finish. Replies are always spoken during a conversation. Your speech is turned into text by ${esc(speechProvider)} (it is not offline); the Companion does not record or keep audio.</p>
    </div>
    <div id="jvLog" style="height:360px;overflow:auto;display:flex;flex-direction:column;gap:8px;padding:10px;border-radius:10px;background:color-mix(in srgb,var(--panel2) 70%,transparent)" aria-live="polite"></div>
    <div class="v16-row" style="margin-top:8px"><input class="v16-input" id="jvText" style="flex:1 1 300px" maxlength="600" placeholder="Or type to Jarvis…" aria-label="Message to Jarvis"><button class="cmd" id="jvMic" title="Speak one message" aria-label="Speak one message" hidden>🎙</button><button class="cmd" id="jvSend">Send</button></div>
    <div class="v16-row" style="justify-content:space-between"><label class="v16-toggle" style="flex:1 1 260px"><span>Read typed-chat replies aloud</span><input type="checkbox" id="jvSpeak"></label><button class="cmd" id="jvClear">New conversation</button></div>
    <details id="jvExtras" style="margin-top:8px" open><summary>Jarvis extras</summary>
      <label class="v16-toggle"><span><b>“Hey Jarvis”</b> — start a conversation by saying “Hey Jarvis” while the dashboard is open</span><input type="checkbox" id="jvWake"></label>
      <p class="v16-note" id="jvWakeNote">While this is on, the browser listens for “Hey Jarvis” using its online speech service (the mic badge shows it). Off by default.</p>
      <label class="v16-toggle"><span><b>Trip briefing</b> — Jarvis briefs you when you take a job</span><input type="checkbox" id="jvBrief"></label>
      <div class="v16-row"><button class="cmd" id="jvBriefNow">📋 Brief me now</button></div>
      <label class="v16-toggle"><span><b>Co-pilot voice</b> — speak Co-Driver alerts in Jarvis's voice</span><input type="checkbox" id="jvCopilot"></label>
      <p class="v16-note">Pick Jarvis's voice below first. Alerts still follow your Co-Driver settings; only the voice changes.</p>
    </details>
    <details id="jvMemBox" style="margin-top:8px"><summary>What Jarvis remembers</summary>
      <p class="v16-note">Things you ask Jarvis to remember are saved only on this PC and sent with your chats so he can use them. Say “remember that my favourite truck is the W900”, or add them here. No passwords, emails, phone numbers or addresses.</p>
      <div id="jvMemList"></div>
      <div class="v16-row"><input class="v16-input" id="jvMemText" style="flex:1 1 280px" maxlength="120" placeholder="e.g. My home city is Reno"><button class="cmd" id="jvMemAdd">Remember</button><button class="cmd" id="jvMemClear">Forget everything</button></div>
    </details>
    <details id="jvVoiceBox" style="margin-top:8px"><summary>Jarvis's voice</summary>
      <p class="v16-note"><b>Natural voices:</b> Kokoro speech is generated on KAW's PC and delivered through the protected relay, or directly when running locally. Choose an American or British male or female voice and press Play sample. No paid voice-service account is needed for Kokoro. <b>Browser voices</b> are installed in ${esc(browser)} on this PC and provide a fallback if natural speech is unavailable. Your choice is saved on this device.</p>
      <div class="v16-row"><label style="flex:2 1 300px">Voice <select class="v16-input" id="jvVoiceSel"></select></label>
        <label style="flex:1 1 140px">Speed <input type="range" id="jvRate" min="0.85" max="1.15" step="0.05" style="width:100%"></label>
        <label style="flex:1 1 140px">Pitch <input type="range" id="jvPitch" min="0.85" max="1.1" step="0.05" style="width:100%"></label>
        <button class="cmd" id="jvSample">▶ Play sample</button></div>
      <p class="v16-note" id="jvVoiceNote"></p>
    </details>
    <details id="jvSettings" style="margin-top:8px"><summary>Jarvis server</summary>
      <p class="v16-note">Jarvis answers from KAW's relay. Normally that's your convoy relay; set a separate Jarvis server here if needed. This doesn't change your convoy or CB radio settings.</p>
      <div class="v16-row"><input class="v16-input" id="jvRelay" style="flex:1 1 300px" placeholder="https://…" aria-label="Jarvis server address"><button class="cmd" id="jvRelaySave">Save</button><button class="cmd" id="jvRelayReset">Use convoy relay</button></div>
      <p class="v16-note" id="jvRelayNow"></p>
    </details>
    <details id="jvDiag" style="margin-top:8px"><summary>Voice diagnostics</summary>
      <p class="v16-note">For when the microphone stops by itself. Shows what the browser reported (events and error codes only — never what you said).</p>
      <div class="v16-row"><button class="cmd" id="jvMicTest">Test microphone (3 s)</button><button class="cmd" id="jvDiagCopy">Copy diagnostics</button><span id="jvLevel" class="v16-note"></span></div>
      <pre id="jvDiagOut" style="white-space:pre-wrap;font-size:12px;max-height:240px;overflow:auto;background:var(--panel2);padding:8px;border-radius:8px"></pre>
    </details>
    <p class="v16-note">Messages go over the internet to KAW's office AI so Jarvis can answer. He only gets your driver name, your messages and a few trip facts (truck, load, nearest town, speed) — never your settings or files. Please don't share personal information. Fair-use limits apply so everyone gets a turn.</p>
  </div></div>`;

  // ------------------------------------------------------------ chat
  // Public links Jarvis looked at, under his reply (the voice only says the source name).
  function sourcesHtml(list) {
    if (!Array.isArray(list) || !list.length) return '';
    const docs = list.filter(x => x.knowledge).slice(0, 3);
    const docHtml = docs.length ? `<div style="margin-top:6px;font-size:12px;opacity:.85">From KAW's ATS Playground: ${docs.map(x => `📘 ${esc(x.title)}${x.revision ? ` <span class="v16-note">rev ${esc(x.revision)}${x.published ? `, ${esc(x.published)}` : ''}</span>` : ''}`).join(' · ')}</div>` : '';
    const safe = list.filter(x => /^https?:\/\//.test(x.url || '')).slice(0, 6);
    if (!safe.length) return docHtml;
    return docHtml + `<div style="margin-top:6px;font-size:12px;opacity:.85">Sources: ${safe.map(x => `<a href="${esc(x.url)}" target="_blank" rel="noopener noreferrer" title="${esc(x.site || '')}">${x.read ? '📄 ' : ''}${esc(String(x.title || x.site).replace(/ [-–|] Wikipedia$/, '').slice(0, 48))}</a> <span class="v16-note">${esc(x.site || '')}${x.published ? `, ${esc(String(x.published).slice(0, 25))}` : ''}</span>`).join(' · ')}${safe[0].retrievedAt ? ` <span class="v16-note">· checked ${esc(new Date(safe[0].retrievedAt).toLocaleString())}</span>` : ''}</div>`;
  }
  function render() {
    const log = q('#jvLog'); if (!log) return;
    log.innerHTML = (chat.length ? chat : [{ role: 'assistant', content: "Hey driver! Jarvis here, KAW's assistant in the office. Pull up a chair — what's on your mind?" }]).map(m => `<div style="max-width:80%;padding:9px 12px;border-radius:14px;white-space:pre-wrap;line-height:1.45;${m.role === 'user' ? 'align-self:flex-end;background:var(--blue);color:#fff;border-bottom-right-radius:4px' : 'align-self:flex-start;background:var(--panel);border:1px solid color-mix(in srgb,var(--line) 60%,transparent);border-bottom-left-radius:4px'}">${m.role === 'assistant' ? '<b style="font-size:12px;opacity:.8">Jarvis</b><br>' : ''}${esc(m.content)}${sourcesHtml(m.sources)}</div>`).join('')
      + (sending ? '<div class="v16-note" style="align-self:flex-start">Jarvis is thinking…</div>' : '');
    log.scrollTop = log.scrollHeight;
  }
  let lastStatus = {}, lastTiming = null;
  // "Last reply timing" for Voice diagnostics: where the waiting time went (numbers only, never words).
  function timingText() {
    const t = lastTiming, sec = ms => ms == null ? '?' : (ms / 1000).toFixed(1) + ' s';
    if (!t) return 'Last reply timing: (no reply yet)';
    const r = t.relay || {};
    const lines = [`Last reply timing (${new Date(t.at).toLocaleTimeString()}, ${t.chars} characters):`,
      `  total until the text arrived: ${sec(t.roundTripMs)}`,
      r.totalMs != null ? `  relay: waiting in line ${sec(r.queueMs)} · community knowledge ${sec(r.knowledgeMs)} · AI ${(r.modelMs || []).map(sec).join(' + ') || '?'} · tools ${sec(r.toolsMs)} · relay total ${sec(r.totalMs)}` : '  relay: no breakdown (older relay)'];
    const sp = (K.coDriver?.speechTimings?.() || []).filter(x => x.at >= t.at - 1000);
    if (sp.length) lines.push('  natural voice segments:', ...sp.map((x, i) => `    ${i + 1}. ${x.chars} chars · waited ${sec(x.waitMs)}${x.prefetched ? ` (prepared during the previous segment, generated in ${sec(x.generateMs)})` : ''} · gap before it ${x.gapMs == null ? '—' : sec(x.gapMs)} · ${x.audioSec ?? '?'} s of audio`));
    return lines.join('\n');
  }
  async function status() {
    const s = await api('/api/jarvis/status').catch(e => ({ online: false, message: e.message }));
    lastStatus = s; online = Boolean(s.online);
    q('#jvState').textContent = online ? `🟢 ${s.message || 'In the office'}${s.waiting ? ` · ${s.waiting} waiting` : ''}` : `⚪ ${s.message || 'Away'}`;
    if (!local) q('#jvState').textContent += window.isSecureContext ? ' · on this device' : ' · typing works here; for the microphone open the secure (https) link';
    q('#jvRelayNow').textContent = s.relay ? `Jarvis server in use: ${s.relay}${s.custom ? ' (Jarvis-only setting)' : ' (your convoy relay)'}` : '';
    if (s.custom && document.activeElement !== q('#jvRelay')) q('#jvRelay').value = s.relay;
    return s;
  }
  // Returns Jarvis's reply. Voice turns throw a driver-friendly error instead of a toast.
  async function send(text, { fromVoice = false } = {}) {
    text = String(text || '').trim();
    if (!text) return null;
    const remember = /^(?:hey\s+)?(?:jarvis[,.!]?\s+)?(?:please\s+)?remember(?:\s+that)?\s+(.{2,})$/i.exec(text);
    if (remember) return rememberLocally(text, remember[1].replace(/[.!]+$/, ''), fromVoice);
    if (sending) { if (fromVoice) throw new Error('Jarvis is still answering the last message.'); return null; }
    chat.push({ role: 'user', content: text.slice(0, 600) }); if (!fromVoice) q('#jvText').value = ''; sending = true; render();
    try {
      const sentAt = performance.now();
      const r = await fetch('/api/jarvis/chat', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ messages: chat.slice(-12) }) }).then(x => x.json()).catch(() => ({ ok: false, error: "Couldn't reach the Companion on this PC. Is it still running?" }));
      if (r.ok) {
        lastTiming = { at: Date.now(), roundTripMs: Math.round(performance.now() - sentAt), relay: r.timing || null, chars: String(r.reply || '').length };
        chat.push({ role: 'assistant', content: r.reply, ...(r.sources?.length ? { sources: r.sources } : {}) });
        // Same segmented path as voice conversations (natural voices have a per-request length limit).
        if (speakOn && !fromVoice) K.coDriver?.speakAndWait?.(r.reply, voiceOpts());
        return r.reply;
      }
      chat.pop(); if (!fromVoice) q('#jvText').value = text;
      if (fromVoice) throw new Error(r.error || 'Jarvis could not answer.');
      showError(r.error || 'Jarvis could not answer.');
      return null;
    } finally { sending = false; keep(); render(); }
  }
  async function rememberLocally(said, what, fromVoice) {
    chat.push({ role: 'user', content: said.slice(0, 600) });
    const r = await fetch('/api/jarvis/memory', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ text: what }) }).then(x => x.json()).catch(() => ({ ok: false, error: "Couldn't reach the Companion." }));
    const reply = r.ok ? `Got it — I'll remember that ${r.item.text.replace(/^my /i, 'your ')}. It's saved on this PC; you can change it under “What Jarvis remembers”.` : `I couldn't save that: ${r.error}`;
    chat.push({ role: 'assistant', content: reply }); keep(); render(); renderMemory(r.items);
    if (!fromVoice && speakOn) K.coDriver?.speak?.(reply, { priority: 3, force: true, log: false, voiceOpts: voiceOpts() });
    return reply;
  }
  async function renderMemory(items) {
    if (!local) { q('#jvMemList').innerHTML = '<p class="v16-note">Manage this on the PC running the Companion.</p>'; return; }
    if (!items) items = (await api('/api/jarvis/memory').catch(() => ({ items: [] }))).items || [];
    q('#jvMemList').innerHTML = items.length ? items.map(m => `<div class="v16-row" style="margin:4px 0"><input class="v16-input" style="flex:1 1 260px" data-mem="${esc(m.id)}" value="${esc(m.text)}" maxlength="120" aria-label="Saved preference"><button class="cmd" data-memsave="${esc(m.id)}">Save</button><button class="cmd" data-memdel="${esc(m.id)}" aria-label="Delete">✕</button></div>`).join('') : '<p class="v16-note">Nothing saved yet.</p>';
    const post = (path, body) => fetch(path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }).then(x => x.json());
    q('#jvMemList').querySelectorAll('[data-memsave]').forEach(b => b.onclick = guard(async () => { const r = await post('/api/jarvis/memory/update', { id: b.dataset.memsave, text: q(`[data-mem="${b.dataset.memsave}"]`).value }); if (!r.ok) throw new Error(r.error); K.notify('Saved', '', 'join'); renderMemory(r.items); }));
    q('#jvMemList').querySelectorAll('[data-memdel]').forEach(b => b.onclick = guard(async () => { const r = await post('/api/jarvis/memory/delete', { id: b.dataset.memdel }); renderMemory(r.items); }));
  }

  // ------------------------------------------------------------ trip briefing
  let lastJobKey = null;
  async function briefing({ auto = false } = {}) {
    const r = await api('/api/jarvis/briefing');
    chat.push({ role: 'assistant', content: `📋 ${r.text}` }); keep(); render();
    if (auto && session?.state().on) return;              // mid-conversation: show it, don't talk over the driver
    await speakAndWait(r.text);
  }
  function watchJob(d) {
    const j = d?.job;
    const key = j?.active ? [j.originCity, j.destinationCity, j.cargo].join('|') : null;
    if (key && lastJobKey !== null && key !== lastJobKey && extras.brief && local) briefing({ auto: true }).catch(() => {});
    lastJobKey = key || '';
  }

  // ------------------------------------------------------------ "Hey Jarvis" wake word
  let wake = null, wakeRestarts = [], wakeTimer = null;
  const WAKE = /\b(hey|hi|ok|okay|yo)[\s,]+jarvis\b/i;
  function wakeAllowed() { return extras.wake && SR && local && !document.hidden && !(session?.state().on); }
  function stopWake() { clearTimeout(wakeTimer); const w = wake; wake = null; if (w) { w.onresult = w.onerror = w.onend = null; try { w.abort(); } catch {} } if (!session?.state().on) { K.coDriver?.lendMic?.(false); setWakeBadge(false); } }
  function setWakeBadge(on) { if (!session?.state().on) { q('#jvMicBadge').textContent = on ? '👂 Listening for “Hey Jarvis”' : '🎤 Mic off'; q('#jvMicBadge').style.background = on ? '#8e44ad' : ''; q('#jvMicBadge').style.color = on ? '#fff' : ''; } }
  function startWake() {
    if (wake || !wakeAllowed()) return;
    // Back off if the browser keeps ending the recogniser (no tight restart loop).
    const now = Date.now(); wakeRestarts = wakeRestarts.filter(t => now - t < 15000); wakeRestarts.push(now);
    if (wakeRestarts.length > 6) { wakeTimer = setTimeout(startWake, 30000); q('#jvWakeNote').textContent = 'The browser keeps stopping the wake word; trying again in 30 seconds.'; return; }
    let w;
    try { w = new SR(); } catch { return; }
    wake = w; w.lang = navigator.language || 'en-US'; w.continuous = true; w.interimResults = true;
    K.coDriver?.lendMic?.(true); setWakeBadge(true);
    w.onresult = e => {
      for (let i = e.resultIndex || 0; i < e.results.length; i++) {
        if (WAKE.test(e.results[i][0].transcript)) { onDiag({ event: 'wake word heard', t: Date.now() }); stopWake(); if (K.currentPage() !== 'jarvis') K.go?.('jarvis'); setTimeout(() => startConversation().catch(() => {}), 300); return; }
      }
    };
    w.onerror = e => {
      onDiag({ event: 'wake error', t: Date.now(), error: e.error });
      if (['not-allowed', 'service-not-allowed', 'audio-capture'].includes(e.error)) { extras.wake = false; keepExtras(); q('#jvWake').checked = false; showError((V.ERRORS[e.error] || e.error) + ' “Hey Jarvis” has been switched off.'); }
    };
    w.onend = () => { if (wake !== w) return; wake = null; setWakeBadge(false); if (wakeAllowed()) wakeTimer = setTimeout(startWake, 800); };
    try { w.start(); onDiag({ event: 'wake listening', t: Date.now() }); } catch { wake = null; setWakeBadge(false); }
  }
  function syncWake() { if (wakeAllowed()) startWake(); else stopWake(); }

  function showError(msg) { const e = q('#jvError'); e.hidden = !msg; e.textContent = msg || ''; }

  // ------------------------------------------------------------ voice output
  const voices = () => (window.speechSynthesis?.getVoices?.() || []);
  const provider = v => /online|natural/i.test(v.name) && /microsoft/i.test(v.name) ? 'Microsoft online voice' : /^google/i.test(v.name) ? 'Google online voice' : v.localService ? 'installed on this PC' : 'online voice';
  const accent = lang => { const [l, r] = String(lang || '').split(/[-_]/); const names = { GB: 'UK', US: 'US', AU: 'Australia', IE: 'Ireland', IN: 'India', CA: 'Canada', NZ: 'New Zealand', ZA: 'South Africa' }; return l?.toLowerCase() === 'en' ? `English (${names[(r || '').toUpperCase()] || r || 'other'})` : lang; };
  const BRIT_MALE = /\b(ryan|thomas|alfie|elliot|ethan|noah|oliver|george)\b|uk english male/i, US_MALE = /\b(guy|christopher|eric|davis|andrew|brian|roger|steffan|tony|jason)\b/i, FEMALE = /\b(sonia|libby|maisie|hollie|abbi|bella|aria|jenny|ava|emma|michelle|ana|zira|hazel|susan|female)\b/i;
  const tag = v => /^en[-_]GB/i.test(v.lang) && BRIT_MALE.test(v.name) ? ' — suggested: British male' : /^en[-_]US/i.test(v.lang) && US_MALE.test(v.name) ? ' — suggested: American male' : /^en/i.test(v.lang) && FEMALE.test(v.name) ? ' — female' : '';
  function voiceOpts() {
    // Natural voice from KAW's relay; if it fails, the line falls back to the Co-Driver browser voice.
    if (voicePref.natural && natural.voices.some(v => v.id === voicePref.natural)) return { natural: voicePref.natural, voiceURI: '', rate: +voicePref.rate || 1, pitch: 1 };
    if (!voicePref.voiceURI) return null;                                  // same as the Co-Driver voice
    const ok = voices().some(v => v.voiceURI === voicePref.voiceURI);
    return { voiceURI: ok ? voicePref.voiceURI : '', rate: +voicePref.rate || 1, pitch: +voicePref.pitch || 1 };
  }
  async function loadNatural() {
    try { const r = await api('/api/jarvis/voices'); natural = { enabled: Boolean(r.enabled), voices: r.voices || [], note: r.note || '' }; } catch { natural = { enabled: false, voices: [], note: '' }; }
    renderVoices();
  }
  function renderVoices() {
    const list = voices().filter(v => /^en/i.test(v.lang)).sort((a, b) => (tag(b) ? 1 : 0) - (tag(a) ? 1 : 0) || a.lang.localeCompare(b.lang) || a.name.localeCompare(b.name));
    const others = voices().filter(v => !/^en/i.test(v.lang));
    const opt = v => `<option value="${esc(v.voiceURI)}">${esc(v.name.replace(/^Microsoft |^Google /, ''))} · ${esc(accent(v.lang))} · ${esc(provider(v))}${esc(tag(v))}</option>`;
    const natEn = natural.voices.filter(v => v.english).sort((a, b) => (a.gender === 'male' ? 0 : 1) - (b.gender === 'male' ? 0 : 1) || a.name.localeCompare(b.name) || a.lang.localeCompare(b.lang));
    const natOther = natural.voices.filter(v => !v.english);
    const nopt = v => `<option value="nat:${esc(v.id)}">${esc(v.name)} · ${esc(v.accent)} · ${esc(v.gender)} · ${esc(v.provider || 'natural voice')}</option>`;
    q('#jvVoiceSel').innerHTML = '<option value="">Same as my Co-Driver voice</option>'
      + (natEn.length ? `<optgroup label="Natural voices — English">${natEn.map(nopt).join('')}</optgroup>` : '')
      + `<optgroup label="Browser voices — English">${list.map(opt).join('')}</optgroup>`
      + (others.length || natOther.length ? `<optgroup label="Other languages">${natOther.map(nopt).join('')}${others.map(opt).join('')}</optgroup>` : '');
    const has = voices().some(v => v.voiceURI === voicePref.voiceURI);
    const natHas = natural.voices.some(v => v.id === voicePref.natural);
    q('#jvVoiceSel').value = natHas ? `nat:${voicePref.natural}` : has ? voicePref.voiceURI : '';
    q('#jvRate').value = voicePref.rate || 1; q('#jvPitch').value = voicePref.pitch || 1;
    q('#jvVoiceNote').textContent = voicePref.natural && !natHas
      ? `Your natural voice isn't offered right now${natural.note ? ` (${natural.note})` : ''}, so Jarvis uses ${has ? 'your chosen browser voice' : 'your Co-Driver voice'}.`
      : natHas ? `Natural voice: ${natural.voices.find(v => v.id === voicePref.natural)?.provider || 'voice service'}. Only reply text is sent for speech. If unavailable or limits run out, your browser voice is used. Not an imitation of any actor or film character.`
      : voicePref.voiceURI && !has && voices().length
      ? `Your chosen voice “${voicePref.name || 'unknown'}” isn't available in ${browser} right now, so Jarvis uses your Co-Driver voice instead. Pick another voice or open the Companion in the browser where you chose it.`
      : !voices().length ? 'No voices reported yet — they usually appear a moment after the page loads.' : `${list.length} English voice${list.length === 1 ? '' : 's'} available.`;
  }
  function saveVoice() {
    const val = q('#jvVoiceSel').value;
    const nat = val.startsWith('nat:') ? natural.voices.find(x => x.id === val.slice(4)) : null;
    const v = nat ? null : voices().find(x => x.voiceURI === val);
    voicePref = { voiceURI: v?.voiceURI || '', name: nat ? nat.name : v?.name || '', natural: nat?.id || '', rate: +q('#jvRate').value || 1, pitch: +q('#jvPitch').value || 1 };
    try { localStorage.setItem(VOICE, JSON.stringify(voicePref)); } catch {}
    renderVoices();
  }
  function speakAndWait(text) {
    if (K.coDriver?.speakAndWait) return K.coDriver.speakAndWait(text, voiceOpts());
    return new Promise(resolve => { if (!window.speechSynthesis) return resolve(); const u = new SpeechSynthesisUtterance(text); u.onend = u.onerror = () => resolve(); speechSynthesis.speak(u); });
  }
  function stopSpeaking() { if (K.coDriver?.stopSpeaking) K.coDriver.stopSpeaking(); else try { speechSynthesis.cancel(); } catch {} }

  // ------------------------------------------------------------ voice conversation
  let audioCtx = null;
  function chime() {
    try {
      audioCtx ||= new (window.AudioContext || window.webkitAudioContext)();
      const o = audioCtx.createOscillator(), g = audioCtx.createGain(), t = audioCtx.currentTime;
      o.frequency.setValueAtTime(660, t); o.frequency.linearRampToValueAtTime(880, t + 0.12);
      g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.1, t + 0.02); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.18);
      o.connect(g).connect(audioCtx.destination); o.start(t); o.stop(t + 0.2);
    } catch {}
  }
  const LABEL = { off: 'Off', listening: '🟢 Listening — go ahead', thinking: '💭 Thinking…', speaking: '🔊 Jarvis is speaking', error: '⚠️ Error' };
  let thinkingSince = 0, thinkTimer = null;
  function onState(st) {
    const was = phase; phase = st.phase;
    q('#jvPhase').textContent = st.phase === 'listening' && !st.mic ? '⏳ Waiting for other speech to finish' : (LABEL[st.phase] || st.phase);
    q('#jvTurns').textContent = st.on && st.turns ? `· ${st.turns} turn${st.turns === 1 ? '' : 's'}` : '';
    q('#jvMicBadge').textContent = st.mic ? '🎤 Mic ON' : '🎤 Mic off';
    q('#jvMicBadge').style.background = st.mic ? '#2ecc71' : ''; q('#jvMicBadge').style.color = st.mic ? '#08210f' : '';
    q('#jvStart').disabled = st.on; q('#jvStop').disabled = !st.on;
    q('#jvTalk').hidden = !(st.on && (st.phase === 'speaking' || st.phase === 'thinking'));
    q('#jvDone').hidden = !(st.on && st.phase === 'listening' && st.mic);
    q('#jvMic').disabled = st.on;
    q('#jvCaption').textContent = st.caption ? `“${st.caption}”` : st.phase === 'listening' ? (st.mic ? 'Speak now.' : st.message || '') : st.phase === 'off' ? (st.message || 'Press Start conversation to talk hands-free.') : '';
    showError(st.phase === 'error' ? st.message : '');
    q('#jvVoice').style.borderLeft = `5px solid ${{ listening: '#2ecc71', speaking: '#4aa3ff', thinking: '#f1c40f', error: '#e74c3c' }[st.phase] || 'transparent'}`;
    if (st.phase === 'listening' && was !== 'listening') chime();
    if ((st.phase === 'off' || st.phase === 'error') && was !== st.phase) setTimeout(syncWake, 600);
    clearInterval(thinkTimer);
    if (st.phase === 'thinking') {
      thinkingSince = Date.now();
      thinkTimer = setInterval(() => { const sec = Math.round((Date.now() - thinkingSince) / 1000); q('#jvPhase').textContent = `💭 Thinking… ${sec}s${sec > 8 ? ' (Jarvis may be looking something up)' : ''}${sec > 30 ? ' — still working on it' : ''}`; }, 1000);
    }
  }
  function onDiag(d) {
    diagLog.push(d); if (diagLog.length > 60) diagLog.shift();
    renderDiag();
  }
  function voiceSession() {
    session ||= V.createVoiceSession({
      SR, lang: navigator.language || 'en-US',
      send: t => send(t, { fromVoice: true }), speak: speakAndWait, stopSpeaking,
      isBusy: () => Boolean(K.coDriver?.busy?.()),
      onActive: on => K.coDriver?.lendMic?.(on),
      pauseMs: () => pauseSec * 1000,
      onState, onDiag
    });
    return session;
  }
  async function startConversation() {
    showError('');
    stopWake();
    if (!SR) return voiceSession().start();
    if (!online) { const s = await status(); if (!s.online) return showError(s.message || 'Jarvis is not available right now.'); }
    voiceSession().start();
  }

  // One-shot mic (single message), kept for quick questions.
  function wireMic() {
    if (!SR) return;
    q('#jvMic').hidden = false;
    q('#jvMic').onclick = () => {
      if (session?.state().on) return;
      const rec = new SR(); rec.lang = navigator.language || 'en-US'; rec.interimResults = false; rec.maxAlternatives = 1;
      K.coDriver?.lendMic?.(true);
      q('#jvMic').textContent = '⏺';
      rec.onstart = () => onDiag({ event: 'start', t: Date.now(), oneShot: true });
      rec.onaudiostart = () => onDiag({ event: 'audiostart', t: Date.now(), oneShot: true });
      rec.onresult = e => { const t = e.results?.[0]?.[0]?.transcript; if (t) send(t); };
      rec.onend = () => { q('#jvMic').textContent = '🎙'; K.coDriver?.lendMic?.(false); onDiag({ event: 'end', t: Date.now(), oneShot: true }); };
      rec.onerror = e => {
        onDiag({ event: 'error', t: Date.now(), error: e.error, oneShot: true });
        if (e.error === 'aborted') return;
        showError({ ...V.ERRORS, 'no-speech': 'No speech was heard. Click the microphone and speak after it starts.' }[e.error] || `Speech recognition stopped (${e.error || 'unknown error'}).`);
      };
      try { rec.start(); } catch { showError('Speech recognition could not start. Close other tabs using the microphone, then try again.'); q('#jvMic').textContent = '🎙'; K.coDriver?.lendMic?.(false); }
    };
  }

  // ------------------------------------------------------------ diagnostics (no transcripts, no audio kept)
  let env = {};
  async function gatherEnv() {
    env = { browser, ui: UI_BUILD, page: location.origin, secureContext: window.isSecureContext, speechRecognition: Boolean(SR), speechSynthesis: Boolean(window.speechSynthesis), voices: voices().length };
    try { env.micPermission = (await navigator.permissions.query({ name: 'microphone' })).state; } catch { env.micPermission = 'unknown'; }
    try { env.audioInputs = (await navigator.mediaDevices.enumerateDevices()).filter(d => d.kind === 'audioinput').length; } catch { env.audioInputs = 'unknown'; }
    try { const h = await api('/api/health'); env.companion = h.version; } catch {}
    const m = K.coDriver?.micState?.(); if (m) env.coDriverWakeWord = m.wakeWord ? (m.lent ? 'on (paused for Jarvis)' : 'on') : 'off';
    env.relay = lastStatus.relay || ''; env.jarvisOnline = Boolean(lastStatus.online);
    renderDiag();
  }
  function renderDiag() {
    const out = q('#jvDiagOut'); if (!out) return;
    const t0 = diagLog[0]?.t || Date.now();
    out.textContent = `${Object.entries(env).map(([k, v]) => `${k}: ${v}`).join('\n')}\n\n${timingText()}\n\nRecent recognition events:\n` +
      (diagLog.length ? diagLog.map(d => `+${((d.t - t0) / 1000).toFixed(1)}s ${d.event}${d.error ? ` (${d.error})` : ''}${d.ms != null ? ` after ${d.ms} ms` : ''}${d.oneShot ? ' [mic button]' : ''}`).join('\n') : '(none yet — press Start conversation)');
  }
  async function micTest() {
    let stream;
    try { stream = await navigator.mediaDevices.getUserMedia({ audio: true }); }
    catch (e) { q('#jvLevel').textContent = `Microphone not available: ${e.name === 'NotAllowedError' ? 'permission blocked for this page or by Windows' : e.name === 'NotFoundError' ? 'no microphone found' : e.message}`; return gatherEnv(); }
    try {
      audioCtx ||= new (window.AudioContext || window.webkitAudioContext)();
      const src = audioCtx.createMediaStreamSource(stream), an = audioCtx.createAnalyser(); an.fftSize = 512; src.connect(an);
      const buf = new Uint8Array(an.fftSize); let peak = 0; const end = Date.now() + 3000;
      q('#jvLevel').textContent = 'Say something…';
      while (Date.now() < end) { an.getByteTimeDomainData(buf); for (const x of buf) peak = Math.max(peak, Math.abs(x - 128)); q('#jvLevel').textContent = `Level ${'▮'.repeat(Math.min(20, Math.round(peak / 6)))}`; await new Promise(r => setTimeout(r, 100)); }
      q('#jvLevel').textContent = peak > 12 ? 'Microphone works — sound was received. If Jarvis still stops, the browser speech service is the likely cause (see events above).' : 'Almost no sound received — check the input device in Windows Sound settings.';
    } finally { stream.getTracks().forEach(t => t.stop()); gatherEnv(); }
  }

  // ------------------------------------------------------------ page
  K.pages.push({ name: 'jarvis', icon: '☎', label: 'Jarvis (KAW\'s office)', group: 'Drive', index: 2, html,
    init() {
      q('#jvSpeak').checked = speakOn;
      q('#jvSpeak').onchange = () => { speakOn = q('#jvSpeak').checked; try { localStorage.setItem(SPEAK, speakOn ? '1' : '0'); } catch {} };
      q('#jvSend').onclick = guard(() => send(q('#jvText').value));
      q('#jvText').onkeydown = e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); q('#jvSend').click(); } };
      q('#jvClear').onclick = () => { if (chat.length && !confirm('Start a new conversation? This clears the chat on this device.')) return; chat = []; keep(); render(); };
      q('#jvStart').onclick = guard(startConversation);
      q('#jvStop').onclick = () => session?.stop();
      q('#jvTalk').onclick = () => session?.talk();
      q('#jvDone').onclick = () => session?.done();
      const showPause = () => { q('#jvPause').value = pauseSec; q('#jvPauseVal').textContent = `${pauseSec} s`; };
      q('#jvPause').oninput = () => { pauseSec = Math.min(8, Math.max(1, Number(q('#jvPause').value) || 3)); showPause(); try { localStorage.setItem(PAUSE, String(pauseSec)); } catch {} };
      showPause();
      document.addEventListener('keydown', e => { if (e.key === 'Escape' && session?.state().on) session.stop(); });
      window.addEventListener('pagehide', () => session?.stop());
      if (!SR) { q('#jvStart').disabled = true; q('#jvCaption').textContent = `Voice conversation needs speech recognition, which ${browser} doesn't have. Microsoft Edge is the verified browser. You can still type.`; }
      // Voice picker
      renderVoices(); loadNatural();
      if (window.speechSynthesis) speechSynthesis.addEventListener?.('voiceschanged', renderVoices);
      q('#jvVoiceSel').onchange = saveVoice; q('#jvRate').onchange = saveVoice; q('#jvPitch').onchange = saveVoice;
      q('#jvSample').onclick = () => { stopSpeaking(); speakAndWait("Good afternoon, driver. Jarvis here in KAW's office. Shall we check the route to Reno?"); };
      // Jarvis-only server setting
      q('#jvRelaySave').onclick = guard(async () => { await api('/api/jarvis/settings', { method: 'POST', body: { url: q('#jvRelay').value.trim() } }); K.notify('Jarvis server saved', 'Only Jarvis uses this address.', 'join'); await status(); });
      q('#jvRelayReset').onclick = guard(async () => { q('#jvRelay').value = ''; await api('/api/jarvis/settings', { method: 'POST', body: { url: '' } }); await status(); });
      q('#jvRelaySave').disabled = q('#jvRelayReset').disabled = !local;
      // Diagnostics
      q('#jvDiag').ontoggle = () => q('#jvDiag').open && gatherEnv();
      q('#jvMicTest').onclick = guard(micTest);
      q('#jvDiagCopy').onclick = guard(async () => { await gatherEnv(); await navigator.clipboard.writeText(q('#jvDiagOut').textContent); K.notify('Diagnostics copied', 'Paste them to KAW or in your report.', 'join'); });
      // Extras
      q('#jvWake').checked = extras.wake; q('#jvBrief').checked = extras.brief; q('#jvCopilot').checked = extras.copilot;
      q('#jvWake').disabled = !SR || !local; if (!SR) q('#jvWakeNote').textContent = `${browser} has no speech recognition, so “Hey Jarvis” isn't available here.`;
      q('#jvWake').onchange = () => { extras.wake = q('#jvWake').checked; keepExtras(); syncWake(); };
      q('#jvBrief').onchange = () => { extras.brief = q('#jvBrief').checked; keepExtras(); };
      q('#jvBriefNow').onclick = guard(() => briefing());
      const applyCopilot = () => K.coDriver?.setVoiceOverride?.(extras.copilot ? voiceOpts() : null);
      q('#jvCopilot').onchange = () => { extras.copilot = q('#jvCopilot').checked; keepExtras(); applyCopilot(); if (extras.copilot && !voicePref.voiceURI) K.notify('Pick a voice for Jarvis', 'Open “Jarvis\'s voice” and choose one; until then alerts use the Co-Driver voice.', 'leave'); };
      applyCopilot(); q('#jvVoiceSel').addEventListener('change', applyCopilot);
      document.addEventListener('visibilitychange', syncWake);
      q('#jvMemAdd').onclick = guard(async () => { const r = await fetch('/api/jarvis/memory', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ text: q('#jvMemText').value }) }).then(x => x.json()); if (!r.ok) throw new Error(r.error); q('#jvMemText').value = ''; renderMemory(r.items); });
      q('#jvMemClear').onclick = guard(async () => { if (!confirm('Forget everything Jarvis remembers?')) return; await api('/api/jarvis/memory/clear', { method: 'POST', body: {} }); renderMemory([]); });
      q('#jvMemAdd').disabled = q('#jvMemClear').disabled = q('#jvBriefNow').disabled = !local;
      renderMemory(); setTimeout(syncWake, 1500);
      wireMic(); onState({ phase: 'off', mic: false, on: false, turns: 0, caption: '', message: '' });
    },
    load: () => { render(); return status(); } });
  // Leaving the Jarvis page ends the conversation (mic and playback off).
  K.onTick.push((d, page) => { if (page !== 'jarvis' && session?.state().on) session.stop(); watchJob(d); });
})();
