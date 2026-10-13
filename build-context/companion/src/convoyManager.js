const fs = require('node:fs');
const path = require('node:path');

const DATA_DIR = path.join(process.cwd(), 'data');
const PEERS_FILE = path.join(DATA_DIR, 'convoy-peers.json');
const COMMANDS_FILE = path.join(DATA_DIR, 'convoy-commands.json');

function safeReadObject(file) {
  try {
    if (!fs.existsSync(file)) return {};
    const data = JSON.parse(fs.readFileSync(file, 'utf8'));
    return data && typeof data === 'object' && !Array.isArray(data) ? data : {};
  } catch { return {}; }
}
function safeReadArray(file) {
  try {
    if (!fs.existsSync(file)) return [];
    const data = JSON.parse(fs.readFileSync(file, 'utf8'));
    return Array.isArray(data) ? data : [];
  } catch { return []; }
}
function persist(file, data) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(file, JSON.stringify(data, null, 2), 'utf8');
}

function routeRelation(local, peer) {
  const lj = local?.job || {};
  const pj = peer?.job || {};

  if (!pj.active) return 'NO JOB';
  if (!lj.active) return 'ACTIVE JOB';

  const lo = String(lj.originCity || '').toLowerCase();
  const ld = String(lj.destinationCity || '').toLowerCase();
  const po = String(pj.originCity || '').toLowerCase();
  const pd = String(pj.destinationCity || '').toLowerCase();

  if (lo && ld && lo === po && ld === pd) return 'SAME ROUTE';
  if (ld && ld === pd) return 'SAME DESTINATION';
  if (lo && lo === po) return 'SAME ORIGIN';
  return 'OTHER ROUTE';
}

class ConvoyManager {
  constructor(driverName) {
    this.driverName = driverName || 'Driver';
    this.peers = safeReadObject(PEERS_FILE);
    this.commands = safeReadArray(COMMANDS_FILE).slice(0, 50);
    this.local = null;
    this.localCapabilities = null;
  }

  setLocalCapabilities(capabilities) { this.localCapabilities = capabilities || null; }

  updateLocal(state) {
    this.local = {
      id: 'local',
      driverName: this.driverName,
      isLocal: true,
      online: Boolean(state.connected),
      updatedAt: new Date().toISOString(),
      truck: state.truck,
      job: state.job,
      navigation: state.navigation,
      positioning: state.positioning,
      damage: state.damage,
      systems: state.systems,
      warnings: state.warnings,
      capabilities: this.localCapabilities
    };
  }

  ingestPeer(peer) {
    if (!peer || !peer.driverName) return false;
    const id = String(peer.id || peer.driverName).toLowerCase().replace(/[^a-z0-9_-]+/g, '-');
    // The relay keeps listing a driver for a while after they stop sending. Only count them as "seen"
    // when the relay's own update stamp for them changes (no clock comparison between PCs needed).
    const prev = this.peers[id];
    const fresh = !peer.relaySeenAt || !prev || prev.relaySeenAt !== peer.relaySeenAt;
    this.peers[id] = {
      ...peer,
      id,
      isLocal: false,
      updatedAt: fresh ? new Date().toISOString() : prev.updatedAt
    };
    persist(PEERS_FILE, this.peers);
    return true;
  }

  removePeer(id) {
    if (!id || !this.peers[id]) return false;
    delete this.peers[id];
    persist(PEERS_FILE, this.peers);
    return true;
  }

  issueCommand(command) {
    const allowed = new Set([
      'DEPART', 'HOLD POSITION', 'REGROUP', 'FUEL STOP',
      'REST STOP', 'EMERGENCY STOP', 'RESUME CONVOY'
    ]);
    const type = String(command?.type || '').toUpperCase().trim();
    if (!allowed.has(type)) return null;

    const entry = {
      id: `cmd-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      type,
      message: String(command?.message || '').slice(0, 240),
      issuedBy: String(command?.issuedBy || this.driverName),
      createdAt: new Date().toISOString()
    };
    this.commands.unshift(entry);
    this.commands = this.commands.slice(0, 50);
    persist(COMMANDS_FILE, this.commands);
    return entry;
  }

  getRoster() {
    const now = Date.now();
    const local = this.local || {
      id: 'local', driverName: this.driverName, isLocal: true, online: false,
      updatedAt: new Date().toISOString(), truck: {}, job: {}, navigation: {},
      positioning: {}, damage: {}, systems: {}, warnings: {}
    };

    const peers = Object.values(this.peers).map(p => {
      const ageMs = now - new Date(p.updatedAt || 0).getTime();
      const online = ageMs < 30000;
      return {
        ...p,
        online,
        ageSeconds: Math.max(0, Math.round(ageMs / 1000)),
        relation: routeRelation(local, p)
      };
    });

    return [
      { ...local, relation: 'YOUR ROUTE', ageSeconds: 0 },
      ...peers
    ];
  }

  getSummary() {
    const roster = this.getRoster();
    return {
      total: roster.length,
      online: roster.filter(r => r.online).length,
      sameRoute: roster.filter(r => r.relation === 'SAME ROUTE').length,
      roster,
      commands: this.commands.slice(0, 10)
    };
  }
}

module.exports = { ConvoyManager };
