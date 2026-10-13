// Fun layer: daily challenges, milestones, delivery celebrations, convoy participation (for convoy
// achievements) and the convoy photo wall. Produces "moments" the dashboard celebrates (confetti +
// co-driver voice) and optionally posts to Discord.

const fs = require('node:fs');
const path = require('node:path');
const { findCity, stateAt } = require('./mapCalibration');

const FILE = path.join(process.cwd(), 'data', 'fun.json');
const num = v => (Number.isFinite(Number(v)) ? Number(v) : 0);
const today = (d = new Date()) => d.toLocaleDateString('en-CA');

// Challenge pool. `progress(ctx)` returns { value, target }.
const POOL = [
  { id: 'miles300', title: 'Road warrior', text: 'Drive 300 miles today', xp: 150, progress: c => ({ value: c.miles, target: 300 }) },
  { id: 'miles600', title: 'Iron butt', text: 'Drive 600 miles today', xp: 300, progress: c => ({ value: c.miles, target: 600 }) },
  { id: 'clean3', title: 'Handle with care', text: 'Deliver 3 loads with 1% damage or less', xp: 200, progress: c => ({ value: c.clean, target: 3 }) },
  { id: 'nospeed2', title: 'By the book', text: 'Deliver 2 loads without speeding', xp: 200, progress: c => ({ value: c.noSpeeding, target: 2 }) },
  { id: 'eco85', title: 'Eco hero', text: 'Finish a delivery with an eco score of 85+', xp: 150, progress: c => ({ value: c.bestEco >= 85 ? 1 : 0, target: 1 }) },
  { id: 'heavy', title: 'Heavy hauler', text: 'Deliver a load over 40,000 lb', xp: 200, progress: c => ({ value: c.heavy, target: 1 }) },
  { id: 'earn50k', title: 'Payday', text: 'Earn $50,000 today', xp: 200, progress: c => ({ value: c.income, target: 50000 }) },
  { id: 'deliver4', title: 'Busy day', text: 'Complete 4 deliveries', xp: 200, progress: c => ({ value: c.deliveries, target: 4 }) },
  { id: 'convoy', title: 'Better together', text: 'Drive in a convoy event', xp: 250, progress: c => ({ value: c.convoys, target: 1 }) },
  { id: 'shift80', title: 'Smooth operator', text: 'Keep shift quality at 80+ over 50 miles', xp: 150, progress: c => ({ value: c.shiftGood ? 1 : 0, target: 1 }) },
  { id: 'longhaul', title: 'Long hauler', text: 'Deliver a single load over 500 miles', xp: 250, progress: c => ({ value: c.longest >= 500 ? 1 : 0, target: 1 }) }
];

// Weekly board: bigger goals over a Monday-Sunday week (local time). `progress(ctx)` as above.
const WEEKLY_POOL = [
  { id: 'wmiles2500', title: 'Coast to coast', text: 'Drive 2,500 miles this week', xp: 600, progress: c => ({ value: c.miles, target: 2500 }) },
  { id: 'wmiles5000', title: 'Million-mile mindset', text: 'Drive 5,000 miles this week', xp: 1000, progress: c => ({ value: c.miles, target: 5000 }) },
  { id: 'wdeliver15', title: 'Freight machine', text: 'Complete 15 deliveries this week', xp: 700, progress: c => ({ value: c.deliveries, target: 15 }) },
  { id: 'wclean10', title: 'Spotless week', text: 'Deliver 10 loads with 1% damage or less', xp: 700, progress: c => ({ value: c.clean, target: 10 }) },
  { id: 'wcities8', title: 'Explorer', text: 'Deliver to 8 different cities', xp: 600, progress: c => ({ value: c.cities, target: 8 }) },
  { id: 'wstates4', title: 'State hopper', text: 'Deliver into 4 different states', xp: 600, progress: c => ({ value: c.states, target: 4 }) },
  { id: 'wearn250k', title: 'Big earner', text: 'Earn $250,000 this week', xp: 700, progress: c => ({ value: c.income, target: 250000 }) },
  { id: 'wconvoy3', title: 'Convoy regular', text: 'Drive in 3 convoy events', xp: 800, progress: c => ({ value: c.convoys, target: 3 }) },
  { id: 'wperfect', title: 'Tight formation', text: 'Finish a perfect-formation convoy (30+ min, never more than 1 mi behind)', xp: 800, progress: c => ({ value: c.perfect, target: 1 }) },
  { id: 'weco5', title: 'Fuel sipper', text: 'Finish 5 deliveries with an eco score of 80+', xp: 600, progress: c => ({ value: c.eco80, target: 5 }) },
  { id: 'wnospeed8', title: 'Model driver', text: 'Deliver 8 loads without speeding', xp: 700, progress: c => ({ value: c.noSpeeding, target: 8 }) },
  { id: 'wheavy5', title: 'Heavy week', text: 'Deliver 5 loads over 40,000 lb', xp: 700, progress: c => ({ value: c.heavy, target: 5 }) },
  { id: 'wphotos5', title: 'Road photographer', text: 'Take 5 screenshots in the game', xp: 400, progress: c => ({ value: c.photos, target: 5 }) }
];

// Monday 00:00 local of the week containing d, and its ISO-style label (e.g. 2026-W41).
function weekStart(d = new Date()) { const s = new Date(d); s.setHours(0, 0, 0, 0); s.setDate(s.getDate() - ((s.getDay() + 6) % 7)); return s; }
function weekKey(d = new Date()) {
  const t = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  t.setUTCDate(t.getUTCDate() + 4 - (t.getUTCDay() || 7));
  const y = t.getUTCFullYear(), w = Math.ceil(((t - Date.UTC(y, 0, 1)) / 86400000 + 1) / 7);
  return `${y}-W${String(w).padStart(2, '0')}`;
}

function hash(s) { let h = 2166136261; for (const ch of s) { h ^= ch.charCodeAt(0); h = Math.imul(h, 16777619); } return h >>> 0; }

const ODO_STEP = 10000;
const CAREER_MILES = [1000, 5000, 10000, 25000, 50000, 100000, 250000];
const CAREER_LOADS = [10, 25, 50, 100, 250, 500, 1000];

class FunManager {
  constructor({ trips, career, discord, journal, settings }) {
    Object.assign(this, { trips, career, discord, journal, settings });
    this.data = { claimed: {}, milestones: [], odoMark: null, convoys: [], moments: [], lastShot: null };
    try { this.data = { ...this.data, ...JSON.parse(fs.readFileSync(FILE, 'utf8')) }; } catch {}
    this.convoy = null;        // in-progress convoy participation
    this.shiftWindow = { start: null, miles0: null, good: false };
  }

  save() { try { fs.mkdirSync(path.dirname(FILE), { recursive: true }); fs.writeFileSync(FILE, JSON.stringify(this.data, null, 2)); } catch (e) { console.error('[FUN]', e.message); } }

  moment(m) {
    const entry = { id: `m_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`, at: new Date().toISOString(), ...m };
    this.data.moments.unshift(entry);
    this.data.moments = this.data.moments.slice(0, 50);
    this.save();
    if (m.discord && this.discord?.ready?.()) this.discord.post({ title: m.title, description: m.detail, color: 0xffd257 });
    return entry;
  }

  // ---- daily challenges ----
  todays(date = today()) {
    const h = hash(date);
    const picked = [];
    for (let i = 0; picked.length < 3 && i < 20; i++) { const c = POOL[(h + i * 7) % POOL.length]; if (!picked.includes(c)) picked.push(c); }
    return picked;
  }

  context() {
    const d = today();
    const trips = this.trips.getRecent(200).filter(t => today(new Date(t.endedAt || t.startedAt)) === d);
    const delivered = trips.filter(t => t.status === 'delivered');
    const cur = this.trips.getCurrent();
    return {
      miles: trips.reduce((s, t) => s + num(t.milesDriven), 0) + num(cur?.milesDriven),
      deliveries: delivered.length,
      clean: delivered.filter(t => num(t.endCargoDamage) <= 0.01).length,
      noSpeeding: delivered.filter(t => num(t.speedingSeconds) < 5).length,
      bestEco: Math.max(0, ...delivered.map(t => num(t.eco?.score))),
      heavy: delivered.filter(t => num(t.cargoMassKg) * 2.20462 > 40000).length,
      income: delivered.reduce((s, t) => s + num(t.deliveredIncome), 0),
      longest: Math.max(0, ...delivered.map(t => num(t.milesDriven))),
      convoys: this.data.convoys.filter(c => today(new Date(c.endedAt || c.startedAt)) === d).length + (this.convoy ? 1 : 0),
      shiftGood: this.shiftWindow.good
    };
  }

  challenges() {
    if (this.settings?.challenges === false) return { enabled: false, items: [] };
    const d = today(), ctx = this.context();
    const items = this.todays(d).map(c => {
      const p = c.progress(ctx);
      const done = p.value >= p.target;
      const key = `${d}:${c.id}`;
      if (done && !this.data.claimed[key]) {
        this.data.claimed[key] = new Date().toISOString();
        this.career?.addBonus?.(key, c.xp, `Challenge: ${c.title}`);
        this.moment({ type: 'challenge', title: `Challenge complete: ${c.title}`, detail: `${c.text} — +${c.xp} XP`, xp: c.xp });
      }
      return { id: c.id, title: c.title, text: c.text, xp: c.xp, value: Math.round(Math.min(p.value, p.target) * 10) / 10, target: p.target, done, claimedAt: this.data.claimed[key] || null };
    });
    return { enabled: true, date: d, items, resetsIn: Math.round((new Date(new Date().setHours(24, 0, 0, 0)) - Date.now()) / 60000) };
  }

  // ---- weekly board ----
  thisWeek(key = weekKey()) {
    const h = hash(key), picked = [];
    for (let i = 0; picked.length < 4 && i < 30; i++) { const c = WEEKLY_POOL[(h + i * 5) % WEEKLY_POOL.length]; if (!picked.includes(c)) picked.push(c); }
    return picked;
  }

  weekContext(now = new Date()) {
    const from = weekStart(now).getTime(), to = from + 7 * 86400000;
    const inWeek = t => { const at = Date.parse(t.endedAt || t.startedAt); return at >= from && at < to; };
    const trips = this.trips.getRecent(2000).filter(inWeek);
    const delivered = trips.filter(t => t.status === 'delivered');
    const cur = this.trips.getCurrent();
    const convoys = this.data.convoys.filter(inWeek);
    const stateOf = t => { const c = findCity(t.destinationCity); return c ? (c.state || stateAt(c.lon, c.lat)?.code || null) : null; };
    let photos = 0;
    try { photos = this.journal?.available?.() ? this.journal.between(new Date(from).toISOString(), new Date(Math.min(to, Date.now())).toISOString()).length : 0; } catch {}
    return {
      miles: trips.reduce((s, t) => s + num(t.milesDriven), 0) + (cur && inWeek({ startedAt: new Date().toISOString() }) ? num(cur.milesDriven) : 0),
      deliveries: delivered.length,
      clean: delivered.filter(t => num(t.endCargoDamage) <= 0.01).length,
      noSpeeding: delivered.filter(t => num(t.speedingSeconds) < 5).length,
      eco80: delivered.filter(t => num(t.eco?.score) >= 80).length,
      heavy: delivered.filter(t => num(t.cargoMassKg) * 2.20462 > 40000).length,
      income: delivered.reduce((s, t) => s + num(t.deliveredIncome), 0),
      cities: new Set(delivered.map(t => t.destinationCity).filter(Boolean)).size,
      states: new Set(delivered.map(stateOf).filter(Boolean)).size,
      convoys: convoys.length + (this.convoy ? 1 : 0),
      perfect: convoys.filter(c => c.perfect).length,
      photos
    };
  }

  weekly(now = new Date()) {
    if (this.settings?.challenges === false) return { enabled: false, items: [] };
    const key = weekKey(now), ctx = this.weekContext(now);
    const items = this.thisWeek(key).map(c => {
      const p = c.progress(ctx), done = p.value >= p.target, claim = `wk:${key}:${c.id}`;
      if (done && !this.data.claimed[claim]) {
        this.data.claimed[claim] = new Date().toISOString();
        this.career?.addBonus?.(claim, c.xp, `Weekly challenge: ${c.title}`);
        this.moment({ type: 'challenge', title: `Weekly challenge complete: ${c.title}`, detail: `${c.text} — +${c.xp} XP`, xp: c.xp, discord: true });
      }
      return { id: c.id, title: c.title, text: c.text, xp: c.xp, value: Math.round(Math.min(p.value, p.target) * 10) / 10, target: p.target, done, claimedAt: this.data.claimed[claim] || null };
    });
    // Past weeks from claimed keys: how many of the 4 were completed.
    const history = {};
    for (const k of Object.keys(this.data.claimed)) { const m = /^wk:(\d{4}-W\d{2}):/.exec(k); if (m && m[1] !== key) history[m[1]] = (history[m[1]] || 0) + 1; }
    const end = weekStart(now).getTime() + 7 * 86400000;
    return { enabled: true, week: key, items, xpAvailable: items.reduce((s, c) => s + c.xp, 0), xpEarned: items.filter(c => c.done).reduce((s, c) => s + c.xp, 0), resetsIn: Math.round((end - now.getTime()) / 60000), history: Object.entries(history).sort((a, b) => b[0].localeCompare(a[0])).slice(0, 8).map(([week, done]) => ({ week, done })) };
  }

  // ---- called on every telemetry update (cheap) ----
  observe(state, shift) {
    if (this.settings?.milestones === false || !state?.connected) return;
    const odo = num(state.truck?.odometerMiles);
    if (odo > 0) {
      const mark = Math.floor(odo / ODO_STEP) * ODO_STEP;
      if (this.data.odoMark === null) { this.data.odoMark = mark; this.save(); }
      else if (mark > this.data.odoMark) {
        this.data.odoMark = mark;
        const truck = [state.truck?.make, state.truck?.model].filter(Boolean).join(' ') || 'Your truck';
        this.moment({ type: 'milestone', title: `🎉 ${truck} passed ${mark.toLocaleString('en-US')} miles!`, detail: 'Odometer milestone', discord: true });
      }
    }
    // Shift quality window for the "Smooth operator" challenge.
    if (shift?.available && !this.shiftWindow.good) {
      if (this.shiftWindow.miles0 === null) this.shiftWindow.miles0 = odo;
      if (odo - this.shiftWindow.miles0 >= 50) {
        if (shift.score.quality >= 80) this.shiftWindow.good = true;
        this.shiftWindow.miles0 = odo;
      }
    }
  }

  // ---- trip finished ----
  onTrip(trip) {
    if (trip.status === 'delivered') {
      this.moment({ type: 'delivered', title: `Delivered ${trip.cargo || 'the load'}!`, detail: `${trip.originCity || '?'} → ${trip.destinationCity || '?'}`, income: num(trip.deliveredIncome), eco: trip.eco?.grade || null, clean: num(trip.endCargoDamage) <= 0.01 });
    }
    // Career milestones
    const c = this.career?.get?.();
    if (c) {
      for (const m of CAREER_MILES) if (c.totalMiles >= m && !this.data.milestones.includes(`miles-${m}`)) { this.data.milestones.push(`miles-${m}`); this.moment({ type: 'milestone', title: `🏁 ${m.toLocaleString('en-US')} career miles!`, detail: 'Career milestone', discord: true }); }
      for (const m of CAREER_LOADS) if (c.deliveries >= m && !this.data.milestones.includes(`loads-${m}`)) { this.data.milestones.push(`loads-${m}`); this.moment({ type: 'milestone', title: `📦 ${m} deliveries!`, detail: 'Career milestone', discord: true }); }
      this.save();
    }
  }

  // ---- convoy participation (every 5 s from the convoy loop) ----
  observeConvoy(activeEvent, state, gapStatus, roster) {
    const odo = num(state.truck?.odometerMiles);
    if (activeEvent) {
      if (!this.convoy || this.convoy.id !== activeEvent.id) {
        this.finishConvoy();
        this.convoy = { id: activeEvent.id, name: activeEvent.name, host: activeEvent.host, startedAt: new Date().toISOString(), odo0: odo, maxGap: 0, drivers: 0, lastShot: Date.now() };
      }
      const myGap = gapStatus?.leader && !gapStatus.leader.isLocal ? (gapStatus.gaps?.[0]?.miles ?? 0) : 0;
      this.convoy.maxGap = Math.max(this.convoy.maxGap, num(myGap));
      this.convoy.drivers = Math.max(this.convoy.drivers, roster.filter(r => r.online).length);
      this.convoy.miles = Math.max(0, odo - this.convoy.odo0);
      this.photoWall();
    } else if (this.convoy) this.finishConvoy();
  }

  finishConvoy() {
    const c = this.convoy;
    if (!c) return;
    this.convoy = null;
    const minutes = (Date.now() - Date.parse(c.startedAt)) / 60000;
    if (minutes < 5) return;   // too short to count
    const record = { id: c.id, name: c.name, host: c.host, startedAt: c.startedAt, endedAt: new Date().toISOString(), miles: Math.round(num(c.miles)), maxGapMiles: Math.round(c.maxGap * 10) / 10, drivers: c.drivers, minutes: Math.round(minutes), perfect: minutes >= 30 && c.maxGap <= 1 };
    this.data.convoys.unshift(record);
    this.data.convoys = this.data.convoys.slice(0, 200);
    this.save();
    this.career?.recordConvoy?.(record);
    this.moment({ type: 'convoy', title: `Convoy complete: ${c.name}`, detail: `${record.miles} mi with ${record.drivers} drivers${record.perfect ? ' — perfect formation!' : ''}` });
  }

  // During a convoy, post new screenshots to Discord (opt-in), max one a minute.
  photoWall() {
    if (!this.settings?.photoWall || !this.convoy || !this.journal?.available?.() || !this.discord?.ready?.()) return;
    if (Date.now() - (this.convoy.lastShot || 0) < 60000) return;
    this.journal.scan();
    const since = this.data.lastShot ? Date.parse(this.data.lastShot) : Date.parse(this.convoy.startedAt);
    const fresh = this.journal.shots.filter(s => Date.parse(s.takenAt) > since).reverse();
    if (!fresh.length) return;
    const shot = fresh[0];
    this.data.lastShot = shot.takenAt;
    this.convoy.lastShot = Date.now();
    this.save();
    const file = this.journal.file(shot.name);
    if (file) this.discord.post({ title: `📸 ${this.discord.driverName} · ${this.convoy.name}`, description: `Convoy photo wall — hosted by ${this.convoy.host}`, color: 0x4aa3ff }, [file]);
  }

  status() {
    return {
      challenges: this.challenges(),
      weekly: this.weekly(),
      moments: this.data.moments.slice(0, 20),
      convoys: this.data.convoys.slice(0, 20),
      activeConvoy: this.convoy ? { name: this.convoy.name, miles: Math.round(num(this.convoy.miles)), maxGapMiles: Math.round(this.convoy.maxGap * 10) / 10, drivers: this.convoy.drivers } : null,
      settings: this.settings
    };
  }
}

module.exports = { FunManager, POOL, WEEKLY_POOL, weekKey, weekStart };
