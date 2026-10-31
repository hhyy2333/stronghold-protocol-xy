// server/match/player/economy.js — PlayerState methods: the economy — funds, spending (onSpend), prep-side bond layer
// gains (clamped by layerGainRoom), the shop (onPrice prices, copy-weighted rolls from the shared pool plus the player's
// own 自选 stock — player/diy.js —, freeze) and its intents: g.buy, g.refresh, g.freeze, g.levelUp, g.sell.
// `_buyChessSlot` is the chess half of a purchase on its own, so the 测试场's 干员 picker (`g.testChess`, a purchase of an
// operator the shop never rolled) takes the ordinary path instead of re-implementing it (server/match/match/testField.js).
// Installed on PlayerState.prototype by server/match/PlayerState.js (a method container: never instantiated; `this` is
// the player state).

import { ERR, PHASE, layerGainRoom } from '../../../shared/constants.js';
import { behaviourIsDefault } from '../../../shared/behaviour.js';
import { freeSlot } from '../board.js';
import { bondBiasPreference } from '../pool.js';
import { layerGainMulOf, bondLayerCapOf, refreshPriceOverrideOf } from '../hextech.js';
import { OK, fail } from './common.js';
import { msg } from '../../../shared/i18n.js';

/**
 * **行为开关 `shopBias` 的读取点**（DESIGN §28.43.1）：这一局的声明要不要偏向，要偏就给出「偏向哪些盟约」。
 *
 * 返回 `null` = **引擎今天的行为**，也就是两条路：没声明这一格 / 声明成 `official`（缺省档），或声明了
 * `bondBias` 但此刻一个盟约都没激活（空集合 ⇒ 抽出来的商店会变成空的装备槽，那不是「偏向」，是「停发」）。
 * 返回非空 `Set` = 只在「`giveBondId` 落在这个集合里」的装备里抽，**只偏置、不授予**。
 *
 * `behaviourIsDefault` 是这一格唯一的判据来源（`shared/behaviour.js`）：与 `variants` 的 `variantIsDefault`
 * 同一个分工 —— `behaviourActions` 里那条 `{ kind: 'shop.biasActiveBonds', value: true }` 是这一格的**声明**，
 * 读取点问的是「哪一档」。写成模块层的**纯**函数，是为了让它能被单测（`test/shopBias.test.js`）也为了它是
 * `shared/modSurface.js` 里 `behaviour` 那一格可锚的一个导出名（改名 / 挪走 = 打断所有声明这一格的包）。
 *
 * @param {{ m: { behaviour: any }, _activeBondIds: () => Set<string> }} ps
 * @returns {Set<string>|null}
 */
export function bondBiasBonds(ps) {
  if (behaviourIsDefault(ps.m.behaviour, 'shopBias')) return null;
  const active = ps._activeBondIds();
  return active.size ? active : null;
}

export class PlayerEconomy {
  /**
   * 资金进账。**一回合获得上限就卡在这里**（业主 2026-10-29「增加限制玩家一回合最多获得30块」→「把这个负面做成 n19」；
   * 数字属于协议等级 19 的那一行 `fundsGainCap`，见 `shared/protocolLevels.js` 与 `docs/design/match.md`）：
   * 全游戏的钱都从这一个原语进 —— 回合收入、协议源石 / 盟约 / 装备 / 策略的发放、卖出返还、债务还款 —— 所以卡在
   * 这里就没有能绕过去的路。
   *
   * - 额度 = `gd.fundsGainCapPerRound`（**0 = 不设上限**：等级 0–18、其它难度、以及关了等级的每一局都是 0，于是
   *   从前的经济逐字节不变），已用 = `this.round.fundsGained`（`startRound` 把它清零，于是「一回合」= 一次回合开始
   *   到下一次）；
   * - 超出的部分**直接作废**，不结转（业主同一次追问的选择），并给本人一条 toast（每回合最多一条）；
   * - 负数（刚扣掉又退回来的付款、对外还的债）把额度**还回来**，所以「先付再退」的一对不占额度；真正花掉的 `spend()`
   *   不经这里，也不还额度；
   * - `force: true` = 不是「获得」：跳过上限、也不计入额度。测试场自己的发钱（`g.testFunds`、首领测试的起步资金）与
   *   只把钱挪去立刻花掉的内部过路（天人形态的免费升级）用它。
   *
   * @returns {number} 真正动了的资金（被上限削掉时就是这个更小的数）
   */
  addFunds(n, { reason = '', force = false } = {}) {
    if (!Number.isFinite(n) || n === 0) return 0;
    const gained = Number.isFinite(this.round.fundsGained) ? this.round.fundsGained : 0;
    let v = Math.trunc(n);
    if (v > 0 && !force) {
      const cap = Number.isFinite(this.gd.fundsGainCapPerRound) && this.gd.fundsGainCapPerRound > 0
        ? this.gd.fundsGainCapPerRound : Infinity;
      const room = Math.max(0, cap - gained);
      if (v > room) {
        this._fundsGainCapped(cap);
        v = room;
      }
      if (v === 0) return 0;
    }
    const before = this.funds;
    this.funds = Math.max(0, this.funds + v);
    const delta = this.funds - before;
    if (delta > 0) {
      if (!force) this.round.fundsGained = gained + delta;
      this.stats.fundsGained += delta;
    } else if (delta < 0 && !force) {
      this.round.fundsGained = Math.max(0, gained + delta);
    }
    this.dirty();
    return delta;
  }

  /** 本回合的获得额度刚被削掉：把上限告诉本人一条（每回合一次，机器人没有 toast）。 */
  _fundsGainCapped(cap) {    if (this.round.fundsCapWarned) return;
    this.round.fundsCapWarned = true;
    if (typeof this.m?.toast !== 'function') return;
    this.m.toast(this, 'warn', msg('本回合获得的资金已达上限（{cap}）', { cap }));
  }

  spend(n) {
    const v = Number.isFinite(n) ? Math.max(0, Math.trunc(n)) : 0;
    if (v > this.funds) return false;
    this.funds -= v;
    this.stats.gold += v;
    this.round.spent += v;
    this.dirty();
    return true;
  }

  /** onSpend, dispatched once a payment's action is complete (buy / refresh / levelUp / reward / effect). */
  _afterSpend(amount, reason) {
    if (!(amount > 0)) return;
    this.m.dispatch(this, 'onSpend', { amount, reason, total: this.stats.gold });
  }

  /**
   * The layers a gain of `n` on `bondId` WOULD add right now: the same preconditions and the same clamp
   * (`layerGainRoom` under THIS player's cap, ×`layerGainMulOf`) that `addLayers` applies, computed without writing.
   *
   * PORT NOTE (2026-10-16): this is the repo's 0.3.0 accessor, and it was the missing half of TWO things at once.
   *   1. `server/match/effectsMeta.js` — a file this tree carries BYTE-IDENTICAL to the repo's — calls
   *      `ps.layerGainOf(...)` at line 489 to wire the card dispatcher's `ctx.addLayers`. It did not exist here, so
   *      every prep-side bond-layer gain and the battle preview's layer patching went through a broken path.
   *   2. 海克斯 盟约裂变 (`effect.bondFission.mul`, ×3 layers for the bonds it keeps) rides on `layerGainMulOf` here.
   *
   * The stats preview (`g.unitStats`) is why this must exist separately from addLayers: a battle-start handler must not
   * change match state (docs/META.md, onBattleStart), but its layers still have to show in the battle input the preview
   * reads (盟约寄生 patches that snapshot). So the dispatcher makes `ctx.addLayers` inert under `ev.preview` and hands
   * back THIS number instead, and the caller patches `ev.input` with exactly what the real battle would have seen.
   *
   * 上限（【突破极限】, 设计稿 §3）：`bondLayerCapOf(this)` —— 默认 999，拥有 `hex_break_limit` 的玩家是 9999。预览与
   * 真正的加层读同一个数，所以预览永远不会比实战更保守或更乐观。
   * @returns {number} layers that would be added (0 when refused / at the cap)
   */
  layerGainOf(bondId, n, { requireActive = false } = {}) {
    if (!this.gd.bond(bondId) || !Number.isFinite(n) || n <= 0) return 0;
    if (requireActive && !(this.bonds[bondId] && this.bonds[bondId].active)) return 0;
    const before = this.layers[bondId] || 0;
    // 背水一战 (业主 2026-10-24) made the multiplier fractional (×1.5): floors the PRODUCT so a bond's layers stay whole
    // numbers (5 × 1.5 ⇒ +7, not +7.5). 盟约裂变's ×3 is unaffected.
    return layerGainRoom(before, Math.floor(Math.floor(n) * layerGainMulOf(this, bondId)), bondLayerCapOf(this));
  }

  /**
   * Bond layer gain (prep-side). `requireActive` = "使已激活的【X】层数+N". Returns layers added: at most the room left
   * under THIS player's cap (BOND_LAYER_CAP 999 — 9999 with 【突破极限】, shared/constants.js layerGainRoom +
   * server/match/hextech.js bondLayerCapOf) — a gain at the cap adds 0 and dispatches nothing.
   */
  addLayers(bondId, n, { requireActive = false, reason = '' } = {}) {
    const before = this.layers[bondId] || 0;
    const add = this.layerGainOf(bondId, n, { requireActive });
    if (add <= 0) return 0;
    this.layers[bondId] = before + add;
    this.recompute();
    // A live prep gain, not a view delta: reconnects and combat-result backfill must not replay the cue.
    if ([PHASE.ROUND_START, PHASE.SP_DRAFT, PHASE.PREP].includes(this.m.phase)) {
      this.m.sendTo(this.playerId, { t: 'm.layer', playerId: this.playerId, bondId, add });
    }
    this.m.dispatch(this, 'onLayers', { bondId, from: before, to: before + add, reason });
    return add;
  }

  /**
   * SET a bond's layers outright (协议源石 ctx.setLayers, DESIGN §29.23): 盟约之主 / 转移一类卡 move layers to an
   * absolute value rather than adding. Clamped to 0..this player's cap (999 — 9999 with 【突破极限】) and rounded down
   * like addLayers; a no-op (return 0) when the value does not move, so a card that re-sets the same number produces no
   * cue and no dispatch.
   */
  setLayers(bondId, n, { reason = '' } = {}) {
    if (!this.gd.bond(bondId) || !Number.isFinite(n)) return 0;
    const cap = bondLayerCapOf(this);
    const target = Math.max(0, Math.min(cap > 0 ? cap : Infinity, Math.floor(n)));
    const before = this.layers[bondId] || 0;
    if (target === before) return 0;
    this.layers[bondId] = target;
    this.recompute();
    if ([PHASE.ROUND_START, PHASE.SP_DRAFT, PHASE.PREP].includes(this.m.phase)) {
      this.m.sendTo(this.playerId, { t: 'm.layer', playerId: this.playerId, bondId, add: target - before });
    }
    this.m.dispatch(this, 'onLayers', { bondId, from: before, to: target, reason });
    return target;
  }

  /**
   * Mark every unsold shop operator as FREE (协议源石 ctx.freeShopChess, 天人形态 §29.23): the shop lets the player take
   * one without spending. Returns how many slots were marked, so a caller can tell "nothing to free" from "done".
   */
  freeShopChess() {
    let n = 0;
    for (const s of this.shop.slots) if (s && s.kind === 'chess' && !s.sold) { s.free = true; n++; }
    if (n) this.dirty();
    return n;
  }

  /** Effective price of a shop slot after onPrice modifiers (never negative). */
  priceOf(slot) {
    if (!slot) return 0;
    // 电表倒转·改 (§29.34, PORT NOTE 2026-10-16): a slot the card marked FREE this refresh costs nothing, whatever the
    // modifiers say. The flag lives on the slot object and `rollShop` rebuilds those on every refresh / round start, so it
    // can never outlive the refresh it was written for (no cleanup needed, and the audit's exact-price check reads the same
    // `priceOf`). Without this line `freeShopChess()` still marked three slots but every price stayed at its base value
    // (measured: [2,2,2] instead of [0,0,0]).
    if (slot.free === true) return 0;
    // 可露希尔大降价 (owner's ruling 2026-10-18, 「免费购买是在三次刷新内有效」): purchases cost nothing for as long as
    // the card's free-refresh window is open — `freeBuyWindow` counts the refreshes still ahead (economy.js refresh()
    // spends one, round.js startRound closes it). The first version marked the CURRENT shop's slots free, so the card
    // paid out exactly once (owner report 「只免费第一次，刷新后都不免费」); the second draft counted three PURCHASES,
    // which the owner corrected. 电表倒转·改's own per-refresh `slot.free` flag above stays separate.
    if (this.shop.freeBuyWindow > 0) return 0;
    const ev = { slot, kind: slot.kind, id: slot.id, price: slot.basePrice };
    this.m.dispatch(this, 'onPrice', ev, { quiet: true });
    const p = Number(ev.price);
    return Number.isFinite(p) ? Math.max(0, Math.round(p)) : slot.basePrice;
  }

  _rollChessSlot() {
    // the slotted 自选 pieces join the draw once the 调度中心 reaches their slot's level (player/diy.js diyRollEntries);
    // the DRAW SOURCE is the player's own pool in the 100-seat variant and the shared one today (player/rules.js
    // mainPool — the same object either way when the switch is off, docs/PS100-MIGRATION.md §10-A)
    const id = this.mainPool().roll(this.m.rngShop, { maxTier: this.shop.level, extra: this.diyRollEntries() });
    if (!id) return null;
    return { kind: 'chess', id, basePrice: this.gd.chessPrice(id), frozen: false, sold: false };
  }

  /**
   * 这个玩家**已激活**盟约的 id 集合（`recompute` 算出来的 `this.bonds`）—— `shopBias: "bondBias"` 的唯一输入。
   * 缓存按 `this.bonds` 的**对象身份**失效：每一次 `recompute()` 都换一个新对象（`player/round.js`），于是同一个
   * prep 里的多次刷新只付一次遍历，而变化之后一定重算。
   * @returns {Set<string>}
   */
  _activeBondIds() {
    if (this._biasBondsAt === this.bonds && this._biasBonds) return this._biasBonds;
    const out = new Set();
    for (const [id, state] of Object.entries(this.bonds || {})) if (state && state.active) out.add(id);
    this._biasBondsAt = this.bonds;
    this._biasBonds = out;
    return out;
  }

  /**
   * **执行点（`shopBias`）**：这一局的声明要不要偏向，要偏就给出「偏向哪些盟约」。
   *
   * 判据本体是模块层的 `bondBiasBonds`（纯函数，`shared/modSurface.js` 的 `behaviour` 那一格锚着它）；这里只把
   * 这一格的读取点挂到玩家状态上，`_rollItemSlot` 与本文件以外的调用方都走这一个名字。
   * @returns {Set<string>|null}
   */
  shopBiasBonds() {
    return bondBiasBonds(this);
  }

  _rollItemSlot() {
    // 行为开关 `shopBias`（DESIGN §28.43.1）：只有这一局的声明把那一格选成 `bondBias` 时，装备槽才拿这条
    // 偏向谓词去缩候选集。`shopBiasBonds()` 在缺省档返回 null ⇒ 这一行与从前**同一份结果**、同一条代码路径。
    const bonds = this.shopBiasBonds();
    const restrict = bonds ? bondBiasPreference(this.gd, bonds) : null;
    const id = this.m.pool.rollItem(this.m.rngShop, this.shop.level, this.m.itemPool, restrict);
    return id ? { kind: 'item', id, basePrice: this.gd.itemPrice(id), frozen: false, sold: false } : null;
  }

  /**
   * Reroll the shop. keepFrozen → frozen unsold slots survive (round start); otherwise everything is rerolled
   * (manual refresh). Slot counts follow the current level.
   */
  rollShop({ keepFrozen = false } = {}) {
    const { chess: nChess, item: nItem } = this.gd.shopSlots(this.shop.level);
    const old = this.shop.slots;
    const layout = this.shop.layout || { chess: old.length, item: 0 };
    const oldChess = old.slice(0, layout.chess);
    const oldItems = old.slice(layout.chess);
    const keep = (s, kind) => (keepFrozen && s && s.kind === kind && !s.sold && s.frozen ? { ...s } : null);
    // frozen slots keep their position; sold / empty / unfrozen positions are rerolled
    const slots = [];
    for (let i = 0; i < nChess; i++) slots.push(keep(oldChess[i], 'chess') ?? this._rollChessSlot());
    for (let i = 0; i < nItem; i++) slots.push(keep(oldItems[i], 'item') ?? this._rollItemSlot());
    this.shop.slots = slots;
    this.shop.layout = { chess: nChess, item: nItem };
    for (const s of slots) if (s) s.frozen = this.shop.frozen;
    this.dirty();
  }

  /**
   * The 调度中心's upgrade opens the new level's extra slots — as EMPTY slots.
   *
   * The owner's decision of 2026-10-07, report 「升级2本会刷新干员池和加入新干员，升级商店等级加槽位应该是只多一个空位而不是直接多
   * 一个可购买干员」: an upgrade buys a PLACE for a card, not a card. The extra slots appear empty and the next roll fills
   * them — a manual 刷新 (rollShop) or the round start's own roll (round.js startRound).
   *
   * Upstream 0.2.0 drew a card in at once (§25.19.2, community report item 19 「升级商店获得新的商店位时用新卡补上，而不是空着」,
   * citing the tutorial's 「升级：…升级后将出现更多的商品栏位、可调度干员以及新装备」). That hands the player a free card the
   * shop never rolled — from level 2 on, a NEW operator to buy on the spot — which is exactly what the owner reports as
   * wrong; the tutorial line only promises that more slots appear. 0.2.2 reached the same conclusion on its own: the
   * footage of a 1→2 upgrade (bilibili BV1AXwuzdEys 1:39, GitHub #332 / PR #333 by @2321Robin) shows the new slot appear
   * and stay empty, and the texts only name the slots — the tutorial's 休整期 page 「升级后将出现更多的商品栏位」, PRTS 帮助
   * 「增加刷新栏位」 — never a card that comes with them. The cards already shown stay where they are (chess slots keep
   * their index, the item slot stays after them).
   */
  _openLevelSlots() {
    const { chess: nChess, item: nItem } = this.gd.shopSlots(this.shop.level);
    const old = this.shop.slots;
    const layout = this.shop.layout || { chess: old.length, item: 0 };
    if (nChess <= layout.chess && nItem <= layout.item) return;
    const chess = old.slice(0, layout.chess);
    const items = old.slice(layout.chess);
    while (chess.length < nChess) chess.push(null); // loop-cap: shopSlots chess max 8   // empty: the next roll draws into it
    while (items.length < nItem) items.push(null);
    this.shop.slots = [...chess, ...items];
    this.shop.layout = { chess: chess.length, item: items.length };
  }

  /** Combat start: unfrozen slots are emptied (research 01 A1). */
  clearUnfrozenShop() {
    this.shop.slots = this.shop.slots.map((s) => (s && s.frozen && !s.sold ? s : null));
    this.dirty();
  }

  /**
   * The CHESS half of a purchase: the price query, the funds / hand gates, the charge, the piece, the 购买 counters and
   * the onBuy / onSpend dispatches.
   *
   * ONE implementation for `g.buy` and the 测试场's 干员 picker (`g.testChess`, server/match/match/testField.js). The
   * test panel buys an operator the shop never rolled, but it is still a purchase: a full hand refuses it, `priceOf`
   * charges the tier price with the onPrice modifiers and the free windows applied, the merge runs, 休露丝 / 玛恩纳 /
   * 升华 style onBuy hooks fire. Only the slot record is synthetic — the shop's own slots have exactly this shape.
   *
   * The order of the gates is the one `buy` has always applied for a chess slot: price → funds → the record → the hand.
   * @param {{ kind: 'chess', id: string, basePrice: number, sold: boolean }} slot
   */
  _buyChessSlot(slot) {
    const price = this.priceOf(slot);
    if (this.funds < price) return fail(ERR.NO_FUNDS);
    const rec = this.gd.chess(slot.id);
    // a DIY slot sells only as this player's own 自选 piece (a slotted slot's record carries `diyFor`)
    if (!rec || (rec.isDiy && !rec.diyFor)) return fail(ERR.BAD_TARGET);
    // Already displayed operators stay purchasable after stock runs out (#498; 路标月报#2,
    // BV1eLXXBqEgF 2:50–2:57: nine owned + four shop offers => thirteen owned).
    // acquireChess records every copy, including the deficit; future rolls still exclude empty stock.
    if (freeSlot(this.hand) < 0) return fail(ERR.HAND_FULL);
    // 可露希尔大降价: no separate charge — priceOf quotes 0 while the free-refresh window is open
    this.spend(price);
    slot.sold = true;
    const piece = this.acquireChess(slot.id, { source: 'buy' });
    this.stats.buys++;
    this.round.buys++;
    this.m.dispatch(this, 'onBuy', { piece, slot, price, kind: slot.kind });
    this._afterSpend(price, 'buy');
    this.recompute();
    return OK;
  }

  /**
   * g.buy {slot}. A full regular hand refuses every purchase, also one whose copy would complete a merge at once (PRTS
   * 卫戍协议/帮助 §手牌区 "当常规手牌区全满无空位时，玩家将无法执行使手牌溢出的操作" — "例如招募/购入等通常情况下会增加手牌的
   * 操作"; BWIKI 盟约 "当整备区达到上限后将无法进行涉及到整备区的操作（购买、撤回等）"; GitHub #82: the reporter's first-hand
   * check in the official game, "哪怕是已经有了两个相同干员情况"). Until 0.1.3 such a purchase was let through.
   */
  buy(slotIdx) {
    const g = this._gate(); if (g) return g;
    if (!Number.isInteger(slotIdx) || slotIdx < 0 || slotIdx >= this.shop.slots.length) return fail(ERR.BAD_TARGET);
    const slot = this.shop.slots[slotIdx];
    if (!slot) return fail(ERR.BAD_TARGET);
    if (slot.sold) return fail(ERR.SOLD_OUT);
    // the chess half is shared with the 测试场's 干员 picker (testField.js testChess) — one purchase path
    if (slot.kind === 'chess') return this._buyChessSlot(slot);
    const price = this.priceOf(slot);
    if (this.funds < price) return fail(ERR.NO_FUNDS);
    if (!this.gd.item(slot.id)) return fail(ERR.BAD_TARGET);
    // Already displayed equipment stays purchasable after stock runs out (#624, maintainer 2026-10-14).
    // acquireItem records the debt. Future rolls still exclude empty stock. SOLD_OUT is only this slot, already sold.
    if (freeSlot(this.hand) < 0) return fail(ERR.HAND_FULL);
    this.spend(price);
    slot.sold = true;
    const piece = this.acquireItem(slot.id, { source: 'buy', displayed: true });
    this.stats.buys++;
    this.round.buys++;
    this.m.dispatch(this, 'onBuy', { piece, slot, price, kind: slot.kind });
    this._afterSpend(price, 'buy');
    this.recompute();
    return OK;
  }

  /**
   * What one refresh costs right now.
   *
   * PORT NOTE (2026-10-16): the repo's 0.3.0 accessor. 海克斯 升级刷新 (`effect.shopTune.refreshPrice`) sets it to 2 —
   * `refreshPriceOverrideOf` is in server/match/hextech.js, a file this tree carries BYTE-IDENTICAL to the repo's, so the
   * number was computable here all along; nothing read it, and both the charge below and the published
   * `shop.refreshPrice` quoted the raw `gd.refreshPrice` instead, so the card did nothing.
   */
  refreshPriceNow() {
    const over = refreshPriceOverrideOf(this);
    return over == null ? this.gd.refreshPrice : over;
  }

  refresh() {
    const g = this._gate(); if (g) return g;
    const free = this.shop.freeRefreshes > 0;
    const price = free ? 0 : this.refreshPriceNow();
    if (!free && this.funds < price) return fail(ERR.NO_FUNDS);
    if (free) this.shop.freeRefreshes--;
    else this.spend(price);
    // A manual refresh cancels the freeze: the new cards are not frozen (official, the owner's play of 2026-10-14;
    // GitHub #584, DESIGN §34.14.7). A refresh that fails (funds, phase) returns above and leaves the freeze on.
    this.shop.frozen = false;
    // 可露希尔大降价: a refresh spends one of the free-purchase window's refreshes (the window IS those refreshes)
    if (this.shop.freeBuyWindow > 0) { this.shop.freeBuyWindow--; this.dirty(); }
    this.rollShop({ keepFrozen: false });
    this.stats.refreshes++;
    this.round.refreshes++;
    this.m.dispatch(this, 'onRefresh', { slots: this.shop.slots, free, price });
    this._afterSpend(price, 'refresh');
    this.dirty();
    return OK;
  }

  freeze() {
    const g = this._gate(); if (g) return g;
    this.shop.frozen = !this.shop.frozen;
    for (const s of this.shop.slots) if (s && !s.sold) s.frozen = this.shop.frozen;
    this.dirty();
    return OK;
  }

  levelUp() {
    const g = this._gate(); if (g) return g;
    if (this.shop.level >= this.gd.maxShopLevel) return fail(ERR.MAX_LEVEL);
    const price = Math.max(0, this.shop.upgradePrice);
    if (this.funds < price) return fail(ERR.NO_FUNDS);
    this.spend(price);
    this.shop.level++;
    this.shop.upgradePrice = this.gd.upgradeBase(this.shop.level) ?? 0;
    this._openLevelSlots();
    this.m.tickerFor('SHOP_LEVEL', [this.name, String(this.shop.level)], { playerId: this.playerId, param: String(this.shop.level) });
    this.m.dispatch(this, 'onLevelUp', { level: this.shop.level, price });
    this._afterSpend(price, 'levelUp');
    this.dirty();
    return OK;
  }

  sell(uid) {
    const g = this._gate(); if (g) return g;
    const loc = this.find(uid);
    if (!loc) return fail(ERR.BAD_TARGET);
    if (loc.piece.kind !== 'chess') return fail(ERR.BAD_TARGET, loc.piece.kind === 'item' ? 'items cannot be sold' : 'tokens cannot be sold');
    const piece = loc.piece;
    // Returned equipment can always wait in the overflow queue, even when all fifteen visible slots are occupied.
    this._detach(loc);
    this.removeTokensOf(piece.uid);
    for (const it of piece.items || []) this.stow(it, { allowTemp: true });
    piece.items = [];
    this.returnCopies(piece);
    const ev = { piece, gain: this.gd.sellPrice(piece.id) };
    this.m.dispatch(this, 'onSold', ev);
    const gain = Number.isFinite(ev.gain) ? Math.max(0, Math.trunc(ev.gain)) : 1;
    this.addFunds(gain, { reason: 'sell' });
    this.stats.sells++;
    this.round.sells++;
    this.checkItemMerges();
    this.recompute();
    return OK;
  }
}
