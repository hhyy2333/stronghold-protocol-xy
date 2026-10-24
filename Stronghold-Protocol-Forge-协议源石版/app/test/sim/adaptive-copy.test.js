// 业主 2026-10-24「两个自适应成长好像也只加了一个」——副本必须真的各算一份。
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { makeBattle, chessRec } from '../helpers/battleHarness.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const HEXTECH = JSON.parse(readFileSync(path.join(ROOT, 'data', 'hextech.json'), 'utf8'));

/** The ref shape server/match/hextech.js addHexRef writes, with an optional `copySeq` for 策略「管理员」. */
function refOf(hexId, copySeq = 0) {
  const rec = HEXTECH.playerHexes[hexId];
  return {
    id: copySeq > 0 ? `hex:${hexId}#${copySeq}` : `hex:${hexId}`, key: `hex:${hexId}`, name: rec.name, desc: rec.desc,
    iconKind: 'hex', battle: true, params: { ...rec.effect, hexId, rarity: rec.rarity },
    data: { hexId, rarity: rec.rarity, ...(copySeq > 0 ? { copySeq } : {}) },
  };
}

const guard = () => chessRec({ id: 'test_guard', stats: { maxHp: 3000, atk: 200, def: 100, res: 0, blockCnt: 1, respawnTime: 20 }, skill: null });

/**
 * One enemy hex of a known tier (adaptive growth reads the ENEMY side's stones): 3阶 ⇒ 3 tiers ⇒ +24 % at 8 %/tier.
 * The enemy cards ride `flags.enemyHexIds`, the field a real match writes.
 */
const mk = (copies) => makeBattle({
  defs: { chess: { test_guard: guard() } },
  units: [{ uid: 1, kind: 'chess', chessId: 'test_guard', row: 9, col: 6 }],
  players: [{
    playerId: 'p1', seat: 0, side: 'L', colOffset: 0, bonds: {},
    playerEffects: Array.from({ length: copies }, (_, i) => refOf('hex_adaptivegrowth', i ? i + 1 : 0)),
    units: [{ uid: 1, kind: 'chess', chessId: 'test_guard', row: 9, col: 6 }],
  }],
  enemies: [],
  flags: { enemyHexIds: ['ehex_abyss'] },   // 3阶
  autoFinish: false, timeLimit: 20, seed: 9,
});

const pctOf = (u) => u.buffs.filter((b) => String(b.key).startsWith('hex:adaptivegrowth')).reduce((sum, b) => sum + (b.mods.atkPct || 0), 0);

test('自适应成长: two copies (管理员) give twice the bonus, not the same once', () => {
  const one = mk(1); one.run(0.3);
  const u1 = one.battle.allyUnits.find((u) => u.kind === 'op');
  const p1 = pctOf(u1);
  assert.ok(Math.abs(p1 - 0.24) < 1e-9, `one copy = 3 tiers × 8 % = 24 % (got ${(p1 * 100).toFixed(1)} %)`);

  const two = mk(2); two.run(0.3);
  const u2 = two.battle.allyUnits.find((u) => u.kind === 'op');
  const p2 = pctOf(u2);
  assert.ok(Math.abs(p2 - 0.48) < 1e-9, `two copies stack to 48 % (got ${(p2 * 100).toFixed(1)} %)`);
  // and the stacking really reached the operator's stats, not just the buff list
  assert.ok(Math.abs(u2.s.atkPct - 0.48) < 1e-9 || Math.abs((u2.s.atk / 200) - 1.48) < 1e-6, `ATK reflects +48 % (atk ${u2.s.atk})`);
  one.invariants(); two.invariants();
});
