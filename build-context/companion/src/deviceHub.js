// Private-network second screens. Author: Kaw.
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const SCREENS = { drive: 'Driving', navigation: 'Navigation', truck: 'Truck', radar: 'Convoy radar', shift: 'Shifting', stats: 'Earnings & stats' };
const hash = s => crypto.createHash('sha256').update(s).digest('hex');
const secret = () => crypto.randomBytes(32).toString('hex');
function privateAddresses(interfaces = os.networkInterfaces()) {
  return [...new Set(Object.values(interfaces).flat().filter(a => a && !a.internal && a.family === 'IPv4' && /^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(a.address)).map(a => a.address))];
}
class DeviceHub {
  constructor({ file = path.join(process.cwd(), 'data', 'device-hub.json'), now = Date.now } = {}) {
    this.file = file; this.now = now; this.invites = new Map(); this.devices = []; this.commands = new Map();
    try { this.devices = JSON.parse(fs.readFileSync(file, 'utf8')).devices || []; } catch (e) { if (e.code !== 'ENOENT') throw new Error('Cannot read saved second-screen devices. Repair data/device-hub.json before starting.'); }
    for (const d of this.devices) d.lastSeen = 0;
  }
  persist() {
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    const tmp = this.file + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify({ devices: this.devices }, null, 2), { mode: 0o600 }); fs.renameSync(tmp, this.file);
  }
  invite(address, port, screen, scheme = 'http') {
    if (!SCREENS[screen]) throw new Error('Choose a supported screen.');
    for (const [k, v] of this.invites) if (v.expires <= this.now()) this.invites.delete(k);
    if (this.invites.size >= 20) this.invites.delete(this.invites.keys().next().value);
    const token = secret(), expires = this.now() + 5 * 60 * 1000;
    this.invites.set(hash(token), { expires, screen });
    return { url: `${scheme === 'https' ? 'https' : 'http'}://${address}:${port}/pair.html#token=${token}`, expires, screen, secure: scheme === 'https' };
  }
  pair(token, name, allowSwitch) {
    const key = hash(String(token || '')), invite = this.invites.get(key);
    if (!invite || invite.expires <= this.now()) throw new Error('This pairing link expired or was used. Ask the PC for a new QR code.');
    if (this.devices.length >= 50) throw new Error('Remove an old device from the PC before adding another.');
    const session = secret();
    const d = { id: crypto.randomUUID(), name: String(name || 'Second screen').trim().slice(0, 60), sessionHash: hash(session), allowSwitch: allowSwitch === true, screen: invite.screen, lastSeen: this.now() };
    this.devices.push(d);
    try { this.persist(); } catch (e) { this.devices.pop(); throw e; }
    this.invites.delete(key);
    return { session, device: this.view(d) };
  }
  authenticate(cookie = '') {
    const token = /(?:^|;\s*)kawDevice=([a-f0-9]{64})(?:;|$)/.exec(cookie)?.[1];
    return token ? this.devices.find(d => d.sessionHash === hash(token)) : null;
  }
  view(d) { return { id: d.id, name: d.name, screen: d.screen, allowSwitch: d.allowSwitch, online: d.lastSeen > 0 && this.now() - d.lastSeen < 20000 }; }
  heartbeat(d, body) {
    d.lastSeen = this.now();
    if (SCREENS[body.screen]) d.screen = body.screen;
    if (typeof body.allowSwitch === 'boolean' && body.allowSwitch !== d.allowSwitch) { d.allowSwitch = body.allowSwitch; if (!d.allowSwitch) this.commands.delete(d.id); this.persist(); }
    const command = d.allowSwitch ? this.commands.get(d.id) : null;
    if (command && body.ack === command.id) this.commands.delete(d.id);
    return { device: this.view(d), command: command && body.ack !== command.id && this.now() - command.created < 30000 ? command : null };
  }
  send(id, screen) {
    const d = this.devices.find(d => d.id === id);
    if (!d || !this.view(d).online) throw new Error('Open the Companion on that device first.');
    if (!d.allowSwitch) throw new Error('Allow screen changes on that device first.');
    if (!SCREENS[screen]) throw new Error('Choose a supported screen.');
    const command = { id: crypto.randomUUID(), screen, created: this.now() }; this.commands.set(id, command); return command;
  }
  revoke(id) { this.devices = this.devices.filter(d => d.id !== id); this.commands.delete(id); this.persist(); }
}
module.exports = { DeviceHub, SCREENS, privateAddresses };
