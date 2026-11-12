// How far each part of the painted floor slides when the player changes lane. Nearer things
// move further, which is what makes one flat painting read as depth.

export const FLOOR_DEPTH = { far: 0.75, back: 1, front: 2.2 };

/**
 * cameraX: metres from the centre lane. perMetre: image slide per metre at the Warden's distance.
 * limit: the most the image can slide before its edge would show.
 */
export function floorPan(cameraX, perMetre, limit) {
  const slide = depth => Math.sign(cameraX) * Math.min(Math.abs(cameraX * perMetre * depth), limit);
  return { far: slide(FLOOR_DEPTH.far), back: slide(FLOOR_DEPTH.back), front: slide(FLOOR_DEPTH.front) };
}
