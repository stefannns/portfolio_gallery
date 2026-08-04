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
// BALL COLLISION (Breakout) — LIVE TUNING.  Paddle-reach model:
//   The paddle must reach the ball's landing x within the time the ball falls
//   the play height. Paddle width gives margin (you needn't be exactly centered).
//   → min paddle speed = (playW − paddleW − ballD) · ballSpeed / playH
//   → max ball speed   = playH · paddleSpeed / (playW − paddleW − ballD)
// ─────────────────────────────────────────────────────────────────
const LIVE = {
    paddleSpeedRatio: 0.50,   // paddle lateral speed (×W /s)
    ballSpeedRatio:   0.42,   // ball speed           (×H /s)
    ballSizeRatio:    0.03,   // ball diameter        (×W)
    paddleWRatio:     0.18,   // paddle width         (×W)
    paddleHRatio:     0.022,  // paddle height        (×H)
    tilesX:           7,      // brick columns
    tilesY:           4,      // brick rows
};

const EASY_SPD  = 1.60, HARD_SPD  = 1.20;
const EASY_BALL = 0.60, HARD_BALL = 0.90;   // ×reach-max: Easy = roomy, Hard = near the paddle's limit (both reachable)
const PLAY_TOP  = H * 0.03;
const PLAY_BOT  = H - 161;
const PADDLE_H  = H * 0.022;
const PADDLE_Y  = PLAY_BOT - PADDLE_H/2 - H*0.01;
const PLAY_W    = GW * 0.96;
const PLAY_H    = PADDLE_Y - PLAY_TOP;
const WALL_L    = GX0 + GW * 0.02, WALL_R = W - GW * 0.02;
const BRICK_TOP = PLAY_TOP + H * 0.02;
const BRICK_H   = (PLAY_BOT - PLAY_TOP) * 0.30;   // brick field = top 30% of the play area

class LiveScene extends Phaser.Scene {
    constructor() { super('LiveScene'); }

    create() {
        this.mode = 'ball';    // 'move' (paddle speed) | 'ball' (ball speed)
        this.derivedOK = true;
        this.collapsed = false;
        this.bandEasy = 0; this.bandHard = 0;
        this.bandT = 0.5; this.draggingRun = false;

        this.add.rectangle(W/2, H/2, W, H, 0x161a26).setDepth(0);
        this.add.rectangle(GCX, H/2, GW, H, 0x0d0d2a).setDepth(0.4);
        // side walls + ceiling
        const wg = this.add.graphics().setDepth(1);
        wg.fillStyle(0x2a2a5a);
        wg.fillRect(GX0, PLAY_TOP, WALL_L - GX0, PLAY_BOT - PLAY_TOP);
        wg.fillRect(WALL_R, PLAY_TOP, W - WALL_R, PLAY_BOT - PLAY_TOP);
        wg.fillRect(GX0, PLAY_TOP - 4, GW, 6);

        this.paddleX = GCX;
        this.moveDir = 0;
        this.returns = 0;
        this.drops   = 0;
        this.brickGfx = this.add.graphics().setDepth(4);
        this.bricks = []; this.gridX = 0; this.gridY = 0; this.broken = 0;
        this.buildBricks();
        this.resetBall(1);

        this.ballGfx   = this.add.graphics().setDepth(5);
        this.paddleGfx = this.add.graphics().setDepth(6);

        this.btnLeft  = this.ctrlBtn(GX0 + GW*0.13, H*0.93, '◀', () => this.moveDir = -1, () => this.moveDir = 0);
        this.btnRight = this.ctrlBtn(GX0 + GW*0.87, H*0.93, '▶', () => this.moveDir =  1, () => this.moveDir = 0);
        if (this.input.keyboard) {
            const kb = this.input.keyboard;
            kb.on('keydown-LEFT',  () => this.moveDir = -1); kb.on('keyup-LEFT',  () => { if (this.moveDir<0) this.moveDir = 0; });
            kb.on('keydown-A',     () => this.moveDir = -1); kb.on('keyup-A',     () => { if (this.moveDir<0) this.moveDir = 0; });
            kb.on('keydown-RIGHT', () => this.moveDir =  1); kb.on('keyup-RIGHT', () => { if (this.moveDir>0) this.moveDir = 0; });
            kb.on('keydown-D',     () => this.moveDir =  1); kb.on('keyup-D',     () => { if (this.moveDir>0) this.moveDir = 0; });
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
        g.fillStyle(ink, 1);
        g.fillCircle(cx - ex, ey, er);
        g.fillCircle(cx + ex, ey, er);
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


    _dir(r) { return ({"Paddle Speed":"neutral","Ball Size":"neutral","Paddle Width":"neutral"})[r.label] || 'neutral'; }
    diffTrack(g, r, x0, x1, y) {
        const d = this._dir(r);
        const lerp = (a,b,t)=>{const f=(s)=>[(s>>16)&255,(s>>8)&255,s&255];const A=f(a),B=f(b);return((A[0]+(B[0]-A[0])*t|0)<<16)|((A[1]+(B[1]-A[1])*t|0)<<8)|(A[2]+(B[2]-A[2])*t|0);};
        if (d==='harder'||d==='easier') { const A=d==='harder'?0x2ecc71:0xe74c3c, B=d==='harder'?0xe74c3c:0x2ecc71, N=18;
            for(let i=0;i<N;i++){g.lineStyle(6,lerp(A,B,(i+0.5)/N),1);g.lineBetween(x0+(x1-x0)*i/N,y,x0+(x1-x0)*(i+1)/N,y);} g.fillStyle(A,1); g.fillCircle(x0,y,3); g.fillStyle(B,1); g.fillCircle(x1,y,3); }
        else if (d==='feel') { g.lineStyle(4,0xf1c40f,0.4); g.lineBetween(x0,y,x1,y); g.fillStyle(0xf1c40f,0.4); g.fillCircle(x0,y,2.5); g.fillCircle(x1,y,2.5); }
        else { g.lineStyle(4,0x565a68); g.lineBetween(x0,y,x1,y); g.fillStyle(0x565a68,1); g.fillCircle(x0,y,2.5); g.fillCircle(x1,y,2.5); }
    }
    dirTag(r, y) {
        const d=this._dir(r); if(d==='neutral') return;
        const M={harder:['harder ↑','#c8ccda'],easier:['easier ↑','#c8ccda'],feel:['FEEL','#f1c40f']};
        this.reg(this.add.text(W*0.415, y, M[d][0], {fontSize:`${W*0.019}px`,color:M[d][1],fontStyle:'bold'}).setOrigin(1,0.5).setDepth(62));
    }


    ctrlBtn(x, y, label, onDown, onUp) {
        const bg = this.add.rectangle(x, y, W*0.16, H*0.06, 0x1a1a4a, 0.9).setStrokeStyle(2, 0x6c63ff).setInteractive().setDepth(40);
        const tx = this.add.text(x, y, label, { fontSize: `${W*0.05}px`, color: '#9c8fff' }).setOrigin(0.5).setDepth(41);
        bg.on('pointerdown', () => { bg.setFillStyle(0x2a2a6a); onDown(); });
        bg.on('pointerup',   () => { bg.setFillStyle(0x1a1a4a); onUp(); });
        bg.on('pointerout',  () => { bg.setFillStyle(0x1a1a4a); onUp(); });
        return { bg, tx };
    }

    resetBall(dir) {
        const sp = H * LIVE.ballSpeedRatio;
        const ang = (-60 + Math.random()*120) * Math.PI/180;   // downward-ish spread
        this.ball = { x: GCX, y: BRICK_TOP + BRICK_H + PLAY_H*0.14, vx: Math.sin(ang)*sp, vy: Math.abs(Math.cos(ang))*sp*dir };
    }

    // grid of destructible bricks, X columns × Y rows, filling the top brick field
    buildBricks() {
        this.gridX = Math.max(1, Math.round(LIVE.tilesX));
        this.gridY = Math.max(1, Math.round(LIVE.tilesY));
        const x0 = WALL_L + GW*0.015, x1 = WALL_R - GW*0.015;
        const gapX = GW*0.006, gapY = H*0.006;
        const cw = (x1 - x0 - gapX*(this.gridX - 1)) / this.gridX;
        const ch = (BRICK_H - gapY*(this.gridY - 1)) / this.gridY;
        this.bricks = [];
        for (let r = 0; r < this.gridY; r++) for (let c = 0; c < this.gridX; c++)
            this.bricks.push({ x: x0 + c*(cw+gapX), y: BRICK_TOP + r*(ch+gapY), w: cw, h: ch, row: r, alive: true });
        this.broken = 0;
    }

    drawBricks() {
        const g = this.brickGfx; g.clear();
        const pal = [0xd4f24e, 0x9be36b, 0x5ec8ff, 0xb79bff, 0xffc24d, 0xff8fa3];
        for (const bk of this.bricks) {
            if (!bk.alive) continue;
            g.fillStyle(pal[bk.row % pal.length]); g.fillRoundedRect(bk.x, bk.y, bk.w, bk.h, Math.min(bk.w, bk.h)*0.22);
            g.fillStyle(0xffffff, 0.14); g.fillRoundedRect(bk.x, bk.y, bk.w, Math.max(2, bk.h*0.30), Math.min(bk.w, bk.h)*0.2);
        }
    }

    recompute() {
        const paddleW = GW * LIVE.paddleWRatio, ballD = GW * LIVE.ballSizeRatio;
        const crossDist = Math.max(GW*0.10, PLAY_W - paddleW - ballD);
        if (this.mode === 'move') {
            const ballSpeed = H * LIVE.ballSpeedRatio;
            const floor = crossDist * ballSpeed / PLAY_H;
            this.bandEasy = Phaser.Math.Clamp(floor * EASY_SPD / GW, 0.12, 0.90);
            this.bandHard = Phaser.Math.Clamp(floor * HARD_SPD / GW, 0.12, 0.90);
            this.derivedOK = (floor * HARD_SPD / GW) <= 0.90;
            LIVE.paddleSpeedRatio = this.bandEasy + (this.bandHard - this.bandEasy) * this.bandT;
        } else {
            const paddleSpeed = GW * LIVE.paddleSpeedRatio;
            const ballMax = PLAY_H * paddleSpeed / crossDist;
            this.bandEasy = Phaser.Math.Clamp(ballMax * EASY_BALL / H, 0.15, 0.80);
            this.bandHard = Phaser.Math.Clamp(ballMax * HARD_BALL / H, 0.15, 0.80);
            this.derivedOK = (ballMax * EASY_BALL / H) <= 0.80;
            LIVE.ballSpeedRatio = this.bandEasy + (this.bandHard - this.bandEasy) * this.bandT;
        }
    }

    update(time, delta) {
        const dt = Math.min(delta / 1000, 0.05);
        this.recompute();
        if (Math.round(LIVE.tilesX) !== this.gridX || Math.round(LIVE.tilesY) !== this.gridY) this.buildBricks();

        const paddleSpeed = GW * LIVE.paddleSpeedRatio;
        const paddleW = GW * LIVE.paddleWRatio, ballR = GW * LIVE.ballSizeRatio / 2;
        const sp = H * LIVE.ballSpeedRatio;

        this.paddleX = Phaser.Math.Clamp(this.paddleX + this.moveDir * paddleSpeed * dt, WALL_L + paddleW/2, WALL_R - paddleW/2);

        const b = this.ball;
        // keep ball speed locked to the live ball-speed slider
        const cur = Math.hypot(b.vx, b.vy) || 1;
        b.vx *= sp/cur; b.vy *= sp/cur;
        b.x += b.vx * dt; b.y += b.vy * dt;

        if (b.x - ballR < WALL_L) { b.x = WALL_L + ballR; b.vx = Math.abs(b.vx); }
        if (b.x + ballR > WALL_R) { b.x = WALL_R - ballR; b.vx = -Math.abs(b.vx); }
        if (b.y - ballR < PLAY_TOP) { b.y = PLAY_TOP + ballR; b.vy = Math.abs(b.vy); }

        // bricks — break on contact, reflect off the nearer face
        for (const bk of this.bricks) {
            if (!bk.alive) continue;
            if (b.x + ballR > bk.x && b.x - ballR < bk.x + bk.w && b.y + ballR > bk.y && b.y - ballR < bk.y + bk.h) {
                bk.alive = false; this.broken++;
                const ox = Math.min(b.x + ballR - bk.x, bk.x + bk.w - (b.x - ballR));
                const oy = Math.min(b.y + ballR - bk.y, bk.y + bk.h - (b.y - ballR));
                if (ox < oy) b.vx = -b.vx; else b.vy = -b.vy;
                break;
            }
        }
        if (!this.bricks.some(bk => bk.alive)) this.buildBricks();   // wall cleared → fresh grid

        // paddle return
        if (b.vy > 0 && b.y + ballR >= PADDLE_Y - (H * LIVE.paddleHRatio)/2 && b.y + ballR <= PADDLE_Y + (H * LIVE.paddleHRatio) && Math.abs(b.x - this.paddleX) < paddleW/2 + ballR) {
            b.y = PADDLE_Y - (H * LIVE.paddleHRatio)/2 - ballR;
            const off = (b.x - this.paddleX) / (paddleW/2);          // angle by hit offset
            const ang = Phaser.Math.Clamp(off, -1, 1) * 60 * Math.PI/180;
            b.vx = Math.sin(ang) * sp; b.vy = -Math.abs(Math.cos(ang) * sp);
            this.returns++;
        }
        // drop
        if (b.y - ballR > PLAY_BOT) { this.drops++; this.resetBall(1); }

        this.drawBricks();
        this.drawBall(ballR);
        this.drawPaddle(paddleW);
        this.refreshDerived();
        this.updateReadout();
    }

    drawBall(ballR) {
        const g = this.ballGfx; g.clear();
        g.fillStyle(0x000000, 0.12); g.fillEllipse(this.ball.x, this.ball.y + ballR*0.92, ballR*1.4, ballR*0.36);
        g.fillStyle(0xffd23f); g.fillCircle(this.ball.x, this.ball.y, ballR);
        g.fillStyle(0xffe27a, 0.55); g.fillCircle(this.ball.x - ballR*0.3, this.ball.y - ballR*0.3, ballR*0.42);
        this.face(g, this.ball.x, this.ball.y, ballR*0.9, { spread: 0.38, eyeY: 0.05, mouthR: 0.26, mouthY: 0.28, cheeks: false });
    }

    drawPaddle(paddleW) {
        const g = this.paddleGfx; g.clear();
        const PADDLE_H = H * LIVE.paddleHRatio;
        const x = this.paddleX, y = PADDLE_Y;
        g.fillStyle(0x8b7dff); g.fillRoundedRect(x - paddleW/2, y - PADDLE_H/2, paddleW, PADDLE_H, PADDLE_H*0.5);
        g.fillStyle(0xffffff, 0.4); g.fillRoundedRect(x - paddleW/2 + PADDLE_H*0.3, y - PADDLE_H*0.32, Math.max(1, paddleW - PADDLE_H*0.6), PADDLE_H*0.3, PADDLE_H*0.15);
    }

    updateReadout() {
        let line1;
        if (!this.derivedOK) line1 = `⚠ Can't return — ${this.mode==='move' ? 'ball too fast for the paddle' : 'paddle too slow'}`;
        else if (this.mode === 'move') line1 = `PADDLE SPEED  Hard ${this.bandHard.toFixed(2)}W → Easy ${this.bandEasy.toFixed(2)}W`;
        else line1 = `BALL SPEED  Easy ${(this.bandEasy*100).toFixed(0)}%H/s → Hard ${(this.bandHard*100).toFixed(0)}%H/s`;
        const left = this.bricks.filter(bk => bk.alive).length;
        this.readout.setText(`${line1}\nhold ◀ ▶ · break the ${this.gridX}×${this.gridY} bricks    returns ${this.returns} · drops ${this.drops} · bricks ${left}`);
        this.readout.setColor(this.derivedOK ? '#979aa8' : '#e74c3c');
    }

    buildPanel() {
        this.reg(this.add.rectangle(PW/2, H/2, PW, H, 0x17181f, 0.98).setDepth(50));
        this.reg(this.add.rectangle(PW, H/2, 1.5, H, 0x24262f).setDepth(50));
        const _t = this.reg(this.add.text(PW*0.06, H*0.03, '⚙ BREAKOUT', {
            fontSize: `${GW*0.030}px`, color: '#e8e9ef', fontStyle: 'bold'
        }).setOrigin(0, 0.5).setDepth(60));
        this.reg(this.add.text(_t.x + _t.width + GW*0.02, H*0.03, '打砖块', {
            fontSize: `${GW*0.022}px`, color: '#6d7080'
        }).setOrigin(0, 0.5).setDepth(60));

        const modeStr = this.mode === 'move' ? 'COMPUTE ▶ PADDLE SPEED' : 'COMPUTE ▶ BALL SPEED';
        const btn = this.reg(this.add.rectangle(PW*0.5, H*0.076, PW*0.88, H*0.032, 0x24262f)
            .setStrokeStyle(1.5, 0x3a3d4a).setInteractive().setDepth(60));
        this.reg(this.add.text(PW*0.5, H*0.076, modeStr, {
            fontSize: `${GW*0.021}px`, color: '#e8e9ef', fontStyle: 'bold'
        }).setOrigin(0.5).setDepth(61));
        btn.on('pointerup', () => { this.mode = this.mode === 'move' ? 'ball' : 'move'; this.rebuildPanel(); });

        const rows = [
            { key: 'move', label: 'Paddle Speed', min: 0.12, max: 0.90, get: () => LIVE.paddleSpeedRatio, set: v => LIVE.paddleSpeedRatio = v, fmt: v => `${v.toFixed(2)}W` },
            { key: 'ball', label: 'Ball Speed',   min: 0.15, max: 0.80, get: () => LIVE.ballSpeedRatio,   set: v => LIVE.ballSpeedRatio   = v, fmt: v => `${(v*100).toFixed(0)}%H/s` },
            { key: 'ballS',label: 'Ball Size',    min: 0.02, max: 0.06, get: () => LIVE.ballSizeRatio,    set: v => LIVE.ballSizeRatio    = v, fmt: v => `${(v*100).toFixed(1)}%W` },
            { key: 'padW', label: 'Paddle Width', min: 0.08, max: 0.34, get: () => LIVE.paddleWRatio,     set: v => LIVE.paddleWRatio     = v, fmt: v => `${(v*100).toFixed(0)}%W` },
            { key: 'padH', label: 'Paddle Height', min: 0.012, max: 0.06, get: () => LIVE.paddleHRatio,    set: v => LIVE.paddleHRatio    = v, fmt: v => `${(v*100).toFixed(1)}%H` },
            { key: 'tilesX', label: 'Tiles X',    min: 3,   max: 12,  get: () => LIVE.tilesX, set: v => LIVE.tilesX = Math.round(v), fmt: v => `${Math.round(v)}`, dir: 'neutral' },
            { key: 'tilesY', label: 'Tiles Y',    min: 1,   max: 8,   get: () => LIVE.tilesY, set: v => LIVE.tilesY = Math.round(v), fmt: v => `${Math.round(v)}`, dir: 'neutral' },
        ];
        const derivedKey = this.mode;

        let sy = H*0.14;
        const gap = H*0.056;
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
        const tx0 = PW*0.06, tx1 = PW*0.94, trackW = tx1 - tx0, ty = y + H*0.02;
        this.reg(this.add.text(tx0, y, r.label, { fontSize: `${GW*0.024}px`, color: '#9aa0b4' }).setOrigin(0, 0.5).setDepth(60));
        const valTxt = this.reg(this.add.text(tx1, y, r.fmt(r.get()), { fontSize: `${GW*0.024}px`, color: '#e8e9ef' }).setOrigin(1, 0.5).setDepth(60));
        const g = this.reg(this.add.graphics().setDepth(59));
        this.diffTrack(g, r, tx0, tx1, ty);
        const knob = this.reg(this.add.circle(tx0 + (r.get() - r.min)/(r.max - r.min) * trackW, ty, GW*0.022, 0xd4f24e)
            .setStrokeStyle(2.5, 0x121319).setInteractive({ draggable: true }).setDepth(61));
        this.input.setDraggable(knob);
        knob.on('drag', (ptr, dragX) => {
            const cx = Phaser.Math.Clamp(dragX, tx0, tx1); knob.x = cx;
            const v = r.min + (cx - tx0)/trackW * (r.max - r.min);
            valTxt.setText(r.fmt(v)); r.set(v);
        });
    }

    renderDerived(r, y) {
        const x0 = PW*0.06, x1 = PW*0.94, ty = y + H*0.02;
        this.reg(this.add.text(x0, y, r.label + '  ▸AUTO', { fontSize: `${GW*0.024}px`, color: '#e8e9ef' }).setOrigin(0, 0.5).setDepth(60));
        const text = this.reg(this.add.text(x1, y, '', { fontSize: `${GW*0.023}px`, color: '#e8e9ef', fontStyle: 'bold' }).setOrigin(1, 0.5).setDepth(60));
        const g = this.reg(this.add.graphics().setDepth(59));        const handle  = this.reg(this.add.circle(x0, ty, GW*0.024, 0xffffff).setStrokeStyle(3, 0x17181f).setInteractive({ draggable: true }).setDepth(62));
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
    backgroundColor: '#0d0d2a',
    canvas: window.canvas,
    scene: [LiveScene],
    input: { mouse: true, touch: true, keyboard: true },
};

new Phaser.Game(config);
