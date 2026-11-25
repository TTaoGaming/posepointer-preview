// Copyright Tao. All rights reserved.
export const isRecord = value => value !== null && typeof value === 'object' && !Array.isArray(value);
export const inRange = (value, min, max) => Number.isFinite(value) && value >= min && value <= max;
export const validPoint = point => inRange(point?.x, 0, 1) && inRange(point?.y, 0, 1);

export function checkKeys(value, keys, label) {
  if (!isRecord(value)) return [`${label} must be an object`];
  return [
    ...keys.filter(key => !Object.hasOwn(value, key)).map(key => `${label} is missing ${key}`),
    ...Object.keys(value).filter(key => !keys.includes(key)).map(key => `${label} has an unknown key ${key}`)
  ];
}

export function createFrameFloor({ fpsWindowMs, minFps }) {
  const frames = [];
  let first = Infinity;
  return {
    note(t) {
      if (!Number.isFinite(t) || t <= (frames.at(-1) ?? -Infinity)) return false;
      first = Math.min(first, t);
      frames.push(t);
      return true;
    },
    low(t) {
      const cutoff = t - fpsWindowMs;
      while (frames.length > 1 && frames[0] <= cutoff) frames.shift();
      const count = frames[0] > cutoff ? frames.length : 0;
      return cutoff >= first && count < minFps;
    },
    reset() {
      first = Infinity;
      frames.length = 0;
    }
  };
}
