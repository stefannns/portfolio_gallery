require('libs/tt-adapter.js');
const Phaser = require('libs/phaser.js');

const res = tt.getSystemInfoSync();
const windowWidth = res.screenWidth;
const windowHeight = res.screenHeight;

// Design Space
const W = 1080;
const H = 1920;

// UI Style
const UI_STYLE_CONFIG = {
    paletteRoles: {
        panelSurface: "#FFFFFF",
        primaryAction: "#cd853f",
        secondaryAction: "#643917",
        textOnPanel: "#643917",
        textOnPrimaryButton: "#FFFFFF",
        textOnBusyImage: "#e8c9a0",
        textStroke: "#333333",
        shadow: "#643917",
        border: "#643917"
    },
    typography: {
        fontStack: "'Rubik', Arial, sans-serif",
        roles: {
            title: { min: 40, max: 64 },
            body: { min: 28, max: 40 },
            cta: { min: 32, max: 56 },
            hudValue: { min: 40, max: 56 },
            hudLabel: { min: 24, max: 36 },
            caption: { min: 22, max: 32 }
        }
    }
};

// Small drop shadow behind a chrome nineslice / image
function addChromeShadow(obj) {
    obj.postFX.addShadow(0, 0.5, 0.06, 1.5, 0x000000, 6, 0.2);
}

// Chrome image button (golden / green pill from SVG)
function createButton(scene, x, y, width, height, textStr, actionCallback, chromeKey = 'button_chrome') {
    const c = scene.add.container(x, y);

    // Size by HEIGHT and keep the chrome's native aspect (never stretch the button).
    const bg = scene.add.image(0, 0, chromeKey);
    bg.displayHeight = height;
    bg.scaleX = bg.scaleY;
    const realW = bg.displayWidth;
    c.add(bg);

    const ctaStyle = {
        fontFamily: UI_STYLE_CONFIG.typography.fontStack,
        color: UI_STYLE_CONFIG.paletteRoles.textOnPrimaryButton,
        stroke: UI_STYLE_CONFIG.paletteRoles.textStroke,
        strokeThickness: 8,
        fontStyle: 'bold'
    };
    const txt = createFittedText(scene, 0, -height * 0.05, textStr, 72, 54, realW * 0.7, ctaStyle, 0.5, 0.5);
    c.add(txt);

    const zone = scene.add.zone(0, 0, realW, height).setInteractive();
    c.add(zone);

    zone.on('pointerdown', () => c.setScale(0.95));
    const reset = () => c.setScale(1);
    zone.on('pointerout', reset);
    zone.on('pointercancel', reset);
    zone.on('pointerup', () => {
        reset();
        actionCallback();
    });

    return c;
}

// Image-based button (clay chrome art) with a press-down effect.
function createImageButton(scene, x, y, key, height, actionCallback) {
    const img = scene.add.image(x, y, key);
    img.displayHeight = height;
    img.scaleX = img.scaleY;
    const base = img.scaleX;
    img.setInteractive();
    img.on('pointerdown', () => img.setScale(base * 0.93));
    img.on('pointerout', () => img.setScale(base));
    img.on('pointercancel', () => img.setScale(base));
    img.on('pointerup', () => {
        img.setScale(base);
        actionCallback();
    });
    return img;
}

// Layered cartoon title (Penguin Bouncer style): brown halo behind a coloured
// fill with a white outline. Both layers use ONE shared font size and identical
// position/wrap so the outlines line up exactly.
function createTitle(scene, parent, x, y, content, frontColor, maxWidth) {
    const base = { fontFamily: UI_STYLE_CONFIG.typography.fontStack, fontStyle: 'bold', align: 'center' };
    // Single line (no wrap) so the two stroke layers can't drift apart — Phaser's
    // per-line height is fontSize+strokeThickness, so a multi-line title would space
    // the thick back layer differently from the front. Shrink to fit the slot width.
    let size = 96;
    const probe = scene.add.text(0, 0, content, { ...base, fontSize: `${size}px`, strokeThickness: 22 });
    while (size > 44 && probe.width > maxWidth) { size -= 2; probe.setFontSize(size); }
    probe.destroy();
    const make = (color, strokeColor, strokeW) => scene.add.text(x, y, content, {
        ...base, fontSize: `${size}px`, color, stroke: strokeColor, strokeThickness: strokeW,
    }).setOrigin(0.5);
    const back = make('#5A3A29', '#5A3A29', 22);
    const front = make(frontColor, '#ffffff', 11);
    parent.add(back);
    parent.add(front);
    return front;
}

const audioPool = {};
function getAudio(src, { loop = false, volume = 1.0 } = {}) {
    if (!audioPool[src]) {
        const audio = tt.createInnerAudioContext();
        audio.src = src;
        audio.loop = loop;
        audio.volume = volume;
        audioPool[src] = audio;
    }
    return audioPool[src];
}

function playAudio(src, { loop = false, volume = 1.0 } = {}) {
    const audio = getAudio(src, { loop, volume });
    audio.stop();
    audio.play();
    return audio;
}

// UI Helper: Text Fit
function createFittedText(scene, x, y, text, roleMax, roleMin, maxWidth, styleBase, originX = 0.5, originY = 0.5) {
    let currentSize = roleMax;
    let t = scene.add.text(0, 0, text, { ...styleBase, fontSize: `${currentSize}px`, wordWrap: { width: maxWidth } });
    t.setOrigin(originX, originY);

    // Simple fit logic
    while (currentSize > roleMin) {
        if (t.width <= maxWidth && t.height <= 300) {
            break;
        }
        currentSize -= 2;
        t.setStyle({ ...styleBase, fontSize: `${currentSize}px` });
    }
    t.setPosition(x, y);
    return t;
}

function adjustDisplaySize(sprite, targetW, targetH, isWidthSensitive = true) {
    if (isWidthSensitive) {
        sprite.displayWidth = targetW;
        sprite.scaleY = sprite.scaleX;
    } else {
        sprite.displayHeight = targetH;
        sprite.scaleX = sprite.scaleY;
    }
}

class BootScene extends Phaser.Scene {
    constructor() { super('BootScene'); }

    preload() {
        this.load.text('gameConfig', 'game.config.json');
        this.load.image('bg_hills', 'assets/bg_hills2.png');
        this.load.image('mushroom', 'assets/mushroom.png');
        this.load.image('beetle', 'assets/beetle.png');
        this.load.image('rock', 'assets/rock.png');
        this.load.image('finish', 'assets/finish.png');
        this.load.image('trunk_long', 'assets/trunk_long.png');
        this.load.image('trunk_short', 'assets/trunk_short.png');
        this.load.image('star_small', 'assets/star_small.png');
        this.load.image('star_big', 'assets/star_big.png');
        this.load.image('ui_progress', 'assets/ui_progress.png');
        this.load.image('ui_sheep_head', 'assets/ui_sheep_head.png');
        this.load.image('ui_stars', 'assets/ui_stars.png');
        this.load.image('fg_strip', 'assets/fg_strip.png');
        this.load.image('button_chrome', 'assets/button_chrome.png');
        this.load.image('ui_play', 'assets/ui_play.png');
        this.load.image('ui_voice', 'assets/ui_voice.png');
        this.load.image('ui_retry', 'assets/ui_retry.png');
        this.load.image('ui_panel', 'assets/ui_panel.png');
        this.load.image('star_on', 'assets/star_on.png');
        this.load.image('star_off', 'assets/star_off.png');
        this.load.image('char_walk1', 'assets/char_walk1.png');
        this.load.image('char_walk2', 'assets/char_walk2.png');
        this.load.image('char_walk3', 'assets/char_walk3.png');
        this.load.image('char_idle', 'assets/char_idle.png');
        this.load.image('char_jump1', 'assets/char_jump1.png');
        this.load.image('char_jumpmax', 'assets/char_jumpmax.png');
    }

    create() {
        // No start page: the game scene itself is shown frozen behind a
        // record button (see GameScene's pre-start state).
        this.scene.start('GameScene');
    }
}

class GameScene extends Phaser.Scene {
    constructor() { super('GameScene'); }

    init() {
        this.starsCollected = 0;
        this.starGoal = 15;
        // Frozen pre-start state: the scene is fully built and visible behind a
        // record button; tapping it flips isPlaying on and the run begins.
        this.isPlaying = false;
        this.levelDone = false;
        // Once the finish rock is fully on screen the world locks in place and
        // the sheep runs the last stretch itself.
        this.finishLocked = false;
        this.timeElapsed = 0;

        const gameConfigStr = this.cache.text.get('gameConfig');
        const gameConfig = JSON.parse(gameConfigStr);
        const playConfig = gameConfig.gamePlayConfig || {};

        this.baseJump = playConfig.jumpVelocity ? playConfig.jumpVelocity.value : -1000;
        this.baseGravity = playConfig.gravity ? playConfig.gravity.value : 2500;
        // Scales jump HEIGHT (h scales with jumpScale^2) without touching air-speed:
        // 1.0 -> ~355px, enough to clear the fixed obstacles comfortably.
        this.jumpScale = 1.0;
        // Dynamic values; recomputed each frame in update() so air time shrinks
        // as speed rises (jump height stays constant).
        this.jumpVelocity = this.baseJump * this.jumpScale;
        this.physics.world.gravity.y = this.baseGravity;
        this.baseSpeed = playConfig.baseSpeed ? playConfig.baseSpeed.value : 400;
        this.maxSpeed = playConfig.maxSpeed ? playConfig.maxSpeed.value : 1200;

        this.currentSpeed = this.baseSpeed;
        // Voice control: RMS mic level above the threshold triggers a jump.
        this.voiceLevel = 0;
        this.voiceThreshold = 0.15;
        this.voiceMax = 0.4;
        // Fixed level: the whole course is laid out at create() and scrolls past.
        this.levelLength = 16000;
        // Height difference between the two log levels. Too tall for a normal
        // jump (355px) — only a mushroom launch reaches the upper log.
        this.levelDiff = 500;
        this.moverExtraSpeed = 150;
        // Mushroom launchpad strength, as a multiple of the normal jump velocity.
        this.launchBoost = 1.5;
        this.worldSprites = [];
    }

    create() {
        const scaleX = windowWidth / W;
        const scaleY = windowHeight / H;
        const scaleRatio = Math.min(scaleX, scaleY);
        // Zoom out ~20% so the player sees further ahead and has time to react;
        // most of the extra width goes to the incoming (right) side.
        const ZOOM_OUT = 0.8;
        const zoom = scaleRatio * ZOOM_OUT;
        this.cameras.main.setZoom(zoom);
        const visW = windowWidth / zoom;
        const visH = windowHeight / zoom;
        const extraW = Math.max(0, visW - W);
        const camCenterX = W / 2 + extraW * 0.35;
        this.cameras.main.centerOn(camCenterX, H / 2);
        this.viewRightX = camCenterX + visW / 2;

        // Parallax background: copies of the hills art laid side by side, every
        // other one horizontally flipped so the seams match, scrolling slower
        // than the foreground (see update()).
        this.camLeftX = camCenterX - visW / 2;
        this.bgBottomY = H / 2 + visH / 2;
        const bgScale = 1560 / 956;
        this.bgTileW = 2100 * bgScale;
        this.bgTiles = [];
        // Even tile count so the flip pattern stays alternating when recycled.
        let bgCount = Math.ceil(visW / this.bgTileW) + 1;
        bgCount = Math.max(2, bgCount + (bgCount % 2));
        for (let i = 0; i < bgCount; i++) {
            const t = this.add.image(this.camLeftX + i * this.bgTileW, this.bgBottomY + 150, 'bg_hills').setOrigin(0, 1).setDepth(-5);
            t.setScale(bgScale);
            t.flipX = i % 2 === 1;
            this.bgTiles.push(t);
        }

        // Ground band metrics (segments are spawned in buildLevel; gaps between them).
        const platformH = 360;
        // Lift the whole ground band up from the bottom toward the middle.
        const groundLift = 260;
        this.platformH = platformH;
        this.platformY = H - platformH / 2 - groundLift;
        this.platformTopY = this.platformY - platformH / 2;

        this.groundGroup = this.physics.add.group();
        this.decorGroup = this.physics.add.group();
        this.hazards = this.physics.add.group();
        this.mushrooms = this.physics.add.group();
        this.stars = this.physics.add.group();
        this.finishGroup = this.physics.add.group();

        // Player
        this.createAnimations();
        this.player = this.add.sprite(W * 0.25, this.platformTopY - 118, 'char_idle');
        this.player.setDisplaySize(250, 250);
        // Render the sheep above the logs (and everything else at ground level).
        this.player.setDepth(5);
        this.playerGroup = this.physics.add.group();
        this.playerGroup.add(this.player);
        // Collision circle over the sheep's body ball; the negative y-offset
        // drops the sprite ~55px so the boots sink into the log top.
        this.player.body.setCircle(130, 20, -61);
        this.player.body.syncBounds = false;

        // Colliders
        this.physics.add.collider(this.playerGroup, this.groundGroup, () => {
            if (this.isPlaying && (this.player.body.touching.down || this.player.body.blocked.down) && !this.player.anims.isPlaying) {
                this.player.play('sheep_run');
            }
        });
        this.physics.add.collider(this.playerGroup, this.mushrooms, this.hitMushroom, null, this);
        this.physics.add.collider(this.playerGroup, this.hazards, this.die, null, this);
        this.physics.add.overlap(this.playerGroup, this.stars, this.collectStar, null, this);

        this.buildLevel();

        // Input (oversized so taps land inside it even in the zoomed-out view)
        const inputZone = this.add.zone(-1200, -1200, W + 2400, H + 2400).setOrigin(0).setInteractive().setDepth(-10);
        inputZone.on('pointerdown', () => this.doJump());

        // Voice level bar to the left of the sheep (shown once the run starts).
        this.createVoiceBar();

        // HUD
        this.createHUD();
        this.createStartButton();

        // The HUD (and pre-start record button) render through their own camera
        // at the original fit zoom so the gameplay zoom-out doesn't shrink them.
        const hudCam = this.cameras.add(0, 0, windowWidth, windowHeight);
        hudCam.setZoom(scaleRatio);
        hudCam.centerOn(W / 2, H / 2);
        this.cameras.main.ignore([this.hudOwner, this.startUI]);
        hudCam.ignore(this.children.list.filter(c => c !== this.hudOwner && c !== this.startUI));
    }

    // Golden PLAY button over the frozen scene. Tapping it starts the run.
    createStartButton() {
        this.startUI = this.add.container(0, 0).setDepth(120);

        // Voice-control hint: white mic icon over pure white instructions.
        const voiceIcon = this.add.image(W / 2, 600, 'ui_voice').setDisplaySize(150, 150);
        this.startUI.add(voiceIcon);
        const hintStyle = { fontFamily: UI_STYLE_CONFIG.typography.fontStack, color: '#ffffff', fontStyle: 'bold', align: 'center', lineSpacing: 12 };
        const hint = this.add.text(W / 2, 790, "Shout to control the lamb to jump\nand run to the finish line.", { ...hintStyle, fontSize: '46px' }).setOrigin(0.5);
        this.startUI.add(hint);
        const btn = createImageButton(this, W / 2, H - 360, 'ui_play', 180, () => this.startRun());
        // Start on the initial press too — snappier than waiting for release.
        btn.on('pointerdown', () => this.startRun());
        this.startUI.add(btn);
        this.tweens.add({ targets: btn, scale: btn.scaleX * 1.06, duration: 700, yoyo: true, repeat: -1, ease: 'Sine.easeInOut' });
    }

    startRun() {
        if (this.isPlaying) return;
        this.startUI.destroy();
        this.isPlaying = true;
        this.player.play('sheep_run');
        this.initVoiceControl();
        if (this.voiceBar) this.voiceBar.setVisible(true);
        // Quieter music bed so the star-collect chime pops.
        this.bgm = playAudio('assets/bgm_main.mp3', { loop: true, volume: 0.32 });
    }

    doJump() {
        if (this.isPlaying && (this.player.body.touching.down || this.player.body.blocked.down)) {
            this.player.body.setVelocityY(this.jumpVelocity);
            this.player.anims.stop();
            this.player.setTexture('char_jump1');
            playAudio('assets/sfx_jump.mp3');
        }
    }

    // Microphone loudness drives jumps: shout past the threshold to hop.
    // Started from the PLAY tap (a user gesture) so mic permission can prompt.
    initVoiceControl() {
        try {
            if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) return;
            navigator.mediaDevices.getUserMedia({ audio: true }).then((stream) => {
                const AC = window.AudioContext || window.webkitAudioContext;
                this.audioCtx = new AC();
                const src = this.audioCtx.createMediaStreamSource(stream);
                this.analyser = this.audioCtx.createAnalyser();
                this.analyser.fftSize = 512;
                src.connect(this.analyser);
                this.voiceData = new Uint8Array(this.analyser.fftSize);
                this.micStream = stream;
                // Release the mic when the scene restarts.
                this.events.once('shutdown', () => {
                    try { if (this.micStream) this.micStream.getTracks().forEach(t => t.stop()); } catch (e) {}
                    try { if (this.audioCtx) this.audioCtx.close(); } catch (e) {}
                });
            }).catch(() => {});
        } catch (e) {}
    }

    // Vertical loudness meter beside the sheep with a threshold tick: fill
    // passes the tick -> jump fires.
    createVoiceBar() {
        const x = 120;
        const barH = 330;
        const bottom = this.platformTopY - 30;
        this.voiceBar = this.add.container(0, 0).setDepth(90).setVisible(false);
        const bg = this.add.rectangle(x, bottom - barH / 2, 30, barH, 0x000000, 0.35);
        bg.setStrokeStyle(4, 0xffffff, 0.85);
        this.voiceBar.add(bg);
        this.voiceFill = this.add.rectangle(x, bottom - 4, 20, barH - 8, 0x6fe05a, 0.95).setOrigin(0.5, 1);
        this.voiceFill.setScale(1, 0);
        this.voiceBar.add(this.voiceFill);
        // Drawn a touch higher than the exact trigger point so it reads better.
        const tickY = bottom - barH * (this.voiceThreshold / this.voiceMax) - 45;
        const tick = this.add.rectangle(x, tickY, 46, 6, 0xffffff, 0.95);
        this.voiceBar.add(tick);
    }

    // ---- Level construction ------------------------------------------------
    // worldX 0 sits at the player; everything spawns at player.x + worldX and
    // scrolls left. The whole course exists up-front, so relative spacing
    // (ground seams, gap widths, star arcs) stays exact at any speed.

    buildLevel() {
        const L = this.levelLength;

        // ---- Terrain: alternating low/high log sections --------------------
        // A couple of raised sections; each is entered by bouncing off a
        // launcher mushroom placed just before its leading edge, and exited by
        // dropping off its far end back to the low logs.
        const sections = [];
        const highSpots = [];
        let hx = Phaser.Math.Between(5500, 7500);
        while (highSpots.length < 2 && hx < L - 6000) {
            const len = Phaser.Math.Between(2200, 3200);
            highSpots.push({ start: hx, end: hx + len });
            hx = hx + len + Phaser.Math.Between(3800, 5200);
        }
        let cursor = -this.player.x - 120;
        for (const h of highSpots) {
            sections.push({ level: 0, start: cursor, end: h.start });
            sections.push({ level: 1, start: h.start, end: h.end });
            cursor = h.end;
        }
        // The final log runs on past the finish rock (which overlaps it in the
        // foreground) so the sheep can exit right off the screen.
        sections.push({ level: 0, start: cursor, end: L + 1850 });
        this.sections = sections;

        // ---- Log chain: EVERY log is a separate platform — after each log
        // comes either a gap (jump) or a dip (the next log sits ~70px lower,
        // nearly touching). Rising back up always happens across a gap jump.
        const DIP = 70;
        // Trunk lengths follow the ground band height so the log art keeps its
        // native aspect (1840x400 / 878x400).
        const LOG_LONG = Math.round(1840 * (this.platformH / 400));
        const LOG_SHORT = Math.round(878 * (this.platformH / 400));
        this.logs = [];
        const transitions = [];
        for (let si = 0; si < sections.length; si++) {
            const sec = sections[si];
            const nextIsHigh = sections[si + 1] && sections[si + 1].level === 1;
            const isLast = si === sections.length - 1;
            const baseTop = this.platformTopY - (sec.level ? this.levelDiff : 0);
            let cx = sec.start;
            let elev = 0;
            let first = true;
            while (cx < sec.end - 40) {
                const remaining = sec.end - cx;
                let logW;
                if (nextIsHigh && remaining <= 1900) logW = remaining; // solid run-up to the launcher
                else if (isLast && remaining <= 2400) logW = remaining; // solid straight run to the finish rock
                else if (remaining <= 1500) logW = remaining;
                else {
                    logW = (first || Math.random() < 0.85) ? LOG_LONG : LOG_SHORT;
                    if (remaining - logW < 500) logW = remaining;
                }
                this.logs.push({ a: cx, b: cx + logW, top: baseTop + elev * DIP });
                cx += logW;
                first = false;
                if (cx >= sec.end - 40) break;

                const progress = cx / L;
                // No gaps where they must not exist: the frozen-world finish
                // run, and the run-up to a launcher mushroom before a high
                // section — logs there may only dip or sit end to end.
                const noGapZone = (isLast && cx > L - 2600) || (nextIsHigh && cx > sec.end - 2100);
                if (elev === 1) {
                    if (noGapZone) {
                        // Stay low, next log adjacent (tiny seam, no jump).
                        cx += Phaser.Math.Between(30, 70);
                        continue;
                    }
                    // Climb back up across a gap jump.
                    const w = 260 + 170 * progress;
                    transitions.push({ x: cx + w / 2 });
                    cx += w;
                    elev = 0;
                } else if (cx < 2000 || cx > L - 1600 || noGapZone || Math.random() < 0.58) {
                    // Dip: next log sits lower, ends nearly touching. (Forced in
                    // the starting and home stretches so those stay runnable.)
                    cx += Phaser.Math.Between(30, 70);
                    elev = 1;
                } else {
                    const w = 260 + 170 * progress;
                    transitions.push({ x: cx + w / 2 });
                    cx += w;
                    elev = 0;
                }
            }
        }
        this.levelTransitions = transitions;
        for (const lg of this.logs) this.spawnLog(lg);

        // Launcher mushrooms + keep-out zones around each transition (launch
        // arc going up, drop landing coming down) that stay free of features.
        const keepOut = [];
        for (const h of highSpots) {
            this.spawnMushroom(h.start - 380);
            keepOut.push({ a: h.start - 1500, b: h.start + 1200 });
            keepOut.push({ a: h.end - 200, b: h.end + 550 });
        }
        const inKeepOut = (px) => keepOut.some(z => px > z.a && px < z.b);
        // Launcher mushrooms count toward mushroom spacing too.
        const launcherXs = highSpots.map(h => h.start - 380);
        const clearOfMushrooms = (px) => launcherXs.every(lx => Math.abs(lx - px) >= 2600);

        // ---- Features: placed per log, away from its ends (gap/dip landings).
        const AFTER_SPACE = { rock: [750, 1250], mushroom: [1550, 1900], mover: [900, 1250] };
        const feats = [];
        let lastMushroomX = -99999;
        let moverTally = 0;
        // A log entered via a downhill drop (dip) hides what's below until the
        // sheep is already falling — beetles need extra distance there.
        const moverLeftMargin = (lg) => {
            const idx = this.logs.indexOf(lg);
            const prev = idx > 0 ? this.logs[idx - 1] : null;
            const dipEntry = prev && lg.a - prev.b < 90 && lg.top !== prev.top;
            return dipEntry ? 1050 : 600;
        };
        for (const lg of this.logs) {
            let x = Math.max(lg.a + 450, 1600);
            while (x < lg.b - 500) {
                // Keep the finish approach clear: once the rock locks on screen
                // the world freezes and the sheep runs this whole stretch, so
                // no obstacle may exist anywhere in it.
                if (x > L - 2600) break;
                const z = keepOut.find(z => x > z.a && x < z.b);
                if (z) { x = z.b + 100; continue; }
                const sec = sections.find(s => x >= s.start && x < s.end);
                const r = Math.random();
                let type = r < 0.35 ? 'rock' : (r < 0.75 ? 'mushroom' : 'mover');
                if (type === 'mover' && moverTally >= 3) type = 'rock';
                // No bounce mushrooms on the upper logs (arcs leave the screen).
                if (sec && sec.level === 1 && type === 'mushroom') type = 'rock';
                // Mushrooms only on big logs, well away from the log's left end,
                // with spacing between them and solid ground around the spot the
                // launch arc actually lands (dip seams are fine, gaps are not).
                if (type === 'mushroom') {
                    const mx = Math.max(x, lg.a + 850);
                    const D = this.launchFlightDistance();
                    if ((lg.b - lg.a) < 1300 || mx > lg.b - 400 || mx - lastMushroomX < 2600 || !clearOfMushrooms(mx) || inKeepOut(mx) || !this.isSolidStretch(mx + D - 300, mx + D + 300)) {
                        type = 'rock';
                    } else {
                        x = mx;
                    }
                }
                // Movers stay out of the log-edge landing zones: shift them into
                // the valid window, or fall back to a rock if none exists.
                if (type === 'mover') {
                    const mx = Math.max(x, lg.a + moverLeftMargin(lg));
                    if (mx <= lg.b - 300 && !inKeepOut(mx)) x = mx;
                    else type = 'rock';
                }
                feats.push({ type, x, w: 0, log: lg });
                if (type === 'mushroom') lastMushroomX = x;
                if (type === 'mover') moverTally++;
                x += Phaser.Math.Between(AFTER_SPACE[type][0], AFTER_SPACE[type][1]);
            }
        }
        // Guarantee some beetles: if the random mix produced fewer than 2,
        // convert eligible rocks (inside mover windows, past the opening).
        let moverCount = feats.filter(f => f.type === 'mover').length;
        for (const f of feats) {
            if (moverCount >= 2) break;
            if (f.type !== 'rock' || f.x < 3000) continue;
            const mx = Math.max(f.x, f.log.a + moverLeftMargin(f.log));
            if (mx <= f.log.b - 300) {
                f.type = 'mover';
                f.x = mx;
                moverCount++;
            }
        }

        // Guarantee a couple of regular bounce mushrooms (launchers aside):
        // search ALL logs for spots satisfying the big-log / left-end-distance /
        // safe-landing rules and insert them as new features.
        let mushCount = feats.filter(f => f.type === 'mushroom').length;
        if (mushCount < 2) {
            const D = this.launchFlightDistance();
            for (const lg of this.logs) {
                if (mushCount >= 2) break;
                if (lg.b - lg.a < 1300) continue;
                // Scan candidate spots along the log for one with a safe landing.
                for (let mx = lg.a + 850; mx <= lg.b - 400; mx += 150) {
                    if (mx < 2600 || mx > L - 2600 || inKeepOut(mx) || !clearOfMushrooms(mx)) continue;
                    const sec = sections.find(s => mx >= s.start && s.end > mx);
                    if (sec && sec.level === 1) continue;
                    if (!this.isSolidStretch(mx + D - 300, mx + D + 300)) continue;
                    if (!feats.every(o => o.type !== 'mushroom' || Math.abs(o.x - mx) >= 2600)) continue;
                    if (!feats.every(o => o.log !== lg || Math.abs(o.x - mx) >= 750)) continue;
                    feats.push({ type: 'mushroom', x: mx, w: 0, log: lg });
                    mushCount++;
                    break;
                }
            }
            feats.sort((p, q) => p.x - q.x);
        }

        // Drop the very first rock so the run starts with breathing room.
        const firstRock = feats.findIndex(f => f.type === 'rock');
        if (firstRock !== -1) feats.splice(firstRock, 1);

        // No obstacle where a mushroom bounce comes down: clear rocks/beetles
        // around every launch landing point (high-log launchers included).
        const LD = this.launchFlightDistance();
        const landings = feats.filter(f => f.type === 'mushroom').map(f => f.x + LD);
        for (const h of highSpots) landings.push(h.start - 380 + LD);
        for (let i = feats.length - 1; i >= 0; i--) {
            const f = feats[i];
            if (f.type !== 'rock' && f.type !== 'mover') continue;
            // Beetles creep left after activating, so they get extra margin.
            const extra = f.type === 'mover' ? 300 : 0;
            if (landings.some(lx => f.x > lx - 480 && f.x < lx + 520 + extra)) {
                feats.splice(i, 1);
            }
        }
        this.levelFeatures = feats;

        for (const f of feats) {
            if (f.type === 'rock') this.spawnRock(f.x);
            else if (f.type === 'mushroom') this.spawnMushroom(f.x);
            else if (f.type === 'mover') this.spawnMover(f.x);
        }

        // EXACTLY starGoal (30) stars in the whole course — winning means
        // collecting them all. Spend the budget by priority: launcher trails up
        // to the high logs (5 each), regular mushroom trails (5 each), gap arcs
        // (3 each), drop-edge trails (2 each), rock toppers (1 each), then
        // ground rows in clean stretches for whatever remains.
        let budget = this.starGoal;
        for (const h of highSpots) {
            if (budget >= 3) budget -= this.spawnLaunchArcStars(h.start - 380);
        }
        for (const f of feats) {
            if (f.type === 'mushroom' && budget >= 3) {
                budget -= this.spawnLaunchArcStars(f.x);
            }
        }
        // Gaps already flown over by a mushroom launch trail don't get their
        // own arc — two overlapping star arcs in the same airspace read wrong.
        const trailZones = [];
        for (const h of highSpots) trailZones.push([h.start - 380, h.start + 1400]);
        for (const f of feats) {
            if (f.type === 'mushroom') trailZones.push([f.x, f.x + 1600]);
        }
        for (const t of transitions) {
            if (trailZones.some(z => t.x > z[0] && t.x < z[1])) continue;
            if (budget >= 3) budget -= this.spawnGapArcStars(t.x);
        }
        for (const h of highSpots) {
            if (budget >= 2) budget -= this.spawnDropStars(h.end);
        }
        for (const f of feats) {
            if (f.type === 'rock' && budget >= 1) {
                this.spawnStar(f.x, this.groundTopAt(f.x) - 310);
                budget -= 1;
            }
        }

        // Ground-level star rows in quiet log interiors: away from log ends
        // (landing zones) and past each feature's airborne zone.
        const LANDING_CLEAR = { mushroom: 1350, rock: 450, mover: 350 };
        const stretches = [];
        for (const lg of this.logs) {
            const blocks = feats.filter(f => f.log === lg).map(f => [f.x - 300, f.x + LANDING_CLEAR[f.type]]);
            blocks.sort((p, q) => p[0] - q[0]);
            let s = lg.a + 380;
            const spans = [];
            for (const [ba, bb] of blocks) {
                if (ba - s > 400) spans.push([s, ba]);
                s = Math.max(s, bb);
            }
            if (lg.b - 380 - s > 400) spans.push([s, lg.b - 380]);
            for (const [sa, sb] of spans) {
                const mid = (sa + sb) / 2;
                if (mid < L - 900 && !inKeepOut(mid - 150) && !inKeepOut(mid + 150)) stretches.push(mid);
            }
        }
        Phaser.Utils.Array.Shuffle(stretches);
        for (const mid of stretches) {
            if (budget <= 0) break;
            const n = Math.min(3, budget);
            for (let i = 0; i < n; i++) {
                this.spawnStar(mid + (i - (n - 1) / 2) * 100, this.groundTopAt(mid) - 150);
            }
            budget -= n;
        }
        // Last-resort fill (rare): jump-height singles over the same stretches.
        for (const mid of stretches) {
            if (budget <= 0) break;
            this.spawnStar(mid, this.groundTopAt(mid) - 310);
            budget -= 1;
        }
        // Absolute fallback: line the home stretch before the finish.
        for (let fx = L - 900; budget > 0 && fx > L - 4200; fx -= 300) {
            if (inKeepOut(fx)) continue;
            this.spawnStar(fx, this.groundTopAt(fx) - 150);
            budget -= 1;
        }
        this.totalStars = this.starGoal - budget;

        this.spawnFinish(L);
        this.spawnForegroundDecor();
    }

    // Pre-composed foreground band (sand rocks + plants) at the bottom edge,
    // repeated every so often with breathing room in between — no flipping.
    spawnForegroundDecor() {
        const stripW = 1500;
        const stripH = stripW * (525 / 2380);
        let x = -this.player.x;
        const endX = this.levelLength + 2600;
        while (x < endX) {
            const img = this.add.image(this.player.x + x + stripW / 2, this.bgBottomY + 30, 'fg_strip');
            img.setOrigin(0.5, 1).setDepth(70);
            img.setDisplaySize(stripW, stripH);
            this.decorGroup.add(img);
            img.body.setAllowGravity(false);
            img.body.setImmovable(true);
            this.worldSprites.push(img);
            x += stripW + Phaser.Math.Between(1100, 1900);
        }
    }

    // True when [a, b] is continuously walkable ground: only tiny dip seams
    // (< 90px) between logs, no real gaps.
    isSolidStretch(a, b) {
        if (!this.logs) return false;
        let covered = a;
        for (const lg of this.logs) {
            if (lg.b <= covered) continue;
            if (lg.a > covered + 90) return false;
            covered = Math.max(covered, lg.b);
            if (covered >= b) return true;
        }
        return covered >= b;
    }

    // Top surface (world y) of the log at course position x; inside a gap this
    // returns the log to the left (the jump's takeoff height).
    groundTopAt(x) {
        if (!this.logs || this.logs.length === 0) return this.platformTopY;
        let last = null;
        for (const lg of this.logs) {
            if (x < lg.a) break;
            last = lg;
            if (x < lg.b) return lg.top;
        }
        return last ? last.top : this.platformTopY;
    }

    // Two small stars along the fall parabola off a high section's far edge.
    spawnDropStars(edgeX) {
        const { speed, boost } = this.estimateStateAt(edgeX);
        const g = this.baseGravity * boost * boost;
        const startY = this.groundTopAt(edgeX - 60) - 118;
        let n = 0;
        for (const t of [0.16, 0.3]) {
            this.spawnStar(edgeX + 80 + speed * t, startY + 0.5 * g * t * t);
            n++;
        }
        return n;
    }

    // Stars laid along the jump parabola over a gap, apex centred on the gap —
    // jumping the gap cleanly threads the whole arc.
    spawnGapArcStars(centerX) {
        const { speed, boost } = this.estimateStateAt(centerX);
        const v = Math.abs(this.baseJump) * boost * this.jumpScale;
        const g = this.baseGravity * boost * boost;
        // Player centre at the apex of a normal jump from the ground.
        const apexY = this.groundTopAt(centerX) - 118 - (v * v) / (2 * g);
        let n = 0;
        for (const k of [-0.55, 0, 0.55]) {
            const t = k * (v / g);
            // The apex of the parabola gets the big star.
            this.spawnStar(centerX + speed * t, apexY + 0.5 * g * t * t, k === 0);
            n++;
        }
        return n;
    }

    // Horizontal distance a mushroom bounce carries the player before its feet
    // return to ground level (launch from the cap, fall past it to the log).
    launchFlightDistance() {
        const { speed, boost } = this.estimateStateAt(0);
        const v = Math.abs(this.baseJump) * boost * this.launchBoost * this.jumpScale;
        const g = this.baseGravity * boost * boost;
        const tUp = v / g;
        const tDown = Math.sqrt(2 * ((v * v) / (2 * g) + 113) / g);
        return speed * (tUp + tDown);
    }

    // Stars laid along the projectile arc the player follows after bouncing off
    // the mushroom at this course position (speed/gravity estimated for arrival).
    spawnLaunchArcStars(worldX) {
        const { speed, boost } = this.estimateStateAt(worldX);
        const v = Math.abs(this.baseJump) * boost * this.launchBoost * this.jumpScale;
        const g = this.baseGravity * boost * boost;
        const apexT = v / g;
        // Player centre while standing on the cap (mushroom top is ~113 above ground).
        const startY = this.groundTopAt(worldX) - 113 - 118;
        let n = 0;
        for (const k of [0.5, 1.0, 1.5]) {
            const t = apexT * k;
            // The apex of the parabola gets the big star.
            this.spawnStar(worldX + speed * t, startY - (v * t - 0.5 * g * t * t), k === 1.0);
            n++;
        }
        return n;
    }

    // Speed/difficulty the player carries at any point in the course — constant
    // now that update() uses a fixed cruise speed (keep in sync with update()).
    estimateStateAt(worldX) {
        return {
            speed: (this.baseSpeed + (this.maxSpeed - this.baseSpeed) * 0.25) * 0.9,
            boost: 1.5 + 0.25 * 0.6
        };
    }

    // One log = one collision slab + ONE whole trunk image. Logs never share
    // artwork, so every log reads as its own separate piece.
    spawnLog(lg) {
        const w = lg.b - lg.a;
        const cx = this.player.x + (lg.a + lg.b) / 2;
        const segY = lg.top + this.platformH / 2;
        const seg = this.add.rectangle(cx, segY, w, this.platformH);
        this.groundGroup.add(seg);
        seg.body.setAllowGravity(false);
        seg.body.setImmovable(true);
        this.worldSprites.push(seg);

        const img = this.add.image(cx, segY, w < 1000 ? 'trunk_short' : 'trunk_long');
        img.setDisplaySize(w, this.platformH);
        this.addGroundLog(img);
        return seg;
    }

    addGroundLog(img) {
        this.decorGroup.add(img);
        img.body.setAllowGravity(false);
        img.body.setImmovable(true);
        this.worldSprites.push(img);
    }

    spawnRock(worldX) {
        const top = this.groundTopAt(worldX);
        const rock = this.add.image(this.player.x + worldX, top, 'rock');
        adjustDisplaySize(rock, 200, 0, true);
        // Rest the rock on the ground, nudged down so it sits into the log.
        rock.y = top - rock.displayHeight / 2 + 102;
        this.hazards.add(rock);
        rock.body.setAllowGravity(false);
        rock.body.setImmovable(true);
        // Round rock: circle body inset from the 300px frame.
        rock.body.setCircle(140, 10, 15);
        this.worldSprites.push(rock);
        return rock;
    }

    spawnMushroom(worldX) {
        const m = this.add.image(this.player.x + worldX, this.groundTopAt(worldX) - 215 / 2 + 102, 'mushroom');
        // Native 210x215 size, sunk slightly into the log.
        m.setDisplaySize(210, 215);
        this.mushrooms.add(m);
        m.body.setAllowGravity(false);
        m.body.setImmovable(true);
        this.worldSprites.push(m);
        return m;
    }

    spawnMover(worldX) {
        const m = this.add.image(this.player.x + worldX, 0, 'beetle');
        // Native 212x175, keeps aspect.
        m.setDisplaySize(200, 165);
        m.y = this.groundTopAt(worldX) - m.displayHeight / 2 + 103;
        m.setData('mover', true);
        this.hazards.add(m);
        m.body.setAllowGravity(false);
        m.body.setImmovable(true);
        // Circle over the beetle's round body; the horn tip stays forgiving.
        m.body.setCircle(75, 55, 25);
        this.worldSprites.push(m);
        return m;
    }

    spawnStar(worldX, y, big) {
        const s = this.add.image(this.player.x + worldX, y, big ? 'star_big' : 'star_small');
        s.setDisplaySize(big ? 120 : 84, big ? 120 : 84);
        this.stars.add(s);
        s.body.setAllowGravity(false);
        s.body.setImmovable(true);
        if (big) s.body.setCircle(60, 12, 12);
        else s.body.setCircle(34, 6, 6);
        this.worldSprites.push(s);
        return s;
    }

    spawnFinish(worldX) {
        // Big FINAL rock filling the bottom-right corner — pure foreground
        // decoration now: the final log continues behind it and the sheep runs
        // right through (behind) the rock and off the screen.
        const anchor = worldX + 650;
        const top = this.groundTopAt(anchor);
        const dispH = 1200;
        const scale = dispH / 984;
        const dispW = 872 * scale;
        // Overhang past the screen's right edge at lock, so the art's uneven
        // silhouette can never show a gap against the edge.
        this.finishOverhang = 160;
        const cx = anchor + dispW / 2 - 320 * scale + 30;
        // Bottom anchored to the visible bottom edge — together with the
        // right-edge overhang at lock, the rock sits tight in the corner.
        const f = this.add.image(this.player.x + cx, this.bgBottomY + 30, 'finish').setOrigin(0.5, 1);
        f.displayHeight = dispH;
        f.scaleX = f.scaleY;
        f.setDepth(75);
        this.finishGroup.add(f);
        // Body only so it scrolls with the world — nothing collides with it.
        f.body.setAllowGravity(false);
        f.body.setImmovable(true);
        this.worldSprites.push(f);
        return f;
    }

    // ---- HUD ---------------------------------------------------------------

    createHUD() {
        this.hudOwner = this.add.container(0, 0).setDepth(100);
        this.hudOwner.setScrollFactor(0);

        const capY = 140;
        const capH = 120;

        // Course progress capsule (left): cream frame, green fill drawn inside,
        // sheep-head marker riding at the progress position.
        const pScale = capH / 128;
        // Left padding matches the star capsule's right padding (50); the sheep
        // head marker is clamped in setProgress so it never leaves the screen.
        const pCapX = 50;
        const pCap = this.add.image(pCapX, capY, 'ui_progress').setOrigin(0, 0.5).setScale(pScale);
        this.hudOwner.add(pCap);

        // Fill track textures generated once: flat gray track, and a green fill
        // with a vertical gradient + diagonal stripes (canvas texture, matching
        // the mockup).
        if (!this.textures.exists('hud_track')) {
            const g = this.make.graphics({ add: false });
            g.fillStyle(0xcfcbc4, 1);
            g.fillRoundedRect(0, 0, 375, 90, 45);
            g.generateTexture('hud_track', 375, 90);
            g.destroy();

            const cw = 375, ch = 90, r = 45;
            const ct = this.textures.createCanvas('hud_fill', cw, ch);
            const ctx = ct.context;
            ctx.beginPath();
            ctx.moveTo(r, 0);
            ctx.lineTo(cw - r, 0);
            ctx.arc(cw - r, r, r, -Math.PI / 2, Math.PI / 2);
            ctx.lineTo(r, ch);
            ctx.arc(r, r, r, Math.PI / 2, -Math.PI / 2);
            ctx.closePath();
            ctx.clip();
            const grad = ctx.createLinearGradient(0, 0, 0, ch);
            grad.addColorStop(0, '#8ADE62');
            grad.addColorStop(1, '#2FA33B');
            ctx.fillStyle = grad;
            ctx.fillRect(0, 0, cw, ch);
            ctx.fillStyle = 'rgba(23, 102, 38, 0.25)';
            for (let sx = -60; sx < cw + 60; sx += 64) {
                ctx.beginPath();
                ctx.moveTo(sx, 0);
                ctx.lineTo(sx + 30, 0);
                ctx.lineTo(sx + 30 - 34, ch);
                ctx.lineTo(sx - 34, ch);
                ctx.closePath();
                ctx.fill();
            }
            ct.refresh();
        }
        // The capsule art carries a baked-in drop shadow at its bottom, so the
        // visible interior sits slightly above the frame centre — lift the bar
        // a few pixels to keep the green fill vertically centred in it.
        const barY = capY - 6;
        this.trackX = pCapX + 18 * pScale;
        this.trackW = (406 - 36) * pScale;
        const trackH = (128 - 34) * pScale;
        const track = this.add.image(this.trackX, barY, 'hud_track').setOrigin(0, 0.5).setDisplaySize(this.trackW, trackH);
        this.hudOwner.add(track);
        this.progressFillImg = this.add.image(this.trackX, barY, 'hud_fill').setOrigin(0, 0.5).setDisplaySize(this.trackW, trackH);
        this.progressFillImg.setCrop(0, 0, 8, 90);
        this.hudOwner.add(this.progressFillImg);

        this.sheepHead = this.add.image(this.trackX, barY, 'ui_sheep_head');
        this.sheepHead.setDisplaySize(capH * 1.9, capH * 1.9);
        this.hudOwner.add(this.sheepHead);
        this.setProgress(0);

        // Star counter capsule (right): star art on the left, count text beside it.
        const sScale = capH / 128;
        const sCapW = 314 * sScale;
        const sCap = this.add.image(W - 50, capY, 'ui_stars').setOrigin(1, 0.5).setScale(sScale);
        this.hudOwner.add(sCap);

        const valueStyle = { fontFamily: UI_STYLE_CONFIG.typography.fontStack, color: '#7A4A1E', fontStyle: 'bold', align: 'center' };
        // Centred in the text area to the right of the star icon.
        this.starsValue = this.add.text(W - 56 - sCapW * 0.33, capY, `0/${this.starGoal}`, { ...valueStyle, fontSize: '54px' }).setOrigin(0.5);
        this.hudOwner.add(this.starsValue);
    }

    updateHUD() {
        this.starsValue.setText(`${this.starsCollected}/${this.starGoal}`);
        if (this.starsCollected >= this.starGoal) {
            this.starsValue.setColor('#2FA33B');
        }
    }

    setProgress(p) {
        this.progressFillImg.setCrop(0, 0, Math.max(8, 375 * p), 90);
        // Lower clamp keeps the oversized head fully on screen at 0% progress.
        this.sheepHead.x = this.trackX + this.trackW * Phaser.Math.Clamp(p, 0.16, 0.98);
    }

    // ---- Gameplay events ---------------------------------------------------

    collectStar(player, star) {
        if (!this.isPlaying) return;
        star.destroy();
        this.starsCollected += 1;
        playAudio('assets/sfx_score.mp3');
        this.updateHUD();
    }

    hitMushroom(player, mush) {
        if (!this.isPlaying) return;
        // The cap is a launchpad: landing on top flings the player high into the
        // air (toward any star trail); a frontal/side hit still kills.
        if (player.body.touching.down && mush.body.touching.up) {
            player.body.setVelocityY(this.jumpVelocity * this.launchBoost);
            player.anims.stop();
            player.setTexture('char_jump1');
            playAudio('assets/sfx_jump.mp3');
            // Squash-and-stretch so the cap visibly springs under the sheep.
            this.tweens.add({
                targets: mush,
                scaleY: mush.scaleY * 0.7,
                scaleX: mush.scaleX * 1.2,
                duration: 90,
                yoyo: true,
                ease: 'Quad.easeOut'
            });
        } else {
            this.die();
        }
    }

    reachFinish() {
        if (!this.isPlaying || this.levelDone) return;
        this.levelDone = true;
        this.stopWorld('assets/sfx_score.mp3');
        // Course complete: fill the bar.
        this.setProgress(1);
        // The end scene stays exactly as it is (sheep at the rock, logs, sign);
        // just pop the collected star count over it.
        this.time.delayedCall(400, () => this.showFinishOverlay(), [], this);
    }

    // Shared end overlay (win and game over) over the live scene: cream back
    // panel, three-star rating across its top, title, count, and RETRY.
    showFinishOverlay(gameOver) {
        const ui = this.add.container(W / 2, 810).setDepth(130);
        const panel = this.add.image(0, 0, 'ui_panel');
        panel.setDisplaySize(840, 619);
        ui.add(panel);

        // Star rating overlapping the panel's top edge; earned ones are golden.
        const ratio = this.starsCollected / this.starGoal;
        const earned = ratio >= 1 ? 3 : (ratio >= 0.6 ? 2 : (ratio >= 0.25 ? 1 : 0));
        const starDefs = [
            { x: -195, y: -285, size: 150 },
            { x: 0, y: -325, size: 195 },
            { x: 195, y: -285, size: 150 }
        ];
        starDefs.forEach((d, i) => {
            const img = this.add.image(d.x, d.y, i < earned ? 'star_on' : 'star_off');
            img.setDisplaySize(d.size, d.size);
            ui.add(img);
        });

        const titleStyle = { fontFamily: UI_STYLE_CONFIG.typography.fontStack, color: '#6B3A18', fontStyle: 'bold', align: 'center' };
        const title = this.add.text(0, -115, gameOver ? 'GAME OVER' : 'YOU WIN', { ...titleStyle, fontSize: '66px' }).setOrigin(0.5);
        if (title.setLetterSpacing) title.setLetterSpacing(10);
        ui.add(title);

        const countStyle = { fontFamily: UI_STYLE_CONFIG.typography.fontStack, color: '#6B3A18', stroke: '#FFF3DF', strokeThickness: 10, fontStyle: 'bold', align: 'center' };
        const count = this.add.text(0, 5, `${this.starsCollected}/${this.starGoal}`, { ...countStyle, fontSize: '104px' }).setOrigin(0.5);
        ui.add(count);

        const againBtn = createImageButton(this, 0, 165, 'ui_retry', 165, () => {
            this.scene.start('GameScene');
        });
        ui.add(againBtn);

        ui.setScale(0.6).setAlpha(0);
        this.tweens.add({ targets: ui, scale: 1, alpha: 1, duration: 350, ease: 'Back.easeOut' });
        // Render through the HUD camera only (main camera would double-draw it
        // small — new objects aren't in its ignore list).
        this.cameras.main.ignore(ui);
    }

    die(fromFall) {
        if (!this.isPlaying) return;
        const fell = fromFall === true;
        this.stopWorld('assets/sfx_hit.mp3', false);

        // Mario-style death: the world freezes, the sheep pops up, tilts over and
        // drops off the bottom of the screen, rendering in front of everything.
        this.player.setDepth(60);
        this.player.anims.stop();
        this.player.setTexture('char_jumpmax');
        this.player.body.checkCollision.none = true;
        if (!fell) {
            this.player.body.setVelocity(0, -2200);
        }
        this.tweens.add({ targets: this.player, angle: fell ? 40 : 150, duration: 900, ease: 'Cubic.easeOut' });

        this.time.delayedCall(fell ? 900 : 1500, () => {
            this.showFinishOverlay('ui_gameover');
        }, [], this);
    }

    stopWorld(sfx, stopPlayer = true) {
        this.isPlaying = false;
        if (this.bgm) this.bgm.stop();
        if (sfx) playAudio(sfx);
        if (stopPlayer) this.player.body.stop();
        this.worldSprites.forEach(s => { if (s.active && s.body) s.body.stop(); });
    }

    update(time, delta) {
        if (!this.isPlaying) return;

        this.timeElapsed += delta;

        // Fixed cruise speed: no ramp — the whole run scrolls a bit below the
        // midpoint of the configured speeds (x0.9 for extra reaction time),
        // jump timing locked to match.
        const difficultyFactor = 0.25;
        this.currentSpeed = (this.baseSpeed + (this.maxSpeed - this.baseSpeed) * difficultyFactor) * 0.9;

        // Snappier jumps: compress air time by `timeBoost` (1.5 base + the fixed
        // difficulty). Scaling jumpVelocity by boost and gravity by boost^2 keeps
        // jump HEIGHT constant while air time shrinks.
        const timeBoost = 1.5 + difficultyFactor * 0.6;
        this.physics.world.gravity.y = this.baseGravity * timeBoost * timeBoost;
        this.jumpVelocity = this.baseJump * timeBoost * this.jumpScale;

        // Voice control: sample mic loudness, drive the meter, jump on shouts.
        if (this.analyser && this.voiceData) {
            this.analyser.getByteTimeDomainData(this.voiceData);
            let sum = 0;
            for (let i = 0; i < this.voiceData.length; i++) {
                const d = (this.voiceData[i] - 128) / 128;
                sum += d * d;
            }
            const rms = Math.sqrt(sum / this.voiceData.length);
            // Fast attack, slow decay so the meter reads naturally.
            this.voiceLevel = Math.max(rms, this.voiceLevel * 0.88);
            const frac = Phaser.Math.Clamp(this.voiceLevel / this.voiceMax, 0, 1);
            this.voiceFill.setScale(1, frac);
            this.voiceFill.fillColor = rms > this.voiceThreshold ? 0xffd83d : 0x6fe05a;
            if (rms > this.voiceThreshold) {
                this.doJump();
            }
        }

        // Air pose: the tucked "jumpmax" frame near the arc's peak, dangling
        // legs otherwise; the run cycle resumes via the ground collider.
        if (!(this.player.body.touching.down || this.player.body.blocked.down)) {
            const key = Math.abs(this.player.body.velocity.y) < 550 ? 'char_jumpmax' : 'char_jump1';
            if (this.player.texture.key !== key) {
                this.player.anims.stop();
                this.player.setTexture(key);
            }
        }

        // Scroll the whole course; movers get extra speed once on screen so they
        // charge at the player instead of drifting through the level layout.
        // Once the finish is locked on screen the world holds still instead.
        for (const s of this.worldSprites) {
            if (!s.active) continue;
            let v = this.finishLocked ? 0 : -this.currentSpeed;
            if (!this.finishLocked && s.getData('mover') && s.x < this.viewRightX + 80) v -= this.moverExtraSpeed;
            s.body.setVelocityX(v);
            if (s.x + s.displayWidth / 2 < -400) {
                s.destroy();
            }
        }

        // Parallax: background hills drift much slower than the foreground,
        // tiles recycle to the right end as they leave the view (flip pattern
        // holds because the tile count is even).
        const bgDx = (this.finishLocked ? 0 : this.currentSpeed * 0.18) * (delta / 1000);
        for (const t of this.bgTiles) {
            t.x -= bgDx;
            if (t.x + this.bgTileW < this.camLeftX - 20) {
                t.x += this.bgTileW * this.bgTiles.length;
            }
        }

        // Fell into a gap.
        if (this.player.y > H + 150) {
            this.die(true);
            return;
        }
        // Shoved off the left edge (e.g. by the finish rock or an obstacle).
        if (this.player.x < this.camLeftX - 150) {
            this.die(true);
            return;
        }

        // Progress = how much of the course has scrolled past, measured off the
        // finish rock so the bar and the rock always agree.
        const finish = this.finishGroup.getChildren()[0];
        if (finish && finish.active) {
            // Anchor the finish at the right edge: the moment its rock is fully
            // on screen, stop the world — the sheep runs the final stretch.
            const finishRight = finish.x + finish.displayWidth / 2 - (this.finishOverhang || 0);
            if (!this.finishLocked && finishRight <= this.viewRightX) {
                this.finishLocked = true;
                // Snap the whole world so the rock overhangs the screen's right
                // edge — no gap possible — and halt it immediately so it
                // doesn't drift another physics step.
                const dx = this.viewRightX - finishRight;
                for (const s of this.worldSprites) {
                    if (!s.active) continue;
                    s.x += dx;
                    if (s.body) s.body.stop();
                }
            }
            const p = Phaser.Math.Clamp(1 - (finish.x - this.player.x) / this.levelLength, 0, 1);
            this.setProgress(p);
        }
        // With the world frozen, the sheep itself runs the final stretch —
        // behind the finish rock and clean off the screen, which ends the run.
        if (this.finishLocked) {
            this.player.body.setVelocityX(this.currentSpeed);
            if (this.player.x > this.viewRightX + 180) {
                this.reachFinish();
            }
        }
    }

    createAnimations() {
        // Walk cycle from the animated webp: frames 1-2-3-2, looping.
        if (!this.anims.exists('sheep_run')) {
            this.anims.create({
                key: 'sheep_run',
                frames: [{ key: 'char_walk1' }, { key: 'char_walk2' }, { key: 'char_walk3' }, { key: 'char_walk2' }],
                frameRate: 10,
                repeat: -1
            });
        }
    }
}

class GameOverScene extends Phaser.Scene {
    constructor() { super('GameOverScene'); }

    init(data) {
        this.stars = data.stars || 0;
        this.goal = data.goal || 15;
    }

    create() {
        const scaleX = windowWidth / W;
        const scaleY = windowHeight / H;
        const scaleRatio = Math.min(scaleX, scaleY);
        this.cameras.main.setZoom(scaleRatio);
        this.cameras.main.centerOn(W / 2, H / 2);

        this.add.zone(0, 0, W, H).setOrigin(0).setInteractive().setDepth(-10);

        // Hills stuck to the bottom; transparent above lets the live camera show through.
        this.bg = this.add.image(W / 2, H + 120, 'bg_hills').setOrigin(0.5, 1).setDepth(-5);
        this.bg.displayHeight = 1560;
        this.bg.scaleX = this.bg.scaleY;

        const dialog = this.add.container(W / 2, H / 2);

        // Death screen only (finishing keeps the game scene up instead).
        const title = this.add.image(0, -600, 'ui_gameover');
        adjustDisplaySize(title, 820, 0, true);
        dialog.add(title);

        // Star icon on top, count beneath — same brown Rubik style as the HUD.
        const icon = this.add.image(0, -300, 'star_big').setDisplaySize(150, 150);
        dialog.add(icon);
        const scoreValueStyle = { fontFamily: UI_STYLE_CONFIG.typography.fontStack, color: '#7A4A1E', stroke: '#ffffff', strokeThickness: 10, fontStyle: 'bold', align: 'center' };
        const scoreValue = this.add.text(0, -165, `${this.stars}/${this.goal}`, { ...scoreValueStyle, fontSize: '88px' }).setOrigin(0.5);
        dialog.add(scoreValue);

        const againBtn = createImageButton(this, 0, 240, 'ui_retry', 170, () => {
            this.scene.start('GameScene');
        });
        dialog.add(againBtn);
    }
}

let recordListenerAdded = false;
function addRecordListener(game) {
    if (recordListenerAdded) return;
    recordListenerAdded = true;
    tt.onEffectEvent((res) => {
        const args = JSON.parse(res.args);
        if (args && args.length > 0 && args[0] === 2200 && args[1] === 1) {
            Object.values(audioPool).forEach(a => a.stop());
            const scenes = game.scene.getScenes(true);
            if (scenes.length > 0) {
                scenes[0].scene.start('BootScene');
            }
        }
    });
}

const config = {
    type: Phaser.WEBGL,
    width: windowWidth,
    height: windowHeight,
    transparent: true,
    canvas: window.canvas,
    physics: {
        default: 'arcade',
        arcade: {
            debug: false
        }
    },
    scene: [BootScene, GameScene, GameOverScene],
    input: {
        mouse: true,
        touch: true
    }
};

// Load the bundled UI font via the native runtime so it renders in the effect pack.
// (index.html @font-face only applies in the browser preview.) tt.loadFont returns a
// runtime font id that must be used as the fontFamily; prepend it to the existing stack.
try {
    if (typeof tt !== "undefined" && tt && typeof tt.loadFont === "function") {
        var __uiFontId = tt.loadFont("libs/fonts/Rubik-Bold.ttf");
        if (__uiFontId) UI_STYLE_CONFIG.typography.fontStack = __uiFontId + ", " + UI_STYLE_CONFIG.typography.fontStack;
    }
} catch (e) {}

const game = new Phaser.Game(config);
addRecordListener(game);
