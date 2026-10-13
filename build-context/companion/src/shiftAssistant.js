// Smart shift assistant.
// Uses the truck's real gearbox from telemetry (forward gear ratios, differential ratio, wheel radius)
// to work out the engine RPM in every gear at the current speed, then recommends the best gear for the
// driving situation. The model self-calibrates against the actual RPM in the current gear.

const fin = v => v !== null && v !== undefined && Number.isFinite(Number(v));
const median = a => { const s = [...a].sort((x, y) => x - y); return s.length ? s[Math.floor(s.length / 2)] : null; };

// RPM bands per driving mode (typical modern heavy-duty diesel sweet spots).
const BANDS = {
  economy: { low: 1100, high: 1450, down: 1000, up: 1550, label: 'Economy' },
  balanced: { low: 1200, high: 1600, down: 1050, up: 1700, label: 'Balanced' },
  power: { low: 1400, high: 1850, down: 1250, up: 1950, label: 'Power' }
};

class ShiftAssistant {
  constructor() {
    this.k = 1;                       // calibration factor actual/computed RPM
    this.lastSpeed = null;
    this.lastAt = null;
    this.accel = 0;                   // smoothed m/s²
    this.lastGear = null;
    this.lastShiftAt = 0;
    this.pendingShiftCheck = null;
    this.mode = 'auto';
    this.resetScore();
    this.last = { available: false };
  }

  setMode(mode) { if (['auto', 'economy', 'balanced', 'power'].includes(mode)) this.mode = mode; }

  resetScore() { this.score = { driving: 0, inBand: 0, lugging: 0, overRev: 0, shifts: 0, goodShifts: 0 }; }

  evaluate(state) {
    const t = state.truck || {};
    const now = Date.now();
    const dt = this.lastAt ? Math.min(2, (now - this.lastAt) / 1000) : 0;
    this.lastAt = now;
    const v = Number(t.speedMps) || 0;                        // m/s (negative when reversing)
    const speed = Math.abs(v);
    if (this.lastSpeed !== null && dt > 0) this.accel = this.accel * 0.85 + ((speed - this.lastSpeed) / dt) * 0.15;
    this.lastSpeed = speed;

    const ratios = Array.isArray(t.forwardGearRatios) ? t.forwardGearRatios.map(Number).filter(r => r > 0) : [];
    const diff = Number(t.differentialRatio) || 0;
    const radius = median((t.wheelRadiusMeters || []).map(Number).filter(r => r > 0.2 && r < 1.5));
    const rpm = Number(t.rpm) || 0;
    const rpmMax = Number(t.rpmMax) || 2100;
    const gear = Number(t.gear) || 0;
    const throttle = Number(state.instruments?.throttle) || 0;
    const automatic = /auto|arcade/i.test(String(t.transmissionType || ''));

    if (!ratios.length || !diff || !radius) {
      this.last = { available: false, reason: 'Waiting for gearbox data from the truck (gear ratios, differential and wheel size).' };
      return this.last;
    }

    // RPM the engine would turn in gear i at this speed.
    const wheelRpm = (speed / (2 * Math.PI * radius)) * 60;
    const rawRpm = i => wheelRpm * ratios[i] * diff;
    // Calibrate against reality in the current gear (clutch engaged, rolling).
    if (gear > 0 && gear <= ratios.length && speed > 3 && rpm > 600) {
      const est = rawRpm(gear - 1);
      if (est > 300) this.k = Math.max(0.8, Math.min(1.25, this.k * 0.95 + (rpm / est) * 0.05));
    }
    const gearRpm = i => rawRpm(i) * this.k;

    // Driving situation -> mode.
    const massKg = Number(state.job?.cargoMassKg) || 0;
    let situation = 'cruising';
    if (speed < 2) situation = 'stopped';
    else if (throttle > 85 && this.accel < 0.08) situation = 'climbing';
    else if (throttle > 60 && this.accel > 0.25) situation = 'accelerating';
    else if (throttle < 3 && this.accel > 0.25) situation = 'downhill';
    const autoMode = massKg > 30000 || situation === 'climbing' ? 'power' : situation === 'accelerating' ? 'balanced' : 'economy';
    const mode = this.mode === 'auto' ? autoMode : this.mode;
    const band = BANDS[mode];
    const safeMax = rpmMax * 0.95;

    const table = ratios.map((r, i) => {
      const g = i + 1, gr = gearRpm(i);
      return { gear: g, ratio: Math.round(r * 100) / 100, rpm: Math.round(gr), inBand: gr >= band.low && gr <= band.high, tooLow: gr < 700, tooHigh: gr > safeMax };
    });

    // Best gear: closest to the middle of the band without lugging or over-revving.
    let best = null;
    if (speed >= 2) {
      const mid = (band.low + band.high) / 2;
      const usable = table.filter(x => !x.tooLow && !x.tooHigh);
      best = (usable.filter(x => x.inBand).sort((a, b) => Math.abs(a.rpm - mid) - Math.abs(b.rpm - mid))[0]
        || usable.sort((a, b) => Math.abs(a.rpm - mid) - Math.abs(b.rpm - mid))[0] || null)?.gear || null;
    } else {
      // Starting gear: low for heavy loads, skip a couple for light ones.
      best = Math.min(ratios.length, massKg > 30000 ? 1 : massKg > 15000 ? 2 : 3);
    }

    // Advice with hysteresis: hold while the current gear is in the band.
    let action = 'HOLD', steps = 0, advice = 'Hold this gear';
    const curRpm = gear > 0 ? rpm : 0;
    if (gear <= 0 && speed < 2) { action = 'START'; advice = `Start in gear ${best}`; }
    else if (gear > 0 && best) {
      const needUp = curRpm > band.up || (curRpm > band.high && best > gear);
      const needDown = curRpm < band.down || (curRpm < band.low && best < gear && situation !== 'downhill');
      if (needUp && best > gear) { action = 'UPSHIFT'; steps = best - gear; advice = steps > 1 ? `Skip-shift up to ${best}` : `Upshift to ${best}`; }
      else if (needDown && best < gear) { action = 'DOWNSHIFT'; steps = gear - best; advice = steps > 1 ? `Drop ${steps} to gear ${best}` : `Downshift to ${best}`; }
      else if (curRpm > safeMax) { action = 'UPSHIFT'; steps = 1; advice = 'Over-revving — upshift now'; }
    }
    let hint = null;
    if (situation === 'downhill' && speed > 15) hint = t.retarderSteps ? 'Downhill: use the retarder / engine brake instead of the service brakes' : 'Downhill: use the engine brake instead of the service brakes';
    else if (situation === 'climbing') hint = 'Climbing: keep the revs up in the power band';
    else if (gear > 0 && curRpm > 0 && curRpm < 1000 && throttle > 60) hint = 'Lugging the engine — downshift';

    // Shift quality score (moving, in gear).
    if (dt > 0 && gear > 0 && speed > 3) {
      this.score.driving += dt;
      if (curRpm >= band.low - 50 && curRpm <= band.high + 50) this.score.inBand += dt;
      if (curRpm < 1000 && throttle > 60) this.score.lugging += dt;
      if (curRpm > rpmMax * 0.93) this.score.overRev += dt;
    }
    if (this.lastGear !== null && gear !== this.lastGear && gear > 0 && this.lastGear > 0) {
      this.score.shifts++;
      this.pendingShiftCheck = now + 1500;   // judge the shift once RPM settles
    }
    if (this.pendingShiftCheck && now >= this.pendingShiftCheck) {
      this.pendingShiftCheck = null;
      if (curRpm >= band.down && curRpm <= band.up) this.score.goodShifts++;
    }
    this.lastGear = gear;
    const d = Math.max(1, this.score.driving);
    const quality = Math.round(Math.max(0, Math.min(100, (this.score.inBand / d) * 70 + (1 - this.score.lugging / d) * 15 + (1 - this.score.overRev / d) * 15)));

    this.last = {
      available: true, automatic, mode, requestedMode: this.mode, bandLabel: band.label, situation,
      band: { low: band.low, high: band.high }, rpm: Math.round(curRpm), rpmMax, gear, displayedGear: t.displayedGear ?? gear,
      gears: ratios.length, bestGear: best, action, steps, advice: automatic && action !== 'START' ? (action === 'HOLD' ? 'Automatic gearbox — cruising well' : `Automatic: ideal gear would be ${best}`) : advice, hint,
      calibration: Math.round(this.k * 1000) / 1000, table,
      score: { quality, shifts: this.score.shifts, goodShifts: this.score.goodShifts, inBandPct: Math.round((this.score.inBand / d) * 100), luggingSec: Math.round(this.score.lugging), overRevSec: Math.round(this.score.overRev) }
    };
    return this.last;
  }

  get() { return this.last; }
}

module.exports = { ShiftAssistant, BANDS };
