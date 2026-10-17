// test/content/siracusa-resonance.test.js — 盟约共鸣 (hex_bondresonance) + 叙拉古 6：
// 共鸣借来的盟约必须**在战斗里也算成员**，否则只有本身就是叙拉古的干员吃到 6 阶隐匿。
//
// 业主 2026-10-17 实测：盟约共鸣之后棋盘上有 7 个叙拉古，但只有本身是叙拉古的 3 个隐身。
// 根因：round.js battleInput() 把借来的盟约写在 unit.bonds 上（战斗输入），但 sim 的 _createAllyFromInput
// 从来不读那个字段 —— unitBonds() 只看 def.bonds + 装备授予，于是借来的盟约在战斗里彻底丢失。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeBattle, chessRec, enemyRec } from '../helpers/battleHarness.js';
import { unitBonds } from '../../server/sim/content/support/index.js';

const op = (id, bonds) => chessRec({
  id, bonds, profession: 'WARRIOR', skill: null,
  stats: { atk: 100, maxHp: 1000, def: 0, blockCnt: 1 },
});
const bondOn = (count, thresholds = [3, 6, 9]) => ({
  count, active: count >= thresholds[0], tier: thresholds.filter((t) => count >= t).length, layers: 0,
});

/** 7 operators on one row; the first 3 really are 叙拉古, the last 4 borrow it via 盟约共鸣. */
function scene() {
  const defs = {
    chess: {
      s1_a: op('s1_a', ['siracusaShip']), s2_a: op('s2_a', ['siracusaShip']), s3_a: op('s3_a', ['siracusaShip']),
      n1_a: op('n1_a', ['yanShip']), n2_a: op('n2_a', ['yanShip']), n3_a: op('n3_a', ['kjeragShip']), n4_a: op('n4_a', ['lateranoShip']),
    },
    enemies: { e_dummy: enemyRec({ key: 'e_dummy', hp: 1e9, speed: 0, def: 0, res: 0 }) },
  };
  const ids = ['s1_a', 's2_a', 's3_a', 'n1_a', 'n2_a', 'n3_a', 'n4_a'];
  // the production shape: battleInput() puts the borrowed bonds on the UNIT entry (`bonds`)
  const units = ids.map((chessId, i) => ({
    uid: i + 1, kind: 'chess', chessId, row: 10, col: 3 + i,
    ...(i >= 3 ? { bonds: ['siracusaShip'] } : null),
  }));
  return makeBattle({
    defs, players: [{ playerId: 'p1', seat: 0, side: 'L', colOffset: 0, units, bonds: { siracusaShip: bondOn(7) } }],
    enemies: [{ key: 'e_dummy', time: 0, route: 0 }], autoFinish: false, timeLimit: 60, seed: 5,
  });
}

test('unitBonds: 借来的盟约（战斗输入 unit.bonds）算成员', () => {
  const h = scene();
  h.step(1);
  const borrowed = h.unit('n1_a');
  assert.ok(unitBonds(borrowed).includes('siracusaShip'), '借来的叙拉古必须出现在 unitBonds 里（实际 ' + JSON.stringify(unitBonds(borrowed)) + '）');
  assert.ok(unitBonds(h.unit('s1_a')).includes('siracusaShip'), '本身的叙拉古照旧');
});

test('叙拉古 6：盟约共鸣借来的 4 人也吃到隐匿（7 人全隐身）', () => {
  const h = scene();
  h.step(1);
  const ids = ['s1_a', 's2_a', 's3_a', 'n1_a', 'n2_a', 'n3_a', 'n4_a'];
  const hidden = ids.filter((id) => h.unit(id).s.flags.stealth);
  assert.deepEqual(hidden.sort(), ids.slice().sort(), '7 个叙拉古成员全都要隐身（实际隐身 ' + JSON.stringify(hidden) + '）');
});
