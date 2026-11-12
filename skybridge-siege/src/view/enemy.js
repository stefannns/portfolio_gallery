// The Hex Warden. His body is a generated video clip played on a quad; the gameplay cues
// that must stay legible at 60fps - the charging orb and the ward - are
// still real time and still live here.

import * as THREE from 'three';
import { createVideoClip, ClipPlayer, keyedVideoMaterial } from './videoClip.js';
import { orbAt } from './orbTrack.mjs';
import { ORB_TRACKS } from './wardenOrb.mjs';

const ORB_RING = './assets/fx/fx-orb-charge.png';
const WARD = './assets/fx/fx-ward'; // .png still, -fill.png middle, .mp4 H3 loop
const WARD_SIZE = 3.6; // the drawn hexagon spans about 94% of its square, so a bit taller than him
const CLIP_BASE = './assets/warden/';
const CUTOUT = './assets/warden/warden-cutout.png';

// The character fills its frame, so the quad is sized to put the hem on the floor.
const PLANE_HEIGHT = 3.0;
const PLANE_WIDTH = PLANE_HEIGHT * (768 / 1024);
const ORB = { x: 0.45, y: 2.25 }; // where the glowing orb sits in the painting, in metres

// Each duel state plays part of a clip. Each clip runs between two key poses, and most states
// last about a second, so `rate` gets through the move in time and `to` holds the final pose.
const STATE_CLIPS = {
  idle: { name: 'idle', to: null, rate: 1 },
  telegraph: { name: 'telegraph', to: 3.75, rate: 3.2 }, // staff overhead within the shortest charge
  recover: { name: 'recover', to: 3.1, rate: 4 }, // back to standing as the recovery ends
  stagger: { name: 'stagger', to: 1.65, rate: 3 }, // starts reeling, ends standing
  ward: { name: 'ward', to: 3.8, rate: 3.7 }, // arms wide within the ward's 1.3 s
  defeated: { name: 'defeated', to: 3.9, rate: 1.4 },
};

function chromaMaterial(texture) {
  return new THREE.ShaderMaterial({
    uniforms: {
      map: { value: texture },
      keyLow: { value: 0.05 },
      keyHigh: { value: 0.28 },
      flash: { value: 0 },
      soak: { value: 0 },
    },
    vertexShader: `
      varying vec2 vUv;
      void main() {
        vUv = uv;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: `
      uniform sampler2D map;
      uniform float keyLow;
      uniform float keyHigh;
      uniform float flash;
      uniform float soak;
      varying vec2 vUv;
      void main() {
        vec4 c = texture2D(map, vUv);
        // The art was shot on green screen, so green dominance marks the background. The cut is
        // about a screen pixel wide (fwidth), not the whole soft band of the video's edge, which
        // drew a blurred rim round him.
        float green = c.g - max(c.r, c.b);
        float middle = (keyLow + keyHigh) * 0.5, edge = max(fwidth(green), 0.02);
        float alpha = 1.0 - smoothstep(middle - edge, middle + edge, green);
        if (alpha < 0.02) discard;
        c.g = min(c.g, max(c.r, c.b)); // no green fringe
        // Soaked by a Water Ball: drenched blue, with comic halftone dots of wet.
        vec2 cell = fract(gl_FragCoord.xy / 6.0) - 0.5;
        float dots = 1.0 - smoothstep(0.22, 0.3, length(cell));
        vec3 wet = c.rgb * vec3(0.55, 0.8, 1.25) + vec3(0.0, 0.05, 0.12) + dots * vec3(0.0, 0.06, 0.12);
        vec3 rgb = mix(mix(c.rgb, wet, soak), vec3(1.0, 0.94, 0.99), flash);
        gl_FragColor = vec4(rgb, alpha);
      }
    `,
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
  });
}

export function createEnemy(scene, { z, scale }) {
  const root = new THREE.Group();
  root.position.z = z;
  root.scale.setScalar(scale);
  scene.add(root);
  const body = new THREE.Group();
  root.add(body);

  const clips = {};
  for (const name of Object.keys(STATE_CLIPS).map(key => STATE_CLIPS[key].name)) {
    clips[name] = createVideoClip(`${CLIP_BASE}${name}.mp4`, { loop: true });
  }
  const player = new ClipPlayer(clips);

  const material = chromaMaterial(clips.idle.texture);
  const sprite = new THREE.Mesh(new THREE.PlaneGeometry(PLANE_WIDTH, PLANE_HEIGHT), material);
  sprite.position.y = PLANE_HEIGHT / 2;
  body.add(sprite);

  // Fallback for a checkout without the generated clips: the keyed still of the painting.
  const loader = new THREE.TextureLoader();
  let still = null;
  loader.load(CUTOUT, texture => {
    texture.colorSpace = THREE.SRGBColorSpace;
    still = texture;
  }, undefined, () => {});

  // A drawn ring of hex energy that grows around the staff's orb while he charges.
  const haloMap = loader.load(ORB_RING);
  haloMap.colorSpace = THREE.SRGBColorSpace;
  const halo = new THREE.Sprite(new THREE.SpriteMaterial({
    map: haloMap, depthWrite: false, depthTest: false, transparent: true, toneMapped: false,
  }));
  halo.position.set(ORB.x, ORB.y, 0.12);
  halo.visible = false;
  body.add(halo);

  // The hexagon ward held in front of him: its H3 loop over a see-through violet middle, with
  // the still drawing (middle baked in) until the loop has loaded.
  const ward = new THREE.Group();
  ward.position.set(0, 1.65, 1.75);
  const wardPlane = new THREE.PlaneGeometry(WARD_SIZE, WARD_SIZE);
  const wardArt = loader.load(`${WARD}.png`);
  const wardFill = loader.load(`${WARD}-fill.png`);
  wardArt.colorSpace = wardFill.colorSpace = THREE.SRGBColorSpace;
  const wardStill = new THREE.Mesh(wardPlane, new THREE.MeshBasicMaterial({
    map: wardArt, transparent: true, depthWrite: false, toneMapped: false, side: THREE.DoubleSide,
  }));
  const wardClip = createVideoClip(`${WARD}.mp4`, { loop: true });
  const wardVideo = new THREE.Mesh(wardPlane, keyedVideoMaterial(wardClip.texture, wardFill, { depthTest: true }));
  wardVideo.material.uniforms.opacity.value = 1;
  ward.add(wardStill, wardVideo);
  ward.visible = false;
  body.add(ward);
  let wardIn = 0; // 0 to 1 as it pops up

  let hitFlash = 0;
  let soakLevel = 0;
  let wardPing = 0;
  let recoil = 0;
  let hitUntil = -Infinity;
  let defeated = false;

  const playState = (state, now) => {
    const spec = STATE_CLIPS[state];
    if (!spec) return;
    const shown = now < hitUntil ? STATE_CLIPS.stagger : spec;
    player.play(shown.name, shown);
  };

  return {
    root,
    body,
    /** For debugging and browser checks. */
    get clipState() {
      return { name: player.name, time: player.clip?.video.currentTime ?? null, paused: player.clip?.video.paused ?? null, rate: player.window.rate, held: player.held, orb: { x: halo.position.x, y: halo.position.y } };
    },
    /** For debugging and browser checks. */
    get wardState() {
      return { visible: ward.visible, animated: wardVideo.visible, time: wardClip.video.currentTime, paused: wardClip.video.paused, scale: ward.scale.x };
    },
    hit(now = performance.now()) {
      hitFlash = 1;
      recoil = 1;
      hitUntil = now + 550;
    },
    wardStruck() {
      wardPing = 1;
    },
    reset() {
      hitFlash = 0;
      recoil = 0;
      hitUntil = -Infinity;
      defeated = false;
      body.position.set(0, 0, 0);
      body.rotation.set(0, 0, 0);
      body.scale.setScalar(1);
      sprite.visible = true;
    },
    update(dtMs, now, duel) {
      const seconds = dtMs / 1000;
      const { enemy } = duel;
      root.position.x += (enemy.x - root.position.x) * Math.min(1, seconds * 10);

      const charge = enemy.state === 'telegraph'
        ? Math.min(1, (duel.time - enemy.stateStart) / (enemy.stateUntil - enemy.stateStart))
        : 0;

      // Pick the clip for this state, and let the material follow the clip that is playing.
      if (player.available) {
        playState(enemy.state, now);
        if (player.clip && material.uniforms.map.value !== player.clip.texture) {
          material.uniforms.map.value = player.clip.texture;
        }
        sprite.visible = true;
      } else {
        if (still) {
          if (!sprite.material.map || sprite.material.map !== still) {
            sprite.material = new THREE.MeshBasicMaterial({ map: still, transparent: true, depthWrite: false, side: THREE.DoubleSide, toneMapped: false });
          }
          sprite.visible = true;
        } else {
          sprite.visible = false;
        }
      }
      player.update();

      // The charge ring follows the orb in whichever clip is playing, and hexes launch from it.
      const tracked = player.clip ? orbAt(ORB_TRACKS[player.name], player.clip.video.currentTime) : null;
      const orbX = tracked ? (tracked.x - 0.5) * PLANE_WIDTH : ORB.x;
      const orbY = tracked ? tracked.y * PLANE_HEIGHT : ORB.y;
      halo.position.x = orbX;
      halo.position.y = orbY;
      duel.setBoltOrigin({ x: root.position.x + orbX * scale, y: orbY * scale, z: root.position.z + 0.2 });

      // The charge ring stays real time so the telegraph reads instantly.
      const pulse = 1 + Math.sin(now / (70 - charge * 30)) * 0.1 * charge;
      halo.visible = charge > 0;
      // A double hex charges a bigger ring.
      const unstoppable = enemy.attack?.kind === 'double';
      halo.scale.setScalar((0.5 + charge * 1.6) * pulse * (unstoppable ? 1.45 : 1));
      halo.material.color.setHex(unstoppable ? 0xff6a2a : 0xffffff); // an unstoppable charge burns red
      halo.material.rotation = now * 0.004;

      hitFlash = Math.max(0, hitFlash - seconds * 4);
      recoil = Math.max(0, recoil - seconds * 4.5);
      material.uniforms.flash.value = hitFlash * 0.85;
      soakLevel += ((duel.soaked ? 1 : 0) - soakLevel) * Math.min(1, seconds * 6);
      material.uniforms.soak.value = soakLevel;

      ward.visible = enemy.state === 'ward';
      const animated = wardClip.ready && !wardClip.failed;
      wardVideo.visible = animated;
      wardStill.visible = !animated;
      if (!ward.visible) {
        wardIn = 0;
        if (!wardClip.video.paused) wardClip.video.pause(); // nothing to decode while it is down
      } else {
        if (animated) {
          if (wardClip.video.paused) wardClip.start();
          wardClip.update();
        }
        // Pops up with a small overshoot, then bulges and flashes white when a spell hits it.
        wardIn = Math.min(1, wardIn + seconds * 7);
        const pop = 1 + 1.7 * (wardIn - 1) ** 3 + 0.7 * (wardIn - 1) ** 2; // ease out, slightly past 1
        wardPing = Math.max(0, wardPing - seconds * 3.5);
        ward.scale.setScalar(pop * (1 + wardPing * 0.1));
        wardVideo.material.uniforms.flash.value = wardPing * 0.45;
        wardStill.material.color.setScalar(1 + wardPing * 0.45);
      }

      if (duel.phase === 'victory' && !defeated) {
        defeated = true;
        player.play(STATE_CLIPS.defeated.name, STATE_CLIPS.defeated);
      }
      body.position.z = -recoil * 0.35;
      body.rotation.x = -recoil * 0.16;
    },
  };
}
