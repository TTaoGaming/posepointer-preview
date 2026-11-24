// Copyright Tao. All rights reserved.
import { checkKeys, inRange, validPoint } from './input-rules.js';

const layouts = ['landscape', 'portrait'];
const coordinates = ['x0', 'y0', 'x1', 'y1'];

export const layoutFor = (config, { width, height }) => config.layouts[width >= height ? 'landscape' : 'portrait'];
const contains = (rect, { x, y }, margin = 0) =>
  inRange(x, rect.x0 - margin, rect.x1 + margin) && inRange(y, rect.y0 - margin, rect.y1 + margin);
export const inSilentZone = (layout, point, margin) => layout.silent.some(rect => contains(rect, point, margin));

function checkRect(rect, label) {
  const errors = checkKeys(rect, coordinates, label);
  if (!coordinates.every(key => inRange(rect?.[key], 0, 1)) || !(rect.x1 > rect.x0 && rect.y1 > rect.y0)) {
    errors.push(`${label} must be a nonempty normalized rectangle`);
  }
  return errors;
}

export function checkPenConfig(c) {
  const errors = checkKeys(c, ['lostMs', 'margin', 'layouts'], 'pen');
  if (!inRange(c?.lostMs, 100, 2000)) errors.push('pen lostMs must be in 100..2000');
  if (!inRange(c?.margin, 0, 0.05)) errors.push('pen margin must be in 0..0.05');
  errors.push(...checkKeys(c?.layouts, layouts, 'pen layouts'));
  for (const name of layouts) {
    const layout = c?.layouts?.[name];
    errors.push(...checkKeys(layout, ['paper', 'silent'], name), ...checkRect(layout?.paper, `${name} paper`));
    if (!Array.isArray(layout?.silent) || !layout.silent.length) {
      errors.push(`${name} must have a silent rectangle`);
    } else {
      for (const rect of layout.silent) errors.push(...checkRect(rect, `${name} silent`));
    }
  }
  return errors;
}

export function createPen(config) {
  const errors = checkPenConfig(config);
  if (errors.length) throw new Error(errors.join(', '));
  let lastPoint = null, lastSeen = -Infinity;
  const result = (events = []) => ({ events, pressed: lastPoint !== null });

  function release(t, reason, events) {
    if (!lastPoint) return;
    events.push({ type: 'up', t, ...lastPoint, reason });
    lastPoint = null;
  }

  function tick(t) {
    const events = [];
    if (t - lastSeen > config.lostMs) release(t, 'lost', events);
    return result(events);
  }

  return {
    frame(t, point, size) {
      const { events } = tick(t);
      if (!validPoint(point)) return result(events);
      const layout = layoutFor(config, size);
      if (inSilentZone(layout, point, config.margin)) {
        release(t, 'silent', events);
      } else if (lastPoint || contains(layout.paper, point)) {
        const { x, y } = point;
        events.push({ type: lastPoint ? 'move' : 'down', t, x, y });
        lastPoint = { x, y };
        lastSeen = t;
      }
      return result(events);
    },
    tick,
    stop(t) {
      const events = [];
      release(t, 'stop', events);
      return result(events);
    }
  };
}
