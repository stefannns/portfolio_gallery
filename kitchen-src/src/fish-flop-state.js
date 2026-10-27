export const FISH_POSITION = Object.freeze([-3.82, 1.0976, -2.78]);
export const FISH_LENGTH = .8;
export const FISH_FLOOR_Y = .224;
export const FISH_EDGE_X = -3.30;
export const FISH_HOP_DURATION = .55;
export const FISH_HOPS_END = FISH_HOP_DURATION * 3;
export const FISH_LAUNCH_END = 2.07;
export const FISH_LAND_TIME = 2.69;
export const FISH_BOUNCE_END = 3.04;
export const FISH_DURATION = 3.3;
export const FISH_FLOP_CONTACTS = Object.freeze([FISH_HOP_DURATION, FISH_HOP_DURATION * 2, FISH_HOPS_END, FISH_BOUNCE_END]);
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
  const amount = reducedMotion ? .12 : 1;
  if (t < FISH_HOPS_END) {
    const hop = Math.min(2, Math.floor(t / FISH_HOP_DURATION)), u = (t - hop * FISH_HOP_DURATION) / FISH_HOP_DURATION;
    const arc = Math.sin(Math.PI * u);
    pose.phase = 'flopping';pose.x += .18 * (hop + smooth(u));
    pose.y += [.55, .85, 1.15][hop] * amount * arc;
    pose.roll = Math.sin(Math.PI * 2 * u) * (hop % 2 ? -1 : 1) * 2.35 * amount;
    pose.pitch = Math.sin(Math.PI * 2 * u) * .3 * amount;
    pose.yaw = Math.sin(Math.PI * 2 * u) * .12 * amount;
    pose.bend = arc * .11 * amount;
  } else if (t < FISH_LAUNCH_END) {
    const u = (t - FISH_HOPS_END) / (FISH_LAUNCH_END - FISH_HOPS_END);
    pose.phase = 'leaving-edge';pose.x += .54 + .48 * smooth(u);
    pose.y += Math.sin(Math.PI * u) * .72 * amount;
    pose.pitch = (-.95 * Math.sin(Math.PI * u) - .2 * u) * amount;
    pose.roll = 1.65 * Math.sin(Math.PI * 2 * u) * amount;
    pose.bend = Math.sin(Math.PI * u) * .09 * amount;
  } else if (t < FISH_LAND_TIME) {
    const u = (t - FISH_LAUNCH_END) / (FISH_LAND_TIME - FISH_LAUNCH_END);
    pose.phase = 'falling';pose.x += 1.02 + .76 * u;
    pose.y = y - (y - FISH_FLOOR_Y) * u * u;
    pose.pitch = (-.2 * (1 - u) - .8 * Math.sin(Math.PI * u)) * amount;
    pose.roll = -1.2 * Math.sin(Math.PI * 2 * u) * amount;
    pose.bend = Math.sin(Math.PI * u) * .07 * amount;
  } else if (t < FISH_BOUNCE_END) {
    const u = (t - FISH_LAND_TIME) / (FISH_BOUNCE_END - FISH_LAND_TIME);
    pose.phase = 'landing';pose.x += 1.78 + .05 * smooth(u);
    pose.y = FISH_FLOOR_Y + Math.sin(Math.PI * u) * .12 * amount;
    pose.roll = Math.sin(Math.PI * 2 * u) * .65 * amount;
    pose.bend = Math.sin(Math.PI * u) * .06 * amount;
  } else {
    const u = clamp((t - FISH_BOUNCE_END) / (FISH_DURATION - FISH_BOUNCE_END));
    pose.phase = t >= FISH_DURATION ? 'escaped' : 'settling';pose.x += 1.83;pose.y = FISH_FLOOR_Y;
    pose.bend = Math.sin(Math.PI * u) * (1 - u) * .015 * amount;
  }
  return pose;
}
