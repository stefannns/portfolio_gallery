// Calibration: the player does each motion a few times and the thresholds are fitted to how
// they move. No rendering here: feed it the MotionCaster and its result every frame, read its
// state to draw the panel, and when it is done, fitSettings() gives MotionCaster options.
//
// Swipes are measured the way the detector judges them (MotionCaster.sideways: sideways speed
// and distance over the dodge lookback), so a fitted threshold means the same thing to both.

import { MOTION_DEFAULTS } from './motions.mjs';

export const CALIBRATION_STEPS = [
  { id: 'rest', title: 'Hold still', say: 'Raise both hands where the camera sees them, relaxed, and keep them still.', holdMs: 2000 },
  { id: 'swipe', title: 'Swipes', say: 'Back of the hand to the screen, swipe one hand quickly outward: left hand to the left, or right hand to the right. Keep the other hand still. Bring it back between swipes.', count: 4 },
  { id: 'throw', title: 'Throws', say: 'Make a fist and hold it, then snap it forward as you open your hand.', count: 3 },
  { id: 'shield', title: 'Shield', say: 'Push both palms toward the screen, fingers up, as if pressing on a wall, and hold them there. Keep your hands as far apart as feels natural.', holdMs: 2000 },
];

const HANDS = ['left', 'right'];
const QUIET_MS = 150; // a burst of movement ends once the hand has been slow this long
const STEP_PAUSE_MS = 900; // a finished step stays on screen this long before the next

const median = values => {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted.length ? sorted[sorted.length >> 1] : NaN;
};
const percentile = (values, p) => {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted.length ? sorted[Math.min(sorted.length - 1, Math.floor(p * sorted.length))] : NaN;
};
const clamp = (value, low, high) => Math.min(high, Math.max(low, value));
const round = (value, places = 2) => Math.round(value * 10 ** places) / 10 ** places;

/** Splits each hand's movement into bursts: from speeding up to having slowed for QUIET_MS. */
class Bursts {
  constructor() {
    this.active = { left: null, right: null };
    this.recent = [];
  }

  update(caster, now, startSpeed) {
    const finished = [];
    for (const side of HANDS) {
      const state = caster.hands[side];
      const m = state.latest ? caster.sideways(state, now) : null;
      const speed = m?.speed ?? 0;
      let burst = this.active[side];
      if (speed >= startSpeed) {
        burst ??= this.active[side] = { side, start: now, end: now, speed: 0, distance: 0, dir: 0, peakAt: now, quietSince: null };
        if (speed > burst.speed) {
          burst.speed = speed;
          burst.peakAt = now;
          burst.dir = m.dx < 0 ? 1 : -1; // as the detector: raw x falling is right in the view
        }
        burst.distance = Math.max(burst.distance, m.distance);
        burst.end = now;
        burst.quietSince = null;
      } else if (burst) {
        burst.quietSince ??= now;
        if (now - burst.quietSince >= QUIET_MS || !state.latest) {
          this.active[side] = null;
          finished.push(burst);
          this.recent.push(burst);
        }
      }
    }
    this.recent = this.recent.filter(burst => now - burst.end < 2000);
    return finished;
  }

  /** The other hand's burst that overlapped this one in time, finished or still going. */
  partner(burst) {
    const other = burst.side === 'left' ? 'right' : 'left';
    const overlaps = b => b.side === other && b.start <= burst.end + QUIET_MS && b.end >= burst.start - QUIET_MS;
    return this.recent.find(b => b !== burst && overlaps(b)) ?? (this.active[other] && overlaps(this.active[other]) ? this.active[other] : null);
  }
}

export class Calibrator {
  constructor() {
    this.measurements = {};
    this.begin(0);
  }

  get step() {
    return CALIBRATION_STEPS[this.index] ?? null;
  }

  get done() {
    return this.index >= CALIBRATION_STEPS.length;
  }

  begin(index, now = 0) {
    this.index = index;
    this.startedAt = now;
    this.heldMs = 0;
    this.lastAt = null;
    this.samples = [];
    this.message = '';
    this.finishedAt = null;
    this.bursts = new Bursts();
  }

  /** Starts the current step again from nothing. */
  redo(now) {
    delete this.measurements[this.step.id];
    this.begin(this.index, now);
  }

  /** Leaves this step's settings as they are. */
  skip(now) {
    delete this.measurements[this.step.id];
    this.begin(this.index + 1, now);
  }

  /** 0 to 1 through the current step. */
  get progress() {
    const step = this.step;
    if (!step) return 1;
    return step.holdMs ? Math.min(1, this.heldMs / step.holdMs) : Math.min(1, this.samples.length / step.count);
  }

  /** Movement below this is resting jitter, not a gesture. */
  get startSpeed() {
    return Math.max(2.5, 1.5 * (this.measurements.rest?.speed ?? 1.5));
  }

  /** Feed every frame: the caster after its update(), that update's result, and the time. */
  update(caster, gesture, now) {
    if (this.done) return;
    if (this.finishedAt !== null) {
      if (now - this.finishedAt >= STEP_PAUSE_MS) this.begin(this.index + 1, now);
      return;
    }
    const step = this.step;
    const dt = this.lastAt === null ? 0 : Math.min(100, now - this.lastAt);
    this.lastAt = now;
    const both = HANDS.every(side => caster.hands[side].latest);
    if (step.id === 'rest') this.rest(caster, now, dt, both);
    else if (step.id === 'swipe') this.swipes(caster, now);
    else if (step.id === 'throw') this.throws(gesture);
    else if (step.id === 'shield') this.shield(caster, gesture, dt);
    if (this.progress >= 1) {
      this.measurements[step.id] = this.summarise(step.id);
      this.finishedAt = now;
      this.message = 'Got it';
    }
  }

  rest(caster, now, dt, both) {
    if (!both) {
      this.message = 'Both hands need to be in view';
      return;
    }
    this.message = '';
    this.heldMs += dt;
    for (const side of HANDS) {
      const m = caster.sideways(caster.hands[side], now);
      if (m) this.samples.push({ speed: m.speed });
    }
    const { left, right } = caster.hands;
    const palm = (left.latest.palm + right.latest.palm) / 2;
    this.samples.push({ gap: Math.abs(left.latest.x - right.latest.x) / palm, palm });
  }

  /**
   * Counts one hand swiped outward (left hand to the left, right hand to the right) while the
   * other stays still, as a dodge is. Inward strokes, bringing the hand back, are ignored.
   */
  swipes(caster, now) {
    for (const burst of this.bursts.update(caster, now, this.startSpeed)) {
      if (burst.distance < 0.5) continue; // a twitch
      const outward = burst.side === 'left' ? -1 : 1;
      if (burst.dir !== outward) continue; // bringing the hand back
      const partner = this.bursts.partner(burst);
      if (partner && partner.speed >= 0.5 * burst.speed) {
        this.message = 'Keep the other hand still';
        continue;
      }
      this.samples.push({ speed: burst.speed, distance: burst.distance });
      this.message = '';
    }
  }

  throws(gesture) {
    const release = gesture?.release;
    if (!release) return;
    if (release.travel < 0.15 && release.growth < 1.02) {
      this.message = 'Snap it forward as you open your hand';
      return;
    }
    this.message = '';
    this.samples.push({ travel: release.travel, growth: release.growth });
  }

  /**
   * The Shield as it is cast: both palms pushed toward the screen, like pressing on a wall, as far
   * apart as the player likes. What tells it from resting hands is the push: the palms come
   * toward the camera and look bigger than at rest (or, failing that, the hands are clearly
   * closer together than at rest). Never "bring your hands together": that is praying, not a wall.
   */
  shield(caster, gesture, dt) {
    const reading = gesture?.shieldReading;
    if (!reading) {
      this.message = 'Both hands need to be in view';
      return;
    }
    if (!reading.open) {
      this.message = reading.straight === false ? 'Straighten every finger, palms toward the screen' : 'Open both hands, palms toward the screen';
      return;
    }
    if (reading.left !== reading.right || reading.left === 'side') {
      this.message = 'Turn both palms to face the screen';
      return;
    }
    if (reading.level > 3) {
      this.message = 'Hold your hands at the same height';
      return;
    }
    const rest = this.measurements.rest;
    const { left, right } = caster.hands;
    const palm = (left.latest.palm + right.latest.palm) / 2;
    const pushed = rest?.palm ? palm >= 1.12 * rest.palm || reading.gap <= 0.8 * rest.gap : reading.gap <= 4.5;
    if (!pushed) {
      this.message = 'Push your palms toward the screen, as if pressing on a wall';
      return;
    }
    this.message = '';
    this.heldMs += dt;
    this.samples.push(reading);
  }

  summarise(id) {
    const s = this.samples;
    if (id === 'rest') {
      const still = s.filter(x => 'gap' in x);
      return { speed: round(percentile(s.filter(x => 'speed' in x).map(x => x.speed), 0.9)), gap: round(median(still.map(x => x.gap))), palm: round(median(still.map(x => x.palm)), 4) };
    }
    if (id === 'swipe') return { speed: round(median(s.map(x => x.speed))), distance: round(median(s.map(x => x.distance))) };
    if (id === 'throw') return { travel: round(median(s.map(x => x.travel))), growth: round(median(s.map(x => x.growth)), 3) };
    // Shield: how far apart and how level the hands sit, and which way the palms read most.
    const facings = s.flatMap(x => [x.left, x.right]);
    const count = kind => facings.filter(f => f === kind).length;
    const facing = count('back') > count('palm') ? 'back' : 'palm';
    return { gap: round(median(s.map(x => x.gap))), level: round(median(s.map(x => x.level))), square: round(median(s.map(x => x.square))), facing, facingShare: round(Math.max(count('back'), count('palm')) / Math.max(1, facings.length)) };
  }
}

/**
 * MotionCaster options fitted to the measurements; steps that were skipped keep their defaults.
 * Calibration only ever makes motions easier to cast: each threshold drops to sit well inside
 * what the player did, but never rises above its default. The one exception is resting jitter:
 * the swipe bar stays clear of it, and a shaky hand gets a looser "still enough" to re-arm.
 */
export function fitSettings(measurements, defaults = MOTION_DEFAULTS) {
  const { rest, swipe, throw: snap, shield } = measurements;
  const settings = {};
  const jitter = rest?.speed ?? 0;
  const atMost = (value, limit, floor = -Infinity) => Math.max(floor, Math.min(limit, value));
  const jitterFloor = Math.max(3, jitter * 2.5);
  if (rest && jitter * 1.5 > defaults.dodgeSettleSpeed) settings.dodgeSettleSpeed = round(Math.min(5, jitter * 1.5));
  if (swipe) {
    settings.dodgeSpeed = round(atMost(0.6 * swipe.speed, defaults.dodgeSpeed, jitterFloor));
    settings.dodgeDistance = round(atMost(0.6 * swipe.distance, defaults.dodgeDistance, 0.6));
  } else if (jitterFloor > defaults.dodgeSpeed) {
    settings.dodgeSpeed = round(jitterFloor);
  }
  if (snap) {
    settings.snapDistance = round(atMost(0.5 * snap.travel, defaults.snapDistance, 0.25));
    settings.snapGrowth = round(atMost(1 + 0.5 * (snap.growth - 1), defaults.snapGrowth, 1.03), 3);
  }
  if (shield) {
    // Wide enough for their pose, but kept under how far apart their hands sit at rest, so
    // resting hands with the palms toward the camera never raise it.
    const widest = rest?.gap ? 0.93 * rest.gap : 5.5;
    settings.shieldGap = round(Math.max(defaults.shieldGap, Math.min(5.5, widest, shield.gap * 1.3 + 0.6)));
    settings.shieldGapRelease = round(settings.shieldGap + 1);
    settings.shieldLevel = round(Math.max(defaults.shieldLevel, Math.min(3.5, shield.level * 1.5 + 0.8)));
    if (shield.facingShare >= 0.6) settings.shieldFacing = shield.facing;
    // A camera that reads their palms less square than most gets a lower bar (never a higher one).
    if (shield.square) settings.shieldSquare = round(atMost(0.75 * shield.square, defaults.shieldSquare, 0.25));
  }
  // Drop anything left at its default, so the summary shows only real changes.
  for (const key of Object.keys(settings)) if (settings[key] === defaults[key]) delete settings[key];
  return settings;
}

/** What changed, for the summary: [{ key, label, before, after }]. */
export function describeSettings(settings, defaults = MOTION_DEFAULTS) {
  const LABELS = {
    dodgeSpeed: 'Swipe speed (palms/s)',
    dodgeDistance: 'Swipe distance (palms)',
    dodgeSettleSpeed: 'Still enough to swipe again',
    snapDistance: 'Throw snap travel (palms)',
    snapGrowth: 'Throw snap toward camera',
    shieldGap: 'Shield: hands apart, at most',
    shieldLevel: 'Shield: height difference, at most',
    shieldFacing: 'Shield: palms read as',
    shieldSquare: 'Shield: how squarely palms face',
  };
  return Object.keys(LABELS).filter(key => key in settings).map(key => ({ key, label: LABELS[key], before: defaults[key], after: settings[key] }));
}

const STORAGE_KEY = 'wizardDuel.calibration';

/** The saved calibration ({ savedAt, settings, measurements }), or null. Never throws. */
export function loadCalibration(storage = globalThis.localStorage) {
  try {
    const saved = JSON.parse(storage?.getItem(STORAGE_KEY) ?? 'null');
    return saved && typeof saved.settings === 'object' ? saved : null;
  } catch {
    return null;
  }
}

export function saveCalibration(calibration, storage = globalThis.localStorage) {
  try {
    storage?.setItem(STORAGE_KEY, JSON.stringify(calibration));
    return true;
  } catch {
    return false;
  }
}

export function clearCalibration(storage = globalThis.localStorage) {
  try {
    storage?.removeItem(STORAGE_KEY);
  } catch {}
}
