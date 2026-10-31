// 上游 0.3.2 的两条修复（业主 2026-10-30「这些修bug的我要」）：
//   §37.30 / PR #798  固定穿透先减、百分比穿透后乘（PRTS 伤害公式）。
//   §37.5  / round49  重入式 buff 移除：onRemove 里再移除别的 buff 时按索引倒序走会读到 undefined。
// 这两条都是"改动前红、改动后绿"的回归钉子。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mitigate } from '../../server/sim/damage.js';
import { Battle } from '../../server/sim/Battle.js';

/** Percentages are exact enough here, but 1000 × (1 − 80/100) lands one ulp off 200. */
const close = (actual, expected) => assert.ok(Math.abs(actual - expected) < 1e-9, `${actual} ≈ ${expected}`);

test('mitigate: physical DEF subtracts fixed penetration before percentage penetration (PRTS, §37.30)', () => {
  // D 300, fixed 175, pct 30% ⇒ (300 − 175) × 0.7 = 87.5 effective DEF.
  // The old order gave Math.max(0, 300 × 0.7 − 175) = 35 ⇒ 52.5 less effective DEF ⇒ 52.5 less damage.
  assert.equal(mitigate(1000, 'phys', { def: 300 }, { defIgnoreFlat: 175, defIgnorePct: 0.3 }), 912.5);
  // Fixed alone and percentage alone must not move (they never depended on the order).
  assert.equal(mitigate(1000, 'phys', { def: 300 }, { defIgnoreFlat: 175 }), 875);
  assert.equal(mitigate(1000, 'phys', { def: 300 }, { defIgnorePct: 0.3 }), 790);
  // A fixed penetration larger than DEF floors at 0 rather than going negative.
  assert.equal(mitigate(1000, 'phys', { def: 100 }, { defIgnoreFlat: 175, defIgnorePct: 0.5 }), 1000);
});

test('mitigate: arts RES follows the same order, and elemental damage is untouched', () => {
  // R 100, fixed 20, pct 50% ⇒ (100 − 20) × 0.5 = 40 RES ⇒ 60% of the damage.
  assert.equal(mitigate(1000, 'arts', { res: 100 }, { resIgnoreFlat: 20, resIgnorePct: 0.5 }), 600);
  close(mitigate(1000, 'arts', { res: 100 }, { resIgnoreFlat: 20 }), 200); // 80 RES left ⇒ 20% gets through
  close(mitigate(1000, 'arts', { res: 100 }, { resIgnorePct: 0.5 }), 500);
  close(mitigate(1000, 'elemental', {}, { elementalRes: 25 }), 750);
});

/** A unit-shaped object: removeBuff only needs `buffs` and `markDirty`. */
function fakeUnit(buffs) {
  return { id: 'u1', buffs, markDirty() {} };
}

/**
 * A `this` for Battle.prototype.removeBuff: the prototype chain so _removeBuffAt is there, with events silenced and
 * guarded callbacks run for real (that is what re-enters).
 */
const fakeBattle = Object.create(Battle.prototype);
fakeBattle._ev = () => {};
fakeBattle._safe = (fn) => { fn(); };

test('removeBuff: a re-entrant onRemove may remove other buffs without crashing or skipping (§37.5)', () => {
  const removed = [];
  const mk = (name, onRemove) => ({ key: 'k', name, onRemove });
  // C's onRemove removes A and B — under the old backwards-by-index loop the next read was `undefined.key`.
  const C = mk('C', ({ unit }) => { removed.push('C'); unit.buffs.length = 0; });
  const A = mk('A', () => { removed.push('A'); });
  const B = mk('B', () => { removed.push('B'); });
  const unit = fakeUnit([A, B, C]);
  const n = Battle.prototype.removeBuff.call(fakeBattle, unit, 'k');
  assert.equal(n, 1, 'only the buff it removed itself counts');
  assert.deepEqual(removed, ['C']);
  assert.deepEqual(unit.buffs, []);
});

test('removeBuff: every matching buff goes, survivors stay, and callbacks wait for their own turn (§37.5)', () => {
  const removed = [];
  const mk = (key, name) => ({ key, name, onRemove: () => removed.push(name) });
  const A = mk('k', 'A');
  const B = mk('other', 'B');
  const C = mk('k', 'C');
  const unit = fakeUnit([A, B, C]);
  const n = Battle.prototype.removeBuff.call(fakeBattle, unit, 'k');
  assert.equal(n, 2);
  assert.deepEqual(removed.sort(), ['A', 'C']);
  assert.deepEqual(unit.buffs, [B]);
  // Removing by object identity works the same way.
  assert.equal(Battle.prototype.removeBuff.call(fakeBattle, unit, unit.buffs[0]), 1);
  assert.deepEqual(unit.buffs, []);
});
