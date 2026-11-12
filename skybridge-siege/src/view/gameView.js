import * as THREE from 'three';
import { createEnemy } from './enemy.js';
import { createBackdrop, createPaintedFloor } from './backdrop.js';
import { createBridge } from './bridge.js';
import { paintingFrame } from './bridgeLayout.mjs';

// Radians the camera looks up on the title screen: far enough that the bridge is out of view.
const LOOK_UP = 0.95;
import { createCloudSea } from './cloudSea.js';
import { createPaintedBridge } from './paintedBridge.js';
import { Effects, SPELL_COLORS } from './effects.js';
import { InkHands } from './inkHands.js';
import { createLaneMarks } from './laneMarks.js';
import { HAND_VIEW } from './handProjection.mjs';

export class GameView {
  constructor(canvas, duel) {
    this.canvas = canvas;
    this.duel = duel;
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2)); // full retina: anything less is upscaled, and soft
    this.renderer.autoClear = false;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.08;

    const { arena } = duel.config;
    this.arena = arena;
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(HAND_VIEW.fov, 16 / 9, 0.05, 260);
    this.camera.position.set(0, arena.eyeY, 0);
    this.camera.rotation.x = 0.015;
    this.scene.add(this.camera);

    this.backdrop = createBackdrop();
    // The sky bridge: each lane's painting drawn flat as it is (paintedBridge.js), or projected
    // onto a 3D model of the bridge with ?bridge=3d (bridge.js). Or the earlier round
    // observatory with ?scene=observatory.
    const query = new URLSearchParams(location.search);
    const observatory = query.get('scene') === 'observatory';
    this.floor = observatory ? createPaintedFloor(this.scene) : null;
    this.painted = !observatory && query.get('bridge') !== '3d' ? createPaintedBridge() : null;
    this.bridge = !observatory && !this.painted ? createBridge(this.scene) : null;
    // The clouds far below are drawn first, behind the bridge however it is drawn.
    this.cloudScene = new THREE.Scene();
    this.clouds = observatory ? null : createCloudSea(this.cloudScene);
    // On the bridge's cream paving the other lanes are painted terracotta so they show.
    this.laneMarks = createLaneMarks(this.scene, { offset: duel.config.lanes.offset, kerbs: observatory, otherLanes: observatory ? '#f6daa6' : '#c0694e' });
    this.enemy = createEnemy(this.scene, { z: arena.enemyZ, scale: arena.wardenScale });
    this.effects = new Effects(this.scene, this.camera, arena.enemyZ);
    this.hands = new InkHands(document.getElementById('hands'));

    this.shake = 0;
    this.kick = 0;
    // Looking up at the sky (1) or level along the bridge (0): the title screen looks up, and
    // starting a duel rolls the camera down into the scene.
    this.look = { from: 1, to: 1, start: 0, ms: 1 };
    this.laneOpacity = 0;
    this.laneX = 0;
    this.resize();
  }

  resize() {
    const width = window.innerWidth, height = window.innerHeight;
    this.renderer.setSize(width, height, false);
    const aspect = width / height;
    this.painted?.resize(aspect);
    if (this.bridge || this.painted) {
      // Framed like the paintings, so a lane at rest shows its painting and nothing past it.
      const frame = paintingFrame(aspect);
      this.camera.fov = frame.fov;
      this.camera.aspect = frame.fullWidth / frame.fullHeight;
      this.camera.setViewOffset(frame.fullWidth, frame.fullHeight, frame.x, frame.y, frame.width, frame.height);
    } else {
      this.camera.aspect = aspect;
    }
    this.camera.updateProjectionMatrix();
    this.backdrop.resize(aspect);
    // Pin the painted floor to where the Warden's feet land for a level, centred camera.
    const { eyeY, enemyZ } = this.arena;
    const rest = this.camera.clone();
    rest.position.set(0, eyeY, 0);
    rest.rotation.set(0.015, 0, 0);
    rest.updateMatrixWorld();
    const feet = new THREE.Vector3(0, 0, enemyZ).project(rest);
    const halfWidthAtEnemy = Math.abs(enemyZ) * Math.tan((this.camera.fov * Math.PI) / 360) * aspect;
    this.floor?.resize(aspect, (1 - feet.y) / 2, halfWidthAtEnemy);
    this.hands.resize(aspect, width, height);
    this.effects.particles.material.uniforms.scale.value = height * 0.9 * this.renderer.getPixelRatio();
  }

  setHands(tracked, gesture, now) {
    this.hands.setHands(tracked, now);
    this.gesture = gesture;
  }

  clearHands() {
    this.hands.setHands({ left: null, right: null }, Infinity);
    this.gesture = null;
  }

  /** Tilts the view up to the sky (the title) or down onto the bridge (the duel). */
  lookUp(up, now = performance.now()) {
    const to = up ? 1 : 0;
    if (this.look.to === to) return;
    this.look = { from: this.lookAmount(now), to, start: now, ms: up ? 1100 : 1900 };
  }

  lookAmount(now) {
    const { from, to, start, ms } = this.look;
    const t = Math.min(1, Math.max(0, (now - start) / ms));
    return from + (to - from) * (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2); // ease in and out
  }

  /** World-space launch point for the given hand, or null if that hand is not visible. */
  handWorldPoint(hand) {
    const point = this.hands.palmPoint(hand);
    if (!point) return null;
    this.camera.updateMatrixWorld();
    const world = this.camera.localToWorld(point);
    return { x: world.x, y: world.y, z: world.z };
  }

  handleEvents(events) {
    const { effects } = this;
    const enemyPos = this.enemy.root.position;
    const { arena } = this;
    for (const event of events) {
      switch (event.type) {
        case 'fireball-cast':
          this.kick = 1;
          effects.particles.burst(event.position, { color: 0xffa45a, count: 3, speed: 1.2, life: 0.25, size: 0.09, gravity: 0 });
          break;
        case 'waterball-cast':
          this.kick = 1;
          effects.particles.burst(event.position, { color: 0xbfe0ff, count: 3, speed: 1.2, life: 0.25, size: 0.09, gravity: 0 });
          break;
        case 'enemy-hit':
          this.enemy.hit();
          if (event.source === 'waterball') effects.splash(event.position, 2.6 * arena.wardenScale);
          else if (event.source !== 'skyfall') effects.impact(event.position, 2.6 * arena.wardenScale);
          break;
        case 'enemy-doused':
          // Steam where his charging orb was.
          effects.particles.burst({ x: enemyPos.x, y: 3.2, z: enemyPos.z + 0.4 }, { color: 0xf3ead8, count: 9, speed: 3, life: 0.9, size: 1.2, gravity: -2 });
          break;
        case 'enemy-warded':
          this.enemy.wardStruck();
          effects.spark(event.position, 0xffb2f2, 2.6);
          break;
        case 'enemy-release':
          effects.spark(event.position, event.double ? SPELL_COLORS.unstoppable : SPELL_COLORS.hex, event.double ? 2.4 : 1.6);
          break;
        case 'enemy-undoused':
          effects.splash(event.position, 1.8 * arena.wardenScale);
          break;
        case 'player-blocked':
          effects.shieldHit();
          this.shake = Math.max(this.shake, 0.35);
          effects.spark({ ...event.position, z: -1.5 }, 0xffffff, 0.8);
          break;
        case 'player-hit':
          this.shake = 1;
          effects.spark({ ...event.position, z: -1.2 }, SPELL_COLORS.hex, 0.75);
          break;
        case 'player-move':
          effects.speedLines(event.dir);
          break;
        case 'skyfall':
          this.shake = Math.max(this.shake, 0.6);
          effects.lightning(enemyPos.x, enemyPos.z);
          if (event.shattered) effects.spark({ x: enemyPos.x, y: 2.2, z: enemyPos.z }, 0xffb2f2, 5);
          break;
        case 'victory':
          effects.impact({ x: enemyPos.x, y: 2.2, z: enemyPos.z }, 7);
          effects.particles.burst({ x: enemyPos.x, y: 2.2, z: enemyPos.z }, { color: SPELL_COLORS.hex, count: 10, speed: 8, life: 0.9, size: 1.6 });
          break;
        case 'restart':
          this.enemy.reset();
          effects.clearShots();
          break;
        default:
          break;
      }
    }
  }

  frame(dtMs, now) {
    const seconds = dtMs / 1000;
    const { duel, camera } = this;
    const { enemy } = duel;

    const charge = enemy.state === 'telegraph' ? Math.min(1, (duel.time - enemy.stateStart) / (enemy.stateUntil - enemy.stateStart)) : 0;
    this.enemy.update(dtMs, now, duel);
    this.backdrop.update(camera.position.x, this.lookAmount(now));
    this.effects.syncShots(duel.projectiles);

    // While he charges, the lane under the player lights up and follows them; once the hex is
    // away, it stays on the lane the hex is flying down. A double hex lights both its lanes from
    // the start of its charge, so there is time to get to the third.
    const incoming = duel.nearestBolt();
    const threatened = duel.threatenedLanes;
    const laneTarget = enemy.state === 'telegraph' ? 0.25 + charge * 0.6 : incoming ? 0.5 : 0;
    this.laneOpacity += (laneTarget - this.laneOpacity) * Math.min(1, seconds * 12);
    if (threatened && threatened.length > 1) {
      this.effects.updateLane(threatened.map(lane => lane * duel.config.lanes.offset), Math.max(charge, 0.5), Math.max(this.laneOpacity, 0.45), true);
    } else {
      const laneX = incoming ? incoming.shot.targetX : duel.player.x;
      this.laneX += (laneX - this.laneX) * Math.min(1, seconds * 14);
      this.effects.updateLane(this.laneX, charge, this.laneOpacity);
    }
    this.laneMarks.update(duel.player.lane, now);
    this.effects.update(seconds, now, duel.shieldUp, duel.shieldFraction);
    // Soaked: drips fall off the Warden.
    if (duel.soaked && now >= (this.nextDrip ?? 0)) {
      this.nextDrip = now + 90;
      const s = this.arena.wardenScale;
      const at = { x: duel.enemy.x + (Math.random() - 0.5) * 1.6 * s, y: (0.8 + Math.random() * 1.9) * s, z: this.arena.enemyZ + 0.3 };
      this.effects.particles.burst(at, { color: 0x7fd6ff, count: 1, speed: 0.6, size: 0.45, gravity: -9 });
    }
    this.hands.setGesture(this.gesture, SPELL_COLORS, now);

    this.shake = Math.max(0, this.shake - seconds * 2.6);
    this.kick = Math.max(0, this.kick - seconds * 7);
    const amount = this.shake * this.shake * 0.13;
    camera.position.x += (duel.player.x - camera.position.x) * Math.min(1, seconds * 14);
    // On the bridge the camera rests exactly where the paintings were painted from (level, no
    // idle bob), so each lane shows its painting as it is; hits and casts still shake it.
    const still = Boolean(this.bridge || this.painted);
    camera.position.y = this.arena.eyeY + (still ? 0 : Math.sin(now / 1400) * 0.012) + Math.sin(now / 23) * amount;
    camera.rotation.z = Math.sin(now / 31) * amount * 0.35 - (camera.position.x - duel.player.x) * 0.012;
    const look = this.lookAmount(now);
    camera.rotation.x = (still ? 0 : 0.015) + this.kick * 0.012 + Math.sin(now / 41) * amount * 0.25 + look * LOOK_UP;
    this.floor?.update(camera.position.x);
    this.bridge?.update(now, camera.position.x);
    this.painted?.update(now, camera.position.x, camera.rotation.x, camera.rotation.z);
    this.clouds?.update(now);

    this.renderer.clear();
    this.renderer.render(this.backdrop.scene, this.backdrop.camera);
    this.renderer.clearDepth();
    this.renderer.render(this.cloudScene, camera);
    if (this.painted) this.renderer.render(this.painted.scene, this.painted.camera);
    this.renderer.clearDepth();
    this.renderer.render(this.scene, camera);
    this.hands.lean = duel.player.x - camera.position.x; // the hands trail the body, then catch up
    this.hands.draw(now);
  }
}
