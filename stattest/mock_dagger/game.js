require('libs/tt-adapter.js');
const Phaser = require('libs/phaser.js');

const res = tt.getSystemInfoSync();
const windowWidth  = res.screenWidth;
const windowHeight = res.screenHeight;
const W = windowWidth, H = windowHeight;

// ─────────────────────────────────────────────────────────────────
// DAGGER THROW — multi-factor difficulty.  Layout from Sushi Chopstick.
//   D = 0.6·min(timing,1) + 0.4·prediction
//   timing     = T_react·spin / (gap − daggerDeg),  gap = 360/(N+1)
//   prediction = clamp(spin·flyTime/gap/2)          flyTime = flyDist/flySpeed
//   flySpeed = FEEL (snappy↔dramatic) but coupled to D → presets compensate spin.
// ─────────────────────────────────────────────────────────────────
const LIVE = { spinSpeed: 100, daggerCount: 6, daggerDeg: 15, flySpeed: 1800 };

const T_REACT  = 0.25;
const DIFF_TARGET = { easy: 0.30, normal: 0.50, hard: 0.70 };
const FEEL_FLY    = { snappy: 3000, neutral: 1700, dramatic: 900 };
const WHEEL_CX = W/2, WHEEL_CY = H*0.30, WHEEL_R = W*0.26;
const LAUNCH_X = W/2, LAUNCH_Y = H*0.80;
const ENTRY_Y  = WHEEL_CY + WHEEL_R;
const FLY_DIST = LAUNCH_Y - ENTRY_Y;
const DLEN     = H*0.11;

function norm(a) { return ((a % 360) + 360) % 360; }
function angDist(a, b) { const d = Math.abs(norm(a) - norm(b)); return Math.min(d, 360 - d); }
function xy(cx, cy, r, deg) { const t = deg*Math.PI/180; return { x: cx + Math.sin(t)*r, y: cy - Math.cos(t)*r }; }

class LiveScene extends Phaser.Scene {
    constructor() { super('LiveScene'); }

    create() {
        this.popupOpen = false; this.popupObjs = [];
        this.targetD = 0.50;
        this.rotation = 0; this.daggers = []; this.baseN = 0; this.flash = 0; this.flying = null;
        this.stuck = 0; this.fails = 0;

        this.add.rectangle(W/2, H/2, W, H, 0x0d0d1a).setDepth(0);
        this.wheelGfx = this.add.graphics().setDepth(4);
        this.flyGfx   = this.add.graphics().setDepth(5);

        const tapZone = this.add.rectangle(W/2, H/2, W, H, 0x000000, 0).setInteractive().setDepth(1);
        tapZone.on('pointerdown', () => this.throwDagger());
        if (this.input.keyboard) this.input.keyboard.on('keydown-SPACE', () => this.throwDagger());

        this.hud = this.add.text(W*0.05, H*0.014, '', { fontSize: `${W*0.04}px`, color: '#979aa8', fontStyle: 'bold' }).setOrigin(0, 0).setDepth(10);
        this.diffHud = this.add.text(W*0.05, H*0.064, '', { fontSize: `${W*0.034}px`, color: '#e8e9ef' }).setOrigin(0, 0).setDepth(10);

        const gear = this.add.rectangle(W*0.90, H*0.012, W*0.17, H*0.044, 0x24262f).setStrokeStyle(1.5, 0x3a3d4a).setInteractive().setDepth(45).setOrigin(0.5, 0);
        this.add.text(W*0.90, H*0.034, '⚙ TUNE', { fontSize: `${W*0.030}px`, color: '#e8e9ef', fontStyle: 'bold' }).setOrigin(0.5).setDepth(46);
        gear.on('pointerup', () => this.openPopup());

        this.reseed(Math.round(LIVE.daggerCount));
    }

    reseed(n) {
        this.baseN = n; this.daggers = [];
        for (let i = 0; i < n; i++) this.daggers.push({ angle: norm(i * 360 / n + Math.random()*8) });
    }

    throwDagger() {
        if (this.popupOpen || this.flash > 0 || this.flying) return;
        this.flying = { y: LAUNCH_Y };
    }

    difficulty() {
        const N = Math.round(LIVE.daggerCount);
        const gap = 360 / (N + 1);
        const windowS = Math.max(0.001, (gap - LIVE.daggerDeg) / LIVE.spinSpeed);
        const precision = T_REACT / windowS;
        const leadDeg = LIVE.spinSpeed * FLY_DIST / LIVE.flySpeed;
        const prediction = Phaser.Math.Clamp(leadDeg / gap / 2, 0, 1);
        const D = Phaser.Math.Clamp(0.6 * Math.min(precision, 1) + 0.4 * prediction, 0, 1);
        return { D, precision, prediction, leadDeg, fair: precision <= 1 };
    }

    // spin that yields difficulty D for the current fly/count/width (compensation)
    solveSpin(D) {
        const N = Math.round(LIVE.daggerCount);
        const gap = 360 / (N + 1);
        if (gap - LIVE.daggerDeg <= 0) return 40;
        const flyTime = FLY_DIST / LIVE.flySpeed;
        const coef = 0.6 * T_REACT / (gap - LIVE.daggerDeg) + 0.4 * flyTime / (2 * gap);
        return Phaser.Math.Clamp(D / coef, 40, 300);
    }

    applyDifficulty(level) { this.targetD = DIFF_TARGET[level]; LIVE.spinSpeed = this.solveSpin(this.targetD); this.refreshKnobs(); }
    applyFeel(feel)        { LIVE.flySpeed = FEEL_FLY[feel];  LIVE.spinSpeed = this.solveSpin(this.targetD); this.refreshKnobs(); }

    update(time, delta) {
        const dt = Math.min(delta / 1000, 0.05);
        if (this.flash > 0) this.flash -= delta;

        const wantN = Math.round(LIVE.daggerCount);
        if (wantN !== this.baseN && this.flash <= 0 && !this.flying) this.reseed(wantN);

        this.rotation = norm(this.rotation + LIVE.spinSpeed * dt);

        if (this.flying) {
            this.flying.y -= LIVE.flySpeed * dt;
            if (this.flying.y <= ENTRY_Y) {
                const a = norm(180 - this.rotation);
                let hit = false;
                for (const d of this.daggers) if (angDist(a, d.angle) < LIVE.daggerDeg) { hit = true; break; }
                if (hit) { this.fails++; this.flash = 350; this.reseed(this.baseN); }
                else     { this.daggers.push({ angle: a }); this.stuck++; }
                this.flying = null;
            }
        }

        this.drawWheel();
        this.drawFlying();
        const d = this.difficulty();
        const lvl = d.D < 0.4 ? 'EASY' : d.D < 0.7 ? 'MEDIUM' : 'HARD';
        this.hud.setText(`stuck ${this.stuck}   fails ${this.fails}`);
        this.diffHud.setText(`Difficulty ${Math.round(d.D*100)}% ${lvl}${d.fair ? '' : '  ⚠ unfair'}`).setColor(d.fair ? '#e8e9ef' : '#e74c3c');
        if (this.popupOpen) this.updatePopupReadout(d, lvl);
    }

    drawWheel() {
        const g = this.wheelGfx; g.clear();
        g.fillStyle(0x14143a); g.fillCircle(WHEEL_CX, WHEEL_CY, WHEEL_R);
        g.lineStyle(6, this.flash > 0 ? 0xe74c3c : 0x6c63ff, 1); g.strokeCircle(WHEEL_CX, WHEEL_CY, WHEEL_R);
        g.fillStyle(0x2a2a5a); g.fillCircle(WHEEL_CX, WHEEL_CY, WHEEL_R*0.16);
        for (const d of this.daggers) {
            const sa = d.angle + this.rotation;
            const tip = xy(WHEEL_CX, WHEEL_CY, WHEEL_R*0.90, sa);
            this.drawDagger(g, tip.x, tip.y, sa, 0xb5c2cf);
        }
        if (!this.flying) this.drawDagger(g, LAUNCH_X, LAUNCH_Y, 180, 0xb5c2cf);
    }

    drawFlying() {
        const g = this.flyGfx; g.clear();
        if (this.flying) this.drawDagger(g, LAUNCH_X, this.flying.y, 180, 0xb5c2cf);
    }

    drawDagger(g, tipX, tipY, dirDeg, col) {
        const rad = dirDeg * Math.PI / 180;
        const ax = Math.sin(rad), ay = -Math.cos(rad);
        const px = Math.cos(rad), py = Math.sin(rad);
        const P = (t, o) => ({ x: tipX + ax*t + px*o, y: tipY + ay*t + py*o });
        const L = DLEN, bw = W*0.014, sw = W*0.008, gw = W*0.028, kw = W*0.012;
        g.fillStyle(col);
        const a = P(0, 0), b = P(L*0.22, bw), c = P(L*0.22, -bw);
        g.fillTriangle(a.x, a.y, b.x, b.y, c.x, c.y);
        g.fillPoints([P(L*0.22, sw), P(L*0.77, sw), P(L*0.77, -sw), P(L*0.22, -sw)], true);
        g.fillStyle(0xf39c12);
        g.fillPoints([P(L*0.73, gw), P(L*0.80, gw), P(L*0.80, -gw), P(L*0.73, -gw)], true);
        g.fillPoints([P(L*0.80, kw), P(L*1.00, kw), P(L*1.00, -kw), P(L*0.80, -kw)], true);
    }

    // ── tuning pop-up ────────────────────────────────────────────
    openPopup() {
        if (this.popupOpen) return;
        this.popupOpen = true;
        const reg = o => { this.popupObjs.push(o); return o; };

        reg(this.add.rectangle(W/2, H/2, W, H, 0x000000, 0.72).setInteractive().setDepth(50));
        reg(this.add.rectangle(W/2, H/2, W*0.94, H*0.84, 0x17181f).setStrokeStyle(1.5, 0x3a3d4a).setDepth(51));
        reg(this.add.text(W*0.08, H*0.115, '⚙ DAGGER 飞刀挑战', { fontSize: `${W*0.040}px`, color: '#e8e9ef', fontStyle: 'bold' }).setOrigin(0, 0.5).setDepth(52));
        const close = reg(this.add.rectangle(W*0.90, H*0.115, W*0.10, H*0.045, 0x24262f).setStrokeStyle(1.5, 0x3a3d4a).setInteractive().setDepth(52));
        reg(this.add.text(W*0.90, H*0.115, '✕', { fontSize: `${W*0.040}px`, color: '#979aa8', fontStyle: 'bold' }).setOrigin(0.5).setDepth(53));
        close.on('pointerup', () => this.closePopup());

        this.knobRows = [
            { label: 'Spin Speed',   min: 40,  max: 300,  get: () => LIVE.spinSpeed,   set: v => LIVE.spinSpeed   = v,             fmt: v => `${Math.round(v)}°/s` },
            { label: 'Dagger Count', min: 2,   max: 14,   get: () => LIVE.daggerCount, set: v => LIVE.daggerCount = Math.round(v), fmt: v => `${Math.round(v)}` },
            { label: 'Dagger Width', min: 6,   max: 24,   get: () => LIVE.daggerDeg,   set: v => LIVE.daggerDeg   = v,             fmt: v => `${Math.round(v)}°` },
            { label: 'Fly Speed',    min: 600, max: 3500, get: () => LIVE.flySpeed,    set: v => LIVE.flySpeed    = v,             fmt: v => `${Math.round(v)} px/s` },
        ];
        let sy = H*0.185;
        for (const r of this.knobRows) { r._y = sy; this.mkSlider(reg, r, sy); sy += H*0.066; }

        this.popReadout = reg(this.add.text(W*0.08, H*0.475, '', { fontSize: `${W*0.026}px`, color: '#a0e0b0', lineSpacing: 5 }).setOrigin(0, 0).setDepth(52));

        // difficulty presets
        reg(this.add.text(W*0.08, H*0.565, 'DIFFICULTY', { fontSize: `${W*0.028}px`, color: '#979aa8', fontStyle: 'bold' }).setOrigin(0, 0.5).setDepth(52));
        this.presetBtn(reg, 'EASY',   W*0.42, H*0.565, 0x2ecc71, () => this.applyDifficulty('easy'));
        this.presetBtn(reg, 'NORMAL', W*0.62, H*0.565, 0xf1c40f, () => this.applyDifficulty('normal'));
        this.presetBtn(reg, 'HARD',   W*0.82, H*0.565, 0xe74c3c, () => this.applyDifficulty('hard'));

        // feel presets (holds difficulty via spin compensation)
        reg(this.add.text(W*0.08, H*0.635, 'FEEL', { fontSize: `${W*0.028}px`, color: '#979aa8', fontStyle: 'bold' }).setOrigin(0, 0.5).setDepth(52));
        this.presetBtn(reg, 'SNAPPY',   W*0.42, H*0.635, 0xf1c40f, () => this.applyFeel('snappy'));
        this.presetBtn(reg, 'NEUTRAL',  W*0.62, H*0.635, 0xf1c40f, () => this.applyFeel('neutral'));
        this.presetBtn(reg, 'DRAMATIC', W*0.82, H*0.635, 0xf1c40f, () => this.applyFeel('dramatic'));

        reg(this.add.text(W/2, H*0.86, 'difficulty = timing + prediction\nfeel compensates spin to hold difficulty', { fontSize: `${W*0.022}px`, color: '#979aa8', align: 'center', lineSpacing: 4 }).setOrigin(0.5).setDepth(52));
    }

    presetBtn(reg, label, x, y, col, cb) {
        const b = reg(this.add.rectangle(x, y, W*0.18, H*0.040, 0x24262f).setStrokeStyle(1.5, col).setInteractive().setDepth(52));
        reg(this.add.text(x, y, label, { fontSize: `${W*0.022}px`, color: '#' + col.toString(16).padStart(6,'0'), fontStyle: 'bold' }).setOrigin(0.5).setDepth(53));
        b.on('pointerup', cb);
    }

    closePopup() {
        this.popupOpen = false;
        this.popupObjs.forEach(o => o.destroy());
        this.popupObjs = []; this.knobRows = null; this.popReadout = null;
    }

    refreshKnobs() {   // move slider knobs to match LIVE after a preset
        if (!this.knobRows) return;
        for (const r of this.knobRows) if (r._knob && r._valTxt) {
            const x0 = W*0.42, x1 = W*0.80;
            r._knob.x = x0 + (Phaser.Math.Clamp(r.get(), r.min, r.max) - r.min)/(r.max - r.min) * (x1 - x0);
            r._valTxt.setText(r.fmt(r.get()));
        }
    }

    updatePopupReadout(d, lvl) {
        if (!this.popReadout) return;
        this.popReadout.setText(
            `Difficulty ${Math.round(d.D*100)}% ${lvl}${d.fair ? '' : '  ⚠ UNFAIR (window < reaction)'}\n` +
            `timing ${Math.round(Math.min(d.precision,1)*100)}% · prediction ${Math.round(d.prediction*100)}% (lead ${Math.round(d.leadDeg)}°)`
        );
        this.popReadout.setColor(d.fair ? '#979aa8' : '#e74c3c');
    }

    mkSlider(reg, r, y) {
        const x0 = W*0.40, x1 = W*0.72, trackW = x1 - x0;
        reg(this.add.text(W*0.08, y, r.label, { fontSize: `${W*0.027}px`, color: '#979aa8' }).setOrigin(0, 0.5).setDepth(52));
        const valTxt = reg(this.add.text(W*0.92, y, r.fmt(r.get()), { fontSize: `${W*0.027}px`, color: '#e8e9ef' }).setOrigin(1, 0.5).setDepth(52));
        const g = reg(this.add.graphics().setDepth(52));
        const DIRS = { 'Spin Speed':'harder','Dagger Count':'harder','Dagger Width':'neutral','Fly Speed':'feel' };
        const d = DIRS[r.label] || 'neutral';
        if (d==='harder'||d==='easier') {
            const lerp=(a,b,t)=>{const f=(s)=>[(s>>16)&255,(s>>8)&255,s&255];const A=f(a),B=f(b);return((A[0]+(B[0]-A[0])*t|0)<<16)|((A[1]+(B[1]-A[1])*t|0)<<8)|(A[2]+(B[2]-A[2])*t|0);};
            const CA=d==='harder'?0x2ecc71:0xe74c3c, CB=d==='harder'?0xe74c3c:0x2ecc71, N=18;
            for(let i=0;i<N;i++){g.lineStyle(6,lerp(CA,CB,(i+0.5)/N),1);g.lineBetween(x0+(x1-x0)*i/N,y,x0+(x1-x0)*(i+1)/N,y);}
        } else if (d==='feel') { g.lineStyle(4,0xf1c40f,0.4); g.lineBetween(x0,y,x1,y); }
        else { g.lineStyle(4,0x565a68); g.lineBetween(x0,y,x1,y); }
        if (d!=='neutral') { const M={harder:['harder ↑','#c8ccda'],easier:['easier ↑','#c8ccda'],feel:['FEEL','#f1c40f']};
            reg(this.add.text(W*0.39, y, M[d][0], { fontSize: `${W*0.019}px`, color: M[d][1], fontStyle: 'bold' }).setOrigin(1, 0.5).setDepth(53)); }
        const knob = reg(this.add.circle(x0 + (r.get() - r.min)/(r.max - r.min) * trackW, y, W*0.022, 0xf0a324).setStrokeStyle(2, 0x17181f).setInteractive({ draggable: true }).setDepth(54));
        this.input.setDraggable(knob);
        knob.on('drag', (ptr, dragX) => {
            const cx = Phaser.Math.Clamp(dragX, x0, x1); knob.x = cx;
            const v = r.min + (cx - x0)/trackW * (r.max - r.min);
            valTxt.setText(r.fmt(v)); r.set(v);
            if (r.label === 'Spin Speed') this.targetD = this.difficulty().D;   // manual spin redefines target
        });
        r._knob = knob; r._valTxt = valTxt;
    }
}

const config = {
    type: Phaser.WEBGL,
    width: windowWidth,
    height: windowHeight,
    transparent: false,
    backgroundColor: '#0d0d1a',
    canvas: window.canvas,
    scene: [LiveScene],
    input: { mouse: true, touch: true, keyboard: true },
};

new Phaser.Game(config);
