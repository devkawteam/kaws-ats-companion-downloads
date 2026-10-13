// Things the driver asked Jarvis to remember. Stored only on this PC (data/jarvis-memory.json), sent with
// each Jarvis chat, and fully under the driver's control: view, edit, delete, forget all. Author: Kaw.
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const MAX_ITEMS = 12, MAX_CHARS = 120;
// Refuse things that look sensitive: Jarvis is a public assistant.
const SENSITIVE = [
  [/[\w.+-]+@[\w-]+\.[\w.]+/, 'an email address'],
  [/(\+?\d[\s().-]?){9,}/, 'a phone or card number'],
  [/\b(password|passcode|pin code|pin is|api key|token|secret|social security|ssn|credit card|bank account)\b/i, 'passwords, keys or account details'],
  [/\b\d{1,5}\s+\w+(\s\w+)?\s+(street|st|avenue|ave|road|rd|lane|ln|drive|dr|court|ct|boulevard|blvd)\b/i, 'a street address']
];
const clean = v => String(v ?? '').replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim();

function check(text) {
  const t = clean(text).replace(/^(that|to remember that)\s+/i, '');
  if (!t) throw new Error('Tell Jarvis what to remember.');
  if (t.length > MAX_CHARS) throw new Error(`Keep it short (${MAX_CHARS} characters max).`);
  for (const [re, what] of SENSITIVE) if (re.test(t)) throw new Error(`For your privacy Jarvis won't save ${what}.`);
  return t;
}

class JarvisMemory {
  constructor(file = path.join(process.cwd(), 'data', 'jarvis-memory.json')) {
    this.file = file;
    try { const d = JSON.parse(fs.readFileSync(file, 'utf8')); this.items = (Array.isArray(d.items) ? d.items : []).filter(x => x && typeof x.text === 'string').slice(0, MAX_ITEMS); } catch { this.items = []; }
  }
  save() { fs.mkdirSync(path.dirname(this.file), { recursive: true }); fs.writeFileSync(this.file, JSON.stringify({ items: this.items }, null, 2)); }
  list() { return this.items.map(x => ({ ...x })); }
  texts() { return this.items.map(x => x.text); }
  add(text) {
    const t = check(text);
    if (this.items.some(x => x.text.toLowerCase() === t.toLowerCase())) return this.items.find(x => x.text.toLowerCase() === t.toLowerCase());
    if (this.items.length >= MAX_ITEMS) throw new Error(`Jarvis can remember ${MAX_ITEMS} things. Delete one first.`);
    const item = { id: `m_${crypto.randomBytes(5).toString('hex')}`, text: t, savedAt: new Date().toISOString() };
    this.items.push(item); this.save();
    return item;
  }
  update(id, text) {
    const item = this.items.find(x => x.id === id);
    if (!item) throw new Error('That memory no longer exists.');
    item.text = check(text); item.savedAt = new Date().toISOString(); this.save();
    return item;
  }
  remove(id) { const n = this.items.length; this.items = this.items.filter(x => x.id !== id); if (n !== this.items.length) this.save(); return n !== this.items.length; }
  clear() { this.items = []; this.save(); }
}

module.exports = { JarvisMemory, check, MAX_ITEMS, MAX_CHARS };
