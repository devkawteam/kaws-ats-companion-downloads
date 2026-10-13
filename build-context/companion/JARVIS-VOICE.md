# Talking to Jarvis (voice conversation)

Open **Drive → Jarvis (KAW's office)** on the PC running the Companion.

## How it works

1. Press **▶ Start conversation**. The browser asks for the microphone the first time; choose **Allow**.
2. After the chime, the badge shows **🎤 Mic ON** and the state is **Listening**. Just talk.
3. Jarvis goes through **Thinking**, then **Speaking** (the mic is off while he speaks). After that he listens again by himself, with no clicking between turns.
4. To finish, press **⏹ Stop conversation**, say **"goodbye"**, press **Esc**, or leave the Jarvis page.
   - If you stay quiet for 2 minutes, the conversation pauses and **Start conversation** picks it up again.
5. **✋ Interrupt / Talk** cuts Jarvis off (while he's thinking or speaking) and listens straight away.

During a conversation, replies are always spoken. The **Read typed-chat replies aloud** switch only affects typed chat and keeps its own setting. Typed chat and the one-shot 🎙 button still work as before.

## Browsers and privacy

- **Microsoft Edge: verified working (Kenny's PC).** Your speech is turned into text by **Microsoft's online speech service**.
- **Google Chrome: not verified yet.** On Kenny's PC it stopped the mic immediately; the cause is still being diagnosed (see below). Chrome uses **Google's online speech service**.
- **Firefox:** no built-in speech recognition. Typing works.
- Browser speech recognition is **not offline**: the browser sends your voice to its maker's speech service. The Companion itself never records, uploads or keeps audio. Only the recognized text goes to Jarvis, together with your recent chat and a few trip facts.

## Jarvis's voice

Open **Jarvis's voice** on the Jarvis page.

- **Choosing:** pick any voice your browser actually has, set a modest speed and pitch, and press **▶ Play sample**. The choice is saved in this browser on this PC.
- **"Same as my Co-Driver voice"** (the default) uses whatever the Co-Driver uses, including Piper.
- **Labels:** voices are listed with accent and provider. "Suggested" marks a British or American male voice in the style Kenny asked for. None of them is "the real Jarvis voice", and none is labelled that way.
- **Best voices:** Edge's **"Online (Natural)"** voices sound best, for example a British male such as *Ryan*, an American male such as *Guy* or *Andrew*, or the female voices Kenny liked. Which voices exist depends on the browser and Windows.
- **If your chosen voice is missing** (other browser, other PC), the page says so and uses the Co-Driver voice instead.
- Speed and pitch tweaks help a little, but they can't turn one voice into a different, deeper one.

## Interrupting while Jarvis talks ("barge-in")

The reliable mode is **turn-taking**: the mic is off while Jarvis speaks, so he never hears himself, and listening resumes only after the speech engine reports it has finished. Use **Interrupt / Talk** to cut in.

True hands-free barge-in (just start talking over him) isn't claimed. Browser recognition can't reliably separate your voice from Jarvis's own voice on speakers. Doing it properly needs echo cancellation plus voice-activity detection in a different audio pipeline, for example:

- **Option A: local Whisper with voice-activity detection**, using the Companion's existing optional speech bridge.
  - **Privacy:** fully on your PC.
  - **Cost:** free.
  - **Hardware:** needs the Python speech bridge, a ~150–500 MB model, and a recent CPU. A GPU makes it faster.
  - **Latency:** about 0.5–2 s per turn.
  - **Echo:** works best with a headset; on speakers it needs Windows echo cancellation.
- **Option B: a cloud real-time voice service.**
  - **Cost:** paid per minute.
  - **Setup:** needs a provider account and key, which must stay on a server and never in the Companion.
  - **Privacy:** audio goes to that provider.
  - Not recommended without your OK.

Neither option is built; the turn-taking mode stays as the working default.

## When the microphone stops by itself (diagnostics)

Open **Voice diagnostics** on the Jarvis page:

- **What it shows:** the browser, the page build (`ui: jarvis-voice-2`, to confirm you aren't on a cached old page), microphone permission, how many microphones Windows reports, and whether the Co-Driver wake word is on.
- **Event log:** a list of recognition events with error codes. It never contains your words.
- **Test microphone (3 s):** checks whether sound reaches the browser at all, without recording anything.
- **Copy diagnostics:** copies everything so you can paste it to KAW.

Errors stay on the panel with a specific explanation instead of a quick pop-up:
- microphone blocked;
- no microphone;
- speech service unreachable;
- "stopped straight away without audio";
- Jarvis paused, busy or rate-limited;
- timeouts;
- a wrong Jarvis server address (for example a Cloudflare sign-in page).

The Co-Driver's wake word and push-to-talk give the microphone to Jarvis during a conversation. Browsers allow only one speech-recognition session per page, so the two would otherwise knock each other off.

### Chrome checklist (not yet diagnosed)

On Kenny's PC, reproduce in Chrome at `http://127.0.0.1:4280/` and copy the diagnostics. Then check, in this order:

1. `micPermission` is not **denied**. If it is, use Chrome's site settings for 127.0.0.1.
2. `audioInputs` is at least 1, and **Test microphone** shows a level. If not, check Windows Settings → Privacy & security → Microphone → "Let desktop apps access your microphone", and Chrome's selected input device.
3. Look at the event codes:
   - `not-allowed`: permission;
   - `network`: Chrome can't reach Google's speech service (network, VPN or firewall);
   - `aborted` or "stopped straight away" with `coDriverWakeWord: on`: interference;
   - `ui` not equal to `jarvis-voice-2`: a cached old page; press Ctrl+F5.
4. Only after the cause is known, decide on a fix. Don't reset Chrome or switch speech providers blindly.

## Jarvis server address

The Companion normally uses the convoy relay. **Jarvis server** on the Jarvis page sets a Jarvis-only address (https), for example the preview relay. It does not change convoy, CB radio or DNS settings.

## Preview launcher, Restart and Quit

- **`Start KAW Companion PREVIEW.cmd`** (in the repository folder) starts the v1.7 preview from that folder and opens the dashboard.
  - If the installed Companion is running, it asks before stopping it. It never starts a second copy on the same port.
  - Run it with `-CreateShortcut` once to add a separate **KAW Companion PREVIEW** desktop shortcut. Your installed shortcut is left alone.
- **Settings → Companion app** shows which version and folder are running, plus **Restart** (works when started with the PREVIEW launcher) and **Quit**. Closing the browser tab doesn't stop the Companion.
- If you start a Companion while another one uses the port, it now says which version is running and how to fix it, instead of crashing.
- The installed v1.6.1 may still start with Windows. Close it, or let the PREVIEW launcher stop it.
