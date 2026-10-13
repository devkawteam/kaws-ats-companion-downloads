/* Truck setup cards: a short share code (KAWSETUP1.<base64url JSON>) that friends paste to see your rig.
   Only truck/trailer/build facts and a note — never your licence plate, position or account details.
   Works in the browser (window.KAWSetupCard) and in Node (tests). Author: Kaw. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.KAWSetupCard = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';
  const PREFIX = 'KAWSETUP1.';
  const MAX_CODE = 6000;
  const str = (v, n = 80) => String(v ?? '').replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, n);
  const numOrNull = (v, lo, hi) => { const x = Number(v); return Number.isFinite(x) && x >= lo && x <= hi ? Math.round(x * 1000) / 1000 : null; };
  const FIELDS = {
    truck: { make: 40, model: 60, transmission: 40 },
    trailer: { brand: 40, name: 60, chain: 40 },
    build: { engine: 80, hp: 20, torque: 20, transmission: 80, brakes: 80, chassis: 80, tyres: 80, lights: 80 }
  };

  function normalize(c) {
    c = c && typeof c === 'object' ? c : {};
    const out = { v: 1, driver: str(c.driver, 40), title: str(c.title, 60), note: str(c.note, 300), livery: str(c.livery, 60), created: str(c.created, 30) };
    for (const [group, fields] of Object.entries(FIELDS)) {
      out[group] = {};
      for (const [k, n] of Object.entries(fields)) { const v = str(c[group]?.[k], n); if (v) out[group][k] = v; }
    }
    const gears = numOrNull(c.truck?.gears, 1, 30), diff = numOrNull(c.truck?.diff, 1, 10), wheels = numOrNull(c.truck?.wheels, 2, 24), twheels = numOrNull(c.trailer?.wheels, 2, 60);
    if (gears !== null) out.truck.gears = gears; if (diff !== null) out.truck.diff = diff; if (wheels !== null) out.truck.wheels = wheels; if (twheels !== null) out.trailer.wheels = twheels;
    return out;
  }

  // Build my card from live telemetry + the "Under the Hood" build profile.
  function fromTelemetry(d, extra = {}) {
    d = d || {};
    const b = d.buildProfile || {};
    return normalize({
      driver: extra.driver ?? d.driverName, title: extra.title, note: extra.note, livery: extra.livery, created: new Date().toISOString(),
      truck: { make: d.truck?.make, model: d.truck?.model, transmission: d.truck?.transmissionType, gears: d.truck?.forwardGears, diff: d.truck?.differentialRatio, wheels: d.truck?.wheelCount },
      trailer: d.trailer?.attached ? { brand: d.trailer.brand, name: d.trailer.name, chain: d.trailer.chainType, wheels: d.trailer.wheelCount } : {},
      build: { engine: b.engine, hp: b.hp, torque: b.torque, transmission: b.transmission, brakes: b.brakes, chassis: b.chassis, tyres: b.tyres, lights: b.lights }
    });
  }

  const b64 = {
    enc(s) { const bytes = new TextEncoder().encode(s); let bin = ''; for (const x of bytes) bin += String.fromCharCode(x); return (typeof btoa === 'function' ? btoa(bin) : Buffer.from(bin, 'binary').toString('base64')).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''); },
    dec(s) { const t = s.replace(/-/g, '+').replace(/_/g, '/'); const bin = typeof atob === 'function' ? atob(t) : Buffer.from(t, 'base64').toString('binary'); return new TextDecoder('utf-8', { fatal: true }).decode(Uint8Array.from(bin, ch => ch.charCodeAt(0))); }
  };

  function encode(card) { return PREFIX + b64.enc(JSON.stringify(normalize(card))); }
  function decode(code) {
    const s = String(code || '').trim().replace(/\s+/g, '');
    const at = s.indexOf(PREFIX);
    if (at < 0) throw new Error('That is not a KAW setup code (it starts with KAWSETUP1.).');
    const body = s.slice(at + PREFIX.length);
    if (body.length > MAX_CODE || !/^[A-Za-z0-9_-]+$/.test(body)) throw new Error('That setup code is damaged or too long.');
    let raw;
    try { raw = JSON.parse(b64.dec(body)); } catch { throw new Error('That setup code is damaged.'); }
    if (raw?.v !== 1) throw new Error('This setup code is from a newer Companion. Update to read it.');
    return normalize(raw);
  }

  // Side-by-side rows; `same` marks matching values.
  const LABELS = { 'truck.make': 'Truck make', 'truck.model': 'Model', 'truck.transmission': 'Transmission type', 'truck.gears': 'Forward gears', 'truck.diff': 'Differential ratio', 'truck.wheels': 'Truck wheels', 'trailer.brand': 'Trailer brand', 'trailer.name': 'Trailer', 'trailer.chain': 'Trailer chain', 'trailer.wheels': 'Trailer wheels', 'build.engine': 'Engine', 'build.hp': 'Horsepower', 'build.torque': 'Torque', 'build.transmission': 'Gearbox', 'build.brakes': 'Brakes', 'build.chassis': 'Chassis', 'build.tyres': 'Tyres', 'build.lights': 'Lights', livery: 'Paint job' };
  function compare(mine, theirs) {
    const get = (c, k) => k.split('.').reduce((o, p) => (o == null ? o : o[p]), c);
    return Object.entries(LABELS).map(([k, label]) => { const a = get(mine, k) ?? '', b = get(theirs, k) ?? ''; return { key: k, label, mine: a, theirs: b, same: String(a).toLowerCase() === String(b).toLowerCase() }; }).filter(r => r.mine !== '' || r.theirs !== '');
  }

  return { encode, decode, normalize, fromTelemetry, compare, LABELS, PREFIX };
});
