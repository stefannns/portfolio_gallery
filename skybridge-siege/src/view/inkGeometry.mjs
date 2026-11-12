// Turns the projected hand points into the shapes of a 2D rubber-hose glove. No drawing here,
// so the layout can be tested without a browser. Sizes are metres at arm's length, converted
// to pixels, so the ink stays in proportion at any window size.

import { HAND_VIEW } from './handProjection.mjs';

const TAN_HALF_FOV = Math.tan((HAND_VIEW.fov * Math.PI) / 360);

const SIZE = {
  ink: 0.0042,
  palm: 0.017,
  arm: 0.021,
  cuffHalfLength: 0.033,
  cuffThickness: 0.021,
  minInkPx: 2.5,
};

// Drawn in this order, so nearer fingers overlap with an ink line between them.
const DIGITS = [
  { name: 'thumb', joints: [1, 2, 3, 4], radius: 0.0135 },
  { name: 'pinky', joints: [17, 18, 19, 20], radius: 0.0108 },
  { name: 'ring', joints: [13, 14, 15, 16], radius: 0.0122 },
  { name: 'middle', joints: [9, 10, 11, 12], radius: 0.013 },
  { name: 'index', joints: [5, 6, 7, 8], radius: 0.0125 },
];

const PALM = [0, 1, 5, 9, 13, 17];
const DART_TARGETS = [[5, 9], [9, 13], [13, 17]];

const lerp = (a, b, t) => ({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });
const add = (a, b, k = 1) => ({ x: a.x + b.x * k, y: a.y + b.y * k });
const distance = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);

function unit(v, fallback = { x: 0, y: 1 }) {
  const length = Math.hypot(v.x, v.y);
  return length > 1e-6 ? { x: v.x / length, y: v.y / length } : fallback;
}

export function toScreen(point, width, height) {
  const depth = Math.max(0.05, -point.z);
  return {
    x: ((point.x / (depth * TAN_HALF_FOV * (width / height)) + 1) / 2) * width,
    y: ((1 - point.y / (depth * TAN_HALF_FOV)) / 2) * height,
  };
}

/** A smooth curve through every point, as cubic segments: [{ c1, c2, to }]. */
export function curveThrough(points) {
  const segments = [];
  for (let i = 0; i < points.length - 1; i += 1) {
    const p0 = points[i - 1] ?? points[i], p1 = points[i], p2 = points[i + 1], p3 = points[i + 2] ?? p2;
    segments.push({
      c1: { x: p1.x + (p2.x - p0.x) / 6, y: p1.y + (p2.y - p0.y) / 6 },
      c2: { x: p2.x - (p3.x - p1.x) / 6, y: p2.y - (p3.y - p1.y) / 6 },
      to: p2,
    });
  }
  return segments;
}

/** A noodle arm from the wrist to just below the screen, bowing outward. */
function buildArm(wrist, knuckle, sign, width, height, radius) {
  const shoulderX = width / 2 + sign * width * 0.3;
  const end = { x: shoulderX + (wrist.x - shoulderX) * 0.45, y: height + radius * 3 };
  const span = distance(wrist, end);
  // Mostly follow the hand's axis, pulled toward straight down so a tilted hand can't whip the arm.
  const toForearm = unit({ x: wrist.x - knuckle.x, y: wrist.y - knuckle.y });
  const tangent = unit({ x: toForearm.x * 0.6, y: toForearm.y * 0.6 + 0.7 });
  return {
    start: wrist,
    c1: add(wrist, tangent, span * 0.4),
    c2: { x: end.x + sign * span * 0.14, y: end.y - span * 0.38 },
    end,
    radius,
    tangent,
  };
}

/**
 * points: 21 camera-space points from projectHand. side: 'left' or 'right' of the view.
 * armSign: which shoulder the arm runs to, -1 left to +1 right. Crossed arms use the far side.
 */
export function buildHandShape(points, side, width, height, armSign = side === 'right' ? 1 : -1) {
  const scale = (height / 2) / (TAN_HALF_FOV * HAND_VIEW.distance);
  const screen = points.map(point => toScreen(point, width, height));
  const wrist = screen[0];
  const palmRadius = SIZE.palm * scale;
  const arm = buildArm(wrist, screen[9], armSign, width, height, SIZE.arm * scale);

  const cuffCentre = add(wrist, arm.tangent, palmRadius * 0.7);
  const across = { x: -arm.tangent.y, y: arm.tangent.x };

  const palm = PALM.map(id => screen[id]);
  const centre = {
    x: palm.reduce((sum, p) => sum + p.x, 0) / palm.length,
    y: palm.reduce((sum, p) => sum + p.y, 0) / palm.length,
  };

  return {
    side,
    scale,
    ink: Math.max(SIZE.minInkPx, SIZE.ink * scale),
    screen,
    centre,
    palm,
    palmRadius,
    digits: DIGITS.map(({ name, joints, radius }) => {
      const path = joints.map(id => screen[id]);
      return { name, path, curve: curveThrough(path), radius: radius * scale };
    }),
    darts: DART_TARGETS.map(([a, b]) => {
      const target = lerp(screen[a], screen[b], 0.5);
      return [lerp(wrist, target, 0.38), lerp(wrist, target, 0.74)];
    }),
    arm,
    cuff: {
      a: add(cuffCentre, across, SIZE.cuffHalfLength * scale),
      b: add(cuffCentre, across, -SIZE.cuffHalfLength * scale),
      thickness: SIZE.cuffThickness * scale,
    },
  };
}

/** The palm edge furthest right, where the shadow falls. */
export function shadedEdge(palm) {
  let best = [palm[0], palm[1]], bestX = -Infinity;
  palm.forEach((point, index) => {
    const next = palm[(index + 1) % palm.length], midX = (point.x + next.x) / 2;
    if (midX > bestX) {
      bestX = midX;
      best = [point, next];
    }
  });
  return best;
}
