// server/match/match/hexDraft.js — Match methods: the 海克斯 draft (DESIGN §29). A PARALLEL draft: every alive player
// is offered their own three hexes at the same time (no turn order, no shared pool, no SOLD_OUT) and picks one; each
// has one reroll. The phase runs after ROUND_START on the rounds of data/hextech.json `format.rounds` (1 / 3 / 6 / 11).
//
// When everyone has picked (or the timer runs out — the leftovers are then drawn at random) the enemy side gains one
// hex whose rarity is drawn at random among the rarities the players picked this round; enemy hexes persist for the
// rest of the match (Match.enemyHexes) and are folded into every battle by Match.hexSpawnMods.
//
// Installed on Match.prototype by server/match/Match.js (a method container: never instantiated; `this` is the match).

import { PHASE, ERR } from '../../../shared/constants.js';
import { rollOffers, pickEnemyRarity, pickEnemyHex } from '../../../shared/hextech.js';
import { protocolLevelExtraHexesAt } from '../../../shared/protocolLevels.js';
import { applyHex, hexIdsOf, hexPoolFor } from '../hextech.js';
import { OK, fail, DELAYS } from './common.js';

/**
 * 管理员's buff key (data/bands.json `band_admin.buffs[0].key`). Round 1's draft deals this player one extra three-card
 * offer — 业主 2026-10-25「管理员策略改成第一回合多选择一次海克斯」, replacing the old 「获得协议源石时复制一个」.
 */
const HEX_EXTRA_PICK_KEY = 'band_hex_extra_pick_r1';
/**
 * 管理员2 / 管理员3 (业主 2026-10-25). One buff carries both halves: `bb.roundA` / `bb.roundB` are the ROUNDS the
 * strategy pays on (a strategy may name only `roundA` — 管理员3 became a single round on 2026-10-31), and
 * `bbStr.hexId` (optional) pins the card — 管理员3 names 潘多拉魔盒, 管理员2 leaves it out and the card is rolled from
 * the player's own pool. See `applyBandRoundHexes`.
 */
const BAND_HEX_GRANT_ROUNDS_KEY = 'band_hex_grant_rounds';

export class MatchHexDraft {
  /** Enter the draft for this round (called from MatchPhases.afterRoundStart). */
  enterHexDraft() {
    const gd = this.gd;
    const alive = this.alivePlayers();
    // 协议源石禁用 (业主 2026-10-21): each player's own ≤ 6 bans only narrow THAT player's pool — never a teammate's,
    // never the enemy pool, never a card another effect grants.
    // 核心盟约专属协议 (业主 2026-10-24): a card with `requiresBond` is only offered while that bond is ACTIVE for the
    // player — same per-player narrowing, hence the shared `hexPoolFor` (bans + requiresBond).
    const poolFor = (ps) => this._hexPoolFor(ps);
    const pool = gd.hexPlayerPool();
    // Nothing to offer (no alive player, or a data set without the roster): the round still continues through
    // afterHexDraft — a same-round 机变 must run even when 海克斯 cannot (test/match/harness.js withoutHextech).
    if (!alive.length || !pool.length) { this.afterHexDraft(); return; }
    this.phase = PHASE.HEX_DRAFT;
    const offer = gd.hexOfferCount();
    const weights = gd.hexWeights();
    /** @type {Record<string, string[]>} */
    const offers = {};
    /** @type {Record<string, number>} */
    const rerolls = {};
    for (const ps of alive) {
      offers[ps.playerId] = rollOffers(this.rngHex, { pool: poolFor(ps), owned: hexIdsOf(ps), weights, count: offer });
      rerolls[ps.playerId] = gd.hexRerolls();
    }
    // 业主 2026-10-20「单个刷新应该3个都能刷一次」: `rerolls` is now the budget of the WHOLE-BATCH button (unchanged),
    // and `slotRerolls` is a per-card budget — every card may be rerolled once on its own. Two independent counters
    // rather than one shared pool: the owner asked for 「3 个都能刷一次」, not 「一共 3 次随便花」.
    /** @type {Record<string, number[]>} */
    const slotRerolls = {};
    for (const ps of alive) slotRerolls[ps.playerId] = offers[ps.playerId].map(() => 1);
    /**
     * 管理员 (业主 2026-10-25「管理员策略改成第一回合多选择一次海克斯」): how many EXTRA picks each player gets in this
     * draft. Only a strategy that carries the `band_hex_extra_pick_r1` buff grants one, and only in round 1.
     *
     * `picks[pid]` keeps its wire shape (one integer = the player has chosen), so the client's `Number.isInteger`
     * filter still sees a decided player and `hexDraftDone` stays a simple every(); the extra rounds ride on
     * `extraPicks` (a countdown per player) plus `offers` being re-dealt. A player with extraPicks > 0 has ONE pick
     * recorded but is not "done" until the counter reaches 0 — see `_hexPicksLeft`.
     */
    const extraPicks = {};
    for (const ps of alive) extraPicks[ps.playerId] = this._hexExtraPicksFor(ps);
    this.hex = { offers, picks: {}, rerolls, slotRerolls, extraPicks, untimed: this.soloUntimed, turnDeadline: 0, exclusive: this._isExclusiveHexRound() };
    const secs = gd.hexTimer();
    if (secs && !this.soloUntimed) {
      this.setDeadline(secs, () => this._timeoutHexDraft());
      this.hex.turnDeadline = this.deadline;
    } else {
      this.setDeadline(0);
    }
    for (const ps of alive) if (ps.botControlled) this.scheduleHexBot(ps);
    this.markPublic();
  }

  /**
   * How many EXTRA 海克斯 picks this player's strategy grants in THIS draft.
   *
   * 管理员 (业主 2026-10-25「管理员策略改成第一回合多选择一次海克斯」): the `band_hex_extra_pick_r1 { count }` buff on
   * the player's band. Round 1 only — 「第一回合」 is the whole point of the card, and the owner chose to REPLACE the old
   * 「获得协议源石时复制一个」 mechanic rather than stack on top of it.
   * @param {any} ps @returns {number}
   */
  _hexExtraPicksFor(ps) {
    if (Number(this.round) !== 1) return 0;
    const bandId = ps && typeof ps.bandId === 'string' ? ps.bandId : null;
    const band = bandId && this.gd && typeof this.gd.band === 'function' ? this.gd.band(bandId) : null;
    for (const b of (band && Array.isArray(band.buffs) ? band.buffs : [])) {
      if (!b || b.key !== HEX_EXTRA_PICK_KEY) continue;
      const n = Number(b.bb && b.bb.count);
      return Number.isFinite(n) && n > 0 ? Math.trunc(n) : 1;
    }
    return 0;
  }

  /**
   * Is THIS round an 盟约专属协议 round (data/hextech.json `format.exclusiveRounds`, owner 2026-10-26
   * 「第7回合变成一个选取盟约专属协议源石的回合」)?
   * @returns {boolean}
   */
  _isExclusiveHexRound() {
    const fmt = this.gd && typeof this.gd.hexFormat === 'function' ? this.gd.hexFormat() : null;
    const list = fmt && Array.isArray(fmt.exclusiveRounds) ? fmt.exclusiveRounds : [];
    return list.includes(Number(this.round));
  }

  /**
   * The player-hex pool THIS round's draft draws from. `hexPoolFor` already narrows by that player's bans and by every
   * `requiresBond` card whose bond is not active; on an exclusive round it is narrowed ONCE MORE to the `requiresBond`
   * family itself, so 第 7 回合 deals only 盟约专属协议. A player with no active core bond (or a data set whose exclusive
   * pool is empty) falls back to the ordinary pool: the round must never deal nothing.
   * @param {any} ps @returns {any[]}
   */
  _hexPoolFor(ps) {
    const base = hexPoolFor(ps, this.gd);
    if (!this._isExclusiveHexRound()) return base;
    const only = base.filter((h) => h && typeof h.requiresBond === 'string' && h.requiresBond);
    return only.length ? only : base;
  }

  /**
   * Picks this player still owes in the running draft: 1 while nothing is chosen yet, plus whatever `extraPicks` is
   * left. A player with 0 extra picks behaves exactly like before (one pick, then done).
   * @param {string} playerId @returns {number}
   */
  _hexPicksLeft(playerId) {
    const s = this.hex;
    if (!s) return 0;
    // 手里一张牌都没有就**不欠**这一次选牌：否则 phase 永远等不到 `hexDraftDone`，而单人 / 单人不限时的局没有超时兜底
    // （`enterHexDraft` 在 `untimed` 时不 arm deadline），整局就卡死在 HEX_DRAFT。空 offer 现在只可能来自
    // 「池子真的空了」（第 7 回合的专属池被抽干、工坊包的极小池子），这时该跳过他继续下一阶段。
    if (!((s.offers && s.offers[playerId]) || []).length) return 0;
    const base = s.picks[playerId] == null ? 1 : 0;
    const extra = Number.isFinite((s.extraPicks || {})[playerId]) ? (s.extraPicks[playerId] || 0) : 0;
    return base + extra;
  }

  /** The offered hex ids of one player ([] when the phase is not running). */
  hexOfferOf(playerId) {
    return (this.hex && this.hex.offers && this.hex.offers[playerId]) || [];
  }

  /**
   * Whether every alive player is done drafting.
   *
   * 管理员's extra pick makes this `_hexPicksLeft === 0` rather than "has a pick recorded": a player who just spent their
   * first pick with one extra left is NOT done — they get a fresh three-card offer and must pick again.
   */
  hexDraftDone() {
    if (!this.hex) return true;
    return this.alivePlayers().every((ps) => this._hexPicksLeft(ps.playerId) <= 0);
  }

  /**
   * g.hex { idx } — the player's own three options, so only the offer's length bounds the index.
   *
   * A player may pick more than once when their strategy grants it (管理员, round 1). `picks[pid]` keeps holding the
   * LAST index chosen (the client only needs "decided"), while `extraPicks[pid]` counts the rounds left.
   */
  pickHex(ps, idx) {
    if (this.phase !== PHASE.HEX_DRAFT || !this.hex) return fail(ERR.WRONG_PHASE);
    if (!ps.alive) return fail(ERR.ELIMINATED);
    if (this._hexPicksLeft(ps.playerId) <= 0) return fail(ERR.ALREADY);
    const offer = this.hexOfferOf(ps.playerId);
    if (!Number.isInteger(idx) || idx < 0 || idx >= offer.length) return fail(ERR.BAD_TARGET);
    this._applyHex(ps, idx);
    return OK;
  }

  /**
   * g.hexReroll { idx? } — one reroll per player per draft; the pick is not consumed by it.
   *
   * 业主 2026-10-20「把刷新按钮改成分别刷新每个」，随后「单个刷新应该3个都能刷一次」: with `idx` only that slot of
   * the offer is replaced (the other two cards stay) and it spends THAT CARD's own budget (`slotRerolls[pid][idx]`, one
   * per card). Without `idx` it is the original whole-batch reroll against `rerolls` — the request an older client
   * sends, byte for byte. A card the player already owns or is currently offered never comes back either way (the
   * same 2026-10-16 rule as below).
   *
   * The two budgets are independent on purpose: 整批 = 1 per draft (format.rerolls, unchanged), 单张 = 1 per CARD.
   * Spending a card's reroll does not touch the batch count and vice versa.
   * @param {any} ps
   * @param {number} [idx] the slot to replace, absent = the whole offer
   */
  rerollHex(ps, idx = undefined) {
    if (this.phase !== PHASE.HEX_DRAFT || !this.hex) return fail(ERR.WRONG_PHASE);
    if (!ps.alive) return fail(ERR.ELIMINATED);
    // 管理员 (业主 2026-10-26「策略『管理员』第一回合第二次三选一不给刷新不能选」): the old gate was "a pick is recorded
    // ⇒ refuse", but the strategy's owner records the BASE pick and still owes the extra one — their freshly dealt
    // second 三选一 therefore had both reroll buttons refused with ALREADY. "Done" is `_hexPicksLeft`, the same test
    // `pickHex` uses; a player with nothing owed is refused exactly as before.
    if (this._hexPicksLeft(ps.playerId) <= 0) return fail(ERR.ALREADY);
    const slot = Number.isInteger(idx) ? (this.hex.slotRerolls[ps.playerId] || []) : null;
    if (Number.isInteger(idx)) {
      // the slot is checked BEFORE anything is spent: a bad index must never cost the player a reroll
      if (idx < 0 || idx >= this.hexOfferOf(ps.playerId).length) return fail(ERR.BAD_TARGET);
      if (!(slot && slot[idx] > 0)) return fail(ERR.NO_REROLL);
    } else if (!(this.hex.rerolls[ps.playerId] > 0)) return fail(ERR.NO_REROLL);
    if (Number.isInteger(idx)) slot[idx] -= 1;
    else this.hex.rerolls[ps.playerId] -= 1;
    const gd = this.gd;
    // 刷新要把**这一批**也排除掉（业主 2026-10-16「刷新会有重复海克斯」）：`hexIdsOf` 只是玩家**已经拥有**的，
    // 不含当前 offer 的三张。只传 owned 的话，新抽的三张可能又是刚被换掉的那几张 —— 池子小的时候（测试/少人数局）
    // 几乎必然如此（实测：3 张卡的池子，20 个种子里 5 次刷出与原来完全相同的三张）。
    const offered = this.hexOfferOf(ps.playerId);
    // 禁用 + 专属（`requiresBond`）一起在这里收窄：刷新与首次抽取必须是同一个池子，否则刷一下就能刷出没激活盟约的专属卡
    // （第 7 回合的 exclusive 收窄也在 _hexPoolFor 里，见那里）
    const pool = this._hexPoolFor(ps);
    const weights = gd.hexWeights();
    if (Number.isInteger(idx)) {
      // one slot: everything else about the batch is kept, so the other two cards must be excluded from the draw as well
      const next = offered.slice();
      next[idx] = rollOffers(this.rngHex, { pool, owned: [...hexIdsOf(ps), ...offered], weights, count: 1 })[0] || next[idx];
      this.hex.offers[ps.playerId] = next;
    } else {
      // 池子被「已拥有 + 当前这一批」占满时（第 7 回合的专属池只有 1–2 张，很容易占满），整批刷新会抽到**空数组** ——
      // 那会把手里还有牌的 offer 直接清空，于是玩家欠一次选牌却没有牌可选：限时的局靠超时兜底，单人 / 单人不限时的局
      // 就永远卡在 HEX_DRAFT（fuzz seed 27 实测：R7 专属池只剩 1 张且正在 offer 里，整批刷新后 offer = []，无 deadline）。
      // 抽不出新的一批就保留原来那一批；单张刷新早就是这个口径（`|| next[idx]`）。
      const next = rollOffers(this.rngHex, { pool, owned: [...hexIdsOf(ps), ...offered], weights, count: gd.hexOfferCount() });
      if (next.length) this.hex.offers[ps.playerId] = next;
    }
    this.markPrivate(ps);
    this.markPublic();
    return OK;
  }

  /**
   * Apply the choice at `idx` of the player's offer and finish the phase once everyone is done.
   *
   * 管理员 (业主 2026-10-25「第一回合多选择一次」): when the player still owes an extra pick, deal a FRESH three-card offer
   * for that pick instead of finishing — 「选完第一张，再弹一次三选一」. The new offer excludes what they own and what
   * they were just shown, the same rule `rerollHex` uses so a card never comes back immediately.
   */
  _applyHex(ps, idx) {
    const s = this.hex;
    if (!s || this._hexPicksLeft(ps.playerId) <= 0) return;
    const offer = this.hexOfferOf(ps.playerId);
    const id = offer[idx];
    const hex = id ? this.gd.hex(id) : null;
    if (!hex) return;
    /**
     * Pick accounting. `picks[pid]` is the BASE pick (one per draft, exactly as before). The strategy's extra picks live
     * in `extraPicks[pid]` and are only consumed AFTER the base one is in — so:
     *   first choice  → picks set, extraPicks untouched  ⇒ `_hexPicksLeft` = 0 + 1 = 1 (owes one more)
     *   second choice → extraPicks − 1                   ⇒ `_hexPicksLeft` = 0 (done)
     * That is the order the owner described (「选完第一张，再弹一次三选一」): the re-deal happens right after the first
     * choice, because the base pick is what just got spent.
     */
    const baseSpent = s.picks[ps.playerId] != null;
    if (baseSpent) s.extraPicks[ps.playerId] = Math.max(0, (s.extraPicks[ps.playerId] || 0) - 1);
    s.picks[ps.playerId] = idx;
    try { applyHex(this, ps, hex); } catch (e) { this.reportError(`applyHex ${hex.id}`, e); }
    // still owes a pick (the extra one): re-deal their three cards and let them choose again
    if (!baseSpent && (s.extraPicks[ps.playerId] || 0) > 0) {
      const pool = this._hexPoolFor(ps);
      const weights = this.gd.hexWeights();
      s.offers[ps.playerId] = rollOffers(this.rngHex, {
        pool, owned: [...hexIdsOf(ps), ...offer], weights, count: this.gd.hexOfferCount(),
      });
      // the re-dealt batch gets its own per-card reroll budget, like the first one
      s.slotRerolls[ps.playerId] = s.offers[ps.playerId].map(() => 1);
      s.rerolls[ps.playerId] = this.gd.hexRerolls();
      // 业主 2026-10-26「…第二次三选一…不能选」: the second 三选一 is a NEW choice and gets a full turn. The draft arms ONE
      // deadline at `enterHexDraft`; a player who spent the base pick near it had the re-dealt offer auto-picked by that
      // very timer (the timeout resolves every owed pick), so the screen was there and gone. Re-arming extends the
      // phase only for the seats still deciding — everyone who already picked is unaffected — and the new
      // `turnDeadline` is what the client's countdown reads.
      if (!s.untimed) {
        const secs = this.gd.hexTimer();
        if (secs) {
          this.setDeadline(secs, () => this._timeoutHexDraft());
          s.turnDeadline = this.deadline;
        }
      }
      // a BOT that owes this second pick has to be scheduled for it: `scheduleHexBot` fires once per draft start, so
      // without this the seat would sit on its owed pick until the timer (solo is untimed → the draft would wedge)
      if (ps.botControlled) this.scheduleHexBot(ps);
    }
    this.markPrivate(ps);
    this.markPublic();
    // the transition to PREP is deferred by one tick, like the other drafts (MatchSpDraft.finishSpDraft runs from a
    // `later` too): the phase ends on a clean step boundary instead of inside the intent that completed it
    if (this.hexDraftDone() && this.phase === PHASE.HEX_DRAFT) this.later(0, () => this.finishHexDraft());
  }

  /**
   * Grant ONE player one 协议源石 through the **production pick path** (DESIGN §28.58) — the method a workshop pack's
   * `server.modules[].matchClass` wrapper may call (`server.modules` is the only mount point that can touch a match).
   * It is `_applyHex` minus the draft state: the same `applyHex` (the immediate `onPick` part, the persistent `hex:<id>`
   * EffectRef, its battle half, and every extra it carries), then a recompute and a private-view push.
   *
   * The CALLER owns "should this player get one, and which one" (the shop charges 12 first, the test panel gates on the
   * test field). Here it only refuses ids outside the PLAYER roster: an enemy card's `mods` / `verb` is not a thing a
   * player may own. The same card twice is allowed, exactly like `g.testHex`: `applyHex` dedupes the ref while the
   * immediate part runs again.
   * @param {any} ps the player to grant to
   * @param {string} hexId a player-roster hex id (data/hextech.json `playerHexes`)
   * @returns {object|null} the granted record, or null (unknown id / not a player hex / applyHex threw)
   */
  grantHex(ps, hexId) {
    if (!ps) return null;
    const hex = typeof hexId === 'string' ? this.gd.hex(hexId) : null;
    if (!hex) return null;
    const playerPool = this.gd.hexPlayerPool();
    if (!playerPool.some((h) => h && h.id === hex.id)) return null;
    try { applyHex(this, ps, hex); } catch (e) { this.reportError(`grantHex ${hex.id}`, e); return null; }
    ps.recompute();
    this.markPrivate(ps);
    return hex;
  }

  /**
   * g.hexRecycle { ids } — 第 6 回合的「点卡刷新」：业主 2026-10-30「在第6回合玩家可以舍弃1-2个协议源石随机获得相同数量的
   * 协议源石」，2026-10-31 改成「把有的协议源石铺上去，点哪张刷哪张」的界面（`04-文档` 与 docs/design/match.md 同一条口径）。
   *
   * 口径：
   *   * **抽卡照常，另外给一次换牌机会** —— 第 6 回合的三选一照旧（`enterHexDraft`）。换牌在**自己选完之后**就能用：
   *     抽卡阶段里 `picks[pid]` 已经落下（`_hexRecycleGate` 的 HEX_DRAFT 分支），或者进了休整期（PREP 且未准备）。
   *     业主 2026-10-31「就是选完协议源石，这面板直接出现」—— 选完不必等别人、也不必等机变。
   *   * **每局 2 张**（`HEX_RECYCLE_BUDGET`）—— 点一次花一次，可以点同一张两次，也可以点两张各一次；每次 `ids` 1–2 个。
   *   * **完全随机、沿用抽取权重** —— 换回来的牌走 `rollOffers` 与 `gd.hexWeights()`（当前 1/2/3 阶 0.46/0.38/0.16），
   *     池子是这个玩家自己的 `_hexPoolFor`（禁用 + 未激活盟约的专属卡都照旧收窄，第 7 回合的 exclusive 收窄在第 6 回合
   *     不生效）。
   *   * **不回收已经给过的一次性收益** —— 与测试场的 `g.testHexClear` 同一条口径：只摘掉 `hex:<id>` EffectRef（持续/战斗
   *     那一半随之消失），`onPick` 已经发出去的资金 / 部署位 / 装备 / 干员留在原地。要逐卡写回滚是另一件事，业主明确不做。
   *
   * 另外两条 [ASSUMED]（业主没有点名，按最简单的读法实现）：
   *   * **能换的是此刻拥有的一切**，包括本回合刚抽到的那张（每局只 2 张，不会变成无限刷新）。
   *   * **换回的牌不会再是刚换掉的那张**，与刷新同一条「不会立刻回到手上」规则（`rollOffers` 的 `owned` 里带上它们）。
   *     队友手上的同名**团队卡**副本不动：那是他们自己的 EffectRef，来源无法区分，摘掉会误伤独立抽到同一张的队友。
   *
   * 池子凑不出**同样数量**的替代牌时直接拒绝（BAD_TARGET）——「随机获得相同数量」是这条规则的原话，宁可不让用也不发半份；
   * 被拒绝的请求一张牌都不动、次数也不扣。AI 座位不用它（bot 从不发意图，规则里也没有给它们的自动版本）。
   * @param {any} ps
   * @param {string[]} ids 1–2 个互不相同的、自己已拥有的协议源石 id（界面点一次只发一张）
   */
  recycleHex(ps, ids) {
    if (!ps) return fail(ERR.BAD_TARGET);
    const gate = this._hexRecycleGate(ps);
    if (gate) return gate;
    const list = Array.isArray(ids) ? [...new Set(ids.filter((id) => typeof id === 'string' && id))] : [];
    if (list.length < 1 || list.length > 2) return fail(ERR.BAD_TARGET);
    if (list.length > ps.hexRecycleLeft) return fail(ERR.BAD_TARGET, 'budget');
    const owned = hexIdsOf(ps);
    if (!list.every((id) => owned.includes(id))) return fail(ERR.BAD_TARGET, 'not owned');
    // the pool the draft itself would offer this player (bans + 专属 cards of bonds that are not active)
    const pool = this._hexPoolFor(ps);
    const remaining = owned.filter((id) => !list.includes(id));
    const weights = this.gd.hexWeights();
    const replacements = rollOffers(this.rngHex, { pool, owned: [...remaining, ...list], weights, count: list.length });
    if (replacements.length < list.length) return fail(ERR.BAD_TARGET, 'pool exhausted');
    // 舍弃：只摘自己身上的 ref —— 复制（`hex:<id>#<n>`）也是同一张卡，一起走
    ps.effects = (ps.effects || []).filter((e) => !(e && typeof e.key === 'string' && e.key.startsWith('hex:')
      && list.includes(e.data && e.data.hexId)));
    // 换回：走正式的发牌路径（`applyHex`），所以立即生效的那一半、持续 ref、战斗半段与各种额外（镜像协议 / 二次抽取）都照常
    for (const id of replacements) {
      const hex = this.gd.hex(id);
      if (!hex) continue;
      try { applyHex(this, ps, hex); } catch (e) { this.reportError(`recycleHex ${id}`, e); }
    }
    ps.hexRecycleLeft -= list.length;
    ps.recompute();
    this.markPrivate(ps);
    this.markPublic();
    return OK;
  }

  /**
   * 第 6 回合换牌的闸门（`recycleHex` 的唯一受理条件，测试直接打它）。
   *
   * 两个窗口：
   *   * **HEX_DRAFT 且自己已经选完** —— 业主 2026-10-31「选完协议源石，这面板直接出现」：抽卡是并行的，自己选完就不必
   *     等别人；`picks[pid]` 已落下且没有欠的额外选牌（管理员的第一回合额外选牌不在第 6 回合，这里只是兜底）。
   *     抽卡本身不受影响：只改自己身上的 `hex:<id>` ref，`offers` / `picks` 一个字节都不动。
   *   * **PREP 且未准备** —— 与其它备战期动作同一条口径（准备之后再改牌等于改一份已经提交的阵地）。机变回合夹在中间时
   *     （`spRounds` 含 6 的难度），休整期会再给一次。
   *
   * 其它阶段、其它回合、次数用完（`ALREADY`）都拒绝；`detail` 点名是哪一条。
   * @param {any} ps @returns {object|null} `fail(...)` 或 null
   */
  _hexRecycleGate(ps) {
    if (!ps || !ps.alive) return fail(ERR.ELIMINATED);
    if (Number(this.round) !== 6) return fail(ERR.WRONG_PHASE, 'round 6');
    if (!(ps.hexRecycleLeft > 0)) return fail(ERR.ALREADY);
    if (this.phase === PHASE.PREP) return ps.ready ? fail(ERR.WRONG_PHASE, 'ready') : null;
    if (this.phase === PHASE.HEX_DRAFT) {
      if (!this.hex || this.hex.picks[ps.playerId] == null) return fail(ERR.WRONG_PHASE, 'pick first');
      if (this._hexPicksLeft(ps.playerId) > 0) return fail(ERR.WRONG_PHASE, 'pick first');
      return null;
    }
    return fail(ERR.WRONG_PHASE);
  }

  /** The bot's pick: the dearest rarity, with a small jitter (mirrors botPickCard's scoring style). */
  botPickHex(offer) {
    const rank = { silver: 0, gold: 1, prismatic: 2 };
    let best = 0;
    let bestScore = -Infinity;
    for (let i = 0; i < offer.length; i++) {
      const hex = this.gd.hex(offer[i]);
      const score = (hex ? rank[hex.rarity] ?? 0 : 0) + this.rngBots() * 0.5;
      if (score > bestScore) { bestScore = score; best = i; }
    }
    return best;
  }

  /** A bot seat picks on a short delay (mirrors MatchSpDraft.scheduleSpBot). */
  scheduleHexBot(ps) {
    const token = this._turnToken;
    this.later(this.scaled(DELAYS.BOT_ACTION), () => {
      if (this.phase !== PHASE.HEX_DRAFT || token !== this._turnToken || !this.hex) return;
      // 管理员 (业主 2026-10-25): "owes a pick", not "has no pick recorded" — a bot that picked once and still owes the
      // extra one has to take it too, or the draft can only end on the timer.
      if (!ps || !ps.botControlled || !ps.alive || this._hexPicksLeft(ps.playerId) <= 0) return;
      const offer = this.hexOfferOf(ps.playerId);
      if (!offer.length) return;
      this._applyHex(ps, this.botPickHex(offer));
    });
  }

  /**
   * The timer ran out: everyone still deciding gets a random one of their three.
   *
   * 管理员's extra pick (业主 2026-10-25) is a SECOND round of the same draft, so the old test — "skip anyone who
   * already has a pick recorded" — silently DROPPED it: the player kept the one card they had chosen, and the
   * `finishHexDraft` below ran on a draft that was not done. That is 业主 2026-10-25「管理员策略有问题，不一定能选两次」:
   * the extra pick only existed if you clicked it before the 30 s deadline. Resolve every pick the player still OWES
   * instead, re-reading the offer each round because `_applyHex` re-deals it after the base pick.
   */
  _timeoutHexDraft() {
    if (this.phase !== PHASE.HEX_DRAFT || !this.hex) return;
    for (const ps of this.alivePlayers()) {
      // bounded: `_hexPicksLeft` falls by exactly one per `_applyHex`, and a player with no card to give must not spin
      // (an empty offer breaks out, which is the old force-finish path)
      for (let guard = 0; guard < 8; guard++) {
        if (this.phase !== PHASE.HEX_DRAFT || this._hexPicksLeft(ps.playerId) <= 0) break;
        const offer = this.hexOfferOf(ps.playerId);
        if (!offer.length) break;
        this._applyHex(ps, Math.min(offer.length - 1, Math.floor(this.rngHex() * offer.length)));
      }
    }
    if (this.phase === PHASE.HEX_DRAFT) this.finishHexDraft();
  }

  /**
   * 协议等级 (owner's call 2026-10-18): the enemy gets `extraEnemyHexes` extra 协议源石 — levels 13–15 one, 16–17 two,
   * 18 three.
   *
   * 业主 2026-10-22「额外协议源石分散给，在1，3，5回合给额外的」: they are NOT all granted at match start any more. The
   * i-th card lands on `PROTOCOL_LEVEL_EXTRA_HEX_ROUNDS[i]` (1 / 3 / 5), so L18 gets one at each of R1, R3 and R5 while
   * L16–17 get R1 + R3 and L13–15 the R1 card only. Called once per round from `MatchPhases.startRound`, before the prep
   * phase — the enemy already owns this round's card when the players shop. A round with nothing due returns 0 and
   * touches neither the state nor the RNG.
   *
   * Drawn from the enemy roster on the match's own rngHex so a replay is deterministic, skipping cards the enemy already
   * owns. A data set without the roster returns 0 and changes nothing.
   * @param {number} round the round this grant belongs to
   * @returns {number} how many were granted
   */
  applyProtocolLevelEnemyHexes(round = this.round) {
    const due = protocolLevelExtraHexesAt(this.gd.protocolLevel, round, this.gd.difficulty);
    if (!(due > 0)) return 0;
    if (!Array.isArray(this.enemyHexes)) this.enemyHexes = [];
    const pool = this.gd.hexEnemyPool();
    if (!pool.length) return 0;
    const rarities = [...new Set(pool.map((h) => h && h.rarity).filter(Boolean))].sort();
    if (!rarities.length) return 0;
    const owned = this.enemyHexes.map((e) => (e && e.id ? e.id : e));
    let granted = 0;
    for (let i = 0; i < due; i++) {
      const rarity = pickEnemyRarity(this.rngHex, rarities);
      const id = pickEnemyHex(this.rngHex, { pool, owned, rarity });
      if (!id) break;
      owned.push(id);
      this.enemyHexes.push({ id, round });
      granted += 1;
    }
    if (granted) this.hexDrawRound = round;
    return granted;
  }

  /** Grant the enemy side its hex for this round and go to PREP. */
  finishHexDraft() {
    if (this.phase !== PHASE.HEX_DRAFT) return;
    this.setDeadline(0);
    this.hexDrawRound = this.round;
    const picked = this.alivePlayers().map((ps) => {
      const id = this.hexOfferOf(ps.playerId)[this.hex.picks[ps.playerId]];
      const hex = id ? this.gd.hex(id) : null;
      return hex ? hex.rarity : null;
    }).filter(Boolean);
    const format = this.gd.hexFormat() || {};
    const perDraw = Number.isInteger(format.enemyPerDraw) && format.enemyPerDraw > 0 ? format.enemyPerDraw : 1;
    this.hex = null;
    if (picked.length) {
      const owned = this.enemyHexes.map((e) => e && e.id ? e.id : e);
      const pool = this.gd.hexEnemyPool();
      for (let i = 0; i < perDraw; i++) {
        const rarity = pickEnemyRarity(this.rngHex, picked);
        if (!rarity) break;
        const id = pickEnemyHex(this.rngHex, { pool, owned, rarity });
        if (!id) break;
        owned.push(id);
        this.enemyHexes.push({ id, round: this.hexDrawRound });
      }
    }
    this.afterHexDraft();
  }

  /**
   * 管理员2 / 管理员3 (业主 2026-10-25): the strategies' `band_hex_grant_rounds` entries as `{ rounds, hexId }`.
   * `hexId` is null for the "随机获得一枚" half (管理员2) and the pinned card for the "获得潘多拉" half (管理员3).
   * A strategy names one or two rounds: an absent `roundB` (管理员3 since 2026-10-31, 「改成第5回合开始时获得」) is
   * dropped by the integer filter instead of counting as round 0.
   * @param {any} ps @returns {Array<{ rounds: number[], hexId: string|null }>}
   */
  bandHexGrants(ps) {
    const bandId = ps && typeof ps.bandId === 'string' ? ps.bandId : null;
    const band = bandId && this.gd && typeof this.gd.band === 'function' ? this.gd.band(bandId) : null;
    const out = [];
    for (const b of (band && Array.isArray(band.buffs) ? band.buffs : [])) {
      if (!b || b.key !== BAND_HEX_GRANT_ROUNDS_KEY) continue;
      // `bb` values are finite numbers by contract (test/data.test.js), so the rounds are two named keys, not a list
      const rounds = [Number(b.bb && b.bb.roundA), Number(b.bb && b.bb.roundB)]
        .filter((n) => Number.isInteger(n) && n > 0);
      if (!rounds.length) continue;
      const pinned = b.bbStr && typeof b.bbStr.hexId === 'string' && b.bbStr.hexId ? b.bbStr.hexId : null;
      out.push({ rounds, hexId: pinned });
    }
    return out;
  }

  /**
   * One random 协议源石 the player does not own yet, drawn from their OWN pool.
   *
   * The pool is the draft's (`hexPoolFor`: bans + 专属 cards whose bond is not active), so a strategy can never hand out a
   * banned card or someone else's 锻炉. The roll uses the match's seeded `rngHex` over a **sorted** id list, so a replay
   * draws the same card.
   * @param {any} ps @returns {any|null} the hex record, or null (everything already owned / empty pool)
   */
  _rollBandHex(ps) {
    const owned = new Set(hexIdsOf(ps));
    const ids = hexPoolFor(ps, this.gd)
      .filter((h) => h && typeof h.id === 'string' && !owned.has(h.id))
      .map((h) => h.id)
      .sort();
    if (!ids.length) return null;
    return this.gd.hex(ids[Math.floor(this.rngHex() * ids.length) % ids.length]);
  }

  /**
   * Grant the strategies' round-start 协议源石 for this round.
   *
   * 业主 2026-10-25「增加策略『管理员2』：第一回合随机获得一个协议源石，第3回合随机获得一个协议源石」
   * 「增加策略『管理员3』：第4，10 回合获得『潘多拉』」, 后者 2026-10-31「改成第5回合开始时，获得『潘多拉魔盒』」
   * （单回合 ⇒ 只写 `roundA`）. Called once per round from `MatchPhases.startRound`, beside
   * `applyProtocolLevelEnemyHexes` (the enemy's half). The grant goes through `grantHex`, the production pick path, so
   * every immediate `onPick` part and every 获得时 extra runs exactly as if the card had been picked in a draft.
   *
   * A round with nothing due touches neither the state nor the RNG.
   * @param {number} [round] @returns {number} how many cards were granted
   */
  applyBandRoundHexes(round = this.round) {
    const r = Number(round);
    if (!Number.isInteger(r)) return 0;
    let granted = 0;
    for (const ps of this.alivePlayers()) {
      for (const spec of this.bandHexGrants(ps)) {
        if (!spec.rounds.includes(r)) continue;
        const hex = spec.hexId ? this.gd.hex(spec.hexId) : this._rollBandHex(ps);
        if (!hex) continue;
        if (this.grantHex(ps, hex.id)) granted += 1;
      }
    }
    return granted;
  }

  /**
   * After the 海克斯 draft: a round that is also a 机变 round runs that draft next (rounds 6 / 11 can be both — the two
   * systems are independent, so neither replaces the other), else straight to the prep phase.
   */
  afterHexDraft() {
    if (this.gd.spRounds().includes(this.round)) this.enterSpDraft();
    else this.enterPrep();
  }
}
