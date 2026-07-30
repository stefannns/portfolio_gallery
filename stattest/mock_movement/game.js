require('libs/tt-adapter.js');
const Phaser = require('libs/phaser.js');

const res = tt.getSystemInfoSync();
const windowWidth  = res.screenWidth;
const windowHeight = res.screenHeight;
const W = windowWidth, H = windowHeight;

// ─────────────────────────────────────────────────────────────────
// MOVEMENT — SUPER GROUP.  One configurable engine for the whole
// "move through a scrolling world" family. TWO independent object types:
//   • PLATFORMS  — safe, you LAND on them; the GAP between them is lethal
//     (fall off = fail). Knobs: Platform Length, Platform Gap, Platform Step
//     (height variation — platforms sit at varying heights).
//   • OBSTACLES  — lethal, you AVOID/jump them (touch = fail). Knobs:
//     Obstacle Width, Obstacle Height, Obstacle Gap. When platforms are on,
//     obstacles sit ON platform surfaces (never floating over gaps).
//   Plane SIDE (gravity+jump) | TOP (top-down). Presets snap the config.
// ─────────────────────────────────────────────────────────────────
const CFG = { plane: 'side', platforms: false, obstacles: true, auto: true, dir: 'right', moving: false };

const LIVE = {
    jumpHeight: 0.17,  airTime: 0.75,           // jump (side)
    platLength: 0.28,  platGap: 0.13, platStep: 0.06,   // platforms (×W, ×W, ×H)
    obsW: 0.06,        obsH: 0.09,    obsGap: 0.60,      // obstacles (×W, ×H, ×W spacing)
    playerW: 0.07,     playerH: 0.11,
    moveSpeed: 0.38,   scrollSpeed: 0.45,
};

const PRESETS = {
    'RUNNER':     { plane:'side', platforms:false, obstacles:true,  auto:true,  dir:'right', moving:false,
                    live:{ jumpHeight:0.17, airTime:0.72, obsW:0.06, obsH:0.09, obsGap:0.6,  scrollSpeed:0.5 } },
    'PLATFORMER': { plane:'side', platforms:true,  obstacles:false, auto:false, dir:'right', moving:false,
                    live:{ jumpHeight:0.19, airTime:0.9,  platLength:0.28, platGap:0.13, platStep:0.06, moveSpeed:0.44 } },
    'SPACE WARS': { plane:'top',  platforms:false, obstacles:true,  auto:true,  dir:'down',  moving:false,
                    live:{ obsW:0.09, obsH:0.06, obsGap:0.5, playerW:0.08, moveSpeed:0.55, scrollSpeed:0.32 } },
    'MOVING':     { plane:'side', platforms:false, obstacles:true,  auto:true,  dir:'right', moving:true,
                    live:{ jumpHeight:0.18, airTime:0.78, obsW:0.07, obsH:0.07, obsGap:0.7, scrollSpeed:0.42 } },
};

const GROUND_Y = H * 0.82, GROUND_H = H * 0.028;
const REST = GROUND_Y - GROUND_H/2;              // solid-ground feet rest
const PLAYER_SX = W * 0.28;
const TOP_PLAYER_Y = H * 0.80;
const CTRL_Y = H * 0.93;
const PLAT_TOP_HI = GROUND_Y - H*0.22, PLAT_TOP_LO = GROUND_Y - H*0.03;   // platform height band

class LiveScene extends Phaser.Scene {
    constructor() { super('LiveScene'); }

    create() {
        this.collapsed = false;
        this.pb = H * 0.42;

        this.add.rectangle(W/2, H/2, W, H, 0x161a26).setDepth(0);
        this.worldGfx  = this.add.graphics().setDepth(3);
        this.playerGfx = this.add.graphics().setDepth(6);

        this.tapZone = this.add.rectangle(W/2, H/2, W, H, 0x000000, 0).setInteractive().setDepth(2);
        this.tapZone.on('pointerdown', () => { if (CFG.plane === 'side') this.jump(); });
        if (this.input.keyboard) {
            const kb = this.input.keyboard;
            kb.on('keydown-SPACE', () => { this.fwdDown = true; this.jump(); }); kb.on('keyup-SPACE', () => this.fwdDown = false);
            kb.on('keydown-UP',    () => { this.fwdDown = true; this.jump(); }); kb.on('keyup-UP',    () => this.fwdDown = false);
            kb.on('keydown-LEFT',  () => this.moveDir = -1); kb.on('keyup-LEFT',  () => { if (this.moveDir<0) this.moveDir = 0; });
            kb.on('keydown-A',     () => this.moveDir = -1); kb.on('keyup-A',     () => { if (this.moveDir<0) this.moveDir = 0; });
            kb.on('keydown-RIGHT', () => this.moveDir =  1); kb.on('keyup-RIGHT', () => { if (this.moveDir>0) this.moveDir = 0; });
            kb.on('keydown-D',     () => this.moveDir =  1); kb.on('keyup-D',     () => { if (this.moveDir>0) this.moveDir = 0; });
        }

        this.btnL = this.ctrlBtn(W*0.13, CTRL_Y, '◀', () => this.moveDir = -1, () => this.moveDir = 0);
        this.btnR = this.ctrlBtn(W*0.87, CTRL_Y, '▶', () => this.moveDir =  1, () => this.moveDir = 0);
        this.btnJ = this.ctrlBtn(W*0.50, CTRL_Y, '▲', () => { this.fwdDown = true; if (CFG.plane === 'side') this.jump(); }, () => { this.fwdDown = false; });

        this.readout = this.add.text(W*0.05, this.pb + H*0.012, '', {
            fontSize: `${W*0.026}px`, color: '#9aa0b4', lineSpacing: 5
        }).setOrigin(0, 0).setDepth(48);

        this.moveDir = 0;
        this.panelObjs = [];
        this.applyPreset('RUNNER');
    }

    reg(o) { this.panelObjs.push(o); return o; }

    ctrlBtn(x, y, label, onDown, onUp) {
        const bg = this.add.rectangle(x, y, W*0.16, H*0.055, 0x232838, 0.92).setStrokeStyle(1.5, 0x3a3d4a).setInteractive().setDepth(40);
        const tx = this.add.text(x, y, label, { fontSize: `${W*0.045}px`, color: '#c8ccda' }).setOrigin(0.5).setDepth(41);
        bg.on('pointerdown', () => { bg.setFillStyle(0x323852); onDown(); });
        bg.on('pointerup',   () => { bg.setFillStyle(0x232838); onUp(); });
        bg.on('pointerout',  () => { bg.setFillStyle(0x232838); onUp(); });
        return { bg, tx };
    }

    refreshControls() {
        const side = CFG.plane === 'side';
        const showMove = (side && !CFG.auto) || !side;
        const showFwd  = side || (!side && !CFG.auto);
        this.btnL.bg.setVisible(showMove); this.btnL.tx.setVisible(showMove);
        this.btnR.bg.setVisible(showMove); this.btnR.tx.setVisible(showMove);
        this.btnJ.bg.setVisible(showFwd);  this.btnJ.tx.setVisible(showFwd);
    }

    applyPreset(name) {
        const p = PRESETS[name]; if (!p) return;
        CFG.plane = p.plane; CFG.platforms = p.platforms; CFG.obstacles = p.obstacles;
        CFG.auto = p.auto; CFG.dir = p.dir; CFG.moving = !!p.moving;
        Object.assign(LIVE, p.live);
        this.preset = name;
        this.resetRun();
        this.rebuildPanel();
        this.refreshControls();
    }

    resetRun() {
        this.worldX = 0;
        this.feetY = REST; this.velY = 0; this.onGround = true;
        this.px = W/2;
        this.plats = []; this.obs = [];
        this.nextPlatX = -W*0.5; this.lastPlatTopY = GROUND_Y - H*0.06;
        this.nextObsX = W*0.8;
        this.sinceSpawn = 1e9;
        this.ok = 0; this.bad = 0;
        this.flash = 0; this.fwdDown = false; this.mt = 0;
        this.topPlayerY = TOP_PLAYER_Y;
    }

    jump() {
        if (CFG.plane !== 'side' || !this.onGround) return;
        const arc = H*LIVE.jumpHeight, T = Math.max(0.2, LIVE.airTime);
        this.velY = -(4*arc/T);
        this.onGround = false;
    }

    // surface (feet-rest y) under a given world x; null = over a gap
    surfaceAt(wx) {
        if (!CFG.platforms) return REST;
        for (const p of this.plats) if (wx >= p.worldX && wx <= p.worldX + p.len) return p.topY;
        return null;
    }

    respawnSide() {
        this.bad++; this.flash = 220;
        let target = null;
        for (const p of this.plats) if (p.worldX + p.len > this.worldX + W*0.1) { target = p; break; }
        if (target) { this.worldX = target.worldX + target.len*0.4; this.feetY = target.topY; }
        else { this.feetY = REST; }
        this.velY = 0; this.onGround = true;
    }

    update(time, delta) {
        const dt = Math.min(delta/1000, 0.05);
        if (this.flash > 0) this.flash -= delta;
        if (CFG.plane === 'side') this.updateSide(dt, delta); else this.updateTop(dt, delta);
        this.draw();
        this.updateReadout();
    }

    updateSide(dt, delta) {
        const sSpd = W*LIVE.scrollSpeed, mSpd = W*LIVE.moveSpeed;
        const arc = H*LIVE.jumpHeight, T = Math.max(0.2, LIVE.airTime), grav = 8*arc/(T*T);
        this.mt += dt;
        const playerW = W*LIVE.playerW, playerH = H*LIVE.playerH;

        if (CFG.auto) this.worldX += sSpd*dt;
        else          this.worldX = Math.max(0, this.worldX + this.moveDir*mSpd*dt);

        // ── platform stream ──
        if (CFG.platforms) {
            const len = W*LIVE.platLength, gap = W*LIVE.platGap, step = H*LIVE.platStep;
            while (this.nextPlatX < this.worldX + W*1.4) {
                let ty = this.lastPlatTopY + (Math.random()*2 - 1)*step;
                ty = Phaser.Math.Clamp(ty, PLAT_TOP_HI, PLAT_TOP_LO);
                this.plats.push({ worldX: this.nextPlatX, len, topY: ty });
                this.lastPlatTopY = ty;
                this.nextPlatX += len + gap;
            }
            for (let i = this.plats.length - 1; i >= 0; i--)
                if (this.plats[i].worldX + this.plats[i].len < this.worldX - W) this.plats.splice(i, 1);
        }

        // ── gravity / landing / fall-death ──
        const surf = this.surfaceAt(this.worldX);
        this.velY += grav*dt; this.feetY += this.velY*dt;
        if (surf != null && this.velY >= 0 && this.feetY >= surf) { this.feetY = surf; this.velY = 0; this.onGround = true; }
        else this.onGround = false;
        if (surf == null && this.feetY > H*1.04) this.respawnSide();

        // ── obstacle stream (lethal) — sits on platform/ground surface ──
        if (CFG.obstacles) {
            const gap = W*LIVE.obsGap, h = H*LIVE.obsH, w = W*LIVE.obsW;
            while (this.nextObsX < this.worldX + W*1.4) {
                const s = this.surfaceAt(this.nextObsX);   // only place where there's footing
                if (s != null) {
                    const baseTop = CFG.moving ? s - h - H*0.16 : s - h;
                    this.obs.push({ worldX: this.nextObsX, w, h, baseTop, topY: baseTop, phase: Math.random()*6.28, state: 'pending' });
                }
                this.nextObsX += gap;
            }
            for (let i = this.obs.length - 1; i >= 0; i--) {
                const o = this.obs[i];
                if (CFG.moving) o.topY = o.baseTop + Math.sin(this.mt*3 + o.phase) * H*0.08;
                const dxw = Math.abs(this.worldX - o.worldX);
                const xOver = dxw < (playerW + o.w)/2;
                const yOver = this.feetY > o.topY && (this.feetY - playerH) < (o.topY + o.h);
                if (xOver && yOver && o.state === 'pending') { o.state = 'hit'; this.bad++; this.flash = 220; this.obs.splice(i, 1); continue; }
                if (o.worldX < this.worldX - (playerW/2 + o.w) && o.state === 'pending') { o.state = 'cleared'; this.ok++; }
                if (o.worldX < this.worldX - W) this.obs.splice(i, 1);
            }
        }
    }

    updateTop(dt, delta) {
        const mSpd = W*LIVE.moveSpeed, fall = H*LIVE.scrollSpeed;
        const playerW = W*LIVE.playerW, playerH = H*LIVE.playerH;
        this.mt += dt;
        const down = CFG.dir !== 'up';
        const playerY = down ? TOP_PLAYER_Y : this.pb + H*0.06;
        this.topPlayerY = playerY;
        const advancing = CFG.auto || this.fwdDown;

        this.px = Phaser.Math.Clamp(this.px + this.moveDir*mSpd*dt, playerW/2 + W*0.02, W - playerW/2 - W*0.02);

        if (CFG.obstacles) {
            const spawnMs = Phaser.Math.Clamp(1800 - LIVE.obsGap*1100, 260, 1600);
            this.sinceSpawn += delta;
            if (this.sinceSpawn >= spawnMs) {
                this.sinceSpawn = 0;
                const w = W*LIVE.obsW, h = H*LIVE.obsH;
                const bx = w/2 + W*0.03 + Math.random()*(W - w - W*0.06);
                this.obs.push({ x: bx, baseX: bx, y: down ? this.pb - h : H + h, w, h, phase: Math.random()*6.28, state: 'pending' });
            }
            for (let i = this.obs.length - 1; i >= 0; i--) {
                const e = this.obs[i];
                if (advancing) e.y += (down ? 1 : -1) * fall * dt;
                if (CFG.moving) e.x = Phaser.Math.Clamp(e.baseX + Math.sin(this.mt*2 + e.phase) * W*0.14, e.w/2, W - e.w/2);
                if (e.state === 'pending' && Math.abs(e.x - this.px) < (e.w + playerW)/2 && Math.abs(e.y - playerY) < (e.h + playerH)/2) {
                    e.state = 'hit'; this.bad++; this.flash = 220; this.obs.splice(i, 1); continue;
                }
                const gone = down ? e.y - e.h/2 > H : e.y + e.h/2 < this.pb;
                if (gone && e.state === 'pending') { e.state = 'dodged'; this.ok++; }
                if (gone) this.obs.splice(i, 1);
            }
        }
    }

    sxOf(worldX) {
        const d = worldX - this.worldX;
        return CFG.dir === 'right' ? PLAYER_SX + d : W - PLAYER_SX - d;
    }
    playerScreenX() { return CFG.dir === 'right' ? PLAYER_SX : W - PLAYER_SX; }

    draw() {
        const g = this.worldGfx; g.clear();
        const pg = this.playerGfx; pg.clear();
        if (CFG.plane === 'side') this.drawSide(g, pg); else this.drawTop(g, pg);
    }

    drawSide(g, pg) {
        g.fillStyle(0x1d2740); g.fillRect(0, this.pb, W, H - this.pb);

        if (CFG.platforms) {
            const thk = H*0.05;
            for (const p of this.plats) {
                const sxA = this.sxOf(p.worldX), sxB = this.sxOf(p.worldX + p.len);
                const x = Math.min(sxA, sxB), wpx = Math.abs(sxB - sxA);
                if (x > W + 10 || x + wpx < -10) continue;
                g.fillStyle(0x2e7d4f); g.fillRoundedRect(x, p.topY, wpx, thk, 8);
                g.fillStyle(0x3a9a63); g.fillRect(x, p.topY, wpx, H*0.008);
            }
        } else {
            g.fillStyle(0x2e7d4f); g.fillRect(0, REST, W, H - REST);
            g.fillStyle(0x3a9a63); g.fillRect(0, REST, W, H*0.006);
        }

        if (CFG.obstacles) for (const o of this.obs) {
            const sx = this.sxOf(o.worldX);
            if (sx < -o.w - 20 || sx > W + o.w + 20) continue;
            const col = o.state === 'hit' ? 0xef6b6b : 0xff8fa3;         // lethal = pink/red
            const rr = Math.min(o.w, o.h)*0.28;
            g.fillStyle(col); g.fillRoundedRect(sx - o.w/2, o.topY, o.w, o.h, rr);
            if (o.h > H*0.045 && o.w > W*0.05) {
                const fr = Math.min(o.w, o.h)*0.5, fy = o.topY + Math.min(o.h*0.42, o.w*0.5);
                g.fillStyle(0x3a2e33); g.fillCircle(sx - fr*0.3, fy, fr*0.13); g.fillCircle(sx + fr*0.3, fy, fr*0.13);
                g.lineStyle(Math.max(2, fr*0.1), 0x3a2e33, 1);
                g.beginPath(); g.arc(sx, fy + fr*0.62, fr*0.26, Math.PI*1.18, Math.PI*1.82); g.strokePath();
            }
        }

        const px = this.playerScreenX(), charW = W*LIVE.playerW, charH = H*LIVE.playerH, top = this.feetY - charH;
        pg.fillStyle(0x000000, 0.16); pg.fillEllipse(px, this.feetY + charH*0.02, charW*1.5, charH*0.08);
        pg.fillStyle(this.flash > 0 ? 0xef6b6b : 0x8b7dff); pg.fillRoundedRect(px - charW/2, top, charW, charH, charW*0.42);
        this.face(pg, px, top + charH*0.42, charW*0.55, { spread: 0.42, eyeY: 0.05, mouthR: 0.3, mouthY: 0.24 });
    }

    drawTop(g, pg) {
        g.fillStyle(0x1d2740); g.fillRect(0, this.pb, W, H - this.pb);
        if (CFG.obstacles) for (const e of this.obs) {
            const col = e.state === 'hit' ? 0xef6b6b : 0xff8fa3, r = e.w/2;
            g.fillStyle(col); g.fillCircle(e.x, e.y, r);
            g.fillStyle(col); g.fillCircle(e.x - r*0.5, e.y - r*0.66, r*0.26); g.fillCircle(e.x + r*0.5, e.y - r*0.66, r*0.26);
            g.fillStyle(0x2d2d3a); g.fillCircle(e.x - r*0.3, e.y - r*0.05, r*0.13); g.fillCircle(e.x + r*0.3, e.y - r*0.05, r*0.13);
        }
        const px = this.px, y = this.topPlayerY || TOP_PLAYER_Y, shipW = W*LIVE.playerW, shipH = H*LIVE.playerH;
        pg.fillStyle(0xffb03a, 0.9); pg.fillTriangle(px, y + shipH*0.7, px - shipW*0.15, y + shipH*0.4, px + shipW*0.15, y + shipH*0.4);
        pg.fillStyle(this.flash > 0 ? 0xef6b6b : 0x5ec8ff); pg.fillRoundedRect(px - shipW*0.42, y - shipH*0.44, shipW*0.84, shipH*0.86, shipW*0.42);
        this.face(pg, px, y - shipH*0.04, shipW*0.4, { spread: 0.4, eyeY: 0.08, mouthR: 0.26, mouthY: 0.3, cheeks: false });
    }

    face(g, cx, cy, r, o) {
        o = o || {};
        const ink = 0x3a3340, ex = r*(o.spread||0.4), ey = cy - r*(o.eyeY||0.1), er = r*(o.eyeR||0.15);
        if (o.cheeks !== false) { g.fillStyle(0xff7a9c, 0.32); g.fillCircle(cx - r*0.6, cy + r*0.22, r*0.16); g.fillCircle(cx + r*0.6, cy + r*0.22, r*0.16); }
        g.fillStyle(ink, 1); g.fillCircle(cx - ex, ey, er); g.fillCircle(cx + ex, ey, er);
        g.fillStyle(0xffffff, 0.95); g.fillCircle(cx - ex + er*0.32, ey - er*0.34, er*0.4); g.fillCircle(cx + ex + er*0.32, ey - er*0.34, er*0.4);
        g.lineStyle(Math.max(2, r*0.11), ink, 1);
        g.beginPath(); g.arc(cx, cy + r*(o.mouthY!=null?o.mouthY:0.2), r*(o.mouthR!=null?o.mouthR:0.28), Math.PI*0.15, Math.PI*0.85); g.strokePath();
    }

    updateReadout() {
        const parts = [this.preset, CFG.plane.toUpperCase()];
        if (CFG.platforms) parts.push('platforms');
        if (CFG.obstacles) parts.push('obstacles');
        parts.push(CFG.plane==='side' ? (CFG.auto?'auto':'manual') : (CFG.auto?'auto':'thrust'));
        const okLbl = CFG.plane === 'top' ? 'dodged' : 'cleared';
        this.readout.setText(`${parts.join(' · ')}\n${okLbl} ${this.ok} · fail ${this.bad}`);
    }

    // ── panel ─────────────────────────────────────────────────────
    buildPanel() {
        const HY = H*0.023;
        this.reg(this.add.rectangle(W/2, 0, W, 10, 0x17181f, 0.96).setOrigin(0.5, 0).setDepth(50));
        const bg = this.panelObjs[0];
        this.mkCollapse(W*0.055, HY);
        const _t = this.reg(this.add.text(W*0.115, HY, '⚙ MOVEMENT', { fontSize: `${W*0.030}px`, color: '#e8e9ef', fontStyle: 'bold' }).setOrigin(0, 0.5).setDepth(60));
        this.reg(this.add.text(_t.x + _t.width + W*0.022, HY, '移动', { fontSize: `${W*0.024}px`, color: '#6d7080' }).setOrigin(0, 0.5).setDepth(60));

        if (this.collapsed) { this.pb = H*0.054; bg.setSize(W, this.pb); this.finishPanel(bg); return; }

        let cy = H*0.056;
        const presets = Object.keys(PRESETS);
        const pw = W*0.90 / presets.length, px0 = W*0.05;
        presets.forEach((name, i) => {
            const cx = px0 + pw*i + pw/2, on = this.preset === name;
            const b = this.reg(this.add.rectangle(cx, cy, pw*0.92, H*0.032, on ? 0x2b3350 : 0x1f2230).setStrokeStyle(1.5, on ? 0xf0a324 : 0x3a3d4a).setInteractive().setDepth(60));
            this.reg(this.add.text(cx, cy, name, { fontSize: `${W*0.019}px`, color: on ? '#f0a324' : '#c8ccda', fontStyle: 'bold' }).setOrigin(0.5).setDepth(61));
            b.on('pointerup', () => this.applyPreset(name));
        });
        cy += H*0.044;

        const side = CFG.plane === 'side';
        const chips = [
            { label:'Plane',     val: side?'SIDE':'TOP', en:true, tap:()=>{ CFG.plane = side?'top':'side'; CFG.dir = side?'down':'right'; } },
            { label:'Platforms', val: CFG.platforms?'ON':'OFF', en:side, tap:()=>CFG.platforms=!CFG.platforms },
            { label:'Obstacles', val: CFG.obstacles?'ON':'OFF', en:true, tap:()=>CFG.obstacles=!CFG.obstacles },
            { label:'Scroll',    val: CFG.auto?'AUTO':'MANUAL', en:true, tap:()=>CFG.auto=!CFG.auto },
            { label:'Direction', val: side?(CFG.dir==='right'?'→':'←'):(CFG.dir==='down'?'↓':'↑'), en:true, tap:()=> side ? (CFG.dir=CFG.dir==='right'?'left':'right') : (CFG.dir=CFG.dir==='down'?'up':'down') },
            { label:'Motion',    val: CFG.moving?'MOVING':'STATIC', en:CFG.obstacles, tap:()=>CFG.moving=!CFG.moving },
        ];
        for (let i = 0; i < chips.length; i += 2) {
            this.mkChip(chips[i], W*0.05, cy, W*0.43);
            if (chips[i+1]) this.mkChip(chips[i+1], W*0.52, cy, W*0.43);
            cy += H*0.040;
        }
        cy += H*0.006;

        const R = {
            jump:  { label:'Jump Height',    min:0.06, max:0.28, get:()=>LIVE.jumpHeight, set:v=>LIVE.jumpHeight=v, fmt:v=>`${(v*100)|0}%H`, dir:'easier' },
            air:   { label:'Air Time',       min:0.35, max:1.5,  get:()=>LIVE.airTime,    set:v=>LIVE.airTime=v,    fmt:v=>`${v.toFixed(2)}s`, dir:'feel' },
            pLen:  { label:'Platform Length',min:0.15, max:0.5,  get:()=>LIVE.platLength, set:v=>LIVE.platLength=v, fmt:v=>`${(v*100)|0}%W`, dir:'easier' },
            pGap:  { label:'Platform Gap',   min:0.05, max:0.32, get:()=>LIVE.platGap,    set:v=>LIVE.platGap=v,    fmt:v=>`${(v*100)|0}%W`, dir:'harder' },
            pStep: { label:'Platform Step',  min:0.0,  max:0.14, get:()=>LIVE.platStep,   set:v=>LIVE.platStep=v,   fmt:v=>`${(v*100)|0}%H`, dir:'harder' },
            oW:    { label: side?'Obstacle Width':'Enemy Width',   min:0.03, max:0.20, get:()=>LIVE.obsW, set:v=>LIVE.obsW=v, fmt:v=>`${(v*100)|0}%W`, dir:'neutral' },
            oH:    { label: side?'Obstacle Height':'Enemy Height', min:0.03, max:0.20, get:()=>LIVE.obsH, set:v=>LIVE.obsH=v, fmt:v=>`${(v*100)|0}%H`, dir:'harder' },
            oGap:  { label: side?'Obstacle Gap':'Enemy Gap',       min:0.3,  max:1.2,  get:()=>LIVE.obsGap, set:v=>LIVE.obsGap=v, fmt:v=>`${(v*100)|0}`, dir:'easier' },
            plW:   { label:'Player Width',   min:0.03, max:0.16, get:()=>LIVE.playerW, set:v=>LIVE.playerW=v, fmt:v=>`${(v*100)|0}%W`, dir:'neutral' },
            plH:   { label:'Player Height',  min:0.05, max:0.20, get:()=>LIVE.playerH, set:v=>LIVE.playerH=v, fmt:v=>`${(v*100)|0}%H`, dir:'neutral' },
            move:  { label: side?'Move Speed':'Dodge Speed', min:0.12, max:0.80, get:()=>LIVE.moveSpeed,  set:v=>LIVE.moveSpeed=v,  fmt:v=>`${v.toFixed(2)}`, dir:'neutral' },
            scr:   { label: side?'Scroll Speed':'Fall Speed', min:0.12, max:0.80, get:()=>LIVE.scrollSpeed, set:v=>LIVE.scrollSpeed=v, fmt:v=>`${v.toFixed(2)}`, dir:'harder' },
        };
        R.jump.en = side; R.air.en = side;
        R.pLen.en = side && CFG.platforms; R.pGap.en = side && CFG.platforms; R.pStep.en = side && CFG.platforms;
        R.oW.en = CFG.obstacles; R.oH.en = CFG.obstacles; R.oGap.en = CFG.obstacles;
        R.plW.en = true; R.plH.en = true;
        R.move.en = !(side && CFG.auto);
        R.scr.en  = !(side && !CFG.auto);
        const rows = [R.jump, R.air, R.pLen, R.pGap, R.pStep, R.oW, R.oH, R.oGap, R.plW, R.plH, R.move, R.scr];
        for (const r of rows) { this.mkSlider(r, cy); cy += H*0.0315; }

        this.pb = cy + H*0.01;
        bg.setSize(W, this.pb);
        this.finishPanel(bg);
    }

    finishPanel(bg) {
        this.reg(this.add.rectangle(W/2, this.pb, W, 1.5, 0x24262f).setDepth(50));
        if (this.readout) this.readout.y = this.pb + H*0.012;
    }

    rebuildPanel() { this.panelObjs.forEach(o => o.destroy()); this.panelObjs = []; this.buildPanel(); }

    mkCollapse(x, y) {
        const b = this.reg(this.add.rectangle(x, y, W*0.075, H*0.030, 0x24262f).setStrokeStyle(1.5, 0x3a3d4a).setInteractive().setDepth(60));
        this.reg(this.add.text(x, y, this.collapsed ? '▾' : '▴', { fontSize: `${W*0.026}px`, color: '#979aa8' }).setOrigin(0.5).setDepth(61));
        b.on('pointerup', () => { this.collapsed = !this.collapsed; this.rebuildPanel(); });
    }

    mkChip(c, x, y, w) {
        const en = c.en !== false;
        const b = this.reg(this.add.rectangle(x, y, w, H*0.034, en ? 0x1f2230 : 0x191b24).setStrokeStyle(1.5, en ? 0x3a3d4a : 0x2a2c36).setDepth(60).setOrigin(0, 0.5));
        this.reg(this.add.text(x + W*0.02, y, c.label, { fontSize: `${W*0.022}px`, color: en ? '#9aa0b4' : '#565b6b' }).setOrigin(0, 0.5).setDepth(61));
        this.reg(this.add.text(x + w - W*0.02, y, c.val, { fontSize: `${W*0.023}px`, color: en ? '#f0a324' : '#565b6b', fontStyle: 'bold' }).setOrigin(1, 0.5).setDepth(61));
        if (en) { b.setInteractive(); b.on('pointerup', () => { c.tap(); this.resetRun(); this.rebuildPanel(); this.refreshControls(); }); }
    }

    diffTrack(g, r, x0, x1, y) {
        const d = r.dir || 'neutral';
        const lerp = (a,b,t)=>{const f=(s)=>[(s>>16)&255,(s>>8)&255,s&255];const A=f(a),B=f(b);return((A[0]+(B[0]-A[0])*t|0)<<16)|((A[1]+(B[1]-A[1])*t|0)<<8)|(A[2]+(B[2]-A[2])*t|0);};
        if (d==='harder'||d==='easier') { const A=d==='harder'?0x2ecc71:0xe74c3c, B=d==='harder'?0xe74c3c:0x2ecc71, N=18;
            for(let i=0;i<N;i++){g.lineStyle(6,lerp(A,B,(i+0.5)/N),1);g.lineBetween(x0+(x1-x0)*i/N,y,x0+(x1-x0)*(i+1)/N,y);} }
        else if (d==='feel') { g.lineStyle(4,0xf1c40f,0.4); g.lineBetween(x0,y,x1,y); }
        else { g.lineStyle(4,0x565a68); g.lineBetween(x0,y,x1,y); }
    }
    dirTag(r, y) {
        const d = r.dir || 'neutral'; if (d==='neutral') return;
        const M={harder:['harder ↑','#c8ccda'],easier:['easier ↑','#c8ccda'],feel:['FEEL','#f1c40f']};
        this.reg(this.add.text(W*0.415, y, M[d][0], {fontSize:`${W*0.018}px`,color:M[d][1],fontStyle:'bold'}).setOrigin(1,0.5).setDepth(62));
    }

    mkSlider(r, y) {
        const en = r.en !== false;
        const x0 = W*0.42, x1 = W*0.80, trackW = x1 - x0;
        this.reg(this.add.text(W*0.05, y, r.label, { fontSize: `${W*0.024}px`, color: en ? '#9aa0b4' : '#565b6b' }).setOrigin(0, 0.5).setDepth(60));
        const valTxt = this.reg(this.add.text(W*0.965, y, r.fmt(r.get()), { fontSize: `${W*0.024}px`, color: en ? '#e8e9ef' : '#565b6b' }).setOrigin(1, 0.5).setDepth(60));
        const g = this.reg(this.add.graphics().setDepth(59));
        if (en) { this.diffTrack(g, r, x0, x1, y); this.dirTag(r, y); }
        else { g.lineStyle(4, 0x33363f); g.lineBetween(x0, y, x1, y); }
        const knob = this.reg(this.add.circle(x0 + (r.get() - r.min)/(r.max - r.min) * trackW, y, W*0.018, en ? 0xf0a324 : 0x4a4e5c).setStrokeStyle(2, 0x17181f).setDepth(61));
        if (en) {
            knob.setInteractive({ draggable: true });
            this.input.setDraggable(knob);
            knob.on('drag', (ptr, dragX) => {
                const cx = Phaser.Math.Clamp(dragX, x0, x1); knob.x = cx;
                const v = r.min + (cx - x0)/trackW * (r.max - r.min);
                valTxt.setText(r.fmt(v)); r.set(v);
            });
        }
    }
}

const config = {
    type: Phaser.WEBGL,
    width: windowWidth,
    height: windowHeight,
    transparent: false,
    backgroundColor: '#161a26',
    canvas: window.canvas,
    scene: [LiveScene],
    input: { mouse: true, touch: true, keyboard: true },
};

new Phaser.Game(config);
