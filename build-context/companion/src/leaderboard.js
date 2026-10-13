// Leaderboards & seasons. Each Companion shares a small summary of its own trips (this week, last week,
// this season = calendar month, all time); every Companion ranks everyone it knows about.

const fs = require('node:fs');
const path = require('node:path');

const STATE_FILE = path.join(process.cwd(), 'data', 'leaderboard-state.json');
const num = v => (Number.isFinite(Number(v)) ? Number(v) : 0);

// Monday-based week key like "2026-W39" (local time).
function weekKey(d = new Date()) {
  const t = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const day = (t.getDay() + 6) % 7;           // Mon=0
  t.setDate(t.getDate() - day + 3);           // Thursday of this week
  const firstThu = new Date(t.getFullYear(), 0, 4);
  const week = 1 + Math.round(((t - firstThu) / 86400000 - 3 + ((firstThu.getDay() + 6) % 7)) / 7);
  return `${t.getFullYear()}-W${String(week).padStart(2, '0')}`;
}
const seasonKey = (d = new Date()) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
const seasonName = k => new Date(`${k}-15T12:00:00`).toLocaleDateString('en-US', { month: 'long', year: 'numeric' });

function summarize(trips) {
  const delivered = trips.filter(t => t.status === 'delivered');
  const eco = trips.map(t => t.eco?.score).filter(v => Number.isFinite(v));
  const moving = trips.reduce((s, t) => s + num(t.movingSeconds), 0);
  return {
    deliveries: delivered.length,
    miles: Math.round(trips.reduce((s, t) => s + num(t.milesDriven), 0) * 10) / 10,
    income: Math.round(delivered.reduce((s, t) => s + num(t.deliveredIncome), 0)),
    clean: delivered.filter(t => num(t.endCargoDamage) <= 0.01).length,
    eco: eco.length ? Math.round(eco.reduce((a, b) => a + b, 0) / eco.length) : null,
    speedingPct: moving > 0 ? Math.round((trips.reduce((s, t) => s + num(t.speedingSeconds), 0) / moving) * 1000) / 10 : null
  };
}

function myStats(allTrips = []) {
  const now = new Date();
  const wk = weekKey(now), lastWk = weekKey(new Date(now - 7 * 86400000)), season = seasonKey(now);
  const when = t => new Date(t.endedAt || t.startedAt);
  return {
    week: { key: wk, ...summarize(allTrips.filter(t => weekKey(when(t)) === wk)) },
    lastWeek: { key: lastWk, ...summarize(allTrips.filter(t => weekKey(when(t)) === lastWk)) },
    season: { key: season, ...summarize(allTrips.filter(t => seasonKey(when(t)) === season)) },
    allTime: summarize(allTrips),
    updatedAt: now.toISOString()
  };
}

const METRICS = [
  ['miles', 'Most miles', v => `${Math.round(v).toLocaleString('en-US')} mi`, 'desc'],
  ['income', 'Top earner', v => `$${Math.round(v).toLocaleString('en-US')}`, 'desc'],
  ['deliveries', 'Most deliveries', v => `${v}`, 'desc'],
  ['clean', 'Cleanest loads', v => `${v} clean`, 'desc'],
  ['eco', 'Best eco driver', v => `${v}/100`, 'desc'],
  ['speedingPct', 'Least speeding', v => `${v}% of drive time`, 'asc']
];

// period: week | lastWeek | season | allTime
function board(roster = [], mine, period = 'week', myName = 'You') {
  const wantKey = mine?.[period]?.key;
  const rows = [{ driverName: myName, isLocal: true, online: true, ...(mine?.[period] || {}) }];
  for (const r of roster) {
    if (r.isLocal || !r.driverStats) continue;
    const s = r.driverStats[period];
    // Only compare the same week/season (a driver who has been offline may still report last week's).
    if (!s || (wantKey && s.key && s.key !== wantKey)) continue;
    rows.push({ driverName: r.driverName, isLocal: false, online: Boolean(r.online), ...s });
  }
  const boards = METRICS.map(([k, label, fmt, dir]) => {
    const ranked = rows.filter(r => r[k] !== null && r[k] !== undefined && (k !== 'speedingPct' && k !== 'eco' ? true : r.deliveries > 0))
      .sort((a, b) => (dir === 'asc' ? a[k] - b[k] : b[k] - a[k]));
    return { key: k, label, rows: ranked.slice(0, 10).map((r, i) => ({ rank: i + 1, driverName: r.driverName, isLocal: r.isLocal, online: r.online, value: r[k], display: fmt(r[k]) })) };
  });
  return { period, key: wantKey || null, title: period === 'season' ? `Season: ${seasonName(mine.season.key)}` : period === 'week' ? 'This week' : period === 'lastWeek' ? 'Last week' : 'All time', drivers: rows.length, boards };
}

class Leaderboard {
  constructor({ trips, discord, driverName }) {
    Object.assign(this, { trips, discord, driverName });
    try { this.state = JSON.parse(fs.readFileSync(STATE_FILE, 'utf8')); } catch { this.state = {}; }
  }
  mine() { return myStats(this.trips.getRecent(100000)); }
  get(roster, period) { return board(roster, this.mine(), period, this.driverName); }

  // Monday recap of last week (only if this driver turned it on).
  maybeRecap(roster) {
    if (!this.discord?.settings?.weeklyRecap || !this.discord.ready()) return;
    const now = new Date();
    if ((now.getDay() + 6) % 7 !== 0 || now.getHours() < 9) return;   // Monday from 9:00
    const b = this.get(roster, 'lastWeek');
    if (!b.key || this.state.lastRecap === b.key) return;
    this.state.lastRecap = b.key;
    try { fs.mkdirSync(path.dirname(STATE_FILE), { recursive: true }); fs.writeFileSync(STATE_FILE, JSON.stringify(this.state)); } catch {}
    const medal = i => ['🥇', '🥈', '🥉'][i] || `${i + 1}.`;
    const fields = b.boards.filter(x => x.rows.length).map(x => ({ name: x.label, value: x.rows.slice(0, 3).map((r, i) => `${medal(i)} ${r.driverName} — ${r.display}`).join('\n'), inline: true }));
    if (fields.length) this.discord.post({ title: `🏆 Weekly convoy leaderboard (${b.key})`, description: `${b.drivers} driver(s) this week. Keep on truckin'!`, color: 0xffd257, fields });
  }
}

module.exports = { Leaderboard, myStats, weekKey, seasonKey };
