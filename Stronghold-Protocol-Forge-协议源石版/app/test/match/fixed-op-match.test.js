// test/match/fixed-op-match.test.js — 娅娜 (char_9002_yana, tools/custom-ops.mjs FIXED_CHESS) end to end through the
// MATCH engine, as a 固定 (fixed) operator: she is an ordinary chess of the SHARED shop pool, not a 自选 slot, so the
// production path is the shared pool → a shop slot → ps.buy(slot) (`g.buy`) → the piece → the board → the battle spec.
//
// The unit half of the proof is test/content/chess_char_3_22-yana.test.js; this file proves the production path and the
// one rule a 固定 operator shares with a 自选 original operator: a chess whose every bond the match drew disabled is
// withheld from the pool (DESIGN §18). 娅娜's only bond is 精准 (preciShip), so seeds that draw it disabled leave her out
// — asserted below.
//
// Seeds: 8 keeps 精准 active (she is offered); 3 draws it disabled (she is withheld).
// Run: node --test test/match/fixed-op-match.test.js

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { hasGeneratedData } from '../../server/sim/simdata.js';
import { buildBattleSpec, createBattleFromSpec } from '../../server/sim/spec.js';
import { SharedPool } from '../../server/match/pool.js';
import { GameData } from '../../server/match/gamedata.js';
import { FIXED_CHESS_IDS, FIXED_OP_IDS } from '../../tools/custom-ops.mjs';
import { DATA, makeMatch, legalTileFor } from './harness.js';

const REAL = { skip: !hasGeneratedData() };
const A = FIXED_CHESS_IDS.find((id) => !/_b$/.test(id));
const B = FIXED_CHESS_IDS.find((id) => /_b$/.test(id));
const YANA = FIXED_OP_IDS[0];
const ACTIVE_SEED = 8;   // 精准 (preciShip) stays active
const BANNED_SEED = 3;   // 精准 is drawn disabled
/** The tier she is sold at (her shop level). */
const TIER = DATA.chess[A].tier;

/** A match whose shop can reach her tier, with the level set and funds provided. */
function shoppableMatch(seed = ACTIVE_SEED) {
  const h = makeMatch({ mode: 'coop', difficulty: 'NORMAL', humans: 1, bots: 1, seed }).start();
  h.toPrep(1);
  const ps = h.ps('p_0');
  ps.addFunds(600);
  ps.shop.level = TIER;
  return { h, ps };
}
/** Roll the shop until one of her copies is offered; returns the slot index (-1 when the pool has none left). */
function findSlot(ps) {
  for (let i = 0; i < 600; i++) {
    const slot = ps.shop.slots.findIndex((s) => s.kind === 'chess' && s.id === A && !s.sold);
    if (slot >= 0) return slot;
    ps.rollShop();
  }
  return -1;
}
const pieces = (ps) => [...ps.hand.filter(Boolean), ...ps.board.values()];

test('the shared pool offers her at her tier, and only in her normal form', REAL, () => {
  const gd = new GameData(DATA, 'mode_multi_normal');
  const pool = new SharedPool(gd, { banned: [] });
  const e = pool.entries.get(A);
  assert.ok(e, 'the fixed operator is in the shared pool');
  assert.equal(e.tier, TIER);
  assert.equal(e.cap, { 1: 12, 2: 14, 3: 18, 4: 16, 5: 8, 6: 5 }[TIER], 'the tier cap');
  assert.ok(!pool.entries.has(B), 'the elite form is never a pool entry');
  // her bonds come from the row, and the upgrade is the generic 3-copy merge
  assert.deepEqual(DATA.chess[A].bonds, ['preciShip']);
  assert.equal(DATA.chess[A].upgradeChessId, B);
  assert.equal(DATA.chess[A].upgradeNum, 3);
  assert.equal(DATA.chess[A].chessType, 'PRESET', 'a 固定 operator is a 特许 chess');
});

test('a bond the match drew disabled withholds her: 精准 banned ⇒ she is not in the pool (the documented rule)', REAL, () => {
  const h = makeMatch({ mode: 'coop', difficulty: 'NORMAL', humans: 1, bots: 1, seed: BANNED_SEED }).start();
  assert.ok(h.m.disabledBonds.includes('preciShip'), `seed ${BANNED_SEED} draws 精准 disabled`);
  assert.ok(h.m.bannedChess.includes(A), 'and she is banned with it');
  assert.ok(!h.m.pool.has(A), 'so the pool does not offer her');
  h.invariants();
  h.m.dispose();
});

test('the shop sells her from the shared pool: g.buy takes one copy and the stock drops', REAL, () => {
  const { h, ps } = shoppableMatch();
  assert.ok(h.m.pool.has(A), `seed ${ACTIVE_SEED} keeps 精准 active`);
  const slot = findSlot(ps);
  assert.ok(slot >= 0, 'the shop offers her once its level reaches her tier');
  const before = h.m.pool.left(A);
  assert.deepEqual(ps.buy(slot), { ok: true }, 'ps.buy(slot) (what g.buy calls) succeeds');
  assert.ok(pieces(ps).some((x) => x.id === A), 'the bought piece is hers');
  assert.equal(h.m.pool.left(A), before - 1, 'the shared stock dropped by one');
  h.invariants();
  h.m.dispose();
});

test('three copies merge into her elite form (the generic 三连合成 rule)', REAL, () => {
  const { h, ps } = shoppableMatch();
  let elite = null;
  for (let i = 0; i < 6000 && !elite; i++) {
    const slot = findSlot(ps);
    if (slot < 0) break;
    ps.buy(slot);
    elite = pieces(ps).find((x) => x.id === B);
  }
  assert.ok(elite, 'three bought copies merge into the elite');
  assert.equal(elite.id, B);
  assert.ok(!pieces(ps).some((x) => x.id === A || x.id === B && x.uid !== elite.uid), 'the copies are consumed');
  assert.equal(DATA.chess[B].upgradeChessId, null, 'the elite is the end of the chain');
  h.invariants();
  h.m.dispose();
});

test('seated on the board she reaches the battle spec as a real 炮手 unit with her kit', REAL, () => {
  const { h, ps } = shoppableMatch();
  const slot = findSlot(ps);
  assert.ok(slot >= 0, 'she is in the shop');
  ps.buy(slot);
  const piece = ps.hand.find((x) => x && x.id === A);
  assert.ok(piece, 'the bought piece is in hand');
  const [tr, tc] = legalTileFor(h.m, ps, A);
  // the production placement path (what `g.move` calls): the piece moves hand → board and leaves the hand
  assert.deepEqual(ps.move(piece.uid, { area: 'board', row: tr, col: tc }, 'RIGHT'), { ok: true }, 'she is seated on the board');
  assert.ok([...ps.board.values()].some((x) => x && x.id === A), 'the board holds her');
  assert.ok(!ps.hand.includes(piece), 'and she left the hand (no duplicate uid)');
  // the production battle spec (what the match hands the sim / the client)
  const spec = buildBattleSpec(h.m._normalOpts(ps));
  const units = (spec.players || []).flatMap((p) => p.units || []);
  const su = units.find((u) => u.chessId === A);
  assert.ok(su, 'her unit is in the spec');
  assert.deepEqual([su.row, su.col], [tr, tc], 'on the tile she was seated at');
  const b = createBattleFromSpec(spec, h.m.ds, { quiet: true, recordEvents: false });
  const u = (b.units || []).find((x) => x.def?.charId === YANA);
  assert.ok(u, 'she is fielded as a unit');
  assert.equal(u.def.profession, 'SNIPER', 'a 狙击/Sniper');
  assert.ok(u.profile.splashRadius > 0, 'the 炮手 群体 splash');
  assert.ok(u.kit && !u.kit.generic, 'her hand-authored kit is installed');
  assert.equal(u.rangeGrid.length, 15, 'her 3-10 range (15 tiles)');
  h.invariants();
  h.m.dispose();
});
