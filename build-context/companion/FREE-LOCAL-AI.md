# Free local AI co-driver — first integration

Author: Kaw. Optional extension to Companion v1.6.0; no paid API or subscription.
This is a source integration for testing, not a published installer release.

## Included

- Co-Driver: **Ask AI**, enable/disable, installed-model selector, connection check.
- Existing immediate commands remain immediate. Unrecognized questions can use AI.
- Ollama receives only the question and a small current truck/job/navigation/damage snapshot.
- Optional CPU Piper speech and CPU faster-whisper microphone transcription.
- Discord `/ai status`, `/ai ask question:…`, staff `/ai briefing driver:…`.
- Voice source selector: ATS voice (mute Companion), Companion voice, or both.
- Persistent map-style toolbar, quick choices and reset buttons.
- Spoken speeding threshold from 1–30 MPH over, warning delay and repeat interval.
- AI defaults to **off**. Existing alerts and Co-Driver work without these dependencies.

No conversation history is retained by this integration. The browser's existing
transcript keeps its last 30 entries in memory. No recordings are saved by the
speech bridge. Initial dependency/model downloads need Internet; local inference
does not. Discord and convoy relay features still need Internet.

## 1. Test Ollama first

Use the Windows PC running the Companion. Start your existing Ollama installation.
In PowerShell:

```powershell
ollama list
```

You previously used `qwen3:8b`; choose it if installed. Otherwise download a model
you want to test, for example `ollama pull qwen3:8b`. Check that model's own terms.
For gaming performance, begin with short questions and test a smaller model if
necessary. The extension uses a 4K context, limited reply length, and one AI request
at a time per process. Companion and bot processes can still request concurrently.

Run the updated Companion source using your existing configuration and normal
start command. Open **http://127.0.0.1:4280** → **Co-Driver** → **Check connection**.
Choose an installed model, enable local AI and click **Save AI settings**.
Type “Explain how to improve my fuel economy” and click **Ask AI**.
Ordinary **Ask** checks built-in commands first; unmatched questions use AI if enabled.
You can also say “ask AI …” with your selected microphone engine.

Local AI and offline speech routes are limited to the PC running the Companion.
The existing browser Co-Driver still works on other devices; those devices do not
get access to this experimental local AI service. No port-forwarding or public
Ollama exposure is required.

## 2. Optional offline voice and microphone

Use Python **3.11 or 3.12** for this isolated environment, even if your system's
default Python is newer. In PowerShell, starting in the `companion` folder:

```powershell
py -3.12 -m venv local-speech\.venv
& .\local-speech\.venv\Scripts\python.exe -m pip install -r local-speech\requirements.txt
New-Item -ItemType Directory -Force local-speech\voices | Out-Null
Push-Location local-speech\voices
& ..\.venv\Scripts\python.exe -m piper.download_voices en_US-lessac-medium
Pop-Location
```

Choose additional Piper models to offer more voices. Keep each `.onnx` file beside
its matching `.onnx.json`. Read each voice's model card before distributing it.
Piper is GPL-3.0; voice models have their own licenses. This integration does not
bundle engines or voice models into the installer.

For microphone transcription, explicitly download the small English model once:

```powershell
& .\local-speech\.venv\Scripts\python.exe -c "from huggingface_hub import snapshot_download; snapshot_download(repo_id='Systran/faster-whisper-base.en', local_dir='local-speech/models/whisper-base.en')"
```

Start the bridge in a separate PowerShell window:

```powershell
& .\local-speech\.venv\Scripts\python.exe .\local-speech\bridge.py
```

Keep that window running. On the Co-Driver page, click **Check connection**, select
**Offline Piper**, select your downloaded voice, and click **Test voice**. Voice
settings are saved per browser/device. Piper supports the page's speed and volume
controls; the pitch control applies only to browser speech.

Select **Offline faster-whisper** for the microphone. Click **Push to talk**, speak,
and click again to send; recording stops automatically after 15 seconds. Allow
the browser's microphone prompt. Keyboard/wheel buttons toggle recording when the
page receives them. A key is not a global hotkey while ATS has focus.

Offline wake-word listening is not implemented. Existing browser recognition can
use an online service; its voices may also be network-backed. Use Piper and
faster-whisper when you specifically want local-only speech. If the optional
bridge is stopped, select browser speech or use typed questions; failures are
shown in the transcript rather than silently switching to a cloud service.

## 3. Discord bot

The bot's AI runs on **the bot host**, not automatically on a player's PC. If the
bot is hosted on ZAP or another remote host, your desktop's Ollama is not its
localhost. This first integration intentionally does not expose a remote Ollama
endpoint. To test for free, run a development bot on the same computer as Ollama
(with a separate test bot token/server, or stop the existing instance first).

Merge this section into `bot/config.json`, preserving your other settings:

```json
"ai": { "enabled": true, "model": "qwen3:8b", "timeoutSeconds": 60 }
```

Restart the bot using its usual procedure; its normal command registration adds
`/ai`. Use `/ai status`, then `/ai ask question:How do I back a trailer?`.
Responses are deferred immediately and returned privately with mentions disabled.
Requests have a 15-second per-user cooldown and one active AI answer per bot process.

`/ai ask` has no personal live telemetry: shared convoy membership is not a secure
Discord-to-driver identity link. Staff can use `/ai briefing driver:Exact Name`
to summarize the named driver's shared relay snapshot. Missing, ambiguous,
disconnected or stale snapshots are not treated as live trip information. The
existing relay privacy settings still determine what is shared. No raw SDK,
config secrets, pairing codes or other drivers are sent in the AI snapshot.

## Navigation and personal voices: next stage

The Co-Driver **Voice & personality** panel lets you choose **ATS in-game voice**,
**KAW's ATS Companion voice**, or **Both voices**. ATS mode mutes Companion speech,
including manual answers and Windows dispatcher prompts; AI answers remain text.
This is a saved Companion preference for the PC. It does not modify ATS files or
automatically enable/disable the game's audio. Use the expandable instructions:
ATS → Options → Audio → navigation voice settings. Keep ATS voice enabled for
spoken turn directions. The Companion supplies trip updates and alerts.

Navigation's **Voice & speed warnings** button opens these controls. Under
**Automatic callouts**, choose an MPH threshold, a 0/2/3/5-second delay, and once
per speeding episode or a 30/45/60-second repeat. For example, **5 MPH over** in a
55 zone warns at 60 MPH after your chosen delay. Toggle **Speeding warnings** off
to mute them. Speed-limit-change announcements have a separate toggle. These
preferences are saved per browser; visual overspeed alerts and trip scoring keep
their own thresholds. The browser Co-Driver must be open for spoken warnings.

Navigation's **Map style** selector now stays above the map for tile and classic
styles, with Road/Night/Satellite/ATS/Classic buttons and **Reset to Road map**.
The original and on-map selectors stay synchronized. The Convoy Hub has a labeled
style selector and **Reset to DLC coverage**. Changing styles does not clear your
trip. Tiles may require Internet; the classic view works offline.

This integration **does not replace ATS GPS** or create turn-by-turn instructions.
The current telemetry explicitly reports `nativeTurnInstructionAvailable: false`.
Model answers are advisory; they do not execute convoy or game commands. Existing
explicit built-in voice commands continue to operate as before.

Free recorded navigation packs in your own voice are the next independent task:
record the required ATS phrases, build the pack, then test it against your ATS
version and multiplayer setup. Companion voice selection here controls Companion
speech, not the game's active navigation pack.

OpenVoice cloning is a later experiment; no cloning engine or celebrity recordings
are included. A person's own recording/consent and a compatible license are needed
before offering an identifiable voice pack. No authorized free Madea or Denzel
Washington pack has been verified for this project.

## Validation and rollback

Run `node --test tests/*.test.js` in `companion`. The automated suite uses mock
Ollama/speech responses and checks privacy, stale data, disabled mode, model
requests, timeout/concurrency handling, and the local-only HTTP boundary. It does
not substitute for Windows/ATS, actual model inference, microphone or listening
tests. Browser-control tests use a fake DOM; actual browser rendering still needs
manual verification. The Python smoke suite uses fake engines and runs without
model downloads: `python local-speech/test_bridge.py` from `companion`.

Set local AI to off and select browser speech/input to return to the prior
Co-Driver behavior. No new paid service, relay deployment, game mod or installer
release is required by these source changes.
