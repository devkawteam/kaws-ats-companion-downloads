/* Jarvis voice conversation: listen → send → speak the reply → listen again, until the driver presses
   Stop, says goodbye, leaves the page, stays quiet too long, or a blocking error happens.
   - Uses the browser's built-in speech recognition. In Edge, Microsoft's online speech service turns
     speech into text; in Chrome, Google's. It is not offline.
   - Turn-taking: the microphone is off while Jarvis (or a Co-Driver announcement) speaks, and listening
     resumes only after the speech engine reports it has finished, so Jarvis never hears himself.
   - Every callback carries a generation number; anything from an older generation (after Stop,
     Interrupt or a restart) is ignored, so late replies can't speak or re-open the microphone.
   Works in the browser (window.KAWJarvisVoice) and in Node with fakes (tests). Author: Kaw. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.KAWJarvisVoice = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const GOODBYE = /^(ok(ay)?[, ]+)?(thanks?( you)?[, ]+)?(good ?bye|bye( bye)?|see (you|ya)( later)?|stop listening|that'?s all|end (the )?(chat|conversation|session)|over and out)\b/i;
  const ERRORS = {
    'not-allowed': 'Microphone access is blocked for this page. Click the lock icon left of the address, set Microphone to Allow, reload, then press Start conversation.',
    'service-not-allowed': "This browser's speech service is turned off or unavailable here. Microsoft Edge is the verified browser.",
    'network': "The browser's speech service could not be reached (it needs the internet). Check the connection, then press Start conversation.",
    'audio-capture': 'No working microphone was found. Check Windows Settings → Privacy & security → Microphone (and that the browser is allowed), then press Start conversation.',
    'language-not-supported': "The browser's speech service does not support your language setting.",
    'bad-grammar': 'The speech service rejected the request. Press Start conversation to try again.'
  };
  const FAST_END = 'The browser stopped the microphone straight away without receiving any audio. Open “Voice diagnostics” below for details. Common causes: the site’s microphone permission, Windows microphone access for the browser, another app or tab using speech recognition, or the browser’s speech service being unavailable.';

  /* opts: {
       SR, lang,
       send(text) -> Promise<string>   (throws Error with a driver-friendly message),
       speak(text) -> Promise           (resolves when the engine has finished or was cancelled),
       stopSpeaking(), isBusy() -> bool (other speech playing, e.g. Co-Driver alerts),
       onState(state), onDiag({ event, t, error, ms }), onActive(bool) (lend/return the mic),
       idleMs (default 120000), now(), wait(ms),
       pauseMs (number or function; 0 = send when the browser ends a segment), setTimer, clearTimer } */
  function createVoiceSession(opts) {
    const now = opts.now || (() => Date.now());
    const wait = opts.wait || (ms => new Promise(r => setTimeout(r, ms)));
    const idleMs = opts.idleMs ?? 120000;
    const pauseMs = () => Math.max(0, Number(typeof opts.pauseMs === 'function' ? opts.pauseMs() : opts.pauseMs) || 0);
    const setTimer = opts.setTimer || ((fn, ms) => setTimeout(fn, ms)), clearTimer = opts.clearTimer || (t => clearTimeout(t));
    const s = { on: false, phase: 'off', mic: false, rec: null, gen: 0, turn: 0, heard: '', interim: '', quiet: null, turns: 0, caption: '', message: '', lastHeard: 0, fastEnds: 0, requests: 0 };
    const emit = () => { try { opts.onState?.({ phase: s.phase, mic: s.mic, on: s.on, turns: s.turns, caption: s.caption, message: s.message }); } catch {} };
    const set = (phase, extra = {}) => { Object.assign(s, { phase, ...extra }); emit(); };
    const diag = (event, extra = {}) => { try { opts.onDiag?.({ event, t: now(), ...extra }); } catch {} };
    const live = gen => s.on && gen === s.gen;

    function dropRecognition() {
      const r = s.rec; s.rec = null; s.mic = false;
      if (r) { r.onresult = r.onerror = r.onend = r.onaudiostart = r.onspeechstart = r.onstart = null; try { r.abort(); } catch {} }
    }

    // One driver turn. With pauseMs > 0 the browser's segment end is NOT the end of the turn: finished
    // segments are collected, the recogniser restarts while the driver may still be talking, and the
    // combined words are sent once only after pauseMs of quiet (any new speech resets the wait).
    async function listen(gen) {
      // Never listen over other speech (Co-Driver alerts etc.): wait for real silence first.
      if (live(gen) && opts.isBusy?.()) set('listening', { mic: false, caption: '', message: 'Waiting for other speech to finish…' });
      while (live(gen) && opts.isBusy?.()) await wait(300);
      if (!live(gen)) return;
      if (now() - s.lastHeard > idleMs) return end(`Conversation paused after ${Math.round(idleMs / 60000)} minute${idleMs >= 120000 ? 's' : ''} of quiet. Press Start conversation to talk again.`);
      s.turn++; s.heard = ''; s.interim = ''; clearQuiet();
      recognize(gen, s.turn);
    }

    function clearQuiet() { if (s.quiet) { try { clearTimer(s.quiet); } catch {} s.quiet = null; } }
    // Restart the quiet countdown after any sign of speech in this turn.
    function armQuiet(gen, turn) {
      clearQuiet();
      if (!(pauseMs() > 0)) return;
      s.quiet = setTimer(() => {
        s.quiet = null;
        if (!live(gen) || turn !== s.turn) return;                    // stopped, interrupted or already sent
        const text = (s.heard + ' ' + s.interim).replace(/\s+/g, ' ').trim();
        if (!text) return;
        diag('quiet', { ms: pauseMs() });
        submit(text, gen, turn);
      }, pauseMs());
    }
    function submit(text, gen, turn) {
      if (!live(gen) || turn !== s.turn) return;
      s.turn++; clearQuiet(); dropRecognition();
      s.heard = ''; s.interim = ''; s.fastEnds = 0; s.lastHeard = now();
      handle(text, gen);
    }

    function recognize(gen, turn) {
      if (!live(gen) || turn !== s.turn) return;
      dropRecognition();
      let rec;
      try { rec = new opts.SR(); } catch { return fail('Speech recognition is not available in this browser. Microsoft Edge is the verified browser.'); }
      s.rec = rec;
      const waiting = pauseMs() > 0;
      rec.lang = opts.lang || 'en-US'; rec.continuous = waiting; rec.interimResults = true; rec.maxAlternatives = 1;
      let recFinal = '', recInterim = '', fatal = null, heardAudio = false;
      const startedAt = now();
      const mine = () => gen === s.gen && turn === s.turn && s.rec === rec;
      const shown = () => (s.heard + ' ' + recFinal + ' ' + recInterim).replace(/\s+/g, ' ').trim();
      rec.onstart = () => { if (mine()) diag('start'); };
      rec.onaudiostart = () => { if (mine()) { heardAudio = true; diag('audiostart'); } };
      rec.onspeechstart = () => { if (mine()) { diag('speechstart'); s.lastHeard = now(); if (shown()) armQuiet(gen, turn); } };
      rec.onresult = e => {
        if (!mine()) return;
        // Rebuild from every result of this recogniser, so nothing is counted twice or lost.
        recFinal = ''; recInterim = '';
        for (let i = 0; i < e.results.length; i++) { const r = e.results[i]; if (r.isFinal) recFinal += ' ' + r[0].transcript; else recInterim += ' ' + r[0].transcript; }
        s.interim = (recFinal + ' ' + recInterim).replace(/\s+/g, ' ').trim();
        diag('result', { final: Boolean(recFinal.trim()) });          // never the words themselves
        s.lastHeard = now();
        set('listening', { caption: shown() });
        if (waiting) armQuiet(gen, turn);
      };
      rec.onerror = e => {
        if (!mine()) return;
        diag('error', { error: e.error || 'unknown' });
        if (e.error === 'no-speech') return;
        if (e.error === 'aborted') { fatal = 'The microphone was taken by something else (another tab, app or voice feature). Press Start conversation to try again.'; return; }
        fatal = ERRORS[e.error] || `Speech recognition stopped (${e.error || 'unknown error'}). Press Start conversation to try again.`;
      };
      rec.onend = () => {
        if (!mine()) return;
        const ms = now() - startedAt;
        diag('end', { ms });
        s.rec = null; s.mic = false;
        if (!s.on) return;
        if (fatal) return fail(fatal);
        // Keep what this recogniser heard, including words it never finalised.
        s.heard = (s.heard + ' ' + recFinal + ' ' + recInterim).replace(/\s+/g, ' ').trim(); s.interim = '';
        if (!waiting) {
          if (s.heard) return submit(s.heard, gen, turn);
        } else if (s.heard) {
          // Still inside the pause: listen again for more words; the quiet timer decides when to send.
          if (!s.quiet) armQuiet(gen, turn);
          s.fastEnds = 0;
          return void wait(120).then(() => recognize(gen, turn));
        }
        // Ended almost instantly with no audio and no error: don't spin; report it after a second try.
        if (!heardAudio && ms < 1500) { if (++s.fastEnds >= 2) return fail(FAST_END); }
        else s.fastEnds = 0;
        wait(250).then(() => { if (live(gen) && turn === s.turn) listen(gen); });
      };
      set('listening', { caption: shown(), message: '', mic: true });
      try { rec.start(); } catch (e) { diag('error', { error: 'start-failed' }); fail('The microphone could not start. Close other apps or tabs using it, then press Start conversation.'); }
    }

    async function handle(text, gen) {
      if (GOODBYE.test(text)) {
        set('speaking', { caption: text });
        await opts.speak?.('Catch you later, driver. Keep the shiny side up!').catch(() => {});
        if (live(gen)) end('Conversation ended. Press Start conversation any time.');
        return;
      }
      set('thinking', { caption: text });
      s.requests++;
      let reply;
      try { reply = await opts.send(text); }
      catch (e) { if (live(gen)) fail(e.message || 'Jarvis could not answer.'); return; }
      if (!live(gen)) return;                                      // stopped or interrupted meanwhile
      if (!reply) return fail('Jarvis could not answer. Press Start conversation to try again.');
      set('speaking', { caption: '' });
      try { await opts.speak?.(reply); } catch {}
      if (!live(gen)) return;
      s.turns++;
      await wait(350);                                             // let the speakers fall silent
      listen(gen);
    }

    function end(message = '') {
      s.on = false; s.gen++; clearQuiet();
      dropRecognition();
      try { opts.stopSpeaking?.(); } catch {}
      try { opts.onActive?.(false); } catch {}
      set('off', { message, caption: '', mic: false });
    }
    function fail(message) {
      s.on = false; s.gen++; clearQuiet();
      dropRecognition();
      try { opts.stopSpeaking?.(); } catch {}
      try { opts.onActive?.(false); } catch {}
      set('error', { message, caption: '', mic: false });
    }
    function start() {
      if (s.on) return false;                                      // one session only
      if (!opts.SR) { set('error', { message: 'Voice conversation needs a browser with speech recognition. Microsoft Edge is the verified browser; Firefox has none.' }); return false; }
      s.on = true; s.turns = 0; s.fastEnds = 0; s.message = ''; s.lastHeard = now(); s.gen++;
      try { opts.onActive?.(true); } catch {}
      try { opts.stopSpeaking?.(); } catch {}
      listen(s.gen);
      return true;
    }
    // Interrupt / Talk: cancel what Jarvis is saying (or a pending answer) and listen right away.
    function talk() {
      if (!s.on) return start();
      s.gen++; clearQuiet();
      try { opts.stopSpeaking?.(); } catch {}
      s.lastHeard = now();
      listen(s.gen);
      return true;
    }
    // "Done speaking": send what was heard now instead of waiting for the pause.
    function done() {
      if (!s.on || s.phase !== 'listening') return false;
      const text = (s.heard + ' ' + s.interim).replace(/\s+/g, ' ').trim();
      if (!text) return false;
      diag('done');
      submit(text, s.gen, s.turn);
      return true;
    }
    return { start, stop: () => end(''), talk, done, state: () => ({ phase: s.phase, on: s.on, mic: s.mic, turns: s.turns, requests: s.requests, message: s.message }) };
  }

  return { createVoiceSession, GOODBYE, ERRORS, FAST_END };
});
