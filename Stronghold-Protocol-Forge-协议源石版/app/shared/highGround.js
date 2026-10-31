// shared/highGround.js — which MELEE chess may stand on a 高台 (a ranged deploy tile).
//
// The owner's decision of 2026-10-05, reversing the one of 2026-10-04 (elite 歌蕾蒂娅 with HOK-Y only): follow PRTS. A
// MELEE chess whose trait reads 「可以放置于远程位」 may stand on a 高台 as well as on the ground. The line is the 钩索师 /
// 推击手 branch trait (PRTS 歌蕾蒂娅 · 特性, raised with the PRTS source in PR #69 by @sunstricken; PRTS 新人入门: both
// branches "可部署在高台和地面"): 歌蕾蒂娅, 崖心 and 见行者, normal and elite. It is the branch's own text, not a module
// effect — every module of the three keeps it — so the loadout does not matter: any module, or none. The text read is
// the record's trait without a module (`traitBase`, which an elite with modules carries; else `trait`). A module talent
// such as the 教官's Y module ("可以额外部署在远程位") is a 部署效果, which 卫戍协议 switches off (PRTS 卫戍协议/帮助
// §战斗部署), and is not read. The battle keeps position MELEE: on a 高台 the unit attacks and blocks nothing.
//
// The line is Simplified Chinese, and the client judges the record it *shows* — the one the game-text overlay has already
// translated (public/js/data.js setLocale). Upstream GitHub #676: in en / ja / ko / zh-TW (which writes 於) the three
// could not take a 高台 while the server, which reads the Chinese data, accepted the tile. So the reading is also stored
// as the boolean `placeOnRanged`: derived from the Chinese record and cached on the localized one when the data is
// loaded (`withPlaceOnRanged`, called by public/js/data.js — the data/*.json files themselves keep no such field, DATA.md
// §2). `meleeOnHighGround` takes the boolean first and the text as the fallback, which is the Chinese data and a
// record a plugin built. The same field name is the one upstream stores in its data, so adopting that later changes
// nothing here.

/** The trait line that lets a MELEE chess stand on a ranged (高台) tile. */
export const PLACE_ON_RANGED = '可以放置于远程位'; // i18n-ignore: matched against the data's trait text

/**
 * The record's trait text without a module ('' when it has none).
 * @param {object|null} rec a chess record
 * @returns {string}
 */
export function baseTraitText(rec) {
  const t = rec ? rec.traitBase || rec.trait : null;
  return t && typeof t.desc === 'string' ? t.desc : '';
}

/**
 * Whether a record's trait without a module reads 「可以放置于远程位」 — the Chinese reading `placeOnRanged` caches.
 * @param {object|null} rec a chess record (normal or golden), its texts in Chinese
 * @param {string} [position] the position, when the record carries none (a 补位 form: its unit does)
 * @returns {boolean}
 */
export function placeOnRangedOf(rec, position = rec ? rec.position : null) {
  return position === 'MELEE' && baseTraitText(rec).includes(PLACE_ON_RANGED);
}

/**
 * `rec` — a localized copy of the record `zh` — with that reading cached on it as `placeOnRanged` (GitHub #676): what
 * public/js/data.js puts on the chess table it hands the interface, because the overlay has replaced the trait text by
 * then. A record whose Chinese trait does not read the line, and a record already carrying the boolean, is returned as it
 * is (no copy). `zh` is the record before localization (`data.getRaw('chess')`), the same entry by id.
 * [ASSUMED] Nothing derives the boolean for a record that has no Chinese twin (a plugin's own chess): it keeps the text.
 * @param {object|null} rec the localized record
 * @param {object|null} zh its Chinese original
 * @param {string} [position] for a record that carries no position of its own (a 补位 form of data/backups.json)
 * @returns {object|null}
 */
export function withPlaceOnRanged(rec, zh, position) {
  if (!rec || typeof rec !== 'object' || rec.placeOnRanged === true) return rec;
  return placeOnRangedOf(zh, position ?? rec.position) ? { ...rec, placeOnRanged: true } : rec;
}

/**
 * Whether a MELEE chess record may also stand on a 高台: its trait reads 「可以放置于远程位」. Normal or elite, any module.
 * The boolean `placeOnRanged` — the Chinese reading, cached at load — comes first: it is what a localized record still
 * has after the overlay replaced the trait text. Without it the Simplified line is matched, which is the Chinese data and
 * a plugin's record. [ASSUMED] A plugin may set `placeOnRanged: true` without that line; anything but `true` is not a
 * reading, so it falls through to the text.
 * @param {object|null} rec a chess record (normal or golden)
 * @returns {boolean}
 */
export function meleeOnHighGround(rec) {
  if (!rec || rec.position !== 'MELEE') return false;
  if (rec.placeOnRanged === true) return true;
  return baseTraitText(rec).includes(PLACE_ON_RANGED);
}
