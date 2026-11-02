// server/sim/content/kits/ops/op-dminon.js — 国度 (char_4246_dminon) 自选 operator kit: 6★ 伏击客 (特种), an owned-6★ pick of
// the tier-5 and tier-6 自选 slots; all three skills and both talents at every form. **No module**: v79's character_table
// has no `charEquip` entry for her (the owner's decision of 2026-11-01 — the three v79 operators ship without modules).
// Kit contract and the 自选 rules: ../README.md ("How to add an operator (自选)").
//
// Forms (data/backups.json units.char_4246_dminon, the DIY slot statuses): normal = E2 Lv1, skills at rank 4; elite = E2
// Lv60, rank 7 — the two tiers share one record because she has no module. Full potential (the owner's decision of
// 2026-10-07). Sources: character_table / skill_table (zh_CN, the v79 rows injected by tools/extra-operators.mjs and built
// into backups.json), the v79 dossier 参考/干员数值_塔露拉_冻河_国度_v79.md, PRTS 卫戍协议 分支特性信息 伏击客 and 国度.
// - Trait (伏击客) "对攻击范围内所有敌人造成伤害；拥有50%的物理和法术闪避且不容易成为敌人的攻击目标": the stalker profile — every
//   enemy of her range at once (`allInRange`), melee, ground only, physical — and 50 % physical / arts dodge (trait bb
//   `prob`). "不容易成为敌人的攻击目标" is her taunt level −1, which her data stats already carry, so the kit's trait
//   installs the dodge WITHOUT the profile's own extra −1 (professions.js `installStalker` adds one on top of the data's —
//   the double count 阿斯卡纶's kit also avoids, op-ascln.js).
// - 「国度」 (all of it, the field this kit is built around) = the tiles of her CURRENT attack range — the skill's range
//   swaps in while S2 (`y-3`) / S3 (`y-10`) run — plus the tiles S3 spreads (S3's onEnd resets them: "技能结束后，重置场上
//   的国度状态"). A tile counts while an enemy's collider overlaps it (bodyInKeys, the same test her attacks use).
// - T1 实质坍缩 "自身攻击范围内弥漫“国度”，处于“国度”内的地面敌人攻击速度-15，每秒受到攻击力13%的法术伤害"
//   (bb attack_speed / atk_scale): once a second every living ground enemy inside 「国度」 — stealthed / untargetable ones
//   included (a field, not a hit: PRTS's 格子判定 wording) — gets an ASPD debuff (refreshed every pulse) and takes
//   atk_scale × her current ATK arts, not dodgeable ([ASSUMED] 每秒 = one pulse a second, the first one 1 s after she is
//   deployed and after any range change; the official tick phase is not in the data).
// - T2 此身为界 "自身撤退时，对“国度”内的所有地面敌人造成相当于攻击力600%（+100%）的法术伤害和5秒晕眩，随后所有“国度”消失"
//   (bb atk_scale / stun; full potential): on her RETREAT only (a death by an enemy does not trigger it) every ground
//   enemy inside 国度 takes atk_scale × ATK arts and is 晕眩 stun s; the spread tiles are dropped.
// - S1 停步 (MANUAL, 20 s): ASPD +attack_speed. "每个敌人首次踏上“国度”时会停顿sluggish秒": while it runs, the first time an
//   enemy is found inside 国度 it gets 停顿 `sluggish` s — once per enemy per cast ([ASSUMED]: the check runs on the tick,
//   so an enemy that walks in is caught at the next tick).
// - S2 受戮 (MANUAL, 20 s, its own range `y-3`): ATK +atk; "使“国度”上的敌人无法闪避物理和法术攻击" — a `hit` handler clears
//   `dmg.canDodge` for her physical / arts damage on an enemy inside 国度 (the dodge roll happens after `hit`, damage.js).
//   "第二次及以后使用时额外使攻击速度+30，且持续时间无限": from the second cast on, +attack_speed ASPD and `timeLeft` is
//   Infinity until she leaves the field (the `skill.timeLeft = Infinity` idiom of op-headb2.js).
// - S3 无人的国度 (MANUAL, 36 s, its own range `y-10`): ATK +atk, ASPD +attack_speed, and — being a 伏击客 — every enemy of
//   the (now `y-10`) range is struck at once, i.e. every enemy on 国度 of the skill's range. "“国度”上的单位被地面敌人攻击时，
//   在伤害来源周围四格扩散“国度”，并造成相当于攻击力80%的物理伤害（每0.5秒最多触发1次）" (bb attack@aoe_atk_scale /
//   attack@cd): when a GROUND enemy damages one of our units standing on 国度, the four tiles around the ATTACKER become
//   国度 (passable ground only) and every ground enemy on the newly spread tiles takes aoe_atk_scale × ATK physical, at
//   most once per attack@cd s. [ASSUMED] the damage hits the enemies standing on the spread tiles (the text names no
//   victim); [ASSUMED] enemies standing ONLY on spread tiles outside the skill's range are not attacked by her normal
//   attack — the skill's range decides that (the field only feeds T1 / S1 / S2).
//
// Imports are relative only (the sim is served to the browser as-is); no wall-clock and no random-number API: the
// periodic work rides
// `battle.every` / `battle.on('tick')`, everything random-free.
import { num, talentBb, traitBb, skillRec, up } from '../shared/tier1.js';
import { bodyInKeys } from '../../../body.js';
import { tileKeyOf } from '../../../targeting.js';
import { COLS } from '../../../constants.js';

const S1 = 'skchr_dminon_1';
const S2 = 'skchr_dminon_2';
const S3 = 'skchr_dminon_3';
/** T1's pulse period ("每秒受到…"): one second. */
const GUO_IV = 1;
/** The ASPD debuff T1 keeps on the enemies inside 国度 (replaced every pulse; slightly longer than the period). */
const GUO_DEBUFF = 'talent:dminon:guo';
/** S2's extra ASPD buff, from the second cast on. */
const S2_ASPD = 'skill:dminon:s2aspd';
/** The four tiles around a point (the spread offsets of S3). */
const N4 = Object.freeze([[1, 0], [-1, 0], [0, 1], [0, -1]]);
/** Table tag of T1's damage ticks (法术持续伤害). */
export const GUO_TAG = 'dminon:guo';

const bbOf = (chess, id) => skillRec(chess, id)?.bb ?? {};
const tilesOf = (keys) => [...keys].map((k) => [Math.floor(k / COLS), k % COLS]);

export default {
  char_4246_dminon: (bb, chess) => {
    const t0 = talentBb(chess, 0), t1 = talentBb(chess, 1);
    const b1 = bbOf(chess, S1), b2 = bbOf(chess, S2), b3 = bbOf(chess, S3);
    const s2 = skillRec(chess, S2), s3 = skillRec(chess, S3);
    const dodge = num(traitBb(chess).prob, 0.5);
    const s2On = (u) => !!(u.skill && u.skill.active && u.skill.id === S2);
    const s3On = (u) => !!(u.skill && u.skill.active && u.skill.id === S3);

    /** The tiles 「国度」 covers right now: her current range plus the tiles S3 spread (null after a reset). */
    const guoKeys = (unit) => {
      const out = new Set(unit.rangeKeySet || unit.rangeKeys || []);
      const extra = unit.mem.dminonSpread;
      if (extra) for (const k of extra) out.add(k);
      return out;
    };
    const inGuo = (unit, e) => bodyInKeys(e, guoKeys(unit));
    const showGuo = (battle, unit, keys, dur) => {
      if (!keys.size) return;
      battle.fx('field', { x: unit.x, y: unit.y, tiles: tilesOf(keys), dur, id: unit.id, skill: 'dminon:guo' });
    };

    /** T1: one pulse — the ASPD debuff and atk_scale × ATK arts on every ground enemy inside 国度. */
    const guoPulse = (battle, unit) => {
      if (!up(unit) || unit.hidden) return;
      const keys = guoKeys(unit);
      const aspd = num(t0.attack_speed), ratio = num(t0.atk_scale);
      for (const e of battle.enemies) {
        if (!e.alive || e.hidden || e.isFlying || !e.deployed) continue;
        if (!bodyInKeys(e, keys)) continue;
        if (aspd) battle.addBuff(e, { key: GUO_DEBUFF, duration: GUO_IV + 0.2, mods: { aspd }, source: unit, tags: ['talent'] });
        if (ratio > 0) battle.dealDamage(unit, e, { amount: unit.s.atk * ratio, type: 'arts', canDodge: false, tags: ['talent', 'dot', GUO_TAG] });
      }
    };

    /** T2: the retreat burst — every ground enemy inside 国度 takes atk_scale × ATK arts and 晕眩 stun s. */
    const retreatBurst = (battle, unit) => {
      const keys = guoKeys(unit);
      const scale = num(t1.atk_scale), stun = num(t1.stun);
      const atk = unit.s.atk;
      for (const e of battle.enemies) {
        if (!e.alive || e.hidden || e.isFlying || !e.deployed || !bodyInKeys(e, keys)) continue;
        if (scale > 0) battle.dealDamage(unit, e, { amount: atk * scale, type: 'arts', isSkill: true, tags: ['talent', 'dminon:retreat'] });
        if (stun > 0 && e.alive) battle.applyStatus(e, 'stun', { duration: stun, source: unit });
      }
      unit.mem.dminonSpread = null;
    };

    /** S3: spread 国度 from a ground attacker and hit the enemies on the newly spread tiles (at most once per attack@cd). */
    const spread = (battle, unit, foe) => {
      const cd = Math.max(0, num(b3['attack@cd'], 0.5));
      if (battle.time - (unit.mem.dminonSpreadAt ?? -1e9) < cd - 1e-9) return;
      unit.mem.dminonSpreadAt = battle.time;
      const keys = unit.mem.dminonSpread || (unit.mem.dminonSpread = new Set());
      const added = new Set();
      for (const [dr, dc] of N4) {
        const r = foe.tileR + dr, c = foe.tileC + dc;
        if (!battle.grid.groundPassable(r, c)) continue;
        const k = r * COLS + c;
        if (keys.has(k) || added.has(k)) continue;
        added.add(k);
      }
      if (!added.size) return;
      for (const k of added) keys.add(k);
      showGuo(battle, unit, added, 1.5);
      const scale = num(b3['attack@aoe_atk_scale']);
      if (!(scale > 0)) return;
      const amount = unit.s.atk * scale;
      for (const e of battle.enemies) {
        if (!e.alive || e.hidden || e.isFlying || !e.deployed || !bodyInKeys(e, added)) continue;
        battle.dealDamage(unit, e, { amount, type: 'phys', isSkill: true, tags: ['skill', 'dminon:spread'] });
      }
    };

    return {
      trait: {
        // 伏击客: the 50 % dodge of the trait bb; the taunt level −1 is already in her stats (no second −1)
        install(battle, unit) {
          const p = num(unit.profile?.dodge, dodge);
          if (p > 0) battle.addBuff(unit, { key: 'trait:stalker', mods: { dodgePhys: p, dodgeArts: p }, persist: true, allowDead: true });
        },
      },
      skills: {
        [S1]: {
          kind: 'duration',
          mods: { aspd: num(b1.attack_speed) },
          onStart({ unit }) { unit.mem.dminonStopped = new Set(); },
          onTick({ battle, unit }) {
            const seen = unit.mem.dminonStopped || (unit.mem.dminonStopped = new Set());
            const dur = num(b1.sluggish);
            if (!(dur > 0)) return;
            const keys = guoKeys(unit);
            for (const e of battle.enemies) {
              if (!e.alive || e.hidden || e.isFlying || !e.deployed) continue;
              if (seen.has(e.id) || !bodyInKeys(e, keys)) continue;
              seen.add(e.id);
              battle.applyStatus(e, 'sluggish', { duration: dur, source: unit });
            }
          },
          onEnd({ unit }) { unit.mem.dminonStopped = null; },
        },
        [S2]: {
          // a toggle, not a duration: "第二次及以后使用时…持续时间无限" (it then only ends when she leaves the field) — the
          // `kind: 'toggle'` + manual countdown idiom of op-headb2.js, because a `duration` skill's `timeLeft` must stay
          // finite (the harness invariant) and a finite number would show a countdown that never ends [implementation].
          kind: 'toggle',
          mods: { atkPct: num(b2.atk) },
          targeting: s2?.rangeGrid ? { rangeGrid: s2.rangeGrid.map((p) => [p[0], p[1]]) } : undefined,
          onStart({ battle, unit, skill }) {
            const later = (unit.mem.dminonS2Casts ?? 0) >= 1;      // 第二次及以后
            unit.mem.dminonS2Casts = (unit.mem.dminonS2Casts ?? 0) + 1;
            showGuo(battle, unit, guoKeys(unit), Math.max(0.5, num(s2?.duration, 20)));
            if (!later) { skill.timeLeft = Math.max(0.01, num(s2?.duration, 20)); return; }
            battle.addBuff(unit, { key: S2_ASPD, mods: { aspd: num(b2.attack_speed) }, tags: ['skill'] });
            skill.timeLeft = Infinity;                             // 持续时间无限
          },
          onTick({ skill, dt }) {
            if (!Number.isFinite(skill.timeLeft)) return;
            skill.timeLeft -= dt;
            if (skill.timeLeft <= 1e-9) skill.end('duration');
          },
          onEnd({ battle, unit }) { battle.removeBuff(unit, S2_ASPD); },
        },
        [S3]: {
          kind: 'duration',
          mods: { atkPct: num(b3.atk), aspd: num(b3.attack_speed) },
          targeting: s3?.rangeGrid ? { rangeGrid: s3.rangeGrid.map((p) => [p[0], p[1]]) } : undefined,
          onStart({ battle, unit }) {
            unit.mem.dminonSpread = new Set();
            unit.mem.dminonSpreadAt = -1e9;
            showGuo(battle, unit, guoKeys(unit), Math.max(0.5, num(s3?.duration, 36)));
          },
          onEnd({ unit }) { unit.mem.dminonSpread = null; },      // 技能结束后重置场上的国度状态
        },
      },
      talents: [
        { install(battle, unit) { // 实质坍缩: the 国度 pulse
          battle.every(GUO_IV, () => guoPulse(battle, unit), { owner: unit });
          battle.on('death', (ctx) => { if (ctx.unit === unit) unit.mem.dminonSpread = null; }, { owner: unit });
        } },
        { install(battle, unit) { // 此身为界: the retreat burst
          battle.on('death', (ctx) => {
            if (ctx.unit !== unit || ctx.reason !== 'retreat') return;
            retreatBurst(battle, unit);
          }, { owner: unit });
        } },
      ],
      install(battle, unit) {
        // S2 受戮: enemies inside 国度 cannot dodge her physical / arts damage (the dodge roll follows `hit`)
        battle.on('hit', (ctx) => {
          const d = ctx.dmg, t = ctx.target;
          if (ctx.source !== unit || !d || d.cancel || !up(unit) || !s2On(unit)) return;
          if (d.type !== 'phys' && d.type !== 'arts') return;
          if (!t || t.side !== 'enemy' || t.hidden) return;
          if (inGuo(unit, t)) d.canDodge = false;
        }, { owner: unit });
        // S3 无人的国度: a ground enemy hurting one of our units on 国度 spreads the field around itself
        battle.on('damaged', (ctx) => {
          if (!up(unit) || !s3On(unit)) return;
          const foe = ctx.source, victim = ctx.target;
          if (!foe || foe.side !== 'enemy' || foe.isFlying || !foe.alive) return;
          if (!victim || victim.side !== 'ally' || victim.hidden) return;
          const keys = guoKeys(unit);
          if (!keys.has(tileKeyOf(victim))) return;
          spread(battle, unit, foe);
        }, { owner: unit });
      },
    };
  },
};
