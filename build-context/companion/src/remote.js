const zlib = require('node:zlib');
const { checkRelayHealth } = require('./relayHealth');
const crypto = require('node:crypto');
const COMPANION_VERSION = require('../package.json').version;

const n1 = v => (Number.isFinite(Number(v)) ? Math.round(Number(v) * 10) / 10 : v ?? null);

// Legacy full payload (still used for relays older than 0.4, which replace telemetry on every post).
function sharedPayload(payload){
 const p=payload.buildPrivacy||{},truck=payload.truck||{},trailer=payload.trailer||{};
 const safeTruck=p.shareIdentity===false?{}:{make:truck.make,model:truck.model,id:truck.id,speedMph:truck.speedMph};
 if(p.shareSpeed===false)delete safeTruck.speedMph;
 if(p.shareSpecs!==false)Object.assign(safeTruck,{rpmMax:truck.rpmMax,transmissionType:truck.transmissionType,forwardGears:truck.forwardGears,reverseGears:truck.reverseGears,differentialRatio:truck.differentialRatio,fuelCapacityGallons:truck.fuelCapacityGallons,wheelCount:truck.wheelCount,poweredWheels:truck.poweredWheels,steerableWheels:truck.steerableWheels,liftableWheels:truck.liftableWheels});
 if(p.sharePlate)safeTruck.licensePlate=truck.licensePlate;
 const safeTrailer=p.shareTrailer===false?{}:{attached:trailer.attached,id:trailer.id,brand:trailer.brand,name:trailer.name,chainType:trailer.chainType,wheelCount:trailer.wheelCount,liftableWheels:trailer.liftableWheels};
 if(p.sharePlate)safeTrailer.licensePlate=trailer.licensePlate;
 const safeJob=p.shareTrailer===false?{}:{...payload.job};
 if(p.shareRoute===false){delete safeJob.originCity;delete safeJob.originCompany;delete safeJob.destinationCity;delete safeJob.destinationCompany;delete safeJob.plannedDistanceMiles;}
 return {...payload,raw:undefined,convoy:undefined,truck:safeTruck,trailer:safeTrailer,job:safeJob,trip:p.shareTrailer===false?null:payload.trip,positioning:p.shareLocation===false?{}:payload.positioning,navigation:p.shareRoute===false?{}:payload.navigation,systems:p.shareStatus===false?{}:payload.systems,warnings:p.shareStatus===false?{}:payload.warnings,damage:p.shareDamage?payload.damage:{},buildProfile:p.shareCustom?payload.buildProfile:{},buildPrivacy:p,location:p.shareLocation===false?undefined:payload.location,mapPoints:p.shareLocation===false?undefined:payload.mapPoints};
}

// Slim relay payload: only the live fields other drivers display (sent every few seconds) and the
// rarely-changing fields, which the relay caches (sent only when they change).
function relayParts(payload) {
  const full = sharedPayload(payload);
  const p = full.buildPrivacy || {};
  const t = full.truck || {}, tr = full.trailer || {}, j = full.job || {}, nav = full.navigation || {}, pos = full.positioning || {};
  const lights = full.systems?.lights || {};
  const live = {
    connected: Boolean(payload.connected), game: payload.game, updatedAt: payload.updatedAt, companionOnline: true, telemetryConnected: Boolean(payload.connected),
    truck: { make: t.make, model: t.model, id: t.id, speedMph: n1(t.speedMph), licensePlate: t.licensePlate },
    trailer: { attached: tr.attached, brand: tr.brand, name: tr.name, id: tr.id, licensePlate: tr.licensePlate },
    job: { active: j.active, cargo: j.cargo, originCity: j.originCity, originCompany: j.originCompany, destinationCity: j.destinationCity, destinationCompany: j.destinationCompany, plannedDistanceMiles: n1(j.plannedDistanceMiles), cargoMassKg: j.cargoMassKg },
    navigation: { distanceMiles: n1(nav.distanceMiles), etaSeconds: nav.etaSeconds != null ? Math.round(nav.etaSeconds) : null, speedLimitMph: n1(nav.speedLimitMph), progressPercent: n1(nav.progressPercent) },
    positioning: pos.x != null ? { x: Math.round(pos.x), y: Math.round(pos.y || 0), z: Math.round(pos.z), rotationX: pos.rotationX != null ? Math.round(pos.rotationX * 1000) / 1000 : null } : {},
    systems: p.shareStatus === false ? {} : { lights: { hazards: lights.hazards, leftBlinkerActive: lights.leftBlinkerActive, rightBlinkerActive: lights.rightBlinkerActive, beacon: lights.beacon, brake: lights.brake }, parkingBrake: full.systems?.parkingBrake },
    warnings: full.warnings,
    damage: full.damage,
    location: full.location ? { lon: Math.round(full.location.lon * 1000) / 1000, lat: Math.round(full.location.lat * 1000) / 1000, near: full.location.near, nearState: full.location.nearState, state: full.location.state, stateCode: full.location.stateCode } : undefined,
    buildPrivacy: p
  };
  const specs = {};
  for (const k of ['rpmMax', 'transmissionType', 'forwardGears', 'reverseGears', 'differentialRatio', 'fuelCapacityGallons', 'wheelCount', 'poweredWheels', 'steerableWheels', 'liftableWheels']) if (t[k] !== undefined) specs[k] = t[k];
  const statics = {
    specs: { truck: specs, trailer: { chainType: tr.chainType, wheelCount: tr.wheelCount, liftableWheels: tr.liftableWheels } },
    buildProfile: full.buildProfile || {},
    capabilities: payload.capabilities || null,
    convoyManifest: payload.convoyManifest || null,
    mapPoints: full.mapPoints || [],
    convoyEvents: payload.convoyEvents || [],
    rsvps: payload.rsvps || {},
    driverStats: payload.driverStats || null,
    vtc: payload.vtc || null,
    vtcProgress: payload.vtcProgress || {},
    convoyRadio: payload.convoyRadio || null,
    sharedRoute: payload.sharedRoute || null,
    together: payload.together || null,
    h2h: payload.h2h || null,
    tmp: payload.tmp || null,
    publicLive: Boolean(payload.publicLive)
  };
  return { live, statics };
}

const LIVE_KEYS = new Set(['connected', 'game', 'updatedAt', 'companionOnline', 'telemetryConnected', 'truck', 'trailer', 'job', 'navigation', 'positioning', 'systems', 'warnings', 'damage', 'location', 'buildPrivacy', 'trip', 'tripStats', 'sdk', 'instruments', 'raw', 'convoy']);

// Rebuild a peer object from a relay roster entry, re-attaching cached static data.
function mergePeerStatic(telemetry = {}, cached = {}) {
  // Any key the relay sends that is not a live field is static data we keep between posts.
  const st = { ...cached, ...Object.fromEntries(Object.keys(telemetry).filter(k => !LIVE_KEYS.has(k)).map(k => [k, telemetry[k]])) };
  const out = { ...telemetry };
  delete out.specs;
  if (st.specs?.truck) out.truck = { ...st.specs.truck, ...(out.truck || {}) };
  if (st.specs?.trailer) out.trailer = { ...st.specs.trailer, ...(out.trailer || {}) };
  for (const [k, v] of Object.entries(st)) if (k !== 'specs' && v !== undefined) out[k] = v;
  return { peer: out, cache: st };
}

const hashOf = obj => crypto.createHash('sha1').update(JSON.stringify(obj)).digest('hex').slice(0, 16);

// A random convoy ID for this install, so two drivers with the same name (e.g. both "User") don't
// overwrite each other on the relay or hide each other. Not linked to the driver's identity.
function loadDriverId(file = require('node:path').join(process.cwd(), 'data', 'relay-driver-id.txt')) {
  const fs = require('node:fs');
  try { const id = fs.readFileSync(file, 'utf8').trim(); if (/^drv-[a-f0-9-]{16,40}$/.test(id)) return id; } catch {}
  const id = `drv-${crypto.randomUUID()}`;
  try { fs.mkdirSync(require('node:path').dirname(file), { recursive: true }); fs.writeFileSync(file, id); } catch {}
  return id;
}

class RelayClient {
  constructor(config, { driverId } = {}) {
    this.config = config;
    this.driverId = driverId || loadDriverId();
    this.myRelayId = null;           // the id the relay files this Companion under (from its answer)
    this.features = new Set();
    this.lastStaticHash = null;
    this.lastStaticAt = 0;
    this.peerStatic = new Map();   // driver id -> { hash, data }
    this.bytesSent = 0;
    this.bytesReceived = 0;
    this.posts = 0;
    this.startedAt = Date.now();
    // Failover: main endpoint first, then remote.backupEndpoints in order.
    this.activeIndex = 0;
    this.failures = 0;
    this.lastPrimaryProbe = 0;
    this.switchListeners = [];
  }

  endpoints() { return [this.config.remote.endpoint, ...(this.config.remote.backupEndpoints || [])].filter(Boolean); }
  activeEndpoint() { const list = this.endpoints(); return list[Math.min(this.activeIndex, list.length - 1)] || null; }
  onSwitch(fn) { if (typeof fn === 'function') this.switchListeners.push(fn); }

  // A different relay has its own features and cache, so start fresh with it.
  switchTo(index, reason) {
    const list = this.endpoints();
    if (!list.length || index === this.activeIndex) return;
    const from = this.activeEndpoint();
    this.activeIndex = index % list.length;
    this.failures = 0;
    this.features = new Set();
    this.peerStatic.clear();
    this.lastStaticHash = null;
    console.log(`[RELAY] Switched to ${this.activeIndex === 0 ? 'main' : 'backup'} relay ${this.activeEndpoint()} (${reason})`);
    for (const fn of this.switchListeners) { try { fn({ from, to: this.activeEndpoint(), index: this.activeIndex, reason }); } catch {} }
  }

  async primaryHealthy() {
    try { return (await checkRelayHealth(new URL(this.endpoints()[0]).origin, { timeoutMs: 10000 })).up === true; }
    catch { return false; }
  }

  async send(payload) {
    if (!this.config.remote.enabled || !this.endpoints().length) return { skipped: true };
    // While on a backup, check the main relay once a minute and move back when it is healthy.
    if (this.activeIndex !== 0 && Date.now() - this.lastPrimaryProbe > 60000) {
      this.lastPrimaryProbe = Date.now();
      if (await this.primaryHealthy()) this.switchTo(0, 'main relay is back');
    }
    try {
      const data = await this.post(payload, this.activeEndpoint());
      this.failures = 0;
      return data;
    } catch (e) {
      // Only outages trigger failover; a wrong API key (4xx) would fail on every relay.
      const outage = !e.status || e.status >= 500;
      if (outage && this.endpoints().length > 1 && ++this.failures >= 2) this.switchTo(this.activeIndex + 1, e.message);
      throw e;
    }
  }

  async post(fullPayload, endpoint) {
    const { remote } = this.config;
    // The stream block (chat key, live flag, poll) travels beside the telemetry, never inside it.
    const { stream: streamBlock, ...payload } = fullPayload || {};
    const modern = this.features.has('static-cache');
    let telemetry;
    if (modern) {
      const { live, statics } = relayParts(payload);
      const h = hashOf(statics);
      // Static data only when it changed (or every 10 minutes as a safety net after relay restarts).
      if (h !== this.lastStaticHash || Date.now() - this.lastStaticAt > 600000) {
        live.static = statics;
        this.lastStaticHash = h;
        this.lastStaticAt = Date.now();
      }
      telemetry = live;
    } else {
      telemetry = sharedPayload(payload);
    }
    const body = { pairingCode: this.config.pairingCode, driverName: this.config.driverName, driverId: this.driverId, companionVersion: COMPANION_VERSION, telemetry };
    if (modern) body.knownStatic = Object.fromEntries([...this.peerStatic].map(([id, v]) => [id, v.hash]));
    if (streamBlock) body.stream = streamBlock;
    let raw = Buffer.from(JSON.stringify(body));
    const headers = { 'content-type': 'application/json', 'accept-encoding': 'gzip', 'user-agent': `ATS-Playground-Companion/${COMPANION_VERSION}`, ...(remote.apiKey ? { authorization: `Bearer ${remote.apiKey}` } : {}) };
    if (this.features.has('gzip')) { raw = zlib.gzipSync(raw); headers['content-encoding'] = 'gzip'; }
    this.bytesSent += raw.length;
    const response = await fetch(endpoint, { method: 'POST', headers, body: raw, redirect: 'manual', signal: AbortSignal.timeout(15000) });
    const len = Number(response.headers.get('content-length')) || 0;
    this.bytesReceived += len;
    this.posts++;
    // A redirect or web page (e.g. a Cloudflare Access sign-in) is not the relay: treat it like an outage so a backup is tried.
    if ((response.status >= 300 && response.status < 400) || response.type === 'opaqueredirect') throw new Error('Relay address redirected to a sign-in page instead of the relay');
    if (!response.ok) { const err = new Error(`Relay HTTP ${response.status}`); err.status = response.status; throw err; }
    if (/text\/html/i.test(String(response.headers.get('content-type') || ''))) throw new Error('Relay address answered with a web page (sign-in page?) instead of the relay');
    const data = await response.json();
    if (data.driverId) this.myRelayId = String(data.driverId);
    if (Array.isArray(data.features)) {
      const wasModern = modern;
      this.features = new Set(data.features);
      // Relay just told us it caches static data: make sure it gets ours on the next post.
      if (!wasModern && this.features.has('static-cache')) this.lastStaticHash = null;
    }
    // Re-attach cached static data to each peer so the rest of the Companion sees full objects.
    data.roster = (data.roster || []).map(peer => {
      const prev = this.peerStatic.get(peer.id);
      const { peer: telemetry, cache } = mergePeerStatic(peer.telemetry || {}, prev?.data || {});
      if (peer.staticHash) this.peerStatic.set(peer.id, { hash: peer.staticHash, data: cache });
      return { ...peer, telemetry };
    });
    return data;
  }

  stats() {
    const hours = Math.max(1 / 60, (Date.now() - this.startedAt) / 3600000);
    return { activeEndpoint: this.activeEndpoint(), usingBackup: this.activeIndex !== 0, posts: this.posts, sentBytes: this.bytesSent, receivedBytes: this.bytesReceived, mbPerHour: Math.round(((this.bytesSent + this.bytesReceived) / 1e6 / hours) * 10) / 10, features: [...this.features] };
  }
}

// Back-compat helper used by older call sites.
async function sendRemote(config, payload) {
  sendRemote.client ||= new RelayClient(config);
  return sendRemote.client.send(payload);
}

// Is this roster entry me? By the relay's id when known (names can be shared); by name only for old relays.
function isSelf(peer, client, driverName) {
  if (client?.myRelayId) return peer.id === client.myRelayId;
  return peer.driverName === driverName;
}

module.exports = { sendRemote, sharedPayload, relayParts, mergePeerStatic, RelayClient, isSelf, loadDriverId };
