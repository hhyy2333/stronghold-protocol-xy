// server/sim/battle/economy.js — Battle methods: DP, IN_BATTLE bond layer gains (capped by layerGainRoom) and bounty
// coins.
// Installed on Battle.prototype by server/sim/Battle.js (a method container: never instantiated; `this` is the battle).

import { BOND_LAYER_CAP, layerGainRoom } from '../../../shared/constants.js';

export class BattleEconomy {
  addDp(playerId, n) {
    const ps = this.getPlayer(playerId);
    if (!ps || !Number.isFinite(n)) return 0;
    ps.dp = Math.max(0, Math.min(this.flags.dpMax, ps.dp + n));
    return ps.dp;
  }

  /**
   * Whether IN_BATTLE layer gains are ON for ONE player of this battle (【突破极限】 `hex_break_limit`, 业主 2026-11-01:
   * 「拥有者在联防战斗里也能叠层，其他人照旧」).
   *
   * 口径：整场仍然是 `flags.layerGainsEnabled`（普通战场 true；联防 / 首领 / 隐藏 false），另有一份**每玩家**的表
   * `flags.layerGainsByPlayer: { [playerId]: boolean }` —— 表里点名的玩家听表，没点名的（以及根本没有这张表的整场）
   * 听整场 flag。于是**没有这张表的 spec 与从前逐字节相同**：`layerGainsOn(pid) === !!flags.layerGainsEnabled`。
   * match 侧只在真有拥有者时才写这张表（server/match/match/unitePhase.js `_uniteOpts`）。客户端跑同一份 sim、同一份
   * spec，所以服务端与浏览器的判断一致。
   *
   * 为什么闸门必须在这里（而不是只在结算）：联防战场是多人共用一个 battle，层数在战斗内就参与战况（层数阈值 / 特质
   * 加成），「先让大家加、结算时再只给拥有者」会改变战斗结果；也只有这里能同时拦住 `support.gainLayers`（特质那条主路径）。
   * @param {number|string|null} playerId
   * @returns {boolean}
   */
  layerGainsOn(playerId) {
    const byPlayer = this.flags && this.flags.layerGainsByPlayer;
    if (byPlayer && typeof byPlayer === 'object' && playerId != null) {
      const v = byPlayer[playerId];
      if (typeof v === 'boolean') return v;
    }
    return !!(this.flags && this.flags.layerGainsEnabled);
  }

  /**
   * The 盟约叠层上限 of ONE player of this battle (【突破极限】, 设计稿 §3): the `bondLayerCap` the match wrote on that
   * player's PlayerBattleInput (player/round.js battleInput → `bondLayerCapOf(ps)`: 9999 for the card's owner, 999
   * otherwise), else a battle-level `this.bondLayerCap` when a caller set one (a spec-driven battle, the workshop API),
   * else the official `BOND_LAYER_CAP`. 0 / a non-finite value = "no cap" (Infinity), the constants.js convention.
   *
   * Per PLAYER, not per battle: a 联防 field carries a helper's own input next to the leaker's, and a helper without the
   * card must keep stopping at 999.
   * @param {number|string|null} playerId
   * @returns {number}
   */
  _layerCapOf(playerId) {
    const p = playerId != null && typeof this.getPlayer === 'function' ? this.getPlayer(playerId) : null;
    const own = Number(p && p.input && p.input.bondLayerCap);
    if (Number.isFinite(own) && own > 0) return own;
    const b = Number(this.bondLayerCap);
    if (Number.isFinite(b) && b > 0) return b;
    return BOND_LAYER_CAP > 0 ? BOND_LAYER_CAP : Infinity;
  }

  /**
   * Record an IN_BATTLE layer gain (no-op when THIS player's gains are off — `layerGainsOn`). Returns the layers added:
   * at most the room left under this player's cap (BOND_LAYER_CAP 999 — 9999 with 【突破极限】, `_layerCapOf`) on the live
   * copy — the client's AddBondCount `min(L + n, 999)`; the `layerGain` hook (魔王's +1 …) runs first, then the clamp; a
   * bond already at the cap gains 0 (no hook, no event). Without a live copy of the bond (a partial PlayerBattleInput)
   * the battle's own gains count; the match's settle clamps the persistent count the same way (hextech.js
   * bondLayerCapOf) and applies the same per-player switch (unitePhase.js `uniteLayerGainsOn`).
   */
  addLayers(playerId, bondId, n, reason = '', opts = {}) {
    if (!this.layerGainsOn(playerId) || !(n > 0) || !Number.isFinite(n) || playerId == null) return 0;
    const pp = this._pp(playerId);
    if (!pp) return 0;
    const cap = this._layerCapOf(playerId);
    const ps = this.getPlayer(playerId);
    const live = ps && ps.bonds[bondId] ? (ps.bonds[bondId].layers ?? 0) : (pp.layerGains[bondId] ?? 0);
    if (!(layerGainRoom(live, Infinity, cap) > 0)) return 0;
    const source = opts.source ?? null;
    const ctx = { playerId, bondId, n, reason, source, tile: Array.isArray(opts.tile) ? opts.tile : this._sourceTile(source) };
    if (this._hooks.layerGain) { this.emit('layerGain', ctx); if (!(ctx.n > 0) || !Number.isFinite(ctx.n)) return 0; }
    const add = layerGainRoom(live, ctx.n, cap);
    if (!(add > 0)) return 0;
    pp.layerGains[bondId] = (pp.layerGains[bondId] ?? 0) + add;
    if (ps && ps.bonds[bondId]) ps.bonds[bondId].layers = (ps.bonds[bondId].layers ?? 0) + add;
    this._ev(['layer', playerId, bondId, add]);
    return add;
  }

  /**
   * Tile of a gain's source unit ([r, c]): where it stands, or where it stood when it left the field during this very
   * instant (a "被击倒时" gain fires from its `death`). null otherwise (no source, long gone, not a unit).
   */
  _sourceTile(u) {
    if (!u || typeof u !== 'object' || !Number.isFinite(u.x)) return null;
    const here = u.alive && u.deployed && !u.hidden;
    if (!here && !(u.deathAt === this.time && !u.alive)) return null;
    return u.side === 'ally' ? [u.tileR, u.tileC] : [Math.round(u.y), Math.round(u.x)];
  }

  /**
   * The player a kill bounty (`unit.bounty`: a 悬赏 card's enemy, a 鸭爵 swap) pays when its enemy dies: the bounty pays
   * whenever the body dies (the owner's decision, relayed 2026-10-06). An operator or summon of a player of this battle
   * that dealt the blow pays its player ("将其击倒者获得N资金" — a 联防 helper included); any other death — 无来源 damage
   * (terrain, an uncredited tick), its own drain, another enemy, an ownerless unit — pays the card's owner when that
   * player fights here (own field, Final Assault / Hidden Core), else (联防, where the owner is the leaker) the player
   * whose half of the field it fell on: PRTS 卫戍协议：盟约 决策 "该敌人于对应玩家所属区域倒下时，使相应玩家获得额外资金"
   * [ASSUMED for 联防: no source names the payee of a death nobody caused there]. Until 0.2.0 that fallback was the
   * leaker, who has no entry in a 联防 battle, and addCoins dropped the coins (community report of 2026-10-06
   * 「被源石地板烫死的悬赏没给赏金」: in 0.1.x the 联防 field was the round's map, as it is again since 0.2.1, 战场#04's
   * 活性源石 included).
   */
  _bountyPayee(unit, killer = null) {
    if (killer && killer.side === 'ally' && killer.ownerId != null && this._pp(killer.ownerId)) return killer.ownerId;
    const owner = unit.bounty?.ownerPlayerId ?? unit.ownerId;
    if (owner != null && this._pp(owner)) return owner;
    return this._ownerForTile([Math.round(unit.y), Math.round(unit.x)]);
  }

  /**
   * 悬赏通道的金币（击杀悬赏 / 过路费 / 协议源石自己的击杀金币…）。
   *
   * `opts.hex === true` = 这一笔**来自协议源石**（骑士金神 `hex_kazimierz_knightgold` 的击杀金币；业主 2026-11-01
   * 「海克斯提供的钱不计入 n19 的 30 块上限」）：除了 `pp.coins` 之外**另记一份** `pp.coinsHex`，结算
   * （server/match/match/settle.js）把这一份记进 `ps.pendingHexFunds`，回合开始时 `round.js startRound` 的
   * income 那一笔按它豁免上限（server/match/player/economy.js `_hexFundsExempt`）。
   *
   * 不带 `opts` 的老调用**逐字节不变**：`pp.coins` 照旧、`coinsHex` 不动（战报里也就没有这个键）。
   * @param {number|string} playerId @param {number} n @param {{ hex?: boolean }} [opts]
   * @returns {number} coins added
   */
  addCoins(playerId, n, opts = {}) {
    const pp = this._pp(playerId);
    if (!pp || !(n > 0) || !Number.isFinite(n)) return 0;
    pp.coins += n;
    // 协议源石来源的那一份：与 `coins` 并列记着，结算据此区分「真悬赏」与「海克斯的钱」
    if (opts && opts.hex === true) pp.coinsHex = (Number.isFinite(pp.coinsHex) ? pp.coinsHex : 0) + n;
    this._ev(['bounty', playerId, n]);
    return n;
  }
}
