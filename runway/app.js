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

// ---------- 암호화 (열쇠를 PIN/등록 암호로 잠금) ----------
var enc = new TextEncoder(), dec = new TextDecoder();
function toB64u(bytes) { var s = ''; for (var i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]); return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''); }
function fromB64u(s) { s = s.replace(/-/g, '+').replace(/_/g, '/'); while (s.length % 4) s += '='; var b = atob(s), o = new Uint8Array(b.length); for (var i = 0; i < b.length; i++) o[i] = b.charCodeAt(i); return o; }
async function keyFrom(pass, salt) {
  var k = await crypto.subtle.importKey('raw', enc.encode(pass), 'PBKDF2', false, ['deriveKey']);
  return crypto.subtle.deriveKey({ name: 'PBKDF2', salt: salt, iterations: 250000, hash: 'SHA-256' }, k, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
}
async function seal(text, pass) {
  var salt = crypto.getRandomValues(new Uint8Array(16)), iv = crypto.getRandomValues(new Uint8Array(12));
  var ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv: iv }, await keyFrom(pass, salt), enc.encode(text)));
  var out = new Uint8Array(28 + ct.length); out.set(salt, 0); out.set(iv, 16); out.set(ct, 28);
  return toB64u(out);
}
async function unseal(blob, pass) {
  var b = fromB64u(blob);
  var pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: b.slice(16, 28) }, await keyFrom(pass, b.slice(0, 16)), b.slice(28));
  return dec.decode(pt);
}

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

// ---------- 잠금 화면 ----------
function personPicker(name) {
  return '<label class="f">나는</label><div class="seg"><label><input type="radio" name="' + name + '" value="택"><span>택</span></label><label><input type="radio" name="' + name + '" value="쮸"><span>쮸</span></label></div>';
}
function pinFields() {
  return '<label class="f">PIN 만들기 (숫자 4자리 이상)</label><input id="pin1" type="password" inputmode="numeric" autocomplete="new-password">' +
    '<label class="f">PIN 한 번 더</label><input id="pin2" type="password" inputmode="numeric" autocomplete="new-password">';
}
function checkPins() {
  var a = $('#pin1').value.trim(), b = $('#pin2').value.trim();
  if (!/^\d{4,}$/.test(a)) { toast('PIN은 숫자 4자리 이상이에요'); return null; }
  if (a !== b) { toast('PIN이 서로 달라요'); return null; }
  return a;
}
function pickedPerson(name) { var el = document.querySelector('input[name="' + name + '"]:checked'); return el ? el.value : null; }
async function finishSetup(tok, person, pin) {
  var test = await readFile(FILE, tok); // 열쇠 확인
  if (!test) throw new Error('데이터 파일이 없어요');
  var blob = await seal(tok, pin);
  localStorage.setItem('runway.enc', JSON.stringify({ v: 1, person: person, blob: blob }));
  localStorage.removeItem('runway.bootstrap');
  sessionStorage.setItem('runway.tok', tok);
  TOKEN = tok; ME = person;
  if (location.hash) history.replaceState(null, '', location.pathname);
  start();
}
function showLock(html) { $('#app').hidden = true; var l = $('#lock'); l.hidden = false; l.innerHTML = '<div class="lockcard">' + html + '</div>'; }
function showFirst(tok) {
  showLock('<h2>처음 설정</h2><div class="sub">이 기기에서 쓸 사람과 PIN을 정해 주세요. 앱을 열 때마다 PIN을 물어봐요.</div>' + personPicker('who') + pinFields() + '<button class="btn" id="go">시작하기</button>');
  $('#go').onclick = async function () {
    var p = pickedPerson('who'); if (!p) return toast('누구인지 골라 주세요');
    var pin = checkPins(); if (!pin) return;
    this.disabled = true; this.textContent = '확인 중...';
    try { await finishSetup(tok, p, pin); } catch (e) { this.disabled = false; this.textContent = '시작하기'; toast(e.auth ? '열쇠가 맞지 않아요' : e.message); }
  };
}
function showJoin(blob) {
  showLock('<h2>이 기기 등록</h2><div class="sub">QR을 만든 사람에게 등록 암호를 받아 넣어 주세요.</div><label class="f">등록 암호</label><input id="jpass" type="password" autocomplete="off">' + personPicker('who') + pinFields() + '<button class="btn" id="go">등록하기</button>');
  $('#go').onclick = async function () {
    var pass = $('#jpass').value; if (!pass) return toast('등록 암호를 넣어 주세요');
    var p = pickedPerson('who'); if (!p) return toast('누구인지 골라 주세요');
    var pin = checkPins(); if (!pin) return;
    this.disabled = true; this.textContent = '확인 중...';
    var tok;
    try { tok = await unseal(blob, pass); } catch (e) { this.disabled = false; this.textContent = '등록하기'; return toast('등록 암호가 달라요'); }
    try { await finishSetup(tok, p, pin); } catch (e) { this.disabled = false; this.textContent = '등록하기'; toast(e.auth ? '이 QR의 열쇠가 폐기됐어요' : e.message); }
  };
}
function showUnlock(st) {
  showLock('<h2>쮸앤택 Runway</h2><div class="sub">' + esc(st.person) + '님, PIN을 넣어 주세요.</div><label class="f">PIN</label><input id="pin" type="password" inputmode="numeric" autocomplete="current-password"><button class="btn" id="go">열기</button><button class="btn gray" id="forget">이 기기 등록 해제</button>');
  var go = async function () {
    var pin = $('#pin').value.trim(); if (!pin) return;
    $('#go').disabled = true;
    try { var tok = await unseal(st.blob, pin); sessionStorage.setItem('runway.tok', tok); TOKEN = tok; ME = st.person; start(); }
    catch (e) { $('#go').disabled = false; $('#pin').value = ''; toast('PIN이 달라요'); }
  };
  $('#go').onclick = go;
  $('#pin').onkeydown = function (e) { if (e.key === 'Enter') go(); };
  $('#forget').onclick = function () { if (confirm('이 기기의 등록을 해제할까요? 다시 쓰려면 QR로 등록해야 해요.')) { localStorage.removeItem('runway.enc'); sessionStorage.removeItem('runway.tok'); location.reload(); } };
  setTimeout(function () { var p = $('#pin'); if (p) p.focus(); }, 50);
}
function showNoDevice() {
  showLock('<h2>등록되지 않은 기기예요</h2><div class="sub">이미 쓰고 있는 휴대폰이나 PC에서 <b>설정 → 기기 추가</b>를 눌러 QR을 만들고, 이 기기 카메라로 찍어 주세요.</div>' +
    '<details style="margin-top:16px"><summary class="muted" style="font-size:13px">열쇠 직접 넣기 (관리자용)</summary><textarea id="rawtok" placeholder="github_pat_..."></textarea><button class="btn gray" id="rawgo">다음</button></details>');
  $('#rawgo').onclick = function () { var t = $('#rawtok').value.trim(); if (!/^github_pat_/.test(t)) return toast('열쇠 형식이 아니에요'); showFirst(t); };
}
async function boot() {
  var hash = new URLSearchParams(location.hash.slice(1));
  var join = hash.get('join');
  var st = null; try { st = JSON.parse(localStorage.getItem('runway.enc') || 'null'); } catch (e) {}
  var sess = sessionStorage.getItem('runway.tok');
  if (join) return showJoin(join);
  if (st && sess) { TOKEN = sess; ME = st.person; return start(); }
  if (st) return showUnlock(st);
  var bt = localStorage.getItem('runway.bootstrap');
  if (bt) return showFirst(bt);
  showNoDevice();
}

// ---------- 앱 시작 ----------
async function start() {
  $('#lock').hidden = true; $('#app').hidden = false;
  $('#tab-home').innerHTML = '<div class="card sub">불러오는 중...</div>';
  try {
    var f = await readFile(FILE);
    LEDGER = f.data; SHA = f.sha;
  } catch (e) {
    if (e.auth) { sessionStorage.removeItem('runway.tok'); showLock('<h2>열쇠를 쓸 수 없어요</h2><div class="sub">열쇠가 만료되었거나 폐기됐어요. 다른 기기에서 QR로 다시 등록해 주세요.</div><button class="btn gray" onclick="localStorage.removeItem(\'runway.enc\');location.reload()">이 기기 등록 해제</button>'); return; }
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
  h += '<div class="hero-sub">우리의 1년 Runway · ' + esc(S.periodStart) + ' ~ ' + esc(C.addDays(S.targetDate, -1)) + '</div>';
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
  // 4 이번 달
  var tm = r.thisMonth, ml = +S.monthly.life || 0, mp = +S.monthly.personal || 0;
  h += '<div class="card"><h3>4. 이번 달 <small>' + r.ym.replace('-', '년 ') + '월</small></h3>';
  h += '<div class="row"><span class="k">공동통장 입금 (예정 ' + won(ml) + ')</span><span class="v">' + won(tm.joint) + '</span></div>';
  h += '<div class="row"><span class="k">카드값 (한도 ' + won(mp) + ')</span><span class="v">' + won(tm.card) + '</span></div>';
  if (tm.expense) h += '<div class="row"><span class="k">기타 지출</span><span class="v">' + won(tm.expense) + '</span></div>';
  h += '<div class="row"><span class="k">회사 사용액</span><span class="v">' + won(tm.corpSpend) + '</span></div>';
  h += '<div class="row total"><span class="k">이번 달 총 소진</span><span class="v">' + won(tm.total) + '</span></div>';
  h += '<div class="sub">생활 ' + (ml ? Math.round(tm.life / ml * 100) : 0) + '% · 개인 ' + (mp ? Math.round(tm.personal / mp * 100) : 0) + '% 사용 (월 한도 대비)</div></div>';
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
}

// ---------- 기록 ----------
var FORMS = {
  sale: { t: '매도', f: [['date', '날짜', 'date'], ['coin', '코인', 'coin'], ['qty', '판 수량', 'num'], ['price', '매도가 (1개 체결가)', 'won'], ['krw', '실제 받은 원화 (수수료 뺀 금액)', 'won'], ['dest', '받은 돈 보낸 곳', 'dest'], ['req', '연결할 요청 메모', 'req'], ['memo', '메모', 'text']] },
  joint: { t: '공동통장 입금', f: [['date', '날짜', 'date'], ['amount', '금액', 'won', 2500000], ['plan', '완료할 예정 출금', 'planned'], ['memo', '메모', 'text']] },
  card: { t: '카드값', f: [['month', '결제월', 'month'], ['amount', '결제 금액', 'won'], ['memo', '메모', 'text']] },
  expense: { t: '지출', f: [['date', '날짜', 'date'], ['amount', '금액', 'won'], ['bucket', '어느 예산에서', 'bucket'], ['plan', '완료할 예정 출금', 'planned'], ['memo', '어디에 썼는지', 'text']] },
  corp_in: { t: '법인 입금', f: [['date', '날짜', 'date'], ['amount', '금액', 'won'], ['plan', '완료할 예정 출금', 'planned'], ['memo', '메모', 'text']] },
  corp_spend: { t: '회사 사용액', f: [['month', '월', 'month'], ['amount', '그 달 법인 계좌에서 쓴 돈', 'won'], ['memo', '메모', 'text']] },
  income: { t: '현금 들어옴', f: [['date', '날짜', 'date'], ['amount', '금액', 'won'], ['memo', '어디서 들어온 돈인지', 'text']] },
  planned: { t: '예정 출금', f: [['date', '나갈 날짜', 'date'], ['amount', '금액', 'won'], ['kind', '종류', 'kind'], ['memo', '메모', 'text']] }
};
function field(k, label, kind, def) {
  var id = 'fx_' + k, x = '<label class="f" for="' + id + '">' + label + '</label>';
  var recs = LEDGER.records || [];
  if (kind === 'date') return x + '<input id="' + id + '" type="date" value="' + today() + '">';
  if (kind === 'month') return x + '<input id="' + id + '" type="month" value="' + today().slice(0, 7) + '">';
  if (kind === 'coin') return x + '<select id="' + id + '"><option value="SOL">SOL (솔라나)</option><option value="WLD">WLD (월드코인)</option></select>';
  if (kind === 'num') return x + '<input id="' + id + '" type="text" inputmode="decimal" placeholder="예: 3">';
  if (kind === 'won') return x + '<input id="' + id + '" type="text" inputmode="numeric" placeholder="원" value="' + (def ? def.toLocaleString('ko-KR') : '') + '">';
  if (kind === 'dest') return x + '<select id="' + id + '"><option value="cash">내 계좌에 둠 (현금)</option><option value="joint">공동통장으로 바로 보냄</option><option value="corp">법인으로 바로 보냄</option></select><div class="hint">공동통장·법인으로 바로 보냈으면 그 입금 기록도 같이 만들어져요.</div>';
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
  $('#recsave').onclick = submitRec;
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
      rec.linked = extra.id;
    }
  } else {
    if (t === 'card' || t === 'corp_spend') rec.month = g('month'); else rec.date = g('date');
    rec.amount = parseNum(g('amount'));
    if (!(rec.amount > 0)) return toast('금액을 넣어 주세요');
    if (t === 'expense') rec.bucket = g('bucket');
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
  h += '<label class="f">월 생활비 한도 (공동통장)</label><input id="p_ml" inputmode="numeric" value="' + (+S.monthly.life).toLocaleString('ko-KR') + '">';
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
  h += '<div class="card"><h3>기기 <small>이 기기: ' + esc(ME) + '</small></h3>';
  h += '<div class="sub">새 휴대폰을 등록하려면 등록 암호를 정하고 QR을 만든 뒤, 새 휴대폰 카메라로 찍어요. 암호는 QR과 따로 알려 주세요.</div>';
  h += '<label class="f">등록 암호 (6자 이상)</label><input id="d_pass" type="password" autocomplete="off">';
  h += '<button class="btn" id="d_qr">기기 추가 QR 만들기</button><div id="d_out"></div>';
  h += '<button class="btn gray" id="d_lock">지금 잠그기</button><button class="btn red" id="d_forget">이 기기 등록 해제</button></div>';
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
  $('#d_qr').onclick = async function () {
    var pass = v('d_pass'); if (pass.length < 6) return toast('등록 암호는 6자 이상이에요');
    var blob = await seal(TOKEN, pass);
    var url = location.origin + location.pathname + '#join=' + blob;
    var q = qrcode(0, 'M'); q.addData(url); q.make();
    $('#d_out').innerHTML = '<div class="qr">' + q.createSvgTag({ cellSize: 4, margin: 2, scalable: true }) + '</div><button class="btn gray" id="d_copy">등록 링크 복사</button><div class="hint">등록이 끝나면 이 화면을 닫아 주세요. QR만으로는 열 수 없고 등록 암호가 있어야 해요.</div>';
    $('#d_copy').onclick = function () { navigator.clipboard.writeText(url).then(function () { toast('링크를 복사했어요'); }); };
  };
  $('#d_lock').onclick = function () { sessionStorage.removeItem('runway.tok'); location.reload(); };
  $('#d_forget').onclick = function () { if (confirm('이 기기의 등록을 해제할까요?')) { localStorage.removeItem('runway.enc'); sessionStorage.removeItem('runway.tok'); location.reload(); } };
  $('#x_dl').onclick = function () { var a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([JSON.stringify(LEDGER, null, 1)], { type: 'application/json' })); a.download = 'runway-ledger-' + today() + '.json'; a.click(); };
}

boot();
})();
