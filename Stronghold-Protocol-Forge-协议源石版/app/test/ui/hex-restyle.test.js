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
