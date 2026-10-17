#!/usr/bin/env node
// tools/build-hextech.mjs — writes data/hextech.json from tools/hextech/roster.mjs (DESIGN §29).
//
// The 海克斯 feature's content is hand-authored, so unlike data/choices.json it is not derived from the official
// tables — and it does not need them: this tool runs offline, in the source tree and in a release bundle alike.
// data/*.json is generated, never hand-edited (CONTRIBUTING §3), so the roster lives in tools/hextech/roster.mjs and
// this file is the only writer of data/hextech.json.
//
// Usage:
//   node tools/build-hextech.mjs                 write data/hextech.json
//   node tools/build-hextech.mjs --check         fail (exit 1) when the file is stale — used by tests and CI
//   node tools/build-hextech.mjs --out <file>    write somewhere else (tests)
//   node tools/build-hextech.mjs --quiet
//
// The output shape (read by server/data.js `getHex`/`hextech` and public/js/data.js):
//   { version, generator, format, rarities: [{id,name,weight,tier}],
//     playerHexes: { <id>: { id, name, desc, rarity, effect } },
//     enemyHexes:  { <id>: { id, name, desc, rarity, mods } } }
//
// `rarities[].tier` drives the draft card's face: the client loads `hextech/tier/<tier>.png` from data/local-assets.json
// (tools/hextech-tier-import.mjs). Without that local art the card draws its own frame and the name's first character —
// the third-party mod's rune / frame fallback was removed on 2026-10-12 (roster.mjs header explains why).

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { RARITIES, FORMAT, PLAYER_HEXES, ENEMY_HEXES } from './hextech/roster.mjs';
import { ENEMY_VERBS } from '../shared/hextech.js';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const OUT_FILE = path.join(ROOT, 'data', 'hextech.json');
export const HEXTECH_VERSION = 1;

/** Build the data/hextech.json body from hand-authored input (pure; tests compare it to the file on disk). */
export function buildHextech({ rarities = RARITIES, format = FORMAT, player = PLAYER_HEXES, enemy = ENEMY_HEXES } = {}) {
  const byId = (list, extra) => Object.fromEntries(list.map((h) => [h.id, { ...h, ...extra(h) }]));
  return {
    version: HEXTECH_VERSION,
    generator: 'tools/build-hextech.mjs',
    format: { ...format },
    rarities: rarities.map((r) => ({ ...r })),
    playerHexes: byId(player, () => ({})),
    enemyHexes: byId(enemy, () => ({})),
  };
}

/** The exact bytes written to disk. */
export function hextechText(body = buildHextech()) {
  return JSON.stringify(body) + '\n';
}

/** Problems that make the roster unusable (empty array = fine). */
export function validateHextech(body) {
  const problems = [];
  const rarityIds = new Set(body.rarities.map((r) => r.id));
  const ids = new Set();
  for (const [kind, list] of [['playerHexes', Object.values(body.playerHexes)], ['enemyHexes', Object.values(body.enemyHexes)]]) {
    for (const h of list) {
      if (!/^[a-z][a-z0-9_]*$/.test(h.id || '')) problems.push(`${kind}: bad id ${JSON.stringify(h.id)}`);
      if (ids.has(h.id)) problems.push(`${kind}: duplicate id ${h.id}`);
      ids.add(h.id);
      if (!rarityIds.has(h.rarity)) problems.push(`${kind}: ${h.id} has unknown rarity ${JSON.stringify(h.rarity)}`);
      if (!h.name || !h.desc) problems.push(`${kind}: ${h.id} needs a name and a desc`);
      // no `icon` requirement: the roster names no art since the third-party rune icons were removed (2026-10-12)
      if (kind === 'playerHexes' && (!h.effect || typeof h.effect !== 'object')) problems.push(`${kind}: ${h.id} needs an effect`);
      // a chess grant names a tier number or the token 'level' (the current 调度中心 level) — anything else silently
      // falls back to tier 1 at runtime, so catch the typo here
      for (const spec of [h.effect && h.effect.onPick, h.effect && h.effect.onRoundStart]) {
        const tier = spec && spec.chess ? spec.chess.tier : null;
        if (tier != null && tier !== 'level' && !(Number.isInteger(tier) && tier >= 1 && tier <= 6)) {
          problems.push(`${kind}: ${h.id} chess.tier ${JSON.stringify(tier)} is not a tier 1-6 or 'level'`);
        }
        // an item grant is an explicit id, a numeric tier or a choices.json equip pool. The pool form is how 军械库 asks
        // for "不高于调度中心等级" (pool_equip_normal's own maxTier: 'shopLevel'); the numeric form's `maxTier` is ignored
        // by rollItemId (it branches on `Number.isInteger(tier)`), so a `'level'` token does NOT work there. The id form
        // (§29.24, 幽魂) names one record outright — that the id exists in data/items.json is checked by
        // test/content/hextech.test.js, because this tool never reads the generated data.
        const item = spec && spec.item ? spec.item : null;
        if (item) {
          // 武器大师 (the owner's list of 2026-10-15): `ids` grants one of EACH named record (a card that hands out two
          // DIFFERENT pieces). Every entry is checked like the single `id` form, and the two forms are mutually
          // exclusive — carrying both would leave which one wins to the reader.
          if (item.ids != null) {
            if (!Array.isArray(item.ids) || !item.ids.length) {
              problems.push(`${kind}: ${h.id} item.ids must be a non-empty array`);
            } else {
              for (const want of item.ids) {
                if (typeof want !== 'string' || !/^[a-z][a-z0-9_]*$/.test(want)) {
                  problems.push(`${kind}: ${h.id} item.ids entry ${JSON.stringify(want)} is not an item id`);
                }
              }
            }
            if (item.id != null || item.pool != null || item.tier != null) {
              problems.push(`${kind}: ${h.id} item.ids cannot be combined with item.id / item.pool / item.tier`);
            }
          }
          if (item.id != null && (typeof item.id !== 'string' || !/^[a-z][a-z0-9_]*$/.test(item.id))) {
            problems.push(`${kind}: ${h.id} item.id ${JSON.stringify(item.id)} is not an item id`);
          }
          if (item.pool != null && typeof item.pool !== 'string') {
            problems.push(`${kind}: ${h.id} item.pool ${JSON.stringify(item.pool)} is not a pool id`);
          }
          if (item.id == null && item.pool == null && item.tier != null && !(Number.isInteger(item.tier) && item.tier >= 1 && item.tier <= 6)) {
            problems.push(`${kind}: ${h.id} item.tier ${JSON.stringify(item.tier)} is not a tier 1-6 (use item.pool for "≤ shop level")`);
          }
        }
        // a GOLDEN item grant (后勤整备's 进阶装备): a numeric tier 1-6 or the token 'next' = one tier above the last
        // one granted. Anything else silently falls back to tier 1 at runtime (hextech.js applySpec), so catch it here.
        const golden = spec && spec.goldenItem ? spec.goldenItem : null;
        if (golden) {
          if (golden.tier !== 'next' && !(Number.isInteger(golden.tier) && golden.tier >= 1 && golden.tier <= 6)) {
            problems.push(`${kind}: ${h.id} goldenItem.tier ${JSON.stringify(golden.tier)} is not a tier 1-6 or 'next'`);
          }
          if (!(Number.isInteger(golden.count) && golden.count >= 1)) {
            problems.push(`${kind}: ${h.id} goldenItem.count ${JSON.stringify(golden.count)} is not a positive integer`);
          }
        }
      }
      if (kind === 'enemyHexes') {
        // An enemy hex is EITHER a wave-scale card (`mods`: the numeric vocabulary below) OR a **verb** card (`verb`: the
        // id of a script `server/sim/content/hextech.js install` runs in the battle). 0.3.0 shipped only the first shape,
        // so every enemy card was a stat multiplier; the second is what supplies reach a battle through
        // `flags.enemyHexIds` (server/match/match/combat.js) — see docs/history/0.3.0.md §29.10.
        const keys = Object.keys(h.mods || {});
        const verb = typeof h.verb === 'string' ? h.verb.trim() : '';
        if (!keys.length && !verb) problems.push(`${kind}: ${h.id} needs mods or a verb`);
        if (verb && !VERB_IDS.has(verb)) problems.push(`${kind}: ${h.id} unknown verb ${JSON.stringify(h.verb)}`);
        if (verb && h.mods != null && typeof h.mods !== 'object') problems.push(`${kind}: ${h.id} mods must be an object`);
        for (const k of keys) {
          if (!MOD_KEYS.has(k)) { problems.push(`${kind}: ${h.id} unknown mod ${k}`); continue; }
          const v = h.mods[k];
          // countAdd / countSub are absolute bodies (1..3); the multipliers are trade-offs now, so a < 1 value is allowed
          if (k === 'countAdd' || k === 'countSub') {
            if (!(Number.isInteger(v) && v >= 1 && v <= 3)) problems.push(`${kind}: ${h.id} ${k} ${v} is not 1..3`);
          } else if (k === 'speedMul') {
            // MOVE SPEED IS ITS OWN AXIS (owner's list of 2026-10-15: 势不可挡 −50 %, 无头苍蝇 +50 %). The ±1.35 bound
            // below exists to stop STAT multipliers stacking into a wall (BALANCE.md §8: the worst three HP draws must
            // stay under 2.05), and speed is not that axis — an enemy that walks at half speed or 1.5× is a distinct
            // reading of the round, and its cap is the engine's own (the sim clamps a unit's moveMul at 0 anyway).
            if (!(v > 0.25 && v <= 2)) problems.push(`${kind}: ${h.id}: ${k} = ${v} (expected 0.25 < v ≤ 2)`);
          } else if (!(v > 0.5 && v <= 1.35)) problems.push(`${kind}: ${h.id}: ${k} = ${v} (expected 0.5 < v ≤ 1.35)`);
        }
        // a verb card carries its tuning as flat params; reject a `mods`-only field the sim would silently ignore
        if (verb && h.params != null && (typeof h.params !== 'object' || Array.isArray(h.params))) {
          problems.push(`${kind}: ${h.id} params must be an object`);
        }
        const pay = h.payout;
        if (pay != null) {
          if (!Number.isInteger(pay.perLeak) || pay.perLeak < 1 || pay.perLeak > 9) problems.push(`${kind}: ${h.id} payout.perLeak ${pay.perLeak} is not 1..9`);
          if (pay.cap != null && (!Number.isInteger(pay.cap) || pay.cap < 1 || pay.cap > 30)) problems.push(`${kind}: ${h.id} payout.cap ${pay.cap} is not 1..30`);
        }
      }
    }
  }
  const weightSum = body.rarities.reduce((s, r) => s + r.weight, 0);
  if (Math.abs(weightSum - 1) > 1e-9) problems.push(`rarity weights sum to ${weightSum}, expected 1`);
  // the card's face is the `tier` 阶位 image (public/assets/local/hextech/tier/<tier>.png, data/local-assets.json
  // `hextech/tier`): the number has to be there, be a distinct 1..6 and match the displayed name, or the draft draws
  // the wrong picture — or no picture at all
  const tiers = new Set();
  for (const r of body.rarities) {
    if (!Number.isInteger(r.tier) || r.tier < 1 || r.tier > 6) { problems.push(`rarity ${r.id} tier ${JSON.stringify(r.tier)} is not an integer 1..6`); continue; }
    if (tiers.has(r.tier)) problems.push(`rarity ${r.id} tier ${r.tier} is not unique`);
    tiers.add(r.tier);
    if (r.name !== `${r.tier}阶`) problems.push(`rarity ${r.id} name ${JSON.stringify(r.name)} should be "${r.tier}阶" (the displayed tier)`);
  }
  if (!body.format.rounds.length) problems.push('format.rounds is empty');
  return problems;
}

/** The wave vocabulary an enemy hex may scale (server/match/waves.js roundMods) + the count wrenches. */
const MOD_KEYS = new Set([
  'hpMul', 'atkMul', 'defMul', 'resMul', 'speedMul', 'supplyHpMul',
  'countAdd', // 虫群: +N bodies per normal spawn group (an absolute add, 1..3)
  // 精英化 (owner's list of 2026-10-15): −N bodies per normal spawn group. Absolute too, for the reason the owner
  // chose it over a percentage — 10 % of a five-enemy group rounds away to nothing. See server/match/hextech.js.
  'countSub',
]);

/** The enemy verb scripts the sim knows (shared/hextech.js — one list, so a typo fails the build). */
const VERB_IDS = new Set(ENEMY_VERBS);

function parseArgs(argv) {
  const opts = { check: false, quiet: false, out: OUT_FILE };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--check') opts.check = true;
    else if (a === '--quiet') opts.quiet = true;
    else if (a === '--out') opts.out = path.resolve(argv[++i] || '');
    else if (a === '--help' || a === '-h') opts.help = true;
    else throw new Error(`unknown option ${a}`);
  }
  return opts;
}

export function main(argv = process.argv.slice(2), log = console) {
  const opts = parseArgs(argv);
  if (opts.help) {
    log.log('usage: node tools/build-hextech.mjs [--check] [--out <file>] [--quiet]');
    return 0;
  }
  const body = buildHextech();
  const problems = validateHextech(body);
  if (problems.length) {
    for (const p of problems) log.error(`[hextech] ${p}`);
    return 1;
  }
  const text = hextechText(body);
  const current = fs.existsSync(opts.out) ? fs.readFileSync(opts.out, 'utf8') : null;
  if (opts.check) {
    if (current === text) {
      if (!opts.quiet) log.log(`[hextech] ${path.relative(ROOT, opts.out)} is up to date (${Object.keys(body.playerHexes).length} player + ${Object.keys(body.enemyHexes).length} enemy)`);
      return 0;
    }
    log.error(`[hextech] ${path.relative(ROOT, opts.out)} is stale — run: node tools/build-hextech.mjs`);
    return 1;
  }
  fs.mkdirSync(path.dirname(opts.out), { recursive: true });
  fs.writeFileSync(opts.out, text);
  if (!opts.quiet) {
    log.log(`[hextech] ${path.relative(ROOT, opts.out)}: ${Object.keys(body.playerHexes).length} player + ${Object.keys(body.enemyHexes).length} enemy hexes, ${body.format.rounds.length} draws`);
  }
  return 0;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = main();
}
