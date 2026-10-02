(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.Portfolio = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';
  const MINUTE = 60000;
  const positive = n => typeof n === 'number' && Number.isFinite(n) && n > 0;
  const timestamp = n => positive(n) && n > 1e12;
  function holdingsValid(coins) {
    return Array.isArray(coins) && coins.length === 2 && ['SOL', 'WLD'].every(s =>
      coins.some(c => c.sym === s && Number.isFinite(c.qty) && c.qty >= 0 && positive(c.buy)));
  }
  function historyPoints(h, now = Date.now()) {
    if (!h || !timestamp(h.t0) || h.step !== MINUTE || !Array.isArray(h.SOL) ||
        !Array.isArray(h.WLD) || h.SOL.length !== h.WLD.length || h.SOL.length > 11000) throw new Error('history');
    return h.SOL.flatMap((s, i) => {
      const t = h.t0 + i * h.step, w = h.WLD[i];
      return positive(s) && positive(w) && t <= now + MINUTE ? [{t, SOL:s, WLD:w}] : [];
    });
  }
  function quote(message, now = Date.now()) {
    if (!message || message.response_type !== 'DATA' || message.channel !== 'TICKER') return null;
    const d = message.data;
    if (!d || d.quote_currency !== 'KRW' || !['SOL', 'WLD'].includes(d.target_currency)) return null;
    const price = Number(d.last), at = Number(d.timestamp), first = Number(d.first);
    if (!positive(price) || !timestamp(at) || at > now + MINUTE) return null;
    return {sym:d.target_currency, price, at, source:'live', utcRate:positive(first) ? (price / first - 1) * 100 : null};
  }
  function valuation(coins, quotes) {
    if (!holdingsValid(coins) || coins.some(c => !quotes[c.sym] || !positive(quotes[c.sym].price))) return null;
    const rows = coins.map(c => {
      const value = c.qty * quotes[c.sym].price, cost = c.qty * c.buy;
      return {...c, price:quotes[c.sym].price, value, cost, profit:value - cost, rate:cost > 0 ? (value / cost - 1) * 100 : null};
    });
    const value = rows.reduce((s,c) => s+c.value, 0), cost = rows.reduce((s,c) => s+c.cost, 0);
    return {rows:rows.map(c => ({...c, weight:value > 0 ? c.value/value*100 : 0})), value, cost,
      profit:value-cost, rate:cost > 0 ? (value/cost-1)*100 : null};
  }
  function atOrBefore(points, at, maxGap = 3 * MINUTE) {
    let low=0, high=points.length-1, found=-1;
    while (low<=high) {const mid=(low+high)>>1; if(points[mid].t<=at){found=mid;low=mid+1;}else high=mid-1;}
    return found>=0 && at-points[found].t<=maxGap ? points[found] : null;
  }
  const pointValue = (p, coins) => coins.reduce((s,c) => s+p[c.sym]*c.qty, 0);
  function rangeSummary(points, coins, from, to) {
    const selected=points.filter(p => p.t>=from && p.t<=to);
    if (selected.length<2) return {points:selected, change:null, rate:null, contributions:[]};
    const first=selected[0], last=selected[selected.length-1], start=pointValue(first,coins), end=pointValue(last,coins);
    return {points:selected, first, last, change:end-start, rate:start>0?(end/start-1)*100:null,
      contributions:coins.map(c=>({sym:c.sym,change:(last[c.sym]-first[c.sym])*c.qty, rate:(last[c.sym]/first[c.sym]-1)*100}))};
  }
  function freshness(quotes, now=Date.now()) {
    const qs=['SOL','WLD'].map(s=>quotes[s]);
    if(qs.some(q=>!q)) return {kind:'empty', at:null, age:null};
    const at=Math.min(...qs.map(q=>q.at)), age=Math.max(0, now-at);
    return {kind:age>3*MINUTE?'stale':qs.every(q=>q.source==='live')?'live':'history',at,age};
  }
  function scenario(x, key, coins) {
    if (!holdingsValid(coins) || !['high','mid','low'].includes(key) || coins.some(c => !positive(x?.[c.sym]?.[key]))) return null;
    const value=coins.reduce((sum,c)=>sum+x[c.sym][key]*c.qty,0),cost=coins.reduce((sum,c)=>sum+c.qty*c.buy,0);
    return {value,rate:cost>0?(value/cost-1)*100:null};
  }
  function safeURL(value) {try {const u=new URL(value); return u.protocol==='https:'||u.protocol==='http:'?u.href:null;} catch {return null;}}
  return {MINUTE,positive,timestamp,holdingsValid,historyPoints,quote,valuation,atOrBefore,pointValue,rangeSummary,freshness,scenario,safeURL};
});
