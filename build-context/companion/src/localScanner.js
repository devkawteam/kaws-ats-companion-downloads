const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

const ATS_APP_ID = '270880';
const ETS2_APP_ID = '227300';

const MAP_DLC = {
  'dlc_new_mexico': 'New Mexico',
  'dlc_oregon': 'Oregon',
  'dlc_washington': 'Washington',
  'dlc_utah': 'Utah',
  'dlc_idaho': 'Idaho',
  'dlc_colorado': 'Colorado',
  'dlc_wyoming': 'Wyoming',
  'dlc_montana': 'Montana',
  'dlc_texas': 'Texas',
  'dlc_oklahoma': 'Oklahoma',
  'dlc_kansas': 'Kansas',
  'dlc_nebraska': 'Nebraska',
  'dlc_arkansas': 'Arkansas',
  'dlc_missouri': 'Missouri',
  'dlc_iowa': 'Iowa',
  'dlc_louisiana': 'Louisiana',
  'dlc_illinois': 'Illinois'
};

const BASE_STATES = ['California', 'Nevada', 'Arizona'];

const STATE_TO_DLC = Object.fromEntries(
  Object.entries(MAP_DLC).map(([token, state]) => [state, token])
);

function exists(p) {
  try { return fs.existsSync(p); } catch { return false; }
}
function statMtime(p) {
  try { return fs.statSync(p).mtimeMs; } catch { return 0; }
}

function steamRoots() {
  const roots = [
    'C:\\Program Files (x86)\\Steam',
    'C:\\Program Files\\Steam'
  ].filter(exists);

  for (const root of [...roots]) {
    const vdf = path.join(root, 'steamapps', 'libraryfolders.vdf');
    if (!exists(vdf)) continue;
    try {
      const text = fs.readFileSync(vdf, 'utf8');
      const matches = [...text.matchAll(/"path"\s+"([^"]+)"/g)];
      for (const m of matches) {
        const p = m[1].replace(/\\\\/g, '\\');
        if (exists(p) && !roots.includes(p)) roots.push(p);
      }
    } catch {}
  }
  return roots;
}

function findGameInstall() {
  for (const root of steamRoots()) {
    const ats = path.join(root, 'steamapps', 'common', 'American Truck Simulator');
    if (exists(ats)) return { game: 'ATS', appId: ATS_APP_ID, root: ats, steamRoot: root };
    const ets = path.join(root, 'steamapps', 'common', 'Euro Truck Simulator 2');
    if (exists(ets)) return { game: 'ETS2', appId: ETS2_APP_ID, root: ets, steamRoot: root };
  }
  return null;
}

function documentsRoot(game) {
  const home = os.homedir();
  const folder = game === 'ETS2' ? 'Euro Truck Simulator 2' : 'American Truck Simulator';
  // Documents is often redirected to OneDrive; use the first location that actually has the game folder.
  const candidates = [
    path.join(home, 'Documents', folder),
    process.env.OneDrive && path.join(process.env.OneDrive, 'Documents', folder),
    process.env.OneDriveConsumer && path.join(process.env.OneDriveConsumer, 'Documents', folder),
    path.join(home, 'OneDrive', 'Documents', folder)
  ].filter(Boolean);
  return candidates.find(exists) || candidates[0];
}

function scanDlc(install) {
  if (!install?.root || !exists(install.root)) return { files: [], map: [], other: [], baseStates: BASE_STATES };
  const files = [];
  try {
    for (const name of fs.readdirSync(install.root)) {
      if (/^dlc_.+\.scs$/i.test(name)) files.push(name);
    }
  } catch {}

  const map = [];
  const other = [];
  for (const file of files) {
    const token = file.replace(/\.scs$/i, '').toLowerCase();
    if (MAP_DLC[token]) map.push({ token, state: MAP_DLC[token], file });
    else other.push({ token, file });
  }
  map.sort((a,b)=>a.state.localeCompare(b.state));
  other.sort((a,b)=>a.token.localeCompare(b.token));
  return { files, map, other, baseStates: BASE_STATES };
}

function scanLocalMods(docRoot) {
  const modDir = path.join(docRoot, 'mod');
  const mods = [];
  if (exists(modDir)) {
    try {
      for (const name of fs.readdirSync(modDir)) {
        const p = path.join(modDir, name);
        const st = fs.statSync(p);
        if (st.isDirectory() || /\.scs$/i.test(name) || /\.zip$/i.test(name)) {
          mods.push({
            name,
            type: st.isDirectory() ? 'folder' : 'file',
            size: st.isFile() ? st.size : null,
            modifiedAt: st.mtime.toISOString()
          });
        }
      }
    } catch {}
  }
  return { directory: modDir, mods };
}

function scanWorkshop(install) {
  const root = install?.steamRoot
    ? path.join(install.steamRoot, 'steamapps', 'workshop', 'content', install.appId)
    : null;
  const items = [];
  if (root && exists(root)) {
    try {
      for (const name of fs.readdirSync(root)) {
        const p = path.join(root, name);
        if (fs.statSync(p).isDirectory()) items.push({ workshopId: name, path: p, modifiedAt: fs.statSync(p).mtime.toISOString() });
      }
    } catch {}
  }
  return { directory: root, items };
}

function findActiveModManager(docRoot) {
  const roots = [path.join(docRoot, 'profiles'), path.join(docRoot, 'steam_profiles')].filter(exists);
  const candidates = [];
  for (const root of roots) {
    try {
      for (const profile of fs.readdirSync(root)) {
        const p = path.join(root, profile, 'mod_manager.sii');
        if (exists(p)) candidates.push(p);
      }
    } catch {}
  }
  candidates.sort((a,b)=>statMtime(b)-statMtime(a));
  if (!candidates.length) return { file: null, activeRefs: [], activeCount: 0 };

  const file = candidates[0];
  let text = '';
  try { text = fs.readFileSync(file, 'utf8'); } catch {}
  const refs = [];
  for (const line of text.split(/\r?\n/)) {
    if (!/mod_active|mod_package|workshop/i.test(line)) continue;
    const q = [...line.matchAll(/"([^"]+)"/g)].map(x=>x[1]);
    if (q.length) refs.push(...q);
  }
  return { file, activeRefs: [...new Set(refs)].slice(0, 500), activeCount: [...new Set(refs)].length };
}

function readGameVersion(docRoot) {
  const cfg = path.join(docRoot, 'config.cfg');
  try {
    const text = fs.readFileSync(cfg, 'utf8');
    const m = text.match(/uset\s+g_game_version\s+"([^"]+)"/);
    return m ? m[1] : null;
  } catch { return null; }
}

function scanLocal() {
  const install = findGameInstall();
  const game = install?.game || 'ATS';
  const docs = documentsRoot(game);
  const dlc = scanDlc(install);
  const localMods = scanLocalMods(docs);
  const workshop = scanWorkshop(install);
  const active = findActiveModManager(docs);

  return {
    scannedAt: new Date().toISOString(),
    game,
    appId: install?.appId || ATS_APP_ID,
    gameRoot: install?.root || null,
    documentsRoot: docs,
    gameVersion: readGameVersion(docs),
    dlc,
    mods: {
      local: localMods,
      workshop,
      activeProfile: active
    },
    capabilities: {
      baseStates: BASE_STATES,
      mapDlcTokens: dlc.map.map(x=>x.token),
      mapStates: [...BASE_STATES, ...dlc.map.map(x=>x.state)],
      dlcTokens: dlc.files.map(x=>x.replace(/\.scs$/i,'').toLowerCase()),
      localModNames: localMods.mods.map(x=>x.name),
      workshopIds: workshop.items.map(x=>x.workshopId),
      activeModRefs: active.activeRefs,
      gameVersion: readGameVersion(docs)
    }
  };
}

module.exports = { scanLocal, documentsRoot, MAP_DLC, STATE_TO_DLC, BASE_STATES };
