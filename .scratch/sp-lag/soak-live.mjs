// soak-live.mjs — 长时间探测线上服务器的「事件循环停顿」。
//
// 判据：如果服务器事件循环被阻塞，那么无论 WS 的 ping 还是 /api/admin/overview 的 HTTP 响应，
// 都会出现**成片的秒级延迟**（不是一个包丢，而是几十次请求一起变慢）。
// 如果服务器一直正常，只有偶发的几十 ms 抖动，那玩家报的 ping 6581ms / 11962ms 就不是服务器造成的。
//
// 用法：node .scratch/sp-lag/soak-live.mjs [分钟数]
import WebSocket from '../../Stronghold-Protocol-repo/node_modules/ws/index.js';

const HOST = '47.122.107.213';
const TOKEN = process.env.SP_ADMIN_TOKEN || '';
const MINUTES = Number(process.argv[2]) || 8;
const END = Date.now() + MINUTES * 60_000;

const pct = (a, p) => { const s = [...a].sort((x, y) => x - y); return s[Math.min(s.length - 1, Math.floor((p / 100) * s.length))]; };
const f = (x) => (Number.isFinite(x) ? x.toFixed(0) : '-');

const wsRtt = [];
const httpRtt = [];
const stalls = [];   // { at, kind, ms }

// ---- WS ping 流：每 500ms 一个，持续整段
let ws = null;
let wsOk = false;
function startWs() {
  ws = new WebSocket(`ws://${HOST}/ws`);
  ws.on('open', () => { wsOk = true; });
  ws.on('close', () => { wsOk = false; if (Date.now() < END) setTimeout(startWs, 1000); });
  ws.on('error', () => { wsOk = false; });
  ws.on('message', (buf) => {
    let m; try { m = JSON.parse(buf.toString()); } catch { return; }
    if (m.t !== 'pong') return;
    const rtt = Date.now() - Number(m.c);
    wsRtt.push(rtt);
    if (rtt > 400) stalls.push({ at: Date.now(), kind: 'ws-pong', ms: rtt });
  });
}
startWs();

const wsTimer = setInterval(() => {
  if (wsOk && ws.readyState === 1) ws.send(JSON.stringify({ t: 'ping', c: Date.now() }));
}, 500);

// ---- HTTP overview 流：每 1000ms 一个（需要 token 才有意义地快；没有 token 用 /healthz）
const httpTimer = setInterval(async () => {
  const url = TOKEN ? `http://${HOST}/api/admin/overview` : `http://${HOST}/healthz`;
  const t0 = Date.now();
  try {
    const ctl = new AbortController();
    const to = setTimeout(() => ctl.abort(), 30_000);
    await fetch(url, { headers: TOKEN ? { Authorization: `Bearer ${TOKEN}` } : {}, signal: ctl.signal });
    clearTimeout(to);
    const rtt = Date.now() - t0;
    httpRtt.push(rtt);
    if (rtt > 400) stalls.push({ at: Date.now(), kind: 'http', ms: rtt });
  } catch (e) {
    if (Date.now() < END) stalls.push({ at: Date.now(), kind: 'http-fail', ms: -1, err: String(e.message || e) });
  }
}, 1000);

const report = () => {
  console.log('\n================ 服务器事件循环停顿探测 ================');
  console.log(`窗口: ${MINUTES} 分钟   结束于 ${new Date().toISOString()}`);
  console.log(`WS ping 样本 n=${wsRtt.length}  min=${f(Math.min(...wsRtt))}  p50=${f(pct(wsRtt, 50))}  p95=${f(pct(wsRtt, 95))}  p99=${f(pct(wsRtt, 99))}  max=${f(Math.max(...wsRtt))}`);
  console.log(`HTTP 样本   n=${httpRtt.length}  min=${f(Math.min(...httpRtt))}  p50=${f(pct(httpRtt, 50))}  p95=${f(pct(httpRtt, 95))}  p99=${f(pct(httpRtt, 99))}  max=${f(Math.max(...httpRtt))}`);
  console.log(`\n>400ms 的停顿事件: ${stalls.length}`);
  for (const s of stalls.slice(0, 60)) {
    console.log(`   ${new Date(s.at).toISOString()}  ${s.kind.padEnd(10)} ${s.ms >= 0 ? s.ms + ' ms' : s.err}`);
  }
  // 成片判据：同一秒内 >=3 次慢请求 = 事件循环真停顿
  const bySecond = new Map();
  for (const s of stalls) { const k = Math.floor(s.at / 1000); bySecond.set(k, (bySecond.get(k) || 0) + 1); }
  const bursts = [...bySecond.entries()].filter(([, n]) => n >= 3);
  console.log(`\n同一秒内 >=3 次慢请求的「成片停顿」: ${bursts.length} 处`);
  console.log(bursts.length ? '   => 服务器事件循环确实出现成片停顿' : '   => 未见成片停顿：服务器事件循环在整段窗口内保持响应');
  clearInterval(wsTimer); clearInterval(httpTimer);
  try { ws.close(); } catch {}
  process.exit(0);
};

setTimeout(report, MINUTES * 60_000);
process.on('SIGINT', report);
console.log(`开始 ${MINUTES} 分钟探测，目标 ${HOST}${TOKEN ? '（含 admin HTTP）' : '（仅 /healthz，未给 SP_ADMIN_TOKEN）'}…`);
