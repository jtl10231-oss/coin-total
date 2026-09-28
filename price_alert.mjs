// 코인 합산 급변 텔레그램 알림: 솔라나+월드코인 평가금액 합계가 1시간 안에 1.7%씩, 하루 사이 5%씩 움직이면 알림
// 보유 수량은 런웨이 기록(구글 중계 서버)에서 10분마다 읽어서 매도 기록이 자동 반영됨
import fs from 'fs';
import { execSync } from 'child_process';
import { createRequire } from 'module';
const require = createRequire(import.meta.url);

export const RULES = [
  { key: 'th', win: 60, step: 0.017, label: '1시간 안에' },
  { key: 'td', win: 1440, step: 0.05, label: '하루 사이' },
];
const APP = 'https://jtl10231-oss.github.io/coin-total/runway/';
const API = 'https://script.google.com/macros/s/AKfycbxVJypN_d3BeLrL3-y1Z453t95wdB3xRlRg72umD_-phS1Beq1sVVFB4Ay-sbSYR_6Wmg/exec';
const DEFAULT_Q = { SOL: 126.96, WLD: 12379.62 };

const man = v => Math.round(v / 10000).toLocaleString('ko-KR') + '만원';
const px = v => (Math.round(v * 10) / 10).toLocaleString('ko-KR') + '원';
const pct = x => (x > 0 ? '+' : '') + (x * 100).toFixed(1) + '%';
function hm(ms) {
  const d = new Date(ms + 9 * 3600000), today = new Date(Date.now() + 9 * 3600000).toISOString().slice(0, 10);
  const t = String(d.getUTCHours()).padStart(2, '0') + ':' + String(d.getUTCMinutes()).padStart(2, '0');
  return d.toISOString().slice(0, 10) === today ? t : '어제 ' + t;
}

export function totals(h, q) { return h.SOL.map((s, i) => s * q.SOL + h.WLD[i] * q.WLD); }

// 합계 흐름에서 규칙 평가. state는 규칙별 마지막 알림 {v, t}
// 한 번 알린 뒤에는 그 금액에서 다시 한 칸(1.7% 또는 5%) 더 움직여야 다음 알림
export function evaluate(T, t0, step, idx, state) {
  const out = [], tNow = t0 + idx * step, now = T[idx];
  for (const r of RULES) {
    if (idx < r.win) continue;
    let lo = Infinity, hi = -Infinity, loI = idx, hiI = idx;
    for (let i = idx - r.win; i <= idx; i++) { if (T[i] < lo) { lo = T[i]; loI = i; } if (T[i] > hi) { hi = T[i]; hiI = i; } }
    const up = now / lo - 1, dn = now / hi - 1, s = state[r.key];
    let cand = null;
    if (up >= r.step) cand = { dir: 'up', fromI: loI, from: lo, chg: up };
    if (dn <= -r.step && (!cand || -dn > up)) cand = { dir: 'down', fromI: hiI, from: hi, chg: dn };
    if (cand && (!s || tNow - s.t > r.win * 60000 || Math.abs(now / s.v - 1) >= r.step)) { state[r.key] = { v: now, t: tNow }; out.push({ rule: r, now, ...cand }); }
  }
  return out;
}

function message(alerts, h, idx, q) {
  const parts = alerts.map(a => {
    const s0 = h.SOL[a.fromI], w0 = h.WLD[a.fromI], s1 = h.SOL[idx], w1 = h.WLD[idx], diff = a.now - a.from;
    return `코인 합계가 ${a.rule.label} ${pct(a.chg)} ${a.dir === 'up' ? '올랐어요' : '내렸어요'} (${diff > 0 ? '+' : '-'}${man(Math.abs(diff))})\n` +
      `${hm(h.t0 + a.fromI * h.step)} ${man(a.from)} → 지금 ${man(a.now)}\n` +
      `솔라나 ${pct(s1 / s0 - 1)} (${px(s0)} → ${px(s1)}) · 월드코인 ${pct(w1 / w0 - 1)} (${px(w0)} → ${px(w1)})`;
  });
  return `쮸앤택 코인 알림\n\n${parts.join('\n\n')}\n\n보유: 솔라나 ${q.SOL.toLocaleString('ko-KR')}개 · 월드코인 ${q.WLD.toLocaleString('ko-KR')}개\n${APP}`;
}

async function tg(token, method, body) {
  const r = await fetch(`https://api.telegram.org/bot${token}/${method}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body || {}) });
  return r.json();
}
async function findChat(token) {
  const j = await tg(token, 'getUpdates', { timeout: 0 });
  let chat = null;
  for (const u of j.result || []) { const k = Object.keys(u).find(x => x !== 'update_id'); const c = u[k] && u[k].chat; if (c && (c.type === 'group' || c.type === 'supergroup')) chat = String(c.id); }
  return chat;
}
async function sendTo(token, state, envChat, text) {
  let chat = envChat || state.chat || null;
  if (!chat) { chat = await findChat(token); if (chat) state.chat = chat; }
  if (!chat) return 'no-chat';
  let j = await tg(token, 'sendMessage', { chat_id: chat, text, disable_web_page_preview: true });
  if (!j.ok && j.parameters && j.parameters.migrate_to_chat_id) { state.chat = String(j.parameters.migrate_to_chat_id); j = await tg(token, 'sendMessage', { chat_id: state.chat, text, disable_web_page_preview: true }); }
  return j.ok ? 'sent' : 'fail:' + (j.description || '');
}

// 런웨이 기록에서 지금 보유 수량 (10분마다 새로 읽고, 실패하면 마지막 값 사용)
async function holdings(state) {
  if (state.hold && Date.now() - state.hold.at < 10 * 60000) return state.hold.q;
  try {
    const j = await (await fetch(API + '?t=' + Date.now())).json();
    if (j.ok) {
      const C = require('./runway/core.js');
      const r = C.compute(j.data, { SOL: 1, WLD: 1 }, Date.now());
      const q = { SOL: Math.max(0, +r.hold.SOL || 0), WLD: Math.max(0, +r.hold.WLD || 0) };
      state.hold = { q, at: Date.now() };
      return q;
    }
  } catch (e) { console.log('holdings fetch failed:', e.message); }
  return (state.hold && state.hold.q) || DEFAULT_Q;
}

async function main() {
  const [, , HIST = '/tmp/history.json', OUT = '/tmp/alert_state.json'] = process.argv;
  const token = process.env.TELEGRAM_BOT_TOKEN || '', envChat = process.env.TELEGRAM_CHAT_ID || '';
  let state = {};
  try { state = JSON.parse(fs.readFileSync(OUT, 'utf8')); } catch { try { state = JSON.parse(execSync('git show origin/data:alert_state.json', { stdio: ['ignore', 'pipe', 'ignore'] }).toString()); } catch {} }
  const h = JSON.parse(fs.readFileSync(HIST, 'utf8'));
  const idx = h.SOL.length - 1, tNow = h.t0 + idx * h.step;
  if (state.lastT && state.lastT >= tNow) { fs.writeFileSync(OUT, JSON.stringify(state)); return; } // 같은 분은 한 번만
  const work = JSON.parse(JSON.stringify(state));
  ['SOL_h', 'SOL_d', 'WLD_h', 'WLD_d'].forEach(k => delete work[k]); // 예전 코인별 기준 상태 정리
  const q = await holdings(work);
  const T = totals(h, q);
  work.lastT = tNow;
  if (!(T[idx] > 0)) { state = work; fs.writeFileSync(OUT, JSON.stringify(state)); return; }
  const alerts = evaluate(T, h.t0, h.step, idx, work);
  if (token) {
    if (work.hello !== 3) {
      const r = await sendTo(token, work, envChat, `쮸앤택 코인 알림 기준을 바꿨어요.\n이제 솔라나+월드코인 합계(지금 ${man(T[idx])})가 1시간 안에 1.7%(${man(T[idx] * 0.017)})씩, 하루 사이 5%(${man(T[idx] * 0.05)})씩 오르거나 내리면 알려드려요.\n보유 수량은 런웨이 기록을 따라가요.\n${APP}`);
      if (r === 'sent') work.hello = 3;
      console.log('hello:', r);
    }
    if (alerts.length) {
      const r = await sendTo(token, work, envChat, message(alerts, h, idx, q));
      console.log('price alert:', alerts.map(a => a.rule.key + a.dir).join(','), r);
      if (r !== 'sent') for (const a of alerts) { if (state[a.rule.key]) work[a.rule.key] = state[a.rule.key]; else delete work[a.rule.key]; } // 못 보냈으면 다음 분에 다시
    }
  } else if (alerts.length) console.log('price alert (텔레그램 미설정):', alerts.map(a => a.rule.key + a.dir).join(','));
  state = work;
  fs.writeFileSync(OUT, JSON.stringify(state));
}
if (process.argv[1] && process.argv[1].endsWith('price_alert.mjs')) main().catch(e => { console.log('price alert error:', e.message); });
