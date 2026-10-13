// Head-to-head weekly challenges with friends on the convoy relay.
(() => {
  const K = window.KAW16; if (!K) return;
  const { q, api, esc, guard, notify } = K;
  const fmt = (metric, v) => v == null ? '—' : metric === 'income' ? `$${Math.round(v).toLocaleString('en-US')}` : metric === 'miles' ? `${Math.round(v).toLocaleString('en-US')} mi` : String(v);

  const html = `<div class="panel"><div class="panel-head"><div class="panel-title">Head-to-Head</div><div class="muted" id="h2hHead" style="font-size:12px"></div></div><div class="v16-body">
    <p>Friendly weekly races with friends on your convoy relay: most miles, deliveries, clean deliveries or income, Monday to Sunday. Uses the weekly stats every Companion already shares.</p>
    <div id="h2hIncoming"></div>
    <h3>This week's matchups</h3><div id="h2hMatchups"></div>
    <h3>Challenge a friend</h3>
    <div class="v16-row"><select class="v16-input" id="h2hFriend" style="flex:1 1 200px" aria-label="Friend"></select><select class="v16-input" id="h2hMetric" style="flex:1 1 200px" aria-label="Challenge"></select><button class="cmd" id="h2hSend">🏁 Challenge</button></div>
    <h3>Friends this week</h3><div id="h2hFriends"></div>
  </div></div>`;

  function bar(m) {
    const max = Math.max(1, m.mine || 0, m.theirs || 0);
    const row = (who, v, me) => `<div class="v16-row" style="gap:8px"><span style="width:110px">${esc(who)}</span><div style="flex:1;height:14px;background:#8883;border-radius:7px;overflow:hidden"><div style="height:100%;width:${Math.round((v || 0) / max * 100)}%;background:${me ? 'var(--blue)' : 'var(--orange)'}"></div></div><b style="width:110px;text-align:right">${fmt(m.metric, v)}</b></div>`;
    return row('You', m.mine, true) + row(m.other, m.theirs, false);
  }
  async function load() {
    const s = await api('/api/h2h');
    q('#h2hHead').textContent = s.week ? `Week ${s.week}` : '';
    q('#h2hMetric').innerHTML = Object.entries(s.metrics).map(([k, v]) => `<option value="${k}">${esc(v)}</option>`).join('');
    const friends = s.friends.filter(f => f.sameWeek);
    q('#h2hFriend').innerHTML = s.friends.length ? s.friends.map(f => `<option>${esc(f.name)}</option>`).join('') : '<option value="">No friends on the relay yet</option>';
    q('#h2hSend').disabled = !s.friends.length;
    q('#h2hIncoming').innerHTML = s.incoming.map(m => `<div class="panel" style="padding:10px 12px;margin:6px 0;border-left:5px solid var(--orange)"><b>${esc(m.other)}</b> challenged you: <b>${esc(m.label)}</b> this week. <button class="cmd small primary" data-accept="${esc(m.id)}" data-from="${esc(m.other)}" data-metric="${esc(m.metric)}">Accept</button></div>`).join('');
    q('#h2hIncoming').querySelectorAll('[data-accept]').forEach(b => b.onclick = guard(async () => { await api('/api/h2h/accept', { method: 'POST', body: { id: b.dataset.accept, from: b.dataset.from, metric: b.dataset.metric } }); notify('Challenge accepted', `Good luck against ${b.dataset.from}!`, 'join'); load(); }));
    q('#h2hMatchups').innerHTML = s.matchups.length ? s.matchups.map(m => `<div class="panel" style="padding:10px 12px;margin:6px 0"><div class="v16-row" style="justify-content:space-between"><b>${esc(m.label)} vs ${esc(m.other)}</b><span class="v16-pill ${m.leader === 'you' ? 'good' : m.leader === 'them' ? 'warn' : 'info'}">${m.leader === 'you' ? "You're ahead" : m.leader === 'them' ? `${esc(m.other)} leads` : m.leader === 'tie' ? 'Tied' : 'Waiting for their stats'}</span></div>
      ${bar(m)}<div class="v16-note">${m.direction === 'sent' ? (m.accepted ? 'They accepted.' : 'Waiting for them to accept (it still counts).') : 'You accepted.'}${m.direction === 'sent' ? ` <button class="cmd small" data-cancel="${esc(m.id)}">Cancel</button>` : ''}</div></div>`).join('') : '<p class="v16-note">No challenges yet this week.</p>';
    q('#h2hMatchups').querySelectorAll('[data-cancel]').forEach(b => b.onclick = guard(async () => { await api('/api/h2h/cancel', { method: 'POST', body: { id: b.dataset.cancel } }); load(); }));
    q('#h2hFriends').innerHTML = `<table style="width:100%;border-collapse:collapse;font-size:14px"><thead><tr><th align="left">Driver</th><th align="right">Miles</th><th align="right">Deliveries</th><th align="right">Clean</th><th align="right">Income</th></tr></thead><tbody>
      <tr><td><b>You</b></td><td align="right">${fmt('miles', s.me.miles)}</td><td align="right">${s.me.deliveries}</td><td align="right">${s.me.clean}</td><td align="right">${fmt('income', s.me.income)}</td></tr>
      ${s.friends.map(f => `<tr><td>${f.online ? '🟢' : '⚪'} ${esc(f.name)}</td>${f.sameWeek ? `<td align="right">${fmt('miles', f.miles)}</td><td align="right">${f.deliveries}</td><td align="right">${f.clean}</td><td align="right">${fmt('income', f.income)}</td>` : '<td colspan="4" align="right" class="v16-note">no stats this week yet</td>'}</tr>`).join('')}</tbody></table>${friends.length ? '' : '<p class="v16-note">Friends appear when they drive with the Companion on your convoy relay.</p>'}`;
  }

  K.pages.push({ name: 'h2h', icon: '🏁', label: 'Head-to-Head', group: 'Convoy', index: 5, html,
    init() { q('#h2hSend').onclick = guard(async () => { const to = q('#h2hFriend').value; if (!to) return; await api('/api/h2h/challenge', { method: 'POST', body: { to, metric: q('#h2hMetric').value } }); notify('Challenge sent', `${to} sees it within a few seconds.`, 'join'); load(); }); },
    load: () => load().catch(e => { q('#h2hMatchups').textContent = e.message; }) });
})();
