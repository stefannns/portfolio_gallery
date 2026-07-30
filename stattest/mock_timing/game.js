require('libs/tt-adapter.js');
const Phaser = require('libs/phaser.js');

const res = tt.getSystemInfoSync();
const windowWidth  = res.screenWidth;
const windowHeight = res.screenHeight;
const W = windowWidth, H = windowHeight;

// ─────────────────────────────────────────────────────────────────
// PRECISION TIMING — LIVE TUNING.  Window model:
//   The needle is inside the target zone for  window = tolerance · sweepTime.
//   It is fair only if that window ≥ reaction time T_react.
//   → min tolerance = T_react / sweepTime
//   → max speed (min sweepTime) = T_react / tolerance
// ─────────────────────────────────────────────────────────────────
const LIVE = {
    sweepTime:     1.00,   // seconds for one left→right pass (smaller = faster = harder)
    toleranceFrac: 0.16,   // target zone width as fraction of the bar
};

const T_REACT  = 0.075;    // ANTICIPATORY precision (s) — tight; players time a known target
const EASY_TOL = 1.55, HARD_TOL = 1.05;     // ×tolerance-floor (wider = easier)
const EASY_SWP = 1.80, HARD_SWP = 1.20;     // ×min-sweepTime   (slower = easier)
const PANEL_BOTTOM = H * 0.37 - 82;   // panel is flush to the top
const BAR_Y  = (PANEL_BOTTOM + (H - 161)) / 2;
const BAR_L  = W * 0.10, BAR_R = W * 0.90, BAR_LEN = BAR_R - BAR_L;

class LiveScene extends Phaser.Scene {
    constructor() { super('LiveScene'); }

    create() {
        this.mode = 'tol';     // 'tol' (tolerance) | 'speed' (sweep time)
        this.derivedOK = true;
        this.collapsed = false;
        this.bandEasy = 0; this.bandHard = 0;
        this.bandT = 0.6; this.draggingRun = false;   // open a bit past Normal

        this.add.rectangle(W/2, H/2, W, H, 0x1a1a2e).setDepth(0);

        this.phase    = 0;     // 0..1 needle position
        this.dir      = 1;
        this.zoneC    = 0.5;   // zone center fraction
        this.cooldown = 0;
        this.result   = '';
        this.hits     = 0;
        this.misses   = 0;

        this.barGfx    = this.add.graphics().setDepth(3);
        this.needleGfx = this.add.graphics().setDepth(5);
        this.resultTxt = this.add.text(W/2, BAR_Y - H*0.10, '', { fontSize: `${W*0.07}px`, fontStyle: 'bold' }).setOrigin(0.5).setDepth(6);

        const tapZone = this.add.rectangle(W/2, (PANEL_BOTTOM + H)/2, W, H - PANEL_BOTTOM, 0x000000, 0).setInteractive().setDepth(2);
        tapZone.on('pointerdown', () => this.tap());
        this.add.text(W/2, BAR_Y + H*0.10, 'TAP when the needle is in the green zone', {
            fontSize: `${W*0.032}px`, color: '#ffffff'
        }).setOrigin(0.5).setAlpha(0.2).setDepth(2);
        if (this.input.keyboard) { this.input.keyboard.on('keydown-SPACE', () => this.tap()); }

        this.readout = this.add.text(W*0.05, PANEL_BOTTOM + H*0.012, '', {
            fontSize: `${W*0.026}px`, color: '#979aa8', lineSpacing: 5
        }).setOrigin(0, 0).setDepth(48);

        this.panelObjs = [];
        this.buildPanel();
        this.recompute();
        this.newRound();
    }

    reg(o) { this.panelObjs.push(o); return o; }

    // cute minimalist face — two eyes with a sparkle + a smile arc, sized to r
    face(g, cx, cy, r, o) {
        o = o || {};
        const ink = o.ink != null ? o.ink : 0x3a3340;
        const ex = r * (o.spread || 0.40), ey = cy - r * (o.eyeY || 0.10), er = r * (o.eyeR || 0.15);
        if (o.cheeks !== false) {
            g.fillStyle(o.cheek || 0xff7a9c, 0.32);
            g.fillCircle(cx - r*0.6, cy + r*0.22, r*0.16);
            g.fillCircle(cx + r*0.6, cy + r*0.22, r*0.16);
        }
        g.fillStyle(ink, 1);
        g.fillCircle(cx - ex, ey, er);
        g.fillCircle(cx + ex, ey, er);
        g.fillStyle(0xffffff, 0.95);
        g.fillCircle(cx - ex + er*0.32, ey - er*0.34, er*0.4);
        g.fillCircle(cx + ex + er*0.32, ey - er*0.34, er*0.4);
        if ((o.mouthR != null ? o.mouthR : 0.28) > 0.01) {
            g.lineStyle(Math.max(2, r*0.11), ink, 1);
            g.beginPath();
            g.arc(cx, cy + r*(o.mouthY != null ? o.mouthY : 0.2), r*(o.mouthR != null ? o.mouthR : 0.28), Math.PI*0.15, Math.PI*0.85);
            g.strokePath();
        }
    }


    // Collapse the tune panel to a header bar so the game underneath is unobstructed.
    mkCollapse(x, y) {
        const b = this.reg(this.add.rectangle(x, y, W*0.075, H*0.030, 0x24262f)
            .setStrokeStyle(1.5, 0x3a3d4a).setInteractive().setDepth(60));
        this.reg(this.add.text(x, y, this.collapsed ? '▾' : '▴',
            { fontSize: `${W*0.026}px`, color: '#979aa8' }).setOrigin(0.5).setDepth(61));
        b.on('pointerup', () => {
            this.collapsed = !this.collapsed;
            // keep the readout tucked under whichever edge the panel now ends at
            if (this.readout) this.readout.y = (this.collapsed ? H*0.054 : PANEL_BOTTOM) + H*0.012;
            this.rebuildPanel();
        });
    }


    _dir(r) { return ({"Sweep Time":"easier"})[r.label] || 'neutral'; }
    diffTrack(g, r, x0, x1, y) {
        const d = this._dir(r);
        const lerp = (a,b,t)=>{const f=(s)=>[(s>>16)&255,(s>>8)&255,s&255];const A=f(a),B=f(b);return((A[0]+(B[0]-A[0])*t|0)<<16)|((A[1]+(B[1]-A[1])*t|0)<<8)|(A[2]+(B[2]-A[2])*t|0);};
        if (d==='harder'||d==='easier') { const A=d==='harder'?0x2ecc71:0xe74c3c, B=d==='harder'?0xe74c3c:0x2ecc71, N=18;
            for(let i=0;i<N;i++){g.lineStyle(6,lerp(A,B,(i+0.5)/N),1);g.lineBetween(x0+(x1-x0)*i/N,y,x0+(x1-x0)*(i+1)/N,y);} }
        else if (d==='feel') { g.lineStyle(4,0xf1c40f,0.4); g.lineBetween(x0,y,x1,y); }
        else { g.lineStyle(4,0x565a68); g.lineBetween(x0,y,x1,y); }
    }
    dirTag(r, y) {
        const d=this._dir(r); if(d==='neutral') return;
        const M={harder:['harder ↑','#c8ccda'],easier:['easier ↑','#c8ccda'],feel:['FEEL','#f1c40f']};
        this.reg(this.add.text(W*0.415, y, M[d][0], {fontSize:`${W*0.019}px`,color:M[d][1],fontStyle:'bold'}).setOrigin(1,0.5).setDepth(62));
    }


    newRound() {
        const half = LIVE.toleranceFrac / 2;
        this.zoneC = half + Math.random() * (1 - 2*half);
        this.result = '';
    }

    tap() {
        if (this.cooldown > 0) return;
        const delta = Math.abs(this.phase - this.zoneC);
        if (delta <= LIVE.toleranceFrac / 2) { this.hits++;   this.result = 'HIT'; }
        else                                 { this.misses++; this.result = 'MISS'; }
        this.cooldown = 450;
    }

    recompute() {
        if (this.mode === 'tol') {
            const floor = T_REACT / LIVE.sweepTime;            // min tolerance fraction
            this.bandEasy = Phaser.Math.Clamp(floor * EASY_TOL, 0.04, 0.45);
            this.bandHard = Phaser.Math.Clamp(floor * HARD_TOL, 0.04, 0.45);
            this.derivedOK = (floor * HARD_TOL) <= 0.45;
            LIVE.toleranceFrac = this.bandEasy + (this.bandHard - this.bandEasy) * this.bandT;
        } else {
            const minSweep = T_REACT / LIVE.toleranceFrac;     // fastest fair sweep time
            this.bandEasy = Phaser.Math.Clamp(minSweep * EASY_SWP, 0.40, 2.50);
            this.bandHard = Phaser.Math.Clamp(minSweep * HARD_SWP, 0.40, 2.50);
            this.derivedOK = (minSweep * HARD_SWP) <= 2.50;
            LIVE.sweepTime = this.bandEasy + (this.bandHard - this.bandEasy) * this.bandT;
        }
    }

    update(time, delta) {
        const dt = Math.min(delta / 1000, 0.05);
        this.recompute();

        if (this.cooldown > 0) {
            this.cooldown -= delta;
            if (this.cooldown <= 0) this.newRound();
        } else {
            this.phase += this.dir * dt / LIVE.sweepTime;
            if (this.phase >= 1) { this.phase = 1; this.dir = -1; }
            if (this.phase <= 0) { this.phase = 0; this.dir =  1; }
        }

        this.drawBar();
        this.drawNeedle();
        this.resultTxt.setText(this.result).setColor(this.result === 'HIT' ? '#2ecc71' : '#e74c3c');
        this.refreshDerived();
        this.updateReadout();
    }

    drawBar() {
        const g = this.barGfx; g.clear();
        g.fillStyle(0x2a2a5a); g.fillRoundedRect(BAR_L, BAR_Y - H*0.021, BAR_LEN, H*0.042, H*0.021);
        const zx = BAR_L + (this.zoneC - LIVE.toleranceFrac/2) * BAR_LEN;
        const zw = LIVE.toleranceFrac * BAR_LEN;
        g.fillStyle(0x63d19b, 0.85); g.fillRoundedRect(zx, BAR_Y - H*0.021, zw, H*0.042, H*0.014);
    }

    drawNeedle() {
        const g = this.needleGfx; g.clear();
        const nx = BAR_L + this.phase * BAR_LEN;
        g.fillStyle(0xf0a324); g.fillRoundedRect(nx - W*0.005, BAR_Y - H*0.03, W*0.010, H*0.06, W*0.005);
        const hy = BAR_Y - H*0.05, hr = W*0.027;
        g.fillStyle(0x000000, 0.12); g.fillEllipse(nx, hy + hr*0.9, hr*1.3, hr*0.35);
        g.fillStyle(0xffc24d); g.fillCircle(nx, hy, hr);
        this.face(g, nx, hy, hr*0.92, { spread: 0.4, eyeY: 0.06, mouthR: 0.28, mouthY: 0.26, cheeks: false });
    }

    updateReadout() {
        let line1;
        if (!this.derivedOK) line1 = `⚠ Too hard — ${this.mode==='tol' ? 'sweep too fast for any zone' : 'zone too tiny for any speed'}`;
        else if (this.mode === 'tol') line1 = `TARGET ZONE  Hard ${(this.bandHard*100).toFixed(0)}% → Easy ${(this.bandEasy*100).toFixed(0)}% of bar`;
        else line1 = `SWEEP TIME  Easy ${this.bandEasy.toFixed(2)}s → Hard ${this.bandHard.toFixed(2)}s`;
        this.readout.setText(`${line1}\nwindow = ${(LIVE.toleranceFrac*LIVE.sweepTime*1000).toFixed(0)}ms (react ${T_REACT*1000}ms)    hit ${this.hits} · miss ${this.misses}`);
        this.readout.setColor(this.derivedOK ? '#979aa8' : '#e74c3c');
    }

    buildPanel() {
        const HY = H*0.023, PB = this.collapsed ? H*0.054 : PANEL_BOTTOM;
        this.reg(this.add.rectangle(W/2, (PB)/2, W, PB, 0x17181f, 0.96).setDepth(50));
        this.reg(this.add.rectangle(W/2, PB, W, 1.5, 0x24262f).setDepth(50));
        this.mkCollapse(W*0.055, HY);
        const _t = this.reg(this.add.text(W*0.115, HY, '⚙ TIMING', {
            fontSize: `${W*0.030}px`, color: '#e8e9ef', fontStyle: 'bold'
        }).setOrigin(0, 0.5).setDepth(60));
        const _cnTitle = this.reg(this.add.text(_t.x + _t.width + W*0.022, HY, '精准时机', {
            fontSize: `${W*0.024}px`, color: '#6d7080'
        }).setOrigin(0, 0.5).setDepth(60));
        if (this.collapsed) return;

        const modeStr = this.mode === 'tol' ? 'COMPUTE ▶ TARGET ZONE' : 'COMPUTE ▶ SWEEP TIME';
        const btn = this.reg(this.add.rectangle(W*0.97, HY, W*0.52, H*0.030, 0x24262f)
            .setStrokeStyle(1.5, 0x3a3d4a).setInteractive().setDepth(60).setOrigin(1, 0.5));
        this.reg(this.add.text(W*0.97 - W*0.26, HY, modeStr, {
            fontSize: `${W*0.025}px`, color: '#e8e9ef', fontStyle: 'bold'
        }).setOrigin(0.5).setDepth(61));
        btn.on('pointerup', () => { this.mode = this.mode === 'tol' ? 'speed' : 'tol'; this.rebuildPanel(); });

        const rows = [
            { key: 'speed', label: 'Sweep Time',  min: 0.40, max: 2.50, get: () => LIVE.sweepTime,     set: v => LIVE.sweepTime     = v, fmt: v => `${v.toFixed(2)}s` },
            { key: 'tol',   label: 'Target Zone',  min: 0.04, max: 0.45, get: () => LIVE.toleranceFrac, set: v => LIVE.toleranceFrac = v, fmt: v => `${(v*100).toFixed(0)}%` },
        ];
        const derivedKey = this.mode;

        let sy = H*0.090;
        const gap = H*0.052;
        for (const r of rows) {
            if (r.key === derivedKey) this.renderDerived(r, sy);
            else                      this.mkSlider(r, sy);
            sy += gap;
        }
    }

    rebuildPanel() {
        this.panelObjs.forEach(o => o.destroy());
        this.panelObjs = [];
        this.derived = null;
        this.buildPanel();
    }

    mkSlider(r, y) {
        const x0 = W*0.42, x1 = W*0.80, trackW = x1 - x0;
        this.reg(this.add.text(W*0.05, y, r.label, { fontSize: `${W*0.027}px`, color: '#979aa8' }).setOrigin(0, 0.5).setDepth(60));
        const valTxt = this.reg(this.add.text(W*0.965, y, r.fmt(r.get()), { fontSize: `${W*0.027}px`, color: '#e8e9ef' }).setOrigin(1, 0.5).setDepth(60));
        const g = this.reg(this.add.graphics().setDepth(59));
        this.diffTrack(g, r, x0, x1, y); this.dirTag(r, y);
        const knob = this.reg(this.add.circle(x0 + (r.get() - r.min)/(r.max - r.min) * trackW, y, W*0.020, 0xf0a324)
            .setStrokeStyle(2, 0x17181f).setInteractive({ draggable: true }).setDepth(61));
        this.input.setDraggable(knob);
        knob.on('drag', (ptr, dragX) => {
            const cx = Phaser.Math.Clamp(dragX, x0, x1);
            knob.x = cx;
            const v = r.min + (cx - x0)/trackW * (r.max - r.min);
            valTxt.setText(r.fmt(v));
            r.set(v);
        });
    }

    renderDerived(r, y) {
        const x0 = W*0.42, x1 = W*0.80;
        this.reg(this.add.text(W*0.05, y, r.label + '  ▸AUTO', { fontSize: `${W*0.027}px`, color: '#e8e9ef' }).setOrigin(0, 0.5).setDepth(60));
        const text = this.reg(this.add.text(W*0.965, y, '', { fontSize: `${W*0.024}px`, color: '#e8e9ef', fontStyle: 'bold' }).setOrigin(1, 0.5).setDepth(60));
        const g = this.reg(this.add.graphics().setDepth(59));        const handle  = this.reg(this.add.circle(x0, y, W*0.024, 0xffffff).setStrokeStyle(3, 0xf1014).setInteractive({ draggable: true }).setDepth(62));
        this.input.setDraggable(handle);
        const xOf = ratio => x0 + (Phaser.Math.Clamp(ratio, r.min, r.max) - r.min)/(r.max - r.min) * (x1 - x0);
        handle.on('dragstart', () => { this.draggingRun = true; });
        handle.on('dragend',   () => { this.draggingRun = false; });
        handle.on('drag', (ptr, dragX) => {
            const exPos = xOf(this.bandEasy), hxPos = xOf(this.bandHard);
            const lo = Math.min(exPos, hxPos), hi = Math.max(exPos, hxPos);
            const cx = Phaser.Math.Clamp(dragX, lo, hi);
            handle.x = cx;
            const sp = hxPos - exPos;
            this.bandT = Math.abs(sp) < 1 ? 0 : Phaser.Math.Clamp((cx - exPos)/sp, 0, 1);
        });
        this.derived = { r, g, text, handle, x0, x1, y };
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
        g.lineStyle(3, 0x2ecc71); g.lineBetween(ex, y - H*0.011, ex, y + H*0.011);
        g.lineStyle(3, 0xe74c3c); g.lineBetween(hx, y - H*0.011, hx, y + H*0.011);
        if (d.handle && !this.draggingRun) d.handle.x = xOf(d.r.get());
        d.text.setText(d.r.fmt(d.r.get()));
        d.text.setColor(this.derivedOK ? '#979aa8' : '#e74c3c');
    }
}

const config = {
    type: Phaser.WEBGL,
    width: windowWidth,
    height: windowHeight,
    transparent: false,
    backgroundColor: '#1a1a2e',
    canvas: window.canvas,
    scene: [LiveScene],
    input: { mouse: true, touch: true, keyboard: true },
};

new Phaser.Game(config);
