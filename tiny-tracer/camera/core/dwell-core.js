// Copyright Tao. All rights reserved.
import { checkKeys, createFrameFloor, inRange, validPoint } from './input-rules.js';

export const dwellRanges = {
  dwellMs: [400, 3000], settleMs: [0, 2000], settlePx: [1, 200],
  refWidthPx: [320, 4096], enterRadius: [0.005, 0.2], leaveRadius: [0.01, 0.5],
  drainRate: [0.5, 10], lostMs: [100, 2000], minFps: [3, 30],
  fpsWindowMs: [500, 3000], aspect: [0.3, 3]
};

export function checkDwellConfig(c) {
  const errors = checkKeys(c, Object.keys(dwellRanges), 'dwell');
  for (const [name, [min, max]] of Object.entries(dwellRanges)) {
    if (!inRange(c?.[name], min, max)) errors.push(`${name} must be in ${min}..${max}`);
  }
  if (!Number.isInteger(c?.minFps)) errors.push('minFps must be an integer');
  if (!(c?.leaveRadius > c?.enterRadius)) errors.push('leaveRadius must be larger than enterRadius');
  return errors;
}

export function createDwell(config) {
  const errors = checkDwellConfig(config);
  if (errors.length) throw new Error(errors.join(', '));
  const { dwellMs, settleMs, settlePx, refWidthPx, enterRadius, leaveRadius, drainRate, lostMs, minFps } = config;
  const freshMs = 1000 / minFps;
  const floor = createFrameFloor(config);
  let { aspect } = config;
  let lastFrame = -Infinity, lastSeen = -Infinity, steppedAt = -Infinity;
  let present = false, status = null;
  let phase = 'none', anchor = null, anchorCount = 0, filledMs = 0;
  const history = [];

  function clearGesture(nextPhase = 'none') {
    phase = nextPhase;
    anchor = null;
    anchorCount = 0;
    filledMs = 0;
    history.length = 0;
  }

  function state(events = []) {
    return {
      events, status,
      ring: { phase, progress: filledMs / dwellMs, visible: phase !== 'none', anchor: anchor && { ...anchor } }
    };
  }

  function checkTiming(t) {
    status = floor.low(t) ? 'low_fps' : null;
    if (status || t - lastSeen > lostMs) {
      clearGesture();
      present = false;
    }
  }

  function advance(t, elapsed, fillElapsed) {
    if (phase === 'draining') {
      filledMs = Math.max(0, filledMs - elapsed * drainRate);
      if (filledMs === 0) clearGesture('settling');
    } else if (phase === 'filling') {
      filledMs = Math.min(dwellMs, filledMs + fillElapsed);
      if (filledMs === dwellMs) {
        phase = 'done';
        return state([{ type: 'click', t, ...anchor }]);
      }
    }
    return state();
  }

  function frame(t, point) {
    if (!floor.note(t)) return state();
    checkTiming(t);
    const elapsed = present ? Math.max(0, t - steppedAt) : 0;
    const fillElapsed = present ? Math.min(elapsed, Math.max(0, lastFrame + freshMs - steppedAt)) : 0;
    lastFrame = t;
    steppedAt = Math.max(t, steppedAt);
    present = !status && validPoint(point);
    if (!present) return state();
    lastSeen = t;
    const { x, y } = point;
    const sample = { x, y };

    if (anchor) {
      const separation = Math.hypot(x - anchor.x, y - anchor.y);
      if (phase === 'done') {
        if (separation <= leaveRadius) return state();
        clearGesture('settling');
      } else {
        phase = separation > leaveRadius ? 'draining' : 'filling';
        if (separation <= enterRadius) {
          anchorCount += 1;
          anchor.x += (x - anchor.x) / anchorCount;
          anchor.y += (y - anchor.y) / anchorCount;
        }
        const result = advance(t, elapsed, fillElapsed);
        if (!anchor) history.push({ t, ...sample });
        return result;
      }
    }

    phase = 'settling';
    history.push({ t, ...sample });
    const cutoff = t - settleMs;
    while (history.length > 1 && history[1].t <= cutoff) history.shift();
    const past = history[0];
    if (past.t <= cutoff && Math.hypot(x - past.x, (y - past.y) * aspect) * refWidthPx < settlePx) {
      phase = 'filling';
      anchor = sample;
      anchorCount = 1;
      history.length = 0;
      return advance(t, elapsed, fillElapsed);
    }
    return state();
  }

  function tick(t) {
    if (!Number.isFinite(t) || t < steppedAt) return state();
    checkTiming(t);
    if (!present || t - lastFrame > freshMs) return state();
    const elapsed = t - steppedAt;
    steppedAt = t;
    return advance(t, elapsed, elapsed);
  }

  function reset() {
    floor.reset();
    clearGesture();
    lastFrame = lastSeen = steppedAt = -Infinity;
    present = false;
    status = null;
    return state();
  }

  return {
    frame, tick, state: () => state(),
    setAspect(a) { if (Number.isFinite(a) && a > 0) aspect = a; },
    reset, stop: reset
  };
}
