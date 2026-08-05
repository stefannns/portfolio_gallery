require('libs/tt-adapter.js');
const Phaser = require('libs/phaser.js');

// Launch uses a WIDER (landscape) canvas: a left control strip PLUS a native
// portrait gameplay region — same layout as the Movement / Aim super groups.
const res = tt.getSystemInfoSync();
const H  = res.screenHeight;
const GW = res.screenWidth;
const PW = Math.round(res.screenWidth * 0.52);
const GX0 = PW;
const W  = GX0 + GW;
const windowWidth = W, windowHeight = H;
if (typeof window !== 'undefined' && window.canvas && window.canvas.style) {
    window.canvas.width = W; window.canvas.height = H;
    const dh = 640, dw = Math.round(dh * W / H);
    window.canvas.style.width = dw + 'px'; window.canvas.style.height = dh + 'px';
}
const GCX = GX0 + GW/2;

// ─────────────────────────────────────────────────────────────────
// LAUNCH / PHYSICS — SUPER GROUP.  Fling a projectile under gravity at a target.
//   • SLINGSHOT — pull back & release; ballistic arc onto the target.
//   • GOLF      — POINT the angle then press to launch; low bouncy roll.
//   • CANNON I  — aim the barrel, fixed power & no wind; press LAUNCH to fire.
//   • CANNON II — aim the barrel, then time the power METER; wind on.
// Aim modes: DRAG = pull back (launch OPPOSITE the pull, power from pull distance).
//   AIM = point the launch line toward the target (forward), release to fire at the
//   Power setting. In the two CANNON modes you DRAG the field to rotate the barrel
//   (or use the Launch Angle slider) and fire with the LAUNCH button — ANGLE fires at
//   fixed power, METER fires at the current sweeping power bar. Tapping the field only
//   aims, never fires. The cannon modes randomize the target Distance each shot, so you
//   re-judge the angle every time (no trajectory preview). Target sits at Distance (x) ×
//   Target Position (height). Difficulty band = Target Size, from launch error.
// ─────────────────────────────────────────────────────────────────
const CFG = {
    aim: 'drag', targetMove: false, wind: false, bounce: true, compute: true,
};

const LIVE = {
    gravity: 0.55, power: 0.62, targetSize: 0.5, distance: 0.55, targetY: 0.0, launchAngle: 45,
    windStr: 0.40, restitution: 0.45, projSize: 0.030, meterSpeed: 0.50, targetSpeed: 0.32,
};

const PRESETS = {
    'SLINGSHOT': { aim:'drag', targetMove:false, wind:false, bounce:true,
                   live:{ gravity:0.55, power:0.62, distance:0.55, targetY:0.0, restitution:0.40, projSize:0.032 } },
    'GOLF':      { aim:'aim',  targetMove:false, wind:false, bounce:true,
                   live:{ gravity:0.80, power:0.60, distance:0.64, targetY:0.0, restitution:0.62, projSize:0.024 } },
    'CANNON1':   { aim:'angle', targetMove:false, wind:false, bounce:false,
                   live:{ gravity:0.50, power:0.66, distance:0.70, targetY:0.05, launchAngle:45 } },
    'CANNON2':   { aim:'meter', targetMove:false, wind:true, bounce:false,
                   live:{ gravity:0.50, power:0.70, distance:0.72, targetY:0.10, launchAngle:45, windStr:0.28, meterSpeed:0.35 } },
};

const FTOP = H*0.06, FBOT = H*0.80;
const FH   = FBOT - FTOP;
const GROUND_Y = FBOT;
const LAUNCH_X = GX0 + GW*0.14, LAUNCH_Y = GROUND_Y - H*0.01;
const MAX_PULL = GW*0.34;
const GRAV_K = H*1.7;          // gravity px/s² per unit LIVE.gravity

class LiveScene extends Phaser.Scene {
    constructor() { super('LiveScene'); }

    create() {
        this.preset = 'SLINGSHOT';
        this.add.rectangle(W/2, H/2, W, H, 0x0d0e12).setDepth(0);
        this.add.rectangle(GCX, H/2, GW, H, 0x14161d).setDepth(0.3);
        this.sceneGfx = this.add.graphics().setDepth(2);
        this.resultTxt = this.add.text(GCX, FTOP + H*0.02, '', { fontSize: `${GW*0.05}px`, fontStyle: 'bold' }).setOrigin(0.5).setDepth(9);
        this.windTxt = this.add.text(GX0 + GW*0.16, FTOP + H*0.05, '', { fontSize: `${GW*0.026}px`, color: '#ffd27a', fontStyle: 'bold' }).setOrigin(0.5).setDepth(9);

        const zone = this.add.rectangle(GCX, H/2, GW, H, 0x000000, 0).setInteractive().setDepth(1);
        zone.on('pointerdown', (ptr) => this.onDown(ptr));
        this.input.on('pointermove', (ptr) => {
            if (!this.aiming) return;
            if (this.cannon()) this.setAngleFromPointer(ptr); else this.pull = { x: ptr.x, y: ptr.y };
        });
        this.input.on('pointerup', () => {
            if (!this.aiming) return;
            this.aiming = false;
            if (!this.cannon()) this.launchDrag();               // cannon: releasing just stops aiming — fire with the button
        });

        // LAUNCH button, in the ground band — so tapping the field only aims the cannon (shown in cannon modes)
        const lbY = GROUND_Y + (H - GROUND_Y) * 0.40;
        this.launchBtn = this.add.rectangle(GCX, lbY, GW*0.40, H*0.05, 0x2b3350).setStrokeStyle(GW*0.006, 0xd4f24e).setInteractive().setDepth(8);
        this.launchBtnTxt = this.add.text(GCX, lbY, '▲  LAUNCH', { fontSize: `${GW*0.03}px`, color: '#d4f24e', fontStyle: 'bold' }).setOrigin(0.5).setDepth(9);
        this.launchBtn.on('pointerdown', () => this.pressLaunch());

        if (this.input.keyboard) this.input.keyboard.on('keydown-SPACE', () => { if (this.cannon()) this.pressLaunch(); else this.onDown({ x: GCX, y: FMIDishY() }); });

        this.readout = { setText: (t) => { if (typeof window !== 'undefined') window.__genreStats = t; return this.readout; }, setColor: () => this.readout, y: 0 };

        this.panelObjs = [];
        const boot = (typeof window !== 'undefined' && window.__genrePreset && PRESETS[window.__genrePreset]) ? window.__genrePreset : 'SLINGSHOT';
        this.applyPreset(boot);
    }

    reg(o) { this.panelObjs.push(o); return o; }

    resetRun() {
        this.proj = null; this.aiming = false; this.pull = null;
        this.cooldown = 0; this.result = ''; this.resultT = 0; this.landMark = null;
        this.meterT = 0; this.flightT = 0;
        this.shots = 0; this.hits = 0; this.streak = 0;
        this.rseed = 1; this.windAng = 0; this.windMag = LIVE.windStr;
        // Easy↔Hard difficulty band on Target Size
        this.bandEasy = 0.6; this.bandHard = 0.4; this.bandT = 0.5;
        this.derivedOK = true; this.draggingRun = false; this.derived = null;
        this.pickWind();
        this.spawnTarget();
    }

    rnd() { this.rseed = (this.rseed * 1103515245 + 12345) & 0x7fffffff; return this.rseed / 0x7fffffff; }
    moving() { return CFG.targetMove; }
    R() { return GW * 0.13 * LIVE.targetSize; }
    Rmax() { return GW * 0.13; }
    sizeFromR(r) { return Phaser.Math.Clamp(r / (GW * 0.13), 0.3, 1.0); }
    grav() { return LIVE.gravity * GRAV_K; }
    vMax() { return GW * (0.85 + LIVE.power * 0.75); }

    pickWind() { this.windAng = (this.rnd() - 0.5) * 0.6; this.windMag = LIVE.windStr * (0.7 + 0.6*this.rnd()); }

    cannon() { return CFG.aim === 'angle' || CFG.aim === 'meter'; }
    spawnTarget() {
        const R = this.R();
        const df = this.cannon() ? (0.35 + this.rnd() * 0.6) : LIVE.distance;   // cannon: fresh distance to judge each shot
        const tx = LAUNCH_X + GW*0.30 + df * GW*0.52;
        const loX = LAUNCH_X + GW*0.24, hiX = W - R - GW*0.03;
        const x = Phaser.Math.Clamp(tx, loX, hiX);
        const y = GROUND_Y - LIVE.targetY * FH*0.72 - R*0.15;    // Target Position = height above ground
        const vx = this.moving() ? (this.rnd() < 0.5 ? -1 : 1) * GW * LIVE.targetSpeed : 0;
        this.target = { x, y, vx, loX, hiX };
    }

    // ── input ──────────────────────────────────────────────────────
    onDown(ptr) {
        if (this.proj || this.cooldown > 0) return;
        this.aiming = true;
        if (this.cannon()) this.setAngleFromPointer(ptr);       // cannon: drag to aim the barrel; fire via the LAUNCH button
        else this.pull = { x: ptr.x, y: ptr.y };                // drag or aim → aim, release to fire
    }
    setAngleFromPointer(ptr) {                                  // rotate the barrel toward the pointer (up-right quadrant)
        const dx = Math.max(ptr.x - LAUNCH_X, 1), dy = Math.max(LAUNCH_Y - ptr.y, 0);
        LIVE.launchAngle = Math.round(Phaser.Math.Clamp(Math.atan2(dy, dx) * 180/Math.PI, 20, 75));
    }
    pressLaunch() {                                             // the LAUNCH button — fires the cannon
        if (!this.cannon() || this.proj || this.cooldown > 0) return;
        if (CFG.aim === 'meter') this.launchMeter(); else this.launchAngleShot();
    }
    launchAngleShot() {                                          // Cannon I: you pick the angle, power is fixed
        const a = LIVE.launchAngle * Math.PI/180, v = this.vMax();
        this.fire(Math.cos(a)*v, -Math.sin(a)*v);
    }
    aimVec() {
        const p = this.pull || { x: LAUNCH_X + GW*0.2, y: LAUNCH_Y - GW*0.2 };
        if (CFG.aim === 'aim') {                 // golf: point the line TOWARD the target; power from the slider
            const dx = p.x - LAUNCH_X, dy = p.y - LAUNCH_Y, mag = Math.hypot(dx, dy) || 1, v = this.vMax();
            return { vx: dx/mag * v, vy: dy/mag * v };
        }
        // slingshot: pull back → launch OPPOSITE, power from the pull distance
        const dx = LAUNCH_X - p.x, dy = LAUNCH_Y - p.y, mag = Math.hypot(dx, dy) || 1;
        const pull = Math.min(mag, MAX_PULL), v = (pull / MAX_PULL) * this.vMax();
        return { vx: dx/mag * v, vy: dy/mag * v };
    }
    launchDrag() {
        if (this.proj || this.cooldown > 0) return;
        const a = this.aimVec();
        if (CFG.aim === 'drag' && Math.hypot(a.vx, a.vy) < this.vMax()*0.12) return;   // tiny pull → no shot
        this.fire(a.vx, a.vy);
    }
    launchMeter() {                                             // Cannon II: pick the angle, time the power meter
        const m = (Math.sin(this.meterT) + 1) / 2;               // 0..1 power (timed)
        const v = GW * (0.7 + m * 0.95), ang = LIVE.launchAngle * Math.PI/180;
        this.fire(Math.cos(ang)*v, -Math.sin(ang)*v);
    }
    fire(vx, vy) {
        this.proj = { x: LAUNCH_X, y: LAUNCH_Y, vx, vy, bounces: 0 };
        this.flightT = 0;
    }

    resolve(hit) {
        this.shots++;
        if (hit) { this.hits++; this.streak++; this.result = this.streak >= 3 ? `SWISH ×${this.streak}` : 'HIT'; }
        else     { this.streak = 0; this.result = 'MISS'; }
        this.resultT = 500;
        this.landMark = { x: this.proj.x, y: this.proj.y };
        this.proj = null;
        this.cooldown = 500;
        this.pickWind();
        this.spawnTarget();
    }

    recompute() {
        let e = GW * 0.018;                                      // base launch precision
        if (CFG.aim === 'angle') e += GW * 0.030;               // Cannon I: judge the arc with no preview (meter has its own term)
        if (CFG.aim === 'meter') e += GW * (0.03 + 0.08 * LIVE.meterSpeed);
        if (CFG.wind) e += LIVE.windStr * GW * 0.09;
        if (this.moving()) e += LIVE.targetSpeed * GW * 0.35;
        this.bandHard = this.sizeFromR(e * 1.20);
        this.bandEasy = this.sizeFromR(e * 2.60);
        this.derivedOK = this.Rmax() >= e * 1.20;
        if (CFG.compute) LIVE.targetSize = this.bandEasy + (this.bandHard - this.bandEasy) * this.bandT;
        this._e = e;
    }

    update(time, delta) {
        const dt = Math.min(delta/1000, 0.05);
        if (this.cooldown > 0) this.cooldown -= delta;
        if (this.resultT > 0) this.resultT -= delta;
        this.recompute();
        this.meterT += dt * (0.8 + LIVE.meterSpeed * 3.2);

        // moving target
        if (this.moving() && this.target.vx) {
            const R = this.R();
            this.target.x += this.target.vx * dt;
            if (this.target.x < this.target.loX) { this.target.x = this.target.loX; this.target.vx = Math.abs(this.target.vx); }
            if (this.target.x > this.target.hiX) { this.target.x = this.target.hiX; this.target.vx = -Math.abs(this.target.vx); }
        }

        // projectile physics
        if (this.proj) {
            const p = this.proj, projR = GW * LIVE.projSize / 2;
            this.flightT += dt;
            p.vy += this.grav() * dt;
            if (CFG.wind) p.vx += Math.cos(this.windAng) * this.windMag * GW*0.5 * dt;
            p.x += p.vx * dt; p.y += p.vy * dt;
            // hit?
            if (Math.hypot(p.x - this.target.x, p.y - this.target.y) < this.R() + projR) { this.resolve(true); }
            else if (p.y + projR >= GROUND_Y) {                 // ground contact
                if (CFG.bounce && Math.abs(p.vy) > GROUND_Y*0.10) {
                    p.y = GROUND_Y - projR; p.vy = -Math.abs(p.vy) * LIVE.restitution; p.vx *= 0.82; p.bounces++;
                } else { this.resolve(false); }
            }
            else if (p.x > W + projR || p.x < GX0 - projR || this.flightT > 6) { this.resolve(false); }
        }

        this.draw();
        this.refreshDerived();
        this.updateReadout();
    }

    // ── draw ───────────────────────────────────────────────────────
    draw() {
        const g = this.sceneGfx; g.clear();
        g.fillStyle(0x1a1d27); g.fillRect(GX0, GROUND_Y, GW, H - GROUND_Y);
        g.fillStyle(0x2e7d4f); g.fillRect(GX0, GROUND_Y, GW, H*0.006);

        this.drawTarget(g);
        if (this.landMark && this.resultT > 0) { g.fillStyle(0x2d2d3a); g.fillCircle(this.landMark.x, this.landMark.y, Math.max(3, GW*0.01)); }
        if (this.aiming && !this.cannon()) this.drawTrajectory(g);   // cannon: no preview — judge the arc
        if (this.proj) this.drawProjectile(g);
        this.drawLauncher(g);
        if (CFG.aim === 'meter' && !this.proj) this.drawMeter(g);
        this.drawWind(g);
        this.launchBtn.setVisible(this.cannon()); this.launchBtnTxt.setVisible(this.cannon());
        this.resultTxt.setText(this.resultT > 0 ? this.result : '').setColor(this.result === 'MISS' ? '#e74c3c' : '#d4f24e');
    }

    drawTarget(g) {
        const x = this.target.x, y = this.target.y, R = this.R();
        if (y > GROUND_Y - FH*0.16) { g.fillStyle(0x000000, 0.16); g.fillEllipse(x, GROUND_Y + R*0.10, R*1.6, R*0.34); }
        else { g.lineStyle(Math.max(2, R*0.05), 0x3a4055, 0.7); g.lineBetween(x, y + R, x, GROUND_Y); }   // post for a raised target
        const rings = [[1.0, 0xe8eaf0], [0.66, 0x2a2e38], [0.36, 0xd4f24e], [0.14, 0xffffff]];
        for (const [k, col] of rings) { g.fillStyle(col); g.fillCircle(x, y, R*k); }
    }

    drawTrajectory(g) {
        const a = this.aimVec(); let x = LAUNCH_X, y = LAUNCH_Y, vx = a.vx, vy = a.vy;
        const dt = 0.035, gr = this.grav();
        g.fillStyle(0xd4f24e, 0.5);
        for (let i = 0; i < 40; i++) {
            vy += gr*dt; x += vx*dt; y += vy*dt;
            if (y > GROUND_Y || x > W || x < GX0) break;
            if (i % 2 === 0) g.fillCircle(x, y, GW*0.006);
        }
        // pull band
        g.lineStyle(GW*0.008, 0x5a6072, 0.8); g.lineBetween(LAUNCH_X, LAUNCH_Y, this.pull.x, this.pull.y);
    }

    drawProjectile(g) {
        const p = this.proj, r = GW * LIVE.projSize / 2;
        g.fillStyle(0x000000, 0.12); g.fillEllipse(p.x, Math.min(GROUND_Y, p.y + r*2), r*1.4, r*0.4);
        g.fillStyle(0xd4f24e); g.fillCircle(p.x, p.y, r);
        g.fillStyle(0xffffff, 0.25); g.fillCircle(p.x - r*0.3, p.y - r*0.3, r*0.4);
    }

    drawLauncher(g) {
        if (this.cannon()) {                                        // cannon barrel rotated to the chosen angle
            const a = LIVE.launchAngle * Math.PI/180;
            g.lineStyle(GW*0.010, 0xd4f24e, 0.6); g.lineBetween(LAUNCH_X, LAUNCH_Y, LAUNCH_X + Math.cos(a)*GW*0.20, LAUNCH_Y - Math.sin(a)*GW*0.20);
            g.lineStyle(GW*0.030, 0x3a4a6a, 1);   g.lineBetween(LAUNCH_X, LAUNCH_Y, LAUNCH_X + Math.cos(a)*GW*0.11, LAUNCH_Y - Math.sin(a)*GW*0.11);
            g.fillStyle(0x2a3550); g.fillCircle(LAUNCH_X, LAUNCH_Y, GW*0.034);
            g.fillStyle(0x3a4a6a); g.fillCircle(LAUNCH_X, LAUNCH_Y, GW*0.020);
            return;
        }
        g.fillStyle(0x2a3550); g.fillRoundedRect(LAUNCH_X - GW*0.03, LAUNCH_Y - GW*0.005, GW*0.06, GROUND_Y - LAUNCH_Y + GW*0.03, GW*0.01);
        g.fillStyle(0x3a4a6a); g.fillCircle(LAUNCH_X, LAUNCH_Y, GW*0.022);
    }

    drawMeter(g) {
        const m = (Math.sin(this.meterT) + 1) / 2;
        const x0 = LAUNCH_X - GW*0.02, y0 = LAUNCH_Y - FH*0.30, w = GW*0.04, h = FH*0.26;
        g.fillStyle(0x1f2230); g.fillRoundedRect(x0, y0, w, h, GW*0.008);
        g.fillStyle(0xd4f24e); g.fillRoundedRect(x0, y0 + h*(1-m), w, h*m, GW*0.008);
        g.lineStyle(1.5, 0x3a3d4a); g.strokeRoundedRect(x0, y0, w, h, GW*0.008);
    }

    drawWind(g) {
        if (!CFG.wind) { this.windTxt.setText(''); return; }
        const ax = GX0 + GW*0.16, ay = FTOP + H*0.02;
        this.windTxt.setPosition(ax, ay + H*0.03);
        const c = Math.cos(this.windAng), s = Math.sin(this.windAng), len = GW*0.04 + GW*0.05*this.windMag;
        const tx = ax + c*len, ty = ay + s*len, nx = -s, ny = c, hw = GW*0.02;
        g.lineStyle(GW*0.012, 0xffd27a, 1); g.lineBetween(ax - c*len*0.7, ay - s*len*0.7, tx, ty);
        g.fillStyle(0xffd27a); g.fillTriangle(tx + c*GW*0.028, ty + s*GW*0.028, tx + nx*hw, ty + ny*hw, tx - nx*hw, ty - ny*hw);
        this.windTxt.setText(`WIND ${Math.round(this.windMag*100)}`);
    }

    updateReadout() {
        const R = this.R(), ratio = R > 0 ? this._e / R : 9;
        const pct = Math.round(Phaser.Math.Clamp(ratio, 0, 1.4) / 1.4 * 100);
        const lvl = ratio < 0.55 ? 'EASY' : ratio < 1.0 ? 'FAIR' : 'HARD';
        const how = CFG.aim === 'drag' ? 'pull back & release' : CFG.aim === 'aim' ? 'point the angle & release'
                  : CFG.aim === 'angle' ? 'drag to aim · LAUNCH to fire' : 'drag to aim · LAUNCH on the meter';
        this.readout.setText(
            `${this.preset} · ${CFG.aim.toUpperCase()}${this.moving() ? ' · moving' : ''}\n` +
            `${how} · target Ø ${Math.round(R*2)}px · error ±${Math.round(this._e)}px · difficulty ${pct}% ${lvl}${this.derivedOK ? '' : '  ⚠ unfair'}\n` +
            `hit ${this.hits} · shots ${this.shots} · streak ${this.streak}`);
        this.readout.setColor(this.derivedOK ? '#979aa8' : '#e74c3c');
    }

    applyPreset(name) {
        const p = PRESETS[name]; if (!p) return;
        CFG.aim = p.aim; CFG.targetMove = p.targetMove; CFG.wind = p.wind; CFG.bounce = p.bounce;
        CFG.compute = p.compute !== undefined ? p.compute : true;
        Object.assign(LIVE, p.live);
        this.preset = name;
        this.resetRun();
        this.rebuildPanel();
    }

    // ── control strip (left) ───────────────────────────────────────
    buildPanel() {
        this.reg(this.add.rectangle(PW/2, H/2, PW, H, 0x17181f, 0.98).setDepth(50));
        this.reg(this.add.rectangle(PW, H/2, 1.5, H, 0x24262f).setDepth(50));
        this.reg(this.add.text(PW*0.06, H*0.028, '⚙ LAUNCH / PHYSICS', { fontSize: `${GW*0.024}px`, color: '#e8e9ef', fontStyle: 'bold' }).setOrigin(0, 0.5).setDepth(60));
        this.reg(this.add.text(PW*0.06, H*0.05, '发射物理', { fontSize: `${GW*0.019}px`, color: '#6d7080' }).setOrigin(0, 0.5).setDepth(60));

        const names = Object.keys(PRESETS);
        let cy = H*0.074;
        const perRow = 4, bw = PW*0.22, gap = PW*0.013;
        names.forEach((name, i) => {
            const cx = PW*0.05 + i*(bw + gap) + bw/2, on = this.preset === name;
            const b = this.reg(this.add.rectangle(cx, cy, bw, H*0.034, on ? 0x2b3350 : 0x1f2230).setStrokeStyle(1.5, on ? 0xd4f24e : 0x3a3d4a).setInteractive().setDepth(60));
            this.reg(this.add.text(cx, cy, name, { fontSize: `${GW*0.0135}px`, color: on ? '#d4f24e' : '#c8ccda', fontStyle: 'bold' }).setOrigin(0.5).setDepth(61));
            b.on('pointerup', () => this.applyPreset(name));
        });
        cy += H*0.034 + H*0.008;

        const R = {
            size:  { label:'Target Size',    min:0.3, max:1.0, get:()=>LIVE.targetSize, set:v=>LIVE.targetSize=v, fmt:v=>`${Math.round(v*100)}%`, dir:'easier' },
            dist:  { label:'Distance',       min:0.3, max:1.0, get:()=>LIVE.distance,   set:v=>LIVE.distance=v,   fmt:v=>`${Math.round(v*100)}%`, dir:'harder' },
            tY:    { label:'Target Position',min:0.0, max:1.0, get:()=>LIVE.targetY,    set:v=>LIVE.targetY=v,    fmt:v=>`${Math.round(v*100)}%`, dir:'neutral' },
            tspd:  { label:'Target Speed',   min:0.1, max:0.8, get:()=>LIVE.targetSpeed,set:v=>LIVE.targetSpeed=v,fmt:v=>`${v.toFixed(2)}`,       dir:'harder' },
            grav:  { label:'Gravity',        min:0.3, max:1.2, get:()=>LIVE.gravity,    set:v=>LIVE.gravity=v,    fmt:v=>`${v.toFixed(2)}`,       dir:'feel' },
            power: { label:'Power',          min:0.3, max:1.0, get:()=>LIVE.power,      set:v=>LIVE.power=v,      fmt:v=>`${Math.round(v*100)}%`, dir:'feel' },
            wind:  { label:'Wind Strength',  min:0.0, max:1.0, get:()=>LIVE.windStr,    set:v=>LIVE.windStr=v,    fmt:v=>`${Math.round(v*100)}`,  dir:'feel' },
            rest:  { label:'Bounciness',     min:0.0, max:0.9, get:()=>LIVE.restitution,set:v=>LIVE.restitution=v,fmt:v=>`${Math.round(v*100)}`,  dir:'feel' },
            proj:  { label:'Projectile Size',min:0.02,max:0.06,get:()=>LIVE.projSize,   set:v=>LIVE.projSize=v,   fmt:v=>`${(v*100).toFixed(1)}%`, dir:'neutral' },
            ang:   { label:'Launch Angle',   min:20,  max:75,  get:()=>LIVE.launchAngle,set:v=>LIVE.launchAngle=Math.round(v), fmt:v=>`${Math.round(v)}°`, dir:'neutral' },
            meter: { label:'Meter Speed',    min:0.1, max:1.0, get:()=>LIVE.meterSpeed, set:v=>LIVE.meterSpeed=v, fmt:v=>`${v.toFixed(2)}`,       dir:'harder' },
        };
        R.tspd.en  = this.moving();
        R.wind.en  = CFG.wind;
        R.rest.en  = CFG.bounce;
        R.ang.en   = this.cannon();
        R.dist.en  = !this.cannon();                              // cannon distance is randomized each shot
        R.meter.en = CFG.aim === 'meter';

        const aimNext = { drag:'aim', aim:'angle', angle:'meter', meter:'drag' };
        const aimLbl  = { drag:'DRAG PULL', aim:'AIM POINT', angle:'ANGLE', meter:'METER' };
        const cAim  = { label:'Aim Mode',  val: aimLbl[CFG.aim], en:true, tap:()=>CFG.aim = aimNext[CFG.aim] };
        const cComp = { label:'Compute',   val: CFG.compute?'TARGET SIZE':'OFF', en:true, tap:()=>CFG.compute=!CFG.compute };
        const cMot  = { label:'Target',    val: CFG.targetMove?'MOVING':'STATIC', en:true, tap:()=>CFG.targetMove=!CFG.targetMove };
        const cWind = { label:'Wind',      val: CFG.wind?'ON':'OFF', en:true, tap:()=>CFG.wind=!CFG.wind };
        const cBnc  = { label:'Bounce',    val: CFG.bounce?'ON':'OFF', en:true, tap:()=>CFG.bounce=!CFG.bounce };

        this.foldState = this.foldState || { SETUP:false, TARGET:false, PHYSICS:false, AIM:false };
        const chipRow = (arr) => {
            for (let i = 0; i < arr.length; i += 2) {
                this.mkChip(arr[i], PW*0.05, cy + H*0.019, PW*0.435);
                if (arr[i+1]) this.mkChip(arr[i+1], PW*0.515, cy + H*0.019, PW*0.435);
                cy += H*0.038;
            }
        };
        const sliderRows = (arr) => { for (const r of arr) { this.mkSlider(r, cy + H*0.005); cy += H*0.035; } };
        const section = (label, body) => {
            const open = !this.foldState[label];
            const bar = this.reg(this.add.rectangle(PW*0.5, cy + H*0.012, PW*0.9, H*0.022, 0x22252f).setStrokeStyle(1, open ? 0x3a3d4a : 0x2e313c).setInteractive().setDepth(58));
            this.reg(this.add.text(PW*0.075, cy + H*0.012, (open ? '▾  ' : '▸  ') + label, { fontSize: `${GW*0.0155}px`, color: '#c8ccda', fontStyle: 'bold' }).setOrigin(0, 0.5).setDepth(60));
            bar.on('pointerup', () => { this.foldState[label] = !this.foldState[label]; this.rebuildPanel(); });
            cy += H*0.027;
            if (open) body();
        };

        section('SETUP',   () => chipRow([cAim, cComp]));
        section('TARGET',  () => {
            chipRow([cMot]);
            for (const rr of [R.size, R.dist, R.tY, R.tspd]) {
                if (rr === R.size && CFG.compute) this.renderDerived(rr, cy + H*0.005);
                else this.mkSlider(rr, cy + H*0.005);
                cy += H*0.035;
            }
        });
        section('PHYSICS', () => { chipRow([cWind, cBnc]); sliderRows([R.grav, R.power, R.wind, R.rest]); });
        section('AIM',     () => sliderRows([R.ang, R.proj, R.meter]));
    }

    rebuildPanel() { this.panelObjs.forEach(o => o.destroy()); this.panelObjs = []; this.derived = null; this.buildPanel(); }

    renderDerived(r, y) {
        const x0 = PW*0.06, x1 = PW*0.94, ty = y + H*0.017;
        this.reg(this.add.text(x0, y, r.label + '  ▸AUTO', { fontSize: `${GW*0.02}px`, color: '#e8e9ef' }).setOrigin(0, 0.5).setDepth(60));
        const text = this.reg(this.add.text(x1, y, '', { fontSize: `${GW*0.02}px`, color: '#e8e9ef', fontStyle: 'bold' }).setOrigin(1, 0.5).setDepth(60));
        const g = this.reg(this.add.graphics().setDepth(59));
        const handle = this.reg(this.add.circle(x0, ty, GW*0.022, 0xffffff).setStrokeStyle(3, 0x121319).setInteractive({ draggable: true }).setDepth(62));
        this.input.setDraggable(handle);
        const xOf = ratio => x0 + (Phaser.Math.Clamp(ratio, r.min, r.max) - r.min)/(r.max - r.min) * (x1 - x0);
        handle.on('dragstart', () => { this.draggingRun = true; });
        handle.on('dragend',   () => { this.draggingRun = false; });
        handle.on('drag', (ptr, dragX) => {
            const exPos = xOf(this.bandEasy), hxPos = xOf(this.bandHard);
            const lo = Math.min(exPos, hxPos), hi = Math.max(exPos, hxPos);
            const cx = Phaser.Math.Clamp(dragX, lo, hi); handle.x = cx;
            const sp = hxPos - exPos;
            this.bandT = Math.abs(sp) < 1 ? 0 : Phaser.Math.Clamp((cx - exPos)/sp, 0, 1);
        });
        this.derived = { r, g, text, handle, x0, x1, y: ty };
        this.refreshDerived();
    }
    refreshDerived() {
        const d = this.derived; if (!d) return;
        const g = d.g; g.clear();
        const min = d.r.min, max = d.r.max, span = d.x1 - d.x0, y = d.y;
        const xOf = ratio => d.x0 + (Phaser.Math.Clamp(ratio, min, max) - min)/(max - min) * span;
        const ex = xOf(this.bandEasy), hx = xOf(this.bandHard);
        g.lineStyle(4, 0x2e313c); g.lineBetween(d.x0, y, d.x1, y);
        g.lineStyle(8, this.derivedOK ? 0x2e7d4f : 0x7d2e2e, 1); g.lineBetween(Math.min(ex,hx), y, Math.max(ex,hx), y);
        g.lineStyle(3, 0x2ecc71); g.lineBetween(ex, y - H*0.010, ex, y + H*0.010);
        g.lineStyle(3, 0xe74c3c); g.lineBetween(hx, y - H*0.010, hx, y + H*0.010);
        if (d.handle && !this.draggingRun) d.handle.x = xOf(d.r.get());
        d.text.setText(d.r.fmt(d.r.get()));
        d.text.setColor(this.derivedOK ? '#979aa8' : '#e74c3c');
    }

    mkChip(c, x, y, w) {
        const en = c.en !== false;
        const b = this.reg(this.add.rectangle(x, y, w, H*0.034, en ? 0x1f2230 : 0x191b24).setStrokeStyle(1.5, en ? 0x3a3d4a : 0x2a2c36).setDepth(60).setOrigin(0, 0.5));
        this.reg(this.add.text(x + PW*0.03, y, c.label, { fontSize: `${GW*0.017}px`, color: en ? '#9aa0b4' : '#565b6b' }).setOrigin(0, 0.5).setDepth(61));
        this.reg(this.add.text(x + w - PW*0.03, y, c.val, { fontSize: `${GW*0.018}px`, color: en ? '#d4f24e' : '#565b6b', fontStyle: 'bold' }).setOrigin(1, 0.5).setDepth(61));
        if (en) { b.setInteractive(); b.on('pointerup', () => { c.tap(); this.resetRun(); this.rebuildPanel(); }); }
    }

    diffTrack(g, r, x0, x1, y) {
        const d = r.dir || 'neutral';
        const lerp = (a,b,t)=>{const f=(s)=>[(s>>16)&255,(s>>8)&255,s&255];const A=f(a),B=f(b);return((A[0]+(B[0]-A[0])*t|0)<<16)|((A[1]+(B[1]-A[1])*t|0)<<8)|(A[2]+(B[2]-A[2])*t|0);};
        if (d==='harder'||d==='easier') { const A=d==='harder'?0x2ecc71:0xe74c3c, B=d==='harder'?0xe74c3c:0x2ecc71, N=18;
            for(let i=0;i<N;i++){g.lineStyle(6,lerp(A,B,(i+0.5)/N),1);g.lineBetween(x0+(x1-x0)*i/N,y,x0+(x1-x0)*(i+1)/N,y);} g.fillStyle(A,1); g.fillCircle(x0,y,3); g.fillStyle(B,1); g.fillCircle(x1,y,3); }
        else if (d==='feel') { g.lineStyle(5,0xf1c40f,0.4); g.lineBetween(x0,y,x1,y); g.fillStyle(0xf1c40f,0.4); g.fillCircle(x0,y,2.5); g.fillCircle(x1,y,2.5); }
        else { g.lineStyle(5,0x565a68); g.lineBetween(x0,y,x1,y); g.fillStyle(0x565a68,1); g.fillCircle(x0,y,2.5); g.fillCircle(x1,y,2.5); }
    }

    mkSlider(r, y) {
        const en = r.en !== false;
        const tx0 = PW*0.06, tx1 = PW*0.94, trackW = tx1 - tx0, ty = y + H*0.017;
        this.reg(this.add.text(tx0, y, r.label, { fontSize: `${GW*0.02}px`, color: en ? '#9aa0b4' : '#565b6b' }).setOrigin(0, 0.5).setDepth(60));
        const valTxt = this.reg(this.add.text(tx1, y, r.fmt(r.get()), { fontSize: `${GW*0.02}px`, color: en ? '#e8e9ef' : '#565b6b', fontStyle: 'bold' }).setOrigin(1, 0.5).setDepth(60));
        const g = this.reg(this.add.graphics().setDepth(59));
        if (en) this.diffTrack(g, r, tx0, tx1, ty);
        else { g.lineStyle(5, 0x33363f); g.lineBetween(tx0, ty, tx1, ty); }
        const knob = this.reg(this.add.circle(tx0 + (r.get() - r.min)/(r.max - r.min) * trackW, ty, GW*0.019, en ? 0xd4f24e : 0x4a4e5c).setStrokeStyle(2.5, 0x121319).setDepth(61));
        if (en) {
            knob.setInteractive({ draggable: true });
            this.input.setDraggable(knob);
            knob.on('drag', (ptr, dragX) => {
                const cx = Phaser.Math.Clamp(dragX, tx0, tx1); knob.x = cx;
                const v = r.min + (cx - tx0)/trackW * (r.max - r.min);
                valTxt.setText(r.fmt(v)); r.set(v);
            });
        }
    }
}

function FMIDishY() { return LAUNCH_Y - FH*0.2; }

const config = {
    type: Phaser.WEBGL,
    width: windowWidth,
    height: windowHeight,
    transparent: false,
    backgroundColor: '#0d0e12',
    canvas: window.canvas,
    scene: [LiveScene],
    input: { mouse: true, touch: true, keyboard: true },
};

new Phaser.Game(config);
