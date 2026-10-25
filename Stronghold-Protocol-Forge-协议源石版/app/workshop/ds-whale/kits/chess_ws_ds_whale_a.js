// 工坊技能脚本：大肥鱼（DeepSeek 鲸鱼娘）— 6★ 吟游者。
//
// 设计稿（业主 2026-10-24，见包内 PROVENANCE 的 KIT 一节）：
//   T1 大模型算力：范围内友方技力自然回复 +0.2/秒；范围内友方释放技能时自身 +1 层「数据样本」（最多 20），
//                  每层自身治疗量 +3%
//   T2 吃白饭：在场每秒消耗 1 点部署费用；范围内友方获得 (20% + 层数×2%) 庇护与抵抗（不设上限）
//   S1 数据流溢出（自动触发 / 持续 20 s）：+5 层「数据样本」，攻击力 +45%，范围内友方攻速 +35，
//                   **特性（吟游者光环比例）提高到 35%**，持续 20 s
//   S2 代码重构（自动触发）：先 +1 层再**清空全部**样本：每层**本场战斗特性 +2%**；并对范围内生命比例最低的友方
//                   进行一次「她最大生命 80%」的治疗 + 护盾、回复 1 点技力
//   S3 深度求索·涌现（持续）：样本 +20，展开「深水区」+攻击范围扩大；自身不受伤害；区内友方每秒回复她 50% 最大生命的
//                   生命、并获得**鼓舞 = 她最大生命 65%**；区内敌人移速 -50%、脆弱 +50%（Lv4 为 +40%）、
//
// 一处与官方口径的差别（业主 2026-10-25 已把「1.5 倍」那条去掉，改成鼓舞 + 特性）：
//   * 「抗性」用引擎的状态 resist（同名取最高、默认减半）实现，覆盖全部常规控制；持续 0.6s 由 0.5s 的光环心跳续上。
//   * 鼓舞（inspire）按官方口径是「附加的基础属性」，这里用引擎的 `hpFlat` 挂最大生命值，并**按目标当前的
//     最大生命倍率折算**（`s.maxHp / base.maxHp`），这样 +生命% 的 buff 不会把鼓舞一起放大。
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
const KEY_INSPIRE_HP = 'inspire:hp';  // 鼓舞（最大生命值）—— 与魔王的鼓舞同一个 key，同名取最强
const KEY_S2_SHIELD = 'dsw:s2:shield';
const KEY_SLOW = 'dsw:s3:slow';       // 深水区: enemy -50% move

// S3 的那段音乐：包内素材的 URL 规则是 `/workshop-assets/<包 id>/<包内路径>`（shared/workshop.js 的
// WORKSHOP_MEDIA_PREFIX）。技能开始播、技能结束（正常结束/被打断/阵亡）停 —— 两端都发 fx 事件，客户端 `music` /
// `musicStop` 负责播与停。改了包 id 或文件路径要同步改这里。
const PACK_ID = 'ds-whale';
const S3_MUSIC = `/workshop-assets/${PACK_ID}/voice/LetMeGo.m4a`;

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
  // 庇护 = 基线 + 每层 × 数据样本层数（业主 2026-10-25：20 + 2x%）。数据里不写上限就不截断（默认 1 = 不封顶）；
  // 「同名效果取最高」（applyStrongest），所以与其它庇护来源不会叠乘，只取最大那一份。
  const PROTECT_CAP = num(t2.protect_cap, 1);

  const d1 = num(r1.duration, 20);
  const d3 = num(r3.duration, 25);
  const s1Atk = num(b1.atk, 0.45);
  const s1Aspd = num(b1.attack_speed, 35);
  // S1 的 +5 层是规格里的固定值：写成数据键 `bb.stacks` 会被共享校验器的「通用黑板白名单」当成未知键提醒
  // （那只校验 `skill` 这一条默认技能），所以默认值放在这里；哪天数据里真写了 stacks，这一段照样读得到。
  const s1Stacks = Math.max(0, Math.floor(num(b1.stacks, 5)));
  const s1Trait = num(b1.trait_ratio, 0.35);          // S1 期间特性提高到 35%
  const s2TraitPer = num(b2.trait_per_stack, 0.02);   // S2 每消耗 1 层：本场战斗特性 +2%
  const s2HealRatio = num(b2.heal_maxhp_ratio, 0.8);  // S2 治疗：她最大生命的 80%
  const s2ShieldRatio = num(b2.shield_maxhp_ratio, 0.8); // S2 护盾：同上
  const s3Stacks = Math.floor(num(b3.stacks, 20));
  const s3Radius = num(b3.radius, 2.5);
  const s3HealRatio = num(b3.heal_maxhp_ratio, 0.5);
  const s3Inspire = num(b3.inspire_max_hp_ratio, 0.65); // S3 鼓舞：她最大生命的 65%
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

  // ---------------------------------------------------------------- 特性（吟游者光环比例）与鼓舞
  // 特性 = `profile.auraRatio`：她的光环每秒回血 = 攻击力 × 比例（professions.js installBard）。三个来源：
  //   · 基础值（trait.bb 的 attack@atk_to_hp_recovery_ratio，0.1）
  //   · S2 的**永久**加成：每消耗 1 层「数据样本」+2%（整场保留，存 mem.dswAuraBonus）
  //   · S1 的**临时**覆盖：技能期间提高到 35%（复刻魔王的 setTrait / resetTrait）
  const auraBase = (u) => (u.mem.dswAuraBase != null ? u.mem.dswAuraBase : (u.mem.dswAuraBase = u.profile.auraRatio));
  const applyAura = (u) => {
    if (!u || !u.profile) return;
    const base = auraBase(u);
    const bonus = u.mem.dswAuraBonus || 0;
    u.profile.auraRatio = u.mem.dswS1Trait ? Math.max(base + bonus, s1Trait) : base + bonus;
  };

  /**
   * 鼓舞（ba.inspire「获得额外附加的基础属性加成（同类属性取最高）」）：给目标加 `val` 点最大生命（`hpFlat`），
   * 与魔王的 鼓舞 用**同一个 buff key**（`inspire:hp`）—— 所以多来源取最强的那一份，不会叠乘。
   * 官方是「附加在目标自己的百分比乘算之后」，这里按目标当前的最大生命倍率折算一下，效果等价。
   */
  const inspireHp = (battle, target, val, src) => {
    if (!(val > 0) || !target || !target.alive || (target.mem && target.mem.noInspire)) return;
    const cur = target.findBuff(KEY_INSPIRE_HP);
    if (cur && cur.data && cur.data.src !== src.id && cur.data.val > val && cur.timeLeft > 1e-6) return;
    // 换算系数 f = 目标当前的「最大生命倍率」（hpPct / hpMul）。必须先把自己上一次的鼓舞摘掉再量，否则量到的是
    // 「含鼓舞的 maxHp」——每刷一次都会把系数算大一点，数值会越滚越小（这是第一次实现踩到的坑）。
    const hadMine = !!cur;
    if (hadMine) battle.removeBuff(target, KEY_INSPIRE_HP);
    const base = Math.max(1, (target.base && target.base.maxHp) || target.s.maxHp);
    const f = Math.max(1e-6, target.s.maxHp / base);
    battle.addBuff(target, {
      key: KEY_INSPIRE_HP, mods: { hpFlat: val / f }, duration: 0.6, source: src,
      // 不做「可见状态」：它每 0.5 秒重刷一次，visible 会让客户端每刷一次都收到一条 status 0/1
      data: { src: src.id, val },
    });
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
      // 特性提高到 35%（技能结束后回到「基础 + S2 的永久加成」）
      unit.mem.dswS1Trait = true;
      applyAura(unit);
    },
    onEnd({ unit }) {
      unit.mem.dswS1Trait = false;
      applyAura(unit);
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
      // 每消耗 1 层：本场战斗**特性** +2%（永久，存 mem；与 S1 的临时 35% 取较高者）
      unit.mem.dswAuraBonus = (unit.mem.dswAuraBonus || 0) + s2TraitPer * n;
      applyAura(unit);
      // 治疗 + 护盾 + 回技力**各一次**（层数只进特性，不是每层都回一次技力）
      const target = lowestAlly(battle, unit);
      if (target) {
        const big = unit.s.maxHp;
        if (s2HealRatio > 0) battle.heal(unit, target, big * s2HealRatio, { tags: ['skill', 'ds-whale'] });
        if (s2ShieldRatio > 0) {
          battle.addBuff(target, {
            key: KEY_S2_SHIELD, shield: big * s2ShieldRatio, duration: 12, source: unit,
            visible: true, tags: ['skill', 'ds-whale'],
          });
        }
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
      battle.fx('music', { url: S3_MUSIC, dur: d3 });
      const maxHp = unit.s.maxHp;
      const x = unit.x, y = unit.y;
      makeZone(battle, unit, {
        x, y, radius: s3Radius, duration: d3, interval: 1, skill: 'ds-whale:deepwater',
        onPulse(b) {
          for (const a of b.alliesInRadius(x, y, s3Radius, null)) {
            if (!b.allySelectable(a, unit)) continue;
            b.heal(unit, a, maxHp * s3HealRatio, { tags: ['skill', 'ds-whale'] });
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
    // 鼓舞：整段技能内，攻击范围内的**其它**友方获得她最大生命 65% 的鼓舞（同名取最强，每 0.5s 续一次）
    onTick({ battle, unit }) {
      if (!(s3Inspire > 0)) return;
      const val = unit.s.maxHp * s3Inspire;
      for (const a of battle.alliesInGrid(unit)) if (a !== unit) inspireHp(battle, a, val, unit);
    },
    // 技能结束（时间到 / 被掐断 / 阵亡）就停音乐：`dur` 只是兜底，真正的停止点是这里
    onEnd({ battle }) {
      battle.fx('musicStop', {});
    },
  };

  return {
    skill: spec1,
    skills: { [S1]: spec1, [S2]: spec2, [S3]: spec3 },
    talents: [{ install: installT1 }, { install: installT2 }],
  };
};