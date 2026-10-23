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
import { buildNormalWave, withExtraBoss } from '../../server/match/waves.js';
import {
  PROTOCOL_LEVELS, PROTOCOL_LEVEL_MAX, isProtocolLevel, protocolLevelActive, protocolLevelRow, protocolLevelMods,
  PROTOCOL_LEVEL_EXTRA_HEX_ROUNDS, protocolLevelExtraHexesAt,
  PROTOCOL_LEVEL_EXTRA_BOSS_ROUND, PROTOCOL_LEVEL_EXTRA_BOSS_LEVEL, PROTOCOL_LEVEL_EXTRA_BOSSES, protocolLevelExtraBossAt,
  PROTOCOL_LEVEL_INCOME_FREE_ROUNDS, PROTOCOL_LEVEL_DEEP_FROM, PROTOCOL_LEVEL_EFFECT_TEXT,
  protocolLevelEffects, protocolLevelHeadline,
  PROTOCOL_LEVEL_ROUND_RAMP, PROTOCOL_LEVEL_FULL_ROUND, PROTOCOL_LEVEL_LATE_ROUND, protocolLevelRoundK,
  protocolLevelEnemyMods, protocolLevelCountAddAt,
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
  assert.equal(lv18.m.gd.bossPoolHp(bossId, 2), Math.round(base.m.gd.bossPoolHp(bossId, 2) * 1.8));
  // the pool a real boss round builds (bossPoolHpFor → finalAssault.bossPoolHp) carries it too — one source, both halves
  assert.equal(bossPoolHpFor(lv18.m, bossId), Math.round(bossPoolHpFor(base.m, bossId) * 1.8), 'real boss pool ×1.8 at level 18');
  assert.equal(bossPoolHpFor(lv6.m, bossId), bossPoolHpFor(base.m, bossId), 'levels below 13 leave the pool alone');
  // another difficulty normalizes the level away
  const hard = makeMatch({ mode: 'solo', difficulty: 'HARD', humans: 1, seed: 21, fake: true, protocolLevel: 6 });
  assert.equal(hard.m.protocolLevel, 0);
  assert.deepEqual(matchEnemyMods(hard.m), {});
});

// =====================================================================================================================
// 回合爬升（业主 2026-10-24：「调整 n1-18，计划是削弱敌方前期加强后期」→「k = 1 落在第 6 回合」）
//
// 钉住三件事：
//   1. k 表本身（冻结、R6 恰好 = 1、随回合不减、非法回合 ⇒ 1）；
//   2. 折入是「1 + (表值 - 1) × k」—— 按**增量**缩放，等级之间的差别在任何回合都保得住，18 行表值一个字没动；
//   3. `countAdd` 的阶梯：R1–R5 = 0、R6–R10 = 表值、R11 起 = 表值 + 1；且实战折入点真的按 `m.round` 取值。
// =====================================================================================================================

test('回合爬升：k 表冻结、R6 满额、随回合不减', () => {
  assert.equal(PROTOCOL_LEVEL_FULL_ROUND, 6, 'k = 1 lands on round 6 (the owner\'s call)');
  assert.equal(PROTOCOL_LEVEL_LATE_ROUND, 11);
  assert.deepEqual(PROTOCOL_LEVEL_ROUND_RAMP.map((s) => [s.from, s.k]),
    [[1, 0.45], [3, 0.6], [5, 0.8], [6, 1], [11, 1.2], [14, 1.35]]);
  assert.ok(Object.isFrozen(PROTOCOL_LEVEL_ROUND_RAMP), 'the ramp table is frozen');
  assert.equal(protocolLevelRoundK(1), 0.45);
  assert.equal(protocolLevelRoundK(2), 0.45);
  assert.equal(protocolLevelRoundK(3), 0.6);
  assert.equal(protocolLevelRoundK(5), 0.8);
  assert.equal(protocolLevelRoundK(6), 1, 'round 6 is the first full-strength round');
  assert.equal(protocolLevelRoundK(10), 1, 'and it holds through R10');
  assert.equal(protocolLevelRoundK(11), 1.2);
  assert.equal(protocolLevelRoundK(14), 1.35);
  assert.equal(protocolLevelRoundK(15), 1.35);
  // 不在对局回合里（0 / 负数 / 非整数 / 非数字）⇒ 旧的平曲线
  for (const bad of [0, -1, 2.5, null, undefined, NaN, '6']) assert.equal(protocolLevelRoundK(bad), 1, String(bad));
  // 随回合不减
  let prev = 0;
  for (let r = 1; r <= 15; r++) {
    const k = protocolLevelRoundK(r);
    assert.ok(k >= prev, `k never falls at R${r}`);
    prev = k;
  }
});

test('回合爬升：折入按增量缩放，前期削、R6 满额、后期加码', () => {
  const n18 = protocolLevelMods(18, 'ABYSS').enemy;
  assert.equal(n18.hpMul, 2.45, 'the table value is untouched');
  const at = (level, round) => protocolLevelEnemyMods(level, 'ABYSS', round).mods;
  assert.deepEqual(at(18, 1), { hpMul: 1.6525, atkMul: 1.396, defMul: 1.099, resMul: 1.0855, countAdd: 0 },
    'R1: the bonus is scaled by 0.45, and no extra bodies');
  assert.deepEqual(at(18, 3), { hpMul: 1.87, atkMul: 1.528, defMul: 1.132, resMul: 1.114, countAdd: 0 });
  assert.deepEqual(at(18, 5), { hpMul: 2.16, atkMul: 1.704, defMul: 1.176, resMul: 1.152, countAdd: 0 });
  // R6 起逐字节等于今天（表值 + 每波 +1）
  assert.deepEqual(at(18, 6), { hpMul: 2.45, atkMul: 1.88, defMul: 1.22, resMul: 1.19, countAdd: 1 }, 'R6 = the old curve');
  assert.deepEqual(at(18, 10), at(18, 6), 'and stays there through R10');
  // 后期加码：k > 1，数量再 +1
  assert.deepEqual(at(18, 11), { hpMul: 2.74, atkMul: 2.056, defMul: 1.264, resMul: 1.228, countAdd: 2 });
  assert.deepEqual(at(18, 14), { hpMul: 2.9575, atkMul: 2.188, defMul: 1.297, resMul: 1.2565, countAdd: 2 });
  // 一个等级在所有回合上「不低于 1」；R11 之前不超过表值，R6 起不再低于表值
  for (const row of PROTOCOL_LEVELS) {
    for (const round of [1, 3, 5, 6, 8, 11, 14]) {
      const m = at(row.level, round);
      assert.ok(m.hpMul >= 1, `L${row.level} R${round}: never below 1`);
      if (round < PROTOCOL_LEVEL_LATE_ROUND) assert.ok(m.hpMul <= row.enemy.hpMul + 1e-9, `L${row.level} R${round}: never above the table`);
      if (round >= PROTOCOL_LEVEL_FULL_ROUND) assert.ok(m.hpMul >= row.enemy.hpMul, `L${row.level} R${round}: full strength or more`);
    }
  }
  // 后期的加码真的落在表值之上（业主的「加强后期」）
  assert.ok(at(18, 14).hpMul > n18.hpMul, 'R14 is above the table value');
  assert.ok(at(18, 12).atkMul > n18.atkMul, 'R12 ATK is above the table value');
  // 同一回合上跨级单调（增量缩放保住了等级差别）
  for (const round of [1, 6, 14]) {
    for (let lv = 2; lv <= PROTOCOL_LEVEL_MAX; lv++) {
      assert.ok(at(lv, round).hpMul > at(lv - 1, round).hpMul, `R${round}: L${lv} still outweighs L${lv - 1}`);
    }
  }
  // countAdd 阶梯只对有数量的等级生效
  assert.deepEqual([1, 5, 6, 10, 11, 15].map((r) => protocolLevelCountAddAt(18, r)), [0, 0, 1, 1, 2, 2]);
  assert.equal(protocolLevelCountAddAt(17, 11), 0, 'levels without countAdd stay at 0');
  // 不传回合 ⇒ 与 2026-10-24 之前的输出一致（表值，不含爬升）
  assert.deepEqual(protocolLevelEnemyMods(18, 'ABYSS').mods, at(18, 6));
  assert.equal(protocolLevelEnemyMods(0, 'ABYSS', 6), null);
  assert.equal(protocolLevelEnemyMods(18, 'HARD', 6), null);
});

test('回合爬升：实战折入点读的是 m.round（预览与实战同一个 fold）', () => {
  const h = makeMatch({ mode: 'solo', difficulty: 'ABYSS', humans: 1, seed: 21, fake: true, protocolLevel: 18 });
  const m = h.m;
  m.round = 1;
  assert.equal(matchEnemyMods(m).hpMul, 1.6525, 'R1 folds the early ramp');
  m.round = 6;
  assert.deepEqual(matchEnemyMods(m), { hpMul: 2.45, atkMul: 1.88, defMul: 1.22, resMul: 1.19, countAdd: 1 }, 'R6 is the table again');
  m.round = 12;
  assert.equal(matchEnemyMods(m).hpMul, 2.74);
  assert.equal(matchEnemyMods(m).countAdd, 2, 'R11+ adds a second body');
  m.dispose();
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

// =====================================================================================================================
// N18 第 10 回合的彩蛋首领（业主 2026-10-22「n18难度增加第10回合会出现黑蛇或梅菲斯特」）
//
// 形态：**普通回合里额外刷一只**红蛇 / 梅菲斯特 —— 不碰最终攻势（没有共享血池、不合并团队 LP、R14 照常还是首领关）。
// 这一组钉住：抽签的边界（只有 ABYSS 18 级、只有 R10、种子决定哪一只）、注入是纯函数（不消耗 rngWaves、不改原 wave），
// 以及它在实战里真的出场、按普通敌人结算（漏掉照扣 LP、破坏完美作战）。
// =====================================================================================================================

test('N18 R10 彩蛋首领：只有 ABYSS 18 级、只有第 10 回合、种子决定哪一只', () => {
  assert.equal(PROTOCOL_LEVEL_EXTRA_BOSS_ROUND, 10);
  assert.equal(PROTOCOL_LEVEL_EXTRA_BOSS_LEVEL, 18);
  assert.deepEqual([...PROTOCOL_LEVEL_EXTRA_BOSSES], ['enemy_1515_bsnake', 'enemy_1507_mephi'], 'the two hand-added leaders');
  // 只在这一级：17 级与关闭都不出
  assert.equal(protocolLevelExtraBossAt(17, 10, 'ABYSS', 1), null, 'L17 stays as it was');
  assert.equal(protocolLevelExtraBossAt(0, 10, 'ABYSS', 1), null, 'level off');
  // 只在 R10
  for (const round of [1, 9, 11, 14, 15]) assert.equal(protocolLevelExtraBossAt(18, round, 'ABYSS', 1), null, `R${round} is not the round`);
  // 只在 ABYSS（等级本来就只在 ABYSS 生效，这里再钉一次实际调用点）
  for (const diff of ['FUNNY', 'NORMAL', 'HARD']) assert.equal(protocolLevelExtraBossAt(18, 10, diff, 1), null, diff);
  // 同一颗种子必然同一只；两种都抽得到
  for (const seed of [1, 2, 3, 4, 5, 6, 7, 8]) {
    const a = protocolLevelExtraBossAt(18, 10, 'ABYSS', seed);
    assert.equal(a, protocolLevelExtraBossAt(18, 10, 'ABYSS', seed), `seed ${seed} is deterministic`);
    assert.ok(PROTOCOL_LEVEL_EXTRA_BOSSES.includes(a), `seed ${seed}: ${a}`);
  }
  const seen = new Set();
  for (let seed = 0; seed < 20; seed++) seen.add(protocolLevelExtraBossAt(18, 10, 'ABYSS', seed));
  assert.equal(seen.size, 2, 'both leaders are reachable');
});

test('N18 R10 彩蛋首领：注入是纯函数 —— 不改原 wave、不消耗 rngWaves、非 18 级同一个对象', () => {
  const h = makeMatch({ mode: 'solo', difficulty: 'ABYSS', humans: 1, seed: 5, fake: true, protocolLevel: 18 });
  h.start();
  const m = h.m;
  m.round = 10;
  const base = buildNormalWave(m.gd, m.rngWaves, m.factions, 10);
  const before = JSON.stringify(base.spawns);
  const key = protocolLevelExtraBossAt(m.protocolLevel, 10, m.difficulty, m.seed);
  assert.ok(key, 'the premise: L18 has the extra leader');
  // 原 wave 一个字节都不动
  const wave = withExtraBoss(m.gd, base, key, 10);
  assert.notEqual(wave, base, 'a new object');
  assert.equal(JSON.stringify(base.spawns), before, 'the input wave is untouched');
  assert.equal(wave.spawns.length, base.spawns.length + 1, 'exactly one more spawn');
  const spec = wave.spawns[wave.spawns.length - 1];
  assert.equal(spec.enemyKey, key);
  assert.equal(spec.tag, 'boss');
  assert.equal(spec.count, 1, 'one body');
  assert.equal(spec.preview.boss, true, 'the client draws it as a leader at its start tile');
  assert.ok(Array.isArray(spec.preview.start), 'and knows its spawn tile');
  assert.equal(spec.mods.hpMul, undefined, 'leaders never take the round HP multiplier');
  assert.ok(spec.mods.atkMul > 1, 'but they do take ATK');
  // 没有它就原样返回同一个对象（0–17 级因此逐字节不变）
  assert.equal(withExtraBoss(m.gd, base, null, 10), base, 'no leader ⇒ the very same object');
  m.dispose();
});

test('N18 R10 彩蛋首领：不消耗 rngWaves —— R11–R14 的出怪表一动不动', () => {
  // 这条是这条规则的关键性质：`rngWaves` 是「本局每一轮出怪表」的同一条随机流，在 R10 多抽一次就会把后半局整体换一份。
  // 抽签走种子哈希（protocolLevelExtraBossAt），所以两种做法的后续流必须完全一致。
  const draw = (inject) => {
    const h = makeMatch({ mode: 'solo', difficulty: 'ABYSS', humans: 1, seed: 5, fake: true, protocolLevel: 18 });
    h.start();
    h.m.round = 10;
    const w = buildNormalWave(h.m.gd, h.m.rngWaves, h.m.factions, 10);
    // 关键：注入**不读也不推进** rngWaves —— 所以这里对 w 怎么处置都不影响后面的流。
    if (inject) withExtraBoss(h.m.gd, w, protocolLevelExtraBossAt(18, 10, 'ABYSS', h.m.seed), 10);
    const later = [11, 12, 13].map((r) => buildNormalWave(h.m.gd, h.m.rngWaves, h.m.factions, r).spawns);
    h.m.dispose();
    return JSON.stringify(later);
  };
  assert.equal(draw(true), draw(false), 'the next rounds are byte-identical with and without the injection');
});

test('N18 R10 彩蛋首领：实战里真的出场，按普通敌人结算（数据血量、漏掉照扣 LP）', () => {
  // 不用 `fake: true`：那一条走的是假战斗，不会真的出怪。
  const h = makeMatch({ mode: 'solo', difficulty: 'ABYSS', humans: 1, seed: 5, protocolLevel: 18 });
  h.start();
  const m = h.m;
  m.round = 10;
  const base = buildNormalWave(m.gd, m.rngWaves, m.factions, 10);
  const key = protocolLevelExtraBossAt(m.protocolLevel, 10, m.difficulty, m.seed);
  m.wave = withExtraBoss(m.gd, base, key, 10);
  const ps = h.ps('p_0');
  const b = m._normalBattle(ps);
  let spawned = null;
  b.on('enemySpawn', (c) => { if (c.enemy && c.enemy.defId === key) spawned = c.enemy; }, { priority: -1000, owner: 'test' });
  // 它 0 秒出场：推几步就够
  for (let i = 0; i < 90 && !b.finished; i++) b.step();
  assert.ok(spawned, 'the extra leader spawns');
  assert.equal(spawned.tag, 'boss', 'as a leader');
  assert.equal(spawned.isBoss, true);
  // 血量是数据表的值（不叠本回合 HP 倍率、也不叠 N18 的 bossPoolMul）
  const def = m.gd.enemy(key);
  assert.equal(Math.round(spawned.base.maxHp), Math.round(def.stats.maxHp), `${key}: data HP, unscaled`);
  // 它漏掉时**按普通敌人结算**：`battle/spawns.js` 让 tag 'boss' 的单位 `counted = false`（首领战有血池，不用这个计数），
  // 而 `_recordLeak` 写漏怪条目时用 `!!e.counted || e.isBoss` —— 于是它在漏怪表里 counted = true，settle 照扣 LP、
  // 也破坏完美作战。这正是「普通回合里多一只首领」该有的结算方式，用一次强制漏怪把它钉住。
  const before = b.result().perPlayer[ps.playerId]?.leaked?.length ?? 0;
  b.leak(spawned);
  const after = b.result().perPlayer[ps.playerId]?.leaked ?? [];
  assert.equal(after.length, before + 1, 'the leak is recorded');
  const row = after.find((l) => l.enemyKey === key);
  assert.ok(row, 'the leader is in the leaked list');
  assert.equal(row.counted, true, 'and it counts — settle charges LP and breaks 完美作战 for it');
  assert.equal(row.boss, true, 'flagged as a leader (the report draws it that way)');
  b.forceEnd('forced');
  b.result();
  m.dispose();
});

test('N18 R10 彩蛋首领：R10 之外、以及 18 级以外的回合，波次里没有它', () => {
  // 实战路径：MatchPhases.startRound 里接的是 protocolLevelExtraBossAt —— 这里守着它两侧的边界。
  const build = (level, round) => {
    const h = makeMatch({ mode: 'solo', difficulty: 'ABYSS', humans: 1, seed: 5, fake: true, protocolLevel: level });
    h.start();
    h.m.round = round;
    const key = protocolLevelExtraBossAt(h.m.protocolLevel, round, h.m.difficulty, h.m.seed);
    const wave = withExtraBoss(h.m.gd, buildNormalWave(h.m.gd, h.m.rngWaves, h.m.factions, round), key, round);
    const bosses = wave.spawns.filter((s) => s.tag === 'boss').length;
    h.m.dispose();
    return bosses;
  };
  assert.equal(build(18, 10), 1, 'L18 R10 has exactly one extra leader');
  assert.equal(build(18, 9), 0, 'R9 has none');
  assert.equal(build(18, 11), 0, 'R11 has none');
  assert.equal(build(17, 10), 0, 'L17 has none');
  assert.equal(build(0, 10), 0, 'level off has none');
});

// =====================================================================================================================
// 难度介绍（业主 2026-10-22「有人不知道n18的效果，增加难度介绍」）
//
// 界面上的那份清单不是手写的文案，而是 `protocolLevelEffects` 从表里现算出来的。这一组钉住三件事：
//   1. 每条说明都对应表里的**一个**字段 —— 表改了，说明跟着改；表里没有的，说明里不许出现；
//   2. 18 级独有的那一条（R10 彩蛋首领）必须在，且只出现在 18 级；
//   3. 每一个会被界面显示的 msgid 都在 `public/i18n/en.json` 里（这些 msgid 是运行时拼的，
//      tools/i18n.mjs 的字面量提取看不见它们 —— 漏了的表现是界面上直接显示中文原文）。
// =====================================================================================================================

test('难度介绍：每一级的逐条说明都从表里现算，18 级把「新东西」全列出来', () => {
  // 关闭 = 空
  assert.deepEqual(protocolLevelEffects(0), []);
  assert.equal(protocolLevelHeadline(0), null);

  // L1 只有爬升 + 生命 / 攻击三条（表里也只有这两个字段）
  assert.deepEqual(protocolLevelEffects(1).map((e) => e.id), ['ramp', 'hp', 'atk']);

  // L18 必须把表里每一个非默认字段都翻出来：回合爬升、生命/攻击/防御/法抗、每波 +1（R6 起、R11 起 +2）、漏怪 +2、
  // 收入 −3、首领池 +80%、三张敌方源石、以及 R10 的彩蛋首领。
  const l18 = protocolLevelEffects(18);
  assert.deepEqual(l18.map((e) => e.id),
    ['ramp', 'hp', 'atk', 'def', 'res', 'count', 'leakLp', 'income', 'bossPool', 'extraHex', 'extraBoss']);
  const byId = Object.fromEntries(l18.map((e) => [e.id, e]));
  assert.equal(byId.hp.params.v, '×2.45', 'the numbers come from the table, not from a literal');
  assert.equal(byId.atk.params.v, '×1.88');
  assert.equal(byId.ramp.params.end, PROTOCOL_LEVEL_FULL_ROUND - 1, 'the ramp line names the weakened window');
  assert.equal(byId.ramp.params.from, PROTOCOL_LEVEL_FULL_ROUND);
  assert.equal(byId.ramp.params.late, PROTOCOL_LEVEL_LATE_ROUND);
  assert.equal(byId.count.params.n, 1, 'L18 adds one body per wave from R6');
  assert.equal(byId.count.params.n2, 2, 'and a second one from R11');
  assert.equal(byId.count.params.from, PROTOCOL_LEVEL_FULL_ROUND);
  assert.equal(byId.count.params.late, PROTOCOL_LEVEL_LATE_ROUND);
  assert.equal(byId.leakLp.params.n, 2, 'and 2 extra LP per leak');
  assert.equal(byId.income.params.n, 3);
  assert.equal(byId.income.params.from, PROTOCOL_LEVEL_INCOME_FREE_ROUNDS + 1, 'the income penalty starts at round 8');
  assert.equal(byId.bossPool.params.v, '80%');
  assert.equal(byId.extraHex.params.n, 3);
  assert.equal(byId.extraHex.params.rounds, '1 / 3 / 5', 'spread over rounds 1 / 3 / 5');
  assert.equal(byId.extraBoss.params.round, PROTOCOL_LEVEL_EXTRA_BOSS_ROUND, 'and R10 carries the extra leader');

  // 18 级以外没有彩蛋首领那一条
  for (let lv = 1; lv < 18; lv++) {
    assert.equal(protocolLevelEffects(lv).some((e) => e.id === 'extraBoss'), false, `L${lv} has no extraBoss line`);
  }
  // 深潜区（13+）才有首领池 / 额外源石
  for (let lv = 1; lv < PROTOCOL_LEVEL_DEEP_FROM; lv++) {
    const ids = protocolLevelEffects(lv).map((e) => e.id);
    assert.equal(ids.includes('bossPool') || ids.includes('extraHex'), false, `L${lv} is not 深潜区`);
  }

  // 18 级最狠：每一条同级都比 17 级更重或一样（生命/攻击严格升，收入/漏怪不回头）
  const l17 = Object.fromEntries(protocolLevelEffects(17).map((e) => [e.id, e]));
  assert.equal(byId.hp.params.v !== l17.hp.params.v, true, 'HP differs from L17');
  assert.equal(byId.extraHex.params.n > l17.extraHex.params.n, true, 'and L18 has one more enemy hex');
});

test('难度介绍：每一个会显示的 msgid 都在四个语言包里，占位符一致', () => {
  const emitted = new Set();
  for (let lv = 1; lv <= PROTOCOL_LEVEL_MAX; lv++) {
    for (const e of protocolLevelEffects(lv)) emitted.add(e.msgid);
    const h = protocolLevelHeadline(lv);
    if (h) emitted.add(h.msgid);
  }
  // 清单本身不许漏（清单是给测试与四个语言包用的对照表）
  assert.deepEqual([...emitted].sort(), [...PROTOCOL_LEVEL_EFFECT_TEXT].sort(), 'PROTOCOL_LEVEL_EFFECT_TEXT lists every emitted msgid');
  const placeholders = (s) => (s.match(/\{[a-z]+\}/g) || []).sort().join(',');
  for (const lang of ['en', 'ja', 'ko', 'zh-TW']) {
    const pack = JSON.parse(readFileSync(path.join(ROOT, 'public/i18n', `${lang}.json`), 'utf8'));
    for (const msgid of emitted) {
      assert.equal(typeof pack[msgid], 'string', `${lang}.json is missing ${msgid}`);
      assert.equal(placeholders(pack[msgid]), placeholders(msgid), `${lang}.json: ${msgid} keeps its placeholders`);
      if (lang === 'en') assert.equal(/[\u4e00-\u9fff]/.test(pack[msgid].replace(/不死的黑蛇|梅菲斯特/g, '')), false, `en.json: ${msgid} has no Chinese left`);
    }
  }
});
