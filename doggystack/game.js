require('libs/tt-adapter.js');
const Phaser = require('libs/phaser.js');

// ---------------------------------------------------------------------------
// Screen / design space
// ---------------------------------------------------------------------------
const res = tt.getSystemInfoSync();
const windowWidth = res.screenWidth;
const windowHeight = res.screenHeight;

// Everything below is authored in a fixed 1080x1920 design space. A single
// root container is scaled + centred, so every number in this file is design px.
const W = 1080, H = 1920;
const S = Math.min(windowWidth / W, windowHeight / H);
const OX = (windowWidth - W * S) / 2;
const OY = (windowHeight - H * S) / 2;

// Font: index.html's @font-face only works in the browser preview. Inside an
// effect pack the font must come from tt.loadFont(), whose return value is the
// runtime font id you have to use as fontFamily.
const UI = { fontStack: "'Rubik Mono One', Arial Black, sans-serif" };
try {
    if (typeof tt !== 'undefined' && tt && typeof tt.loadFont === 'function') {
        const fid = tt.loadFont('libs/fonts/RubikMonoOne-Regular.ttf');
        if (fid) UI.fontStack = fid + ', ' + UI.fontStack;
    }
} catch (e) {}

// ---------------------------------------------------------------------------
// Grid
//
// The whole game is measured in square "units". The dog rides a stack of body
// blocks; obstacles are stacks of them too, so the number of blocks an obstacle
// will take is countable on screen.
//
// Row r spans y = GROUND_Y-(r+1)*UNIT .. GROUND_Y-r*UNIT, for r in 0..CEIL_ROWS-1.
// ---------------------------------------------------------------------------
const UNIT = 140;
const CEIL_ROWS = 8;
const GROUND_Y = 1430;
const CEIL_Y = GROUND_Y - CEIL_ROWS * UNIT;    // 310
const PLAYER_X = 120;
const CONTACT_X = PLAYER_X + UNIT * 0.5;

const START_STACK = 3;
const TAP_COOLDOWN = 140;
const BASE_SPEED = 790;
const MAX_SPEED = 1090;
const RAMP_TIME = 10;                          // sec to full speed + difficulty
const FALL_ACCEL = 130;                        // units / sec^2, step-off drop

// A run is a fixed length: reach the end and you win, with however many coins
// you picked up along the way.
const RUN_LENGTH = 19500;                      // design px of travel
const COIN_TOTAL = 15;

const MAX_PILLAR = 2;                          // cap + 1 brick row, no taller
const MAX_FLOAT = 4;                           // highest a floating surface sits
const SHED_TIME = 0.32;                        // sec to fall clear after riding off a part
const PIECE_W = 3;                             // level parts are 3 units wide
const NARROW_CHANCE = 0.28;                    // ...with the odd single-unit block

const BLOCK_PX = UNIT;                         // body block: fills its cell, so blocks stack flush
const TRAIL_LEN = 430;                         // design px of ribbon behind the dog
const TRAIL_HALF = 52;                         // half-width; constant, so the tail is square

const PANEL_W = 880;
const PANEL_H = PANEL_W * (504 / 684);

// Scene strip placement. The source art has a transparent sky and its ground
// surface sits at y=549; scale + offset so that line lands exactly on GROUND_Y.
const SCENE_SRC_H = 1073;
const SCENE_GROUND_SRC = 549;
// One scale satisfies both constraints: the strip's bottom sits on the screen
// bottom, and its ground line sits on GROUND_Y.
const SCENE_SCALE = (H - GROUND_Y) / (SCENE_SRC_H - SCENE_GROUND_SRC);
const SCENE_Y = H - SCENE_SRC_H * SCENE_SCALE;

function label(scene, x, y, str, size, color, originX, originY) {
    const t = scene.add.text(x, y, str, {
        fontFamily: UI.fontStack,
        fontSize: size + 'px',
        color: color || '#ffffff',
        align: 'center'
    });
    t.setOrigin(originX === undefined ? 0.5 : originX, originY === undefined ? 0.5 : originY);
    t.setPadding(Math.ceil(size * 0.35));
    return t;
}

// Rubik Mono One is wide, and copy changes with the coin count, so nothing is
// sized by hand: step the font down until the widest line fits the given box,
// then scale as a last resort. Guarantees no text can run off screen.
function fitLabel(scene, x, y, str, maxSize, minSize, maxWidth, color) {
    const t = label(scene, x, y, str, maxSize, color);
    for (let s = maxSize; s >= minSize; s -= 2) {
        t.setFontSize(s);
        t.setPadding(Math.ceil(s * 0.35));
        if (t.width <= maxWidth) break;
    }
    if (t.width > maxWidth) t.setScale(maxWidth / t.width);
    return t;
}

// Sound. Every clip is longer than the interval it can retrigger at — grow can
// fire every 140ms against a 1.07s clip, coins arrive in pairs, spikes eat a
// block per unit — so each one gets a round-robin pool of contexts instead of a
// single one that would cut its own tail off. Pool size is set by how fast the
// sound can repeat, not by how long it is.
// Guarded throughout: the preview shell and the pack expose slightly different
// audio surfaces, and a missing one must never throw into the game loop.
const SFX_DEF = { coin: 3, grow: 4, drop: 3, death: 1 };
const SFX = {};
function initSfx() {
    try {
        if (typeof tt === 'undefined' || !tt || typeof tt.createInnerAudioContext !== 'function') return;
        Object.keys(SFX_DEF).forEach((name) => {
            const pool = [];
            for (let i = 0; i < SFX_DEF[name]; i++) {
                const a = tt.createInnerAudioContext();
                a.src = 'assets/audio/' + name + '.mp3';
                pool.push(a);
            }
            SFX[name] = { pool: pool, next: 0 };
        });
    } catch (e) {}
}
function playSfx(name) {
    const s = SFX[name];
    if (!s || !s.pool.length) return;
    try {
        const a = s.pool[s.next++ % s.pool.length];
        if (typeof a.stop === 'function') a.stop();
        else if (typeof a.seek === 'function') a.seek(0);
        const r = a.play();
        if (r && typeof r.catch === 'function') r.catch(() => {});   // autoplay policy
    } catch (e) {}
}

let bestCoins = 0;

// ---------------------------------------------------------------------------
class BootScene extends Phaser.Scene {
    constructor() { super('BootScene'); }

    preload() {
        this.load.image('scene', 'assets/scene.png');
        this.load.image('dogHead', 'assets/dog_head.png');
        this.load.image('bodyBlock', 'assets/body_block.png');
        this.load.image('brick', 'assets/brick.png');
        this.load.image('platformCap', 'assets/platform_cap.png');
        this.load.image('rusherGround', 'assets/rusher_ground.png');
        this.load.image('rusherAir', 'assets/rusher_air.png');
        this.load.image('coin', 'assets/coin.png');
        this.load.image('coinFx', 'assets/coin_fx.png');
        this.load.image('finish', 'assets/finish.png');
        this.load.image('panel', 'assets/panel.png');
        this.load.image('btnPlay', 'assets/btn_play.png');
        this.load.image('btnRetry', 'assets/btn_retry.png');
        this.load.image('pipFull', 'assets/pip_full.png');
        this.load.image('pipEmpty', 'assets/pip_empty.png');
        this.load.image('warn', 'assets/warn.png');
        // 460x105, four spikes: sliced into 1-unit frames so each one is its own block.
        this.load.spritesheet('spike', 'assets/spikes.png', { frameWidth: 115, frameHeight: 105 });
        this.load.image('hudProgress', 'assets/hud_progress.png');
        this.load.image('hudGold', 'assets/hud_gold.png');
        this.load.image('hudDog', 'assets/hud_dog.png');
    }

    create() {
        // HUD bar: an empty track plus a striped blue fill revealed with setCrop.
        // The stripes need a clip path, so the fill is a canvas texture.
        const tw = 400, th = 100, rr = th / 2;
        const t2 = this.make.graphics({ add: false });
        t2.fillStyle(0xd6effb, 1);
        t2.fillRoundedRect(0, 0, tw, th, rr);
        t2.generateTexture('hudTrack', tw, th);
        t2.destroy();

        const ct = this.textures.createCanvas('hudFill', tw, th);
        const ctx = ct.context;
        ctx.beginPath();
        ctx.moveTo(rr, 0);
        ctx.lineTo(tw - rr, 0);
        ctx.arc(tw - rr, rr, rr, -Math.PI / 2, Math.PI / 2);
        ctx.lineTo(rr, th);
        ctx.arc(rr, rr, rr, Math.PI / 2, -Math.PI / 2);
        ctx.closePath();
        ctx.clip();
        const grad = ctx.createLinearGradient(0, 0, 0, th);
        grad.addColorStop(0, '#4aa3f0');
        grad.addColorStop(1, '#1f5fd8');
        ctx.fillStyle = grad;
        ctx.fillRect(0, 0, tw, th);
        ctx.fillStyle = 'rgba(255,255,255,0.30)';
        for (let sx = -60; sx < tw + 60; sx += 58) {
            ctx.beginPath();
            ctx.moveTo(sx, 0);
            ctx.lineTo(sx + 26, 0);
            ctx.lineTo(sx + 26 - 32, th);
            ctx.lineTo(sx - 32, th);
            ctx.closePath();
            ctx.fill();
        }
        ct.refresh();

        initSfx();

        // Soft white puff for the death effect — a radial falloff, so a canvas.
        const pz = 128;
        const pc = this.textures.createCanvas('puff', pz, pz);
        const px = pc.context;
        const pg = px.createRadialGradient(pz / 2, pz / 2, 0, pz / 2, pz / 2, pz / 2);
        pg.addColorStop(0, 'rgba(255,255,255,0.95)');
        pg.addColorStop(0.55, 'rgba(255,255,255,0.65)');
        pg.addColorStop(1, 'rgba(255,255,255,0)');
        px.fillStyle = pg;
        px.fillRect(0, 0, pz, pz);
        pc.refresh();

        this.scene.start('GameScene');
    }
}

// ---------------------------------------------------------------------------
class GameScene extends Phaser.Scene {
    constructor() { super('GameScene'); }

    create() {
        this.world = this.add.container(OX, OY).setScale(S);

        this.buildBackdrop();

        this.obLayer = this.add.container(0, 0);
        this.coinLayer = this.add.container(0, 0);
        this.trailGfx = this.add.graphics();
        this.playerCol = this.add.container(PLAYER_X, GROUND_Y);
        this.fxLayer = this.add.container(0, 0);
        this.world.add([this.obLayer, this.coinLayer, this.trailGfx, this.playerCol, this.fxLayer]);

        // Scrim for the start screen: barely there at the top, heavier at the
        // bottom, so the copy reads over whatever the camera is showing.
        this.dim = this.add.graphics();
        this.dim.fillGradientStyle(0x000000, 0x000000, 0x000000, 0x000000, 0.10, 0.10, 0.42, 0.42);
        this.dim.fillRect(-W, -H, W * 3, H * 3);
        this.world.add(this.dim);

        this.buildHud();
        this.buildReadyPanel();

        this.input.on('pointerdown', (p) => this.onTap(p));

        this.resetRun();
    }

    // --- scenery ------------------------------------------------------------
    // No sky is drawn on purpose. The host lays the camera feed behind the
    // transparent canvas, so anything opaque up here would cover the player's
    // face. Only the horizon strip, the ground and the props are solid.
    buildBackdrop() {
        // The strip carries the ground and everything under it, so it scrolls at
        // full world speed — a lagging floor reads wrong in a runner. A tileSprite
        // rather than an image so it can run for any distance without ending.
        this.scene1 = this.add.tileSprite(0, SCENE_Y, W, H - SCENE_Y, 'scene').setOrigin(0, 0);
        this.scene1.tileScaleX = SCENE_SCALE;
        this.scene1.tileScaleY = SCENE_SCALE;
        this.world.add(this.scene1);

        // Dotted marker for the height cap. Nearly invisible while the dog is
        // low, brightening as he closes on it, so it only asks for attention
        // when it is about to matter.
        this.capLine = this.add.graphics();
        this.capRoom = -1;
        this.world.add(this.capLine);
    }

    // --- HUD ----------------------------------------------------------------
    // Layout follows the sheepgame capsules: both pills on one line near the top,
    // progress left with the head riding the fill, counter right-aligned.
    buildHud() {
        this.hud = this.add.container(0, 0);
        this.world.add(this.hud);

        const capY = 176, pad = 50;
        const capW = 448, capH = capW * (128 / 406);
        // Both capsules carry a baked drop shadow along the bottom, so their
        // visible interior sits slightly above the image centre.
        const midY = capY - capH * 0.035;

        // Progress capsule (left). The striped circle baked into the art is the
        // 0% state; the fill grows rightward out of it.
        this.hud.add(this.add.image(pad, capY, 'hudProgress').setOrigin(0, 0.5).setDisplaySize(capW, capH));

        const insetX = capW * 0.036, trackH = capH * 0.72;
        this.trackX = pad + insetX;
        this.trackW = capW - insetX * 2;
        this.progFill = this.add.image(this.trackX, midY, 'hudFill').setOrigin(0, 0.5).setDisplaySize(this.trackW, trackH);
        this.progFill.setCrop(0, 0, 6, 100);
        this.hud.add(this.progFill);

        // Marker sits proud of the capsule — oversized and lifted, so the dog
        // reads as riding on top of the bar rather than being boxed inside it.
        this.progMark = this.add.image(this.trackX, midY - capH * 0.10, 'hudDog').setOrigin(0.5, 0.5);
        this.progMark.setDisplaySize(capH * 1.06 * (89 / 102), capH * 1.06);
        this.hud.add(this.progMark);

        // Coin capsule (right), sized so both capsules share a height.
        const gH = capH, gW = gH * (314 / 128), gRight = W - pad;
        this.hud.add(this.add.image(gRight, capY, 'hudGold').setOrigin(1, 0.5).setDisplaySize(gW, gH));
        this.coinText = label(this, gRight - gW * 0.33, midY + 2, '0/' + COIN_TOTAL, 52, '#123f9e');
        this.hud.add(this.coinText);
    }

    // --- panels -------------------------------------------------------------
    makePanel(y) {
        const c = this.add.container(W / 2, y);
        const p = this.add.image(0, 0, 'panel').setOrigin(0.5, 0.5);
        p.setDisplaySize(PANEL_W, PANEL_H);
        c.add(p);
        return c;
    }

    // No panel here — the copy sits straight on the camera feed, so it carries a
    // drop shadow instead of a backing plate to stay legible over anything.
    buildReadyPanel() {
        this.readyBox = this.add.container(W / 2, 0);

        const copy = fitLabel(this, 0, 0,
            'Tap to jump,\ndodge every block, and\ncollect all the gold\ncoins!', 52, 22, W - 130, '#ffffff');
        copy.setLineSpacing(14);
        copy.setShadow(0, 6, 'rgba(20,40,80,0.45)', 10, false, true);
        this.readyBox.add(copy);

        this.playBtn = this.add.image(0, 0, 'btnPlay').setOrigin(0.5, 0.5);
        this.playBtn.setDisplaySize(460, 460 * (171 / 481));
        this.readyBox.add(this.playBtn);

        // Copy and button are laid out as one block centred on the screen, rather
        // than at fixed y's, so it stays centred if the copy or font size changes.
        const gap = 76;
        const copyH = copy.height * copy.scaleY;
        const btnH = this.playBtn.displayHeight;
        const top = H / 2 - (copyH + gap + btnH) / 2;
        copy.y = top + copyH / 2;
        this.playBtn.y = top + copyH + gap + btnH / 2;

        this.world.add(this.readyBox);
    }

    // --- run lifecycle ------------------------------------------------------
    resetRun() {
        this.state = 'ready';
        this.obstacles = [];
        this.coins = [];
        this.obLayer.removeAll(true);
        this.coinLayer.removeAll(true);
        this.fxLayer.removeAll(true);
        this.trailGfx.clear();
        this.trail = [];
        this.trailY = null;

        this.stack = START_STACK;
        this.baseRow = 0;
        this.visualBase = 0;
        this.fallVel = 0;
        this.distance = 0;
        this.runTime = 0;
        this.lastTap = -9999;
        this.nextSpawn = 900;
        this.coinsGot = 0;
        this.coinsMade = 0;
        this.nextCoinAt = 900;
        this.coinArmed = false;
        this.coinWait = 0;
        this.finishGfx = null;

        this.blocks = [];
        this.playerCol.removeAll(true);
        this.headSprite = null;
        for (let i = 0; i < this.stack; i++) this.blocks.push(this.makeBlockSprite());
        this.reseatBlocks();
        this.playerCol.y = GROUND_Y;
        this.playerCol.x = PLAYER_X;
        this.scene1.tilePositionX = 0;
        this.dim.setAlpha(1);
        this.capRoom = -1;
        this.drawCapLine();
        this.refreshHud();
    }

    startRun() {
        this.state = 'run';
        this.tweens.killTweensOf(this.playBtn);
        this.tweens.add({ targets: this.readyBox, alpha: 0, scaleX: 0.9, scaleY: 0.9,
            duration: 200, onComplete: () => this.readyBox.setVisible(false) });
        this.tweens.add({ targets: this.dim, alpha: 0, duration: 260 });
    }

    // --- input --------------------------------------------------------------
    onTap() {
        if (this.state === 'ready') { this.startRun(); return; }
        if (this.state !== 'run') return;

        const now = this.time.now;
        if (now - this.lastTap < TAP_COOLDOWN) return;
        this.lastTap = now;

        // CEIL_ROWS is still the cap on how tall the stack can get; the tap is
        // just refused silently now that there is no rail drawn for it.
        if (this.baseRow + this.stack + 1 > CEIL_ROWS) return;

        this.stack++;
        this.insertBlockAtBottom();
        playSfx('grow');
        this.refreshHud();
    }

    // --- player -------------------------------------------------------------
    // blocks[0] is the bottom block. The container origin sits on the support
    // line and blocks are bottom-anchored, so block i spans
    // y = -(i+1)*UNIT+4 .. -i*UNIT-4.
    makeBlockSprite() {
        const r = this.add.image(UNIT / 2, 0, 'bodyBlock').setOrigin(0.5, 1);
        r.setDisplaySize(BLOCK_PX, BLOCK_PX);
        r.baseScaleY = r.scaleY;
        this.playerCol.add(r);
        return r;
    }

    reseatBlocks() {
        for (let i = 0; i < this.blocks.length; i++) this.blocks[i].y = -i * UNIT;
        this.placeHead();
    }

    // The dog rides the top block. Its ears and hat overhang the cell, so it is
    // bottom-anchored to the top block's floor and sized past a full unit.
    placeHead() {
        if (!this.blocks.length) { if (this.headSprite) this.headSprite.setVisible(false); return; }
        if (!this.headSprite) {
            // Natural aspect, so the ears and hat overhang the cell by about a
            // quarter of a row. That overhang is DECORATION ONLY — the collision
            // box is the one grid row the head occupies (see resolveObstacle,
            // which works purely in rows off `stack`), so the ears never hit
            // anything and the face still fills the cell squarely.
            this.headSprite = this.add.image(UNIT / 2, 0, 'dogHead').setOrigin(0.5, 1);
            this.headSprite.setDisplaySize(BLOCK_PX, BLOCK_PX * (153 / 123));
            this.playerCol.add(this.headSprite);
        }
        this.headSprite.setVisible(true);
        this.headSprite.y = -(this.blocks.length - 1) * UNIT;
        this.playerCol.bringToTop(this.headSprite);
    }

    insertBlockAtBottom() {
        const r = this.makeBlockSprite();
        this.blocks.unshift(r);
        this.playerCol.sendToBack(r);
        this.reseatBlocks();
        r.scaleY = r.baseScaleY * 0.2;
        this.tweens.add({ targets: r, scaleY: r.baseScaleY, duration: 140, ease: 'Back.easeOut' });
    }

    headCenterY() {
        return this.playerCol.y - (this.stack - 0.5) * UNIT;
    }

    // --- obstacles ----------------------------------------------------------
    // Lowest total the player can reach by `byTime` seconds from now. Passing a
    // pillar or float only sheds its height once you have ridden off the END of
    // it and finished falling — at 3 units wide and full speed that is ~0.64s,
    // against a ~0.78s gap, so a part arriving early (a rusher especially) can
    // land while you are still up there and still tall. Crediting the drop
    // unconditionally is what made those hits unavoidable.
    projectedMinHeight(byTime, speed) {
        let h = this.baseRow + this.stack;
        for (let i = 0; i < this.obstacles.length; i++) {
            const ob = this.obstacles[i];
            if (ob.resolved) continue;
            if (byTime !== undefined) {
                const v = speed * ob.mul;
                const shed = (ob.x - CONTACT_X) / v + (ob.w * UNIT) / v + SHED_TIME;
                if (shed > byTime) continue;          // still riding or falling
            }
            h -= ob.h + Math.max(0, (ob.cost || 0) - (ob.eaten || 0));
        }
        return Math.max(1, h);
    }

    pickObstacle(t, byTime, speed) {
        // A ground part is a 3-wide surface over at most ONE brick row, so its
        // logical height is capped at MAX_PILLAR rows.
        const maxH = MAX_PILLAR;
        const minH = 1;
        const safe = this.projectedMinHeight(byTime, speed);
        const roll = Math.random();

        // Floating parts are always the full 3-wide group; only ground pillars
        // come in an occasional single-unit variant.
        const partW = () => Math.random() < NARROW_CHANCE ? 1 : PIECE_W;

        const wall = () => {
            const h = Phaser.Math.Between(Math.min(minH, maxH), maxH);
            return { h: h, w: partW(), clearance: CEIL_ROWS, hangTop: CEIL_ROWS, style: 'pillar' };
        };

        // Spike field: no support and nothing to duck — it just eats one block
        // per unit as you cross it, which is the only part that still demands
        // real height now that pillars are capped at two rows.
        if (t > 0.12 && roll < 0.16) {
            const w = Phaser.Math.Between(2, PIECE_W);
            return { h: 0, w: w, clearance: CEIL_ROWS, hangTop: CEIL_ROWS, style: 'spikes', cost: w };
        }
        // Everything below is aimed at the lane the player is actually in.
        // `safe` is the lowest they can be when this part lands, so bands are
        // measured from there rather than from a clock: a bar parked at row 6
        // while the dog is running along the floor is not an obstacle, it is
        // scenery, and a float lower than they already are is a free ride.
        const LANE = 2;                                  // rows of slack around the lane

        // Climb part — only worth sending if it actually asks for height.
        if (t > 0.08 && roll < 0.52 && safe + 1 <= MAX_FLOAT) {
            const top = Phaser.Math.Between(safe + 1, MAX_FLOAT);
            const rows = Phaser.Math.Between(1, 2);
            return { h: top, w: PIECE_W, clearance: CEIL_ROWS, hangTop: CEIL_ROWS,
                     style: 'float', rows: rows, floatBottom: Math.max(0, top - rows) };
        }

        if (t < 0.10 || roll < 0.72 || safe > CEIL_ROWS - 2) return wall();

        // Duck part — sits just above the floor they can reach, so it always has
        // to be ducked rather than ignored.
        const lo = Phaser.Math.Between(safe, Math.min(safe + LANE, CEIL_ROWS - 2));

        if (roll < 0.92) {                                   // wide brick bar — duck under
            return { h: 0, w: PIECE_W, clearance: lo, hangTop: lo + 1, style: 'bar' };
        }
        // gate: ground pillar with something hanging over it
        const h = Phaser.Math.Between(1, maxH);
        const gMin = Math.max(h + 2, safe);
        if (gMin > CEIL_ROWS - 1) return wall();
        const glo = Phaser.Math.Between(gMin, Math.min(gMin + 1, CEIL_ROWS - 1));
        // Always brick. Cyan surfaces are things you stand on, so one must never
        // be used as a lethal hanging part — seeing a surface you cannot pass
        // under is exactly the wrong signal.
        return { h: h, w: partW(), clearance: glo, hangTop: glo + 1, style: 'bar' };
    }

    // A rusher is drawn as a bare creature, so it is always exactly one row tall
    // — the sprite then covers precisely the cell that can kill you.
    pickRusher(t, byTime, speed) {
        const safe = this.projectedMinHeight(byTime, speed);
        if (Math.random() < 0.5 && safe <= CEIL_ROWS - 2) {
            const lo = Phaser.Math.Between(safe, Math.min(safe + 1, CEIL_ROWS - 2));
            return { h: 0, w: 1, clearance: lo, hangTop: lo + 1, style: 'bar' };
        }
        return { h: 1, w: 1, clearance: CEIL_ROWS, hangTop: CEIL_ROWS, style: 'pillar' };
    }

    spawnObstacle() {
        const t = Phaser.Math.Clamp(this.runTime / RAMP_TIME, 0, 1);
        const speed = Phaser.Math.Linear(BASE_SPEED, MAX_SPEED, t);

        const normalRun = (W + 60) - CONTACT_X;
        let mul = 1, spawnX = W + 60;
        // Rushers get steadily more common toward the finish, on top of the
        // difficulty ramp — the last third of a run is where they pile up.
        const prog = Phaser.Math.Clamp(this.distance / RUN_LENGTH, 0, 1);
        const rushChance = Math.min(0.65, Phaser.Math.Linear(0.06, 0.18, t) + 0.50 * prog * prog);
        if (t > 0.18 && Math.random() < rushChance) {
            mul = Phaser.Math.FloatBetween(1.8, 2.3);
            spawnX = CONTACT_X + normalRun * mul * 0.9;
            const mine = (spawnX - CONTACT_X) / (speed * mul);
            for (let i = 0; i < this.obstacles.length; i++) {
                const o = this.obstacles[i];
                if (o.resolved) continue;
                if ((o.x - CONTACT_X) / (speed * o.mul) >= mine) { mul = 1; spawnX = W + 60; break; }
            }
        }
        const arriveT = (spawnX - CONTACT_X) / (speed * mul);
        let spec = mul > 1 ? this.pickRusher(t, arriveT, speed) : this.pickObstacle(t, arriveT, speed);

        // A rusher travels ~2x, so it overtakes coins already on their way in. If
        // it would arrive alongside one at a height it kills at, the coin becomes
        // impossible to take safely — demote it to a normal-speed piece instead.
        if (mul > 1) {
            const mine = (spawnX - CONTACT_X) / (speed * mul);
            const hangs = spec.clearance < CEIL_ROWS;
            for (let i = 0; i < this.coins.length; i++) {
                const c = this.coins[i];
                if (c.resolved) continue;
                if (Math.abs((c.x - CONTACT_X) / speed - mine) > 0.5) continue;
                const lethal = hangs ? c.row >= spec.clearance : c.row < spec.h;
                if (lethal) { mul = 1; spawnX = W + 60; break; }
            }
        }

        // A coin already in flight cannot be moved, so the piece yields to it: if
        // this piece would arrive alongside a coin at a row it kills at, lift the
        // hanging part above the coin or shorten the pillar below it. Both edits
        // only ever make the piece easier, so fairness is unaffected.
        let yielded = false;
        for (let i = 0; i < this.coins.length; i++) {
            const c = this.coins[i];
            if (c.resolved) continue;
            const dt = (c.x - CONTACT_X) / speed - (spawnX - CONTACT_X) / (speed * mul);
            if (Math.abs(dt) > 0.32) continue;
            if (spec.clearance < CEIL_ROWS && c.row >= spec.clearance) {
                const lift = c.row + 1;
                if (lift <= CEIL_ROWS - 1) {
                    spec.hangTop = Math.min(spec.hangTop + (lift - spec.clearance), CEIL_ROWS);
                    spec.clearance = lift; yielded = true;
                } else {
                    spec.clearance = CEIL_ROWS; spec.hangTop = CEIL_ROWS; yielded = true;
                }
            }
            if (spec.h > 0 && c.row < spec.h) { spec.h = c.row; yielded = true; }
        }

        if (yielded) this.yields = (this.yields || 0) + 1;

        const gfx = this.add.container(spawnX, GROUND_Y);
        const wpx = spec.w * UNIT;

        if (mul > 1) {
            // Rusher: no brickwork at all. A bare creature with a blue trail
            // squared off behind it, so it reads as a thing charging at you
            // rather than a wall that happens to move.
            const air = spec.h === 0;
            const row = air ? spec.clearance : 0;
            const cy = -(row + 0.5) * UNIT;

            const tr = this.add.graphics();
            const half = UNIT * 0.34, len = 380, seg = 18;
            for (let k = 0; k < seg; k++) {
                tr.fillStyle(0x1f8fe8, 0.5 * (1 - k / seg));
                tr.fillRect(wpx * 0.5 + (len * k) / seg, cy - half, len / seg + 1, half * 2);
            }
            gfx.add(tr);

            const cr = this.add.image(wpx * 0.5, cy, air ? 'rusherAir' : 'rusherGround').setOrigin(0.5, 0.5);
            const cw = UNIT * 1.32;
            cr.setDisplaySize(cw, cw * (air ? 189 / 248 : 226 / 331));
            gfx.add(cr);

            // Telegraph: the bubble flashes at the right edge on the exact row
            // the rusher will arrive on, since it is only visible for about half
            // the usual approach.
            const warn = this.add.image(W - 118, GROUND_Y + cy, 'warn').setOrigin(0.5, 0.5);
            warn.setDisplaySize(168, 168 * (147 / 182));
            this.obLayer.add(warn);
            this.tweens.add({ targets: warn, scaleX: warn.scaleX * 1.15, scaleY: warn.scaleY * 1.15,
                duration: 190, yoyo: true, repeat: 2 });
            this.tweens.add({ targets: warn, alpha: 0, duration: 240, delay: 760,
                onComplete: () => warn.destroy() });
        } else if (spec.style === 'spikes') {
            for (let cx = 0; cx < spec.w; cx++) {
                const sp = this.add.image(cx * UNIT + UNIT / 2, 0, 'spike', cx % 4).setOrigin(0.5, 1);
                sp.setDisplaySize(UNIT, UNIT * (105 / 115));
                gfx.add(sp);
            }
        } else {
            // Two tiles, no compounds. `1x3tile_surface` IS the complete surface
            // block — white lip, cyan body, pink underside — so it is drawn once
            // per surface row, stretched to fill that row exactly. Brick rows go
            // underneath it. A 3x2 group is therefore one surface over one row of
            // 3x1 bricks, which is all these parts are ever made of.
            const surfaceRow = (row) => {
                const t2 = this.add.image(0, -(row + 1) * UNIT, 'platformCap').setOrigin(0, 0);
                t2.setDisplaySize(wpx, UNIT);
                gfx.add(t2);
            };
            const brickRow = (row) => {
                for (let cx = 0; cx < spec.w; cx++) {
                    const b = this.add.image(cx * UNIT, -(row + 1) * UNIT, 'brick').setOrigin(0, 0);
                    b.setDisplaySize(UNIT, UNIT);
                    gfx.add(b);
                }
            };

            // Ground part: bricks below, surface on the row you land on.
            // Float part: the same top, just with nothing under it.
            if (spec.h > 0) {
                const artRows = spec.style === 'float' ? Math.min(spec.rows || 1, spec.h) : spec.h;
                const bottom = spec.h - artRows;
                for (let r = bottom; r < spec.h - 1; r++) brickRow(r);
                surfaceRow(spec.h - 1);
            }

            // Hanging part. Its lowest row is `clearance` — the row the dog's head
            // must stay under — so the art bottoms out exactly on the killing line.
            const rows = spec.hangTop - spec.clearance;
            if (rows > 0) {
                if (spec.style === 'bar') {
                    for (let r = 0; r < rows; r++) brickRow(spec.clearance + r);
                } else {
                    for (let r = 0; r < rows - 1; r++) brickRow(spec.clearance + r);
                    surfaceRow(spec.hangTop - 1);
                }
            }
        }

        this.obLayer.add(gfx);
        const self = {
            x: spawnX, w: spec.w, h: spec.h,
            clearance: spec.clearance, hangTop: spec.hangTop,
            mul: mul, resolved: false, gfx: gfx,
            cost: spec.cost || 0, eaten: 0,
            floatBottom: spec.floatBottom || 0, support: spec.h
        };
        this.obstacles.push(self);

        // Runway is the time between one obstacle ARRIVING and the next arriving.
        // A wall of height h leaves you at 1, so the next costs h taps = (h-1)
        // cooldowns. By full ramp the window is under what the taller walls need.
        const arrivalGap = Phaser.Math.Linear(1.55, 0.78, t) * Phaser.Math.FloatBetween(0.93, 1.07);
        // Spacing is arrival-to-arrival, NOT clear ground: that interval is the
        // whole rebuild window, so adding the piece width to it widened the
        // window by ~0.4s at 3 units and removed the difficulty squeeze entirely.
        // The (w+1) floor is only there to stop parts touching.
        this.nextSpawn = Math.max(arrivalGap * speed, (spec.w + 1) * UNIT);

        // Coins are laid out against this piece, the way the level art does it:
        // under a hanging bar or ledge, on top of a ground pillar. The row is the
        // one that piece leaves open, so a coin is never sitting at a height that
        // the thing right next to it would kill you at.
        if (this.coinArmed && this.coinsMade < COIN_TOTAL) {
            const hangs = spec.clearance < CEIL_ROWS;
            // Under a hanging bar or ledge, on top of a ground pillar — never a
            // row the piece itself occupies. Clamping the row would bury the coin
            // inside a tall pillar, so a piece with no room simply gets no coin
            // and the next one takes it.
            const row = hangs ? spec.clearance - 1 : spec.h;
            if (spec.cost) return;                   // spikes are not a perch
            const cx = spawnX + (spec.w - 1) * UNIT * 0.5;
            if (row >= 1 && row <= CEIL_ROWS - 2 && this.coinRowClear(cx, row, speed, self)) {
                this.coinArmed = false;
                this.coinWait = 0;
                this.spawnCoin(cx, row);
            }
        }
    }

    // The dog is the player. Body blocks are expendable — a wall shears the ones
    // below its top edge and the rest rides over — but anything that touches the
    // dog ends the run. The dog is always on top, so a hanging slab can never
    // take "just the top few": walls shave, slabs kill.
    // ONE rule for every solid part. A part is a list of occupied row spans,
    // lowest first: a pillar is [0, h), a float is [h-rows, h), a bar is
    // [clearance, hangTop), and a gate has both. For each span, in order:
    //
    //   head below it  -> passes underneath, no interaction
    //   head inside it -> dead
    //   head above it  -> lands on top; everything below the span is sheared
    //
    // The old code special-cased the hanging span as "if it touches you at all
    // you die", which was true only while hanging parts still reached the
    // ceiling. Bars are one row thick and float now, so being ABOVE one is a
    // legitimate position and used to kill you anyway.
    resolveObstacle(ob) {
        const spans = [];
        if (ob.h > 0) spans.push({ lo: ob.floatBottom || 0, hi: ob.h, cause: 'wall' });
        if (ob.clearance < CEIL_ROWS) spans.push({ lo: ob.clearance, hi: ob.hangTop, cause: 'slab' });

        ob.support = 0;
        for (let i = 0; i < spans.length; i++) {
            const sp = spans[i];
            // Mid-fall the dog sits between rows, so each test reads the
            // fractional position the way that FAVOURS him: the highest possible
            // head against something below, the lowest against something above.
            const headHi = Math.ceil(this.visualBase) + this.stack - 1;
            const headLo = Math.floor(this.visualBase) + this.stack - 1;

            if (headHi < sp.lo) continue;                          // clean pass beneath
            if (headLo >= sp.lo && headHi < sp.hi) { this.wipeOut(sp.cause); return; }

            // Head is above the span: land on it, losing whatever sat below.
            const cut = Math.max(0, sp.hi - Math.round(this.visualBase));
            if (cut >= this.stack) { this.wipeOut(sp.cause); return; }
            if (cut > 0) {
                playSfx('drop');
                this.spawnDebris(cut, 0);
                for (let k = 0; k < cut; k++) this.blocks.shift().destroy();
                this.stack -= cut;
                this.reseatBlocks();
                this.lurch();
                this.cameras.main.shake(120, 0.006);
            }
            this.visualBase = sp.hi;
            this.baseRow = sp.hi;
            ob.support = sp.hi;
        }
        this.refreshHud();
    }

    lurch() {
        this.tweens.killTweensOf(this.playerCol);
        this.playerCol.x = PLAYER_X + 26;
        this.tweens.add({ targets: this.playerCol, x: PLAYER_X, duration: 220, ease: 'Quad.easeOut' });
    }

    wipeOut(cause) {
        playSfx('death');
        const top = this.stack;
        this.puff(PLAYER_X + UNIT / 2, GROUND_Y - this.visualBase * UNIT - top * UNIT * 0.5, top);
        // Everything the dog was made of just fades out under the smoke.
        const gone = this.blocks.concat(this.headSprite ? [this.headSprite] : []);
        gone.forEach(o => this.tweens.add({ targets: o, alpha: 0, scaleX: o.scaleX * 0.7,
            scaleY: o.scaleY * 0.7, duration: 190, onComplete: () => o.destroy() }));
        this.stack = 0;
        this.blocks = [];
        this.headSprite = null;
        this.finish(false, cause);
    }

    puff(x, y, rows) {
        const n = 7 + rows * 2;
        for (let i = 0; i < n; i++) {
            const a = (i / n) * Math.PI * 2 + Math.random();
            const d = Phaser.Math.Between(30, 60 + rows * 26);
            const s0 = Phaser.Math.FloatBetween(0.7, 1.5) * (UNIT / 128) * 1.1;
            const q = this.add.image(x, y, 'puff').setOrigin(0.5, 0.5).setScale(s0 * 0.4);
            this.fxLayer.add(q);
            this.tweens.add({
                targets: q,
                x: x + Math.cos(a) * d, y: y + Math.sin(a) * d * 0.8,
                scaleX: s0 * 1.5, scaleY: s0 * 1.5, alpha: 0,
                duration: Phaser.Math.Between(360, 560), ease: 'Quad.easeOut',
                onComplete: () => q.destroy()
            });
        }
    }

    spawnDebris(count, fromRow) {
        for (let i = 0; i < count; i++) {
            const y = GROUND_Y - (this.visualBase + fromRow + i + 1) * UNIT;
            const d = this.add.image(PLAYER_X + UNIT / 2, y, 'bodyBlock').setOrigin(0.5, 0);
            d.setDisplaySize(BLOCK_PX, BLOCK_PX);
            this.fxLayer.add(d);
            this.tweens.add({
                targets: d,
                x: PLAYER_X - Phaser.Math.Between(120, 420),
                y: y + Phaser.Math.Between(180, 460),
                angle: Phaser.Math.Between(-240, 240),
                alpha: 0, scale: d.scale * 0.6,
                duration: 620, ease: 'Quad.easeIn',
                onComplete: () => d.destroy()
            });
        }
    }

    // --- coins --------------------------------------------------------------
    // Coins come in pairs at one height, matching the level art. Both sit on the
    // same row, so a pair is a single height to hit rather than two.
    // The other half of the rusher guard. A rusher already in flight when this
    // piece spawns was never checked against its coin, so test the coin against
    // everything on the field — excluding the piece it is deliberately sitting
    // on, which is safe by construction.
    coinRowClear(cx, row, speed, own) {
        // Height is one-way: taps raise it, only pillars lower it. So a coin is
        // only reachable if the player can still come DOWN to it — head row r
        // means total r+1, and projectedMinHeight is the lowest total they can
        // reach given the pillars still queued. Without this, climbing for a high
        // coin permanently strands every lower coin after it.
        if (row + 1 < this.projectedMinHeight((cx - CONTACT_X) / speed, speed)) return false;
        const mine = (cx - CONTACT_X) / speed;
        for (let i = 0; i < this.obstacles.length; i++) {
            const o = this.obstacles[i];
            if (o === own || o.resolved) continue;
            if (Math.abs((o.x - CONTACT_X) / (speed * o.mul) - mine) > 0.5) continue;
            const hangs = o.clearance < CEIL_ROWS;
            if (hangs ? row >= o.clearance : (o.h > 0 && row < o.h)) return false;
        }
        return true;
    }

    spawnCoin(atX, row) {
        const n = Math.min(2, COIN_TOTAL - this.coinsMade);
        const x0 = Math.max(atX, W + 60) - (n - 1) * UNIT * 0.46;
        for (let i = 0; i < n; i++) {
            const x = x0 + i * UNIT * 0.92;
            const c = this.add.image(x, GROUND_Y - (row + 0.5) * UNIT, 'coin').setOrigin(0.5, 0.5);
            c.setDisplaySize(UNIT * 0.82, UNIT * 0.82 * (186 / 153));
            this.coinLayer.add(c);
            this.coins.push({ x: x, row: row, resolved: false, gfx: c });
            this.coinsMade++;
            this.tweens.add({ targets: c, scaleX: c.scaleX * 1.12, scaleY: c.scaleY * 1.12,
                duration: 460, yoyo: true, repeat: -1, ease: 'Sine.easeInOut', delay: i * 120 });
        }
    }

    takeCoin(coin) {
        this.coinsGot++;
        playSfx('coin');
        // Pop clear of the dog, to his right, so it never sits on top of him.
        const fxX = PLAYER_X + UNIT * 1.7, fxY = coin.gfx.y;
        const fx = this.add.image(fxX, fxY, 'coinFx').setOrigin(0.5, 0.5);
        fx.setDisplaySize(UNIT, UNIT * (63 / 76));
        this.fxLayer.add(fx);
        this.tweens.add({ targets: fx, scaleX: fx.scaleX * 2.2, scaleY: fx.scaleY * 2.2,
            alpha: 0, duration: 380, onComplete: () => fx.destroy() });

        const plus = label(this, fxX, fxY, '+1', 56, '#ffc72e');
        plus.setShadow(0, 4, 'rgba(20,40,80,0.5)', 6, false, true);
        this.fxLayer.add(plus);
        this.tweens.add({ targets: plus, y: fxY - 120, alpha: 0, duration: 620,
            ease: 'Quad.easeOut', onComplete: () => plus.destroy() });
        // Hold the sprite in a local: coin.gfx is cleared straight away so the
        // update loop stops tracking it, and the tween must not read it back.
        const g = coin.gfx;
        coin.gfx = null;
        this.tweens.killTweensOf(g);
        this.tweens.add({ targets: g, y: g.y - 90, alpha: 0, duration: 320,
            onComplete: () => g.destroy() });
        this.refreshHud();
    }

    // --- trail --------------------------------------------------------------
    // A white ribbon behind the dog. Samples are pushed at the head's position
    // and then drift left with the world, so the ribbon curves whenever the dog
    // rises or drops rather than being a straight streak.
    //
    // Two things make the curve read. The sampled height is eased toward the
    // head rather than snapped, so a tap draws an arc instead of a step; and the
    // ribbon is trimmed by DISTANCE travelled rather than by a frame count, so
    // its length is the same at any frame rate or scroll speed.
    updateTrail(step, dt) {
        const target = this.headCenterY();
        this.trailY = this.trailY === null ? target
                                           : this.trailY + (target - this.trailY) * Math.min(1, dt * 12);

        for (let i = 0; i < this.trail.length; i++) this.trail[i].x -= step;
        this.trail.push({ x: PLAYER_X + UNIT / 2, y: this.trailY });
        const tail = PLAYER_X + UNIT / 2 - TRAIL_LEN;
        while (this.trail.length > 2 && this.trail[0].x < tail) this.trail.shift();
        while (this.trail.length > 240) this.trail.shift();

        const g = this.trailGfx;
        g.clear();
        const n = this.trail.length;
        if (n < 3) return;
        for (let i = 1; i < n; i++) {
            const a = this.trail[i - 1], b = this.trail[i];
            const f0 = (i - 1) / (n - 1), f1 = i / (n - 1);
            // Constant width: the ribbon squares off at the tail rather than
            // narrowing to a point. Only the alpha falls away.
            const w0 = TRAIL_HALF, w1 = TRAIL_HALF;
            g.fillStyle(0xffffff, 0.85 * f1 * f1);
            g.fillPoints([
                { x: a.x, y: a.y - w0 }, { x: b.x, y: b.y - w1 },
                { x: b.x, y: b.y + w1 }, { x: a.x, y: a.y + w0 }
            ], true);
        }
    }

    // --- loop ---------------------------------------------------------------
    update(time, delta) {
        if (this.state !== 'run') return;
        const dt = Math.min(delta, 50) / 1000;
        this.runTime += dt;

        const t = Phaser.Math.Clamp(this.runTime / RAMP_TIME, 0, 1);
        const speed = Phaser.Math.Linear(BASE_SPEED, MAX_SPEED, t);
        const step = speed * dt;
        this.distance += step;

        this.scene1.tilePositionX += step / SCENE_SCALE;
        this.drawCapLine();

        for (let i = this.obstacles.length - 1; i >= 0; i--) {
            const ob = this.obstacles[i];
            ob.x -= step * ob.mul;
            ob.gfx.x = ob.x;
            if (ob.x + ob.w * UNIT < -40) { ob.gfx.destroy(); this.obstacles.splice(i, 1); }
        }

        for (let i = 0; i < this.obstacles.length; i++) {
            const ob = this.obstacles[i];
            if (ob.cost && !ob.resolved) {
                // One spike, one block — taken as each unit passes rather than
                // all at once, so you watch the stack get chewed down.
                const passed = Math.min(ob.cost, Math.floor((CONTACT_X - ob.x) / UNIT) + 1);
                while (ob.eaten < passed) {
                    ob.eaten++;
                    // Riding above the spikes clears them entirely.
                    if (Math.ceil(this.visualBase) > 0) break;
                    if (this.stack <= 1) { this.wipeOut('spikes'); return; }
                    playSfx('drop');
                    this.spawnDebris(1, 0);
                    this.blocks.shift().destroy();
                    this.stack--;
                    this.reseatBlocks();
                    this.cameras.main.shake(90, 0.004);
                    this.refreshHud();
                }
                if (passed >= ob.cost) ob.resolved = true;
                continue;
            }
            if (!ob.resolved && ob.x <= CONTACT_X) {
                ob.resolved = true;
                this.resolveObstacle(ob);
                if (this.state !== 'run') return;
            }
        }

        let support = 0;
        for (let i = 0; i < this.obstacles.length; i++) {
            const ob = this.obstacles[i];
            if (ob.x <= CONTACT_X && ob.x + ob.w * UNIT > CONTACT_X) {
                support = Math.max(support, ob.support === undefined ? ob.h : ob.support);
            }
        }
        // `support` is only the TARGET height. The logical base has to track what
        // is actually drawn, not snap ahead of it: stepping off a 5-high float
        // used to drop baseRow instantly while the sprite spent ~0.3s falling, so
        // for those frames the dog collided at ground level while being drawn
        // five rows up — an arriving wall killed you from below, and a slab you
        // were visibly inside let you through. Deriving baseRow from visualBase
        // keeps hit detection and the sprite in the same place by construction.
        if (this.visualBase > support) {
            this.fallVel += FALL_ACCEL * dt;
            this.visualBase -= this.fallVel * dt;
            if (this.visualBase <= support) { this.visualBase = support; this.fallVel = 0; }
        } else if (this.visualBase < support) {
            this.visualBase = support;               // a shear lifts you instantly
            this.fallVel = 0;
        }
        this.baseRow = Math.round(this.visualBase);
        this.playerCol.y = GROUND_Y - this.visualBase * UNIT;

        // Coins: collected if the cell lands anywhere inside the column, so a
        // taller stack sweeps up more of them.
        for (let i = this.coins.length - 1; i >= 0; i--) {
            const c = this.coins[i];
            c.x -= step;
            if (c.gfx) c.gfx.x = c.x;
            if (!c.resolved && c.x <= CONTACT_X) {
                c.resolved = true;
                // Only the dog collects — the body blocks pass straight through,
                // so a coin's row is exactly the height you have to be.
                if (c.row === this.baseRow + this.stack - 1) this.takeCoin(c);
            }
            if (c.x < -140) { if (c.gfx) c.gfx.destroy(); this.coins.splice(i, 1); }
        }

        this.updateTrail(step, dt);

        this.nextSpawn -= step;
        if (this.nextSpawn <= 0 && this.distance < RUN_LENGTH - 1400) this.spawnObstacle();

        // Coin pacing: a coin becomes due on a timer, but it is only released
        // halfway through the gap after the next obstacle spawns. That places it
        // as far from both neighbours as the layout allows, so a coin is never
        // sitting in the approach to a wall.
        if (this.coinsMade < COIN_TOTAL) {
            this.nextCoinAt -= step;
            if (this.nextCoinAt <= 0) {
                this.coinArmed = true;
                this.nextCoinAt = (RUN_LENGTH - 2200) / (COIN_TOTAL / 2);
            }
        }
        // Near the finish no more obstacles spawn, so there is no mid-gap to wait
        // for. Release a held coin anyway once it has waited long enough — with
        // nothing queued there is no approach for it to sit in.
        if (this.coinArmed) {
            this.coinWait += step;
            if (this.coinWait > 700) {
                // Fallback for when no piece had room (or none are spawning near
                // the finish). Still has to clear every obstacle in flight — this
                // path used to drop a coin on a random row and was the one place
                // an unreachable coin could slip through.
                for (let r = 1; r <= CEIL_ROWS - 3; r++) {
                    if (this.coinRowClear(W + 80, r, speed, null)) {
                        this.coinArmed = false; this.coinWait = 0;
                        this.spawnCoin(W + 80, r);
                        break;
                    }
                }
            }
        }


        // Finish line slides in so it arrives exactly as the run completes.
        if (!this.finishGfx && this.distance >= RUN_LENGTH - (W - CONTACT_X)) {
            this.finishGfx = this.add.image(W + 200, GROUND_Y + 20, 'finish').setOrigin(0.5, 1);
            this.finishGfx.setDisplaySize(700, 700 * (749 / 738));
            this.obLayer.add(this.finishGfx);
        }
        if (this.finishGfx) this.finishGfx.x -= step;

        if (this.distance >= RUN_LENGTH) { this.finish(true, 'goal'); return; }

        this.refreshHud();
    }

    drawCapLine() {
        const room = Phaser.Math.Clamp(CEIL_ROWS - (this.baseRow + this.stack), 0, 4);
        if (room === this.capRoom) return;             // only redraw on change
        this.capRoom = room;
        const f = 1 - room / 4;                        // 0 far away, 1 at the cap
        const g = this.capLine;
        g.clear();
        g.fillStyle(0x1f5fd8, 0.14 + 0.62 * f * f);
        const r = 4 + 4 * f;
        for (let x = 10; x < W; x += 34) g.fillCircle(x, CEIL_Y, r);
    }

    refreshHud() {
        this.coinText.setText(this.coinsGot + '/' + COIN_TOTAL);
        const p = Phaser.Math.Clamp(this.distance / RUN_LENGTH, 0, 1);
        this.progFill.setCrop(0, 0, Math.max(6, 400 * p), 100);
        // Clamp so the oversized head marker stays inside the capsule at both ends.
        this.progMark.x = this.trackX + this.trackW * Phaser.Math.Clamp(p, 0.13, 0.93);
    }

    finish(won, cause) {
        if (this.state === 'over') return;
        this.state = 'over';
        bestCoins = Math.max(bestCoins, this.coinsGot);
        this.time.delayedCall(won ? 250 : 420, () => {
            this.scene.start('EndScene', { won: won, coins: this.coinsGot, cause: cause });
        });
    }
}

// ---------------------------------------------------------------------------
class EndScene extends Phaser.Scene {
    constructor() { super('EndScene'); }
    init(data) { this.payload = data || {}; }

    create() {
        const world = this.add.container(OX, OY).setScale(S);

        // Sky stays empty here too so the camera keeps showing behind the panel.
        const scene1 = this.add.tileSprite(0, SCENE_Y, W, H - SCENE_Y, 'scene').setOrigin(0, 0);
        scene1.tileScaleX = SCENE_SCALE;
        scene1.tileScaleY = SCENE_SCALE;
        world.add(scene1);

        const dim = this.add.graphics();
        dim.fillGradientStyle(0x000000, 0x000000, 0x000000, 0x000000, 0.10, 0.10, 0.42, 0.42);
        dim.fillRect(-W, -H, W * 3, H * 3);
        world.add(dim);

        const box = this.add.container(W / 2, 900);
        const panel = this.add.image(0, 0, 'panel').setOrigin(0.5, 0.5);
        panel.setDisplaySize(820, 820 * (504 / 684));
        box.add(panel);

        // Coin pips straddling the panel's top edge, arced so the middle one
        // sits proud of the pair beside it.
        const got = this.payload.coins || 0;
        const pips = 3, pipSize = 178, panelTop = -PANEL_H / 2;
        for (let i = 0; i < pips; i++) {
            const filled = i < Math.min(pips, Math.ceil(got / COIN_TOTAL * pips));
            const mid = i === (pips - 1) / 2;
            const pip = this.add.image((i - (pips - 1) / 2) * (pipSize + 10),
                panelTop + (mid ? 4 : 60),
                filled ? 'pipFull' : 'pipEmpty').setOrigin(0.5, 0.5);
            pip.setDisplaySize(pipSize, pipSize);
            box.add(pip);
        }

        box.add(fitLabel(this, 0, -98, this.payload.won ? 'YOU WIN' : 'GAME OVER', 68, 30, PANEL_W - 150, '#123f9e'));
        box.add(fitLabel(this, 0, 6, got + '/' + COIN_TOTAL, 86, 40, PANEL_W - 200, '#123f9e'));

        const btn = this.add.image(0, 165, 'btnRetry').setOrigin(0.5, 0.5);
        btn.setDisplaySize(420, 420 * (171 / 481));
        box.add(btn);

        world.add(box);
        box.setScale(0.7); box.setAlpha(0);
        this.tweens.add({ targets: box, scaleX: 1, scaleY: 1, alpha: 1, duration: 260, ease: 'Back.easeOut' });

        this.time.delayedCall(400, () => {
            this.input.once('pointerdown', () => this.scene.start('GameScene'));
        });
    }
}

// ---------------------------------------------------------------------------
const config = {
    type: Phaser.WEBGL,
    width: windowWidth,
    height: windowHeight,
    canvas: window.canvas,
    // Camera game: the host composites its camera feed behind this canvas, so
    // the canvas must stay transparent and nothing opaque may cover the sky.
    transparent: true,
    physics: { default: 'arcade', arcade: { debug: false, gravity: { y: 0 } } },
    scene: [BootScene, GameScene, EndScene],
    input: { mouse: true, touch: true }
};

const game = new Phaser.Game(config);
