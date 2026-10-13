// Stream Studio: the streamer side of chat commands, polls and viewer effects.
// Holds the private chat key the relay uses for /c/<key>/<command>, the stream info shared with the
// convoy (live flag, stream link), the current viewer poll, and plays viewer effects that arrive
// from the relay (horn, confetti, shoutout) through the Stream Hub, so overlays show them.

const crypto = require('node:crypto');
const { saveConfigSection } = require('./config');

const PLATFORMS = ['twitch', 'youtube', 'kick', 'tiktok', 'facebook', 'other'];
const clean = (v, n) => String(v ?? '').replace(/[\u0000-\u001f<>]/g, '').trim().slice(0, n);

// Ready-to-paste chat commands. {URL} is the full command URL without query string.
// Each chatbot fills in the viewer name and the rest of the message with its own variables.
// Syntax checked against each bot's docs (Sept 2026). Streamlabs' {readapi} is not in its public docs
// but is what the Cloudbot variable picker offers; the relay strips a leading "!command" from q for it.
const BOTS = {
  nightbot: { name: 'Nightbot', platforms: 'Twitch, YouTube', make: (u, q) => q ? `$(urlfetch ${u}?user=$(user)&q=$(querystring))` : `$(urlfetch ${u}?user=$(user))` },
  streamelements: { name: 'StreamElements', platforms: 'Twitch, YouTube, Kick', make: (u, q) => q ? `$(customapi ${u}?user=$(queryescape $(user))&q=$(queryescape $(1:)))` : `$(customapi ${u}?user=$(queryescape $(user)))` },
  streamlabs: { name: 'Streamlabs Cloudbot', platforms: 'Twitch, YouTube, Facebook, Kick', make: (u, q) => q ? `{readapi.${u}?user={user.name}&q={msg}}` : `{readapi.${u}?user={user.name}}` },
  fossabot: { name: 'Fossabot', platforms: 'Twitch, YouTube, Kick', make: (u, q) => q ? `$(customapi ${u}?user=$(user.login)&q=$(querystring))` : `$(customapi ${u}?user=$(user.login))` },
  botrix: { name: 'BotRix', platforms: 'Kick, Twitch, YouTube, Trovo', make: (u, q) => q ? `fetch[${u}?user=$(sender)&q=$(optionalvariable)]` : `fetch[${u}?user=$(sender)]` },
  tikfinity: { name: 'TikFinity (TikTok LIVE)', platforms: 'TikTok — use as a Trigger WebHook action; replies show on the overlay, not in TikTok chat', make: (u, q) => q ? `${u}?user=%username%&q=%commandParams%` : `${u}?user=%username%` }
};
const COMMANDS = [
  ['eta', 'Distance and driving time to the destination'], ['route', 'Current job route'], ['load', 'Cargo, weight and pay'],
  ['truck', 'Truck make and model'], ['speed', 'Current speed and limit'], ['where', 'Nearest town'], ['fuel', 'Fuel and range'],
  ['convoy', 'Who is driving with you'], ['dlc', 'Owned map DLC'], ['next', 'Next scheduled convoy'], ['poll', 'Current viewer vote'],
  ['vote', 'Vote in the poll (e.g. !vote 2)', true], ['horn', 'Viewer horn effect (cooldown)'], ['confetti', 'Confetti on the overlay (cooldown)'],
  ['shoutout', 'Message read out by the co-driver voice (cooldown)', true], ['cmds', 'List of commands']
];

class StreamStudio {
  constructor({ config, stream, voice }) {
    Object.assign(this, { config, stream, voice });
    const st = config.stream || {};
    this.settings = {
      chatKey: /^[A-Za-z0-9_-]{16,64}$/.test(st.chatKey || '') ? st.chatKey : null,
      live: Boolean(st.live),
      url: clean(st.url, 300),
      platform: PLATFORMS.includes(st.platform) ? st.platform : 'twitch',
      title: clean(st.title, 100),
      effects: { horn: st.effects?.horn !== false, confetti: st.effects?.confetti !== false, shoutout: st.effects?.shoutout !== false, shoutoutVoice: st.effects?.shoutoutVoice !== false },
      autoLive: st.autoLive !== false
    };
    if (!this.settings.chatKey) { this.settings.chatKey = crypto.randomBytes(18).toString('base64url'); this.save(); }
    this.poll = null;
    this.tally = null;
    this.obsLive = false;
  }

  save() { try { saveConfigSection('stream', this.settings); } catch (e) { console.error('[STREAM]', e.message); } }

  isLive() { return this.settings.live || (this.settings.autoLive && this.obsLive); }

  update(patch = {}) {
    if (patch.live !== undefined) this.settings.live = Boolean(patch.live);
    if (patch.url !== undefined) {
      const u = clean(patch.url, 300);
      if (u && !/^https:\/\//i.test(u)) throw new Error('The stream link must start with https://');
      this.settings.url = u;
    }
    if (patch.platform !== undefined && PLATFORMS.includes(patch.platform)) this.settings.platform = patch.platform;
    if (patch.title !== undefined) this.settings.title = clean(patch.title, 100);
    if (patch.autoLive !== undefined) this.settings.autoLive = Boolean(patch.autoLive);
    if (patch.effects && typeof patch.effects === 'object') for (const k of Object.keys(this.settings.effects)) if (patch.effects[k] !== undefined) this.settings.effects[k] = Boolean(patch.effects[k]);
    this.save();
    return this.view(true);
  }

  rotateKey() { this.settings.chatKey = crypto.randomBytes(18).toString('base64url'); this.save(); return this.view(true); }

  // The block sent to the relay with each telemetry post.
  block() {
    return { chatKey: this.settings.chatKey, live: this.isLive(), url: this.settings.url || null, platform: this.settings.platform, title: this.settings.title || null, poll: this.poll };
  }

  createPoll(question, options, minutes = 5) {
    const opts = (Array.isArray(options) ? options : String(options || '').split(/[,\n]/)).map(o => clean(o, 40)).filter(Boolean).slice(0, 8);
    if (opts.length < 2) throw new Error('A poll needs at least two options.');
    const mins = Math.max(1, Math.min(60, Number(minutes) || 5));
    this.poll = { id: `p${Date.now().toString(36)}`, question: clean(question, 120) || 'Where should we go next?', options: opts, closesAt: new Date(Date.now() + mins * 60000).toISOString() };
    this.tally = { pollId: this.poll.id, counts: opts.map(() => 0), total: 0 };
    this.stream.emit('vote', this.poll.question, opts.map((o, i) => `${i + 1}) ${o}`).join('  '), { poll: this.poll, tally: this.tally, state: 'open' });
    return this.pollView();
  }

  closePoll() {
    if (!this.poll) return this.pollView();
    const counts = this.tally?.counts || [];
    const best = Math.max(0, ...counts);
    const winners = this.poll.options.filter((_, i) => counts[i] === best && best > 0);
    this.stream.emit('vote', winners.length ? `Chat picked: ${winners.join(' / ')}` : 'Vote closed — no votes', this.poll.question, { poll: this.poll, tally: this.tally, state: 'closed', winners });
    const done = this.pollView();
    this.poll = null;
    return { ...done, closed: true, winners };
  }

  pollView() { return { poll: this.poll, tally: this.tally }; }

  // Relay response: viewer effects and the vote tally.
  onInbox(inbox) {
    if (!inbox) return;
    for (const fx of inbox.effects || []) {
      if (!this.settings.effects[fx.type]) continue;
      const who = fx.user ? `@${fx.user}` : 'Chat';
      if (fx.type === 'horn') this.stream.emit('effect', `${who} sounded the horn!`, '', { effect: 'horn', user: fx.user });
      if (fx.type === 'confetti') this.stream.emit('effect', `${who} threw confetti!`, '', { effect: 'confetti', user: fx.user });
      if (fx.type === 'shoutout') {
        this.stream.emit('effect', `Shoutout from ${who}`, fx.text || '', { effect: 'shoutout', user: fx.user, text: fx.text });
        if (this.settings.effects.shoutoutVoice && fx.text) this.voice?.speak?.(`Shoutout from ${fx.user || 'chat'}: ${fx.text}`, `shoutout-${fx.at}`, 0);
      }
    }
    if (inbox.tally && this.poll && inbox.tally.pollId === this.poll.id) {
      const changed = JSON.stringify(inbox.tally.counts) !== JSON.stringify(this.tally?.counts);
      this.tally = inbox.tally;
      if (changed) this.stream.emit('vote', this.poll.question, `${this.tally.total} vote${this.tally.total === 1 ? '' : 's'}`, { poll: this.poll, tally: this.tally, state: 'open' });
    }
    if (this.poll?.closesAt && Date.parse(this.poll.closesAt) < Date.now()) this.closePoll();
  }

  commandList(relayBase) {
    const base = String(relayBase || '').replace(/\/api\/telemetry\/?$/, '').replace(/\/$/, '');
    return COMMANDS.map(([cmd, what, needsQuery]) => {
      const url = `${base}/c/${this.settings.chatKey}/${cmd}`;
      return { command: `!${cmd}`, what, url, bots: Object.fromEntries(Object.entries(BOTS).map(([id, b]) => [id, b.make(url, Boolean(needsQuery))])) };
    });
  }

  view(includeKey = false) {
    const { chatKey, ...rest } = this.settings;
    return { ...rest, live: this.isLive(), manualLive: this.settings.live, obsLive: this.obsLive, chatKey: includeKey ? chatKey : `${chatKey.slice(0, 4)}…`, bots: Object.fromEntries(Object.entries(BOTS).map(([id, b]) => [id, { name: b.name, platforms: b.platforms }])), platforms: PLATFORMS, ...this.pollView() };
  }
}

module.exports = { StreamStudio, BOTS };
