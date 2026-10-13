// Driving mode (big text, high contrast for glancing at a second screen) and colour-blind-friendly
// colours. Saved in this browser. Author: Kaw.
(() => {
  const K = window.KAW16; if (!K) return;
  const { q } = K;
  const KEY = 'kawDisplay';
  let pref = { driving: false, cbSafe: false };
  try { pref = { ...pref, ...JSON.parse(localStorage.getItem(KEY) || '{}') }; } catch {}
  const save = () => { try { localStorage.setItem(KEY, JSON.stringify(pref)); } catch {} };

  // Selectors are doubled so they win over the per-theme colour variables (body.theme-…).
  const css = `
  body.kaw-driving.kaw-driving { font-size: 118%; --muted: color-mix(in srgb, var(--text) 82%, transparent); --line: color-mix(in srgb, var(--text) 45%, transparent); }
  body.kaw-driving .v16-note, body.kaw-driving .muted { font-size: 14px !important; opacity: 1 !important; }
  body.kaw-driving .panel { border-width: 2px; }
  body.kaw-driving .cmd, body.kaw-driving .nav-btn { min-height: 48px; font-size: 16px; }
  body.kaw-driving .v16-input { min-height: 50px; font-size: 17px; }
  body.kaw-driving .panel-title { font-size: 1.15em; }
  body.kaw-cb-safe.kaw-cb-safe { --green: #3b82f6; --red: #f97316; --orange: #fb923c; --yellow: #fde047; }
  #kawDrivingBtn.on { background: var(--blue); color: #fff; }`;

  function apply() {
    document.body.classList.toggle('kaw-driving', pref.driving);
    document.body.classList.toggle('kaw-cb-safe', pref.cbSafe);
    q('#kawDrivingBtn')?.classList.toggle('on', pref.driving);
    q('#kawDrivingBtn')?.setAttribute('aria-pressed', String(pref.driving));
    if (q('#dispDriving')) q('#dispDriving').checked = pref.driving;
    if (q('#dispCb')) q('#dispCb').checked = pref.cbSafe;
  }
  K.display = { set(next) { pref = { ...pref, ...next }; save(); apply(); }, get: () => ({ ...pref }) };

  K.onReady.push(() => {
    document.head.insertAdjacentHTML('beforeend', `<style id="kawDisplayCss">${css}</style>`);
    const actions = q('.top-actions');
    if (actions && !q('#kawDrivingBtn')) {
      actions.insertAdjacentHTML('afterbegin', '<button class="icon-btn" id="kawDrivingBtn" type="button" title="Driving mode: big text and high contrast" aria-label="Driving mode" aria-pressed="false">🚚</button>');
      q('#kawDrivingBtn').onclick = () => K.display.set({ driving: !pref.driving });
    }
    q('#page-settings')?.insertAdjacentHTML('afterbegin', `<div class="panel" style="margin-bottom:12px"><div class="panel-head"><div class="panel-title">Display</div></div><div class="v16-body">
      <label class="v16-toggle"><span><b>Driving mode</b> — bigger text, larger buttons and stronger contrast for a quick glance (also the 🚚 button at the top)</span><input type="checkbox" id="dispDriving"></label>
      <label class="v16-toggle"><span><b>Colour-blind-friendly colours</b> — blue for good, orange for warnings instead of green and red</span><input type="checkbox" id="dispCb"></label>
      <p class="v16-note">Saved in this browser, so a second screen can have its own setting.</p></div></div>`);
    if (q('#dispDriving')) { q('#dispDriving').onchange = e => K.display.set({ driving: e.target.checked }); q('#dispCb').onchange = e => K.display.set({ cbSafe: e.target.checked }); }
    apply();
  });
})();
