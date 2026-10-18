// 协议等级 1–18（owner's call 2026-10-18）：叠加在**终极模拟**上的一条数值轴，0 = 关闭。
//
// 这一份钉住三件事：
//   * 表本身（18 行、逐级单调、13–18 的每一轴都不回头、综合压力严格上升）；
//   * 归一化：等级只在 ABYSS 上生效，其它难度一律 0；缺省 0 时引擎逐字节不变；
//   * 折入：敌方 mods（预览=实战同一个 matchEnemyMods）、收入、首领池。
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { makeMatch, DATA } from './harness.js';
import { enemyHexMods, matchEnemyMods, bossPoolHpFor } from '../../server/match/hextech.js';
import {
  PROTOCOL_LEVELS, PROTOCOL_LEVEL_MAX, isProtocolLevel, protocolLevelActive, protocolLevelRow, protocolLevelMods,
} from '../../shared/protocolLevels.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

test('the table: 18 levels, no axis ever steps back, total pressure strictly rises', () => {
  assert.equal(PROTOCOL_LEVEL_MAX, 18);
  assert.equal(PROTOCOL_LEVELS.length, 18);
  // 每级的「综合压力」代理：生命倍率 × (1 + 每波额外数量 × 0.08)。数量是最强的杠杆，所以它进代理；
  // 代理逐级严格上升 = 没有「12 级比 13 级还难」那类暗坑。
  const pressure = (row) => row.enemy.hpMul * (1 + (row.enemy.countAdd || 0) * 0.08);
  for (let i = 0; i < PROTOCOL_LEVELS.length; i++) {
    const row = PROTOCOL_LEVELS[i];
    assert.equal(row.level, i + 1);
    assert.ok(row.enemy.hpMul > 1 && row.enemy.atkMul > 1, 'every level is harder in HP and ATK');
    if (!i) continue;
    const prev = PROTOCOL_LEVELS[i - 1];
    assert.ok(row.enemy.hpMul > prev.enemy.hpMul, `HP rises at L${row.level}`);
    assert.ok(row.enemy.atkMul > prev.enemy.atkMul, `ATK rises at L${row.level}`);
    assert.ok((row.enemy.defMul || 1) >= (prev.enemy.defMul || 1), `DEF never falls at L${row.level}`);
    assert.ok((row.enemy.resMul || 1) >= (prev.enemy.resMul || 1), `RES never falls at L${row.level}`);
    assert.ok(pressure(row) > pressure(prev), `total pressure rises at L${row.level}`);
    // 深潜区（13–18）的每一轴都不回头：数量 / 漏怪 / 收入惩罚 / 首领池 / 额外敌方源石
    if (row.level >= 13) {
      assert.ok((row.enemy.countAdd || 0) >= (prev.enemy.countAdd || 0), `bodies never fall at L${row.level}`);
      assert.ok((row.leakLp || 0) >= (prev.leakLp || 0), `leak LP never falls at L${row.level}`);
      assert.ok((row.incomeDelta || 0) <= (prev.incomeDelta || 0), `income penalty never eases at L${row.level}`);
      assert.ok((row.bossPoolMul || 1) >= (prev.bossPoolMul || 1), `boss pool never shrinks at L${row.level}`);
      assert.ok((row.extraEnemyHexes || 0) >= (prev.extraEnemyHexes || 0), `extra enemy cards never fall at L${row.level}`);
    }
  }
  assert.deepEqual([6, 12, 18].map((n) => !!protocolLevelRow(n).milestone), [true, true, true], 'milestones at 6/12/18');
  // 13–18 已经量过一轮（tools/balance.mjs --level），不再挂「实验」牌
  assert.ok(PROTOCOL_LEVELS.every((row) => !row.experimental), 'the whole table is shipped, not a placeholder');
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
  // the pool a real boss round builds (bossPoolHpFor → finalAssault.bossPoolHp) carries it too — one source, both halves
  assert.equal(bossPoolHpFor(lv18.m, bossId), Math.round(bossPoolHpFor(base.m, bossId) * 1.5), 'real boss pool ×1.5 at level 18');
  assert.equal(bossPoolHpFor(lv6.m, bossId), bossPoolHpFor(base.m, bossId), 'levels below 13 leave the pool alone');
  // another difficulty normalizes the level away
  const hard = makeMatch({ mode: 'solo', difficulty: 'HARD', humans: 1, seed: 21, fake: true, protocolLevel: 6 });
  assert.equal(hard.m.protocolLevel, 0);
  assert.deepEqual(matchEnemyMods(hard.m), {});
});

test('levels 13+ actually grant extra enemy hexes at the start (13/14/15 → 1, 16/17 → 2, 18 → 3)', () => {
  const at = (level, difficulty = 'ABYSS') => {
    const h = makeMatch({ mode: 'solo', difficulty, humans: 1, seed: 31, fake: true, protocolLevel: level });
    h.start();
    return h.m.enemyHexes.map((e) => e && e.id);
  };
  assert.equal(at(0).length, 0, 'off: nothing');
  assert.equal(at(12).length, 0, 'level 12 has no extra enemy card');
  assert.equal(at(13).length, 1);
  assert.equal(at(14).length, 1);
  assert.equal(at(15).length, 1);
  assert.equal(at(16).length, 2);
  assert.equal(at(17).length, 2);
  const lv18 = at(18);
  assert.equal(lv18.length, 3);
  assert.equal(new Set(lv18).size, 3, 'no duplicate enemy cards');
  assert.equal(at(18, 'HARD').length, 0, 'only the highest difficulty carries levels');
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
