// /api/together: convoy togetherness (status, regroup, roll call, ready, invite) and the recent replay.
// Changes and the invite (it contains the relay key) are only for the PC running the Companion.
'use strict';
const { trustedLocal } = require('./apiAi');
const { cityPoints } = require('./apiPlus');

const json = (res, data, status = 200) => { res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' }); res.end(JSON.stringify(data)); return true; };
const readBody = req => new Promise((resolve, reject) => { let s = ''; req.on('data', d => { s += d; if (s.length > 20000) { reject(new Error('Too large')); req.destroy(); } }).on('end', () => { try { resolve(s ? JSON.parse(s) : {}); } catch { reject(new Error('Invalid JSON')); } }); });

// The same one-click link the Discord bot makes, so a driver can invite a friend directly.
function inviteLink(config, port = 4280) {
  const r = config.remote || {};
  if (!r.endpoint) throw new Error('This Companion is not connected to a convoy relay yet.');
  if (!config.pairingCode) throw new Error('Set a convoy code first (Convoy page → “Join a convoy”), so your friend joins the same convoy.');
  const payload = { endpoint: r.endpoint, apiKey: r.apiKey || '', backupEndpoints: r.backupEndpoints || [], pairingCode: config.pairingCode, server: `an invite from ${String(config.driverName || 'a driver').slice(0, 40)}` };
  const b64 = Buffer.from(JSON.stringify(payload)).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  return { link: `http://127.0.0.1:${Number(port) || 4280}/?connect=${b64}`, pairingCode: config.pairingCode, includesKey: Boolean(r.apiKey) };
}

async function handleTogether(req, res, url, s) {
  const p = url.pathname, m = req.method;
  if (!p.startsWith('/api/together')) return false;
  const t = s.together;
  if (!t) return json(res, { ok: false, error: 'Not available' }, 503);
  if (p === '/api/together' && m === 'GET') return json(res, { ok: true, ...t.status() });
  if (!trustedLocal(req)) return json(res, { ok: false, error: 'Use the dashboard on the PC running the Companion.' }, 403);
  try {
    if (p === '/api/together/invite' && m === 'GET') return json(res, { ok: true, ...inviteLink(s.config, 4280) });
    if (p === '/api/together/cities' && m === 'GET') return json(res, { ok: true, cities: cityPoints().map(c => ({ name: c.name, state: c.state })) });
    if (m !== 'POST') return json(res, { ok: false, error: 'Not found' }, 404);
    const b = await readBody(req);
    const me = s.config?.driverName || 'Driver';
    if (p === '/api/together/regroup') {
      if (b.clear) { t.clearRegroup(); return json(res, { ok: true, ...t.status() }); }
      let place = null;
      if (b.here) {
        const g = s.calibration?.locate?.(s.state?.positioning);
        if (!g) throw new Error('Your truck has no map position yet — start driving, or pick a city.');
        place = { name: b.name || (g.near ? `near ${g.near}` : 'My position'), lat: g.lat, lon: g.lon };
      } else if (b.city) {
        const c = cityPoints().find(x => x.name.toLowerCase() === String(b.city).toLowerCase() && (!b.state || x.state === b.state));
        if (!c) throw new Error('That city is not on the map.');
        place = { name: `${c.name}${c.state ? `, ${c.state}` : ''}`, lat: c.lat, lon: c.lon };
      } else if (Number.isFinite(Number(b.lat)) && Number.isFinite(Number(b.lon))) place = { name: b.name, lat: Number(b.lat), lon: Number(b.lon) };
      if (!place) throw new Error('Choose “my position”, a city, or a point on the map.');
      t.setRegroup({ ...place, note: b.note }, me);
      return json(res, { ok: true, ...t.status() });
    }
    if (p === '/api/together/rollcall') { if (b.end) t.endRollCall(); else t.startRollCall(me); return json(res, { ok: true, ...t.status() }); }
    if (p === '/api/together/ready') { t.setReady(b.ready === true ? true : b.ready === false ? false : null); return json(res, { ok: true, ...t.status() }); }
    return json(res, { ok: false, error: 'Not found' }, 404);
  } catch (e) { return json(res, { ok: false, error: e.message }, 400); }
}

module.exports = { handleTogether, inviteLink };
