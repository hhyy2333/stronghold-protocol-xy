// 上游 Forge 0.3.1 §36.22 / GitHub #677 —— 凯瑟琳【定向投放】的突变细胞每玩家每局只给一次：
// 拿到过之后，这个策略之后的抽卡把细胞排除掉，其余选项数量不缩水（上游 review 修的第二个 bug），排队的同源 offer
// 也只去掉这一格；计数走 match-long 座位计数器 band:cathy:cellTaken。
// [ASSUMED] 只有「真的拿到」才计数（展示 / 放弃不算），昆图斯自己的给料不走这个额度。
//
// 我方原状：每次升级重抽，全域 grep cellTaken = 0 命中。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRegistry } from '../../server/match/effectsMeta.js';
import { DATA, makeMatch } from '../match/harness.js';

const QUIET = { warn() {}, error() {}, info() {} };
const REG = createRegistry({ log: QUIET });
const CELL = 'chess_item_5_08_e_a';
const CELL_EFFECT = 'eff_acarm072';
const TAKEN = 'band:cathy:cellTaken';
/** Ordinary shop items of the same pool (no cell, not shop-excluded) — the offer's other choices. */
const FILLER = Object.keys(DATA.items).filter((id) => !DATA.items[id].shopExcluded && !DATA.items[id].isGolden && id !== CELL).slice(0, 4);

function cathyMatch(seed = 9) {
  const h = makeMatch({ mode: 'solo', humans: 1, seed, registry: REG, fake: true }).start();
  h.toPrep(1);
  const m = h.m;
  const ps = h.ps('p_0');
  ps.bandId = 'band_cathy';
  ps.shop.level = 1;
  ps.shop.upgradePrice = 0;
  ps.recompute();
  // the pool draw is stubbed (the real one is rng-dependent): each level-up consumes this list, then falls back
  let seq = [];
  const orig = m.rollItemId.bind(m);
  m.rollItemId = (o = {}) => (seq.length ? seq.shift() : orig(o));
  const levelUp = (items) => { seq = items.slice(); ps.offers.length = 0; ps.shop.upgradePrice = 0; m.handle('p_0', { t: 'g.levelUp' }); };
  return { h, m, ps, levelUp };
}

test('#677 突变细胞的数据行：一个普通记录 + 它的精锐记录，都挂在同一个官方效果上', () => {
  assert.equal(DATA.items[CELL].effectId, CELL_EFFECT);
  assert.equal(DATA.items[CELL].shopExcluded, true, 'never sold in the shop slot — only a pool hands it out');
});

test('#677 拿到之后：计数器置位，之后这个策略的 offer 不再出现细胞，但仍是 3 件', () => {
  const { m, ps, levelUp } = cathyMatch();
  levelUp([CELL, FILLER[0], FILLER[1]]);
  const first = ps.offers[0];
  assert.ok(first, 'a level-up offers items');
  assert.deepEqual(first.slots.map((s) => s.id), [CELL, FILLER[0], FILLER[1]]);
  assert.equal(first.source, 'band:band_cathy', 'the offer carries the strategy, which is what spends the allowance');
  assert.equal(ps.counters[TAKEN] || 0, 0, 'showing the cell spends nothing');
  assert.equal(m.handle('p_0', { t: 'g.reward', idx: 0 }).ok, true);
  assert.equal(ps.counters[TAKEN], 1, 'taking it marks the match-long allowance');
  // next level-up: the cell is excluded AT DRAW TIME, so the other slots still fill up (3 items, none of them the cell)
  levelUp([CELL, FILLER[0], FILLER[1], FILLER[2]]);
  const second = ps.offers[0];
  assert.ok(second, 'the offer is not swallowed');
  const ids = second.slots.map((s) => s.id);
  assert.equal(ids.length, 3, 'the other choices do not shrink');
  assert.ok(!ids.includes(CELL), 'the cell never comes back');
  // … and it stays gone for every later level
  for (let k = 0; k < 3; k++) {
    levelUp([CELL, FILLER[0], FILLER[1], FILLER[2]]);
    assert.ok(!ps.offers[0].slots.map((s) => s.id).includes(CELL), 'level ' + ps.shop.level);
  }
});

test('#677 只有这个策略的 offer 花额度：别的来源拿到细胞不计数', () => {
  const { m, ps } = cathyMatch();
  ps.offers.length = 0;
  ps.pushItemOffer([CELL, FILLER[0]], { source: 'band', tier: null, label: null });
  assert.equal(m.handle('p_0', { t: 'g.reward', idx: 0 }).ok, true);
  assert.ok(ps.hand.some((p) => p && p.id === CELL) || ps.temp.some((p) => p && p.id === CELL), 'the cell is in hand');
  assert.equal(ps.counters[TAKEN] || 0, 0, 'another source does not spend the allowance');
});

test('#677 排队的同源 offer 只去掉那一格（其余选项保留，不重抽）', () => {
  const { m, ps } = cathyMatch();
  ps.offers.length = 0;
  ps.pushItemOffer([CELL, FILLER[0], FILLER[1]], { source: 'band:band_cathy', tier: null, label: null });
  ps.pushItemOffer([CELL, FILLER[2]], { source: 'band:band_cathy', tier: null, label: null });
  assert.equal(m.handle('p_0', { t: 'g.reward', idx: 0 }).ok, true);
  assert.equal(ps.counters[TAKEN], 1);
  assert.deepEqual(ps.offers.map((o) => o.slots.map((s) => s.id)), [[FILLER[2]]], 'the queued Cathy offer loses the cell, keeps the rest');
});
