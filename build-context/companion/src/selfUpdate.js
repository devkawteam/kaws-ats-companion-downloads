// Preview self-update: when the Companion runs from a git checkout (the PREVIEW), check the branch for new
// commits and pull them (fast-forward only), then restart through the PREVIEW launcher.
// Only fixed git/npm commands run; nothing from the request reaches a command line. Author: Kaw.
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { execFile, spawn } = require('node:child_process');

function run(cmd, args, cwd, timeout = 30000) {
  return new Promise(resolve => execFile(cmd, args, { cwd, timeout, windowsHide: true, maxBuffer: 2 * 1024 * 1024 }, (err, stdout, stderr) => resolve({ ok: !err, out: String(stdout || '').trim(), err: String(stderr || err?.message || '').trim() })));
}

class SelfUpdate {
  constructor({ companionDir = process.cwd(), runImpl = run } = {}) {
    this.dir = companionDir; this.root = path.resolve(companionDir, '..'); this.run = runImpl;
    this.cache = null; this.busy = false;
  }
  isGit() { return fs.existsSync(path.join(this.root, '.git')); }   // a folder in a clone, a file in a worktree
  async git(args, timeout) { return this.run('git', ['-C', this.root, ...args], this.root, timeout); }

  async status({ fresh = false } = {}) {
    if (!this.isGit()) return { git: false, message: 'This Companion was installed (not a preview copy from GitHub), so updates come from the normal installer.' };
    if (!fresh && this.cache && Date.now() - this.cache.at < 5 * 60000) return this.cache.value;
    const branch = (await this.git(['rev-parse', '--abbrev-ref', 'HEAD'])).out;
    if (!branch || branch === 'HEAD') return { git: true, ok: false, message: 'This copy is not on a branch, so it cannot update itself.' };
    const fetched = await this.git(['fetch', '--quiet', 'origin', branch], 45000);
    const counts = (await this.git(['rev-list', '--left-right', '--count', `HEAD...origin/${branch}`])).out.split(/\s+/).map(Number);
    const [ahead, behind] = [counts[0] || 0, counts[1] || 0];
    const dirty = (await this.git(['status', '--porcelain', '--untracked-files=no'])).out.length > 0;
    const latest = behind ? (await this.git(['log', '-1', '--format=%h %s', `origin/${branch}`])).out.slice(0, 160) : '';
    const current = (await this.git(['log', '-1', '--format=%h %s'])).out.slice(0, 160);
    const value = { git: true, ok: fetched.ok, branch, ahead, behind, dirty, current, latest, checkedAt: new Date().toISOString(), message: !fetched.ok ? 'Could not reach GitHub to check for updates.' : behind ? `${behind} new update${behind === 1 ? '' : 's'} on ${branch}.` : 'You have the latest preview.' };
    this.cache = { at: Date.now(), value };
    return value;
  }

  async apply() {
    if (this.busy) throw new Error('An update is already running.');
    this.busy = true;
    try {
      const st = await this.status({ fresh: true });
      if (!st.git) throw new Error(st.message);
      if (!st.ok) throw new Error(st.message);
      if (st.dirty) throw new Error('This copy has local changes, so it will not update automatically (nothing was changed). Ask Claude or update it by hand.');
      if (st.ahead) throw new Error('This copy has commits that are not on GitHub, so it will not update automatically (nothing was changed).');
      if (!st.behind) return { updated: false, message: st.message };
      const before = (await this.git(['rev-parse', 'HEAD'])).out;
      const pull = await this.git(['pull', '--ff-only', 'origin', st.branch], 120000);
      if (!pull.ok) throw new Error(`Update failed: ${pull.err.split('\n')[0] || 'git pull did not finish'}`);
      const changed = (await this.git(['diff', '--name-only', before, 'HEAD'])).out.split('\n');
      let installed = null;
      if (changed.some(f => /^companion\/package(-lock)?\.json$/.test(f))) {
        installed = await new Promise(resolve => {
          const p = spawn('npm', ['install', '--omit=dev', '--no-audit', '--no-fund'], { cwd: this.dir, shell: true, windowsHide: true });   // fixed arguments only
          const t = setTimeout(() => { p.kill(); resolve(false); }, 300000);
          p.on('exit', code => { clearTimeout(t); resolve(code === 0); });
          p.on('error', () => { clearTimeout(t); resolve(false); });
        });
      }
      this.cache = null;
      return { updated: true, from: before.slice(0, 7), files: changed.filter(Boolean).length, dependencies: installed, message: `Updated ${st.behind} change${st.behind === 1 ? '' : 's'}${installed === false ? ' (could not refresh add-ons — run npm install in the companion folder)' : ''}.` };
    } finally { this.busy = false; }
  }
}

module.exports = { SelfUpdate };
