/* 쮸앤택 Runway 계산 모듈 v3 - 화면과 코인 알림(보유 수량)에서 같이 사용
   자산 = 코인 + 공금통장 잔액(추정) + 현금 / 확보 자금 = 자산 + 앞으로 들어올 정기 입금
   공금통장 잔액(추정) = 마지막으로 입력한 잔액 + 그 뒤 들어온 돈(매도 금액, 입금, 정기 입금 자동) - 적어 둔 지출
   소비 속도 = 잔액 입력 사이사이 (직전 잔액 + 그사이 들어온 돈 - 이번 잔액) ÷ 날짜 */
(function (root) {
  'use strict';
  var DAY = 86400000, MONTH = 30.4375;
  var LABEL = { sale: '매도', jbal: '잔액 입력', joint: '공금통장 입금', expense: '지출', planned: '예정 출금', skip: '정기 입금 안 들어옴', card: '카드값', corp_in: '법인 입금', corp_spend: '회사 사용액', income: '현금 들어옴', adjust: '잔액 맞추기', memo: '메모' };
  var BUCKET = { life: '생활', personal: '개인', company: '회사', none: '예산 밖' };
  var DEST = { cash: '내 계좌(현금)', joint: '공금통장', corp: '법인' };
  var SRC = { pool: '택 현금에서', own: '개인 돈에서' };

  function kstToday(now) { return new Date((now || Date.now()) + 9 * 3600000).toISOString().slice(0, 10); }
  function toMs(d) { var p = d.split('-'); return Date.UTC(+p[0], +p[1] - 1, +p[2]); }
  function fromMs(ms) { return new Date(ms).toISOString().slice(0, 10); }
  function addDays(d, n) { return fromMs(toMs(d) + n * DAY); }
  function diffDays(a, b) { return Math.round((toMs(b) - toMs(a)) / DAY); }
  function ymOf(d) { return d.slice(0, 7); }
  function dim(ym) { var p = ym.split('-'); return new Date(Date.UTC(+p[0], +p[1], 0)).getUTCDate(); }
  function addMonths(ym, n) { var p = ym.split('-'); return new Date(Date.UTC(+p[0], +p[1] - 1 + n, 1)).toISOString().slice(0, 7); }
  function num(v) { v = +v; return isFinite(v) ? v : 0; }
  function sum(a, f) { var s = 0; for (var i = 0; i < a.length; i++) s += num(f(a[i])); return s; }
  function won(n) { return Math.round(n).toLocaleString('ko-KR') + '원'; }
  function signWon(n) { return (n < 0 ? '-' : '+') + won(Math.abs(n)); }
  function monthsText(m) { return m == null ? '5년 이상' : (Math.floor(m * 10) / 10).toFixed(1) + '개월'; }
  function recDay(r) { return r.date || (r.month ? r.month + '-01' : ''); }

  function defaults(S) {
    S = S || {};
    S.budgets = S.budgets || { life: 30000000, personal: 0, company: 0 };
    S.monthly = S.monthly || { life: 2500000, personal: 0 };
    S.alert = S.alert || {};
    var A = S.alert;
    if (A.paceWarn == null) A.paceWarn = 1.1;
    if (A.paceDanger == null) A.paceDanger = 1.2;
    if (A.cushionMonths == null) A.cushionMonths = 1;
    if (A.staleDays == null) A.staleDays = 10;
    if (A.jointWarnDays == null) A.jointWarnDays = 14;
    if (A.minBurnDays == null) A.minBurnDays = 7;
    if (A.monthWarn == null) A.monthWarn = 1.0;
    if (A.monthDanger == null) A.monthDanger = 1.2;
    return S;
  }

  // 오늘부터 하루 단위로: 한 달 소비를 날마다 나눠 빼고, 예정 출금은 그날 빼고, 들어올 돈은 그날 더해서 0 아래로 내려가는 날을 찾음
  function simulate(o) {
    var P = o.pool, d = o.today, cap = addDays(o.target, 365 * 5);
    var out = { exhaust: null, months: null, atTarget: null, survives: true };
    if (P < 0) { out.exhaust = o.today; out.months = 0; out.survives = o.today >= o.target; return out; }
    while (d <= cap) {
      if (d === o.target) out.atTarget = P;
      P += (o.inflowByDate[d] || 0) - (o.plannedByDate[d] || 0) - o.monthly / dim(ymOf(d));
      if (P < 0) {
        out.exhaust = d; out.months = diffDays(o.today, d) / MONTH; out.survives = d >= o.target;
        if (d < o.target) out.atTarget = null;
        return out;
      }
      d = addDays(d, 1);
    }
    return out;
  }

  function compute(ledger, prices, now) {
    var S = defaults(JSON.parse(JSON.stringify(ledger.settings || {})));
    var today = kstToday(now), ym = ymOf(today);
    var all = ledger.records || [];
    var recs = all.filter(function (r) { return !r.canceled && r.type !== 'memo'; });
    var init = S.initial || {};
    var from = init.asOf || '0000-00-00', target = S.targetDate;
    var planMonthly = num(S.monthly.life) + num(S.monthly.personal);

    // 1) 코인, 현금, 공금통장으로 들어오고 나가는 돈
    var hold = { SOL: num(init.SOL), WLD: num(init.WLD) };
    var cash = num(init.cash), corp = num(init.corpBalance), cashed = 0;
    var used = { life: 0, personal: 0, company: 0 };
    var ev = []; // 공금통장 흐름 {date, at, amount(+들어옴/-나감), kind, rec}
    recs.forEach(function (r) {
      var a = num(r.amount);
      switch (r.type) {
        case 'sale':
          hold[r.coin] = num(hold[r.coin]) - num(r.qty); cashed += num(r.krw);
          if (r.dest === 'cash' || r.linked) cash += num(r.krw); // 예전 방식 기록
          else if (r.dest !== 'corp') ev.push({ date: r.date, at: r.createdAt || '', amount: num(r.krw), kind: 'sale', rec: r });
          break;
        case 'joint': ev.push({ date: r.date, at: r.createdAt || '', amount: a, kind: 'dep', rec: r }); if (r.src === 'pool') cash -= a; break;
        case 'expense': ev.push({ date: r.date, at: r.createdAt || '', amount: -a, kind: 'expense', rec: r }); break;
        case 'card': cash -= a; if (recDay(r) >= from && recDay(r) < target) used.personal += a; break;
        case 'corp_in': cash -= a; corp += a; if (recDay(r) >= from && recDay(r) < target) used.company += a; break;
        case 'corp_spend': corp -= a; break;
        case 'income': cash += a; break;
        case 'adjust':
          if (r.what === 'cash') cash += num(r.delta);
          else if (r.what === 'corp') corp += num(r.delta);
          else if (r.what === 'SOL' || r.what === 'WLD') hold[r.what] = num(hold[r.what]) + num(r.delta);
          break;
      }
    });

    // 2) 정기 입금 (예: 쮸 매월 1일 250만원). 날짜가 지나면 들어온 걸로 자동 반영, 직접 적은 입금이 있으면 그만큼 빼고, "안 들어옴" 표시한 달은 제외
    var ownBy = {}, skip = {};
    recs.forEach(function (r) {
      if (r.type === 'joint' && r.src === 'own') { var k = ymOf(r.date) + '|' + (r.who || r.by); (ownBy[k] = ownBy[k] || []).push(num(r.amount)); }
      if (r.type === 'skip') skip[r.month + '|' + r.who] = r;
    });
    var expected = [], expectedFuture = 0, autoDeps = [], skipped = [];
    (S.recurring || []).forEach(function (c) {
      if (!c || !(num(c.amount) > 0) || !c.from || !c.to) return;
      for (var m = c.from; m <= c.to; m = addMonths(m, 1)) {
        var due = m + '-' + String(c.day || 1).padStart(2, '0');
        if (skip[m + '|' + c.who]) { if (due <= today) skipped.push({ who: c.who, month: m, due: due, amount: num(c.amount), rec: skip[m + '|' + c.who] }); continue; }
        // 그달 같은 사람이 정기 입금과 같은 금액(±1%)을 직접 적었으면 그게 정기 입금. 다른 금액은 추가 입금으로 따로 더해짐
        var same = (ownBy[m + '|' + c.who] || []).some(function (x) { return Math.abs(x - num(c.amount)) <= num(c.amount) * 0.01; });
        var left = same ? 0 : num(c.amount);
        if (!left) continue;
        if (due <= today) { autoDeps.push({ who: c.who, month: m, due: due, amount: left }); ev.push({ date: due, at: '', amount: left, kind: 'auto', who: c.who }); }
        else { expected.push({ who: c.who, month: m, due: due, date: due, amount: left }); expectedFuture += left; }
      }
    });
    ev.sort(function (a, b) { return a.date < b.date ? -1 : a.date > b.date ? 1 : (a.at < b.at ? -1 : a.at > b.at ? 1 : 0); });

    // 3) 공금통장 잔액: 직접 입력한 잔액이 기준점
    var anchors = recs.filter(function (r) { return r.type === 'jbal' && r.date; }).map(function (r) { return { date: r.date, at: r.createdAt || '', amount: num(r.amount), by: r.by, id: r.id }; })
      .sort(function (a, b) { return a.date < b.date ? -1 : a.date > b.date ? 1 : (a.at < b.at ? -1 : 1); });
    // 흐름이 기준점 뒤인지: 날짜가 더 늦으면 뒤, 같은 날이면 적은 시각이 더 늦을 때만 뒤 (정기 입금 자동분은 같은 날이면 잔액에 이미 들어간 걸로 봄)
    function afterA(e, a) { if (e.date !== a.date) return e.date > a.date; return !!e.at && e.at > a.at; }
    var intervals = [];
    for (var i = 1; i < anchors.length; i++) {
      var a0 = anchors[i - 1], a1 = anchors[i];
      var inflow = sum(ev.filter(function (e) { return e.amount > 0 && afterA(e, a0) && !afterA(e, a1); }), function (e) { return e.amount; });
      intervals.push({ from: a0.date, to: a1.date, days: diffDays(a0.date, a1.date), inflow: inflow, spend: a0.amount + inflow - a1.amount, start: a0.amount, end: a1.amount });
    }
    var last = anchors.length ? anchors[anchors.length - 1] : null;
    var since = ev.filter(function (e) { return e.date <= today && (last ? afterA(e, last) : e.date >= from); });
    var balanceBase = last ? last.amount : num(init.joint);
    var balance = balanceBase + sum(since, function (e) { return e.amount; });
    var inflowSince = sum(since.filter(function (e) { return e.amount > 0; }), function (e) { return e.amount; });
    var expenseSince = -sum(since.filter(function (e) { return e.kind === 'expense'; }), function (e) { return e.amount; });

    // 4) 소비 속도 (최근 90일 안의 잔액 입력 구간)
    var recent = intervals.filter(function (iv) { return iv.to >= addDays(today, -90); });
    var burnDays = sum(recent, function (iv) { return iv.days; }), burnSpend = sum(recent, function (iv) { return iv.spend; });
    var burnDaily = burnDays > 0 ? burnSpend / burnDays : null;
    var burnMonthly = burnDaily != null ? burnDaily * MONTH : null;
    var burnReady = burnDaily != null && burnDaily > 0 && burnDays >= S.alert.minBurnDays; // 잔액이 오히려 늘었으면(기록 안 된 입금) 계획 금액을 씀

    // 마지막 잔액 입력 뒤 지난 날 동안 쓴 돈 추정 (소비 속도, 없으면 계획 금액). 적어 둔 지출이 더 크면 그걸로
    var dailyEst = burnReady ? Math.max(0, burnDaily) : planMonthly / MONTH;
    var daysSince = last ? Math.max(0, diffDays(last.date, today)) : 0;
    var spendEstSince = last ? Math.max(expenseSince, dailyEst * daysSince) : 0;
    var balanceRecorded = balance;
    balance = last ? balanceBase + inflowSince - spendEstSince : balance;

    // 쓴 돈: 계획 시작 이후 잔액 구간 소비 + 마지막 입력 뒤에 적어 둔 지출
    function spentIn(ms, me) { // ms~me(포함) 기간에 쓴 돈 (구간 소비를 날짜 비율로 나눔)
      var s = 0;
      intervals.forEach(function (iv) {
        if (!iv.days) { if (iv.to >= ms && iv.to <= me) s += iv.spend; return; }
        var lo = iv.from > addDays(ms, -1) ? iv.from : addDays(ms, -1), hi = iv.to < me ? iv.to : me;
        var ov = diffDays(lo, hi); if (ov > 0) s += iv.spend * ov / iv.days;
      });
      if (last && daysSince > 0) { // 마지막 입력 다음 날 ~ 오늘을 하루 평균으로 나눔
        var lo2 = last.date > addDays(ms, -1) ? last.date : addDays(ms, -1), hi2 = today < me ? today : me;
        var ov2 = diffDays(lo2, hi2); if (ov2 > 0) s += spendEstSince * ov2 / daysSince;
      } else if (!last) s += sum(since.filter(function (e) { return e.kind === 'expense' && e.date >= ms && e.date <= me; }), function (e) { return -e.amount; });
      return s;
    }
    used.life = spentIn(from, addDays(target, -1));
    var spentThisMonth = spentIn(ym + '-01', ym + '-' + String(dim(ym)).padStart(2, '0'));

    // 5) 자산, 목표
    var px = { SOL: num(prices && prices.SOL), WLD: num(prices && prices.WLD) };
    var coinVal = { SOL: hold.SOL * px.SOL, WLD: hold.WLD * px.WLD };
    var coinValue = coinVal.SOL + coinVal.WLD;
    var assetsNow = coinValue + balance + cash;
    var secured = assetsNow + expectedFuture;
    var remaining = {}, need = 0;
    ['life', 'personal', 'company'].forEach(function (k) { remaining[k] = num(S.budgets[k]) - used[k]; need += Math.max(0, remaining[k]); });
    var budgetTotal = num(S.budgets.life) + num(S.budgets.personal) + num(S.budgets.company);
    var surplus = secured - need;

    // 6) 런웨이
    var plannedAll = all.filter(function (r) { return r.type === 'planned' && !r.canceled; });
    var planned = plannedAll.filter(function (r) { return !r.done && r.date >= today; }).sort(function (a, b) { return a.date < b.date ? -1 : 1; });
    var overdue = plannedAll.filter(function (r) { return !r.done && r.date < today; });
    var plannedByDate = {}, inflowByDate = {};
    planned.forEach(function (p) { plannedByDate[p.date] = (plannedByDate[p.date] || 0) + num(p.amount); });
    expected.forEach(function (e) { inflowByDate[e.date] = (inflowByDate[e.date] || 0) + e.amount; });
    var base = { today: today, target: target, plannedByDate: plannedByDate, inflowByDate: inflowByDate };
    var plan = simulate(Object.assign({}, base, { pool: assetsNow, monthly: planMonthly }));
    var pace = burnReady ? simulate(Object.assign({}, base, { pool: assetsNow, monthly: Math.max(0, burnMonthly) })) : null;
    var mainMonthly = burnReady ? Math.max(0, burnMonthly) : planMonthly;
    var main = pace || plan;
    var jointOnly = simulate(Object.assign({}, base, { pool: balance + cash, monthly: mainMonthly }));

    // 7) 경고 (앱 화면)
    var alerts = [];
    function add(key, level, title, detail) { alerts.push({ key: key, level: level, title: title, detail: detail || '' }); }
    var basis = burnReady ? '지금 소비 속도(월 ' + won(burnMonthly) + ')로' : '계획(월 ' + won(planMonthly) + ')대로';
    if (today < target) {
      if (!main.survives) add('runway', 'danger', '9월 1일 전에 돈이 바닥나요', basis + ' 쓰면 ' + main.exhaust + '에 바닥 (런웨이 ' + monthsText(main.months) + ')');
      else if (main.atTarget != null && main.atTarget < S.alert.cushionMonths * mainMonthly) add('runway', 'warn', '버티지만 여유가 한 달치 미만이에요', '목표일에 남는 돈 ' + won(main.atTarget));
    }
    if (burnReady && planMonthly > 0) {
      var pr = burnMonthly / planMonthly;
      if (pr > S.alert.paceDanger) add('pace', 'danger', '소비 속도가 계획보다 ' + Math.round((pr - 1) * 100) + '% 빨라요', '최근 ' + burnDays + '일 기준 월 ' + won(burnMonthly) + ' / 계획 ' + won(planMonthly));
      else if (pr > S.alert.paceWarn) add('pace', 'warn', '소비 속도가 계획보다 ' + Math.round((pr - 1) * 100) + '% 빨라요', '최근 ' + burnDays + '일 기준 월 ' + won(burnMonthly) + ' / 계획 ' + won(planMonthly));
    }
    if (jointOnly.exhaust && diffDays(today, jointOnly.exhaust) <= S.alert.jointWarnDays) {
      var needSell = Math.max(0, mainMonthly);
      var eq = [];
      if (px.SOL) eq.push('SOL ' + (Math.ceil(needSell / px.SOL * 100) / 100) + '개');
      if (px.WLD) eq.push('WLD ' + Math.ceil(needSell / px.WLD).toLocaleString('ko-KR') + '개');
      add('joint_low', 'warn', jointOnly.exhaust + '쯤 공금통장이 바닥나요', '그 전에 코인을 팔아야 해요. 한 달 생활비 ' + won(needSell) + ' = 지금 시세로 ' + eq.join(' 또는 ') + ' (계산값일 뿐 매도 권유 아님)');
    }
    if (!last) add('no_balance', 'info', '토스뱅크 잔액을 입력해 주세요', '잔액을 입력해야 소비 속도와 런웨이가 계산돼요');
    else if (diffDays(last.date, today) > S.alert.staleDays) add('stale', 'info', '잔액을 ' + diffDays(last.date, today) + '일째 안 적었어요', '토스뱅크 잔액을 입력하면 소비 속도가 다시 계산돼요');
    if (cash < 0) add('cash_negative', 'warn', '현금이 마이너스예요 (' + won(cash) + ')', '기록이 빠졌는지 확인해 주세요');
    if (overdue.length) add('overdue', 'info', '날짜가 지난 예정 출금이 ' + overdue.length + '건 있어요', '실제로 나갔으면 지출로 기록하고 완료 처리해 주세요');
    if (!S.confirmed) add('setup', 'info', '시작 숫자를 확인해 주세요', '설정에서 실제 코인 수량을 넣어 주세요');
    var rank = { ok: 0, info: 1, warn: 2, danger: 3 }, status = 'ok';
    alerts.forEach(function (a) { if (rank[a.level] > rank[status] && a.level !== 'info') status = a.level; });

    return {
      today: today, ym: ym, settings: S, prices: px, hold: hold, coinVal: coinVal, coinValue: coinValue, cash: cash, corp: corp, cashed: cashed,
      balance: balance, balanceRecorded: balanceRecorded, balanceBase: balanceBase, spendEstSince: spendEstSince, daysSince: daysSince, dailyEst: dailyEst, lastAnchor: last, anchors: anchors, intervals: intervals, inflowSince: inflowSince, expenseSince: expenseSince, events: ev,
      burnDaily: burnDaily, burnMonthly: burnMonthly, burnDays: burnDays, burnReady: burnReady, spentThisMonth: spentThisMonth,
      expected: expected, expectedFuture: expectedFuture, autoDeps: autoDeps, skipped: skipped,
      assetsNow: assetsNow, pool: assetsNow, secured: secured, used: used, remaining: remaining, need: need, budgetTotal: budgetTotal, coverage: need > 0 ? secured / need : null, surplus: surplus,
      planMonthly: planMonthly, mainMonthly: mainMonthly, plan: plan, pace: pace, main: main, jointOnly: jointOnly, planned: planned, overdue: overdue,
      daysToTarget: diffDays(today, target), alerts: alerts, status: status
    };
  }

  var api = { compute: compute, simulate: simulate, defaults: defaults, kstToday: kstToday, addDays: addDays, diffDays: diffDays, addMonths: addMonths, ymOf: ymOf, won: won, signWon: signWon, monthsText: monthsText, LABEL: LABEL, BUCKET: BUCKET, DEST: DEST, SRC: SRC };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.RunwayCore = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
