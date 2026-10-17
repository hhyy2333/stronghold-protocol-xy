// server/match/match/hexDraft.js — Match methods: the 海克斯 draft (DESIGN §29). A PARALLEL draft: every alive player
// is offered their own three hexes at the same time (no turn order, no shared pool, no SOLD_OUT) and picks one; each
// has one reroll. The phase runs after ROUND_START on the rounds of data/hextech.json `format.rounds` (1 / 6 / 11).
//
// When everyone has picked (or the timer runs out — the leftovers are then drawn at random) the enemy side gains one
// hex whose rarity is drawn at random among the rarities the players picked this round; enemy hexes persist for the
// rest of the match (Match.enemyHexes) and are folded into every battle by Match.hexSpawnMods.
//
// Installed on Match.prototype by server/match/Match.js (a method container: never instantiated; `this` is the match).

import { PHASE, ERR } from '../../../shared/constants.js';
import { rollOffers, pickEnemyRarity, pickEnemyHex } from '../../../shared/hextech.js';
import { applyHex, hexIdsOf } from '../hextech.js';
import { OK, fail, DELAYS } from './common.js';

export class MatchHexDraft {
  /** Enter the draft for this round (called from MatchPhases.afterRoundStart). */
  enterHexDraft() {
    const gd = this.gd;
    const alive = this.alivePlayers();
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
      offers[ps.playerId] = rollOffers(this.rngHex, { pool, owned: hexIdsOf(ps), weights, count: offer });
      rerolls[ps.playerId] = gd.hexRerolls();
    }
    this.hex = { offers, picks: {}, rerolls, untimed: this.soloUntimed, turnDeadline: 0 };
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

  /** The offered hex ids of one player ([] when the phase is not running). */
  hexOfferOf(playerId) {
    return (this.hex && this.hex.offers && this.hex.offers[playerId]) || [];
  }

  /** Whether every alive player has picked. */
  hexDraftDone() {
    if (!this.hex) return true;
    return this.alivePlayers().every((ps) => this.hex.picks[ps.playerId] != null);
  }

  /** g.hex { idx } — the player's own three options, so only the offer's length bounds the index. */
  pickHex(ps, idx) {
    if (this.phase !== PHASE.HEX_DRAFT || !this.hex) return fail(ERR.WRONG_PHASE);
    if (!ps.alive) return fail(ERR.ELIMINATED);
    if (this.hex.picks[ps.playerId] != null) return fail(ERR.ALREADY);
    const offer = this.hexOfferOf(ps.playerId);
    if (!Number.isInteger(idx) || idx < 0 || idx >= offer.length) return fail(ERR.BAD_TARGET);
    this._applyHex(ps, idx);
    return OK;
  }

  /** g.hexReroll {} — one reroll per player per draft; the pick is not consumed by it. */
  rerollHex(ps) {
    if (this.phase !== PHASE.HEX_DRAFT || !this.hex) return fail(ERR.WRONG_PHASE);
    if (!ps.alive) return fail(ERR.ELIMINATED);
    if (this.hex.picks[ps.playerId] != null) return fail(ERR.ALREADY);
    if (!(this.hex.rerolls[ps.playerId] > 0)) return fail(ERR.NO_REROLL);
    this.hex.rerolls[ps.playerId] -= 1;
    const gd = this.gd;
    // 刷新要把**这一批**也排除掉（业主 2026-10-16「刷新会有重复海克斯」）：`hexIdsOf` 只是玩家**已经拥有**的，
    // 不含当前 offer 的三张。只传 owned 的话，新抽的三张可能又是刚被换掉的那几张 —— 池子小的时候（测试/少人数局）
    // 几乎必然如此（实测：3 张卡的池子，20 个种子里 5 次刷出与原来完全相同的三张）。
    const offered = this.hexOfferOf(ps.playerId);
    this.hex.offers[ps.playerId] = rollOffers(this.rngHex, {
      pool: gd.hexPlayerPool(), owned: [...hexIdsOf(ps), ...offered], weights: gd.hexWeights(), count: gd.hexOfferCount(),
    });
    this.markPrivate(ps);
    this.markPublic();
    return OK;
  }

  /** Apply the choice at `idx` of the player's offer and finish the phase once everyone has one. */
  _applyHex(ps, idx) {
    const s = this.hex;
    if (!s || s.picks[ps.playerId] != null) return;
    const id = this.hexOfferOf(ps.playerId)[idx];
    const hex = id ? this.gd.hex(id) : null;
    if (!hex) return;
    s.picks[ps.playerId] = idx;
    try { applyHex(this, ps, hex); } catch (e) { this.reportError(`applyHex ${hex.id}`, e); }
    this.markPrivate(ps);
    this.markPublic();
    // the transition to PREP is deferred by one tick, like the other drafts (MatchSpDraft.finishSpDraft runs from a
    // `later` too): the phase ends on a clean step boundary instead of inside the intent that completed it
    if (this.hexDraftDone() && this.phase === PHASE.HEX_DRAFT) this.later(0, () => this.finishHexDraft());
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
      if (!ps || !ps.botControlled || !ps.alive || this.hex.picks[ps.playerId] != null) return;
      const offer = this.hexOfferOf(ps.playerId);
      if (!offer.length) return;
      this._applyHex(ps, this.botPickHex(offer));
    });
  }

  /** The timer ran out: everyone still deciding gets a random one of their three. */
  _timeoutHexDraft() {
    if (this.phase !== PHASE.HEX_DRAFT || !this.hex) return;
    for (const ps of this.alivePlayers()) {
      if (this.hex.picks[ps.playerId] != null) continue;
      const offer = this.hexOfferOf(ps.playerId);
      if (!offer.length) continue;
      this._applyHex(ps, Math.min(offer.length - 1, Math.floor(this.rngHex() * offer.length)));
    }
    if (this.phase === PHASE.HEX_DRAFT) this.finishHexDraft();
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
   * After the 海克斯 draft: a round that is also a 机变 round runs that draft next (rounds 6 / 11 can be both — the two
   * systems are independent, so neither replaces the other), else straight to the prep phase.
   */
  afterHexDraft() {
    if (this.gd.spRounds().includes(this.round)) this.enterSpDraft();
    else this.enterPrep();
  }
}
