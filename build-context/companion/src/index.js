const fs = require('node:fs/promises');
const { VoicePacks } = require('./voicePack');
const { StreamHub } = require('./streamHub');
const { StreamStudio } = require('./streamStudio');
const { TripRoutes } = require('./tripRoutes');
const { ObsBridge } = require('./obsBridge');
const { AppMixer } = require('./appMixer');
const { TwitchBridge } = require('./twitchBridge');
const path = require('node:path');
const { loadConfig, saveConfigSection } = require('./config');
const { FormationCoach } = require('./formationCoach');
const { RoutePlans, learnFactor } = require('./routePlanner');
const { RouteShare } = require('./routeShare');
const { JarvisClient } = require('./jarvisClient');
const { JarvisMemory } = require('./jarvisMemory');
const { HeadToHead } = require('./headToHead');
const { ConvoyCalendar } = require('./convoyCalendar');
const { advise } = require('./restAdvisor');
const { cityPoints } = require('./apiPlus');
const { RealWeather } = require('./realWeather');
const { state, mergeTelemetry, markDisconnected } = require('./state');
const { startDashboard } = require('./server');
const { RelayClient } = require('./remote');
const { TripLogger } = require('./tripLogger');
const { ConvoyManager } = require('./convoyManager');
const { scanLocal } = require('./localScanner');
const { evaluateRoute, readiness, truckLoadAdvice } = require('./convoyIntelligence');
const { AlertsManager } = require('./alertsManager');
const { DiscordNotifier } = require('./discordNotifier');
const { DispatchManager } = require('./dispatchManager');
const { PreflightManager } = require('./preflightManager');
const { BolManager } = require('./bolManager');
const { CareerManager } = require('./careerManager');
const { ConvoySessionManager } = require('./convoySessionManager');
const { VoiceDispatcher } = require('./voiceDispatcher');
const { LocalAi } = require('./localAi');
const { MapCalibration } = require('./mapCalibration');
const { RelayMonitor } = require('./relayMonitor');
const { ScreenshotJournal } = require('./screenshotJournal');
const { GapKeeper } = require('./gapKeeper');
const { TrackRecorder } = require('./trackRecorder');
const { EventsHub } = require('./eventsHub');
const { Leaderboard } = require('./leaderboard');
const { VtcManager } = require('./vtcManager');
const { ShiftAssistant } = require('./shiftAssistant');
const { PushNotifier } = require('./pushNotifier');
const { FunManager } = require('./funManager');
const { ConvoyRadio, TruckersMp } = require('./communityExtras');
const { truckSimTelemetry, getBuffer } = require('trucksim-telemetry');

const VERSION = require('../package.json').version;
const SHARED_MEMORY = 'Local\\SCSTelemetry';

function bufferHealth() {
  const buffer = getBuffer({ sharedMemoryName: SHARED_MEMORY });
  if (!buffer) return { open: false, bytes: 0, nonZeroBytes: 0 };

  let nonZeroBytes = 0;
  for (let i = 0; i < buffer.length; i++) {
    if (buffer[i] !== 0) nonZeroBytes++;
  }

  return {
    open: true,
    bytes: buffer.length,
    nonZeroBytes,
    first16: buffer.subarray(0, 16).toString('hex')
  };
}

// Keep what we share with the convoy compact (it is sent with every snapshot).
function shareableCapabilities(caps = {}) {
  const cap = (list, n) => (Array.isArray(list) ? list.slice(0, n) : []);
  return {
    mapStates: cap(caps.mapStates, 40), mapDlcTokens: cap(caps.mapDlcTokens, 40), dlcTokens: cap(caps.dlcTokens, 120),
    workshopIds: cap(caps.workshopIds, 200), localModNames: cap(caps.localModNames, 200), activeModRefs: cap(caps.activeModRefs, 200),
    gameVersion: caps.gameVersion || null
  };
}

async function main() {
  const config = loadConfig();
  const stream = new StreamHub();
  const trips = new TripLogger(config.driverName);
  const convoy = new ConvoyManager(config.driverName);
  const voice = new VoiceDispatcher(config.voice);
  const ai = new LocalAi(config.ai);
  const voicePacks = new VoicePacks(config.voicePack);
  const formation = new FormationCoach({ ...config.formation });
  const routePlans = new RoutePlans();
  const routeShare = new RouteShare();
  let restNow = { active: false }, factorCache = { at: 0, factor: 1.25 };
  const restStatus = () => restNow;
  const weather = new RealWeather(config.weather);
  const studio = new StreamStudio({ config, stream, voice });
  const routes = new TripRoutes();
  const obs = new ObsBridge({ config, stream, studio });
  const appMixer = new AppMixer({ config });
  const twitch = new TwitchBridge({ config, stream });
  stream.listen(ev => { twitch.live = studio.isLive(); twitch.onEvent(ev).catch(() => {}); });
  stream.listen(ev => { if (ev.type === 'crash') obs.onCrash().catch(() => {}); });
  const discord = new DiscordNotifier(config.discord, config.driverName);
  const alerts = new AlertsManager(config.alerts);
  const dispatch = new DispatchManager(config.driverName);
  const preflight = new PreflightManager();
  const bols = new BolManager(config.driverName);
  const sessions = new ConvoySessionManager(config.driverName);
  const career = new CareerManager(config.driverName, undefined, achievement => {
    voice.speak(`Achievement unlocked. ${achievement.name}.`, `achievement-${achievement.id}`, 0);
    discord.achievement(achievement);
    stream.onAchievement(achievement);
  });
  const journal = new ScreenshotJournal();
  trips.decorate = t => { t.screenshots = journal.between(t.startedAt, t.endedAt).map(s => s.name); };
  const shift = new ShiftAssistant();
  const push = new PushNotifier(config.push);
  const radio = new ConvoyRadio(config.driverName);
  const tmp = new TruckersMp(config.truckersmp, next => { saveConfigSection('truckersmp', next); config.truckersmp = next; });
  let tmpShare = null;
  const refreshTmp = () => tmp.player().then(p => { tmpShare = p.found ? { id: p.id, name: p.name, vtc: p.vtc?.tag || null } : null; }).catch(() => {});
  refreshTmp();
  setInterval(refreshTmp, 30 * 60000).unref?.();
  const fun = new FunManager({ trips, career, discord, journal, settings: config.fun });
  const gap = new GapKeeper(config.alerts);
  const tracks = new TrackRecorder();
  const together = new (require('./convoyTogether').ConvoyTogether)();
  const events = new EventsHub({ sessions, preflight, driverName: config.driverName, discord, voice });
  const leaderboard = new Leaderboard({ trips, discord, driverName: config.driverName });
  const vtc = new VtcManager({ driverName: config.driverName, dispatch });
  let myStatsCache = { at: 0, value: null };
  const driverStats = () => { if (Date.now() - myStatsCache.at > 60000) myStatsCache = { at: Date.now(), value: leaderboard.mine() }; return myStatsCache.value; };
  const calibration = new MapCalibration();
  const relay = new RelayMonitor(config);
  const relayClient = new RelayClient(config);
  const jarvisMemory = new JarvisMemory();
  const headToHead = new HeadToHead();
  const calendar = new ConvoyCalendar(config.calendar);
  const jarvis = new JarvisClient({ config, relayClient, memory: jarvisMemory });
  relay.usage = () => relayClient.stats();
  relay.follow(() => relayClient.activeEndpoint());
  relayClient.onSwitch(({ index }) => {
    relay.check();
    voice.speak(index === 0 ? 'Back on the main convoy relay.' : 'Main relay is down. Switched to the backup relay.', 'relay-switch', 0);
  });
  relay.start();
  const peerPointsAt = new Map();
  let localScan = scanLocal();
  convoy.setLocalCapabilities(localScan.capabilities);

  const intelligence = {
    getScan: () => localScan,
    rescan: () => {
      localScan = scanLocal();
      convoy.setLocalCapabilities(localScan.capabilities);
      return localScan;
    },
    getReadiness: () => readiness(convoy.getRoster(), localScan),
    evaluateRoute: (origin, destination) => evaluateRoute(origin, destination, convoy.getRoster()),
    getTruckLoadAdvice: (profile) => truckLoadAdvice(state.truck, state.job, profile)
  };

  // Event wiring: dispatch completion → BOL + career; trips → Discord; alerts → voice.
  dispatch.on('stopCompleted', (item, stop) => voice.speak(`Stop completed at ${stop.destination || 'destination'}.`, `stop-${stop.id}`, 0));
  dispatch.on('completed', item => {
    vtc.onDispatchCompleted(item);
    bols.createFromDispatch(item, state.truck);
    career.recordDispatch(item);
    voice.speak('Dispatch complete. Bill of lading saved.', 'dispatch-complete', 0);
  });
  dispatch.on('cancelled', item => voice.speak(`Dispatch cancelled. ${item.title || ''}`, 'dispatch-cancelled', 0));
  trips.onFinish(trip => fun.onTrip(trip));
  trips.onFinish(trip => stream.onTripFinished(trip));
  trips.onFinish(trip => routes.onTripFinished(trip));
  trips.onFinish(trip => push.send('trips', trip.status === 'delivered' ? `Delivered: ${trip.cargo || 'cargo'}` : `Job ${trip.status}`, `${trip.originCity || '?'} → ${trip.destinationCity || '?'} · ${Math.round(trip.deliveredIncome || 0).toLocaleString('en-US')} · ${(trip.milesDriven || 0).toFixed(0)} mi${trip.eco ? ` · eco ${trip.eco.grade}` : ''}`, { key: `trip-${trip.id}`, cooldownMs: 0, tags: [trip.status === 'delivered' ? 'package' : 'warning'] }));
  trips.onFinish(trip => discord.tripSummary(trip, trip.speedingEvents ?? null, (trip.screenshots || []).slice(-3).map(n => journal.file(n)).filter(Boolean)));
  alerts.onRaised(alert => {
    if (alert.id.startsWith('event-')) push.send('convoy', alert.title, alert.detail, { key: alert.id, priority: 4, tags: ['calendar'] });
    else if (alert.severity === 'critical' && alert.id !== 'overspeed') push.send('critical', alert.title, alert.detail, { key: `alert-${alert.id}`, priority: 5, tags: ['rotating_light'] });
    if (alert.id === 'overspeed' && alert.severity !== 'critical') return;
    // Browser Co-Driver owns adjustable spoken speed warnings; keep these visual alerts.
    if (alert.id !== 'overspeed') voice.speak(`${alert.title}. ${alert.detail}`, `alert-${alert.id}`, alert.severity === 'critical' ? 60000 : 300000);
  });

  console.log('==============================================');
  console.log(` KAW'S ATS PLAYGROUND Companion v${VERSION}`);
  console.log(` Driver: ${config.driverName}`);
  console.log(` Pairing: ${config.pairingCode ? 'CONFIGURED' : 'NOT CONFIGURED'}`);
  console.log(` Shared memory: ${SHARED_MEMORY}`);
  console.log(' Trip Logger + Earnings: ENABLED');
  console.log(` Driver Alerts: ${config.alerts.enabled ? 'ENABLED' : 'DISABLED'}`);
  console.log(' Dispatch / BOL / Career: ENABLED');
  console.log(' Convoy Center + Pre-Flight + Sessions: ENABLED');
  console.log(' Convoy Intelligence + DLC/Mod Scanner: ENABLED');
  console.log(` Voice Dispatcher: ${config.voice.enabled ? 'ENABLED' : 'DISABLED'}`);
  console.log(` Discord Trip Summaries: ${discord.ready() ? 'ENABLED' : 'NOT CONFIGURED'}`);
  console.log('==============================================');

  startDashboard(config.dashboardPort, config.dashboardHost, state, trips, convoy, intelligence,
    { alerts, dispatch, preflight, bols, career, sessions, voice, ai, discord, config, calibration, relay, journal, gap, tracks, together, events, leaderboard, vtc, shift, push, fun, radio, tmp, stream, studio, routes, obs, appMixer, twitch, voicePacks, formation, routePlans, weather, routeShare, restStatus, jarvis, jarvisMemory, headToHead, calendar, driverStats });

  const telemetry = truckSimTelemetry({
    sharedMemoryName: SHARED_MEMORY,
    onUpdate: (data) => {
      const wasConnected = state.connected;
      mergeTelemetry(data);
      trips.observe(state);
      convoy.updateLocal(state);
      dispatch.observeTelemetry(state);
      alerts.evaluate(state);
      shift.evaluate(state);
      fun.observe(state, shift.get());
      stream.observe(state);
      routes.observe(state);
      obs.tick(state);
      twitch.observe(state);

      if (!wasConnected && state.connected) {
        console.log('[TELEMETRY] Live ATS data received.');
      }
    }
  });

  telemetry.on('connected', () => {
    console.log('[TELEMETRY] SCS SDK connected.');
    state.connected = true;
    voice.speak('Telemetry connected.', 'telemetry-connected');
  });

  telemetry.on('disconnected', () => {
    console.log('[TELEMETRY] SCS SDK disconnected.');
    markDisconnected();
    alerts.evaluate(state);
  });

  telemetry.on('job-started', data => {
    console.log('[EVENT] Job started.');
    if (data && data.sdkActive !== undefined) mergeTelemetry(data);
    trips.start(state, 'job-started-event');
    shift.resetScore();
    stream.onJobStarted(state.job);
    routes.onJobStarted();
    if (calibration.learn(state.job?.originCity, state.positioning)) { calibration.save(); console.log(`[MAP] Learned ${state.job.originCity} (${calibration.status().cities} cities).`); }
    dispatch.observeTelemetry(state);
    voice.speak(`Job started. ${state.job?.cargo || 'Cargo'} from ${state.job?.originCity || 'origin'} to ${state.job?.destinationCity || 'destination'}.`, 'job-started', 0);
  });

  telemetry.on('job-delivered', data => {
    console.log('[EVENT] Job delivered.');
    const trip = trips.finish('delivered', state, data);
    if (calibration.learn(trip?.destinationCity || state.job?.destinationCity, state.positioning)) { calibration.save(); console.log(`[MAP] Learned ${trip?.destinationCity || state.job?.destinationCity} (${calibration.status().cities} cities).`); }
    if (dispatch.getActive()) {
      dispatch.completeCurrentStop({
        actualMiles: trip?.milesDriven,
        actualIncome: trip?.deliveredIncome,
        damagePercent: (Number(trip?.endCargoDamage) || 0) * 100
      });
    }
  });

  telemetry.on('job-cancelled', data => {
    console.log('[EVENT] Job cancelled.');
    trips.finish('cancelled', state, data);
    const active = dispatch.getActive();
    if (active) dispatch.cancel(active.id);
  });

  let lastHealth = '';
  setInterval(() => {
    const h = bufferHealth();
    const status = !h.open
      ? 'MISSING'
      : h.nonZeroBytes === 0
        ? 'OPEN / ALL ZERO'
        : `OPEN / ${h.nonZeroBytes} NONZERO BYTES`;

    if (status !== lastHealth) {
      console.log(`[MEMORY] ${status}`);
      lastHealth = status;
    }
  }, 2000);

  // Local snapshot for tools and diagnostics (fast, never leaves this PC).
  setInterval(async () => {
    try {
      await fs.mkdir(path.join(process.cwd(), 'data'), { recursive: true });
      await fs.writeFile(path.join(process.cwd(), 'data', 'latest-telemetry.json'), JSON.stringify(state, null, 2), 'utf8');
    } catch (error) {
      console.error('[SNAPSHOT]', error.message);
    }
  }, config.snapshotIntervalMs);

  // Convoy relay sync: slower and slimmer, because every byte here counts against the relay's bandwidth.
  let relayBusy = false;
  setInterval(async () => {
    if (relayBusy) return;
    relayBusy = true;
    try {
      const remoteResult = await relayClient.send({
        ...state,
        trip: trips.getCurrent(),
        // Convoy Hub sharing: DLC/mod list, the active convoy mod pack, and map calibration.
        capabilities: config.sharing.mods ? shareableCapabilities(localScan.capabilities) : undefined,
        convoyManifest: config.sharing.manifest ? preflight.getActive() || undefined : undefined,
        mapPoints: calibration.shareable(),
        location: calibration.locate(state.positioning) || undefined,
        convoyEvents: events.shareable(),
        rsvps: events.rsvps,
        driverStats: driverStats(),
        vtc: vtc.shareable() || undefined,
        vtcProgress: vtc.shareableProgress(),
        convoyRadio: radio.station || null,
        sharedRoute: routeShare.shareable(),
        together: together.shareable(),
        h2h: headToHead.shareable(driverStats()?.week?.key || ''),
        tmp: tmpShare,
        publicLive: Boolean(config.fun.publicLive),
        stream: studio.block()
      });
      studio.onInbox(remoteResult?.streamInbox);
      if (!remoteResult?.skipped) relay.pushResult(true);
      for (const peer of remoteResult?.roster || []) {
        if (!peer?.driverName || require('./remote').isSelf(peer, relayClient, config.driverName)) continue;
        convoy.ingestPeer({ id: peer.id, driverName: peer.driverName, companionVersion: peer.companionVersion, ...(peer.telemetry || {}), relaySeenAt: peer.updatedAt || null });
        const last = peerPointsAt.get(peer.driverName) || 0;
        if (Array.isArray(peer.telemetry?.mapPoints) && Date.now() - last > 60000) {
          peerPointsAt.set(peer.driverName, Date.now());
          if (calibration.mergePeerPoints(peer.telemetry.mapPoints)) calibration.save();
        }
      }
    } catch (error) {
      relay.pushResult(false, error.message);
      console.error('[RELAY]', error.message);
    } finally {
      relayBusy = false;
    }
  }, config.remote.intervalMs);

  // Convoy loop: gap keeper and event reminders feed the alerts engine; weekly recap; company sync.
  let convoyTick = 0, seenOnline = null, seenJobsReady = false;
  const seenJobs = new Set();
  setInterval(() => {
    try {
      const roster = convoy.getRoster();
      gap.settings = alerts.settings;
      alerts.setExternal('gap', gap.evaluate(roster, events.activeEvent(roster)));
      formation.settings = { ...formation.settings, gapWarnMiles: alerts.settings?.gapWarnMiles };
      formation.evaluate(roster, gap.status().leader);
      alerts.setExternal('formation', formation.alerts());
      // Together: lost contact, wrong turn, catch-up, regroup, roll call, who's missing, convoy line.
      alerts.setExternal('together', together.evaluate({ roster, leader: gap.status().leader, formation: formation.status(), gapWarnMiles: alerts.settings?.gapWarnMiles, state, privacy: state.buildPrivacy, locate: p => calibration.locate(p), events: convoyTick % 6 === 0 || !together.eventsCache ? (together.eventsCache = events.list(roster)) : together.eventsCache }));
      // Rest-stop alarm: name a place ahead before the game's own rest warning.
      if (Date.now() - factorCache.at > 300000) factorCache = { at: Date.now(), factor: learnFactor(trips.getRecent(1000)).factor };
      restNow = advise({ state, geo: calibration.locate(state.positioning), cities: cityPoints(), plan: routeShare.active, factor: factorCache.factor, warnMinutes: Number(alerts.settings?.fatigueWarnMinutes) || 60 });
      alerts.setExternal('rest', restNow.alert ? [restNow.alert] : []);
      if (convoyTick % 6 === 0) alerts.setExternal('events', events.tick(roster, localScan.capabilities || {}));
      fun.observeConvoy(events.activeEvent(roster), state, gap.status(), roster);
      if (convoyTick % 120 === 0) { leaderboard.maybeRecap(roster); vtc.syncFromRoster(roster); }
      // Push: drivers coming online, new company jobs for me.
      const onlineNow = new Set(roster.filter(r => r.online && !r.isLocal).map(r => r.driverName));
      if (seenOnline) for (const n of onlineNow) if (!seenOnline.has(n)) stream.onConvoyJoin(n);
      if (seenOnline) for (const n of onlineNow) if (!seenOnline.has(n)) push.send('friends', `${n} is online`, `${n} just started driving on the convoy relay.`, { key: `online-${n}`, cooldownMs: 30 * 60000, priority: 2, tags: ['wave'] });
      seenOnline = onlineNow;
      if (convoyTick % 6 === 0) {
        const jobs = vtc.incoming(roster).filter(a => !a.myStatus && a.status === 'assigned');
        for (const a of jobs) if (!seenJobs.has(a.id)) { seenJobs.add(a.id); if (seenJobsReady) push.send('jobs', `New job from ${a.company?.name || a.dispatcher}`, `${a.origin || '?'} → ${a.destination || '?'} · ${a.cargo || 'cargo'} · ${Math.round(a.pay || 0).toLocaleString('en-US')}`, { key: `job-${a.id}`, cooldownMs: 0, priority: 4, tags: ['clipboard'] }); }
        seenJobsReady = true;
      }
      convoyTick++;
    } catch (e) { console.error('[CONVOY]', e.message); }
  }, 5000);
  tracks.start(() => convoy.getRoster(), () => events.activeEvent(convoy.getRoster())?.id || null);

  // Convoy session roster snapshots, once a minute while a session is active.
  setInterval(() => { try { sessions.snapshot(convoy.getRoster()); } catch (e) { console.error('[SESSION]', e.message); } }, 60000);

  setInterval(() => {
    try {
      localScan = scanLocal();
      convoy.setLocalCapabilities(localScan.capabilities);
    } catch (e) {
      console.error('[INTELLIGENCE]', e.message);
    }
  }, 300000);

  console.log('[INTELLIGENCE] Local DLC/mod scan complete.');
  console.log(`[INTELLIGENCE] Map DLC detected: ${localScan.dlc?.map?.length || 0}`);
  console.log(`[INTELLIGENCE] Local mods detected: ${localScan.mods?.local?.mods?.length || 0}`);
  console.log(`[PREFLIGHT] Active convoy manifest: ${preflight.getActive()?.name || 'NONE'}`);
  console.log('[COMPANION] Waiting for ATS telemetry...');
  console.log(`[COMPANION] Open http://${['0.0.0.0', '::'].includes(config.dashboardHost) ? '127.0.0.1' : config.dashboardHost}:${config.dashboardPort} in your browser`);
}

main().catch(error => {
  console.error('[FATAL]', error);
  process.exit(1);
});
