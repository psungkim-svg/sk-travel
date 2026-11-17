/* v0.2.5
   - 아이콘 경로를 실제 파일 위치(icons/)와 맞춰 오프라인 설치 실패를 고쳤습니다.
   - addAll은 하나라도 404면 전체 설치가 실패하므로 파일별로 캐시합니다.
   - version.json?now=... 같은 매 요청마다 달라지는 URL은 캐시하지 않습니다. */
const CACHE = 'sk-guide-0.3.0';
const ASSETS = [
  './',
  './index.html',
  './app.js',
  './packing.html',
  './schedule-seed.html',
  './schedule-day-source.json',
  './spain-trip-data.json',
  './manifest.json',
  './version.json',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/icon-maskable-192.png',
  './icons/icon-maskable-512.png',
  './icons/favicon-32.png',
  './icons/apple-touch-icon.png'
];

/* 새 버전 알림 배너에서 "새로고침"을 누르면 대기 중인 SW를 바로 활성화합니다. */
self.addEventListener('message', e => {
  if (e.data?.type === 'SKIP_WAITING') self.skipWaiting()
});

self.addEventListener('install', e => e.waitUntil(
  caches.open(CACHE)
    .then(c => Promise.all(ASSETS.map(u => c.add(new Request(u, { cache: 'reload' })).catch(() => null))))
    .then(() => self.skipWaiting())
));

self.addEventListener('activate', e => e.waitUntil(
  caches.keys()
    .then(keys => Promise.all(keys.filter(k => k.startsWith('sk-guide-') && k !== CACHE).map(k => caches.delete(k))))
    .then(() => self.clients.claim())
));

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== location.origin) return;
  // 버전 확인용 쿼리스트링 요청은 네트워크만 사용(캐시가 무한히 쌓이는 문제 방지)
  if (url.pathname.endsWith('/version.json')) return;
  e.respondWith(
    fetch(req).then(r => {
      if (r && r.ok) {
        const copy = r.clone();
        e.waitUntil(caches.open(CACHE).then(c => c.put(req, copy)).catch(() => {}));
      }
      return r
    }).catch(() => caches.match(req, { ignoreSearch: true }).then(hit => hit || caches.match('./index.html')))
  );
});
