// test/ui/room-mobile-layout.test.js — 房间屏「手机横屏」布局守卫。
//
// 业主 2026-10-21 的截图：一屏 597×270 CSS px（短横屏，根字号被 clamp 到 40px），房间的聊天面板 + 模组摘要
// 把 `.rs-seats` 挤到只剩一条缝 —— 席位卡/头像（玩家口中的「人」）看不见。修法：
//   * 短屏（max-height: 520px）聊天默认收起成**抽屉**：面板仍**常驻挂载**（只加 hidden，关着也继续收消息），
//     开关按钮 `.rs-chat-toggle` 只在短屏出现；
//   * 抽屉用 absolute 定位，展开时不再挤压席位；模组栏只留摘要（列表与 digest 在短屏隐藏）；
//   * `.rs-seats` 保底高度，席位优先于这两块辅助信息。
//
// 桌面（高屏）保持聊天常驻，不出现开关按钮。

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const read = (p) => readFileSync(path.join(ROOT, p), 'utf8');
const roomJs = read('public/js/screens/room.js');
const lobbyCss = read('public/css/screens/lobby.css');

/** The balanced `@media <query> { … }` block that contains `marker` (the file has several 520px blocks). */
function mediaBlock(css, query, marker) {
  let from = 0;
  for (;;) {
    const start = css.indexOf(`@media ${query} {`, from);
    assert.ok(start >= 0, `@media ${query} exists (${marker})`);
    let depth = 0;
    let end = -1;
    for (let i = css.indexOf('{', start); i < css.length; i += 1) {
      if (css[i] === '{') depth += 1;
      else if (css[i] === '}') {
        depth -= 1;
        if (depth === 0) { end = i + 1; break; }
      }
    }
    assert.ok(end > start, `@media ${query} is closed`);
    const block = css.slice(start, end);
    if (block.includes(marker)) return block;
    from = end;
  }
}

const SHORT = mediaBlock(lobbyCss, '(max-height: 520px)', '.rs-chat-toggle');

test('短横屏的聊天默认收起，桌面仍然常驻', () => {
  assert.match(roomJs, /const isShortRoomViewport = \(\) => \{/, 'room.js names the short-viewport probe');
  assert.match(roomJs, /matchMedia\?\.\('\(max-height: 520px\)'\)/, 'it probes the same 520px breakpoint as the CSS');
  assert.match(roomJs, /useState\(\(\) => !isShortRoomViewport\(\)\)/, 'chat starts folded on, open otherwise');
  // 旋屏：进入短屏自动收起，回到高屏恢复；不许把「桌面常驻」写死成永远 open。
  assert.match(roomJs, /setChatOpen\(!event\.matches\)/, 'a viewport change follows the breakpoint');
});

test('抽屉只加 hidden，聊天面板仍无条件挂载（关着也收消息）', () => {
  assert.match(roomJs, /<div class="rs-chat" hidden=\$\{!chatOpen\}\s*>\s*<\$\{ChatPanel\}/,
    'the panel mounts inside a hidden drawer');
  assert.ok(!/chatOpen\s*\?\s*html`<div class="rs-chat"/.test(roomJs),
    'the room chat must never be conditionally mounted (that loses messages)');
  // 开关只在短屏出现；桌面聊天常驻，不需要按钮。
  assert.match(lobbyCss, /\n\.rs-chat-toggle \{ display: none; \}/, 'the toggle is hidden on tall screens');
  assert.match(SHORT, /\.rs-chat-toggle\s*\{[^}]*display:\s*inline-grid/s, 'the toggle appears on short screens');
});

test('短横屏：抽屉浮在席位上方，不参与布局；模组栏收成摘要，席位保底高度', () => {
  assert.match(SHORT, /\.rs-chat\s*\{[^}]*position:\s*absolute/s, 'the open drawer floats');
  assert.match(SHORT, /\.rs-chat\s*\{[^}]*top:\s*1\.5rem/s, 'it starts below the top bar, so the toggle stays reachable');
  assert.match(SHORT, /\.rs-chat\s*\{[^}]*bottom:\s*1\.6rem/s, 'and ends above the footer');
  assert.match(SHORT, /\.rs-chat\[hidden\]\s*\{\s*display:\s*none/, 'hidden really hides (a display rule would win otherwise)');
  assert.match(SHORT, /\.rs-chat \.chatp \.chatp__list\s*\{[^}]*max-height/s, 'the drawer caps its log');
  assert.match(SHORT, /\.room-mods__digest,\s*\.room-mods__list\s*\{[^}]*display:\s*none/s, 'the mods summary hides its list');
  assert.match(SHORT, /\.rs-seats\s*\{[^}]*min-height/s, 'the seats keep a floor instead of collapsing to a strip');
});
