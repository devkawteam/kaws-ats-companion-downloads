// Radio DJ Jarvis: while the convoy radio plays, Jarvis drops in short announcements — welcomes for drivers
// joining, trip progress, upcoming convoys and real weather — lowering the music while he talks.
// Built locally from Companion data (no AI call). Off by default. Author: Kaw.
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.KAWRadioDJ = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';
  const mi = n => `${Math.round(n)} mile${Math.round(n) === 1 ? '' : 's'}`;
  const list = names => names.length <= 1 ? names.join('') : `${names.slice(0, -1).join(', ')} and ${names.at(-1)}`;

  // Who came online since the last check (names only).
  function joinedSince(prev, roster) {
    const online = new Set((roster || []).filter(r => r.online && !r.isLocal && r.driverName).map(r => r.driverName));
    const joined = prev ? [...online].filter(n => !prev.has(n)) : [];
    return { online, joined };
  }

  /* d: telemetry snapshot; opts: { stationName, events, weather, now, kind: 'scheduled'|'joins', joined } */
  function djLine(d = {}, { stationName = null, events = [], weather = null, now = Date.now(), kind = 'scheduled', joined = [] } = {}) {
    if (kind === 'joins') return joined.length ? `Welcome to the convoy, ${list(joined.slice(0, 4))}! Pull up a chair, the radio's on.` : '';
    const bits = [`This is Jarvis on the convoy radio${stationName ? `, you're listening to ${stationName}` : ''}.`];
    const j = d.job || {}, nav = d.navigation || {};
    if (j.active && j.destinationCity) bits.push(Number(nav.distanceMiles) > 0 ? `${mi(nav.distanceMiles)} to go to ${j.destinationCity}.` : `Next stop, ${j.destinationCity}.`);
    if (Number(nav.restStopMinutes) > 0 && nav.restStopMinutes < 90) bits.push(`Rest break due in about ${Math.round(nav.restStopMinutes)} minutes.`);
    const online = (d.convoy?.roster || []).filter(r => r.online).length;
    if (online > 1) bits.push(`${online} drivers on the relay right now.`);
    const soon = events.filter(e => e.departureTime && Date.parse(e.departureTime) > now && Date.parse(e.departureTime) - now < 6 * 3600000).sort((a, b) => Date.parse(a.departureTime) - Date.parse(b.departureTime))[0];
    if (soon) bits.push(`The ${soon.name} convoy rolls out in ${Math.max(1, Math.round((Date.parse(soon.departureTime) - now) / 60000))} minutes.`);
    if (weather?.enabled && weather.now) bits.push(`Outside it's ${weather.now.temperatureF} degrees and ${String(weather.now.short || '').toLowerCase()}.`);
    bits.push('Back to the music.');
    return bits.join(' ');
  }
  return { djLine, joinedSince };
});

// ---------------------------------------------------------------- page wiring (browser only)
(() => {
  if (typeof window === 'undefined') return;
  const K = window.KAW16, DJ = window.KAWRadioDJ; if (!K || !DJ) return;
  const { q, api, telem } = K;
  const KEY = 'kawRadioDJ';
  let cfg = { on: false, every: 15, joins: true }, lastSaid = Date.now(), prevOnline = null, pendingJoins = [], busy = false;
  try { cfg = { ...cfg, ...JSON.parse(localStorage.getItem(KEY) || '{}') }; } catch {}
  const save = () => { try { localStorage.setItem(KEY, JSON.stringify(cfg)); } catch {} };
  const jarvisVoice = () => { try { const v = JSON.parse(localStorage.getItem('kawJarvisVoice') || '{}'); return v.voiceURI ? v : null; } catch { return null; } };

  async function announce(text) {
    if (!text || busy || !K.radio?.playing()) return;
    busy = true;
    const a = K.radio.audio, vol = a.volume;
    try {
      for (let v = vol; v > vol * 0.25; v -= vol * 0.15) { a.volume = Math.max(0, v); await new Promise(r => setTimeout(r, 60)); }
      a.volume = vol * 0.25;
      await (K.coDriver?.speakAndWait ? K.coDriver.speakAndWait(text, jarvisVoice()) : Promise.resolve());
    } finally { a.volume = vol; busy = false; lastSaid = Date.now(); }
  }
  async function scheduled() {
    let events = [], weather = null;
    try { events = (await api('/api/events')).events || []; } catch {}
    try { const w = await api('/api/weather'); if (w.enabled && w.now) weather = w; } catch {}
    return DJ.djLine(telem() || {}, { stationName: K.radio?.stationName?.(), events, weather });
  }

  K.onTick.push(async d => {
    const { online, joined } = DJ.joinedSince(prevOnline, d?.convoy?.roster);
    prevOnline = online;
    if (!cfg.on || !K.radio?.playing() || busy) return;
    if (cfg.joins && joined.length) pendingJoins.push(...joined);
    if (pendingJoins.length && Date.now() - lastSaid > 20000) { const names = [...new Set(pendingJoins)]; pendingJoins = []; return announce(DJ.djLine(d, { kind: 'joins', joined: names })); }
    if (Date.now() - lastSaid > cfg.every * 60000) { lastSaid = Date.now(); announce(await scheduled()); }
  });

  K.onReady.push(() => {
    const host = q('#page-radio'); if (!host) return;
    host.insertAdjacentHTML('beforeend', `<div class="panel" style="margin-top:12px"><div class="panel-head"><div class="panel-title">Radio DJ Jarvis</div></div><div class="v16-body">
      <label class="v16-toggle"><span>While the convoy radio plays, Jarvis drops in short announcements (music gets quieter while he talks)</span><input type="checkbox" id="djOn"></label>
      <div class="v16-row"><label style="flex:0 1 220px">Every <select class="v16-input" id="djEvery"><option value="10">10 minutes</option><option value="15">15 minutes</option><option value="20">20 minutes</option><option value="30">30 minutes</option></select></label>
        <label class="v16-toggle" style="flex:1 1 220px"><span>Welcome drivers who join</span><input type="checkbox" id="djJoins"></label><button class="cmd" id="djNow">🎙 Say something now</button></div>
      <p class="v16-note">Uses Jarvis's voice (set on the Jarvis page) and only the Companion's own data: trip progress, convoy, events and real weather if you turned it on.</p></div></div>`);
    q('#djOn').checked = cfg.on; q('#djEvery').value = String(cfg.every); q('#djJoins').checked = cfg.joins;
    q('#djOn').onchange = () => { cfg.on = q('#djOn').checked; lastSaid = Date.now(); save(); };
    q('#djEvery').onchange = () => { cfg.every = Number(q('#djEvery').value) || 15; save(); };
    q('#djJoins').onchange = () => { cfg.joins = q('#djJoins').checked; save(); };
    q('#djNow').onclick = async () => { if (!K.radio?.playing()) return K.notify('Radio DJ', 'Play a convoy station first.', 'leave'); announce(await scheduled()); };
  });
})();
