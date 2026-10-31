// test/helpers/attackTurn.js — helpers for the "an attack-class skill takes a normal attack's turn" tests (upstream 0.3.2
// §37.19 / §37.29; the mechanism is content/enemies.js attackSlotSkill / attackTurnSkill / castNow, the per-kit flag comes
// from archetypes.js skill({ atk, clip, own })).
//
//   const a = abilityOf(e, 'Cannon');          // the ability whose skill slot is the prefabKey
//   officialClip(KEY, 'Cannon')                // the official clip length in s (fx/index.json → data/assets.json), or 0
//   stepToCast(h, e, a, 60)                    // step 1 tick at a time until the first cast ⇒ { t, attacksBefore, attacks,
//                                              //   atkCd, left, interval } | null

import fs from 'node:fs';
import assert from 'node:assert/strict';

const FX = JSON.parse(fs.readFileSync(new URL('../../public/assets/local/fx/index.json', import.meta.url), 'utf8'));
const ASSETS = JSON.parse(fs.readFileSync(new URL('../../data/assets.json', import.meta.url), 'utf8'));
const ENEMIES = JSON.parse(fs.readFileSync(new URL('../../data/enemies.json', import.meta.url), 'utf8'));

/** The ability of enemy `e` whose skill slot is `prefabKey` (Cannon, C4 …): `e.mem.ab.sk` maps the prefabKey to the slot. */
export function abilityOf(e, prefabKey) {
  const ab = e.mem.ab;
  if (!ab) throw new Error('no ability list');
  const slot = ab.sk ? ab.sk[prefabKey] : null;
  // a kit that builds the ability by hand (节日爵士乐手's 狂欢式演奏) carries no slot: it is the one fire-capable ability without one
  const a = slot ? ab.list.find((x) => x && x.sk === slot) : null;
  const hit = a ?? ab.list.find((x) => x && x.fire && !x.sk);
  if (!hit) throw new Error(`no ability for ${prefabKey}`);
  return hit;
}

/**
 * The official ability behind `prefabKey` of `key`: its client class (fx/index.json units.<key>.skills.<prefabKey>.abilities[].class)
 * and the length in s of the clip it plays (each ability's animKey → data/assets.json enemies.<key>.spine.animations; the
 * longest of a group, 0 when the ability names no clip).
 */
export function officialAbility(key, prefabKey) {
  const skills = FX.units?.[key]?.skills ?? {};
  const name = Object.keys(skills).find((x) => x.toLowerCase() === String(prefabKey).toLowerCase());
  const rec = name ? skills[name] : null;
  const abilities = rec?.abilities ?? [];
  const anims = ASSETS.enemies?.[key]?.spine?.animations ?? {};
  const durations = abilities.map((x) => (x.animKey && typeof anims[x.animKey] === 'number' ? anims[x.animKey] : 0));
  return {
    classes: abilities.map((x) => x.class ?? null),
    animKeys: abilities.map((x) => x.animKey || null),
    clip: durations.sort((a, b) => b - a)[0] ?? 0,
  };
}

/** `{ skill data }` of the enemy's record for `prefabKey`. */
export function skillDataOf(key, prefabKey) {
  const s = (ENEMIES[key]?.skills ?? []).find((x) => x.prefabKey === prefabKey);
  if (!s) throw new Error(`no skill ${prefabKey} on ${key}`);
  return s;
}

/**
 * The whole "it took the turn" assertion of a `stepToCast` result: the cast happened, that swing did not land as a normal
 * attack, the next swing waits `max(interval, clip)` and the skill's cooldown restarted from its clip's end.
 */
export function assertTookTheTurn(cast, a) {
  assert.ok(cast, 'it is cast');
  assert.equal(cast.attacks, cast.attacksBefore, 'that swing did not land as a normal attack: the skill took the turn');
  assert.equal(a.casts, 1, 'one cast');
  const wait = Math.max(cast.interval, a.clip);
  assert.ok(Math.abs(cast.atkCd - wait) <= 0.05 * Math.max(1, wait), `the next swing waits max(interval, clip) = ${wait} (got ${cast.atkCd})`);
  assert.ok(cast.left > a.cd - 0.1, 'its cooldown restarted (one tick already spent)');
  assert.ok(cast.left <= a.cd + a.clip + 1e-9, 'counted from the clip end');
}

/**
 * Step one tick at a time until `a` is cast for the first time (or `maxSeconds`). Returns the state of the cast tick:
 * `attacksBefore` / `attacks` = the enemy's normal-attack count either side of it (equal ⇒ the skill took the turn), plus
 * `atkCd` (the wait it installed for the next swing), `left` (its own cooldown right after the cast) and `interval`.
 */
export function stepToCast(h, e, a, maxSeconds = 60) {
  const t0 = h.b.time;
  const before = a.casts ?? 0;
  let prevAttacks = e.stats.attacks;
  while (h.b.time - t0 <= maxSeconds && !h.b.finished) {
    h.step(1);
    const casts = a.casts ?? 0;
    const attacks = e.stats.attacks;
    if (casts > before) return { t: h.b.time, attacksBefore: prevAttacks, attacks, atkCd: e.atkCd, left: a.left, interval: e.s.interval };
    prevAttacks = attacks;
  }
  return null;
}
