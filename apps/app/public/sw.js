// Minimal service worker: only enables PWA installability for now (no offline asset caching yet).
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()));
self.addEventListener('fetch', () => {
  // Intentionally pass-through (network only); offline caching is a separate future step.
});
