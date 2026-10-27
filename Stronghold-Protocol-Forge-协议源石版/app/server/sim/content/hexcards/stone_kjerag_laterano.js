// server/sim/content/hexcards/stone_kjerag_laterano.js — 第 7 回合（盟约专属协议）的两张卡的**战斗半边**：
// 谢拉格【冰雪消融】(hex_kjerag_thaw) 与 拉特兰【圣佑】(hex_laterano_sanctuary)。
//
// 设计稿：04-文档/协议源石-盟约专属协议-第7回合-设计稿-20261026.md §3.3 / §3.4（每张卡的原文在下面各自函数的注释里再抄一遍）。
//
// 与 drill / armor / batch16 等模块同一个 `hexHooks(battle)` 契约（见 hooks.js）：installX(hooks) 只注册 hook，
// 安装时**不改**战斗状态；每段都先用 ownersOf(<hex id>) 判断「谁拥有这张卡」，再只对**拥有者自己的、属于对应盟约的**
// 己方干员生效（多玩家场上别人的干员不算）。参数一律读卡面 effect（specOf），模块里只留设计稿口径的兜底值，方便后续调数。
//
// 确定性：没有 Math.random / Date / Node API；随机一律走 battle.rng()（这两张卡其实不需要随机）。

import { isMember, bondLayers, passiveBuff, directMods } from '../support/index.js';
import { isChained, isHpLoss, isRetaliation } from '../../damage.js';

/** 卡 id（模块自己的查表键）。 */
const CARD_KJERAG = 'hex_kjerag_thaw';
/** 卡面 effect 里那段参数的名字。 */
const SPEC_KJERAG = 'kjeragThaw';
/** 【谢拉格】核心盟约 id（成员资格 / 层数都读它）。 */
const BOND_KJERAG = 'kjeragShip';
/** 75 层被动的 passiveBuff 键（掉层时按同一个键撤销）。 */
const PASSIVE_KJERAG = 'hex:kjeragthaw';

const CARD_LATERANO = 'hex_laterano_sanctuary';
const SPEC_LATERANO = 'lateranoSanctuary';
/** 【拉特兰】核心盟约 id。 */
const BOND_LATERANO = 'lateranoShip';
/** 免死时那 1 层次数盾的 buff 键（同名刷新，最多 shieldHits 层）。 */
const SHIELD_LATERANO = 'hex:laterano:shield';

/** 共用的「卡片存在 + 包形状对」守卫：没有卡（或 hooks 不是 hexHooks 的返回对象）时是个 no-op。 */
function ownersOfCard(hooks, hexId) {
  if (!hooks || typeof hooks !== 'object') return null;
  const { battle, ownersOf } = hooks;
  if (!battle || typeof battle.on !== 'function') return null;
  if (typeof ownersOf !== 'function') return null;
  const owners = ownersOf(hexId);
  return owners && owners.length ? owners : null;
}

/** 一个干员是不是这张卡拥有者的己方**干员**（召唤物 / 队友的干员都不算）。 */
const isOwnOp = (u, owned) => !!u && u.kind === 'op' && u.side === 'ally' && owned.has(u.ownerId);

// =====================================================================================================================
// 谢拉格 ·【冰雪消融】

/**
 * 【冰雪消融】hex_kjerag_thaw（3 阶，requiresBond: kjeragShip）。
 *
 * 业主 / 设计稿原文（§3.3，逐字）：
 *   「作战中：【谢拉格】干员攻击寒冷/冻结敌人时，解除其寒冷/冻结，获得 1 层谢拉格；这次伤害提升至 130%（寒冷）/
 *    260%（冻结），并施加 40% 减速 6 秒。【谢拉格】≥75 层：【谢拉格】干员攻击力 +50%、生命值 +50%。」
 * （「获得时：获得干员【耶拉】；所有【谢拉格】干员价格 −1」是备战侧，不在这个模块里。）
 *
 * 口径：
 *   * **谁算【谢拉格】干员**：拥有者自己的己方干员，且 `isMember(battle, u, 'kjeragShip')`（support/index.js：数据
 *     bonds ∪ 装备 / 特质授予 ∪ 盟约共鸣借来的，与盟约内容同一处判据）。不额外要求盟约「已激活」——这张卡本来就只在
 *     盟约激活时才会被抽到，战斗里再判一次激活会在层数被打回 0 的瞬间把卡关掉。
 *   * **「攻击」**：`dmg.isAttack`（普攻，以及技能覆盖的那次攻击），不是卡片伤害 / 持续伤害；`isChained`（在另一次
 *     伤害结算里打出来的附加伤害）、`isRetaliation`（反伤 / 反击）、`hpLoss`（流失）、元素损伤（`type === 'element'`）
 *     都不算「攻击命中」，不吃这张卡。目标必须是活着的敌人。
 *   * **解除寒冷 / 冻结**：命中时先读状态（`findBuff('freeze')` 优先，其次 `findBuff('cold')`），再用
 *     `battle.removeStatus` 把**两个键都清掉**（引擎的友方寒冷成对转冻结时已经把 cold 摘掉，但手动挂的状态不一定；
 *     一次「解除」把残留一起清干净更贴近卡面「解除其寒冷/冻结」）。
 *   * **获得 1 层**：`battle.addLayers(pid, 'kjeragShip', layers, 'hex', { source: u })`——战斗内加层，走引擎的
 *     `layerGain` 钩子与 999 层上限；联防 / boss 场（`flags.layerGainsEnabled === false`）里引擎自己会拒绝加层，
 *     模块不另做判断。每次命中只加一次（多目标 / 多段伤害各自算各自的一次命中）。
 *   * **「这次伤害提升至 130% / 260%」**：乘在 DamageInfo 自己的 `mul` 上（引擎的每实例乘区，与 近大远小 / 你我一体
 *     同一个字段），所以是**这次结算的最终伤害** ×1.3 / ×2.6，而不是把面板攻击力改大再走一遍减伤。
 *     [ASSUMED]「提升至」按最终伤害的倍率读（不是「再额外加 130%」）。
 *   * **40% 减速 6 秒**：`applyStatus(target, 'slow', { duration: slowSec, value: slowPct / 100 })`——目录状态 `slow` 的
 *     `value` 就是速度削减比例（buffs.js：`moveMul = 1 − value`），所以 40 → 0.4。免疫 / 抵抗由引擎负责。
 *   * **75 层被动**：`passiveBuff(u, 'hex:kjeragthaw', { atkPct, hpPct })`（加算百分比，与其它加算 mod 同栈、死亡 /
 *     重部署不丢）。刷新时机：`battleStart`、`layerGain`（本卡自己加层，以及别的来源给谢拉格加层）、`deploy`（战斗
 *     中途部署的干员补装），以及模块返回的 `refresh()`（掉层撤销的入口）。层数掉回阈值以下时**撤销**那个 buff
 *     （`battle.removeBuff`），不是留一个不再刷新的旧值。
 *     [ASSUMED] 阈值判的是**当前层数**（`bondLayers`），不是「本场曾经到过 75 层」——卡面写的是「≥75 层」这个状态。
 *
 * @param {any} hooks the shared `hexHooks(battle)` bundle
 * @returns {number|{owners:number,thaws:number,refresh:Function}} 0 when the card is absent, else the live handle
 */
export function installKjeragThaw(hooks) {
  const owners = ownersOfCard(hooks, CARD_KJERAG);
  if (!owners) return 0;
  const { battle, specOf, optNumber } = hooks;
  const owned = new Set(owners);

  /** 每个拥有者的卡面参数（只读一次；数值都是设计稿口径的兜底）。 */
  const plan = new Map();
  for (const pid of owners) {
    const spec = typeof specOf === 'function' ? specOf(pid, CARD_KJERAG, SPEC_KJERAG) : {};
    const num = (k, fb) => (typeof optNumber === 'function' ? optNumber(spec, k, fb) : fb);
    plan.set(pid, {
      layers: Math.max(1, Math.round(num('layers', 5))),
      coldMul: num('coldMul', 180) / 100,
      frozenMul: num('frozenMul', 360) / 100,
      slowPct: num('slowPct', 60) / 100,
      slowSec: num('slowSec', 6),
      buffLayer: num('buffLayer', 75),
      atkPct: num('atkPct', 50) / 100,
      hpPct: num('hpPct', 50) / 100,
    });
  }

  /** 【谢拉格】干员：拥有者自己的己方干员 + 盟约成员资格。 */
  const isCarrier = (u) => isOwnOp(u, owned) && isMember(battle, u, BOND_KJERAG);

  /** 按**给定层数**给某个拥有者的谢拉格干员装 / 撤 75 层被动（idempotent：passiveBuff 同名替换）。 */
  const applyPassive = (pid, layers) => {
    const p = plan.get(pid);
    if (!p) return;
    const on = layers >= p.buffLayer;
    for (const u of battle.allyUnits) {
      if (!isCarrier(u) || u.ownerId !== pid) continue;
      if (on) passiveBuff(battle, u, PASSIVE_KJERAG, { atkPct: p.atkPct, hpPct: p.hpPct }, { tags: ['hex'] });
      else if (typeof u.findBuff === 'function' && u.findBuff(PASSIVE_KJERAG)) battle.removeBuff(u, PASSIVE_KJERAG);
    }
  };
  /** 按**当前**层数刷新（掉层撤销的入口）。 */
  const refresh = (pid = null) => {
    for (const p of owners) if (pid == null || p === pid) applyPassive(p, bondLayers(battle, p, BOND_KJERAG));
  };

  // ---- 75 层被动：battleStart / layerGain / deploy 刷新 -------------------------------------------------------------
  battle.on('battleStart', () => refresh(), { priority: -10 });
  battle.on('layerGain', (c) => {
    if (!c || c.bondId !== BOND_KJERAG || !owned.has(c.playerId)) return;
    // 加层在钩子之后才写进 ps.bonds：先按「当前 + 这一笔」的投影刷一次（同一 tick 就能吃到 75 层），
    // 再在结算后按真实层数对一次账（被 999 上限削掉的层数不会留下一个错的被动）。
    const n = Math.max(0, Number(c.n) || 0);
    applyPassive(c.playerId, bondLayers(battle, c.playerId, BOND_KJERAG) + n);
    if (typeof battle.after === 'function') battle.after(0, () => applyPassive(c.playerId, bondLayers(battle, c.playerId, BOND_KJERAG)));
  }, { priority: -100 });
  battle.on('deploy', (c) => {
    const u = c && c.unit;
    if (u && isCarrier(u)) applyPassive(u.ownerId, bondLayers(battle, u.ownerId, BOND_KJERAG));
  });

  // ---- 攻击寒冷 / 冻结的敌人：解除 → 加层 → 倍率 → 减速 ------------------------------------------------------------
  let thaws = 0;
  battle.on('hit', (c) => {
    if (!c || !c.dmg) return;
    const dmg = c.dmg;
    if (dmg.cancel) return;
    if (!dmg.isAttack) return;                       // 「攻击」：普攻 / 技能覆盖的那次攻击
    if (dmg.type === 'element') return;              // 元素损伤不是伤害
    if (isHpLoss(dmg) || isRetaliation(dmg) || isChained(dmg)) return;
    const src = c.source;
    if (!isCarrier(src) || !src.alive || !src.deployed || src.hidden) return;
    const tgt = c.target;
    if (!tgt || tgt.side !== 'enemy' || !tgt.alive) return;
    const frozen = typeof tgt.findBuff === 'function' && !!tgt.findBuff('freeze');
    const cold = !frozen && typeof tgt.findBuff === 'function' && !!tgt.findBuff('cold');
    if (!frozen && !cold) return;
    const p = plan.get(src.ownerId);
    if (!p) return;
    thaws++;
    // 1) 解除寒冷 / 冻结（两个键都清：成对转冻结之后可能还残留一个）
    battle.removeStatus(tgt, 'freeze');
    battle.removeStatus(tgt, 'cold');
    // 2) 获得 1 层谢拉格
    battle.addLayers(src.ownerId, BOND_KJERAG, p.layers, 'hex', { source: src });
    // 3) 这次伤害提升至 130%（寒冷）/ 260%（冻结）
    dmg.mul *= frozen ? p.frozenMul : p.coldMul;
    // 4) 40% 减速 6 秒（目录状态 slow 的 value = 速度削减比例）
    if (tgt.alive) battle.applyStatus(tgt, 'slow', { duration: p.slowSec, value: p.slowPct, source: src });
  });

  return {
    get owners() { return owners.length; },
    get thaws() { return thaws; },
    refresh,
  };
}

// =====================================================================================================================
// 拉特兰 ·【圣佑】

/**
 * 【圣佑】hex_laterano_sanctuary（3 阶，requiresBond: lateranoShip）。
 *
 * 设计稿原文（§3.4，逐字）：
 *   「作战中：【拉特兰】干员攻击速度 +50、攻击力 +80%；【拉特兰】干员每消耗 1 颗弹药，回复所有【拉特兰】干员
 *    5% 最大生命；消耗子弹时额外消耗 1 发；【拉特兰】干员受到致命伤害时，若仍有弹药，消耗全部弹药，
 *    免疫本次伤害，并获得 1 层次数盾。」（前两句的攻速 / 攻击力与额外消耗为业主 2026-10-27 追加）
 *
 * 口径：
 *   * **谁算【拉特兰】干员**：拥有者自己的己方干员 + `isMember(battle, u, 'lateranoShip')`（同上一张卡的成员资格判据）。
 *   * **弹药**：引擎的 `skill.ammoLeft`，消耗事件 `ammoUsed`（`{ unit, left, skill }`，skills.js
 *     `onAttackPerformed` 每发一发；一次攻击只算 1 发——引擎的普通路径就是一次一发）。
 *   * **回复 5% 最大生命**：`battle.heal(u, a, a.s.maxHp * healPct)`，对拥有者的**每一个在场拉特兰干员**（含自己）
 *     各结算一次，走正常治疗（吃治疗加成 / 禁疗规则，不额外造一套「无视禁疗」的回复）。
 *     [ASSUMED] 1)「回复…最大生命」= 各自最大生命上限的 5%，不是「治疗量的 5%」；2) 只算在场（活着、已部署、未隐匿）
 *     的拉特兰干员——被击倒的干员等重部署时按满血回来，不该被这条治疗「预存」；3) 一次 `ammoUsed` 只算 1 发（引擎的
 *     一发一事件），不是按 `left` 的差值补算。
 *   * **致命免死**：`fatal` 钩子（applyHpLoss 在 HP 归零之后、`battle.kill` 之前发出）里，若该拉特兰干员
 *     `skill.ammoLeft > 0`：`c.prevented = true`（引擎随后把 HP 抬到 1，本次伤害不再致死）、**清空弹药**（`ammoLeft = 0`，
 *     并在技能仍激活时 `skill.end('ammo')` 让它像打空弹药一样正常结束 —— 否则会留下一个「0 发仍在生效」的技能），
 *     再加 `shieldHits` 层次数盾（同名 buff 刷新，最多 shieldHits 层）。
 *     [ASSUMED] 1) 免死只认**伤害**：生命流失（`isHpLoss`，PRTS「生命流失…不会触发反伤、受击回复」）不算「受到伤害」，
 *     不免死；2) 免死不吃「这一发还剩多少伤害」—— 卡面写「免疫本次伤害」，所以整发免掉；3) 护盾是**下一次**受击才消耗
 *     （本次伤害已经结算完），这与「获得 1 层次数盾」的字面读法一致；4) 护盾不叠加到 shieldHits 层以上（同名刷新到上限）。
 *
 * @param {any} hooks the shared `hexHooks(battle)` bundle
 * @returns {number|{owners:number,heals:number,prevented:number}} 0 when the card is absent, else the live handle
 */
export function installLateranoSanctuary(hooks) {
  const owners = ownersOfCard(hooks, CARD_LATERANO);
  if (!owners) return 0;
  const { battle, specOf, optNumber } = hooks;
  const owned = new Set(owners);

  const plan = new Map();
  for (const pid of owners) {
    const spec = typeof specOf === 'function' ? specOf(pid, CARD_LATERANO, SPEC_LATERANO) : {};
    const num = (k, fb) => (typeof optNumber === 'function' ? optNumber(spec, k, fb) : fb);
    plan.set(pid, {
      healPct: num('healPct', 5) / 100,
      shieldHits: Math.max(1, Math.round(num('shieldHits', 1))),
      // 业主 2026-10-27 追加：拉特兰干员攻速 +50、攻击力 +80%
      aspd: num('aspd', 50),
      atkPct: num('atkPct', 80) / 100,
    });
  }

  const isCarrier = (u) => isOwnOp(u, owned) && isMember(battle, u, BOND_LATERANO);
  /** 拥有者的在场拉特兰干员（治疗目标 / 免死判定都只认这些）。 */
  const carriersOnField = (pid) => battle.allyUnits.filter((u) => u.ownerId === pid && isCarrier(u) && u.alive && u.deployed && !u.hidden);

  // ---- 【拉特兰】干员：攻速 +50、攻击力 +80%（业主 2026-10-27） -----------------------------------------------
  // 与谢拉格那张同一个做法：passiveBuff 按 key 覆盖（幂等），battleStart / deploy 刷新，所以后部署的干员也吃得到；
  // 成员资格仍然只看 isMember(拉特兰) —— 盟约没激活时这张卡本来也不会被抽到。
  const PASSIVE_LATERANO = 'hex:laterano:stats';
  const applyStats = (pid = null) => {
    for (const u of battle.allyUnits) {
      if (!isCarrier(u) || (pid != null && u.ownerId !== pid)) continue;
      const p = plan.get(u.ownerId);
      if (!p) continue;
      // aspd 不是「直接乘算」的那三个比例之一（directMods 只管 atk/def/hp），走它的 `extra` 合并进来
      passiveBuff(battle, u, PASSIVE_LATERANO, directMods({ atk: p.atkPct }, { aspd: p.aspd }));
    }
  };
  battle.on('battleStart', () => applyStats(), { priority: -10 });
  battle.on('deploy', (c) => { const u = c && c.unit; if (isCarrier(u)) applyStats(u.ownerId); });

  // ---- 每消耗 1 颗弹药：回复所有己方【拉特兰】干员 5% 最大生命 ------------------------------------------------
  let heals = 0;
  battle.on('ammoUsed', (c) => {
    const u = c && c.unit;
    if (!isCarrier(u)) return;
    const p = plan.get(u.ownerId);
    if (!p || !(p.healPct > 0)) return;
    heals++;
    for (const a of carriersOnField(u.ownerId)) {
      const maxHp = a.s ? a.s.maxHp : 0;
      if (!(maxHp > 0)) continue;
      battle.heal(u, a, maxHp * p.healPct, {});
    }
  });

  // ---- 消耗子弹时额外消耗 1 发（业主 2026-10-27）：弹药烧得更快 ------------------------------------------------
  // 引擎在 `emit('ammoUsed')` 之后自己判 `if (ammoLeft <= 0) end('ammo')`（skills.js），所以这里只扣数、不重复收尾；
  // 也不再补一次 `ammoUsed`（那会把治疗再算一遍、并且自己套自己）。[ASSUMED] 额外这一发**不**再触发一次「每消耗 1 颗
  // 回复 5%」—— 卡面把「额外消耗」写成代价，治疗仍按每次消耗事件结算一次。
  let extraAmmo = 0;
  battle.on('ammoUsed', (c) => {
    const u = c && c.unit;
    if (!isCarrier(u)) return;
    const sk = (c && c.skill) || u.skill;
    if (!sk || sk.kind !== 'ammo' || !(sk.ammoLeft > 0)) return;
    sk.ammoLeft -= 1;
    extraAmmo++;
  });

  // ---- 受到致命伤害时：仍有弹药 ⇒ 清空弹药、免疫本次伤害、获得 shieldHits 层次数盾 --------------------------
  let prevented = 0;
  battle.on('fatal', (c) => {
    const u = c && c.unit;
    if (!isCarrier(u) || !u.alive) return;
    if (isHpLoss(c.dmg)) return;                     // 生命流失不是「受到伤害」
    const sk = u.skill;
    if (!sk || !(sk.ammoLeft > 0)) return;           // 没有弹药就不免死
    const p = plan.get(u.ownerId);
    if (!p) return;
    prevented++;
    c.prevented = true;                              // 引擎：本次伤害不再致死（HP 抬到至少 1）
    // 消耗全部弹药：打空的那个技能像正常打完一样结束（不留一个 0 发仍在生效的技能）
    sk.ammoLeft = 0;
    if (sk.active && typeof sk.end === 'function') sk.end('ammo');
    // 1 层次数盾（同名刷新，最多 shieldHits 层；被打掉时引擎自己摘 buff）
    const cur = typeof u.findBuff === 'function' ? u.findBuff(SHIELD_LATERANO) : null;
    const have = cur && cur.shieldHits > 0 ? cur.shieldHits : 0;
    if (have < p.shieldHits) {
      battle.addBuff(u, { key: SHIELD_LATERANO, shieldHits: p.shieldHits, visible: true, refresh: 'replace', tags: ['hex'] });
    }
  });

  return {
    get owners() { return owners.length; },
    get heals() { return heals; },
    get prevented() { return prevented; },
    get extraAmmo() { return extraAmmo; },
  };
}
