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
const GCX = GX0 + GW/2;

// ─────────────────────────────────────────────────────────────────
// FLAPPY — LIVE TUNING.  Sliders write LIVE; gameplay reads it each frame.
//   flapArc   = flapImpulse² / (2·gravity)       (one-flap rise)
//   flapCycle = 2·flapImpulse / gravity          (one bob, seconds)
// Fairness: gap must not be overshot by a single flap → gap ≥ birdH + flapArc.
//           reaction window per pipe should fit ~1.5 flap cycles.
// ─────────────────────────────────────────────────────────────────
const LIVE = {
    flapImpulseRatio: 0.34,   // upward velocity (×H /s)
    gravityRatio:     1.20,   // (×H /s²)
    gapHeightRatio:   0.30,   // gap between pipes (×H)
    birdSizeRatio:    0.060,  // bird height (×H); width = same
    pipeSpacingRatio: 0.55,   // horizontal distance between pipes (×W)
    scrollSpeedRatio: 0.28,   // world scroll (×W /s)
};

const K_REACT       = 1.5;    // flap cycles that should fit per pipe interval
const GAP_FLOOR_MUL = 1.0;    // gap floor = birdH + GAP_FLOOR_MUL·flapArc
const EASY_GAP = 1.6, HARD_GAP = 1.25;     // ×gap-floor  (bigger gap = easier)
const EASY_SPD = 0.60, HARD_SPD = 0.95;    // ×speed-max  (faster = harder)
const PANEL_BOTTOM = H * 0.37 - 82;   // panel is flush to the top
const BIRD_X       = GX0 + GW * 0.30;
const SKY_TOP      = H * 0.03;
const SKY_BOT      = H - 161;

class LiveScene extends Phaser.Scene {
    constructor() { super('LiveScene'); }

    create() {
        this.mode = 'gap';     // compute target: 'gap' | 'speed'
        this.derivedOK = true;
        this.collapsed = false;
        this.initCharacter(8);
        this.bandEasy = 0; this.bandHard = 0;
        this.bandT = 0;        // 0 = Easy, 1 = Hard (draggable handle on the band)
        this.draggingRun = false;

        this.add.rectangle(W/2, H/2, W, H, 0x161a26).setDepth(0);
        this.add.rectangle(GCX, H/2, GW, H, 0x4a86c8).setDepth(0.5);
        this.add.rectangle(GCX, (SKY_BOT + H)/2, GW, H - SKY_BOT, 0x5a8a30).setDepth(1);

        this.birdY      = (SKY_TOP + SKY_BOT)/2;
        this.velY       = 0;
        this.worldX     = 0;
        this.nextPipeX  = GW * 0.9;
        this.pipes      = [];
        this.passed     = 0;
        this.hits       = 0;

        this.pipeGfx = this.add.graphics().setDepth(4);
        this.birdGfx = this.add.graphics().setDepth(6);

        const flapZone = this.add.rectangle(GCX, H/2, GW, H, 0x000000, 0)
            .setInteractive().setDepth(2);
        flapZone.on('pointerdown', () => this.flap());
        this.add.text(GCX, SKY_BOT - H*0.04, 'TAP TO FLAP', {
            fontSize: `${GW*0.034}px`, color: '#ffffff'
        }).setOrigin(0.5).setAlpha(0.2).setDepth(2);
        if (this.input.keyboard) {
            this.input.keyboard.on('keydown-SPACE', () => this.flap());
            this.input.keyboard.on('keydown-UP',    () => this.flap());
        }

        this.readout = { setText: (t) => { if (typeof window !== 'undefined') window.__genreStats = t; return this.readout; }, setColor: () => this.readout, y: 0 };

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
        try { data = localStorage.getItem('genrelab:char:mock_flappy'); } catch (e) {}
        if (!data) return;
        const key = 'usrchar_mock_flappy';
        const make = () => {
            for (let i = 0; i < 1; i++)
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


    _dir(r) { return ({"Flap Impulse":"feel","Gravity":"feel","Bird Size":"neutral","Pipe Spacing":"easier","Scroll Speed":"harder"})[r.label] || 'neutral'; }
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


    flap() { this.velY = -(H * LIVE.flapImpulseRatio); }

    flapArc()   { const fi = LIVE.flapImpulseRatio, g = LIVE.gravityRatio; return H * fi*fi / (2*g); }   // px
    flapCycle() { return 2 * LIVE.flapImpulseRatio / LIVE.gravityRatio; }                                // s

    recompute() {
        const birdH = H * LIVE.birdSizeRatio;
        if (this.mode === 'gap') {
            const floor = birdH + GAP_FLOOR_MUL * this.flapArc();         // min gap (px)
            this.bandEasy = Phaser.Math.Clamp(floor * EASY_GAP / H, 0.12, 0.45);
            this.bandHard = Phaser.Math.Clamp(floor * HARD_GAP / H, 0.12, 0.45);
            this.derivedOK = (floor * HARD_GAP / H) <= 0.45 && floor / H <= 0.45;
            LIVE.gapHeightRatio = this.bandEasy + (this.bandHard - this.bandEasy) * this.bandT;
        } else {
            // Scroll speed is PACING, not difficulty (faster only cuts reaction time — it doesn't
            // change whether the bird fits). Compute the fastest fair speed; run at a comfortable 0.7×.
            const spacing = GW * LIVE.pipeSpacingRatio;
            const spdMax  = spacing / (K_REACT * this.flapCycle());       // px/s, fastest fair
            this.derivedOK = true;
            LIVE.scrollSpeedRatio = Phaser.Math.Clamp(0.7 * spdMax / GW, 0.12, 0.70);
        }
    }

    update(time, delta) {
        const dt = Math.min(delta / 1000, 0.05);
        this.recompute();

        const g     = H * LIVE.gravityRatio;
        const speed = GW * LIVE.scrollSpeedRatio;
        const gap   = H * LIVE.gapHeightRatio;
        const birdR = H * LIVE.birdSizeRatio / 2;

        this.velY  += g * dt;
        this.birdY += this.velY * dt;
        if (this.birdY < SKY_TOP + birdR) { this.birdY = SKY_TOP + birdR; this.velY = 0; }
        if (this.birdY > SKY_BOT - birdR) { this.birdY = SKY_BOT - birdR; this.velY = 0; }

        this.worldX += speed * dt;
        const spacing = GW * LIVE.pipeSpacingRatio;
        while (this.nextPipeX < this.worldX + GW * 1.2) {
            const margin = gap/2 + H*0.04;
            const center = SKY_TOP + margin + Math.random() * Math.max(1, (SKY_BOT - SKY_TOP) - 2*margin);
            this.pipes.push({ worldX: this.nextPipeX, gapC: center, state: 'pending' });
            this.nextPipeX += spacing;
        }

        const pipeW = GW * 0.10;
        for (let i = this.pipes.length - 1; i >= 0; i--) {
            const p = this.pipes[i];
            const sx = GX0 + (p.worldX - this.worldX);
            const half = gap/2;
            if (BIRD_X + birdR > sx - pipeW/2 && BIRD_X - birdR < sx + pipeW/2) {
                if ((this.birdY - birdR < p.gapC - half || this.birdY + birdR > p.gapC + half) && p.state !== 'hit') {
                    p.state = 'hit'; this.hits++;
                }
            }
            if (sx + pipeW/2 < BIRD_X - birdR && p.state === 'pending') { p.state = 'passed'; this.passed++; }
            if (sx < GX0 - pipeW) this.pipes.splice(i, 1);
        }

        this.drawPipes(pipeW, gap);
        this.drawBird(birdR);
        this.refreshDerived();
        this.updateReadout();
    }

    drawPipes(pipeW, gap) {
        const g = this.pipeGfx; g.clear();
        for (const p of this.pipes) {
            const sx = GX0 + (p.worldX - this.worldX);
            if (sx + pipeW/2 < GX0 - 10 || sx - pipeW/2 > W + 10) continue;
            const top = p.gapC - gap/2, bot = p.gapC + gap/2;
            const base = p.state === 'hit' ? 0xef6b6b : p.state === 'passed' ? 0x63d19b : 0x74c98a;
            const cap  = p.state === 'hit' ? 0xd94f4f : p.state === 'passed' ? 0x4cba86 : 0x5fb877;
            const lip = pipeW*0.16, capH = Math.min(H*0.026, (top - SKY_TOP)*0.8, (SKY_BOT - bot)*0.8);
            g.fillStyle(base);
            g.fillRect(sx - pipeW/2, SKY_TOP, pipeW, top - SKY_TOP - capH);
            g.fillRect(sx - pipeW/2, bot + capH, pipeW, SKY_BOT - bot - capH);
            g.fillStyle(cap);
            g.fillRoundedRect(sx - pipeW/2 - lip, top - capH, pipeW + lip*2, capH, capH*0.42);
            g.fillRoundedRect(sx - pipeW/2 - lip, bot,        pipeW + lip*2, capH, capH*0.42);
        }
    }

    drawBird(birdR) {
        const g = this.birdGfx; g.clear();
        if (this.useChar(0, BIRD_X, this.birdY, birdR*2, birdR*2)) return;
        const x = BIRD_X, y = this.birdY;
        g.fillStyle(0x000000, 0.12); g.fillEllipse(x, y + birdR*0.98, birdR*1.6, birdR*0.42);
        g.fillStyle(0xffd23f); g.fillCircle(x, y, birdR);
        g.fillStyle(0xffbf3a); g.fillEllipse(x - birdR*0.5, y + birdR*0.1, birdR*0.66, birdR*0.46);
        this.face(g, x + birdR*0.08, y - birdR*0.02, birdR*0.84, { spread: 0.36, eyeY: 0.08, mouthR: 0.24, mouthY: 0.32 });
    }

    updateReadout() {
        let line1;
        if (!this.derivedOK) line1 = `⚠ Infeasible — ${this.mode==='gap' ? 'flap too strong / bird too big' : 'pipes too close for the flap rate'}`;
        else if (this.mode === 'gap') line1 = `GAP HEIGHT (difficulty)  Hard ${(this.bandHard*100).toFixed(1)}%H → Easy ${(this.bandEasy*100).toFixed(1)}%H`;
        else line1 = `SCROLL SPEED = ${LIVE.scrollSpeedRatio.toFixed(2)}W  (pacing — faster cuts reaction)`;
        this.readout.setText(`${line1}\nflapArc ${(this.flapArc()/H*100).toFixed(1)}%H · cycle ${this.flapCycle().toFixed(2)}s    passed ${this.passed} · hit ${this.hits}`);
        this.readout.setColor(this.derivedOK ? '#979aa8' : '#e74c3c');
    }

    buildPanel() {
        this.reg(this.add.rectangle(PW/2, H/2, PW, H, 0x17181f, 0.98).setDepth(50));
        this.reg(this.add.rectangle(PW, H/2, 1.5, H, 0x24262f).setDepth(50));
        const _t = this.reg(this.add.text(PW*0.06, H*0.03, '⚙ FLAPPY', { fontSize: `${GW*0.030}px`, color: '#e8e9ef', fontStyle: 'bold' }).setOrigin(0, 0.5).setDepth(60));
        this.reg(this.add.text(_t.x + _t.width + GW*0.02, H*0.03, '飞翔小鸟', { fontSize: `${GW*0.022}px`, color: '#6d7080' }).setOrigin(0, 0.5).setDepth(60));

        const modeStr = this.mode === 'gap' ? 'COMPUTE ▶ GAP HEIGHT' : 'COMPUTE ▶ SCROLL SPEED';
        const btn = this.reg(this.add.rectangle(PW*0.5, H*0.076, PW*0.88, H*0.032, 0x24262f).setStrokeStyle(1.5, 0x3a3d4a).setInteractive().setDepth(60));
        this.reg(this.add.text(PW*0.5, H*0.076, modeStr, { fontSize: `${GW*0.021}px`, color: '#e8e9ef', fontStyle: 'bold' }).setOrigin(0.5).setDepth(61));
        btn.on('pointerup', () => { this.mode = this.mode === 'gap' ? 'speed' : 'gap'; this.rebuildPanel(); });

        const rows = [
            { key: 'flap',  label: 'Flap Impulse',  min: 0.20, max: 0.50, get: () => LIVE.flapImpulseRatio, set: v => LIVE.flapImpulseRatio = v, fmt: v => `${(v*100).toFixed(0)}%H/s` },
            { key: 'grav',  label: 'Gravity',       min: 0.60, max: 2.40, get: () => LIVE.gravityRatio,     set: v => LIVE.gravityRatio     = v, fmt: v => `${v.toFixed(2)}` },
            { key: 'gap',   label: 'Gap Height',    min: 0.12, max: 0.45, get: () => LIVE.gapHeightRatio,   set: v => LIVE.gapHeightRatio   = v, fmt: v => `${(v*100).toFixed(1)}%H` },
            { key: 'bird',  label: 'Bird Size',     min: 0.03, max: 0.10, get: () => LIVE.birdSizeRatio,    set: v => LIVE.birdSizeRatio    = v, fmt: v => `${(v*100).toFixed(1)}%H` },
            { key: 'space', label: 'Pipe Spacing',  min: 0.30, max: 0.80, get: () => LIVE.pipeSpacingRatio, set: v => LIVE.pipeSpacingRatio = v, fmt: v => `${(v*100).toFixed(0)}%W` },
            { key: 'speed', label: 'Scroll Speed',  min: 0.12, max: 0.70, get: () => LIVE.scrollSpeedRatio, set: v => LIVE.scrollSpeedRatio = v, fmt: v => `${v.toFixed(2)}W` },
        ];
        const derivedKey = this.mode;
        let cy = H*0.14; const gap = H*0.055;
        for (const r of rows) { if (r.key === derivedKey) this.renderDerived(r, cy); else this.mkSlider(r, cy); cy += gap; }
    }

    rebuildPanel() {
        this.panelObjs.forEach(o => o.destroy());
        this.panelObjs = [];
        this.derived = null;
        this.buildPanel();
    }

    mkSlider(r, y) {
        const tx0 = PW*0.06, tx1 = PW*0.94, trackW = tx1 - tx0, ty = y + H*0.02;
        this.reg(this.add.text(tx0, y, r.label, { fontSize: `${GW*0.024}px`, color: '#9aa0b4' }).setOrigin(0, 0.5).setDepth(60));
        const valTxt = this.reg(this.add.text(tx1, y, r.fmt(r.get()), { fontSize: `${GW*0.024}px`, color: '#e8e9ef' }).setOrigin(1, 0.5).setDepth(60));
        const g = this.reg(this.add.graphics().setDepth(59));
        this.diffTrack(g, r, tx0, tx1, ty);
        const knob = this.reg(this.add.circle(tx0 + (r.get() - r.min)/(r.max - r.min) * trackW, ty, GW*0.020, 0xf0a324)
            .setStrokeStyle(2, 0x17181f).setInteractive({ draggable: true }).setDepth(61));
        this.input.setDraggable(knob);
        knob.on('drag', (ptr, dragX) => {
            const cx = Phaser.Math.Clamp(dragX, tx0, tx1); knob.x = cx;
            const v = r.min + (cx - tx0)/trackW * (r.max - r.min);
            valTxt.setText(r.fmt(v)); r.set(v);
        });
    }

    // Gap mode → Easy/Hard difficulty band (draggable). Speed mode → pacing point.
    renderDerived(r, y) {
        const x0 = PW*0.06, x1 = PW*0.94, ty = y + H*0.02;
        this.reg(this.add.text(x0, y, r.label + '  ▸AUTO', { fontSize: `${GW*0.024}px`, color: '#e8e9ef' }).setOrigin(0, 0.5).setDepth(60));
        const text = this.reg(this.add.text(x1, y, '', { fontSize: `${GW*0.023}px`, color: '#e8e9ef', fontStyle: 'bold' }).setOrigin(1, 0.5).setDepth(60));
        const g = this.reg(this.add.graphics().setDepth(59));
        if (r.key === 'gap') {
            const handle = this.reg(this.add.circle(x0, ty, GW*0.024, 0xffffff).setStrokeStyle(3, 0x17181f).setInteractive({ draggable: true }).setDepth(62));
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
            this.derived = { type: 'range', r, g, text, handle, x0, x1, y: ty };
        } else {
            g.lineStyle(5, 0x2e313c); g.lineBetween(x0, ty, x1, ty);
            const marker = this.reg(this.add.circle(x0, ty, GW*0.018, 0xf0a324).setStrokeStyle(2, 0xffffff).setDepth(61));
            this.derived = { type: 'point', r, marker, text, x0, x1, y: ty };
        }
        this.refreshDerived();
    }

    refreshDerived() {
        const d = this.derived; if (!d) return;
        if (d.type === 'range') {
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
        } else {
            const r = d.r, val = r.get();
            const t = Phaser.Math.Clamp((val - r.min)/(r.max - r.min), 0, 1);
            d.marker.x = d.x0 + t * (d.x1 - d.x0);
            d.marker.setFillStyle(this.derivedOK ? 0xf0a324 : 0xe74c3c);
            d.text.setText(d.r.fmt(d.r.get()));
            d.text.setColor(this.derivedOK ? '#979aa8' : '#e74c3c');
        }
    }
}

const config = {
    type: Phaser.WEBGL,
    width: windowWidth,
    height: windowHeight,
    transparent: false,
    backgroundColor: '#4a86c8',
    canvas: window.canvas,
    scene: [LiveScene],
    input: { mouse: true, touch: true, keyboard: true },
};

new Phaser.Game(config);
