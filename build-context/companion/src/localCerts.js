// HTTPS for phones and tablets on the home network. Author: Kaw.
// Phones only allow the microphone on secure (https) pages. This creates a private certificate
// authority ("KAW Companion Local CA") once, and a server certificate for this PC's private addresses
// and kaw-companion.local. The driver installs the CA certificate on their phone once.
// Built on Node's own crypto (ECDSA P-256, SHA-256) with a small DER encoder: no extra packages.
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const DIR = path.join(process.cwd(), 'data', 'https');
const DAY = 86400000;

// ---------- minimal DER (ASN.1) encoder ----------
function len(n) {
  if (n < 0x80) return Buffer.from([n]);
  const bytes = [];
  while (n > 0) { bytes.unshift(n & 0xff); n >>= 8; }
  return Buffer.from([0x80 | bytes.length, ...bytes]);
}
const tlv = (tag, body) => Buffer.concat([Buffer.from([tag]), len(body.length), body]);
const seq = (...items) => tlv(0x30, Buffer.concat(items));
const set = (...items) => tlv(0x31, Buffer.concat(items));
const octet = buf => tlv(0x04, buf);
const bitString = buf => tlv(0x03, Buffer.concat([Buffer.from([0]), buf]));
const bool = v => tlv(0x01, Buffer.from([v ? 0xff : 0]));
const utf8 = s => tlv(0x0c, Buffer.from(String(s), 'utf8'));
const explicit = (n, body) => tlv(0xa0 + n, body);
function int(value) {
  let buf = Buffer.isBuffer(value) ? value : Buffer.from(value.toString(16).padStart(2, '0').replace(/^(.(..)*)$/, '0$1'), 'hex');
  while (buf.length > 1 && buf[0] === 0 && !(buf[1] & 0x80)) buf = buf.subarray(1);
  if (buf[0] & 0x80) buf = Buffer.concat([Buffer.from([0]), buf]);
  return tlv(0x02, buf);
}
function oid(str) {
  const parts = str.split('.').map(Number);
  const bytes = [parts[0] * 40 + parts[1]];
  for (const p of parts.slice(2)) {
    const stack = [p & 0x7f];
    let v = p >> 7;
    while (v > 0) { stack.unshift((v & 0x7f) | 0x80); v >>= 7; }
    bytes.push(...stack);
  }
  return tlv(0x06, Buffer.from(bytes));
}
function time(d) {
  const p = n => String(n).padStart(2, '0');
  const y = d.getUTCFullYear();
  const body = `${p(d.getUTCMonth() + 1)}${p(d.getUTCDate())}${p(d.getUTCHours())}${p(d.getUTCMinutes())}${p(d.getUTCSeconds())}Z`;
  return y < 2050 ? tlv(0x17, Buffer.from(String(y).slice(2) + body)) : tlv(0x18, Buffer.from(String(y) + body));
}

const OID = { ecdsaSha256: '1.2.840.10045.4.3.2', cn: '2.5.4.3', o: '2.5.4.10', basic: '2.5.29.19', keyUsage: '2.5.29.15', eku: '2.5.29.37', serverAuth: '1.3.6.1.5.5.7.3.1', san: '2.5.29.17', ski: '2.5.29.14', aki: '2.5.29.35' };
const name = cn => seq(set(seq(oid(OID.o), utf8("KAW'S ATS Playground"))), set(seq(oid(OID.cn), utf8(cn))));
const ext = (id, critical, value) => seq(oid(id), ...(critical ? [bool(true)] : []), octet(value));
const keyId = publicKey => crypto.createHash('sha1').update(publicKey.export({ type: 'spki', format: 'der' }).subarray(-65)).digest();

// Build and sign one certificate.
function makeCert({ subject, issuer, publicKey, signKey, issuerKeyId, days, ca, dns = [], ips = [] }) {
  const now = Date.now();
  const sanEntries = [...dns.map(d => tlv(0x82, Buffer.from(d, 'ascii'))), ...ips.map(ip => tlv(0x87, Buffer.from(ip.split('.').map(Number))))];
  const extensions = [
    ext(OID.basic, true, ca ? seq(bool(true), int(0)) : seq()),
    ext(OID.keyUsage, true, ca ? tlv(0x03, Buffer.from([1, 0x86])) : tlv(0x03, Buffer.from([7, 0x80]))),
    ...(ca ? [] : [ext(OID.eku, false, seq(oid(OID.serverAuth))), ext(OID.san, false, seq(...sanEntries))]),
    ext(OID.ski, false, octet(keyId(publicKey))),
    ext(OID.aki, false, seq(tlv(0x80, issuerKeyId)))
  ];
  const serial = crypto.randomBytes(16); serial[0] &= 0x7f;
  const tbs = seq(
    explicit(0, int(2)),
    int(serial),
    seq(oid(OID.ecdsaSha256)),
    name(issuer),
    seq(time(new Date(now - DAY)), time(new Date(now + days * DAY))),
    name(subject),
    publicKey.export({ type: 'spki', format: 'der' }),
    explicit(3, seq(...extensions))
  );
  const signature = crypto.sign('sha256', tbs, { key: signKey, dsaEncoding: 'der' });
  const der = seq(tbs, seq(oid(OID.ecdsaSha256)), bitString(signature));
  return { der, pem: `-----BEGIN CERTIFICATE-----\n${der.toString('base64').match(/.{1,64}/g).join('\n')}\n-----END CERTIFICATE-----\n` };
}

class LocalCerts {
  constructor(dir = DIR) { this.dir = dir; }
  file(n) { return path.join(this.dir, n); }

  // The CA is created once and kept (the phone trusts it until removed).
  ca() {
    try {
      const key = crypto.createPrivateKey(fs.readFileSync(this.file('ca.key')));
      const pem = fs.readFileSync(this.file('ca.crt'), 'utf8');
      return { key, pem, der: new crypto.X509Certificate(pem).raw, publicKey: crypto.createPublicKey(key) };
    } catch {}
    fs.mkdirSync(this.dir, { recursive: true });
    const { privateKey, publicKey } = crypto.generateKeyPairSync('ec', { namedCurve: 'P-256' });
    const cert = makeCert({ subject: 'KAW Companion Local CA', issuer: 'KAW Companion Local CA', publicKey, signKey: privateKey, issuerKeyId: keyId(publicKey), days: 3650, ca: true });
    fs.writeFileSync(this.file('ca.key'), privateKey.export({ type: 'pkcs8', format: 'pem' }), { mode: 0o600 });
    fs.writeFileSync(this.file('ca.crt'), cert.pem);
    return { key: privateKey, pem: cert.pem, der: cert.der, publicKey };
  }

  // Server certificate for these names/addresses; reissued when they change or it is near expiry.
  server(ips = [], dns = ['kaw-companion.local', 'localhost']) {
    const want = JSON.stringify({ ips: [...ips].sort(), dns: [...dns].sort() });
    try {
      const meta = JSON.parse(fs.readFileSync(this.file('server.json'), 'utf8'));
      const pem = fs.readFileSync(this.file('server.crt'), 'utf8');
      const x = new crypto.X509Certificate(pem);
      if (meta.want === want && Date.parse(x.validTo) - Date.now() > 30 * DAY) return { key: fs.readFileSync(this.file('server.key'), 'utf8'), cert: pem, validTo: x.validTo };
    } catch {}
    const ca = this.ca();
    const { privateKey, publicKey } = crypto.generateKeyPairSync('ec', { namedCurve: 'P-256' });
    // 800 days: Apple rejects TLS server certificates valid for more than 825 days.
    const cert = makeCert({ subject: 'KAW Companion', issuer: 'KAW Companion Local CA', publicKey, signKey: ca.key, issuerKeyId: keyId(ca.publicKey), days: 800, ca: false, dns, ips });
    const keyPem = privateKey.export({ type: 'pkcs8', format: 'pem' });
    fs.writeFileSync(this.file('server.key'), keyPem, { mode: 0o600 });
    fs.writeFileSync(this.file('server.crt'), cert.pem);
    fs.writeFileSync(this.file('server.json'), JSON.stringify({ want, issuedAt: new Date().toISOString() }));
    return { key: keyPem, cert: cert.pem, validTo: new crypto.X509Certificate(cert.pem).validTo };
  }

  caDer() { return this.ca().der; }
  fingerprint() { return new crypto.X509Certificate(this.ca().pem).fingerprint256; }
}

module.exports = { LocalCerts, makeCert, int, oid, len };
