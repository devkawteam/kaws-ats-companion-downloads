const fs = require('node:fs');
const path = require('node:path');
const { normalizeAi } = require('./localAi');
const { migrateRelayDefaults } = require('./relayDefaults');

const CONFIG_PATH = path.join(process.cwd(), 'config.json');
const clamp = (v, min, max, fallback) => {
  const n = Number(v);
  return Number.isFinite(n) ? Math.max(min, Math.min(max, n)) : fallback;
};

function readRawConfig() {
  return JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8').replace(/^﻿/, ''));
}

function normalizeVoice(v = {}) {
  return {
    enabled: Boolean(v.enabled),
    promptSource: ['game', 'companion', 'both'].includes(v.promptSource) ? v.promptSource : 'both',
    rate: clamp(v.rate, -10, 10, 0),
    volume: clamp(v.volume ?? 85, 0, 100, 85),
    prefix: String(v.prefix ?? 'KAW Dispatch').slice(0, 60)
  };
}

const WEBHOOK_RE = /^https:\/\/(discord\.com|discordapp\.com|ptb\.discord\.com|canary\.discord\.com)\/api\/webhooks\/\d+\/[\w-]+$/i;

function normalizeDiscord(d = {}) {
  const url = String(d.webhookUrl || '').trim();
  return {
    enabled: Boolean(d.enabled),
    webhookUrl: WEBHOOK_RE.test(url) ? url : '',
    tripSummaries: d.tripSummaries !== false,
    achievements: d.achievements !== false,
    includeIncome: d.includeIncome !== false,
    events: d.events !== false,
    weeklyRecap: Boolean(d.weeklyRecap)
  };
}

function normalizeAlerts(a = {}) {
  return {
    enabled: a.enabled !== false,
    lowFuelPercent: clamp(a.lowFuelPercent, 5, 50, 15),
    fatigueWarnMinutes: clamp(a.fatigueWarnMinutes, 15, 240, 60),
    damageWarnPercent: clamp(a.damageWarnPercent, 1, 90, 10),
    cargoDamageWarnPercent: clamp(a.cargoDamageWarnPercent, 1, 90, 5),
    overspeedToleranceMph: clamp(a.overspeedToleranceMph, 0, 15, 3),
    deadlineWarnMinutes: clamp(a.deadlineWarnMinutes, 10, 600, 60),
    gapWarnMiles: clamp(a.gapWarnMiles, 0.5, 20, 2)
  };
}

// Backup convoy relays (tried in order when the main one is down). http(s) URLs only.
function normalizeEndpoints(list) {
  const arr = Array.isArray(list) ? list : String(list || '').split(/[\s,]+/);
  return [...new Set(arr.map(x => String(x || '').trim()).filter(x => /^https?:\/\/[^\s"'<>]+$/i.test(x)))].slice(0, 3);
}

// Discord voice channel used as the CB fallback: an invite or a channel link.
const DISCORD_VOICE_RE = /^https:\/\/(discord\.gg\/[\w-]+|(www\.)?discord(app)?\.com\/(invite\/[\w-]+|channels\/\d+\/\d+))\/?$/i;
// Defaults: KAW Gaming → "ATS Convoy" voice channel (opens directly for server members), plus the
// permanent server invite for drivers who have not joined yet. Either can be replaced or cleared.
const DEFAULT_DISCORD_VOICE = 'https://discord.com/channels/1214348167609581599/1532852330721050664';
const DEFAULT_DISCORD_INVITE = 'https://discord.gg/AWNUYJtpFd';
function normalizeCb(cb = {}) {
  const pick = (value, fallback) => {
    const url = String(value === undefined ? fallback : value || '').trim();
    return DISCORD_VOICE_RE.test(url) ? url : '';
  };
  return { discordVoiceUrl: pick(cb.discordVoiceUrl, DEFAULT_DISCORD_VOICE), discordInviteUrl: pick(cb.discordInviteUrl, DEFAULT_DISCORD_INVITE) };
}

function normalizeSharing(s = {}) {
  return { mods: s.mods !== false, manifest: s.manifest !== false };
}

const EXAMPLE_PATH = path.join(process.cwd(), 'config.example.json');

// First run after a fresh install: start from config.example.json with the Windows user as driver name.
function createConfigFromExample() {
  const c = JSON.parse(fs.readFileSync(EXAMPLE_PATH, 'utf8').replace(/^﻿/, ''));
  let user = '';
  try { user = require('node:os').userInfo().username; } catch {}
  if (user) c.driverName = user.slice(0, 40);
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(c, null, 2), 'utf8');
  console.log('[CONFIG] Created config.json from config.example.json.');
}

// Move only known shipped endpoints to the working Northflank relay.
function migrateRelayEndpoint(c) {
  const { changed } = migrateRelayDefaults(c);
  if (changed) try { fs.writeFileSync(CONFIG_PATH, JSON.stringify(c, null, 2), 'utf8'); console.log('[CONFIG] Relay moved to Northflank; existing settings and backups preserved.'); } catch {}
  if (process.platform === 'win32') for (const f of require('./relayDefaults').migrateRadioShortcut(require('./relayDefaults').desktopDirs())) console.log(`[CONFIG] Updated radio shortcut ${f}`);
  return c;
}

function loadConfig() {
  if (!fs.existsSync(CONFIG_PATH)) {
    try { createConfigFromExample(); } catch (e) { console.error(`[CONFIG] config.json missing and could not be created: ${e.message}`); process.exit(1); }
  }
  const c = migrateRelayEndpoint(readRawConfig());
  return {
    pairingCode: c.pairingCode || '',
    driverName: c.driverName || 'ATS Driver',
    dashboardPort: Number(c.dashboardPort || 4280),
    dashboardHost: c.dashboardHost || '127.0.0.1',
    snapshotIntervalMs: Math.max(500, Number(c.snapshotIntervalMs || 1000)),
    // intervalMs: how often we sync with the convoy relay (bandwidth!). The local dashboard is unaffected.
    remote: { enabled: Boolean(c.remote?.enabled), endpoint: c.remote?.endpoint || '', apiKey: c.remote?.apiKey || '', intervalMs: clamp(c.remote?.intervalMs, 2000, 30000, 3000), backupEndpoints: normalizeEndpoints(c.remote?.backupEndpoints) },
    cb: normalizeCb(c.cb),
    voice: normalizeVoice(c.voice),
    ai: normalizeAi(c.ai),
    voicePack: c.voicePack || {},
    weather: { enabled: c.weather?.enabled === true },
    calendar: { feeds: Array.isArray(c.calendar?.feeds) ? c.calendar.feeds.slice(0, 3) : [] },
    jarvis: { enabled: c.jarvis?.enabled !== false, url: typeof c.jarvis?.url === 'string' ? c.jarvis.url : '' },
    truckersmp: { playerId: /^\d{1,20}$/.test(String(c.truckersmp?.playerId || '')) ? String(c.truckersmp.playerId) : null },
    money: { fuelPrice: Number(c.money?.fuelPrice) > 0 && Number(c.money.fuelPrice) <= 20 ? Number(c.money.fuelPrice) : 4.2 },
    formation: { followSeconds: Math.max(2, Math.min(10, Number(c.formation?.followSeconds) || 4)) },
    livery: { sdUrl: typeof c.livery?.sdUrl === 'string' ? c.livery.sdUrl : 'http://127.0.0.1:7860' },
    https: { enabled: c.https?.enabled === true, port: Math.max(1024, Math.min(65535, Number(c.https?.port) || 4443)) },
    discord: normalizeDiscord(c.discord),
    alerts: normalizeAlerts(c.alerts),
    sharing: normalizeSharing(c.sharing),
    push: c.push || {},
    stream: c.stream || {},
    obs: c.obs || {},
    mixer: c.mixer || {},
    twitch: c.twitch || {},
    fun: { challenges: c.fun?.challenges !== false, milestones: c.fun?.milestones !== false, photoWall: Boolean(c.fun?.photoWall), publicLive: Boolean(c.fun?.publicLive) }
  };
}

// Merge top-level values (e.g. pairingCode) into config.json on disk.
function saveConfigRoot(patch) {
  let stored = {};
  try { stored = readRawConfig(); } catch {}
  Object.assign(stored, patch);
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(stored, null, 2), 'utf8');
}

// Merge one section into config.json on disk, leaving every other key untouched.
function saveConfigSection(section, value) {
  let stored = {};
  try { stored = readRawConfig(); } catch {}
  stored[section] = { ...(stored[section] || {}), ...value };
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(stored, null, 2), 'utf8');
  return stored[section];
}

module.exports = { loadConfig, saveConfigSection, saveConfigRoot, normalizeVoice, normalizeDiscord, normalizeAlerts, normalizeSharing, normalizeEndpoints, normalizeCb };
