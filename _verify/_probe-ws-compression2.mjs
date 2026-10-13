// _probe-ws-compression2.mjs —— 第二轮：把参考包的三条核心声明逐个实测，不靠嘴说。
//
//   1. threshold 是硬开关：低于它的帧 rsv1=0，完全不压（只多约 2 字节帧头）
//   2. 上下文保持（context takeover）在内容有变化时才是真收益
//   3. 显式声明 serverNoContextTakeover:false 会不会把要求关上下文的客户端拒绝掉（HTTP 400）

import http from 'node:http';
import { WebSocketServer, WebSocket } from 'ws';

const wsPkg = (await import('ws/package.json', { with: { type: 'json' } })).default;
console.log(`ws ${wsPkg.version} | node ${process.version}\n`);

/** 起服务器 + 一台真实客户端，把 frames 逐条推过去，量实收字节。 */
function run(serverOpts, clientOpts, frames, { expectReject = false } = {}) {
  return new Promise((resolve) => {
    const server = http.createServer();
    const wss = new WebSocketServer({ noServer: true, ...serverOpts });
    server.on('upgrade', (req, socket, head) => {
      wss.handleUpgrade(req, socket, head, (ws) => wss.emit('connection', ws, req));
    });
    let negotiated = null;
    let rejected = false;
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      const client = new WebSocket(`ws://127.0.0.1:${port}/`, clientOpts);
      client.on('upgrade', (res) => { negotiated = res.headers['sec-websocket-extensions'] || '(无)'; });
      client.on('unexpected-response', (_req, res) => {
        rejected = true;
        negotiated = `HTTP ${res.statusCode}`;
        wss.close(); server.close(() => resolve({ rejected, negotiated, bytes: 0, frames: 0 }));
      });
      client.on('error', () => {});
      client.on('open', async () => {
        if (expectReject) { client.terminate(); wss.close(); server.close(() => resolve({ rejected: false, negotiated, bytes: 0, frames: 0 })); return; }
        const serverWs = [...wss.clients][0];
        let bytes = 0;
        const sock = client._socket;
        for (const f of frames) {
          const before = sock.bytesRead;
          serverWs.send(f);
          await new Promise((r) => setTimeout(r, 1));
          bytes += sock.bytesRead - before;
        }
        await new Promise((r) => setTimeout(r, 200));
        client.terminate(); wss.close(); server.close(() => resolve({ rejected, negotiated, bytes, frames: frames.length }));
      });
    });
  });
}

const sum = (b) => b.reduce((a, x) => a + x, 0);

// ---- 1. threshold 硬开关：帧本身就小于阈值 ------------------------------------------------
console.log('=== 1. threshold 是硬开关（帧小于阈值 = 完全不压）===');
for (const size of [30, 61, 62, 63, 64, 65, 120, 200, 600]) {
  const frame = 'x'.repeat(size);              // 不可压内容：纯重复字符，压得动才有鬼
  const line = [];
  for (const th of [64, 512]) {
    const r = await run({ perMessageDeflate: { threshold: th } }, undefined, Array(50).fill(frame));
    line.push(`th=${String(th).padStart(3)}: ${(r.bytes / 50).toFixed(1)} B/帧`);
  }
  const naive = size + 2; // 不压时的帧头开销约为 2 B
  console.log(`帧 ${String(size).padStart(4)} B  ${line.join('   ')}   （原样+帧头约 ${naive} B）`);
}

// ---- 2. 上下文保持：内容持续变化时才是真收益 ----------------------------------------------
console.log('\n=== 2. 上下文保持（内容持续变化）===');
/** 造一串"每帧都不同但高度相似"的 m.public —— 真实对局的形状。 */
function changingFrames(n, seats = 4) {
  const out = [];
  for (let k = 0; k < n; k++) {
    const players = [];
    for (let i = 0; i < seats; i++) {
      players.push({
        playerId: `p_${i}`, seat: i, name: `博士${i}`, connected: true, alive: true, lp: 24 - ((i + k) % 5),
        shopLevel: 4 + (k % 3), boardCount: 5 + (k % 4), ready: (i + k) % 2 === 0,
        bonds: Array.from({ length: 6 }, (_, b) => ({ bondId: `bond_${b}`, count: 2 + ((b + k) % 5), active: true, tier: (k % 3) + 1, layers: 10 + b + k })),
        fieldId: `f_${i}`, status: k % 2 ? 'acting' : 'ready',
      });
    }
    out.push(JSON.stringify({ t: 'm.public', phase: 'PREP', round: 9, deadline: 1700000000000 + k * 100, serverNow: 1700000000000 + k * 100, players }));
  }
  return out;
}
const frames = changingFrames(300);
const rawTotal = sum(frames.map((f) => Buffer.byteLength(f)));
console.log(`300 帧变化内容，原样合计 ${rawTotal} B（平均 ${(rawTotal / 300).toFixed(0)} B/帧）`);
for (const [label, opts] of [
  ['上下文保持 ON  (默认, 不声明)', { threshold: 64 }],
  ['上下文保持 OFF (safe 档)', { threshold: 64, serverNoContextTakeover: true }],
  ['关闭压缩       (现状)', false],
]) {
  const r = await run({ perMessageDeflate: opts }, undefined, frames);
  const ratio = opts === false ? 1 : rawTotal / r.bytes;
  console.log(`  ${label.padEnd(30)} 实收 ${String(r.bytes).padStart(7)} B  ${(r.bytes / 300).toFixed(1)} B/帧  ${opts === false ? '—' : ratio.toFixed(2) + 'x'}`);
}

// ---- 3. 显式声明会不会拒绝客户端 ---------------------------------------------------------
console.log('\n=== 3. 显式声明 serverNoContextTakeover:false 会不会拒绝客户端 ===');
for (const [label, opts] of [
  ['不声明（交给协商）', { threshold: 64 }],
  ['显式 false（= 要求上下文保持）', { threshold: 64, serverNoContextTakeover: false }],
  ['显式 true（= 要求不保持）', { threshold: 64, serverNoContextTakeover: true }],
]) {
  const r = await run({ perMessageDeflate: opts }, undefined, ['hi']);
  console.log(`  ${label.padEnd(32)} 协商=${r.negotiated}`);
}
// 客户端要求 server_no_context_takeover，服务器显式 false：按参考包说法会被 HTTP 400 拒
const hostile = await run({ perMessageDeflate: { threshold: 64, serverNoContextTakeover: false } },
  { perMessageDeflate: { serverNoContextTakeover: true } }, ['hi'], { expectReject: true });
console.log(`  客户端要求 server_no_context_takeover + 服务器显式 false → 协商=${hostile.negotiated}${hostile.rejected ? '  <-- 连不上（HTTP 400）' : '  （没被拒）'}`);
