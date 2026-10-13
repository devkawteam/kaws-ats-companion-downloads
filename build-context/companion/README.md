# KAW'S ATS Playground Companion v1.6.0

The Windows Companion for KAW'S American Truck Simulator convoy community.

The installer includes the private runtime and telemetry plugin. Drivers do not need to install Node.js, Python, Visual Studio, npm or PM2.

Use the desktop or Start Menu shortcut after installation. The local dashboard opens at `http://127.0.0.1:4280` and can optionally be shared with phones and tablets on the same private Wi-Fi.

For Companion CB access, run `/cb pair` in KAW Gaming and enter the temporary pairing code in the Companion.

## What's new in v1.6.0

### Convoy Hub — the answer to "can we all convoy?"
- **Who's on & where:** a live US map with every convoy driver. The map calibrates itself: each pickup and delivery teaches the Companion where ATS cities are, and convoy members share those points, so positions show as "Near Las Vegas, NV" after only a few deliveries.
- **Who has what DLC:** a DLC matrix for every online driver, plus a map shaded by the states **everyone** can drive. Missing a state? One click opens it on Steam.
- **Where can we go:** the best connected convoy area everyone owns, and warnings when drivers are on different game versions.
- **What mods do I need:** the convoy host's mod pack (Convoy Pre-Flight manifest) is shared with the convoy. Each driver sees exactly which mods they are missing, with **Open in Steam** / **Workshop page** / **Download** buttons, the required DLC, and the load order. "Use this pack" saves it as your own pre-flight check.
- Privacy: "Share my DLC & mods" and "Share my mod pack" toggles on the hub (on by default). Location follows the existing "share location" privacy setting.

### Driver tools
- **Driver alerts:** low fuel, rest needed (ATS fatigue timer), truck and cargo damage, speeding, running late for the delivery deadline, and dashboard warning lights — with a US speed-limit sign and a live status strip on every page.
- **Dispatch & bills of lading:** jobs become dispatches automatically, or plan multi-stop runs yourself; a printable BOL is saved for each completed dispatch.
- **Career:** levels, XP and achievements.
- **Earnings:** income per day, $/mile, fuel economy, top cargo and routes, records, and CSV export of every trip.
- **Convoy sessions:** plan a convoy with meet point, departure time and checkpoints.
- **Discord trip summaries:** paste a channel webhook on the Alerts & Discord page to post a card after every delivery (and achievement unlocks). The webhook stays in your local config.json.
- **Voice dispatcher:** optional Windows speech for job events and critical alerts.

### Customize & multi-screen
- Settings → **Multi-screen setup** opens the Driving HUD, Navigation screen, Convoy map, Alerts board, Dispatch board or CB radio on another monitor or tablet.
- Choose which readouts appear in the top strip, hide menu pages you do not use, compact menu, and a one-click light/dark switch.

### CB radio & relay backup
- The CB page checks the convoy relay and explains when it is down (for example a Render workspace suspended for bandwidth) with the steps to fix it. The CB address follows the active relay.
- **Automatic failover:** add a backup relay under Settings → CB & relay backup (or `remote.backupEndpoints` in config.json). If the main relay stops answering, every driver moves to the backup within seconds and moves back when the main relay returns. Free backup setup: `relay-server/BACKUP-RELAY.md` (Oracle Cloud Always Free).
- **Discord fallback:** when no relay is reachable, the CB page shows **Join ATS Convoy voice on Discord** (KAW Gaming → ATS Convoy) plus a server invite for new drivers. Both links can be changed in Settings.
- **Much lower bandwidth:** the Companion syncs with the relay every 3 s with a slim, compressed payload (about 93% less traffic than v1.5.1).

### New config.json sections (all optional)
```json
"voice":   { "enabled": false, "rate": 0, "volume": 85, "prefix": "KAW Dispatch" },
"discord": { "enabled": false, "webhookUrl": "", "tripSummaries": true, "achievements": true, "includeIncome": true },
"alerts":  { "enabled": true, "lowFuelPercent": 15, "fatigueWarnMinutes": 60, "damageWarnPercent": 10, "cargoDamageWarnPercent": 5, "overspeedToleranceMph": 3, "deadlineWarnMinutes": 60 },
"sharing": { "mods": true, "manifest": true },
"cb":      { "discordVoiceUrl": "https://discord.com/channels/1214348167609581599/1532852330721050664", "discordInviteUrl": "https://discord.gg/AWNUYJtpFd" },
"remote":  { "enabled": true, "endpoint": "https://…/api/telemetry", "intervalMs": 3000, "backupEndpoints": [] }
```
All of these can also be changed from the dashboard (on the PC running the Companion).

### Community & convoy extras
- **Steam Workshop auto-fill:** paste a Workshop link or ID in a mod pack and the real name, size and last-update date come from Steam. Drivers see thumbnails, subscriber counts, and a warning when a mod was **updated on Steam after the pack was made**, removed from the Workshop, or is not an ATS item.
- **DLC helper:** your personal shopping list on the Convoy Hub, ranked by what opens up the most shared map — with live Steam prices and sale badges — plus what other drivers are missing (★ = the only one missing it).
- **Convoy events & RSVP:** plan a convoy on Convoy Sessions and everyone on the relay sees it with Going / Maybe / Can't buttons. Reminders 30 and 5 minutes before departure, with a pre-flight check against the host's mod pack; the host's Discord gets an announcement and a reminder.
- **Gap keeper:** pick a convoy leader on the Convoy Hub (or the event host leads automatically). Followers get "close up the gap", the leader gets "X is falling behind" / "X has stopped". Distance limit: `alerts.gapWarnMiles` (default 2).
- **Live trails & convoy replay:** the Convoy Hub map shows everyone's last 45 minutes; running convoys are recorded and can be replayed from Convoy Sessions with a timeline.
- **Leaderboards & seasons:** this week, last week, season (calendar month) and all time — miles, income, deliveries, clean loads, eco score and least speeding. Optional weekly Discord recap every Monday.
- **Company (virtual trucking company):** a dispatcher creates a company and assigns loads to drivers; drivers accept them into their Dispatch page; deliveries flow back into the company bank (company cut) and payroll.
- **Eco-driving score:** every trip is graded (speeding, harsh braking, high RPM, idling, cruise use) with tips — live in the status strip, on Earnings, and on the Discord trip card.
- **Screenshot journal:** screenshots you take in ATS (F10) are attached to the trip you were on, shown on the Journal page, and the best three go with the Discord trip summary.
- **Streamer overlay:** Settings → Streamer overlay builds a transparent OBS Browser Source link (`/overlay.html?w=speed,route,alerts,convoy,eco,map&pos=bl`). No ATS mods needed.

### Voice co-driver, smart shifting & more fun
- **Voice Co-Driver** (Drive → Co-Driver): ask out loud or type — how far, ETA, what gear, speed limit, when do I rest, fuel, can I make it, am I on time, damage report, status, alerts, who's online, where is *driver*, how far behind the leader, next convoy, earnings, eco score, jokes and trucking facts. Say **regroup / fuel stop / rest stop / hold position / depart / emergency stop** to command the convoy, or **economy / balanced / power mode** to change shifting. Push-to-talk key, wheel button, on-screen mic, or the hands-free wake word "co-driver…". Four personalities: Standard, **CB Trucker**, Calm and Drill Coach.
- **Automatic callouts**: speed limit changes, speeding, miles-to-go (100/50/25/10/5/1), halfway, rest (2h/1h/30m/15m), fuel (25/15/10/5%), damage and cargo hits, shift calls, drivers joining/leaving, convoy gap and event reminders, new jobs, and the fuel/rest plan at the start of each job — each category can be switched off.
- **Smart shift assistant**: uses your truck's real gear ratios, differential and tyre size to compute the RPM in every gear at your speed, then recommends the best gear (auto Economy / Balanced / Power by load, throttle and hills), with downhill engine-brake and lugging hints, a shift-quality score, a big shift HUD on the Drive page and an OBS overlay widget.
- **Fuel & rest planner**: can you make the destination before you must sleep or refuel, and will you be on time — with a combined-stop tip.
- **Phone push** via the free ntfy app (critical alerts, convoy reminders, company jobs, friends online, delivery summaries) and desktop notifications.
- **Daily challenges** (3 a day, XP rewards), **milestones** (odometer, career miles and loads) and **delivery celebrations** with confetti and the co-driver's voice.
- **Convoy achievements** (Convoy Rookie → Legend, Perfect Formation, Convoy Long Haul, Big Rig Parade) with a convoy log; **company colours, logo and driver ranks** (Rookie → Legend).
- **Convoy radio**: pick an internet radio station and share it — everyone can tune in from the CB page (audio streams from the station, not the relay).
- **TruckersMP**: your profile (auto-detected Steam account or entered ID), convoy members' TMP profiles, live ATS server populations and a suggested convoy server.
- **Public live page** on the relay (`/live/<code>`), opt-in per driver, safe to post in Discord.
- **Convoy photo wall**: optionally post your screenshots to Discord during convoy events.

### Hosting the relay on your own domain
See `relay-server/HOSTING.md` — run the relay at `https://ats.kawsplayground.online` on a free Oracle Cloud VM with one command (`relay-server/deploy/setup-oracle.sh`), keeping Render as the automatic backup.
