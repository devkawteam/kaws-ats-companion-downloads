// API for convoy features: events & RSVP, leaderboards, virtual company, trails & replay, gap keeper.
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

const PERIODS = new Set(['week', 'lastWeek', 'season', 'allTime']);

async function handleConvoy(req, res, url, s) {
  const p = url.pathname, m = req.method;
  if (!p.startsWith('/api/events') && !p.startsWith('/api/leaderboard') && !p.startsWith('/api/vtc') && !p.startsWith('/api/tracks') && !p.startsWith('/api/gap')) return false;
  const roster = s.convoy.getRoster();

  // ---- Events & RSVP ----
  if (p === '/api/events' && m === 'GET') return json(res, { events: s.events.list(roster), active: s.events.activeEvent(roster) });
  let mt = p.match(/^\/api\/events\/([^/]+)\/rsvp$/);
  if (mt && m === 'POST') return run(res, async () => { const b = await readBody(req); s.events.rsvp(decodeURIComponent(mt[1]), String(b.status || '')); return { events: s.events.list(roster) }; });

  // ---- Leaderboards ----
  if (p === '/api/leaderboard' && m === 'GET') {
    const period = PERIODS.has(url.searchParams.get('period')) ? url.searchParams.get('period') : 'week';
    return json(res, s.leaderboard.get(roster, period));
  }

  // ---- Virtual company ----
  if (p === '/api/vtc' && m === 'GET') return json(res, s.vtc.summary(roster));
  if (p === '/api/vtc/company' && m === 'POST') return run(res, async () => ({ company: s.vtc.setCompany(await readBody(req)) }));
  if (p === '/api/vtc/company' && m === 'DELETE') { s.vtc.closeCompany(); return json(res, { ok: true }); }
  if (p === '/api/vtc/assignments' && m === 'POST') return run(res, async () => ({ assignment: s.vtc.assign(await readBody(req)) }), 201);
  mt = p.match(/^\/api\/vtc\/assignments\/([^/]+)\/cancel$/);
  if (mt && m === 'POST') return run(res, async () => { const a = s.vtc.cancelAssignment(decodeURIComponent(mt[1])); return a && { assignment: a }; });
  mt = p.match(/^\/api\/vtc\/incoming\/([^/]+)\/(accept|decline)$/);
  if (mt && m === 'POST') return run(res, async () => s.vtc.respond(roster, decodeURIComponent(mt[1]), mt[2]));

  // ---- Trails & replay ----
  if (p === '/api/tracks/live' && m === 'GET') return json(res, { ready: s.calibration.status().ready, trails: s.calibration.status().ready ? s.tracks.liveTrails(s.calibration) : [] });
  mt = p.match(/^\/api\/tracks\/session\/([^/]+)$/);
  if (mt && m === 'GET') {
    if (!s.calibration.status().ready) return json(res, { ok: false, error: 'The live map is still calibrating — deliver to a few cities first.' }, 409);
    const r = s.tracks.replay(decodeURIComponent(mt[1]), s.calibration);
    return r ? json(res, r) : json(res, { ok: false, error: 'No recording for this convoy' }, 404);
  }

  // ---- Gap keeper ----
  if (p === '/api/gap' && m === 'GET') return json(res, s.gap.status());
  if (p === '/api/gap/leader' && m === 'POST') return run(res, async () => { const b = await readBody(req); s.gap.setLeader(b.driverName || null); return s.gap.status(); });

  return false;
}

module.exports = { handleConvoy };
