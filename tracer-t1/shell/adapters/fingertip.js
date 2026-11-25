// Copyright Tao. All rights reserved.
import { validHand } from '../clock.js';

const distance = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);

export function create(_, config, preferred) {
  const tip = config.tip ?? 8;
  if (config.tip === null || ![4, 8, 12, 16, 20].includes(tip)) {
    throw new Error(`Unsupported fingertip tip: ${config.tip} (use 4, 8, 12, 16 or 20)`);
  }
  let owner = null;
  return {
    update(frame, place) {
      const candidates = frame.hands.flatMap((points, i) => {
        if (!validHand(points)) return [];
        // Match each hand's reported Left/Right label case-insensitively; mirrored only controls display coordinates.
        const side = frame.handedness?.[i]?.toLowerCase() ?? null;
        return [{ points, side, wrist: points[0], size: distance(points[0], points[9]) }];
      });
      let next;
      if (owner) {
        const nearby = candidates.filter(item => (!owner.side || !item.side || owner.side === item.side) &&
          distance(owner.wrist, item.wrist) <= Math.max(.07, owner.size * .8) &&
          item.size >= owner.size / 2 && item.size <= owner.size * 2);
        if (nearby.length === 1) next = nearby[0];
        else if (frame.t - owner.t >= 300) owner = null;
      } else {
        next = candidates.find(item => item.side === preferred) ??
          candidates.find(item => preferred === 'either' || item.side === null);
      }
      if (!next) return null;
      owner = { ...next, side: owner?.side ?? next.side, t: frame.t };
      const points = next.points.map(p => place(frame.mirrored ? p : { x: 1 - p.x, y: p.y }));
      return { points, tip: points[tip] };
    },
    reset() { owner = null; }
  };
}
