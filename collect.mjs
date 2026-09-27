// 코인원 1분봉 종가를 모아 history.json(최근 7일)으로 저장
import fs from 'fs';
import { execSync } from 'child_process';
const OUT = process.argv[2] || 'history.json';
const SYMS = ['SOL', 'WLD'], STEP = 60000, KEEP = 7 * 24 * 60;
const sleep = ms => new Promise(r => setTimeout(r, ms));
let hist = {};
try { hist = JSON.parse(execSync('git show origin/data:history.json', { maxBuffer: 1e8, stdio: ['ignore', 'pipe', 'ignore'] }).toString()); } catch {}
if (!hist.t0 && fs.existsSync(OUT)) { try { hist = JSON.parse(fs.readFileSync(OUT, 'utf8')); } catch {} }
const map = new Map();
const put = (t, s, v) => { if (!map.has(t)) map.set(t, {}); map.get(t)[s] = v; };
let lastKnown = 0;
if (hist.t0) {
  for (const s of SYMS) (hist[s] || []).forEach((v, i) => put(hist.t0 + i * STEP, s, v));
  lastKnown = hist.t0 + (hist[SYMS[0]].length - 1) * STEP - 30 * STEP;
}
const now = Date.now(), from = Math.floor((now - KEEP * STEP) / STEP) * STEP;
async function get(sym, ts) {
  const u = `https://api.coinone.co.kr/public/v2/chart/KRW/${sym}?interval=1m&size=500` + (ts ? `&timestamp=${ts}` : '');
  for (let i = 0; i < 3; i++) {
    try { const j = await (await fetch(u)).json(); if (j.result === 'success') return j.chart; } catch {}
    await sleep(1000 * (i + 1));
  }
  throw new Error('coinone fetch failed ' + u);
}
for (const s of SYMS) {
  let ts = null, prevOldest = Infinity;
  for (let g = 0; g < 30; g++) {
    const c = await get(s, ts);
    if (!c.length) break;
    for (const k of c) put(k.timestamp, s, +k.close);
    const oldest = Math.min(...c.map(k => k.timestamp));
    if (oldest >= prevOldest || oldest <= from || (lastKnown && oldest <= lastKnown)) break;
    prevOldest = oldest; ts = oldest - STEP; await sleep(250);
  }
}
const keys = [...map.keys()].filter(t => t >= from).sort((a, b) => a - b);
const t0 = keys[0], tN = keys[keys.length - 1];
const res = { updated: now, t0, step: STEP };
for (const s of SYMS) {
  const arr = []; let last = null;
  const firstVal = keys.map(t => map.get(t)[s]).find(v => v != null);
  for (let t = t0; t <= tN; t += STEP) { const v = map.get(t)?.[s]; if (v != null) last = v; arr.push(last ?? firstVal); }
  res[s] = arr;
}
fs.writeFileSync(OUT, JSON.stringify(res));
console.log('points', res.SOL.length, new Date(t0).toISOString(), '->', new Date(tN).toISOString());
