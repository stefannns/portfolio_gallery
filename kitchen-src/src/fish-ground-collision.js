import {FISH_BOUNCE_END, FISH_DURATION, FISH_FLOOR_Y, FISH_LENGTH, fishFlopPose} from './fish-flop-state.js';

const finalPose = fishFlopPose(FISH_DURATION);
const landedFishCollider = Object.freeze({
  id: 'landed-fish', position: Object.freeze([finalPose.x, FISH_FLOOR_Y, finalPose.z]),
  collisionShape: 'capsule-x', collisionHalfLength: .16, collisionRadius: .24, width: FISH_LENGTH,
});

/** A floor obstacle appears only after the fish finishes its landing bounce. */
export function getLandedFishCollider(fishState) {
  return fishState?.used && Number.isFinite(fishState.elapsed) && fishState.elapsed >= FISH_BOUNCE_END ? landedFishCollider : null;
}

/** Resolve a newly appeared obstacle locally; never send the character to spawn. */
export function recoverFishOverlap(player, collider, {playerRadius = .33, canWalk, canTraverse} = {}) {
  if (!collider) return player;
  if (!Number.isFinite(player?.x) || !Number.isFinite(player?.z)) return null;
  const [cx, , cz] = collider.position;
  const half = collider.collisionHalfLength, radius = collider.collisionRadius + playerRadius;
  if (![cx, cz, half, radius].every(Number.isFinite) || half < 0 || radius <= 0) return null;
  const clampX = x => Math.max(cx - half, Math.min(cx + half, x));
  if (Math.hypot(player.x - clampX(player.x), player.z - cz) >= radius) return player;
  if (typeof canWalk !== 'function' || typeof canTraverse !== 'function') return null;

  const guardRadius = radius + .005, candidates = [];
  const add = (x, z) => candidates.push({x, z, distance: (x - player.x) ** 2 + (z - player.z) ** 2});
  // Exact nearest points on both straight sides, plus samples if a nearby
  // counter blocks the shortest escape. The two semicircles close each end.
  for (const sign of [-1, 1]) {
    add(clampX(player.x), cz + sign * guardRadius);
    for (let index = 0; index <= 32; index++) add(cx - half + half * 2 * index / 32, cz + sign * guardRadius);
    const endX = cx + sign * half;
    const angle = Math.atan2(player.z - cz, (player.x - endX) * sign);
    const nearest = Math.max(-Math.PI / 2, Math.min(Math.PI / 2, angle));
    add(endX + sign * guardRadius * Math.cos(nearest), cz + guardRadius * Math.sin(nearest));
    for (let index = 0; index <= 64; index++) {
      const theta = -Math.PI / 2 + Math.PI * index / 64;
      add(endX + sign * guardRadius * Math.cos(theta), cz + guardRadius * Math.sin(theta));
    }
  }
  candidates.sort((a, b) => a.distance - b.distance);
  for (const candidate of candidates) {
    if (!canWalk(candidate.x, candidate.z) || !canTraverse(player, candidate)) continue;
    return {...player, x: candidate.x, z: candidate.z};
  }
  return null;
}
