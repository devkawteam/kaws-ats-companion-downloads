/* KAW'S ATS Companion v1.6 — Mixer & OBS: OBS connection, automatic scenes, one-click audio setup,
   a live OBS mixer (meters, faders, mutes, auto-level) and this PC's app volumes. Registers with app-v16.js. */
(() => {
  'use strict';
  const K = window.KAW16;
  if (!K) return;
  const { q, qa, esc, api, guard, notify } = K;
  let obs = null, apps = null, dragging = false;

  const opts = (list, sel, blank = '— none —') => `<option value="">${blank}</option>` + list.map(n => `<option value="${esc(n)}" ${n === sel ? 'selected' : ''}>${esc(n)}</option>`).join('');
  const pct = db => Math.max(0, Math.min(100, (Number(db) + 60) / 60 * 100));

  const HTML = `
    <div class="v16-grid v16-2">
      <div class="panel"><div class="panel-head"><div class="panel-title">OBS connection</div><div id="mxObsState"></div></div>
        <div class="v16-body v16-stack">
          <div class="v16-note">In OBS Studio open <b>Tools → WebSocket Server Settings</b>, tick <b>Enable WebSocket server</b>, then <b>Show Connect Info</b> and copy the password here. (Streamlabs Desktop has no remote control — overlays and chat commands still work there.)</div>
          <div class="v16-row"><input id="mxHost" class="v16-input" placeholder="127.0.0.1" style="max-width:170px"><input id="mxPort" class="v16-input" placeholder="4455" style="max-width:100px"><input id="mxPass" class="v16-input" type="password" placeholder="Server password" autocomplete="off"></div>
          <div class="v16-row"><label class="v16-toggle" style="padding:0;gap:8px"><span>Connect to OBS</span><input type="checkbox" id="mxEnabled"></label><button class="cmd primary" id="mxSaveConn" type="button">Save &amp; connect</button><span class="muted" id="mxErr" style="font-size:12px"></span></div>
        </div></div>
      <div class="panel"><div class="panel-head"><div class="panel-title">Automatic scenes</div><label class="v16-toggle" style="padding:0;gap:8px"><span style="font-size:13px">On</span><input type="checkbox" id="mxAuto"></label></div>
        <div class="v16-body v16-stack">
          <div class="v16-row"><b style="min-width:120px">Driving</b><select id="mxScDriving" class="v16-input"></select></div>
          <div class="v16-row"><b style="min-width:120px">Parked</b><select id="mxScParked" class="v16-input"></select><select id="mxParkSec" class="v16-input" style="max-width:130px"><option value="10">after 10 s</option><option value="20">after 20 s</option><option value="60">after 1 min</option><option value="180">after 3 min</option></select></div>
          <div class="v16-row"><b style="min-width:120px">Paused</b><select id="mxScPaused" class="v16-input"></select></div>
          <div class="v16-row"><b style="min-width:120px">Crash (8 s)</b><select id="mxScCrash" class="v16-input"></select></div>
          <label class="v16-toggle"><span>Save the OBS replay buffer on a crash</span><input type="checkbox" id="mxReplay"></label>
          <label class="v16-toggle"><span>Start the chapter log when OBS goes live</span><input type="checkbox" id="mxAutoSession"></label>
          <div class="v16-row"><button class="cmd primary" id="mxSaveScenes" type="button">Save scenes</button><span class="muted" style="font-size:12px">If you switch scenes yourself, auto scenes pause for 2 minutes.</span></div>
        </div></div>
    </div>

    <div class="panel" style="margin-top:12px"><div class="panel-head"><div class="panel-title">One-click stream audio</div><div class="muted" style="font-size:12px">Fixes loud / quiet Discord voices and game noise on stream</div></div>
      <div class="v16-body v16-stack">
        <div class="v16-row" style="flex-wrap:wrap">
          <label style="min-width:220px">Your mic<br><select id="mxSrcMic" class="v16-input"></select></label>
          <label style="min-width:220px">Discord<br><select id="mxSrcDiscord" class="v16-input"></select></label>
          <label style="min-width:220px">Game (ATS)<br><select id="mxSrcGame" class="v16-input"></select></label>
          <label style="min-width:220px">Music<br><select id="mxSrcMusic" class="v16-input"></select></label>
        </div>
        <div class="v16-row"><button class="cmd" id="mxAddDiscord" type="button">➕ Capture Discord in OBS</button><button class="cmd primary" id="mxApplyAudio" type="button">Apply KAW audio setup</button></div>
        <div class="v16-note">Adds OBS filters named <b>KAW …</b> (safe to run again): mic → noise suppression, compressor, limiter · Discord → voice leveler + limiter (evens out loud and quiet people) · game &amp; music → ducking, so they dip while you or anyone on Discord talks.</div>
        <div id="mxAudioDone" class="v16-list"></div>
      </div></div>

    <div class="panel" style="margin-top:12px"><div class="panel-head"><div class="panel-title">OBS mixer</div><div class="v16-row"><label class="v16-toggle" style="padding:0;gap:8px"><span style="font-size:13px">Auto-level ticked sources to</span><input type="checkbox" id="mxAL"></label><select id="mxALTarget" class="v16-input" style="max-width:120px"><option value="-20">-20 dB</option><option value="-16">-16 dB</option><option value="-14" selected>-14 dB</option><option value="-12">-12 dB</option></select></div></div>
      <div class="v16-body"><div id="mxObsMixer" class="mx-list"></div></div></div>

    <div class="panel" style="margin-top:12px"><div class="panel-head"><div class="panel-title">This PC — app volumes</div><div class="v16-row"><label class="v16-toggle" style="padding:0;gap:8px"><span style="font-size:13px">Duck ATS when Discord talks</span><input type="checkbox" id="mxDuck"></label><select id="mxDuckAmt" class="v16-input" style="max-width:120px"><option value="0.5">to 50%</option><option value="0.35" selected>to 35%</option><option value="0.2">to 20%</option></select></div></div>
      <div class="v16-body v16-stack"><div class="v16-note" id="mxAppsNote">Loading…</div><div id="mxApps" class="mx-list"></div>
        <div class="v16-row" id="mxPresets"></div></div></div>`;

  function renderObs() {
    const s = obs || {};
    q('#mxObsState').innerHTML = s.connected ? `<span class="v16-pill good">Connected${s.streaming ? ' · 🔴 LIVE' : ''}${s.recording ? ' · REC' : ''}</span>` : s.connecting ? '<span class="v16-pill warn">Connecting…</span>' : '<span class="v16-pill muted">Not connected</span>';
    q('#mxErr').textContent = s.error || (s.connected ? `obs-websocket ${s.version || ''} · scene: ${s.currentScene || '?'}${s.manualOverride ? ' · auto scenes paused (manual switch)' : ''}` : '');
    if (document.activeElement?.closest?.('#page-mixer')) return;
    q('#mxHost').value = s.host || '127.0.0.1'; q('#mxPort').value = s.port || 4455; q('#mxPass').value = s.password || ''; q('#mxEnabled').checked = Boolean(s.enabled);
    q('#mxAuto').checked = Boolean(s.autoScenes); q('#mxReplay').checked = Boolean(s.crashReplay); q('#mxAutoSession').checked = s.autoSession !== false;
    q('#mxParkSec').value = String(s.parkedAfterSec || 20);
    const scenes = s.scenes || [];
    for (const [id, key] of [['#mxScDriving', 'driving'], ['#mxScParked', 'parked'], ['#mxScPaused', 'paused'], ['#mxScCrash', 'crash']]) q(id).innerHTML = opts(scenes, s.sceneRules?.[key] || '', '— don\'t switch —');
    const audio = (s.inputs || []).map(i => i.name);
    for (const [id, key] of [['#mxSrcMic', 'mic'], ['#mxSrcDiscord', 'discord'], ['#mxSrcGame', 'game'], ['#mxSrcMusic', 'music']]) q(id).innerHTML = opts(audio, s.sources?.[key] || '');
    q('#mxAL').checked = Boolean(s.autoLevel?.enabled); q('#mxALTarget').value = String(s.autoLevel?.targetDb ?? -14);
  }

  function meterHtml(peak, hold) {
    return `<div class="mx-meter"><span style="width:${pct(peak)}%"></span><i style="left:${pct(hold)}%"></i></div>`;
  }

  async function renderObsMixer() {
    if (!obs?.connected) { q('#mxObsMixer').innerHTML = '<div class="v16-empty">Connect OBS above to see its audio sources.</div>'; return; }
    const m = await api('/api/stream/obs/mixer');
    const box = q('#mxObsMixer');
    for (const i of m.inputs) {
      let row = box.querySelector(`[data-in="${CSS.escape(i.name)}"]`);
      if (!row) {
        row = document.createElement('div');
        row.className = 'mx-row'; row.dataset.in = i.name;
        row.innerHTML = `<div class="mx-name" title="${esc(i.kind)}">${esc(i.name)}</div><div class="mx-m"></div><input type="range" min="-60" max="6" step="0.5" class="mx-fader"><span class="mx-db"></span><button class="cmd small mx-mute" type="button">Mute</button><label class="mx-al" title="Auto-level this source"><input type="checkbox"> auto</label>`;
        row.querySelector('.mx-fader').addEventListener('input', e => { row.querySelector('.mx-db').textContent = `${Number(e.target.value).toFixed(1)} dB`; });
        row.querySelector('.mx-fader').addEventListener('change', guard(async e => { await api('/api/stream/obs/volume', { method: 'POST', body: { inputName: i.name, db: Number(e.target.value) } }); }));
        row.querySelector('.mx-fader').addEventListener('pointerdown', () => { dragging = true; });
        row.querySelector('.mx-fader').addEventListener('pointerup', () => { dragging = false; });
        row.querySelector('.mx-mute').addEventListener('click', guard(async () => { await api('/api/stream/obs/mute', { method: 'POST', body: { inputName: i.name, muted: !row.classList.contains('muted') } }); }));
        row.querySelector('.mx-al input').addEventListener('change', guard(async e => {
          const list = new Set(obs.autoLevel?.inputs || []);
          e.target.checked ? list.add(i.name) : list.delete(i.name);
          obs = await api('/api/stream/obs', { method: 'POST', body: { autoLevel: { inputs: [...list] } } });
        }));
        box.append(row);
      }
      row.querySelector('.mx-m').innerHTML = meterHtml(i.peakDb, i.holdDb);
      row.classList.toggle('muted', i.muted);
      row.querySelector('.mx-mute').textContent = i.muted ? 'Unmute' : 'Mute';
      if (!dragging && document.activeElement !== row.querySelector('.mx-fader')) {
        row.querySelector('.mx-fader').value = String(i.volumeDb ?? 0);
        row.querySelector('.mx-db').textContent = `${Number(i.volumeDb ?? 0).toFixed(1)} dB`;
      }
      row.querySelector('.mx-al input').checked = i.autoLevel;
    }
    for (const row of [...box.querySelectorAll('.mx-row')]) if (!m.inputs.some(i => i.name === row.dataset.in)) row.remove();
  }

  // ---- this PC's app volumes (Windows audio sessions) ----
  async function renderApps() {
    try { apps = await api('/api/stream/apps'); } catch (e) { q('#mxAppsNote').textContent = e.message; return; }
    q('#mxAppsNote').textContent = apps.note || (apps.sessions?.length ? 'Apps currently playing sound on this PC.' : 'No app is playing sound right now.');
    if (!document.activeElement?.closest?.('#mxDuckAmt')) { q('#mxDuck').checked = Boolean(apps.duck?.enabled); q('#mxDuckAmt').value = String(apps.duck?.level ?? 0.35); }
    const box = q('#mxApps');
    for (const sname of apps.sessions || []) {
      const key = sname.process;
      let row = box.querySelector(`[data-app="${CSS.escape(key)}"]`);
      if (!row) {
        row = document.createElement('div');
        row.className = 'mx-row'; row.dataset.app = key;
        row.innerHTML = `<div class="mx-name">${esc(sname.label)}</div><div class="mx-m"></div><input type="range" min="0" max="100" step="1" class="mx-fader"><span class="mx-db"></span><button class="cmd small mx-mute" type="button">Mute</button>`;
        row.querySelector('.mx-fader').addEventListener('input', e => { row.querySelector('.mx-db').textContent = `${e.target.value}%`; });
        row.querySelector('.mx-fader').addEventListener('change', guard(async e => { await api('/api/stream/apps', { method: 'POST', body: { process: key, volume: Number(e.target.value) / 100 } }); }));
        row.querySelector('.mx-fader').addEventListener('pointerdown', () => { dragging = true; });
        row.querySelector('.mx-fader').addEventListener('pointerup', () => { dragging = false; });
        row.querySelector('.mx-mute').addEventListener('click', guard(async () => { await api('/api/stream/apps', { method: 'POST', body: { process: key, muted: !row.classList.contains('muted') } }); }));
        box.append(row);
      }
      const peakDb = sname.peak > 0 ? 20 * Math.log10(sname.peak) : -100;
      row.querySelector('.mx-m').innerHTML = meterHtml(peakDb, peakDb);
      row.classList.toggle('muted', sname.muted);
      row.querySelector('.mx-mute').textContent = sname.muted ? 'Unmute' : 'Mute';
      if (!dragging && document.activeElement !== row.querySelector('.mx-fader')) { row.querySelector('.mx-fader').value = String(Math.round(sname.volume * 100)); row.querySelector('.mx-db').textContent = `${Math.round(sname.volume * 100)}%${sname.ducked ? ' (ducked)' : ''}`; }
    }
    for (const row of [...box.querySelectorAll('[data-app]')]) if (!(apps.sessions || []).some(x => x.process === row.dataset.app)) row.remove();
    q('#mxPresets').innerHTML = (apps.presets || []).map(p => `<button class="cmd small" type="button" data-preset="${esc(p.id)}">${esc(p.name)}</button>`).join('') + '<button class="cmd small" type="button" data-preset="__save">＋ Save current as preset</button>';
  }

  async function refreshObsCfg() { obs = await api('/api/stream/obs'); }
  const load = guard(async () => { await refreshObsCfg(); renderObs(); await renderObsMixer(); await renderApps(); });

  K.pages.push({
    name: 'mixer', icon: '🎚', label: 'Mixer & OBS', group: 'Stream', index: 1, html: HTML, load,
    init() {
      q('#mxSaveConn').onclick = guard(async () => { obs = await api('/api/stream/obs', { method: 'POST', body: { enabled: q('#mxEnabled').checked || true, host: q('#mxHost').value.trim(), port: Number(q('#mxPort').value) || 4455, password: q('#mxPass').value } }); q('#mxEnabled').checked = true; notify('Connecting to OBS…', '', 'join'); setTimeout(load, 2500); });
      q('#mxEnabled').onchange = guard(async e => { obs = await api('/api/stream/obs', { method: 'POST', body: { enabled: e.target.checked } }); setTimeout(load, 1500); });
      q('#mxSaveScenes').onclick = guard(async () => {
        obs = await api('/api/stream/obs', { method: 'POST', body: { autoScenes: q('#mxAuto').checked, crashReplay: q('#mxReplay').checked, autoSession: q('#mxAutoSession').checked, parkedAfterSec: Number(q('#mxParkSec').value), scenes: { driving: q('#mxScDriving').value, parked: q('#mxScParked').value, paused: q('#mxScPaused').value, crash: q('#mxScCrash').value } } });
        notify('Scene rules saved', q('#mxAuto').checked ? 'OBS now follows your truck.' : 'Automatic scenes are off.', 'join'); load();
      });
      q('#mxAuto').onchange = () => q('#mxSaveScenes').click();
      q('#mxAddDiscord').onclick = guard(async () => { const r = await api('/api/stream/obs/discord', { method: 'POST' }); notify(r.existed ? 'Discord is already captured' : 'Discord capture added', `OBS source: ${r.inputName}`, 'join'); load(); });
      q('#mxApplyAudio').onclick = guard(async () => {
        const r = await api('/api/stream/obs/audio-setup', { method: 'POST', body: { sources: { mic: q('#mxSrcMic').value, discord: q('#mxSrcDiscord').value, game: q('#mxSrcGame').value, music: q('#mxSrcMusic').value } } });
        q('#mxAudioDone').innerHTML = r.done.map(d => `<div class="v16-item"><div class="grow">✔ ${esc(d)}</div></div>`).join('');
        notify('Stream audio set up', 'Filters added in OBS (named KAW …).', 'join');
      });
      q('#mxAL').onchange = guard(async e => { obs = await api('/api/stream/obs', { method: 'POST', body: { autoLevel: { enabled: e.target.checked, targetDb: Number(q('#mxALTarget').value) } } }); });
      q('#mxALTarget').onchange = () => q('#mxAL').dispatchEvent(new Event('change'));
      const saveDuck = guard(async () => { await api('/api/stream/apps', { method: 'POST', body: { duck: { enabled: q('#mxDuck').checked, level: Number(q('#mxDuckAmt').value) } } }); });
      q('#mxDuck').onchange = saveDuck; q('#mxDuckAmt').onchange = saveDuck;
      q('#mxPresets').addEventListener('click', guard(async e => {
        const b = e.target.closest('[data-preset]');
        if (!b) return;
        if (b.dataset.preset === '__save') { const name = prompt('Preset name (e.g. Convoy night):'); if (!name) return; await api('/api/stream/apps', { method: 'POST', body: { savePreset: name } }); notify('Preset saved', name, 'join'); }
        else { await api('/api/stream/apps', { method: 'POST', body: { applyPreset: b.dataset.preset } }); notify('Preset applied', '', 'join'); }
        renderApps();
      }));
    }
  });

  let tick = 0;
  K.onTick.push((d, page) => {
    if (page !== 'mixer') return;
    tick++;
    guard(renderObsMixer)();
    if (tick % 2 === 0) guard(renderApps)();
    if (tick % 10 === 0) guard(async () => { await refreshObsCfg(); renderObs(); })();
  });
})();
