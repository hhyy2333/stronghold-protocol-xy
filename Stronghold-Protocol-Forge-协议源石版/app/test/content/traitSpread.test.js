// 特质扩散 (hex_traitspread, 业主 2026-10-18): at battle start the owner's leftmost-bottom operator copies its
// IN_BATTLE traits to the NEAREST own operator, right side preferred; the target keeps its own traits (additive).
// Owner's clarifications: with nobody on the right, keep looking left / up / down; the copy never replaces the
// target's own traits. The description says exactly 「复制给最近的干员（优先右边）」 — the fallback and stacking
// details are NOT part of the card text.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { makeBattle, chessRec, enemyRec } from '../helpers/battleHarness.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const HEXTECH = JSON.parse(readFileSync(join(ROOT, 'data', 'hextech.json'), 'utf8'));

/** The persistent ref server/match/hextech.js addHexRef writes; the sim reads key / params / data.hexId. */
const REF = Object.freeze({
  id: 'hex:hex_traitspread', key: 'hex:hex_traitspread', name: '特质扩散', desc: '', iconKind: 'hex',
  counter: null, battle: true, params: { traitSpread: true, hexId: 'hex_traitspread' }, data: { hexId: 'hex_traitspread' },
});

/** A chess record carrying one real IN_BATTLE stat trait (garrison_03: ATK and max HP ×1.2). */
const carrier = (id, extra = {}) => {
  const rec = chessRec({ id, skill: null, ...extra });
  rec.garrisonIds = ['garrison_03_a'];
  return rec;
};
/** A plain chess record (no IN_BATTLE traits of its own unless given). */
const plain = (id, extra = {}) => chessRec({ id, skill: null, ...extra });

/** One player on the flat stage; `units` = [{ chessId, row, col, rec }]. */
function setup(units, { hex = true } = {}) {
  const chess = {};
  for (const u of units) chess[u.chessId] = u.rec;
  return makeBattle({
    defs: { chess, enemies: { enemy_dummy: enemyRec({ key: 'enemy_dummy', hp: 1e9, atk: 0, speed: 0 }) } },
    players: [{
      playerId: 'p1', seat: 0, side: 'L', colOffset: 0, bonds: {},
      playerEffects: hex ? [REF] : [],
      units: units.map((u, i) => ({ uid: i + 1, kind: 'chess', chessId: u.chessId, row: u.row, col: u.col })),
    }],
    enemies: [{ key: 'enemy_dummy', time: 0, route: 0 }],
    autoFinish: false,
    timeLimit: 10,
  });
}

const buffOf = (h, chessId) => h.unit(chessId).findBuff('gar:garrison_03_a');

test('the card text is 「复制给最近的干员（优先右边）」 (generated data + roster)', () => {
  assert.equal(HEXTECH.playerHexes.hex_traitspread.desc,
    '战斗开始时，你最靠左（同列更靠下）的干员把自身的战斗特质复制给最近的干员（优先右边）。');
  assert.deepEqual(HEXTECH.playerHexes.hex_traitspread.effect, { traitSpread: true });
});

test('nearest operator gains the trait; further operators do not; the target keeps its own trait', () => {
  const h = setup([
    { chessId: 'src', row: 10, col: 3, rec: carrier('src') },
    { chessId: 'near', row: 10, col: 5, rec: plain('near', {}) }, // 2 tiles right = nearest
    { chessId: 'far', row: 10, col: 9, rec: plain('far') },
  ]);
  // the source keeps its own trait
  assert.ok(buffOf(h, 'src'), 'the source keeps its own in-battle trait');
  // the nearest operator gains the copy
  assert.ok(buffOf(h, 'near'), 'the nearest operator gains the copied trait');
  // the far operator does not
  assert.equal(buffOf(h, 'far'), null, 'an operator further away gains nothing');
});

test('the copy is additive: the target keeps its own IN_BATTLE trait too', () => {
  const target = plain('near');
  target.garrisonIds = ['garrison_08_a']; // its own stat trait (SP recovery)
  const h = setup([
    { chessId: 'src', row: 10, col: 3, rec: carrier('src') },
    { chessId: 'near', row: 10, col: 5, rec: target },
  ]);
  assert.ok(buffOf(h, 'near'), 'the copied trait is installed on the target');
  assert.ok(h.unit('near').findBuff('gar:garrison_08_a'), 'the target keeps its own trait');
});

test('a tie prefers the operator on the RIGHT', () => {
  // the source must be the leftmost operator (the left side can therefore never hold a candidate), so the tie is
  // right vs up — both one tile away
  const h = setup([
    { chessId: 'src', row: 10, col: 4, rec: carrier('src') },
    { chessId: 'right', row: 10, col: 5, rec: plain('right') },
    { chessId: 'up', row: 11, col: 4, rec: plain('up') },
  ]);
  assert.ok(h.unit('right').findBuff('gar:garrison_03_a'), 'right wins an equal-distance tie');
  assert.equal(h.unit('up').findBuff('gar:garrison_03_a'), null, 'the up one gains nothing');
});

test('with nobody beside it, the search continues up / down', () => {
  // the source is the leftmost operator, so nothing can stand to its left; the vertical neighbours are the fallback
  const h = setup([
    { chessId: 'up', row: 11, col: 5, rec: plain('up') }, // the only neighbour, above the source
    { chessId: 'src', row: 10, col: 5, rec: carrier('src') },
  ]);
  assert.ok(h.unit('up').findBuff('gar:garrison_03_a'), 'the up neighbour is used when right and left are empty');
});

test('the SOURCE is the leftmost-bottom operator, even when it has no traits to copy', () => {
  // a plain leftmost operator: copying nothing is the correct outcome (the carrier to its right is not the source)
  const h = setup([
    { chessId: 'leftmost', row: 10, col: 2, rec: plain('leftmost') },
    { chessId: 'carrier', row: 10, col: 6, rec: carrier('carrier') },
    { chessId: 'target', row: 10, col: 8, rec: plain('target') },
  ]);
  assert.equal(h.unit('target').findBuff('gar:garrison_03_a'), null, 'a trait-less leftmost operator copies nothing');
  assert.ok(h.unit('carrier').findBuff('gar:garrison_03_a'), 'the carrier still carries its own trait');
});

test('no card = no copy', () => {
  const h = setup([
    { chessId: 'src', row: 10, col: 3, rec: carrier('src') },
    { chessId: 'near', row: 10, col: 5, rec: plain('near') },
  ], { hex: false });
  assert.equal(h.unit('near').findBuff('gar:garrison_03_a'), null, 'without the card the trait never spreads');
});
