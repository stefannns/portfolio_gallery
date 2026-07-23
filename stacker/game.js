require('libs/tt-adapter.js');
const Phaser = require('libs/phaser.js');

const res = tt.getSystemInfoSync();
const windowWidth = res.screenWidth;    // 1080
const windowHeight = res.screenHeight;  // 1920

// ---------------------------------------------------------------------------
// Tunables
// ---------------------------------------------------------------------------
const GROUND_SURFACE_Y = 1650;          // world-y of the flat surface top
const GROUND_THICKNESS = 240;           // shorter slab platform (was a tall block)
const GROUND_WIDTH = 880;               // wider surface -> more landing room
const DROP_GAP = 430;                   // held animal hovers this far above the tower top
// The held animal sits at screen y = ARM_LEN + CLAW_FRAC*height, and the tower top
// DROP_GAP below that — so these two together decide how much tower is visible above
// the DROP button. They were tuned for a low button; raising it for the TikTok safe
// area meant pulling the whole frame up so the button stopped covering the stack.
// Camera framing only — neither affects the physics or the drop height.
const CLAW_FRAC = 0.09;                 // claw pivot screen position from the top (camera follows it)

const ARM_LEN = 240;                    // vertical offset of the hold row from the camera top

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
const SETTLE_MS = 350;                  // still this long -> counts as settled
const SETTLE_TIMEOUT = 5000;            // failsafe: always settle eventually
const RESPAWN_DELAY = 260;              // grace before the next animal loads
const MAX_FALL_SPEED = 9;               // terminal fall speed (limits impact penetration)
const FALL_OFF_Y = GROUND_SURFACE_Y + 160;  // past this = fell off -> game over

// TikTok reserves the bottom strip of the screen for its own capture UI (record
// button + shutter ring). Nothing interactive may sit inside it or the player's tap
// hits TikTok's chrome instead of the game. ~21% of a 1920-tall stage.
const TIKTOK_SAFE_BOTTOM = 400;

// Shared button chrome — PLAY and DROP are the same pill so the two screens match
const BTN_W = 440, BTN_H = 130, BTN_R = 30;
const BTN_FILL = 0x54b04a, BTN_OUTLINE = 0x1c1c22, BTN_OUTLINE_W = 8;
const BTN_FONT_SIZE = '64px';

const ANIMAL_SCALE = 0.78;              // shrink every animal (art + collider together)
const BEST_KEY = 'animalStackerBestHeight';

// UI font. Rubik loads via @font-face in the browser preview and via tt.loadFont
// in the effect pack (the returned runtime id must be used as the family name).
let FONT = "Rubik, Arial, sans-serif";
try {
    if (typeof tt !== 'undefined' && tt && typeof tt.loadFont === 'function') {
        const id = tt.loadFont('libs/fonts/Rubik-Regular.ttf');
        if (id) FONT = id + ', Rubik, Arial, sans-serif';
    }
} catch (e) {}

// Animal roster: real PNG stickers from assets/animals/. Display size + the
// single-box collider are derived from each image at boot (art fills its bounds).
const ANIMAL_KEYS = ["crocodile","snake","gorilla","penguin","giraffe","hippo",
    "hedgehog","seagull","ladybug","capybara","buffalo","walrus","cat","ostrich",
    "zebra","gazelle","elephant","pigeon","pelican","moose","sheep","weasel",
    "llama","dolphin","chameleon","axolotl","lion","flamingo","frog","dachshund",
    "swordfish","elephant2","turkey","seal","cow"];
const ANIMALS = [];   // filled at boot: {key, w, h}
let COLLIDERS = {};   // per-animal collider boxes derived from image alpha (normalized)

function loadBest() {
    try { return parseInt(window.localStorage.getItem(BEST_KEY), 10) || 0; } catch (e) { return 0; }
}
function saveBest(v) {
    try { window.localStorage.setItem(BEST_KEY, String(v)); } catch (e) {}
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
    }

    create() {
        COLLIDERS = this.cache.json.get('colliders') || {};
        // derive display size (and thus collider size) per animal from its image
        ANIMAL_KEYS.forEach(k => {
            const s = this.textures.get(k).getSourceImage();
            const sc = Math.min(210 / s.width, 250 / s.height, 1.2);
            ANIMALS.push({ key: k, w: Math.round(s.width * sc), h: Math.round(s.height * sc) });
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
        addGlass(this, windowWidth, windowHeight);

        const playY = windowHeight * 0.44;
        // Decorative tower: a real-looking stack sitting on a plinth of the same ground
        // art as the play surface. Anchored to the TikTok safe line rather than the
        // screen bottom, so TikTok's record button never covers it.
        this.buildDecoStack(cx, windowHeight - TIKTOK_SAFE_BOTTOM, playY + BTN_H / 2 + 75);

        const logo = this.add.image(cx, windowHeight * 0.25, 'title').setOrigin(0.5);
        const logoW = windowWidth * 0.82;
        const lt = this.textures.get('title').getSourceImage();
        logo.setDisplaySize(logoW, logoW * lt.height / lt.width);
        this.tweens.add({
            targets: logo, scale: logo.scale * 1.03,
            duration: 1400, yoyo: true, repeat: -1, ease: 'Sine.inOut'
        });

        // pick a mode. Same chrome as the in-game DROP button (drawButton), wrapped in a
        // container so the idle pulse scales the pill and its label together.
        const mkBtn = (y, label, mode) => {
            const g = this.add.graphics();
            drawButton(g, 0, 0);
            const t = this.add.text(0, 0, label, {
                fontFamily: FONT, fontSize: BTN_FONT_SIZE, color: '#ffffff', fontStyle: 'bold'
            }).setOrigin(0.5);
            const btn = this.add.container(cx, y, [g, t]).setSize(BTN_W, BTN_H)
                .setInteractive(new Phaser.Geom.Rectangle(-BTN_W / 2, -BTN_H / 2, BTN_W, BTN_H),
                    Phaser.Geom.Rectangle.Contains, { useHandCursor: true });
            btn.on('pointerdown', () => this.scene.start('GameScene', { mode: mode }));
            return btn;
        };
        const play = mkBtn(playY, 'PLAY', 'drag');
        this.tweens.add({ targets: play, scale: 1.05, duration: 800, yoyo: true, repeat: -1, ease: 'Sine.inOut' });
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
        this.mode = 'drag';   // drag is the only mode
        this.best = loadBest();
        this.animals = [];          // live matter game objects
        this.stackCount = 0;        // animals safely landed (drives the swing ramp)
        this.maxHeightCm = 0;       // the score: max settled tower height
        this.heldRot = 0;           // player-applied rotation on the held animal
        this.gameOver = false;
        this.dragX = windowWidth / 2;   // drag-mode target x (follows the finger)
        this.awaitingSettle = null;   // the dropped animal we're waiting to settle before reloading

        // claw / dropper state
        this.claw = { gfx: null, animal: null, type: null, state: 'idle', t: 0, lastX: 0, lastY: 0, vx: 0, vy: 0 };

        paintSky(this, windowWidth, windowHeight);
        addGlass(this, windowWidth, windowHeight);
        this.buildGround();
        this.buildMaxLine();
        this.buildHud();
        this.claw.gfx = this.add.graphics().setDepth(30);

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
        const left = windowWidth / 2 - GROUND_WIDTH / 2;
        drawGround(this.add.graphics().setDepth(-5), left, GROUND_SURFACE_Y, GROUND_WIDTH, GROUND_THICKNESS);
    }

    // heightmarker sprite + label marking the max settled height reached
    buildMaxLine() {
        this.maxMarker = this.add.image(windowWidth / 2, 0, 'heightmarker')
            .setDepth(-3).setVisible(false);
        const mk = this.textures.get('heightmarker').getSourceImage();
        this.maxMarker.setDisplaySize(windowWidth, mk.height * windowWidth / mk.width);
        this.maxLabel = this.add.text(28, 0, '', {
            fontFamily: FONT, fontSize: '52px', color: '#ffffff', fontStyle: 'bold',
            stroke: '#1d3b5a', strokeThickness: 6
        }).setDepth(-3).setOrigin(0, 1).setAlpha(0);
    }

    redrawMaxLine() {
        if (this.maxHeightCm <= 0) { this.maxMarker.setVisible(false); this.maxLabel.setAlpha(0); return; }
        const y = GROUND_SURFACE_Y - this.maxHeightCm * PX_PER_CM;
        this.maxMarker.setPosition(windowWidth / 2, y).setVisible(true);
        this.maxLabel.setText(String(this.maxHeightCm)).setPosition(28, y - 46).setAlpha(1);
    }

    // click/tap to rotate the held animal; DROP button releases it
    buildControls() {
        // DROP sits above TIKTOK_SAFE_BOTTOM so it never lands under the record button
        const bw = BTN_W, bh = BTN_H, bx = windowWidth / 2;
        const by = windowHeight - TIKTOK_SAFE_BOTTOM - bh / 2 - 40;

        this.rotZone = this.add.zone(0, 0, windowWidth, windowHeight).setOrigin(0)
            .setScrollFactor(0).setDepth(40).setInteractive();
        this.rotHintDone = false;
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
            // pointerup from tapping PLAY leaks in here and must not rotate the first animal
            if (this.__pressX === undefined) return;
            const wasTap = !this.__pressMoved;
            this.__pressX = undefined;
            if (!wasTap) return;
            if (!this.canDrop || this.gameOver || this.claw.state !== 'swinging') return;
            this.applyRotate(ROT_STEP);   // a clean tap rotates, in every mode
        });

        // "click to rotate" hint near the held animal; fades on first use
        const holdRow = ARM_LEN + windowHeight * CLAW_FRAC;
        this.rotHint = this.add.text(windowWidth / 2, holdRow + 150, 'click to rotate', {
            fontFamily: FONT, fontSize: '46px', color: '#ffffff', fontStyle: 'bold',
            stroke: '#1d3b5a', strokeThickness: 5
        }).setOrigin(0.5).setScrollFactor(0).setDepth(200).setAlpha(0.8).setVisible(false);

        // drop button — same pill as PLAY on the title screen
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
    }

    applyRotate(d) {
        this.heldRot += d;
        this.rotTaps = (this.rotTaps || 0) + 1;
        if (this.rotTaps === ROT_HINT_TAPS) {
            this.tweens.add({
                targets: this.rotHint, alpha: 0, duration: 300, ease: 'Quad.out',
                onComplete: () => { this.rotHintDone = true; }
            });
        }
    }

    hideControls() {
        [this.rotZone, this.dropZone].forEach(z => z && z.disableInteractive());
        [this.dropBtn, this.dropText].forEach(o => o && o.setAlpha(0));
        this.rotHint && this.rotHint.setVisible(false);
    }

    // show the rotate hint only while an animal is held (until first use)
    positionRotArrows() {
        const holding = !!(this.claw.animal && this.canDrop && !this.gameOver);
        this.rotHint.setVisible(holding && !this.rotHintDone);
    }

    buildHud() {
        const mk = (x, y, size, color, align) => this.add.text(x, y, '', {
            fontFamily: FONT, fontSize: size, color: color, fontStyle: 'bold', align: align
        }).setScrollFactor(0).setDepth(50);

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
        // first animal is always a wide, low one so the base is a fair foundation
        const pool = this.animals.length === 0 ? ANIMALS.filter(a => a.w >= a.h * 1.4) : ANIMALS;
        const type = Phaser.Utils.Array.GetRandom(pool);
        this.claw.type = type;
        this.claw.t = 0;
        this.claw.state = 'swinging';

        const pivotX = windowWidth / 2;
        const pivotY = this.dropY() - ARM_LEN;
        const img = this.add.image(pivotX, pivotY + ARM_LEN, type.key).setDepth(22);
        img.setDisplaySize(type.w, type.h);
        this.claw.animal = img;
        this.claw.lastX = img.x;
        this.claw.lastY = img.y;
        this.claw.lastRot = 0;
        this.claw.vx = 0; this.claw.vy = 0;
        this.heldRot = 0;           // each animal starts unrotated
        this.canDrop = true;
    }

    release() {
        if (!this.canDrop || this.claw.state !== 'swinging' || this.gameOver) return;
        this.canDrop = false;

        const img = this.claw.animal;
        const ax = img.x, ay = img.y, rot = img.rotation, type = this.claw.type;
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

        // claw opens & retracts; the next animal loads once THIS one has settled
        this.claw.state = 'releasing';
        this.claw.t = 0;
        this.awaitingSettle = body;
        this.awaitingSince = this.time.now;
    }

    // spawn the next animal only after the last-dropped one comes to rest
    updateRespawn() {
        const b = this.awaitingSettle;
        if (!b || this.gameOver) return;
        const gone = !b.body;                                   // fell off / destroyed
        // wait for the FULL settled state (__landed), not a one-frame rest, so the
        // animal has actually received its planted weight+damping before the next
        // drops on it. Otherwise the next impact resets its rest timer and it never
        // gets planted -> the whole tower above the base stays light and shoveable.
        const settled = b.__landed;
        const timedOut = this.time.now - this.awaitingSince > SETTLE_TIMEOUT;
        // small grace so the claw's retract animation can finish before reloading
        const graced = this.time.now - this.awaitingSince > RESPAWN_DELAY;
        if (gone || ((settled || timedOut) && graced)) {
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

    camTargetY() {
        // keep the claw pivot pinned near the top of the screen; camera rises with the tower
        return (this.dropY() - ARM_LEN) - windowHeight * CLAW_FRAC;
    }

    // small impact burst when an animal settles: dust spray + a quick ring
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
        const pivotX = windowWidth / 2;
        const pivotY = this.dropY() - ARM_LEN;

        if (this.claw.state === 'swinging' && this.claw.animal) {
            const speed = 0.0023 + this.stackCount * 0.00008;
            this.claw.t += delta;
            const dt = Math.max(1, delta);
            let ax, ay, rot;
            // follows the player's finger horizontally (clamped to the play area)
            ax = Phaser.Math.Clamp(this.dragX, 130, windowWidth - 130);
            ay = this.dropY();
            rot = 0;
            rot += this.heldRot;    // player-applied rotation rides on top
            this.claw.animal.setPosition(ax, ay);
            this.claw.animal.setRotation(rot);
            this.claw.lastX = ax; this.claw.lastY = ay;
        } else if (this.claw.state === 'releasing') {
            this.claw.state = 'idle';
        }

        // fall-speed cap, fall-off detection, and settle counting. Physics itself is
        // vanilla Matter: simple hulls + sleeping do the stabilising, no custom pinning.
        for (let i = this.animals.length - 1; i >= 0; i--) {
            const b = this.animals[i];
            if (!b.body) { this.animals.splice(i, 1); continue; }

            // terminal fall speed keeps single-frame impact penetration small
            if (b.body.velocity.y > MAX_FALL_SPEED) {
                b.setVelocity(b.body.velocity.x, MAX_FALL_SPEED);
            }
            // landing clamp: never overshoot the surface below in a single frame —
            // full speed until the last frame, then land flush (no punch-in/pop-out)
            if (!b.__landed && b.body.velocity.y > 2) {
                const gap = this.gapBelow(b);
                if (gap !== null && b.body.velocity.y > gap + 1) {
                    b.setVelocity(b.body.velocity.x, Math.max(gap + 1, 1.2));
                }
            }

            if (b.y > FALL_OFF_Y) {
                this.triggerGameOver();
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

        // camera follows the dropper so it stays pinned near the top as the tower grows
        const targetY = this.camTargetY();
        const cam = this.cameras.main;
        cam.scrollY += (targetY - cam.scrollY) * Math.min(1, delta / 220);
    }

    // --- ending ------------------------------------------------------------
    triggerGameOver() {
        if (this.gameOver) return;
        this.gameOver = true;
        this.canDrop = false;
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
            this.scene.start('GameOverScene', { score: score, best: this.best, isBest, mode: this.mode });
        });
    }
}

// ---------------------------------------------------------------------------
// Game over
// ---------------------------------------------------------------------------
class GameOverScene extends Phaser.Scene {
    constructor() { super('GameOverScene'); }

    create(data) {
        this.add.graphics().fillStyle(0x0a2233, 0.55).fillRect(0, 0, windowWidth, windowHeight).setDepth(0);

        // Just the score and a RETRY, in the same cartoon-outline chrome as the rest of
        // the game: white panel with the bold dark sticker border, and the shared pill.
        const cx = windowWidth / 2;
        const PANEL_W = 760, PANEL_H = 520;
        const panelY = windowHeight * 0.33;
        const scoreY = panelY + 185;
        const btnY = panelY + PANEL_H - 130;

        const g = this.add.graphics().setDepth(1);
        g.fillStyle(0xffffff, 1);
        g.fillRoundedRect(cx - PANEL_W / 2, panelY, PANEL_W, PANEL_H, 40);
        g.lineStyle(10, BTN_OUTLINE, 1);
        g.strokeRoundedRect(cx - PANEL_W / 2, panelY, PANEL_W, PANEL_H, 40);

        this.add.text(cx, scoreY, data.score + ' cm', {
            fontFamily: FONT, fontSize: '150px', color: '#1d3b5a', fontStyle: 'bold'
        }).setOrigin(0.5).setDepth(2);

        drawButton(this.add.graphics().setDepth(2), cx, btnY);
        this.add.text(cx, btnY, 'RETRY', {
            fontFamily: FONT, fontSize: BTN_FONT_SIZE, color: '#ffffff', fontStyle: 'bold'
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
    // BUILD STAMP — if you don't see this tag in-game, your browser is running a
    // cached older build (see note). Bump the string whenever collider logic changes.
    scene.add.text(w - 18, h - 14, 'outline-build-3', {
        fontFamily: FONT, fontSize: '26px', color: '#ffffff'
    }).setOrigin(1, 1).setScrollFactor(0).setDepth(9999).setAlpha(0.5);
}

// Rounded green pill with the same bold sticker outline as the animal art.
// Drawn centred on (cx, cy) of whatever graphics object is passed in.
function drawButton(g, cx, cy) {
    g.fillStyle(BTN_FILL, 1);
    g.fillRoundedRect(cx - BTN_W / 2, cy - BTN_H / 2, BTN_W, BTN_H, BTN_R);
    g.lineStyle(BTN_OUTLINE_W, BTN_OUTLINE, 1);
    g.strokeRoundedRect(cx - BTN_W / 2, cy - BTN_H / 2, BTN_W, BTN_H, BTN_R);
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

function addGlass(scene, w, h) {
    // glass reflection overlay across the play area (under the HUD)
    scene.add.image(w / 2, h / 2, 'glass').setDisplaySize(w, h).setScrollFactor(0).setDepth(45).setAlpha(0.5);
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
