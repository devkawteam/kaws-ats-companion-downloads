// Twitch: stream markers, auto clips and channel-point predictions from the truck.
// Sign-in uses Twitch's Device Code flow for public clients: the streamer opens twitch.tv/activate and
// types a short code — no password or client secret ever touches the Companion. The KAW Twitch app's
// Client ID is public (set DEFAULT_CLIENT_ID below or config.twitch.clientId).
// - Markers on job start, delivery, crash, achievements (only while live).
// - Clip on a crash (at most one a minute).
// - Prediction on job start: "On time?" — resolved on delivery, cancelled if the job is cancelled.
//   Predictions need Twitch Affiliate or Partner.

const { saveConfigSection } = require('./config');

const DEFAULT_CLIENT_ID = 'oxrnkoqt5og22k2kt68dy275em5bao'; // public KAW Twitch app (Client Type: Public)
const SCOPES = ['channel:manage:broadcast', 'clips:edit', 'channel:manage:predictions', 'channel:read:predictions'];
const ID = 'https://id.twitch.tv/oauth2';
const API = 'https://api.twitch.tv/helix';
const form = o => new URLSearchParams(o).toString();

class TwitchBridge {
  constructor({ config, stream }) {
    this.stream = stream;
    const t = config.twitch || {};
    this.settings = {
      clientId: String(t.clientId || DEFAULT_CLIENT_ID || ''),
      token: t.token || null,            // { access, refresh, expiresAt, scopes }
      user: t.user || null,              // { id, login, name }
      markers: t.markers !== false, clips: t.clips !== false, predictions: Boolean(t.predictions)
    };
    this.login = null;                   // pending device login { userCode, verificationUri, expiresAt }
    this.error = null;
    this.live = false;
    this.lastClipAt = 0;
    this.prediction = null;              // { id, outcomes: { yes, no } }
    this.deadline = null;
    this.log = [];
  }

  save() { try { saveConfigSection('twitch', this.settings); } catch (e) { console.error('[TWITCH]', e.message); } }
  note(msg) { this.log.unshift({ at: new Date().toISOString(), msg }); this.log = this.log.slice(0, 20); }

  ready() { return Boolean(this.settings.clientId && this.settings.token?.access && this.settings.user?.id); }

  // ---------- sign-in (Device Code Grant) ----------
  async startLogin() {
    if (!this.settings.clientId) throw new Error('The KAW Twitch app is not set up yet (missing Client ID).');
    const r = await fetch(`${ID}/device`, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: form({ client_id: this.settings.clientId, scopes: SCOPES.join(' ') }) });
    const d = await r.json();
    if (!r.ok) throw new Error(d.message || `Twitch HTTP ${r.status}`);
    this.login = { deviceCode: d.device_code, userCode: d.user_code, verificationUri: d.verification_uri, expiresAt: Date.now() + d.expires_in * 1000, interval: Math.max(2, d.interval || 5) };
    this.pollLogin();
    return { userCode: d.user_code, verificationUri: d.verification_uri, expiresIn: d.expires_in };
  }

  async pollLogin() {
    const l = this.login;
    if (!l) return;
    if (Date.now() > l.expiresAt) { this.login = null; this.error = 'The Twitch code expired — try Connect again.'; return; }
    try {
      const r = await fetch(`${ID}/token`, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: form({ client_id: this.settings.clientId, scopes: SCOPES.join(' '), device_code: l.deviceCode, grant_type: 'urn:ietf:params:oauth:grant-type:device_code' }) });
      const d = await r.json();
      if (r.ok && d.access_token) {
        this.settings.token = { access: d.access_token, refresh: d.refresh_token, expiresAt: Date.now() + (d.expires_in || 3600) * 1000, scopes: d.scope || SCOPES };
        const me = await this.api('GET', '/users');
        const u = me.data?.[0];
        this.settings.user = u ? { id: u.id, login: u.login, name: u.display_name } : null;
        this.login = null; this.error = null;
        this.save();
        this.note(`Connected as ${u?.display_name || u?.login}`);
        return;
      }
      if (d.message && !/authorization_pending/i.test(d.message)) { this.login = null; this.error = `Twitch: ${d.message}`; return; }
    } catch (e) { this.error = e.message; }
    setTimeout(() => this.pollLogin(), l.interval * 1000).unref?.();
  }

  disconnect() { this.settings.token = null; this.settings.user = null; this.prediction = null; this.save(); this.note('Disconnected'); }

  async refresh() {
    const t = this.settings.token;
    if (!t?.refresh) throw new Error('Twitch sign-in expired — connect again.');
    const r = await fetch(`${ID}/token`, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: form({ client_id: this.settings.clientId, grant_type: 'refresh_token', refresh_token: t.refresh }) });
    const d = await r.json();
    if (!r.ok || !d.access_token) { this.disconnect(); throw new Error('Twitch sign-in expired — connect again.'); }
    this.settings.token = { ...t, access: d.access_token, refresh: d.refresh_token || t.refresh, expiresAt: Date.now() + (d.expires_in || 3600) * 1000 };
    this.save();
  }

  async api(method, path, body, retried = false) {
    if (!this.settings.token?.access) throw new Error('Twitch is not connected.');
    if (this.settings.token.expiresAt && Date.now() > this.settings.token.expiresAt - 60000 && !retried) await this.refresh();
    const r = await fetch(API + path, { method, headers: { 'client-id': this.settings.clientId, authorization: `Bearer ${this.settings.token.access}`, ...(body ? { 'content-type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined });
    if (r.status === 401 && !retried) { await this.refresh(); return this.api(method, path, body, true); }
    const d = r.status === 204 ? {} : await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(d.message || `Twitch HTTP ${r.status}`);
    return d;
  }

  // ---------- truck events ----------
  observe(state) {
    if (state.job?.active && Number.isFinite(Number(state.navigation?.deadlineMinutesRemaining))) this.deadline = Number(state.navigation.deadlineMinutesRemaining);
  }

  async onEvent(ev, state) {
    if (!this.ready()) return;
    const uid = this.settings.user.id;
    try {
      if (this.settings.markers && ['job', 'delivery', 'crash', 'achievement', 'convoyStart'].includes(ev.type) && this.live) {
        await this.api('POST', '/streams/markers', { user_id: uid, description: `${ev.title}${ev.detail ? ` — ${ev.detail}` : ''}`.slice(0, 140) });
        this.note(`Marker: ${ev.title}`);
      }
      if (this.settings.clips && ev.type === 'crash' && this.live && Date.now() - this.lastClipAt > 60000) {
        this.lastClipAt = Date.now();
        const c = await this.api('POST', `/clips?broadcaster_id=${uid}`);
        const id = c.data?.[0]?.id;
        if (id) { this.note(`Clip: https://clips.twitch.tv/${id}`); this.stream?.emit('info', 'Crash clipped on Twitch', `clips.twitch.tv/${id}`, { clip: id }); }
      }
      if (this.settings.predictions && ev.type === 'job' && this.live && !this.prediction) {
        const to = ev.data?.to || 'the destination';
        const p = await this.api('POST', '/predictions', { broadcaster_id: uid, title: `Will we make ${to} on time?`.slice(0, 45), outcomes: [{ title: 'Yes, on time' }, { title: 'Nope, late' }], prediction_window: 180 });
        const pd = p.data?.[0];
        if (pd) { this.prediction = { id: pd.id, yes: pd.outcomes[0].id, no: pd.outcomes[1].id }; this.note(`Prediction opened: ${pd.title}`); }
      }
      if (this.prediction && (ev.type === 'delivery' || ev.type === 'cancelled')) {
        const p = this.prediction;
        this.prediction = null;
        if (ev.type === 'cancelled') { await this.api('PATCH', '/predictions', { broadcaster_id: uid, id: p.id, status: 'CANCELED' }); this.note('Prediction cancelled (job cancelled)'); }
        else {
          const onTime = this.deadline === null ? true : this.deadline >= 0;
          await this.api('PATCH', '/predictions', { broadcaster_id: uid, id: p.id, status: 'RESOLVED', winning_outcome_id: onTime ? p.yes : p.no });
          this.note(`Prediction resolved: ${onTime ? 'on time' : 'late'}`);
        }
      }
    } catch (e) {
      this.note(`Error: ${e.message}`);
      if (/affiliate|partner/i.test(e.message)) this.error = 'Predictions need Twitch Affiliate or Partner — markers and clips still work.';
    }
  }

  update(patch = {}) {
    for (const k of ['markers', 'clips', 'predictions']) if (patch[k] !== undefined) this.settings[k] = Boolean(patch[k]);
    if (patch.clientId !== undefined && /^[a-z0-9]{0,64}$/i.test(String(patch.clientId))) this.settings.clientId = String(patch.clientId);
    this.save();
    return this.status();
  }

  status() {
    return { configured: Boolean(this.settings.clientId), connected: this.ready(), user: this.settings.user, markers: this.settings.markers, clips: this.settings.clips, predictions: this.settings.predictions, live: this.live, login: this.login ? { userCode: this.login.userCode, verificationUri: this.login.verificationUri, expiresAt: new Date(this.login.expiresAt).toISOString() } : null, error: this.error, log: this.log.slice(0, 8) };
  }
}

module.exports = { TwitchBridge, SCOPES };
