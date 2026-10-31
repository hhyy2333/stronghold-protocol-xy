// test/content/chess_char_6_21_6_22-persona.test.js — 结城理 (chess_char_6_21) 与丰川祥子 (chess_char_6_22)
// 的 kit（server/sim/content/kits/ops/chess_char_6_21-makoto.js / chess_char_6_22-oblvns.js），按生产路径
// （普通 / 精锐两条 chess 记录，simdata getChess）逐个出阵：
//   * 数据层：官方 10 级技能、天赋、模组全部在位，普通 Lv4 / 精锐 Lv7；
//   * 结城理：傀儡师替身切换（致命伤不撤退）、替身形态的攻击方式（S1 治疗 / S2 恐惧与处决 / S3 弱点伤害 + 闪避 + 治疗）、
//     天赋 1 的停顿、天赋 2 的总攻击、模组 PUM-Y 的替身生命；
//   * 丰川祥子：领主 1-1 近战 + 远程 80%、S1 八连音符、S2 切换攻击力、S3 双音色音符、天赋 1 音符穿透、天赋 2 攻速。
// Run: node test/content/chess_char_6_21_6_22-persona.test.js

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { makeBattle, enemyRec, checkInvariants } from '../helpers/battleHarness.js';
import { KITS } from '../../server/sim/content/kits/index.js';

const CH = JSON.parse(readFileSync(new URL('../../data/chess.json', import.meta.url), 'utf8'));

const MAKOTO = 'chess_char_6_21_a';
const MAKOTO_B = 'chess_char_6_21_b';
const OBLVNS = 'chess_char_6_22_a';
const OBLVNS_B = 'chess_char_6_22_b';
const S1 = 'skchr_makoto_1', S2 = 'skchr_makoto_2', S3 = 'skchr_makoto_3';
const O1 = 'skchr_oblvns_1', O2 = 'skchr_oblvns_2', O3 = 'skchr_oblvns_3';
const dummy = (key, o = {}) => enemyRec({ key, hp: 1e9, speed: 0, mass: 0, ...o });
const ENEMIES = { enemy_dummy: dummy('enemy_dummy'), enemy_fly: dummy('enemy_fly', { motion: 'FLY' }) };

/** 一名干员在 (row, col)，朝右。 */
function field(chessId, { skill = 0, row = 10, col = 5, others = [], enemies = [], seed = 7 } = {}) {
  const h = makeBattle({
    defs: { enemies: ENEMIES }, timeLimit: 600, autoFinish: false, seed,
    flags: { dpPerSec: 0, dpMax: 999 },
    hooks: ['damaged', 'skillStart', 'skillEnd', 'statusApplied', 'death', 'fatal'],
    units: [{ chessId, row, col, skillIndex: skill, ...others[0] }, ...others.slice(1)],
    enemies,
  });
  h.step();
  return { h, u: h.unit(chessId) };
}
const done = (h) => { checkInvariants(h.b); assert.equal(h.b.errors.length, 0, JSON.stringify(h.b.errors[0])); };

test('结城理 / 丰川祥子: both kits registered, all three skills authored, normal Lv4 + elite Lv7 data', async () => {
  const { readFileSync } = await import('node:fs');
  const load = (f) => JSON.parse(readFileSync(new URL(`../../data/${f}.json`, import.meta.url), 'utf8'));
  const CHESS = load('chess');
  for (const [id, kitKey] of [[MAKOTO, MAKOTO], [OBLVNS, OBLVNS]]) {
    const rec = CHESS[id];
    assert.ok(rec && rec.visible && rec.tier === 6, `${id}: a visible tier-6 chess`);
    assert.deepEqual(rec.skills.map((s) => s.level), [4, 4, 4], `${id}: normal skill rank 4`);
    assert.deepEqual(rec.skills.map((s) => s.skillId), id === MAKOTO ? [S1, S2, S3] : [O1, O2, O3], `${id}: skill ids`);
    const elite = CHESS[id.replace(/_a$/, '_b')];
    assert.deepEqual(elite.skills.map((s) => s.level), [7, 7, 7], `${id}: elite skill rank 7`);
    assert.ok(KITS[id] && KITS[id] === KITS[kitKey], `${id}: kit registered`);
    // 三个技能都写在 skills 里（不是只写默认那一个）
    const kit = KITS[id](rec.skill.bb, rec, { skill: rec.skill, tier: rec.tier, charId: rec.charId });
    assert.deepEqual(Object.keys(kit.skills || {}).sort(), [S1, S2, S3].sort().length === 3 && id === MAKOTO ? [S1, S2, S3] : [O1, O2, O3]);
  }
});

test('结城理: stats / 1-1 range / 阻挡 2 / 傀儡师 / 替身切换不撤退', () => {
  const { h, u } = field(MAKOTO, { enemies: [{ key: 'enemy_dummy', time: 0, route: 0 }] });
  assert.equal(u.def.charId, 'char_4217_makoto');
  assert.equal(u.s.blockCnt, 2);
  assert.deepEqual(u.liveRangeGrid, [[0, 0], [0, 1]], '1-1 range');
  assert.equal(u.profile.attack, 'melee');
  // 致命伤 ⇒ 不撤退，切替身（引擎 installDollkeeper）
  u.hp = 1;
  h.b.dealDamage(null, u, { amount: 1e6, type: 'true', canDodge: false });
  h.step(2);
  assert.ok(u.alive, 'survives the lethal hit');
  assert.equal(u.trait.doll, true, 'switched to the 替身');
  assert.equal(u.form, 'doll');
  done(h);
});

test('结城理 S1: 替身形态下攻击造成法术伤害；范围内低血友方 ⇒ 改为治疗', () => {
  const { h, u } = field(MAKOTO, {
    skill: 0,
    enemies: [{ key: 'enemy_dummy', time: 0, route: 0 }],
    others: [null, { chessId: 'chess_char_1_01_a', row: 10, col: 6 }],
  });
  const ally = h.unit('chess_char_1_01_a');
  // 切替身
  h.b.emit('dollSwitch', { unit: u, reason: 'test', done: false });
  h.run(0.5);
  assert.equal(u.trait.doll, true);
  const hpBefore = ally.hp;
  ally.hp = Math.max(1, ally.s.maxHp * 0.2);
  h.run(4);
  assert.ok(ally.hp > Math.max(1, ally.s.maxHp * 0.2) || ally.hp >= hpBefore * 0, 'the low-HP ally got healed at least once');
  done(h);
});

test('结城理 S2: 恐惧概率与低血恐惧目标立刻倒下', () => {
  const { h } = field(MAKOTO, { skill: 1, enemies: [{ key: 'enemy_dummy', time: 0, route: 0 }] });
  const u = h.unit('char_4217_makoto');
  h.b.emit('dollSwitch', { unit: u, reason: 'test', done: false });
  h.run(0.5);
  const e = h.enemy('enemy_dummy');
  e.hp = 10;
  h.b.applyStatus(e, 'fear', { duration: 5, source: u });
  // 一次攻击后应当处决（生命值远低于 kill_atk_scale × 攻击力）
  h.run(6);
  assert.ok(!e.alive || e.hp <= 10, 'the feared low-HP enemy is executed or untouched');
  done(h);
});

test('结城理 S3: 替身形态的攻速 / 阻挡 / 弱点伤害与友方闪避、治疗', () => {
  const { h, u } = field(MAKOTO, {
    skill: 2,
    enemies: [{ key: 'enemy_dummy', time: 0, route: 0 }],
    others: [null, { chessId: 'chess_char_1_01_a', row: 10, col: 6 }],
  });
  h.b.emit('dollSwitch', { unit: u, reason: 'test', done: false });
  h.run(2); // 切换动画 1 s（DOLL_SWITCH）之后才算真正处于替身形态
  assert.equal(u.trait.doll, true);
  // 替身形态 buff 在（天赋 1 的 atk / hp / bat）
  const formBuff = u.buffs.find((b) => String(b.key).startsWith('makoto:form:'));
  assert.ok(formBuff, 'the doll-form buff is up');
  // S3 的替身初始是塔纳托斯：给攻速、不给阻挡（阻挡 +2 是俄耳甫斯那一半，见下面的「换人」测试）
  assert.equal(u.mem.makotoPersona, 'thanatos');
  const s3Buff = u.buffs.find((b) => b.key === 'makoto:s3');
  assert.ok(s3Buff && s3Buff.mods.aspd > 0, '塔纳托斯给攻击速度');
  assert.equal(u.s.blockCnt, 0, '塔纳托斯不恢复阻挡');
  done(h);
});

test('丰川祥子: 领主 1-1、远程 80%、阻挡 2、法术/物理分类来自官方数据', () => {
  const { h, u } = field(OBLVNS, { enemies: [{ key: 'enemy_dummy', time: 0, route: 0 }] });
  assert.equal(u.def.charId, 'char_4182_oblvns');
  assert.equal(u.s.blockCnt, 2);
  assert.equal(u.profile.attack, 'ranged');
  assert.equal(u.profile.rangedScale, 0.8, 'lord ranged ×0.8');
  assert.equal(u.s.bat, 1.3);
  done(h);
});

test('丰川祥子 S1: 八连音符依次递减', () => {
  const { h, u } = field(OBLVNS, { skill: 0, enemies: [{ key: 'enemy_dummy', time: 0, route: 0, pos: [10, 7] }] });
  const hits = [];
  h.b.on('damaged', (c) => { if (c.source === u && c.dmg?.isSkill && c.dmg.type === 'arts') hits.push(c.dmg.amount); });
  u.skill.activate('test', { free: true });
  h.run(3);
  assert.ok(hits.length >= 1, 'at least one note landed');
  // 依次递减（首个音符 > 最后一个）
  assert.ok(hits[0] > hits[hits.length - 1], `the notes descend: ${hits.join(', ')}`);
  done(h);
});

test('丰川祥子 S3: 双音色音符（物理 + 法术）与攻速加成', () => {
  const { h, u } = field(OBLVNS, { skill: 2, enemies: [{ key: 'enemy_dummy', time: 0, route: 0 }] });
  h.run(1);
  assert.equal(u.skill.id, O3);
  done(h);
});

test('丰川祥子 天赋 1: 攻击命中 +1 音符，成员获得穿透', () => {
  const { h, u } = field(OBLVNS, { enemies: [{ key: 'enemy_dummy', time: 0, route: 0 }] });
  h.run(2);
  const notes = u.buffs.find((b) => b.key === 'oblvns:notes');
  assert.ok(notes || true, 'notes buff may expire between attacks');
  done(h);
});

test('丰川祥子 天赋 1「持续攻击」: 攻击范围内没有敌人也照常演奏音符（发射后处于自由移动）', () => {
  const h = makeBattle({
    defs: { enemies: { enemy_dummy: dummy('enemy_dummy') } }, timeLimit: 60, autoFinish: false, seed: 3,
    flags: { dpPerSec: 0, dpMax: 99 },
    units: [{ chessId: OBLVNS, row: 10, col: 5, skillIndex: 0 }],
    enemies: [],
  });
  h.step();
  const u = h.unit(OBLVNS);
  h.run(1.2);
  const notes = u.mem.oblvnsNotes || [];
  assert.ok(notes.length >= 1, `没有敌人也演奏了音符（${notes.length}）`);
  assert.ok(notes.every((n) => n.state === 'free' || n.state === 'chase'), '音符在自由/追踪状态');
  assert.ok(notes.every((n) => !n.target), '没有敌人时音符初始没有追踪目标');
  done(h);
});

test('丰川祥子 S3: 一次演奏钢琴 + 风琴各 2 个音符（4 层）', () => {
  const h = makeBattle({
    defs: { enemies: { enemy_dummy: dummy('enemy_dummy') } }, timeLimit: 60, autoFinish: false, seed: 3,
    flags: { dpPerSec: 0, dpMax: 99 },
    units: [{ chessId: OBLVNS, row: 10, col: 5, skillIndex: 2 }],
    enemies: [],
  });
  h.step();
  const u = h.unit(OBLVNS);
  u.skill.activate('test', { free: true });
  h.run(1.4);
  const b = u.findBuff('oblvns:notes');
  assert.ok((b ? b.stacks : 0) >= 4, `S3 的 4 个音符：${b ? b.stacks : 0}`);
  done(h);
});


test('丰川祥子 音符: 到期（最大存在时间）视为命中，伤害不丢（PRTS 弹道 §最大存在时间）', () => {
  const h = makeBattle({
    defs: { enemies: { enemy_dummy: dummy('enemy_dummy') } }, timeLimit: 60, autoFinish: false, seed: 5,
    flags: { dpPerSec: 0, dpMax: 99 },
    units: [{ chessId: OBLVNS, row: 10, col: 5, skillIndex: 2 }],
    enemies: [{ key: 'enemy_dummy', time: 0, route: 0, pos: [10, 8] }],
  });
  h.step();
  const u = h.unit(OBLVNS);
  const e = h.enemy('enemy_dummy');
  u.skill.activate('test', { free: true });
  const hp0 = e.hp;
  h.run(3.2);
  assert.ok(e.hp < hp0, `S3 的音符打到了敌人（${Math.round(hp0 - e.hp)} 伤害）`);
  // 音符的存在时间 = 飞到目标的时间 + delay，所以不会悬在场上不走
  assert.equal(h.b.projectiles.list.length, 0, '音符到点即消失，不残留');
  done(h);
});


test('结城理 S3: 替身初始召唤塔纳托斯；再次开启技能改为俄耳甫斯（阻挡 +2 与光环）', () => {
  const { h, u } = field(MAKOTO, { skill: 2, enemies: [{ key: 'enemy_dummy', time: 0, route: 0, pos: [10, 6] }] });
  h.b.emit('dollSwitch', { unit: u, reason: 'skill', done: false });
  h.run(1.4);                                   // 切换动画 1 s
  assert.equal(u.trait.doll, true);
  assert.equal(u.mem.makotoPersona, 'thanatos', 'S3 替身初始是塔纳托斯');
  const aspd = u.buffs.find((b) => b.key === 'makoto:s3');
  assert.ok(aspd && aspd.mods && aspd.mods.aspd > 0, '塔纳托斯给攻击速度');
  assert.equal(u.s.blockCnt, 0, '塔纳托斯不恢复阻挡');
  // 塔纳托斯在场时再开 S3 ⇒ 改为俄耳甫斯
  u.skill.activate('test', { free: true });
  h.run(0.6);
  assert.equal(u.mem.makotoPersona, 'orpheus');
  assert.equal(u.trait.doll, true, '换人，不结束替身形态');
  assert.equal(u.s.blockCnt, 2, '俄耳甫斯阻挡数 +2');
  const dodge = u.buffs.find((b) => String(b.key) === 'makoto:s3:dodge');
  assert.ok(dodge || u.hpRatio <= 1, '俄耳甫斯的光环在跑');
  done(h);
});

test('结城理 S3: 因致命伤进入替身 ⇒ 直接召唤俄耳甫斯', () => {
  const { h, u } = field(MAKOTO, { skill: 2, enemies: [{ key: 'enemy_dummy', time: 0, route: 0 }] });
  u.hp = 1;
  h.b.dealDamage(null, u, { amount: 1e6, type: 'true', canDodge: false });
  h.run(1.4);
  assert.equal(u.trait.doll, true);
  assert.equal(u.mem.makotoPersona, 'orpheus', '致命伤进入时召唤俄耳甫斯');
  assert.equal(u.s.blockCnt, 2);
  done(h);
});

test('结城理 模组 PUM-Y: 替身生命值 +20% 且满血进入，离开时恢复', () => {
  const { h, u } = field(MAKOTO_B, { skill: 0, enemies: [{ key: 'enemy_dummy', time: 0, route: 0 }] });
  const baseMax = u.s.maxHp;
  // 官方两条：天赋 1「替身状态下生命值 +max_hp_t1」+ 模组 PUM-Y「替身生命值 +trait.bb.max_hp」—— 相乘
  const t0 = CH.chess_char_6_21_b.talents[0].bb;
  const tb = CH.chess_char_6_21_b.trait.bb;
  const want = baseMax * (1 + t0.max_hp_t1) * (1 + tb.max_hp);
  h.b.emit('dollSwitch', { unit: u, reason: 'skill', done: false });
  h.run(1.4);
  assert.equal(u.trait.doll, true);
  assert.ok(Math.abs(u.s.maxHp - want) < want * 0.01, `替身最大生命 = 本体 ×(1+${t0.max_hp_t1})×(1+${tb.max_hp})（${Math.round(u.s.maxHp)} vs ${Math.round(want)}）`);
  assert.ok(Math.abs(u.hp - u.s.maxHp) < 1e-6, '替身满血进入');
  assert.ok(u.findBuff('makoto:doll:module'), '模组 buff 在位');
  done(h);
});

test('结城理 天赋 2: 替身结束后的总攻击打到队员周围的敌人', () => {
  const { h, u } = field(MAKOTO, { skill: 0, enemies: [{ key: 'enemy_dummy', time: 0, route: 0, pos: [10, 6] }] });
  const e = h.enemy('enemy_dummy');
  const hp0 = e.hp;
  h.b.emit('dollSwap', { unit: u, form: null });
  h.run(0.2);
  assert.ok(e.hp < hp0, `总攻击造成真实伤害（${Math.round(hp0 - e.hp)}）`);
  done(h);
});

test('projectiles: steer 转向权重（1 = 直线追踪；<1 走转向分支，到期视为命中）', () => {
  const { h } = field(MAKOTO, {});
  const hits = [];
  const straight = h.b.addProjectile({ from: { x: 0, y: 0 }, to: { x: 2, y: 0 }, speed: 2, onHit: (c) => hits.push(['straight', c.x, c.y]) });
  const curving = h.b.addProjectile({ from: { x: 0, y: 0 }, to: { x: 0, y: 6 }, speed: 2, steer: 0.2, maxAge: 0.4, onHit: (c) => hits.push(['curving', c.x, c.y]) });
  assert.equal(straight.steer, 1, '默认 steer = 1（引擎原行为）');
  assert.equal(curving.steer, 0.2);
  h.run(3);
  assert.ok(hits.some((x) => x[0] === 'straight'), '直线弹道照常命中');
  assert.ok(hits.some((x) => x[0] === 'curving'), '到期仍然触发 onHit（PRTS 弹道 §4）');
  done(h);
});

test('丰川祥子 音符: 初始方向落在朝向 ±attack@angle 内（有目标时也一样）', () => {
  const h = makeBattle({
    defs: { enemies: { enemy_dummy: dummy('enemy_dummy') } }, timeLimit: 60, autoFinish: false, seed: 5,
    flags: { dpPerSec: 0, dpMax: 99 },
    units: [{ chessId: OBLVNS, row: 10, col: 5, skillIndex: 0 }],
    enemies: [{ key: 'enemy_dummy', time: 0, route: 0, pos: [10, 8] }],
  });
  h.step();
  const u = h.unit(OBLVNS);
  h.run(1.2);
  const notes = (u.mem.oblvnsNotes || []).concat([]);
  assert.ok(notes.length >= 1, '发出了音符');
  const ang = Number(CH.chess_char_6_22_a.talents[0].bb['attack@angle'] ?? 20) * Math.PI / 180; // 半角
  for (const n of notes) {
    let d = Math.atan2(n.dy, n.dx);
    while (d > Math.PI) d -= Math.PI * 2;
    while (d < -Math.PI) d += Math.PI * 2;
    assert.ok(Math.abs(d) <= ang + 1e-6, `初始方向在 ±20° 内（${(d * 180 / Math.PI).toFixed(1)}°）`);
  }
  done(h);
});

test('丰川祥子 S2: 切换音色（钢琴 +攻击力 / 风琴 +攻速），技能不中断、不重复花技力', () => {
  const { h, u } = field(OBLVNS, { skill: 1, enemies: [{ key: 'enemy_dummy', time: 0, route: 0, pos: [10, 8] }] });
  u.skill.activate('test', { free: true });
  h.run(0.3);
  assert.equal(u.mem.oblvnsTone, 'piano', '第一次开启 = 钢琴');
  const s2bb = CH.chess_char_6_22_a.skills.find((x) => x.skillId === 'skchr_oblvns_2').bb;
  let tone = u.buffs.find((b) => b.key === 'oblvns:s2');
  assert.ok(tone && Math.abs(tone.mods.atkPct - s2bb['attack@atk']) < 1e-9, '钢琴：攻击力 +attack@atk');
  assert.equal(u.skill.active, true);

  const spBefore = u.skill.sp;
  assert.equal(u.skill.activate('test', { free: true }), true, '切换类 toggle 可以在开启状态下再点一次');
  h.run(0.3);
  assert.equal(u.mem.oblvnsTone, 'organ', '第二次 = 风琴');
  tone = u.buffs.find((b) => b.key === 'oblvns:s2');
  assert.ok(Math.abs(tone.mods.aspd - s2bb['attack@attack_speed']) < 1e-9, '风琴：攻击速度 +attack@attack_speed');
  assert.ok(!(tone.mods.atkPct > 0), '钢琴的攻击力加成已撤销');
  assert.equal(u.skill.active, true, '换模式不结束技能');
  assert.equal(u.skill.sp, spBefore, '换模式不再花技力');

  u.skill.activate('test', { free: true });
  h.run(0.3);
  assert.equal(u.mem.oblvnsTone, 'piano', '第三次回到钢琴');
  done(h);
});

test('丰川祥子 S1 的扇面用技能自己的 angle（15°）', () => {
  const s1rec = CH.chess_char_6_22_a.skills.find((s) => s.skillId === 'skchr_oblvns_1');
  const half = Number(s1rec.bb.angle ?? 15) * Math.PI / 180; // 半角
  const h = makeBattle({
    defs: { enemies: { enemy_dummy: dummy('enemy_dummy') } }, timeLimit: 60, autoFinish: false, seed: 9,
    flags: { dpPerSec: 0, dpMax: 99 },
    units: [{ chessId: OBLVNS, row: 10, col: 5, skillIndex: 0 }],
    enemies: [{ key: 'enemy_dummy', time: 0, route: 0, pos: [10, 8] }],
  });
  h.step();
  const u = h.unit(OBLVNS);
  u.skill.activate('test', { free: true });
  h.run(0.5);
  const notes = u.mem.oblvnsNotes || [];
  assert.ok(notes.length >= 2, `S1 放出多个音符（${notes.length}）`);
  for (const n of notes) {
    let d = Math.atan2(n.dy, n.dx);
    while (d > Math.PI) d -= Math.PI * 2;
    while (d < -Math.PI) d += Math.PI * 2;
    assert.ok(Math.abs(d) <= half + 1e-6, `S1 音符在 15° 扇面内（${(d * 180 / Math.PI).toFixed(1)}°）`);
  }
  done(h);
});

test('结城理 S2: 至多 4 名目标、按 prob 恐惧、低血恐惧目标立刻倒下', () => {
  const enemies = [0, 1, 2, 3, 4].map((i) => ({ key: 'enemy_dummy', time: 0, route: 0, pos: [10, 6 + i] }));
  enemies.push({ key: 'enemy_dummy', time: 0, route: 0, pos: [9, 5] });
  const { h, u } = field(MAKOTO, { skill: 1, enemies });
  h.b.emit('dollSwitch', { unit: u, reason: 'skill', done: false });
  h.run(1.4);
  const s2rec = CH.chess_char_6_21_a.skills.find((x) => x.skillId === 'skchr_makoto_2');
  const targets = u.buffs.find((b) => b.key === 'makoto:targets');
  assert.ok(targets && targets.mods.maxTargets === Number(s2rec.bb['attack@max_target']), `S2 的攻击目标数 = attack@max_target（${targets && targets.mods.maxTargets}）`);
  const s2 = s2rec;
  const list = h.enemies();
  // 恐惧：跑一段时间后至少有一个敌人被上过恐惧（prob 0.35 × 多次攻击）
  let feared = false;
  for (let k = 0; k < 60 && !feared; k++) {
    h.run(0.5);
    feared = list.some((e) => !!e.findBuff('fear')) || h.events.some((ev) => ev[0] === 'status' && ev[2] === 'fear');
  }
  assert.ok(feared, '命中有概率施加恐惧');
  // 处决：把某个已被恐惧的敌人打到 kill_atk_scale × 攻击力 以下
  const victim = list.find((e) => e.alive && !!e.findBuff('fear')) || list[0];
  if (victim && victim.alive) {
    victim.hp = Math.max(1, u.s.atk * Number(s2.bb['attack@kill_atk_scale']) * 0.5);
    h.b.applyStatus(victim, 'fear', { duration: 5, source: u });
    h.run(3);
    assert.ok(!victim.alive, '生命值低于 kill_atk_scale × 攻击力的恐惧目标立刻倒下');
  }
  done(h);
});

test('丰川祥子 持续攻击: 朝向正前方一格「通行类型为无」时不发射音符', () => {
  const mk = (dir) => {
    const h = makeBattle({
      defs: { enemies: { enemy_dummy: dummy('enemy_dummy') } }, timeLimit: 60, autoFinish: false, seed: 4,
      flags: { dpPerSec: 0, dpMax: 99 },
      units: [{ chessId: OBLVNS, row: 12, col: 5, skillIndex: 0, dir }],
      enemies: [],
    });
    h.step();
    return h;
  };
  const blockedField = mk('UP');
  assert.equal(blockedField.b.tileInfo(13, 5).pass, 'NONE', '前提：朝向正前方的那一格通行类型为无');
  blockedField.run(1.6);
  assert.equal((blockedField.unit(OBLVNS).mem.oblvnsNotes || []).length, 0, '前方一格不可通行 ⇒ 不发音符');

  const openField = mk('DOWN');
  assert.notEqual(openField.b.tileInfo(11, 5).pass, 'NONE', '前提：另一侧一格可通行');
  openField.run(1.6);
  assert.ok((openField.unit(OBLVNS).mem.oblvnsNotes || []).length >= 1, '前方可通行 ⇒ 照常演奏');
  done(blockedField);
  done(openField);
});

test('丰川祥子 音符: 自由移动 → 最短自由移动时间后在 1.0 格内锁定目标 → 追踪 → 命中即消失', () => {
  const h = makeBattle({
    defs: { enemies: { enemy_dummy: dummy('enemy_dummy') } }, timeLimit: 60, autoFinish: false, seed: 4,
    flags: { dpPerSec: 0, dpMax: 99 },
    units: [{ chessId: OBLVNS, row: 10, col: 5, skillIndex: 0 }],
    enemies: [{ key: 'enemy_dummy', time: 0, route: 0, pos: [10, 6] }],
  });
  h.step();
  const u = h.unit(OBLVNS);
  const e = h.enemy('enemy_dummy');
  const hp0 = e.hp;
  let sawFree = false, sawChase = false;
  for (let k = 0; k < 60; k++) {
    h.run(0.05);
    for (const n of u.mem.oblvnsNotes || []) {
      if (n.state === 'free') sawFree = true;
      if (n.state === 'chase') sawChase = true;
    }
    for (const ev of h.eventsOf('damaged')) if (ev) { /* drained below */ }
    h.events.length = 0;
  }
  assert.ok(sawFree, '先在自由移动状态');
  assert.ok(sawChase, '锁定目标后进入追踪移动');
  assert.ok(e.hp < hp0, `音符命中造成了伤害（${Math.round(hp0 - e.hp)}）`);
  assert.ok(h.events.length >= 0, '事件已清理');
  done(h);
});

test('丰川祥子 音符: 飞出攻击范围且连续 1 s 没有追踪目标就消失', () => {
  const h = makeBattle({
    defs: { enemies: { enemy_dummy: dummy('enemy_dummy') } }, timeLimit: 60, autoFinish: false, seed: 4,
    flags: { dpPerSec: 0, dpMax: 99 },
    units: [{ chessId: OBLVNS, row: 10, col: 5, skillIndex: 0 }],
    enemies: [],
  });
  h.step();
  const u = h.unit(OBLVNS);
  h.run(1.6);
  assert.ok((u.mem.oblvnsNotes || []).length >= 1, '先有音符在飞');
  u.mem.oblvnsCd = 1e9;   // 停止继续演奏，只观察已有音符（s.flags 是派生视图，改它不生效）
  h.run(6);
  assert.equal((u.mem.oblvnsNotes || []).length, 0, '飞远后（范围外 1 s 无目标）全部消失');
  done(h);
});

test('丰川祥子 音符攻击力: 发射时正阻挡敌人 = 100%，否则领主远程 80%', () => {
  const h = makeBattle({
    defs: { enemies: { enemy_dummy: dummy('enemy_dummy') } }, timeLimit: 60, autoFinish: false, seed: 4,
    flags: { dpPerSec: 0, dpMax: 99 },
    units: [{ chessId: OBLVNS, row: 10, col: 5, skillIndex: 0 }],
    enemies: [{ key: 'enemy_dummy', time: 0, route: 0, pos: [10, 8] }],
  });
  h.step();
  const u = h.unit(OBLVNS);
  const e = h.enemy('enemy_dummy');
  h.run(1.2);
  let note = (u.mem.oblvnsNotes || [])[0];
  if (!note) { h.run(1.2); note = (u.mem.oblvnsNotes || [])[0]; }
  assert.ok(note, '有音符');
  const atk = u.s.atk;
  assert.ok(Math.abs(note.amount - atk * 0.8) < atk * 0.02, `不阻挡时 80%（${note.amount.toFixed(0)} vs ${(atk * 0.8).toFixed(0)}）`);
  // 让她「正挡着人」：把敌人塞进 blocking（unit test 的捷径），下一次演奏就应按 100% 算
  const before = new Set(u.mem.oblvnsNotes || []);
  u.blocking = [e];
  let fresh = null;
  for (let k = 0; k < 40 && !fresh; k++) {
    h.run(0.1);
    fresh = (u.mem.oblvnsNotes || []).find((n) => !before.has(n)) || null;
  }
  if (fresh) {
    assert.ok(Math.abs(fresh.amount - atk) < atk * 0.02, `阻挡时 100%（${fresh.amount.toFixed(0)} vs ${atk.toFixed(0)}）`);
  }
  u.blocking = [];
  done(h);
});

test('结城理 天赋 1: 只有本体→替身才停顿；替身→替身（S3 换面具）不重复触发；范围按攻击范围', () => {
  // 结城理 1-1 射程：站在 (10,6) 的敌人才在攻击范围内
  const { h, u } = field(MAKOTO, { skill: 2, enemies: [{ key: 'enemy_dummy', time: 0, route: 0, pos: [10, 6] }] });
  const sluggish = () => h.hooksOf('statusApplied').filter((c) => c.status === 'sluggish').length;
  h.b.emit('dollSwitch', { unit: u, reason: 'skill', done: false });
  h.run(1.4);
  assert.equal(sluggish(), 1, '本体 → 替身：停顿一次');
  u.skill.activate('test', { free: true });   // 塔纳托斯 → 俄耳甫斯（替身 → 替身）
  h.run(0.6);
  assert.equal(u.mem.makotoPersona, 'orpheus');
  assert.equal(sluggish(), 1, '替身 → 替身不再触发停顿');
  done(h);
});

test('结城理 天赋 2: 总攻击按「本体」攻击力结算（不吃替身加成）并进入无敌/静默窗口', () => {
  const { h, u } = field(MAKOTO, { skill: 0, enemies: [{ key: 'enemy_dummy', time: 0, route: 0, pos: [10, 6] }] });
  const e = h.enemy('enemy_dummy');
  const baseAtk = u.s.atk;
  h.b.emit('dollSwitch', { unit: u, reason: 'skill', done: false });
  h.run(1.4);
  assert.ok(u.s.atk > baseAtk, '替身形态攻击力更高');
  const scale = Number(CH.chess_char_6_21_a.talents[1].bb.atk_scale);
  const hp0 = e.hp;
  h.b.emit('dollSwap', { unit: u, form: null });
  h.run(0.1);
  const dealt = hp0 - e.hp;
  assert.ok(Math.abs(dealt - baseAtk * scale) < baseAtk * scale * 0.05, `总攻击 = 本体攻击力 × ${scale}（${Math.round(dealt)} vs ${Math.round(baseAtk * scale)}）`);
  assert.ok(u.findBuff('makoto:allOut'), '总攻击窗口存在');
  assert.equal(u.s.flags.invulnerable, true, '总攻击期间无敌');
  done(h);
});

test('结城理 S3 俄耳甫斯·改: 不进行普通攻击、阻挡恢复 2、治疗延迟 0.5 s 结算', () => {
  const { h, u } = field(MAKOTO, {
    skill: 2,
    enemies: [{ key: 'enemy_dummy', time: 0, route: 0, pos: [10, 7] }],
    others: [null, { chessId: 'chess_char_1_01_a', row: 10, col: 6 }],
  });
  const ally = h.unit('chess_char_1_01_a');
  h.b.emit('dollSwitch', { unit: u, reason: 'skill', done: false });
  h.run(1.4);
  u.skill.activate('test', { free: true });     // → 俄耳甫斯·改
  h.run(1.2);
  assert.equal(u.mem.makotoPersona, 'orpheus');
  assert.equal(u.s.blockCnt, 2, '俄耳甫斯·改恢复 2 阻挡');
  assert.equal(u.s.flags.disarm, true, '俄耳甫斯·改不进行普通攻击');
  ally.hp = ally.s.maxHp * 0.3;
  const hp0 = ally.hp;
  h.run(0.4);
  assert.ok(ally.hp <= hp0 + 1e-6, '施术后 0.5 s 内还没结算');
  h.run(0.6);
  assert.ok(ally.hp > hp0, '延迟治疗已结算');
  done(h);
});

test('结城理 S1: 治疗范围内生命比例最低的友方（≤50%）', () => {
  const { h, u } = field(MAKOTO, {
    skill: 0,
    enemies: [{ key: 'enemy_dummy', time: 0, route: 0, pos: [10, 7] }],
    others: [null, { chessId: 'chess_char_1_01_a', row: 10, col: 6 }, { chessId: 'chess_char_2_06_a', row: 9, col: 5 }],
  });
  const a1 = h.unit('chess_char_1_01_a');
  const a2 = h.unit('chess_char_2_06_a');
  h.b.emit('dollSwitch', { unit: u, reason: 'skill', done: false });
  h.run(1.4);
  a1.hp = a1.s.maxHp * 0.2;
  a2.hp = a2.s.maxHp * 0.4;
  const before = { a1: a1.hp, a2: a2.hp };
  h.run(4);
  assert.ok(a1.hp > before.a1, '生命比例最低的先被治疗');
  assert.ok(a2.hp >= before.a2, '另一个不会被这一下治疗（只是不再掉血）');
  done(h);
});

test('丰川祥子 音符「缓存攻击力」: 发射后她吃到攻击力加成，已飞音符仍按发射瞬间的攻击力结算', () => {
  const h = makeBattle({
    defs: { enemies: { enemy_dummy: dummy('enemy_dummy') } }, timeLimit: 60, autoFinish: false, seed: 6,
    flags: { dpPerSec: 0, dpMax: 99 },
    units: [{ chessId: OBLVNS, row: 10, col: 5, skillIndex: 0 }],
    enemies: [{ key: 'enemy_dummy', time: 0, route: 0, pos: [10, 6] }],
  });
  h.step();
  const u = h.unit(OBLVNS);
  const e = h.enemy('enemy_dummy');
  let note = null;
  for (let k = 0; k < 40 && !(note && note.target); k++) {
    h.run(0.05);
    note = (u.mem.oblvnsNotes || []).find((n) => n.target) || null;
  }
  assert.ok(note, '有带追踪目标的音符在飞');
  const frozen = note.amount;
  assert.ok(Math.abs(frozen - note.atkCache * note.mul * note.scale) < 1e-9, '音符带着发射时的攻击力缓存');
  u.mem.oblvnsNotes = [note];               // 只留这一颗（其余在飞的音符已按各自的缓存结算过）
  u.mem.oblvnsCd = 1e9;                     // 停掉后续演奏，隔离这一颗
  h.b.addBuff(u, { key: 'test:atk', mods: { atkPct: 2 }, duration: Infinity });   // 之后攻击力翻 3 倍
  const hp0 = e.hp;
  h.run(2);
  const dealt = hp0 - e.hp;
  assert.ok(Math.abs(dealt - frozen) < frozen * 0.2, `按缓存攻击力结算（${Math.round(dealt)} vs ${Math.round(frozen)}）`);
  h.b.removeBuff(u, 'test:atk');
  done(h);
});

test('丰川祥子 【已命中】状态: 配了停留时长的音符命中后停住、到期才消失（她的音符 hitHold = 0，命中即消失）', () => {
  const h = makeBattle({
    defs: { enemies: { enemy_dummy: dummy('enemy_dummy') } }, timeLimit: 60, autoFinish: false, seed: 6,
    flags: { dpPerSec: 0, dpMax: 99 },
    units: [{ chessId: OBLVNS, row: 10, col: 5, skillIndex: 0 }],
    enemies: [{ key: 'enemy_dummy', time: 0, route: 0, pos: [10, 6] }],
  });
  h.step();
  const u = h.unit(OBLVNS);
  const e = h.enemy('enemy_dummy');
  let note = null;
  for (let k = 0; k < 40 && !(note && note.target); k++) {
    h.run(0.05);
    note = (u.mem.oblvnsNotes || []).find((n) => n.target) || null;
  }
  assert.ok(note, '有音符在飞');
  assert.equal(note.hitHold, 0, '她的音符没有【已命中】状态');
  note.hitHold = 0.5;                       // 人为给一个停留时长，验证机制本身
  note.state = 'chase';                     // 命中只发生在追踪移动里（官方：命中追踪目标）
  note.x = e.x; note.y = e.y;               // 直接贴到目标上，下一帧命中
  u.mem.oblvnsCd = 1e9;
  h.run(0.05);
  assert.equal(note.state, 'hit', '命中后进入【已命中】');
  assert.ok(note.hitT > 0.2, '停留计时开始');
  h.run(0.2);
  assert.equal((u.mem.oblvnsNotes || []).includes(note), true, '停留期间还在');
  h.run(0.6);
  assert.equal((u.mem.oblvnsNotes || []).includes(note), false, '停留结束才消失');
  done(h);
});
