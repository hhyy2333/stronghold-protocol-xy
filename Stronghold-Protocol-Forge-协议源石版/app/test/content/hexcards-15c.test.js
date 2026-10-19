// test/content/hexcards-15c.test.js — 第十四批敌方侧五张 verb 卡（业主 2026-10-19）。
//
// 业主原文（逐字）：
//   增益无效3阶：每隔20s干员属性增益无效3s
//   流星3阶：敌人获得30%物理闪避
//   窃贼2阶：干员被击倒时下回合减少2%金钱（最多30%）
//   通缉令2阶：每场战斗随机增加一个1~5块（惊变里的）的敌人
//   通厕大队3阶；战斗增加3个杰斯顿属性为原来的（2+6x%，x为回合数）
//
// These drive `flags.enemyHexIds`, the exact field a real match writes (server/match/match/battleOpts.js), so a card
// reaches a battle the way it does in production.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { makeBattle, chessRec, enemyRec } from '../helpers/battleHarness.js';

const HEXTECH = JSON.parse(readFileSync(new URL('../../data/hextech.json', import.meta.url), 'utf8'));
const rec = (id) => HEXTECH.enemyHexes[id];

const guard = (o = {}) => chessRec({
  id: o.id ?? 'test_guard', profession: 'WARRIOR',
  stats: { maxHp: 4000, atk: 300, def: 200, res: 20, blockCnt: 1, spRecovery: 0 },
  skill: null,
});
const marcher = (o = {}) => enemyRec({ key: o.key ?? 'enemy_march', hp: o.hp ?? 100000, atk: o.atk ?? 100, def: 0, speed: o.speed ?? 1, ...o });
const opsOf = (h) => h.battle.allyUnits.filter((u) => u && u.kind === 'op' && u.side === 'ally');

/** A battle with one enemy verb installed through the REAL flag channel. */
function verbBattle(hexId, { enemyKey = 'enemy_march', enemyKeys = null, flags = null, round = 1, ...opts } = {}) {
  const keys = enemyKeys || [enemyKey];
  const rows = keys.map((key, i) => ({ key, time: 0, route: 0, ...(i ? { pos: [10 + i, 6] } : {}) }));
  return makeBattle({
    defs: { chess: { test_guard: guard() }, enemies: { enemy_march: marcher(), enemy_dummy: marcher({ key: 'enemy_dummy' }), ...(opts.defs && opts.defs.enemies ? opts.defs.enemies : {}) } },
    units: [(opts.unit ?? { uid: 1, kind: 'chess', chessId: 'test_guard', row: 9, col: 6 })],
    playerEffects: [],
    enemies: rows,
    round,
    autoFinish: false,
    timeLimit: opts.timeLimit ?? 30,
    flags: flags ?? { enemyHexIds: [hexId] },
    ...opts,
  });
}

// =====================================================================================================================
// data guard: the five records and their verbs
// =====================================================================================================================

test('batch15 enemy: the five records carry their verb and params', () => {
  assert.equal(rec('ehex_buffvoid').verb, 'buffVoid');
  assert.deepEqual(rec('ehex_buffvoid').params, { period: 20, seconds: 3 });
  assert.equal(rec('ehex_meteor').verb, 'physDodge');
  assert.deepEqual(rec('ehex_meteor').params, { chance: 0.3 });
  assert.equal(rec('ehex_thief').verb, 'thief');
  assert.deepEqual(rec('ehex_thief').params, { perDeathPct: 2, capPct: 30 });
  assert.equal(rec('ehex_wanted').verb, 'wanted');
  // 业主 2026-10-19 追加：「悬赏令前5回合不出现4，5块的怪」—— earlyRounds / earlyMaxCoin 是那条限制
  assert.deepEqual(rec('ehex_wanted').params, { minCoin: 1, maxCoin: 5, earlyRounds: 5, earlyMaxCoin: 3 });
  assert.equal(rec('ehex_jekyll').verb, 'jekyllSquad');
  assert.equal(rec('ehex_jekyll').params.enemyKey, 'enemy_1516_jakill');
  assert.equal(rec('ehex_jekyll').params.count, 3);
});

// =====================================================================================================================
// 流星: 敌人 30% 物理闪避
// =====================================================================================================================

test('流星: every spawned enemy carries the physical dodge buff', () => {
  const h = verbBattle('ehex_meteor');
  h.run(0.5);
  const enemies = h.battle.enemies.filter((e) => e && e.alive);
  assert.ok(enemies.length > 0, 'premise: an enemy is on the field');
  for (const e of enemies) {
    assert.ok(e.findBuff('hexverb:physdodge'), 'the enemy carries the dodge buff');
    assert.ok(Math.abs(e.s.dodgePhys - 0.3) < 1e-9, 'dodge is 30%, got ' + e.s.dodgePhys);
  }
});

test('流星: without the card no enemy has the dodge', () => {
  const h = verbBattle('ehex_venom');   // a different verb: the same spawn path, no dodge
  h.run(0.5);
  for (const e of h.battle.enemies.filter((x) => x && x.alive)) assert.equal(e.s.dodgePhys, 0);
});

// =====================================================================================================================
// 通厕大队: 3 个杰斯顿，属性 (2 + 6x)%，x = 回合
// =====================================================================================================================

test('通厕大队: three Jesseltons spawn, scaled to (2 + 6x)% of their stats', () => {
  const JAK = { key: 'enemy_1516_jakill', maxHp: 10000, atk: 1000, def: 500, res: 40, moveSpeed: 0.6, bat: 4, aspd: 100, rangeRadius: 2, blockCnt: 1, massLevel: 6, lpr: 2 };
  for (const round of [1, 5]) {
    const h = verbBattle('ehex_jekyll', { round, enemyKeys: ['enemy_march'], defs: { enemies: { enemy_1516_jakill: JAK } } });
    h.run(0.5);
    // a spawned unit carries its record on `def.key` / `defId`, not a `key` property
    const isJak = (e) => !!e && ((e.def && e.def.key === 'enemy_1516_jakill') || e.defId === 'enemy_1516_jakill');
    const jak = h.battle.enemies.filter(isJak);
    assert.equal(jak.length, 3, 'round ' + round + ': three Jesseltons, got ' + jak.length);
    const pct = (2 + 6 * round) / 100;
    for (const e of jak) {
      assert.ok(Math.abs(e.s.maxHp - 10000 * pct) < 1e-6, 'round ' + round + ': maxHp scaled, got ' + e.s.maxHp);
      assert.ok(Math.abs(e.s.atk - 1000 * pct) < 1e-6, 'round ' + round + ': atk scaled, got ' + e.s.atk);
    }
  }
});

test('通厕大队: without the card no Jesselton appears', () => {
  const JAK = { key: 'enemy_1516_jakill', maxHp: 10000, atk: 1000, def: 500, res: 40, moveSpeed: 0.6, bat: 4, aspd: 100, rangeRadius: 2, blockCnt: 1, massLevel: 6, lpr: 2 };
  const h = verbBattle('ehex_venom', { round: 5, defs: { enemies: { enemy_1516_jakill: JAK } } });
  h.run(0.5);
  const isJak = (e) => !!e && ((e.def && e.def.key === 'enemy_1516_jakill') || e.defId === 'enemy_1516_jakill');
  assert.equal(h.battle.enemies.filter(isJak).length, 0);
});

// =====================================================================================================================
// 增益无效: 每 20s 属性增益失效 3s
// =====================================================================================================================

test('增益无效: a stat buff on an own operator is gone during the mute window and back after it', () => {
  const h = verbBattle('ehex_buffvoid');
  h.run(0.5);
  const u = opsOf(h)[0];
  assert.ok(u, 'premise: an operator');
  // a stat buff the card may strip
  h.battle.addBuff(u, { key: 'test:atk', duration: 999, mods: { atkPct: 0.5 } });
  assert.ok(u.findBuff('test:atk'), 'premise: the buff is on');
  const atkBefore = u.s.atk;
  // the first mute lands one period in (20 s)
  h.run(20.5);
  assert.equal(u.findBuff('test:atk'), null, 'the stat buff is stripped by the mute');
  assert.ok(u.s.atk < atkBefore, 'and the ATK dropped with it');
  // … and comes back when the 3 s window ends
  h.run(3.2);
  assert.ok(u.findBuff('test:atk'), 'the buff is restored after the window');
  assert.ok(Math.abs(u.s.atk - atkBefore) < 1e-6, 'the ATK is back');
});

test('增益无效: a buff with no mods (a pure flag buff) is NOT an 属性增益 and stays', () => {
  const h = verbBattle('ehex_buffvoid');
  h.run(0.5);
  const u = opsOf(h)[0];
  h.battle.addBuff(u, { key: 'test:flag', duration: 999, flags: { reveal: true } });
  h.run(20.5);
  assert.ok(u.findBuff('test:flag'), 'a flag-only buff survives the mute');
});

// =====================================================================================================================
// 窃贼: 干员被击倒 -> 下回合收入 -2%（最多 30%）
// =====================================================================================================================

test('窃贼: the battle counts own operators knocked out (the prep half reads this)', () => {
  const h = verbBattle('ehex_thief');
  h.run(0.5);
  assert.equal(h.battle._hexThiefDeaths, 0, 'nothing knocked out yet');
  const u = opsOf(h)[0];
  h.battle.kill(u, null);
  assert.equal(h.battle._hexThiefDeaths, 1, 'one knocked-out operator counted');
});

test('窃贼: a retreat / a leak is not 被击倒 and is not counted', () => {
  const h = verbBattle('ehex_thief');
  h.run(0.5);
  const u = opsOf(h)[0];
  h.battle.retreat(u);
  assert.equal(h.battle._hexThiefDeaths, 0, 'a retreat is not a knock-out');
});

test('窃贼: without the card nothing is counted', () => {
  const h = verbBattle('ehex_venom');
  h.run(0.5);
  h.battle.kill(opsOf(h)[0], null);
  assert.equal(h.battle._hexThiefDeaths, undefined, 'no counter without the card');
});

