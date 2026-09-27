// 솔라나/월드코인 중요 뉴스: 구글 뉴스(한국어+영어)에서 최근 기사 수집 → 중요도 점수로 선별
import fs from 'fs';
const OUT = process.argv[2] || 'news.json';
const COINS = {
  SOL: { ko: '솔라나', en: 'Solana', must: /솔라나|\bSOL\b|Solana/i },
  WLD: { ko: '월드코인', en: 'Worldcoin OR "World Network" OR WLD', must: /월드코인|\bWLD\b|Worldcoin|World Network|World ID/i },
};
const MAJOR_EN = /CoinDesk|The Block|Decrypt|Cointelegraph|Bloomberg|Reuters|CNBC|Blockworks|DL News|Fortune|Forbes|Wall Street Journal|Financial Times|TechCrunch|The Verge|Axios/i;
const BLOCK_SRC = /coinone\.co\.kr|upbit|bithumb|topstarnews|톱스타뉴스|Yellow\.com|Coinpedia|CoinGape|Bitget|MEXC|Binance Square|TradingView|Benzinga|FXStreet|AMBCrypto|U\.Today|Crypto\.news|CoinCodex|Changelly|The Crypto Basic|Finbold/i;
const HOT = [
  [/ETF|SEC|CFTC|승인|approv/i, 4], [/상장폐지|delist/i, 5], [/상장|listing|lists /i, 3],
  [/해킹|탈취|익스플로잇|hack|exploit|drain|breach/i, 6], [/장애|중단|다운|outage|halt/i, 5],
  [/업그레이드|하드포크|메인넷|알펜글로우|Alpenglow|Firedancer|upgrade|mainnet/i, 3],
  [/출시|런칭|launch|unveil|rollout/i, 2], [/파트너십|제휴|협력|partnership|partner|integrat/i, 2],
  [/규제|금지|제재|조사|소송|벌금|기소|regulat|ban|probe|lawsuit|sue|fine|investigat|charged/i, 4],
  [/언락|락업|unlock|에어드랍|airdrop/i, 3], [/순유입|순유출|inflow|outflow|기관|institution|treasury|재무|펀드|fund/i, 2],
  [/인수|acqui|투자 유치|raise|funding/i, 2], [/올트먼|Altman|오픈AI|OpenAI|Tools for Humanity|Orb|오브|World ID|홍채|iris|개인정보|privacy/i, 2],
  [/고래|whale|대량 매도|dump|청산|liquidat/i, 1],
];
const PRICE_RECAP = /jumps?|spikes?|soars?|plunges?|rall(y|ies)|surges?|slumps?|price|가격|급등|급락|반등|폭등|폭락|\d+(\.\d+)?\s*%\s*(상승|하락|올라|내려|급등|급락|↑|↓)|\d+(\.\d+)?%\s*(up|down|gain|drop|surge|jump|slide)|price (prediction|analysis)|가격 전망|시세|전망|예측|AI는|AI가|PICK|포지션|선물|코인 가격\]|시황|차트|기술적 분석|지지선|저항선|목표가|달러 회복|\?$/i;
const decode = t => t.replace(/<!\[CDATA\[|\]\]>/g, '').replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').trim();
async function rss(q, hl) {
  const url = hl === 'ko'
    ? 'https://news.google.com/rss/search?q=' + encodeURIComponent(q + ' when:2d') + '&hl=ko&gl=KR&ceid=KR:ko'
    : 'https://news.google.com/rss/search?q=' + encodeURIComponent(q + ' when:2d') + '&hl=en-US&gl=US&ceid=US:en';
  const t = await (await fetch(url)).text();
  return [...t.matchAll(/<item>([\s\S]*?)<\/item>/g)].map(m => {
    const g = k => decode((m[1].match(new RegExp('<' + k + '[^>]*>([\\s\\S]*?)</' + k + '>')) || [])[1] || '');
    const source = g('source'); let title = g('title');
    if (source && title.endsWith(' - ' + source)) title = title.slice(0, -(source.length + 3));
    return { title, source, link: g('link'), date: Date.parse(g('pubDate')), lang: hl };
  });
}
const norm = s => s.toLowerCase().replace(/[^0-9a-z가-힣]/g, '');
function similar(a, b) { const A = norm(a), B = norm(b); if (A.slice(0, 16) === B.slice(0, 16)) return true;
  const grams = s => new Set(Array.from({ length: Math.max(0, s.length - 2) }, (_, i) => s.slice(i, i + 3)));
  const x = grams(A), y = grams(B); let c = 0; x.forEach(g => y.has(g) && c++); return c / Math.max(1, Math.min(x.size, y.size)) > 0.6; }
function score(n) {
  let hot = 0; const cats = [];
  HOT.forEach(([re, w], i) => { if (re.test(n.title)) { hot += w; cats.push(i); } });
  const recap = PRICE_RECAP.test(n.title);
  let s = hot;
  if (recap) s -= 2;
  if (n.lang === 'en') s += 1;
  const hrs = (Date.now() - n.date) / 3.6e6;
  s += hrs < 3 ? 3 : hrs < 12 ? 2 : hrs < 24 ? 1 : 0;
  // 가장 무게가 큰 주제를 대표 주제로 (같은 주제 기사 중복 방지)
  const top = cats.slice().sort((a, b) => HOT[b][1] - HOT[a][1])[0];
  // 중요 뉴스 조건: 핵심 주제어가 있어야 하고, 시세 기사면 무게 4 이상 주제(ETF·해킹·규제·상장폐지 등)가 있어야 함
  const ok = hot >= 2 && (!recap || hot >= 4);
  return { s, recap, hot, top, ok };
}
const res = { updated: Date.now() };
for (const [sym, c] of Object.entries(COINS)) {
  let items = [];
  for (const [q, hl] of [[c.ko, 'ko'], [c.en, 'en']]) { try { items.push(...await rss(q, hl)); } catch {} }
  items = items.filter(n => n.title && c.must.test(n.title) && (n.lang === 'ko' || MAJOR_EN.test(n.source)) && !BLOCK_SRC.test(n.source) && !BLOCK_SRC.test(n.link) && isFinite(n.date) && n.date <= Date.now() + 6e5);
  items.forEach(n => Object.assign(n, score(n)));
  items.sort((a, b) => b.s - a.s || b.date - a.date);
  const pick = [];
  for (const win of [24, 48]) {
    for (const n of items) {
      if (pick.length >= 3) break;
      if ((Date.now() - n.date) / 3.6e6 > win || !n.ok) continue;
      if (pick.some(p => p === n || similar(p.title, n.title) || (p.top != null && p.top === n.top))) continue;
      pick.push(n);
    }
  }
  res[sym] = pick.map(({ title, source, link, date, s, lang }) => ({ title, source, link, date, score: s, lang }));
  const latest = items.filter(n => !pick.includes(n)).sort((a, b) => b.date - a.date)[0];
  res[sym + '_latest'] = latest ? { title: latest.title, source: latest.source, link: latest.link, date: latest.date } : null;
}
fs.writeFileSync(OUT, JSON.stringify(res));
for (const k of ['SOL', 'WLD']) res[k].forEach(n => console.log(k, n.score, new Date(n.date).toISOString().slice(5, 16), n.source, '|', n.title));
