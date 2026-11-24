// Copyright Tao. All rights reserved.
const alpha = (cutoff, dt) => 1 / (1 + 1 / (2 * Math.PI * cutoff * dt));
const clamp = n => Math.max(0, Math.min(1, n));

// pp-ts One Euro filter, with the parameters used by its hand core.
class OneEuro {
  xPrev = null;
  dxPrev = 0;

  reset() { this.xPrev = null; this.dxPrev = 0; }

  filter(x, dt) {
    if (this.xPrev === null || !(dt > 0)) {
      this.xPrev = x;
      return x;
    }
    const dx = (x - this.xPrev) / dt;
    const ad = alpha(1, dt);
    this.dxPrev = ad * dx + (1 - ad) * this.dxPrev;
    const a = alpha(1 + .05 * Math.abs(this.dxPrev), dt);
    this.xPrev = a * x + (1 - a) * this.xPrev;
    return this.xPrev;
  }
}

export function create(_, { predictionMs = 0 }) {
  const fx = new OneEuro(), fy = new OneEuro();
  let last, lastT;
  return {
    update(point, t) {
      const elapsed = t - (lastT ?? t);
      const x = fx.filter(point.x, elapsed / 1000);
      const y = fy.filter(point.y, elapsed / 1000);
      const horizon = elapsed > 0 ? predictionMs / elapsed : 0;
      const result = { x: clamp(x + horizon * (x - (last?.x ?? x))), y: clamp(y + horizon * (y - (last?.y ?? y))) };
      lastT = t;
      last = { x, y };
      return result;
    },
    reset() { fx.reset(); fy.reset(); last = lastT = null; }
  };
}
