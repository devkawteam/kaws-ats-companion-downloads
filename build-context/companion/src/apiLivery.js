// KAW Livery Wizard: save a finished paint-job ZIP into the ATS mod folder, the AI design helper
// (your local Ollama), and an optional proxy to a Stable Diffusion WebUI already running on this PC
// (only shown when one is detected). Local PC only. Author: Kaw.
const fs = require('node:fs');
const path = require('node:path');
const { json, readBody } = require('./apiDrive');
const { trustedLocal } = require('./apiAi');
const { saveConfigSection } = require('./config');
const { documentsRoot } = require('./localScanner');

const MAX_ZIP = 768 * 1024 * 1024;
const OLLAMA = 'http://127.0.0.1:11434';

// ---- AI design helper: the driver's own local AI (Ollama) turns a description into Livery Wizard
// layers (background, stripes, patterns, text). Free and on this PC; no image model needed. ----
const DESIGN_SYSTEM = `You design truck paint jobs for American Truck Simulator. Reply with JSON only, shaped {"layers":[...]}, bottom layer first, 2 to 7 layers.
Coordinates x and y run 0..1 across the texture (0,0 is the top-left). Sizes are fractions of the texture height. Colours are "#rrggbb".
Layer types (use only these keys):
{"type":"fill","mode":"solid"|"linear"|"radial","c1":"#..","c2":"#..","angle":0-360}
{"type":"stripe","color":"#..","x":0.5,"y":0.6,"width":0.01-0.2,"length":0.2-1.5,"angle":-45-45,"count":1-6,"gap":0.005-0.05}
{"type":"pattern","kind":"camo"|"carbon"|"flames"|"checker"|"chevrons","c1":"#..","c2":"#..","c3":"#..","scale":0.03-0.3,"seed":1-999,"angle":0,"opacity":0.3-1}
{"type":"text","text":"...","font":"Arial Black"|"Impact"|"Arial"|"Georgia"|"Trebuchet MS"|"Verdana","size":0.05-0.25,"color":"#..","outline":"#..","outlineWidth":0-0.25,"x":0.5,"y":0.5,"angle":0}
Always start with a fill. Add text only when the user asks for words or a name. Make it look good: strong contrast, 2-3 main colours.`;
const Render = require('../public/livery/livery-render');

async function designWithAi(prompt, settings = {}, fetchFn = fetch) {
  const text = String(prompt || '').replace(/[\u0000-\u001f]/g, ' ').trim().slice(0, 500);
  if (!text) throw new Error('Describe the paint job first.');
  let r;
  try {
    r = await fetchFn(`${OLLAMA}/api/chat`, {
      method: 'POST', redirect: 'error', headers: { 'content-type': 'application/json' }, signal: AbortSignal.timeout(Math.max(30, Number(settings.timeoutSeconds) || 60) * 1000 * 2),
      body: JSON.stringify({ model: settings.model || 'qwen3:8b', stream: false, think: false, format: 'json', keep_alive: '2m', options: { temperature: 0.7, num_predict: 900, num_ctx: 4096 },
        messages: [{ role: 'system', content: DESIGN_SYSTEM }, { role: 'user', content: `Paint job: ${text}` }] })
    });
  } catch (e) {
    if (e.name === 'TimeoutError' || e.name === 'AbortError') throw new Error('Your local AI took too long. Try again, or pick a smaller model in Co-Driver settings.');
    throw new Error('Your local AI (Ollama) is not running. Start Ollama on this PC, then try again.');
  }
  if (!r.ok) throw new Error(r.status === 404 ? `The AI model "${settings.model || 'qwen3:8b'}" is not installed in Ollama. Pick an installed model in Co-Driver settings.` : `Ollama answered HTTP ${r.status}.`);
  const body = await r.json();
  let raw;
  try { raw = JSON.parse(String(body.message?.content || '').replace(/<think>[\s\S]*?<\/think>/gi, '').trim()); } catch { throw new Error('The AI answer was not a design. Try again or describe it differently.'); }
  const design = Render.normalizeDesign({ layers: Array.isArray(raw) ? raw : raw.layers });
  if (!design.layers.length) throw new Error('The AI did not return any usable layers. Try again or describe it differently.');
  return design.layers.slice(0, 8);
}
const SD_DEFAULT = 'http://127.0.0.1:7860';

// Only plain file names, always .zip, never a path.
function safeZipName(name) {
  const base = String(name || '').replace(/\.zip$/i, '').replace(/[^A-Za-z0-9 _.()-]/g, '').replace(/^[. ]+|[. ]+$/g, '').slice(0, 80);
  return base ? `${base}.zip` : null;
}

// The Stable Diffusion server must be on this PC; nothing is sent elsewhere.
function localSdUrl(raw) {
  try {
    const u = new URL(raw || SD_DEFAULT);
    if (u.protocol !== 'http:' || !['127.0.0.1', 'localhost', '[::1]'].includes(u.hostname)) return null;
    return u.origin;
  } catch { return null; }
}

// ---- Gallery: saved Livery Wizard projects in data/liveries/<id>.json, with a small JPEG thumbnail ----
const MAX_PROJECT = 40 * 1024 * 1024;
const galleryId = v => (/^lv_[a-z0-9]{6,24}$/.test(String(v || '')) ? String(v) : null);
function readJson(req, limit) {
  return new Promise((resolve, reject) => {
    const chunks = []; let size = 0;
    req.on('data', c => { size += c.length; if (size > limit) { reject(new Error('That project is too large (40 MB max).')); req.destroy(); } else chunks.push(c); });
    req.on('end', () => { try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}')); } catch { reject(new Error('That is not a valid project.')); } });
    req.on('error', reject);
  });
}
class LiveryGallery {
  constructor(dir = path.join(process.cwd(), 'data', 'liveries')) { this.dir = dir; }
  file(id) { const ok = galleryId(id); return ok ? path.join(this.dir, `${ok}.json`) : null; }
  list() {
    let names = [];
    try { names = fs.readdirSync(this.dir).filter(n => /^lv_[a-z0-9]+\.json$/.test(n)); } catch {}
    return names.map(n => { try { const d = JSON.parse(fs.readFileSync(path.join(this.dir, n), 'utf8')); return { id: d.id, name: d.name, author: d.author, vehicles: d.vehicles, savedAt: d.savedAt, thumb: d.thumb }; } catch { return null; } })
      .filter(Boolean).sort((a, b) => String(b.savedAt).localeCompare(String(a.savedAt)));
  }
  get(id) { const f = this.file(id); if (!f || !fs.existsSync(f)) return null; return JSON.parse(fs.readFileSync(f, 'utf8')); }
  save(body) {
    const project = body?.project;
    if (!project || typeof project !== 'object' || typeof project.designs !== 'object') throw new Error('That is not a Livery Wizard project.');
    const thumb = /^data:image\/(jpeg|png);base64,[A-Za-z0-9+/=]+$/.test(body.thumb || '') && body.thumb.length < 400000 ? body.thumb : null;
    const id = galleryId(body.id) && fs.existsSync(this.file(body.id)) ? body.id : `lv_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
    const entry = { id, name: String(project.name || 'Paint job').slice(0, 60), author: String(project.author || '').slice(0, 60), vehicles: (Array.isArray(project.vehicles) ? project.vehicles : []).slice(0, 40).map(v => String(v).slice(0, 60)), savedAt: new Date().toISOString(), thumb, project };
    fs.mkdirSync(this.dir, { recursive: true });
    fs.writeFileSync(this.file(id), JSON.stringify(entry));
    return { id, name: entry.name, savedAt: entry.savedAt };
  }
  remove(id) { const f = this.file(id); if (!f || !fs.existsSync(f)) return false; fs.rmSync(f); return true; }
}

// Stream the upload to a temp file, check it is a ZIP, then move it into place.
function receiveZip(req, target, overwrite) {
  return new Promise((resolve, reject) => {
    const tmp = `${target}.${process.pid}.part`;
    const out = fs.createWriteStream(tmp, { flags: 'wx' });
    let size = 0, head = Buffer.alloc(0), failed = false;
    const fail = e => { if (failed) return; failed = true; req.unpipe?.(out); out.destroy(); fs.rm(tmp, { force: true }, () => reject(e)); };
    req.on('data', c => {
      size += c.length;
      if (head.length < 4) head = Buffer.concat([head, c]).subarray(0, 4);
      if (size > MAX_ZIP) { fail(new Error('The paint job is larger than 768 MB.')); req.destroy(); }
    });
    req.on('error', fail);
    out.on('error', fail);
    out.on('finish', () => {
      if (failed) return;
      if (head.toString('hex') !== '504b0304') return fail(new Error('That is not a ZIP file.'));
      if (!overwrite && fs.existsSync(target)) return fail(new Error('A mod with that name already exists.'));
      fs.rename(tmp, target, e => e ? fail(e) : resolve(size));
    });
    req.pipe(out);
  });
}

async function handleLivery(req, res, url, s = {}) {
  if (!url.pathname.startsWith('/api/livery/')) return false;
  if (!trustedLocal(req)) return json(res, { ok: false, error: 'Use the Livery Wizard on the PC running the Companion (http://127.0.0.1).' }, 403);
  const modDir = s.modDir || path.join(documentsRoot('ATS'), 'mod');
  const sd = localSdUrl(s.config?.livery?.sdUrl);
  try {
    if (url.pathname === '/api/livery/status' && req.method === 'GET') {
      let sdReachable = false;
      if (sd) sdReachable = await fetch(`${sd}/sdapi/v1/options`, { signal: AbortSignal.timeout(1500) }).then(r => r.ok, () => false);
      return json(res, { ok: true, modDir, modDirExists: fs.existsSync(modDir), sd: { url: sd, reachable: sdReachable } });
    }
    if (url.pathname === '/api/livery/design' && req.method === 'POST') {
      const b = await readBody(req);
      return json(res, { ok: true, layers: await designWithAi(b.prompt, s.ai?.settings || s.config?.ai || {}, s.fetchImpl || fetch) });
    }
    if (url.pathname === '/api/livery/settings' && req.method === 'POST') {
      const b = await readBody(req);
      const next = localSdUrl(b.sdUrl);
      if (!next) return json(res, { ok: false, error: 'Use an http://127.0.0.1 address for Stable Diffusion.' }, 400);
      saveConfigSection('livery', { sdUrl: next });
      if (s.config) s.config.livery = { sdUrl: next };
      return json(res, { ok: true, sdUrl: next });
    }
    const gallery = s.liveryGallery || (s.liveryGallery = new LiveryGallery(s.galleryDir));
    if (url.pathname === '/api/livery/gallery' && req.method === 'GET') return json(res, { ok: true, items: gallery.list() });
    if (url.pathname === '/api/livery/gallery/item' && req.method === 'GET') { const item = gallery.get(url.searchParams.get('id')); return item ? json(res, { ok: true, item }) : json(res, { ok: false, error: 'Not found.' }, 404); }
    if (url.pathname === '/api/livery/gallery' && req.method === 'POST') return json(res, { ok: true, ...gallery.save(await readJson(req, MAX_PROJECT)) });
    if (url.pathname === '/api/livery/gallery/delete' && req.method === 'POST') { const b = await readBody(req); return json(res, { ok: gallery.remove(b.id) }); }
    if (url.pathname === '/api/livery/install' && req.method === 'POST') {
      const name = safeZipName(url.searchParams.get('name'));
      if (!name) return json(res, { ok: false, error: 'Give the paint job a name first.' }, 400);
      if (!String(req.headers['content-type'] || '').startsWith('application/zip')) return json(res, { ok: false, error: 'Send the ZIP as application/zip.' }, 415);
      if (!fs.existsSync(modDir)) return json(res, { ok: false, error: `ATS mod folder not found: ${modDir}. Start ATS once, or download the ZIP instead.` }, 404);
      const target = path.join(modDir, name);
      const bytes = await receiveZip(req, target, url.searchParams.get('overwrite') === '1');
      return json(res, { ok: true, path: target, bytes });
    }
    if (url.pathname === '/api/livery/sd' && req.method === 'POST') {
      if (!sd) return json(res, { ok: false, error: 'The Stable Diffusion address must be on this PC (127.0.0.1).' }, 400);
      const b = await readBody(req);
      const prompt = String(b.prompt || '').slice(0, 600).trim();
      if (!prompt) return json(res, { ok: false, error: 'Describe the pattern first.' }, 400);
      const size = n => Math.max(256, Math.min(1024, Math.round((Number(n) || 512) / 64) * 64));
      const r = await fetch(`${sd}/sdapi/v1/txt2img`, {
        method: 'POST', redirect: 'error', signal: AbortSignal.timeout(180000), headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ prompt, negative_prompt: String(b.negative || 'text, watermark, logo, signature').slice(0, 300), width: size(b.width), height: size(b.height), steps: Math.max(10, Math.min(40, Number(b.steps) || 22)), seed: Number.isInteger(b.seed) ? b.seed : -1, tiling: b.tiling !== false, batch_size: 1 })
      });
      if (!r.ok) return json(res, { ok: false, error: `Stable Diffusion answered HTTP ${r.status}. Start it with --api.` }, 502);
      const out = await r.json();
      const image = out.images?.[0];
      if (typeof image !== 'string') return json(res, { ok: false, error: 'Stable Diffusion returned no image.' }, 502);
      return json(res, { ok: true, image: `data:image/png;base64,${image.replace(/^data:[^,]+,/, '')}` });
    }
    return false;
  } catch (e) {
    const offline = url.pathname === '/api/livery/sd' && /fetch failed|ECONNREFUSED|timeout/i.test(e.message);
    return json(res, { ok: false, error: offline ? 'Stable Diffusion WebUI is not running on this PC. Use the AI design helper or the built-in patterns instead.' : e.message }, offline ? 503 : 400);
  }
}

module.exports = { handleLivery, safeZipName, localSdUrl, LiveryGallery, designWithAi };
