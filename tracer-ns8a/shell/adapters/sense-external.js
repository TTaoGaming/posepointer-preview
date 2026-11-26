// Copyright Tao. All rights reserved.
export function create() {
  let push;
  return {
    start(onFrame) {
      push = frame => {
        if (!Number.isFinite(frame?.t) || !Array.isArray(frame.hands)) return false;
        onFrame({ ...frame, t: performance.now() });
        return true;
      };
      window.ppExternalFrames = push;
    },
    stop() {
      if (window.ppExternalFrames === push) delete window.ppExternalFrames;
    }
  };
}
