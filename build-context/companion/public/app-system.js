// Companion app controls: which version/folder is running, Restart (with the PREVIEW launcher) and Quit.
// Closing the browser tab doesn't stop the Companion; this does. Author: Kaw.
(() => {
  const K = window.KAW16; if (!K) return;
  const { q, api, esc, guard, notify } = K;
  const local = ['127.0.0.1', 'localhost', '[::1]'].includes(location.hostname);

  async function health() { try { return await api('/api/health'); } catch { return null; } }
  async function action(kind) {
    const r = await fetch(`/api/system/${kind}`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-kaw-action': kind }, body: '{}' }).then(x => x.json()).catch(() => ({ ok: false, error: 'The Companion did not answer.' }));
    if (!r.ok) throw new Error(r.error || `Could not ${kind}.`);
    return r;
  }
  // Restart and wait until the new Companion answers, then reload the page.
  async function restart() {
    if (!confirm('Restart the Companion now? The dashboard reconnects by itself in a few seconds.')) return false;
    const before = await health();
    await action('restart');
    notify('Restarting the Companion…', 'This page reloads when it is back.', 'join');
    for (let i = 0; i < 60; i++) {
      await new Promise(r => setTimeout(r, 1000));
      const h = await health();
      if (h && h.pid !== before?.pid) { location.reload(); return true; }
    }
    notify('Still restarting', 'If nothing happens, check the PREVIEW launcher window.', 'leave');
    return true;
  }
  async function quit() {
    if (!confirm('Quit the Companion? Telemetry, alerts and the dashboard stop until you start it again.')) return;
    await action('quit');
    document.body.insertAdjacentHTML('afterbegin', '<div style="position:fixed;inset:0;z-index:9999;display:grid;place-items:center;background:#000c;color:#fff;font:600 20px Segoe UI,sans-serif;text-align:center;padding:24px">The Companion has stopped.<br><span style="font-weight:400;font-size:15px">Start it again with “Start KAW Companion PREVIEW” (or your usual shortcut), then reload this page.</span></div>');
  }
  K.system = { health, restart, quit };

  K.onReady.push(async () => {
    const page = q('#page-settings'); if (!page) return;
    page.insertAdjacentHTML('afterbegin', `<div class="panel" style="margin-bottom:12px"><div class="panel-head"><div class="panel-title">Companion app</div></div><div class="v16-body">
      <p id="sysInfo" class="v16-note">Checking…</p>
      <div class="v16-row"><button class="cmd" id="sysRestart">Restart Companion</button><button class="cmd" id="sysQuit">Quit Companion</button></div>
      <h4 style="margin:12px 0 4px">Preview updates</h4><p id="sysUpd" class="v16-note">Checking…</p>
      <div class="v16-row"><button class="cmd" id="sysUpdCheck">Check for updates</button><button class="cmd" id="sysUpdGo" hidden>⬇ Update now</button></div>
      <p class="v16-note">Closing the browser tab doesn't stop the Companion. Use Quit, or close its window.</p></div></div>`);
    const h = await health();
    q('#sysInfo').innerHTML = h ? `Running <b>v${esc(h.version)}</b> (process ${h.pid}) from <code>${esc(h.folder || '?')}</code> — ${h.launcher ? 'started with the PREVIEW launcher, so Restart works here.' : 'started without the PREVIEW launcher: to restart, close its window (or Ctrl+C) and start it again.'}` : 'Could not read the Companion status.';
    q('#sysRestart').disabled = !local || !h?.launcher; q('#sysQuit').disabled = !local;
    q('#sysRestart').onclick = guard(restart); q('#sysQuit').onclick = guard(quit);
    const showUpd = u => {
      q('#sysUpd').textContent = !u ? 'Could not check.' : !u.git ? u.message : `${u.message}${u.current ? ` You're on: ${u.current}.` : ''}${u.latest ? ` Newest: ${u.latest}.` : ''}${u.dirty ? ' (This copy has local changes, so it will not auto-update.)' : ''}`;
      q('#sysUpdGo').hidden = !(u?.git && u.behind > 0 && !u.dirty && !u.ahead);
      q('#sysUpdCheck').hidden = !u?.git;
    };
    const check = async fresh => { if (!local) { q('#sysUpd').textContent = 'Updates are managed on the PC running the Companion.'; q('#sysUpdCheck').hidden = true; return; } try { showUpd(await api(`/api/system/update${fresh ? '?fresh=1' : ''}`)); } catch (e) { q('#sysUpd').textContent = e.message; } };
    q('#sysUpdCheck').onclick = guard(() => check(true));
    q('#sysUpdGo').onclick = guard(async () => {
      if (!confirm('Download the newest preview from GitHub and restart the Companion?')) return;
      q('#sysUpdGo').disabled = true; q('#sysUpd').textContent = 'Updating…';
      const r = await fetch('/api/system/update', { method: 'POST', headers: { 'content-type': 'application/json', 'x-kaw-action': 'update' }, body: '{}' }).then(x => x.json()).catch(() => ({ ok: false, error: 'The Companion did not answer.' }));
      q('#sysUpdGo').disabled = false;
      if (!r.ok) throw new Error(r.error);
      q('#sysUpd').textContent = r.message + (r.restartHint ? ` ${r.restartHint}` : r.restarting ? ' Restarting…' : '');
      if (r.restarting) { const before = (await health())?.pid; for (let i = 0; i < 60; i++) { await new Promise(res => setTimeout(res, 1000)); const h = await health(); if (h && h.pid !== before) return location.reload(); } }
    });
    check(false);
  });
})();
