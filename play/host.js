// Copyright Tao. All rights reserved.
import { createApp } from './gcompris-app.js';

const byId = id => document.getElementById(id);
const stage = byId('stage'), frame = byId('activity'), video = byId('camera');
const start = byId('start-camera'), pause = byId('pause'), kill = byId('kill');
const status = byId('input-status'), appStatus = byId('app-status');
const adapterFiles = {
  sense: { 'mediapipe-hands': 'sense-camera', 'external-frames': 'sense-external' },
  cursor: { fingertip: 'fingertip' },
  filter: { 'one-euro': 'one-euro' },
  interaction: { dwell: 'dwell' },
  sink: { 'dom-mouse-pointer': 'dom-mouse-pointer' },
  overlays: { 'cursor-ring': 'cursor-ring', 'hand-skin': 'hand-skin', mirror: 'mirror' }
};

async function readJson(path) {
  const response = await fetch(path);
  if (!response.ok) throw new Error(`${path} returned HTTP ${response.status}`);
  return response.json();
}

function describeError(error) {
  if (error instanceof Error) return error.message;
  if (error instanceof Event) return `Browser ${error.type} event`;
  return typeof error === 'string' ? error : 'Unexpected error';
}

function assertSafety(binding) {
  const safety = binding.safety;
  if (safety && safety.activeHandLock === true && safety.killSwitch === true && safety.stallRelease === true &&
      (safety.stallMs === undefined || (Number.isInteger(safety.stallMs) && safety.stallMs >= 50 && safety.stallMs <= 500))) {
    return;
  }
  throw new Error('Binding must keep the safety port on');
}

function measuredFps(frames, now) {
  while (frames.length && now - frames[0] >= 1000) frames.shift();
  return frames.length;
}

async function showOfflineStatus() {
  const offline = byId('offline-status');
  try {
    if (!navigator.serviceWorker || !window.caches) throw new Error('Offline storage needs HTTPS or localhost.');
    const registration = await navigator.serviceWorker.register('../sw.js');
    let worker = registration.installing ?? registration.waiting ?? registration.active;
    const manifest = await readJson('../asset-manifest.json');
    const cacheName = `${registration.scope}posepointer-${manifest.version}`;
    const urls = manifest.files.map(file => new URL(file.path, registration.scope).href);
    while (true) {
      worker = registration.installing ?? registration.waiting ?? worker ?? registration.active;
      const cache = (await caches.keys()).includes(cacheName) ? await caches.open(cacheName) : null;
      const saved = new Set((await cache?.keys() ?? []).map(request => request.url));
      const count = urls.filter(url => saved.has(url)).length;
      if (count === urls.length && worker?.state === 'activated' && navigator.serviceWorker.controller) {
        offline.textContent = `Ready for offline (${(manifest.total_bytes / 1024 ** 2).toFixed(1)} MB)`;
        return;
      }
      if (worker?.state === 'redundant') throw new Error('Offline download did not finish.');
      const progress = `Saving for offline: ${count} of ${urls.length} files`;
      if (offline.textContent !== progress) offline.textContent = progress;
      await new Promise(resolve => setTimeout(resolve, 250));
    }
  } catch (error) {
    offline.textContent = `Offline unavailable: ${describeError(error)}`;
  }
}

async function loadAdapter(port, config) {
  const catalog = adapterFiles[port];
  if (!Object.hasOwn(catalog, config?.id)) throw new Error(`Unknown ${port} adapter: ${config?.id ?? '(missing)'}`);
  const module = await import(`./adapters/${catalog[config.id]}.js`);
  return { factory: module.create, config };
}

async function boot() {
  const binding = await readJson('./bindings/gcompris-web.fingertip-dwell.json');
  assertSafety(binding);
  const ports = ['sense', 'cursor', 'filter', 'interaction', 'sink'];
  const [loaded, overlayFactories] = await Promise.all([
    Promise.all(ports.map(port => loadAdapter(port, binding[port]))),
    Promise.all(binding.overlays.map(config => loadAdapter('overlays', config)))
  ]);
  if (binding.app !== 'gcompris-web') throw new Error(`Unknown app profile: ${binding.app}`);
  const app = createApp(frame, await readJson(`./profiles/${binding.app}.json`));
  let width = 1, height = 1;
  const context = {
    app, video, skin: byId('skin'), cursor: byId('cursor'),
    slider: byId('opacity'), mirrorControl: byId('mirror-control'),
    size: () => ({ width, height })
  };
  const build = ({ factory, config }) => factory(context, config);
  const [senseFactory, cursorFactory, ...parts] = loaded;
  const cursor = cursorFactory.factory(context, cursorFactory.config, binding.interaction.hand);
  const [filter, interaction, sink] = parts.map(build);
  const overlays = await Promise.all(overlayFactories.map(build));
  const stallMs = binding.safety.stallMs ?? 500;
  const minFps = binding.interaction.minFps ?? 10;

  let source, watchdog, ticker, paused = false, camera = false, lastFrame = -Infinity;
  const frameTimes = [];
  let visual = {};

  function draw(values = visual) {
    visual = values;
    for (const overlay of overlays) overlay.draw({ ...values, camera });
  }

  function resize() {
    width = Math.max(1, stage.clientWidth);
    height = Math.max(1, stage.clientHeight);
    for (const overlay of overlays) overlay.resize?.(width, height);
    draw();
  }

  function place(point) {
    const w = video.videoWidth || 640, h = video.videoHeight || 360;
    const scale = Math.max(width / w, height / h);
    return { x: .5 + (point.x - .5) * w * scale / width, y: .5 + (point.y - .5) * h * scale / height };
  }

  function send(step) {
    for (const event of step.events) {
      if (event.type === 'status') continue;
      sink.send(event.type, event);
    }
  }

  function resetInput(clearRearm = false) {
    send(interaction.reset(performance.now(), clearRearm));
    sink.release();
    filter.reset();
    frameTimes.length = 0;
    draw({});
  }

  function receive(sample) {
    if (sample.t <= lastFrame) return;
    lastFrame = sample.t;
    clearTimeout(watchdog);
    watchdog = setTimeout(() => {
      cursor.reset();
      resetInput();
      if (!paused) status.textContent = 'Waiting for frames';
    }, stallMs);

    const hand = cursor.update(sample, place);
    if (paused) return;
    frameTimes.push(sample.t);
    const fps = measuredFps(frameTimes, sample.t);
    const tip = hand?.tip;
    const inBounds = tip && [tip.x, tip.y].every(n => n >= 0 && n < 1);
    let point;
    if (inBounds) {
      point = filter.update(tip, sample.t);
      sink.send('pointermove', point);
    } else {
      filter.reset();
    }
    send(interaction.frame(sample.t, hand && { hand: hand.points, point }));
    const layer = interaction.state(sample.t);
    draw({ point, hand: hand?.points, progress: layer.cursor.progress, pressed: layer.cursor.pressed });
    const message = layer.status === 'low_fps' ? `Input too slow for dwell (${fps} fps, needs ${minFps})`
      : point ? `Hold still to click (${fps} fps)` : `Show your hand (${fps} fps)`;
    if (status.textContent !== message) status.textContent = message;
  }

  function stop(message = 'Camera off') {
    const ending = source;
    source = null;
    camera = paused = false;
    clearTimeout(watchdog);
    clearInterval(ticker);
    lastFrame = -Infinity;
    cursor.reset();
    resetInput(true);
    try { ending?.stop(); } finally {
      start.disabled = false;
      pause.disabled = kill.disabled = true;
      pause.textContent = 'Pause';
      status.textContent = message;
    }
  }

  start.onclick = async () => {
    if (source) return;
    let current;
    start.disabled = true;
    kill.disabled = false;
    status.textContent = 'Starting input...';
    const fail = error => {
      if (!current || source === current) stop(describeError(error));
    };
    try {
      current = source = build(senseFactory);
      await current.start(sample => {
        if (source === current) receive(sample);
      }, fail);
      if (source !== current) return;
      camera = !!video.srcObject;
      pause.disabled = false;
      ticker = setInterval(() => {
        if (!paused) send(interaction.tick(performance.now()));
      }, 25);
      draw();
      status.textContent = 'Show your hand';
    } catch (error) { fail(error); }
  };
  pause.onclick = () => {
    paused = !paused;
    resetInput();
    pause.textContent = paused ? 'Resume' : 'Pause';
    status.textContent = paused ? 'Input paused' : 'Show your hand';
  };
  kill.onclick = () => stop();
  addEventListener('keydown', event => { if (event.key === 'Escape' && source) stop(); });
  addEventListener('pagehide', () => { if (source) stop(); });
  document.addEventListener('visibilitychange', () => {
    if (document.hidden && source) stop();
  });

  new ResizeObserver(resize).observe(stage);
  await app.start(sink);
  appStatus.hidden = true;
  start.disabled = false;
  document.documentElement.dataset.appReady = 'true';
}

showOfflineStatus();
boot().catch(error => {
  appStatus.textContent = describeError(error);
  appStatus.dataset.error = 'true';
});
