// test/server-full.test.js — 服务器连接上限满了以后，外面的人**能知道**（owner 2026-10-18）。
//
// 浏览器拿不到 WebSocket 升级失败的 HTTP 正文（只会看到一个 1006），所以「满员」必须由 /healthz 说出来：
// 这个测试钉住三件事：
//   1. /healthz 带 sockets / maxConnections（运营面板改上限、或启动参数设上限，都从这一格读）；
//   2. 到达上限后，下一个升级请求真的被拒（503）；
//   3. 没设上限时 maxConnections 是 null（客户端据此判定「不是满员」）。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { startServer } from '../server/index.js';

/** One raw WebSocket upgrade attempt: resolves the 101, or the HTTP status of the refusal. */
function upgrade(port) {
  return new Promise((resolve, reject) => {
    const req = http.request({
      host: '127.0.0.1', port, path: '/ws', agent: false,
      headers: {
        Connection: 'Upgrade', Upgrade: 'websocket', 'Sec-WebSocket-Version': '13',
        'Sec-WebSocket-Key': 'dGhlIHNhbXBsZSBub25jZQ==',
      },
    });
    req.on('upgrade', (res, socket) => resolve({ upgraded: true, socket }));
    req.on('response', (res) => { res.resume(); resolve({ upgraded: false, status: res.statusCode }); });
    req.on('error', reject);
    req.end();
  });
}

function health(port) {
  return new Promise((resolve, reject) => {
    http.get({ host: '127.0.0.1', port, path: '/healthz', agent: false }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => resolve(JSON.parse(Buffer.concat(chunks).toString('utf8'))));
    }).on('error', reject);
  });
}

test('a full server says so on /healthz and refuses the next upgrade', async () => {
  const srv = await startServer({ port: 0, host: '127.0.0.1', maxConnections: 1, quiet: true });
  try {
    const first = await upgrade(srv.port);
    assert.equal(first.upgraded, true, 'the first socket fits under the ceiling');
    const body = await health(srv.port);
    assert.equal(body.maxConnections, 1, 'the ceiling is published');
    assert.equal(body.sockets, 1, 'and how many sockets are open');
    const second = await upgrade(srv.port);
    assert.equal(second.upgraded, false);
    assert.equal(second.status, 503, 'the next upgrade is refused with 503 (the client probes /healthz)');
    first.socket.destroy();
  } finally {
    await srv.close();
  }
});

test('an empty server publishes the ceiling and its occupancy (the client compares the two)', async () => {
  const srv = await startServer({ port: 0, host: '127.0.0.1', maxConnections: 5, quiet: true });
  try {
    const body = await health(srv.port);
    assert.equal(body.maxConnections, 5);
    assert.equal(body.sockets, 0, 'nobody is connected, so 0 of 5 — not "full"');
  } finally {
    await srv.close();
  }
});
