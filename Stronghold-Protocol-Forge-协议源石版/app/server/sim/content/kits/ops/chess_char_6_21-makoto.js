// server/sim/content/kits/ops/chess_char_6_21-makoto.js — 结城理 (char_4217_makoto) kit, tier 6.
// Conventions of the tier-6 kits: ../shared/tier6.js; kit contract and rules: ../README.md.
//
// 6★ 特种·傀儡师 (dollkeeper). 数据全部来自官方表（character_table / skill_table / uniequip_table），
// 由 tools/custom-ops.mjs 把商店行补进活动表后照常构建：
//   特性「受到致命伤时不撤退，切换成<替身>作战（替身阻挡数为 0），持续 20 秒后自身再次替换<替身>」——
//     引擎 professions.js installDollkeeper 已经实现（切换、无敌、阻回、20 s、切回满血）；
//   天赋 1 不羁之力：<替身>状态下攻击力 +atk%、生命值 +max_hp_t1%、攻击间隔增大 base_attack_time；
//     切换为<替身>时使**攻击范围内**的敌人<停顿> sluggish 秒 —— 官方备注：只有「本体 → 替身」触发（替身 → 替身不触发），
//     范围就是替身的攻击范围，装置 / 障碍物类单位同样受影响（用 enemiesOnTiles(unit.rangeKeys) 取敌）；
//   天赋 2 S.E.E.S.队长：<替身>状态结束后发动总攻击，对 S.E.E.S. 小队队员周围的敌人造成 atk_scale × 攻击力真实伤害（可叠加）；
//     官方备注：先切「总攻击」形态（**不享受替身形态的天赋 / 技能加成**）再切回本体，期间持有无敌 + 静默 —— 所以
//     结算前先撤掉替身形态的 buff、按本体攻击力计算，并挂 0.6 s 的无敌/静默窗口；每个队员的总攻击都可对空。
//     「不会响应其他结城理 / 队员多次总攻击每 1.6 s 处理一次」在本模式只有一名结城理，暂不建模。
//   模组 PUM-Y「彼此的声音」：<替身>生命值 +max_hp（走引擎 installDollkeeper 的 hpMul 通道，换装后补满）。
//
// 三个技能都是「被动部分 + 主动：立即切换为<替身>状态」—— 数据里 skillType 全是 MANUAL、durationType NONE、
// 无持续时间，所以主动那一半是「立刻切替身」，被动那一半是「替身形态下的攻击方式」。官方把人格面具
// （俄耳甫斯 / 塔纳托斯）做成独立召唤物；本模式没有「召唤物站在主人身上」这套表现，而结城理的 skeleton 本身就带
// Doll_Skill_* 一整组替身动画，所以这里把人格面具**落在替身形态上**（同一具身体打人格面具的攻击方式），
// 这是本 kit 最主要的 [ASSUMED]（视觉与数值都按官方，召唤物那层实体不单独立出来）。
//
// S1 俄耳甫斯的竖琴：替身形态下攻击造成 atk_scale × 攻击力的法术伤害（俄耳甫斯：阻回 + 静默、不可对空）；
//   范围内有**生命比例 ≤50% 的可治疗友方单位**（不止干员）时，改为治疗**生命比例最低**的那一个，量 = heal_scale × 攻击力。
// S2 塔纳托斯的囚锁：替身形态下攻击至多 max_target 名敌人，造成 atk_scale × 攻击力的法术伤害，并按 prob 概率
//   使目标<恐惧> fear 秒；**恐惧斩杀是光环**：每 0.1 s 检测一次攻击范围内「已恐惧且生命 ≤ kill_atk_scale × 攻击力」的敌人，
//   造成 9999999 **无来源真实伤害**（不可闪避 / 格挡 / 未命中）；每个目标每次进入范围最多 1 次，斩杀未死不重试，
//   离开范围后重置（所以不再挂在伤害钩子上，也不需要递归保护）。
// S3 开辟明日的剑刃：替身状态下攻击速度 +talent@attack_speed，攻击至多 max_target 名敌人并造成<弱点伤害>
//   （弱点伤害 = 按目标防御 / 法抗取物理或法术里更高的那一类，items/battle.js weaknessRetype）。
//   两个人格面具按官方分工（unit.mem.makotoPersona）：
//     * 塔纳托斯（替身状态的**初始**召唤）：攻速 + 弱点伤害 + 多目标；
//     * 俄耳甫斯（「塔纳托斯在场时，开启技能或受到致命伤时改为召唤俄耳甫斯」）：在这个 kit 里由
//       ① 替身中再次开启 S3、② 因致命伤进入替身 两条触发；它带来阻挡数 +block_cnt、范围内友方 prob 的
//       物理与法术闪避；**俄耳甫斯·改 不进行普通攻击**（缴械 + 静默），阻挡恢复为 2，并且治疗是**延迟治疗**
//       （施术后 0.5 s 结算，每秒一次，至多 max_target_heal 名生命不满的友方，量 = heal_scale × 攻击力），直到替身结束。
//   天赋 2 的总攻击按「S.E.E.S. 队员」取半径（isSeesMember：结城理本人 + 同 teamId 'sees' 的友方，可叠加）。
//   模组 PUM-Y 的生命加成用 hpMul 走引擎 installDollkeeper 的同一条通道，并在换装后补满 —— 替身带着自己的满血进场。

import { num, talentBb, traitBb, skillBbOf, up } from '../shared/tier1.js';
import { COLS } from '../../../constants.js';
import { weaknessRetype } from '../../items/battle.js';

const S1 = 'skchr_makoto_1';
const S2 = 'skchr_makoto_2';
const S3 = 'skchr_makoto_3';
/** 替身形态的 buff key（天赋 1 的属性、S3 的攻速 / 阻挡 / 光环各一条）。 */
const K_TALENT = 'makoto:talent';
const K_DOLL_HP = 'makoto:doll:module';
const K_S3 = 'makoto:s3';
/** 天赋 2 的总攻击半径：S.E.E.S. 队员周围 1.5 格（官方未给数值，按「周围一定范围」取 1.5 格）。 */
const ALL_OUT_RADIUS = 1.5;
/**
 * S3 的两个人格面具（官方：「替身状态初始召唤塔纳托斯……塔纳托斯在场时，开启技能或受到致命伤时改为召唤俄耳甫斯」）：
 * 塔纳托斯 = 攻速 + 弱点伤害；俄耳甫斯 = 阻挡 +2 + 友方闪避与每秒治疗。状态放在 unit.mem.makotoPersona。
 */
const PERSONA_THANATOS = 'thanatos';
const PERSONA_ORPHEUS = 'orpheus';
/** S.E.E.S. 小队（天赋 2 的「队员」）：本模式池里只有结城理自己；同队（power.teamId = 'sees'）的干员一并算。 */
const SEES_CHAR_IDS = Object.freeze(['char_4217_makoto']);
const isSeesMember = (u) => {
  if (!up(u)) return false;
  const id = u.def?.charId;
  if (!id) return false;
  if (SEES_CHAR_IDS.includes(id)) return true;
  const powers = u.def?.powers || u.def?.raw?.powers || [];
  return powers.some((p) => p && (p.teamId === 'sees'));
};

export default {
  chess_char_6_21_a: (bb, chess, def) => {
    const t0 = talentBb(chess, 0);
    const t1 = talentBb(chess, 1);
    const tb = traitBb(chess);
    const s1 = skillBbOf(chess, S1);
    const s2 = skillBbOf(chess, S2);
    const s3 = skillBbOf(chess, S3);
    /** 当前选择的技能 id（普通 / 精锐、三个技能都读同一份）。 */
    const sid = () => {
      const list = chess?.skills || [];
      const def1 = list.find((s) => s && s.isDefault);
      return (def?.skill?.id ?? def?.skill?.skillId ?? def1?.skillId ?? null);
    };
    const inDoll = (u) => up(u) && !!u.trait.doll && !u.trait.dollSwitching;

    /**
     * 替身形态下的「被动」：天赋 1 的属性（攻击力 / 生命 / 攻击间隔）与所选技能的攻击方式。
     * 每 0.2 s 对一次账（进入 / 离开替身由引擎的 trait 状态决定，kit 只跟）。
     */
    const syncDollBuffs = (battle, unit) => {
      const want = inDoll(unit);
      const key = `makoto:form:${sid() ?? 'none'}`;
      const has = unit.findBuff(key);
      if (want && !has) {
        const mods = { atkPct: num(t0.atk), hpPct: num(t0.max_hp_t1) };
        if (num(t0.base_attack_time) > 0) mods.batPct = num(t0.base_attack_time);
        if (unit.mem.makotoForm !== key) {
          // 换技能时先撤掉上一条形态 buff，避免两个技能的攻击方式叠加
          if (unit.mem.makotoForm) battle.removeBuff(unit, unit.mem.makotoForm);
          unit.mem.makotoForm = key;
        }
        battle.addBuff(unit, { key, mods, refresh: 'replace', duration: 0.4, tags: ['trait'] });
      } else if (!want && has) {
        battle.removeBuff(unit, key);
        battle.removeBuff(unit, K_S3);
        battle.removeBuff(unit, K_DOLL_HP);
        unit.mem.makotoForm = null;
        unit.mem.makotoPersona = null;
        return;
      }
      // S3 的人格面具效果每 0.2 s 重写一次（换人立刻生效，不用等形态 buff 到期）：
      //   塔纳托斯（初始）= 攻击速度 +talent@attack_speed（弱点伤害见 hit 钩子，目标数见 tick 钩子）；
      //   俄耳甫斯 = 阻挡数 +block_cnt —— 替身形态本身阻挡 0（引擎 installDollkeeper 的 blockCnt −99），
      //   所以要先补回那 −99 与本体的阻挡数，净阻挡数才是 block_cnt。
      const s3Selected = (unit.skill?.id ?? sid() ?? '') === S3;
      if (want && s3Selected) {
        const block = num(s3['attack@block_cnt']);
        const personaMods = unit.mem.makotoPersona === PERSONA_ORPHEUS
          ? (block > 0 ? { blockCnt: 99 - Math.max(0, unit.base.blockCnt || 0) + block } : {})
          : { aspd: num(s3['talent@attack_speed']) };
        battle.addBuff(unit, { key: K_S3, mods: personaMods, refresh: 'replace', duration: 0.4, tags: ['skill'] });
      } else {
        battle.removeBuff(unit, K_S3);
      }
    };

    /**
     * 天赋 1 的「切换为替身时使周围敌人停顿」。官方备注：**只有本体 → 替身**才触发（替身 → 替身不触发），
     * 停顿范围 = 替身的**攻击范围**，装置 / 障碍物类单位也会被影响 —— 所以按 unit.rangeKeys 取敌（含装置类敌人）。
     */
    const onEnterDoll = (battle, unit) => {
      const sec = num(t0.sluggish);
      if (!(sec > 0)) return;
      const hit = battle.enemiesOnTiles(unit.rangeKeys, unit, { canHitFly: true });
      for (const e of hit) {
        battle.applyStatus(e, 'sluggish', { duration: sec, source: unit });
      }
      battle.fx('aoe', { x: unit.x, y: unit.y, id: unit.id, radius: 2, skill: 'makotoSluggish' });
    };

    /**
     * 模组 PUM-Y「彼此的声音」：替身的生命值 +trait.bb.max_hp（20%）。
     * 用 hpMul（引擎 installDollkeeper 用的同一条），并在换装后把生命补满 —— 官方「切换时为替身自己的生命值」，
     * 否则替身会带着本体的残血进场。
     */
    const applyModuleHp = (battle, unit) => {
      const bonus = num(tb.max_hp);
      if (!(bonus > 0)) return;
      battle.addBuff(unit, { key: K_DOLL_HP, mods: { hpMul: 1 + bonus }, duration: Infinity, tags: ['module'] });
      unit.markDirty();
      unit.hp = unit.s.maxHp;
    };

    /**
     * 天赋 2：替身状态结束后的总攻击（S.E.E.S. 队员周围 1.5 格的敌人吃 atk_scale × 攻击力真实伤害；多个队员可叠加）。
     * 官方备注：先切「总攻击」形态（**不享受替身形态的天赋 / 技能加成**）→ 打完再切回本体；总攻击期间持有无敌、静默；
     * 每个队员的总攻击都可对空（foesInRadius 本身按可选中判定，含飞行单位）。
     */
    const allOutAttack = (battle, unit) => {
      const scale = num(t1.atk_scale);
      if (!(scale > 0)) return;
      // 先把替身形态的加成撤掉，再用「本体」的攻击力结算（否则会吃到 +atk% 与 +生命）
      if (unit.mem.makotoForm) battle.removeBuff(unit, unit.mem.makotoForm);
      battle.removeBuff(unit, K_S3);
      battle.removeBuff(unit, K_DOLL_HP);
      unit.mem.makotoForm = null;
      unit.markDirty();
      // 「总攻击」形态：无敌 + 静默（时长按切换演出取 0.6 s [ASSUMED]）
      battle.addBuff(unit, { key: 'makoto:allOut', duration: 0.6, flags: { invulnerable: true, silence: true }, tags: ['talent'] });
      const members = (battle.allyUnits || []).filter((a) => isSeesMember(a));
      for (const m of members) {
        battle.fx('aoe', { x: m.x, y: m.y, id: m.id, radius: ALL_OUT_RADIUS, skill: 'makotoAllOut' });
        for (const e of battle.foesInRadius(m.x, m.y, ALL_OUT_RADIUS)) {
          if (e.alive) battle.dealDamage(unit, e, { amount: unit.s.atk * scale, type: 'true', isSkill: true, canDodge: false, tags: ['talent', 'allOut'] });
        }
      }
    };

    /** 主动那一半：立即切换为<替身>状态（引擎的 dollSwitch 钩子）。 */
    const switchToDoll = (battle, unit) => {
      if (!up(unit) || unit.trait.doll || unit.trait.dollSwitching) return;
      battle.emit('dollSwitch', { unit, reason: 'skill', done: false });
    };

    return {
      skills: {
        // S1 俄耳甫斯的竖琴：法术伤害 / 低血友方改治疗
        [S1]: {
          kind: 'instant',
          onStart({ battle, unit }) { switchToDoll(battle, unit); },
          onEnd({ battle, unit }) { if (inDoll(unit)) battle.fx('summon', { x: unit.x, y: unit.y, id: unit.id, token: 'orpheus' }); },
        },
        // S2 塔纳托斯的囚锁：多目标 + 恐惧 + 低血恐惧目标处决
        [S2]: {
          kind: 'instant',
          onStart({ battle, unit }) { switchToDoll(battle, unit); },
        },
        // S3 开辟明日的剑刃：攻速 / 阻挡 / 弱点伤害 / 闪避与治疗光环
        [S3]: {
          kind: 'instant',
          onStart({ battle, unit }) {
            // 「塔纳托斯在场时，开启技能……改为召唤俄耳甫斯」：已经在替身里且当前是塔纳托斯 ⇒ 换成俄耳甫斯，
            // 替身状态不结束（换人，不换形态）
            if (inDoll(unit) && unit.mem.makotoPersona === PERSONA_THANATOS) {
              unit.mem.makotoPersona = PERSONA_ORPHEUS;
              battle.fx('swap', { x: unit.x, y: unit.y, id: unit.id, form: 'orpheus' });
              syncDollBuffs(battle, unit);
              return;
            }
            switchToDoll(battle, unit);
          },
        },
      },
      talents: [
        // 天赋 1 不羁之力
        { install(battle, unit) {
          battle.every(0.2, () => { if (up(unit)) syncDollBuffs(battle, unit); }, { owner: unit, immediate: true });
          // 官方 S3：替身状态**初始召唤塔纳托斯**；因为「受到致命伤」而进入替身时改为**俄耳甫斯**
          battle.on('fatal', (c) => {
            if (c.unit === unit && !c.prevented && !unit.trait.doll) unit.mem.makotoFatalEntry = true;
          }, { owner: unit, priority: 50 });
          battle.on('dollSwap', (c) => {
            if (c.unit !== unit) return;
            if (c.form === 'doll') {
              const s3Selected = (unit.skill?.id ?? sid()) === S3;
              unit.mem.makotoPersona = !s3Selected ? null : (unit.mem.makotoFatalEntry ? PERSONA_ORPHEUS : PERSONA_THANATOS);
              unit.mem.makotoFatalEntry = false;
              onEnterDoll(battle, unit);
              applyModuleHp(battle, unit);
            } else {
              unit.mem.makotoPersona = null;
              battle.removeBuff(unit, K_DOLL_HP);
              allOutAttack(battle, unit);
            }
          }, { owner: unit });
        } },
      ],
      install(battle, unit) {
        // ---- 替身形态的攻击方式（所选技能 = 当前技能的 id） ------------------------------------------------
        battle.on('hit', (c) => {
          if (c.source !== unit || !c.target || c.target.side !== 'enemy' || !c.dmg || !inDoll(unit)) return;
          const skill = unit.skill?.id ?? sid();
          const dmg = c.dmg;
          if (skill === S1) {
            dmg.type = 'arts';
            // 官方：范围内存在生命比例 ≤50% 的**可治疗**友方单位（不止干员）时，改为治疗**生命比例最低**的那一个
            const low = (battle.alliesFor(unit) || [])
              .filter((a) => a !== unit && a.alive && a.deployed && a.hpRatio <= 0.5 && unit.rangeKeySet?.has(a.tileR * COLS + a.tileC))
              .sort((a, b) => a.hpRatio - b.hpRatio)[0];
            if (low) {
              dmg.amount = 0;
              dmg.isSplash = true;
              battle.heal(unit, low, unit.s.atk * num(s1['attack@heal_scale']));
              battle.fx('heal', { x: low.x, y: low.y, id: unit.id });
              return;
            }
          } else if (skill === S2) {
            dmg.type = 'arts';
            const prob = num(s2['attack@prob']);
            if (prob > 0 && battle.rng() < prob) battle.applyStatus(c.target, 'fear', { duration: num(s2['attack@fear']), source: unit });
          } else if (skill === S3) {
            // 弱点伤害是塔纳托斯那一半；换成俄耳甫斯后他的攻击仍然是弱点伤害（官方：俄耳甫斯只改阻挡与光环）
            weaknessRetype(dmg, unit, c.target);
          }
        }, { owner: unit, priority: 10 });

        // S2 · 塔纳托斯：恐惧斩杀是**光环效果**（官方备注）——每 0.1 s 检测一次攻击范围内的敌人，
        // 对「已恐惧且生命 ≤ kill_atk_scale × 攻击力」的目标造成 9999999 **无来源真实伤害**
        // （不可闪避 / 格挡 / 未命中）；每个目标**每次进入范围最多 1 次**，斩杀后没死不重试；离开范围后重置。
        battle.every(0.1, () => {
          if (!up(unit) || !inDoll(unit)) return;
          if ((unit.skill?.id ?? sid()) !== S2) return;
          const kill = num(s2['attack@kill_atk_scale']);
          if (!(kill > 0)) return;
          const done = unit.mem.makotoExecuted || (unit.mem.makotoExecuted = new Set());
          const inRange = new Set();
          for (const e of battle.enemiesInKeys(unit.rangeKeys, unit, { canHitFly: true })) {
            if (!e.alive) continue;
            inRange.add(e.id);
            if (done.has(e.id)) continue;
            const feared = !!e.findBuff('fear') || !!e.s?.flags?.fear;
            if (!feared || e.hp > unit.s.atk * kill) continue;
            done.add(e.id);
            battle.dealDamage(null, e, { amount: num(s2['attack@kill_damage'], 9999999), type: 'true', isSkill: true, canDodge: false, tags: ['skill', 'execute'] });
            battle.fx('aoe', { x: e.x, y: e.y, id: unit.id, radius: 1, skill: 'makotoExecute' });
          }
          // 离开过范围的单位，下次进入可以再被斩杀一次
          for (const id of [...done]) if (!inRange.has(id)) done.delete(id);
        }, { owner: unit });

        // S3 · 俄耳甫斯：范围内友方闪避 + 每秒治疗（持续到替身状态结束；塔纳托斯在场时没有这一段）
        battle.every(1, () => {
          if (!up(unit) || !inDoll(unit)) return;
          if ((unit.skill?.id ?? sid()) !== S3) return;
          if (unit.mem.makotoPersona !== PERSONA_ORPHEUS) return;
          const allies = battle.alliesFor(unit).filter((a) => a.alive && a.deployed && unit.rangeKeySet?.has(a.tileR * COLS + a.tileC));
          for (const a of allies) {
            const prob = num(s3['attack@prob']);
            if (prob > 0) battle.addBuff(a, { key: 'makoto:s3:dodge', mods: { dodgePhys: prob, dodgeArts: prob }, duration: 1.3, refresh: 'replace', tags: ['skill'] });
          }
          // 俄耳甫斯·改：**不进行普通攻击**（缴械自己），阻挡恢复为 2（见 syncDollBuffs）
          // 官方：俄耳甫斯·改持有阻回（引擎的替身形态已给 noSp）+ 静默，且不进行普通攻击
          battle.addBuff(unit, { key: 'makoto:orpheusDisarm', duration: 1.3, refresh: 'replace', flags: { disarm: true, silence: true }, tags: ['skill'] });
          // 治疗是**延迟治疗**：施术后 0.5 s 才结算（官方备注，属于治疗行为、受禁疗制约）
          const maxHeal = Math.max(1, Math.floor(num(s3['attack@max_target_heal'])));
          const amount = unit.s.atk * num(s3['attack@heal_scale']);
          const hurt = allies.filter((a) => a.hpRatio < 1).sort((a, b) => a.hpRatio - b.hpRatio).slice(0, maxHeal);
          for (const a of hurt) {
            battle.fx('heal', { x: a.x, y: a.y, id: unit.id });
            battle.after(0.5, () => {
              if (!up(unit) || !a.alive || !inDoll(unit)) return;
              battle.heal(unit, a, amount);
            }, { owner: unit });
          }
        }, { owner: unit });
        // 攻击目标数：S2 / S3 的 max_target（引擎读 buff 的 maxTargets）
        battle.on('tick', () => {
          if (!up(unit)) return;
          const skill = unit.skill?.id ?? sid();
          const want = skill === S2 ? Math.max(1, Math.floor(num(s2['attack@max_target']))) : skill === S3 ? Math.max(1, Math.floor(num(s3['attack@max_target']))) : 1;
          const has = unit.findBuff('makoto:targets');
          if (inDoll(unit) && want > 1 && !has) battle.addBuff(unit, { key: 'makoto:targets', mods: { maxTargets: want }, refresh: 'replace', duration: 0.4, tags: ['skill'] });
          else if ((!inDoll(unit) || want <= 1) && has) battle.removeBuff(unit, 'makoto:targets');
        }, { owner: unit });
      },
    };
  },
};
