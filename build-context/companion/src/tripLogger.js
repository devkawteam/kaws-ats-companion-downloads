const fs = require('node:fs');
const path = require('node:path');

const DATA_DIR = path.join(process.cwd(), 'data');
const TRIPS_FILE = path.join(DATA_DIR, 'trips.json');
const CURRENT_FILE = path.join(DATA_DIR, 'current-trip.json');

const nowIso = () => new Date().toISOString();
const num = v => Number.isFinite(Number(v)) ? Number(v) : 0;
const biNumber = v => {
  if (typeof v === 'bigint') return Number(v);
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};

function safeReadArray(file) {
  try {
    if (!fs.existsSync(file)) return [];
    const parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

// Eco-driving score 0-100 from what the trip logger measures. Returns { score, grade, tips, parts }.
function ecoScore(t = {}) {
  const moving = Math.max(1, num(t.movingSeconds));
  const miles = Math.max(1, num(t.milesDriven));
  const total = Math.max(1, moving + num(t.idleSeconds));
  const parts = {
    speeding: Math.min(30, (num(t.speedingSeconds) / moving) * 100 * 1.2),
    harshBraking: Math.min(20, (num(t.harshBrakes) / miles) * 100 * 3),
    highRpm: Math.min(20, (num(t.highRpmSeconds) / moving) * 100 * 0.8),
    idling: Math.min(15, (num(t.idleSeconds) / total) * 100 * 0.5),
    cruiseBonus: Math.min(5, (num(t.cruiseSeconds) / moving) * 100 * 0.1)
  };
  const score = Math.max(0, Math.min(100, Math.round(100 - parts.speeding - parts.harshBraking - parts.highRpm - parts.idling + parts.cruiseBonus)));
  const grade = score >= 90 ? 'A' : score >= 80 ? 'B' : score >= 70 ? 'C' : score >= 60 ? 'D' : 'F';
  const TIPS = {
    speeding: 'Ease off: time over the limit costs the most points (and fines).',
    harshBraking: 'Brake earlier and softer — use the engine brake and retarder to slow down.',
    highRpm: 'Shift up sooner: keep the tach in the green band (about 1,100–1,500 RPM).',
    idling: 'Switch the engine off during long stops instead of idling.'
  };
  const tips = Object.entries(parts).filter(([k, v]) => k !== 'cruiseBonus' && v >= 3).sort((a, b) => b[1] - a[1]).map(([k]) => TIPS[k]);
  if (parts.cruiseBonus < 2 && moving > 600) tips.push('Use cruise control on highways for smoother, cheaper miles.');
  return { score, grade, tips: tips.slice(0, 3), parts: Object.fromEntries(Object.entries(parts).map(([k, v]) => [k, Math.round(v * 10) / 10])) };
}

class TripLogger {
  constructor(driverName) {
    this.driverName = driverName || 'ATS Driver';
    this.trips = safeReadArray(TRIPS_FILE);
    this.current = null;
    this.lastSampleAt = null;
    this.lastFuelGallons = null;
    this.lastPersistAt = 0;
    this.lastJobActive = false;
    this.wasSpeeding = false;
    this.finishListeners = [];

    fs.mkdirSync(DATA_DIR, { recursive: true });

    try {
      if (fs.existsSync(CURRENT_FILE)) {
        const restored = JSON.parse(fs.readFileSync(CURRENT_FILE, 'utf8'));
        if (restored && restored.status === 'active') {
          restored.recoveredAt = nowIso();
          this.current = restored;
          this.lastFuelGallons = restored.lastFuelGallons ?? restored.startFuelGallons ?? null;
          console.log(`[TRIP] Recovered active trip ${restored.id}.`);
        }
      }
    } catch {}
  }

  makeId() {
    return `trip-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  }

  start(state, reason = 'telemetry') {
    if (this.current?.status === 'active') return this.current;
    if (!state?.job?.active) return null;

    const t = {
      id: this.makeId(),
      driverName: this.driverName,
      game: state.game || 'ATS',
      status: 'active',
      startReason: reason,
      startedAt: nowIso(),
      endedAt: null,

      cargo: state.job?.cargo || null,
      cargoId: state.job?.cargoId || null,
      cargoMassKg: num(state.job?.cargoMassKg),
      originCity: state.job?.originCity || null,
      originCompany: state.job?.originCompany || null,
      destinationCity: state.job?.destinationCity || null,
      destinationCompany: state.job?.destinationCompany || null,
      plannedDistanceMiles: num(state.job?.plannedDistanceMiles),
      offeredIncome: biNumber(state.job?.income),

      truckMake: state.truck?.make || null,
      truckModel: state.truck?.model || null,
      truckId: state.truck?.id || null,

      startOdometerMiles: num(state.truck?.odometerMiles),
      lastOdometerMiles: num(state.truck?.odometerMiles),
      milesDriven: 0,

      startFuelGallons: num(state.truck?.fuelGallons),
      lastFuelGallons: num(state.truck?.fuelGallons),
      fuelUsedGallons: 0,
      fuelAddedGallons: 0,

      maxSpeedMph: num(state.truck?.speedMph),
      speedingSeconds: 0,
      speedingEvents: 0,
      idleSeconds: 0,
      movingSeconds: 0,

      startCargoDamage: num(state.job?.cargoDamage),
      endCargoDamage: num(state.job?.cargoDamage),
      deliveredIncome: 0,

      samples: 0,
      updatedAt: nowIso()
    };

    this.current = t;
    this.lastFuelGallons = t.startFuelGallons;
    this.lastSampleAt = Date.now();
    this.lastJobActive = true;
    this.persistCurrent(true);

    console.log(
      `[TRIP] Started ${t.id}: ${t.cargo || 'cargo'} | ` +
      `${t.originCity || '?'} -> ${t.destinationCity || '?'}`
    );

    return t;
  }

  observe(state) {
    const active = Boolean(state?.job?.active);

    if (active && !this.current) {
      this.start(state, 'auto-detect');
    }

    if (this.current?.status === 'active') {
      const now = Date.now();
      const dt = this.lastSampleAt ? Math.min(5, Math.max(0, (now - this.lastSampleAt) / 1000)) : 0;
      this.lastSampleAt = now;

      const odo = num(state.truck?.odometerMiles);
      if (odo > 0) {
        const delta = odo - num(this.current.lastOdometerMiles);
        if (delta > 0 && delta < 5) this.current.milesDriven += delta;
        this.current.lastOdometerMiles = odo;
      }

      const fuel = num(state.truck?.fuelGallons);
      if (fuel > 0 && this.lastFuelGallons !== null) {
        const delta = fuel - this.lastFuelGallons;
        if (delta < 0 && Math.abs(delta) < 20) this.current.fuelUsedGallons += Math.abs(delta);
        if (delta > 0 && delta < 300) this.current.fuelAddedGallons += delta;
      }
      if (fuel > 0) {
        this.lastFuelGallons = fuel;
        this.current.lastFuelGallons = fuel;
      }

      const speed = num(state.truck?.speedMph);
      const limit = num(state.navigation?.speedLimitMph);
      this.current.maxSpeedMph = Math.max(num(this.current.maxSpeedMph), speed);

      if (speed > 1) this.current.movingSeconds += dt;
      if (speed < 1 && state.truck?.engineOn !== false) this.current.idleSeconds += dt;
      const speeding = limit > 0 && speed > limit + 2;
      if (speeding) this.current.speedingSeconds += dt;
      if (speeding && !this.wasSpeeding) this.current.speedingEvents = num(this.current.speedingEvents) + 1;
      this.wasSpeeding = speeding;

      // Eco-driving inputs.
      const rpm = num(state.truck?.rpm);
      const rpmLimit = Math.max(1800, num(state.truck?.rpmMax) * 0.85);
      if (speed > 1 && rpm > rpmLimit) this.current.highRpmSeconds = num(this.current.highRpmSeconds) + dt;
      if (speed > 1 && state.truck?.cruiseControl) this.current.cruiseSeconds = num(this.current.cruiseSeconds) + dt;
      const brake = num(state.instruments?.brake);
      const harsh = brake > 80 && speed > 25;
      if (harsh && !this.wasHarsh && now - (this.lastHarshAt || 0) > 3000) { this.current.harshBrakes = num(this.current.harshBrakes) + 1; this.lastHarshAt = now; }
      this.wasHarsh = harsh;

      this.current.cargo = state.job?.cargo || this.current.cargo;
      this.current.originCity = state.job?.originCity || this.current.originCity;
      this.current.originCompany = state.job?.originCompany || this.current.originCompany;
      this.current.destinationCity = state.job?.destinationCity || this.current.destinationCity;
      this.current.destinationCompany = state.job?.destinationCompany || this.current.destinationCompany;
      this.current.plannedDistanceMiles = num(state.job?.plannedDistanceMiles) || this.current.plannedDistanceMiles;
      this.current.offeredIncome = biNumber(state.job?.income) || this.current.offeredIncome;
      this.current.endCargoDamage = num(state.job?.cargoDamage);
      this.current.samples++;
      this.current.updatedAt = nowIso();

      this.persistCurrent(false);
    }

    // Fallback for a job ending without an explicit event.
    if (!active && this.lastJobActive && this.current?.status === 'active') {
      setTimeout(() => {
        if (this.current?.status === 'active') this.finish('ended', state);
      }, 1500);
    }

    this.lastJobActive = active;
  }

  finish(status, state = null, eventData = null) {
    if (!this.current || this.current.status !== 'active') return null;

    const t = this.current;
    t.status = status;
    t.endedAt = nowIso();
    t.updatedAt = t.endedAt;

    if (state) {
      t.endCargoDamage = num(state.job?.cargoDamage);
      t.lastOdometerMiles = num(state.truck?.odometerMiles) || t.lastOdometerMiles;
    }

    const incomeFromEvent = eventData?.revenue ?? eventData?.income ?? eventData?.jobIncome;
    t.deliveredIncome = biNumber(incomeFromEvent) || (status === 'delivered' ? t.offeredIncome : 0);
    t.durationSeconds = Math.max(0, (new Date(t.endedAt) - new Date(t.startedAt)) / 1000);
    t.eco = ecoScore(t);
    try { this.decorate?.(t); } catch (e) { console.error('[TRIP]', e.message); }

    this.trips.unshift(t);
    this.trips = this.trips.slice(0, 500);

    fs.mkdirSync(DATA_DIR, { recursive: true });
    fs.writeFileSync(TRIPS_FILE, JSON.stringify(this.trips, null, 2), 'utf8');
    try { fs.unlinkSync(CURRENT_FILE); } catch {}

    console.log(
      `[TRIP] ${status.toUpperCase()} ${t.id}: ` +
      `${t.milesDriven.toFixed(1)} mi | $${Math.round(t.deliveredIncome || 0).toLocaleString()}`
    );

    this.current = null;
    this.lastSampleAt = null;
    this.lastFuelGallons = null;
    this.wasSpeeding = false;
    for (const fn of this.finishListeners) { try { fn(t); } catch (e) { console.error('[TRIP]', e.message); } }
    return t;
  }

  onFinish(fn) { if (typeof fn === 'function') this.finishListeners.push(fn); }

  persistCurrent(force = false) {
    if (!this.current) return;
    const now = Date.now();
    if (!force && now - this.lastPersistAt < 5000) return;
    this.lastPersistAt = now;
    fs.mkdirSync(DATA_DIR, { recursive: true });
    fs.writeFileSync(CURRENT_FILE, JSON.stringify(this.current, null, 2), 'utf8');
  }

  getCurrent() {
    return this.current ? { ...this.current, eco: ecoScore(this.current) } : null;
  }

  getRecent(limit = 10) {
    return this.trips.slice(0, Math.max(1, Math.min(100, Number(limit) || 10)));
  }

  getStats() {
    const completed = this.trips.filter(t => t.status === 'delivered');
    const cancelled = this.trips.filter(t => t.status === 'cancelled');
    return {
      totalTrips: this.trips.length,
      deliveredTrips: completed.length,
      cancelledTrips: cancelled.length,
      totalMiles: this.trips.reduce((s, t) => s + num(t.milesDriven), 0),
      totalIncome: completed.reduce((s, t) => s + num(t.deliveredIncome), 0),
      totalFuelUsedGallons: this.trips.reduce((s, t) => s + num(t.fuelUsedGallons), 0),
      totalSpeedingSeconds: this.trips.reduce((s, t) => s + num(t.speedingSeconds), 0)
    };
  }

  // Earnings and driving analytics over the last `days` days (0 = all time).
  getAnalytics(days = 30) {
    const since = days > 0 ? Date.now() - days * 86400000 : 0;
    const trips = this.trips.filter(t => new Date(t.endedAt || t.startedAt).getTime() >= since);
    const delivered = trips.filter(t => t.status === 'delivered');
    const sum = (list, key) => list.reduce((s, t) => s + num(t[key]), 0);
    const income = sum(delivered, 'deliveredIncome');
    const miles = sum(trips, 'milesDriven');
    const fuel = sum(trips, 'fuelUsedGallons');
    const drivingSeconds = sum(trips, 'movingSeconds');

    const dayKey = iso => new Date(iso).toLocaleDateString('en-CA');
    const daily = new Map();
    const span = days > 0 ? days : Math.min(90, Math.max(7, Math.ceil((Date.now() - Math.min(Date.now(), ...trips.map(t => new Date(t.endedAt || t.startedAt).getTime()))) / 86400000) + 1));
    for (let i = span - 1; i >= 0; i--) daily.set(dayKey(Date.now() - i * 86400000), { date: dayKey(Date.now() - i * 86400000), income: 0, miles: 0, trips: 0 });
    for (const t of trips) {
      const d = daily.get(dayKey(t.endedAt || t.startedAt));
      if (!d) continue;
      d.trips++;
      d.miles += num(t.milesDriven);
      if (t.status === 'delivered') d.income += num(t.deliveredIncome);
    }

    const top = (list, keyFn, valueFn = () => 1) => {
      const m = new Map();
      for (const t of list) { const k = keyFn(t); if (k) m.set(k, (m.get(k) || 0) + valueFn(t)); }
      return [...m.entries()].map(([name, value]) => ({ name, value })).sort((a, b) => b.value - a.value).slice(0, 5);
    };

    const clean = delivered.filter(t => num(t.endCargoDamage) <= 0.01).length;
    return {
      days,
      trips: trips.length,
      delivered: delivered.length,
      cancelled: trips.filter(t => t.status === 'cancelled').length,
      income,
      miles,
      fuelGallons: fuel,
      drivingHours: drivingSeconds / 3600,
      incomePerMile: miles > 0 ? income / miles : 0,
      avgIncome: delivered.length ? income / delivered.length : 0,
      mpg: fuel > 0 ? miles / fuel : 0,
      avgSpeedMph: drivingSeconds > 0 ? miles / (drivingSeconds / 3600) : 0,
      cleanDeliveryPercent: delivered.length ? (clean / delivered.length) * 100 : 0,
      speedingMinutes: sum(trips, 'speedingSeconds') / 60,
      ecoScore: (() => { const scored = trips.map(t => t.eco?.score ?? (t.movingSeconds ? ecoScore(t).score : null)).filter(v => v !== null); return scored.length ? Math.round(scored.reduce((a, b) => a + b, 0) / scored.length) : null; })(),
      daily: [...daily.values()],
      topCargo: top(delivered, t => t.cargo, t => num(t.deliveredIncome)),
      topRoutes: top(trips, t => t.originCity && t.destinationCity ? `${t.originCity} → ${t.destinationCity}` : null),
      topCities: top(trips.flatMap(t => [t.originCity, t.destinationCity].filter(Boolean).map(city => ({ city }))), x => x.city),
      bestTrip: delivered.reduce((best, t) => (!best || num(t.deliveredIncome) > num(best.deliveredIncome) ? t : best), null),
      longestTrip: trips.reduce((best, t) => (!best || num(t.milesDriven) > num(best.milesDriven) ? t : best), null)
    };
  }

  toCsv() {
    const cols = ['id', 'status', 'startedAt', 'endedAt', 'cargo', 'originCity', 'originCompany', 'destinationCity', 'destinationCompany', 'milesDriven', 'plannedDistanceMiles', 'deliveredIncome', 'offeredIncome', 'fuelUsedGallons', 'maxSpeedMph', 'speedingSeconds', 'speedingEvents', 'endCargoDamage', 'durationSeconds', 'truckMake', 'truckModel'];
    const esc = v => {
      const s = v === null || v === undefined ? '' : String(v);
      // Quote special characters; neutralize spreadsheet formulas in text cells.
      const formula = /^[=+\-@]/.test(s) && !Number.isFinite(Number(s));
      return /[",\n\r]/.test(s) || formula ? `"${(formula ? "'" : '') + s.replace(/"/g, '""')}"` : s;
    };
    return [cols.join(','), ...this.trips.map(t => cols.map(c => esc(t[c])).join(','))].join('\r\n');
  }
}

module.exports = { TripLogger, ecoScore };
