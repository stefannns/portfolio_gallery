// A cartoon flame drawn as a little cel animation, in the bridge painting's style: a flat orange
// flame with three tongues and a thick ink outline, a halftone shadow down one side, a yellow
// heart and a cream core. FRAMES drawings sit on one sheet, drawn once at load, so the flame
// stays crisp at any size; each lamp plays the loop at its own pace and starting point.

import * as THREE from 'three';

export const FLAME_SHEET = { frames: 8, columns: 4, rows: 2 };
// Each drawing spans x -0.5..0.5 and y -1.35..0.1 in flame units; the flame's base is y = 0.
export const FLAME_BOX = { left: -0.5, right: 0.5, top: -1.35, bottom: 0.1 };
const CELL = { width: 192, height: 280 };

const INK = '#201714';
const ORANGE = '#fd5d00';
const SHADE = 'rgba(160, 30, 0, 0.55)';
const HEART = '#ffa21c';
const CORE = '#f7dcc0';

/** One drawing, with the context set so 1 unit is the flame's base-to-tip height. */
function drawFlame(ctx, phase) {
  const wave = (speed, offset) => Math.sin(phase * speed + offset);
  const tip = { x: 0.07 * wave(1, 0), y: -1.17 - 0.1 * wave(2, 0.6) };
  const left = { x: -0.25 + 0.03 * wave(1, 2.1), y: -0.7 - 0.08 * wave(2, 2.4) };
  const right = { x: 0.26 + 0.03 * wave(1, 4.2), y: -0.78 - 0.08 * wave(2, 4.4) };
  const wide = 1 + 0.05 * wave(2, 1.3);

  const outer = new Path2D();
  outer.moveTo(-0.3 * wide, -0.1);
  outer.bezierCurveTo(-0.38 * wide, -0.38, -0.33 * wide, -0.58, left.x, left.y);
  outer.quadraticCurveTo(-0.17, -0.55, -0.12, -0.64);
  outer.bezierCurveTo(-0.08, -0.86, tip.x - 0.16, tip.y + 0.3, tip.x, tip.y);
  outer.bezierCurveTo(tip.x + 0.12, tip.y + 0.34, 0.15, -0.86, 0.12, -0.66);
  outer.quadraticCurveTo(0.18, -0.58, right.x, right.y);
  outer.bezierCurveTo(0.33 * wide, -0.6, 0.39 * wide, -0.38, 0.3 * wide, -0.1);
  outer.bezierCurveTo(0.26 * wide, 0.06, -0.26 * wide, 0.06, -0.3 * wide, -0.1);
  outer.closePath();
  ctx.fillStyle = ORANGE;
  ctx.fill(outer);

  // Halftone shadow down the right side, growing toward the edge.
  ctx.save();
  ctx.clip(outer);
  ctx.fillStyle = SHADE;
  for (let y = -1.3; y < 0.1; y += 0.045) {
    for (let x = 0.02; x < 0.45; x += 0.045) {
      const r = Math.max(0, (x - 0.06) * 0.06);
      if (r <= 0) continue;
      ctx.beginPath();
      ctx.arc(x + ((Math.round(y / 0.045) & 1) ? 0.022 : 0), y, r, 0, Math.PI * 2);
      ctx.fill();
    }
  }
  ctx.restore();

  // The yellow heart: a single tongue rising from the base.
  const heartTip = { x: tip.x * 0.5 + 0.02 * wave(1, 1.7), y: -0.74 - 0.06 * wave(2, 2.9) };
  ctx.beginPath();
  ctx.moveTo(-0.2, -0.06);
  ctx.bezierCurveTo(-0.26, -0.32, -0.08, -0.5, heartTip.x, heartTip.y);
  ctx.bezierCurveTo(0.1, -0.5, 0.26, -0.32, 0.2, -0.06);
  ctx.bezierCurveTo(0.14, 0.02, -0.14, 0.02, -0.2, -0.06);
  ctx.fillStyle = HEART;
  ctx.fill();

  // The cream core, inked.
  const coreTip = { x: 0.03 * wave(1, 1), y: -0.48 - 0.05 * wave(2, 3) };
  ctx.beginPath();
  ctx.moveTo(0, -0.03);
  ctx.bezierCurveTo(-0.19, -0.03, -0.15, -0.28, coreTip.x, coreTip.y);
  ctx.bezierCurveTo(0.15, -0.28, 0.19, -0.03, 0, -0.03);
  ctx.fillStyle = CORE;
  ctx.fill();
  ctx.lineWidth = 0.032;
  ctx.strokeStyle = INK;
  ctx.stroke();

  ctx.lineWidth = 0.05;
  ctx.lineJoin = 'round';
  ctx.stroke(outer);
}

/** The sheet of drawings as a texture. Clone it per lamp to give each its own frame. */
export function createFlameSheet() {
  const { frames, columns, rows } = FLAME_SHEET;
  const canvas = document.createElement('canvas');
  canvas.width = CELL.width * columns;
  canvas.height = CELL.height * rows;
  const ctx = canvas.getContext('2d');
  const unit = CELL.height / (FLAME_BOX.bottom - FLAME_BOX.top);
  for (let i = 0; i < frames; i += 1) {
    ctx.save();
    ctx.translate((i % columns) * CELL.width + CELL.width / 2, Math.floor(i / columns) * CELL.height - FLAME_BOX.top * unit);
    ctx.scale(unit, unit);
    drawFlame(ctx, (i / frames) * Math.PI * 2);
    ctx.restore();
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 4;
  texture.repeat.set(1 / columns, 1 / rows);
  return texture;
}

/** Points a lamp's copy of the sheet at a frame. */
export function showFrame(texture, frame) {
  const { columns, rows } = FLAME_SHEET;
  texture.offset.set((frame % columns) / columns, 1 - (Math.floor(frame / columns) + 1) / rows);
}
