// Copyright Tao. All rights reserved.
import { inRange } from './input-rules.js';

export const validQuietMs = value => inRange(value, 100, 5000);

export function createTouchWins({ quietMs } = {}) {
  if (!validQuietMs(quietMs)) throw new Error('quietMs must be in 100..5000');
  let lastTrustedT = -Infinity;
  const isQuiet = t => t < lastTrustedT + quietMs;
  return {
    note(t, trusted) {
      if (trusted !== true || !Number.isFinite(t)) return { quiet: isQuiet(t), release: false };
      const release = !isQuiet(t);
      lastTrustedT = Math.max(lastTrustedT, t);
      return { quiet: isQuiet(t), release };
    },
    isQuiet
  };
}
