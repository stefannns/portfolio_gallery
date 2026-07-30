require('libs/tt-adapter.js');
const Phaser = require('libs/phaser.js');

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
const WHEEL_CX = GCX, WHEEL_CY = H*0.30, WHEEL_R = GW*0.26;
const LAUNCH_X = GCX, LAUNCH_Y = H*0.80;
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

        this.add.rectangle(W/2, H/2, W, H, 0x161a26).setDepth(0);
        this.add.rectangle(GCX, H/2, GW, H, 0x0d0d1a).setDepth(0.4);
        this.wheelGfx = this.add.graphics().setDepth(4);
        this.flyGfx   = this.add.graphics().setDepth(5);

        const tapZone = this.add.rectangle(GCX, H/2, GW, H, 0x000000, 0).setInteractive().setDepth(1);
        tapZone.on('pointerdown', () => this.throwDagger());
        if (this.input.keyboard) this.input.keyboard.on('keydown-SPACE', () => this.throwDagger());

        this.hud = this.add.text(0, 0, '', { fontSize: `${GW*0.04}px` }).setVisible(false);
        this.diffHud = this.add.text(0, 0, '', { fontSize: `${GW*0.034}px` }).setVisible(false);

        this.panelObjs = [];
        this.buildPanel();
        this.reseed(Math.round(LIVE.daggerCount));
    }

    reseed(n) {
        this.baseN = n; this.daggers = [];
        for (let i = 0; i < n; i++) this.daggers.push({ angle: norm(i * 360 / n + Math.random()*8) });
    }

    throwDagger() {
        if (this.flash > 0 || this.flying) return;
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
        if (typeof window !== 'undefined') window.__genreStats = `stuck ${this.stuck} · fails ${this.fails}\nDifficulty ${Math.round(d.D*100)}% ${lvl}${d.fair ? '' : '  ⚠ unfair'}`;
        this.updatePopupReadout(d, lvl);
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
        const L = DLEN, bw = GW*0.014, sw = GW*0.008, gw = GW*0.028, kw = GW*0.012;
        g.fillStyle(col);
        const a = P(0, 0), b = P(L*0.22, bw), c = P(L*0.22, -bw);
        g.fillTriangle(a.x, a.y, b.x, b.y, c.x, c.y);
        g.fillPoints([P(L*0.22, sw), P(L*0.77, sw), P(L*0.77, -sw), P(L*0.22, -sw)], true);
        g.fillStyle(0xf39c12);
        g.fillPoints([P(L*0.73, gw), P(L*0.80, gw), P(L*0.80, -gw), P(L*0.73, -gw)], true);
        g.fillPoints([P(L*0.80, kw), P(L*1.00, kw), P(L*1.00, -kw), P(L*0.80, -kw)], true);
    }

    // ── tuning strip (persistent, left) ──────────────────────────
    buildPanel() {
        const reg = o => { this.panelObjs.push(o); return o; };
        reg(this.add.rectangle(PW/2, H/2, PW, H, 0x17181f, 0.98).setDepth(50));
        reg(this.add.rectangle(PW, H/2, 1.5, H, 0x24262f).setDepth(50));
        const _t = reg(this.add.text(PW*0.06, H*0.03, '⚙ DAGGER', { fontSize: `${GW*0.030}px`, color: '#e8e9ef', fontStyle: 'bold' }).setOrigin(0, 0.5).setDepth(60));
        reg(this.add.text(_t.x + _t.width + GW*0.02, H*0.03, '飞刀挑战', { fontSize: `${GW*0.022}px`, color: '#6d7080' }).setOrigin(0, 0.5).setDepth(60));

        this.knobRows = [
            { label: 'Spin Speed',   min: 40,  max: 300,  get: () => LIVE.spinSpeed,   set: v => LIVE.spinSpeed   = v,             fmt: v => `${Math.round(v)}°/s` },
            { label: 'Dagger Count', min: 2,   max: 14,   get: () => LIVE.daggerCount, set: v => LIVE.daggerCount = Math.round(v), fmt: v => `${Math.round(v)}` },
            { label: 'Dagger Width', min: 6,   max: 24,   get: () => LIVE.daggerDeg,   set: v => LIVE.daggerDeg   = v,             fmt: v => `${Math.round(v)}°` },
            { label: 'Fly Speed',    min: 600, max: 3500, get: () => LIVE.flySpeed,    set: v => LIVE.flySpeed    = v,             fmt: v => `${Math.round(v)} px/s` },
        ];
        let sy = H*0.11;
        for (const r of this.knobRows) { r._y = sy; this.mkSlider(reg, r, sy); sy += H*0.062; }

        sy += H*0.006;
        this.popReadout = reg(this.add.text(PW*0.06, sy, '', { fontSize: `${GW*0.02}px`, color: '#a0e0b0', lineSpacing: 4, wordWrap: { width: PW*0.88 } }).setOrigin(0, 0).setDepth(60));

        sy += H*0.085;
        reg(this.add.text(PW*0.06, sy, 'DIFFICULTY', { fontSize: `${GW*0.022}px`, color: '#979aa8', fontStyle: 'bold' }).setOrigin(0, 0.5).setDepth(60));
        sy += H*0.038;
        this.presetBtn(reg, 'EASY',   PW*0.20, sy, 0x2ecc71, () => this.applyDifficulty('easy'));
        this.presetBtn(reg, 'NORMAL', PW*0.5,  sy, 0xf1c40f, () => this.applyDifficulty('normal'));
        this.presetBtn(reg, 'HARD',   PW*0.80, sy, 0xe74c3c, () => this.applyDifficulty('hard'));

        sy += H*0.052;
        reg(this.add.text(PW*0.06, sy, 'FEEL', { fontSize: `${GW*0.022}px`, color: '#979aa8', fontStyle: 'bold' }).setOrigin(0, 0.5).setDepth(60));
        sy += H*0.038;
        this.presetBtn(reg, 'SNAPPY',   PW*0.20, sy, 0xf1c40f, () => this.applyFeel('snappy'));
        this.presetBtn(reg, 'NEUTRAL',  PW*0.5,  sy, 0xf1c40f, () => this.applyFeel('neutral'));
        this.presetBtn(reg, 'DRAMATIC', PW*0.80, sy, 0xf1c40f, () => this.applyFeel('dramatic'));

        sy += H*0.058;
        reg(this.add.text(PW*0.5, sy, 'difficulty = timing + prediction\nfeel compensates spin to hold difficulty', { fontSize: `${GW*0.018}px`, color: '#6d7080', align: 'center', lineSpacing: 3, wordWrap: { width: PW*0.9 } }).setOrigin(0.5, 0).setDepth(60));
    }

    presetBtn(reg, label, x, y, col, cb) {
        const b = reg(this.add.rectangle(x, y, PW*0.26, H*0.032, 0x24262f).setStrokeStyle(1.5, col).setInteractive().setDepth(60));
        reg(this.add.text(x, y, label, { fontSize: `${GW*0.018}px`, color: '#' + col.toString(16).padStart(6,'0'), fontStyle: 'bold' }).setOrigin(0.5).setDepth(61));
        b.on('pointerup', cb);
    }

    refreshKnobs() {   // move slider knobs to match LIVE after a preset
        if (!this.knobRows) return;
        for (const r of this.knobRows) if (r._knob && r._valTxt) {
            const x0 = PW*0.06, x1 = PW*0.94;
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
        const x0 = PW*0.06, x1 = PW*0.94, trackW = x1 - x0, ty = y + H*0.02;
        reg(this.add.text(x0, y, r.label, { fontSize: `${GW*0.024}px`, color: '#9aa0b4' }).setOrigin(0, 0.5).setDepth(60));
        const valTxt = reg(this.add.text(x1, y, r.fmt(r.get()), { fontSize: `${GW*0.024}px`, color: '#e8e9ef' }).setOrigin(1, 0.5).setDepth(60));
        const g = reg(this.add.graphics().setDepth(59));
        const DIRS = { 'Spin Speed':'harder','Dagger Count':'harder','Dagger Width':'neutral','Fly Speed':'feel' };
        const d = DIRS[r.label] || 'neutral';
        if (d==='harder'||d==='easier') {
            const lerp=(a,b,t)=>{const f=(s)=>[(s>>16)&255,(s>>8)&255,s&255];const A=f(a),B=f(b);return((A[0]+(B[0]-A[0])*t|0)<<16)|((A[1]+(B[1]-A[1])*t|0)<<8)|(A[2]+(B[2]-A[2])*t|0);};
            const CA=d==='harder'?0x2ecc71:0xe74c3c, CB=d==='harder'?0xe74c3c:0x2ecc71, N=18;
            for(let i=0;i<N;i++){g.lineStyle(6,lerp(CA,CB,(i+0.5)/N),1);g.lineBetween(x0+(x1-x0)*i/N,ty,x0+(x1-x0)*(i+1)/N,ty);}
        } else if (d==='feel') { g.lineStyle(5,0xf1c40f,0.4); g.lineBetween(x0,ty,x1,ty); }
        else { g.lineStyle(5,0x565a68); g.lineBetween(x0,ty,x1,ty); }
        const knob = reg(this.add.circle(x0 + (r.get() - r.min)/(r.max - r.min) * trackW, ty, GW*0.02, 0xf0a324).setStrokeStyle(2, 0x17181f).setInteractive({ draggable: true }).setDepth(61));
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
