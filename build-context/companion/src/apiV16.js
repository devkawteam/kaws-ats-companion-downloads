// v1.6 API: alerts, analytics, dispatch, career, bills of lading, pre-flight, convoy sessions, settings.
// Returns false when the request is not a v1.6 route so server.js can continue its own routing.

const { saveConfigSection, saveConfigRoot, normalizeVoice, normalizeDiscord, normalizeAlerts, normalizeSharing, normalizeEndpoints, normalizeCb } = require('./config');
const { buildHub } = require('./communityHub');
const { workshopDetails, dlcPrice } = require('./steamApi');
const { MAP_DLC } = require('./localScanner');

// Fill in mod names/sizes and stamp the Steam 'last updated' date when a pack is saved.
async function enrichMods(body) {
  if (!Array.isArray(body?.mods)) return body;
  const info = await workshopDetails(body.mods.map(m => m.workshopId).filter(Boolean));
  body.mods = body.mods.map(m => {
    const w = info[String(m.workshopId || '').replace(/\D/g, '')];
    if (!w || w.missing) return m;
    return { ...m, name: m.name || w.title, workshopUpdatedAt: w.updatedAt, sizeBytes: w.sizeBytes };
  });
  return body;
}

function json(res, payload, status = 200) {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
  res.end(JSON.stringify(payload, null, 2));
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', chunk => {
      body += chunk;
      if (body.length > 1024 * 1024) { reject(new Error('Body too large')); req.destroy(); }
    });
    req.on('end', () => { try { resolve(body ? JSON.parse(body) : {}); } catch (e) { reject(e); } });
    req.on('error', reject);
  });
}

const isLoopback = req => ['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(req.socket.remoteAddress);

async function withBody(req, res, fn, okStatus = 200) {
  try {
    const result = await fn(await readBody(req));
    if (!result) return json(res, { ok: false, error: 'Not found' }, 404);
    return json(res, { ok: true, ...result }, okStatus);
  } catch (e) {
    return json(res, { ok: false, error: e.message }, 400);
  }
}

function settingsView(s) {
  return {
    voice: s.voice?.settings || normalizeVoice(),
    discord: s.discord?.status?.() || { enabled: false, configured: false },
    alerts: s.alerts?.settings || normalizeAlerts(),
    sharing: s.config?.sharing || normalizeSharing(),
    relay: { endpoint: s.config?.remote?.endpoint || '', enabled: Boolean(s.config?.remote?.enabled), hasApiKey: Boolean(s.config?.remote?.apiKey), pairingCode: s.config?.pairingCode || '', backupEndpoints: s.config?.remote?.backupEndpoints || [], discordVoiceUrl: s.config?.cb?.discordVoiceUrl || '', discordInviteUrl: s.config?.cb?.discordInviteUrl || '' }
  };
}

async function handleV16(req, res, url, s) {
  const p = url.pathname;
  const m = req.method;

  // ---- Alerts & analytics ----
  if (p === '/api/alerts') return json(res, s.alerts?.summary?.() || { active: [], history: [] });
  if (p === '/api/analytics') return json(res, s.trips.getAnalytics(Number(url.searchParams.get('days') ?? 30)));
  if (p === '/api/trips.csv') {
    res.writeHead(200, { 'content-type': 'text/csv; charset=utf-8', 'content-disposition': 'attachment; filename="kaw-ats-trips.csv"', 'cache-control': 'no-store' });
    return res.end('﻿' + s.trips.toCsv());
  }

  // ---- Convoy Hub: presence, location, DLC coverage, mod packs, relay/CB status ----
  if (p === '/api/hub') {
    const roster = s.convoy.getRoster();
    const localScan = s.intelligence.getScan();
    const ids = [s.preflight.getActive(), ...roster.map(r => r.convoyManifest)].filter(Boolean).flatMap(m => (m.mods || []).map(x => x.workshopId)).filter(Boolean);
    const myStates = new Set(localScan.capabilities?.mapStates || []);
    const missingStates = Object.values(MAP_DLC).filter(st => !myStates.has(st));
    const [workshop, priceList] = await Promise.all([workshopDetails(ids), Promise.all(missingStates.map(st => dlcPrice(st).then(v => [st, v])))]);
    return json(res, buildHub({ roster, localScan, preflight: s.preflight, calibration: s.calibration, relay: s.relay?.get?.() || null, workshop, prices: Object.fromEntries(priceList) }));
  }
  if (p === '/api/steam/workshop') return json(res, await workshopDetails(String(url.searchParams.get('ids') || '').split(',')));
  if (p === '/api/relay') {
    if (url.searchParams.get('check') === '1') await s.relay?.check?.();
    return json(res, s.relay?.get?.() || { configured: false });
  }
  if (p === '/api/preflight/adopt' && m === 'POST') return withBody(req, res, body => {
    const peer = s.convoy.getRoster().find(r => !r.isLocal && r.convoyManifest?.id && r.convoyManifest.id === body.manifestId);
    if (!peer) return null;
    const src = peer.convoyManifest;
    const manifest = s.preflight.create({ name: `${src.name || 'Convoy'} (from ${peer.driverName})`, game: src.game, gameVersion: src.gameVersion, requiredDlcTokens: src.requiredDlcTokens, mods: src.mods, notes: src.notes });
    return { manifest };
  }, 201);

  // ---- Screenshot journal ----
  if (p === '/api/journal') return json(res, s.journal ? s.journal.list(s.trips.getRecent(100), Number(url.searchParams.get('limit') || 120)) : { available: false, shots: [] });
  const shot = p.match(/^\/api\/journal\/image\/([^/]+)$/);
  if (shot && m === 'GET') {
    const file = s.journal?.file(decodeURIComponent(shot[1]));
    if (!file) return json(res, { error: 'Screenshot not found' }, 404);
    const fs = require('node:fs');
    res.writeHead(200, { 'content-type': /\.png$/i.test(file) ? 'image/png' : 'image/jpeg', 'cache-control': 'private, max-age=86400' });
    return fs.createReadStream(file).pipe(res);
  }

  // ---- Career ----
  if (p === '/api/career' && m === 'GET') return json(res, s.career?.get?.() || {});
  if (p === '/api/achievements' && m === 'GET') return json(res, s.career?.get?.()?.availableAchievements || []);

  // ---- Bills of lading ----
  if (p === '/api/bols' && m === 'GET') return json(res, s.bols?.list?.(Number(url.searchParams.get('limit') || 100)) || []);
  const bolMatch = p.match(/^\/api\/bols\/([^/]+)$/);
  if (bolMatch && m === 'GET') {
    const item = s.bols?.get?.(decodeURIComponent(bolMatch[1]));
    return json(res, item || { error: 'BOL not found' }, item ? 200 : 404);
  }

  // ---- Dispatch ----
  if (p === '/api/dispatch') {
    if (m === 'GET') return json(res, s.dispatch.summary());
    if (m === 'POST') return withBody(req, res, body => {
      const stops = (Array.isArray(body.stops) ? body.stops : []).filter(x => x && (x.origin || x.destination));
      if (!stops.length) throw new Error('Add at least one stop with an origin or destination.');
      return { dispatch: s.dispatch.create({ ...body, stops }) };
    }, 201);
  }
  if (p === '/api/dispatches' && m === 'GET') return json(res, s.dispatch.list(Number(url.searchParams.get('limit') || 50)));
  const dm = p.match(/^\/api\/dispatch\/([^/]+)(?:\/(start|complete-stop|cancel))?$/);
  if (dm) {
    const id = decodeURIComponent(dm[1]), action = dm[2];
    if (!action && m === 'GET') { const item = s.dispatch.get(id); return json(res, item || { error: 'Dispatch not found' }, item ? 200 : 404); }
    if (!action && m === 'PATCH') return withBody(req, res, body => { const d = s.dispatch.update(id, body); return d && { dispatch: d }; });
    if (action === 'start' && m === 'POST') { const d = s.dispatch.start(id); return json(res, { ok: Boolean(d), dispatch: d }, d ? 200 : 404); }
    if (action === 'cancel' && m === 'POST') { const d = s.dispatch.cancel(id); return json(res, { ok: Boolean(d), dispatch: d }, d ? 200 : 404); }
    if (action === 'complete-stop' && m === 'POST') return withBody(req, res, body => { const d = s.dispatch.completeCurrentStop(body); return d && { dispatch: d }; });
  }

  // ---- Convoy pre-flight ----
  if (p === '/api/preflight' && m === 'GET') return json(res, s.preflight.evaluateRoster(s.convoy.getRoster(), s.intelligence.getScan()));
  if (p === '/api/preflight/manifest') {
    if (m === 'GET') return json(res, { active: s.preflight.getActive(), manifests: s.preflight.list() });
    if (m === 'POST') return withBody(req, res, async body => ({ manifest: s.preflight.create(await enrichMods(body)) }), 201);
  }
  const mm = p.match(/^\/api\/preflight\/manifest\/([^/]+)(?:\/(activate))?$/);
  if (mm) {
    const id = decodeURIComponent(mm[1]);
    if (mm[2] === 'activate' && m === 'POST') { const x = s.preflight.setActive(id); return json(res, { ok: Boolean(x), manifest: x }, x ? 200 : 404); }
    if (!mm[2] && m === 'PATCH') return withBody(req, res, async body => { const x = s.preflight.update(id, await enrichMods(body)); return x && { manifest: x }; });
    if (!mm[2] && m === 'DELETE') { const ok = s.preflight.remove(id); return json(res, { ok }, ok ? 200 : 404); }
  }

  // ---- Convoy sessions ----
  if (p === '/api/convoy-sessions') {
    if (m === 'GET') return json(res, s.sessions.summary());
    if (m === 'POST') return withBody(req, res, body => ({ session: s.sessions.create(body) }), 201);
  }
  const sm = p.match(/^\/api\/convoy-sessions\/([^/]+)(?:\/(start|end|checkpoints))?(?:\/([^/]+)\/complete)?$/);
  if (sm) {
    const id = decodeURIComponent(sm[1]), action = sm[2], cp = sm[3] && decodeURIComponent(sm[3]);
    const roster = s.convoy.getRoster();
    if (action === 'start' && m === 'POST') { const x = s.sessions.start(id, roster); return json(res, { ok: Boolean(x), session: x }, x ? 200 : 404); }
    if (action === 'end' && m === 'POST') { const x = s.sessions.end(id, roster); return json(res, { ok: Boolean(x), session: x }, x ? 200 : 404); }
    if (action === 'checkpoints' && cp && m === 'POST') { const x = s.sessions.completeCheckpoint(id, cp); return json(res, { ok: Boolean(x), checkpoint: x }, x ? 200 : 404); }
    if (action === 'checkpoints' && m === 'POST') return withBody(req, res, body => { const c = s.sessions.addCheckpoint(id, body); return c && { checkpoint: c }; }, 201);
    if (!action && m === 'GET') { const x = s.sessions.get(id); return json(res, x || { error: 'Session not found' }, x ? 200 : 404); }
  }

  // ---- Settings (writes are limited to the local PC) ----
  if (p === '/api/settings' && m === 'GET') return json(res, { ...settingsView(s), canEdit: isLoopback(req) });
  const setMatch = p.match(/^\/api\/settings\/(voice|discord|alerts|sharing|relay)(\/test)?$/);
  if (setMatch && (m === 'PATCH' || m === 'POST')) {
    if (!isLoopback(req)) return json(res, { ok: false, error: 'Settings can only be changed on the PC running the Companion.' }, 403);
    const section = setMatch[1];
    if (setMatch[2]) {
      if (section === 'discord') { const ok = await s.discord.test(); return json(res, { ok, error: ok ? null : (s.discord.status().lastError || 'Discord is not enabled or the webhook URL is missing.') }, ok ? 200 : 400); }
      if (section === 'voice') { const ok = s.voice.speak('Voice dispatcher test. Drive safe.', 'voice-test', 0); return json(res, { ok }); }
      return json(res, { ok: false }, 404);
    }
    return withBody(req, res, body => {
      if (section === 'voice') {
        const next = normalizeVoice({ ...s.voice.settings, ...body });
        s.voice.settings = next; saveConfigSection('voice', next);
      } else if (section === 'discord') {
        const merged = { ...s.discord.settings, ...body };
        // An empty webhookUrl in the request means "keep the saved one"; "clear" removes it.
        if (!body.webhookUrl) merged.webhookUrl = s.discord.settings.webhookUrl;
        if (body.webhookUrl === 'clear') merged.webhookUrl = '';
        const next = normalizeDiscord(merged);
        if (body.webhookUrl && body.webhookUrl !== 'clear' && !next.webhookUrl) throw new Error('That is not a Discord webhook URL (https://discord.com/api/webhooks/...).');
        s.discord.setSettings(next); saveConfigSection('discord', next);
      } else if (section === 'relay') {
        // Main relay address, key, convoy code and on/off (used by the Discord bot's one-click connect link).
        const remotePatch = {};
        if (body.endpoint !== undefined) {
          const ep = String(body.endpoint || '').trim();
          if (!/^https:\/\/[^\s"'<>]+\/api\/telemetry$/i.test(ep) && !/^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?\/api\/telemetry$/i.test(ep)) throw new Error('Relay address must be https://…/api/telemetry');
          remotePatch.endpoint = require('./relayDefaults').liveEndpoint(ep);
        }
        if (body.apiKey !== undefined) remotePatch.apiKey = String(body.apiKey || '').trim().slice(0, 200);
        if (body.enabled !== undefined) remotePatch.enabled = Boolean(body.enabled);
        if (Object.keys(remotePatch).length) { Object.assign(s.config.remote, remotePatch); saveConfigSection('remote', remotePatch); }
        if (body.pairingCode !== undefined) {
          const code = String(body.pairingCode || '').trim().slice(0, 64);
          if (!/^[\w-]{3,64}$/.test(code)) throw new Error('Convoy code must be 3–64 letters, numbers, - or _');
          s.config.pairingCode = code; saveConfigRoot({ pairingCode: code });
        }
        if (body.backupEndpoints !== undefined) {
          const { liveEndpoint } = require('./relayDefaults');
          const list = [...new Set(normalizeEndpoints(body.backupEndpoints).map(liveEndpoint))].filter(u => u !== (remotePatch.endpoint || s.config.remote.endpoint));
          if (String(body.backupEndpoints || '').trim() && !list.length) throw new Error('Backup relay must be a full http(s) URL, e.g. https://cb.example.com/api/telemetry');
          s.config.remote.backupEndpoints = list;
          saveConfigSection('remote', { backupEndpoints: list });
        }
        if (body.discordVoiceUrl !== undefined || body.discordInviteUrl !== undefined) {
          const cb = normalizeCb({ discordVoiceUrl: body.discordVoiceUrl ?? s.config.cb?.discordVoiceUrl ?? '', discordInviteUrl: body.discordInviteUrl ?? s.config.cb?.discordInviteUrl ?? '' });
          for (const k of ['discordVoiceUrl', 'discordInviteUrl']) if (String(body[k] || '').trim() && !cb[k]) throw new Error('Use a full Discord invite (https://discord.gg/yourcode) or channel link (https://discord.com/channels/...).');
          s.config.cb = cb;
          saveConfigSection('cb', cb);
        }
        s.relay?.check?.();
      } else if (section === 'sharing') {
        const next = normalizeSharing({ ...s.config.sharing, ...body });
        s.config.sharing = next; saveConfigSection('sharing', next);
      } else {
        const next = normalizeAlerts({ ...s.alerts.settings, ...body });
        s.alerts.setSettings(next); saveConfigSection('alerts', next);
      }
      return settingsView(s);
    });
  }

  return false;
}

module.exports = { handleV16 };
