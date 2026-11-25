// Copyright Tao. All rights reserved.
export function create({ svg, sheet }) {
  let held = null;

  function emit(type, { x, y }, buttons) {
    svg.dispatchEvent(new PointerEvent(type, {
      bubbles: true, cancelable: true, composed: true, clientX: x, clientY: y,
      button: type === 'pointermove' ? -1 : 0, buttons, pointerId: 1,
      pointerType: 'mouse', isPrimary: true, view: svg.ownerDocument.defaultView
    }));
  }

  function release() {
    if (!held) return;
    const point = held;
    held = null;
    emit('pointerup', point, 0);
  }

  function send(type, point) {
    if (type === 'pointerup' || type === 'pointercancel') {
      release();
      return;
    }
    if (type === 'pointerdown' ? held : type !== 'pointermove' || !held) return;
    const { left, top, width, height } = sheet.getBoundingClientRect();
    held = { x: left + point.x * width, y: top + point.y * height };
    emit(type, held, 1);
  }

  return { send, release };
}
