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
// VERTICAL SCROLLER — LIVE TUNING.  Dodge-capability model:
//   The ship must be able to cross the open field (= playW − shipW − enemyW)
//   within the time an enemy takes to fall the full play height, so it can
//   always relocate away from an aimed enemy.
//   → min ship speed = crossDist · enemySpeed / playH
//   → max enemy speed = playH · moveSpeed / crossDist
// (Single-enemy lateral dodge is trivial; field-crossing is the real driver.)
// ─────────────────────────────────────────────────────────────────
const LIVE = {
    moveSpeedRatio:  0.40,   // ship lateral speed (×W /s)
    enemySpeedRatio: 0.18,   // enemy fall speed   (×H /s)
    enemyWRatio:     0.09,   // enemy width        (×W)
    shipWRatio:      0.08,   // ship width         (×W)
    shipHRatio:      0.07,   // ship height        (×H)
    spawnRate:       900,    // spawn interval     (ms) — density (input only)
};

const EASY_SPD  = 1.60, HARD_SPD  = 1.20;   // ×dodge-floor  (faster ship = easier to dodge)
const EASY_ENEM = 0.90, HARD_ENEM = 1.50;   // ×enemy-max    (faster enemy = harder)
const SKY_TOP   = H * 0.03;
const SKY_BOT   = H - 161;
const SHIP_H    = H * 0.07;
const ENEMY_H   = H * 0.05;
const SHIP_Y    = SKY_BOT - SHIP_H/2 - H*0.01;
const PLAY_W    = GW * 0.96;
const PLAY_H    = SKY_BOT - SKY_TOP;

class LiveScene extends Phaser.Scene {
    constructor() { super('LiveScene'); }

    create() {
        this.mode = 'enemy';    // compute target: 'move' (ship speed) | 'enemy' (enemy speed)
        this.derivedOK = true;
        this.collapsed = false;
        this.initCharacter(8);
        this.bandEasy = 0; this.bandHard = 0;
        this.bandT = 0.5;      // opens mid-band (field-cross max is conservative → push faster)
        this.draggingRun = false;

        this.add.rectangle(W/2, H/2, W, H, 0x161a26).setDepth(0);
        this.add.rectangle(GCX, H/2, GW, H, 0x0a0a1e).setDepth(0.4);
        const starG = this.add.graphics().setDepth(0.5);
        for (let i = 0; i < 70; i++) { starG.fillStyle(0xffffff, 0.2 + Math.random()*0.5); starG.fillCircle(GX0 + Math.random()*GW, SKY_TOP + Math.random()*(SKY_BOT-SKY_TOP), Math.random()*2+1); }

        this.shipX     = GCX;
        this.moveDir   = 0;
        this.enemies   = [];
        this.sinceSpawn = 1e9;
        this.dodged    = 0;
        this.hits      = 0;

        this.enemyGfx = this.add.graphics().setDepth(4);
        this.shipGfx  = this.add.graphics().setDepth(6);

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
        try { data = localStorage.getItem('genrelab:char:mock_vscroller'); } catch (e) {}
        if (!data) return;
        const key = 'usrchar_mock_vscroller';
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


    _dir(r) { return ({"Ship Speed":"neutral","Enemy Width":"neutral","Ship Width":"neutral","Spawn Rate":"easier"})[r.label] || 'neutral'; }
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
        const bg = this.add.rectangle(x, y, W*0.16, H*0.06, 0x16294a, 0.9).setStrokeStyle(2, 0x33d6ff).setInteractive().setDepth(40);
        const tx = this.add.text(x, y, label, { fontSize: `${W*0.05}px`, color: '#33d6ff' }).setOrigin(0.5).setDepth(41);
        bg.on('pointerdown', () => { bg.setFillStyle(0x244a7a); onDown(); });
        bg.on('pointerup',   () => { bg.setFillStyle(0x16294a); onUp(); });
        bg.on('pointerout',  () => { bg.setFillStyle(0x16294a); onUp(); });
        return { bg, tx };
    }

    recompute() {
        const shipW = W * LIVE.shipWRatio, enemyW = W * LIVE.enemyWRatio;
        const crossDist = Math.max(W*0.10, PLAY_W - shipW - enemyW);        // open field to traverse
        if (this.mode === 'move') {
            const enemySpeed = H * LIVE.enemySpeedRatio;
            const floor = crossDist * enemySpeed / PLAY_H;                  // px/s to cross within one descent
            this.bandEasy = Phaser.Math.Clamp(floor * EASY_SPD / GW, 0.12, 0.80);
            this.bandHard = Phaser.Math.Clamp(floor * HARD_SPD / GW, 0.12, 0.80);
            this.derivedOK = (floor * HARD_SPD / GW) <= 0.80;
            LIVE.moveSpeedRatio = this.bandEasy + (this.bandHard - this.bandEasy) * this.bandT;
        } else {
            const moveSpeed = GW * LIVE.moveSpeedRatio;
            const enemyMax = PLAY_H * moveSpeed / crossDist;                // px/s
            this.bandEasy = Phaser.Math.Clamp(enemyMax * EASY_ENEM / H, 0.08, 0.60);
            this.bandHard = Phaser.Math.Clamp(enemyMax * HARD_ENEM / H, 0.08, 0.60);
            this.derivedOK = (enemyMax * EASY_ENEM / H) <= 0.60;
            LIVE.enemySpeedRatio = this.bandEasy + (this.bandHard - this.bandEasy) * this.bandT;
        }
    }

    update(time, delta) {
        const dt = Math.min(delta / 1000, 0.05);
        this.recompute();

        const moveSpeed = GW * LIVE.moveSpeedRatio;
        const enemySpeed = H * LIVE.enemySpeedRatio;
        const shipW = GW * LIVE.shipWRatio, enemyW = GW * LIVE.enemyWRatio;

        this.shipX = Phaser.Math.Clamp(this.shipX + this.moveDir * moveSpeed * dt, GX0 + shipW/2 + GW*0.02, W - shipW/2 - GW*0.02);

        this.sinceSpawn += delta;
        if (this.sinceSpawn >= LIVE.spawnRate) {
            this.sinceSpawn = 0;
            const x = GX0 + enemyW/2 + GW*0.02 + Math.random() * (GW - enemyW - GW*0.04);
            this.enemies.push({ x, y: SKY_TOP - ENEMY_H, state: 'pending' });
        }

        for (let i = this.enemies.length - 1; i >= 0; i--) {
            const e = this.enemies[i];
            e.y += enemySpeed * dt;
            if (e.state === 'pending' &&
                Math.abs(this.shipX - e.x) < (shipW + enemyW)/2 &&
                Math.abs(SHIP_Y - e.y) < ((H * LIVE.shipHRatio) + ENEMY_H)/2) { e.state = 'hit'; this.hits++; }
            if (e.y - ENEMY_H/2 > SKY_BOT && e.state === 'pending') { e.state = 'dodged'; this.dodged++; }
            if (e.y - ENEMY_H/2 > H) this.enemies.splice(i, 1);
        }

        this.drawEnemies(enemyW);
        this.drawShip(shipW);
        this.refreshDerived();
        this.updateReadout();
    }

    drawEnemies(enemyW) {
        const g = this.enemyGfx; g.clear();
        for (const e of this.enemies) {
            const base = e.state === 'hit' ? 0xef6b6b : e.state === 'dodged' ? 0x63d19b : 0xff8fa3;
            const r = enemyW*0.5;
            g.fillStyle(0x000000, 0.10); g.fillEllipse(e.x, e.y + r*0.88, r*1.4, r*0.42);
            g.fillStyle(base); g.fillCircle(e.x, e.y, r);
            g.fillStyle(base); g.fillCircle(e.x - r*0.52, e.y - r*0.66, r*0.26); g.fillCircle(e.x + r*0.52, e.y - r*0.66, r*0.26);
            g.fillStyle(0x3a2e33); g.fillCircle(e.x - r*0.32, e.y - r*0.04, r*0.15); g.fillCircle(e.x + r*0.32, e.y - r*0.04, r*0.15);
            g.fillStyle(0xffffff, 0.9); g.fillCircle(e.x - r*0.27, e.y - r*0.1, r*0.05); g.fillCircle(e.x + r*0.37, e.y - r*0.1, r*0.05);
            g.fillStyle(0x3a2e33); g.fillCircle(e.x, e.y + r*0.34, r*0.11);
        }
    }

    drawShip(shipW) {
        const g = this.shipGfx; g.clear();
        const SHIP_H = H * LIVE.shipHRatio;
        if (this.useChar(0, this.shipX, SHIP_Y, shipW, SHIP_H)) return;
        const x = this.shipX, y = SHIP_Y;
        g.fillStyle(0xffb03a, 0.9); g.fillTriangle(x, y + SHIP_H*0.78, x - shipW*0.15, y + SHIP_H*0.42, x + shipW*0.15, y + SHIP_H*0.42);
        g.fillStyle(0xff7a42, 0.95); g.fillTriangle(x, y + SHIP_H*0.62, x - shipW*0.08, y + SHIP_H*0.42, x + shipW*0.08, y + SHIP_H*0.42);
        g.fillStyle(0x3aa8e0); g.fillTriangle(x - shipW*0.42, y + SHIP_H*0.08, x - shipW*0.62, y + SHIP_H*0.42, x - shipW*0.4, y + SHIP_H*0.42);
        g.fillStyle(0x3aa8e0); g.fillTriangle(x + shipW*0.42, y + SHIP_H*0.08, x + shipW*0.62, y + SHIP_H*0.42, x + shipW*0.4, y + SHIP_H*0.42);
        g.fillStyle(0x5ec8ff); g.fillRoundedRect(x - shipW*0.42, y - SHIP_H*0.44, shipW*0.84, SHIP_H*0.86, shipW*0.42);
        g.fillStyle(0x8fdcff, 0.5); g.fillRoundedRect(x - shipW*0.3, y - SHIP_H*0.36, shipW*0.28, SHIP_H*0.5, shipW*0.14);
        this.face(g, x, y - SHIP_H*0.04, shipW*0.4, { spread: 0.4, eyeY: 0.08, mouthR: 0.26, mouthY: 0.3, cheeks: false });
    }

    updateReadout() {
        let line1;
        if (!this.derivedOK) line1 = `⚠ Infeasible — ${this.mode==='move' ? 'enemy too fast/wide to dodge' : 'ship too slow for any enemy speed'}`;
        else if (this.mode === 'move') line1 = `SHIP SPEED  Hard ${this.bandHard.toFixed(2)}W → Easy ${this.bandEasy.toFixed(2)}W`;
        else line1 = `ENEMY SPEED  Easy ${(this.bandEasy*100).toFixed(0)}%H/s → Hard ${(this.bandHard*100).toFixed(0)}%H/s`;
        this.readout.setText(`${line1}\nhold ◀ ▶ to dodge    dodged ${this.dodged} · hit ${this.hits}`);
        this.readout.setColor(this.derivedOK ? '#979aa8' : '#e74c3c');
    }

    buildPanel() {
        this.reg(this.add.rectangle(PW/2, H/2, PW, H, 0x17181f, 0.98).setDepth(50));
        this.reg(this.add.rectangle(PW, H/2, 1.5, H, 0x24262f).setDepth(50));
        const _t = this.reg(this.add.text(PW*0.06, H*0.03, '⚙ SCROLLER', {
            fontSize: `${GW*0.030}px`, color: '#e8e9ef', fontStyle: 'bold'
        }).setOrigin(0, 0.5).setDepth(60));
        this.reg(this.add.text(_t.x + _t.width + GW*0.02, H*0.03, '竖版飞行', {
            fontSize: `${GW*0.022}px`, color: '#6d7080'
        }).setOrigin(0, 0.5).setDepth(60));

        const modeStr = this.mode === 'move' ? 'COMPUTE ▶ SHIP SPEED' : 'COMPUTE ▶ ENEMY SPEED';
        const btn = this.reg(this.add.rectangle(PW*0.5, H*0.076, PW*0.88, H*0.032, 0x24262f)
            .setStrokeStyle(1.5, 0x3a3d4a).setInteractive().setDepth(60));
        this.reg(this.add.text(PW*0.5, H*0.076, modeStr, {
            fontSize: `${GW*0.021}px`, color: '#e8e9ef', fontStyle: 'bold'
        }).setOrigin(0.5).setDepth(61));
        btn.on('pointerup', () => { this.mode = this.mode === 'move' ? 'enemy' : 'move'; this.rebuildPanel(); });

        const rows = [
            { key: 'move',  label: 'Ship Speed',   min: 0.12, max: 0.80, get: () => LIVE.moveSpeedRatio,  set: v => LIVE.moveSpeedRatio  = v, fmt: v => `${v.toFixed(2)}W` },
            { key: 'enemy', label: 'Enemy Speed',  min: 0.08, max: 0.60, get: () => LIVE.enemySpeedRatio, set: v => LIVE.enemySpeedRatio = v, fmt: v => `${(v*100).toFixed(0)}%H/s` },
            { key: 'enemyW',label: 'Enemy Width',  min: 0.04, max: 0.20, get: () => LIVE.enemyWRatio,     set: v => LIVE.enemyWRatio     = v, fmt: v => `${(v*100).toFixed(1)}%W` },
            { key: 'shipW', label: 'Ship Width',   min: 0.05, max: 0.18, get: () => LIVE.shipWRatio,      set: v => LIVE.shipWRatio      = v, fmt: v => `${(v*100).toFixed(1)}%W` },
            { key: 'shipH', label: 'Ship Height',  min: 0.04, max: 0.16, get: () => LIVE.shipHRatio,      set: v => LIVE.shipHRatio      = v, fmt: v => `${(v*100).toFixed(1)}%H` },
            { key: 'spawn', label: 'Spawn Rate',   min: 400,  max: 1500, get: () => LIVE.spawnRate,       set: v => LIVE.spawnRate       = v, fmt: v => `${Math.round(v)}ms` },
        ];
        const derivedKey = this.mode;   // 'move' or 'enemy'

        let sy = H*0.14;
        const gap = H*0.05;
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
        const knob = this.reg(this.add.circle(tx0 + (r.get() - r.min)/(r.max - r.min) * trackW, ty, GW*0.020, 0xf0a324)
            .setStrokeStyle(2, 0x17181f).setInteractive({ draggable: true }).setDepth(61));
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
        const g = this.reg(this.add.graphics().setDepth(59));        // draggable difficulty handle — pick where in the Easy↔Hard band the game runs
        const handle = this.reg(this.add.circle(x0, ty, GW*0.024, 0xffffff).setStrokeStyle(3, 0x17181f).setInteractive({ draggable: true }).setDepth(62));
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
    backgroundColor: '#0a0a1e',
    canvas: window.canvas,
    scene: [LiveScene],
    input: { mouse: true, touch: true, keyboard: true },
};

new Phaser.Game(config);
