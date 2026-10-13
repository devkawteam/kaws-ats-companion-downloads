// API for driving features: shift assistant mode (more routes are added by later modules).
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

async function run(res, fn, okStatus = 200) {
  try {
    const out = await fn();
    if (!out) return json(res, { ok: false, error: 'Not found' }, 404);
    return json(res, { ok: true, ...out }, okStatus);
  } catch (e) {
    return json(res, { ok: false, error: e.message }, 400);
  }
}

const loopback = req => ['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(req.socket.remoteAddress);

// Extra route handlers registered by other modules: [(req, res, url, services, helpers) => handled?]
const extraRoutes = [];
function addDriveRoutes(fn) { extraRoutes.push(fn); }

async function handleDrive(req, res, url, s) {
  const p = url.pathname, m = req.method;
  if (p === '/api/shift' && m === 'GET') return json(res, s.shift?.get?.() || { available: false });
  if (p === '/api/shift/mode' && m === 'POST') return run(res, async () => { const b = await readBody(req); s.shift.setMode(String(b.mode || 'auto')); return { mode: s.shift.mode }; });
  // ---- Phone push (ntfy) ----
  if (p === '/api/push' && m === 'GET') return json(res, { ...(s.push?.status?.() || {}), suggestedTopic: require('./pushNotifier').PushNotifier.randomTopic(), canEdit: loopback(req) });
  if (p === '/api/push' && (m === 'PATCH' || m === 'POST')) { if (!loopback(req)) return json(res, { ok: false, error: 'Change settings on the PC running the Companion.' }, 403); return run(res, async () => s.push.update(await readBody(req))); }
  if (p === '/api/push/test' && m === 'POST') { if (!loopback(req)) return json(res, { ok: false }, 403); const ok = await s.push.test(); return json(res, { ok, error: ok ? null : (s.push.status().lastError || 'Turn push on and set a topic first.') }, ok ? 200 : 400); }
  // ---- Fun: challenges, moments, convoy history, fun settings ----
  if (p === '/api/fun' && m === 'GET') return json(res, s.fun?.status?.() || {});
  if (p === '/api/fun/settings' && (m === 'PATCH' || m === 'POST')) {
    if (!loopback(req)) return json(res, { ok: false, error: 'Change settings on the PC running the Companion.' }, 403);
    return run(res, async () => {
      const b = await readBody(req);
      const next = { ...s.config.fun };
      for (const k of ['challenges', 'milestones', 'photoWall', 'publicLive']) if (b[k] !== undefined) next[k] = Boolean(b[k]);
      s.config.fun = next; if (s.fun) s.fun.settings = next;
      require('./config').saveConfigSection('fun', next);
      return { settings: next };
    });
  }
  // ---- Shared convoy radio ----
  if (p === '/api/radio/stations' && m === 'GET') return run(res, async () => ({ stations: await s.radio.search(url.searchParams.get('q') || '', url.searchParams.get('tag') || '') }));
  if (p === '/api/radio/convoy' && m === 'GET') return json(res, { mine: s.radio.station, shared: s.radio.list(s.convoy.getRoster()) });
  if (p === '/api/radio/convoy' && m === 'POST') return run(res, async () => ({ station: s.radio.set((await readBody(req)).station || null) }));

  // ---- TruckersMP ----
  if (p === '/api/tmp' && m === 'GET') return run(res, async () => {
    const { suggestServer } = require('./communityExtras');
    const [player, servers] = await Promise.all([s.tmp.player().catch(e => ({ found: false, reason: e.message })), s.tmp.servers().catch(() => [])]);
    const roster = s.convoy.getRoster().filter(r => !r.isLocal && r.tmp?.id).map(r => ({ driverName: r.driverName, online: Boolean(r.online), ...r.tmp, profileUrl: `https://truckersmp.com/user/${Number(r.tmp.id) || ''}` }));
    const mpOffset = Number(s.state?.sdk?.multiplayerTimeOffset);
    return { player, servers, suggested: suggestServer(servers), convoy: roster, multiplayer: Number.isFinite(mpOffset) && mpOffset !== 0 };
  });
  if (p === '/api/tmp/player' && m === 'POST') return run(res, async () => ({ id: s.tmp.setPlayerId((await readBody(req)).id) }));
  for (const fn of extraRoutes) {
    const handled = await fn(req, res, url, s, { json, readBody, run });
    if (handled !== false) return handled;
  }
  return false;
}

module.exports = { handleDrive, addDriveRoutes, json, readBody, run };
