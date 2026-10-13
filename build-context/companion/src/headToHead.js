// Head-to-head weekly challenges between friends on the convoy relay: "most miles this week",
// "most deliveries", "most clean deliveries" or "most income". Uses the weekly stats every Companion
// already shares (driverStats); the challenge itself rides in the relay's cached data. Author: Kaw.
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const METRICS = { miles: 'Most miles', deliveries: 'Most deliveries', clean: 'Most clean deliveries', income: 'Most income' };
const clean = (v, n) => String(v ?? '').replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, n);
const num = v => (Number.isFinite(Number(v)) ? Number(v) : 0);

// A challenge from another driver (untrusted): only known fields, bounded.
function cleanChallenge(c) {
  if (!c || typeof c !== 'object' || !METRICS[c.metric]) return null;
  const id = clean(c.id, 32), to = clean(c.to, 40), week = clean(c.week, 10);
  if (!/^h2h_[a-f0-9]{8,20}$/.test(id) || !to || !/^\d{4}-W\d{2}$/.test(week)) return null;
  return { id, to, metric: c.metric, week, accepted: c.accepted === true };
}

class HeadToHead {
  constructor(file = path.join(process.cwd(), 'data', 'head-to-head.json')) {
    this.file = file;
    try { const d = JSON.parse(fs.readFileSync(file, 'utf8')); this.sent = (d.sent || []).map(cleanChallenge).filter(Boolean); this.accepted = (d.accepted || []).filter(x => x && typeof x.id === 'string').slice(0, 50); } catch { this.sent = []; this.accepted = []; }
  }
  save() { fs.mkdirSync(path.dirname(this.file), { recursive: true }); fs.writeFileSync(this.file, JSON.stringify({ sent: this.sent, accepted: this.accepted }, null, 2)); }
  prune(week) { this.sent = this.sent.filter(c => c.week === week); this.accepted = this.accepted.filter(a => a.week === week); }

  challenge(to, metric, week) {
    if (!METRICS[metric]) throw new Error('Pick miles, deliveries, clean deliveries or income.');
    const name = clean(to, 40); if (!name) throw new Error('Pick a friend to challenge.');
    this.prune(week);
    if (this.sent.some(c => c.to.toLowerCase() === name.toLowerCase() && c.metric === metric)) throw new Error('You already challenged them to that this week.');
    if (this.sent.length >= 5) throw new Error('Five challenges a week is the limit.');
    const c = { id: `h2h_${crypto.randomBytes(5).toString('hex')}`, to: name, metric, week, accepted: false };
    this.sent.push(c); this.save();
    return c;
  }
  accept(from, id, week, metric) { this.prune(week); if (!this.accepted.some(a => a.id === id)) { this.accepted.push({ id, from: clean(from, 40), week, metric }); this.save(); } }
  cancel(id) { const n = this.sent.length; this.sent = this.sent.filter(c => c.id !== id); if (n !== this.sent.length) this.save(); }

  // What goes to the relay: this week's challenges I sent, marked accepted if I accepted theirs.
  shareable(week) { this.prune(week); return { week, sent: this.sent.slice(0, 5), acceptedIds: this.accepted.map(a => a.id).slice(0, 20) }; }

  // roster: convoy roster (peers carry driverStats and h2h); mine: leaderboard.mine(); myName.
  status(roster = [], mine = {}, myName = '') {
    const week = mine.week?.key || '';
    this.prune(week);
    const me = { name: myName, ...pick(mine.week) };
    const peers = roster.filter(r => !r.isLocal && r.driverName);
    const friends = peers.map(r => ({ name: r.driverName, online: Boolean(r.online), sameWeek: r.driverStats?.week?.key === week, ...(r.driverStats?.week?.key === week ? pick(r.driverStats.week) : pick({})) }));
    const statsOf = name => friends.find(f => f.name.toLowerCase() === String(name).toLowerCase());
    const matchups = [];
    for (const c of this.sent) {
      const them = statsOf(c.to);
      const theirAccept = peers.find(r => r.driverName.toLowerCase() === c.to.toLowerCase())?.h2h?.acceptedIds?.includes?.(c.id);
      matchups.push(view(c, 'sent', me, them, c.to, Boolean(theirAccept)));
    }
    const incoming = [];
    for (const r of peers) {
      const h = r.h2h; if (!h || h.week !== week || !Array.isArray(h.sent)) continue;
      for (const raw of h.sent.slice(0, 5)) {
        const c = cleanChallenge(raw); if (!c || c.week !== week || c.to.toLowerCase() !== String(myName).toLowerCase()) continue;
        const accepted = this.accepted.some(a => a.id === c.id);
        const v = view(c, 'received', me, statsOf(r.driverName), r.driverName, accepted);
        if (accepted) matchups.push(v); else incoming.push(v);
      }
    }
    return { week, metrics: METRICS, me, friends, matchups, incoming };
  }
}
const pick = w => ({ miles: Math.round(num(w?.miles)), deliveries: num(w?.deliveries), clean: num(w?.clean), income: Math.round(num(w?.income)) });
function view(c, direction, me, them, otherName, accepted) {
  const mine = me[c.metric] || 0, theirs = them ? them[c.metric] || 0 : null;
  return { id: c.id, direction, metric: c.metric, label: METRICS[c.metric], other: otherName, accepted, mine, theirs, leader: theirs === null ? null : mine === theirs ? 'tie' : mine > theirs ? 'you' : 'them', theirStatsKnown: theirs !== null };
}

module.exports = { HeadToHead, METRICS, cleanChallenge };
