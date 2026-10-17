// shared/hextech.js — the pure half of 海克斯 (Hextech, DESIGN §29): rarity order, the draft rolls and the enemy
// multipliers. Imported by the server (server/match/match/hexDraft.js) and by tests; the client reads the roster
// through data/hextech.json and only needs the rarity order for its frames.
//
// No Node APIs, no game data, no display text: every function takes what it needs, so the same call with the same
// seeded rng gives the same result on both sides (the draft itself only ever runs on the server).
//
// Draft rules (DESIGN §29):
//   * a draft happens on the rounds in `data/hextech.json` `format.rounds` (1 / 6 / 11);
//   * every player is offered `format.offer` hexes (3) they do not own yet, picked by rarity weight;
//   * every player may reroll once per draft;
//   * after a draft the enemy side gains `format.enemyPerDraw` hex (1) whose rarity is drawn at random from the
//     rarities the players picked this round — the enemy pool never repeats a hex it already has, and a rarity whose
//     pool is exhausted falls back to the adjacent one;
//   * enemy hexes persist for the rest of the match.

/** Rarity tiers, weakest first (the fallback order below follows it). */
export const RARITY_ORDER = Object.freeze(['silver', 'gold', 'prismatic']);

/** Round numbers the default schedule draws on (mirrors data/hextech.json `format.rounds`). */
export const HEX_ROUNDS = Object.freeze([1, 6, 11]);

/**
 * The largest offer a draft may configure (`format.offer`). The wire schema bounds `g.hex { idx }` by this, NOT by the
 * live offer length — protocol.js is a static schema with no match data, and the server's own `pickHex` is the
 * authoritative bound (`idx >= offer.length` → BAD_TARGET). Keeping the schema at the real default (3) would make a
 * 4-option offer's fourth card unclickable: its intent is refused as `bad field idx` before the match ever sees it.
 */
export const HEX_MAX_OFFER = 6;

/** The persistent effect-ref key of a player hex (parallel to `choice:<id>`). */
export function hexEffectKey(id) {
  return `hex:${id}`;
}

/** Position of a rarity in the escalation order, or -1. */
export function rarityRank(id) {
  return RARITY_ORDER.indexOf(String(id));
}

/**
 * The order a rarity's pool is searched in when it is exhausted: the rarity itself, then the *higher* tiers, then the
 * lower ones (an empty prismatic pool falls back to gold before it falls back to gold's neighbours).
 * @param {string} rarity
 * @returns {string[]}
 */
export function rarityFallbackOrder(rarity) {
  const rank = rarityRank(rarity);
  if (rank < 0) return [...RARITY_ORDER];
  const up = RARITY_ORDER.slice(rank + 1);
  const down = RARITY_ORDER.slice(0, rank).reverse();
  return [RARITY_ORDER[rank], ...up, ...down];
}

/** Uniform pick from an array (null for an empty one). */
export function pickOne(rng, list) {
  if (!Array.isArray(list) || !list.length) return null;
  const i = Math.min(list.length - 1, Math.max(0, Math.floor(rng() * list.length)));
  return list[i];
}

/**
 * One rarity id, weighted by `weights` ({ silver: 0.6, … }); only rarities present in `available` are considered.
 * Returns null when nothing is available.
 * @param {() => number} rng
 * @param {string[]} available rarity ids with at least one usable entry
 * @param {Record<string, number>} [weights]
 */
export function pickRarity(rng, available, weights = null) {
  const ids = [...new Set(available)].filter((id) => rarityRank(id) >= 0);
  if (!ids.length) return null;
  const w = ids.map((id) => {
    const v = weights && Number.isFinite(weights[id]) ? weights[id] : 1;
    return v > 0 ? v : 0;
  });
  const total = w.reduce((s, v) => s + v, 0);
  if (total <= 0) return pickOne(rng, ids);
  let roll = rng() * total;
  for (let i = 0; i < ids.length; i++) {
    roll -= w[i];
    if (roll < 0) return ids[i];
  }
  return ids[ids.length - 1];
}

/**
 * The hexes one player is offered: `count` distinct records they do not own, drawn by rarity weight (a rarity with no
 * candidates left is skipped). Fewer than `count` are returned when the pool is exhausted.
 * @param {() => number} rng
 * @param {{ pool: Array<{id: string, rarity: string}>, owned?: Iterable<string>, weights?: Record<string, number>, count?: number }} args
 * @returns {string[]} hex ids, in the order drawn
 */
export function rollOffers(rng, { pool, owned = [], weights = null, count = 3 }) {
  const taken = new Set(owned);
  const out = [];
  for (let n = 0; n < count; n++) {
    const candidates = pool.filter((h) => h && !taken.has(h.id));
    if (!candidates.length) break;
    const available = [...new Set(candidates.map((h) => h.rarity))];
    const rarity = pickRarity(rng, available, weights);
    if (!rarity) break;
    const ofRarity = candidates.filter((h) => h.rarity === rarity);
    const picked = pickOne(rng, ofRarity);
    if (!picked) break;
    taken.add(picked.id);
    out.push(picked.id);
  }
  return out;
}

/**
 * The rarity the enemy side takes this round: one of the rarities the players picked, uniformly at random.
 * @param {() => number} rng
 * @param {Iterable<string>} pickedRarities
 * @returns {string|null}
 */
export function pickEnemyRarity(rng, pickedRarities) {
  const ids = [...new Set([...(pickedRarities || [])])].filter((id) => rarityRank(id) >= 0).sort((a, b) => rarityRank(a) - rarityRank(b));
  return pickOne(rng, ids);
}

/**
 * The enemy hex for one draw: an entry of `rarity` the enemy does not own, else the adjacent rarity, else null.
 * @param {() => number} rng
 * @param {{ pool: Array<{id: string, rarity: string}>, owned?: Iterable<string>, rarity: string }} args
 * @returns {string|null}
 */
export function pickEnemyHex(rng, { pool, owned = [], rarity }) {
  const taken = new Set(owned);
  for (const r of rarityFallbackOrder(rarity)) {
    const candidates = pool.filter((h) => h && h.rarity === r && !taken.has(h.id));
    const picked = pickOne(rng, candidates);
    if (picked) return picked.id;
  }
  return null;
}

/**
 * The **enemy verb** vocabulary (DESIGN §29.10). Until 0.3.0's fourth batch an enemy hex could only carry `mods` — the
 * seven wave-scale numbers — so every enemy card was "a bit more HP / ATK / speed". A verb names a script instead:
 * `server/sim/content/hextech.js install` reads the ids off `flags.enemyHexIds` and wires the matching battle events.
 *
 * Two halves must agree on this list: `tools/build-hextech.mjs` rejects a record whose `verb` is not here (so a typo
 * fails the build instead of silently doing nothing), and the sim looks the id up to install it. Keeping the list pure
 * and Node-free means the browser's own battle sim imports the same one.
 *
 * A verb card may carry `mods` as well (a verb plus a small stat trade-off) and `params` for its own numbers.
 */
export const ENEMY_VERBS = Object.freeze([
  'deathrattle',   // 亡语: on death, arts damage around the corpse
  'armorbreak',    // 破甲弹: hits shred the struck ally's DEF
  'venom',         // 淬毒: attacks carry element (erosion) damage
  'ironwall',      // 铁壁: reflects a share of physical damage back at the attacker
  'corrode',       // 腐蚀领域: periodic ground zones that explode for true damage
  'bloodthirst',   // 嗜血: heals a share of the damage it deals
  'frenzy',        // 狂化: gains attack speed under half HP
  'stealth',       // 隐匿: opens in stealth, re-hides after a block
  'echo',          // 回响: splits into two weaker copies on death
  'banner',        // 军旗: every knock-out empowers the survivors
  // ninth batch (the owner's list of 2026-10-15) — the 14 enemy cards, one verb per card that is not a plain multiplier.
  'hitShield',     // 莱茵护甲: every spawned enemy opens with a 次数盾 (a hit-count shield)
  'blockDemand',   // 势不可挡: enemies demand one more block slot (blockWeight +1)
  'cannibalize',   // 食尸: a knock-out heals the enemies around the corpse
  'silence',       // 静默: every N seconds a random own operator takes a large 凋亡损伤 (necrosis) tick
  'healCut',       // 重伤: an enemy's hit cuts the struck operator's 受治疗量 for a few seconds
  'adaptive',      // 自适应: every hit an enemy takes adds DEF, up to a cap
  'transmute',     // 物转法: physical enemies deal ARTS instead (usually at a lower ATK)
  'brittleArmor',  // 易碎铠甲: opens with more DEF and less speed, and every hit taken shaves DEF back down
  'restless',      // 无头苍蝇: faster, but periodically 恐惧 (bosses and hidden enemies are exempt)
  'drowse',        // zzz: every N seconds a random own operator falls asleep
  'originium',     // 源石附身: enemies carry the 活性原石 effect (ATK/ASPD up, true damage per second)
  // 'mosaic' (情报部抑制) is deliberately NOT implemented as a battle script: the card's whole effect is a CLIENT-side
  // screen filter, so the sim has nothing to do. It is listed here anyway because this is the ONE list the build check
  // and the extractor share — a card whose verb is absent from it fails the build, and a card with no script is simply
  // skipped by installEnemyVerbs (that is what a presentation-only card wants).
  'mosaic',        // 情报部抑制: a full-screen mosaic filter on the client
  // 'records' (记录部抑制) is likewise not a battle script: it acts during the PREP phase of the match
  // (server/match/hextech.js enemyPrepLpCost), so the sim has nothing to install. Same reasoning as 'mosaic'.
  'records',       // 记录部抑制: deploying an operator in prep costs LP every N rounds
]);

/** Whether `id` is a known enemy verb (the build-time check and the sim's own guard). */
export function isEnemyVerb(id) {
  return typeof id === 'string' && ENEMY_VERBS.includes(id);
}

/**
 * Multiply the mods of every enemy hex the enemy side owns into one wave-scale object. Unknown keys are ignored;
 * an empty list gives `{}` (the wave builder then treats it as "no hex").
 * @param {Array<{mods?: Record<string, number>}>} hexes
 * @returns {{ hpMul?: number, atkMul?: number, defMul?: number, resMul?: number, speedMul?: number, supplyHpMul?: number }}
 */
export function sumEnemyMods(hexes) {
  const out = {};
  // countAdd / countSub are BODIES PER GROUP, not multipliers: two 虫群 cards must mean +2, not +1 (1×1).
  // Everything else is a multiplier and stays one. The two are seeded at 0 so the first add is exact; a record that
  // carries neither never grows the key (the loop below only touches keys the record actually has).
  const ADDITIVE = new Set(['countAdd', 'countSub']);
  for (const h of hexes || []) {
    const mods = h && h.mods;
    if (!mods || typeof mods !== 'object') continue;
    for (const [k, v] of Object.entries(mods)) {
      if (!Number.isFinite(v)) continue;
      out[k] = ADDITIVE.has(k) ? (out[k] ?? 0) + v : (out[k] ?? 1) * v;
    }
  }
  return out;
}

// ---- 盟约裂变 (DESIGN §29 third batch) -----------------------------------------------------------------------------
//
// The two readers of this rule must agree exactly: the prep side (server/match/bondsMeta.js computeBonds suppresses
// every bond but the kept ones) and the battle side (server/sim/content/hextech.js multiplies the kept bonds' layer
// gains). They used to hold a copy each — one sorting `Object.entries(ps.bonds)`, the other re-deriving the order from
// `gameData().bonds` — which agreed only because both happened to iterate the data order. One implementation here, with
// the order passed in explicitly, so a tie can never resolve differently on the two sides.

/** The `bondFission.cap` a spec carries, 0 when it names none (or a nonsense one). */
export function fissionCap(spec) {
  const cap = spec && Number(spec.cap);
  return Number.isFinite(cap) && cap > 0 ? Math.trunc(cap) : 0;
}

/** The `bondFission.mul` a spec carries, 1 when it names none (or one that is not a gain). */
export function fissionMul(spec) {
  const mul = spec && Number(spec.mul);
  return Number.isFinite(mul) && mul > 1 ? Math.trunc(mul) : 1;
}

/**
 * The bond ids 盟约裂变 keeps active: the `cap` bonds with the most layers, ties broken by `order` — the data order,
 * which both callers must pass so a tie resolves identically (`bonds` object key order is NOT reliable input: it is
 * whatever order the writer inserted).
 * @param {Record<string, { active?: boolean, layers?: number }>} bonds
 * @param {number} cap
 * @param {Iterable<string>} [order] bond ids in data order (ties outside it sort last, in input order)
 * @returns {Set<string>}
 */
export function fissionBondIds(bonds, cap, order = null) {
  const rank = new Map();
  let i = 0;
  for (const id of order || []) rank.set(id, i++);
  const last = Number.MAX_SAFE_INTEGER;
  return new Set(Object.entries(bonds && typeof bonds === 'object' ? bonds : {})
    .filter(([, b]) => b && b.active)
    .sort((a, b) => {
      const byLayers = (Number(b[1].layers) || 0) - (Number(a[1].layers) || 0);
      if (byLayers) return byLayers;
      return (rank.get(a[0]) ?? last) - (rank.get(b[0]) ?? last);
    })
    .slice(0, Math.max(0, Math.trunc(cap)))
    .map(([id]) => id));
}
