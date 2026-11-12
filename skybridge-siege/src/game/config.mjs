// Every duel balance number lives here. Times are milliseconds, distances metres.
// [easy, hard] pairs interpolate as the enemy loses health.

// The Warden stands just inside the far edge of the painted ring. Speeds and sizes measured at
// his distance scale with it, so timing and aim feel the same as at the original 10 m.
const ENEMY_DISTANCE = 16.6;
const FAR = ENEMY_DISTANCE / 10;
// He grows from his feet, so he stays on the same spot of the floor at any size.
const WARDEN_SCALE = 1.6;

export const DUEL_CONFIG = {
  playerHp: 100,
  enemyHp: 240,
  restartLockMs: 1400,
  arena: {
    eyeY: 1.6,
    enemyZ: -ENEMY_DISTANCE,
    enemyCenterY: 1.8 * WARDEN_SCALE, // fireballs fly at the middle of his body
    wardenScale: WARDEN_SCALE,
    playerPlaneZ: -0.7,
    staffOffset: { x: 0.85, y: 3.05, z: 0.2 },
  },
  throw: {
    damage: 20,
    speed: 16 * FAR,
    cooldownMs: 700,
    // Fireballs always home in. Where the fist points only sets which way one leaves before it
    // bends onto the Warden: this many metres aside at his distance from the edge of the view.
    aimRange: 4.5 * FAR,
  },
  // Left, centre and right, this far apart in metres: wide enough that a hex in the next lane
  // clearly passes beside you. The floor painting is zoomed enough to slide this far.
  lanes: { offset: 2, cooldownMs: 50 }, // swipes can follow each other closely
  // The shield lasts less time than a hex takes to fly, so it has to be timed to the arrival.
  shield: { durationMs: 900, cooldownMs: 1500 },
  skyfall: { damage: 30, cooldownMs: 9000, stunMs: 1000 },
  // Water Ball: homes in like a fireball, weaker, but landing while he charges puts the hex out,
  // and every hit that lands soaks him: for soakMs everything he does runs at soakSlow speed
  // (longer charges and pauses, slower hexes). Hits while soaked top it up.
  water: { damage: 15, speed: 16 * FAR, cooldownMs: 4000, soakMs: 4500, soakSlow: 0.6 },
  // A hex drops off the staff into your lane, and is lined up with it by `laneJoin` of the way
  // to you, then flies straight down the lane at `height`, past you if you have moved.
  bolt: { damage: 20, speed: [7 * FAR, 9.5 * FAR], hitHalfWidth: 0.7, height: 1.5, laneJoin: 0.6 },
  enemy: {
    // He stands still in the middle. Since fireballs never miss, his ward is his defence: besides
    // raising it after a hit, he often raises it as a fireball comes in, more as he weakens.
    openingDelayMs: 2400,
    wardChance: [0.4, 0.7],
    wardReactMs: 150,
    idleMs: [2000, 1000],
    telegraphMs: [1600, 1100],
    recoverMs: [1000, 700],
    staggerMs: 320,
    wardMs: 1300,
    // The unstoppable double hex: a longer charge (chargeScale times his usual), then hexes down
    // two lanes at once. He picks the one lane he will spare as the charge starts and lights the
    // two he will hit. No Shield blocks it and no Water Ball douses it: the only way out is the
    // safe lane, and the long charge gives time to get there. Never his first attack; likelier
    // as he weakens.
    double: { chance: [0.22, 0.45], chargeScale: 1.7 },
  },
};
