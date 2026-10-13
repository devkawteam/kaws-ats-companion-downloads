// Network discovery (kaw-companion.local). Unit tests for the packet code plus a live loopback query.
const test = require('node:test');
const assert = require('node:assert/strict');
const dgram = require('node:dgram');
const { MdnsResponder, parseQuery, buildAnswer, encodeName, readName, isPrivateV4 } = require('../src/mdns');

function query(name, type = 1, unicast = false) {
  const h = Buffer.alloc(12); h.writeUInt16BE(1, 4);
  const tail = Buffer.alloc(4); tail.writeUInt16BE(type, 0); tail.writeUInt16BE((unicast ? 0x8000 : 0) | 1, 2);
  return Buffer.concat([h, encodeName(name), tail]);
}

test('queries are parsed, including compressed names; responses and junk are ignored', () => {
  assert.deepEqual(parseQuery(query('KAW-Companion.local')), [{ name: 'kaw-companion.local', type: 1, unicast: false }]);
  assert.equal(parseQuery(query('kaw-companion.local', 1, true))[0].unicast, true);
  const response = buildAnswer('kaw-companion.local', ['192.168.1.50']);
  assert.deepEqual(parseQuery(response), [], 'responses are not treated as queries');
  assert.deepEqual(parseQuery(Buffer.from('junk')), []);
  // A pointer back to offset 12 ("kaw-companion.local").
  const two = Buffer.concat([query('kaw-companion.local'), Buffer.from([0xc0, 12, 0, 1, 0, 1])]);
  two.writeUInt16BE(2, 4);
  assert.deepEqual(parseQuery(two).map(q => q.name), ['kaw-companion.local', 'kaw-companion.local']);
  assert.throws(() => readName(Buffer.from([0xc0, 0]), 0), /bad pointer/, 'pointer loops stop');
});

test('answers carry only our name and the given private IPv4 addresses', () => {
  const a = buildAnswer('kaw-companion.local', ['192.168.1.50', '10.0.0.7']);
  assert.equal(a.readUInt16BE(2), 0x8400);
  assert.equal(a.readUInt16BE(6), 2);
  const { name, next } = readName(a, 12);
  assert.equal(name, 'kaw-companion.local');
  assert.equal(a.readUInt16BE(next), 1);
  assert.deepEqual([...a.subarray(next + 10, next + 14)], [192, 168, 1, 50]);
  assert.equal(isPrivateV4('192.168.1.5'), true);
  assert.equal(isPrivateV4('172.20.0.1'), true);
  assert.equal(isPrivateV4('8.8.8.8'), false);
  assert.equal(isPrivateV4('169.254.1.1'), false);
  const r = new MdnsResponder({ addresses: () => ['8.8.8.8', '192.168.1.50', '192.168.1.50'] });
  assert.deepEqual(r.ips(), ['192.168.1.50'], 'public addresses are never announced');
});

test('live: a unicast query for kaw-companion.local gets an answer', { timeout: 8000 }, async t => {
  const responder = new MdnsResponder({ addresses: () => ['192.168.1.50'] });
  responder.start();
  await new Promise(r => setTimeout(r, 400));
  if (!responder.socket) { t.skip(`mDNS port unavailable here: ${responder.error}`); return; }
  // Ask the way phones do: multicast to the mDNS group, asking for a direct (unicast) reply.
  // (A plain unicast to 127.0.0.1:5353 can be taken by Windows' own mDNS service instead.)
  const client = dgram.createSocket({ type: 'udp4', reuseAddr: true });
  await new Promise(r => client.bind(0, r));
  client.setMulticastLoopback(true);
  const got = new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('no answer')), 3000);
    client.on('message', msg => { clearTimeout(timer); resolve(msg); });
  });
  client.send(query('kaw-companion.local', 1, true), 5353, '224.0.0.251');
  try {
    const msg = await got;
    const { name, next } = readName(msg, 12);
    assert.equal(name, 'kaw-companion.local');
    assert.deepEqual([...msg.subarray(next + 10, next + 14)], [192, 168, 1, 50]);
    assert.ok(responder.answered >= 1);
  } finally { client.close(); responder.stop(); }
});
