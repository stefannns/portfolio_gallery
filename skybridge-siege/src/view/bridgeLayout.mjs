// Where things are in the sky bridge painting (assets/scene/bridge-source.png), and the simple
// 3D shapes it is projected onto. The painting is treated as a photo taken from the player's
// eye in the middle lane: a level camera with the game camera's field of view, its horizon at
// the row where the deck's edges meet. Seen from the middle lane the bridge then looks exactly
// like the painting, and from the outer lanes each part shifts by its own distance.
// No three.js here, so the build tool and the tests can use it too.

export const PAINTING = {
  width: 1672,
  height: 941,
  vanish: { x: 836, y: 432 }, // where the deck's edges meet
  focal: 848.8, // pixels: 58 degrees across its 941 rows, as the game camera sees
  eye: 1.6, // metres, as config.arena.eyeY
};

// Metres. z runs from the player (0) toward the Warden (negative), x across, y up.
export const BRIDGE = {
  deckHalf: 3.2, // from the centre line to the foot of each parapet
  // The painting draws the parapet lower the further away it is, faster than perspective alone
  // would: the lamps standing on it have their feet 0.71 m up at 4.3 m away and 0.27 m up at
  // 12.8 m. So its top is level up to parapetSlopeFrom metres away, then slopes down.
  parapetTop: 0.75,
  parapetSlopeFrom: 3.5,
  parapetSlope: 0.052, // metres down per metre further
  capOuter: 3.8, // outer edge of the parapet's capstone
  landingZ: -12, // where the parapets end and the round landing begins
  landingHalf: 7.5,
  gateZ: -22.2, // the gatehouse's front
  gateHalf: 9,
  gateTop: 13,
  repeatStep: 1.2, // about a flagstone's length: stone nearer than the painting shows repeats this far on
};

/** The parapet's top, in metres up, at a distance in metres from the player. */
export function parapetTopAt(depth, b = BRIDGE) {
  return Math.min(b.parapetTop, b.parapetTop - b.parapetSlope * (depth - b.parapetSlopeFrom));
}

// The round landing's low rim wall, bulging out either side of the bridge's end: an ellipse
// around the landing's middle, fitted to the painted rim's outline (its outermost point at
// column 448 and 1224, its top 503 rows down and its foot 534, its back edge against the
// towers about 494). Each side runs from the parapet's outer side, which it leaves just
// before the parapet ends, round to behind the towers' feet, where the painting loses it.
export const RIM = {
  centreZ: -13.85,
  halfWidth: 6.2, // across, to the outer face
  halfDepth: 2.8, // along the bridge
  height: 0.45,
  thickness: 0.5,
  backX: 4.3, // where it ends, behind the towers' feet
};

/**
 * Points along one side's rim, front to back: [x, z] in metres, `inset` metres in from the
 * outer face (0 is the outer face, RIM.thickness the inner). side: -1 left, 1 right.
 */
export function rimOutline(side, inset = 0, steps = 40, r = RIM, b = BRIDGE) {
  const from = Math.asin(b.capOuter / r.halfWidth);
  const to = Math.PI - Math.asin(r.backX / r.halfWidth);
  const points = [];
  for (let i = 0; i <= steps; i += 1) {
    const t = from + ((to - from) * i) / steps;
    points.push([side * (r.halfWidth - inset) * Math.sin(t), r.centreZ + (r.halfDepth - inset) * Math.cos(t)]);
  }
  return points;
}

export const LAMP_X = 3.5; // the lamps stand on the middle of the capstones

/** Each lamp's box in painting pixels: left, top, right, bottom (its foot). Left side first. */
export const LAMPS = [
  [78, 263, 215, 607], [348, 360, 428, 557], [480, 403, 535, 539], [549, 428, 590, 524], [590, 441, 618, 520],
  [1054, 443, 1082, 520], [1084, 428, 1120, 527], [1138, 403, 1194, 539], [1240, 361, 1322, 559], [1456, 263, 1597, 612],
];

// The flame sits in the same place in every lamp: centre and radii as fractions of its box.
const FLAME = { x: 0.51, y: 0.375, rx: 0.37, ry: 0.2 };

// The painting's cages are empty; the game draws its own flame (cartoonFlame.js) behind each lamp.

/**
 * How the game camera frames the bridge so that, standing in a lane, the screen shows exactly
 * that lane's painting: the same focal length and horizon, level, and never past the painting's
 * edges. A window wider than the painting shows its full width and crops the top and bottom; a
 * narrower one shows its full height and crops the sides. For a PerspectiveCamera with
 * setViewOffset: the full frame (symmetric about the horizon, so the painting's horizon row
 * stays put), and the window into it, all in painting pixels.
 */
export function paintingFrame(aspect, p = PAINTING) {
  const half = Math.max(p.vanish.y, p.height - p.vanish.y); // the full frame's half height
  const top = half - p.vanish.y; // the painting's top row in the full frame
  const fov = (2 * Math.atan(half / p.focal) * 180) / Math.PI;
  let width = p.width, height = p.height, x = 0, y = top;
  if (aspect >= p.width / p.height) {
    height = p.width / aspect;
    y = top + (p.height - height) * 0.15; // crop mostly paving off the bottom, keeping the towers' tips
  } else {
    width = p.height * aspect;
    x = (p.width - width) / 2;
  }
  return { fov, fullWidth: p.width, fullHeight: 2 * half, x, y, width, height };
}

/** The painting pixel a world point lands on, seen from the painting's eye at (0, eye, 0). */
export function toPainting({ x, y, z }, p = PAINTING) {
  const depth = -z;
  return { u: p.vanish.x + (p.focal * x) / depth, v: p.vanish.y - (p.focal * (y - p.eye)) / depth };
}

/**
 * A flat card, facing the player, that covers a lamp's box exactly as the painting's eye sees
 * it, stood on the capstone's middle line: { x, z, width, bottom, top } in metres.
 */
export function lampCard([left, top, right, bottom], p = PAINTING, lampX = LAMP_X) {
  const centre = (left + right) / 2;
  const depth = (p.focal * lampX) / Math.abs(centre - p.vanish.x);
  const perPixel = depth / p.focal;
  return {
    x: Math.sign(centre - p.vanish.x) * lampX,
    z: -depth,
    width: (right - left) * perPixel,
    bottom: p.eye - (bottom - p.vanish.y) * perPixel,
    top: p.eye - (top - p.vanish.y) * perPixel,
  };
}

/**
 * Where a lamp's card lands in the painting from a lane's eye eyeX metres across (the side
 * lanes' paintings): left, top, right, bottom in painting pixels. From the middle lane, the box.
 */
export function lampBoxFrom(box, eyeX, p = PAINTING) {
  const card = lampCard(box, p), depth = -card.z, half = card.width / 2;
  const u = x => p.vanish.x + (p.focal * (x - eyeX)) / depth, v = y => p.vanish.y - (p.focal * (y - p.eye)) / depth;
  return [u(card.x - half), v(card.top), u(card.x + half), v(card.bottom)];
}

/** The flame inside a lamp's box, in painting pixels: { x, y, rx, ry }. */
export function flameOf([left, top, right, bottom]) {
  const width = right - left, height = bottom - top;
  return { x: left + FLAME.x * width, y: top + FLAME.y * height, rx: FLAME.rx * width, ry: FLAME.ry * height };
}

/**
 * Where the drawn flame goes, in painting pixels: its base sits on the cup's rim, and `unit`
 * is its height from base to tip (cartoonFlame.js draws it 1 unit tall, give or take).
 */
export function flameSpot(box) {
  const f = flameOf(box);
  return { x: f.x, base: f.y + 0.6 * f.ry, unit: 1.15 * f.ry };
}
