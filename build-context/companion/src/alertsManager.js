// Driver alerts: fuel, fatigue, damage, cargo, overspeed, deadline and truck warning lights.
// Evaluated on every telemetry update; an alert is "raised" once when it becomes active
// and stays in `active` until the condition clears.

const num = v => (v !== null && v !== undefined && Number.isFinite(Number(v)) ? Number(v) : null);

const DAMAGE_PARTS = [
  ['enginePercent', 'Engine'],
  ['transmissionPercent', 'Transmission'],
  ['cabinPercent', 'Cabin'],
  ['chassisPercent', 'Chassis'],
  ['wheelsPercent', 'Tires / wheels'],
  ['trailerBodyPercent', 'Trailer body'],
  ['trailerChassisPercent', 'Trailer chassis'],
  ['trailerWheelsPercent', 'Trailer wheels']
];

const WARNING_LIGHTS = [
  ['airPressureEmergency', 'critical', 'Air pressure emergency', 'Brakes may lock. Stop safely.'],
  ['airPressure', 'warn', 'Low air pressure', 'Let the compressor build pressure.'],
  ['oilPressure', 'critical', 'Low oil pressure', 'Engine damage risk.'],
  ['waterTemperature', 'warn', 'Engine overheating', 'Coolant temperature is high.'],
  ['batteryVoltage', 'warn', 'Battery voltage low', 'Check the alternator / electrics.'],
  ['adblue', 'warn', 'AdBlue low', 'Refill DEF at the next stop.']
];

function fmtMinutes(min) {
  const m = Math.max(0, Math.round(min));
  const h = Math.floor(m / 60);
  return h ? `${h}h ${String(m % 60).padStart(2, '0')}m` : `${m}m`;
}

class AlertsManager {
  constructor(settings = {}) {
    this.settings = settings;
    this.active = new Map();
    this.history = [];
    this.listeners = [];
    this.overspeed = { active: false, limitMph: null, overByMph: 0, events: 0, since: null };
    this.external = new Map();   // source -> [{ id, severity, title, detail }]
  }

  // Other modules (gap keeper, convoy events) publish their alerts here.
  setExternal(source, list = []) { this.external.set(source, Array.isArray(list) ? list : []); }

  onRaised(fn) { if (typeof fn === 'function') this.listeners.push(fn); }

  setSettings(settings) { this.settings = { ...this.settings, ...settings }; }

  evaluate(state) {
    const s = this.settings;
    const next = new Map();
    const add = (id, severity, title, detail) => next.set(id, { id, severity, title, detail });

    if (s.enabled !== false && state?.connected && !state.sdk?.paused) {
      const t = state.truck || {};
      const nav = state.navigation || {};
      const dmg = state.damage || {};
      const warn = state.warnings || {};

      // Fuel
      const fuel = num(t.fuelGallons), cap = num(t.fuelCapacityGallons);
      const fuelPct = fuel !== null && cap ? (fuel / cap) * 100 : null;
      if ((fuelPct !== null && fuelPct <= s.lowFuelPercent) || warn.fuel) {
        const range = num(t.fuelRangeMiles);
        const critical = fuelPct !== null && fuelPct <= Math.max(5, s.lowFuelPercent / 2);
        add('fuel', critical ? 'critical' : 'warn', critical ? 'Fuel critical' : 'Low fuel',
          `${fuelPct !== null ? Math.round(fuelPct) + '% left' : 'Fuel warning'}${range ? ` · about ${Math.round(range)} mi range` : ''}`);
      }

      // Fatigue (ATS rest-stop timer, in game minutes)
      const rest = num(nav.restStopMinutes);
      if (rest !== null && rest > 0 && rest <= s.fatigueWarnMinutes) {
        add('fatigue', rest <= 15 ? 'critical' : 'warn', rest <= 15 ? 'Rest required now' : 'Rest soon',
          `Sleep needed in ${fmtMinutes(rest)} (game time)`);
      }

      // Truck and trailer damage
      const damaged = DAMAGE_PARTS
        .map(([key, label]) => [label, num(dmg[key])])
        .filter(([, v]) => v !== null && v >= s.damageWarnPercent)
        .sort((a, b) => b[1] - a[1]);
      if (damaged.length) {
        const worst = damaged[0][1];
        add('damage', worst >= Math.min(60, s.damageWarnPercent * 3) ? 'critical' : 'warn', 'Truck damage',
          damaged.slice(0, 3).map(([label, v]) => `${label} ${Math.round(v)}%`).join(' · '));
      }

      // Cargo
      const cargo = num(dmg.cargoPercent);
      if (state.job?.active && cargo !== null && cargo >= s.cargoDamageWarnPercent) {
        add('cargo', cargo >= s.cargoDamageWarnPercent * 3 ? 'critical' : 'warn', 'Cargo damage',
          `${cargo.toFixed(1)}% damaged — it reduces your pay`);
      }

      // Overspeed
      const speed = num(t.speedMph), limit = num(nav.speedLimitMph);
      const over = speed !== null && limit !== null && limit > 5 ? speed - limit : 0;
      const speeding = over > s.overspeedToleranceMph;
      if (speeding && !this.overspeed.active) { this.overspeed.events++; this.overspeed.since = new Date().toISOString(); }
      this.overspeed.active = speeding;
      this.overspeed.limitMph = limit;
      this.overspeed.overByMph = speeding ? over : 0;
      if (!speeding) this.overspeed.since = null;
      if (speeding) {
        add('overspeed', over > s.overspeedToleranceMph + 10 ? 'critical' : 'warn', 'Over the speed limit',
          `${Math.round(speed)} in a ${Math.round(limit)} zone (+${Math.round(over)} mph)`);
      }

      // Delivery deadline (both in game minutes)
      const left = num(nav.deadlineMinutesRemaining);
      const etaMin = num(nav.etaSeconds) !== null ? num(nav.etaSeconds) / 60 : null;
      if (state.job?.active && left !== null && left > -100000) {
        if (left <= 0) add('deadline', 'critical', 'Delivery late', `${fmtMinutes(-left)} past the deadline`);
        else if (etaMin !== null && etaMin > left) add('deadline', 'critical', 'Running late', `ETA ${fmtMinutes(etaMin)} · deadline in ${fmtMinutes(left)}`);
        else if (left <= s.deadlineWarnMinutes) add('deadline', 'warn', 'Deadline close', `${fmtMinutes(left)} left to deliver`);
      }

      // Truck dashboard warning lights
      for (const [key, severity, title, detail] of WARNING_LIGHTS) {
        if (warn[key] && !(key === 'airPressure' && warn.airPressureEmergency)) add(`light-${key}`, severity, title, detail);
      }
    } else {
      this.overspeed.active = false;
      this.overspeed.overByMph = 0;
    }

    if (s.enabled !== false) for (const list of this.external.values()) for (const a of list) if (a?.id) next.set(a.id, { ...a });

    // Keep "since" for alerts that stay active; raise the new ones.
    const now = new Date().toISOString();
    for (const [id, alert] of next) {
      const prev = this.active.get(id);
      alert.since = prev?.since || now;
      const escalated = prev && prev.severity !== 'critical' && alert.severity === 'critical';
      if (!prev || escalated) {
        const entry = { ...alert, raisedAt: now };
        // Routine speed-limit crossings are counted per trip; only log the serious ones.
        if (alert.id !== 'overspeed' || alert.severity === 'critical') {
          this.history.unshift(entry);
          this.history = this.history.slice(0, 50);
        }
        for (const fn of this.listeners) { try { fn(entry); } catch (e) { console.error('[ALERTS]', e.message); } }
      }
    }
    this.active = next;
    return this.summary();
  }

  summary() {
    const order = { critical: 0, warn: 1, info: 2 };
    return {
      active: [...this.active.values()].sort((a, b) => order[a.severity] - order[b.severity]),
      history: this.history.slice(0, 20),
      overspeed: { ...this.overspeed },
      settings: this.settings
    };
  }
}

module.exports = { AlertsManager };
