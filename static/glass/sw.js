// 🔥 自杀 Service Worker — 清除所有缓存并注销自己
self.addEventListener('install', () => {
  self.skipWaiting();
});
self.addEventListener('activate', () => {
  // 清除所有旧缓存
  caches.keys().then(names => Promise.all(names.map(n => caches.delete(n))));
  // 注销自己
  self.registration.unregister();
  // 接管所有页面
  clients.claim();
});
// 唔拦截任何请求 — 全部直通网络
self.addEventListener('fetch', e => {
  e.respondWith(fetch(e.request));
});
