// Motion-based spell detection. Each spell starts from a different hand shape, so they do not
// compete for the same input:
//   Throw    one fist, held, then snapped forward as it opens
//   Shield   both open palms pushed toward the camera, side by side (held)
//   Skyfall  both fists raised, then slammed down
//   Water    both open hands each trace a half circle, mirror images, together drawing one
//            circle: from together at one side of it, apart around it, together again opposite
//   Dodge    one hand swiped quickly outward, back of the hand to the camera, while the other
//            stays still: the left hand out to the left moves one lane left, the right hand out
//            to the right one lane right. Only outward strokes count, so bringing the hand back
//            to the middle never moves you. A fast swipe still counts if tracking loses the hand.
//
// Distances are measured in palm lengths so they mean the same near or far from the camera.
// Motion uses image landmarks; hand shape uses world landmarks when available.

import { classifyPose, fingerStraightness, PoseFilter } from './poses.mjs';

const HANDS = ['left', 'right'];
const PALM_POINTS = [0, 5, 9, 13, 17];

export const MOTION_DEFAULTS = {
  historyMs: 1400, // long enough to hold a whole Water circle
  // After any spell, no hand can fire another for this long. Short, because each hand must
  // also slow down before its next swipe counts (lockHands), which covers follow-through.
  lockAfterCastMs: 200,
  // Longer after Skyfall: opening both fists low after the slam is the Shield pose for a moment.
  lockAfterSlamMs: 450,
  lockAfterCircleMs: 450, // a Water circle ends with the hands together: briefly the Shield pose
  trackingGraceMs: 220,

  throwPrimeMs: 180,
  throwReleaseWindowMs: 420,
  snapLookbackMs: 300,
  snapDistance: 0.6, // palm lengths of travel, or...
  snapGrowth: 1.1, // ...apparent hand growth from moving toward the camera

  // Palms forward: both hands open, palms toward the camera, side by side and level.
  // Which way a palm faces depends on which hand it is; with hand tracking only, the hand on
  // the left of the view is taken to be the left hand (crossed arms would swap them).
  shieldHoldMs: 100,
  shieldVoteRate: 0.45, // how quickly per-frame readings are averaged, so one bad frame is ignored
  shieldOn: 0.5,
  shieldOff: 0.3,
  shieldGap: 3.8, // palm lengths between the hands, at most, to raise it...
  shieldGapRelease: 4.8, // ...and to keep it while it is up
  shieldLevel: 2, // palm lengths of height difference between the hands, at most
  // The Shield is pushed and held, so it only starts once both hands are about still: hands
  // sweeping past each other (a Water circle, a swipe) pass through the pose without raising it.
  shieldStillSpeed: 2, // palm lengths a second, over the last shieldStillMs (a slow Water circle's hands go about 2.5)
  shieldStillMs: 66,
  // A Water circle slows down as the hands meet, which looks like the Shield's still pose. So
  // while the hands are drawing one (each went outward and came back in, over the last
  // circleTraceMs), the Shield waits until they have been still for shieldCircleHoldMs; and
  // it waits after a Water cast until they part.
  circleTraceMs: 1700, // as long as circleMaxMs, so a slow circle is seen whole
  circleOutBack: 0.5, // palm lengths each hand must have gone outward and come back
  shieldCircleHoldMs: 320,
  turnClear: 0.15, // below this the hand is side-on to the camera and counts as neither
  // The Shield needs each palm to face the camera squarely: its turn (about 0.7 straight on,
  // falling with the cosine of the angle away) at least this, so within about 50 degrees.
  shieldSquare: 0.45,
  // ...and every finger out straight, not merely open: each finger's tip at least shieldReach
  // times as far from the wrist as its middle joint (about 1.33 dead straight), and no finger
  // bent more than about 37 degrees at its middle joint (shieldBend is the cosine).
  shieldReach: 1.25,
  shieldBend: 0.8,
  // Which way the palms must read for the Shield. A mirrored webcam reads palms as backs;
  // calibration (calibration.mjs) notices and sets this to 'back'.
  shieldFacing: 'palm',

  // Dodge: one hand swiped outward (left hand to the left, right hand to the right) while the
  // other stays still. Only outward strokes count, so the stroke back to the middle never does.
  dodgeLookbackMs: 170,
  dodgeSpeed: 4.5, // palm lengths per second: enough for a swipe
  dodgeDistance: 0.9,
  dodgeStraightness: 1.1, // sideways travel at least this many times the up-and-down
  dodgeStillSpeed: 4, // the other hand must move slower than this, any way, meanwhile...
  dodgeStillShare: 0.6, // ...or under this share of the swiping hand's speed (the body sways along)
  // A stroke that starts with the hands this close (palm lengths) might be the start of a Water
  // circle, whose other hand follows a moment later. So it waits dodgeCircleWaitMs: if the other
  // hand stays still it is a dodge after all, and if it moves it was a circle.
  dodgeApartMin: 2.6,
  dodgeCircleWaitMs: 220,
  // A fast swipe often blurs the hand out of tracking. If it vanishes, or comes back after a
  // gap, having already gone this far outward at swipe speed, that still counts.
  dodgeLostDistance: 0.45,
  dodgeGapMs: 80, // a gap in tracking at least this long is a loss
  dodgeSettleSpeed: 3, // outward speed under this (still, or coming back) re-arms the next swipe...
  dodgeSettleMs: 66, // ...measured over just this long, so swipes can follow each other closely
  lockAfterDodgeMs: 50, // after a dodge, the next spell (another dodge) can come this soon
  // A swipe is made with the back of the hand to the camera (the opposite of the Shield's
  // facing): at least this share of the stroke's frames must read that way.
  dodgeBackShare: 0.5,

  // Water: each hand sweeps round the circle's centre, the two in opposite directions.
  circleMaxMs: 1700, // the whole circle within this long...
  circleMinMs: 250, // ...and no quicker
  circleTogether: 3.8, // palm lengths apart, at most, where the hands start and meet again: brackets "( )" need not touch
  circleMinSpan: 1.6, // palm lengths from where they start to where they meet: the circle's size
  circleMinSweep: 60, // degrees each hand goes round the centre, at least
  // Each hand swings out to its own side, beyond where it started and ended, by at least this
  // share of the span: what tells a circle from the hands sliding along side by side.
  circleBulge: 0.2,

  skyfallPrimeMs: 150,
  skyfallZoneY: 0.5, // palm centre above this fraction of the frame counts as raised
  skyfallLookbackMs: 400,
  skyfallGraceMs: 500,
  skyfallDropFrame: 0.2,
  skyfallDropPalms: 1.8,
};

function measure(hand, aspect) {
  const { image } = hand;
  const average = axis => PALM_POINTS.reduce((sum, id) => sum + image[id][axis], 0) / PALM_POINTS.length;
  return {
    x: average('x') * aspect,
    y: average('y'),
    palm: Math.max(1e-4, Math.hypot((image[9].x - image[0].x) * aspect, image[9].y - image[0].y)),
    turn: turnOf(image, aspect),
    // Same mapping as the first-person hand view: -1 is the left of the view, +1 the right.
    nx: Math.min(1, Math.max(-1, (0.5 - image[0].x) * 2.4)),
  };
}

/**
 * Which way the hand faces, as seen from the camera: the turn from the index knuckle to the
 * little-finger knuckle around the wrist. Its sign flips between palm and back, and between a
 * left and a right hand, but not when the hand tilts. Scaled by palm size, so roughly -0.7 to
 * 0.7 when facing straight on.
 */
function turnOf(image, aspect) {
  const ax = (image[5].x - image[0].x) * aspect, ay = image[5].y - image[0].y;
  const bx = (image[17].x - image[0].x) * aspect, by = image[17].y - image[0].y;
  const palm = Math.max(1e-4, Math.hypot((image[9].x - image[0].x) * aspect, image[9].y - image[0].y));
  return (ax * by - ay * bx) / (palm * palm);
}

/** 'palm', 'back' or 'side'. A left hand's palm turns one way, a right hand's the other. */
export function facingOf(turn, realSide, clear = MOTION_DEFAULTS.turnClear) {
  if (Math.abs(turn) < clear) return 'side';
  return (turn > 0) === (realSide === 'left') ? 'palm' : 'back';
}

export class MotionCaster {
  constructor({ options = {}, filter = {}, pose = {}, poseSource = 'world' } = {}) {
    this.options = { ...MOTION_DEFAULTS, ...options };
    this.poseOptions = pose;
    this.poseSource = poseSource;
    this.filters = { left: new PoseFilter(filter), right: new PoseFilter(filter) };
    this.reset();
  }

  reset() {
    this.filters.left.reset();
    this.filters.right.reset();
    this.hands = Object.fromEntries(HANDS.map(side => [side, {
      history: [],
      latest: null,
      latestAt: -Infinity,
      pose: 'missing',
      poseSince: 0,
      primed: false,
      primeLeftAt: null,
      lockUntil: -Infinity,
      swipe: { armed: false, armedAt: 0, lostChecked: -1 },
    }]));
    this.shieldScore = 0;
    this.shieldDetail = '';
    this.shieldReading = null;
    this.release = null;
    this.palmsForward = false;
    this.shieldSince = null;
    this.shieldFired = false;
    this.skyfallSince = null;
    this.skyfallPrimedAt = null;
    this.circleSince = -Infinity;
    this.shieldStillSince = null;
    this.dodgeWaiting = null;
    this.lastCheck = '';
  }

  /** After a spell: no hand fires for a moment, and a swipe needs the hand to slow down first. */
  lockHands(now, ms = this.options.lockAfterCastMs) {
    for (const side of HANDS) {
      this.hands[side].lockUntil = now + ms;
      this.hands[side].swipe.armed = false;
    }
  }

  /** The newest sample at least lookback ms old, or the oldest one available. */
  sampleBefore(state, now, lookback) {
    const { history } = state;
    for (let i = history.length - 1; i >= 0; i -= 1) {
      if (now - history[i].t >= lookback) return history[i];
    }
    return history[0] ?? null;
  }

  track(side, hand, now, aspect) {
    const state = this.hands[side];
    const landmarks = hand ? (this.poseSource === 'image' ? hand.image : hand.world ?? hand.image) : null;
    const raw = classifyPose(landmarks, this.poseOptions);
    state.straight = landmarks ? fingerStraightness(landmarks) : null;
    const pose = this.filters[side].update(raw, now);
    if (pose !== state.pose) {
      state.pose = pose;
      state.poseSince = now;
    }
    if (hand) {
      const sample = { ...measure(hand, aspect), t: now };
      state.latest = sample;
      state.latestAt = now;
      state.history.push(sample);
      while (state.history.length && now - state.history[0].t > this.options.historyMs) state.history.shift();
    } else if (now - state.latestAt > this.options.trackingGraceMs) {
      state.history = [];
      state.latest = null;
    }
    return raw;
  }

  /**
   * Watches for both open palms pushed toward the camera, side by side and level. Fingers up or
   * tilted both count. A throw's hand opening beside the other open hand must not start a
   * shield, so it cannot start while the hands are locked after a cast or a fist is primed.
   */
  updateShieldPose(hands, now) {
    const o = this.options;
    const { left, right } = this.hands;
    let forward = false;
    let detail = 'needs both hands';
    this.shieldReading = null;
    if (hands.left && hands.right && left.latest && right.latest) {
      const a = left.latest, b = right.latest;
      const facing = { left: facingOf(a.turn, 'left', o.turnClear), right: facingOf(b.turn, 'right', o.turnClear) };
      const palm = (a.palm + b.palm) / 2;
      const gap = Math.abs(a.x - b.x) / palm;
      const level = Math.abs(a.y - b.y) / palm;
      const straight = HANDS.every(side => {
        const f = this.hands[side].straight;
        return f && f.reach >= o.shieldReach && f.bend >= o.shieldBend;
      });
      const open = left.pose === 'open' && right.pose === 'open' && straight;
      const still = HANDS.every(side => (this.travel(this.hands[side], now, o.shieldStillMs)?.speed ?? 0) <= o.shieldStillSpeed);
      if (still) this.shieldStillSince ??= now;
      else this.shieldStillSince = null;
      const circling = HANDS.every(side => this.wentOutAndBack(side, now));
      // A push brings the hands together or holds them; a circle opens them out. So the Shield
      // never starts while the gap between them is widening.
      const earlier = this.gapAt(now - 100);
      const parting = earlier !== null && gap - earlier > 0.2;
      const afterWater = now - this.circleSince < 1200 && gap < o.shieldGapRelease;
      const waiting = circling && (this.shieldStillSince === null || now - this.shieldStillSince < o.shieldCircleHoldMs);
      // Parting hands also cancel a Shield still forming (a pause at the top of a circle).
      const blocked = (!this.palmsForward && (now < left.lockUntil || now < right.lockUntil || left.primed || right.primed || !still || waiting || afterWater)) || (parting && !this.shieldFired);
      const square = Math.min(Math.abs(a.turn), Math.abs(b.turn)); // the less square of the two palms
      this.shieldReading = { left: facing.left, right: facing.right, gap, level, open, straight, square };
      forward = open && !blocked && facing.left === o.shieldFacing && facing.right === o.shieldFacing && square >= o.shieldSquare
        && gap <= (this.palmsForward ? o.shieldGapRelease : o.shieldGap) && level <= o.shieldLevel;
      detail = `L ${facing.left} R ${facing.right}, square ${square.toFixed(2)}, ${gap.toFixed(1)} palms apart, ${level.toFixed(1)} off level`
        + (open ? '' : straight ? ' (both must be open)' : ' (straighten every finger)') + (blocked ? ' (just cast)' : '');
    }
    this.shieldScore += ((forward ? 1 : 0) - this.shieldScore) * o.shieldVoteRate;
    this.palmsForward = this.shieldScore >= (this.palmsForward ? o.shieldOff : o.shieldOn);
    this.shieldDetail = `shield ${this.shieldScore.toFixed(2)}: ${detail}`;
  }

  /**
   * Whether this hand has gone outward (away from the other) and come back in over the last
   * circleTraceMs, as each hand does drawing a Water circle. A push into the Shield only comes in.
   */
  wentOutAndBack(side, now) {
    const o = this.options;
    const samples = this.hands[side].history.filter(sample => now - sample.t <= o.circleTraceMs);
    if (samples.length < 3) return false;
    const out = side === 'left' ? 1 : -1; // raw x grows toward the left of the view
    const start = samples[0], end = samples[samples.length - 1];
    const farthest = Math.max(...samples.map(sample => out * sample.x));
    // A circle ends at the other pole from where it began; lowering the hands and pushing them
    // forward again (a second Shield) comes back to the same height.
    const rose = Math.abs(end.y - start.y) / end.palm;
    return rose >= o.circleMinSpan * 0.75 && (farthest - out * start.x) / end.palm >= o.circleOutBack && (farthest - out * end.x) / end.palm >= o.circleOutBack;
  }

  /** True on the one frame the shield goes up. The hands must drop or part before it can again. */
  updateShield(now) {
    if (!this.palmsForward) {
      if (this.shieldSince !== null) this.lockHands(now); // lowering the hands must not read as a spell
      this.shieldSince = null;
      this.shieldFired = false;
      return false;
    }
    this.shieldSince ??= now;
    if (this.shieldFired || now - this.shieldSince < this.options.shieldHoldMs) return false;
    this.shieldFired = true;
    return true;
  }

  updateSkyfall(now) {
    const { left, right } = this.hands;
    const o = this.options;
    const raised = this.shieldSince === null && left.pose === 'fist' && right.pose === 'fist' && left.latest && right.latest
      && left.latest.y < o.skyfallZoneY && right.latest.y < o.skyfallZoneY;
    if (raised) {
      this.skyfallSince ??= now;
      if (now - this.skyfallSince >= o.skyfallPrimeMs) this.skyfallPrimedAt = now;
    } else {
      this.skyfallSince = null;
    }
    if (this.skyfallPrimedAt === null) return false;
    if (now - this.skyfallPrimedAt > o.skyfallGraceMs) {
      this.skyfallPrimedAt = null;
      return false;
    }
    if (raised || !left.latest || !right.latest) return false;
    const dropped = side => {
      const state = this.hands[side];
      const before = this.sampleBefore(state, now, o.skyfallLookbackMs);
      if (!before) return false;
      const drop = state.latest.y - before.y;
      return drop >= o.skyfallDropFrame && drop / state.latest.palm >= o.skyfallDropPalms;
    };
    if (!dropped('left') || !dropped('right')) return false;
    this.skyfallPrimedAt = null;
    return true;
  }

  get skyfallForming() {
    return this.skyfallSince !== null || this.skyfallPrimedAt !== null;
  }

  /** How far and fast a hand has moved in any direction over the given window. */
  travel(state, now, lookback) {
    if (!state.latest) return null;
    const before = this.sampleBefore(state, now, lookback);
    if (!before || now === before.t) return null;
    const distance = Math.hypot(state.latest.x - before.x, state.latest.y - before.y) / state.latest.palm;
    return { distance, speed: distance / ((now - before.t) / 1000) };
  }

  /**
   * True on the frame both hands finish a Water circle: they were together (circleTogether) at
   * one point, are together again at another at least circleMinSpan away, and in between each
   * went at least circleMinSweep degrees round the midpoint, the two in opposite directions, each
   * swinging out to its own side of the line between the two points.
   */
  updateCircle(now) {
    const o = this.options;
    const { left, right } = this.hands;
    // Not blocked by a raised Shield: a slow circle can raise one on the way, and still counts.
    if (!left.latest || !right.latest) return false;
    if (now < left.lockUntil || now < right.lockUntil) return false;
    if (left.pose === 'fist' || right.pose === 'fist' || left.primed || right.primed) return false;
    const palm = (left.latest.palm + right.latest.palm) / 2;
    const apart = (a, b) => Math.hypot(a.x - b.x, a.y - b.y) / palm;
    const mid = (a, b) => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });
    if (apart(left.latest, right.latest) > o.circleTogether) return false;
    // The two hands' samples, paired by time, since the last circle.
    const rightAt = new Map(right.history.map(sample => [sample.t, sample]));
    const pairs = left.history.filter(sample => sample.t > this.circleSince && rightAt.has(sample.t)).map(sample => [sample, rightAt.get(sample.t)]);
    const end = mid(left.latest, right.latest);
    for (let i = 0; i < pairs.length; i += 1) {
      const [l0, r0] = pairs[i];
      const age = now - l0.t;
      if (age > o.circleMaxMs) continue;
      if (age < o.circleMinMs) break;
      if (apart(l0, r0) > o.circleTogether) continue;
      const start = mid(l0, r0);
      const span = apart(start, end);
      if (span < o.circleMinSpan) continue;
      const centre = mid(start, end);
      const axis = { x: (end.x - start.x) / (span * palm), y: (end.y - start.y) / (span * palm) };
      const round = hand => {
        let sweep = 0, previous = null, side = 0, first = null, last = 0;
        for (let j = i; j < pairs.length; j += 1) {
          const p = pairs[j][hand];
          const angle = Math.atan2(p.y - centre.y, p.x - centre.x);
          if (previous !== null) sweep += Math.atan2(Math.sin(angle - previous), Math.cos(angle - previous));
          previous = angle;
          // Signed distance from the start-to-end line: which side it swung out to, and how far.
          const off = (axis.x * (p.y - centre.y) - axis.y * (p.x - centre.x)) / palm;
          if (Math.abs(off) > Math.abs(side)) side = off;
          first ??= off;
          last = off;
        }
        return { sweep: (sweep * 180) / Math.PI, side, bulge: Math.abs(side) - Math.max(Math.abs(first), Math.abs(last)) };
      };
      const l = round(0), r = round(1);
      const swept = Math.abs(l.sweep) >= o.circleMinSweep && Math.abs(r.sweep) >= o.circleMinSweep && Math.sign(l.sweep) === -Math.sign(r.sweep);
      const bulged = l.bulge >= o.circleBulge * span && r.bulge >= o.circleBulge * span && Math.sign(l.side) === -Math.sign(r.side);
      if (!swept || !bulged) continue;
      this.circleSince = now;
      this.lastCheck = `water: round ${Math.abs(l.sweep).toFixed(0)}° and ${Math.abs(r.sweep).toFixed(0)}°, ${span.toFixed(1)} palms across`;
      return true;
    }
    return false;
  }

  /** How far and fast a hand has moved sideways over the dodge lookback, or the given window. */
  sideways(state, now, lookback = this.options.dodgeLookbackMs) {
    const before = this.sampleBefore(state, now, lookback);
    if (!before || now === before.t) return null;
    const dx = state.latest.x - before.x, dy = state.latest.y - before.y;
    const distance = Math.abs(dx) / state.latest.palm;
    return { dx, dy, distance, speed: distance / ((now - before.t) / 1000) };
  }

  /** The share of this hand's frames over the last lookback ms with its back to the camera. */
  backShare(state, side, now, lookback) {
    const back = this.options.shieldFacing === 'palm' ? 'back' : 'palm';
    const frames = state.history.filter(sample => now - sample.t <= lookback);
    if (!frames.length) return 0;
    return frames.filter(sample => facingOf(sample.turn, side, this.options.turnClear) === back).length / frames.length;
  }

  /** Sideways motion of this hand between the samples nearest `from` and `to` (ms). */
  motionBetween(state, from, to) {
    const end = [...state.history].reverse().find(sample => sample.t <= to) ?? null;
    const start = [...state.history].reverse().find(sample => sample.t <= from) ?? state.history[0] ?? null;
    if (!start || !end || end.t <= start.t) return null;
    const dx = end.x - start.x, dy = end.y - start.y;
    const distance = Math.abs(dx) / end.palm;
    return { dx, dy, distance, speed: distance / ((end.t - start.t) / 1000), from: start.t, to: end.t };
  }

  /**
   * This hand's outward swipe: -1 for the left hand out to the left (in the view), +1 for the
   * right hand out to the right, otherwise 0. Inward strokes, such as bringing the hand back to
   * the middle, never count. A swipe counts once; the hand re-arms as soon as it stops moving
   * outward. When tracking loses the hand mid-swipe (fast hands blur), what it had already done
   * before it vanished, or the jump to where it reappears, can still count.
   */
  handSwipe(side, now) {
    const state = this.hands[side];
    const swipe = state.swipe;
    const o = this.options;
    const outward = side === 'left' ? -1 : 1;
    if (!state.latest || this.shieldFired) {
      Object.assign(swipe, { armed: false, lostChecked: -1 });
      return 0;
    }
    const dirOf = m => (m.dx < 0 ? 1 : -1); // raw x falling moves right in the view
    const fresh = state.latestAt === now;
    const previous = fresh ? state.history[state.history.length - 2] : null;
    const gap = previous ? now - previous.t : 0;

    if (!swipe.armed) {
      if (!fresh) return 0;
      // Re-arms once the hand is not moving outward: still, or on its way back.
      const settle = this.sideways(state, now, o.dodgeSettleMs);
      const outwardSpeed = settle ? (dirOf(settle) === outward ? settle.speed : 0) : Infinity;
      if (outwardSpeed < o.dodgeSettleSpeed) Object.assign(swipe, { armed: true, armedAt: this.sampleBefore(state, now, o.dodgeSettleMs).t });
      return 0;
    }
    if (now < state.lockUntil) return 0;

    let m = null, lost = false;
    if (fresh) {
      // Only motion since it re-armed; across a gap in tracking, back to before the gap.
      const window = Math.min(now - swipe.armedAt, gap >= o.dodgeGapMs ? gap + o.dodgeLookbackMs : o.dodgeLookbackMs);
      m = this.motionBetween(state, now - window, now);
      lost = gap >= o.dodgeGapMs;
    } else if (now - state.latestAt >= o.dodgeGapMs && swipe.lostChecked !== state.latestAt) {
      // The hand has vanished: judge what it did up to its last sample.
      swipe.lostChecked = state.latestAt;
      m = this.motionBetween(state, Math.max(swipe.armedAt, state.latestAt - o.dodgeLookbackMs), state.latestAt);
      lost = true;
    }
    if (!m) return 0;
    const distanceNeeded = lost ? o.dodgeLostDistance : o.dodgeDistance;
    if (dirOf(m) !== outward || m.distance < distanceNeeded || m.speed < o.dodgeSpeed || Math.abs(m.dx) < Math.abs(m.dy) * o.dodgeStraightness) return 0;
    if (this.backShare(state, side, now, Math.max(o.dodgeLookbackMs, now - m.from)) < o.dodgeBackShare) {
      this.lastCheck = `swipe ${side}: the back of the hand must face the camera`;
      return 0;
    }
    Object.assign(swipe, { armed: false, speed: m.speed, distance: m.distance, lost });
    return outward;
  }

  /** Whether this hand is still enough (or out of view) while the other one swipes: in any direction. */
  heldStill(side, now, swipeSpeed = 0) {
    const state = this.hands[side];
    if (!state.latest) return true;
    const m = this.travel(state, now, this.options.dodgeLookbackMs);
    return !m || m.speed < Math.max(this.options.dodgeStillSpeed, this.options.dodgeStillShare * swipeSpeed);
  }

  /** Palm lengths between the hands at time t (from their history), or null without both. */
  gapAt(t) {
    const [a, b] = HANDS.map(side => [...this.hands[side].history].reverse().find(sample => sample.t <= t) ?? this.hands[side].history[0]);
    if (!a || !b) return null;
    return Math.abs(a.x - b.x) / ((a.palm + b.palm) / 2);
  }

  /**
   * -1 or +1 when one hand swipes outward while the other holds still: one lane that way.
   * Both hands moving (parting for a Water circle, swaying together) is no dodge.
   */
  updateDodge(now) {
    const o = this.options;
    const swipes = { left: this.handSwipe('left', now), right: this.handSwipe('right', now) };
    if (this.shieldFired) {
      this.dodgeWaiting = null;
      return 0;
    }
    // A swipe that began with the hands together waits a moment to see whether the other hand
    // follows (a Water circle) or stays still (a dodge).
    const waiting = this.dodgeWaiting;
    if (waiting) {
      const other = waiting.side === 'left' ? 'right' : 'left';
      if (!this.heldStill(other, now)) {
        this.dodgeWaiting = null;
        this.lastCheck = `swipe ${waiting.side}: the other hand followed, so a Water circle`;
      } else if (now - waiting.at >= o.dodgeCircleWaitMs) {
        this.dodgeWaiting = null;
        this.lastCheck = `dodge: ${waiting.side} hand (hands were close, waited for a circle)`;
        return waiting.dir;
      }
    }
    for (const side of HANDS) {
      if (!swipes[side]) continue;
      const other = side === 'left' ? 'right' : 'left';
      const swipe = this.hands[side].swipe;
      if (!this.heldStill(other, now, swipe.speed)) {
        this.lastCheck = `swipe ${side}: keep the ${other} hand still`;
        continue;
      }
      const gap = this.gapAt(now - o.dodgeLookbackMs);
      if (gap !== null && gap < o.dodgeApartMin) {
        this.dodgeWaiting = { side, dir: swipes[side], at: now };
        continue;
      }
      this.lastCheck = `dodge: ${side} hand, ${swipe.speed.toFixed(1)} palms/s${swipe.lost ? ' (tracking lost mid-swipe)' : ''}`;
      return swipes[side];
    }
    return 0;
  }

  /** Returns { cast } or { failed } when a primed fist resolves, otherwise null. */
  updateThrow(side, now) {
    const state = this.hands[side];
    const o = this.options;
    if (this.skyfallForming || this.shieldSince !== null) {
      state.primed = false;
      state.primeLeftAt = null;
      return null;
    }
    if (state.pose === 'fist') {
      state.primeLeftAt = null;
      if (now - state.poseSince >= o.throwPrimeMs) state.primed = true;
      return null;
    }
    if (!state.primed) return null;
    state.primeLeftAt ??= now;
    if (state.pose === 'open' && state.latest) {
      state.primed = false;
      if (now < state.lockUntil) return null; // the lock only blocks firing, not holding a fist
      const before = this.sampleBefore(state, now, o.snapLookbackMs);
      const travel = before ? Math.hypot(state.latest.x - before.x, state.latest.y - before.y) / state.latest.palm : 0;
      const growth = before ? state.latest.palm / before.palm : 1;
      this.lastCheck = `throw ${side}: travel ${travel.toFixed(2)} growth ${growth.toFixed(2)}`;
      this.release = { hand: side, travel, growth };
      if (travel >= o.snapDistance || growth >= o.snapGrowth) {
        return { cast: { spell: 'Throw', hand: side, aim: state.latest.nx } };
      }
      return { failed: 'throw-no-snap' };
    }
    if (now - state.primeLeftAt > o.throwReleaseWindowMs) state.primed = false;
    return null;
  }

  handStatus(side, now) {
    const state = this.hands[side];
    const o = this.options;
    if (this.shieldSince !== null) {
      const progress = Math.min(1, (now - this.shieldSince) / o.shieldHoldMs);
      return { role: 'shield', status: 'Palms forward', progress };
    }
    if (this.skyfallPrimedAt !== null) return { role: 'skyfall', status: 'Slam down', progress: 1 };
    if (this.skyfallSince !== null) return { role: 'skyfall', status: 'Hold high', progress: Math.min(1, (now - this.skyfallSince) / o.skyfallPrimeMs) };
    if (state.pose === 'missing') return { role: 'idle', status: 'Not visible', progress: 0 };
    if (state.primed) return { role: 'throw', status: 'Snap and open', progress: 1 };
    if (state.pose === 'fist') return { role: 'throw', status: 'Hold the fist', progress: Math.min(1, (now - state.poseSince) / o.throwPrimeMs) };
    return { role: 'idle', status: state.pose === 'open' ? 'Open hand' : 'Relaxed', progress: 0 };
  }

  /** hands: { left: {image, world}|null, right: ... }. now: milliseconds. aspect: frame width/height. */
  update(hands, now, { aspect = 16 / 9 } = {}) {
    this.release = null;
    const raw = {
      left: this.track('left', hands.left, now, aspect),
      right: this.track('right', hands.right, now, aspect),
    };
    this.updateShieldPose(hands, now);

    let cast = null, failed = null, dodge = 0;
    if (this.updateShield(now)) {
      cast = { spell: 'Shield', hand: 'right' };
    } else if (this.updateSkyfall(now)) {
      cast = { spell: 'Skyfall', hand: 'right' };
    } else if (this.updateCircle(now)) {
      cast = { spell: 'Water', hand: 'both' };
    } else if ((dodge = this.updateDodge(now))) {
      cast = { spell: 'Dodge', hand: 'right', dir: dodge };

    } else {
      for (const side of HANDS) {
        const result = this.updateThrow(side, now);
        if (result?.failed) failed = result.failed;
        if (result?.cast) {
          cast = result.cast;
          break;
        }
      }
    }
    const lockMs = { Skyfall: this.options.lockAfterSlamMs, Water: this.options.lockAfterCircleMs, Dodge: this.options.lockAfterDodgeMs }[cast?.spell] ?? this.options.lockAfterCastMs;
    if (cast) this.lockHands(now, lockMs);

    const states = { left: this.handStatus('left', now), right: this.handStatus('right', now) };
    const aimHand = HANDS.find(side => this.hands[side].primed);
    const forming = this.shieldSince !== null ? 'Shield' : this.skyfallForming ? 'Skyfall' : aimHand ? 'Throw' : HANDS.some(side => states[side].role === 'throw') ? 'Throw' : null;

    return {
      poses: { left: this.hands.left.pose, right: this.hands.right.pose },
      raw,
      states,
      forming,
      primed: Boolean(aimHand) || this.skyfallPrimedAt !== null,
      shielding: this.shieldSince !== null,
      shieldCheck: this.shieldDetail,
      shieldReading: this.shieldReading, // { left, right, gap, level, open } with both hands in view
      release: this.release, // { hand, travel, growth } on the frame a primed fist opens
      aim: aimHand ? this.hands[aimHand].latest?.nx ?? null : null,
      cast,
      failed,
      lastCheck: this.lastCheck,
    };
  }
}
