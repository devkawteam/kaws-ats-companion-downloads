// Posts trip summaries and achievement unlocks to a Discord channel webhook.
// The webhook URL lives only in the local config.json and is never sent to the relay.

const VERSION = require('../package.json').version;

const COLORS = { delivered: 0x53ed63, cancelled: 0xff8a13, ended: 0x2a8fff, achievement: 0xa84cff, test: 0x2a8fff };
const money = v => `$${Math.round(Number(v) || 0).toLocaleString('en-US')}`;
const mi = v => `${(Number(v) || 0).toFixed(1)} mi`;
function duration(sec) {
  const s = Math.max(0, Math.round(Number(sec) || 0));
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60);
  return h ? `${h}h ${m}m` : `${m}m`;
}

class DiscordNotifier {
  constructor(settings = {}, driverName = 'Driver') {
    this.settings = settings;
    this.driverName = driverName;
    this.queue = Promise.resolve();
    this.lastError = null;
    this.lastSentAt = null;
  }

  setSettings(settings) { this.settings = { ...this.settings, ...settings }; }

  ready() { return Boolean(this.settings.enabled && this.settings.webhookUrl); }

  post(embed, files = []) {
    if (!this.ready()) return Promise.resolve(false);
    // Attach screenshots (max 3, each under 8 MB) and show the first one in the card.
    const fs = require('node:fs'), path = require('node:path');
    const attach = files.filter(f => { try { return fs.statSync(f).size < 8e6; } catch { return false; } }).slice(0, 3);
    const fullEmbed = { ...embed, footer: { text: `KAW'S ATS Playground Companion v${VERSION}` }, timestamp: new Date().toISOString() };
    const safeName = f => path.basename(f).replace(/[^\w.-]/g, '_');
    if (attach.length) fullEmbed.image = { url: `attachment://${safeName(attach[0])}` };
    const json = { username: "KAW'S ATS Companion", embeds: [fullEmbed] };
    let body, headers = { 'content-type': 'application/json' };
    if (attach.length) {
      body = new FormData();
      body.append('payload_json', JSON.stringify(json));
      attach.forEach((f, i) => body.append(`files[${i}]`, new Blob([fs.readFileSync(f)]), safeName(f)));
      headers = {};
    } else body = JSON.stringify(json);
    // Serialize posts so a burst of events never trips Discord's rate limit.
    this.queue = this.queue.then(async () => {
      try {
        const res = await fetch(this.settings.webhookUrl, { method: 'POST', headers, body });
        if (!res.ok) throw new Error(`Discord webhook HTTP ${res.status}`);
        this.lastSentAt = new Date().toISOString();
        this.lastError = null;
        return true;
      } catch (e) {
        this.lastError = e.message;
        console.error('[DISCORD]', e.message);
        return false;
      }
    });
    return this.queue;
  }

  tripSummary(trip, overspeedEvents = null, screenshots = []) {
    if (!trip || !this.settings.tripSummaries) return Promise.resolve(false);
    const title = trip.status === 'delivered' ? '✅ Delivery complete' : trip.status === 'cancelled' ? '⚠️ Job cancelled' : '🛑 Job ended';
    const fields = [
      { name: 'Route', value: `${trip.originCity || '?'} → ${trip.destinationCity || '?'}`, inline: false },
      { name: 'Cargo', value: `${trip.cargo || 'Unknown'}${trip.cargoMassKg ? ` · ${Math.round(trip.cargoMassKg / 453.6).toLocaleString('en-US')} lb` : ''}`, inline: true },
      { name: 'Distance', value: mi(trip.milesDriven), inline: true },
      { name: 'Time', value: duration(trip.durationSeconds), inline: true },
      { name: 'Fuel used', value: `${(Number(trip.fuelUsedGallons) || 0).toFixed(1)} gal`, inline: true },
      { name: 'Top speed', value: `${Math.round(Number(trip.maxSpeedMph) || 0)} mph`, inline: true },
      { name: 'Cargo damage', value: `${((Number(trip.endCargoDamage) || 0) * 100).toFixed(1)}%`, inline: true }
    ];
    if (this.settings.includeIncome) fields.splice(1, 0, { name: 'Income', value: money(trip.deliveredIncome || trip.offeredIncome), inline: true });
    if (trip.eco) fields.push({ name: 'Eco score', value: `${trip.eco.score}/100 (${trip.eco.grade})${trip.eco.tips?.[0] ? `
_${trip.eco.tips[0]}_` : ''}`, inline: false });
    if (overspeedEvents !== null) fields.push({ name: 'Speeding', value: `${Math.round((trip.speedingSeconds || 0) / 60)} min · ${overspeedEvents} time(s)`, inline: true });
    return this.post({ title, description: `**${trip.driverName || this.driverName}** · ${[trip.truckMake, trip.truckModel].filter(Boolean).join(' ') || 'Truck'}`, color: COLORS[trip.status] || COLORS.ended, fields }, screenshots);
  }

  achievement(a) {
    if (!a || !this.settings.achievements) return Promise.resolve(false);
    return this.post({ title: '🏆 Achievement unlocked', description: `**${this.driverName}** earned **${a.name}**`, color: COLORS.achievement });
  }

  eventAnnouncement(e) {
    if (!e || this.settings.events === false) return Promise.resolve(false);
    const when = e.departureTime ? `<t:${Math.floor(Date.parse(e.departureTime) / 1000)}:F> (<t:${Math.floor(Date.parse(e.departureTime) / 1000)}:R>)` : 'Time TBA';
    return this.post({ title: `🚚 Convoy planned: ${e.name}`, description: `Hosted by **${e.host}**. RSVP in the Companion (Convoy Sessions).`, color: COLORS.ended, fields: [
      { name: 'Departs', value: when, inline: false },
      { name: 'Meet point', value: e.meetPoint || 'TBA', inline: true },
      { name: 'Destination', value: e.destination || 'TBA', inline: true },
      ...(e.notes ? [{ name: 'Notes', value: String(e.notes).slice(0, 900), inline: false }] : [])
    ] });
  }

  eventReminder(e, minutes) {
    if (!e || this.settings.events === false) return Promise.resolve(false);
    return this.post({ title: `⏰ Convoy in ${minutes} minutes: ${e.name}`, description: `Meet at **${e.meetPoint || 'the meet point'}**${e.destination ? ` → ${e.destination}` : ''}. Open the Companion's Convoy Hub to check your mods.`, color: COLORS.cancelled });
  }

  test() {
    return this.post({ title: 'Companion connected', description: `Discord trip summaries are working for **${this.driverName}**.`, color: COLORS.test });
  }

  status() {
    return { enabled: Boolean(this.settings.enabled), configured: Boolean(this.settings.webhookUrl), tripSummaries: this.settings.tripSummaries !== false, achievements: this.settings.achievements !== false, includeIncome: this.settings.includeIncome !== false, lastSentAt: this.lastSentAt, lastError: this.lastError };
  }
}

module.exports = { DiscordNotifier };
