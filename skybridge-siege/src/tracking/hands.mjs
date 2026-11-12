// Turns a MediaPipe HandLandmarker result into stable { left, right } slots.
// MediaPipe's handedness label flickers, so with two hands in frame the slot comes from
// position: the larger raw x is the player's left, because the camera faces the player.
// "left" therefore means "left side of the mirrored view", which is what the game needs.

const wristGap = (a, b) => Math.hypot(a.image[0].x - b.image[0].x, a.image[0].y - b.image[0].y);
// The same hand found twice lines up point for point. Two hands held close together can meet
// at the wrists or fingertips but not elsewhere, so the whole hand is compared.
const handGap = (a, b) => a.image.reduce((sum, p, i) => sum + Math.hypot(p.x - b.image[i].x, p.y - b.image[i].y), 0) / a.image.length;

export function assignHands(result, previous = null, { duplicateGap = 0.012, maxJump = 0.3 } = {}) {
  const detections = (result?.landmarks ?? []).map((image, index) => {
    const category = result.handednesses?.[index]?.[0];
    const label = category?.categoryName || category?.displayName;
    return {
      image,
      world: result.worldLandmarks?.[index] ?? null,
      // MediaPipe assumes a mirrored image and we pass the raw frame, so labels are swapped.
      labelled: label === 'Left' ? 'right' : label === 'Right' ? 'left' : null,
      score: category?.score ?? 0,
    };
  }).sort((a, b) => b.score - a.score);

  const kept = [];
  for (const detection of detections) {
    if (kept.length < 2 && !kept.some(hand => handGap(hand, detection) < duplicateGap)) kept.push(detection);
  }

  const assigned = { left: null, right: null };
  const entry = ({ image, world, labelled }) => ({ image, world, labelled });

  if (kept.length === 2) {
    const [first, second] = kept;
    const firstIsLeft = first.image[0].x > second.image[0].x;
    assigned.left = entry(firstIsLeft ? first : second);
    assigned.right = entry(firstIsLeft ? second : first);
  } else if (kept.length === 1) {
    const [hand] = kept;
    const distances = ['left', 'right']
      .filter(slot => previous?.[slot])
      .map(slot => [slot, wristGap(hand, previous[slot])])
      .sort((a, b) => a[1] - b[1]);
    const nearest = distances[0]?.[1] <= maxJump ? distances[0][0] : null;
    const slot = nearest ?? hand.labelled ?? (hand.image[0].x > 0.5 ? 'left' : 'right');
    assigned[slot] = entry(hand);
  }
  return assigned;
}
