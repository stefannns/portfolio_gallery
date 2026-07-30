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
// RUNNER / PLATFORMER — same jump-clearance physics, two control modes:
//   AUTO   = world auto-scrolls (endless runner)
//   MANUAL = you drive left/right (platformer)
// Jump = v0 = 4·Hmax/T, g = 8·Hmax/T².  Clearance uses player WIDTH.
// ─────────────────────────────────────────────────────────────────
const DEFAULT_CONTROL = 'manual';   // this build defaults to platformer-style control

const LIVE = {
    jumpHeightRatio: 0.18,   // Hmax  (×H)
    airTime:         0.85,   // T     (seconds)
    obsHRatio:       0.08,   // obstacle height (×H)
    obsWRatio:       0.06,   // obstacle width  (×W)
    playerWRatio:    0.06,   // player width    (×W)
    playerHRatio:    0.11,   // player height   (×H)
    moveSpeedRatio:  0.33,   // move speed      (×W, px/s)
};

const FEEL_MARKERS = [
    { value: 1.10, label: 'Light' },
    { value: 0.85, label: 'Med'   },
    { value: 0.62, label: 'Heavy' },
];

const K_MARGIN     = 0.8;
// Jump height is the difficulty axis (taller = more clearance margin = easier).
const JUMP_EASY    = 1.80;       // ×clearance-floor → Easy (tall, forgiving)
const JUMP_HARD    = 1.30;       // ×clearance-floor → Hard (still a fair human margin, not razor-edge)
const GROUND_Y     = H * 0.80;
const PANEL_BOTTOM = H * 0.37 - 82;   // panel is flush to the top
const PLAYER_X     = GX0 + GW * 0.25;     // player's fixed screen x (camera follows in manual)
const PLAYER_VIS_H = H * 0.11;

class LiveScene extends Phaser.Scene {
    constructor() { super('LiveScene'); }

    create() {
        this.mode    = 'jump';             // compute target: 'jump' (difficulty band) | 'speed' (pacing min)
        this.control = DEFAULT_CONTROL;    // 'auto' | 'manual'
        this.platformMode = (DEFAULT_CONTROL === 'manual');  // true = blocks are land-on platforms; false = jump-over obstacles
        this.derivedOK = true;
        this.collapsed = false;
        this.initCharacter(8);

        this.add.rectangle(W/2, H/2, W, H, 0x161a26).setDepth(0);
        this.add.rectangle(GCX, H/2, GW, H, 0x1e1e3e).setDepth(0.3);
        this.add.rectangle(GCX, (GROUND_Y + H)/2, GW, H - GROUND_Y, 0x2a1e10).setDepth(0.4);
        this.add.rectangle(GCX, GROUND_Y, GW, 6, 0x3a8a3a).setDepth(1);

        // world / camera
        this.cameraX      = 0;
        this.playerWorldX = PLAYER_X;
        this.nextSpawnX   = W * 0.9;
        this.feetY        = GROUND_Y;
        this.prevFeetY    = GROUND_Y;
        this.velY         = 0;
        this.onGround     = true;
        this.platY        = 0.05;          // current staircase height (ratio of H) for platform mode
        this.moveDir      = 0;
        this.obstacles    = [];
        this.cleared      = 0;
        this.hits         = 0;

        this.obsGfx    = this.add.graphics().setDepth(5);
        this.playerGfx = this.add.graphics().setDepth(6);

        // tap-empty-to-jump (works in both modes)
        const jumpZone = this.add.rectangle(GCX, H/2, GW, H, 0x000000, 0)
            .setInteractive().setDepth(2);
        jumpZone.on('pointerdown', () => this.jump());

        // on-screen controls
        this.btnLeft  = this.ctrlBtn(GX0 + GW*0.12, H*0.90, '◀', () => this.moveDir = -1, () => this.moveDir = 0);
        this.btnRight = this.ctrlBtn(GX0 + GW*0.30, H*0.90, '▶', () => this.moveDir =  1, () => this.moveDir = 0);
        this.btnJump  = this.ctrlBtn(GX0 + GW*0.86, H*0.90, '▲', () => this.jump(), () => {});
        if (this.input.keyboard) {
            const kb = this.input.keyboard;
            kb.on('keydown-LEFT',  () => this.moveDir = -1); kb.on('keyup-LEFT',  () => { if (this.moveDir<0) this.moveDir = 0; });
            kb.on('keydown-A',     () => this.moveDir = -1); kb.on('keyup-A',     () => { if (this.moveDir<0) this.moveDir = 0; });
            kb.on('keydown-RIGHT', () => this.moveDir =  1); kb.on('keyup-RIGHT', () => { if (this.moveDir>0) this.moveDir = 0; });
            kb.on('keydown-D',     () => this.moveDir =  1); kb.on('keyup-D',     () => { if (this.moveDir>0) this.moveDir = 0; });
            kb.on('keydown-SPACE', () => this.jump());
            kb.on('keydown-UP',    () => this.jump());
        }

        this.readout = { setText: (t) => { if (typeof window !== 'undefined') window.__genreStats = t; return this.readout; }, setColor: () => this.readout, y: 0 };

        this.bandEasy = LIVE.moveSpeedRatio;
        this.bandHard = LIVE.moveSpeedRatio * 1.5;
        this.bandT    = 0;        // 0 = Easy, 1 = Hard (draggable on the band)
        this.draggingRun = false;
        this.panelObjs = [];
        this.buildPanel();
        this.applyControlVisibility();
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
        try { data = localStorage.getItem('genrelab:char:mock_platformer'); } catch (e) {}
        if (!data) return;
        const key = 'usrchar_mock_platformer';
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
            if (this.readout) this.readout.y = (this.collapsed ? H*0.054 : H*0.37) + H*0.012;
            this.rebuildPanel();
        });
    }


    _dir(r) { return ({"Air Time":"feel","Move Speed":"neutral","Obstacle Height":"neutral","Step Up":"neutral","Obstacle Width":"neutral","Platform Length":"neutral","Player Width":"neutral"})[r.label] || 'neutral'; }
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


    ctrlBtn(x, y, label, onDown, onUp) {
        const bg = this.add.rectangle(x, y, W*0.14, H*0.06, 0x2a2a5a, 0.85).setStrokeStyle(2, 0x6c63ff).setInteractive().setDepth(40);
        const tx = this.add.text(x, y, label, { fontSize: `${W*0.05}px`, color: '#9c8fff' }).setOrigin(0.5).setDepth(41);
        bg.on('pointerdown', () => { bg.setFillStyle(0x44449a); onDown(); });
        bg.on('pointerup',   () => { bg.setFillStyle(0x2a2a5a); onUp(); });
        bg.on('pointerout',  () => { bg.setFillStyle(0x2a2a5a); onUp(); });
        return { bg, tx, setVisible: v => { bg.setVisible(v); tx.setVisible(v); } };
    }

    applyControlVisibility() {
        const manual = this.control === 'manual';
        this.btnLeft.setVisible(manual);
        this.btnRight.setVisible(manual);
        if (!manual) this.moveDir = 0;
    }

    jump() {
        if (this.onGround) {
            const Hmax = H * LIVE.jumpHeightRatio, T = LIVE.airTime;
            this.velY = -(4 * Hmax / T);
            this.onGround = false;
        }
    }

    recompute() {
        const T  = LIVE.airTime;
        const h  = H * LIVE.obsHRatio;
        const w  = GW * LIVE.obsWRatio;
        const wp = GW * LIVE.playerWRatio;

        if (this.mode === 'jump') {
            // DIFFICULTY axis: jump height. Taller = more clearance margin = easier, and it
            // does NOT change how fast obstacles arrive — so it's a clean, monotonic difficulty dial.
            // Easy = tall (forgiving), Hard = near the clearance floor. Draggable band.
            const v = GW * LIVE.moveSpeedRatio;
            const R = (w + wp) / (v * T);                       // razor-edge timing fraction
            if (R >= 1) {                                       // width can't be crossed in the air time
                this.derivedOK = false;
                this.bandEasy = this.bandHard = 0.28;
                LIVE.jumpHeightRatio = 0.28;
            } else {
                const floor = (h / (1 - R*R)) / H;              // min jump height to clear (ratio)
                this.bandEasy = Phaser.Math.Clamp(floor * JUMP_EASY, 0.06, 0.28);
                this.bandHard = Phaser.Math.Clamp(floor * JUMP_HARD, 0.06, 0.28);
                this.derivedOK = floor <= 0.28;
                LIVE.jumpHeightRatio = this.bandEasy + (this.bandHard - this.bandEasy) * this.bandT;
            }
        } else {
            // PACING floor: move speed. Faster adds clearance margin but cuts reaction time, so it is
            // NOT a clean difficulty dial — compute the minimum only (run at the slowest fair speed).
            const Hmax = H * LIVE.jumpHeightRatio;
            if (Hmax <= h) { this.derivedOK = false; LIVE.moveSpeedRatio = 0.70; }
            else {
                const vmin = (w + wp) / (K_MARGIN * T * Math.sqrt(1 - h/Hmax));
                const ratio = vmin / GW;
                this.derivedOK = ratio <= 0.70;
                LIVE.moveSpeedRatio = Phaser.Math.Clamp(ratio, 0.12, 0.70);
            }
        }
    }

    update(time, delta) {
        const dt = Math.min(delta / 1000, 0.05);
        this.recompute();

        const Hmax  = H * LIVE.jumpHeightRatio, T = LIVE.airTime;
        const grav  = 8 * Hmax / (T * T);
        const speed = GW * LIVE.moveSpeedRatio;
        const charW = GW * LIVE.playerWRatio;

        // horizontal — auto scroll vs manual drive (both keep player at screen PLAYER_X)
        if (this.control === 'auto') {
            this.cameraX += speed * dt;
            this.playerWorldX = this.cameraX + PLAYER_X;
        } else {
            this.playerWorldX = Math.max(PLAYER_X, this.playerWorldX + this.moveDir * speed * dt);
            this.cameraX = this.playerWorldX - PLAYER_X;
        }

        // vertical physics — apply gravity, then resolve the support surface
        const pLeft = this.playerWorldX - charW/2, pRight = this.playerWorldX + charW/2;
        this.prevFeetY = this.feetY;
        this.velY  += grav * dt;
        this.feetY += this.velY * dt;
        let support = GROUND_Y;
        if (this.platformMode) {
            // one-way platforms: you land on the TOP only, when descending across the top edge
            for (const o of this.obstacles) {
                const oLeft = o.worldX - o.w/2, oRight = o.worldX + o.w/2, oTop = GROUND_Y - o.h;
                if (pRight <= oLeft || pLeft >= oRight) continue;
                if (this.velY >= 0 && this.prevFeetY <= oTop + 2 && this.feetY >= oTop) {
                    if (oTop < support) support = oTop;
                    if (o.state !== 'landed') { o.state = 'landed'; this.cleared++; }
                }
            }
        }
        if (this.feetY >= support) { this.feetY = support; this.velY = 0; this.onGround = true; }
        else this.onGround = false;

        // spawn blocks ahead in world space
        while (this.nextSpawnX < this.cameraX + W * 1.2) {
            if (this.platformMode) {
                // Ascending staircase of long landable platforms + an optional upper tier.
                // Each platform rises ~"Step Up" (obsHRatio) above the last; reset to base at the ceiling.
                const platLen  = Phaser.Math.Clamp(GW * LIVE.obsWRatio * 4, GW*0.20, GW*0.70);
                const gapEmpty = Math.max(GW*0.12, speed * T * 0.75);
                const step     = LIVE.obsHRatio;                 // rise per platform (×H)
                const baseH = 0.05, ceilH = 0.42;

                let nextH = this.platY + step * (0.8 + Math.random() * 0.4);   // climb ±20%
                if (nextH > ceilH) nextH = baseH + Math.random() * step;       // hit ceiling → drop to base
                this.platY = Phaser.Math.Clamp(nextH, baseH, ceilH);

                const mainX = this.nextSpawnX + platLen/2;
                this.obstacles.push({ worldX: mainX, w: platLen, h: this.platY * H, state: 'pending' });

                // second layer above (~40%): an upper-tier ledge, offset, sometimes a stretch jump
                if (Math.random() < 0.4) {
                    const upH   = Phaser.Math.Clamp(this.platY + step * (1.3 + Math.random()*0.5), baseH, ceilH + 0.08);
                    const upLen = platLen * (0.5 + Math.random() * 0.3);
                    const upX   = mainX + (Math.random() - 0.5) * platLen;
                    this.obstacles.push({ worldX: upX, w: upLen, h: upH * H, state: 'pending' });
                }

                this.nextSpawnX += platLen + gapEmpty + (Math.random() - 0.5) * gapEmpty * 0.4;  // spacing jitter
            } else {
                const gap = Math.max(GW*0.30, speed * T * 1.4) + GW * LIVE.obsWRatio;
                this.obstacles.push({ worldX: this.nextSpawnX, w: GW*LIVE.obsWRatio, h: H*LIVE.obsHRatio, state: 'pending' });
                this.nextSpawnX += gap;
            }
        }

        // obstacle-mode hit/clear (jump OVER) · platform-mode miss (failed to land ON) · cull
        for (let i = this.obstacles.length - 1; i >= 0; i--) {
            const o = this.obstacles[i];
            const oLeft = o.worldX - o.w/2, oRight = o.worldX + o.w/2, oTop = GROUND_Y - o.h;
            if (!this.platformMode) {
                if (pRight > oLeft && pLeft < oRight && this.feetY > oTop + 1 && o.state !== 'hit') { o.state = 'hit'; this.hits++; }
                if (oRight < pLeft && o.state === 'pending') { o.state = 'cleared'; this.cleared++; }
            } else if (oRight < pLeft && o.state === 'pending') {
                o.state = 'missed'; this.hits++;
            }
            if (o.worldX - o.w/2 < this.cameraX - W*0.25) this.obstacles.splice(i, 1);
        }

        this.drawObstacles();
        this.drawPlayer(charW);
        this.refreshDerived();
        this.updateReadout();
    }

    drawObstacles() {
        const g = this.obsGfx; g.clear();
        for (const o of this.obstacles) {
            const sx = o.worldX - this.cameraX;
            if (sx + o.w/2 < -10 || sx - o.w/2 > W + 10) continue;
            const oTop = GROUND_Y - o.h;
            if (this.platformMode) {
                // floating ledge you land on; the gap below shows the ground
                const thick = Phaser.Math.Clamp(o.h, H*0.02, H*0.045);
                const topCol = o.state === 'landed' ? 0x63d19b : o.state === 'missed' ? 0xcaa06a : 0x74c98a;
                g.fillStyle(0x6b563a); g.fillRoundedRect(sx - o.w/2, oTop, o.w, thick, thick*0.35);
                g.fillStyle(topCol);   g.fillRoundedRect(sx - o.w/2, oTop, o.w, Math.max(6, H*0.008), 4);
            } else {
                const base = o.state === 'hit' ? 0xef6b6b : o.state === 'cleared' ? 0x63d19b : 0xff8fa3;
                const rr = Math.min(o.w*0.3, o.h*0.3, H*0.022);
                g.fillStyle(base); g.fillRoundedRect(sx - o.w/2, oTop, o.w, o.h, rr);
                if (o.h > H*0.04 && o.w > GW*0.055) {
                    const fr = Math.min(o.w, o.h)*0.5, fy = oTop + Math.min(o.h*0.42, o.w*0.5);
                    g.fillStyle(0x3a2e33); g.fillCircle(sx - fr*0.3, fy, fr*0.13); g.fillCircle(sx + fr*0.3, fy, fr*0.13);
                    g.lineStyle(Math.max(2, fr*0.1), 0x3a2e33, 1);
                    g.beginPath(); g.arc(sx, fy + fr*0.62, fr*0.26, Math.PI*1.18, Math.PI*1.82); g.strokePath();
                }
            }
        }
    }

    drawPlayer(charW) {
        const g = this.playerGfx; g.clear();
        const x = PLAYER_X, charH = H * LIVE.playerHRatio, top = this.feetY - charH;
        if (this.useChar(0, x, top + charH/2, charW*1.9, charH)) return;
        const bw = charW*1.5, bh = charH*0.84, bx = x - bw/2, by = top;
        g.fillStyle(0x000000, 0.16); g.fillEllipse(x, this.feetY + charH*0.03, bw*0.78, charH*0.08);
        g.fillStyle(0x5b52d6); g.fillRoundedRect(x - bw*0.32, by + bh*0.88, bw*0.27, charH*0.17, charH*0.05);
        g.fillStyle(0x5b52d6); g.fillRoundedRect(x + bw*0.05, by + bh*0.88, bw*0.27, charH*0.17, charH*0.05);
        g.fillStyle(0x8b7dff); g.fillRoundedRect(bx, by, bw, bh, bw*0.42);
        g.fillStyle(0xa79dff, 0.45); g.fillRoundedRect(bx + bw*0.13, by + bh*0.08, bw*0.36, bh*0.36, bw*0.18);
        this.face(g, x, by + bh*0.52, bw*0.5, { spread: 0.42, eyeY: 0.05, mouthR: 0.3, mouthY: 0.24 });
    }

    updateReadout() {
        let line1;
        if (!this.derivedOK) {
            line1 = `⚠ Can't clear — ${this.mode === 'jump' ? 'raise Speed / Air Time, or shrink Obstacle' : 'raise Jump Height / shrink Obstacle'}`;
        } else if (this.mode === 'jump') {
            line1 = `JUMP HEIGHT ${(LIVE.jumpHeightRatio*100).toFixed(1)}%H  (${Math.round(this.bandT*100)}% Easy→Hard;  E ${(this.bandEasy*100).toFixed(1)} / H ${(this.bandHard*100).toFixed(1)})`;
        } else {
            line1 = `MOVE SPEED min = ${LIVE.moveSpeedRatio.toFixed(2)}W  (pacing floor — faster cuts reaction time)`;
        }
        const ctl = this.control === 'manual' ? 'MANUAL — hold ▶ + jump' : 'AUTO — tap to jump';
        const tally = this.platformMode ? `landed ${this.cleared} · missed ${this.hits}` : `cleared ${this.cleared} · hit ${this.hits}`;
        this.readout.setText(`${line1}\n${ctl}    ${tally}`);
        this.readout.setColor(this.derivedOK ? '#979aa8' : '#e74c3c');
    }

    buildPanel() {
        this.reg(this.add.rectangle(PW/2, H/2, PW, H, 0x17181f, 0.98).setDepth(50));
        this.reg(this.add.rectangle(PW, H/2, 1.5, H, 0x24262f).setDepth(50));
        const _t = this.reg(this.add.text(PW*0.06, H*0.028, '⚙ PLATFORMER', {
            fontSize: `${GW*0.028}px`, color: '#e8e9ef', fontStyle: 'bold'
        }).setOrigin(0, 0.5).setDepth(60));
        this.reg(this.add.text(_t.x + _t.width + GW*0.02, H*0.028, '平台跳跃', {
            fontSize: `${GW*0.02}px`, color: '#6d7080'
        }).setOrigin(0, 0.5).setDepth(60));

        // blocks-role toggle (full-width row) — obstacles you jump OVER vs platforms you land ON
        const blkStr = this.platformMode ? 'MODE: PLATFORMS ▣' : 'MODE: OBSTACLES ▮';
        const blkBtn = this.reg(this.add.rectangle(PW*0.5, H*0.064, PW*0.88, H*0.032, 0x24262f)
            .setStrokeStyle(1.5, this.platformMode ? 0x2ecc71 : 0xe67e22).setInteractive().setDepth(60));
        this.reg(this.add.text(PW*0.5, H*0.064, blkStr, {
            fontSize: `${GW*0.02}px`, color: '#e8e9ef', fontStyle: 'bold'
        }).setOrigin(0.5).setDepth(61));
        blkBtn.on('pointerup', () => this.togglePlatformMode());

        // control toggle (left) + compute toggle (right)
        const ctlStr = this.control === 'manual' ? 'RUN: MANUAL' : 'RUN: AUTO';
        const cbtn = this.reg(this.add.rectangle(PW*0.28, H*0.106, PW*0.42, H*0.032, 0x24262f)
            .setStrokeStyle(1.5, 0x3a3d4a).setInteractive().setDepth(60));
        this.reg(this.add.text(PW*0.28, H*0.106, ctlStr, {
            fontSize: `${GW*0.019}px`, color: '#e8e9ef', fontStyle: 'bold'
        }).setOrigin(0.5).setDepth(61));
        cbtn.on('pointerup', () => { this.control = this.control === 'manual' ? 'auto' : 'manual'; this.rebuildPanel(); this.applyControlVisibility(); });

        const modeStr = this.mode === 'jump' ? 'COMPUTE ▶ JUMP' : 'COMPUTE ▶ SPEED';
        const btn = this.reg(this.add.rectangle(PW*0.72, H*0.106, PW*0.42, H*0.032, 0x24262f)
            .setStrokeStyle(1.5, 0x3a3d4a).setInteractive().setDepth(60));
        this.reg(this.add.text(PW*0.72, H*0.106, modeStr, {
            fontSize: `${GW*0.019}px`, color: '#e8e9ef', fontStyle: 'bold'
        }).setOrigin(0.5).setDepth(61));
        btn.on('pointerup', () => { this.mode = this.mode === 'jump' ? 'speed' : 'jump'; this.rebuildPanel(); });

        const rows = [
            { key: 'jump',  label: 'Jump Height',     min: 0.06, max: 0.28, get: () => LIVE.jumpHeightRatio, set: v => LIVE.jumpHeightRatio = v, fmt: v => `${(v*100).toFixed(1)}%H` },
            { key: 'air',   label: 'Air Time',        min: 0.35, max: 1.50, get: () => LIVE.airTime,         set: v => LIVE.airTime         = v, fmt: v => `${v.toFixed(2)}s`, markers: FEEL_MARKERS },
            { key: 'obsH',  label: this.platformMode ? 'Step Up' : 'Obstacle Height', min: 0.02, max: 0.20, get: () => LIVE.obsHRatio, set: v => LIVE.obsHRatio = v, fmt: v => `${(v*100).toFixed(1)}%H` },
            { key: 'obsW',  label: this.platformMode ? 'Platform Length' : 'Obstacle Width',  min: 0.02, max: 0.25, get: () => LIVE.obsWRatio, set: v => LIVE.obsWRatio = v, fmt: v => this.platformMode ? `${(Phaser.Math.Clamp(v*4,0.20,0.70)*100).toFixed(0)}%W` : `${(v*100).toFixed(1)}%W` },
            { key: 'plrW',  label: 'Player Width',    min: 0.02, max: 0.18, get: () => LIVE.playerWRatio,    set: v => LIVE.playerWRatio    = v, fmt: v => `${(v*100).toFixed(1)}%W` },
            { key: 'plrH',  label: 'Player Height',   min: 0.05, max: 0.20, get: () => LIVE.playerHRatio,    set: v => LIVE.playerHRatio    = v, fmt: v => `${(v*100).toFixed(1)}%H` },
            { key: 'speed', label: 'Move Speed',      min: 0.12, max: 0.70, get: () => LIVE.moveSpeedRatio,  set: v => LIVE.moveSpeedRatio  = v, fmt: v => `${v.toFixed(2)}W` },
        ];
        const derivedKey = this.mode === 'jump' ? 'jump' : 'speed';

        let sy = H*0.17;
        const gap = H*0.05;
        for (const r of rows) {
            if (r.key === derivedKey) this.renderDerived(r, sy);
            else                      this.mkSlider(r, sy);
            sy += gap;
        }

        // DIFFICULTY presets — snap the jump-height handle (Easy↔Hard). Feel presets = the Air-Time markers.
        sy += H*0.01;
        this.reg(this.add.text(PW*0.06, sy, 'DIFFICULTY', { fontSize: `${GW*0.022}px`, color: '#979aa8', fontStyle: 'bold' }).setOrigin(0, 0.5).setDepth(60));
        sy += H*0.038;
        this.presetBtn('EASY',   PW*0.20, sy, 0x2ecc71, () => { this.bandT = 0;   });
        this.presetBtn('NORMAL', PW*0.5,  sy, 0xf1c40f, () => { this.bandT = 0.5; });
        this.presetBtn('HARD',   PW*0.80, sy, 0xe74c3c, () => { this.bandT = 1;   });
    }

    presetBtn(label, x, y, col, cb) {
        const b = this.reg(this.add.rectangle(x, y, PW*0.26, H*0.032, 0x24262f).setStrokeStyle(1.5, col).setInteractive().setDepth(60));
        this.reg(this.add.text(x, y, label, { fontSize: `${GW*0.019}px`, color: '#' + col.toString(16).padStart(6,'0'), fontStyle: 'bold' }).setOrigin(0.5).setDepth(61));
        b.on('pointerup', cb);
    }

    rebuildPanel() {
        this.panelObjs.forEach(o => o.destroy());
        this.panelObjs = [];
        this.derived = null;
        this.buildPanel();
    }

    togglePlatformMode() {
        this.platformMode = !this.platformMode;
        // fresh start so block states/positions match the new role
        this.obstacles  = [];
        this.nextSpawnX = this.cameraX + W * 0.9;
        this.feetY = GROUND_Y; this.prevFeetY = GROUND_Y; this.velY = 0; this.onGround = true;
        this.platY = 0.05;
        this.cleared = 0; this.hits = 0;
        this.rebuildPanel();
    }

    mkSlider(r, y) {
        const tx0 = PW*0.06, tx1 = PW*0.94, trackW = tx1 - tx0, ty = y + H*0.018;
        this.reg(this.add.text(tx0, y, r.label, { fontSize: `${GW*0.022}px`, color: '#9aa0b4' }).setOrigin(0, 0.5).setDepth(60));
        const valTxt = this.reg(this.add.text(tx1, y, r.fmt(r.get()), { fontSize: `${GW*0.022}px`, color: '#e8e9ef' }).setOrigin(1, 0.5).setDepth(60));
        const g = this.reg(this.add.graphics().setDepth(59));
        this.diffTrack(g, r, tx0, tx1, ty);
        if (r.markers) {
            for (const m of r.markers) {
                const mx = tx0 + (m.value - r.min)/(r.max - r.min) * trackW;
                g.lineStyle(2, 0x6c9fff, 0.8); g.lineBetween(mx, ty - H*0.008, mx, ty + H*0.008);
                this.reg(this.add.text(mx, ty + H*0.009, m.label, { fontSize: `${GW*0.015}px`, color: '#6c9fff' }).setOrigin(0.5, 0).setDepth(60));
            }
        }
        const knob = this.reg(this.add.circle(tx0 + (r.get() - r.min)/(r.max - r.min) * trackW, ty, GW*0.019, 0xf0a324)
            .setStrokeStyle(2, 0x17181f).setInteractive({ draggable: true }).setDepth(61));
        this.input.setDraggable(knob);
        knob.on('drag', (ptr, dragX) => {
            const cx = Phaser.Math.Clamp(dragX, tx0, tx1); knob.x = cx;
            const v = r.min + (cx - tx0)/trackW * (r.max - r.min);
            valTxt.setText(r.fmt(v)); r.set(v);
        });
    }

    renderDerived(r, y) {
        const x0 = PW*0.06, x1 = PW*0.94, ty = y + H*0.018;
        this.reg(this.add.text(x0, y, r.label + '  ▸AUTO', { fontSize: `${GW*0.022}px`, color: '#e8e9ef' }).setOrigin(0, 0.5).setDepth(60));
        const text = this.reg(this.add.text(x1, y, '', { fontSize: `${GW*0.021}px`, color: '#e8e9ef', fontStyle: 'bold' }).setOrigin(1, 0.5).setDepth(60));
        const g = this.reg(this.add.graphics().setDepth(59));

        if (r.key === 'jump') {            // draggable difficulty handle — pick where in the Easy↔Hard jump-height band the game runs
            const handle = this.reg(this.add.circle(x0, ty, GW*0.022, 0xffffff).setStrokeStyle(3, 0x17181f).setInteractive({ draggable: true }).setDepth(62));
            this.input.setDraggable(handle);
            const xOf = ratio => x0 + (Phaser.Math.Clamp(ratio, r.min, r.max) - r.min)/(r.max - r.min) * (x1 - x0);
            handle.on('dragstart', () => { this.draggingRun = true; });
            handle.on('dragend',   () => { this.draggingRun = false; });
            handle.on('drag', (ptr, dragX) => {
                const exPos = xOf(this.bandEasy), hxPos = xOf(this.bandHard);
                const lo = Math.min(exPos, hxPos), hi = Math.max(exPos, hxPos);
                const cx = Phaser.Math.Clamp(dragX, lo, hi);
                handle.x = cx;
                const span = hxPos - exPos;
                this.bandT = Math.abs(span) < 1 ? 0 : Phaser.Math.Clamp((cx - exPos)/span, 0, 1);
            });
            this.derived = { type: 'range', r, g, text, handle, x0, x1, y: ty };
        } else {
            g.lineStyle(4, 0x2e313c); g.lineBetween(x0, ty, x1, ty);
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
            g.lineStyle(8, this.derivedOK ? 0x2e7d4f : 0x7d2e2e, 1); g.lineBetween(ex, y, hx, y);
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
            d.text.setText(`${r.fmt(val)} ${this.derivedOK ? '' : '⚠'}`);
            d.text.setColor(this.derivedOK ? '#979aa8' : '#e74c3c');
        }
    }
}

const config = {
    type: Phaser.WEBGL,
    width: windowWidth,
    height: windowHeight,
    transparent: false,
    backgroundColor: '#1e1e3e',
    canvas: window.canvas,
    scene: [LiveScene],
    input: { mouse: true, touch: true, keyboard: true },
};

new Phaser.Game(config);
