// Hand pose classification and temporal stabilisation.
// classifyPose accepts any 21-point MediaPipe-shaped array. The live game passes
// world landmarks (metres, unaffected by frame aspect or camera distance).

const distance = (a, b) => Math.hypot(a.x - b.x, a.y - b.y, (a.z || 0) - (b.z || 0));

export const FINGER_TIPS = [8, 12, 16, 20]; // index, middle, ring, pinky
export const DEFAULT_EXTEND_RATIO = 1.12;

const usable = points => Boolean(points) && points.length >= 21 && distance(points[0], points[9]) >= 0.025;

/** Tip-to-wrist over knuckle-to-wrist for each finger; above extendRatio counts as raised. */
export function fingerRatios(points) {
  if (!usable(points)) return null;
  return FINGER_TIPS.map(tip => distance(points[tip], points[0]) / Math.max(1e-6, distance(points[tip - 2], points[0])));
}

// A fist must be a whole fist: every finger well curled (under fistRatio, not merely short of
// extendRatio) and the thumb tucked in, its tip within thumbTuck palm lengths of the middle
// finger's knuckle. A finger or thumb pointing out makes it 'other', which primes no fireball.
export const DEFAULT_FIST_RATIO = 1.0;
export const DEFAULT_THUMB_TUCK = 1.0;

/** Thumb tip to middle knuckle, over wrist to middle knuckle: about 0.8 tucked, over 1 sticking out. */
export function thumbReach(points) {
  if (!usable(points)) return null;
  return distance(points[4], points[9]) / Math.max(1e-6, distance(points[0], points[9]));
}

export function classifyPose(points, { extendRatio = DEFAULT_EXTEND_RATIO, fistRatio = DEFAULT_FIST_RATIO, thumbTuck = DEFAULT_THUMB_TUCK } = {}) {
  const ratios = fingerRatios(points);
  if (!ratios) return 'missing';
  const [index, middle, ring, pinky] = ratios.map(ratio => ratio > extendRatio);
  if (index && middle && ring && pinky) return 'open';
  if (!index && !middle && !ring && !pinky) {
    const whole = ratios.every(ratio => ratio < fistRatio) && thumbReach(points) < thumbTuck;
    return whole ? 'fist' : 'other';
  }
  if (index && !middle && !ring && !pinky) return 'one';
  if (index && middle && !ring && !pinky) return 'two';
  return 'other';
}

/**
 * Ignores classifier flicker so one bad frame cannot drop a selection or an armed fist.
 * A new definite pose must persist for switchMs. 'other' is the noise class, so it must
 * persist longer (otherMs). A lost hand keeps its last pose for lostGraceMs.
 */
export class PoseFilter {
  constructor({ switchMs = 60, otherMs = 160, lostGraceMs = 220 } = {}) {
    Object.assign(this, { switchMs, otherMs, lostGraceMs });
    this.reset();
  }

  reset() {
    this.pose = 'missing';
    this.candidate = null;
    this.candidateSince = 0;
    this.lastSeen = -Infinity;
  }

  update(raw, now) {
    if (raw === 'missing') {
      this.candidate = null;
      if (now - this.lastSeen >= this.lostGraceMs) this.pose = 'missing';
      return this.pose;
    }
    this.lastSeen = now;
    if (this.pose === 'missing' || raw === this.pose) {
      this.pose = raw;
      this.candidate = null;
      return this.pose;
    }
    if (raw !== this.candidate) {
      this.candidate = raw;
      this.candidateSince = now;
    }
    if (now - this.candidateSince >= (raw === 'other' ? this.otherMs : this.switchMs)) {
      this.pose = raw;
      this.candidate = null;
    }
    return this.pose;
  }
}

/**
 * How straight the least straight of the four fingers is: for each, the cosine of the bend
 * between knuckle-to-middle-joint and middle-joint-to-tip (1 dead straight, about 0.7 at 45
 * degrees, 0 at a right angle), and its tip-to-wrist over middle-joint-to-wrist reach.
 * { bend, reach }, both the worst finger's.
 */
export function fingerStraightness(points) {
  if (!usable(points)) return null;
  let bend = 1, reach = Infinity;
  for (const mcp of [5, 9, 13, 17]) {
    const pip = points[mcp + 1], tip = points[mcp + 3], base = points[mcp];
    const a = { x: pip.x - base.x, y: pip.y - base.y, z: (pip.z || 0) - (base.z || 0) };
    const b = { x: tip.x - pip.x, y: tip.y - pip.y, z: (tip.z || 0) - (pip.z || 0) };
    const cos = (a.x * b.x + a.y * b.y + a.z * b.z) / Math.max(1e-9, Math.hypot(a.x, a.y, a.z) * Math.hypot(b.x, b.y, b.z));
    bend = Math.min(bend, cos);
    reach = Math.min(reach, distance(tip, points[0]) / Math.max(1e-6, distance(pip, points[0])));
  }
  return { bend, reach };
}
