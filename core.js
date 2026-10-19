/* SK-여행 v3 · 핵심 로직 (화면과 무관한 순수 함수)
   브라우저에서는 window.SKCore 로, Node 테스트에서는 require()로 사용합니다. */
(function (root) {
  'use strict';

  var APP_VERSION = 'v3.0';
  var SCHEMA_VERSION = 1;
  var HOME_TZ_DEFAULT = 'America/New_York';
  var SOURCES = ['paper', 'web', 'check'];
  var WD = ['일', '월', '화', '수', '목', '금', '토'];
  var DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

  function pad2(n) { return String(n).padStart(2, '0'); }
  function str(v) { return v == null ? '' : String(v).trim(); }

  function isValidDate(s) {
    if (typeof s !== 'string' || !DATE_RE.test(s)) return false;
    var p = s.split('-').map(Number);
    var dt = new Date(Date.UTC(p[0], p[1] - 1, p[2]));
    return dt.getUTCFullYear() === p[0] && dt.getUTCMonth() === p[1] - 1 && dt.getUTCDate() === p[2];
  }

  // "9:05" -> "09:05", 범위가 아니면 빈 문자열
  function normTime(v) {
    var m = str(v).match(/^(\d{1,2}):(\d{2})$/);
    if (!m) return '';
    var h = +m[1], mi = +m[2];
    if (h > 23 || mi > 59) return '';
    return pad2(h) + ':' + pad2(mi);
  }

  function isValidTz(tz) {
    if (typeof tz !== 'string' || !tz) return false;
    try { new Intl.DateTimeFormat('en-US', { timeZone: tz }); return true; } catch (e) { return false; }
  }

  function addDays(iso, n) {
    var p = iso.split('-').map(Number);
    return new Date(Date.UTC(p[0], p[1] - 1, p[2] + n)).toISOString().slice(0, 10);
  }

  // b - a (일 단위)
  function diffDays(a, b) {
    var pa = a.split('-').map(Number), pb = b.split('-').map(Number);
    return Math.round((Date.UTC(pb[0], pb[1] - 1, pb[2]) - Date.UTC(pa[0], pa[1] - 1, pa[2])) / 86400000);
  }

  function weekday(iso) {
    var p = iso.split('-').map(Number);
    return WD[new Date(Date.UTC(p[0], p[1] - 1, p[2])).getUTCDay()];
  }

  function mdLabel(iso) { return iso.slice(5).replace('-', '/'); }

  // 해당 시간대의 오늘 날짜 (YYYY-MM-DD)
  function todayIn(tz, now) {
    var parts = new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' })
      .formatToParts(new Date(now == null ? Date.now() : now));
    function g(t) { return parts.find(function (p) { return p.type === t; }).value; }
    return g('year') + '-' + g('month') + '-' + g('day');
  }

  // 해당 시간대의 현재 시각 (HH:MM)
  function clockIn(tz, now) {
    return new Intl.DateTimeFormat('en-GB', { timeZone: tz, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })
      .format(new Date(now == null ? Date.now() : now));
  }

  // 여행 상태: before(출발 전) / during(여행 중) / after(종료)
  function tripPhase(trip, now) {
    var today = todayIn(trip.timezone, now);
    if (today < trip.startDate) return { phase: 'before', today: today, daysLeft: diffDays(today, trip.startDate) };
    if (today > trip.endDate) return { phase: 'after', today: today, daysLeft: 0 };
    return { phase: 'during', today: today, dayNo: diffDays(trip.startDate, today) + 1, daysLeft: 0 };
  }

  // 시간 있는 항목은 시간순, 시간 없는 항목은 원래 순서대로 뒤에
  function sortItems(items) {
    return items
      .map(function (it, i) { return { it: it, i: i }; })
      .sort(function (a, b) {
        var ta = a.it.time, tb = b.it.time;
        if (ta && tb) return ta < tb ? -1 : ta > tb ? 1 : a.i - b.i;
        if (ta) return -1;
        if (tb) return 1;
        return a.i - b.i;
      })
      .map(function (x) { return x.it; });
  }

  var MEAL_MAP = { '조': 'breakfast', '중': 'lunch', '석': 'dinner', '아침': 'breakfast', '점심': 'lunch', '저녁': 'dinner' };

  // "중: 현지식" / {type:'lunch', label:'현지식'} 모두 받음
  function normMeal(m) {
    if (typeof m === 'string') {
      var mm = m.match(/^\s*(조|중|석|아침|점심|저녁)\s*[:：]?\s*(.*)$/);
      if (mm) return { type: MEAL_MAP[mm[1]], label: str(mm[2]) };
      return { type: 'other', label: str(m) };
    }
    if (!m || typeof m !== 'object') return null;
    var type = MEAL_MAP[str(m.type)] || str(m.type) || 'other';
    if (!['breakfast', 'lunch', 'dinner', 'other'].includes(type)) type = 'other';
    return { type: type, label: str(m.label || m.text) };
  }

  function normSource(s) { s = str(s); return SOURCES.indexOf(s) >= 0 ? s : 'paper'; }

  function normItem(it) {
    if (typeof it === 'string') return { time: '', endTime: '', title: str(it), detail: '', source: 'paper' };
    if (!it || typeof it !== 'object') return null;
    var title = str(it.title || it.text);
    var detail = str(it.detail);
    if (!detail && Array.isArray(it.details)) detail = it.details.map(str).filter(Boolean).join('\n');
    var time = normTime(it.time);
    var endTime = normTime(it.endTime);
    // "10:00~12:00 구엘 공원" 형태가 title에 들어 있으면 시간 범위로 분리
    var r = title.match(/^(\d{1,2}:\d{2})\s*[~\-–]\s*(\d{1,2}:\d{2})\s+(.*)$/);
    if (r && !time) { time = normTime(r[1]); endTime = normTime(r[2]); title = r[3]; }
    if (!time) {
      var t1 = title.match(/^(\d{1,2}:\d{2})\s+(.*)$/);
      if (t1 && normTime(t1[1])) { time = normTime(t1[1]); title = t1[2]; }
    }
    if (!title && !detail) return null;
    return { time: time, endTime: endTime, title: title, detail: detail, source: normSource(it.source) };
  }

  function normNotes(list) {
    if (!Array.isArray(list)) return [];
    return list.map(function (n) {
      if (typeof n === 'string') return { text: n, source: 'web' };
      return n && str(n.text) ? { text: str(n.text), source: normSource(n.source || 'web') } : null;
    }).filter(Boolean);
  }

  function normHotel(h) {
    if (!h) return null;
    if (typeof h === 'string') return h.trim() ? { name: h.trim(), phone: '', address: '', checkin: '', checkout: '' } : null;
    var name = str(h.name);
    if (!name) return null;
    return { name: name, phone: str(h.phone), address: str(h.address), checkin: normTime(h.checkin), checkout: normTime(h.checkout) };
  }

  function normFlight(f, errors, idx) {
    if (!f || typeof f !== 'object') return null;
    var out = {
      date: str(f.date), flight: str(f.flight), from: str(f.from).toUpperCase(), fromName: str(f.fromName),
      departTime: normTime(f.departTime), to: str(f.to).toUpperCase(), toName: str(f.toName),
      arriveDate: str(f.arriveDate), arriveTime: normTime(f.arriveTime), source: normSource(f.source)
    };
    if (out.date && !isValidDate(out.date)) errors.push('항공편 ' + (idx + 1) + '의 출발 날짜 형식이 맞지 않아요: ' + out.date);
    if (out.arriveDate && !isValidDate(out.arriveDate)) errors.push('항공편 ' + (idx + 1) + '의 도착 날짜 형식이 맞지 않아요: ' + out.arriveDate);
    if (!out.flight && !out.from && !out.to) return null;
    return out;
  }

  // 입력 객체(trip JSON)를 검사하고 정규화합니다.
  // 반환: { ok, errors[], warnings[], trip, days[], flights[], info[], needsCheck[], reservations[] }
  function normalizeTrip(input) {
    var errors = [], warnings = [];
    if (!input || typeof input !== 'object' || Array.isArray(input)) {
      return { ok: false, errors: ['JSON 객체 형식이 아니에요.'], warnings: warnings };
    }
    if (input.kind && input.kind !== 'sk-travel-trip') errors.push('이 파일은 여행 파일이 아니에요 (kind: ' + input.kind + ').');
    var t = input.trip;
    if (!t || typeof t !== 'object') errors.push('여행 정보(trip)가 없어요.');
    t = t || {};

    var trip = {
      name: str(t.name),
      destination: str(t.destination),
      startDate: str(t.startDate),
      endDate: str(t.endDate),
      timezone: str(t.timezone),
      homeTimezone: str(t.homeTimezone) || HOME_TZ_DEFAULT,
      currency: str(t.currency).toUpperCase(),
      location: null
    };
    if (!isValidDate(trip.startDate)) errors.push('출발일(startDate)이 없거나 YYYY-MM-DD 형식이 아니에요.');
    if (!isValidDate(trip.endDate)) errors.push('돌아오는 날(endDate)이 없거나 YYYY-MM-DD 형식이 아니에요.');
    if (isValidDate(trip.startDate) && isValidDate(trip.endDate) && trip.startDate > trip.endDate) {
      errors.push('돌아오는 날이 출발일보다 빨라요.');
    }
    if (!isValidTz(trip.timezone)) errors.push('여행지 시간대(timezone)가 없거나 올바르지 않아요. 예: Europe/Madrid');
    if (!isValidTz(trip.homeTimezone)) { warnings.push('집 시간대가 올바르지 않아 기본값을 씁니다.'); trip.homeTimezone = HOME_TZ_DEFAULT; }
    if (!trip.name) trip.name = (trip.destination || '여행') + ' 여행';
    if (t.location && typeof t.location === 'object') {
      var lat = Number(t.location.lat), lon = Number(t.location.lon);
      if (isFinite(lat) && isFinite(lon) && Math.abs(lat) <= 90 && Math.abs(lon) <= 180) {
        trip.location = { name: str(t.location.name) || trip.destination, lat: lat, lon: lon };
      } else warnings.push('날씨 위치(좌표)가 올바르지 않아 날씨를 표시하지 않아요.');
    }

    var flights = (Array.isArray(input.flights) ? input.flights : [])
      .map(function (f, i) { return normFlight(f, errors, i); }).filter(Boolean);

    var seen = {};
    var days = [];
    (Array.isArray(input.days) ? input.days : []).forEach(function (d, i) {
      if (!d || typeof d !== 'object') return;
      var date = str(d.date);
      if (!isValidDate(date)) { errors.push('일정 ' + (i + 1) + '번의 날짜가 YYYY-MM-DD 형식이 아니에요: ' + date); return; }
      if (seen[date]) { warnings.push(date + ' 날짜가 두 번 있어요. 첫 번째 것만 씁니다.'); return; }
      seen[date] = true;
      var tz = str(d.timezone);
      if (tz && !isValidTz(tz)) { warnings.push(date + ' 시간대가 올바르지 않아 여행 시간대를 씁니다.'); tz = ''; }
      if (date < trip.startDate || date > trip.endDate) warnings.push(date + ' 날짜가 여행 기간(' + trip.startDate + '~' + trip.endDate + ') 밖이에요.');
      var items = (Array.isArray(d.items) ? d.items : (Array.isArray(d.schedule) ? d.schedule : []))
        .map(normItem).filter(Boolean);
      days.push({
        date: date,
        weekday: weekday(date),
        city: str(d.city),
        timezone: tz || trip.timezone,
        title: str(d.title),
        summary: str(d.summary),
        items: sortItems(items),
        meals: (Array.isArray(d.meals) ? d.meals : []).map(normMeal).filter(Boolean),
        hotel: normHotel(d.hotel),
        notes: normNotes(d.notes || d.websiteDiffs).concat(normNotes(
          (Array.isArray(d.needsCheck) ? d.needsCheck : []).map(function (x) { return { text: str(x), source: 'check' }; })
        ))
      });
    });
    days.sort(function (a, b) { return a.date < b.date ? -1 : a.date > b.date ? 1 : 0; });
    if (!days.length) warnings.push('날짜별 일정이 없어요. 나중에 추가할 수 있어요.');

    var info = (Array.isArray(input.info) ? input.info : []).map(function (x) {
      if (!x || typeof x !== 'object') return null;
      var title = str(x.title), body = str(x.body || x.text);
      return title || body ? { title: title, body: body, source: normSource(x.source) } : null;
    }).filter(Boolean);

    var needsCheck = (Array.isArray(input.needsCheck) ? input.needsCheck : []).map(str).filter(Boolean);

    var resRaw = input.reservations;
    var reservations = [];
    if (Array.isArray(resRaw)) {
      reservations = resRaw.map(function (r) {
        if (!r || typeof r !== 'object') return null;
        var label = str(r.label), value = str(r.value);
        return label && value ? { label: label, value: value } : null;
      }).filter(Boolean);
    } else if (resRaw && typeof resRaw === 'object') {
      reservations = Object.keys(resRaw).map(function (k) { return { label: k, value: str(resRaw[k]) }; })
        .filter(function (r) { return r.value; });
    }

    return {
      ok: errors.length === 0,
      errors: errors, warnings: warnings,
      trip: trip, days: days, flights: flights, info: info, needsCheck: needsCheck, reservations: reservations
    };
  }

  // 텍스트(붙여넣기/파일)에서 JSON 객체를 꺼냅니다. ```json 울타리와 앞뒤 설명을 무시합니다.
  function parseTripText(text) {
    var s = str(text);
    if (!s) return { ok: false, error: '내용이 비어 있어요.' };
    var fence = s.match(/```(?:json)?\s*([\s\S]*?)```/i);
    if (fence) s = fence[1].trim();
    var a = s.indexOf('{'), b = s.lastIndexOf('}');
    if (a < 0 || b <= a) return { ok: false, error: 'JSON 객체({ ... })를 찾지 못했어요.' };
    try { return { ok: true, value: JSON.parse(s.slice(a, b + 1)) }; }
    catch (e) { return { ok: false, error: 'JSON 문법 오류: ' + e.message }; }
  }

  // 여행 파일 한 장(JSON)을 앱 저장 형식으로 나눕니다.
  // 여행 정보(trip)와 중요 정보(reservations)는 서로 다른 곳에 저장합니다.
  function importTripText(text) {
    var p = parseTripText(text);
    if (!p.ok) return { ok: false, errors: [p.error], warnings: [] };
    var v = p.value;
    if (v && v.kind === 'sk-travel-backup') return { ok: false, errors: ['백업 파일입니다. 설정 → 백업 복원에서 여세요.'], warnings: [] };
    var n = normalizeTrip(v);
    return n;
  }

  // 백업 파일 만들기 (중요 정보 포함 여부 선택)
  function makeBackup(state) {
    return {
      kind: 'sk-travel-backup',
      schemaVersion: SCHEMA_VERSION,
      app: 'SK-여행',
      appVersion: APP_VERSION,
      savedAt: new Date().toISOString(),
      trip: state.trip || null,
      reservationsIncluded: !!state.includeReservations,
      reservations: state.includeReservations ? (state.reservations || []) : [],
      packing: state.packing || null
    };
  }

  function parseBackup(text) {
    var p = parseTripText(text);
    if (!p.ok) return { ok: false, error: p.error };
    var v = p.value;
    if (!v || v.kind !== 'sk-travel-backup') return { ok: false, error: '백업 파일이 아니에요.' };
    if (!v.trip) return { ok: false, error: '백업 파일에 여행 정보가 없어요.' };
    var n = normalizeTrip({ kind: 'sk-travel-trip', trip: v.trip.trip || v.trip, days: (v.trip.days || []), flights: v.trip.flights || [], info: v.trip.info || [], needsCheck: v.trip.needsCheck || [] });
    if (!n.ok) return { ok: false, error: n.errors.join('\n') };
    return {
      ok: true,
      trip: n,
      reservations: Array.isArray(v.reservations) ? v.reservations : [],
      packing: v.packing || null,
      reservationsIncluded: !!v.reservationsIncluded
    };
  }

  // WMO 날씨 코드 -> 표시용 이모지/문구
  function weatherInfo(code) {
    code = Number(code);
    if (code === 0) return { e: '☀️', t: '맑음' };
    if (code === 1) return { e: '🌤️', t: '대체로 맑음' };
    if (code === 2) return { e: '⛅', t: '구름 조금' };
    if (code === 3) return { e: '☁️', t: '흐림' };
    if (code === 45 || code === 48) return { e: '🌫️', t: '안개' };
    if (code >= 51 && code <= 57) return { e: '🌦️', t: '이슬비' };
    if (code >= 61 && code <= 67) return { e: '🌧️', t: '비' };
    if (code >= 71 && code <= 77) return { e: '❄️', t: '눈' };
    if (code >= 80 && code <= 82) return { e: '🌦️', t: '소나기' };
    if (code >= 85 && code <= 86) return { e: '🌨️', t: '눈 소나기' };
    if (code >= 95) return { e: '⛈️', t: '뇌우' };
    return { e: '·', t: '' };
  }

  function weatherUrl(loc, tz) {
    return 'https://api.open-meteo.com/v1/forecast?latitude=' + loc.lat + '&longitude=' + loc.lon +
      '&daily=weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max' +
      '&timezone=' + encodeURIComponent(tz) + '&forecast_days=16';
  }

  // Open-Meteo 응답에서 시작일부터 7일을 골라냅니다.
  function pickWeek(resp, fromDate, endDate) {
    var d = resp && resp.daily;
    if (!d || !d.time) return [];
    var out = [];
    for (var i = 0; i < d.time.length && out.length < 7; i++) {
      var day = d.time[i];
      if (day < fromDate) continue;
      if (day > endDate) break;
      var w = weatherInfo(d.weather_code[i]);
      out.push({ date: day, max: Math.round(d.temperature_2m_max[i]), min: Math.round(d.temperature_2m_min[i]),
        rain: d.precipitation_probability_max ? d.precipitation_probability_max[i] : null, icon: w.e, text: w.t });
    }
    return out;
  }

  var FX_URL = 'https://api.frankfurter.dev/v1/latest?base=EUR&symbols=KRW';

  // 기본 준비물 (V2.6의 개인 체크리스트를 옮긴 것)
  var PACK_DEFAULT = [
    { title: '1주일 전', items: ['공항 주차장 예약', '비행기 티켓 확인', '여권 유효기간 확인', '여행사 서류 확인', '현금 / 잔돈 환전 (팁용)', "Sam's Club 카드 해외 수수료 확인 (Pin# 확인, 고객센터 번호는 중요 정보)", 'eSIM 구입', '캐나다 여행 시 → eTA 신청'] },
    { title: '3일 전', items: ['USPS Hold Mail 신청', '차 타이어 점검', '차에 Air 넣기', '비상용 Air Tool 확인', 'Ring / Wyze 점검', '감지센서 충전 확인', '차임벨 충전 확인 (무조건 충전)', '물 센서 확인', 'Ring mode & automation > schedule 설정', 'Kasa setup 확인', 'Pepto-Bismol (여행용 3.4 fl oz)', '영양제', '감기약', '애드빌', '파스', '네오스포린', '가려움(Itch) 연고', '멀미약', '안약', '거즈 / 밴드', '물파스 / 물린디', '압박붕대'] },
    { title: '하루 전', items: ['비행기 티켓 최종 확인 (24시간 전 체크인)', '여권', '카드', '면허증', '영주권', '지갑 (허리벨트백 또는 얇은 쌕)', '현금 / 잔돈', '폰 충전코드 3개', '짧은 충전라인', '긴 전기코드', '보조배터리', '시계 충전라인', '이어폰 2개', '노트북 필요 여부 결정', '유럽용 큰 충전기 / 220V 아답터 (해당 시)', '선글라스', '물통', '펜 / 메모지', '폰 충전용 라인 (2개)', '얇은 바람막이', '안대', '슬리퍼 2개', '폰받침대', '폰 & 시계 충전라인', '립밤', '치실', '소독용 물티슈', '인공눈물', '칫솔 / 치약', '작은 머리빗', '영양제', '알콜 스프레이', '여행용 3단 주머니', '안경케이스 / 안경 흘러내림 방지 고무', '마스크', '얇은 쌕', '바람막이 잠바', '우비용 잠바', '조끼', '얇은 내복 (잘 때용)', '운동화 (방수액 미리 뿌리기)', '슬리퍼', '우산', '선크림', '면도기', '밤운전용 안경 (원거리용)', '충전기 / 충전코드', '순애 헤어롤 / 헤어롤 빗', '커튼 집게', '알콜 스프레이', '작은 알콜병 (호텔 침대 소독용)', '여행용 저울', '비닐백 (쓰레기봉투용)', '매직펜 (빨래 / 새것 표시용)', 'Dark 초콜릿', '컵라면 + 휴대용 물끓이는 포트', 'A1 / 홀스래디쉬 소스', '커피믹스', '휴대용 컵', '그릇 2개', '과도'] },
    { title: '떠나는 날 할 일', items: ['메인 수도 잠그기', '돌침대 25°로 설정', 'Deck 폭우 대비 비닐커버 깔기', '에어컨 스케줄 체크', 'Ring / Wyze 최종 작동 확인', '휴대폰 / 손목시계 챙기기', '여권 / 지갑 챙기기'] },
    { title: '여행 종류별 추가 준비물', items: ['편한 운동화', '허리벨트백', '얇은 쌕', '우산', '선글라스', '수영복', '수경', '슬리퍼', '모자', '아쿠아 신발', '비치용 가방', 'Mini board / Kick board', '방수 파우치', '휴대폰 방수 케이스', '선크림', '유럽용 큰 충전기', '220V 아답터', '긴 전기코드', '편한 운동화', '허리벨트백', '커튼 집게', '등산화', '지팡이 2 sets', '우비', '물통', '간식', '응급약 파우치', 'Car phone charger', '전화기 홀더', '차용 110V 아답터', '햇빛가리개', '밤운전용 안경'] }
  ];

  var api = {
    APP_VERSION: APP_VERSION, SCHEMA_VERSION: SCHEMA_VERSION, HOME_TZ_DEFAULT: HOME_TZ_DEFAULT, FX_URL: FX_URL,
    PACK_DEFAULT: PACK_DEFAULT,
    pad2: pad2, isValidDate: isValidDate, normTime: normTime, isValidTz: isValidTz,
    addDays: addDays, diffDays: diffDays, weekday: weekday, mdLabel: mdLabel,
    todayIn: todayIn, clockIn: clockIn, tripPhase: tripPhase, sortItems: sortItems,
    normalizeTrip: normalizeTrip, parseTripText: parseTripText, importTripText: importTripText,
    makeBackup: makeBackup, parseBackup: parseBackup,
    weatherInfo: weatherInfo, weatherUrl: weatherUrl, pickWeek: pickWeek
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.SKCore = api;
})(typeof window !== 'undefined' ? window : globalThis);
