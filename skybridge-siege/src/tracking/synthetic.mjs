// Builds MediaPipe-shaped landmarks for a named pose. Keyboard mode and the tests feed these
// through the same classifier, filter, caster and hand rig that a live camera uses.
// Coordinates describe the raw (unmirrored) camera frame with the palm facing the camera.

const EXTENDED = [[-0.135, 0], [-0.16, 0], [-0.182, 0]];
const CURLED = [[-0.112, -0.03], [-0.088, -0.045], [-0.066, -0.026]];

const FINGER_POSES = {
  open: [true, true, true, true],
  fist: [false, false, false, false],
  one: [true, false, false, false],
  two: [true, true, false, false],
};

const MCP_OFFSETS = [-0.03, -0.009, 0.012, 0.031];

/**
 * facing: 'palm' toward the camera, 'back' with the back of the hand toward it, or 'inward'
 * with the palm turned to face the other hand, as when praying: nearly edge-on to the camera.
 * turn: radians a palm-facing hand is turned inward from facing the camera squarely.
 */
export function syntheticWorld(pose, hand, facing = 'palm', turn = 0) {
  // The player's left hand appears on the right of the raw frame, thumb toward the image centre.
  const side = hand === 'left' ? 1 : -1;
  const raised = FINGER_POSES[pose];
  const points = [
    { x: 0, y: 0, z: 0 },
    { x: -side * 0.03, y: -0.02, z: 0 },
    { x: -side * 0.055, y: -0.05, z: 0 },
    { x: -side * 0.07, y: -0.075, z: 0 },
    { x: -side * 0.08, y: -0.095, z: 0 },
  ];
  MCP_OFFSETS.forEach((offset, finger) => {
    const x = side * offset;
    points.push({ x, y: -0.09, z: 0 });
    for (const [y, z] of raised[finger] ? EXTENDED : CURLED) points.push({ x, y, z });
  });
  // Turning a hand around mirrors it left to right and flips its depth.
  if (facing === 'back') return points.map(p => ({ x: -p.x, y: p.y, z: -p.z }));
  if (facing === 'inward' || turn) {
    // A turn about the upright axis, which keeps the hand's true shape: 'inward' is about 72 degrees.
    const angle = facing === 'inward' ? 1.25 : turn;
    const c = Math.cos(angle), s = Math.sin(angle);
    return points.map(p => ({ x: p.x * c - p.z * s * side, y: p.y, z: p.z * c + p.x * s * side }));
  }
  return points;
}

export function syntheticHand(pose, hand, { x = hand === 'left' ? 0.72 : 0.28, y = 0.72, scale = 1.9, aspect = 16 / 9, facing = 'palm', turn = 0 } = {}) {
  if (!pose) return null;
  const world = syntheticWorld(pose, hand, facing, turn);
  const image = world.map(point => ({ x: x + point.x * scale / aspect, y: y + point.y * scale, z: point.z * scale }));
  return { image, world, labelled: hand };
}
