// Free local QR pairing and second-screen controls. Author: Kaw.
(() => {
  const K = window.KAW16; if (!K) return;
  const { q, api, esc, guard, notify, go } = K;
  let link = '', expires = 0, screens = {}, busy = false, ack = '', device = null, restartPending = false, blocked = '', startedWith = 'app';
  // How to restart depends on how the Companion was started (installed app or `npm start`).
  const restartHow = () => startedWith === 'launcher' ? 'Press “Restart now” below.' : startedWith === 'npm' ? 'In the PowerShell window running the Companion, press Ctrl+C, then run npm start again.' : 'Close the Companion window and open it again.';
  const options = () => Object.entries(screens).map(([id, label]) => `<option value="${esc(id)}">${esc(label)}</option>`).join('');
  const html = `<div class="panel"><div class="panel-head"><div class="panel-title">Devices & Screens</div></div><div class="v16-body">
    <p>1. Connect your PC and phone/tablet to the same private network. Ethernet on the PC and Wi-Fi on the tablet works.</p>
    <p>2. Enable sharing, then close and reopen the Companion once. Manage devices from <b>http://127.0.0.1:4280</b> on the PC (use your configured port).</p>
    <button class="cmd" id="dvEnable">Enable network sharing</button> <button class="cmd" id="dvDisable">Disable network sharing</button><p id="dvStatus" role="status"></p><button class="cmd" id="dvRestartNow" hidden>Restart now</button>
    <p>3. Select the PC address and screen, create a QR code, then scan it with the tablet/phone camera and tap the displayed link.</p>
    <label>PC address <select class="v16-input" id="dvAddress"></select></label><label>Screen <select class="v16-input" id="dvScreen"></select></label>
    <h3>Secure links (HTTPS) for the phone microphone</h3>
    <p>Phones only allow the microphone on secure pages. Turn on HTTPS, restart the Companion once, then install the KAW certificate on each phone/tablet (one time).</p>
    <button class="cmd" id="dvHttpsOn">Turn on HTTPS</button> <button class="cmd" id="dvHttpsOff">Turn off HTTPS</button><p id="dvHttpsStatus" role="status"></p>
    <div id="dvCaBox" hidden><p><b>Install the certificate:</b> scan this with the phone camera (same network) to download it.</p><div id="dvCaQr" style="width:max-content;background:white;padding:24px;margin:8px 0"></div><p class="v16-note" id="dvCaFp"></p>
    <details><summary>iPhone / iPad steps</summary><p>1. Open the downloaded file in Safari and tap Allow. 2. Settings → Profile Downloaded → Install. 3. Settings → General → About → Certificate Trust Settings → turn on “KAW Companion Local CA”.</p></details>
    <details><summary>Android steps</summary><p>Settings → Security (or Security &amp; privacy) → More security settings → Encryption &amp; credentials → Install a certificate → CA certificate → choose the downloaded file. Chrome then trusts the Companion.</p></details>
    <p class="v16-note">Only install a certificate you created yourself, and check the fingerprint matches. You can remove it from the phone at any time.</p></div>
    <label class="v16-toggle"><span>Use a secure (https) link in the QR code</span><input type="checkbox" id="dvSecure"></label>
    <button class="cmd" id="dvCreate">Create QR code</button><div id="dvWhy" class="panel" style="padding:12px;margin:10px 0;border-left:5px solid #f1c40f" role="alert" hidden></div><div id="dvQr" style="width:max-content;background:white;padding:32px;margin:16px 0" hidden></div><p id="dvExpiry" role="status"></p>
    <input class="v16-input" id="dvLink" readonly aria-label="Pairing link"><div class="v16-row"><button class="cmd" id="dvCopy">Copy link</button><button class="cmd" id="dvShare">Share…</button><a class="cmd" id="dvMail">Email draft</a><a class="cmd" id="dvSms">Text draft</a></div>
    <p>A shared link works while near your PC on its network. This creates a draft or opens your device's share menu; choose the recipient yourself.</p>
    <details><summary>Can't connect?</summary><p>Keep the Companion running. Avoid guest Wi-Fi/client isolation. Select the address belonging to your home router if VPN or virtual adapters appear. If Windows asks about a firewall, allow the Companion on Private networks. Otherwise allow its configured TCP port (normally 4280) on your private network. Linux firewalls may need the same port. Do not use router port forwarding.</p><p>QR codes open a link on the device doing the scan, after you tap its camera prompt. Bluetooth and proximity discovery are not required. Microphone features on a remote tablet require HTTPS; basic display works over this local HTTP connection.</p></details>
    <h3>Remembered devices</h3><p>Open the bookmarked Companion page to reconnect. Screen changes require permission on the receiving device.</p><div id="dvDevices"></div>
    </div></div>`;
  async function load() {
    const s = await api('/api/devices/status'); screens = s.screens;
    const address = q('#dvAddress').value, screen = q('#dvScreen').value;
    const named = s.discovery?.running && s.addresses.length ? [s.discovery.name] : [];
    q('#dvAddress').innerHTML = named.map(n => `<option value="${esc(n)}">${esc(n)} (automatic name)</option>`).join('') + s.addresses.map(a => `<option>${esc(a)}</option>`).join('');
    if (s.addresses.includes(address) || named.includes(address)) q('#dvAddress').value = address;
    q('#dvScreen').innerHTML = options(); if (screens[screen]) q('#dvScreen').value = screen;
    startedWith = s.startedWith || 'app';
    q('#dvRestartNow').hidden = !(restartPending && startedWith === 'launcher');
    q('#dvStatus').textContent = restartPending ? `Saved. Now restart the Companion to apply it: ${restartHow()}` : s.enabled ? `Sharing is active on port ${s.port}.` : 'Sharing is off. Press “Enable network sharing”, then restart the Companion.';
    if (!s.addresses.length) q('#dvStatus').textContent += ' No private IPv4 address found. Connect the PC to your home network.';
    // Keep the button clickable and explain what's missing instead of silently doing nothing.
    blocked = restartPending ? `One more step: restart the Companion so network sharing turns on. ${restartHow()} Then come back to this page and press Create QR code.`
      : !s.enabled ? `Network sharing is off, so phones can't reach this PC yet. 1) Press “Enable network sharing” above. 2) Restart the Companion: ${restartHow()} 3) Press Create QR code again.`
      : !s.addresses.length ? 'This PC has no home-network address right now. Connect it to your router (Wi-Fi or cable), then reload this page.' : '';
    if (!blocked) q('#dvWhy').hidden = true;
    const h = s.https || {};
    q('#dvHttpsStatus').textContent = !s.enabled ? 'Turn on network sharing first.' : h.running ? `HTTPS is active on port ${h.port}.` : h.enabled ? (h.error ? `HTTPS could not start: ${h.error}` : 'HTTPS is on; restart the Companion to start it.') : 'HTTPS is off.';
    q('#dvSecure').disabled = !h.running; if (!h.running) q('#dvSecure').checked = false;
    const caAddress = s.addresses[0];
    q('#dvCaBox').hidden = !(h.running && caAddress);
    if (h.running && caAddress && q('#dvCaQr').dataset.for !== caAddress) { q('#dvCaQr').innerHTML = ''; q('#dvCaQr').dataset.for = caAddress; new QRCode(q('#dvCaQr'), { text: `http://${caAddress}:${s.port}/kaw-companion-ca.crt`, width: 180, height: 180, correctLevel: QRCode.CorrectLevel.M }); }
    q('#dvCaFp').textContent = h.fingerprint ? `Certificate fingerprint (SHA-256): ${h.fingerprint}` : '';
    const selections = new Map([...q('#dvDevices').querySelectorAll('[data-screen]')].map(el => [el.dataset.screen, el.value]));
    q('#dvDevices').innerHTML = s.devices.length ? s.devices.map(d => `<div class="panel" style="padding:12px;margin:8px 0"><b>${esc(d.name)}</b> — ${d.online ? 'Connected' : 'Offline'} — ${d.allowSwitch ? 'Screen changes allowed' : 'Screen changes off'}<div class="v16-row"><select class="v16-input" aria-label="Screen for ${esc(d.name)}" data-screen="${d.id}">${options()}</select><button class="cmd" data-send="${d.id}" ${!d.online || !d.allowSwitch ? 'disabled' : ''}>Send screen</button><button class="cmd" data-revoke="${d.id}">Forget device</button></div></div>`).join('') : '<p>No devices paired yet.</p>';
    q('#dvDevices').querySelectorAll('[data-send]').forEach(b => b.onclick = guard(async () => { await api('/api/devices/send', { method: 'POST', body: { id: b.dataset.send, screen: q(`[data-screen="${b.dataset.send}"]`).value } }); notify('Screen requested', 'The open device will switch when it checks in.'); }));
    q('#dvDevices').querySelectorAll('[data-revoke]').forEach(b => b.onclick = guard(async () => { await api('/api/devices/revoke', { method: 'POST', body: { id: b.dataset.revoke } }); await load(); }));
    for (const d of s.devices) q(`[data-screen="${d.id}"]`).value = selections.get(d.id) || d.screen;
  }
  function clearLink() { link = ''; expires = 0; q('#dvQr').hidden = true; q('#dvQr').innerHTML = ''; q('#dvLink').value = ''; q('#dvMail').removeAttribute('href'); q('#dvSms').removeAttribute('href'); }
  async function create() {
    if (blocked) { const w = q('#dvWhy'); w.textContent = blocked; w.hidden = false; w.scrollIntoView({ block: 'nearest' }); return; }
    if (typeof QRCode === 'undefined') throw new Error('The QR code tool did not load. Reload the page (Ctrl+F5) and try again.');
    clearLink(); const r = await api('/api/devices/invite', { method: 'POST', body: { address: q('#dvAddress').value, screen: q('#dvScreen').value, secure: q('#dvSecure').checked } });
    link = r.url; expires = r.expires; q('#dvLink').value = link; q('#dvQr').hidden = false;
    new QRCode(q('#dvQr'), { text: link, width: 240, height: 240, correctLevel: QRCode.CorrectLevel.M });
    q('#dvMail').href = 'mailto:?subject=' + encodeURIComponent("Kaw's ATS second screen") + '&body=' + encodeURIComponent('Connect to the same network as my PC, then open this link within five minutes:\n' + link);
    q('#dvSms').href = 'sms:?body=' + encodeURIComponent(link);
  }
  async function heartbeat() {
    if (busy) return; busy = true;
    try {
      const b = await api('/api/devices/heartbeat', { method: 'POST', body: { screen: K.currentPage(), ack, ...(device ? { allowSwitch: q('#dvConsent').checked } : {}) } });
      device = b.device; q('#dvConsent').checked = device.allowSwitch;
      q('#dvConnected').hidden = false; q('#dvConnection').textContent = `Connected as ${device.name}. Bookmark this page to return.`;
      if (b.command && b.command.id !== ack) { go(b.command.screen); ack = b.command.id; }
    } catch (e) { if (device) q('#dvConnection').textContent = e.message; }
    finally { busy = false; }
  }
  K.pages.push({ name: 'devices', icon: '▣', label: 'Devices & Screens', group: 'Setup', html, load: () => load().catch(e => { q('#dvStatus').textContent = e.message; }), init() {
    for (const [id, enabled] of [['dvEnable', true], ['dvDisable', false]]) q('#' + id).onclick = guard(async () => { await api('/api/devices/network', { method: 'POST', body: { enabled } }); restartPending = true; clearLink(); await load(); });
    q('#dvCreate').onclick = guard(create);
    q('#dvRestartNow').onclick = guard(() => K.system?.restart?.());
    for (const [id, enabled] of [['dvHttpsOn', true], ['dvHttpsOff', false]]) q('#' + id).onclick = guard(async () => { await api('/api/devices/https', { method: 'POST', body: { enabled } }); restartPending = true; notify(enabled ? 'HTTPS turned on' : 'HTTPS turned off', `Restart the Companion to apply. ${restartHow()}`, 'join'); await load(); });
    q('#dvSecure').onchange = clearLink;
    for (const id of ['dvScreen', 'dvAddress']) q('#' + id).onchange = clearLink;
    q('#dvCopy').onclick = guard(async () => { if (!link) throw new Error('Create a QR code first.'); try { await navigator.clipboard.writeText(link); notify('Link copied'); } catch { q('#dvLink').focus(); q('#dvLink').select(); notify('Link selected', 'Press Ctrl+C or use Copy on your device.'); } });
    q('#dvShare').onclick = guard(async () => { if (!link) throw new Error('Create a QR code first.'); if (navigator.share) await navigator.share({ title: "Kaw's ATS Companion", url: link }); else notify('Use Copy link', 'This browser does not offer a share menu.'); });
    document.querySelector('main').insertAdjacentHTML('afterbegin', '<div id="dvConnected" class="panel" style="padding:12px;margin-bottom:12px" hidden><span id="dvConnection"></span> <label><input type="checkbox" id="dvConsent"> Allow PC screen changes</label><p>Display device: change Companion settings on the PC.</p></div>');
    const remote = !['localhost', '127.0.0.1', '[::1]'].includes(location.hostname);
    if (remote || new URLSearchParams(location.search).has('paired')) { heartbeat(); setInterval(heartbeat, 5000); }
    setInterval(() => {
      if (expires) { const remaining = Math.ceil((expires - Date.now()) / 1000); q('#dvExpiry').textContent = remaining > 0 ? `Pairing link expires in ${remaining} seconds and works once.` : 'Expired. Create a new QR code.'; if (remaining <= 0) clearLink(); }
      if (K.currentPage() === 'devices' && !remote && !q('#dvDevices').contains(document.activeElement) && !q('#dvAddress').matches(':focus') && !q('#dvScreen').matches(':focus')) load().catch(() => {});
    }, 5000);
  } });
})();
