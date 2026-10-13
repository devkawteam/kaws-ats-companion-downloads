// Is this really KAW's relay and is it healthy? A 200 answer is not enough: a Cloudflare Access sign-in
// page, a host's "suspended" page or a parked domain also answer 200. Healthy means /health answered
// directly (no redirect) with the relay's JSON: { ok: true, service: "... Relay" }. Author: Kaw.
'use strict';

const SIGN_IN = /cloudflare access|cf-access|sign ?in|log ?in|authenticate|one-time pin/i;

function describe(status, httpStatus, detail) {
  return { up: status === 'online', httpStatus, status, detail };
}

async function checkRelayHealth(origin, { fetchImpl = fetch, timeoutMs = 20000 } = {}) {
  if (!origin) return { status: 'not-configured', up: null, httpStatus: null, detail: null };
  let res;
  try {
    res = await fetchImpl(`${origin}/health`, { redirect: 'manual', headers: { 'user-agent': 'KAW-ATS-Companion', accept: 'application/json' }, signal: AbortSignal.timeout(timeoutMs) });
  } catch (e) {
    return describe('unreachable', null, e.name === 'TimeoutError' ? `The relay did not answer within ${Math.round(timeoutMs / 1000)} seconds (a free service may be waking up).` : /fetch failed|ECONNREFUSED|ENOTFOUND|EAI_AGAIN/i.test(`${e.message} ${e.cause?.code || ''}`) ? 'Could not connect to the relay (it is offline, or this PC has no internet).' : e.message);
  }
  if (res.status >= 300 && res.status < 400 || res.type === 'opaqueredirect') {
    const to = res.headers?.get?.('location') || '';
    return describe('sign-in-page', res.status, `The relay address redirects${/cloudflareaccess|access|login|sign/i.test(to) ? ' to a sign-in page (Cloudflare Access)' : ''} instead of answering. Drivers can't use a protected address — use the relay's public address.`);
  }
  const type = String(res.headers?.get?.('content-type') || '');
  const text = await res.text().catch(() => '');
  if (/suspended/i.test(text)) return describe('suspended', res.status, 'The relay host reports "This service has been suspended by its owner." On Render this usually means the free bandwidth ran out.');
  if (/text\/html/i.test(type) || /^\s*</.test(text)) {
    return describe('sign-in-page', res.status, SIGN_IN.test(text) ? 'The relay address answered with a sign-in page (Cloudflare Access), not the relay. Use the relay\'s public address.' : 'The relay address answered with a web page, not the relay. Check the address.');
  }
  if (!res.ok) return describe(res.status === 502 || res.status === 503 ? 'sleeping-or-down' : 'error', res.status, `Relay answered HTTP ${res.status}.`);
  let body;
  try { body = JSON.parse(text); } catch { return describe('error', res.status, 'The relay sent an unreadable health answer.'); }
  if (body?.ok !== true || !/relay/i.test(String(body.service || ''))) return describe('error', res.status, 'That address answered, but not as a KAW relay.');
  return describe('online', res.status, null);
}

module.exports = { checkRelayHealth };
