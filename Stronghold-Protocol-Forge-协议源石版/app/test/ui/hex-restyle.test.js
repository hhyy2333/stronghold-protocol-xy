// test/ui/hex-restyle.test.js — 协议源石界面的视觉重制（owner 2026-10-18）不许被静默改回去。
//
// 这一轮是纯视觉：磨砂玻璃卡牌 + 发光斜切倒角、斜切阶位签、描述遮罩、荧光青主色、环境粒子与扫描线、
// 标题 glitch、刷新按钮流光边。仓库没有 CSS 构建步骤，删掉一段样式只会在真浏览器里「看起来普通」，
// 所以这里把**契约**钉住（选择器存在、关键属性存在、可访问性/性能约束仍然成立）。
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const read = (p) => readFileSync(path.join(ROOT, p), 'utf8');
const CSS = read('public/css/screens/game-panels.css');
const JS = read('public/js/ui/hexOverlay.js');

test('the overlay mounts the ambient layer and the glitch title', () => {
  assert.ok(JS.includes('hxov__ambient'), 'the particle / ambient layer');
  assert.ok(JS.includes('hx-glitch'), 'the glitch title');
  assert.ok(JS.includes('data-text'), 'the glitch pseudo layers need the text');
  assert.ok(JS.includes('hxcard__bevel'), 'the chamfered bevel layer');
});

test('cards: frosted glass, glowing bevel, cyan hover, masked description', () => {
  assert.match(CSS, /\.hxcard\s*\{[^}]*backdrop-filter:\s*blur\(/, 'the card is frosted glass');
  // 阶位点阵不能被任何东西糊掉：这层 scrim 不许有 backdrop-filter
  assert.match(CSS, /\.hxcard\.has-tier \.hxcard__glow\s*\{[^}]*backdrop-filter:\s*none/, 'the tier art stays crisp (no blur over the dot matrix)');
  assert.match(CSS, /\.hxcard\s*\{[^}]*\-webkit-backdrop-filter:\s*blur\(/, 'with the -webkit- prefix (Safari)');
  assert.match(CSS, /\.hxcard__bevel\s*\{[^}]*clip-path:\s*polygon\(/, 'the bevel is chamfered');
  assert.match(CSS, /\.hxcard\.is-tappable:hover\s*\{[^}]*rgba\(0,\s*255,\s*255/, 'hover glows cyan (#00ffff)');
  assert.match(CSS, /\.hxcard__desc\s*\{[^}]*background:\s*linear-gradient\([^}]*rgba\(2,\s*8,\s*11/, 'the description sits on a dark mask');
  assert.match(CSS, /\.hxcard__name\s*\{[^}]*font-size:\s*calc\(\.3 \* var\(--t\)\)/, 'the name got bigger');
  assert.match(CSS, /\.hxcard__rarity\s*\{[^}]*clip-path:\s*polygon\(/, 'the tier label is a slanted tech tag');
});

test('selection (armed) and confirm animations are wired', () => {
  // 未选中的卡：迅速褪色（饱和度降到 20%）/ 透明 30% / 后退到 0.95
  assert.match(CSS, /\.hxov\.has-armed \.hxcard\.is-tappable:not\(\.is-armed\)\s*\{[^}]*saturate\(\.2\)[^}]*opacity:\s*\.3[^}]*scale\(\.95\)/, 'non-selected cards fade and recede');
  // 选中瞬间：点阵由中心向外亮起的波
  assert.ok(CSS.includes('.hxcard.has-tier .hxcard__dotwave'), 'the dot-wave layer is styled');
  assert.ok(CSS.includes('.hxcard__dotring'), 'the wave front ring is a sibling layer (not clipped by the wave)');
  assert.ok(JS.includes('hxcard__dotring'), 'the card renders the wave front ring');
  assert.match(CSS, /\.hxcard\.has-tier\.is-armed \.hxcard__dotwave\s*\{[^}]*animation:\s*hx-dotwave/, 'the wave runs when armed');
  assert.match(CSS, /@keyframes hx-dotwave/, 'the wave keyframes exist');
  // 确认：数据流 + 吸入 + 震屏
  assert.ok(CSS.includes('.hxcard__glitch'), 'the data-stream layer is styled');
  assert.match(CSS, /\.hxcard\.is-vanishing\s*\{[^}]*animation:\s*hx-suck/, 'the card is sucked away');
  assert.match(CSS, /\.hxov\.is-vanishing\s*\{[^}]*animation:\s*hx-shake/, 'the overlay shakes');
  // 组件：两层都存在，确认要等动画放完才发请求
  assert.ok(JS.includes('hxcard__dotwave') && JS.includes('hxcard__glitch'), 'the card carries both layers');
  assert.ok(JS.includes('CONFIRM_ANIM_MS') && JS.includes('setVanishing'), 'the confirm waits for the animation');
  // 减少动态时这些动画也要停
  assert.match(CSS, /@media \(prefers-reduced-motion: reduce\)\s*\{[^}]*\.hxcard\.is-vanishing/, 'reduced motion stops them');
});

test('global: ambient particles, scanline, HUD header line, flow border, reduced motion', () => {
  for (const sel of ['.hxov__ambient {', '.hxov__ambient::before', '.hxov__ambient::after', '.hx-glitch::before', '.hx-glitch::after', '.hxov__reroll::before']) {
    assert.ok(CSS.includes(sel), sel + ' exists');
  }
  assert.match(CSS, /\.hxov \.spov__head\s*\{[^}]*border-bottom/, 'the header gets the HUD rule');
  assert.match(CSS, /@property --hx-angle/, 'the flow border animates its conic angle');
  assert.match(CSS, /@media \(prefers-reduced-motion: reduce\)\s*\{[^}]*\.hxov__ambient::before/, 'the animations stop for reduced motion');
  // the repo-wide CSS constraints still hold (test/client-static.test.js also guards them)
  assert.ok(!CSS.includes(':has('), 'no :has()');
  assert.ok(!CSS.includes('@layer'), 'no @layer');
});
