/* 택 앤 쭈 런웨이 화면 동작 (2026.10 재디자인: 화면만 새로, 계산은 core.js 그대로) */
(function () {
'use strict';
var API = 'https://script.google.com/macros/s/AKfycbxVJypN_d3BeLrL3-y1Z453t95wdB3xRlRg72umD_-phS1Beq1sVVFB4Ay-sbSYR_6Wmg/exec'; // 구글 Apps Script 중계 서버 (열쇠는 서버에만 있음)
var C = window.RunwayCore;
var ME = null, LEDGER = null, SHA = null, PRICES = { SOL: null, WLD: null }, PRICE_AT = null;
var TAB = 'home', RECTYPE = 'jbal', rendering = false, histLimit = 30;
var SYNC_AT = null, SYNC_FAIL = false, CACHE_AT = null; // 자료 기준 표시용: 마지막 서버 동기화 시각 / 실패 여부 / 저장본 시각
var $ = function (s) { return document.querySelector(s); };
function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
var won = C.won;
function n2(v) { return (+v).toLocaleString('ko-KR', { maximumFractionDigits: 4 }); }
function parseNum(s) { s = String(s == null ? '' : s).replace(/[^0-9.\-]/g, ''); var v = parseFloat(s); return isFinite(v) ? v : NaN; }
function toast(t) { var el = $('#toast'); el.textContent = t; el.classList.add('on'); clearTimeout(toast._t); toast._t = setTimeout(function () { el.classList.remove('on'); }, 2600); }
function sleep(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }
function uid() { return Date.now().toString(36) + Math.random().toString(36).slice(2, 7); }
function today() { return C.kstToday(); }
function nowIso() { return new Date().toISOString(); }

var enc = new TextEncoder(), dec = new TextDecoder();

// ---------- 기록 읽기/쓰기 (중계 서버) ----------
async function fetchJson(url, opt) { // Google 쪽 일시 오류(HTML 응답 등)는 null
  try { var r = await fetch(url, opt); var t = await r.text(); return JSON.parse(t); } catch (e) { return null; }
}
async function readLedger() {
  var j = null;
  for (var i = 0; i < 3; i++) { j = await fetchJson(API + '?t=' + Date.now(), { cache: 'no-store' }); if (j && j.ok) break; await sleep(800 * (i + 1)); }
  if (!j || !j.ok) { SYNC_FAIL = true; if (TAB === 'home') queueHome(); }
  if (!j || !j.ok) throw new Error('불러오기 실패' + (j && j.status ? ' (HTTP ' + j.status + ')' : ' (잠시 후 다시 시도해 주세요)'));
  try { localStorage.setItem('runway.cache', JSON.stringify({ data: j.data, sha: j.sha, at: Date.now() })); } catch (e) {}
  SYNC_AT = Date.now(); SYNC_FAIL = false;
  return { data: j.data, sha: j.sha };
}
async function save(mutate, msg) {
  for (var i = 0; i < 4; i++) {
    var cur = await readLedger();
    var next = JSON.parse(JSON.stringify(cur.data));
    mutate(next);
    next.updatedAt = nowIso() + '#' + uid(); // 이번 저장만의 표시 (응답이 애매할 때 실제 저장 여부 확인용)
    var j = await fetchJson(API, { method: 'POST', body: JSON.stringify({ content: JSON.stringify(next, null, 1), sha: cur.sha, message: msg + ' (' + ME + ')' }) });
    if (j && j.ok) { LEDGER = next; SHA = j.sha; try { localStorage.setItem('runway.cache', JSON.stringify({ data: next, sha: j.sha, at: Date.now() })); } catch (e) {} return true; }
    if (!j) { // 응답을 못 받음: 실제로 저장됐는지 확인하고, 안 됐을 때만 다시 시도
      await sleep(1000);
      try { var chk = await readLedger(); if (chk.data.updatedAt === next.updatedAt) { LEDGER = chk.data; SHA = chk.sha; return true; } } catch (e) {}
      continue;
    }
    if (j.error === 'records cannot shrink') throw new Error('기록은 지울 수 없어요 (취소만 돼요)');
    if (j.status !== 409 && j.status !== 422) throw new Error('저장 실패' + (j.status ? ' (HTTP ' + j.status + ')' : j.error ? ' (' + j.error + ')' : ''));
    await sleep(500 * (i + 1));
  }
  throw new Error('저장이 잘 안 돼요. 잠시 후 다시 해 주세요.');
}
var saving = false;
async function doSave(mutate, msg, okText) {
  if (saving) { toast('저장 중이에요. 잠시만요'); return false; }
  saving = true; toast('저장 중...');
  try { await save(mutate, msg); toast(okText || '저장했어요'); renderAll(); return true; }
  catch (e) { toast(e.message || '저장 실패'); return false; }
  finally { saving = false; }
}

// ---------- 시세 (코인원) ----------
var wsStarted = false;
function connectWS() {
  var ws = new WebSocket('wss://stream.coinone.co.kr'), ping;
  ws.onopen = function () {
    ['SOL', 'WLD'].forEach(function (s) { ws.send(JSON.stringify({ request_type: 'SUBSCRIBE', channel: 'TICKER', topic: { quote_currency: 'KRW', target_currency: s } })); });
    ping = setInterval(function () { if (ws.readyState === 1) ws.send(JSON.stringify({ request_type: 'PING' })); }, 60000);
  };
  ws.onmessage = function (e) {
    var m = JSON.parse(e.data); if (m.response_type !== 'DATA') return;
    PRICES[m.data.target_currency] = +m.data.last; PRICE_AT = +m.data.timestamp; queueHome();
  };
  ws.onclose = function () { clearInterval(ping); setTimeout(connectWS, 3000); };
}
async function seedPrices() {
  try {
    var h = await (await fetch('https://raw.githubusercontent.com/jtl10231-oss/coin-total/data/history.json?t=' + Date.now())).json();
    if (PRICES.SOL == null) PRICES.SOL = h.SOL[h.SOL.length - 1];
    if (PRICES.WLD == null) PRICES.WLD = h.WLD[h.WLD.length - 1];
    if (!PRICE_AT) PRICE_AT = h.updated;
    queueHome();
  } catch (e) {}
}
var homeQueued = false, lastHome = 0;
function queueHome() {
  if (homeQueued || TAB !== 'home' || !LEDGER) return;
  homeQueued = true;
  setTimeout(function () { homeQueued = false; if (Date.now() - lastTouch < 5000) return queueHome(); renderHome(); }, Math.max(0, 1500 - (Date.now() - lastHome), 5000 - (Date.now() - lastTouch)));
}

// ---------- 열기: 로그인 없이 바로 쮸/택 선택 (한 번 고르면 이 기기에 저장) ----------
function showLock(html) { $('#app').hidden = true; var l = $('#lock'); l.hidden = false; l.innerHTML = '<div class="lockcard">' + html + '</div>'; }
function pageUrl() { return location.origin + location.pathname; }
function showPick() {
  showLock('<h2>누구세요?</h2><div class="sub">한 번 고르면 이 기기에 저장돼요. 나중에 설정에서 바꿀 수 있어요.</div><div class="pick"><button class="btn" data-me="쮸">쮸</button><button class="btn" data-me="택">택</button></div>');
  document.querySelectorAll('[data-me]').forEach(function (b) { b.onclick = function () { localStorage.setItem('runway.me', b.dataset.me); ME = b.dataset.me; start(); }; });
}
function boot() {
  // 예전 방식(열쇠·PIN) 흔적은 이 기기에서 지움
  ['runway.key', 'runway.bootstrap', 'runway.enc'].forEach(function (x) { localStorage.removeItem(x); }); sessionStorage.removeItem('runway.tok');
  if (location.hash) history.replaceState(null, '', location.pathname);
  ME = localStorage.getItem('runway.me');
  if (ME !== '택' && ME !== '쮸') return showPick();
  start();
}

// ---------- 앱 시작 ----------
async function start() {
  $('#lock').hidden = true; $('#app').hidden = false;
  var cached = null; try { cached = JSON.parse(localStorage.getItem('runway.cache') || 'null'); } catch (e) {}
  if (cached && cached.data) { LEDGER = cached.data; SHA = cached.sha; CACHE_AT = cached.at; renderAll(); }
  else $('#tab-home').innerHTML = '<div class="state" role="status"><div class="skel l"></div><div class="skel m"></div><div class="skel s"></div><p>기록을 불러오는 중이에요</p></div>';
  if (!wsStarted) { wsStarted = true; connectWS(); seedPrices(); }
  try { var f = await readLedger(); LEDGER = f.data; SHA = f.sha; renderAll(); }
  catch (e) { if (!LEDGER) $('#tab-home').innerHTML = '<div class="state" role="alert"><h3>기록을 불러오지 못했어요</h3><p>' + esc(e.message) + '</p><p>저장된 기록은 그대로 안전해요.</p><button class="btn" onclick="location.reload()">다시 시도</button></div>'; else { toast('최신 기록을 못 불러왔어요. 저장된 기록을 보여드려요'); renderAll(); } }
  setInterval(async function () { // 다른 사람이 입력한 기록 반영 (2분마다)
    if (document.hidden) return;
    try { var f = await readLedger(); if (f && f.sha !== SHA) { LEDGER = f.data; SHA = f.sha; if (TAB === 'home') renderHome(); else if (!document.activeElement || !/INPUT|SELECT|TEXTAREA/.test(document.activeElement.tagName)) renderAll(); } } catch (e) {}
  }, 120000);
}
document.querySelectorAll('.bottom button').forEach(function (b) {
  b.onclick = function () {
    TAB = b.dataset.tab;
    document.querySelectorAll('.bottom button').forEach(function (x) { x.classList.toggle('on', x === b); });
    ['home', 'rec', 'memo', 'set'].forEach(function (t) { $('#tab-' + t).hidden = t !== TAB; });
    renderAll(); window.scrollTo(0, 0);
  };
});
function gotoTab(t) { var b = document.querySelector('.bottom button[data-tab="' + t + '"]'); if (b) b.click(); }
function renderAll() { if (!LEDGER) return; var mc = $('#me-chip'); if (mc) mc.textContent = ME || '-'; if (TAB === 'home') renderHome(); if (TAB === 'rec') renderRec(); if (TAB === 'memo') renderMemo(); if (TAB === 'set') renderSet(); }
function calc() { return C.compute(LEDGER, PRICES, Date.now()); }
function lv(l) { return { ok: '정상', info: '정상', warn: '주의', danger: '위험' }[l]; }
function pct(v) { return v == null ? '-' : (v * 100).toFixed(1) + '%'; }
function man(v) { return Math.round(v / 10000).toLocaleString('ko-KR') + '만'; }

// ---------- 홈 (재설계): 남은 기간과 자금 상태 → 지출 구성 → 시나리오 → 가정과 계산 기준 ----------
// 숫자는 전부 core.js(compute)가 계산한 값을 그대로 보여준다. 이 화면은 계산을 바꾸지 않는다.
function md(d) { return (+d.slice(5, 7)) + '/' + (+d.slice(8, 10)); }
function ymd(d) { return d.slice(0, 4) + '.' + d.slice(5, 7) + '.' + d.slice(8, 10); }
function hm(ms) { return new Date(ms).toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' }); }
function ago(ms) { var s = Math.max(0, Math.round((Date.now() - ms) / 1000)); if (s < 60) return '방금'; if (s < 3600) return Math.round(s / 60) + '분 전'; if (s < 86400) return Math.round(s / 3600) + '시간 전'; return Math.round(s / 86400) + '일 전'; }
function dl(d, base) { return d.slice(0, 4) === base.slice(0, 4) ? md(d) : ymd(d); } // 같은 해면 월/일, 다른 해면 연도까지
function nc(s) { var n = String(s).length; return n > 17 ? ' n-xl' : n > 13 ? ' n-lg' : ''; }
function barHtml(p, cls) { return '<div class="bar"><i class="' + (cls || '') + '" style="width:' + Math.max(0, Math.min(100, p)).toFixed(1) + '%"></i></div>'; }
function tabHead(kick, title, desc) { return '<header class="tabhead"><span class="eyebrow">' + kick + '</span><h1>' + title + '</h1>' + (desc ? '<p>' + desc + '</p>' : '') + '</header>'; }
function sec(id, n, kick, title, note, body, acc, sumline) {
  if (acc) return '<section class="sec acc" id="sec-' + id + '" aria-labelledby="h-' + id + '"><details class="secd" data-k="sec-' + id + '"' + (OPEN['sec-' + id] ? ' open' : '') + '><summary><span class="sh-t"><span class="eyebrow">' + n + ' · ' + kick + '</span><h2 id="h-' + id + '">' + title + '</h2><span class="ss">' + sumline + '</span></span><i aria-hidden="true"></i></summary><div class="secb">' + body + '</div></details></section>';
  return '<section class="sec" id="sec-' + id + '" aria-labelledby="h-' + id + '"><div class="sec-head"><div><span class="eyebrow">' + n + ' · ' + kick + '</span><h2 id="h-' + id + '">' + title + '</h2></div>' + (note ? '<span class="note">' + note + '</span>' : '') + '</div>' + body + '</section>';
}
var anchLimit = 5, saleLimit = 5;
function moreBtn(id, total, limit) { return total > limit ? '<button type="button" class="btn gray" id="' + id + '">이전 기록 더 보기 (' + (total - limit) + '건)</button>' : ''; }
function bindMore() {
  var a = document.getElementById('moreA'); if (a) a.onclick = function () { anchLimit += 10; renderRec(); };
  var b = document.getElementById('moreS'); if (b) b.onclick = function () { saleLimit += 10; renderRec(); };
}
var BASIS = null, OPEN = {}, lastTouch = 0;

function sparkChart(r) {
  var pts = [];
  r.anchors.forEach(function (a) { if (pts.length && pts[pts.length - 1].d === a.date) { pts[pts.length - 1].v = a.amount; pts[pts.length - 1].by = a.by; } else pts.push({ d: a.date, v: a.amount, by: a.by }); });
  if (r.lastAnchor && r.today > r.lastAnchor.date) pts.push({ d: r.today, v: r.balance, est: true });
  if (pts.length < 2) return { html: '<div class="empty">잔액을 두 번 이상 입력하면 흐름 그래프가 나와요.</div>', pts: [] };
  var t = function (d) { return Date.parse(d + 'T00:00:00Z'); };
  var x0 = t(pts[0].d), x1 = t(pts[pts.length - 1].d); if (x1 === x0) return { html: '', pts: [] };
  var vs = pts.map(function (p) { return p.v; }), lo = Math.min.apply(null, vs), hi = Math.max.apply(null, vs); if (hi === lo) { hi += 1; lo -= 1; }
  var W = 320, H = 96, P = 10, X = function (d) { return P + (W - 2 * P) * (t(d) - x0) / (x1 - x0); }, Y = function (v) { return H - 22 - (H - 38) * (v - lo) / (hi - lo); };
  pts.forEach(function (p) { p.x = X(p.d); p.y = Y(p.v); });
  var solid = pts.filter(function (p) { return !p.est; }), s = '<svg viewBox="0 0 ' + W + ' ' + H + '" class="spark" role="img" aria-label="공금통장 잔액 변화 그래프">';
  if (solid.length > 1) s += '<polyline class="ln" points="' + solid.map(function (p) { return p.x.toFixed(1) + ',' + p.y.toFixed(1); }).join(' ') + '"/>';
  var le = pts[pts.length - 1];
  if (le.est) { var pv = solid[solid.length - 1]; s += '<line class="est" x1="' + pv.x.toFixed(1) + '" y1="' + pv.y.toFixed(1) + '" x2="' + le.x.toFixed(1) + '" y2="' + le.y.toFixed(1) + '"/>'; }
  s += '<line class="cursor" id="sp-cur" x1="' + le.x.toFixed(1) + '" x2="' + le.x.toFixed(1) + '" y1="6" y2="' + (H - 18) + '" opacity="0"/>';
  pts.forEach(function (p, i) { s += '<circle class="pt' + (p.est ? '' : ' cur') + '" data-i="' + i + '" cx="' + p.x.toFixed(1) + '" cy="' + p.y.toFixed(1) + '" r="' + (p.est ? 3.2 : 3.2) + '"/>'; });
  s += '<text x="' + P + '" y="' + (H - 4) + '">' + md(pts[0].d) + '</text><text x="' + (W - P) + '" y="' + (H - 4) + '" text-anchor="end">' + (le.est ? '오늘(추정)' : md(le.d)) + '</text></svg>';
  return { html: '<div class="spark-wrap" id="spark-wrap">' + s + '</div><div class="spark-read" id="spark-read" aria-live="polite">그래프를 눌러 날짜별 잔액을 볼 수 있어요</div>', pts: pts, W: W };
}
function bindSpark(sp) {
  var wrap = $('#spark-wrap'); if (!wrap || !sp.pts.length) return;
  var read = $('#spark-read'), cur = $('#sp-cur');
  function at(clientX) {
    var rc = wrap.getBoundingClientRect(), vx = (clientX - rc.left) / rc.width * sp.W, best = 0, bd = 1e9;
    sp.pts.forEach(function (p, i) { var dd = Math.abs(p.x - vx); if (dd < bd) { bd = dd; best = i; } });
    var p = sp.pts[best];
    cur.setAttribute('x1', p.x); cur.setAttribute('x2', p.x); cur.setAttribute('opacity', '1');
    read.innerHTML = '<b>' + md(p.d) + '</b> · ' + won(p.v) + (p.est ? ' (오늘 추정)' : (p.by ? ' · ' + esc(p.by) + ' 입력' : ''));
  }
  var down = false;
  wrap.addEventListener('pointerdown', function (e) { down = true; lastTouch = Date.now(); at(e.clientX); });
  wrap.addEventListener('pointermove', function (e) { if (down || e.pointerType === 'mouse') { lastTouch = Date.now(); at(e.clientX); } });
  ['pointerup', 'pointercancel', 'pointerleave'].forEach(function (ev) { wrap.addEventListener(ev, function () { down = false; }); });
}

function scenarios(r) {
  var minD = r.settings.alert.minBurnDays;
  return [
    { k: 'obs', name: '지금 소비 속도대로', sub: r.burnReady ? '최근 ' + r.burnDays + '일 잔액 기록에서 나온 월 ' + won(r.burnMonthly) + ' · 코인 포함' : null, sim: r.pace, off: r.burnReady ? null : (r.burnDaily == null ? '잔액 기록이 더 필요해요' : '잔액 기록 ' + r.burnDays + '/' + minD + '일 · 자료 부족') },
    { k: 'plan', name: '계획대로', sub: '설정한 월 ' + won(r.planMonthly) + ' · 코인 포함', sim: r.plan },
    { k: 'nocoin', name: '코인 없이', sub: '공금통장 + 현금 + 앞으로 들어올 정기 입금 ' + won(r.nonCoinTotal) + '을 한꺼번에 있다고 보고 · 월 ' + won(r.mainMonthly), sim: r.nonCoin },
    { k: 'joint', name: '코인을 팔기 전까지', sub: '공금통장 + 현금에 정기 입금이 매달 들어온다고 보고 · 월 ' + won(r.mainMonthly) + ' · 이 날부터 코인을 팔아 채워야 해요', sim: r.jointOnly }
  ];
}

function renderHome() {
  if (!LEDGER) return;
  lastHome = Date.now();
  var r = calc(), S = r.settings, A = S.alert, la = r.lastAnchor;
  var havePx = PRICES.SOL != null && PRICES.WLD != null;
  var obsOk = r.burnReady, basis = BASIS || (obsOk ? 'obs' : 'plan'); if (basis === 'obs' && !obsOk) basis = 'plan';
  var sc = basis === 'obs' ? r.pace : r.plan, monthly = basis === 'obs' ? Math.max(0, r.burnMonthly) : r.planMonthly;
  var h = '';

  // 빠른 이동
  h += '<nav class="jump" aria-label="홈 안에서 이동"><a href="#sec-state" class="on"><b>1</b>기간·자금</a><a href="#sec-spend"><b>2</b>지출 구성</a><a href="#sec-scen"><b>3</b>시나리오</a><a href="#sec-basis"><b>4</b>계산 기준</a></nav>';

  // ===== 1. 남은 기간과 자금 상태 =====
  var b1 = '';
  b1 += '<div class="basis" role="group" aria-label="계산 기준 선택"><button type="button" data-basis="obs" aria-pressed="' + (basis === 'obs') + '"' + (obsOk ? '' : ' disabled') + '>관측 기준<small>' + (obsOk ? '실제 소비 속도' : '자료 부족') + '</small></button><button type="button" data-basis="plan" aria-pressed="' + (basis === 'plan') + '">계획 기준<small>설정한 월 지출</small></button></div>';
  b1 += '<p class="basis-note">' + (basis === 'obs' ? '<b>관측 기준</b> · 최근 ' + r.burnDays + '일 잔액 기록으로 계산한 월 <b class="num">' + won(monthly) + '</b>을 쓴다고 봐요.' : '<b>계획 기준</b> · 설정한 월 <b class="num">' + won(monthly) + '</b>을 쓴다고 봐요.' + (obsOk ? '' : ' 관측 기준은 잔액 기록이 ' + A.minBurnDays + '일 이상 쌓이면 열려요 (지금 ' + r.burnDays + '일).')) + '</p>';
  b1 += '<div class="runway"><div><div class="lbl">버틸 수 있는 기간 · ' + (basis === 'obs' ? '관측' : '계획') + '</div><div class="rw-num ' + (!havePx ? 'dim' : sc.survives ? 'good' : 'bad') + '">' + (havePx ? C.monthsText(sc.months) : '—') + '</div></div><span class="pill ' + r.status + '">' + lv(r.status) + '</span></div>';
  if (!havePx) b1 += '<p class="verdict">코인 시세를 받는 중이에요. 시세가 오면 계산돼요.</p>';
  else {
    var vt;
    if (sc.exhaust && sc.survives) vt = '목표일(' + dl(S.targetDate, r.today) + ')은 버티고, <b>' + ymd(sc.exhaust) + '</b>에 바닥나요';
    else if (sc.exhaust) vt = '<b>' + ymd(sc.exhaust) + '</b>에 바닥나요 · 목표일보다 <b>' + C.diffDays(sc.exhaust, S.targetDate) + '일</b> 일러요';
    else vt = '<b>5년 넘게</b> 버텨요';
    b1 += '<p class="verdict ' + (sc.survives ? 'good' : 'bad') + '">' + vt + (sc.atTarget != null ? '<br><span class="sub">목표일에 남는 돈 <b class="num">' + won(sc.atTarget) + '</b></span>' : '') + '</p>';
    var dTarget = Math.max(1, C.diffDays(r.today, S.targetDate)), dEx = sc.exhaust ? C.diffDays(r.today, sc.exhaust) : null, hz = Math.max(dTarget, dEx || 0, 30);
    var fillW = sc.exhaust ? dEx / hz * 100 : 100, tgtW = dTarget / hz * 100;
    b1 += '<div class="tl" role="img" aria-label="오늘부터 바닥나는 날까지의 막대"><i class="tl-fill' + (sc.survives ? '' : ' bad') + '" style="width:' + Math.max(1.5, Math.min(100, fillW)).toFixed(1) + '%"></i><u class="tl-target" style="left:' + Math.min(99.5, tgtW).toFixed(1) + '%"></u></div>';
    b1 += '<div class="tl-legend"><span>오늘 ' + dl(r.today, r.today) + '</span><span>' + (sc.exhaust ? '바닥 ' + dl(sc.exhaust, r.today) : '5년 이상') + '</span></div><p class="tl-cap">점선은 목표일 ' + dl(S.targetDate, r.today) + '</p>';
  }
  var secured = havePx ? won(r.secured) : '시세 확인 중';
  b1 += '<div class="stats"><div class="stat"><span class="lbl">남은 기간</span><span class="val num">D-' + Math.max(0, r.daysToTarget) + '</span><span class="sm">' + ymd(r.today) + ' → ' + ymd(S.targetDate) + '</span></div>';
  b1 += '<div class="stat"><span class="lbl">' + (r.surplus >= 0 ? '여유 자금' : '부족 자금') + '</span><span class="val num ' + (havePx ? (r.surplus >= 0 ? 'good' : 'bad') : '') + nc(havePx ? C.signWon(r.surplus) : '') + '">' + (havePx ? C.signWon(r.surplus) : '—') + '</span><span class="sm">확보 ' + secured + ' − 필요 ' + won(r.need) + '</span></div></div>';

  // 자료 기준
  var syncTxt, syncCls = '';
  if (SYNC_AT && !SYNC_FAIL) syncTxt = '서버 ' + ago(SYNC_AT);
  else if (SYNC_FAIL) { syncTxt = (CACHE_AT ? '불러오기 실패 · 저장본 ' + ago(CACHE_AT) : '불러오기 실패'); syncCls = 'stale'; }
  else { syncTxt = CACHE_AT ? '저장본 ' + ago(CACHE_AT) + ' (갱신 중)' : '확인 중'; syncCls = 'stale'; }
  var staleDays = la ? C.diffDays(la.date, r.today) : null;
  var pxCls = havePx ? '' : 'miss', balCls = !la ? 'miss' : staleDays > A.staleDays ? 'stale' : '';
  var provSum = '<span class="pc"><i class="dot ' + pxCls + '"></i>' + (havePx ? '시세 ' + (PRICE_AT ? hm(PRICE_AT) : '수신') : '시세 대기') + '</span><span class="pc"><i class="dot ' + balCls + '"></i>' + (la ? '잔액 ' + md(la.date) : '잔액 없음') + '</span><span class="pc"><i class="dot ' + syncCls + '"></i>' + (SYNC_FAIL ? '동기화 실패' : SYNC_AT ? '동기화 ' + ago(SYNC_AT) : '동기화 중') + '</span>';
  b1 += '<details class="prov" data-k="prov"' + (OPEN.prov ? ' open' : '') + '><summary><span class="ps-t">자료 기준</span><span class="ps-c">' + provSum + '</span><i aria-hidden="true"></i></summary><dl>';
  b1 += '<div class="pr"><dt>오늘 (한국시간)</dt><dd>' + ymd(r.today) + '</dd></div>';
  b1 += '<div class="pr"><dt>코인 시세</dt><dd><i class="dot ' + (havePx ? '' : 'miss') + '"></i>' + (havePx ? '코인원 ' + (PRICE_AT ? hm(PRICE_AT) : '수신') + ' 기준' : '아직 못 받음') + '</dd></div>';
  b1 += '<div class="pr"><dt>공금통장 잔액</dt><dd><i class="dot ' + (!la ? 'miss' : staleDays > A.staleDays ? 'stale' : '') + '"></i>' + (la ? md(la.date) + ' 입력' + (staleDays > 0 ? ' · ' + staleDays + '일 전' : ' · 오늘') + (la.by ? ' · ' + esc(la.by) : '') : '입력 없음') + '</dd></div>';
  b1 += '<div class="pr"><dt>소비 속도</dt><dd><i class="dot ' + (obsOk ? '' : 'stale') + '"></i>' + (r.burnDaily == null ? '계산 전' : '잔액 기록 ' + r.burnDays + '일치' + (obsOk ? '' : ' (최소 ' + A.minBurnDays + '일)')) + '</dd></div>';
  b1 += '<div class="pr"><dt>기록 동기화</dt><dd><i class="dot ' + syncCls + '"></i>' + syncTxt + '</dd></div>';
  b1 += '</dl></details>';

  // 부족한 자료 / 경고
  var gaps = [];
  if (!havePx) gaps.push({ t: '코인 시세를 아직 못 받았어요. 평가액과 런웨이 계산이 보류돼요.' });
  if (!la) gaps.push({ t: '공금통장 잔액 기록이 없어요. 관측 기준(실제 소비 속도)을 만들 수 없어요.', go: '잔액 입력' });
  else if (!obsOk) gaps.push({ t: r.burnDaily == null ? '잔액을 한 번 더 입력해야 관측 기준이 열려요.' : r.burnDaily <= 0 ? '입력 사이에 잔액이 늘었어요. 기록 안 된 입금이 있을 수 있어서 계획 기준으로 계산 중이에요.' : '잔액 기록이 ' + r.burnDays + '일치예요. 최소 ' + A.minBurnDays + '일이 쌓이면 관측 기준이 열려요.', go: '잔액 입력' });
  if (la && staleDays > A.staleDays) gaps.push({ t: '잔액을 ' + staleDays + '일째 안 적었어요. 추정이 실제와 멀어질 수 있어요.', go: '잔액 입력' });
  if (!S.confirmed) gaps.push({ t: '시작 숫자(코인 수량·현금)를 아직 확인하지 않았어요.', go: '설정 열기', tab: 'set' });
  if (r.overdue.length) gaps.push({ t: '날짜가 지난 예정 출금이 ' + r.overdue.length + '건 있어요. 실제로 나갔으면 기록하고 완료 처리해 주세요.', go: '기록 열기', tab: 'rec' });
  if (gaps.length) {
    b1 += '<div class="gaps"><h3>부족한 자료 ' + gaps.length + '건</h3><ul>';
    gaps.forEach(function (g) { b1 += '<li><span>' + esc(g.t) + '</span>' + (g.go ? '<button type="button" class="go" ' + (g.tab ? 'data-gotab="' + g.tab + '"' : 'data-jb="1"') + '>' + g.go + '</button>' : '') + '</li>'; });
    b1 += '</ul></div>';
  } else b1 += '<div class="gaps ok"><h3>필요한 자료가 모두 있어요</h3></div>';
  var dataKeys = { no_balance: 1, stale: 1, setup: 1, overdue: 1 };
  r.alerts.filter(function (a) { return !dataKeys[a.key]; }).forEach(function (a) { b1 += '<div class="al ' + a.level + '"><b>' + esc(a.title) + '</b><span>' + esc(a.detail) + '</span></div>'; });

  // 자금 구성
  var parts = [{ k: '코인', v: r.coinValue, c: 'var(--c-coin)' }, { k: '공금통장 (추정)', v: Math.max(0, r.balance), c: 'var(--c-joint)' }];
  if (r.cash) parts.push({ k: '현금', v: Math.max(0, r.cash), c: 'var(--c-cash)' });
  parts.push({ k: '정기 입금 예정', v: r.expectedFuture, c: 'var(--c-exp)' });
  var ptot = parts.reduce(function (a, p) { return a + Math.max(0, p.v); }, 0) || 1;
  b1 += '<div class="sub-h"><h3>확보 자금 구성</h3><small>' + (PRICE_AT ? '코인원 ' + hm(PRICE_AT) + ' 기준' : '') + '</small></div>';
  b1 += havePx ? '<div class="stack" role="img" aria-label="확보 자금 구성 비율">' + parts.map(function (p) { return '<i style="width:' + (Math.max(0, p.v) / ptot * 100).toFixed(2) + '%;background:' + p.c + '"></i>'; }).join('') + '</div>' : '<div class="skel"></div>';
  b1 += '<ul class="legend">';
  parts.forEach(function (p) {
    var isCoin = p.k === '코인', sub = '';
    if (p.k === '정기 입금 예정') sub = '앞으로 ' + r.expected.length + '번';
    b1 += '<li class="lg"><i style="background:' + p.c + '"></i><span class="t">' + p.k + '</span><span class="v">' + (havePx || !isCoin ? won(p.v) : '-') + '</span>' + (havePx ? '<span class="s">' + Math.round(Math.max(0, p.v) / ptot * 100) + '%' + (sub ? ' · ' + sub : '') + '</span>' : '') + '</li>';
  });
  b1 += '</ul>';
  if (havePx) b1 += '<details class="mini-d" data-k="d-coin"' + (OPEN['d-coin'] ? ' open' : '') + '><summary>코인 상세 (수량 × 시세)</summary><ul class="coinl">' + ['SOL', 'WLD'].map(function (c) { return '<li><span>' + c + ' ' + n2(r.hold[c]) + '개 × ' + won(PRICES[c]) + '</span><b class="num">' + won(r.coinVal[c]) + '</b></li>'; }).join('') + '</ul></details>';
  b1 += '<div class="target"><div class="top"><b>목표 자금 ' + won(r.budgetTotal) + '</b><span>' + (havePx ? '확보율 ' + pct(r.coverage) : '-') + '</span></div>' + (havePx ? barHtml(Math.min(100, (r.coverage || 0) * 100), r.surplus >= 0 ? '' : 'bad') : '<div class="skel"></div>') + '<details class="mini-d" data-k="d-target"' + (OPEN['d-target'] ? ' open' : '') + '><summary>계산 근거</summary><p>확보 ' + secured + ' · 앞으로 필요한 돈(예산 − 쓴 돈) ' + won(r.need) + '. 코인이 올라도 목표 자금은 늘지 않고, 오른 만큼은 여유 자금으로만 보여요.</p></details></div>';

  // 공금통장
  var sp = sparkChart(r);
  var balTxt = won(r.balance);
  b1 += '<div class="bal"><div class="bal-top"><div><span class="lbl">공금통장 잔액' + (la && r.daysSince > 0 ? ' (추정)' : '') + '</span><span class="big num' + nc(balTxt) + (r.balance < 0 ? ' bad' : '') + '">' + balTxt + '</span></div><button type="button" class="btn-s" id="jbEdit">잔액 입력</button></div>';
  if (la) {
    var bd = '입력한 잔액 ' + won(r.balanceBase) + ' (' + md(la.date) + ')';
    if (r.inflowSince) bd += ' + 그 뒤 들어온 돈 ' + won(r.inflowSince);
    if (r.spendEstSince) bd += ' − 그 뒤 쓴 돈 추정 ' + won(r.spendEstSince) + ' (' + (r.burnReady ? '소비 속도' : '계획') + ' 기준 하루 ' + won(r.dailyEst) + ' × ' + r.daysSince + '일)';
    b1 += '<details class="mini-d" data-k="d-bal"' + (OPEN['d-bal'] ? ' open' : '') + '><summary>잔액 추정 근거</summary><p>' + bd + '</p></details>';
  } else b1 += '<p class="hint">토스뱅크 앱에서 잔액을 보고 "잔액 입력"을 눌러 주세요. 두 번 이상 입력하면 소비 속도가 나와요.</p>';
  b1 += sp.html;
  if (r.expected.length) b1 += '<div class="kv"><span class="k">다음 정기 입금</span><span class="v good">' + md(r.expected[0].due) + ' ' + esc(r.expected[0].who) + ' +' + won(r.expected[0].amount) + '</span></div><p class="hint">입금일이 되면 잔액에 자동으로 더해져요. 안 들어왔으면 기록 → 공금통장에서 "안 들어왔어요"를 눌러 주세요.</p>';
  b1 += '</div>';
  h += sec('state', '01', 'TIME &amp; FUNDS', '남은 기간과 자금 상태', '', b1);

  // ===== 2. 지출 구성 =====
  var b2 = '';
  var scale = Math.max(r.planMonthly, r.burnMonthly > 0 ? r.burnMonthly : 0, r.recurringMonthly, 1);
  b2 += '<div class="sub-h" style="margin-top:2px"><h3>한 달 지출 비교</h3><small>월 기준</small></div><ul class="cmp">';
  b2 += '<li><div class="top"><span>계획 (설정한 월 지출)</span><span class="num">' + won(r.planMonthly) + '</span></div>' + barHtml(r.planMonthly / scale * 100) + '</li>';
  if (r.burnDaily == null) b2 += '<li><div class="top"><span>관측 (실제 소비 속도)</span><span>자료 부족</span></div><div class="none">잔액을 며칠 간격으로 두 번 이상 입력하면 계산돼요.</div></li>';
  else if (r.burnDaily <= 0) b2 += '<li><div class="top"><span>관측 (실제 소비 속도)</span><span>잔액이 늘었어요</span></div><div class="none">기록 안 된 입금이 있었을 수 있어요. 입금을 적어 주면 정확해져요. 런웨이는 계획 금액으로 계산해요.</div></li>';
  else b2 += '<li><div class="top"><span>관측 (실제 소비 속도)</span><span class="num ' + (r.burnMonthly > r.planMonthly * A.paceWarn ? 'bad' : '') + '">' + won(r.burnMonthly) + '</span></div>' + barHtml(r.burnMonthly / scale * 100, r.burnMonthly > r.planMonthly * A.paceWarn ? 'bad' : '') + '<div class="foot">하루 ' + won(r.burnDaily) + ' · 계획 대비 ' + (r.planMonthly > 0 ? Math.round(r.burnMonthly / r.planMonthly * 100) + '%' : '-') + ' · 잔액 기록 ' + r.burnDays + '일치' + (obsOk ? '' : ' (최소 ' + A.minBurnDays + '일 전이라 런웨이에는 아직 안 써요)') + '</div></li>';
  b2 += '<li><div class="top"><span>매달 들어오는 정기 입금</span><span class="num">' + won(r.recurringMonthly) + '</span></div>' + barHtml(r.recurringMonthly / scale * 100, 'warn') + (r.monthlyGap > 0 ? '<div class="foot">월 ' + won(r.mainMonthly) + ' 쓰면 매달 ' + won(r.monthlyGap) + '이 모자라요</div>' : '') + '</li></ul>';
  var spentM = Math.max(0, r.spentThisMonth), mp = r.planMonthly > 0 ? spentM / r.planMonthly * 100 : 0;
  b2 += '<div class="sub-h"><h3>이번 달</h3><small>' + r.ym.replace('-', '.') + ' · 추정</small></div><div class="cmp"><div class="top"><span>쓴 돈</span><span class="num">' + won(spentM) + ' <span class="sub">/ 계획 ' + man(r.planMonthly) + '</span></span></div>' + barHtml(mp, mp > 100 ? 'bad' : '') + '</div>';
  b2 += '<div class="sub-h"><h3>계획 대비 누적</h3><small>월 ' + man(r.planMonthly) + ' 계획 기준</small></div>';
  if (r.saved == null) b2 += '<div class="empty">' + (r.today < S.periodStart ? '계획 시작일(' + md(S.periodStart) + ')부터 잔액 기록으로 계산돼요.' : '공금통장 잔액을 입력하면 계산돼요.') + '</div>';
  else {
    var svTxt = (r.saved >= 0 ? '+' : '-') + won(Math.abs(r.saved));
    b2 += '<div class="savedbox"><span class="lbl">' + (r.saved >= 0 ? '지금까지 아낀 돈' : '지금까지 더 쓴 돈') + ' · ' + md(r.savedFrom) + '~오늘 ' + r.savedDays + '일</span><span class="big num ' + (r.saved >= 0 ? 'good' : 'bad') + nc(svTxt) + '">' + svTxt + '</span><p class="hint" style="margin-top:2px">계획대로면 ' + won(r.planToDate) + ' 쓸 걸 실제로 ' + won(r.spentToDate) + ' 썼어요 (잔액 변화로 계산)</p>';
    if (r.projectedSave != null) b2 += '<div class="kv" style="margin-top:8px"><span class="k">지금 속도면 ' + dl(S.targetDate, r.today) + '까지</span><span class="v ' + (r.projectedSave >= 0 ? 'good' : 'bad') + '">' + (r.projectedSave >= 0 ? '+' + won(r.projectedSave) + ' 아낌' : won(-r.projectedSave) + ' 더 씀') + '</span></div>';
    else b2 += '<p class="hint">잔액 기록이 ' + A.minBurnDays + '일치 쌓이면 목표일까지 얼마나 아낄지 예상해 드려요.</p>';
    b2 += '</div>';
  }
  var bks = [['life', '생활 (공동)', 'var(--c-life)'], ['personal', '개인 (택)', 'var(--c-personal)'], ['company', '회사', 'var(--c-company)']], bkHtml = '';
  bks.forEach(function (b) {
    var tot = +S.budgets[b[0]] || 0, rem = r.remaining[b[0]], used = r.used[b[0]], p = tot ? Math.max(0, rem) / tot * 100 : 0;
    if (!tot && !used) return;
    bkHtml += '<div class="bucket"><div class="top"><b><i style="background:' + b[2] + '"></i>' + b[1] + ' 남은 예산</b><span class="' + (rem < 0 ? 'bad' : '') + '">' + won(rem) + ' <em>/ ' + man(tot) + '</em></span></div><div class="bar"><i style="width:' + p.toFixed(1) + '%;background:' + (rem < 0 ? 'var(--bad)' : b[2]) + '"></i></div><p class="hint" style="margin-top:5px">쓴 돈 ' + won(used) + ' · 남은 비율 ' + Math.round(p) + '%</p></div>';
  });
  b2 += '<div class="sub-h"><h3>예산별 남은 돈</h3><small>목표 기간 전체</small></div>' + (bkHtml || '<div class="empty">설정한 예산이 없어요.</div>');
  b2 += '<div class="sub-h"><h3>앞으로 예정된 입금·출금</h3><small>' + (r.expected.length + r.planned.length) + '건</small></div><ul class="sched">';
  r.expected.slice(0, 3).forEach(function (e) { b2 += '<li><span class="d">' + esc(e.due) + '<small>' + esc(e.who) + ' 공금통장 입금</small></span><span class="a good">+' + won(e.amount) + '</span></li>'; });
  r.planned.slice(0, 8).forEach(function (x) { b2 += '<li><span class="d">' + esc(x.date) + '<small>' + (x.memo ? esc(x.memo) : '예정 출금') + '</small></span><span class="a bad">-' + won(x.amount) + '</span></li>'; });
  if (!r.expected.length && !r.planned.length) b2 += '<li><span class="d">예정된 입금·출금이 없어요.</span></li>';
  b2 += '</ul>';
  var sumSpend = '계획 월 ' + man(r.planMonthly) + ' · 관측 ' + (r.burnDaily != null && r.burnDaily > 0 ? '월 ' + man(r.burnMonthly) : '자료 부족') + ' · 이번 달 ' + man(spentM);
  h += sec('spend', '02', 'SPENDING', '지출 구성', '', b2, true, sumSpend);

  // ===== 3. 시나리오 =====
  var b3 = '<p class="sub" style="margin:0 0 6px">같은 자산으로 어떤 가정에서 언제 바닥나는지 비교해요. 막대는 오늘부터 바닥나는 날까지, 점선은 목표일이에요.</p>';
  var list = scenarios(r), dT = Math.max(1, C.diffDays(r.today, S.targetDate)), hz3 = dT;
  list.forEach(function (s) { if (!s.off && s.sim && s.sim.exhaust) hz3 = Math.max(hz3, C.diffDays(r.today, s.sim.exhaust)); });
  b3 += '<ul class="scs">';
  list.forEach(function (s) {
    var tag = (s.k === basis ? '<span class="tag">위 요약 기준</span>' : ''), tg = Math.min(99.5, dT / hz3 * 100);
    if (s.off || !havePx) { b3 += '<li class="sc off"><div class="sc-top"><b>' + s.name + '</b><span class="sc-val">' + (s.off || '시세 확인 중') + '</span></div><div class="tl"><i class="tl-fill dash" style="width:100%"></i><u class="tl-target" style="left:' + tg.toFixed(1) + '%"></u></div></li>'; return; }
    var ex = s.sim.exhaust, w = ex ? C.diffDays(r.today, ex) / hz3 * 100 : 100, ok = s.sim.survives;
    b3 += '<li class="sc"><div class="sc-top"><b>' + s.name + tag + '</b><span class="sc-val ' + (ok ? '' : 'bad') + '">' + (ex ? dl(ex, r.today) + ' · ' + C.monthsText(s.sim.months) : '5년 이상') + '</span></div><div class="tl"><i class="tl-fill' + (ok ? '' : ' bad') + '" style="width:' + Math.max(1.5, Math.min(100, w)).toFixed(1) + '%"></i><u class="tl-target" style="left:' + tg.toFixed(1) + '%"></u></div><p class="sc-sub">' + s.sub + (s.sim.atTarget != null ? ' · 목표일에 남는 돈 ' + won(s.sim.atTarget) : '') + '</p></li>';
  });
  b3 += '</ul>';
  if (havePx) {
    var eq = []; if (PRICES.SOL) eq.push('SOL ' + (Math.ceil(r.monthlyGap / PRICES.SOL * 100) / 100) + '개'); if (PRICES.WLD) eq.push('WLD ' + Math.ceil(r.monthlyGap / PRICES.WLD).toLocaleString('ko-KR') + '개');
    b3 += '<div class="need"><h3>코인에서 채워야 하는 돈</h3>';
    b3 += '<div class="kv"><span class="k">코인을 처음 팔아야 하는 날</span><span class="v">' + (r.jointOnly.exhaust ? ymd(r.jointOnly.exhaust) : '없음') + '</span></div>';
    if (r.monthlyGap > 0) b3 += '<div class="kv"><span class="k">매달 채울 돈</span><span class="v">월 ' + won(r.monthlyGap) + '<small>지금 시세로 ' + eq.join(' 또는 ') + '</small></span></div>';
    b3 += '<div class="kv"><span class="k">목표일까지 코인에서 나와야 하는 돈</span><span class="v">' + won(r.coinNeedToTarget) + (r.coinValue > 0 ? '<small>지금 코인의 ' + Math.round(r.coinNeedToTarget / r.coinValue * 100) + '%</small>' : '') + '</span></div>';
    b3 += '<p class="hint">계산값일 뿐 매도 권유가 아니에요. 코인 시세가 바뀌면 달라져요.</p></div>';
  }
  var sumScen = (r.pace ? '관측 ' + (r.pace.exhaust ? dl(r.pace.exhaust, r.today) : '5년+') : '관측 자료 부족') + ' · 계획 ' + (r.plan.exhaust ? dl(r.plan.exhaust, r.today) : '5년+') + ' · 코인 처음 파는 날 ' + (r.jointOnly.exhaust ? dl(r.jointOnly.exhaust, r.today) : '없음');
  h += sec('scen', '03', 'SCENARIOS', '시나리오 비교', '', b3, true, havePx ? sumScen : '시세를 받으면 계산돼요');

  // ===== 4. 가정과 계산 기준 =====
  var rec0 = (S.recurring && S.recurring[0]) || null;
  var L = [
    ['asm-sum', '숫자가 무엇을 합친 건가요', '<ul><li><b>확보 자금</b> = 코인(보유 수량 × 코인원 최근 체결가) + 공금통장 잔액(추정) + 현금 + 앞으로 들어올 정기 입금' + (rec0 && +rec0.amount > 0 ? ' (' + esc(rec0.who) + ' 매월 ' + won(rec0.amount) + ')' : '') + '</li><li><b>목표 자금</b> = 월 생활비' + (S.budgetAuto !== false && r.monthsInPeriod ? ' ' + man(S.monthly.life) + ' × ' + r.monthsInPeriod + '개월' : '') + ' + 개인 예산 + 회사 예산. 코인이 올라도 늘지 않아요.</li><li><b>여유·부족 자금</b> = 확보 자금 − 앞으로 필요한 돈(예산 − 쓴 돈)</li></ul>'],
    ['asm-obs', '관측 기준(실제 소비 속도)은 어떻게 나오나요', '<ul><li>잔액을 입력한 날 사이마다 <b>(직전 잔액 + 그 사이 들어온 돈 − 이번 잔액) ÷ 날짜</b>로 하루 소비를 구해요.</li><li>최근 90일 안의 구간만 쓰고, 잔액 기록이 <b>' + A.minBurnDays + '일 이상</b> 쌓여야 런웨이에 반영돼요 (지금 ' + r.burnDays + '일).</li><li>입력 사이에 잔액이 오히려 늘었으면 기록 안 된 입금이 있었다고 보고 계획 금액을 써요.</li><li>마지막 입력 뒤의 잔액은 그 뒤 들어온 돈을 더하고 하루 소비 × 지난 날을 뺀 <b>추정값</b>이에요.</li></ul>'],
    ['asm-sim', '런웨이는 어떻게 시뮬레이션하나요', '<ul><li>오늘부터 하루씩 한 달 소비를 날짜 수로 나눠 빼요. 예정 출금은 그날 빼고, 정기 입금은 그날 더해요.</li><li>돈이 0 아래로 내려가는 첫 날이 <b>바닥나는 날</b>이에요. 5년 넘게 안 내려가면 "5년 이상"이에요.</li><li>코인은 지금 시세 그대로 두고 계산해요. 가격 변동, 수수료, 세금은 반영하지 않아요.</li><li>"계획 기준"은 설정한 월 지출(' + man(r.planMonthly) + '), "관측 기준"은 실제 소비 속도를 써요.</li></ul>'],
    ['asm-alert', '경고와 알림 기준', '<ul><li>소비 속도가 계획의 <b>' + Math.round(A.paceWarn * 100) + '%</b>를 넘으면 주의, <b>' + Math.round(A.paceDanger * 100) + '%</b>를 넘으면 위험이에요.</li><li>목표일에 남는 돈이 <b>' + A.cushionMonths + '개월치</b> 미만이면 주의, 잔액을 <b>' + A.staleDays + '일</b> 넘게 안 적으면 안내, 공금통장이 <b>' + A.jointWarnDays + '일</b> 안에 바닥나면 알려요.</li><li>이 화면의 경고만 해당돼요. 텔레그램은 코인 급변 알림만 보내요.</li></ul>'],
    ['asm-limit', '이 화면의 한계', '<ul><li>기록하지 않은 지출과 입금은 반영되지 않아요. 잔액을 자주 입력할수록 정확해요.</li><li>코인 시세는 코인원 최근 체결가예요. 실제 판매 금액은 호가와 수수료에 따라 달라요.</li><li>시나리오는 통계가 아니라 단순 계산이고, 매도 권유가 아니에요.</li></ul>']
  ];
  var b4 = '';
  L.forEach(function (x) { b4 += '<details class="asm" data-k="' + x[0] + '"' + (OPEN[x[0]] ? ' open' : '') + '><summary>' + x[1] + '<i aria-hidden="true"></i></summary><div class="in">' + x[2] + '</div></details>'; });
  h += sec('basis', '04', 'ASSUMPTIONS', '가정과 계산 기준', '', b4, true, '확보 자금·관측 속도·시뮬레이션·알림·한계');
  h += '<footer class="pagefoot">택 앤 쭈 런웨이 · 수수료·세금 제외 · 투자 조언이 아니에요<br>RUNWAY 2026.10.02</footer>';

  var keepY = window.scrollY;
  $('#tab-home').innerHTML = h;
  var mc = $('#me-chip'); if (mc) mc.textContent = ME || '-';
  var jbE = $('#jbEdit'); if (jbE) jbE.onclick = editJointBalance;
  document.querySelectorAll('[data-jb]').forEach(function (b) { b.onclick = editJointBalance; });
  document.querySelectorAll('[data-gotab]').forEach(function (b) { b.onclick = function () { gotoTab(b.dataset.gotab); }; });
  document.querySelectorAll('[data-basis]').forEach(function (b) { b.onclick = function () { BASIS = b.dataset.basis; renderHome(); }; });
  document.querySelectorAll('details[data-k]').forEach(function (d) { d.addEventListener('toggle', function () { OPEN[d.dataset.k] = d.open; }); });
  bindSpark(sp);
  bindJump();
  document.querySelectorAll('.jump a').forEach(function (a) { a.addEventListener('click', function () { var t = document.querySelector(a.getAttribute('href')), d = t && t.querySelector('details.secd'); if (d && !d.open) { d.open = true; OPEN[d.dataset.k] = true; } }); });
  if (keepY) window.scrollTo(0, keepY);
}
function bindJump() {
  var links = document.querySelectorAll('.jump a'); if (!links.length || !('IntersectionObserver' in window)) return;
  if (bindJump.io) bindJump.io.disconnect();
  var secs = ['state', 'spend', 'scen', 'basis'].map(function (k) { return document.getElementById('sec-' + k); });
  bindJump.io = new IntersectionObserver(function (es) {
    es.forEach(function (e) { if (e.isIntersecting) { var i = secs.indexOf(e.target); links.forEach(function (a, j) { a.classList.toggle('on', i === j); }); } });
  }, { rootMargin: '-30% 0px -60% 0px' });
  secs.forEach(function (s) { if (s) bindJump.io.observe(s); });
}

// ---------- 설정: 목적별 묶음, 접기, 저장 범위 표시 (입력 칸 ID와 저장 코드는 그대로) ----------
function decorateSet() {
  var root = $('#tab-set'); if (!root) return;
  var r = calc(), S = r.settings, A = S.alert, rc0 = (S.recurring && S.recurring[0]) || null;
  var META = [
    ['시작 숫자', 'a', 'shared', S.confirmed ? '확인됨' : '확인 필요'],
    ['계획', 'b', 'shared', '월 ' + man(S.monthly.life) + ' · 목표일 ' + dl(S.targetDate, r.today)],
    ['정기 입금 예정', 'b', 'shared', rc0 && +rc0.amount > 0 ? esc(rc0.who) + ' 매월 ' + man(rc0.amount) : '꺼짐'],
    ['알림 기준', 'c', 'shared', '주의 ' + Math.round(A.paceWarn * 100) + '% · 위험 ' + Math.round(A.paceDanger * 100) + '%'],
    ['나와 공유', 'd', 'device', '이 기기 사용자: ' + esc(ME)],
    ['데이터', 'd', 'none', '백업 파일 내려받기']
  ];
  var GROUP = { a: ['내 숫자 바로잡기', '실제 코인 수량과 현금이 기록과 맞는지 확인해요'], b: ['계획과 입금', '런웨이 계산의 기준이 되는 값이에요'], c: ['알림', '홈 위쪽 경고를 띄우는 기준이에요'], d: ['이 기기와 데이터', '공유 주소, 사용자, 백업이에요'] };
  var SCOPE = { shared: '저장 범위: 둘 다에게 반영', device: '저장 범위: 이 기기만', none: '저장 안 함 · 파일로만' };
  var seen = {};
  [].slice.call(root.querySelectorAll('.card')).forEach(function (card) {
    var h3 = card.querySelector('h3'); if (!h3) return;
    var title = (h3.firstChild ? h3.firstChild.textContent : '').trim();
    var m = META.filter(function (x) { return title.indexOf(x[0]) === 0; })[0]; if (!m) return;
    if (!seen[m[1]]) { seen[m[1]] = 1; var g = document.createElement('div'); g.className = 'grp'; g.innerHTML = '<h2>' + GROUP[m[1]][0] + '</h2><p>' + GROUP[m[1]][1] + '</p>'; card.parentNode.insertBefore(g, card); }
    var key = 'set:' + m[0], open = !!OPEN[key];
    card.classList.add('fold'); if (!open) card.classList.add('closed');
    var head = document.createElement('button'); head.type = 'button'; head.className = 'fold-h'; head.setAttribute('aria-expanded', String(open));
    head.innerHTML = '<span class="fh-t"><b>' + m[0] + '</b><small>' + m[3] + '</small></span><span class="scope ' + m[2] + '">' + SCOPE[m[2]] + '</span><i aria-hidden="true"></i>';
    h3.hidden = true; card.insertBefore(head, h3);
    head.onclick = function () { var c = card.classList.toggle('closed'); head.setAttribute('aria-expanded', String(!c)); OPEN[key] = !c; };
  });
  var lab = { s_init: '이 숫자로 확정 · 둘 다에게 반영', s_adj: '맞추기 · 차이만큼 기록이 남아요', p_save: '계획 저장 · 둘 다에게 반영', r_save: '정기 입금 저장 · 둘 다에게 반영', a_save: '알림 기준 저장 · 둘 다에게 반영' };
  Object.keys(lab).forEach(function (id) { var b = document.getElementById(id); if (b) b.textContent = lab[id]; });
}
function editJointBalance() {
  var cur = calc();
  var v = prompt('토스뱅크(공금통장) 지금 잔액을 넣어 주세요' + (cur.lastAnchor ? '\n(지금 추정 ' + won(cur.balance) + ')' : ''), '');
  if (v == null || !String(v).trim()) return;
  var amt = parseNum(v); if (!isFinite(amt) || amt < 0) return toast('금액을 확인해 주세요');
  doSave(function (L) { L.records = L.records || []; L.records.push({ id: uid(), type: 'jbal', amount: amt, date: today(), by: ME, createdAt: nowIso() }); }, '공금통장 잔액 ' + won(amt), '잔액 ' + won(amt) + '을 저장했어요');
}

// ---------- 기록 ----------
var FORMS = {
  sale: { t: '매도', f: [['date', '판 날짜', 'date'], ['coin', '코인', 'coin'], ['qty', '판 수량 (개)', 'num'], ['price', '매도가 (1개 체결가)', 'won'], ['krw', '수수료 뗀 실제 입금액', 'won'], ['req', '연결할 요청 메모', 'req'], ['memo', '메모', 'text']] },
  jbal: { t: '잔액 입력', f: [['date', '잔액 확인한 날', 'date'], ['amount', '토스뱅크(공금통장) 잔액', 'won'], ['memo', '메모', 'text']] },
  joint: { t: '공금통장 입금', f: [['who', '입금자', 'who'], ['date', '입금일', 'date'], ['amount', '금액', 'won'], ['src', '돈 출처', 'src'], ['memo', '메모', 'text']] },
  expense: { t: '큰 지출', f: [['date', '날짜', 'date'], ['amount', '금액', 'won'], ['plan', '완료할 예정 출금', 'planned'], ['memo', '어디에 썼는지', 'text']] },
  planned: { t: '예정 출금', f: [['date', '나갈 날짜', 'date'], ['amount', '금액', 'won'], ['memo', '무엇인지', 'text']] }
};
function field(k, label, kind, def) {
  var id = 'fx_' + k, x = '<label class="f" for="' + id + '">' + label + '</label>';
  var recs = LEDGER.records || [];
  if (kind === 'date') return x + '<input id="' + id + '" type="date" value="' + today() + '">';
  if (kind === 'who') return x + '<select id="' + id + '"><option value="택"' + (ME === '택' ? ' selected' : '') + '>택</option><option value="쮸"' + (ME === '쮸' ? ' selected' : '') + '>쮸</option></select>';
  if (kind === 'src') return x + '<select id="' + id + '"><option value="own" selected>각자 개인 돈에서 (월급 등)</option><option value="pool">택 현금에서</option></select><div class="hint">쮸님 매월 1일 정기 입금은 자동으로 들어가니 따로 안 적어도 돼요. 그 외에 넣은 돈만 적어 주세요.</div>';
  if (kind === 'coin') return x + '<select id="' + id + '"><option value="SOL">SOL (솔라나)</option><option value="WLD">WLD (월드코인)</option></select>';
  if (kind === 'num') return x + '<input id="' + id + '" type="text" inputmode="decimal" placeholder="예: 3">';
  if (kind === 'won') return x + '<input id="' + id + '" type="text" inputmode="numeric" placeholder="원" value="' + (def ? def.toLocaleString('ko-KR') : '') + '">';
  if (kind === 'planned') { var ps = recs.filter(function (r) { return r.type === 'planned' && !r.canceled && !r.done; }); return x + '<select id="' + id + '"><option value="">없음</option>' + ps.map(function (p) { return '<option value="' + p.id + '">' + esc(p.date) + ' ' + won(p.amount) + (p.memo ? ' ' + esc(p.memo) : '') + '</option>'; }).join('') + '</select>'; }
  if (kind === 'req') { var ms = recs.filter(function (r) { return r.type === 'memo' && r.status === 'open' && !r.canceled; }); return x + '<select id="' + id + '"><option value="">없음</option>' + ms.map(function (m) { return '<option value="' + m.id + '">' + esc(m.by) + ': ' + esc(m.text.slice(0, 30)) + '</option>'; }).join('') + '</select>'; }
  return x + '<input id="' + id + '" type="text">';
}
function recLine(r) {
  var who = esc(r.by || ''), a = r.amount != null ? won(r.amount) : '';
  if (r.type === 'sale') return { t: '매도 ' + r.coin + ' ' + n2(r.qty) + '개 → ' + won(r.krw), s: r.date + ' · 매도가 ' + won(r.price) + ' · 수수료 ' + won(Math.max(0, r.qty * r.price - r.krw)) + ' · ' + (r.dest === 'cash' ? '내 계좌' : '공금통장') + ' · ' + who };
  if (r.type === 'jbal') return { t: '공금통장 잔액 ' + a, s: r.date + ' · ' + who + ' 입력' };
  if (r.type === 'joint') return { t: '공금통장 입금 ' + a + ' (' + (r.who || r.by || '') + ')', s: r.date + ' 입금 · ' + C.SRC[r.src || 'own'] + (r.who && r.by && r.who !== r.by ? ' · ' + who + ' 기록' : '') };
  if (r.type === 'expense') return { t: '큰 지출 ' + a, s: r.date + ' · ' + who };
  if (r.type === 'planned') return { t: '예정 출금 ' + a, s: r.date + ' 예정' + (r.done ? ' · 완료됨' : '') + ' · ' + who };
  if (r.type === 'skip') return { t: (r.who || '') + ' ' + (+String(r.month).slice(5)) + '월 정기 입금 안 들어옴', s: who + ' 표시' };
  if (r.type === 'card') return { t: '카드값 ' + a, s: r.month + ' 결제 · ' + who };
  if (r.type === 'corp_spend') return { t: '회사 사용액 ' + a, s: r.month + ' · ' + who };
  if (r.type === 'income') return { t: '현금 들어옴 ' + a, s: r.date + ' · ' + who };
  if (r.type === 'adjust') return { t: '잔액 맞추기 ' + ({ cash: '현금', corp: '법인', SOL: 'SOL', WLD: 'WLD' }[r.what]) + ' ' + (r.delta > 0 ? '+' : '') + (r.what === 'SOL' || r.what === 'WLD' ? n2(r.delta) + '개' : won(r.delta)), s: r.date + ' · ' + who };
  return { t: C.LABEL[r.type] + ' ' + a, s: (r.date || '') + ' · ' + who };
}
function renderRec() {
  var h = tabHead('RECORD', '기록', '무엇을 남길지 고르면 필요한 칸만 보여요. 기록은 지우지 않고 취소만 해요.') + '<div class="card"><h3>무엇을 기록할까요 <small>자주 쓰는 순서</small></h3><div class="rt-grid" role="group" aria-label="기록 종류">';
  var RT_ORDER = ['jbal', 'expense', 'joint', 'sale', 'planned'], RT_DESC = { jbal: '토스뱅크 잔액 확인', expense: '큰 지출 남기기', joint: '공금통장에 넣은 돈', sale: '코인을 판 기록', planned: '나갈 날짜가 정해진 돈' };
  RT_ORDER.forEach(function (k) { h += '<button type="button" data-rt="' + k + '" class="rt' + (k === RECTYPE ? ' on' : '') + '" aria-pressed="' + (k === RECTYPE) + '"><b>' + FORMS[k].t + '</b><small>' + RT_DESC[k] + '</small></button>'; });
  h += '</div><div id="recform">';
  var OPTF = { sale: ['date', 'req', 'memo'], jbal: ['date', 'memo'], joint: ['date', 'src', 'memo'], expense: ['date', 'plan', 'memo'], planned: ['memo'] }[RECTYPE], optH = '';
  FORMS[RECTYPE].f.forEach(function (f) { if (OPTF.indexOf(f[0]) >= 0) optH += field(f[0], f[1], f[2], f[3]); else h += field(f[0], f[1], f[2], f[3]); });
  h += '<details class="more" data-k="more-' + RECTYPE + '"' + (OPEN['more-' + RECTYPE] ? ' open' : '') + '><summary>더 입력 <span class="sub">' + (OPTF.indexOf('date') >= 0 ? '날짜는 오늘로 들어가요 · ' : '') + '선택</span><i aria-hidden="true"></i></summary>' + optH + '</details>';
  if (RECTYPE === 'sale') h += '<div class="hint" id="salehint"></div><div class="hint">판 수량만큼 코인이 줄고, 수수료 뗀 입금액만큼 공금통장 잔액이 늘어나요.</div>';
  if (RECTYPE === 'jbal') h += '<div class="hint">토스뱅크 앱에 보이는 잔액 그대로 넣어 주세요. 입력할 때마다 직전 입력 이후 쓴 돈이 계산돼서 소비 속도와 런웨이가 바뀌어요.</div>';
  if (RECTYPE === 'expense') h += '<div class="hint">안 적어도 잔액 변화로 쓴 돈이 잡혀요. 큰 지출을 따로 남겨 두고 싶을 때만 적어 주세요.</div>';
  h += '<button class="btn" id="recsave">저장</button></div></div>';
  var r = calc(), recs = (LEDGER.records || []).slice();

  // 공금통장: 잔액 기록과 입금 내역
  h += '<div class="card"><h3>공금통장 (토스뱅크) <small>지금 ' + won(r.balance) + '</small></h3>';
  h += '<div class="sub" style="margin-bottom:6px"><b>잔액 입력 기록</b> (입력 사이에 쓴 돈)</div>';
  if (!r.anchors.length) h += '<div class="sub">아직 없어요. 위에서 "잔액 입력"으로 넣어 주세요.</div>';
  else {
    var rows = r.anchors.map(function (a, i) { var iv = i > 0 ? r.intervals[i - 1] : null; return { a: a, iv: iv }; }).reverse(); var anchTotal = rows.length; rows = rows.slice(0, anchLimit);
    h += '<ul class="rc-list">';
    rows.forEach(function (x) { h += '<li class="rc"><div class="rc-top"><span class="rc-d">' + md(x.a.date) + ' · ' + esc(x.a.by || '') + ' 입력</span><b class="rc-v num">' + won(x.a.amount) + '</b></div>' + (x.iv ? '<div class="rc-sub"><span>들어온 돈 ' + won(x.iv.inflow) + '</span><span>쓴 돈 ' + won(x.iv.spend) + (x.iv.days ? ' (' + x.iv.days + '일, 하루 ' + won(x.iv.spend / x.iv.days) + ')' : '') + '</span></div>' : '<div class="rc-sub"><span>첫 기록</span></div>') + '</li>'; });
    h += '</ul>' + moreBtn('moreA', anchTotal, anchLimit);
  }
  // 입금 내역 (직접 적은 입금 + 정기 입금 자동분 + 안 들어온 달)
  var deps = [];
  recs.filter(function (x) { return x.type === 'joint' && !x.canceled; }).forEach(function (x) { deps.push({ date: x.date, who: x.who || x.by, amount: +x.amount, kind: '직접 기록', id: x.id }); });
  r.autoDeps.forEach(function (x) { deps.push({ date: x.due, who: x.who, amount: x.amount, kind: '정기 입금 (자동)', month: x.month }); });
  r.skipped.forEach(function (x) { deps.push({ date: x.due, who: x.who, amount: 0, kind: '안 들어옴 표시', skipId: x.rec.id }); });
  deps.sort(function (a, b) { return a.date < b.date ? 1 : -1; });
  var tot = {}; deps.forEach(function (d) { tot[d.who] = (tot[d.who] || 0) + d.amount; });
  h += '<div class="sub" style="margin:12px 0 6px"><b>입금 내역</b> · 누계 택 ' + won(tot['택'] || 0) + ' · 쮸 ' + won(tot['쮸'] || 0) + '</div><div class="list">';
  if (!deps.length) h += '<div class="sub">아직 입금이 없어요. 쮸님 정기 입금은 입금일이 되면 자동으로 여기 생겨요.</div>';
  deps.slice(0, 20).forEach(function (d) {
    h += '<div class="it"><div><div class="t">' + esc(d.who) + ' ' + (d.amount ? won(d.amount) : '') + '</div><div class="s">' + esc(d.date) + ' · ' + d.kind + '</div></div>';
    if (d.month) h += '<div><button class="mini" data-skip="' + esc(d.month) + '|' + esc(d.who) + '">안 들어왔어요</button></div>';
    if (d.skipId) h += '<div><button class="mini" data-unskip="' + d.skipId + '">되돌리기</button></div>';
    h += '</div>';
  });
  h += '</div></div>';

  // 매도 내역
  var sales = recs.filter(function (x) { return x.type === 'sale' && !x.canceled; }).sort(function (a, b) { return a.date < b.date ? 1 : -1; });
  h += '<div class="card"><h3>매도 내역 <small>판 돈 누계 ' + won(sales.reduce(function (s, x) { return s + (+x.krw || 0); }, 0)) + '</small></h3>';
  if (!sales.length) h += '<div class="sub">아직 매도 기록이 없어요.</div>';
  else { h += '<ul class="rc-list">'; sales.slice(0, saleLimit).forEach(function (x) { var fee = Math.max(0, x.qty * x.price - x.krw); h += '<li class="rc"><div class="rc-top"><span class="rc-d">' + esc(x.date.slice(5).replace('-', '/')) + ' · ' + x.coin + ' ' + n2(x.qty) + '개</span><b class="rc-v num">' + won(x.krw) + '</b></div><div class="rc-sub"><span>매도가 ' + won(x.price) + '</span><span>수수료 ' + won(fee) + '</span></div></li>'; }); h += '</ul>' + moreBtn('moreS', sales.length, saleLimit); }
  h += '</div>';

  // 전체 기록
  var all = recs.filter(function (x) { return x.type !== 'memo'; }).sort(function (a, b) { return (a.createdAt || '') < (b.createdAt || '') ? 1 : -1; });
  h += '<div class="card"><h3>전체 기록 <small>지우지 않고 취소만 돼요</small></h3><div class="list">';
  if (!all.length) h += '<div class="sub">아직 기록이 없어요.</div>';
  all.slice(0, histLimit).forEach(function (x) {
    var l = recLine(x);
    h += '<div class="it' + (x.canceled ? ' cx' : '') + '"><div><div class="t">' + esc(l.t) + '</div><div class="s">' + esc(l.s) + (x.memo ? ' · ' + esc(x.memo) : '') + (x.canceled ? ' · 취소됨(' + esc(x.canceled.by) + ')' : '') + '</div></div>';
    if (!x.canceled) h += '<div>' + (x.type === 'planned' && !x.done ? '<button class="mini" data-done="' + x.id + '">완료</button> ' : '') + '<button class="mini" data-cancel="' + x.id + '">취소</button></div>';
    h += '</div>';
  });
  if (all.length > histLimit) h += '<button class="btn gray" id="more">더 보기</button>';
  h += '</div></div>';
  $('#tab-rec').innerHTML = h;
  bindMore();
  document.querySelectorAll('#tab-rec details[data-k]').forEach(function (d) { d.addEventListener('toggle', function () { OPEN[d.dataset.k] = d.open; }); });
  document.querySelectorAll('[data-rt]').forEach(function (b) { b.onclick = function () { RECTYPE = b.dataset.rt; renderRec(); }; });
  document.querySelectorAll('input[inputmode=numeric]').forEach(function (i) { i.onblur = function () { var v = parseNum(i.value); if (isFinite(v)) i.value = v.toLocaleString('ko-KR'); }; });
  if (RECTYPE === 'sale') setupSaleForm();
  $('#recsave').onclick = submitRec;
  document.querySelectorAll('[data-cancel]').forEach(function (b) { b.onclick = function () { cancelRec(b.dataset.cancel); }; });
  document.querySelectorAll('[data-done]').forEach(function (b) { b.onclick = function () { var id = b.dataset.done; doSave(function (L) { var p = L.records.find(function (x) { return x.id === id; }); if (p) p.done = { at: nowIso(), by: ME }; }, '예정 출금 완료', '완료 처리했어요'); }; });
  document.querySelectorAll('[data-skip]').forEach(function (b) { b.onclick = function () {
    var p = b.dataset.skip.split('|'); if (!confirm(p[1] + ' ' + (+p[0].slice(5)) + '월 정기 입금이 안 들어왔나요? 공금통장 잔액과 확보 자금에서 빠져요.')) return;
    doSave(function (L) { L.records.push({ id: uid(), type: 'skip', month: p[0], who: p[1], by: ME, createdAt: nowIso(), date: today() }); }, '정기 입금 안 들어옴: ' + p[0], '안 들어온 걸로 표시했어요');
  }; });
  document.querySelectorAll('[data-unskip]').forEach(function (b) { b.onclick = function () { var id = b.dataset.unskip; doSave(function (L) { var s = L.records.find(function (x) { return x.id === id; }); if (s) s.canceled = { by: ME, at: nowIso() }; }, '정기 입금 안 들어옴 되돌리기', '되돌렸어요'); }; });
  var more = $('#more'); if (more) more.onclick = function () { histLimit += 50; renderRec(); };
}
function setupSaleForm() {
  var coin = $('#fx_coin'), qty = $('#fx_qty'), price = $('#fx_price'), krw = $('#fx_krw'), manual = false;
  function fillPrice() { var p = PRICES[coin.value]; if (p != null) price.value = p.toLocaleString('ko-KR'); calc2(); }
  function calc2() {
    var q = parseNum(qty.value), p = parseNum(price.value), k = parseNum(krw.value);
    var gross = isFinite(q) && isFinite(p) ? Math.round(q * p) : NaN;
    if (!manual && isFinite(gross)) { krw.value = gross.toLocaleString('ko-KR'); k = gross; }
    var t = '';
    if (isFinite(gross)) t += '판 금액 ' + won(gross);
    if (isFinite(gross) && isFinite(k) && manual) t += ' · 수수료 ' + won(gross - k) + ' (' + (gross ? ((gross - k) / gross * 100).toFixed(2) : 0) + '%)';
    if (PRICES[coin.value] != null) t += (t ? ' · ' : '') + '지금 코인원 시세 ' + won(PRICES[coin.value]);
    $('#salehint').textContent = t + (manual ? '' : ' · 실제 입금액은 수수료를 빼고 고쳐 주세요');
  }
  coin.onchange = fillPrice; qty.oninput = calc2; price.oninput = calc2; krw.oninput = function () { manual = true; calc2(); };
  fillPrice();
}
async function submitRec() {
  var t = RECTYPE, g = function (k) { var el = $('#fx_' + k); return el ? el.value : ''; };
  var rec = { id: uid(), type: t, by: ME, createdAt: nowIso() };
  var memo = g('memo').trim(); if (memo) rec.memo = memo;
  var planId = g('plan'), reqId = g('req');
  rec.date = g('date');
  if (!rec.date) return toast('날짜를 넣어 주세요');
  if (t === 'sale') {
    rec.coin = g('coin'); rec.qty = parseNum(g('qty')); rec.price = parseNum(g('price')); rec.krw = parseNum(g('krw')); rec.dest = 'joint';
    if (!(rec.qty > 0) || !(rec.price > 0) || !(rec.krw > 0)) return toast('수량, 매도가, 실제 입금액을 넣어 주세요');
    var hold = calc().hold[rec.coin]; if (rec.qty > hold + 1e-9) return toast(rec.coin + ' 보유(' + n2(hold) + '개)보다 많이 팔 수 없어요');
  } else {
    rec.amount = parseNum(g('amount'));
    if (!(rec.amount >= 0) || (t !== 'jbal' && !(rec.amount > 0))) return toast('금액을 넣어 주세요');
    if (t === 'joint') { rec.who = g('who'); rec.src = g('src'); }
    if (t === 'expense') rec.bucket = 'life';
    if (t === 'planned') rec.kind = 'other';
  }
  var btn = $('#recsave'); btn.disabled = true; btn.textContent = '저장 중...';
  var label = FORMS[t].t + ' ' + (t === 'sale' ? rec.coin + ' ' + rec.qty + '개' : won(rec.amount));
  var ok = await doSave(function (L) {
    L.records = L.records || [];
    L.records.push(rec);
    if (planId) { var p = L.records.find(function (x) { return x.id === planId; }); if (p) p.done = { recordId: rec.id, at: nowIso(), by: ME }; }
    if (reqId) { var m = L.records.find(function (x) { return x.id === reqId; }); if (m) { m.status = 'done'; m.doneRecordId = rec.id; m.doneBy = ME; m.doneAt = nowIso(); } }
  }, '기록: ' + label, label + ' 저장했어요');
  if (!ok) { btn.disabled = false; btn.textContent = '저장'; }
}
function cancelRec(id) {
  var r = (LEDGER.records || []).find(function (x) { return x.id === id; }); if (!r) return;
  if (!confirm('"' + recLine(r).t + '" 기록을 취소할까요? (기록은 지워지지 않고 취소로 남아요)')) return;
  doSave(function (L) {
    var ids = [id]; var me = L.records.find(function (x) { return x.id === id; }); if (me && me.linked) ids.push(me.linked);
    L.records.forEach(function (x) {
      if (ids.indexOf(x.id) >= 0 && !x.canceled) x.canceled = { by: ME, at: nowIso() };
      if (x.type === 'planned' && x.done && ids.indexOf(x.done.recordId) >= 0) delete x.done;
      if (x.type === 'memo' && x.doneRecordId && ids.indexOf(x.doneRecordId) >= 0) { x.status = 'open'; delete x.doneRecordId; delete x.doneBy; delete x.doneAt; }
    });
  }, '취소: ' + recLine(r).t, '취소했어요');
}

// ---------- 메모 ----------
function renderMemo() {
  var recs = LEDGER.records || [];
  var memos = recs.filter(function (r) { return r.type === 'memo' && !r.canceled; }).sort(function (a, b) { return (a.createdAt || '') < (b.createdAt || '') ? 1 : -1; });
  var h = tabHead('MEMO', '메모', '결정(요청)과 실제 실행(매도 기록)을 따로 남겨요.') + '<div class="card"><h3>요청 남기기</h3><textarea id="mtext" placeholder="예: 10월 생활비 - SOL 5개 정도 매도하면 될 듯"></textarea><button class="btn" id="madd">요청으로 남기기</button><div class="hint">결정(요청)과 실제 실행(매도 기록)이 따로 남아요. 매도를 기록할 때 이 요청을 연결하면 자동으로 완료돼요.</div></div>';
  var open = memos.filter(function (m) { return m.status === 'open'; }), done = memos.filter(function (m) { return m.status !== 'open'; });
  h += '<div class="card"><h3>진행 중인 요청 <small>' + open.length + '건</small></h3><div class="list">';
  if (!open.length) h += '<div class="sub">진행 중인 요청이 없어요.</div>';
  open.forEach(function (m) { h += '<div class="it"><div><div class="t">' + esc(m.text) + '</div><div class="s">' + esc(m.by) + ' · ' + esc((m.createdAt || '').slice(0, 10)) + '</div></div><div><button class="mini" data-mdone="' + m.id + '">완료</button> <button class="mini" data-mclose="' + m.id + '">닫기</button></div></div>'; });
  h += '</div></div><div class="card"><h3>끝난 요청</h3><div class="list">';
  if (!done.length) h += '<div class="sub">아직 없어요.</div>';
  done.slice(0, 30).forEach(function (m) {
    var link = m.doneRecordId ? recs.find(function (x) { return x.id === m.doneRecordId; }) : null;
    var res = m.status === 'done' ? '완료' + (link ? ' / ' + won(link.krw != null ? link.krw : link.amount) : '') : '닫음';
    h += '<div class="it"><div><div class="t">' + esc(m.text) + '</div><div class="s">' + esc(m.by) + ' 요청 · ' + res + (m.doneBy ? ' (' + esc(m.doneBy) + ')' : '') + '</div></div></div>';
  });
  h += '</div></div>';
  $('#tab-memo').innerHTML = h;
  $('#madd').onclick = function () {
    var t = $('#mtext').value.trim(); if (!t) return toast('내용을 적어 주세요');
    doSave(function (L) { L.records = L.records || []; L.records.push({ id: uid(), type: 'memo', text: t, status: 'open', by: ME, createdAt: nowIso(), date: today() }); }, '요청: ' + t.slice(0, 20), '요청을 남겼어요');
  };
  document.querySelectorAll('[data-mdone]').forEach(function (b) { b.onclick = function () { memoDone(b.dataset.mdone); }; });
  document.querySelectorAll('[data-mclose]').forEach(function (b) { b.onclick = function () { var id = b.dataset.mclose; doSave(function (L) { var m = L.records.find(function (x) { return x.id === id; }); if (m) { m.status = 'closed'; m.doneBy = ME; m.doneAt = nowIso(); } }, '요청 닫기', '닫았어요'); }; });
}
function memoDone(id) {
  var recent = (LEDGER.records || []).filter(function (r) { return r.type !== 'memo' && r.type !== 'planned' && !r.canceled; }).sort(function (a, b) { return (a.createdAt || '') < (b.createdAt || '') ? 1 : -1; }).slice(0, 15);
  var opts = recent.map(function (r, i) { return (i + 1) + '. ' + recLine(r).t; }).join('\n');
  var pick = prompt('어떤 기록으로 완료했나요? 번호를 넣어 주세요 (기록 없이 완료는 0)\n\n' + opts, recent.length ? '1' : '0');
  if (pick == null) return;
  var i = parseInt(pick, 10); var link = i > 0 ? recent[i - 1] : null;
  doSave(function (L) { var m = L.records.find(function (x) { return x.id === id; }); if (m) { m.status = 'done'; m.doneBy = ME; m.doneAt = nowIso(); if (link) m.doneRecordId = link.id; } }, '요청 완료', '완료로 표시했어요');
}

// ---------- 설정 ----------
function renderSet() {
  var S = C.defaults(JSON.parse(JSON.stringify(LEDGER.settings || {}))), I = S.initial || {}, A = S.alert;
  var hasRecs = (LEDGER.records || []).some(function (r) { return r.type !== 'memo' && !r.canceled; });
  var r = calc();
  var h = tabHead('SETTINGS', '설정', '시작 숫자, 계획, 정기 입금, 알림 기준을 바꿔요.') + '<div class="card"><h3>시작 숫자 <small>' + (S.confirmed ? '확인됨' : '확인 필요') + '</small></h3>';
  if (!hasRecs) {
    h += '<div class="sub">기록을 시작하기 전 실제 숫자를 넣어 주세요. 코인은 여러 거래소 것을 모두 합쳐서요.</div>';
    h += '<label class="f">기준일</label><input id="s_asOf" type="date" value="' + esc(I.asOf || today()) + '">';
    h += '<label class="f">SOL 수량</label><input id="s_SOL" inputmode="decimal" value="' + (I.SOL || 0) + '">';
    h += '<label class="f">WLD 수량</label><input id="s_WLD" inputmode="decimal" value="' + (I.WLD || 0) + '">';
    h += '<label class="f">현금 (쓸 수 있는 원화)</label><input id="s_cash" inputmode="numeric" value="' + (+I.cash || 0).toLocaleString('ko-KR') + '">';
    if (+S.budgets.company > 0) h += '<label class="f">법인 계좌 잔액</label><input id="s_corp" inputmode="numeric" value="' + (+I.corpBalance || 0).toLocaleString('ko-KR') + '">';
    h += '<button class="btn" id="s_init">이 숫자로 확정</button>';
  } else {
    h += '<div class="sub">지금 계산상 SOL ' + n2(r.hold.SOL) + '개, WLD ' + n2(r.hold.WLD) + '개' + (r.cash ? ', 현금 ' + won(r.cash) : '') + (+S.budgets.company > 0 ? ', 법인 ' + won(r.corp) : '') + '. 공금통장 잔액은 기록 → 잔액 입력으로 맞춰요. 실제와 다르면 실제 숫자를 넣어 맞춰 주세요 (차이만큼 기록이 남아요).</div>';
    [['SOL', '지금 실제 SOL 수량'], ['WLD', '지금 실제 WLD 수량'], ['cash', '지금 실제 현금 (공금통장 말고 따로 있는 돈)']].concat(+S.budgets.company > 0 ? [['corp', '지금 실제 법인 잔액']] : []).forEach(function (x) { h += '<label class="f">' + x[1] + '</label><input id="adj_' + x[0] + '" inputmode="decimal" placeholder="바뀐 것만 넣기">'; });
    h += '<button class="btn" id="s_adj">맞추기</button>';
    if (!S.confirmed) h += '<button class="btn gray" id="s_conf">지금 숫자가 맞아요 (확인 완료)</button>';
  }
  h += '</div>';
  h += '<div class="card"><h3>계획</h3>';
  h += '<label class="f">계획 시작일</label><input id="p_start" type="date" value="' + esc(S.periodStart) + '">';
  h += '<label class="f">목표일 (이 날 전까지 버티기)</label><input id="p_target" type="date" value="' + esc(S.targetDate) + '">';
  h += '<label class="f">생활(공동) 목표자금</label><div class="sub" style="padding:10px 0">월 생활비 × 목표 기간 개월 수로 자동 계산돼요. 지금 ' + won(r.budgetTotal - (+S.budgets.personal || 0) - (+S.budgets.company || 0)) + ' (월 ' + man(S.monthly.life) + ' × ' + r.monthsInPeriod + '개월)</div>';
  h += '<label class="f">개인 예산 총액</label><input id="p_bp" inputmode="numeric" value="' + (+S.budgets.personal).toLocaleString('ko-KR') + '">';
  h += '<label class="f">회사 예산 총액</label><input id="p_bc" inputmode="numeric" value="' + (+S.budgets.company).toLocaleString('ko-KR') + '">';
  h += '<label class="f">월 생활비 (공금통장에서 쓸 수 있는 돈)</label><input id="p_ml" inputmode="numeric" value="' + (+S.monthly.life).toLocaleString('ko-KR') + '">';
  h += '<label class="f">월 개인비 계획 (0이면 계산에서 빠짐)</label><input id="p_mp" inputmode="numeric" value="' + (+S.monthly.personal).toLocaleString('ko-KR') + '">';
  h += '<button class="btn" id="p_save">계획 저장</button></div>';
  var rc = (S.recurring && S.recurring[0]) || { who: '쮸', amount: 0, day: 1, from: S.periodStart.slice(0, 7), to: C.addMonths(S.targetDate.slice(0, 7), -1) };
  h += '<div class="card"><h3>정기 입금 예정 <small>확보 자금과 런웨이에 들어가요</small></h3>';
  h += '<label class="f">누가</label><select id="r_who"><option value="쮸"' + (rc.who === '쮸' ? ' selected' : '') + '>쮸</option><option value="택"' + (rc.who === '택' ? ' selected' : '') + '>택</option></select>';
  h += '<label class="f">매월 금액 (0이면 끄기)</label><input id="r_amt" inputmode="numeric" value="' + (+rc.amount || 0).toLocaleString('ko-KR') + '">';
  h += '<label class="f">매월 입금일</label><input id="r_day" inputmode="numeric" value="' + (rc.day || 1) + '">';
  h += '<label class="f">시작 월 / 끝 월</label><div class="two"><input id="r_from" type="month" value="' + esc(rc.from) + '"><input id="r_to" type="month" value="' + esc(rc.to) + '"></div>';
  h += '<div class="hint">입금일이 지나면 공금통장 잔액에 자동으로 더해지고, 그 전까지는 "쮸 입금 예정"으로 확보 자금에 들어가요. 안 들어온 달은 기록 → 공금통장에서 "안 들어왔어요"를 눌러 주세요.</div>';
  h += '<button class="btn" id="r_save">정기 입금 저장</button></div>';
  h += '<div class="card"><h3>알림 기준</h3>';
  h += '<label class="f">소비 속도 주의 / 위험 (계획 대비 %)</label><div class="two"><input id="a_pw" inputmode="numeric" value="' + Math.round(A.paceWarn * 100) + '"><input id="a_pd" inputmode="numeric" value="' + Math.round(A.paceDanger * 100) + '"></div>';
  h += '<label class="f">목표일 여유 기준 (몇 달치)</label><input id="a_cu" inputmode="decimal" value="' + A.cushionMonths + '">';
  h += '<label class="f">잔액 입력 알림 (마지막 입력 후 며칠 지나면)</label><input id="a_st" inputmode="numeric" value="' + A.staleDays + '">';
  h += '<label class="f">공금통장 바닥 알림 (며칠 전부터)</label><input id="a_jw" inputmode="numeric" value="' + A.jointWarnDays + '">';
  h += '<label class="f">소비 속도를 런웨이에 쓰기 시작할 기록 일수</label><input id="a_mb" inputmode="numeric" value="' + A.minBurnDays + '">';
  h += '<button class="btn" id="a_save">알림 기준 저장</button>';
  h += '<div class="hint">위 기준은 이 화면 위쪽 경고에 쓰여요. 텔레그램으로는 코인 급변 알림만 가요.</div></div>';
  h += '<div class="card"><h3>나와 공유</h3>';
  h += '<div class="row"><span class="k">이 기기 사용자</span><span class="v">' + esc(ME) + ' <button class="mini" id="d_me">바꾸기</button></span></div>';
  h += '<div class="sub" style="margin-top:8px">이 주소를 열면 로그인 없이 바로 쮸/택을 고르고 쓸 수 있어요.</div>';
  h += '<button class="btn" id="d_copy">주소 복사</button><button class="btn gray" id="d_qr">QR 보기</button><div id="d_out"></div>';
  h += '<div class="hint">주소를 아는 사람은 누구나 보고 기록할 수 있어요. 기록은 지워지지 않고 취소만 돼서, 잘못 들어가도 되돌릴 수 있어요.</div></div>';
  h += '<div class="card"><h3>데이터</h3><div class="sub">모든 기록은 비공개 저장소(runway-data)에 저장되고, 바뀔 때마다 변경 이력이 남아요.</div><button class="btn gray" id="x_dl">기록 파일 내려받기 (백업)</button></div>';
  $('#tab-set').innerHTML = h;
  decorateSet();
  var v = function (id) { var el = $('#' + id); return el ? el.value : ''; };
  var si = $('#s_init'); if (si) si.onclick = function () {
    var ini = Object.assign({}, I, { asOf: v('s_asOf'), SOL: parseNum(v('s_SOL')) || 0, WLD: parseNum(v('s_WLD')) || 0, cash: parseNum(v('s_cash')) || 0, corpBalance: parseNum(v('s_corp')) || +I.corpBalance || 0 });
    doSave(function (L) { L.settings.initial = ini; L.settings.confirmed = true; }, '시작 숫자 확정', '시작 숫자를 확정했어요');
  };
  var sa = $('#s_adj'); if (sa) sa.onclick = function () {
    var cur = calc(), recs = [];
    [['cash', cur.cash], ['SOL', cur.hold.SOL], ['WLD', cur.hold.WLD], ['corp', cur.corp]].forEach(function (x) {
      var val = parseNum(v('adj_' + x[0])); if (!isFinite(val)) return;
      var d = Math.round((val - x[1]) * 10000) / 10000; if (!d) return;
      recs.push({ id: uid(), type: 'adjust', what: x[0], delta: d, date: today(), by: ME, createdAt: nowIso() });
    });
    if (!recs.length) return toast('바뀐 숫자가 없어요');
    doSave(function (L) { recs.forEach(function (x) { L.records.push(x); }); }, '잔액 맞추기', '실제 숫자에 맞췄어요');
  };
  var sc = $('#s_conf'); if (sc) sc.onclick = function () { doSave(function (L) { L.settings.confirmed = true; }, '시작 숫자 확인', '확인 완료로 표시했어요'); };
  $('#p_save').onclick = function () {
    var ns = { periodStart: v('p_start'), targetDate: v('p_target'), budgetAuto: true, budgets: { life: 0, personal: parseNum(v('p_bp')), company: parseNum(v('p_bc')) }, monthly: { life: parseNum(v('p_ml')), personal: parseNum(v('p_mp')) } };
    var mo = 0; if (ns.periodStart && ns.targetDate && ns.targetDate > ns.periodStart) { for (var mm = ns.periodStart.slice(0, 7); mm <= C.addDays(ns.targetDate, -1).slice(0, 7); mm = C.addMonths(mm, 1)) mo++; } ns.budgets.life = (ns.monthly.life || 0) * mo;
    if (!ns.periodStart || !ns.targetDate || ns.targetDate <= ns.periodStart) return toast('날짜를 확인해 주세요');
    if ([ns.budgets.personal, ns.budgets.company, ns.monthly.life, ns.monthly.personal].some(function (x) { return !isFinite(x) || x < 0; })) return toast('금액을 확인해 주세요');
    doSave(function (L) { Object.assign(L.settings, ns); }, '계획 변경', '계획을 저장했어요');
  };
  $('#r_save').onclick = function () {
    var nr = { who: v('r_who'), amount: parseNum(v('r_amt')) || 0, day: Math.min(28, Math.max(1, parseNum(v('r_day')) || 1)), from: v('r_from'), to: v('r_to') };
    if (nr.amount > 0 && (!nr.from || !nr.to || nr.to < nr.from)) return toast('시작 월과 끝 월을 확인해 주세요');
    doSave(function (L) { L.settings.recurring = nr.amount > 0 ? [nr] : []; }, '정기 입금 예정 변경', '정기 입금을 저장했어요');
  };
  $('#a_save').onclick = function () {
    var na = { paceWarn: parseNum(v('a_pw')) / 100, paceDanger: parseNum(v('a_pd')) / 100, cushionMonths: parseNum(v('a_cu')), staleDays: parseNum(v('a_st')), jointWarnDays: parseNum(v('a_jw')), minBurnDays: Math.max(1, parseNum(v('a_mb'))) };
    if (Object.keys(na).some(function (k) { return !isFinite(na[k]) || na[k] < 0; })) return toast('숫자를 확인해 주세요');
    doSave(function (L) { L.settings.alert = Object.assign(L.settings.alert || {}, na); }, '알림 기준 변경', '알림 기준을 저장했어요');
  };
  $('#d_me').onclick = function () { var other = ME === '택' ? '쮸' : '택'; if (confirm('이 기기 사용자를 ' + other + '(으)로 바꿀까요?')) { localStorage.setItem('runway.me', other); ME = other; var mc2 = $('#me-chip'); if (mc2) mc2.textContent = ME; toast('이제 ' + other + '(으)로 기록돼요'); renderSet(); } };
  $('#d_copy').onclick = function () { navigator.clipboard.writeText(pageUrl()).then(function () { toast('주소를 복사했어요'); }, function () { prompt('아래 주소를 복사해 주세요', pageUrl()); }); };
  $('#d_qr').onclick = function () { var q = qrcode(0, 'M'); q.addData(pageUrl()); q.make(); $('#d_out').innerHTML = '<div class="qr">' + q.createSvgTag({ cellSize: 5, margin: 2, scalable: true }) + '</div><div class="hint">휴대폰 카메라로 찍으면 바로 열려요.</div>'; };
  $('#x_dl').onclick = function () { var a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([JSON.stringify(LEDGER, null, 1)], { type: 'application/json' })); a.download = 'runway-ledger-' + today() + '.json'; a.click(); };
}

['pointerdown', 'touchstart', 'touchmove', 'wheel'].forEach(function (ev) { document.addEventListener(ev, function () { lastTouch = Date.now(); }, { passive: true }); });
boot();
})();
