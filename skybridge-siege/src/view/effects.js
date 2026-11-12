// Spells and impacts, drawn with the flat cartoon art in assets/fx/ (see tools/build-fx.mjs).
// Everything pops on and off in a few frames rather than fading like a glow.

import * as THREE from 'three';
import { laneTexture } from './textures.js';
import { createVideoClip, keyedVideoMaterial } from './videoClip.js';

const FX_PATH = './assets/fx/';
const PUFFS = 240;
const SHEET_SIDE = 4;
const SHEET_FRAMES = SHEET_SIDE * SHEET_SIDE;
const SHEET_FPS = 14;
const HEX_FAR = 2.2, HEX_NEAR = 0.9; // a hex's width in metres at the Warden and at the player

export const SPELL_COLORS = { fire: 0xff7a2e, ward: 0x86ecff, hex: 0xe04fd0, brass: 0xe8c070, storm: 0xcfe6ff, water: 0x6fb6ff, unstoppable: 0xff4a1a };

/** A comic tag reading UNSTOPPABLE!, for the unstoppable hexes: cream letters on a red flash. */
function unstoppableTag() {
  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = 128;
  const ctx = canvas.getContext('2d');
  ctx.translate(256, 64);
  ctx.rotate(-0.05);
  ctx.beginPath();
  const points = 18;
  for (let i = 0; i <= points * 2; i += 1) {
    const a = (Math.PI * i) / points, r = i % 2 ? 1 : 0.86;
    ctx.lineTo(Math.cos(a) * 236 * r, Math.sin(a) * 56 * r);
  }
  ctx.closePath();
  ctx.fillStyle = '#e8261a';
  ctx.fill();
  ctx.lineWidth = 9;
  ctx.strokeStyle = '#201714';
  ctx.stroke();
  ctx.font = "54px 'Lilita One', 'Arial Rounded MT Bold', Impact, sans-serif";
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.lineWidth = 10;
  ctx.strokeText('UNSTOPPABLE!', 0, 3);
  ctx.fillStyle = '#fff1d2';
  ctx.fillText('UNSTOPPABLE!', 0, 3);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

const loader = new THREE.TextureLoader();

function art(name) {
  const texture = loader.load(`${FX_PATH}${name}.png`);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

function flatSprite(map, { tint = 0xffffff, depthTest = true } = {}) {
  return new THREE.Sprite(new THREE.SpriteMaterial({ map, color: tint, transparent: true, depthWrite: false, depthTest, toneMapped: false }));
}

/** Pooled cartoon smoke puffs, one draw call, tinted per puff. */
class Particles {
  constructor(scene, map) {
    this.cursor = 0;
    this.items = Array.from({ length: PUFFS }, () => ({ life: 0, maxLife: 1, vx: 0, vy: 0, vz: 0, size: 1, gravity: 0 }));
    this.positions = new Float32Array(PUFFS * 3);
    this.colors = new Float32Array(PUFFS * 4);
    this.sizes = new Float32Array(PUFFS);
    this.cells = new Float32Array(PUFFS);
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(this.positions, 3).setUsage(THREE.DynamicDrawUsage));
    geometry.setAttribute('tint', new THREE.BufferAttribute(this.colors, 4).setUsage(THREE.DynamicDrawUsage));
    geometry.setAttribute('size', new THREE.BufferAttribute(this.sizes, 1).setUsage(THREE.DynamicDrawUsage));
    geometry.setAttribute('cell', new THREE.BufferAttribute(this.cells, 1).setUsage(THREE.DynamicDrawUsage));
    this.geometry = geometry;
    this.material = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      uniforms: { scale: { value: 600 }, map: { value: map } },
      vertexShader: `
        attribute vec4 tint; attribute float size; attribute float cell; uniform float scale;
        varying vec4 vTint; varying float vCell;
        void main() {
          vTint = tint;
          vCell = cell;
          vec4 view = modelViewMatrix * vec4(position, 1.0);
          gl_PointSize = size * scale / max(0.2, -view.z);
          gl_Position = projectionMatrix * view;
        }`,
      fragmentShader: `
        uniform sampler2D map; varying vec4 vTint; varying float vCell;
        void main() {
          vec2 st = (gl_PointCoord + vec2(mod(vCell, 2.0), floor(vCell / 2.0))) * 0.5;
          vec4 puff = texture2D(map, vec2(st.x, 1.0 - st.y));
          if (puff.a < 0.02) discard;
          gl_FragColor = vec4(puff.rgb * vTint.rgb, puff.a * vTint.a);
          #include <colorspace_fragment>
        }`,
    });
    this.points = new THREE.Points(geometry, this.material);
    this.points.frustumCulled = false;
    scene.add(this.points);
    this.color = new THREE.Color();
  }

  spawn(position, velocity, { color = 0xffffff, life = 0.5, size = 0.6, gravity = 0 }) {
    const index = this.cursor;
    this.cursor = (this.cursor + 1) % PUFFS;
    Object.assign(this.items[index], { life, maxLife: life, vx: velocity.x, vy: velocity.y, vz: velocity.z, size, gravity });
    this.positions.set([position.x, position.y, position.z], index * 3);
    this.color.setHex(color);
    this.colors.set([this.color.r, this.color.g, this.color.b, 1], index * 4);
    this.cells[index] = Math.floor(Math.random() * 4);
  }

  burst(position, { color, count = 8, speed = 5, life = 0.55, size = 0.8, gravity = 2 }) {
    for (let i = 0; i < count; i += 1) {
      const a = Math.random() * Math.PI * 2, y = Math.random() * 2 - 1, r = Math.sqrt(1 - y * y), s = speed * (0.4 + Math.random() * 0.7);
      this.spawn(position, { x: Math.cos(a) * r * s, y: y * s, z: Math.sin(a) * r * s }, { color, life: life * (0.7 + Math.random() * 0.5), size: size * (0.7 + Math.random() * 0.6), gravity });
    }
  }

  update(seconds) {
    for (let i = 0; i < PUFFS; i += 1) {
      const item = this.items[i];
      if (item.life <= 0) {
        this.sizes[i] = 0;
        continue;
      }
      item.life -= seconds;
      item.vy += item.gravity * seconds;
      this.positions[i * 3] += item.vx * seconds;
      this.positions[i * 3 + 1] += item.vy * seconds;
      this.positions[i * 3 + 2] += item.vz * seconds;
      const t = Math.max(0, item.life / item.maxLife);
      this.colors[i * 4 + 3] = Math.min(1, t * 3);
      this.sizes[i] = item.size * (0.35 + t * 0.65);
    }
    for (const name of ['position', 'tint', 'size', 'cell']) this.geometry.attributes[name].needsUpdate = true;
  }
}

export class Effects {
  constructor(scene, camera, enemyZ) {
    this.scene = scene;
    this.camera = camera;
    this.enemyZ = enemyZ;
    this.maps = {
      fireball: art('fireball-sheet'),
      waterball: art('waterball-sheet'),
      hex: art('hex-sheet'),
      impact: art('fx-impact-fire'),
      spark: art('fx-spark'),
      lightning: art('fx-lightning'),
      strike: art('fx-strike'),
      swat: art('fx-swat'),
    };
    for (const sheet of ['fireball', 'waterball', 'hex']) this.maps[sheet].repeat.set(1 / SHEET_SIDE, 1 / SHEET_SIDE);
    this.particles = new Particles(scene, art('fx-puffs'));
    this.shots = new Map();
    this.pops = [];
    this.strikes = [];
    this.projected = new THREE.Vector3();

    // The shield plays its H3 loop once that has loaded, and shows the still art until then.
    const shield = new THREE.Group();
    shield.position.set(0, -0.04, -1.25);
    shield.visible = false;
    camera.add(shield);
    const shieldPlane = new THREE.PlaneGeometry(1.4, 1.4);
    this.shieldStill = new THREE.Mesh(shieldPlane, new THREE.MeshBasicMaterial({ map: art('fx-shield'), transparent: true, opacity: 0, depthWrite: false, depthTest: false, toneMapped: false, side: THREE.DoubleSide }));
    this.shieldClip = createVideoClip(`${FX_PATH}fx-shield.mp4`, { loop: true });
    this.shieldVideo = new THREE.Mesh(shieldPlane, keyedVideoMaterial(this.shieldClip.texture, art('fx-shield-fill')));
    shield.add(this.shieldStill, this.shieldVideo);
    this.shield = shield;
    this.shieldLevel = 0;
    this.shieldPing = 0;

    const lane = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshBasicMaterial({ map: laneTexture(), color: SPELL_COLORS.hex, transparent: true, opacity: 0, depthWrite: false, toneMapped: false }));
    lane.geometry.rotateX(-Math.PI / 2);
    lane.position.y = 0.04;
    lane.visible = false;
    scene.add(lane);
    this.lane = lane;
    // A second strip, for the double hex's other lane.
    this.lane2 = lane.clone();
    this.lane2.material = lane.material.clone();
    scene.add(this.lane2);
  }

  /** Adds art that snaps on slightly oversized, settles, then fades. */
  pop(map, position, { width = 2, height = width, duration = 0.34, tint = 0xffffff, rotation = 0, center = null, parent = this.scene, depthTest = true } = {}) {
    const sprite = flatSprite(map, { tint, depthTest });
    sprite.material.rotation = rotation;
    if (center) sprite.center.set(center[0], center[1]);
    sprite.position.set(position.x, position.y, position.z);
    sprite.scale.set(width * 0.4, height * 0.4, 1);
    parent.add(sprite);
    this.pops.push({ sprite, parent, width, height, age: 0, duration });
  }

  impact(position, size = 3.4) {
    this.pop(this.maps.impact, position, { width: size, rotation: (Math.random() - 0.5) * 0.6 });
    this.particles.burst(position, { color: 0xffffff, count: 5, speed: 5, size: size * 0.28 });
  }

  /** A Water Ball landing: a burst of spray in water colours. */
  splash(position, size = 3.4) {
    this.pop(this.maps.spark, position, { width: size * 0.8, tint: SPELL_COLORS.water, duration: 0.3, rotation: Math.random() * Math.PI });
    this.particles.burst(position, { color: 0xbfe0ff, count: 8, speed: 6, size: size * 0.24, gravity: -6 });
  }

  spark(position, tint, size) {
    this.pop(this.maps.spark, position, { width: size, tint, duration: 0.26, rotation: Math.random() * Math.PI });
  }

  /** Whoosh lines trailing behind the player on a lane change. */
  speedLines(dir) {
    for (const y of [0.13, -0.1]) {
      this.pop(this.maps.swat, { x: -dir * 0.42, y, z: -0.8 }, { width: 0.48, height: 0.24, duration: 0.24, rotation: dir > 0 ? 0 : Math.PI, parent: this.camera, depthTest: false });
    }
  }

  /** A bolt from above the top of the screen down to the enemy, with a burst where it lands. */
  lightning(x, z) {
    const sprite = flatSprite(this.maps.lightning, { depthTest: false });
    sprite.center.set(0.5, 0.15); // the bolt's tip sits 15% up from the bottom of its image
    sprite.scale.set(3.8, 15.2, 1);
    sprite.position.set(x, 0, z);
    this.scene.add(sprite);
    this.strikes.push({ sprite, age: 0 });
    this.pop(this.maps.strike, { x, y: 0, z }, { width: 7, height: 3.5, center: [0.5, 0.07], duration: 0.42, depthTest: false });
    this.particles.burst({ x, y: 0.6, z }, { color: SPELL_COLORS.storm, count: 6, speed: 6, size: 1.1 });
  }

  createShot(shot) {
    // Unstoppable hexes burn orange-red, bigger, with a tag over them.
    const sprite = flatSprite(this.maps[shot.kind] ?? this.maps.hex, { tint: shot.unstoppable ? 0xff7040 : 0xffffff });
    sprite.position.set(shot.position.x, shot.position.y, shot.position.z);
    this.scene.add(sprite);
    if (shot.unstoppable) {
      this.tagMap ??= unstoppableTag();
      sprite.userData.tag = flatSprite(this.tagMap, { depthTest: false });
      sprite.userData.tag.renderOrder = 5;
      this.scene.add(sprite.userData.tag);
    }
    return sprite;
  }

  disposeShot(sprite) {
    this.scene.remove(sprite);
    sprite.material.dispose();
    if (sprite.userData.tag) {
      this.scene.remove(sprite.userData.tag);
      sprite.userData.tag.material.dispose();
    }
  }

  syncShots(shots) {
    const alive = new Set();
    for (const shot of shots) {
      alive.add(shot.id);
      let sprite = this.shots.get(shot.id);
      if (!sprite) {
        sprite = this.createShot(shot);
        this.shots.set(shot.id, sprite);
      }
      sprite.position.set(shot.position.x, shot.position.y, shot.position.z);
      let size;
      if (shot.kind === 'fireball' || shot.kind === 'waterball') {
        // Huge at arm's length, so it grows as it leaves the camera.
        size = 2.2 * Math.min(1, Math.max(0.12, Math.abs(shot.position.z) / 5));
      } else {
        // A hex narrows to well under a lane's width as it nears, so one in the next lane flies
        // clearly past. It still looms larger on screen all the way in.
        const near = Math.min(1, Math.max(0, (Math.abs(shot.position.z) - 1) / 7));
        size = HEX_NEAR + (HEX_FAR - HEX_NEAR) * near;
      }
      if (shot.unstoppable) size *= 1.35;
      sprite.scale.set(size, size, 1);
      const tag = sprite.userData.tag;
      if (tag) {
        // The pair's tags at two heights, so they never overlap as the hexes leave together.
        tag.position.set(shot.position.x, shot.position.y + size * (shot.id % 2 ? 0.62 : 0.98), shot.position.z);
        tag.scale.set(size * 1.25, size * 0.31, 1);
      }
    }
    for (const [id, sprite] of this.shots) {
      if (!alive.has(id)) {
        this.disposeShot(sprite);
        this.shots.delete(id);
      }
    }
  }

  shieldHit() {
    this.shieldPing = 1;
  }

  clearShots() {
    for (const sprite of this.shots.values()) this.disposeShot(sprite);
    this.shots.clear();
  }

  /**
   * The lanes the hex is coming down, straight from the Warden's line to the player: one, or two
   * for his double hex. laneXs: metres across.
   */
  updateLane(laneXs, charge, opacity, unstoppable = false) {
    const xs = Array.isArray(laneXs) ? laneXs : [laneXs];
    [this.lane, this.lane2].forEach((strip, index) => {
      strip.visible = opacity > 0.01 && index < xs.length;
      if (!strip.visible) return;
      strip.material.color.setHex(unstoppable ? SPELL_COLORS.unstoppable : SPELL_COLORS.hex);
      strip.position.x = xs[index];
      strip.position.z = this.enemyZ / 2;
      strip.rotation.y = 0; // runs straight along the depth axis, like the lane itself
      strip.scale.set(0.7 + charge * 0.7, 1, Math.abs(this.enemyZ));
      strip.material.opacity = Math.min(1, opacity * 1.5);
    });
  }

  updateSheets(now) {
    const frame = Math.floor((now / 1000) * SHEET_FPS) % SHEET_FRAMES;
    const column = frame % SHEET_SIDE, row = Math.floor(frame / SHEET_SIDE);
    for (const map of [this.maps.fireball, this.maps.waterball, this.maps.hex]) {
      map.offset.set(column / SHEET_SIDE, 1 - (row + 1) / SHEET_SIDE);
    }
  }

  updatePops(seconds) {
    for (let i = this.pops.length - 1; i >= 0; i -= 1) {
      const pop = this.pops[i];
      pop.age += seconds;
      const k = pop.age / pop.duration;
      if (k >= 1) {
        pop.parent.remove(pop.sprite);
        pop.sprite.material.dispose();
        this.pops.splice(i, 1);
        continue;
      }
      const grow = k < 0.3 ? 0.4 + (k / 0.3) * 0.72 : 1.12 - ((k - 0.3) / 0.7) * 0.12;
      pop.sprite.scale.set(pop.width * grow, pop.height * grow, 1);
      pop.sprite.material.opacity = k < 0.7 ? 1 : 1 - (k - 0.7) / 0.3;
    }
  }

  update(seconds, now, shieldActive, shieldFraction) {
    this.particles.update(seconds);
    this.updateSheets(now);
    this.updatePops(seconds);

    for (let i = this.strikes.length - 1; i >= 0; i -= 1) {
      const strike = this.strikes[i];
      strike.age += seconds;
      if (strike.age >= 0.42) {
        this.scene.remove(strike.sprite);
        strike.sprite.material.dispose();
        this.strikes.splice(i, 1);
        continue;
      }
      strike.sprite.visible = Math.sin(strike.age * 95) > -0.4; // the cartoon flicker of a lightning bolt
    }

    this.shieldLevel += ((shieldActive ? 1 : 0) - this.shieldLevel) * Math.min(1, seconds * 18);
    this.shieldPing = Math.max(0, this.shieldPing - seconds * 3.2);
    const { shield } = this;
    shield.visible = this.shieldLevel > 0.01;
    const clip = this.shieldClip;
    const animated = clip.ready && !clip.failed;
    this.shieldVideo.visible = animated;
    this.shieldStill.visible = !animated;
    if (!shield.visible && !clip.video.paused) clip.video.pause(); // nothing to decode while it is down
    if (shield.visible) {
      if (animated) {
        if (clip.video.paused) clip.start();
        clip.update();
      }
      // Flicker warns that the shield is about to run out.
      const dying = shieldActive && shieldFraction < 0.3 && Math.sin(now / 28) < 0 ? 0.35 : 1;
      const opacity = Math.min(1, this.shieldLevel * dying);
      this.shieldStill.material.opacity = opacity;
      this.shieldVideo.material.uniforms.opacity.value = opacity;
      shield.rotation.z = now * 0.00025;
      shield.scale.setScalar((0.82 + this.shieldLevel * 0.18) * (1 + this.shieldPing * 0.08));
    }
  }
}
