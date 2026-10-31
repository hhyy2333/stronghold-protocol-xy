// test/sim/boss13-doll-opening.test.js — 首领「伤心的大锁」(boss_13, enemy_2018_csdoll) 的开场伤害与免死/不屈。
//
// 业主 2026-11-01：「大锁开局秒人且无视不屈效果伤害有问题」。本套件把三件事钉在测试里：
//   1. 大锁的伤害**全部**走标准管线（hurt → battle.dealDamage → applyHpLoss → `fatal` → `kill` → `death`），
//      所以 `fatal` 的免死（`c.prevented`）与不屈（bonds/addon/battle.js 的 indomShip，death 优先级 10 的立刻
//      免费再部署）都能正常作用 —— 见「不屈 / 免死」两组用例。
//   2. 开场不是「秒人」：受击反击（全场 100 % 攻击力法术溅射）要等**20 次可触发受击回复的伤害**（PRTS 天赋），
//      一个正常盘面在前 2 秒攒不满 20 次，所以第一发溅射不会落在开场；`taken` 也**不**把生命流失 / `noSp` 的
//      伤害算进这 20 次（damage.js applyHpLoss 的受击回复判据：`!dmg.noSp && dmg.type !== 'element'`）。
//   3. 开场不该发生的事：【终结】的初始冷却 480 s 生效（第 0 秒不放），【保护屏障】不在第 0 秒升起
//      （icd 60），所以第 0 秒既没有屏障召唤也没有扣 30 目标生命。
//
// 数据来源：PRTS 伤心的大锁（见 .scratch/prts-mechanics.md §1）：攻击力 800 / 攻击间隔 4.0 / 同时攻击 2 个目标 /
// 「每受到20次可触发受击回复的伤害后，对在场所有我方单位造成自身攻击力100%的法术溅射伤害」/ 保护屏障 cd 60·icd 45 /
// 终结 cd·icd 480。战斗用真实 sim（test/helpers/battleHarness.js）+ 生产内容（content: 'full'），所以 kitDoll 与
// 不屈盟约都是生产路径上装的那一份。

import test from 'node:test';
import assert from 'node:assert/strict';
import { makeBattle, chessRec } from '../helpers/battleHarness.js';

const DOLL = 'enemy_2018_csdoll';
/** PRTS 数值换算：溅射 = 800 × 100 %；【终结】= 800 × 200 %。 */
const DOLL_ATK = 800;
const SPLASH = DOLL_ATK;      // 100 % 攻击力
const DOOM_HIT = DOLL_ATK * 2; // 200 % 攻击力

/** 一个安静的干员：2500 生命 / 200 防御 / 10 法抗；`profession` 决定 MELEE（地面，吃不屈）还是 RANGED（高台）。 */
const op = (id, profession = 'WARRIOR') => chessRec({
  id, bonds: [], profession,
  stats: { maxHp: 2500, atk: 400, def: 200, res: 10, blockCnt: 2, respawnTime: 70 },
  skill: null,
  rangeGrid: [[0, 0], [0, 1], [0, -1], [1, 0], [-1, 0], [0, 2], [0, -2]],
});
const CHESS = { t_melee: op('t_melee'), t_melee2: op('t_melee2'), t_ranged: op('t_ranged', 'CASTER') };
/** 够不着大锁的一名干员（射程外 ⇒ 不会自己打它，受击计数只由测试推）。 */
const FAR = { uid: 1, kind: 'chess', chessId: 't_melee', row: 5, col: 3 };
/** 围住大锁（它在 [3,10]，2.95 × 2.95 的受击区覆盖 3–4 行 / 9–11 列附近）的一圈地面干员。 */
const RING = [
  { uid: 1, kind: 'chess', chessId: 't_melee', row: 3, col: 8 },
  { uid: 2, kind: 'chess', chessId: 't_melee2', row: 4, col: 8 },
  { uid: 3, kind: 'chess', chessId: 't_melee', row: 5, col: 8 },
  { uid: 4, kind: 'chess', chessId: 't_melee2', row: 3, col: 9 },
  { uid: 5, kind: 'chess', chessId: 't_melee', row: 4, col: 9 },
  { uid: 6, kind: 'chess', chessId: 't_melee2', row: 5, col: 9 },
];

/**
 * A boss arena with the doll spawned at [3,10]. `units` = the board, `bonds` = the player's live bond state
 * (indomShip at 300 layers ⇒ procChance = min(1, 0.18 + 0.004 × 300) = 1).
 */
function arena({ units = RING, bonds = {}, setup = null, hooks = ['death', 'fatal', 'damaged', 'bondTrigger'] } = {}) {
  const h = makeBattle({
    kind: 'boss', content: 'full', autoFinish: false, timeLimit: 120,
    defs: { chess: CHESS },
    players: [{ playerId: 'p1', seat: 0, side: 'L', coords: 'field', bonds, units }],
    hooks,
    captureNoisy: true,
    setup,
  });
  h.step();
  const boss = h.spawn(DOLL, { pos: [3, 10], routeIndex: 0 });
  assert.ok(boss && boss.alive, 'premise: 大锁上场');
  return { h, b: h.battle, boss };
}

/** 不屈满概率（地面干员 100 % 立刻免费再部署）。 */
const INDOM = { indomShip: { count: 1, active: true, tier: 1, layers: 300 } };
/** 真实命中（可触发受击回复的伤害）：`noSp` 为假、不是元素损伤。 */
const realHit = (b, boss, amount = 1) => b.dealDamage(null, boss, { amount, type: 'true', canDodge: false });
/** 把大锁推到第 n 次受击（`n = 20` 时攒满，进入待发）。 */
const pushHits = (b, boss, n) => { for (let i = 0; i < n; i++) realHit(b, boss); };
/**
 * 攒满 20 次受击并等满**最小间隔**（4 s，业主 2026-11-01 的偏离），但先不触发 —— 待发状态要等下一发真实受击才打。
 * `P.burstAt` 从大锁上场时刻起算，所以第一发也要等满 4 s。
 */
const chargeSplash = (h, b, boss) => { pushHits(b, boss, 20); h.run(4.1); };
/** 到点后的第一发真实受击 ⇒ 把待发的那一发打出去。 */
const fireSplash = (h, b, boss) => { realHit(b, boss); h.run(0.1); };
/** 攒满 + 等满间隔 + 打出去。 */
const forceSplash = (h, b, boss) => { chargeSplash(h, b, boss); fireSplash(h, b, boss); };
/** 这一场里带 `dollBurst` 标记的伤害实例（受击反击的溅射）。 */
const splashes = (h) => h.hooksOf('damaged').filter((c) => (c.dmg?.tags || []).includes('dollBurst'));

// =====================================================================================================================
// 开场

test('大锁：开场不秒人 — 第一发全场溅射要等 20 次受击，前 2 秒没有干员阵亡', () => {
  const { h, b, boss } = arena();
  const ops = b.allyUnits.filter((u) => u.kind === 'op');
  h.run(2);
  assert.equal(h.hooksOf('death').length, 0, '前 2 秒没人阵亡');
  assert.equal(splashes(h).length, 0, '20 次受击还没攒满 ⇒ 没有溅射');
  assert.ok(boss.stats.attacks >= 1, 'premise: 大锁的普通攻击已经打出来了（它才是开场的伤害来源）');
  for (const u of ops) assert.ok(u.hp > 0, `${u.defId} 还活着`);
  // 受击计数：6 名干员各打 ~1 击/秒，2 秒只有十几下
  assert.ok(h.hooksOf('damaged').filter((c) => c.target === boss).length < 20, 'premise: 2 秒内没攒满 20 次受击');
  h.invariants();
});

test('大锁：受击反击是 20 次真实受击 —— 第 20 次打全场 100 % 攻击力（800）法术溅射', () => {
  const { h, b, boss } = arena({ units: [FAR] });
  const u = b.allyUnits.find((x) => x.kind === 'op');
  pushHits(b, boss, 19);
  h.run(0.1);
  assert.equal(splashes(h).length, 0, '第 19 次还没有溅射');
  assert.equal(u.hp, 2500, 'premise: 一直满血');
  pushHits(b, boss, 1);          // 第 20 次：攒满，进入待发
  h.run(0.1);
  assert.equal(splashes(h).length, 0, '最小间隔闸：攒满也不在开场立刻打');
  h.run(4);                      // 越过最小间隔（4 s，从上场起算）
  realHit(b, boss);              // 到点后的第一发真实受击 ⇒ 打出去
  h.run(0.1);
  const hit = splashes(h);
  assert.equal(hit.length, 1, '攒满的那一发打出来了');
  assert.equal(hit[0].target, u, '全场唯一一名干员吃到');
  assert.equal(hit[0].type, 'arts', '法术伤害');
  // 800 法术 − 10 法抗 = 720（只看溅射那一个实例：这 4 秒里大锁的普通攻击也打了两发 600）
  assert.ok(Math.abs(hit[0].amount - SPLASH * 0.9) < 1e-6, `800 × (1 − 10 %) = 720，实际 ${hit[0].amount}`);
  assert.ok(u.hp < 2500, '干员确实掉了血');
  h.invariants();
});

test('大锁：生命流失 / 反伤 / noSp 的伤害不算进受击反击的 20 次（PRTS「可触发受击回复的伤害」）', () => {
  const { h, b, boss } = arena({ units: [FAR] });
  const u = b.allyUnits.find((x) => x.kind === 'op');
  // 20 次流失（Battle.loseHp：hpLoss 标记 + noSp）—— 官方口径里它们不触发受击回复，所以不推进计数
  for (let i = 0; i < 20; i++) b.loseHp(boss, 1);
  // 再来 20 次反伤（counter / reflect：answer to being hit, not a hit）
  for (let i = 0; i < 20; i++) b.dealDamage(null, boss, { amount: 1, type: 'true', canDodge: false, tags: ['counter'] });
  h.run(0.1);
  assert.equal(splashes(h).length, 0, '20 次流失 + 20 次反伤都没有触发溅射');
  assert.equal(u.hp, 2500, '干员一点血都没掉');
  // 同样的 20 次，换成真实受击 ⇒ 溅射（再过最小间隔）
  forceSplash(h, b, boss);
  assert.equal(splashes(h).length, 1, '20 次真实受击才触发');
  assert.ok(u.hp < 2500, '干员吃到了溅射');
  h.invariants();
});

// =====================================================================================================================
// 最小间隔闸（业主 2026-11-01 拍板的有意偏离：官方「每受到20次…后」没有间隔下限）

test('大锁：受击反击有 4 秒最小间隔 —— 1 秒内攒满 20 次时，第一发要等满 4 秒，两发之间也 ≥ 4 秒', () => {
  const { h, b, boss } = arena({ units: [FAR] });
  const t0 = b.time;
  pushHits(b, boss, 20);                       // t≈0.03 就攒满（模拟满盘 10 人 1 击/秒）
  h.run(0.2);
  assert.equal(splashes(h).length, 0, '攒满也不在开场立刻打');
  h.run(3.6);                                  // t≈3.85
  assert.equal(splashes(h).length, 0, '还没满 4 秒');
  h.run(0.3);                                  // t≈4.15：闸开了，但待发要等下一发真实受击
  assert.equal(splashes(h).length, 0, '闸开了也要等下一发真实受击才打');
  realHit(b, boss);
  h.run(0.1);
  const first = splashes(h);
  assert.equal(first.length, 1, '第一发打出来了');
  assert.ok(first[0].t - t0 >= 4 - 1e-6, `第一发在大锁上场后 ${(first[0].t - t0).toFixed(2)} s（≥ 4 s）`);

  // 第二发：间隔内再攒满 20 次也不打
  pushHits(b, boss, 20);
  h.run(0.2);
  assert.equal(splashes(h).length, 1, '第二发被最小间隔压住');
  h.run(3.8);
  realHit(b, boss);
  h.run(0.1);
  const all = splashes(h);
  assert.equal(all.length, 2, '第二发打出来了');
  assert.ok(all[1].t - all[0].t >= 4 - 1e-6, `两发溅射间隔 ${(all[1].t - all[0].t).toFixed(2)} s（≥ 4 s）`);
  h.invariants();
});

test('大锁：最小间隔内继续受击不丢计数 —— 攒满后到点即发（不用再攒 20 次）', () => {
  const { h, b, boss } = arena({ units: [FAR] });
  pushHits(b, boss, 20);                       // 攒满，进入待发
  h.run(0.1);
  assert.equal(splashes(h).length, 0, '待发，被间隔闸压住');
  // 闸内继续挨打 30 次（t 走到 ≈3.2 s）：计数不清零，也不会因为「不是第 20 次」而丢掉这一发
  for (let i = 0; i < 30; i++) { realHit(b, boss); h.run(0.1); }
  assert.equal(splashes(h).length, 0, '间隔内继续受击也不打');
  // 蓄力预警的节奏不受影响：第 10 次、第 30 次都出现了蓄力特效
  const charges = h.eventsOf('fx').filter((e) => e[1] === 'telegraph' && e[4] && e[4].kind === 'dollCharge');
  assert.ok(charges.length >= 2, `蓄力预警照常（第 10 / 30 次），实际 ${charges.length} 次`);
  h.run(1.2);                                  // 越过 4 s
  assert.equal(splashes(h).length, 0, '闸开了之后要有下一发真实受击才打');
  realHit(b, boss);                            // 到点后的第一发真实受击 ⇒ 立刻打出去
  h.run(0.1);
  assert.equal(splashes(h).length, 1, '攒满的那一发没有丢');
  h.invariants();
});

// =====================================================================================================================
// 不屈 / 免死（标准伤害管线）

test('大锁：溅射打死地面干员时，不屈立刻免费再部署（满血回到原位）', () => {
  const { h, b, boss } = arena({ units: [FAR], bonds: INDOM });
  const u = b.allyUnits.find((x) => x.kind === 'op');
  assert.equal(u.def.position, 'MELEE', 'premise: 地面干员');
  chargeSplash(h, b, boss);                       // 攒满 + 等满最小间隔（此时还没有打出去）
  u.hp = 100;                                     // 一发溅射（720）必死
  fireSplash(h, b, boss);
  const deaths = h.hooksOf('death').filter((c) => c.unit === u);
  assert.equal(deaths.length, 1, 'death 钩子照常发出（标准管线）');
  assert.equal(deaths[0].reason, 'killed');
  assert.equal(h.hooksOf('bondTrigger').filter((c) => c.unit === u).length, 1, '不屈触发了一次');
  assert.equal(u.alive, true, '立刻再部署：没有躺下');
  assert.equal(u.hp, 2500, '满血回来');
  h.invariants();
});

test('大锁：普通攻击也走标准管线 —— 不屈同样把它拉回来', () => {
  const { h, b, boss } = arena({ units: [RING[0]], bonds: INDOM });
  const u = b.allyUnits.find((x) => x.kind === 'op');
  b.dealDamage(boss, u, { amount: 99999, type: 'phys', isAttack: true, canDodge: false });
  h.run(0.1);
  assert.equal(h.hooksOf('fatal').length, 1, 'fatal 钩子照常发出');
  assert.equal(h.hooksOf('bondTrigger').filter((c) => c.unit === u).length, 1, '不屈触发');
  assert.equal(u.alive, true);
  assert.equal(u.hp, 2500);
  h.invariants();
});

test('大锁：免死（fatal 的 c.prevented）对大锁的伤害有效 —— 锁血留 1 点', () => {
  const guarded = [];
  const { h, b, boss } = arena({
    units: [FAR],
    // 测试侧的一条免死：把这一发致命伤害免掉（骑士徽章 / 圣佑 之类的写法）
    setup: (bb) => bb.on('fatal', (c) => {
      if (guarded.length || !c.unit || c.unit.kind !== 'op' || c.prevented) return;
      c.prevented = true;          // 只免第一发（免死效果的常见写法：一次窗口）
      guarded.push(c);
    }),
  });
  const u = b.allyUnits.find((x) => x.kind === 'op');
  chargeSplash(h, b, boss);       // 先把受击攒满并等满最小间隔（还没打出去）
  b.dealDamage(boss, u, { amount: 99999, type: 'arts', isSkill: true, canDodge: false });
  assert.equal(guarded.length, 1, '免死钩子看到了这一发');
  assert.equal(u.alive, true, '免死：没有倒下');
  assert.equal(u.hp, 1, '引擎把 HP 抬到 1');
  // 再吃一发溅射：这次没有免死了，正常阵亡（证明免死只免那一发）
  u.hp = 100;
  fireSplash(h, b, boss);
  assert.equal(u.alive, false, '免死用掉之后正常阵亡');
  h.invariants();
});

test('大锁：高台干员不吃不屈 —— 这是「无视不屈」的观感来源（不屈只保地面干员）', () => {
  const { h, b, boss } = arena({ units: [{ uid: 1, kind: 'chess', chessId: 't_ranged', row: 3, col: 8 }], bonds: INDOM });
  const u = b.allyUnits.find((x) => x.kind === 'op');
  assert.equal(u.def.position, 'RANGED', 'premise: 高台干员');
  chargeSplash(h, b, boss);
  u.hp = 100;
  fireSplash(h, b, boss);
  assert.equal(h.hooksOf('death').filter((c) => c.unit === u).length, 1, '阵亡');
  assert.equal(h.hooksOf('bondTrigger').length, 0, '不屈不掷（盟约规则：地面干员被击倒才触发）');
  assert.equal(u.alive, false, '高台干员躺下等再部署计时');
  h.invariants();
});

// =====================================================================================================================
// 开场不该发生的事

test('大锁：开场第 0 秒不放【终结】、不升【保护屏障】（icd 480 / 60 生效）', () => {
  const { h, b, boss } = arena({ units: [RING[0]] });
  h.run(1);
  assert.equal(boss.findBuff('boss:dollBarrier'), null, '第 1 秒没有屏障（icd 60）');
  assert.equal(b.enemies.length, 1, '没有召唤物（屏障的第 0 秒召唤随屏障一起，屏障还没升）');
  assert.equal(h.eventsOf('fx').filter((e) => e[1] === 'lpLoss').length, 0, '没有扣目标生命（终结没放）');
  // 两个技能的剩余冷却：保护屏障 icd 60、终结 icd 480
  const list = boss.mem.ab.list;
  const shield = list.find((a) => a.sk && a.sk.bb && a.sk.bb.interval === 20);      // 保护屏障 (bb.interval 20)
  const doom = list.find((a) => a.sk && a.sk.bb && a.sk.bb.atk_scale === 2);        // 终结 (bb.atk_scale 2)
  assert.ok(shield && doom, 'premise: 两个技能都装上了');
  assert.ok(shield.left > 55 && shield.left <= 60, `保护屏障还剩 ${shield.left.toFixed(1)} s（icd 60）`);
  assert.ok(doom.left > 475 && doom.left <= 480, `终结还剩 ${doom.left.toFixed(1)} s（icd 480）`);
  assert.ok(DOOM_HIT > SPLASH, 'premise: 终结（1600）比溅射（800）重');
  h.invariants();
});
