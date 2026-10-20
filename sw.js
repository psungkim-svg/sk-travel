/* SK-여행 v3 서비스 워커 — 앱 셸만 캐시하고, 여행 개인정보/외부 API 응답은 캐시하지 않습니다. */
const CACHE_NAME = 'sk-travel-v3-9';
const APP_ASSETS = [
  './',
  './index.html',
  './packing.html',
  './schedule-seed.html',
  './spain-trip-data.json',
  './manifest.json',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/apple-touch-icon.png',
  './icons/favicon-32.png'
];

self.addEventListener('message', e => {
  if (e.data === 'SKIP_WAITING') self.skipWaiting();
});

self.addEventListener('install', e => {
  e.waitUntil((async () => {
    const cache = await caches.open(CACHE_NAME);
    // 하나가 404여도 전체 설치가 실패하지 않게 개별 저장합니다.
    await Promise.allSettled(APP_ASSETS.map(url => cache.add(url)));
  })());
});

self.addEventListener('activate', e => {
  e.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k)));
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);

  // 날씨/환율/Google 로그인과 Drive는 항상 네트워크로만 처리합니다.
  if (url.origin !== self.location.origin) {
    if (url.hostname === 'cdn.jsdelivr.net') {
      e.respondWith(
        caches.match(req).then(hit => hit || fetch(req).then(res => {
          if (res.ok) {
            const copy = res.clone();
            e.waitUntil(caches.open(CACHE_NAME).then(c => c.put(req, copy)));
          }
          return res;
        }))
      );
    }
    return;
  }

  // 버전 확인 파일은 절대 캐시하지 않고 항상 서버에서 새로 확인합니다.
  if (url.pathname.endsWith('/version.json')) {
    e.respondWith(fetch(req.url, { cache: 'no-store' }));
    return;
  }

  // 페이지 이동: 인터넷 우선, 성공 응답만 캐시에 보관하고 실패하면 캐시 사용
  if (req.mode === 'navigate') {
    e.respondWith((async () => {
      try {
        const res = await fetch(req);
        if (res.ok) {
          const copy = res.clone();
          e.waitUntil(caches.open(CACHE_NAME).then(c => c.put(req, copy)));
        }
        return res;
      } catch (_) {
        return (await caches.match(req)) || (await caches.match('./index.html')) || Response.error();
      }
    })());
    return;
  }

  // 같은 origin의 정적 파일: 캐시를 먼저 보여주고 뒤에서 갱신
  e.respondWith((async () => {
    const hit = await caches.match(req);
    const refresh = fetch(req).then(res => {
      if (res.ok) {
        const copy = res.clone();
        e.waitUntil(caches.open(CACHE_NAME).then(c => c.put(req, copy)));
      }
      return res;
    }).catch(() => null);
    return hit || (await refresh) || Response.error();
  })());
});
