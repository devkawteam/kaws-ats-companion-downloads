// Voice packs for the co-driver. Author: Kaw.
// "My voice": the driver records each callout in the browser. Imported packs: a folder of WAV/OGG/MP3/WebM
// files named after the callouts (fuel.wav, halfway.ogg, ...). Clips stay on this PC (data/voicepacks).
// Only use voices you own or have permission to use.
const fs = require('node:fs');
const path = require('node:path');

const DIR = path.join(process.cwd(), 'data', 'voicepacks');
const KEYS = ['hello', 'speedLimit', 'overspeed', 'miles', 'halfway', 'rest', 'fuel', 'damage', 'cargo', 'up', 'down', 'joined', 'left', 'jobStart', 'ack', 'unknown'];
const MAX_CLIP = 1.5 * 1024 * 1024;
const MAX_PACKS = 20;
const TYPES = { webm: 'audio/webm', ogg: 'audio/ogg', wav: 'audio/wav', mp3: 'audio/mpeg' };
const slug = v => String(v || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40);
const clean = (v, n) => String(v ?? '').replace(/[\u0000-\u001f<>]/g, '').trim().slice(0, n);

// Identify the audio format from its first bytes (never trust the file name alone).
function sniff(buf) {
  if (buf.length < 12) return null;
  if (buf.readUInt32BE(0) === 0x1a45dfa3) return 'webm';
  if (buf.toString('latin1', 0, 4) === 'OggS') return 'ogg';
  if (buf.toString('latin1', 0, 4) === 'RIFF' && buf.toString('latin1', 8, 12) === 'WAVE') return 'wav';
  if (buf.toString('latin1', 0, 3) === 'ID3' || (buf[0] === 0xff && (buf[1] & 0xe0) === 0xe0)) return 'mp3';
  return null;
}

// Map a file name like "Speed_Limit.wav" or "speedlimit.mp3" to a callout key.
function keyFor(fileName) {
  const base = slug(path.basename(String(fileName), path.extname(String(fileName)))).replace(/-/g, '');
  return KEYS.find(k => k.toLowerCase() === base) || null;
}

class VoicePacks {
  constructor(settings = {}) {
    this.settings = { active: slug(settings.active) || '', speakDetails: settings.speakDetails !== false };
    fs.mkdirSync(DIR, { recursive: true });
  }

  packDir(id) { const s = slug(id); if (!s) throw new Error('Choose a voice pack.'); return path.join(DIR, s); }

  meta(id) {
    try { return JSON.parse(fs.readFileSync(path.join(this.packDir(id), 'pack.json'), 'utf8')); } catch { return null; }
  }

  ensurePack(id, name, author = '') {
    const dir = this.packDir(id);
    if (!fs.existsSync(dir)) {
      if (this.list().length >= MAX_PACKS) throw new Error(`You can keep up to ${MAX_PACKS} voice packs. Delete one first.`);
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(path.join(dir, 'pack.json'), JSON.stringify({ id: slug(id), name: clean(name, 60) || slug(id), author: clean(author, 60), createdAt: new Date().toISOString() }, null, 2));
    }
    return dir;
  }

  list() {
    let ids = [];
    try { ids = fs.readdirSync(DIR, { withFileTypes: true }).filter(d => d.isDirectory()).map(d => d.name); } catch {}
    return ids.map(id => {
      const meta = this.meta(id) || { id, name: id };
      const clips = {};
      for (const f of fs.readdirSync(path.join(DIR, id))) {
        const m = /^([a-zA-Z]+)\.(webm|ogg|wav|mp3)$/.exec(f);
        if (m && KEYS.includes(m[1])) { const st = fs.statSync(path.join(DIR, id, f)); clips[m[1]] = { ext: m[2], size: st.size, updatedAt: st.mtime.toISOString() }; }
      }
      return { id, name: meta.name || id, author: meta.author || '', clips, count: Object.keys(clips).length };
    }).sort((a, b) => (a.id === 'my-voice' ? -1 : b.id === 'my-voice' ? 1 : a.name.localeCompare(b.name)));
  }

  saveClip(packId, key, base64, name = '') {
    if (!KEYS.includes(key)) throw new Error('Unknown callout.');
    if (typeof base64 !== 'string' || !/^[A-Za-z0-9+/]*={0,2}$/.test(base64)) throw new Error('Recording is not valid audio.');
    const buf = Buffer.from(base64, 'base64');
    if (buf.length > MAX_CLIP) throw new Error('Clip is too long. Keep it under about 8 seconds.');
    const ext = sniff(buf);
    if (!ext) throw new Error('Use a WAV, OGG, MP3 or WebM audio clip.');
    const dir = this.ensurePack(packId, name || (slug(packId) === 'my-voice' ? 'My voice' : packId));
    for (const e of Object.keys(TYPES)) { try { fs.unlinkSync(path.join(dir, `${key}.${e}`)); } catch {} }
    fs.writeFileSync(path.join(dir, `${key}.${ext}`), buf);
    return { key, ext, size: buf.length };
  }

  deleteClip(packId, key) {
    const dir = this.packDir(packId);
    if (key) {
      if (!KEYS.includes(key)) throw new Error('Unknown callout.');
      for (const e of Object.keys(TYPES)) { try { fs.unlinkSync(path.join(dir, `${key}.${e}`)); } catch {} }
    } else {
      fs.rmSync(dir, { recursive: true, force: true });
      if (this.settings.active === slug(packId)) this.settings.active = '';
    }
    return this.list();
  }

  // files: [{ name, audio(base64) }]
  importPack(name, author, files = []) {
    const id = slug(name);
    if (!id || id === 'my-voice') throw new Error('Give the pack a name (not "My voice").');
    if (!Array.isArray(files) || !files.length) throw new Error('Choose the audio files of the pack.');
    if (files.length > 60) throw new Error('A pack can have at most 60 files.');
    const imported = [], skipped = [];
    this.ensurePack(id, name, author);
    for (const f of files) {
      const key = keyFor(f?.name);
      if (!key) { skipped.push(`${clean(f?.name, 60)} (name doesn't match a callout)`); continue; }
      try { this.saveClip(id, key, f.audio, name); imported.push(key); } catch (e) { skipped.push(`${clean(f?.name, 60)} (${e.message})`); }
    }
    if (!imported.length) { this.deleteClip(id); throw new Error(`No clips matched. Name files after the callouts, e.g. fuel.wav, halfway.mp3. Skipped: ${skipped.slice(0, 5).join(', ')}`); }
    return { id, imported, skipped };
  }

  clip(packId, key) {
    if (!KEYS.includes(key)) return null;
    const dir = this.packDir(packId);
    for (const [ext, type] of Object.entries(TYPES)) {
      const file = path.join(dir, `${key}.${ext}`);
      if (fs.existsSync(file)) return { body: fs.readFileSync(file), type };
    }
    return null;
  }

  update(patch = {}) {
    if (patch.active !== undefined) {
      const id = slug(patch.active);
      if (id && !this.list().some(p => p.id === id)) throw new Error('That voice pack does not exist.');
      this.settings.active = id;
    }
    if (patch.speakDetails !== undefined) this.settings.speakDetails = Boolean(patch.speakDetails);
    return this.settings;
  }

  view() { return { ...this.settings, keys: KEYS, packs: this.list() }; }
}

module.exports = { VoicePacks, KEYS, sniff, keyFor };
