// test/ui/draftCardsVisible.test.js — 机变（惊变）抽卡：**超过 6 张要全都看得见、选得到**
// （业主 2026-10-16「惊变选择时只能看到 6 个之后的人只能等时间结束随机」）。
//
// 服务端本来就按存活人数铺牌（choices.js generateDraft: max(6, 存活人数)，>6 人的房间每人一张），
// 坏的是**客户端**的两处写死的 6：
//   1. ui/gameLogic/draft.js normalizeSp 收下帧就 `.slice(0, 6)` —— 第 7 张直接丢；
//   2. css/screens/game-panels.css .spov__grid 写死 `grid-template-rows: repeat(2, 1fr)`（3×2=6 格），
//      第 7 张落进隐式第三行 —— 而 `flex:1; min-height:0` 把那行压成 0 高、overflow 裁掉。
// 两处都修掉；这份测试把「>6 张不许再被砍 / 不许再被裁」钉住。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const read = (p) => readFileSync(path.join(ROOT, p), 'utf8');
const { normalizeSp } = await import('../../public/js/ui/gameLogic/draft.js');

test('normalizeSp 不再把卡数砍到 6：7/8/12 张照单全收', () => {
  for (const n of [3, 6, 7, 8, 12]) {
    const cards = Array.from({ length: n }, (_, i) => ({ kind: 'item', id: 'i' + i, idx: i }));
    const sp = normalizeSp({ family: 'supply', cards, order: ['p_0'], turn: 'p_0', picks: {}, taken: {} });
    assert.equal(sp.cards.length, n, `${n} 张必须原样保留`);
    assert.deepEqual(sp.cards.map((c) => c.idx), Array.from({ length: n }, (_, i) => i), `${n} 张的 idx 连续`);
  }
  // 只有与 DRAFT_CARDS_MAX 同值的防御性上限（20）
  assert.equal(normalizeSp({ cards: new Array(25).fill({}) }).cards.length, 20, '超上限才截断');
});

test('第 7 张仍可被选：idx 越界校验不再把它判无效', () => {
  const cards = Array.from({ length: 7 }, (_, i) => ({ kind: 'item', id: 'i' + i, idx: i }));
  const sp = normalizeSp({ family: 'supply', cards, order: ['p_0', 'p_6'], turn: 'p_6', picks: { p_6: 6 }, taken: { 6: 'p_6' } });
  assert.equal(sp.cards.length, 7);
  assert.equal(sp.pickOf.get('p_6'), 6, '第 7 张（idx 6）的选择被认下，不是越界');
  assert.equal(sp.takenBy.get(6), 'p_6');
});

test('卡面栅格不再写死 3×2：行高由 --many 撑开、整格可滚动', () => {
  const css = read('public/css/screens/game-panels.css');
  assert.ok(!/\.spov__grid\s*\{[^}]*grid-template-rows:\s*repeat\(2, 1fr\)/.test(css),
    'the base grid must not pin exactly 2 rows (that is what clipped card 7)');
  assert.match(css, /\.spov__grid\s*\{[^}]*grid-auto-rows:/, 'row height must be automatic');
  assert.match(css, /\.spov__grid--many\s*\{[^}]*grid-auto-rows:/, '--many grows the rows for >6 cards');
  assert.match(css, /\.spov__grid\s*\{[^}]*overflow-y:\s*auto/, 'the grid scrolls instead of clipping');
});

test('>6 张时叠加 --many 类', () => {
  const js = read('public/js/ui/choiceOverlay.js');
  assert.match(js, /sp\.cards\.length > 6 && 'spov__grid--many'/, 'the overlay must add --many past 6 cards');
  assert.match(js, /sp\.cards\.length <= 3 \? 'spov__grid--3'/, 'and keep the official single-row layout for <=3');
});
