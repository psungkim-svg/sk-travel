'use strict';
const KEY = 'sk-guide-v1',
  safe = x => String(x ?? '').replace(/[&<>"']/g, c => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;'
  } [c]));
const id = () => crypto.randomUUID ? crypto.randomUUID() : 'id-' + Date.now() + '-' + Math.random().toString(36).slice(2);
/* structuredClone은 iOS Safari 15.4+ 에서만 지원 → 구형 기기에서도 저장이 실패하지 않도록 폴백 */
function clone(x) {
  try {
    return typeof structuredClone === 'function' ? structuredClone(x) : JSON.parse(JSON.stringify(x))
  } catch {
    return JSON.parse(JSON.stringify(x))
  }
}
const $ = s => document.querySelector(s);
let tab = 'home',
  viewId = null,
  previewAt = 0,
  rehearsal = null,
  weather = null,
  weatherKey = '',
  geo = null,
  editing = null,
  pending = null;
let db = {
  active: null,
  trips: []
};
let weatherDays = [],
  weatherFetchedAt = 0,
  weatherBusy = false,
  geoState = 'idle',
  geoMessage = '위치 확인 전',
  geoAddress = '',
  geoAddressAt = 0,
  seedDaySource = [];
try {
  db = JSON.parse(localStorage.getItem(KEY)) || db;
  if (!Array.isArray(db.trips)) throw 0
} catch {
  db = {
    active: null,
    trips: []
  }
};

const PhotoDB = {
  db: null,
  init() {
    return new Promise((resolve, reject) => {
      let req = indexedDB.open('sk-photos', 1);
      req.onupgradeneeded = e => {
        let db = e.target.result;
        if (!db.objectStoreNames.contains('photos')) {
          db.createObjectStore('photos');
        }
      };
      req.onsuccess = e => {
        this.db = e.target.result;
        resolve();
      };
      req.onerror = e => reject(e);
    });
  },
  async get(id) {
    if (!this.db) await this.init();
    return new Promise((resolve, reject) => {
      let req = this.db.transaction('photos', 'readonly').objectStore('photos').get(id);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  },
  async set(id, dataUrl) {
    if (!this.db) await this.init();
    return new Promise((resolve, reject) => {
      let req = this.db.transaction('photos', 'readwrite').objectStore('photos').put(dataUrl, id);
      req.onsuccess = () => resolve();
      req.onerror = () => reject(req.error);
    });
  },
  async remove(id) {
    if (!this.db) await this.init();
    return new Promise((resolve, reject) => {
      let req = this.db.transaction('photos', 'readwrite').objectStore('photos').delete(id);
      req.onsuccess = () => resolve();
      req.onerror = () => reject(req.error);
    });
  }
};

/* ===== Galaxy S24 편의 기능 (v0.2.6) ===== */
function haptic(ms = 8) {
  try {
    navigator.vibrate?.(ms)
  } catch {}
}

let wakeLock = null,
  wakeWanted = false,
  installPrompt = null,
  storagePersisted = null;

async function acquireWake() {
  if (!wakeWanted || !('wakeLock' in navigator) || document.visibilityState !== 'visible') return;
  try {
    wakeLock = await navigator.wakeLock.request('screen');
    wakeLock.addEventListener('release', () => {
      wakeLock = null
    })
  } catch {}
}

async function toggleWake() {
  if (!('wakeLock' in navigator)) return alert('이 브라우저는 화면 켜짐 유지를 지원하지 않습니다. (크롬 안드로이드에서 사용하세요)');
  wakeWanted = !wakeWanted;
  try {
    localStorage.setItem('sk-wake', wakeWanted ? '1' : '0')
  } catch {}
  if (wakeWanted) {
    await acquireWake();
    if (!wakeLock) {
      wakeWanted = false;
      alert('화면 켜짐 유지를 시작하지 못했습니다. 배터리 절약 모드에서는 제한될 수 있습니다.')
    }
  } else if (wakeLock) {
    try {
      await wakeLock.release()
    } catch {}
    wakeLock = null
  }
  haptic(12);
  render()
}

async function checkStorage() {
  try {
    storagePersisted = await navigator.storage?.persisted?.() ?? null
  } catch {
    storagePersisted = null
  }
}

async function requestPersist() {
  try {
    if (await navigator.storage?.persisted?.()) {
      storagePersisted = true;
      return alert('이미 영구 저장이 켜져 있습니다.')
    }
    storagePersisted = await navigator.storage?.persist?.() ?? false;
    haptic(12);
    alert(storagePersisted ? '영구 저장을 켰습니다. 브라우저가 저장 공간을 비울 가능성이 줄어듭니다.' : '영구 저장이 허용되지 않았습니다. 백업 파일을 정기적으로 저장해 주세요.')
  } catch {
    alert('이 브라우저는 영구 저장 요청을 지원하지 않습니다.')
  }
  render()
}

function promptInstall() {
  if (!installPrompt) return alert('이미 홈 화면에 추가되었거나, 크롬 메뉴 ⋮ → "앱 설치 / 홈 화면에 추가"를 이용해 주세요.');
  installPrompt.prompt();
  installPrompt.userChoice?.then(() => {
    installPrompt = null;
    render()
  })
}

function persist() {
  try {
    localStorage.setItem(KEY, JSON.stringify(db));
    return true
  } catch (e) {
    alert('저장 공간이 부족하거나 차단되었습니다. 사진 크기를 줄이거나 백업하세요.');
    return false
  }
}

function trip() {
  return db.trips.find(t => t.id === db.active)
}

function all(t = trip()) {
  return (t?.days || []).flatMap(d => (d.events || []).map(e => ({
    d,
    e
  }))).sort((a, b) => (a.d.date + 'T' + (a.e.time || '00:00')).localeCompare(b.d.date + 'T' + (b.e.time || '00:00')))
}

function now() {
  return rehearsal ? new Date(rehearsal) : new Date()
}

function fmt(date, tz, opts = {}) {
  try {
    return new Intl.DateTimeFormat('ko-KR', {
      timeZone: tz || 'America/New_York',
      ...opts
    }).format(date)
  } catch {
    return '시간대 확인 필요'
  }
}

function today(tz) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: tz || 'America/New_York',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).format(now())
}

function clock(tz) {
  return fmt(now(), tz, {
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23'
  })
}

function displayClock(tz) {
  return fmt(now(), tz, {
    hour: 'numeric',
    minute: '2-digit',
    hour12: true
  })
}

/* v0.2.5: 일자별 시간대. 예전에는 여행 전체를 trip.tz 하나로 계산해서
   출발일(필라델피아)과 리스본 구간에서 '현재 일정'이 어긋났습니다. */
function tzParts(tz, date) {
  try {
    let p = new Intl.DateTimeFormat('en-US', {
      timeZone: tz || 'America/New_York',
      hour12: false,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit'
    }).formatToParts(date).reduce((o, x) => (o[x.type] = x.value, o), {});
    return {
      y: +p.year,
      mo: +p.month,
      d: +p.day,
      h: +p.hour % 24,
      mi: +p.minute
    }
  } catch {
    return null
  }
}

function wallToInstant(dateStr, timeStr, tz) {
  let md = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(dateStr || ''));
  if (!md) return null;
  let tv = /^(\d{1,2}):(\d{2})/.exec(String(timeStr || '')),
    y = +md[1],
    mo = +md[2],
    d = +md[3],
    h = tv ? +tv[1] : 0,
    mi = tv ? +tv[2] : 0,
    target = Date.UTC(y, mo - 1, d, h, mi),
    utc = target;
  for (let k = 0; k < 3; k++) {
    let pr = tzParts(tz, new Date(utc));
    if (!pr) return target;
    let delta = target - Date.UTC(pr.y, pr.mo - 1, pr.d, pr.h, pr.mi);
    if (!delta) break;
    utc += delta
  }
  return utc
}

function dayTz(d, t = trip()) {
  return d?.tz || t?.tz || 'America/New_York'
}

function eventInstant(d, e, t = trip()) {
  return wallToInstant(d?.date, e?.time || '00:00', dayTz(d, t))
}

function currentIndex() {
  let a = all(),
    t = trip();
  if (!a.length) return -1;
  let nowMs = now().getTime(),
    ix = -1;
  for (let i = 0; i < a.length; i++) {
    let ms = eventInstant(a[i].d, a[i].e, t);
    if (ms != null && ms <= nowMs) ix = i
  }
  return Math.max(0, ix)
}

function activeDay() {
  let a = all(),
    i = selectedIndex();
  return a[i]?.d || null
}

function selectedEvent() {
  let a = all(),
    i = selectedIndex();
  return a[i]?.e || null
}

function destTz() {
  return selectedEvent()?.tz || dayTz(activeDay(), trip())
}

const HOME_TZ_LABEL = {
  'America/New_York': '필라델피아'
};

function destCityName() {
  let d = activeDay(),
    e = selectedEvent();
  if (e?.tz && HOME_TZ_LABEL[e.tz]) return HOME_TZ_LABEL[e.tz];
  let origTz = d?.origTz || d?.tz || '';
  if (e?.city && e.tz && origTz && e.tz !== origTz) return e.city;
  return d?.city || trip()?.city || '여행지'
}

/* 날씨·시계는 '지금 일정이 있는 도시' 기준. 일자에 좌표가 없으면 여행 대표 좌표를 씁니다. */
function weatherPoint(t = trip()) {
  let d = activeDay(),
    e = selectedEvent();
  return {
    lat: d?.lat || t?.lat || '',
    lon: d?.lon || t?.lon || '',
    tz: e?.tz || dayTz(d, t),
    label: destCityName()
  }
}

function selectedIndex() {
  let a = all();
  if (!a.length) return -1;
  if (viewId && Date.now() - previewAt < 10 * 60 * 1000) {
    let i = a.findIndex(x => x.e.id === viewId);
    if (i >= 0) return i
  }
  viewId = null;
  return currentIndex()
}

function move(n) {
  let a = all(),
    i = selectedIndex();
  if (i < 0) return;
  viewId = a[Math.max(0, Math.min(a.length - 1, i + n))].e.id;
  previewAt = Date.now();
  render()
}

function reset() {
  viewId = null;
  render()
}

const TABS = ['home', 'schedule', 'flight', 'packing', 'manage'];

function syncHistory() {
  try {
    history.replaceState({
      tab
    }, '', location.pathname + location.search + '#' + tab)
  } catch {}
}

function go(next) {
  if (!TABS.includes(next)) next = 'home';
  if (tab !== next) {
    history.pushState({
      tab: next
    }, '', location.pathname + location.search + '#' + next);
    tab = next;
    haptic(8)
  }
  render()
}

/* 안드로이드 뒤로가기: 모달이 열려 있으면 모달만 닫고, 탭 기록이 없으면 지금 탭을 유지합니다. */
window.addEventListener('popstate', e => {
  let hadModal = !$('#modal').classList.contains('hidden');
  if (hadModal) closeModal(false);
  let st = e.state?.tab;
  if (st && TABS.includes(st)) tab = st;
  else if (!st && hadModal) { /* 모달만 닫힘 → 탭 유지 */ }
  render()
});

function render() {
  let t = trip();
  /* tripTop(홈 상단 '여행 선택' 버튼)은 v1.7.0에서 제거되었습니다. */
  $('#tabs').innerHTML = ['홈', '일정', '항공', '준비물', '관리'].map((x, i) => `<button class="${tab===['home','schedule','flight','packing','manage'][i]?'on':''}" aria-current="${tab===['home','schedule','flight','packing','manage'][i]?'page':'false'}" onclick="go('${['home','schedule','flight','packing','manage'][i]}')">${x}</button>`).join('');
  $('#app').innerHTML = ({
    home: home,
    schedule: schedule,
    flight: flight,
    packing: packing,
    manage: manage
  } [tab])();
  applyTypography();
  if (tab === 'home') {
    updateClocks();
    setTimeout(loadPhotosFromDOM, 0);
    if (geoState === 'idle') setTimeout(autoGeo, 200)
  }
  if (tab === 'schedule') syncSchedule();
}
/* 스페인 시드(2026-10) 전용 표시는 seedRef로만 판단합니다. (예전: 이름+날짜 하드코딩) */
function isSeedTrip(t = trip()) {
  return t?.seedRef === 'spain-2026-10' || (!t?.seedRef && t?.start === '2026-10-22' && String(t?.name || '').includes('스페인'))
}

const DAY_COLORS = ['#5f3dc4', '#e8590c', '#d6336c', '#1c7ed6', '#7048e8', '#0ca678', '#2f9e44', '#1098ad', '#ae3ec9', '#3b5bdb'];

function dayOriginalDetail(t, date) {
  if (!isSeedTrip(t)) return '';
  let index = seedDaySource.findIndex(x => {
    let m = x.d?.split('/').map(Number);
    return m && date.endsWith('-' + String(m[0]).padStart(2, '0') + '-' + String(m[1]).padStart(2, '0'))
  });
  if (index < 0) return '';
  let d = seedDaySource[index],
    color = DAY_COLORS[index % DAY_COLORS.length];
  return '<section class="source-day" style="--source-color:' + color + '"><h2>원본 일정:· ' + safe(date) + '</h2><div class="source-day-heading">' + safe(d.t) + '</div><ul>' + d.i.map(x => '<li>' + safe(x) + '</li>').join('') + '</ul>' + (d.m?.length ? '<div class="source-meals">' + d.m.map((v, i) => '<span class="meal-' + i + '">' + safe(v) + '</span>').join('') + '</div>' : '') + (d.h ? '<div class="source-hotel">🏨 ' + safe(d.h.n) + ' · ' + safe(d.h.p) + '</div>' : '') + (d.c?.length ? '<div class="source-warning">⚠️ 확인 필요 · ' + d.c.map(safe).join(' / ') + '</div>' : '') + (d.w?.length ? '<div class="source-note">다른 안내 내용 · ' + d.w.map(safe).join(' / ') + '</div>' : '') + '</section>'
}

function eventOriginalDetail(a, i) {
  let {
    d,
    e
  } = a[i], t = trip(), day = dayOriginalDetail(t, d.date), extra = (e.note ? '<div>일정 내용 · ' + safe(e.note) + '</div>' : '') + (e.sourceDetail ? '<div class="source-brief">' + safe(e.sourceDetail) + '</div>' : '') + (e.transfer ? '<div>이동 · ' + safe(e.transfer) + '</div>' : '') + (e.flight ? '<div>항공 · ' + safe(e.flight) + '</div>' : '') + (e.airport ? '<div>공항 · ' + safe(e.airport) + '</div>' : '') + (e.hotel ? '<div>숙소 · ' + safe(formatHotel(e.hotel)) + '</div>' : '') + (e.ticket ? '<div>티켓 · ' + safe(e.ticket) + '</div>' : '') + (d.meals?.length ? '<div>식사 · ' + safe(d.meals.join(' / ')) + '</div>' : '') + (d.hotel?.name ? '<div>숙소 · ' + safe(d.hotel.name + (d.hotel.address ? ' · ' + d.hotel.address : '')) + '</div>' : '') + (d.alerts?.length ? '<div class="warning">⚠️ ' + safe(d.alerts.join(' / ')) + '</div>' : '') + (d.notes?.length ? '<div>' + safe(d.notes.join(' / ')) + '</div>' : '');
  return '<section class="home-original">' + (day || '<section class="source-day"><h2>원본 일정:· ' + safe(d.date) + '</h2></section>') + (extra ? '<div class="source-event"><b>선택한 일정 · ' + safe(e.time || '시간 미정') + ' ' + safe(e.title) + '</b>' + (e.place ? '<div>장소 · ' + safe(e.place) + '</div>' : '') + extra + '</div>' : '') + '</section>'
}

function wxTodayCell() {
  let d = todayWeather(destTz());
  if (!d) return '확인 중';
  let info = wxInfo(d.code);
  return info[0] + ' ' + shortWxLabel(info[1]) + ' ' + fmtTempRange(d)
}

function wxTodayPop() {
  let d = todayWeather(destTz());
  return d && d.pop != null ? '💧' + Math.round(d.pop) + '%' : ''
}

function home() {
  let t = trip(),
    a = all(),
    i = selectedIndex(),
    e = a[i]?.e,
    g = t?.guides?.[e?.id] || {},
    next = a[i + 1];
  let tripState = '';
  if (t?.start && t?.end) {
    let todayStr = today(t.tz || 'America/New_York');
    if (todayStr > t.end) tripState = `<div class="notice">이 여행은 <b>${safe(t.end)}</b>에 끝났습니다. 새 여행은 <button class="soft" onclick="go('manage')">관리</button>에서 추가하세요. 아래는 지난 기록입니다.</div>`;
    else if (todayStr < t.start) {
      let ddays = Math.max(0, Math.round((wallToInstant(t.start, '00:00', t.tz || 'America/New_York') - now().getTime()) / 864e5));
      tripState = `<div class="notice">여행 준비 중 · <b>${safe(t.start)}</b> 출발까지 <b>D-${ddays}</b></div>`;
    }
  }
  return `${rehearsal?`<div class="banner">🧪 현장 리허설 중 · 실제 현재 시각 아님 <button class="soft" onclick="rehearsal=null;reset()">종료</button></div>`:''}${tripState}<section class="home-top-board" aria-label="필라델피아와 여행지 정보"><div id="phlCell" class="top-cell home"><div class="top-label">필라델피아</div><div class="top-value" id="phlClock"></div><div class="top-sub" id="phlDate"></div></div><div id="destCell" class="top-cell dest"><div class="top-swap"><div class="top-label" id="destLabel">${safe(destCityName())}</div><div class="top-value" id="destClock"></div><div class="top-sub" id="destDate"></div></div></div><button type="button" class="top-cell wx" onclick="openWeeklyWeather()"><div class="top-swap"><div class="top-label">${safe(destCityName())}</div><div class="top-value" id="weatherNow">${rehearsal?'리허설 · 실제 예보 아님':(weatherDays.length?(wxTodayCell()):'확인 중')}</div><div class="top-sub">${rehearsal?'리허설 · 실제 예보 아님':(weatherDays.length?wxTodayPop():'날씨 확인')}</div></div></button></section><div class="location-strip ${rehearsal?'idle':geoState==='checking'?'checking':geoState==='ok'&&geo&&Date.now()-geo.at<180000?'ok':geoState==='error'||geoState==='ok'?'error':'idle'}" role="status" aria-live="polite"><span class="location-dot" aria-hidden="true"></span><span class="location-label">현재 위치</span><span class="location-status">${safe(rehearsal?'리허설 중':geoState==='checking'?'확인 중':geoState==='ok'&&geo&&Date.now()-geo.at<180000?'수신 · 약 '+Math.round(geo.accuracy)+'m':geoState==='ok'?'오래된 위치':geoState==='error'?geoMessage:'확인 전')}</span><button type="button" class="location-refresh" onclick="locate()" aria-label="현재 위치 새로고침" title="위치 새로고침">↻</button></div><div class="geo-address" aria-live="polite">${safe(rehearsal?'리허설 중 실제 주소 미표시':geoAddress||'주소 미확인 · 위치를 갱신하세요')}</div>${!t?'<div class="card"><h1>여행을 준비해 볼까요?</h1><p>관리에서 여행 일정을 넣고 검토한 뒤 홈에서 확인하세요.</p><button class="primary" onclick="go(&#39;manage&#39;)">관리 열기</button></div>':!e?'<div class="card">아직 일정이 없습니다. 관리에서 날짜별 일정을 입력하세요.</div>':`<div class="card"><span class="eyebrow">${viewId?'다른 일정 미리 보기 · 10분 후 자동 복귀':'현지 시각 기준 · 현재 예정된 일정'}</span><h1>${safe(e.title||'제목 없는 일정')}</h1><div class="muted">${safe(a[i].d.date)} · ${safe(e.time||'시간 미정')} ${e.endTime?'– '+safe(e.endTime):''} · ${safe(a[i].d.city||t.city||'')}</div><div class="nav"><button onclick="move(-1)">← 이전 일정</button><button onclick="reset()">● 현재 일정</button><button onclick="move(1)">다음 일정 →</button></div>

${renderGuideBlock(t, e)}

<div class="next"><b>다음 목적지</b><br>${next?safe(next.e.title):'다음 일정 없음'}<br>${safe(e.transfer||'이동 방법·예상 시간 확인 필요')}</div><div class="toolbar"><button onclick="toggleDone('${safe(e.id)}')">${e.done?'✓ 방문 완료':'○ 방문 미완료'}</button><button onclick="go('schedule')">일정 탭에서 보기</button></div>${e.note?`<details><summary>일정 원문·변경사항</summary><p>${safe(e.note)}</p></details>`:''}${e.details?`<details><summary>일정 세부 정보</summary><div style="white-space:pre-wrap">${safe(e.details)}</div></details>`:''}${eventOriginalDetail(a,i)}</div>`}`
}

async function changePhoto(k, src) {
  let t = trip();
  let gAll = t?.guides?.[all()[selectedIndex()]?.e.id] || {};
  let isLegacy = (gAll.highlights !== undefined || gAll.history !== undefined || gAll.route !== undefined || gAll.photos !== undefined);
  let g = gAll;
  if (!isLegacy) {
    if (!src && Object.keys(gAll).length) src = Object.keys(gAll)[0];
    g = src ? gAll[src] : {};
  }
  let p = g?.photos?.[k];
  if (p) {
    let hero = $("#heroPhoto");
    if (p.data) hero.src = p.data;
    else if (p.id) {
      try {
        let dataUrl = await PhotoDB.get(p.id);
        if (dataUrl) hero.src = dataUrl;
      } catch(e) {}
    }
    $("#photoCaption").textContent = p.caption || "현장 확인 사진";
  }
}

function toggleDone(eid) {
  let x = all().find(x => x.e.id === eid);
  if (x) {
    x.e.done = !x.e.done;
    persist();
    render()
  }
}

function updateClocks() {
  let t = trip();
  $('#phlClock').textContent = displayClock('America/New_York');
  $('#phlDate').textContent = fmt(now(), 'America/New_York', {
    month: 'numeric',
    day: 'numeric',
    weekday: 'short'
  });
  let tone = tz => {
    let h = +clock(tz).slice(0, 2);
    return h >= 5 && h < 12 ? 'tone-morning' : h >= 12 && h < 20 ? 'tone-day' : 'tone-night'
  };
  let dz = destTz();
  $('#phlCell').className = 'top-cell home ' + tone('America/New_York');
  $('#destCell').className = 'top-cell dest ' + tone(dz);
  $('#destClock').textContent = displayClock(dz);
  $('#destDate').textContent = fmt(now(), dz, {
    month: 'numeric',
    day: 'numeric',
    weekday: 'short'
  });
  let dl = $('#destLabel');
  if (dl) dl.textContent = destCityName();
  let wp = weatherPoint(t);
  let wkey = t ? t.id + '|' + wp.lat + '|' + wp.lon + '|' + wp.tz : '';
  if (t && !rehearsal && wp.lat && wp.lon && weatherKey !== wkey) {
    weatherKey = wkey;
    weatherDays = [];
    weatherFetchedAt = 0;
    loadWeather(t, false)
  }
}

function wxInfo(code) {
  code = Number(code);
  if (code === 0) return ['☀️', '맑음'];
  if (code === 1) return ['🌤️', '대체로 맑음'];
  if (code === 2) return ['⛅', '부분 흐림'];
  if (code === 3) return ['☁️', '흐림'];
  if ([45, 48].includes(code)) return ['🌫️', '안개'];
  if ([51, 53, 55, 56, 57].includes(code)) return ['🌦️', '이슬비'];
  if ([61, 63, 65, 66, 67, 80, 81, 82].includes(code)) return ['🌧️', '비'];
  if ([71, 73, 75, 77, 85, 86].includes(code)) return ['🌨️', '눈'];
  if ([95, 96, 99].includes(code)) return ['⛈️', '천둥번개'];
  return ['🌡️', '날씨']
}

function tempF(v) {
  const n = Number(v);
  return Number.isFinite(n) ? Math.round(n * 9 / 5 + 32) : null
}

function fmtTempRange(d) {
  if (!d) return '';
  let lo = tempF(d.min),
    hi = tempF(d.max);
  return lo == null || hi == null ? '' : lo + '~' + hi + '°F'
}

function shortWxLabel(label) {
  return label === '대체로 맑음' ? '맑음' : label === '부분 흐림' ? '부분흐림' : label
}

function deriveDayWxCode(j, date, dailyCode, dailyPop, dailySum) {
  const hourly = j && j.hourly;
  if (!hourly || !Array.isArray(hourly.time) || !Array.isArray(hourly.weather_code)) return dailyCode;
  const precipCodes = [51, 53, 55, 56, 57, 61, 63, 65, 66, 67, 71, 73, 75, 77, 80, 81, 82, 85, 86, 95, 96, 99],
    counts = {};
  let precipTotal = 0,
    fogTotal = 0,
    cloudSum = 0,
    cloudCount = 0;
  hourly.time.forEach((t, i) => {
    let ts = String(t || '');
    if (ts.slice(0, 10) !== date) return;
    let hr = +ts.slice(11, 13);
    if (hr < 8 || hr > 20) return;
    let code = Number(hourly.weather_code[i]);
    if (precipCodes.includes(code)) {
      counts[code] = (counts[code] || 0) + 1;
      precipTotal++
    }
    if (code === 45 || code === 48) fogTotal++;
    let cc = hourly.cloud_cover ? Number(hourly.cloud_cover[i]) : NaN;
    if (Number.isFinite(cc)) {
      cloudSum += cc;
      cloudCount++
    }
  });
  let strong = Number(dailyPop || 0) >= 50 || Number(dailySum || 0) >= 1;
  if (precipTotal >= 2 || (strong && precipTotal >= 1)) {
    let best = dailyCode,
      n = -1;
    Object.keys(counts).forEach(k => {
      if (counts[k] > n) {
        n = counts[k];
        best = +k
      }
    });
    return best
  }
  if (fogTotal >= 2) return 45;
  if (!cloudCount) return dailyCode;
  let avg = cloudSum / cloudCount;
  return avg <= 20 ? 0 : avg <= 50 ? 1 : avg <= 80 ? 2 : 3
}

function weatherStorageKey(t, p = weatherPoint(t)) {
  return 'sk-guide-wx3-' + t.id + '-' + p.lat + '-' + p.lon + '-' + p.tz
}
async function loadWeather(t, force) {
  let p = weatherPoint(t);
  if (!t || rehearsal || !p.lat || !p.lon || weatherBusy) return;
  let key = weatherStorageKey(t, p);
  if (!force) {
    try {
      let cached = JSON.parse(localStorage.getItem(key) || 'null');
      if (cached?.daily?.length >= 14 && Date.now() - cached.fetchedAt < 3600000) {
        weatherDays = cached.daily;
        weatherFetchedAt = cached.fetchedAt;
        setWeatherTop(t);
        return
      }
    } catch {}
  }
  if (!navigator.onLine) return;
  weatherBusy = true;
  try {
    let url = 'https://api.open-meteo.com/v1/forecast?latitude=' + encodeURIComponent(p.lat) + '&longitude=' + encodeURIComponent(p.lon) + '&hourly=weather_code,cloud_cover&daily=weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max,precipitation_sum&timezone=' + encodeURIComponent(p.tz || 'auto') + '&forecast_days=14',
      r = await fetch(url);
    if (!r.ok) throw Error('날씨 서버 ' + r.status);
    let j = await r.json();
    if (!j.daily?.time?.length) throw Error('예보 데이터 없음');
    weatherDays = j.daily.time.map((date, i) => {
      let rawCode = j.daily.weather_code?.[i],
        pop = j.daily.precipitation_probability_max?.[i] ?? null,
        sum = j.daily.precipitation_sum?.[i] ?? null;
      return {
        date,
        code: deriveDayWxCode(j, date, rawCode, pop, sum),
        rawCode,
        max: j.daily.temperature_2m_max?.[i],
        min: j.daily.temperature_2m_min?.[i],
        pop,
        sum
      }
    });
    weatherFetchedAt = Date.now();
    try {
      localStorage.setItem(key, JSON.stringify({
        fetchedAt: weatherFetchedAt,
        daily: weatherDays
      }))
    } catch {}
    setWeatherTop(t);
    if (!$('#modal').classList.contains('hidden') && $('#modalTitle').textContent.includes('2주 날씨')) $('#modalContent').innerHTML = weatherDetails(t)
  } catch (e) {
    if (!$('#modal').classList.contains('hidden') && $('#modalTitle').textContent.includes('2주 날씨')) $('#modalContent').innerHTML = '<div class="notice">' + safe(e.message) + '</div>'
  } finally {
    weatherBusy = false
  }
}

function todayWeather(tz) {
  return weatherDays.find(x => x.date === today(tz)) || null
}

function setWeatherTop(t) {
  if (tab !== 'home' || trip()?.id !== t.id) return;
  let d = todayWeather(weatherPoint(t).tz);
  let v = $('#weatherNow');
  if (v) v.textContent = d ? wxInfo(d.code)[0] + ' ' + shortWxLabel(wxInfo(d.code)[1]) + ' ' + fmtTempRange(d) : '확인 중';
  let sub = $('.home-top-board .wx .top-sub');
  if (sub) sub.textContent = d?.pop != null ? '💧' + Math.round(d.pop) + '%' : ''
}

function weatherDate(date) {
  let d = new Date(date + 'T12:00:00Z');
  return (d.getUTCMonth() + 1) + '/' + d.getUTCDate() + ' (' + ['일', '월', '화', '수', '목', '금', '토'][d.getUTCDay()] + ')'
}

function weatherDetails(t) {
  let p = weatherPoint(t);
  if (rehearsal) return '<div class="notice">가상 날짜 리허설 중입니다. 과거·미래 날짜의 실제 날씨 예보를 표시하지 않습니다.</div>';
  if (!p.lat || !p.lon) return '<div class="notice">여행지 좌표가 등록되지 않았습니다.</div>';
  if (!weatherDays.length) return '<div class="notice">' + (navigator.onLine ? '날씨를 불러오는 중입니다. 잠시만 기다려 주세요.' : '인터넷에 연결되면 2주 날씨를 볼 수 있습니다.') + '</div>';
  let days = weatherDays.slice(0, 14),
    range = weatherDate(days[0].date).slice(0, 5) + '~' + weatherDate(days[days.length - 1].date).slice(0, 5);
  return '<div class="wx7"><div class="wx7-head"><span>' + safe(p.label + ' · ' + range) + '</span><span>화씨(°F) · 최저~최고</span></div>' + days.map(d => {
    let [icon, label] = wxInfo(d.code), lo = tempF(d.min), hi = tempF(d.max);
    return '<div class="wx7-row' + (d.date === today(p.tz) ? ' today' : '') + '"><div class="wx7-date">' + safe(weatherDate(d.date)) + '</div><div class="wx7-icon" aria-hidden="true">' + icon + '</div><div class="wx7-main"><span>' + safe(label) + '</span>' + (d.pop != null ? '<span class="wx7-pop">💧' + Math.round(d.pop) + '%</span>' : '') + '</div><div class="wx7-temp"><span class="lo">' + (lo == null ? '-' : lo + '°') + '</span><span class="sep">~</span><span class="hi">' + (hi == null ? '-' : hi + '°') + '</span></div></div>'
  }).join('') + '</div><div class="small" style="margin-top:8px">Open-Meteo 예보 · ' + safe(new Date(weatherFetchedAt).toLocaleString('ko-KR')) + ' · 8일 이후는 경향으로 보세요</div>'
}

function openWeeklyWeather() {
  let t = trip();
  openModal('🌤️ ' + weatherPoint(t).label + ' 2주 날씨', weatherDetails(t));
  $('#modal').classList.add('weather-sheet');
  if (t && !rehearsal) {
    let stale = !weatherDays.length || Date.now() - weatherFetchedAt > 3600000;
    if (stale) loadWeather(t, true)
  }
}

function locate(silent = false) {
  if (rehearsal) return;
  if (!navigator.geolocation) {
    geoState = 'error';
    geoMessage = '위치 미지원';
    render();
    return
  }
  if (geoState === 'checking') return;
  geoState = 'checking';
  geoMessage = '확인 중';
  if (tab === 'home') render();
  navigator.geolocation.getCurrentPosition(p => {
    geo = {
      lat: p.coords.latitude,
      lon: p.coords.longitude,
      accuracy: p.coords.accuracy,
      at: Date.now()
    };
    geoState = 'ok';
    geoMessage = '수신';
    geoAddress = '주소 찾는 중 · 좌표 정확도 약 ' + Math.round(p.coords.accuracy) + 'm';
    if (tab === 'home') render();
    reverseGeocode(geo)
  }, e => {
    geoState = 'error';
    geoAddress = '주소 미확인';
    geoMessage = e.code === 1 ? '권한 꺼짐' : e.code === 3 ? '시간 초과' : '위치 미확인';
    if (tab === 'home') render();
    if (!silent && e.code === 1) alert('위치 권한이 거부되었습니다. 브라우저 설정에서 이 사이트의 위치 권한을 허용해 주세요.')
  }, {
    enableHighAccuracy: true,
    timeout: 12000,
    maximumAge: 60000
  })
}
async function reverseGeocode(fix) {
  if (!navigator.onLine) {
    geoAddress = '오프라인 · 좌표 ' + fix.lat.toFixed(5) + ', ' + fix.lon.toFixed(5);
    if (tab === 'home') render();
    return
  }
  try {
    const controller = new AbortController(),
      timer = setTimeout(() => controller.abort(), 9000);
    let url = 'https://nominatim.openstreetmap.org/reverse?format=jsonv2&lat=' + encodeURIComponent(fix.lat) + '&lon=' + encodeURIComponent(fix.lon) + '&zoom=18&addressdetails=1&accept-language=ko';
    let response;
    try {
      response = await fetch(url, {
        signal: controller.signal,
        headers: {
          'Accept': 'application/json'
        }
      })
    } finally {
      clearTimeout(timer)
    }
    if (!response.ok) throw Error('주소 조회 실패');
    let data = await response.json();
    if (geo?.at !== fix.at) return;
    geoAddress = data.display_name ? '지도 주소(추정) · ' + data.display_name : '주소 없음 · 좌표 ' + fix.lat.toFixed(5) + ', ' + fix.lon.toFixed(5)
  } catch (e) {
    if (geo?.at !== fix.at) return;
    geoAddress = '주소를 찾지 못함 · 좌표 ' + fix.lat.toFixed(5) + ', ' + fix.lon.toFixed(5)
  }
  if (tab === 'home') render()
}
async function autoGeo() {
  if (rehearsal || geoState === 'checking' || (geo?.at && Date.now() - geo.at < 180000)) return;
  try {
    let status = await navigator.permissions?.query({
      name: 'geolocation'
    });
    if (status?.state === 'granted') locate(true)
  } catch {}
}

function schedule() {
  let t = trip();
  if (!t) return '<div class="card">먼저 관리에서 여행을 선택하세요.</div>';
  return '<iframe id="scheduleFrame" class="iframe" title="원본 디자인 일정 아코디언" src="schedule-seed.html" style="min-height:78vh"></iframe>'
}

function syncSchedule() {
  let f = $('#scheduleFrame');
  if (f?.contentWindow && trip()) f.contentWindow.postMessage({
    type: 'SK_SCHEDULE',
    trip: trip(),
    bodySize: typography.body,
    spacing: typography.spacing
  }, location.origin)
}
window.addEventListener('message', e => {
  if (e.origin === location.origin && e.data?.type === 'SK_SCHEDULE_READY') syncSchedule()
});

function formatHotel(value) {
  if (value == null) return '';
  if (typeof value === 'object') return [value.name, value.address, value.phone ? '전화 ' + value.phone : '', value.checkin ? '체크인 ' + value.checkin : '', value.checkout ? '체크아웃 ' + value.checkout : ''].filter(Boolean).join(' · ');
  let str = String(value);
  if (str.trim().startsWith('{')) {
    try {
      let obj = JSON.parse(str);
      return formatHotel(obj)
    } catch {}
  }
  return str
}

function flight() {
  let t = trip();
  if (!t) return '<div class="card">여행을 선택하세요.</div>';
  const names = {
    flight: '항공',
    airport: '공항 안내',
    ticket: '비행기 티켓',
    hotel: '호텔'
  };
  return `<h2>항공 · 공항 · 숙소</h2>${isSeedTrip(t)?'<div class="alert">🔴 귀국편 리스본 출발 시각 확인 필요: 일정표 11:05 / 전자항공권 10:55. 어느 쪽도 확정하지 않았습니다. 항공사에서 확인하세요.</div>':''}${['flight','airport','ticket','hotel'].map(k=>`<details class="flight-section" data-kind="${k}" open><summary>${names[k]}</summary>${all().filter(x=>x.e[k]).map(x=>`<div class="flight-entry"><div class="flight-entry-title${/집결|집합|셔틀|주차장|출발 장소/.test((x.e.title||'') + ' ' + (x.e.note||'')) ? ' kind-gather' : ''}">${safe(x.d.date)} · ${safe(x.e.title)}</div>${flightFields(k,x.e[k])}</div>`).join('')||'<p class="muted">입력된 정보 없음</p>'}</details>`).join('')}`
}

function flightFields(kind, value) {
  let text = kind === 'hotel' ? formatHotel(value) : String(value || '');
  let chunks = text.split(/\s*·\s*/).map(s => s.trim()).filter(Boolean);
  if (!chunks.length) return '<div class="flight-chip">입력된 정보 없음</div>';
  
  let mergedChunks = [];
  let currentCombo = null;
  
  for (let i = 0; i < chunks.length; i++) {
    let part = chunks[i];
    let isDept = /출발|LV:/.test(part);
    let isArr = /도착|AR:/.test(part);
    
    if (isDept || isArr) {
      if (!currentCombo) {
        currentCombo = { label: '일정', parts: [part] };
      } else {
        currentCombo.parts.push(part);
      }
      // If we got both dept and arr, push to mergedChunks
      let hasDept = currentCombo.parts.some(p => /출발|LV:/.test(p));
      let hasArr = currentCombo.parts.some(p => /도착|AR:/.test(p));
      if (hasDept && hasArr) {
        mergedChunks.push({ label: '출발·도착', text: currentCombo.parts.join(' ➔ ') });
        currentCombo = null;
      }
    } else {
      if (currentCombo) {
        mergedChunks.push({ label: currentCombo.parts.some(p=>/출발/.test(p)) ? '출발' : '도착', text: currentCombo.parts.join(' ') });
        currentCombo = null;
      }
      let label = '안내';
      if (/터미널|Terminal/.test(part)) label = '터미널';
      else if (/항공|Airlines/.test(part)) label = '항공사';
      else if (/전화/.test(part)) label = '전화';
      else if (/체크인/.test(part)) label = '체크인';
      else if (/체크아웃/.test(part)) label = '체크아웃';
      else if (kind === 'flight' && i === 1) label = '편명';
      else if (kind === 'hotel' && i === 0) label = '숙소';
      else if (kind === 'airport') label = '공항';
      else if (kind === 'ticket') label = '티켓';
      mergedChunks.push({ label, text: part });
    }
  }
  if (currentCombo) {
    mergedChunks.push({ label: currentCombo.parts.some(p=>/출발/.test(p)) ? '출발' : '도착', text: currentCombo.parts.join(' ') });
  }

  return '<div class="flight-fields">' + mergedChunks.map((item, i) => {
    return '<div class="flight-chip chip-' + (i % 4) + '"><small>' + item.label + '</small><span>' + safe(item.text) + '</span></div>'
  }).join('') + '</div>'
}

function packing() {
  return `<iframe id="packingFrame" class="iframe" title="기존 준비물 체크리스트" src="packing.html"></iframe>`
}

function exRow(label, value) {
  let v = String(value == null ? '' : value).trim();
  return v ? '<div class="fact"><b>' + safe(label) + '</b> · ' + safe(v) + '</div>' : ''
}

function exBlock(title, items, build) {
  let list = arr(items);
  if (!list.length) return '';
  return '<details><summary>' + safe(title) + ' · ' + list.length + '건</summary>' + list.map(build).join('') + '</details>'
}

function exLink(list) {
  return arr(list).filter(x => x && x.url).map(x => '<div class="fact"><b>' + safe(x.label || x.name || '바로가기') + '</b> · <a href="' + safe(x.url) + '" target="_blank" rel="noopener noreferrer">' + safe(x.url) + '</a></div>').join('')
}

function exDayLine(d) {
  return '<div class="fact"><b>' + safe(d.date || '') + (d.label ? ' · ' + safe(d.label) : '') + '</b>' + (d.meals?.length ? '<div class="small">🍽 ' + safe(d.meals.join(' / ')) + '</div>' : '') + (d.hotel?.name ? '<div class="small">🏨 ' + safe(d.hotel.name) + '</div>' : '') + (d.alerts?.length ? '<div class="small warning">⚠️ ' + safe(d.alerts.join(' / ')) + '</div>' : '') + '</div>'
}

/* 원본 시드 자료(trip.extras) 보기 — 예전에는 저장 후 버려지던 자료입니다. */
function openTripExtras() {
  let t = trip(),
    x = t?.extras;
  if (!t) return openModal('📚 여행 자료', '<p class="muted">여행이 없습니다.</p>');
  if (!x) return openModal('📚 여행 자료', '<div class="notice">이 여행에는 원본 자료가 없습니다. 붙여넣기로 가져온 일정은 일정 카드에만 표시됩니다.</div>');
  let html = '<p class="muted">여행사 원본 자료를 보관한 화면입니다. 값이 서로 다르면 원본 안내문·항공사 앱을 우선하세요.</p>';
  html += exBlock('비상 연락처', x.important, r => exRow(r.label || r.category || '연락처', [r.value, r.note].filter(Boolean).join(' · ')));
  html += '<details><summary>일자별 식사·숙소·주의 · ' + (t.days || []).length + '일</summary>' + (t.days || []).map(exDayLine).join('') + '</details>';
  html += exBlock('여행사 안내문', x.notices, r => '<div class="fact"><b>' + safe(r.title || '안내') + '</b><div class="small" style="white-space:pre-wrap">' + safe(stripHtml(r.html)) + '</div></div>');
  html += exBlock('공항 안내', x.airports, r => '<div class="fact"><b>' + safe(r.name || r.code || '공항') + '</b>' + exRow('터미널', r.terminal) + exRow('들어가는 곳', r.entry) + exRow('체크인', r.checkin) + exRow('절차', r.procedure) + exRow('수하물', r.baggage) + '</div>');
  html += exBlock('이동 수단', x.transfers, r => exRow([r.mode, r.name].filter(Boolean).join(' '), [r.duration, r.cost, r.where, r.note].filter(Boolean).join(' · ')));
  html += exBlock('숙소', x.hotels, r => '<div class="fact"><b>' + safe(r.name || '숙소') + '</b>' + exRow('주소', r.address) + exRow('전화', r.phone) + exRow('체크인→아웃', [r.checkin, r.checkout].filter(Boolean).join(' → ')) + exRow('메모', r.note) + '</div>');
  html += exBlock('현장 팁', x.tips, r => '<div class="fact"><b>' + safe([r.icon, r.date, r.title].filter(Boolean).join(' ')) + '</b>' + exRow('문제', r.issue) + exRow('할 일', r.action) + exRow('대안', r.alternative) + exRow('비용·시간', r.costHours) + '</div>');
  html += exBlock('전문가 정보', x.expertInfo, r => '<div class="fact"><b>' + safe([r.icon, r.title].filter(Boolean).join(' ')) + '</b>' + exRow('내용', r.body) + exRow('행동', r.action) + exRow('준비물', r.secretItem) + exRow('확인일', r.verifiedAt) + '</div>');
  html += exBlock('화장실·편의시설 (OpenStreetMap)', x.amenities, r => '<div class="fact"><b>' + safe(r.name || '시설') + '</b>' + exRow('도시', r.city) + exRow('요금', [r.feeStatus, r.price].filter(Boolean).join(' · ')) + exRow('이용', r.availability) + exRow('운영시간', r.hours) + '</div>');
  html += exBlock('주변 장소', x.contextPlaces, r => '<div class="fact"><b>' + safe(r.name || '') + '</b>' + exRow('지금', r.nowBody) + exRow('할 일', arr(r.doNow).join(' / ')) + '</div>');
  let links = exLink(x.liveSources);
  if (links) html += '<details><summary>공식 정보원 링크 · ' + arr(x.liveSources).length + '건</summary>' + links + '</details>';
  html += exBlock('추가 자료', x.infoFeed, r => exRow(r.title || r.label || '', r.body || r.text || r.summary || ''));
  html += exBlock('가이드 노트', x.guideNotes, r => exRow(r.title || r.label || '', r.body || r.text || ''));
  openModal('📚 여행 자료', html)
}

function manage() {
  let t = trip();
  return `<h2>내 여행 <span class="small">· 최대 4개</span></h2>
<div class="card">
  ${db.trips.map(x=>`<div class="trip ${x.id===db.active?'active':''}"><div class="row"><b>${safe(x.name)}</b><button class="${x.id===db.active?'primary':'soft'}" onclick="activate('${safe(x.id)}')">${x.id===db.active?'✓ 선택됨':'선택'}</button></div><div class="small">${safe(x.start||'시작일 미정')} · ${safe(x.city||'도시 미입력')}</div><div class="actions"><button onclick="editTrip('${safe(x.id)}')">전체 정보 편집</button><button onclick="backupChoose('${safe(x.id)}')">백업</button><button class="danger" onclick="deleteTrip('${safe(x.id)}')">삭제</button></div></div>`).join('')||'<p class="muted">저장된 여행이 없습니다.</p>'}
</div>

<h2>일정 넣기</h2>
<div class="card">
  <p class="muted">여행 일정을 파일로 가져오거나 가이드 ZIP을 추가합니다.</p>
  <div class="toolbar">
    <button class="primary" onclick="$('#scheduleImportFile').click()">일정 가져오기</button>
    <button class="soft" onclick="$('#guideZipFile').click()">가이드 가져오기(ZIP)</button>
    <button class="soft" onclick="openImport()">텍스트 붙여넣기</button>
  </div>
  <input id="scheduleImportFile" type="file" accept="*" hidden onchange="handleScheduleImport(this.files[0])">
  <input id="guideZipFile" type="file" accept="*" hidden onchange="handleGuideZipImport(this.files[0])">
</div>

<h2>개인 예약정보</h2>
<div class="card">
  <p class="muted">별도 비밀번호로 잠근 보관함입니다. 일반 백업에 섞이지 않습니다.</p>
  <button class="soft" onclick="openVault()">개인 예약정보 열기</button>
</div>

<h2>백업 · 복원</h2>
<div class="card">
  <p class="muted">원하는 여행을 파일로 만들어 기기에 저장합니다.</p>
  <div class="toolbar">
    <button class="primary" onclick="backupChoose()">백업 만들기</button>
    <button class="soft" onclick="openBackupImport()">백업 파일 가져오기</button>
  </div>
  <input id="backupInput" type="file" accept="*" multiple hidden onchange="restoreFiles(this.files)">
</div>

<h2>고급 설정</h2>
<div class="card">
  
  <div style="margin-top:15px">
    <b>글자 보기 설정</b>
    <p class="muted">제목·소제목·본문 크기와 자간 조절</p>
    <button class="soft" onclick="openTypography()">글자 크기·자간 조절</button>
  </div>

  <div style="margin-top:25px">
    <b>여행 미리 체험하기</b>
    <p class="muted">여행지 현지 시각으로 일정을 미리 봅니다.</p>
    <label class="field">여행지 현지 시각<input id="rehearsalInput" type="datetime-local" value="${safe(t?.start||new Date().toISOString().split('T')[0])}T10:00"></label>
    <button class="soft" onclick="startRehearsal()">리허설 시작</button>
    ${rehearsal?'<button class="soft" onclick="rehearsal=null;reset();render()">복귀</button>':''}
  </div>

  <div style="margin-top:25px">
    <b>📱 갤럭시 최적화 설정</b>
    <div class="toolbar" style="margin-top:10px">
      <button onclick="promptInstall()">홈 화면에 추가</button>
      <button onclick="toggleWake()">${wakeWanted?'화면 켜짐 유지 끄기':'화면 켜짐 켜기'}</button>
      <button onclick="requestPersist()">저장 공간 지키기</button>
    </div>
  </div>

  <div style="margin-top:25px">
    <b>앱 버전 ${APP_VERSION}</b>
    <div class="muted" id="versionNotice">업데이트 확인 중…</div>
    <p class="small" style="margin-top:8px">🔒 주소·날씨를 볼 때 위치 정보가 OpenStreetMap·Open-Meteo로 전송됩니다. 오프라인이면 전송되지 않습니다.</p>
    <button class="soft" onclick="checkVersion()">새 버전 확인</button>
  </div>
</div>`;
}

function activate(i) {
  db.active = i;
  viewId = null;
  weatherKey = '';
  weatherDays = [];
  weatherFetchedAt = 0;
  weather = null;
  persist();
  render()
}

function deleteTrip(i) {
  let t = db.trips.find(x => x.id === i);
  if (!confirm('"' + t.name + '" 여행을 이 기기에서 삭제할까요? 먼저 백업을 권합니다.')) return;
  db.trips = db.trips.filter(x => x.id !== i);
  if (db.active === i) db.active = db.trips[0]?.id || null;
  persist();
  render()
}

function openModal(title, html) {
  $('#modal').classList.remove('weather-sheet');
  if (!history.state?.modal) history.pushState({
    tab,
    modal: true
  }, '', location.pathname + location.search + '#편집');
  $('#modalTitle').textContent = title;
  $('#modalContent').innerHTML = html;
  $('#modal').classList.remove('hidden')
}

function closeModal(back = true) {
  vaultSession = null;
  $('#modal').classList.remove('weather-sheet');
  if (back && history.state?.modal) {
    $('#modal').classList.add('hidden');
    $('#modalContent').innerHTML = '';
    history.back();
    return
  }
  $('#modal').classList.add('hidden');
  $('#modalContent').innerHTML = ''
}

function field(k, label, v = '', type = 'text') {
  return `<label class="field">${safe(label)}<input name="${safe(k)}" type="${type}" value="${safe(v)}"></label>`
}

function area(k, label, v = '') {
  return `<label class="field">${safe(label)}<textarea name="${safe(k)}">${safe(v)}</textarea></label>`
}

function openImport() {
  pending = null;
  openModal('새 여행 일정 넣기', `<p class="muted">웹사이트에서 복사한 일정을 아래에 붙여넣으세요. 여행 이름·날짜·도시·통화는 원문에서 찾은 내용을 다음 검토 화면에 표시하며, 확실하지 않으면 비워 둡니다.</p><div class="alert">사진·스캔·PDF 자동 인식은 아직 지원하지 않습니다. 인식되는 것처럼 안내하지 않겠습니다. 해당 자료는 텍스트로 복사한 뒤 붙여 넣으세요.</div><input type="file" accept="*" onchange="loadImportFile(this.files[0])">${area('raw','여행 일정 전체 텍스트','')}<button class="primary" onclick="previewImport()">전체 화면에서 일정 검토</button>`)
}
async function loadImportFile(f) {
  if (!f) return;
  try {
    let s = await f.text();
    if (f.name.endsWith('.json')) {
      let o = JSON.parse(s);
      if (o.format === 'sk-travel-trip') {
        let t = convertLegacy(o);
        pending = t;
        showReview(t);
        return
      }
      if (o.days) {
        pending = normalize(o);
        showReview(pending);
        return
      }
      throw Error('지원하지 않는 JSON입니다.')
    }
    $('#modalContent [name=raw]').value = s
  } catch (e) {
    alert('파일을 읽을 수 없습니다: ' + e.message)
  }
}

function parseRaw(v) {
  let lines = v.raw.split(/\r?\n/),
    days = [],
    byDate = new Map(),
    section = '',
    last = null;
  for (let line of lines) {
    line = line.trim();
    if (!line) continue;
    let h = line.match(/^\[([^\]]+)\]/);
    if (h) {
      section = h[1];
      continue
    }
    let d = line.match(/(20\d\d[-./]\d\d?[-./]\d\d?)/),
      date = d ? d[1].replace(/[./]/g, '-').split('-').map((v, i) => i ? v.padStart(2, '0') : v).join('-') : '';
    if (!date) {
      let dm = line.match(/(20\d{2})년\s*(\d{1,2})월\s*(\d{1,2})일/);
      if (dm) date = dm[1] + '-' + dm[2].padStart(2, '0') + '-' + dm[3].padStart(2, '0')
    }
    let time = (line.match(/\b([01]?\d|2[0-3]):[0-5]\d\b/) || [])[0] || '';
    if (!date && /^\d{1,2}월\s*\d{1,2}일/.test(line) && v.start) {
      let m = line.match(/^(\d{1,2})월\s*(\d{1,2})일/);
      date = v.start.slice(0, 4) + '-' + m[1].padStart(2, '0') + '-' + m[2].padStart(2, '0')
    }
    if (date) {
      let day = byDate.get(date);
      if (!day) {
        day = {
          date,
          city: v.city,
          events: []
        };
        byDate.set(date, day);
        days.push(day)
      }
      let parts = line.replace(/20\d\d[-./]\d\d?[-./]\d\d?/, '').replace(/20\d{2}년\s*\d{1,2}월\s*\d{1,2}일/, '').replace(/^\s*\d{1,2}월\s*\d{1,2}일/, '').replace(/\b([01]?\d|2[0-3]):[0-5]\d\b/, '').replace(/^\s*[-:|·]\s*/, '').split('|').map(x => x.trim());
      let title = parts[0] || '내용 확인 필요';
      let e = {
        id: id(),
        time: time.padStart(5, '0'),
        title,
        place: parts[1] || '',
        note: parts.slice(2).join(' | '),
        transfer: '',
        ticket: '',
        flight: '',
        airport: '',
        hotel: '',
        done: false
      };
      let text = line;
      if (/항공|비행|편명/.test(section + title)) e.flight = text;
      if (/공항/.test(section + title)) e.airport = text;
      if (/티켓|입장권/.test(section + title)) e.ticket = text;
      if (/숙소|호텔/.test(section + title)) e.hotel = text;
      day.events.push(e);
      last = e
    } else if (last) {
      last.note += (last.note ? '\n' : '') + line
    } else {
      let day = byDate.get(v.start);
      if (v.start && !day) {
        day = {
          date: v.start,
          city: v.city,
          events: []
        };
        byDate.set(v.start, day);
        days.push(day)
      }
      if (day) {
        last = {
          id: id(),
          time: '',
          title: line,
          place: '',
          note: '날짜 미확인 원문 · 검토 필요',
          done: false
        };
        day.events.push(last)
      }
    }
  }
  return {
    id: id(),
    name: v.name || '새 여행',
    start: v.start || days[0]?.date || '',
    city: v.city || '',
    tz: v.tz || 'Europe/Madrid',
    currency: v.currency || '',
    lat: v.lat || '',
    lon: v.lon || '',
    days: days.sort((a, b) => a.date.localeCompare(b.date)),
    guides: {}
  }
}

function previewImport() {
  try {
    let raw = $('#modalContent [name=raw]')?.value?.trim();
    if (!raw) return alert('먼저 일정 텍스트를 붙여 넣으세요.');
    let dates = [...raw.matchAll(/20\d{2}[-./]\d{1,2}[-./]\d{1,2}/g)].map(x => x[0].replace(/[./]/g, '-').split('-').map((v, i) => i ? v.padStart(2, '0') : v).join('-'));
    if (!dates.length) {
      dates = [...raw.matchAll(/(20\d{2})년\s*(\d{1,2})월\s*(\d{1,2})일/g)].map(m => m[1] + '-' + m[2].padStart(2, '0') + '-' + m[3].padStart(2, '0'))
    }
    let year = (dates[0] || '').slice(0, 4);
    let name = (raw.match(/(?:여행\s*(?:이름|명)|제목)\s*[:：]\s*([^\n]+)/i) || [])[1] || raw.split(/\r?\n/).map(x => x.trim()).find(x => x && !/^\[|^20\d{2}[-./]/.test(x)) || '새 여행';
    let city = '';
    let v = {
      raw,
      name: name.slice(0, 70),
      start: dates[0] || '',
      city: '',
      tz: '',
      currency: '',
      lat: '',
      lon: ''
    };
    pending = parseRaw(v);
    pending.sourceText = raw;
    pending.importWarning = '자동 분류 결과입니다. 이름·날짜·도시·통화·시간을 원문과 대조하세요.';
    showReview(pending)
  } catch (e) {
    alert('일정 검토 오류: ' + e.message);
    console.error(e)
  }
}

function normalize(t) {
  let out = clone(t);
  out.id = id();
  out.guides = out.guides || {};
  out.days = (out.days || []).map(d => ({
    date: d.date || '',
    city: d.city || '',
    events: (d.events || []).map(e => ({
      ...e,
      id: id()
    }))
  }));
  return out
}

const APP_VERSION = "v1.9.1";
const SEED_FLAG = 'sk-guide-seeded';
const AIRPORT_TZ = {
  PHL: 'America/New_York',
  BCN: 'Europe/Madrid',
  MAD: 'Europe/Madrid',
  LIS: 'Europe/Lisbon',
  AGP: 'Europe/Madrid',
  SVQ: 'Europe/Madrid',
  GRX: 'Europe/Madrid',
  VLC: 'Europe/Madrid',
  ZAZ: 'Europe/Madrid'
};

function arr(v) {
  if (Array.isArray(v)) return v.filter(x => x != null && String(x).trim() !== '');
  return v == null || String(v).trim() === '' ? [] : [v]
}

function txt(v, sep = ' ') {
  return arr(v).map(x => typeof x === 'string' ? x : (x?.title || x?.name || x?.label || '')).filter(Boolean).join(sep)
}

function stripHtml(html) {
  return String(html || '').replace(/<br\s*\/?>/gi, '\n').replace(/<\/p>/gi, '\n').replace(/<[^>]*>/g, ' ').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/[ \t]+/g, ' ').split('\n').map(x => x.trim()).filter(Boolean).join('\n').trim()
}

/* v0.2.5: 예전 convertLegacy는 brief의 일부만 sourceDetail로 붙이고 나머지 자료를 전부 버렸습니다.
   이제 brief를 홈 가이드 항목(꼭 볼 것/왜 중요한가/보는 순서/사진 포인트/화장실/자세히)으로 옮기고,
   팁·공항·이동·숙소·전문가 정보·화장실 정보는 trip.extras에 보존해 '여행 자료' 화면에서 봅니다. */
function guideFromBrief(e) {
  let b = e?.brief || {},
    lines = [];
  let push = (label, value) => {
    let v = String(value || '').trim();
    if (v) lines.push(label + ': ' + v)
  };
  push('시각적 단서', txt(b.visualClues, ' / '));
  push('준비물', txt(b.prepare, ' / '));
  push('주의', txt(b.risks, ' / '));
  push('편하게 이동', b.comfort);
  push('만남·집합', b.meeting);
  push('문제가 생기면', b.fallback);
  push('체류 시간', b.visitDuration);
  push('티켓', b.ticketStatus);
  for (let f of arr(e?.fieldAdvice)) push('현장 조언 · ' + (f.title || ''), [f.body, f.action ? '→ ' + f.action : ''].filter(Boolean).join(' '));
  push('출처', txt(b.sources, ', ') || '여행사 일정표·현장 자료');
  push('확인일', b.verifiedAt);
  push('신뢰 범위', b.confidence);
  let toilet = txt(b.toilets, ' ');
  if (b.toiletStatus === 'unverified') toilet = (toilet ? toilet + ' ' : '') + '(화장실 정보는 확인 전입니다)';
  return {
    highlights: txt(b.mustSee, ' · '),
    history: txt(b.history),
    route: arr(b.route).join('\n'),
    photoPoint: txt(b.photoPoints),
    toilet,
    details: lines.join('\n'),
    source: b.verifiedAt ? '여행사 자료 · ' + b.verifiedAt + ' 확인' : '여행사 자료'
  }
}

function convertLegacy(o) {
  let t = o.trip || {},
    dests = arr(o.destinations),
    dest = dests.find(x => x.tz && x.tz !== 'America/New_York') || dests[0] || {},
    guides = {},
    daysByDate = new Map();
  let tzForCity = city => {
    if (!city) return '';
    let hit = dests.find(x => x.city && (String(city).includes(x.city) || x.city.includes(String(city))));
    return hit?.tz || ''
  };
  /* 일자 시간대: 원본의 d.tz가 실제 이벤트와 다를 때(예: 출발일이 Madrid로 적혀 있지만
     실제 일정은 필라델피아) 이벤트 다수설을 따릅니다. */
  let dayTzOf = d => {
    let evTz = arr(d.events).map(e => e.tz).filter(Boolean),
      counts = new Map();
    for (let z of evTz) counts.set(z, (counts.get(z) || 0) + 1);
    let top = [...counts.entries()].sort((a, b) => b[1] - a[1])[0];
    if (top && top[1] > evTz.length / 2) return top[0];
    return d.tz || tzForCity(d.city || '') || dest.tz || 'America/New_York'
  };
  let days = arr(o.days).map(d => {
    let city = d.city || '',
      dz = dayTzOf(d);
    let day = {
      date: d.date || '',
      label: d.label || '',
      city,
      country: d.country || '',
      tz: dz,
      origTz: d.tz || '',
      currency: d.currency || dest.currency || '',
      lat: d.lat ?? '',
      lon: d.lon ?? '',
      meals: arr(d.meals),
      hotel: d.hotel || null,
      notes: arr(d.notes),
      alerts: arr(d.alerts),
      events: []
    };
    for (let e of arr(d.events)) {
      let eid = id();
      guides[eid] = guideFromBrief(e);
      day.events.push({
        id: eid,
        time: e.time || '',
        endTime: e.endTime || '',
        title: e.title || e.name || '제목 미입력',
        place: e.place || '',
        note: typeof e.note === 'string' ? e.note : (e.description || ''),
        sourceDetail: '',
        transfer: typeof e.transfer === 'string' ? e.transfer : '',
        flight: typeof e.flight === 'string' ? e.flight : '',
        airport: typeof e.airport === 'string' ? e.airport : '',
        ticket: typeof e.ticket === 'string' ? e.ticket : '',
        hotel: typeof e.hotel === 'string' ? e.hotel : '',
        city: e.city || '',
        tz: e.tz || dz,
        done: false
      })
    }
    daysByDate.set(day.date, day);
    return day
  });
  let dayFor = date => {
    let d = daysByDate.get(date);
    if (!d) {
      d = {
        date,
        label: '',
        city: '',
        country: '',
        tz: dest.tz || 'America/New_York',
        currency: dest.currency || '',
        lat: '',
        lon: '',
        meals: [],
        hotel: null,
        notes: [],
        alerts: [],
        events: []
      };
      daysByDate.set(date, d);
      days.push(d)
    }
    return d
  };
  for (let f of arr(t.flights)) {
    let date = String(f.departAt || '').slice(0, 10),
      day = dayFor(date),
      fz = AIRPORT_TZ[f.from] || day.tz;
    day.events.push({
      id: id(),
      time: String(f.departAt || '').slice(11, 16),
      title: (f.flightNo || '항공편') + ' ' + (f.from || '') + ' → ' + (f.to || ''),
      place: f.fromName || f.from || '',
      note: '도착 ' + (f.arriveAt || '확인 필요'),
      flight: [f.airline, f.flightNo, f.from + ' → ' + f.to, '출발 ' + f.departAt, '도착 ' + f.arriveAt, '터미널 ' + (f.terminalFrom || '확인 필요')].filter(Boolean).join(' · '),
      airport: f.terminalFrom || '',
      ticket: '원본 예약 문서 확인',
      tz: fz,
      done: false
    })
  }
  for (let h of arr(o.hotels)) {
    let date = String(h.checkin || h.from || '').slice(0, 10),
      day = daysByDate.get(date);
    if (!day) continue;
    day.events.push({
      id: id(),
      time: '',
      title: '숙소 · ' + (h.name || '호텔'),
      hotel: [h.name, h.address, h.phone ? '전화 ' + h.phone : '', h.checkin ? '체크인 ' + h.checkin : '', h.checkout ? '체크아웃 ' + h.checkout : ''].filter(Boolean).join(' · '),
      note: '원본 숙소 자료와 확인하세요',
      city: h.city || '',
      tz: tzForCity(h.city) || day.tz,
      done: false
    })
  }
  return {
    id: id(),
    seedRef: o.format === 'sk-travel-trip' ? 'spain-2026-10' : '',
    name: t.name || '가져온 여행',
    start: t.start || '',
    end: t.end || '',
    summary: t.destSummary || '',
    city: dest.city || '',
    tz: dest.tz || 'Europe/Madrid',
    currency: dest.currency || '',
    lat: dest.lat ?? '',
    lon: dest.lon ?? '',
    cities: dests.map(x => ({
      city: x.city || '',
      country: x.country || '',
      tz: x.tz || '',
      currency: x.currency || '',
      lat: x.lat ?? '',
      lon: x.lon ?? '',
      from: x.from || '',
      to: x.to || ''
    })),
    days: days.sort((a, b) => a.date.localeCompare(b.date)),
    guides,
    extras: {
      important: arr(o.important),
      notices: arr(o.guides),
      tips: arr(o.tips),
      airports: arr(o.airports),
      transfers: arr(o.transfers),
      hotels: arr(o.hotels),
      expertInfo: arr(o.expertInfo),
      contextPlaces: arr(o.contextPlaces),
      amenities: arr(o.amenities),
      liveSources: arr(o.liveSources),
      infoFeed: arr(o.infoFeed),
      guideNotes: arr(o.guideNotes)
    }
  }
}

/* 이미 저장된(구버전에서 14.5%만 살린) 여행에 원본 자료를 덧붙입니다. 사용자가 고친 값은 건드리지 않습니다. */
function mergeSeed(t, o) {
  if (!t || !o) return false;
  let changed = false;
  if (o.format === 'sk-travel-trip' && !t.seedRef) {
    t.seedRef = 'spain-2026-10';
    changed = true
  }
  let daysByDate = new Map();
  let dests = arr(o.destinations),
    tzForCity = city => {
      let hit = dests.find(x => x.city && city && (String(city).includes(x.city) || x.city.includes(String(city))));
      return hit?.tz || ''
    };
  for (let d of arr(o.days)) {
    daysByDate.set(d.date || '', d);
    let target = (t.days || []).find(x => x.date === d.date);
    if (!target) continue;
    let evTz = arr(d.events).map(e => e.tz).filter(Boolean),
      cnt = new Map();
    for (let z of evTz) cnt.set(z, (cnt.get(z) || 0) + 1);
    let top = [...cnt.entries()].sort((a, b) => b[1] - a[1])[0];
    let suggested = top && top[1] > evTz.length / 2 ? top[0] : (d.tz || tzForCity(target.city) || t.tz);
    if (suggested && target.tz !== suggested) {
      target.tz = suggested;
      changed = true
    }
    if (target.lat === undefined || target.lat === '') {
      if (d.lat != null) {
        target.lat = d.lat;
        target.lon = d.lon;
        changed = true
      }
    }
    if (!target.meals?.length && arr(d.meals).length) {
      target.meals = arr(d.meals);
      changed = true
    }
    if (!target.hotel && d.hotel) {
      target.hotel = d.hotel;
      changed = true
    }
    if (!target.alerts?.length && arr(d.alerts).length) {
      target.alerts = arr(d.alerts);
      changed = true
    }
    if (!target.notes?.length && arr(d.notes).length) {
      target.notes = arr(d.notes);
      changed = true
    }
    if (!target.label && d.label) {
      target.label = d.label;
      changed = true
    }
    for (let e of arr(d.events)) {
      let cand = (target.events || []).filter(x => String(x.title || '').trim() === String(e.title || '').trim() && (x.time || '') === (e.time || ''));
      if (cand.length !== 1) continue;
      let ev = cand[0];
      if (!ev.tz && (e.tz || target.tz)) {
        ev.tz = e.tz || target.tz;
        changed = true
      }
      if (!ev.city && e.city) {
        ev.city = e.city;
        changed = true
      }
      t.guides = t.guides || {};
      let g = t.guides[ev.id] || {};
      let add = guideFromBrief(e);
      let merged = {
        ...add,
        ...g
      };
      if (!g.highlights && add.highlights) {
        merged.highlights = add.highlights;
        changed = true
      }
      if (!g.history && add.history) {
        merged.history = add.history;
        changed = true
      }
      if (!g.route && add.route) {
        merged.route = add.route;
        changed = true
      }
      if (!g.photoPoint && add.photoPoint) {
        merged.photoPoint = add.photoPoint;
        changed = true
      }
      if (!g.toilet && add.toilet) {
        merged.toilet = add.toilet;
        changed = true
      }
      if (!g.details && add.details) {
        merged.details = add.details;
        changed = true
      }
      if (!g.source && add.source) merged.source = add.source;
      if (g !== merged) t.guides[ev.id] = merged
    }
  }
  if (!t.extras) {
    t.extras = {
      important: arr(o.important),
      notices: arr(o.guides),
      tips: arr(o.tips),
      airports: arr(o.airports),
      transfers: arr(o.transfers),
      hotels: arr(o.hotels),
      expertInfo: arr(o.expertInfo),
      contextPlaces: arr(o.contextPlaces),
      amenities: arr(o.amenities),
      liveSources: arr(o.liveSources),
      infoFeed: arr(o.infoFeed),
      guideNotes: arr(o.guideNotes)
    };
    changed = true
  }
  if (!t.cities?.length && dests.length) {
    t.cities = dests.map(x => ({
      city: x.city || '',
      country: x.country || '',
      tz: x.tz || '',
      currency: x.currency || '',
      lat: x.lat ?? '',
      lon: x.lon ?? '',
      from: x.from || '',
      to: x.to || ''
    }));
    changed = true
  }
  return changed
}

function issue(e) {
  if (!e.time || !e.title) return true;
  return /미확인|확인 필요|불확실/.test(String(e.time || '') + ' ' + String(e.title || '') + ' ' + String(e.place || ''))
}

function showReview(t) {
  let num = t.days.reduce((n, d) => n + d.events.filter(issue).length, 0);
  openModal('일정 검토 · 전체 화면', `<div class="alert">🔴 확인할 항목 ${num}건 · 자동 추출은 사실 검증이 아닙니다. 원문을 확인한 뒤 저장하세요.</div>${t.sourceText?`<details><summary>붙여넣은 원문 보기</summary><pre style="white-space:pre-wrap;overflow-wrap:anywhere">${safe(t.sourceText)}</pre></details>`:''}${field('name','여행 이름',t.name)}${field('start','시작일',t.start,'date')}${field('city','도시',t.city)}${field('tz','여행지 시간대',t.tz)}${field('currency','통화',t.currency)}${field('lat','날씨용 위도 (선택)',t.lat||'')}${field('lon','날씨용 경도 (선택)',t.lon||'')}<div id="reviewDays">${t.days.map((d,di)=>reviewDay(d,di)).join('')}</div><div class="toolbar"><button onclick="addDay()">날짜 추가</button><button onclick="saveReview()" class="primary">검토 후 여행 저장</button></div>`)
}

function reviewDay(d, di) {
  return `<details open><summary>${safe(d.date||'날짜 미정')} · ${safe(d.city||'도시 미정')}</summary>${field('date','날짜',d.date,'date')}${field('city','도시',d.city)}<div class="events">${d.events.map((e,ei)=>reviewEvent(e,di,ei)).join('')}</div><button class="soft" onclick="addEvent(${di})">+ 일정 추가</button></details>`
}

function reviewEvent(e, di, ei) {
  return `<details ${issue(e)?'open':''}><summary class="${issue(e)?'warning':''}">${issue(e)?'🔴 확인 필요 · ':''}${safe(e.time||'시간 미정')} ${safe(e.title)}</summary><div class="small">원문과 대조한 뒤 고치세요. 충돌값은 아래 메모에 모두 남기고 확정되지 않은 시간은 비워 두세요.</div>${['time','endTime','title','place','note','transfer','ticket','flight','airport','hotel'].map((k)=>k==='note'||k==='transfer'||['ticket','flight','airport','hotel'].includes(k)?area(k,({time:'시작 시간',endTime:'종료 시간',title:'제목',place:'장소',note:'원문·충돌 후보·변경 내용',transfer:'다음 이동',ticket:'티켓',flight:'항공',airport:'공항',hotel:'숙소'})[k],e[k]||''):field(k,({time:'시작 시간',endTime:'종료 시간',title:'제목',place:'장소'})[k],e[k]||'',k==='time'||k==='endTime'?'time':'text')).join('')}<button class="soft danger" onclick="removeEvent(${di},${ei})">이 일정 삭제</button></details>`
}

function collectReview() {
  let t = pending || editing;
  t.name = $('#modalContent > .field [name=name]')?.value || t.name;
  t.start = $('#modalContent > .field [name=start]')?.value || '';
  t.city = $('#modalContent > .field [name=city]')?.value || '';
  t.tz = $('#modalContent > .field [name=tz]')?.value || '';
  t.currency = $('#modalContent > .field [name=currency]')?.value || '';
  t.lat = $('#modalContent > .field [name=lat]')?.value || '';
  t.lon = $('#modalContent > .field [name=lon]')?.value || '';
  $('#reviewDays').querySelectorAll(':scope > details').forEach((el, di) => {
    let d = t.days[di];
    d.date = el.querySelector(':scope > .field [name=date]').value;
    d.city = el.querySelector(':scope > .field [name=city]').value;
    el.querySelectorAll(':scope > .events > details').forEach((row, ei) => {
      let e = d.events[ei];
      row.querySelectorAll('[name]').forEach(f => e[f.name] = f.value)
    })
  });
  return t
}

function addDay() {
  let t = collectReview();
  t.days.push({
    date: '',
    city: t.city,
    events: []
  });
  showReview(t)
}

function addEvent(di) {
  let t = collectReview();
  t.days[di].events.push({
    id: id(),
    title: '새 일정',
    time: '',
    done: false
  });
  showReview(t)
}

function removeEvent(di, ei) {
  if (!confirm('일정을 삭제할까요? 연결된 가이드는 따로 확인해야 합니다.')) return;
  let t = collectReview();
  t.days[di].events.splice(ei, 1);
  showReview(t)
}

function saveReview() {
  let t = collectReview();
  if (!t.name.trim() || !t.days.length || t.days.some(d => !/^\d{4}-\d\d-\d\d$/.test(d.date))) return alert('여행 이름과 각 날짜(YYYY-MM-DD)를 확인하세요.');
  try {
    new Intl.DateTimeFormat('ko', {
      timeZone: t.tz
    })
  } catch {
    return alert('여행지 시간대가 올바르지 않습니다. 예: Europe/Madrid')
  }
  if (pending && db.trips.length >= 4) return alert('여행은 최대 4개입니다. 먼저 백업/삭제하세요.');
  if (pending) {
    db.trips.push(t);
    db.active = t.id
  } else {
    t.edited = true;
    let idx = db.trips.findIndex(x => x.id === t.id);
    db.trips[idx] = t
  }
  persist();
  pending = null;
  editing = null;
  closeModal();
  tab = 'home';
  reset()
}

function editTrip(i) {
  editing = clone(db.trips.find(x => x.id === i));
  pending = null;
  showReview(editing);
}

function startRehearsal() {
  let t = trip(),
    x = $('#rehearsalInput').value;
  if (!t || !x) return alert('여행과 날짜·시각을 선택하세요.');
  let d = new Date(x + ':00Z');
  if (isNaN(d)) return alert('날짜를 확인하세요.');
  let delta = 0;
  try {
    let parts = new Intl.DateTimeFormat('en-US', {
      timeZone: t.tz,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23'
    }).formatToParts(d);
    let p = Object.fromEntries(parts.map(z => [z.type, z.value]));
    delta = Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute) - d.getTime()
  } catch {}
  rehearsal = d.getTime() - delta;
  viewId = null;
  tab = 'home';
  render()
}

function makePrompt() {
  let t = trip();
  if (!t) return alert('먼저 여행을 선택하세요.');
  let data = {
    format: 'sk-guide-request',
    version: 1,
    trip: {
      name: t.name,
      city: t.city,
      timezone: t.tz
    },
    events: all().map(({
      d,
      e
    }) => ({
      eventId: e.id,
      date: d.date,
      time: e.time,
      city: d.city,
      title: e.title,
      place: e.place,
      next: all()[all().findIndex(x => x.e.id === e.id) + 1]?.e.title || ''
    }))
  };
  let prompt = `당신은 여행 현장 조사 담당입니다. 첨부한 일정 JSON의 eventId를 절대로 바꾸지 마세요. 각 일정에 대해 실제 장소 사진 1~3장만 조사하세요. AI 생성/합성 사진은 금지합니다. 첫 사진은 가능한 경우 정확한 방문객 입구 또는 식당 현관·간판이어야 합니다. 사진마다 실제 이미지 파일 또는 원본 URL, 출처 URL, 확인일, '사진에서 확인할 것'을 제공하세요. 저작권과 이용 조건을 확인하세요. 볼거리 2~3개, 역사적 의미, 현장 관람 순서, 사진 포인트, 다음 장소 이동 방법·시간, 가장 유용한 화장실 위치·무료/유료/입장객 전용 여부·이용 조건·공식 출처·확인일을 조사하세요. 모르면 '미확인'이라고 적고 꾸며내지 마세요. JSON 결과 형식은 {"format":"sk-guide-v1","items":[{"eventId":"원본 ID","highlights":"...","history":"...","route":"...","photoPoint":"...","toilet":"위치·요금·조건·출처·확인일","details":"...","photos":[{"url":"실제 사진 원본 URL","caption":"현장 확인 내용","source":"출처 URL","verifiedAt":"YYYY-MM-DD"}]}]} 입니다. 앱은 외부 URL 사진을 자동 저장하지 않으므로 사진 파일은 사용자가 확인 후 직접 첨부합니다. ZIP 자동 생성·다운로드를 할 수 없다면 결과 JSON만 생성해 주세요. 홈 첫 화면에는 사진과 핵심 정보만 짧게 보이고 긴 내용은 자세히 보기로 갑니다.\n\n확정 일정 JSON:\n${JSON.stringify(data,null,2)}`;
  openModal('AI 현장 가이드 요청서', `<p class="muted">개인 예약번호는 포함하지 않습니다. 복사해 다른 AI에 전달하세요. 결과는 JSON 파일로 내려받아 이 앱에서 검토합니다.</p><label class="field">AI 요청서<textarea name="prompt" style="min-height:65vh;width:100%;font-size:var(--type-body);line-height:1.6">${safe(prompt)}</textarea></label><button class="primary" onclick="navigator.clipboard.writeText($('#modalContent textarea').value).then(()=>alert('복사했습니다')).catch(()=>alert('복사 실패: 텍스트를 직접 선택하세요'))">요청서 복사</button> <button class="soft" onclick="download('AI_요청서.txt',$('#modalContent textarea').value,'text/plain')">텍스트 파일 저장</button>`)
}

function importGuide() {
  let t = trip();
  if (!t) return alert('여행을 선택하세요.');
  openModal('AI 가이드 자료 가져오기', `<p class="muted">요청서로 받은 JSON 파일을 선택하세요. 일정 ID가 일치하는 자료만 검토 화면에 표시합니다. 사진 URL은 자동 다운로드하지 않으며, 실제 사진은 직접 첨부하세요.</p><input type="file" accept="*" onchange="reviewGuideFile(this.files[0])"><div id="guideReview"></div>`)
}
async function reviewGuideFile(f) {
  if (!f) return;
  try {
    let obj = JSON.parse(await f.text());
    if (obj.format !== 'sk-guide-v1' || !Array.isArray(obj.items)) throw Error('sk-guide-v1 형식이 아닙니다');
    let ids = new Set(all().map(x => x.e.id));
    let hit = obj.items.filter(x => ids.has(x.eventId));
    let miss = obj.items.length - hit.length;
    window.guideIncoming = hit;
    $('#guideReview').innerHTML = `<div class="alert">일치 ${hit.length}건 · 미연결 ${miss}건. AI 내용은 사실 검증되지 않았습니다. 일정과 출처를 대조하세요.</div>${hit.map((g,i)=>`<details><summary>${safe(all().find(x=>x.e.id===g.eventId)?.e.title)} · 검토</summary><div class="fact">볼 것: ${safe(g.highlights)}</div><div class="fact">역사: ${safe(g.history)}</div><div class="fact">동선: ${safe(g.route)}</div><div class="fact">화장실: ${safe(g.toilet)}</div><div class="fact">사진 원본 URL: ${safe((g.photos||[]).map(p=>p.url).join(' / ')||'없음')}</div><button class="primary" onclick="applyGuide(${i})">이 일정에 승인·적용</button></details>`).join('')}`;
    if (!hit.length) alert('연결된 일정이 없습니다.')
  } catch (e) {
    alert('가이드 파일 오류: ' + e.message)
  }
}

function applyGuide(i) {
  let g = window.guideIncoming?.[i],
    t = trip();
  if (!g || !t) return;
  let old = t.guides[g.eventId] || {};
  t.guides[g.eventId] = {
    ...old,
    highlights: g.highlights || '',
    history: g.history || '',
    route: g.route || '',
    photoPoint: g.photoPoint || '',
    toilet: g.toilet || '',
    details: g.details || '',
    photoSources: g.photos || [],
    photos: old.photos || []
  };
  persist();
  alert('승인한 자료를 적용했습니다. 실제 사진은 가이드 직접 편집에서 첨부하세요.');
  closeModal();
  render()
}

function editGuide() {
  let t = trip();
  if (!t) return alert('여행을 선택하세요.');
  openModal('현장 가이드 직접 편집', `<label class="field">일정 선택<select id="guideSelect" onchange="guideForm()">${all().map(x=>`<option value="${safe(x.e.id)}">${safe(x.d.date+' · '+x.e.title)}</option>`).join('')}</select></label><div id="guideForm"></div>`);
  guideForm()
}

function guideForm() {
  let t = trip(),
    eid = $('#guideSelect').value,
    g = t.guides[eid] || {};
  $('#guideForm').innerHTML = `${area('highlights','꼭 볼 것',g.highlights)}${area('history','역사적 의미',g.history)}${area('route','관람 순서',g.route)}${area('photoPoint','사진 포인트',g.photoPoint)}${area('toilet','화장실 · 위치/요금/조건/출처/확인일',g.toilet)}${area('details','자세한 관람 안내',g.details)}<div class="card"><b>실제 사진 1~3장</b><p class="small">직접 촬영하거나 사용 허가를 확인한 사진만 첨부하세요. 사진은 기기에서 크기를 줄여 저장합니다. AI 생성 사진 금지.</p>${(g.photos||[]).map((p,i)=>`<div class="row"><img src="${safe(p.data||'data:image/gif;base64,R0lGODlhAQABAAD/ACwAAAAAAQABAAACADs=')}" ${p.id?`data-photoid="${safe(p.id)}"`:''} style="width:75px;height:55px;object-fit:cover" alt="첨부 사진"><button class="soft danger" onclick="removePhoto(${i})">삭제</button></div>`).join('')}<input type="file" id="guidePhoto" accept="image/*" multiple><label class="field">사진에서 확인할 것<input id="photoCaption" placeholder="예: 오른쪽 방문객 입구와 파란 안내판"></label><label class="field">사진 출처<input id="photoSource" placeholder="직접 촬영 또는 출처 URL"></label><label class="field">촬영/확인일<input id="photoVerified" type="date"></label></div><button class="primary" onclick="saveGuide()">가이드 저장</button>`;
  setTimeout(loadPhotosFromDOM, 0);
}

async function removePhoto(i) {
  let t = trip(),
    g = t.guides[$('#guideSelect').value];
  if (g && confirm('사진을 삭제할까요?')) {
    let p = g.photos[i];
    if (p && p.id) {
      try {
        await PhotoDB.remove(p.id);
      } catch(e) {}
    }
    g.photos.splice(i, 1);
    persist();
    guideForm()
  }
}
async function preparePhoto(file) {
  let img = await createImageBitmap(file);
  let scale = Math.min(1, 1280 / Math.max(img.width, img.height)),
    canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(img.width * scale));
  canvas.height = Math.max(1, Math.round(img.height * scale));
  canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
  img.close?.();
  return canvas.toDataURL('image/jpeg', .76)
}
async function saveGuide() {
  let t = trip(),
    eid = $('#guideSelect').value,
    prev = t.guides[eid] || {},
    g = {
      ...prev,
      photos: prev.photos || []
    };
  ['highlights', 'history', 'route', 'photoPoint', 'toilet', 'details'].forEach(k => g[k] = $(`#guideForm [name=${k}]`).value);
  let files = [...($('#guidePhoto').files || [])];
  if (g.photos.length + files.length > 3) return alert('사진은 일정당 최대 3장입니다.');
  for (let f of files) {
    if (!f.type.startsWith('image/')) return alert('이미지 파일만 첨부하세요.');
    if (f.size > 15 * 1024 * 1024) return alert('한 사진은 15MB 이하로 줄여 주세요.');
    let data;
    try {
      data = await preparePhoto(f)
    } catch (e) {
      return alert('사진을 처리하지 못했습니다: ' + e.message)
    };
    g.photos.push({
      data,
      caption: $('#photoCaption').value,
      source: $('#photoSource').value,
      verifiedAt: $('#photoVerified').value
    })
  }
  t.guides[eid] = g;
  if (!persist()) return;
  alert('저장했습니다.');
  guideForm()
}

/* ============ 백업 · 복원 (여행 선택식) ============ */
function backupFileName(name, label) {
  let base = String(name || 'SK여행').replace(/[\\/:*?"<>|\s]+/g, '_').slice(0, 28) || 'SK여행',
    d = new Date(),
    pad = n => String(n).padStart(2, '0');
  return base + '_' + (label ? label.replace(/[\\/:*?"<>|\s]+/g, '_').slice(0, 20) + '_' : '') + d.getFullYear() + pad(d.getMonth() + 1) + pad(d.getDate()) + '.json'
}

async function buildBackup(ids, includePhotos = true) {
  let tripsRaw = db.trips.filter(t => ids.includes(t.id));
  if (!tripsRaw.length) return null;
  let trips = clone(tripsRaw);
  for (let t of trips) {
    if (t.guides) {
      for (let eid in t.guides) {
        let g = t.guides[eid];
        if (g.photos) {
          for (let p of g.photos) {
            if (p.id) {
              try {
                let data = includePhotos ? await PhotoDB.get(p.id) : null;
                if (data) p.data = data;
              } catch(e) {}
            }
          }
        }
      }
    }
  }
  if (trips.length === 1) return {
    format: 'sk-guide-trip-backup',
    version: 2,
    exportedAt: new Date().toISOString(),
    trip: trips[0],
    trips: [trips[0]]
  };
  return {
    format: 'sk-guide-backup',
    version: 2,
    exportedAt: new Date().toISOString(),
    db: {
      active: trips[0].id,
      trips
    },
    trips
  }
}

/* 백업 화면: 여행을 골라서 파일로 저장합니다. */
function backupChoose(preId) {
  if (!db.trips.length) return alert('저장된 여행이 없습니다.');
  let pre = preId || db.active;
  openModal('백업할 여행 고르기', `<div class="alert">백업 파일은 암호화되지 않습니다. 예약 정보가 들어 있으니 보관하는 사람만 접근할 수 있게 주의하세요.</div>
<div class="card">
  <h3>1. 여행 선택</h3>
  ${db.trips.map(t=>`<label class="field" style="display:flex;gap:10px;align-items:center"><input type="checkbox" class="bkpTrip" value="${safe(t.id)}" ${t.id===pre?'checked':''} style="width:24px;height:24px;flex:none"><span>${safe(t.name)}<br><span class="small">${safe(t.start||'날짜 없음')} · ${safe(t.city||'')}</span></span></label>`).join('')}
  <button class="soft" onclick="toggleAllBackup()">전체 선택 / 해제</button>
</div>
<div class="card">
  <h3>2. 저장 방법</h3>
  <label class="field" style="display:flex;gap:10px;align-items:center;margin:0 0 10px"><input type="checkbox" id="bkpPhotos" checked style="width:24px;height:24px;flex:none"><span>사진 포함<br><span class="small">꺼두면 사진 없이 파일만 작아집니다.</span></span></label>
  <div class="toolbar">
    <button class="primary" onclick="doSaveBackup()">로컬 저장</button>
  </div>
  <div id="backupHelp" class="small" style="margin-top:10px;">버튼을 누르면 <b>백업 파일(JSON)</b>을 기기에 저장합니다. <b>내 파일 → 다운로드</b>에서 확인하세요.</div>
</div>`);
  let photos = $('#bkpPhotos');
  document.querySelectorAll('.bkpTrip').forEach(x => x.addEventListener('change', refreshBackupPrebuild));
  if (photos) photos.addEventListener('change', refreshBackupPrebuild);
  refreshBackupPrebuild();
}

function selectedBackupIds() {
  return [...document.querySelectorAll('.bkpTrip:checked')].map(x => x.value)
}

function toggleAllBackup() {
  let all = [...document.querySelectorAll('.bkpTrip')],
    on = all.every(x => x.checked);
  all.forEach(x => x.checked = !on)
}

/* 로컬 저장(다운로드) — 예전 버전에서 사라진 전역 함수를 복원했습니다.
   이게 없으면 doSaveBackup()이 ReferenceError로 죽기만 하고 아무 일도 일어나지 않았습니다. */
function download(name, text, type = 'application/json') {
  let a = document.createElement('a'),
    url = URL.createObjectURL(new Blob([text], {
      type
    }));
  a.href = url;
  a.download = name;
  a.style.display = 'none';
  document.body.appendChild(a); /* 화면에 붙여 둔 채 눌러야 일부 브라우저에서 파일 이름이 유지됩니다 */
  a.click();
  setTimeout(() => {
    URL.revokeObjectURL(url);
    a.remove();
  }, 3000)
}

async function currentBackupDraft() {
  let ids = selectedBackupIds();
  if (!ids.length) {
    alert('여행을 하나 이상 선택하세요.');
    return null
  }
  let includePhotos = $('#bkpPhotos') ? $('#bkpPhotos').checked : true,
    obj = await buildBackup(ids, includePhotos);
  if (!obj) {
    alert('선택한 여행을 찾을 수 없습니다.');
    return null
  }
  let trips = obj.trips || [];
  return {
    text: JSON.stringify(obj, null, 2),
    filename: backupFileName(trips.length === 1 ? trips[0].name : 'SK여행', trips.length > 1 ? trips.length + '개여행' : '')
  }
}

/* 백업은 모달을 열거나 선택이 바뀔 때 미리 만들어 둡니다.
   「로컬 저장」을 누르면 확인창 직후 기다림 없이 바로 저장됩니다. */
let backupPrebuild = {
  key: '',
  filename: '',
  text: '',
  file: null,
  building: false
};
let prebuildToken = 0;

function backupKey() {
  let p = $('#bkpPhotos');
  return selectedBackupIds().join(',') + '|' + (p && p.checked ? '1' : '0');
}

async function refreshBackupPrebuild() {
  let key = backupKey(),
    token = ++prebuildToken;
  if (!selectedBackupIds().length) {
    backupPrebuild = {
      key: '',
      filename: '',
      text: '',
      file: null,
      building: false
    };
    return;
  }
  backupPrebuild.building = true;
  let d = null;
  try {
    d = await currentBackupDraft();
  } catch (err) {
    console.error('백업 만들기 실패:', err);
  }
  if (token !== prebuildToken) return; /* 그사이 선택이 바뀌면 최신 요청만 채택 */
  backupPrebuild.building = false;
  if (!d) {
    backupPrebuild = {
      key: '',
      filename: '',
      text: '',
      file: null,
      building: false
    };
    return;
  }
  backupPrebuild = {
    key: key,
    filename: d.filename,
    text: d.text,
    file: null,
    building: false
  };
}

async function doSaveBackup() {
  if (!confirm('로컬 저장하시겠습니까?')) return;
  let key = backupKey(),
    info = $('#backupHelp');
  /* 미리 만들어 둔 게 그대로 유효하면 기다림 없이 바로 저장합니다. */
  if (backupPrebuild.key === key && backupPrebuild.text && !backupPrebuild.building) {
    download(backupPrebuild.filename, backupPrebuild.text);
    haptic(12);
    if (info) info.innerHTML = '파일을 기기에 저장했습니다. <b>내 파일 → 다운로드</b>에서 확인하세요.';
    return;
  }
  /* 선택을 방금 바꾼 경우: 다시 만들고 나서 저장합니다(확인창 뒤라서 await를 써도 됩니다). */
  if (info) info.innerHTML = '백업을 만드는 중입니다…';
  let d = await currentBackupDraft();
  if (!d) return;
  download(d.filename, d.text);
  haptic(12);
  if (info) info.innerHTML = '파일을 기기에 저장했습니다. <b>내 파일 → 다운로드</b>에서 확인하세요.';
  refreshBackupPrebuild();
}

/* ---------- 복원: 파일을 고르고, 그 안의 여행을 다시 선택 ---------- */
let importQueue = [];

function openBackupImport() {
  let i = $('#backupInput');
  if (!i) return alert('파일 선택기를 찾을 수 없습니다.');
  i.value = '';
  i.click()
}

async function restoreFiles(files) {
  if (!files || !files.length) return;
  importQueue = [];
  let errors = [];
  for (let f of [...files]) {
    try {
      let text = await f.text(),
        obj = JSON.parse(text);
      if (obj.format === 'sk-guide-trip-backup') {
        if (!obj.trip || !Array.isArray(obj.trip.days)) throw Error('일정 형식 오류');
        importQueue.push({
          name: obj.trip.name || '이름 없음',
          start: obj.trip.start || '',
          days: obj.trip.days.length,
          trip: obj.trip,
          fileName: f.name
        })
      } else if (obj.format === 'sk-guide-backup') {
        if (!Array.isArray(obj.db?.trips) || !obj.db.trips.length) throw Error('여행 목록 없음');
        for (let t of obj.db.trips) {
          if (!Array.isArray(t.days)) continue;
          importQueue.push({
            name: t.name || '이름 없음',
            start: t.start || '',
            days: t.days.length,
            trip: t,
            fileName: f.name
          })
        }
      } else throw Error('지원하지 않는 백업 파일')
    } catch (e) {
      errors.push(f.name + ': ' + (e.message || '읽기 실패'))
    }
  }
  if (!importQueue.length) return alert('가져올 수 있는 여행이 없습니다.\n\n' + errors.join('\n'));
  showImportPicker(errors)
}

function showImportPicker(errors) {
  openModal('가져올 여행 고르기', `${errors.length?'<div class="alert">읽지 못한 파일이 있습니다.<br>'+safe(errors.join(' / '))+'</div>':''}<p class="muted">백업 파일 안의 여행 중 가져올 것을 고르세요. 기본은 <b>지금 앱의 여행을 그대로 두고 추가</b>하는 방식입니다.</p><div class="card">${importQueue.map((c,i)=>`<label class="field" style="display:flex;gap:10px;align-items:center"><input type="checkbox" class="impTrip" value="${i}" checked style="width:24px;height:24px;flex:none"><span>${safe(c.name)}<br><span class="small">${safe(c.start||'날짜 없음')} · ${c.days}일 · 파일: ${safe(c.fileName)}</span></span></label>`).join('')}</div><div class="toolbar"><button class="primary" onclick="applyImport('add')">지금 여행에 추가</button><button class="soft" onclick="applyImport('replace')">선택한 여행으로 전부 바꾸기</button></div><p class="small">여행은 최대 4개까지 저장됩니다. 추가가 안 되면 기존 여행을 백업한 뒤 삭제하고 다시 시도하세요.</p>`)
}

async function applyImport(mode) {
  let idx = [...document.querySelectorAll('.impTrip:checked')].map(x => Number(x.value));
  if (!idx.length) return alert('가져올 여행을 선택하세요.');
  let picks = idx.map(i => importQueue[i]);
  for (let t of picks) {
    if (t.guides) {
      for (let eid in t.guides) {
        let g = t.guides[eid];
        if (g.photos) {
          for (let p of g.photos) {
            if (p.data && p.data.startsWith('data:')) {
              let pid = 'photo_' + Date.now() + '_' + Math.random().toString(36).substr(2, 5);
              try {
                await PhotoDB.set(pid, p.data);
                p.id = pid;
                delete p.data;
              } catch(e) {}
            }
          }
        }
      }
    }
  }
  if (mode === 'replace') {
    if (picks.length > 4) return alert('여행은 최대 4개입니다.');
    if (!confirm('지금 앱의 여행을 지우고 선택한 ' + picks.length + '개 여행으로 바꿉니다.\n계속할까요? (먼저 현재 여행을 백업하는 것을 권합니다)')) return
  } else if (db.trips.length + picks.length > 4) {
    return alert('여행은 최대 4개입니다.\n지금 ' + db.trips.length + '개 → ' + (db.trips.length + picks.length) + '개가 됩니다.\n기존 여행을 삭제하거나 「전부 바꾸기」를 쓰세요.')
  }
  let next = mode === 'replace' ? {
      active: null,
      trips: []
    } : clone(db),
    added = [];
  for (let p of picks) {
    let t = clone(p.trip);
    if (mode === 'replace' || next.trips.some(x => x.id === t.id)) t.id = id();
    next.trips.push(t);
    added.push(t.name || '여행')
  }
  next.active = next.trips[0] ? next.trips[0].id : null;
  try {
    localStorage.setItem(KEY, JSON.stringify(next))
  } catch {
    return alert('저장 공간이 부족해 복원하지 못했습니다. 사진이 많은 백업이라면 정리 후 다시 시도하세요.')
  }
  db = next;
  vaultSession = null;
  viewId = null;
  weatherKey = '';
  weatherDays = [];
  weatherFetchedAt = 0;
  closeModal();
  render();
  haptic(20);
  alert('복원했습니다: ' + added.join(', ') + '\n일정 탭에서 확인하세요.')
}

/* 예전 함수 이름 호환 */
function restoreAll(f) {
  return restoreFiles(f ? [f] : [])
}

/* Private reservation vault — password is never saved, content is AES-GCM encrypted locally. */
const VAULT_KEY = 'sk-guide-private-v1';
let vaultSession = null;

function vaultData() {
  try {
    return JSON.parse(localStorage.getItem(VAULT_KEY) || 'null')
  } catch {
    return null
  }
}

function vaultBytes(bytes) {
  return btoa(String.fromCharCode(...bytes))
}

function vaultDecode(str) {
  return Uint8Array.from(atob(str), c => c.charCodeAt(0))
}
async function vaultKey(password, salt) {
  const material = await crypto.subtle.importKey('raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveKey']);
  return crypto.subtle.deriveKey({
    name: 'PBKDF2',
    salt,
    iterations: 250000,
    hash: 'SHA-256'
  }, material, {
    name: 'AES-GCM',
    length: 256
  }, false, ['encrypt', 'decrypt'])
}
async function sealVault(text, password) {
  const salt = crypto.getRandomValues(new Uint8Array(16)),
    iv = crypto.getRandomValues(new Uint8Array(12)),
    key = await vaultKey(password, salt),
    body = await crypto.subtle.encrypt({
      name: 'AES-GCM',
      iv
    }, key, new TextEncoder().encode(text));
  return {
    format: 'sk-guide-private-v1',
    salt: vaultBytes(salt),
    iv: vaultBytes(iv),
    body: vaultBytes(new Uint8Array(body))
  }
}
async function unsealVault(box, password) {
  const key = await vaultKey(password, vaultDecode(box.salt)),
    plain = await crypto.subtle.decrypt({
      name: 'AES-GCM',
      iv: vaultDecode(box.iv)
    }, key, vaultDecode(box.body));
  return new TextDecoder().decode(plain)
}
const PRIVATE_NOTE_KEY = 'sk-guide-private-note-local-v1';

function openVault() {
  vaultSession = null;
  if (vaultData()) {
    openModal('기존 암호화 예약정보', `<div class="alert">이전에 비밀번호로 암호화한 정보가 있습니다. 기존 비밀번호로 한 번만 열어야 암호 없이 사용하는 방식으로 바꿀 수 있습니다. 비밀번호 없이 기존 암호문을 해독할 수는 없습니다.</div><label class="field">기존 비밀번호<input type="password" id="vaultPassword"></label><button class="primary" onclick="unlockVault()">열고 암호 없는 방식으로 변경</button><button class="soft" onclick="exportVault()">기존 암호화 파일 백업</button>`);
    return
  }
  showVaultEditor()
}
async function unlockVault() {
  let pass = $('#vaultPassword')?.value;
  if (!pass) return alert('기존 비밀번호를 입력하세요.');
  try {
    let text = await unsealVault(vaultData(), pass);
    if (!confirm('기존 내용을 암호 없이 이 브라우저에 저장할까요? 같은 기기의 브라우저를 열 수 있는 사람이 볼 수 있습니다.')) return;
    localStorage.setItem(PRIVATE_NOTE_KEY, text);
    localStorage.removeItem(VAULT_KEY);
    showVaultEditor()
  } catch {
    alert('기존 비밀번호가 다르거나 파일이 손상되었습니다.')
  }
}

function showVaultEditor() {
  openModal('개인 예약정보', `<div class="alert">비밀번호 없이 바로 열립니다. 이 브라우저에 암호화되지 않은 상태로 저장되므로 기기·브라우저 접근자에게 보일 수 있습니다. 공개 일정·AI 요청서·일반 백업에는 넣지 않습니다. 브라우저 데이터를 지우면 사라질 수 있습니다.</div><label class="field">개인 예약 메모<textarea id="vaultText" style="min-height:48vh">${safe(localStorage.getItem(PRIVATE_NOTE_KEY)||'')}</textarea></label><label class="field">암호로 잠그기 (선택 · 4자 이상)<input type="password" id="vaultPass" placeholder="비워두고 저장하면 암호 없이 저장됩니다" autocomplete="new-password"></label><button class="primary" onclick="saveVault()">암호 없이 저장</button> <button class="soft" onclick="saveVaultSealed()">암호 걸어 저장</button> <button class="soft" onclick="clearPrivateNote()">내용 삭제</button> <button class="soft" onclick="importVault()">예전 암호화 백업 가져오기</button><input id="vaultImport" type="file" accept="*" hidden onchange="restoreVault(this.files[0])">`)
}

function saveVault() {
  localStorage.setItem(PRIVATE_NOTE_KEY, $('#vaultText').value);
  localStorage.removeItem(VAULT_KEY);
  alert('이 브라우저에 암호 없이 저장했습니다.');
  closeModal()
}

/* 암호를 걸어 저장: 기존 AES-GCM 볼트(VAULT_KEY)에 암호문으로 기록합니다. */
async function saveVaultSealed() {
  let pass = $('#vaultPass')?.value || '';
  if (pass.length < 4) return alert('암호를 4자 이상 입력하세요.');
  try {
    let box = await sealVault($('#vaultText').value, pass);
    localStorage.setItem(VAULT_KEY, JSON.stringify(box));
    localStorage.removeItem(PRIVATE_NOTE_KEY);
    alert('암호를 걸어 이 기기에 저장했습니다. 다음부터는 암호 입력 화면이 열립니다.');
    closeModal()
  } catch (e) {
    alert('암호화에 실패했습니다: ' + (e?.message || e))
  }
}

function clearPrivateNote() {
  if (!confirm('개인 예약 메모를 이 브라우저에서 삭제할까요?')) return;
  localStorage.removeItem(PRIVATE_NOTE_KEY);
  closeModal()
}

function exportVault() {
  let box = vaultData();
  if (!box) return alert('저장된 보관함이 없습니다.');
  download('SK여행_개인정보_암호화백업.json', JSON.stringify(box, null, 2));
  alert('암호화 보관함 파일을 다운로드했습니다. 비밀번호를 잊으면 복원할 수 없습니다.')
}

function importVault() {
  $('#vaultImport').click()
}
async function restoreVault(f) {
  if (!f) return;
  try {
    let v = JSON.parse(await f.text());
    if (v.format !== 'sk-guide-private-v1' || !v.salt || !v.iv || !v.body) throw Error('보관함 파일이 아닙니다.');
    if (!confirm('기존 보관함을 이 파일로 바꿀까요? 기존 보관함 파일을 먼저 백업하세요.')) return;
    localStorage.setItem(VAULT_KEY, JSON.stringify(v));
    vaultSession = null;
    openVault()
  } catch (e) {
    alert('복원 실패: ' + e.message)
  }
}
const TYPEKEY = 'sk-guide-type-v1';
let typography = {
  title: 24,
  subtitle: 21,
  body: 18,
  spacing: 0,
  lineHeight: 1.2
};
try {
  let saved = JSON.parse(localStorage.getItem(TYPEKEY) || '{}');
  if ((saved.body === 17 && saved.spacing === 0.2) || (saved.body === 18 && saved.spacing === -1)) saved = {};
  typography = {
    ...typography,
    ...saved
  }
} catch {}

function applyTypography() {
  let root = document.documentElement;
  for (let k of ['title', 'subtitle', 'body']) root.style.setProperty('--type-' + k, typography[k] + 'px');
  root.style.setProperty('--type-spacing', typography.spacing + 'px');
  root.style.setProperty('--type-line-height', typography.lineHeight);
}

function openTypography() {
  openModal('글자 보기 설정', `<p class="muted">변경 즉시 적용됩니다. 편하게 읽히는 크기를 선택하세요.</p>${[['title','큰 제목',20,34,1],['subtitle','소제목',17,29,1],['body','본문·버튼',15,27,1],['spacing','글자 사이 간격',-2,2,0.1],['lineHeight','줄 간격 (배율)',1.2,2.2,0.05]].map(([key,label,min,max,step])=>`<label class="field">${label} <output id="out-${key}">${typography[key]}</output>${key==='spacing'?'px':key==='lineHeight'?'배':'px'}<input type="range" min="${min}" max="${max}" step="${step}" value="${typography[key]}" oninput="setType('${key}',this.value)"></label>`).join('')}<button class="soft" onclick="typography={title:24,subtitle:21,body:18,spacing:0,lineHeight:1.2};localStorage.setItem(TYPEKEY,JSON.stringify(typography));applyTypography();openTypography()">기본값으로</button>`)
}

function setType(key, val) {
  typography[key] = Number(val);
  localStorage.setItem(TYPEKEY, JSON.stringify(typography));
  $('#out-' + key).textContent = val;
  applyTypography()
}
async function checkVersion() {
  let el = $('#versionNotice');
  if (!el) return;
  try {
    let r = await fetch('version.json?now=' + Date.now(), {
      cache: 'no-store'
    });
    if (!r.ok) throw Error();
    let data = await r.json();
    el.textContent = data.version === APP_VERSION ? '현재 최신 버전 ' + APP_VERSION + '입니다.' : '새 버전 ' + safe(data.version) + '이 나왔습니다. GitHub 파일을 갱신하고 앱을 새로고침하세요.'
  } catch {
    el.textContent = '오프라인 또는 버전 파일을 확인할 수 없습니다.'
  }
}
const MERGE_FLAG = 'sk-guide-seed-merged-v1';
async function seedTrips() {
  let needsSeed = !db.trips.length && !localStorage.getItem(SEED_FLAG);
  let needsMerge = !needsSeed && !localStorage.getItem(MERGE_FLAG) && db.trips.some(t => !t.extras || !t.guides || !Object.keys(t.guides).length);
  if (!needsSeed && !needsMerge) return;
  try {
    let r = await fetch('spain-trip-data.json', {
      cache: 'no-cache'
    });
    if (!r.ok) return;
    let raw = await r.json();
    if (needsSeed) {
      let t = convertLegacy(raw);
      db.trips = [t];
      db.active = t.id;
      if (persist()) try {
        localStorage.setItem(SEED_FLAG, '1');
        localStorage.setItem(MERGE_FLAG, '1')
      } catch {}
      return
    }
    let changed = false;
    for (let t of db.trips) changed = mergeSeed(t, raw) || changed;
    if (changed) persist();
    try { localStorage.setItem(MERGE_FLAG, '1') } catch {}
  } catch {}
}

function showUpdateBanner(reg) {
  if ($('#swUpdate')) return;
  let el = document.createElement('div');
  el.className = 'sw-update';
  el.id = 'swUpdate';
  el.innerHTML = '<span>새 버전이 준비되었습니다.</span><button type="button" onclick="applyUpdate()">새로고침</button>';
  document.body.appendChild(el);
  window.__swReg = reg
}

async function applyUpdate() {
  let reg = window.__swReg;
  try {
    if (reg?.waiting) reg.waiting.postMessage({
      type: 'SKIP_WAITING'
    });
  } catch {}
  location.reload()
}

function registerSW() {
  if (!('serviceWorker' in navigator) || location.protocol === 'file:') return;
  navigator.serviceWorker.register('sw.js').then(reg => {
    if (reg.waiting) showUpdateBanner(reg);
    reg.addEventListener('updatefound', () => {
      let sw = reg.installing;
      sw?.addEventListener('statechange', () => {
        if (sw.state === 'installed' && navigator.serviceWorker.controller) showUpdateBanner(reg)
      })
    });
    setTimeout(() => reg.update().catch(() => {}), 3000)
  }).catch(() => {});
  navigator.serviceWorker.addEventListener('controllerchange', () => {})
}

function initialTab() {
  let h = (location.hash || '').replace('#', '');
  return TABS.includes(h) ? h : 'home'
}

async function init() {
  tab = initialTab();
  // Do critical UI first
  render();
  
  // Non-blocking initialization
  setTimeout(async () => {
    try {
      let r = await fetch('schedule-day-source.json');
      if (r.ok) seedDaySource = await r.json()
    } catch {}
    await seedTrips();
    await migratePhotos();
    if (db.trips.length > 0) render(); // re-render if trips were seeded or photos migrated
    
    syncHistory();
    checkStorage();
    try {
      wakeWanted = localStorage.getItem('sk-wake') === '1'
    } catch {}
    if (wakeWanted) acquireWake();
    registerSW();
  }, 10);
}

async function migratePhotos() {
  let changed = false;
  for (let t of db.trips) {
    if (isSeedTrip(t)) {
      if (t.days[0] && t.days[0].events[0] && !t.days[0].events[0].flight) {
        t.days[0].events[0].flight = "AA742 · PHL 출발 19:25 · BCN 도착 09:05 · 터미널 PHL Terminal A-West\n\nAA259 · LIS 출발 10:55 · PHL 도착 14:50 · 터미널 LIS Terminal 1";
        changed = true;
      }
    }
    if (!t.guides) continue;
    for (let eid in t.guides) {
      let g = t.guides[eid];
      if (g.photos) {
        for (let p of g.photos) {
          if (p.data && p.data.startsWith('data:')) {
            let pid = 'photo_' + Date.now() + '_' + Math.random().toString(36).substr(2, 5);
            await PhotoDB.set(pid, p.data);
            p.id = pid;
            delete p.data;
            changed = true;
          }
        }
      }
    }
  }
  if (changed) {
    persist();
  }
}

async function loadPhotosFromDOM() {
  let imgs = document.querySelectorAll('img[data-photoid]');
  for (let img of imgs) {
    let pid = img.getAttribute('data-photoid');
    if (pid) {
      try {
        let dataUrl = await PhotoDB.get(pid);
        if (dataUrl) img.src = dataUrl;
      } catch(e) {}
      img.removeAttribute('data-photoid');
    }
  }
}

window.addEventListener('beforeinstallprompt', e => {
  e.preventDefault();
  installPrompt = e
});
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && wakeWanted && !wakeLock) acquireWake()
});
window.addEventListener('hashchange', () => {
  let h = (location.hash || '').replace('#', '');
  if (TABS.includes(h) && h !== tab) {
    tab = h;
    render()
  }
});
init();
setInterval(() => {
  if (tab === 'home') {
    if (viewId && Date.now() - previewAt >= 600000) render();
    else updateClocks();
    if (geoState === 'ok' && geo && Date.now() - geo.at >= 180000) render()
  }
}, 30000);
if ('serviceWorker' in navigator && location.protocol !== 'file:') window.addEventListener('load', () => navigator.serviceWorker.register('sw.js').catch(console.warn));
async function handleScheduleImport(f) {
  if (!f) return;
  if (!f.name.endsWith('.json') && f.type !== 'application/json') {
    return alert('일정 파일은 .json 형식이어야 합니다.');
  }
  try {
    let s = await f.text();
    let obj = JSON.parse(s);
    if (!obj.tripId || !obj.days) {
      return alert('올바른 일정 파일 형식이 아닙니다 (tripId 또는 days 누락).');
    }
    window.__pendingSchedule = obj;
    let flightCount = obj.flight ? obj.flight.length : 0;
    let hotelCount = obj.hotel ? obj.hotel.length : 0;
    let itemCount = obj.days.reduce((n, d) => n + (d.events ? d.events.length : 0), 0);
    
    openModal('일정 가져오기 확인', `
      <div class="card">
        <b>${safe(obj.title||'제목 없음')}</b><br>
        <span class="small">${safe(obj.start||'시작일 미정')} · ${safe(obj.timezone||'시간대 미정')}</span>
      </div>
      <div class="fact">총 ${obj.days.length}일 / 일정 ${itemCount}개</div>
      <div class="fact">항공 ${flightCount}건 / 호텔 ${hotelCount}건</div>
      <div class="toolbar">
        <button class="primary" onclick="applyScheduleImport()">적용</button>
      </div>
      <p class="small">이 작업 전에 현재 앱 데이터 5개를 자동 저장합니다.</p>
    `);
  } catch(e) {
    alert('파일을 읽지 못했습니다: ' + e.message);
  } finally {
    $('#scheduleImportFile').value = '';
  }
}

function applyScheduleImport() {
  let o = window.__pendingSchedule;
  if (!o) return;
  
  // auto snapshot
  saveSnapshot();

  let existing = db.trips.find(x => x.id === o.tripId);
  if (existing) {
    if (!confirm('같은 고유번호(tripId)를 가진 여행이 이미 있습니다.\n기존 여행을 이 파일의 내용으로 덮어쓸까요? (아니오를 누르면 새 여행으로 추가됩니다.)')) {
      existing = null;
      o.tripId = 'trip-' + Date.now();
    }
  }

  if (!existing && db.trips.length >= 4) {
    return alert('여행은 최대 4개까지만 저장할 수 있습니다. 기존 여행을 지우고 다시 시도하세요.');
  }

  let trip = existing || {
    id: o.tripId,
    guides: {},
    extras: {
      important: [], notices: [], tips: [], airports: [], transfers: [], hotels: [],
      expertInfo: [], contextPlaces: [], amenities: [], liveSources: [], infoFeed: [], guideNotes: []
    }
  };

  trip.name = o.title || trip.name;
  trip.start = o.start || trip.start;
  trip.tz = o.timezone || trip.tz;
  trip.days = o.days.map(d => ({
    date: d.date,
    city: d.city || '',
    tz: d.timezone || trip.tz,
    events: (d.events||[]).map(e => {
      let ev = {
        id: e.id || id(),
        time: e.time || '',
        title: e.title || '',
        place: e.place || '',
        note: e.note || ''
      };
      if (e.accordion) {
        ev.details = e.accordion;
      }
      return ev;
    })
  }));
  
  // Apply flight, airport, ticket, hotel (we can just put them into the first day as an event for now?
  // No, the instruction says "항공, 공항, 티켓, 호텔" -> distribute to "항공 탭".
  // Currently flight tab gets data from `all().filter(x=>x.e[k])`. So we attach them to the trip's events.
  // Wait, let's distribute them to the first day's first event, or as standalone events.
  // Better: loop through them and add them as events if they don't exist, or just attach to the first event of the trip.
  if (trip.days.length > 0) {
    let firstEvent = trip.days[0].events[0];
    if (!firstEvent) {
      firstEvent = { id: id(), time:'', title: '정보', place:'', note:'' };
      trip.days[0].events.push(firstEvent);
    }
    if (o.flight) firstEvent.flight = JSON.stringify(o.flight);
    if (o.airport) firstEvent.airport = JSON.stringify(o.airport);
    if (o.ticket) firstEvent.ticket = JSON.stringify(o.ticket);
    if (o.hotel) firstEvent.hotel = JSON.stringify(o.hotel);
  }

  if (o.privateInfo) {
    let currentVault = localStorage.getItem('sk-guide-private') || '';
    currentVault += '\n\n--- [' + (trip.name) + '] 개인정보 ---\n' + o.privateInfo;
    localStorage.setItem('sk-guide-private', currentVault);
  }

  if (!existing) {
    db.trips.push(trip);
  }
  
  db.active = trip.id;
  persist();
  closeModal();
  render();
  alert('일정을 가져왔습니다.');
}

function saveSnapshot() {
  let snaps = JSON.parse(localStorage.getItem('sk-guide-snapshots') || '[]');
  snaps.push({ time: Date.now(), db: clone(db) });
  if (snaps.length > 5) snaps.shift();
  localStorage.setItem('sk-guide-snapshots', JSON.stringify(snaps));
}


async function handleGuideZipImport(f) {
  if (!f) return;
  if (!window.JSZip) {
    alert('ZIP 파일을 풀기 위한 라이브러리가 로드되지 않았습니다.');
    return;
  }
  try {
    let zip = await JSZip.loadAsync(f);
    let guideFile = zip.file('guide.json');
    if (!guideFile) return alert('guide.json 파일이 ZIP 안에 없습니다.');
    let guideJsonText = await guideFile.async('text');
    let g = JSON.parse(guideJsonText);
    
    if (!g.tripId || !g.source) {
      return alert('guide.json에 tripId 또는 source가 없습니다.');
    }

    let t = db.trips.find(x => x.id === g.tripId);
    if (!t) {
      return alert('이 가이드의 tripId(' + g.tripId + ')와 일치하는 여행이 앱에 없습니다. 먼저 일정을 가져오세요.');
    }

    let matchCount = 0;
    let missing = [];
    let realPhotos = 0;
    let aiPhotos = 0;
    let noPhotos = 0;
    
    // Check what matches
    for (let eid in g.events || g) {
      if (eid === 'tripId' || eid === 'source') continue;
      let evList = all(t).map(x => x.e);
      let ev = evList.find(x => x.id === eid);
      if (ev) {
        matchCount++;
        let ge = (g.events ? g.events[eid] : g[eid]) || {};
        if (ge.photos && ge.photos.length) {
          for (let p of ge.photos) {
            if (p.kind === 'real') realPhotos++;
            else if (p.kind === 'ai') aiPhotos++;
            else noPhotos++;
          }
        }
      } else {
        missing.push(eid);
      }
    }

    let totalInGuide = Object.keys(g.events || g).filter(k => k !== 'tripId' && k !== 'source').length;

    window.__pendingGuide = {
      tripId: g.tripId,
      source: g.source,
      zip: zip,
      guideData: g.events || g
    };

    openModal('가이드 가져오기 확인', `
      <div class="card">
        <b>[${safe(g.source)}] 가이드 자료</b><br>
        <span class="small">여행: ${safe(t.name)}</span>
      </div>
      <div class="fact">총 ${totalInGuide}칸 중 <b>${matchCount}칸</b> 일치</div>
      <div class="fact">사진: 실물 ${realPhotos}장 / AI ${aiPhotos}장 / 미확인 ${noPhotos}장</div>
      ${missing.length ? `<div class="fact"><b>일치하지 않은 항목 (무시됨)</b><br><span class="small">${safe(missing.join(', '))}</span></div>` : ''}
      <div class="toolbar">
        <button class="primary" onclick="applyGuideZipImport()">적용</button>
      </div>
      <p class="small">이 작업 전에 현재 앱 데이터 5개를 자동 저장합니다.<br>같은 AI 소스의 기존 가이드는 교체됩니다.</p>
    `);

  } catch(e) {
    alert('ZIP 파일을 읽지 못했습니다: ' + e.message);
  } finally {
    $('#guideZipFile').value = '';
  }
}

async function resizeImageFile(fileData, mimeType) {
  return new Promise((resolve, reject) => {
    let blob = new Blob([fileData], {type: mimeType});
    let url = URL.createObjectURL(blob);
    let img = new Image();
    img.onload = () => {
      let w = img.width;
      let h = img.height;
      if (w > 1280 || h > 1280) {
        if (w > h) { h = Math.round(h * (1280 / w)); w = 1280; }
        else { w = Math.round(w * (1280 / h)); h = 1280; }
      }
      let canvas = document.createElement('canvas');
      canvas.width = w; canvas.height = h;
      let ctx = canvas.getContext('2d');
      ctx.drawImage(img, 0, 0, w, h);
      let dataUrl = canvas.toDataURL('image/jpeg', 0.85);
      URL.revokeObjectURL(url);
      resolve(dataUrl);
    };
    img.onerror = reject;
    img.src = url;
  });
}

async function applyGuideZipImport() {
  let pg = window.__pendingGuide;
  if (!pg) return;

  saveSnapshot();
  
  let t = db.trips.find(x => x.id === pg.tripId);
  if (!t) return;
  if (!t.guides) t.guides = {};

  let changed = 0;
  let guideData = pg.guideData;

  for (let eid in guideData) {
    if (eid === 'tripId' || eid === 'source') continue;
    let ev = all(t).find(x => x.e.id === eid);
    if (!ev) continue; // skip unmatched

    if (!t.guides[eid]) t.guides[eid] = {};
    // ensure new structure for legacy elements
    if (t.guides[eid].highlights || t.guides[eid].photos) {
      t.guides[eid] = { legacy: t.guides[eid] };
    }
    
    let item = guideData[eid];
    let finalItem = {
      highlights: item['꼭 볼 것'] || item.highlights || '',
      history: item['왜 중요한가'] || item.history || '',
      route: item['보는 순서'] || item.route || '',
      photoPoint: item['사진 포인트'] || item.photoPoint || '',
      toilet: item['화장실'] || item.toilet || '',
      details: item['알아둘 정보'] || item.details || '',
      photos: []
    };

    if (item.photos && item.photos.length) {
      for (let p of item.photos) {
        if (p.file) {
          let zipFile = pg.zip.file('photos/' + p.file) || pg.zip.file(p.file);
          if (zipFile) {
            try {
              let ext = p.file.split('.').pop().toLowerCase();
              let mime = ext === 'png' ? 'image/png' : 'image/jpeg';
              let rawData = await zipFile.async('uint8array');
              let resizedDataUrl = await resizeImageFile(rawData, mime);
              
              let pid = 'photo_' + Date.now() + '_' + Math.random().toString(36).substr(2, 5);
              await PhotoDB.set(pid, resizedDataUrl);
              
              finalItem.photos.push({
                id: pid,
                kind: p.kind || '',
                caption: p.caption || ''
              });
            } catch(e) {
              console.error('Photo resize error', e);
            }
          }
        }
      }
    }

    t.guides[eid][pg.source] = finalItem;
    changed++;
  }

  persist();
  closeModal();
  render();
  alert(`총 ${changed}개 일정에 가이드를 적용했습니다.`);
}


window.activeGuideSource = null;

function setGuideSource(src) {
  window.activeGuideSource = src;
  render();
}

/* ===== 현장 가이드 표시: 원문은 그대로, 표현만 '훑어보기 쉬운' 단위로 정리 (v1.1) ===== */
function guideChips(text, warn) {
  let s = String(text || '').trim();
  if (!s) return [];
  return s.split(/\s*·\s*/).map(x => x.trim()).filter(Boolean).map(x => `<span${warn ? ' class="warn"' : ''}>${safe(x)}</span>`);
}
function guideRouteItems(text) {
  let raw = String(text || ''),
    lines = raw.split('\n').map(l => l.trim()).filter(Boolean);
  /* 개행 없이 '1. ' '2. '가 여러 개인 한 줄이면 마커 기준으로 쪼갠다 */
  if (lines.length <= 1 && /(?:^|\s)2[.\)]\s/.test(raw)) {
    lines = raw.split(/(?=(?:^|\s)\d+[.\)]\s)/).map(l => l.trim()).filter(Boolean);
  }
  return lines.map(l => l.replace(/^(?:\d+[.\)]|[①-⑳])\s*/, '')).filter(Boolean);
}
function guideDetailRows(text) {
  /* guideFromBrief가 만든 '라벨: 값 / 값 / 값' 줄들을 키-값 행으로 변환 */
  return String(text || '').split('\n').map(l => l.trim()).filter(Boolean).map(line => {
    let m = /^([^:：]{1,40})[:：]\s*(.*)$/.exec(line);
    if (!m) return { k: '기타', vals: [line], warn: false };
    let vals = m[2].split(' / ').map(x => x.trim()).filter(Boolean);
    return { k: m[1], vals: vals.length ? vals : [m[2]], warn: /^(주의|위험|환승 주의|확인 필요)/.test(m[1]) };
  });
}
function guideLine(label, inner) {
  return `<div class="guide-item"><div class="guide-label">${label}</div>${inner}</div>`;
}

function renderGuideBlock(t, e) {
  let gAll = t?.guides?.[e?.id] || {};
  
  // Check if this is a legacy guide (properties directly on the object instead of grouped by source)
  let isLegacy = false;
  if (gAll.highlights !== undefined || gAll.history !== undefined || gAll.route !== undefined || 
      gAll.photoPoint !== undefined || gAll.toilet !== undefined || gAll.details !== undefined || 
      gAll.photos !== undefined) {
    isLegacy = true;
  }
  
  let sources = [];
  let guidesBySource = {};
  
  if (isLegacy) {
    guidesBySource['AI 조사 자료'] = gAll;
    sources.push('AI 조사 자료');
  } else {
    guidesBySource = gAll;
    sources = Object.keys(gAll);
  }

  let src = window.activeGuideSource;
  if (!src || !sources.includes(src)) src = sources.length ? sources[0] : null;
  let g = src ? guidesBySource[src] : {};

  let chipHtml = sources.length > 0 ? `<div class="toolbar" style="margin-bottom:10px">` + sources.map(s => `<button class="${s===src?'primary':'soft'}" onclick="setGuideSource('${s}')">[${s}]</button>`).join('') + `</div>` : '';

  let photoBadge = (kind) => {
    if (kind === 'real') return `<span class="pill" style="background:#d4edda;color:#0f5132">실물 사진 (AI 표기)</span>`;
    if (kind === 'ai') return `<span class="pill" style="background:#fff3cd;color:#856404;border:1px solid #ffeeba;background:#fff3cd;color:#856404;background:#fff8e1;color:#856404;background:#ffe5b4;color:#e65100">AI 생성 참고 이미지</span>`;
    return `<span class="pill" style="background:#e2e3e5;color:#383d41">출처 미확인</span>`;
  };

  let photosHtml = '';
  if ((g.photos||[]).length) {
    let p = g.photos[0];
    photosHtml = `
      <img id="heroPhoto" class="photo" src="${safe(p.data||'data:image/gif;base64,R0lGODlhAQABAAD/ACwAAAAAAQABAAACADs=')}" ${p.id?`data-photoid="${safe(p.id)}"`:''} alt="${safe(p.caption||'실제 장소 사진')}">
      <div style="margin-top:-35px;margin-left:10px;position:relative;z-index:2">${photoBadge(p.kind)}</div>
      <div class="thumbs" style="margin-top:20px">${g.photos.map((p,k)=>`<img src="${safe(p.data||'data:image/gif;base64,R0lGODlhAQABAAD/ACwAAAAAAQABAAACADs=')}" ${p.id?`data-photoid="${safe(p.id)}"`:''} alt="${safe(p.caption||'사진 '+(k+1))}" onclick="changePhoto(${k}, '${safe(src)}')">`).join('')}</div>
      <div id="photoCaption" class="fact" style="margin-top:10px">${safe(p.caption||'현장 확인 사진')}</div>
      <div class="small">출처: ${safe(p.source||'미확인')} · 확인일: ${safe(p.verifiedAt||'미확인')}</div>
    `;
  } else {
    photosHtml = `<div class="emptyPhoto">가이드 사진 자료가 없습니다.</div>`;
  }

  let hg = guideChips(g.highlights);
  let routeItems = guideRouteItems(g.route);
  let detailRows = guideDetailRows(g.details);
  let miss = `<p class="muted" style="margin-top:6px">가이드 자료 미입력</p>`;
  let textHtml = `
    ${guideLine('👀 꼭 볼 것', hg.length ? `<div class="guide-chips">${hg.join('')}</div>` : miss)}
    ${guideLine('💡 왜 중요한가', (g.history||'').trim() ? `<p>${safe(String(g.history).trim())}</p>` : miss)}
    ${guideLine('🧭 보는 순서', routeItems.length ? `<ol>${routeItems.map(x => `<li>${safe(x)}</li>`).join('')}</ol>` : miss)}
    ${guideLine('📷 사진 포인트', (g.photoPoint||'').trim() ? `<p>${safe(String(g.photoPoint).trim())}</p>` : miss)}
    ${guideLine('🚻 화장실', (g.toilet||'').trim() ? `<p>${safe(String(g.toilet).trim())}</p>` : miss)}
    ${detailRows.length ? `<details class="guide-more"><summary>알아둘 정보 자세히 보기</summary><dl class="guide-kv">${detailRows.map(r => `<dt>${safe(r.k)}</dt><dd><div class="guide-chips" style="margin-top:0">${r.vals.map(v => `<span${r.warn ? ' class="warn"' : ''}>${safe(v)}</span>`).join('')}</div></dd>`).join('')}</dl></details>` : ''}
    <div class="guide-source">출처: ${safe(g.source || '미확인')} · 화면의 구분·순서만 정리했고, 내용은 원자료 그대로입니다.</div>
  `;

  return chipHtml + photosHtml + textHtml;
}
