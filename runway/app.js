/* 쮸앤택 Runway 화면 동작 */
(function () {
'use strict';
var OWNER = 'jtl10231-oss', REPO = 'runway-data', FILE = 'ledger.json';
var C = window.RunwayCore;
var TOKEN = null, ME = null, LEDGER = null, SHA = null, STATE = null, PRICES = { SOL: null, WLD: null }, PRICE_AT = null;
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

// ---------- GitHub 저장소 읽기/쓰기 ----------
function b64enc(str) { var bytes = enc.encode(str), bin = ''; for (var i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000)); return btoa(bin); }
function b64dec(b64) { var bin = atob(b64.replace(/\s/g, '')), o = new Uint8Array(bin.length); for (var i = 0; i < bin.length; i++) o[i] = bin.charCodeAt(i); return dec.decode(o); }
async function gh(method, path, body, tok) {
  var h = { Authorization: 'Bearer ' + (tok || TOKEN), Accept: 'application/vnd.github+json' };
  if (body) h['Content-Type'] = 'application/json';
  return fetch('https://api.github.com/repos/' + OWNER + '/' + REPO + path, { method: method, headers: h, body: body ? JSON.stringify(body) : undefined, cache: 'no-store' });
}
async function readFile(name, tok) {
  var r = await gh('GET', '/contents/' + name + '?ref=main', null, tok);
  if (r.status === 401 || r.status === 403) { var e = new Error('AUTH'); e.auth = true; throw e; }
  if (r.status === 404) return null;
  if (!r.ok) throw new Error('불러오기 실패 (HTTP ' + r.status + ')');
  var j = await r.json();
  return { data: JSON.parse(b64dec(j.content)), sha: j.sha };
}
async function save(mutate, msg) {
  for (var i = 0; i < 4; i++) {
    var cur = await readFile(FILE);
    var next = JSON.parse(JSON.stringify(cur.data));
    mutate(next);
    next.updatedAt = nowIso();
    var r = await gh('PUT', '/contents/' + FILE, { message: msg + ' (' + ME + ')', content: b64enc(JSON.stringify(next, null, 1)), sha: cur.sha, branch: 'main' });
    if (r.ok) { var j = await r.json(); LEDGER = next; SHA = j.content.sha; return true; }
    if (r.status === 401 || r.status === 403) throw new Error('열쇠 권한이 없어요 (HTTP ' + r.status + ')');
    if (r.status !== 409 && r.status !== 422) throw new Error('저장 실패 (HTTP ' + r.status + ')');
    await sleep(500 * (i + 1));
  }
  throw new Error('동시에 저장이 겹쳤어요. 잠시 후 다시 해 주세요.');
}
async function doSave(mutate, msg, okText) {
  try { await save(mutate, msg); toast(okText || '저장했어요'); renderAll(); return true; }
  catch (e) { toast(e.message || '저장 실패'); return false; }
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

// ---------- 열기: 로그인 없음 (공유 링크를 한 번 열면 이 기기에 저장) ----------
function showLock(html) { $('#app').hidden = true; var l = $('#lock'); l.hidden = false; l.innerHTML = '<div class="lockcard">' + html + '</div>'; }
function shareUrl() { return location.origin + location.pathname + '#k=' + encodeURIComponent(TOKEN); }
function showPick() {
  showLock('<h2>누구세요?</h2><div class="sub">한 번 고르면 이 기기에 저장돼요. 나중에 설정에서 바꿀 수 있어요.</div><div class="pick"><button class="btn" data-me="택">택</button><button class="btn" data-me="쮸">쮸</button></div>');
  document.querySelectorAll('[data-me]').forEach(function (b) { b.onclick = function () { localStorage.setItem('runway.me', b.dataset.me); ME = b.dataset.me; start(); }; });
}
function showNoKey() {
  showLock('<h2>공유 링크로 열어 주세요</h2><div class="sub">런웨이는 로그인 없이 <b>공유 링크</b>로 열어요. 이미 쓰고 있는 기기의 <b>설정 → 공유 링크</b>에서 링크를 받거나 QR을 찍어 주세요. 한 번 열면 이 기기에서는 계속 바로 열려요.</div>' +
    '<details style="margin-top:16px"><summary class="muted" style="font-size:13px">링크 직접 붙여넣기</summary><textarea id="rawtok" placeholder="https://...#k=..."></textarea><button class="btn gray" id="rawgo">열기</button></details>');
  $('#rawgo').onclick = function () {
    var t = $('#rawtok').value.trim(), m = t.match(/[#&]k=([^&\s]+)/); if (m) t = decodeURIComponent(m[1]);
    if (!/^github_pat_/.test(t)) return toast('공유 링크가 아니에요');
    localStorage.setItem('runway.key', t); boot();
  };
}
function boot() {
  var hp = new URLSearchParams(location.hash.slice(1)), k = hp.get('k');
  if (k) { localStorage.setItem('runway.key', k); history.replaceState(null, '', location.pathname); }
  var old = localStorage.getItem('runway.bootstrap') || sessionStorage.getItem('runway.tok'); // 예전 방식 정리
  if (old && !localStorage.getItem('runway.key')) localStorage.setItem('runway.key', old);
  try { var st = JSON.parse(localStorage.getItem('runway.enc') || 'null'); if (st && st.person && !localStorage.getItem('runway.me')) localStorage.setItem('runway.me', st.person); } catch (e) {}
  ['runway.bootstrap', 'runway.enc'].forEach(function (x) { localStorage.removeItem(x); }); sessionStorage.removeItem('runway.tok');
  TOKEN = localStorage.getItem('runway.key');
  if (!TOKEN) return showNoKey();
  ME = localStorage.getItem('runway.me');
  if (ME !== '택' && ME !== '쮸') return showPick();
  start();
}

// ---------- 앱 시작 ----------
async function start() {
  $('#lock').hidden = true; $('#app').hidden = false;
  $('#tab-home').innerHTML = '<div class="card sub">불러오는 중...</div>';
  try {
    var f = await readFile(FILE);
    LEDGER = f.data; SHA = f.sha;
  } catch (e) {
    if (e.auth) { showLock('<h2>공유 링크가 바뀌었어요</h2><div class="sub">링크가 만료되었거나 새 링크로 바뀌었어요. 새 공유 링크로 다시 열어 주세요.</div><button class="btn gray" onclick="localStorage.removeItem(\'runway.key\');location.reload()">이 기기에서 지우고 다시 열기</button>'); return; }
    $('#tab-home').innerHTML = '<div class="card">불러오지 못했어요: ' + esc(e.message) + '</div>'; return;
  }
  readFile('state.json').then(function (s) { STATE = s ? s.data : null; if (TAB === 'set') renderSet(); }).catch(function () {});
  if (!wsStarted) { wsStarted = true; connectWS(); seedPrices(); }
  renderAll();
  setInterval(async function () { // 다른 사람이 입력한 기록 반영 (2분마다)
    if (document.hidden) return;
    try { var f = await readFile(FILE); if (f && f.sha !== SHA) { LEDGER = f.data; SHA = f.sha; if (TAB === 'home') renderHome(); else if (!document.activeElement || !/INPUT|SELECT|TEXTAREA/.test(document.activeElement.tagName)) renderAll(); } } catch (e) {}
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
function renderHome() {
  if (!LEDGER) return;
  lastHome = Date.now();
  var r = calc(), S = r.settings;
  var havePx = PRICES.SOL != null && PRICES.WLD != null;
  var h = '';
  h += '<div class="hero"><div class="hero-top"><b>쮸앤택 Runway</b><span class="pill ' + r.status + '">' + lv(r.status) + '</span></div>';
  h += '<div class="hero-sub">우리의 1년 Runway · ' + esc(S.periodStart) + ' ~ ' + esc(C.addDays(S.targetDate, -1)) + ' · 나: ' + esc(ME) + '</div>';
  h += '<div class="hero-nums"><div><small>목표자금</small><b>' + won(r.budgetTotal) + '</b></div><div><small>현재 자산</small><b>' + (havePx ? won(r.pool) : '시세 확인 중') + '</b></div><div><small>남은 기간</small><b>D-' + Math.max(0, r.daysToTarget) + '</b></div></div></div>';
  var shown = r.alerts.filter(function (a) { return a.level !== 'info' || a.key === 'setup' || a.key === 'cash_negative' || /^card_/.test(a.key) || a.key === 'overdue'; });
  if (shown.length) { h += '<div class="alerts">'; shown.forEach(function (a) { h += '<div class="al ' + a.level + '"><b>' + esc(a.title) + '</b><span>' + esc(a.detail) + '</span></div>'; }); h += '</div>'; }
  // 1 총자산
  h += '<div class="card"><h3>1. 현재 총자산 <small>' + (PRICE_AT ? '코인원 ' + new Date(PRICE_AT).toLocaleTimeString('ko-KR') + ' 기준' : '') + '</small></h3>';
  ['SOL', 'WLD'].forEach(function (c) { h += '<div class="row"><span class="k">' + c + ' ' + n2(r.hold[c]) + '개 × ' + (PRICES[c] != null ? won(PRICES[c]) : '-') + '</span><span class="v">' + (havePx ? won(r.coinVal[c]) : '-') + '</span></div>'; });
  h += '<div class="row"><span class="k">현금(원화)</span><span class="v ' + (r.cash < 0 ? 'bad' : '') + '">' + won(r.cash) + '</span></div>';
  h += '<div class="row total"><span class="k">합계</span><span class="v">' + (havePx ? won(r.pool) : '-') + '</span></div>';
  h += '<div class="sub">현금화 누계 ' + won(r.cashed) + ' · 법인 잔액 ' + won(r.corp) + '은 회사 쪽으로 따로 봐요</div></div>';
  // 2 목표자금
  h += '<div class="card"><h3>2. 1년 목표자금 <small>예산 ' + man(S.budgets.life) + ' + ' + man(S.budgets.personal) + ' + ' + man(S.budgets.company) + '</small></h3>';
  h += '<div class="row"><span class="k">앞으로 필요한 돈</span><span class="v">' + won(r.need) + '</span></div>';
  h += '<div class="row"><span class="k">확보율</span><span class="v">' + (havePx ? pct(r.coverage) : '-') + '</span></div>';
  h += '<div class="bar"><i style="width:' + Math.min(100, (r.coverage || 0) * 100) + '%;background:' + (r.surplus >= 0 ? 'var(--ok)' : 'var(--danger)') + '"></i></div>';
  h += '<div class="row total"><span class="k">' + (r.surplus >= 0 ? '여유자금' : '부족자금') + '</span><span class="v ' + (r.surplus >= 0 ? 'good' : 'bad') + '">' + (havePx ? C.signWon(r.surplus) : '-') + '</span></div>';
  h += '<div class="sub">코인이 올라도 예산은 늘지 않아요. 오른 만큼은 여유자금으로만 표시돼요.</div></div>';
  // 3 남은 예산
  h += '<div class="card"><h3>3. 용도별 남은 예산</h3>';
  [['life', '생활 (공동)', 'var(--life)'], ['personal', '개인 (택)', 'var(--personal)'], ['company', '회사', 'var(--company)']].forEach(function (b) {
    var tot = +S.budgets[b[0]] || 0, rem = r.remaining[b[0]], p = tot ? Math.max(0, rem) / tot : 0;
    h += '<div class="bucket"><div class="top"><span><i class="dot" style="background:' + b[2] + '"></i><b>' + b[1] + '</b></span><span><b class="' + (rem < 0 ? 'bad' : '') + '">' + won(rem) + '</b> <span class="muted">/ ' + man(tot) + '</span></span></div>';
    h += '<div class="bar"><i style="width:' + (p * 100) + '%;background:' + b[2] + '"></i></div><div class="sub">사용 ' + won(r.used[b[0]]) + ' · 남은 비율 ' + Math.round(p * 100) + '%</div></div>';
  });
  h += '</div>';
  // 4 이번 달 (공금통장 잔액·각자 입금 포함)
  var tm = r.thisMonth, ml = +S.monthly.life || 0, mp = +S.monthly.personal || 0, jbx = r.jointBalance;
  h += '<div class="card"><h3>4. 이번 달 <small>' + r.ym.replace('-', '년 ') + '월</small></h3>';
  h += '<div class="row"><span class="k">공금통장(토스뱅크) 잔액</span><span class="v">' + (jbx ? won(jbx.amount) : '입력 전') + ' <button class="mini" id="jbEdit">수정</button></span></div>';
  if (jbx) h += '<div class="hint" style="margin:-2px 0 4px;text-align:right">' + esc(jbx.by) + ' · ' + esc(jbx.date) + ' 수정</div>';
  h += '<div class="row"><span class="k">이번 달 공금통장 입금</span><span class="v">택 ' + won(tm.jointBy['택'] || 0) + ' · 쮸 ' + won(tm.jointBy['쮸'] || 0) + '</span></div>';
  h += '<div class="row"><span class="k">생활비 (런웨이에서, 예정 ' + won(ml) + ')</span><span class="v">' + won(tm.life) + '</span></div>';
  h += '<div class="row"><span class="k">카드값 (한도 ' + won(mp) + ')</span><span class="v">' + won(tm.card) + '</span></div>';
  if (tm.expense) h += '<div class="row"><span class="k">기타 지출</span><span class="v">' + won(tm.expense) + '</span></div>';
  h += '<div class="row"><span class="k">회사 사용액</span><span class="v">' + won(tm.corpSpend) + '</span></div>';
  h += '<div class="row total"><span class="k">이번 달 런웨이 총 소진</span><span class="v">' + won(tm.total) + '</span></div>';
  h += '<div class="sub">생활 ' + (ml ? Math.round(tm.life / ml * 100) : 0) + '% · 개인 ' + (mp ? Math.round(tm.personal / mp * 100) : 0) + '% 사용 (월 한도 대비). 각자 개인 돈으로 넣은 입금은 런웨이 소진에 안 들어가요.</div></div>';
  // 5 런웨이
  var p = r.plan;
  h += '<div class="card"><h3>5. 남은 런웨이 <small>계획대로 쓰면</small></h3>';
  h += '<div class="big ' + (p.survives ? 'good' : 'bad') + '">' + (havePx ? C.monthsText(p.months) : '-') + '</div>';
  if (havePx) {
    if (p.exhaust) h += '<div class="sub">' + (p.survives ? '목표일(' + S.targetDate + ')은 버티고 ' : '') + '<b>' + p.exhaust + '</b>에 바닥나요' + (p.atTarget != null ? ' · 목표일에 남는 돈 ' + won(p.atTarget) : '') + '</div>';
    else h += '<div class="sub">5년 넘게 버텨요' + (p.atTarget != null ? ' · 목표일에 남는 돈 ' + won(p.atTarget) : '') + '</div>';
    h += '<div class="row" style="margin-top:8px"><span class="k">최근 소비 속도면</span><span class="v">' + (r.pace ? C.monthsText(r.pace.months) + ' (월 ' + won(r.paceL) + ')' : '한 달 기록이 쌓이면 계산') + '</span></div>';
    h += '<div class="row"><span class="k">회사 돈을 떼어 두면 생활비</span><span class="v">' + (r.lifeMonths == null ? '-' : C.monthsText(Math.max(0, r.lifeMonths))) + '</span></div>';
    h += '<div class="row"><span class="k">회사 런웨이</span><span class="v">' + (r.corpMonths == null ? '회사 사용액 기록 필요' : C.monthsText(r.corpMonths)) + '</span></div>';
    if (r.reserveNow > 0) h += '<div class="hint">날짜를 안 정한 회사 준비금 ' + won(r.reserveNow) + '은 바로 빠진다고 보고 계산했어요. 날짜가 정해지면 기록 → 예정 출금에 넣어 주세요.</div>';
  }
  h += '</div>';
  // 예정 출금
  h += '<div class="card"><h3>앞으로 예정된 출금</h3>';
  if (!r.planned.length) h += '<div class="sub">예정된 큰 출금이 없어요. (월 생활비·카드값은 자동으로 계산에 들어가요)</div>';
  r.planned.slice(0, 8).forEach(function (x) { h += '<div class="row"><span class="k">' + esc(x.date) + ' · ' + (x.kind === 'corp' ? '법인 입금' : '기타') + (x.memo ? ' · ' + esc(x.memo) : '') + '</span><span class="v">' + won(x.amount) + '</span></div>'; });
  h += '</div>';
  $('#tab-home').innerHTML = h;
  var jbE = $('#jbEdit'); if (jbE) jbE.onclick = editJointBalance;
}
function editJointBalance() {
  var cur = calc().jointBalance;
  var v = prompt('공금통장(토스뱅크) 지금 잔액을 넣어 주세요', cur ? String(Math.round(cur.amount)) : '');
  if (v == null) return;
  var amt = parseNum(v); if (!isFinite(amt) || amt < 0) return toast('금액을 확인해 주세요');
  doSave(function (L) { L.records = L.records || []; L.records.push({ id: uid(), type: 'jbal', amount: amt, date: today(), by: ME, createdAt: nowIso() }); }, '공금통장 잔액 ' + won(amt), '잔액을 ' + won(amt) + '으로 바꿨어요');
}

// ---------- 기록 ----------
var FORMS = {
  sale: { t: '매도', f: [['date', '날짜', 'date'], ['coin', '코인', 'coin'], ['qty', '판 수량', 'num'], ['price', '매도가 (1개 체결가)', 'won'], ['krw', '실제 받은 원화 (수수료 뺀 금액)', 'won'], ['dest', '받은 돈 보낸 곳', 'dest'], ['req', '연결할 요청 메모', 'req'], ['memo', '메모', 'text']] },
  joint: { t: '공금통장 입금', f: [['who', '입금자', 'who'], ['date', '입금일', 'date'], ['amount', '금액', 'won'], ['src', '돈 출처', 'src'], ['plan', '완료할 예정 출금', 'planned'], ['memo', '메모', 'text']] },
  card: { t: '카드값', f: [['month', '결제월', 'month'], ['amount', '결제 금액', 'won'], ['memo', '메모', 'text']] },
  expense: { t: '지출', f: [['date', '날짜', 'date'], ['amount', '금액', 'won'], ['bucket', '어느 예산에서', 'bucket'], ['plan', '완료할 예정 출금', 'planned'], ['memo', '어디에 썼는지', 'text']] },
  corp_in: { t: '법인 입금', f: [['date', '날짜', 'date'], ['amount', '금액', 'won'], ['plan', '완료할 예정 출금', 'planned'], ['memo', '메모', 'text']] },
  corp_spend: { t: '회사 사용액', f: [['month', '월', 'month'], ['amount', '그 달 법인 계좌에서 쓴 돈', 'won'], ['memo', '메모', 'text']] },
  income: { t: '현금 들어옴', f: [['who', '누가 넣었나', 'who'], ['date', '입금일', 'date'], ['amount', '금액', 'won'], ['memo', '어디서 들어온 돈인지 (런웨이 자산으로 들어온 돈)', 'text']] },
  planned: { t: '예정 출금', f: [['date', '나갈 날짜', 'date'], ['amount', '금액', 'won'], ['kind', '종류', 'kind'], ['memo', '메모', 'text']] }
};
function field(k, label, kind, def) {
  var id = 'fx_' + k, x = '<label class="f" for="' + id + '">' + label + '</label>';
  var recs = LEDGER.records || [];
  if (kind === 'date') return x + '<input id="' + id + '" type="date" value="' + today() + '">';
  if (kind === 'who') return x + '<select id="' + id + '"><option value="택"' + (ME === '택' ? ' selected' : '') + '>택</option><option value="쮸"' + (ME === '쮸' ? ' selected' : '') + '>쮸</option></select>';
  if (kind === 'src') return x + '<select id="' + id + '"><option value="pool"' + (ME === '쮸' ? '' : ' selected') + '>런웨이 자산에서 (코인 판 돈·현금)</option><option value="own"' + (ME === '쮸' ? ' selected' : '') + '>각자 개인 돈에서 (월급 등)</option></select><div class="hint">런웨이 자산에서 넣은 돈은 생활 예산에서 빠지고, 개인 돈으로 넣은 돈은 누가 얼마 넣었는지만 기록돼요.</div>';
  if (kind === 'month') return x + '<input id="' + id + '" type="month" value="' + today().slice(0, 7) + '">';
  if (kind === 'coin') return x + '<select id="' + id + '"><option value="SOL">SOL (솔라나)</option><option value="WLD">WLD (월드코인)</option></select>';
  if (kind === 'num') return x + '<input id="' + id + '" type="text" inputmode="decimal" placeholder="예: 3">';
  if (kind === 'won') return x + '<input id="' + id + '" type="text" inputmode="numeric" placeholder="원" value="' + (def ? def.toLocaleString('ko-KR') : '') + '">';
  if (kind === 'dest') return x + '<select id="' + id + '"><option value="cash">내 계좌에 둠 (현금)</option><option value="joint">공금통장(토스뱅크)으로 바로 보냄</option><option value="corp">법인으로 바로 보냄</option></select><div class="hint">공금통장·법인으로 바로 보냈으면 그 입금 기록도 같이 만들어져요.</div>';
  if (kind === 'bucket') return x + '<select id="' + id + '"><option value="life">생활 (공동)</option><option value="personal">개인</option><option value="company">회사</option><option value="none">예산 밖 (계산만 반영)</option></select>';
  if (kind === 'kind') return x + '<select id="' + id + '"><option value="corp">법인 입금 (회사 예산)</option><option value="other">기타 큰 출금</option></select>';
  if (kind === 'planned') { var ps = recs.filter(function (r) { return r.type === 'planned' && !r.canceled && !r.done; }); return x + '<select id="' + id + '"><option value="">없음</option>' + ps.map(function (p) { return '<option value="' + p.id + '">' + esc(p.date) + ' ' + won(p.amount) + (p.memo ? ' ' + esc(p.memo) : '') + '</option>'; }).join('') + '</select>'; }
  if (kind === 'req') { var ms = recs.filter(function (r) { return r.type === 'memo' && r.status === 'open' && !r.canceled; }); return x + '<select id="' + id + '"><option value="">없음</option>' + ms.map(function (m) { return '<option value="' + m.id + '">' + esc(m.by) + ': ' + esc(m.text.slice(0, 30)) + '</option>'; }).join('') + '</select>'; }
  return x + '<input id="' + id + '" type="text">';
}
function recLine(r) {
  var who = esc(r.by || ''), a = r.amount != null ? won(r.amount) : '';
  if (r.type === 'sale') return { t: '매도 ' + r.coin + ' ' + n2(r.qty) + '개 → ' + won(r.krw), s: r.date + ' · 매도가 ' + won(r.price) + ' · ' + C.DEST[r.dest || 'cash'] + ' · ' + who };
  if (r.type === 'card') return { t: '카드값 ' + a, s: r.month + ' 결제 · ' + who };
  if (r.type === 'joint') { var wj = esc(r.who || r.by || ''); return { t: '공금통장 입금 ' + a + ' (' + (r.who || r.by || '') + ')', s: r.date + ' 입금 · ' + C.SRC[r.src || 'pool'] + (r.who && r.by && r.who !== r.by ? ' · ' + who + ' 기록' : '') }; }
  if (r.type === 'jbal') return { t: '공금통장 잔액 ' + a, s: r.date + ' · ' + who + ' 수정' };
  if (r.type === 'income') return { t: '현금 들어옴 ' + a + (r.who ? ' (' + r.who + ')' : ''), s: r.date + ' 입금 · ' + who };
  if (r.type === 'corp_spend') return { t: '회사 사용액 ' + a, s: r.month + ' · ' + who };
  if (r.type === 'expense') return { t: '지출 ' + a + ' (' + C.BUCKET[r.bucket || 'none'] + ')', s: r.date + ' · ' + who };
  if (r.type === 'planned') return { t: '예정 출금 ' + a + (r.kind === 'corp' ? ' (법인 입금)' : ''), s: r.date + ' 예정' + (r.done ? ' · 완료됨' : '') + ' · ' + who };
  if (r.type === 'adjust') return { t: '잔액 맞추기 ' + ({ cash: '현금', corp: '법인', SOL: 'SOL', WLD: 'WLD' }[r.what]) + ' ' + (r.delta > 0 ? '+' : '') + (r.what === 'SOL' || r.what === 'WLD' ? n2(r.delta) + '개' : won(r.delta)), s: r.date + ' · ' + who };
  return { t: C.LABEL[r.type] + ' ' + a, s: (r.date || '') + ' · ' + who };
}
function renderRec() {
  var h = '<div class="card"><h3>기록하기</h3><div class="chips">';
  Object.keys(FORMS).forEach(function (k) { h += '<button data-rt="' + k + '" class="' + (k === RECTYPE ? 'on' : '') + '">' + FORMS[k].t + '</button>'; });
  h += '</div><div id="recform">';
  FORMS[RECTYPE].f.forEach(function (f) { h += field(f[0], f[1], f[2], f[3]); });
  if (RECTYPE === 'sale') h += '<div class="hint" id="salehint"></div>';
  h += '<button class="btn" id="recsave">저장</button></div></div>';
  // 매도 내역
  var recs = (LEDGER.records || []).slice();
  var sales = recs.filter(function (r) { return r.type === 'sale' && !r.canceled; }).sort(function (a, b) { return a.date < b.date ? 1 : -1; });
  h += '<div class="card"><h3>매도 내역 <small>현금화 누계 ' + won(sales.reduce(function (s, r) { return s + (+r.krw || 0); }, 0)) + '</small></h3>';
  if (!sales.length) h += '<div class="sub">아직 매도 기록이 없어요.</div>';
  else { h += '<table class="tb"><tr><th>날짜</th><th>코인</th><th>수량</th><th>매도가</th><th>실제 원화</th></tr>'; sales.forEach(function (r) { h += '<tr><td>' + esc(r.date.slice(5)) + '</td><td>' + r.coin + '</td><td>' + n2(r.qty) + '</td><td>' + won(r.price) + '</td><td>' + won(r.krw) + '</td></tr>'; }); h += '</table>'; }
  h += '</div>';
  // 공금통장 입금 내역
  var rr = calc(), deps = recs.filter(function (r) { return r.type === 'joint' && !r.canceled; }).sort(function (a, b) { return a.date < b.date ? 1 : -1; });
  h += '<div class="card"><h3>공금통장 (토스뱅크) <small>잔액 ' + (rr.jointBalance ? won(rr.jointBalance.amount) : '입력 전') + ' <button class="mini" id="jbEdit2">잔액 수정</button></small></h3>';
  h += '<div class="row"><span class="k">입금 누계</span><span class="v">택 ' + won(rr.depTotal['택'] || 0) + ' · 쮸 ' + won(rr.depTotal['쮸'] || 0) + '</span></div>';
  if (!deps.length) h += '<div class="sub">아직 입금 기록이 없어요. 위에서 "공금통장 입금"으로 적어 주세요.</div>';
  else { h += '<table class="tb"><tr><th>입금일</th><th>입금자</th><th>금액</th><th>출처</th></tr>'; deps.slice(0, 20).forEach(function (r) { h += '<tr><td>' + esc(r.date.slice(5)) + '</td><td>' + esc(r.who || r.by || '') + '</td><td>' + won(r.amount) + '</td><td>' + (r.src === 'own' ? '개인 돈' : '런웨이') + '</td></tr>'; }); h += '</table>'; }
  h += '</div>';
  // 전체 기록
  var all = recs.filter(function (r) { return r.type !== 'memo'; }).sort(function (a, b) { return (a.createdAt || '') < (b.createdAt || '') ? 1 : -1; });
  h += '<div class="card"><h3>전체 기록 <small>지우지 않고 취소만 돼요</small></h3><div class="list">';
  if (!all.length) h += '<div class="sub">아직 기록이 없어요.</div>';
  all.slice(0, histLimit).forEach(function (r) {
    var l = recLine(r);
    h += '<div class="it' + (r.canceled ? ' cx' : '') + '"><div><div class="t">' + esc(l.t) + '</div><div class="s">' + esc(l.s) + (r.memo ? ' · ' + esc(r.memo) : '') + (r.canceled ? ' · 취소됨(' + esc(r.canceled.by) + ')' : '') + '</div></div>';
    if (!r.canceled) h += '<div>' + (r.type === 'planned' && !r.done ? '<button class="mini" data-done="' + r.id + '">완료</button> ' : '') + '<button class="mini" data-cancel="' + r.id + '">취소</button></div>';
    h += '</div>';
  });
  if (all.length > histLimit) h += '<button class="btn gray" id="more">더 보기</button>';
  h += '</div></div>';
  $('#tab-rec').innerHTML = h;
  document.querySelectorAll('[data-rt]').forEach(function (b) { b.onclick = function () { RECTYPE = b.dataset.rt; renderRec(); }; });
  document.querySelectorAll('input[inputmode=numeric]').forEach(function (i) { i.onblur = function () { var v = parseNum(i.value); if (isFinite(v)) i.value = v.toLocaleString('ko-KR'); }; });
  if (RECTYPE === 'sale') setupSaleForm();
  if (RECTYPE === 'joint') { var wsel = $('#fx_who'), ssel = $('#fx_src'), touched = false; ssel.onchange = function () { touched = true; }; wsel.onchange = function () { if (!touched) ssel.value = wsel.value === '쮸' ? 'own' : 'pool'; }; }
  $('#recsave').onclick = submitRec;
  var jb2 = $('#jbEdit2'); if (jb2) jb2.onclick = editJointBalance;
  document.querySelectorAll('[data-cancel]').forEach(function (b) { b.onclick = function () { cancelRec(b.dataset.cancel); }; });
  document.querySelectorAll('[data-done]').forEach(function (b) { b.onclick = function () { var id = b.dataset.done; doSave(function (L) { var p = L.records.find(function (x) { return x.id === id; }); if (p) p.done = { at: nowIso(), by: ME }; }, '예정 출금 완료', '완료 처리했어요'); }; });
  var more = $('#more'); if (more) more.onclick = function () { histLimit += 50; renderRec(); };
}
function setupSaleForm() {
  var coin = $('#fx_coin'), qty = $('#fx_qty'), price = $('#fx_price'), krw = $('#fx_krw'), manual = false;
  function fillPrice() { var p = PRICES[coin.value]; if (p != null) price.value = p.toLocaleString('ko-KR'); calcKrw(); }
  function calcKrw() {
    var q = parseNum(qty.value), p = parseNum(price.value);
    if (!manual && isFinite(q) && isFinite(p)) krw.value = Math.round(q * p).toLocaleString('ko-KR');
    $('#salehint').textContent = PRICES[coin.value] != null ? '지금 코인원 시세 ' + won(PRICES[coin.value]) + '. 실제 체결가와 수수료 뺀 입금액으로 고쳐 주세요.' : '';
  }
  coin.onchange = fillPrice; qty.oninput = calcKrw; price.oninput = calcKrw; krw.oninput = function () { manual = true; };
  fillPrice();
}
async function submitRec() {
  var t = RECTYPE, g = function (k) { var el = $('#fx_' + k); return el ? el.value : ''; };
  var rec = { id: uid(), type: t, by: ME, createdAt: nowIso() };
  var memo = g('memo').trim(); if (memo) rec.memo = memo;
  var extra = null, planId = g('plan'), reqId = g('req');
  if (t === 'sale') {
    rec.date = g('date'); rec.coin = g('coin'); rec.qty = parseNum(g('qty')); rec.price = parseNum(g('price')); rec.krw = parseNum(g('krw')); rec.dest = g('dest');
    if (!(rec.qty > 0) || !(rec.price > 0) || !(rec.krw > 0)) return toast('수량, 매도가, 받은 원화를 넣어 주세요');
    if (rec.dest === 'joint' || rec.dest === 'corp') {
      extra = { id: uid(), type: rec.dest === 'joint' ? 'joint' : 'corp_in', by: ME, createdAt: nowIso(), date: rec.date, amount: rec.krw, linked: rec.id, memo: '매도 금액 바로 입금' };
      if (extra.type === 'joint') { extra.who = ME; extra.src = 'pool'; }
      rec.linked = extra.id;
    }
  } else {
    if (t === 'card' || t === 'corp_spend') rec.month = g('month'); else rec.date = g('date');
    rec.amount = parseNum(g('amount'));
    if (!(rec.amount > 0)) return toast('금액을 넣어 주세요');
    if (t === 'expense') rec.bucket = g('bucket');
    if (t === 'joint') { rec.who = g('who'); rec.src = g('src'); }
    if (t === 'income') rec.who = g('who');
    if (t === 'planned') rec.kind = g('kind');
  }
  if (!(rec.date || rec.month)) return toast('날짜를 넣어 주세요');
  var btn = $('#recsave'); btn.disabled = true; btn.textContent = '저장 중...';
  var label = FORMS[t].t + ' ' + (t === 'sale' ? rec.coin + ' ' + rec.qty + '개' : won(rec.amount));
  var ok = await doSave(function (L) {
    L.records = L.records || [];
    L.records.push(rec); if (extra) L.records.push(extra);
    var linkId = extra ? extra.id : rec.id;
    if (planId) { var p = L.records.find(function (x) { return x.id === planId; }); if (p) p.done = { recordId: linkId, at: nowIso(), by: ME }; }
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
    h += '<label class="f">법인 계좌 잔액</label><input id="s_corp" inputmode="numeric" value="' + (+I.corpBalance || 0).toLocaleString('ko-KR') + '">';
    h += '<button class="btn" id="s_init">이 숫자로 확정</button>';
  } else {
    h += '<div class="sub">지금 계산상 SOL ' + n2(r.hold.SOL) + '개, WLD ' + n2(r.hold.WLD) + '개, 현금 ' + won(r.cash) + ', 법인 ' + won(r.corp) + '. 실제와 다르면 실제 숫자를 넣어 맞춰 주세요 (차이만큼 기록이 남아요).</div>';
    [['cash', '지금 실제 현금'], ['SOL', '지금 실제 SOL 수량'], ['WLD', '지금 실제 WLD 수량'], ['corp', '지금 실제 법인 잔액']].forEach(function (x) { h += '<label class="f">' + x[1] + '</label><input id="adj_' + x[0] + '" inputmode="decimal" placeholder="바뀐 것만 넣기">'; });
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
  h += '<label class="f">월 생활비 한도 (공금통장으로 보내는 돈)</label><input id="p_ml" inputmode="numeric" value="' + (+S.monthly.life).toLocaleString('ko-KR') + '">';
  h += '<label class="f">월 개인비 한도 (카드)</label><input id="p_mp" inputmode="numeric" value="' + (+S.monthly.personal).toLocaleString('ko-KR') + '">';
  h += '<label class="f">카드 결제일 (매월)</label><input id="p_card" inputmode="numeric" value="' + S.cardDay + '">';
  h += '<label class="f">회사 월 예상 사용액 (사용액 기록 전까지 회사 런웨이 계산용)</label><input id="p_cg" inputmode="numeric" value="' + (+S.companyMonthlyGuess || 0).toLocaleString('ko-KR') + '">';
  h += '<button class="btn" id="p_save">계획 저장</button></div>';
  h += '<div class="card"><h3>알림 기준</h3>';
  h += '<label class="f">이번 달 주의 / 위험 (한도 대비 %)</label><div class="two"><input id="a_mw" inputmode="numeric" value="' + Math.round(A.monthWarn * 100) + '"><input id="a_md" inputmode="numeric" value="' + Math.round(A.monthDanger * 100) + '"></div>';
  h += '<label class="f">소비 속도 주의 / 위험 (계획 대비 %)</label><div class="two"><input id="a_pw" inputmode="numeric" value="' + Math.round(A.paceWarn * 100) + '"><input id="a_pd" inputmode="numeric" value="' + Math.round(A.paceDanger * 100) + '"></div>';
  h += '<label class="f">목표일 여유 기준 (몇 달치)</label><input id="a_cu" inputmode="decimal" value="' + A.cushionMonths + '">';
  h += '<label class="f">하루 부족액 증가 알림 (원)</label><input id="a_dw" inputmode="numeric" value="' + (+A.dropWarn).toLocaleString('ko-KR') + '">';
  h += '<label class="f">상대방에게 바로 알릴 금액 (원 이상)</label><input id="a_big" inputmode="numeric" value="' + (+A.bigRecord).toLocaleString('ko-KR') + '">';
  h += '<button class="btn" id="a_save">알림 기준 저장</button>';
  var st = STATE || {};
  h += '<div class="hint">마지막 알림 점검: ' + (st.lastRun ? new Date(st.lastRun).toLocaleString('ko-KR') : '아직 없음') + ' · 텔레그램: ' + (st.telegram ? '연결됨' : '아직 연결 안 됨') + '</div></div>';
  h += '<div class="card"><h3>나와 공유</h3>';
  h += '<div class="row"><span class="k">이 기기 사용자</span><span class="v">' + esc(ME) + ' <button class="mini" id="d_me">바꾸기</button></span></div>';
  h += '<div class="sub" style="margin-top:8px">여자친구분 휴대폰이나 새 기기는 공유 링크를 보내거나 QR을 찍게 하면 돼요. 로그인 없이 바로 열리고, 처음 한 번만 택/쮸를 골라요.</div>';
  h += '<button class="btn" id="d_copy">공유 링크 복사</button><button class="btn gray" id="d_qr">QR 보기</button><div id="d_out"></div>';
  h += '<div class="hint">이 링크를 가진 사람은 누구나 보고 기록할 수 있어요. 두 분만 가지고 있어 주세요. 링크가 새면 새 링크로 바꿀 수 있어요.</div>';
  h += '<button class="btn red" id="d_forget">이 기기에서 런웨이 지우기</button></div>';
  h += '<div class="card"><h3>데이터</h3><div class="sub">모든 기록은 비공개 저장소(runway-data)에 저장되고, 바뀔 때마다 변경 이력이 남아요.</div><button class="btn gray" id="x_dl">기록 파일 내려받기 (백업)</button></div>';
  $('#tab-set').innerHTML = h;
  var v = function (id) { var el = $('#' + id); return el ? el.value : ''; };
  var si = $('#s_init'); if (si) si.onclick = function () {
    var ini = { asOf: v('s_asOf'), SOL: parseNum(v('s_SOL')) || 0, WLD: parseNum(v('s_WLD')) || 0, cash: parseNum(v('s_cash')) || 0, corpBalance: parseNum(v('s_corp')) || 0 };
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
    var ns = { periodStart: v('p_start'), targetDate: v('p_target'), budgets: { life: parseNum(v('p_bl')), personal: parseNum(v('p_bp')), company: parseNum(v('p_bc')) }, monthly: { life: parseNum(v('p_ml')), personal: parseNum(v('p_mp')) }, cardDay: parseNum(v('p_card')), companyMonthlyGuess: parseNum(v('p_cg')) || 0 };
    if (!ns.periodStart || !ns.targetDate || ns.targetDate <= ns.periodStart) return toast('날짜를 확인해 주세요');
    if ([ns.budgets.life, ns.budgets.personal, ns.budgets.company, ns.monthly.life, ns.monthly.personal].some(function (x) { return !isFinite(x) || x < 0; })) return toast('금액을 확인해 주세요');
    doSave(function (L) { Object.assign(L.settings, ns); }, '계획 변경', '계획을 저장했어요');
  };
  $('#a_save').onclick = function () {
    var na = { monthWarn: parseNum(v('a_mw')) / 100, monthDanger: parseNum(v('a_md')) / 100, paceWarn: parseNum(v('a_pw')) / 100, paceDanger: parseNum(v('a_pd')) / 100, cushionMonths: parseNum(v('a_cu')), dropWarn: parseNum(v('a_dw')), bigRecord: parseNum(v('a_big')) };
    if (Object.keys(na).some(function (k) { return !isFinite(na[k]) || na[k] < 0; })) return toast('숫자를 확인해 주세요');
    doSave(function (L) { L.settings.alert = Object.assign(L.settings.alert || {}, na); }, '알림 기준 변경', '알림 기준을 저장했어요');
  };
  $('#d_me').onclick = function () { var other = ME === '택' ? '쮸' : '택'; if (confirm('이 기기 사용자를 ' + other + '(으)로 바꿀까요?')) { localStorage.setItem('runway.me', other); ME = other; toast('이제 ' + other + '(으)로 기록돼요'); renderSet(); } };
  $('#d_copy').onclick = function () { navigator.clipboard.writeText(shareUrl()).then(function () { toast('공유 링크를 복사했어요'); }, function () { prompt('아래 링크를 복사해 주세요', shareUrl()); }); };
  $('#d_qr').onclick = function () { var q = qrcode(0, 'M'); q.addData(shareUrl()); q.make(); $('#d_out').innerHTML = '<div class="qr">' + q.createSvgTag({ cellSize: 4, margin: 2, scalable: true }) + '</div><div class="hint">휴대폰 카메라로 찍으면 바로 열려요. 다 찍으면 설정 화면을 벗어나 주세요.</div>'; };
  $('#d_forget').onclick = function () { if (confirm('이 기기에서 런웨이를 지울까요? 다시 보려면 공유 링크가 필요해요.')) { localStorage.removeItem('runway.key'); localStorage.removeItem('runway.me'); location.reload(); } };
  $('#x_dl').onclick = function () { var a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([JSON.stringify(LEDGER, null, 1)], { type: 'application/json' })); a.download = 'runway-ledger-' + today() + '.json'; a.click(); };
}

boot();
})();
