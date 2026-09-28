// 설치용 최소 서비스워커: 같은 사이트의 GET만 네트워크로 그대로 전달 (저장 요청, 다른 사이트 요청은 건드리지 않음)
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', e => e.waitUntil(self.clients.claim()));
self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET' || new URL(e.request.url).origin !== self.location.origin) return;
  e.respondWith(fetch(e.request));
});
