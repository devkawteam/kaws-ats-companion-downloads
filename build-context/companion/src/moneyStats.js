// Fuel and money tracker: income vs estimated fuel cost per trip, cost per mile, and the most
// profitable cargo, routes and trucks. The Companion sees fuel burned, not the price you paid at the
// pump, so fuel cost = gallons used x your fuel price setting (an estimate). Author: Kaw.
'use strict';
const num = v => (Number.isFinite(Number(v)) ? Number(v) : 0);
const r2 = v => Math.round(v * 100) / 100;

function summarise(rows) {
  const miles = rows.reduce((s, t) => s + t.miles, 0), income = rows.reduce((s, t) => s + t.income, 0), fuelCost = rows.reduce((s, t) => s + t.fuelCost, 0);
  const gallons = rows.reduce((s, t) => s + t.gallons, 0);
  return {
    trips: rows.length, miles: Math.round(miles), income: Math.round(income), fuelCost: Math.round(fuelCost), net: Math.round(income - fuelCost), gallons: Math.round(gallons),
    incomePerMile: miles ? r2(income / miles) : 0, costPerMile: miles ? r2(fuelCost / miles) : 0, netPerMile: miles ? r2((income - fuelCost) / miles) : 0, mpg: gallons ? r2(miles / gallons) : null
  };
}

function groupBy(rows, keyFn, min = 1) {
  const m = new Map();
  for (const t of rows) { const k = keyFn(t); if (!k) continue; if (!m.has(k)) m.set(k, []); m.get(k).push(t); }
  return [...m.entries()].filter(([, list]) => list.length >= min).map(([key, list]) => ({ key, ...summarise(list) })).sort((a, b) => b.netPerMile - a.netPerMile);
}

// trips: tripLogger records. opts: { fuelPrice ($/gal), days (0 = all), now }
function moneyStats(trips = [], { fuelPrice = 4.2, days = 30, now = Date.now() } = {}) {
  const price = Math.max(0, Math.min(20, num(fuelPrice) || 0));
  const since = days > 0 ? now - days * 86400000 : 0;
  const rows = trips.filter(t => t.status === 'delivered' && Date.parse(t.endedAt || t.startedAt) >= since).map(t => {
    const miles = num(t.milesDriven), gallons = num(t.fuelUsedGallons), income = num(t.deliveredIncome), fuelCost = gallons * price;
    return {
      id: t.id, endedAt: t.endedAt, cargo: t.cargo || 'Unknown cargo', route: t.originCity && t.destinationCity ? `${t.originCity} → ${t.destinationCity}` : null,
      truck: [t.truckMake, t.truckModel].filter(Boolean).join(' ') || null, miles, gallons, income, fuelCost: r2(fuelCost), net: r2(income - fuelCost),
      netPerMile: miles > 0 ? r2((income - fuelCost) / miles) : 0, mpg: gallons > 0 ? r2(miles / gallons) : null
    };
  });
  // Daily net for a small chart (local dates).
  const daily = new Map();
  for (const t of rows) { const d = new Date(t.endedAt).toLocaleDateString('en-CA'); const e = daily.get(d) || { date: d, income: 0, fuelCost: 0 }; e.income += t.income; e.fuelCost += t.fuelCost; daily.set(d, e); }
  const ranked = rows.filter(t => t.miles >= 10).sort((a, b) => b.netPerMile - a.netPerMile);
  return {
    fuelPrice: price, days, totals: summarise(rows),
    byCargo: groupBy(rows, t => t.cargo).slice(0, 12),
    byRoute: groupBy(rows, t => t.route).slice(0, 12),
    byTruck: groupBy(rows, t => t.truck),
    best: ranked.slice(0, 5), worst: ranked.slice(-5).reverse(),
    daily: [...daily.values()].sort((a, b) => a.date.localeCompare(b.date)).map(d => ({ ...d, income: Math.round(d.income), fuelCost: Math.round(d.fuelCost), net: Math.round(d.income - d.fuelCost) })),
    trips: rows.sort((a, b) => String(b.endedAt).localeCompare(String(a.endedAt))).slice(0, 100)
  };
}

module.exports = { moneyStats };
