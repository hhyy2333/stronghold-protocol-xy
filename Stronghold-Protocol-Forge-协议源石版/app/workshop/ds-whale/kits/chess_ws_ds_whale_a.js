// 工坊技能脚本：大肥鱼（DeepSeek 鲸鱼娘）— 6★ 吟游者。
//
// 设计稿（业主 2026-10-24，见包内 PROVENANCE 的 KIT 一节）：
//   T1 大模型算力：范围内友方技力自然回复 +0.2/秒；范围内友方释放技能时自身 +1 层「数据样本」（最多 20），
//                  每层自身治疗量 +3%
//   T2 吃白饭：在场每秒消耗 1 点部署费用；范围内友方获得 (10% + 层数×1%) 庇护与抵抗（上限 30%）
//   S1 数据流溢出（自动触发 / 持续 20 s）：+5 层「数据样本」，攻击力 +45%，范围内友方攻速 +35
//   S2 代码重构（自动触发）：先 +1 层再**清空全部**样本：每层本场战斗攻击力 +30%；另对范围内血量最低的友方
//                    **各一次** 180% 攻击力的治疗与 1 点技力（层数只决定攻击力，不回技力 n 次）
//   S3 深度求索·涌现（持续）：样本 +20，展开「深水区」+攻击范围扩大；自身不受伤害；区内友方每秒回复她 50% 最大生命的
//                  生命、并获得 +50% 攻击力/防御力；区内敌人移速 -50%、脆弱 +50%（Lv4 为 +40%）、
//                  每秒受到她 150% 最大生命的法术伤害
//
// 两处与设计稿的偏差（引擎能力所限，已与业主确认口径前的临时实现）：
//   * 「数值增益效果提升至 1.5 倍」没有通用实现点（buff 是逐条加算/乘算的，没有二次结算钩子），
//     这里按「区内友方攻击力、防御力 +50%」近似 —— 也就是把 1.5 倍落到两个最主要的数值维度上。
//   * 「抗性」用引擎的状态 resist（同名取最高、默认减半）实现，覆盖全部常规控制；持续 0.6s 由 0.5s 的光环心跳续上。
//
// 确定性：所有随机都不需要（没有随机数），计时只用 battle.every / 事件，不用 Date/Math.random。

import { num, talentBb, skillRec, up, giveSp, holdProtect, alliesInGridOf, makeZone } from '@kit/tier1.js';
// 范围特效要用「格子键 → [r, c]」：COLS 是引擎的键步长，absoluteRangeKeys 把技能范围网格旋到她的朝向上
import { COLS } from '@sim/constants.js';
import { absoluteRangeKeys } from '@sim/targeting.js';

const S1 = 'skchr_ws_ds_whale_1';
const S2 = 'skchr_ws_ds_whale_2';
const S3 = 'skchr_ws_ds_whale_3';

const KEY_SAMPLES = 'dsw:samples';   // her own healing bonus, 1 layer = +3%
const KEY_S2_ATK = 'dsw:s2:atk';      // permanent ATK of 代码重构
const KEY_AMP = 'dsw:s3:amp';         // 深水区: the 1.5x approximation
const KEY_SLOW = 'dsw:s3:slow';       // 深水区: enemy -50% move

export default (bb, chess, def) => {
  void bb; void def;
  const t1 = talentBb(chess, 0);
  const t2 = talentBb(chess, 1);
  const r1 = skillRec(chess, S1) || {};
  const r2 = skillRec(chess, S2) || {};
  const r3 = skillRec(chess, S3) || {};
  const b1 = r1.bb || {};
  const b2 = r2.bb || {};
  const b3 = r3.bb || {};

  const SP_PER_SEC = num(t1.sp_per_sec, 0.2);
  const STACK_MAX = Math.max(1, Math.floor(num(t1.stack_max, 20)));
  const HEAL_PER_STACK = num(t1.heal_per_stack, 0.03);
  const DP_PER_SEC = num(t2.dp_per_sec, 1);
  const PROTECT_BASE = num(t2.protect_base, 0.1);
  const PROTECT_PER = num(t2.protect_per_stack, 0.01);
  const PROTECT_CAP = num(t2.protect_cap, 0.3);

  const d1 = num(r1.duration, 20);
  const d3 = num(r3.duration, 25);
  const s1Atk = num(b1.atk, 0.45);
  const s1Aspd = num(b1.attack_speed, 35);
  // S1 的 +5 层是规格里的固定值：写成数据键 `bb.stacks` 会被共享校验器的「通用黑板白名单」当成未知键提醒
  // （那只校验 `skill` 这一条默认技能），所以默认值放在这里；哪天数据里真写了 stacks，这一段照样读得到。
  const s1Stacks = Math.max(0, Math.floor(num(b1.stacks, 5)));
  const s2Per = num(b2.atk_per_stack, 0.3);
  const s2Heal = num(b2.heal_scale, 1.8);
  const s3Stacks = Math.floor(num(b3.stacks, 20));
  const s3Radius = num(b3.radius, 2.5);
  const s3HealRatio = num(b3.heal_maxhp_ratio, 0.5);
  const s3Amp = num(b3.ally_amp, 0.5);
  const s3DmgRatio = num(b3.enemy_dmg_maxhp_ratio, 1.5);
  const s3Slow = num(b3.slow, 0.5);
  // 脆弱：受到的物理 / 法术 / 真实伤害 ×(1 + value)，走引擎的 catalogue 状态 'fragile'（同名效果取最高）
  const s3Fragile = num(b3.fragile, 0.4);

  const stacksOf = (u) => Math.max(0, Math.min(STACK_MAX, Math.floor((u.mem && u.mem.dswSamples) || 0)));
  const setStacks = (u, n) => { if (!u.mem) u.mem = {}; u.mem.dswSamples = Math.max(0, Math.min(STACK_MAX, Math.floor(n))); return u.mem.dswSamples; };
  const addStacks = (u, n) => setStacks(u, stacksOf(u) + n);

  /** Her own 「每层治疗量 +3%」: one persisted buff, rewritten whenever the layer count changes. */
  const syncSamples = (battle, unit) => {
    const n = stacksOf(unit);
    if (unit.findBuff(KEY_SAMPLES)) battle.removeBuff(unit, KEY_SAMPLES);
    if (n > 0 && HEAL_PER_STACK > 0) {
      battle.addBuff(unit, { key: KEY_SAMPLES, mods: { healingDealtMul: 1 + HEAL_PER_STACK * n }, persist: true, allowDead: true, tags: ['talent'] });
    }
  };

  /** Deployed allies inside her current attack range (she counts as "in range" for her own aura). */
  const alliesInRange = (battle, unit) => alliesInGridOf(battle, unit);

  const lowestAlly = (battle, unit) => {
    const list = alliesInRange(battle, unit).slice();
    list.sort((a, b) => (a.hp / Math.max(1, a.s.maxHp)) - (b.hp / Math.max(1, b.s.maxHp)) || a.deploySeq - b.deploySeq);
    return list[0] || null;
  };

  // ---------------------------------------------------------------- T1 大模型算力
  const installT1 = (battle, unit) => {
    // 范围内友方（含自身）技力自然回复 +0.2/s：挂在 'time' 那一档的 spGain 上
    if (SP_PER_SEC > 0) {
      battle.on('spGain', (ctx) => {
        if (ctx.reason !== 'time' || !up(unit) || !up(ctx.unit)) return;
        if (ctx.unit.side !== unit.side) return;
        if (ctx.unit !== unit && !alliesInRange(battle, unit).includes(ctx.unit)) return;
        ctx.amount += SP_PER_SEC * battle.dt;
      }, { owner: unit });
    }
    // 范围内友方释放技能 → 自身 +1 层
    battle.on('skillStart', ({ unit: a }) => {
      if (!up(unit) || !up(a) || a.side !== unit.side) return;
      if (a !== unit && !alliesInRange(battle, unit).includes(a)) return;
      addStacks(unit, 1);
      syncSamples(battle, unit);
    }, { owner: unit });
    // 吟游者的治疗不是 heal，而是「生命回复速度」光环（professions.js installBard）：层数走 bardRegen 钩子放大，
    // 否则 healingDealtMul 对她没有任何作用。魔王 的「微尘」也是这么做的（chess_char_4_25-cetsyr.js）。
    if (HEAL_PER_STACK > 0) {
      battle.on('bardRegen', (ctx) => {
        if (ctx.unit !== unit) return;
        ctx.value *= 1 + HEAL_PER_STACK * stacksOf(unit);
      }, { owner: unit });
    }
    battle.on('deploy', (ctx) => { if (ctx.unit === unit) syncSamples(battle, unit); }, { owner: unit });
    battle.on('battleStart', () => syncSamples(battle, unit), { owner: unit });
  };

  // ---------------------------------------------------------------- T2 吃白饭
  const installT2 = (battle, unit) => {
    if (DP_PER_SEC > 0) {
      battle.every(1, () => { if (up(unit)) battle.addDp(unit.ownerId, -DP_PER_SEC); }, { owner: unit });
    }
    battle.every(0.5, () => {
      if (!up(unit)) return;
      const v = Math.min(PROTECT_CAP, PROTECT_BASE + PROTECT_PER * stacksOf(unit));
      for (const a of alliesInRange(battle, unit)) {
        holdProtect(battle, a, v, 0.6, unit);
        battle.applyStatus(a, 'resist', { duration: 0.6, source: unit, value: 0.5 });
      }
    }, { owner: unit, immediate: true });
  };

  // ---------------------------------------------------------------- S1 数据流溢出（持续）
  const spec1 = {
    kind: 'duration',
    duration: d1,
    mods: { atkPct: s1Atk },
    onStart({ battle, unit }) {
      // 获得 5 层「数据样本」（她的 T1「每层治疗 +x%」与 S2 都吃这个数）
      if (s1Stacks > 0) { addStacks(unit, s1Stacks); syncSamples(battle, unit); }
      for (const a of alliesInRange(battle, unit)) {
        battle.addBuff(a, { key: 'dsw:s1:aspd', duration: d1, mods: { aspd: s1Aspd }, source: unit, tags: ['skill'] });
      }
    },
  };

  // ---------------------------------------------------------------- S2 代码重构（瞬发）
  const spec2 = {
    kind: 'instant',
    onStart({ battle, unit }) {
      addStacks(unit, 1);              // 先「获得 1 层」，所以这一次至少消耗 1 层
      const n = stacksOf(unit);
      if (n <= 0) return;
      setStacks(unit, 0);              // 立刻消耗全部
      syncSamples(battle, unit);
      const total = (unit.mem.dswS2Atk || 0) + s2Per * n;
      unit.mem.dswS2Atk = total;
      if (unit.findBuff(KEY_S2_ATK)) battle.removeBuff(unit, KEY_S2_ATK);
      battle.addBuff(unit, { key: KEY_S2_ATK, mods: { atkPct: total }, persist: true, allowDead: true, tags: ['skill'] });
      // 治疗与回技力**各一次**：层数只进攻击力，不是每层都回一次技力
      const target = lowestAlly(battle, unit);
      if (target) {
        battle.heal(unit, target, unit.s.atk * s2Heal, { tags: ['skill', 'ds-whale'] });
        giveSp(target, 1, 'skill');
      }
    },
  };

  // ---------------------------------------------------------------- S3 深度求索·涌现（持续）
  // S3 的攻击范围 = 官方「钙质化」（塞雷娅 S3，rangeId x-3）那套 25 格菱形，而不是基础范围外扩一格。
  const CALC_GRID = [[3,0],[2,-1],[2,0],[2,1],[1,-2],[1,-1],[1,0],[1,1],[1,2],[0,-3],[0,-2],[0,-1],[0,0],[0,1],[0,2],[0,3],[-1,-2],[-1,-1],[-1,0],[-1,1],[-1,2],[-2,-1],[-2,0],[-2,1],[-3,0]];
  /**
   * S3 的范围特效：把这 25 个判定格铺在地面上（引擎的 fx kind `field`，客户端逐格点亮 + 慢脉动），持续整段技能。
   * 判定用 absoluteRangeKeys 自己算，不读 unit.rangeKeys —— 那条在 onStart 时刻是否已经刷新过取决于 hook 顺序。
   */
  const emitRangeField = (battle, unit, grid, dur) => {
    const keys = absoluteRangeKeys(grid, unit.tileR, unit.tileC, unit.dir, 0);
    const tiles = keys.map((k) => [Math.floor(k / COLS), k % COLS]);
    battle.fx('field', { x: unit.x, y: unit.y, id: unit.id, dur, tiles });
  };
  const spec3 = {
    kind: 'duration',
    duration: d3,
    targeting: { rangeGrid: CALC_GRID },
    onStart({ battle, unit }) {
      addStacks(unit, s3Stacks);
      syncSamples(battle, unit);
      battle.applyStatus(unit, 'invulnerable', { duration: d3, source: unit, value: 1 });
      emitRangeField(battle, unit, CALC_GRID, d3);   // 25 格范围铺在地上
      const maxHp = unit.s.maxHp;
      const x = unit.x, y = unit.y;
      makeZone(battle, unit, {
        x, y, radius: s3Radius, duration: d3, interval: 1, skill: 'ds-whale:deepwater',
        onPulse(b) {
          for (const a of b.alliesInRadius(x, y, s3Radius, null)) {
            if (!b.allySelectable(a, unit)) continue;
            b.heal(unit, a, maxHp * s3HealRatio, { tags: ['skill', 'ds-whale'] });
            b.addBuff(a, { key: KEY_AMP, duration: 1.2, mods: { atkPct: s3Amp, defPct: s3Amp }, source: unit, tags: ['skill'] });
          }
          for (const e of b.foesInRadius(x, y, s3Radius)) {
            if (!e.alive || e.s.flags.untargetable) continue;
            b.addBuff(e, { key: KEY_SLOW, duration: 1.2, mods: { moveMul: 1 - s3Slow }, source: unit });
            // 脆弱挂在本次伤害**之前**（与官方「脆弱是伤害附加效果，于本次伤害前生效」同一条口径）
            if (s3Fragile > 0) b.applyStatus(e, 'fragile', { duration: 1.2, source: unit, value: s3Fragile });
            b.dealDamage(unit, e, { amount: maxHp * s3DmgRatio, type: 'arts', isSkill: true, canDodge: false, tags: ['dot', 'zone', 'ds-whale'] });
          }
        },
      });
    },
  };

  return {
    skill: spec1,
    skills: { [S1]: spec1, [S2]: spec2, [S3]: spec3 },
    talents: [{ install: installT1 }, { install: installT2 }],
  };
};