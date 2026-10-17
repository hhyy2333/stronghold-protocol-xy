// test/ui/mosaic.test.js — 情报部抑制（enemy hex `ehex_mosaic`）的范围。
//
// 业主 2026-10-16：「改成只有敌人形象和机变看不清」。原来它是**全屏**的一层 `backdrop-filter` 马赛克，
// 把战场 + HUD + 机变一起糊了。现在收窄到**只糊机变浮层**（`.spov`）：
//   * 客户端不再渲染那一层，只给 `<html>` 挂 `sp-mosaic` 类（`useDocClass`，ui/device.js 的既有做法）；
//   * CSS 用 `.sp-mosaic .spov { filter: blur(…) }` 只作用于机变。
//
// 为什么不能只糊「敌人形象」：敌人画在 canvas 里（three.js / Pixi），`backdrop-filter` 是 DOM 的，
// 只能作用于某元素下方的整块区域 —— 要糊敌人就得连自己的干员和地形一起糊。所以能精确命中的只有机变。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { MOSAIC_CLASS, MOSAIC_HEX_ID, mosaicActive } from '../../public/js/ui/mosaic.js';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const read = (rel) => readFileSync(path.join(ROOT, rel), 'utf8');

test('mosaicActive：当前 public 视图的敌方列表里有 ehex_mosaic 时才算开着', () => {
  const st = (enemyHexes) => ({ match: { public: { enemyHexes } } });
  assert.equal(mosaicActive(st([{ id: MOSAIC_HEX_ID }])), true);
  assert.equal(mosaicActive(st([{ id: 'ehex_fang' }, { id: MOSAIC_HEX_ID }])), true, '混在别的卡里也算');
  assert.equal(mosaicActive(st([{ id: 'ehex_fang' }])), false);
  assert.equal(mosaicActive(st([])), false);
  assert.equal(mosaicActive(st(undefined)), false);
  assert.equal(mosaicActive({}), false);
  assert.equal(mosaicActive(null), false);
});

test('范围：客户端只挂类，不再渲染全屏那一层', () => {
  const src = read('public/js/ui/mosaic.js');
  assert.match(src, /export const MOSAIC_CLASS = 'sp-mosaic'/, '类名导出');
  assert.match(src, /useDocClass\(MOSAIC_CLASS, on\)/, '用 useDocClass 挂/摘类');
  assert.doesNotMatch(src, /mosaic-layer/, '不再渲染那层元素');
  // 代码里不再有滤镜（注释里解释历史时会提到那个词，所以只看「非注释行」）
  const code = src.split('\n').filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l)).join('\n');
  assert.doesNotMatch(code, /backdrop-filter/, '客户端不再自带滤镜');
  assert.doesNotMatch(code, /filter:/, '客户端不再自带滤镜');
  // 组件不渲染任何东西：坏掉的引用会在运行时抛，返回 null 才是「零成本」
  assert.match(src, /export function MosaicOverlay\(\) \{[^}]*return null;/s);
});

test('范围：CSS 只作用于机变浮层（.spov），不再有全屏层', () => {
  const css = read('public/css/theme.css');
  assert.doesNotMatch(css, /\.mosaic-layer/, '旧的 .mosaic-layer 已删除');
  assert.match(css, /\.sp-mosaic \.spov:not\(\.hxov\) \{/, '模糊挂在机变那一个 .spov 上（排除协议源石）');
  // 那条规则里要有 filter（而不是 backdrop-filter：后者是「下方的画面」，前者才是元素自己）
  const rule = /\.sp-mosaic \.spov:not\(\.hxov\) \{([^}]*)\}/.exec(css);
  assert.ok(rule, '找得到那条规则');
  assert.match(rule[1], /filter: blur\(/, '用 filter: blur() 糊机变自己');
  assert.doesNotMatch(rule[1], /backdrop-filter/, '不是 backdrop-filter（那会糊到画面）');
  // 范围不能溢出到战场/HUD：这条规则的选择器里只能出现 .sp-mosaic 与 .spov
  assert.doesNotMatch(css, /\.sp-mosaic \.(gm__|app-root|spov__veil)/, '没有作用到战场 / HUD / 机变的遮罩');
});

test('范围：底盘与全屏层相关的 z-index 55 不再被描述', () => {
  const css = read('public/css/theme.css');
  assert.doesNotMatch(css, /z-index: 55/, '全屏层的 z-index 描述已随实现移除');
});

test('.spov 是共用外壳：机变用它，协议源石也用它 —— 所以 CSS 必须排除协议源石', () => {
  // choiceOverlay（机变 / 教鞭）的根类就是 spov；hexOverlay（协议源石抽取）是 spov + hxov。
  assert.match(read('public/js/ui/choiceOverlay.js'), /cx\('spov'/, '机变用 .spov');
  assert.match(read('public/js/ui/hexOverlay.js'), /cx\('spov', 'hxov'/, '协议源石用 .spov.hxov');
  // 业主要的是「机变」，所以选择器要把它排除掉
  const css = read('public/css/theme.css');
  assert.match(css, /\.sp-mosaic \.spov:not\(\.hxov\)/, '只糊不带 hxov 的那一个（= 机变）');
  // 别的浮层完全不该被命中
  for (const f of ['public/js/ui/detailPanel.js']) {
    assert.doesNotMatch(read(f), /['"]spov['"]/, `${f} 不使用 .spov`);
  }
});
