import {CONVEYOR} from './conveyor-layout.js';

export const PLAYER_SPEED = 4.8;
export const START_POSITION = {x: 0, z: 0};

export function canStand(x, z) {
  if (!Number.isFinite(x) || !Number.isFinite(z)) return false;
  const dx = Math.max(Math.abs(x) - (CONVEYOR.playerHalfWidth - CONVEYOR.playerCornerRadius), 0);
  const dz = Math.max(Math.abs(z) - (CONVEYOR.playerHalfDepth - CONVEYOR.playerCornerRadius), 0);
  return Math.hypot(dx, dz) <= CONVEYOR.playerCornerRadius + 1e-8;
}

export function stepPlayer(position, input, delta) {
  const length = Math.hypot(input.x, input.z);
  if (length < .04) return {x: position.x, z: position.z, moving: false};
  const scale = Math.min(1, length) / length * PLAYER_SPEED * Math.min(delta, .05);
  let x = position.x + input.x * scale, z = position.z + input.z * scale;
  const coreX = CONVEYOR.playerHalfWidth - CONVEYOR.playerCornerRadius;
  const coreZ = CONVEYOR.playerHalfDepth - CONVEYOR.playerCornerRadius;
  const cx = Math.max(-coreX, Math.min(coreX, x)), cz = Math.max(-coreZ, Math.min(coreZ, z));
  const dx = x - cx, dz = z - cz, distance = Math.hypot(dx, dz);
  if (distance > CONVEYOR.playerCornerRadius) {
    x = cx + dx * CONVEYOR.playerCornerRadius / distance;
    z = cz + dz * CONVEYOR.playerCornerRadius / distance;
  }
  return {x, z, moving: Math.hypot(x - position.x, z - position.z) > .0001};
}
