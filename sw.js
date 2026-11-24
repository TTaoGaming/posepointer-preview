// Copyright Tao. All rights reserved.
const scope = self.registration.scope;
const cachePrefix = `${scope}posepointer-`;
const legacyPrefix = `posepointer:${scope}:`;
const isOwnCache = name => name.startsWith(cachePrefix) || name.startsWith(legacyPrefix);
const manifestUrl = new URL('asset-manifest.json', scope);
const indexFile = 'index.html';
const pageSuffix = indexFile.slice(indexFile.indexOf('.'));
const matchOptions = { ignoreSearch: true, ignoreMethod: true };
let installedCache;

async function fetchLocal(url, options = {}) {
  if (url.origin !== self.location.origin) return Response.error();
  return fetch(url, { ...options, redirect: 'error' });
}

async function fetchAsset(url) {
  const options = { cache: 'no-store' };
  if (!url.pathname.endsWith(pageSuffix)) return fetchLocal(url, options);
  // Some static hosts redirect HTML files to extensionless routes. Probe
  // without following redirects, then try the same-origin canonical route.
  const response = await fetch(url, { ...options, redirect: 'manual' });
  if (response.type !== 'opaqueredirect') return response;
  const canonical = new URL(url);
  canonical.pathname = canonical.pathname.endsWith(`/${indexFile}`)
    ? canonical.pathname.slice(0, -indexFile.length)
    : canonical.pathname.slice(0, -pageSuffix.length);
  return fetchLocal(canonical, options);
}

self.addEventListener('install', event => {
  event.waitUntil((async () => {
    const response = await fetchLocal(manifestUrl, { cache: 'no-store' });
    if (!response.ok) throw new Error(`Offline manifest returned HTTP ${response.status}`);
    const manifest = await response.clone().json();
    const cache = await caches.open(`${cachePrefix}${manifest.version}`);
    const pending = manifest.files.map(({ path }) => {
      const url = new URL(path, scope);
      if (!url.href.startsWith(scope)) throw new Error(`Offline path outside site: ${path}`);
      return url;
    });
    await cache.put(manifestUrl, response);
    async function saveFiles() {
      for (let url = pending.pop(); url; url = pending.pop()) {
        if (await cache.match(url)) continue;
        const file = await fetchAsset(url);
        if (!file.ok) throw new Error(`Offline file ${url.pathname} returned HTTP ${file.status}`);
        await cache.put(url, file);
      }
    }
    await Promise.all(Array.from({ length: 4 }, saveFiles));
    installedCache = `${cachePrefix}${manifest.version}`;
    await self.skipWaiting();
  })());
});

async function currentCacheName() {
  if (installedCache) return installedCache;
  // The worker may restart. Cache names are listed in creation order.
  const names = (await caches.keys()).filter(name => name.startsWith(cachePrefix)).reverse();
  for (const name of names) {
    const cache = await caches.open(name);
    const response = await cache.match(manifestUrl);
    if (!response) continue;
    try {
      const manifest = await response.json();
      if (!Array.isArray(manifest?.files)) continue;
      const saved = new Set((await cache.keys()).map(request => request.url));
      if (manifest.files.every(file =>
        typeof file?.path === 'string' && saved.has(new URL(file.path, scope).href))) {
        installedCache = name;
        return name;
      }
    } catch {
      // An unreadable manifest cannot establish that this cache is complete.
    }
  }
}

async function fromCache(key) {
  const name = await currentCacheName();
  if (name) return (await caches.open(name)).match(key, matchOptions);
}

self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    const current = await currentCacheName();
    const names = (await caches.keys()).filter(isOwnCache);
    await Promise.all(names.filter(name => name !== current).map(name => caches.delete(name)));
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);
  if (url.origin !== self.location.origin) {
    event.respondWith(Response.error());
    return;
  }
  const { method } = event.request;
  if (method !== 'GET' && method !== 'HEAD') return;
  event.respondWith((async () => {
    const key = new URL(url);
    if (key.pathname.endsWith('/')) key.pathname += indexFile;
    const file = await fromCache(key);
    if (file) {
      if (method === 'HEAD') {
        return new Response(null, { status: file.status, statusText: file.statusText, headers: file.headers });
      }
      return file;
    }
    if (event.request.mode === 'navigate' && !url.pathname.endsWith('/')) {
      key.pathname += `/${indexFile}`;
      if (await fromCache(key)) {
        url.pathname += '/';
        return Response.redirect(url.href);
      }
      key.pathname = url.pathname + pageSuffix;
      const page = await fromCache(key);
      if (page) return page;
    }
    return fetch(event.request, { redirect: 'error' });
  })());
});
// build 89d5f4196dbc8eee84efee3e803162e4b434be44116ae7244c7e83f0de2ece92
