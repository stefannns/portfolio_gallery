// The player's three lanes, painted on the floor ahead of them in the same inked comic style as
// the spells: dashed lines between the lanes and hatched kerbs outside the outer two. The lane
// you are in is lit gold: inked rails along both edges, a halftone wash and chevrons pointing
// at the Warden. It pops across when you dodge. The prompt and the Ready dial cover the floor
// straight ahead, so the rails, which run past both sides of them, carry most of the signal.

import * as THREE from 'three';

const INK = '#201714';
const CREAM = '#f6daa6';
const KERB_RED = '#d9453a';
const NEAR = -2.6, FAR = -14; // the stretch of floor the marks cover, in metres ahead
const FADE_FROM = -7.8; // they fade out from here, well before the Warden
const CHEVRON_ZS = [-5.4, -8.2, -11]; // chevron tips down your lane
// Lemon rather than the amber of the painted floor's rings, so your lane does not blend into them.
const GOLD = new THREE.Color(0xffe23f);
const GOLD_BRIGHT = new THREE.Color(0xfff7c8);
const POP_MS = 280;

/** A repeatable wobble, so the hand-drawn lines look the same on every load. */
function wobble(seed) {
  let s = seed;
  return () => (s = (s * 16807) % 2147483647) / 2147483647 - 0.5;
}

function canvasTexture(width, height, draw) {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  draw(canvas.getContext('2d'));
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 8;
  return texture;
}

/** Canvas coordinates for a stretch of floor: the canvas top is the far end, its bottom the near. */
function floorCanvas(W, H, halfWidth) {
  const px = W / (halfWidth * 2), pz = H / (NEAR - FAR);
  return { px, pz, X: x => (x + halfWidth) * px, Z: z => (z - FAR) * pz };
}

/** Fades the far end of a floor canvas out. */
function fadeFar(ctx, W, H, Z) {
  ctx.globalCompositeOperation = 'destination-in';
  const fade = ctx.createLinearGradient(0, 0, 0, H);
  fade.addColorStop(0, 'rgba(0,0,0,0)');
  fade.addColorStop(Z(FADE_FROM) / H, 'rgba(0,0,0,1)');
  fade.addColorStop(1, 'rgba(0,0,0,1)');
  ctx.fillStyle = fade;
  ctx.fillRect(0, 0, W, H);
  ctx.globalCompositeOperation = 'source-over';
}

/** The lines between and beside the lanes. */
function fieldTexture(offset, halfWidth, kerbs) {
  const W = 512, H = 1024;
  const { px, pz, X, Z } = floorCanvas(W, H, halfWidth);
  return canvasTexture(W, H, ctx => {
    const random = wobble(11);
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    const inked = (path, width) => {
      ctx.strokeStyle = INK;
      ctx.lineWidth = width + 7;
      path();
      ctx.stroke();
      ctx.strokeStyle = CREAM;
      ctx.lineWidth = width;
      path();
      ctx.stroke();
    };

    // Red and cream striped kerbs just outside the outer lanes: in an outer lane, one runs right
    // beside you; in the middle, both are a lane away. The bridge's parapets do this job there.
    const kerbWidth = 0.34, block = 0.55;
    for (const side of kerbs ? [-1, 1] : []) {
      const x = side * (offset * 1.5 + 0.12 + kerbWidth / 2);
      const left = X(x - kerbWidth / 2), width = kerbWidth * px;
      for (let z = NEAR, i = 0; z > FAR; z -= block, i += 1) {
        ctx.fillStyle = i % 2 ? CREAM : KERB_RED;
        ctx.fillRect(left, Z(z - block), width, block * pz);
      }
      ctx.strokeStyle = INK;
      ctx.lineWidth = 4;
      for (let z = NEAR; z > FAR; z -= block) {
        ctx.beginPath();
        ctx.moveTo(left, Z(z));
        ctx.lineTo(left + width, Z(z));
        ctx.stroke();
      }
      ctx.lineWidth = 6;
      ctx.strokeRect(left, Z(FAR), width, Z(NEAR) - Z(FAR));
    }

    // Dashes between the lanes.
    for (const x of [-offset / 2, offset / 2]) {
      for (let z = NEAR - 0.2; z > FAR; z -= 1.4) {
        const length = 0.75 + random() * 0.15;
        const x0 = X(x + random() * 0.03), x1 = X(x + random() * 0.03);
        inked(() => {
          ctx.beginPath();
          ctx.moveTo(x0, Z(z));
          ctx.lineTo(x1, Z(z - length));
        }, 0.12 * px);
      }
    }

    fadeFar(ctx, W, H, Z);
  });
}

/**
 * One lane, white wherever the material's tint should show, with the ink kept dark: a halftone
 * wash that thins with distance and chevrons pointing at the Warden. Lit (your lane): bold
 * dots, filled chevrons and rails along both edges. Unlit: faint dots and outline chevrons.
 */
function laneTexture(offset, halfWidth, lit) {
  const W = 256, H = 1024;
  const { px, pz, X, Z } = floorCanvas(W, H, halfWidth);
  return canvasTexture(W, H, ctx => {
    const random = wobble(5);
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';

    // Halftone wash: big dots near you, shrinking into the distance.
    ctx.fillStyle = lit ? 'rgba(255, 255, 255, 0.55)' : 'rgba(255, 255, 255, 0.3)';
    const step = 0.2;
    for (let z = NEAR, row = 0; z > FAR; z -= step, row += 1) {
      const radius = Math.max(0.6, (lit ? 0.062 : 0.045) * px * Math.min(1, (z - FAR) / (NEAR - FAR) + 0.15));
      for (let x = -offset / 2 + (row % 2 ? step / 2 : step); x < offset / 2 - 0.08; x += step) {
        ctx.beginPath();
        ctx.ellipse(X(x), Z(z), radius, radius * (pz / px), 0, 0, Math.PI * 2);
        ctx.fill();
      }
    }

    // Chevrons pointing at the Warden, each with an offset ink shadow like a misprint.
    const span = offset * 0.34, rise = 1.25, thick = 0.24;
    const arms = (tip, dx = 0, dz = 0) => {
      ctx.beginPath();
      ctx.moveTo(X(-span + dx), Z(tip + rise + dz));
      ctx.lineTo(X(dx), Z(tip + dz));
      ctx.lineTo(X(span + dx), Z(tip + rise + dz));
    };
    ctx.lineJoin = 'miter';
    ctx.miterLimit = 8;
    for (const tip of CHEVRON_ZS) {
      if (!lit) {
        // Plain paint, no ink: seen at an angle from the next lane, inked outlines read as scribbles.
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.7)';
        ctx.lineWidth = thick * px;
        arms(tip);
        ctx.stroke();
        continue;
      }
      ctx.strokeStyle = 'rgba(32, 23, 20, 0.55)';
      ctx.lineWidth = thick * px + 10;
      arms(tip, 0.07, 0.18);
      ctx.stroke();
      ctx.strokeStyle = INK;
      ctx.lineWidth = thick * px + 10;
      arms(tip);
      ctx.stroke();
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = thick * px;
      arms(tip);
      ctx.stroke();
    }

    // Rails along both edges of your lane, over the dashes and kerbs beneath.
    if (!lit) {
      fadeFar(ctx, W, H, Z);
      return;
    }
    ctx.lineJoin = 'round';
    for (const side of [-1, 1]) {
      const x = side * offset / 2;
      const points = [];
      for (let z = NEAR; z >= FAR - 0.5; z -= 0.9) points.push([X(x + random() * 0.02), Z(z)]);
      const path = () => {
        ctx.beginPath();
        points.forEach(([cx, cy], i) => (i ? ctx.lineTo(cx, cy) : ctx.moveTo(cx, cy)));
      };
      ctx.strokeStyle = INK;
      ctx.lineWidth = 0.2 * px + 9;
      path();
      ctx.stroke();
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 0.2 * px;
      path();
      ctx.stroke();
    }
    fadeFar(ctx, W, H, Z);
  });
}

function floorMesh(geometry, map, { color = 0xffffff, opacity = 1, y, order }) {
  const mesh = new THREE.Mesh(geometry, new THREE.MeshBasicMaterial({ map, color, transparent: true, opacity, depthWrite: false, toneMapped: false }));
  mesh.position.set(0, y, (NEAR + FAR) / 2);
  mesh.renderOrder = order; // over the painted floor (-10), under the hex's attack lane and every spell
  return mesh;
}

/**
 * kerbs: draw the striped kerbs outside the outer lanes (the bridge has parapets instead).
 * otherLanes: the tint of the lanes you are not in, chosen to show on the floor beneath.
 */
export function createLaneMarks(scene, { offset, kerbs = true, otherLanes = CREAM }) {
  const fieldHalf = offset * 1.5 + 0.55;
  const field = floorMesh(
    new THREE.PlaneGeometry(fieldHalf * 2, NEAR - FAR).rotateX(-Math.PI / 2),
    fieldTexture(offset, fieldHalf, kerbs),
    { opacity: 0.85, y: 0.015, order: -6 },
  );
  scene.add(field);

  const laneHalf = offset / 2 + 0.2;
  const lanePlane = new THREE.PlaneGeometry(laneHalf * 2, NEAR - FAR).rotateX(-Math.PI / 2);
  const lit = floorMesh(lanePlane, laneTexture(offset, laneHalf, true), { color: GOLD, y: 0.02, order: -5 });
  scene.add(lit);
  // The other lanes, faint, so you can see how many lie to each side of you.
  const unlitMap = laneTexture(offset, laneHalf, false);
  const unlit = [-1, 0, 1].map(lane => {
    const mesh = floorMesh(lanePlane, unlitMap, { color: otherLanes, opacity: 0.9, y: 0.018, order: -5.5 });
    mesh.position.x = lane * offset;
    scene.add(mesh);
    return mesh;
  });

  let current = null;
  let arrivedAt = -Infinity;
  return {
    /** lane: -1, 0 or 1, the lane the player is in. now: milliseconds. */
    update(lane, now) {
      if (lane !== current) {
        current = lane;
        arrivedAt = now;
        unlit.forEach((mesh, index) => (mesh.visible = index - 1 !== lane));
      }
      // Snaps to the new lane a little too wide and bright, then settles: a comic pop.
      const t = Math.min(1, (now - arrivedAt) / POP_MS);
      const pop = (1 - t) * (1 - t);
      lit.position.x = lane * offset;
      lit.scale.x = 1 + pop * 0.22;
      lit.material.color.copy(GOLD).lerp(GOLD_BRIGHT, pop * 0.9 + (Math.sin(now / 320) + 1) * 0.06);
    },
  };
}
