// _probe-e2e-compression.mjs —— 端到端真机验证：让仓库自己的 startServer 起来，
// 用真实浏览器式 WebSocket 客户端连上，看握手协商串和真实到达字节。
//
// 这是在【临时把 server/http/websocket.js 的 perMessageDeflate 打开】之后跑的，
// 用来证明"就改那一处、压缩就真的生效"，而不是我嘴上说的。

import { startServer } from './server/index.js';
import { WebSocket } from 'ws';

const started = await startServer({ port: 0, host: '127.0.0.1', quiet: true, feedbackDir: null, announceDir: null, notesDir: null });
const { port } = started;
console.log(`服务器起来：${started.url}`);

const client = new WebSocket(`ws://127.0.0.1:${port}/ws`);
let negotiated = null;
client.on('upgrade', (res) => { negotiated = res.headers['sec-websocket-extensions'] || '(无 Sec-WebSocket-Extensions)'; });

const frames = [];
await new Promise((res, rej) => { client.on('open', res); client.on('error', rej); });
console.log(`握手协商结果: ${negotiated}`);

// 发一个 hello，让服务器把我们当真人，然后收 welcome + 后续广播，量真实到达字节
const sock = client._socket;
const before = sock.bytesRead;
const helloT0 = Date.now();
client.send(JSON.stringify({ t: 'hello', rid: 'h1', name: 'probe', protocol: 1 }));

await new Promise((r) => setTimeout(r, 3000));
const received = sock.bytesRead - before;

console.log(`\n3 秒内从服务器实收 ${received} B`);
console.log(`协商是否含 permessage-deflate: ${/permessage-deflate/.test(negotiated || '') ? '是 ✅' : '否 ❌'}`);

client.close();
if (typeof started.stop === 'function') await started.stop();
else if (started.server) await new Promise((r) => started.server.close(r));
process.exit(0);
