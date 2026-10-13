# KAW's ATS Companion v1.7.0-beta.1 — source preview

Author: Kaw.

- Free local Ollama co-driver with installed-model selection and typed questions.
- Optional offline Piper voices and faster-whisper push-to-talk through a CPU bridge.
- Voice source choice: ATS, Companion, or both, with in-app ATS setup instructions.
- Persistent Navigation map-style selector, quick choices and reset; labeled Hub selector.
- Adjustable spoken overspeed threshold, delay, repeat, and mute controls.
- Unified Companion speech path removes overlapping legacy navigation warnings.
- Discord bot v0.9.0-beta.1 adds private `/ai status`, `/ai ask`, and staff briefings.
- Devices & Screens adds locally generated QR pairing for phones/tablets, screen selection,
  remembered devices, and permission-based screen switching while a device page is open.
- Network sharing can be enabled/disabled in the app with one restart. Copy links,
  email/text drafts, optional system sharing, and connection troubleshooting are included.

Read [SECOND-SCREENS.md](SECOND-SCREENS.md) for second-screen setup. Remote API access
now requires pairing and supports display data only; administrative settings, local AI,
and command APIs stay on the PC. Previously open LAN browser displays must pair again.

AI defaults off. Read [FREE-LOCAL-AI.md](FREE-LOCAL-AI.md) for setup and limitations.
No engine/model downloads are bundled, no paid API is required, and no existing
ATS navigation pack is changed. In-game turn-by-turn voice packs and personal
voice cloning are separate follow-up work.

This preview is for source testing. Windows/ATS gameplay, real model inference,
actual speech playback, microphone operation, camera scanning and cross-device networking still require local validation
before building or publishing an installer.
