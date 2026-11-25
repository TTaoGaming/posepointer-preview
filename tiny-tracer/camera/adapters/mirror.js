// Copyright Tao. All rights reserved.
export function create({ paper, video, slider, signal }) {
  let visible = false;

  function draw() {
    video.classList.toggle('on', visible);
    paper.style.opacity = visible ? String(1 - slider.valueAsNumber / 100) : '';
  }

  slider.addEventListener('input', draw, { signal });
  return { draw({ camera }) { visible = camera; draw(); } };
}
