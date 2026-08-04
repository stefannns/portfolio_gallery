require('libs/tt-adapter.js');
const Phaser = require('libs/phaser.js');

// Widen canvas: left control strip [0..PW] + native gameplay region [GX0..W].
const res = tt.getSystemInfoSync();
const H  = res.screenHeight;
const GW = res.screenWidth;                        // native gameplay width
const PW = Math.round(res.screenWidth * 0.52);     // left control strip
const GX0 = PW;
const W  = GX0 + GW;
const windowWidth = W, windowHeight = H;
if (typeof window !== 'undefined' && window.canvas && window.canvas.style) {
    window.canvas.width = W; window.canvas.height = H;
    const dh = 640, dw = Math.round(dh * W / H);
    window.canvas.style.width = dw + 'px'; window.canvas.style.height = dh + 'px';
}
const GCX = GX0 + GW/2;   // gameplay centre x

// ─────────────────────────────────────────────────────────────────
// ARCHERY — 2.5D first-person down-range view. DRAG to aim, RELEASE to loose.
// SWAY wobbles the aim; WIND (2D) curves the arrow in flight.
// ─────────────────────────────────────────────────────────────────
const LIVE = { targetSize: 0.55, distance: 0.50, sway: 0.40, wind: 0.40, arrowSpeed: 0.70 };

const TARGET_CX = GCX;
const SKY_TOP   = H * 0.03;
const HORIZON_Y = H * 0.62;
const TARGET_CY = H * 0.50;
const BOW_X = GCX, BOW_Y = H * 0.86;
const LAUNCH_Y = BOW_Y - H * 0.05;
const ARR_TP_SCALE = 0.42;
const DRIFT_K = GW * 0.12;
const SWAY_MAX = GW * 0.09;
const AIM_X = GW * 0.30, AIM_Y = H * 0.10;

class LiveScene extends Phaser.Scene {
    constructor() { super('LiveScene'); }

    create() {
        this.add.rectangle(W/2, H/2, W, H, 0x0f1622).setDepth(0);
        this.sceneGfx  = this.add.graphics().setDepth(1);
        this.windTxt   = this.add.text(GX0 + GW*0.17, SKY_TOP + H*0.077, '', {
            fontSize: `${GW*0.030}px`, color: '#ffd27a', fontStyle: 'bold' }).setOrigin(0.5).setDepth(9);
        this.resultTxt = this.add.text(TARGET_CX, TARGET_CY - H*0.13, '', {
            fontSize: `${GW*0.05}px`, fontStyle: 'bold' }).setOrigin(0.5).setDepth(9);

        const tapZone = this.add.rectangle(GCX, H/2, GW, H, 0x000000, 0).setInteractive().setDepth(2);
        tapZone.on('pointerdown', (ptr) => { this.dragging = true; this.setAim(ptr); });
        this.input.on('pointermove', (ptr) => { if (this.dragging) this.setAim(ptr); });
        this.input.on('pointerup',   () => { if (this.dragging) { this.dragging = false; this.loose(); } });

        this.readout = { setText: (t) => { if (typeof window !== 'undefined') window.__genreStats = t; return this.readout; }, setColor: () => this.readout, y: 0 };

        this.baseAim = { x: 0, y: 0 };
        this.sway = { x: 0, y: 0 };
        this.eff  = { x: 0, y: 0 };
        this.swayT = 0;
        this.sp = [0, 1, 2, 3].map(() => Math.random() * Math.PI * 2);
        this.dragging = false;
        this.flying = null;
        this.cooldown = 0;
        this.result = '';
        this.hitMark = null;
        this.shots = 0; this.bull = 0; this.hits = 0;
        this.pickWind();

        this.panelObjs = [];
        this.buildPanel();
    }

    reg(o) { this.panelObjs.push(o); return o; }

    setAim(ptr) {
        this.baseAim.x = Phaser.Math.Clamp(ptr.x - TARGET_CX, -AIM_X, AIM_X);
        this.baseAim.y = Phaser.Math.Clamp(ptr.y - TARGET_CY, -AIM_Y, AIM_Y);
    }

    shotParams() {
        const dn = Phaser.Math.Clamp((LIVE.distance - 0.3)/0.7, 0, 1);
        const baseR = GW * (0.09 + 0.14 * Phaser.Math.Clamp((LIVE.targetSize - 0.3)/0.7, 0, 1));
        const apparentR = baseR * (1 - 0.28 * dn);
        const T = (0.7 + 1.2 * dn) / (0.4 + LIVE.arrowSpeed);
        return { apparentR, T };
    }

    pickWind() {
        this.windAng = Math.random() * Math.PI * 2;
        this.windMag = LIVE.wind * (0.8 + 0.4 * Math.random());
    }

    loose() {
        if (this.flying || this.cooldown > 0) return;
        const { apparentR, T } = this.shotParams();
        const gain = this.windMag * DRIFT_K * T * T;
        const driftX = Math.cos(this.windAng) * gain;
        const driftY = Math.sin(this.windAng) * gain;
        this.flying = { t: 0, T, aimX: this.eff.x, aimY: this.eff.y, driftX, driftY, apparentR };
    }

    posAt(p, sh) {
        const ease = p * (2 - p);
        const y = BOW_Y + ((TARGET_CY + sh.aimY) - BOW_Y) * ease + sh.driftY * p * p;
        const x = TARGET_CX + sh.aimX * p + sh.driftX * p * p;
        const scale = 1 + (ARR_TP_SCALE - 1) * p;
        return { x, y, scale };
    }

    update(time, delta) {
        const dt = Math.min(delta / 1000, 0.05);
        if (this.cooldown > 0) this.cooldown -= delta;
        this.swayT += dt;
        const m = LIVE.sway * SWAY_MAX;
        this.sway.x = m * (Math.sin(this.swayT*2.3 + this.sp[0])*0.6 + Math.sin(this.swayT*3.7 + this.sp[1])*0.4);
        this.sway.y = m * (Math.sin(this.swayT*2.9 + this.sp[2])*0.6 + Math.sin(this.swayT*1.7 + this.sp[3])*0.4);
        this.eff.x = Phaser.Math.Clamp(this.baseAim.x + this.sway.x, -AIM_X, AIM_X);
        this.eff.y = Phaser.Math.Clamp(this.baseAim.y + this.sway.y, -AIM_Y, AIM_Y);
        if (this.flying) { this.flying.t += dt; if (this.flying.t >= this.flying.T) this.resolve(); }
        this.draw();
        this.updateReadout();
    }

    resolve() {
        const sh = this.flying;
        const landX = sh.aimX + sh.driftX, landY = sh.aimY + sh.driftY;
        const dist = Math.hypot(landX, landY);
        this.shots++;
        if (dist < sh.apparentR * 0.28)      { this.result = 'BULLSEYE!'; this.bull++; this.hits++; }
        else if (dist < sh.apparentR)         { this.result = 'HIT';       this.hits++; }
        else                                  { this.result = 'MISS'; }
        this.hitMark = { x: TARGET_CX + landX, y: TARGET_CY + landY };
        this.flying = null;
        this.cooldown = 650;
        this.pickWind();
    }

    draw() {
        const g = this.sceneGfx; g.clear();
        const sh = this.shotParams();

        g.fillStyle(0x8fc9e8); g.fillRect(GX0, SKY_TOP, GW, HORIZON_Y - SKY_TOP);
        g.fillStyle(0x9bd6a6); g.fillPoints([
            {x: GX0 + GW*0.34, y: HORIZON_Y}, {x: GX0 + GW*0.66, y: HORIZON_Y}, {x: W, y: H}, {x: GX0, y: H}], true);
        g.fillStyle(0x74c98a, 0.6); g.fillPoints([
            {x: GX0 + GW*0.40, y: HORIZON_Y}, {x: GX0 + GW*0.60, y: HORIZON_Y}, {x: GX0 + GW*0.78, y: H}, {x: GX0 + GW*0.22, y: H}], true);

        this.drawTarget(g, sh.apparentR);
        if (this.hitMark) { g.fillStyle(0x2d2d3a); g.fillCircle(this.hitMark.x, this.hitMark.y, Math.max(3, sh.apparentR*0.09)); }

        if (this.flying) {
            const p = this.flying.t / this.flying.T;
            const a = this.posAt(p, this.flying);
            const vx = this.flying.aimX + 2 * this.flying.driftX * p;
            const lean = Phaser.Math.Clamp(Math.atan2(vx, (BOW_Y - TARGET_CY) * 1.6), -0.20, 0.20);
            this.drawArrow(g, a.x, a.y, a.scale, -Math.PI/2 + lean);
        }

        this.drawBow(g);
        this.drawReticle(g, sh.apparentR);
        this.drawWind(g);

        this.resultTxt.setText(this.cooldown > 0 ? this.result : '')
            .setColor(this.result === 'MISS' ? '#e74c3c' : '#2ecc71');
    }

    drawWind(g) {
        const ax = GX0 + GW*0.17, ay = SKY_TOP + H*0.032;
        this.windTxt.setPosition(ax, ay + H*0.045);
        if (this.windMag < 0.03) { this.windTxt.setText('WIND — calm'); return; }
        const c = Math.cos(this.windAng), s = Math.sin(this.windAng);
        const len = GW*0.045 + GW*0.05 * this.windMag;
        const tx = ax + c*len, ty = ay + s*len, bx = ax - c*len*0.7, by = ay - s*len*0.7;
        g.lineStyle(GW*0.013, 0xffd27a, 1); g.lineBetween(bx, by, tx, ty);
        const nx = -s, ny = c, hw = GW*0.021;
        g.fillStyle(0xffd27a);
        g.fillTriangle(tx + c*GW*0.03, ty + s*GW*0.03, tx + nx*hw, ty + ny*hw, tx - nx*hw, ty - ny*hw);
        this.windTxt.setText(`WIND ${Math.round(this.windMag*100)}`);
    }

    drawTarget(g, R) {
        const x = TARGET_CX, y = TARGET_CY;
        g.fillStyle(0x000000, 0.14); g.fillEllipse(x, HORIZON_Y + R*0.14, R*1.7, R*0.4);
        g.fillStyle(0x8a6a44); g.fillRect(x - R*0.06, y, R*0.12, HORIZON_Y - y + R*0.1);
        const rings = [[1.0, 0xf4f1ea], [0.74, 0x2d2d3a], [0.52, 0x5ec8ff], [0.3, 0xff8fa3], [0.13, 0xffc24d]];
        for (const [k, col] of rings) { g.fillStyle(col); g.fillCircle(x, y, R*k); }
        g.lineStyle(Math.max(1.5, R*0.03), 0xffffff, 0.5); g.strokeCircle(x, y, R);
        g.fillStyle(0x3a3340); g.fillCircle(x - R*0.05, y - R*0.02, R*0.028); g.fillCircle(x + R*0.05, y - R*0.02, R*0.028);
    }

    drawReticle(g, R) {
        if (this.flying) return;
        const x = TARGET_CX + this.eff.x, y = TARGET_CY + this.eff.y;
        const steady = Math.hypot(this.sway.x, this.sway.y) < SWAY_MAX * 0.18;
        g.lineStyle(Math.max(2, R*0.05), steady ? 0x2ecc71 : 0xffffff, 0.9);
        g.strokeCircle(x, y, R*0.5);
        g.lineBetween(x - R*0.72, y, x - R*0.2, y); g.lineBetween(x + R*0.2, y, x + R*0.72, y);
        g.lineBetween(x, y - R*0.72, x, y - R*0.2); g.lineBetween(x, y + R*0.2, x, y + R*0.72);
    }

    drawArrow(g, x, y, scale, ang) {
        const L = H*0.075 * scale, c = Math.cos(ang), s = Math.sin(ang);
        const tipX = x + c*L*0.5, tipY = y + s*L*0.5, tailX = x - c*L*0.5, tailY = y - s*L*0.5;
        const nx = -s, ny = c, hw = L*0.06;
        g.fillStyle(0xba9b73);
        g.fillPoints([{x:tailX+nx*hw,y:tailY+ny*hw},{x:tipX+nx*hw,y:tipY+ny*hw},{x:tipX-nx*hw,y:tipY-ny*hw},{x:tailX-nx*hw,y:tailY-ny*hw}], true);
        g.fillStyle(0xd9dde3);
        g.fillTriangle(tipX + c*L*0.18, tipY + s*L*0.18, tipX + nx*hw*2.4, tipY + ny*hw*2.4, tipX - nx*hw*2.4, tipY - ny*hw*2.4);
        g.fillStyle(0xff8fa3);
        g.fillTriangle(tailX, tailY, tailX - c*L*0.18 + nx*hw*2.6, tailY - s*L*0.18 + ny*hw*2.6, tailX - c*L*0.18, tailY - s*L*0.18);
        g.fillTriangle(tailX, tailY, tailX - c*L*0.18 - nx*hw*2.6, tailY - s*L*0.18 - ny*hw*2.6, tailX - c*L*0.18, tailY - s*L*0.18);
    }

    drawBow(g) {
        const x = BOW_X, r = GW*0.20, cy = BOW_Y - r*0.30;
        g.lineStyle(GW*0.018, 0x8a5a2a, 1);
        g.beginPath(); g.arc(x, cy, r, Math.PI*0.32, Math.PI*0.68); g.strokePath();
        const a0 = Math.PI*0.32, a1 = Math.PI*0.68;
        g.lineStyle(GW*0.004, 0xe8e9ef, 0.8);
        g.lineBetween(x + Math.cos(a0)*r, cy + Math.sin(a0)*r, x + Math.cos(a1)*r, cy + Math.sin(a1)*r);
        if (!this.flying) this.drawArrow(g, x, LAUNCH_Y, 1.0, -Math.PI/2);
    }

    updateReadout() {
        const sh = this.shotParams();
        const drift = LIVE.wind * DRIFT_K * sh.T * sh.T;
        const swayPx = Math.round(LIVE.sway * SWAY_MAX);
        this.readout.setText(
            `TARGET Ø ${Math.round(sh.apparentR*2)}px · sway ±${swayPx}px · WIND ±${Math.round(drift)}px\n` +
            `drag to aim · release to loose · bull ${this.bull} · hit ${this.hits} · shots ${this.shots}`);
    }

    // ── control strip (left) ──────────────────────────────────────
    buildPanel() {
        this.reg(this.add.rectangle(PW/2, H/2, PW, H, 0x17181f, 0.98).setDepth(50));
        this.reg(this.add.rectangle(PW, H/2, 1.5, H, 0x24262f).setDepth(50));
        const _t = this.reg(this.add.text(PW*0.06, H*0.03, '⚙ ARCHERY', { fontSize: `${GW*0.030}px`, color: '#e8e9ef', fontStyle: 'bold' }).setOrigin(0, 0.5).setDepth(60));
        this.reg(this.add.text(PW*0.06, H*0.058, '弓箭射击', { fontSize: `${GW*0.024}px`, color: '#6d7080' }).setOrigin(0, 0.5).setDepth(60));

        const rows = [
            { label: 'Target Size', min: 0.3, max: 1.0, get: () => LIVE.targetSize, set: v => LIVE.targetSize = v, fmt: v => `${Math.round(v*100)}%`, dir: 'easier' },
            { label: 'Distance',    min: 0.3, max: 1.0, get: () => LIVE.distance,   set: v => LIVE.distance   = v, fmt: v => `${Math.round(v*100)}%`, dir: 'harder' },
            { label: 'Sway',        min: 0.0, max: 1.0, get: () => LIVE.sway,       set: v => LIVE.sway       = v, fmt: v => `${Math.round(v*100)}`,  dir: 'harder' },
            { label: 'Wind',        min: 0.0, max: 1.0, get: () => LIVE.wind,       set: v => LIVE.wind       = v, fmt: v => `${Math.round(v*100)}`,  dir: 'feel' },
            { label: 'Arrow Speed', min: 0.3, max: 1.3, get: () => LIVE.arrowSpeed, set: v => LIVE.arrowSpeed = v, fmt: v => `${v.toFixed(2)}`,      dir: 'feel' },
        ];
        let cy = H*0.11;
        for (const r of rows) { this.mkSlider(r, cy); cy += H*0.060; }
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
        const tx0 = PW*0.06, tx1 = PW*0.94, trackW = tx1 - tx0, ty = y + H*0.020;
        this.reg(this.add.text(tx0, y, r.label, { fontSize: `${GW*0.024}px`, color: '#9aa0b4' }).setOrigin(0, 0.5).setDepth(60));
        const valTxt = this.reg(this.add.text(tx1, y, r.fmt(r.get()), { fontSize: `${GW*0.024}px`, color: '#e8e9ef', fontStyle: 'bold' }).setOrigin(1, 0.5).setDepth(60));
        const g = this.reg(this.add.graphics().setDepth(59));
        this.diffTrack(g, r, tx0, tx1, ty);
        const knob = this.reg(this.add.circle(tx0 + (r.get() - r.min)/(r.max - r.min) * trackW, ty, GW*0.022, 0xd4f24e).setStrokeStyle(2.5, 0x121319).setInteractive({ draggable: true }).setDepth(61));
        this.input.setDraggable(knob);
        knob.on('drag', (ptr, dragX) => {
            const cx = Phaser.Math.Clamp(dragX, tx0, tx1); knob.x = cx;
            const v = r.min + (cx - tx0)/trackW * (r.max - r.min);
            valTxt.setText(r.fmt(v)); r.set(v);
        });
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
