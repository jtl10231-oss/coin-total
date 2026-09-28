// 코인 급변 텔레그램 알림: 1시간 안에 ±1%씩, 하루 사이 ±5%씩 움직이면 알림
import fs from 'fs';
import { execSync } from 'child_process';

export const RULES = [
  { key: 'h', win: 60, step: 0.01, label: '1시간 안에' },
  { key: 'd', win: 1440, step: 0.05, label: '하루 사이' },
];
const NAMES = { SOL: '솔라나(SOL)', WLD: '월드코인(WLD)' };
const APP = 'https://jtl10231-oss.github.io/coin-total/runway/';

function fmtWon(v) { return (Math.round(v * 10) / 10).toLocaleString('ko-KR') + '원'; }
function hm(ms) { const d = new Date(ms + 9 * 3600000); return String(d.getUTCHours()).padStart(2, '0') + ':' + String(d.getUTCMinutes()).padStart(2, '0'); }

// 한 시점에서 규칙 평가 (state는 코인·규칙별 마지막 알림 {dir, price, t})
export function evaluate(h, idx, state) {
  const out = [];
  const tNow = h.t0 + idx * h.step;
  for (const sym of ['SOL', 'WLD']) {
    const arr = h[sym], now = arr[idx];
    for (const r of RULES) {
      if (idx < r.win) continue;
      let lo = Infinity, hi = -Infinity, loI = idx, hiI = idx;
      for (let i = idx - r.win; i <= idx; i++) { if (arr[i] < lo) { lo = arr[i]; loI = i; } if (arr[i] > hi) { hi = arr[i]; hiI = i; } }
      const up = now / lo - 1, dn = now / hi - 1;
      const k = sym + '_' + r.key, st = state[k];
      let cand = null;
      if (up >= r.step) cand = { dir: 'up', from: lo, fromT: h.t0 + loI * h.step, chg: up };
      if (dn <= -r.step && (!cand || -dn > up)) cand = { dir: 'down', from: hi, fromT: h.t0 + hiI * h.step, chg: dn };
      let fire = null;
      if (cand) {
        const fresh = !st || tNow - st.t > r.win * 60000;
        // 한 번 알린 뒤에는 그 가격에서 다시 한 칸(1% 또는 5%) 이상 움직여야 다음 알림
        if (fresh || Math.abs(now / st.price - 1) >= r.step) fire = cand;
      }
      if (fire) { state[k] = { dir: fire.dir, price: now, t: tNow }; out.push({ sym, rule: r, now, ...fire }); }
    }
  }
  return out;
}

function message(alerts, h, idx) {
  const lines = alerts.map(a => `${NAMES[a.sym]} ${a.rule.label} ${(a.chg * 100 > 0 ? '+' : '') + (a.chg * 100).toFixed(1)}% ${a.dir === 'up' ? '올랐어요' : '내렸어요'} (${hm(a.fromT)} ${fmtWon(a.from)} → 지금 ${fmtWon(a.now)})`);
  return `쮸앤택 코인 알림\n\n${lines.join('\n')}\n\n현재가 SOL ${fmtWon(h.SOL[idx])} · WLD ${fmtWon(h.WLD[idx])} (코인원)\n${APP}`;
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
export async function sendTo(token, state, envChat, text) {
  let chat = envChat || state.chat || null;
  if (!chat) { chat = await findChat(token); if (chat) state.chat = chat; }
  if (!chat) return 'no-chat';
  let j = await tg(token, 'sendMessage', { chat_id: chat, text, disable_web_page_preview: true });
  if (!j.ok && j.parameters && j.parameters.migrate_to_chat_id) { state.chat = String(j.parameters.migrate_to_chat_id); j = await tg(token, 'sendMessage', { chat_id: state.chat, text, disable_web_page_preview: true }); }
  return j.ok ? 'sent' : 'fail:' + (j.description || '');
}

async function main() {
  const [, , HIST = '/tmp/history.json', OUT = '/tmp/alert_state.json'] = process.argv;
  const token = process.env.TELEGRAM_BOT_TOKEN || '', envChat = process.env.TELEGRAM_CHAT_ID || '';
  let state = {};
  try { state = JSON.parse(fs.readFileSync(OUT, 'utf8')); } catch { try { state = JSON.parse(execSync('git show origin/data:alert_state.json', { stdio: ['ignore', 'pipe', 'ignore'] }).toString()); } catch {} }
  const h = JSON.parse(fs.readFileSync(HIST, 'utf8'));
  const idx = h.SOL.length - 1, tNow = h.t0 + idx * h.step;
  if (state.lastT && state.lastT >= tNow) { fs.writeFileSync(OUT, JSON.stringify(state)); return; } // 같은 분은 한 번만
  const alerts = evaluate(h, idx, state);
  state.lastT = tNow;
  if (token) {
    if (!state.hello) {
      const r = await sendTo(token, state, envChat, `쮸앤택 코인 알림이 켜졌어요.\n솔라나·월드코인이 1시간 안에 1%씩, 하루 사이 5%씩 오르거나 내리면 이 방으로 알려드려요.\n${APP}`);
      if (r === 'sent') state.hello = 1;
      console.log('hello:', r);
    }
    if (alerts.length) { const r = await sendTo(token, state, envChat, message(alerts, h, idx)); console.log('price alert:', alerts.map(a => a.sym + a.rule.key + a.dir).join(','), r); }
  } else if (alerts.length) console.log('price alert (텔레그램 미설정):', alerts.map(a => a.sym + a.rule.key + a.dir).join(','));
  fs.writeFileSync(OUT, JSON.stringify(state));
}
if (process.argv[1] && process.argv[1].endsWith('price_alert.mjs')) main().catch(e => { console.log('price alert error:', e.message); });
