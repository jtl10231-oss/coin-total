/* 쮸앤택 Runway 화면 동작 */
(function () {
'use strict';
var API = 'https://script.google.com/macros/s/AKfycbxVJypN_d3BeLrL3-y1Z453t95wdB3xRlRg72umD_-phS1Beq1sVVFB4Ay-sbSYR_6Wmg/exec'; // 구글 Apps Script 중계 서버 (열쇠는 서버에만 있음)
var C = window.RunwayCore;
var ME = null, LEDGER = null, SHA = null, PRICES = { SOL: null, WLD: null }, PRICE_AT = null;
var TAB = 'home', RECTYPE = 'sale', rendering = false, histLimit = 30;
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
async function readLedger() {
  var r = await fetch(API + '?t=' + Date.now(), { cache: 'no-store' });
  var j = await r.json();
  if (!j.ok) throw new Error('불러오기 실패' + (j.status ? ' (HTTP ' + j.status + ')' : ''));
  try { localStorage.setItem('runway.cache', JSON.stringify({ data: j.data, sha: j.sha, at: Date.now() })); } catch (e) {}
  return { data: j.data, sha: j.sha };
}
async function save(mutate, msg) {
  for (var i = 0; i < 4; i++) {
    var cur = await readLedger();
    var next = JSON.parse(JSON.stringify(cur.data));
    mutate(next);
    next.updatedAt = nowIso();
    var r = await fetch(API, { method: 'POST', body: JSON.stringify({ content: JSON.stringify(next, null, 1), sha: cur.sha, message: msg + ' (' + ME + ')' }) });
    var j = await r.json();
    if (j.ok) { LEDGER = next; SHA = j.sha; try { localStorage.setItem('runway.cache', JSON.stringify({ data: next, sha: j.sha, at: Date.now() })); } catch (e) {} return true; }
    if (j.error === 'records cannot shrink') throw new Error('기록은 지울 수 없어요 (취소만 돼요)');
    if (j.status !== 409 && j.status !== 422) throw new Error('저장 실패' + (j.status ? ' (HTTP ' + j.status + ')' : j.error ? ' (' + j.error + ')' : ''));
    await sleep(500 * (i + 1));
  }
  throw new Error('동시에 저장이 겹쳤어요. 잠시 후 다시 해 주세요.');
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
  setTimeout(function () { homeQueued = false; renderHome(); }, Math.max(0, 1500 - (Date.now() - lastHome)));
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
  if (cached && cached.data) { LEDGER = cached.data; SHA = cached.sha; renderAll(); }
  else $('#tab-home').innerHTML = '<div class="card sub">불러오는 중...</div>';
  if (!wsStarted) { wsStarted = true; connectWS(); seedPrices(); }
  try { var f = await readLedger(); LEDGER = f.data; SHA = f.sha; renderAll(); }
  catch (e) { if (!LEDGER) $('#tab-home').innerHTML = '<div class="card">불러오지 못했어요: ' + esc(e.message) + ' <button class="mini" onclick="location.reload()">다시</button></div>'; else toast('최신 기록을 못 불러왔어요. 잠시 후 다시 시도해요'); }
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
function renderAll() { if (!LEDGER) return; if (TAB === 'home') renderHome(); if (TAB === 'rec') renderRec(); if (TAB === 'memo') renderMemo(); if (TAB === 'set') renderSet(); }
function calc() { return C.compute(LEDGER, PRICES, Date.now()); }
function lv(l) { return { ok: '정상', info: '정상', warn: '주의', danger: '위험' }[l]; }
function pct(v) { return v == null ? '-' : (v * 100).toFixed(1) + '%'; }
function man(v) { return Math.round(v / 10000).toLocaleString('ko-KR') + '만'; }

// ---------- 홈 ----------
function md(d) { return (+d.slice(5, 7)) + '/' + (+d.slice(8, 10)); }
function donut(parts, total) {
  var C2 = 2 * Math.PI * 49, acc = 0, s = '<svg viewBox="0 0 140 140" class="donut"><circle cx="70" cy="70" r="49" fill="none" stroke="#edf0f4" stroke-width="22"/>';
  var tot = parts.reduce(function (a, p) { return a + Math.max(0, p.v); }, 0) || 1;
  parts.forEach(function (p) {
    var f = Math.max(0, p.v) / tot; if (f <= 0) return;
    s += '<circle cx="70" cy="70" r="49" fill="none" stroke="' + p.c + '" stroke-width="22" stroke-dasharray="' + (f * C2).toFixed(2) + ' ' + (C2 - f * C2).toFixed(2) + '" stroke-dashoffset="' + (-acc * C2).toFixed(2) + '" transform="rotate(-90 70 70)"/>';
    acc += f;
  });
  s += '<text x="70" y="64" text-anchor="middle" font-size="10" fill="#6b7280">확보 자금</text>';
  s += '<text x="70" y="81" text-anchor="middle" font-size="14" font-weight="700" fill="#17202e">' + man(total) + '</text></svg>';
  return s;
}
function spark(r) {
  var pts = [];
  r.anchors.forEach(function (a) { if (pts.length && pts[pts.length - 1].d === a.date) pts[pts.length - 1].v = a.amount; else pts.push({ d: a.date, v: a.amount }); });
  if (r.lastAnchor && r.today > r.lastAnchor.date) pts.push({ d: r.today, v: r.balance, est: true });
  if (pts.length < 2) return '';
  var t = function (d) { return Date.parse(d + 'T00:00:00Z'); };
  var x0 = t(pts[0].d), x1 = t(pts[pts.length - 1].d); if (x1 === x0) return '';
  var vs = pts.map(function (p) { return p.v; }), lo = Math.min.apply(null, vs), hi = Math.max.apply(null, vs); if (hi === lo) { hi += 1; lo -= 1; }
  var W = 320, H = 70, P = 6, X = function (d) { return P + (W - 2 * P) * (t(d) - x0) / (x1 - x0); }, Y = function (v) { return H - 16 - (H - 26) * (v - lo) / (hi - lo); };
  var solid = pts.filter(function (p) { return !p.est; }), s = '<svg viewBox="0 0 ' + W + ' ' + H + '" class="spark">';
  if (solid.length > 1) s += '<polyline fill="none" stroke="#0ea5e9" stroke-width="2" points="' + solid.map(function (p) { return X(p.d).toFixed(1) + ',' + Y(p.v).toFixed(1); }).join(' ') + '"/>';
  var le = pts[pts.length - 1];
  if (le.est) { var pv = solid[solid.length - 1]; s += '<line x1="' + X(pv.d).toFixed(1) + '" y1="' + Y(pv.v).toFixed(1) + '" x2="' + X(le.d).toFixed(1) + '" y2="' + Y(le.v).toFixed(1) + '" stroke="#0ea5e9" stroke-width="2" stroke-dasharray="4 4"/>'; }
  pts.forEach(function (p) { s += '<circle cx="' + X(p.d).toFixed(1) + '" cy="' + Y(p.v).toFixed(1) + '" r="3" fill="' + (p.est ? '#fff' : '#0ea5e9') + '" stroke="#0ea5e9" stroke-width="1.5"/>'; });
  s += '<text x="' + P + '" y="' + (H - 2) + '" font-size="10" fill="#9ca3af">' + md(pts[0].d) + '</text><text x="' + (W - P) + '" y="' + (H - 2) + '" font-size="10" fill="#9ca3af" text-anchor="end">' + (le.est ? '오늘(추정)' : md(le.d)) + '</text>';
  return s + '</svg>';
}
function renderHome() {
  if (!LEDGER) return;
  lastHome = Date.now();
  var r = calc(), S = r.settings;
  var havePx = PRICES.SOL != null && PRICES.WLD != null;
  var h = '';
  h += '<div class="hero"><div class="hero-top"><b>쮸앤택 Runway</b><span class="pill ' + r.status + '">' + lv(r.status) + '</span></div>';
  h += '<div class="hero-sub">우리의 1년 Runway · ' + esc(S.periodStart) + ' ~ ' + esc(C.addDays(S.targetDate, -1)) + ' · 나: ' + esc(ME) + '</div>';
  h += '<div class="hero-nums"><div><small>목표자금</small><b>' + won(r.budgetTotal) + '</b></div><div><small>확보 자금</small><b>' + (havePx ? won(r.secured) : '시세 확인 중') + '</b></div><div><small>남은 기간</small><b>D-' + Math.max(0, r.daysToTarget) + '</b></div></div></div>';
  var shown = r.alerts.filter(function (a) { return a.key !== 'setup' || true; });
  if (shown.length) { h += '<div class="alerts">'; shown.forEach(function (a) { h += '<div class="al ' + a.level + '"><b>' + esc(a.title) + '</b><span>' + esc(a.detail) + '</span></div>'; }); h += '</div>'; }

  // 1. 자산 도넛
  var parts = [{ k: '코인', v: r.coinValue, c: '#6366f1' }, { k: '공금통장', v: Math.max(0, r.balance), c: '#0ea5e9' }, { k: '쮸 입금 예정', v: r.expectedFuture, c: '#f59e0b' }];
  if (r.cash) parts.push({ k: '현금', v: Math.max(0, r.cash), c: '#10b981' });
  var ptot = parts.reduce(function (a, p) { return a + Math.max(0, p.v); }, 0) || 1;
  h += '<div class="card"><h3>1. 자산 <small>' + (PRICE_AT ? '코인원 ' + new Date(PRICE_AT).toLocaleTimeString('ko-KR') + ' 기준' : '') + '</small></h3>';
  h += '<div class="donut-wrap">' + (havePx ? donut(parts, r.secured) : '<div class="sub">시세 확인 중...</div>') + '<div class="legend">';
  parts.forEach(function (p) { h += '<div class="lg"><i style="background:' + p.c + '"></i><span>' + p.k + '</span><b>' + (havePx || p.k !== '코인' ? won(p.v) : '-') + '</b><small>' + (havePx ? Math.round(Math.max(0, p.v) / ptot * 100) + '%' : '') + '</small></div>'; });
  h += '</div></div>';
  ['SOL', 'WLD'].forEach(function (c) { h += '<div class="row"><span class="k">' + c + ' ' + n2(r.hold[c]) + '개 × ' + (PRICES[c] != null ? won(PRICES[c]) : '-') + '</span><span class="v">' + (havePx ? won(r.coinVal[c]) : '-') + '</span></div>'; });
  h += '<div class="sub">쮸 입금 예정 = 앞으로 들어올 ' + r.expected.length + '번. 입금일이 지나면 공금통장 쪽으로 옮겨가요. 코인 판 돈(누계 ' + won(r.cashed) + ')은 공금통장에 들어간 걸로 계산해요.</div></div>';

  // 2. 목표자금
  h += '<div class="card"><h3>2. 1년 목표자금 <small>생활 ' + man(S.budgets.life) + (+S.budgets.personal ? ' + 개인 ' + man(S.budgets.personal) : '') + (+S.budgets.company ? ' + 회사 ' + man(S.budgets.company) : '') + '</small></h3>';
  h += '<div class="row"><span class="k">확보 자금 (도넛 합계)</span><span class="v">' + (havePx ? won(r.secured) : '-') + '</span></div>';
  h += '<div class="row"><span class="k">앞으로 필요한 돈 (예산 − 쓴 돈)</span><span class="v">' + won(r.need) + '</span></div>';
  h += '<div class="row"><span class="k">확보율</span><span class="v">' + (havePx ? pct(r.coverage) : '-') + '</span></div>';
  h += '<div class="bar"><i style="width:' + Math.min(100, (r.coverage || 0) * 100) + '%;background:' + (r.surplus >= 0 ? 'var(--ok)' : 'var(--danger)') + '"></i></div>';
  h += '<div class="row total"><span class="k">' + (r.surplus >= 0 ? '여유자금' : '부족자금') + '</span><span class="v ' + (r.surplus >= 0 ? 'good' : 'bad') + '">' + (havePx ? C.signWon(r.surplus) : '-') + '</span></div>';
  h += '<div class="sub">코인이 올라도 예산은 늘지 않아요. 오른 만큼은 여유자금으로만 표시돼요.</div></div>';

  // 3. 남은 예산
  h += '<div class="card"><h3>3. 남은 예산 <small>쓴 돈은 공금통장 잔액 변화로 계산</small></h3>';
  [['life', '생활 (공동)', 'var(--life)'], ['personal', '개인 (택)', 'var(--personal)'], ['company', '회사', 'var(--company)']].forEach(function (b) {
    var tot = +S.budgets[b[0]] || 0, rem = r.remaining[b[0]], p = tot ? Math.max(0, rem) / tot : 0;
    if (!tot && !r.used[b[0]]) return;
    h += '<div class="bucket"><div class="top"><span><i class="dot" style="background:' + b[2] + '"></i><b>' + b[1] + '</b></span><span><b class="' + (rem < 0 ? 'bad' : '') + '">' + won(rem) + '</b> <span class="muted">/ ' + man(tot) + '</span></span></div>';
    h += '<div class="bar"><i style="width:' + (p * 100) + '%;background:' + b[2] + '"></i></div><div class="sub">쓴 돈 ' + won(r.used[b[0]]) + ' · 남은 비율 ' + Math.round(p * 100) + '%</div></div>';
  });
  h += '</div>';

  // 4. 공금통장
  var la = r.lastAnchor;
  h += '<div class="card"><h3>4. 공금통장 (토스뱅크) <small>' + (la ? '마지막 입력 ' + md(la.date) + ' ' + esc(la.by || '') : '') + '</small></h3>';
  h += '<div class="row"><span class="k">지금 잔액' + (la && r.daysSince > 0 ? ' (추정)' : '') + '</span><span class="v"><b class="' + (r.balance < 0 ? 'bad' : '') + '" style="font-size:19px">' + won(r.balance) + '</b> <button class="mini" id="jbEdit">잔액 입력</button></span></div>';
  if (la) {
    var bd = '입력한 잔액 ' + won(r.balanceBase) + ' (' + md(la.date) + ')';
    if (r.inflowSince) bd += ' + 그 뒤 들어온 돈 ' + won(r.inflowSince);
    if (r.spendEstSince) bd += ' − 그 뒤 쓴 돈 추정 ' + won(r.spendEstSince) + ' (' + (r.burnReady ? '소비 속도' : '계획') + ' 기준 하루 ' + won(r.dailyEst) + ' × ' + r.daysSince + '일)';
    h += '<div class="hint" style="margin-top:0">' + bd + '</div>';
  } else h += '<div class="hint" style="margin-top:0">토스뱅크 앱에서 잔액을 보고 "잔액 입력"을 눌러 주세요. 두 번 이상 입력하면 소비 속도가 나와요.</div>';
  h += spark(r);
  var burnTxt = r.burnDaily == null ? '아직 계산 전' : r.burnDaily <= 0 ? '잔액이 오히려 늘었어요' : '하루 ' + won(r.burnDaily) + ' · 월 ' + won(r.burnMonthly);
  h += '<div class="row"><span class="k">소비 속도</span><span class="v">' + burnTxt + '</span></div>';
  h += '<div class="hint" style="margin-top:0">' + (r.burnDaily == null ? '잔액을 며칠 간격으로 두 번 이상 입력하면 계산돼요' : r.burnDaily <= 0 ? '기록 안 된 입금이 있었을 수 있어요. 입금을 적어 주면 정확해져요. 런웨이는 계획 금액으로 계산해요' : '잔액 기록 ' + r.burnDays + '일치 기준' + (r.burnReady ? '' : ' (' + r.settings.alert.minBurnDays + '일 이상 쌓이면 런웨이에 반영)')) + '</div>';
  h += '<div class="row"><span class="k">이번 달 쓴 돈 (추정)</span><span class="v">' + won(Math.max(0, r.spentThisMonth)) + ' <span class="muted">/ 계획 ' + man(r.planMonthly) + '</span></span></div>';
  if (r.expected.length) h += '<div class="row"><span class="k">다음 입금</span><span class="v good">' + md(r.expected[0].due) + ' ' + esc(r.expected[0].who) + ' +' + won(r.expected[0].amount) + '</span></div><div class="hint" style="margin-top:0">입금일이 되면 잔액에 자동으로 더해져요. 안 들어왔으면 기록 → 공금통장에서 "안 들어왔어요"를 눌러 주세요.</div>';
  h += '</div>';

  // 5. 런웨이
  var mm = r.main;
  h += '<div class="card"><h3>5. 남은 런웨이 <small>' + (r.burnReady ? '지금 소비 속도 기준' : '계획 기준 (소비 속도 쌓이는 중)') + '</small></h3>';
  h += '<div class="big ' + (mm.survives ? 'good' : 'bad') + '">' + (havePx ? C.monthsText(mm.months) : '-') + '</div>';
  if (havePx) {
    if (mm.exhaust) h += '<div class="sub">' + (mm.survives ? '목표일(' + S.targetDate + ')은 버티고 ' : '') + '<b>' + mm.exhaust + '</b>에 바닥나요' + (mm.atTarget != null ? ' · 목표일에 남는 돈 ' + won(mm.atTarget) : '') + '</div>';
    else h += '<div class="sub">5년 넘게 버텨요' + (mm.atTarget != null ? ' · 목표일에 남는 돈 ' + won(mm.atTarget) : '') + '</div>';
    h += '<div class="row" style="margin-top:8px"><span class="k">소비 속도 기준' + (r.burnReady ? ' (월 ' + man(r.burnMonthly) + ')' : '') + '</span><span class="v">' + (r.pace ? C.monthsText(r.pace.months) : '잔액 기록 ' + r.settings.alert.minBurnDays + '일치 필요') + '</span></div>';
    h += '<div class="row"><span class="k">계획 기준 (월 ' + man(r.planMonthly) + ')</span><span class="v">' + C.monthsText(r.plan.months) + '</span></div>';
    h += '<div class="row"><span class="k">코인 안 팔고 공금통장만으로</span><span class="v ' + (r.jointOnly.exhaust && C.diffDays(r.today, r.jointOnly.exhaust) <= 30 ? 'warnc' : '') + '">' + (r.jointOnly.exhaust ? r.jointOnly.exhaust + '까지' : '5년 이상') + '</span></div>';
    if (r.expectedFuture > 0) h += '<div class="hint">앞으로 들어올 쮸 입금 ' + won(r.expectedFuture) + '을 넣어서 계산했어요. 공금통장이 바닥나기 전에 코인을 팔아 채우는 걸로 봐요.</div>';
  }
  h += '</div>';

  // 예정 입금·출금
  h += '<div class="card"><h3>앞으로 예정된 입금·출금</h3>';
  r.expected.slice(0, 3).forEach(function (e) { h += '<div class="row"><span class="k">' + esc(e.due) + ' · ' + esc(e.who) + ' 공금통장 입금</span><span class="v good">+' + won(e.amount) + '</span></div>'; });
  if (!r.planned.length) h += '<div class="sub">예정된 큰 출금이 없어요.</div>';
  r.planned.slice(0, 8).forEach(function (x) { h += '<div class="row"><span class="k">' + esc(x.date) + (x.memo ? ' · ' + esc(x.memo) : '') + '</span><span class="v bad">-' + won(x.amount) + '</span></div>'; });
  h += '</div>';
  $('#tab-home').innerHTML = h;
  var jbE = $('#jbEdit'); if (jbE) jbE.onclick = editJointBalance;
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
  var h = '<div class="card"><h3>기록하기</h3><div class="chips">';
  Object.keys(FORMS).forEach(function (k) { h += '<button data-rt="' + k + '" class="' + (k === RECTYPE ? 'on' : '') + '">' + FORMS[k].t + '</button>'; });
  h += '</div><div id="recform">';
  FORMS[RECTYPE].f.forEach(function (f) { h += field(f[0], f[1], f[2], f[3]); });
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
    h += '<table class="tb"><tr><th>날짜</th><th>잔액</th><th>들어온 돈</th><th>쓴 돈</th></tr>';
    var rows = r.anchors.map(function (a, i) { var iv = i > 0 ? r.intervals[i - 1] : null; return { a: a, iv: iv }; }).reverse().slice(0, 15);
    rows.forEach(function (x) { h += '<tr><td>' + md(x.a.date) + ' ' + esc(x.a.by || '') + '</td><td>' + won(x.a.amount) + '</td><td>' + (x.iv ? won(x.iv.inflow) : '-') + '</td><td>' + (x.iv ? won(x.iv.spend) + (x.iv.days ? '<br><small class="muted">' + x.iv.days + '일, 하루 ' + won(x.iv.spend / x.iv.days) + '</small>' : '') : '-') + '</td></tr>'; });
    h += '</table>';
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
  else { h += '<table class="tb"><tr><th>날짜</th><th>코인</th><th>수량</th><th>매도가</th><th>수수료</th><th>입금액</th></tr>'; sales.forEach(function (x) { h += '<tr><td>' + esc(x.date.slice(5)) + '</td><td>' + x.coin + '</td><td>' + n2(x.qty) + '</td><td>' + won(x.price) + '</td><td>' + won(Math.max(0, x.qty * x.price - x.krw)) + '</td><td>' + won(x.krw) + '</td></tr>'; }); h += '</table>'; }
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
  var h = '<div class="card"><h3>요청 남기기</h3><textarea id="mtext" placeholder="예: 10월 생활비 - SOL 5개 정도 매도하면 될 듯"></textarea><button class="btn" id="madd">요청으로 남기기</button><div class="hint">결정(요청)과 실제 실행(매도 기록)이 따로 남아요. 매도를 기록할 때 이 요청을 연결하면 자동으로 완료돼요.</div></div>';
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
  var h = '<div class="card"><h3>시작 숫자 <small>' + (S.confirmed ? '확인됨' : '확인 필요') + '</small></h3>';
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
  h += '<label class="f">생활(공동) 예산 총액</label><input id="p_bl" inputmode="numeric" value="' + (+S.budgets.life).toLocaleString('ko-KR') + '">';
  h += '<label class="f">개인 예산 총액</label><input id="p_bp" inputmode="numeric" value="' + (+S.budgets.personal).toLocaleString('ko-KR') + '">';
  h += '<label class="f">회사 예산 총액</label><input id="p_bc" inputmode="numeric" value="' + (+S.budgets.company).toLocaleString('ko-KR') + '">';
  h += '<label class="f">월 생활비 계획 (공금통장에서 쓰는 돈)</label><input id="p_ml" inputmode="numeric" value="' + (+S.monthly.life).toLocaleString('ko-KR') + '">';
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
    var ns = { periodStart: v('p_start'), targetDate: v('p_target'), budgets: { life: parseNum(v('p_bl')), personal: parseNum(v('p_bp')), company: parseNum(v('p_bc')) }, monthly: { life: parseNum(v('p_ml')), personal: parseNum(v('p_mp')) } };
    if (!ns.periodStart || !ns.targetDate || ns.targetDate <= ns.periodStart) return toast('날짜를 확인해 주세요');
    if ([ns.budgets.life, ns.budgets.personal, ns.budgets.company, ns.monthly.life, ns.monthly.personal].some(function (x) { return !isFinite(x) || x < 0; })) return toast('금액을 확인해 주세요');
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
  $('#d_me').onclick = function () { var other = ME === '택' ? '쮸' : '택'; if (confirm('이 기기 사용자를 ' + other + '(으)로 바꿀까요?')) { localStorage.setItem('runway.me', other); ME = other; toast('이제 ' + other + '(으)로 기록돼요'); renderSet(); } };
  $('#d_copy').onclick = function () { navigator.clipboard.writeText(pageUrl()).then(function () { toast('주소를 복사했어요'); }, function () { prompt('아래 주소를 복사해 주세요', pageUrl()); }); };
  $('#d_qr').onclick = function () { var q = qrcode(0, 'M'); q.addData(pageUrl()); q.make(); $('#d_out').innerHTML = '<div class="qr">' + q.createSvgTag({ cellSize: 5, margin: 2, scalable: true }) + '</div><div class="hint">휴대폰 카메라로 찍으면 바로 열려요.</div>'; };
  $('#x_dl').onclick = function () { var a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([JSON.stringify(LEDGER, null, 1)], { type: 'application/json' })); a.download = 'runway-ledger-' + today() + '.json'; a.click(); };
}

boot();
})();
