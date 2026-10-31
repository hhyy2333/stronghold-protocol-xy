// shared/chessPrice.js — the ONE price rule behind a shop chess.
//
// It exists because two ends must agree on the same number: the server charges it (`GameData.chessPrice`, the authority
// for every purchase) and the 测试场's 干员 picker shows it before the tap (业主 2026-10-26「在测试场增加功能可以购买任何干员」;
// public/js/ui/testArena.js). The picker has no channel to ask the server — no per-operator price rides `m.public` — so
// the rule is a shared module rather than a second implementation. This suite pins the ORDER (mode override → the
// record's own price → the economy table → the tier default) and that `GameData.chessPrice` really delegates to it.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chessPriceOf, TIER_CHESS_PRICE } from '../shared/chessPrice.js';
import { GameData, DEFAULTS } from '../server/match/gamedata.js';
import { getData } from '../server/data.js';

const DATA = getData({ log: { warn() {}, error() {}, info() {} } });

test('the order of the rule: mode override → the record price → the economy table → the tier default', () => {
  // 1. a mode's own economy.chessPrice wins over everything else
  assert.equal(chessPriceOf({ tier: 3, price: 9 }, 3, { chessPrice: { 3: { normal: 5 } } }, { chessPrice: { 3: { normal: 7 } } }), 5);
  // 2. the record's own `price` (what data/chess.json carries today) beats the table
  assert.equal(chessPriceOf({ tier: 3, price: 9 }, 3, null, { chessPrice: { 3: { normal: 7 } } }), 9);
  // 3. the economy table's object form, then 4. the per-tier default
  assert.equal(chessPriceOf({ tier: 3 }, 3, null, { chessPrice: { 3: { normal: 7 } } }), 7);
  assert.equal(chessPriceOf({ tier: 6 }, 6, null, null), 4);
  // an unknown id: the tier the caller computed (GameData.tierOf → 1) still answers from the table
  assert.equal(chessPriceOf(null, 1, null, { chessPrice: { 1: { normal: 2, golden: 2 } } }), 2);
  // an elite record reads the golden column
  assert.equal(chessPriceOf({ tier: 3, isGolden: true }, 3, null, { chessPrice: { 3: { normal: 3, golden: 5 } } }), 5);
  // a numeric row is NOT a price table (the engine has always ignored it): the default answers
  assert.equal(chessPriceOf({ tier: 3 }, 3, null, { chessPrice: { 3: 6 } }), 3);
  // the tier falls back to the record's own when the caller has none, and out-of-table tiers answer 3
  assert.equal(chessPriceOf({ tier: 2 }, undefined, null, null), 3);
  assert.equal(chessPriceOf({ tier: 9 }, 9, null, null), 3);
  // the default table is the engine's own frozen one (one table, not two)
  assert.equal(DEFAULTS.chessPrice, TIER_CHESS_PRICE);
});

test('GameData.chessPrice is this rule: every shipped chess of every mode prices as its record says', () => {
  const modes = Object.keys(DATA.config.modes);
  assert.ok(modes.length >= 4, `premise: the shipped modes (${modes.length})`);
  for (const modeId of modes) {
    const gd = new GameData(DATA, modeId);
    for (const id of Object.keys(DATA.chess)) {
      const rec = DATA.chess[id];
      assert.equal(gd.chessPrice(id), chessPriceOf(rec, gd.tierOf(id), gd.mode.economy, gd.economy), `${modeId} ${id}`);
      // today every record carries its own `price`, so the delegation is checkable against the data alone
      if (Number.isFinite(rec.price)) assert.equal(gd.chessPrice(id), rec.price, `${modeId} ${id}`);
    }
    // an id no data knows: the tier-1 table value (2), exactly as before the extraction
    assert.equal(gd.chessPrice('chess_nope'), 2, modeId);
  }
});
