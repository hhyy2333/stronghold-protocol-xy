// 业主 2026-10-24「UI 上多个该合并成一行显示『名字 × 几』」：管理员复制出来的第二份 ref 不该在效果栏里占两行。
import test from 'node:test';
import assert from 'node:assert/strict';
import { makeMatch } from './harness.js';
import { applyHex } from '../../server/match/hextech.js';

test('管理员 copy: effectsView merges the duplicate into one row with count 2', () => {
  const h = makeMatch({ mode: 'solo', difficulty: 'FUNNY', seed: 81, fake: true }).start();
  h.toPrep(1);
  const ps = h.ps('p_0');
  ps.bandId = 'band_admin';
  applyHex(h.m, ps, h.m.gd.hex('hex_overdrive'));
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
