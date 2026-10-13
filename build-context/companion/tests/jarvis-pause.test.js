// "Pause before answering": a browser segment end is not the end of the driver's turn.
// Fake recogniser driven step by step and fake timers; real browsers must still be checked by hand.
const test = require('node:test');
const assert = require('node:assert/strict');
const { createVoiceSession } = require('../public/jarvis-voice');

const tick = () => new Promise(r => setImmediate(r));
async function settle(n = 20) { for (let i = 0; i < n; i++) await tick(); }

function harness(pauseMs = 3000) {
  const made = [];
  class SR {
    constructor() { made.push(this); this.results = []; }
    start() { this.started = true; setImmediate(() => { if (!this.aborted) { this.onstart?.(); this.onaudiostart?.(); } }); }
    abort() { this.aborted = true; }
    // test helpers
    say(text, final = true) { this.onspeechstart?.(); this.results.push(Object.assign([{ transcript: text }], { isFinal: final })); this.onresult?.({ resultIndex: 0, results: this.results }); }
    revise(text) { this.results[this.results.length - 1] = Object.assign([{ transcript: text }], { isFinal: false }); this.onresult?.({ resultIndex: 0, results: this.results }); }
    end() { this.onend?.(); }
  }
  const timers = new Map(); let id = 0;
  const sent = [], spoken = [];
  const session = createVoiceSession({
    SR, pauseMs: () => pauseMs, now: () => 1000, wait: () => tick(),
    setTimer: (fn, ms) => { timers.set(++id, { fn, ms }); return id; }, clearTimer: t => timers.delete(t),
    send: async t => { sent.push(t); return 'Got it.'; }, speak: async t => { spoken.push(t); }, stopSpeaking() {}, onState() {}
  });
  const fire = () => { const all = [...timers.entries()]; timers.clear(); for (const [, t] of all) t.fn(); };
  return { session, made, sent, spoken, timers, fire, cur: () => made[made.length - 1] };
}

test('a mid-sentence pause does not send: segments from restarted recognisers are combined, sent once after quiet', async () => {
  const h = harness(3000);
  h.session.start(); await settle();
  h.cur().say("I'm heading to"); h.cur().end(); await settle();
  assert.equal(h.sent.length, 0, 'segment end is not the end of the turn');
  assert.equal(h.made.length, 2, 'listening again during the pause');
  assert.equal([...h.timers.values()][0].ms, 3000);
  h.cur().say('Reno with a load of lumber'); await settle();
  h.cur().end(); await settle();
  h.fire(); await settle();
  assert.deepEqual(h.sent, ["I'm heading to Reno with a load of lumber"]);
  h.fire(); await settle();
  assert.equal(h.sent.length, 1, 'never sent twice');
});

test('interim words are kept, speech resets the wait, and only one timer is pending', async () => {
  const h = harness(6000);
  h.session.start(); await settle();
  h.cur().say('what about', false);
  assert.equal(h.timers.size, 1);
  h.cur().revise('what about fuel prices');
  assert.equal(h.timers.size, 1, 'the timer was restarted, not duplicated');
  h.cur().end(); await settle();                                    // recogniser gave up without finalising
  assert.equal(h.sent.length, 0);
  h.fire(); await settle();
  assert.deepEqual(h.sent, ['what about fuel prices'], 'unfinalised words were not discarded');
});

test('Stop, Interrupt and Done speaking during the pause', async () => {
  let h = harness(3000);
  h.session.start(); await settle();
  h.cur().say('tell me about'); h.cur().end(); await settle();
  h.session.stop();
  assert.equal(h.timers.size, 0, 'Stop cancels the pending wait');
  h.fire(); await settle();
  assert.equal(h.sent.length, 0); assert.equal(h.session.state().phase, 'off');

  h = harness(8000);
  h.session.start(); await settle();
  h.cur().say('how far is Reno');
  assert.equal(h.session.done(), true, 'manual Done speaking');
  await settle();
  assert.deepEqual(h.sent, ['how far is Reno']);
  assert.equal(h.timers.size, 0);

  h = harness(3000);
  h.session.start(); await settle();
  h.cur().say('first thought');
  h.session.talk(); await settle();                                  // interrupt: start the turn over
  h.fire(); await settle();
  assert.equal(h.sent.length, 0, 'an old turn never sends after Interrupt');
});

test('pause 0 keeps the original behaviour: the segment end sends at once', async () => {
  const h = harness(0);
  h.session.start(); await settle();
  h.cur().say('hello Jarvis'); h.cur().end(); await settle();
  assert.deepEqual(h.sent, ['hello Jarvis']); assert.equal(h.timers.size, 0);
});
