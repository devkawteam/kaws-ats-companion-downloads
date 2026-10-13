// Public Steam lookups (no API key): Workshop item details and store prices for DLC.
// Results are cached in memory and on disk so a convoy never hammers Steam.

const fs = require('node:fs');
const path = require('node:path');

const CACHE_FILE = path.join(process.cwd(), 'data', 'steam-cache.json');
const WORKSHOP_TTL = 6 * 3600 * 1000;
const PRICE_TTL = 12 * 3600 * 1000;
const ATS_APP_ID = 270880;

let cache = { workshop: {}, prices: {} };
try { cache = { workshop: {}, prices: {}, ...JSON.parse(fs.readFileSync(CACHE_FILE, 'utf8')) }; } catch {}
let saveTimer = null;
function saveSoon() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    try { fs.mkdirSync(path.dirname(CACHE_FILE), { recursive: true }); fs.writeFileSync(CACHE_FILE, JSON.stringify(cache), 'utf8'); } catch {}
  }, 2000);
  saveTimer.unref?.();
}

const cleanId = v => String(v || '').match(/(\d{6,})/)?.[1] || null;

// Workshop details for many IDs at once. Returns { id: { title, sizeBytes, updatedAt, previewUrl, subscriptions, isAts, missing } }.
async function workshopDetails(ids = []) {
  const want = [...new Set(ids.map(cleanId).filter(Boolean))].slice(0, 100);
  const now = Date.now();
  const stale = want.filter(id => !cache.workshop[id] || now - cache.workshop[id].fetchedAt > WORKSHOP_TTL);
  if (stale.length) {
    const body = new URLSearchParams({ itemcount: String(stale.length) });
    stale.forEach((id, i) => body.append(`publishedfileids[${i}]`, id));
    try {
      const res = await fetch('https://api.steampowered.com/ISteamRemoteStorage/GetPublishedFileDetails/v1/', { method: 'POST', body, signal: AbortSignal.timeout(15000) });
      const data = await res.json();
      for (const d of data?.response?.publishedfiledetails || []) {
        const ok = d.result === 1;
        cache.workshop[d.publishedfileid] = {
          fetchedAt: now,
          missing: !ok,
          title: ok ? String(d.title || '').slice(0, 160) : null,
          sizeBytes: ok ? Number(d.file_size) || 0 : null,
          updatedAt: ok && d.time_updated ? new Date(d.time_updated * 1000).toISOString() : null,
          previewUrl: ok && /^https:\/\//.test(d.preview_url || '') ? d.preview_url : null,
          subscriptions: ok ? Number(d.subscriptions) || 0 : null,
          isAts: ok ? Number(d.consumer_app_id) === ATS_APP_ID : null
        };
      }
      saveSoon();
    } catch (e) {
      console.error('[STEAM] Workshop lookup failed:', e.message);
    }
  }
  return Object.fromEntries(want.map(id => [id, cache.workshop[id] ? { ...cache.workshop[id], fetchedAt: undefined } : null]));
}

// Store price for an ATS DLC by state name, e.g. "Utah" -> { appId, name, price, initial, discountPercent, url }.
async function dlcPrice(state) {
  const key = String(state || '').toLowerCase();
  if (!key) return null;
  const hit = cache.prices[key];
  if (hit && Date.now() - hit.fetchedAt < PRICE_TTL) return hit.value;
  let value = null;
  try {
    const url = `https://store.steampowered.com/api/storesearch/?term=${encodeURIComponent(`American Truck Simulator ${state}`)}&l=english&cc=US`;
    const data = await (await fetch(url, { signal: AbortSignal.timeout(15000) })).json();
    const item = (data.items || []).find(i => String(i.name || '').toLowerCase() === `american truck simulator - ${key}`)
      || (data.items || []).find(i => new RegExp(`american truck simulator\\s*-\\s*${key}\\b`, 'i').test(i.name || ''));
    if (item) {
      const p = item.price || {};
      value = {
        appId: item.id, name: item.name,
        price: Number.isFinite(p.final) ? p.final / 100 : null,
        initial: Number.isFinite(p.initial) ? p.initial / 100 : null,
        currency: p.currency || 'USD',
        discountPercent: p.initial && p.final < p.initial ? Math.round((1 - p.final / p.initial) * 100) : 0,
        url: `https://store.steampowered.com/app/${item.id}/`
      };
    }
  } catch (e) {
    console.error('[STEAM] Price lookup failed:', e.message);
    if (hit) return hit.value;
  }
  cache.prices[key] = { fetchedAt: Date.now(), value };
  saveSoon();
  return value;
}

module.exports = { workshopDetails, dlcPrice, cleanId };
