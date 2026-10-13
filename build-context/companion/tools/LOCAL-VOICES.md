# Optional natural voices (Kokoro, free, CPU)

Kokoro 1.0 offers 28 English voices (American/British, male/female), e.g. **Michael** (American male) and **George**
(British male). Each driver picks their own voice in Jarvis → "Jarvis's voice"; the choice is saved on that device.
Browser speech is always the fallback.

## Who installs what

| You are | What you need |
|---|---|
| **A driver** | Nothing. Pick a natural voice on the Jarvis page. Speech comes from KAW's PC through the protected relay. Do **not** install the engine. |
| **The owner PC serving shared voices** (Kenny) | The engine below, plus the relay setting `JARVIS_TTS=kokoro` and the protected tunnel route (see "Shared voices"). |
| **Someone who wants voices only on their own PC** | The engine below; the Companion uses it directly on 127.0.0.1:4312, no relay needed. |

## Install and manage the engine (owner PC)

Needs Windows, **Python 3.12 64-bit** (python.org, with the "py" launcher) and about 1.2 GB of disk.

```powershell
cd <Companion folder>\tools
powershell -ExecutionPolicy Bypass -File kaw-local-voices.ps1 -Action Install       # add -ModelDir <folder> to reuse model files you already have
powershell -ExecutionPolicy Bypass -File kaw-local-voices.ps1 -Action Status
powershell -ExecutionPolicy Bypass -File kaw-local-voices.ps1 -Action Start          # also: Stop, Restart, Verify
powershell -ExecutionPolicy Bypass -File kaw-local-voices.ps1 -Action Autostart -Enable   # or -Disable
powershell -ExecutionPolicy Bypass -File kaw-local-voices.ps1 -Action Uninstall -Yes
```

- **Durable location:** `%LOCALAPPDATA%\KAW\LocalVoices` (Python environment, models, and copies of the engine and this
  manager). Updating or reinstalling the Companion does not touch it.
- **Verified:** packages are pinned with SHA-256 hashes (`local-voices-requirements.txt`, `pip --require-hashes`, wheels
  only). `kokoro-v1.0.onnx` and `voices-v1.0.bin` are checked by size and SHA-256; a mismatch is refused. `-ModelDir`
  reuses existing files only if they match.
- **Self-test:** Install starts the engine, asks for one short phrase and checks WAV comes back. Nothing is played.
- **One engine only:** Start never opens a second listener; Stop only stops a process running `local-voices.py`.
- **Licenses:** see `LOCAL-VOICES-LICENSES.md` (also copied into the install folder). Kokoro model Apache-2.0,
  kokoro-onnx MIT; phonemizer and espeak-ng are GPL-3.0-or-later.

### Start at sign-in

A generic install has **no** startup entry until you run `-Action Autostart -Enable`. Kenny's preview PC already has a
hidden startup shortcut named **KAW Local Natural Voices** (pointing to `work/start-local-voices.ps1` in his Codex
workspace). `-Autostart -Enable` uses the same name, so it **replaces** that shortcut instead of adding a second starter.
Either way, Start does nothing if the engine is already running. This is a sign-in starter, not a service supervisor:
if the engine crashes, run `-Action Start` (or sign out and in).

## How it behaves

- Listens on **127.0.0.1:4312 only**. Browser-origin requests are refused; no file paths or commands are accepted.
- One synthesis at a time, at most two waiting; text ≤ 600 characters per request (the Companion sends ≤ 220-character
  segments); bounded speed and queue wait. Reply text is never logged or written to disk.
- Measured: ~0.4–0.7 GB RAM while running; 10–13 s of speech took 5.6–6.9 s on Kenny's PC (two CPU threads). A game
  running at the same time slows it down.
- **PC off, engine stopped, or busy:** the relay reports natural voices unavailable (the picker says so and keeps the
  driver's choice) or answers "busy" for that line; the Companion speaks those lines with the browser voice. When the
  engine is back, the saved voice is used again automatically.

## Shared voices (relay)

Set `JARVIS_TTS=kokoro` on the relay. It reuses `JARVIS_OLLAMA_URL` and the Cloudflare Access service token; the
protected hostname must route **only** `/api/voice/voices` and `/api/voice/speak` to `127.0.0.1:4312` (anonymous
requests get 403). Only text, voice and speed go to the engine. No driver name, install ID or chat history is sent,
though the text itself can contain what a driver said. Relay character quotas and the queue apply; quotas live in
memory and reset when the relay restarts, so they are not a durable spending or load cap. More simultaneous drivers
need a load test. Never expose 4312 directly. Non-English voices are not validated; Kokoro does not clone voices.

Existing installs must update to v1.7 before they can play Kokoro voices (WAV support and Kokoro voice IDs).
