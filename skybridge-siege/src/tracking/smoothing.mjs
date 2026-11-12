// One Euro filter: steady when the hand is still, low lag when it moves. Used for drawing
// the hands only. Gesture classification reads unsmoothed landmarks so casting stays quick.

const alpha = (cutoff, dt) => 1 / (1 + 1 / (2 * Math.PI * cutoff * dt));

export class OneEuro {
  constructor({ minCutoff = 1.6, beta = 12, derivativeCutoff = 1 } = {}) {
    Object.assign(this, { minCutoff, beta, derivativeCutoff });
    this.value = null;
    this.derivative = 0;
    this.time = null;
  }

  filter(value, timeMs) {
    if (this.value === null) {
      this.value = value;
      this.time = timeMs;
      return value;
    }
    const dt = Math.max(1e-3, (timeMs - this.time) / 1000);
    this.time = timeMs;
    const rawDerivative = (value - this.value) / dt;
    const dAlpha = alpha(this.derivativeCutoff, dt);
    this.derivative += dAlpha * (rawDerivative - this.derivative);
    const cutoff = this.minCutoff + this.beta * Math.abs(this.derivative);
    this.value += alpha(cutoff, dt) * (value - this.value);
    return this.value;
  }
}

export class LandmarkSmoother {
  constructor(options) {
    this.options = options;
    this.filters = null;
  }

  reset() {
    this.filters = null;
  }

  smooth(points, timeMs) {
    if (!points) {
      this.reset();
      return null;
    }
    this.filters ??= points.map(() => ['x', 'y', 'z'].map(() => new OneEuro(this.options)));
    return points.map((point, index) => ({
      x: this.filters[index][0].filter(point.x, timeMs),
      y: this.filters[index][1].filter(point.y, timeMs),
      z: this.filters[index][2].filter(point.z || 0, timeMs),
    }));
  }
}
