// Network discovery: answers "kaw-companion.local" on the home network (multicast DNS, RFC 6762),
// so phones and tablets can open http://kaw-companion.local:4280 instead of typing an IP address.
// Runs only while network sharing is on, answers only for its own name, and only with private IPv4
// addresses. Works on iPhone/iPad, Mac and Windows; some Android browsers still need the QR/IP link.
const dgram = require('node:dgram');

const GROUP = '224.0.0.251';
const PORT = 5353;
const TYPE_A = 1, TYPE_ANY = 255, CLASS_IN = 1;

function encodeName(name) {
  const parts = String(name).replace(/\.$/, '').split('.');
  return Buffer.concat([...parts.map(p => { const b = Buffer.from(p, 'utf8'); return Buffer.concat([Buffer.from([b.length]), b]); }), Buffer.from([0])]);
}

// Read a (possibly compressed) DNS name at offset; returns { name, next }.
function readName(buf, offset, depth = 0) {
  const labels = [];
  let pos = offset, next = -1;
  while (pos < buf.length) {
    const len = buf[pos];
    if (len === 0) { pos += 1; break; }
    if ((len & 0xc0) === 0xc0) {
      if (depth > 8 || pos + 1 >= buf.length) throw new Error('bad pointer');
      if (next < 0) next = pos + 2;
      const ptr = ((len & 0x3f) << 8) | buf[pos + 1];
      labels.push(readName(buf, ptr, depth + 1).name);
      pos = -1; break;
    }
    if (pos + 1 + len > buf.length) throw new Error('truncated');
    labels.push(buf.toString('utf8', pos + 1, pos + 1 + len));
    pos += 1 + len;
  }
  return { name: labels.filter(Boolean).join('.'), next: next >= 0 ? next : pos };
}

// Questions from an mDNS query packet: [{ name, type, unicast }]. Ignores responses.
function parseQuery(buf) {
  if (!Buffer.isBuffer(buf) || buf.length < 12) return [];
  const flags = buf.readUInt16BE(2);
  if (flags & 0x8000) return [];
  const qd = buf.readUInt16BE(4);
  const out = [];
  let off = 12;
  for (let i = 0; i < Math.min(qd, 32); i++) {
    const { name, next } = readName(buf, off);
    if (next + 4 > buf.length) break;
    out.push({ name: name.toLowerCase(), type: buf.readUInt16BE(next), unicast: Boolean(buf.readUInt16BE(next + 2) & 0x8000) });
    off = next + 4;
  }
  return out;
}

// Authoritative A-record answer for our name.
function buildAnswer(name, addresses, ttl = 120) {
  const header = Buffer.alloc(12);
  header.writeUInt16BE(0, 0);          // id 0 for mDNS
  header.writeUInt16BE(0x8400, 2);     // response + authoritative
  header.writeUInt16BE(addresses.length, 6);
  const records = addresses.map(ip => {
    const rr = Buffer.alloc(10);
    rr.writeUInt16BE(TYPE_A, 0);
    rr.writeUInt16BE(0x8000 | CLASS_IN, 2); // cache-flush
    rr.writeUInt32BE(ttl, 4);
    rr.writeUInt16BE(4, 8);
    return Buffer.concat([encodeName(name), rr, Buffer.from(ip.split('.').map(Number))]);
  });
  return Buffer.concat([header, ...records]);
}

const isPrivateV4 = ip => /^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(ip);

class MdnsResponder {
  constructor({ name = 'kaw-companion.local', addresses = () => [] } = {}) {
    this.name = String(name).toLowerCase().replace(/\.$/, '');
    this.addresses = addresses;
    this.socket = null;
    this.answered = 0;
    this.error = null;
  }

  ips() { return [...new Set(this.addresses().filter(isPrivateV4))].slice(0, 4); }

  start() {
    if (this.socket) return;
    const sock = dgram.createSocket({ type: 'udp4', reuseAddr: true });
    this.socket = sock;
    sock.on('error', e => { this.error = e.message; console.error('[MDNS]', e.message); this.stop(); });
    sock.on('message', (msg, rinfo) => {
      let questions;
      try { questions = parseQuery(msg); } catch { return; }
      const q = questions.find(x => x.name === this.name && (x.type === TYPE_A || x.type === TYPE_ANY));
      const ips = this.ips();
      if (!q || !ips.length) return;
      const answer = buildAnswer(this.name, ips);
      this.answered++;
      if (q.unicast) sock.send(answer, rinfo.port, rinfo.address);
      else sock.send(answer, PORT, GROUP);
    });
    sock.bind(PORT, () => {
      try { sock.addMembership(GROUP); sock.setMulticastTTL(255); sock.setMulticastLoopback(true); } catch (e) { this.error = e.message; }
      // Announce twice, one second apart (RFC 6762 §8.3).
      const announce = () => { const ips = this.ips(); if (ips.length && this.socket) this.socket.send(buildAnswer(this.name, ips), PORT, GROUP); };
      announce(); setTimeout(announce, 1000).unref?.();
      console.log(`[MDNS] Phones can use http://${this.name}`);
    });
  }

  stop() { try { this.socket?.close(); } catch {} this.socket = null; }

  status() { return { name: this.name, running: Boolean(this.socket), addresses: this.ips(), answered: this.answered, error: this.error }; }
}

module.exports = { MdnsResponder, parseQuery, buildAnswer, encodeName, readName, isPrivateV4 };
