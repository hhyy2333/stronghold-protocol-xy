// 管理员 — 业主 2026-10-25「管理员策略改成第一回合多选择一次海克斯」。
//
// This file used to pin the OLD mechanic (「当你获得协议源石时，复制一个。限一次。」): which gain spent the copy, and
// whose. That mechanic is REPLACED — 管理员 now gives its owner one extra three-card 海克斯 pick in round 1
// (server/match/match/hexDraft.js, buff `band_hex_extra_pick_r1`; see test/match/admin-extra-pick.test.js).
//
// What still matters here is the half that must NOT come back: gaining a 协议源石 no longer duplicates it, for anyone,
// whether the card was picked by you, handed to you by a 全队 card, or gifted by 无私奉献.
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

// count by REF ID: a copy would keep the card's `key` and only its `id` gains the `#2` suffix
const refsOf = (ps, id) => ps.effects.filter((e) => e && e.id === id).length;

test('管理员: gaining a 协议源石 no longer duplicates it (the old mechanic is gone)', () => {
  const { h, me } = twoPlayers(101);
  applyHex(h.m, me, h.m.gd.hex('hex_armor'));
  assert.equal(refsOf(me, 'hex:hex_armor'), 1, 'the card is owned once');
  assert.equal(refsOf(me, 'hex:hex_armor#2'), 0, 'and it is NOT copied');
  assert.equal(me.counters['band_hex_copy:used'], undefined, 'the old once-per-match counter is never written');
  h.invariants();
  h.m.dispose();
});

test('管理员: a teammate’s 全队 hex reaches me once and is not duplicated either', () => {
  const { h, me, mate } = twoPlayers(102);
  // 战争机器 is a 全队 card (`effect.team: true`): it reaches every teammate
  applyHex(h.m, mate, h.m.gd.hex('hex_warmachine'));
  assert.equal(refsOf(me, 'hex:hex_warmachine'), 1, 'the team card did reach me');
  assert.equal(refsOf(me, 'hex:hex_warmachine#2'), 0, 'and was not duplicated');
  h.invariants();
  h.m.dispose();
});

test('管理员: 无私奉献’s gift is not duplicated for the receiver', () => {
  const { h, me, mate } = twoPlayers(103);
  mate.bandId = 'band_admin';                       // the receiving teammate also runs 管理员
  applyHex(h.m, me, h.m.gd.hex('hex_selfless'));    // 无私奉献: every OTHER teammate gains a random card
  assert.equal(mate.counters['band_hex_copy:used'], undefined, 'no copy is spent, because no copy exists any more');
  for (const e of mate.effects) assert.ok(!String(e.id).includes('#2'), `no copy ref on the mate (saw ${e.id})`);
  h.invariants();
  h.m.dispose();
});
