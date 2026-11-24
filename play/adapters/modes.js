// Copyright Tao. All rights reserved.
import { createDwell } from '../core/dwell-core.js';
import { createFrameFloor, validPoint } from '../core/input-rules.js';
import { createPen, inSilentZone, layoutFor } from '../core/pen-core.js';
import { createTouchWins } from '../core/touch-wins.js';

export function create({ size }, cfg) {
  const dwell = createDwell(cfg.dwell);
  const pen = createPen(cfg.pen);
  const touchWins = createTouchWins({ quietMs: cfg.touchQuietMs });
  const floor = createFrameFloor(cfg.dwell);
  let point = null, bar = false, pressed = false, status = null, lastPointAt = -Infinity;

  function takePen(step) {
    pressed = step.pressed;
    return step.events.map(({ type, t, x, y }) => ({ type: `pointer${type}`, t, x, y, source: 'pen' }));
  }

  function takeDwell(step, layout) {
    return step.events.flatMap(({ t, x, y }) => {
      if (!inSilentZone(layout, { x, y }, cfg.pen.margin)) return [];
      return ['pointerdown', 'pointerup'].map(type => ({ type, t, x, y, source: 'dwell' }));
    });
  }

  function release(t) {
    dwell.stop();
    point = null;
    bar = false;
    return takePen(pen.stop(t));
  }

  function state(t) {
    const ring = bar ? dwell.state().ring : null;
    const position = ring?.anchor ?? point;
    const lostMs = bar ? cfg.dwell.lostMs : cfg.pen.lostMs;
    if (!position || status || touchWins.isQuiet(t) || t - lastPointAt > lostMs) {
      return { cursor: { x: null, y: null, pressed: false, progress: 0, phase: 'none', visible: false }, status };
    }
    return {
      cursor: { ...position, pressed, progress: ring?.progress ?? 0, phase: ring?.phase ?? 'none', visible: true },
      status
    };
  }

  const result = (t, events = []) => ({ events, ...state(t) });

  function checkFloor(t) {
    status = floor.low(t) ? 'low_fps' : null;
    return status !== null;
  }

  return {
    frame(t, sample) {
      if (!floor.note(t)) return result(t);
      const dimensions = size();
      const layout = layoutFor(cfg.pen, dimensions);
      dwell.setAspect(dimensions.height / dimensions.width);
      if (checkFloor(t)) return result(t, release(t));
      if (touchWins.isQuiet(t)) return result(t);
      const current = validPoint(sample?.point) ? { x: sample.point.x, y: sample.point.y } : null;
      if (current) {
        const inBar = inSilentZone(layout, current, cfg.pen.margin);
        if (!inBar) {
          const { phase, anchor } = dwell.state().ring;
          if (phase === 'done' ? Math.hypot(current.x - anchor.x, current.y - anchor.y) > cfg.dwell.leaveRadius : bar) {
            dwell.stop();
          }
        }
        bar = inBar;
        point = current;
        lastPointAt = t;
      }
      const penEvents = takePen(pen.frame(t, current, dimensions));
      const dwellEvents = takeDwell(dwell.frame(t, bar ? current : null), layout);
      return result(t, [...penEvents, ...dwellEvents]);
    },
    tick(t) {
      if (!Number.isFinite(t)) return result(t);
      if (checkFloor(t)) return result(t, release(t));
      if (touchWins.isQuiet(t)) return result(t);
      const penEvents = takePen(pen.tick(t));
      const dwellEvents = takeDwell(dwell.tick(t), layoutFor(cfg.pen, size()));
      return result(t, [...penEvents, ...dwellEvents]);
    },
    touch(t, trusted) {
      const { quiet, release: started } = touchWins.note(t, trusted);
      return { ...result(t, started ? release(t) : []), quiet };
    },
    reset(t, { keepFrameHistory = false } = {}) {
      if (!keepFrameHistory) floor.reset();
      status = null;
      return result(t, release(t));
    },
    state
  };
}
