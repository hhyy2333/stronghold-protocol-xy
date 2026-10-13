// _probe-ws-compression.mjs —— 实测「WS 传输层压缩」在真实 ws 8.22.0 上的行为，不靠嘴说。
//
// 三个对照：off / on(默认协商) / on+threshold=64，量真实 socket 上整帧加密后的字节数。
// 用真实 http.Server + WebSocketServer，跟 server/http/websocket.js 一样的 noServer 路径。
//
// 跑法： node _probe-ws-compression.mjs

import http from 'node:http';
import zlib from 'node:zlib';
import { WebSocketServer, WebSocket } from 'ws';

const wsPkg = (await import('ws/package.json', { with: { type: 'json' } })).default;

/** 造一条贴近真实 m.public 的 JSON 帧（卫戍协议：每 100 ms 广播一次全量公开状态）。 */
function makePublic(playerCount = 4) {
  const players = [];
  for (let i = 0; i < playerCount; i++) {
    const bonds = [];
    for (let b = 0; b < 6; b++) {
      bonds.push({ bondId: `bond_${b}`, count: 3 + (i % 3), active: true, tier: 2, layers: 12 + b, harmony: 1 });
    }
    players.push({
      playerId: `p_${i}`, seat: i, name: `博士${i}`, isBot: false, connected: true, alive: true,
      lp: 24 - i, bandId: 'band_0', shopLevel: 5, boardCount: 7, ready: i % 2 === 0, bonds,
      fieldId: `f_${i}`, status: 'acting', pendingLp: 1, uniteLeft: 3,
    });
  }
  return JSON.stringify({
    t: 'm.public', phase: 'PREP', round: 9, lastRound: 12, deadline: Date.now() + 30000, serverNow: Date.now(),
    modeId: 'standard', difficulty: 'HARD', stageId: 'stage_1_7', factions: ['a', 'b', 'c'],
    disabledBonds: [], bannedChess: [], bossId: 'boss_x', teamLp: 22,
    players,
    fields: players.map((p) => ({ fieldId: p.fieldId, kind: 'normal', players: [p.playerId], progress: { killed: 31, resolved: 44, total: 88, done: false } })),
  });
}

const FRAME = makePublic();
const ROUNDS = 200;
const ANSI = { off: '\x1b[31moff\x1b[0m', on: '\x1b[32mon\x1b[0m', safe: '\x1b[33msafe\x1b[0m' };

/** 起一台真实服务器 + 真实客户端，推 ROUNDS 条帧，回读每帧真实到达的字节数（客户端侧 socket 计数）。 */
function run(serverOpts, clientOpts, label) {
  return new Promise((resolve, reject) => {
    const server = http.createServer();
    const wss = new WebSocketServer({ noServer: true, ...serverOpts });
    server.on('upgrade', (req, socket, head) => {
      wss.handleUpgrade(req, socket, head, (ws) => wss.emit('connection', ws, req));
    });
    let receivedBytes = 0;
    let receivedFrames = 0;
    let negotiated = null;

    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      const client = new WebSocket(`ws://127.0.0.1:${port}`, clientOpts);
      // 客户端拿到的协商结果（这就是玩家在 DevTools 里看到的那一行）
      client.on('upgrade', (res) => { negotiated = res.headers['sec-websocket-extensions'] || '(无 Sec-WebSocket-Extensions)'; });
      client.on('open', async () => {
        const serverWs = [...wss.clients][0];
        for (let i = 0; i < ROUNDS; i++) {
          const sock = client._socket;
          const before = sock ? sock.bytesRead : 0;
          serverWs.send(FRAME);
          await new Promise((r) => setTimeout(r, 1));
          if (sock) receivedBytes += sock.bytesRead - before;
          receivedFrames += 1;
        }
        await new Promise((r) => setTimeout(r, 300));
        // 回读校验：收到的内容必须与发出去的一模一样
        client.terminate();
        wss.close();
        server.close(() => resolve({ label, negotiated, receivedBytes, receivedFrames, rawBytes: Buffer.byteLength(FRAME) * ROUNDS }));
      });
      client.on('message', (data) => {
        // 校验一次解压后正文
        if (data.toString() !== FRAME) reject(new Error(`${label}: payload mismatch`));
      });
      client.on('error', reject);
    });
  });
}

const rawPerFrame = Buffer.byteLength(FRAME);
const rawZlib = zlib.gzipSync(FRAME).length;

console.log(`ws ${wsPkg.version}  |  node ${process.version}`);
console.log(`m.public 样本（4 人席）：原样 ${rawPerFrame} B/帧，zlib 参考 ${rawZlib} B/帧`);
console.log(`每 100 ms 一帧（PUBLIC_THROTTLE=100）→ 未压缩约 ${(rawPerFrame * 10 / 1024).toFixed(1)} KB/s/连接\n`);

const cases = [
  [{ perMessageDeflate: false }, undefined, 'off（本仓库现状）'],
  [{ perMessageDeflate: true }, undefined, 'on（postMessageDeflate:true，全部默认）'],
  [{ perMessageDeflate: { threshold: 64 } }, undefined, 'on + threshold:64'],
  [{ perMessageDeflate: { threshold: 64, serverNoContextTakeover: false, clientNoContextTakeover: false } }, undefined, 'on + threshold:64 + 上下文保持'],
];

const rows = [];
for (const [so, co, label] of cases) {
  const r = await run(so, co, label);
  rows.push(r);
  console.log(`--- ${label}`);
  console.log(`    协商结果: ${r.negotiated}`);
  console.log(`    ${ROUNDS} 帧实收 ${r.receivedBytes} B  (原样应为 ${r.rawBytes} B)  压缩倍数 ${(r.rawBytes / r.receivedBytes).toFixed(2)}x  每帧 ${(r.receivedBytes / r.receivedFrames).toFixed(1)} B`);
}

console.log('\n=== 汇总 ===');
const base = rows[0].receivedBytes;
for (const r of rows) {
  const delta = ((1 - r.receivedBytes / base) * 100).toFixed(1);
  console.log(`${r.label.padEnd(40)} ${String(r.receivedBytes).padStart(9)} B  省 ${delta.padStart(5)}%   ${r.negotiated}`);
}

// threshold 的硬开关效应：低于阈值的帧完全不压（rsv1=0）
console.log('\n=== threshold 硬开关：小帧不压 ===');
for (const th of [0, 32, 64, 128, 512, 1024]) {
  const r = await run({ perMessageDeflate: { threshold: th } }, undefined, `threshold=${th}`);
  const frameBytes = r.receivedBytes / r.receivedFrames;
  console.log(`threshold=${String(th).padStart(4)}  ${rawPerFrame} B 的帧实收 ${frameBytes.toFixed(1)} B/帧  ${frameBytes > rawPerFrame * 0.98 ? '<-- 未压缩（只多帧头）' : '已压缩'}`);
}
