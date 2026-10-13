// Convoy formation coach: running order, time gaps and one clear tip for you. Author: Kaw.
(() => {
  const K = window.KAW16; if (!K) return;
  const { q, api, esc, guard, notify } = K;
  const local = ['127.0.0.1', 'localhost', '[::1]'].includes(location.hostname);
  const COLORS = { leader: '#4aa3ff', good: '#2ecc71', 'too-close': '#e74c3c', loose: '#f1c40f', broken: '#e74c3c', 'ahead-of-leader': '#e67e22' };
  const LABELS = { leader: 'Leader', good: 'Good spacing', 'too-close': 'Too close', loose: 'Falling back', broken: 'Lost the convoy', 'ahead-of-leader': 'Ahead of leader' };
  let timer = null, lastSpoken = '', speak = false;
  try { speak = localStorage.getItem('kawFormationSpeak') === '1'; } catch {}

  const html = `<div class="panel"><div class="panel-head"><div class="panel-title">Formation Coach</div><div class="muted" id="fcScore" style="font-size:12px"></div></div><div class="v16-body">
    <p>Keeps the convoy tidy: who is where behind the leader, the time gap to the truck ahead, and a tip for you. Choose the leader on the Convoy Hub, or join a convoy event (the host leads).</p>
    <div id="fcTip" class="panel" style="padding:14px;margin:8px 0;font-size:18px;font-weight:700"></div>
    <div id="fcLane" style="position:relative;height:64px;margin:16px 6px;border-top:3px dashed #888a;"></div>
    <div id="fcList"></div>
    <h3>Settings</h3>
    <label>Target gap to the truck ahead: <b id="fcSecsVal"></b> seconds <input type="range" id="fcSecs" min="2" max="10" step="0.5" style="width:100%"></label>
    <p class="v16-note">Real truckers keep 4+ seconds; tighter is fine for show convoys at low speed. "Too close" warns below half the target (never under 1.5 s), after 8 seconds.</p>
    <label class="v16-toggle"><span>Speak my tips (this device)</span><input type="checkbox" id="fcSpeak"></label>
  </div></div>`;

  function render(s) {
    if (!s.active) {
      q('#fcTip').textContent = s.reason || 'Waiting for the convoy…'; q('#fcTip').style.borderLeft = '6px solid #888';
      q('#fcList').innerHTML = ''; q('#fcLane').innerHTML = ''; q('#fcScore').textContent = '';
    } else {
      const t = s.tip || { level: 'good', text: 'Watching the formation.' };
      q('#fcTip').textContent = t.text; q('#fcTip').style.borderLeft = `6px solid ${t.level === 'critical' ? '#e74c3c' : t.level === 'warn' ? '#f1c40f' : '#2ecc71'}`;
      q('#fcScore').textContent = `Formation score ${s.score}% · leader ${s.leader}`;
      const maxBack = Math.max(0.2, ...s.members.map(m => m.behindLeaderMiles));
      q('#fcLane').innerHTML = s.members.map(m => `<div title="${esc(m.driverName)}" style="position:absolute;top:-14px;right:${Math.min(96, m.behindLeaderMiles / maxBack * 96)}%;text-align:center;transform:translateX(50%)"><div style="width:22px;height:22px;border-radius:6px;margin:auto;background:${COLORS[m.status]};border:2px solid ${m.isLocal ? '#fff' : '#0008'}"></div><div style="font-size:11px;white-space:nowrap;margin-top:4px">${esc(m.driverName)}</div></div>`).join('')
        + '<div style="position:absolute;right:-6px;top:-30px;font-size:11px" class="v16-note">front ▶</div>';
      q('#fcList').innerHTML = s.members.map(m => `<div class="v16-row" style="padding:6px 8px;border-radius:8px;margin:4px 0;${m.isLocal ? 'background:color-mix(in srgb,var(--blue) 18%,transparent)' : ''}">
        <b style="width:28px">${m.position}.</b><span style="flex:1 1 140px">${esc(m.driverName)}${m.isLocal ? ' (you)' : ''}</span>
        <span class="v16-pill" style="background:${COLORS[m.status]}33;border-color:${COLORS[m.status]}">${LABELS[m.status] || esc(m.status)}</span>
        <span style="width:150px;text-align:right">${m.isLeader ? `${m.speedMph} mph` : `${m.gapSeconds ?? '—'} s · ${m.gapFeet >= 2640 ? `${m.gapMiles} mi` : `${m.gapFeet.toLocaleString('en-US')} ft`}`}</span></div>`).join('');
      if (speak && s.tip && s.tip.level !== 'good' && s.tip.text !== lastSpoken && 'speechSynthesis' in window) { lastSpoken = s.tip.text; speechSynthesis.speak(new SpeechSynthesisUtterance(s.tip.text)); }
    }
    q('#fcSecs').value = s.followSeconds || 4; q('#fcSecsVal').textContent = s.followSeconds || 4;
  }
  const refresh = () => api('/api/formation').then(render).catch(e => { q('#fcTip').textContent = e.message; });

  K.pages.push({ name: 'formation', icon: '⋯', label: 'Formation Coach', group: 'Convoy', index: 3, html,
    init() {
      q('#fcSpeak').checked = speak;
      q('#fcSpeak').onchange = () => { speak = q('#fcSpeak').checked; try { localStorage.setItem('kawFormationSpeak', speak ? '1' : '0'); } catch {} };
      q('#fcSecs').disabled = !local;
      q('#fcSecs').oninput = () => { q('#fcSecsVal').textContent = q('#fcSecs').value; };
      q('#fcSecs').onchange = guard(async () => { await api('/api/formation/settings', { method: 'POST', body: { followSeconds: +q('#fcSecs').value } }); notify('Target gap saved', `${q('#fcSecs').value} seconds`, 'join'); });
    },
    load: () => {
      clearInterval(timer);
      timer = setInterval(() => { if (K.currentPage() === 'formation') refresh(); else clearInterval(timer); }, 2000);
      return refresh();
    } });
})();
