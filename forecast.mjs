// 센티멘트 점수(0~100)와 1/3/7/14일 가격 예측 범위를 계산해 forecast.json으로 저장
import fs from 'fs';
import { execSync } from 'child_process';
const OUT = process.argv[2] || 'forecast.json';
const HOLD = { SOL: { qty: 42.32, buy: 165000, cg: 'solana' }, WLD: { qty: 4126.54, buy: 730, cg: 'worldcoin-wld' } };
const HORIZONS = [1, 3, 7, 14];
const TILT = 0.25;              // 센티멘트가 중앙값을 움직이는 최대 폭 = 표준편차의 25%
const MIN_INTERVAL = 55 * 60000; // 약 1시간에 한 번만 다시 계산
const sleep = ms => new Promise(r => setTimeout(r, ms));
let prev = null;
try { prev = JSON.parse(execSync('git show origin/data:forecast.json', { stdio: ['ignore', 'pipe', 'ignore'] }).toString()); } catch {}
if (!prev && fs.existsSync(OUT)) { try { prev = JSON.parse(fs.readFileSync(OUT, 'utf8')); } catch {} }
if (prev && Date.now() - prev.updated < MIN_INTERVAL && !process.env.FORCE) { fs.writeFileSync(OUT, JSON.stringify(prev)); console.log('skip (recent)'); process.exit(0); }

async function j(u) {
  for (let i = 0; i < 3; i++) {
    try { const r = await fetch(u, { headers: { accept: 'application/json' } }); if (r.ok) return await r.json(); } catch {}
    await sleep(1500 * (i + 1));
  }
  return null;
}
const clamp = v => Math.max(0, Math.min(100, v));
const tanhScore = (x, scale) => clamp(50 + 50 * Math.tanh(x / scale));
async function daily(sym) {
  const d = await j(`https://api.coinone.co.kr/public/v2/chart/KRW/${sym}?interval=1d&size=200`);
  return d.chart.map(k => ({ t: k.timestamp, c: +k.close })).sort((a, b) => a.t - b.t);
}
async function last(sym) {
  const d = await j(`https://api.coinone.co.kr/public/v2/ticker_new/KRW/${sym}`);
  return +d.tickers[0].last;
}
function logRets(cl) { const r = []; for (let i = 1; i < cl.length; i++) r.push(Math.log(cl[i] / cl[i - 1])); return r; }
function std(a) { const m = a.reduce((x, y) => x + y, 0) / a.length; return Math.sqrt(a.reduce((x, y) => x + (y - m) ** 2, 0) / (a.length - 1)); }
function rsi(cl, n = 14) {
  let g = 0, l = 0;
  for (let i = 1; i <= n; i++) { const d = cl[i] - cl[i - 1]; d > 0 ? g += d : l -= d; }
  g /= n; l /= n;
  for (let i = n + 1; i < cl.length; i++) { const d = cl[i] - cl[i - 1]; g = (g * (n - 1) + Math.max(d, 0)) / n; l = (l * (n - 1) + Math.max(-d, 0)) / n; }
  return l === 0 ? 100 : 100 - 100 / (1 + g / l);
}
const label = s => s < 20 ? '매우 부정' : s < 40 ? '부정' : s < 60 ? '중립' : s < 80 ? '긍정' : '매우 긍정';
function combine(parts) {
  const ok = parts.filter(p => p.score != null && isFinite(p.score));
  const w = ok.reduce((a, p) => a + p.w, 0);
  const score = ok.reduce((a, p) => a + p.score * p.w, 0) / w;
  return { score: Math.round(score), label: label(score), parts };
}

// ---- 시장 전반 ----
const fng = await j('https://api.alternative.me/fng/?limit=1');
const glob = await j('https://api.coingecko.com/api/v3/global');
const btcD = await daily('BTC');
const btcCl = btcD.map(x => x.c);
const btcSig = std(logRets(btcCl.slice(-91)));
const btc7 = Math.log(btcCl.at(-1) / btcCl.at(-8));
const mcap = glob?.data?.market_cap_change_percentage_24h_usd;
const market = combine([
  { name: '공포·탐욕 지수', w: 0.5, raw: fng ? `${fng.data[0].value} (${fng.data[0].value_classification})` : '불러오기 실패', score: fng ? +fng.data[0].value : null },
  { name: '비트코인 7일 추세', w: 0.3, raw: `${(100 * (Math.exp(btc7) - 1)).toFixed(1)}%`, score: tanhScore(btc7, btcSig * Math.sqrt(7)) },
  { name: '전체 시가총액 24시간', w: 0.2, raw: mcap != null ? `${mcap.toFixed(1)}%` : '불러오기 실패', score: mcap != null ? tanhScore(mcap, 3) : null },
]);

// ---- 코인별 ----
const coins = {};
for (const [sym, h] of Object.entries(HOLD)) {
  const d = await daily(sym);
  const cl = d.map(x => x.c);
  const sig = std(logRets(cl.slice(-91)));
  const r7 = Math.log(cl.at(-1) / cl.at(-8));
  const cg = await j(`https://api.coingecko.com/api/v3/coins/${h.cg}?localization=false&tickers=false&market_data=false&community_data=false&developer_data=false`);
  await sleep(1200);
  const up = cg?.sentiment_votes_up_percentage;
  const r = rsi(cl.slice(-60));
  const s = combine([
    { name: '7일 추세', w: 0.45, raw: `${(100 * (Math.exp(r7) - 1)).toFixed(1)}%`, score: tanhScore(r7, sig * Math.sqrt(7)) },
    { name: 'RSI(14일)', w: 0.35, raw: r.toFixed(0), score: r },
    { name: 'CoinGecko 투표 긍정 비율', w: 0.2, raw: up != null ? `${up.toFixed(0)}%` : '불러오기 실패', score: up ?? null },
  ]);
  const p0 = await last(sym);
  coins[sym] = { price: p0, sigmaDaily: sig, sentiment: s, closes: d };
}


// ---- 한 줄 뉴스 (구글 뉴스, 최근 3일) ----
const decode = t => t.replace(/<!\[CDATA\[|\]\]>/g, '').replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>');
async function news(query, must) {
  try {
    const t = await (await fetch('https://news.google.com/rss/search?q=' + encodeURIComponent(query + ' when:3d') + '&hl=ko&gl=KR&ceid=KR:ko')).text();
    const out = [], seen = new Set();
    for (const m of t.matchAll(/<item>([\s\S]*?)<\/item>/g)) {
      const g = k => decode((m[1].match(new RegExp('<' + k + '[^>]*>([\\s\\S]*?)</' + k + '>')) || [])[1] || '');
      const src = g('source');
      let title = g('title'); if (src && title.endsWith(' - ' + src)) title = title.slice(0, -(src.length + 3));
      if (!must.test(title) || /coinone\.co\.kr|upbit|bithumb/i.test(src) || /coinone\.co\.kr/.test(g('link'))) continue;
      const key = title.replace(/\s/g, '').slice(0, 18); if (seen.has(key)) continue; seen.add(key);
      out.push({ title, source: src, link: g('link'), date: Date.parse(g('pubDate')) });
      if (out.length >= 3) break;
    }
    return out;
  } catch { return prev?.news?.[query] || []; }
}
const newsRes = { SOL: await news('솔라나', /솔라나|SOL\b|Solana/i), WLD: await news('월드코인', /월드코인|WLD\b|Worldcoin/i) };

// ---- 예측: 변동성(최근 90일) 기반 범위 + 센티멘트로 중앙값 소폭 조정 ----
function band(p0, sig, S, hDays) {
  const sh = sig * Math.sqrt(hDays);
  const mu = TILT * ((S - 50) / 50) * sh;
  return { mid: p0 * Math.exp(mu), low: p0 * Math.exp(mu - sh), high: p0 * Math.exp(mu + sh) };
}
const combined = sym => 0.6 * coins[sym].sentiment.score + 0.4 * market.score;
// 보유 총액의 변동성: 두 코인의 날짜를 맞춰 총액 일별 수익률로 계산
const mapW = new Map(coins.WLD.closes.map(x => [x.t, x.c]));
const port = coins.SOL.closes.filter(x => mapW.has(x.t)).map(x => x.c * HOLD.SOL.qty + mapW.get(x.t) * HOLD.WLD.qty);
const portSig = std(logRets(port.slice(-91)));
const cost = Object.values(HOLD).reduce((a, h) => a + h.qty * h.buy, 0);
const v0 = coins.SOL.price * HOLD.SOL.qty + coins.WLD.price * HOLD.WLD.qty;
const wS = coins.SOL.price * HOLD.SOL.qty / v0;
const portS = wS * combined('SOL') + (1 - wS) * combined('WLD');
const forecast = HORIZONS.map(hd => {
  const t = band(v0, portSig, portS, hd);
  return {
    days: hd,
    SOL: band(coins.SOL.price, coins.SOL.sigmaDaily, combined('SOL'), hd),
    WLD: band(coins.WLD.price, coins.WLD.sigmaDaily, combined('WLD'), hd),
    TOTAL: { ...t, midRate: (t.mid - cost) / cost * 100, lowRate: (t.low - cost) / cost * 100, highRate: (t.high - cost) / cost * 100 },
  };
});
const res = {
  updated: Date.now(),
  market,
  SOL: { price: coins.SOL.price, sigmaDaily: coins.SOL.sigmaDaily, sentiment: coins.SOL.sentiment, used: Math.round(combined('SOL')) },
  WLD: { price: coins.WLD.price, sigmaDaily: coins.WLD.sigmaDaily, sentiment: coins.WLD.sentiment, used: Math.round(combined('WLD')) },
  TOTAL: { value: v0, sigmaDaily: portSig },
  forecast,
  news: newsRes,
};
fs.writeFileSync(OUT, JSON.stringify(res));
console.log(JSON.stringify({ market: market.score, SOL: res.SOL.sentiment.score, WLD: res.WLD.sentiment.score, sig: [res.SOL.sigmaDaily, res.WLD.sigmaDaily, portSig].map(x => x.toFixed(4)), f7: forecast[2], news: newsRes }, null, 1));
