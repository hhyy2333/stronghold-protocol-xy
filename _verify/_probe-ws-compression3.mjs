// _probe-ws-compression3.mjs —— 第三轮：threshold 的真实语义 + Chrome 风格的 offer。
//
// 源码事实（node_modules/ws/lib/sender.js:371-384）：
//   if (rsv1 && perMessageDeflate && perMessageDeflate.params[isServer ? 'server_no_context_takeover' : 'client_no_context_takeover'])
//       rsv1 = byteLength >= perMessageDeflate._threshold;
//   → threshold 只在【上下文保持被关掉】的那一侧才生效；上下文保持开着时它被完全忽略，所有帧都压。

import http from 'node:http';
import { WebSocketServer, WebSocket } from 'ws';

console.log(`ws ${(await import('ws/package.json', { with: { type: 'json' } })).default.version} | node ${process.version}\n`);

function run(serverOpts, clientOpts, frames) {
  return new Promise((resolve) => {
    const server = http.createServer();
    const wss = new WebSocketServer({ noServer: true, ...serverOpts });
    server.on('upgrade', (req, socket, head) => wss.handleUpgrade(req, socket, head, (ws) => wss.emit('connection', ws, req)));
    let negotiated = null;
    server.listen(0, '127.0.0.1', () => {
      const client = new WebSocket(`ws://127.0.0.1:${server.address().port}/`, clientOpts);
      client.on('upgrade', (res) => { negotiated = res.headers['sec-websocket-extensions'] || '(无)'; });
      client.on('error', () => {});
      client.on('open', async () => {
        const serverWs = [...wss.clients][0];
        const sock = client._socket;
        let bytes = 0;
        for (const f of frames) {
          const before = sock.bytesRead;
          serverWs.send(f);
          await new Promise((r) => setTimeout(r, 1));
          bytes += sock.bytesRead - before;
        }
        await new Promise((r) => setTimeout(r, 150));
        client.terminate(); wss.close(); server.close(() => resolve({ negotiated, bytes }));
      });
    });
  });
}

// 不可压载荷：随机字节的 base64（高熵，deflate 压不动）→ 这样"实收是否接近原样"才等于"压没压"
const rnd = (n) => { let s = ''; for (let i = 0; i < n; i++) s += String.fromCharCode(33 + ((i * 7919 + 13) % 90)); return s; };
const incompressible = (n) => rnd(n);

console.log('=== A. threshold 真相：同一批帧，开/关上下文保持 ===');
console.log('（用高熵不可压载荷：实收≈原样 就说明该帧根本没压）\n');
for (const size of [40, 100, 200, 600, 2000]) {
  const frame = incompressible(size);
  const out = [];
  for (const [label, opts] of [
    ['保持ON (默认)', { threshold: 64 }],
    ['保持ON th=1024', { threshold: 1024 }],
    ['保持OFF th=64', { threshold: 64, serverNoContextTakeover: true }],
    ['保持OFF th=1024', { threshold: 1024, serverNoContextTakeover: true }],
  ]) {
    const r = await run({ perMessageDeflate: opts }, undefined, Array(20).fill(frame));
    const per = r.bytes / 20;
    const compressed = per < size * 0.9;
    out.push(`${label}: ${per.toFixed(1)}B${compressed ? ' 压' : ' 不压'}`);
  }
  console.log(`帧 ${String(size).padStart(4)}B  ${out.join(' | ')}`);
}

console.log('\n=== B. Chrome 风格的 offer（浏览器会主动声明 client_no_context_takeover）===');
// Chrome 发的 offer 大致是：permessage-deflate; client_max_window_bits
const chromeish = { perMessageDeflate: { clientMaxWindowBits: true } };
for (const [label, opts] of [
  ['on（不声明任何选项）', { threshold: 64 }],
  ['on + serverNoContextTakeover:true', { threshold: 64, serverNoContextTakeover: true }],
  ['on + serverMaxWindowBits:10', { threshold: 64, serverMaxWindowBits: 10 }],
  ['on + 两个都声明（最激进）', { threshold: 64, serverNoContextTakeover: true, serverMaxWindowBits: 10 }],
]) {
  const r = await run({ perMessageDeflate: opts }, chromeish, ['ping']);
  console.log(`  ${label.padEnd(34)} 协商 = ${r.negotiated}`);
}

console.log('\n=== C. 真实 m.public 帧在各种档位下的每连接带宽（100ms 一帧）===');
function makePublic() {
  const players = [];
  for (let i = 0; i < 4; i++) {
    players.push({ playerId: `p_${i}`, seat: i, name: `博士${i}`, connected: true, alive: true, lp: 20, shopLevel: 5, boardCount: 7, ready: true,
      bonds: Array.from({ length: 6 }, (_, b) => ({ bondId: `bond_${b}`, count: 3, active: true, tier: 2, layers: 12 + b })),
      fieldId: `f_${i}`, status: 'acting' });
  }
  return JSON.stringify({ t: 'm.public', phase: 'PREP', round: 9, deadline: Date.now() + 30000, serverNow: Date.now(), players });
}
const pub = makePublic();
const size = Buffer.byteLength(pub);
console.log(`帧原样 ${size} B`);
for (const [label, opts] of [
  ['off（仓库现状）', false],
  ['on 默认', { threshold: 64 }],
  ['on + serverNoContextTakeover', { threshold: 64, serverNoContextTakeover: true }],
]) {
  const r = await run({ perMessageDeflate: opts }, undefined, Array(100).fill(pub));
  const per = r.bytes / 100;
  const kbps = (per * 10 / 1024).toFixed(2);
  console.log(`  ${label.padEnd(30)} ${per.toFixed(1)} B/帧  ${kbps} KB/s 每连接  ${opts === false ? '' : (size / per).toFixed(2) + 'x'}`);
}
