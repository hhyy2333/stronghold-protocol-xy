// 协议等级 1–18（owner's call 2026-10-18）：叠加在**终极模拟**上的一条数值轴，0 = 关闭。
//
// 这一份钉住三件事：
//   * 表本身（18 行、逐级单调、13–18 标 experimental）；
//   * 归一化：等级只在 ABYSS 上生效，其它难度一律 0；缺省 0 时引擎逐字节不变；
//   * 折入：敌方 mods（预览=实战同一个 matchEnemyMods）、收入、首领池。
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { makeMatch, DATA } from './harness.js';
import { enemyHexMods, matchEnemyMods } from '../../server/match/hextech.js';
import {
  PROTOCOL_LEVELS, PROTOCOL_LEVEL_MAX, isProtocolLevel, protocolLevelActive, protocolLevelRow, protocolLevelMods,
} from '../../shared/protocolLevels.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

test('the table: 18 levels, monotonic enemy multipliers, 13–18 experimental', () => {
  assert.equal(PROTOCOL_LEVEL_MAX, 18);
  assert.equal(PROTOCOL_LEVELS.length, 18);
  for (let i = 0; i < PROTOCOL_LEVELS.length; i++) {
    const row = PROTOCOL_LEVELS[i];
    assert.equal(row.level, i + 1);
    assert.ok(row.enemy.hpMul > 1 && row.enemy.atkMul > 1, 'every level is harder in HP and ATK');
    if (i) {
      assert.ok(row.enemy.hpMul > PROTOCOL_LEVELS[i - 1].enemy.hpMul, 'HP rises every level');
      assert.ok(row.enemy.atkMul > PROTOCOL_LEVELS[i - 1].enemy.atkMul, 'ATK rises every level');
    }
    assert.equal(!!row.experimental, row.level >= 13, '13–18 are the framework (experimental)');
  }
  assert.deepEqual([6, 12, 18].map((n) => !!protocolLevelRow(n).milestone), [true, true, true], 'milestones at 6/12/18');
});

test('normalization: off is off everywhere except ABYSS 1–18', () => {
  assert.equal(isProtocolLevel(0) && isProtocolLevel(18), true);
  for (const bad of [-1, 19, 2.5, '6', null, undefined]) assert.equal(isProtocolLevel(bad), false, String(bad));
  assert.equal(protocolLevelActive(6, 'ABYSS'), true);
  for (const d of ['FUNNY', 'NORMAL', 'HARD', 'TRAINING']) assert.equal(protocolLevelActive(6, d), false, d);
  assert.equal(protocolLevelMods(0, 'ABYSS'), null, '0 = off, byte-for-byte the old game');
  assert.equal(protocolLevelMods(6, 'HARD'), null, 'other difficulties never carry a level');
  assert.deepEqual(protocolLevelMods(18, 'ABYSS').enemy.hpMul, 2.45);
});

test('a match at level 0 reads exactly like before (enemy mods empty, income untouched, boss pool untouched)', () => {
  const a = makeMatch({ mode: 'solo', difficulty: 'ABYSS', humans: 1, seed: 21, fake: true });
  const b = makeMatch({ mode: 'solo', difficulty: 'ABYSS', humans: 1, seed: 21, fake: true, protocolLevel: 0 });
  assert.equal(a.m.protocolLevel, 0);
  assert.equal(b.m.protocolLevel, 0);
  assert.deepEqual(matchEnemyMods(a.m), {});
  assert.deepEqual(matchEnemyMods(b.m), enemyHexMods(b.m), 'level 0 adds nothing');
  assert.equal(b.m.gd.income(1), a.m.gd.income(1));
  const bossId = Object.keys(DATA.bosses)[0];
  assert.equal(b.m.gd.bossPoolHp(bossId, 2), a.m.gd.bossPoolHp(bossId, 2));
});

test('a level folds into enemy mods, income and the leader pool — and only on ABYSS', () => {
  const base = makeMatch({ mode: 'solo', difficulty: 'ABYSS', humans: 1, seed: 21, fake: true });
  const lv6 = makeMatch({ mode: 'solo', difficulty: 'ABYSS', humans: 1, seed: 21, fake: true, protocolLevel: 6 });
  const lv12 = makeMatch({ mode: 'solo', difficulty: 'ABYSS', humans: 1, seed: 21, fake: true, protocolLevel: 12 });
  const lv18 = makeMatch({ mode: 'solo', difficulty: 'ABYSS', humans: 1, seed: 21, fake: true, protocolLevel: 18 });
  assert.equal(lv6.m.protocolLevel, 6);
  assert.deepEqual(matchEnemyMods(lv6.m), { hpMul: 1.33, atkMul: 1.2 }, 'level 6 enemy mods');
  assert.equal(lv12.m.gd.income(1), base.m.gd.income(1) - 1, 'level 12 pays one fund less');
  assert.equal(lv12.m.gd.income(1) >= 0, true);
  const bossId = Object.keys(DATA.bosses)[0];
  assert.equal(lv18.m.gd.bossPoolHp(bossId, 2), Math.round(base.m.gd.bossPoolHp(bossId, 2) * 1.5));
  // another difficulty normalizes the level away
  const hard = makeMatch({ mode: 'solo', difficulty: 'HARD', humans: 1, seed: 21, fake: true, protocolLevel: 6 });
  assert.equal(hard.m.protocolLevel, 0);
  assert.deepEqual(matchEnemyMods(hard.m), {});
});

test('the lobby and the protocol carry the level; setLevel refuses it off the highest difficulty', () => {
  const lobby = readFileSync(path.join(ROOT, 'server/lobby.js'), 'utf8');
  assert.ok(lobby.includes('room.level = protocolLevelActive(level, difficulty)'));
  assert.ok(lobby.includes("case 'room.setLevel'"));
  assert.ok(lobby.includes("if (level > 0 && room.difficulty !== 'ABYSS') return fail(ERR.BAD_TARGET"));
  const proto = readFileSync(path.join(ROOT, 'shared/protocol.js'), 'utf8');
  assert.ok(proto.includes("'room.setLevel': { level: (v) => isInt(v, 0, PROTOCOL_LEVEL_MAX) }"));
  assert.ok(proto.includes('level: (v) => v == null || isInt(v, 0, PROTOCOL_LEVEL_MAX)'), 'room.queue carries it');
  const mm = readFileSync(path.join(ROOT, 'server/matchmaking.js'), 'utf8');
  assert.ok(mm.includes('e.difficulty === head.difficulty && (e.level || 0) === (head.level || 0)'), 'strict on (difficulty, level)');
});
