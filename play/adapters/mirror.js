// Copyright Tao. All rights reserved.
const key = 'posepointer.mirrorOpacity';

export function create({ app, video, slider, mirrorControl }, { opacity }) {
  let visible = false;
  try {
    const saved = localStorage.getItem(key);
    if (saved !== null && Number.isFinite(Number(saved))) opacity = Math.max(0, Math.min(1, Number(saved)));
  } catch {}

  function draw() {
    video.hidden = !visible;
    app.frame.style.opacity = visible ? 1 - opacity : 1;
  }

  slider.value = String(opacity * 100);
  mirrorControl.hidden = false;
  slider.addEventListener('input', () => {
    opacity = slider.valueAsNumber / 100;
    try { localStorage.setItem(key, String(opacity)); } catch {}
    draw();
  });
  return { draw({ camera }) { visible = camera; draw(); } };
}
