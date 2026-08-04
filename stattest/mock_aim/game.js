require('libs/tt-adapter.js');
const Phaser = require('libs/phaser.js');

// Aim uses a WIDER (landscape) canvas: a left control strip PLUS a native
// portrait gameplay region — same layout as the Movement super group.
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
// AIM / SHOOTING — SUPER GROUP.  A crosshair aims at target(s); a projectile
// launches (with a travel time, or instant = "point & click"), and its landing
// point is checked against the nearest target.  Presets span the family:
//   • ARCHERY  — travel + arc + wind, distant static target, breathing aim.
//   • SNIPER   — target pops at a random spot for a short lifetime; breathing drift.
//   • SKEET    — target flies across; travel time forces you to LEAD it.
//   • GALLERY  — fixed crosshair, targets slide through it, tap on time.
//   • WHACK    — a GRID of pop-up targets with a lifetime; tap them before they escape.
// Point-and-click == instant projectile (flight time 0); Show-Projectile hides the
// shot for those. Grid spawn snaps targets to cells and disables motion.
// ─────────────────────────────────────────────────────────────────
const CFG = {
    aim: 'steady', projectile: 'travel', showProjectile: true,
    targetMove: false, targetPos: 'fixed', spawnLayout: 'free', timed: false,
    arc: true, wind: true, compute: true,   // compute: derive Target Size as an Easy↔Hard band
};

const LIVE = {
    targetSize: 0.55, distance: 0.55, targetSpeed: 0.35,
    flightTime: 0.55, arcDrop: 0.45, windStr: 0.45,
    drift: 0.40, driftSpeed: 0.50, aimSpeed: 0.55,
    lifetime: 1200, simultaneous: 1, spawnRate: 700, gridN: 3,
};

const PRESETS = {
    'ARCHERY': { aim:'steady', projectile:'travel', showProjectile:true, targetMove:false, targetPos:'fixed', spawnLayout:'free', timed:false, arc:true, wind:true,
                 live:{ targetSize:0.55, distance:0.62, flightTime:0.55, arcDrop:0.5, windStr:0.45, drift:0.40, driftSpeed:0.5, simultaneous:1, spawnRate:450 } },
    'SNIPER':  { aim:'steady', projectile:'instant', showProjectile:true, targetMove:false, targetPos:'random', spawnLayout:'free', timed:true, arc:false, wind:false,
                 live:{ targetSize:0.32, distance:0.5, drift:0.62, driftSpeed:0.7, lifetime:1000, simultaneous:1, spawnRate:600 } },
    'SKEET':   { aim:'manual', projectile:'travel', showProjectile:true, targetMove:true, targetPos:'random', spawnLayout:'free', timed:false, arc:false, wind:false,
                 live:{ targetSize:0.5, distance:0.5, targetSpeed:0.5, flightTime:0.6, drift:0.0, simultaneous:1, spawnRate:700 } },
    'GALLERY': { aim:'fixed', projectile:'instant', showProjectile:false, targetMove:true, targetPos:'random', spawnLayout:'free', timed:false, arc:false, wind:false,
                 live:{ targetSize:0.5, distance:0.45, targetSpeed:0.4, simultaneous:1, spawnRate:250 } },
    'WHACK':   { aim:'manual', projectile:'instant', showProjectile:false, targetMove:false, targetPos:'random', spawnLayout:'grid', timed:true, arc:false, wind:false,
                 live:{ targetSize:0.62, distance:0.4, lifetime:1100, simultaneous:2, spawnRate:650, gridN:3 } },
};

const FTOP = H*0.07, FBOT = H*0.78;
const FMIDY = (FTOP + FBOT) / 2;
const LAUNCH_X = GCX, LAUNCH_Y = H*0.90;
const SWEEP_HALF = GW*0.40;
const SWAY_MAX = GW*0.075;

class LiveScene extends Phaser.Scene {
    constructor() { super('LiveScene'); }

    create() {
        this.preset = 'ARCHERY';
        this.add.rectangle(W/2, H/2, W, H, 0x0f1622).setDepth(0);
        this.add.rectangle(GCX, H/2, GW, H, 0x121a2b).setDepth(0.3);
        this.sceneGfx = this.add.graphics().setDepth(2);

        this.resultTxt = this.add.text(GCX, FTOP + H*0.02, '', { fontSize: `${GW*0.05}px`, fontStyle: 'bold' }).setOrigin(0.5).setDepth(9);
        this.windTxt = this.add.text(GX0 + GW*0.16, FTOP + H*0.05, '', { fontSize: `${GW*0.026}px`, color: '#ffd27a', fontStyle: 'bold' }).setOrigin(0.5).setDepth(9);

        const zone = this.add.rectangle(GCX, H/2, GW, H, 0x000000, 0).setInteractive().setDepth(1);
        zone.on('pointerdown', (ptr) => this.onDown(ptr));
        this.input.on('pointermove', (ptr) => { if (this.dragging) this.setBase(ptr); });
        this.input.on('pointerup',   () => { if (this.dragging) { this.dragging = false; this.fire(); } });
        if (this.input.keyboard) this.input.keyboard.on('keydown-SPACE', () => this.fire());

        this.readout = { setText: (t) => { if (typeof window !== 'undefined') window.__genreStats = t; return this.readout; }, setColor: () => this.readout, y: 0 };

        this.panelObjs = [];
        // hub can launch a specific variant via window.__genrePreset (subgroup card == preset)
        const boot = (typeof window !== 'undefined' && window.__genrePreset && PRESETS[window.__genrePreset]) ? window.__genrePreset : 'ARCHERY';
        this.applyPreset(boot);
    }

    reg(o) { this.panelObjs.push(o); return o; }

    resetRun() {
        this.base = { x: GCX, y: FMIDY };
        this.eff  = { x: GCX, y: FMIDY };
        this.sway = { x: 0, y: 0 };
        this.swayT = 0; this.sweepT = 0;
        this.sp = [0,1,2,3].map((i) => i * 1.7);
        this.dragging = false;
        this.flying = null; this.cooldown = 0; this.result = ''; this.resultT = 0; this.hitMark = null;
        this.shots = 0; this.hits = 0; this.bull = 0; this.escapes = 0;
        this.windAng = 0.6; this.windMag = LIVE.windStr;
        this.rseed = 1;
        this.targets = []; this.spawnAcc = 0;
        // Easy↔Hard difficulty band on Target Size
        this.bandEasy = 0.6; this.bandHard = 0.4; this.bandT = 0.5;
        this.derivedOK = true; this.draggingRun = false; this.derived = null;
    }

    rnd() { this.rseed = (this.rseed * 1103515245 + 12345) & 0x7fffffff; return this.rseed / 0x7fffffff; }

    distN() { return Phaser.Math.Clamp((LIVE.distance - 0.3) / 0.7, 0, 1); }
    R() { return GW * (0.045 + 0.11 * Phaser.Math.Clamp((LIVE.targetSize - 0.3)/0.7 + 0.3, 0.2, 1.0)) * (1 - 0.30 * this.distN()); }
    flightT() { return CFG.projectile === 'instant' ? 0.05 : Math.max(0.08, LIVE.flightTime * (0.5 + 0.9 * this.distN())); }
    moving() { return CFG.targetMove && CFG.spawnLayout !== 'grid'; }   // grid disables motion

    makeTarget() {
        const r = this.R();
        const loX = GX0 + r + GW*0.04, hiX = W - r - GW*0.04;
        const loY = FTOP + r, hiY = FBOT - GW*0.10 - r;
        const life = CFG.timed ? Math.max(300, LIVE.lifetime) : Infinity;

        if (CFG.spawnLayout === 'grid') {
            const cells = this.gridCells();       // same cells drawGrid renders → sockets line up exactly
            let cell, tries = 0;
            do { cell = cells[Math.floor(this.rnd()*cells.length)]; tries++; }
            while (tries < 12 && this.targets.some(t => Math.hypot(t.x - cell.x, t.y - cell.y) < r*1.8));
            return { x: cell.x, y: cell.y, vx: 0, stream: false, life, maxLife: life };
        }
        if (this.moving() && CFG.aim === 'fixed') {            // gallery stream through the fixed crosshair
            const fromLeft = this.rnd() < 0.5, speed = GW * LIVE.targetSpeed;
            return { x: fromLeft ? GX0 - r : W + r, y: FMIDY, vx: fromLeft ? speed : -speed, stream: true, life: Infinity, maxLife: Infinity };
        }
        let x, y;
        if (CFG.targetPos === 'random' || this.moving()) { x = loX + this.rnd()*(hiX - loX); y = loY + this.rnd()*(hiY - loY)*0.7; }
        else { x = GCX; y = FTOP + (FBOT - FTOP)*0.28; }
        const vx = this.moving() ? (this.rnd() < 0.5 ? -1 : 1) * GW * LIVE.targetSpeed : 0;
        return { x, y, vx, stream: false, life, maxLife: life, loX, hiX };
    }

    pickWind() { this.windAng = this.rnd() * Math.PI * 2; this.windMag = LIVE.windStr * (0.8 + 0.4*this.rnd()); }

    setBase(ptr) {
        this.base.x = Phaser.Math.Clamp(ptr.x, GX0 + GW*0.02, W - GW*0.02);
        this.base.y = Phaser.Math.Clamp(ptr.y, FTOP, FBOT);
    }

    onDown(ptr) {
        if (CFG.aim === 'manual' || CFG.aim === 'steady') { this.dragging = true; this.setBase(ptr); }
        else this.fire();      // sweep / fixed → tap to shoot
    }

    fire() {
        if (this.flying || this.cooldown > 0) return;
        const T = this.flightT();
        let dx = 0, dy = 0;
        if (CFG.wind) { const gain = this.windMag * GW*0.11 * (T*T*4); dx = Math.cos(this.windAng)*gain; dy = Math.sin(this.windAng)*gain*0.5; }
        if (CFG.arc)  { dy += LIVE.arcDrop * GW*0.34 * (T*T); }
        this.flying = { t: 0, T, sx: LAUNCH_X, sy: LAUNCH_Y, ex: this.eff.x, ey: this.eff.y, lx: this.eff.x + dx, ly: this.eff.y + dy };
    }

    resolve() {
        const f = this.flying, r = this.R();
        let best = -1, bestD = 1e9;
        for (let i = 0; i < this.targets.length; i++) {
            const d = Math.hypot(f.lx - this.targets[i].x, f.ly - this.targets[i].y);
            if (d < bestD) { bestD = d; best = i; }
        }
        this.shots++;
        if (best >= 0 && bestD < r*0.30)      { this.result = 'BULLSEYE!'; this.bull++; this.hits++; this.targets.splice(best, 1); }
        else if (best >= 0 && bestD < r)      { this.result = 'HIT';       this.hits++;             this.targets.splice(best, 1); }
        else                                  { this.result = 'MISS'; }
        this.resultT = 450;
        this.hitMark = { x: f.lx, y: f.ly };
        this.flying = null;
        this.cooldown = CFG.projectile === 'instant' ? 70 : 380;
        if (CFG.wind) this.pickWind();
    }

    update(time, delta) {
        const dt = Math.min(delta/1000, 0.05);
        if (this.cooldown > 0) this.cooldown -= delta;
        if (this.resultT > 0) this.resultT -= delta;
        this.recompute();   // updates the Target Size band (and sets LIVE.targetSize when compute is on)

        // ── aim reticle ──
        this.swayT += dt; this.sweepT += dt * (0.6 + LIVE.aimSpeed*2.2);
        if (CFG.aim === 'fixed')      { this.base.x = GCX; this.base.y = FMIDY; }
        else if (CFG.aim === 'sweep') { this.base.x = GCX + Math.sin(this.sweepT) * SWEEP_HALF; this.base.y = FMIDY; }
        if (CFG.aim === 'steady') {
            const m = LIVE.drift * SWAY_MAX, f = 1 + LIVE.driftSpeed*2.5;
            this.sway.x = m * (Math.sin(this.swayT*f*0.9 + this.sp[0])*0.6 + Math.sin(this.swayT*f*1.5 + this.sp[1])*0.4);
            this.sway.y = m * (Math.sin(this.swayT*f*1.1 + this.sp[2])*0.6 + Math.sin(this.swayT*f*0.7 + this.sp[3])*0.4);
        } else { this.sway.x = 0; this.sway.y = 0; }
        this.eff.x = Phaser.Math.Clamp(this.base.x + this.sway.x, GX0 + GW*0.01, W - GW*0.01);
        this.eff.y = Phaser.Math.Clamp(this.base.y + this.sway.y, FTOP, FBOT);

        // ── targets: move + expire ──
        const r = this.R();
        for (let i = this.targets.length - 1; i >= 0; i--) {
            const t = this.targets[i];
            if (t.vx) {
                t.x += t.vx * dt;
                if (t.stream) { if (t.x < GX0 - r || t.x > W + r) { this.targets.splice(i, 1); continue; } }
                else {
                    if (t.x < t.loX) { t.x = t.loX; t.vx = Math.abs(t.vx); }
                    if (t.x > t.hiX) { t.x = t.hiX; t.vx = -Math.abs(t.vx); }
                }
            }
            if (t.life !== Infinity) { t.life -= delta; if (t.life <= 0) { this.targets.splice(i, 1); this.escapes++; continue; } }
        }

        // ── spawner: keep up to `simultaneous` targets, one every spawnRate ms ──
        const cap = Math.max(1, Math.round(LIVE.simultaneous));
        if (this.targets.length < cap) {
            this.spawnAcc += delta;
            const due = this.spawnAcc >= LIVE.spawnRate || this.targets.length === 0;
            if (due && !(this.targets.length === 0 && this.cooldown > 0)) { this.spawnAcc = 0; this.targets.push(this.makeTarget()); }
        } else this.spawnAcc = 0;

        // ── projectile ──
        if (this.flying) { this.flying.t += dt; if (this.flying.t >= this.flying.T) this.resolve(); }

        this.draw();
        this.refreshDerived();
        this.updateReadout();
    }

    draw() {
        const g = this.sceneGfx; g.clear();
        g.fillStyle(0x1b2740); g.fillRect(GX0, FBOT, GW, H - FBOT);
        g.fillStyle(0x243350); g.fillRect(GX0, FBOT, GW, H*0.006);

        if (CFG.spawnLayout === 'grid') this.drawGrid(g);
        for (const t of this.targets) this.drawTarget(g, t);
        if (this.hitMark && this.resultT > 0) { g.fillStyle(0x2d2d3a); g.fillCircle(this.hitMark.x, this.hitMark.y, Math.max(3, this.R()*0.10)); }
        if (this.flying && CFG.showProjectile) this.drawProjectile(g);
        this.drawLauncher(g);
        if (!this.flying) this.drawReticle(g);
        this.drawWind(g);

        this.resultTxt.setText(this.resultT > 0 ? this.result : '').setColor(this.result === 'MISS' ? '#e74c3c' : '#2ecc71');
    }

    // the grid targets pop into — draw a socket at every cell so the layout is visible
    gridCells() {
        const r = this.R();
        const loX = GX0 + r + GW*0.04, hiX = W - r - GW*0.04;
        const loY = FTOP + r, hiY = FBOT - GW*0.10 - r;
        const n = Math.max(1, Math.round(LIVE.gridN));
        const cells = [];
        for (let ri = 0; ri < n; ri++) for (let ci = 0; ci < n; ci++) {
            cells.push({
                x: loX + (hiX - loX) * (n === 1 ? 0.5 : ci/(n-1)),
                y: loY + (hiY - loY) * (n === 1 ? 0.45 : ri/(n-1)) * 0.9,
            });
        }
        return cells;
    }

    drawGrid(g) {
        const r = this.R();
        for (const c of this.gridCells()) {
            g.fillStyle(0x090d16, 0.85); g.fillEllipse(c.x, c.y + r*0.14, r*1.55, r*0.66);   // socket / hole
            g.lineStyle(Math.max(1, r*0.035), 0x2c3a52, 0.85); g.strokeCircle(c.x, c.y, r);   // cell ring
        }
    }

    drawTarget(g, t) {
        const x = t.x, y = t.y, R = this.R();
        const fade = (t.life !== Infinity && t.maxLife) ? Phaser.Math.Clamp(t.life / (t.maxLife*0.4), 0.35, 1) : 1;   // dim as its lifetime runs out
        g.fillStyle(0x000000, 0.16); g.fillEllipse(x, y + R*1.05, R*1.5, R*0.4);
        const rings = [[1.0, 0xf4f1ea], [0.74, 0x2d2d3a], [0.52, 0x5ec8ff], [0.3, 0xff8fa3], [0.13, 0xffc24d]];
        for (const [k, col] of rings) { g.fillStyle(col, fade); g.fillCircle(x, y, R*k); }
        g.lineStyle(Math.max(1.5, R*0.03), 0xffffff, 0.5*fade); g.strokeCircle(x, y, R);
    }

    drawReticle(g) {
        // fixed crosshair size — independent of Target Size (which the band auto-drives)
        const x = this.eff.x, y = this.eff.y, R = GW*0.05;
        const steady = CFG.aim !== 'steady' || Math.hypot(this.sway.x, this.sway.y) < SWAY_MAX*0.18;
        g.lineStyle(Math.max(2, R*0.08), steady ? 0x2ecc71 : 0xffffff, 0.92);
        g.strokeCircle(x, y, R*0.5);
        g.lineBetween(x - R*0.72, y, x - R*0.2, y); g.lineBetween(x + R*0.2, y, x + R*0.72, y);
        g.lineBetween(x, y - R*0.72, x, y - R*0.2); g.lineBetween(x, y + R*0.2, x, y + R*0.72);
        g.fillStyle(steady ? 0x2ecc71 : 0xffffff, 0.9); g.fillCircle(x, y, Math.max(1.5, R*0.06));
    }

    drawProjectile(g) {
        const f = this.flying, p = Phaser.Math.Clamp(f.t / f.T, 0, 1);
        const x = f.sx + (f.lx - f.sx) * p;
        const arc = CFG.arc ? Math.sin(p * Math.PI) * GW*0.10 : 0;
        const y = f.sy + (f.ly - f.sy) * p - arc;
        g.fillStyle(0x000000, 0.12); g.fillCircle(x, f.sy + (f.ly - f.sy)*p, GW*0.012);
        g.fillStyle(0xffd27a); g.fillCircle(x, y, GW*0.016);
    }

    drawLauncher(g) {
        g.fillStyle(0x2a3550); g.fillRoundedRect(LAUNCH_X - GW*0.06, LAUNCH_Y - GW*0.02, GW*0.12, GW*0.05, GW*0.02);
        g.fillStyle(0x3a4a6a); g.fillCircle(LAUNCH_X, LAUNCH_Y, GW*0.028);
        const ang = Math.atan2(this.eff.y - LAUNCH_Y, this.eff.x - LAUNCH_X);
        g.lineStyle(GW*0.02, 0x5ec8ff, 0.9);
        g.lineBetween(LAUNCH_X, LAUNCH_Y, LAUNCH_X + Math.cos(ang)*GW*0.08, LAUNCH_Y + Math.sin(ang)*GW*0.08);
    }

    drawWind(g) {
        if (!CFG.wind) { this.windTxt.setText(''); return; }
        const ax = GX0 + GW*0.16, ay = FTOP + H*0.02;
        this.windTxt.setPosition(ax, ay + H*0.03);
        if (this.windMag < 0.03) { this.windTxt.setText('WIND — calm'); return; }
        const c = Math.cos(this.windAng), s = Math.sin(this.windAng), len = GW*0.04 + GW*0.05*this.windMag;
        const tx = ax + c*len, ty = ay + s*len;
        g.lineStyle(GW*0.012, 0xffd27a, 1); g.lineBetween(ax - c*len*0.7, ay - s*len*0.7, tx, ty);
        const nx = -s, ny = c, hw = GW*0.02;
        g.fillStyle(0xffd27a); g.fillTriangle(tx + c*GW*0.028, ty + s*GW*0.028, tx + nx*hw, ty + ny*hw, tx - nx*hw, ty - ny*hw);
        this.windTxt.setText(`WIND ${Math.round(this.windMag*100)}`);
    }

    aimError() {
        const T = this.flightT();
        let e = 0;
        if (CFG.aim === 'steady') e += LIVE.drift * SWAY_MAX * 0.7;
        if (CFG.aim === 'sweep')  e += SWEEP_HALF * Phaser.Math.Clamp(0.10 + LIVE.aimSpeed*0.18, 0, 1);
        if (CFG.aim === 'fixed' && this.moving()) e += GW * LIVE.targetSpeed * 0.16;
        if (this.moving() && CFG.projectile === 'travel') e += GW * LIVE.targetSpeed * T;
        if (CFG.wind) e += LIVE.windStr * GW*0.11 * (T*T*4);
        if (CFG.timed) e += GW * 0.05 * Phaser.Math.Clamp(700 / Math.max(300, LIVE.lifetime), 0, 2.2);   // reaction pressure
        if (LIVE.simultaneous > 1) e += GW * 0.018 * (Math.round(LIVE.simultaneous) - 1);
        return { e, T };
    }

    updateReadout() {
        const { e, T } = this.aimError();
        const R = this.R();
        const ratio = R > 0 ? e / R : 9;
        const pct = Math.round(Phaser.Math.Clamp(ratio, 0, 1.4) / 1.4 * 100);
        const lvl = ratio < 0.55 ? 'EASY' : ratio < 1.0 ? 'FAIR' : 'HARD';
        const fair = ratio <= 1.15;
        const tags = [this.preset, CFG.aim.toUpperCase(), CFG.projectile === 'travel' ? T.toFixed(2)+'s' : 'instant'];
        if (CFG.spawnLayout === 'grid') tags.push('grid'); else if (this.moving()) tags.push('moving');
        if (Math.round(LIVE.simultaneous) > 1) tags.push(Math.round(LIVE.simultaneous) + '×');
        this.readout.setText(
            `${tags.join(' · ')}\n` +
            `target Ø ${Math.round(R*2)}px · error ±${Math.round(e)}px · difficulty ${pct}% ${lvl}${fair ? '' : '  ⚠ unfair'}\n` +
            `hit ${this.hits} · bull ${this.bull} · shots ${this.shots}${CFG.timed ? ` · escaped ${this.escapes}` : ''}`);
        this.readout.setColor(fair ? '#979aa8' : '#e74c3c');
    }

    applyPreset(name) {
        const p = PRESETS[name]; if (!p) return;
        CFG.aim = p.aim; CFG.projectile = p.projectile; CFG.targetMove = p.targetMove; CFG.targetPos = p.targetPos;
        CFG.arc = p.arc; CFG.wind = p.wind;
        CFG.showProjectile = p.showProjectile !== undefined ? p.showProjectile : (p.projectile === 'travel');
        CFG.spawnLayout = p.spawnLayout || 'free';
        CFG.timed = !!p.timed;
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
        this.reg(this.add.text(PW*0.06, H*0.026, '⚙ AIM / SHOOTING', { fontSize: `${GW*0.026}px`, color: '#e8e9ef', fontStyle: 'bold' }).setOrigin(0, 0.5).setDepth(60));
        this.reg(this.add.text(PW*0.06, H*0.05, '瞄准射击', { fontSize: `${GW*0.019}px`, color: '#6d7080' }).setOrigin(0, 0.5).setDepth(60));

        // presets — up to 3 per row
        const names = Object.keys(PRESETS);
        let cy = H*0.072;
        const perRow = 3, bw = PW*0.30, gap = PW*0.015;
        names.forEach((name, i) => {
            const col = i % perRow, row = (i / perRow) | 0;
            const cx = PW*0.05 + col*(bw + gap) + bw/2, py = cy + row*H*0.040, on = this.preset === name;
            const b = this.reg(this.add.rectangle(cx, py, bw, H*0.034, on ? 0x2b3350 : 0x1f2230).setStrokeStyle(1.5, on ? 0xd4f24e : 0x3a3d4a).setInteractive().setDepth(60));
            this.reg(this.add.text(cx, py, name, { fontSize: `${GW*0.015}px`, color: on ? '#d4f24e' : '#c8ccda', fontStyle: 'bold' }).setOrigin(0.5).setDepth(61));
            b.on('pointerup', () => this.applyPreset(name));
        });
        cy += Math.ceil(names.length / perRow) * H*0.040 + H*0.006;

        const move = this.moving(), grid = CFG.spawnLayout === 'grid';
        const R = {
            size:  { label:'Target Size',    min:0.3, max:1.0,  get:()=>LIVE.targetSize, set:v=>LIVE.targetSize=v, fmt:v=>`${Math.round(v*100)}%`, dir:'easier' },
            dist:  { label:'Distance',       min:0.3, max:1.0,  get:()=>LIVE.distance,   set:v=>LIVE.distance=v,   fmt:v=>`${Math.round(v*100)}%`, dir:'harder' },
            tspd:  { label:'Target Speed',   min:0.1, max:0.8,  get:()=>LIVE.targetSpeed,set:v=>LIVE.targetSpeed=v,fmt:v=>`${v.toFixed(2)}`,       dir:'harder' },
            simul: { label:'Simultaneous',   min:1,   max:6,    get:()=>LIVE.simultaneous,set:v=>LIVE.simultaneous=Math.round(v), fmt:v=>`${Math.round(v)}`, dir:'harder' },
            gridN: { label:'Grid Size',      min:2,   max:5,    get:()=>LIVE.gridN,      set:v=>LIVE.gridN=Math.round(v), fmt:v=>`${Math.round(v)}×${Math.round(v)}`, dir:'harder' },
            flight:{ label:'Flight Time',    min:0.2, max:1.2,  get:()=>LIVE.flightTime, set:v=>LIVE.flightTime=v, fmt:v=>`${v.toFixed(2)}s`,      dir:'harder' },
            arcs:  { label:'Arc / Drop',     min:0.0, max:1.0,  get:()=>LIVE.arcDrop,    set:v=>LIVE.arcDrop=v,    fmt:v=>`${Math.round(v*100)}`,  dir:'feel' },
            wind:  { label:'Wind Strength',  min:0.0, max:1.0,  get:()=>LIVE.windStr,    set:v=>LIVE.windStr=v,    fmt:v=>`${Math.round(v*100)}`,  dir:'feel' },
            drift: { label:'Drift Amount',   min:0.0, max:1.0,  get:()=>LIVE.drift,      set:v=>LIVE.drift=v,      fmt:v=>`${Math.round(v*100)}`,  dir:'harder' },
            dspd:  { label:'Drift Speed',    min:0.1, max:1.0,  get:()=>LIVE.driftSpeed, set:v=>LIVE.driftSpeed=v, fmt:v=>`${v.toFixed(2)}`,       dir:'feel' },
            aspd:  { label:'Sweep Speed',    min:0.1, max:1.0,  get:()=>LIVE.aimSpeed,   set:v=>LIVE.aimSpeed=v,   fmt:v=>`${v.toFixed(2)}`,       dir:'harder' },
            life:  { label:'Lifetime',       min:400, max:2500, get:()=>LIVE.lifetime,   set:v=>LIVE.lifetime=v,   fmt:v=>`${Math.round(v)}ms`,    dir:'easier' },
            spawn: { label:'Spawn Rate',     min:200, max:1600, get:()=>LIVE.spawnRate,  set:v=>LIVE.spawnRate=v,  fmt:v=>`${Math.round(v)}ms`,    dir:'easier' },
        };
        R.tspd.en  = move;
        R.simul.en = true;
        R.gridN.en = grid;
        R.flight.en = CFG.projectile === 'travel';
        R.arcs.en  = CFG.arc;
        R.wind.en  = CFG.wind;
        R.drift.en = CFG.aim === 'steady';
        R.dspd.en  = CFG.aim === 'steady';
        R.aspd.en  = CFG.aim === 'sweep';
        R.life.en  = CFG.timed;
        R.spawn.en = true;

        const aimNext = { manual:'sweep', sweep:'steady', steady:'fixed', fixed:'manual' };
        const aimLbl  = { manual:'MANUAL', sweep:'SWEEP', steady:'STEADY', fixed:'FIXED' };
        const cAim  = { label:'Aim Mode',   val: aimLbl[CFG.aim], en:true, tap:()=>{ CFG.aim = aimNext[CFG.aim]; } };
        const cProj = { label:'Projectile', val: CFG.projectile==='travel'?'TRAVEL':'INSTANT', en:true, tap:()=>CFG.projectile = CFG.projectile==='travel'?'instant':'travel' };
        const cShow = { label:'Show Shot',  val: CFG.showProjectile?'ON':'OFF', en:true, tap:()=>CFG.showProjectile=!CFG.showProjectile };
        const cComp = { label:'Compute',    val: CFG.compute?'TARGET SIZE':'OFF', en:true, tap:()=>CFG.compute=!CFG.compute };
        const cMot  = { label:'Target',     val: CFG.targetMove?'MOVING':'STATIC', en:!grid, tap:()=>CFG.targetMove=!CFG.targetMove };
        const cPos  = { label:'Position',   val: CFG.targetPos==='random'?'RANDOM':'FIXED', en:!grid, tap:()=>CFG.targetPos = CFG.targetPos==='random'?'fixed':'random' };
        const cLay  = { label:'Spawn',      val: grid?'GRID':'FREE', en:true, tap:()=>CFG.spawnLayout = grid?'free':'grid' };
        const cArc  = { label:'Arc',        val: CFG.arc?'BALLISTIC':'STRAIGHT', en:true, tap:()=>CFG.arc=!CFG.arc };
        const cWind = { label:'Wind',       val: CFG.wind?'ON':'OFF', en:true, tap:()=>CFG.wind=!CFG.wind };
        const cTime = { label:'Lifetime',   val: CFG.timed?'ON':'OFF', en:true, tap:()=>CFG.timed=!CFG.timed };

        // ── collapsible sections ──
        this.foldState = this.foldState || { SETUP:false, TARGET:false, PROJECTILE:false, AIM:false, TIMING:false };
        const chipRow = (arr) => {
            for (let i = 0; i < arr.length; i += 2) {
                this.mkChip(arr[i], PW*0.05, cy + H*0.019, PW*0.435);
                if (arr[i+1]) this.mkChip(arr[i+1], PW*0.515, cy + H*0.019, PW*0.435);
                cy += H*0.037;
            }
        };
        const sliderRows = (arr) => { for (const r of arr) { this.mkSlider(r, cy + H*0.005); cy += H*0.034; } };
        const section = (label, body) => {
            const open = !this.foldState[label];
            const bar = this.reg(this.add.rectangle(PW*0.5, cy + H*0.012, PW*0.9, H*0.022, 0x22252f)
                .setStrokeStyle(1, open ? 0x3a3d4a : 0x2e313c).setInteractive().setDepth(58));
            this.reg(this.add.text(PW*0.075, cy + H*0.012, (open ? '▾  ' : '▸  ') + label,
                { fontSize: `${GW*0.0155}px`, color: '#c8ccda', fontStyle: 'bold' }).setOrigin(0, 0.5).setDepth(60));
            bar.on('pointerup', () => { this.foldState[label] = !this.foldState[label]; this.rebuildPanel(); });
            cy += H*0.026;
            if (open) body();
        };

        section('SETUP',      () => chipRow([cAim, cProj, cShow, cComp]));
        section('TARGET',     () => {
            chipRow([cMot, cPos, cLay]);
            for (const rr of [R.size, R.dist, R.tspd, R.simul, R.gridN]) {
                if (rr === R.size && CFG.compute) this.renderDerived(rr, cy + H*0.005);
                else this.mkSlider(rr, cy + H*0.005);
                cy += H*0.034;
            }
        });
        section('PROJECTILE', () => { chipRow([cArc, cWind]); sliderRows([R.flight, R.arcs, R.wind]); });
        section('AIM',        () => sliderRows([R.drift, R.dspd, R.aspd]));
        section('TIMING',     () => { chipRow([cTime]); sliderRows([R.life, R.spawn]); });
    }

    rebuildPanel() { this.panelObjs.forEach(o => o.destroy()); this.panelObjs = []; this.derived = null; this.buildPanel(); }

    // ── difficulty band on Target Size ─────────────────────────────
    // The aim error e (px) is the precision the shot demands and does NOT depend on
    // target size, so the fair radius runs from Hard (just covers e) to Easy (roomy).
    R2(size) { return GW * (0.045 + 0.11 * Phaser.Math.Clamp((size - 0.3)/0.7 + 0.3, 0.2, 1.0)) * (1 - 0.30 * this.distN()); }
    sizeFromR(R) {
        const base = R / (GW * (1 - 0.30 * this.distN()));
        const c = Phaser.Math.Clamp((base - 0.045) / 0.11, 0.2, 1.0);
        return Phaser.Math.Clamp(0.3 + 0.7 * (c - 0.3), 0.3, 1.0);
    }
    recompute() {
        const e = Math.max(this.aimError().e, GW * 0.02);
        this.bandHard = this.sizeFromR(e * 1.25);   // radius just above the error → hardest fair
        this.bandEasy = this.sizeFromR(e * 2.60);   // generous radius → easiest
        this.derivedOK = this.R2(1.0) >= e * 1.25;  // even the biggest target must cover the error
        if (CFG.compute) LIVE.targetSize = this.bandEasy + (this.bandHard - this.bandEasy) * this.bandT;
    }
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
        const knob = this.reg(this.add.circle(tx0 + (r.get() - r.min)/(r.max - r.min) * trackW, ty, GW*0.018, en ? 0xd4f24e : 0x4a4e5c).setStrokeStyle(2.5, 0x121319).setDepth(61));
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

const config = {
    type: Phaser.WEBGL,
    width: windowWidth,
    height: windowHeight,
    transparent: false,
    backgroundColor: '#0f1622',
    canvas: window.canvas,
    scene: [LiveScene],
    input: { mouse: true, touch: true, keyboard: true },
};

new Phaser.Game(config);
