// test/content/hexcards-14a.test.js — 第十三批前五张卡的战斗脚本（server/sim/content/hexcards/batch14a.js）。
//
// 覆盖的卡（业主原文见 batch14a.js 文件头）：
//   hex_untouchable  你摸不到   —— 施放技能期间免疫伤害（skillStart 挂 invulnerable / skillEnd 摘）
//   hex_pearlglove   珠光护手   —— 己方干员的技能伤害 50% 几率 x3（hit 里改 dmg.mul，结算前）
//   hex_physarts     物法皆修   —— 每次攻击 +1 技力；技能每造成一次伤害 +10% ATK（上限 +300%，30 层）
//   hex_quantum      量子计算   —— 每 10s：最高攻干员 300% ATK 物理伤害 + 30% 减速 3s + 己方干员回 20% 最大生命
//   hex_frostghost   冰霜幽灵   —— 每 12s 束缚全场敌人 3s
//
// 驱动方式：真实的 Battle（test/helpers/battleHarness.js），卡片按生产路径的同一份 hexHooks(battle) 包安装
// （installX(hexHooks(battle))），效果 ref 的 params 形状与 server/match/hextech.js addHexRef 写进
// playerEffects 的一致。服务端把 installX 接进 hextech.js 的 installHexCards 后，这些脚本与生产完全同源；本套
// 测试直接调用 installX，所以不依赖那行集成先在本地存在。
//
// 每张卡至少三条：生效、边界（没有这张卡 / 不是拥有者的干员时不生效）、不无限递归（处理链不给自己再触发；
// 定时卡按间隔脉冲而不是每 tick）。全部断言跑在真实 sim 上：改坏 buff/damage/skill 管线会在这里红。

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { makeBattle, chessRec, enemyRec } from '../helpers/battleHarness.js';
import { hexHooks } from '../../server/sim/content/hexcards/hooks.js';
import {
  installUntouchable, installPearlGlove, installPhysArts, installQuantum, installFrostGhost,
} from '../../server/sim/content/hexcards/batch14a.js';

const HEXTECH = JSON.parse(readFileSync(new URL('../../data/hextech.json', import.meta.url), 'utf8'));
const IMPL = {
  hex_untouchable: installUntouchable, hex_pearlglove: installPearlGlove, hex_physarts: installPhysArts,
  hex_quantum: installQuantum, hex_frostghost: installFrostGhost,
};

/** data/hextech.json 里一张卡的 effect（params 的其余部分由 refOf 补）。 */
const effectOf = (hexId) => {
  const rec = HEXTECH.playerHexes[hexId];
  assert.ok(rec, 'data/hextech.json has no ' + hexId);
  return rec.effect;
};
/** 一条 playerEffects ref —— server/match/hextech.js addHexRef 的形状。 */
const refOf = (hexId) => {
  const rec = HEXTECH.playerHexes[hexId];
  return {
    id: 'hex:' + hexId, key: 'hex:' + hexId, name: rec.name, desc: rec.desc, iconKind: 'hex', iconId: rec.icon,
    params: { ...rec.effect, hexId, rarity: rec.rarity }, data: { hexId, rarity: rec.rarity },
  };
};

const guard = (o = {}) => chessRec({
  id: o.id ?? 'test_guard', profession: o.profession ?? 'WARRIOR',
  stats: { maxHp: 2000, atk: 500, def: 200, res: 0, blockCnt: 1, spRecovery: 0, ...(o.stats || {}) },
  skill: o.skill === undefined ? null : o.skill,
});
const strong = () => guard({ id: 'test_strong', stats: { atk: 3000 } });
const dummy = (o = {}) => enemyRec({ key: o.key ?? 'enemy_dummy', hp: o.hp ?? 100000, atk: o.atk ?? 0, speed: o.speed ?? 0, ...o });
const buffsOf = (u, key) => (u.buffs || []).filter((b) => b.key === key);
const opsOf = (h) => h.battle.allyUnits.filter((u) => u && u.kind === 'op' && u.side === 'ally');
const one = (h) => opsOf(h).find((u) => u.ownerId === 'p1') ?? opsOf(h)[0];

/**
 * 把卡片 ref 挂到造好（并且已经跑过 installContent）的战斗上。
 *
 * 生产路径是「ref 在战斗创建前就在 playerEffects 里 → install() 的 installHexCards 自己装脚本」。本套测试要拿
 * installX 的 handle 去数次数，所以 ref 在创建后才注入、脚本只由测试显式装一次；否则 install() 装一遍、测试再装
 * 一遍，每次攻击会结算两遍（物法皆修 +2 技力、珠光护手掷两次）。
 */
function inject(h, hexId, pid = 'p1') {
  const battle = h.battle;
  const player = (battle.players || []).find((p) => p && p.playerId === pid);
  if (!player) throw new Error('no player ' + pid);
  if (!Array.isArray(player.playerEffects)) player.playerEffects = [];
  player.playerEffects.push(refOf(hexId));
  return h;
}

/** 单玩家一场（p1）：units 走 harness 的顶层简写，卡片 ref 在创建后注入（见 inject）。 */
function solo({ hexId = null, units = [], enemies = [], routes = null, defs = {}, kits = null, timeLimit = 40 } = {}) {
  const h = makeBattle({
    defs: {
      chess: { test_guard: guard(), test_strong: strong(), ...(defs.chess || {}) },
      enemies: { enemy_dummy: dummy(), ...(defs.enemies || {}) },
      ...defs,
    },
    units,
    playerEffects: [],
    enemies, routes, kits,
    autoFinish: false, timeLimit,
  });
  return hexId ? inject(h, hexId, 'p1') : h;
}

/** 联防（unite）两人场：p1 持卡、p2 不持卡。 */
function pair({ hexId, units1, units2, defs = {}, enemies = [], kits = null, timeLimit = 40 }) {
  const h = makeBattle({
    kind: 'unite',
    defs: {
      chess: { test_guard: guard(), test_strong: strong(), ...(defs.chess || {}) },
      enemies: { enemy_dummy: dummy(), ...(defs.enemies || {}) },
      ...defs,
    },
    players: [
      { playerId: 'p1', seat: 0, side: 'L', colOffset: 0, bonds: {}, playerEffects: [], units: units1 },
      { playerId: 'p2', seat: 1, side: 'L', colOffset: 8, bonds: {}, playerEffects: [], units: units2 },
    ],
    enemies, kits, autoFinish: false, timeLimit,
  });
  return hexId ? inject(h, hexId, 'p1') : h;
}

// =====================================================================================================================
// data set guard: the numbers the scripts read are the ones the roster carries
// =====================================================================================================================

test('batch14a: the five records carry the spec keys the scripts read', () => {
  assert.equal(effectOf('hex_untouchable').untouchable, true, 'untouchable: true');
  assert.deepEqual(effectOf('hex_pearlglove').pearlglove, { chance: 50, mul: 300 });
  assert.deepEqual(effectOf('hex_physarts').physarts, { spOnAttack: 1, atkPctPerHit: 10, atkPctCap: 300 });
  assert.deepEqual(effectOf('hex_quantum').quantum, { every: 10, atkPct: 300, slowPct: 30, slowSec: 3, healPct: 20 });
  assert.deepEqual(effectOf('hex_frostghost').frostghost, { every: 12, bindSec: 3 });
});

test('batch14a: every installer is a no-op (returns 0) without its card or with a malformed bundle', () => {
  const h = solo({ units: [{ uid: 1, kind: 'chess', chessId: 'test_guard', row: 9, col: 6 }] });
  for (const [hexId, install] of Object.entries(IMPL)) {
    assert.equal(install(hexHooks(h.battle)), 0, hexId + ': no owner -> 0');
    assert.equal(install(undefined), 0, hexId + ': undefined bundle -> 0');
    assert.equal(install({}), 0, hexId + ': empty bundle -> 0');
    assert.equal(install({ battle: h.battle }), 0, hexId + ': bundle missing ownersOf -> 0');
  }
});

// =====================================================================================================================
// 你摸不到: 释放技能时免疫伤害
// =====================================================================================================================

const DURATION_KIT = () => ({ skill: { kind: 'duration', duration: 5, spCost: 0, spType: 'none', trigger: 'NEVER' } });
const INSTANT_KIT = () => ({ skill: { kind: 'instant', spCost: 0, spType: 'none', trigger: 'NEVER' } });

test('你摸不到: an own operator casting a duration skill takes no damage for its whole window', () => {
  const h = solo({
    hexId: 'hex_untouchable', units: [{ uid: 1, kind: 'chess', chessId: 'test_guard', row: 9, col: 6 }],
    kits: { test_guard: DURATION_KIT },
  });
  const inst = installUntouchable(hexHooks(h.battle));
  assert.equal(inst.owners, 1);
  h.run(0.2);
  const u = one(h);
  const hp0 = u.hp;
  assert.equal(u.skill.activate('manual', { free: true }), true, 'premise: the skill started');
  assert.equal(u.skill.active, true);
  assert.equal(buffsOf(u, 'hex:untouchable').length, 1, 'skillStart put the flag buff on');
  assert.equal(u.s.flags.invulnerable, true, 'the buff carries real damage immunity');
  assert.equal(h.battle.dealDamage(null, u, { amount: 500, type: 'true', canDodge: false }), 0, 'damage refused inside the window');
  assert.equal(u.hp, hp0, 'HP untouched');
  assert.equal(h.battle.errorCount, 0);

  h.run(5.2);
  assert.equal(u.skill.active, false, 'the duration ran out');
  assert.equal(buffsOf(u, 'hex:untouchable').length, 0, 'skillEnd took the flag buff off');
  assert.equal(u.s.flags.invulnerable, undefined, 'no leftover immunity');
  assert.equal(h.battle.dealDamage(null, u, { amount: 500, type: 'true', canDodge: false }), 500, 'damage lands after the window');
  assert.equal(u.hp, hp0 - 500);
  h.invariants();
});

test('你摸不到: without the card the same skill grants no immunity; an instant cast has no window', () => {
  // (a) no card
  const bare = solo({ units: [{ uid: 1, kind: 'chess', chessId: 'test_guard', row: 9, col: 6 }], kits: { test_guard: DURATION_KIT } });
  bare.run(0.2);
  const b = one(bare);
  b.skill.activate('manual', { free: true });
  assert.equal(bare.battle.dealDamage(null, b, { amount: 300, type: 'true', canDodge: false }), 300, 'no card -> no immunity');

  // (b) instant cast: activate() runs skillStart and skillEnd inside the same call, so the window is zero-wide
  const h = solo({
    hexId: 'hex_untouchable', units: [{ uid: 1, kind: 'chess', chessId: 'test_guard', row: 9, col: 6 }],
    kits: { test_guard: INSTANT_KIT },
  });
  installUntouchable(hexHooks(h.battle));
  h.run(0.2);
  const u = one(h);
  assert.equal(u.skill.activate('manual', { free: true }), true);
  assert.equal(u.skill.active, false, 'an instant skill is already over');
  assert.equal(buffsOf(u, 'hex:untouchable').length, 0, 'instant cast leaves no immunity [ASSUMED window]');
  assert.equal(h.battle.dealDamage(null, u, { amount: 300, type: 'true', canDodge: false }), 300, 'instant casts are not protected');
});

test('你摸不到: only the owner operators are protected on a 联防 field', () => {
  const h = pair({
    hexId: 'hex_untouchable',
    units1: [{ uid: 1, kind: 'chess', chessId: 'test_guard', row: 9, col: 6 }],
    units2: [{ uid: 2, kind: 'chess', chessId: 'test_guard', row: 10, col: 7 }],
    kits: { test_guard: DURATION_KIT },
  });
  installUntouchable(hexHooks(h.battle));
  h.run(0.2);
  const p1op = opsOf(h).find((u) => u.ownerId === 'p1');
  const p2op = opsOf(h).find((u) => u.ownerId === 'p2');
  assert.ok(p1op && p2op && p2op.deployed, 'both boards are on the field');
  p1op.skill.activate('manual', { free: true });
  p2op.skill.activate('manual', { free: true });
  assert.equal(h.battle.dealDamage(null, p1op, { amount: 400, type: 'true', canDodge: false }), 0, 'p1 (owner) is immune');
  assert.equal(h.battle.dealDamage(null, p2op, { amount: 400, type: 'true', canDodge: false }), 400, 'p2 (not the owner) is not');
  assert.equal(h.battle.errorCount, 0);
});

// =====================================================================================================================
// 珠光护手: 你的技能有 50% 概率伤害提升至 300%（原 30% / 200%，业主 2026-10-20 改版）
// =====================================================================================================================

/** Deal n physical instances from src to e and return the dealt amounts. */
function strike(b, src, e, n, isSkill) {
  const out = [];
  for (let i = 0; i < n; i++) out.push(b.dealDamage(src, e, { amount: 100, type: 'phys', isSkill }));
  return out;
}

test('珠光护手: skill damage crits for x3 about 50 % of the time — no extra damage instances', () => {
  const h = solo({
    hexId: 'hex_pearlglove', defs: { enemies: { enemy_dummy: dummy({ hp: 1e7 }) } },
    units: [{ uid: 1, kind: 'chess', chessId: 'test_guard', row: 9, col: 6 }],
  });
  const inst = installPearlGlove(hexHooks(h.battle));
  assert.equal(inst.owners, 1);
  let damaged = 0;
  h.battle.on('damaged', ({ source }) => { if (source && source.kind === 'op') damaged++; });
  h.run(0.2);
  const u = one(h);
  const e = h.spawn('enemy_dummy', { pos: [11, 6] });
  const N = 1000;
  const rolls = strike(h.battle, u, e, N, true);
  const crits = rolls.filter((v) => Math.abs(v - 300) < 1e-9).length;
  assert.equal(crits + rolls.filter((v) => Math.abs(v - 100) < 1e-9).length, N, 'every instance is normal or x3, never a second added hit');
  assert.equal(damaged, N, 'one damaged event per input instance: the crit is the same instance');
  assert.ok(crits > 420 && crits < 580, '50 % of 1000 -> ~500 crits (got ' + crits + '); battle.rng keeps this deterministic');
  assert.equal(inst.crits, crits, 'the handle counts the same crits');
  assert.equal(h.battle.errorCount, 0);

  const plain = strike(h.battle, u, e, 200, false);
  assert.ok(plain.every((v) => Math.abs(v - 100) < 1e-9), 'isSkill false -> never x3');
});

test('珠光护手: no card and other players operators are not critted (boundaries)', () => {
  const bare = solo({
    defs: { enemies: { enemy_dummy: dummy({ hp: 1e7 }) } },
    units: [{ uid: 1, kind: 'chess', chessId: 'test_guard', row: 9, col: 6 }],
  });
  bare.run(0.2);
  const bu = one(bare);
  const be = bare.spawn('enemy_dummy', { pos: [11, 6] });
  assert.ok(strike(bare.battle, bu, be, 200, true).every((v) => Math.abs(v - 100) < 1e-9), 'no card -> all normal hits');

  const h = pair({
    hexId: 'hex_pearlglove', defs: { enemies: { enemy_dummy: dummy({ hp: 1e7 }) } },
    units1: [{ uid: 1, kind: 'chess', chessId: 'test_guard', row: 9, col: 6 }],
    units2: [{ uid: 2, kind: 'chess', chessId: 'test_guard', row: 10, col: 7 }],
  });
  installPearlGlove(hexHooks(h.battle));
  h.run(0.2);
  const p2op = opsOf(h).find((u) => u.ownerId === 'p2');
  const e = h.spawn('enemy_dummy', { pos: [11, 10] });
  assert.ok(strike(h.battle, p2op, e, 200, true).every((v) => Math.abs(v - 100) < 1e-9), 'p2 (no card) never crits');
});

// =====================================================================================================================
// 物法皆修: 每次攻击 +1 技力；技能每造成一次伤害攻击力 +10%（最高 +300%）
// =====================================================================================================================

const SP_DUMMY = () => dummy({ speed: 4 }); // 快速走进阻挡位，让干员真的打出普攻
const SP_SKILL = { spCost: 100, initSp: 0, spType: 'NONE', duration: 0, trigger: { rule: 'NEVER' } };

test('物法皆修: every own attack restores 1 SP (and 0 without the card)', () => {
  const h = solo({
    hexId: 'hex_physarts',
    defs: { enemies: { enemy_dummy: SP_DUMMY() }, chess: { test_guard: guard({ skill: SP_SKILL }) } },
    units: [{ uid: 1, kind: 'chess', chessId: 'test_guard', row: 9, col: 6 }],
    enemies: [{ key: 'enemy_dummy', time: 0, route: 0 }],
  });
  const inst = installPhysArts(hexHooks(h.battle));
  h.run(0.2);
  const u = one(h);
  assert.equal(u.skill.sp, 0, 'premise: no SP of its own (spType none, spRecovery 0)');
  assert.equal(h.runUntil(() => h.hooks.attack.length >= 3, 20), true, 'the operator attacked at least three times');
  const attacks = h.hooks.attack.length;
  assert.equal(u.skill.sp, attacks, 'exactly 1 SP per attack, nothing else');
  assert.equal(inst.spGained, attacks);
  assert.equal(h.battle.errorCount, 0);

  const bare = solo({
    defs: { enemies: { enemy_dummy: SP_DUMMY() }, chess: { test_guard: guard({ skill: SP_SKILL }) } },
    units: [{ uid: 1, kind: 'chess', chessId: 'test_guard', row: 9, col: 6 }],
    enemies: [{ key: 'enemy_dummy', time: 0, route: 0 }],
  });
  bare.runUntil(() => bare.hooks.attack.length >= 3, 20);
  assert.ok(bare.hooks.attack.length >= 3, 'premise: the same attacks happen');
  assert.equal(one(bare).skill.sp, 0, 'no card -> no SP');
});

test('物法皆修: skill damage stacks +10 % ATK per instance, capped at 30 stacks (+300 %)', () => {
  const h = solo({
    hexId: 'hex_physarts', defs: { enemies: { enemy_dummy: dummy({ hp: 1e7 }) } },
    units: [{ uid: 1, kind: 'chess', chessId: 'test_guard', row: 9, col: 6 }],
  });
  const inst = installPhysArts(hexHooks(h.battle));
  h.run(0.2);
  const u = one(h);
  const e = h.spawn('enemy_dummy', { pos: [11, 6] });
  assert.equal(u.s.atk, 500, 'base ATK');
  const deal = (n, isSkill) => { for (let i = 0; i < n; i++) h.battle.dealDamage(u, e, { amount: 10, type: 'true', isSkill }); };

  deal(3, true);
  assert.equal(buffsOf(u, 'hex:physarts').length, 1, 'one stacking buff');
  assert.equal(u.findBuff('hex:physarts').stacks, 3);
  assert.ok(Math.abs(u.s.atk - 650) < 1e-9, '3 x 10 % -> 500 x 1.3 = 650 (got ' + u.s.atk + ')');

  deal(40, true);
  assert.equal(u.findBuff('hex:physarts').stacks, 30, 'capped at atkPctCap / atkPctPerHit = 30 stacks');
  assert.ok(Math.abs(u.s.atk - 2000) < 1e-9, '+300 % -> 500 x 4 = 2000 (got ' + u.s.atk + ')');
  assert.equal(inst.stacks, 30, 'the buff was granted 30 times; later hits are already capped (each grant is one stack)' );

  deal(5, false);
  assert.equal(u.findBuff('hex:physarts').stacks, 30, 'non-skill damage adds nothing');
  const bare = solo({
    defs: { enemies: { enemy_dummy: dummy({ hp: 1e7 }) } },
    units: [{ uid: 1, kind: 'chess', chessId: 'test_guard', row: 9, col: 6 }],
  });
  bare.run(0.2);
  const bu = one(bare);
  const be = bare.spawn('enemy_dummy', { pos: [11, 6] });
  for (let i = 0; i < 10; i++) bare.battle.dealDamage(bu, be, { amount: 10, type: 'true', isSkill: true });
  assert.equal(buffsOf(bu, 'hex:physarts').length, 0, 'no card -> no buff');
  assert.equal(bu.s.atk, 500);
  assert.equal(h.battle.errorCount, 0);
});

test('物法皆修: a teammates operator gains nothing (联防 ownership boundary), no nested damage', () => {
  const h = pair({
    hexId: 'hex_physarts', defs: { enemies: { enemy_dummy: dummy({ hp: 1e7 }) } },
    units1: [{ uid: 1, kind: 'chess', chessId: 'test_guard', row: 9, col: 6 }],
    units2: [{ uid: 2, kind: 'chess', chessId: 'test_strong', row: 10, col: 7 }],
  });
  installPhysArts(hexHooks(h.battle));
  h.run(0.2);
  const p1op = opsOf(h).find((u) => u.ownerId === 'p1');
  const p2op = opsOf(h).find((u) => u.ownerId === 'p2');
  const e = h.spawn('enemy_dummy', { pos: [11, 10] });
  for (let i = 0; i < 3; i++) h.battle.dealDamage(p2op, e, { amount: 10, type: 'true', isSkill: true });
  assert.equal(buffsOf(p2op, 'hex:physarts').length, 0, 'p2 does not own the card');
  assert.equal(buffsOf(p1op, 'hex:physarts').length, 0, 'and its damage never buffs a teammate');
  for (let i = 0; i < 3; i++) h.battle.dealDamage(p1op, e, { amount: 10, type: 'true', isSkill: true });
  assert.equal(p1op.findBuff('hex:physarts').stacks, 3, 'the owner own operator does stack');
  assert.equal(buffsOf(p2op, 'hex:physarts').length, 0);
  assert.equal(h.battle.errorCount, 0);
});

// =====================================================================================================================
// 量子计算: 每 10 秒对全场敌人造成最高攻干员 300% ATK 物理伤害 + 30% 减速 3s + 回复 20% 最大生命
// =====================================================================================================================

test('量子计算: every 10 s a pulse hits all living enemies, slows them 3 s and heals own operators 20 % max HP', () => {
  const h = solo({
    hexId: 'hex_quantum', defs: { enemies: { enemy_dummy: dummy() } },
    units: [{ uid: 1, kind: 'chess', chessId: 'test_guard', row: 9, col: 6 }],
  });
  const inst = installQuantum(hexHooks(h.battle));
  assert.equal(inst.owners, 1);
  let pulses = 0;
  h.battle.on('damaged', ({ dmg }) => { if (dmg && dmg.tags && dmg.tags.includes('hexQuantum')) pulses++; });
  h.run(0.2);
  const u = one(h);
  const e = h.spawn('enemy_dummy', { pos: [9, 16] });
  assert.equal(e.hp, 100000);
  u.hp = 1000; // 50 % — so the 20 %-max-HP heal is visible
  const hp0 = u.hp;

  h.run(9.7); // t = 9.9
  assert.equal(e.hp, 100000, 'nothing before the first 10 s');
  assert.equal(buffsOf(e, 'slow').length, 0);
  assert.equal(u.hp, hp0);

  h.run(0.4); // t = 10.3
  assert.equal(inst.pulses, 1);
  assert.ok(Math.abs(e.hp - 98500) < 1e-6, '500 ATK x 300 % = 1500 physical (loss ' + (100000 - e.hp) + ')');
  const slow = e.findBuff('slow');
  assert.ok(slow, 'the slow status landed');
  assert.ok(Math.abs(slow.mods.moveMul - 0.7) < 1e-9, '30 % slow -> moveMul 0.7 (got ' + slow.mods.moveMul + ')');
  assert.ok(slow.timeLeft > 2.5 && slow.timeLeft <= 3, '3 s slow (timeLeft ' + slow.timeLeft + ')');
  assert.ok(Math.abs(u.hp - 1400) < 1e-9, '1000 + 20 % x 2000 = 1400 (got ' + u.hp + ')');
  assert.equal(h.battle.errorCount, 0);

  h.run(10); // t = 20.3
  assert.equal(inst.pulses, 2, 'one pulse per 10 s — not per tick');
  assert.ok(Math.abs(e.hp - 97000) < 1e-6, 'second pulse: another 1500');
  assert.equal(pulses, 2, 'exactly one quantum damage instance per pulse (no recursion)');
  h.invariants();
});

test('量子计算: no card -> no pulse, no slow, no heal (boundary)', () => {
  const h = solo({
    defs: { enemies: { enemy_dummy: dummy() } },
    units: [{ uid: 1, kind: 'chess', chessId: 'test_guard', row: 9, col: 6 }],
  });
  assert.equal(installQuantum(hexHooks(h.battle)), 0, 'no owner -> installer returns 0');
  h.run(0.2);
  const u = one(h);
  const e = h.spawn('enemy_dummy', { pos: [9, 16] });
  u.hp = 1000;
  h.run(10.5);
  assert.equal(e.hp, 100000, 'no damage');
  assert.equal(buffsOf(e, 'slow').length, 0, 'no slow');
  assert.equal(u.hp, 1000, 'no heal');
  assert.equal(h.battle.errorCount, 0);
});

test('量子计算: it uses the OWNER highest-ATK operator only and heals only the owner operators (联防)', () => {
  const h = pair({
    hexId: 'hex_quantum', defs: { enemies: { enemy_dummy: dummy() } },
    units1: [{ uid: 1, kind: 'chess', chessId: 'test_guard', row: 9, col: 6 }],
    units2: [{ uid: 2, kind: 'chess', chessId: 'test_strong', row: 10, col: 7 }],
  });
  installQuantum(hexHooks(h.battle));
  const seen = [];
  h.battle.on('damaged', (c) => { if (c.dmg && c.dmg.tags && c.dmg.tags.includes('hexQuantum')) seen.push(c); });
  h.run(0.2);
  const p1op = opsOf(h).find((u) => u.ownerId === 'p1');
  const p2op = opsOf(h).find((u) => u.ownerId === 'p2');
  assert.equal(p2op.s.atk, 3000, 'premise: p2 has the stronger operator');
  p2op.hp = 1000;
  const e = h.spawn('enemy_dummy', { pos: [9, 16] });
  h.run(10.2);
  assert.equal(e.hp, 100000 - 1500, 'the pulse used the owner 500-ATK operator, not the teammate 3000-ATK one');
  assert.equal(seen.length, 1, 'premise: one quantum instance');
  assert.equal(seen[0].source, p1op, 'the pulse comes from the owner own strongest operator');
  assert.ok(Math.abs(seen[0].amount - 1500) < 1e-6, '500 x 300 % = 1500 (got ' + seen[0].amount + ')');
  assert.equal(p2op.hp, 1000, 'the teammate operator is not healed by p1 card');
});

// =====================================================================================================================
// 冰霜幽灵: 每 12 秒束缚全场敌人 3 秒
// =====================================================================================================================

const WALK_ROUTES = [
  { motion: 'WALK', start: [9, 18], end: [9, 2], checkpoints: [] },
  { motion: 'WALK', start: [12, 18], end: [12, 2], checkpoints: [] },
];
const walker = (key) => dummy({ key, speed: 0.2 });

test('冰霜幽灵: every 12 s binds every living enemy for 3 s; they cannot move, then resume', () => {
  const h = solo({
    hexId: 'hex_frostghost',
    defs: { enemies: { enemy_w1: walker('enemy_w1'), enemy_w2: walker('enemy_w2') } },
    units: [{ uid: 1, kind: 'chess', chessId: 'test_guard', row: 10, col: 10 }],
    routes: WALK_ROUTES,
    enemies: [{ key: 'enemy_w1', time: 0, route: 0 }, { key: 'enemy_w2', time: 0, route: 1 }],
    timeLimit: 60,
  });
  const inst = installFrostGhost(hexHooks(h.battle));
  assert.equal(inst.owners, 1);
  h.run(0.2);
  const op = one(h);
  h.run(12); // t = 12.2
  const es = h.enemies();
  assert.equal(es.length, 2, 'premise: both enemies are alive');
  assert.equal(inst.binds, 1);
  for (const e of es) {
    const bind = e.findBuff('bind');
    assert.ok(bind, e.defId + ' is bound');
    assert.equal(bind.flags && bind.flags.noMove, true, 'bind carries noMove (engine status)');
    assert.ok(bind.timeLeft > 2.6 && bind.timeLeft <= 3, '3 s (timeLeft ' + bind.timeLeft + ')');
  }
  assert.equal(buffsOf(op, 'bind').length, 0, 'own operators are not bound');

  const pos = es.map((e) => [e.x, e.y]);
  h.run(2); // still inside the 3 s window
  assert.ok(es.every((e, i) => Math.abs(e.x - pos[i][0]) < 1e-9 && Math.abs(e.y - pos[i][1]) < 1e-9), 'bound enemies do not move');

  h.run(1.5); // t = 15.7 — window over
  assert.ok(es.every((e) => buffsOf(e, 'bind').length === 0), 'bind expired');
  const before = es.map((e) => e.x);
  h.run(1);
  assert.ok(es.every((e, i) => Math.abs(e.x - before[i]) > 1e-6), 'they walk again after the bind');

  h.run(8); // t = 24.7 — second pulse
  assert.equal(inst.binds, 2, 'the timer repeats every 12 s');
  assert.ok(h.enemies().every((e) => !!e.findBuff('bind')), 'second bind on every living enemy');
  assert.equal(h.battle.errorCount, 0);
  h.invariants();
});

test('冰霜幽灵: no card -> no bind, and no pulse storm (boundary / no recursion)', () => {
  const h = solo({
    defs: { enemies: { enemy_w1: walker('enemy_w1') } },
    units: [{ uid: 1, kind: 'chess', chessId: 'test_guard', row: 10, col: 10 }],
    routes: WALK_ROUTES, enemies: [{ key: 'enemy_w1', time: 0, route: 0 }], timeLimit: 60,
  });
  assert.equal(installFrostGhost(hexHooks(h.battle)), 0, 'no owner -> installer returns 0');
  h.run(12.2);
  assert.equal(h.enemies().every((e) => buffsOf(e, 'bind').length === 0), true, 'no card -> no bind');
  assert.equal(h.battle.errorCount, 0);
});
