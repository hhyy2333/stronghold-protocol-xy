// 局内聊天的形态（owner's call 2026-10-18：常态开启、可隐藏，边框优化）。这里把那些不该被悄悄改回去的决定与那一条
// 硬 bug 钉住：
//   * 局内默认展开（偏好可记住），收起后新消息在 💬 上亮一个红点 —— 面板常驻挂载，所以消息本身不会丢；
//   * 局内用紧凑形态：只留「聊天」标题 + 收起按钮，没有房间的 micro 说明，快捷短语一行横向滚动；
//   * 消息行是行内流（名字 + 正文），不再是「名字 flex 定宽 + 正文 flex 挤压」——240px 宽时会压成一列一个字；
//   * 边框：局内面板走更细的薄荷线 + 收小的折角 + 毛玻璃底。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const read = (p) => readFileSync(path.join(ROOT, p), 'utf8');
const game = read('public/js/screens/game.js');
const chat = read('public/js/screens/chat.js');
const roomCss = read('public/css/screens/room.css');
const gameCss = read('public/css/screens/game.css');

test('局内聊天默认开启，选择可记住（可隐藏）', () => {
  assert.ok(game.includes('loadPref(CHAT_OPEN_PREF, true) !== false'), 'default open, the pref wins');
  assert.ok(game.includes('savePref(CHAT_OPEN_PREF, v)'), 'the toggle is remembered');
  assert.ok(game.includes('onClose='), 'the compact panel has a 收起 action');
  assert.ok(game.includes('compact='), 'in-match uses the compact form');
});

test('收起时新消息在 💬 上亮红点（面板常驻，消息不丢）', () => {
  assert.ok(game.includes("net.on('chat.msg'"), 'game.js observes chat while hidden');
  assert.ok(game.includes('setChatUnread(true)'));
  assert.ok(game.includes('has-unread'), 'the button carries the flag');
  assert.ok(gameCss.includes('.gm__dot'), 'and the dot has a style');
});

test('紧凑形态：没有 micro 说明，快捷短语一行横向滚动', () => {
  assert.ok(chat.includes('compact ? t(\'聊天\') : t(\'房内聊天\')'), 'short title');
  assert.ok(chat.includes('micro='), 'still passes micro for the room form');
  assert.ok(roomCss.includes('.chatp--compact .chatp__quick { flex-wrap: nowrap; overflow-x: auto;'));
  assert.ok(roomCss.includes('.chatp--compact .panel__head'));
});

test('消息行不再被 flex 挤压成竖排单字（owner 的 P0）', () => {
  assert.ok(roomCss.includes('.chatp__row { font-size: calc(.16 * var(--t)); line-height: 1.4; }'), 'inline flow');
  assert.ok(roomCss.includes('.chatp__text { color: var(--text-hi); overflow-wrap: anywhere; }'));
  assert.ok(!roomCss.includes('.chatp__text { flex: 1 1 auto'), 'no flex-driven 1-character column');
  assert.ok(!roomCss.includes('.chatp__name { flex: 0 0 auto'), 'no fixed-width flex name');
});

test('边框优化只作用在局内那一层（房间屏的面板不动）', () => {
  assert.ok(gameCss.includes('border-color: rgba(78, 216, 175, .2);'));
  assert.ok(gameCss.includes('backdrop-filter: blur(8px) saturate(1.1);'));
  assert.ok(gameCss.includes('.gm__chatlog .panel::after { --bk-l: .1rem; --bk-w: 1px; opacity: .8; }'));
  assert.ok(!roomCss.includes('backdrop-filter'), 'the room chat keeps its own frame');
});
