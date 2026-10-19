// server/sim/content/hexcards/batch15a.js — 第十四批（业主 2026-10-19）前四张卡的战斗脚本。
//
// 业主原文（逐字照抄；每张卡都在各自函数的注释里再抄一遍）：
//   1. 残光（2阶）：获得装备“残光”：装备者伤害提升至（1+30%x）。攻击时有4x%概率受到自身攻击，触发后 x 归零，x 为攻击次数。
//   2. 玻璃大炮（2阶）：伤害提升至150%，最大生命至下降至80%。
//   3. 身负重担（1阶）：攻击拥有负面状态的敌人伤害 +400*状态数。
//   4. 破伞（3阶）：干员被击中时有30%的概率免受此次伤害并对攻击方造成“此次伤害值×2”的法术伤害。
//
// 与 batch14a/14b 同一个 `hexHooks(battle)` 契约（见 hooks.js）：installX(hooks) 只注册 hook / 计时器，安装时不改
// 战斗状态；每段都先用 ownersOf(<hexId>) 判断“谁拥有这张卡”，再只对拥有者的干员生效。
//
// 确定性：随机一律走 battle.rng()，没有 Math.random / Date / Node API；计时器走 battle.every()。

import { makeDamageInfo, isRetaliation, isHpLoss } from '../../damage.js';
import { passiveBuff } from '../support/index.js';
import { carries } from '../items/battle.js';

/** 残光 的装备 key（items.json 的 chess_item_9_92_e_a strip 掉 `_a`）。 */
export const CANLIGHT_ITEM_KEY = 'chess_item_9_92_e';
/** 破伞 打出去的那一下的 tag。 */
const UMBRELLA_TAG = 'hexUmbrellaBreak';
/** 身负重担 的附加法术伤害的 tag。 */
const HEAVYLOAD_TAG = 'hexHeavyLoad';

/** 共用的“卡片存在 + 包形状对”守卫：没有卡（或 hooks 不是 hexHooks 的返回对象）时是个 no-op。 */
function ownersOfCard(hooks, hexId) {
  if (!hooks || typeof hooks !== 'object') return null;
  const { battle, ownersOf } = hooks;
  if (!battle || typeof battle.on !== 'function') return null;
  if (typeof ownersOf !== 'function') return null;
  const owners = ownersOf(hexId);
  return owners && owners.length ? owners : null;
}

/** 一个干员是不是这张卡拥有者的己方干员（多玩家场上只认自己的 ownerId）。 */
function isOwnOp(u, owned) {
  return !!u && u.kind === 'op' && u.side === 'ally' && owned.has(u.ownerId);
}

/** 数值读取：正数才算数，否则用 fallback。 */
function pos(v, fallback) {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

/**
 * 残光: 获得装备「残光」：装备者伤害提升至（1+30%x）。攻击时有 4x% 概率受到自身攻击，触发后 x 归零，x 为攻击次数。
 *
 * 业主原文（逐字）：「获得装备「残光」：装备者伤害提升至（1+30%x）。攻击时有4x%概率受到自身攻击，触发后x归零，x为攻击次数」
 *
 * 口径：x 是装备者自己本场战斗的普攻次数。每打一次：
 *   1. 先按**触发前的** x 掷一次 4x%：命中就受一次「自身攻击力」的伤害，然后把 x 归零；
 *   2. 没命中则 x += 1。
 * 伤害倍率（1 + perHitPct% × x）挂在 `hit` 钩子上改 `dmg.mul`。
 *
 * [ASSUMED: 1) 只有普攻计数，技能命中不算；2) 掷骰用触发前的 x（「触发后 x 归零」）；3) 自伤是「自身攻击力」一击，
 *   走正常减伤与闪避，不是真实伤害；4) 自伤不再触发本卡的掷骰（`canlightSelf` 标记），避免链式；5) 只对装备【残光】的干员生效。]
 *
 * @param {any} hooks the shared `hexHooks(battle)` bundle
 * @returns {number} 0 when the card is absent, else the number of carriers it installed on
 */
export function installCanlight(hooks) {
  const owners = ownersOfCard(hooks, 'hex_canlight');
  if (!owners) return 0;
  const { battle, specOf } = hooks;
  const owned = new Set(owners);
  const counts = new Map();   // unit → x (this battle's attack count)
  const perHit = () => pos(specOf(owners[0], 'hex_canlight', 'canlight').perHitPct, 30);
  const riskPer = () => pos(specOf(owners[0], 'hex_canlight', 'canlight').perHitRiskPct, 4);
  // 只有装备【残光】的己方干员算：装备决定归属（与恶魔之契同一套口径）
  const carrier = (u) => isOwnOp(u, owned) && carries(battle, u, CANLIGHT_ITEM_KEY);
  // 打出伤害：装备者的伤害 ×(1 + perHit% × x)。读的是命中瞬间的 x（计数在 attack 里已经更新过）
  battle.on('hit', (c) => {
    if (!c || !c.dmg || c.dmg.cancel) return;
    const src = c.source;
    if (!carrier(src) || !c.target || c.target.side !== 'enemy') return;
    if (c.dmg.canlightSelf) return;
    const x = counts.get(src) || 0;
    if (!(x > 0)) return;
    c.dmg.mul *= 1 + (perHit() / 100) * x;
  });
  // 每次普攻：先按旧 x 掷骰，再决定 x 是否 +1
  battle.on('attack', (c) => {
    if (!c || c.isSkill) return;
    const u = c.attacker;
    if (!carrier(u) || !u.alive) return;
    const x = counts.get(u) || 0;
    const chance = Math.max(0, Math.min(100, riskPer() * x));
    if (x > 0 && chance > 0 && battle.rng() * 100 < chance) {
      // 触发：受一次自身攻击力的伤害，x 归零
      const info = makeDamageInfo({ amount: u.s.atk, type: 'phys', canDodge: true });
      info.canlightSelf = true;
      counts.set(u, 0);
      battle.dealDamage(u, u, info);
      return;
    }
    counts.set(u, x + 1);
  });
  return [...new Set(owners)].reduce((n, pid) => n + ((hooks.opsOf ? hooks.opsOf(pid) : []) || []).length, 0);
}

/**
 * 玻璃大炮: 伤害提升至 150%，最大生命值下降至 80%。
 *
 * 业主原文（逐字）：「伤害提升至150%，最大生命至下降至80%」
 *
 * 口径：拥有者的**己方干员**（不是全场、不是敌人）：
 *   * `dmgDealtMul × dmgPct/100` —— 造成伤害的乘区；
 *   * `hpMul × hpPct/100` —— 最大生命的乘区（生命上限降下去，当前生命按比例跟着降，见 units.js 重算）。
 * 两个都用 `passiveBuff`（战斗内常驻、死亡/重部署不丢），key 固定以便重复安装幂等。
 *
 * [ASSUMED: 1) 「伤害提升至 150%」= 造成伤害 ×1.5（不是 +150%）；2) 「最大生命下降至 80%」= ×0.8；
 *   3) 只作用于拥有者的己方干员，召唤物不算；4) 生命上限下降按引擎的 hpMul 常规处理（当前生命同步缩放）。]
 *
 * @param {any} hooks the shared `hexHooks(battle)` bundle
 * @returns {number} 0 when the card is absent, else the number of operators it covered
 */
export function installGlassCannon(hooks) {
  const owners = ownersOfCard(hooks, 'hex_glasscannon');
  if (!owners) return 0;
  const { battle, specOf } = hooks;
  const owned = new Set(owners);
  const spec = specOf(owners[0], 'hex_glasscannon', 'glasscannon');
  const dmgPct = pos(spec.dmgPct, 150) / 100;
  const hpPct = pos(spec.hpPct, 80) / 100;
  let n = 0;
  const apply = (u) => {
    if (!u || u.kind !== 'op' || u.side !== 'ally' || !owned.has(u.ownerId)) return;
    passiveBuff(battle, u, 'hex:glasscannon', { dmgDealtMul: dmgPct, hpMul: hpPct }, { tags: ['hex'] });
    n++;
  };
  // 已经在场的干员立刻套上；之后再上场的（部署 / 召唤）也要
  for (const u of battle.allyUnits) apply(u);
  battle.on('deploy', (c) => { if (c && c.unit) apply(c.unit); });
  return n;
}

/**
 * 身负重担: 攻击拥有负面状态的敌人时，**额外造成 400 点法术伤害 × 状态数**。
 *
 * 业主原文（逐字）：「攻击拥有负面状态的敌人伤害+400*状态数」
 * 业主修正（2026-10-19）：「「身负重担」应该是额外造成400点法术伤害*状态数而不是400%」。
 *
 * 口径：每一次命中（`hit` 钩子）之后，看**被打的敌人**身上有几个负面状态（引擎里状态 buff 带 `status` 字段；
 * 负面状态表见本文件的 NEGATIVE_STATUSES），每有一个就打一发 **`flatDamage` 点的独立法术伤害**。
 * 这不是伤害倍率：主伤害按原样结算，额外那几发是分开的、各自走法术减伤（法抗）的实例。
 *
 * [ASSUMED: 1) 「负面状态」= 引擎状态表里的减益类（晕眩 / 冻结 / 寒冷 / 束缚 / 停顿 / 沉默 / 恐惧 / 战栗 /
 *   缴械 / 脆弱三兄弟 / 虚弱 / 攻速↓ / 防御↓ / 法抗↓ / 麻痹 / 睡眠 / 减速 …），不含增益与元素损伤槽；
 *   2) 按「状态种类数」算，不按层数（同一种状态挂多次只算一个）；3) 一次命中一发（多状态就是 one instance 里
 *   amount = flatDamage × n 的一发，而不是 n 发小的 —— 减伤对合并后的一发结算，与「每层 400 点」等价）；
 *   4) 额外伤害的来源是出手的干员（击杀与伤害统计算给它），带 `hex:heavyload` 标记不会递归。]
 *
 * @param {any} hooks the shared `hexHooks(battle)` bundle
 * @returns {number} 0 when the card is absent
 */
const NEGATIVE_STATUSES = new Set([
  'stun', 'freeze', 'cold', 'sleep', 'slow', 'sluggish', 'bind', 'silence', 'fear', 'tremble', 'disarm',
  'fragile', 'artsFragile', 'physFragile', 'elemFragile', 'weaken', 'aspdDown', 'defDown', 'resDown', 'palsy',
  'levitate', 'groundbind', 'attract',
]);

/** 一个单位身上挂着几个不同的负面状态。 */
function negativeStatusCount(u) {
  if (!u || !Array.isArray(u.buffs)) return 0;
  const seen = new Set();
  for (const b of u.buffs) {
    if (!b || !b.status) continue;
    if (!NEGATIVE_STATUSES.has(b.status)) continue;
    seen.add(b.status);
  }
  return seen.size;
}

export function installHeavyLoad(hooks) {
  const owners = ownersOfCard(hooks, 'hex_heavyload');
  if (!owners) return 0;
  const { battle, specOf } = hooks;
  const owned = new Set(owners);
  // 每层 400 点（固定值，不是百分比）
  const flat = pos(specOf(owners[0], 'hex_heavyload', 'heavyload').flatDamage, 400);
  battle.on('hit', (c) => {
    if (!c || !c.dmg || c.dmg.cancel) return;
    // 本卡自己的附加伤害不再触发本卡（否则多状态会自己滚雪球）
    if (c.dmg.heavyLoad) return;
    const src = c.source;
    if (!isOwnOp(src, owned)) return;
    const target = c.target;
    if (!target || target.side !== 'enemy' || !target.alive) return;
    const n = negativeStatusCount(target);
    if (!(n > 0)) return;
    const amount = flat * n;
    const info = makeDamageInfo({ amount, type: 'arts', isSkill: true, canDodge: false, tags: [HEAVYLOAD_TAG] });
    info.heavyLoad = true;
    battle.dealDamage(src, target, info);
  });
  return [...new Set(owners)].reduce((n, pid) => n + ((hooks.opsOf ? hooks.opsOf(pid) : []) || []).length, 0);
}

/**
 * 破伞: 干员被击中时有 30% 的概率免受此次伤害，并对攻击方造成「此次伤害值 × 2」的法术伤害。
 *
 * 业主原文（逐字）：「干员被击中时有30%的概率免受此次伤害并对攻击方造成「此次伤害值×2」的法术伤害」
 *
 * 口径：`hit` 钩子是官方「被击中」的时点（damage.js：命中判定之后、闪避与减伤之前）。掷 30%：
 *   * 命中 → `dmg.cancel = true`（这一下完全不算，连减伤/护盾都不走），再对 source 打一发法术伤害，
 *     数值 = 这一下**本该造成**的伤害 × 2。但被取消时 pipeline 已经不会再算最终伤害，所以这里按
 *     `dmg.amount × atkScale` 估一个「此次伤害值」（见下 ASSUMED）；
 *   * 那发反击带 tag / `hexUmbrella` 标记，不会反过来再触发本卡（也不触发反伤链）。
 *
 * [ASSUMED: 1) 「此次伤害值」在取消之后拿不到最终值，这里用 DamageInfo 的 `amount × atkScale`（攻击力轴），
 *   不含防御/法抗减免 —— 原文的「此次伤害值」更像面板伤害，这是引擎能给出的一手近似；2) 只有拥有者的己方干员
 *   （kind 'op'）受保护，召唤物不算；3) 流失 / 元素损伤 / 反伤不算「被击中」；4) 反击是法术伤害、来源是受击干员
 *   （击杀与伤害统计算给它）；5) 反击本身不再被本卡取消（不会互相弹）。]
 *
 * @param {any} hooks the shared `hexHooks(battle)` bundle
 * @returns {number} 0 when the card is absent, else the number of negations so far (a live tally handle)
 */
export function installUmbrellaBreak(hooks) {
  const owners = ownersOfCard(hooks, 'hex_umbrellabreak');
  if (!owners) return 0;
  const { battle, specOf } = hooks;
  const owned = new Set(owners);
  const spec = specOf(owners[0], 'hex_umbrellabreak', 'umbrellabreak');
  const chance = Math.max(0, Math.min(100, pos(spec.chance, 30)));
  const reflectMul = pos(spec.reflectMul, 200) / 100;
  let negated = 0;
  battle.on('hit', (c) => {
    if (!c || !c.dmg || c.dmg.cancel) return;
    const dmg = c.dmg;
    // 流失 / 元素损伤 / 反伤 / 本卡自己的反击都不是「被击中」
    if (isHpLoss(dmg) || dmg.type === 'element' || isRetaliation(dmg)) return;
    if (dmg.hexUmbrella) return;
    const target = c.target;
    if (!isOwnOp(target, owned)) return;
    if (!target.alive || !target.deployed) return;
    if (battle.rng() * 100 >= chance) return;
    // 「此次伤害值」：取消后拿不到最终值，用面板轴（amount × atkScale）
    const dealt = Math.max(0, Number(dmg.amount) || 0) * (Number(dmg.atkScale) || 1) * (Number(dmg.mul) || 1);
    dmg.cancel = true;
    negated++;
    const src = c.source;
    if (!src || !src.alive || src.removed) return;
    const amount = dealt * reflectMul;
    if (!(amount > 0)) return;
    const info = makeDamageInfo({ amount, type: 'arts', isSkill: true, tags: [UMBRELLA_TAG] });
    info.hexUmbrella = true;
    battle.dealDamage(target, src, info);
  });
  return { get negated() { return negated; }, get owners() { return owners.length; } };
}

