# KAW's ATS Playground Companion v1.7.1 — convoy release

Being together on the road is what the convoy is for. This update fixes drivers not seeing each other on the map
and tracker, and adds tools for staying together.

## Fixes: see each other in the convoy
- **Drivers with the same name no longer hide each other.** Each install now has its own convoy ID, so two drivers
  named alike (e.g. both “User” or “ATS Driver”) both show on the map and tracker.
- **No more false green light.** If the convoy relay refuses your Companion (missing or wrong relay key) or convoy
  sharing is off, the top bar now says **Not in convoy** / **Sharing off** instead of showing “online”.
- **Can my convoy see me?** — a checklist on the Convoy, Radar, Hub and Navigation pages: sharing, relay accepted,
  convoy code, location sharing, your position and who else is online, each with the fix.
- **Join a convoy** right in the app: sharing on/off, convoy code and relay key (no Discord link needed).
- Connect links that still carry the old blocked relay address now use the working relay straight away.
- Drivers who close the game drop off the map after about 30 seconds (it used to take over a minute).
- The sidebar, footer and diagnostics now show the right version.

## New: convoy together (Convoy page)
- **Invite a friend** — a one-click join link and QR code with your convoy code (and relay key). Share it only with friends.
- **Who's missing** — drivers who RSVP'd to the convoy but aren't on the map, with the likely reason.
- **Roll call** — the leader starts it; every Companion answers automatically (in truck, job loaded, sharing
  location, destination) and drivers press **I'm ready**.
- **Lost contact** — “Dusty dropped out of the convoy, last seen near Reno doing 58 mph”, spoken by the Co-Driver,
  and “back in the convoy” when they return.
- **Convoy line on the map** — everyone joined in driving order, coloured by gap (green / yellow / red). New map
  framing: **Whole convoy** and **Follow the convoy leader**.
- **Catch-up guidance** — how far behind the leader you are, a target speed and how long to close up. It never asks
  you to go over the speed limit.
- **Wrong-turn warning** — when someone keeps getting further from the leader while heading another way.
- **Regroup point** — set it at your position or a city; everyone sees the pin, their distance and ETA, and hears it once.
- **Convoy screen for a phone or tablet** — a full-screen convoy map (pair the device in Devices & Screens first).
- **Replay the last 45 minutes** of the convoy — no planned event needed.

## Good to know
- Catch-up and wrong-turn tips need a convoy leader (choose one on the Convoy Hub, or join a convoy event).
- Everyone should update to v1.7.1 to see and answer roll calls and regroup points.
- The wrong-turn warning is a hint from direction and distance, not the in-game route.
