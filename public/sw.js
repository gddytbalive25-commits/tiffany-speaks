const CACHE_NAME = 'tiffany-speaks-shell-v1';
const APP_SHELL = [
  '/',
  '/index.html',
  '/manifest.webmanifest',
  '/brand-mark.svg',
  '/icon-192.png',
  '/icon-512.png',
  '/images/tiffany-avatar.jpg',
  '/assets/app.js',
  '/assets/app.css',
];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.addAll(APP_SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((key) => key.startsWith('tiffany-speaks-') && key !== CACHE_NAME).map((key) => caches.delete(key)))).then(() => self.clients.claim()));
});

self.addEventListener('fetch', (event) => {
  const request = event.request;
  const url = new URL(request.url);
  if (request.method !== 'GET' || url.origin !== self.location.origin || url.pathname.startsWith('/api/')) return;
  event.respondWith((async () => {
    const cache = await caches.open(CACHE_NAME);
    const cached = await cache.match(request);
    if (cached) return cached;
    try {
      const response = await fetch(request);
      if (response.ok && (url.pathname.startsWith('/assets/') || url.pathname.startsWith('/images/'))) await cache.put(request, response.clone());
      return response;
    } catch {
      if (request.mode === 'navigate') return (await cache.match('/')) || Response.error();
      return cached || Response.error();
    }
  })());
});
