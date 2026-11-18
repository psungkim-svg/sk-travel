/* v1.3.0
   - 「드라이브 저장」이 누르면 공유창이 뜨도록 ①파일(text/plain) ②파일(octet-stream) ③텍스트 순서로 재시도합니다.
   - 준비물 체크리스트 버튼 높이를 34px로 얇게 했습니다.
   - v1.2.0
   - '로컬 저장'이 아무 반응 없이 죽던 버그를 고쳤습니다(사라졌던 download()를 복원).
   - 준비물 체크리스트 글자를 키우고, 버튼은 '전체 접기/전체 초기화/백업 저장/백업 불러오기' 한 줄로 정리했습니다.
   - '전체 열기' 버튼을 없앴습니다.
   - 앱 전체 기본 글자를 홈 '원본 일정' 글자 크기(18px)로 통일했습니다.
   - 버튼 이름이 '드라이브 저장' / '로컬 저장'으로 바뀌었습니다.
   - v1.1.0
   - 홈 현장 가이드를 문장체에서 번호/칩/토글 카드로 재구성했습니다.
   - Google Drive 내보내기가 NotAllowedError로 실패하던 문제를 고쳤습니다.
     버튼을 누른 그 자리에서 바로 share()를 호출하도록 '미리 만들고 즉시 공유' 방식으로 바꿨습니다.
   - '로컬 저장'(구 '기기에 파일로 저장')이 아무 반응 없이 죽던 버그를 고쳤습니다(사라졌던 download()를 복원).
   - 준비물 체크리스트 글자를 키우고, 버튼은 '전체 접기/전체 초기화/백업 저장/백업 불러오기' 한 줄로 정리했습니다.
     앱 전체 기본 글자를 홈 '원본 일정' 글자 크기(18px)로 통일했습니다.
   - v1.0.0
   - Google 드라이브 내보내기를 원터치 공유창 방식으로 고치고, 사진 포함/제외를 선택할 수 있게 했습니다.
   - 아이콘 파일을 icons/ 폴더에 실제로 맞췄습니다.
   - v0.2.5
   - 아이콘 경로를 실제 파일 위치(icons/)와 맞춰 오프라인 설치 실패를 고쳤습니다.
   - addAll은 하나라도 404면 전체 설치가 실패하므로 파일별로 캐시합니다.
   - version.json?now=... 같은 매 요청마다 달라지는 URL은 캐시하지 않습니다. */
const CACHE = 'sk-guide-1.3.0';
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
