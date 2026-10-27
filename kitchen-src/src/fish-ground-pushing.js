import {getLandedFishCollider} from './fish-ground-collision.js';

const MAX_STEP = .03;
const MAX_MOVE = .25;
const EPSILON = 1e-7;
const CONTACT_GUARD = .000001;
const finitePoint = point => Number.isFinite(point?.x) && Number.isFinite(point?.z);
const clamp = (value, low, high) => Math.max(low, Math.min(high, value));

/** A small grounded capsule can be scooted by walking into it; no force is queued. */
export function resolveFishPush(fishState, from, proposed, {playerRadius = .33, canWalk, paused = false} = {}) {
  const stopped = () => ({...proposed, x: from?.x, z: from?.z, moving: false});
  if (!finitePoint(from) || !finitePoint(proposed) || paused || proposed.moving === false || typeof canWalk !== 'function') return stopped();
  const collider = getLandedFishCollider(fishState);
  if (!collider) return {...proposed, moving: Boolean(proposed.moving) && Math.hypot(proposed.x - from.x, proposed.z - from.z) > .00001};
  const ground = fishState.ground, half = collider.collisionHalfLength, radius = collider.collisionRadius + playerRadius;
  const closest = (point, x = ground.x, z = ground.z) => ({x: clamp(point.x, x - half, x + half), z});
  const separation = (point, x = ground.x, z = ground.z) => {
    const q = closest(point, x, z);return Math.hypot(point.x - q.x, point.z - q.z);
  };
  // Landing recovery runs before movement. Never turn an unresolved landing
  // overlap into a large fish kick or a teleport of the character.
  if (separation(from) < radius - EPSILON) return stopped();
  const fishFits = (x, z) => canWalk(x - half, z) && canWalk(x, z) && canWalk(x + half, z);
  const staticSegment = (a, b) => {
    const count = Math.max(1, Math.ceil(Math.hypot(b.x - a.x, b.z - a.z) / .015));
    for (let i = 1; i <= count; i++) if (!canWalk(a.x + (b.x - a.x) * i / count, a.z + (b.z - a.z) * i / count)) return false;
    return true;
  };
  const fishShiftFraction = (dx, dz, player) => {
    const fits = fraction => {
      const x = ground.x + dx * fraction, z = ground.z + dz * fraction;
      return fishFits(x, z) && separation(player, x, z) >= radius - EPSILON;
    };
    const samples = Math.max(1, Math.ceil(Math.hypot(dx, dz) / .015));
    let safe = 0;
    for (let i = 1; i <= samples; i++) {
      const fraction = i / samples;
      if (fits(fraction)) {safe = fraction;continue;}
      let low = safe, high = fraction;
      for (let n = 0; n < 14; n++) {const middle = (low + high) / 2;if (fits(middle)) low = middle;else high = middle;}
      return low;
    }
    return 1;
  };
  let x = from.x, z = from.z, pushedDistance = 0;
  const tryMove = (tx, tz) => {
    const old = {x, z}, target = {x: tx, z: tz};
    if (!canWalk(tx, tz) || !staticSegment(old, target)) return false;
    const q = closest(target), distance = Math.hypot(target.x - q.x, target.z - q.z);
    if (distance >= radius) {x = tx;z = tz;return true;}
    let nx = q.x - tx, nz = q.z - tz, normalLength = Math.hypot(nx, nz);
    if (normalLength <= EPSILON) {nx = tx - x;nz = tz - z;normalLength = Math.hypot(nx, nz);}
    if (normalLength <= EPSILON) return false;
    nx /= normalLength;nz /= normalLength;
    const overlap = radius - distance + CONTACT_GUARD;
    const dx = nx * overlap, dz = nz * overlap;
    const fraction = fishShiftFraction(dx, dz, old);
    if (fraction > EPSILON) {
      ground.x += dx * fraction;ground.z += dz * fraction;
      pushedDistance += Math.hypot(dx, dz) * fraction;
      collider.position[0] = ground.x;collider.position[2] = ground.z;
    }
    if (separation(target) >= radius - EPSILON) {x = tx;z = tz;return true;}
    // A wall may allow only part of the push. Project the remaining wish onto
    // the fish boundary so glancing movement can slide instead of penetrating.
    const edge = closest(target);
    let ox = tx - edge.x, oz = tz - edge.z, outwardLength = Math.hypot(ox, oz);
    if (outwardLength <= EPSILON) {ox = -nx;oz = -nz;outwardLength = 1;}
    const projected = {x: edge.x + ox / outwardLength * (radius + CONTACT_GUARD), z: edge.z + oz / outwardLength * (radius + CONTACT_GUARD)};
    if (Math.hypot(projected.x - x, projected.z - z) <= Math.hypot(tx - x, tz - z) + .003
      && canWalk(projected.x, projected.z) && staticSegment(old, projected) && separation(projected) >= radius - EPSILON) {
      x = projected.x;z = projected.z;return true;
    }
    return false;
  };
  const wishX = proposed.x - from.x, wishZ = proposed.z - from.z;
  const distance = Math.hypot(wishX, wishZ), capped = Math.min(distance, MAX_MOVE);
  if (distance <= EPSILON) return stopped();
  const count = Math.max(1, Math.ceil(capped / MAX_STEP));
  const dx = distance ? wishX / distance * capped / count : 0, dz = distance ? wishZ / distance * capped / count : 0;
  for (let i = 0; i < count; i++) {
    if (tryMove(x + dx, z + dz)) continue;
    // The same axis slide order as ordinary room walking.
    if (Math.abs(dx) > EPSILON) tryMove(x + dx, z);
    if (Math.abs(dz) > EPSILON) tryMove(x, z + dz);
  }
  if (pushedDistance > EPSILON) {
    ground.revision++;ground.pushes++;ground.distance += pushedDistance;
  }
  return {...proposed, x, z, moving: Boolean(proposed.moving) && Math.hypot(x - from.x, z - from.z) > .00001};
}
