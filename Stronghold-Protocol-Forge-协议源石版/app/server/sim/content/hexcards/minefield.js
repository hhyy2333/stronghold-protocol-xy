// server/sim/content/hexcards/minefield.js — 雷区 (hex_minefield) battle script.
//
// CARD (owner's list, 2026-10-11, copied verbatim): 「战斗开始时，在6个随机可部署地块，放置多萝西的2技能的召唤物地雷。」
//
// WHAT IS PLACED: 多萝西's S2 summon — the 共振装置 (`token_10025_doroth_recttp`, the only summon she has; her S2 is the
// mine's trigger mode "高速共振排障" in this remake's kit, kits/ops/op-doroth.js). The token def is resolved exactly the
// way her kit resolves it: the record's owner variant with `bySkill[1]` (skill index 1 = her S2) merged over it, so the
// mine carries the official S2 skill and its blackboard — `atk_scale` 2.6, `cnt_2` 1, `duration` 2.5, `duration_2` 5 at
// the maxed variant (data/backups.json). NOTHING about the mine is invented; its radius 1.2 is PRTS's S2 备注
// ("陷阱爆炸范围为1.2半径的圆"), the same constant op-doroth.js fires with.
//
// THE OWNER'S NUMBERS (2026-10-12, §29.22): the card's own `minefield` spec carries the mine's attack power and its 束缚
// seconds — `atk: 1000` (the official token record's `stats.atk` is 100, so `spawnToken` is handed the same variant with
// `stats.atk` replaced rather than the record being edited), `bind: 5` and `bindSingle: 10` (the official S2 bb says
// 2.5 / 5). Damage stays `attack power × atk_scale` = 1000 × 2.6 = 2600 physical per victim, so only the CARD's numbers
// moved; the S2 branch, the radius and the "exactly one victim" condition are still her kit's.
//
// WHY THE TRIGGER IS RE-IMPLEMENTED HERE (op-doroth.js `fire` + `trapKit`): her kit's trigger closes over 多萝西 herself
// (`unit.s.atk`, her 梦想家 stacks, her TRP-Y double-trap roll). 雷区 puts mines on the field with no 多萝西 in play, so
// there is no owner to borrow from and her kit cannot run. This module therefore copies the S2 branch of her trigger
// verbatim — first selectable ground enemy standing on the tile goes in, damage every selectable ground enemy within
// 1.2, 束缚 (bind) for `duration_2` when the victim count equals `cnt_2` else `duration`, then the mine is consumed —
// and only that branch. [ASSUMED: the damage base is the MINE's own ATK, which this card sets to 1000 (`t.s.atk`, the
// def the card hands `spawnToken`), not 多萝西's — official 共振装置 damage "技能伤害始终借用持有者的攻击力计算" and 雷区
// places them with no holder.]
//
// WHERE: 「可部署地块」 = a melee-deployable tile by the engine's own rule (`grid.canStand`, the placement predicate every
// 自动落点 uses: inside the stage rect, buildable, not hard-blocked) that is also a free summon tile
// (`summonTileFree`: nobody standing there, no knocked-out operator or undeployed board unit reserving it) and has no
// ground enemy on it (as her own `summonTiles` skips). The tiles are shuffled with `battle.rng` — never Math.random, so
// the server and a browser re-simulation agree — and the first `count` are used. Fewer candidates ⇒ fewer mines.
//
// CONTRACT: export function installMinefield(hooks) — hooks is the shared `hexHooks(battle)` bundle (see hooks.js).
// Returns 0 (the placement happens at battle start, and its count is reported by the field itself).

import { summonTileFree } from '../kits/shared/tier1.js';
import { RESONATOR } from '../kits/ops/op-doroth.js';
import { canTargetEnemy } from '../../targeting.js';
import { bodyOnTile } from '../../body.js';

/** PRTS S2 备注: "陷阱爆炸范围为1.2半径的圆" (op-doroth.js S2_RADIUS — the same number, not a new one). */
const S2_RADIUS = 1.2;
/** The S2 branch's own selection rule (op-doroth.js `GROUND`): ground enemies only. */
const GROUND = Object.freeze({ canHitFly: false, groundOnly: true });
/** Fallbacks for the S2 blackboard, used only when the token record does not reach this battle at all. */
const S2_FALLBACK = Object.freeze({ atkScale: 2.6, cnt2: 1, duration: 2.5, duration2: 5 });
/** The card's own numbers, used when its spec omits them (the owner's list of 2026-10-12, §29.22). */
const MINE_DEFAULT = Object.freeze({ atk: 1000, bind: 5, bindSingle: 10 });

const num = (v, d) => (typeof v === 'number' && Number.isFinite(v) ? v : d);

/**
 * The S2 共振装置 def: the MOST INVESTED owner variant (the highest `phase/level/skillLevel` of the variant key) with
 * `bySkill[1]` (skill index 1 = 多萝西's S2) merged over it — the shape `_tokenDef` produces for an owner whose loadout
 * has S2 selected. 雷区 has no 多萝西 to take a练度 from, so the maxed S2 is placed [ASSUMED: the alternative, the
 * least-invested variant, would hand out a strictly weaker mine; the card names her S2, not a level]. Null when the
 * battle's data carries no such record (then spawnToken falls back to its own default variant).
 */
function s2Def(battle) {
  const raw = battle.data && typeof battle.data.rawToken === 'function' ? battle.data.rawToken(RESONATOR) : null;
  const entries = raw && raw.variants ? Object.entries(raw.variants) : null;
  if (!entries || !entries.length) return null;
  /** The variant key's phase / level / skillLevel (data key `owner@phase/level/skillLevel/module`). */
  const rank = (k) => {
    const m = /@(\d+)\/(\d+)\/(\d+)/.exec(k);
    return m ? +m[1] * 1e6 + +m[2] * 1e3 + +m[3] : 0;
  };
  const [baseKey, base] = entries.slice().sort((a, b) => rank(a[0]) - rank(b[0])).pop();
  void baseKey;
  const by = base.bySkill ? base.bySkill[1] || base.bySkill['1'] : null;
  const def = { ...base, ...(by || {}) };
  delete def.bySkill;
  delete def.byModule;
  return def;
}

/** The mine's kit (skill null + 近战 no-attack trait + the S2 trigger, op-doroth.js's S2 branch). */
function mineKit(tuning) {
  return {
    skill: null,
    trait: { noAttack: true },
    install(battle, t) {
      /** The first selectable ground enemy standing on the mine's tile (her `bodyOnTile` test, earliest spawn first). */
      const steppingOn = () => {
        let hit = null;
        for (const e of battle.enemies) {
          if (!canTargetEnemy(t, e, GROUND)) continue;
          const on = e.hitArea ? bodyOnTile(e, t.tileR, t.tileC) : Math.abs(e.x - t.tileC) <= 0.5 && Math.abs(e.y - t.tileR) <= 0.5;
          if (on && (!hit || e.spawnSeq < hit.spawnSeq)) hit = e;
        }
        return hit;
      };
      /** S2 goes off: 1.2 around the tile, phys damage, 束缚; then the mine is consumed (her `fire`, S2 branch). */
      const fire = () => {
        if (!t.alive || t.mem.mineFired) return;
        t.mem.mineFired = true;
        const atk = t.s && t.s.atk > 0 ? t.s.atk : 0;
        const victims = battle.foesInRadius(t.x, t.y, S2_RADIUS, true).filter((x) => canTargetEnemy(t, x, GROUND));
        const dur = victims.length === Math.max(1, Math.floor(tuning.cnt2)) ? tuning.duration2 : tuning.duration;
        const tags = ['hex', 'minefield', 'summon', 'trap', 'doroth:trap'];
        for (const x of victims) {
          battle.dealDamage(t, x, { amount: atk * tuning.atkScale, type: 'phys', isSkill: true, tags });
          if (x.alive && dur > 0) battle.applyStatus(x, 'bind', { duration: dur, source: t });
        }
        battle.fx('explode', { x: t.x, y: t.y, r: S2_RADIUS, id: t.id, consumed: true, kind: 'doroth:quicksand' });
        battle.retreat(t, { reason: 'expired', permanent: true });
      };
      battle.on('tick', () => { if (t.alive && !t.mem.mineFired && steppingOn()) fire(); }, { owner: t });
    },
  };
}

/** Ground enemy on a tile (her `groundEnemyOn`: a huge one counts by any tile of its body). */
function groundEnemyOn(battle, r, c) {
  for (const e of battle.enemies) {
    if (!e.alive || e.hidden || e.isFlying) continue;
    if (e.hitArea ? bodyOnTile(e, r, c) : Math.abs(e.x - c) <= 0.5 && Math.abs(e.y - r) <= 0.5) return true;
  }
  return false;
}

/**
 * 雷区: at battle start, `count` 共振装置 mines on random deployable tiles.
 *
 * @param {any} hooks the shared `hexHooks(battle)` bundle — `battle` / `ownersOf` / `specOf` / `optNumber` are read.
 * @returns {number} 0 (the count is decided when battleStart runs and reported by the spawned mines themselves).
 */
export function installMinefield(hooks) {
  if (!hooks || typeof hooks !== 'object') return 0;
  const { battle, ownersOf, specOf, optNumber } = hooks;
  if (!battle || typeof battle.on !== 'function') return 0;
  if (typeof ownersOf !== 'function') return 0;

  const owners = ownersOf('hex_minefield');
  if (!owners.length) return 0;

  battle.on('battleStart', () => {
    const raw = battle.data && typeof battle.data.rawToken === 'function' ? battle.data.rawToken(RESONATOR) : null;
    if (!raw) battle.log?.(`${RESONATOR} is not in this battle's data: 雷区 places the default variant`);
    const baseDef = s2Def(battle);
    const R = battle.grid.rect;
    for (const pid of owners) {
      const spec = typeof specOf === 'function' ? specOf(pid, 'hex_minefield', 'minefield') : null;
      /** The spec's number, else `d` (the hook bundle's own reader, so a malformed spec degrades like every other card). */
      const pick = (k, d) => (typeof optNumber === 'function' ? optNumber(spec, k, d) : d);
      const count = Math.max(1, Math.floor(pick('count', 6)));
      const bb = (baseDef && baseDef.skill && baseDef.skill.bb) || {};
      const tuning = {
        atkScale: num(bb.atk_scale, S2_FALLBACK.atkScale),
        cnt2: num(bb.cnt_2, S2_FALLBACK.cnt2),
        duration: pick('bind', num(bb.duration, S2_FALLBACK.duration)),
        duration2: pick('bindSingle', num(bb.duration_2, S2_FALLBACK.duration2)),
      };
      // The mine's own attack power is the CARD's (`atk`), on the official variant: `normalizeToken` builds the unit's
      // base stats from `stats.atk`, so replacing it there is what makes `t.s.atk` — and the blast the kit reads — 1000.
      const mineAtk = pick('atk', MINE_DEFAULT.atk);
      const def = baseDef && mineAtk > 0 ? { ...baseDef, stats: { ...(baseDef.stats || {}), atk: mineAtk } } : baseDef;
      const kit = mineKit(tuning);
      const cands = [];
      for (let r = R.r0; r <= R.r1; r++) {
        for (let c = R.c0; c <= R.c1; c++) {
          if (!battle.grid.canStand(r, c)) continue;
          if (!summonTileFree(battle, r, c)) continue;
          if (groundEnemyOn(battle, r, c)) continue;
          cands.push([r, c]);
        }
      }
      battle.rng.shuffle(cands);
      let placed = 0;
      for (const [r, c] of cands) {
        if (placed >= count) break;
        const t = battle.spawnToken(pid, RESONATOR, r, c, { def: def || undefined, kit });
        if (!t) continue;
        battle.fx('summon', { x: t.x, y: t.y, id: t.id, token: RESONATOR });
        placed++;
      }
    }
  }, { priority: -10 }); // the house slot for battleStart grants (after every bond / garrison passive)

  return 0;
}
