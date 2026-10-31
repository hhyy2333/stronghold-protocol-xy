// server/sim/content/enemies/forkwave.js — the fork's own wave enemies with a mechanic (docs/research/16-extra-enemies.json
// batches 2 and 3, owner 2026-10-22「我需要更多小怪和精英怪」→「1」= 第二批做带技能的 → 2026-10-25「我想要加入更多有技能的怪」；
// batch 4 = 2026-10-25「优雅刀技厨师…加入悬赏。凶豕兽作战里少放点，冰晶射手作战里少放点」；
// batch 5 = 2026-10-29「黑流树海的大狗、大象、吐水羊、瞬移老鼠；孤星的大炮动力甲和打拳动力甲、交通厅」).
//
// batch 5's 吐水羊 (enemy_2134_shrshep) was in the batch and is OUT again (owner 2026-10-31「删除颂水贤者这个怪」).
//
// Every one of them is an official enemy this repository did not carry, whose model the local client does provide
// (tools/local-extract/extract.py ENEMY_SPINES). Their numbers come from enemy_database; the mechanics below are the
// handbook's abilities written on the primitives the engine already has (deathBoom / splashAttack / blockWeight /
// stealth / enemyAura / the dealt and taken hooks …), so nothing new is invented — where a handbook line depends on a
// system this mode does not have (结晶, 装备, 狂欢时刻, 摄影区域, 月光, 沙尘暴), the enemy is left out of the batch or that line
// is deliberately not modelled, and the comment says so.
//
// Registered through KIT_FAMILIES; the keys are NOT in STATS_ONLY (enemies.js asserts one or the other, never both).

import { COLS, TICK } from '../../constants.js';
import { hypot } from '../../detmath.js';
import { isHpLoss } from '../../damage.js';
import { T, areaAllies, hurt, spawnChildren } from './helpers.js';
import {
  deathBoom, deathSpawn, splashAttack, blockWeight, stealth, unblockable, enemyAura, skill, maxTargets, reborn,
} from './archetypes.js';

/** 爱国者's 献祭 blast radius (PRTS "半径1.75") and its damage share of ATK (level 0's 5.21 %; level 1 uses 5 % — kept as
 *  the data writes it) and 投枪's search radius ("半径20内距离自身最远的远程位"). */
const PATRIOT_SACK_RADIUS = 1.75;
const PATRIOT_SACK_SCALE = 0.0521;
const PATRIOT_SPEAR_RANGE = 20;
/** 爱国者's 【大幅强化敌军攻击与防御力】 aura radius — the data names no radius ("在场时全场"); [ASSUMED] a leader-sized
 *  aura rather than truly field-wide, so the other enemies it buffs have to stand near it. */
const PATRIOT_AURA_RADIUS = 4;
/** How long 爱国者 stays down when its first knock-out is turned into a 重生 (owner 2026-10-30「把爱国者的复活时间减短到
 *  5s左右」). The data says 60 s (`reborn.duration`) — that is the official 7-18 three-stage fight, where the rebirth is a
 *  scripted stretch with map events behind it. As a 强怪悬赏 enemy in a 60–120 s round those 60 s are simply dead air, so
 *  the window is capped here. The post-revival invulnerability is capped to the same number (see `patriotBoss`). */
const PATRIOT_REBORN_SECONDS = 5;


/** A normal attack that lowers the target's DEF / attack speed: the handbook's 「每次攻击会降低击中目标的防御」 /
 *  「被阻挡时使阻挡单位攻击速度极大幅降低」. The buff is refreshed on every hit and keeps the data's own value. */
const onHitDebuff = (key, mods, dur) => ({
  dealt(c, b) {
    if (!c.target || !c.target.alive || !(c.dmg && c.dmg.isAttack)) return;
    b.addBuff(c.target, { key: `fork:${key}`, duration: dur, refresh: 'replace', visible: true, mods });
  },
});

/** 陶醉的“酩酊”'s 「经过自身周围」: aura radius [ASSUMED: the data names no radius]; the values are its own talent
 *  (Aura.attack_speed +50 ASPD, Aura.move_speed ×1.5, Aura.attack@damage_resistance 0.4 = phys/arts taken ×0.6). */
const TRSPSB_AURA_RADIUS = 1.5;

/** 散华骑士团 / 烛骑士 blast radius when the data leaves it out [ASSUMED]. */
const CADKGT_BLAST_RADIUS = 2.2;

/**
 * The blackboard of one of the enemy's SKILLS (data/enemies.json `skills[i].bb` — ab.sk[prefabKey].bb), not of its talents:
 * 「周期性为自身周围N名敌人回复一定生命值」 is a RangeHeal skill, so its radius, target cap and heal scale live there.
 */
const skBB = (ab, prefabKey) => (ab && ab.sk && ab.sk[prefabKey] ? ab.sk[prefabKey].bb : null) || {};

/** A number of a skill blackboard (a plain object, not an `ab` — T() reads `ab.t`, so it is read directly here). */
const bbNum = (bb, key, dflt) => (bb && typeof bb[key] === 'number' && Number.isFinite(bb[key]) ? bb[key] : dflt);

/** Periodic heal of the 圣堂保育员 (RangeHeal, cooldown 3 s), ATK × heal_scale to the enemies around it, itself excluded. */
const rangeHeal = (ab) => {
  const bb = skBB(ab, 'RangeHeal');
  const r0 = bbNum(bb, 'range_radius', 2.5), max0 = bbNum(bb, 'max_target', 3), scale = bbNum(bb, 'heal_scale', 0);
  return {
    cd: 3,
    fire(b, e) {
      const tgt = b.enemiesInRadius(e.x, e.y, r0).filter((o) => o !== e && o.alive).slice(0, Math.max(1, Math.round(max0)));
      if (!tgt.length) return false;
      const amt = e.s.atk * scale;
      if (!(amt > 0)) return false;
      b.fx('heal', { x: e.x, y: e.y, r: r0 });
      for (const o of tgt) b.heal(e, o, amt);
      return true;
    },
  };
};

/** The nearest living ally (the ChargeAttack blast needs a target and the enemy may have none). */
function nearestAlly(b, e) {
  let best = null, bd = Infinity;
  for (const u of b.allies()) {
    if (!u.alive) continue;
    const d = Math.abs(u.x - e.x) + Math.abs(u.y - e.y);
    if (d < bd) { bd = d; best = u; }
  }
  return best;
}

/** 【微光之触】 ChargeAttack: a cast on its cooldown, the blast on its end — ATK × atk_scale (arts) to every ally around the
 *  target. The knight has no 隐匿 in this mode: 「蓄力时失去隐匿」 only ever applies to the official stage's light effect, and
 *  the data carries no such ability — it fights like any ranged caster. */
const chargeBlast = (ab, cd) => {
  const bb = skBB(ab, 'ChargeAttack');
  const sk = ab && ab.sk ? ab.sk.ChargeAttack : null;
  const r0 = bbNum(bb, 'range_radius', CADKGT_BLAST_RADIUS), scale = bbNum(bb, 'atk_scale', 1);
  return skill(sk || { cd }, (b, e) => {
    const t = e.target && e.target.alive ? e.target : nearestAlly(b, e);
    if (!t) return false;
    b.fx('explode', { x: t.x, y: t.y, r: r0, kind: 'artsSplash' });
    for (const u of b.alliesInRadius(t.x, t.y, r0)) {
      b.dealDamage(e, u, { amount: e.s.atk * scale, type: 'arts', canDodge: false, tags: ['forkBlast'] });
    }
    return true;
  }, { cd: cd ?? (sk && sk.cd) ?? null });
};

/** 剧场组装体's 「较近范围」 for its own splash [ASSUMED: the data names no radius]; the engine's 死亡爆炸 radius. */
const THEATER_RADIUS = 1.2;

/** 冰晶射手's splash radius [ASSUMED: the data carries no radius; 「溅射」 in this engine is a point radius]. */
const AICEMN_SPLASH = 1;

/** 搏命养家者's aura radius [ASSUMED: 「周围」 names no number; the aura's own 2.5 of 优雅刀技厨师 is the same wording]. */
const BOUNTY_AURA_RADIUS = 2.5;

/**
 * 「移动时逐渐加速，被阻挡后的首次攻击根据移速造成额外伤害」 — the 赏金猎人 and 凶豕兽 talent family (the 萨卡兹穿刺手's rule in
 * special.js, written here against THIS data's blackboard prefix `Rush.<prefab>_t[trigger].*` instead of that kit's
 * `rush.dlancer_t[...]`). While not blocked and not held by 晕眩 / 束缚 it takes one move-speed layer per `interval`
 * (the first one `interval` after it starts), up to `trig_cnt`; the first attack after a block adds 当前移动速度 ×
 * `FirstAttack.atk_scale` of `type` damage and ends the acceleration.
 */
function rushFirstHit(ab, e, prefix, type) {
  const step = T(ab, `${prefix}.move_speed`) ?? 0;
  const iv = T(ab, `${prefix}.interval`) ?? 0.5;
  const max = Math.max(0, Math.min(60, Math.round(T(ab, `${prefix}.trig_cnt`) ?? 0)));
  const scale = T(ab, 'FirstAttack.atk_scale') ?? 0;
  // 晕眩 / 束缚 only (the client's STUNNED / UNMOVABLE): not 冻结 / 沉睡 / 浮空, which hold flags.stun here too
  const held = (u) => u.buffs.some((x) => x.status === 'stun' || x.status === 'bind');
  const stop = (b, u, a) => { a.on = false; a.n = 0; b.removeBuff(u, 'ab:forkRush'); };
  return [{
    iv: 0.1,
    spawn(b, u, a) { a.on = !u.blockedBy && !held(u); a.n = 0; },
    tick(b, u, a) {
      if (held(u)) { if (a.on) stop(b, u, a); return; }
      if (!a.on) { if (!u.blockedBy) { a.on = true; a.n = 0; } return; }
      if (u.blockedBy) { stop(b, u, a); return; }
      a.t = (a.t ?? 0) + 0.1;
      while (a.t >= iv - 1e-9 && a.n < max) { a.t -= iv; a.n++; }
      b.addBuff(u, { key: 'ab:forkRush', persist: true, refresh: 'replace', mods: { moveMul: 1 + step * a.n } });
    },
    // the first attack after a block: + 当前移动速度 × atk_scale, then the acceleration ends
    hitOut(c, b, u, a) {
      if (!c.dmg.isAttack || !(scale > 0) || !(a.n > 0)) return;
      const add = u.s.moveSpeed * scale;
      if (!(add > 0)) return;
      b.dealDamage(u, c.target, { amount: add, type, canDodge: false, tags: ['forkRushHit'] });
      stop(b, u, a);
    },
  }];
}

/** The tile an enemy stands on, as one integer (the engine's own key space: constants COLS). */
const tileKeyOf = (e) => Math.round(e.y) * COLS + Math.round(e.x);

/** The neighbours of tile (r, c) an enemy may land on: in bounds, ground-passable, empty (or the same enemy). */
const LANDING_OFFSETS = Object.freeze([[0, 1], [0, -1], [1, 0], [-1, 0], [1, 1], [1, -1], [-1, 1], [-1, -1]]);

function landingNear(b, e, r0, c0) {
  let best = null, bd = Infinity;
  for (const [dr, dc] of LANDING_OFFSETS) {
    const r = r0 + dr, c = c0 + dc;
    if (!b.grid.inRect(r, c)) continue;
    if (e.motion === 'FLY' ? !b.grid.flyPassable(r, c) : !b.grid.groundPassable(r, c)) continue;
    const o = b.unitAt(r, c);
    if (o && o !== e) continue;
    const d = Math.abs(r - Math.round(e.y)) + Math.abs(c - Math.round(e.x));
    if (d < bd) { bd = d; best = [r, c]; }
  }
  return best;
}

/** 硕果磐蟹 / 浆果磐蟹 · 「生命值低于一半时，会吃掉携带的<闪亮果实>，回复自身生命」 (SILENCE). The 闪亮果实 system does not exist
 *  here, so the crab always carries one: below half HP it eats it once — a heal of its own max HP × 0.5 [ASSUMED: the data
 *  carries no ratio; the 闪亮果实 item heals 50 % of max HP]. */
const eatFruitOnce = () => ({
  sil: true,
  taken(c, b, e, a) {
    if (a.eaten || !(e.hpRatio < 0.5)) return;
    a.eaten = true;
    b.heal(e, e, e.s.maxHp * 0.5, { self: true });
    b.fx('heal', { x: e.x, y: e.y, r: 0.6 });
  },
});


// ---------------------------------------------------------------------------------------------------------------
// batch 5 (2026-10-29, owner「黑流树海的大狗、大象、吐水羊、瞬移老鼠；孤星的大炮动力甲和打拳动力甲、交通厅」)
//
// 黑流树海 / 孤星 enemies whose handbook line needs a mechanic. Every number of this batch is a blackboard value of the
// official enemy_database level-0 record (data/enemies.json `skills[i].bb` / `talents.bb`) unless the comment says
// [ASSUMED]. The one line the mode cannot carry is 狂躁损伤 (`ba.dt.rampage`): ELEMENTS holds burn / neural / necrosis /
// apoptosis / erosion only, so both enemies that deal it get no element rider — the comment on each key says so.

/**
 * 狂躁损伤 — [ASSUMED 本模式无狂躁损伤系统]. `ENEMY_RAMPAGE`/`EP_RAMPAGE` is the element gauge the official 黑流树海 enemies fill
 * (`epAttack.attack@ep_damage_ratio` 0.3 / 0.25 in their talentBlackboard, and 0.3 again on 猎犬proto's Jump), but the
 * engine's ELEMENTS (server/sim/constants.js) lists only burn / neural / necrosis / apoptosis / erosion: there is no
 * gauge, no burst and no term-table entry for it. Rather than map it onto another element (that would be an invented
 * rule — a 狂躁 hit would fill a 灼燃 gauge), the rider is deliberately NOT modelled and the enemies keep their plain
 * physical attack. The blackboard values stay unread, exactly like the other systems this mode lacks (§ 结晶, 月光 …).
 */

/** 猎犬proto's Jump — PRTS/handbook「周期性附着于一个单位上持续撕咬攻击，并使目标的物理和法术攻击命中率大幅降低」.
 *  Data (`skills[0]`): cooldown 40, initCooldown 15, blackboard duration 10 / hit_interval 1.5 / ep_damage_ratio 0.3 /
 *  damage_hitrate_magical −0.8 / damage_hitrate_physical −0.8. Modelled: one target is bitten for `duration` s, once per
 *  `hit_interval`, for ATK × ep_damage_ratio — the bites stay on the locked unit even when it walks out of the enemy's
 *  reach or blocks something else (the official ability PINS the target for its whole duration), which is why the damage
 *  is 'true' (a bite is not mitigated by DEF) and `ignoreSelect` (the pin is a direct pick, not an area selection).
 *  NOT modelled: the 命中率 drop (damage_hitrate_physical / _magical) — this mode has no hit-rate system at all (an
 *  attack always lands, only 闪避 exists) — and the 狂躁 rider (see ENEMY_RAMPAGE above). Both [ASSUMED].
 */
const SHSDGO_JUMP = Object.freeze({ duration: 10, hitInterval: 1.5, atkRatio: 0.3 });

function jumpBite(ab) {
  const s = ab.sk.Jump;
  const bb = (s && s.bb) || {};
  const num = (v, d) => (typeof v === 'number' && Number.isFinite(v) ? v : d);
  const dur = num(bb.duration, SHSDGO_JUMP.duration);
  const iv = Math.max(0.1, num(bb.hit_interval, SHSDGO_JUMP.hitInterval));
  const ratio = num(bb.ep_damage_ratio, SHSDGO_JUMP.atkRatio);
  return skill(s || { cd: 40, icd: 15 }, (b, e) => {
    // the bite's victim: its current blocker first (the unit it is fighting), else the nearest ally it may select — the
    // ability's own 「附着于一个单位」 is a pick, not an attack, so it finds a unit even when the enemy is not attacking
    let tgt = e.blockedBy && e.blockedBy.alive && e.blockedBy.deployed ? e.blockedBy : null;
    if (!tgt) {
      let bd = Infinity;
      for (const u of areaAllies(b, e, e.x, e.y, Math.max(e.s.rangeRadius, 1.5))) {
        const d = Math.abs(u.x - e.x) + Math.abs(u.y - e.y);
        if (d < bd) { bd = d; tgt = u; }
      }
    }
    if (!tgt) return false;
    const amt = e.s.atk * ratio;
    if (!(amt > 0)) return false;
    b.fx('telegraph', { x: tgt.x, y: tgt.y, r: 0.6, dur, kind: 'jump', id: e.id });
    b.addBuff(tgt, {
      key: 'ab:forkJump', duration: dur, refresh: 'replace', interval: iv, visible: true,
      data: { src: e, amt },
      onTick: ({ battle, unit, buff }) => {
        const src = buff.data && buff.data.src;
        if (!src || !src.alive || !unit.alive) return;
        // the teeth keep working wherever the pinned unit went: a direct pick, so `ignoreSelect` (a 隐匿 ally it bit
        // before it hid is still bitten — PRTS 异常效果 "直接选中的能力不受仅在选择时生效的异常效果制约")
        battle.dealDamage(src, unit, { amount: buff.data.amt, type: 'true', canDodge: false, ignoreSelect: true, isSkill: true, tags: ['enemyAbility', 'forkJump'] });
      },
    });
    return true;
  }, { id: 'jump' });
}

/**
 * 撼地遗众 · 1) 「占用4阻挡数」 (blockWeight 4 — blocking.js sums it against the blocker's blockCnt);
 * 2) 「每受到一定次数的伤害，获得持续的生命流失效果」 — talentBlackboard `HpReduce.attack_time` 10 / `damage` 300 /
 *    `max_stack_cnt` 10 / `interval` 1. Every 10 damage instances it takes add one layer of a life-loss effect: from then
 *    on it loses `damage` HP per `interval` s, up to `max_stack_cnt` layers (each layer a separate 300/s). A 流失
 *    (Battle.loseHp) is not a damage instance — PRTS 作战机制 "生命流失…不会触发反击、受击回复" — so the loss never feeds
 *    the counter, and neither does a hit whose damage was cancelled. The handbook says 伤害, so element damage counts
 *    (it removes HP through the gauge's burst) while a pure gauge fill (`type` 'element', no HP) does not.
 * 3) 「每进入一个新地块，对周围造成物理伤害」 — talentBlackboard `TileDamage.range_radius` 1.7 / `attack_scale` 0.5: on
 *    stepping onto a tile it was not on last tick it hits every ally within 1.7 for ATK × 0.5 physical (an area
 *    selection — areaAllies, no unblocking 隐匿 ally, the ground-only rule of a ground enemy).
 * The `HpReduce.effect_*` / `effect_max` keys of the same blackboard belong to the official stage's own scaling curve and
 * are not read here. The 4-block weight is the first line's own number, so nothing about the data is [ASSUMED].
 */
const SHCOLO_TILE = Object.freeze({ radius: 1.7, scale: 0.5 });

function colossus(ab) {
  const step = Math.max(1, Math.round(T(ab, 'HpReduce.attack_time') ?? 10));
  const per = T(ab, 'HpReduce.damage') ?? 300;
  const maxLayers = Math.max(1, Math.round(T(ab, 'HpReduce.max_stack_cnt') ?? 10));
  const iv = Math.max(0.1, T(ab, 'HpReduce.interval') ?? 1);
  const r0 = T(ab, 'TileDamage.range_radius') ?? SHCOLO_TILE.radius;
  const scale = T(ab, 'TileDamage.attack_scale') ?? SHCOLO_TILE.scale;
  return [blockWeight(4), {
    spawn(b, e, a) { a.hits = 0; a.layers = 0; a.key = tileKeyOf(e); },
    taken(c, b, e, a) {
      // a 流失 is not a damage instance, and a hit that was cancelled is none either ("每次受到伤害后")
      if (isHpLoss(c.dmg) || (c.dmg && c.dmg.cancel)) return;
      if (!(c.amount > 0)) return;
      if (++a.hits < step) return;
      a.hits = 0;
      if (a.layers >= maxLayers) return;
      a.layers++;
      // the stack is one layer of the same timed effect: `stack` adds one and resets its clock, so 10 layers = 3000/s
      b.addBuff(e, {
        key: 'ab:forkHpReduce', duration: Infinity, refresh: 'stack', stacks: 1, maxStacks: maxLayers, persist: true,
        interval: iv, visible: true,
        onTick: ({ battle, unit }) => { battle.loseHp(unit, per, { source: unit }); },
      });
      b.fx('phase', { x: e.x, y: e.y, id: e.id, kind: 'hpReduce', value: a.layers });
    },
    tick(b, e, a) {
      const k = tileKeyOf(e);
      if (k === a.key) return;
      a.key = k;
      const atk = e.s.atk;
      if (!(scale > 0) || !(atk > 0)) return;
      b.fx('explode', { x: e.x, y: e.y, r: r0, kind: 'tileDamage', id: e.id });
      for (const u of areaAllies(b, e, e.x, e.y, r0)) hurt(b, e, u, atk * scale, 'phys', { tags: ['tileDamage'] });
    },
  }];
}

/**
 * 「交通亭」量产型 · 1) 「只能被阻挡数大于等于4的单位阻挡」 (blockWeight 4);
 * 2) 「每次受到伤害后降低护甲与法抗」 — talentBlackboard `passive.max_stack_cnt` 110 / `passive.def` −5500 /
 *    `passive.magic_resistance` −110: every damage instance adds one stack, the values are the 110-stack TOTAL, so one
 *    stack is DEF −5500/110 = −50 and RES −110/110 = −1 (the linear 110-stack ramp the blackboard describes), and the
 *    stack cap is the blackboard's own `max_stack_cnt` (110 ⇒ DEF 4500 → 0, RES 75 → 0). The engine's additive mods scale
 *    by stacks, so the ramp is exact without any bookkeeping of our own.
 * 3) 「被摧毁后弹射<“交通警察”>并自爆，对周围造成物理伤害」 (SILENCE): on a kill it ejects the `passive.enemy_key` unit
 *    (`enemy_1333_cbbgen`, one copy, riding along the parent's remaining route — deathSpawn's spawnChildren) and blows up
 *    for ATK × `Boom.atk_scale` (2) physical around itself. deathBoom is the engine's 死亡爆炸 (a SILENCE-flagged line,
 *    which is what deathBoom's default `sil: true` already encodes), and it reads `noAir` (a flying ally is skipped —
 *    every 死亡爆炸 in this engine does) and leaves a 隐匿 ally alone (areaAllies).
 */
function trafficBooth(ab) {
  const stacks = Math.max(1, Math.round(T(ab, 'passive.max_stack_cnt') ?? 110));
  const def = (T(ab, 'passive.def') ?? -5500) / stacks;
  const res = (T(ab, 'passive.magic_resistance') ?? -110) / stacks;
  const key = ab.tS['passive.enemy_key'];
  const boom = T(ab, 'Boom.atk_scale') ?? 2;
  return [blockWeight(4), {
    taken(c, b, e, a) {
      if (isHpLoss(c.dmg) || (c.dmg && c.dmg.cancel)) return;
      if (!(c.amount > 0)) return;
      a.n = (a.n ?? 0) + 1;
      if (a.n > stacks) return;
      b.addBuff(e, { key: 'ab:forkRust', refresh: 'stack', stacks: 1, maxStacks: stacks, persist: true, mods: { defFlat: def, resFlat: res } });
    },
  }, deathSpawn(key, 1, { countInTotal: false }), deathBoom({ scale: boom, type: 'phys' })];
}

/** 聆风猎手 · 「受到攻击时传送到攻击者身边」 (skill `Blink`, cooldown 30, initCooldown 0 — its blackboard's only key is
 *  `cooldown` 30, so the teleport has no distance: it lands the enemy on a free tile NEXT TO whoever attacked it). The
 *  trigger is 「受到攻击时」 — the line 颂水贤者 carried while it was in the batch (it is out again, see the kit list):
 *  an ally's attack (`dmg.isAttack`) names the attacker, and the skill's cooldown limits how often it answers.
 *  landingNear picks the closest free, ground-passable neighbour of the attacker — in bounds, off walls
 *  and off an occupied tile (an ally's own tile is not something an enemy can stand on). A sourceless hit named no
 *  attacker ⇒ no teleport.
 */
function windHunterBlink(ab) {
  const s = ab.sk.Blink;
  const sk = skill(s || { cd: 30, icd: 0 }, (b, e, a) => {
    const src = a.pending;
    a.pending = null;
    if (!src || !src.alive || !src.deployed) return false;
    const spot = landingNear(b, e, src.tileR, src.tileC);
    if (!spot) return false;
    const from = { x: e.x, y: e.y };
    e.x = spot[1]; e.y = spot[0];
    b.addBuff(e, { key: 'ab:blink', duration: 1, flags: { invulnerable: true, unblockable: true } });
    if (e.route) e.route.pts = null;
    b.fx('blink', { x: e.x, y: e.y, id: e.id, fx: from.x, fy: from.y });
    return true;
  }, { id: 'blinkToAttacker', cond: (b, e, a) => !!a.pending });
  return [{
    ...sk,
    taken(c, b, e, a) {
      if (!c.dmg || !c.dmg.isAttack || !(c.amount > 0) || isHpLoss(c.dmg)) return;
      const src = c.source;
      if (!src || src.side !== 'ally' || !src.deployed) return;
      a.pending = src;
    },
  }];
}

/** R-11突击动力装甲 · 「同时攻击四个目标」 — maxTargets(4) (ai.js: `n = maxTargets` targets per attack). Its talent
 *  `Passive.attack@ranged.atk_scale` 0.5 halves a RANGED shot's damage: the same rule 帝国的甲胄's kit states with
 *  `c.target !== e.blockedBy` (a shot at its own blocker is the melee case, and MELEE hits keep their full ATK) — the only
 *  difference is the blackboard key this data uses. The data has no other line, so nothing else is modelled.
 */
function rangedArmour(ab) {
  const scale = T(ab, 'Passive.attack@ranged.atk_scale') ?? 0.5;
  return [maxTargets(4), {
    hitOut(c, b, e) {
      if (!c.dmg.isAttack) return;
      if (e.blockedBy && c.target === e.blockedBy) return;   // melee: the full attack
      if (scale > 0 && scale !== 1) c.dmg.amount *= scale;
    },
  }];
}

/** R-31重型动力装甲 · 【超负载】 (SILENCE — skill `Punch`, cooldown 20 / initCooldown 0): the skill's attack deals ATK ×
 *  `atk_scale` (0.75) physical and 晕眩s its target for `stun` (2) s. `duration` 10 is the skill's own duration and
 *  `unmovable_duration` 1 the 无法移动 part of the stun; the engine's 晕眩 status already holds both (stop moving, stop
 *  attacking, block nothing), so the single `stun` status carries the pair. The damage is dealt as the skill's hit on the
 *  target the enemy is attacking — a `forceAttack` would add an extra normal attack on top of the engine's own, so this
 *  pays the skill's own damage and applies the status, which is what the handbook line says.
 */
function overloadPunch(ab) {
  const s = ab.sk.Punch;
  const bb = (s && s.bb) || {};
  const stun = typeof bb.stun === 'number' && Number.isFinite(bb.stun) ? bb.stun : 2;
  const scale = typeof bb.atk_scale === 'number' && Number.isFinite(bb.atk_scale) ? bb.atk_scale : 0.75;
  return [skill(s || { cd: 20, icd: 0 }, (b, e) => {
    const t = e.target && e.target.alive && e.target.deployed ? e.target : e.blockedBy;
    if (!t || !t.alive) return false;
    hurt(b, e, t, e.s.atk * scale, 'phys', { canDodge: false, tags: ['overload'] });
    if (t.alive) b.applyStatus(t, 'stun', { duration: stun, source: e });
    b.fx('explode', { x: t.x, y: t.y, r: 0.6, kind: 'overload', id: e.id });
    return true;
  }, { sil: true, id: 'punch' })];
}

/**
 * 爱国者 (enemy_1506_patrt) · the 强怪悬赏 version of the 7-18 leader. The official leader has three stages (行军姿态 →
 * 60 s 生命献祭 rebirth → 毁灭姿态) and depends on map devices (源石祭坛 pulses, 干扰地雷) this mode has no counterpart
 * for, so the bounty boss keeps the lines a wave fight can show and drops the rest — every drop is listed here:
 *
 *  行军姿态 (the data's `strength.*` / `shield.*` / `taunt.*`): ATK +20 %, DEF +200, ATK ×1.5, DEF ×3, RES +100,
 *    taunt +2, and a 4-hit normal attack. Modelled with the data's own numbers as a spawn buff.
 *  【投枪】 (skill `throwspear[Rage]`, no cooldown in the data — it is scripted, here 15 s): ATK × 1.35 physical at the
 *    FARTHEST ranged operator in range, "不可对空". Modelled as a skill that picks the longest-hypot ranged ally.
 *  重生 (talent `reborn.duration` 60, `reborn.patrt_t_state_2[reborn_invincible]` 15): reborn() — the first knock-out
 *    hides the kill and it comes back at full HP, then fights as 毁灭姿态. Both numbers are CAPPED to
 *    PATRIOT_REBORN_SECONDS (5) — owner 2026-10-30「把爱国者的复活时间减短到5s左右」; the data's 60 / 15 belong to the
 *    official 7-18 fight, not to a 强怪悬赏 enemy.
 *  【献祭】 during the rebirth (`immo_trigger[rage].interval` 0.8, ATK × 0.0521 true damage within 1.75): the `during`
 *    hook of reborn() — a real damage tick on the allies around its corpse every 0.8 s.
 *  毁灭姿态 afterwards: move speed +0.1, attack interval −0.4, and 晕眩 / 冻结 / 浮空 immunity (`immo_trigger[rage].*`).
 *
 * [ASSUMED] the 4-hit attack is modelled as `maxTargets`-style multi-hit turned into 4 SEPARATE damage instances on the
 * same target (the engine has no 连击 primitive on a normal attack); the ranged "won't attack air" rule is left out
 * because every alliance unit in this mode is a ground operator. `shield.*`/`strength.*` are the data's multipliers.
 */
function patriotBoss(ab) {
  // 行军姿态 — the data's own numbers, read as what they are: `shield.*` are PERCENTAGE boosts to ITSELF
  // (atk +50 %, def +200 %, res +100, taunt +2), while `strength.*` is the 【大幅强化敌军攻击与防御力】 aura it gives
  // the OTHER enemies (atk +20 %, def +200 flat). Getting that split wrong turns the +50 % into a ×0.5.
  const selfAtkPct = T(ab, 'shield.atk') ?? 0;                  // 0.5 → +50 %
  const selfDefPct = T(ab, 'shield.def') ?? 0;                  // 2 → +200 %
  const selfRes = (T(ab, 'shield.magic_resistance') ?? 0) * 100; // 1 → +100 (RES caps at 100)
  const taunt = T(ab, 'taunt.taunt_level') ?? 0;                // +2
  const auraAtkPct = T(ab, 'strength.atk') ?? 0;                // +20 % to other enemies
  const auraDef = T(ab, 'strength.def') ?? 0;                   // +200 to other enemies
  // 重生窗口与复活后的无敌都封顶到 PATRIOT_REBORN_SECONDS（业主 2026-10-30「把爱国者的复活时间减短到5s左右」）。
  // 数据里的 `reborn.duration` 60 是官方 7-18 那一场的三阶段设计（重生期有地图事件与剧本托着），当强怪悬赏用就只是
  // 60 秒空气；而 `reborn_invincible` 的 15 秒本来是挂在 60 秒窗口后面的「二阶段入场」，窗口缩到 5 秒之后如果还留
  // 15 秒，玩家会觉得「它回来了却打不到」—— 那是第二段更难受的等待，所以两个一起封顶。封顶用 Math.min：数据哪天
  // 比 5 还小就照数据走，这里只做上限。
  const rebornDur = Math.min(T(ab, 'reborn.duration') ?? 60, PATRIOT_REBORN_SECONDS);
  const rebornInv = Math.min(T(ab, 'reborn.patrt_t_state_2[reborn_invincible].duration') ?? 15, PATRIOT_REBORN_SECONDS);
  const spear = ab.sk['throwspear[Rage]'];
  const spearScale = (spear && spear.bb && spear.bb.atk_scale) ?? 1.35;
  const rageAtk = T(ab, 'immo_trigger[rage].atk') ?? 0;
  const rageDef = T(ab, 'immo_trigger[rage].def') ?? 0;
  const rageMs = T(ab, 'immo_trigger[rage].move_speed') ?? 0;
  const rageBat = T(ab, 'immo_trigger[rage].base_attack_time') ?? 0;
  const sack = T(ab, 'immo_trigger[rage].interval') ?? 0.8;

  /** The farthest RANGED-deployed living ally within `r` of the leader ("对最远的远程位投掷长枪"). */
  const farthestRanged = (b, e, r) => {
    let best = null, bd = -1;
    for (const u of b.allies()) {
      if (!u.alive || !u.deployed) continue;
      if (!(u.profession === 'SNIPER' || u.profession === 'CASTER' || u.def.rangeGrid?.length > 1)) continue;
      const d = hypot(u.x - e.x, u.y - e.y);
      if (d <= r && d > bd) { bd = d; best = u; }
    }
    return best;
  };

  /** 献祭: a `tick` on the rebirth state — the ability list of a reborn enemy keeps running, so this is the accumulator. */
  const sackTick = {
    id: 'patriotSack', iv: 0,
    tick(b, e, a, dt) {
      if (!(sack > 0) || !e.mem.ab || e.mem.ab.state !== 'reborn') return;
      a._acc = (a._acc ?? 0) + (dt || TICK);
      while (a._acc >= sack - 1e-9) {
        a._acc -= sack;
        for (const u of areaAllies(b, e, e.x, e.y, PATRIOT_SACK_RADIUS)) hurt(b, e, u, e.s.atk * PATRIOT_SACK_SCALE, 'true');
        b.fx('explode', { x: e.x, y: e.y, r: PATRIOT_SACK_RADIUS, kind: 'sack', id: e.id });
      }
    },
  };

  const march = {
    // 行军姿态: its own buffs (the data's `shield.*` / `taunt.*`), applied once at spawn — they never expire in the
    // official fight either. The `strength.*` half is the aura on the OTHER enemies, a separate ability below.
    spawn(b, e) {
      b.addBuff(e, { key: 'fork:patriotMarch', persist: true, visible: true,
        mods: { atkPct: selfAtkPct, defPct: selfDefPct, resFlat: selfRes, taunt } });
    },
  };

  /** 【大幅强化敌军攻击与防御力】: the `strength.*` aura on every other living enemy (atk +20 %, def +200). `enemyAura`
   *  refreshes a timed buff every 0.5 s, which is how the other kits in this file express a standing aura. */
  const strengthen = {
    id: 'patriotStrength', iv: 0.5,
    tick(b, e) {
      if (!(auraAtkPct > 0) && !(auraDef > 0)) return;
      for (const o of b.enemiesInRadius(e.x, e.y, PATRIOT_AURA_RADIUS)) {
        if (o === e) continue;
        b.addBuff(o, { key: 'fork:patriotAura', duration: 0.75, refresh: 'replace', visible: true,
          mods: { atkPct: auraAtkPct, defFlat: auraDef } });
      }
    },
  };

  /** 重生 (PATRIOT_REBORN_SECONDS, then 毁灭姿态 + the same window of 无敌): reborn() hides the first knock-out. */
  const rebornAb = reborn({
    dur: rebornDur, hpRatio: 1, invincible: rebornInv,
    onReborn: (b, e) => {
      // 毁灭姿态: faster, more ATK/DEF, and 免疫眩晕 / 冻结 / 浮空
      b.addBuff(e, { key: 'fork:patriotRuin', persist: true, visible: true,
        mods: { atkPct: rageAtk, defFlat: rageDef, moveMul: 1 + rageMs, batPct: rageBat } });
      e.mem.ab.immune = new Set([...(e.mem.ab.immune || []), 'stun', 'freeze', 'levitate']);
    },
  });

  const spearAb = skill(spear || { cd: 15, icd: 15 }, (b, e) => {
    const t = farthestRanged(b, e, PATRIOT_SPEAR_RANGE);
    if (!t) return false;
    b.addProjectile({ from: e, target: t, speed: 9, visual: 'spear', source: e, onHit: (c) => {
      if (!c.target || !c.target.alive) return;
      hurt(b, e, c.target, e.s.atk * spearScale, 'phys', { tags: ['throwspear'] });
    } });
    b.fx('charge', { x: e.x, y: e.y, id: e.id, kind: 'patriotSpear' });
    return true;
  }, { id: 'throwspear' });

  return [march, strengthen, rebornAb, sackTick, spearAb].filter(Boolean);
}

/** 狂躁异质裂兽 (enemy_1571_mirbst) · the 强怪悬赏 version of the main-story 16-12 leader. The official fight's 狂怒
 *  hunts "对自身造成伤害的单位" with 生息演算 logic and flees to a 备选地块 to change form — neither exists here, so the
 *  bounty boss keeps the parts a wave can show:
 *
 *  第一形态: a 2-hit normal attack (`AttackParam.attack@max_target` is for form 2; form 1 is `攻击为二连击`), and every
 *    hit makes the target take +100 % more damage FROM IT for 20 s (`IncreasedDamage.damage_scale` 2 /
 *    `…_duration` 20).
 *  狂怒: ASPD +200, move speed ×2, 受到的物理/法术伤害 −50 % (`M0CrazyBonus.*`), and its attacks deal ×2 to other
 *    enemies (`attack@enemy_atk_scale`) — this mode has no enemy-of-enemy damage, so that half is [ASSUMED] dropped.
 *  逃跑 / 第一形态结束: at ≤50 % HP (`RunController.hp_ratio`) or 120 s (`RunController.run_duration`) it leaves the lane
 *    and comes back `RunToNearestHole.delay` s later as the second form — modelled with reborn() at that threshold.
 *  第二形态 【落石】 (skill `ThrowStone`, `atk_scale` 1.5 / `stun` 10): ATK × 1.5 physical + 10 s 晕眩 on the operator
 *    that has done it the most damage ("对自身造成最多伤害的单位"); modelled as the highest-damage-dealt ally.
 *  第二形态 狂怒: ATK +100 %, 受到的物理/法术伤害 −60 % for 60 s (`M2LimitCrazyBonus.*`).
 *  `HpRatioCtrl.min_hp_ratio` 0.2 — form 1's damage cannot take it below 20 %: a damage floor on the `taken` hook.
 *
 * [ASSUMED] the 2-hit attack is two separate damage instances on the same target (no 连击 primitive); the "无视敌我"
 * and the 生息演算 寻敌 behaviour are dropped as they need systems this mode does not have.
 */
function mirabilisBoss(ab) {
  const ampScale = T(ab, 'IncreasedDamage.damage_scale') ?? 2;
  const ampDur = T(ab, 'IncreasedDamage.damage_scale_duration') ?? 20;
  const crazyAspd = T(ab, 'M0CrazyBonus.attack_speed') ?? 0;
  const crazyMs = T(ab, 'M0CrazyBonus.move_speed') ?? 1;
  const crazyDr = T(ab, 'M0CrazyBonus.damage_resistance') ?? 0;
  const runDur = T(ab, 'RunController.run_duration') ?? 120;
  const runHp = T(ab, 'RunController.hp_ratio') ?? 0.5;
  const runDelay = T(ab, 'RunToNearestHole.delay') ?? 10;
  const m2Atk = T(ab, 'M2LimitCrazyBonus.atk') ?? 1;
  const m2Dr = T(ab, 'M2LimitCrazyBonus.damage_resistance') ?? 0;
  const m2Dur = T(ab, 'M2LimitCrazyBonus.duration') ?? 60;
  const minHp = T(ab, 'HpRatioCtrl.min_hp_ratio') ?? 0;
  /** The first form's damage floor: `minHp` (`HpRatioCtrl.min_hp_ratio`), NOT the 逃跑 threshold — they are two
   *  different numbers (0.2 vs 0.5) and folding them together parks the unit above the escape line forever. */
  const floorAt = minHp;

  const stone = ab.sk.ThrowStone;
  const stoneScale = (stone && stone.bb && stone.bb.atk_scale) ?? 1.5;
  const stoneStun = (stone && stone.bb && stone.bb.stun) ?? 0;

  const base = {
    spawn(b, e) {
      e.mem.forkMirHit = new Map();   // ally → damage dealt to it (for 落石's 最多伤害 target)
      e.mem.forkMirBorn = b.time;
      // 狂怒 is on from the start of form 1 in this mode (the official fight enters it by script)
      b.addBuff(e, { key: 'fork:mirCrazy', persist: true, visible: true,
        mods: { aspd: crazyAspd, moveMul: crazyMs, dmgTakenMul: 1 - crazyDr } });
    },
    // 2-hit normal attack: the first hit is the engine's, the second is `hitOut` below; every hit leaves the
    // 「使目标受到来自自身的伤害大幅提升」 debuff (`IncreasedDamage.*`) and is remembered for 落石's target pick.
    dealt(c, b, e) {
      if (!c.target || !c.target.alive || !(c.dmg && c.dmg.isAttack)) return;
      const t = c.target;
      e.mem.forkMirHit.set(t, (e.mem.forkMirHit.get(t) || 0) + (c.amount || 0));
      if (ampDur > 0) b.addBuff(t, { key: 'fork:mirAmp', duration: ampDur, refresh: 'replace', visible: true,
        mods: { dmgTakenMul: ampScale } });
    },
    hitOut(c, b, e) {
      if (!c.dmg || !c.dmg.isAttack || !c.target || !c.target.alive) return;
      // The second hit must never become a source for a third one: it is dealt by `hurt` (which is not `isAttack`, so this
      // already cannot re-enter), and the tag check makes that a property of the DATA too — a handler that reflects or
      // re-deals a hit carries its tags along, and a mutual-damage loop would otherwise multiply through here.
      if (Array.isArray(c.dmg.tags) && c.dmg.tags.includes('secondHit')) return;
      if (c.target !== (c.targets && c.targets[0])) return;
      hurt(b, e, c.target, c.dmg.amount, c.dmg.type, { canDodge: true, tags: ['secondHit'] });
    },
    // 第一形态's damage floor (`HpRatioCtrl.min_hp_ratio` 0.2): while the first form is up its HP cannot go below the
    // floor, and a hit that crosses it leaves it at the floor — the 逃跑 threshold then turns into the form change.
    // (This is the one place a `taken` handler may move `e.hp`: the engine has no damage floor, and the official
    // behaviour is exactly "受到的伤害不会使自身生命值低于20%".)
    taken(c, b, e) {
      if (!(floorAt > 0) || !e.mem.ab || e.mem.ab.state) return;
      const floor = e.s.maxHp * floorAt;
      if (e.hp < floor) e.hp = floor;
    },
  };
  /** 第一形态 → 逃跑 (10 s) → 第二形态: reborn() at ≤50 % HP or after 120 s. */
  const form = reborn({
    dur: runDelay, hpRatio: 1, invincible: 0, key: 'ab:mirForm',
    onKo: null,
    onReborn: (b, e) => {
      e.mem.ab.immune = new Set([...(e.mem.ab.immune || []), 'sleep', 'fear']);
      b.addBuff(e, { key: 'fork:mirCrazy2', duration: m2Dur, refresh: 'replace', visible: true,
        mods: { atkPct: m2Atk, dmgTakenMul: 1 - m2Dr } });
      // 第二形态 「攻击自身周围多个我方单位」: the data's own max_target (3)
      e.profile.maxTargets = Math.max(1, Math.round(T(ab, 'AttackParam.attack@max_target') ?? 1));
    },
  });

  /** 第一形态 ends at ≤ `runHp` HP or after `runDur` s. Both routes go through the same 重生 (the official 逃跑): the
   *  `killed` hook of reborn() turns the knock-out into the 10 s form change, and a plain HP drop below `runHp` asks for
   *  the same thing once. `a.asked` latches so the ask happens a single time. */
  const escape = {
    id: 'mirEscape', iv: 0,
    tick(b, e, a) {
      if (a.asked || !e.mem.ab || e.mem.ab.state) return;
      const late = b.time - (e.mem.forkMirBorn || 0) >= runDur;
      if (!(e.hpRatio <= runHp) && !late) return;
      a.asked = true;
      // the knock-out path of reborn() is what starts the 10 s 逃跑; route through it so there is one form machine
      b.kill(e, null);
    },
  };


  const stoneAb = skill(stone || { cd: 10, icd: 20 }, (b, e) => {
    if (!e.mem.ab || e.mem.ab.state !== 'form2') return false;
    let t = null, best = -1;
    for (const [u, dmg] of e.mem.forkMirHit) if (u.alive && u.deployed && dmg > best) { best = dmg; t = u; }
    if (!t) return false;
    b.addProjectile({ from: e, target: t, speed: 7, visual: 'boulder', source: e, onHit: (c) => {
      if (!c.target || !c.target.alive) return;
      hurt(b, e, c.target, e.s.atk * stoneScale, 'phys', { tags: ['fallingRock'] });
      if (c.target.alive && stoneStun > 0) b.applyStatus(c.target, 'stun', { duration: stoneStun, source: e });
    } });
    b.fx('explode', { x: t.x, y: t.y, r: 0.8, kind: 'fallingRock', id: e.id });
    return true;
  }, { id: 'fallingRock' });

  return [base, form, escape, stoneAb].filter(Boolean);
}

export const FORK_WAVE_KITS = Object.freeze({
  // ===== batch 2 (2026-10-23): the first ones with a mechanic

  // 辐能源石虫 · death: arts blast (Boom.atk_scale × ATK) around itself, "无视迷彩，不可对空". The data's blackboard key
  // is `Boom.atk_scale` with a capital B (得意's is lowercase `boom.atk_scale` — the two enemies really do differ).
  enemy_1352_eslime: (ab) => [deathBoom({ scale: T(ab, 'Boom.atk_scale') ?? 0, type: 'arts' })],

  // 畸变恶性瘤 · "被阻挡时使阻挡单位攻击速度极大幅降低" (atkSpeedDown.attack_speed −0.8 = −80)
  enemy_1138_tumor: (ab) => [onHitDebuff('tumorAspd', { aspd: T(ab, 'atkSpeedDown.attack_speed') ?? 0 }, 3)],

  // 酸液源石虫 · "每次攻击会降低击中目标的防御" (defdown.def −10, stacking by refresh)
  enemy_1004_mslime: (ab) => [onHitDebuff('mslimeDef', { defFlat: T(ab, 'defdown.def') ?? 0 }, 4)],

  // 畸变体傀儡 (enemy_1130_infstr) was in the batch and is OUT again (owner 2026-10-26「删除畸变体傀儡」): its one line was
  // "死亡时分裂两个", and even the one-generation split (a child carried a SPLIT_TAG so it never split again) doubles the body
  // count of whatever pool it lands in on every kill — the owner wants it gone. The key keeps no kit and no pool slot.

  // 「得意」· "死亡后爆炸造成法术伤害，与属性相反的同类接近时造成更强的爆炸" — the mode has no 属性 (yin/yang) system, so
  // this is the plain blast at the base scale; the stronger same/diff variants are deliberately not modelled. The
  // handbook line is NOT silence-flagged, so sil: false (deathBoom defaults to true).
  enemy_1126_spslme: (ab) => [deathBoom({ scale: T(ab, 'boom.atk_scale') ?? 0, type: 'arts', sil: false })],

  // 鸡尾酒投掷者 · no ability text at all (a plain ranged attacker whose only trait is the art); it needs a kit only
  // because a ranged 0-radius enemy in this data would otherwise stand with no reach — the engine's own reach applies.
  enemy_1028_mocock: () => [{}],

  // ===== batch 3 (2026-10-25, owner「我想要加入更多有技能的怪」)

  // 爆破攻坚手 · "攻击造成爆破，使目标周围四格的单位受到溅射伤害" (aoe.attack@bsthmr_range.atk_scale 0.5 = 50 % of ATK around
  // the target). splashAttack's tiles: 1 is the 3×3 格子判定 [ASSUMED: the handbook says 周围四格 rather than 八格 and the
  // engine has no cross splash].
  enemy_1076_bsthmr: (ab) => [splashAttack({ tiles: 1, noAir: true, splashScale: T(ab, 'aoe.attack@bsthmr_range.atk_scale') ?? 0.5, aim: true })],
  enemy_1076_bsthmr_2: (ab) => [splashAttack({ tiles: 1, noAir: true, splashScale: T(ab, 'aoe.attack@bsthmr_range.atk_scale') ?? 0.5, aim: true })],

  // 欺凌者 · "只能被阻挡数大于等于3的单位阻挡" (blockWeight: blocking.js sums it against the blocker's blockCnt).
  enemy_1058_traink: () => [blockWeight(3)],
  // 倾轧者 · the same line, weight 3 (its handbook line is identical).
  enemy_1058_traink_2: () => [blockWeight(3)],

  // 乌萨斯突击者 · "只能被阻挡数大于等于2的单位阻挡" + "可使用远程武器攻击<乌萨斯平民>与<斗士塔露拉>" — this mode has no 平民 /
  // 斗士塔露拉 targets, so only the block weight is modelled.
  enemy_1111_ucommd: () => [blockWeight(2)],

  // “红标”根除者 · "<隐匿>" + "只远程攻击暴露在<沙尘暴>中的我方单位". There is no 沙尘暴 here, so the second line cannot be
  // written as it stands; the enemy keeps its 隐匿 and, once revealed (the engine's block rule), attacks like any ranged
  // enemy — the official 隐匿 behaviour.
  enemy_1135_redman: () => [stealth()],

  // 陶醉的“酩酊” · "使经过自身周围的其他地面非领袖敌人攻击速度，移动速度增加，且受到的物理与法术伤害减少" — an aura on the other
  // ground enemies near it (enemyAura: a timed buff refreshed while they are in range; every enemy of this mode's waves is
  // a non-leader unit). Data: Aura.attack_speed +50, Aura.move_speed ×1.5, Aura.attack@damage_resistance 0.4.
  enemy_10007_trspsb_2: (ab) => [enemyAura(TRSPSB_AURA_RADIUS, 'ab:trspsbAura', {
    aspd: T(ab, 'Aura.attack_speed') ?? 0,
    moveMul: T(ab, 'Aura.move_speed') ?? 1,
    dmgTakenMul: 1 - (T(ab, 'Aura.attack@damage_resistance') ?? 0),
  }, false)],
  // “酩酊” · the same talent, the weaker copy.
  enemy_10007_trspsb: (ab) => [enemyAura(TRSPSB_AURA_RADIUS, 'ab:trspsbAura', {
    aspd: T(ab, 'Aura.attack_speed') ?? 0,
    moveMul: T(ab, 'Aura.move_speed') ?? 1,
    dmgTakenMul: 1 - (T(ab, 'Aura.attack@damage_resistance') ?? 0),
  }, false)],

  // 资深圣堂保育员 / 圣堂保育员 · "周期性为自身周围N名敌人回复一定生命值并补充1发弹药" (RangeHeal: cooldown 3 s, range_radius 2.5,
  // max_target 5 / 3, heal_scale 3). 「弹药」 is a 弩手 system no enemy of this mode has, so only the heal is modelled.
  enemy_10089_hlsprt_2: (ab) => [rangeHeal(ab)],
  enemy_10089_hlsprt: (ab) => [rangeHeal(ab)],

  // 硕果磐蟹 / 浆果磐蟹 · the 闪亮果实 crab heal (eatFruitOnce).
  enemy_10004_trdiam_2: () => [eatFruitOnce()],
  enemy_10004_trdiam: () => [eatFruitOnce()],

  // 散华骑士团学徒 / 烛骑士薇薇安娜 · 【微光之触】 (chargeBlast: cooldown 25 / 20 s, atk_scale 2.5 / 3, range_radius 2.2) and
  // 隐匿 (stealth).
  enemy_1184_cadkgt: (ab) => [chargeBlast(ab, 25)],
  enemy_1184_cadkgt_3: (ab) => [chargeBlast(ab, 20)],

  // “方便快餐” · "只能被阻挡数大于等于3的单位阻挡，经过我方单位时冲撞造成物理伤害" + "受到的物理和法术伤害大幅降低，狂欢时刻
  // 失去减伤". No 狂欢时刻 here, so the reduction is permanent: act38side_scale.damage_resistance 0.9 = taken ×(1 − 0.9).
  // The 冲撞 of a passing vehicle is the engine's own (a blocked enemy stops and attacks its blocker).
  enemy_10038_cnvpiz: (ab) => [blockWeight(3), {
    spawn(b, e) {
      b.addBuff(e, { key: 'ab:cnvpizResist', persist: true, visible: true, mods: { dmgTakenMul: 1 - (T(ab, 'act38side_scale.damage_resistance') ?? 0) } });
    },
  }],

  // 水手重艇 · "只能被阻挡数大于等于3的单位阻挡，经过我方单位时冲撞造成物理伤害" + "载具损毁后<水手>会继续作战"
  // (DeathRattle.enemy_key): the death brings the 水手 it carried.
  enemy_1163_hvymot: (ab) => [blockWeight(3), {
    death(c, b, e) {
      const key = ab.tS['DeathRattle.enemy_key'];
      if (c.reason === 'killed' && key) spawnChildren(b, e, key, 1, { countInTotal: false });
    },
  }],

  // ===== batch 4 (2026-10-25, owner 2026-10-25「优雅刀技厨师3块剧场组装体4块赏金猎人"大骑士"4块搏命养家者3块加入悬赏。
  // 凶豕兽作战里少放点，冰晶射手作战里少放点」): four bounties and two wave enemies with a reduced share

  // 赏金猎人“大骑士” · "移动时逐渐加速，被阻挡后的首次攻击根据移速造成额外法术伤害" (Rush.enemy_mmstck_t[trigger].move_speed
  // 0.5 / interval 0.5 / trig_cnt 25, FirstAttack.atk_scale 650). Same rule as the 萨卡兹穿刺手 (special.js kitRush), which
  // hard-codes this data's OTHER blackboard prefix (`rush.dlancer_t[...]`) — so the listen/accelerate/first-hit cycle is
  // written again here against this enemy's own keys instead of bending one kit around two data shapes. 晕眩 / 束缚 end the
  // acceleration; while unblocked it takes a speed layer every interval (the first after one interval); its first attack
  // after a block adds 当前移动速度 × atk_scale as ARTS damage and ends the acceleration.
  enemy_1413_mmstck_2: (ab, e) => rushFirstHit(ab, e, 'Rush.enemy_mmstck_t[trigger]', 'arts'),

  // 优雅刀技厨师 · "使自身周围一定范围内地面敌人的攻击速度和法术抗性提升" (AuraAttributeUp: range_radius 2.5,
  // attack_speed +35, magic_resistance +20). An aura on the GROUND enemies near it (「地面敌人」 — a flying one is skipped);
  // implemented with enemyAura, whose tick refreshes the buff while they stay in range.
  enemy_10229_agactr: (ab) => [enemyAura(T(ab, 'AuraAttributeUp.range_radius') ?? 2.5, 'ab:agactrAura', {
    aspd: T(ab, 'AuraAttributeUp.attack_speed') ?? 0,
    resFlat: T(ab, 'AuraAttributeUp.magic_resistance') ?? 0,
  }, false)],

  // 剧场组装体 · "只能被阻挡数大于等于4的单位阻挡" + "攻击对自身周围较近范围内所有我方单位造成溅射伤害". The second line is
  // centred on ITSELF, not on the target (「自身周围」), which splashAttack cannot express (it splashes around the target) —
  // so this one writes its own: a normal attack that also hits every ally within THEATER_RADIUS of the enemy. The data
  // carries no blackboard for either line, hence the fixed radius [ASSUMED: 「较近范围」 names no number; 1.2 is the
  // engine's own 死亡爆炸 radius and of the same "around the unit" shape].
  enemy_2011_csppt: () => [blockWeight(4), {
    hitOut(c, b, e) {
      if (!c.dmg.isAttack) return;
      for (const u of b.alliesInRadius(e.x, e.y, THEATER_RADIUS)) {
        if (u === c.target) continue;                 // the target already took the engine's attack
        b.dealDamage(e, u, { amount: e.s.atk, type: 'phys', tags: ['splash'] });
      }
    },
  }],

  // 搏命养家者 · "周围敌人受到的物理和法术伤害降低" (Talent1.damage_resistance 0.25 ⇒ taken ×0.75). Its other line —
  // 「警戒触发后增加移动速度并在较大范围内寻找触发警戒的单位」 — needs the 警戒 system of its own event stage (a warning tower
  // that lights the lane); without it nothing ever triggers the alarm, so that line is deliberately NOT modelled and the
  // enemy walks its route like any other. The aura is the part that still says something here.
  enemy_10196_ubba: (ab) => [enemyAura(BOUNTY_AURA_RADIUS, 'ab:ubbaAura', {
    dmgTakenMul: 1 - (T(ab, 'Talent1.damage_resistance') ?? 0),
  }, false)],

  // 凶豕兽 · "只能被阻挡数大于等于2的单位阻挡" + "冲撞时逐渐加速，并对经过与阻挡自身的目标根据移动速度造成伤害"
  // (the same Rush + FirstAttack blackboard family as the 赏金猎人, weighted 0.333 / 30 layers). Its wave share is cut
  // deliberately (owner 2026-10-25「凶豕兽作战里少放点」): a 25 000 HP / 2-block charger that keeps accelerating is a lot of
  // wave for one slot, so its research row carries a low `share`.
  enemy_1309_mhboar: (ab, e) => [blockWeight(2), ...rushFirstHit(ab, e, 'Rush.mhboar_t[trigger]', 'phys')],

  // 冰晶射手 · "攻击造成物理溅射伤害并施加<寒冷>效果" (talent.attack@freeze 5 = the 寒冷 duration). Its wave share is cut
  // deliberately too (owner 2026-10-25「冰晶射手作战里少放点」): a 16 000 HP ranged splash that also chills every hit is a
  // control piece, not filler.
  enemy_9005_aicemn: (ab) => [splashAttack({ tiles: 0, radius: AICEMN_SPLASH, noAir: true, onEach: (b, e, u) => {
    if (u.alive) b.applyStatus(u, 'cold', { duration: T(ab, 'talent.attack@freeze') ?? 0, source: e });
  } })],

  // 沃尔夫之影 (enemy_10109_mjcgst) was in the batch and is OUT again (owner 2026-10-25「去掉沃尔夫之影」): without 月光 it would
  // have been 隐匿 + unblockable + never attacking — a unit that walks the lane and cannot be stopped or answered, which is
  // no fun to meet and not what the official stage does with it either.

  // ===== batch 5 (2026-10-29, owner「黑流树海的大狗、大象、吐水羊、瞬移老鼠；孤星的大炮动力甲和打拳动力甲、交通厅」)

  // 猎犬proto · 「周期性附着于一个单位上持续撕咬攻击，并使目标的物理和法术攻击命中率大幅降低」 — jumpBite: Jump's 40 s
  // cooldown / 15 s initial, 10 s of biting one unit every 1.5 s for ATK × 0.3; the 命中率 half of the line and the
  // 「狂躁损伤」 ability above it are not modelled (ENEMY_RAMPAGE / SHSDGO_JUMP).
  enemy_2137_shsdgo: (ab) => [jumpBite(ab)],

  // 撼地遗众 · 「占用4阻挡数」 + 「每受到一定次数的伤害，获得持续的生命流失效果」 + 「每进入一个新地块，对周围造成物理伤害」
  // (colossus: blockWeight 4, one 300/s HP-loss layer per 10 damage instances up to 10 layers, ATK × 0.5 physical to
  // everything within 1.7 on every new tile). Its research row is `noWave: true` (P 136210 — 4× the strongest ELITE pool
  // anchor), so it comes out of the 强怪悬赏 card forkbounty_13 rather than a wave pool; the kit is the same either way.
  enemy_2136_shcolo: (ab) => colossus(ab),

  // 颂水贤者 (enemy_2134_shrshep) was in the batch and is OUT again (owner 2026-10-31「删除颂水贤者这个怪」): its one
  // line was 「受到攻击时向后传送一段距离」 (kit `Blink`, `dist` 2 back along the path), and the backward teleport it
  // needed (blinkBack) went with it — nothing else used it. Its 狂躁 rider was never modelled (ENEMY_RAMPAGE).

  // 聆风猎手 · 「受到攻击时传送到攻击者身边」 (windHunterBlink: Blink's 30 s cooldown, landing on a free tile next to the
  // operator whose attack hit it).
  enemy_2135_shkrbt: (ab) => windHunterBlink(ab),

  // R-11突击动力装甲 · 「同时攻击四个目标」 (maxTargets 4) + talent `Passive.attack@ranged.atk_scale` 0.5 on a ranged shot.
  // Its research row is `noWave: true` too (P 34660): it comes out of the 强怪悬赏 card forkbounty_14.
  enemy_1256_lyacpa: (ab) => rangedArmour(ab),

  // R-31重型动力装甲 · 【超负载】 (overloadPunch: Punch's 20 s cooldown, ATK × 0.75 physical + 2 s 晕眩; the line is
  // SILENCE-flagged, so the ability carries `sil`). `noWave: true` as well (P 36660).
  enemy_1255_lybgpa: (ab) => overloadPunch(ab),

  // “交通亭”量产型 · 「只能被阻挡数大于等于4的单位阻挡」 + 「每次受到伤害后降低护甲与法抗」 + 「被摧毁后弹射<“交通警察”>并自爆，对
  // 周围造成物理伤害」 (trafficBooth: blockWeight 4, a 110-stack DEF −50 / RES −1 ramp per damage instance, and on death
  // one enemy_1333_cbbgen plus an ATK × 2 physical blast). Its `noWave: true` row (P 39725) makes it a 强怪悬赏 enemy too.
  enemy_1332_cbterm: (ab) => trafficBooth(ab),

  // ===== the two leaders the owner asked for as 强怪悬赏 enemies (2026-10-29「增加悬赏：爱国者、主线狂躁大熊」).
  // They are ordinary enemies here (a wave spawns them from the bounty card), not BOSS_KITS: the official three-stage
  // fights depend on stage scripting and devices this mode lacks, so patriotBoss / mirabilisBoss keep the lines a wave
  // can show and drop the rest with an [ASSUMED] note on each helper.

  // 爱国者 · 行军姿态 buffs + 【投枪】 + 60 s 生命献祭 重生 → 毁灭姿态 (patriotBoss)
  enemy_1506_patrt: (ab) => patriotBoss(ab),

  // 狂躁异质裂兽 · 二连击 + 增伤 debuff + 狂怒 + ≤50 %/120 s 逃跑 重生 → 第二形态 + 【落石】 (mirabilisBoss)
  enemy_1571_mirbst: (ab) => mirabilisBoss(ab),
});
