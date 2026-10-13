const { DeviceHub, SCREENS, privateAddresses } = require('./deviceHub');
const { trustedLocal } = require('./apiAi');
const { json, readBody } = require('./apiDrive');
const { saveConfigRoot, saveConfigSection } = require('./config');
const loopback = req => ['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(req.socket.remoteAddress);
const sameOrigin = req => req.headers['sec-fetch-site'] !== 'cross-site' && (!req.headers.origin || req.headers.origin === `${req.socket?.encrypted ? 'https' : 'http'}://${req.headers.host}`);
// A paired browser is a display. Administrative and command APIs remain on the PC.
const READ_PATHS = new Set(['/api/telemetry', '/api/health', '/api/atsmap', '/api/trips', '/api/trip/current', '/api/trip/stats', '/api/trips.csv', '/api/analytics', '/api/alerts', '/api/convoy', '/api/shift', '/api/gap', '/api/together', '/api/intelligence/readiness', '/api/intelligence/route']);
const JARVIS_DEVICE = new Set(['GET /api/jarvis/status', 'GET /api/jarvis/briefing', 'POST /api/jarvis/chat']);
function displayAccess(req, url, hub) {
  if (loopback(req)) return true;
  if (!url.pathname.startsWith('/api/')) return true;
  if (!sameOrigin(req) || !hub.authenticate(req.headers.cookie)) return false;
  // Paired devices may also talk to Jarvis (and read his status/briefing) — nothing else they can change.
  if (JARVIS_DEVICE.has(`${req.method} ${url.pathname}`)) return true;
  return req.method === 'GET' && READ_PATHS.has(url.pathname);
}
async function handleDevices(req, res, url, hub, port, host) {
  if (!url.pathname.startsWith('/api/devices/')) return false;
  try {
    if (!sameOrigin(req)) return json(res, { ok: false, error: 'Open the Companion directly to pair a device.' }, 403);
    const p = url.pathname;
    if (p === '/api/devices/pair' && req.method === 'POST') {
      const b = await readBody(req), result = hub.pair(b.token, b.name, b.allowSwitch);
      res.setHeader('Set-Cookie', `kawDevice=${result.session}; HttpOnly; SameSite=Strict; Path=/; Max-Age=31536000`);
      return json(res, { ok: true, device: result.device });
    }
    if (p === '/api/devices/heartbeat' && req.method === 'POST') {
      const d = hub.authenticate(req.headers.cookie);
      if (!d) return json(res, { ok: false, error: 'Scan a new QR code from the PC to connect this device.' }, 401);
      return json(res, { ok: true, ...hub.heartbeat(d, await readBody(req)) });
    }
    if (!trustedLocal(req)) return json(res, { ok: false, error: 'Manage screens at http://127.0.0.1:' + port + ' on the PC.' }, 403);
    if (p === '/api/devices/status' && req.method === 'GET') return json(res, { ok: true, screens: SCREENS, addresses: privateAddresses(), port, enabled: ['0.0.0.0', '::'].includes(host), discovery: hub.discovery?.status?.() || null, startedWith: process.env.KAW_LAUNCHER === '1' ? 'launcher' : process.env.npm_lifecycle_event === 'start' ? 'npm' : 'app', https: hub.https || null, devices: hub.devices.map(d => hub.view(d)) });
    if (p === '/api/devices/https' && req.method === 'POST') {
      const b = await readBody(req);
      saveConfigSection('https', { enabled: b.enabled === true, port: hub.https?.port || 4443 });
      return json(res, { ok: true, restartRequired: true });
    }
    if (p === '/api/devices/network' && req.method === 'POST') {
      const b = await readBody(req); saveConfigRoot({ dashboardHost: b.enabled === true ? '0.0.0.0' : '127.0.0.1' });
      return json(res, { ok: true, restartRequired: true });
    }
    if (p === '/api/devices/invite' && req.method === 'POST') {
      if (!['0.0.0.0', '::'].includes(host)) throw new Error('Enable sharing and restart the Companion first.');
      const b = await readBody(req);
      const viaName = hub.discovery?.status?.().running && b.address === hub.discovery.name;
      if (!viaName && !privateAddresses().includes(b.address)) throw new Error('Choose a current private-network address.');
      const secure = b.secure === true && hub.https?.running;
      return json(res, { ok: true, ...hub.invite(b.address, secure ? hub.https.port : port, b.screen, secure ? 'https' : 'http') });
    }
    if (p === '/api/devices/send' && req.method === 'POST') { const b = await readBody(req); return json(res, { ok: true, command: hub.send(b.id, b.screen) }); }
    if (p === '/api/devices/revoke' && req.method === 'POST') { const b = await readBody(req); hub.revoke(b.id); return json(res, { ok: true }); }
    return json(res, { ok: false, error: 'Unknown device operation.' }, 404);
  } catch (e) { return json(res, { ok: false, error: e.message }, 400); }
}
module.exports = { DeviceHub, handleDevices, displayAccess };
