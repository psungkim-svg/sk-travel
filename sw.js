/* SK 여행 현장 가이드 — v1.7.0
   - 홈 상단 '여행 선택' 버튼 제거, '필라델피아' 고정 라벨, 여행지 이름 라벨 통일.
   - 항공 탭 박스 배경색을 종류별로 구분(모두 흰 글자 짙은 색).
   - 가져오기 파일 선택창이 어떤 파일이든 고를 수 있게 바뀌었습니다.
   - v1.6.0
   - 백업은 '로컬 저장'으로 파일을 받는 방식만 남겼습니다.
   - CACHE 이름이 'sk-guide-1.6.0'으로 바뀌어, 이전 버전 캐시는 자동으로 지워집니다. */
const CACHE = 'sk-guide-1.7.0';
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
