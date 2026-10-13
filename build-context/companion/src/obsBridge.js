// OBS remote control (obs-websocket 5, built into OBS Studio 28+: Tools > WebSocket Server Settings).
// - Automatic scenes: driving / parked / paused / crash, with a manual-override pause.
// - Streaming state: marks the streamer live and starts/stops the chapter log.
// - One-click audio setup: named "KAW ..." filters (noise suppression, compressor, limiter, ducking).
// - Mixer: input volumes, mutes and live meters; optional gentle auto-level.
// - One-click sources: Discord application audio capture, overlay/scene browser sources.

const crypto = require('node:crypto');
const { saveConfigSection } = require('./config');

const SUB_GENERAL = 0x7ff;            // all low-volume events
const SUB_METERS = 1 << 16;           // InputVolumeMeters (~every 50 ms)
const AUDIO_KINDS = ['wasapi_input_capture', 'wasapi_output_capture', 'wasapi_process_output_capture', 'coreaudio_input_capture', 'coreaudio_output_capture', 'pulse_input_capture', 'pulse_output_capture', 'ffmpeg_source', 'browser_source', 'vlc_source'];
const toDb = mul => (mul > 0 ? 20 * Math.log10(mul) : -100);
const clampDb = v => Math.max(-100, Math.min(26, Number(v) || 0));

class ObsBridge {
  constructor({ config, stream, studio }) {
    Object.assign(this, { stream, studio });
    const o = config.obs || {};
    this.settings = {
      enabled: Boolean(o.enabled), host: String(o.host || '127.0.0.1'), port: Number(o.port) || 4455, password: String(o.password || ''),
      autoScenes: Boolean(o.autoScenes),
      scenes: { driving: o.scenes?.driving || '', parked: o.scenes?.parked || '', paused: o.scenes?.paused || '', crash: o.scenes?.crash || '' },
      parkedAfterSec: Math.max(5, Number(o.parkedAfterSec) || 20),
      crashReplay: Boolean(o.crashReplay),
      autoSession: o.autoSession !== false,
      sources: { mic: o.sources?.mic || '', discord: o.sources?.discord || '', game: o.sources?.game || '', music: o.sources?.music || '' },
      autoLevel: { enabled: Boolean(o.autoLevel?.enabled), inputs: Array.isArray(o.autoLevel?.inputs) ? o.autoLevel.inputs.slice(0, 8) : [], targetDb: Number(o.autoLevel?.targetDb) || -14 }
    };
    this.ws = null; this.connected = false; this.identified = false; this.error = null; this.version = null;
    this.pending = new Map(); this.seq = 0;
    this.scenes = []; this.currentScene = null; this.inputs = []; this.volumes = {}; this.mutes = {}; this.meters = {};
    this.streaming = false; this.recording = false; this.replayBuffer = false;
    this.lastSwitchAt = 0; this.ourSwitch = null; this.manualUntil = 0; this.parkedSince = null; this.crashUntil = 0; this.beforeCrash = null;
    this.level = {};
    this.reconnectTimer = null;
    if (this.settings.enabled) this.connect();
    setInterval(() => this.autoLevelTick(), 2000).unref?.();
  }

  save() { try { saveConfigSection('obs', this.settings); } catch (e) { console.error('[OBS]', e.message); } }

  update(patch = {}) {
    const s = this.settings;
    const reconnect = ['enabled', 'host', 'port', 'password'].some(k => patch[k] !== undefined && String(patch[k]) !== String(s[k]));
    if (patch.enabled !== undefined) s.enabled = Boolean(patch.enabled);
    if (patch.host !== undefined) s.host = String(patch.host).trim().slice(0, 100) || '127.0.0.1';
    if (patch.port !== undefined) s.port = Math.max(1, Math.min(65535, Number(patch.port) || 4455));
    if (patch.password !== undefined && patch.password !== '••••••') s.password = String(patch.password).slice(0, 200);
    for (const k of ['autoScenes', 'crashReplay', 'autoSession']) if (patch[k] !== undefined) s[k] = Boolean(patch[k]);
    if (patch.parkedAfterSec !== undefined) s.parkedAfterSec = Math.max(5, Math.min(600, Number(patch.parkedAfterSec) || 20));
    if (patch.scenes) for (const k of Object.keys(s.scenes)) if (patch.scenes[k] !== undefined) s.scenes[k] = String(patch.scenes[k] || '').slice(0, 200);
    if (patch.sources) for (const k of Object.keys(s.sources)) if (patch.sources[k] !== undefined) s.sources[k] = String(patch.sources[k] || '').slice(0, 200);
    if (patch.autoLevel) {
      if (patch.autoLevel.enabled !== undefined) s.autoLevel.enabled = Boolean(patch.autoLevel.enabled);
      if (Array.isArray(patch.autoLevel.inputs)) s.autoLevel.inputs = patch.autoLevel.inputs.map(String).slice(0, 8);
      if (patch.autoLevel.targetDb !== undefined) s.autoLevel.targetDb = Math.max(-40, Math.min(-3, Number(patch.autoLevel.targetDb) || -14));
    }
    this.save();
    if (reconnect) { this.disconnect(); if (s.enabled) this.connect(); }
    return this.status();
  }

  // ---------- connection ----------
  connect() {
    clearTimeout(this.reconnectTimer);
    if (this.ws || !this.settings.enabled) return;
    let ws;
    try { ws = new WebSocket(`ws://${this.settings.host}:${this.settings.port}`, 'obswebsocket.json'); } catch (e) { this.error = e.message; return this.scheduleReconnect(); }
    this.ws = ws;
    ws.onopen = () => { this.connected = true; this.error = null; };
    ws.onmessage = ev => { try { this.onMessage(JSON.parse(String(ev.data))); } catch (e) { console.error('[OBS]', e.message); } };
    ws.onerror = () => { this.error = this.error || `Could not reach OBS at ${this.settings.host}:${this.settings.port}. In OBS open Tools > WebSocket Server Settings and tick Enable.`; };
    ws.onclose = ev => {
      const wasIdentified = this.identified;
      this.ws = null; this.connected = false; this.identified = false;
      for (const { reject } of this.pending.values()) reject(new Error('OBS disconnected'));
      this.pending.clear();
      if (ev.code === 4009) this.error = 'OBS rejected the password. Copy it from Tools > WebSocket Server Settings > Show Connect Info.';
      else if (wasIdentified) this.error = 'OBS closed the connection.';
      this.scheduleReconnect();
    };
  }

  scheduleReconnect() { clearTimeout(this.reconnectTimer); if (this.settings.enabled) { this.reconnectTimer = setTimeout(() => this.connect(), 10000); this.reconnectTimer.unref?.(); } }
  disconnect() { clearTimeout(this.reconnectTimer); try { this.ws?.close(); } catch {} this.ws = null; this.connected = false; this.identified = false; }

  onMessage(msg) {
    const { op, d } = msg;
    if (op === 0) { // Hello
      this.version = d.obsWebSocketVersion || null;
      const identify = { rpcVersion: 1, eventSubscriptions: SUB_GENERAL | SUB_METERS };
      if (d.authentication) {
        if (!this.settings.password) { this.error = 'OBS needs a password. Copy it from Tools > WebSocket Server Settings > Show Connect Info.'; this.ws.close(); return; }
        const secret = crypto.createHash('sha256').update(this.settings.password + d.authentication.salt).digest('base64');
        identify.authentication = crypto.createHash('sha256').update(secret + d.authentication.challenge).digest('base64');
      }
      this.ws.send(JSON.stringify({ op: 1, d: identify }));
    } else if (op === 2) { // Identified
      this.identified = true; this.error = null;
      console.log(`[OBS] Connected (obs-websocket ${this.version || '?'}).`);
      this.refresh().catch(e => console.error('[OBS]', e.message));
    } else if (op === 7) { // RequestResponse
      const p = this.pending.get(d.requestId);
      if (!p) return;
      this.pending.delete(d.requestId);
      if (d.requestStatus?.result) p.resolve(d.responseData || {});
      else p.reject(new Error(d.requestStatus?.comment || `OBS request ${d.requestType} failed (${d.requestStatus?.code})`));
    } else if (op === 5) this.onEvent(d.eventType, d.eventData || {});
  }

  request(requestType, requestData = {}) {
    if (!this.identified || !this.ws) return Promise.reject(new Error('OBS is not connected.'));
    const requestId = `kaw-${++this.seq}`;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { this.pending.delete(requestId); reject(new Error(`OBS did not answer ${requestType}.`)); }, 8000);
      this.pending.set(requestId, { resolve: v => { clearTimeout(timer); resolve(v); }, reject: e => { clearTimeout(timer); reject(e); } });
      this.ws.send(JSON.stringify({ op: 6, d: { requestType, requestId, requestData } }));
    });
  }

  async refresh() {
    const sl = await this.request('GetSceneList');
    this.scenes = (sl.scenes || []).map(s => s.sceneName).reverse();
    this.currentScene = sl.currentProgramSceneName || null;
    const il = await this.request('GetInputList');
    this.inputs = (il.inputs || []).map(i => ({ name: i.inputName, kind: i.unversionedInputKind || i.inputKind }));
    for (const i of this.inputs.filter(x => AUDIO_KINDS.includes(x.kind))) {
      try { this.volumes[i.name] = (await this.request('GetInputVolume', { inputName: i.name })).inputVolumeDb; } catch {}
      try { this.mutes[i.name] = (await this.request('GetInputMute', { inputName: i.name })).inputMuted; } catch {}
    }
    try { const st = await this.request('GetStreamStatus'); this.setStreaming(Boolean(st.outputActive)); } catch {}
    try { const rc = await this.request('GetRecordStatus'); this.recording = Boolean(rc.outputActive); } catch {}
    try { const rb = await this.request('GetReplayBufferStatus'); this.replayBuffer = Boolean(rb.outputActive); } catch { this.replayBuffer = false; }
  }

  onEvent(type, d) {
    switch (type) {
      case 'CurrentProgramSceneChanged':
        this.currentScene = d.sceneName;
        // A switch we did not make = the streamer took over: pause auto scenes for 2 minutes.
        if (this.ourSwitch !== d.sceneName) this.manualUntil = Date.now() + 120000;
        this.ourSwitch = null;
        break;
      case 'SceneListChanged': this.scenes = (d.scenes || []).map(s => s.sceneName).reverse(); break;
      case 'InputCreated': case 'InputRemoved': case 'InputNameChanged': this.refresh().catch(() => {}); break;
      case 'InputVolumeChanged': this.volumes[d.inputName] = d.inputVolumeDb; break;
      case 'InputMuteStateChanged': this.mutes[d.inputName] = d.inputMuted; break;
      case 'StreamStateChanged': this.setStreaming(Boolean(d.outputActive)); break;
      case 'RecordStateChanged': this.recording = Boolean(d.outputActive); break;
      case 'ReplayBufferStateChanged': this.replayBuffer = Boolean(d.outputActive); break;
      case 'InputVolumeMeters':
        for (const i of d.inputs || []) {
          const ch = i.inputLevelsMul || [];
          const peak = Math.max(0, ...ch.map(c => Number(c[1]) || 0));
          const mag = Math.max(0, ...ch.map(c => Number(c[0]) || 0));
          const m = this.meters[i.inputName] || { peakDb: -100, magDb: -100, holdDb: -100, at: 0 };
          m.peakDb = toDb(peak); m.magDb = toDb(mag); m.holdDb = Math.max(m.peakDb, m.holdDb - 0.6); m.at = Date.now();
          this.meters[i.inputName] = m;
          const lv = this.level[i.inputName] ||= { sum: 0, n: 0 };
          if (m.magDb > -50) { lv.sum += m.magDb; lv.n++; }
        }
        break;
      default: break;
    }
  }

  setStreaming(live) {
    if (live === this.streaming) return;
    this.streaming = live;
    if (this.studio) this.studio.obsLive = live;
    if (this.settings.autoSession && this.stream) {
      if (live) this.stream.startSession('obs', this.studio?.settings?.title || '');
      else this.stream.stopSession();
    }
  }

  // ---------- automatic scenes ----------
  async setScene(name, ours = true) {
    if (!name || !this.scenes.includes(name) || name === this.currentScene) return false;
    if (ours) this.ourSwitch = name;
    await this.request('SetCurrentProgramScene', { sceneName: name });
    this.currentScene = name; this.lastSwitchAt = Date.now();
    return true;
  }

  tick(state) {
    if (!this.identified || !this.settings.autoScenes) return;
    const now = Date.now();
    if (now < this.manualUntil || now < this.crashUntil) return;
    if (this.beforeCrash) { const back = this.beforeCrash; this.beforeCrash = null; this.setScene(back).catch(() => {}); return; }
    if (now - this.lastSwitchAt < 5000) return;
    const speed = Number(state.truck?.speedMph) || 0;
    const sc = this.settings.scenes;
    let target = null;
    if (!state.connected) target = null;
    else if (state.sdk?.paused) target = sc.paused;
    else if (speed < 1) { this.parkedSince ??= now; if (now - this.parkedSince > this.settings.parkedAfterSec * 1000) target = sc.parked; }
    else { this.parkedSince = null; target = sc.driving; }
    if (target) this.setScene(target).catch(() => {});
  }

  async onCrash() {
    if (!this.identified) return;
    if (this.settings.crashReplay && this.replayBuffer) { try { await this.request('SaveReplayBuffer'); } catch {} }
    const crash = this.settings.scenes.crash;
    if (this.settings.autoScenes && crash && this.scenes.includes(crash) && this.currentScene !== crash) {
      this.beforeCrash = this.currentScene;
      await this.setScene(crash).catch(() => {});
      this.crashUntil = Date.now() + 8000;
    }
  }

  // ---------- audio setup ----------
  async upsertFilter(sourceName, filterName, filterKind, filterSettings) {
    const list = await this.request('GetSourceFilterList', { sourceName });
    if ((list.filters || []).some(f => f.filterName === filterName)) await this.request('SetSourceFilterSettings', { sourceName, filterName, filterSettings, overlay: true });
    else await this.request('CreateSourceFilter', { sourceName, filterName, filterKind, filterSettings });
  }

  async audioSetup(sources = this.settings.sources) {
    const done = [];
    const has = n => n && this.inputs.some(i => i.name === n);
    const { mic, discord, game, music } = sources;
    if (has(mic)) {
      await this.upsertFilter(mic, 'KAW Noise Suppression', 'noise_suppress_filter_v2', { method: 'rnnoise' });
      await this.upsertFilter(mic, 'KAW Mic Compressor', 'compressor_filter', { ratio: 3.0, threshold: -18.0, attack_time: 6, release_time: 60, output_gain: 2.0 });
      await this.upsertFilter(mic, 'KAW Mic Limiter', 'limiter_filter', { threshold: -3.0, release_time: 60 });
      done.push(`${mic}: noise suppression, compressor, limiter`);
    }
    if (has(discord)) {
      // Heavy leveling: the shouter and the whisperer end up at a similar loudness.
      await this.upsertFilter(discord, 'KAW Voice Leveler', 'compressor_filter', { ratio: 6.0, threshold: -26.0, attack_time: 5, release_time: 120, output_gain: 6.0 });
      await this.upsertFilter(discord, 'KAW Voice Limiter', 'limiter_filter', { threshold: -6.0, release_time: 60 });
      done.push(`${discord}: voice leveler, limiter`);
    }
    for (const bed of [game, music].filter(has)) {
      // Ducking: a sidechain compressor per voice source, so the bed dips while anyone talks.
      for (const [voice, label] of [[mic, 'Mic'], [discord, 'Discord']]) {
        if (!has(voice)) continue;
        await this.upsertFilter(bed, `KAW Duck under ${label}`, 'compressor_filter', { ratio: 8.0, threshold: -34.0, attack_time: 10, release_time: 450, output_gain: 0, sidechain_source: voice });
      }
      done.push(`${bed}: ducks under ${[mic && 'mic', discord && 'Discord'].filter(Boolean).join(' + ')}`);
    }
    if (!done.length) throw new Error('Pick your mic, Discord, game or music sources first.');
    this.settings.sources = { mic: mic || '', discord: discord || '', game: game || '', music: music || '' };
    this.save();
    return done;
  }

  // ---------- sources ----------
  async addDiscordCapture() {
    const existing = this.inputs.find(i => i.kind === 'wasapi_process_output_capture' && /discord/i.test(i.name));
    if (existing) return { inputName: existing.name, existed: true };
    if (!this.currentScene) throw new Error('No OBS scene is active.');
    const inputName = 'Discord (KAW)';
    // Application Audio Capture (Windows, OBS 28+): capture only Discord, matched by executable.
    await this.request('CreateInput', { sceneName: this.currentScene, inputName, inputKind: 'wasapi_process_output_capture', inputSettings: { window: 'Discord:Chrome_WidgetWin_1:Discord.exe', priority: 2 }, sceneItemEnabled: true });
    await this.refresh();
    this.settings.sources.discord = inputName;
    this.save();
    return { inputName, existed: false };
  }

  async addBrowserSource(name, url, vertical = false) {
    if (!/^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?\//.test(url)) throw new Error('Only Companion overlay links can be added.');
    if (!this.currentScene) throw new Error('No OBS scene is active.');
    const inputName = String(name || 'KAW Overlay').slice(0, 80);
    const settings = { url, width: vertical ? 1080 : 1920, height: vertical ? 1920 : 1080, reroute_audio: true, shutdown: false };
    if (this.inputs.some(i => i.name === inputName)) await this.request('SetInputSettings', { inputName, inputSettings: settings, overlay: true });
    else await this.request('CreateInput', { sceneName: this.currentScene, inputName, inputKind: 'browser_source', inputSettings: settings, sceneItemEnabled: true });
    await this.refresh();
    return { inputName, scene: this.currentScene };
  }

  // ---------- mixer ----------
  async setVolume(inputName, db) { await this.request('SetInputVolume', { inputName, inputVolumeDb: clampDb(db) }); this.volumes[inputName] = clampDb(db); }
  async setMute(inputName, muted) { await this.request('SetInputMute', { inputName, inputMuted: Boolean(muted) }); this.mutes[inputName] = Boolean(muted); }

  // Every 2 s: nudge auto-level inputs 1 dB toward the target loudness (only while they carry sound).
  autoLevelTick() {
    const al = this.settings.autoLevel;
    if (!this.identified || !al.enabled) { this.level = {}; return; }
    for (const name of al.inputs) {
      const lv = this.level[name];
      if (!lv || lv.n < 10 || this.mutes[name]) continue;
      const avg = lv.sum / lv.n;
      const cur = this.volumes[name] ?? 0;
      const diff = al.targetDb - avg;
      if (Math.abs(diff) > 3) {
        const next = Math.max(-30, Math.min(8, cur + Math.sign(diff)));
        if (next !== cur) this.setVolume(name, next).catch(() => {});
      }
    }
    this.level = {};
  }

  mixer() {
    const now = Date.now();
    return this.inputs.filter(i => AUDIO_KINDS.includes(i.kind)).map(i => {
      const m = this.meters[i.name];
      const fresh = m && now - m.at < 1500;
      return { name: i.name, kind: i.kind, volumeDb: this.volumes[i.name] ?? null, muted: Boolean(this.mutes[i.name]), peakDb: fresh ? Math.round(m.peakDb * 10) / 10 : -100, holdDb: fresh ? Math.round(m.holdDb * 10) / 10 : -100, autoLevel: this.settings.autoLevel.inputs.includes(i.name) };
    });
  }

  status() {
    const { password, scenes: sceneRules, ...rest } = this.settings;
    return { ...rest, sceneRules, password: password ? '••••••' : '', connected: this.identified, connecting: Boolean(this.ws && !this.identified), error: this.error, version: this.version, scenes: this.scenes, currentScene: this.currentScene, inputs: this.inputs, streaming: this.streaming, recording: this.recording, replayBuffer: this.replayBuffer, manualOverride: Date.now() < this.manualUntil };
  }
}

module.exports = { ObsBridge };
