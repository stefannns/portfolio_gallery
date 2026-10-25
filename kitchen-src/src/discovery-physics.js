import {BAR_LAYOUT, PLAYER_SPEED} from './discovery-layout.js';
import {isDiscoveryFloor} from './discovery-nav.js';

export const PLAYER_RADIUS = .43;

export function canStand(x, z) {
  if (!Number.isFinite(x) || !Number.isFinite(z)) return false;
  if (!isDiscoveryFloor(x, z)) return false;
  const bounds = BAR_LAYOUT.playerBounds, bar = BAR_LAYOUT.barObstacle;
  if (x < bounds.minX || x > bounds.maxX || z < bounds.minZ || z > bounds.maxZ) return false;
  if (x > bar.minX - PLAYER_RADIUS && x < bar.maxX + PLAYER_RADIUS
      && z > bar.minZ - PLAYER_RADIUS && z < bar.maxZ + PLAYER_RADIUS) return false;
  for (const station of BAR_LAYOUT.stations) {
    if (!station.support && !station.obstacleRadius && station.id !== 'a-bot-can-do-better') continue;
    const radius = (station.obstacleRadius || (station.support ? .9 : .7)) + PLAYER_RADIUS;
    if (Math.hypot(x - station.position[0], z - station.position[2]) < radius) return false;
  }
  return true;
}

export function stepPlayer(position, input, delta) {
  const length = Math.hypot(input.x, input.z);
  if (length < .04) return {...position, moving: false};
  const scale = Math.min(1, length) / length * PLAYER_SPEED * Math.min(Math.max(delta, 0), .05);
  const bounds = BAR_LAYOUT.playerBounds;
  let x = Math.max(bounds.minX, Math.min(bounds.maxX, position.x + input.x * scale));
  let z = position.z;
  if (!canStand(x, z)) x = position.x;
  const nextZ = Math.max(bounds.minZ, Math.min(bounds.maxZ, z + input.z * scale));
  if (canStand(x, nextZ)) z = nextZ;
  return {x, z, moving: Math.hypot(x - position.x, z - position.z) > .0001};
}
