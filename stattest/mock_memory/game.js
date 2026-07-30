require('libs/tt-adapter.js');
const Phaser = require('libs/phaser.js');

// Widen the canvas: left control strip [0..PW] + native gameplay region [GX0..W].
const res = tt.getSystemInfoSync();
const H  = res.screenHeight;
const GW = res.screenWidth;                        // native gameplay width
const PW = Math.round(res.screenWidth * 0.52);     // left control strip
const GX0 = PW;
const W  = GX0 + GW;                               // total (landscape) canvas
const windowWidth = W, windowHeight = H;
if (typeof window !== 'undefined' && window.canvas && window.canvas.style) {
    window.canvas.width = W; window.canvas.height = H;
    const dh = 640, dw = Math.round(dh * W / H);
    window.canvas.style.width = dw + 'px'; window.canvas.style.height = dh + 'px';
}

// ─────────────────────────────────────────────────────────────────
// MEMORY MATCH (Concentration) — LIVE TUNING.  Cognitive (recall span):
// more cards = more pairs to remember; longer peek = easier.
// ─────────────────────────────────────────────────────────────────
const LIVE = { rows: 4, cols: 4, peekMs: 700 };
const SHAPES = ['circle', 'square', 'triangle', 'diamond', 'heart', 'flower'];
const ICON_COLORS = [0xff8fa3, 0xffc24d, 0x63d19b, 0x5ec8ff, 0xb79bff, 0xff9d6b];

class LiveScene extends Phaser.Scene {
    constructor() { super('LiveScene'); }

    create() {
        this.add.rectangle(W/2, H/2, W, H, 0x161422).setDepth(0);
        this.cardGfx = this.add.graphics().setDepth(4);

        const tapZone = this.add.rectangle(GX0 + GW/2, H/2, GW, H, 0x000000, 0).setInteractive().setDepth(2);
        tapZone.on('pointerdown', (ptr) => this.tapAt(ptr.x, ptr.y));

        this.readout = { setText: (t) => { if (typeof window !== 'undefined') window.__genreStats = t; return this.readout; }, setColor: () => this.readout, y: 0 };

        this.rows = 0; this.cols = 0;
        this.panelObjs = [];
        this.buildPanel();
        this.deal();
    }

    reg(o) { this.panelObjs.push(o); return o; }

    symStyle(i) { return { shape: SHAPES[i % SHAPES.length], color: ICON_COLORS[Math.floor(i / SHAPES.length) % ICON_COLORS.length] }; }

    deal() {
        this.rows = Math.round(LIVE.rows);
        this.cols = Math.round(LIVE.cols);
        this.pairs = Math.floor(this.rows * this.cols / 2);
        const syms = [];
        for (let i = 0; i < this.pairs; i++) syms.push(i, i);
        for (let i = syms.length - 1; i > 0; i--) { const j = Math.floor(Math.random()*(i+1)); const t = syms[i]; syms[i] = syms[j]; syms[j] = t; }
        this.cards = [];
        let k = 0;
        for (let r = 0; r < this.rows; r++) for (let c = 0; c < this.cols; c++)
            this.cards.push(k < syms.length ? { r, c, sym: syms[k++], state: 'down' } : { r, c, sym: -1, state: 'blank' });
        this.first = null; this.second = null; this.busy = false;
        this.peekT = 0; this.matched = 0; this.winT = 0;
        this.layout();
    }

    layout() {
        const top = H*0.05, bot = H - H*0.04;
        const availW = GW*0.9, availH = bot - top;
        const cell = Math.min(availW / this.cols, availH / this.rows);
        const gridW = cell * this.cols, gridH = cell * this.rows;
        const ox = GX0 + (GW - gridW)/2 + cell/2, oy = top + (availH - gridH)/2 + cell/2;
        for (const cd of this.cards) { cd.x = ox + cd.c*cell; cd.y = oy + cd.r*cell; cd.s = cell*0.88; }
    }

    tapAt(px, py) {
        if (this.busy || this.winT > 0) return;
        const cd = this.cards.find(c => c.state === 'down' && Math.abs(px - c.x) < c.s/2 && Math.abs(py - c.y) < c.s/2);
        if (!cd) return;
        cd.state = 'up';
        if (!this.first) { this.first = cd; return; }
        if (this.first.sym === cd.sym) {
            this.first.state = 'matched'; cd.state = 'matched'; this.matched++; this.first = null;
            if (this.matched >= this.pairs) this.winT = 900;
        } else { this.second = cd; this.busy = true; this.peekT = LIVE.peekMs; }
    }

    update(time, delta) {
        if (Math.round(LIVE.rows) !== this.rows || Math.round(LIVE.cols) !== this.cols) this.deal();
        if (this.busy) { this.peekT -= delta; if (this.peekT <= 0) { this.first.state = 'down'; this.second.state = 'down'; this.first = null; this.second = null; this.busy = false; } }
        if (this.winT > 0) { this.winT -= delta; if (this.winT <= 0) this.deal(); }
        this.drawCards();
        this.updateReadout();
    }

    drawCards() {
        const g = this.cardGfx; g.clear();
        for (const cd of this.cards) {
            if (cd.state === 'blank') continue;
            const s = cd.s, x = cd.x, y = cd.y, r = s*0.16;
            g.fillStyle(0x000000, 0.16); g.fillRoundedRect(x - s/2, y - s/2 + s*0.06, s, s, r);
            if (cd.state === 'down') {
                g.fillStyle(0x6c63ff); g.fillRoundedRect(x - s/2, y - s/2, s, s, r);
                g.fillStyle(0x8b7dff); g.fillRoundedRect(x - s/2 + s*0.12, y - s/2 + s*0.12, s*0.76, s*0.76, r*0.7);
                g.fillStyle(0xffffff, 0.85); g.fillCircle(x, y, s*0.10);
            } else {
                const matched = cd.state === 'matched';
                g.fillStyle(matched ? 0xdff7e6 : 0xfff4e0); g.fillRoundedRect(x - s/2, y - s/2, s, s, r);
                const st = this.symStyle(cd.sym);
                this.drawIcon(g, st.shape, x, y, s*0.6, st.color);
            }
        }
    }

    drawIcon(g, shape, cx, cy, s, col) {
        const h = s*0.5;
        g.fillStyle(col, 1);
        switch (shape) {
            case 'circle':   g.fillCircle(cx, cy, h*0.9); break;
            case 'square':   g.fillRoundedRect(cx - h*0.82, cy - h*0.82, h*1.64, h*1.64, h*0.3); break;
            case 'triangle': g.fillTriangle(cx, cy - h*0.92, cx - h*0.88, cy + h*0.72, cx + h*0.88, cy + h*0.72); break;
            case 'diamond':  g.fillPoints([{x:cx,y:cy-h},{x:cx+h*0.82,y:cy},{x:cx,y:cy+h},{x:cx-h*0.82,y:cy}], true); break;
            case 'heart':
                g.fillCircle(cx - h*0.4, cy - h*0.22, h*0.5); g.fillCircle(cx + h*0.4, cy - h*0.22, h*0.5);
                g.fillTriangle(cx - h*0.82, cy - h*0.02, cx + h*0.82, cy - h*0.02, cx, cy + h*0.92); break;
            case 'flower':
                for (let k = 0; k < 5; k++) { const a = k/5*Math.PI*2 - Math.PI/2; g.fillCircle(cx + Math.cos(a)*h*0.5, cy + Math.sin(a)*h*0.5, h*0.42); }
                g.fillStyle(0xffffff, 0.85); g.fillCircle(cx, cy, h*0.36); break;
        }
    }

    updateReadout() {
        this.readout.setText(`PAIRS ${this.pairs}   (${this.rows} × ${this.cols} cards)\nflip two to match · matched ${this.matched}/${this.pairs}`);
    }

    // ── control strip (left) ──────────────────────────────────────
    buildPanel() {
        this.reg(this.add.rectangle(PW/2, H/2, PW, H, 0x17181f, 0.98).setDepth(50));
        this.reg(this.add.rectangle(PW, H/2, 1.5, H, 0x24262f).setDepth(50));
        const _t = this.reg(this.add.text(PW*0.06, H*0.03, '⚙ MEMORY', { fontSize: `${GW*0.030}px`, color: '#e8e9ef', fontStyle: 'bold' }).setOrigin(0, 0.5).setDepth(60));
        this.reg(this.add.text(PW*0.06, H*0.058, '记忆翻牌', { fontSize: `${GW*0.024}px`, color: '#6d7080' }).setOrigin(0, 0.5).setDepth(60));

        const rows = [
            { label: 'Rows',      min: 2,   max: 6,    get: () => LIVE.rows,   set: v => LIVE.rows   = Math.round(v), fmt: v => `${Math.round(v)}`,   dir: 'harder' },
            { label: 'Columns',   min: 2,   max: 6,    get: () => LIVE.cols,   set: v => LIVE.cols   = Math.round(v), fmt: v => `${Math.round(v)}`,   dir: 'harder' },
            { label: 'Peek Time', min: 300, max: 1500, get: () => LIVE.peekMs, set: v => LIVE.peekMs = v,             fmt: v => `${Math.round(v)}ms`, dir: 'easier' },
        ];
        let cy = H*0.11;
        for (const r of rows) { this.mkSlider(r, cy); cy += H*0.052; }
    }

    diffTrack(g, r, x0, x1, y) {
        const d = r.dir || 'neutral';
        const lerp = (a,b,t)=>{const f=(s)=>[(s>>16)&255,(s>>8)&255,s&255];const A=f(a),B=f(b);return((A[0]+(B[0]-A[0])*t|0)<<16)|((A[1]+(B[1]-A[1])*t|0)<<8)|(A[2]+(B[2]-A[2])*t|0);};
        if (d==='harder'||d==='easier') { const A=d==='harder'?0x2ecc71:0xe74c3c, B=d==='harder'?0xe74c3c:0x2ecc71, N=18;
            for(let i=0;i<N;i++){g.lineStyle(6,lerp(A,B,(i+0.5)/N),1);g.lineBetween(x0+(x1-x0)*i/N,y,x0+(x1-x0)*(i+1)/N,y);} }
        else if (d==='feel') { g.lineStyle(5,0xf1c40f,0.4); g.lineBetween(x0,y,x1,y); }
        else { g.lineStyle(5,0x565a68); g.lineBetween(x0,y,x1,y); }
    }

    mkSlider(r, y) {
        const tx0 = PW*0.06, tx1 = PW*0.94, trackW = tx1 - tx0, ty = y + H*0.020;
        this.reg(this.add.text(tx0, y, r.label, { fontSize: `${GW*0.024}px`, color: '#9aa0b4' }).setOrigin(0, 0.5).setDepth(60));
        const valTxt = this.reg(this.add.text(tx1, y, r.fmt(r.get()), { fontSize: `${GW*0.024}px`, color: '#e8e9ef', fontStyle: 'bold' }).setOrigin(1, 0.5).setDepth(60));
        const g = this.reg(this.add.graphics().setDepth(59));
        this.diffTrack(g, r, tx0, tx1, ty);
        const knob = this.reg(this.add.circle(tx0 + (r.get() - r.min)/(r.max - r.min) * trackW, ty, GW*0.020, 0xf0a324).setStrokeStyle(2, 0x17181f).setInteractive({ draggable: true }).setDepth(61));
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
    backgroundColor: '#161422',
    canvas: window.canvas,
    scene: [LiveScene],
    input: { mouse: true, touch: true, keyboard: true },
};

new Phaser.Game(config);
