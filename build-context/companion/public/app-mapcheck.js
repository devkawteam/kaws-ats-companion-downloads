// Map pack check: owned ATS states vs what your plans, convoy routes, events and friends need.
(() => {
  const K = window.KAW16; if (!K) return;
  const { q, api, esc } = K;
  const html = `<div class="panel"><div class="panel-head"><div class="panel-title">Map Pack Check</div><div class="muted" id="mcHead" style="font-size:12px"></div></div><div class="v16-body">
    <p>Which ATS map states you own (read from the DLC files in your game folder), and which states your saved route plans, shared convoy routes, convoy events, current job and friends on the road need.</p>
    <div id="mcWarn"></div>
    <h3>Needed</h3><div id="mcNeeds"></div>
    <h3>Your states</h3><div id="mcStates" style="display:grid;grid-template-columns:repeat(auto-fill,minmax(150px,1fr));gap:6px"></div>
    <p class="v16-note">California, Nevada and Arizona come with the base game. Rescan from <b>Mods &amp; DLC</b> after buying a map DLC.</p>
  </div></div>`;

  async function load() {
    const r = await api('/api/mapcheck');
    q('#mcHead').textContent = r.scanned ? `${r.ownedCount} of ${r.total} states owned` : 'Game folder not found';
    q('#mcWarn').innerHTML = !r.scanned ? '<p class="v16-pill warn" style="display:inline-block">The ATS game folder was not found on this PC, so owned map DLC is unknown.</p>'
      : r.missingAll.length ? `<div class="panel" style="padding:12px;border-left:5px solid #f1c40f"><b>Missing map DLC:</b> ${r.missingAll.map(esc).join(', ')}</div>` : r.needs.length ? '<div class="panel" style="padding:12px;border-left:5px solid #2ecc71"><b>You own every state your plans and convoy need.</b></div>' : '';
    q('#mcNeeds').innerHTML = r.needs.length ? r.needs.map(n => `<div class="v16-row" style="padding:6px 0;border-bottom:1px solid #8882"><span style="flex:1 1 260px">${esc(n.label)}</span><span style="flex:2 1 300px">${n.states.map(s => `<span class="v16-pill ${n.missing.includes(s) ? 'warn' : 'good'}" style="margin:2px">${n.missing.includes(s) ? '✕ ' : '✓ '}${esc(s)}</span>`).join('')}</span></div>`).join('')
      : '<p class="v16-note">Nothing to check yet. Save a route plan, join a convoy event or take a job.</p>';
    q('#mcStates').innerHTML = r.states.map(s => `<div class="panel" style="padding:8px 10px;opacity:${s.owned ? 1 : 0.55}">${s.owned ? '✅' : '⬜'} ${esc(s.state)}${s.base ? ' <span class="v16-note">base</span>' : ''}</div>`).join('');
  }
  K.pages.push({ name: 'mapcheck', icon: '▦', label: 'Map Pack Check', group: 'Setup', index: 3, html, load: () => load().catch(e => { q('#mcNeeds').textContent = e.message; }) });
})();
