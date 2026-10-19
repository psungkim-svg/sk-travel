/* SK-여행 v3 · 화면 */
(function () {
  'use strict';
  var C = window.SKCore;
  var K = { trip: 'skv3_trip', res: 'skv3_res', pack: 'skv3_pack', html: 'skv3_html', settings: 'skv3_settings', wx: 'skv3_wx', fx: 'skv3_fx' };

  // ---------- 저장소 ----------
  function get(k, d) { try { var v = localStorage.getItem(k); return v ? JSON.parse(v) : d; } catch (e) { return d; } }
  function set(k, v) {
    try { localStorage.setItem(k, JSON.stringify(v)); return true; }
    catch (e) { toast('저장공간이 부족해요. 사진 같은 큰 자료는 지워 주세요.'); return false; }
  }
  function del(k) { try { localStorage.removeItem(k); } catch (e) {} }

  var S = {
    tab: 'home',
    settings: get(K.settings, { fz: 1 }),
    openDays: {},
    openInfo: {},
    revealed: {},
    packOpen: {},
    showHtml: false
  };

  function trip() { return get(K.trip, null); }          // {trip, days, flights, info, needsCheck}
  function resList() { return get(K.res, []); }
  function pack() { return get(K.pack, { checks: {}, custom: [], removed: [] }); }

  // ---------- 공통 ----------
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function $(id) { return document.getElementById(id); }
  function toast(msg) {
    var t = $('toast'); t.innerHTML = '<div class="toast">' + esc(msg) + '</div>';
    clearTimeout(toast._t); toast._t = setTimeout(function () { t.innerHTML = ''; }, 2600);
  }
  function applyFz() { document.body.style.setProperty('--fz', (S.settings.fz || 1)); }
  function tzOffsetMin(tz, now) {
    var p = new Intl.DateTimeFormat('en-US', { timeZone: tz, hourCycle: 'h23', year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: 'numeric', second: 'numeric' }).formatToParts(new Date(now));
    function g(t) { return +p.find(function (x) { return x.type === t; }).value; }
    var asUTC = Date.UTC(g('year'), g('month') - 1, g('day'), g('hour'), g('minute'), g('second'));
    return Math.round((asUTC - now) / 60000);
  }
  function hoursBetween(homeTz, destTz, now) {
    var d = (tzOffsetMin(destTz, now) - tzOffsetMin(homeTz, now)) / 60;
    return (d >= 0 ? '+' : '') + (Math.round(d * 10) / 10) + '시간';
  }
  function dateLabel(iso) { return iso ? Number(iso.slice(5, 7)) + '월 ' + Number(iso.slice(8, 10)) + '일 (' + C.weekday(iso) + ')' : ''; }
  function nowMs() { return Date.now(); }

  // ---------- 모달 ----------
  function openModal(html) { $('modal').innerHTML = '<div class="ov" data-act="ov-bg"><div class="sheet" role="dialog">' + html + '</div></div>'; }
  function closeModal() { $('modal').innerHTML = ''; }

  // ---------- 탭 바 · 머리글 ----------
  var TABS = [
    { id: 'home', e: '🏠', t: '홈' },
    { id: 'schedule', e: '📅', t: '일정' },
    { id: 'pack', e: '✅', t: '준비물' },
    { id: 'res', e: '🔐', t: '중요 정보' },
    { id: 'settings', e: '⚙️', t: '설정' }
  ];
  function renderChrome() {
    var T = trip();
    var sub = T ? (T.trip.destination + ' · ' + T.trip.startDate.slice(5).replace('-', '/') + ' ~ ' + T.trip.endDate.slice(5).replace('-', '/')) : '여행을 등록하면 시작돼요';
    $('hdr').innerHTML = '<div class="t">' + esc(T ? T.trip.name : 'SK-여행') + '</div><div class="s">' + esc(sub) + '</div>';
    $('nav').innerHTML = TABS.map(function (x) {
      return '<button class="' + (S.tab === x.id ? 'on' : '') + '" data-act="tab" data-id="' + x.id + '"><span class="e">' + x.e + '</span>' + x.t + '</button>';
    }).join('');
  }

  function render() {
    renderChrome();
    var v = { home: viewHome, schedule: viewSchedule, pack: viewPack, res: viewRes, settings: viewSettings }[S.tab] || viewHome;
    $('view').innerHTML = v();
    if (S.tab === 'home') loadHomeExtras();
  }

  // ---------- 홈 ----------
  function viewHome() {
    var T = trip();
    if (!T) return emptyCard();
    var ph = C.tripPhase(T.trip, nowMs());
    var homeTz = T.trip.homeTimezone, destTz = T.trip.timezone;
    var phaseText = ph.phase === 'before' ? '출발까지 D-' + ph.daysLeft
      : ph.phase === 'during' ? '여행 ' + ph.dayNo + '일째' : '여행이 끝났어요';
    var html = '';
    html += '<div class="card"><div class="kv">' +
      '<div><div class="muted">집 · 펜실베이니아</div><div class="clk" id="clkHome">' + C.clockIn(homeTz, nowMs()) + '</div><div class="clk-d">' + dateLabel(C.todayIn(homeTz, nowMs())) + '</div></div>' +
      '<div><div class="muted">' + esc(T.trip.destination.split('·')[0].trim()) + ' 현지</div><div class="clk" id="clkDest">' + C.clockIn(destTz, nowMs()) + '</div><div class="clk-d">' + dateLabel(C.todayIn(destTz, nowMs())) + '</div></div>' +
      '</div><div class="row" style="margin-top:10px"><span class="pill today" style="margin:0;font-size:12.5px">' + esc(phaseText) + '</span>' +
      '<span class="muted" id="diffH">집과 ' + esc(hoursBetween(homeTz, destTz, nowMs())) + ' 차이</span></div></div>';

    // 오늘 / 다음 일정
    var todayDay = null;
    if (ph.phase === 'during') todayDay = T.days.find(function (d) { return d.date === ph.today; }) || null;
    var showDay = todayDay || (ph.phase === 'before' ? T.days[0] : null);
    var label = ph.phase === 'during' ? '오늘 일정' : ph.phase === 'before' ? '첫날 일정 미리보기' : '일정';
    html += '<div class="card"><h2>' + label + '</h2>';
    if (showDay) {
      html += '<div class="row" style="margin-bottom:6px"><span class="chip">' + mdChip(showDay.date) + '</span><div class="grow"><div class="dtitle" style="font-size:15px">' + esc(showDay.title || showDay.city || '') + '</div></div></div>';
      html += itemsHtml(showDay.items, 3);
      if (T.days.length && showDay.items.length > 3) html += '<div class="muted" style="margin-top:6px">나머지는 일정 탭에서 볼 수 있어요.</div>';
      if (!showDay.items.length) html += '<div class="muted">이 날의 일정이 아직 없어요.</div>';
    } else {
      html += '<div class="muted">' + (ph.phase === 'after' ? '여행이 끝났어요. 새 여행을 등록할 수 있어요.' : '오늘 날짜의 일정이 파일에 없어요.') + '</div>';
    }
    html += '</div>';

    // 항공
    if (T.flights.length) {
      html += '<div class="card"><h2>항공</h2>' + T.flights.map(function (f) {
        return '<div class="it"><div class="tm">' + esc(f.departTime || '') + '</div><div class="tt"><b>' + esc(f.flight) + '</b> ' + esc(f.from) + (f.fromName ? ' ' + esc(f.fromName) : '') + ' → ' + esc(f.to) + (f.toName ? ' ' + esc(f.toName) : '') +
          '<div class="dt">' + esc(mdLabel(f.date)) + ' ' + esc(f.departTime) + ' 출발 · ' + (f.arriveDate ? esc(mdLabel(f.arriveDate)) + ' ' : '') + esc(f.arriveTime) + ' 도착' + (f.toName ? ' (' + esc(f.toName) + ')' : '') + '</div></div></div>';
      }).join('') + '</div>';
    }

    // 날씨 (7일)
    html += '<div class="card"><h2>날씨 · 7일</h2><div id="wxBox"><div class="muted">불러오는 중…</div></div></div>';

    // 환율
    if (T.trip.currency) html += '<div class="card"><h2>환율</h2><div id="fxBox"><div class="muted">불러오는 중…</div></div></div>';

    // 확인 필요
    if (T.needsCheck && T.needsCheck.length) {
      html += '<div class="card" style="background:#fdf2f8;border-color:#fbcfe8"><h2 style="color:#9d174d">확인 필요</h2>' +
        T.needsCheck.map(function (x) { return '<div class="muted" style="color:#831843;margin:3px 0">• ' + esc(x) + '</div>'; }).join('') + '</div>';
    }
    return html;
  }

  function emptyCard() {
    return '<div class="card empty"><div class="big">✈️</div><h3>여행을 등록하세요</h3>' +
      '<div class="muted">여행 파일(JSON)을 가져오면 일정, 날씨, 항공 정보가 자동으로 채워져요.<br>파일이 없다면 설정 탭에서 Gemini용 프롬프트를 참고하세요.</div>' +
      '<div style="margin-top:14px"><button class="btn" data-act="tab" data-id="settings">여행 등록하러 가기</button></div></div>';
  }

  function mdChip(iso) { return C.mdLabel(iso) + ' ' + C.weekday(iso); }
  function mdLabel(iso) { return C.mdLabel(iso); }

  function itemsHtml(items, limit) {
    var list = limit ? items.slice(0, limit) : items;
    return list.map(function (it) {
      var cls = it.source === 'web' ? ' web' : it.source === 'check' ? ' chk' : '';
      var tm = it.time ? it.time + (it.endTime ? '<br><span style="font-weight:600;color:#64748b">~' + esc(it.endTime) + '</span>' : '') : '';
      return '<div class="it' + cls + '"><div class="tm">' + tm + '</div><div class="tt">' + esc(it.title) +
        (it.source === 'web' ? '<span class="pill web">웹과 다름</span>' : '') +
        (it.source === 'check' ? '<span class="pill chk">확인</span>' : '') +
        (it.detail ? '<div class="dt">' + esc(it.detail) + '</div>' : '') + '</div></div>';
    }).join('');
  }

  // ---------- 홈 추가 정보 (날씨 · 환율) ----------
  function loadHomeExtras() {
    var T = trip(); if (!T) return;
    var ph = C.tripPhase(T.trip, nowMs());
    if (T.trip.location) {
      var cache = get(K.wx, null);
      var from = ph.today > T.trip.startDate ? ph.today : T.trip.startDate;
      var cacheKey = T.trip.location.lat + ',' + T.trip.location.lon + ',' + from;
      if (cache && cache.key === cacheKey && Date.now() - cache.at < 3 * 3600e3) drawWeek(cache);
      else if (navigator.onLine === false && cache) drawWeek(cache, true);
      else fetch(C.weatherUrl(T.trip.location, T.trip.timezone)).then(function (r) { return r.json(); }).then(function (j) {
        var week = C.pickWeek(j, from, T.trip.endDate);
        var data = { key: cacheKey, at: Date.now(), week: week, loc: T.trip.location.name };
        set(K.wx, data); drawWeek(data);
      }).catch(function () { if (cache) drawWeek(cache, true); else { var b = $('wxBox'); if (b) b.innerHTML = '<div class="muted">날씨를 불러오지 못했어요. 온라인에서 다시 열어 주세요.</div>'; } });
    } else { var b0 = $('wxBox'); if (b0) b0.innerHTML = '<div class="muted">여행지 위치 정보가 없어 날씨를 표시하지 않아요.</div>'; }

    if (T.trip.currency) {
      var fc = get(K.fx, null);
      var curKey = T.trip.currency;
      if (fc && fc.cur === curKey && Date.now() - fc.at < 12 * 3600e3) drawFx(fc);
      else fetch('https://api.frankfurter.dev/v1/latest?base=' + encodeURIComponent(curKey) + '&symbols=KRW').then(function (r) { return r.json(); }).then(function (j) {
        if (!j.rates || !j.rates.KRW) throw new Error('no rate');
        var d = { cur: curKey, at: Date.now(), krw: j.rates.KRW, date: j.date };
        set(K.fx, d); drawFx(d);
      }).catch(function () { if (fc && fc.cur === curKey) drawFx(fc, true); else { var f0 = $('fxBox'); if (f0) f0.innerHTML = '<div class="muted">환율을 불러오지 못했어요.</div>'; } });
    }
  }
  function drawWeek(d, stale) {
    var b = $('wxBox'); if (!b) return;
    if (!d.week || !d.week.length) { b.innerHTML = '<div class="muted">예보 기간이 아니에요. 출발 약 2주 전부터 예보가 나와요.</div>'; return; }
    b.innerHTML = d.week.map(function (w) {
      return '<div class="wx"><div class="d">' + mdLabel(w.date) + '</div><div class="e">' + w.icon + '</div><div class="muted" style="font-size:13px">' + esc(w.text) + (w.rain != null ? ' · 비 ' + w.rain + '%' : '') + '</div><div class="tp">' + w.max + '° / ' + w.min + '°</div></div>';
    }).join('') + '<div class="muted" style="margin-top:6px">' + esc(d.loc) + ' 기준' + (stale ? ' · 마지막 갱신 ' + new Date(d.at).toLocaleString('ko-KR') : '') + '</div>';
  }
  function drawFx(d, stale) {
    var b = $('fxBox'); if (!b) return;
    b.innerHTML = '<div style="font-size:18px;font-weight:800">1 ' + esc(d.cur) + ' = ' + Math.round(d.krw).toLocaleString('ko-KR') + '원</div>' +
      '<div class="muted">' + (stale ? '오프라인 · 마지막 조회값' : '유럽중앙은행 기준') + '</div>';
  }

  // ---------- 일정 ----------
  function viewSchedule() {
    var T = trip();
    if (!T) return emptyCard();
    var ph = C.tripPhase(T.trip, nowMs());
    var html = '';
    var html0 = get(K.html, '');
    if (S.showHtml && html0) {
      html += '<div class="row" style="margin-bottom:10px"><button class="btn ghost sm" data-act="html-toggle">일정 목록으로</button><span class="muted">HTML 보기 (읽기 전용)</span></div>';
      html += '<iframe class="htmlv" sandbox="" srcdoc="' + esc(html0) + '"></iframe>';
      return html;
    }
    html += '<div class="row" style="margin-bottom:8px"><button class="btn ghost sm" data-act="all-toggle">' + (Object.keys(S.openDays).some(function (k) { return S.openDays[k]; }) ? '모두 접기' : '모두 펼치기') + '</button>' +
      (html0 ? '<button class="btn ghost sm" data-act="html-toggle">HTML 보기</button>' : '') + '</div>';
    html += '<div class="legend"><span class="lg">흰색 = 종이 안내문</span><span class="lg web">노랑 = 웹사이트와 다름</span><span class="lg chk">분홍 = 확인 필요</span></div>';
    if (!T.days.length) html += '<div class="card muted">날짜별 일정이 없어요.</div>';
    T.days.forEach(function (d) {
      var isToday = ph.phase === 'during' && d.date === ph.today;
      if (!(d.date in S.openDays) && isToday) S.openDays[d.date] = true;
      var open = !!S.openDays[d.date];
      var dayFlights = T.flights.filter(function (f) { return f.date === d.date; });
      html += '<div class="card day' + (open ? ' open' : '') + '" style="padding:12px 12px">' +
        '<div class="dayhead" data-act="day" data-id="' + d.date + '">' +
        '<span class="chip">' + esc(mdChip(d.date)) + '</span>' +
        '<div class="grow"><div class="dtitle">' + esc(d.title || d.city || '') + (isToday ? '<span class="pill today">오늘</span>' : '') + '</div>' +
        (d.summary ? '<div class="dsum">' + esc(d.summary) + '</div>' : '') + '</div>' +
        '<span class="chev">▾</span></div>' +
        '<div class="daybody">' +
        dayFlights.map(function (f) { return '<div class="flt">✈️ ' + esc(f.flight) + ' · ' + esc(f.from) + ' ' + esc(f.departTime) + ' → ' + esc(f.to) + ' ' + esc(f.arriveTime) + (f.arriveDate && f.arriveDate !== f.date ? ' (' + esc(mdLabel(f.arriveDate)) + ')' : '') + '</div>'; }).join('') +
        itemsHtml(d.items) +
        (d.meals.length ? '<div class="meals">' + d.meals.map(function (m) {
          var k = { breakfast: '조', lunch: '중', dinner: '석' }[m.type] || '·';
          return '<span class="meal"><b>' + k + '</b>' + esc(m.label) + '</span>';
        }).join('') + '</div>' : '') +
        (d.hotel ? '<div class="hotel"><div class="n">🏨 ' + esc(d.hotel.name) + '</div>' +
          (d.hotel.address ? '<div>' + esc(d.hotel.address) + '</div>' : '') +
          (d.hotel.checkin || d.hotel.checkout ? '<div>체크인 ' + esc(d.hotel.checkin || '-') + ' · 체크아웃 ' + esc(d.hotel.checkout || '-') + '</div>' : '') +
          (d.hotel.phone ? '<div>☎ <a href="tel:' + esc(d.hotel.phone.replace(/\s/g, '')) + '">' + esc(d.hotel.phone) + '</a></div>' : '') + '</div>' : '') +
        d.notes.map(function (n) { return '<div class="note ' + n.source + '">' + esc((n.source === 'web' ? '웹사이트와 다름 · ' : n.source === 'check' ? '확인 · ' : '') + n.text) + '</div>'; }).join('') +
        '</div></div>';
    });
    if (T.info.length) {
      html += '<div class="sec-t">여행 안내</div><div class="card" style="padding:4px 14px">';
      html += T.info.map(function (x, i) {
        var key = 'i' + i, open = !!S.openInfo[key];
        return '<div class="acc' + (open ? ' open' : '') + '"><div class="acc-h" data-act="info" data-id="' + key + '"><span class="grow">' + esc(x.title) + (x.source === 'web' ? '<span class="pill web">웹과 다름</span>' : x.source === 'check' ? '<span class="pill chk">확인</span>' : '') + '</span><span class="chev">▾</span></div>' +
          '<div class="acc-b">' + esc(x.body) + '</div></div>';
      }).join('');
      html += '</div>';
    }
    return html;
  }

  // ---------- 준비물 ----------
  function packItems() {
    var P = pack(), out = [];
    C.PACK_DEFAULT.forEach(function (sec, si) {
      sec.items.forEach(function (text, ii) {
        var id = 'd' + si + '-' + ii;
        if (P.removed.indexOf(id) < 0) out.push({ id: id, sec: si, text: text, custom: false });
      });
    });
    P.custom.forEach(function (c) { out.push({ id: c.id, sec: c.sec, text: c.text, custom: true }); });
    return out;
  }
  function viewPack() {
    var P = pack(), items = packItems();
    var done = items.filter(function (x) { return P.checks[x.id]; }).length;
    var pct = items.length ? Math.round(done / items.length * 100) : 0;
    var html = '<div class="card"><div class="row"><div class="grow"><b>' + done + ' / ' + items.length + ' 완료</b><div class="muted">개인 준비물 목록 (V2.6에서 가져옴)</div></div>' +
      '<button class="btn ghost sm" data-act="pk-clear">체크 모두 해제</button></div><div class="bar"><i style="width:' + pct + '%"></i></div></div>';
    var secs = C.PACK_DEFAULT.map(function (s, si) {
      var list = items.filter(function (x) { return x.sec === si; });
      var extra = P.custom.length ? '' : '';
      return { title: s.title, si: si, list: list };
    });
    var secCustom = { title: '내가 추가한 항목', si: -1, list: items.filter(function (x) { return x.custom; }) };
    if (secCustom.list.length) secs.push(secCustom);
    secs.forEach(function (s, idx) {
      if (!s.list.length) return;
      var dn = s.list.filter(function (x) { return P.checks[x.id]; }).length;
      if (!(idx in S.packOpen)) S.packOpen[idx] = idx === 0;
      html += '<div class="card" style="padding:4px 14px"><div class="acc' + (S.packOpen[idx] ? ' open' : '') + '"><div class="acc-h" data-act="pk-sec" data-id="' + idx + '"><span class="grow">' + esc(s.title) + ' <span class="muted">' + dn + '/' + s.list.length + '</span></span><span class="chev">▾</span></div>' +
        '<div class="acc-b" style="white-space:normal;color:inherit">' + s.list.map(function (x) {
          return '<div class="row" style="align-items:flex-start;padding:2px 0"><label class="ck grow"><input type="checkbox" data-act="pk-check" data-id="' + esc(x.id) + '"' + (P.checks[x.id] ? ' checked' : '') + '><span>' + esc(x.text) + '</span></label>' +
            '<button class="iconbtn" data-act="pk-del" data-id="' + esc(x.id) + '" title="삭제">✕</button></div>';
        }).join('') + '</div></div></div>';
    });
    html += '<div class="card"><h2>항목 추가</h2><div class="row"><input type="text" id="pkNew" placeholder="예: 여권 사진 2장" class="grow" style="min-width:160px"><button class="btn" data-act="pk-add">추가</button></div>' +
      '<div class="row" style="margin-top:10px"><button class="btn ghost sm" data-act="pk-reset">기본 목록으로 되돌리기</button></div></div>';
    return html;
  }

  // ---------- 중요 정보 ----------
  function viewRes() {
    var R = resList();
    var html = '<div class="card"><div class="warn" style="margin:0 0 6px">이 기기에만 저장돼요. 값은 가려져 있고 "보기"를 눌러야 보입니다. 공용 기기에서는 쓰지 마세요.</div></div>';
    if (!R.length) html += '<div class="card muted">아직 중요 정보가 없어요. 여행 파일에 예약 정보를 넣으면 자동으로 여기 들어와요. 직접 추가할 수도 있어요.</div>';
    R.forEach(function (r, i) {
      var shown = !!S.revealed[i];
      html += '<div class="res"><div class="l">' + esc(r.label) + '</div><div class="v">' + (shown ? esc(r.value) : '•••• ••••') + '</div>' +
        '<div class="acts"><button class="btn ghost sm" data-act="res-show" data-id="' + i + '">' + (shown ? '가리기' : '보기') + '</button>' +
        '<button class="btn ghost sm" data-act="res-copy" data-id="' + i + '">복사</button>' +
        '<button class="btn ghost sm" data-act="res-del" data-id="' + i + '" style="color:#dc2626;border-color:#fecaca">삭제</button></div></div>';
    });
    html += '<div class="card"><h2>직접 추가</h2><input type="text" id="rLabel" placeholder="항목 이름 (예: 보험 긴급 연락처)" style="margin-bottom:8px"><input type="text" id="rValue" placeholder="내용" style="margin-bottom:8px"><button class="btn block" data-act="res-add">추가</button></div>';
    return html;
  }

  // ---------- 설정 ----------
  function viewSettings() {
    var T = trip(), html = '';
    html += '<div class="card"><h2>여행 등록</h2>' +
      '<div class="muted" style="margin-bottom:8px">Gemini가 만든 여행 파일(.json)을 고르거나, 내용을 그대로 붙여넣으세요.</div>' +
      '<label class="btn block" style="text-align:center;display:block;cursor:pointer">📂 파일 가져오기<input type="file" id="fileIn" accept=".json,.txt,application/json,text/plain" style="display:none"></label>' +
      '<div style="margin-top:10px"><textarea id="pasteIn" placeholder="여기에 여행 파일 내용을 붙여넣으세요 ({ 로 시작)"></textarea></div>' +
      '<button class="btn ghost block" style="margin-top:8px" data-act="paste-read">내용 읽기</button>' +
      '<div class="muted" style="margin-top:8px">백업 파일도 같은 곳에 넣으면 복원 여부를 물어봅니다.</div></div>';

    html += '<div class="card"><h2>일정 HTML 붙여넣기 (읽기 전용)</h2><div class="muted" style="margin-bottom:8px">다른 곳에서 만든 HTML 일정을 일정 탭에 그대로 보여줍니다. 편집은 되지 않습니다.</div>' +
      '<textarea id="htmlIn" placeholder="<html>…</html>"></textarea>' +
      '<div class="row" style="margin-top:8px"><button class="btn ghost" data-act="html-save">HTML 보기로 저장</button>' +
      (get(K.html, '') ? '<button class="btn ghost" data-act="html-clear">HTML 지우기</button>' : '') + '</div></div>';

    html += '<div class="card"><h2>백업 · 복원</h2>' +
      '<label class="ck"><input type="checkbox" id="incRes" checked><span>백업에 중요 정보 포함 (권장: 드라이브 보관용)</span></label>' +
      '<div class="row" style="margin-top:8px"><button class="btn" data-act="backup">⬇️ 백업 파일 저장</button>' +
      '<button class="btn ghost" data-act="backup-share">📤 공유 (드라이브 등)</button></div>' +
      '<label class="btn ghost block" style="text-align:center;display:block;margin-top:8px;cursor:pointer">⬆️ 백업 파일 복원<input type="file" id="restoreIn" accept=".json,application/json" style="display:none"></label>' +
      '<div class="muted" style="margin-top:8px">백업 파일에는 여행 정보와 준비물 체크가 들어가요. 중요 정보를 넣으면 파일이 민감해지니 드라이브 외에는 보관하지 마세요.</div></div>';

    html += '<div class="card"><h2>글자 크기</h2><div class="row">' +
      [[0.9, '작게'], [1, '보통'], [1.15, '크게'], [1.3, '아주 크게']].map(function (p) {
        return '<button class="btn ' + (S.settings.fz === p[0] ? '' : 'ghost') + ' sm" data-act="fz" data-id="' + p[0] + '">' + p[1] + '</button>';
      }).join('') + '</div></div>';

    html += '<div class="card"><h2>앱 설치</h2><div class="muted" style="margin-bottom:8px">갤럭시 Chrome에서 홈 화면에 추가하면 앱처럼 열려요.</div>' +
      (window.__installEvt ? '<button class="btn" data-act="install">홈 화면에 추가</button>' : '<div class="muted">Chrome 메뉴(⋮) → "홈 화면에 추가" 또는 "앱 설치"를 누르세요.</div>') + '</div>';

    html += '<div class="card"><h2>여행 삭제</h2><div class="muted" style="margin-bottom:8px">' + (T ? '현재 여행: ' + esc(T.trip.name) : '등록된 여행이 없어요.') + '</div>' +
      (T ? '<button class="btn danger" data-act="trip-replace">새 여행으로 바꾸기 / 삭제</button>' : '') + '</div>';

    html += '<div class="muted" style="text-align:center;padding:8px 0">SK-여행 ' + C.APP_VERSION + ' · 여행 데이터는 이 기기에만 저장됩니다.</div>';
    return html;
  }

  // ---------- 여행 등록 흐름 ----------
  function handleIncoming(text) {
    var p = C.parseTripText(text);
    if (!p.ok) { return showErrors(['파일을 읽지 못했어요.', p.error]); }
    var v = p.value;
    if (v && v.kind === 'sk-travel-backup') return restoreFlow(text);
    var n = C.normalizeTrip(v);
    if (!n.ok) return showErrors(n.errors, n.warnings);
    previewFlow(n);
  }

  function showErrors(errs, warns) {
    openModal('<h3>여행 파일을 읽지 못했어요</h3>' + errs.map(function (e) { return '<div class="err">' + esc(e) + '</div>'; }).join('') +
      (warns && warns.length ? warns.map(function (w) { return '<div class="warn">' + esc(w) + '</div>'; }).join('') : '') +
      '<div class="muted" style="margin-top:8px">Gemini 출력 전체를 그대로 붙여넣었는지, 중괄호 { } 가 맞는지 확인해 보세요.</div>' +
      '<div class="btns"><button class="btn ghost block" data-act="modal-close">닫기</button></div>');
  }

  function previewFlow(n) {
    var T = trip();
    var ph = n.days.length;
    var html = '<h3>이 여행을 저장할까요?</h3>' +
      '<div class="card" style="margin:8px 0;padding:12px"><div class="dtitle" style="font-size:16px">' + esc(n.trip.name) + '</div>' +
      '<div class="muted">' + esc(n.trip.destination) + '</div>' +
      '<div style="margin-top:6px;font-size:14px">📅 ' + esc(n.trip.startDate) + ' ~ ' + esc(n.trip.endDate) + '</div>' +
      '<div class="muted">일정 ' + ph + '일 · 항공 ' + n.flights.length + '편 · 여행 안내 ' + n.info.length + '개 · 중요 정보 ' + n.reservations.length + '개</div>' +
      '<div class="muted">시간대 ' + esc(n.trip.timezone) + ' · 통화 ' + esc(n.trip.currency || '-') + '</div></div>';
    n.warnings.forEach(function (w) { html += '<div class="warn">' + esc(w) + '</div>'; });
    if (n.reservations.length) html += '<div class="warn" style="background:#f0f9ff;border-color:#bae6fd;color:#075985">중요 정보 ' + n.reservations.length + '개는 여행 정보와 분리해서 "중요 정보" 탭에 따로 저장합니다.</div>';
    if (T) html += '<div class="warn">기존 여행(' + esc(T.trip.name) + ')이 있어요. 다음 단계에서 백업 저장 또는 삭제를 고를 수 있어요.</div>';
    html += '<div class="btns"><button class="btn block" data-act="preview-save">저장</button><button class="btn ghost block" data-act="modal-close">취소</button></div>';
    openModal(html);
    window.__pending = n;
  }

  function saveTripData(n) {
    set(K.trip, { trip: n.trip, days: n.days, flights: n.flights, info: n.info, needsCheck: n.needsCheck });
    set(K.res, n.reservations);
    del(K.html); S.showHtml = false;
    S.openDays = {}; S.openInfo = {}; S.revealed = {};
    closeModal(); S.tab = 'home'; render();
    toast('여행을 저장했어요 ✈️');
  }

  // 기존 여행이 있을 때: 백업 후 바꾸기 / 공유 후 바꾸기 / 저장 없이 삭제
  function replaceFlow(n) {
    openModal('<h3>기존 여행을 어떻게 할까요?</h3>' +
      '<div class="muted" style="margin-bottom:6px">새 여행으로 바꾸면 지금 여행 일정과 중요 정보가 이 기기에서 지워져요. 준비물 체크는 그대로 남아요.</div>' +
      '<div class="btns">' +
      '<button class="opt" data-act="rep-save"><b>① 백업 파일 저장 후 바꾸기</b><span>다운로드 폴더에 파일이 생기고, 그다음 새 여행으로 바뀝니다.</span></button>' +
      '<button class="opt" data-act="rep-share"><b>② 공유(드라이브 등)로 보낸 뒤 바꾸기</b><span>구글 드라이브 같은 앱을 골라 보관하세요. 보관이 끝났는지 확인한 뒤 바뀝니다.</span></button>' +
      '<button class="opt" data-act="rep-delete"><b>③ 저장하지 않고 삭제 후 바꾸기</b><span>백업 없이 지웁니다. 되돌릴 수 없어요.</span></button>' +
      '<button class="btn ghost block" data-act="modal-close">취소</button></div>');
    window.__pending = n;
  }

  function backupObj(includeRes) {
    var T = trip();
    return C.makeBackup({ trip: T, reservations: resList(), includeReservations: includeRes, packing: pack() });
  }
  function backupFile(includeRes) {
    var obj = backupObj(includeRes);
    var txt = JSON.stringify(obj, null, 2);
    var fname = 'SK여행_백업_' + (trip() ? trip().trip.startDate : 'new') + '_' + new Date().toISOString().slice(0, 10) + '.json';
    return { blob: new Blob([txt], { type: 'application/json' }), name: fname };
  }
  function downloadBackup(includeRes) {
    var f = backupFile(includeRes);
    var a = document.createElement('a');
    a.href = URL.createObjectURL(f.blob); a.download = f.name;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(function () { URL.revokeObjectURL(a.href); }, 4000);
    toast('백업 파일을 저장했어요 💾 (다운로드 폴더)');
  }
  function shareBackup(includeRes, after) {
    var f = backupFile(includeRes);
    var file = new File([f.blob], f.name, { type: 'application/json' });
    if (navigator.canShare && navigator.canShare({ files: [file] })) {
      navigator.share({ files: [file], title: f.name }).then(function () { if (after) after(true); }, function () { if (after) after(false); });
    } else {
      downloadBackup(includeRes);
      if (after) after(true);
    }
  }

  
  function restoreFlow(text) {
    var r = C.parseBackup(text);
    if (!r.ok) return showErrors([r.error]);
    openModal('<h3>백업을 복원할까요?</h3>' +
      '<div class="card" style="margin:8px 0;padding:12px"><div class="dtitle" style="font-size:16px">' + esc(r.trip.trip.name) + '</div>' +
      '<div class="muted">' + esc(r.trip.trip.startDate) + ' ~ ' + esc(r.trip.trip.endDate) + ' · 일정 ' + r.trip.days.length + '일</div>' +
      '<div class="muted">중요 정보 ' + (r.reservationsIncluded ? r.reservations.length + '개 포함' : '없음') + ' · 준비물 체크 ' + (r.packing ? '포함' : '없음') + '</div></div>' +
      '<div class="warn">지금 여행을 이 백업으로 바꿉니다. 현재 내용은 사라져요.</div>' +
      '<div class="btns"><button class="btn block" data-act="restore-go">복원하기</button><button class="btn ghost block" data-act="modal-close">취소</button></div>');
    window.__restore = r;
  }

  // ---------- 입력 이벤트 ----------
  function act(el, ev) {
    var a = el.getAttribute('data-act'), id = el.getAttribute('data-id');
    switch (a) {
      case 'tab': S.tab = id; window.scrollTo(0, 0); render(); break;
      case 'ov-bg': if (ev.target === el) closeModal(); break;
      case 'modal-close': closeModal(); break;
      case 'day': S.openDays[id] = !S.openDays[id]; render(); break;
      case 'all-toggle': {
        var TT = trip(); var anyOpen = Object.keys(S.openDays).some(function (k) { return S.openDays[k]; });
        S.openDays = {};
        if (!anyOpen && TT) TT.days.forEach(function (d) { S.openDays[d.date] = true; });
        render(); break;
      }
      case 'info': S.openInfo[id] = !S.openInfo[id]; if (!S.openInfo[id]) delete S.openInfo[id]; render(); break;
      case 'html-toggle': S.showHtml = !S.showHtml; render(); break;
      case 'html-save': {
        var v = ($('htmlIn') || {}).value || '';
        if (!v.trim()) return toast('HTML 내용을 붙여넣어 주세요');
        if (set(K.html, v)) { S.showHtml = true; toast('HTML을 저장했어요'); S.tab = 'schedule'; render(); }
        break;
      }
      case 'html-clear': del(K.html); S.showHtml = false; toast('HTML 보기를 지웠어요'); render(); break;
      case 'paste-read': { var pv = ($('pasteIn') || {}).value || ''; if (!pv.trim()) return toast('내용을 붙여넣어 주세요'); handleIncoming(pv); break; }
      case 'preview-save': { var n = window.__pending; window.__pending = null; if (!n) return; if (trip()) { replaceFlow(n); } else saveTripData(n); break; }
      case 'trip-replace': { if (!trip()) return; window.__pending = null; replaceFlow(null); break; }
      case 'rep-save': {
        var nn = window.__pending;
        downloadBackup(true);
        if (nn) { window.__pending = null; saveTripData(nn); } else { openDeleteOnly(); }
        break;
      }
      case 'rep-share': {
        var nn2 = window.__pending;
        shareBackup(true, function (ok) {
          openModal('<h3>보관이 끝났나요?</h3><div class="muted">공유한 파일이 드라이브 등에 저장됐는지 확인하세요. 확인을 누르면 기존 여행이 지워집니다.</div>' +
            '<div class="btns"><button class="btn danger block" data-act="rep-share-done">네, 저장했어요. 바꾸기</button><button class="btn ghost block" data-act="modal-close">아니요, 취소</button></div>');
          window.__pending2 = nn2;
        });
        break;
      }
      case 'rep-share-done': { var p2 = window.__pending2; window.__pending2 = null; if (p2) saveTripData(p2); else { closeModal(); openDeleteOnly(); } break; }
      case 'rep-delete': {
        openModal('<h3>정말 삭제할까요?</h3><div class="warn">백업 없이 지웁니다. 되돌릴 수 없어요. 확인하려면 아래 칸에 <b>삭제</b>라고 적으세요.</div>' +
          '<input type="text" id="delConfirm" placeholder="삭제" style="margin-top:8px">' +
          '<div class="btns"><button class="btn danger block" data-act="rep-delete-go">삭제하고 계속</button><button class="btn ghost block" data-act="modal-close">취소</button></div>');
        break;
      }
      case 'rep-delete-go': {
        if ((($('delConfirm') || {}).value || '').trim() !== '삭제') return toast('"삭제"라고 정확히 적어 주세요');
        var nn3 = window.__pending; window.__pending = null;
        if (nn3) saveTripData(nn3); else { openDeleteOnly(); }
        break;
      }
      case 'restore-go': {
        var r = window.__restore; window.__restore = null;
        if (!r) return;
        set(K.trip, { trip: r.trip.trip, days: r.trip.days, flights: r.trip.flights, info: r.trip.info, needsCheck: r.trip.needsCheck });
        set(K.res, r.reservations);
        if (r.packing) set(K.pack, r.packing);
        del(K.html); closeModal(); S.tab = 'home'; render();
        toast('백업을 복원했어요 ✅');
        break;
      }
      case 'backup': downloadBackup(!!(($('incRes') || { checked: true }).checked)); break;
      case 'backup-share': shareBackup(!!(($('incRes') || { checked: true }).checked), null); break;
      case 'fz': S.settings.fz = Number(id); set(K.settings, S.settings); applyFz(); render(); break;
      case 'install': if (window.__installEvt) { window.__installEvt.prompt(); window.__installEvt = null; } break;
      case 'pk-check': break;
      case 'pk-sec': { S.packOpen[id] = !S.packOpen[id]; render(); break; }
      case 'pk-clear': { var P = pack(); P.checks = {}; set(K.pack, P); render(); break; }
      case 'pk-del': {
        var P2 = pack();
        if (id.indexOf('d') === 0) { if (P2.removed.indexOf(id) < 0) P2.removed.push(id); }
        else P2.custom = P2.custom.filter(function (c) { return c.id !== id; });
        delete P2.checks[id];
        set(K.pack, P2); render(); break;
      }
      case 'pk-add': {
        var txt = (($('pkNew') || {}).value || '').trim();
        if (!txt) return toast('추가할 내용을 적어 주세요');
        var P3 = pack();
        P3.custom.push({ id: 'c' + Date.now().toString(36), sec: -1, text: txt });
        set(K.pack, P3); render(); toast('추가했어요');
        break;
      }
      case 'pk-reset': {
        if (!confirm('기본 준비물 목록으로 되돌릴까요? 내가 추가한 항목은 지워지고, 체크도 모두 해제됩니다.')) return;
        set(K.pack, { checks: {}, custom: [], removed: [] }); render(); toast('기본 목록으로 되돌렸어요'); break;
      }
      case 'res-show': S.revealed[id] = !S.revealed[id]; render(); break;
      case 'res-copy': {
        var rr = resList()[Number(id)];
        if (!rr) return;
        var done = function () { toast('복사했어요'); };
        if (navigator.clipboard) navigator.clipboard.writeText(rr.value).then(done, function () { toast('복사하지 못했어요. 보기를 누르고 직접 복사하세요'); });
        else toast('복사하지 못했어요. 보기를 누르고 직접 복사하세요');
        break;
      }
      case 'res-del': {
        if (!confirm('이 중요 정보를 지울까요?')) return;
        var L = resList(); L.splice(Number(id), 1); set(K.res, L); render(); break;
      }
      case 'res-add': {
        var lb = (($('rLabel') || {}).value || '').trim(), vv = (($('rValue') || {}).value || '').trim();
        if (!lb || !vv) return toast('항목 이름과 내용을 모두 적어 주세요');
        var L2 = resList(); L2.push({ label: lb, value: vv }); set(K.res, L2); render(); toast('추가했어요');
        break;
      }
      case 'empty-tab': break;
    }
  }

  function openDeleteOnly() {
    del(K.trip); del(K.html); del(K.res);
    S.openDays = {}; S.openInfo = {}; S.showHtml = false;
    closeModal(); S.tab = 'home'; render();
    toast('기존 여행을 지웠어요. 새 여행 파일을 올려 주세요');
  }

  document.addEventListener('click', function (ev) {
    var el = ev.target.closest && ev.target.closest('[data-act]');
    if (!el) return;
    if (el.tagName === 'INPUT' && el.type === 'checkbox') return;
    act(el, ev);
  });
  document.addEventListener('change', function (ev) {
    var t = ev.target;
    if (t.matches && t.matches('input[data-act="pk-check"]')) {
      var P = pack(); P.checks[t.getAttribute('data-id')] = t.checked; set(K.pack, P); render(); return;
    }
    if (t.id === 'fileIn' && t.files && t.files[0]) {
      var f = t.files[0];
      if (f.size > 900 * 1024) return showErrors(['파일이 너무 커요 (900KB 이하).']);
      var rd = new FileReader();
      rd.onload = function () { handleIncoming(String(rd.result)); t.value = ''; };
      rd.readAsText(f);
    }
    if (t.id === 'restoreIn' && t.files && t.files[0]) {
      var rf = t.files[0];
      var rr2 = new FileReader();
      rr2.onload = function () { restoreFlow(String(rr2.result)); t.value = ''; };
      rr2.readAsText(rf);
    }
  });
  document.addEventListener('keydown', function (ev) {
    if (ev.key === 'Enter' && ev.target && ev.target.id === 'pkNew') { ev.preventDefault(); act($('view').querySelector('[data-act="pk-add"]'), ev); }
  });

  // ---------- 시계 갱신 ----------
  setInterval(function () {
    var T = trip(); if (!T || S.tab !== 'home') return;
    var a = $('clkHome'), b = $('clkDest');
    if (a) a.textContent = C.clockIn(T.trip.homeTimezone, nowMs());
    if (b) b.textContent = C.clockIn(T.trip.timezone, nowMs());
  }, 30000);

  // ---------- 설치 · 서비스 워커 ----------
  window.addEventListener('beforeinstallprompt', function (e) { e.preventDefault(); window.__installEvt = e; if (S.tab === 'settings') render(); });
  window.addEventListener('appinstalled', function () { window.__installEvt = null; toast('설치했어요 🎉'); });
  if ('serviceWorker' in navigator) {
    window.addEventListener('load', function () { navigator.serviceWorker.register('sw.js').catch(function () {}); });
  }

  applyFz();
  render();
})();
