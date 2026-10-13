// Watches the convoy relay (which also hosts the Companion CB radio) so the dashboard can say
// clearly when it is down — e.g. a suspended Render service — instead of showing a broken page.
// With backup relays configured it follows whichever relay the Companion is currently using.

const crypto = require('node:crypto');
const { checkRelayHealth } = require('./relayHealth');
const originOf = url => { try { return url ? new URL(url).origin : null; } catch { return null; } };
// Must match safeId() + publicId() in relay-server/server.js.
const safeId = v => String(v || '').trim().toLowerCase().replace(/[^a-z0-9_-]+/g, '-').slice(0, 64) || 'default';
const publicLiveId = pairingCode => crypto.createHash('sha256').update(`kaw-live:${safeId(pairingCode)}`).digest('hex').slice(0, 12);

// A sign-in page or other web page answering 200 is not a healthy relay (see relayHealth.js).
const probe = origin => checkRelayHealth(origin);

class RelayMonitor {
  constructor(config) {
    this.config = config;
    this.activeEndpoint = () => config.remote.endpoint;
    this.state = { checkedAt: null, lastUpAt: null, lastPushOkAt: null, lastPushError: null };
    this.primary = { status: 'checking' };
    this.active = null;
  }

  // Called by index.js so the monitor always reflects the relay the Companion is using.
  follow(getActiveEndpoint) { this.activeEndpoint = getActiveEndpoint; }

  async check() {
    const primaryOrigin = originOf(this.config.remote.endpoint);
    const activeOrigin = originOf(this.activeEndpoint()) || primaryOrigin;
    this.primary = { origin: primaryOrigin, ...(await probe(primaryOrigin)) };
    this.active = activeOrigin === primaryOrigin ? this.primary : { origin: activeOrigin, ...(await probe(activeOrigin)) };
    // No backup in use but one is configured: report the first healthy one so the CB can move there.
    if (!this.active.up && activeOrigin === primaryOrigin) {
      for (const url of this.config.remote.backupEndpoints || []) {
        const o = originOf(url);
        const b = { origin: o, ...(await probe(o)) };
        if (b.up) { this.active = b; break; }
      }
    }
    if (this.active.up) this.state.lastUpAt = new Date().toISOString();
    this.state.checkedAt = new Date().toISOString();
    return this.get();
  }

  pushResult(ok, error = null) {
    if (ok) { this.state.lastPushOkAt = new Date().toISOString(); this.state.lastPushError = null; }
    else { this.state.lastPushError = String(error || 'failed').slice(0, 200); this.state.lastPushErrorAt = new Date().toISOString(); }
  }

  // Is this Companion actually IN the convoy? "Relay reachable" is not enough: the relay can refuse
  // this Companion (missing/wrong relay key), or sharing can be off. Drivers then see a green light
  // while nobody can see them on the map.
  pushState() {
    const r = this.config.remote || {};
    if (!r.enabled) return { pushState: 'off', pushDetail: 'Convoy sharing is turned off on this PC, so nobody in the convoy can see you and you only see drivers who already shared before. Turn it on in “Join a convoy” on the Convoy page.' };
    const err = this.state.lastPushError || '';
    const okAt = Date.parse(this.state.lastPushOkAt || 0) || 0, errAt = Date.parse(this.state.lastPushErrorAt || 0) || 0;
    if (err && errAt >= okAt) {
      if (/HTTP 40[13]\b|unauthori[sz]ed|invalid session/i.test(err)) return { pushState: 'rejected', pushDetail: `The convoy relay refused this Companion (${/403/.test(err) ? 'wrong convoy secret' : 'missing or wrong relay key'}), so you are NOT in the convoy: nobody can see you and you can't see them. Use KAW's one-click connect link from Discord (/companion setup), or enter the relay key in “Join a convoy” on the Convoy page.` };
      return { pushState: 'failing', pushDetail: `Your position isn't reaching the convoy relay right now (${err}).` };
    }
    if (okAt && Date.now() - okAt < 60000) return { pushState: 'ok', pushDetail: null };
    return { pushState: 'waiting', pushDetail: 'Waiting for the first successful update to the convoy relay.' };
  }

  start(intervalMs = 60000) {
    this.check();
    this.timer = setInterval(() => this.check(), intervalMs);
    this.timer.unref?.();
  }

  get() {
    const a = this.active || this.primary || {};
    const primaryOrigin = originOf(this.config.remote.endpoint);
    return {
      configured: Boolean(primaryOrigin),
      enabled: Boolean(this.config.remote.enabled && primaryOrigin),
      origin: a.origin || primaryOrigin,
      radioUrl: a.origin ? `${a.origin}/radio` : primaryOrigin ? `${primaryOrigin}/radio` : null,
      up: a.up ?? null,
      status: primaryOrigin ? (a.status || 'checking') : 'not-configured',
      httpStatus: a.httpStatus ?? null,
      detail: a.detail || null,
      usingBackup: Boolean(a.origin && primaryOrigin && a.origin !== primaryOrigin),
      primary: { origin: primaryOrigin, status: this.primary.status, up: this.primary.up ?? null, detail: this.primary.detail || null },
      backups: (this.config.remote.backupEndpoints || []).map(originOf),
      // Public live page for this convoy (same hash the relay uses; never reveals the pairing code).
      publicLiveUrl: primaryOrigin || a.origin ? `${a.origin || primaryOrigin}/live/${publicLiveId(this.config.pairingCode)}` : null,
      convoyTvUrl: primaryOrigin || a.origin ? `${primaryOrigin || a.origin}/tv/${publicLiveId(this.config.pairingCode)}` : null,
      discordVoiceUrl: this.config.cb?.discordVoiceUrl || '',
      discordInviteUrl: this.config.cb?.discordInviteUrl || '',
      ...this.state,
      ...this.pushState(),
      usage: this.usage?.() || null
    };
  }
}

module.exports = { RelayMonitor };
