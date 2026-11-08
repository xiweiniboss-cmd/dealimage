// Generated; caches application files only.
const CACHE_NAME = 'ocr-image-tool-v9';
const ASSETS = ["/app-icon-192.png","/app-icon-512.png","/app-icon.svg","/assets/index-I5qFkFm0.js","/assets/index-vD0hKg2T.css","/assets/texture.worker-BhDJqA30.js","/index.html","/manifest.webmanifest","/texture.png"];
const STATIC_URLS = new Set(ASSETS.map((url) => new URL(url, self.location.origin).href));
self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.addAll(ASSETS)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    const oldKeys = keys.filter((key) => key.startsWith('ocr-image-tool-') && key !== CACHE_NAME);
    await Promise.all(oldKeys.map((key) => caches.delete(key)));
    await self.clients.claim();
    if (oldKeys.length) {
      const windows = await self.clients.matchAll({ type: 'window' });
      for (const client of windows) {
        if (new URL(client.url).origin === self.location.origin) {
          void client.navigate(client.url).catch((error) => console.warn('Page upgrade failed:', error));
        }
      }
    }
  })());
});
self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET' || new URL(request.url).origin !== self.location.origin) return;
  if (request.mode === 'navigate') {
    event.respondWith(fetch(request).catch(() => caches.open(CACHE_NAME).then((cache) => cache.match('/index.html', { ignoreVary: true }))));
    return;
  }
  if (STATIC_URLS.has(request.url)) {
    event.respondWith(caches.open(CACHE_NAME).then(async (cache) => {
      const cached = await cache.match(request, { ignoreVary: true });
      if (cached) return cached;
      const response = await fetch(request);
      if (response.ok) await cache.put(request, response.clone());
      return response;
    }));
  }
});
