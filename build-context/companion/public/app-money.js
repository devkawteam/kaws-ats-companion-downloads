// Fuel & money tracker: income vs estimated fuel cost, cost per mile, best cargo / routes / trucks.
(() => {
  const K = window.KAW16; if (!K) return;
  const { q, api, esc, guard, notify } = K;
  const local = ['127.0.0.1', 'localhost', '[::1]'].includes(location.hostname);
  const usd = n => `${n < 0 ? '−' : ''}$${Math.abs(Math.round(n || 0)).toLocaleString('en-US')}`;
  const cpm = n => `$${(n || 0).toFixed(2)}/mi`;
  let days = 30;
  try { days = Number(localStorage.getItem('kawMoneyDays') ?? 30); } catch {}

  const html = `<div class="panel"><div class="panel-head"><div class="panel-title">Fuel & Money</div></div><div class="v16-body">
    <p>What your deliveries really earn after fuel. Income comes from the game; fuel cost is the gallons you burned × your fuel price below (an estimate — the Companion can't see what you paid at the pump).</p>
    <div class="v16-row"><label style="flex:0 1 180px">Period <select class="v16-input" id="mnDays"><option value="7">Last 7 days</option><option value="30">Last 30 days</option><option value="90">Last 90 days</option><option value="0">All time</option></select></label>
      <label style="flex:0 1 180px">Fuel price ($/gal) <input class="v16-input" id="mnPrice" type="number" min="0.5" max="20" step="0.01"></label><button class="cmd" id="mnSave">Save price</button></div>
    <div id="mnCards" class="v16-row" style="gap:10px;margin:10px 0"></div>
    <h3>Daily net</h3><div id="mnChart" style="display:flex;align-items:flex-end;gap:3px;height:140px;border-bottom:1px solid #8884;padding-top:8px"></div>
    <div class="v16-row" style="align-items:flex-start;gap:16px">
      <div style="flex:1 1 320px"><h3>Best cargo (net per mile)</h3><div id="mnCargo"></div></div>
      <div style="flex:1 1 320px"><h3>Best routes</h3><div id="mnRoutes"></div></div>
    </div>
    <div class="v16-row" style="align-items:flex-start;gap:16px">
      <div style="flex:1 1 320px"><h3>Trucks</h3><div id="mnTrucks"></div></div>
      <div style="flex:1 1 320px"><h3>Best and worst trips</h3><div id="mnTrips"></div></div>
    </div>
  </div></div>`;

  const card = (label, value, sub = '') => `<div class="panel" style="flex:1 1 150px;padding:12px"><div class="v16-note">${label}</div><div style="font-size:24px;font-weight:800">${value}</div><div class="v16-note">${sub}</div></div>`;
  const table = (rows, label) => rows.length ? `<table style="width:100%;border-collapse:collapse;font-size:14px"><thead><tr><th align="left">${label}</th><th align="right">Trips</th><th align="right">Net</th><th align="right">Net/mi</th></tr></thead><tbody>${rows.map(r => `<tr><td>${esc(r.key)}</td><td align="right">${r.trips}</td><td align="right">${usd(r.net)}</td><td align="right">${cpm(r.netPerMile)}</td></tr>`).join('')}</tbody></table>` : '<p class="v16-note">No deliveries in this period yet.</p>';

  async function load() {
    const r = await api(`/api/money?days=${days}`);
    q('#mnDays').value = String(days); if (document.activeElement !== q('#mnPrice')) q('#mnPrice').value = r.fuelPrice;
    const t = r.totals;
    q('#mnCards').innerHTML = card('Income', usd(t.income), `${t.trips} deliveries · ${t.miles.toLocaleString('en-US')} mi`) + card('Fuel (est.)', usd(t.fuelCost), `${t.gallons.toLocaleString('en-US')} gal${t.mpg ? ` · ${t.mpg} mpg` : ''}`)
      + card('Net', usd(t.net), `${cpm(t.netPerMile)} after fuel`) + card('Fuel cost per mile', cpm(t.costPerMile), `income ${cpm(t.incomePerMile)}`);
    const max = Math.max(1, ...r.daily.map(d => Math.abs(d.net)));
    q('#mnChart').innerHTML = r.daily.length ? r.daily.map(d => `<div title="${esc(d.date)}: net ${usd(d.net)}" style="flex:1;min-width:6px;max-width:28px;height:${Math.max(2, Math.abs(d.net) / max * 100)}%;background:${d.net >= 0 ? '#2ecc71' : '#e74c3c'};border-radius:3px 3px 0 0"></div>`).join('') : '<p class="v16-note">No deliveries in this period yet.</p>';
    q('#mnCargo').innerHTML = table(r.byCargo, 'Cargo');
    q('#mnRoutes').innerHTML = table(r.byRoute, 'Route');
    q('#mnTrucks').innerHTML = table(r.byTruck, 'Truck');
    const row = x => `<tr><td>${esc(x.cargo)}${x.route ? `<div class="v16-note">${esc(x.route)}</div>` : ''}</td><td align="right">${usd(x.net)}</td><td align="right">${cpm(x.netPerMile)}</td></tr>`;
    q('#mnTrips').innerHTML = r.best.length ? `<table style="width:100%;border-collapse:collapse;font-size:14px"><tbody><tr><th colspan="3" align="left">🏆 Best</th></tr>${r.best.map(row).join('')}<tr><th colspan="3" align="left" style="padding-top:8px">📉 Worst</th></tr>${r.worst.map(row).join('')}</tbody></table>` : '<p class="v16-note">Deliver a few loads to see your best and worst runs.</p>';
  }

  K.pages.push({ name: 'money', icon: '$', label: 'Fuel & Money', group: 'Work', index: 3, html,
    init() {
      q('#mnDays').onchange = guard(async () => { days = +q('#mnDays').value; try { localStorage.setItem('kawMoneyDays', String(days)); } catch {} await load(); });
      q('#mnSave').disabled = q('#mnPrice').disabled = !local;
      q('#mnSave').onclick = guard(async () => { await api('/api/money/settings', { method: 'POST', body: { fuelPrice: +q('#mnPrice').value } }); notify('Fuel price saved', `$${(+q('#mnPrice').value).toFixed(2)} per gallon`, 'join'); await load(); });
    },
    load: () => load().catch(e => { q('#mnCards').textContent = e.message; }) });
})();
