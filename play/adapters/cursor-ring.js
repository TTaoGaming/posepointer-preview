// Copyright Tao. All rights reserved.
export function create({ cursor }) {
  return {
    draw({ point, progress, pressed, phase }) {
      cursor.hidden = !point;
      if (!point) {
        delete cursor.dataset.phase;
        return;
      }
      cursor.style.left = `${100 * point.x}%`;
      cursor.style.top = `${100 * point.y}%`;
      cursor.style.setProperty('--progress', `${progress}turn`);
      cursor.dataset.pressed = String(pressed);
      if (phase !== undefined) cursor.dataset.phase = phase;
    }
  };
}
