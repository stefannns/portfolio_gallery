require('libs/tt-adapter.js');
const Phaser = require('libs/phaser.js');

const res = tt.getSystemInfoSync();
const windowWidth = res.screenWidth;    // 1080
const windowHeight = res.screenHeight;  // 1920

// ---------------------------------------------------------------------------
// Tunables
// ---------------------------------------------------------------------------
const GROUND_SURFACE_Y = 1650;          // world-y of the flat surface top (collider top)
const GROUND_THICKNESS = 240;           // collider thickness under the surface
const GROUND_WIDTH = 880;               // landing-surface width (matches the plank)
const DROP_GAP = 1060;                  // held animal hovers this far above the tower top.
// Bigger than before so the platform starts lower on screen (surface at 192 + DROP_GAP =
// ~1252, ~65% down), letting the tall crate platform sit near the bottom of the screen.
// platform.png: a crate whose flat tabletop is the landing surface; the body hangs below.
const PLATFORM_DISPLAY_W = 900;         // on-screen width of the platform image
// (bigger = platform sits lower on screen at the start, since the camera pins the held
// animal near the top; also lengthens the initial fall)
// The held animal sits at screen y = ARM_LEN + CLAW_FRAC*height, and the tower top
// DROP_GAP below that — so these two together decide how much tower is visible above
// the DROP button. They were tuned for a low button; raising it for the TikTok safe
// area meant pulling the whole frame up so the button stopped covering the stack.
// Camera framing only — neither affects the physics or the drop height.
// Held animal sits at screen y = ARM_LEN + CLAW_FRAC*height. That is now set so the
// pinching hand's top edge lands just off the top of the screen (hand top = held y -
// HAND_PINCH_Y*handScale ≈ 203), making it read as reaching in from above rather than
// floating with a visible cropped wrist. Side benefit: the tower gets more headroom
// above the DROP button.
const CLAW_FRAC = 0.05;                 // claw pivot screen position from the top (camera follows it)

const ARM_LEN = 96;                     // vertical offset of the hold row from the camera top
// Fixed screen y of the HAND's pinch point. The hand is drawn scrollFactor 0 with this
// constant y (only its x sweeps), and every animal hangs from it — so the hand stays
// glued to the top of the screen and never moves vertically per animal or per camera.
const HAND_PINCH_SCREEN_Y = 195;

// Two control schemes, toggled live by the switch button in the bottom left:
//   'drag'  — drag to aim, tap to rotate, DROP button releases
//   'slide' — animal tracks back and forth on its own, tap anywhere to drop, no rotate
const MODE_KEY = 'animalStackerMode';
// AUTO-only for now. Flip to true to bring back the DRAG/AUTO switch on the title screen
// and let the player choose. ALL drag-mode code (drag-to-aim, tap-to-rotate, DROP button)
// is kept intact below and simply stays dormant while this is false — nothing to rewrite
// to re-enable it.
const MODE_SWITCH_ENABLED = false;
const SLIDE_AMP = 380;                  // half-width of the automatic left-right travel
const SLIDE_PERIOD = 4200;              // ms for a full left->right->left pass

const ROT_STEP = Math.PI / 6;           // 30 deg per tap while holding
const ROT_HINT_TAPS = 1;                // hide the rotate hint after this many taps
const DENSITY = 0.0016;
// Once an animal comes to rest it gets "planted": heavier and grippier, so the tower
// resists being shoved by the next drop. Matter combines contact friction with min()
// and frictionStatic with max(), so the friction bump bites on planted-vs-planted and
// planted-vs-ground contacts — a still-falling animal (0.9) still sets the friction of
// its own landing contact.
const SETTLED_MASS_MULT = 4;            // x heavier once planted
const SETTLED_FRICTION = 1.8;           // kinetic grip once planted (vs 0.9 in flight)
const SETTLED_FRICTION_STATIC = 1.4;    // static grip once planted (vs 0.7 in flight)
// A mass jump on its own can backfire: a heavy body resting on thin legs overloads the
// contact solver and the stack creeps. The damping does the anti-shove work without
// destabilising contacts. Set back to 0.006 to turn planting damping off.
const SETTLED_AIR = 0.12;               // air damping once planted (vs 0.006 in flight)
const PX_PER_CM = 6;                    // world px -> "cm" for the height score
// Settle detection dominates the drop-to-next-animal cycle (measured: fall ~0.8s,
// settle ~1.6s of the 2.4s total). Tightened for a snappier cadence — more drops fit
// in the 30s round. SETTLE_MS = how long an animal must hold still to count as landed;
// SETTLE_TIMEOUT = failsafe that plants a still-rocking animal so the game never stalls
// (it was the 5s outliers that made some drops feel dead).
const SETTLE_MS = 200;                  // still this long -> counts as settled
const SETTLE_TIMEOUT = 2200;            // failsafe: always settle eventually
const RESPAWN_DELAY = 140;              // brief grace before the next animal loads
// Global physics rate. Matter multiplies each step's integration delta by the engine's
// timing.timeScale, so this is a true fast-forward: gravity, impacts, settling and
// damping all speed up together, with no change to the tuning above.
const PHYSICS_SPEED = 1.45;

// Terminal fall speed, as a safety net for pathological falls only. A normal drop
// covers DROP_GAP and free-falls to ~15 px/step, so anything at or below ~15 clips the
// back half of every drop to a constant speed — which reads as the animal easing off
// mid-air. The per-frame landing clamp below is what actually prevents penetration;
// this cap is not load-bearing for that.
// Per-step, so it has to scale with PHYSICS_SPEED or the cap starts clipping again.
// Expressed per BASE_STEP_MS and rescaled each frame, since the step is now the real
// frame delta rather than a fixed 1/60.
const MAX_FALL_SPEED = 18 * PHYSICS_SPEED * PHYSICS_SPEED;

// Physics advances exactly one step per rendered frame, using that frame's delta.
// Matter's own runner instead accumulates real time and drains it in fixed 1/60 chunks,
// so unless the display is exactly 60Hz it steps twice on one frame and once on the
// next: the animal jumps a big distance, then a small one, every other frame. That
// uneven stepping is what reads as stuttering / slowing down in mid-air (measured
// 1.72 steps/frame in a 2,1,2,2,1 pattern at a 34Hz render rate; a 120Hz display gets
// the opposite, 0,1,0,1, where every other frame doesn't move at all).
// Max camera pan speed, px per BASE_STEP_MS. The camera chases the tower top with an
// exponential ease, which lurches hardest right after an animal lands — exactly when
// the next one is falling. Screen motion is fall + pan, so a big *decaying* pan
// cancels out the fall's acceleration and the animal looks like it's slowing in
// mid-air (measured: pan 27px/frame decaying while the fall rose 2->9, giving a flat
// ~28px/frame on screen). Capping the pan keeps its contribution roughly constant
// while catching up, so the fall's acceleration stays visible. Keep this below ~9:
// the ease-out decay rate is speed*(delta/220), which must stay under the fall's
// ~0.8px/frame^2 acceleration or the cancellation comes back.
const CAM_MAX_PAN = 9;
// Camera eases toward target at this fraction/frame — only between drops (frozen during
// flight), so it never distorts a fall. Higher = snappier catch-up on a tall tower.
const CAM_EASE = 0.16;
// Quiet click on secondary contacts (a real bump between settled animals), throttled and
// gated on impact speed so the tiny settling re-touches (~0 speed) stay silent.
const CONTACT_SFX_VOLUME = 0.16, CONTACT_SFX_MIN_MS = 80, CONTACT_MIN_IMPACT = 1.3;
// ...and how fast that pan speed may itself change, px per BASE_STEP_MS squared. This
// is the number that actually matters: a falling animal accelerates ~0.75px/frame^2, so
// as long as the pan's rate of change stays well under that, apparent speed keeps
// rising and the fall never looks like it eases off.
const CAM_MAX_PAN_ACCEL = 0.25;
// Camera "follow line": screen y the settled tower top is held at ONCE the tower is
// tall. Below this (short tower) the camera stays parked so the platform sits low and
// the stack grows upward on screen without the camera moving — so it no longer lurches
// up from the very first drop. Fall shortens naturally as the tower nears this line.
const CAM_FOLLOW_LINE_Y = 560;

// Blue gradient rising from the bottom edge (replaces the old glass overlay)
const BOTTOM_GRAD_COLOR = 0x0f4c86, BOTTOM_GRAD_ALPHA = 0.8;
// Red gradient (top + bottom edges) shown on the fail / game-over screen
const FAIL_GRAD_COLOR = 0xc11f1f, FAIL_GRAD_ALPHA = 0.8;
// Countdown stopwatch icon (top-left); dial-circle centre is (104,158) in the 208x262 art
const TIMER_ICON_W = 180, TIMER_DIAL_X = 104, TIMER_DIAL_Y = 158;
const TIMER_TEXT_DARK = '#111111', TIMER_TEXT_LOW = '#e23b2f';
// Game-over results panel width (retry button is baked into the panel art)
const RESULT_PANEL_W = 780, RETRY_BTN_W = 470;
// Title-screen PLAY button on-screen width (playbtn.png, 578x186)
const PLAY_BTN_W = 460;

const BASE_STEP_MS = 1000 / 60;
const MIN_STEP_MS = 1000 / 144;         // guard against absurdly small deltas
const MAX_STEP_MS = 1000 / 30;          // cap a frame hitch so one step can't tunnel
const FALL_OFF_Y = GROUND_SURFACE_Y + 160;  // past this = fell off -> game over

const GAME_SECONDS = 20;                 // time limit; stack as high as you can before 0

// TikTok reserves the bottom strip of the screen for its own capture UI (record
// button + shutter ring). Nothing interactive may sit inside it or the player's tap
// hits TikTok's chrome instead of the game. ~21% of a 1920-tall stage.
const TIKTOK_SAFE_BOTTOM = 400;

// Mock TikTok record button on the start screen (red disc in a white ring). Only the
// inner disc pulses; the outer ring is static.
const REC_RED = 0xfe2c55, REC_OUTER = 132, REC_INNER = 102, REC_RING_W = 14;
const REC_BOTTOM_GAP = 320;             // record-button centre this far above the bottom
// Start-screen backdrop (live preview: sweeping hand + ground) placed at the SAME
// screen positions the game uses on its first frame, so pressing record is seamless:
//   held animal at ARM_LEN + CLAW_FRAC*height, ground DROP_GAP below that.
const TITLE_HAND_Y = HAND_PINCH_SCREEN_Y;                  // exactly the game's held pinch y
const TITLE_GROUND_Y = TITLE_HAND_Y + DROP_GAP;            // = game's start ground screen y
const TITLE_LOGO_FRAC = 0.33;           // title logo vertical position (in the sky band)

// Shared button chrome — PLAY and DROP are the same pill so the two screens match
const BTN_W = 440, BTN_H = 130, BTN_R = 30;
const BTN_FILL = 0x54b04a, BTN_OUTLINE = 0x1c1c22, BTN_OUTLINE_W = 8;
const BTN_FONT_SIZE = '64px';
// secondary (mode switch) pill, bottom-left of the title screen
const SW_W = 230, SW_H = 100, SW_FILL = 0x3b82c4, SW_FONT_SIZE = '44px';

// Pinching hand, slide mode only. HAND_PINCH_* is the grip point (where the thumb tip
// meets the fingers) in the source images' shared pixel space; both crops register at
// a common top-left, so one anchor + one scale positions them both.
const HAND_W = 430;                     // on-screen width of handbelow.png
// The two crops do NOT share a top-left — thumbabove.png is 66px wider and sits 46px
// further right in its own canvas, so drawing both from the same anchor put the thumb
// clear of the hand's thumb socket. Solved by matching black-outline pixels: at this
// offset all 10179 of the thumb's outline pixels land on the hand's outline (overlap
// 1.000), which is the only offset that makes the two read as one hand.
const THUMB_DX = -46, THUMB_DY = 0;
const HAND_PINCH_X = 350, HAND_PINCH_Y = 332;
// Per-animal pinch point, hand-tuned in the visual calibrator (/calibrate.html).
// HAND_GRIP_TOP = fraction of the animal's height BELOW its top (pinch Y = top + gripTop*h).
// HAND_GRIP_X   = fraction of its width from the CENTRE, + = right (pinch X = centre + gripX*w).
// The calibrator preview mirrors the game 1:1, so these are literally what was dialled in.
const HAND_GRIP_TOP = {
    axolotl: 0.68, buffalo: 0.65, capybara: 0.57, cat: 0.69, chameleon: 0.61, cow: 0.67,
    crocodile: 0.70, dachshund: 0.27, dolphin: 0.43, elephant: 0.35, elephant2: 0.23, flamingo: 0.16,
    gazelle: 0.63, giraffe: 0.23, gorilla: 0.55, hippo: 0.37,
    lion: 0.26, llama: 0.70, moose: 0.40, ostrich: 0.19, pelican: 0.48, penguin: 0.44,
    seal: 0.26, sheep: 0.44, snake: 0.26, swordfish: 0.53,
    turkey: 0.33, walrus: 0.66, weasel: 0.41, zebra: 0.47
};
const HAND_GRIP_TOP_DEFAULT = 0.20;     // for any key not in the table
const HAND_GRIP_X = {
    axolotl: -0.16, buffalo: 0.03, capybara: -0.27, cat: -0.32, chameleon: -0.22, cow: -0.15,
    crocodile: 0.03, dolphin: -0.02, elephant: -0.04, elephant2: 0.02, flamingo: -0.28,
    gazelle: -0.32, giraffe: -0.10, gorilla: -0.01, hippo: 0.02, lion: 0.09,
    llama: -0.21, moose: 0.05, ostrich: -0.41, pelican: -0.07, penguin: -0.39,
    seal: 0.05, sheep: -0.04, snake: 0.09, swordfish: -0.05, turkey: -0.13,
    walrus: -0.21, weasel: 0.16, zebra: -0.24
};
const HAND_GRIP_X_DEFAULT = 0;

// ONE scale for the whole roster, art and traced collider together (the collider is
// derived from the display size at spawn).
//
// This used to fit each animal into a fixed 210x250 box, which threw away the relative
// sizes the source art already encodes (ladybug 87x73 ... weasel 655x253). The implied
// per-animal factors ranged 0.369 (weasel) to 1.380 (ladybug) — a 3.7x spread — so the
// penguin was blown up 1.22x into the biggest thing on screen while the buffalo was
// squashed to 0.41x and came out smaller than the cat. A single factor keeps the art's
// proportions: biggest ends up ~346x134 (weasel) / 333 tall (flamingo), smallest ~46x39
// (ladybug).
const ANIMAL_SCALE = 0.529;
const BEST_KEY = 'animalStackerBestHeight';

// UI font. Rubik loads via @font-face in the browser preview and via tt.loadFont in
// the effect pack (the returned runtime id must be used as the family name).
// Load the BOLD face, not Rubik-Regular.ttf: that file is a variable font whose
// default instance is Light 300, and neither loader drives the wght axis — so every
// text object here (all of them are fontStyle:'bold') came out Rubik Light.
// Rubik-Bold.ttf is the same font instanced at wght=700.
let FONT = "Rubik, Arial, sans-serif";
try {
    if (typeof tt !== 'undefined' && tt && typeof tt.loadFont === 'function') {
        const id = tt.loadFont('libs/fonts/Rubik-Bold.ttf');
        if (id) FONT = id + ', Rubik, Arial, sans-serif';
    }
} catch (e) {}

// Animal roster: real PNG stickers from assets/animals/. Display size + the
// single-box collider are derived from each image at boot (art fills its bounds).
const ANIMAL_KEYS = ["crocodile","snake","gorilla","penguin","giraffe","hippo",
    "capybara","buffalo","walrus","cat","ostrich",
    "zebra","gazelle","elephant","pelican","moose","sheep","weasel",
    "llama","dolphin","chameleon","axolotl","lion","flamingo","dachshund",
    "swordfish","elephant2","turkey","seal","cow"];
const ANIMALS = [];   // filled at boot: {key, w, h}
let COLLIDERS = {};   // per-animal collider boxes derived from image alpha (normalized)

function loadBest() {
    try { return parseInt(window.localStorage.getItem(BEST_KEY), 10) || 0; } catch (e) { return 0; }
}
function saveBest(v) {
    try { window.localStorage.setItem(BEST_KEY, String(v)); } catch (e) {}
}
// mode persists so RETRY and the title screen keep whatever the switch was left on
function loadMode() {
    try { return window.localStorage.getItem(MODE_KEY) === 'slide' ? 'slide' : 'drag'; } catch (e) { return 'drag'; }
}
function saveMode(m) {
    try { window.localStorage.setItem(MODE_KEY, m); } catch (e) {}
}

// ---------------------------------------------------------------------------
// Boot: build placeholder textures, then start the game.
// ---------------------------------------------------------------------------
class BootScene extends Phaser.Scene {
    constructor() { super('BootScene'); }

    preload() {
        ANIMAL_KEYS.forEach(k => this.load.image(k, 'assets/animals/' + k + '.png'));
        this.load.image('heightmarker', 'assets/ui/heightmarker.png');
        this.load.json('colliders', 'assets/animals/colliders.json');
        this.load.image('glass', 'assets/ui/glass.png');
        this.load.image('title', 'assets/ui/title.png');
        this.load.image('handbelow', 'assets/ui/handbelow.png');
        this.load.image('thumbabove', 'assets/ui/thumbabove.png');
        this.load.image('platform', 'assets/ui/platform.png');
        this.load.image('timericon', 'assets/ui/timericon.png');
        this.load.image('resultpanel', 'assets/ui/resultpanel.png');
        this.load.image('retrybtn', 'assets/ui/retrybtn.png');
        this.load.image('playbtn', 'assets/ui/playbtn.png');
        this.load.audio('land', 'assets/audio/land.mp3');   // animal-landing thud
        this.load.audio('fail', 'assets/audio/fail.mp3');   // game-over fail sting
    }

    create() {
        COLLIDERS = this.cache.json.get('colliders') || {};
        // derive display size (and thus collider size) per animal from its image
        ANIMAL_KEYS.forEach(k => {
            const s = this.textures.get(k).getSourceImage();
            ANIMALS.push({
                key: k,
                w: Math.round(s.width * ANIMAL_SCALE),
                h: Math.round(s.height * ANIMAL_SCALE)
            });
        });
        this.buildDustTexture();
        this.buildRingTexture();
        this.scene.start('TitleScene');
    }

    buildDustTexture() {
        const g = this.make.graphics({ x: 0, y: 0, add: false });
        g.fillStyle(0xffffff, 1);
        g.fillCircle(32, 32, 30);
        g.generateTexture('dust', 64, 64);
        g.destroy();
    }

    buildRingTexture() {
        const g = this.make.graphics({ x: 0, y: 0, add: false });
        g.lineStyle(9, 0xffffff, 1);
        g.strokeCircle(48, 48, 41);
        g.generateTexture('ring', 96, 96);
        g.destroy();
    }
}

// ---------------------------------------------------------------------------
// Title / start screen
// ---------------------------------------------------------------------------
class TitleScene extends Phaser.Scene {
    constructor() { super('TitleScene'); }

    create() {
        const cx = windowWidth / 2;
        paintSky(this, windowWidth, windowHeight);
        addBottomGradient(this, windowWidth, windowHeight);

        // Living backdrop: the same crate platform as the play surface, and the pinching
        // hand sweeping an animal like the game idling — so the start screen feels alive.
        addPlatform(this, cx, TITLE_GROUND_Y, -5);
        this.buildDemoHand();

        // Static timer badge, same art + position as the in-game stopwatch, showing the
        // full time — so the top-left HUD is consistent from the title onward.
        addTimerBadge(this, String(GAME_SECONDS));

        // How-to-play line (white with a black outline) + PLAY button, laid out as ONE
        // group that's vertically centred on the screen with the button close under the
        // text. Lives on the title only, so it vanishes the moment PLAY starts the game.
        const intro = this.add.text(cx, 0, 'Click to drop,\nfind the right spot, and\nsee who can stack the\nhighest!', {
            fontFamily: FONT, fontSize: '58px', color: '#ffffff', fontStyle: 'bold',
            stroke: '#000000', strokeThickness: 9, align: 'center', lineSpacing: 10
        }).setOrigin(0.5).setDepth(5);
        const bs = this.textures.get('playbtn').getSourceImage();
        const btnH = PLAY_BTN_W * bs.height / bs.width;
        const gap = 90;                                   // text-to-button spacing
        const groupTop = windowHeight * 0.5 - (intro.height + gap + btnH) / 2;
        intro.setY(groupTop + intro.height / 2);
        this.buildPlayButton(cx, groupTop + intro.height + gap + btnH / 2);
    }

    // Green PLAY pill (baked art). Tap starts the game and hands off the current sweep
    // phase + demo animal so play continues seamlessly.
    buildPlayButton(cx, cy) {
        const bs = this.textures.get('playbtn').getSourceImage();
        const btnH = PLAY_BTN_W * bs.height / bs.width;
        this.add.image(cx, cy, 'playbtn').setDisplaySize(PLAY_BTN_W, btnH).setDepth(60);
        this.add.zone(cx, cy, PLAY_BTN_W * 1.1, btnH * 1.6).setDepth(61)
            .setInteractive({ useHandCursor: true })
            .on('pointerdown', () => this.scene.start('GameScene', { t: this.demoT, firstKey: this.demoKey }));
    }

    // pinching hand holding one animal, animated in update() with the same sweep as the game
    buildDemoHand() {
        // pick from the same "wide, low" pool the game uses for its first drop, so this
        // exact animal (and sweep phase) can carry straight into the game with no reset
        const pool = ANIMALS.filter(a => a.w >= a.h * 1.4);
        this.demoKey = (Phaser.Utils.Array.GetRandom(pool) || { key: 'penguin' }).key;
        const src = this.textures.get(this.demoKey).getSourceImage();
        this.demoW = src.width * ANIMAL_SCALE;
        this.demoH = src.height * ANIMAL_SCALE;
        this.handBelow = this.add.image(0, 0, 'handbelow').setOrigin(0, 0).setDepth(21);
        this.demoAnimal = this.add.image(0, 0, this.demoKey).setDisplaySize(this.demoW, this.demoH).setDepth(22);
        this.thumbAbove = this.add.image(0, 0, 'thumbabove').setOrigin(0, 0).setDepth(23);
        const hb = this.textures.get('handbelow').getSourceImage();
        const ta = this.textures.get('thumbabove').getSourceImage();
        this.handScale = HAND_W / hb.width;
        this.handBelow.setDisplaySize(hb.width * this.handScale, hb.height * this.handScale);
        this.thumbAbove.setDisplaySize(ta.width * this.handScale, ta.height * this.handScale);
        this.demoT = 0;
        this.positionDemo(windowWidth / 2);
    }

    // Same fixed-pinch scheme as the game (mirrors GameScene.positionHeld): the hand's
    // pinch stays at (·, TITLE_HAND_Y), only its x sweeps, and the animal hangs from it.
    positionDemo(sweepX) {
        const gripTop = HAND_GRIP_TOP[this.demoKey] != null ? HAND_GRIP_TOP[this.demoKey] : HAND_GRIP_TOP_DEFAULT;
        const gripX = HAND_GRIP_X[this.demoKey] != null ? HAND_GRIP_X[this.demoKey] : HAND_GRIP_X_DEFAULT;
        // hand pinch = pure sweep (no snap); the animal carries the grip offset
        this.demoAnimal.setPosition(sweepX - this.demoW * gripX, TITLE_HAND_Y + this.demoH * (0.5 - gripTop));
        const px = sweepX - HAND_PINCH_X * this.handScale;
        const py = TITLE_HAND_Y - HAND_PINCH_Y * this.handScale;
        this.handBelow.setPosition(px, py);
        this.thumbAbove.setPosition(px + THUMB_DX * this.handScale, py + THUMB_DY * this.handScale);
    }

    update(time, delta) {
        if (this.demoT === undefined) return;
        this.demoT += delta;
        const ph = ((this.demoT / SLIDE_PERIOD) + 0.25) % 1;
        const tri = ph < 0.5 ? (ph * 4 - 1) : (3 - ph * 4);
        this.positionDemo(Phaser.Math.Clamp(windowWidth / 2 + tri * SLIDE_AMP, 130, windowWidth - 130));
    }

    // TikTok-style record button: static white ring, pulsing red inner disc. Tap starts.
    buildRecordButton(cx, cy) {
        const ring = this.add.graphics().setDepth(60);
        ring.lineStyle(REC_RING_W, 0xffffff, 1);
        ring.strokeCircle(cx, cy, REC_OUTER);

        const inner = this.add.graphics().setDepth(60);
        inner.fillStyle(REC_RED, 1);
        inner.fillCircle(0, 0, REC_INNER);
        const innerC = this.add.container(cx, cy, [inner]);
        this.tweens.add({ targets: innerC, scale: 0.86, duration: 700, yoyo: true, repeat: -1, ease: 'Sine.inOut' });

        // plain rect zone — a centre-origin custom hit area gets offset by displayOrigin.
        // Hand off the current sweep phase + demo animal so the game continues seamlessly.
        this.add.zone(cx, cy, REC_OUTER * 2.2, REC_OUTER * 2.2).setDepth(61)
            .setInteractive({ useHandCursor: true })
            .on('pointerdown', () => this.scene.start('GameScene', { t: this.demoT, firstKey: this.demoKey }));
    }

    // Control-scheme picker, bottom left. Lives here rather than in-game so the rules
    // can't change underneath a tower that was built under the other scheme.
    buildModeSwitch() {
        // AUTO-only for now: skip the button entirely and lock the mode to slide.
        if (!MODE_SWITCH_ENABLED) { this.mode = 'slide'; return; }
        this.mode = loadMode();
        const sx = 40 + SW_W / 2;
        const sy = windowHeight - TIKTOK_SAFE_BOTTOM - SW_H / 2 - 40;

        const g = this.add.graphics().setDepth(60);
        drawButton(g, sx, sy, SW_W, SW_H, SW_FILL);
        const label = this.add.text(sx, sy, '', {
            fontFamily: FONT, fontSize: SW_FONT_SIZE, color: '#ffffff', fontStyle: 'bold'
        }).setOrigin(0.5).setDepth(61);
        const paint = () => label.setText(this.mode === 'drag' ? 'DRAG' : 'AUTO');
        paint();

        this.add.zone(sx, sy, SW_W, SW_H).setDepth(62)
            .setInteractive({ useHandCursor: true })
            .on('pointerdown', () => {
                this.mode = this.mode === 'drag' ? 'slide' : 'drag';
                saveMode(this.mode);
                paint();
            });
    }

    // Wide-to-narrow tower standing on a plinth of the same ground art as the play
    // surface, auto-scaled to fill the space between the PLAY button and `baseY`.
    // The plinth stays put; the animals sit in a container pivoted on the plinth top
    // so the tower rocks about its base, with a small counter-tilt per animal.
    buildDecoStack(cx, baseY, topY) {
        const stack = ['crocodile', 'hippo', 'gorilla', 'cat', 'penguin'];
        const PLINTH_H = 64, OVERLAP = 0.84;

        const sizes = stack.map(k => ANIMALS.find(o => o.key === k) || { w: 160, h: 120 });
        const rawH = sizes.reduce((s, a) => s + a.h * OVERLAP, 0);
        const scale = Math.min(0.85, (baseY - PLINTH_H - topY) / rawH);

        // plinth is sized off the finished tower so it reads as its base, not a stray bar
        const plinthW = Math.max(...sizes.map(a => a.w)) * scale + 110;
        drawGround(this.add.graphics(), cx - plinthW / 2, baseY - PLINTH_H, plinthW, PLINTH_H);

        // pivot on the plinth top so the rock reads as the whole tower leaning
        const tower = this.add.container(cx, baseY - PLINTH_H);
        let y = 0;   // local: 0 = plinth top, negative = upward
        stack.forEach((k, idx) => {
            const a = sizes[idx];
            const w = a.w * scale, h = a.h * scale;
            const img = this.add.image((idx % 2 ? 18 : -18) * scale, y - h / 2, k)
                .setDisplaySize(w, h).setAngle(idx % 2 ? 2 : -2);
            y -= h * OVERLAP;
            tower.add(img);
            this.tweens.add({
                targets: img, angle: idx % 2 ? -2 : 2,
                duration: 1700 + idx * 130, yoyo: true, repeat: -1, ease: 'Sine.inOut'
            });
        });

        this.tweens.add({
            targets: tower, angle: 1.4, duration: 2600, yoyo: true, repeat: -1, ease: 'Sine.inOut'
        });
        return tower;
    }
}

// ---------------------------------------------------------------------------
// Game
// ---------------------------------------------------------------------------
class GameScene extends Phaser.Scene {
    constructor() { super('GameScene'); }

    create(data) {
        // AUTO-only unless the switch is re-enabled (keeps drag code but never activates it)
        this.mode = MODE_SWITCH_ENABLED ? ((data && data.mode) || loadMode()) : 'slide';
        this.best = loadBest();
        this.animals = [];          // live matter game objects
        this.stackCount = 0;        // animals safely landed (drives the swing ramp)
        this.maxHeightCm = 0;       // the score: max settled tower height
        this.heldRot = 0;           // player-applied rotation on the held animal
        this.gameOver = false;
        // Phaser reuses the scene instance across scene.start, so every run-scoped flag
        // has to be cleared here. Missing `finished` meant the second run's finish()
        // returned early and the game-over screen never appeared; `rotTaps` is compared
        // with === so a stale count stopped the hint from ever fading again.
        this.finished = false;
        this.rotTaps = 0;
        this.timeLeftMs = GAME_SECONDS * 1000;   // countdown; hits 0 -> game over
        this.__shownSecs = -1;
        this.timerStarted = false;   // clock is frozen at GAME_SECONDS until the first drop
        this.dragX = windowWidth / 2;   // drag-mode target x (follows the finger)
        this.awaitingSettle = null;   // the dropped animal we're waiting to settle before reloading

        // claw / dropper state. Carry the sweep phase and the first animal over from the
        // title screen so the hand + animal continue smoothly instead of resetting to centre.
        this.__firstKey = data && data.firstKey;
        this.claw = { gfx: null, animal: null, type: null, state: 'idle', t: (data && data.t) || 0, lastX: 0, lastY: 0, vx: 0, vy: 0 };

        this.matter.world.engine.timing.timeScale = PHYSICS_SPEED;
        // drive the step from update() instead of Matter's time-accumulating runner
        this.matter.world.autoUpdate = false;
        this.stepScale = 1;
        this.camVel = 0;            // rate-limited camera pan speed, px/step

        // Quiet contact click on collisions between ALREADY-landed bodies (settling /
        // jostling). A fresh landing (a still-falling animal's first contact) is NOT this —
        // that gets the loud thud from playLand — so we require both sides to be landed.
        this.matter.world.on('collisionstart', (ev) => {
            if (this.gameOver) return;
            for (const pair of ev.pairs) {
                // Colliders are COMPOUND (fromVertices), and Matter reports the convex
                // PARTS in the pair — parts carry no speed and no gameObject. Read the
                // parent for both, or every contact looks like 0 speed.
                const pa = pair.bodyA.parent || pair.bodyA;
                const pb = pair.bodyB.parent || pair.bodyB;
                const a = pa.gameObject, b = pb.gameObject;
                const aRest = !a || a.__landed;   // ground has no gameObject -> treat as landed
                const bRest = !b || b.__landed;
                // only a real bump, not the gentlest settling drift: gate on the faster
                // body's speed at contact
                const impact = Math.max(pa.speed, pb.speed);
                if ((a || b) && aRest && bRest && impact >= CONTACT_MIN_IMPACT) {
                    this.playContact(impact);
                    return;
                }
            }
        });

        paintSky(this, windowWidth, windowHeight);
        addBottomGradient(this, windowWidth, windowHeight);
        this.buildGround();
        this.buildMaxLine();
        this.buildHud();
        this.claw.gfx = this.add.graphics().setDepth(30);

        this.buildHand();
        this.buildControls();

        // frame the camera with the claw at the top and the surface low below it
        this.cameras.main.setScroll(0, this.camTargetY());

        this.spawnNext();
    }

    // --- world setup -------------------------------------------------------
    buildGround() {
        this.matter.add.rectangle(
            windowWidth / 2, GROUND_SURFACE_Y + GROUND_THICKNESS / 2,
            GROUND_WIDTH, GROUND_THICKNESS,
            { isStatic: true, friction: 1.6, frictionStatic: 0.78, label: 'ground' }
        );
        // crate platform: tabletop surface at GROUND_SURFACE_Y (aligned with the collider top)
        addPlatform(this, windowWidth / 2, GROUND_SURFACE_Y, -5);
    }

    // heightmarker sprite + label marking the max settled height reached
    buildMaxLine() {
        this.maxMarker = this.add.image(windowWidth / 2, 0, 'heightmarker')
            .setDepth(-3).setVisible(false);
        const mk = this.textures.get('heightmarker').getSourceImage();
        this.maxMarker.setDisplaySize(windowWidth, mk.height * windowWidth / mk.width);
        this.maxLabel = this.add.text(28, 0, '', {
            fontFamily: FONT, fontSize: '52px', color: '#ffffff', fontStyle: 'bold',
            stroke: '#000000', strokeThickness: 8
        }).setDepth(40).setOrigin(0, 0).setAlpha(0);
    }

    redrawMaxLine() {
        if (this.maxHeightCm <= 0) { this.maxMarker.setVisible(false); this.maxLabel.setAlpha(0); return; }
        const y = GROUND_SURFACE_Y - this.maxHeightCm * PX_PER_CM;
        this.maxMarker.setPosition(windowWidth / 2, y).setVisible(true);
        // top-aligned just BELOW the marker line (origin 0,0), with a small gap so it
        // clears the line
        this.maxLabel.setText('Height ' + this.maxHeightCm + 'm').setPosition(28, y + 18).setAlpha(1);
    }

    // click/tap to rotate the held animal; DROP button releases it
    buildControls() {
        // DROP sits above TIKTOK_SAFE_BOTTOM so it never lands under the record button
        const bw = BTN_W, bh = BTN_H, bx = windowWidth / 2;
        const by = windowHeight - TIKTOK_SAFE_BOTTOM - bh / 2 - 40;

        this.rotZone = this.add.zone(0, 0, windowWidth, windowHeight).setOrigin(0)
            .setScrollFactor(0).setDepth(40).setInteractive();
        this.rotHintDone = false;
        this.__hintFading = false;
        // tap = rotate (all modes). In drag mode, MOVING the pointer drags the animal
        // by the dragged distance (relative), and a movement-free press stays a tap.
        this.rotZone.on('pointerdown', (pointer) => {
            this.__pressX = pointer.x;
            this.__pressAnimalX = this.dragX;
            this.__pressMoved = false;
        });
        this.rotZone.on('pointermove', (pointer) => {
            if (this.mode !== 'drag' || !pointer.isDown || this.__pressX === undefined) return;
            const dx = pointer.x - this.__pressX;
            if (Math.abs(dx) > 14) this.__pressMoved = true;
            if (this.__pressMoved) {
                this.dragX = Phaser.Math.Clamp(this.__pressAnimalX + dx, 130, windowWidth - 130);
            }
        });
        this.rotZone.on('pointerup', () => {
            // ignore an orphan release with no matching press in THIS scene — e.g. the
            // pointerup from tapping PLAY leaks in here and must not act on the first animal
            if (this.__pressX === undefined) return;
            const wasTap = !this.__pressMoved;
            this.__pressX = undefined;
            if (!wasTap) return;
            if (!this.canDrop || this.gameOver || this.claw.state !== 'swinging') return;
            // drag mode: a clean tap rotates. slide mode: a tap anywhere drops.
            if (this.mode === 'slide') this.release(); else this.applyRotate(ROT_STEP);
        });

        // hint near the held animal; fades on first use
        const holdRow = ARM_LEN + windowHeight * CLAW_FRAC;
        this.rotHint = this.add.text(windowWidth / 2, holdRow + 150, '', {
            fontFamily: FONT, fontSize: '46px', color: '#ffffff', fontStyle: 'bold',
            stroke: '#1d3b5a', strokeThickness: 5
        }).setOrigin(0.5).setScrollFactor(0).setDepth(200).setAlpha(0.8).setVisible(false);

        // drop button — same pill as PLAY on the title screen. Hidden in slide mode,
        // where a tap anywhere drops instead.
        this.dropBtn = this.add.graphics().setScrollFactor(0).setDepth(60);
        drawButton(this.dropBtn, bx, by);
        this.dropText = this.add.text(bx, by, 'DROP', {
            fontFamily: FONT, fontSize: BTN_FONT_SIZE, color: '#ffffff', fontStyle: 'bold'
        }).setOrigin(0.5).setScrollFactor(0).setDepth(61);
        this.dropZone = this.add.zone(bx, by, bw, bh)
            .setScrollFactor(0).setDepth(62).setInteractive();
        this.dropZone.on('pointerdown', (pointer, x, y, event) => {
            event && event.stopPropagation && event.stopPropagation();
            this.release();
        });

        this.applyMode();
    }

    // configure the controls for the mode this run was started in. The mode itself is
    // chosen on the title screen — switching mid-run would change the rules underneath
    // a tower that was built under the other scheme.
    applyMode() {
        const drag = this.mode === 'drag';
        [this.dropBtn, this.dropText].forEach(o => o && o.setVisible(drag));
        if (this.dropZone) { if (drag) this.dropZone.setInteractive(); else this.dropZone.disableInteractive(); }
        this.rotHint.setText(drag ? 'click to rotate' : 'click to drop');
    }

    // --- pinching hand (slide mode only) -----------------------------------
    // handbelow + thumbabove are two crops of ONE hand that register at a shared
    // top-left origin, so both are drawn at origin (0,0) from the same anchor with the
    // same scale. The held animal sits between them (hand 21 / animal 22 / thumb 23),
    // which is what sells the pinch.
    buildHand() {
        // scrollFactor 0: the hand is screen-fixed so the camera never shifts it
        this.handBelow = this.add.image(0, 0, 'handbelow').setOrigin(0, 0).setDepth(21).setScrollFactor(0).setVisible(false);
        this.thumbAbove = this.add.image(0, 0, 'thumbabove').setOrigin(0, 0).setDepth(23).setScrollFactor(0).setVisible(false);
        const hb = this.textures.get('handbelow').getSourceImage();
        const ta = this.textures.get('thumbabove').getSourceImage();
        this.handScale = HAND_W / hb.width;
        this.handBelow.setDisplaySize(hb.width * this.handScale, hb.height * this.handScale);
        this.thumbAbove.setDisplaySize(ta.width * this.handScale, ta.height * this.handScale);
    }

    // The hand's pinch point is FIXED at screen y HAND_PINCH_SCREEN_Y — its y never
    // changes, only its x sweeps. The hand is kept VISIBLE and positioned every frame
    // (including the brief gap between drops) so it never flickers; the ANIMAL is what
    // appears/disappears. Each animal hangs so its calibrated grip point (gripTop below
    // the top, gripX from centre) lands on the fixed pinch — the inverse of the old
    // "move the hand to the animal".
    // The hand's pinch is exactly the sweep point (pinchX = sweepX) — NO per-animal
    // offset — so the hand glides smoothly and never snaps when a new animal loads.
    positionHand(sweepX) {
        const px = sweepX - HAND_PINCH_X * this.handScale;
        const py = HAND_PINCH_SCREEN_Y - HAND_PINCH_Y * this.handScale;   // constant y
        this.handBelow.setVisible(true).setPosition(px, py);
        this.thumbAbove.setVisible(true).setPosition(px + THUMB_DX * this.handScale, py + THUMB_DY * this.handScale);
    }

    // The ANIMAL carries the per-animal offset (gripX/gripTop): it shifts so its grip
    // point lands on the fixed sweep pinch. So the animal moves per animal, the hand doesn't.
    positionAnimal(sweepX) {
        const a = this.claw.animal;
        if (!a || !this.claw.type) return;
        const key = this.claw.type.key;
        const gripTop = (HAND_GRIP_TOP[key] != null) ? HAND_GRIP_TOP[key] : HAND_GRIP_TOP_DEFAULT;
        const gripX = (HAND_GRIP_X[key] != null) ? HAND_GRIP_X[key] : HAND_GRIP_X_DEFAULT;
        a.setRotation(this.mode === 'drag' ? this.heldRot : 0);
        a.setPosition(sweepX - this.claw.type.w * gripX, HAND_PINCH_SCREEN_Y + this.claw.type.h * (0.5 - gripTop));
    }

    // place both (used at spawn so nothing flashes at the wrong spot for a frame)
    positionHeld(sweepX) {
        if (this.mode === 'slide') this.positionHand(sweepX); else this.hideHand();
        this.positionAnimal(sweepX);
    }

    hideHand() {
        this.handBelow.setVisible(false);
        this.thumbAbove.setVisible(false);
    }

    applyRotate(d) {
        this.heldRot += d;
        this.rotTaps = (this.rotTaps || 0) + 1;
        if (this.rotTaps === ROT_HINT_TAPS) this.fadeHint();
    }

    // fade the "click to rotate" / "click to drop" hint away, once, after first use
    fadeHint() {
        if (this.rotHintDone || this.__hintFading) return;
        this.__hintFading = true;
        this.tweens.add({
            targets: this.rotHint, alpha: 0, duration: 300, ease: 'Quad.out',
            onComplete: () => { this.rotHintDone = true; }
        });
    }

    hideControls() {
        [this.rotZone, this.dropZone].forEach(z => z && z.disableInteractive());
        [this.dropBtn, this.dropText].forEach(o => o && o.setAlpha(0));
        this.rotHint && this.rotHint.setVisible(false);
        this.timerText && this.timerText.setVisible(false);
        this.timerIcon && this.timerIcon.setVisible(false);
        this.hideHand();
    }

    // show the rotate hint only while an animal is held (until first use)
    positionRotArrows() {
        const holding = !!(this.claw.animal && this.canDrop && !this.gameOver);
        this.rotHint.setVisible(holding && !this.rotHintDone);
    }

    buildHud() {
        // Countdown as a stopwatch icon in the top-left, with the seconds inside its dial.
        const badge = addTimerBadge(this, '');
        this.timerIcon = badge.icon;
        this.timerText = badge.text;
        this.updateTimer();
    }

    // repaint the timer only when the whole-second value changes
    updateTimer() {
        const secs = Math.max(0, Math.ceil(this.timeLeftMs / 1000));
        if (secs === this.__shownSecs) return;
        this.__shownSecs = secs;
        this.timerText.setText(String(secs));
        this.timerText.setColor(secs <= 5 ? TIMER_TEXT_LOW : TIMER_TEXT_DARK);   // red under the wire
    }

    refreshHud() { /* height reads off the marker line; no top HUD */ }

    // Collider = the animal's traced silhouette outline (normalized polygon in
    // assets/animals/colliders.json, from scripts/gen_colliders.py). Matter's
    // fromVertices decomposes the concave outline into convex parts using
    // window.decomp (libs/decomp.js). Follows curves as angled segments; no
    // chamfer, so nothing degenerates on thin limbs.
    buildAnimalBody(x, y, a, rot) {
        const M = Phaser.Physics.Matter.Matter;
        const opts = { friction: 0.9, frictionStatic: 0.7, restitution: 0, frictionAir: 0.006, density: DENSITY };
        const poly = COLLIDERS[a.key];
        // Build the collider in TEXTURE pixels, not display pixels. setDisplaySize()
        // below drives scaleX/scaleY, and Phaser's matter transform component pipes
        // those straight into Matter's Body.scale — so a body built at display size
        // gets shrunk a SECOND time by displaySize/textureSize (e.g. buffalo 210px
        // art ended up with a 75px collider). Texture-sized in, display-sized out.
        const src = this.textures.get(a.key).getSourceImage();
        const tw = src.width, th = src.height;
        const sprite = this.matter.add.image(x, y, a.key, null, opts).setDepth(10);
        if (poly && poly.length >= 3) {
            // outline in texture-centred pixel coords; centroid gives the art offset
            const verts = poly.map(p => ({ x: p[0] * tw - tw / 2, y: p[1] * th - th / 2 }));
            const com = M.Vertices.centre(verts);
            const body = M.Bodies.fromVertices(x, y, [verts], opts, true, 0.01, 0.01);
            if (body) {
                sprite.setExistingBody(body, true);
                sprite.setDisplaySize(a.w, a.h);
                // origin is a texture fraction, so the centroid offset is scale-free
                sprite.setOrigin(0.5 + com.x / tw, 0.5 + com.y / th);
                // The body pivots on its centroid, but (x, y) is where the player had the
                // ART centred while aiming. Offset by the rotated centroid so the animal
                // stays exactly where it was aimed instead of jumping on release.
                sprite.setRotation(rot || 0);
                const off = new Phaser.Math.Vector2(com.x * a.w / tw, com.y * a.h / th).rotate(rot || 0);
                sprite.setPosition(x + off.x, y + off.y);
                return sprite;
            }
        }
        // fallback: a plain box if the outline is missing/degenerate
        sprite.setBody({ type: 'rectangle', width: tw, height: th }, opts);
        sprite.setDisplaySize(a.w, a.h);
        sprite.setRotation(rot || 0);
        sprite.setPosition(x, y);
        return sprite;
    }

    // --- drop cycle --------------------------------------------------------
    spawnNext() {
        if (this.gameOver) return;
        // first animal: reuse the one shown on the title screen (seamless start) if given,
        // otherwise a wide, low one so the base is a fair foundation
        let type;
        if (this.animals.length === 0 && this.__firstKey) {
            type = ANIMALS.find(a => a.key === this.__firstKey) || Phaser.Utils.Array.GetRandom(ANIMALS);
            this.__firstKey = null;
        } else {
            const pool = this.animals.length === 0 ? ANIMALS.filter(a => a.w >= a.h * 1.4) : ANIMALS;
            type = Phaser.Utils.Array.GetRandom(pool);
        }
        this.claw.type = type;
        // NOTE: claw.t is deliberately NOT reset — in slide mode the sweep continues from
        // where the previous animal was released (see heldX). It only starts at 0 on a
        // fresh scene (create() re-inits claw).
        this.claw.state = 'swinging';

        // screen-fixed sprite (scrollFactor 0); positionHeld places it under the fixed hand
        const img = this.add.image(this.heldX(), HAND_PINCH_SCREEN_Y, type.key).setDepth(22).setScrollFactor(0);
        img.setDisplaySize(type.w, type.h);
        this.claw.animal = img;
        this.heldRot = 0;           // each animal starts unrotated
        this.canDrop = true;
        this.positionHeld(this.heldX());   // place animal + hand for this animal
        this.claw.lastX = img.x;
        this.claw.lastY = img.y;
        this.claw.lastRot = 0;
        this.claw.vx = 0; this.claw.vy = 0;
    }

    release() {
        if (!this.canDrop || this.claw.state !== 'swinging' || this.gameOver) return;
        this.canDrop = false;
        this.fadeHint();          // hint disappears after the first drop
        this.timerStarted = true; // the countdown begins on the first drop

        const img = this.claw.animal;
        // the held animal is screen-fixed (scrollFactor 0), so its y is a SCREEN row —
        // convert to world for the physics body (x has no scroll, so it carries over)
        const ax = img.x, ay = this.cameras.main.scrollY + img.y, rot = img.rotation, type = this.claw.type;
        img.destroy();
        this.claw.animal = null;

        // continue exactly from the swing: same rotation, same on-screen placement -> no snap.
        // NOTE: do NOT call setFixedRotation() — it locks inertia to Infinity so the body
        // can never rotate, freezing every block at its landing tilt. Normal bodies rotate freely.
        const body = this.buildAnimalBody(ax, ay, type, rot);
        // both modes drop straight down
        body.setVelocity && body.setVelocity(0, 2);
        // no inherited spin: a released object falls at its orientation, it doesn't keep swinging
        body.setAngularVelocity && body.setAngularVelocity(0);
        body.__spawnTime = this.time.now;
        body.__landed = false;
        this.animals.push(body);

        // claw opens & retracts; the next animal loads almost immediately.
        // claw.t is left running so the slide sweep stays continuous across drops.
        this.claw.state = 'releasing';
        this.awaitingSettle = body;
        this.awaitingSince = this.time.now;
    }

    // Load the next animal right after release — do NOT wait for the dropped one to
    // settle. The previous animal still plants on its own stillness timer in update(),
    // so nothing about stacking breaks; this just removes the dead pause between drops.
    updateRespawn() {
        const b = this.awaitingSettle;
        if (!b || this.gameOver) return;
        const gone = !b.body;                                   // fell off / destroyed
        // brief grace so the released animal clears the drop point before the next
        // appears (avoids the two visually overlapping at spawn)
        const graced = this.time.now - this.awaitingSince > RESPAWN_DELAY;
        if (gone || graced) {
            this.awaitingSettle = null;
            this.spawnNext();
        }
    }

    // distance from this body's bottom to the nearest surface below (ground, or the
    // top of an animal it x-overlaps). Used only to avoid overshooting on landing.
    gapBelow(b) {
        const bot = b.body.bounds.max.y;
        let gap = Infinity;
        if (Math.abs(b.body.position.x - windowWidth / 2) <= GROUND_WIDTH / 2 + 40) {
            const g = GROUND_SURFACE_Y - bot;
            if (g >= -3) gap = Math.min(gap, Math.max(g, 0));
        }
        for (const o of this.animals) {
            if (o === b || !o.body) continue;
            const ob = o.body.bounds;
            if (b.body.bounds.max.x > ob.min.x && b.body.bounds.min.x < ob.max.x) {
                const g = ob.min.y - bot;
                if (g >= -3) gap = Math.min(gap, Math.max(g, 0));
            }
        }
        return gap === Infinity ? null : gap;
    }

    // "plant" a settled animal: heavier, grippier, strongly damped. Body.setDensity
    // scales mass AND inertia off the compound's summed part area, so the whole hull
    // gets heavier, not just part 0. Sticky, like __landed — an animal knocked loose
    // later stays planted rather than flickering back to its in-flight weight.
    plantAnimal(b) {
        if (!b.body) return;
        const M = Phaser.Physics.Matter.Matter;
        M.Body.setDensity(b.body, DENSITY * SETTLED_MASS_MULT);
        // contact props are read off the parent body, so setting them here covers every part
        b.body.friction = SETTLED_FRICTION;
        b.body.frictionStatic = SETTLED_FRICTION_STATIC;
        b.body.frictionAir = SETTLED_AIR;
    }

    // settled enough to count: asleep, or effectively motionless
    isAtRest(b) {
        return !!(b.body && (b.body.isSleeping || (b.body.speed < 0.2 && Math.abs(b.body.angularSpeed) < 0.01)));
    }

    // --- height / camera ---------------------------------------------------
    towerTopWorldY() {
        // only settled animals count -> the camera holds still while a new one falls into view
        let top = GROUND_SURFACE_Y;
        for (const b of this.animals) {
            if (!b.body || !b.__landed) continue;
            const minY = b.body.bounds.min.y;
            if (minY < top) top = minY;
        }
        return top;
    }

    dropY() {
        return this.towerTopWorldY() - DROP_GAP;
    }

    // current held-animal x. drag: the finger. slide: a triangle wave off claw.t, which
    // is NOT reset between drops, so the sweep is continuous — a new animal appears where
    // the last one was released and keeps moving, instead of snapping back to centre.
    heldX() {
        let ax;
        if (this.mode === 'drag') {
            ax = this.dragX;
        } else {
            const ph = ((this.claw.t / SLIDE_PERIOD) + 0.25) % 1;
            const tri = ph < 0.5 ? (ph * 4 - 1) : (3 - ph * 4);
            ax = windowWidth / 2 + tri * SLIDE_AMP;
        }
        return Phaser.Math.Clamp(ax, 130, windowWidth - 130);
    }

    camTargetY() {
        // Parked scroll keeps the platform low at the start (DROP_GAP below the held row);
        // the camera only rises once the settled tower top climbs past the follow line, so
        // it stays put for the first several drops instead of moving from the first one.
        const parked = GROUND_SURFACE_Y - (HAND_PINCH_SCREEN_Y + DROP_GAP);
        const follow = this.towerTopWorldY() - CAM_FOLLOW_LINE_Y;
        return Math.min(parked, follow);
    }

    // small impact burst when an animal settles: dust spray + a quick ring
    // landing thud (drop1.mp3, trimmed). Slight pitch variation so repeats don't grate.
    playLand() {
        if (this.sound && this.cache.audio.exists('land')) {
            this.sound.play('land', { volume: 0.55, rate: Phaser.Math.FloatBetween(0.92, 1.08) });
        }
    }

    // same sound, much quieter, for secondary contacts (settling/bumping). Throttled so a
    // single jostle that fires many collision pairs doesn't machine-gun the sound.
    playContact(impact) {
        const now = this.time.now;
        if (now - (this.__lastContact || 0) < CONTACT_SFX_MIN_MS) return;
        this.__lastContact = now;
        if (this.sound && this.cache.audio.exists('land')) {
            // a touch louder for harder bumps, but always well under the landing thud
            const vol = Phaser.Math.Clamp(CONTACT_SFX_VOLUME * (impact / CONTACT_MIN_IMPACT), CONTACT_SFX_VOLUME, 0.3);
            this.sound.play('land', { volume: vol, rate: Phaser.Math.FloatBetween(0.9, 1.1) });
        }
    }

    spawnPuff(x, y) {
        const em = this.add.particles(x, y, 'dust', {
            speed: { min: 110, max: 300 },
            angle: { min: 190, max: 350 },      // sprays upward/outward
            scale: { start: 0.42, end: 0 },
            alpha: { start: 0.95, end: 0 },
            lifespan: { min: 320, max: 600 },
            gravityY: 340,
            tint: [0xe8dcc2, 0xcdbf9f, 0xb3a487],
            emitting: false
        }).setDepth(16);
        em.explode(12);
        this.time.delayedCall(1000, () => em.destroy());

        const ring = this.add.image(x, y, 'ring')
            .setDepth(16).setAlpha(0.7).setScale(0.2).setTint(0xcdbf9f);
        this.tweens.add({
            targets: ring, scale: 1.25, alpha: 0,
            duration: 330, ease: 'Quad.out', onComplete: () => ring.destroy()
        });
    }

    update(time, delta) {
        // Fixed-timestep physics: advance Matter by a constant BASE_STEP_MS regardless of
        // the render frame rate, so the fall runs at the same speed on 60Hz, 120Hz, or a
        // throttled webview (e.g. the Lark embed, where variable/clamped deltas used to make
        // it fall too fast). Accumulate real elapsed time and run whole fixed steps.
        // On a 60Hz display delta ~= BASE_STEP_MS, so this matches the old behaviour exactly.
        this._physAcc = (this._physAcc || 0) + Math.min(delta, MAX_STEP_MS);
        let steps = 0;
        while (this._physAcc >= BASE_STEP_MS && steps < 5) {   // cap guards against a hitch spiral
            this.matter.world.step(BASE_STEP_MS);
            this._physAcc -= BASE_STEP_MS;
            steps++;
        }
        this.stepScale = 1;   // steps are constant now -> fallCap == MAX_FALL_SPEED

        // countdown runs in real time (wall-clock delta), but only after the first drop
        if (this.timerStarted && !this.gameOver && !this.finished) {
            this.timeLeftMs -= delta;
            if (this.timeLeftMs <= 0) {
                this.timeLeftMs = 0;
                this.updateTimer();
                this.triggerGameOver(false);   // time-up: not a fall, no red
            } else {
                this.updateTimer();
            }
        }

        if (this.claw.state === 'releasing') this.claw.state = 'idle';
        // Keep the hand visible and gliding every frame in slide mode — including the brief
        // respawn gap between drops — so it never blinks out on placement. The sweep runs
        // continuously; only the held ANIMAL comes and goes.
        if (!this.gameOver && this.claw.type) {
            if (this.mode === 'slide' || this.claw.state === 'swinging') this.claw.t += delta;
            const ax = this.heldX();
            if (this.mode === 'slide') this.positionHand(ax); else this.hideHand();
            if (this.claw.state === 'swinging' && this.claw.animal) {
                this.positionAnimal(ax);
                this.claw.lastX = ax; this.claw.lastY = this.claw.animal.y;
            }
        } else {
            this.hideHand();
        }

        // fall-speed cap, fall-off detection, and settle counting. Physics itself is
        // vanilla Matter: simple hulls + sleeping do the stabilising, no custom pinning.
        for (let i = this.animals.length - 1; i >= 0; i--) {
            const b = this.animals[i];
            if (!b.body) { this.animals.splice(i, 1); continue; }

            // terminal fall speed keeps single-frame impact penetration small.
            // px-per-step, so it tracks the actual step length.
            const fallCap = MAX_FALL_SPEED * this.stepScale;
            if (b.body.velocity.y > fallCap) {
                b.setVelocity(b.body.velocity.x, fallCap);
            }
            // landing clamp + anti-bounce. restitution is already 0 (no material bounce);
            // the remaining springiness is the contact solver ejecting a body that
            // penetrated on a hard impact. So: (1) clamp the last descending frame so it
            // lands flush instead of punching in, then (2) once it's at the surface, zero
            // any upward velocity so neither the animal nor the stack springs back.
            if (!b.__landed) {
                const vy = b.body.velocity.y;
                const gap = (vy > 2 || vy < 0) ? this.gapBelow(b) : null;
                if (vy > 2 && gap !== null && vy > gap + 1) {
                    b.setVelocity(b.body.velocity.x, Math.max(gap + 1, 1.2));   // land flush
                } else if (vy < 0 && gap !== null && gap <= 3) {
                    b.setVelocity(b.body.velocity.x * 0.6, 0);                   // kill rebound
                }
                // landing thud on first contact (impact moment, not the later settle)
                if (!b.__hit && gap !== null && gap <= 6 && vy > 0.5) {
                    b.__hit = true;
                    this.playLand();
                }
            }

            if (b.y > FALL_OFF_Y) {
                this.triggerGameOver(true);    // fell off -> fail, show red
                if (b.y > GROUND_SURFACE_Y + 1400) { b.destroy(); this.animals.splice(i, 1); }
                continue;
            }

            // settled = still (or asleep) for a moment; sticky once set
            b.__stillMs = this.isAtRest(b) ? (b.__stillMs || 0) + delta : 0;
            const timedOut = this.time.now - b.__spawnTime > SETTLE_TIMEOUT;
            if (!b.__landed && (b.__stillMs >= SETTLE_MS || timedOut)) {
                b.__landed = true;
                this.plantAnimal(b);
                if (!b.__counted) {
                    b.__counted = true;
                    this.stackCount++;
                    this.spawnPuff(b.x, b.body.bounds.max.y - 6);
                    this.cameras.main.shake(80, 0.002);
                }
            }
        }

        // record max height only once the whole tower has come to rest
        if (!this.gameOver && this.animals.length) {
            const moving = this.animals.some(b => !this.isAtRest(b));
            if (!moving) {
                const hCm = Math.max(0, Math.round((GROUND_SURFACE_Y - this.towerTopWorldY()) / PX_PER_CM));
                if (hCm > this.maxHeightCm) { this.maxHeightCm = hCm; this.refreshHud(); this.redrawMaxLine(); }
            }
        }

        this.updateRespawn();
        this.positionRotArrows();

        // Camera follows the tower as it grows. What the eye sees is fall + camera, so ANY
        // camera motion while an animal is airborne changes its apparent speed — and the
        // camera's own accel/decel (catching up after a landing, then easing to a stop) is
        // what made falls look like they slowed. Fix: FREEZE the camera whenever anything
        // is in the air, so a fall is pure physics. It only eases toward target between
        // drops, when nothing is falling to distort. Any easing curve is fine there.
        const cam = this.cameras.main;
        const airborne = this.animals.some(b => b.body && !b.__landed);
        if (!airborne) {
            cam.scrollY += (this.camTargetY() - cam.scrollY) * CAM_EASE;
        }
    }

    // --- ending ------------------------------------------------------------
    triggerGameOver(failed) {
        if (this.gameOver) return;
        this.gameOver = true;
        this.failedByFall = !!failed;      // true only when an animal fell off
        this.canDrop = false;
        // flash the red in right away on the play screen (not just on the results scene)
        if (this.failedByFall) addFailGradient(this, windowWidth, windowHeight, true);
        // no fail sting if the player never actually dropped anything (timerStarted flips
        // on the first drop) — a game that ends with nothing dropped shouldn't "fail"
        if (this.timerStarted && this.sound && this.cache.audio.exists('fail')) this.sound.play('fail', { volume: 0.6 });
        this.hint && this.hint.setText('');
        if (this.claw.animal) { this.claw.animal.destroy(); this.claw.animal = null; }
        this.claw.state = 'idle';
        this.claw.gfx.clear();
        this.hideControls();
        this.cameras.main.shake(260, 0.006);
        this.time.delayedCall(650, () => this.finish());
    }

    finish() {
        if (this.finished) return;
        this.finished = true;
        const score = this.maxHeightCm;
        const isBest = score > this.best;
        if (isBest) { this.best = score; saveBest(score); }
        this.time.delayedCall(300, () => {
            this.scene.start('GameOverScene', { score: score, best: this.best, isBest, mode: this.mode, failed: this.failedByFall });
        });
    }
}

// ---------------------------------------------------------------------------
// Game over
// ---------------------------------------------------------------------------
class GameOverScene extends Phaser.Scene {
    constructor() { super('GameOverScene'); }

    create(data) {
        // blue sky. Red top+bottom gradient only when the run FAILED (an animal fell off);
        // a clean time-up ending keeps the normal blue gradient.
        paintSky(this, windowWidth, windowHeight);
        // hand at the top, same as every other stage (drawn before the gradients so a
        // failed run's red tints it, matching the reference)
        const pool = ANIMALS.filter(a => a.w >= a.h * 1.4);
        const handKey = (Phaser.Utils.Array.GetRandom(pool) || { key: 'penguin' }).key;
        addHeldHand(this, handKey, windowWidth / 2, TITLE_HAND_Y);
        if (data.failed) addFailGradient(this, windowWidth, windowHeight, false);
        else addBottomGradient(this, windowWidth, windowHeight);

        // Two-tone results panel (resultpanel.png): FINAL HEIGHT + height in the white
        // area, "RETRY" over the green button that's baked into the lower band.
        const cx = windowWidth / 2;
        const ps = this.textures.get('resultpanel').getSourceImage();
        const panelH = RESULT_PANEL_W * ps.height / ps.width;
        const panelTop = windowHeight * 0.30;
        this.add.image(cx, panelTop, 'resultpanel').setOrigin(0.5, 0)
            .setDisplaySize(RESULT_PANEL_W, panelH).setDepth(1);

        this.add.text(cx, panelTop + panelH * 0.18, 'FINAL HEIGHT', {
            fontFamily: FONT, fontSize: '52px', color: '#000000', fontStyle: 'bold'
        }).setOrigin(0.5).setDepth(2);

        // height number: white fill with a bold black outline
        this.add.text(cx, panelTop + panelH * 0.37, data.score + 'm', {
            fontFamily: FONT, fontSize: '150px', color: '#000000', fontStyle: 'bold',
            stroke: '#000000', strokeThickness: 12
        }).setOrigin(0.5).setDepth(2);

        // "RETRY" over the green button baked into the panel (centre ~0.75 down)
        this.add.text(cx, panelTop + panelH * 0.75, 'RETRY', {
            fontFamily: FONT, fontSize: '84px', color: '#ffffff', fontStyle: 'bold'
        }).setOrigin(0.5).setDepth(3);

        // retry the same mode that was just played
        this.input.on('pointerdown', () => this.scene.start('GameScene', { mode: data.mode }));
    }
}

// ---------------------------------------------------------------------------
function paintSky(scene, w, h) {
    // camera feed shows through the transparent canvas; tint it with a blue
    // overlay that fades away toward the bottom of the screen
    const g = scene.add.graphics().setScrollFactor(0).setDepth(-10);
    // brighter azure that stays blue across the whole screen, easing off only slightly
    // toward the bottom so the camera reads through near the tower
    g.fillGradientStyle(0x2f92db, 0x2f92db, 0x36a3e6, 0x36a3e6, 0.68, 0.68, 0.42, 0.42);
    g.fillRect(0, 0, w, h);
}

// Rounded green pill with the same bold sticker outline as the animal art.
// Drawn centred on (cx, cy) of whatever graphics object is passed in.
function drawButton(g, cx, cy, w, h, fill) {
    w = w || BTN_W; h = h || BTN_H;
    g.fillStyle(fill === undefined ? BTN_FILL : fill, 1);
    g.fillRoundedRect(cx - w / 2, cy - h / 2, w, h, BTN_R);
    g.lineStyle(BTN_OUTLINE_W, BTN_OUTLINE, 1);
    g.strokeRoundedRect(cx - w / 2, cy - h / 2, w, h, BTN_R);
}

// Top-left stopwatch badge (icon + seconds in its dial), screen-fixed. Shared by the
// live in-game countdown and the static title-screen badge so both sit identically.
function addTimerBadge(scene, initial) {
    const src = scene.textures.get('timericon').getSourceImage();
    const sc = TIMER_ICON_W / src.width;
    const ix = 100, iy = 150 + windowHeight * 0.15;   // icon top-left
    const icon = scene.add.image(ix, iy, 'timericon').setOrigin(0, 0)
        .setDisplaySize(TIMER_ICON_W, src.height * sc).setScrollFactor(0).setDepth(50);
    const text = scene.add.text(ix + TIMER_DIAL_X * sc, iy + TIMER_DIAL_Y * sc, initial, {
        fontFamily: FONT, fontSize: Math.round(96 * sc) + 'px', color: TIMER_TEXT_DARK, fontStyle: 'bold'
    }).setOrigin(0.5).setScrollFactor(0).setDepth(51);
    return { icon, text };
}

// Static pinching hand holding one animal, with its pinch at (sweepX, y) — the same
// fixed-pinch scheme as the game/title. Used to keep the hand at the top across all
// stages (title, play, result). Drawn under the edge gradients so they tint it.
function addHeldHand(scene, key, sweepX, y) {
    const src = scene.textures.get(key).getSourceImage();
    const w = src.width * ANIMAL_SCALE, h = src.height * ANIMAL_SCALE;
    const hb = scene.textures.get('handbelow').getSourceImage();
    const ta = scene.textures.get('thumbabove').getSourceImage();
    const handScale = HAND_W / hb.width;
    const gripTop = HAND_GRIP_TOP[key] != null ? HAND_GRIP_TOP[key] : HAND_GRIP_TOP_DEFAULT;
    const gripX = HAND_GRIP_X[key] != null ? HAND_GRIP_X[key] : HAND_GRIP_X_DEFAULT;
    const px = sweepX - HAND_PINCH_X * handScale, py = y - HAND_PINCH_Y * handScale;
    scene.add.image(px, py, 'handbelow').setOrigin(0, 0)
        .setDisplaySize(hb.width * handScale, hb.height * handScale).setDepth(21);
    scene.add.image(sweepX - w * gripX, y + h * (0.5 - gripTop), key)
        .setDisplaySize(w, h).setDepth(22);
    scene.add.image(px + THUMB_DX * handScale, py + THUMB_DY * handScale, 'thumbabove').setOrigin(0, 0)
        .setDisplaySize(ta.width * handScale, ta.height * handScale).setDepth(23);
}

// Platform image (crate) whose flat tabletop is the landing surface. Placed origin
// top-centre with the tabletop at `topY`, so the collider top and the visual surface
// line up; the crate body hangs below. Shared by the play surface and the title screen.
function addPlatform(scene, cx, topY, depth) {
    const src = scene.textures.get('platform').getSourceImage();
    const sc = PLATFORM_DISPLAY_W / src.width;
    return scene.add.image(cx, topY, 'platform')
        .setOrigin(0.5, 0).setDisplaySize(PLATFORM_DISPLAY_W, src.height * sc).setDepth(depth);
}

// Sticker-style ground slab: fill + grass strip + bold dark outline. Shared by the
// real play surface and the title screen's decorative plinth.
function drawGround(g, left, top, w, thickness) {
    g.fillStyle(0x6c8f5a, 1);
    g.fillRoundedRect(left, top, w, thickness, 18);
    g.fillStyle(0x7ea766, 1);
    g.fillRoundedRect(left, top, w, Math.min(30, thickness), { tl: 18, tr: 18, bl: 0, br: 0 });
    g.lineStyle(9, 0x1c1c22, 1);
    g.strokeRoundedRect(left, top, w, thickness, 18);
}

// Blue gradient rising from the bottom edge — opaque-ish at the bottom, fading to nothing
// ~20% up the screen. Overlay (scrollFactor 0, high depth) so it tints the bottom band.
function addBottomGradient(scene, w, h) {
    const band = h * 0.20;
    const g = scene.add.graphics().setScrollFactor(0).setDepth(55);
    // fillGradientStyle(TL, TR, BL, BR, aTL, aTR, aBL, aBR): transparent at top, blue at bottom
    g.fillGradientStyle(BOTTOM_GRAD_COLOR, BOTTOM_GRAD_COLOR, BOTTOM_GRAD_COLOR, BOTTOM_GRAD_COLOR, 0, 0, BOTTOM_GRAD_ALPHA, BOTTOM_GRAD_ALPHA);
    g.fillRect(0, h - band, w, band);
}

// Red gradient on BOTH the top and bottom edges (mirrors addBottomGradient's blue) —
// used on the fail / game-over screen. Each band fades to transparent toward centre.
function addFailGradient(scene, w, h, fade) {
    const band = h * 0.20;
    // Overscan every edge so the game-over camera shake can't slide the bands off the
    // viewport and reveal a gap between the screen edge and the red.
    const m = 80, ww = w + 2 * m;
    const g = scene.add.graphics().setScrollFactor(0).setDepth(58);
    // bottom: gradient (transparent -> red) hugging the edge, plus a solid red overscan
    // strip below it so a shake can't expose a gap. Same for the top.
    g.fillGradientStyle(FAIL_GRAD_COLOR, FAIL_GRAD_COLOR, FAIL_GRAD_COLOR, FAIL_GRAD_COLOR, 0, 0, FAIL_GRAD_ALPHA, FAIL_GRAD_ALPHA);
    g.fillRect(-m, h - band, ww, band);
    g.fillStyle(FAIL_GRAD_COLOR, FAIL_GRAD_ALPHA);
    g.fillRect(-m, h, ww, m);
    // top
    g.fillGradientStyle(FAIL_GRAD_COLOR, FAIL_GRAD_COLOR, FAIL_GRAD_COLOR, FAIL_GRAD_COLOR, FAIL_GRAD_ALPHA, FAIL_GRAD_ALPHA, 0, 0);
    g.fillRect(-m, 0, ww, band);
    g.fillStyle(FAIL_GRAD_COLOR, FAIL_GRAD_ALPHA);
    g.fillRect(-m, -m, ww, m);
    // quick fade-in rather than popping in instantly (skip when carrying over an
    // already-visible red into the results scene, so it doesn't flicker back to 0)
    if (fade !== false) {
        g.setAlpha(0);
        scene.tweens.add({ targets: g, alpha: 1, duration: 280, ease: 'Quad.out' });
    }
    return g;
}

const config = {
    type: Phaser.WEBGL,
    width: windowWidth,
    height: windowHeight,
    transparent: true,
    canvas: window.canvas,
    physics: {
        default: 'matter',
        matter: {
            gravity: { y: 1.4 },
            // Fixed timestep: without this Matter steps with the frame delta, so any
            // dropped frame produces an oversized step -> deep penetration -> a visible
            // glitch. isFixed makes each step identical regardless of frame rate.
            runner: { isFixed: true, delta: 1000 / 60, deltaMin: 1000 / 60, deltaMax: 1000 / 60 },
            // more iterations = tighter contact convergence = less resting jitter + shallower
            // penetration (so less of the position->velocity "bounce" on landing)
            positionIterations: 24,
            velocityIterations: 16,
            constraintIterations: 4,
            // sleeping stabilises resting stacks (simple hulls settle cleanly and truly)
            enableSleeping: true,
            debug: false
        }
    },
    scene: [BootScene, TitleScene, GameScene, GameOverScene],
    input: { mouse: true, touch: true }
};

const game = new Phaser.Game(config);
