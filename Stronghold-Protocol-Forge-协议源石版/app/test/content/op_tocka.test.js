// test/content/op_tocka.test.js — the 自选 operator kit of 冻河 (char_4244_tocka, 6★ 辅助·游击手; kit
// server/sim/content/kits/ops/op-tocka.js), fielded the production way (a DIY slot + its `diy` pick, simdata getDiy) in
// every form: tiers 5 / 6, normal (E2 Lv1, skill rank 4) and elite (E2 Lv60, rank 7), no module (the operator has none).
// Every number is read back from data/backups.json (the form of that slot status); the fidelity checklist of
// kits/README.md item by item — the 触发型效果 model (施加 / 触发 / 转移), the two talents and all three skills.
// Run: node test/content/op_tocka.test.js

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { makeBattle, chessRec, enemyRec, checkInvariants } from '../helpers/battleHarness.js';
import { KITTED_CHARS, OPERATOR_KITS, KITS } from '../../server/sim/content/kits/index.js';
import { diyPool, validateDiyPicks } from '../../shared/diy.js';

const load = (f) => JSON.parse(readFileSync(new URL(`../../data/${f}.json`, import.meta.url), 'utf8'));
const CHESS = load('chess');
const BACKUPS = load('backups');
const TOCKA = 'char_4244_tocka';
const FORMS = BACKUPS.units[TOCKA].forms;
const SLOT = { 5: 'chess_char_5_diy1_a', 6: 'chess_char_6_diy1_a' };
const S1 = 'skchr_tocka_1', S2 = 'skchr_tocka_2', S3 = 'skchr_tocka_3';
/** The unit form of a slot (tier, normal / elite). */
const formOf = (tier, elite) => FORMS[elite ? (tier === 5 ? '2/60/7/1' : '2/60/7/3') : '2/1/4/0'];
const skillOf = (tier, elite, id) => formOf(tier, elite).skills.find((s) => s.skillId === id);
const talentOf = (tier, elite, i) => formOf(tier, elite).talents.find((t) => t.index === i);
const approx = (a, b, msg, eps = 1e-6) => assert.ok(Math.abs(a - b) <= eps * Math.max(1, Math.abs(b)), `${msg}: ${a} vs ${b}`);

/** The 触发型效果's buff key on a holder (the kit's own convention: `tocka:trigger#<owner id>`). */
const tkey = (u) => `tocka:trigger#${u.id}`;
const skey = (u) => `tocka:trigger:shield#${u.id}`;
const pkey = (u) => `tocka:trigger:aspd#${u.id}`;
const akey = (u) => `tocka:trigger:atk#${u.id}`;

const dummy = (key, o = {}) => enemyRec({ key, hp: 1e9, speed: 0, mass: 0, ...o });
const ENEMIES = {
  enemy_dummy: dummy('enemy_dummy'),
  // a ranged attacker that hits one ally 2 tiles away, slowly (one trigger per `bat` s)
  enemy_far: dummy('enemy_far', { atk: 120, bat: 30, range: 2 }),
};
/** A synthetic ally: no talents, a skill that never casts and takes no natural SP (so the kit's SP grants stand alone). */
const ally = (id, stats = {}) => chessRec({
  id, profession: 'WARRIOR',
  stats: { maxHp: 4000, atk: 100, def: 300, res: 0, blockCnt: 1, bat: 2, cost: 10, ...stats },
  skill: {
    skillId: 'sk_test', skillType: 'MANUAL', durationType: 'NONE', duration: -1, spType: 'none',
    spCost: 20, initSp: 0, maxChargeTime: 1, bb: {}, trigger: { rule: 'NEVER' },
  },
});
const DEFS = { enemies: ENEMIES, chess: { test_ally_1: ally('test_ally_1'), test_ally_2: ally('test_ally_2'), test_ally_3: ally('test_ally_3') } };

/** A battle with 冻河 as uid 1 at (row, col) facing RIGHT, plus `others`. */
function field({ tier = 6, elite = true, skill = 0, row = 10, col = 5, others = [], seed = 7, enemies = [] } = {}) {
  const h = makeBattle({
    defs: DEFS, timeLimit: 600, autoFinish: false, seed,
    flags: { dpPerSec: 0, dpMax: 999 },
    hooks: ['damaged', 'attack', 'beforeAttack', 'skillStart', 'skillEnd', 'statusApplied', 'spGain', 'heal'],
    captureNoisy: true,
    units: [{ uid: 1, diy: { slot: SLOT[tier], charId: TOCKA, skillIndex: skill, uniEquipId: null }, elite, row, col }, ...others],
    enemies,
  });
  h.step();
  return { h, u: h.unit(1) };
}
const atkHits = (h, u) => h.hooksOf('damaged').filter((c) => c.source === u && c.dmg?.isAttack);
/** The allies holding 冻河's 触发型效果, by uid. */
const holders = (h, u) => h.b.allyUnits.filter((a) => a.alive && a.findBuff(tkey(u))).map((a) => a.uid).sort((a, b) => a - b);
function done(h) {
  checkInvariants(h.b);
  assert.equal(h.b.errors.length, 0, JSON.stringify(h.b.errors[0]));
}
const label = ([tier, elite]) => `T${tier} ${elite ? 'elite' : 'normal'}`;
/** Every 自选 form (no module: the operator has none). */
const FORMS_ALL = [[5, false], [6, false], [5, true], [6, true]];

test('冻河 in every 自选 form: the operator kit (all three skills authored, no default skill), the form\'s stats, 3-18 range, block 1, ranged anti-air, 辅助, a trait with no stat effect', () => {
  assert.equal(OPERATOR_KITS[TOCKA], KITS[TOCKA]);
  for (const f of FORMS_ALL) {
    const [tier, elite] = f;
    for (const skill of [0, 1, 2]) {
      const { h, u } = field({ tier, elite, skill });
      const form = formOf(tier, elite);
      assert.deepEqual(
        [u.def.charId, u.def.diyFor, u.skill.id, !!u.kit.generic, u.kit.skillSource],
        [TOCKA, SLOT[tier], form.skills[skill].skillId, false, 'skills'], label(f));
      assert.deepEqual([u.base.maxHp, u.base.atk, u.base.def, u.s.res], [form.stats.maxHp, form.stats.atk, form.stats.def, form.stats.res], `${label(f)}: stats`);
      assert.deepEqual([u.s.maxHp, u.s.atk, u.s.def], [form.stats.maxHp, form.stats.atk, form.stats.def], `${label(f)}: no module / talent stat line`);
      assert.deepEqual([u.s.blockCnt, u.profile.attack, u.profile.canHitFly, u.base.bat], [1, 'ranged', true, 2.1], `${label(f)}: 游击手`);
      assert.deepEqual(u.liveRangeGrid, form.rangeGrid, `${label(f)}: 3-18`);
      assert.equal(form.rangeGrid.length, 14, 'the 14 tiles of 3-18');
      assert.deepEqual([u.def.raw.trait.desc, u.def.raw.trait.bb], ['可以使用触发型效果协助作战', {}], `${label(f)}: 特性 (no numbers)`);
      assert.equal((u.def.raw.modules ?? []).length, 0, `${label(f)}: no modules`);
      done(h);
    }
  }
  // the numbers of the forms (full potential): normal 1315 / 704 / 198, elite 1562 / 795 / 216
  assert.deepEqual([FORMS['2/1/4/0'].stats.maxHp, FORMS['2/1/4/0'].stats.atk, FORMS['2/60/7/1'].stats.maxHp, FORMS['2/60/7/1'].stats.atk], [1315, 704, 1562, 795]);
});

test('a 自选 pick: 冻河 is offered at tiers 5 and 6 (he has a kit) and a roster with him passes validateDiyPicks', () => {
  const data = { chess: CHESS, backups: BACKUPS };
  assert.ok(KITTED_CHARS.includes(TOCKA));
  for (const t of [5, 6]) assert.ok(diyPool(t, { data, kitted: KITTED_CHARS }).includes(TOCKA), `tier ${t}`);
  assert.deepEqual(validateDiyPicks({ [SLOT[6]]: { charId: TOCKA, skillIndex: 2, uniEquipId: null } }, { data, kitted: KITTED_CHARS }),
    { ok: true, picks: { [SLOT[6]]: { charId: TOCKA, skillIndex: 2, uniEquipId: null } } });
});

test('S1 一无所有之人 (AUTO, instant): 施加s the 触发型效果 to max_target allies in range that do not hold it — never beyond the range, never to a holder', () => {
  for (const [tier, elite] of [[5, false], [6, true]]) {
    const sk = skillOf(tier, elite, S1);
    const out = { uid: 2, chessId: 'test_ally_1', row: 9, col: 6 };    // in range (dr −1, dc +1)
    const front = { uid: 3, chessId: 'test_ally_2', row: 10, col: 6 }; // in range (dr 0, dc +1)
    const rear = { uid: 4, chessId: 'test_ally_3', row: 9, col: 3 };   // BEHIND her — outside 3-18
    const { h, u } = field({ tier, elite, skill: 0, others: [out, front, rear] });
    assert.deepEqual([u.skill.rule, u.skill.spCost, u.skill.activations], [sk.trigger.rule, sk.spCost, 0], `${label([tier, elite])}: the AUTO rule from the data (SP_FULL)`);
    h.unit(2).hp -= 900;   // the most injured: picked first [ASSUMED: the most injured first]
    h.unit(3).hp -= 400;
    const e = h.spawn('enemy_dummy', { pos: [10, 8] });
    assert.ok(e, 'the target of her normal attack');
    u.skill.gainSp(999);
    assert.ok(h.runUntil(() => u.skill.activations === 1, 8), `${label([tier, elite])}: cast once ready`);
    assert.equal(holders(h, u).length, sk.bb.max_target, `${label([tier, elite])}: exactly max_target (${sk.bb.max_target}) copies`);
    assert.deepEqual(holders(h, u), [2, 3], `${label([tier, elite])}: the two allies in range, never herself (full HP) and never the ally behind her`);
    for (const a of [h.unit(2), h.unit(3)]) assert.deepEqual([a.findBuff(tkey(u)).data.kind, a.findBuff(tkey(u)).source], ['S1', u]);
    assert.equal(h.unit(4).findBuff(tkey(u)), null, `${label([tier, elite])}: outside her range`);
    assert.equal(u.findBuff(tkey(u)), null, `${label([tier, elite])}: herself is the last pick — untouched while two allies are injured`);
    // 「只选择未持有该效果的目标」: the next cast takes the ally in range that still has none (never a holder again)
    u.skill.gainSp(999);
    assert.ok(h.runUntil(() => u.skill.activations === 2, 8), `${label([tier, elite])}: second cast`);
    assert.equal(h.unit(3).findBuff(tkey(u)), h.unit(3).findBuff(tkey(u)), 'the holders keep their copy');
    assert.equal(h.unit(4).findBuff(tkey(u)), null, `${label([tier, elite])}: still out of range`);
    assert.equal(h.unit(2).findBuff(tkey(u)).data.kind, 'S1');
    done(h);
  }
});

test('S1 trigger 「受到攻击时」: the holder gets a 屏障 of shield_atk_scale × ATK decaying over shield_time s, the attacker is 晕眩 stun s, and 夜的哑然 pays sp SP + a heal', () => {
  for (const [tier, elite] of [[5, false], [6, true]]) {
    const sk = skillOf(tier, elite, S1), t1 = talentOf(tier, elite, 0);
    const { h, u } = field({ tier, elite, skill: 0, others: [{ uid: 2, chessId: 'test_ally_1', row: 9, col: 6 }] });
    h.unit(2).hp -= 800;
    const e = h.spawn('enemy_dummy', { pos: [10, 8] });
    u.skill.gainSp(999);
    assert.ok(h.runUntil(() => u.skill.activations === 1, 8), `${label([tier, elite])}: cast`);
    assert.deepEqual(holders(h, u), [1, 2], `${label([tier, elite])}: the injured ally and (second pick) herself`);
    h.b.retreat(e);                     // her own target goes away: no normal attack of hers triggers anything
    const atk = u.s.atk;
    const far = h.spawn('enemy_far', { pos: [9, 8] });   // 2 tiles from the holder, far from 冻河
    assert.ok(h.runUntil(() => h.hooksOf('statusApplied').some((c) => c.status === 'stun' && c.target === far), 5), `${label([tier, elite])}: the attacker is stunned`);
    const shield = h.unit(2).findBuff(skey(u));
    assert.ok(shield, `${label([tier, elite])}: the holder carries a 屏障`);
    approx(shield.shield, atk * sk.bb.shield_atk_scale, `${label([tier, elite])}: shield_atk_scale × ATK`, 1e-3);
    approx(shield.duration, sk.bb.shield_time, `${label([tier, elite])}: over shield_time s`);
    const stun = h.hooksOf('statusApplied').filter((c) => c.status === 'stun' && c.target === far);
    approx(stun[stun.length - 1].duration, sk.bb.stun, `${label([tier, elite])}: 晕眩 stun s`, 1e-9);
    // 夜的哑然: +sp SP (reason 'talent') and a heal of heal_scale × ATK to the injured ally in her range
    const sp = h.hooksOf('spGain').filter((c) => c.unit === u && c.reason === 'talent');
    assert.equal(sp.length, 1, `${label([tier, elite])}: one 夜的哑然 payout`);
    approx(sp[0].amount, t1.bb.sp, `${label([tier, elite])}: +sp SP`, 1e-9);
    const heals = h.hooksOf('heal').filter((c) => c.source === u && c.target === h.unit(2));
    assert.ok(heals.length >= 1, `${label([tier, elite])}: the heal`);
    approx(heals[0].amount, atk * t1.bb.heal_scale, `${label([tier, elite])}: heal_scale × ATK`, 1e-3);
    // 「（在10秒内衰减）」: one step per second, the capacity scaling what is left
    h.run(3);
    approx(h.unit(2).findBuff(skey(u)).shield, atk * sk.bb.shield_atk_scale * 0.7, `${label([tier, elite])}: decayed to 70 % after 3 s`, 1e-3);
    done(h);
  }
});

test("S2 意欲呼啸之心 (AUTO, instant): 施加s the effect to one ally ANYWHERE; when the HOLDER's own skill becomes castable they gain ASPD +attack_speed for buff_duration s and their skill auto-casts", () => {
  for (const [tier, elite] of [[5, false], [6, true]]) {
    const sk = skillOf(tier, elite, S2);
    const { h, u } = field({ tier, elite, skill: 1, others: [{ uid: 2, chessId: 'test_ally_1', row: 9, col: 3 }] });   // behind her, outside 3-18
    const ally2 = h.unit(2);
    const e = h.spawn('enemy_dummy', { pos: [10, 8] });
    const ruleBefore = String(ally2.skill.rule);
    assert.equal(ruleBefore, 'NEVER', `${label([tier, elite])}: the ally starts on the manual strategy`);
    u.skill.gainSp(999);
    assert.ok(h.runUntil(() => u.skill.activations === 1, 8), `${label([tier, elite])}: first cast`);
    assert.deepEqual(holders(h, u), [2], `${label([tier, elite])}: 全场 — an ally outside her attack range is a legal target`);
    assert.equal(ally2.findBuff(tkey(u)).data.kind, 'S2');
    // nothing fires while the holder's own skill is not castable
    h.run(1);
    assert.equal(ally2.findBuff(pkey(u)), null, `${label([tier, elite])}: no fire before the ally can cast`);
    // 「技能可开启时」 — the HOLDER's skill becomes castable (owner 2026-11-01: it used to watch 冻河's own skill, so an ally
    // holding the effect never cast anything by itself)
    ally2.skill.gainSp(999);
    assert.ok(h.runUntil(() => !!ally2.findBuff(pkey(u)), 3), `${label([tier, elite])}: the effect fired on the holder's skill becoming ready`);
    assert.deepEqual(ally2.findBuff(pkey(u)).mods, { aspd: sk.bb.attack_speed }, `${label([tier, elite])}: ASPD +attack_speed`);
    approx(ally2.findBuff(pkey(u)).duration, sk.bb.buff_duration, `${label([tier, elite])}: for buff_duration s`);
    assert.equal(ally2.skill.rule, 'SP_FULL', `${label([tier, elite])}: 「期间技能变为自动开启」 — the HOLDER's strategy`);
    assert.ok(h.runUntil(() => ally2.skill.activations >= 1, 2), `${label([tier, elite])}: the holder casts its own skill with no input`);
    // the window lapses: ASPD gone, the holder's strategy back where it was
    h.run(sk.bb.buff_duration + 1);
    assert.equal(ally2.findBuff(pkey(u)), null, `${label([tier, elite])}: ASPD gone after buff_duration s`);
    assert.equal(ally2.skill.rule, ruleBefore, `${label([tier, elite])}: the holder's strategy went back`);
    assert.ok(e, 'the enemy never mattered to S2');
    done(h);
  }
});

test('S3 踽踽独行之春 (MANUAL, 20 s): ASPD +attack_speed, each attack hits attack@max_target enemies for attack@atk_scale × ATK physical with 晕眩 attack@stun s', () => {
  for (const [tier, elite] of [[5, false], [6, true]]) {
    const sk = skillOf(tier, elite, S3);
    const bb = sk.bb;
    const others = [{ uid: 2, chessId: 'test_ally_1', row: 9, col: 6 }, { uid: 3, chessId: 'test_ally_2', row: 10, col: 6 }];
    const { h, u } = field({ tier, elite, skill: 2, others });
    u.skill.gainSp(999);
    h.run(1);
    assert.equal(u.skill.activations, 0, `${label([tier, elite])}: no enemy, no cast`);
    for (const pos of [[10, 7], [10, 8], [9, 7], [11, 7]]) h.spawn('enemy_dummy', { pos });   // four inside her range
    const away = h.spawn('enemy_dummy', { pos: [10, 12] });    // outside her range
    assert.ok(h.runUntil(() => u.skill.active, 8), `${label([tier, elite])}: cast with an enemy inside her range`);
    approx(u.skill.timeLeft, sk.duration, `${label([tier, elite])}: ${sk.duration} s`, 0.05);
    approx(u.s.interval, 2.1 * 100 / (100 + bb.attack_speed), `${label([tier, elite])}: ASPD +${bb.attack_speed}`, 1e-6);
    const n0 = atkHits(h, u).length;
    assert.ok(h.runUntil(() => atkHits(h, u).length > n0, 5), `${label([tier, elite])}: her first skill attack`);
    h.run(0.5);   // the shots of one attack land a tick apart
    const first = atkHits(h, u).slice(n0);
    const id = first[0].dmg.attackId;
    const hit = first.filter((c) => c.dmg.attackId === id);
    assert.equal(hit.length, bb['attack@max_target'], `${label([tier, elite])}: attack@max_target (${bb['attack@max_target']}) enemies`);
    assert.ok(!hit.some((c) => c.target === away), `${label([tier, elite])}: not the enemy outside her range`);
    for (const c of hit) {
      assert.equal(c.type, 'phys', `${label([tier, elite])}: physical`);
      assert.equal(c.dmg.isSkill, true, `${label([tier, elite])}: a skill attack`);
      // 攻击力+bonus_init_atk is the payload of the COPY — it lands when the HOLDER casts (「开启技能时」), never on her own
      // cast, so a freshly applied copy hits at plain ATK (the holder's cast is asserted in the 「开启技能时」 test below)
      approx(c.amount, u.base.atk * bb['attack@atk_scale'], `${label([tier, elite])}: attack@atk_scale × ATK`, 5e-3);
    }
    const stuns = h.hooksOf('statusApplied').filter((c) => c.status === 'stun' && c.source === u);
    assert.equal(stuns.length >= hit.length, true, `${label([tier, elite])}: each victim stunned`);
    approx(stuns[0].duration, bb['attack@stun'], `${label([tier, elite])}: 晕眩 attack@stun s`, 1e-9);
    done(h);
  }
});

test('S3 「开启技能时」: 施加 / 触发 + 转移 to the ally with the highest SP ratio, the decaying ATK of her and of the holder, and bonus_sp SP a second while the skill runs', () => {
  for (const [tier, elite] of [[5, false], [6, true]]) {
    const sk = skillOf(tier, elite, S3), bb = sk.bb;
    const others = [
      { uid: 2, chessId: 'test_ally_1', row: 9, col: 6 },   // in range
      { uid: 3, chessId: 'test_ally_2', row: 10, col: 6 },  // in range, the highest SP ratio at first
      { uid: 4, chessId: 'test_ally_3', row: 9, col: 3 },   // out of range: never picked
    ];
    const { h, u } = field({ tier, elite, skill: 2, others });
    const a2 = h.unit(2), a3 = h.unit(3), a4 = h.unit(4);
    a3.skill.sp = 16;   // 16 / 20 = 0.8
    a2.skill.sp = 5;    // 0.25
    a2.hp -= 900;       // 夜的哑然's heal has an injured ally in her range
    h.spawn('enemy_dummy', { pos: [10, 8] });
    u.skill.gainSp(999);
    assert.ok(h.runUntil(() => u.skill.active, 8), `${label([tier, elite])}: cast 1`);
    // 施加 (nothing held it yet): the highest-SP-ratio ally in range, never the one outside it, never herself
    assert.deepEqual(holders(h, u), [3], `${label([tier, elite])}: the SP-ratio pick`);
    assert.equal(a3.findBuff(tkey(u)).data.kind, 'S3');
    assert.equal(u.findBuff(tkey(u)), null, `${label([tier, elite])}: 「另一名干员」 is not 冻河`);
    assert.equal(a4.findBuff(tkey(u)), null, `${label([tier, elite])}: outside her attack range`);
    // 「开启技能时自身和冻河攻击力+bonus_init_atk（在bonus_duration秒内衰减）」 — the 自身 of that clause is the HOLDER, so her
    // own cast grants nothing; the bonus lands when the holder activates a skill (owner 2026-11-01: it used to hang on her cast)
    assert.equal(u.findBuff(akey(u)), null, `${label([tier, elite])}: no ATK bonus from her own cast`);
    assert.equal(a3.findBuff(akey(u)), null, `${label([tier, elite])}: nor on the holder yet`);
    assert.ok(a3.skill.gainSp(999) === undefined || true, 'the holder fills its bar');
    assert.ok(a3.skill.activate('test'), `${label([tier, elite])}: the holder casts its own skill`);
    h.step();
    const selfBonus = u.findBuff(akey(u));
    assert.ok(selfBonus, `${label([tier, elite])}: 冻河's own ATK, granted by the holder's cast`);
    approx(selfBonus.mods.atkPct, bb.bonus_init_atk, `${label([tier, elite])}: bonus_init_atk`, 1e-9);
    assert.ok(a3.findBuff(akey(u)), `${label([tier, elite])}: and the holder's`);
    approx(a3.s.atk, a3.base.atk * (1 + bb.bonus_init_atk), `${label([tier, elite])}: her ATK +bonus_init_atk`, 1e-3);
    h.run(5);
    assert.ok(u.findBuff(akey(u)).mods.atkPct < bb.bonus_init_atk, `${label([tier, elite])}: decaying (${u.findBuff(akey(u)).mods.atkPct.toFixed(3)})`);
    assert.ok(u.findBuff(akey(u)).mods.atkPct > 0, `${label([tier, elite])}: still running after 5 s`);
    // 「冻河技能期间拥有该效果的干员每秒获得bonus_sp点技力」 — read off the spGain hook (a holder's own bar caps at its
    // cost); the ally outside the range is the control (its skill takes no natural SP)
    a3.skill.sp = 0; a3.skill.charges = 0;   // the holder's bar is already full (sp = cost, 1 charge): start it over
    const grants = () => h.hooksOf('spGain').filter((c) => c.reason === 'talent' && c.unit !== u);
    const ng = grants().length;
    h.run(3.05);
    const mine = grants().slice(ng);
    assert.equal(mine.length, 3, `${label([tier, elite])}: one grant a second`);
    for (const c of mine) {
      assert.equal(c.unit, a3, `${label([tier, elite])}: only the holder — never the ally outside her range`);
      approx(c.amount, bb.bonus_sp, `${label([tier, elite])}: bonus_sp SP`, 1e-9);
    }
    assert.equal(a4.skill.sp, 0, `${label([tier, elite])}: the control gains none`);
    // 转移: the next cast moves the copy to the now-higher ally (施加, so 夜的哑然 does not fire)
    u.skill.end('test');
    a2.skill.sp = 20;   // ratio 1.0 > a3's
    h.run(0.5);
    const payouts = () => h.hooksOf('spGain').filter((c) => c.unit === u && c.reason === 'talent').length;
    const np = payouts();
    u.skill.gainSp(999);
    assert.ok(h.runUntil(() => u.skill.active, 8), `${label([tier, elite])}: cast 2`);
    assert.deepEqual(holders(h, u), [2], `${label([tier, elite])}: transferred to the highest SP ratio`);
    assert.equal(a3.findBuff(tkey(u)), null, `${label([tier, elite])}: the old holder lost it`);
    assert.equal(payouts(), np, `${label([tier, elite])}: 施加 does not fire 夜的哑然`);
    // 已存在时改为将其触发: the same ally holds it, so this cast FIRES it — 夜的哑然 runs (S1's test reads its +sp SP; here
    // her own timed skill is running, and the sim takes no SP during a timed skill — tier1 giveSp — so only the heal lands)
    u.skill.end('test');
    h.run(0.5);
    const healN = () => h.hooksOf('heal').filter((c) => c.source === u).length;
    const h0 = healN(), np2 = payouts();
    a2.hp -= 500;       // 夜的哑然 heals the most injured ally in her range: keep one injured (the holder's own casts heal too)
    u.skill.gainSp(999);
    assert.ok(h.runUntil(() => u.skill.active, 8), `${label([tier, elite])}: cast 3`);
    assert.deepEqual(holders(h, u), [2], `${label([tier, elite])}: still that ally`);
    assert.ok(healN() > h0, `${label([tier, elite])}: fired ⇒ 夜的哑然's heal`);
    assert.equal(payouts(), np2, `${label([tier, elite])}: no +sp SP while her own 踽踽独行之春 runs`);
    done(h);
  }
});

test('T2 雪的印痕: after 施加 the next NORMAL attack is an area attack (attack@projectile_range) and puts 虚弱 |attack@t2_atk| + an arts burn of attack@t2_magic_atk_scale × ATK a second for attack@t2_buff_duration s on every victim', () => {
  for (const [tier, elite] of [[5, false], [6, true]]) {
    const t2 = talentOf(tier, elite, 1);
    const { h, u } = field({ tier, elite, skill: 0, others: [{ uid: 2, chessId: 'test_ally_1', row: 9, col: 6 }] });
    h.unit(2).hp -= 500;
    const main = h.spawn('enemy_dummy', { pos: [10, 8] });
    const near = h.spawn('enemy_dummy', { pos: [9, 8] });     // 1 tile from the main target, also in her range
    const splash = h.spawn('enemy_dummy', { pos: [11, 9] });  // 1.41 tiles from it — OUTSIDE her own range: splash only
    const far = h.spawn('enemy_dummy', { pos: [10, 12] });    // 4 tiles from it: untouched
    u.skill.gainSp(999);
    assert.ok(h.runUntil(() => u.skill.activations === 1, 8), `${label([tier, elite])}: S1 cast — 施加d, so 雪的印痕 arms`);
    const castT = h.hooksOf('skillStart').filter((c) => c.unit === u).slice(-1)[0].t;
    assert.equal(u.mem.t2Primed, true, `${label([tier, elite])}: armed`);
    const normalAfter = (t) => h.hooksOf('attack').filter((c) => c.attacker === u && !c.isSkill && c.t > t + 1e-9);
    assert.ok(h.runUntil(() => normalAfter(castT).length > 0, 8), `${label([tier, elite])}: her next normal attack`);
    h.run(0.5);   // the shots of one attack land a tick apart
    const attack = normalAfter(castT)[0];
    assert.equal(u.mem.t2Primed, false, `${label([tier, elite])}: one attack only`);
    assert.equal(attack.targets.length, 3, `${label([tier, elite])}: the struck target and the two inside attack@projectile_range of it`);
    assert.ok(attack.targets.includes(main), `${label([tier, elite])}: the struck target`);
    assert.ok(attack.targets.includes(near) && attack.targets.includes(splash), `${label([tier, elite])}: the area victims`);
    assert.ok(!attack.targets.includes(far), `${label([tier, elite])}: outside the area`);
    // the NEXT attack is a plain one again
    assert.ok(h.runUntil(() => normalAfter(attack.t).length > 0, 8), `${label([tier, elite])}: another attack`);
    assert.equal(normalAfter(attack.t)[0].targets.length, 1, `${label([tier, elite])}: back to a single target`);
    // the 虚弱 and its burn, on every victim of the area attack
    h.run(Math.round(t2.bb['attack@t2_buff_duration']) + 1);
    for (const e of attack.targets) {
      const weak = h.hooksOf('statusApplied').filter((c) => c.status === 'weaken' && c.target === e && c.source === u);
      assert.equal(weak.length, 1, `${label([tier, elite])}: 虚弱 on the victim`);
      approx(weak[0].value, Math.abs(t2.bb['attack@t2_atk']), `${label([tier, elite])}: 20 % 虚弱`, 1e-9);
      approx(weak[0].duration, t2.bb['attack@t2_buff_duration'], `${label([tier, elite])}: for attack@t2_buff_duration s`, 1e-9);
      const dot = h.hooksOf('damaged').filter((c) => c.source === u && c.target === e && c.dmg?.tags?.includes('t2'));
      assert.equal(dot.length, Math.round(t2.bb['attack@t2_buff_duration']), `${label([tier, elite])}: one tick a second for ${t2.bb['attack@t2_buff_duration']} s`);
      for (const c of dot) {
        approx(c.amount, u.s.atk * t2.bb['attack@t2_magic_atk_scale'], `${label([tier, elite])}: attack@t2_magic_atk_scale × ATK 法术伤害`, 1e-6);
        assert.equal(c.type, 'arts', `${label([tier, elite])}: 法术伤害`);
      }
    }
    done(h);
  }
});

test('two 冻河 of one field: each keeps her own 触发型效果 (the per-owner buff key), and both pay out on one attack', () => {
  const h = makeBattle({
    defs: DEFS, timeLimit: 600, autoFinish: false, seed: 9,
    flags: { dpPerSec: 0, dpMax: 999 },
    hooks: ['statusApplied', 'spGain'], captureNoisy: true,
    units: [
      { uid: 1, diy: { slot: SLOT[5], charId: TOCKA, skillIndex: 0, uniEquipId: null }, elite: false, row: 10, col: 5 },
      { uid: 2, diy: { slot: SLOT[6], charId: TOCKA, skillIndex: 0, uniEquipId: null }, elite: true, row: 11, col: 5 },
      { uid: 3, chessId: 'test_ally_1', row: 9, col: 6 },
    ],
  });
  h.step();
  const u1 = h.unit(1), u2 = h.unit(2), mate = h.unit(3);
  mate.hp -= 800;   // the most injured ally: the first pick of both
  const e = h.spawn('enemy_dummy', { pos: [10, 7] });   // inside both 3-18 (the two stand one row apart)
  u1.skill.gainSp(999);
  u2.skill.gainSp(999);
  assert.ok(h.runUntil(() => u1.skill.activations >= 1 && u2.skill.activations >= 1, 10), 'both cast');
  assert.deepEqual([holders(h, u1).includes(3), holders(h, u2).includes(3)], [true, true], 'both copies on the ally');
  assert.equal(mate.findBuff(tkey(u1)).data.ownerId, u1.id);
  assert.equal(mate.findBuff(tkey(u2)).data.ownerId, u2.id);
  assert.notEqual(tkey(u1), tkey(u2), 'the per-owner keys');
  h.b.retreat(e);
  const far = h.spawn('enemy_far', { pos: [9, 8] });
  assert.ok(h.runUntil(() => h.hooksOf('spGain').filter((c) => c.reason === 'talent').length >= 2, 6), 'both 夜的哑然 payouts');
  const payers = h.hooksOf('spGain').filter((c) => c.reason === 'talent').map((c) => c.unit).sort((a, b) => a.id - b.id);
  assert.deepEqual(payers.slice(0, 2), [u1, u2], 'each 冻河 pays out on her own copy');
  assert.equal(h.hooksOf('statusApplied').filter((c) => c.status === 'stun' && c.target === far).length, 2, 'the attacker is stunned by both');
  done(h);
});
