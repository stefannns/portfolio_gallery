// Maps camera landmarks to camera-space points for a first-person view.
// Mirroring: the raw frame shows the player's right hand at small x, and it must land on the
// right of the screen, so x flips. Depth: a finger nearer the webcam is farther from the
// player's eyes, so MediaPipe's negative z stays negative (into the screen).
// This is an estimate from one webcam, not a calibrated hand pose.

export const HAND_VIEW = { fov: 58, distance: 0.52 };

const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

export function projectHand(image, world, { aspect = 16 / 9, fov = HAND_VIEW.fov, distance = HAND_VIEW.distance } = {}) {
  const halfHeight = Math.tan((fov * Math.PI) / 360) * distance;
  const halfWidth = halfHeight * aspect;
  const wrist = image[0];

  const nx = clamp((0.5 - wrist.x) * 2.4, -1, 1);
  const rise = clamp((wrist.y - 0.25) / 0.75, 0, 1); // 0 = hand held high, 1 = bottom of frame
  const baseX = nx * halfWidth * 0.8;
  const baseY = halfHeight * 0.02 + (halfHeight * -0.92 - halfHeight * 0.02) * rise;

  // World landmarks are metres. Without them, approximate from image coordinates.
  const shape = world ?? image.map(p => ({ x: p.x * aspect * 0.5, y: p.y * 0.5, z: (p.z || 0) * 0.5 }));
  const origin = shape[0];
  return shape.map(p => ({
    x: baseX - (p.x - origin.x),
    y: baseY - (p.y - origin.y),
    z: -distance + ((p.z || 0) - (origin.z || 0)),
  }));
}
