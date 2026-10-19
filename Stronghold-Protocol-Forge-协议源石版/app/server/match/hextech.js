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
import { hasBattlePart, DEBT_EFFECT_KEY } from '../sim/content/hextech.js';
import { bossPoolHp } from './finalAssault.js';

/** The client's view of one offered hex. No art field: the card face is the rarity's tier (client-side, from the local
 * manifest) — the third-party rune names this used to carry were removed on 2026-10-12. */
export function hexView(hex, idx = null) {
  const v = { id: hex.id, name: hex.name, desc: hex.desc, rarity: hex.rarity };
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
 * 万物归虚's PREP half (业主 2026-10-19): 「获得装备「万物归虚」效果为装备时 将移除备战区所有干员，战斗开始时获得
 * 「移出干员数」层（20x%攻击力，减少30x点收到的伤害）」.
 *
 * 「备战区」 is the players' word for the 整备区 (docs/history/0.2.0.md §25.22.7) — the HAND and the overflow queue. So
 * "remove every operator in the reserve" empties this player's hand / temp of CHESS pieces (operators). Equipment and
 * summons are not 干员 and stay; the removed operators go back to the pool exactly like a sell, minus the funds — the
 * card pays no money for them. The count lands in the ref's `params.voidLayers`, which is what the battle half reads.
 *
 * [ASSUMED: 1) 「备战区」 = hand + overflow temp of THIS player (a team hex's other targets each run it on their own
 *   hand through their own ctx — this card is not `team`); 2) the operators are removed, not sold: no funds, and they
 *   return to the shared pool as a sell does; 3) their carried equipment returns to the hand (a sell's own rule);
 *   4) "装备时" is the moment the ITEM is equipped, but the card hands the item out on pick and nothing forces the player
 *   to equip it immediately — the card's own text says 装备时, so this runs when the item is equipped
 *   (PlayerState equip → `applyVoidReturnOnEquip`), and a later re-equip counts again. The pick-time call below covers
 *   the case where the item was granted and already equipped by the pick handler.]
 * @param {import('./Match.js').Match} m
 * @param {import('./PlayerState.js').PlayerState} ps
 * @param {object} hex the 万物归虚 record
 */
export function applyVoidReturnLayers(m, ps, hex) {
  if (!hex || hex.id !== 'hex_voidreturn' || !ps) return 0;
  const ref = (ps.effects || []).find((e) => e && (e.id === 'hex:hex_voidreturn' || e.key === 'hex:hex_voidreturn'));
  if (!ref) return 0;
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
  const params = (ref.params ||= {});
  const prev = Number.isFinite(Number(params.voidLayers)) ? Number(params.voidLayers) : 0;
  params.voidLayers = prev + removed;
  ps.dirty?.();
  return removed;
}

export function applyHex(m, ps, hex, opts = {}) {
  const team = !!(hex.effect && hex.effect.team);
  const targets = team ? [ps, ...m.alivePlayers().filter((p) => p !== ps)] : [ps];
  for (const p of targets) {
    const ev = { hex: { ...hex }, picker: ps.playerId, forTeammate: p !== ps };
    // 潘多拉魔盒 (owner bug report 2026-10-17): the card has to OWN ITSELF while its own onPick runs.
    // replaceHexes() drops every `hex:` ref — the running card included — and re-grants one card per owned ref, so the
    // ref must be added BEFORE the handler. With the old order (add after) the card replaced the others and was then
    // added back on top (「潘多拉不变自己」), and a player who owned nothing but the card got nothing at all.
    addHexRef(m, p, hex);
    try { m.dispatcher.runKey(p, `hex:${hex.id}`, 'onHexPick', { kind: 'hex', hex }, ev); } catch (e) { m.reportError(`hex ${hex.id}`, e); }
    // `effect.onPick.lp` reaches EVERY target, not just the picker: a team hex's whole point is that each teammate gets
    // the same thing (DESIGN §29.1 "each target runs the handler through its own ctx"). This used to be gated by
    // `p === ps`, which silently halved 战争机器 — the picker took +5 LP and the teammates none.
    applyHexLp(m, p, hex);
    // every other source observes the pick (the hex's own key already ran above)
    m.dispatch(p, 'onHexPick', ev, { skipKey: `hex:${hex.id}` });
    p.recompute();
  }
  // 万物归虚 (业主 2026-10-19): 「装备时 将移除备战区所有干员」 —— the prep half of the card. The battle half
  // (server/sim/content/hexcards/batch15b.js installVoidReturn) reads the count it writes into the ref, so the two halves
  // stay in one place each. Runs AFTER the refs exist (addHexRef above), so it can write onto them.
  applyVoidReturnLayers(m, ps, hex);
  applyHexExtras(m, ps, hex, opts);
  // 镜像协议 (owner report 2026-10-12): an armed copy is retried on EVERY gain, so the moment a teammate owns something
  // copyable the card pays out — including the gain that just happened inside this very call.
  resolveMirrorCopies(m);
}

/** `effect.onPick.lp` (the ctx has no LP mutator and LP is match state, not sim state). */
function applyHexLp(m, ps, hex) {
  const lp = hex.effect && hex.effect.onPick ? hex.effect.onPick.lp : 0;
  if (typeof lp === 'number' && Number.isFinite(lp) && lp !== 0) {
    ps.lp = Math.max(0, ps.lp + Math.trunc(lp));
    ps.dirty();
  }
  void m;
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
      try { applyHex(m, picker, copy, { depth: 1 }); } catch (e) { m.reportError(`hex ${copy.id} (mirror)`, e); }
    }
  } finally {
    if (m) m._resolvingMirror = false;
  }
}

/**
 * The hex an armed 镜像协议 copies: a random one of the teammate-owned cards the picker does not own, highest rarity
 * first (the card's own 「优先阶位更高的一枚」). The picker's own cards are excluded by `pend.owned` plus a live read, so
 * a card it gained after arming is never copied off a teammate by accident. Null when there is nothing to copy.
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
      if (rec) pool.push(rec);
    }
  }
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
function applyHexExtras(m, ps, hex, { depth = 0 } = {}) {
  const spec = hex.effect && hex.effect.onPick;
  if (!spec || depth >= 2) return;
  if (spec.copyAllyHex) armMirrorCopy(m, ps, hex);
  if (Number.isInteger(spec.randomHexes) && spec.randomHexes > 0 && depth < 2) {
    const offer = rollOffers(m.rngHex, {
      pool: m.gd.hexPlayerPool(), owned: hexIdsOf(ps), weights: m.gd.hexWeights(), count: spec.randomHexes,
    });
    for (const id of offer) {
      const rec = m.gd.hex(id);
      if (rec) applyHex(m, ps, rec, { depth: depth + 1 });
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
  if (spec.debt) {
    const d = spec.debt;
    const funds = Number.isFinite(d.funds) ? Math.max(0, Math.trunc(d.funds)) : 3;
    const rounds = Number.isFinite(d.rounds) ? Math.max(1, Math.trunc(d.rounds)) : 3;
    const mates = m.alivePlayers().filter((p) => p !== ps);
    if (!mates.length) {
      ps.addFunds(funds, { reason: 'hex_debt' });
    } else {
      const to = mates[Math.min(mates.length - 1, Math.floor(m.rngHex() * mates.length))];
      to.addFunds(funds, { reason: 'hex_debt' });
      const id = `${DEBT_EFFECT_KEY}:${ps.playerId}:${hex.id}`;
      if (!(to.effects || []).some((e) => e && e.id === id)) {
        to.effects.push({
          id,
          key: DEBT_EFFECT_KEY,
          name: hex.name,
          desc: hex.desc,
          iconKind: 'hex',
          counter: null,
          battle: false,
          params: {
            ownerId: ps.playerId,
            hexId: hex.id,
            untilRound: Math.max(1, Math.trunc(Number(m.round) || 1)) + rounds - 1,
          },
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
function addHexRef(m, ps, hex) {
  const id = `hex:${hex.id}`;
  // one ref per hex per player: a team hex reaching a player who already drafted it must not run twice
  const existing = (ps.effects || []).find((e) => e && (e.id === id || e.key === id));
  if (existing) return existing;
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
    data: { hexId: hex.id, rarity: hex.rarity },
  };
  ps.effects.push(ref);
  ps.dirty();
  return ref;
}

/** The hex ids a player owns (in pick order). */
export function hexIdsOf(ps) {
  return (ps.effects || []).filter((e) => e && typeof e.key === 'string' && e.key.startsWith('hex:')).map((e) => e.data && e.data.hexId).filter(Boolean);
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
  // 背水一战 (§29.34): while the own LP is below the card's threshold EVERY bond gain is ×layerMul. Read live, because
  // the LP can move inside a round (a leak, a 远见透支 purchase) and the card turns on and off with it.
  const ld = lastDitchOf(ps);
  if (ld && Number.isFinite(ps.lp) && ps.lp < ld.lpBelow) mul *= ld.layerMul;
  return mul;
}

/**
 * 背水一战's spec ({ lpBelow, layerMul }) of a player, or null. The card's own onRoundStart half (the free refresh per
 * round) reads the same reader, so the two halves can never disagree about what "低于" means.
 * @param {{ effects?: any[], lp?: number }} ps
 */
export function lastDitchOf(ps) {
  for (const e of (ps && ps.effects) || []) {
    const spec = e && e.params && e.params.lastDitch;
    if (!spec || typeof spec !== 'object') continue;
    const lpBelow = Number(spec.lpBelow);
    const layerMul = Number(spec.layerMul);
    return {
      lpBelow: Number.isFinite(lpBelow) && lpBelow > 0 ? lpBelow : 5,
      layerMul: Number.isFinite(layerMul) && layerMul > 1 ? layerMul : 2,
      freeRefresh: spec.freeRefresh === true,
    };
  }
  return null;
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
 * The own bond with the most BOARD MEMBERS (ties → data order), or null when the board holds none. The 人数最多盟约
 * several cards of the eleventh batch talk about: 紧急拨款 / 三连透支 / 升级刷新, and the same notion `盟约之主` reads at
 * its own round start (server/sim/content/hextech.js mainBondCount). Counts members only, never layers.
 * @param {any} ps @returns {string|null}
 */
export function topMemberBondOf(ps) {
  let best = null;
  let bestCount = 0;
  for (const [id, b] of Object.entries((ps && ps.bonds) || {})) {
    const c = b && Number.isFinite(b.count) ? b.count : 0;
    if (c > bestCount) { bestCount = c; best = id; }
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

/** 悬赏倍增: what a player's bounty income is multiplied by at settlement (1 without the hex). */
export function bountyMultiplier(ps) {
  for (const e of (ps && ps.effects) || []) {
    const spec = e && e.params && e.params.bountyMul;
    if (Number.isFinite(spec) && spec > 1) return Math.trunc(spec);
  }
  return 1;
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

/**
 * 这一局**全部**敌方 mods：敌方协议源石 + 协议等级（owner's call 2026-10-18）。战斗（combat.js）与预览（views.js）
 * 必须折同一份 —— 这就是「预览的敌人数量 = 实战出怪数量」那条纪律的延续。等级关闭时它与 enemyHexMods 逐字节相同。
 * @param {any} m
 */
export function matchEnemyMods(m) {
  const list = (Array.isArray(m.enemyHexes) ? m.enemyHexes : []).map((e) => m.gd.hex(e && e.id ? e.id : e)).filter(Boolean);
  const level = protocolLevelEnemyMods(m.protocolLevel, m.difficulty);
  if (level) list.push(level);
  return sumEnemyMods(list);
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
 * @param {Array<object>} spawns
 * @param {object} hexMods from enemyHexMods
 */
export function applyEnemyHexes(spawns, hexMods) {
  if (!Array.isArray(spawns) || !hexMods) return spawns;
  const add = Number.isFinite(hexMods.countAdd) ? Math.max(0, Math.trunc(hexMods.countAdd)) : 0;
  // 精英化 (owner's list of 2026-10-15): fewer enemies per group. `countSub` is an ABSOLUTE subtraction (the owner
  // chose 'one fewer body per wave' over a percentage — 10 % of a five-enemy group rounds to nothing a player can
  // feel), floored at 1: a group that reaches this fold with a count is a group the stage MEANT to spawn, and a card
  // that erased it outright would silently delete the round's content rather than thin it.
  const sub = Number.isFinite(hexMods.countSub) ? Math.max(0, Math.trunc(hexMods.countSub)) : 0;
  if (!add && !sub && !NORMAL_MODS.some((k) => Number.isFinite(hexMods[k]))) return spawns;
  return spawns.map((sp) => {
    if (!sp || !sp.mods || typeof sp.mods !== 'object') return sp;
    const boss = sp.tag === 'boss';
    const keys = boss ? LEADER_MODS : NORMAL_MODS;
    const mods = { ...sp.mods };
    let changed = false;
    for (const k of keys) {
      const v = hexMods[k];
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
 * Returns undefined when the enemy side does not own the card or the data carries no usable bounty.
 * @param {import('./Match.js').Match} m
 * @returns {string|undefined} an enemyKey
 */
export function enemyHexWantedKey(m) {
  const hex = ownedEnemyHexes(m).find((h) => h.verb === 'wanted');
  if (!hex) return undefined;
  const p = hex.params || {};
  const minCoin = Number.isFinite(Number(p.minCoin)) ? Number(p.minCoin) : 1;
  const maxCoin = Number.isFinite(Number(p.maxCoin)) ? Number(p.maxCoin) : 5;
  // every bounty enemy of the 惊变 draft, once per KEY (two cards may share an enemy)
  const keys = new Set();
  const cards = m.gd && m.gd.choices ? m.gd.choices.cards : null;
  const lists = Array.isArray(cards) ? cards : cards && typeof cards === 'object' ? Object.values(cards) : [];
  for (const list of lists) {
    for (const c of Array.isArray(list) ? list : []) {
      if (!c || typeof c.enemyKey !== 'string' || !c.enemyKey) continue;
      const coin = Number(c.coin);
      if (!Number.isFinite(coin) || coin < minCoin || coin > maxCoin) continue;
      if (m.gd.enemy && !m.gd.enemy(c.enemyKey)) continue;
      keys.add(c.enemyKey);
    }
  }
  if (!keys.size) return undefined;
  const pool = [...keys].sort();   // deterministic order before the draw
  const i = Math.min(pool.length - 1, Math.floor(m.rngWaves() * pool.length));
  return pool[i];
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
 * player's own counted leaks (server/match/match/settle.js). The highest `perLeak` wins when several are owned (the
 * draws never repeat, so this is a safety net for a data set with two).
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
