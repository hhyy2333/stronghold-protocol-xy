// server/sim/content/enemies/forkwave.js — the fork's own wave enemies with a mechanic (docs/research/16-extra-enemies.json
// batch 2, owner 2026-10-22「我需要更多小怪和精英怪」→「1」= 第二批做带技能的).
//
// Every one of them is an official enemy this repository did not carry, whose model the local client does provide
// (tools/local-extract/extract.py ENEMY_SPINES). Their numbers come from enemy_database; the mechanics below are the
// handbook's abilities written on the primitives the engine already has (deathBoom / spawnChildren / onHitStatus / the
// `dealt` hook), so nothing new is invented — where a handbook line depends on a system this mode does not have
// (结晶, 装备, 狂欢时刻, 摄影区域), the enemy is left out of the batch instead of being shipped half-working.
//
// Registered through KIT_FAMILIES; the keys also leave STATS_ONLY (enemies.js asserts one or the other, never both).

import { T, spawnChildren } from './helpers.js';
import { deathBoom } from './archetypes.js';

/** A normal attack that lowers the target's DEF / attack speed: the handbook's 「每次攻击会降低击中目标的防御」 /
 *  「被阻挡时使阻挡单位攻击速度极大幅降低」. The buff is refreshed on every hit and keeps the data's own value. */
const onHitDebuff = (key, mods, dur) => ({
  dealt(c, b) {
    if (!c.target || !c.target.alive || !(c.dmg && c.dmg.isAttack)) return;
    b.addBuff(c.target, { key: `fork:${key}`, duration: dur, refresh: 'replace', visible: true, mods });
  },
});

export const FORK_WAVE_KITS = Object.freeze({
  // 辐能源石虫 · death: arts blast (Boom.atk_scale × ATK) around itself, "无视迷彩，不可对空". The data's blackboard key
  // is `Boom.atk_scale` with a capital B (得意's is lowercase `boom.atk_scale` — the two enemies really do differ).
  enemy_1352_eslime: (ab) => [deathBoom({ scale: T(ab, 'Boom.atk_scale') ?? 0, type: 'arts' })],

  // 畸变恶性瘤 · "被阻挡时使阻挡单位攻击速度极大幅降低" (atkSpeedDown.attack_speed −0.8 = −80)
  enemy_1138_tumor: (ab) => [onHitDebuff('tumorAspd', { aspd: T(ab, 'atkSpeedDown.attack_speed') ?? 0 }, 3)],

  // 酸液源石虫 · "每次攻击会降低击中目标的防御" (defdown.def −10, stacking by refresh)
  enemy_1004_mslime: (ab) => [onHitDebuff('mslimeDef', { defFlat: T(ab, 'defdown.def') ?? 0 }, 4)],

  // 畸变体傀儡 · "死亡时分裂两个" (deathrattle.cnt 2 of the same key, offset_bounded). The handbook flags the line
  // SILENCE, so the split is disabled while silenced (enemies.js dispatch skips a `sil` ability on a silenced unit).
  enemy_1130_infstr: (ab, e) => [{
    sil: true,
    death(c, b) {
      const key = e.defId;
      const n = T(ab, 'deathrattle.cnt') ?? 2;
      if (c.reason === 'killed' && n > 0) spawnChildren(b, e, key, n, { countInTotal: false });
    },
  }],

  // 「得意」· "死亡后爆炸造成法术伤害，与属性相反的同类接近时造成更强的爆炸" — the mode has no 属性 (yin/yang) system, so
  // this is the plain blast at the base scale; the stronger same/diff variants are deliberately not modelled. The
  // handbook line is NOT silence-flagged, so `sil: false` (deathBoom defaults to true).
  enemy_1126_spslme: (ab) => [deathBoom({ scale: T(ab, 'boom.atk_scale') ?? 0, type: 'arts', sil: false })],

  // 鸡尾酒投掷者 · no ability text at all (a plain ranged attacker whose only trait is the art); it needs a kit only
  // because a ranged 0-radius enemy in this data would otherwise stand with no reach — the engine's own reach applies.
  enemy_1028_mocock: () => [{}],
});
