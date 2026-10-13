// probe-live.mjs — 只读探测线上服务器的真实响应性。
//
// 目的：把「服务器卡」与「客户端卡」分开。做法是绕开浏览器：
//   1) 用 ws 连上线上 /ws，按协议发 ping，量 20 次 RTT（这正是玩家诊断里的 ping 字段）。
//   2) 量几次静态资源（首页、最大的 json、一个 js）的 TTFB / 总时长。
// 全程不改服务器任何状态：只发 ping + GET。
//
// 用法：node .scratch/sp-lag/probe-live.mjs [host]
import WebSocket from '../../Stronghold-Protocol-repo/node_modules/ws/index.js';

const HOST = process.argv[2] || '47.122.107.213';
const WS_URL = `ws://${HOST}/ws`;
const HTTP = `http://${HOST}`;

const pct = (a, p) => {
  const s = [...a].sort((x, y) => x - y);
  return s[Math.min(s.length - 1, Math.floor((p / 100) * s.length))];
};
const stat = (label, xs) => {
  console.log(`${label}  n=${xs.length}  min=${Math.min(...xs).toFixed(1)}  p50=${pct(xs, 50).toFixed(1)}  p95=${pct(xs, 95).toFixed(1)}  max=${Math.max(...xs).toFixed(1)}  avg=${(xs.reduce((a, b) => a + b, 0) / xs.length).toFixed(1)}`);
};

// ---------------------------------------------------------------- WebSocket ping RTT
function pingRtts(n = 20, gapMs = 250) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(WS_URL);
    const rtts = [];
    let sent = 0;
    const timer = setTimeout(() => { try { ws.close(); } catch {} reject(new Error('timeout waiting for pongs')); }, 90_000);

    ws.on('open', () => {
      const beat = () => {
        if (sent >= n) return;
        sent++;
        ws.send(JSON.stringify({ t: 'ping', c: Date.now() }));
      };
      beat();
      const iv = setInterval(() => {
        if (sent >= n) { clearInterval(iv); return; }
        beat();
      }, gapMs);
    });

    ws.on('message', (buf) => {
      let msg;
      try { msg = JSON.parse(buf.toString()); } catch { return; }
      if (msg.t !== 'pong') return;
      // 'c' 是客户端发的时间戳；用本地时钟量 RTT 即可（同一进程）。
      rtts.push(Date.now() - Number(msg.c));
      if (rtts.length >= n) { clearTimeout(timer); try { ws.close(); } catch {} resolve(rtts); }
    });

    ws.on('error', (e) => { clearTimeout(timer); reject(e); });
    ws.on('close', () => { if (rtts.length < n) { clearTimeout(timer); resolve(rtts); } });
  });
}

// ---------------------------------------------------------------- HTTP timing
async function timeHttp(path, n = 3) {
  const out = [];
  for (let i = 0; i < n; i++) {
    const t0 = performance.now();
    let ttfb = null;
    const res = await fetch(HTTP + path);
    ttfb = performance.now() - t0;
    const body = await res.arrayBuffer();
    const total = performance.now() - t0;
    out.push({ ttfb, total, bytes: body.byteLength, status: res.status });
  }
  return out;
}

const main = async () => {
  console.log(`# 探测目标 ${HOST}  ${new Date().toISOString()}\n`);

  console.log('## 1. WebSocket ping RTT（绕开浏览器渲染，直接量服务器应答）');
  let rtts = [];
  try {
    rtts = await pingRtts(20, 250);
    stat('   RTT(ms)', rtts);
    console.log(`   逐次: ${rtts.join(', ')}`);
  } catch (e) {
    console.log(`   FAILED: ${e.message}`);
  }

  console.log('\n## 2. HTTP TTFB / 总时长');
  const targets = ['/healthz', '/', '/data/config.json', '/data/chess.json', '/js/net.js'];
  for (const t of targets) {
    try {
      const r = await timeHttp(t, 3);
      const ttfb = r.map((x) => x.ttfb);
      const tot = r.map((x) => x.total);
      console.log(`   ${t.padEnd(22)} status=${r[0].status} bytes=${r[0].bytes}  TTFB p50=${pct(ttfb, 50).toFixed(1)}ms  total p50=${pct(tot, 50).toFixed(1)}ms  [${tot.map((x) => x.toFixed(0)).join(', ')}]`);
    } catch (e) {
      console.log(`   ${t.padEnd(22)} FAILED: ${e.message}`);
    }
  }

  console.log('\n## 3. 结论口径');
  console.log('   若 WS RTT 稳定在几十 ms 且 HTTP TTFB 低 → 服务器响应正常，玩家体感卡顿在客户端渲染 / 主线程。');
  console.log('   若 WS RTT 出现秒级尖峰或大量丢答 → 服务器事件循环被阻塞（headless 战斗 / 结算 / GC）。');
};

main().catch((e) => { console.error('probe failed:', e); process.exit(1); });
