// Camera and MediaPipe lifecycle. Frames stay in the browser: only the library and model
// files are downloaded. Keyboard mode offers the same sample() interface.

import { assignHands } from './hands.mjs';
import { syntheticHand } from './synthetic.mjs';

const VISION_VERSION = '0.10.21';
const VISION_URL = `https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@${VISION_VERSION}/+esm`;
const WASM_URL = `https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@${VISION_VERSION}/wasm`;
const MODEL_URL = 'https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task';

const withStage = (error, stage) => Object.assign(error instanceof Error ? error : new Error(String(error)), { stage });

export class CameraTracker {
  constructor(video) {
    this.kind = 'camera';
    this.video = video;
    this.detector = null;
    this.delegate = null;
    this.stream = null;
    this.generation = 0;
    this.lastVideoTime = -1;
    this.lastTimestamp = 0;
    this.loadAttempts = 0;
    this.previous = null;
    this.onEnded = null;
    this.inferenceMs = 0;
  }

  get live() {
    return Boolean(this.stream);
  }

  async loadDetector() {
    if (this.detector) return;
    // A failed module fetch stays cached by URL, so each retry needs a distinct URL.
    const attempt = this.loadAttempts++;
    const { HandLandmarker, FilesetResolver } = await import(/* webpackIgnore: true */ attempt ? `${VISION_URL}?retry=${attempt}` : VISION_URL);
    const files = await FilesetResolver.forVisionTasks(WASM_URL);
    // Confidence limits a little under MediaPipe's 0.5 defaults, so it keeps hold of hands in
    // hard poses, like hands close together or tilted, instead of dropping one.
    const create = delegate => HandLandmarker.createFromOptions(files, {
      baseOptions: { modelAssetPath: MODEL_URL, delegate },
      runningMode: 'VIDEO',
      numHands: 2,
      minHandDetectionConfidence: 0.4,
      minHandPresenceConfidence: 0.4,
      minTrackingConfidence: 0.4,
    });
    try {
      this.detector = await create('GPU');
      this.delegate = 'GPU';
    } catch (error) {
      console.warn('GPU hand tracking unavailable, using CPU:', error);
      this.detector = await create('CPU');
      this.delegate = 'CPU';
    }
  }

  /** Resolves true once frames are flowing, false if stop() ran first. Errors carry .stage. */
  async start(onStage = () => {}) {
    const token = ++this.generation;
    try {
      onStage('model');
      await this.loadDetector();
    } catch (error) {
      throw withStage(error, 'model');
    }
    if (token !== this.generation) return false;

    onStage('camera');
    let stream;
    try {
      if (!navigator.mediaDevices?.getUserMedia) {
        throw new DOMException('Camera needs localhost or HTTPS', 'SecurityError');
      }
      stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'user', width: { ideal: 1280 }, height: { ideal: 720 } },
        audio: false,
      });
      if (token !== this.generation) {
        stream.getTracks().forEach(track => track.stop());
        return false;
      }
      this.stream = stream;
      this.video.srcObject = stream;
      stream.getVideoTracks()[0].addEventListener('ended', () => {
        if (this.stream === stream) this.onEnded?.();
      });
      await this.video.play();
    } catch (error) {
      if (token === this.generation) this.stop();
      throw withStage(error, 'camera');
    }
    if (token !== this.generation) return false;
    this.lastVideoTime = -1;
    this.previous = null;
    return true;
  }

  stop() {
    this.generation += 1;
    this.stream?.getTracks().forEach(track => track.stop());
    this.stream = null;
    this.video.pause();
    this.video.srcObject = null;
    this.lastVideoTime = -1;
    this.previous = null;
  }

  /** Returns { hands } for a new video frame, otherwise null. */
  sample(now) {
    const { video, detector } = this;
    if (!this.stream || !detector || video.readyState < 2 || video.currentTime === this.lastVideoTime) return null;
    this.lastVideoTime = video.currentTime;
    this.lastTimestamp = Math.max(this.lastTimestamp + 1, now);
    const started = performance.now();
    const result = detector.detectForVideo(video, this.lastTimestamp);
    this.inferenceMs += (performance.now() - started - this.inferenceMs) * 0.1;
    const hands = assignHands(result, this.previous);
    this.previous = hands;
    return { hands };
  }
}

const lerp = (a, b, t) => a + (b - a) * t;
const ANIMATION_MS = { throw: 220, slam: 320, 'dodge-left': 220, 'dodge-right': 220, circle: 780 };
const REST_BETWEEN_MS = 90; // a queued swipe waits this long at rest, so the detector re-arms

/**
 * Keyboard stand-in that acts out each motion with generated hands, so the real detector runs:
 * hold Space and release to throw, hold W to push both palms forward, hold Q and release to slam, arrow keys to swipe
 * one hand outward (one lane; press again to queue another), E to draw the Water circle.
 */
export class KeyboardSource {
  constructor() {
    this.kind = 'keyboard';
    this.fist = false;
    this.shield = false;
    this.storm = false;
    this.aimNx = 0;
    this.fistStart = null;
    this.animation = null;
    this.queue = [];
    this.restUntil = -Infinity;
    this.lastSample = -Infinity;
  }

  get live() {
    return true;
  }

  stop() {}

  play(kind) {
    // A swipe pressed while one is still playing waits its turn, so quick presses chain.
    if (this.animation && kind.startsWith('dodge') && this.animation.kind.startsWith('dodge')) this.queue.push(kind);
    else this.animation = { kind, start: null };
  }

  /** Raw-frame x that puts the throwing fist at the current aim. */
  get fistX() {
    return 0.5 - this.aimNx / 2.4;
  }

  sample(now) {
    if (now - this.lastSample < 33) return null;
    this.lastSample = now;

    const sway = Math.sin(now / 900) * 0.012;
    let left = { pose: 'open', x: 0.74, y: 0.76 + sway };
    let right = { pose: 'open', x: 0.26, y: 0.76 - sway };

    if (!this.animation && this.queue.length && now >= this.restUntil) this.animation = { kind: this.queue.shift(), start: null };
    if (this.animation) {
      this.animation.start ??= now;
      const elapsed = now - this.animation.start;
      const t = Math.min(1, elapsed / 170);
      if (this.animation.kind === 'throw') right = { pose: 'open', x: this.fistX, y: lerp(0.7, 0.52, t), scale: lerp(1.9, 2.4, t) };
      if (this.animation.kind.startsWith('dodge')) {
        // One hand swiped outward, back to the camera, while the other stays put. Raw x grows
        // toward the left of the view. At the end it snaps back: inward, so it never counts.
        if (this.animation.kind === 'dodge-left') left = { pose: 'open', x: left.x + lerp(0, 0.2, t), y: left.y, facing: 'back' };
        else right = { pose: 'open', x: right.x - lerp(0, 0.2, t), y: right.y, facing: 'back' };
      }
      if (this.animation.kind === 'circle') {
        // Water: into the top together, then each hand round its own half to meet at the bottom.
        const a = Math.PI * Math.min(1, Math.max(0, (elapsed - 120) / 520));
        const into = Math.min(1, elapsed / 120);
        const s = Math.sin(a), c = Math.cos(a);
        const y = 0.58 - c * 0.2;
        left = { pose: 'open', x: lerp(left.x, 0.54 + s * 0.11, into), y: lerp(left.y, y, into) };
        right = { pose: 'open', x: lerp(right.x, 0.46 - s * 0.11, into), y: lerp(right.y, y, into) };
      }
      if (this.animation.kind === 'slam') {
        left = { pose: 'fist', x: 0.62, y: lerp(0.42, 0.92, t) };
        right = { pose: 'fist', x: 0.38, y: lerp(0.42, 0.92, t) };
      }
      if (elapsed > ANIMATION_MS[this.animation.kind]) {
        this.animation = null;
        this.restUntil = now + REST_BETWEEN_MS;
      }
    } else if (this.shield) {
      // Both palms pushed toward the screen, side by side.
      left = { pose: 'open', x: 0.6, y: 0.62 };
      right = { pose: 'open', x: 0.4, y: 0.62 };
    } else if (this.storm) {
      left = { pose: 'fist', x: 0.62, y: 0.42 };
      right = { pose: 'fist', x: 0.38, y: 0.42 };
    } else if (this.fist) {
      // Close the hand before moving it, or the sudden move could read as a swipe.
      this.fistStart ??= now;
      right = { pose: 'fist', x: now - this.fistStart < 130 ? right.x : this.fistX, y: 0.7 };
    }
    if (!this.fist) this.fistStart = null;

    const build = (spec, side) => syntheticHand(spec.pose, spec.as ?? side, spec);
    return { hands: { left: build(left, 'left'), right: build(right, 'right') } };
  }
}
