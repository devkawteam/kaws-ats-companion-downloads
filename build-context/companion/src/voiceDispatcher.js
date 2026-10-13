const { spawn } = require('node:child_process');

class VoiceDispatcher {
  constructor(settings = {}) {
    this.settings = { enabled: false, rate: 0, volume: 85, prefix: 'KAW Dispatch', ...settings };
    this.last = new Map();
  }
  speak(message, key = message, cooldownMs = 5000) {
    if (!this.settings.enabled || this.settings.promptSource === 'game' || process.platform !== 'win32') return false;
    const now = Date.now(); if (now - (this.last.get(key) || 0) < cooldownMs) return false; this.last.set(key, now);
    const text = `${this.settings.prefix ? `${this.settings.prefix}. ` : ''}${String(message || '')}`.slice(0, 500);
    const encoded = Buffer.from(text, 'utf16le').toString('base64');
    const script = `$s=New-Object System.Speech.Synthesis.SpeechSynthesizer;$s.Rate=${Math.max(-10,Math.min(10,Number(this.settings.rate)||0))};$s.Volume=${Math.max(0,Math.min(100,Number(this.settings.volume)||85))};$s.Speak([Text.Encoding]::Unicode.GetString([Convert]::FromBase64String('${encoded}')))`;
    const child = spawn('powershell.exe', ['-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass','-Command',script], { windowsHide:true, stdio:'ignore' });
    child.on('error', e => console.error('[VOICE]', e.message)); return true;
  }
}
module.exports = { VoiceDispatcher };
