// Convoy calendar: Companion convoy events plus up to three PUBLIC iCal feeds (e.g. a public Google Calendar)
// the driver adds. Read-only; feeds are fetched over https, size/time limited and cached. Author: Kaw.
'use strict';

const MAX_BYTES = 1_000_000, TTL = 15 * 60000;
const clean = (v, n) => String(v ?? '').replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, n);

// iCal text values: \n, \, and \; escapes.
const icsText = v => String(v || '').replace(/\\n/gi, ' ').replace(/\\([,;\\])/g, '$1');
function icsDate(value, params = '') {
  const v = String(value || '').trim();
  let m = /^(\d{4})(\d{2})(\d{2})$/.exec(v);
  if (m) return { iso: new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])).toISOString(), allDay: true };
  m = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})(Z?)$/.exec(v);
  if (!m) return null;
  const [y, mo, d, h, mi, s] = m.slice(1, 7).map(Number);
  // Z = UTC. Otherwise floating/TZID time: treated as this PC's local time (good enough for a convoy list).
  const date = m[7] ? new Date(Date.UTC(y, mo - 1, d, h, mi, s)) : new Date(y, mo - 1, d, h, mi, s);
  return { iso: date.toISOString(), allDay: false, floating: !m[7], tz: (/TZID=([^;:]+)/.exec(params) || [])[1] || null };
}
function parseIcs(text, sourceName = 'Calendar') {
  const lines = String(text || '').replace(/\r\n[ \t]/g, '').replace(/\n[ \t]/g, '').split(/\r?\n/);
  const events = []; let cur = null;
  for (const line of lines) {
    if (line === 'BEGIN:VEVENT') { cur = {}; continue; }
    if (line === 'END:VEVENT') { if (cur?.start) events.push(cur); cur = null; continue; }
    if (!cur) continue;
    const i = line.indexOf(':'); if (i < 0) continue;
    const [name, ...rest] = line.slice(0, i).split(';'), params = rest.join(';'), value = line.slice(i + 1);
    if (name === 'DTSTART') cur.start = icsDate(value, params);
    else if (name === 'DTEND') cur.end = icsDate(value, params);
    else if (name === 'SUMMARY') cur.title = clean(icsText(value), 120);
    else if (name === 'LOCATION') cur.location = clean(icsText(value), 120);
    else if (name === 'DESCRIPTION') cur.description = clean(icsText(value), 400);
    else if (name === 'UID') cur.uid = clean(value, 120);
    else if (name === 'RRULE') cur.repeats = true;
    else if (name === 'STATUS') cur.cancelled = /CANCELLED/i.test(value);
  }
  return events.filter(e => !e.cancelled).map(e => ({ id: `ics:${e.uid || e.start.iso + e.title}`, source: sourceName, title: e.title || 'Event', start: e.start.iso, end: e.end?.iso || null, allDay: e.start.allDay, location: e.location || null, description: e.description || null, repeats: Boolean(e.repeats) }));
}

// Calendar feed address: https only (or webcal:// which is https), no credentials.
function cleanFeedUrl(raw) {
  try {
    const u = new URL(String(raw || '').trim().replace(/^webcal:\/\//i, 'https://'));
    if (u.protocol !== 'https:' || u.username || u.password) return null;
    return u.href;
  } catch { return null; }
}

class ConvoyCalendar {
  constructor(settings = {}, { fetchImpl = fetch, now = () => Date.now() } = {}) {
    this.settings = settings; this.fetch = fetchImpl; this.now = now; this.cache = new Map();
  }
  feeds() { return (Array.isArray(this.settings.feeds) ? this.settings.feeds : []).slice(0, 3).map(f => ({ name: clean(f.name, 40) || 'Calendar', url: cleanFeedUrl(f.url) })).filter(f => f.url); }

  async loadFeed(f) {
    const hit = this.cache.get(f.url);
    if (hit && this.now() - hit.at < TTL) return hit.value;
    try {
      const r = await this.fetch(f.url, { redirect: 'follow', signal: AbortSignal.timeout(8000), headers: { accept: 'text/calendar, text/plain' } });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const len = Number(r.headers?.get?.('content-length') || 0); if (len > MAX_BYTES) throw new Error('feed too large');
      const text = (await r.text()).slice(0, MAX_BYTES);
      if (!/BEGIN:VCALENDAR/.test(text)) throw new Error('not an iCal feed');
      const value = { ok: true, events: parseIcs(text, f.name) };
      this.cache.set(f.url, { at: this.now(), value });
      return value;
    } catch (e) { return { ok: false, error: `${f.name}: ${e.message}`, events: hit?.value?.events || [] }; }
  }

  // companionEvents: eventsHub.list(roster). Returns the next `days` days, sorted.
  async upcoming(companionEvents = [], days = 30) {
    const from = this.now() - 3 * 3600000, to = this.now() + days * 86400000;
    const items = companionEvents.filter(e => e.departureTime).map(e => ({ id: `kaw:${e.id}`, eventId: e.id, source: 'Companion convoy events', title: e.name, start: e.departureTime, end: null, allDay: false, location: [e.meetPoint, e.destination].filter(Boolean).join(' → ') || null, description: e.notes || null, host: e.host || null, status: e.status, myRsvp: e.myRsvp || null, going: e.going ?? null, rsvp: true }));
    const errors = [];
    for (const f of this.feeds()) { const r = await this.loadFeed(f); if (!r.ok) errors.push(r.error); items.push(...r.events); }
    return { events: items.filter(e => { const t = Date.parse(e.start); return t >= from && t <= to; }).sort((a, b) => Date.parse(a.start) - Date.parse(b.start)).slice(0, 100), feeds: this.feeds().map(f => ({ name: f.name, host: new URL(f.url).hostname })), errors };
  }
}

// One event or a list as an .ics file (for "Add to my calendar").
function toIcs(events) {
  const stamp = d => new Date(d).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
  const esc = v => String(v || '').replace(/([,;\\])/g, '\\$1').replace(/\n/g, '\\n');
  const body = events.map(e => ['BEGIN:VEVENT', `UID:${esc(e.id)}@kaw-ats-companion`, `DTSTAMP:${stamp(Date.now())}`, `DTSTART:${stamp(e.start)}`, `DTEND:${stamp(e.end || Date.parse(e.start) + 2 * 3600000)}`, `SUMMARY:${esc(e.title)}`, e.location ? `LOCATION:${esc(e.location)}` : '', e.description ? `DESCRIPTION:${esc(e.description)}` : '', 'END:VEVENT'].filter(Boolean).join('\r\n'));
  return ['BEGIN:VCALENDAR', 'VERSION:2.0', "PRODID:-//KAW'S ATS PLAYGROUND//Companion//EN", ...body, 'END:VCALENDAR'].join('\r\n') + '\r\n';
}

module.exports = { ConvoyCalendar, parseIcs, cleanFeedUrl, toIcs };
