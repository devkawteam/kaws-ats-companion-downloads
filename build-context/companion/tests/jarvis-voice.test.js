// Jarvis voice conversation state machine, driven by a fake speech recogniser and fake speech output.
// (Real microphones/browsers must still be checked by hand — see the summary in JARVIS-PERSONALITY.md.)
const test = require('node:test');
const assert = require('node:assert/strict');
const { createVoiceSession, GOODBYE } = require('../public/jarvis-voice');

const tick = () => new Promise(r => setImmediate(r));
async function settle(n = 30) { for (let i = 0; i < n; i++) await tick(); }

// A fake SpeechRecognition: each started instance plays the next scripted outcome.
function fakeRecognition(script) {
  const made = [];
  class FakeSR {
    constructor() { made.push(this); this.aborted = false; }
    start() {
      if (FakeSR.active) throw new Error('already started');           // browsers allow one at a time
      FakeSR.active = this;
      const step = script.shift() || { silence: true };
      this.step = step;
      setImmediate(() => {
        if (this.aborted) return;
        if (step.fastEnd) return this.finish();
        this.onstart?.();
        if (step.error) { this.onerror?.({ error: step.error }); return this.finish(); }
        this.onaudiostart?.();
        if (step.hold) return;                                          // stays listening until aborted
        if (step.silence) { this.onerror?.({ error: 'no-speech' }); return this.finish(); }
        this.onspeechstart?.();
        this.onresult?.({ resultIndex: 0, results: [Object.assign([{ transcript: step.say }], { isFinal: true })] });
        this.finish();
      });
    }
    finish() { if (FakeSR.active === this) FakeSR.active = null; this.onend?.(); }
    abort() { this.aborted = true; if (FakeSR.active === this) FakeSR.active = null; }
  }
  FakeSR.made = made;
  return FakeSR;
}

function harness(script, { sendImpl, idleMs, busy, speakImpl } = {}) {
  const SR = fakeRecognition(script);
  const log = { sent: [], spoken: [], states: [], diag: [], active: [], stopped: 0 };
  let clock = 1000, speakingNow = 0;
  const session = createVoiceSession({
    SR, lang: 'en-GB', idleMs, now: () => clock, wait: () => new Promise(r => setImmediate(r)),
    send: sendImpl || (async t => { log.sent.push(t); return `Reply to ${t}. What next?`; }),
    speak: speakImpl || (async t => { speakingNow++; log.spoken.push(t); await tick(); speakingNow--; }),
    stopSpeaking: () => { log.stopped++; }, isBusy: busy || (() => false),
    onState: st => log.states.push(st), onDiag: d => log.diag.push(d), onActive: on => log.active.push(on)
  });
  return { SR, session, log, advance: ms => { clock += ms; }, speaking: () => speakingNow };
}

test('a hands-free conversation runs five+ turns without pressing the mic again', async () => {
  const lines = ['Hello Jarvis', 'Doing great, hauling lumber', 'Reno', 'Any tips for the Sierra?', 'Thanks, what about fuel?', 'Cool'];
  const h = harness([...lines.map(say => ({ say })), { hold: true }]);
  assert.equal(h.session.start(), true);
  await settle(80);
  assert.deepEqual(h.log.sent, lines, 'each utterance sent exactly once, in order');
  assert.equal(h.log.spoken.length, 6, 'every reply spoken');
  assert.equal(h.session.state().turns, 6);
  assert.equal(h.session.state().phase, 'listening', 'listening again for turn 7');
  assert.deepEqual(h.log.active, [true], 'the mic was borrowed once and kept');
  // The mic is never open while Jarvis speaks: every "speaking" state has mic off.
  assert.ok(h.log.states.filter(s => s.phase === 'speaking').every(s => !s.mic));
  assert.ok(!h.log.diag.some(d => 'transcript' in d || JSON.stringify(d).includes('lumber')), 'diagnostics never contain words');
  h.session.stop();
  assert.equal(h.session.state().phase, 'off'); assert.deepEqual(h.log.active, [true, false]);
});

test('Stop during listening, thinking and speaking leaves everything off, even when a late reply arrives', async () => {
  // Listening
  let h = harness([{ hold: true }]);
  h.session.start(); await settle();
  assert.equal(h.session.state().mic, true);
  h.session.stop(); await settle();
  assert.equal(h.SR.made[0].aborted, true); assert.equal(h.session.state().mic, false);
  // Thinking: the reply comes back after Stop and must not be spoken or restart listening.
  let release;
  h = harness([{ say: 'hi' }, { hold: true }], { sendImpl: () => new Promise(r => { release = r; }) });
  h.session.start(); await settle();
  assert.equal(h.session.state().phase, 'thinking');
  h.session.stop(); release('late reply'); await settle();
  assert.equal(h.log.spoken.length, 0, 'late reply not spoken'); assert.equal(h.SR.made.length, 1, 'no new listening'); assert.equal(h.session.state().phase, 'off');
  // Speaking
  let finishSpeech;
  h = harness([{ say: 'hi' }, { hold: true }], { speakImpl: () => new Promise(r => { finishSpeech = r; }) });
  h.session.start(); await settle();
  assert.equal(h.session.state().phase, 'speaking');
  h.session.stop(); finishSpeech(); await settle();
  assert.ok(h.log.stopped >= 1, 'playback cancelled'); assert.equal(h.SR.made.length, 1, 'did not re-open the mic after Stop');
});

test('Interrupt cancels speech or a pending answer and listens straight away; repeat Start is ignored', async () => {
  let release;
  const h = harness([{ say: 'tell me a long story' }, { say: 'actually never mind' }, { hold: true }], {
    sendImpl: t => { h.log.sent.push(t); return t.startsWith('tell') ? new Promise(r => { release = r; }) : Promise.resolve('Sure thing.'); }
  });
  h.session.start(); await settle();
  assert.equal(h.session.state().phase, 'thinking');
  assert.equal(h.session.start(), false, 'a second Start while running does nothing');
  h.session.talk(); await settle(40);
  release('The long story…'); await settle();
  assert.deepEqual(h.log.sent, ['tell me a long story', 'actually never mind']);
  assert.deepEqual(h.log.spoken, ['Sure thing.'], 'the interrupted answer is never spoken');
  assert.equal(h.SR.made.filter(r => !r.aborted && h.SR.active === r).length, 1, 'only one recogniser listening');
});

test('errors are explained and stop the loop instead of retrying forever', async () => {
  for (const [code, re] of [['not-allowed', /Microphone access is blocked/], ['audio-capture', /No working microphone/], ['network', /speech service could not be reached/], ['service-not-allowed', /Edge is the verified browser/]]) {
    const h = harness([{ error: code }, { say: 'should not run' }]);
    h.session.start(); await settle();
    const st = h.session.state();
    assert.equal(st.phase, 'error', code); assert.match(st.message, re); assert.equal(st.mic, false);
    assert.equal(h.log.sent.length, 0); assert.equal(h.SR.made.length, 1, `${code}: no automatic restart`);
  }
  // The browser ending instantly with no audio (Kenny's Chrome symptom) is caught after two tries.
  const fast = harness([{ fastEnd: true }, { fastEnd: true }, { fastEnd: true }]);
  fast.session.start(); await settle();
  assert.equal(fast.session.state().phase, 'error'); assert.match(fast.session.state().message, /stopped the microphone straight away/);
  assert.equal(fast.SR.made.length, 2);
  // Relay problems (paused, rate limit, timeout) come back as messages from send().
  const relay = harness([{ say: 'hi' }], { sendImpl: async () => { throw new Error("That's a lot of chatting! Jarvis needs a coffee break."); } });
  relay.session.start(); await settle();
  assert.equal(relay.session.state().phase, 'error'); assert.match(relay.session.state().message, /coffee break/);
  // Recovery: Start works again after an error.
  const again = harness([{ error: 'network' }, { say: 'back again' }, { hold: true }]);
  again.session.start(); await settle(); again.session.start(); await settle();
  assert.deepEqual(again.log.sent, ['back again']);
  // No speech recognition at all (Firefox).
  const none = createVoiceSession({ SR: null, send: async () => '', onState: () => {} });
  assert.equal(none.start(), false); assert.equal(none.state().phase, 'error');
});

test('quiet driver: keeps listening for a while, then pauses with a clear restart message', async () => {
  const script = Array.from({ length: 50 }, () => ({ silence: true }));
  const h = harness(script, { idleMs: 60000 });
  h.session.start(); await settle(10);
  assert.equal(h.session.state().phase, 'listening');
  h.advance(61000); await settle(20);
  assert.equal(h.session.state().phase, 'off'); assert.match(h.session.state().message, /paused after 1 minute of quiet/);
  assert.ok(h.SR.made.length < 50, 'bounded restarts');
});

test('goodbye ends the conversation politely; Co-Driver announcements are never transcribed', async () => {
  assert.ok(GOODBYE.test('Goodbye Jarvis')); assert.ok(GOODBYE.test('ok bye')); assert.ok(GOODBYE.test('thanks, that\'s all')); assert.ok(!GOODBYE.test('say goodbye to the old truck'));
  const h = harness([{ say: 'goodbye' }]);
  h.session.start(); await settle();
  assert.equal(h.log.sent.length, 0, 'goodbye is handled locally, no request'); assert.match(h.log.spoken[0], /Catch you later/); assert.equal(h.session.state().phase, 'off');
  // While a Co-Driver alert is playing, Jarvis waits before opening the mic.
  let busy = true;
  const b = harness([{ say: 'hi' }, { hold: true }], { busy: () => busy });
  b.session.start(); await settle();
  assert.equal(b.SR.made.length, 0, 'not listening during another announcement');
  busy = false; await settle(40);
  assert.deepEqual(b.log.sent, ['hi']);
});
