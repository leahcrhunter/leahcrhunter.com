// Champions replaces the classic 0-252 EV / 0-31 IV system with "Stat
// Points" (roughly 0-32ish per stat) and appears to hide/fix IVs entirely.
// @smogon/calc's engine only understands classic EVs, so this module is the
// single conversion point between "what the Champions UI shows" and "what
// the calc engine consumes."
//
// !! UNVERIFIED PLACEHOLDER !!
// The mapping below (points * 8, capped at 252) is a rough approximation
// pieced together from community discussion, not a confirmed in-game table.
// Nail this down against a reliable source before trusting any output evs()
// produces. Everything downstream (calc-engine.js) just calls statPointsToEv,
// so fixing the real formula here is a one-place change.
const StatPoints = (() => {
  const MAX_POINTS = 32;   // per stat
  const MAX_TOTAL = 66;    // across all six stats
  const ASSUMED_FIXED_IV = 31; // Champions seems to hide IVs; treat as maxed until confirmed.

  function statPointsToEv(points) {
    const clamped = Math.max(0, Math.min(MAX_POINTS, points));
    return Math.min(252, clamped * 8);
  }

  // Clamp a spread so each stat is 0..MAX_POINTS and the total is at most
  // MAX_TOTAL. `priority` (a stat key) is the one just edited: the others
  // keep their values and it gets whatever room is left.
  function clampSpread(spread, priority) {
    const out = {};
    Object.keys(spread).forEach((k) => {
      out[k] = Math.max(0, Math.min(MAX_POINTS, Math.trunc(Number(spread[k]) || 0)));
    });
    const keys = Object.keys(out);
    const order = priority ? keys.filter((k) => k !== priority).concat(priority) : keys;
    let left = MAX_TOTAL;
    order.forEach((k) => { out[k] = Math.min(out[k], left); left -= out[k]; });
    return out;
  }

  function ivsForCalc() {
    return { hp: ASSUMED_FIXED_IV, atk: ASSUMED_FIXED_IV, def: ASSUMED_FIXED_IV,
      spa: ASSUMED_FIXED_IV, spd: ASSUMED_FIXED_IV, spe: ASSUMED_FIXED_IV };
  }

  return { MAX_POINTS, MAX_TOTAL, statPointsToEv, clampSpread, ivsForCalc };
})();
