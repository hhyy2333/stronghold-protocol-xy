// test/content/mod-chess-char-kit.test.js — 工坊包新加的棋子（packChess）没有自己的 kit：
// 引擎查 kit 时按 charId 回落到官方干员的完整实现（克莱门莎的放逐舱 = kits/ops/op-clemnt.js），
// 原版棋子和「覆盖官方记录」的那条路都不受影响。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { applyWorkshop } from '../../shared/workshop.js';
import { normalizeChess } from '../../server/sim/simdata.js';
import { KITS, kitOf, kitKeyOf } from '../../server/sim/content/index.js';

const CLEMNT = 'char_4231_clemnt';

test('applyWorkshop：包新加的棋子打 packChess；覆盖官方棋子的不打', () => {
  const base = { chess: { chess_char_1_04_a: { chessId: 'chess_char_1_04_a', charId: 'char_1_04', stats: {} } } };
  const pack = {
    id: 'mod-a',
    overrides: ['chess:chess_char_1_04_a'],
    files: { chess: {
      chess_char_6_23_a: { chessId: 'chess_char_6_23_a', charId: CLEMNT, stats: {} },
      chess_char_1_04_a: { chessId: 'chess_char_1_04_a', tier: 5 },
    } },
  };
  const { data } = applyWorkshop(base, [pack]);
  assert.equal(data.chess['chess_char_6_23_a'].packChess, true);
  assert.equal(data.chess['chess_char_1_04_a'].packChess, undefined, '覆盖官方棋子不标');
});

test('kitOf：包加的棋子按 charId 命中官方 kit（克莱门莎），没有标记的仍回落 generic', () => {
  const mod = normalizeChess({ chessId: 'chess_char_6_23_a', charId: CLEMNT, packChess: true, stats: {} });
  assert.equal(mod.kitFromChar, true);
  assert.equal(kitKeyOf(mod, KITS), CLEMNT);
  assert.equal(typeof kitOf(mod, KITS), 'function');
  const plain = normalizeChess({ chessId: 'chess_char_6_23_b', charId: CLEMNT, stats: {} });
  assert.equal(plain.kitFromChar, undefined);
  assert.equal(kitKeyOf(plain, KITS), null);
  assert.equal(kitOf(plain, KITS), undefined);
});

test('原版棋子：仍然按 baseId 命中自己的 kit，不参与 charId 回落', () => {
  const v = normalizeChess({ chessId: 'chess_char_4_12_b', baseId: 'chess_char_4_12_a', charId: 'char_4145_ulpia', stats: {} });
  assert.equal(v.kitFromChar, undefined);
  assert.notEqual(kitKeyOf(v, KITS), 'char_4145_ulpia');
});
