const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

class BolManager {
  constructor(driverName, dataDir = path.join(process.cwd(), 'data')) {
    this.driverName = driverName || 'Driver';
    this.file = path.join(dataDir, 'bols.json');
    this.items = [];
    this.load();
  }
  load() {
    try {
      fs.mkdirSync(path.dirname(this.file), { recursive: true });
      if (fs.existsSync(this.file)) this.items = JSON.parse(fs.readFileSync(this.file, 'utf8')).bols || [];
    } catch (e) { console.error('[BOL] Load failed:', e.message); this.items = []; }
  }
  save() { fs.mkdirSync(path.dirname(this.file), { recursive: true }); fs.writeFileSync(this.file, JSON.stringify({ bols: this.items }, null, 2)); }
  createFromDispatch(dispatch, truck = {}) {
    if (!dispatch?.id || dispatch.status !== 'completed') return null;
    const existing = this.items.find(x => x.dispatchId === dispatch.id);
    if (existing) return existing;
    const stops = (dispatch.stops || []).map((s, i) => ({
      order: i + 1, origin: s.origin || '', destination: s.destination || '', cargo: s.cargo || '',
      market: s.market || '', plannedMiles: Number(s.plannedMiles || 0), actualMiles: Number(s.actualMiles || 0),
      plannedIncome: Number(s.plannedIncome || 0), actualIncome: Number(s.actualIncome || 0),
      startedAt: s.startedAt || null, completedAt: s.completedAt || null
    }));
    const createdAt = new Date().toISOString();
    const sequence = String(this.items.length + 1).padStart(5, '0');
    const bol = {
      id: `bol_${Date.now()}_${crypto.randomBytes(3).toString('hex')}`,
      number: `KAW-${createdAt.slice(0,10).replace(/-/g,'')}-${sequence}`,
      dispatchId: dispatch.id, title: dispatch.title, driver: dispatch.driver || this.driverName,
      origin: stops[0]?.origin || '', destination: stops.at(-1)?.destination || '',
      cargo: [...new Set(stops.map(s => s.cargo).filter(Boolean))].join(', '),
      truck: { make: truck.make || '', model: truck.model || '', id: truck.id || '', licensePlate: truck.licensePlate || '' },
      plannedMiles: stops.reduce((n,s)=>n+s.plannedMiles,0), actualMiles: stops.reduce((n,s)=>n+s.actualMiles,0),
      plannedIncome: stops.reduce((n,s)=>n+s.plannedIncome,0), actualIncome: stops.reduce((n,s)=>n+s.actualIncome,0),
      startedAt: dispatch.startedAt || null, completedAt: dispatch.completedAt || createdAt, createdAt, stops
    };
    this.items.unshift(bol); this.save(); return bol;
  }
  list(limit = 100) { return this.items.slice(0, Math.max(1, Number(limit) || 100)); }
  get(id) { return this.items.find(x => x.id === id || x.number === id) || null; }
}
module.exports = { BolManager };
