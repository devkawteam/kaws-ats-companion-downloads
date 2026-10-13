// Truck setup sharing: make a card of your rig (image + short code), paste a friend's code to compare,
// keep a garage of friends' setups on this device. Author: Kaw.
(() => {
  const K = window.KAW16, S = window.KAWSetupCard; if (!K || !S) return;
  const { q, esc, guard, notify, telem } = K;
  const GARAGE = 'kawSetupGarage', NOTE = 'kawSetupNote';
  let mine = null, theirs = null, garage = [];
  try { garage = JSON.parse(localStorage.getItem(GARAGE) || '[]').map(S.normalize).slice(0, 30); } catch { garage = []; }
  const store = () => { try { localStorage.setItem(GARAGE, JSON.stringify(garage)); } catch {} };

  const html = `<div class="panel"><div class="panel-head"><div class="panel-title">Setup Sharing</div></div><div class="v16-body">
    <p>Share your rig with friends: a picture card for Discord and a short code they can paste here to compare with their own truck. Only truck, trailer and build facts are included — never your licence plate or location.</p>
    <h3>My setup</h3>
    <div class="v16-row"><label style="flex:1 1 200px">Card title <input class="v16-input" id="scTitle" maxlength="60" placeholder="e.g. Midnight Hauler"></label><label style="flex:2 1 260px">Note <input class="v16-input" id="scNote" maxlength="300" placeholder="Tuning tips, why you love it…"></label></div>
    <label class="v16-toggle"><span>Mention my Livery Wizard paint job</span><input type="checkbox" id="scLivery" checked></label>
    <p class="v16-note">Engine, horsepower, brakes and chassis come from <b>Under the Hood</b> (build profile). Truck and trailer come from the game.</p>
    <canvas id="scCanvas" width="1200" height="630" style="width:100%;max-width:720px;border-radius:12px;display:block;margin:8px 0" aria-label="Setup card preview"></canvas>
    <div class="v16-row"><button class="cmd" id="scRefresh">Refresh from game</button><button class="cmd" id="scPng">Download card image</button><button class="cmd" id="scCopy">Copy share code</button><button class="cmd" id="scShare">Share…</button></div>
    <input class="v16-input" id="scCode" readonly aria-label="My share code">
    <h3>Compare with a friend</h3>
    <textarea class="v16-input" id="scPaste" placeholder="Paste a KAWSETUP1. code here"></textarea>
    <div class="v16-row"><button class="cmd" id="scLoad">Show their setup</button><button class="cmd" id="scKeep" disabled>Save to my garage</button></div>
    <p id="scErr" role="status"></p><div id="scCompare"></div>
    <h3>Friends' garage</h3><div id="scGarage"></div>
  </div></div>`;

  function liveryName() { try { return JSON.parse(localStorage.getItem('kawLiveryProject') || 'null')?.name || ''; } catch { return ''; } }
  function build() {
    const d = telem() || {};
    const me = (d.convoy?.roster || []).find(r => r.isLocal);
    mine = S.fromTelemetry(d, { driver: me?.driverName || d.driverName || 'Kaw', title: q('#scTitle').value, note: q('#scNote').value, livery: q('#scLivery').checked ? liveryName() : '' });
    q('#scCode').value = S.encode(mine);
    drawCard(q('#scCanvas'), mine);
  }

  // 1200x630 card (the size Discord and most chats preview nicely).
  function drawCard(c, card) {
    const x = c.getContext('2d'), W = c.width, H = c.height;
    const g = x.createLinearGradient(0, 0, W, H); g.addColorStop(0, '#0d1b2f'); g.addColorStop(1, '#1d3d6b'); x.fillStyle = g; x.fillRect(0, 0, W, H);
    x.fillStyle = '#ffb000'; x.fillRect(0, 0, 14, H);
    x.fillStyle = '#9fb8d8'; x.font = '600 26px "Segoe UI", Arial, sans-serif'; x.fillText(`KAW'S ATS · SETUP CARD${card.driver ? ` · ${card.driver.toUpperCase()}` : ''}`, 56, 70);
    x.fillStyle = '#fff'; x.font = '900 64px "Segoe UI", Arial, sans-serif';
    const head = card.title || [card.truck.make, card.truck.model].filter(Boolean).join(' ') || 'My truck';
    x.fillText(head.slice(0, 30), 56, 150);
    x.font = '500 30px "Segoe UI", Arial, sans-serif'; x.fillStyle = '#cfe0f5';
    if (card.title) x.fillText([card.truck.make, card.truck.model].filter(Boolean).join(' ').slice(0, 50), 56, 196);
    const rows = [
      ['Engine', [card.build.engine, card.build.hp && `${card.build.hp} hp`, card.build.torque && `${card.build.torque}`].filter(Boolean).join(' · ')],
      ['Gearbox', card.build.transmission || [card.truck.gears && `${card.truck.gears}-speed`, ({ hshifter: 'H-shifter', sequential: 'sequential', arcade: 'automatic (arcade)', automatic: 'automatic' })[String(card.truck.transmission).toLowerCase()] || card.truck.transmission].filter(Boolean).join(' ')],
      ['Differential', card.truck.diff ? `${card.truck.diff}:1` : ''],
      ['Brakes', card.build.brakes], ['Chassis', card.build.chassis || (card.truck.wheels ? `${card.truck.wheels} wheels` : '')],
      ['Trailer', [card.trailer.brand, card.trailer.name, card.trailer.chain].filter(Boolean).join(' · ')],
      ['Paint job', card.livery]
    ].filter(r => r[1]);
    let y = 270;
    for (const [k, v] of rows.slice(0, 7)) {
      x.fillStyle = '#ffb000'; x.font = '700 26px "Segoe UI", Arial, sans-serif'; x.fillText(k.toUpperCase(), 56, y);
      x.fillStyle = '#fff'; x.font = '500 30px "Segoe UI", Arial, sans-serif'; x.fillText(String(v).slice(0, 58), 300, y);
      y += 46;
    }
    if (!rows.length) { x.fillStyle = '#cfe0f5'; x.font = '500 28px "Segoe UI", Arial, sans-serif'; x.fillText('Start ATS and fill in Under the Hood to complete this card.', 56, 300); }
    if (card.note) { x.fillStyle = '#9fb8d8'; x.font = 'italic 24px "Segoe UI", Arial, sans-serif'; x.fillText(`“${card.note.slice(0, 90)}”`, 56, H - 40); }
  }

  function renderCompare() {
    if (!theirs) { q('#scCompare').innerHTML = ''; return; }
    if (!mine) build();
    const rows = S.compare(mine, theirs);
    q('#scCompare').innerHTML = `<h4>${esc(theirs.title || theirs.driver || 'Their setup')}${theirs.driver ? ` <span class="v16-note">by ${esc(theirs.driver)}</span>` : ''}</h4>
      <table style="width:100%;border-collapse:collapse"><thead><tr><th align="left"></th><th align="left">Mine</th><th align="left">Theirs</th></tr></thead><tbody>
      ${rows.map(r => `<tr style="${r.same ? '' : 'background:color-mix(in srgb,#ffb000 14%,transparent)'}"><td>${esc(r.label)}</td><td>${esc(r.mine) || '—'}</td><td>${esc(r.theirs) || '—'}</td></tr>`).join('')}</tbody></table>
      ${theirs.note ? `<p>“${esc(theirs.note)}”</p>` : ''}<canvas id="scTheirs" width="1200" height="630" style="width:100%;max-width:520px;border-radius:12px"></canvas>`;
    drawCard(q('#scTheirs'), theirs);
  }
  function renderGarage() {
    q('#scGarage').innerHTML = garage.length ? garage.map((g, i) => `<div class="v16-row" style="margin:4px 0"><span style="flex:1">${esc(g.title || [g.truck.make, g.truck.model].filter(Boolean).join(' ') || 'Setup')} <span class="v16-note">${esc(g.driver || '')}</span></span><button class="cmd" data-view="${i}">Compare</button><button class="cmd" data-del="${i}">Remove</button></div>`).join('') : '<p class="v16-note">Saved setups from friends appear here (stored on this device only).</p>';
    q('#scGarage').querySelectorAll('[data-view]').forEach(b => b.onclick = () => { theirs = garage[+b.dataset.view]; q('#scKeep').disabled = true; renderCompare(); });
    q('#scGarage').querySelectorAll('[data-del]').forEach(b => b.onclick = () => { garage.splice(+b.dataset.del, 1); store(); renderGarage(); });
  }

  K.pages.push({ name: 'setupcard', icon: '⇄', label: 'Setup Sharing', group: 'Drive', index: 5, html,
    init() {
      try { q('#scNote').value = localStorage.getItem(NOTE) || ''; } catch {}
      q('#scNote').oninput = q('#scTitle').oninput = () => { try { localStorage.setItem(NOTE, q('#scNote').value); } catch {} build(); };
      q('#scLivery').onchange = build;
      q('#scRefresh').onclick = build;
      q('#scPng').onclick = () => { build(); q('#scCanvas').toBlob(b => { const a = document.createElement('a'), u = URL.createObjectURL(b); a.href = u; a.download = `${(mine.title || mine.truck.model || 'setup').replace(/[^\w -]/g, '')}-setup.png`; a.click(); setTimeout(() => URL.revokeObjectURL(u), 2000); }, 'image/png'); };
      q('#scCopy').onclick = guard(async () => { build(); try { await navigator.clipboard.writeText(q('#scCode').value); notify('Share code copied', 'Paste it in Discord; friends paste it into Setup Sharing.', 'join'); } catch { q('#scCode').select(); } });
      q('#scShare').onclick = guard(async () => {
        build();
        const blob = await new Promise(r => q('#scCanvas').toBlob(r, 'image/png'));
        const file = new File([blob], 'kaw-setup.png', { type: 'image/png' });
        const data = { title: "My ATS setup", text: `My rig in Kaw's ATS Companion — paste this code into Setup Sharing:\n${q('#scCode').value}` };
        if (navigator.canShare?.({ files: [file] })) await navigator.share({ ...data, files: [file] });
        else if (navigator.share) await navigator.share(data);
        else { await navigator.clipboard.writeText(data.text); notify('Copied', 'Sharing is not available here, so the text was copied.', 'join'); }
      });
      q('#scLoad').onclick = () => { try { theirs = S.decode(q('#scPaste').value); q('#scErr').textContent = ''; q('#scKeep').disabled = false; renderCompare(); } catch (e) { theirs = null; q('#scErr').textContent = e.message; q('#scKeep').disabled = true; renderCompare(); } };
      q('#scKeep').onclick = () => { if (!theirs) return; garage = [theirs, ...garage.filter(g => S.encode(g) !== S.encode(theirs))].slice(0, 30); store(); renderGarage(); q('#scKeep').disabled = true; notify('Saved to your garage', theirs.title || theirs.driver || '', 'join'); };
    },
    load: () => { build(); renderGarage(); renderCompare(); } });
})();
