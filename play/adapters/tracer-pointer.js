// Copyright Tao. All rights reserved.
import { create as createStockSink } from './dom-mouse-pointer.js';

export function create(context) {
  const { app } = context;
  const { closeDialog } = createStockSink(context);
  let held = null;

  function emit(canvas, type, x, y, buttons) {
    const view = canvas.ownerDocument.defaultView;
    if (!view) return;
    canvas.dispatchEvent(new view.PointerEvent(type, {
      bubbles: true, cancelable: true, composed: true, clientX: x, clientY: y,
      button: type === 'pointermove' ? -1 : 0, buttons, pointerId: 1,
      pointerType: 'mouse', isPrimary: true, view
    }));
  }

  function release() {
    if (!held) return;
    const { canvas, x, y } = held;
    held = null;
    emit(canvas, 'pointerup', x, y, 0);
  }

  function send(type, point) {
    if (type === 'pointerup' || type === 'pointercancel') {
      release();
      return;
    }
    const canvas = held?.canvas ?? app.canvas();
    if (!canvas) return;
    const { left, top, width, height } = canvas.ownerDocument.documentElement.getBoundingClientRect();
    const x = left + point.x * width, y = top + point.y * height;
    if (type === 'pointerdown') {
      const rect = canvas.getBoundingClientRect();
      if (held || x < rect.left || x >= rect.right || y < rect.top || y >= rect.bottom) return;
    } else if (type !== 'pointermove' || !held) {
      return;
    }
    held = { canvas, x, y };
    emit(canvas, type, x, y, 1);
  }

  return { send, release, closeDialog };
}
