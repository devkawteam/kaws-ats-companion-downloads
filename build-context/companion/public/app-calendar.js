// Convoy calendar: Companion convoy events + public iCal feeds, RSVP, reminders, "add to my calendar".
(() => {
  const K = window.KAW16; if (!K) return;
  const { q, api, esc, guard, notify } = K;
  const local = ['127.0.0.1', 'localhost', '[::1]'].includes(location.hostname);
  const REM = 'kawCalendarReminders';
  let reminders = {}, last = [], fired = {};
  try { reminders = JSON.parse(localStorage.getItem(REM) || '{}') || {}; } catch {}
  const keepRem = () => { try { localStorage.setItem(REM, JSON.stringify(reminders)); } catch {} };

  const html = `<div class="panel"><div class="panel-head"><div class="panel-title">Convoy Calendar</div><div class="muted" id="calHead" style="font-size:12px"></div></div><div class="v16-body">
    <p>Upcoming convoys from the Companion's convoy events, plus any public calendars you add below. RSVP, set a reminder (Jarvis tells you 30 and 10 minutes before), or add an event to your own calendar.</p>
    <div class="v16-row"><button class="cmd" id="calRefresh">Refresh</button><a class="cmd" id="calExport" href="/api/calendar/ics" download>⬇ Add all to my calendar (.ics)</a></div>
    <p id="calErr" class="v16-note" role="status"></p>
    <div id="calList"></div>
    <details id="calFeedsBox" style="margin-top:10px"><summary>Public calendars</summary>
      <p class="v16-note">Paste up to three PUBLIC calendar links (iCal / .ics, e.g. a public Google Calendar's “Public address in iCal format”). The Companion reads them every 15 minutes. Repeating events show their first date only.</p>
      <div id="calFeeds"></div>
      <div class="v16-row"><button class="cmd" id="calFeedAdd">+ Add calendar</button><button class="cmd" id="calFeedSave">Save calendars</button></div>
    </details>
  </div></div>`;

  const dayLabel = d => { const t = new Date(); t.setHours(0, 0, 0, 0); const diff = Math.round((new Date(d).setHours(0, 0, 0, 0) - t) / 86400000); return diff === 0 ? 'Today' : diff === 1 ? 'Tomorrow' : new Date(d).toLocaleDateString([], { weekday: 'long', month: 'short', day: 'numeric' }); };
  const time = e => e.allDay ? 'All day' : new Date(e.start).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  const until = e => { const m = Math.round((Date.parse(e.start) - Date.now()) / 60000); return m < 0 ? 'started' : m < 60 ? `in ${m} min` : m < 1440 ? `in ${Math.round(m / 60)} h` : ''; };

  function render(data) {
    last = data.events;
    q('#calHead').textContent = `${data.events.length} upcoming · sources: Companion${data.feeds.length ? `, ${data.feeds.map(f => f.name).join(', ')}` : ''}`;
    q('#calErr').textContent = data.errors.length ? `Couldn't read: ${data.errors.join('; ')}` : '';
    if (!data.events.length) { q('#calList').innerHTML = '<p class="v16-note">No convoys in the next 30 days. Create one on Convoy Sessions, or add a public calendar below.</p>'; return; }
    let html = '', day = '';
    for (const e of data.events) {
      const d = dayLabel(e.start); if (d !== day) { html += `<h4 style="margin:12px 0 4px">${esc(d)}</h4>`; day = d; }
      html += `<div class="panel" style="padding:10px 12px;margin:6px 0"><div class="v16-row" style="justify-content:space-between"><div style="flex:1 1 260px"><b>${esc(time(e))}</b> · <b>${esc(e.title)}</b> <span class="v16-note">${esc(until(e))}</span>
        <div class="v16-note">${e.location ? `📍 ${esc(e.location)} · ` : ''}${e.host ? `host ${esc(e.host)} · ` : ''}${esc(e.source)}${e.going != null ? ` · ${e.going} going` : ''}${e.repeats ? ' · repeats' : ''}</div>${e.description ? `<div class="v16-note">${esc(e.description)}</div>` : ''}</div>
        <div class="v16-row">${e.rsvp ? ['going', 'maybe', 'no'].map(st => `<button class="cmd small${e.myRsvp === st ? ' primary' : ''}" data-rsvp="${esc(e.eventId)}" data-st="${st}">${st === 'going' ? '✅ Going' : st === 'maybe' ? '🤔 Maybe' : '❌ No'}</button>`).join('') : ''}
          <button class="cmd small${reminders[e.id] ? ' primary' : ''}" data-rem="${esc(e.id)}" title="Remind me 30 and 10 minutes before">🔔</button><a class="cmd small" href="/api/calendar/ics?id=${encodeURIComponent(e.id)}" download title="Add to my calendar">📅</a></div></div></div>`;
    }
    q('#calList').innerHTML = html;
    q('#calList').querySelectorAll('[data-rsvp]').forEach(b => b.onclick = guard(async () => { await api(`/api/events/${encodeURIComponent(b.dataset.rsvp)}/rsvp`, { method: 'POST', body: { status: b.dataset.st } }); load(); }));
    q('#calList').querySelectorAll('[data-rem]').forEach(b => b.onclick = () => { const id = b.dataset.rem; if (reminders[id]) delete reminders[id]; else reminders[id] = Date.parse(last.find(e => e.id === id)?.start || 0); keepRem(); render(data); });
  }
  async function load() { try { render(await api('/api/calendar')); } catch (e) { q('#calErr').textContent = e.message; } }

  function feedRow(f = {}) { return `<div class="v16-row" style="margin:4px 0" data-feed><input class="v16-input" style="flex:0 1 160px" maxlength="40" placeholder="Name" value="${esc(f.name || '')}" aria-label="Calendar name"><input class="v16-input" style="flex:1 1 300px" placeholder="https://… .ics" value="${esc(f.url || '')}" aria-label="Calendar link"><button class="cmd small" data-feeddel>✕</button></div>`; }
  function wireFeeds() { q('#calFeeds').querySelectorAll('[data-feeddel]').forEach(b => b.onclick = () => { b.closest('[data-feed]').remove(); }); }

  // Reminders: checked every tick while the dashboard is open.
  K.onTick.push(() => {
    const nowT = Date.now();
    for (const [id, at] of Object.entries(reminders)) {
      if (at < nowT - 3600000) { delete reminders[id]; keepRem(); continue; }
      for (const lead of [30, 10]) {
        const key = `${id}:${lead}`, due = at - lead * 60000;
        if (!fired[key] && nowT >= due && nowT < due + 5 * 60000) {
          fired[key] = true;
          const e = last.find(x => x.id === id), name = e?.title || 'Your convoy';
          notify(`${name} in ${lead} minutes`, e?.location || '', 'join');
          const v = (() => { try { const p = JSON.parse(localStorage.getItem('kawJarvisVoice') || '{}'); return p.voiceURI ? p : null; } catch { return null; } })();
          K.coDriver?.speak?.(`Heads up: ${name} starts in ${lead} minutes${e?.location ? `, at ${e.location.split(' → ')[0]}` : ''}.`, { priority: 3, force: true, voiceOpts: v });
        }
      }
    }
  });

  K.pages.push({ name: 'calendar', icon: '📅', label: 'Convoy Calendar', group: 'Convoy', index: 4, html,
    init() {
      q('#calRefresh').onclick = guard(load);
      q('#calFeedAdd').onclick = () => { if (q('#calFeeds').querySelectorAll('[data-feed]').length >= 3) return notify('Three calendars max', '', 'leave'); q('#calFeeds').insertAdjacentHTML('beforeend', feedRow()); wireFeeds(); };
      q('#calFeedSave').onclick = guard(async () => {
        const feeds = [...q('#calFeeds').querySelectorAll('[data-feed]')].map(r => ({ name: r.children[0].value.trim(), url: r.children[1].value.trim() })).filter(f => f.url);
        const r = await fetch('/api/calendar/settings', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ feeds }) }).then(x => x.json());
        if (!r.ok) throw new Error(r.error); notify('Calendars saved', `${feeds.length} public calendar${feeds.length === 1 ? '' : 's'}`, 'join'); load();
      });
      q('#calFeedAdd').disabled = q('#calFeedSave').disabled = !local;
    },
    load: async () => {
      try { const st = await api('/api/calendar/settings').catch(() => null); const feeds = st?.feeds || []; if (!q('#calFeeds').children.length) { q('#calFeeds').innerHTML = (feeds.length ? feeds : [{}]).map(feedRow).join(''); wireFeeds(); } } catch {}
      return load();
    } });
})();
