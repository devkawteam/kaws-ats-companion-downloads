# New in v1.7: road tools and community features

Everything is free and runs on your PC. The only optional internet feature is Real Weather (weather.gov), which is off until you turn it on.

## Route Planner (Drive → Route Planner)

- **Stops:** plan a run with up to 12 stops, or press **Use my current job**.
- **What you get:**
  - each leg with its miles and driving time;
  - where you'll need to **sleep** and **refuel**, starting from your truck's live fuel and rest timer;
  - the route drawn on the **ATS game map**.
- **Map DLC:** states you don't own are flagged (it checks the map DLC in your game folder).
- **Distances:** these are estimates between cities. There is no road data in the Companion, so legs are straight lines × a road factor.
  - The factor **learns from your deliveries**: once you've delivered between at least 3 pairs of known cities, it matches the game's own job distances.
  - Use the in-game GPS for the actual roads.
- **Saving and sharing:** save plans, reopen them, or **Copy for Discord**.

## Formation Coach (Convoy → Formation Coach)

- Shows the convoy's running order behind the leader, each driver's **time gap** to the truck ahead, and a formation score.
- **Your tip:** "Too close, ease off", "Close up, try 64 mph", "Good spacing", or, for the leader, who is falling behind.
- **Target gap:** 4 seconds by default; adjustable from 2 to 10 seconds. Following too closely for 8 seconds raises a normal alert.
- **Spoken tips:** optional, using the device's built-in voice.
- **Leader:** chosen on the Convoy Hub, or the host of the active convoy event.

## Photo Mode (Stream → Photo Mode)

- **Game clock:** shows the light phase (night, blue hour, golden hour, daylight) and a countdown to the next golden hour. The countdown is shown in game time and in real minutes, measured from how fast your game clock runs.
- **Shot ideas:** based on your truck, your load and where you are.
- **Shot list:** a classic list to tick off, saved on this device.
- **Screenshots:** your latest ATS screenshots.
- Light times are approximate.

## Weekly challenges (Career page)

- **The board:** four bigger goals every Monday–Sunday (ISO week), for example:
  - deliver into 4 states;
  - 15 deliveries;
  - a perfect-formation convoy;
  - 5 screenshots.
- **XP:** each one is awarded once and posted as a moment (and to Discord, if set up).
- **History:** past weeks show as stars.
- **Settings:** the same switch as daily challenges.

## Setup Sharing (Drive → Setup Sharing)

- **Your card:** made from the game and your **Under the Hood** build profile, as a picture for Discord plus a short `KAWSETUP1.` code.
- **Compare:** paste a friend's code to compare rigs side by side. Differences are highlighted.
- **Garage:** keep friends' setups in your garage, stored on this device.
- **Privacy:** codes never include your licence plate, position or account details. Pasted codes are strictly checked.

## Real Weather (Drive → Real Weather)

- **Data:** real-world weather where your truck is in ATS, from the US National Weather Service (free, no key):
  - the current forecast and the next hours;
  - active alerts;
  - a role-play driving tip.
- **Radar:** NOAA weather radar over the ATS game map.
- **Privacy:** off by default. When on, only the real-world point matching your game position, rounded to about a mile, goes to api.weather.gov. Radar images load from NOAA. Results are cached for 10 minutes.

## Convoy route sharing (Drive → Route Planner)

- Plan a route and press **Share with convoy**. Everyone on your convoy relay sees it under **Convoy routes**, can show it on their map, and can **Follow** it.
- The route travels in the relay's cached data and needs no relay update. Routes from other drivers are strictly checked before they are shown.

## Rest-stop alarm

- About 30 minutes before the game's own "rest soon" warning, the co-driver names a place ahead where you can sleep.
- It prefers the next stop on the plan you **Follow**. Otherwise it picks a town ahead of you on the map.
- If no town is reachable in time, it tells you to look for a rest area sooner.
- **How the estimate works:** distance uses the planner's learned factor, and time uses the game's own navigation pace. It shows on the Route Planner and is spoken like other alerts.

## Delivery Replay (Work → Delivery Replay)

- Play a finished delivery back on the ATS game map. You get a timeline you can drag, playback at 30–300×, speed and miles at each moment, and 📸 markers where you took screenshots.
- The route is coloured by speed: green under 60, amber 60–70, red over 70 mph.
- New trips also record speed and odometer. Older trips replay with estimated miles.
- **Stream recap card** opens the existing OBS outro for the same trip.

## Fuel & Money (Work → Fuel & Money)

- **Totals:** income, estimated fuel cost, net, mpg and cost per mile, over 7, 30 or 90 days or all time.
- **Breakdowns:** a daily net chart, plus your most profitable cargo, routes and trucks, and your best and worst trips.
- **Fuel price:** fuel cost = gallons burned × your fuel price setting, because the Companion can't see what you paid. The default is $4.20/gal.

## Livery gallery (Setup → Livery Wizard → Gallery)

- Save paint jobs on your PC with a thumbnail. You can open them again, or download/share them as `.kawlivery.json` files.
- Friends open a shared file with **Open project file…**.

## Career badges image (Career page → Share my career)

- A 1200×630 picture of your level, XP, badges and weekly-challenge stars.
- Download it, copy it, or share it to Discord.

## Map Pack Check (Setup → Map Pack Check)

- Shows which ATS states you own, read from the map DLC files in your game folder.
- Lists which states are needed by your current job, saved and followed plans, shared convoy routes, convoy events, and friends driving now. Missing ones are highlighted.

## Jarvis extras (Jarvis page → Jarvis extras)

- **"Hey Jarvis"** (off by default): say "Hey Jarvis" while the dashboard is open to start a conversation.
  - While it's on, the browser's online speech service listens for the phrase, and the mic badge shows 👂.
  - It steps aside during conversations and stops if the browser blocks the mic.
- **Trip briefing** (off by default): when you take a job, Jarvis gives a short spoken briefing (load, distance, time, deadline, sleep and fuel stops, map DLC warnings, real weather if on, convoys within 24 h).
  - It's built from the Companion's own data, so no AI is needed. **Brief me now** works any time.
- **Co-pilot voice:** Co-Driver alerts in Jarvis's chosen voice. Only the voice changes.
- **What Jarvis remembers:** say "remember that…" or add items on the page.
  - Up to 12 short items, stored only on this PC (`data/jarvis-memory.json`), with edit, delete and "Forget everything".
  - Emails, phone or card numbers, passwords and street addresses are refused.

## Jarvis on phones and tablets

- A paired phone or tablet can chat with Jarvis.
- The microphone needs the secure (https) link; typing works on the normal link.
- Paired devices can't see or change what Jarvis remembers, or any settings.

## Jarvis in Discord

The Discord bot can answer `/jarvis ask` and @mentions in ONE channel. It's the same public Jarvis, with the same limits. Setup is in `relay-server/JARVIS.md`.

## Radio DJ Jarvis (Companion CB page → Radio DJ Jarvis)

- While the convoy radio plays, Jarvis drops in every 10–30 minutes, and welcomes drivers who join. The music gets quieter while he talks.
- He covers trip progress, rest, the online count, upcoming convoys and real weather. Off by default.

## Convoy Calendar (Convoy → Convoy Calendar)

- **What's listed:** the next 30 days of Companion convoy events plus up to 3 **public** calendar links (iCal / Google Calendar public address).
- **Per event:** RSVP, a 🔔 reminder (alert plus a spoken heads-up 30 and 10 minutes before), and 📅 to add it to your own calendar (.ics).

## Head-to-Head (Convoy → Head-to-Head)

- Weekly races with friends on your relay: most miles, deliveries, clean deliveries or income.
- Challenge a friend, they accept, and both of you see live bars.
- It uses the weekly stats Companions already share.

## Driving mode and colours (🚚 button at the top, Settings → Display)

- **Driving mode:** bigger text, larger buttons and stronger contrast for glancing at a second screen.
- **Colour-blind-friendly colours:** blue and orange instead of green and red.
- Saved per browser.

## Trip photo album (Work → Delivery Replay → 📸 Photo album)

One 1600×1000 picture of a trip: the route coloured by speed, cargo, miles, time, pay and date, plus up to six of that trip's screenshots. Download it or share it.

## Preview updates (Settings → Companion app → Preview updates)

- **Applies to:** a preview run from a git copy (like `Start KAW Companion PREVIEW`). The Companion checks the branch on GitHub and **Update now** pulls the changes and restarts.
- **Safety:** fast-forward only, it refuses if the copy has local changes, it runs fixed git/npm commands only, and it works on that PC only.
- **Installed copies:** these still update through the normal installer.
