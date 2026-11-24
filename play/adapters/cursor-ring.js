// Copyright Tao. All rights reserved.
export function create({ cursor }) {
  return {
    draw({ point, progress, pressed }) {
      cursor.hidden = !point;
      if (!point) return;
      cursor.style.left = `${100 * point.x}%`;
      cursor.style.top = `${100 * point.y}%`;
      cursor.style.setProperty('--progress', `${progress}turn`);
      cursor.dataset.pressed = String(pressed);
    }
  };
}
