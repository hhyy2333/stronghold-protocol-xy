// Verified skill-mode attack clips (upstream 0.3.2 "verified skill attack clips"; 0.3.1 shipped 瑕光's S2 row
// only, 0.3.2 added the other five operators and their slots). While one of these skills is on, the operator's
// normal attack plays the model's NORMAL attack role instead of the skill's cast/loop clip: the cast is what the
// skill role is for, and reading it as the swing stood them in the cast pose on every attack.
//
// Source (checked against the official client's charpack/<charId>.ab Modes and chararts/<charId>.ab DefaultSkin
// _animations, with character/skill_table and the local effects index's skills/uses):
// - 德克萨斯 (char_102_texas) S1 skcom_charge_cost / S2 skchr_texas_2: both durations 0, no mode switch; S1 is an
//   ActiveBuffAbility granting DP, S2 a MultiRangedAttack whose cast clip is Skill. The raw _animKey is empty: the
//   Default attack animator uses _oneshotAnim=Attack / _beginAnim=Attack_Begin, and DefaultSkin maps Attack ->
//   Attack_Loop, Attack_Begin -> Attack_Start.
// - 伺夜 (char_427_vigil) S1/S2: AnimatedActionToOwnerAbility casts (Skill1/2), no mode switch, _oneshotAnim=Attack.
// - 归溟幽灵鲨 (char_1023_ghost2) S1 skchr_ghost2_1: the initial switch selects mode 2 Empty (no attack at all); the
//   trigger ability starts ExchangeHp (Skill_1) and then switches to mode 3 S1, whose Attack is the normal Attack.
// - 焰影苇草 (char_1020_reed2) S2 skchr_reed2_2: Skill_2_FireBall is an AroundTargetRangedAttack with _animKey=
//   Skill_2, and S2 does not switch the mode; its Attack stays Attack. (S3 has its own hook and held loop: not here.)
// - 耀骑士临光 (char_1014_nearl2) S2 skchr_nearl2_2: AppearSkill, template nearl2_s_2 switches to mode 2, whose
//   Body/Attack is Attack_Loop; the hook replaces Die with Skill_2_Die, never Attack.
// - 瑕光 (char_423_blemsh) S2 skchr_blemsh_2: template blemsh_s_2 switches to mode S2, whose Body/Attack is Attack;
//   Skill_2 is its Sleep cast. Her S3 mode's Body/Attack is Skill_3, which stays the S3 attack.
//
// [ASSUMED] Cosmetic / plugin models use their declared normal role, and a model without it keeps the old skill
// fallback. The list is deliberately a whitelist: a legacy effects index does not export the mode animator's
// _replaceAnimPairs or the skin's _animations, so its raw animKey must not be generalized (胡摩 S2 remaps Attack to
// Skill_2_Loop, 百炼嘉维尔 S3 to Skill_3).
import { resolveSkill, skillRecordOf } from './vfx/skills.js';

/** operator charId -> { skill slot: the official prefab/skill id that slot must be } */
const NORMAL_ATTACK_SKILLS = {
  char_102_texas: { 0: 'skcom_charge_cost', 1: 'skchr_texas_2' },
  char_427_vigil: { 0: 'skchr_vigil_1', 1: 'skchr_vigil_2' },
  char_1023_ghost2: { 0: 'skchr_ghost2_1' },
  char_1020_reed2: { 1: 'skchr_reed2_2' },
  char_1014_nearl2: { 1: 'skchr_nearl2_2' },
};

/**
 * The attack clip the view should use while its skill is on, or null (keep the resolved roles).
 * `{ animKey }` names a clip of the model: 'Attack' means the model's own normal attack role, so the skin's
 * Begin/End and the facing variant are kept.
 * @param {any} index the effects index (index.json) — only 瑕光's slot-1 fallback and unverified skills read it;
 *   passing null keeps every verified mapping and still lets 瑕光 S2 through
 * @param {{ info?: any, rec?: any, skillIndex?: number }} [opts]
 * @returns {{ animKey: string }|null}
 */
export function skillAttackMode(index, { info = null, rec = null, skillIndex } = {}) {
  const charId = info?.diy?.charId || info?.spine || rec?.charId;
  if (!charId || info?.form) return null;
  const slot = Number.isInteger(skillIndex) ? skillIndex
    : Number.isInteger(info?.diy?.skillIndex) ? info.diy.skillIndex
      : Number.isInteger(info?.skillIndex) ? info.skillIndex : skillRecordOf(rec)?.index;
  const verified = NORMAL_ATTACK_SKILLS[charId]?.[slot];
  if (verified) {
    const srec = skillRecordOf(rec, slot);
    const id = srec?.prefabId || srec?.skillId;
    // [ASSUMED] A plugin's replacement skill must not inherit an official slot's mapping.
    if (id && String(id).toLowerCase().replace(/\[\d+\]$/, '') !== verified) return null;
    return { animKey: 'Attack' };
  }
  const unit = index?.units?.[charId];
  const resolved = unit ? resolveSkill(index, { info, rec, unitKey: charId, skillIndex: slot }) : null;
  // Every other verified unit keeps the pre-fix roles; only 瑕光's S2 is settled without the index.
  if (charId !== 'char_423_blemsh') return resolved?.skill ? { preserve: true } : null;
  if (slot !== 1 && slot !== 2) return null;
  if (resolved?.skill) {
    const modes = unit.modes || [];
    const mode = Number.isInteger(resolved.skill.mode) ? modes[resolved.skill.mode] : modes.find((m) => m.name === 'Default');
    if (typeof mode?.attack?.animKey === 'string' && mode.attack.animKey) return { animKey: mode.attack.animKey };
  }
  return slot === 1 ? { animKey: 'Attack' } : null;
}
