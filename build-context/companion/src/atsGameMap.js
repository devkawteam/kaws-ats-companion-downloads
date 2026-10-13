// "ATS game map" data: the game's own roads as vector tiles (ats.pmtiles), built from ATS game files
// by .github/workflows/ats-map.yml and published on the public downloads repo. The Companion downloads
// it once into data/maps/ and serves it locally (with HTTP Range, which PMTiles needs), so the map
// costs no hosting and works offline afterwards.

const fs = require('node:fs');
const path = require('node:path');
const { Readable } = require('node:stream');
const { pipeline } = require('node:stream/promises');

const DIR = path.join(process.cwd(), 'data', 'maps');
const FILE = path.join(DIR, 'ats.pmtiles');
const INFO = path.join(DIR, 'ats-map.json');
const SOURCE = 'https://github.com/devkawteam/kaws-ats-companion-downloads/releases/download/ats-map/ats.pmtiles';

const job = { downloading: false, received: 0, total: 0, error: null, startedAt: null };

function status() {
  let size = 0, info = null;
  try { size = fs.statSync(FILE).size; } catch {}
  try { info = JSON.parse(fs.readFileSync(INFO, 'utf8')); } catch {}
  return {
    installed: size > 0,
    sizeBytes: size,
    installedAt: info?.installedAt || null,
    source: SOURCE,
    downloading: job.downloading,
    receivedBytes: job.received,
    totalBytes: job.total,
    error: job.error
  };
}

async function download() {
  if (job.downloading) return status();
  Object.assign(job, { downloading: true, received: 0, total: 0, error: null, startedAt: Date.now() });
  const tmp = `${FILE}.part`;
  (async () => {
    try {
      fs.mkdirSync(DIR, { recursive: true });
      const res = await fetch(SOURCE, { redirect: 'follow', headers: { 'user-agent': 'KAW-ATS-Companion' } });
      if (res.status === 404) throw new Error('The ATS game map has not been published yet.');
      if (!res.ok || !res.body) throw new Error(`Download failed (HTTP ${res.status}).`);
      job.total = Number(res.headers.get('content-length')) || 0;
      const counter = new (require('node:stream').Transform)({ transform(chunk, _e, cb) { job.received += chunk.length; cb(null, chunk); } });
      await pipeline(Readable.fromWeb(res.body), counter, fs.createWriteStream(tmp));
      // A PMTiles v3 file starts with the magic bytes "PMTiles" + version 3.
      const head = Buffer.alloc(8);
      const fd = fs.openSync(tmp, 'r'); fs.readSync(fd, head, 0, 8, 0); fs.closeSync(fd);
      if (head.toString('latin1', 0, 7) !== 'PMTiles') throw new Error('The downloaded file is not a map file.');
      fs.renameSync(tmp, FILE);
      fs.writeFileSync(INFO, JSON.stringify({ installedAt: new Date().toISOString(), source: SOURCE, sizeBytes: job.received }, null, 2));
      console.log(`[MAP] ATS game map installed (${Math.round(job.received / 1048576)} MB).`);
    } catch (e) {
      job.error = e.message;
      try { fs.unlinkSync(tmp); } catch {}
      console.error('[MAP] ATS game map:', e.message);
    } finally {
      job.downloading = false;
    }
  })();
  return status();
}

function remove() {
  if (job.downloading) throw new Error('A download is in progress.');
  for (const f of [FILE, INFO]) { try { fs.unlinkSync(f); } catch {} }
  return status();
}

// Serve data/maps/ats.pmtiles with Range support. Returns true when it handled the request.
function serve(req, res, pathname) {
  if (pathname !== '/maps/ats.pmtiles') return false;
  let size;
  try { size = fs.statSync(FILE).size; } catch { res.writeHead(404, { 'content-type': 'text/plain' }); res.end('ATS game map not installed'); return true; }
  const range = /^bytes=(\d*)-(\d*)$/.exec(req.headers.range || '');
  const base = { 'accept-ranges': 'bytes', 'content-type': 'application/octet-stream', 'cache-control': 'no-cache' };
  if (!range) {
    res.writeHead(200, { ...base, 'content-length': size });
    if (req.method === 'HEAD') return res.end(), true;
    fs.createReadStream(FILE).pipe(res);
    return true;
  }
  let start = range[1] === '' ? Math.max(0, size - Number(range[2])) : Number(range[1]);
  let end = range[1] !== '' && range[2] !== '' ? Math.min(Number(range[2]), size - 1) : size - 1;
  if (!(start <= end) || start >= size) { res.writeHead(416, { ...base, 'content-range': `bytes */${size}` }); res.end(); return true; }
  res.writeHead(206, { ...base, 'content-range': `bytes ${start}-${end}/${size}`, 'content-length': end - start + 1 });
  if (req.method === 'HEAD') return res.end(), true;
  fs.createReadStream(FILE, { start, end }).pipe(res);
  return true;
}

module.exports = { status, download, remove, serve };
