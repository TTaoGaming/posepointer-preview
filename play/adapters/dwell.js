// Copyright Tao. All rights reserved.
import { createClock, validHand } from '../clock.js';

export function create(context, { dwellMs, targetAssist, rearmPx = 60, minFps = 10 }) {
  if (targetAssist !== 'off') throw new Error(`Unsupported dwell target assist: ${targetAssist}`);
  if (!Number.isInteger(rearmPx) || rearmPx < 10 || rearmPx > 300) {
    throw new Error(`Unsupported rearmPx: ${rearmPx} (use 10 to 300)`);
  }
  if (!Number.isInteger(minFps) || minFps < 3 || minFps > 30) {
    throw new Error(`Unsupported minFps: ${minFps} (use 3 to 30)`);
  }
  const frameGraceMs = Math.ceil(1100 / minFps);
  const settings = {
    dwell: true, dwell_ms: dwellMs, dwell_radius: .035, dwell_grace_ms: frameGraceMs,
    lost_ms: Math.max(300, frameGraceMs),
    pinch_click: false, fps_floor_min_frames: minFps
  };
  let clock = createClock(settings);
  let clickPoint, dwellKey = 0;

  function rememberClick(step) {
    const click = step.events.find(event => event.type === 'pointerdown');
    if (click) clickPoint = { x: click.x, y: click.y };
    return step;
  }

  return {
    frame(t, sample) {
      if (!clock.accepts(t)) return clock.frame(t, sample);
      const point = sample?.point;
      if (!validHand(sample?.hand) || !Number.isFinite(point?.x) || !Number.isFinite(point?.y)) {
        // Cancel the anchor immediately so a timer cannot click after the hand leaves.
        clock.setZone();
        return clock.frame(t, null);
      }
      if (clickPoint) {
        const { width, height } = context.size();
        const { x, y } = point;
        if (Math.hypot((x - clickPoint.x) * width, (y - clickPoint.y) * height) > rearmPx) {
          clickPoint = null;
          dwellKey++;
        }
      }
      return rememberClick(clock.frame(t, {
        ...sample, dwellKey, allowPress: !clickPoint && sample.allowPress !== false
      }));
    },
    tick(t) { return rememberClick(clock.tick(t)); },
    reset(t, forgetClick = false) {
      const terminal = clock.stop(t);
      clock = createClock(settings);
      if (forgetClick) clickPoint = null;
      return terminal;
    },
    state(t) { return clock.layer(t); }
  };
}
