// Hermes Glass — PWA Service Worker
const CACHE = 'hermes-glass-v1';
const ASSETS = [
  '/static/native/index.html',
  '/static/native/src/app.js',
  '/static/native/src/api.js',
  '/static/native/src/sse.js',
  '/static/native/src/voice.js',
  '/static/native/src/i18n.js',
  '/static/native/src/acui/renderer.js',
  '/static/native/src/acui/animations.css',
  '/static/native/styles/theme.css',
  '/static/native/styles/layout.css',
  '/static/native/styles/animations.css',
];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(ASSETS)));
});

self.addEventListener('fetch', e => {
  e.respondWith(
    caches.match(e.request).then(r => r || fetch(e.request))
  );
});
