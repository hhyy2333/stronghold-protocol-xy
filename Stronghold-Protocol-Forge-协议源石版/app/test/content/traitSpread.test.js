// 特质扩散 (hex_traitspread, 业主 2026-10-18; 加强 2026-11-01「给右边和上面」): at battle start the owner's
// leftmost-bottom operator copies its IN_BATTLE traits to the NEAREST own operator on its RIGHT and to the NEAREST
// own operator ABOVE it (row 0 is the BOTTOM row, so above = +row). Neither beneficiary has to stand adjacent to the
// source; a direction with nobody on it simply grants nothing; both directions landing on one operator copy once; a
// target keeps its own traits (the copy is additive). The card text says exactly
// 「把自身的战斗特质复制给右边和上面最近的干员」 — 「最近」, the tie-break and the diagonal case are [ASSUMED] and
// live in applyTraitSpread (server/sim/content/garrisons/battle.js).
//
// NB the left / below directions can no longer receive anything, and that is not directly assertable: the leftmost
// operator of the leftmost column IS the source (the lower tile wins a column), so nobody can ever sit to its left or
// below it in that column — every other operator is either to its right or above it.
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

test('the card text is 「复制给右边和上面最近的干员」 (generated data + roster)', () => {
  assert.equal(HEXTECH.playerHexes.hex_traitspread.desc,
    '战斗开始时，你最靠左（同列更靠下）的干员把自身的战斗特质复制给右边和上面最近的干员。');
  assert.deepEqual(HEXTECH.playerHexes.hex_traitspread.effect, { traitSpread: true });
});

test('both beneficiaries gain the trait: the nearest on the RIGHT and the nearest ABOVE', () => {
  const h = setup([
    { chessId: 'src', row: 9, col: 3, rec: carrier('src') }, // bottom row of the field, leftmost column
    { chessId: 'right', row: 9, col: 6, rec: plain('right') }, // 3 tiles right = nearest to the right
    { chessId: 'up', row: 12, col: 3, rec: plain('up') }, // 3 rows above, same column = nearest above
    { chessId: 'farRight', row: 9, col: 9, rec: plain('farRight') },
    { chessId: 'farUp', row: 12, col: 9, rec: plain('farUp') }, // above, but further than `up`
  ]);
  // the source keeps its own trait
  assert.ok(buffOf(h, 'src'), 'the source keeps its own in-battle trait');
  // one copy each way, no adjacency required
  assert.ok(buffOf(h, 'right'), 'the nearest operator on the right gains the copied trait');
  assert.ok(buffOf(h, 'up'), 'the nearest operator above gains the copied trait');
  // further away in either direction gains nothing
  assert.equal(buffOf(h, 'farRight'), null, 'a further operator on the right gains nothing');
  assert.equal(buffOf(h, 'farUp'), null, 'a further operator above gains nothing');
});

test('nobody above (the source is in the top row): only the operator on the right gains the trait', () => {
  const h = setup([
    { chessId: 'src', row: 12, col: 3, rec: carrier('src') },
    { chessId: 'right', row: 12, col: 6, rec: plain('right') },
    { chessId: 'farRight', row: 12, col: 9, rec: plain('farRight') },
  ]);
  assert.ok(buffOf(h, 'right'), 'the right direction still copies when there is nobody above');
  assert.equal(buffOf(h, 'farRight'), null, 'only the NEAREST operator on the right is used');
});

test('nobody on the right (the source is in the rightmost column): only the operator above gains the trait', () => {
  const h = setup([
    { chessId: 'src', row: 10, col: 9, rec: carrier('src') },
    { chessId: 'up', row: 12, col: 9, rec: plain('up') },
  ]);
  assert.ok(buffOf(h, 'up'), 'the up direction still copies when there is nobody on the right');
});

test('the copy is additive: the target keeps its own IN_BATTLE trait too', () => {
  const right = plain('right');
  right.garrisonIds = ['garrison_08_a']; // its own stat trait (SP recovery)
  const up = plain('up');
  up.garrisonIds = ['garrison_08_a'];
  const h = setup([
    { chessId: 'src', row: 9, col: 3, rec: carrier('src') },
    { chessId: 'right', row: 9, col: 5, rec: right },
    { chessId: 'up', row: 12, col: 3, rec: up },
  ]);
  for (const id of ['right', 'up']) {
    assert.ok(buffOf(h, id), `the copied trait is installed on ${id}`);
    assert.ok(h.unit(id).findBuff('gar:garrison_08_a'), `${id} keeps its own trait`);
  }
});

test('both directions land on ONE operator (diagonal upper-right): it copies once', () => {
  const h = setup([
    { chessId: 'src', row: 10, col: 4, rec: carrier('src') },
    { chessId: 'diag', row: 12, col: 6, rec: plain('diag') }, // nearest right AND nearest above
    { chessId: 'farRight', row: 10, col: 9, rec: plain('farRight') },
  ]);
  assert.deepEqual(h.unit('diag').spreadGarrisonIds, ['garrison_03_a'], 'the diagonal operator copies exactly once');
  assert.ok(buffOf(h, 'diag'), 'and the copy is installed');
  assert.equal(buffOf(h, 'farRight'), null, 'a further operator on the right gains nothing');
});

test('the SOURCE is the leftmost-bottom operator, even when it has no traits to copy', () => {
  // a plain leftmost operator: copying nothing is the correct outcome (the carrier to its right is not the source)
  const h = setup([
    { chessId: 'leftmost', row: 10, col: 2, rec: plain('leftmost') },
    { chessId: 'carrier', row: 10, col: 6, rec: carrier('carrier') },
    { chessId: 'target', row: 10, col: 8, rec: plain('target') },
  ]);
  assert.equal(buffOf(h, 'target'), null, 'a trait-less leftmost operator copies nothing');
  assert.ok(buffOf(h, 'carrier'), 'the carrier still carries its own trait');
});

test('no card = no copy', () => {
  const h = setup([
    { chessId: 'src', row: 9, col: 3, rec: carrier('src') },
    { chessId: 'near', row: 9, col: 5, rec: plain('near') },
    { chessId: 'up', row: 12, col: 3, rec: plain('up') },
  ], { hex: false });
  assert.equal(buffOf(h, 'near'), null, 'without the card the trait never spreads to the right');
  assert.equal(buffOf(h, 'up'), null, 'without the card the trait never spreads upwards');
});
