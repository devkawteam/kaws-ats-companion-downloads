// "Can my convoy see me?" — one checklist on the Convoy, Radar and Convoy Hub pages explaining exactly why
// you (or your friends) might be missing from the map and tracker, with the fix for each item. Author: Kaw.
(() => {
  const K = window.KAW16; if (!K) return;
  const { q, esc, api } = K;
  const css = document.createElement('style');
  css.textContent = `.kaw-cc { margin: 0 0 10px } .kaw-cc ul { list-style: none; margin: 6px 0 0; padding: 0 }
  .kaw-cc li { padding: 4px 0; line-height: 1.45 } .kaw-cc .ok { color: var(--green) } .kaw-cc .bad { color: var(--red) } .kaw-cc .warn { color: var(--yellow) }
  .kaw-cc summary { cursor: pointer; font-weight: 800 }`;
  document.head.append(css);

  let settings = null, settingsAt = 0;
  async function check() {
    if (!settings || Date.now() - settingsAt > 30000) { try { settings = await api('/api/settings'); settingsAt = Date.now(); } catch {} }
    let relay = null; try { relay = await api('/api/relay'); } catch {}
    const d = K.telem?.() || {};
    const rs = settings?.relay || {};
    const roster = d.convoy?.roster || [];
    const others = roster.filter(r => !r.isLocal && r.online);
    const sharesLocation = d.buildPrivacy?.shareLocation !== false;
    const items = [];
    const add = (cls, text, fix = '') => items.push(`<li><span class="${cls}">${cls === 'ok' ? '✔' : cls === 'bad' ? '✖' : '⚠'}</span> ${text}${fix ? ` <span class="v16-note">— ${fix}</span>` : ''}</li>`);
    // 1. Sharing on, and accepted by the relay.
    const ps = relay?.pushState;
    if (!rs.enabled || ps === 'off') add('bad', '<b>Convoy sharing is off</b> on this PC.', 'turn it on in “Join a convoy” below (or use KAW\'s one-click connect link from Discord: /companion setup).');
    else if (ps === 'rejected') add('bad', '<b>The convoy relay refused this Companion</b>, so you are NOT in the convoy: nobody can see you and you can\'t see them.', 'get the relay key from KAW (Discord: /companion setup) and enter it in “Join a convoy” below.');
    else if (ps === 'failing') add('warn', 'Your updates are not reaching the convoy relay right now.', esc(relay.pushDetail || ''));
    else if (ps === 'ok') add('ok', 'You are connected to the convoy relay and sharing.');
    else add('warn', 'Waiting for the first update to reach the convoy relay…');
    // 2. Same convoy code as your friends.
    if (rs.pairingCode) add('ok', `Convoy code is set (<b>${esc(rs.pairingCode.slice(0, 3))}…</b>). Everyone who should see each other needs the <b>same</b> code.`);
    else add('warn', 'No convoy code set: you are in the shared public room.', 'to ride with friends, all of you enter the same convoy code in “Join a convoy” below.');
    // 3. Location sharing (privacy).
    if (sharesLocation) add('ok', 'Your location is shared with the convoy.');
    else add('bad', '<b>Location sharing is off</b> (Convoy Sharing &amp; Privacy), so you never appear on their maps.', 'turn on “Share location” in Under the Hood → Convoy Sharing & Privacy.');
    // 4. Game telemetry / your own position.
    if (!d.connected) add('warn', 'ATS is not sending telemetry yet, so there is no position to share.', 'start a drive with the telemetry plugin installed.');
    else if (d.positioning?.x == null) add('warn', 'ATS is connected but has not reported a position yet.');
    else add('ok', `Your truck's position is known${d.geo?.near ? ` (near ${esc(d.geo.near)})` : ''}.`);
    // 5. Who else is here.
    if (others.length) add('ok', `${others.length} other driver${others.length === 1 ? '' : 's'} online in your convoy: ${others.slice(0, 8).map(r => esc(r.driverName)).join(', ')}.`);
    else add('warn', 'No other drivers online in your convoy right now.', 'if friends are driving, check that they also pass these checks and use the same convoy code.');
    const bad = items.filter(x => /class="bad"/.test(x)).length, warn = items.filter(x => /class="warn"/.test(x)).length;
    const form = settings?.canEdit ? `<div class="v16-row" style="margin-top:8px;gap:8px;align-items:end;flex-wrap:wrap"><b style="flex:1 0 100%">Join a convoy</b>
      <label class="v16-toggle" style="flex:0 0 auto"><span>Share with convoy</span><input type="checkbox" class="cc-on" ${rs.enabled ? 'checked' : ''}></label>
      <label style="flex:1 1 160px">Convoy code<input class="v16-input cc-code" maxlength="64" value="${esc(rs.pairingCode || '')}" placeholder="same code as your friends"></label>
      <label style="flex:1 1 200px">Relay key<input class="v16-input cc-key" type="password" autocomplete="off" placeholder="${rs.hasApiKey ? 'saved — leave empty to keep it' : 'from KAW (Discord: /companion setup)'}"></label>
      <button class="cmd primary cc-save" type="button">Save</button><span class="v16-note cc-msg"></span></div>` : '<div class="v16-note" style="margin-top:6px">Convoy settings can only be changed on the PC running the Companion.</div>';
    return { html: `<ul>${items.join('')}</ul>${form}`, summary: bad ? `✖ ${bad} problem${bad === 1 ? '' : 's'} — your convoy may not see you` : warn ? '⚠ Mostly OK — see notes' : '✔ Your convoy can see you', open: bad > 0 };
  }

  const PAGES = ['convoy', 'radar', 'hub', 'navigation'];
  function mount(page) {
    const pg = q(`#page-${page}`); if (!pg) return null;
    let box = pg.querySelector('.kaw-cc');
    if (!box) {
      box = document.createElement('details');
      box.className = 'panel kaw-cc';
      box.style.padding = '10px 14px';
      box.innerHTML = '<summary>Can my convoy see me? <span class="kaw-cc-sum v16-note">checking…</span></summary><div class="kaw-cc-body v16-note">Checking…</div>';
      pg.prepend(box);
    }
    return box;
  }
  let busy = false, userToggled = new Set();
  async function refresh() {
    const page = K.currentPage?.();
    if (!PAGES.includes(page) || busy) return;
    busy = true;
    try {
      const box = mount(page); if (!box) return;
      if (!box.__wired) { box.__wired = true; box.addEventListener('toggle', () => userToggled.add(page)); }
      const r = await check();
      box.querySelector('.kaw-cc-sum').textContent = `— ${r.summary}`;
      const body = box.querySelector('.kaw-cc-body');
      // Don't redraw while the driver is typing in the form.
      if (!body.contains(document.activeElement) || !/INPUT/.test(document.activeElement.tagName)) { body.innerHTML = r.html; wireForm(body); }
      if (!userToggled.has(page)) box.open = r.open;
    } finally { busy = false; }
  }
  function wireForm(body) {
    const save = body.querySelector('.cc-save'); if (!save) return;
    save.onclick = async () => {
      const msg = body.querySelector('.cc-msg');
      const patch = { enabled: body.querySelector('.cc-on').checked };
      const code = body.querySelector('.cc-code').value.trim(), key = body.querySelector('.cc-key').value.trim();
      if (code) patch.pairingCode = code;
      if (key) patch.apiKey = key;
      try {
        const r = await fetch('/api/settings/relay', { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify(patch) }).then(x => x.json());
        if (r.ok === false || r.error) throw new Error(r.error || 'Could not save.');
        msg.textContent = 'Saved. Checking the connection…'; settings = null;
        setTimeout(refresh, 4000);
      } catch (e) { msg.textContent = e.message; }
    };
  }
  K.onReady.push(() => { refresh(); setInterval(refresh, 5000); });
  window.KAWConvoyCheck = { check };
})();
