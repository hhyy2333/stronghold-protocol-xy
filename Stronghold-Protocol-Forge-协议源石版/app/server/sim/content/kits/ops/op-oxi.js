// server/sim/content/kits/ops/op-oxi.js — 塔露拉 (char_4247_oxi) kit, tier 6. 6★ 近卫·本源近卫 (WARRIOR/primguard),
// MELEE, block 2, 攻击间隔 1.2 s, 范围 1-1; a 自选 operator kit of the tier-5 and tier-6 DIY slots: all three
// skills, both talents and the trait, at every form. No module was released with her (`moduleNames {}`, `modules []`),
// so the picker offers 不装备模组 only. Kit contract and the 自选 rules: ../README.md ("How to add an operator (自选)");
// the conventions of the hand-authored kits: ../shared/tier6.js.
//
// Forms (data/backups.json units.char_4247_oxi, the DIY slot statuses): `2/1/4/0` normal = E2 Lv1, skills at rank 4, no
// module (its stat table is the 精英1 Lv80 one — an E2 Lv1 keeps the E1 maximum: 2415 / 778 / 361 at full potential);
// `2/60/7/1` / `2/60/7/3` elite = E2 Lv60, rank 7, 2743 / 866 / 403 (identical here: no module). Full potential (the
// owner's decision of 2026-10-07), so the talent blackboards are the potential-4+ ones (13 % 灼燃 / +18 % 奥术).
// Sources: the official zh_CN tables (character_table / skill_table, client v79) as built into backups.json, and the
// dossier ../参考/干员数值_塔露拉_冻河_国度_v79.md §「塔露拉（char_4247_oxi）」 (面板 / 范围 / 天赋 no / 潜能 / every
// skill at rank 1–7 and 专精一–三); docs/SIM.md §7.2 for the element conventions (元素损伤 vs 元素伤害).
//
// - Trait (本源近卫) "能够阻挡两个敌人，可以造成元素伤害": the profession default (block 2, melee, ground only, 1-1); the
//   element damage of her trait comes from T1. **T1's "攻击造成法术伤害" is the trait override `dmgType: 'arts'`** — the
//   record's own `dmgType` is `phys` because the client applies the talent at runtime, and a talent is in force under
//   every selected skill, so the override sits on `trait`, not on one skill.
// - Statuses: she has NO immunity — every phase of the official record carries `stunImmune` (and silence / sleep / frozen /
//   levitate) false and no `abnormalImmunes` / `abnormalComboImmunes` (tools/extra-operators.json, v79), so the kit grants
//   none and the dossier's 「免疫：眩晕」 line is wrong (reported to the Lead, who confirmed it).
// - T1 绝不妥协 (bb `ep_damage_ratio` / `arcane_idle_delay` / `arcane_step_interval` / `arcane_step` / `arcane_max`):
//   (a) every arts damage instance of hers that removes HP attaches `ep_damage_ratio` × ATK 灼燃损伤 (a gauge fill,
//       `type: 'element'`, docs/SIM.md §7.2). [ASSUMED] × ATK, not × damage dealt: the text "造成法术伤害时附带13%的灼燃
//       损伤" names no base, and both shapes the repo settles exist for the two wordings it knows ("N%攻击力的…损伤" ⇒ × ATK,
//        "伤害N%的…损伤" ⇒ × the HP damage just dealt) — this text is neither, and the blackboard key carries no
//        `[damage]` / `[trigger]` marker to decide it either way (珊比's ATK-based rider is `ep_damage_ratio[trigger]`,
//        her damage-based one `ep_damage_ratio[damage]`). × ATK keeps the gauge fill independent of the target's RES, as
//        every 本源 operator's ATK-worded rider does, and it is the reading under which the numbers stay meaningful against
//        high-RES enemies. It rides on every arts hit: normal attacks, S1's burst, S2's retaliatory splash, S3's 簇火
//        explosions (the elemental ones are 元素伤害, not 法术伤害, so they attach none).
//   (b) after `arcane_idle_delay` s without attacking, 法术和元素伤害 climb by `arcane_step` every `arcane_step_interval` s
//       up to `arcane_max`, and every attack takes a step off. [ASSUMED] one step per attack (the text says only "每次攻击
//       时衰减" and gives one step) and the idle clock restarts with that decay. One `dmgDealtMul` buff covers both arts
//       and 元素伤害 (docs/SIM.md §2: `dmgDealtMul` multiplies every damage instance the unit deals) — no `artsDealtMul`
//       is added, which would scale the arts twice and leave 元素伤害 out.
// - T2 我即火焰 (bb `field_duration` / `field_interval` / `field_atk_scale` / `max_count`; the 5 s is the text's): while she
//   is on the field, ANY enemy on the field finishing a 灼燃 burst (`battle.on('elementBurst')`, `element === 'burn'`) is
//   watched for 5 s and leaves a 「足迹」 on every passable ground tile (`battle.grid.groundPassable`) its position tile
//   crosses meanwhile; each footprint lasts `field_duration` s and deals `field_atk_scale` × ATK arts to the ground enemies
//   standing on it every `field_interval` s. [ASSUMED] where the text is silent: (i) "爆发后5秒内" is a look-back window,
//   not a 5 s delay; (ii) one footprint per tile, its timer refreshed when the tile is crossed again; (iii) at `max_count`
//   (25) the oldest footprint is evicted — a rolling trail; (iv) only ground enemies stand on a footprint (an air unit
//   flies over the ground it lies on); (v) a burst from any source counts ("全场敌人灼燃损伤爆发后", a teammate's 灼燃
//   included); (vi) the footprints stop with her — the talent says "在场时".
// - S1 照霎白夜 (AUTO instant, spCost 8 / initSp 0, 1 charge, data DEFAULT): `atk_scale` × ATK arts and `fear` s of 恐惧 to
//   ALL GROUND enemies on the tile of the target her attack would take (the enemies she blocks first, else the first
//   target of her range) — the text's "所在地块", one tile. Its cast is no attack: she keeps her own attack rhythm.
// - S2 阂断骤雪 (AUTO, `TAKE_DAMAGE`, 5 charges, spCost 8 / initSp 18), on being hurt by an enemy:
//   (a) 庇护 `damage_resistance` for `shelter_hold_duration` s, then decaying linearly to `damage_resistance` ×
//       `damage_remaining_scale` at `skill_duration` s — the shared PROTECT effect (§3 "同名效果取最高", tier1
//       `holdProtect`). [ASSUMED] the decay is linear and `damage_remaining_scale` is the fraction still held at the end
//       of `skill_duration` (the text only says "持续0.2秒后逐渐降低").
//   (b) `retaliate_atk_scale` × ATK arts to the attacker and to every enemy within `ability_range_radius` of it (a splash
//       centred on the attacker), tags `['counter']` (the re-entrancy rule, docs/SIM.md §5), then a heal of `heal_ratio` of
//       the damage that dealt. [ASSUMED] "相当于伤害量5%" = the retaliation's own damage, and the 范围 is centred on the
//       attacker with `ability_range_radius`.
//   (c) for `stack_duration` s: one stack of +`atk` / +`def` per cast (at most `max_stack_cnt` 5) and every attack hits
//       ALL the enemies she blocks — the engine's `beforeAttack` hook adds them to the attack's targets (the
//       强攻手-style "同时攻击阻挡的所有敌人"). `attack@buffed_attack_atk_scale` (1) is the attack scale of those
//       attacks: 100 % ATK, i.e. her normal attack — read, and it changes nothing.
//   The trigger is the DATA's (`skills['skchr_oxi_2'].trigger` = TAKE_DAMAGE — the official "受到攻击后触发，可充能5次";
//   tools/build-data.mjs `UNIT_TRIGGER_CORRECTIONS`, v79): the kit sets no override (checklist item 5).
// - S3 日冕重烈 (MANUAL, 36 s, spCost 45 / initSp 38, data DEFAULT): ATK +`atk` and no normal attack; every
//   `normal_interval` s a wave of 簇火 is summoned on the `2 × normal_half_width + 1` rows across her facing (one per row,
//   on her own column) and travels `wave_speed` tiles/s in her deploy direction. The first enemy whose body comes within
//   `projectile_range` of a 簇火 makes it explode for `heatwave_atk_scale` × ATK 法术伤害 over `range_radius` around that
//   enemy — 元素伤害 (`type: 'elemental'`) instead for a target inside its 灼燃 burst (`findBuff('burnBurst')`) — and an
//   enemy hit by a further 簇火 of the SAME wave takes `same_wave_repeat_damage_scale` of it.
//   过载 at the second half of the duration (18 s): `overload_interval` / `overload_half_width`. [ASSUMED] the blackboards
//   carry no 过载 trigger; the repo's convention is "the second half of the skill's duration" (号角 S3 "技能进行到一半时",
//   ops/chess_char_5_08-horn.js; ops/op-wisdel.js).
//   [ASSUMED] further: the first wave comes one interval into the skill; a 簇火 that travels `wave_exit_distance` tiles
//   without touching anybody is spent (it also stops at the field's edge); the collision radius `projectile_range` is
//   measured to the enemy's body (body.js `bodyInRadius`) and air units collide too (the text names no target motion, and
//   docs/SIM.md §8 reads "no note" as air-capable [ASSUMED]); the explosion is a 中点判定 of `range_radius` around the struck
//   enemy. 「该技能可随时主动关闭」 is a PLAYER input: the kit never stops it, it runs its full `duration` (36 s, 过载 in
//   the second half) and the ATK buff leaves with the skill at the end. An earlier cut stopped the channel as soon as no
//   enemy was left on the field; the owner removed that on 2026-11-01 (`skill.stop()` is reachable from the UI / kit
//   hooks, just not automatically).

import { num, talentBb, skillRec, holdProtect, PROTECT_TICK_HOLD, enemiesInGrid, up, byEnemyAttack, onDamagedOn } from '../shared/tier1.js';
import { dirVec, offsetTile } from '../../../dir.js';
import { bodyInRadius } from '../../../body.js';
import { canTargetEnemy } from '../../../targeting.js';
import { hasHp } from '../../../damage.js';
import { COLS, TICK } from '../../../constants.js';

const S1 = 'skchr_oxi_1';
const S2 = 'skchr_oxi_2';
const S3 = 'skchr_oxi_3';
/** T2: how long a 灼燃 burst keeps laying footprints — the text's "爆发后5秒内" (no blackboard key). */
const TRACK_WINDOW = 5;
/** S2: the hit that set the counter off is this fresh (a tick of slack past the event itself). */
const HIT_FRESH = 2 * TICK;
/** Ground-only / any-target profiles for the engine's selectors. */
const GROUND = Object.freeze({ canHitFly: false });
const ANY = Object.freeze({ canHitFly: true });
const ARC_KEY = 'oxi:arcane';          // T1 (b): the idle ramp, one dmgDealtMul buff
const STACK_KEY = 'oxi:snowStack';     // S2 (c): the 5 s +atk / +def stacks
const BURN_TAG = 'oxi:neverCompromise';
const STEP_TAG = 'oxi:footprint';
const WAVE_TAG = 'oxi:heatwave';
/**
 * 「簇火」最远只会尝试在**自身身后 11 格**所属行（或列）的地块中心生成，每行（或列）独立检查该距离，所以各行生成时的
 * 坐标可以不一致（业主 2026-11-01 转述的官方口径；这一条不在技能黑板上，故为 kit 常量）。
 */
const SPAWN_BEHIND = 11;

const bbOf = (chess, id) => skillRec(chess, id)?.bb ?? {};
/** The tile of a unit's position (its 判定中心). */
const tileOf = (u) => [Math.round(u.y), Math.round(u.x)];

export default {
  // (the kit is built once for the PICKED skill, so every skill reads its own record — never `bb` / `def.skill`)
  char_4247_oxi: (bb, chess) => {
    const t1 = talentBb(chess, 0), t2 = talentBb(chess, 1);
    const b1 = bbOf(chess, S1), b2 = bbOf(chess, S2), b3 = bbOf(chess, S3);
    const s2 = skillRec(chess, S2);
    const duration = num(skillRec(chess, S3)?.duration, 36);
    // ---------------------------------------------------------------- S3 tunables
    const rangeRadius = num(b3.range_radius, 1.5);
    const exitDistance = num(b3.wave_exit_distance, 5);
    const projectileRange = num(b3.projectile_range, 0.5);
    const hwScale = num(b3.heatwave_atk_scale, 1);
    const repeatScale = num(b3.same_wave_repeat_damage_scale, 0.15);
    const waveSpeed = num(b3.wave_speed, 2.3);
    const normIv = Math.max(0.05, num(b3.normal_interval, 2.67));
    const overIv = Math.max(0.05, num(b3.overload_interval, 2));
    const normHalf = Math.max(0, Math.round(num(b3.normal_half_width, 2)));
    const overHalf = Math.max(0, Math.round(num(b3.overload_half_width, 6)));

    /**
     * The 簇火's fire — the client's oxi_skill_03_trail_01 (public/js/render/vfx/skills.js
     * FX_BINDINGS.skchr_oxi_3.oxiTrail): **one instance every `TRAIL_IV` seconds of flight**, each at the 簇火's own
     * position, held 1.2 s, so the overlapping streaks read as one fire marching along the row (owner 2026-11-01: the trail
     * visual stays at the version that is live — a shorter 0.5 s / 0.55 s cut was tried and rolled back). The ~5.2 tiles of
     * the prefab's own streak cannot shrink, it is baked into the asset.
     *
     * Why puffs and not one moving instance: the prefab draws its fire 6.5 tiles BEHIND its anchor (its root node sits at
     * [-6.5, 2, 0] — it is the tail the official 簇火 drags). The client compensates that on placement
     * (`offsetDir: 6.5`), which puts the fire on the 簇火 wherever it is; a per-frame moving placement instead never
     * started the effect at all (owner's tests of 2026-11-01: 「只有爆炸特效，完全没有火」).
     */
    const TRAIL_IV = 0.4;
    /**
     * 画面上的弹带间距（业主 2026-11-01「特效上下间距大一点点」）：簇火本身按格子逐行排、行距就是 1 格，这里只把**画出来**
     * 的横向间距按 1.15 倍撑开一点，免得多道火糊成一片。只动绘制坐标——落点、判定、伤害仍按格子走（爆炸在敌人身上）。
     */
    const TRAIL_SPREAD = 1.15;
    const emitTrail = (battle, unit, shot) => {
      const [dr, dc] = dirVec(unit.dir);
      // the band's lateral axis, spread from her own tile outwards: rows when she faces along a row, columns when along a column
      const y = dc !== 0 ? unit.tileR + (shot.y - unit.tileR) * TRAIL_SPREAD : shot.y;
      const x = dr !== 0 ? unit.tileC + (shot.x - unit.tileC) * TRAIL_SPREAD : shot.x;
      battle.fx('oxiTrail', {
        x, y, dr, dc, dur: 1.2, id: unit.id, skill: WAVE_TAG, trailKey: shot.key,
      });
      shot.acc = 0;
    };

    /**
     * How many tiles a 簇火 born on (r, c) travels before it is spent: to `wave_exit_distance` tiles OUTSIDE the far edge
     * of the map ("「簇火」最多移动至地图边缘外第 5 格中心"), measured along her facing from its own birth tile.
     */
    const travelFrom = (battle, unit, r, c) => {
      const [dr, dc] = dirVec(unit.dir);
      const rect = battle.rect;
      let toEdge = 0;
      if (dc > 0) toEdge = rect.c1 - c; else if (dc < 0) toEdge = c - rect.c0;
      else if (dr > 0) toEdge = rect.r1 - r; else if (dr < 0) toEdge = r - rect.r0;
      return Math.max(0, toEdge) + exitDistance;
    };

    /** S3: one 簇火 wave — one shot per row across her facing, born as far back as the map allows (≤ 11 tiles). */
    const spawnWave = (battle, unit, w, half) => {
      const wave = { hit: new Set(), shots: [] };
      for (let off = -half; off <= half; off++) {
        // 「簇火」最远只会尝试在自身身后 11 格的地块中心生成，每行独立检查 —— 各行停在自己还能回溯到的最后一格
        const [sr, sc] = offsetTile(unit.tileR, unit.tileC, off, 0, unit.dir);
        let [r, c] = [sr, sc];
        for (let k = 1; k <= SPAWN_BEHIND; k++) {
          const [br, bc] = offsetTile(sr, sc, 0, -k, unit.dir);
          if (!battle.grid.inRect(br, bc)) break;
          [r, c] = [br, bc];
        }
        if (!battle.grid.inRect(r, c)) continue;
        w.seq = (w.seq || 0) + 1;
        wave.shots.push({ x: c, y: r, travelled: 0, travel: travelFrom(battle, unit, r, c), acc: TRAIL_IV, key: w.seq });
      }
      if (!wave.shots.length) return;
      w.waves.push(wave);
      w.spawned = (w.spawned || 0) + 1;
      // 簇火的画面：**一颗一颗地发**，一颗簇火一条尾迹（业主 2026-11-01「就要官方那条拖尾」）。
      // 客户端那个 oxi_skill_03_trail_01 是「挂在飞行簇火身上的尾巴」：根节点在 [-6.5, 2, 0]，`trail_02` 是 5 格长的
      // 拉伸面片 —— 在一个固定点上播会整体错位 6.5 格（业主截图）。所以这里把**方向与终点**一起发出去：官方特效层
      // （public/js/render/vfx/skills.js FX_BINDINGS.skchr_oxi_3.oxiTrail，`move: true`）按朝向摆好 yaw 并让它每帧沿
      // 方向推进，那条自带的 -6.5 格偏移于是正好变成簇火身后的尾巴；关掉官方特效时同一个事件退回程序化火球
      // （public/js/render/fx/kinds.js `oxiTrail` = 'fireball' 原型：从 (x, y) 飞向 (tx, ty)、用 flight 秒）。
      for (const s of wave.shots) emitTrail(battle, unit, s);   // the birth puff (`acc` starts at TRAIL_IV: one now)
    };
    /** S3: one 簇火 explosion at (x, y) — every enemy within range_radius, 15 % for the wave's repeat hits. */
    const explode = (battle, unit, wave, shot, x, y) => {
      const victims = battle.foesInRadius(x, y, rangeRadius, true);
      if (!victims.length) return;
      for (const e of victims) {
        if (!e.alive) continue;
        const repeat = wave.hit.has(e);
        wave.hit.add(e);
        // "若目标处于灼燃损伤爆发期间则改为造成元素伤害": the target's own burst lock decides the damage type
        const burning = !!e.findBuff('burnBurst');
        battle.dealDamage(unit, e, {
          amount: unit.s.atk * hwScale * (repeat ? repeatScale : 1),
          type: burning ? 'elemental' : 'arts', element: burning ? 'burn' : undefined,
          isSkill: true, canDodge: false, tags: ['skill', WAVE_TAG],
        });
      }
      battle.fx('blast', { x, y, radius: rangeRadius, id: unit.id, skill: WAVE_TAG });
      // the 簇火 that hit is spent: its fire goes with it (the client stops that trail's instances — FX_BINDINGS.oxiTrailStop)
      battle.fx('oxiTrailStop', { x, y, id: unit.id, skill: WAVE_TAG, trailKey: shot.key });
    };
    /** S3: advance every 簇火, explode the ones that touch somebody, spend the ones that ran out. */
    const advance = (battle, unit, w, dt) => {
      const [dr, dc] = dirVec(unit.dir);
      const step = waveSpeed * dt;
      for (let i = w.waves.length - 1; i >= 0; i--) {
        const wave = w.waves[i];
        for (let k = wave.shots.length - 1; k >= 0; k--) {
          const shot = wave.shots[k];
          shot.x += dc * step;
          shot.y += dr * step;
          shot.travelled += step;
          shot.acc = (shot.acc || 0) + dt;
          while (shot.acc >= TRAIL_IV - 1e-9) emitTrail(battle, unit, shot);
          let hitEnemy = null;
          for (const e of battle.enemies) {
            if (!canTargetEnemy(unit, e, ANY) || !bodyInRadius(e, shot.x, shot.y, projectileRange)) continue;
            hitEnemy = e;   // the first one this 簇火 touches (spawn order)
            break;
          }
          if (hitEnemy) {
            explode(battle, unit, wave, shot, hitEnemy.x, hitEnemy.y);
            wave.shots.splice(k, 1);
            continue;
          }
          // it may leave the map: it is spent `wave_exit_distance` tiles past the far edge (travelFrom)
          if (shot.travelled >= shot.travel - 1e-9) wave.shots.splice(k, 1);
        }
        if (!wave.shots.length) w.waves.splice(i, 1);
      }
    };

    return {
      // T1 (a): 攻击造成法术伤害 — the talent's arts conversion, in force under every selected skill
      trait: { dmgType: 'arts' },
      skills: {
        [S1]: {
          kind: 'instant',
          onStart({ battle, unit }) {
            const scale = num(b1.atk_scale, 1);
            // "目标所在地块": the tile of the enemy her attack would take — the ones she blocks first, else her range's
            // first target (the engine's own target order, tier1 enemiesInGrid)
            const blocked = battle.blockedTargets(unit, unit.profile).filter((e) => !e.isFlying);
            const primary = blocked[0] ?? enemiesInGrid(battle, unit, null, { canHitFly: false, groundOnly: true })[0] ?? null;
            if (!primary) return;
            const [r, c] = tileOf(primary);
            const victims = battle.enemiesOnTiles([r * COLS + c], unit, GROUND);
            for (const e of victims) {
              if (!e.alive) continue;
              battle.dealDamage(unit, e, { amount: unit.s.atk * scale, type: 'arts', isSkill: true, tags: ['skill', 'oxi:whitenight'] });
              if (e.alive) battle.applyStatus(e, 'fear', { duration: num(b1.fear, 2.5), source: unit });
            }
            battle.fx('scorchBurst', { x: c, y: r, radius: 0.5, id: unit.id, skill: 'oxi:whitenight' });
          },
        },
        [S2]: {
          kind: num(s2?.maxChargeTime, 1) > 1 ? 'charges' : 'instant',   // TAKE_DAMAGE comes from the data
          onStart({ battle, unit }) {
            const dr = num(b2.damage_resistance);
            const hold = num(b2.shelter_hold_duration, 0.2);
            const span = Math.max(hold + TICK, num(b2.skill_duration, 1.3));
            // (a) 庇护: full for shelter_hold_duration s, then decaying (see `install`) — the shared PROTECT effect
            if (dr > 0) {
              unit.mem.oxiShelter = { from: battle.time, until: battle.time + span, hold, span, dr, remain: num(b2.damage_remaining_scale, 0.1) };
              holdProtect(battle, unit, dr, hold, unit);
              battle.fx('shield', { x: unit.x, y: unit.y, id: unit.id, skill: 'oxi:ashSnow' });
            }
            // (b) the retaliation on the attack's source and everything within ability_range_radius of it
            const last = unit.mem.oxiLastHit;
            const src = last && last.src && last.src.alive && battle.time - last.t <= HIT_FRESH + 1e-9 ? last.src : null;
            const retal = num(b2.retaliate_atk_scale);
            if (src && retal > 0) {
              const radius = num(b2.ability_range_radius, 1);
              const victims = battle.foesInRadius(src.x, src.y, radius, true);
              if (!victims.includes(src) && canTargetEnemy(unit, src, ANY)) victims.push(src);
              let dealt = 0;
              for (const e of victims) {
                if (!e.alive) continue;
                dealt += battle.dealDamage(unit, e, {
                  amount: unit.s.atk * retal, type: 'arts', isSkill: true, canDodge: false,
                  tags: ['counter', 'skill', 'oxi:ashSnow'],
                });
              }
              const ratio = num(b2.heal_ratio);
              if (dealt > 0 && ratio > 0) battle.heal(unit, unit, dealt * ratio, { self: true });
              battle.fx('counter', { x: src.x, y: src.y, id: unit.id, target: src.id });
            }
            // (c) the 5 s state: one +atk / +def stack per cast (the blocked-enemy hits live in `install`'s beforeAttack)
            const atk = num(b2.atk), dfs = num(b2.def);
            if (atk || dfs) {
              battle.addBuff(unit, {
                key: STACK_KEY, duration: num(b2.stack_duration, 5), refresh: 'stack', stacks: 1,
                maxStacks: Math.max(1, Math.round(num(b2.max_stack_cnt, 5))),
                mods: { atkPct: atk, defPct: dfs }, visible: true, tags: ['skill', 'oxi:ashSnow'],
              });
            }
          },
        },
        [S3]: {
          kind: 'duration',
          duration,
          mods: { atkPct: num(b3.atk) },
          attack: { noAttack: true },                 // "停止攻击以持续引导场地"
          onStart({ unit }) {
            unit.mem.oxiWave = { t: 0, acc: 0, waves: [], over: false, spawned: 0 };
          },
          onTick({ battle, unit, dt }) {
            const w = unit.mem.oxiWave;
            if (!w) return;
            w.t += dt;
            // 过载: the second half of the duration [ASSUMED] (号角 S3 "技能进行到一半时")
            const over = w.t >= duration / 2 - 1e-9;
            if (over && !w.over) {
              w.over = true;
              w.acc = 0;   // the faster cadence starts afresh [ASSUMED: the blackboard gives no 过载 trigger]
              // 过载的提示：展开后的整条弹带在地上亮一下（'field' 是判定格高亮、不是 FLASH 类闪光，官方特效层不会把它吃掉），
              // 广度 = overload_half_width 行 × 射程，持续 1.2 s。
              const tiles = [];
              for (let off = -overHalf; off <= overHalf; off++) {
                for (let k = 0; k <= exitDistance; k++) {
                  const [r, c] = offsetTile(unit.tileR, unit.tileC, off, k, unit.dir);
                  if (battle.grid.inRect(r, c)) tiles.push([r, c]);
                }
              }
              if (tiles.length) {
                battle.fx('field', { x: unit.x, y: unit.y, tiles, dur: 1.2, id: unit.id, skill: WAVE_TAG });
                // 橙色版（kinds.js `oxiOverload`）：本模式战斗区只有 4 行，过载把弹带加宽到 13 行会被裁成和普通波一样宽，
                // 只靠「同色高亮」看不出过载；换成火焰橙亮 2.5 秒才读得出「过载了」。
                battle.fx('oxiOverload', { x: unit.x, y: unit.y, tiles, dur: 2.5, id: unit.id, skill: WAVE_TAG });
              }
            }
            const iv = over ? overIv : normIv;
            const half = over ? overHalf : normHalf;
            w.acc += dt;
            while (w.acc >= iv - 1e-9 && unit.alive) { // loop-cap: the interval is floored at 0.05 s in the constants
              w.acc -= iv;
              spawnWave(battle, unit, w, half);
            }
            advance(battle, unit, w, dt);
            // 「该技能可随时主动关闭」 is the PLAYER's input only: the kit never closes it (owner 2026-11-01 — the old
            // 「场上没敌人就关」 cut the channel short before the 过载 half and made the skill look like it had no 过载)
          },
          onEnd({ unit }) { unit.mem.oxiWave = null; },
        },
      },
      talents: [
        { install(battle, unit) { // T1 绝不妥协: the 灼燃损伤 rider and the idle 奥术 ramp
          const ratio = num(t1.ep_damage_ratio);
          if (ratio > 0) {
            battle.on('damaged', (c) => {
              const t = c.target;
              // "造成法术伤害时": an arts instance of hers that removed HP — never her own element fill (type 'element'),
              // never a 流失, never a corpse (docs/SIM.md §7.2)
              if (c.source !== unit || c.type !== 'arts' || !(c.amount > 0)) return;
              if (!t || t.side !== 'enemy' || !hasHp(t) || !up(unit)) return;
              battle.dealDamage(unit, t, {
                amount: unit.s.atk * ratio, type: 'element', element: 'burn', tags: ['talent', BURN_TAG],
              });
            }, { owner: unit, priority: -10 });
          }
          // 三技能「日冕重烈」的释放策略（业主 2026-11-01）：官方把它写成 MANUAL，而引擎把 MANUAL 当 NEVER——永远不会
          // 自己触发。这里改成「地图上还有敌人就开启」：SP 满、技能不在运行、干员能行动且没被沉默、场上存在活着的敌人，
          // 就替玩家按下；场上一旦没有敌人就留着不放，充能不会被空放掉。挂在 T1 的 install 里是因为它是随部署常驻的
          // tick（不是天赋效果，见下面的注释）。
          battle.on('tick', () => {
            const sk = unit.skill;
            if (!sk || sk.id !== S3 || sk.active || !sk.ready) return;
            if (!up(unit) || !unit.canAct || unit.s.flags.silence) return;
            if (!battle.enemies.some((e) => e.alive && hasHp(e) && !e.hidden && !e.s.flags.untargetable)) return;
            sk.activate('oxiAuto');
          }, { owner: unit });
          const step = num(t1.arcane_step), iv = Math.max(0.05, num(t1.arcane_step_interval, 0.5));
          const delay = num(t1.arcane_idle_delay, 3), cap = num(t1.arcane_max);
          if (!(step > 0 && cap > 0)) return;
          const maxSteps = Math.max(1, Math.round(cap / step + 1e-9));
          const state = () => unit.mem.oxiArc ?? (unit.mem.oxiArc = { idle: 0, acc: 0, steps: 0, shown: 1 });
          const refresh = (b) => {
            const s = state();
            const mul = 1 + s.steps * step;
            if (Math.abs(mul - s.shown) < 1e-9) return;
            s.shown = mul;
            b.removeBuff(unit, ARC_KEY);
            if (s.steps > 0) b.addBuff(unit, { key: ARC_KEY, mods: { dmgDealtMul: mul }, tags: ['talent'], visible: true });
          };
          battle.on('deploy', (c) => {
            if (c.unit !== unit) return;
            unit.mem.oxiArc = { idle: 0, acc: 0, steps: 0, shown: 1 };
            battle.removeBuff(unit, ARC_KEY);
          }, { owner: unit });
          battle.on('tick', ({ dt }) => {
            if (!up(unit)) return;
            const s = state();
            s.idle += dt;
            if (s.idle + 1e-9 >= delay) {
              s.acc += dt;
              while (s.steps < maxSteps && s.acc >= iv - 1e-9) { // loop-cap: maxSteps = arcane_max / arcane_step
                s.acc -= iv;
                s.steps++;
              }
              if (s.steps >= maxSteps) s.acc = 0;
            }
            refresh(battle);
          }, { owner: unit });
          battle.on('attack', (c) => {
            if (c.attacker !== unit) return;
            const s = state();
            if (s.steps > 0) s.steps--;     // "每次攻击时衰减": one step per attack [ASSUMED]
            s.idle = 0;                      // and the idle clock starts over
            s.acc = 0;
            refresh(battle);
          }, { owner: unit });
        } },
        { install(battle, unit) { // T2 我即火焰: a 灼燃 burst anywhere lays 「足迹」 on the ground its victim crosses
          const dur = num(t2.field_duration), iv = Math.max(0.05, num(t2.field_interval, 0.3));
          const scale = num(t2.field_atk_scale);
          const cap = Math.max(1, Math.round(num(t2.max_count, 25)));
          if (!(dur > 0 && scale > 0)) return;
          const state = () => unit.mem.oxiSteps ?? (unit.mem.oxiSteps = { tiles: new Map(), watch: new Map() });
          battle.on('elementBurst', (c) => {
            if (c.element !== 'burn' || !up(unit)) return;
            const t = c.target;
            if (!t || t.side !== 'enemy') return;
            state().watch.set(t, battle.time + TRACK_WINDOW);   // "爆发后5秒内" — a look-back window [ASSUMED]
          }, { owner: unit });
          battle.on('tick', ({ dt }) => {
            const s = state();
            if (!up(unit)) { s.tiles.clear(); s.watch.clear(); return; }   // "在场时"
            for (const [e, until] of s.watch) {
              if (!e.alive || e.hidden || battle.time > until + 1e-9) { s.watch.delete(e); continue; }
              const [r, c] = tileOf(e);
              if (!battle.grid.inRect(r, c) || !battle.grid.groundPassable(r, c)) continue;
              const key = r * COLS + c;
              const known = s.tiles.get(key);
              if (known) {
                if (known.until < battle.time + dur) known.until = battle.time + dur;
                continue;
              }
              while (s.tiles.size >= cap) s.tiles.delete(s.tiles.keys().next().value);  // oldest out [ASSUMED]
              s.tiles.set(key, { r, c, until: battle.time + dur, acc: 0 });
              battle.fx('field', { x: c, y: r, tiles: [[r, c]], dur, id: unit.id, skill: STEP_TAG });
            }
            for (const [key, tile] of s.tiles) {
              if (battle.time > tile.until + 1e-9) { s.tiles.delete(key); continue; }
              tile.acc += dt;
              while (tile.acc >= iv - 1e-9 && unit.alive) { // loop-cap: the interval is floored at 0.05 s
                tile.acc -= iv;
                for (const e of battle.enemiesOnTiles([key], unit, GROUND)) {
                  battle.dealDamage(unit, e, {
                    amount: unit.s.atk * scale, type: 'arts', canDodge: false, tags: ['talent', STEP_TAG],
                  });
                }
              }
            }
          }, { owner: unit });
        } },
      ],
      install(battle, unit) {
        // S2 (b): remember the damage instance that may set the counter off (content `damaged` handlers run before the
        // engine fires the TAKE_DAMAGE activation, docs/SIM.md §4)
        onDamagedOn(battle, unit, (c) => {
          if (!byEnemyAttack(c) || !c.source || !c.source.alive) return;
          unit.mem.oxiLastHit = { src: c.source, t: battle.time };
        });
        // S2 (a): the shelter's decay after shelter_hold_duration s (the skill itself ends at once: it is no timed skill)
        battle.on('tick', () => {
          const sh = unit.mem.oxiShelter;
          if (!sh) return;
          if (!up(unit) || battle.time > sh.until + 1e-9) { unit.mem.oxiShelter = null; return; }
          const t = battle.time - sh.from;
          let v = sh.dr;
          if (t > sh.hold) {
            const k = Math.min(1, (t - sh.hold) / Math.max(TICK, sh.span - sh.hold));
            v = sh.dr * (1 - (1 - sh.remain) * k);
          }
          if (v > 0) holdProtect(battle, unit, v, PROTECT_TICK_HOLD, unit);
        }, { owner: unit });
        // S2 (c): "之后5.0秒内攻击所有阻挡的敌人" — every attack takes in the enemies she blocks (the 强攻手 rule)
        battle.on('beforeAttack', (c) => {
          if (c.attacker !== unit || !up(unit) || !unit.findBuff(STACK_KEY)) return;
          const targets = c.targets ?? [];
          for (const e of battle.blockedTargets(unit, c.profile ?? unit.profile)) if (!targets.includes(e)) targets.push(e);
          c.targets = targets;
        }, { owner: unit });
      },
    };
  },
};
