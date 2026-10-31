// shared/chessPrice.js — the price of one shop chess: ONE rule for both ends.
//
// `GameData.chessPrice` (server/match/gamedata.js) is the authority for what a purchase costs before the per-purchase
// modifiers: the shop charges `PlayerState.priceOf`, which starts from this number and lets `onPrice` handlers (购买价格为N
// 一类) and the free-purchase windows move it. The 测试场's 干员 picker (public/js/ui/testArena.js, `g.testChess`) has to
// show the SAME base number before the tap, and it cannot ask the server for it: no per-operator price rides `m.public` —
// adding one would change the pushed frame shape (and with it `PROTOCOL_VERSION`) for a test-only panel. So the rule lives
// here and both ends call it. A second copy of it would drift, and a card whose label disagrees with the charge is exactly
// the kind of bug this repository has paid for before (「表的注释改了、界面的字样没改」, docs/design/match.md's 协议等级
// section).
//
// The order is the one `GameData.chessPrice` has always applied (0.3.0, unchanged):
//   1. the mode's own `economy.chessPrice[tier].normal|golden` (a `data/config.json` `modes[...]` override),
//   2. the chess record's own `price`,
//   3. `economy.chessPrice[tier]` — a number, or `{ normal, golden }`,
//   4. the per-tier default (TIER_CHESS_PRICE).
//
// Everything is a plain object read: no data store, no match state, no side effects — so the client can call it while
// rendering and a test can call it with two literals.

/** The per-tier default price of a normal chess (`DEFAULTS.chessPrice`, server/match/gamedata.js). */
export const TIER_CHESS_PRICE = Object.freeze({ 1: 2, 2: 3, 3: 3, 4: 3, 5: 4, 6: 4 });

/** A price that is a usable number (the same test `gamedata.js`'s `numOr` applies). */
const money = (v) => typeof v === 'number' && Number.isFinite(v) && v >= 0;

/**
 * The price of chess `record` at `tier`.
 *
 * @param {any} record the `data/chess.json` record (null for an unknown id — the mode override and the tier table still
 *   answer, exactly as `GameData.chessPrice` does for an id it cannot resolve)
 * @param {number} tier the shop tier to price at (`GameData.tierOf`; falls back to the record's own tier)
 * @param {any} [modeEconomy] `data/config.json` `modes[modeId].economy` (the mode's overrides)
 * @param {any} [economy] `data/config.json` `economy` (the global table)
 * @returns {number}
 */
export function chessPriceOf(record, tier, modeEconomy = null, economy = null) {
  const t = Number.isInteger(tier) ? tier : (record && Number.isInteger(record.tier) ? record.tier : 1);
  const golden = !!(record && record.isGolden);
  const override = modeEconomy && modeEconomy.chessPrice ? modeEconomy.chessPrice[t]?.[golden ? 'golden' : 'normal'] : undefined;
  if (money(override)) return override;
  if (record && money(record.price)) return record.price;
  const row = economy && economy.chessPrice ? economy.chessPrice[t] : null;
  if (row && typeof row === 'object') {
    const v = golden ? row.golden : row.normal;
    return money(v) ? v : (TIER_CHESS_PRICE[t] ?? 3);
  }
  return TIER_CHESS_PRICE[t] ?? 3;
}
