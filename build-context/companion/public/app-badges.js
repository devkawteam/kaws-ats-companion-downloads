// Career badges card: a shareable picture of your level, badges and weekly stars (Career page).
(() => {
  const K = window.KAW16; if (!K) return;
  const { q, api, guard, notify, telem } = K;

  function wrapText(x, text, maxW) { const words = String(text).split(' '); let line = '', out = []; for (const w of words) { const t = line ? `${line} ${w}` : w; if (x.measureText(t).width > maxW && line) { out.push(line); line = w; } else line = t; } if (line) out.push(line); return out; }

  const n = (v, one, many = one + 's') => `${(v || 0).toLocaleString('en-US')} ${v === 1 ? one : many}`;
  async function draw() {
    const c = q('#bgCanvas'); if (!c) return;
    const career = telem()?.career || await api('/api/career').catch(() => null) || {};
    let fun = {}; try { fun = await api('/api/fun'); } catch {}
    const x = c.getContext('2d'), W = c.width, H = c.height;
    const g = x.createLinearGradient(0, 0, W, H); g.addColorStop(0, '#0b1626'); g.addColorStop(1, '#22114a'); x.fillStyle = g; x.fillRect(0, 0, W, H);
    x.fillStyle = '#ffb000'; x.fillRect(0, H - 12, W, 12);
    // Level ring
    const lvl = career.level || 1, xp = career.xp || 0, next = career.nextLevelXp || 500, prev = Math.pow(lvl - 1, 2) * 500, frac = Math.max(0, Math.min(1, (xp - prev) / Math.max(1, next - prev)));
    x.lineWidth = 18; x.strokeStyle = '#ffffff22'; x.beginPath(); x.arc(170, 200, 110, 0, Math.PI * 2); x.stroke();
    x.strokeStyle = '#4aa3ff'; x.beginPath(); x.arc(170, 200, 110, -Math.PI / 2, -Math.PI / 2 + frac * Math.PI * 2); x.stroke();
    x.fillStyle = '#9fb8d8'; x.font = '700 24px "Segoe UI", Arial, sans-serif'; x.textAlign = 'center'; x.fillText('LEVEL', 170, 170);
    x.fillStyle = '#fff'; x.font = '900 84px "Segoe UI", Arial, sans-serif'; x.fillText(String(lvl), 170, 250); x.textAlign = 'left';
    x.fillStyle = '#9fb8d8'; x.font = '600 24px "Segoe UI", Arial, sans-serif'; x.fillText("KAW'S ATS · DRIVER CAREER", 330, 90);
    x.fillStyle = '#fff'; x.font = '900 58px "Segoe UI", Arial, sans-serif'; x.fillText(String(career.driverName || 'Driver').slice(0, 22), 330, 155);
    x.font = '500 28px "Segoe UI", Arial, sans-serif'; x.fillStyle = '#cfe0f5';
    x.fillText(`${xp.toLocaleString('en-US')} XP · ${n(career.deliveries, 'delivery', 'deliveries')} · ${Math.round(career.totalMiles || 0).toLocaleString('en-US')} mi`, 330, 200);
    const unlocked = (career.availableAchievements || []).filter(a => a.unlocked), total = (career.availableAchievements || []).length;
    x.fillText(`${unlocked.length} of ${total} badges · ${n(career.convoys, 'convoy')} · ${n(career.cleanDeliveries, 'clean load')}`, 330, 240);
    // Badges grid
    x.font = '700 22px "Segoe UI", Arial, sans-serif';
    let bx = 60, by = 360;
    for (const a of unlocked.slice(-12)) {
      const w = Math.min(340, x.measureText(a.name).width + 70);
      if (bx + w > W - 50) { bx = 60; by += 62; }
      if (by > H - 120) break;
      x.fillStyle = '#ffffff14'; x.beginPath(); x.roundRect(bx, by - 34, w, 48, 24); x.fill();
      x.fillStyle = '#ffd257'; x.fillText('★', bx + 18, by); x.fillStyle = '#fff'; x.fillText(a.name, bx + 48, by);
      bx += w + 12;
    }
    if (!unlocked.length) { x.fillStyle = '#cfe0f5'; x.font = '500 26px "Segoe UI", Arial, sans-serif'; for (const [i, l] of wrapText(x, 'No badges yet — deliver loads, join convoys and finish challenges to earn them.', W - 120).entries()) x.fillText(l, 60, 380 + i * 34); }
    // Weekly stars
    const hist = (fun.weekly?.history || []).slice(0, 6), cur = fun.weekly;
    x.font = '600 22px "Segoe UI", Arial, sans-serif'; x.fillStyle = '#9fb8d8';
    const stars = [cur ? `${cur.week} ${'★'.repeat(cur.items.filter(i => i.done).length)}${'☆'.repeat(cur.items.filter(i => !i.done).length)}` : null, ...hist.map(h => `${h.week} ${'★'.repeat(h.done)}${'☆'.repeat(Math.max(0, 4 - h.done))}`)].filter(Boolean);
    if (stars.length) x.fillText(`Weekly challenges: ${stars.slice(0, 4).join('   ')}`, 60, H - 40);
  }

  const canvasBlob = () => new Promise(r => q('#bgCanvas').toBlob(r, 'image/png'));
  K.onReady.push(() => {
    q('#page-career')?.insertAdjacentHTML('beforeend', `<div class="panel" style="margin-top:12px"><div class="panel-head"><div class="panel-title">Share my career</div></div><div class="v16-body">
      <p>A picture of your level, badges and weekly stars for Discord or social media.</p>
      <canvas id="bgCanvas" width="1200" height="630" style="width:100%;max-width:720px;border-radius:12px;display:block;margin:8px 0" aria-label="Career badges card"></canvas>
      <div class="v16-row"><button class="cmd" id="bgRefresh">Refresh</button><button class="cmd" id="bgDownload">Download image</button><button class="cmd" id="bgCopy">Copy image</button><button class="cmd" id="bgShare">Share…</button></div></div></div>`);
    if (!q('#bgCanvas')) return;
    q('#bgRefresh').onclick = guard(draw);
    q('#bgDownload').onclick = guard(async () => { await draw(); const b = await canvasBlob(), u = URL.createObjectURL(b), a = document.createElement('a'); a.href = u; a.download = 'kaw-career.png'; a.click(); setTimeout(() => URL.revokeObjectURL(u), 2000); });
    q('#bgCopy').onclick = guard(async () => { await draw(); if (!window.ClipboardItem) throw new Error('Copying images is not supported here — use Download.'); await navigator.clipboard.write([new ClipboardItem({ 'image/png': await canvasBlob() })]); notify('Image copied', 'Paste it into Discord.', 'join'); });
    q('#bgShare').onclick = guard(async () => { await draw(); const f = new File([await canvasBlob()], 'kaw-career.png', { type: 'image/png' }); if (navigator.canShare?.({ files: [f] })) await navigator.share({ files: [f], title: 'My ATS career' }); else throw new Error('Sharing is not available here — use Download.'); });
  });
  const origLoad = () => draw().catch(() => {});
  K.onTick.push((d, page) => { if (page === 'career' && !draw.done) { draw.done = true; origLoad(); } else if (page !== 'career') draw.done = false; });
})();
