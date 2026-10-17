// test/content/chess_char_3_22-yana.test.js — the 固定 (fixed) operator 娅娜 (char_9002_yana, tools/custom-ops.mjs
// FIXED_CHESS) and its kit server/sim/content/kits/ops/chess_char_3_22-yana.js, fielded the production way (an ordinary
// chess of the shared shop pool, simdata getChess) in both forms: normal (E2 Lv1, skills at rank 4) and elite (E2 Lv60,
// rank 7). Unlike an official operator's test this one cannot re-derive every number from the client tables — 娅娜 is an
// original operator declared in tools/custom-ops.mjs — so the expectations read data/chess.json and the declaration.
//
// The fidelity checklist of kits/README.md, item by item:
//   1 skills (all three, both ranks) · 2 talents (both, at full potential) · 3 traits (炮手 splash + the pure-data 特质) ·
//   4 attack range (3-10; S1's own line) · 5 auto-cast trigger (the data's) · 6 targeting (对空, S1 一线全体) ·
//   7 damage typing (phys; S1 的灼燃损伤 fills a gauge) · 8 summons (none) · 9 statuses (none of its own) ·
//   10 tests (this file) · 11 生命回复速度 (none).
// Run: node --test test/content/chess_char_3_22-yana.test.js

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { makeBattle, enemyRec, checkInvariants } from '../helpers/battleHarness.js';
import { KITS } from '../../server/sim/content/kits/index.js';
import { kitOf, skillSpecSource } from '../../server/sim/content/index.js';
import { getDefaultSource } from '../../server/sim/simdata.js';
import { FIXED_CHESS_IDS, FIXED_OP_IDS, FIXED_GARRISON_IDS } from '../../tools/custom-ops.mjs';

const load = (f) => JSON.parse(readFileSync(new URL(`../../data/${f}.json`, import.meta.url), 'utf8'));
const CHESS = load('chess');
const BACKUPS = load('backups');
const BONDS = load('bonds');
const GARRISONS = load('garrisons');
const YANA = FIXED_OP_IDS[0];
const A = FIXED_CHESS_IDS.find((id) => !/_b$/.test(id));
const B = FIXED_CHESS_IDS.find((id) => /_b$/.test(id));
const S1 = 'skchr_yana_1', S2 = 'skchr_yana_2', S3 = 'skchr_yana_3';
const [GA, GB] = FIXED_GARRISON_IDS;
const rec = (id) => CHESS[id];
const skillOf = (id, skillId) => rec(id).skills.find((s) => s.skillId === skillId);
const approx = (a, b, msg, eps = 1e-6) => assert.ok(Math.abs(a - b) <= eps * Math.max(1, Math.abs(b)), `${msg}: ${a} vs ${b}`);
const dummy = (key, o = {}) => enemyRec({ key, hp: 1e9, speed: 0, mass: 0, ...o });
const ENEMIES = { enemy_dummy: dummy('enemy_dummy'), enemy_fly: dummy('enemy_fly', { motion: 'FLY' }) };
/** The data source the engine reads (for kit-resolution helpers). */
const ds = getDefaultSource();

/** A battle with 娅娜 as uid 1 at (row, col) facing RIGHT, plus `others`. */
function field({ elite = false, skill = 0, row = 10, col = 5, others = [], seed = 5, timeLimit = 600 } = {}) {
  const h = makeBattle({
    defs: { enemies: ENEMIES }, timeLimit, autoFinish: false, seed,
    flags: { dpPerSec: 0, dpMax: 999 }, hooks: ['damaged', 'skillStart', 'skillEnd', 'statusApplied', 'attack', 'ammoUsed', 'spGain'], captureNoisy: true,
    units: [{ uid: 1, chessId: elite ? B : A, skillIndex: skill, row, col }, ...others],
  });
  h.step();
  return { h, u: h.unit(1) };
}
const done = (h) => { checkInvariants(h.b); assert.equal(h.b.errors.length, 0, JSON.stringify(h.b.errors[0])); };
const physHits = (h, u) => h.hooksOf('damaged').filter((c) => c.source === u && c.dmg?.type === 'phys');

test('娅娜 is an original FIXED operator: a visible PRESET chess of the shared pool, not a 自选 pick', () => {
  assert.deepEqual(FIXED_OP_IDS, [YANA]);
  for (const id of [A, B]) {
    const c = rec(id);
    assert.ok(c, `${id}: a chess record`);
    assert.deepEqual([c.name, c.rarity, c.profession, c.subProfessionId, c.subProfessionName, c.position],
      ['娅娜', 6, 'SNIPER', 'aoesniper', '炮手', 'RANGED'], `${id}: identity`);
    assert.deepEqual([c.chessType, c.isHidden, c.visible, c.tier], ['PRESET', false, true, 3], `${id}: a visible tier-3 PRESET`);
    assert.deepEqual(c.backup, { charId: YANA, tmplId: null, skillIndex: 0, uniEquipId: null, potRank: 0 }, `${id}: a PRESET is its own backup`);
  }
  // one kit file serves BOTH forms: it is keyed by the normal chess id (`baseId`), never the elite id
  const ds = getDefaultSource();
  assert.equal(typeof KITS[A], 'function', 'the kit is registered under the normal id');
  assert.equal(KITS[B], undefined, 'the elite id is not a registry key');
  for (const id of [A, B]) assert.equal(typeof kitOf(ds.getChess(id), KITS), 'function', `${id}: kitOf resolves through baseId`);
  assert.equal(rec(A).upgradeChessId, B, 'the normal form upgrades into the elite');
  assert.equal(rec(B).upgradeChessId, null, 'the elite is the end of the chain');
  // it is NOT a 自选 pick: the shop row names its charId, so build-data's legal6 keeps it out of diy.ownedPool
  assert.ok(!BACKUPS.diy.ownedPool.includes(YANA), 'not in the 自选 pool');
  assert.equal(BACKUPS.units[YANA], undefined, 'a PRESET needs no backups unit');
  assert.equal(BACKUPS.diy.operators[YANA], undefined, 'and no 自选 operator record');
});

test('盟约精准 comes from the row; the 特质 is PURE DATA (a 休整期结束时 层数+4/+8 garrison, no kit code)', () => {
  for (const [id, gid, want] of [[A, GA, 4], [B, GB, 8]]) {
    assert.deepEqual(rec(id).bonds, ['preciShip'], `${id}: the 精准 bond`);
    assert.deepEqual(rec(id).garrisonIds, [gid], `${id}: its own 特质 row`);
    const g = GARRISONS[gid];
    assert.ok(g, `${gid}: built into garrisons.json`);
    assert.equal(g.eventType, 'SERVER_PREP_FIN', `${gid}: fires at the end of prep`);
    assert.equal(g.effectType, 'SERVER_ADD_BOND_CHESS_ALL', `${gid}: adds the operator's own bonds`);
    assert.equal(g.bb.count, want, `${gid}: +${want} layers`);
    assert.deepEqual(g.owners, [id], `${gid}: owned by this form`);
  }
  // the bond is a REGULAR bond (not a core one) and lists the operator as a member
  assert.equal(BONDS.preciShip.isCore, false);
  assert.ok(BONDS.preciShip.members.includes(A), '精准 lists the normal form');
  assert.ok(!BONDS.preciShip.members.some((m) => /_b$/.test(m)), 'the built member list holds no elites');
});

test('both forms: the declared stats + full potential, 炮手 classification (群体物理, splash 1.1, 对空), 3-10 range, no module', () => {
  // full potential (the owner's decision of 2026-10-07): cost 26−2, ATK +50, HP +150
  const want = { [A]: { maxHp: 1570, atk: 750, cost: 24 }, [B]: { maxHp: 1888, atk: 866, cost: 24 } };
  for (const [id, elite] of [[A, false], [B, true]]) {
    const c = rec(id);
    assert.deepEqual([c.stats.maxHp, c.stats.atk, c.stats.cost], [want[id].maxHp, want[id].atk, want[id].cost], `${id}: stats at full potential`);
    assert.deepEqual([c.dmgType, c.attackKind, c.canHitFly, c.rangeId, c.rangeGrid.length], ['phys', 'ranged', true, '3-10', 15], `${id}: 炮手 / range`);
    // no module ships (the shop row's `defaultUniEquipId` is null): the normal form has no `module` field at all, the
    // elite carries an id-null record at equip level 1 exactly as every official elite does (蒂比 / 凛御银灰)
    if (!elite) {
      assert.equal(c.module, null, `${id}: the operator ships no module`);
      assert.equal(c.status.equipLevel, 0, `${id}: no equip level before the elite`);
    } else {
      assert.deepEqual([c.module?.id, c.module?.active, c.status.equipLevel], [null, false, 1], `${id}: an id-null module record at equip 1`);
      assert.equal(c.modules.length, 0, `${id}: and no selectable module`);
    }
    assert.equal(c.status.skillLevel, elite ? 7 : 4, `${id}: the skill rank of its status`);
    // the kit's traits: the 炮手 branch gives the splash (1.1); the projectile stays the data's (`arrow`, exactly as the
    // official 炮手 菲亚梅塔 / W carry — the per-sub-profession `bomb` in professions.js is not what the record says)
    const { h, u } = field({ elite });
    assert.deepEqual([u.profile.splashRadius, u.profile.canHitFly, u.profile.attack], [1.1, true, 'ranged'], `${id}: the 炮手 profile`);
    assert.equal(u.profile.projectile, rec(id).projectile, `${id}: the projectile follows the data`);
    assert.ok(!u.kit.generic, `${id}: the kit is hand-authored (no generic fallback)`);
    // S1 is the DEFAULT skill, so `selectSkillSpec` leaves the kit as-is (no `skillSource` field: it stays undefined and
    // the spec comes from the kit's own `skill`); S2/S3 resolve through the `skills` map, which stamps `skillSource`
    assert.equal(u.kit.skillSource, undefined, `${id}: the default skill needs no skills-map lookup`);
    assert.equal(u.kit.skill?.kind, 'instant', `${id}: S1 spec is the kit own skill entry`);
    assert.equal(u.skill.spec?.kind, 'instant', `${id}: and it is the active spec`);
    done(h);
  }
});

test('all three skills are authored at every selectable rank, with the right trigger', () => {
  for (const id of [A, B]) {
    const c = rec(id);
    // the kit contract: `skill` is the DEFAULT skill's spec and `skills` holds the ALTERNATE ones only
    const kit = KITS[A](c.skill.bb, c, null);
    assert.ok(kit.skill && kit.skill.kind, `${id}: the default skill's spec`);
    assert.deepEqual(Object.keys(kit.skills).sort(), [S2, S3].sort(), `${id}: the two alternate specs`);
    // and `skillSpecSource` classifies each selectable skill: the default resolves from the kit's own `skill` ('kit'),
    // the alternates from its `skills` map ('skills'). `ds.getChess(id, {skillIndex})` is the ENGINE's own loadout lookup
    // (the same one test/content/kits_alt_t3.test.js uses), so the def is exactly what a battle would see.
    const idxOf = (sd) => rec(id).skills.find((s) => s.skillId === sd).index;
    const src = (sd) => skillSpecSource(ds.getChess(id, { skillIndex: idxOf(sd) }), KITS);
    assert.equal(src(S1), 'kit', 'S1 is the default: from the kit own skill');
    assert.equal(src(S2), 'skills', 'S2 is an alternate: from the skills map');
    assert.equal(src(S3), 'skills', 'S3 is an alternate: from the skills map');
    assert.deepEqual(c.skills.map((s) => s.index), [0, 1, 2], `${id}: every skill unlocked at its status`);
    for (const s of c.skills) assert.ok(typeof s.trigger?.rule === 'string', `${id} ${s.skillId}: a resolved trigger`);
    // S1 owns a 技能范围 (the line), so its bb carries no atk_scale of the ordinary attack
    assert.equal(skillOf(id, S1).rangeId, '5-1', `${id}: S1's own range id`);
    assert.equal(skillOf(id, S2).maxChargeTime, 2, `${id}: S2 charges twice`);
    assert.deepEqual([skillOf(id, S3).durationType, skillOf(id, S3).duration], ['AMMO', -1], `${id}: S3 is an ammo skill`);
    // the owner's tuning of 2026-10-09: S1 costs 10 SP (was 18), S2 lands 9 hits (was 5), S3 grants 攻击力+30 %
    assert.equal(skillOf(id, S1).spCost, 10, `${id}: S1 costs 10 SP`);
    assert.equal(skillOf(id, S2).bb.times, 9, `${id}: S2 lands 9 hits`);
    approx(skillOf(id, S3).bb.atk, 0.3, `${id}: S3 declares 攻击力+30%`);
    // and the SP cost is the same at both statuses (the rank does not move it)
    assert.equal(skillOf(A, S1).spCost, skillOf(B, S1).spCost, 'S1 SP cost is rank-independent');
  }
  // the ranks move with the status
  approx(skillOf(A, S1).bb.atk_scale, 2.8, 'normal S1');
  approx(skillOf(B, S1).bb.atk_scale, 3.1, 'elite S1');
});

test('T1 灼痕: a skill that deals damage adds ONE true-damage instance per damage INSTANCE (S2 here)', () => {
  const { h, u } = field({ skill: 1 });   // S2, a clean single-target multi-hit
  const scale = rec(A).talents[0].bb.true_scale;
  assert.ok(scale > 0, 'the talent declares a scale');
  const e = h.spawn('enemy_dummy', { pos: [10, 6] });
  const hits9 = skillOf(A, S2).bb.times;
  u.skill.gainSp(999);
  const n0 = h.hooksOf('damaged').length;
  assert.ok(h.runUntil(() => u.skill.activations >= 1 && h.hooksOf('damaged').length > n0, 6), 'S2 casts and lands');
  h.run(3);
  const hits = h.hooksOf('damaged').slice(n0).filter((c) => c.source === u);
  const phys = hits.filter((c) => c.dmg.type === 'phys' && c.dmg.isSkill);
  const trueHits = hits.filter((c) => c.dmg.type === 'true');
  // the owner's bug report of 2026-10-10: the rider used to ride `attack.onEachHit`, which the engine calls once per
  // VICTIM (server/sim/ai.js resolveHit, docs/SIM.md §7.3) — so S2's 9-hit burst and S3's 3-hit bursts fired it once per
  // attack instead of once per instance. It now rides the per-instance `damaged` hook.
  assert.equal(phys.length, hits9, `S2 lands its ${hits9} instances`);
  assert.equal(trueHits.length, hits9, `one rider per instance (was 1 before the fix)`);
  approx(trueHits[0].amount, u.s.atk * scale, 'the true damage is true_scale × ATK');
  assert.ok(hits.every((c) => c.target === e), 'all on the locked target');
  assert.ok(trueHits.every((c) => c.dmg.isAttack === false), 'the rider is never itself an attack: it cannot re-trigger');
  done(h);
});

test('T1 灼痕: the rider is per INSTANCE, not per attack — S3 fires three riders per 3-hit burst', () => {
  const { h, u } = field({ skill: 2, timeLimit: 300 });   // S3: 10 bullets, each attack a 3-hit burst
  const scale = rec(A).talents[0].bb.true_scale;
  const times = skillOf(A, S3).bb['attack@times'];
  assert.equal(times, 3, 'a three-instance burst');
  h.spawn('enemy_dummy', { pos: [10, 6] });
  u.skill.gainSp(999);
  assert.ok(h.runUntil(() => u.skill.active, 6), 'S3 activates');
  const atkDuring = u.s.atk;   // S3 grants 攻击力+30%: the rider uses the BUFFED ATK while it runs
  h.runUntil(() => !u.skill.active, 300);
  const hits = h.hooksOf('damaged').filter((c) => c.source === u && c.dmg.isSkill);
  const byAtk = {};
  for (const c of hits.filter((c) => c.dmg.type === 'phys')) byAtk[c.dmg.attackId] = (byAtk[c.dmg.attackId] || 0) + 1;
  const per = Object.values(byAtk);
  assert.ok(per.length >= 9, `nine bursts recorded (${per.length})`);
  assert.ok(per.every((n) => n === times), `every burst is ${times} instances (${per.join(',')})`);
  const riders = hits.filter((c) => c.dmg.type === 'true');
  // per ATTACK there are `times` riders: that is the fix. The 10th bullet's instances may land after the skill ended.
  assert.equal(riders.length, per.reduce((n, x) => n + x, 0), 'one rider per instance across the whole skill');
  assert.ok(riders.length >= 27, `at least 9 bursts x 3 riders (${riders.length})`);
  approx(riders[0].amount, atkDuring * scale, 'each rider is true_scale × the buffed ATK');
  done(h);
});

test('T1 灼痕: an ordinary (non-skill) attack never fires the rider, and S1 fires one per enemy struck', () => {
  // a normal attack is not 技能造成伤害: no rider at all, even with the 追猎 combo running
  {
    const { h, u } = field({ skill: 0 });
    h.spawn('enemy_dummy', { pos: [10, 6] });
    h.b.on('spGain', (c) => { if (c.unit === u) c.amount = 0; }, { priority: -100 });
    h.run(20);
    assert.equal(u.skill.activations, 0, 'the skill never cast');
    assert.ok(physHits(h, u).length >= 3, 'normal attacks landed');
    assert.equal(physHits(h, u).filter((c) => c.dmg.type === 'true').length, 0, 'no rider on a normal attack');
    done(h);
  }
  // S1's line: one rider per enemy struck (the gauge fill is per victim too), never one per instance of some other kind
  {
    const { h, u } = field({ skill: 0 });
    const line = [6, 7, 8].map((c) => h.spawn('enemy_dummy', { pos: [10, c] }));
    u.skill.gainSp(999);
    const n0 = h.hooksOf('damaged').length;
    assert.ok(h.runUntil(() => u.skill.activations >= 1 && h.hooksOf('damaged').length > n0, 6), 'S1 casts');
    h.run(4);
    const hits = h.hooksOf('damaged').slice(n0).filter((c) => c.source === u);
    const struck = new Set(hits.filter((c) => c.dmg.type === 'phys').map((c) => c.target));
    assert.equal(struck.size, line.length, 'three enemies struck');
    assert.equal(hits.filter((c) => c.dmg.type === 'true').length, line.length, 'one rider per struck enemy');
    assert.equal(hits.filter((c) => c.dmg.type === 'element').length, line.length, 'one gauge fill per struck enemy');
    assert.equal(h.b.errors.length, 0, 'the rider never recurses into itself (hook-depth limit)');
    done(h);
  }
});

test('S1 激光 (AUTO): every enemy on the straight 6-tile line takes atk_scale × ATK physical plus a 灼燃损伤 gauge fill', () => {
  const { h, u } = field({ skill: 0 });
  const sk = skillOf(A, S1);
  // the skill's own range (5-1) is a straight line of 6 tiles: the operator's own tile + the five in front of her,
  // which is the range table's [0,0]..[0,5] and the closest official grid to "正前方一条直线 6 格"
  assert.deepEqual(sk.rangeGrid, [[0, 0], [0, 1], [0, 2], [0, 3], [0, 4], [0, 5]], 'the declared line');
  const line = [[10, 5], [10, 6], [10, 7], [10, 8], [10, 9], [10, 10]].map(([r, c]) => h.spawn('enemy_dummy', { pos: [r, c] }));
  // The line ends at col 10, and the field's east edge clamps anything past it onto x = 10.499999046325684 — which
  // rounds to col 10, i.e. ON the line. So the "off the line" probe must not sit beyond the east edge; use a row
  // neighbour instead (row 9 is off a row-10 line and nothing clamps it).
  const offLine = [h.spawn('enemy_dummy', { pos: [9, 7] }), h.spawn('enemy_dummy', { pos: [11, 8] })];
  u.skill.gainSp(999);
  const n0 = h.hooksOf('damaged').length;
  assert.ok(h.runUntil(() => u.skill.activations >= 1 && h.hooksOf('damaged').length > n0, 6), 'S1 casts with a target on the line');
  h.run(4);   // let every projectile land
  const hits = h.hooksOf('damaged').slice(n0).filter((c) => c.source === u);
  const phys = hits.filter((c) => c.dmg.type === 'phys' && c.dmg.isSkill);
  const burn = hits.filter((c) => c.dmg.type === 'element');
  const struck = new Set(phys.map((c) => c.target));
  assert.equal(struck.size, line.length, 'every in-line enemy is struck');
  for (const e of line) assert.ok(struck.has(e), `in-line enemy at ${e.tileR},${e.tileC}`);
  for (const e of offLine) assert.ok(!struck.has(e), `off-line enemy at ${e.tileR},${e.tileC} untouched`);
  approx(phys[0].amount, u.s.atk * sk.bb.atk_scale, 'the physical hit is atk_scale × ATK');
  assert.ok(burn.length > 0, 'the 灼燃损伤 lands');
  assert.equal(burn[0].dmg.element, 'burn', 'the gauge is 灼燃');
  approx(burn[0].amount, u.s.atk * sk.bb.burn_scale, 'the fill is burn_scale × ATK');
  done(h);
});

test('S2 瞄准射击 (MANUAL, 2 charges): one locked target takes `times` small hits, each atk_scale × ATK', () => {
  const { h, u } = field({ skill: 1 });
  const sk = skillOf(A, S2);
  // the owner's tuning of 2026-10-09 raised this from 5 to 9 hits
  assert.deepEqual([u.skill.maxCharges, sk.bb.times], [2, 9], 'two charges, nine hits');
  const e = h.spawn('enemy_dummy', { pos: [10, 6] });
  const far = h.spawn('enemy_dummy', { pos: [10, 10] });
  u.skill.gainSp(999);
  const n0 = h.hooksOf('damaged').length;
  assert.ok(h.runUntil(() => u.skill.activations >= 1 && h.hooksOf('damaged').length > n0, 6), 'it casts');
  h.run(3);
  const hits = h.hooksOf('damaged').slice(n0).filter((c) => c.source === u && c.dmg.isSkill && c.dmg.type === 'phys');
  const ids = new Set(hits.map((c) => c.dmg.attackId));
  assert.equal(ids.size, 1, 'one attack action');
  assert.equal(hits.filter((c) => c.target === e).length, sk.bb.times, '`times` hits on the locked target');
  assert.ok(!hits.some((c) => c.target === far), 'a splash hit never reaches the far enemy (single target)');
  approx(hits[0].amount, u.s.atk * sk.bb.atk_scale, 'each hit is atk_scale × ATK');
  assert.equal(u.skill.activations, 1, 'one charge spent');
  done(h);
});

test('S3 三连射 (MANUAL, AMMO 10): every attack is a 3-hit burst, the interval grows, and 10 attacks end it', () => {
  const { h, u } = field({ skill: 2, timeLimit: 300 });
  const sk = skillOf(A, S3);
  assert.deepEqual([u.skill.kind, u.skill.spec.ammo], ['ammo', 10], 'an ammo skill of ten bullets');
  assert.equal(u.skill.ammoMax, 0, 'the bar fills at activation');
  approx(u.s.interval, 2.8, 'the base interval');
  const atkBefore = u.s.atk;
  h.spawn('enemy_dummy', { pos: [10, 6] });
  u.skill.gainSp(999);
  assert.ok(h.runUntil(() => u.skill.active, 6), 'it activates');
  assert.equal(u.skill.ammoMax, 10, 'ten bullets once active');
  approx(u.s.interval, 2.8 + sk.bb.base_attack_time, 'the interval grows by base_attack_time', 1e-3);
  // the owner's tuning of 2026-10-09 added 攻击力+30% to this skill: the buff is live while it runs
  approx(sk.bb.atk, 0.3, 'the data declares +30%');
  approx(u.s.atk, atkBefore * 1.3, 'ATK is ×1.30 while the skill runs', 1e-3);
  const atkDuring = u.s.atk;
  assert.ok(h.runUntil(() => !u.skill.active, 300), 'the skill ends when the bullets run out');
  approx(u.s.atk, atkBefore, 'and ATK returns to its base when it ends', 1e-3);
  const hits = h.hooksOf('damaged').filter((c) => c.source === u && c.dmg.isSkill && c.dmg.type === 'phys');
  const byAtk = {}; for (const c of hits) byAtk[c.dmg.attackId] = (byAtk[c.dmg.attackId] || 0) + 1;
  const per = Object.values(byAtk);
  assert.equal(Math.min(...per), sk.bb['attack@times'], 'every attack is a 3-hit burst');
  // ten bullets = ten attacks; the tenth bullet's damage instance lands with its projectile, so it may land after the
  // skill has already ended (`ammoUsed` is the authoritative count)
  assert.equal(h.hooksOf('ammoUsed').length, 10, 'ten attacks (one per bullet)');
  assert.ok(per.length >= 9, `nine bursts recorded in flight (${per.length})`);
  approx(hits[0].amount, atkDuring * sk.bb['attack@atk_scale'], 'each instance is attack@atk_scale × the BUFFED ATK');
  done(h);
});

test('T2 随意开火: every 3 attacks fires one special bullet (the data declares all four effects)', () => {
  const t2 = rec(A).talents[1];
  assert.equal(t2.name, '随意开火', 'the talent was redefined (2026-10-10)');
  assert.deepEqual(t2.bb, {
    interval: 3, sp: 1,
    blast_scale: 3, blast_radius_mul: 1.5,
    pierce_scale: 2, pierce_def: 0.5,
    burn_scale: 1.5, burn_element: 1,
    stun_scale: 1, stun: 1.5,
  }, 'the four effects and the SP gain');
  // the description the player reads carries the four effects verbatim
  for (const s of ['300%', '1.5倍', '200%', '50%', '150%', '100%', '法术伤害', '眩晕1.5秒', '回复1点技力']) {
    assert.ok(t2.desc.includes(s), `the text names ${s}`);
  }
  // the old 追猎 combo is gone: no `extra_hits` anywhere, and the normal attack stays a single instance
  assert.equal(t2.bb.extra_hits, undefined, 'no 2-hit combo any more');
  assert.equal(t2.bb.hit_count, undefined, 'no per-enemy tally any more');
  assert.ok(!JSON.stringify(rec(A).talents).includes('追猎'), 'the old name is gone');
});

test('T2 随意开火: the bullet fires on the 3rd, 6th, 9th … attack and restores 1 SP each time', () => {
  const { h, u } = field({ skill: 0, timeLimit: 400 });
  h.spawn('enemy_dummy', { pos: [10, 6] });
  // swallow SP so no skill ever casts: only normal attacks, and the tally is not disturbed by a skill
  h.b.on('spGain', (c) => { if (c.unit === u) c.amount = 0; }, { priority: -100 });
  h.run(40);
  assert.equal(u.skill.activations, 0, 'the skill never cast: these were ordinary attacks');
  const attacks = u.stats.attacks;
  assert.ok(attacks >= 6, `enough attacks (${attacks})`);
  // the bullet is talent damage (`isAttack: false`), tagged, and never a plain attack instance
  const bullets = h.hooksOf('damaged').filter((c) => c.source === u && c.dmg?.tags?.includes('yana:fire'));
  const expected = Math.floor(attacks / 3);
  assert.equal(bullets.length, expected, `one bullet per 3 attacks (${bullets.length} of ${attacks})`);
  assert.ok(bullets.every((c) => c.dmg.isAttack === false), 'the bullet is talent damage, not an attack');
  // every bullet is one of the four effects
  for (const c of bullets) {
    const mode = c.dmg.tags.find((t) => t.startsWith('yana:fire:'));
    assert.ok(['yana:fire:blast', 'yana:fire:pierce', 'yana:fire:burn', 'yana:fire:stun'].includes(mode), mode);
  }
  // the SP gain fires with the bullet (1 SP each), so the count matches too
  const gains = h.hooksOf('spGain').filter((c) => c.unit === u && c.reason === 'talent');
  assert.equal(gains.length, expected, 'one +1 SP per bullet');
  done(h);
});

test('T2 随意开火: the four effects are the data\'s (damage scale, DEF ignore, burn gauge, arts + stun)', () => {
  // the roll is deterministic per seed: over enough bullets every mode shows up, and each one's numbers match the bb
  const { h, u } = field({ skill: 0, timeLimit: 600, seed: 11 });
  h.spawn('enemy_dummy', { pos: [10, 6] });
  h.b.on('spGain', (c) => { if (c.unit === u) c.amount = 0; }, { priority: -100 });
  h.run(150);
  const bullets = h.hooksOf('damaged').filter((c) => c.source === u && c.dmg?.tags?.includes('yana:fire'));
  assert.ok(bullets.length >= 12, `enough bullets to see all four (${bullets.length})`);
  const modes = new Set(bullets.map((c) => c.dmg.tags.find((t) => t.startsWith('yana:fire:'))));
  assert.equal(modes.size, 4, `all four effects occurred (${[...modes].join(',')})`);
  const t2 = rec(A).talents[1].bb;
  const atk = u.s.atk;
  for (const c of bullets) {
    const mode = c.dmg.tags.find((t) => t.startsWith('yana:fire:'));
    if (mode === 'yana:fire:stun') {
      assert.equal(c.dmg.type, 'arts', 'the stun effect is 法术伤害');
      approx(c.amount, atk * t2.stun_scale, 'stun scale');
    } else if (mode === 'yana:fire:pierce') {
      assert.equal(c.dmg.type, 'phys');
      assert.equal(c.dmg.defIgnorePct, t2.pierce_def, 'the DEF ignore is the data\'s');
      approx(c.amount, atk * t2.pierce_scale, 'pierce scale');
    } else if (mode === 'yana:fire:burn') {
      assert.equal(c.dmg.type, 'phys');
      approx(c.amount, atk * t2.burn_scale, 'burn scale');
    } else {
      assert.equal(c.dmg.type, 'phys');
      approx(c.amount, atk * t2.blast_scale, 'blast scale');
    }
  }
  // the burn effect also fills the 灼燃 gauge (a separate `type: 'element'` instance, never HP damage). The bullet keeps
  // the 炮手 splash, so each VICTIM it hits gets its own fill. A fill is REFUSED while the gauge is locked by a burst it
  // just triggered (damage.js `burstLocked`: 爆发冷却), so there is at most one fill per burn-bullet victim.
  const gauges = h.hooksOf('damaged').filter((c) => c.source === u && c.dmg?.tags?.includes('yana:burn'));
  const burnHits = bullets.filter((c) => c.dmg.tags.includes('yana:fire:burn'));
  assert.ok(burnHits.length > 0, 'a burn bullet occurred');
  assert.ok(gauges.length > 0 && gauges.length <= burnHits.length, `a fill per victim, minus a locked gauge (${gauges.length} of ${burnHits.length})`);
  for (const g of gauges) {
    assert.equal(g.dmg.type, 'element', '损伤, not 伤害');
    assert.equal(g.dmg.element, 'burn');
    approx(g.amount, atk * t2.burn_element, 'the fill is burn_element × ATK');
  }
  // the stun effect stuns what it hits, for the data's duration
  const stuns = h.hooksOf('statusApplied').filter((c) => c.status === 'stun' && c.source === u);
  assert.ok(stuns.length > 0, 'a stun bullet stunned something');
  assert.ok(stuns.every((c) => Math.abs(c.buff?.duration - t2.stun) < 1e-6 || c.duration === t2.stun), 'the data\'s 1.5 s');
  done(h);
});

test('T2 随意开火: the bullet hits the target the ATTACK struck (and its splash), never a random enemy', () => {
  const { h, u } = field({ skill: 0, timeLimit: 400 });
  // the near dummy is the only enemy in range, so every attack (and thus every bullet) goes to it
  const near = h.spawn('enemy_dummy', { pos: [10, 6] });
  const far = h.spawn('enemy_dummy', { pos: [10, 14] });
  h.b.on('spGain', (c) => { if (c.unit === u) c.amount = 0; }, { priority: -100 });
  h.run(30);
  const bullets = h.hooksOf('damaged').filter((c) => c.source === u && c.dmg?.tags?.includes('yana:fire'));
  assert.ok(bullets.length >= 3, `bullets fired (${bullets.length})`);
  assert.ok(bullets.some((c) => c.target === near), 'the bullet lands on the attacked target');
  assert.ok(!bullets.some((c) => c.target === far), 'never on an enemy she did not attack');
  done(h);
});

test('速射手-style anti-air is the 炮手 default: the operator can hit FLY (canHitFly from the data)', () => {
  const { h, u } = field({ skill: 0 });
  const fly = h.spawn('enemy_fly', { pos: [10, 6] });
  const n0 = physHits(h, u).length;
  assert.ok(h.runUntil(() => physHits(h, u).length > n0, 6), 'it attacks the flyer');
  assert.ok(physHits(h, u).some((c) => c.target === fly), 'the flying enemy is hit');
  done(h);
});

test('no summons and no 特质 at battle time beyond the splash: its records carry no tokens', () => {
  for (const id of [A, B]) {
    assert.deepEqual(rec(id).tokens, [], `${id}: no summons`);
    assert.equal(rec(id).talent?.tokenKey, undefined, `${id}: no talent token`);
  }
  const { h, u } = field({ elite: true });
  assert.deepEqual(u.def.tokens, [], 'nothing to field');
  done(h);
});
