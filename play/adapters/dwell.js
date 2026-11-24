// Copyright Tao. All rights reserved.
import { createClock } from '../clock.js';

export function create({ size }, { dwellMs, targetAssist, rearmPx = 60, minFps = 10 }) {
  if (targetAssist !== 'off') throw new Error(`Unsupported dwell target assist: ${targetAssist}`);
  if (!Number.isInteger(rearmPx) || rearmPx < 10 || rearmPx > 300) {
    throw new Error(`Unsupported rearmPx: ${rearmPx} (use 10 to 300)`);
  }
  if (!Number.isInteger(minFps) || minFps < 3 || minFps > 30) {
    throw new Error(`Unsupported minFps: ${minFps} (use 3 to 30)`);
  }
  const settings = {
    dwell: true, dwell_ms: dwellMs, dwell_radius: .035, dwell_grace_ms: 0, pinch_click: false,
    fps_floor_min_frames: minFps
  };
  let clock = createClock(settings);
  let clickPoint;

  function rememberClick(step) {
    const click = step.events.find(event => event.type === 'pointerdown' && event.source === 'dwell');
    if (click) clickPoint = { x: click.x, y: click.y };
    return step;
  }

  return {
    frame(t, sample) {
      const point = sample?.point;
      if (clickPoint && clock.accepts(t) && Number.isFinite(point?.x) && Number.isFinite(point?.y)) {
        const { width, height } = size();
        const distance = Math.hypot((point.x - clickPoint.x) * width, (point.y - clickPoint.y) * height);
        if (distance > rearmPx) clickPoint = undefined;
      }
      return rememberClick(clock.frame(t, clickPoint && sample ? { ...sample, allowPress: false } : sample));
    },
    tick(t) { return rememberClick(clock.tick(t)); },
    reset(t, clearRearm = false) {
      const terminal = clock.stop(t);
      clock = createClock(settings);
      if (clearRearm) clickPoint = undefined;
      return terminal;
    },
    state(t) { return clock.layer(t); }
  };
}
