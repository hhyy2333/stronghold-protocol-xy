// test/ui/announceCss.test.js — 全体公告横幅**必须真的有样式**（业主 2026-10-16「公告在这不显示」）。
//
// 服务端那条链路一直是好的（test/announce.test.js 24 条：落盘、重连补推、跨槽采纳、撤回…），
// 坏的是**样式整段不存在**：本树的 public/css 里没有 .announce-bar 的任何规则，而 ui/announce.js 会
// 渲染出 DOM —— 一个没有样式的裸 div 会被游戏画面和别的层盖住（position 默认 static、没有 z-index），
// 玩家等于看不见。
//
// 这是**移植缺口**：正本 Stronghold-Protocol-repo 的 public/css/components.css 有整套样式
//（--announce-h、.announce-bar / __tag / __view / __track / __text / __close、announce-scroll 帧、
// .is-static 的 reduced-motion 分支、把 chrome 让开的 .sp-announce 规则），本树一行都没带过来；
// theme.css 里同样少了 --z-announce 令牌（正本 78）。现在两者都按正本补齐。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const read = (p) => readFileSync(path.join(ROOT, p), 'utf8');
const CSS = read('public/css/components.css');
const THEME = read('public/css/theme.css');
const JS = read('public/js/ui/announce.js');

test('公告条有定位与层级（否则会被战场/浮层盖住）', () => {
  const m = CSS.match(/\.announce-bar\s*\{([^}]*)\}/);
  assert.ok(m, '.announce-bar 必须有样式规则');
  assert.match(m[1], /position:\s*fixed/, '脱离页面流并钉在视口上');
  assert.match(m[1], /z-index:\s*var\(--z-announce\)/, '用 --z-announce 令牌分层级');
  assert.match(m[1], /top:\s*0/, '钉在顶部（跨页横幅）');
  assert.match(THEME, /--z-announce:\s*78/, 'theme.css 必须有 --z-announce（正本 78）');
});

test('定速滚动：用组件给的两个变量，且无限循环', () => {
  const kf = CSS.match(/@keyframes\s+announce-scroll\s*\{[\s\S]*?\n\}/);
  assert.ok(kf, 'announce-scroll 的 keyframes');
  assert.match(kf[0], /var\(--announce-text-w/, '位移量来自组件量出的 --announce-text-w');
  assert.match(CSS, /\.announce-bar__track\s*\{[^}]*animation:\s*announce-scroll\s+var\(--announce-dur[^}]*infinite/, '时长来自 --announce-dur 且循环（常驻公告不会滚走）');
  assert.match(JS, /--announce-dur:/, 'announce.js 设置 --announce-dur');
  assert.match(JS, /--announce-text-w/, 'announce.js 量出并设置 --announce-text-w');
});

test('prefers-reduced-motion 走静态折行（组件加 .is-static）', () => {
  assert.match(JS, /is-static/, 'announce.js 在 reduced-motion 时加这个类');
  const m = CSS.match(/\.announce-bar\.is-static\s+\.announce-bar__track\s*\{([^}]*)\}/);
  assert.ok(m, '.is-static 下必须有 track 规则');
  assert.match(m[1], /animation:\s*none/, '静态时不滚');
  assert.match(m[1], /white-space:\s*normal/, '静态时折行');
});

test('公告挂着时让开下面的 chrome（html.sp-announce）', () => {
  assert.match(JS, /useDocClass\('sp-announce'/, 'announce.js 挂 html.sp-announce');
  assert.match(CSS, /\.sp-announce\s+\.gm__hud/, 'CSS 消费这个类：对局 HUD 下移，公告不压住它');
  assert.match(CSS, /:root\s*\{\s*--announce-h:/, '高度是一个令牌');
});

test('组件用到的每个类都有样式（DOM 与 CSS 不许再脱节）', () => {
  for (const cls of ['announce-bar__tag', 'announce-bar__view', 'announce-bar__track', 'announce-bar__text', 'announce-bar__close']) {
    assert.match(JS, new RegExp(cls), `announce.js 用到 ${cls}`);
    assert.match(CSS, new RegExp('\\.' + cls + '\\b'), `${cls} 必须有一条样式规则`);
  }
});
