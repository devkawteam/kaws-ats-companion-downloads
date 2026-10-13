// Adjustable spoken speeding policy. Author: Kaw.
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.KAWSpeedWarning = factory();
})(typeof window === 'undefined' ? globalThis : window, function () {
  function createState() { return { since: null, last: null, limit: null }; }
  function update(state, speed, limit, settings, now) {
    const valid = v => v !== null && v !== undefined && Number.isFinite(Number(v));
    const threshold = Math.max(1, Math.min(30, Number(settings.mph) || 5));
    if (!settings.enabled || !valid(speed) || !valid(limit) || limit <= 5 || speed - limit < threshold) {
      state.since = null; state.last = null; state.limit = null; return false;
    }
    if (state.limit !== limit) { state.since = now; state.last = null; state.limit = limit; }
    if (state.since === null) state.since = now;
    if (now - state.since < Math.max(0, Number(settings.delaySeconds) || 0) * 1000) return false;
    const repeat = Math.max(0, Number(settings.repeatSeconds) || 0) * 1000;
    if (state.last !== null && (!repeat || now - state.last < repeat)) return false;
    state.last = now; return true;
  }
  return { createState, update };
});
