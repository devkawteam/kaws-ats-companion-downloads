'use strict';

const DEFAULT_RELAY = 'https://p01--kaw-relay--4h7w2xmhzqqq.code.run';
const MAIN_RELAY = `${DEFAULT_RELAY}/api/telemetry`;
const BLOCKED_RELAY = 'https://ats.kawsplayground.online';
const OLD_RENDER_RELAY = 'https://kaws-ats-playground.onrender.com/api/telemetry';
const canonical = value => String(value || '').trim().replace(/\/+$/, '');

// Blank addresses and known shipped defaults migrate. Custom relays and Jarvis preview overrides stay intact.
function migrateRelayDefaults(config) {
  let changed = false;
  const old = canonical(config.remote?.endpoint);
  if (!old || [`${BLOCKED_RELAY}/api/telemetry`, OLD_RENDER_RELAY].includes(old)) {
    let backups = (config.remote?.backupEndpoints || []).filter(url => ![MAIN_RELAY, `${BLOCKED_RELAY}/api/telemetry`].includes(canonical(url)));
    if (old === OLD_RENDER_RELAY && !backups.some(url => canonical(url) === OLD_RENDER_RELAY)) backups.unshift(OLD_RENDER_RELAY);
    config.remote = {...config.remote, endpoint: MAIN_RELAY, backupEndpoints: [...new Set(backups)]};
    changed = true;
  }
  if (canonical(config.jarvis?.url) === BLOCKED_RELAY) {
    config.jarvis = {...config.jarvis, url: DEFAULT_RELAY};
    changed = true;
  }
  return {config, changed};
}

// An address being saved right now (e.g. from an older Discord bot connect link): the blocked address
// becomes the working relay immediately, instead of only at the next restart.
function liveEndpoint(endpoint) {
  return canonical(endpoint) === `${BLOCKED_RELAY}/api/telemetry` ? MAIN_RELAY : endpoint;
}

// Older installers put a "KAW'S Radio" desktop shortcut on the blocked address. Rewrite only that exact
// shortcut, only when it still points at the old radio page; anything else is left alone.
function migrateRadioShortcut(desktops = []) {
  const fs = require('node:fs'), path = require('node:path');
  const fixed = [];
  for (const dir of desktops) {
    const file = path.join(dir, "KAW'S Radio.url");
    try {
      const text = fs.readFileSync(file, 'utf8');
      if (!/^URL=https:\/\/ats\.kawsplayground\.online\/radio\s*$/m.test(text)) continue;
      fs.writeFileSync(file, text.replace(/^URL=https:\/\/ats\.kawsplayground\.online\/radio\s*$/m, `URL=${DEFAULT_RELAY}/radio`), 'ascii');
      fixed.push(file);
    } catch {}
  }
  return fixed;
}
function desktopDirs(env = process.env) {
  const path = require('node:path');
  return [env.USERPROFILE && path.join(env.USERPROFILE, 'Desktop'), env.OneDrive && path.join(env.OneDrive, 'Desktop'), env.PUBLIC && path.join(env.PUBLIC, 'Desktop')].filter(Boolean);
}

module.exports = {DEFAULT_RELAY, MAIN_RELAY, migrateRelayDefaults, liveEndpoint, migrateRadioShortcut, desktopDirs};
