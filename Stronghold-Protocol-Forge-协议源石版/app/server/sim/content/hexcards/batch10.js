// server/sim/content/hexcards/batch10.js — the battle halves of the tenth batch of player hexes
// (the owner's list of 2026-10-15).
//
// One module rather than a file per card: every script below is small (an aura, a ranking, a one-shot), and they
// share the same shape — read the shared `hexHooks(battle)` bundle, decide whether the card is on the field, register
// a handler. The 2026-10-11 batch split one file per card because each carried a long rationale of its own; these do
// not, so they are kept together and each function's comment records its reading.
//
// CONTRACT (identical to the sibling modules): every `installX(hooks)` takes the shared bundle from hooks.js and
// returns a small handle. Nothing here mutates the battle at install time except through the hooks it registers.

import { passiveBuff, bondLayers, isMember } from '../support/index.js';
import { isRetaliation, isHpLoss } from '../../damage.js';
import { areaAlliesInTiles, elem, hurt } from '../enemies/helpers.js';

/**
 * Record a 指令之意 / 指令之意·改 roll so the HUD can show **what got picked**.
 *
 * The two cards are the only ones in this batch whose OUTCOME is a coin flip the player cannot see: 「随机指定一种职业 /
 * 一种伤害类型」 without saying which. Until now the roll was invisible — the buff landed on the operators and the player
 * had to infer the class from who got stronger. This writes the result to `battle.hexDirectives`, which
 * `BattleEvents.snapshot()` copies out as `snap.dirs` and the client renders beside the DP counter.
 *
 * DISPLAY ONLY, and deliberately so: nothing in the sim reads `hexDirectives`, so it cannot affect determinism or a
 * golden result. It is called where the roll is **finalised** (next to `done.add`), never where it is taken — the roll
 * repeats every tick until an operator is on the field, and noting it earlier would make the chip flicker through
 * random values before the first deployment.
 *
 * @param {any} battle the battle (a fresh object per field, so nothing leaks between rounds)
 * @param {string} pid the player whose card rolled
 * @param {string} hexId `hex_directive` | `hex_directive2` — which card, so the client can name it
 * @param {'prof'|'dmg'} kind what the value names: a profession code, or a damage type
 * @param {string} pick the rolled value
 * @param {number} amount the strength (a percent for the profession card, a percent multiplier for the type card)
 */
function noteDirective(battle, pid, hexId, kind, pick, amount) {
  const list = battle.hexDirectives || (battle.hexDirectives = []);
  // ONE ROW PER (player, card), not one per player: a player can own 指令之意 AND 指令之意·改 in the same battle, and a
  // per-player slot would let the second roll overwrite the first. The tuple shape matches the snapshot's other list
  // fields (down, elem, ammo ...).
  const row = [pid, hexId, kind, pick, amount];
  const i = list.findIndex((e) => e[0] === pid && e[1] === hexId);
  if (i >= 0) list[i] = row;
  else list.push(row);
}

/**
 * 挡挡: 不屈 operators gain block slots from the bond's own LAYER count — +1 once it passes `base`, and another +1
 * for every `step` layers beyond that.
 *
 * 「不屈超过 100 层后不屈干员阻挡数 +1，多余的层数每 150 层阻挡数再 +1」. Read LIVE on every tick because layers move
 * during a battle (机变, 盟约回响, a teammate's 层数转移), and a block count frozen at install would disagree with the
 * panel the player is watching. `passiveBuff` with `refresh: 'replace'` is the engine's own re-apply, so the buff
 * never stacks with itself; a drop back to 0 removes it outright.
 * @param {any} hooks the shared bundle
 */
export function installBlockwall(hooks) {
  const { battle, ownersOf, opsOf, specOf, optNumber, onField } = hooks;
  const owners = ownersOf('hex_blockwall');
  if (!owners.length) return 0;
  let applied = 0;
  battle.on('tick', () => {
    for (const pid of owners) {
      const spec = specOf(pid, 'hex_blockwall', 'blockwall');
      const base = optNumber(spec, 'base', 100);
      const step = optNumber(spec, 'step', 150);
      const n = bondLayers(battle, pid, 'indomShip');
      const extra = n > base ? 1 + Math.floor((n - base) / step) : 0;
      for (const u of opsOf(pid)) {
        if (!onField(u)) continue;
        if (!isMember(battle, u, 'indomShip')) continue;
        if (extra > 0) { passiveBuff(battle, u, 'hex:blockwall', { blockCnt: extra }); applied++; }
        else battle.removeBuff(u, 'hex:blockwall');
      }
    }
  });
  return { get applied() { return applied; } };
}

/**
 * 不区区！: 不屈 operators SOAK a share of the damage their allies take.
 *
 * 「不区干员会为其他干员分担 50% 伤害」. When any OWN operator takes damage and a 不屈 carrier of the same player is on
 * the field, `pct` of that instance is moved to the carrier.
 *
 * WHY IT IS DONE ON `damaged` (the POST-mitigation hook) rather than on `hit`. The `hit` hook runs before mitigation,
 * so at that point the final number is not known — and a share computed from a pre-mitigation amount would move more
 * than the ally actually lost. `damaged` carries `amount` = what really landed, which is exactly the base the card's
 * 「伤害」 means.
 *
 * WHY A RESTORE-PLUS-LOSS AND NOT A REDIRECT. The invariant the card must keep is that the TEAM's total loss does not
 * change: the ally gives back what the carrier takes. Restoring `moved` HP to the ally and removing it from the carrier
 * satisfies that exactly, and it is robust to the mitigation chain (which has already run and cannot be re-run).
 *
 * The carrier is never killed by a share: `moved` is clamped so it keeps at least 1 HP (the never-lethal rule 远见透支
 * and 记录部抑制 follow — a support card must not execute its own carrier). The transfer is tagged so it can never
 * recurse into this handler.
 * @param {any} hooks the shared bundle
 */
export function installSharePain(hooks) {
  const { battle, ownersOf, opsOf, specOf, optNumber, onField } = hooks;
  const owners = ownersOf('hex_sharepain');
  if (!owners.length) return 0;
  let shared = 0;
  battle.on('damaged', (c) => {
    if (!c || !c.dmg) return;
    const dmg = c.dmg;
    const tgt = c.target;
    if (!tgt || tgt.kind !== 'op' || tgt.side !== 'ally') return;
    if (dmg.hexShared) return;                       // our own transfer, never re-shared
    if (Array.isArray(dmg.tags) && dmg.tags.includes('hex:sharepain')) return;
    if (isRetaliation(dmg) || isHpLoss(dmg)) return;
    if (dmg.type === 'element') return;
    if (!(c.amount > 0)) return;
    for (const pid of owners) {
      const spec = specOf(pid, 'hex_sharepain', 'sharePain');
      const pct = Math.max(0, Math.min(90, optNumber(spec, 'pct', 50))) / 100;
      if (!(pct > 0)) continue;
      // the carrier must be a 不屈 operator of that owner, on the field, and NOT the one being hit
      const carrier = opsOf(pid).find((u) => u !== tgt && onField(u) && isMember(battle, u, 'indomShip'));
      if (!carrier) continue;
      // never lethal: the carrier keeps at least 1 HP from a share
      const room = Math.max(0, carrier.hp - 1);
      const moved = Math.min(c.amount * pct, room);
      if (!(moved > 0)) continue;
      shared++;
      battle.loseHp(carrier, moved, { source: null, tags: ['hex:sharepain'] });
      // give the ally back exactly what the carrier took (the team's total loss is unchanged)
      if (tgt.alive) { tgt.hp = Math.min(tgt.s.maxHp, tgt.hp + moved); tgt.markDirty(); }
      break;
    }
  });
  return { get shared() { return shared; } };
}

/**
 * 泰拉在上: an own operator's death blasts the 8 tiles around the corpse for 200 % of ITS attack, as arts, plus a
 * 灼燃 (burn) element tick.
 *
 * 「干员阵亡后对周围 9 格造成伤害攻击力 200％的法术伤害和灼燃损伤」. Two readings worth naming:
 *   * 「周围 9 格」 = the 8 neighbours PLUS the tile it fell on (`box` shape, radius 1 — the engine's own `box` is
 *     Chebyshev distance, which is exactly a 3×3 block). The 器物 / enemy-only gates of the enemy-side 亡语 do not
 *     apply here: this card is the ALLY side's version, so it hits ENEMIES.
 *   * 「阵亡」 = a KNOCK-OUT, not a retreat or a redeploy (`reason === 'killed'`, the gate every death kit uses). A
 *     player who withdraws an operator to reposition it must not detonate it.
 * @param {any} hooks the shared bundle
 */
export function installTerraMourn(hooks) {
  const { battle, ownersOf, specOf, optNumber } = hooks;
  const owners = ownersOf('hex_terramourn');
  if (!owners.length) return 0;
  let blasts = 0;
  battle.on('death', ({ unit, reason }) => {
    if (reason !== 'killed') return;
    if (!unit || unit.kind !== 'op' || unit.side !== 'ally') return;
    if (!owners.includes(unit.ownerId)) return;
    const spec = specOf(unit.ownerId, 'hex_terramourn', 'deathBlast');
    const ratio = optNumber(spec, 'atkPct', 200) / 100;
    const radius = optNumber(spec, 'radius', 1);
    const amount = unit.s.atk * ratio;
    if (!(amount > 0)) return;
    const r = Math.round(unit.y);
    const c = Math.round(unit.x);
    const hit = [];
    for (const e of battle.enemies) {
      if (!e || !e.alive) continue;
      const dr = Math.abs(Math.round(e.y) - r);
      const dc = Math.abs(Math.round(e.x) - c);
      if (Math.max(dr, dc) <= radius) hit.push(e);
    }
    if (!hit.length) return;
    blasts++;
    for (const e of hit) {
      hurt(battle, unit, e, amount, 'arts', { tags: ['hexVerb'] });
      elem(battle, unit, e, 'burn', amount * 0.2, { tags: ['hexVerb'] });
    }
  });
  return { get blasts() { return blasts; } };
}

/**
 * 指令之意: at battle start ONE of the three named professions is chosen at random, and every own operator of it gains
 * +`atkPct`.
 *
 * 「每回合随机指定一种职业，攻击力+50」. 业主 2026-10-21: 「改成在狙击近卫术师三个职业里随机」 — the roll is among
 * SNIPER / WARRIOR (近卫) / CASTER, NOT among the professions actually fielded: the card may roll a profession the player
 * has nobody of, and then it grants nothing (the roll is still published so the HUD can say what it rolled).
 *
 * The roll happens ONCE per battle (not per tick): the card says 「每回合」, and a battle IS the round, so re-rolling
 * mid-fight would make the buff flicker between professions. `battle.rng` is the deterministic stream every other
 * random pick in the sim uses, so a replay of the same seed chooses the same profession — which is what keeps a
 * client-side battle and the server's re-computation in agreement.
 * @param {any} hooks the shared bundle
 */
export function installDirectiveAtk(hooks) {
  const { battle, ownersOf, opsOf, specOf, optNumber, onField } = hooks;
  const owners = ownersOf('hex_directive');
  if (!owners.length) return 0;
  /** The card's own candidate list (the owner's three named professions). */
  const PROFS = ['SNIPER', 'WARRIOR', 'CASTER'];
  const applied = [];
  const done = new Set();
  // THE ROLL RUNS ON THE FIRST TICK, NOT AT INSTALL. `install()` is called while the battle is being BUILT, before any
  // operator has been deployed — an install-time `opsOf(pid)` is EMPTY and the card would silently do nothing. This is
  // the failure mode every script in this file has to avoid (`logos.js` uses the same tick). The roll is still taken
  // ONCE per player (`done`), so the profession does not re-roll mid-fight.
  battle.on('tick', () => {
    for (const pid of owners) {
      if (done.has(pid)) continue;
      const ops = opsOf(pid).filter(onField);
      if (!ops.length) continue;
      const spec = specOf(pid, 'hex_directive', 'directiveAtk');
      const pctVal = optNumber(spec, 'atkPct', 50);
      const pick = PROFS[Math.min(PROFS.length - 1, Math.floor(battle.rng() * PROFS.length))];
      for (const u of ops) {
        if (!u.def || u.def.profession !== pick) continue;
        passiveBuff(battle, u, 'hex:directive', { atkPct: pctVal / 100 });
        applied.push(pick);
      }
      noteDirective(battle, pid, 'hex_directive', 'prof', pick, pctVal);
      done.add(pid);
    }
  });
  return { get applied() { return applied; } };
}

/**
 * 指令之意·改: at battle start ONE damage type is chosen at random, and own operators deal `mul`% of it.
 *
 * 「每回合随机指定一种伤害类型，伤害提升至150%」. 业主 2026-10-21: 「改成只在物理，法术里随机。数值改成提升至200%」 —
 * the candidate list is phys / arts only (true damage is out), and the multiplier comes from the record (200).
 * `dmgType` is a PROFILE field (phys / arts), read by ai.js when an attack is built, so the buff is applied to the
 * units whose type matches the roll and lasts the battle.
 *
 * The candidate types are the ones a player's operator can actually deal; `heal` / `none` are excluded because
 * 「伤害类型」 names damage and neither deals any.
 * @param {any} hooks the shared bundle
 */
export function installDirectiveType(hooks) {
  const { battle, ownersOf, opsOf, specOf, optNumber, onField } = hooks;
  const owners = ownersOf('hex_directive2');
  if (!owners.length) return 0;
  const TYPES = ['phys', 'arts'];
  const applied = [];
  const done = new Set();
  // First tick, not install: no operator is deployed while the battle is being BUILT (see installDirectiveAtk).
  battle.on('tick', () => {
  for (const pid of owners) {
    if (done.has(pid)) continue;
    const spec = specOf(pid, 'hex_directive2', 'directiveType');
    const mul = optNumber(spec, 'mul', 200) / 100;
    const pick = TYPES[Math.min(TYPES.length - 1, Math.floor(battle.rng() * TYPES.length))];
    let any = false;
    for (const u of opsOf(pid)) {
      if (!onField(u)) continue;
      any = true;
      const t = (u.profile && u.profile.dmgType) || (u.def && u.def.dmgType);
      if (t !== pick) continue;
      // the type-specific multiplier the damage pipeline already reads (damage.js: × source dmgDealtMul ×
      // phys/artsDealtMul) — true damage has no per-type bucket, so it uses the general one.
      const mods = pick === 'phys' ? { physDealtMul: mul } : pick === 'arts' ? { artsDealtMul: mul } : { dmgDealtMul: mul };
      passiveBuff(battle, u, 'hex:directive2', mods);
      applied.push(pick);
    }
    if (any) {
      noteDirective(battle, pid, 'hex_directive2', 'dmg', pick, Math.round(mul * 100));
      done.add(pid);
    }
  }
  });
  return { get applied() { return applied; } };
}

/**
 * 兔头: the own operator with the HIGHEST attack gains +50 %, the one with the LOWEST loses 30 %.
 *
 * 「攻击力最高的干员攻击力+50%，攻击力最低的干员攻击力－30%」. One operator each: when several tie for the extreme, the
 * first in the board's own deterministic order (tileR then tileC, which is the order `opsOf` returns) takes it — a
 * card that buffed every tied operator would scale with board size, which is not what a single superlative means.
 *
 * A board holding ONE operator is both the highest and the lowest. The card's two halves are then in conflict, and the
 * reading taken is that the POSITIVE half wins [ASSUMED — the text does not say]: a lone operator losing 30 % to its
 * own card is a strictly worse reading of a card the player chose.
 * @param {any} hooks the shared bundle
 */
export function installRabbitHead(hooks) {
  const { battle, ownersOf, opsOf, specOf, optNumber, onField } = hooks;
  const owners = ownersOf('hex_rabbithead');
  if (!owners.length) return 0;
  const applied = [];
  // First tick, not install: no operator is deployed while the battle is being BUILT (see installDirectiveAtk).
  //
  // It RE-RANKS every tick rather than rolling once, because the superlative is over the LIVE board: when the current
  // highest is knocked out, the card must move to the next one instead of pointing at a corpse. The two buffs are
  // `refresh: 'replace'` (passiveBuff's own default), so re-applying cannot stack — the holders are tracked so the
  // card can take the mark OFF a unit that is no longer the extreme.
  let holders = { top: null, bottom: null };
  battle.on('tick', () => {
  for (const pid of owners) {
    const spec = specOf(pid, 'hex:rabbithead', 'rabbitHead');
    const top = optNumber(spec, 'top', 50);
    const bottom = Number.isFinite(Number(spec.bottom)) ? Number(spec.bottom) : -30;
    const ops = opsOf(pid).filter(onField);
    if (!ops.length) continue;
    let hi = ops[0];
    let lo = ops[0];
    for (const u of ops) {
      if (u.s.atk > hi.s.atk) hi = u;
      if (u.s.atk < lo.s.atk) lo = u;
    }
    // move the marks off any unit that no longer holds them
    if (holders.top && holders.top !== hi) battle.removeBuff(holders.top, 'hex:rabbithead:top');
    if (holders.bottom && (holders.bottom !== lo || lo === hi)) battle.removeBuff(holders.bottom, 'hex:rabbithead:bottom');
    passiveBuff(battle, hi, 'hex:rabbithead:top', { atkPct: top / 100 });
    holders.top = hi;
    applied.push('top');
    // a lone operator takes only the positive half (see the header)
    if (lo !== hi && bottom < 0) {
      passiveBuff(battle, lo, 'hex:rabbithead:bottom', { atkPct: bottom / 100 });
      holders.bottom = lo;
      applied.push('bottom');
    } else holders.bottom = null;
  }
  });
  return { get applied() { return applied; } };
}

/**
 * 职业共鸣: each own operator gains +10 % ATK and DEF for every OTHER own operator sharing its profession.
 *
 * 「每有一个相同职业，该职业的干员攻击力和防御力+10％」. The count is of the operator's FELLOWS (the card's own text says
 * 「每有一个相同职业」, and an operator is not its own colleague), read live on every tick because the board changes
 * during a battle (a knock-out, a summon, a substitution).
 * @param {any} hooks the shared bundle
 */
export function installProfResonance(hooks) {
  const { battle, ownersOf, opsOf, specOf, optNumber, onField } = hooks;
  const owners = ownersOf('hex_profresonance');
  if (!owners.length) return 0;
  let applied = 0;
  battle.on('tick', () => {
    for (const pid of owners) {
      const spec = specOf(pid, 'hex_profresonance', 'profResonance');
      const pctVal = optNumber(spec, 'pct', 10) / 100;
      const ops = opsOf(pid).filter(onField);
      const counts = new Map();
      for (const u of ops) {
        const p = u.def && u.def.profession;
        if (p) counts.set(p, (counts.get(p) || 0) + 1);
      }
      for (const u of ops) {
        const p = u.def && u.def.profession;
        if (!p) continue;
        const fellows = (counts.get(p) || 0) - 1;
        if (fellows > 0) { passiveBuff(battle, u, 'hex:profresonance', { atkPct: fellows * pctVal, defPct: fellows * pctVal }); applied++; }
        else battle.removeBuff(u, 'hex:profresonance');
      }
    }
  });
  return { get applied() { return applied; } };
}
