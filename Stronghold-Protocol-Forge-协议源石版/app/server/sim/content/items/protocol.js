// server/sim/content/items/protocol.js — the battle side of the remake's OWN equipment: the seven 协议源石 items
// (data/items.json `chess_item_9_9x`, tools/build-data.mjs CUSTOM_ITEMS). 幽魂 (9_90) lives in items/battle.js next to
// the other 55 items; the six below are here because they were moved out of the card scripts.
//
// WHY they are ITEM behaviours (业主 2026-10-26「所有协议装备都依靠对应的协议源石生效的bug这个还没修」): their battle
// half used to sit in the CARD's script (server/sim/content/hexcards/batch15a.js / batch15b.js / heartsteel.js) and found
// its carriers through `ownersOf('<hex id>')` — so an item only worked for a player who happened to own the matching
// 协议源石. Every other source hands the equipment out WITHOUT the card — 神器整备 (hex_artifactkit) grants 加护 / 残光 /
// one random 3阶 piece, the workshop and the test panel grant the rest — and for those players the equipment was dead.
//
// An equipment effect belongs to the equipment: installed on an operator it runs, card or no card. The card keeps only
// what the CARD says (getting the item, 恶魔形态's prep takeover, …).
//
// Numbers come from the concrete record's `params` (data/items.json); the documented defaults in each behaviour are for
// a record that predates a field (and are the values the cards' own specs carried).
//
// Every behaviour has the BY_ITEM shape `(battle, u, rec, S, grant)` (see items/battle.js): it registers through the
// grant's Scope `S`, so a lend that ends disposes it again. Determinism: no Math.random / Date / Node API; rolls go
// through `battle.rng()` and timers through `S.every` / `battle.every`.

import { makeDamageInfo, isChained, isHpLoss, mitigate } from '../../damage.js';
import { num, itemKeyOf, itemsOf, isMember, battleStore } from '../support/index.js';
// 骑士徽章 (业主 2026-10-26)：三个互相独立的半边（转移 / 真伤 ×3 / 致命锁血）单独一个模块，见该文件头。
import { knightBadge } from './knightbadge.js';
import { ITEM_LAYER_SOURCES } from '../../../../shared/battleBounds.js';

/** Positive number, else the documented default (a 0 / a missing field means "not configured"). */
const pos = (v, d) => { const n = Number(v); return Number.isFinite(n) && n > 0 ? n : d; };
/** Non-negative number, else the default — 0 is a legal value (a 0 % cut, a 0 s cooldown). */
const nonNeg = (v, d) => { const n = Number(v); return Number.isFinite(n) && n >= 0 ? n : d; };
const paramsOf = (rec) => (rec && rec.params && typeof rec.params === 'object' ? rec.params : {});

// =====================================================================================================================
// 恶魔之契 (9_91) — 协议源石【恶魔形态】's equipment
//
// 卡面（data/items.json）：「装备者在作战中每秒攻击力 +10%（本场战斗内叠加，无上限）」。「恶魔之契（该装备同时具有【变形
// 同构体】效果）」，变形同构体那一半由装备记录自己的字段给出，与这里无关。
//
// 口径与卡脚本时期相同（业主 2026-10-13「如果像幽魂形态一样给个装备来决定对谁生效就好了」）：只有**装备者**成长，每秒
// 一层、本场无上限；被击倒期间不涨（`alive` 那道门），已得的层数保留（persist / allowDead）。从前这条是 battle 级的
// `for (const pid of ownersOf('hex_demonform'))`，于是「没有这张卡 ⇒ 装备不涨」—— 业主 2026-10-26 报的就是这个。

/**
 * 恶魔之契: the carrier gains `params.atkPctPerSec`% ATK every second for the whole battle, uncapped.
 * @param {any} battle @param {any} u the carrier @param {any} rec its item record @param {any} S the grant Scope
 */
function demonPact(battle, u, rec, S) {
  const perSec = pos(paramsOf(rec).atkPctPerSec, 10) / 100;
  S.every(1, () => {
    if (!u.alive) return;
    battle.addBuff(u, {
      key: 'item:demonpact', refresh: 'stack', stacks: 1, maxStacks: 100000,
      mods: { atkPct: perSec }, persist: true, allowDead: true, visible: true, tags: ['item'],
    });
  });
}

// =====================================================================================================================
// 残光 (9_92) — 协议源石【残光】's equipment
//
// 业主原文（逐字）：「获得装备「残光」：装备者伤害提升至（1+30%x）。攻击时有4x%概率受到自身攻击，触发后x归零，x为
// 攻击次数」。
//
// 口径（与卡脚本时期逐条相同，`[ASSUMED]` 原样保留）：
//   * x 是**装备者自己**本场战斗的普攻次数（技能命中不算）；
//   * 每打一次：先按**触发前的** x 掷一次 4x% —— 命中就受一次「自身攻击力」的伤害，然后把 x 归零；没命中则 x += 1；
//   * 伤害倍率（1 + perHitPct% × x）挂在 `hit` 上改 `dmg.mul`，读的是命中瞬间的 x。
//   * **致命锁血**（业主 2026-10-31 追加；data/items.json 的 desc：「装备者受到致命伤害时锁血 5 秒（每场一次）」）：
//     装备者**本人**每场战斗一次 —— 第一次受到致命伤害时 `c.prevented = true`（引擎把 HP 抬到 ≥1，damage.js
//     applyHpLoss），并开一个 `battle.time + lockSec` 的窗口；窗口内再受致命伤只免死（**不重复计数、不延长窗口**，
//     否则 1 点血上会被每一击续成无限锁血）；窗口结束后正常阵亡，本场不再开第二个窗口。锁血期间不额外治疗 —— HP 由
//     引擎留在 1 点（与【骑士徽章】同一条口径）。生命流失不是「受到伤害」，不免死。
//
// [ASSUMED: 1) 只有普攻计数，技能命中不算；2) 掷骰用触发前的 x（「触发后 x 归零」）；3) 自伤是「自身攻击力」一击，
//   走正常减伤与闪避，不是真实伤害；4) 自伤不再触发本装备的掷骰（`canlightSelf` 标记），避免链式；5) x 只属于装着
//   这件装备的干员 —— 没有装备者就没有任何效果；6) 锁血只保护装备者自己（`c.unit === u`），`c.prevented` 已为真
//   （别人先免死了这一发）时不消耗本装备的窗口；7) 锁血**不**因再部署刷新（卡面只写「每场一次」，与【骑士徽章】的
//   「再部署刷新锁血」不同）。]

/**
 * 残光: the carrier's damage becomes ×(1 + perHitPct% × x); every normal attack rolls 4x% for a self-hit that resets x.
 * @param {any} battle @param {any} u the carrier @param {any} rec its item record @param {any} S the grant Scope
 */
function canlight(battle, u, rec, S) {
  const p = paramsOf(rec);
  const perHit = pos(p.perHitPct, 30) / 100;
  const riskPer = pos(p.perHitRiskPct, 4);
  const lockSec = pos(p.lockSec, 5);
  /** x — this battle's NORMAL attack count of THIS carrier. */
  let x = 0;
  /** 致命锁血的窗口终点（battle time）与「本场已用过」标记 —— 每名装备者各自一份。 */
  let lockUntil = -Infinity;
  let lockUsed = false;
  // 打出伤害：装备者的伤害 ×(1 + perHit% × x)。读的是命中瞬间的 x（计数在 attack 里已经更新过）
  S.on('hit', (c) => {
    if (!c || !c.dmg || c.dmg.cancel) return;
    if (c.source !== u || !c.target || c.target.side !== 'enemy') return;
    if (c.dmg.canlightSelf) return;
    if (!(x > 0)) return;
    c.dmg.mul *= 1 + perHit * x;
  });
  // 每次普攻：先按旧 x 掷骰，再决定 x 是否 +1
  S.on('attack', (c) => {
    if (!c || c.isSkill || c.attacker !== u || !u.alive) return;
    const chance = Math.max(0, Math.min(100, riskPer * x));
    if (x > 0 && chance > 0 && battle.rng() * 100 < chance) {
      // 触发：受一次自身攻击力的伤害，x 归零
      const info = makeDamageInfo({ amount: u.s.atk, type: 'phys', canDodge: true });
      info.canlightSelf = true;
      x = 0;
      battle.dealDamage(u, u, info);
      return;
    }
    x += 1;
  });
  // 致命锁血：每场一次，窗口内再致命只免死（业主 2026-10-31；引擎在 applyHpLoss 里把 HP 抬回 ≥1）
  S.on('fatal', (c) => {
    if (!c || c.prevented) return;                 // 别人已经免死过这一发：不消耗本装备的窗口
    if (c.unit !== u) return;                      // 「装备者受到致命伤害时」——只保护装备者自己
    if (isHpLoss(c.dmg)) return;                   // 生命流失不是「受到伤害」（PRTS 作战机制）
    if (battle.time < lockUntil) { c.prevented = true; return; }   // 窗口内：只免死，不续窗口
    if (lockUsed) return;                          // 本场已经用过：正常阵亡，不再开第二个窗口
    lockUsed = true;
    lockUntil = battle.time + lockSec;
    c.prevented = true;
  });
}

// =====================================================================================================================
// 加护 (9_93) — 协议源石【加护】's equipment
//
// 业主原文（逐字）：「获得装备「加护」：该干员收到自身伤害类型的伤害减少60%」。
//
// 口径：装备者的 `dmgType`（物理 / 法术）就是「自身伤害类型」；在 `hit` 上，如果这一下的 `dmg.type` 与它相同，给这次
// 伤害 ×(1 − cutPct/100)。用 `hit` 而不是 `physTakenMul` / `artsTakenMul`，是因为原文是「这一次伤害减少 60%」；`hit`
// 上改 `dmg.mul` 只影响本实例。
//
// [ASSUMED: 1)「自身伤害类型」= 该干员的普攻类型（units.js `dmgType`），物理干员吃物理减伤、法术干员吃法术减伤；
//   2) 真实伤害 / 元素伤害 / 流失不算「与自身伤害类型相同」；3) 减伤是乘算 ×0.4（不是减法），且与其它减伤乘区叠加；
//   4) 只有装着【加护】的干员受保护。]

/**
 * 加护: a hit of the carrier's own damage type is reduced by `params.cutPct`%.
 * @param {any} battle @param {any} u the carrier @param {any} rec its item record @param {any} S the grant Scope
 */
function warding(battle, u, rec, S) {
  const cut = Math.max(0, Math.min(100, pos(paramsOf(rec).cutPct, 60))) / 100;
  S.on('hit', (c) => {
    if (!c || !c.dmg || c.dmg.cancel) return;
    if (c.target !== u) return;
    const own = u.dmgType;
    if (own !== 'phys' && own !== 'arts') return;
    if (c.dmg.type !== own) return;
    c.dmg.mul *= 1 - cut;
  });
}

// =====================================================================================================================
// 万物归虚 (9_94) — 协议源石【万物归虚】's equipment
//
// 业主原文（逐字）：「获得装备「万物归虚」效果为装备时 将移除备战区所有干员，战斗开始时获得「移出干员数」层
// （20x%攻击力，减少30x点收到的伤害）」。
//
// 两个半边，现在都属于这件装备：
//   * **装备时**（备战期）：「移除备战区所有干员」—— 见 server/match/hextech.js applyVoidReturnLayers。它把移除的人数
//     记在**这件装备的 piece** 上（`state[id].voidLayers`，可累计），不再写卡片的 ref；
//   * **战斗开始时**：装备者按层数拿到 `+atkPctPerLayer% × 层数` 攻击力，以及 `−dmgCutPerLayer × 层数` 的**固定**受伤
//     减免（每层减少固定的点数，不是百分比）。层数由 server/match/player/round.js `battleInput` 展开装备时带进战斗输入
//     （`unit.itemState[id]`），server/sim/battle/players.js 拷到 `u.itemState`。
//
// 固定减免的实现：`hit` 上算这一下「本该造成多少」（mitigate 之后的最终值），再把它压到 `max(0, 本该造成 − 减免)`；用
// `dmg.mul` 乘一个比例来表达（`mul × (after/before)`），这样不会破坏其它乘区，也不会把一次伤害变成负数。
//
// [ASSUMED: 1) 层数来自「装备时移除的备战区干员数」，记在装备自己的 piece 上（融合成【百变】时两件的 state 合并）；
//   2) 减免是每一击的固定值（不是每层百分比减伤），且不会让伤害低于 0；3) 元素损伤不是「受到的伤害」，不减免；
//   4) 没有层数（没移除过任何干员）就没有加成。]

/** The layer count the match banked on the equipment piece this grant belongs to (0 when it was never equipped). */
function voidLayersOf(u, itemId) {
  const st = u && u.itemState ? u.itemState[itemId] : null;
  const n = st ? Number(st.voidLayers) : 0;
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 0;
}

/**
 * 万物归虚: +atkPctPerLayer% ATK per banked layer, and −dmgCutPerLayer flat damage taken per layer.
 * @param {any} battle @param {any} u the carrier @param {any} rec its item record @param {any} S the grant Scope
 */
function voidReturn(battle, u, rec, S) {
  const p = paramsOf(rec);
  const atkPer = pos(p.atkPctPerLayer, 20) / 100;
  const cutPer = pos(p.dmgCutPerLayer, 30);
  const layers = voidLayersOf(u, rec.id);
  if (!(layers > 0)) return;
  S.stat('layers', { atkPct: atkPer * layers }, { tags: ['item'] });
  const cut = cutPer * layers;
  S.on('hit', (c) => {
    if (!c || !c.dmg || c.dmg.cancel) return;
    if (c.target !== u) return;
    const dmg = c.dmg;
    if (dmg.type === 'element') return;
    // 「本该造成的伤害」：按当前 mul 与实际减伤后的值估算，再把固定减免折成 mul 的比例
    const before = mitigate(dmg.amount, dmg.type === 'true' ? 'true' : dmg.type, u.s, {
      defIgnorePct: dmg.defIgnorePct, defIgnoreFlat: dmg.defIgnoreFlat,
      resIgnorePct: dmg.resIgnorePct, resIgnoreFlat: dmg.resIgnoreFlat,
    });
    if (!(before > 0)) return;
    const after = Math.max(0, before - cut);
    dmg.mul *= after / before;
  });
}

// =====================================================================================================================
// 尸山 (9_95 / 9_95_e_b 尸山·极) — 协议源石【尸山】's equipment
//
// 业主原文（逐字）：初版「获得装备「尸山」：战斗开始时直接击杀其他所有干员（不可重部署）。每击杀1名干员，该干员便获得
// 20%攻击力，防御力，最大生命值，1阻挡数，0.3技力回复速度，5法抗。且每秒恢复自身3%最大生命」；
// 改版（2026-10-20）「三阶『尸山』，加成改成：获得其他干员属性（生命值，攻击力，阻挡数，防御力，法抗）和技力回复+1，
// 每秒回复1%最大生命」。
//
// 口径（与卡脚本时期逐条相同）：`battleStart` 时，装备者的**其他己方干员**全部被击杀（`retreat(permanent: true)` ——
// 击杀而不是「倒下」，「不可重部署」）；然后装备者把他们的属性**逐项累加**到自己身上：
//   * 生命值 → `hpFlat`（加在基础值上，随百分比一起放大）；攻击力 → `atkFinal`（**最终加算**，与阿戈尔盟约的「吞噬」
//     同一条口径）；防御力 → `defFlat`；阻挡数 → `blockCnt`；法抗 → `resFlat`；
//   * 技力回复 +N → `spRecoveryFlat`；每秒恢复 N% 最大生命 → `hpRegenRatio`。后两项是**固定值，全场只算一次**（业主
//     2026-10-20 选定：不随击杀数放大）。
// 数值全部读**装备自己的 params**（`attrScale` / `spRecovery` / `regenPct`）：合成后的 尸山·极 是另一条记录，于是
// 「击杀队友获得属性×1.5，技力+2，回血2%/s」（业主 2026-10-25）不需要第二条代码路径。
//
// [ASSUMED: 1)「其他所有干员」= **装备者同一玩家**（`ownerId` 相同）的其他己方干员；联防 / boss 双人场上队友的干员
//   不算（业主「尸山在联防和打 boss 时会吞掉队友的干员」）；召唤物不算；2)「直接击杀」用永久退场，因此不能再部署；
//   3)「获得其他干员属性」读的是**基础面板**（`unit.base`，不含装备与增益），与「吞噬」同一条口径；4) 生命值是
//   `hpFlat`（吃百分比），攻击力是 `atkFinal`（不吃百分比）；5)「技力回复+N」「每秒N%」是定值、不叠加；
//   6) 每个装备者各自结算；没有其他干员时什么都不做。]

/**
 * 尸山: at battle start the carrier eats every other own operator (permanent), gaining their base stats.
 * @param {any} battle @param {any} u the carrier @param {any} rec its item record @param {any} S the grant Scope
 */
function corpseHill(battle, u, rec, S) {
  const p = paramsOf(rec);
  const scale = pos(p.attrScale, 1);
  const spRec = nonNeg(p.spRecovery, 1);
  const regenPct = nonNeg(p.regenPct, 1) / 100;
  /** An explicit guard: the pool below includes already-dead units, so "nobody to eat" is not a reliable idempotency
   *  signal when a repeat battleStart is emitted. */
  let eaten = false;
  S.on('battleStart', () => {
    if (eaten || !u.alive) return;
    // 业主 2026-10-22「协议『尸山』的装备『尸山』联防不生效」：联防把**自己那场已经倒下的干员**按 `carryState.down`
    // 送进来 —— 到 battleStart 时它们 `alive === false`，但对象还在 `allyUnits` 里。所以属性从**所有还在场的己方干员**
    // （含已经倒下的）累加，只对还活着的执行击杀。联防 / boss 双人场的 `allyUnits` 装的是**两个玩家**的棋盘，只认
    // `ownerId === u.ownerId` 才是「己方干员」—— 队友的干员不执行击杀，属性也不吃。
    const others = battle.allyUnits.filter((a) => a !== u && a.kind === 'op' && a.side === 'ally'
      && a.ownerId === u.ownerId && !a.removed);
    if (!others.length) return;
    eaten = true;
    // 先把属性读下来 —— retreat 之后单位还活着，但读 base 更稳，也避免任何收尾逻辑改字段
    let hp = 0, atk = 0, def = 0, block = 0, res = 0;
    for (const a of others) {
      hp += num(a.base?.maxHp, 0);
      atk += num(a.base?.atk, 0);
      def += num(a.base?.def, 0);
      block += num(a.base?.blockCnt, 0);
      res += num(a.base?.res, 0);
    }
    if (scale !== 1) { hp *= scale; atk *= scale; def *= scale; block *= scale; res *= scale; }
    for (const a of others) {
      if (!a.alive) continue;   // 已经倒下的（联防的 down）：不再执行一次，但它的基础属性照样被吞掉
      battle.retreat(a, { reason: 'corpsehill', permanent: true });
    }
    const mods = {};
    if (hp > 0) mods.hpFlat = hp;
    if (atk > 0) mods.atkFinal = atk;   // 最终加算，与「吞噬」一致
    if (def > 0) mods.defFlat = def;
    if (block > 0) mods.blockCnt = block;
    if (res > 0) mods.resFlat = res;
    if (Object.keys(mods).length) S.stat('eat', mods, { tags: ['item'] });
    const extra = {};
    if (spRec > 0) extra.spRecoveryFlat = spRec;
    if (regenPct > 0) extra.hpRegenRatio = regenPct;
    if (Object.keys(extra).length) S.stat('regen', extra, { tags: ['item'] });
  });
}

// =====================================================================================================================
// 心之钢 (9_96) — 协议源石【心之钢】's equipment
//
// 卡面（data/items.json）：「携带者视为【坚守】盟约成员；坚守盟约干员每隔 3 秒的攻击附带自身最大生命值 100% 的法术
// 伤害，并增加自身最大生命值 150 点、【坚守】层数 2 层」。
//
// `grantsBonds: ['steadShip']` 是「携带者视为坚守盟约成员」那一条（shared/morph.js memberBonds —— 备战期计数、战斗的
// unitBonds 与客户端的盟约条都读这一条）。战斗这一半是**玩家级**的：只要这个玩家有一名干员装备着心之钢，他的所有
// 【坚守】干员就吃到（与卡脚本时期相同的口径；携带者自己由 grantsBonds 算成坚守成员）。
//   * 每 `every` 秒（每个干员各自冷却，挂在它下一次**普攻**上）一次额外法术伤害 = 当前最大生命值的 `dmgMaxHpPct`%；
//   * +`maxHpGain` 最大生命（本场永久，`hpFlat` 叠层）；
//   * +`layerGain` 【坚守】层（IN_BATTLE 层，由 settle() 落成持久层）。
// 那发伤害是独立实例（不折进 `dmg.mul`）：闪避取消不了它，也不会回头触发「攻击时」的卡；`isChained` 挡住别的
// 「造成伤害时」内容喂回来。
//
// 一个玩家只装**一个** hook（`battleStore` 幂等标记）：两名干员同时装备心之钢不会双倍触发；hook 每次现查「这个玩家
// 还有装备者吗」，所以装备被卖掉 / 借出到期之后它自己就哑了。
//
// [ASSUMED: 1) 触发条件是「玩家有一名干员装备着心之钢」，不是「触发者本人装备着」（卡面写的是『坚守盟约干员』，装备只是
//   让某个干员成为坚守成员）；2) 装备者被击倒不影响（装备还在他身上）；3) 记录里没有数字时用卡面默认 3 s / 100% /
//   150 / 2（data/items.json 的 params 是空的，数值写在卡面文字里）。]

const HEARTSTEEL_KEY = 'chess_item_9_96_e';
/**
 * Card-face defaults for a record whose `params` carries no numbers.
 * `every` / `layerGain` come from `shared/battleBounds.js` on purpose: the result validator budgets this equipment's
 * in-battle layer gain from the SAME numbers (server/match/fields.js `itemLayerAllowance`), and two copies of them is
 * exactly how an honest battle gets rejected as a forger ('layer bound') after a rebalance.
 */
const HEARTSTEEL_DEFAULT = Object.freeze({
  every: ITEM_LAYER_SOURCES[HEARTSTEEL_KEY].every, dmgMaxHpPct: 100, maxHpGain: 150,
  layerGain: ITEM_LAYER_SOURCES[HEARTSTEEL_KEY].layers,
});
/** The bond whose members the equipment marks and this behaviour buffs. */
const HEARTSTEEL_BOND = 'steadShip';
/** The buff carrying the battle-long max-HP growth (additive `hpFlat` per stack). */
const HEARTSTEEL_MAXHP_KEY = 'item:heartsteel:maxhp';

/** Does `pid` still field an operator wearing 心之钢 (own equipment — a lend is not the player's own board)? */
function heartsteelCarried(battle, pid) {
  for (const a of battle.allyUnits) {
    if (!a || a.kind !== 'op' || a.side !== 'ally' || a.ownerId !== pid || a.removed) continue;
    for (const id of itemsOf(a)) if (itemKeyOf(id) === HEARTSTEEL_KEY) return true;
  }
  return false;
}

/**
 * 心之钢: every 坚守 operator of a player with a carrier procs an extra max-HP arts hit, +max HP and +坚守 layers.
 * The hook is battle-level (one per PLAYER), so this behaviour registers nothing on the grant's Scope — the Scope arg
 * is only the BY_ITEM signature and stays unused here.
 * @param {any} battle @param {any} u the carrier @param {any} rec its item record @param {any} _S the grant Scope (unused)
 */
function heartsteel(battle, u, rec, _S) {
  const pid = u.ownerId;
  if (pid == null) return;
  const p = paramsOf(rec);
  const every = pos(p.every, HEARTSTEEL_DEFAULT.every);
  const dmgPct = nonNeg(p.dmgMaxHpPct, HEARTSTEEL_DEFAULT.dmgMaxHpPct);
  const maxHpGain = pos(p.maxHpGain, HEARTSTEEL_DEFAULT.maxHpGain);
  const layerGain = pos(p.layerGain, HEARTSTEEL_DEFAULT.layerGain);
  // one battle-level hook per PLAYER: a second 心之钢 on the same board must not proc twice
  battleStore(battle, 'protocol:heartsteel:' + pid, () => {
    battle.on('hit', (c) => {
      if (!c || !c.dmg || c.dmg.cancel) return;
      const src = c.source;
      const target = c.target;
      if (!src || src.kind !== 'op' || src.side !== 'ally' || src.ownerId !== pid) return;
      if (!src.alive || !target || target.side !== 'enemy' || !target.alive) return;
      if (!c.dmg.isAttack) return;              // 「攻击」 = the normal attack
      if (isChained(c.dmg)) return;             // never answer our own or another content's extra instance
      if (!heartsteelCarried(battle, pid)) return;   // live: the equipment is what grants it
      if (!isMember(battle, src, HEARTSTEEL_BOND)) return;   // the equipment grants the membership; existing 坚守 operators count too
      const last = src.mem && Number.isFinite(src.mem.heartsteelAt) ? src.mem.heartsteelAt : -Infinity;
      if (battle.time - last < every) return;
      if (!src.mem) src.mem = {};
      src.mem.heartsteelAt = battle.time;
      // 1) the extra hit, off the max HP the operator has RIGHT NOW (before this proc's own growth)
      const amount = src.s.maxHp * (dmgPct / 100);
      if (amount > 0) {
        const info = makeDamageInfo({ amount, type: 'arts', canDodge: false, tags: ['item', 'heartsteel'] });
        info.heartsteel = true;
        battle.dealDamage(src, target, info);
      }
      // 2) +max HP for the rest of the battle (one stack per proc)
      battle.addBuff(src, {
        key: HEARTSTEEL_MAXHP_KEY, refresh: 'stack', stacks: 1, maxStacks: 100000,
        mods: { hpFlat: maxHpGain }, persist: true, allowDead: true, visible: true, tags: ['item'],
      });
      // 3) +坚守 layers (an IN_BATTLE gain: settle() makes them persistent, capped by the engine at 999)
      battle.addLayers(pid, HEARTSTEEL_BOND, layerGain, 'item');
    });
    return { procs: 0 };
  });
}

// =====================================================================================================================
// 不屈余烬 (9_99) — 协议源石【不屈余烬】's equipment
//
// 业主 2026-10-28（原话）：「给一个不屈余烬的装备，装备继承死掉不屈干员属性的5%（无限叠加）…装备属性都保持
// 一致没有先后叠的区别」+「不屈大于200层后，每150层提供一件不屈余烬」。装备这一半只回答「继承」：
//   * 累计是**本局对局级**的（跨战斗保留，不按单场清零）：战斗输入带着上一次存下的总数
//     （`input.indomEmber`，server/match/player/round.js battleInput / bankIndomEmber），这场里的阵亡继续往上加，
//     结束时把新的总数写回结果（`perPlayer[pid].indomEmber`），由 match 的 `_addCumStats` 存回玩家。
//   * 同一玩家所有装备者 / 所有副本共用同一份总数：先拿到与后拿到的副本吃到的数值完全一样（这正是「没有先后叠
//     的区别」），因为总数在玩家身上、不在某一件装备上。
//   * 触发 = 己方【不屈】干员**阵亡**（`death`，reason 'killed'）。〖不屈〗的免费再部署也走这一条，所以每次不屈触发
//     都会喂一层；撤退 / 切换 / 联防退场不算 [ASSUMED: 卡面只说「死掉」]。
//   * 每层 = 该干员**基础面板**（unit.base，不含装备与增益，与尸山 / 吞噬同一条口径）的 inheritPct%：
//     生命上限 → hpFlat（吃百分比），攻击力 → atkFinal（最终加算），防御 → defFlat，法抗 → resFlat。
//     阻挡数不进：5% 的整数阻挡没有意义，累计的小数也不会显示 [ASSUMED]。
//   * 累计一变，就把同一组 mods 重新扣到每一个当前装备者身上（passiveBuff 同 key 覆盖，不会重复叠加）；装备者自己
//     阵亡也照算（buff persist + allowDead，再部署后按最新累计值生效）。
//
// [ASSUMED: 1) 只算 op（召唤物不算）；2) 只算同一 ownerId 的己方干员；3) 攒下的总数挂在玩家身上，副本全部失去后
//   再拿到新副本仍会继承（「装备属性」跟着人走；否则新副本与旧副本就不可能一致）。]

const INDOMEMBER_KEY = 'protocol:indomember';   // battleStore namespace (the item key is only the BY_ITEM key)
/** The bond whose members count as 「不屈干员」 (own bonds + 变形同构体 / 特质 grants, support.isMember). */
const INDOMEMBER_BOND = 'indomShip';

/**
 * 不屈余烬: the carrier inherits `params.inheritPct`% of every own 不屈 operator's BASE stats when it dies. The totals
 * are MATCH-LONG and shared by every copy of the item its player owns (banked on the match player, carried in through
 * `input.indomEmber` and handed back on the battle result).
 * @param {any} battle @param {any} u the carrier @param {any} rec its item record @param {any} S the grant Scope
 */
function indomEmber(battle, u, rec, S) {
  const pid = u.ownerId;
  if (pid == null) return;
  const pct = pos(paramsOf(rec).inheritPct, 5) / 100;
  // ONE pool per (battle, player): every copy — on this carrier or any other — reads the same totals.
  const pool = battleStore(battle, `${INDOMEMBER_KEY}:${pid}`, () => {
    const ps = typeof battle.getPlayer === 'function' ? battle.getPlayer(pid) : null;
    const banked = (ps && ps.input && ps.input.indomEmber) || {};
    const acc = {
      hp: Math.max(0, num(banked.maxHp, 0)),
      atk: Math.max(0, num(banked.atk, 0)),
      def: Math.max(0, num(banked.def, 0)),
      res: Math.max(0, num(banked.res, 0)),
      subs: new Set(),
    };
    battle.on('death', ({ unit, reason }) => {
      if (reason !== 'killed') return;
      if (!unit || unit.kind !== 'op' || unit.side !== 'ally' || unit.ownerId !== pid) return;
      if (!isMember(battle, unit, INDOMEMBER_BOND)) return;
      acc.hp += num(unit.base && unit.base.maxHp, 0) * pct;
      acc.atk += num(unit.base && unit.base.atk, 0) * pct;
      acc.def += num(unit.base && unit.base.def, 0) * pct;
      acc.res += num(unit.base && unit.base.res, 0) * pct;
      for (const fn of acc.subs) fn(acc);
    });
    // Hand the MATCH-LONG totals back (the match banks them in PlayerRound._addCumStats). Only a battle that actually
    // wore a copy reports the field — deaths nobody's equipment witnessed never feed it.
    battle.on('battleEnd', ({ result }) => {
      const pp = result && result.perPlayer && result.perPlayer[pid];
      if (!pp) return;
      pp.indomEmber = { maxHp: acc.hp, atk: acc.atk, def: acc.def, res: acc.res };
    });
    return acc;
  });
  const apply = (acc) => {
    const mods = {};
    if (acc.hp > 0) mods.hpFlat = acc.hp;
    if (acc.atk > 0) mods.atkFinal = acc.atk;
    if (acc.def > 0) mods.defFlat = acc.def;
    if (acc.res > 0) mods.resFlat = acc.res;
    if (Object.keys(mods).length) S.stat('ember', mods, { tags: ['item'] });
  };
  pool.subs.add(apply);
  S.onDispose(() => pool.subs.delete(apply));
  apply(pool);
}

/**
 * The battle behaviours of the remake's 协议源石 equipment, keyed by ITEM KEY (`itemKeyOf`, i.e. without the `_a` / `_b`
 * quality suffix — 尸山 and 尸山·极 are one key and each behaviour reads the numbers off the concrete record).
 * items/battle.js `Object.assign`es this into BY_ITEM, which is what `hasBattleEffect` reads.
 */
export const PROTOCOL_ITEMS = Object.freeze({
  chess_item_9_91_e: demonPact,   // 恶魔之契
  chess_item_9_92_e: canlight,    // 残光
  chess_item_9_93_e: warding,     // 加护
  chess_item_9_94_e: voidReturn,  // 万物归虚
  chess_item_9_95_e: corpseHill,  // 尸山 / 尸山·极
  chess_item_9_96_e: heartsteel,  // 心之钢
  chess_item_9_98_e: knightBadge, // 骑士徽章（协议源石【骑士】）
  chess_item_9_99_e: indomEmber,  // 不屈余烬（协议源石【不屈余烬】）
});
