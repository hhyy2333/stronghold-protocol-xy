// test/match/equip-cap-ceiling.test.js — 装备位的「合法上界」与 100 座变体的池账本。
//
// 业主 2026-10-21 「查」：fuzz 长期红着两条，都不是对局 bug，而是**检查器把合法状态判成了损坏**：
//
//   1. 潘多拉魔盒（`hex_pandora`）把玩家所有协议源石换成随机 3 阶 —— 于是「整装待发」(+1 格) 可能在干员已经装上
//      第 3 件之后才消失。装备不会被强制卸下（`PlayerState._attach` 只在下次装备时修剪），所以「件数 > 此刻的上限」
//      是合法的；上界应该是「数据里任何一张卡能给的最高格数」，也就是 `equipCapCeiling()`。
//   2. 100 座变体（> MAX_SEATS 参与者）里副本取自每个玩家自己的池，`m.pool` 只是只读目录；harness 拿共享池对账，
//      必然报 left + held != cap。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { equipCapCeiling } from '../../server/match/hextech.js';
import { makeMatch, checkInvariants } from './harness.js';
import { PHASE } from '../../shared/constants.js';

test('equipCapCeiling: 整装待发 gives 3, the data gives 2, and the ceiling is the higher of them', () => {
  const h = makeMatch({ mode: 'coop', difficulty: 'NORMAL', humans: 1, bots: 1, seed: 7, fake: true });
  const m = h.m;
  const gd = m.gd;
  assert.equal(gd.equipPerChess, 2, 'premise: the data cap is 2');
  assert.ok(equipCapCeiling(gd) >= 3, 'the ceiling sees 整装待发 (+1 slot), got ' + equipCapCeiling(gd));
  // a player WITHOUT the card still has a live cap of 2, but a piece may legally carry up to the ceiling: that is the
  // 潘多拉魔盒 case, so the checkers must not fall back to the live cap
  const ps = h.ps('p_0');
  assert.equal(ps.equipCap(), 2, 'no 整装待发 -> live cap 2');
  assert.ok(equipCapCeiling(gd) > ps.equipCap(), 'the ceiling is strictly above a live cap without the card');
  m.dispose();
});

test('a 5-seat room (100-seat variant) checks the per-player pools, not the shared catalog', () => {
  // > MAX_SEATS participants turns the variant on: copies come from each player\'s own pool (docs/PS100-MIGRATION.md §10-A)
  const h = makeMatch({ mode: 'coop', difficulty: 'NORMAL', humans: 3, bots: 2, seed: 13, fake: true, captureFrames: false });
  const m = h.m;
  assert.equal(m.variant, true, 'premise: 5 seats is the variant');
  m.start();
  // one copy on a human's hand, taken from THAT player's own pool (the variant's one dispatch point) — the shared
  // catalog stays untouched, which is exactly the state the old harness check called corruption
  const ps = h.ps('p_0');
  const base = [...m.pool.entries.keys()].find((b) => m.pool.cap(b) > 2 && m.pool.left(b) > 0);
  assert.ok(base, 'premise: the pool has a chess with copies to take');
  const before = m.pool.left(base);
  const taken = ps.poolOf(base).take(base, 1);
  assert.equal(taken, 1, 'the copy came from the player\'s own pool');
  assert.equal(m.pool.left(base), before, 'and NOT from the shared catalog');
  const piece = ps.newPiece('chess', base, { poolCopies: taken });
  ps.hand[ps.hand.findIndex((x) => x == null)] = piece;
  ps.recompute();
  assert.doesNotThrow(() => checkInvariants(m), 'the checkers agree with the variant');
  m.dispose();
});
