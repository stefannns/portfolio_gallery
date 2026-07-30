require('libs/tt-adapter.js');
const Phaser = require('libs/phaser.js');

const res = tt.getSystemInfoSync();
const windowWidth  = res.screenWidth;
const windowHeight = res.screenHeight;
const W = windowWidth, H = windowHeight;

// ─────────────────────────────────────────────────────────────────
// MEMORY MATCH (Concentration) — LIVE TUNING.
//   A rows×cols grid of face-down cards holds pairs of matching icons.
//   Flip two: match → they stay; mismatch → they flip back after Peek Time.
//   Difficulty here is COGNITIVE (recall span), not a reaction floor:
//   more cards = more pairs to hold in memory; longer peek = easier.
// ─────────────────────────────────────────────────────────────────
const LIVE = {
    rows:   4,     // grid rows
    cols:   4,     // grid columns
    peekMs: 700,   // how long a mismatched pair stays visible (ms)
};

const PANEL_BOTTOM = H * 0.22;                 // compact panel (3 sliders)
const SHAPES = ['circle', 'square', 'triangle', 'diamond', 'heart', 'flower'];
const ICON_COLORS = [0xff8fa3, 0xffc24d, 0x63d19b, 0x5ec8ff, 0xb79bff, 0xff9d6b];

class LiveScene extends Phaser.Scene {
    constructor() { super('LiveScene'); }

    create() {
        this.collapsed = false;

        this.add.rectangle(W/2, H/2, W, H, 0x161422).setDepth(0);
        this.cardGfx = this.add.graphics().setDepth(4);

        const tapZone = this.add.rectangle(W/2, (PANEL_BOTTOM + H)/2, W, H - PANEL_BOTTOM, 0x000000, 0)
            .setInteractive().setDepth(2);
        tapZone.on('pointerdown', (ptr) => this.tapAt(ptr.x, ptr.y));

        this.readout = this.add.text(W*0.05, PANEL_BOTTOM + H*0.012, '', {
            fontSize: `${W*0.026}px`, color: '#979aa8', lineSpacing: 5
        }).setOrigin(0, 0).setDepth(48);

        this.rows = 0; this.cols = 0;      // force first deal
        this.panelObjs = [];
        this.buildPanel();
        this.deal();
    }

    reg(o) { this.panelObjs.push(o); return o; }

    // ── deck ──────────────────────────────────────────────────────
    symStyle(i) {
        return { shape: SHAPES[i % SHAPES.length], color: ICON_COLORS[Math.floor(i / SHAPES.length) % ICON_COLORS.length] };
    }

    deal() {
        this.rows = Math.round(LIVE.rows);
        this.cols = Math.round(LIVE.cols);
        const cells = this.rows * this.cols;
        this.pairs = Math.floor(cells / 2);

        const syms = [];
        for (let i = 0; i < this.pairs; i++) { syms.push(i, i); }
        for (let i = syms.length - 1; i > 0; i--) {   // Fisher–Yates
            const j = Math.floor(Math.random() * (i + 1));
            const t = syms[i]; syms[i] = syms[j]; syms[j] = t;
        }

        this.cards = [];
        let k = 0;
        for (let r = 0; r < this.rows; r++) for (let c = 0; c < this.cols; c++) {
            if (k < syms.length) this.cards.push({ r, c, sym: syms[k++], state: 'down' });
            else                 this.cards.push({ r, c, sym: -1, state: 'blank' });   // odd cell out
        }

        this.first = null; this.second = null; this.busy = false;
        this.peekT = 0; this.matched = 0; this.winT = 0;
        this.layout();
    }

    layout() {
        const top = PANEL_BOTTOM + H*0.055, bot = H - H*0.03;
        const availW = W*0.92, availH = bot - top;
        const cell = Math.min(availW / this.cols, availH / this.rows);
        const gridW = cell * this.cols, gridH = cell * this.rows;
        const ox = (W - gridW)/2 + cell/2, oy = top + (availH - gridH)/2 + cell/2;
        for (const cd of this.cards) { cd.x = ox + cd.c*cell; cd.y = oy + cd.r*cell; cd.s = cell*0.88; }
    }

    tapAt(px, py) {
        if (this.busy || this.winT > 0) return;
        const cd = this.cards.find(c => c.state === 'down'
            && Math.abs(px - c.x) < c.s/2 && Math.abs(py - c.y) < c.s/2);
        if (!cd) return;
        cd.state = 'up';
        if (!this.first) { this.first = cd; return; }
        if (this.first.sym === cd.sym) {
            this.first.state = 'matched'; cd.state = 'matched';
            this.matched++; this.first = null;
            if (this.matched >= this.pairs) this.winT = 900;   // solved → re-deal shortly
        } else {
            this.second = cd; this.busy = true; this.peekT = LIVE.peekMs;
        }
    }

    update(time, delta) {
        if (Math.round(LIVE.rows) !== this.rows || Math.round(LIVE.cols) !== this.cols) this.deal();

        if (this.busy) {
            this.peekT -= delta;
            if (this.peekT <= 0) {
                this.first.state = 'down'; this.second.state = 'down';
                this.first = null; this.second = null; this.busy = false;
            }
        }
        if (this.winT > 0) { this.winT -= delta; if (this.winT <= 0) this.deal(); }

        this.drawCards();
        this.updateReadout();
    }

    // ── rendering ─────────────────────────────────────────────────
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
        this.readout.setText(
            `PAIRS ${this.pairs}   (${this.rows} × ${this.cols} cards)\n` +
            `flip two to match · matched ${this.matched}/${this.pairs}`);
    }

    // ── tune panel ────────────────────────────────────────────────
    buildPanel() {
        const HY = H*0.023, PB = this.collapsed ? H*0.054 : PANEL_BOTTOM;
        this.reg(this.add.rectangle(W/2, PB/2, W, PB, 0x17181f, 0.96).setDepth(50));
        this.reg(this.add.rectangle(W/2, PB, W, 1.5, 0x24262f).setDepth(50));
        this.mkCollapse(W*0.055, HY);
        const _t = this.reg(this.add.text(W*0.115, HY, '⚙ MEMORY', {
            fontSize: `${W*0.030}px`, color: '#e8e9ef', fontStyle: 'bold'
        }).setOrigin(0, 0.5).setDepth(60));
        this.reg(this.add.text(_t.x + _t.width + W*0.022, HY, '记忆翻牌', {
            fontSize: `${W*0.024}px`, color: '#6d7080'
        }).setOrigin(0, 0.5).setDepth(60));
        if (this.collapsed) return;

        const rows = [
            { key: 'rows', label: 'Rows',      min: 2,   max: 6,    get: () => LIVE.rows,   set: v => LIVE.rows   = Math.round(v), fmt: v => `${Math.round(v)}` },
            { key: 'cols', label: 'Columns',   min: 2,   max: 6,    get: () => LIVE.cols,   set: v => LIVE.cols   = Math.round(v), fmt: v => `${Math.round(v)}` },
            { key: 'peek', label: 'Peek Time', min: 300, max: 1500, get: () => LIVE.peekMs, set: v => LIVE.peekMs = v,             fmt: v => `${Math.round(v)}ms` },
        ];
        let sy = H*0.075;
        const gap = H*0.044;
        for (const r of rows) { this.mkSlider(r, sy); sy += gap; }
    }

    rebuildPanel() {
        this.panelObjs.forEach(o => o.destroy());
        this.panelObjs = [];
        this.buildPanel();
    }

    mkCollapse(x, y) {
        const b = this.reg(this.add.rectangle(x, y, W*0.075, H*0.030, 0x24262f)
            .setStrokeStyle(1.5, 0x3a3d4a).setInteractive().setDepth(60));
        this.reg(this.add.text(x, y, this.collapsed ? '▾' : '▴',
            { fontSize: `${W*0.026}px`, color: '#979aa8' }).setOrigin(0.5).setDepth(61));
        b.on('pointerup', () => {
            this.collapsed = !this.collapsed;
            if (this.readout) this.readout.y = (this.collapsed ? H*0.054 : PANEL_BOTTOM) + H*0.012;
            this.rebuildPanel();
        });
    }

    _dir(r) { return ({ 'Rows': 'harder', 'Columns': 'harder', 'Peek Time': 'easier' })[r.label] || 'neutral'; }
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
