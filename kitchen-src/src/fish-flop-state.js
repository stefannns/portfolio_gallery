export const FISH_POSITION = Object.freeze([-3.82, 1.0976, -2.78]);
export const FISH_LENGTH = .8;
export const FISH_FLOOR_Y = .224;
export const FISH_EDGE_X = -3.30;
export const FISH_LAND_TIME = 2.12;
export const FISH_DURATION = 2.65;
const clamp = value => Math.min(1, Math.max(0, value));
const smooth = value => {const t = clamp(value);return t * t * (3 - 2 * t);};

export function createFishFlopState() {return {elapsed: -1, used: false, uses: 0};}
export function startFishFlop(state, {blocked = false} = {}) {
  if (blocked || state.used) return false;
  state.used = true;state.uses++;state.elapsed = 0;return true;
}
export function advanceFishFlop(state, delta, paused = false) {
  if (paused || !state.used || !Number.isFinite(delta)) return;
  state.elapsed = Math.min(FISH_DURATION, state.elapsed + Math.min(.05, Math.max(0, delta)));
}

/** The drop begins only after the entire fish clears the counter front. */
export function fishFlopPose(elapsed, reducedMotion = false) {
  const [x, y, z] = FISH_POSITION;
  const pose = {x, y, z, roll: 0, yaw: 0, pitch: 0, bend: 0, phase: 'idle', active: false};
  if (!(elapsed >= 0)) return pose;
  const t = Math.min(elapsed, FISH_DURATION);
  pose.active = t < FISH_DURATION;
  const amount = reducedMotion ? .35 : 1;
  if (t < 1.26) {
    const hop = Math.min(2, Math.floor(t / .42)), u = (t - hop * .42) / .42;
    const arc = Math.sin(Math.PI * u);
    pose.phase = 'flopping';pose.x += .18 * (hop + smooth(u));
    pose.y += [.15, .19, .17][hop] * amount * arc;
    pose.roll = Math.sin(Math.PI * 2 * u) * (hop % 2 ? -1 : 1) * amount;
    pose.pitch = Math.sin(Math.PI * 2 * u) * .12 * amount;
    pose.yaw = Math.sin(Math.PI * 2 * u) * .065 * amount;
    pose.bend = arc * .055 * amount;
  } else if (t < 1.52) {
    const u = (t - 1.26) / .26;
    pose.phase = 'leaving-edge';pose.x += .54 + .48 * smooth(u);
    pose.y += Math.sin(Math.PI * u) * .16 * amount;
    pose.pitch = (-.6 * Math.sin(Math.PI * u) - .2 * u) * amount;
    pose.roll = .55 * Math.sin(Math.PI * 2 * u) * amount;
    pose.bend = Math.sin(Math.PI * u) * .045 * amount;
  } else if (t < FISH_LAND_TIME) {
    const u = (t - 1.52) / (FISH_LAND_TIME - 1.52);
    pose.phase = 'falling';pose.x += 1.02 + .16 * u;
    pose.y = y - (y - FISH_FLOOR_Y) * u * u;
    pose.pitch = (-.2 * (1 - u) - .8 * Math.sin(Math.PI * u)) * amount;
    pose.roll = -.7 * Math.sin(Math.PI * 2 * u) * amount;
    pose.bend = Math.sin(Math.PI * u) * .04 * amount;
  } else if (t < 2.42) {
    const u = (t - FISH_LAND_TIME) / (2.42 - FISH_LAND_TIME);
    pose.phase = 'landing';pose.x += 1.18 + .05 * smooth(u);
    pose.y = FISH_FLOOR_Y + Math.sin(Math.PI * u) * .055 * amount;
    pose.roll = Math.sin(Math.PI * 2 * u) * .35 * amount;
    pose.bend = Math.sin(Math.PI * u) * .035 * amount;
  } else {
    const u = clamp((t - 2.42) / (FISH_DURATION - 2.42));
    pose.phase = t >= FISH_DURATION ? 'escaped' : 'settling';pose.x += 1.23;pose.y = FISH_FLOOR_Y;
    pose.bend = Math.sin(Math.PI * u) * (1 - u) * .015 * amount;
  }
  return pose;
}
