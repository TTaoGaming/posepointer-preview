// Copyright Tao. All rights reserved.
import { create as createCamera, loadTrackingFiles } from './adapters/tracer-camera.js';
import { create as createExternal } from './adapters/sense-external.js';
import { create as createFingertip } from './adapters/fingertip.js';
import { create as createFilter } from './adapters/one-euro.js';
import { create as createModes } from './adapters/modes.js';
import { create as createPointer } from './adapters/tracer-pointer.js';
import { create as createCursor } from './adapters/cursor-ring.js';
import { create as createSkin } from './adapters/hand-skin.js';
import { create as createMirror } from './adapters/mirror.js';

export async function startCamera({ signal, onProgress, onStatus, onError }) {
  const response = await fetch(new URL('./binding.json', import.meta.url), { signal });
  if (!response.ok) throw new Error(`Camera binding returned HTTP ${response.status}`);
  const binding = await response.json();
  const external = binding.sense.id === 'external-frames';
  if (!external && binding.sense.id !== 'mediapipe-hands') {
    throw new Error(`Unknown camera source: ${binding.sense.id}`);
  }

  await loadTrackingFiles({ external, signal, onProgress });
  signal.throwIfAborted();
  onStatus(external ? 'Starting input' : 'Starting camera');

  const byId = id => document.getElementById(id);
  const sheet = byId('sheet');
  const size = () => ({ width: Math.max(1, sheet.clientWidth), height: Math.max(1, sheet.clientHeight) });
  const context = {
    sheet, size, signal, svg: byId('svg'), video: byId('camera'), skin: byId('skin'),
    cursor: byId('cursor'), paper: byId('trace-paper'), slider: byId('opacity')
  };

  const { interaction: config, safety } = binding;
  const fingertip = createFingertip(context, binding.cursor, config.hand);
  const filter = createFilter(context, binding.filter);
  const interaction = createModes(context, { ...config, dwell: config.tap.dwell });
  const pointer = createPointer(context);
  const cursor = createCursor(context);
  const skin = await createSkin(context, binding.overlays.find(overlay => overlay.id === 'hand-skin'));
  signal.throwIfAborted();
  const mirror = createMirror(context);
  const source = external ? createExternal(context) : createCamera(context, binding.sense);
  let ticker, watchdog, lastFrame = -Infinity, physicalPressed = false;
  let latestHand;

  function draw({ cursor: state }) {
    cursor.draw({ point: state.visible ? state : null, pressed: state.pressed, progress: 0, phase: 'none' });
    skin.draw({ hand: state.visible ? latestHand : null });
  }

  function apply(step) {
    draw(step);
    for (const event of step.events) {
      if (event.source === 'pen') pointer.send(event.type, event);
    }
  }

  function resize() {
    const { width, height } = size();
    skin.resize(width, height);
    draw(interaction.state(performance.now()));
  }

  function receive(sample) {
    if (signal.aborted || sample.t <= lastFrame) return;
    lastFrame = sample.t;
    clearTimeout(watchdog);
    watchdog = setTimeout(() => {
      fingertip.reset();
      filter.reset();
      latestHand = null;
      apply(interaction.reset(performance.now(), { keepFrameHistory: true }));
      onStatus('Waiting for camera frames');
    }, safety.stallMs);

    // The video fills the sheet. The fingertip adapter mirrors landmarks
    // before the cursor, wireframe and pointer share those normalized coordinates.
    const hand = fingertip.update(sample, point => point);
    latestHand = hand?.points;
    const tip = hand?.tip;
    const inBounds = tip && tip.x >= 0 && tip.x <= 1 && tip.y >= 0 && tip.y <= 1;
    let point;
    if (inBounds) point = filter.update(tip, sample.t);
    else filter.reset();

    if (physicalPressed) apply(interaction.touch(sample.t, true));
    const step = interaction.frame(sample.t, { point });
    apply(step);
    onStatus(step.status === 'low_fps' ? 'Camera input too slow' : point ? 'Camera on' : 'Show your hand');
  }

  function onTouch(event) {
    if (!event.isTrusted) return;
    if (event.type === 'pointerdown') physicalPressed = true;
    apply(interaction.touch(performance.now(), true));
  }

  for (const type of ['pointerdown', 'touchstart', 'mousedown']) {
    document.addEventListener(type, onTouch, { capture: true, signal });
  }
  const endTouch = event => { if (event.isTrusted) physicalPressed = false; };
  for (const type of ['pointerup', 'pointercancel']) {
    document.addEventListener(type, endTouch, { capture: true, signal });
  }
  window.addEventListener('blur', () => { physicalPressed = false; }, { signal });

  const observer = new ResizeObserver(resize);
  signal.addEventListener('abort', () => {
    clearTimeout(watchdog);
    clearInterval(ticker);
    observer.disconnect();
    latestHand = null;
    apply(interaction.reset(performance.now()));
    pointer.release();
    mirror.draw({ camera: false });
    source.stop();
  }, { once: true });

  resize();
  observer.observe(sheet);
  await source.start(receive, onError);
  signal.throwIfAborted();
  mirror.draw({ camera: Boolean(context.video.srcObject) });
  ticker = setInterval(() => apply(interaction.tick(performance.now())), 25);
  onStatus('Show your hand');
}
