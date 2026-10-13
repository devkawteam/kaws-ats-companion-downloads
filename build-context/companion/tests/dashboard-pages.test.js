// Dashboard page structure. Regression for 6949e8b, where a truncated tool read
// ("Warning: truncated output ...") was saved over public/index.html and removed the page body
// with all 16 built-in page sections while the other tests still passed.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const html = fs.readFileSync(path.join(__dirname, '..', 'public', 'index.html'), 'utf8');
const BUILT_IN_PAGES = ['drive', 'studio', 'commands', 'intelligence', 'convoy', 'radar', 'radio', 'navigation', 'truck', 'hood', 'shift', 'trips', 'stats', 'mods', 'suggestions', 'settings'];

test('index.html is a complete document, not a saved tool output', () => {
  assert.doesNotMatch(html, /truncated output|Total output lines:|original token count/i);
  assert.match(html.trimStart(), /^<!doctype html>/i);
  assert.match(html, /<body[\s>]/i);
  assert.match(html, /<\/body>\s*<\/html>\s*$/i);
});

test('all 16 built-in page sections exist exactly once', () => {
  for (const page of BUILT_IN_PAGES) {
    const count = html.split(`<section id="page-${page}"`).length - 1;
    assert.equal(count, 1, `page-${page} should appear once (found ${count})`);
  }
});

test('navigation groups only reference pages that exist or are registered by modules', () => {
  const v16 = fs.readFileSync(path.join(__dirname, '..', 'public', 'app-v16.js'), 'utf8');
  const groups = [...v16.matchAll(/\['(?:Drive|Work|Convoy|Stream|Setup)', \[([^\]]*)\]\]/g)].flatMap(m => [...m[1].matchAll(/'([a-z-]+)'/g)].map(x => x[1]));
  // Pages app-v16.js builds itself (NEW_PAGES) plus pages other modules register with K.pages.push({ name }).
  const corePages = [...(v16.match(/const NEW_PAGES = \{([\s\S]*?)\};/)?.[1] || '').matchAll(/^\s*([a-z-]+):/gm)].map(m => m[1]);
  const modulePages = [...corePages, ...fs.readdirSync(path.join(__dirname, '..', 'public')).filter(f => /^app-.*\.js$/.test(f))
    .flatMap(f => [...fs.readFileSync(path.join(__dirname, '..', 'public', f), 'utf8').matchAll(/name: '([a-z-]+)'/g)].map(m => m[1]))];
  for (const page of groups) {
    assert.ok(html.includes(`<section id="page-${page}"`) || modulePages.includes(page), `nav page "${page}" has no section or module`);
  }
});

test('every Devices & Screens choice opens an existing dashboard page', () => {
  const { SCREENS } = require('../src/deviceHub');
  assert.deepEqual(Object.keys(SCREENS), ['drive', 'navigation', 'truck', 'radar', 'shift', 'stats']);
  for (const screen of Object.keys(SCREENS)) assert.ok(html.includes(`<section id="page-${screen}"`), `screen "${screen}" has no page section`);
});

test('Devices & Screens loads after the QR library and the core module', () => {
  const order = name => html.indexOf(`<script src="/${name}" defer></script>`);
  for (const s of ['app-v16.js', 'vendor/qrcode.min.js', 'app-devices.js']) assert.ok(order(s) > 0, `${s} script tag missing`);
  assert.ok(order('app-v16.js') < order('app-devices.js'), 'app-devices.js must load after app-v16.js');
  assert.ok(order('vendor/qrcode.min.js') < order('app-devices.js'), 'qrcode.min.js must load before app-devices.js');
});

test('Livery Wizard scripts load in order after the dashboard core', () => {
  const html = fs.readFileSync(path.join(__dirname, '..', 'public', 'index.html'), 'utf8');
  const order = name => html.indexOf(`<script src="/${name}" defer></script>`);
  const list = ['app-v16.js', 'livery/livery-core.js', 'livery/livery-render.js', 'app-livery.js'];
  for (const s of list) assert.ok(order(s) > 0, `${s} script tag missing`);
  for (let i = 1; i < list.length; i++) assert.ok(order(list[i - 1]) < order(list[i]), `${list[i - 1]} must load before ${list[i]}`);
  const sw = fs.readFileSync(path.join(__dirname, '..', 'public', 'sw.js'), 'utf8');
  for (const f of ['/app-livery.js', '/livery/livery-core.js', '/livery/livery-render.js', '/livery/livery-worker.js', '/livery/vehicles.json']) assert.ok(sw.includes(`'${f}'`), `${f} missing from offline cache`);
});
