// Screenshot journal: picks up the screenshots you take in ATS (F10 by default) and ties them to the
// trip you were on, for the Journal page and the Discord trip summary.

const fs = require('node:fs');
const path = require('node:path');
const { documentsRoot } = require('./localScanner');

const EXT = /\.(png|jpe?g)$/i;
const MAX_INDEX = 500;

class ScreenshotJournal {
  constructor(game = 'ATS') {
    this.dir = path.join(documentsRoot(game), 'screenshot');
    this.shots = [];
    this.lastScanAt = 0;
    this.scan();
    this.timer = setInterval(() => this.scan(), 20000);
    this.timer.unref?.();
  }

  available() { try { return fs.statSync(this.dir).isDirectory(); } catch { return false; } }

  scan() {
    this.lastScanAt = Date.now();
    if (!this.available()) { this.shots = []; return; }
    try {
      this.shots = fs.readdirSync(this.dir)
        .filter(n => EXT.test(n))
        .map(name => { try { const st = fs.statSync(path.join(this.dir, name)); return { name, takenAt: st.mtime.toISOString(), sizeBytes: st.size }; } catch { return null; } })
        .filter(Boolean)
        .sort((a, b) => b.takenAt.localeCompare(a.takenAt))
        .slice(0, MAX_INDEX);
    } catch (e) { console.error('[JOURNAL]', e.message); }
  }

  // Screenshots taken between two times (for a trip).
  between(startIso, endIso) {
    this.scan();
    const a = Date.parse(startIso), b = Date.parse(endIso || new Date().toISOString());
    return this.shots.filter(s => { const t = Date.parse(s.takenAt); return t >= a && t <= b + 60000; }).slice(0, 20);
  }

  // Resolve a screenshot by file name, refusing anything outside the screenshot folder.
  file(name) {
    const base = path.basename(String(name || ''));
    if (!EXT.test(base) || base !== name) return null;
    const full = path.join(this.dir, base);
    return fs.existsSync(full) ? full : null;
  }

  list(trips = [], limit = 120) {
    const byTrip = new Map();
    for (const t of trips) for (const n of t.screenshots || []) byTrip.set(n, t);
    return {
      folder: this.dir,
      available: this.available(),
      shots: this.shots.slice(0, limit).map(s => {
        const t = byTrip.get(s.name);
        return { ...s, trip: t ? { id: t.id, cargo: t.cargo, originCity: t.originCity, destinationCity: t.destinationCity, status: t.status, endedAt: t.endedAt } : null };
      })
    };
  }
}

module.exports = { ScreenshotJournal };
