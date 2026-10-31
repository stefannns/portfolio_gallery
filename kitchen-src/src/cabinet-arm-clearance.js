const CABINET = {minX: -2.52, maxX: 1.731, minZ: 4.66, maxZ: 5.562};
const HALF_SPAN = .39, RADIUS = .37;
const clamp = (v, min, max) => Math.max(min, Math.min(max, v));

// A sideways capsule follows the shoulder line, rather than a wide circle.
// It is narrow front-to-back, with extra reach only to either side of the body.
export function resolveCabinetArmClearance(position, heading, canWalk) {
  const sideX = Math.cos(heading), sideZ = -Math.sin(heading);
  let x = position.x, z = position.z;
  for (let iteration = 0; iteration < 8; iteration++) {
    let corrected = false;
    for (const offset of [-HALF_SPAN, 0, HALF_SPAN]) {
      const px = x + sideX * offset, pz = z + sideZ * offset;
      let dx = px - clamp(px, CABINET.minX, CABINET.maxX);
      let dz = pz - clamp(pz, CABINET.minZ, CABINET.maxZ);
      let distance = Math.hypot(dx, dz);
      if (distance >= RADIUS - 1e-7) continue;
      let depth;
      if (distance < 1e-8) {
        const faces = [
          {dx: -1, dz: 0, gap: px - CABINET.minX}, {dx: 1, dz: 0, gap: CABINET.maxX - px},
          {dx: 0, dz: -1, gap: pz - CABINET.minZ}, {dx: 0, dz: 1, gap: CABINET.maxZ - pz},
        ].sort((a, b) => a.gap - b.gap);
        ({dx, dz} = faces[0]);depth = RADIUS + faces[0].gap + .001;
      } else {
        dx /= distance;dz /= distance;depth = RADIUS - distance + .001;
      }
      x += dx * depth;z += dz * depth;corrected = true;
    }
    if (!corrected) break;
  }
  // Never trade hand clearance for moving through another fixture or slab edge.
  const steps = Math.max(1, Math.ceil(Math.hypot(x - position.x, z - position.z) / .025));
  for (let i = 0; i <= steps; i++) {
    if (!canWalk(position.x + (x - position.x) * i / steps, position.z + (z - position.z) * i / steps)) return null;
  }
  return {...position, x, z};
}
