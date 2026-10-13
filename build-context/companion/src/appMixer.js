// This PC's app volumes (Windows Volume Mixer sessions) + "duck ATS while Discord talks".
// Runs one PowerShell host that loads native/AudioSessions.cs (Core Audio COM) and answers
// line commands on stdin: LIST | SET <process> <volume 0-1> | MUTE <process> <0|1>.

const { spawn } = require('node:child_process');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const { saveConfigSection } = require('./config');

const LABELS = { amtrucks: 'American Truck Simulator', eurotrucks2: 'Euro Truck Simulator 2', discord: 'Discord', discordptb: 'Discord PTB', discordcanary: 'Discord Canary', spotify: 'Spotify', chrome: 'Chrome', msedge: 'Edge', firefox: 'Firefox', obs64: 'OBS Studio', 'streamlabs obs': 'Streamlabs', node: "KAW Companion", teamspeak: 'TeamSpeak', ts3client_win64: 'TeamSpeak 3', vlc: 'VLC', steam: 'Steam', steamwebhelper: 'Steam' };
const DISCORD = /^discord(ptb|canary)?$/i;
const GAME = /^(amtrucks|eurotrucks2)$/i;

class AppMixer {
  constructor({ config }) {
    const m = config.mixer || {};
    this.settings = {
      duck: { enabled: Boolean(m.duck?.enabled), level: Math.max(0.05, Math.min(0.9, Number(m.duck?.level) || 0.35)), threshold: Number(m.duck?.threshold) || 0.02, holdMs: Number(m.duck?.holdMs) || 1200 },
      presets: Array.isArray(m.presets) ? m.presets.slice(0, 12) : []
    };
    this.available = process.platform === 'win32';
    this.proc = null; this.queue = []; this.buf = ''; this.error = null;
    this.sessions = []; this.lastList = 0;
    this.gameVolume = null; this.ducked = false; this.lastVoiceAt = 0;
    if (this.available) setInterval(() => this.duckTick().catch(() => {}), 200).unref?.();
  }

  save() { try { saveConfigSection('mixer', this.settings); } catch (e) { console.error('[MIXER]', e.message); } }

  start() {
    if (this.proc || !this.available) return;
    const cs = path.join(__dirname, 'native', 'AudioSessions.cs').replace(/'/g, "''");
    const script = `$ErrorActionPreference='Stop'
try { Add-Type -TypeDefinition ([IO.File]::ReadAllText('${cs}')) -Language CSharp } catch { [Console]::Out.WriteLine('{"fatal":' + (ConvertTo-Json ([string]$_.Exception.Message)) + '}'); exit 1 }
[Console]::Out.WriteLine('{"ready":true}')
while ($true) {
  $line = [Console]::In.ReadLine(); if ($line -eq $null) { break }
  try {
    $p = $line.Split(' ', 3)
    switch ($p[0]) {
      'LIST' { [Console]::Out.WriteLine('{"ok":true,"sessions":' + [KawAudio.Sessions]::List() + '}') }
      'SET'  { [Console]::Out.WriteLine('{"ok":true,"changed":' + [KawAudio.Sessions]::Set($p[2], [float]::Parse($p[1], [Globalization.CultureInfo]::InvariantCulture), -1) + '}') }
      'MUTE' { [Console]::Out.WriteLine('{"ok":true,"changed":' + [KawAudio.Sessions]::Set($p[2], -1, [int]$p[1]) + '}') }
      default { [Console]::Out.WriteLine('{"ok":false,"error":"unknown command"}') }
    }
  } catch { [Console]::Out.WriteLine('{"ok":false,"error":' + (ConvertTo-Json ([string]$_.Exception.Message)) + '}') }
}`;
    // Run from a file so stdin stays free for commands (with -Command - PowerShell would read it too).
    const hostFile = path.join(os.tmpdir(), 'kaw-audio-host.ps1');
    try { fs.writeFileSync(hostFile, script, 'utf8'); } catch (e) { this.error = e.message; return; }
    const proc = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', hostFile], { windowsHide: true, stdio: ['pipe', 'pipe', 'ignore'] });
    this.startedAt = Date.now();
    this.proc = proc;
    proc.stdout.setEncoding('utf8');
    proc.stdout.on('data', chunk => {
      this.buf += chunk;
      let i;
      while ((i = this.buf.indexOf('\n')) >= 0) {
        const line = this.buf.slice(0, i).trim(); this.buf = this.buf.slice(i + 1);
        if (!line.startsWith('{')) continue;
        let msg; try { msg = JSON.parse(line); } catch { continue; }
        if (msg.ready) { this.error = null; continue; }
        if (msg.fatal) { this.error = `Windows audio helper failed: ${msg.fatal}`; continue; }
        const next = this.queue.shift();
        if (next) next(msg);
      }
    });
    proc.on('exit', () => { this.proc = null; for (const cb of this.queue.splice(0)) cb({ ok: false, error: 'Audio helper stopped' }); });
  }

  send(line) {
    this.start();
    if (!this.proc) return Promise.resolve({ ok: false, error: this.error || 'Not available on this system.' });
    return new Promise(resolve => {
      // The first call waits for the one-time C# compile (a few seconds).
      const timer = setTimeout(() => resolve({ ok: false, error: 'Audio helper timed out' }), Date.now() - (this.startedAt || 0) < 30000 ? 25000 : 8000);
      this.queue.push(msg => { clearTimeout(timer); resolve(msg); });
      this.proc.stdin.write(line + '\n');
    });
  }

  async list(force = false) {
    if (!force && Date.now() - this.lastList < 180) return this.sessions;
    const r = await this.send('LIST');
    if (!r.ok) { this.error = r.error; return this.sessions = []; }
    this.error = null; this.lastList = Date.now();
    return this.sessions = r.sessions || [];
  }

  // One row per app (several sessions per process are merged).
  async apps() {
    const byProc = new Map();
    for (const s of await this.list()) {
      const key = s.process.toLowerCase();
      const a = byProc.get(key) || { process: s.process, label: LABELS[key] || s.title || s.process, volume: s.volume, muted: s.muted, peak: 0, sessions: 0 };
      a.peak = Math.max(a.peak, s.peak); a.sessions++; a.muted = a.muted && s.muted;
      if (GAME.test(key) && this.ducked && this.gameVolume !== null) { a.volume = this.gameVolume; a.ducked = true; }
      byProc.set(key, a);
    }
    return [...byProc.values()].sort((a, b) => (GAME.test(b.process) - GAME.test(a.process)) || (DISCORD.test(b.process) - DISCORD.test(a.process)) || a.label.localeCompare(b.label));
  }

  async setVolume(processName, volume) {
    const v = Math.max(0, Math.min(1, Number(volume)));
    if (GAME.test(processName)) { this.gameVolume = v; if (this.ducked) return { ok: true, deferred: true }; }
    return this.send(`SET ${v.toFixed(3)} ${processName}`);
  }
  setMute(processName, muted) { return this.send(`MUTE ${muted ? 1 : 0} ${processName}`); }

  // ATS dips while anyone on Discord is talking, and comes back after a short hold.
  async duckTick() {
    const d = this.settings.duck;
    if (!d.enabled) { if (this.ducked) await this.restoreGame(); return; }
    const sessions = await this.list();
    const game = sessions.find(s => GAME.test(s.process));
    if (!game) { this.ducked = false; return; }
    const voice = Math.max(0, ...sessions.filter(s => DISCORD.test(s.process)).map(s => s.peak));
    const now = Date.now();
    if (voice > d.threshold) this.lastVoiceAt = now;
    if (!this.ducked && voice > d.threshold) {
      this.gameVolume = game.volume;
      this.ducked = true;
      await this.send(`SET ${(this.gameVolume * d.level).toFixed(3)} ${game.process}`);
    } else if (this.ducked && now - this.lastVoiceAt > d.holdMs) await this.restoreGame(game.process);
  }

  async restoreGame(processName) {
    this.ducked = false;
    const proc = processName || this.sessions.find(s => GAME.test(s.process))?.process;
    if (proc && this.gameVolume !== null) await this.send(`SET ${this.gameVolume.toFixed(3)} ${proc}`);
  }

  async savePreset(name) {
    const apps = await this.apps();
    const preset = { id: `p${Date.now().toString(36)}`, name: String(name).slice(0, 40), volumes: Object.fromEntries(apps.map(a => [a.process, a.volume])) };
    this.settings.presets = [...this.settings.presets.filter(p => p.name !== preset.name), preset].slice(-12);
    this.save();
    return preset;
  }

  async applyPreset(id) {
    const p = this.settings.presets.find(x => x.id === id);
    if (!p) throw new Error('Preset not found.');
    for (const [proc, vol] of Object.entries(p.volumes)) await this.setVolume(proc, vol);
    return p;
  }

  updateDuck(patch = {}) {
    const d = this.settings.duck;
    if (patch.enabled !== undefined) d.enabled = Boolean(patch.enabled);
    if (patch.level !== undefined) d.level = Math.max(0.05, Math.min(0.9, Number(patch.level) || 0.35));
    this.save();
    return d;
  }

  async view() {
    if (!this.available) return { available: false, sessions: [], presets: this.settings.presets, duck: this.settings.duck, note: 'App volumes are only available on Windows.' };
    const sessions = await this.apps();
    return { available: true, sessions, presets: this.settings.presets.map(({ id, name }) => ({ id, name })), duck: this.settings.duck, note: this.error ? (/No playback device|0x80070490|Element not found/i.test(this.error) ? 'No speakers or headset found on this PC.' : this.error) : null };
  }
}

module.exports = { AppMixer };
