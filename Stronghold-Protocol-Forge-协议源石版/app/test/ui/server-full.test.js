// test/ui/server-full.test.js — 「服务器满」在客户端的表现（owner 2026-10-18）：不转圈，说人话。
//
// 浏览器拿不到升级失败的 HTTP 正文，所以 net.js 在非主动断线后补一次 GET /healthz；这里钉住两件事：
//   1. 那个判定是纯函数（serverFullFrom）：只有 sockets >= maxConnections 才算满，没设上限/不知道都不算；
//   2. 接线：close 后探测、snapshot 带 full、横幅与标题屏都读它（源码断言，避免渲染整页）。
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { serverFullFrom } from '../../public/js/net.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const read = (p) => readFileSync(path.join(ROOT, p), 'utf8');

test('serverFullFrom: only at the ceiling, and never from a missing/zero cap', () => {
  assert.deepEqual(serverFullFrom({ sockets: 50, maxConnections: 50 }), { connections: 50, maxConnections: 50 });
  assert.deepEqual(serverFullFrom({ sockets: 51, maxConnections: 50 }), { connections: 51, maxConnections: 50 }, 'a race can overshoot');
  assert.equal(serverFullFrom({ sockets: 49, maxConnections: 50 }), null, 'one slot left is not full');
  assert.equal(serverFullFrom({ sockets: 50, maxConnections: null }), null, 'no ceiling');
  assert.equal(serverFullFrom({ sockets: 50, maxConnections: 0 }), null, 'zero is not a ceiling');
  assert.equal(serverFullFrom({ sockets: 50 }), null, 'an older server has no such field');
  assert.equal(serverFullFrom(null), null);
  assert.equal(serverFullFrom('nope'), null);
});

test('wiring: a refused upgrade probes /healthz and the UI shows the numbers', () => {
  const net = read('public/js/net.js');
  assert.ok(net.includes("this.fetch('/healthz', { cache: 'no-store' })"), 'the probe');
  assert.ok(net.includes('this._probeFull();'), 'called from _onClose');
  assert.ok(net.includes('full: this.full,'), 'the status snapshot carries it');
  assert.ok(net.includes('this.full = null;'), 'cleared on open / welcome');
  const banner = read('public/js/ui/connBanner.js');
  assert.ok(banner.includes('conn.status === \'reconnecting\' && conn.full'), 'the banner reads it');
  assert.ok(banner.includes('服务器已满（{n}/{max}），请稍后再试'), 'and says it in words');
  const title = read('public/js/screens/title.js');
  assert.ok(title.includes('conn.full'), 'the title screen reads it too');
  const routes = read('server/http/routes.js');
  assert.ok(routes.includes('maxConnections: network.maxConnectionCap'), '/healthz publishes the ceiling');
});
