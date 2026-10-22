// 协议等级 1–18（owner's call 2026-10-18）：叠加在**终极模拟**上的一条数值轴，0 = 关闭。
//
// 这一份钉住三件事：
//   * 表本身（18 行、逐级单调、13–18 的每一轴都不回头、综合压力严格上升）；
//   * 归一化：等级只在 ABYSS 上生效，其它难度一律 0；缺省 0 时引擎逐字节不变；
//   * 折入：敌方 mods（预览=实战同一个 matchEnemyMods）、收入、首领池，以及额外敌方协议源石按 R1/R3/R5 分散发放
//     （业主 2026-10-22「额外协议源石分散给，在1，3，5回合给额外的」）。
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { makeMatch, DATA } from './harness.js';
import { enemyHexMods, matchEnemyMods, bossPoolHpFor } from '../../server/match/hextech.js';
import {
  PROTOCOL_LEVELS, PROTOCOL_LEVEL_MAX, isProtocolLevel, protocolLevelActive, protocolLevelRow, protocolLevelMods,
  PROTOCOL_LEVEL_EXTRA_HEX_ROUNDS, protocolLevelExtraHexesAt,
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
  // 收入惩罚从第 8 回合起才生效（PROTOCOL_LEVEL_INCOME_FREE_ROUNDS = 7，业主 2026-10-18「从第 8 回合开始减少钱」）
  assert.equal(lv12.m.gd.income(8), base.m.gd.income(8) - 1, 'level 12 pays one fund less from round 8');
  assert.equal(lv12.m.gd.income(1), base.m.gd.income(1), 'the first seven rounds are exempt');
  assert.equal(lv12.m.gd.income(7), base.m.gd.income(7), 'round 7 is still exempt');
  assert.equal(lv12.m.gd.income(8) >= 0, true);
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

// 业主 2026-10-18：「n18 经济惩罚太重」，随后定为「从第 8 回合开始减少钱」。收入惩罚是绝对减，而开局是
// 自走棋最脆弱的地方 —— Lv18 的第 1 回合曾只剩 1 金（最便宜的棋子 2 金），等于开局就被判死。这条测试钉住
// 「前 7 回合豁免、第 8 回合起才罚」本身。
test('the income penalty starts at round 8, so every level opens with a normal hand', () => {
  const base = makeMatch({ mode: 'solo', difficulty: 'ABYSS', humans: 1, seed: 21, fake: true });
  const lv18 = makeMatch({ mode: 'solo', difficulty: 'ABYSS', humans: 1, seed: 21, fake: true, protocolLevel: 18 });
  // 前 7 回合：与不带等级**逐值相同**，于是 Lv18 也能正常起手（4 / 5 / 6 / 7 / 8 / 9 / 10 金）
  for (let r = 1; r <= 7; r++) {
    assert.equal(lv18.m.gd.income(r), base.m.gd.income(r), `round ${r} is exempt at level 18`);
  }
  assert.deepEqual([1, 2, 3, 4, 5, 6, 7].map((r) => lv18.m.gd.income(r)), [4, 5, 6, 7, 8, 9, 10], 'the opening seven rounds are the normal ones');
  // 第 8 回合起才罚，且罚的是表里写的那个绝对值
  assert.equal(lv18.m.gd.income(8), base.m.gd.income(8) - 3, 'level 18 pays three funds less from round 8');
  assert.equal(lv18.m.gd.income(12), base.m.gd.income(12) - 3);
  // 永远不为负、也永远不比不带等级多（惩罚只会往下）
  for (let r = 1; r <= 15; r++) {
    const got = lv18.m.gd.income(r);
    assert.ok(got >= 0, `income(${r}) is never negative`);
    assert.ok(got <= base.m.gd.income(r), `income(${r}) never exceeds the unlevelled value`);
  }
  // 每一级都不比不带等级多，且豁免回合内与不带等级一致
  for (const lv of [10, 12, 13, 14, 17, 18]) {
    const h = makeMatch({ mode: 'solo', difficulty: 'ABYSS', humans: 1, seed: 21, fake: true, protocolLevel: lv });
    for (let r = 1; r <= 7; r++) assert.equal(h.m.gd.income(r), base.m.gd.income(r), `L${lv} round ${r} exempt`);
    assert.ok(h.m.gd.income(8) <= base.m.gd.income(8), `L${lv} round 8 never pays more`);
  }
  // 等级 0 / 其它难度：逐字不变（豁免逻辑一个字节都不碰它们）
  assert.equal(base.m.gd.income(1), 4);
  assert.equal(base.m.gd.income(4), 7);
  assert.equal(base.m.gd.income(8), 11);
});

test('extra enemy hexes: same totals, now spread over rounds 1 / 3 / 5', () => {
  // 业主 2026-10-22「额外协议源石分散给，在1，3，5回合给额外的」：整局张数不变（13/14/15 → 1、16/17 → 2、18 → 3），
  // 但第 i 张在第 1 / 3 / 5 回合发 —— 第 i 张的回合就是 PROTOCOL_LEVEL_EXTRA_HEX_ROUNDS[i]。
  assert.deepEqual([...PROTOCOL_LEVEL_EXTRA_HEX_ROUNDS], [1, 3, 5]);
  for (const row of PROTOCOL_LEVELS) {
    const total = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15]
      .reduce((n, r) => n + protocolLevelExtraHexesAt(row.level, r, 'ABYSS'), 0);
    assert.equal(total, row.extraEnemyHexes || 0, `L${row.level}: the whole match still gets ${row.extraEnemyHexes || 0}`);
  }
  const at = (level) => [1, 2, 3, 4, 5, 6].map((r) => protocolLevelExtraHexesAt(level, r, 'ABYSS'));
  assert.deepEqual(at(12), [0, 0, 0, 0, 0, 0], 'level 12 has no extra enemy card');
  assert.deepEqual(at(13), [1, 0, 0, 0, 0, 0], 'one card, on R1');
  assert.deepEqual(at(16), [1, 0, 1, 0, 0, 0], 'two cards: R1 + R3');
  assert.deepEqual(at(18), [1, 0, 1, 0, 1, 0], 'three cards: one at each of R1 / R3 / R5');
  assert.equal(protocolLevelExtraHexesAt(18, 1, 'HARD'), 0, 'only the highest difficulty carries levels');

  // 实战路径：MatchPhases.startRound 逐回合发。先量一条无等级的基线（R1 / R3 各抽 1 张正常的敌方源石），
  // 再看每个等级在 ROUND_START 时比基线多出来的张数 —— 这样既验证「发在哪一回合」，也不依赖抽到哪几张卡。
  const counts = (level) => {
    const h = makeMatch({ mode: 'solo', difficulty: 'ABYSS', humans: 1, seed: 31, fake: true, protocolLevel: level });
    h.start();
    const out = { start: h.m.enemyHexes.length };
    for (const r of [1, 3, 5]) {
      const ok = h.drive(() => h.m.phase === 'ROUND_START' && h.m.round === r);
      assert.ok(ok, `reached ROUND_START R${r} (phase ${h.m.phase} R${h.m.round})`);
      out['r' + r] = h.m.enemyHexes.length;
    }
    out.ids = h.m.enemyHexes.map((e) => e && e.id);
    h.m.dispose();
    return out;
  };
  const base = counts(0);
  assert.deepEqual([base.start, base.r1, base.r3, base.r5], [0, 0, 1, 2], 'premise: no extra cards without a level');
  const extra = (level) => {
    const c = counts(level);
    return { r1: c.r1 - base.r1, r3: c.r3 - base.r3, r5: c.r5 - base.r5, unique: new Set(c.ids).size === c.ids.length };
  };
  assert.deepEqual(extra(12), { r1: 0, r3: 0, r5: 0, unique: true }, 'level 12 adds nothing');
  assert.deepEqual(extra(13), { r1: 1, r3: 1, r5: 1, unique: true }, 'L13-15: the R1 card only');
  assert.deepEqual(extra(16), { r1: 1, r3: 2, r5: 2, unique: true }, 'L16-17: R1 + R3');
  assert.deepEqual(extra(18), { r1: 1, r3: 2, r5: 3, unique: true }, 'L18: one at each of R1 / R3 / R5, no repeats');
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
