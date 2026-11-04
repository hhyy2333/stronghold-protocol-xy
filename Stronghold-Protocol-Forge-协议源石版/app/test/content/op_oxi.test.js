// test/content/op_oxi.test.js — the 自选 operator kit of 塔露拉 (char_4247_oxi, 6★ 近卫·本源近卫; kit
// server/sim/content/kits/ops/op-oxi.js), fielded the production way (a DIY slot + its `diy` pick, simdata getDiy) in
// every form: tiers 5 / 6, normal (E2 Lv1, skill rank 4) and elite (E2 Lv60, rank 7) — she has no module, so every form
// fights 不装备模组 — × all three skills. Every number is read back from data/backups.json (the form of that slot
// status); the fidelity checklist of kits/README.md item by item.
// Run: node --test test/content/op_oxi.test.js

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { makeBattle, enemyRec, checkInvariants } from '../helpers/battleHarness.js';
import { KITTED_CHARS, OPERATOR_KITS, KITS } from '../../server/sim/content/kits/index.js';
import { diyPool, validateDiyPicks } from '../../shared/diy.js';

const load = (f) => JSON.parse(readFileSync(new URL(`../../data/${f}.json`, import.meta.url), 'utf8'));
const CHESS = load('chess');
const BACKUPS = load('backups');
const OXI = 'char_4247_oxi';
const FORMS = BACKUPS.units[OXI].forms;
const SLOT = { 5: 'chess_char_5_diy1_a', 6: 'chess_char_6_diy1_a' };
const S1 = 'skchr_oxi_1', S2 = 'skchr_oxi_2', S3 = 'skchr_oxi_3';
/** The unit form of a slot (tier, normal / elite). */
const formOf = (tier, elite) => FORMS[elite ? (tier === 5 ? '2/60/7/1' : '2/60/7/3') : '2/1/4/0'];
const skillOf = (tier, elite, id) => formOf(tier, elite).skills.find((s) => s.skillId === id);
const approx = (a, b, msg, eps = 1e-6) => assert.ok(Math.abs(a - b) <= eps * Math.max(1, Math.abs(b)), `${msg}: ${a} vs ${b}`);
const dummy = (key, o = {}) => enemyRec({ key, hp: 1e9, speed: 0, mass: 0, ...o });
const ENEMIES = {
  enemy_dummy: dummy('enemy_dummy'),
  enemy_fly: dummy('enemy_fly', { motion: 'FLY' }),
  enemy_walk: enemyRec({ key: 'enemy_walk', hp: 1e9, atk: 100, speed: 0.6, mass: 0 }),
  enemy_hitter: dummy('enemy_hitter', { atk: 1000, range: 1 }),
  // a ranged attacker: it hits her from 2 tiles away while staying UNBLOCKED — the only 隐匿 state that can attack her
  // (a blocked enemy is not 隐匿, targeting.js enemyStealthed), which is exactly the case of the owner's report
  enemy_sniper: dummy('enemy_sniper', { atk: 200, range: 3 }),
};
/** Every 自选 form she can be fielded in: no module exists, so [tier, elite] only. */
const FORMS_ALL = [[5, false], [6, false], [5, true], [6, true]];
/** The four tiles a walker crosses to reach her from the flat stage's east lane. */
const lane = { motion: 'WALK', start: [10, 9], end: [10, 2], checkpoints: [] };

/** A battle with 塔露拉 as uid 1 at (row, col) facing RIGHT, plus the given spawns; returns her unit. */
function field({ tier = 5, elite = false, skill = 2, row = 10, col = 5, enemies = [], seed = 5 } = {}) {
  const h = makeBattle({
    defs: { enemies: ENEMIES }, timeLimit: 600, autoFinish: false, seed,
    flags: { dpPerSec: 0, dpMax: 999 }, captureNoisy: true,
    hooks: ['damaged', 'skillStart', 'skillEnd', 'statusApplied', 'elementBurst', 'attack', 'heal', 'death'],
    units: [{ uid: 1, diy: { slot: SLOT[tier], charId: OXI, skillIndex: skill, uniEquipId: null }, elite, row, col }],
    enemies,
  });
  h.step();
  return { h, u: h.unit(1) };
}
/** The arts / element instances of hers. */
const ofType = (h, u, type) => h.hooksOf('damaged').filter((c) => c.source === u && c.type === type);
const tagged = (h, u, tag) => h.hooksOf('damaged').filter((c) => c.source === u && c.dmg?.tags?.includes(tag));
const enemyOf = (h, key, n = 0) => h.b.units.filter((x) => x.side === 'enemy' && x.defId === key)[n];
function done(h) {
  checkInvariants(h.b);
  assert.equal(h.b.errors.length, 0, JSON.stringify(h.b.errors[0]));
}
const label = ([tier, elite]) => `T${tier} ${elite ? 'elite' : 'normal'}`;

test('塔露拉 in every 自选 form: her kit (all three skills authored), the form\'s stats, 1-1, block 2, arts attacks, 潜能-4 talent blackboards', () => {
  assert.equal(OPERATOR_KITS[OXI], KITS[OXI]);
  for (const f of FORMS_ALL) {
    const [tier, elite] = f;
    for (const skill of [0, 1, 2]) {
      const { h, u } = field({ tier, elite, skill });
      const form = formOf(tier, elite);
      assert.deepEqual([u.def.charId, u.def.diyFor, u.skill.id, !!u.kit.generic, u.kit.skillSource],
        [OXI, SLOT[tier], form.skills[skill].skillId, false, 'skills'], `${label(f)} skill ${skill}`);
      assert.deepEqual([u.base.maxHp, u.base.atk, u.base.def, u.base.res],
        [form.stats.maxHp, form.stats.atk, form.stats.def, form.stats.res], `${label(f)}: stats`);
      assert.deepEqual([u.s.blockCnt, u.profile.attack, u.profile.canHitFly, u.base.bat, u.base.aspd, u.base.cost],
        [2, 'melee', false, 1.2, 100, 21], `${label(f)}: 本源近卫 / 近战 / 1.2 s`);
      assert.deepEqual(u.liveRangeGrid, form.rangeGrid, `${label(f)}: 1-1`);
      assert.deepEqual(form.rangeGrid, [[0, 0], [0, 1]], 'the record is 1-1');
      assert.equal(u.def.dmgType, 'phys', `${label(f)}: the record's own damage type`);
      assert.equal(u.profile.dmgType, 'arts', `${label(f)}: T1 绝不妥协 "攻击造成法术伤害"`);
      assert.deepEqual(u.def.bonds, ['emptyShip'], `${label(f)}: bonds`);
      assert.equal(u.def.immune.size, 0, `${label(f)}: no immunity flag (the dossier's 「免疫：眩晕」 is wrong)`);
      assert.ok(Object.values(form.immunities).every((v) => !v), `${label(f)}: no immunity flag in backups.json`);
      // full potential (default 潜能 6): the talent blackboards are the potential-4+ ones
      const talents = u.def.raw.talents.filter((t) => t.index >= 0);
      assert.deepEqual(talents.map((t) => t.name), ['绝不妥协', '我即火焰'], `${label(f)}: talents`);
      assert.deepEqual([talents[0].bb.ep_damage_ratio, talents[0].bb.arcane_step, talents[0].bb.arcane_max, talents[0].bb.arcane_idle_delay],
        [0.13, 0.03, 0.18, 3], `${label(f)}: T1 at 潜能 4+`);
      assert.deepEqual([talents[1].bb.field_duration, talents[1].bb.field_interval, talents[1].bb.field_atk_scale, talents[1].bb.max_count],
        [4, 0.3, 0.15, 25], `${label(f)}: T2 at 潜能 2+`);
      // every skill is authored from its own record, whatever skill this pick selected
      assert.deepEqual([u.kit.skills[S1].kind, u.kit.skills[S2].kind, u.kit.skills[S3].kind, u.kit.skills[S3].duration],
        ['instant', 'charges', 'duration', 36], `${label(f)} skill ${skill}: the three specs`);
      done(h);
    }
  }
  // the numbers of the forms (zh_CN, full potential, ATK +35 from 潜能 3): E2 Lv1 2415 / 778 / 361 (the 精英1 Lv80 table),
  // E2 Lv60 2743 / 866 / 403 — no module exists, so the two elite forms are the same record
  assert.deepEqual([FORMS['2/1/4/0'].stats.maxHp, FORMS['2/1/4/0'].stats.atk, FORMS['2/1/4/0'].stats.def,
    FORMS['2/60/7/3'].stats.maxHp, FORMS['2/60/7/3'].stats.atk, FORMS['2/60/7/3'].stats.def], [2415, 778, 361, 2743, 866, 403]);
  assert.deepEqual([FORMS['2/60/7/1'].modules, FORMS['2/60/7/3'].modules, BACKUPS.units[OXI].moduleNames], [[], [], {}]);
});

test('a 自选 pick: 塔露拉 is offered at tiers 5 and 6 (she has a kit) and a roster with her passes validateDiyPicks', () => {
  const data = { chess: CHESS, backups: BACKUPS };
  assert.ok(KITTED_CHARS.includes(OXI));
  for (const t of [5, 6]) assert.ok(diyPool(t, { data, kitted: KITTED_CHARS }).includes(OXI), `tier ${t}`);
  assert.deepEqual(validateDiyPicks({ [SLOT[6]]: { charId: OXI, skillIndex: 2, uniEquipId: null } }, { data, kitted: KITTED_CHARS }),
    { ok: true, picks: { [SLOT[6]]: { charId: OXI, skillIndex: 2, uniEquipId: null } } });
});

test('T1 绝不妥协 (a): every arts hit attaches 13 % ATK 灼燃损伤, S1\'s 490 % burst included; no other damage type does', () => {
  const { h, u } = field({ tier: 6, elite: true, skill: 0, enemies: [{ key: 'enemy_dummy', pos: [10, 6] }] });
  const t1 = u.def.raw.talents[0].bb;
  assert.ok(h.runUntil(() => ofType(h, u, 'arts').length && ofType(h, u, 'element').length, 3), 'her first attack');
  const arts = ofType(h, u, 'arts')[0], fill = ofType(h, u, 'element')[0];
  approx(arts.amount, u.s.atk, 'the arts attack is 100 % ATK');
  assert.deepEqual([arts.type, arts.dmg.isAttack, arts.dmg.isSkill], ['arts', true, false], 'a normal attack, not a skill hit');
  approx(fill.amount, u.s.atk * t1.ep_damage_ratio, '13 % ATK 灼燃损伤');
  assert.deepEqual([fill.dmg.element, fill.dmg.tags.includes('talent'), fill.target], ['burn', true, arts.target], 'a talent gauge fill on the same target');
  assert.equal(u.findBuff('oxi:arcane'), null, 'no idle ramp while she attacks');
  // the burst of S1 attaches one too (its own 490 % is an arts instance of hers)
  assert.ok(h.runUntil(() => u.skill.activations >= 1, 12), 'S1 casts');
  const burst = tagged(h, u, 'oxi:whitenight')[0];
  approx(burst.amount, u.s.atk * 4.9, '490 % ATK arts');
  const atBurst = ofType(h, u, 'element').filter((c) => Math.abs(c.t - burst.t) < 1e-6);
  assert.ok(atBurst.length >= 1, 'the burst carries a fill of its own');
  for (const c of atBurst) approx(c.amount, u.s.atk * t1.ep_damage_ratio, '13 % of ATK, not of the damage');
  done(h);
});

test('T1 绝不妥协 (b): 3 s without attacking, then 法术和元素伤害 +3 % every 0.5 s up to +18 %, one step off per attack', () => {
  // the enemy stands far outside her 1-1, so she never attacks and the idle ramp runs
  const { h, u } = field({ tier: 5, elite: false, skill: 0, enemies: [{ key: 'enemy_dummy', pos: [10, 9] }] });
  h.run(2.9);
  assert.equal(u.findBuff('oxi:arcane'), null, 'nothing before arcane_idle_delay (3 s)');
  h.run(0.8);
  approx(u.findBuff('oxi:arcane').mods.dmgDealtMul, 1.03, 'one arcane_step');
  assert.equal(u.findBuff('oxi:arcane').mods.artsDealtMul, undefined, 'one dmgDealtMul buff, no artsDealtMul');
  h.run(3.5);
  approx(u.findBuff('oxi:arcane').mods.dmgDealtMul, 1.18, 'the arcane_max cap (6 × 3 %)');
  approx(u.s.dmgDealtMul, 1.18, 'arts and 元素伤害 alike');
  // into range: the attack keeps the full bonus, then one step falls off
  h.spawn('enemy_dummy', { pos: [10, 6] });
  const n0 = h.hooksOf('damaged').length;
  assert.ok(h.runUntil(() => h.hooksOf('damaged').slice(n0).some((c) => c.source === u && c.type === 'arts'), 3));
  const hit = h.hooksOf('damaged').slice(n0).find((c) => c.source === u && c.type === 'arts');
  approx(hit.amount, u.s.atk * 1.18, 'the attack carries the full +18 %');
  approx(u.findBuff('oxi:arcane').mods.dmgDealtMul, 1.15, '每次攻击时衰减: one step per attack');
  done(h);
});

test('T2 我即火焰: a 灼燃 burst lays a 「足迹」 on the ground under its victim — 15 % ATK arts every 0.3 s for 4 s, ground enemies only', () => {
  const { h, u } = field({ tier: 6, elite: true, skill: 0, enemies: [
    { key: 'enemy_dummy', pos: [10, 6] }, { key: 'enemy_fly', pos: [10, 6] },
  ] });
  const t2 = u.def.raw.talents[1].bb;
  const fly = enemyOf(h, 'enemy_fly');
  assert.ok(h.runUntil(() => h.hooksOf('elementBurst').length > 0, 25), 'her arts fill the gauge until it bursts');
  const burst = h.hooksOf('elementBurst')[0];
  assert.equal(burst.element, 'burn');
  h.step();
  const tiles = u.mem.oxiSteps.tiles;
  assert.equal(tiles.size, 1, 'one footprint under the victim');
  const tile = [...tiles.values()][0];
  assert.deepEqual([tile.r, tile.c], [Math.round(burst.target.y), Math.round(burst.target.x)], 'on the passable ground it stands on');
  const n0 = h.hooksOf('damaged').length;
  h.run(1);
  const pulses = h.hooksOf('damaged').slice(n0).filter((c) => c.dmg?.tags?.includes('oxi:footprint'));
  assert.ok(pulses.length === 3 || pulses.length === 4, `${pulses.length} pulses in 1 s (field_interval 0.3)`);
  for (const c of pulses) {
    approx(c.amount, u.s.atk * t2.field_atk_scale, '15 % ATK');
    assert.deepEqual([c.type, c.dmg.canDodge], ['arts', false], 'arts, a field tick that cannot be dodged');
  }
  assert.equal(fly.hp, 1e9, 'the air unit on the same tile flies above the footprint');
  approx(tile.until - h.b.time, t2.field_duration, 'each footprint lasts field_duration s', 0.05);
  done(h);
});

test('T2 我即火焰: at most 25 footprints — the oldest makes way for the newest', () => {
  const enemies = [], cells = [];
  const probe = field({ tier: 6, elite: true, skill: 2 });
  for (let r = 9; r <= 12 && enemies.length < 30; r++) {
    for (let c = 3; c <= 10 && enemies.length < 30; c++) {
      if (r === 10 && c === 5) continue;                          // her own tile
      if (!probe.h.b.grid.groundPassable(r, c)) continue;         // a footprint needs passable ground
      enemies.push({ key: 'enemy_dummy', pos: [r, c] });
      cells.push([r, c]);
    }
  }
  const { h, u } = field({ tier: 6, elite: true, skill: 2, enemies });
  for (const e of h.b.units) if (e.side === 'enemy') h.b.dealDamage(u, e, { amount: 1000, type: 'element', element: 'burn' });
  h.step();
  const tiles = u.mem.oxiSteps.tiles;
  assert.equal(tiles.size, 25, `max_count 25 (${enemies.length} victims)`);
  const keys = [...tiles.values()].map((t) => `${t.r},${t.c}`);
  assert.ok(keys.includes(cells[cells.length - 1].join(',')), 'the newest footprint stays');
  assert.ok(!keys.includes(cells[0].join(',')), 'the oldest was evicted');
  done(h);
});

test('S1 照霎白夜 (AUTO, 8 SP, 0 initial): 490 % ATK arts + 2.5 s 恐惧 to every GROUND enemy on the target\'s tile — a flyer there is spared', () => {
  const { h, u } = field({ tier: 6, elite: true, skill: 0, enemies: [
    { key: 'enemy_dummy', pos: [10, 6] }, { key: 'enemy_dummy', pos: [10, 6] }, { key: 'enemy_fly', pos: [10, 6] },
  ] });
  const sk = skillOf(6, true, S1);
  assert.deepEqual([u.skill.rule, u.skill.kind, u.skill.spCost, u.skill.initSp, sk.bb.atk_scale, sk.bb.fear],
    ['DEFAULT', 'instant', 8, 0, 4.9, 2.5]);
  assert.equal(u.skill.activations, 0, 'not yet');
  assert.ok(h.runUntil(() => u.skill.activations > 0, 12), 'casts as soon as its SP is full');
  const hits = tagged(h, u, 'oxi:whitenight');
  assert.deepEqual(hits.map((c) => c.target.defId), ['enemy_dummy', 'enemy_dummy'], 'both ground enemies on the tile');
  for (const c of hits) {
    approx(c.amount, u.s.atk * sk.bb.atk_scale, '490 % ATK');
    assert.deepEqual([c.type, c.dmg.isSkill], ['arts', true]);
  }
  const fears = h.hooksOf('statusApplied').filter((c) => c.status === 'fear' && c.source === u);
  assert.equal(fears.length, 2, 'both of them');
  for (const c of fears) approx(c.duration, sk.bb.fear, '2.5 s 恐惧');
  assert.equal(enemyOf(h, 'enemy_fly').hp, 1e9, 'the flyer on that tile is untouched');
  done(h);
  // the data's AUTO rule: no enemy, no cast
  const idle = field({ tier: 6, elite: true, skill: 0 });
  idle.h.run(12);
  assert.equal(idle.u.skill.activations, 0, 'DEFAULT needs an enemy in her range');
  done(idle.h);
});

test('S2 阂断骤雪 (AUTO TAKE_DAMAGE, 5 charges): 90 % 庇护 decaying over 1.3 s, 230 % ATK arts back on the attacker and its tile, a heal of 5 % of it', () => {
  const { h, u } = field({ tier: 6, elite: true, skill: 1, enemies: [
    { key: 'enemy_hitter', pos: [10, 6] }, { key: 'enemy_dummy', pos: [10, 6] },
  ] });
  const sk = skillOf(6, true, S2);
  assert.equal(sk.trigger.rule, 'TAKE_DAMAGE', 'the record carries the trigger (UNIT_TRIGGER_CORRECTIONS)');
  assert.deepEqual([u.skill.rule, u.skill.kind, u.skill.maxCharges, u.skill.spCost, u.skill.initSp],
    ['TAKE_DAMAGE', 'charges', 5, 8, 18]);
  assert.deepEqual([u.skill.charges], [2], 'initSp 18 = two of the 8-SP charges');
  approx(u.skill.sp, 2, 'and 2 SP towards the third', 0.02);
  assert.equal(u.skill.activations, 0, 'nothing before she is hit');
  assert.ok(h.runUntil(() => u.skill.activations > 0, 3), 'a hit sets it off');
  const hits = tagged(h, u, 'oxi:ashSnow');
  assert.deepEqual(hits.map((c) => c.target.defId), ['enemy_hitter', 'enemy_dummy'], 'the attacker and the enemy within ability_range_radius of it');
  for (const c of hits) {
    approx(c.amount, u.base.atk * sk.bb.retaliate_atk_scale, '230 % ATK at the cast (before its own stack)');
    assert.deepEqual([c.type, c.dmg.tags.includes('counter'), c.dmg.canDodge], ['arts', true, false], 'an arts counter');
  }
  const dealt = hits.reduce((s, c) => s + c.amount, 0);
  const heals = h.hooksOf('heal').filter((c) => c.target === u && c.source === u);
  assert.equal(heals.length, 1);
  approx(heals[0].amount, dealt * sk.bb.heal_ratio, '5 % of the damage dealt');
  // 庇护: the shared PROTECT effect, full for shelter_hold_duration then decaying
  approx(u.s.artsTakenMul, 1 - sk.bb.damage_resistance, '90 % 庇护');
  approx(u.s.physTakenMul, 1 - sk.bb.damage_resistance, 'physical too');
  h.run(0.6);
  const v = u.findBuff('protect')?.data?.value;
  assert.ok(v > 0.09 && v < 0.9, `decaying after 0.2 s (${v})`);
  h.run(0.8);
  assert.equal(u.findBuff('protect'), null, 'gone with skill_duration (1.3 s)');
  assert.equal(u.s.artsTakenMul, 1);
  done(h);
});

test('S2 阂断骤雪 反伤与溅射都打到隐匿敌人（业主 2026-11-04 两条）: the attacker AND the 隐匿 neighbour beside it', () => {
  // 业主 2026-11-04 先「修复一下塔露拉2技能反伤不能伤害隐匿敌人的bug」，再「塔露拉2技能反伤溅射应该也要能伤害隐匿敌人」
  // — so BOTH halves reach a 隐匿 enemy. The retaliation used to reach its source through `canTargetEnemy` and its
  // splash through `foesInRadius`, and both refuse an unblocked 隐匿 enemy: the attack answered nothing at all, and a
  // hidden neighbour was spared. The attacker half is a direct pick (PRTS 异常效果 「'直接选中'的能力…不受这些仅在选择时
  // 生效的异常效果制约」, as nian.js / hsgma2.js / op-judge.js already do); the splash half includes 隐匿 by the owner's
  // decision (a deliberate departure from PRTS §AOE伤害判定 — see the kit header).
  const { h, u } = field({ tier: 6, elite: true, skill: 1, enemies: [{ key: 'enemy_sniper', pos: [10, 7] }] });
  const src = enemyOf(h, 'enemy_sniper');
  const hide = (e) => h.b.addBuff(e, { key: 'test:stealth', flags: { stealth: true }, persist: true });
  hide(src);
  h.step();
  // premise: the engine itself cannot select it, and she is hurt by it anyway (a blocked-only 隐匿 is no premise — the
  // attacker's own attack reaches her, which is what sets the counter off)
  assert.ok(src.s.flags.stealth && !src.blockedBy, 'premise: an unblocked 隐匿 attacker');
  assert.equal(h.b.foesInRadius(src.x, src.y, 1, true).includes(src), false, 'premise: the engine area selection skips it');
  assert.equal(h.b.enemiesInKeys(u.rangeKeys, u, { canHitFly: true }).includes(src), false, 'premise: and so does 索敌');
  assert.ok(h.runUntil(() => u.skill.activations > 0, 5), 'its attack still sets the counter off');
  const hits = tagged(h, u, 'oxi:ashSnow').filter((c) => c.target === src);
  assert.ok(hits.length > 0, `the 隐匿 attacker took the retaliation (${hits.length} instance(s))`);
  approx(hits[0].amount, u.base.atk * skillOf(6, true, S2).bb.retaliate_atk_scale, 'the same retaliate_atk_scale × ATK');
  assert.equal(hits[0].dmg.ignoreSelect, true, 'a direct pick, not a selection');
  assert.deepEqual([hits[0].type, hits[0].dmg.tags.includes('counter'), hits[0].dmg.canDodge], ['arts', true, false]);
  done(h);

  // the splash counts 隐匿 neighbours too: a hidden enemy inside ability_range_radius of the attacker takes it as well
  const s = field({ tier: 6, elite: true, skill: 1, enemies: [
    { key: 'enemy_sniper', pos: [10, 7] }, { key: 'enemy_dummy', pos: [10, 7] },
  ] });
  const [atk, beside] = s.h.b.units.filter((x) => x.side === 'enemy');
  hide(atk);
  hide(beside);
  s.h.step();
  assert.equal(s.h.b.foesInRadius(atk.x, atk.y, 1, true).includes(beside), false, 'premise: the engine selection skips the neighbour');
  assert.ok(s.h.runUntil(() => s.u.skill.activations > 0, 5), 'cast');
  const splash = tagged(s.h, s.u, 'oxi:ashSnow');
  assert.deepEqual(splash.map((c) => c.target).sort((a, b) => a.id - b.id), [atk, beside].sort((a, b) => a.id - b.id),
    'the attacker AND the 隐匿 neighbour inside ability_range_radius');
  assert.ok(splash.every((c) => c.dmg.ignoreSelect === true), 'both are answered without asking to be selected');
  assert.ok(beside.hp < 1e9, 'the hidden neighbour really took damage');
  done(s.h);

  // 隐匿 is the ONLY thing this circle lifts: 不可选中 (untargetable) and the DISAPPEAR 「不可见」 (hidden) still stay out
  const t = field({ tier: 6, elite: true, skill: 1, enemies: [
    { key: 'enemy_sniper', pos: [10, 7] }, { key: 'enemy_dummy', pos: [10, 7] }, { key: 'enemy_dummy', pos: [10, 7] },
  ] });
  const [tAtk, tUnt, tHid] = t.h.b.units.filter((x) => x.side === 'enemy');
  hide(tAtk); hide(tUnt); hide(tHid);
  t.h.b.addBuff(tUnt, { key: 'test:untargetable', flags: { untargetable: true }, persist: true });
  t.h.step();
  tHid.hidden = true;                                          // the DISAPPEAR segment of 隐身战场
  assert.ok(t.h.runUntil(() => t.u.skill.activations > 0, 5), 'cast');
  const victims = new Set(tagged(t.h, t.u, 'oxi:ashSnow').map((c) => c.target));
  assert.ok(victims.has(tAtk), 'the 隐匿 attacker');
  assert.equal(victims.has(tUnt), false, '不可选中 stays out of the splash circle');
  assert.equal(victims.has(tHid), false, '「不可见」(hidden) stays out too');
  done(t.h);
});

test('S2 阂断骤雪: one +47 % ATK / DEF stack per cast (max 5, 5 s) and every attack takes in all the enemies she blocks', () => {
  const { h, u } = field({ tier: 6, elite: true, skill: 1, enemies: [
    { key: 'enemy_walk', pos: [10, 9], route: lane },
    { key: 'enemy_walk', pos: [10, 9], route: lane },
  ] });
  const sk = skillOf(6, true, S2);
  assert.ok(h.runUntil(() => u.blocking.length === 2 && !!u.findBuff('oxi:snowStack'), 20), 'both walkers blocked, a cast behind her');
  const buff = u.findBuff('oxi:snowStack');
  assert.deepEqual(buff.mods, { atkPct: sk.bb.atk, defPct: sk.bb.def }, '+47 % ATK / DEF per stack');
  assert.equal(buff.maxStacks, sk.bb.max_stack_cnt);
  approx(buff.timeLeft, sk.bb.stack_duration, 'for 5 s', 0.02);
  approx(u.s.atk, u.base.atk * (1 + sk.bb.atk * buff.stacks), `${buff.stacks} stacks of ATK`);
  approx(u.s.def, u.base.def * (1 + sk.bb.def * buff.stacks), `${buff.stacks} stacks of DEF`);
  const n0 = h.hooksOf('damaged').length;
  assert.ok(h.runUntil(() => h.hooksOf('damaged').slice(n0).some((c) => c.source === u && c.dmg?.isAttack), 2), 'her next attack');
  const mine = h.hooksOf('damaged').slice(n0).filter((c) => c.source === u && c.dmg?.isAttack);
  const attackId = mine[0].dmg.attackId;
  const set = mine.filter((c) => c.dmg.attackId === attackId);
  assert.deepEqual(set.map((c) => c.target.id).sort(), u.blocking.map((e) => e.id).sort(), 'both enemies she blocks');
  for (const c of set) assert.equal(c.amount, set[0].amount, 'one normal hit each');
  done(h);
});

test('S3 日冕重烈 (MANUAL, 36 s): ATK +120 %, no normal attack, a 簇火 wave every 2.67 s — 175 % ATK arts, 15 % for the wave\'s repeat hits', () => {
  const { h, u } = field({ tier: 6, elite: true, skill: 2 });
  h.run(7);                                                       // no enemy: the T1 idle ramp reaches its cap
  approx(u.findBuff('oxi:arcane').mods.dmgDealtMul, 1.18, 'the ramp (T1 (b)) is at its cap');
  h.spawn('enemy_dummy', { pos: [10, 6] });
  h.spawn('enemy_dummy', { pos: [9, 6] });
  assert.ok(h.runUntil(() => u.skill.active, 2), 'MANUAL DEFAULT casts with an enemy in her 1-1');
  const sk = skillOf(6, true, S3);
  assert.deepEqual([u.skill.duration, u.skill.spCost, u.skill.initSp, sk.bb.atk, sk.bb.heatwave_atk_scale, sk.bb.normal_interval,
    sk.bb.wave_speed, sk.bb.range_radius, sk.bb.same_wave_repeat_damage_scale], [36, 45, 38, 1.2, 1.75, 2.67, 2.3, 1.5, 0.15]);
  approx(u.s.atk, u.base.atk * (1 + sk.bb.atk), 'ATK +120 %');
  const attacks = h.hooksOf('attack').length;
  assert.ok(h.runUntil(() => tagged(h, u, 'oxi:heatwave').length >= 4, 6), 'the first wave explodes');
  const hits = tagged(h, u, 'oxi:heatwave');
  const mul = u.findBuff('oxi:arcane').mods.dmgDealtMul;
  const full = u.s.atk * sk.bb.heatwave_atk_scale * mul, repeat = full * sk.bb.same_wave_repeat_damage_scale;
  const amounts = hits.map((c) => c.amount).sort((x, y) => y - x);
  approx(amounts[0], full, '175 % ATK on the first 簇火 of the wave');
  approx(amounts[1], full, 'the enemy beside it is inside range_radius');
  approx(amounts[2], repeat, '15 % for the second 簇火 of the same wave');
  approx(amounts[3], repeat, 'for both victims');
  assert.deepEqual(hits.map((c) => c.type), ['arts', 'arts', 'arts', 'arts']);
  assert.equal(h.hooksOf('attack').length, attacks, '"停止攻击": no normal attack while it runs');
  // one 簇火 per in-field row of the 2 × normal_half_width + 1 band, each carrying its own flight: birth tile, end point
  // (wave_exit_distance along her facing, in its own row), facing and flight time. The client plays the official tail
  // oxi_skill_03_trail_01 from it, turned and advanced every frame (FX_BINDINGS.skchr_oxi_3.oxiTrail, `move`); with the
  // official layer off the same event falls back to the procedural 'oxiTrail' fireball — a comet the renderer sends 20
  // tiles to the RIGHT when tx / ty are missing, which is the bug these four numbers pin.
  // the 簇火's fire: one 'oxiTrail' instance per ~0.4 s of flight, at the 簇火's own position (the client shifts it
  // 6.5 tiles forward to cancel the prefab's authored tail offset — FX_BINDINGS.offsetDir)
  const fx = h.eventsOf('fx').filter((e) => e[1] === 'oxiTrail');
  const rect = h.b.rect;
  const rows = [];
  for (let off = -sk.bb.normal_half_width; off <= sk.bb.normal_half_width; off++) {
    const r = 10 + off;
    if (r >= rect.r0 && r <= rect.r1) rows.push(r);
  }
  const first = fx.slice(0, rows.length);
  // one drawn fire per row of the band, and the drawing is spread a touch wider than the grid (TRAIL_SPREAD 1.15, anchored
  // on her own row) so the parallel streaks do not merge into one blob
  const ys = [...new Set(first.map((e) => e[3]))].sort((a, b) => a - b);
  assert.equal(ys.length, rows.length, `one 簇火 per row of the band (${rows.join(', ')})`);
  for (let k = 1; k < ys.length; k++) approx(ys[k] - ys[k - 1], 1.15, 'the drawn rows sit 1.15 tiles apart', 1e-6);
  assert.ok(ys.some((y) => Math.abs(y - 10) < 1e-9), 'her own row is the anchor of the spread');
  for (const e of first) {
    const born = e[2];
    assert.deepEqual([e[4].dc, e[4].dr], [1, 0], 'facing RIGHT in this field');
    // 「簇火」最远只在自身身后 11 格的地块中心生成：the furthest tile still on the map (≤ 11 behind her column)
    assert.ok(born >= rect.c0 - 1e-9 && born <= rect.c1 + 1e-9, `born on the map (x ${born})`);
    assert.ok(5 - born <= 11 + 1e-9, `at most 11 tiles behind her (x ${born})`);
    approx(e[4].dur, 1.2, 'each instance is held 1.2 s (the live trail)');
  }
  // further instances march forward with the 簇火, ≈ wave_speed × 0.4 apart
  const row10 = fx.filter((e) => Math.abs(e[3] - 10) < 1e-9).map((e) => e[2]);
  if (row10.length >= 2) for (let k = 1; k < row10.length; k++) approx(row10[k] - row10[k - 1], sk.bb.wave_speed * 0.4, 'one instance per 0.4 s of flight', 0.05);
  done(h);
});

test('S3 簇火 that hits: its fire ends there — an `oxiTrailStop` naming that 簇火 trailKey at the detonation, and only its own fire', () => {
  const { h, u } = field({ tier: 6, elite: true, skill: 2 });
  const e = h.spawn('enemy_dummy', { pos: [10, 6] });
  assert.ok(h.runUntil(() => u.skill.active, 10), 'cast');
  assert.ok(h.runUntil(() => h.eventsOf('fx').some((x) => x[1] === 'oxiTrailStop'), 20), 'a 簇火 detonates');
  const fx = h.eventsOf('fx');
  const stops = fx.filter((x) => x[1] === 'oxiTrailStop');
  const fires = fx.filter((x) => x[1] === 'oxiTrail');
  const keys = new Set(fires.map((x) => x[4].trailKey));
  assert.ok(keys.size > 1, 'the band carries more than one 簇火');
  for (const st of stops) {
    assert.ok(keys.has(st[4].trailKey), 'the stop names a 簇火 that had a fire');
    approx(Math.hypot(st[2] - e.x, st[3] - e.y), 0, 'the stop happens at the detonation', 1.5);
  }
  // only the 簇火 that hit is stopped: its key is not the key of the fires of the other rows
  const stoppedKeys = new Set(stops.map((x) => x[4].trailKey));
  const alive = fires.filter((f) => !stoppedKeys.has(f[4].trailKey));
  assert.ok(alive.length > 0, 'the other rows keep their fire');
  done(h);
});

test('S3 日冕重烈 的释放策略: 地图上有敌人就自动开启（哪怕不在攻击范围），场上没有敌人就不空放', () => {
  const { h, u } = field({ tier: 6, elite: true, skill: 2 });
  assert.ok(h.runUntil(() => u.skill.ready, 30), 'SP 攒满（技能一直没被放出去）');
  h.run(3);
  assert.equal(u.skill.active, false, '场上没有敌人：不空放');
  // 一个在场地另一头、明显不在她攻击范围里的敌人也足够触发「地图上有敌人」
  const far = h.spawn('enemy_dummy', { pos: [h.b.rect.r1, h.b.rect.c0] });
  assert.ok(far && far.alive, 'the far enemy is alive');
  assert.ok(h.runUntil(() => u.skill.active, 3), '有敌人就自动开启');
  assert.equal(u.skill.activations, 1, 'exactly one activation');
  assert.equal(u.skill.id, S3, 'S3 is the skill that fired');
  done(h);
});

test('S3 日冕重烈: a target inside its 灼燃 burst takes 元素伤害 instead of 法术伤害', () => {
  const { h, u } = field({ tier: 6, elite: true, skill: 2 });
  h.run(7);
  const e = h.spawn('enemy_dummy', { pos: [10, 6] });
  assert.ok(h.runUntil(() => u.skill.active, 2));
  h.b.dealDamage(u, e, { amount: 1000, type: 'element', element: 'burn' });
  assert.ok(e.findBuff('burnBurst'), 'in its 灼燃 burst');
  assert.ok(h.runUntil(() => tagged(h, u, 'oxi:heatwave').length > 0, 6), 'the first wave lands');
  const hit = tagged(h, u, 'oxi:heatwave')[0];
  assert.deepEqual([hit.type, hit.dmg.element], ['elemental', 'burn'], '元素伤害, not 法术伤害');
  const mul = u.findBuff('oxi:arcane').mods.dmgDealtMul;
  approx(hit.amount, u.s.atk * skillOf(6, true, S3).bb.heatwave_atk_scale * mul, 'the same 175 % ATK, no DEF / RES instead');
  done(h);
});

test('S3 日冕重烈 过载: from the second half of the duration (18 s) a wave comes every 2 s instead of every 2.67 s', () => {
  const { h, u } = field({ tier: 6, elite: true, skill: 2 });
  h.spawn('enemy_dummy', { pos: [10, 6] });
  assert.ok(h.runUntil(() => u.skill.active, 10), 'cast');
  const rows = [];
  for (let off = -skillOf(6, true, S3).bb.normal_half_width; off <= skillOf(6, true, S3).bb.normal_half_width; off++) {
    const r = 10 + off;
    if (r >= h.b.rect.r0 && r <= h.b.rect.r1) rows.push(r);
  }
  const waves = () => u.mem.oxiWave.spawned;                      // the kit's own wave counter (frames, not puffs)
  h.run(17.9);
  const normal = waves();
  assert.equal(normal, 6, `every normal_interval (2.67 s) in the first half: ${normal} wave(s)`);
  h.run(16.6);                                                    // to 34.5 s of the skill
  assert.equal(waves() - normal, 8, `every overload_interval (2 s) after 18 s: ${waves() - normal}`);
  // 过载's cue: the widened band lit on the ground once — 'field' with the overload_half_width rows, never the
  // FLASH-archetype 'overload' a running official skill would swallow
  const cue = h.eventsOf('fx').filter((e) => e[1] === 'field' && Math.abs((e[4]?.dur ?? 0) - 1.2) < 1e-9);
  assert.equal(cue.length, 1, '过载 announced once, as a ground highlight');
  assert.ok(cue[0][4].tiles.length > rows.length * 2, `the widened band (${cue[0][4].tiles.length} tiles)`);
  // and a second, flame-orange copy of that band (`kinds.js` oxiOverload, 2.5 s): in this mode the battle area is only
  // 4 rows tall, so the widened band is clipped to the same rows as a normal wave and the plain highlight shows nothing
  const orange = h.eventsOf('fx').filter((e) => e[1] === 'oxiOverload');
  assert.equal(orange.length, 1, '过载 also lights the band in flame orange (the only visible cue in a 4-row field)');
  approx(orange[0][4].dur, 2.5, 'held 2.5 s');
  assert.deepEqual(orange[0][4].tiles, cue[0][4].tiles, 'the same widened band');
  done(h);
});

test('S3 日冕重烈 「该技能可随时主动关闭」是玩家的操作: 场上没有敌人也不自动关闭，跑满 36 秒（过载照常）', () => {
  const { h, u } = field({ tier: 6, elite: true, skill: 2 });
  h.run(7);
  const e = h.spawn('enemy_dummy', { pos: [10, 6] });
  assert.ok(h.runUntil(() => u.skill.active, 2), 'cast');
  h.b.kill(e, u);
  h.run(2);
  assert.equal(u.skill.active, true, 'an empty field does not stop the channel');
  assert.equal(u.mem.oxiWave.over, false, 'not 过载 yet');
  const dur = skillOf(6, true, S3).duration;
  assert.ok(h.runUntil(() => !u.skill.active, dur + 3), 'runs the full duration');
  assert.equal(h.hooksOf('skillEnd').at(-1).reason !== 'stopped', true, 'it ended on its own duration, never by a kit stop');
  assert.equal(u.mem.oxiWave, null, 'the wave state is gone');
  approx(u.s.atk, u.base.atk, 'the ATK buff leaves with the skill');
  done(h);
});

test('no immunity: the official record has every immunity flag false, so the dossier 免疫：眩晕 line is wrong and a stun lands on her', () => {
  const { h, u } = field({ tier: 6, elite: true, skill: 2, enemies: [{ key: 'enemy_hitter', pos: [10, 6] }] });
  const e = enemyOf(h, 'enemy_hitter');
  assert.equal(u.def.immune.size, 0, 'the def carries no immunity Set');
  assert.equal(h.b.applyStatus(u, 'stun', { duration: 3, source: e }), true, 'stun applies');
  assert.equal(!!u.s.flags.stun, true);
  done(h);
});
