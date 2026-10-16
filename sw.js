/* 서비스 워커: 앱을 오프라인에서도 열리게 해주는 캐시 담당 */
const CACHE_NAME = 'sk-travel-v9';
const APP_ASSETS = [
  './',
  './index.html',
  './packing.html',
  './manifest.json',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/apple-touch-icon.png',
  './icons/favicon-32.png'
];

/* 사용자가 설정의 업데이트 버튼을 누률 때만 새 버전으로 교체 */
self.addEventListener('message', e => {
  if (e.data === 'SKIP_WAITING') self.skipWaiting();
});

self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE_NAME).then(c => c.addAll(APP_ASSETS))
  );
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;

  /* 페이지 이동: 인터넷 우선, 실패하면 캐시된 앱 열기 */
  if (req.mode === 'navigate') {
    e.respondWith(
      fetch(req)
        .then(res => {
          const copy = res.clone();
          caches.open(CACHE_NAME).then(c => c.put(req, copy));
          return res;
        })
        .catch(() => caches.match(req).then(hit => hit || caches.match('./index.html')))
    );
    return;
  }

  /* 나머지(아이콘, OCR 엔진 CDN 등): 캐시 우선 + 없으면 인터넷에서 받아 캐시에 저장 */
  e.respondWith(
    caches.match(req).then(hit => {
      if (hit) return hit;
      return fetch(req).then(res => {
        if (res.ok && (req.url.startsWith(self.location.origin) || req.url.includes('cdn.jsdelivr.net'))) {
          const copy = res.clone();
          caches.open(CACHE_NAME).then(c => c.put(req, copy));
        }
        return res;
      });
    })
  );
});
