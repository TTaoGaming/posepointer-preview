const byId = id => document.getElementById(id);
const button = byId('start-camera');
const status = byId('camera-status');
const load = byId('camera-load');
const progress = byId('cam-progress');
const byteLabel = byId('camera-bytes');
const serviceWorkers = navigator.serviceWorker;
const registration = new Promise((resolve, reject) => {
  function register() {
    if (serviceWorkers && location.protocol.startsWith('http')) {
      navigator.serviceWorker.register('./sw.js', { scope: './' }).then(resolve, reject);
    } else {
      reject(new Error('Camera download requires a service worker on HTTPS or localhost.'));
    }
  }
  // Defer precaching until the tracer is usable.
  if (document.readyState === 'complete') register();
  else window.addEventListener('load', register, { once: true });
});
registration.catch(() => {});
let active;

function setStatus(text) {
  if (status.textContent !== text) status.textContent = text;
}

function reportProgress(bytes, total) {
  load.hidden = false;
  progress.max = total;
  progress.value = bytes;
  const message = `${(bytes / 1e6).toFixed(1)} MB of ${(total / 1e6).toFixed(1)} MB`;
  if (byteLabel.textContent !== message) byteLabel.textContent = message;
}

async function waitForOwnWorker(signal) {
  const worker = await registration;
  signal.throwIfAborted();
  const script = new URL('./sw.js', worker.scope).href;
  const installing = worker.installing ?? worker.waiting ?? worker.active;
  await new Promise((resolve, reject) => {
    const listeners = new AbortController();
    function finish(error) {
      listeners.abort();
      if (error) reject(error);
      else resolve();
    }
    function inspect() {
      const current = serviceWorkers.controller;
      if (current?.scriptURL === script && current.state === 'activated') finish();
      else if (!installing || installing.state === 'redundant') finish(new Error('Tracer service worker did not activate.'));
    }
    serviceWorkers.addEventListener('controllerchange', inspect, { signal: listeners.signal });
    installing?.addEventListener('statechange', inspect, { signal: listeners.signal });
    signal.addEventListener('abort', () => finish(signal.reason), { once: true, signal: listeners.signal });
    inspect();
  });
}

function stopCamera(message = '') {
  const ending = active;
  active = undefined;
  ending?.abort();
  load.hidden = true;
  button.disabled = false;
  button.textContent = 'Start camera';
  setStatus(message);
}

button.addEventListener('click', async () => {
  if (active) {
    stopCamera('Camera off');
    return;
  }

  const session = active = new AbortController();
  const { signal } = session;
  button.disabled = true;
  setStatus('Preparing camera download');
  const onError = error => {
    if (active === session) stopCamera(error instanceof Error ? error.message : String(error));
  };

  try {
    await waitForOwnWorker(signal);
    const { startCamera } = await import('./camera/host.js');
    signal.throwIfAborted();
    await startCamera({ signal, onProgress: reportProgress, onStatus: setStatus, onError });
    signal.throwIfAborted();
    button.textContent = 'Stop camera';
    button.disabled = false;
  } catch (error) {
    onError(error);
  }
});

window.addEventListener('keydown', event => {
  if (event.key === 'Escape' && active) stopCamera('Camera off');
});
window.addEventListener('pagehide', () => { if (active) stopCamera(); });
document.addEventListener('visibilitychange', () => {
  if (document.hidden && active) stopCamera('Camera off');
});
