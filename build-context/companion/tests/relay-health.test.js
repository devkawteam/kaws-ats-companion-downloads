// A 200 sign-in page is not a healthy relay: health needs the relay's own JSON, no redirect.
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { checkRelayHealth } = require('../src/relayHealth');
const { RelayClient } = require('../src/remote');

function server(routes) {
  const srv = http.createServer((req, res) => {
    const r = routes[req.url] || routes['*'];
    res.writeHead(r.status || 200, { 'content-type': r.type || 'application/json', ...(r.headers || {}) });
    res.end(r.body || '');
  });
  return new Promise(resolve => srv.listen(0, '127.0.0.1', () => resolve({ srv, origin: `http://127.0.0.1:${srv.address().port}` })));
}

test('health: relay JSON is online; sign-in page, redirect, suspended page and wrong service are not', async () => {
  const cases = [
    [{ body: JSON.stringify({ ok: true, service: "KAW'S ATS PLAYGROUND Relay" }) }, 'online'],
    [{ type: 'text/html', body: '<!doctype html><title>Sign in ・ Cloudflare Access</title>' }, 'sign-in-page'],
    [{ status: 302, headers: { location: 'https://kaw.cloudflareaccess.com/cdn-cgi/access/login' } }, 'sign-in-page'],
    [{ type: 'text/html', body: '<h1>This service has been suspended by its owner.</h1>' }, 'suspended'],
    [{ body: JSON.stringify({ ok: true, service: 'Something else' }) }, 'error'],
    [{ status: 503, body: '{}' }, 'sleeping-or-down']
  ];
  for (const [route, want] of cases) {
    const { srv, origin } = await server({ '/health': route });
    try {
      const h = await checkRelayHealth(origin, { timeoutMs: 5000 });
      assert.equal(h.status, want, JSON.stringify(route).slice(0, 60)); assert.equal(h.up, want === 'online');
      if (want === 'sign-in-page') assert.match(h.detail, /sign-in page|redirects/);
    } finally { srv.close(); }
  }
  assert.equal((await checkRelayHealth(null)).status, 'not-configured');
});

test('telemetry push: a sign-in page is an outage (fails over), never parsed as relay data', async () => {
  const signIn = await server({ '*': { type: 'text/html', body: '<html>Sign in with Cloudflare Access</html>' } });
  const relay = await server({ '*': { body: JSON.stringify({ ok: true, roster: [] }) } });
  try {
    const c = new RelayClient({ pairingCode: 'TEST', driverName: 'Ann', remote: { enabled: true, endpoint: `${signIn.origin}/api/telemetry`, backupEndpoints: [`${relay.origin}/api/telemetry`] } });
    await assert.rejects(c.send({}), /web page/);
    await assert.rejects(c.send({}), /web page/);
    assert.equal(c.activeEndpoint(), `${relay.origin}/api/telemetry`, 'moved to the backup after two failures');
    const ok = await c.send({}); assert.deepEqual(ok.roster, []);
    c.lastPrimaryProbe = 0;
    await c.send({});
    assert.equal(c.activeEndpoint(), `${relay.origin}/api/telemetry`, 'the sign-in address is not "back" just because it answers 200');
  } finally { signIn.srv.close(); relay.srv.close(); }
});
