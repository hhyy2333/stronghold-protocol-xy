// test/ui/panelSend.test.js — 面板发消息那一跳的参数形状（业主 2026-10-20：「源石证券交易所买/卖按钮点了没反应」）。
//
// 根因：`extensions.js` 把**一整条消息对象**交给了 `Net.send(t, fields)`，而它的第一个参数必须是类型字符串 ——
//   `net.send({ t:'pack.msg', … })` → validateC2S 判成 `unknown type [object Object]` → 帧一个字节都不落 socket，
//   只在 console 留一句 warning，调用方只拿到 false。面板没错、服务端没错，中间这一跳把消息吞了。
// 这里用**真** Net 实例（只替换 `_sendRaw`）验证修复后的那一段。
import test from 'node:test';
import assert from 'node:assert/strict';
import { Net } from '../../public/js/net.js';
import { c2sFrameArgs } from '../../public/js/ui/extensions.js';

function fakeNet() {
  const net = Object.create(Net.prototype);
  net.status = 'online';
  net.frames = [];
  net._sendRaw = (msg) => { net.frames.push(msg); return true; };
  return net;
}

test('c2sFrameArgs splits a whole message into [type, fields]', () => {
  assert.deepEqual(c2sFrameArgs({ t: 'pack.msg', pack: 'originium-exchange', channel: 'trade', data: { op: 'buy' } }),
    ['pack.msg', { pack: 'originium-exchange', channel: 'trade', data: { op: 'buy' } }]);
  assert.deepEqual(c2sFrameArgs({ t: 'room.appearance', look: 1 }), ['room.appearance', { look: 1 }]);
  assert.equal(c2sFrameArgs(null), null);
  assert.equal(c2sFrameArgs({}), null, 'a message without a type cannot be sent');
  assert.equal(c2sFrameArgs({ t: '' }), null);
});

test('the OLD shape is refused by the real Net (this is what the bug looked like)', () => {
  const net = fakeNet();
  // what extensions.js used to do
  const refused = net.send({ t: 'pack.msg', pack: 'originium-exchange', channel: 'trade', data: { op: 'buy' } });
  assert.equal(refused, false, 'an object as the first argument is refused');
  assert.equal(net.frames.length, 0, 'and nothing reaches the socket');
});

test('the NEW shape really writes a pack.msg frame to the socket', () => {
  const net = fakeNet();
  const msg = { t: 'pack.msg', pack: 'originium-exchange', channel: 'trade', data: { op: 'buy', stock: 'YAN', qty: 1, lever: 1 } };
  const args = c2sFrameArgs(msg);
  assert.ok(args, 'the splitter produced send() arguments');
  const ok = net.send(args[0], args[1]);
  assert.equal(ok, true, 'the frame was accepted');
  assert.equal(net.frames.length, 1);
  const f = net.frames[0];
  assert.equal(f.t, 'pack.msg');
  assert.equal(f.pack, 'originium-exchange');
  assert.equal(f.channel, 'trade');
  assert.deepEqual(f.data, { op: 'buy', stock: 'YAN', qty: 1, lever: 1 });
});

test('no CODE PATH hands Net.send a whole message object any more', async () => {
  const { readFileSync } = await import('node:fs');
  const src = readFileSync(new URL('../../public/js/ui/extensions.js', import.meta.url), 'utf8');
  // strip comments first: the header documents the OLD broken shape as the counter-example
  const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  assert.ok(!/net\.send\(\s*\{/.test(code), 'no `net.send({ … })` left — that shape is refused at runtime');
  assert.ok(/net\.send\(args\[0\], args\[1\]\)/.test(code), 'the only send goes through the splitter');
});