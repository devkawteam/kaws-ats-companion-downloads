// API for streaming features: live stream events (SSE) for overlays, stream sessions and YouTube
// chapters. Streaming add-ons (chat commands, OBS, mixer) register more routes via register().
// Returns false when the request is not one of these routes.

function json(res, payload, status = 200) {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
  res.end(JSON.stringify(payload));
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', c => { body += c; if (body.length > 256 * 1024) { reject(new Error('Body too large')); req.destroy(); } });
    req.on('end', () => { try { resolve(body ? JSON.parse(body) : {}); } catch (e) { reject(e); } });
    req.on('error', reject);
  });
}

const loopback = req => ['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(req.socket.remoteAddress);
const extra = [];
function register(fn) { extra.push(fn); }

async function handleStream(req, res, url, s) {
  const p = url.pathname, m = req.method;
  const stream = s.stream;
  if (!stream) return false;
  const helpers = { json, readBody, loopback };

  if (p === '/api/stream/events' && m === 'GET') { stream.subscribe(req, res); return true; }
  if (p === '/api/stream/recent' && m === 'GET') return json(res, { events: stream.recent(Number(url.searchParams.get('limit')) || 30, Number(url.searchParams.get('since')) || 0) });
  if (p === '/api/stream/status' && m === 'GET') return json(res, { ...stream.status(s.state), session: stream.session ? { id: stream.session.id, startedAt: stream.session.startedAt, source: stream.session.source } : null });
  if (p === '/api/stream/sessions' && m === 'GET') return json(res, { sessions: stream.sessionList() });
  if (p === '/api/stream/chapters' && m === 'GET') return json(res, stream.chapters(url.searchParams.get('id')));
  if (p === '/api/stream/session' && m === 'POST') {
    if (!loopback(req)) return json(res, { ok: false, error: 'Only on the PC running the Companion.' }, 403);
    const body = await readBody(req).catch(() => ({}));
    if (body.action === 'stop') return json(res, { ok: true, session: stream.stopSession() });
    return json(res, { ok: true, session: stream.startSession('manual', body.title) });
  }
  if (p === '/api/stream/test' && m === 'POST') {
    if (!loopback(req)) return json(res, { ok: false, error: 'Only on the PC running the Companion.' }, 403);
    const body = await readBody(req).catch(() => ({}));
    const samples = {
      delivery: ['delivery', 'Delivered to Las Vegas', 'Lumber · $18,450 · 562 mi'],
      achievement: ['achievement', 'Achievement unlocked', 'Road Warrior'],
      crash: ['crash', 'Ouch! Damage taken', '+3.2% damage at 54 mph'],
      convoyJoin: ['convoyJoin', 'Dusty joined the convoy', ''],
      fuel: ['fuel', 'Fuel stop', 'Topped up 96 gal'],
      horn: ['effect', '@viewer sounded the horn!', '', { effect: 'horn', user: 'viewer' }],
      confetti: ['effect', '@viewer threw confetti!', '', { effect: 'confetti', user: 'viewer' }]
    };
    const pick = samples[body.type] || samples.delivery;
    return json(res, { ok: true, event: stream.emit(pick[0], pick[1], pick[2], { test: true, ...(pick[3] || {}) }) });
  }
  // ---- chat commands, stream info, polls ----
  const studio = s.studio;
  if (studio && p === '/api/stream/chat' && m === 'GET') {
    const local = loopback(req);
    const relayInfo = s.relay?.get?.() || {};
    return json(res, { ...studio.view(local), commands: local ? studio.commandList(s.config?.remote?.endpoint) : [], relayConnected: Boolean(s.config?.remote?.enabled), convoyTvUrl: relayInfo.convoyTvUrl || null, publicLive: Boolean(s.config?.fun?.publicLive) });
  }
  if (studio && p === '/api/stream/chat' && m === 'POST') {
    if (!loopback(req)) return json(res, { ok: false, error: 'Only on the PC running the Companion.' }, 403);
    try { return json(res, { ok: true, ...studio.update(await readBody(req)) }); } catch (e) { return json(res, { ok: false, error: e.message }, 400); }
  }
  if (studio && p === '/api/stream/chat/rotate' && m === 'POST') {
    if (!loopback(req)) return json(res, { ok: false, error: 'Only on the PC running the Companion.' }, 403);
    return json(res, { ok: true, ...studio.rotateKey() });
  }
  if (studio && p === '/api/stream/poll' && m === 'GET') return json(res, studio.pollView());
  if (studio && p === '/api/stream/poll' && m === 'POST') {
    if (!loopback(req)) return json(res, { ok: false, error: 'Only on the PC running the Companion.' }, 403);
    try {
      const body = await readBody(req);
      return json(res, { ok: true, ...(body.action === 'close' ? studio.closePoll() : studio.createPoll(body.question, body.options, body.minutes)) });
    } catch (e) { return json(res, { ok: false, error: e.message }, 400); }
  }
  // ---- Twitch (markers, clips, predictions) ----
  const twitch = s.twitch;
  if (twitch && p === '/api/stream/twitch') {
    if (m === 'GET') return json(res, twitch.status());
    if (!loopback(req)) return json(res, { ok: false, error: 'Only on the PC running the Companion.' }, 403);
    try {
      const body = await readBody(req);
      if (body.action === 'connect') return json(res, { ok: true, ...(await twitch.startLogin()) });
      if (body.action === 'disconnect') { twitch.disconnect(); return json(res, { ok: true, ...twitch.status() }); }
      return json(res, { ok: true, ...twitch.update(body) });
    } catch (e) { return json(res, { ok: false, error: e.message }, 400); }
  }
  // ---- this PC's app volumes ----
  const mixer = s.appMixer;
  if (mixer && p === '/api/stream/apps') {
    if (!loopback(req)) return json(res, { ok: false, error: 'App volumes can only be changed on the PC running the Companion.' }, 403);
    if (m === 'GET') return json(res, await mixer.view());
    if (m === 'POST') {
      try {
        const body = await readBody(req);
        if (body.duck) return json(res, { ok: true, duck: mixer.updateDuck(body.duck) });
        if (body.savePreset) return json(res, { ok: true, preset: await mixer.savePreset(body.savePreset) });
        if (body.applyPreset) return json(res, { ok: true, preset: await mixer.applyPreset(body.applyPreset) });
        const proc = String(body.process || '');
        if (!/^[\w .-]{1,80}$/.test(proc)) throw new Error('Unknown app.');
        const r = body.volume !== undefined ? await mixer.setVolume(proc, body.volume) : await mixer.setMute(proc, Boolean(body.muted));
        if (r && r.ok === false) throw new Error(r.error);
        return json(res, { ok: true });
      } catch (e) { return json(res, { ok: false, error: e.message }, 400); }
    }
  }
  // ---- OBS remote control ----
  const obs = s.obs;
  if (obs && p.startsWith('/api/stream/obs')) {
    if (p === '/api/stream/obs' && m === 'GET') return json(res, obs.status());
    if (p === '/api/stream/obs/mixer' && m === 'GET') return json(res, { connected: obs.status().connected, inputs: obs.mixer() });
    if (m !== 'POST') return json(res, { ok: false, error: 'Method not allowed' }, 405);
    if (!loopback(req)) return json(res, { ok: false, error: 'Only on the PC running the Companion.' }, 403);
    try {
      const body = await readBody(req);
      if (p === '/api/stream/obs') return json(res, { ok: true, ...obs.update(body) });
      if (p === '/api/stream/obs/scene') { await obs.setScene(String(body.sceneName || ''), false); return json(res, { ok: true, currentScene: obs.currentScene }); }
      if (p === '/api/stream/obs/audio-setup') return json(res, { ok: true, done: await obs.audioSetup(body.sources || undefined) });
      if (p === '/api/stream/obs/discord') return json(res, { ok: true, ...(await obs.addDiscordCapture()) });
      if (p === '/api/stream/obs/browser') return json(res, { ok: true, ...(await obs.addBrowserSource(body.name, String(body.url || ''), Boolean(body.vertical))) });
      if (p === '/api/stream/obs/volume') { await obs.setVolume(String(body.inputName), body.db); return json(res, { ok: true }); }
      if (p === '/api/stream/obs/mute') { await obs.setMute(String(body.inputName), body.muted); return json(res, { ok: true }); }
      if (p === '/api/stream/obs/refresh') { await obs.refresh(); return json(res, { ok: true, ...obs.status() }); }
    } catch (e) { return json(res, { ok: false, error: e.message }, 400); }
    return json(res, { ok: false, error: 'Not found' }, 404);
  }
  // Trip recap / replay data: /api/stream/recap?trip=<id|last|current>
  if (p === '/api/stream/recap' && m === 'GET') {
    const which = url.searchParams.get('trip') || 'last';
    if (which === 'current') return json(res, { trip: s.trips?.getCurrent?.() || null, points: s.routes?.current?.() || [], driverName: s.config?.driverName, live: true });
    const recent = s.trips?.getRecent?.(50) || [];
    const trip = which === 'last' ? recent.find(t => t.status === 'delivered') || recent[0] : recent.find(t => t.id === which);
    if (!trip) return json(res, { ok: false, error: 'No finished trip yet — deliver a load first.' }, 404);
    return json(res, { trip, points: s.routes?.load?.(trip.id) || [], driverName: s.config?.driverName, trips: recent.filter(t => t.status === 'delivered').slice(0, 20).map(t => ({ id: t.id, label: `${t.originCity || '?'} → ${t.destinationCity || '?'} · ${t.cargo || ''}`, endedAt: t.endedAt })) });
  }
  for (const fn of extra) { const handled = await fn(req, res, url, s, helpers); if (handled !== false && handled !== undefined) return true; }
  return false;
}

module.exports = { handleStream, register };
