// Virtual trucking company (VTC) mode.
// The dispatcher's Companion owns the company: it creates job assignments for drivers and shares them
// with the convoy. A driver's Companion shows "assigned to you", accepting creates a local dispatch, and
// the result (accepted / delivered with income) is shared back. The dispatcher's Companion turns
// completed jobs into a company bank (company cut) and payroll (driver share).

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const FILE = path.join(process.cwd(), 'data', 'vtc.json');
const key = v => String(v || '').trim().toLowerCase();
const str = (v, n = 120) => String(v ?? '').trim().slice(0, n);

// Driver ranks by completed company jobs.
const RANKS = [[60, 'Legend'], [30, 'Veteran'], [15, 'Senior Driver'], [5, 'Driver'], [0, 'Rookie']];
const rankFor = jobs => { const [min, name] = RANKS.find(([m]) => jobs >= m); const next = RANKS.slice().reverse().find(([m]) => m > jobs); return { name, jobs, next: next ? { name: next[1], at: next[0] } : null }; };

class VtcManager {
  constructor({ driverName, dispatch }) {
    this.driverName = driverName;
    this.dispatch = dispatch;
    this.data = { company: null, assignments: [], ledger: [], progress: {} };
    try { this.data = { ...this.data, ...JSON.parse(fs.readFileSync(FILE, 'utf8')) }; } catch {}
  }

  save() { try { fs.mkdirSync(path.dirname(FILE), { recursive: true }); fs.writeFileSync(FILE, JSON.stringify(this.data, null, 2)); } catch (e) { console.error('[VTC]', e.message); } }

  // ---- dispatcher side ----
  setCompany(input = {}) {
    const name = str(input.name, 60);
    if (!name) throw new Error('Company name is required');
    const color = /^#[0-9a-f]{6}$/i.test(String(input.color || '')) ? String(input.color) : (this.data.company?.color || '#4aa3ff');
    const logoUrl = /^https:\/\/[^\s"'<>]+$/i.test(String(input.logoUrl || '')) ? String(input.logoUrl) : (input.logoUrl === '' ? null : this.data.company?.logoUrl || null);
    this.data.company = { id: this.data.company?.id || `vtc_${crypto.randomBytes(4).toString('hex')}`, name, tag: str(input.tag, 8).toUpperCase(), cutPercent: Math.max(0, Math.min(90, Number(input.cutPercent ?? 25) || 0)), color, logoUrl, dispatcher: this.driverName, createdAt: this.data.company?.createdAt || new Date().toISOString() };
    this.save();
    return this.data.company;
  }

  closeCompany() { this.data.company = null; this.save(); }

  assign(input = {}) {
    if (!this.data.company) throw new Error('Create your company first');
    const driver = str(input.driver, 80);
    if (!driver) throw new Error('Pick a driver');
    const a = {
      id: `job_${Date.now()}_${crypto.randomBytes(2).toString('hex')}`, driver,
      origin: str(input.origin, 60), destination: str(input.destination, 60), cargo: str(input.cargo, 60),
      pay: Math.max(0, Number(input.pay) || 0), notes: str(input.notes, 300), dueBy: input.dueBy && !Number.isNaN(Date.parse(input.dueBy)) ? new Date(input.dueBy).toISOString() : null,
      status: 'assigned', createdAt: new Date().toISOString(), acceptedAt: null, completedAt: null, income: null, miles: null
    };
    if (!a.origin && !a.destination) throw new Error('Add an origin or destination');
    this.data.assignments.unshift(a);
    this.data.assignments = this.data.assignments.slice(0, 300);
    this.save();
    return a;
  }

  cancelAssignment(id) {
    const a = this.data.assignments.find(x => x.id === id);
    if (!a || a.status === 'completed') return null;
    a.status = 'cancelled';
    this.save();
    return a;
  }

  // Fold drivers' shared progress into my assignments and ledger.
  syncFromRoster(roster = []) {
    if (!this.data.company) return;
    let changed = false;
    for (const r of roster) {
      const prog = r.isLocal ? this.data.progress : r.vtcProgress;
      if (!prog || typeof prog !== 'object') continue;
      for (const a of this.data.assignments) {
        const p = prog[a.id];
        if (!p || key(a.driver) !== key(r.driverName) || a.status === 'cancelled' || a.status === 'completed') continue;
        if (p.status === 'accepted' && a.status === 'assigned') { a.status = 'accepted'; a.acceptedAt = p.at || new Date().toISOString(); changed = true; }
        if (p.status === 'declined' && a.status !== 'declined') { a.status = 'declined'; changed = true; }
        if (p.status === 'completed') {
          a.status = 'completed'; a.completedAt = p.at || new Date().toISOString(); a.income = Math.max(0, Number(p.income) || 0); a.miles = Number(p.miles) || null;
          const gross = a.income || a.pay;
          const cut = Math.round(gross * (this.data.company.cutPercent / 100));
          this.data.ledger.unshift({ id: a.id, driver: a.driver, route: `${a.origin || '?'} → ${a.destination || '?'}`, gross, companyCut: cut, driverPay: gross - cut, at: a.completedAt });
          changed = true;
        }
      }
    }
    if (changed) { this.data.ledger = this.data.ledger.slice(0, 1000); this.save(); }
  }

  // ---- driver side ----
  incoming(roster = []) {
    const out = [];
    const sources = [...roster.filter(r => !r.isLocal && r.vtc?.company).map(r => ({ from: r.driverName, online: r.online, vtc: r.vtc })), ...(this.data.company ? [{ from: 'You', online: true, vtc: this.shareable() }] : [])];
    for (const src of sources) {
      for (const a of src.vtc.assignments || []) {
        if (key(a.driver) !== key(this.driverName) || ['cancelled'].includes(a.status)) continue;
        out.push({ ...a, company: src.vtc.company, dispatcher: src.from, dispatcherOnline: src.online, myStatus: this.data.progress[a.id]?.status || null });
      }
    }
    return out;
  }

  respond(roster, id, answer) {
    const job = this.incoming(roster).find(a => a.id === id);
    if (!job) return null;
    if (answer === 'decline') { this.data.progress[id] = { status: 'declined', at: new Date().toISOString() }; this.save(); return { job }; }
    const d = this.dispatch.create({ title: `[${job.company?.tag || 'VTC'}] ${job.origin || '?'} → ${job.destination || '?'}`, source: 'vtc', tags: [`vtc:${id}`, job.company?.name || 'Company'], notes: job.notes, stops: [{ origin: job.origin, destination: job.destination, cargo: job.cargo, plannedIncome: job.pay }] });
    if (!this.dispatch.getActive()) this.dispatch.start(d.id);
    this.data.progress[id] = { status: 'accepted', at: new Date().toISOString(), dispatchId: d.id };
    this.save();
    return { job, dispatch: d };
  }

  // Called when a local dispatch completes.
  onDispatchCompleted(d) {
    const tag = (d?.tags || []).find(t => String(t).startsWith('vtc:'));
    if (!tag) return;
    const id = tag.slice(4);
    const stops = d.stops || [];
    this.data.progress[id] = { status: 'completed', at: new Date().toISOString(), income: stops.reduce((s, x) => s + (Number(x.actualIncome) || Number(x.plannedIncome) || 0), 0), miles: stops.reduce((s, x) => s + (Number(x.actualMiles) || 0), 0) };
    this.save();
  }

  // ---- sharing ----
  shareable() {
    if (!this.data.company) return null;
    return { company: this.data.company, assignments: this.data.assignments.filter(a => a.status !== 'completed' || Date.now() - Date.parse(a.completedAt || 0) < 7 * 86400000).slice(0, 50).map(({ id, driver, origin, destination, cargo, pay, notes, dueBy, status }) => ({ id, driver, origin, destination, cargo, pay, notes, dueBy, status })) };
  }
  shareableProgress() {
    return Object.fromEntries(Object.entries(this.data.progress).filter(([, p]) => Date.now() - Date.parse(p.at || 0) < 14 * 86400000).slice(-50));
  }

  summary(roster = []) {
    this.syncFromRoster(roster);
    const c = this.data.company;
    const ledger = this.data.ledger;
    const payroll = {};
    for (const l of ledger) {
      const p = payroll[l.driver] ||= { driver: l.driver, jobs: 0, gross: 0, pay: 0 };
      p.jobs++; p.gross += l.gross; p.pay += l.driverPay;
    }
    return {
      company: c,
      isDispatcher: Boolean(c),
      assignments: c ? this.data.assignments.slice(0, 100) : [],
      bank: ledger.reduce((s, l) => s + l.companyCut, 0),
      revenue: ledger.reduce((s, l) => s + l.gross, 0),
      ledger: ledger.slice(0, 50),
      payroll: Object.values(payroll).sort((a, b) => b.pay - a.pay).map(p => ({ ...p, rank: rankFor(p.jobs) })),
      incoming: this.incoming(roster),
      drivers: roster.filter(r => !r.isLocal).map(r => ({ driverName: r.driverName, online: Boolean(r.online) }))
    };
  }
}

module.exports = { VtcManager };
