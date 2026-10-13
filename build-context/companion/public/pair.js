// Author: Kaw. The secret is in the fragment, never in a server URL/log.
(() => {
  const token = new URLSearchParams(location.hash.slice(1)).get('token');
  history.replaceState(null, '', location.pathname);
  const status = document.querySelector('#status'), form = document.querySelector('#pairForm');
  if (!token) { status.textContent = 'Scan a fresh QR code from Devices & Screens on your PC.'; form.hidden = true; return; }
  form.onsubmit = async e => {
    e.preventDefault(); const button = form.querySelector('button'); button.disabled = true;
    try {
      const r = await fetch('/api/devices/pair', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ token, name: document.querySelector('#name').value, allowSwitch: document.querySelector('#switch').checked }) });
      const b = await r.json(); if (!r.ok || !b.ok) throw new Error(b.error || 'Could not pair.');
      location.replace('/?page=' + encodeURIComponent(b.device.screen) + '&paired=1');
    } catch (err) { status.textContent = err.message; button.disabled = false; }
  };
})();
