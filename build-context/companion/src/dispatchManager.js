const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

function nowIso() {
  return new Date().toISOString();
}

function id(prefix = 'dispatch') {
  return `${prefix}_${Date.now()}_${crypto.randomBytes(3).toString('hex')}`;
}

class DispatchManager {
  constructor(driverName, dataDir = path.join(process.cwd(), 'data')) {
    this.driverName = driverName || 'Driver';
    this.dataDir = dataDir;
    this.file = path.join(dataDir, 'dispatches.json');
    this.dispatches = [];
    this.activeId = null;
    this.lastObservedJobKey = null;
    this.listeners = { stopCompleted: [], completed: [], cancelled: [] };
    this.load();
  }

  on(event, listener) { if (this.listeners[event] && typeof listener === 'function') this.listeners[event].push(listener); return this; }
  emit(event, ...args) { for (const listener of this.listeners[event] || []) { try { listener(...args); } catch (e) { console.error('[DISPATCH EVENT]', e.message); } } }

  load() {
    try {
      fs.mkdirSync(this.dataDir, { recursive: true });
      if (!fs.existsSync(this.file)) return;
      const parsed = JSON.parse(fs.readFileSync(this.file, 'utf8'));
      this.dispatches = Array.isArray(parsed.dispatches) ? parsed.dispatches : [];
      this.activeId = parsed.activeId || null;
    } catch (error) {
      console.error('[DISPATCH] Load failed:', error.message);
      this.dispatches = [];
      this.activeId = null;
    }
  }

  save() {
    fs.mkdirSync(this.dataDir, { recursive: true });
    fs.writeFileSync(this.file, JSON.stringify({ activeId: this.activeId, dispatches: this.dispatches }, null, 2), 'utf8');
  }

  normalizeStop(stop = {}, index = 0) {
    return {
      id: stop.id || id('stop'),
      order: Number.isFinite(Number(stop.order)) ? Number(stop.order) : index + 1,
      origin: String(stop.origin || '').trim(),
      destination: String(stop.destination || '').trim(),
      cargo: String(stop.cargo || '').trim(),
      market: String(stop.market || 'freight').trim().toLowerCase(),
      plannedMiles: Number(stop.plannedMiles || 0),
      plannedIncome: Number(stop.plannedIncome || 0),
      status: stop.status || 'planned',
      startedAt: stop.startedAt || null,
      completedAt: stop.completedAt || null,
      actualMiles: Number(stop.actualMiles || 0),
      actualIncome: Number(stop.actualIncome || 0),
      notes: String(stop.notes || '')
    };
  }

  create(input = {}) {
    const stops = Array.isArray(input.stops) ? input.stops.map((s, i) => this.normalizeStop(s, i)) : [];
    const dispatch = {
      id: id(),
      title: String(input.title || `Dispatch ${new Date().toLocaleDateString()}`).trim(),
      driver: this.driverName,
      type: input.type || (stops.length > 1 ? 'multi-stop' : 'single'),
      source: input.source || 'manual',
      status: 'planned',
      createdAt: nowIso(),
      updatedAt: nowIso(),
      startedAt: null,
      completedAt: null,
      currentStopIndex: 0,
      stops,
      tags: Array.isArray(input.tags) ? input.tags.map(String) : [],
      notes: String(input.notes || '')
    };
    this.dispatches.unshift(dispatch);
    this.save();
    return dispatch;
  }

  list(limit = 50) {
    return this.dispatches.slice(0, Math.max(1, Number(limit) || 50));
  }

  get(idValue) {
    return this.dispatches.find(d => d.id === idValue) || null;
  }

  getActive() {
    return this.activeId ? this.get(this.activeId) : null;
  }

  start(idValue) {
    const dispatch = this.get(idValue);
    if (!dispatch) return null;
    if (this.activeId && this.activeId !== idValue) {
      const old = this.get(this.activeId);
      if (old && old.status === 'active') old.status = 'paused';
    }
    this.activeId = idValue;
    dispatch.status = 'active';
    dispatch.startedAt ||= nowIso();
    dispatch.updatedAt = nowIso();
    const stop = dispatch.stops[dispatch.currentStopIndex];
    if (stop && stop.status === 'planned') {
      stop.status = 'active';
      stop.startedAt ||= nowIso();
    }
    this.save();
    return dispatch;
  }

  update(idValue, patch = {}) {
    const dispatch = this.get(idValue);
    if (!dispatch) return null;
    for (const key of ['title', 'notes', 'status']) {
      if (patch[key] !== undefined) dispatch[key] = String(patch[key]);
    }
    if (Array.isArray(patch.tags)) dispatch.tags = patch.tags.map(String);
    if (Array.isArray(patch.stops)) dispatch.stops = patch.stops.map((s, i) => this.normalizeStop(s, i));
    dispatch.updatedAt = nowIso();
    this.save();
    return dispatch;
  }

  completeCurrentStop(result = {}) {
    const dispatch = this.getActive();
    if (!dispatch) return null;
    const stop = dispatch.stops[dispatch.currentStopIndex];
    if (!stop) return null;
    stop.status = 'completed';
    stop.completedAt = nowIso();
    if (result.actualMiles !== undefined) stop.actualMiles = Number(result.actualMiles || 0);
    if (result.actualIncome !== undefined) stop.actualIncome = Number(result.actualIncome || 0);
    if (result.damagePercent !== undefined) stop.damagePercent = Number(result.damagePercent || 0);
    this.emit('stopCompleted', dispatch, stop);
    dispatch.currentStopIndex += 1;
    const next = dispatch.stops[dispatch.currentStopIndex];
    if (next) {
      next.status = 'active';
      next.startedAt ||= nowIso();
    } else {
      dispatch.status = 'completed';
      dispatch.completedAt = nowIso();
      this.activeId = null;
    }
    dispatch.updatedAt = nowIso();
    this.save();
    if (dispatch.status === 'completed') this.emit('completed', dispatch);
    return dispatch;
  }

  cancel(idValue) {
    const dispatch = this.get(idValue);
    if (!dispatch) return null;
    dispatch.status = 'cancelled';
    dispatch.completedAt = nowIso();
    dispatch.updatedAt = nowIso();
    if (this.activeId === idValue) this.activeId = null;
    this.save();
    this.emit('cancelled', dispatch);
    return dispatch;
  }

  observeTelemetry(state = {}) {
    const job = state.job || {};
    const onJob = Boolean(job.onJob || job.active || state.onJob);
    if (!onJob) {
      this.lastObservedJobKey = null;
      return;
    }

    const origin = job.originCity || '';
    const destination = job.destinationCity || '';
    const cargo = job.cargo || '';
    const key = [origin, destination, cargo].join('|').toLowerCase();
    if (!key.replace(/\|/g, '') || key === this.lastObservedJobKey) return;
    this.lastObservedJobKey = key;

    if (this.getActive()) return;

    const dispatch = this.create({
      title: `${origin || 'Unknown'} → ${destination || 'Unknown'}`,
      type: 'single',
      source: 'telemetry-auto',
      stops: [{
        origin,
        destination,
        cargo,
        plannedMiles: Number(job.plannedDistanceMiles || 0),
        plannedIncome: Number(job.income || 0),
        status: 'planned'
      }]
    });
    this.start(dispatch.id);
    console.log(`[DISPATCH] Auto-created from telemetry: ${dispatch.title}`);
  }

  summary() {
    const active = this.getActive();
    return {
      active,
      counts: this.dispatches.reduce((acc, d) => {
        acc[d.status] = (acc[d.status] || 0) + 1;
        return acc;
      }, {}),
      recent: this.list(10)
    };
  }
}

module.exports = { DispatchManager };
