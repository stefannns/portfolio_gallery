require('libs/tt-adapter.js');
const Phaser = require('libs/phaser.js');

const res = tt.getSystemInfoSync();
const windowWidth  = res.screenWidth;
const windowHeight = res.screenHeight;
const W = windowWidth, H = windowHeight;

// ─────────────────────────────────────────────────────────────────
// WHACK-A-MOLE — LIVE TUNING.  Reaction model:
//   A mole is visible for appearMs. It is fair only if that exceeds the time
//   to spot + reach + tap it (more simultaneous moles ⇒ more scan time).
//   → min appearMs = T_react · (1 + 0.25·(simultaneous − 1))
// ─────────────────────────────────────────────────────────────────
const LIVE = {
    appearMs:      1100,   // how long a mole stays up (ms)
    spawnMs:       800,    // interval between new moles (ms)
    simultaneous:  1,      // how many moles up at once
    holeRatio:     0.20,   // hole radius (×W)
};

const T_REACT  = 360;      // base reaction time (ms)
const EASY_DUR = 2.0, HARD_DUR = 1.25;     // ×appear-floor (longer = easier)
const PANEL_BOTTOM = H * 0.37 - 82;   // panel is flush to the top
const COLS = 3, ROWS = 3;

class LiveScene extends Phaser.Scene {
    constructor() { super('LiveScene'); }

    create() {
        this.derivedOK = true;
        this.collapsed = false;
        this.initCharacter(6);
        this.bandEasy = 0; this.bandHard = 0;
        this.bandT = 0; this.draggingRun = false;

        this.add.rectangle(W/2, H/2, W, H, 0x2d1b00).setDepth(0);

        this.holes = [];
        const gx0 = W*0.18, gy0 = PANEL_BOTTOM + (H - 161 - PANEL_BOTTOM)*0.22;
        const dx = (W*0.64)/(COLS-1), dy = (H - 161 - gy0)*0.42;
        for (let r = 0; r < ROWS; r++) for (let c = 0; c < COLS; c++) {
            this.holes.push({ x: gx0 + c*dx, y: gy0 + r*dy, active: false, timer: 0, hitFlash: 0 });
        }
        this.sinceSpawn = 1e9;
        this.hits = 0;
        this.misses = 0;

        this.holeGfx = this.add.graphics().setDepth(4);

        const tapZone = this.add.rectangle(W/2, (PANEL_BOTTOM + H)/2, W, H - PANEL_BOTTOM, 0x000000, 0).setInteractive().setDepth(2);
        tapZone.on('pointerdown', (ptr) => this.whack(ptr.x, ptr.y));

        this.readout = this.add.text(W*0.05, PANEL_BOTTOM + H*0.012, '', {
            fontSize: `${W*0.026}px`, color: '#979aa8', lineSpacing: 5
        }).setOrigin(0, 0).setDepth(48);

        this.panelObjs = [];
        this.buildPanel();
        this.recompute();
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


    // ── custom character ─────────────────────────────────────────
    // A PNG uploaded from the Genre Lab header replaces the drawn character.
    // Stored as a data URL in localStorage under genrelab:char:<gameId>.
    initCharacter(depth) {
        this.charSprites = [];
        let data = null;
        try { data = localStorage.getItem('genrelab:char:mock_whack'); } catch (e) {}
        if (!data) return;
        const key = 'usrchar_mock_whack';
        const make = () => {
            for (let i = 0; i < 9; i++)
                this.charSprites.push(this.add.image(-9999, -9999, key).setDepth(depth).setVisible(false));
        };
        if (this.textures.exists(key)) { make(); return; }
        this.textures.on('addtexture', k => { if (k === key) make(); });
        this.textures.addBase64(key, data);
    }
    // Place sprite i inside a w×h box, preserving the artwork's aspect ratio.
    // Returns false when no custom character is loaded, so the caller draws its own.
    useChar(i, x, y, w, h) {
        const s = this.charSprites && this.charSprites[i];
        if (!s) return false;
        const src = s.texture.getSourceImage();
        const k = Math.min(w / src.width, h / src.height);
        s.setPosition(x, y).setDisplaySize(src.width * k, src.height * k).setVisible(true);
        return true;
    }
    hideChars() { if (this.charSprites) this.charSprites.forEach(s => s.setVisible(false)); }


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


    _dir(r) { return ({"Spawn Rate":"easier","Simultaneous":"harder","Hole Size":"neutral"})[r.label] || 'neutral'; }
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


    whack(px, py) {
        const r = W * LIVE.holeRatio;
        for (const h of this.holes) {
            if (h.active && Math.hypot(px - h.x, py - h.y) < r) {
                h.active = false; h.hitFlash = 200; this.hits++; return;
            }
        }
    }

    recompute() {
        const floor = T_REACT * (1 + 0.25 * (LIVE.simultaneous - 1));   // min fair appear time (ms)
        this.bandEasy = Phaser.Math.Clamp(floor * EASY_DUR, 300, 2200);
        this.bandHard = Phaser.Math.Clamp(floor * HARD_DUR, 300, 2200);
        this.derivedOK = (floor * HARD_DUR) <= 2200;
        LIVE.appearMs = this.bandEasy + (this.bandHard - this.bandEasy) * this.bandT;
    }

    update(time, delta) {
        this.recompute();

        for (const h of this.holes) {
            if (h.active) {
                h.timer -= delta;
                if (h.timer <= 0) { h.active = false; this.misses++; }
            }
            if (h.hitFlash > 0) h.hitFlash -= delta;
        }

        this.sinceSpawn += delta;
        const activeCount = this.holes.filter(h => h.active).length;
        if (this.sinceSpawn >= LIVE.spawnMs && activeCount < LIVE.simultaneous) {
            this.sinceSpawn = 0;
            const idle = this.holes.filter(h => !h.active);
            if (idle.length) { const h = idle[Math.floor(Math.random()*idle.length)]; h.active = true; h.timer = LIVE.appearMs; }
        }

        this.drawHoles();
        this.refreshDerived();
        this.updateReadout();
    }

    drawHoles() {
        const g = this.holeGfx; g.clear();
        this.hideChars();                 // several moles can be up at once → sprite pool
        let ci = 0;
        const r = W * LIVE.holeRatio;
        for (const h of this.holes) {
            g.fillStyle(0x1a0d00); g.fillEllipse(h.x, h.y + r*0.2, r*2, r*0.9);
            if (h.active) {
                if (!this.useChar(ci++, h.x, h.y, r*1.6, r*1.6)) {
                    g.fillStyle(0xf5b25a); g.fillCircle(h.x, h.y, r*0.78);
                    g.fillStyle(0xffd089, 0.7); g.fillCircle(h.x - r*0.22, h.y - r*0.26, r*0.36);
                    this.face(g, h.x, h.y, r*0.64, { spread: 0.42, eyeY: 0.14, mouthR: 0.28, mouthY: 0.36 });
                    g.fillStyle(0x8a5a2a); g.fillCircle(h.x, h.y + r*0.14, r*0.08);
                }
                g.lineStyle(4, this.derivedOK ? 0x2ecc71 : 0xe74c3c, 0.8);
                const prog = h.timer / LIVE.appearMs;
                g.beginPath(); g.arc(h.x, h.y, r*0.9, -Math.PI/2, -Math.PI/2 + prog*Math.PI*2); g.strokePath();
            } else if (h.hitFlash > 0) {
                g.fillStyle(0x2ecc71, h.hitFlash/200); g.fillCircle(h.x, h.y, r*0.8);
            }
            g.lineStyle(3, 0x8b4513); g.strokeCircle(h.x, h.y, r);
        }
    }

    updateReadout() {
        const line1 = this.derivedOK
            ? `MOLE VISIBLE  Hard ${Math.round(this.bandHard)}ms → Easy ${Math.round(this.bandEasy)}ms`
            : `⚠ Too hard — even Hard is below ${T_REACT}ms reaction (raise it / fewer moles)`;
        this.readout.setText(`${line1}\ntap the moles    hit ${this.hits} · missed ${this.misses}`);
        this.readout.setColor(this.derivedOK ? '#979aa8' : '#e74c3c');
    }

    buildPanel() {
        const HY = H*0.023, PB = this.collapsed ? H*0.054 : PANEL_BOTTOM;
        this.reg(this.add.rectangle(W/2, (PB)/2, W, PB, 0x17181f, 0.96).setDepth(50));
        this.reg(this.add.rectangle(W/2, PB, W, 1.5, 0x24262f).setDepth(50));
        this.mkCollapse(W*0.055, HY);
        const _t = this.reg(this.add.text(W*0.115, HY, '⚙ WHACK', {
            fontSize: `${W*0.030}px`, color: '#e8e9ef', fontStyle: 'bold'
        }).setOrigin(0, 0.5).setDepth(60));
        const _cnTitle = this.reg(this.add.text(_t.x + _t.width + W*0.022, HY, '打地鼠', {
            fontSize: `${W*0.024}px`, color: '#6d7080'
        }).setOrigin(0, 0.5).setDepth(60));
        if (this.collapsed) return;
        this.reg(this.add.text(W*0.97, HY, 'AUTO ▶ MOLE VISIBLE TIME', {
            fontSize: `${W*0.024}px`, color: '#979aa8'
        }).setOrigin(1, 0.5).setDepth(60));

        const rows = [
            { key: 'appear', label: 'Mole Visible', min: 300, max: 2200, get: () => LIVE.appearMs,     set: v => LIVE.appearMs     = v, fmt: v => `${Math.round(v)}ms` },
            { key: 'spawn',  label: 'Spawn Rate',   min: 350, max: 1500, get: () => LIVE.spawnMs,      set: v => LIVE.spawnMs      = v, fmt: v => `${Math.round(v)}ms` },
            { key: 'sim',    label: 'Simultaneous', min: 1,   max: 4,    get: () => LIVE.simultaneous, set: v => LIVE.simultaneous = Math.round(v), fmt: v => `${Math.round(v)}` },
            { key: 'hole',   label: 'Hole Size',    min: 0.12, max: 0.26, get: () => LIVE.holeRatio,   set: v => LIVE.holeRatio    = v, fmt: v => `${(v*100).toFixed(0)}%W` },
        ];
        const derivedKey = 'appear';

        let sy = H*0.078;
        const gap = H*0.044;
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
        g.lineStyle(4, 0x3a2a10); g.lineBetween(d.x0, y, d.x1, y);
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
    backgroundColor: '#2d1b00',
    canvas: window.canvas,
    scene: [LiveScene],
    input: { mouse: true, touch: true, keyboard: true },
};

new Phaser.Game(config);
