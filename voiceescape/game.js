/* Friend Peekaboo — prototype (placeholder art)
 * Follow-the-leader line, horizontal run. Hold to move, release to stop.
 * The cat cycles SAFE -> WARNING -> LOOK. When it LOOKs, any character not
 * behind a cover object is caught. Score = survivors who reach the finish.
 */

// Rubik font — native SDK id in the effect pack (tt.loadFont), 'Rubik' @font-face in preview.
let FONT = 'Rubik';
try { if (typeof tt !== 'undefined' && tt.loadFont) FONT = tt.loadFont('libs/fonts/Rubik-Bold.ttf') || FONT; } catch (_) {}

const DW = 1080, DH = 1920;      // design space
const BASE_Y = 1220;             // vertical anchor for covers
const FLOOR_Y = BASE_Y + 350;    // ground line the exhibits/alien stand on
const ALIEN_DY = 45;             // extra downward nudge for the alien
const SPACING = 160;             // gap between line members
// Museum Guard: a single alien sneaks past the guard dog, hiding behind exhibits.
const TEAM = 1;                  // a single alien
const TIME_LIMIT = 30;           // seconds to escape before the guard nabs you
const MOVE_SPEED = 720;          // px/s while moving
const VOICE_THRESHOLD = 0.06;    // mic RMS above this = "loud enough" -> alien advances
const MIC_MAX = 0.17;            // RMS that fills the meter to the top (lower = threshold marker sits higher)
const COVER_PAD = 34;            // inset before the player counts as "in cover"
const ZOOM = 0.78;               // world camera zoom-out
const CAM_CY = 720;              // world y the camera vertically centres on
const PLAYER_X_OFFSET = 230;     // camera leads ahead of the alien so it sits left-of-centre
const SHADOW_LIFT = 34;          // lift shadows up so they tuck under the object base (no gap)
const WALL_TOP_Y = 810;          // camera/wall boundary: CAMERA shows above (more exposed), shorter wall below
const FLOOR_TOP = 1410;          // top edge of the marble-floor strip (drawn in front of the wall)
const ENEMY_FOOT = 0.843;        // dog's chest (content bottom) fraction — anchor here so it tucks behind the floor
const ENEMY_WY = 1520;           // chest world-y when UP: below FLOOR_TOP so the cut-off bottom hides
const ENEMY_DOWN_Y = 2320;       // ducked fully behind the floor (hidden during SAFE)
const ENEMY_SCALE_W = 1.3;       // dog scale on the (zoomed) world camera
const ENEMY_RISE_SPEED = 620;    // px/s — slow rise so it emerges before the look
const LINE_SPAN = 0;             // single player

// Level layout: museum exhibits. obstacle3 (the classic car) patrols; the rest
// are static displays. `key` = exhibit art, `w` = hide-zone / display width.
const COVERS = [   // x positions scaled 0.8 for a 20%-shorter map
  { x: 600,   w: 420, key: 'obstacle5' },               // Anubis statue
  { x: 1520,  w: 400, key: 'obstacle4' },               // pharaoh mask
  { x: 2480,  w: 760, key: 'obstacle3', moving: true }, // classic car (patrols)
  { x: 4000,  w: 440, key: 'obstacle2' },               // T-rex skeleton
  { x: 5600,  w: 420, key: 'obstacle5' },               // Anubis statue
  { x: 6720,  w: 760, key: 'obstacle3', moving: true }, // classic car (patrols)
  { x: 8320,  w: 400, key: 'obstacle4' },               // pharaoh mask
];
const OBSTACLE_CW = { obstacle1: 275, obstacle2: 308, obstacle3: 831, obstacle4: 246, obstacle5: 280 };
const OBSTACLE_FOOT = { obstacle1: 0.963, obstacle2: 1.0, obstacle3: 0.959, obstacle4: 0.97, obstacle5: 0.968 };
const OBSTACLE_DY = { obstacle1: 28 };   // per-exhibit vertical nudge (px down) to sit flush on the floor
// Alien poses: running (moving) vs crouch (stopped/hiding). Each carries its own
// scale + foot fraction so the feet stay planted on the floor when swapping.
const PLAYER_POSE = {
  stand: { key: 'alien_walk', anim: 'alienwalk', scale: 0.78, foot: 0.82 },   // walk cycle while moving
  hide:  { key: 'player_hide', scale: 0.72, foot: 0.981 },                     // crouch when stopped
};
const V_MOVE = 190;        // px/s patrol speed of a moving cover
const PATROL = 640;        // patrol span: cover swings between c.x and c.x + PATROL
const CAM_STOP_X = 8600;   // camera stops scrolling here near the end; the alien then walks off-screen
const ESCAPE_X = 9520;     // alien has walked off the right edge past this -> escaped
const WORLD_W = 10400;
const START_X = COVERS[0].x + COVERS[0].w / 2;   // spawn sheltered at the first exhibit

class GameScene extends Phaser.Scene {
  constructor() { super('GameScene'); }

  preload() {
    // Museum-guard theme
    this.load.image('wall', 'assets/wallbg.png');       // museum wall (top-half backdrop, tiled)
    this.load.image('floor', 'assets/floor.png');       // marble floor (bottom half, tiled)
    this.load.image('enemy', 'assets/enemy.png');       // guard-dog watcher
    this.load.spritesheet('alien_walk', 'assets/alien_walk.png', { frameWidth: 480, frameHeight: 480 });  // walk cycle
    this.load.image('player_hide', 'assets/player_hide.png');     // crouch / hide pose
    this.load.image('teeth', 'assets/teethfx.png');               // jaws bite-effect on death
    for (let i = 1; i <= 5; i++) this.load.image('obstacle' + i, 'assets/obstacle' + i + '.png');
  }

  create() {
    this.makeRedGradient();
    this.makeSkyGradient();
    this.anims.create({
      key: 'alienwalk',
      frames: this.anims.generateFrameNumbers('alien_walk', { start: 0, end: 14 }),
      frameRate: 30, repeat: -1,
    });

    // World objects render on the MAIN camera (zoomed out to show more of the
    // field); the cat + HUD render on a separate UI camera at 1:1 so they stay
    // full size. Collect each into the right bucket, split them below.
    const world = [], ui = [];

    // ---- background: the CAMERA shows through the transparent area above
    // WALL_TOP_Y. Below it, the museum WALL is the backdrop (behind exhibits +
    // dog); a marble FLOOR strip sits in front of the wall at the bottom. Both
    // tile horizontally (mirrored -> seamless). The dog (depth -10.5) tucks
    // behind the floor and rises to loom in front of the wall. ----
    // Fallback backdrop (behind everything): a muted orange->red gradient shown
    // only when the camera feed is inactive, so the transparent sky isn't black.
    this.skyBg = this.add.image(-1000, -1700, 'skygrad').setOrigin(0, 0).setDepth(-20)
      .setDisplaySize(WORLD_W + 2000, FLOOR_TOP + 1700);
    world.push(this.skyBg);
    this.time.addEvent({ delay: 400, loop: true, callback: () => this.skyBg.setVisible(!this.cameraActive()) });

    const wallH = FLOOR_TOP - WALL_TOP_Y;         // wall bottom meets the top of the floor
    const wall = this.add.tileSprite(-1000, WALL_TOP_Y, WORLD_W + 2000, wallH, 'wall').setOrigin(0, 0).setDepth(-11);
    const wts = wallH / 1077; wall.tileScaleX = wts; wall.tileScaleY = wts;   // full image fits the band (zoomed out)
    world.push(wall);
    const floorH = 1200;
    const floor = this.add.tileSprite(-1000, FLOOR_TOP, WORLD_W + 2000, floorH, 'floor').setOrigin(0, 0).setDepth(-10);
    const fts = floorH / 515; floor.tileScaleX = fts; floor.tileScaleY = fts;
    world.push(floor);

    // ---- cover objects: museum exhibits the alien hides behind. Whoever's x is
    // outside every cover's live span is exposed when the guard looks. ----
    this.covers = COVERS.map((c) => ({
      ...c, curX: c.x, activated: false, glide: 0, dir: 1,
    }));

    // Every cover is a museum exhibit sprite. The classic car (obstacle3) is the
    // moving one (patrols); the rest are static displays. Each is scaled so its
    // content width = the hide-zone width, and grounded by its foot fraction.
    for (const c of this.covers) {
      c.dy = OBSTACLE_DY[c.key] || 0;
      const sx = c.w / OBSTACLE_CW[c.key];
      c.shadow = this.makeShadow(c.key, OBSTACLE_FOOT[c.key], sx, c.x + c.w / 2, FLOOR_Y + c.dy);
      world.push(c.shadow);
      c.sprite = this.add.image(c.x + c.w / 2, FLOOR_Y + c.dy, c.key)
        .setOrigin(0.5, OBSTACLE_FOOT[c.key]).setDepth(10).setScale(sx);
      world.push(c.sprite);
    }

    // (no finish line — the level ends when the alien walks off the right edge)

    // ---- the alien player ---- (running pose while moving, crouch pose when stopped)
    this.leadX = START_X;
    const p0 = PLAYER_POSE.hide;   // starts crouched behind the first exhibit
    this.playerShadow = this.add.sprite(this.leadX, FLOOR_Y + ALIEN_DY - SHADOW_LIFT, p0.key)
      .setOrigin(0.5, p0.foot).setScale(p0.scale, -p0.scale * 0.30)
      .setTintFill(0x000000).setAlpha(0.16).setDepth(6);
    world.push(this.playerShadow);
    const img = this.add.sprite(this.leadX, FLOOR_Y + ALIEN_DY, p0.key)
      .setOrigin(0.5, p0.foot).setDepth(15).setScale(p0.scale);
    world.push(img);
    this.members = [{ img, alive: true, x: this.leadX, index: 0 }];
    this.pose = 'hide';

    // invisible target the camera follows = ahead of the alien (alien sits left-of-centre)
    this.camTarget = this.add.rectangle(Math.min(this.leadX + PLAYER_X_OFFSET, CAM_STOP_X), CAM_CY, 4, 4, 0x000000, 0);
    world.push(this.camTarget);

    // ---- guard-dog enemy: a WORLD object at depth -10.5 (behind the floor at
    // -10, in front of the wall at -11) so it peeks over the horizon. Kept
    // screen-centred each frame in updateCat; ducks during SAFE, rises to look. ----
    this.medusa = this.add.image(DW / 2, ENEMY_DOWN_Y, 'enemy')
      .setOrigin(0.5, ENEMY_FOOT).setDepth(-10.5).setScale(ENEMY_SCALE_W);
    this.medusaY = ENEMY_DOWN_Y;   // starts hidden below the floor (SAFE)
    world.push(this.medusa);
    this.spotGfx = this.add.graphics().setDepth(1);    ui.push(this.spotGfx);  // gaze over field
    this.vignette = this.add.graphics().setDepth(88);  ui.push(this.vignette); // edge pulse

    // ---- HUD (UI camera) ----
    this.timerText = this.add.text(DW / 2, 70, String(TIME_LIMIT), {
      fontFamily: FONT, fontSize: 104, color: '#ffffff', fontStyle: 'bold',
      stroke: '#1a1a2a', strokeThickness: 14
    }).setOrigin(0.5, 0).setDepth(97);
    ui.push(this.timerText);

    this.hudState = this.add.text(DW / 2, 560, '', {
      fontFamily: FONT, fontSize: 72, color: '#ffffff', fontStyle: 'bold',
      stroke: '#2b2b3a', strokeThickness: 9
    }).setOrigin(0.5).setDepth(95);
    ui.push(this.hudState);

    this.progBg = this.add.rectangle(DW / 2, DH - 60, DW - 120, 26, 0x000000, 0.25).setDepth(95);
    ui.push(this.progBg);
    this.progFill = this.add.rectangle(60, DH - 60, 10, 26, 0xffe066).setOrigin(0, 0.5).setDepth(96);
    ui.push(this.progFill);

    // mic-level meter (fills with your voice; turns green once loud enough to move)
    this.micBg = this.add.rectangle(52, DH - 190, 26, 380, 0x000000, 0.22).setOrigin(0.5, 1).setDepth(95);
    ui.push(this.micBg);
    this.micFill = this.add.rectangle(52, DH - 190, 26, 380, 0x8fb0c8).setOrigin(0.5, 1).setDepth(96).setScale(1, 0);
    ui.push(this.micFill);
    this.micMark = this.add.rectangle(52, DH - 190 - 380 * (VOICE_THRESHOLD / MIC_MAX), 34, 4, 0xffffff, 0.85).setDepth(97);
    ui.push(this.micMark);   // threshold line

    // ---- overlay (ready / results, UI camera) ----
    this.overlay = this.add.rectangle(0, 0, DW, DH, 0x101024, 0).setOrigin(0, 0).setDepth(100);
    ui.push(this.overlay);
    this.overlayText = this.add.text(DW / 2, DH / 2, '', {
      fontFamily: FONT, fontSize: 60, color: '#ffffff', fontStyle: 'bold',
      align: 'center', lineSpacing: 20, stroke: '#1a1a2a', strokeThickness: 10
    }).setOrigin(0.5).setDepth(101);
    ui.push(this.overlayText);

    // ---- state ----
    this.state = 'ready';
    this.holding = false;
    this.voiceLevel = 0;
    this.phase = 'safe';
    this.phaseTime = 0;
    this.attacksLeft = 0;
    this.showOverlay('Yell to run!\nHide from the guard and\nreach the end in time.');

    // ---- input ----
    this.input.on('pointerdown', () => {
      if (this.state === 'ready') { this.startGame(); }   // start only — don't move on the start tap
      else if (this.state === 'over') { this.scene.restart(); }
      else { this.holding = true; }
    });
    const release = () => { this.holding = false; };
    this.input.on('pointerup', release);
    this.input.on('pointerupoutside', release);

    // ---- cameras: main = zoomed-out world following the line's centre;
    // uiCam = fixed 1:1 layer for the cat + HUD ----
    this.cameras.main.setBounds(-1200, -1200, WORLD_W + 2400, DH + 2400);
    this.cameras.main.setZoom(ZOOM);
    this.cameras.main.startFollow(this.camTarget, false, 0.15, 0.15);

    this.uiCam = this.cameras.add(0, 0, DW, DH);
    this.uiCam.setScroll(0, 0);

    this.cameras.main.ignore(ui);
    this.uiCam.ignore(world);
    this._world = world;   // so dynamically-created world objects (death rings) can join it

    // Lock the dog to the exact camera centre right BEFORE it renders (after the
    // camera's follow has settled this frame) — zero horizontal latency vs the rays.
    this.cameras.main.on('prerender', (cam) => {
      if (this.medusa) this.medusa.x = cam.midPoint.x;
    });
  }

  startGame() {
    this.state = 'playing';
    this.timeLeft = TIME_LIMIT;
    this.overlay.setVisible(false);
    this.overlayText.setVisible(false);
    this.initMic();          // request the microphone (user gesture = the start tap)
    this.setPhase('safe');
  }

  // ---------- voice control ----------
  initMic() {
    if (this._micInit) return; this._micInit = true;
    const md = navigator.mediaDevices;
    if (!md || !md.getUserMedia) return;
    md.getUserMedia({ audio: true }).then((stream) => {
      const AC = window.AudioContext || window.webkitAudioContext;
      const ctx = new AC();
      if (ctx.state === 'suspended') ctx.resume();
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 512;
      ctx.createMediaStreamSource(stream).connect(analyser);
      this._analyser = analyser;
      this._micBuf = new Uint8Array(analyser.fftSize);
    }).catch(() => { /* mic denied — touch still works */ });
  }

  readVoice() {
    const a = this._analyser; if (!a) return 0;
    a.getByteTimeDomainData(this._micBuf);
    let s = 0;
    for (let i = 0; i < this._micBuf.length; i++) { const v = (this._micBuf[i] - 128) / 128; s += v * v; }
    return Math.sqrt(s / this._micBuf.length);   // RMS 0..1
  }

  // ---------- phase machine ----------
  // safe (medusa down) -> warning (slow emerge) -> look (attack). After a look,
  // the medusa sometimes STAYS UP for a `hold` (eyes open, no detection) then
  // attacks again, chaining a few consecutive attacks before ducking back down.
  setPhase(p) {
    this.phase = p;
    if (p === 'safe') this.phaseTime = Phaser.Math.FloatBetween(1.6, 3.1);
    else if (p === 'warning') {
      this.phaseTime = 2.2;                           // slow emerge + a longer eyes-open beat before the strike
      // No chained attacks at a turtle (moving-cover) section — single strike only.
      let nearest = null, best = Infinity;
      for (const c of this.covers) {
        const d = Math.abs((c.curX + c.w / 2) - this.leadX);
        if (d < best) { best = d; nearest = c; }
      }
      const r = Math.random();                       // extra back-to-back attacks this rise
      this.attacksLeft = (nearest && nearest.moving) ? 0 : (r < 0.6 ? 0 : r < 0.85 ? 1 : 2);
    }
    else if (p === 'hold') this.phaseTime = 1.2;      // up-and-watching gap before the next attack
    else if (p === 'look') this.phaseTime = 1.3;
  }

  aliveMembers() { return this.members.filter(m => m.alive); }

  // Muted orange->red vertical gradient — fallback backdrop when no camera feed.
  makeSkyGradient() {
    const key = 'skygrad';
    if (this.textures.exists(key)) return;
    const tex = this.textures.createCanvas(key, 8, 512);
    const ctx = tex.getContext();
    const g = ctx.createLinearGradient(0, 0, 0, 512);
    g.addColorStop(0.00, '#e3a878');   // soft orange (top)
    g.addColorStop(0.55, '#d17f63');
    g.addColorStop(1.00, '#b45f52');   // soft red (bottom)
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, 8, 512);
    tex.refresh();
  }

  // True when the bach camera backdrop is live (video playing with pixels).
  cameraActive() {
    const v = this._camVid || (this._camVid = document.querySelector('#__bach_source video'));
    if (!v) return false;                 // re-queried next call (element may appear later)
    if (!v.isConnected) { this._camVid = null; return false; }
    return v.readyState >= 2 && !v.paused && v.videoWidth > 0;
  }

  // Red danger gradient: opaque red at top & bottom, fading to clear in the middle.
  makeRedGradient() {
    const key = 'redgrad';
    if (this.textures.exists(key)) return;
    const tex = this.textures.createCanvas(key, 8, DH);
    const ctx = tex.getContext();
    const g = ctx.createLinearGradient(0, 0, 0, DH);
    g.addColorStop(0.00, 'rgba(190,0,0,0.95)');
    g.addColorStop(0.40, 'rgba(190,0,0,0.0)');
    g.addColorStop(0.60, 'rgba(190,0,0,0.0)');
    g.addColorStop(1.00, 'rgba(190,0,0,0.95)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, 8, DH);
    tex.refresh();
  }

  // Shape-based cast shadow: a black, flattened, flipped-down copy of the sprite,
  // anchored at the feet so it lies on the floor with the object's silhouette.
  // Lifted up slightly (SHADOW_LIFT) so it tucks under the base with no gap.
  makeShadow(key, foot, sx, x, y) {
    return this.add.image(x, y - SHADOW_LIFT, key)
      .setOrigin(0.5, foot)
      .setScale(sx, -sx * 0.30)
      .setTintFill(0x000000).setAlpha(0.16).setDepth(6);
  }

  setPlayerPose(pose) {
    if (this.pose === pose) return;
    const m = this.members[0]; if (!m || !m.alive) return;
    this.pose = pose;
    const p = PLAYER_POSE[pose];
    if (p.anim) {
      m.img.setOrigin(0.5, p.foot).setScale(p.scale).play(p.anim);
      this.playerShadow.setTexture(p.key, 0).setOrigin(0.5, p.foot).setScale(p.scale, -p.scale * 0.30);
    } else {
      m.img.anims.stop();
      m.img.setTexture(p.key).setOrigin(0.5, p.foot).setScale(p.scale);
      this.playerShadow.anims.stop();
      this.playerShadow.setTexture(p.key).setOrigin(0.5, p.foot).setScale(p.scale, -p.scale * 0.30);
    }
  }

  inCover(x) {
    for (const c of this.covers) {
      if (x > c.curX + COVER_PAD && x < c.curX + c.w - COVER_PAD) return true;
    }
    return false;
  }

  updateCovers(dt) {
    for (const c of this.covers) {
      if (!c.moving) { c.curX = c.x; continue; }
      // arm the cover once the line approaches, then PATROL back and forth
      // between c.x (leftmost) and c.x + PATROL (rightmost), forever.
      if (!c.activated && this.state === 'playing' && this.leadX >= c.x - 150) c.activated = true;
      // The car patrols continuously back and forth once armed — it does NOT
      // freeze when the dog appears; you keep tracking it through the look.
      // (Moving sections are limited to a single strike, so it stays fair.)
      if (c.activated) {
        c.glide += c.dir * V_MOVE * dt;
        if (c.glide >= PATROL) { c.glide = PATROL; c.dir = -1; }
        else if (c.glide <= 0) { c.glide = 0; c.dir = 1; }
      }
      c.curX = c.x + c.glide;
      c.sprite.setFlipX(c.dir < 0);   // car faces right; flip when driving left
      c.sprite.x = c.curX + c.w / 2;
      c.sprite.y = FLOOR_Y + (c.dy || 0);
      c.shadow.x = c.sprite.x; c.shadow.y = c.sprite.y - SHADOW_LIFT; c.shadow.setFlipX(c.dir < 0);
    }
  }

  // Death: two rows of fangs snap shut (top + inverted bottom) over a red flash.
  biteEffect() {
    const flash = this.add.image(0, 0, 'redgrad').setOrigin(0, 0).setDisplaySize(DW, DH).setDepth(108).setAlpha(0);
    const scale = (DW / 1536) * 1.12;
    const th = 1024 * scale;
    const top = this.add.image(DW / 2, -th / 2, 'teeth').setOrigin(0.5, 0.5).setScale(scale).setDepth(109).setAlpha(0.5);
    const bot = this.add.image(DW / 2, DH + th / 2, 'teeth').setOrigin(0.5, 0.5).setScale(scale, -scale).setDepth(109).setAlpha(0.5);
    this.cameras.main.ignore([flash, top, bot]);   // UI camera only (fixed to screen)
    this.tweens.add({ targets: flash, alpha: 1, duration: 90, yoyo: true, hold: 200, onComplete: () => flash.destroy() });
    this.tweens.add({ targets: top, y: DH * 0.5 - th * 0.42, duration: 170, ease: 'Back.out' });
    this.tweens.add({
      targets: bot, y: DH * 0.5 + th * 0.42, duration: 170, ease: 'Back.out',
      onComplete: () => this.time.delayedCall(550, () => {
        this.tweens.add({ targets: top, y: -th / 2, duration: 260, ease: 'Quad.in', onComplete: () => top.destroy() });
        this.tweens.add({ targets: bot, y: DH + th / 2, duration: 260, ease: 'Quad.in', onComplete: () => bot.destroy() });
      }),
    });
  }

  killMember(m) {
    // Caught by the guard! jaws snap shut + red flash, alien snatched away.
    if (!m.alive) return;
    m.alive = false;
    if (this.playerShadow) this.playerShadow.setVisible(false);
    this.biteEffect();
    m.img.setDepth(30);
    const gx = m.img.x, gy = m.img.y;
    m.img.setTintFill(0xffffff);
    this.time.delayedCall(60, () => { if (m.img.active) m.img.setTintFill(0xff5555); });
    this.tweens.add({ targets: m.img, x: gx + 8, duration: 40, yoyo: true, repeat: 5 });
    this.time.delayedCall(300, () => {
      this.tweens.killTweensOf(m.img);
      if (m.img.active) this.tweens.add({
        targets: m.img, y: gy - 160, scaleX: 0, scaleY: 0, angle: 220, alpha: 0,
        duration: 380, ease: 'Back.in', onComplete: () => m.img.destroy()
      });
    });
  }

  // ---------- main loop ----------
  update(_t, dtMs) {
    const dt = Math.min(dtMs / 1000, 0.05);
    this.updateCovers(dt);   // keep covers (incl. moving drift) live every frame
    if (this.state !== 'playing') return;

    // movement — making noise (voice over the threshold) OR a touch-hold pushes the line forward
    this.voiceLevel = Phaser.Math.Linear(this.voiceLevel || 0, this.readVoice(), 0.5);
    const moving = this.holding || this.voiceLevel > VOICE_THRESHOLD;
    if (moving) this.leadX = Math.min(this.leadX + MOVE_SPEED * dt, ESCAPE_X + 200);

    // the alien follows leadX; running pose while moving, crouch pose when stopped
    this.setPlayerPose(moving ? 'stand' : 'hide');
    for (const m of this.aliveMembers()) {
      m.x = Phaser.Math.Linear(m.x, this.leadX, 0.18);
      m.img.x = m.x;
      m.img.y = FLOOR_Y + ALIEN_DY;
      this.playerShadow.x = m.x; this.playerShadow.y = FLOOR_Y + ALIEN_DY - SHADOW_LIFT;
      if (this.pose === 'stand') this.playerShadow.setFrame(m.img.frame.name);   // sync shadow to walk frame
    }
    this.camTarget.x = Math.min(this.leadX + PLAYER_X_OFFSET, CAM_STOP_X);   // hold near the end so the alien walks off

    // phase timer
    this.phaseTime -= dt;
    if (this.phaseTime <= 0) {
      if (this.phase === 'safe') this.setPhase('warning');
      else if (this.phase === 'warning' || this.phase === 'hold') this.setPhase('look');
      else if (this.attacksLeft > 0) { this.attacksLeft--; this.setPhase('hold'); }  // stay up, attack again
      else this.setPhase('safe');                                                    // duck back down
    }

    // detection during LOOK
    if (this.phase === 'look') {
      for (const m of this.aliveMembers()) {
        if (!this.inCover(m.x)) this.killMember(m);
      }
    }

    this.updateCat(dt);
    this.updateHud();

    // countdown
    this.timeLeft -= dt;
    if (this.timeLeft <= 0) { this.timeLeft = 0; return this.endGame(0, 'time'); }

    // end conditions
    const alive = this.aliveMembers();
    if (alive.length === 0) return this.endGame(0);
    if (this.leadX >= ESCAPE_X) return this.endGame(1);   // walked off the right edge -> escaped
  }

  updateCat(dt) {
    // slow constant-speed rise/duck: hidden below the floor during SAFE, up for WARNING/LOOK
    const targetY = this.phase === 'safe' ? ENEMY_DOWN_Y : ENEMY_WY;
    const step = ENEMY_RISE_SPEED * dt;
    if (this.medusaY > targetY) this.medusaY = Math.max(targetY, this.medusaY - step);
    else this.medusaY = Math.min(targetY, this.medusaY + step);
    this.medusa.x = this.cameras.main.midPoint.x;   // screen-centred (finalised in the pre-render hook)
    this.medusa.y = this.medusaY;

    // Rays emanate from the dog's ACTUAL eyes — origin tracked live from medusaY,
    // and the dog is centre-locked each render, so ray + guard never drift apart.
    const cx = DW / 2;
    const eyeY = (this.medusaY - 546 - CAM_CY) * ZOOM + DH / 2;
    const eyeDX = 61;
    const s = this.spotGfx; s.clear();
    if (this.phase === 'look') {
      s.fillStyle(0xfff2a0, 0.22 + Math.sin(this.time.now / 80) * 0.06);
      s.fillTriangle(cx - eyeDX, eyeY, cx + eyeDX, eyeY, cx + 520, DH);
      s.fillTriangle(cx - eyeDX, eyeY, cx + 520, DH, cx - 520, DH);
    }

    // vignette pulse
    const v = this.vignette; v.clear();
    if (this.phase !== 'safe') {
      const col = this.phase === 'look' ? 0xff3b3b : 0xffd43b;
      const a = (this.phase === 'look' ? 0.35 : 0.2) * (0.6 + 0.4 * Math.sin(this.time.now / 100));
      v.lineStyle(46, col, a);
      v.strokeRect(23, 23, DW - 46, DH - 46);
    }
  }

  updateHud() {
    if (this.phase === 'safe') { this.hudState.setText(''); }
    else if (this.phase === 'look') { this.hudState.setText('!!!'); this.hudState.setColor('#ff5b5b'); }
    else { this.hudState.setText('!  !  !'); this.hudState.setColor('#ffd43b'); }   // warning / hold

    // countdown display (red in the final seconds)
    const t = Math.max(0, Math.ceil(this.timeLeft));
    this.timerText.setText(String(t));
    this.timerText.setColor(t <= 5 ? '#ff5b5b' : '#ffffff');

    // progress (camera follows this.camTarget automatically)
    const p = Phaser.Math.Clamp(this.leadX / ESCAPE_X, 0, 1);
    this.progFill.width = (DW - 120) * p;

    // mic meter: fill height = current voice level; green once past the move threshold
    const lvl = Phaser.Math.Clamp((this.voiceLevel || 0) / MIC_MAX, 0, 1);
    this.micFill.setScale(1, lvl);
    this.micFill.setFillStyle((this.voiceLevel || 0) > VOICE_THRESHOLD ? 0x69db7c : 0x8fb0c8);
  }

  endGame(score, reason) {
    this.state = 'over';
    this.holding = false;
    this.spotGfx.clear(); this.vignette.clear();
    if (score === 0) {   // lost -> keep the red danger gradient on the game-over screen
      const grad = this.add.image(0, 0, 'redgrad').setOrigin(0, 0).setDisplaySize(DW, DH).setDepth(99).setAlpha(0);
      this.cameras.main.ignore(grad);
      this.tweens.add({ targets: grad, alpha: 0.95, duration: 250 });
    }
    const msg = score > 0
      ? `YOU ESCAPED!`
      : reason === 'time'
        ? `TIME'S UP!\n\nThe guard nabbed you.\n\nTap to try again`
        : `BUSTED!\n\nThe guard caught you.\n\nTap to try again`;
    this.showOverlay(msg);
  }

  showOverlay(text) {
    this.overlay.setVisible(true);
    this.overlayText.setText(text).setVisible(true);
  }
}

const config = {
  type: Phaser.WEBGL,
  width: DW,
  height: DH,
  canvas: (typeof window !== 'undefined' && window.canvas) || document.getElementById('gameCanvas'),
  transparent: true,               // let the bach camera backdrop show through (TikTok-effect style)
  scale: { mode: Phaser.Scale.NONE },
  input: { mouse: true, touch: true },
  scene: [GameScene]
};

const game = new Phaser.Game(config);
window.game = game;
