// test/ui/chatPanelMount.test.js — 局内聊天面板必须**常驻挂载**（业主 2026-10-16「聊天框看不见别人的消息」）。
//
// 全树**只有** public/js/screens/chat.js 一处订阅 `net.on('chat.msg')`，而且它没有仓库里那种 store 侧的消息
// 缓冲（store.js 里没有 pushChatMessage 一类）。所以面板一旦卸载，订阅就消失、这期间别人的话**永久丢失**：
// 再打开是个新实例、记录从空开始，而服务端只在**重连**时补发 `chat.history`（server/lobby.js runResync）。
//
// 房间屏（screens/room.js）从头到尾无条件挂载，所以没这个问题；局内（screens/game.js）从前是
// `chatOpen ? <ChatPanel/> : null` —— 关着面板时说的所有话都看不见。修法是常驻挂载 + hidden 切换。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const read = (p) => readFileSync(path.join(ROOT, p), 'utf8');
const GAME = read('public/js/screens/game.js');
const ROOM = read('public/js/screens/room.js');
const CSS = read('public/css/screens/game.css');

test('局内聊天面板常驻挂载，用 hidden 切换（不是条件挂载）', () => {
  assert.match(GAME, /<div class="gm__chatlog" hidden=\$\{!chatOpen\}><\$\{ChatPanel\} \/><\/div>/,
    'game.js must mount the panel unconditionally with a hidden toggle');
  // 回归闸门：从前那种「条件挂载」不许回来
  assert.ok(!/chatOpen\s*\?\s*html`<div class="gm__chatlog">/.test(GAME),
    'the old chatOpen ? <ChatPanel/> : null loses every message said while the panel is closed');
});

test('hidden 能真的隐藏（display 会压过 [hidden]）', () => {
  assert.match(CSS, /\.gm__chatlog\[hidden\]\s*\{\s*display:\s*none/, 'CSS must hide the persistent panel explicitly');
});

test('全树只有 chat.js 订阅 chat.msg，且没有 store 侧缓冲 —— 卸载即丢消息', () => {
  const files = ['public/js/screens/chat.js', 'public/js/screens/game.js', 'public/js/screens/room.js', 'public/js/store.js', 'public/js/main.js', 'public/js/net.js'];
  const subs = [];
  for (const f of files) {
    // 先剥掉注释：注释里引用 `net.on('chat.msg')` 不算订阅（game.js 的解释性注释就会命中）
    const code = read(f).replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
    const n = (code.match(/net\.on\(\s*'chat\.msg'/g) || []).length;
    if (n) subs.push([f, n]);
  }
  assert.deepEqual(subs, [['public/js/screens/chat.js', 1]], 'exactly one subscription — the panel itself');
  assert.ok(!/pushChatMessage|chatMessages/.test(read('public/js/store.js')), 'no store-side buffer exists');
});

test('房间屏与局内都挂了面板', () => {
  assert.match(ROOM, /<\$\{ChatPanel\} \/>/, 'the room screen mounts it');
  assert.match(GAME, /<\$\{ChatPanel\} \/>/, 'the match screen mounts it');
});
