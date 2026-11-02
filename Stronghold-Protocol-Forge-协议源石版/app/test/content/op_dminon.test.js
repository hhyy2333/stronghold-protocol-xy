// test/content/op_dminon.test.js — the 自选 operator kit of 国度 (char_4246_dminon, 6★ 伏击客; kit
// server/sim/content/kits/ops/op-dminon.js), fielded the production way (a DIY slot + its `diy` pick, simdata getDiy) in
// every form: tiers 5 / 6, normal (E2 Lv1, skill rank 4) and elite (E2 Lv60, rank 7). She has **no module**, so the two
// tiers share one record. Every number is read back from data/backups.json (the form of that slot status); the fidelity
// checklist of kits/README.md item by item.
// Run: node test/content/op_dminon.test.js
//
// The field this kit is built around: 「国度」 = the tiles of her CURRENT attack range (the skill's range swaps in while
// S2 / S3 run, `unit.rangeKeys`) plus the tiles S3 spreads (`unit.mem.dminonSpread`).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { makeBattle, enemyRec, checkInvariants } from '../helpers/battleHarness.js';
import { KITTED_CHARS, OPERATOR_KITS, KITS } from '../../server/sim/content/kits/index.js';
import { diyPool, validateDiyPicks } from '../../shared/diy.js';
import { COLS } from '../../server/sim/constants.js';

const load = (f) => JSON.parse(readFileSync(new URL(`../../data/${f}.json`, import.meta.url), 'utf8'));
const CHESS = load('chess');
const BACKUPS = load('backups');
const DMINON = 'char_4246_dminon';
const FORMS = BACKUPS.units[DMINON].forms;
const SLOT = { 5: 'chess_char_5_diy1_a', 6: 'chess_char_6_diy1_a' };
const S1 = 'skchr_dminon_1', S2 = 'skchr_dminon_2', S3 = 'skchr_dminon_3';
/** The unit form of a slot (tier, normal / elite). */
const formOf = (tier, elite) => FORMS[elite ? (tier === 5 ? '2/60/7/1' : '2/60/7/3') : '2/1/4/0'];
const skillOf = (tier, elite, id) => formOf(tier, elite).skills.find((s) => s.skillId === id);
const approx = (a, b, msg, eps = 1e-6) => assert.ok(Math.abs(a - b) <= eps * Math.max(1, Math.abs(b)), `${msg}: ${a} vs ${b}`);
const dummy = (key, o = {}) => enemyRec({ key, hp: 1e9, speed: 0, mass: 0, ...o });
const ENEMIES = {
  enemy_dummy: dummy('enemy_dummy'),
  enemy_fly: dummy('enemy_fly', { motion: 'FLY' }),
  enemy_atk: dummy('enemy_atk', { range: 1, atk: 100, bat: 1 }),
};
/** Every 自选 form of hers: [tier, elite]. */
const FORMS_ALL = [[5, false], [6, false], [5, true], [6, true]];

/** A battle with 国度 as uid 1 at (row, col), plus `others`. */
function field({ tier = 6, elite = true, skill = 2, row = 10, col = 5, others = [], seed = 5 } = {}) {
  const h = makeBattle({
    defs: { enemies: ENEMIES }, timeLimit: 600, autoFinish: false, seed,
    flags: { dpPerSec: 0, dpMax: 999 }, hooks: ['damaged', 'skillStart', 'skillEnd', 'statusApplied', 'hit'], captureNoisy: true,
    units: [{ uid: 1, diy: { slot: SLOT[tier], charId: DMINON, skillIndex: skill, uniEquipId: null }, elite, row, col }, ...others],
  });
  h.step();
  return { h, u: h.unit(1) };
}
const guoKeys = (u) => {
  const keys = new Set(u.rangeKeys);
  for (const k of u.mem.dminonSpread || []) keys.add(k);
  return keys;
};
const talentHits = (h, u) => h.hooksOf('damaged').filter((c) => c.source === u && (c.dmg?.tags || []).includes('dminon:guo'));
const spreadHits = (h, u) => h.hooksOf('damaged').filter((c) => c.source === u && (c.dmg?.tags || []).includes('dminon:spread'));
const atkHits = (h, u) => h.hooksOf('damaged').filter((c) => c.source === u && c.dmg?.isAttack);
function done(h) {
  checkInvariants(h.b);
  assert.equal(h.b.errors.length, 0, JSON.stringify(h.b.errors[0]));
}
const label = ([tier, elite]) => `T${tier} ${elite ? 'elite' : 'normal'}`;

test('国度 in every 自选 form: her kit (all three skills authored), the form\'s stats, 伏击客 (melee, every enemy of the range, ground only, 50 % dodge, taunt −1 — not −2), blocks 0, y-1, no module, the data triggers', () => {
  assert.equal(OPERATOR_KITS[DMINON], KITS[DMINON]);
  for (const f of FORMS_ALL) {
    const [tier, elite] = f;
    for (const skill of [0, 1, 2]) {
      const { h, u } = field({ tier, elite, skill });
      const form = formOf(tier, elite);
      assert.deepEqual([u.def.charId, u.def.diyFor, u.skill.id, !!u.kit.generic, u.kit.skillSource], [DMINON, SLOT[tier], form.skills[skill].skillId, false, 'skills'], label(f));
      assert.deepEqual([u.base.maxHp, u.base.atk, u.base.def, u.base.res], [form.stats.maxHp, form.stats.atk, form.stats.def, form.stats.res], `${label(f)}: stats`);
      assert.deepEqual([u.s.blockCnt, u.profile.attack, u.profile.canHitFly, u.base.bat, u.profile.allInRange], [0, 'melee', false, 3.5, true], `${label(f)}: 伏击客`);
      assert.deepEqual([u.s.dodgePhys, u.s.dodgeArts, u.s.taunt], [0.5, 0.5, -1], `${label(f)}: 50 % dodge, taunt −1 (the data's, not the profile's second −1)`);
      assert.deepEqual(u.liveRangeGrid, form.rangeGrid, `${label(f)}: y-1`);
      assert.deepEqual([u.def.bonds, u.def.raw.garrisonIds], [['emptyShip'], []], `${label(f)}: bonds / no 特质`);
      assert.deepEqual([(u.def.raw.module ?? {}).id ?? null, (u.def.raw.module ?? {}).active ?? false, form.modules ?? []], [null, false, []], `${label(f)}: no module`);
      done(h);
    }
  }
  // the numbers of the forms (zh_CN, full potential 潜能 6): E2 Lv1 1208 / 741 / 294 / 30 %, E2 Lv60 1461 / 864 / 328 / 30 %
  assert.deepEqual([FORMS['2/1/4/0'].stats.maxHp, FORMS['2/1/4/0'].stats.atk, FORMS['2/60/7/3'].stats.maxHp, FORMS['2/60/7/3'].stats.atk], [1208, 741, 1461, 864]);
  assert.deepEqual([skillOf(6, true, S1).rangeId, skillOf(6, true, S2).rangeId, skillOf(6, true, S3).rangeId], [null, 'y-3', 'y-10']);
  assert.deepEqual([skillOf(6, true, S2).trigger.rule, skillOf(6, true, S3).trigger.rule], ['ACTIVE_RANGE', 'ACTIVE_RANGE']);
});

test('a 自选 pick: 国度 is offered at tiers 5 and 6 (she has a kit) and a roster with her passes validateDiyPicks', () => {
  const data = { chess: CHESS, backups: BACKUPS };
  assert.ok(KITTED_CHARS.includes(DMINON));
  for (const t of [5, 6]) assert.ok(diyPool(t, { data, kitted: KITTED_CHARS }).includes(DMINON), `tier ${t}`);
  assert.deepEqual(validateDiyPicks({ [SLOT[5]]: { charId: DMINON, skillIndex: 2, uniEquipId: null } }, { data, kitted: KITTED_CHARS }),
    { ok: true, picks: { [SLOT[5]]: { charId: DMINON, skillIndex: 2, uniEquipId: null } } });
});

test('T1 实质坍缩: 「国度」 is her own range — every ground enemy inside takes atk_scale × ATK arts every second and ASPD −15; flyers and enemies outside get nothing', () => {
  for (const [tier, elite] of [[5, false], [6, true]]) {
    const { h, u } = field({ tier, elite, skill: 0 });
    const tb = formOf(tier, elite).talents[0].bb;
    const e = h.spawn('enemy_dummy', { pos: [10, 6] });
    const out = h.spawn('enemy_dummy', { pos: [12, 5] });
    const fly = h.spawn('enemy_fly', { pos: [10, 7] });
    const [hpOut, hpFly] = [out.hp, fly.hp];
    h.run(2.05);
    const hits = talentHits(h, u);
    assert.equal(hits.length, 2, `${label([tier, elite])}: two pulses in 2.05 s`);
    for (const c of hits) {
      assert.equal(c.target, e, `${label([tier, elite])}: only the enemy inside 国度`);
      approx(c.amount, u.s.atk * tb.atk_scale, `${label([tier, elite])}: ${tb.atk_scale * 100} % ATK`);
      assert.deepEqual([c.type, c.dmg.canDodge], ['arts', false], `${label([tier, elite])}: arts, not dodgeable`);
    }
    assert.equal(hpOut, out.hp, `${label([tier, elite])}: outside 国度 untouched`);
    assert.equal(hpFly, fly.hp, `${label([tier, elite])}: flyers untouched`);
    assert.deepEqual(e.findBuff('talent:dminon:guo')?.mods, { aspd: tb.attack_speed }, `${label([tier, elite])}: ASPD ${tb.attack_speed}`);
    assert.equal(out.findBuff('talent:dminon:guo'), null);
    assert.equal(fly.findBuff('talent:dminon:guo'), null);
    done(h);
  }
});

test('T2 此身为界: on her RETREAT every ground enemy inside 国度 takes atk_scale × ATK arts and 5 s stun, then the field is gone; a knock-out does not fire it', () => {
  for (const [tier, elite] of [[5, false], [6, true]]) {
    const { h, u } = field({ tier, elite, skill: 0 });
    const tb = formOf(tier, elite).talents[1].bb;
    const e = h.spawn('enemy_dummy', { pos: [10, 6] });
    const far = h.spawn('enemy_dummy', { pos: [12, 5] });
    h.run(0.5);
    const [hp, hpFar] = [e.hp, far.hp];
    h.b.retreat(u);
    h.run(0.1);
    const bursts = h.hooksOf('damaged').filter((c) => (c.dmg?.tags || []).includes('dminon:retreat'));
    assert.equal(bursts.length, 1, `${label([tier, elite])}: one burst, on the enemy inside 国度`);
    assert.equal(bursts[0].target, e);
    approx(bursts[0].amount, u.s.atk * tb.atk_scale, `${label([tier, elite])}: ${tb.atk_scale * 100} % ATK`);
    approx(hp - e.hp, u.s.atk * tb.atk_scale, `${label([tier, elite])}: the burst is all it took`);
    assert.equal(hpFar, far.hp, `${label([tier, elite])}: enemies outside 国度 untouched`);
    const stuns = h.hooksOf('statusApplied').filter((c) => c.status === 'stun' && c.target === e);
    assert.equal(stuns.length, 1, `${label([tier, elite])}: 晕眩`);
    approx(stuns[0].duration, tb.stun, `${label([tier, elite])}: stun ${tb.stun} s`);
    assert.equal(u.mem.dminonSpread, null, `${label([tier, elite])}: the field is gone`);
    done(h);
  }
  // a knock-out (not a retreat) fires nothing
  const { h, u } = field({ skill: 0 });
  const e = h.spawn('enemy_dummy', { pos: [10, 6] });
  h.run(0.4);
  const hp = e.hp;
  h.b.kill(u, null);
  h.run(0.1);
  assert.equal(h.hooksOf('damaged').filter((c) => (c.dmg?.tags || []).includes('dminon:retreat')).length, 0, 'a death fires no burst');
  assert.equal(e.hp, hp);
});

test('S1 停步 (MANUAL, 20 s): ASPD +70; the first time each enemy is inside 国度 it gets 停顿 4 s — once per enemy per cast', () => {
  for (const [tier, elite] of [[5, false], [6, true]]) {
    const sk = skillOf(tier, elite, S1);
    const { h, u } = field({ tier, elite, skill: 0 });
    const e1 = h.spawn('enemy_dummy', { pos: [10, 6] });
    const e2 = h.spawn('enemy_dummy', { pos: [9, 5] });
    const out = h.spawn('enemy_dummy', { pos: [12, 5] });
    u.skill.gainSp(999);
    assert.ok(h.runUntil(() => u.skill.active, 3), `${label([tier, elite])}: cast`);
    approx(u.s.interval, 3.5 * 100 / (100 + sk.bb.attack_speed), `${label([tier, elite])}: ASPD +${sk.bb.attack_speed}`);
    const slows = () => h.hooksOf('statusApplied').filter((c) => c.status === 'sluggish');
    h.run(1.2);
    assert.equal(slows().length, 2, `${label([tier, elite])}: both enemies inside 国度 slowed once`);
    for (const c of slows()) approx(c.duration, sk.bb.sluggish, `${label([tier, elite])}: 停顿 ${sk.bb.sluggish} s`);
    assert.deepEqual(slows().map((c) => c.target).sort((a, b) => a.id - b.id), [e1, e2].sort((a, b) => a.id - b.id), `${label([tier, elite])}: only the two inside`);
    h.run(6);
    assert.equal(slows().filter((c) => c.target === e1).length, 1, `${label([tier, elite])}: never again for the same enemy`);
    assert.equal(slows().filter((c) => c.target === e2).length, 1, `${label([tier, elite])}: nor for the other`);
    assert.ok(!slows().some((c) => c.target === out), `${label([tier, elite])}: the one outside never`);
    h.runUntil(() => !u.skill.active, 30);
    approx(u.s.interval, 3.5, `${label([tier, elite])}: interval back`);
    done(h);
  }
});

test('S2 受戮 (MANUAL, 20 s, data ACTIVE_RANGE on its y-3): range y-3, ATK +55 %, the enemies inside 国度 cannot dodge her physical attacks; the second cast adds ASPD +30 and never ends', () => {
  for (const [tier, elite] of [[5, false], [6, true]]) {
    const sk = skillOf(tier, elite, S2);
    const { h, u } = field({ tier, elite, skill: 1 });
    h.spawn('enemy_dummy', { pos: [10, 6] });
    const n0 = atkHits(h, u).length;
    h.run(4);
    const before = atkHits(h, u).slice(n0);
    assert.ok(before.length > 0, `${label([tier, elite])}: she attacks without the skill`);
    assert.ok(before.every((c) => c.dmg.canDodge === true), `${label([tier, elite])}: a normal attack may be dodged (canDodge true)`);
    u.skill.gainSp(999);
    assert.ok(h.runUntil(() => u.skill.active, 3), `${label([tier, elite])}: cast`);
    assert.deepEqual(u.liveRangeGrid, sk.rangeGrid, `${label([tier, elite])}: y-3`);
    approx(u.s.atk, u.base.atk * (1 + sk.bb.atk), `${label([tier, elite])}: ATK +${sk.bb.atk * 100} %`);
    const n1 = atkHits(h, u).length;
    h.run(4);
    const during = atkHits(h, u).slice(n1);
    assert.ok(during.length > 0, `${label([tier, elite])}: attacks while active`);
    assert.ok(during.every((c) => c.dmg.canDodge === false), `${label([tier, elite])}: enemies inside 国度 cannot dodge`);
    approx(u.s.interval, 3.5, `${label([tier, elite])}: ASPD unchanged on the first cast`);
    // the second cast: +ASPD and no end
    assert.ok(h.runUntil(() => !u.skill.active, 30), `${label([tier, elite])}: the first cast ends`);
    u.skill.gainSp(999);
    assert.ok(h.runUntil(() => u.skill.active, Math.ceil(u.skill.spCost) + 3), `${label([tier, elite])}: cast again`);
    assert.equal(u.mem.dminonS2Casts, 2, `${label([tier, elite])}: second cast`);
    approx(u.s.interval, 3.5 * 100 / (100 + sk.bb.attack_speed), `${label([tier, elite])}: ASPD +${sk.bb.attack_speed}`);
    assert.equal(u.skill.timeLeft, Infinity, `${label([tier, elite])}: 持续时间无限`);
    h.run(40);
    assert.ok(u.skill.active, `${label([tier, elite])}: still on 40 s later`);
    done(h);
  }
});

test('S3 无人的国度 (MANUAL, 36 s, data ACTIVE_RANGE on its y-10): range y-10, ATK +70 %, ASPD +30, every enemy of the range struck at once; a ground enemy hitting one of our units on 国度 spreads 国度 around itself for 60 % ATK physical (≤ 1 / 0.5 s); the field resets when it ends', () => {
  for (const [tier, elite] of [[5, false], [6, true]]) {
    const sk = skillOf(tier, elite, S3);
    const others = [{ uid: 2, chessId: 'chess_char_4_02_a', row: 9, col: 5 }];
    const { h, u } = field({ tier, elite, skill: 2, others });
    const ally = h.unit(2);
    const foe = h.spawn('enemy_atk', { pos: [9, 6] });        // ground enemy next to the ally on 国度
    const victim = h.spawn('enemy_dummy', { pos: [9, 7] });   // outside her y-1 range, a spread tile once the field grows
    const far = h.spawn('enemy_dummy', { pos: [10, 7] });
    u.skill.gainSp(999);
    assert.ok(h.runUntil(() => u.skill.active, 3), `${label([tier, elite])}: cast`);
    assert.deepEqual(u.liveRangeGrid, sk.rangeGrid, `${label([tier, elite])}: y-10`);
    approx(u.s.atk, u.base.atk * (1 + sk.bb.atk), `${label([tier, elite])}: ATK +${sk.bb.atk * 100} %`);
    approx(u.s.interval, 3.5 * 100 / (100 + sk.bb.attack_speed), `${label([tier, elite])}: ASPD +${sk.bb.attack_speed}`);
    const n0 = atkHits(h, u).length;
    h.run(6);
    const hits = atkHits(h, u).slice(n0);
    const targets = new Set(hits.map((c) => c.target));
    assert.ok(targets.has(far) && targets.has(foe), `${label([tier, elite])}: every enemy of the (now y-10) range is struck at once`);
    const sp = spreadHits(h, u);
    assert.ok(sp.length >= 1, `${label([tier, elite])}: the field spread when the ally on 国度 was hit`);
    for (const c of sp) {
      approx(c.amount, u.s.atk * sk.bb['attack@aoe_atk_scale'], `${label([tier, elite])}: ${sk.bb['attack@aoe_atk_scale'] * 100} % ATK`);
      assert.equal(c.type, 'phys', `${label([tier, elite])}: physical`);
      assert.ok(guoKeys(u).has(c.target.tileR * COLS + c.target.tileC), `${label([tier, elite])}: the victim stands on a 国度 tile`);
    }
    assert.ok(u.mem.dminonSpread.size >= 1, `${label([tier, elite])}: tiles added`);
    assert.ok(sp.some((c) => c.target === victim), `${label([tier, elite])}: the enemy on the spread tile took it`);
    assert.ok(sp.length <= Math.ceil(6 / sk.bb['attack@cd']) + 1, `${label([tier, elite])}: ${sp.length} spreads in 6 s (≤ 1 / ${sk.bb['attack@cd']} s)`);
    assert.equal(ally.alive, true);
    h.runUntil(() => !u.skill.active, 45);
    assert.equal(u.mem.dminonSpread, null, `${label([tier, elite])}: 技能结束后重置场上的国度状态`);
    done(h);
  }
});
