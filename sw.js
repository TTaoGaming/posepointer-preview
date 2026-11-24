// Copyright Tao. All rights reserved.
const scope = self.registration.scope;
const cachePrefix = `posepointer:${scope}:`;
const manifestUrl = new URL('asset-manifest.json', scope);

async function fetchLocal(resource) {
  const url = new URL(resource.url ?? resource);
  if (url.origin !== self.location.origin) return Response.error();
  return fetch(resource, { cache: 'no-store', redirect: 'error' });
}

async function install() {
  const response = await fetchLocal(manifestUrl);
  if (!response.ok) throw new Error('Offline manifest unavailable.');
  const manifest = await response.clone().json();
  const name = cachePrefix + manifest.version;
  const cache = await caches.open(name);
  try {
    for (const { path } of manifest.files) {
      const url = new URL(path.split('/').map(encodeURIComponent).join('/'), scope);
      const asset = await fetchLocal(url);
      if (!asset.ok) throw new Error(`Offline download failed for ${path}.`);
      await cache.put(url, asset);
    }
    await cache.put(manifestUrl, response);
  } catch (error) {
    await caches.delete(name);
    throw error;
  }
  await self.skipWaiting();
}

self.addEventListener('install', event => event.waitUntil(install()));

async function activate() {
  const names = (await caches.keys()).filter(name => name.startsWith(cachePrefix));
  const current = names.pop();
  await Promise.all(names.map(name => caches.delete(name)));
  if (current) await self.clients.claim();
}

self.addEventListener('activate', event => event.waitUntil(activate()));

async function respond(request, url) {
  if (request.method === 'GET' || request.method === 'HEAD') {
    if (url.pathname.endsWith('/')) url.pathname += 'index.html';
    const names = (await caches.keys()).filter(name => name.startsWith(cachePrefix));
    // CacheStorage keeps insertion order. During an update the active cache is
    // first until the new worker activates and deletes previous versions.
    const cacheName = names[0];
    const hit = cacheName && await caches.match(url, { ignoreSearch: true, ignoreMethod: true, cacheName });
    if (hit) {
      return request.method === 'HEAD'
        ? new Response(null, { status: hit.status, statusText: hit.statusText, headers: hit.headers })
        : hit;
    }
  }
  return fetchLocal(request);
}

self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);
  event.respondWith(url.origin !== self.location.origin ? Response.error() : respond(event.request, url));
});
