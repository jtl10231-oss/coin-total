/* 쮸앤택 Runway 계산 모듈 - 화면(브라우저)과 알림 점검(Node)에서 똑같이 사용 */
(function (root) {
  'use strict';
  var DAY = 86400000, MONTH = 30.4375;
  var LABEL = { sale: '매도', joint: '공금통장 입금', jbal: '공금통장 잔액', card: '카드값', expense: '지출', corp_in: '법인 입금', corp_spend: '회사 사용액', income: '현금 들어옴', planned: '예정 출금', adjust: '잔액 맞추기', memo: '메모' };
  var BUCKET = { life: '생활', personal: '개인', company: '회사', none: '용도 없음' };
  var DEST = { cash: '내 계좌(현금)', joint: '공금통장', corp: '법인' };
  var SRC = { pool: '런웨이 자산에서', own: '개인 돈에서' };

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
    S.budgets = S.budgets || { life: 30000000, personal: 18000000, company: 25000000 };
    S.monthly = S.monthly || { life: 2500000, personal: 1500000 };
    S.alert = S.alert || {};
    var A = S.alert;
    if (A.monthWarn == null) A.monthWarn = 1.0;
    if (A.monthDanger == null) A.monthDanger = 1.2;
    if (A.paceWarn == null) A.paceWarn = 1.1;
    if (A.paceDanger == null) A.paceDanger = 1.2;
    if (A.cushionMonths == null) A.cushionMonths = 1;
    if (A.cashLeadDays == null) A.cashLeadDays = 7;
    if (A.cardGraceDays == null) A.cardGraceDays = 3;
    if (A.dropWarn == null) A.dropWarn = 3000000;
    if (A.bigRecord == null) A.bigRecord = 500000;
    if (S.cardDay == null) S.cardDay = 15;
    return S;
  }

  // 달마다 생활+개인 계획 금액을 하루 단위로 나눠 빼고, 예정 출금은 그 날짜에 빼서 0이 되는 날을 찾음
  function simulate(o) {
    var P = o.pool - o.reserveNow, d = o.today, cap = addDays(o.target, 365 * 5), tYm = ymOf(o.today);
    var out = { exhaust: null, months: null, atTarget: null, survives: true };
    if (P < 0) { out.exhaust = o.today; out.months = 0; out.survives = o.today >= o.target; return out; }
    var curDaysLeft = dim(tYm) - (+o.today.slice(8, 10)) + 1;
    while (d <= cap) {
      if (d === o.target) out.atTarget = P;
      var spend = (o.plannedByDate[d] || 0) - ((o.inflowByDate && o.inflowByDate[d]) || 0);
      if (d >= o.start) {
        var m = ymOf(d);
        spend += (m === tYm) ? o.curMonthLeft / curDaysLeft : o.monthly / dim(m);
      }
      P -= spend;
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
    var from = init.asOf || '0000-00-00', start = S.periodStart, target = S.targetDate;
    var L = num(S.monthly.life) + num(S.monthly.personal);

    // 보유 수량, 현금, 법인 잔액
    var hold = { SOL: num(init.SOL), WLD: num(init.WLD) };
    var cash = num(init.cash), corp = num(init.corpBalance), cashed = 0;
    var used = { life: 0, personal: 0, company: 0 };
    var inPlan = function (r) { var d = recDay(r); return d >= from && d < target; };
    recs.forEach(function (r) {
      var a = num(r.amount);
      switch (r.type) {
        case 'sale': hold[r.coin] = num(hold[r.coin]) - num(r.qty); cash += num(r.krw); cashed += num(r.krw); break;
        case 'joint': if (r.src !== 'own') cash -= a; if (inPlan(r)) used.life += a; break;
        case 'card': cash -= a; if (inPlan(r)) used.personal += a; break;
        case 'expense': cash -= a; if (inPlan(r) && used[r.bucket] != null) used[r.bucket] += a; break;
        case 'corp_in': cash -= a; corp += a; if (inPlan(r)) used.company += a; break;
        case 'corp_spend': corp -= a; break;
        case 'income': cash += a; break;
        case 'adjust':
          if (r.what === 'cash') cash += num(r.delta);
          else if (r.what === 'corp') corp += num(r.delta);
          else if (r.what === 'SOL' || r.what === 'WLD') hold[r.what] = num(hold[r.what]) + num(r.delta);
          break;
      }
    });
    var px = { SOL: num(prices && prices.SOL), WLD: num(prices && prices.WLD) };
    var coinVal = { SOL: hold.SOL * px.SOL, WLD: hold.WLD * px.WLD };
    var coinValue = coinVal.SOL + coinVal.WLD;
    var pool = coinValue + cash;

    var remaining = {}, need = 0;
    ['life', 'personal', 'company'].forEach(function (k) { remaining[k] = num(S.budgets[k]) - used[k]; need += Math.max(0, remaining[k]); });
    var budgetTotal = num(S.budgets.life) + num(S.budgets.personal) + num(S.budgets.company);
    var surplus = pool - need;

    // 월별 소진
    function monthOf(m) {
      var inM = function (r) { return r.type === 'card' || r.type === 'corp_spend' ? r.month === m : ymOf(recDay(r)) === m; };
      var rs = recs.filter(inM);
      var o = { joint: 0, jointOwn: 0, jointBy: {}, card: 0, expense: 0, expLife: 0, expPersonal: 0, corpSpend: 0, corpIn: 0 };
      rs.forEach(function (r) {
        var a = num(r.amount);
        if (r.type === 'joint') { var w = r.who || r.by || '?'; o.jointBy[w] = (o.jointBy[w] || 0) + a; o.joint += a; if (r.src === 'own') o.jointOwn += a; }
        else if (r.type === 'card') o.card += a;
        else if (r.type === 'expense') { o.expense += a; if (r.bucket === 'life') o.expLife += a; if (r.bucket === 'personal') o.expPersonal += a; }
        else if (r.type === 'corp_spend') o.corpSpend += a;
        else if (r.type === 'corp_in') o.corpIn += a;
      });
      o.life = o.joint + o.expLife; o.personal = o.card + o.expPersonal; o.living = o.life + o.personal;
      o.total = o.joint + o.card + o.expense + o.corpSpend;
      return o;
    }
    var thisMonth = monthOf(ym);
    var jb = recs.filter(function (r) { return r.type === 'jbal'; }).sort(function (a, b) { return (a.createdAt || '') < (b.createdAt || '') ? -1 : 1; });
    var jointBalance = jb.length ? { amount: num(jb[jb.length - 1].amount), date: jb[jb.length - 1].date, by: jb[jb.length - 1].by, at: jb[jb.length - 1].createdAt } : null;
    var depTotal = {};
    recs.forEach(function (r) { if (r.type === 'joint') { var w = r.who || r.by || '?'; depTotal[w] = (depTotal[w] || 0) + num(r.amount); } });

    // 최근 속도: 계획 시작 이후 끝난 달 최대 3개
    var paceMonths = [];
    for (var i = 1; i <= 3; i++) { var m = addMonths(ym, -i); if (m >= ymOf(start)) paceMonths.push(m); }
    var paceL = paceMonths.length ? sum(paceMonths, function (m) { return monthOf(m).living; }) / paceMonths.length : null;

    // 정기 입금 예정 (예: 쮸 매월 1일 250만원 → 공금통장). 그달 실제 입금 기록이 있으면 그만큼 예정에서 뺌
    var ownBy = {};
    recs.forEach(function (r) { if (r.type === 'joint' && r.src === 'own') { var k = ymOf(r.date) + '|' + (r.who || r.by); ownBy[k] = (ownBy[k] || 0) + num(r.amount); } });
    var expected = [], expectedFuture = 0, contribMissed = [], contribNow = [];
    (S.recurring || []).forEach(function (c) {
      if (!c || !(num(c.amount) > 0) || !c.from || !c.to) return;
      for (var m = c.from; m <= c.to; m = addMonths(m, 1)) {
        var got = ownBy[m + '|' + c.who] || 0, left = Math.max(0, num(c.amount) - got);
        var due = m + '-' + String(c.day || 1).padStart(2, '0');
        if (m === ym) contribNow.push({ who: c.who, amount: num(c.amount), got: got, left: left, due: due });
        if (m < ym) { if (left > 0 && m >= ymOf(from)) contribMissed.push({ who: c.who, month: m, left: left }); continue; }
        if (left > 0) { expected.push({ who: c.who, month: m, due: due, date: due < today ? today : due, amount: left }); expectedFuture += left; }
      }
    });
    var inflowByDate = {};
    expected.forEach(function (e) { inflowByDate[e.date] = (inflowByDate[e.date] || 0) + e.amount; });
    var secured = pool + expectedFuture;
    surplus = secured - need;
    var inflowNextMonth = function (m) { return sum(expected.filter(function (e) { return e.month === m; }), function (e) { return e.amount; }); };

    // 예정 출금
    var plannedAll = all.filter(function (r) { return r.type === 'planned' && !r.canceled; });
    var planned = plannedAll.filter(function (r) { return !r.done && r.date >= today; }).sort(function (a, b) { return a.date < b.date ? -1 : 1; });
    var overdue = plannedAll.filter(function (r) { return !r.done && r.date < today; });
    var plannedByDate = {}, plannedCorp = 0;
    planned.forEach(function (p) { plannedByDate[p.date] = (plannedByDate[p.date] || 0) + num(p.amount); if (p.kind === 'corp') plannedCorp += num(p.amount); });
    var companyLeft = Math.max(0, remaining.company);
    var reserveNow = Math.max(0, companyLeft - plannedCorp); // 날짜 안 정한 회사 준비금은 바로 빠진다고 봄(보수적)

    var started = today >= start;
    var curPlanLeft = started ? Math.max(0, num(S.monthly.life) - thisMonth.life) + Math.max(0, num(S.monthly.personal) - thisMonth.personal) : 0;
    var base = { pool: pool, reserveNow: reserveNow, today: today, start: start, target: target, plannedByDate: plannedByDate, inflowByDate: inflowByDate };
    var plan = simulate(Object.assign({}, base, { monthly: L, curMonthLeft: curPlanLeft }));
    var pace = paceL == null ? null : simulate(Object.assign({}, base, { monthly: paceL, curMonthLeft: started ? Math.max(0, paceL - thisMonth.living) : 0 }));

    var plannedNoCorp = {};
    planned.forEach(function (p) { if (p.kind !== 'corp') plannedNoCorp[p.date] = (plannedNoCorp[p.date] || 0) + num(p.amount); });
    var lifeSim = simulate(Object.assign({}, base, { reserveNow: companyLeft, plannedByDate: plannedNoCorp, monthly: L, curMonthLeft: curPlanLeft }));
    var lifeMonths = lifeSim.months;
    var corpMonthsList = [];
    for (var j = 0; j <= 2; j++) { var cm = addMonths(ym, -j); var cs = monthOf(cm).corpSpend; if (cs > 0) corpMonthsList.push(cs); }
    var corpAvg = corpMonthsList.length ? sum(corpMonthsList, function (x) { return x; }) / corpMonthsList.length : num(S.companyMonthlyGuess) || null;
    var corpMonths = corpAvg ? (corp + companyLeft) / corpAvg : null;

    // 경고
    var alerts = [];
    function add(key, level, title, detail) { alerts.push({ key: key, level: level, title: title, detail: detail || '' }); }
    if (today < target) {
      if (!plan.survives) add('runway', 'danger', '9월 1일 전에 돈이 바닥나요', '계획대로 쓰면 ' + plan.exhaust + '에 바닥 (런웨이 ' + monthsText(plan.months) + ')');
      else if (plan.atTarget != null && plan.atTarget < S.alert.cushionMonths * L) add('runway', 'warn', '버티지만 여유가 한 달치 미만이에요', '목표일에 남는 돈 ' + won(plan.atTarget) + ' (한 달치 ' + won(L) + ')');
    }
    if (started) {
      [['life', '생활', thisMonth.life], ['personal', '개인', thisMonth.personal]].forEach(function (x) {
        var lim = num(S.monthly[x[0]]); if (!lim) return;
        var ratio = x[2] / lim;
        if (ratio > S.alert.monthDanger) add('month_' + x[0], 'danger', '이번 달 ' + x[1] + '비가 한도의 ' + Math.round(ratio * 100) + '%예요', won(x[2]) + ' / 한도 ' + won(lim));
        else if (ratio > S.alert.monthWarn) add('month_' + x[0], 'warn', '이번 달 ' + x[1] + '비가 한도를 넘었어요', won(x[2]) + ' / 한도 ' + won(lim));
      });
    }
    if (paceL != null && L > 0) {
      var pr = paceL / L;
      if (pr > S.alert.paceDanger) add('pace', 'danger', '최근 소비 속도가 계획보다 ' + Math.round((pr - 1) * 100) + '% 빨라요', '최근 ' + paceMonths.length + '개월 평균 ' + won(paceL) + ' / 계획 ' + won(L));
      else if (pr > S.alert.paceWarn) add('pace', 'warn', '최근 소비 속도가 계획보다 ' + Math.round((pr - 1) * 100) + '% 빨라요', '최근 ' + paceMonths.length + '개월 평균 ' + won(paceL) + ' / 계획 ' + won(L));
    }
    var daysLeftInMonth = dim(ym) - (+today.slice(8, 10));
    var nextYm = addMonths(ym, 1);
    var nextNeed = Math.max(0, (nextYm >= ymOf(start) && nextYm + '-01' < target ? L : 0) - inflowNextMonth(nextYm)) + sum(planned.filter(function (p) { return ymOf(p.date) === nextYm; }), function (p) { return p.amount; });
    if (daysLeftInMonth < S.alert.cashLeadDays && nextNeed > 0 && cash < nextNeed) {
      var gap = nextNeed - cash;
      var eq = [];
      if (px.SOL) eq.push('SOL ' + (Math.ceil(gap / px.SOL * 100) / 100) + '개');
      if (px.WLD) eq.push('WLD ' + Math.ceil(gap / px.WLD).toLocaleString('ko-KR') + '개');
      add('cash_' + nextYm, 'warn', '다음 달 쓸 현금이 ' + won(gap) + ' 모자라요', '다음 달 필요 ' + won(nextNeed) + ', 현금 ' + won(cash) + ' → 지금 시세로 ' + eq.join(' 또는 ') + ' 상당 (계산값일 뿐 매도 권유 아님)');
    }
    var hasCard = recs.some(function (r) { return r.type === 'card' && r.month === ym; });
    if (started && !hasCard && +today.slice(8, 10) > num(S.cardDay) + S.alert.cardGraceDays) add('card_' + ym, 'info', '이번 달 카드값이 아직 입력되지 않았어요', '결제일 ' + S.cardDay + '일');
    if (cash < 0) add('cash_negative', 'warn', '현금이 마이너스예요 (' + won(cash) + ')', '매도나 현금 들어옴 기록이 빠졌는지 확인해 주세요');
    contribMissed.forEach(function (c) { add('contrib_' + c.month + '_' + c.who, 'info', c.who + ' ' + +c.month.slice(5) + '월 공금통장 입금 기록이 없어요', won(c.left) + ' 예정이었어요. 입금했으면 기록 → 공금통장 입금에 적어 주세요'); });
    contribNow.forEach(function (c) { if (c.left > 0 && today > addDays(c.due, S.alert.cardGraceDays)) add('contrib_' + ym + '_' + c.who, 'info', c.who + ' 이번 달 공금통장 입금이 아직 기록되지 않았어요', c.due + ' 예정 ' + won(c.amount)); });
    if (overdue.length) add('overdue', 'info', '날짜가 지난 예정 출금이 ' + overdue.length + '건 있어요', '실제로 나갔으면 기록하고 완료 처리해 주세요');
    if (!S.confirmed) add('setup', 'info', '시작 숫자를 확인해 주세요', '설정에서 실제 코인 수량, 현금, 법인 잔액을 넣어 주세요');

    var rank = { ok: 0, info: 1, warn: 2, danger: 3 }, status = 'ok';
    alerts.forEach(function (a) { if (rank[a.level] > rank[status] && a.level !== 'info') status = a.level; });

    return {
      today: today, ym: ym, settings: S, prices: px, hold: hold, coinVal: coinVal, coinValue: coinValue, cash: cash, pool: pool, corp: corp, cashed: cashed,
      used: used, remaining: remaining, need: need, budgetTotal: budgetTotal, coverage: need > 0 ? secured / need : null, surplus: surplus, secured: secured, expectedFuture: expectedFuture, expected: expected, contribNow: contribNow,
      thisMonth: thisMonth, jointBalance: jointBalance, depTotal: depTotal, monthly: L, paceL: paceL, paceMonths: paceMonths.length,
      plan: plan, pace: pace, lifeMonths: lifeMonths, corpAvg: corpAvg, corpMonths: corpMonths, companyLeft: companyLeft, reserveNow: reserveNow,
      planned: planned, overdue: overdue, daysToTarget: diffDays(today, target), alerts: alerts, status: status
    };
  }

  var api = { SRC: SRC, compute: compute, simulate: simulate, defaults: defaults, kstToday: kstToday, addDays: addDays, diffDays: diffDays, addMonths: addMonths, ymOf: ymOf, won: won, signWon: signWon, monthsText: monthsText, LABEL: LABEL, BUCKET: BUCKET, DEST: DEST };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.RunwayCore = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
