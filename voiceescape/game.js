/* Friend Peekaboo — prototype (placeholder art)
 * Follow-the-leader line, horizontal run. Hold to move, release to stop.
 * The cat cycles SAFE -> WARNING -> LOOK. When it LOOKs, any character not
 * behind a cover object is caught. Score = survivors who reach the finish.
 */

// Rubik font — native SDK id in the effect pack (tt.loadFont), 'Rubik' @font-face in preview.
let FONT = 'Rubik';
try { if (typeof tt !== 'undefined' && tt.loadFont) FONT = tt.loadFont('libs/fonts/Rubik-Bold.ttf') || FONT; } catch (_) {}

const DW = 1080, DH = 1920;      // design space
// Top HUD: timer (left) + progress bar (right) on the same horizontal level,
// inset from their respective screen edges by the SAME padding.
const BAR_Y = 132;                          // shared top level
const HUD_PAD = 88;                         // equal gap: timer-from-left == bar-from-right
const BAR_SCALE = 1.14;                      // progress bar image scale (shorter than before)
const BAR_TEX_W = 322, BAR_TEX_H = 74;       // progress_full texture size (crop is in texture px)
const BAR_W = 323 * BAR_SCALE, BAR_H = BAR_TEX_H * BAR_SCALE;   // ~400 x 92 display
const BAR_LEFT = DW - HUD_PAD - BAR_W;       // left edge (origin-0 anchor); right edge = DW - HUD_PAD
const BAR_HEAD = 88;                          // alien-head width at the fill's leading edge (overhangs the bar)
const BAR_HEAD_H = BAR_HEAD * 96 / 76;       // alien-head aspect (native 76x96)
// Time-bar pill (top-left, same level as the progress bar): hourglass icon + time text.
const TB_H = 96, TB_W = 295 * TB_H / 93;     // pill display size (preserve native 295x93 aspect)
const TB_TEXT_X = HUD_PAD + TB_W * 0.62;     // time text centred in the pill area right of the hourglass
// Voice meter (vertical bar on the left): white track image, level fill, threshold marker + mic icon.
const MIC_X = 92, MIC_W = 46, MIC_TOP = 600, MIC_H = 470;
const MIC_FILL_BOT = MIC_TOP + MIC_H - 12, MIC_FILL_H = MIC_H - 26;   // fill span inside the track
const BASE_Y = 1220;             // vertical anchor for covers
const FLOOR_Y = BASE_Y + 350;    // ground line the exhibits/alien stand on
const ALIEN_DY = 45;             // extra downward nudge for the alien
const SPACING = 160;             // gap between line members
// Museum Guard: a single alien sneaks past the guard dog, hiding behind exhibits.
const TEAM = 1;                  // a single alien
const TIME_LIMIT = 20;           // seconds to escape before the guard nabs you
const MOVE_SPEED = 720;          // px/s while moving
const VOICE_THRESHOLD = 0.06;    // mic RMS above this = "loud enough" -> alien advances
const MIC_MAX = 0.17;            // RMS that fills the meter to the top (lower = threshold marker sits higher)
const COVER_PAD = 34;            // inset before the player counts as "in cover"
const ZOOM = 0.78;               // world camera zoom-out
const CAM_CY = 720;              // world y the camera vertically centres on
const PLAYER_X_OFFSET = 230;     // camera leads ahead of the alien so it sits left-of-centre
const SHADOW_LIFT = 34;          // lift shadows up so they tuck under the object base (no gap)
const WALL_TOP_Y = 860;          // camera/wall boundary (wall+floor nudged down a bit)
const FLOOR_TOP = 1300;          // top of the marble-floor strip (raised -> shorter, squished wall)
// Guard rises from BEHIND the wall (depth < wall's -11), peeking over WALL_TOP_Y.
const ENEMY_WY = 1100;           // base world-y when UP: face pokes above the wall, chest behind it
const ENEMY_DOWN_Y = 1850;       // ducked fully behind the wall (hidden during SAFE)
// Guard poses per phase (bulldog cop). Each: art key + scale + foot fraction (anchor
// near the chest). Poses that hold the flashlight also carry their frame size (fw/fh)
// and the lens position within that frame (flx/fly) so the beam starts on the lens.
const GUARD = {
  pre:    { key: 'guard_pre',    scale: 1.25, foot: 0.95 },   // WARNING: confused, "?"
  attack: { key: 'guard_attack', scale: 1.30, foot: 0.96,     // LOOK: snarl + flashlight
            fw: 820, fh: 609, flx: 0.244, fly: 0.353 },
  after:  { key: 'guard_after',  scale: 1.25, foot: 0.96 },   // HOLD: still angry
  // CAUGHT: shocked close-up. Its art (805x621) draws the dog ~1.16x larger and
  // further left than the attack frame, so scale/foot/ox are calibrated to keep
  // the head in the same on-screen spot when it swaps in. Its flashlight sits far
  // left in the frame (lens at ~53,189), hence the very different flx/fly.
  caught: { key: 'guard_caught', scale: 1.12, foot: 0.946, ox: 0.334,
            fw: 805, fh: 621, flx: 0.066, fly: 0.304 },
};
const GUARD_FW = 820, GUARD_FH = 609;    // guard_attack frame size
const FL_FX = 0.244, FL_FY = 0.353;      // flashlight-lens position (fraction of the attack frame)
const ENEMY_RISE_SPEED = 620;    // px/s — slow rise so it emerges before the look
const LINE_SPAN = 0;             // single player

// Level layout is randomized each play (see buildLevel). Exhibit hide-zone widths:
const HIDE_W = { newobstacle1: 370, newobstacle2: 560, newobstacle3: 460, newobstacle4: 620, obstacle3: 760, coffin: 420 };
// Per-exhibit hide-box edge tweaks in px [left, right] (WITHOUT resizing the art).
// Positive pulls that edge inward; negative extends it outward past the artwork.
const HIDE_INSET = { newobstacle1: [70, 48], newobstacle2: [0, -30] };
// Per-exhibit shadow origin nudge (px from FLOOR_Y; negative = the shadow starts higher).
const SHADOW_YBOT = { newobstacle1: -110, newobstacle2: -75 };
// Extra lift for an exhibit's ground drop-shadow (px up). Needed when the art's
// bottom is NOT the object's base — e.g. the coffin, whose rope poles hang lower.
const DROP_LIFT = { coffin: 80 };
// Split an exhibit's drop-shadow into two halves so only one side can be lifted
// (newobstacle2: the duck's tall pedestal needs lifting, the toast's does not).
const SPLIT_SHADOW = { newobstacle2: { frac: 0.5, leftLift: 20 } };
// Cast the beam shadow from the full sprite art instead of the hide-box (e.g. the
// coffin, whose rope barrier is drawn outside its hide-zone but should still shadow).
const SHADOW_FULL_ART = { coffin: true };
const LEVEL_POOL = ['newobstacle1', 'newobstacle2', 'newobstacle3', 'newobstacle4'];   // static exhibits
const LEVEL_LAST_START = 5650;   // don't begin a cover past here (leave room for the finish dash)
// Base gap after cover i (a random 0-150 is added on top). Front-loaded so the
// opening exhibits aren't bunched together; tapers to the original 200 baseline.
const GAP_RAMP = [450, 380, 300, 250, 200, 200];
// CW = the content width used to map art -> hide-zone width. For the coffin the
// art also includes the rope barrier (shown, not hideable), so CW is just the
// COFFIN sub-width and ORIGIN_X puts the coffin (not the whole art) over the zone.
// A `gap` on a cover marks a middle fraction [start,end] that is NOT a hide point.
const OBSTACLE_CW = { obstacle1: 275, obstacle2: 308, obstacle3: 831, obstacle4: 246, obstacle5: 280, coffin: 270,
  newobstacle1: 424, newobstacle2: 402, newobstacle3: 489, newobstacle4: 717 };
const OBSTACLE_FOOT = { obstacle1: 0.963, obstacle2: 1.0, obstacle3: 0.959, obstacle4: 0.97, obstacle5: 0.968, coffin: 0.98,
  newobstacle1: 0.985, newobstacle2: 0.99, newobstacle3: 0.985, newobstacle4: 0.99 };
const OBSTACLE_ORIGIN_X = { coffin: 0.728 };   // coffin centre as a fraction of the full art (barrier extends left)
const OBSTACLE_DY = { obstacle1: 28 };   // per-exhibit vertical nudge (px down) to sit flush on the floor
const OBSTACLE_VSCALE = { obstacle5: 0.88 };   // per-exhibit visual shrink (keeps hide-zone width unchanged)
// Alien poses: running (moving) vs crouch (stopped/hiding). Each carries its own
// scale + foot fraction so the feet stay planted on the floor when swapping.
const PLAYER_POSE = {
  stand: { key: 'alien_walk', anim: 'alienwalk', scale: 0.78, foot: 0.82 },   // walk cycle while moving
  hide:  { key: 'player_hide', scale: 0.72, foot: 0.981 },                     // crouch when stopped
  fail:  { key: 'playerfail', scale: 0.72, foot: 0.95 },                       // shocked pose when caught
  win:   { key: 'playerwin', scale: 0.9, foot: 0.98 },                         // triumphant pose on escape
};
const V_MOVE = 190;        // px/s patrol speed of a moving cover
const PATROL = 640;        // patrol span: cover swings between c.x and c.x + PATROL
const CAM_STOP_X = 6515;   // camera stops scrolling here near the end; the alien then walks off-screen
const ESCAPE_X = 7215;     // alien has walked off the right edge past this -> escaped
const WORLD_W = 8600;
const START_X = 810;       // spawn x (the first exhibit is centred here)
const WIN_ALIEN_X = 7395;  // where the alien stands to celebrate (right of the exit sign)
const WIN_CAM_X = WIN_ALIEN_X;   // camera centres horizontally on the winning alien
const DEBUG_HIDE_BOXES = false;   // draw each cover's hide-zone (green box) for tuning

class GameScene extends Phaser.Scene {
  constructor() { super('GameScene'); }

  preload() {
    // Museum-guard theme
    this.load.image('wall', 'assets/wallbg.png');       // museum wall (top-half backdrop, tiled)
    this.load.image('floor', 'assets/floor.png');       // marble floor (bottom half, tiled)
    this.load.image('guard_pre', 'assets/guard_pre.png');       // guard: confused (warning)
    this.load.image('guard_attack', 'assets/guard_attack.png'); // guard: snarl + flashlight (look)
    this.load.image('guard_after', 'assets/guard_after.png');   // guard: still angry (hold)
    this.load.spritesheet('alien_walk', 'assets/alien_walk.png', { frameWidth: 480, frameHeight: 480 });  // walk cycle
    this.load.image('player_hide', 'assets/player_hide.png');     // crouch / hide pose
    this.load.image('playerfail', 'assets/playerfail.png');       // shocked pose when caught
    this.load.image('playerwin', 'assets/playerwin.png');         // triumphant pose on escape
    this.load.image('teeth', 'assets/teethfx.png');               // jaws bite-effect on death
    this.load.image('alienhead', 'assets/alienhead.png');         // progress-bar head (rides the fill's leading edge)
    this.load.image('playbutton', 'assets/playbutton.png');       // start button
    this.load.image('voicehint', 'assets/voicehint.png');         // mic icon (ready screen)
    this.load.image('progress_empty', 'assets/progress_empty.png');   // progress bar: empty track
    this.load.image('progress_full', 'assets/progress_full.png');     // progress bar: full (revealed by crop)
    this.load.image('voicebar', 'assets/voicebar.png');               // voice meter track
    this.load.image('voicethresholdmarker', 'assets/voicethresholdmarker.png');   // voice threshold line
    this.load.image('voiceicon', 'assets/voiceicon.png');             // mic icon under the meter
    this.load.image('excl_yellow', 'assets/excl_yellow.png');         // warning "!!!" (yellow)
    this.load.image('excl_red', 'assets/excl_red.png');               // look "!!!" (red)
    this.load.image('title_gameover', 'assets/title_gameover.png');   // lose title (GAME OVER)
    this.load.image('title_youwin', 'assets/title_youwin.png');       // win title (YOU WIN!)
    this.load.image('guard_caught', 'assets/guard_caught.png');       // guard close-up when it catches you
    this.load.image('timebar', 'assets/timebar.png');                 // timer pill (hourglass + time)
    this.load.image('exitsign', 'assets/exitsign.png');           // free-standing EXIT sign on the ground
    for (let i = 1; i <= 5; i++) this.load.image('obstacle' + i, 'assets/obstacle' + i + '.png');
    for (let i = 1; i <= 4; i++) this.load.image('newobstacle' + i, 'assets/newobstacle' + i + '.png');
    this.load.image('coffin', 'assets/coffin.png');               // sarcophagus exhibit (roped-off)
  }

  create() {
    this.makeRedGradient();
    this.makeBlackGradient();
    this.makeGlowTex();
    this.makeSkyGradient();
    this.makeDarkGradient();
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

    // free-standing EXIT sign standing on the ground, just before the finish
    // (posts sink into the floor; the alien runs past it to escape).
    world.push(this.add.image(CAM_STOP_X + 470, FLOOR_Y + 18, 'exitsign')
      .setOrigin(0.5, 1).setScale(1.15).setDepth(9));

    // ---- cover objects: museum exhibits the alien hides behind. Whoever's x is
    // outside every cover's live span is exposed when the guard looks. Randomized. ----
    this.covers = this.buildLevel().map((c) => ({
      ...c, curX: c.x, activated: false, glide: 0, dir: 1,
    }));

    // Every cover is a museum exhibit sprite. The classic car (obstacle3) is the
    // moving one (patrols); the rest are static displays. Each is scaled so its
    // content width = the hide-zone width, and grounded by its foot fraction.
    for (const c of this.covers) {
      c.dy = OBSTACLE_DY[c.key] || 0;
      const sx = (c.w / OBSTACLE_CW[c.key]) * (OBSTACLE_VSCALE[c.key] || 1);
      const ox = OBSTACLE_ORIGIN_X[c.key] ?? 0.5;   // coffin: art extends left of the hide-zone
      c.shadow = this.makeShadow(c.key, OBSTACLE_FOOT[c.key], sx, c.x + c.w / 2, FLOOR_Y + c.dy, ox);
      world.push(c.shadow);
      const split = SPLIT_SHADOW[c.key];
      if (split) {   // right half stays put; left half gets its own extra lift
        const src = this.textures.get(c.key).getSourceImage();
        const cut = Math.round(src.width * split.frac);
        c.shadow.setCrop(cut, 0, src.width - cut, src.height);
        c.shadowL = this.makeShadow(c.key, OBSTACLE_FOOT[c.key], sx, c.x + c.w / 2, FLOOR_Y + c.dy, ox);
        c.shadowL.y -= split.leftLift;
        c.shadowL.setCrop(0, 0, cut, src.height);
        world.push(c.shadowL);
      }
      c.sprite = this.add.image(c.x + c.w / 2, FLOOR_Y + c.dy, c.key)
        .setOrigin(ox, OBSTACLE_FOOT[c.key]).setDepth(10).setScale(sx);
      world.push(c.sprite);
    }
    if (DEBUG_HIDE_BOXES) { this.debugGfx = this.add.graphics().setDepth(25); world.push(this.debugGfx); }

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
    this.medusa = this.add.image(DW / 2, ENEMY_DOWN_Y, GUARD.pre.key)
      .setOrigin(0.5, GUARD.pre.foot).setDepth(-11.5).setScale(GUARD.pre.scale);   // behind the wall (-11)
    this.guardPose = 'pre';
    this.medusaY = ENEMY_DOWN_Y;   // starts hidden below the floor (SAFE)
    world.push(this.medusa);
    // Flashlight beam lives in the WORLD, behind the exhibits (depth 5 < covers' 10),
    // and is blocked per-exhibit by an inverted geometry mask keyed to hide-boxes.
    this.spotGfx = this.add.graphics().setDepth(5);    world.push(this.spotGfx);
    this.beamMask = this.make.graphics();
    const bmask = this.beamMask.createGeometryMask();
    bmask.invertAlpha = true;
    this.spotGfx.setMask(bmask);
    // smooth danger vignette: a white edge-glow gradient texture, tinted yellow
    // (warning) or red (look) and pulsed via alpha — no hard-edged border.
    if (!this.textures.exists('vigTex')) this.buildVignetteTex('vigTex', 360);
    this.vignette = this.add.image(0, 0, 'vigTex').setOrigin(0, 0).setDepth(88).setAlpha(0);
    ui.push(this.vignette);

    // ---- HUD (UI camera): timer (left) + progress bar (right), same level ----
    this.timeBar = this.add.image(HUD_PAD, BAR_Y, 'timebar').setOrigin(0, 0.5).setDisplaySize(TB_W, TB_H).setDepth(96);
    ui.push(this.timeBar);   // green hourglass pill, left-anchored (== progress bar's right padding)
    this.timerText = this.add.text(TB_TEXT_X, BAR_Y, '00:20', {
      fontFamily: FONT, fontSize: 52, color: '#111111', fontStyle: 'bold'
    }).setOrigin(0.5, 0.5).setDepth(97);   // black time on the pill, right of the hourglass
    ui.push(this.timerText);

    this.hudState = this.add.image(DW / 2, 560, 'excl_yellow')
      .setOrigin(0.5).setScale(0.62).setDepth(95).setVisible(false);   // "!!!" warning/look indicator
    ui.push(this.hudState);

    // progress bar (right, same level as the timer): empty track + full overlay
    // revealed left-to-right by cropping the full image to the current progress.
    this.progEmpty = this.add.image(BAR_LEFT, BAR_Y, 'progress_empty').setOrigin(0, 0.5).setDisplaySize(BAR_W, BAR_H).setDepth(95);
    ui.push(this.progEmpty);
    this.progFull = this.add.image(BAR_LEFT, BAR_Y, 'progress_full').setOrigin(0, 0.5).setDisplaySize(BAR_W, BAR_H).setDepth(96);
    ui.push(this.progFull);
    this.progHead = this.add.image(BAR_LEFT, BAR_Y, 'alienhead').setOrigin(0.5, 0.5).setDisplaySize(BAR_HEAD, BAR_HEAD_H).setDepth(97);
    ui.push(this.progHead);   // alien head riding the fill's leading edge
    { const p0 = Phaser.Math.Clamp((this.leadX - START_X) / (ESCAPE_X - START_X), 0, 1);   // starts empty
      this.progFull.setCrop(0, 0, BAR_TEX_W * p0, BAR_TEX_H);
      this.progHead.x = BAR_LEFT + BAR_W * p0; }

    // voice meter (fills with your voice; turns green once loud enough to move):
    // white track image, colored level fill inside it, threshold marker + mic icon.
    this.micTrack = this.add.image(MIC_X, MIC_TOP + MIC_H / 2, 'voicebar').setDisplaySize(MIC_W, MIC_H).setDepth(95);
    ui.push(this.micTrack);
    this.micFill = this.add.rectangle(MIC_X, MIC_FILL_BOT, MIC_W - 20, MIC_FILL_H, 0xff5a5a).setOrigin(0.5, 1).setDepth(96).setScale(1, 0);
    ui.push(this.micFill);
    this.micMark = this.add.image(MIC_X, MIC_FILL_BOT - MIC_FILL_H * (VOICE_THRESHOLD / MIC_MAX), 'voicethresholdmarker').setDisplaySize(MIC_W + 24, 26).setDepth(97);
    ui.push(this.micMark);   // threshold line
    this.micIcon = this.add.image(MIC_X, MIC_TOP + MIC_H + 54, 'voiceicon').setDisplaySize(74, 74).setDepth(98);
    ui.push(this.micIcon);

    // HUD stays visible on the ready + game-over screens too (never removed)

    // ---- game-over screen (UI camera), hidden until you win/lose ----
    this.overlay = this.add.rectangle(0, 0, DW, DH, 0x101024, 0).setOrigin(0, 0).setDepth(100);
    ui.push(this.overlay);
    this.outcomeImg = this.add.image(DW / 2, DH / 2, 'title_gameover').setOrigin(0.5, 0.5).setDepth(101).setVisible(false);
    ui.push(this.outcomeImg);   // GAME OVER / YOU WIN title art
    this.overlayText = this.add.text(DW / 2, DH / 2, '', {
      fontFamily: FONT, fontSize: 66, color: '#000000', fontStyle: 'bold',
      align: 'center', stroke: '#ffffff', strokeThickness: 8
    }).setOrigin(0.5, 0.5).setDepth(101).setVisible(false);
    ui.push(this.overlayText);   // "Time Out!" above the title (time-out loss only)

    // ---- ready screen: 语音提示 mic header + instruction (white, black outline)
    // + PLAY button, all three vertically centred on screen ----
    this.readyGrad = this.add.image(0, 0, 'darkgrad').setOrigin(0, 0).setDisplaySize(DW, DH).setDepth(99);
    ui.push(this.readyGrad);
    this.readyTitle = this.add.image(DW / 2, 0, 'voicehint').setOrigin(0.5, 0).setScale(0.85).setDepth(101);
    this.readyText = this.add.text(DW / 2, 0, 'Yell to run!\nHide from the guard and\nreach the end in time.', {
      fontFamily: FONT, fontSize: 58, color: '#ffffff', fontStyle: 'bold', align: 'center', lineSpacing: 18,
      stroke: '#000000', strokeThickness: 9
    }).setOrigin(0.5, 0).setDepth(101);
    this.playBtn = this.add.image(DW / 2, 0, 'playbutton').setOrigin(0.5, 0.5).setScale(0.9).setDepth(101);
    this.playLabel = this.add.text(DW / 2, 0, 'PLAY', {
      fontFamily: FONT, fontSize: 72, color: '#111111', fontStyle: 'bold'
    }).setOrigin(0.5, 0.5).setDepth(102);
    ui.push(this.readyTitle, this.readyText, this.playBtn, this.playLabel);
    // centre the (mic icon + instruction + button) group vertically
    const gapTI = 30, gapTB = 78, btnH = this.playBtn.displayHeight, titleH = this.readyTitle.displayHeight;
    const totalH = titleH + gapTI + this.readyText.height + gapTB + btnH;
    const grpTop = DH / 2 - totalH / 2;
    this.readyTitle.y = grpTop;
    this.readyText.y = grpTop + titleH + gapTI;
    const btnCY = this.readyText.y + this.readyText.height + gapTB + btnH / 2;
    this.playBtn.y = btnCY;
    this.playLabel.y = btnCY - 6;   // optical centre on the button
    this.playBtnY = btnCY;          // reused so the end-screen RETRY sits at the same spot

    // ---- state ----
    this.state = 'ready';
    this.holding = false;
    this.voiceLevel = 0;
    this.phase = 'safe';
    this.phaseTime = 0;
    this.attacksLeft = 0;
    // (ready screen: readyText + PLAY button are visible by default)

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
    this.cameras.main.centerOn(this.camTarget.x, this.camTarget.y);   // start already settled (no pan-in on start)

    this.uiCam = this.cameras.add(0, 0, DW, DH);
    this.uiCam.setScroll(0, 0);

    this.cameras.main.ignore(ui);
    this.uiCam.ignore(world);
    this._world = world;   // so dynamically-created world objects (death rings) can join it

    // Lock the dog to the exact camera centre right BEFORE it renders (after the
    // camera's follow has settled this frame) — zero horizontal latency vs the rays.
    // Near the end the camera stops (like the wall + ground); freeze the guard at a
    // fixed world x there so it doesn't keep following as the alien walks off-screen.
    this.cameras.main.on('prerender', (cam) => {
      if (this.medusa) this.medusa.x = this.guardWorldX(cam);
    });
  }

  // Guard's horizontal world position: tracks the camera centre while it scrolls,
  // but once the camera has stopped near the end it stays pinned at CAM_STOP_X —
  // a fixed spot like the wall/ground — so the alien walks past it to escape.
  guardWorldX(cam) {
    return (this.leadX + PLAYER_X_OFFSET >= CAM_STOP_X) ? CAM_STOP_X : cam.midPoint.x;
  }

  startGame() {
    this.state = 'playing';
    this.timeLeft = TIME_LIMIT;
    this.overlay.setVisible(false);
    this.overlayText.setVisible(false);
    this.readyGrad.setVisible(false);      // hide the ready-screen group
    this.readyTitle.setVisible(false);
    this.readyText.setVisible(false);
    this.playBtn.setVisible(false);
    this.playLabel.setVisible(false);
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
      this.phaseTime = 1.3;                           // emerge + eyes-open beat before the strike
                                                      // (the rise itself takes ~1.21s, so this is just enough)
      // No chained attacks at a turtle (moving-cover) section — single strike only.
      let nearest = null, best = Infinity;
      for (const c of this.covers) {
        const d = Math.abs((c.curX + c.w / 2) - this.leadX);
        if (d < best) { best = d; nearest = c; }
      }
      // extra back-to-back attacks this rise — capped at 1 so a rise never
      // strikes more than twice in a row.
      this.attacksLeft = (nearest && nearest.moving) ? 0 : (Math.random() < 0.6 ? 0 : 1);
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

  // Slight dark gradient: transparent at top, black toward the bottom (ready screen).
  makeDarkGradient() {
    const key = 'darkgrad';
    if (this.textures.exists(key)) return;
    const tex = this.textures.createCanvas(key, 8, DH);
    const ctx = tex.getContext();
    const g = ctx.createLinearGradient(0, 0, 0, DH);
    g.addColorStop(0.00, 'rgba(0,0,0,0)');
    g.addColorStop(0.45, 'rgba(0,0,0,0.12)');
    g.addColorStop(1.00, 'rgba(0,0,0,0.6)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, 8, DH);
    tex.refresh();
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

  // Soft radial glow behind the winning alien.
  makeGlowTex() {
    const key = 'winglow';
    if (this.textures.exists(key)) return;
    const S = 256, tex = this.textures.createCanvas(key, S, S), ctx = tex.getContext();
    const g = ctx.createRadialGradient(S / 2, S / 2, 0, S / 2, S / 2, S / 2);
    g.addColorStop(0.00, 'rgba(255,244,150,0.9)');
    g.addColorStop(0.40, 'rgba(255,214,60,0.45)');
    g.addColorStop(1.00, 'rgba(255,214,60,0.0)');
    ctx.fillStyle = g; ctx.fillRect(0, 0, S, S);
    tex.refresh();
  }

  // Black game-over gradient: dark at top & bottom, lighter (but still dim) middle.
  makeBlackGradient() {
    const key = 'blackgrad';
    if (this.textures.exists(key)) return;
    const tex = this.textures.createCanvas(key, 8, DH);
    const ctx = tex.getContext();
    const g = ctx.createLinearGradient(0, 0, 0, DH);
    g.addColorStop(0.00, 'rgba(0,0,0,0.96)');
    g.addColorStop(0.42, 'rgba(0,0,0,0.30)');
    g.addColorStop(0.58, 'rgba(0,0,0,0.30)');
    g.addColorStop(1.00, 'rgba(0,0,0,0.96)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, 8, DH);
    tex.refresh();
  }

  // Shape-based cast shadow: a black, flattened, flipped-down copy of the sprite,
  // anchored at the feet so it lies on the floor with the object's silhouette.
  // Lifted up slightly (SHADOW_LIFT) so it tucks under the base with no gap.
  // White edge-glow texture: opaque at the screen border, fading smoothly to
  // transparent `band` px inward on all four sides (tinted + pulsed at runtime).
  buildVignetteTex(key, band) {
    const tex = this.textures.createCanvas(key, DW, DH);
    const ctx = tex.getContext();
    ctx.clearRect(0, 0, DW, DH);
    const edge = (grd) => { grd.addColorStop(0, 'rgba(255,255,255,1)'); grd.addColorStop(1, 'rgba(255,255,255,0)'); ctx.fillStyle = grd; };
    edge(ctx.createLinearGradient(0, 0, 0, band));            ctx.fillRect(0, 0, DW, band);
    edge(ctx.createLinearGradient(0, DH, 0, DH - band));      ctx.fillRect(0, DH - band, DW, band);
    edge(ctx.createLinearGradient(0, 0, band, 0));            ctx.fillRect(0, 0, band, DH);
    edge(ctx.createLinearGradient(DW, 0, DW - band, 0));      ctx.fillRect(DW - band, 0, band, DH);
    tex.refresh();
  }

  makeShadow(key, foot, sx, x, y, ox = 0.5) {
    return this.add.image(x, y - SHADOW_LIFT - (DROP_LIFT[key] || 0), key)
      .setOrigin(ox, foot)
      .setScale(sx, -sx * 0.30)
      .setTintFill(0x000000).setAlpha(0.16).setDepth(6);
  }

  // Freeze the alien in the shocked "fail" pose (caught, or time ran out).
  setFailPose() {
    const m = this.members[0];
    if (!m || !m.img || !m.img.active) return;
    const pf = PLAYER_POSE.fail;
    m.img.anims.stop();
    m.img.clearTint();
    m.img.setTexture(pf.key).setOrigin(0.5, pf.foot).setScale(pf.scale).setDepth(20);
    if (this.playerShadow) {
      this.playerShadow.setVisible(true).anims.stop();
      this.playerShadow.setTexture(pf.key).setOrigin(0.5, pf.foot).setScale(pf.scale, -pf.scale * 0.30);
    }
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

  // Randomized level: each exhibit is used at most once, always including the
  // patrolling car. The first exhibit is centred on START_X (stable spawn); the
  // coffin, when present, is the spawn (its rope barrier trails off-screen left).
  buildLevel() {
    const rnd = (n) => Math.floor(Math.random() * n);
    const shuffle = (a) => { for (let i = a.length - 1; i > 0; i--) { const j = rnd(i + 1); [a[i], a[j]] = [a[j], a[i]]; } return a; };
    const statics = shuffle(LEVEL_POOL.slice());
    // Shuffle the post-spawn run, but never let the patrolling car be the very
    // first obstacle after spawn — swap it deeper into the level if it lands there.
    const tail = (rest) => {
      const t = shuffle([...rest, 'obstacle3']);
      if (t[0] === 'obstacle3') { const j = 1 + rnd(t.length - 1); [t[0], t[j]] = [t[j], t[0]]; }
      return t;
    };
    let order;
    if (Math.random() < 0.45) {
      order = ['coffin', ...tail(statics)];       // coffin + 4 statics + car (6)
    } else {
      const spawn = statics.shift();
      order = [spawn, ...tail(statics)];          // static + 3 statics + car (5)
    }
    const covers = [];
    let x = 0;
    order.forEach((key, i) => {
      const w = HIDE_W[key];
      const cx = i === 0 ? START_X - w / 2 : x;
      const c = { x: cx, w, key };
      if (key === 'newobstacle2') c.gap = [0.40, 0.60];   // duck+toast: middle gap not a hide point
      if (key === 'obstacle3') c.moving = true;           // the car patrols
      covers.push(c);
      // Gap after this cover. The opening stretch was reading as cramped, so the
      // early gaps are widened and taper back to the original 200 baseline.
      x = cx + w + (key === 'obstacle3' ? PATROL : 0) + (GAP_RAMP[i] ?? 200) + rnd(150);
    });
    return covers;
  }

  // The hide-box x-range for a cover: [left, right], after per-exhibit inset tweaks.
  hideEdges(c) {
    const ins = HIDE_INSET[c.key] || [0, 0];
    return [c.curX + COVER_PAD + ins[0], c.curX + c.w - COVER_PAD - ins[1]];
  }

  inCover(x) {
    for (const c of this.covers) {
      const [L, R] = this.hideEdges(c);
      if (x > L && x < R) {
        // a `gap` cover (e.g. two pedestals) leaves its middle exposed — not a hide point
        if (c.gap && x > c.curX + c.gap[0] * c.w && x < c.curX + c.gap[1] * c.w) continue;
        return true;
      }
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
      c.shadow.x = c.sprite.x; c.shadow.y = c.sprite.y - SHADOW_LIFT - (DROP_LIFT[c.key] || 0); c.shadow.setFlipX(c.dir < 0);
    }
    if (DEBUG_HIDE_BOXES && this.debugGfx) this.drawHideBoxes();
  }

  // Debug: draw each cover's hide-zone as a green box (gap covers skip the middle).
  drawHideBoxes() {
    const g = this.debugGfx; g.clear();
    const yTop = FLOOR_Y - 360, yBot = FLOOR_Y + 40;
    for (const c of this.covers) {
      const [L, R] = this.hideEdges(c);
      const segs = c.gap
        ? [[L, c.curX + c.gap[0] * c.w], [c.curX + c.gap[1] * c.w, R]]
        : [[L, R]];
      for (const [x0, x1] of segs) {
        g.fillStyle(0x00ff66, 0.22); g.fillRect(x0, yTop, x1 - x0, yBot - yTop);
        g.lineStyle(4, 0x00ff66, 0.95); g.strokeRect(x0, yTop, x1 - x0, yBot - yTop);
      }
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
    this.deathFlash = flash;   // lingers through the catch, then crossfades to the game-over gray
    this.tweens.add({ targets: flash, alpha: 0.92, duration: 100 });
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
    // Caught by the guard! jaws snap shut + red flash; the alien freezes in shock.
    if (!m.alive) return;
    m.alive = false;
    this.state = 'dying';   // freeze play; run the catch VFX, then show the game-over screen
    this.biteEffect();
    // the guard reacts with the "caught!" close-up during the red teeth VFX
    const gA = GUARD.attack, gC = GUARD.caught;
    this.medusa.setTexture(gC.key).setOrigin(gC.ox, gC.foot).setScale(gC.scale);
    this.guardPose = 'caught';   // so the beam origin uses this pose's flashlight lens
    this.spotGfx.clear(); this.drawBeam();   // keep the flashlight ray pinned on the caught player
    // the player switches to the shocked "fail" pose and STAYS there (doesn't vanish)
    this.setFailPose();
    const gx = m.img.x;
    this.tweens.add({ targets: m.img, x: gx + 8, duration: 40, yoyo: true, repeat: 5 });   // shocked shudder
    // let the red danger flash linger, then crossfade it into the game-over gray
    this.time.delayedCall(1450, () => {
      this.medusa.setTexture('guard_attack').setOrigin(0.5, gA.foot).setScale(gA.scale);
      this.guardPose = 'attack';
      if (this.deathFlash) {
        const f = this.deathFlash; this.deathFlash = null;
        this.tweens.add({ targets: f, alpha: 0, duration: 450, onComplete: () => f.destroy() });
      }
      this.endGame(0, 'caught');
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
    if (moving) this.leadX = Math.min(this.leadX + MOVE_SPEED * dt, ESCAPE_X + 600);   // headroom to walk fully off

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
    if (this.state !== 'playing') return;   // just caught -> killMember runs the death + delayed game-over

    this.updateCat(dt);
    this.updateHud();

    // countdown
    this.timeLeft -= dt;
    if (this.timeLeft <= 0) { this.timeLeft = 0; this.setFailPose(); return this.endGame(0, 'time'); }

    // end conditions
    const alive = this.aliveMembers();
    if (alive.length === 0) return this.endGame(0);
    // escaped once the ENTIRE alien has cleared the right screen edge -> win beat
    const m0 = this.members[0];
    if (m0 && m0.alive) {
      const cam = this.cameras.main;
      const screenRightWorld = cam.midPoint.x + (DW / 2) / cam.zoom;
      if (m0.img.getBounds().left > screenRightWorld) return this.winSequence();
    }
  }

  // Win: the alien has run off the right edge — pan the scene right to reveal it
  // striking the triumphant pose by the exit sign, then show the YOU WIN screen.
  winSequence() {
    if (this.state !== 'playing') return;
    this.state = 'winning';
    this.cameras.main.stopFollow();
    this.spotGfx.clear(); this.beamMask.clear();
    this.medusa.setVisible(false);   // guard out of the winning frame
    const m = this.members[0], pw = PLAYER_POSE.win, y = FLOOR_Y + ALIEN_DY;
    // soft glow behind the winning alien
    const glow = this.add.image(WIN_ALIEN_X, y - 150, 'winglow').setScale(2.4).setDepth(19);
    this.uiCam.ignore(glow);
    m.img.anims.stop();
    m.img.clearTint();
    m.img.setTexture(pw.key).setOrigin(0.5, pw.foot).setScale(pw.scale).setDepth(20);
    m.img.x = WIN_ALIEN_X; m.img.y = y;
    this.playerShadow.setVisible(true).anims.stop();
    this.playerShadow.setTexture(pw.key).setOrigin(0.5, pw.foot).setScale(pw.scale, -pw.scale * 0.30)
      .setTintFill(0x000000).setAlpha(0.16);
    this.playerShadow.x = WIN_ALIEN_X; this.playerShadow.y = y - SHADOW_LIFT;
    // pan the camera right to frame [exit sign | winning alien], then the YOU WIN page
    const cam = this.cameras.main, proxy = { x: cam.midPoint.x };
    this.tweens.add({
      targets: proxy, x: WIN_CAM_X, duration: 650, ease: 'Sine.inOut',
      onUpdate: () => cam.centerOn(proxy.x, CAM_CY),
      onComplete: () => this.time.delayedCall(300, () => this.endGame(1)),
    });
  }

  // Flashlight beam (WORLD space) from the guard's raised flashlight, tracked live
  // from medusaY. Exhibits block it: an inverted mask punches each hide-box column.
  drawBeam() {
    // origin follows whichever pose is holding the flashlight (attack vs caught):
    // each carries its own frame size + lens fraction, so the ray starts on the lens.
    const g = (GUARD[this.guardPose] && GUARD[this.guardPose].flx != null) ? GUARD[this.guardPose] : GUARD.attack;
    const ox = g.ox ?? 0.5;
    const ax = this.guardWorldX(this.cameras.main) + (g.flx - ox) * g.fw * g.scale;   // lens world x
    const ay = this.medusaY - (g.foot - g.fly) * g.fh * g.scale;                      // lens world y
    const baseY = CAM_CY + (DH / 2) / ZOOM;   // world y at the screen bottom
    const aw = 24 / ZOOM, bl = 300 / ZOOM, br = 430 / ZOOM;
    const s = this.spotGfx;
    s.fillStyle(0xfff2a0, 0.34 + Math.sin(this.time.now / 80) * 0.06);
    s.fillTriangle(ax - aw, ay, ax + aw, ay, ax + br, baseY);
    s.fillTriangle(ax - aw, ay, ax + br, baseY, ax - bl, baseY);
    // exhibits cast shadows: project a wedge from each hide-box's BOTTOM (ground
    // contact) away from the flashlight, darkening only the floor beyond the box.
    // Gap covers pass light through the middle. (The sprite blocks the beam above.)
    const mg = this.beamMask; mg.clear(); mg.fillStyle(0xffffff, 1);
    for (const c of this.covers) {
      // shadow spans the full art (coffin + barrier) when flagged, else the hide-box
      let L, R;
      if (SHADOW_FULL_ART[c.key]) { const b = c.sprite.getBounds(); L = b.x; R = b.x + b.width; }
      else [L, R] = this.hideEdges(c);
      const yBot = FLOOR_Y + (SHADOW_YBOT[c.key] || 0);   // shadow origin (per-exhibit)
      const proj = (px) => ax + (px - ax) * (baseY - ay) / (yBot - ay);   // ray apex->(px, yBot) at y=baseY
      const wedge = (x0, x1) => mg.fillPoints(
        [{ x: x0, y: yBot }, { x: x1, y: yBot }, { x: proj(x1), y: baseY }, { x: proj(x0), y: baseY }], true);
      if (c.gap) { wedge(L, c.curX + c.gap[0] * c.w); wedge(c.curX + c.gap[1] * c.w, R); }
      else wedge(L, R);
    }
  }

  updateCat(dt) {
    // slow constant-speed rise/duck: hidden below the floor during SAFE, up for WARNING/LOOK
    const targetY = this.phase === 'safe' ? ENEMY_DOWN_Y : ENEMY_WY;
    const step = ENEMY_RISE_SPEED * dt;
    if (this.medusaY > targetY) this.medusaY = Math.max(targetY, this.medusaY - step);
    else this.medusaY = Math.min(targetY, this.medusaY + step);
    // swap the guard pose to match the phase (confused -> snarl -> still-angry)
    const wantPose = this.phase === 'look' ? 'attack' : this.phase === 'hold' ? 'after' : 'pre';
    if (this.guardPose !== wantPose) {
      this.guardPose = wantPose;
      const g = GUARD[wantPose];
      this.medusa.setTexture(g.key).setOrigin(g.ox ?? 0.5, g.foot).setScale(g.scale);
    }
    this.medusa.x = this.guardWorldX(this.cameras.main);   // screen-centred, or frozen once the camera stops
    this.medusa.y = this.medusaY;

    // Flashlight-beam rays from the guard's glowing eyes (attack pose). Origin tracked
    // live from medusaY, and the guard is centre-locked, so ray + guard never drift.
    this.spotGfx.clear(); this.beamMask.clear();
    if (this.phase === 'look') this.drawBeam();

    // smooth danger vignette: tint the edge-glow yellow (warning) or red (look)
    // and pulse its alpha — a soft gradient glow instead of a hard border.
    if (this.phase !== 'safe') {
      const look = this.phase === 'look';
      const pulse = 0.6 + 0.4 * Math.sin(this.time.now / 100);
      this.vignette.setTint(look ? 0xff3030 : 0xffd23a).setAlpha((look ? 0.62 : 0.4) * pulse);
    } else {
      this.vignette.setAlpha(0);
    }
  }

  updateHud() {
    if (this.phase === 'safe') { this.hudState.setVisible(false); }
    else if (this.phase === 'look') { this.hudState.setTexture('excl_red').setVisible(true); }
    else { this.hudState.setTexture('excl_yellow').setVisible(true); }   // warning / hold

    // countdown display (mm:ss, red in the final seconds)
    const t = Math.max(0, Math.ceil(this.timeLeft));
    const mm = Math.floor(t / 60), ss = t % 60;
    this.timerText.setText(String(mm).padStart(2, '0') + ':' + String(ss).padStart(2, '0'));
    this.timerText.setColor(t <= 5 ? '#c0201a' : '#111111');

    // progress (camera follows this.camTarget automatically): reveal the full bar by crop
    const p = Phaser.Math.Clamp((this.leadX - START_X) / (ESCAPE_X - START_X), 0, 1);   // 0 at spawn, 1 at escape
    this.progFull.setCrop(0, 0, BAR_TEX_W * p, BAR_TEX_H);
    this.progHead.x = BAR_LEFT + BAR_W * p;   // alien head at the fill's leading edge

    // mic meter: fill height = current voice level; green once past the move threshold
    const lvl = Phaser.Math.Clamp((this.voiceLevel || 0) / MIC_MAX, 0, 1);
    this.micFill.setScale(1, lvl);
    this.micFill.setFillStyle((this.voiceLevel || 0) > VOICE_THRESHOLD ? 0x69db7c : 0xff5a5a);   // green when loud enough, else red
  }

  endGame(score, reason) {
    this.state = 'over';
    this.holding = false;
    this.spotGfx.clear(); this.vignette.setAlpha(0); this.hudState.setVisible(false);
    // clear the in-game HUD (timer pill, progress bar, voice meter) on the outcome screen
    [this.timeBar, this.timerText, this.progEmpty, this.progFull, this.progHead,
     this.micTrack, this.micFill, this.micMark, this.micIcon].forEach((o) => o && o.setVisible(false));
    // lost -> subtle black gradient; won -> the same soft gradient as the start screen
    const grad = this.add.image(0, 0, score === 0 ? 'blackgrad' : 'darkgrad')
      .setOrigin(0, 0).setDisplaySize(DW, DH).setDepth(score === 0 ? 99 : 8).setAlpha(0);
    this.cameras.main.ignore(grad);
    this.tweens.add({ targets: grad, alpha: score === 0 ? 0.5 : 1, duration: 300 });
    this.showOutcome(score > 0, reason === 'time');
  }

  showOutcome(win, timeout) {
    this.overlay.setVisible(true);
    // GAME OVER / YOU WIN title art, scaled to a fixed on-screen width
    this.outcomeImg.setTexture(win ? 'title_youwin' : 'title_gameover').setVisible(true);
    const titleScale = 660 / this.outcomeImg.width;
    const titleH = this.outcomeImg.height * titleScale;
    this.overlayText.setText('Time Out!').setVisible(timeout);
    const toH = timeout ? this.overlayText.height : 0;
    this.playLabel.setText('RETRY');
    const bH = this.playBtn.displayHeight;                 // button at its 0.9 scale
    // vertically centre the group: [Time Out! (opt)] + [title] + [RETRY]
    const gTO = 24, gTB = 72;
    const total = (timeout ? toH + gTO : 0) + titleH + gTB + bH;
    let y = DH / 2 - total / 2;
    if (timeout) { this.overlayText.setY(y + toH / 2); y += toH + gTO; }
    this.outcomeImg.setY(y + titleH / 2); y += titleH + gTB;
    const btnCY = y + bH / 2;
    this.playBtn.setY(btnCY).setVisible(true);
    this.playLabel.setY(btnCY - 6).setVisible(true);
    // quick pop-in (title first, then button) with a slight overshoot
    this.outcomeImg.setScale(0);
    this.playBtn.setScale(0);
    this.playLabel.setScale(0);
    this.tweens.add({ targets: this.outcomeImg, scale: titleScale, duration: 300, ease: 'Back.easeOut' });
    this.tweens.add({ targets: this.playBtn, scale: 0.9, duration: 280, delay: 120, ease: 'Back.easeOut' });
    this.tweens.add({ targets: this.playLabel, scale: 1, duration: 280, delay: 120, ease: 'Back.easeOut' });
    if (timeout) {
      this.overlayText.setScale(0);
      this.tweens.add({ targets: this.overlayText, scale: 1, duration: 300, ease: 'Back.easeOut' });
    }
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
