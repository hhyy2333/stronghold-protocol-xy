// server/sim/content/kits/ops/chess_char_3_22-yana.js — 娅娜 (char_9002_yana) kit: 6★ 炮手 (狙击 · aoesniper, ranged
// physical splash, 精准), a FIXED (固定) operator — an ordinary roster chess of the shared shop pool, not a 自选 slot.
// The kit contract and the fidelity checklist: ../README.md; the skill API: docs/SIM.md §7.
//
// Declared in tools/custom-ops.mjs (FIXED_CHESS): an ORIGINAL operator, so nothing here claims an official source. The
// forms (data/chess.json chess_char_3_22_a / _b): normal = E2 Lv1 (skills at rank 4), elite = E2 Lv60 (rank 7); the
// operator ships no module. Full potential (the owner's decision of 2026-10-07): 部署费用-1, 攻击力+25, 生命上限+150,
// 攻击力+25, 部署费用-1 → cost 24, ATK +50, HP +150 on top of the attributes keyframes.
//
// Fidelity checklist, item by item:
//  1. skills — all three authored, both ranks: S1 激光, S2 瞄准射击, S3 三连射 (`skills`, keyed by skillId).
//  2. talents — T1 灼痕 (a `damaged` rider, one per skill damage INSTANCE), T2 随意开火 (a special bullet every N attacks),
//     at full potential.
//  3. traits — 炮手 "攻击造成群体物理伤害": the profession default (SNIPER + aoesniper splashRadius 1.1). The 特质
//     (休整期结束时自身所属盟约+4) is PURE DATA (tools/custom-ops.mjs FIXED_GARRISONS / garrison_161_a|b) — no kit code.
//  4. attack range — 3-10 (15 tiles, 对空) from the data; S1's own line replaces it while it runs; S2/S3 keep it.
//  5. auto-cast trigger — the data's (AUTO S1 keeps DEFAULT; the two MANUAL skills' data rows resolve to DEFAULT here,
//     which is the basic strategy: ready + about to attack).
//  6. targeting — `canHitFly: true` (the data); S1 is a line, so it hits every enemy on it (`allInRange`).
//  7. damage typing — physical throughout (the data's dmgType); S1 adds a 灼燃损伤 gauge fill (`type: 'element'`, not HP).
//  8. summons — none.
//  9. statuses — none of its own: T1 deals true damage, S1 fills the 灼燃 gauge (the burst is the element system's).
// 10. tests — test/content/chess_char_3_22-yana.test.js.
// 11. 生命回复速度 — not involved.
//
// Mechanics that need a note:
//  - T1 灼痕 "技能造成伤害时附加一次 100 % 攻击力的真实伤害": one rider per damage INSTANCE the skill deals — S1's line fires
//    it once per enemy struck, S2's 9-hit burst nine times on its locked target, and each of S3's 3-hit bursts three times.
//    It rides the `damaged` hook, NOT `attack.onEachHit`: the engine calls `onEachHit` once per VICTIM
//    (server/sim/ai.js resolveHit runs its `hits` loop for the damage, then calls `each` a single time — docs/SIM.md §7.3
//    "per victim"), so a multi-hit burst fired the rider only once (owner's report of 2026-10-10). The instance's own
//    flags separate the three kinds of damage in that hook: the skill's instances carry `isAttack: true`, the rider itself
//    `isAttack: false` (so it never rides itself), and S1's 灼燃损伤 gauge fill is `type: 'element'` (损伤, not 伤害 — its
//    burst belongs to the element system).
//  - T2 随意开火 "每 3 次攻击后，额外射出一枚特殊子弹，随机造成以下四种效果之一，并回复 1 点技力" (the owner's
//    redefinition of 2026-10-10, replacing 追猎's 2-hit combo). The decisions taken with the owner:
//      * the bullet flies at the target THE ATTACK STRUCK (not a random enemy in range) — "额外射出一枚" reads as a second
//        shot at what she just shot at;
//      * the counter is GLOBAL over her own attacks — normal and skill attacks alike (the owner's choice), so an S3 of
//        10 bullets fires roughly three special bullets. It is deliberately NOT the old per-enemy tally;
//      * the 2-hit combo is gone: her normal attack stays a single instance.
//    The four effects read their numbers from the talent's blackboard; the roll is `battle.rng.int`, so a given seed always
//    produces the same sequence (determinism, AGENTS.md). Each effect keeps the 炮手 splash so it stays 群体物理, except
//    the stun one, which is 法术伤害 as the text says. [ASSUMED] the 「爆炸范围扩大至 1.5 倍」 belongs to the FIRST effect
//    only (the text lists it there); the other three use the normal 炮手 radius.
//    Damage is emitted `isAttack: false` (talent damage, not an attack) so it neither re-enters this counter nor triggers
//    T1 (which rides skill instances), and it is not an attack for 受击回复 / 'attack'-driven content.

import { num, talentBb, skillRec, up } from '@kit/tier1.js';
import { hasHp } from '@sim/damage.js';
import { PROJECTILE_SPEEDS } from '@sim/constants.js';

const S1 = 'skchr_yana_1';
const S2 = 'skchr_yana_2';
const S3 = 'skchr_yana_3';

/** The four effects of 随意开火 (T2), in the order the talent text lists them. `battle.rng.int(4)` picks one. */
const FIRE_MODES = Object.freeze(['blast', 'pierce', 'burn', 'stun']);

/** The blackboard of one of her skills (a fixed chess has a default skill, but the kit serves all three). */
const bbOf = (chess, id) => skillRec(chess, id)?.bb ?? {};

// 工坊 kit 的契约（shared/workshop.js KIT_NO_DEFAULT_EXPORT）：模块 default-export 的**就是**那个工厂函数
// `(bb, chess, def) => Kit`。核心注册表那边是 `export default { <baseChessId>: (bb, chess, def) => Kit }`，
// 所以这里把外面那层键去掉，函数体一个字没改。
export default (bb, chess, def) => {
    const t1 = talentBb(chess, 0);   // 灼痕 (the true-damage rider)
    const t2 = talentBb(chess, 1);   // 随意开火 (the special bullet)
    const s1 = skillRec(chess, S1);
    const b1 = bbOf(chess, S1), b2 = bbOf(chess, S2), b3 = bbOf(chess, S3);
    const trueScale = num(t1.true_scale, 1);
    // 随意开火 (T2, the owner's redefinition of 2026-10-10): every `interval` attacks fire one extra special bullet that
    // randomly applies one of four effects and restores `sp` SP.
    const fireEvery = Math.max(1, Math.floor(num(t2.interval, 3)));
    const fireSp = Math.max(0, num(t2.sp, 1));
    const fire = {
      blast: { scale: num(t2.blast_scale, 3), radiusMul: num(t2.blast_radius_mul, 1.5) },
      pierce: { scale: num(t2.pierce_scale, 2), defIgnorePct: num(t2.pierce_def, 0.5) },
      burn: { scale: num(t2.burn_scale, 1.5), element: num(t2.burn_element, 1) },
      stun: { scale: num(t2.stun_scale, 1), duration: num(t2.stun, 1.5) },
    };
    /** The bullet's own splash radius: the 炮手 splash (1.1), ×1.5 for the 爆炸范围扩大 mode. */
    const baseSplash = num(chess?.splashRadius, 0) > 0 ? num(chess.splashRadius) : 1.1;

    /**
     * The 灼痕 rider, installed as a `damaged` hook: ONE true-damage instance per skill damage INSTANCE (S2's 9-hit burst
     * fires it nine times, each of S3's 3-hit bursts three times, S1's line once per enemy struck). `attack.onEachHit`
     * cannot do this — the engine calls it once per victim (see the header note). The gates:
     *  - `source === unit` and `up(unit)`: her own damage, while she is alive and deployed. This also drops an element
     *    burst's damage: a burst is emitted 无来源 (`sourceless`, damage.js header), so its `source` hook is null;
     *  - `isAttack && isSkill`: the skill's own attack instances. The rider is emitted with `isAttack: false`, so it never
     *    rides itself (which would recurse until the hook-depth limit);
     *  - not `type: 'element'`: that is a 损伤 gauge fill (S1's 灼燃损伤), not 伤害 — the talent says 造成伤害时. Elemental
     *    (元素伤害, `type: 'elemental'`) IS HP damage and does ride;
     *  - `hasHp`: a lethal instance's rider is skipped (damage.js header — the target is alive at 0 HP until `kill`).
     */
    const installScorch = (battle, unit) => {
      if (!(trueScale > 0)) return;
      battle.on('damaged', (ctx) => {
        const dmg = ctx.dmg;
        if (ctx.source !== unit || !up(unit) || !dmg) return;
        if (!dmg.isAttack || !dmg.isSkill) return;
        if (dmg.type === 'element') return;
        if (!hasHp(ctx.target)) return;
        battle.dealDamage(unit, ctx.target, {
          amount: unit.s.atk * trueScale, type: 'true', isAttack: false, isSkill: true,
          tags: ['talent', 'yana:scorch'],
        });
      }, { owner: unit });
    };

    // S1 is her default skill, so it is also exposed as `skill` (the kit contract: `skills[id]` for the selected skill,
    // `skill` for the default one — server/sim/content/index.js selectSkillSpec / skillSpecSource)
    const skill = {
      // S1 激光 (AUTO): every enemy on a straight line of 6 tiles in front (`atk_scale` × ATK physical) plus a
      // 灼燃损伤 gauge fill (`burn_scale` × ATK). The line is the skill's own `rangeGrid` (5-1) and hits everything
      // on it (`allInRange`), so no target is picked and no splash is applied.
      kind: 'instant',
      targeting: {
        ...(s1?.rangeGrid?.length ? { rangeGrid: s1.rangeGrid } : {}),
        allInRange: true,
      },
      attack: {
        atkScale: num(b1.atk_scale, 1),
        splashRadius: 0,   // the line IS the area: no extra splash around each victim [ASSUMED]
        // the gauge fill is genuinely per VICTIM (every enemy the line strikes gets its own fill), so `onEachHit` is the
        // right channel for it — unlike the 灼痕 rider, which is per instance (the talent's `damaged` hook)
        onEachHit({ battle, unit, target }) {
          const burn = num(b1.burn_scale);
          if (burn > 0 && target && target.alive) {
            battle.dealDamage(unit, target, {
              amount: unit.s.atk * burn, type: 'element', element: 'burn',
              canDodge: false, tags: ['skill', 'yana:laser'],
            });
          }
        },
      },
    };

    return {
      skill,
      // `skills` holds the ALTERNATE skills only (the default lives on `skill`): server/sim/content/index.js
      // selectSkillSpec picks `skills[<selected id>]` first and falls back to `skill`
      skills: {
        // S2 瞄准射击 (MANUAL, 可充能 2 次): lock one enemy and land `times` small hits, each `atk_scale` × ATK.
        // `attack.hits` makes one attack deal the whole burst; the charge system is the data's `maxChargeTime: 2`.
        // 灼痕 rides each instance through the talent's `damaged` hook (not `onEachHit` — see the header note).
        [S2]: {
          kind: 'charges',
          charges: 2,
          attack: {
            atkScale: num(b2.atk_scale, 1),
            hits: Math.max(1, Math.floor(num(b2.times, 1))),
          },
        },
        // S3 三连射 (MANUAL, 10 发弹药): 攻击力 +30 % (bb `atk`), every attack is a 3-hit burst and the interval grows a
        // little (+0.4 s). Ten bullets = ten ATTACKS (the owner's decision of 2026-10-09), each dealing 3 instances.
        [S3]: {
          kind: 'ammo',
          ammo: Math.max(1, Math.floor(num(b3.ammo, 10))),
          // `atkPct` is the engine's ×(1+x) attack buff, the same shape an official 「攻击力+N%」 skill uses
          // (e.g. chess_char_1_05-vigna.js: `mods: { atkPct: num(bb.atk) }`)
          mods: {
            atkPct: num(b3.atk),
            batPct: num(b3.base_attack_time) / (num(chess?.stats?.bat, 1) || 1),
          },
          attack: {
            atkScale: num(b3['attack@atk_scale'], 1),
            hits: Math.max(1, Math.floor(num(b3['attack@times'], 1))),
          },
        },
      },
      talents: [
        { install: installScorch },   // 灼痕: one rider per skill damage instance
        { install(battle, unit) {
          // T2 随意开火 (the owner's redefinition of 2026-10-10, replacing the old 2-hit 追猎 combo): every `fireEvery`
          // attacks she makes — normal AND skill attacks, counted globally (the owner's decision) — she fires one extra
          // special bullet at the target that attack struck. The bullet randomly applies ONE of four effects (the roll
          // is `battle.rng.int`, so it is deterministic per seed) and restores `fireSp` SP.
          //
          // The bullet is a real projectile (`addProjectile`, visual 'bomb') so the client draws it and its damage lands
          // on arrival — "额外射出一枚特殊子弹". Its damage is talent damage, NOT an attack: `isAttack: false` keeps it
          // out of the 'attack'-driven content (and out of T1 灼痕, which rides SKILL instances only), and it cannot
          // re-enter this counter (which reads the `attack` hook, not damage).
          const bullet = (target) => {
            const mode = FIRE_MODES[battle.rng.int(FIRE_MODES.length)];
            battle.addProjectile({
              from: unit, target, speed: PROJECTILE_SPEEDS.bomb, visual: 'bomb', source: unit, hitDead: true,
              onHit: ({ target: t, x, y }) => {
                if (!up(unit)) return;
                const cx = t && t.alive ? t.x : x, cy = t && t.alive ? t.y : y;
                // every effect keeps the 炮手 splash (her attacks are 群体物理); the 爆炸范围 mode enlarges it ×1.5.
                // [ASSUMED] the talent text attaches 爆炸范围扩大 to the first effect only, so the other three use the
                // normal 炮手 radius.
                const f = fire[mode];
                const radius = baseSplash * (mode === 'blast' ? f.radiusMul : 1);
                const dmg = { isAttack: false, isSkill: false, tags: ['talent', 'yana:fire', `yana:fire:${mode}`] };
                const hitOne = (e) => {
                  if (!e || !e.alive || !hasHp(e)) return;
                  if (mode === 'stun') {
                    // 法术伤害 + 眩晕 (「使命中目标眩晕」: every enemy the bullet hits, main and splash alike)
                    battle.dealDamage(unit, e, { amount: unit.s.atk * f.scale, type: 'arts', ...dmg });
                    if (f.duration > 0 && e.alive) battle.applyStatus(e, 'stun', { duration: f.duration, source: unit });
                  } else if (mode === 'pierce') {
                    battle.dealDamage(unit, e, { amount: unit.s.atk * f.scale, type: 'phys', defIgnorePct: f.defIgnorePct, ...dmg });
                  } else if (mode === 'burn') {
                    battle.dealDamage(unit, e, { amount: unit.s.atk * f.scale, type: 'phys', ...dmg });
                    // 灼燃损伤 is a gauge fill (`type: 'element'`), not HP damage — the same shape S1 uses. It is its own
                    // instance, so it carries `yana:burn` WITHOUT `yana:fire`: the latter marks exactly one bullet hit.
                    if (f.element > 0 && e.alive) {
                      battle.dealDamage(unit, e, { amount: unit.s.atk * f.element, type: 'element', element: 'burn', canDodge: false, tags: ['talent', 'yana:burn'] });
                    }
                  } else {
                    battle.dealDamage(unit, e, { amount: unit.s.atk * f.scale, type: 'phys', ...dmg });
                  }
                };
                hitOne(t && t.alive ? t : null);
                for (const e of battle.foesInRadius(cx, cy, radius, true)) if (e !== t) hitOne(e);
                battle.fx('aoe', { x: cx, y: cy, radius, id: unit.id, skill: `yana:fire:${mode}` });
              },
            });
            if (fireSp > 0) unit.skill?.gainSp(fireSp, 'talent');
          };
          let fired = 0;   // her own attacks since the battle began (global, never per enemy)
          battle.on('attack', (ctx) => {
            if (ctx.attacker !== unit || !up(unit)) return;
            const main = (ctx.targets || []).find((t) => t && t.alive && t.side === 'enemy');
            if (!main) return;
            fired++;
            if (fired % fireEvery === 0) bullet(main);
          }, { owner: unit, priority: -10 });
        } },
      ],
    };
};
