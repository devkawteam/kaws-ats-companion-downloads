// "Convoy together" panel (Convoy page): catch-up tip, lost contact, wrong turns, who's missing,
// regroup point, roll call, invite a friend, recent replay and the phone convoy screen. Author: Kaw.
(() => {
  const K = window.KAW16; if (!K) return;
  const { q, esc, api, notify } = K;
  const local = ['127.0.0.1', 'localhost', '[::1]'].includes(location.hostname);
  const css = document.createElement('style');
  css.textContent = `.kaw-tg h4 { margin: 12px 0 6px; font-size: 14px } .kaw-tg .row { display:flex; gap:8px; flex-wrap:wrap; align-items:center }
  .kaw-tg table { width:100%; border-collapse:collapse; font-size:13px } .kaw-tg td, .kaw-tg th { padding:4px 6px; border-bottom:1px solid color-mix(in srgb,var(--muted) 25%,transparent); text-align:left }
  .kaw-tg .tip { padding:8px 10px; border-radius:10px; background:color-mix(in srgb,var(--blue) 15%,transparent); margin:6px 0 }
  .kaw-tg .warnbox { padding:8px 10px; border-radius:10px; background:color-mix(in srgb,var(--yellow) 15%,transparent); margin:6px 0 }
  .kaw-tg .ok { color:var(--green) } .kaw-tg .bad { color:var(--red) } .kaw-tg .mut { opacity:.7 }`;
  document.head.append(css);

  const html = `<div class="panel-head"><div class="panel-title">Convoy together</div><div class="muted" id="tgLeader"></div></div><div class="v16-body kaw-tg">
    <div id="tgAlerts"></div>
    <h4>Regroup point</h4><div id="tgRegroup" class="v16-note">No regroup point set.</div>
    <div class="row" style="margin-top:6px" id="tgRegroupCtl">
      <button class="cmd small" id="tgHere" type="button">📍 Regroup at my position</button>
      <input class="v16-input" id="tgCity" list="tgCities" placeholder="…or a city (e.g. Reno)" style="max-width:220px"><datalist id="tgCities"></datalist>
      <button class="cmd small" id="tgCitySet" type="button">Set</button><button class="cmd small" id="tgClear" type="button">Clear</button></div>
    <h4>Roll call</h4><div id="tgRoll" class="v16-note">No roll call running. The leader can start one before departure.</div>
    <div class="row" style="margin-top:6px"><button class="cmd small" id="tgRollStart" type="button">📋 Start roll call</button><button class="cmd small" id="tgRollEnd" type="button">End roll call</button>
      <button class="cmd small primary" id="tgReady" type="button">✔ I'm ready</button><button class="cmd small" id="tgNotReady" type="button">Not yet</button></div>
    <h4>Invite a friend</h4>
    <div class="row"><button class="cmd small" id="tgInvite" type="button">🔗 Make an invite link</button><span class="v16-note">Your friend opens it on their PC while their Companion runs, and joins your convoy.</span></div>
    <div id="tgInviteOut" style="margin-top:6px"></div>
    <h4>More</h4>
    <div class="row"><button class="cmd small" id="tgReplay" type="button">⏪ Replay the last 45 minutes</button>
      <a class="cmd small" href="/convoy-screen.html" target="_blank" rel="noopener">📱 Convoy screen (phone / tablet)</a>
      <span class="v16-note">For a phone, pair it first in Devices &amp; Screens, then open the convoy screen there.</span></div>
  </div>`;

  function mount() {
    const pg = q('#page-convoy'); if (!pg || q('#kawTogether')) return;
    const box = document.createElement('div'); box.className = 'panel'; box.id = 'kawTogether'; box.style.marginBottom = '10px'; box.innerHTML = html;
    const cc = pg.querySelector('.kaw-cc');
    if (cc) cc.insertAdjacentElement('afterend', box); else pg.prepend(box);
    wire();
  }
  const post = (path, body) => fetch(path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body || {}) }).then(r => r.json()).then(r => { if (r.ok === false) throw new Error(r.error || 'Failed'); return r; });
  const act = fn => async () => { try { await fn(); render(); } catch (e) { notify('Convoy', e.message, 'leave'); } };
  function wire() {
    q('#tgHere').onclick = act(() => post('/api/together/regroup', { here: true }));
    q('#tgCitySet').onclick = act(() => { const v = q('#tgCity').value.trim(); const [city, state] = v.split(/,\s*/); return post('/api/together/regroup', { city, state }); });
    q('#tgClear').onclick = act(() => post('/api/together/regroup', { clear: true }));
    q('#tgRollStart').onclick = act(() => post('/api/together/rollcall', {}));
    q('#tgRollEnd').onclick = act(() => post('/api/together/rollcall', { end: true }));
    q('#tgReady').onclick = act(() => post('/api/together/ready', { ready: true }));
    q('#tgNotReady').onclick = act(() => post('/api/together/ready', { ready: false }));
    q('#tgInvite').onclick = act(async () => {
      const r = await api('/api/together/invite');
      const out = q('#tgInviteOut');
      out.innerHTML = `<div class="warnbox">This link contains your convoy code${r.includesKey ? ' and the relay key' : ''}. Share it only with friends you'd let into your convoy.</div>
        <div class="row"><input class="v16-input" id="tgLink" readonly value="${esc(r.link)}" style="flex:1 1 320px"><button class="cmd small" id="tgCopy" type="button">Copy</button></div><div id="tgQr" style="margin-top:8px;background:#fff;display:inline-block;padding:8px;border-radius:8px"></div>`;
      q('#tgCopy').onclick = () => navigator.clipboard.writeText(r.link).then(() => notify('Invite copied', 'Send it to your friend (Discord DM etc.).', 'join'));
      if (typeof QRCode !== 'undefined') new QRCode(q('#tgQr'), { text: r.link, width: 200, height: 200, correctLevel: QRCode.CorrectLevel.L });
    });
    q('#tgReplay').onclick = () => K.openReplay ? K.openReplay('recent', 'last 45 minutes') : notify('Replay', 'Replay is not available.', 'leave');
    for (const id of ['tgHere', 'tgCitySet', 'tgClear', 'tgRollStart', 'tgRollEnd', 'tgReady', 'tgNotReady', 'tgInvite']) q('#' + id).disabled = !local;
    if (local) api('/api/together/cities').then(r => { q('#tgCities').innerHTML = (r.cities || []).map(c => `<option value="${esc(c.name)}${c.state ? `, ${esc(c.state)}` : ''}">`).join(''); }).catch(() => {});
  }

  function render() {
    const box = q('#kawTogether'); if (!box) return;
    const tg = K.telem?.()?.together || {};
    q('#tgLeader').textContent = tg.leader ? `Leader: ${tg.leader}` : 'No leader chosen (Convoy Hub) — catch-up and wrong-turn tips need one.';
    const parts = [];
    if (tg.catchUp) parts.push(`<div class="tip">🚚 ${esc(tg.catchUp.text)}</div>`);
    for (const l of tg.lost || []) parts.push(`<div class="warnbox">📡 <b>${esc(l.driverName)}</b> dropped out of the convoy ${l.minutesAgo || 1} min ago${l.near ? ` near ${esc(l.near)}` : ''}.</div>`);
    for (const w of tg.wrongTurns || []) parts.push(`<div class="warnbox">↩ <b>${esc(w.driverName)}</b> may have taken a wrong turn: ${esc(w.detail)}</div>`);
    if ((tg.missing || []).length) parts.push(`<div class="warnbox"><b>Missing from ${esc(tg.missing[0].event)}:</b><ul style="margin:4px 0 0 18px">${tg.missing.map(m => `<li><b>${esc(m.driverName)}</b> — ${esc(m.reason)}</li>`).join('')}</ul></div>`);
    q('#tgAlerts').innerHTML = parts.join('');
    const g = tg.regroup;
    q('#tgRegroup').innerHTML = g ? `<b>${esc(g.name)}</b> — set by ${esc(g.by || '?')}${g.miles != null ? ` · you're about <b>${g.miles} mi</b> away${g.etaMinutes != null ? ` (~${g.etaMinutes} min)` : ''}` : ''}${g.note ? `<br>${esc(g.note)}` : ''}
      ${(g.drivers || []).length ? `<div style="margin-top:4px">${g.drivers.map(x => `${esc(x.driverName)}${x.isLocal ? ' (you)' : ''}: ${x.miles} mi`).join(' · ')}</div>` : ''}` : 'No regroup point set.';
    const rc = tg.rollCall;
    q('#tgRoll').innerHTML = rc ? `<b>Roll call</b> by ${esc(rc.by || '?')} — ${rc.readyCount}/${rc.total} ready${rc.waiting.length ? ` · waiting for ${rc.waiting.map(esc).join(', ')}` : ''}
      <table><tr><th>Driver</th><th>Ready</th><th>In truck</th><th>Job</th><th>Location</th><th>Maps</th><th>Destination</th></tr>${rc.answers.map(a => {
        const c = a.checks || {}, mark = v => v === true ? '<span class="ok">✔</span>' : v === false ? '<span class="bad">✖</span>' : '<span class="mut">—</span>';
        return `<tr><td>${esc(a.driverName)}${a.isLocal ? ' (you)' : ''}</td><td>${!a.answered ? '<span class="mut">no answer</span>' : a.ready ? `<span class="ok">✔ ${a.confirmed ? 'ready' : 'looks ready'}</span>` : '<span class="bad">not yet</span>'}</td><td>${mark(a.answered ? c.inTruck : null)}</td><td>${mark(a.answered ? c.jobLoaded : null)}</td><td>${mark(a.answered ? c.sharingLocation : null)}</td><td>${mark(a.answered ? c.mapsOk : null)}</td><td>${esc(c.destination || '')}</td></tr>`;
      }).join('')}</table>` : 'No roll call running. The leader can start one before departure.';
    q('#tgRollEnd').hidden = !tg.hasMyRollCall; q('#tgReady').hidden = q('#tgNotReady').hidden = !rc;
  }
  K.onReady.push(() => { mount(); render(); setInterval(() => { if (K.currentPage?.() === 'convoy') { mount(); render(); } }, 3000); });
})();
