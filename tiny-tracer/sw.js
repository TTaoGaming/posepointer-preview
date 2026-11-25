const scope = self.registration.scope;
const coreName = `tinytracer-v0.1-20261124:${scope}`;
const trackerName = 'tinytracer-mp-v1';
const coreFiles = [
  './',
  './judge.js',
  './favicon.svg',
  './camera-button.js',
  './camera/adapters/cursor-ring.js',
  './camera/adapters/fingertip.js',
  './camera/adapters/hand-skin.js',
  './camera/adapters/mirror.js',
  './camera/adapters/modes.js',
  './camera/adapters/one-euro.js',
  './camera/adapters/sense-external.js',
  './camera/adapters/tracer-camera.js',
  './camera/adapters/tracer-pointer.js',
  './camera/binding.json',
  './camera/clock.js',
  './camera/core/dwell-core.js',
  './camera/core/input-rules.js',
  './camera/core/pen-core.js',
  './camera/core/touch-wins.js',
  './camera/host.css',
  './camera/host.js',
];
const trackerFiles = [
  './camera/mp/runtime.js',
  './camera/mp/hand_landmarker.task',
  './camera/mp/wasm/vision_wasm_internal.js',
  './camera/mp/wasm/vision_wasm_internal.wasm'
];
const href = path => new URL(path, scope).href;
const coreUrls = new Set(coreFiles.map(href));
const trackerUrls = new Set(trackerFiles.map(href));

self.addEventListener('install', event => {
  event.waitUntil((async () => {
    const cache = await caches.open(coreName);
    await Promise.all([...coreUrls].map(async url => {
      const response = await fetch(url, { redirect: 'error' });
      if (!response.ok) throw new Error(`Offline file returned HTTP ${response.status}: ${url}`);
      await cache.put(url, response);
    }));
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', event => {
  event.waitUntil(self.clients.claim());
});

const pendingTrackerWrites = new Map();

async function getTracker(key, request) {
  const cache = await caches.open(trackerName);
  const pending = pendingTrackerWrites.get(key);
  if (pending) await pending;
  const hit = await cache.match(key);
  if (hit) return { response: hit };

  const response = await fetch(request, { redirect: 'error' });
  if (!response.ok) return { response };

  const stored = cache.put(key, response.clone());
  pendingTrackerWrites.set(key, stored);
  const finished = () => {
    if (pendingTrackerWrites.get(key) === stored) pendingTrackerWrites.delete(key);
  };
  stored.then(finished, finished);
  return { response, stored };
}

self.addEventListener('fetch', event => {
  const { request } = event;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  url.search = '';
  const key = url.href === href('./index.html') ? scope : url.href;
  if (trackerUrls.has(key)) {
    const tracker = getTracker(key, request);
    event.respondWith(tracker.then(({ response }) => response));
    event.waitUntil(tracker.then(({ stored }) => stored));
  } else if (coreUrls.has(key)) {
    event.respondWith((async () => {
      const cache = await caches.open(coreName);
      if (key === href('./camera/binding.json')) {
        try {
          return await fetch(request, { cache: 'no-cache', redirect: 'error' });
        } catch {
          // The installed binding is available during an offline start.
        }
      }
      return (await cache.match(key)) || fetch(request);
    })());
  }
});
