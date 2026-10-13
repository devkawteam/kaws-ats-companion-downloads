// v1.7 final checks: radio shortcut migration, no blocked defaults left, optional voice engine packaging.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { migrateRadioShortcut, DEFAULT_RELAY } = require('../src/relayDefaults');
const tools = f => path.join(__dirname, '..', 'tools', f);

test('old desktop radio shortcut moves to the working relay; other shortcuts are untouched', () => {
  const a = fs.mkdtempSync(path.join(os.tmpdir(), 'kaw-desk-')), b = fs.mkdtempSync(path.join(os.tmpdir(), 'kaw-desk-'));
  fs.writeFileSync(path.join(a, "KAW'S Radio.url"), '[InternetShortcut]\r\nURL=https://ats.kawsplayground.online/radio\r\n');
  fs.writeFileSync(path.join(b, "KAW'S Radio.url"), '[InternetShortcut]\r\nURL=https://my-own-relay.example/radio\r\n');
  const fixed = migrateRadioShortcut([a, b, path.join(a, 'missing')]);
  assert.equal(fixed.length, 1);
  assert.match(fs.readFileSync(path.join(a, "KAW'S Radio.url"), 'utf8'), new RegExp(`URL=${DEFAULT_RELAY.replace(/[.]/g, '\\.')}/radio`));
  assert.match(fs.readFileSync(path.join(b, "KAW'S Radio.url"), 'utf8'), /my-own-relay/);
  assert.equal(migrateRadioShortcut([a]).length, 0, 'runs once');
});

test('no shipped page or default still points at the blocked address', () => {
  const html = fs.readFileSync(path.join(__dirname, '..', 'public', 'index.html'), 'utf8');
  assert.doesNotMatch(html, /ats\.kawsplayground\.online/);
  assert.doesNotMatch(fs.readFileSync(path.join(__dirname, '..', 'config.example.json'), 'utf8'), /ats\.kawsplayground\.online/);
});

test('voice engine manager: ASCII-only for Windows PowerShell 5.1, pinned hashes, verified models, safe stop', () => {
  const ps = fs.readFileSync(tools('kaw-local-voices.ps1'), 'utf8');
  assert.ok([...ps].every(c => c.charCodeAt(0) < 128), 'PowerShell 5.1 reads BOM-less files as ANSI');
  for (const a of ['Install', 'Verify', 'Start', 'Stop', 'Status', 'Restart', 'Autostart', 'Uninstall']) assert.match(ps, new RegExp(`'${a}'`));
  assert.match(ps, /--require-hashes/); assert.match(ps, /--only-binary=:all:/);
  assert.match(ps, /7d5df8ecf7d4b1878015a32686053fd0eebe2bc377234608764cc0ef3636a6c5/); assert.match(ps, /bca610b8308e8d99f32e6fe4197e7ec01679264efed0cac9140fe9c29f1fbf7d/);
  assert.match(ps, /local-voices\\\.py/, 'Stop only stops the engine process');
  assert.match(ps, /not starting a second listener/);
  assert.match(ps, /Re-run with -Yes/);
  const req = fs.readFileSync(tools('local-voices-requirements.txt'), 'utf8').split('\n').filter(l => l && !l.startsWith('#'));
  assert.ok(req.length >= 10 && req.every(l => /^[a-z0-9-]+==[^ ]+ --hash=sha256:[0-9a-f]{64}$/.test(l.trim())), 'every package pinned with a hash');
  assert.ok(req.some(l => l.startsWith('kokoro-onnx==0.6.1 ')));
  const lic = fs.readFileSync(tools('LOCAL-VOICES-LICENSES.md'), 'utf8');
  for (const s of ['Apache-2.0', 'kokoro-onnx', 'MIT', 'GPL-3.0-or-later', 'espeak-ng', 'phonemizer']) assert.ok(lic.includes(s), s);
  const py = fs.readFileSync(tools('local-voices.py'), 'utf8');
  assert.match(py, /\('127\.0\.0\.1',4312\)/, 'loopback only'); assert.match(py, /def log_message\(self, \*args\): pass/, 'no text logging');
});
