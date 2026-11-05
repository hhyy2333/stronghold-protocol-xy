// server/sim/content/hexcards/stone_kjerag_laterano.js — 第 7 回合（盟约专属协议）的两张卡的**战斗半边**：
// 谢拉格【冰雪消融】(hex_kjerag_thaw) 与 拉特兰【圣佑】(hex_laterano_sanctuary)。
//
// 设计稿：04-文档/协议源石-盟约专属协议-第7回合-设计稿-20261026.md §3.3 / §3.4（每张卡的原文在下面各自函数的注释里再抄一遍）。
// 【圣佑】2026-10-31 调整（04-文档/协议源石-死亡之舞与四张卡调整-设计稿-20261031.md §3.2）：弹药治疗改成弹药护盾，
// 并新增「累计子弹量每 3 秒狙击一次」。
//
// 与 drill / armor / batch16 等模块同一个 `hexHooks(battle)` 契约（见 hooks.js）：installX(hooks) 只注册 hook，
// 安装时**不改**战斗状态；每段都先用 ownersOf(<hex id>) 判断「谁拥有这张卡」，再只对**拥有者自己的、属于对应盟约的**
// 己方干员生效（多玩家场上别人的干员不算）。参数一律读卡面 effect（specOf），模块里只留设计稿口径的兜底值，方便后续调数。
//
// 确定性：没有 Math.random / Date / Node API；随机一律走 battle.rng()（圣佑的狙击用它挑目标），计时只用
// battle.every / battle.after。

import { isMember, bondLayers, passiveBuff, directMods, battleStore, addReportRow } from '../support/index.js';
import { isChained, isHpLoss, isRetaliation, makeDamageInfo } from '../../damage.js';

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
/** 每消耗 1 颗弹药给的护盾的 buff 键（同键累加；被打空后 buff 被引擎摘掉，下次重新挂）。 */
const SHIELD_AMMO = 'hex:laterano:ammoShield';
/** 狙击伤害的标签（伤害实例自己带，方便其它内容识别「这一发是圣佑的狙击」）。 */
const SNIPE_TAG = 'hex:laterano:snipe';
/** 每玩家本场累计子弹数的 per-battle store 命名空间（策略「管理员」复制出第二张卡时共享同一份计数）。 */
const STORE_NS = 'hex:laterano:sanctuary';

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
 * 卡面原文（data/hextech.json desc，2026-10-31 调整后的口径）：
 *   「仅【拉特兰】盟约激活时才会出现。作战中，【拉特兰】干员攻击速度 +50、攻击力 +80%；每消耗 1 颗弹药，所有
 *    【拉特兰】干员获得相当于自身 5% 最大生命的护盾；消耗子弹时额外消耗 1 发；【拉特兰】干员受到致命伤害时，若仍有
 *    弹药，消耗全部弹药免疫本次伤害，并获得 1 层次数盾。本场战斗累计统计【拉特兰】干员消耗的子弹量，每 3 秒对场上
 *    随机一名敌人进行一次狙击，造成累计子弹量 ×325 的物理伤害。」
 *   （攻速 / 攻击力与额外消耗为业主 2026-10-27 追加；「弹药护盾 + 累计子弹狙击」为 2026-10-31 调整，
 *    设计稿 04-文档/协议源石-死亡之舞与四张卡调整-设计稿-20261031.md §3.2。）
 *
 * 口径：
 *   * **谁算【拉特兰】干员**：拥有者自己的己方干员 + `isMember(battle, u, 'lateranoShip')`（同上一张卡的成员资格判据）。
 *   * **弹药**：引擎的 `skill.ammoLeft`，消耗事件 `ammoUsed`（`{ unit, left, skill }`，skills.js
 *     `onAttackPerformed` 每发一发；一次攻击只算 1 发——引擎的普通路径就是一次一发；能天使三技能的 5 连击、蕾缪安
 *     三技能的锁定这类 kit 也逐发 `emit`，所以一条事件 = 一颗子弹）。
 *   * **「消耗的子弹量」= 弹夹里真正少掉的子弹数**（2026-11-03 修，业主「圣佑子弹消耗未正确计算」）：本卡自己还有
 *     两个会真的扣弹夹、却不发 `ammoUsed` 的地方 —— 「额外消耗 1 发」与免死时的「消耗全部弹药」—— 它们也记进这本
 *     账（`countBullets`），所以「本场累计消耗的子弹量」与实际掉弹完全一致。修前只按 `ammoUsed` 事件记 1 次：50 发
 *     的技能打完真实花掉 50 颗，累计只到 25 颗，狙击伤害只有一半。
 *   * **弹药护盾（2026-10-31 取代原来的「回复 5% 最大生命」）**：**每条 `ammoUsed` 事件结算一次**，给拥有者的**每一个
 *     在场拉特兰干员**（含自己）挂 / 刷新同键护盾 buff `hex:laterano:ammoShield`：`shield = 现有护盾 + 自身 maxHp ×
 *     shieldPct/100`。额外那 1 发与免死清空**不**另加一份 —— 业主 2026-10-27 裁定「额外这发不再触发一次治疗」，护盾
 *     是那条口径的延续（2026-10-31 设计稿「其余部分保持不变」）。
 *     「累加」= 读该干员当前那层护盾（`findBuff(SHIELD_AMMO).shield`）再加上新的一笔；护盾被伤害打空时引擎会摘掉这个
 *     buff（damage.js `absorbShields`：`shield` 归零且没有 mods / flags / shieldHits 就 `_removeBuffAt`），于是下一次
 *     消耗从 0 重新累加 —— 「被打掉后下次照常累加」。
 *     [ASSUMED] 1)「相当于自身 5% 最大生命的护盾」= 各自**当前最大生命上限**的 5%（面板加成算完之后的 `s.maxHp`）；
 *     2) 只算在场（活着、已部署、未隐匿）的拉特兰干员——被击倒的干员等重部署时按满血回来，不该被这条护盾「预存」；
 *     3) 卡面没写护盾上限，所以不封顶；4) 护盾 buff 不 `persist`（与免死那 1 层次数盾同一口径）：干员被击倒 / 撤退时
 *     引擎只保留 persist buff，护盾随人走。
 *   * **累计子弹狙击（2026-10-31 新增）**：每消耗 1 颗子弹给该玩家本场的子弹计数 +1（per-battle store，
 *     `battleStore(battle, 'hex:laterano:sanctuary')`：策略「管理员」复制出第二张卡时共享同一份计数，不会算两遍）。
 *     `battle.every(snipeEvery)`（默认 3 秒，第一个脉冲在 t = snipeEvery）对每个拥有者：计数 > 0 且场上有活着的敌人 ⇒
 *     `battle.rng()` 随机挑一个活敌人，造成 `计数 × snipePerAmmo` 的**物理伤害**（`makeDamageInfo({ type:'phys',
 *     canDodge: true, tags: ['hex', 'hex:laterano:snipe'] })`，来源 = 该玩家第一名在场拉特兰干员 ?? null），然后计数清零。
 *     [ASSUMED] 1) 累计的「子弹量」含本卡自己造成的消耗（额外那 1 发、免死清空）—— 卡面写的是「消耗的子弹量」，
 *     这些子弹确实被消耗了（2026-11-03 修，此前只算 `ammoUsed` 事件，实际掉 50 发只记 25）；
 *     2) 场上没有活敌人时**不发射、也不清零**——累计留着，等有敌人了下一脉冲整笔打出去
 *     （卡面写「每 3 秒对场上随机一名敌人」，没有目标就无从狙击）；3) 狙击是一次普通伤害实例（`isAttack` 假）：
 *     走减伤 / 闪避 / 护盾 / 受伤统计，但不算「攻击」，所以攻击类加成与「攻击时」的内容都不认它；
 *     4) 每个拥有者各自计时（各读自己卡面的 `snipeEvery`），随机只用 `battle.rng()`。
 *   * **本局累计狙击伤害（业主 2026-11-04「给圣佑狙击的伤害也统计一个文本，像灵魂炸弹一样显示出来」）**：每发狙击把
 *     `dealDamage` 的返回值（真正落到 HP 上的伤害）累加进 per-battle store 的 `snipe`，战斗结束写进
 *     `perPlayer[pid].hexSnipeDamage` 交回对局；`server/match/player/round.js _addCumStats` 把它存成玩家计数器
 *     `hex:hex_laterano_sanctuary:snipe`，效果栏（`server/match/player/views.js`）显示成「本局累计狙击伤害：N」。
 *     纯显示，不参与规则，也不进 `resultDigest`。[ASSUMED] 数的是**实际**伤害（减伤 / 闪避 / 护盾之后，与伤害统计
 *     面板同一条口径），不是名义上的「累计子弹量 ×325」。
 *   * **致命免死**：`fatal` 钩子（applyHpLoss 在 HP 归零之后、`battle.kill` 之前发出）里，若该拉特兰干员
 *     `skill.ammoLeft > 0`：`c.prevented = true`（引擎随后把 HP 抬到 1，本次伤害不再致死）、**清空弹药**（`ammoLeft = 0`，
 *     并在技能仍激活时 `skill.end('ammo')` 让它像打空弹药一样正常结束 —— 否则会留下一个「0 发仍在生效」的技能；
 *     清掉的这些子弹记进「消耗的子弹量」，不另加护盾），再加 `shieldHits` 层次数盾（同名 buff 刷新，最多 shieldHits 层）。
 *     [ASSUMED] 1) 免死只认**伤害**：生命流失（`isHpLoss`，PRTS「生命流失…不会触发反伤、受击回复」）不算「受到伤害」，
 *     不免死；2) 免死不吃「这一发还剩多少伤害」—— 卡面写「免疫本次伤害」，所以整发免掉；3) 护盾是**下一次**受击才消耗
 *     （本次伤害已经结算完），这与「获得 1 层次数盾」的字面读法一致；4) 护盾不叠加到 shieldHits 层以上（同名刷新到上限）。
 *
 * @param {any} hooks the shared `hexHooks(battle)` bundle
 * @returns {number|{owners:number,shields:number,ammoCounted:number,pending:number,snipes:number,snipeAmount:number,snipeDamage:number,prevented:number,extraAmmo:number}}
 *          0 when the card is absent, else the live handle
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
      // 2026-10-31：弹药治疗 → 弹药护盾（自身最大生命上限的 shieldPct%）
      shieldPct: num('shieldPct', 5) / 100,
      shieldHits: Math.max(1, Math.round(num('shieldHits', 1))),
      // 业主 2026-10-27 追加：拉特兰干员攻速 +50、攻击力 +80%
      aspd: num('aspd', 50),
      atkPct: num('atkPct', 80) / 100,
      // 2026-10-31 新增：累计子弹量每 snipeEvery 秒狙击一次，伤害 = 累计 × snipePerAmmo
      snipeEvery: num('snipeEvery', 3),
      snipePerAmmo: num('snipePerAmmo', 325),
    });
  }

  const isCarrier = (u) => isOwnOp(u, owned) && isMember(battle, u, BOND_LATERANO);
  /** 拥有者的在场拉特兰干员（护盾目标 / 免死判定都只认这些）。 */
  const carriersOnField = (pid) => battle.allyUnits.filter((u) => u.ownerId === pid && isCarrier(u) && u.alive && u.deployed && !u.hidden);
  /** 伤害统计面板给一名单位用的行 key（与 `spec.js damageReport` 的 keyOf 同一个写法）。 */
  const rowKeyOf = (u) => (u.uid != null ? `u${u.uid}` : `i${u.id}`);
  /**
   * 卡面名字（伤害统计那一行用）：ref.name 就是 data/hextech.json 的「圣佑」（addHexRef 抄进效果 ref），
   * 测试手搓的 ref 也带 name；都没有时兜底用卡面名字。
   */
  const nameOf = (pid) => {
    const ps = battle.getPlayer ? battle.getPlayer(pid) : null;
    for (const ref of (ps && ps.playerEffects) || []) {
      if (ref && (ref.data?.hexId === CARD_LATERANO || ref.key === `hex:${CARD_LATERANO}`)) return String(ref.name || '圣佑');
    }
    return '圣佑';
  };

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

  // ---- 每消耗 1 颗弹药：所有在场己方【拉特兰】干员获得自身 shieldPct% 最大生命的护盾（同键累加） ------------------
  // 2026-10-31 调整：原来的「回复 5% 最大生命」整条换成护盾；累加读的是该干员**当前**那一层护盾（被打空时引擎已经把
  // buff 摘掉，于是从 0 重新加）。
  //
  // 2026-11-03 修（业主「圣佑子弹消耗未正确计算」）：「本场战斗累计统计…消耗的子弹量」数的是**子弹**，不是
  // `ammoUsed` **事件**。原来只有引擎 / kit 的 `ammoUsed` 进这本账，而这张卡自己的「额外消耗 1 发」与免死时的
  // 「消耗全部弹药」都**真的从弹夹里扣掉了子弹却不记账** ⇒ 50 发的技能打完实际花掉 50 颗，累计只到 25 颗，狙击伤害
  // （累计 ×325）只有一半。现在三个消耗点统一走 `countBullets`，累计恒等于弹夹真正少掉的子弹数。
  //
  // 刻意**不**跟着改的是护盾的结算粒度：业主 2026-10-27 明确裁定「额外这发不再触发一次治疗」（那张卡当时是治疗，
  // 2026-10-31 换成护盾时设计稿写「其余部分…保持不变」），所以护盾仍然**每条 `ammoUsed` 事件结算一次**，额外那 1 发
  // 只进「消耗的子弹量」，不另加一份护盾。卡面两句话本来也是分开写的：「每消耗 1 颗弹药 → 护盾」与「累计统计消耗的
  // 子弹量 → 狙击」。
  // playerId → 本场累计子弹数 / 本场狙击实际打出的伤害（后者只用于效果栏的「本局累计狙击伤害」，见下面的 battleEnd）
  const store = battleStore(battle, STORE_NS, () => ({ ammo: new Map(), snipe: new Map() }));
  let shields = 0;      // 走完过几次「每消耗 1 颗弹药」的护盾结算（每事件一次，不看当时场上有几名干员）
  let ammoCounted = 0;  // 本场**实际消耗掉的子弹数**（= 累计进狙击的子弹数，含额外那 1 发与免死清空的）

  /**
   * 记账：`u` 这一下真的从弹夹里少了 `n` 颗子弹 ⇒ 狙击的「累计子弹量」+n（打出去才清零）。
   * 只记狙击累计，不碰护盾 —— 护盾的粒度由业主 2026-10-27 的裁定钉在「每条 `ammoUsed` 事件一次」。
   * @param {any} u the operator that spent bullets
   * @param {number} n how many bullets actually left its clip
   */
  const countBullets = (u, n) => {
    if (!plan.has(u.ownerId)) return;
    const k = Math.floor(Number(n) || 0);
    if (!(k > 0)) return;
    store.ammo.set(u.ownerId, (store.ammo.get(u.ownerId) ?? 0) + k);
    ammoCounted += k;
  };

  /** 「每消耗 1 颗弹药」的护盾结算：给拥有者每个在场拉特兰干员各加一份自身 maxHp × shieldPct%。 */
  const giveAmmoShield = (u, p) => {
    for (const a of carriersOnField(u.ownerId)) {
      const maxHp = a.s ? a.s.maxHp : 0;
      const add = maxHp * p.shieldPct;
      if (!(add > 0)) continue;
      const cur = typeof a.findBuff === 'function' ? a.findBuff(SHIELD_AMMO) : null;
      const have = cur && Number(cur.shield) > 0 ? Number(cur.shield) : 0;
      battle.addBuff(a, { key: SHIELD_AMMO, shield: have + add, visible: true, refresh: 'replace', tags: ['hex'] });
    }
  };

  // 引擎 / kit 的每一条 `ammoUsed` 就是一颗子弹（skills.js 一发一条；能天使三技能的 5 连击、蕾缪安的锁定都是逐发
  // `emit`），所以这里记 1 颗、并结算一次护盾。
  battle.on('ammoUsed', (c) => {
    const u = c && c.unit;
    if (!isCarrier(u)) return;
    const p = plan.get(u.ownerId);
    if (!p) return;
    if (p.shieldPct > 0) {
      shields++;
      giveAmmoShield(u, p);
    }
    countBullets(u, 1);
  });

  // ---- 消耗子弹时额外消耗 1 发（业主 2026-10-27）：弹药烧得更快 ------------------------------------------------
  // 引擎在 `emit('ammoUsed')` 之后自己判 `if (ammoLeft <= 0) end('ammo')`（skills.js），所以这里只扣数、不重复收尾；
  // 也不再 `emit` 一次 `ammoUsed`（那会让引擎之外的监听者把这一发再数一遍、并且自己套自己）。扣掉的这一发是**真的
  // 消耗**，所以进「消耗的子弹量」（狙击累计）；但**不**另加一份护盾 —— 业主 2026-10-27「额外这发不再触发一次治疗」。
  let extraAmmo = 0;
  battle.on('ammoUsed', (c) => {
    const u = c && c.unit;
    if (!isCarrier(u)) return;
    const sk = (c && c.skill) || u.skill;
    if (!sk || sk.kind !== 'ammo' || !(sk.ammoLeft > 0)) return;
    sk.ammoLeft -= 1;
    extraAmmo++;
    countBullets(u, 1);
  });

  // ---- 累计子弹狙击（2026-10-31 新增）：每 snipeEvery 秒把「累计子弹量 × snipePerAmmo」打到一个随机活敌人身上 ----
  let snipes = 0;
  let snipeAmount = 0;   // 发出去的伤害量合计（不是实际掉血：可能被闪避 / 减伤 / 护盾吃掉）
  /**
   * 一个拥有者的一次狙击脉冲：计数 > 0 且场上有活敌人时，`battle.rng()` 挑一个目标、打一发、然后清零。
   * 没有活敌人时**不清零**（累计留着，下一脉冲整笔打出去）。
   * @param {string} pid the owner
   */
  const snipeOnce = (pid) => {
    const p = plan.get(pid);
    if (!p || !(p.snipePerAmmo > 0)) return;
    const n = store.ammo.get(pid) ?? 0;
    if (!(n > 0)) return;
    const targets = battle.enemies.filter((e) => e && e.alive && !e.removed);
    if (!targets.length) return;
    // 随机：只用 battle.rng()（确定性），上限夹一下防止 rng() 返回 1 时越界
    const idx = Math.min(targets.length - 1, Math.floor(battle.rng() * targets.length));
    const target = targets[idx];
    // 来源 = 该玩家第一名在场拉特兰干员（没有就是无来源）；击杀归属照常记在它身上
    const src = carriersOnField(pid)[0] ?? null;
    const amount = n * p.snipePerAmmo;
    store.ammo.set(pid, 0);
    snipes++;
    snipeAmount += amount;
    // 实际打出去的伤害（业主 2026-11-04「给圣佑狙击的伤害也统计一个文本」）：`dealDamage` 的返回值是真正落到 HP 上的
    // 那一份（减伤 / 闪避 / 护盾之后，与 `stats.dmg` / 伤害统计面板同一条口径），累计它而不是名义上的 amount ——
    // 效果栏要显示的是这张卡「打出了多少伤害」，不是「本该打多少」。`[ASSUMED]` 卡面没写口径。
    //
    // 2026-11-05：这一发在客户端是**蓝色跳字**（业主「战斗中实时对狙击伤害以蓝色数字跳字」）—— `numStyle` 只进
    // `b.ev` 的显示格，不参与任何结算。
    const absorbedBefore = src && src.stats ? Number(src.stats.absorbed) || 0 : 0;
    const dealt = battle.dealDamage(src, target, makeDamageInfo({
      amount, type: 'phys', canDodge: true, tags: ['hex', SNIPE_TAG], numStyle: 'snipe',
    }));
    const done = Number(dealt);
    if (done > 0) {
      store.snipe.set(pid, (store.snipe.get(pid) ?? 0) + done);
      // 实时伤害统计表（业主 2026-11-05「在实时伤害统计表里面添加圣佑的子弹狙击伤害」）：这一发没有「单位」可挂，
      // 所以单独记一行「圣佑」交给面板（content/support addReportRow）。面板显示时把这一笔从名义来源干员那一行里
      // 扣掉再单独成行 —— 总伤害不变，规则 / 战报 / golden 都不动。被护盾吃掉的量也一起搬过去（它记在来源的
      // `stats.absorbed` 上）。
      const absorbed = src && src.stats ? Math.max(0, (Number(src.stats.absorbed) || 0) - absorbedBefore) : 0;
      addReportRow(battle, {
        key: `hex:${CARD_LATERANO}:snipe:${pid}`,
        name: nameOf(pid),
        kind: 'hex',
        ownerId: pid,
        defId: CARD_LATERANO,
        dmg: done,
        phys: done,
        absorbed,
        // 面板从这一笔原本记在谁头上扣回去（`u<uid>` / `i<id>`，与 spec.js damageReport 的行 key 一致）。
        // 记成 per-key 的账：一场战斗里名义来源可能换人（第一名拉特兰干员阵亡后由下一名接手）。
        credit: src ? { key: rowKeyOf(src), dmg: done, absorbed } : null,
      });
    }
  };
  // 每个拥有者各自计时（各读自己卡面的 snipeEvery）：第一个脉冲在 t = snipeEvery
  for (const pid of owners) {
    const p = plan.get(pid);
    if (!p) continue;
    battle.every(p.snipeEvery, () => snipeOnce(pid));
  }

  // ---- 本局累计狙击伤害（业主 2026-11-04「给圣佑狙击的伤害也统计一个文本，像灵魂炸弹一样显示出来」） ----------------
  // 效果栏那一行「本局累计狙击伤害」读的是**对局级**的累计（跨战斗不清零），所以本场打出的这一笔要交回对局：
  // 战斗结束把每个拥有者的本场狙击伤害写进战报（`perPlayer[pid].hexSnipeDamage`，与 不屈余烬 的 indomEmber 同一个
  // 通道），由 `server/match/player/round.js _addCumStats` 存成玩家计数器。只影响显示、不参与任何规则，所以不进
  // `resultDigest`（与 creditedKills / coinsHex 同一条理由）；没有狙击的战斗不写这个字段，战报逐字节与从前相同。
  battle.on('battleEnd', ({ result }) => {
    const per = result && result.perPlayer;
    if (!per) return;
    for (const pid of owners) {
      const v = store.snipe.get(pid) ?? 0;
      if (!(v > 0)) continue;
      const pp = per[pid];
      if (!pp) continue;
      pp.hexSnipeDamage = Math.round(v);
    }
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
    // 消耗全部弹药：打空的那个技能像正常打完一样结束（不留一个 0 发仍在生效的技能）。
    // 被清空的这些子弹是**真的消耗**（卡面「消耗全部弹药」），所以记进「消耗的子弹量」（狙击累计）；
    // 同样**不**另加护盾 —— 护盾只在 `ammoUsed` 事件上结算一次（业主 2026-10-27 的粒度裁定）。
    const dumped = Math.floor(Number(sk.ammoLeft) || 0);
    sk.ammoLeft = 0;
    if (sk.active && typeof sk.end === 'function') sk.end('ammo');
    countBullets(u, dumped);
    // 1 层次数盾（同名刷新，最多 shieldHits 层；被打掉时引擎自己摘 buff）
    const cur = typeof u.findBuff === 'function' ? u.findBuff(SHIELD_LATERANO) : null;
    const have = cur && cur.shieldHits > 0 ? cur.shieldHits : 0;
    if (have < p.shieldHits) {
      battle.addBuff(u, { key: SHIELD_LATERANO, shieldHits: p.shieldHits, visible: true, refresh: 'replace', tags: ['hex'] });
    }
  });

  return {
    get owners() { return owners.length; },
    /** 走完过几次「弹药护盾」结算（每 `ammoUsed` 事件一次，不看当时场上有几名干员）。 */
    get shields() { return shields; },
    /** 本场实际消耗掉的子弹数（= 累计进狙击的子弹数，含额外那 1 发与免死清空的）。 */
    get ammoCounted() { return ammoCounted; },
    /** 每个拥有者当前还没打出去的累计子弹数。 */
    get pending() { return owners.reduce((n, pid) => n + (store.ammo.get(pid) ?? 0), 0); },
    get snipes() { return snipes; },
    get snipeAmount() { return snipeAmount; },
    /** 本场狙击**实际**打出的伤害合计（减伤 / 闪避 / 护盾之后，效果栏的「本局累计狙击伤害」数的就是它）。 */
    get snipeDamage() { return owners.reduce((n, pid) => n + (store.snipe.get(pid) ?? 0), 0); },
    get prevented() { return prevented; },
    get extraAmmo() { return extraAmmo; },
  };
}
