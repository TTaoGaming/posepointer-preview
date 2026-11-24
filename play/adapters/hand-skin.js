// Copyright Tao. All rights reserved.
export async function create({ skin }, { skin: kind }) {
  if (kind !== 'wireframe') throw new Error(`Unknown hand skin: ${kind}`);
  const { skeleton } = await import('../mp/runtime.js').catch(() => {
    throw new Error('Missing MediaPipe file: ./mp/runtime.js');
  });
  const scene = skeleton.create({ canvas: skin, opacity: 1, lineWidth: 2.5 });
  let size = { width: 0, height: 0 };
  return {
    resize(width, height) {
      size = { width, height };
      scene.resize(width, height, window.devicePixelRatio);
    },
    draw({ hand }) {
      scene.update({ hands: hand ? [hand] : [] }, size);
      scene.render();
    }
  };
}
