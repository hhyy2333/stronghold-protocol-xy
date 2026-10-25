// server/sim/content/enemies/forkwave.js — the fork's own wave enemies with a mechanic (docs/research/16-extra-enemies.json
// batches 2 and 3, owner 2026-10-22「我需要更多小怪和精英怪」→「1」= 第二批做带技能的 → 2026-10-25「我想要加入更多有技能的怪」；
// batch 4 = 2026-10-25「优雅刀技厨师…加入悬赏。凶豕兽作战里少放点，冰晶射手作战里少放点」).
//
// Every one of them is an official enemy this repository did not carry, whose model the local client does provide
// (tools/local-extract/extract.py ENEMY_SPINES). Their numbers come from enemy_database; the mechanics below are the
// handbook's abilities written on the primitives the engine already has (deathBoom / splashAttack / blockWeight /
// stealth / enemyAura / the dealt and taken hooks …), so nothing new is invented — where a handbook line depends on a
// system this mode does not have (结晶, 装备, 狂欢时刻, 摄影区域, 月光, 沙尘暴), the enemy is left out of the batch or that line
// is deliberately not modelled, and the comment says so.
//
// Registered through KIT_FAMILIES; the keys are NOT in STATS_ONLY (enemies.js asserts one or the other, never both).

import { T, spawnChildren } from './helpers.js';
import {
  deathBoom, splashAttack, blockWeight, stealth, unblockable, enemyAura, skill,
} from './archetypes.js';


/** A normal attack that lowers the target's DEF / attack speed: the handbook's 「每次攻击会降低击中目标的防御」 /
 *  「被阻挡时使阻挡单位攻击速度极大幅降低」. The buff is refreshed on every hit and keeps the data's own value. */
const onHitDebuff = (key, mods, dur) => ({
  dealt(c, b) {
    if (!c.target || !c.target.alive || !(c.dmg && c.dmg.isAttack)) return;
    b.addBuff(c.target, { key: `fork:${key}`, duration: dur, refresh: 'replace', visible: true, mods });
  },
});

/** The tag a split child carries so it does not split again (see 畸变体傀儡 below). */
const SPLIT_TAG = 'forkSplit';

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


export const FORK_WAVE_KITS = Object.freeze({
  // ===== batch 2 (2026-10-23): the first ones with a mechanic

  // 辐能源石虫 · death: arts blast (Boom.atk_scale × ATK) around itself, "无视迷彩，不可对空". The data's blackboard key
  // is `Boom.atk_scale` with a capital B (得意's is lowercase `boom.atk_scale` — the two enemies really do differ).
  enemy_1352_eslime: (ab) => [deathBoom({ scale: T(ab, 'Boom.atk_scale') ?? 0, type: 'arts' })],

  // 畸变恶性瘤 · "被阻挡时使阻挡单位攻击速度极大幅降低" (atkSpeedDown.attack_speed −0.8 = −80)
  enemy_1138_tumor: (ab) => [onHitDebuff('tumorAspd', { aspd: T(ab, 'atkSpeedDown.attack_speed') ?? 0 }, 3)],

  // 酸液源石虫 · "每次攻击会降低击中目标的防御" (defdown.def −10, stacking by refresh)
  enemy_1004_mslime: (ab) => [onHitDebuff('mslimeDef', { defFlat: T(ab, 'defdown.def') ?? 0 }, 4)],

  // 畸变体傀儡 · "死亡时分裂两个" (deathrattle.cnt 2 of the same key, offset_bounded). The handbook flags the line
  // SILENCE, so the split is disabled while silenced (enemies.js dispatch skips a `sil` ability on a silenced unit).
  //
  // 业主 2026-10-26「畸变体绝对有bug会无限分裂」: the children are the SAME key, so they carry this same kit — every child
  // that died split into two more, forever (an unbounded enemy count; the wave could never be cleared). One generation
  // only: a child carries SPLIT_TAG and its own death hook returns at once.
  enemy_1130_infstr: (ab, e) => [{
    sil: true,
    death(c, b) {
      if (e.tag === SPLIT_TAG) return;
      const key = e.defId;
      const n = T(ab, 'deathrattle.cnt') ?? 2;
      if (c.reason === 'killed' && n > 0) spawnChildren(b, e, key, n, { countInTotal: false, tag: SPLIT_TAG });
    },
  }],

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
});
