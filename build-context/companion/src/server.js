const http = require('node:http');
const https = require('node:https');
const { LocalCerts } = require('./localCerts');
const fs = require('node:fs');
const path = require('node:path');
const APP_VERSION = require('../package.json').version;
const { handleV16 } = require('./apiV16');
const { handleConvoy } = require('./apiConvoy');
const { handleTogether } = require('./apiTogether');
const { plan } = require('./tripPlanner');
const { handleDrive } = require('./apiDrive');
const { handleAi, trustedLocal } = require('./apiAi');
const { handleLivery } = require('./apiLivery');
const { handlePlus } = require('./apiPlus');
const { DeviceHub, handleDevices, displayAccess } = require('./apiDevices');
const { MdnsResponder } = require('./mdns');
const { privateAddresses } = require('./deviceHub');
const atsGameMap = require('./atsGameMap');
const { handleStream } = require('./apiStream');
const RELEASE_API = 'https://api.github.com/repos/devkawteam/kaws-ats-companion-downloads/releases/latest';
let updateCache = { at: 0, value: null };

function json(res, payload, status = 200) {
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store'
  });
  return res.end(JSON.stringify(payload, null, 2));
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', chunk => {
      body += chunk;
      if (body.length > 1024 * 1024) {
        reject(new Error('Body too large'));
        req.destroy();
      }
    });
    req.on('end', () => {
      try { resolve(body ? JSON.parse(body) : {}); }
      catch (e) { reject(e); }
    });
    req.on('error', reject);
  });
}

function cleanBuild(body = {}) {
  const take = (value, max = 120) => String(value || '').trim().slice(0, max);
  const profile = body.profile || {};
  const privacy = body.privacy || {};
  return {
    profile: {
      engine: take(profile.engine), hp: take(profile.hp, 40), torque: take(profile.torque, 60),
      transmission: take(profile.transmission), brakes: take(profile.brakes), chassis: take(profile.chassis), notes: take(profile.notes, 600)
    },
    privacy: {
      shareIdentity: privacy.shareIdentity !== false,
      shareSpecs: privacy.shareSpecs !== false,
      shareTrailer: privacy.shareTrailer !== false,
      shareCustom: Boolean(privacy.shareCustom),
      sharePlate: Boolean(privacy.sharePlate),
      shareLocation: privacy.shareLocation !== false,
      shareSpeed: privacy.shareSpeed !== false,
      shareStatus: privacy.shareStatus !== false,
      shareRoute: privacy.shareRoute !== false,
      shareDamage: Boolean(privacy.shareDamage)
    }
  };
}

function versionParts(value) {
  const [core, pre] = String(value || '').replace(/^v/i, '').split('+')[0].split('-');
  return { core: core.split('.').map(x => Number.parseInt(x, 10) || 0), pre: pre ? pre.split('.') : [] };
}
function newerVersion(latest, current) {
  const a = versionParts(latest), b = versionParts(current);
  for (let i = 0; i < Math.max(a.core.length, b.core.length); i++) { if ((a.core[i] || 0) !== (b.core[i] || 0)) return (a.core[i] || 0) > (b.core[i] || 0); }
  if (!a.pre.length && b.pre.length) return true;
  if (a.pre.length && !b.pre.length) return false;
  for (let i = 0; i < Math.max(a.pre.length, b.pre.length); i++) {
    if (a.pre[i] === b.pre[i]) continue;
    if (a.pre[i] === undefined) return false;
    if (b.pre[i] === undefined) return true;
    const an = /^\d+$/.test(a.pre[i]), bn = /^\d+$/.test(b.pre[i]);
    if (an && bn) return Number(a.pre[i]) > Number(b.pre[i]);
    if (an !== bn) return !an;
    return a.pre[i] > b.pre[i];
  }
  return false;
}

async function updateStatus(force = false) {
  if (!force && updateCache.value && Date.now() - updateCache.at < 15 * 60 * 1000) return updateCache.value;
  const response = await fetch(RELEASE_API, { headers: { accept: 'application/vnd.github+json', 'user-agent': `KAW-ATS-Companion/${APP_VERSION}` } });
  if (!response.ok) throw new Error(`GitHub release check returned HTTP ${response.status}`);
  const release = await response.json();
  const asset = (release.assets || []).find(x => /KAW-ATS-Companion-Setup.*\.exe$/i.test(x.name));
  const value = { currentVersion: APP_VERSION, latestVersion: String(release.tag_name || '').replace(/^v/i, ''), updateAvailable: newerVersion(release.tag_name, APP_VERSION), releaseName: release.name || release.tag_name, releaseUrl: release.html_url, downloadUrl: asset?.browser_download_url || release.html_url, assetName: asset?.name || null, publishedAt: release.published_at || null };
  updateCache = { at: Date.now(), value }; return value;
}

const mime = {
  '.html': 'text/html; charset=utf-8',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.svg': 'image/svg+xml',
  '.json': 'application/json; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8'
};

function servePublic(urlPath, res) {
  const clean = urlPath === '/' ? '/index.html' : urlPath;
  const publicDir = path.resolve(process.cwd(), 'public');
  const target = path.resolve(publicDir, '.' + clean);

  if (!target.startsWith(publicDir)) return false;
  if (!fs.existsSync(target) || !fs.statSync(target).isFile()) return false;

  const ext = path.extname(target).toLowerCase();
  const buffer = fs.readFileSync(target);
  res.writeHead(200, {
    'content-type': mime[ext] || 'application/octet-stream',
    'cache-control': ext === '.html' ? 'no-store' : 'public, max-age=300'
  });
  res.end(buffer);
  return true;
}

function startDashboard(port, host, state, trips, convoy, intelligence, services = {}) {
  const devices = new DeviceHub();
  // Network discovery (kaw-companion.local) only while network sharing is on.
  const lan = ['0.0.0.0', '::'].includes(host);
  devices.discovery = lan ? new MdnsResponder({ name: 'kaw-companion.local', addresses: () => privateAddresses() }) : null;
  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, `http://${host}:${port}`);
    // The phone's one-time download: the local CA certificate (public, safe to share).
    if (req.method === 'GET' && url.pathname === '/kaw-companion-ca.crt' && devices.certs) {
      res.writeHead(200, { 'content-type': 'application/x-x509-ca-cert', 'content-disposition': 'attachment; filename="kaw-companion-ca.crt"', 'cache-control': 'no-store' });
      return res.end(devices.certs.caDer());
    }
    if (await handleDevices(req, res, url, devices, port, host) !== false) return;
    if (!displayAccess(req, url, devices)) return json(res, { ok: false, error: 'Scan a QR code from Devices & Screens. This device can view screens; manage the Companion on the PC.' }, 403);

    // ATS game map (vector tiles, downloaded once, served locally with Range support).
    if (atsGameMap.serve(req, res, url.pathname)) return;
    if (url.pathname === '/api/atsmap') {
      if (req.method === 'GET') return json(res, atsGameMap.status());
      const local = ['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(req.socket.remoteAddress);
      if (!local) return json(res, { ok: false, error: 'The map can only be installed from the PC running the Companion.' }, 403);
      try {
        if (req.method === 'POST') return json(res, await atsGameMap.download());
        if (req.method === 'DELETE') return json(res, atsGameMap.remove());
      } catch (e) { return json(res, { ok: false, error: e.message }, 409); }
      return json(res, { ok: false, error: 'Method not allowed' }, 405);
    }

    if (url.pathname === '/api/health') return json(res, { ok: true, service: 'kaws-ats-companion', version: APP_VERSION, pid: process.pid, launcher: process.env.KAW_LAUNCHER === '1', folder: process.cwd() });

    // Preview updates from GitHub (git checkout only; this PC only).
    if (url.pathname === '/api/system/update') {
      if (!trustedLocal(req)) return json(res, { ok: false, error: 'Use the dashboard on the PC running the Companion.' }, 403);
      const su = services.selfUpdate || (services.selfUpdate = new (require('./selfUpdate').SelfUpdate)());
      try {
        if (req.method === 'GET') return json(res, { ok: true, ...(await su.status({ fresh: url.searchParams.get('fresh') === '1' })) });
        if (req.method === 'POST' && req.headers['x-kaw-action'] === 'update') {
          const r = await su.apply();
          const restart = r.updated && process.env.KAW_LAUNCHER === '1';
          json(res, { ok: true, ...r, restarting: restart, restartHint: r.updated && !restart ? 'Restart the Companion to use the update (close its window or Ctrl+C, then start it again).' : null });
          if (restart) setTimeout(() => { server.close(); process.exit(75); }, 600);
          return;
        }
      } catch (e) { return json(res, { ok: false, error: e.message }, 409); }
      return json(res, { ok: false, error: 'Not allowed.' }, 405);
    }

    // Quit / restart the Companion from its own dashboard (this PC only). Restart needs the PREVIEW
    // launcher, which starts the Companion again when it exits with code 75.
    if ((url.pathname === '/api/system/quit' || url.pathname === '/api/system/restart') && req.method === 'POST') {
      if (!trustedLocal(req) || req.headers['x-kaw-action'] !== url.pathname.split('/').pop()) return json(res, { ok: false, error: 'Use the dashboard on the PC running the Companion.' }, 403);
      const restart = url.pathname.endsWith('/restart');
      if (restart && process.env.KAW_LAUNCHER !== '1') return json(res, { ok: false, error: 'Restart needs the “Start KAW Companion PREVIEW” launcher. You started the Companion another way: close its window (or press Ctrl+C there) and start it again.' }, 409);
      json(res, { ok: true, restarting: restart });
      console.log(`[COMPANION] ${restart ? 'Restart' : 'Quit'} requested from the dashboard.`);
      setTimeout(() => { server.close(); process.exit(restart ? 75 : 0); }, 400);
      return;
    }

    if (url.pathname === '/api/telemetry') {
      const convoySummary = convoy?.getSummary?.() || { roster: [], commands: [] };
      const cal = services.calibration;
      // Real-world position for the tile map (street/satellite/terrain). Null until the map is calibrated.
      const geo = cal?.locate?.(state.positioning) || null;
      const mapMates = (convoySummary.roster || []).filter(r => r.online && !r.isLocal).map(r => {
        const w = cal?.locate?.(r.positioning) || r.location || null;
        return w && Number.isFinite(w.lon) && Number.isFinite(w.lat)
          ? { id: r.id, driverName: r.driverName, lon: w.lon, lat: w.lat, near: w.near || null, speedMph: r.truck?.speedMph ?? null, rotationX: r.positioning?.rotationX ?? null, relation: r.relation || null }
          : null;
      }).filter(Boolean);
      return json(res, {
        ...state,
        voicePromptSource: services.voice?.settings?.promptSource || 'both',
        geo,
        mapStatus: cal?.status?.() || null,
        mapMates,
        together: services.together?.status?.() || null,
        trip: trips?.getCurrent?.() || null,
        tripStats: trips?.getStats?.() || {},
        convoy: convoySummary,
        alerts: services.alerts?.summary?.() || { active: [], history: [], overspeed: {} },
        dispatch: services.dispatch?.summary?.() || null,
        career: services.career?.get?.() || null,
        convoySession: services.sessions?.summary?.() || null,
        shift: services.shift?.get?.() || null,
        planner: plan(state)
      });
    }

    try {
      if (url.pathname.startsWith('/api/ai/') && await handleAi(req, res, url, { state, ...services }) !== false) return;
      if (url.pathname.startsWith('/api/livery/') && await handleLivery(req, res, url, services) !== false) return;
      if (/^\/api\/(planner|formation|weather|money|mapcheck|jarvis|calendar|h2h)(\/|$)/.test(url.pathname) && await handlePlus(req, res, url, { state, trips, intelligence, convoy, ...services }) !== false) return;
      if (url.pathname.startsWith('/api/together') && await handleTogether(req, res, url, { state, convoy, ...services }) !== false) return;
      if (url.pathname.startsWith('/api/') && await handleDrive(req, res, url, { state, trips, convoy, intelligence, ...services }) !== false) return;
      if (url.pathname.startsWith('/api/') && await handleConvoy(req, res, url, { state, trips, convoy, intelligence, ...services }) !== false) return;
      if (url.pathname.startsWith('/api/stream') && await handleStream(req, res, url, { state, trips, convoy, intelligence, ...services }) !== false) return;
      if (url.pathname.startsWith('/api/') && await handleV16(req, res, url, { state, trips, convoy, intelligence, ...services }) !== false) return;
    } catch (e) {
      console.error('[API]', e.message);
      return json(res, { ok: false, error: e.message }, 500);
    }

    if (url.pathname === '/api/build-profile' && req.method === 'POST') {
      try { const build = cleanBuild(await readBody(req)); state.buildProfile = build.profile; state.buildPrivacy = build.privacy; return json(res, { ok: true, ...build }); }
      catch (e) { return json(res, { ok: false, error: e.message }, 400); }
    }

    if (url.pathname === '/api/update') {
      try { return json(res, await updateStatus(url.searchParams.get('force') === '1')); }
      catch (e) { return json(res, { currentVersion: APP_VERSION, updateAvailable: false, error: e.message }, 502); }
    }

    if (url.pathname === '/api/trip/current') return json(res, trips?.getCurrent?.() || null);

    if (url.pathname === '/api/trips') {
      const limit = Number(url.searchParams.get('limit') || 10);
      return json(res, trips?.getRecent?.(limit) || []);
    }

    if (url.pathname === '/api/trip/stats') return json(res, trips?.getStats?.() || {});

    if (url.pathname === '/api/convoy') {
      return json(res, convoy?.getSummary?.() || { roster: [], commands: [] });
    }

    if (url.pathname === '/api/convoy/peer' && req.method === 'POST') {
      try {
        const peer = await readBody(req);
        const ok = convoy?.ingestPeer?.(peer);
        return json(res, { ok: Boolean(ok) }, ok ? 200 : 400);
      } catch (e) {
        return json(res, { ok: false, error: e.message }, 400);
      }
    }

    if (url.pathname === '/api/convoy/command' && req.method === 'POST') {
      try {
        const body = await readBody(req);
        const command = convoy?.issueCommand?.(body);
        return json(res, { ok: Boolean(command), command }, command ? 200 : 400);
      } catch (e) {
        return json(res, { ok: false, error: e.message }, 400);
      }
    }

    if (url.pathname.startsWith('/api/streamdeck/')) {
      const slug = decodeURIComponent(url.pathname.slice('/api/streamdeck/'.length)).replace(/-/g,' ').toUpperCase();
      const allowed = new Set(['DEPART','HOLD POSITION','REGROUP','FUEL STOP','REST STOP','EMERGENCY STOP','RESUME CONVOY']);
      if (!allowed.has(slug)) return json(res,{ok:false,error:'Unknown Stream Deck command'},400);
      const command = convoy?.issueCommand?.({type:slug,message:url.searchParams.get('message') || '',issuedBy:'Stream Deck'});
      return json(res,{ok:Boolean(command),command},command?200:400);
    }


    if (url.pathname === '/api/intelligence/scan') {
      return json(res, intelligence?.getScan?.() || {});
    }

    if (url.pathname === '/api/intelligence/readiness') {
      return json(res, intelligence?.getReadiness?.() || {});
    }

    if (url.pathname === '/api/intelligence/route') {
      const origin = url.searchParams.get('origin');
      const destination = url.searchParams.get('destination');
      return json(res, intelligence?.evaluateRoute?.(origin, destination) || {});
    }

    if (url.pathname === '/api/intelligence/truck-load') {
      const hp = Number(url.searchParams.get('hp') || 500);
      const drivenAxles = Number(url.searchParams.get('drivenAxles') || 2);
      const transmission = url.searchParams.get('transmission') || '18';
      return json(res, intelligence?.getTruckLoadAdvice?.({ horsepower:hp, drivenAxles, transmission }) || {});
    }

    if (url.pathname === '/api/intelligence/rescan' && req.method === 'POST') {
      try {
        const scan = intelligence?.rescan?.() || {};
        return json(res,{ok:true,scan});
      } catch(e) {
        return json(res,{ok:false,error:e.message},500);
      }
    }

    if (servePublic(url.pathname, res)) return;

    res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
    res.end('Not found');
  });

  // Only one Companion can use the port. Say who has it instead of crashing with a stack trace.
  server.on('error', async e => {
    if (e.code !== 'EADDRINUSE') { console.error('[DASHBOARD]', e.message); process.exit(1); }
    let who = 'another program';
    try { const h = await (await fetch(`http://127.0.0.1:${port}/api/health`, { signal: AbortSignal.timeout(3000) })).json(); if (h.service === 'kaws-ats-companion') who = `KAW Companion v${h.version} (process ${h.pid})`; } catch {}
    console.error(`\n[COMPANION] Port ${port} is already in use by ${who}. Only one Companion can run at a time.`);
    console.error('[COMPANION] Close the other one first (Task Manager → end "KAW-Companion-Launcher" and its node.exe),');
    console.error('[COMPANION] or start the preview with "Start KAW Companion PREVIEW", which can stop the installed one for you.\n');
    process.exit(2);
  });

  server.listen(port, host, () => {
    // 0.0.0.0 / :: mean "listen on every network" and can't be opened in a browser; show the local address.
    console.log(`[DASHBOARD] http://${['0.0.0.0', '::'].includes(host) ? '127.0.0.1' : host}:${port}`);
    if (host !== '127.0.0.1' && host !== 'localhost') {
      console.log('[DASHBOARD] LAN mode enabled. Use Windows Firewall/private-network rules carefully.');
      devices.discovery?.start();
      // HTTPS for phones (microphone needs a secure page). Same pages and rules, private CA.
      const httpsCfg = services.config?.https || {};
      devices.https = { enabled: Boolean(httpsCfg.enabled), port: httpsCfg.port || 4443, running: false, error: null };
      devices.certs = new LocalCerts();
      if (httpsCfg.enabled) {
        try {
          const c = devices.certs.server(privateAddresses(), ['kaw-companion.local', 'localhost']);
          const secure = https.createServer({ key: c.key, cert: c.cert }, server.listeners('request')[0]);
          secure.on('error', e => { devices.https.running = false; devices.https.error = e.message; console.error('[HTTPS]', e.message); });
          secure.listen(devices.https.port, host, () => { devices.https.running = true; devices.https.fingerprint = devices.certs.fingerprint(); console.log(`[HTTPS] Phones: https://kaw-companion.local:${devices.https.port}`); });
        } catch (e) { devices.https.error = e.message; console.error('[HTTPS]', e.message); }
      }
    }
  });
}

module.exports = { startDashboard, newerVersion };
