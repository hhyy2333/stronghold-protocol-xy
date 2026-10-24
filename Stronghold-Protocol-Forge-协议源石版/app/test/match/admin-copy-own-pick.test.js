// 业主 2026-10-24「管理员会优先获得队友选的全队增益，应该改一下优先获得自己选的」：
// 队友选「全队」卡时，管理员不该把「限一次」花掉；要留着给玩家自己选的那张。
import test from 'node:test';
import assert from 'node:assert/strict';
import { makeMatch } from './harness.js';
import { applyHex } from '../../server/match/hextech.js';

/** The 管理员 player and a teammate, both past the first draft. */
function twoPlayers(seed) {
  const h = makeMatch({ mode: 'coop', humans: 2, bots: 0, difficulty: 'FUNNY', seed, fake: true }).start();
  h.toPrep(1);
  const me = h.ps('p_0');
  const mate = h.ps('p_1');
  me.bandId = 'band_admin';
  return { h, me, mate };
}

// count by REF ID: a 管理员 copy keeps the card's `key` and only its `id` gains the `#2` suffix
const refsOf = (ps, id) => ps.effects.filter((e) => e && e.id === id).length;

test('管理员: a teammate\'s 全队 hex does NOT spend the copy', () => {
  const { h, me, mate } = twoPlayers(101);
  // 战争机器 is a 全队 card (`effect.team: true`): it reaches every teammate
  applyHex(h.m, mate, h.m.gd.hex('hex_warmachine'));
  assert.equal(refsOf(me, 'hex:hex_warmachine'), 1, 'premise: the team card did reach me');
  assert.equal(refsOf(me, 'hex:hex_warmachine#2'), 0, 'and it was NOT copied for me');
  assert.equal(me.counters['band_hex_copy:used'], undefined, 'the once-per-match copy is still unspent');

  // my own pick then pays it
  applyHex(h.m, me, h.m.gd.hex('hex_armor'));
  assert.equal(refsOf(me, 'hex:hex_armor#2'), 1, 'my own pick got the copy');
  assert.equal(me.counters['band_hex_copy:used'], 1, 'and the copy is now spent');
  h.invariants();
  h.m.dispose();
});

test('管理员: my own 全队 hex does copy (the picker is me)', () => {
  const { h, me } = twoPlayers(102);
  applyHex(h.m, me, h.m.gd.hex('hex_warmachine'));
  assert.equal(refsOf(me, 'hex:hex_warmachine#2'), 1, 'the card I picked is copied for me');
  h.invariants();
  h.m.dispose();
});

test('管理员: 无私奉献\'s gift to a teammate does not spend that teammate\'s copy', () => {
  const { h, me, mate } = twoPlayers(103);
  mate.bandId = 'band_admin';                       // the receiving teammate also runs 管理员
  applyHex(h.m, me, h.m.gd.hex('hex_selfless'));    // 无私奉献: every OTHER teammate gains a random card
  const spare = mate.effects.filter((e) => e && e.key === 'hex:hex_selfless');
  assert.equal(spare.length, 0, 'premise: 无私奉献 is the picker\'s card, not the mate\'s');
  assert.equal(mate.counters['band_hex_copy:used'], undefined, 'the gift did not spend the mate\'s copy');
  h.invariants();
  h.m.dispose();
});
