// server/match/hextech.js — the match side of 海克斯 (Hextech, DESIGN §29): applying a picked hex to a player, the
// views the client renders, and the enemy multipliers.
//
// A pick does two things:
//   1. `dispatcher.runKey(ps, 'hex:<id>', 'onHexPick')` — the content handler of server/sim/content/hextech.js runs the
//      effect's immediate part through the usual ctx primitives (funds / items / operators / layers / free refreshes);
//   2. a persistent EffectRef `hex:<id>` goes into ps.effects, so the same handler runs again on every onRoundStart
//      (`effect.onRoundStart`) and the sim reads the ref's battle part (`effect.battle`) in every battle.
// `effect.onPick.lp` is applied here: LP is match state and the ctx has no LP mutator (it exposes a read-only `lp()`).
//
// Enemy hexes are match state too: `Match.enemyHexes` holds the ids the enemy side owns (they persist to the end of the
// match), `enemyHexMods` multiplies them into the wave's spawn mods (server/match/waves.js vocabulary) and
// `applyEnemyHexes` folds them into a battle's spawn list.

import { sumEnemyMods, rollOffers, fissionBondIds as sharedFissionBondIds, fissionCap, fissionMul } from '../../shared/hextech.js';
import { protocolLevelEnemyMods } from '../../shared/protocolLevels.js';
import { BOND_LAYER_CAP } from '../../shared/constants.js';
import { hasBattlePart, DEBT_EFFECT_KEY } from '../sim/content/hextech.js';
import { createRng, deriveSeed } from '../sim/rng.js';
import { bossPoolHp } from './finalAssault.js';

/**
 * 【突破极限】的卡 id (设计稿 §3)：`data/hextech.json` 的 `hex_break_limit`，效果 `effect.bondCap = { cap: 9999 }`。
 * 备战 / 战斗 / 结算 / 校验四处读的都是同一个 id（`bondLayerCapOf` 是唯一的读法）。
 */
export const BREAK_LIMIT_HEX_ID = 'hex_break_limit';

/**
 * 潘多拉魔盒 的卡 id（`data/hextech.json` 的 `hex_pandora`，效果 `effect.onPick = { pandora: true }`）。
 *
 * 替换逻辑本身在 `server/match/effectsMeta.js makeCtx().replaceHexes`（它要重入 applyHex，只能住在对局层），
 * 那里要**把这张卡从替换池里排除**：卡面是「更换为」另一张 3 阶卡，抽回自己会立刻再触发一次整轮替换，一路撞到
 * 派发器的 MAX_DEPTH，玩家手上就只剩一张牌（业主 2026-11-03 报告的那条「少了一个协议源石」）。
 */
export const PANDORA_HEX_ID = 'hex_pandora';

/**
 * 盟约寄生 (业主 2026-10-24): the key of the DISPLAY-ONLY watcher ref pushed onto the 被寄生者. It is deliberately not a
 * registered handler — the real work runs on the PICKER's card at each round start (`parasiteShare`); this ref exists so
 * the host's effects column can name the pairing too (「让寄生者和被寄生者都知道寄生对象」).
 */
export const PARASITE_HOST_KEY = 'effect:hexparasite';

/**
 * 核心盟约专属协议（业主 2026-10-24）：a card record may carry `requiresBond: '<bondId>'`, meaning it is only OFFERED to
 * a player whose that bond is ACTIVE right now — 「只在激活对应盟约时才能刷新出」.
 *
 * This is a DRAFT-POOL rule, not an ownership rule: once the card has been gained it keeps working even if the bond
 * lapses later (a 盟约 can lose members mid-match). Every place that draws a random card out of the player pool must ask
 * this predicate, or a 专属 card leaks into a board it was never meant for — hence the single `hexPoolFor` below.
 * @param {{ bonds?: Record<string, any> } | null} ps
 * @param {any} rec a data/hextech.json player-hex record
 * @returns {boolean}
 */
export function hexAvailableTo(ps, rec) {
  if (!rec || typeof rec !== 'object') return false;
  const need = rec.requiresBond;
  if (typeof need !== 'string' || !need) return true;
  const b = ps && ps.bonds ? ps.bonds[need] : null;
  return !!(b && b.active);
}

/**
 * The player-hex pool ONE player may be offered right now: the whole roster minus that player's own 协议源石禁用 (≤3),
 * minus every 专属 card whose bond is not active for them.
 * @param {import('./PlayerState.js').PlayerState} ps
 * @param {{ hexPlayerPool: () => any[] }} gd
 * @returns {any[]}
 */
export function hexPoolFor(ps, gd) {
  const all = gd && typeof gd.hexPlayerPool === 'function' ? gd.hexPlayerPool() : [];
  const bans = ps && Array.isArray(ps.hexBans) ? ps.hexBans : [];
  return all.filter((h) => h && !bans.includes(h.id) && hexAvailableTo(ps, h));
}

/**
 * 不屈余烬's **抽卡池权重** (业主 2026-11-01「抽到不屈余烬的概率增加」/「不屈叠层超 200 后增加出现不屈余烬机会增加
 * 20%」). The card record carries `effect.drawBoost = { bond, fromLayers, pct }`: while the player's 〖不屈〗
 * (`indomShip`) stands ABOVE `fromLayers` layers, this card's weight **inside its own rarity** is × (1 + pct/100) — with
 * the roster's 200 / 20 that is ×1.2 from the 201st layer on (`shared/hextech.js rollOffers`'s `weightOf` hook).
 *
 * Two things this is NOT:
 *   * **not a gate** — that is `requiresBond` / `hexAvailableTo` (a completely different field): this card has no
 *     `requiresBond`, so it is offered to everybody and merely becomes MORE LIKELY for a deep-〖不屈〗 player;
 *   * **not the equipment ladder** — `effect.onPick/onRoundStart.indomEmberGift { base: 200, step: 150 }` (one 装备 per
 *     150 layers above 200) is untouched here; this function only ever feeds the draw.
 *
 * 层数读**实际层数**：`ps.bonds[bondId].layers` is the STORED value `computeBonds` derives from `ps.layers` (with
 * `ps.layers` as the fallback for a PlayerState whose bonds view was not recomputed yet) — NOT the 里程碑视图, i.e. not
 * 圣约回响's `bondLayerViewPct` +50 % (`bondLayerViewMulOf`), which only ever moves the layer-threshold payouts.
 *
 * Everything else answers 1 (no bias at all, the `rollOffers` default): a record without `drawBoost`, a missing bond /
 * missing data fields, and layers that do not exceed `fromLayers`.
 * @param {{ bonds?: Record<string, { layers?: number }>, layers?: Record<string, number> } | null} ps
 * @param {any} rec a data/hextech.json player-hex record
 * @returns {number} the card's same-rarity weight (1 = unbiased)
 */
export function hexDrawWeight(ps, rec) {
  const boost = rec && rec.effect ? rec.effect.drawBoost : null;
  if (!boost || typeof boost !== 'object') return 1;
  const bondId = typeof boost.bond === 'string' ? boost.bond : '';
  const fromLayers = Number(boost.fromLayers);
  const pct = Number(boost.pct);
  if (!bondId || !Number.isFinite(fromLayers) || !Number.isFinite(pct) || pct <= 0) return 1;
  const state = ps && ps.bonds ? ps.bonds[bondId] : null;
  const stored = state && Number.isFinite(Number(state.layers)) ? Number(state.layers) : null;
  const raw = stored != null ? stored : Number(ps && ps.layers ? ps.layers[bondId] : 0);
  const layers = Number.isFinite(raw) && raw > 0 ? raw : 0;
  if (layers <= fromLayers) return 1;
  return 1 + pct / 100;
}

/** 锻炉's fused item (data/items.json CUSTOM_ITEMS `chess_item_9_97_e_a`, 百变). */
export const FORGE_ITEM_ID = 'chess_item_9_97_e_a';

/**
 * 万物归虚's equipment (data/items.json CUSTOM_ITEMS `chess_item_9_94_e_a`): the one item whose `state` the prep side
 * writes (the operators its equip removed) and the battle side reads. There is no golden `_b` form.
 */
export const VOIDRETURN_ITEM_ID = 'chess_item_9_94_e_a';

/**
 * 不屈余烬's equipment (data/items.json CUSTOM_ITEMS `chess_item_9_99_e_a`, 业主 2026-10-28). Its inheritance is
 * **match-long**: every own 〖不屈〗 operator's death feeds it 5 % of that operator's base stats (uncapped), the totals
 * survive every battle and every copy a player owns reads the SAME totals (「装备属性都保持一致没有先后叠的区别」).
 * The banked totals ride the battle input as `indomEmber` and come back on the result; see `bankIndomEmber`.
 */
export const INDOMEMBER_ITEM_ID = 'chess_item_9_99_e_a';
/** Counter namespace of the banked inheritance (player scope, persistent — `ps.counters`). */
const INDOMEMBER_COUNTER = 'item:indomember:';

/**
 * The banked 不屈余烬 inheritance of a player (`{ maxHp, atk, def, res }`), or null when nothing has been inherited.
 * Read by `battleInput` and carried into the battle, where the equipment's own behaviour (items/protocol.js) adds to it.
 * @param {any} ps
 * @returns {{ maxHp: number, atk: number, def: number, res: number } | null}
 */
export function indomEmberBonuses(ps) {
  if (!ps || !ps.counters || typeof ps.counters !== 'object') return null;
  const read = (k) => { const v = Number(ps.counters[INDOMEMBER_COUNTER + k]); return Number.isFinite(v) && v > 0 ? v : 0; };
  const out = { maxHp: read('maxHp'), atk: read('atk'), def: read('def'), res: read('res') };
  return out.maxHp + out.atk + out.def + out.res > 0 ? out : null;
}

/**
 * Bank an accepted battle's `perPlayer[pid].indomEmber` (the equipment's totals AFTER that battle). SET, not added: the
 * battle already starts from the banked value it was handed, so folding the same result twice is harmless — the
 * 本局累计伤害统计 precedent (`PlayerRound._addCumStats`, which calls this).
 * @param {any} ps @param {{ indomEmber?: any } | null} pp the player's BattleResult.perPlayer entry
 * @returns {boolean} whether anything was banked
 */
export function bankIndomEmber(ps, pp) {
  const ie = pp && pp.indomEmber;
  if (!ps || !ps.counters || !ie || typeof ie !== 'object') return false;
  let any = false;
  for (const k of ['maxHp', 'atk', 'def', 'res']) {
    const v = Number(ie[k]);
    if (!Number.isFinite(v) || v < 0) continue;
    ps.counters[INDOMEMBER_COUNTER + k] = v;
    any = true;
  }
  if (any && typeof ps.dirty === 'function') ps.dirty();
  return any;
}

/**
 * Merge two item pieces' `state` maps (锻炉's 百变 keeps the effects — and the state — of both components). Same key on
 * both sides: numeric fields add up (万物归虚's layers accumulate), anything else takes the second one.
 * @param {object|null} a @param {object|null} b @returns {object|null}
 */
function mergeItemState(a, b) {
  if (!a && !b) return null;
  const out = { ...(a || {}) };
  for (const [key, val] of Object.entries(b || {})) {
    const prev = out[key];
    if (!prev || !val || typeof prev !== 'object' || typeof val !== 'object') { out[key] = val; continue; }
    const merged = { ...prev };
    for (const [field, x] of Object.entries(val)) {
      const y = merged[field];
      merged[field] = Number.isFinite(Number(y)) && Number.isFinite(Number(x)) && y != null && x != null
        ? Number(y) + Number(x)
        : x;
    }
    out[key] = merged;
  }
  return out;
}

/**
 * 锻炉 (业主 2026-10-24): 「干员装备两件装备时融合成装备**百变**，百变的效果是两件被融合装备的效果。百变不会被融合，
 * 可正常被同构体识别。」
 *
 * HOW the double effect works, and why nothing in the battle had to change: the fused piece is ONE item piece
 * (`{ id: 百变, merged: [idA, idB] }`) sitting in the operator's normal equipment row, so it occupies one slot and the
 * client draws one item. `server/match/player/round.js battleInput` expands `merged` into the two original ids, so the
 * sim installs BOTH real items (stats, procs, 变形同构体 pairing) exactly as if they were still worn separately — that is
 * 「百变的效果是两件装备的效果」 and 「可正常被同构体识别」 in one stroke.
 *
 * 「百变不会被融合」: the scan only ever pairs items WITHOUT a `merged` list, so a 百变 is never an input again (and its
 * record is `mergeable: false`, so the ordinary 3-copy merge cannot touch it either).
 *
 * @param {{ effects?: any[], m?: any, find?: Function, recompute?: Function }} ps
 * @param {any} [piece] fuse only this chess piece (an equip just landed on it); omit to scan the whole board / hand / temp
 * @returns {number} how many fusions were made
 */
export function applyForgeFusion(ps, piece = null) {
  if (!ps || typeof ps !== 'object' || !ownsHex(ps, 'hex_forge')) return 0;
  const ref = (ps.effects || []).find((e) => e && e.data && e.data.hexId === 'hex_forge');
  const spec = ref && ref.params && ref.params.forge ? ref.params.forge : null;
  const itemId = spec && typeof spec.itemId === 'string' && spec.itemId ? spec.itemId : FORGE_ITEM_ID;
  const list = piece ? [piece] : [
    ...(ps.board ? ps.board.values() : []), ...(ps.hand || []), ...(ps.temp || []),
  ];
  // 业主 2026-10-31「如果百变里面的装备能被进阶就自动进阶」：the components inside a 百变 are advanced to their golden form
  // when one exists (维多利亚的锤子常在被合成时还没升级). Applied at fusion time AND retroactively to every 百变 already
  // fused (the pick itself re-runs this function, so an old fused item catches up on the next 获得 / 出售).
  const goldenOf = (id) => {
    const gd = ps.m && ps.m.gd;
    const rec = gd && typeof gd.item === 'function' ? gd.item(id) : null;
    const gold = rec && typeof rec.goldenId === 'string' ? rec.goldenId : null;
    return gold && !rec.isGolden ? gold : id;
  };
  let made = 0;
  let advanced = 0;
  for (const c of list) {
    if (!c || c.kind !== 'chess' || !Array.isArray(c.items)) continue;
    // 追溯：already-fused 百变 items get their components advanced too (no second fusion, same item)
    for (let i = 0; i < c.items.length; i++) {
      const it = c.items[i];
      if (!it || it.kind !== 'item' || !Array.isArray(it.merged)) continue;
      const next = it.merged.map(goldenOf);
      if (next.every((id, k) => id === it.merged[k])) continue;
      c.items = c.items.slice();
      // the components' own uids ride along (a 百变 keeps its counters when a component is advanced)
      c.items[i] = { ...it, merged: next };
      advanced++;
    }
    if (c.items.length < 2) continue;
    // one 百变 per operator: an operator that already carries a fused piece keeps it, and a third/fourth item (整装待发's
    // 3 slots) never forges a SECOND one — 「融合成装备百变」 is one item, not a growing pile.
    if (c.items.some((it) => it && Array.isArray(it.merged))) continue;
    // only UNFUSED equipment may pair up — 百变 is never an input again
    const plain = c.items.filter((it) => it && it.kind === 'item' && !Array.isArray(it.merged));
    if (plain.length < 2) continue;
    const [a, b] = plain;
    const at = Math.min(c.items.indexOf(a), c.items.indexOf(b));
    c.items = c.items.filter((it) => it !== a && it !== b);
    // the components' own `state` rides along: 万物归虚's banked layers must not be lost when 锻炉 fuses it away
    const state = mergeItemState(a.state, b.state);
    // 业主 2026-11-04「锻炉融合两个商业包装方案成百变，商业包装方案失效」: per-item prep effects count per PIECE
    // (`pack:<uid>` for 商业包装方案's sell counter) and a fused 百变 hides two pieces inside one row entry. Give the
    // components their own uids once, here, so the dispatcher's expansion (effectsMeta.js `wornItems`) can hand each
    // one its own counters — two fused 商业包装方案 must count like two, not like one twice.
    const nextUid = () => (ps.m && typeof ps.m.nextUid === 'function' ? ps.m.nextUid() : b.uid);
    const fused = {
      uid: nextUid(),
      kind: 'item', id: itemId, merged: [goldenOf(a.id), goldenOf(b.id)],
      mergedUids: [a.uid, b.uid].map((u) => (Number.isInteger(u) && u > 0 ? u : nextUid())),
      ...(state ? { state } : null),
    };
    c.items.splice(Math.max(0, Math.min(at, c.items.length)), 0, fused);
    made++;
  }
  if (made || advanced) {
    try { if (typeof ps.recompute === 'function') ps.recompute(); } catch { /* the fusion is already written; a recompute fault is the caller's */ }
    if (typeof ps.dirty === 'function') ps.dirty();
  }
  return made;
}



/** The client's view of one offered hex. No art field: the card face is the rarity's tier (client-side, from the local
 * manifest) — the third-party rune names this used to carry were removed on 2026-10-12. */
export function hexView(hex, idx = null) {
  const v = { id: hex.id, name: hex.name, desc: hex.desc, rarity: hex.rarity };
  // 核心盟约专属协议 (业主 2026-10-24): the gate rides the view so the client COULD label the card 「仅【X】激活时」.
  if (typeof hex.requiresBond === 'string' && hex.requiresBond) v.requiresBond = hex.requiresBond;
  if (idx != null) v.idx = idx;
  return v;
}

/** The client's view of one enemy hex the enemy side owns. */
export function enemyHexView(hex, drawRound = null) {
  const v = { id: hex.id, name: hex.name, desc: hex.desc, rarity: hex.rarity };
  if (drawRound != null) v.drawRound = drawRound;
  return v;
}

/**
 * Apply a picked 海克斯 to one player: the content handler for the immediate part, the persistent EffectRef for the
 * per-round part, then every other source observes the pick.
 *
 * A `team: true` hex (0.3.0 playtest #2, 共鸣协议) reaches **every alive teammate** the same way 机变's team tactic cards
 * do (choices.js `applyCard`): each target runs the handler through *its own* ctx and keeps its own EffectRef, so the
 * per-round half runs for teammates too — no cross-player mutation and no new ctx surface.
 *
 * @param {import('./Match.js').Match} m
 * @param {import('./PlayerState.js').PlayerState} ps
 * @param {object} hex a data/hextech.json playerHexes record
 */

/**
 * 万物归虚's PREP half (业主 2026-10-19; re-homed onto the EQUIPMENT 2026-10-26): 「获得装备「万物归虚」效果为装备时 将移除
 * 备战区所有干员，战斗开始时获得「移出干员数」层（20x%攻击力，减少30x点收到的伤害）」.
 *
 * 「备战区」 is the players' word for the 整备区 (docs/history/0.2.0.md §25.22.7) — the HAND and the overflow queue. So
 * "remove every operator in the reserve" empties this player's hand / temp of CHESS pieces (operators). Equipment and
 * summons are not 干员 and stay; the removed operators go back to the pool exactly like a sell, minus the funds — the
 * equipment pays no money for them.
 *
 * The count is banked on **the item piece that was just equipped** (`item.state[id].voidLayers`, additive), not on the
 * card's ref: the card only hands the item out, and any other source hands it out too (神器整备, the workshop, the test
 * panel) — the layers belong to the equipment (业主 2026-10-26「所有协议装备都依靠对应的协议源石生效的bug这个还没修」).
 * server/match/player/round.js `battleInput` carries it into the battle as `unit.itemState[id]` and
 * server/sim/content/items/protocol.js reads it there.
 *
 * [ASSUMED: 1) 「备战区」 = hand + overflow temp of THIS player; 2) the operators are removed, not sold: no funds, and
 *   they return to the shared pool as a sell does; 3) their carried equipment returns to the hand (a sell's own rule);
 *   4) "装备时" is the moment the ITEM is equipped — the card's own text — so this runs from the equip path
 *   (PlayerState.equip → `_voidReturnOnEquip`) and a later re-equip counts again. There is deliberately no pick-time
 *   call any more: the card does not own the count.]
 * @param {import('./Match.js').Match} m
 * @param {import('./PlayerState.js').PlayerState} ps
 * @param {object} item the 万物归虚 item PIECE that was just equipped
 * @returns {number} how many operators were removed
 */
export function applyVoidReturnLayers(m, ps, item) {
  if (!ps || !item || item.kind !== 'item' || item.id !== VOIDRETURN_ITEM_ID) return 0;
  let removed = 0;
  // hand first, then the overflow queue: both are the 整备区
  for (const list of [ps.hand || [], ps.temp || []]) {
    for (let i = 0; i < list.length; i++) {
      const piece = list[i];
      if (!piece || piece.kind !== 'chess') continue;
      const loc = ps.find ? ps.find(piece.uid) : null;
      if (loc) ps._detach(loc); else list[i] = null;
      ps.removeTokensOf?.(piece.uid);
      for (const it of piece.items || []) ps.stow(it, { allowTemp: true });
      piece.items = [];
      ps.returnCopies?.(piece);
      removed++;
    }
  }
  try { ps.recompute(); } catch (e) { m.reportError?.('voidreturn recompute', e); }
  // the layers ride the equipment piece (battleInput → unit.itemState → items/protocol.js)
  const state = (item.state ||= {});
  const slot = (state[item.id] ||= {});
  const prev = Number.isFinite(Number(slot.voidLayers)) ? Number(slot.voidLayers) : 0;
  slot.voidLayers = prev + removed;
  ps.dirty?.();
  return removed;
}

export function applyHex(m, ps, hex, opts = {}) {
  const team = !!(hex.effect && hex.effect.team);
  const targets = team ? [ps, ...m.alivePlayers().filter((p) => p !== ps)] : [ps];
  // the picker's OWN EffectRef for this gain: 策略「管理员」/ 复制 add a SECOND ref of the same card, and the extras below
  // stamp per-ref state (盟约寄生's partner, 背水一战's window) onto it — looking the card up by its base id instead always
  // answered with the FIRST ref, so two 盟约寄生 shared one slot and only the last partner was ever drained
  // (业主 2026-10-27「多个盟约寄生有bug，好像是只会寄生最后一个人」).
  let pickerRef = null;
  for (const p of targets) {
    const ev = { hex: { ...hex }, picker: ps.playerId, forTeammate: p !== ps };
    // 潘多拉魔盒 (owner bug report 2026-10-17): the card has to OWN ITSELF while its own onPick runs.
    // replaceHexes() drops every `hex:` ref — the running card included — and re-grants one card per owned ref, so the
    // ref must be added BEFORE the handler. With the old order (add after) the card replaced the others and was then
    // added back on top (「潘多拉不变自己」), and a player who owned nothing but the card got nothing at all.
    const gainedRef = addHexRef(m, p, hex);
    if (p === ps) pickerRef = gainedRef;
    try { m.dispatcher.runKey(p, `hex:${hex.id}`, 'onHexPick', { kind: 'hex', hex }, ev); } catch (e) { m.reportError(`hex ${hex.id}`, e); }
    // `effect.onPick.lp` reaches EVERY target, not just the picker: a team hex's whole point is that each teammate gets
    // the same thing (DESIGN §29.1 "each target runs the handler through its own ctx"). This used to be gated by
    // `p === ps`, which silently halved 战争机器 — the picker took +5 LP and the teammates none.
    applyHexLp(m, p, hex);
    // every other source observes the pick (the hex's own key already ran above)
    m.dispatch(p, 'onHexPick', ev, { skipKey: `hex:${hex.id}` });
    // 层数里程碑的「获得时」半段 (业主 2026-11-01「层数一到就立刻发」): 绿洲 的 rung 声明在 `effect.onLayers.layerGift`
    // 上，`runOnPick` 只是让它在获得时也评估一次 —— 但派发器给 onHexPick 的是 `effect.onPick`，那份 spec 里没有
    // layerGift，于是「拿到卡时层数已经过线」的局要等下一次加层（通常是下一回合）才发。这里在获得时用**当前层数**回放
    // 一次该卡自己的 onLayers，rung 立刻结算；计数器是模拟器自己的那一套（`hex:<id>:layerGift:<at>`），所以
    // 回放与真正加层时的那次互斥，不会发两次。
    replayLayerGift(m, p, hex, gainedRef);
    // 复制 (业主 2026-10-25)：「随机复制一个拥有协议源石，自身消失」。 The spec handler only QUEUED it (a copy is another
    // GAIN, and only applyHex may grant one); drain here, after the pick has fully settled, so the copy cannot re-enter
    // the dispatch that armed it.
    drainPendingHexCopies(m, p, hex);
    // 复制 (业主 2026-11-01): 手上留着的那枚【复制】等的就是这一枚 —— 现在就复制它，然后消失
    resolveWaitingReplicate(m, p, hex);
    p.recompute();
  }
  // 策略「管理员」 — REPLACED 2026-10-25 (业主「管理员策略改成第一回合多选择一次海克斯」). The old mechanic was
  // 「当你获得协议源石时，复制一个。限一次。」 and it lived here, at the GAIN: `applyBandHexCopy` below. The strategy now
  // acts on the DRAFT instead — round 1 deals its owner one extra three-card offer (server/match/match/hexDraft.js
  // `_hexExtraPicksFor`, buff key `band_hex_extra_pick_r1`), so nothing runs on a gain.
  //
  // `applyBandHexCopy` is kept (exported, tested, and still the one seam a workshop pack may call) but no strategy
  // carries `band_hex_copy_once` any more, so `bandHexCopyCount()` returns 0 and it is a no-op for the shipped data.
  // 万物归虚 (业主 2026-10-19) has NO pick-time half any more: its text says 「装备时 将移除备战区所有干员」, so the removal
  // and the layer count belong to the EQUIPMENT and run from PlayerState.equip (→ applyVoidReturnLayers). The pick only
  // hands the item to the hand (业主 2026-10-26).
  applyHexExtras(m, ps, hex, { ...opts, ref: pickerRef });
  // 锻炉 (业主 2026-10-24): gaining the card fuses what is ALREADY worn — an operator standing there with two items turns
  // them into 百变 the moment the card lands (equips made later go through PlayerState.equip's own call).
  if (hex && hex.id === 'hex_forge') applyForgeFusion(ps);
  // 镜像协议 (owner report 2026-10-12): an armed copy is retried on EVERY gain, so the moment a teammate owns something
  // copyable the card pays out — including the gain that just happened inside this very call.
  resolveMirrorCopies(m);
}

/** The data key of 策略「管理员」's buff (data/bands.json → effect `aceffect_band_admin`, tools/build-data.mjs custom
 *  tables) and the `ps.counters` entry that spends it. */
const BAND_HEX_COPY_KEY = 'band_hex_copy_once';
const BAND_HEX_COPY_USED = 'band_hex_copy:used';

/**
 * 策略「管理员」(业主 2026-10-26): 「当你获得协议源石时，复制一个。限一次。」
 *
 * How many copies the player's strategy asks for (`band_hex_copy_once { count }`, 0 without it). Read off the band
 * record, not off a code table, so the number stays data (the same way bands/meta.js reads its blackboards).
 * @param {import('./Match.js').Match} m
 * @param {import('./PlayerState.js').PlayerState} ps
 * @returns {number}
 */
export function bandHexCopyCount(m, ps) {
  const bandId = ps && typeof ps.bandId === 'string' ? ps.bandId : null;
  const band = bandId && m && m.gd && typeof m.gd.band === 'function' ? m.gd.band(bandId) : null;
  for (const b of (band && Array.isArray(band.buffs) ? band.buffs : [])) {
    if (!b || b.key !== BAND_HEX_COPY_KEY) continue;
    const n = Number(b.bb && b.bb.count);
    return Number.isFinite(n) && n > 0 ? Math.trunc(n) : 1;
  }
  return 0;
}

/**
 * Pay 策略「管理员」for ONE gain (called from `applyHex`, once per player the hex actually reached).
 *
 * The payout has to live in this module rather than in the strategy's own meta handler
 * (server/sim/content/bands/meta.js): a copy is another GAIN, and `applyHex` is the only door to one. An `onHexPick`
 * handler could not do it either — it would re-enter the pipeline while the pick that fired it is still dispatching.
 *
 * 「复制一个」 = the card just gained, gained a second time; the owner picked 「刚拿到的那枚再来一次」 over 「额外随机一枚」
 * (2026-10-26). The copy is the SAME record, so `addHexRef` keeps one EffectRef (a card is owned once — the duplicate
 * adds nothing to its passive half) while its 获得时 half settles again through the ordinary handler: 战备津贴 pays a
 * second time, 后勤整备 hands out a second item, 二次抽取 rolls two more cards. A purely passive card (坚壁 /
 * 精锐训练) gains nothing from the duplicate [ASSUMED: that is the literal reading of 「复制一个」 the owner chose].
 *
 * 「限一次」 = once per player per match: the flag is a free-form `ps.counters` entry (PlayerState counters — never
 * reset at a round start), written BEFORE the copy is granted so the copy can never re-arm it.
 *
 * @returns {number} how many copies were granted (0 when the strategy is not held, or already spent)
 */
export function applyBandHexCopy(m, ps, hex, { depth = 0, gift = false } = {}) {
  if (!m || !ps || !hex || depth >= 2) return 0;
  // 业主 2026-10-24「应该改一下优先获得自己选的」: a card this player did not pick — a teammate's 全队 hex reaching them,
  // 无私奉献's roll, 镜像协议's copy — must not spend the once-per-match copy. Those callers pass `gift: true`.
  if (gift) return 0;
  const count = bandHexCopyCount(m, ps);
  if (count <= 0) return 0;
  if (!ps.counters || typeof ps.counters !== 'object') ps.counters = {};
  if (ps.counters[BAND_HEX_COPY_USED]) return 0;
  ps.counters[BAND_HEX_COPY_USED] = 1;
  let n = 0;
  for (let i = 0; i < count; i++) {
    try {
      // A SECOND REF, not a second `applyHex`: the dispatcher walks refs one at a time (effectsMeta.js step 6), so every
      // hook the card has — 获得时 here, plus every 每回合 / 每 N 回合 half — settles once per ref. `makeCtx` namespaces
      // this ref's counters by its id, so a ladder card keeps two independent ladders instead of overwriting one
      // (业主 2026-10-26「好多协议源石被'管理员'复制后只会触发1个」: the old code re-ran only the 获得时 half and one ref
      // meant 盟约回响 / 量产线 / 神器整备… never doubled).
      // 业主 2026-11-01: the copy is the SAME `applyCopiedHex` 复制 uses — a team card reaches every teammate there too
      // (one copy per target, the picker once), so 管理员 and 复制 can never diverge.
      const ref = applyCopiedHex(m, ps, hex, { depth: 1 });
      if (!ref) break;
      n++;
    } catch (e) { m.reportError(`hex ${hex.id} (管理员)`, e); }
  }
  ps.dirty?.();
  return n;
}

/**
 * 复制 (业主 2026-10-25)：**「随机复制一个拥有协议源石，自身消失」**.
 *
 * The card's `onPick` (`copyOwnedHex`) queues one job per target; this drains it after that target's pick settled.
 *  1. pick ONE random OTHER card the player already owns and gain it a second time — a 管理员-style second EffectRef
 *     (`hex:<id>#<copySeq>`), so the copy shares the card's `key` and both refs settle every hook (the 0.19.22
 *     mechanic), with per-ref counters kept apart by makeCtx;
 *  2. then remove 复制 itself: its refs are dropped and the card leaves the collection — 「自身消失」.
 *
 * 业主 2026-11-01「协议『复制』加个第一个时保留效果」：**没有可复制的对象时（它是你拿到的第一枚协议源石）不消失**，
 * 留在收藏里等；之后你每获得一枚协议源石，就用它复制**刚到手的那一枚**，然后它才消失 —— 见 `resolveWaitingReplicate`。
 *
 * Deterministic: the pick uses the match's seeded rng and a sort on the ids, so the same battle replays identically.
 * @param {any} m @param {any} ps @param {any} hex the card that queued the job (its own refs are the ones removed)
 */
function drainPendingHexCopies(m, ps, hex) {
  const jobs = Array.isArray(ps.pendingHexCopies) ? ps.pendingHexCopies.slice() : [];
  if (!jobs.length) return 0;
  ps.pendingHexCopies = [];
  let done = 0;
  for (const job of jobs) {
    // only the card that queued it may consume itself
    const srcId = job && typeof job.sourceHexId === 'string' ? job.sourceHexId : (hex && hex.id);
    if (srcId !== (hex && hex.id)) continue;
    // 1) the candidates: every OTHER card this player owns, deduped by catalogue id
    const owned = new Set();
    for (const e of ps.effects || []) {
      if (!e || typeof e.key !== 'string' || !e.key.startsWith('hex:')) continue;
      const id = e.data && typeof e.data.hexId === 'string' ? e.data.hexId : e.key.slice(4);
      if (id && id !== srcId) owned.add(id);
    }
    const candidates = [...owned].sort();
    // 业主 2026-11-01「协议『复制』加个第一个时保留效果」: 手上还没有别的协议源石可复制 ⇒ **不消失**，留在收藏里等 ——
    // 之后这个玩家再获得一枚协议源石时，由 `resolveWaitingReplicate` 复制**那一枚**、然后它才消失。
    //（旧行为：没得复制也照样把自己删掉，于是「第一张就是复制」等于白拿一张卡。）
    if (!candidates.length) continue;
    // 1) 自身消失先结算：下面那次复制会走 applyCopiedHex，而它每个目标都会问一次「留着的那枚【复制】要不要兑现」——
    //    这一枚还没摘掉的话会被再兑现一次，一次拿两张（业主 2026-11-01 的保留效果与「自身消失」在这里交接）。
    const before = (ps.effects || []).length;
    ps.effects = (ps.effects || []).filter((e) => !(e && typeof e.key === 'string' && e.key === `hex:${srcId}`));
    if (ps.effects.length !== before) ps.dirty?.();
    // 2) the copy: 随机挑一张自己已拥有的卡，再获得一次
    const pickId = candidates[Math.floor(m.rngHex() * candidates.length) % candidates.length];
    const target = m.gd.hex(pickId);
    // 业主 2026-11-01: 复制的**team 卡**（战争机器）要按 applyHex 的 targets 发到每个队友，不只是复制者自己 ——
    // applyCopiedHex 就是 applyHex 的「第二个 ref」版本（见它的注释）。
    if (target) applyCopiedHex(m, ps, target, { depth: 1, copiedBy: srcId });
    done++;
  }
  return done;
}

/**
 * 复制 的第二段（业主 2026-11-01「协议『复制』加个第一个时保留效果」）：等它终于有对象时。
 *
 * 【复制】是玩家拿到的**第一枚**协议源石（或拿到时手上没有别的卡）时，`drainPendingHexCopies` 不再让它消失，而是把它
 * 留在收藏里等：之后这个玩家**再获得**一枚协议源石，就用这枚留着的【复制】去复制**刚到手的那一枚**（不掷骰，就是它），
 * 然后【复制】才消失 —— 口径「留到下一张，用完再消失」。
 *
 * 每个「获得」只兑现一枚：同时留着多枚【复制】（镜像协议 / 策略「管理员」的副本）时，每次获得消耗其中一枚，其余继续等。
 * 只在「获得」这条路上兑现（`applyHex` / `applyCopiedHex` 的每个目标各调一次），所以回合结算、商店刷新这些没有
 * 「获得」的时刻不会凭空发作。刚到手的就是【复制】本身时不动 —— 卡面「复制一个你**已拥有**的协议源石」不含自己。
 *
 * @param {any} m @param {any} ps @param {any} gainedHex 刚获得的卡（catalogue record）
 * @returns {number} 这次兑现了几枚【复制】（0 或 1）
 */
function resolveWaitingReplicate(m, ps, gainedHex) {
  if (!m || !ps || !gainedHex || !Array.isArray(ps.effects)) return 0;
  if (gainedHex.id === 'hex_replicate') return 0;            // 新到手的也是【复制】：继续等，不复制自己
  const waiting = ps.effects.find((e) => e && e.key === 'hex:hex_replicate');
  if (!waiting) return 0;                                    // 手上没有等着的那枚
  // 先摘掉这枚【复制】（「用完再消失」），再复制：复制自己会走 applyCopiedHex，其递归调用此时已经找不到它
  ps.effects = ps.effects.filter((e) => e !== waiting);
  ps.dirty?.();
  try {
    applyCopiedHex(m, ps, gainedHex, { depth: 1, copiedBy: 'hex_replicate' });
  } catch (e) { m.reportError?.('hex 复制（保留后兑现）', e); }
  return 1;
}

/** `effect.onPick.lp` (the ctx has no LP mutator and LP is match state, not sim state). */
function applyHexLp(m, ps, hex) {
  const spec = hex.effect && hex.effect.onPick;
  const lp = spec ? spec.lp : 0;
  if (typeof lp === 'number' && Number.isFinite(lp) && lp !== 0) {
    ps.lp = Math.max(0, ps.lp + Math.trunc(lp));
    ps.dirty();
  }
  // 背水一战 (业主 2026-10-24): 「目标生命自动变为1」 — a SET, not a delta (`lpSet`). Applied after the delta branch so a
  // card carrying both would end on the set value.
  const set = spec ? Number(spec.lpSet) : NaN;
  if (Number.isFinite(set) && set >= 0) {
    ps.lp = Math.trunc(set);
    ps.dirty();
  }
  void m;
}

// ---------------------------------------------------------------------------------------------------------------
// 层数里程碑的「获得时」半段 (业主 2026-11-01)
// ---------------------------------------------------------------------------------------------------------------

/**
 * 这张卡的 `effect.onLayers` / `effect.onPick` 上有没有层数里程碑（`layerGift`）。目前只有【绿洲】
 * （`data/hextech.json` hex_sargon_oasis：60 层给缇缇、325 层给黄沙罗盘）。
 * @param {any} hex
 */
function hasLayerGift(hex) {
  const eff = hex && hex.effect;
  if (!eff || typeof eff !== 'object') return false;
  for (const k of ['onLayers', 'onPick']) {
    const spec = eff[k];
    if (spec && typeof spec === 'object' && spec.layerGift && typeof spec.layerGift === 'object') return true;
  }
  return false;
}

/**
 * 层数里程碑的「获得时」评估（业主 2026-11-01「层数一到就立刻发」）。
 *
 * 根因：绿洲 的 rung 挂在 `effect.onLayers.layerGift` 上（`runOnPick: true` 只是让它在获得时也评估一次），可是派发器
 * 给 `onHexPick` 的 spec 是 `effect.onPick` —— 那份里没有 layerGift。于是「拿到卡时该盟约的层数已经过线」的局
 * （后期常见）在获得的那一刻什么都不发，要等下一次加层（往往就是下一回合的回合开始）才补上，业主看到的就是
 * 「有时候要拖到下回合才发」。
 *
 * 做法：用**当前层数**回放这张卡自己的 `onLayers` 一次（`from === to`），让模拟器那份 handler 自己判断 rung、
 * 自己发奖、自己记计数器 —— 这里不复制发奖逻辑，所以将来 rung 的写法变了也不用改两处。计数器键与真正加层时同一个
 * （`hex:<id>:layerGift:<at>`，见 server/sim/content/hextech.js applySpec），因此互斥、同一 rung 只发一次；
 * 一张卡的多个 ref（策略「管理员」/ 复制）共用同一个计数器（`addHexRef` 的 `data.sharedCounters`），所以复制不会重复发。
 *
 * [ASSUMED] 回放会跑该卡 `effect.onLayers` 上的**全部** spec（不只 layerGift）—— 目前只有绿洲一张卡用这一格，
 * 且它只有 layerGift；将来若有卡在 onLayers 上挂别的、对「层数没变」敏感的效果，这里要改成按 spec 过滤。
 * @param {any} m @param {any} ps @param {any} hex @param {any} [ref] 这次获得自己的 ref（计数器命名空间）
 * @returns {boolean} 是否回放了
 */
function replayLayerGift(m, ps, hex, ref = null) {
  if (!hasLayerGift(hex)) return false;
  const eff = hex.effect;
  const spec = (eff.onLayers && eff.onLayers.layerGift) || (eff.onPick && eff.onPick.layerGift) || null;
  const bondId = spec && typeof spec.bondId === 'string' ? spec.bondId : '';
  if (!bondId || !m || !m.dispatcher || typeof m.dispatcher.runKey !== 'function') return false;
  const cur = Number((ps.layers && ps.layers[bondId]) || 0);
  try {
    m.dispatcher.runKey(ps, `hex:${hex.id}`, 'onLayers', { kind: 'hex', hex, ref }, { bondId, from: cur, to: cur, reason: 'hex_pick' });
  } catch (e) { m.reportError?.(`hex ${hex.id} (layer gift)`, e); }
  return true;
}

/**
 * 一张卡的「复制」（策略「管理员」/ 复制）：把同一张卡再获得一次，作为第二个 EffectRef（`hex:<id>#<copySeq>`）。
 *
 * 口径与 `applyHex` 一致（业主 2026-11-01 bug 报告：三阶【战争机器】被【复制】后队友没拿到第二次 +5 目标生命）：
 * **team 卡按 `applyHex` 的 targets 发** —— 每个目标（复制者自己 + 每个存活队友，各一次）都跑自己的 `onHexPick`、
 * 自己的 `applyHexLp`、自己的 `m.dispatch`；已死亡的队友不发，复制者自己只发一次。
 * 与 `applyHex` 的差别只有两处：这是**第二个 ref**（每个目标在自己的 ref 列表里取下一个空号），
 * 以及 `applyHexExtras` 只对复制者跑一次（债务 / 二次抽取 / 盟约寄生 这些是「获得者」的半段，不是每个队友的）。
 *
 * 潘多拉魔盒 也用它（业主 2026-11-03）：换回来的张数必须等于换掉的张数，池子里的 3 阶卡不够时多出来的那几张发成
 * 「同一张卡的第二个 ref」，而不是被 `addHexRef` 的「一张卡一个 ref」去重掉（那会让玩家凭空少一张）。
 *
 * @param {any} m @param {any} ps 复制者 @param {any} hex 被复制的卡记录
 * @param {{ depth?: number, copiedBy?: string|null }} [opts]
 * @returns {any|null} 复制者自己那份 ref（没有则 null）
 */
export function applyCopiedHex(m, ps, hex, { depth = 1, copiedBy = null } = {}) {
  if (!m || !ps || !hex) return null;
  const team = !!(hex.effect && hex.effect.team);
  const targets = team ? [ps, ...m.alivePlayers().filter((p) => p !== ps)] : [ps];
  let pickerRef = null;
  for (const p of targets) {
    // the copy is a second ref of the SAME card: the next free copySeq in THIS player's own ref list
    let copySeq = 2;
    while ((p.effects || []).some((e) => e && e.id === `hex:${hex.id}#${copySeq}`)) copySeq++;
    const ref = addHexRef(m, p, hex, { copySeq });
    if (p === ps) pickerRef = ref;
    const ev = { hex: { ...hex }, picker: ps.playerId, forTeammate: p !== ps, copySeq, copiedBy };
    try {
      m.dispatcher.runKey(p, ref.key, 'onHexPick', { kind: 'hex', hex, ref, copySeq }, ev);
      applyHexLp(m, p, hex);
      m.dispatch(p, 'onHexPick', ev, { skipKey: ref.key });
      // 层数里程碑：副本也是一次「获得」（计数器与原件共用 ⇒ 同一 rung 不会因为复制而发第二次）
      replayLayerGift(m, p, hex, ref);
      // 复制 (业主 2026-11-01): 「获得」也包含复制来的这一份 —— 留着的【复制】在副本上同样兑现
      resolveWaitingReplicate(m, p, hex);
      p.recompute?.();
    } catch (e) { m.reportError?.(`hex ${hex.id} (copy)`, e); }
  }
  if (pickerRef) applyHexExtras(m, ps, hex, { depth, ref: pickerRef });
  return pickerRef;
}

// ---------------------------------------------------------------------------------------------------------------
// 【特限恢复】(`hex_mode_modules`) 的价格半边：有特限模组的干员购买价格 −N（业主 2026-11-01）
// ---------------------------------------------------------------------------------------------------------------

/**
 * 【特限恢复】的价格参数（卡面参数驱动，数值不写死）。卡面（roster，业主 2026-11-01 定稿）：
 *   `effect.onPrice.specialLimitDiscount = { delta: -2, min: 1, types: ['ISW','SO','RA'] }`
 *   `effect.modeModules = { level: 3, types: ['ISW','SO','RA'] }`
 * `types` 优先取 `specialLimitDiscount.types`（卡面定稿的形状），退到 `modeModules.types`，再退到三个特限类型；
 * 也接受把 `specialLimitDiscount` 直接写在 `effect` 顶层（手写 ref / 老写法）。没有这张卡 ⇒ null。
 *
 * 只读 `params`（`addHexRef` 把 `effect` 摊平进去），所以存档里的老 ref、测试手搓的 ref 都能被读到。
 * 不做缓存：`ps.effects` 是**原地 push/filter 的同一个数组**（获得卡时长度会变），按数组身份缓存会读到上一次的旧答案
 * （踩过：先缓存了 null，之后拿到卡也永远 null）。ref 数量很小，逐条扫就够了。
 * @param {{ effects?: any[] } | null} ps
 * @returns {{ delta: number, min: number, types: string[] } | null}
 */
export function specialLimitPriceOf(ps) {
  const effects = ps && Array.isArray(ps.effects) ? ps.effects : null;
  if (!effects) return null;
  for (const e of effects) {
    if (!e || typeof e !== 'object') continue;
    const p = e.params && typeof e.params === 'object' ? e.params : {};
    const raw = (p.onPrice && p.onPrice.specialLimitDiscount) || p.specialLimitDiscount;
    if (!raw || typeof raw !== 'object') continue;
    const delta = Number.isFinite(Number(raw.delta)) ? Math.trunc(Number(raw.delta)) : -2;
    const min = Number.isFinite(Number(raw.min)) ? Math.max(0, Math.trunc(Number(raw.min))) : 1;
    const list = Array.isArray(raw.types) ? raw.types
      : (p.modeModules && Array.isArray(p.modeModules.types) ? p.modeModules.types : null);
    const types = (list || ['ISW', 'SO', 'RA']).map((x) => String(x).toUpperCase().replace(/-$/, '')).filter(Boolean);
    return { delta, min, types };
  }
  return null;
}

/** base chess id → 是否有特限模组，按 `gd` 缓存（一局一份数据，商店定价每格都会问）。 */
const SPECIAL_LIMIT_MODULE_CACHE = new WeakMap();

/**
 * 该干员（普通或精锐形态都算同一个人）**存在特限模组**吗 —— 模组类型以 `types` 之一开头（ISW- / SO- / RA-）。
 * 读精锐记录的 `modules[]`：普通形态的记录没有模组列表，只有默认模组的 id/type（`module`），所以要看它的精锐兄弟。
 * @param {any} gd GameData（`ps.gd` / `m.gd`）
 * @param {unknown} chessId 商店格子里的 id（`_a` / `_b` 都行）
 * @param {string[]} [types] 模组类型前缀
 */
export function hasSpecialLimitModule(gd, chessId, types = ['ISW', 'SO', 'RA']) {
  if (!gd || typeof chessId !== 'string' || !chessId) return false;
  let perGd = SPECIAL_LIMIT_MODULE_CACHE.get(gd);
  if (!perGd) { perGd = new Map(); SPECIAL_LIMIT_MODULE_CACHE.set(gd, perGd); }
  const key = `${chessId}|${types.join(',')}`;
  const hit = perGd.get(key);
  if (hit !== undefined) return hit;
  let found = false;
  const seen = new Set();
  const consider = (rec) => {
    if (!rec || typeof rec !== 'object' || seen.has(rec) || found) return;
    seen.add(rec);
    for (const m of Array.isArray(rec.modules) ? rec.modules : []) {
      if (!m || typeof m !== 'object') continue;
      const type = String(m.typeName ?? m.type ?? '').toUpperCase();
      if (types.some((t) => type.startsWith(`${t}-`))) { found = true; return; }
    }
  };
  try {
    const base = typeof gd.baseIdOf === 'function' ? gd.baseIdOf(chessId) : chessId;
    if (typeof gd.chess === 'function') {
      consider(gd.chess(base));
      if (!found && typeof gd.goldenIdOf === 'function') consider(gd.chess(gd.goldenIdOf(base)));
      if (!found) consider(gd.chess(chessId));
    }
  } catch { /* a data view that refuses the id: no discount */ }
  perGd.set(key, found);
  return found;
}

/**
 * 【特限恢复】对这个商店棋子的价格修正：`{ delta, min }` 或 null（拥有卡 + 该干员有特限模组才生效）。
 * 读取点：`server/match/player/economy.js priceOf`（商店显示、购买扣款、测试场干员选择器都走它）。
 * @param {{ effects?: any[], gd?: any, m?: any } | null} ps
 * @param {unknown} chessId
 */
export function specialLimitDiscountOf(ps, chessId) {
  const spec = specialLimitPriceOf(ps);
  if (!spec || !(spec.delta < 0)) return null;
  const gd = (ps && ps.gd) || (ps && ps.m && ps.m.gd) || null;
  if (!hasSpecialLimitModule(gd, chessId, spec.types)) return null;
  return { delta: spec.delta, min: spec.min };
}

/**
 * 镜像协议's pending copy (owner report 2026-10-12): the pick used to resolve its copy IN PLACE, so a player who picked
 * before any teammate owned a card copied nothing and the card was silently dead for the rest of the match — the draft
 * is PARALLEL, and the seat that answers first sees an empty ally pool. Owner's wording: 「当其他人没有协议源石时不生效。
 * 修改效果使其当之后可以获得别人的」.
 *
 * The card is therefore ARMED instead: `pendingMirror` holds the picker's id and the ids it already owns at that moment
 * (so the copy is a card the teammate gained, never one of its own), and `resolveMirrorCopies` pays it out the moment
 * somebody owns something copyable. A solo match can never pay it out (there is no teammate) [ASSUMED: the official text
 * names a 队友], and the arm is dropped when the picker is gone.
 *
 * The pending list lives on the match (`m.pendingMirror`), not on the player: it is match-level state exactly like the
 * draft that produced it, and it must survive the picker's own refs being rebuilt.
 * @param {import('./Match.js').Match} m
 * @param {import('./PlayerState.js').PlayerState} ps
 * @param {object} hex the 镜像协议 record
 */
function armMirrorCopy(m, ps, hex) {
  if (!ps || typeof ps.playerId !== 'string') return;
  const list = (m.pendingMirror ||= []);
  // one arm per picker: a second 镜像协议 (a copy of it, a test-field grant) must not stack a second payout
  if (list.some((e) => e && e.pickerId === ps.playerId)) return;
  list.push({ pickerId: ps.playerId, hexId: hex.id, owned: hexIdsOf(ps) });
}

/**
 * Pay out every armed 镜像协议 whose picker can copy something now. Called after each `applyHex` (so the gain that just
 * landed counts) and at each round start (so a card a teammate drafts later in the SAME draft is picked up).
 *
 * One entry is resolved at most once: the copy is granted through the ordinary `applyHex`, which dedupes the EffectRef,
 * and the entry is removed whether or not a candidate was found. A copy that is itself a 镜像协议 re-arms the picker via
 * `applyHex → applyHexExtras`, and the `list.some` guard in armMirrorCopy keeps that from stacking.
 *
 * The payout re-enters `applyHex`, which calls this function again: the guard makes the nested call a no-op so the outer
 * pass stays the single owner of the list (a nested pass would splice entries under the outer loop's index).
 * @param {import('./Match.js').Match} m
 */
export function resolveMirrorCopies(m) {
  const list = Array.isArray(m && m.pendingMirror) ? m.pendingMirror : null;
  if (!list || !list.length || (m && m._resolvingMirror)) return;
  if (m) m._resolvingMirror = true;
  try {
    for (let i = list.length - 1; i >= 0; i--) {
      const pend = list[i];
      const picker = m.players.get(pend.pickerId);
      if (!picker || !picker.alive) { list.splice(i, 1); continue; }
      const copy = mirrorCandidate(m, picker, pend);
      if (!copy) continue;          // nobody owns anything copyable yet: stay armed for a later gain
      list.splice(i, 1);
      // `gift: true` — 镜像协议's copy is a card ANOTHER player chose; 策略「管理员」must not spend its once-per-match
      // copy on it (业主 2026-10-24「应该改一下优先获得自己选的」).
      try { applyHex(m, picker, copy, { depth: 1, gift: true }); } catch (e) { m.reportError(`hex ${copy.id} (mirror)`, e); }
    }
  } finally {
    if (m) m._resolvingMirror = false;
  }
}

/**
 * The hex an armed 镜像协议 copies: a random one of the teammate-owned cards the picker does not own, highest rarity
 * first (the card's own 「优先阶位更高的一枚」). The picker's own cards are excluded by `pend.owned` plus a live read, so
 * a card it gained after arming is never copied off a teammate by accident. Null when there is nothing to copy.
 *
 * 业主 2026-10-27「ban 了的协议源石能被潘多拉摇出来」→「补上镜像协议的过滤，队友持有你禁用的卡时不会再复制给你」：
 * 复制**也是我的一次获得**，所以它必须和自己的抽卡池同一个判据 —— 也就是 `hexPoolFor` 里那两条，缺一不可：
 *   1. **我禁用的**（`hexBans`）：队友手里那张照样不能复制过来；
 *   2. **我盟约没激活的专属卡**（`requiresBond`）：只在某核心盟约激活时才会刷出的第 7 回合专属协议，
 *     我的池子里根本不出现，镜像当然也不能从队友那儿把它带回来（队友激活了、我没有，不是我的牌）。
 * 判据只问「**接受方**的池子要不要它」，与提供方是谁无关；这样以后给 `hexPoolFor` 加第三条规则时，镜像自动跟上。
 * @returns {object|null} the data record
 */
function mirrorCandidate(m, picker, pend) {
  const mine = new Set([...(pend.owned || []), ...hexIdsOf(picker)]);
  const pool = [];
  for (const ally of m.alivePlayers()) {
    if (ally === picker) continue;
    for (const id of hexIdsOf(ally)) {
      if (id === pend.hexId || mine.has(id)) continue;
      const rec = m.gd.hex(id);
      // `hexAvailableTo` = the SAME 专属-card rule `hexPoolFor` applies (bans are checked separately, on the whole
      // pool below): a card my own draft could never show me is not a card I may take off a teammate either.
      if (rec && hexAvailableTo(picker, rec)) pool.push(rec);
    }
  }
  const bans = new Set(Array.isArray(picker.hexBans) ? picker.hexBans : []);
  for (let i = pool.length - 1; i >= 0; i--) if (bans.has(pool[i].id)) pool.splice(i, 1);
  if (!pool.length) return null;
  const rank = { silver: 0, gold: 1, prismatic: 2 };
  const best = pool.reduce((mx, h) => Math.max(mx, rank[h.rarity] ?? 0), 0);
  const top = pool.filter((h) => (rank[h.rarity] ?? 0) === best);
  return top[Math.min(top.length - 1, Math.floor(m.rngHex() * top.length))] || null;
}

/**
 * The two match-level picks that need more than one player's ctx (0.3.0 playtest #2):
 *   — 镜像协议 `copyAllyHex`: copy a random hex an alive teammate owns, highest rarity first;
 *   — 二次抽取 `randomHexes: N`: gain N extra random hexes (weighted, never one already owned).
 * Both re-enter applyHex with `depth` guard so they can never chain forever. The enemy's rarity draw stays based on the
 * drafted pick only (these extra gains are free and do not feed 强敌).
 */
function applyHexExtras(m, ps, hex, { depth = 0, ref: gainRef = null } = {}) {
  const spec = hex.effect && hex.effect.onPick;
  if (!spec || depth >= 2) return;
  if (spec.copyAllyHex) armMirrorCopy(m, ps, hex);
  if (Number.isInteger(spec.randomHexes) && spec.randomHexes > 0 && depth < 2) {
    const pool = hexPoolFor(ps, m.gd);
    // 不屈余烬's draw weight (业主 2026-11-01): this is the PICKER's own pool, so the PICKER's 〖不屈〗 layers decide.
    const offer = rollOffers(m.rngHex, {
      pool, owned: hexIdsOf(ps), weights: m.gd.hexWeights(), count: spec.randomHexes,
      weightOf: (h) => hexDrawWeight(ps, h),
    });
    for (const id of offer) {
      const rec = m.gd.hex(id);
      if (rec) applyHex(m, ps, rec, { depth: depth + 1 });
    }
  }
  // 盟约寄生 (业主 2026-10-21 rework): pick a random living teammate at pick time (the 债务 convention — there is no
  // pick-a-teammate UI), and store that teammate's stackable-layer TOTAL as the first round's baseline. The round
  // starts (server/sim/content/hextech.js applySpec `parasiteShare`) compare against it and re-baseline. Solo: no
  // teammate ⇒ `partnerId: null` and the card is inert (the text says 队友).
  if (spec.pickTeammate === 'parasite') {
    const mates = m.alivePlayers().filter((p) => p !== ps);
    const partner = mates.length ? mates[Math.min(mates.length - 1, Math.floor(m.rngHex() * mates.length))] : null;
    // the ref of THIS gain (a 管理员 / 复制 second ref has its own id): `gainRef`, else the first ref of the card
    const ref = gainRef || (ps.effects || []).find((e) => e && (e.id === `hex:${hex.id}` || e.key === `hex:${hex.id}`));
    if (ref) {
      let baseline = 0;
      if (partner) {
        for (const [bondId, total] of Object.entries(partner.layers || {})) {
          const rec = m.gd.bond(bondId);
          if (rec && !rec.noStack) baseline += Number(total) || 0;
        }
      }
      const partnerName = partner ? String(partner.name || partner.playerId) : null;
      ref.params = { ...(ref.params || {}), parasite: { partnerId: partner ? partner.playerId : null, partnerName, baseline } };
      // 业主 2026-10-24:「可以让寄生者和被寄生者都知道寄生对象」 — the PICKER's side: the card's own line names the partner,
      // so the effects column says who is being drained instead of an anonymous pairing.
      if (partnerName) ref.desc = `${String(ref.desc || hex.desc)}（寄生对象：${partnerName}）`;
      ps.dirty();
    }
    // … and the HOST's side: a display-only watcher ref on the teammate, naming the picker. Its key is not in the
    // dispatcher's registry (`effect:hexparasite`), so it is never dispatched — it exists to be READ (the effects column).
    if (partner) {
      const wid = `effect:hexparasite:${ps.playerId}`;
      if (!(partner.effects || []).some((e) => e && e.id === wid)) {
        partner.effects.push({
          id: wid,
          key: PARASITE_HOST_KEY,
          name: '盟约寄生（被寄生）',
          desc: `队友 ${String(ps.name || ps.playerId)} 的【盟约寄生】以你为寄生对象：你每回合新增的盟约层数会被其分走一部分。`,
          iconKind: 'hex',
          counter: null,
          battle: false,
          params: { ownerId: ps.playerId, hexId: hex.id },
          data: { hexId: hex.id, rarity: hex.rarity, parasiteHost: true },
        });
        partner.dirty();
      }
    }
  }
  // 背水一战 (业主 2026-10-24): 「锁血两回合」 — the LP-loss window opens at the PICK and counts it as the first round.
  // Stamped here (match state knows the round) so the settlement only has to compare numbers.
  {
    const ld = hex.effect && hex.effect.lastDitch;
    const lockRounds = ld && Number(ld.lockRounds);
    if (Number.isFinite(lockRounds) && lockRounds > 0) {
      const ref = gainRef || (ps.effects || []).find((e) => e && (e.id === `hex:${hex.id}` || e.key === `hex:${hex.id}`));
      if (ref) {
        const window = Math.max(1, Math.trunc(Number(m.round) || 1)) + Math.max(1, Math.trunc(lockRounds)) - 1;
        ref.params = { ...(ref.params || {}), lastDitch: { ...((ref.params || {}).lastDitch || {}), ...ld, window } };
        ps.dirty();
      }
    }
  }
  // 无私奉献 (业主 2026-10-24): 「除自己外，队友额外随机获得一枚源石协议」 — every OTHER alive teammate gains N random
  // hexes. `team: true` cannot express it (that one reaches the picker too) and 二次抽取 is picker-only, so it is its
  // own spec. Same weighted roll as 二次抽取, never one the teammate already owns.
  if (Number.isInteger(spec.otherRandomHexes) && spec.otherRandomHexes > 0 && depth < 2) {
    for (const mate of m.alivePlayers()) {
      if (mate === ps) continue;
      const pool = hexPoolFor(mate, m.gd);
      // 不屈余烬's draw weight is per-PLAYER: each teammate draws from their OWN pool, so it is the TEAMMATE's
      // 〖不屈〗 layers that weigh this roll (not the picker's — 无私奉献 must not hand out a boosted card to a shallower
      // board, nor skip the boost on a deeper one).
      const offer = rollOffers(m.rngHex, {
        pool, owned: hexIdsOf(mate), weights: m.gd.hexWeights(), count: spec.otherRandomHexes,
        weightOf: (h) => hexDrawWeight(mate, h),
      });
      for (const id of offer) {
        const rec = m.gd.hex(id);
        // `gift: true` — 无私奉献 hands a teammate a card the PICKER's card rolled; 策略「管理员」waits for a gain of its
        // own (业主 2026-10-24「应该改一下优先获得自己选的」).
        if (rec) applyHex(m, mate, rec, { depth: depth + 1, gift: true });
      }
    }
  }
  // 债务 (sixth batch, the owner's list of 2026-10-11): 「获得时选取一名队友，队友金钱+3，3回合内队友购买干员时你获得
  // 一个相同干员。」 There is no pick-a-teammate UI in the draft flow, so the owner chose an automatic random living
  // teammate (2026-10-11). The payment is a plain addFunds here; the second half has to observe ANOTHER player's
  // purchases, and the dispatcher only runs a player's own effects — so a watcher ref (`effect:hexdebt`, handled by the
  // DEBT_HANDLER registered in server/sim/content/hextech.js registerMeta) is pushed onto the teammate, carrying the
  // picker's id and the window's last round. 「3回合内」 counts the pick's own round as the first, the same convention
  // 孤注一掷's `battleForRounds` uses (addHexRef above).
  //
  // Solo (no living teammate — the owner's decision, 2026-10-11): the first half falls on the player itself and the
  // watcher half is dropped, because there is nobody whose purchases could be watched.
  // 镜像协议 / 二次抽取 (owner report 2026-10-15): this used to be gated on `depth === 0`, so a 债务 GAINED through
  // 镜像协议 (`resolveMirrorCopies` re-enters `applyHex` with `depth: 1`) or 二次抽取 (`depth + 1`) ran none of its
  // onPick half — the copy landed as an inert `hex:hex_debt` ref with no +3 and, visibly, no watcher, so the card
  // never granted an operator. 「获得时」 describes the GAIN, not how the card was reached, and the recursion this
  // depth guard exists for is already stopped at the top of the function (`depth >= 2`, which also caps
  // 镜像→镜像 and 二次抽取→二次抽取): the extra `=== 0` only ever blocked legitimate gains. The per-(picker, card)
  // watcher id below still keeps a repeated gain from stacking a second observer.
  //
  // 业主 2026-10-29「债务显示放债对象」: the teammate is drawn at random with no UI, so the effects column used to show the
  // card's generic text and the picker could not tell WHO took the +3. The chosen target is stamped on THIS gain's own ref
  // (gainRef — the 盟约寄生 convention; a lookup by the base id always answered with the FIRST ref) and appended to its
  // desc, the same way 「寄生对象」 is shown. The teammate's watcher names the picker back, so both sides see the pairing.
  if (spec.debt) {
    const d = spec.debt;
    const funds = Number.isFinite(d.funds) ? Math.max(0, Math.trunc(d.funds)) : 3;
    const rounds = Number.isFinite(d.rounds) ? Math.max(1, Math.trunc(d.rounds)) : 3;
    const untilRound = Math.max(1, Math.trunc(Number(m.round) || 1)) + rounds - 1;
    const ref = gainRef || (ps.effects || []).find((e) => e && (e.id === `hex:${hex.id}` || e.key === `hex:${hex.id}`));
    const cardText = String(hex.desc || '');
    const mates = m.alivePlayers().filter((p) => p !== ps);
    if (!mates.length) {
      // `reason: 'hex_debt'` 的 `hex` 前缀 = 协议源石发的钱（业主 2026-11-01）：`player/economy.js addFunds` 按这个前缀
      // 把它从协议等级 19 的「一回合最多获得 30 资金」上限里豁免掉，所以这里不需要（也不该）用 `force: true`
      // —— `force` 还会把 `stats.fundsGained` 一起跳过，而这张卡的钱是玩家真正获得的。
      ps.addFunds(funds, { reason: 'hex_debt' });
      // Solo: the first half falls on the player itself, so the card says 自己 instead of naming a teammate that is not there
      if (ref) {
        ref.params = { ...(ref.params || {}), debt: { targetId: ps.playerId, targetName: String(ps.name || ps.playerId), untilRound } };
        ref.desc = `${cardText}（放债对象：自己）`;
        ps.dirty();
      }
    } else {
      const to = mates[Math.min(mates.length - 1, Math.floor(m.rngHex() * mates.length))];
      to.addFunds(funds, { reason: 'hex_debt' });
      const targetName = String(to.name || to.playerId);
      if (ref) {
        ref.params = { ...(ref.params || {}), debt: { targetId: to.playerId, targetName, untilRound } };
        ref.desc = `${cardText}（放债对象：${targetName}）`;
        ps.dirty();
      }
      const id = `${DEBT_EFFECT_KEY}:${ps.playerId}:${hex.id}`;
      if (!(to.effects || []).some((e) => e && e.id === id)) {
        to.effects.push({
          id,
          key: DEBT_EFFECT_KEY,
          // 债务（被放债）: the teammate does not own the card — this ref exists to be READ, so it says whose debt it is.
          name: '债务（被放债）', // i18n-ignore: server-side effect text (the 盟约寄生（被寄生） convention)
          desc: `队友 ${String(ps.name || ps.playerId)} 的【债务】以你为放债对象：${rounds} 回合内你购买干员时，其获得一个相同干员。`, // i18n-ignore: server-side effect text
          iconKind: 'hex',
          counter: null,
          battle: false,
          params: { ownerId: ps.playerId, hexId: hex.id, untilRound },
          data: { hexId: hex.id, rarity: hex.rarity, debt: true },
        });
        to.dirty();
      }
    }
  }
}

/**
 * The persistent EffectRef of a hex. `battle` is true whenever a battle reads the params — a `params.battle` passive OR
 * one of the third batch's ownership/conditional mechanics (`hasBattlePart`, server/sim/content/hextech.js): the sim's
 * 装甲破坏 / 击倒馈赠 / 北境长城 / 精准穿透 / 深度吞噬 / 不屈余烬 / 技能层涌 / 盟约裂变 / 特质扩散 readers key off the ref
 * itself, and 传承 accumulates its `params.battle.bondAtk` on a prep-side sale. Deriving the flag from `params.battle`
 * alone marked all of those `battle: false`, and `player/round.js battleInput` then dropped them from every battle's
 * `playerEffects` — the cards were owned, drafted and shown, but their battle half never ran.
 */
function addHexRef(m, ps, hex, { copySeq = 0 } = {}) {
  const id = copySeq > 0 ? `hex:${hex.id}#${copySeq}` : `hex:${hex.id}`;
  // one ref per hex per player: a team hex reaching a player who already drafted it must not run twice.
  // A COPY (策略「管理员」) is the one thing that must: it gets its own ref id (same `key`, so the same handler runs) —
  // the dispatcher walks `ps.effects` one ref at a time (effectsMeta.js dispatch step 6), so its per-round halves settle
  // twice, and `makeCtx` namespaces its counters by this ref id so the two copies' ladders (神器整备 / 后勤整备 / 心之钢)
  // never overwrite each other (业主 2026-10-26「好多协议源石被'管理员'复制后只会触发1个」).
  if (copySeq <= 0) {
    const existing = (ps.effects || []).find((e) => e && (e.id === id || e.key === id));
    if (existing) return existing;
  }
  const spec = hex.effect || {};
  // 孤注一掷 (0.3.0 playtest #3): `battleForRounds` = a battle passive that lapses after `rounds` rounds. The expiry is
  // read by the sim (content/hextech.js install) against the battle's own round.
  const timed = spec.battleForRounds && spec.battleForRounds.battle && typeof spec.battleForRounds.battle === 'object' ? spec.battleForRounds : null;
  const params = { ...spec, hexId: hex.id, rarity: hex.rarity };
  if (timed) {
    params.battle = { ...timed.battle };
    params.expireRound = Math.max(1, Math.trunc(Number(m.round) || 1)) + Math.max(1, Math.trunc(Number(timed.rounds) || 1)) - 1;
  }
  const ref = {
    id,
    key: `hex:${hex.id}`,
    name: hex.name,
    desc: hex.desc,
    iconKind: 'hex',
    counter: null,
    battle: hasBattlePart(params),
    params,
    // 层数里程碑（业主 2026-11-01「多张卡（含复制）不重复发」）：`layerGift` 的 rung 是「每档一次/局」，不是每个 ref 一条
    // 独立的梯子 —— 复制 / 策略「管理员」的第二个 ref 必须与原件共用同一个计数器（`makeCtx` 的 COUNTER_PREFIX 会读这个
    // 标记），否则同一张绿洲的两份 ref 会在同一档各发一次（实测：60 层给两只缇缇）。
    data: {
      hexId: hex.id, rarity: hex.rarity, ...(copySeq > 0 ? { copySeq } : null),
      ...(hasLayerGift(hex) ? { sharedCounters: true } : null),
    },
  };
  ps.effects.push(ref);
  ps.dirty();
  return ref;
}

/** The hex ids a player owns (in pick order), de-duplicated: a 策略「管理员」copy is a second ref of the SAME card, not
 * a second card — the draft pool, 潘多拉魔盒 and the battle flags all want the ownership list, not the ref list. */
export function hexIdsOf(ps) {
  const out = (ps.effects || []).filter((e) => e && typeof e.key === 'string' && e.key.startsWith('hex:')).map((e) => e.data && e.data.hexId).filter(Boolean);
  return out.filter((id, i) => out.indexOf(id) === i);
}

/** Whether the player owns a hex (0.3.0 playtest #3: several hexes act through ownership, not through a spec run). */
export function ownsHex(ps, hexId) {
  return Array.isArray(ps && ps.effects) && ps.effects.some((e) => e && e.data && e.data.hexId === hexId);
}

/** The active-bond cap a player's own hexes ask for (盟约裂变 `bondFission.cap`), 0 when none does. */
export function bondCapOf(ps) {
  for (const e of (ps && ps.effects) || []) {
    const cap = fissionCap(e && e.params && e.params.bondFission);
    if (cap > 0) return cap;
  }
  return 0;
}

/**
 * 【突破极限】(`hex_break_limit`, 3 阶 / prismatic, 设计稿 §3): the per-PLAYER 盟约叠层上限 of this player.
 *
 * 口径（只对拥有者）: 默认就是官方的 `BOND_LAYER_CAP`（999, shared/constants.js）。拥有带 `effect.bondCap.cap` 的卡
 * （`data/hextech.json` 记录 → `addHexRef` 把它摊平进 `params`，所以 ref 上是 `params.bondCap = { cap: 9999 }`）时取
 * `max(BOND_LAYER_CAP, cap)` —— 卡只会**抬高**上限，写一个更小的数不会把官方 999 压下来（同一格数值被别的内容写小是
 * 配置错误，不该变成削弱）。没有这张卡、cap 不是正有限数、或 BOND_LAYER_CAP 本身是 0（无上限）时，原样返回默认。
 *
 * 谁读它：备战侧的每一次加层 / 预览 / 结算 / 校验（player/economy.js addLayers·layerGainOf·setLayers、
 * bondsMeta.bondsWithGains、match/settle.js、fields.js 的客户端结果校验、invariants.js 的层数不变量），以及战斗侧
 * `PlayerBattleInput.bondLayerCap`（player/round.js battleInput → sim/battle/economy.js addLayers）。全部走同一个
 * 数值，所以 9999 的上限在备战、战斗、结算、客户端显示四处是同一个数（业主 2026-10-31「全部」）。
 * @param {{ effects?: any[] } | null} ps
 * @returns {number} the cap in layers (BOND_LAYER_CAP when nothing raises it)
 */
export function bondLayerCapOf(ps) {
  const base = BOND_LAYER_CAP > 0 ? BOND_LAYER_CAP : Infinity;
  let cap = base;
  for (const e of (ps && ps.effects) || []) {
    if (!e || typeof e !== 'object') continue;
    // 认卡的两种写法：ref 的 `data.hexId`（addHexRef 的常规形状）与 `key === 'hex:hex_break_limit'`（手写 / 存档里的老
    // ref，或者测试直接拼出来的 ref）—— 任一对上就算拥有
    const id = e.data && e.data.hexId;
    if (id !== BREAK_LIMIT_HEX_ID && e.key !== `hex:${BREAK_LIMIT_HEX_ID}`) continue;
    const v = Number(e.params && e.params.bondCap && e.params.bondCap.cap);
    if (Number.isFinite(v) && v > 0) cap = Math.max(cap, v);
  }
  return cap;
}

/**
 * 投资天才 (业主 2026-10-21): how many EXTRA 获得时 triggers a player's cards ask for (`gainTraitExtra`), 0 without
 * the card. Read by EffectDispatcher.investRepeat; the card's own `onGainTrait` banks the 投资人 layers separately.
 * @param {{ effects?: any[] }} ps
 * @returns {number}
 */
export function gainTraitExtraOf(ps) {
  let extra = 0;
  for (const e of (ps && ps.effects) || []) {
    const v = Number(e && e.params && e.params.gainTraitExtra);
    if (Number.isFinite(v) && v > 0) extra = Math.max(extra, Math.trunc(v));
  }
  return extra;
}

/**
 * 投资天才 (业主 2026-10-21): how many FEWER members a bond needs to activate (`bondNeedBonus { bondId, n }`),
 * 0 without such a card. bondsMeta.computeBonds subtracts it from the data thresholds; the member COUNT is untouched
 * (so the strip still shows the real number of members).
 * @param {{ effects?: any[] }} ps
 * @param {string} bondId
 * @returns {number}
 */
export function bondNeedBonusOf(ps, bondId) {
  let n = 0;
  for (const e of (ps && ps.effects) || []) {
    const spec = e && e.params && e.params.bondNeedBonus;
    if (!spec || spec.bondId !== bondId) continue;
    const v = Number(spec.n);
    if (Number.isFinite(v) && v > 0) n += Math.trunc(v);
  }
  return n;
}

/** The layer-gain multiplier of one bond (盟约裂变: the two kept bonds gain ×`mul`). 1 when the hex is absent. */
export function layerGainMulOf(ps, bondId) {
  let mul = 1;
  for (const e of (ps && ps.effects) || []) {
    const spec = e && e.params && e.params.bondFission;
    const cap = fissionCap(spec);
    if (cap > 0) {
      if (bondId && !fissionBondIds(ps, cap).has(bondId)) continue;
      mul *= fissionMul(spec);
    }
  }
  // 背水一战 (业主 2026-10-24 REWORK): the card no longer waits for a low LP — it SETS the LP to 1 on the pick and then
  // locks LP loss, so the ×layerMul half is simply always on. `freeRefresh` is a leftover of the old shape and is kept
  // only for a saved match from before the rework.
  const ld = lastDitchOf(ps);
  if (ld) mul *= ld.layerMul;
  return mul;
}

/**
 * 背水一战's spec of a player, or null.
 *
 * 业主 2026-10-24: the shape is now `{ lpSet, lockRounds, atkPct, layerMul }` — the LP is set to 1 when the card is
 * picked, LP LOSS is ignored for `lockRounds` rounds (`lpLockOf` below, read by the settlement), every own operator gets
 * `atkPct` in battle (`effect.battle`) and every bond gain is ×`layerMul`. The old `lpBelow` / `freeRefresh` fields are
 * still read so a saved card keeps a meaning.
 * @param {{ effects?: any[], lp?: number }} ps
 */
export function lastDitchOf(ps) {
  for (const e of (ps && ps.effects) || []) {
    const spec = e && e.params && e.params.lastDitch;
    if (!spec || typeof spec !== 'object') continue;
    const layerMul = Number(spec.layerMul);
    const lockRounds = Number(spec.lockRounds);
    const lpSet = Number(spec.lpSet);
    return {
      lpBelow: Number(spec.lpBelow) > 0 ? Number(spec.lpBelow) : 5,
      lpSet: Number.isFinite(lpSet) ? Math.max(0, Math.trunc(lpSet)) : 0,
      lockRounds: Number.isFinite(lockRounds) && lockRounds > 0 ? Math.trunc(lockRounds) : 0,
      layerMul: Number.isFinite(layerMul) && layerMul > 1 ? layerMul : 1.5,
      freeRefresh: spec.freeRefresh === true,
    };
  }
  return null;
}

/**
 * 背水一战's 「锁血」 window: the last round whose LP LOSS is ignored, or 0 when no window is open.
 *
 * The window opens at the PICK and counts it as the first of `lockRounds` (`window` = pickRound + lockRounds - 1, the
 * 孤注一掷 / 债务 convention). It is stored on the ref when the card is picked (`applyHexExtras`), so the settlement can
 * read it with no extra player state; an older card (no `window`) locks nothing.
 * @param {{ effects?: any[] }} ps
 * @param {number} [round] the round being settled (defaults to the stamp, so a caller can just ask "is it open?")
 * @returns {number} the last locked round (0 = no lock)
 */
export function lpLockUntilOf(ps) {
  for (const e of (ps && ps.effects) || []) {
    const spec = e && e.params && e.params.lastDitch;
    if (!spec || typeof spec !== 'object') continue;
    const until = Number(spec.window);
    if (Number.isFinite(until) && until > 0) return Math.trunc(until);
  }
  return 0;
}

/** Is this player's LP loss ignored in round `round` (背水一战's 锁血)? */
export function lpLockedIn(ps, round) {
  const until = lpLockUntilOf(ps);
  const r = Number(round);
  return until > 0 && Number.isFinite(r) && r <= until;
}

/**
 * 圣约回响 (§29.34): the multiplier a player's bond-LAYER thresholds and milestones read, i.e. the
 * `bondLayerViewPct` card's `1 + pct/100` (1 without the card). It is a VIEW: `PlayerState.layers` and every gain are
 * untouched, and 盟约 ACTIVATION is a member count, so it never moves either. The single reader is the hooks' own
 * `ctx.layers` (server/match/effectsMeta.js), which is what every milestone in server/sim/content/bonds/addon/meta.js
 * asks for its layer count — so the +50 % reaches exactly the "阈值奖励判定" the owner asked for.
 */
export function bondLayerViewMulOf(ps) {
  for (const e of (ps && ps.effects) || []) {
    const pct = e && e.params && e.params.bondLayerViewPct;
    if (Number.isFinite(pct) && pct > 0) return 1 + pct / 100;
  }
  return 1;
}

/** 升级刷新 (§29.34): the refresh price override a player's own hex asks for, or null. */
export function refreshPriceOverrideOf(ps) {
  for (const e of (ps && ps.effects) || []) {
    const spec = e && e.params && e.params.shopTune;
    if (!spec || typeof spec !== 'object') continue;
    const v = Number(spec.refreshPrice);
    if (Number.isFinite(v) && v >= 0) return Math.trunc(v);
  }
  return null;
}

/**
 * The bonds that own at least one OPERATOR (a visible base chess of their own), per GameData — the bonds a
 * `rollChess({ bond })` can answer with. Memoised per data table: the scan is over ~200 chess, the readers are rare.
 *
 * WHY: 绝技 (bonds.json `countMode: BOARD_ALL_CHESS`, weight 0) is a real bond with no operator of its own — its member
 * count is the number of ELITE operators on the board. Every card of the 人数最多盟约 family then hands out an OPERATOR
 * of that bond (三连透支 grants one, 升级刷新 / 紧急拨款 guarantee one in the shop), so a bond that owns none can never
 * answer. Ranking it as the top bond made those cards silently do nothing from the player's second elite on
 * (业主 2026-10-31「三连透支有bug，会出现不给干员的情况」; the earlier reports, 5684773 / bf62e26, only fixed the
 * pool-stock half of the same symptom). 绝技 is the only bond without operators in the shipped data today, so the filter
 * is written against the data rather than against the id — a workshop pack's own bond is handled the same way.
 * @type {WeakMap<object, Set<string>>}
 */
const bondOperatorCache = new WeakMap();
function bondsWithOperators(gd) {
  let set = bondOperatorCache.get(gd);
  if (set) return set;
  set = new Set();
  for (const id of (gd && Array.isArray(gd.visibleChess) ? gd.visibleChess : [])) {
    const rec = gd.chess(id);
    for (const bondId of (rec && Array.isArray(rec.bonds) ? rec.bonds : [])) set.add(bondId);
  }
  bondOperatorCache.set(gd, set);
  return set;
}

/**
 * The own bond with the most BOARD MEMBERS (ties → data order), read among the bonds that OWN an operator (see
 * `bondsWithOperators`), or null when the board holds none of those. The 人数最多盟约 several cards of the eleventh batch
 * talk about: 紧急拨款 / 三连透支 / 升级刷新. 盟约之主 ranks the same member COUNT at its own round start
 * (server/sim/content/hextech.js mainBondCount) but keeps 绝技 in the ranking on purpose — it hands out a −1 activation
 * threshold, which a member-count bond like 绝技 can use (it activates on the elite count), so an operator is not needed
 * there. Counts members only, never layers.
 * @param {any} ps @returns {string|null}
 */
export function topMemberBondOf(ps) {
  let best = null;
  let bestCount = 0;
  const gd = ps && ps.gd;
  const withOperators = gd ? bondsWithOperators(gd) : null;
  for (const [id, b] of Object.entries((ps && ps.bonds) || {})) {
    const c = b && Number.isFinite(b.count) ? b.count : 0;
    if (c <= bestCount) continue;
    if (withOperators && !withOperators.has(id)) continue;
    bestCount = c;
    best = id;
  }
  return best;
}

/**
 * The own ACTIVE bond with the most LAYERS (ties → data order), or null. 盟约寄生's "层数最高的已激活盟约" — the layer
 * ranking 盟约裂变 already uses (`fissionBondIds`), without its cap.
 * @param {any} ps @returns {string|null}
 */
export function topLayerBondOf(ps) {
  let best = null;
  let bestLayers = -1;
  for (const [id, b] of Object.entries((ps && ps.bonds) || {})) {
    if (!b || !b.active) continue;
    const l = Number.isFinite(b.layers) ? b.layers : 0;
    if (l > bestLayers) { bestLayers = l; best = id; }
  }
  return best;
}

/**
 * The `cap` active bonds with the most layers (ties → data order) — the bonds 盟约裂变 keeps.
 *
 * `bonds` lets a caller rank a state it is still building. `bondsMeta.js computeBonds` passes the fresh `out` it has
 * just filled in, because inside that function `ps.bonds` is still the PREVIOUS recompute's result — and a bond that
 * recompute suppressed sits there with `active: false`, so ranking the stale map can never let that bond back into the
 * keep-set. The card then stayed dead for the rest of the run (player report 2026-10-12: 坚守 at 100 layers and 灵巧 at
 * 99 — 灵巧 could not be activated any more, however the operators were redeployed). Every other caller wants the
 * settled state and omits it.
 */
export function fissionBondIds(ps, cap, bonds = null) {
  // the shared rule (shared/hextech.js), with the bond order the player's own state was built in (data order) — the
  // battle side passes `gd.bondIds` so a tie cannot resolve differently on the two sides
  return sharedFissionBondIds(bonds || (ps && ps.bonds) || {}, cap, (ps && ps.bondOrder) || null);
}

/**
 * 悬赏倍增: what a player's BOUNTY income is multiplied by at settlement (1 without the hex).
 *
 * 业主 2026-10-20：「协议『悬赏倍增』无效」。它和 过路费 是同一个病：reader 在，**没有任何结算路径调用它** ——
 * `settle.js` / `bossRounds.js` 把悬赏资金原样记进 `pendingFunds`，这张卡自 0.19.x 起就只是一条 ref。现在两条结算
 * 路径都乘一次（`bountyCoins * bountyMultiplier(ps)`）。
 *
 * 乘的是**悬赏**那部分：击杀悬赏（`r.coins`，Battle 的击杀赏金）+ 完美作战悬赏的 payout。它**不**乘 过路费（敌方卡发
 * 的钱）、也不乘 战功簿 / 契约 / rebate 这类自己已经算好数的资金来源 —— 卡面说的是「你获得的悬赏资金」，不是「你获得
 * 的所有资金」。 [ASSUMED: 1) 只乘悬赏（击杀 + 完美）而不是全部进账，理由如上；2) 取最高的那一张（抽卡不重复，这是
 * 数据集里有两张时的安全网）；3) 非整数按截断处理，与其它资金口径一致。]
 * @param {any} ps
 * @returns {number} 1 without the hex
 */
export function bountyMultiplier(ps) {
  let best = 1;
  for (const e of (ps && ps.effects) || []) {
    const spec = e && e.params && e.params.bountyMul;
    if (Number.isFinite(spec) && spec > best) best = Math.trunc(spec);
  }
  return best;
}

/** 整装待发: how many equipment an operator of this player carries (the data's 2 without the hex). */
export function equipSlotsOf(ps, base = 2) {
  for (const e of (ps && ps.effects) || []) {
    const spec = e && e.params && e.params.equipSlots;
    if (Number.isFinite(spec) && spec > 0) return Math.max(base, Math.trunc(spec));
  }
  return base;
}

/**
 * The HIGHEST equipment cap any hex of this dataset can grant — `max(gd.equipPerChess, 整装待发's equipSlots)`.
 *
 * The invariant checkers need it because the cap can SHRINK mid-match: 潘多拉魔盒 (`hex_pandora`) replaces every hex the
 * player owns with a random 3阶 one, so a player who had 整装待发 (+1 slot) can lose it while its operators already carry
 * the extra item. Items are never force-removed — `PlayerState._attach` only trims them the next time that operator is
 * equipped — so a LEGAL state is `slots ≤ this ceiling`, not `slots ≤ the live cap`. Checking against the live cap
 * flagged that legal state as corruption (fuzz seed 6; 业主 2026-10-21 「查」).
 * @param {any} gd GameData
 * @returns {number} the ceiling, never below `gd.equipPerChess`
 */
export function equipCapCeiling(gd) {
  let ceiling = Number.isFinite(gd && gd.equipPerChess) ? gd.equipPerChess : 2;
  let pool = [];
  try { pool = typeof gd.hexPlayerPool === 'function' ? gd.hexPlayerPool() : []; } catch { pool = []; }
  for (const rec of Array.isArray(pool) ? pool : []) {
    const spec = rec && rec.effect && rec.effect.equipSlots;
    if (Number.isFinite(spec) && spec > 0) ceiling = Math.max(ceiling, Math.trunc(spec));
  }
  return ceiling;
}

/**
 * Whether the player's 不灭壁垒 makes this round's first leak free (settlement): true when one of its hexes carries
 * `battle.firstLeakFree`.
 */
export function firstLeakFree(ps) {
  return (ps.effects || []).some((e) => e && e.params && e.params.battle && e.params.battle.firstLeakFree === true);
}

/** The merged multipliers of every enemy hex the match's enemy side owns ({}, when there are none). */
export function enemyHexMods(m) {
  const list = Array.isArray(m.enemyHexes) ? m.enemyHexes : [];
  return sumEnemyMods(list.map((e) => m.gd.hex(e && e.id ? e.id : e)).filter(Boolean));
}

/** 远程怪的口径（业主 2026-10-30：「给 n1-n19 的远程怪攻击力曲线单独设置」）：**只看 `applyWay === 'RANGED'`**。
 *
 * 不采纳「`ALL` 也算」（官方图鉴口径，本仓库 op-thorns.js 的反伤判定用的就是那个）—— 业主当场选的是窄口径，于是
 * 「能近能远」（`ALL`，16 个）与近战（`MELEE`）仍然吃通用那条 `atkMul`。数据缺 `applyWay` 时按 `MELEE` 处理，与
 * `server/sim/simdata.js` 的归一化一致。
 * @param {any} gd @param {string} [key] the wave's `enemyKey`
 * @returns {boolean}
 */
export function isRangedEnemyKey(gd, key) {
  if (!gd || typeof gd.enemy !== 'function' || typeof key !== 'string' || !key) return false;
  const e = gd.enemy(key);
  return String((e && e.applyWay) || '').toUpperCase() === 'RANGED';
}

/**
 * 这一局**全部**敌方 mods：敌方协议源石 + 协议等级（owner's call 2026-10-18）。战斗（combat.js）与预览（views.js）
 * 必须折同一份 —— 这就是「预览的敌人数量 = 实战出怪数量」那条纪律的延续。等级关闭时它与 enemyHexMods 逐字节相同。
 *
 * 协议等级的乘区**按回合爬升**（业主 2026-10-24「削弱敌方前期加强后期」，k = 1 在第 6 回合）：所以这里必须把
 * `m.round` 传下去。三个调用点（combat / views / bossRounds）拿到的都是同一次 `this`，`this.round` 就是这一场
 * 战斗的回合 —— 预览不会因为回合不同而与实战分叉。
 *
 * **远程怪那一条曲线**（业主 2026-10-30）：等级的 `atkMulRanged` 不与 `atkMul` 相乘（那会把两条曲线叠起来），而是
 * 换成「卡牌那份 `atkMul` × 等级的 `atkMulRanged`」，作为 `atkMulRanged` 一并带出。`applyEnemyHexes` 会给远程怪的
 * spawn 用这一格替掉 `atkMul` —— 卡牌（敌方协议源石的攻击力加成）照旧落在远程怪身上，只是等级那一段走另一条曲线。
 * 只有等级真的开着、且两级曲线不同时才带这一格，于是 0 级 / 其它难度 / 1–6 级（两条相同）逐字节不变。
 * @param {any} m
 */
export function matchEnemyMods(m) {
  const cards = enemyHexMods(m);
  const level = protocolLevelEnemyMods(m.protocolLevel, m.difficulty, m.round);
  if (!level) return cards;
  const out = sumEnemyMods([{ mods: cards }, level]);
  const ranged = level.rangedAtkMul;
  if (Number.isFinite(ranged) && ranged !== 1 && ranged !== out.atkMul) {
    const base = Number.isFinite(cards.atkMul) ? cards.atkMul : 1;
    out.atkMulRanged = Math.round(base * ranged * 10000) / 10000;
  }
  return out;
}

/** The keys a leader's spawns may take: the shared leader HP pool is never scaled (waves.js:339). */
const LEADER_MODS = Object.freeze(['atkMul', 'defMul', 'resMul', 'speedMul']);
const NORMAL_MODS = Object.freeze(['hpMul', 'atkMul', 'defMul', 'resMul', 'speedMul', 'supplyHpMul']);

/**
 * Fold the enemy hex multipliers into a battle's spawn list (copy-on-write: the wave's own specs are shared by every
 * player's field and by the prep preview, so their `mods` objects are never mutated in place). The leader spawn
 * (`tag === 'boss'`, waves.js templateSpawns) keeps its HP: the leader's HP is the shared server pool, and the round
 * effects never scale it (waves.js:339 / gamedata.js:146).
 *
 * `countAdd` (虫群, 0.3.0 playtest #2) is the one non-multiplier wrench: it adds that many enemies to every **normal**
 * spawn group (never a leader, never the 器物), before the preview is built — see `targetsOf` below.
 *
 * **远程怪的攻击力另走一条曲线**（业主 2026-10-30，`hexMods.atkMulRanged`）：`rangedOf(key)` 说这个 spawn 的敌人是不是
 * 远程怪（`isRangedEnemyKey`）—— 是的话 `atkMul` 换成那一条（含卡牌那份倍率），生命/防御/法抗/速度照旧。领袖
 * （`tag === 'boss'`）不换：首领轮有自己的 `bossPoolMul` 与共享血池，这条曲线是给「小怪 / 精英怪」的。
 * 不给 `rangedOf`（旧的两参数调用、测试）⇒ 逐字节等于从前。
 * @param {Array<object>} spawns
 * @param {object} hexMods from matchEnemyMods (or enemyHexMods)
 * @param {((enemyKey: string) => boolean) | null} [rangedOf] 远程怪判定，缺省 ⇒ 不分流
 */
export function applyEnemyHexes(spawns, hexMods, rangedOf = null) {
  if (!Array.isArray(spawns) || !hexMods) return spawns;
  const add = Number.isFinite(hexMods.countAdd) ? Math.max(0, Math.trunc(hexMods.countAdd)) : 0;
  // 精英化 (owner's list of 2026-10-15): fewer enemies per group. `countSub` is an ABSOLUTE subtraction (the owner
  // chose 'one fewer body per wave' over a percentage — 10 % of a five-enemy group rounds to nothing a player can
  // feel), floored at 1: a group that reaches this fold with a count is a group the stage MEANT to spawn, and a card
  // that erased it outright would silently delete the round's content rather than thin it.
  const sub = Number.isFinite(hexMods.countSub) ? Math.max(0, Math.trunc(hexMods.countSub)) : 0;
  const rangedAtk = typeof rangedOf === 'function' && Number.isFinite(hexMods.atkMulRanged) ? hexMods.atkMulRanged : null;
  if (!add && !sub && rangedAtk === null && !NORMAL_MODS.some((k) => Number.isFinite(hexMods[k]))) return spawns;
  return spawns.map((sp) => {
    if (!sp || !sp.mods || typeof sp.mods !== 'object') return sp;
    const boss = sp.tag === 'boss';
    const keys = boss ? LEADER_MODS : NORMAL_MODS;
    const mods = { ...sp.mods };
    let changed = false;
    // 远程怪：等级那一段换成本级 `atkMulRanged` 折出来的值（`atkMulRanged` 里已经含了卡牌那份 `atkMul`）
    const ranged = !boss && rangedAtk !== null && rangedOf(sp.enemyKey);
    for (const k of keys) {
      const v = k === 'atkMul' && ranged ? rangedAtk : hexMods[k];
      if (!Number.isFinite(v) || v === 1) continue;
      mods[k] = (Number.isFinite(mods[k]) ? mods[k] : 1) * v;
      changed = true;
    }
    let count = sp.count;
    if (add && !boss && Number.isFinite(count)) { count = Math.max(1, Math.trunc(count) + add); changed = true; }
    // countSub never touches a leader (its pool IS the fight) and never the 器物, and it stops at 1 body.
    if (sub && !boss && Number.isFinite(count)) { count = Math.max(1, Math.trunc(count) - sub); changed = true; }
    return changed ? { ...sp, mods, count } : sp;
  });
}

/** The enemy hexes the enemy side owns, as data records (never nulls). */
function ownedEnemyHexes(m) {
  const list = Array.isArray(m.enemyHexes) ? m.enemyHexes : [];
  return list.map((e) => m.gd.hex(e && e.id ? e.id : e)).filter(Boolean);
}

/**
 * The **verb** enemy hexes the enemy side owns, as ids (DESIGN §29.10). This is what `flags.enemyHexIds` carries into a
 * battle: a `verb` card is a script, not a multiplier, so it cannot ride on the spawn list the way `mods` does.
 *
 * The sim's `install` (server/sim/content/hextech.js) reads `battle.flags.enemyHexIds` and looks each id up in
 * data/hextech.json for its `verb` / `params`. An id whose record has no `verb` is dropped here, so the flag never
 * carries a card the battle could not run.
 * @param {import('./Match.js').Match} m
 * @returns {string[]} verb hex ids, data order
 */

/**
 * 通缉令 (业主 2026-10-19): 「每场战斗随机增加一个1~5块（惊变里的）的敌人」.
 *
 * Picks ONE enemy from the 机变 bounty cards whose `coin` price is in [minCoin, maxCoin] (data/choices.json `cards`:
 * 42 at 1, 40 at 2, 36 at 3, 5 at 4, 4 at 5 — so "1~5 块" is a bounded, non-uniform pool). The pick is SEEDED off the
 * match's own rngWaves stream so a replay draws the same enemy, and the result rides the battle's flags as
 * `enemyHexWanted` (server/sim/content/hextech.js `wanted` spawns it).
 *
 * 业主 2026-10-19 追加的限制：「悬赏令前5回合不出现4，5块的怪」。`params.earlyRounds` / `params.earlyMaxCoin` 就是它：
 * 这一场战斗的 `round` ≤ earlyRounds 时，上限从 `maxCoin` 收到 `earlyMaxCoin`（4 / 5 块的悬赏全部 3 阶精英，第一回合
 * 就丢一个 75000 血的「迷路的巨像」是这一版最容易劝退的开局）。判据是**这场战斗的回合**而不是抽卡那一回合：R1 抽到
 * 的卡到 R6 自然解禁，不需要记「这张卡是第几回合来的」。
 *
 * 确定性：无论回合怎么筛，这里**恰好抽一次** rngWaves —— 前 5 回合与之后消耗的随机流一样多，回放与复算不会因为
 * 回合不同而错位。数据里一个 ≤ earlyMaxCoin 的悬赏都没有时（一套被裁剪过的数据）退回整个池子：宁可破一次限制，
 * 也不能静默不刷怪。
 *
 * Returns undefined when the enemy side does not own the card or the data carries no usable bounty.
 * @param {import('./Match.js').Match} m
 * @param {number} [round] the battle's round (defaults to the match's own round)
 * @param {string|null} [fieldId] the battle's own field id (`n:p_0`, `u`, …) — with the round it seeds the pick
 * @returns {string|undefined} an enemyKey
 */
/**
 * 通缉令的「价值上限」按回合分档（业主 2026-10-22）：「前三回合只出 1 块，前 5 回合出 1 块 2 块，前 7 回合出 1 块 2 块 3 块，
 * 其他回合 1-5 块」。
 *
 * 就是一条按回合递增的阶梯：round ≤ 3 → 1；≤ 5 → 2；≤ 7 → 3；8 回合起回到 `maxCoin`（5）。写成数据
 * `params.coinTiers: [{ round, maxCoin }, …]`（升序，取第一个 `r <= round` 的档），以后调档不必改代码。
 * 旧数据只有单档 `earlyRounds` / `earlyMaxCoin`（0.19.7 那版「前 5 回合不出现 4、5 块」）—— 没有 `coinTiers` 时仍按它
 * 算，避免旧数据在升级那一瞬间行为跳变。`r` 未知（0）时用 `maxCoin`（不设限）。
 * @param {any} p the card's params
 * @param {number} r the BATTLE's round
 * @param {number} maxCoin the card's own ceiling
 * @returns {number} the highest coin value that may be drawn this round
 */
export function wantedCoinCap(p, r, maxCoin) {
  const tiers = p && Array.isArray(p.coinTiers) ? p.coinTiers : null;
  if (tiers && tiers.length && r > 0) {
    for (const t of tiers) {
      const upto = Number(t && t.round);
      const c = Number(t && t.maxCoin);
      if (Number.isFinite(upto) && Number.isFinite(c) && r <= upto) return Math.min(maxCoin, Math.max(0, c));
    }
    return maxCoin;   // past the last tier: the card's own ceiling
  }
  // legacy single-tier data (0.19.7 / 0.19.8 era)
  const earlyRounds = Number.isFinite(Number(p && p.earlyRounds)) ? Math.trunc(Number(p.earlyRounds)) : 0;
  const earlyMaxCoin = Number.isFinite(Number(p && p.earlyMaxCoin)) ? Number(p.earlyMaxCoin) : maxCoin;
  return earlyRounds > 0 && r > 0 && r <= earlyRounds ? Math.min(maxCoin, earlyMaxCoin) : maxCoin;
}

export function enemyHexWantedKey(m, round = null, fieldId = null) {
  const hex = ownedEnemyHexes(m).find((h) => h.verb === 'wanted');
  if (!hex) return undefined;
  const p = hex.params || {};
  const minCoin = Number.isFinite(Number(p.minCoin)) ? Number(p.minCoin) : 1;
  const maxCoin = Number.isFinite(Number(p.maxCoin)) ? Number(p.maxCoin) : 5;
  const r = Number.isFinite(Number(round)) && Number(round) > 0 ? Math.trunc(Number(round)) : Number(m.round) || 0;
  // 业主 2026-10-22：按回合分档的价值上限（前 3 回合 1 块 / 前 5 回合 1~2 / 前 7 回合 1~3 / 之后 1~5）
  const cap = wantedCoinCap(p, r, maxCoin);
  const capped = cap < maxCoin;
  // every bounty enemy of the 惊变 draft, once per KEY (two cards may share an enemy), split by whether the coin cap
  // admits it: `early` is the early-round pool (≤ earlyMaxCoin), `late` everything ≤ maxCoin that is not in it
  const early = new Set();
  const late = new Set();
  const cards = m.gd && m.gd.choices ? m.gd.choices.cards : null;
  const lists = Array.isArray(cards) ? cards : cards && typeof cards === 'object' ? Object.values(cards) : [];
  for (const list of lists) {
    for (const c of Array.isArray(list) ? list : []) {
      if (!c || typeof c.enemyKey !== 'string' || !c.enemyKey) continue;
      const coin = Number(c.coin);
      if (!Number.isFinite(coin) || coin < minCoin || coin > maxCoin) continue;
      if (m.gd.enemy && !m.gd.enemy(c.enemyKey)) continue;
      if (coin <= cap) early.add(c.enemyKey); else late.add(c.enemyKey);
    }
  }
  // ONE draw, then pick from the pool it admits: the rng stream advances by exactly one number whether the cap applies
  // or not, so a replay / re-computation can never end up on a different draw because of a round's timing.
  const pool = [...early, ...late].sort();   // deterministic order before the draw
  if (!pool.length) return undefined;
  // The draw is DERIVED from (seed, round, fieldId), not taken off any shared stream.
  // 业主 2026-10-20：这条以前抽 `m.rngWaves`，而它**每场战斗抽一次** —— 一场比赛里战斗的个数两条执行路径并不一样
  // （客户端战斗每个场地建一份 spec，还有接管与复算），于是同一颗种子在两条路上的波次流从第一次通缉令起就错开了：
  // 客户端一局和服务端一局的出怪不一样，SP_VERIFY 也会把诚实战报判成不一致。抽法改成纯函数后，
  // 预览 / 真打 / 接管 / 复算拿到的是同一个敌人，也不再消耗波次流（`rngWaves` 回到「一波一次」）。
  const rng = createRng(deriveSeed(m.seed, `wanted:${r}:${typeof fieldId === 'string' ? fieldId : ''}`));
  const i = Math.min(pool.length - 1, Math.floor(rng() * pool.length));
  const picked = pool[i];
  // the early-round cap: anything over `cap` is off the table until the battle round passes earlyRounds. Re-read the
  // SAME draw against the admitted pool — still no extra rng call (the same index, wrapped) so determinism is untouched.
  if (capped && early.size && !early.has(picked)) {
    const earlyPool = [...early].sort();
    return earlyPool[i % earlyPool.length];
  }
  return picked;
}

/**
 * 窃贼 (业主 2026-10-19): 「干员被击倒时下回合减少2%金钱（最多30%）」.
 *
 * The battle counted the knock-outs (`battle._hexThiefDeaths`, server/sim/content/hextech.js `thief`). This banks the
 * percentage on the PLAYER for the next round's income, capped. Called from the result path (server/match/match/settle.js
 * and the boss path) once per field release; the `onIncome` handler registered for the card's ref applies it.
 *
 * `ps.thiefPctLost` is the running percentage (match state, not sim state): it grows by `perDeathPct` per knock-out up to
 * the cap and is consumed by the next `startRound`.
 * @param {import('./Match.js').Match} m
 * @param {import('./PlayerState.js').PlayerState} ps
 * @param {number} deaths own operators knocked out in the battle just released
 * @returns {number} the percentage banked (0 when the enemy side does not own the card)
 */
export function bankThiefPenalty(m, ps, deaths) {
  if (!ps || !(deaths > 0)) return 0;
  const hex = ownedEnemyHexes(m).find((h) => h.verb === 'thief');
  if (!hex) return 0;
  const p = hex.params || {};
  const per = Number.isFinite(Number(p.perDeathPct)) ? Number(p.perDeathPct) : 2;
  const cap = Number.isFinite(Number(p.capPct)) ? Number(p.capPct) : 30;
  const cur = Number.isFinite(Number(ps.thiefPctLost)) ? Number(ps.thiefPctLost) : 0;
  const next = Math.min(cap, cur + per * deaths);
  ps.thiefPctLost = next;
  ps.dirty?.();
  return next - cur;
}

/**
 * 窃贼's income half: cut the banked percentage off this round's income, then clear the bank (it applies to the NEXT
 * round only). Called by PlayerState.startRound right after its `onIncome` dispatch — an ENEMY card is match state on
 * `Match.enemyHexes`, not a player EffectRef, so there is no dispatcher handler to register it through.
 * @param {import('./PlayerState.js').PlayerState} ps
 * @param {{ income: number }} ev the onIncome event (mutated in place)
 * @returns {boolean} whether anything was cut
 */
export function applyThiefIncomeCut(ps, ev) {
  if (!ps || !ev) return false;
  const pct = Number.isFinite(Number(ps.thiefPctLost)) ? Number(ps.thiefPctLost) : 0;
  if (!(pct > 0)) return false;
  const income = Number.isFinite(Number(ev.income)) ? Number(ev.income) : 0;
  ev.income = Math.max(0, income * (1 - Math.min(100, pct) / 100));
  ps.thiefPctLost = 0;
  ps.dirty?.();
  return true;
}

export function enemyVerbIds(m) {
  return ownedEnemyHexes(m).filter((h) => typeof h.verb === 'string' && h.verb).map((h) => h.id);
}

/**
 * 自适应成长 (业主 2026-10-24: 「根据敌人源石协议的总阶数获得攻击力防御力生命值的对应加成，一阶对应8%」): the enemy side's
 * TOTAL tier, i.e. the sum of `gd.hexTier(rarity)` over EVERY enemy hex it owns — the `mods` 数值卡 included.
 *
 * `flags.enemyHexIds` (enemyVerbIds above) deliberately carries only the `verb` cards, so the battle cannot work the sum
 * out for itself; and the enemy's ownership is match state. Hence this stamp: the match computes the number and hangs it
 * on the battle's flags (`withEnemyHexes`, the ONE place all three battle-building paths share).
 *
 * Only computed when a player actually owns the card — every other battle then gets no extra flag at all, so an install
 * without the card produces the byte-for-byte options object it produced before this feature landed (KEY DISCIPLINE).
 * @param {import('./Match.js').Match} m
 * @returns {number} 0 when nobody owns the card / the enemy has no card
 */
export function adaptiveTierTotalOf(m) {
  const owner = typeof m.alivePlayers === 'function' ? m.alivePlayers().some((ps) => ownsHex(ps, 'hex_adaptivegrowth')) : false;
  if (!owner) return 0;
  let total = 0;
  for (const rec of ownedEnemyHexes(m)) {
    const tier = typeof m.gd.hexTier === 'function' ? m.gd.hexTier(rec.rarity) : null;
    if (Number.isInteger(tier) && tier > 0) total += tier;
  }
  return total;
}

/**
 * 总协议源石阶数 ÷ 人数 ÷ 2 — the leader-pool multiplier the owner asked for: on 2026-10-13 "boss血量在基础上×（总协议源石阶数/人数）",
 * halved on 2026-10-14 ("boss 血量 ×（总协议源石阶数 ÷ 人数÷ 2）"): the first cut grew the leader too fast, so the same
 * ratio now counts for half. A player who drafted more / higher-tier 协议源石 is stronger, so the Final Assault's shared
 * pool grows with the table's total 阶位, normalised per player (the number is "average tiers per player") and halved.
 *
 * Reading of the owner's words (recorded as [ASSUMED]; only the player side counts):
 *   * 总协议源石阶数 = the SUM of the 阶位 (1/2/3, `hexTier` of the record's rarity) of every 协议源石 the players own —
 *     `hexIdsOf(ps)`, the same ownership list the rest of the match reads. ENEMY hexes are left out: they make the
 *     enemies stronger, not the players, so folding them in would grow the leader for the side that is already helping.
 *   * 人数 = the number of players at the fight (the caller passes the alive set the pool itself is shared by, so the
 *     numerator and the denominator always describe the same table).
 *   * floored at 1: a table that has drawn nothing (an early round, a data set with no hexes, a bare test) must not
 *     shrink the leader BELOW the official pool — the halving scales the GROWTH, it never makes the leader weaker than
 *     the table value. The floor also means the halving only takes effect once the table averages ≥ 2 阶 per player.
 * @param {{ gd: any }} m the match (only `gd.hex` / `gd.hexTier` are read)
 * @param {any[]} players the players whose cards count (the alive set at the fight start)
 * @returns {number} the multiplier, ≥ 1
 */
export function bossHexTierMul(m, players) {
  const list = Array.isArray(players) ? players : [];
  const n = list.length;
  if (!(n > 0) || !m || !m.gd) return 1;
  let tiers = 0;
  for (const ps of list) {
    for (const id of hexIdsOf(ps)) {
      const rec = m.gd.hex(id);
      const tier = rec ? m.gd.hexTier(rec.rarity) : null;
      if (Number.isInteger(tier) && tier > 0) tiers += tier;
    }
  }
  return Math.max(1, tiers / n / 2);
}

/**
 * The leader pool of a boss round, 协议源石 included — the ONE call every site uses (server/match/match/bossRounds.js
 * builds the pool with it, audit.js re-derives it, the tests assert on it), so the two halves of the rule can never
 * drift apart. `players` defaults to the match's alive set, which is exactly the set `bossPoolHp`'s share counts.
 * @param {import('./Match.js').Match} m
 * @param {string} bossId
 * @param {any[]} [players]
 * @returns {number}
 */
export function bossPoolHpFor(m, bossId, players = null) {
  const list = Array.isArray(players) ? players : m.alivePlayers();
  return bossPoolHp(m.gd, bossId, list.length, bossHexTierMul(m, list));
}

/**
 * What the enemy's hexes pay the players at settlement (`payout`, 过路费): `{ perLeak, cap }` per player, charged on the
 * player's own counted leaks (server/match/match/settle.js / bossRounds.js). The highest `perLeak` wins when several are
 * owned (the draws never repeat, so this is a safety net for a data set with two); `cap` is the most one BATTLE pays.
 *
 * 业主 2026-10-20：「敌方协议'过路费'加钱不生效，然后给加钱加上限5」. The card was 死代码 until this fix: the record
 * carried `payout`, this reader returned it, and NOTHING called the reader — so owning 过路费 only ever gave the enemies
 * +20 % HP. `enemyHexPayoutFor` below is the caller's half: the one place that turns a battle's own leak count into the
 * coins it pays, and the cap is applied THERE (per battle, not per round: the card reads 「每漏掉 1 个敌人」, and a round
 * has exactly one battle for a normal field and one more for a 联防 one).
 * @param {import('./Match.js').Match} m
 * @returns {{ perLeak: number, cap: number }|null}
 */
/**
 * 记录部抑制 (the owner's list of 2026-10-15): the LP a deploy costs in the prep phase of `round`, 0 when the enemy
 * side does not own the card.
 *
 * The card's text is 「每 4 回合，修整期部署干员时减少 1 点策略生命」. `everyRounds` is read off the record's `params`
 * and the same convention 后勤整备's `onRoundStart.everyRounds` uses applies: the FIRST round counts as the first tick,
 * so `everyRounds: 4` charges rounds 1, 5, 9 … (`(round - 1) % every === 0`). That is the reading the card's own text
 * supports — a player who takes it in R1 pays from R1, not from R4.
 *
 * The reader is deliberately a pure function of (match, round): the caller (match/intents.js `_moveWithDeployCost`)
 * owns the mutation, the LP floor and the "did a deploy actually happen" question, so this module stays free of
 * player state — the same split `enemyHexPayout` uses.
 * @param {import('./Match.js').Match} m
 * @param {number} round
 * @returns {number} LP to charge, 0 when the card is absent or this round is not one of its ticks
 */
export function enemyPrepLpCost(m, round) {
  let cost = 0;
  for (const hex of ownedEnemyHexes(m)) {
    const p = hex && hex.params;
    if (!p || hex.verb !== 'records') continue;
    const every = Number.isFinite(p.everyRounds) && p.everyRounds > 1 ? Math.trunc(p.everyRounds) : 1;
    const lp = Number.isFinite(p.lp) && p.lp > 0 ? Math.trunc(p.lp) : 1;
    const r = Number.isFinite(round) && round > 0 ? Math.trunc(round) : 1;
    if ((r - 1) % every === 0) cost += lp;
  }
  return cost;
}

export function enemyHexPayout(m) {
  let best = null;
  for (const hex of ownedEnemyHexes(m)) {
    const p = hex && hex.payout;
    if (!p || !Number.isFinite(p.perLeak) || p.perLeak <= 0) continue;
    const cap = Number.isFinite(p.cap) && p.cap > 0 ? Math.trunc(p.cap) : Infinity;
    if (!best || p.perLeak > best.perLeak) best = { perLeak: Math.trunc(p.perLeak), cap };
  }
  return best;
}

/**
 * The coins ONE battle's leaks pay a player under the enemy's 过路费, capped. 0 when the enemy side owns no paying card,
 * when nothing leaked, or when the leaks were all uncounted (`counted: false` — a boss / part / 器物 leak costs no LP,
 * so it buys no funds either: the payout follows the same 「漏掉」 the LP charge does).
 *
 * `leaked` is a battle result's own per-player list (server/sim/battle/deploy.js: `{ enemyKey, counted, … }`); the
 * caller (settle.js / bossRounds.js) credits the return to `pendingFunds` exactly the way bounty coins are.
 *
 * [ASSUMED: 1) in a 联防 round only the player's OWN field pays — the card reads 「你每漏掉 1 个敌人」, and what the
 *   helpers' field let through costs the LEAKERS' LP, not the helper's; 2) the cap is per battle, not per round: a
 *   round is one normal field (plus the 联防 field, which pays nobody) or one boss field.]
 * @param {import('./Match.js').Match} m
 * @param {Array<{ counted?: boolean }>} leaked
 * @returns {number} coins, already capped
 */
export function enemyHexPayoutFor(m, leaked) {
  const pay = enemyHexPayout(m);
  if (!pay) return 0;
  const n = (Array.isArray(leaked) ? leaked : []).filter((l) => l && l.counted !== false).length;
  if (n <= 0) return 0;
  return Math.min(pay.cap, pay.perLeak * n);
}
