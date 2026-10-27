import {FISH_POSITION} from './fish-flop-state.js';

export const KITCHEN_TOYS = Object.freeze([
  {id: 'fish-flop', kind: 'toy', label: 'Fish', actionLabel: 'Startle the fish', interactionRange: 1.65,
    position: FISH_POSITION, hitSize: [.92, .5, .5], hitOffset: [0, .16, 0]},
  {id: 'tomato-throw', kind: 'toy', label: 'Tomatoes', actionLabel: 'Throw a tomato', interactionRange: 1.65,
    position: [.3, 1.118, 4.95], hitSize: [.75, .65, .75], hitOffset: [0, .24, 0]},
  {id: 'sink-bubbles', kind: 'toy', label: 'Sink', actionLabel: 'Blow bubbles', interactionRange: 1.65,
    position: [-3.95, 1.27, 2.7], hitSize: [.85, .65, .9]},
  {id: 'stove-pan', kind: 'toy', label: 'Stove', actionLabel: 'Fire up the stove', interactionRange: 1.65,
    position: [-3.88, 1.2, -1.04], hitSize: [1.25, .65, 1.05]},
]);

export function isNearRoomTarget(player, target, fallbackRange = 1.7) {
  return Boolean(target && Number.isFinite(player?.x) && Number.isFinite(player?.z)
    && Math.hypot(player.x - target.position[0], player.z - target.position[2]) <= (target.interactionRange ?? fallbackRange));
}

/** Automatic E/touch targeting always chooses the nearest object within reach. */
export function chooseRoomTarget(player, items) {
  let nearest = null, nearestDistance = Infinity;
  for (const item of items) {
    if (!isNearRoomTarget(player, item)) continue;
    const distance = Math.hypot(player.x - item.position[0], player.z - item.position[2]);
    if (distance < nearestDistance) {nearest = item;nearestDistance = distance;}
  }
  return nearest;
}

export const STOVE_DURATION = 2;
export const STOVE_LANDING_TIME = 1.71;

/** One bounded launch, with a short ignition and a soft landing. */
export function stoveMotion(elapsed, reducedMotion = false) {
  if (!(elapsed > 0) || elapsed >= STOVE_DURATION) return {lift: 0, tilt: 0, flame: 0, flameHeight: 0};
  const flight = Math.max(0, Math.min(1, (elapsed - .16) / (STOVE_LANDING_TIME - .16)));
  const arc = Math.sin(Math.PI * flight);
  const lift = (reducedMotion ? .3 : .8) * Math.max(0, arc) ** 1.15;
  const ignition = Math.min(1, elapsed / .12);
  const fade = Math.min(1, (STOVE_DURATION - elapsed) / .4);
  const flame = ignition * fade;
  return {lift, tilt: (reducedMotion ? .025 : .1) * Math.sin(flight * Math.PI * 2) * arc,
    // Keep the flame within the air gap, with clearance for the tilted pan.
    flame, flameHeight: Math.max(0, lift - .03) * flame};
}

/** Spent toys leave E/touch targeting immediately, even before React updates. */
export function isKitchenToyAvailable(toy, engine = {}) {
  if (toy.id === 'tomato-throw') return engine.tomatoRemaining !== 0;
  if (toy.id === 'fish-flop') return !engine.fishToy?.used;
  return true;
}
