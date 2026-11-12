// The player's hands as 1930s rubber-hose gloves, drawn with inked strokes on a 2D canvas
// above the game. Each part is stroked twice, wide in ink and then narrower in colour, which
// gives one continuous cartoon outline. The gesture code is unaffected: this only draws.

import * as THREE from 'three';
import { projectHand } from './handProjection.mjs';
import { buildHandShape, shadedEdge } from './inkGeometry.mjs';
import { LandmarkSmoother } from '../tracking/smoothing.mjs';

const INK = '#201714';
const GLOVE = '#f6daa6';
const SLEEVE = '#1c4a55';
const CUFF = '#d9a23c';
const HOLD_MS = 220; // keep drawing through short tracking dropouts
const BURST_SPIKES = 11;

const css = hex => `#${hex.toString(16).padStart(6, '0')}`;

class InkHand {
  constructor(side) {
    this.side = side;
    this.imageSmoother = new LandmarkSmoother();
    this.worldSmoother = new LandmarkSmoother();
    this.lastSeen = -Infinity;
    this.points = null;
    this.armSign = side === 'right' ? 1 : -1;
  }

  set(tracked, aspect, now) {
    if (!tracked) {
      if (now - this.lastSeen > HOLD_MS) {
        this.points = null;
        this.imageSmoother.reset();
        this.worldSmoother.reset();
      }
      return;
    }
    this.lastSeen = now;
    const image = this.imageSmoother.smooth(tracked.image, now);
    const world = tracked.world ? this.worldSmoother.smooth(tracked.world, now) : null;
    this.points = projectHand(image, world, { aspect });
  }
}

export class InkHands {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.hands = { left: new InkHand('left'), right: new InkHand('right') };
    this.width = 1;
    this.height = 1;
    this.aspect = 16 / 9;
    this.gesture = null;
    this.roleColors = {};
    this.drewLastFrame = false;
    this.lean = 0;
  }

  resize(aspect, width, height) {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.aspect = aspect;
    this.width = width;
    this.height = height;
    this.dpr = dpr;
    this.canvas.width = Math.round(width * dpr);
    this.canvas.height = Math.round(height * dpr);
    this.halftone = this.createHalftone(dpr);
  }

  /** A rotated grid of ink dots, the printed shadow used throughout the painted art. */
  createHalftone(dpr) {
    const tile = document.createElement('canvas');
    const size = Math.max(2, Math.round((this.height / 720) * 6 * dpr));
    tile.width = size;
    tile.height = size;
    const tileCtx = tile.getContext('2d');
    tileCtx.fillStyle = 'rgba(32,23,20,.62)';
    tileCtx.beginPath();
    tileCtx.arc(size / 2, size / 2, size * 0.27, 0, Math.PI * 2);
    tileCtx.fill();
    const pattern = this.ctx.createPattern(tile, 'repeat');
    pattern.setTransform(new DOMMatrix().rotate(35).scale(1 / dpr));
    return pattern;
  }

  setHands(tracked, now) {
    this.hands.left.set(tracked.left, this.aspect, now);
    this.hands.right.set(tracked.right, this.aspect, now);
  }

  /** Palm centre in camera space, or null when that hand is hidden. */
  palmPoint(hand) {
    const points = this.hands[hand].points;
    return points ? new THREE.Vector3(points[9].x, points[9].y, points[9].z) : null;
  }

  setGesture(gesture, colors) {
    this.gesture = gesture;
    this.roleColors = { throw: css(colors.fire), skyfall: css(colors.storm) }; // the shield spell has its own big visual
  }

  draw(now) {
    const { ctx, dpr } = this;
    const visible = Object.values(this.hands).filter(hand => hand.points);
    if (!visible.length && !this.drewLastFrame) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, this.width, this.height);
    ctx.setTransform(dpr, 0, 0, dpr, -this.lean * (this.height / 720) * 34 * dpr, 0);
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    const shapes = visible.map(hand => {
      const own = hand.side === 'right' ? 1 : -1;
      hand.armSign += (own - hand.armSign) * 0.3;
      return buildHandShape(hand.points, hand.side, this.width, this.height, hand.armSign);
    });
    // Arms go down first so a crossed arm passes under the other hand, not over it.
    shapes.forEach(shape => {
      this.drawBurst(shape, this.gesture?.states?.[shape.side], now);
      this.drawArm(shape.arm, shape.ink);
    });
    shapes.forEach(shape => this.drawHand(shape));
    this.drewLastFrame = visible.length > 0;
  }

  /** A flat comic-book star behind a hand that is forming a spell, instead of a soft glow. */
  drawBurst(shape, state, now) {
    const color = state && this.roleColors[state.role];
    if (!color || state.progress <= 0.02) return;
    const { ctx } = this;
    const ready = state.progress >= 1;
    const pulse = ready ? 1 + Math.sin(now / 75) * 0.07 : 1;
    const outer = (0.04 + 0.055 * state.progress) * shape.scale * pulse; // small enough not to hide the Warden
    const inner = outer * 0.68;
    const spin = ready ? now / 900 : 0;
    ctx.beginPath();
    for (let i = 0; i < BURST_SPIKES * 2; i += 1) {
      const angle = (i / (BURST_SPIKES * 2)) * Math.PI * 2 + spin;
      const radius = i % 2 ? inner : outer;
      const x = shape.centre.x + Math.cos(angle) * radius, y = shape.centre.y + Math.sin(angle) * radius;
      if (i) ctx.lineTo(x, y);
      else ctx.moveTo(x, y);
    }
    ctx.closePath();
    ctx.fillStyle = color;
    ctx.strokeStyle = INK;
    ctx.lineWidth = shape.ink;
    ctx.fill();
    ctx.stroke();
  }

  tracePalm(palm) {
    const { ctx } = this;
    ctx.beginPath();
    palm.forEach((point, index) => (index ? ctx.lineTo(point.x, point.y) : ctx.moveTo(point.x, point.y)));
    ctx.closePath();
  }

  fillPalm(palm, radius, color) {
    const { ctx } = this;
    this.tracePalm(palm);
    ctx.fillStyle = color;
    ctx.strokeStyle = color;
    ctx.lineWidth = radius * 2;
    ctx.fill();
    ctx.stroke();
  }

  traceDigit(digit, shiftX = 0, shiftY = 0) {
    const { ctx } = this;
    ctx.beginPath();
    ctx.moveTo(digit.path[0].x + shiftX, digit.path[0].y + shiftY);
    for (const { c1, c2, to } of digit.curve) {
      ctx.bezierCurveTo(c1.x + shiftX, c1.y + shiftY, c2.x + shiftX, c2.y + shiftY, to.x + shiftX, to.y + shiftY);
    }
  }

  traceArm(arm, shiftX = 0) {
    const { ctx } = this;
    ctx.beginPath();
    ctx.moveTo(arm.start.x + shiftX, arm.start.y);
    ctx.bezierCurveTo(arm.c1.x + shiftX, arm.c1.y, arm.c2.x + shiftX, arm.c2.y, arm.end.x + shiftX, arm.end.y);
  }

  strokeLine(a, b, width, color) {
    const { ctx } = this;
    ctx.beginPath();
    ctx.moveTo(a.x, a.y);
    ctx.lineTo(b.x, b.y);
    ctx.lineWidth = width;
    ctx.strokeStyle = color;
    ctx.stroke();
  }

  drawArm(arm, ink) {
    const { ctx } = this;
    this.traceArm(arm);
    ctx.strokeStyle = INK;
    ctx.lineWidth = (arm.radius + ink) * 2;
    ctx.stroke();
    this.traceArm(arm);
    ctx.strokeStyle = SLEEVE;
    ctx.lineWidth = arm.radius * 2;
    ctx.stroke();
  }

  drawHand(shape) {
    const { ctx } = this;
    const { ink, palm, palmRadius, digits, darts, cuff } = shape;

    this.fillPalm(palm, palmRadius + ink, INK);
    for (const digit of digits) {
      this.traceDigit(digit);
      ctx.strokeStyle = INK;
      ctx.lineWidth = (digit.radius + ink) * 2;
      ctx.stroke();
      this.traceDigit(digit);
      ctx.strokeStyle = GLOVE;
      ctx.lineWidth = digit.radius * 2;
      ctx.stroke();
    }
    // Repainting the palm without ink joins the fingers to the hand and tucks a fist's
    // curled fingers behind it, leaving only the knuckles showing.
    this.fillPalm(palm, palmRadius, GLOVE);

    for (const [from, to] of darts) this.strokeLine(from, to, ink * 0.8, INK);

    this.strokeLine(cuff.a, cuff.b, cuff.thickness + ink * 2, INK);
    this.strokeLine(cuff.a, cuff.b, cuff.thickness, CUFF);

    this.drawHalftone(shape);
  }

  /** Dots along the right side of each form, only where something is already painted. */
  drawHalftone({ arm, palm, palmRadius, digits }) {
    const { ctx } = this;
    ctx.save();
    ctx.globalCompositeOperation = 'source-atop';
    ctx.strokeStyle = this.halftone;

    this.traceArm(arm, arm.radius * 0.62);
    ctx.lineWidth = arm.radius * 0.8;
    ctx.stroke();

    const [a, b] = shadedEdge(palm);
    ctx.beginPath();
    ctx.moveTo(a.x, a.y);
    ctx.lineTo(b.x, b.y);
    ctx.lineWidth = palmRadius * 1.5;
    ctx.stroke();

    for (const digit of digits) {
      this.traceDigit(digit, digit.radius * 0.62, digit.radius * 0.1);
      ctx.lineWidth = digit.radius * 0.72;
      ctx.stroke();
    }
    ctx.restore();
  }
}
