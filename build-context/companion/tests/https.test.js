// Phone HTTPS: private CA + server certificate, verified with a real TLS connection.
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const https = require('node:https');
const tls = require('node:tls');
const { LocalCerts, int, oid, len } = require('../src/localCerts');

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kaw-https-'));

test('DER helpers encode lengths, integers and OIDs correctly', () => {
  assert.deepEqual([...len(5)], [5]);
  assert.deepEqual([...len(300)], [0x82, 0x01, 0x2c]);
  assert.deepEqual([...int(0)], [2, 1, 0]);
  assert.deepEqual([...int(128)], [2, 2, 0, 128], 'high bit gets a leading zero');
  assert.deepEqual([...oid('1.2.840.10045.4.3.2')], [6, 8, 0x2a, 0x86, 0x48, 0xce, 0x3d, 4, 3, 2]);
});

test('CA and server certificates parse, chain and carry the right names and limits', () => {
  const certs = new LocalCerts(dir);
  const ca = new crypto.X509Certificate(certs.ca().pem);
  assert.equal(ca.ca, true);
  assert.match(ca.subject, /KAW Companion Local CA/);
  assert.equal(ca.verify(ca.publicKey), true, 'CA is self-signed');
  const s = certs.server(['192.168.1.50']);
  const leaf = new crypto.X509Certificate(s.cert);
  assert.equal(leaf.ca, false);
  assert.equal(leaf.verify(ca.publicKey), true, 'server cert is signed by the CA');
  assert.equal(leaf.checkIssued(ca), true);
  assert.match(leaf.subjectAltName, /DNS:kaw-companion\.local/);
  assert.match(leaf.subjectAltName, /IP Address:192\.168\.1\.50/);
  assert.ok(leaf.keyUsage === undefined || Array.isArray(leaf.keyUsage));
  assert.ok((Date.parse(leaf.validTo) - Date.parse(leaf.validFrom)) / 86400000 <= 825, 'Apple 825-day limit');
  assert.equal(certs.server(['192.168.1.50']).cert, s.cert, 'unchanged addresses keep the same certificate');
  assert.notEqual(certs.server(['192.168.1.51']).cert, s.cert, 'new address reissues');
  assert.equal(new LocalCerts(dir).fingerprint(), ca.fingerprint256, 'CA persists across restarts');
});

test('a real TLS client trusting only the CA accepts the server for its IP and name', async () => {
  const certs = new LocalCerts(dir);
  const s = certs.server(['127.0.0.1']);
  const server = https.createServer({ key: s.key, cert: s.cert }, (req, res) => res.end('ok'));
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  const port = server.address().port;
  const get = servername => new Promise((resolve, reject) => {
    const req = https.request({ host: '127.0.0.1', port, path: '/', ca: certs.ca().pem, servername, checkServerIdentity: (host, cert) => tls.checkServerIdentity(servername || '127.0.0.1', cert) }, res => { let b = ''; res.on('data', c => b += c); res.on('end', () => resolve(b)); });
    req.on('error', reject); req.end();
  });
  try {
    assert.equal(await get(undefined), 'ok', 'IP address in SAN');
    assert.equal(await get('kaw-companion.local'), 'ok', 'kaw-companion.local in SAN');
    await assert.rejects(get('evil.example'), /does not match|altnames|Hostname/i);
    await assert.rejects(new Promise((resolve, reject) => {
      const req = https.request({ host: '127.0.0.1', port, path: '/' }, resolve);
      req.on('error', reject); req.end();
    }), /self.signed|unable to verify|certificate/i, 'without the CA the certificate is not trusted');
  } finally { server.close(); }
});
