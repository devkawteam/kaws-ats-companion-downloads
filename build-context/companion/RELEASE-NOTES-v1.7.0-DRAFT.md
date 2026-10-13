# KAW's ATS Playground Companion v1.7.0 — release notes (DRAFT, not released)

Everything in the v1.7.0 betas (route planner, formation coach, photo mode, Jarvis, voice conversation and more — see NEW-IN-1.7.md), plus:

## Talking to Jarvis
- **Pause before answering** slider next to Start / Stop conversation (1–8 seconds, default 3, saved on each device). Jarvis now waits for you to finish when you pause mid-sentence. It is waiting time, not microphone volume or sensitivity. **Done speaking** sends right away.
- **Natural voices** (free, generated on KAW's PC): 28 American and British English voices such as Michael and George, with a Play sample button. Each driver picks their own; the choice is saved on that device. If KAW's PC is off, busy or the fair-use limit is reached, your browser voice is used automatically.
- Stop now also drops the rest of a long reply instead of finishing it sentence by sentence.
- Jarvis can give **real current weather** for US towns (National Weather Service observation with time and units) and says so when he can't.
- Jarvis understands KAW's ATS Playground when voice typing hears “Kaws”, “Calls” or “Cause” Playground, and uses KAW's approved community information first when it is connected. He says when live community information isn't available instead of guessing.

## New here
- **First-use tour** (Skip, Back/Next, Finish, keyboard arrows, Esc) and **Help / How to use** with fixes for microphone, speech, voice and connection problems. Replay the tour from Help. The tour never turns on the microphone or plays sound, and doesn't start by itself while you're driving.
- **Connection lights** in the top bar: Jarvis, CB relay and Community knowledge. Click one for details.
- A short **welcome greeting** once per visit (respects Speak off, quiet hours and “ATS voice only”; it waits for your first click because browsers block sound before that).

- **Privacy & disclaimers** (Setup → Privacy & disclaimers, also linked from Help and the footer): how AI, data, Discord links, mods and community recording work. It does not start recording or ask for consent to record.
- Old desktop **KAW'S Radio** shortcuts and the CB page now point to the working relay.

## Fixes
- The welcome is the first spoken line; queued warnings follow after it finishes. Missing fuel data cannot produce a startup warning, and offline or paused telemetry cannot trigger legacy driving warnings.
- New installs use the working Northflank relay address. Existing installs using the blocked default address migrate automatically; custom relays, Jarvis preview overrides, sharing settings and existing Render backups are preserved.
- A relay address that answers with a **sign-in page** (e.g. Cloudflare Access) is no longer shown as “Relay online”, and telemetry fails over to a backup instead of treating the page as data.
- The old rest warning can no longer fire at startup from missing telemetry.

## Known limits
- Voice recognition uses the browser's online speech service (Chrome and Edge tested; Firefox has none). Only the voice that speaks replies can run on KAW's PC.
- Shared natural voices need KAW's PC to be on. Only one line is generated at a time, so with many drivers some lines use the browser voice. Fair-use limits apply.
- Update to v1.7 before choosing a natural voice; older versions cannot play them.
- Live player counts, server status and convoy dates appear only when those live sources are connected.
