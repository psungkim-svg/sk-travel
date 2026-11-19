# SK 여행 현장 가이드

어떤 여행이든 일정을 JSON으로 가져오면 동작하는 **개인용 오프라인 여행 PWA**입니다.
Galaxy S24 Chrome 기준으로 최적화되어 있고, 홈 화면에 설치해서 앱처럼 쓸 수 있습니다.

현재 포함된 데이터는 2026-10-22 ~ 10-31 스페인·포르투갈 9박 10일(필라하나관광) 실제 일정입니다.

## GitHub Pages로 배포하기
1. 이 폴더를 새 GitHub 저장소에 업로드 (웹 업로드 또는 `git push`)
2. Settings → Pages → "Deploy from a branch" → `main` / `root` 선택 → Save
3. 발급된 `https://<user>.github.io/<repo>/` 주소를 Android Chrome에서 열기
4. Chrome 메뉴 ⋮ → "앱 설치" (또는 ⋮ → "홈 화면에 추가")
5. 이후에는 오프라인에서도 동작합니다 (service worker 캐시)

## 버전 올리기
```
./release.sh 1.0.1
```
`version.json`, `app.js`, `index.html`, `sw.js` 4곳의 버전을 한 번에 올립니다.

## 구조
- `index.html` — 앱 셸 (탭: 홈/일정/항공/준비물/관리)
- `app.js` — 앱 로직 (시드, 날씨, GPS, 백업/복원, 볼트)
- `packing.html` — 준비물 체크리스트 (메인 앱과 완전 독립, 자체 백업/복원)
- `schedule-seed.html` / `schedule-day-source.json` — 원본 안내문 아코디언
- `spain-trip-data.json` — 스페인 여행 시드 (새 여행은 관리 → 가져오기로 추가)
- `icons/` — PWA 아이콘
- `변경내역.md` — 버전별 변경 사항

## 알아둘 것
- 백업 파일은 **암호화되지 않습니다**. 예약번호가 든 백업 파일은 본인만 접근할 수 있는 위치에 보관하세요.
- `guide.json`, `d03-02_1.jpg`는 AI 가이드 ZIP 가져오기 **테스트 픽스처**입니다.
- 개인 예약정보는 「관리 → 개인 예약정보」에서 **「암호 걸어 저장」**을 눌러야 암호화됩니다.
