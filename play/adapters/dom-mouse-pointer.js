// Copyright Tao. All rights reserved.
export function create({ app }) {
  const pointerId = 1;
  let held = null;

  function emit(type, canvas, x, y) {
    const view = canvas.ownerDocument.defaultView;
    if (!view) return;
    const buttons = type === 'pointerup' ? 0 : Number(type === 'pointerdown' || !!held);
    const event = new view.PointerEvent(type, {
      bubbles: true, cancelable: true, composed: true, clientX: x, clientY: y,
      button: type === 'pointermove' ? -1 : 0, buttons, pointerType: 'mouse',
      pointerId, isPrimary: true, view
    });
    canvas.dispatchEvent(event);
  }

  function release() {
    if (!held) return;
    const { canvas, x, y } = held;
    held = null;
    emit('pointerup', canvas, x, y);
  }

  function send(type, point) {
    if (type === 'pointercancel' || type === 'pointerup') {
      release();
      return;
    }
    const canvas = app.canvas();
    if (!canvas) return;
    const { left, top, width, height } = app.frame.contentDocument.documentElement.getBoundingClientRect();
    const rect = canvas.getBoundingClientRect();
    const x = left + point.x * width, y = top + point.y * height;
    if (x < rect.left || x >= rect.right || y < rect.top || y >= rect.bottom) return;
    if (type === 'pointerdown') {
      if (held) return;
      held = { canvas, x, y };
    }
    emit(type, canvas, x, y);
  }

  return {
    send, release,
    closeDialog(canvas, inset) {
      const rect = canvas.getBoundingClientRect();
      const x = rect.right - inset, y = rect.top + inset;
      emit('pointermove', canvas, x, y);
      emit('pointerdown', canvas, x, y);
      emit('pointerup', canvas, x, y);
    }
  };
}
