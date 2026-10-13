// Phone push notifications through ntfy (https://ntfy.sh — free app for Android & iOS, no account).
// The driver subscribes to a private topic name in the ntfy app; the Companion publishes to it.
// Topic names are effectively passwords, so the default is a long random one.

const crypto = require('node:crypto');
const { saveConfigSection } = require('./config');

const CATEGORIES = ['critical', 'jobs', 'convoy', 'friends', 'trips'];

function normalizePush(p = {}) {
  const topic = String(p.topic || '').trim();
  const server = String(p.server || 'https://ntfy.sh').trim().replace(/\/+$/, '');
  return {
    enabled: Boolean(p.enabled),
    topic: /^[\w-]{6,64}$/.test(topic) ? topic : '',
    server: /^https:\/\/[^\s/]+$/i.test(server) ? server : 'https://ntfy.sh',
    categories: Object.fromEntries(CATEGORIES.map(c => [c, p.categories?.[c] !== false]))
  };
}

class PushNotifier {
  constructor(settings = {}) {
    this.settings = normalizePush(settings);
    this.last = new Map();
    this.lastError = null;
    this.lastSentAt = null;
  }

  static randomTopic() { return `kaw-ats-${crypto.randomBytes(9).toString('base64url').toLowerCase().replace(/[^a-z0-9]/g, '')}`; }

  update(patch) {
    const next = normalizePush({ ...this.settings, ...patch, categories: { ...this.settings.categories, ...(patch.categories || {}) } });
    if (patch.topic !== undefined && String(patch.topic).trim() && !next.topic) throw new Error('Topic must be 6–64 letters, numbers, - or _');
    this.settings = next;
    saveConfigSection('push', next);
    return this.status();
  }

  ready() { return this.settings.enabled && Boolean(this.settings.topic); }

  // send('critical', 'Fuel critical', '5% left', { key: 'fuel', priority: 5, tags: ['fuelpump'] })
  async send(category, title, message, { key = title, cooldownMs = 120000, priority = 3, tags = [], click = null } = {}) {
    if (!this.ready() || this.settings.categories[category] === false) return false;
    const now = Date.now();
    if (now - (this.last.get(key) || 0) < cooldownMs) return false;
    this.last.set(key, now);
    try {
      const headers = { Title: String(title).slice(0, 120), Priority: String(Math.max(1, Math.min(5, priority))), Tags: ['truck', ...tags].join(',') };
      if (click) headers.Click = click;
      const res = await fetch(`${this.settings.server}/${encodeURIComponent(this.settings.topic)}`, { method: 'POST', headers, body: String(message || '').slice(0, 1000), signal: AbortSignal.timeout(10000) });
      if (!res.ok) throw new Error(`ntfy HTTP ${res.status}`);
      this.lastSentAt = new Date().toISOString();
      this.lastError = null;
      return true;
    } catch (e) {
      this.lastError = e.message;
      console.error('[PUSH]', e.message);
      return false;
    }
  }

  test() { this.last.delete('test'); return this.send('critical', "KAW'S ATS Companion", 'Push notifications are working. Drive safe!', { key: 'test', cooldownMs: 0, tags: ['white_check_mark'] }); }

  status() { return { ...this.settings, ready: this.ready(), lastSentAt: this.lastSentAt, lastError: this.lastError, subscribeUrl: this.settings.topic ? `${this.settings.server}/${this.settings.topic}` : null }; }
}

module.exports = { PushNotifier, normalizePush };
