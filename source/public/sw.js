// 原站的 sw.js 由构建脚本生成，写死了带 hash 的文件名。
// 这里改成运行时缓存：同源 GET 请求先走缓存，缓存没有再联网并存起来；页面导航优先联网，离线时回落到缓存的 index.html。
const CACHE_NAME = 'ocr-image-tool-v3';
self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE_NAME).then((c) => c.addAll(['/', '/index.html', '/texture.png', '/app-icon.svg'])).then(() => self.skipWaiting()));
});
self.addEventListener('activate', (e) => {
  e.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter((k) => k.startsWith('ocr-image-tool-') && k !== CACHE_NAME).map((k) => caches.delete(k)));
    await self.clients.claim();
  })());
});
self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== self.location.origin) return;
  if (req.mode === 'navigate') {
    e.respondWith(fetch(req).catch(() => caches.match('/index.html', { ignoreVary: true })));
    return;
  }
  e.respondWith(caches.open(CACHE_NAME).then(async (c) => {
    const hit = await c.match(req, { ignoreVary: true });
    if (hit) return hit;
    const res = await fetch(req);
    if (res.ok) c.put(req, res.clone());
    return res;
  }));
});
