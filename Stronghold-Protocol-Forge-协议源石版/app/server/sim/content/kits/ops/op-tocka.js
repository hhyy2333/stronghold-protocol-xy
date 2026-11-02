// server/sim/content/kits/ops/op-tocka.js — 冻河 (char_4244_tocka) kit, tier 6. 自选 operator kit: the 6★ 辅助·游击手
// (SUPPORT / supportiveranger) owned pick of the tier-5 and tier-6 自选 slots — all three skills, both talents and the
// trait, at every form. Kit contract and the 自选 rules: ../README.md ("How to add an operator (自选)").
//
// Forms (data/backups.json units.char_4244_tocka, the DIY slot statuses): normal = E2 Lv1, skills at rank 4, no module;
// elite = E2 Lv60, skills at rank 7. The operator has no modules at all (`moduleNames {}`, `modules []` — v79 carries
// none), so no module code lives here. Full potential (the owner's decision of 2026-10-07): the talents' 潜能 variants
// are already resolved into `chess.talents` (shared/potential.js atPotential).
// Sources: the official v79 rows — character_table / skill_table / range_table copied verbatim into
// tools/extra-operators.json and injected by tools/extra-operators.mjs (the tree's own gamedata dump stops at
// char_4237_jcinta) — as built into data/backups.json; the dossier 参考/干员数值_塔露拉_冻河_国度_v79.md §「冻河
// （char_4244_tocka）」 (per-rank skill text, talent text incl. the 潜能 variants, 潜能, 面板, 免疫); the official term
// table (gamedata_const termDescriptionDict) for `ba.triggereffect` 「触发型效果」 (只选择未持有该效果的目标) and
// `ba.barrier` 屏障. Every number is read from a blackboard; the few names/ordering rules that no source settles are
// marked [ASSUMED].
//
// ================================ the 触发型效果 (triggered effect) model ========================================
// The sim had no vocabulary for it (`grep 触发型 server/` found nothing; 游击手 / 陷阱师 are bare profiles), so the kit
// builds it out of one named buff per 冻河 and a set of trigger hooks, all of it in the buff's own `data` and her
// `unit.mem` — nothing module-level, nothing across battles:
//  1. A skill 施加s the effect to one or more 干员 (never a summon): a buff `tocka:trigger#<冻河.id>` on the holder,
//     `data: { ownerId, kind }` — `kind` = 'S1' | 'S2' | 'S3' picks which payload the copy carries. The id suffix keeps
//     two 冻河 of one shared field apart. The effect is NOT consumed by firing: it stays on the holder and can fire
//     again (S1 / S2), and S3 moves ("转移") it to another ally. [ASSUMED: no source says a 触发型效果 is spent by its
//     trigger; 夜的哑然 — "自身的触发型效果触发时" — only makes sense for a re-triggerable effect.]
//  2. Each copy carries the trigger its own skill states after the colon: S1 「受到攻击时」 (the holder takes an enemy
//     damage instance — tier1 `byEnemyAttack`, the official ON_TAKE_DAMAGE counters), S2 「技能可开启时」 (**the holder's
//     own** skill becoming castable, edge-detected every tick on its `skill.ready`), S3 「开启技能时」 (the cast itself; "已存在时
//     改为将其触发" means a cast that lands on a holder fires instead of applying).
//  3. A trigger runs the payload of its kind and then 夜的哑然 (T1) once per trigger event. The hooks are registered by
//     `install`, so they run under whichever skill the slot picked; each one checks `unit.alive`. Nothing is written to
//     `bb` / `chess` / `def` — every number is copied out of a blackboard at read time.
//  4. 施加 (not 触发) arms 雪的印痕 (T2): the next NORMAL attack becomes an area attack carrying 虚弱 and an arts burn —
//     "next" = the next attack that BEGINS after the 施加; the sim casts at the attack's own moment (the official cast
//     plays its 前后摇 first), so the attack of that very tick is skipped [ASSUMED].
//  5. 冻河 leaving the field ends her hooks (they are owned by her), so the copies go inert; the holder keeps the buff.
// =================================================================================================================
//
// - Trait 「可以使用触发型效果协助作战」: no stat effect and no profession change of its own — 辅助·游击手 is a bare profile
//   (professions.js), so the trait IS the 触发型效果 the three skills place. Ranged physical arrows, 3-18 (14 tiles),
//   block 1, canHitFly (data fields), ground-targetable.
// - T1 夜的哑然 (talent 0 bb: `sp` 2, `heal_scale` 1; 潜能 2 lifts heal_scale 0.8 → 1): when her own 触发型效果 triggers —
//   +`sp` SP to 冻河 (`giveSp`: no SP while a timed skill runs, the AK rule) and a heal of `heal_scale` × her ATK to one
//   ally in her attack range (`battle.lowestHpAllyInRange` — an injured ally; all full ⇒ the heal is wasted [ASSUMED:
//   the official selector picks a 生命值未满 ally, PRTS 治疗 order]). "生命回复速度" it is not: a plain heal (checklist 11).
// - T2 雪的印痕 (talent 1 bb: `attack@t2_buff_duration` 8, `attack@t2_magic_atk_scale` 0.8, `attack@projectile_range` 1.5,
//   `attack@t2_atk` −0.2; 潜能 4 lifts the duration 6 → 8): after 冻河 施加s a 触发型效果, her next NORMAL attack is an area
//   attack: every enemy within `attack@projectile_range` of the struck target is hit as well, each of them gets 虚弱
//   `|attack@t2_atk|` (20 %) for `attack@t2_buff_duration` s and takes `attack@t2_magic_atk_scale` × ATK 法术伤害 per
//   second for as long. [ASSUMED] 「造成范围伤害」 is modelled as the engine's multi-target normal attack (beforeAttack
//   extends `ctx.targets`) rather than a splash profile: the sim has no per-attack splashRadius override that survives a
//   projectile's flight (a profile mutated in beforeAttack is still read at impact, ai.js resolveHit), and the splash
//   would have to be rolled back. The engine's splash deals `splashScale` × ATK (1 for a bare profile), so the numbers
//   agree; the difference is that the extra victims go through the full attack path (dodge, attackId, on-hit effects).
//   The ATK of the burn is the one at the attack; the burn ticks once a second for the status's whole duration and is
//   not owned by 冻河 (a debuff on the enemy outlives its source — the `makeZone` rule).
// - S1 一无所有之人 (AUTO, instant; bb `shield_atk_scale`, `shield_time`, `stun`, `max_target`): 施加 to up to `max_target`
//   (2 at rank 7, 3 at M3) allies inside her attack range that do NOT hold it yet. On a trigger the holder gains a 屏障
//   of `shield_atk_scale` × 冻河's ATK decaying over `shield_time` s and the attacking enemy is 晕眩 `stun` s.
//   Order of the picks [ASSUMED]: the most injured first (lowest HP ratio, then deployment order) — no source names a
//   selector; 冻河 herself counts (her own tile is inside 3-18, and T1 is written for "自身的触发型效果").
// - S2 意欲呼啸之心 (AUTO, instant; bb `attack_speed`, `buff_duration`, `max_target`): 施加 to `max_target` (1) ally
//   ANYWHERE on the field that does not hold it yet [ASSUMED: the most injured one, as S1]. 「技能可开启时」 — **the
//   holder's own** skill becoming castable — the holders gain ASPD +`attack_speed` for `buff_duration` s, and —
//   「期间技能变为自动开启」 — **that holder's** skill is `SP_FULL` (auto-cast as soon as it is ready) for the window, then
//   back to the strategy it had. The sentence's subject is the 干员 who received the effect, and it is the half a player
//   feels: until 2026-11-01 this window was switched onto 冻河 herself instead (she is `SP_FULL` from the data anyway), so
//   an ally holding the effect never cast anything on its own — the owner's 「2技能不能让别人自动开启使用技能没用」. The
//   readiness edge is read inside the tick hook below (`skill.ready`, edge-detected per holder). Once a
//   holder exists every fire re-arms the 15 s window, and under SP_FULL the skill is ready again well inside it: the
//   loop sustains itself until the copy leaves the holder or her SP is blocked — the text's own consequence [ASSUMED].
// - S3 踽踽独行之春 (MANUAL, 20 s, data rule DEFAULT; bb `attack_speed`, `attack@max_target`, `attack@atk_scale`,
//   `attack@stun`, `bonus_init_atk`, `bonus_atk_dec_per_sec`, `bonus_duration`, `bonus_sp`): ASPD +`attack_speed`; each
//   attack hits `attack@max_target` enemies for `attack@atk_scale` × ATK physical and 晕眩s them `attack@stun` s. On
//   starting, 冻河 施加s the effect to another 干员 in her range — the one with the highest SP ratio (技力比例 = sp/spCost,
//   capped at 1), which is exactly the ally 「并将该触发型效果转移给冻河攻击范围内技力比例最高的另一名干员」 names, so the
//   two halves of the text pick the same ally [ASSUMED: the first sentence's 「另一名干员」 is that pick]; a copy another
//   ally still holds is removed first (the transfer). If that ally already holds it the cast fires it instead
//   ("已存在时改为将其触发"). 「开启技能时自身和冻河攻击力+bonus_init_atk（在bonus_duration秒内衰减）」 is the payload of the copy,
//   fired by the HOLDER activating any skill (`skillStart`, hooked below) — the 自身 of that clause is the 干员 who
//   activated: the holder and 冻河 both get `bonus_init_atk` ATK falling linearly by `bonus_atk_dec_per_sec` per second to 0
//   over `bonus_duration` s. Her own cast therefore grants nothing unless it lands on an ally that already holds the copy,
//   which is the 「已存在时改为将其触发」 path and fires right away (owner 2026-11-01: the ATK used to hang on her cast).
//   While the skill runs the holder gains `bonus_sp` SP per
//   second (a 1 s accumulator on the tick hook, `giveSp`). The decaying ATK is its own 15 s buff and outlives the
//   skill; the SP gain ends with it. A trigger that lands during the skill runs 夜的哑然 too, and its +sp SP is held
//   back (no SP during a timed skill — the sim's rule, tier1 `giveSp`), so S3's own trigger pays only the heal.
// - Auto-cast triggers: from the data, unoverridden — the rebuild of 2026-11-01 resolves S1 and S2 (AUTO, acting on
//   allies) to `SP_FULL` 「满技力即放」, the owner's AUTO rule of kits/README.md item 5 (引星棘刺 S1 alike), and S3 stays
//   DEFAULT. S2's 「期间技能变为自动开启」 window is the one trigger the kit overrides: it switches the **holder's** strategy
//   to `SP_FULL` for `buff_duration` s and puts back the rule it had (`unit.mem.tockaS2Window`).
//
// fx kinds emitted: buff {id, kind: 'trigger' | 'aspd'} · shield {id} · heal {id}.

import { num, talentBb, skillBbOf, up, giveSp, byEnemyAttack, alliesInGridOf } from '../shared/tier1.js';

const S1 = 'skchr_tocka_1';   // 一无所有之人 — AUTO, instant (the 屏障 + 晕眩 copy)
const S2 = 'skchr_tocka_2';   // 意欲呼啸之心 — AUTO, instant (the ASPD + auto-cast copy)
const S3 = 'skchr_tocka_3';   // 踽踽独行之春 — MANUAL, 20 s (the ATK / transfer / SP copy)

// 触发型效果 buff keys. Each carries the owner's unit id so two 冻河 of one shared field never overwrite each other.
const TKEY = (u) => `tocka:trigger#${u.id}`;
const SKEY = (u) => `tocka:trigger:shield#${u.id}`;
const PKEY = (u) => `tocka:trigger:aspd#${u.id}`;
const AKEY = (u) => `tocka:trigger:atk#${u.id}`;

/** SP ratio 技力比例: `sp / spCost`, capped to [0, 1] (a free skill counts as full). */
function spRatio(a) {
  const sk = a && a.skill;
  if (!sk || sk.noSkill) return 0;
  return sk.spCost > 0 ? Math.min(1, Math.max(0, sk.sp / sk.spCost)) : 1;
}

/** The deployed 干员 carrying `unit`'s 触发型效果, in deployment order (a summon never carries it: 「干员」). */
function holdersOf(battle, unit) {
  return battle.allyUnits
    .filter((a) => up(a) && a.kind === 'op' && !a.hidden && a.findBuff(TKEY(unit)))
    .sort((a, b) => a.deploySeq - b.deploySeq);
}

/**
 * 屏障 (ba.barrier) of `total` HP that decays to 0 over `dur` s: the capacity steps down once per second and what is left
 * of it scales with the capacity (砾 鼠群's rule — PRTS "屏障最大容量每秒更新一次；受到伤害后，剩余容量根据屏障最大容量等比变化";
 * S1 only says 「（在10秒内衰减）」).
 */
function addDecayShield(battle, unit, target, total, dur) {
  if (!(total > 0) || !(dur > 0)) return;
  let k = 0;
  battle.addBuff(target, {
    key: SKEY(unit), shield: total, duration: dur, interval: 1, visible: true, source: unit, tags: ['skill'],
    onTick: ({ unit: u, buff }) => {
      const prev = Math.max(0, dur - k) / dur;
      k++;
      const next = Math.max(0, dur - k) / dur;
      if (prev > 0 && buff.shield > 0) { buff.shield *= next / prev; u.markDirty(); }
    },
  });
}

/**
 * 雪的印痕's burn: `amount` 法术伤害 every second for `dur` s (「期间每秒受到攻击力80%的法术伤害」). Not owned by 冻河 — a
 * debuff already on the enemy outlives its source (the `makeZone` rule); it stops on its own after `dur` rounds.
 */
function burnPerSecond(battle, unit, target, amount, dur) {
  if (!(amount > 0) || !(dur > 0)) return;
  const total = Math.max(1, Math.round(dur));
  let n = 0;
  battle.every(1, (b, sched) => {
    if (target.alive) b.dealDamage(unit, target, { amount, type: 'arts', isSkill: true, canDodge: false, tags: ['dot', 't2'] });
    if (++n >= total) sched.cancel();
  });
}

export default {
  char_4244_tocka: (bb, chess) => {
    const t1 = talentBb(chess, 0);   // 夜的哑然 { sp, heal_scale }
    const t2 = talentBb(chess, 1);   // 雪的印痕 { attack@t2_buff_duration, attack@t2_magic_atk_scale, … }
    const b1 = skillBbOf(chess, S1), b2 = skillBbOf(chess, S2), b3 = skillBbOf(chess, S3);
    // 雪的印痕, read once: the same talent applies under every skill, so the numbers are not skill-specific.
    const t2Dur = Math.max(0, num(t2['attack@t2_buff_duration'], 8));
    const t2Radius = Math.max(0, num(t2['attack@projectile_range'], 1.5));
    const t2Scale = num(t2['attack@t2_magic_atk_scale'], 0.8);
    const t2Weaken = Math.abs(num(t2['attack@t2_atk'], 0.2));

    /** 夜的哑然: every trigger of one of her 触发型效果s gives +sp SP and one heal in her attack range. */
    const onTriggered = (battle, unit) => {
      if (!up(unit)) return;
      const sp = num(t1.sp);
      if (sp > 0) giveSp(unit, sp, 'talent');
      const heal = num(t1.heal_scale) * unit.s.atk;
      const ally = battle.lowestHpAllyInRange(unit);
      if (ally && heal > 0) {
        battle.heal(unit, ally, heal);
        battle.fx('heal', { x: ally.x, y: ally.y, id: unit.id });
      }
    };

    /** 一无所有之人's payload: the 屏障 and 晕眩 when a S1 holder is attacked. */
    const s1Fire = (battle, unit, holder, src) => {
      const total = num(b1.shield_atk_scale) * unit.s.atk;
      addDecayShield(battle, unit, holder, total, num(b1.shield_time, 10));
      const stun = num(b1.stun);
      if (stun > 0 && src && src.side === 'enemy' && src.alive) battle.applyStatus(src, 'stun', { duration: stun, source: unit });
      battle.fx('shield', { x: holder.x, y: holder.y, id: unit.id });
      onTriggered(battle, unit);
    };

    /**
     * 意欲呼啸之心's payload: the HOLDER's ASPD and — 「期间技能变为自动开启」 — the HOLDER's own skill auto-casting for
     * `buff_duration` s (its strategy is switched to SP_FULL and put back afterwards).
     *
     * The auto-cast window belongs to the ally carrying the 触发型效果, not to 冻河: the sentence's subject is the 干员 who
     * received it. Until 2026-11-01 the kit switched 冻河's own rule instead (she is SP_FULL from the data anyway) and the
     * owner reported 「2技能不能让别人自动开启使用技能没用」 — an ally holding the effect never cast anything by itself.
     */
    const s2Fire = (battle, unit, holder) => {
      const aspd = num(b2.attack_speed);
      const dur = Math.max(0, num(b2.buff_duration, 15));
      if (!(aspd > 0) || !(dur > 0)) return;
      battle.addBuff(holder, { key: PKEY(unit), duration: dur, mods: { aspd }, visible: true, source: unit, tags: ['skill'] });
      const sk = holder.skill;
      if (sk && !sk.noSkill) {
        const win = holder.mem.tockaS2Window;
        // re-arming keeps the rule the holder had BEFORE the first fire (never overwrite it with SP_FULL)
        if (!win) holder.mem.tockaS2Window = { prev: String(sk.rule ?? 'DEFAULT'), until: battle.time + dur };
        else win.until = battle.time + dur;
        sk.setTrigger('SP_FULL', null);
      }
      battle.fx('buff', { x: holder.x, y: holder.y, id: unit.id, kind: 'aspd' });
    };

    /**
     * 踽踽独行之春's payload — 「开启技能时**自身**和冻河攻击力+bonus_init_atk（在bonus_duration秒内衰减）」: the 自身 is the
     * 干员 who activated, so the decaying ATK lands on the holder and on her. Fired by the holder's own cast (「开启技能时」),
     * or straight away when her cast lands on an ally that already holds the copy (「已存在时改为将其触发」).
     */
    const s3Fire = (battle, unit, holder) => {
      addDecayAtk(battle, unit, unit);
      if (holder && holder !== unit) addDecayAtk(battle, holder, unit);
    };

    /** 「攻击力+bonus_init_atk（在bonus_duration秒内衰减）」 — linear to 0 at bonus_atk_dec_per_sec a second. */
    const addDecayAtk = (battle, target, owner) => {
      const init = num(b3.bonus_init_atk), dec = num(b3.bonus_atk_dec_per_sec), dur = Math.max(0, num(b3.bonus_duration, 15));
      if (!(init > 0) || !(dur > 0)) return;
      battle.addBuff(target, {
        key: AKEY(owner), duration: dur, mods: { atkPct: init }, visible: true, source: owner, tags: ['skill'],
        onTick: ({ unit: u, buff }) => {
          const elapsed = dur - Math.max(0, buff.timeLeft);
          buff.mods = { atkPct: Math.max(0, init - dec * elapsed) };
          u.markDirty();
        },
      });
    };

    /** 「冻河攻击范围内技力比例最高的另一名干员」 — a 干员, never 冻河 herself ("另一名"). */
    const spPick = (battle, unit) => alliesInGridOf(battle, unit)
      .filter((a) => a !== unit && a.kind === 'op')
      .sort((a, b) => spRatio(b) - spRatio(a) || a.deploySeq - b.deploySeq)[0] ?? null;

    /** 施加 the 触发型效果 to `ally` (S1, S2, S3): it 施加s ⇒ 雪的印痕 arms her next normal attack. */
    const applyTrigger = (battle, unit, ally, kind) => {
      if (!ally || !up(ally) || ally.kind !== 'op' || ally.findBuff(TKEY(unit))) return false;
      battle.addBuff(ally, { key: TKEY(unit), source: unit, visible: true, data: { ownerId: unit.id, kind } });
      // 「施加…后的下次普通攻击」: the attack of this very tick does not count — the official cast takes its 前后摇
      // before the operator attacks again, while the sim has no cast animation and casts at the attack's own moment
      unit.mem.t2Primed = true;
      unit.mem.t2At = battle.time;
      battle.fx('buff', { x: ally.x, y: ally.y, id: unit.id, kind: 'trigger' });
      return true;
    };

    return {
      skills: {
        // -----------------------------------------------------------------------------------------------------------
        // S1 一无所有之人 — 施加 to up to max_target allies in range that do not hold it yet.
        [S1]: {
          kind: 'instant',
          onStart({ battle, unit }) {
            const n = Math.max(1, Math.round(num(b1.max_target, 1)));
            const cands = alliesInGridOf(battle, unit)
              .filter((a) => a.kind === 'op' && !a.findBuff(TKEY(unit)))
              .sort((a, b) => a.hpRatio - b.hpRatio || a.deploySeq - b.deploySeq);
            let k = 0;
            for (const a of cands) {
              if (k >= n) break;
              if (applyTrigger(battle, unit, a, 'S1')) k++;
            }
          },
        },
        // -----------------------------------------------------------------------------------------------------------
        // S2 意欲呼啸之心 — 施加 to max_target allies anywhere on the field that do not hold it yet.
        [S2]: {
          kind: 'instant',
          onStart({ battle, unit }) {
            const n = Math.max(1, Math.round(num(b2.max_target, 1)));
            const cands = battle.alliesFor(unit)
              .filter((a) => a.kind === 'op' && !a.findBuff(TKEY(unit)))
              .sort((a, b) => a.hpRatio - b.hpRatio || a.deploySeq - b.deploySeq);
            let k = 0;
            for (const a of cands) {
              if (k >= n) break;
              if (applyTrigger(battle, unit, a, 'S2')) k++;
            }
          },
        },
        // -----------------------------------------------------------------------------------------------------------
        // S3 踽踽独行之春 — ASPD, a 4-target physical attack with 晕眩, then 施加 / 触发 + 转移 + the decaying ATK.
        [S3]: {
          kind: 'duration',
          mods: { aspd: num(b3.attack_speed) },
          targeting: { maxTargets: Math.max(1, Math.round(num(b3['attack@max_target'], 1))) },
          attack: {
            atkScale: num(b3['attack@atk_scale'], 1),
            onHit({ battle, unit, target }) {
              const stun = num(b3['attack@stun']);
              if (target && target.alive && stun > 0) battle.applyStatus(target, 'stun', { duration: stun, source: unit });
            },
          },
          onStart({ battle, unit }) {
            // 「立刻对范围内另一名干员施加触发型效果（已存在时改为将其触发）：…并将该触发型效果转移给…技力比例最高的另一名干员」
            const pick = spPick(battle, unit);
            const fired = !!(pick && pick.findBuff(TKEY(unit)));
            if (pick) {
              for (const h of holdersOf(battle, unit)) if (h !== pick) battle.removeBuff(h, TKEY(unit));
              if (!fired) applyTrigger(battle, unit, pick, 'S3');
            }
            // 「已存在时改为将其触发」: her cast landed on an ally that already held the copy — fire its payload now.
            // The payload's own trigger is 「开启技能时」 (the HOLDER's cast, hooked below), never her own cast.
            if (fired && pick) s3Fire(battle, unit, pick);
            if (fired) onTriggered(battle, unit);
          },
        },
      },

      // No `talents` entries: 夜的哑然 lives inside every payload (`onTriggered`) and 雪的印痕 arms in `applyTrigger`
      // and fires in the hooks below — one implementation each, whatever skill the slot picked.

      install(battle, unit) {
        // ---- 触发型效果: the triggers (every kind's payload is chosen by the copy the holder carries) ---------------
        // S1: 「受到攻击时」 — an enemy damage instance lands on a holder of a S1 copy (tier1 byEnemyAttack: the official
        // ON_TAKE_DAMAGE counters fire on any enemy damage, never on a 流失 / 无来源 / another counter).
        battle.on('damaged', (ctx) => {
          if (!up(unit)) return;
          const holder = ctx.target;
          if (!holder || holder.side !== 'ally' || !byEnemyAttack(ctx)) return;
          const held = holder.findBuff(TKEY(unit));
          if (!held || held.data.kind !== 'S1') return;
          s1Fire(battle, unit, holder, ctx.source);
        }, { owner: unit });

        // S2 「技能可开启时」: every tick, a holder's own skill turning castable is the trigger. The holder's skill is the
        // subject (「对该干员施加…技能可开启时…期间技能变为自动开启」), so the edge is watched on the holder, never on 冻河.
        // S3 「开启技能时」: a holder of a S3 copy activating ANY skill fires the payload (the decaying ATK on itself and
        // on her). Until 2026-11-01 the ATK was granted at 冻河's own cast instead, which is not what 「开启技能时」 says
        // (owner's request of 2026-11-01, the same subject mistake as S2).
        battle.on('skillStart', (ctx) => {
          if (!up(unit)) return;
          const h = ctx.unit;
          if (!h || h === unit || h.side !== 'ally' || !h.alive) return;
          const held = h.findBuff(TKEY(unit));
          if (!held || held.data.kind !== 'S3') return;
          s3Fire(battle, unit, h);
          onTriggered(battle, unit);
        }, { owner: unit });

        battle.on('tick', (ctx) => {
          if (!up(unit)) return;
          const list = holdersOf(battle, unit);
          for (const h of list) {
            const held = h.findBuff(TKEY(unit));
            if (!held || held.data.kind !== 'S2') { h.mem.tockaS2Ready = false; continue; }
            const hs = h.skill;
            const ready = !!(hs && !hs.noSkill && hs.ready && !(hs.active && hs.isTimed) && h.canAct && !h.s.flags.silence);
            if (ready && h.mem.tockaS2Ready !== true) {
              s2Fire(battle, unit, h);
              onTriggered(battle, unit);
            }
            h.mem.tockaS2Ready = ready;
          }
          // 「期间技能变为自动开启」 lapses: the holder's skill goes back to the strategy it had
          for (const a of battle.alliesFor(unit)) {
            const win = a.mem.tockaS2Window;
            if (!win || battle.time < win.until - 1e-9) continue;
            a.mem.tockaS2Window = null;
            if (a.skill && !a.skill.noSkill && a.skill.rule === 'SP_FULL') a.skill.setTrigger(win.prev, null);
          }
          if (!unit.skill || unit.skill.noSkill) return;
          const sk = unit.skill;
          // 踽踽独行之春: 「冻河技能期间拥有该效果的干员每秒获得bonus_sp点技力」
          if (sk.active && sk.id === S3) {
            const per = num(b3.bonus_sp);
            unit.mem.s3Acc = (unit.mem.s3Acc ?? 0) + ctx.dt;
            while (per > 0 && unit.mem.s3Acc >= 1 - 1e-9) {
              unit.mem.s3Acc -= 1;
              for (const h of holdersOf(battle, unit)) giveSp(h, per, 'talent');
            }
          } else unit.mem.s3Acc = 0;
        }, { owner: unit });

        // ---- 雪的印痕: 施加 ⇒ the next NORMAL attack is an area attack with 虚弱 + an arts burn ---------------------
        battle.on('beforeAttack', (ctx) => {
          if (ctx.attacker !== unit || ctx.isSkill || !unit.mem.t2Primed) return;
          if (unit.mem.t2At != null && battle.time <= unit.mem.t2At + 1e-9) return;   // the cast's own tick is not "the next attack"
          const list = (ctx.targets || []).filter((t) => t && t.side === 'enemy');
          if (!list.length) return;
          const main = list[0];
          const extra = battle.foesInRadius(main.x, main.y, t2Radius, true).filter((e) => !list.includes(e));
          if (extra.length) ctx.targets = (ctx.targets || []).concat(extra);
          unit.mem.t2Attack = { atk: unit.s.atk };
        }, { owner: unit, priority: -100 });
        battle.on('attack', (ctx) => {
          if (ctx.attacker !== unit || ctx.isSkill) return;
          const armed = unit.mem.t2Attack;
          if (!armed) return;
          unit.mem.t2Attack = null;
          unit.mem.t2Primed = false;
          for (const t of ctx.targets || []) {
            if (!t || t.side !== 'enemy' || !t.alive) continue;
            if (t2Weaken > 0) battle.applyStatus(t, 'weaken', { duration: t2Dur, value: t2Weaken, source: unit });
            burnPerSecond(battle, unit, t, armed.atk * t2Scale, t2Dur);
          }
        }, { owner: unit });
      },
    };
  },
};
