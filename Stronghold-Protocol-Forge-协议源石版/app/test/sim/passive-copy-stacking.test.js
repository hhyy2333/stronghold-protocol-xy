// 业主 2026-10-24「全改掉」：凡是把战斗半边写成 `passiveBuff` 的卡，被「管理员」复制后都要真的算两份。
// 每张卡用它的**最小可观测改法**验证：一份 vs 两份，同一份卡的被动总和必须翻倍（而不是被 replace 掉）。
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { makeBattle, chessRec } from '../helpers/battleHarness.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const HEXTECH = JSON.parse(readFileSync(path.join(ROOT, 'data', 'hextech.json'), 'utf8'));

function refOf(hexId, copySeq = 0) {
  const rec = HEXTECH.playerHexes[hexId];
  return {
    id: copySeq > 0 ? `hex:${hexId}#${copySeq}` : `hex:${hexId}`, key: `hex:${hexId}`, name: rec.name, desc: rec.desc,
    iconKind: 'hex', battle: true, params: { ...rec.effect, hexId, rarity: rec.rarity },
    data: { hexId, rarity: rec.rarity, ...(copySeq > 0 ? { copySeq } : {}) },
  };
}

const op = (id, o = {}) => chessRec({
  id, profession: o.profession ?? 'WARRIOR', position: o.position ?? 'MELEE',
  stats: { maxHp: 3000, atk: 200, def: 100, res: 0, aspd: 100, bat: 1, blockCnt: 1, respawnTime: 20 },
  bonds: o.bonds ?? [], skill: null,
});

/** Sum of every `hex:*` passive buff mod field on a unit (so the assertion does not depend on one card's key name). */
const hexSum = (u, field) => u.buffs
  .filter((b) => String(b.key).startsWith('hex:'))
  .reduce((n, b) => n + (Number(b.mods && b.mods[field]) || 0), 0);

const mk = (hexId, copies, { units = null, enemies = null, flags = null } = {}) => makeBattle({
  defs: { chess: { test_op: op('test_op'), test_sniper: op('test_sniper', { profession: 'SNIPER', position: 'RANGED' }) } },
  units: units || [{ uid: 1, kind: 'chess', chessId: 'test_op', row: 9, col: 6 }],
  players: [{
    playerId: 'p1', seat: 0, side: 'L', colOffset: 0, bonds: {},
    playerEffects: Array.from({ length: copies }, (_, i) => refOf(hexId, i ? i + 1 : 0)),
    units: units || [{ uid: 1, kind: 'chess', chessId: 'test_op', row: 9, col: 6 }],
  }],
  enemies: enemies || [],
  flags: flags || {},
  autoFinish: false, timeLimit: 20, seed: 17,
});

/** Every card converted to passivePerCopy: hexId, field to measure, optional setup. */
const CARDS = [
  { hexId: 'hex_oldpower', field: 'dmgDealtMul' },                                   // 旧日之力
  { hexId: 'hex_glasscannon', field: 'hpMul' },                                      // 玻璃大炮
  { hexId: 'hex_firingline', field: 'rangeExtend', units: [{ uid: 1, kind: 'chess', chessId: 'test_sniper', row: 9, col: 6 }], sniper: true },  // 火力延伸
];

for (const c of CARDS) {
  test(`管理员 copy stacks: ${c.hexId} (${c.field})`, () => {
    const one = mk(c.hexId, 1, { units: c.units }); one.run(0.6);
    const u1 = one.battle.allyUnits.find((u) => u.kind === 'op');
    const a = hexSum(u1, c.field);
    assert.ok(a !== 0, `premise: one copy does something (${a})`);
    const two = mk(c.hexId, 2, { units: c.units }); two.run(0.6);
    const u2 = two.battle.allyUnits.find((u) => u.kind === 'op');
    const b = hexSum(u2, c.field);
    assert.ok(Math.abs(b - a * 2) < 1e-9, `two copies = twice the one-copy value (${a} → ${b})`);
    one.invariants(); two.invariants();
  });
}
