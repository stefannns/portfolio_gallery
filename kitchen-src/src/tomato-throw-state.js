export const TOMATO_TIMING = Object.freeze({grabEnd: .40, release: .72, impact: 1.28, end: 1.45});
const unit = value => Math.max(0, Math.min(1, value));
export const smoothTomatoStep = value => {const t = unit(value);return t * t * (3 - 2 * t);};

/** Shared timings for the hand cue and one consumed tomato projectile. */
export function tomatoThrowPose(elapsed) {
  const {grabEnd, release, impact, end} = TOMATO_TIMING;
  const active = Number.isFinite(elapsed) && elapsed >= 0 && elapsed < end;
  const phase = !active ? 'idle' : elapsed < grabEnd ? 'grab' : elapsed < release ? 'windup'
    : elapsed < impact ? 'throw' : 'impact';
  return {active, phase, elapsed: active ? elapsed : end,
    grabProgress: active ? unit(elapsed / grabEnd) : 0,
    windupProgress: active ? unit((elapsed - grabEnd) / (release - grabEnd)) : 0,
    throwProgress: active ? unit((elapsed - release) / (impact - release)) : 0};
}


/** A visit has at most four tomatoes. Finishing/cancelling never restores one. */
export function createTomatoInventory(remaining = 4) {
  const count = Number.isFinite(remaining) ? Math.max(0, Math.min(4, Math.floor(remaining))) : 4;
  const available = Array.from({length: count}, (_, index) => index);
  let active = false;
  return {
    get remaining() {return available.length;},
    get active() {return active;},
    has(index) {return available.includes(index);},
    start({blocked = false} = {}) {
      if (blocked || active || !available.length) return null;
      active = true;
      return available.pop();
    },
    finish() {active = false;},
  };
}
