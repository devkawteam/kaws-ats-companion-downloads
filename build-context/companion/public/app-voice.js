/* KAW'S ATS Companion v1.6 — Voice Co-Driver, smart shift HUD and fuel/rest planner.
   Speech runs in the browser (Web Speech API): works in Chrome/Edge on the PC and on phones/tablets
   opened over https or localhost. Settings are per device (localStorage). */
(() => {
  'use strict';
  const K = window.KAW16;
  if (!K) return;
  const { q, qa, esc, fin, f1, int, cash, api, guard, notify, go, telem } = K;

  // ---------------------------------------------------------------- settings
  const KEY = 'kawCoDriver';
  const DEFAULTS = {
    speak: true, voiceURI: '', rate: 1.05, pitch: 1, volume: 1, personality: 'standard',
    speechEngine: 'browser', piperVoice: '', inputEngine: 'browser',
    overspeedMph: 5, overspeedDelaySeconds: 3, overspeedRepeatSeconds: 45,
    listen: false, wakeWord: false, pttKey: 'KeyV', pttGamepad: -1,
    callouts: { speedLimit: true, overspeed: true, milestones: true, rest: true, fuel: true, damage: true, shifts: false, convoy: true, alerts: true, jobs: true, planner: true, fun: true }
  };
  let cfg = DEFAULTS;
  try { cfg = { ...DEFAULTS, ...JSON.parse(localStorage.getItem(KEY) || '{}') }; cfg.callouts = { ...DEFAULTS.callouts, ...(cfg.callouts || {}) }; } catch {}
  const save = () => { try { localStorage.setItem(KEY, JSON.stringify(cfg)); } catch {} };
  let quiet = false;

  // ---------------------------------------------------------------- personalities
  const pick = a => a[Math.floor(Math.random() * a.length)];
  const nickel = n => (n === 55 ? 'double nickel' : n === 65 ? 'six five' : n === 70 ? 'seven zero' : n === 75 ? 'seven five' : `${n}`);
  const P = {
    standard: {
      name: 'Standard', hello: 'Co-driver ready.',
      speedLimit: n => `Speed limit ${n}.`,
      overspeed: (s, n) => `You're doing ${s} in a ${n}.`,
      miles: m => (m <= 1 ? 'About a mile to go. Get ready to park.' : `${m} miles to go.`),
      halfway: () => 'Halfway there.',
      rest: t => `You'll need to rest in ${t}.`,
      fuel: p => `Fuel is at ${p} percent.`,
      damage: (part, pct) => `Damage: ${part} is now at ${pct} percent.`,
      cargo: pct => `Careful — cargo damage is at ${pct} percent.`,
      up: (g, n) => (n > 1 ? `Skip shift, up to ${g}.` : `Upshift to ${g}.`),
      down: (g, n) => (n > 1 ? `Down ${n}, to gear ${g}.` : `Downshift to ${g}.`),
      joined: n => `${n} joined the convoy.`, left: n => `${n} left the convoy.`,
      jobStart: (c, d, mi) => `New job: ${c} to ${d}. ${mi} miles.`,
      delivered: (money, grade) => `Delivered! You earned ${money}.${grade ? ` Eco grade ${grade}.` : ''}`,
      ack: () => pick(['Copy that.', 'Done.', 'Got it.']),
      unknown: () => "Sorry, I didn't catch that. Say 'help' to hear what I can do."
    },
    trucker: {
      name: 'CB Trucker', hello: "Breaker breaker, your co-driver's on the radio. Ten-four, let's roll.",
      speedLimit: n => pick([`Heads up driver, ${nickel(n)} zone.`, `Speed limit's ${nickel(n)}, keep it between the ditches.`]),
      overspeed: (s, n) => pick([`You're running hot, ${s} in a ${nickel(n)}. Back it down before a bear sees you.`, `Easy on the hammer, good buddy — ${s} in a ${nickel(n)}.`]),
      miles: m => (m <= 1 ? "Mile out, driver. Line her up for the dock." : pick([`${m} miles to the barn.`, `${m} miles and you're home free.`])),
      halfway: () => "Halfway there, driver. Keep the shiny side up.",
      rest: t => `Coffee won't cut it much longer — sleep in ${t}.`,
      fuel: p => pick([`Go-juice down to ${p} percent. Time to find a fuel island.`, `Tanks at ${p} percent, driver.`]),
      damage: (part, pct) => `Ouch! ${part} took a hit — now ${pct} percent.`,
      cargo: pct => `Easy with the load, cargo's at ${pct} percent damage.`,
      up: (g, n) => (n > 1 ? `Skip it up to ${g}.` : `Grab ${g}.`),
      down: (g, n) => (n > 1 ? `Drop ${n}, into ${g}.` : `Knock it down to ${g}.`),
      joined: n => `${n} just came up on channel. Welcome to the convoy.`, left: n => `${n} went ten-seven, off the air.`,
      jobStart: (c, d, mi) => `Got a load of ${c} bound for ${d}. ${mi} miles, driver. Hammer down.`,
      delivered: (money, grade) => `That's a wrap, good buddy! ${money} in the bank.${grade ? ` Eco grade ${grade}.` : ''} Ten-four.`,
      ack: () => pick(['Ten-four.', 'Copy that, driver.', 'Roger that.']),
      unknown: () => 'Say again, driver? You came in broken. Say help for the menu.'
    },
    calm: {
      name: 'Calm', hello: 'Hello. I am here to help you drive.',
      speedLimit: n => `The limit here is ${n}.`,
      overspeed: (s, n) => `Gently now — the limit is ${n}.`,
      miles: m => (m <= 1 ? 'Nearly there.' : `${m} miles remaining.`),
      halfway: () => "You're halfway. Nice and steady.",
      rest: t => `Plan to rest in about ${t}.`,
      fuel: p => `Fuel is getting low, ${p} percent.`,
      damage: (part, pct) => `The ${part} is at ${pct} percent damage.`,
      cargo: pct => `Cargo damage is ${pct} percent.`,
      up: g => `You can shift up to ${g}.`, down: g => `Shift down to ${g}.`,
      joined: n => `${n} has joined.`, left: n => `${n} has left.`,
      jobStart: (c, d, mi) => `Your job: ${c} to ${d}, ${mi} miles.`,
      delivered: money => `Delivered. Well done. ${money} earned.`,
      ack: () => 'Okay.', unknown: () => "I'm not sure what you meant. Try saying help."
    },
    coach: {
      name: 'Drill Coach', hello: "Coach on the line. Eyes up, hands on the wheel!",
      speedLimit: n => `${n}! That's the number, driver!`,
      overspeed: (s, n) => `${s} in a ${n}?! Off the throttle, now!`,
      miles: m => (m <= 1 ? "Final mile! Don't blow it now!" : `${m} miles! Keep pushing!`),
      halfway: () => 'Halfway! No slacking!',
      rest: t => `${t} until you drop. Plan that stop!`,
      fuel: p => `${p} percent fuel! Who's running this rig?!`,
      damage: (part, pct) => `${part} at ${pct} percent! Watch the road!`,
      cargo: pct => `Cargo at ${pct} percent! Smooth hands!`,
      up: g => `Up! ${g}! Move it!`, down: g => `Down to ${g}! Now!`,
      joined: n => `${n} reporting in!`, left: n => `${n} dropped out!`,
      jobStart: (c, d, mi) => `${c} to ${d}! ${mi} miles! Go go go!`,
      delivered: (money, grade) => `Delivered! ${money}! ${grade ? `Grade ${grade}. ` : ''}Not bad, rookie!`,
      ack: () => 'Done! Next!', unknown: () => 'Speak up, driver! Say help!'
    }
  };
  const sayKeys = new Map();
  const say = (key, ...a) => { const p = P[cfg.personality] || P.standard; const f = p[key] || P.standard[key]; const text = typeof f === 'function' ? f(...a) : f; if (text) { sayKeys.set(String(text), key); if (sayKeys.size > 200) sayKeys.delete(sayKeys.keys().next().value); } return text; };

  // ---------------------------------------------------------------- speech output
  const synth = window.speechSynthesis;
  let promptSource = 'both';
  let stopLocalAudio = null;
  let greeted = false;
  let welcomeFinished = typeof addEventListener !== 'function';
  const queue = [];
  let speaking = false, lastSpoken = '';
  // Optional: speak every Co-Driver line in Jarvis's chosen voice ({ voiceURI, rate, pitch } or null).
  let voiceOverride = null;
  function voice() {
    const vs = synth?.getVoices?.() || [];
    return vs.find(v => v.voiceURI === cfg.voiceURI) || vs.find(v => /en[-_]US/i.test(v.lang) && /natural|online|neural/i.test(v.name)) || vs.find(v => /^en/i.test(v.lang)) || null;
  }
  // onDone (optional) runs once the line has been spoken, skipped or dropped, so callers such as
  // Jarvis's voice session can wait for silence before listening again.
  // voiceOpts (optional): { voiceURI, rate, pitch } — speak this line with a specific browser voice (Jarvis).
  function speak(text, { priority = 1, force = false, onDone = null, onStart = null, log = true, voiceOpts = null, welcome = false } = {}) {
    const done = () => { try { onDone?.(); } catch {} };
    if (!text) return done();
    if (log) logLine('co-driver', text);
    if (promptSource === 'game') return done();
    if ((!synth && (cfg.speechEngine !== 'piper' || voiceOpts)) || (!cfg.speak && !force) || (quiet && !force && priority < 3)) return done();
    queue.push({ text, priority, at: Date.now(), key: sayKeys.get(String(text)) || null, onDone, onStart, voiceOpts, welcome });
    queue.sort((a, b) => Number(b.welcome) - Number(a.welcome) || b.priority - a.priority);
    while (queue.length > 4) { const dropped = queue.pop(); try { dropped.onDone?.(); } catch {} }
    pump();
  }
  const finished = item => { try { item.onDone?.(); } catch {} };
  function pump() {
    if (speaking || !queue.length) return;
    if (!welcomeFinished && !queue[0].welcome) return;
    const item = queue.shift();
    if (promptSource === 'game') { finished(item); queue.splice(0).forEach(finished); return; }
    if (Date.now() - item.at > 15000 && item.priority < 3) { finished(item); return pump(); }  // stale
    // Voice pack: the driver's own (or an imported) recording for this callout plays first.
    if (item.key && voicePack.active && voicePack.clips.has(item.key) && !item.clipDone) {
      speaking = true; lastSpoken = item.text;
      playClip(item.key).catch(() => {}).finally(() => {
        speaking = false;
        if (voicePack.speakDetails && !/^(hello|halfway|ack|unknown|jobStart)$/.test(item.key)) queue.unshift({ ...item, clipDone: true, at: Date.now() });
        else finished(item);
        setTimeout(pump, 150);
      });
      return;
    }
    // Jarvis's natural voice (from KAW's relay). Fails over to the browser voice for this line;
    // a Stop while it loads or plays just ends it (no fallback, nothing re-queued).
    if (item.voiceOpts?.natural) {
      speaking = true; lastSpoken = item.text;
      speakNatural(item.text, item.voiceOpts, item.onStart).then(() => { speaking = false; finished(item); setTimeout(pump, 150); }, e => {
        speaking = false;
        if (e?.cancelled) { finished(item); setTimeout(pump, 150); return; }
        naturalTrouble(e.message);
        queue.unshift({ ...item, voiceOpts: { ...item.voiceOpts, natural: '' }, at: Date.now() });
        setTimeout(pump, 50);
      });
      return;
    }
    if (cfg.speechEngine === 'piper' && !item.voiceOpts && !voiceOverride) {
      speaking = true; lastSpoken = item.text;
      speakPiper(item.text).catch(e => logLine('co-driver', `Offline voice: ${e.message}`)).finally(() => { speaking = false; finished(item); setTimeout(pump, 150); });
      return;
    }
    const u = new SpeechSynthesisUtterance(item.text);
    const o = item.voiceOpts || voiceOverride;
    const v = (o?.voiceURI && synth.getVoices().find(x => x.voiceURI === o.voiceURI)) || voice(); if (v) { u.voice = v; u.lang = v.lang; }
    u.rate = o?.rate || cfg.rate; u.pitch = o?.pitch || cfg.pitch; u.volume = cfg.volume;
    speaking = true; lastSpoken = item.text;
    let ended = false;
    u.onend = u.onerror = () => { if (ended) return; ended = true; speaking = false; finished(item); setTimeout(pump, 150); };
    synth.speak(u);
  }
  let naturalNote = 0;
  function naturalTrouble(msg) { if (Date.now() - naturalNote > 60000) { naturalNote = Date.now(); K.notify?.('Using the browser voice', String(msg || 'The natural voice is unavailable.').slice(0, 160), 'leave'); } }
  // ---- natural voice: fetch, one-ahead prefetch, timings ----
  // While one segment plays, the next is generated (only ONE ahead, so a shared engine isn't hogged).
  // Stop aborts the prefetch too, so nothing is generated or played after Stop.
  const prefetched = new Map();
  const naturalKey = (text, o) => `${o.natural}|${o.rate || 1}|${text}`;
  async function naturalAudio(text, o, signal) {
    const timeout = setTimeout(() => { signal.__timedOut = true; signal.__ctl?.abort(); }, 30000);
    try {
      let r;
      try { r = await fetch('/api/jarvis/speak', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ text, voice: o.natural, rate: o.rate || 1 }), signal }); }
      catch (e) { if (signal.aborted && !signal.__timedOut) throw Object.assign(new Error('stopped'), { cancelled: true }); throw new Error('The natural voice did not answer in time.'); }
      if (!r.ok || !/^audio\//.test(r.headers.get('content-type') || '')) { let m = 'The natural voice is unavailable.'; try { m = (await r.json()).error || m; } catch {} throw new Error(m); }
      return await r.blob();
    } finally { clearTimeout(timeout); }
  }
  function prefetchNatural(text, o) {
    for (const [k, e] of prefetched) if (performance.now() - e.at > 60000) { try { e.ctl.abort(); } catch {} prefetched.delete(k); }
    const key = naturalKey(text, o);
    if (prefetched.has(key) || prefetched.size >= 1 || promptSource === 'game') return;
    const ctl = new AbortController(); ctl.signal.__ctl = ctl;
    const entry = { ctl, at: performance.now() };
    entry.promise = naturalAudio(text, o, ctl.signal).then(b => { entry.readyAt = performance.now(); return b; });
    entry.promise.catch(() => {});
    prefetched.set(key, entry);
  }
  function dropPrefetch() { for (const e of prefetched.values()) { try { e.ctl.abort(); } catch {} } prefetched.clear(); }
  const speechLog = []; let lastNaturalEnd = 0;
  function logSpeech(x) { speechLog.push({ at: Date.now(), ...x }); if (speechLog.length > 30) speechLog.shift(); }
  async function speakNatural(text, o, onStart = null) {
    const ctl = new AbortController(); ctl.signal.__ctl = ctl; let cancelled = false;
    const stopped = () => Object.assign(new Error('stopped'), { cancelled: true });
    const t0 = performance.now();
    const key = naturalKey(text, o), pre = prefetched.get(key);
    if (pre) prefetched.delete(key);
    stopLocalAudio = () => { cancelled = true; ctl.abort(); pre?.ctl.abort(); };
    try {
      let blob;
      try { blob = await (pre ? pre.promise : naturalAudio(text, o, ctl.signal)); }
      catch (e) { if (cancelled || e?.cancelled) throw stopped(); throw e; }
      const waitMs = Math.round(performance.now() - t0);
      if (cancelled || promptSource === 'game') throw stopped();
      const src = URL.createObjectURL(blob);
      try {
        await new Promise((resolve, reject) => {
          const audio = new Audio(src); audio.volume = cfg.volume;
          const timer = setTimeout(() => { audio.pause(); resolve(); }, Math.min(120000, 15000 + text.length * 120));
          let started = false;
          audio.onplaying = () => {
            if (started) return; started = true;
            const now = performance.now();
            logSpeech({ chars: text.length, waitMs, prefetched: Boolean(pre), generateMs: pre?.readyAt ? Math.round(pre.readyAt - pre.at) : waitMs, gapMs: lastNaturalEnd && now - lastNaturalEnd < 60000 ? Math.round(now - lastNaturalEnd) : null, audioSec: Number.isFinite(audio.duration) ? Math.round(audio.duration * 10) / 10 : null });
            try { onStart?.(); } catch {}
          };
          const finish = fn => { clearTimeout(timer); fn(); };
          stopLocalAudio = () => { cancelled = true; audio.pause(); finish(resolve); };
          audio.onended = () => { lastNaturalEnd = performance.now(); finish(resolve); };   // playback really finished
          audio.onerror = () => finish(() => reject(new Error('The natural voice audio could not play.')));
          audio.play().catch(() => finish(() => reject(new Error('The browser blocked audio playback. Click anywhere on the page once, then try again.'))));
        });
      } finally { URL.revokeObjectURL(src); }
      if (cancelled) throw stopped();
    } finally { stopLocalAudio = null; }
  }
  async function speakPiper(text) {
    if (!cfg.piperVoice) throw new Error('Choose a downloaded Piper voice.');
    const r = await fetch('/api/ai/speak', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ text: text.slice(0, 1800), voice: cfg.piperVoice }), signal: AbortSignal.timeout(65000) });
    if (!r.ok) throw new Error((await r.json()).error || 'Speech bridge unavailable.');
    if (promptSource === 'game') return;
    const src = URL.createObjectURL(await r.blob());
    try {
      await new Promise((resolve, reject) => {
        const audio = new Audio(src); audio.volume = cfg.volume; audio.playbackRate = cfg.rate;
        const timer = setTimeout(() => { audio.pause(); reject(new Error('Audio playback timed out.')); }, 90000);
        const finish = fn => { clearTimeout(timer); fn(); };
        stopLocalAudio = () => { audio.pause(); finish(resolve); };
        audio.onended = () => finish(resolve); audio.onerror = () => finish(() => reject(new Error('Cannot play voice audio.')));
        audio.play().catch(() => finish(() => reject(new Error('Click Test voice to allow audio playback.'))));
      });
    } finally { stopLocalAudio = null; URL.revokeObjectURL(src); }
  }
  // ---------------------------------------------------------------- voice packs
  const voicePack = { active: '', speakDetails: true, clips: new Set(), packs: [], keys: [] };
  function playClip(key, pack = voicePack.active) {
    return new Promise((resolve, reject) => {
      const audio = new Audio('/api/ai/voicepack/clip?pack=' + encodeURIComponent(pack) + '&key=' + encodeURIComponent(key) + '&t=' + Date.now());
      audio.volume = cfg.volume;
      const timer = setTimeout(() => { audio.pause(); resolve(); }, 12000);
      stopLocalAudio = () => { audio.pause(); clearTimeout(timer); resolve(); };
      audio.onended = () => { clearTimeout(timer); stopLocalAudio = null; resolve(); };
      audio.onerror = () => { clearTimeout(timer); stopLocalAudio = null; reject(new Error('Cannot play clip.')); };
      audio.play().catch(e => { clearTimeout(timer); stopLocalAudio = null; reject(e); });
    });
  }
  async function loadVoicePacks() {
    try {
      const v = await api('/api/ai/voicepack');
      Object.assign(voicePack, { active: v.active || '', speakDetails: v.speakDetails !== false, packs: v.packs || [], keys: v.keys || [] });
      voicePack.clips = new Set(Object.keys((v.packs || []).find(p => p.id === v.active)?.clips || {}));
      return v;
    } catch { return null; }
  }
  // Voice pack panel: record your own callouts or import a pack of audio files.
  const VP_LABELS = { hello: 'Greeting', speedLimit: 'Speed limit change', overspeed: 'Speeding warning', miles: 'Miles to go', halfway: 'Halfway', rest: 'Rest reminder', fuel: 'Low fuel', damage: 'Damage', cargo: 'Cargo damage', up: 'Shift up', down: 'Shift down', joined: 'Driver joined convoy', left: 'Driver left convoy', jobStart: 'Job started', ack: 'Got it', unknown: "Didn't understand" };
  const VP_SAMPLE = { speedLimit: [65], overspeed: [72, 65], miles: [100], rest: [30], fuel: [15], damage: ['engine', 12], cargo: [4], up: [9, 1], down: [7, 1], joined: ['Dusty'], left: ['Dusty'], jobStart: ['Lumber', 'Las Vegas', 562] };
  let vpRecorder = null;
  function vpExample(key) { try { const f = P.standard[key]; const t = typeof f === 'function' ? f(...(VP_SAMPLE[key] || [])) : f; return String(t || ''); } catch { return ''; } }
  function renderVoicePack(v) {
    if (!v || !q('#vpList')) return;
    // Older Companions or errors may return no callout list; show an empty panel instead of failing.
    const keys = Array.isArray(v.keys) ? v.keys : [];
    const packSel = q('#vpPack');
    packSel.innerHTML = '<option value="">Off (normal voice)</option>' + (v.packs || []).map(p => '<option value="' + esc(p.id) + '"' + (p.id === v.active ? ' selected' : '') + '>' + esc(p.name) + ' (' + (p.count || 0) + '/' + keys.length + ')</option>').join('') + ((v.packs || []).some(p => p.id === 'my-voice') ? '' : '<option value="my-voice">My voice (record below)</option>');
    q('#vpDetails').checked = v.speakDetails !== false;
    const mine = (v.packs || []).find(p => p.id === (q('#vpEdit').value || 'my-voice'));
    q('#vpEdit').innerHTML = (v.packs || []).filter(p => p.id).map(p => '<option value="' + esc(p.id) + '">' + esc(p.name) + '</option>').join('') || '<option value="my-voice">My voice</option>';
    if ((v.packs || []).every(p => p.id !== 'my-voice')) q('#vpEdit').insertAdjacentHTML('afterbegin', '<option value="my-voice">My voice</option>');
    if (mine) q('#vpEdit').value = mine.id;
    const editing = (v.packs || []).find(p => p.id === q('#vpEdit').value) || { clips: {} };
    q('#vpList').innerHTML = keys.map(k => {
      const has = Boolean(editing.clips?.[k]);
      return '<div class="v16-item" data-vpkey="' + k + '"><div class="grow"><div class="t">' + esc(VP_LABELS[k] || k) + (has ? ' <span class="v16-pill good">recorded</span>' : '') + '</div><div class="d">' + esc(vpExample(k)) + '</div></div>' +
        '<button class="cmd small" type="button" data-vprec="' + k + '">● Record</button>' +
        (has ? '<button class="cmd small" type="button" data-vpplay="' + k + '">▶</button><button class="cmd small danger" type="button" data-vpdel="' + k + '">✕</button>' : '') + '</div>';
    }).join('');
  }
  async function refreshVoicePack() { renderVoicePack(await loadVoicePacks()); }
  // Voice packs live on the Companion PC; load the active one at start so clips play everywhere.
  if (typeof location !== 'undefined' && ['127.0.0.1', 'localhost', '[::1]'].includes(location.hostname)) setTimeout(() => { loadVoicePacks(); }, 1500);
  const toBase64 = blob => new Promise((ok, bad) => { const r = new FileReader(); r.onload = () => ok(String(r.result).split(',')[1] || ''); r.onerror = bad; r.readAsDataURL(blob); });
  async function vpRecord(key, button) {
    if (vpRecorder) { vpRecorder.stop(); return; }
    if (!navigator.mediaDevices?.getUserMedia || !window.MediaRecorder) throw new Error('This browser cannot record audio. Open the Companion in Chrome or Edge on the PC.');
    const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } });
    const chunks = [];
    const rec = new MediaRecorder(stream);
    vpRecorder = rec;
    button.textContent = '■ Stop'; button.classList.add('primary');
    const limit = setTimeout(() => { if (rec.state === 'recording') rec.stop(); }, 8000);
    rec.ondataavailable = e => { if (e.data.size) chunks.push(e.data); };
    rec.onstop = async () => {
      clearTimeout(limit); stream.getTracks().forEach(t => t.stop()); vpRecorder = null;
      button.textContent = '● Record'; button.classList.remove('primary');
      try {
        const blob = new Blob(chunks, { type: rec.mimeType || 'audio/webm' });
        if (blob.size < 800) throw new Error('Nothing was recorded. Check your microphone.');
        const v = await api('/api/ai/voicepack/clip', { method: 'POST', body: { pack: q('#vpEdit').value || 'my-voice', key, audio: await toBase64(blob) } });
        renderVoicePack(v); notify('Clip saved', VP_LABELS[key] || key, 'join');
      } catch (e) { notify('Recording not saved', e.message, 'critical'); }
    };
    rec.start();
  }
  async function vpImport(files) {
    const name = (q('#vpImportName').value || '').trim();
    if (!name) throw new Error('Give the pack a name first.');
    const list = [...files].filter(f => /\.(wav|ogg|mp3|webm)$/i.test(f.name)).slice(0, 60);
    if (!list.length) throw new Error('Choose WAV, OGG, MP3 or WebM files named after the callouts (fuel.wav, halfway.mp3, ...).');
    const payload = [];
    for (const f of list) payload.push({ name: f.name, audio: await toBase64(f) });
    const v = await api('/api/ai/voicepack/import', { method: 'POST', body: { name, author: (q('#vpImportAuthor').value || '').trim(), files: payload } });
    renderVoicePack(v);
    notify('Voice pack imported', v.result.imported.length + ' clips' + (v.result.skipped.length ? ', skipped: ' + v.result.skipped.slice(0, 3).join(', ') : ''), 'join');
  }
  function wireVoicePack() {
    if (!q('#vpList') || q('#vpList').dataset.wired) return;
    q('#vpList').dataset.wired = '1';
    const saveSettings = guard(async () => { renderVoicePack(await api('/api/ai/voicepack/settings', { method: 'POST', body: { active: q('#vpPack').value, speakDetails: q('#vpDetails').checked } })); await loadVoicePacks(); });
    q('#vpPack').onchange = saveSettings; q('#vpDetails').onchange = saveSettings;
    q('#vpEdit').onchange = guard(refreshVoicePack);
    q('#vpList').addEventListener('click', e => {
      const b = e.target.closest('button'); if (!b) return;
      const pack = q('#vpEdit').value || 'my-voice';
      if (b.dataset.vprec) guard(() => vpRecord(b.dataset.vprec, b))();
      if (b.dataset.vpplay) playClip(b.dataset.vpplay, pack).catch(err => notify('Cannot play clip', err.message, 'critical'));
      if (b.dataset.vpdel) guard(async () => { renderVoicePack(await api('/api/ai/voicepack/delete', { method: 'POST', body: { pack, key: b.dataset.vpdel } })); await loadVoicePacks(); })();
    });
    q('#vpImportFiles').onchange = e => guard(() => vpImport(e.target.files))().finally(() => { e.target.value = ''; });
    q('#vpDeletePack').onclick = guard(async () => { const pack = q('#vpEdit').value; if (!pack || !confirm('Delete the whole voice pack "' + pack + '"?')) return; renderVoicePack(await api('/api/ai/voicepack/delete', { method: 'POST', body: { pack } })); await loadVoicePacks(); });
    refreshVoicePack();
  }
  function cancelSpeech() { if (greeted) welcomeFinished = true; queue.splice(0).forEach(finished); synth?.cancel(); stopLocalAudio?.(); speaking = false; }
  K.coDriverSpeech = text => speak(text, { priority: 3, force: true });
  const cooldown = new Map();
  const once = (key, ms) => { const t = cooldown.get(key) || 0; if (Date.now() - t < ms) return false; cooldown.set(key, Date.now()); return true; };

  // ---------------------------------------------------------------- transcript log
  const log = [];
  function logLine(who, text) {
    log.unshift({ who, text, at: new Date() });
    log.length = Math.min(log.length, 30);
    const el = q('#cdLog');
    if (el) el.innerHTML = log.map(l => `<div class="cd-line ${l.who}"><b>${l.who === 'you' ? 'You' : 'Co-driver'}</b> ${esc(l.text)} <span class="muted">${l.at.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}</span></div>`).join('');
  }

  // ---------------------------------------------------------------- helpers for answers
  const gt = min => { if (!fin(min)) return 'unknown'; const m = Math.max(0, Math.round(min)); const h = Math.floor(m / 60); return h ? `${h} hour${h > 1 ? 's' : ''}${m % 60 ? ` ${m % 60} minutes` : ''}` : `${m} minutes`; };
  const moneySay = v => `$${Math.round(Number(v) || 0).toLocaleString('en-US')}`;
  const JOKES = [
    "Why did the trucker bring a ladder? Because the load said it was high cargo.",
    "What do you call a truck that tells jokes? A pun-tractor.",
    "My GPS said turn left in 500 feet. I said, buddy, I need 500 yards and a prayer.",
    "Trucking is easy. It's just backing up, parking, weather, traffic, deadlines, and everything else that's hard.",
    "What's a trucker's favorite month? Mile-y.",
    "I asked dispatch for a light load. They sent me feathers. Forty tons of them."
  ];
  const FACTS = [
    "A fully loaded semi can weigh up to 80,000 pounds on US highways.",
    "Truck drivers in the US move about 72 percent of all freight by weight.",
    "The double nickel — 55 miles per hour — was the national speed limit from 1974 to 1995.",
    "Air brakes were invented by George Westinghouse in 1869 for trains.",
    "An 18-speed transmission lets you split gears so the engine can stay in its sweet spot."
  ];

  // ---------------------------------------------------------------- intents
  const cmd = type => api('/api/convoy/command', { method: 'POST', body: { type, message: 'Voice command', issuedBy: 'Co-driver' } }).then(() => say('ack')).catch(e => `Couldn't send that: ${e.message}`);
  const INTENTS = [
    [/\b(help|what can you do|commands)\b/, () => "Ask me: how far, what's the ETA, when do I rest, how much fuel, what gear, what's the speed limit, who's online, where is a driver, how far behind is the leader, damage report, trip summary, how much have I earned, am I on time. Say regroup, fuel stop, rest stop, hold position, depart or emergency stop to command the convoy. Say economy, balanced or power mode, quiet, talk to me, repeat, tell me a joke, or a trucking fact."],
    [/\b(repeat|say (that|it) again|what did you say)\b/, () => lastSpoken || 'Nothing to repeat yet.'],
    [/\b(be quiet|quiet|mute|shut up|silence)\b/, () => { quiet = true; return 'Going quiet. I will only speak for critical alerts. Say talk to me to bring me back.'; }],
    [/\b(talk to me|unmute|wake up|speak up)\b/, () => { quiet = false; return 'I\'m back.'; }],
    [/\b(emergency stop|emergency)\b/, () => cmd('EMERGENCY STOP')],
    [/\bregroup\b/, () => cmd('REGROUP')],
    [/\b(fuel stop|refuel stop)\b/, () => cmd('FUEL STOP')],
    [/\b(rest stop|sleep stop|break stop)\b/, () => cmd('REST STOP')],
    [/\b(hold position|hold up|wait up)\b/, () => cmd('HOLD POSITION')],
    [/\b(resume( convoy)?|let'?s roll|roll out)\b/, () => cmd('RESUME CONVOY')],
    [/\b(depart|move out|convoy go)\b/, () => cmd('DEPART')],
    [/\b(economy|eco|balanced|power|auto(matic)?) mode\b/, (d, t) => { const m = (t.match(/\b(economy|eco|balanced|power|auto)/) || [])[1]; const mode = m === 'eco' ? 'economy' : m; return api('/api/shift/mode', { method: 'POST', body: { mode } }).then(() => `${mode === 'auto' ? 'Automatic' : mode[0].toUpperCase() + mode.slice(1)} shift mode.`); }],
    [/\b(what gear|which gear|shift|gear should)\b/, d => { const s = d.shift; if (!s?.available) return 'I don\'t have gearbox data from this truck yet.'; if (s.action === 'HOLD') return `Hold gear ${s.gear}. You're at ${s.rpm} rpm, right in the ${s.bandLabel.toLowerCase()} band.`; return `${s.advice}. You're at ${s.rpm} rpm in gear ${s.gear}.`; }],
    [/\b(how fast|my speed|what speed)\b/, d => `You're doing ${Math.round(d.truck?.speedMph || 0)} miles per hour.`],
    [/\b(speed limit|limit)\b/, d => (d.navigation?.speedLimitMph > 5 ? `The speed limit is ${Math.round(d.navigation.speedLimitMph / 5) * 5}.` : 'No speed limit reported right now.')],
    [/\b(eta|how long|arrive|arrival|when (will|do) (i|we) get)\b/, d => (d.job?.active && fin(d.navigation?.etaSeconds) ? `About ${gt(d.navigation.etaSeconds / 60)} of driving, ${int(d.navigation.distanceMiles)} miles.` : 'No route is set.')],
    [/\b(how far|distance|miles (left|to go))\b/, (d, t) => {
      const who = matchDriver(t);
      if (who) return whereIs(who);
      return d.job?.active && fin(d.navigation?.distanceMiles) ? `${f1(d.navigation.distanceMiles)} miles to ${d.job.destinationCity || 'the destination'}.` : 'No route is set.';
    }],
    [/\b(rest|sleep|tired|fatigue)\b/, d => (fin(d.navigation?.restStopMinutes) && d.navigation.restStopMinutes > 0 ? `You need to rest in ${gt(d.navigation.restStopMinutes)}. ${d.planner?.items?.find(i => i.key === 'rest')?.text || ''}` : 'Your rest timer looks fine.')],
    [/\b(fuel|gas|diesel|range)\b/, d => { const t = d.truck || {}; const p = t.fuelCapacityGallons ? Math.round(t.fuelGallons / t.fuelCapacityGallons * 100) : null; return `${p !== null ? `Fuel at ${p} percent` : 'Fuel level unknown'}${fin(t.fuelRangeMiles) ? `, about ${int(t.fuelRangeMiles)} miles of range` : ''}. ${d.planner?.items?.find(i => i.key === 'fuel')?.text || ''}`; }],
    [/\b(on time|deadline|late)\b/, d => d.planner?.items?.find(i => i.key === 'deadline')?.text || 'No delivery deadline right now.'],
    [/\b(plan|can i make it)\b/, d => d.planner?.summary || 'No active route.'],
    [/\b(damage|condition|health)\b/, d => { const g = d.damage || {}; const parts = [['engine', g.enginePercent], ['transmission', g.transmissionPercent], ['cabin', g.cabinPercent], ['chassis', g.chassisPercent], ['wheels', g.wheelsPercent], ['cargo', g.cargoPercent]].filter(([, v]) => fin(v) && v >= 1).sort((a, b) => b[1] - a[1]); return parts.length ? `Damage: ${parts.map(([k, v]) => `${k} ${Math.round(v)} percent`).join(', ')}.` : 'The truck is in great shape.'; }],
    [/\b(status|report|how('?s| is) (it|the truck) (going|doing))\b/, d => `${Math.round(d.truck?.speedMph || 0)} miles an hour, ${d.job?.active ? `${int(d.navigation?.distanceMiles)} miles to ${d.job.destinationCity}` : 'no active job'}, fuel ${d.truck?.fuelCapacityGallons ? Math.round(d.truck.fuelGallons / d.truck.fuelCapacityGallons * 100) : '?'} percent. ${(d.alerts?.active || []).length ? `${d.alerts.active.length} alert${d.alerts.active.length > 1 ? 's' : ''}: ${d.alerts.active.slice(0, 2).map(a => a.title).join(', ')}.` : 'No alerts.'}`],
    [/\b(alerts?|warnings?)\b/, d => ((d.alerts?.active || []).length ? d.alerts.active.slice(0, 4).map(a => `${a.title}. ${a.detail}`).join('. ') : 'No alerts. All clear.')],
    [/\b(trip|this job|cargo|what am i (hauling|carrying))\b/, d => (d.job?.active ? `Hauling ${d.job.cargo} from ${d.job.originCity} to ${d.job.destinationCity}. ${d.trip ? `${f1(d.trip.milesDriven)} miles so far, eco score ${d.trip.eco?.score ?? 'pending'}.` : ''}` : 'No active job.')],
    [/\b(earn(ed|ings)?|money|income|paid)\b/, () => api('/api/analytics?days=7').then(a => `This week you've earned ${moneySay(a.income)} over ${a.delivered} deliveries and ${int(a.miles)} miles.`)],
    [/\b(eco|efficien)/, d => (d.trip?.eco ? `Eco score ${d.trip.eco.score}, grade ${d.trip.eco.grade}. ${d.trip.eco.tips?.[0] || 'Keep it up.'}` : 'No eco score yet on this trip.')],
    [/\b(who('?s| is) (online|on|here|driving)|convoy status|roster)\b/, d => { const r = (d.convoy?.roster || []).filter(x => x.online && !x.isLocal); return r.length ? `${r.length} driver${r.length > 1 ? 's' : ''} online: ${r.map(x => x.driverName).join(', ')}.` : "You're the only one online right now."; }],
    [/\b(leader|gap|behind|ahead|close up)\b/, () => api('/api/gap').then(g => (!g.leader ? 'No convoy leader is set.' : g.leader.isLocal ? (g.gaps.length ? `You're leading. ${g.gaps.map(x => `${x.driverName} is ${x.miles} miles back`).join(', ')}.` : "You're leading, no followers in range.") : `${g.leader.driverName} is leading. You're ${g.gaps[0]?.miles ?? '?'} miles from them.`))],
    [/\b(where is|where's|find)\b/, (d, t) => { const who = matchDriver(t); return who ? whereIs(who) : 'Which driver?'; }],
    [/\b(next convoy|convoy (tonight|today)|events?)\b/, () => api('/api/events').then(e => { const n = e.events.find(x => x.status === 'planned'); return n ? `${n.name}, hosted by ${n.host}, ${n.minutesUntil !== null ? `in ${gt(n.minutesUntil)}` : 'time to be announced'}, from ${n.meetPoint || 'a meet point to be announced'}. ${n.going} going.` : 'No convoys planned.'; })],
    [/\b(time|what time)\b/, () => `It's ${new Date().toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}.`],
    [/\b(joke|funny|make me laugh)\b/, () => pick(JOKES)],
    [/\b(fact|did you know|trivia)\b/, () => pick(FACTS)],
    [/\b(thank|thanks|good job)\b/, () => pick(["You're welcome, driver.", 'Anytime.', 'Ten-four, happy trucking.'])]
  ];
  function matchDriver(text) {
    const r = (telem()?.convoy?.roster || []).filter(x => !x.isLocal);
    return r.find(x => text.includes(String(x.driverName || '').toLowerCase())) || null;
  }
  function whereIs(p) {
    const me = (telem()?.convoy?.roster || []).find(x => x.isLocal) || {};
    const a = me.positioning, b = p.positioning;
    const d = a && b && fin(a.x) && fin(b.x) ? Math.hypot(b.x - a.x, b.z - a.z) / 1609.344 : null;
    const loc = p.location?.near ? ` near ${p.location.near}${p.location.nearState ? ', ' + p.location.nearState : ''}` : '';
    return `${p.driverName} is ${p.online ? 'online' : 'offline'}${loc}${d !== null ? `, ${f1(d)} miles from you` : ''}${fin(p.truck?.speedMph) ? `, doing ${Math.round(p.truck.speedMph)}` : ''}.`;
  }
  let aiEnabled = false, aiBusy = false;
  async function aiAnswer(question) {
    if (aiBusy) { logLine('co-driver', 'Already answering. Please wait.'); return; }
    aiBusy = true;
    const badge = q('#cdAiStatus'); if (badge) badge.textContent = 'Thinking locally…';
    try { const out = await api('/api/ai/chat', { method: 'POST', body: { question, personality: cfg.personality } }); speak(out.answer, { priority: 3, force: true }); }
    catch (e) { logLine('co-driver', `Local AI: ${e.message}`); }
    finally { aiBusy = false; if (badge) badge.textContent = aiEnabled ? 'Local AI enabled' : 'Local AI off'; }
  }
  async function answer(raw, directAi = false) {
    const text = String(raw || '').toLowerCase().replace(/^(hey |ok |okay )?(co-?driver|kaw|copilot|co pilot)[, ]*/, '').trim();
    if (!text) return;
    logLine('you', raw);
    if (directAi || /^ask (ai|ollama)\b/i.test(text)) return aiAnswer(text.replace(/^ask (ai|ollama)[, ]*/i, ''));
    const d = telem() || {};
    for (const [re, fn] of INTENTS) {
      if (re.test(text)) {
        try { const out = await fn(d, text); speak(out, { priority: 3, force: true }); } catch (e) { speak(`Something went wrong: ${e.message}`, { priority: 3, force: true }); }
        return;
      }
    }
    if (aiEnabled) return aiAnswer(raw);
    speak(say('unknown'), { priority: 3, force: true });
  }

  // ---------------------------------------------------------------- speech input
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  let rec = null, listening = false, wakeLoop = false;
  // Jarvis's voice conversation borrows the microphone: browsers allow one recognition session per page,
  // so the Co-Driver's wake word and push-to-talk step aside until Jarvis gives it back.
  let micLent = false;
  function lendMic(on) {
    micLent = Boolean(on);
    if (micLent) { wakeLoop = false; try { rec?.abort(); } catch {} listening = false; setMic(false); }
    else if (cfg.listen && cfg.wakeWord) setTimeout(startWake, 600);
  }
  let offlineRecorder = null, offlineStarting = false, offlineBusy = false;
  async function startOfflinePtt() {
    if (offlineRecorder?.state === 'recording') { offlineRecorder.stop(); return; }
    if (offlineStarting || offlineBusy) return;
    if (!navigator.mediaDevices?.getUserMedia || !window.MediaRecorder) { logLine('co-driver', 'Offline microphone recording needs a supported browser on localhost.'); return; }
    offlineStarting = true;
    let stream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mimeType = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4'].find(t => MediaRecorder.isTypeSupported(t));
      offlineRecorder = new MediaRecorder(stream, { ...(mimeType ? { mimeType } : {}), audioBitsPerSecond: 24000 });
      const recorder = offlineRecorder, chunks = [];
      let timer;
      const cleanup = () => { clearTimeout(timer); stream.getTracks().forEach(t => t.stop()); setMic(false); listening = false; offlineRecorder = null; };
      recorder.ondataavailable = e => { if (e.data.size) chunks.push(e.data); };
      recorder.onerror = () => { cleanup(); logLine('co-driver', 'Microphone recording failed.'); };
      recorder.onstop = async () => {
        cleanup(); offlineBusy = true;
        try {
          const blob = new Blob(chunks, { type: recorder.mimeType });
          if (blob.size > 180000) throw new Error('Recording too large. Try a shorter question.');
          const audio = await new Promise((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(String(reader.result).split(',')[1]); reader.onerror = reject; reader.readAsDataURL(blob); });
          logLine('co-driver', 'Transcribing on this PC…');
          const out = await api('/api/ai/transcribe', { method: 'POST', body: { audio } });
          if (out.text?.trim()) await answer(out.text); else logLine('co-driver', 'No speech detected. Try again.');
        } catch (e) { logLine('co-driver', `Offline microphone: ${e.message}`); }
        finally { offlineBusy = false; }
      };
      recorder.start(); listening = true; setMic(true);
      logLine('co-driver', 'Recording locally. Click Push to talk again to send.');
      timer = setTimeout(() => { if (recorder.state === 'recording') recorder.stop(); }, 15000);
    } catch (e) { stream?.getTracks().forEach(t => t.stop()); logLine('co-driver', `Microphone: ${e.message}`); }
    finally { offlineStarting = false; }
  }
  function makeRec(continuous) {
    const r = new SR();
    r.lang = 'en-US'; r.interimResults = false; r.maxAlternatives = 1; r.continuous = continuous;
    return r;
  }
  function startPtt() {
    if (cfg.inputEngine === 'offline') { startOfflinePtt(); return; }
    if (!SR) { notify('Voice commands unavailable', 'This browser has no speech recognition — use Chrome or Edge.', 'leave'); return; }
    if (micLent) { notify('Microphone in use', 'Jarvis is using the microphone. Stop the Jarvis conversation to use Co-Driver voice commands.', 'leave'); return; }
    if (listening) return;
    try {
      if (wakeLoop) { try { rec?.abort(); } catch {} }
      rec = makeRec(false);
      rec.onresult = e => answer(e.results[0][0].transcript);
      rec.onend = () => { listening = false; setMic(false); if (cfg.wakeWord && cfg.listen) setTimeout(startWake, 400); };
      rec.onerror = e => { listening = false; setMic(false); if (e.error === 'not-allowed') notify('Microphone blocked', 'Allow the microphone for this page (it must be https or localhost).', 'leave'); };
      listening = true; setMic(true);
      synth?.cancel(); speaking = false;
      rec.start();
    } catch { listening = false; setMic(false); }
  }
  function startWake() {
    if (micLent || cfg.inputEngine === 'offline' || !SR || !cfg.listen || !cfg.wakeWord || listening) return;
    try {
      wakeLoop = true;
      rec = makeRec(true);
      rec.onresult = e => {
        const t = e.results[e.results.length - 1][0].transcript.toLowerCase();
        if (/\b(co-?driver|copilot|hey kaw)\b/.test(t)) {
          const rest = t.split(/co-?driver|copilot|hey kaw/).pop().trim();
          if (rest.length > 2) answer(rest); else { speak(pick(['Go ahead.', 'Listening.', 'Yes, driver?']), { priority: 3, force: true }); setTimeout(startPtt, 900); }
        }
      };
      rec.onend = () => { if (cfg.listen && cfg.wakeWord && !listening) setTimeout(startWake, 500); };
      rec.onerror = () => {};
      rec.start();
    } catch {}
  }
  function setMic(on) { qa('.cd-mic').forEach(b => b.classList.toggle('on', on)); }

  // Push-to-talk: keyboard key and gamepad / wheel button.
  window.addEventListener('keydown', e => {
    if (!cfg.listen || e.repeat || document.activeElement?.matches?.('input,textarea,select')) return;
    if (e.code === cfg.pttKey) startPtt();
  });
  let padWas = false;
  setInterval(() => {
    if (!cfg.listen || cfg.pttGamepad < 0) return;
    const pads = navigator.getGamepads?.() || [];
    const pressed = [...pads].some(p => p?.buttons?.[cfg.pttGamepad]?.pressed);
    if (pressed && !padWas) startPtt();
    padWas = pressed;
  }, 100);

  // ---------------------------------------------------------------- proactive callouts
  // `undefined`/`null` = not observed yet, so nothing is announced just because the page opened.
  const prev = { limit: null, limitSince: 0, spokenLimit: null, milesMark: null, halfway: false, restMark: null, fuelMark: null, damage: {}, cargo: null, roster: null, job: undefined, shiftKey: null, shiftSince: 0, alerts: null, overspeedZone: null };
  const spokenSpeed = window.KAWSpeedWarning.createState();
  const MILE_MARKS = [100, 50, 25, 10, 5, 1];
  const REST_MARKS = [120, 60, 30, 15];
  const FUEL_MARKS = [25, 15, 10, 5];
  const PARTS = [['enginePercent', 'engine'], ['transmissionPercent', 'transmission'], ['cabinPercent', 'cabin'], ['chassisPercent', 'chassis'], ['wheelsPercent', 'tires']];
  function callouts(d) {
    if (!d?.connected || d.sdk?.paused) { spokenSpeed.since = null; spokenSpeed.last = null; spokenSpeed.limit = null; return; }
    const c = cfg.callouts, t = d.truck || {}, n = d.navigation || {}, job = d.job || {};
    const now = Date.now();
    // Speed limit changes (must be stable for 2 s)
    const lim = n.speedLimitMph > 5 ? Math.round(n.speedLimitMph / 5) * 5 : null;
    if (lim !== prev.limit) { prev.limit = lim; prev.limitSince = now; }
    if (c.speedLimit && lim && lim !== prev.spokenLimit && now - prev.limitSince > 2000 && t.speedMph > 10) { prev.spokenLimit = lim; speak(say('speedLimit', lim)); }
    // Spoken threshold is separate from visual alert/trip scoring thresholds.
    if (window.KAWSpeedWarning.update(spokenSpeed, t.speedMph, n.speedLimitMph, { enabled: c.overspeed && promptSource !== 'game', mph: cfg.overspeedMph, delaySeconds: cfg.overspeedDelaySeconds, repeatSeconds: cfg.overspeedRepeatSeconds }, now)) speak(say('overspeed', Math.round(t.speedMph), Math.round(n.speedLimitMph)), { priority: 2 });
    // Distance milestones + halfway
    if (job.active && fin(n.distanceMiles)) {
      const m = MILE_MARKS.find(x => n.distanceMiles <= x);
      if (c.milestones && m && prev.milesMark !== null && m < prev.milesMark) speak(say('miles', m));
      prev.milesMark = m ?? Infinity;
      if (c.milestones && n.progressPercent >= 50 && !prev.halfway && n.progressPercent < 55) { prev.halfway = true; speak(say('halfway')); }
    }
    // Rest timer
    if (fin(n.restStopMinutes) && n.restStopMinutes > 0) {
      const r = REST_MARKS.find(x => n.restStopMinutes <= x);
      if (c.rest && r && prev.restMark !== null && r < prev.restMark) speak(say('rest', gt(n.restStopMinutes)), { priority: 2 });
      prev.restMark = r ?? Infinity;
    }
    // Fuel
    const fp = t.fuelCapacityGallons ? (t.fuelGallons / t.fuelCapacityGallons) * 100 : null;
    if (fp !== null) {
      const f = FUEL_MARKS.find(x => fp <= x);
      if (c.fuel && f && prev.fuelMark !== null && f < prev.fuelMark) speak(say('fuel', Math.round(fp)), { priority: 2 });
      prev.fuelMark = f ?? Infinity;
    }
    // Damage jumps
    for (const [k, label] of PARTS) {
      const v = Number(d.damage?.[k]);
      if (!fin(v)) continue;
      if (c.damage && prev.damage[k] !== undefined && v - prev.damage[k] >= 2 && once(`dmg-${k}`, 20000)) speak(say('damage', label, Math.round(v)), { priority: 2 });
      prev.damage[k] = v;
    }
    const cg = Number(d.damage?.cargoPercent);
    if (fin(cg)) { if (c.damage && prev.cargo !== null && cg - prev.cargo >= 1 && once('cargo', 20000)) speak(say('cargo', f1(cg)), { priority: 2 }); prev.cargo = cg; }
    // Shift callouts (advice held 1.5 s, 6 s cooldown)
    const s = d.shift;
    if (s?.available && !s.automatic) {
      const key = ['UPSHIFT', 'DOWNSHIFT'].includes(s.action) ? `${s.action}-${s.bestGear}` : null;
      if (key !== prev.shiftKey) { prev.shiftKey = key; prev.shiftSince = now; }
      if (c.shifts && key && now - prev.shiftSince > 1500 && once('shift', 6000)) { speak(s.action === 'UPSHIFT' ? say('up', s.bestGear, s.steps) : say('down', s.bestGear, s.steps), { priority: 1 }); prev.shiftSince = now + 60000; }
    }
    // Convoy joins / leaves
    const online = new Set((d.convoy?.roster || []).filter(r => r.online && !r.isLocal).map(r => r.driverName));
    if (prev.roster && c.convoy) {
      for (const nme of online) if (!prev.roster.has(nme)) speak(say('joined', nme));
      // A driver who was moving gets the more detailed "dropped out of the convoy" alert instead.
      for (const nme of prev.roster) if (!online.has(nme) && !prev.moving?.has(nme)) speak(say('left', nme));
    }
    prev.moving = new Set((d.convoy?.roster || []).filter(r => r.online && !r.isLocal && Number(r.truck?.speedMph) > 5).map(r => r.driverName));
    prev.roster = online;
    // Jobs
    const jobKey = job.active ? `${job.cargo}|${job.destinationCity}` : null;
    if (c.jobs && jobKey && prev.job !== undefined && jobKey !== prev.job) speak(say('jobStart', job.cargo, job.destinationCity, int(job.plannedDistanceMiles)));
    prev.job = jobKey;
    // New critical alerts (convoy gap, events, truck warnings) that the callouts above don't cover
    const skip = new Set(['fuel', 'fatigue', 'overspeed', 'damage', 'cargo']);
    const ids = new Set();
    for (const a of d.alerts?.active || []) {
      ids.add(a.id);
      if (c.alerts && prev.alerts && !prev.alerts.has(a.id) && !skip.has(a.id) && (a.severity === 'critical' || a.id.startsWith('event-') || a.id.startsWith('together-') || a.id === 'gap')) speak(`${a.title}. ${a.detail}`, { priority: a.severity === 'critical' ? 3 : 2 });
    }
    prev.alerts = ids;
  }
  // Delivery celebration hook (called by the fun module)
  // Speak a longer reply and resolve when it has finished (or was stopped). Sentences are queued
  // separately because Chrome cuts long utterances off. Completion comes from the speech engine's own
  // end event; Chrome sometimes never fires it, so after the expected duration we watch the engine's
  // real state and finish only once it is truly silent (never on a guess alone).
  function speakAndWait(text, voiceOpts = null) {
    // Keep visual decorations in chat, but do not send them to either speech engine.
    const spoken = String(text || '')
      .replace(/[0-9#*]\uFE0F?\u20E3/gu, '')
      .replace(/[\p{Extended_Pictographic}\p{Emoji_Presentation}\p{Regional_Indicator}\u200D\uFE0F\u20E3\u{E0020}-\u{E007F}]/gu, '')
      .replace(/(^|\s)[:;=][-^]?[)(DPp](?=\s|$)/g, '$1')
      .replace(/\s+/g, ' ');
    const parts = spoken.match(/[^.!?…]+[.!?…]*["')\]]*\s*/g) || [];
    const chunks = [];
    // A natural (relay) voice speaks the whole reply in one request; browser voices go sentence by sentence.
    if (voiceOpts?.natural && !voiceOpts.natural.includes('-Kokoro-')) { const all = parts.join('').trim(); if (all) chunks.push(all); }
    else for (const p of parts) { const last = chunks.at(-1); if (last && (last + p).length <= 220) chunks[chunks.length - 1] = last + p; else chunks.push(p); }
    const epoch = stopEpoch;
    if (voiceOpts?.natural?.includes('-Kokoro-')) {
      const bounded = [];
      for (const chunk of chunks) {
        let line = '';
        for (const word of chunk.trim().split(/\s+/)) {
          if ((line + ' ' + word).length > 220 && line) { bounded.push(line); line = ''; }
          if (word.length > 220) { if (line) bounded.push(line); line = ''; for (let i = 0; i < word.length; i += 220) bounded.push(word.slice(i, i + 220)); }
          else line += (line ? ' ' : '') + word;
        }
        if (line) bounded.push(line);
      }
      // A short first segment gets speech started sooner (generation time grows with length).
      if (bounded[0] && bounded[0].length > 120) {
        const head = bounded[0];
        let cut = -1;
        for (const m of head.matchAll(/[.!?;:,](?=\s)/g)) if (m.index >= 30 && m.index < 120) cut = m.index + 1;
        if (cut < 0) cut = head.lastIndexOf(' ', 120);
        if (cut > 20) bounded.splice(0, 1, head.slice(0, cut).trim(), head.slice(cut).trim());
      }
      // Ramp: each segment at most ~1.5x the previous one. Generation runs at roughly 0.6x real time, so the
      // next segment is ready before the current one finishes playing (no gap), even with some game load.
      const ramped = [];
      for (let piece of bounded.filter(Boolean)) {
        while (ramped.length && piece.length > 60 && piece.length > Math.round(ramped.at(-1).length * 1.5)) {
          const max = Math.max(60, Math.round(ramped.at(-1).length * 1.5));
          let cut = -1;
          for (const m of piece.matchAll(/[.!?;:,](?=\s)/g)) if (m.index >= max * 0.5 && m.index < max) cut = m.index + 1;
          if (cut < 0) cut = piece.lastIndexOf(' ', max);
          if (cut <= 20) break;
          ramped.push(piece.slice(0, cut).trim()); piece = piece.slice(cut).trim();
        }
        if (piece) ramped.push(piece);
      }
      chunks.splice(0, chunks.length, ...ramped);
    }
    const kokoro = Boolean(voiceOpts?.natural?.includes('-Kokoro-'));
    return chunks.reduce((prev, chunk, i) => prev.then(() => new Promise(resolve => {
      if (epoch !== stopEpoch) return resolve();                       // Stop pressed: drop the rest of the reply
      let watch = null, settled = false;
      const finish = () => { if (settled) return; settled = true; clearTimeout(limit); clearInterval(watch); resolve(); };
      const limit = setTimeout(() => { watch = setInterval(() => { if (!synth?.speaking && !stopLocalAudio && !busy()) finish(); }, 250); }, 4000 + chunk.length * 90);
      const onStart = kokoro && chunks[i + 1] ? () => { if (epoch === stopEpoch) prefetchNatural(chunks[i + 1].trim(), voiceOpts); } : null;
      speak(chunk.trim(), { priority: 3, force: true, log: false, voiceOpts, onDone: finish, onStart });
    })), Promise.resolve());
  }
  let stopEpoch = 0;
  function stopSpeaking() {
    if (greeted) welcomeFinished = true;
    stopEpoch++;
    dropPrefetch();
    queue.splice(0).forEach(finished);
    try { synth?.cancel(); } catch {}
    try { stopLocalAudio?.(); } catch {}
    speaking = false; setTimeout(pump, 150);
  }
  // Real playback state (not just our flag): queued lines, the browser engine, or Piper/voice-pack audio.
  const busy = () => queue.length > 0 || Boolean(synth?.speaking) || Boolean(stopLocalAudio);
  const micState = () => ({ lent: micLent, wakeWord: Boolean(cfg.listen && cfg.wakeWord), listening });
  const setVoiceOverride = opts => { voiceOverride = opts && opts.voiceURI && !opts.natural ? { voiceURI: opts.voiceURI, rate: +opts.rate || 1, pitch: +opts.pitch || 1 } : null; };
  // Welcome greeting: once per page load, through the normal queue, so Speak on/off, quiet hours and
  // game-only audio ("ATS voice only") all apply. Browsers block speech before the first click or key,
  // so it waits for that instead of failing silently. Hold warnings until this welcome finishes.
  const WELCOME = "Welcome to KAW's ATS Playground Live Companion. Glad you're here. Please drive safely.";
  async function greetOnce() {
    if (greeted) return; greeted = true;
    try { const s = await api('/api/settings', { signal: AbortSignal.timeout(3000) }); promptSource = s.voice?.promptSource || promptSource; } catch {}
    speak(WELCOME, { priority: 2, welcome: true, onDone: () => { welcomeFinished = true; pump(); } });
  }
  if (typeof addEventListener !== 'function') { /* not a browser page (tests) */ }
  else if (typeof navigator !== 'undefined' && navigator.userActivation?.hasBeenActive) setTimeout(greetOnce, 800);
  else { const first = () => { removeEventListener('pointerdown', first, true); removeEventListener('keydown', first, true); setTimeout(greetOnce, 300); }; addEventListener('pointerdown', first, true); addEventListener('keydown', first, true); }
  K.coDriver = { speechTimings: () => speechLog.slice(), speak, speakAndWait, stopSpeaking, busy, lendMic, micState, setVoiceOverride, say, answer, cfg: () => cfg, callout: (k, ...a) => cfg.callouts[k] !== false && speak(say(k, ...a)), personality: () => cfg.personality };

  // ---------------------------------------------------------------- Drive page: shift HUD + planner + mic
  function renderDriveBar(d) {
    const s = d?.shift;
    const hud = q('#cdShiftHud');
    if (hud) {
      if (!s?.available) hud.innerHTML = `<div class="muted" style="font-size:13px">${esc(s?.reason || 'Waiting for gearbox data…')}</div>`;
      else {
        const cls = s.action === 'UPSHIFT' ? 'up' : s.action === 'DOWNSHIFT' ? 'down' : s.action === 'START' ? 'start' : 'hold';
        const arrow = cls === 'up' ? '▲' : cls === 'down' ? '▼' : cls === 'start' ? '●' : '■';
        const lo = 600, hi = Math.max(2200, s.rpmMax);
        const pos = v => Math.max(0, Math.min(100, ((v - lo) / (hi - lo)) * 100));
        hud.innerHTML = `<div class="cd-gear"><div class="cd-gear-now">${esc(s.displayedGear || s.gear || 'N')}</div><div class="cd-arrow ${cls}">${arrow}${s.bestGear && s.bestGear !== s.gear ? `<span>${s.bestGear}</span>` : ''}</div></div>
          <div class="cd-shift-info"><div class="cd-advice ${cls}">${esc(s.advice)}</div>
          <div class="cd-rpmbar"><span class="band" style="left:${pos(s.band.low)}%;width:${pos(s.band.high) - pos(s.band.low)}%"></span><span class="needle" style="left:${pos(s.rpm)}%"></span></div>
          <div class="muted" style="font-size:11.5px">${int(s.rpm)} rpm · ${esc(s.bandLabel)} band ${int(s.band.low)}–${int(s.band.high)}${s.hint ? ` · ${esc(s.hint)}` : ''}</div></div>`;
      }
    }
    const pl = q('#cdPlanner');
    if (pl) {
      const p = d?.planner;
      pl.innerHTML = !p?.active ? `<div class="muted" style="font-size:13px">${esc(p?.summary || 'No active job.')}</div>` : p.items.map(i => `<div class="cd-plan ${i.ok === false ? 'bad' : i.ok ? 'good' : 'tip'}"><b>${esc(i.title)}</b> ${esc(i.text)}</div>`).join('');
    }
  }

  // ---------------------------------------------------------------- Shift page: smart shift panel
  function renderShiftPage(d) {
    const s = d?.shift, box = q('#ssTable');
    if (!box) return;
    if (!s?.available) { box.innerHTML = `<div class="v16-empty">${esc(s?.reason || 'Waiting for data…')}</div>`; return; }
    q('#ssMode').value = s.requestedMode;
    q('#ssNow').innerHTML = `<b>${esc(s.advice)}</b> <span class="muted">· ${esc(s.situation)} · ${esc(s.bandLabel)} band ${s.band.low}–${s.band.high} rpm${s.automatic ? ' · automatic gearbox' : ''}</span>`;
    q('#ssScore').innerHTML = [['Shift quality', `${s.score.quality}/100`], ['In the band', `${s.score.inBandPct}%`], ['Good shifts', `${s.score.goodShifts}/${s.score.shifts}`], ['Lugging', `${s.score.luggingSec}s`], ['Over-rev', `${s.score.overRevSec}s`]].map(([k, v]) => `<div><div class="k">${k}</div><div class="v">${v}</div></div>`).join('');
    box.innerHTML = `<div class="ss-gears">${s.table.map(g => `<div class="ss-gear ${g.gear === s.gear ? 'cur' : ''} ${g.gear === s.bestGear ? 'best' : ''} ${g.inBand ? 'band' : ''} ${g.tooLow || g.tooHigh ? 'out' : ''}" title="ratio ${g.ratio}"><div class="g">${g.gear}</div><div class="r">${g.tooLow ? '—' : int(g.rpm)}</div></div>`).join('')}</div>
      <div class="v16-note" style="margin-top:8px">Engine RPM each gear would give at your current speed. <b>Green</b> = inside the band, <b>outlined</b> = recommended, <b>blue</b> = current gear. Calibrated from your real RPM (×${s.calibration}).</div>`;
  }

  // ---------------------------------------------------------------- Co-Driver page
  const CALLOUT_LABELS = { speedLimit: 'Speed limit changes', overspeed: 'Speeding warnings', milestones: 'Miles-to-go milestones', rest: 'Rest reminders', fuel: 'Low fuel', damage: 'Damage and cargo hits', shifts: 'Shift calls (up / down)', convoy: 'Drivers joining / leaving', alerts: 'Convoy gap, events and critical alerts', jobs: 'New jobs', planner: 'Fuel & rest plan when a job starts', fun: 'Celebrations, milestones and challenges' };
  const HTML = `
    <div class="v16-grid v16-2">
      <div class="v16-stack">
        <div class="panel"><div class="panel-head"><div class="panel-title">Talk to your co-driver</div><button class="cmd small cd-mic" id="cdMic" type="button">🎙 Push to talk</button></div>
          <div class="v16-body v16-stack"><div class="v16-row"><input id="cdAsk" class="v16-input" style="flex:1" maxlength="1200" placeholder="Or type a question — e.g. how far, what gear, who's online"><button class="cmd primary" id="cdAskBtn" type="button">Ask</button><button class="cmd" id="cdAskAi" type="button">Ask AI</button></div>
          <div class="cd-chips">${['How far?', 'What gear?', 'When do I rest?', 'Fuel?', 'Can I make it?', "Who's online?", 'Damage report', 'Tell me a joke'].map(x => `<button class="cmd small" data-ask="${esc(x)}" type="button">${esc(x)}</button>`).join('')}</div>
          <div id="cdLog" class="cd-log"><div class="muted">Your conversation shows here.</div></div></div></div>
        <div class="panel"><div class="panel-head"><div class="panel-title">Voice commands</div></div><div class="v16-body v16-stack">
          <div class="v16-field"><label for="cdInputEngine">Microphone processing</label><select id="cdInputEngine" class="v16-input"><option value="browser">Browser recognition (may use an online service)</option><option value="offline">Offline faster-whisper (optional local bridge)</option></select></div>
          <div class="v16-note">Offline mode: click Push to talk to record, then click again to send (15-second limit). Wake word is available only with browser recognition.</div>
          <label class="v16-toggle"><span><b>Listen for voice commands</b><div class="v16-note">Needs Chrome or Edge. A push-to-talk <b>key</b> only works while this window has focus — while ATS is focused, use the <b>wake word</b>, a <b>wheel button</b>, or run the Co-Driver on a phone/tablet (the page must be https or localhost for the mic).</div></span><input type="checkbox" id="cdListen"></label>
          <div class="v16-grid v16-2"><div class="v16-field"><label>Push-to-talk key</label><button class="cmd" id="cdKey" type="button">V</button></div><div class="v16-field"><label>Wheel / gamepad button</label><button class="cmd" id="cdPad" type="button">Not set</button></div></div>
          <label class="v16-toggle"><span><b>Wake word</b><div class="v16-note">Say "co-driver, how far?" hands-free. Keeps the mic open while enabled.</div></span><input type="checkbox" id="cdWake"></label>
          <div class="v16-note"><b>Try:</b> how far · ETA · what gear · speed limit · when do I rest · fuel · can I make it · am I on time · damage report · status · alerts · who's online · where is Dusty · how far behind the leader · next convoy · how much have I earned · eco score · regroup · fuel stop · rest stop · hold position · depart · emergency stop · economy / power mode · quiet · talk to me · repeat · joke · fact</div></div></div>
      </div>
      <div class="v16-stack">
        <div class="panel"><div class="panel-head"><div class="panel-title">Voice &amp; personality</div><button class="cmd small" id="cdTest" type="button">▶ Test voice</button></div><div class="v16-body v16-stack">
          <div class="v16-field"><label for="cdPromptSource">Which voice prompts do you want?</label><select id="cdPromptSource" class="v16-input"><option value="game">ATS in-game voice (mute Companion speech)</option><option value="companion">KAW's ATS Companion voice</option><option value="both">Both voices</option></select></div>
          <div class="v16-note" id="cdPromptNote">ATS audio settings are changed inside the game.</div>
          <details><summary>How to switch ATS's in-game voice</summary><div class="v16-note">In ATS, open Options → Audio and find the navigation voice / voice navigation settings. For ATS voice, enable navigation speech and choose your installed voice pack. For Companion voice, turn off ATS navigation speech if you want to avoid overlapping voices. The Companion provides trip updates and alerts; keep the in-game voice enabled if you need spoken turn-by-turn directions. ATS labels can vary by game version. Choosing here does not change ATS settings or select its voice pack.</div></details>
          <label class="v16-toggle"><span><b>Co-driver speaks</b><div class="v16-note">Uses this device's speakers (great on a phone or tablet in the cab).</div></span><input type="checkbox" id="cdSpeak"></label>
          <div class="v16-field"><label for="cdPersona">Personality</label><select id="cdPersona" class="v16-input">${Object.entries(P).map(([k, v]) => `<option value="${k}">${esc(v.name)}</option>`).join('')}</select></div>
          <div class="v16-field"><label for="cdVoice">Voice</label><select id="cdVoice" class="v16-input"></select></div>
          <div class="v16-field"><label for="cdSpeechEngine">Speech engine</label><select id="cdSpeechEngine" class="v16-input"><option value="browser">Browser voices</option><option value="piper">Offline Piper (optional local bridge)</option></select></div>
          <div class="v16-field"><label for="cdPiperVoice">Downloaded Piper voice</label><select id="cdPiperVoice" class="v16-input"><option value="">Start speech bridge to list voices</option></select></div>
          <div class="v16-note">Piper runs on the Companion PC. Speed and volume apply; pitch applies only to browser voices.</div>
          <div class="v16-grid v16-3"><div class="v16-field"><label>Speed</label><input id="cdRate" type="range" min="0.7" max="1.5" step="0.05"></div><div class="v16-field"><label>Pitch</label><input id="cdPitch" type="range" min="0.6" max="1.5" step="0.05"></div><div class="v16-field"><label>Volume</label><input id="cdVol" type="range" min="0.2" max="1" step="0.05"></div></div></div></div>
        <div class="panel"><div class="panel-head"><div class="panel-title">Automatic callouts</div></div><div class="v16-body v16-stack" id="cdCallouts"></div>
          <div class="v16-body v16-stack"><div class="v16-field"><label for="cdOverMph">Speak when I am this many MPH over</label><input id="cdOverMph" class="v16-input" type="number" min="1" max="30" step="1"></div>
          <div class="v16-grid v16-2"><div class="v16-field"><label for="cdOverDelay">Wait before warning</label><select id="cdOverDelay" class="v16-input"><option value="0">Immediately</option><option value="2">2 seconds</option><option value="3">3 seconds</option><option value="5">5 seconds</option></select></div><div class="v16-field"><label for="cdOverRepeat">Repeat while speeding</label><select id="cdOverRepeat" class="v16-input"><option value="0">Once per speeding episode</option><option value="30">Every 30 seconds</option><option value="45">Every 45 seconds</option><option value="60">Every minute</option></select></div></div>
          <div class="v16-note" id="cdSpeedExample"></div><div class="v16-note">Turn off “Speeding warnings” above to mute them. These settings change spoken warnings; visual alerts and trip scoring retain their own thresholds.</div></div></div>
        <div class="panel"><div class="panel-head"><div class="panel-title">Voice pack · your own voice</div><select id="vpPack" class="v16-input" style="max-width:240px" aria-label="Active voice pack"></select></div><div class="v16-body v16-stack">
          <div class="v16-note">Record each callout in your own voice (or import a pack) and the co-driver plays your clip instead of the computer voice. Clips stay on this PC. Only use voices you own or have permission to use.</div>
          <label class="v16-toggle"><span>Also read the details after my clip (speed, miles, names)</span><input type="checkbox" id="vpDetails"></label>
          <div class="v16-row"><b>Editing pack</b><select id="vpEdit" class="v16-input" style="max-width:220px"></select><button class="cmd small danger" id="vpDeletePack" type="button">Delete pack</button></div>
          <div id="vpList" class="v16-list"></div>
          <details><summary>Import a voice pack</summary><div class="v16-stack" style="margin-top:8px"><div class="v16-note">Name each file after a callout: hello, speedLimit, overspeed, miles, halfway, rest, fuel, damage, cargo, up, down, joined, left, jobStart, ack, unknown (e.g. fuel.wav, halfway.mp3). WAV, OGG, MP3 or WebM, up to about 8 seconds each.</div>
            <div class="v16-row"><input id="vpImportName" class="v16-input" placeholder="Pack name" maxlength="60"><input id="vpImportAuthor" class="v16-input" placeholder="Voice by (with permission)" maxlength="60"></div>
            <input id="vpImportFiles" type="file" multiple accept=".wav,.ogg,.mp3,.webm,audio/*" class="v16-input"></div></details>
        </div></div>
        <div class="panel"><div class="panel-head"><div class="panel-title">Free local AI • Ollama</div><button class="cmd small" id="cdAiCheck" type="button">Check connection</button></div><div class="v16-body v16-stack">
          <label class="v16-toggle"><span><b>Enable local AI</b><div class="v16-note">Ask AI sends your question and a limited truck/trip snapshot to Ollama on this PC. Ordinary commands keep their immediate responses. Unrecognized questions use AI when enabled.</div></span><input type="checkbox" id="cdAiEnabled"></label>
          <div class="v16-field"><label for="cdAiModel">Installed Ollama model</label><select id="cdAiModel" class="v16-input"></select></div>
          <div class="v16-field"><label for="cdAiIdentity">AI identity</label><input id="cdAiIdentity" class="v16-input" maxlength="60" placeholder="KAW's ATS Companion co-driver (e.g. KAW ATS Intelligence)"></div>
          <div class="v16-field"><label for="cdAiInstructions">Your instructions (style, nicknames, what to focus on)</label><textarea id="cdAiInstructions" class="v16-input" rows="4" maxlength="2000" placeholder="e.g. Call me Boss. Keep answers short. Remind me about fuel early."></textarea><div class="v16-note"><span id="cdAiInstrCount">0</span>/2000 · Safety rules always stay on: no invented directions, live trip facts only from telemetry.</div></div>
          <button class="cmd" id="cdAiSave" type="button">Save AI settings</button><div class="v16-note" id="cdAiStatus">Checking local services…</div>
          <div class="v16-note">Use this page on the Companion PC for local AI and offline speech. No paid API. Models must be downloaded first. This co-driver cannot read upcoming turns; use ATS GPS for directions.</div>
        </div></div>
      </div>
    </div>`;

  function loadVoices() {
    const sel = q('#cdVoice');
    if (!sel || !synth) return;
    const vs = synth.getVoices().filter(v => /^en/i.test(v.lang));
    sel.innerHTML = `<option value="">Automatic (best English voice)</option>` + vs.map(v => `<option value="${esc(v.voiceURI)}" ${v.voiceURI === cfg.voiceURI ? 'selected' : ''}>${esc(v.name)} (${esc(v.lang)})</option>`).join('');
  }
  function fillSettings() {
    q('#cdSpeak').checked = cfg.speak; q('#cdListen').checked = cfg.listen; q('#cdWake').checked = cfg.wakeWord;
    q('#cdPersona').value = cfg.personality; q('#cdRate').value = cfg.rate; q('#cdPitch').value = cfg.pitch; q('#cdVol').value = cfg.volume;
    q('#cdSpeechEngine').value = cfg.speechEngine; q('#cdInputEngine').value = cfg.inputEngine;
    q('#cdPromptSource').value = promptSource; promptNote();
    q('#cdOverMph').value = cfg.overspeedMph; q('#cdOverDelay').value = cfg.overspeedDelaySeconds; q('#cdOverRepeat').value = cfg.overspeedRepeatSeconds; speedExample();
    q('#cdKey').textContent = cfg.pttKey.replace(/^Key|^Digit/, '');
    q('#cdPad').textContent = cfg.pttGamepad >= 0 ? `Button ${cfg.pttGamepad}` : 'Not set';
    q('#cdCallouts').innerHTML = Object.entries(CALLOUT_LABELS).map(([k, l]) => `<label class="v16-toggle"><span>${esc(l)}</span><input type="checkbox" data-co="${k}" ${cfg.callouts[k] ? 'checked' : ''}></label>`).join('');
    qa('[data-co]').forEach(i => i.onchange = () => { cfg.callouts[i.dataset.co] = i.checked; save(); });
    loadVoices();
    refreshLocalServices();
  }
  async function refreshLocalServices() {
    try { const s = await api('/api/settings'); promptSource = s.voice?.promptSource || 'both'; q('#cdPromptSource').value = promptSource; promptNote(); } catch {}
    try {
      const s = await api('/api/ai/status'); aiEnabled = s.enabled;
      q('#cdAiEnabled').checked = s.enabled;
      if (document.activeElement !== q('#cdAiIdentity')) q('#cdAiIdentity').value = s.identity || '';
      if (document.activeElement !== q('#cdAiInstructions')) { q('#cdAiInstructions').value = s.instructions || ''; q('#cdAiInstrCount').textContent = String((s.instructions || '').length); }
      q('#cdAiModel').innerHTML = [...new Set([s.model, ...s.models])].map(m => `<option value="${esc(m)}" ${m === s.model ? 'selected' : ''}>${esc(m)}</option>`).join('');
      q('#cdAiStatus').textContent = s.available ? `${s.enabled ? 'AI enabled' : 'AI off'} • Ollama connected • ${s.models.length} installed model(s)` : s.error;
    } catch (e) { q('#cdAiStatus').textContent = e.message; }
    try {
      const s = await api('/api/ai/speech');
      q('#cdPiperVoice').innerHTML = '<option value="">Select a downloaded voice</option>' + (s.voices || []).map(v => `<option value="${esc(v)}" ${v === cfg.piperVoice ? 'selected' : ''}>${esc(v)}</option>`).join('');
    } catch {}
  }
  function promptNote() { q('#cdPromptNote').textContent = promptSource === 'game' ? 'Companion speech is muted. Enable your preferred navigation voice in ATS. AI answers still appear as text.' : promptSource === 'companion' ? 'Companion voice is active. Adjust ATS Audio separately; Companion does not supply turn-by-turn directions.' : 'Companion speech is active. Keep ATS voice enabled for spoken directions; both may speak.'; }
  function speedExample() { q('#cdSpeedExample').textContent = `Example: in a 55 MPH zone, the voice warns at ${55 + Number(cfg.overspeedMph)} MPH after ${cfg.overspeedDelaySeconds} second(s).`; }

  K.pages.push({
    name: 'codriver', icon: '🎙', label: 'Co-Driver', group: 'Drive', index: 1, html: HTML,
    load: fillSettings,
    init() {
      if (synth) synth.onvoiceschanged = loadVoices;
      q('#cdMic').onclick = startPtt;
      // One callout engine owns navigation speech, avoiding duplicate legacy warnings.
      for (const id of ['navVoiceFrequency', 'navOverspeed']) { const el = q('#' + id); if (el) el.closest('label').hidden = true; }
      const oldToggle = q('#navVoiceToggle'); if (oldToggle) { oldToggle.textContent = 'Voice & speed settings'; oldToggle.onclick = () => go('codriver'); }
      q('#cdAskAi').onclick = () => { const v = q('#cdAsk').value.trim(); if (v) { answer(v, true); q('#cdAsk').value = ''; } };
      q('#cdAiCheck').onclick = refreshLocalServices;
      wireVoicePack();
      q('#cdAiInstructions').addEventListener('input', e => { q('#cdAiInstrCount').textContent = String(e.target.value.length); });
      q('#cdPromptSource').onchange = guard(async e => { const chosen = e.target.value; try { await api('/api/settings/voice', { method: 'POST', body: { promptSource: chosen } }); promptSource = chosen; cancelSpeech(); promptNote(); } catch (err) { e.target.value = promptSource; throw err; } });
      for (const [id, key] of [['cdOverMph', 'overspeedMph'], ['cdOverDelay', 'overspeedDelaySeconds'], ['cdOverRepeat', 'overspeedRepeatSeconds']]) q('#' + id).onchange = e => { cfg[key] = id === 'cdOverMph' ? Math.max(1, Math.min(30, Math.round(Number(e.target.value) || 5))) : Number(e.target.value); e.target.value = cfg[key]; spokenSpeed.since = null; spokenSpeed.last = null; spokenSpeed.limit = null; save(); speedExample(); };
      q('#cdAiSave').onclick = guard(async () => { await api('/api/ai/settings', { method: 'POST', body: { enabled: q('#cdAiEnabled').checked, model: q('#cdAiModel').value, identity: q('#cdAiIdentity').value, instructions: q('#cdAiInstructions').value } }); await refreshLocalServices(); });
      q('#cdSpeechEngine').onchange = e => { cfg.speechEngine = e.target.value; save(); };
      q('#cdPiperVoice').onchange = e => { cfg.piperVoice = e.target.value; save(); };
      q('#cdInputEngine').onchange = e => { cfg.inputEngine = e.target.value; wakeLoop = false; try { rec?.abort(); } catch {} if (cfg.inputEngine === 'offline') { cfg.wakeWord = false; q('#cdWake').checked = false; } save(); };
      const ask = () => { const v = q('#cdAsk').value.trim(); if (v) { answer(v); q('#cdAsk').value = ''; } };
      q('#cdAskBtn').onclick = ask;
      q('#cdAsk').onkeydown = e => { if (e.key === 'Enter') ask(); };
      qa('[data-ask]').forEach(b => b.onclick = () => answer(b.dataset.ask));
      q('#cdSpeak').onchange = e => { cfg.speak = e.target.checked; save(); };
      q('#cdListen').onchange = e => { cfg.listen = e.target.checked; save(); if (cfg.listen && cfg.wakeWord) startWake(); };
      q('#cdWake').onchange = e => { cfg.wakeWord = e.target.checked; save(); if (cfg.wakeWord) startWake(); else { wakeLoop = false; try { rec?.abort(); } catch {} } };
      q('#cdPersona').onchange = e => { cfg.personality = e.target.value; save(); speak(say('hello'), { force: true, priority: 3 }); };
      q('#cdVoice').onchange = e => { cfg.voiceURI = e.target.value; save(); };
      for (const [id, k] of [['cdRate', 'rate'], ['cdPitch', 'pitch'], ['cdVol', 'volume']]) q('#' + id).onchange = e => { cfg[k] = Number(e.target.value); save(); };
      q('#cdTest').onclick = () => speak(`${say('hello')} ${say('speedLimit', 55)}`, { force: true, priority: 3 });
      q('#cdKey').onclick = () => { q('#cdKey').textContent = 'Press a key…'; const h = e => { e.preventDefault(); cfg.pttKey = e.code; save(); fillSettings(); window.removeEventListener('keydown', h, true); }; window.addEventListener('keydown', h, true); };
      q('#cdPad').onclick = () => {
        q('#cdPad').textContent = 'Press a wheel button…';
        const start = Date.now();
        const t = setInterval(() => {
          for (const p of navigator.getGamepads?.() || []) { const i = p?.buttons?.findIndex(b => b.pressed); if (i >= 0) { cfg.pttGamepad = i; save(); clearInterval(t); fillSettings(); return; } }
          if (Date.now() - start > 8000) { clearInterval(t); fillSettings(); }
        }, 80);
      };
      // Drive page bar
      q('#page-drive')?.insertAdjacentHTML('afterbegin', `<div class="v16-grid cd-bar"><div class="panel cd-shift"><div class="panel-head"><div class="panel-title">Smart shift</div><button class="cmd small" type="button" data-go="shift">Details</button></div><div class="v16-body" id="cdShiftHud"></div></div>
        <div class="panel"><div class="panel-head"><div class="panel-title">Fuel &amp; rest plan</div><button class="cmd small cd-mic" type="button" title="Ask your co-driver">🎙 Ask</button></div><div class="v16-body v16-stack" id="cdPlanner"></div></div></div>`);
      qa('#page-drive .cd-mic').forEach(b => b.onclick = startPtt);
      q('#page-drive [data-go="shift"]').onclick = () => go('shift');
      // Shift page panel
      q('#page-shift')?.insertAdjacentHTML('afterbegin', `<div class="panel" style="margin-bottom:12px"><div class="panel-head"><div class="panel-title">Smart shift assistant</div><select id="ssMode" class="v16-input" style="width:auto;min-height:36px;padding:5px 10px"><option value="auto">Auto mode</option><option value="economy">Economy</option><option value="balanced">Balanced</option><option value="power">Power</option></select></div>
        <div class="v16-body" id="ssNow"></div><div class="v16-kpis" id="ssScore"></div><div class="v16-body" id="ssTable"></div></div>`);
      q('#ssMode').onchange = guard(async e => { await api('/api/shift/mode', { method: 'POST', body: { mode: e.target.value } }); notify('Shift mode', e.target.selectedOptions[0].text, 'join'); });
      if (cfg.listen && cfg.wakeWord) setTimeout(startWake, 1500);
    }
  });

  let plannerAnnounced = null;
  K.onTick.push((d, page) => {
    if (d?.voicePromptSource) { if (promptSource !== d.voicePromptSource && d.voicePromptSource === 'game') cancelSpeech(); promptSource = d.voicePromptSource; const sel = q('#cdPromptSource'); if (sel && sel.value !== promptSource) { sel.value = promptSource; promptNote(); } }
    try { callouts(d); } catch (e) { console.error('[CO-DRIVER]', e); }
    renderDriveBar(d);
    if (page === 'shift') renderShiftPage(d);
    // Speak the fuel/rest plan once per job
    const key = d?.job?.active ? `${d.job.cargo}|${d.job.destinationCity}` : null;
    if (key && key !== plannerAnnounced && d.planner?.active && cfg.callouts.planner) { plannerAnnounced = key; setTimeout(() => speak(d.planner.summary), 4000); }
  });
})();
