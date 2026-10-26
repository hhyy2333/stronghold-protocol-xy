// server/sim/content/hexcards/batch15b.js — 第十四批（业主 2026-10-19）后四张卡的战斗脚本。
//
// 业主原文（逐字照抄；每张卡都在各自函数的注释里再抄一遍）：
//   5. 加护（1阶）：获得装备「加护」：该干员受到自身伤害类型的伤害减少 60%。
//   6. 万物归虚（3阶）：获得装备「万物归虚」：装备时将移除备战区所有干员，战斗开始时获得「移出干员数」层
//      （20x% 攻击力，减少 30x 点受到的伤害）。
//   7. 尸山（3阶）：获得装备「尸山」：战斗开始时直接击杀其他所有干员（不可重部署）。每击杀 1 名干员，该干员便
//      获得 20% 攻击力、防御力、最大生命值、1 阻挡数、0.3 技力回复速度、5 法抗，且每秒恢复自身 3% 最大生命。
//      ——业主改版 2026-10-20：「三阶『尸山』，加成改成：获得其他干员属性（生命值，攻击力，阻挡数，防御力，法抗）和
//      技力回复+1，每秒回复1%最大生命」
//   8. 旧日之力（2阶）：干员技力消耗 +20%，伤害提升 140%。
//
// 同一个 `hexHooks(battle)` 契约；随机只用 battle.rng()，计时器只用 battle.every()。
//
// 这里只剩**卡级**效果（旧日之力）：它没有装备，玩家拥有卡就生效。发装备的四张卡（残光 / 加护 / 万物归虚 / 尸山）
// 的战斗半边已经搬进 server/sim/content/items/protocol.js —— 装备效果属于装备本身，与「谁拥有那张协议源石」无关
// （业主 2026-10-26「所有协议装备都依靠对应的协议源石生效的bug这个还没修」）。

function ownersOfCard(hooks, hexId) {
  if (!hooks || typeof hooks !== 'object') return null;
  const { battle, ownersOf } = hooks;
  if (!battle || typeof battle.on !== 'function') return null;
  if (typeof ownersOf !== 'function') return null;
  const owners = ownersOf(hexId);
  return owners && owners.length ? owners : null;
}

function pos(v, fallback) {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

/**
 * 旧日之力: 干员技力消耗 +20%，伤害提升 140%。
 *
 * 业主原文（逐字）：「干员技力消耗+20%，伤害提升140%」
 *
 * 口径：拥有者的己方干员：
 *   * 技能消耗 ×(1 + spCostPct%) —— 引擎的 `sk.spCostMul`（skills.js 的 accessor，绝技就是用它做 ×0.7）；
 *   * 造成伤害 ×dmgPct%（140% = ×1.4），用 `passiveBuff` 的 `dmgDealtMul`。
 * 两者都只对拥有者的干员生效；`deploy` 时补装（新上场的干员也要）。
 *
 * [ASSUMED: 1)「伤害提升140%」= 造成伤害 ×1.4（与玻璃大炮同一条读法）；2)「技力消耗+20%」= 技能 SP 消耗 ×1.2，
 *   对没有技能 / 不耗技力的干员无影响；3) 只作用于拥有者的己方干员，召唤物不算；4) 两个效果都是战斗内常驻，
 *   死亡 / 重部署后仍在。]
 *
 * @param {any} hooks the shared `hexHooks(battle)` bundle
 * @returns {number} 0 when the card is absent, else the number of operators it covered
 */
export function installOldPower(hooks) {
  const owners = ownersOfCard(hooks, 'hex_oldpower');
  if (!owners) return 0;
  const { battle, specOf, passivePerCopy } = hooks;
  const owned = new Set(owners);
  const spec = specOf(owners[0], 'hex_oldpower', 'oldpower');
  const spMul = 1 + pos(spec.spCostPct, 20) / 100;
  const dmgMul = pos(spec.dmgPct, 140) / 100;
  let n = 0;
  const apply = (u) => {
    if (!u || u.kind !== 'op' || u.side !== 'ally' || !owned.has(u.ownerId)) return;
    passivePerCopy(u, u.ownerId, 'hex_oldpower', 'hex:oldpower', { dmgDealtMul: dmgMul }, { tags: ['hex'] });
    // 技力消耗是 SkillSpec 上的可变字段（skills.js spCostMul）：只写一次，重复安装不会叠乘
    if (u.skill && !u.skill.hexOldPower) {
      u.skill.hexOldPower = true;
      u.skill.spCostMul = u.skill.spCostMul * spMul;
    }
    n++;
  };
  for (const u of battle.allyUnits) apply(u);
  battle.on('deploy', (c) => { if (c && c.unit) apply(c.unit); });
  return n;
}
