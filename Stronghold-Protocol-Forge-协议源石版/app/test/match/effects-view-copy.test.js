// 业主 2026-10-24「UI 上多个该合并成一行显示『名字 × 几』」：同一张卡的第二个 ref 不该在效果栏里占两行。
//
// 2026-10-25 起策略「管理员」不再在获得时复制（改成第一回合多选一次海克斯，见 test/match/admin-extra-pick.test.js），
// 所以这条用例直接走**复制的那条缝**：`applyBandHexCopy`（卡池 / 工坊包仍会调它）+ 自己把 band 的 `band_hex_copy_once`
// 装上去。它钉的是 `effectsView` 的合并规则本身，不是策略。
import test from 'node:test';
import assert from 'node:assert/strict';
import { makeMatch } from './harness.js';
import { applyHex, applyBandHexCopy } from '../../server/match/hextech.js';

/** Arm 策略「管理员」's copy buff on this player's band for one copy (the seam's own switch). */
const armCopyBuff = (m, ps) => {
  const real = m.gd.band(ps.bandId);
  m.gd.band = (id) => (id === ps.bandId
    ? { ...(real || {}), bandId: ps.bandId, buffs: [{ key: 'band_hex_copy_once', bb: { count: 1 }, bbStr: {} }] }
    : real);
};

test('a copied card is ONE row in the effects column, with ×2', () => {
  const h = makeMatch({ mode: 'solo', difficulty: 'FUNNY', seed: 81, fake: true }).start();
  h.toPrep(1);
  const ps = h.ps('p_0');
  armCopyBuff(h.m, ps);
  applyHex(h.m, ps, h.m.gd.hex('hex_overdrive'));
  applyBandHexCopy(h.m, ps, h.m.gd.hex('hex_overdrive'));
  // two refs on the player…
  assert.equal(ps.effects.filter((e) => e.key === 'hex:hex_overdrive').length, 2, 'premise: the copy is a second ref');
  // …but ONE row in the effects column, carrying the count
  const rows = ps.effectsView().filter((e) => e.iconKind === 'hex' && e.name === '超载协议');
  assert.equal(rows.length, 1, `one row (got ${rows.length})`);
  assert.equal(rows[0].count, 2, 'and it says ×2');
  // a card the player owns once keeps count undefined (the client then draws no ×n)
  applyHex(h.m, ps, h.m.gd.hex('hex_armor'));
  const armor = ps.effectsView().filter((e) => e.iconKind === 'hex' && e.name === '反击装甲');
  assert.equal(armor.length, 1);
  assert.equal(armor[0].count, undefined, 'a single copy has no ×n');
  h.invariants();
  h.m.dispose();
});
