// Observing rules and labels of client-side combat (research 09 §3.1 / §6.3, DESIGN §14 "Spectating") — pure helpers
// for the game screen, the team panel and the combat HUD (mirror of server/match/match/watch.js _watchClient):
//   * prep (休整期): tap a teammate → 前往查看 → their board (read-only);
//   * own normal battle running: no observing ("当前无法查看");
//   * own battle over: "⌛ 作战结束，等待队友完成作战" + the teammates' progress; tap a teammate → 前往查看 → a local
//     replica of their battle; 返回战场 goes back;
//   * 联防 / 最终攻势: the ‹ › pill switches the camera LEFT half / 全景 / RIGHT half of the own field; the other pair's
//     boss field is never shown to a fighting player;
//   * eliminated: anything — each phase reset starts on the player it follows (the server's prep scout / b.start,
//     followedScout).

import { PHASE } from '../../../shared/constants.js';
import { data } from '../data.js';
import { t } from '../../../shared/i18n.js';

const isObj = (v) => !!v && typeof v === 'object';
const COMBAT = new Set([PHASE.COMBAT, PHASE.UNITE, PHASE.FINAL_ASSAULT, PHASE.HIDDEN_CORE]);

/** The server runs client-side combat (m.public.combatMode). */
export const isClientCombat = (pub) => !!pub && pub.combatMode === 'client';

const players = (pub) => (Array.isArray(pub?.players) ? pub.players.filter(isObj) : []);
const fields = (pub) => (Array.isArray(pub?.fields) ? pub.fields.filter(isObj) : []);

/** The field listing a player, or null. */
export function fieldOf(pub, playerId) {
  return fields(pub).find((f) => Array.isArray(f.players) && f.players.includes(playerId)) || null;
}

/** Display name of a player id ('队友' when unknown). */
export function nameOf(pub, playerId) {
  return players(pub).find((p) => p.playerId === playerId)?.name || t('队友');
}

/**
 * What tapping a team row does: `{ back: true }` (own row while observing), `{ fieldId }` to observe, or `{ reason }`.
 * @param {any} p m.public player row
 * @param {any} pub
 * @param {string} myId
 * @param {{ observing?: boolean, ownDone?: boolean }} [o] ownDone: the local simulation of the own battle already ended
 *   (its result is on the way to the server)
 */
export function observeTarget(p, pub, myId, { observing = false, ownDone = false } = {}) {
  if (!isObj(p)) return { reason: t('无效的目标') };
  if (p.playerId === myId) return observing ? { back: true } : { reason: null };
  if (p.alive === false || p.status === 'left') return { reason: t('该队友已被淘汰，无法查看') };
  const phase = pub?.phase;
  const me = players(pub).find((x) => x.playerId === myId) || null;
  const meAlive = me ? me.alive !== false : true;
  if (!COMBAT.has(phase)) return { fieldId: `n:${p.playerId}` };
  const target = fieldOf(pub, p.playerId);
  if (!target) return { reason: t('该队友当前没有战场') };
  const own = fieldOf(pub, myId);
  if (!meAlive || !own) return { fieldId: target.fieldId };
  if (own.fieldId === target.fieldId) return { reason: t('队友与你在同一战场，使用 ‹ › 切换视角') };
  if (target.kind === 'boss' || target.kind === 'hidden') return { reason: t('无法查看另一组队友的战场') };
  if (own.kind === 'normal' && own.live !== false && !ownDone) return { reason: t('作战中无法查看队友，作战结束后可前往查看') };
  return { fieldId: target.fieldId };
}

/**
 * A screen reloaded (or a socket reconnected) while it watched a teammate's battle after the own one: the server
 * resends the watched field (Match._resendBattle, b.start `watch: true`), but a fresh screen starts at home — so the
 * observing pill, 返回战场 and the own row would be missing. Decided once per battle, at the first sight of its
 * battleId (`seen` = the battleId already decided): adopt `fieldId` as the watched field when it is a teammate's normal
 * battle in 各自行动 shown to a living player who watches nothing. Never for a battle first seen while watching (a
 * 前往查看 under way — and its 返回战场 must not bring it back while the own b.start is on its way), the own field, a
 * 联防 leaker's field or an eliminated player's auto-observed one (those keep their own rules). A loading battle (its
 * state carries no `watch` yet) is decided once it runs, unless the screen already watches (then it is marked seen).
 * @param {any} b battleRunner.state() @param {{ pub?: any, myId?: string, alive?: boolean, watching?: string|null,
 *   seen?: string|null }} [o]
 * @returns {{ seen: string|null, fieldId: string|null }} seen: the new value to remember
 */
export function resumedWatch(b, { pub = null, myId = '', alive = true, watching = null, seen = null } = {}) {
  const keep = { seen, fieldId: null };
  if (!isObj(pub) || !isObj(b) || typeof b.battleId !== 'string' || !b.battleId || b.battleId === seen) return keep;
  if (b.loading && !watching) return keep;
  const done = { seen: b.battleId, fieldId: null };
  if (b.loading || watching || !alive || !isClientCombat(pub) || pub.phase !== PHASE.COMBAT) return done;
  if (!b.watch || b.kind !== 'normal' || typeof b.fieldId !== 'string' || !b.fieldId) return done;
  const f = fields(pub).find((x) => x.fieldId === b.fieldId);
  if (!f || f.kind !== 'normal' || !Array.isArray(f.players) || f.players.includes(myId)) return done;
  return { seen: b.battleId, fieldId: b.fieldId };
}

/**
 * The prep board the server pushed to a viewer that follows a player (an eliminated player or a spectator seat:
 * Match._followScout — the player it last watched, else the first player still in; community report of 2026-10-06,
 * item 56, the idea of PR #189), to adopt as the watched board like a 前往查看 tap: `field` is such a scout (m.field
 * `prep`, an `n:<pid>` id other than the own) and the screen watches nothing (`watching` null — a 返回战场 this phase is
 * not overridden: the caller adopts a board once per phase). Null for a living player: its phase resets keep its own
 * board.
 * @param {{ field?: any, watching?: string|null, alive?: boolean, spectator?: boolean, myId?: string }} o
 * @returns {string|null} the fieldId to watch
 */
export function followedScout({ field = null, watching = null, alive = true, spectator = false, myId = '' } = {}) {
  if (watching || (alive && !spectator) || !isObj(field) || !field.prep) return null;
  const fid = field.fieldId;
  if (typeof fid !== 'string' || !fid.startsWith('n:') || fid === `n:${myId}`) return null;
  return fid;
}

/** Teammates' progress for the waiting pill: [{ playerId, name, killed, resolved, total, done, isBot }]. */
export function teammateProgress(pub, myId) {
  const out = [];
  for (const f of fields(pub)) {
    if (f.kind !== 'normal' || !Array.isArray(f.players)) continue;
    const pid = f.players[0];
    if (pid === myId) continue;
    const p = players(pub).find((x) => x.playerId === pid);
    const pr = isObj(f.progress) ? f.progress : null;
    out.push({
      playerId: pid, name: p?.name || t('队友'), isBot: !!p?.isBot,
      killed: Number.isFinite(pr?.killed) ? pr.killed : null,
      resolved: Number.isFinite(pr?.resolved) ? pr.resolved : (Number.isFinite(pr?.killed) ? pr.killed : null),
      total: Number.isFinite(pr?.total) ? pr.total : null,
      done: f.live === false || !!pr?.done,
    });
  }
  return out;
}

/** Side of each player of a local field meta (`sides` from the runner, else seat order). */
export function sidesOf(field) {
  if (isObj(field?.sides)) return field.sides;
  const ps = Array.isArray(field?.players) ? field.players : [];
  return Object.fromEntries(ps.map((pid, i) => [pid, i === 1 ? 'R' : 'L']));
}

/**
 * The ‹ › camera layers of a 联防 / boss field: LEFT half, 全景, RIGHT half with captions "你自己" / "👁 name" /
 * "全景" / "无人在家". Empty for normal fields and single-player boss fields.
 */
export function cameraLayers(field, pub, myId) {
  if (!isObj(field) || (field.kind !== 'unite' && field.kind !== 'boss' && field.kind !== 'hidden')) return [];
  const sides = sidesOf(field);
  const at = (side) => Object.keys(sides).find((pid) => sides[pid] === side) || null;
  const label = (pid) => (!pid ? t('无人在家') : pid === myId ? t('你自己') : nameOf(pub, pid));
  const left = at('L');
  const right = at('R');
  if ((field.kind === 'boss' || field.kind === 'hidden') && (!left || !right)) return [];
  return [
    { key: 'L', label: label(left), self: left === myId, watch: !!left && left !== myId },
    { key: 'ALL', label: t('全景'), self: false, watch: false },
    { key: 'R', label: label(right), self: right === myId, watch: !!right && right !== myId },
  ];
}

/** Camera options of a layer for view.setCamera(kind, …). */
export function layerCamera(field, layer, mySide = 'L') {
  const rect = field?.rect;
  if (layer === 'L' || layer === 'R') return { rect, side: layer, half: true };
  return { rect, side: mySide };
}

/**
 * The one occupied half ('L' | 'R') of a 联防 field with a lone helper, else null. That field
 * (act1autochess_escaped_single) routes every enemy through the helper's half and the other half holds no player, so
 * the camera starts on the helper's half and the ‹ › pill keeps 全景 (GitHub #635, PR #637).
 */
export function loneHalf(field) {
  if (field?.kind !== 'unite') return null;
  const occupied = ['L', 'R'].filter((side) => Object.values(sidesOf(field)).includes(side));
  return occupied.length === 1 ? occupied[0] : null;
}

/** The spec entry of one battle member (`players[]`), or null. */
function specPlayer(spec, playerId) {
  const list = isObj(spec) && Array.isArray(spec.players) ? spec.players : [];
  return list.find((p) => isObj(p) && p.playerId === playerId) || null;
}

/** The 协议源石 roster record of a spec effect ref (data/hextech.json `playerHexes`, keyed by the hex id), or null. */
function hexRecord(pe) {
  const roster = data.get('hextech')?.playerHexes;
  const fromData = isObj(pe) && isObj(pe.data) && typeof pe.data.hexId === 'string' ? pe.data.hexId : '';
  const id = fromData || (isObj(pe) && typeof pe.id === 'string' && pe.id.startsWith('hex:') ? pe.id.slice(4) : '');
  if (!id) return null;
  if (Array.isArray(roster)) return roster.find((h) => isObj(h) && h.id === id) || null;
  return isObj(roster) ? roster[id] || null : null;
}

/** The 阶位 (1 / 2 / 3) of a 协议源石 rarity id (data/hextech.json `rarities[].tier`), else null. */
function hexTierOf(rarity) {
  const list = data.get('hextech')?.rarities;
  const r = Array.isArray(list) ? list.find((x) => isObj(x) && x.id === rarity) : null;
  const tier = r ? Number(r.tier) : NaN;
  return Number.isInteger(tier) && tier > 0 ? tier : null;
}

/**
 * One spec `playerEffects` ref (Battle spec: `{ id, source = iconKind, counter, data?, … }`, PlayerState.battleInput)
 * as an effects-column entry (ui/effectsList.js), or null to drop it. Resolved client-side:
 *   * `band` — bands.json by `effectId` (the band's own name / text / icon);
 *   * `hex` — data/hextech.json `playerHexes` by `data.hexId` (else the id's `hex:` prefix), never effects.json: the
 *     card's name / text AND the tier of its rarity (`tier`, which is what gives the tile its 阶位 art); the roster
 *     carries no rune icon, so `iconId` is undefined and the tile draws the tier art (EffectsList);
 *   * anything else — effects.json by the id, the id itself when no record names it.
 */
function effectEntry(pe) {
  if (!isObj(pe) || typeof pe.id !== 'string' || !pe.id) return null;
  const counter = pe.counter != null ? { counter: pe.counter } : {};
  if (pe.source === 'hex') {
    const rec = hexRecord(pe);
    // no record (a hex this build does not know): the raw ref, the same fallback as any unknown effect
    if (!rec) return { id: pe.id, name: pe.id, desc: '', iconKind: 'hex', iconId: pe.id, ...counter };
    const rarity = isObj(pe.data) && typeof pe.data.rarity === 'string' && pe.data.rarity ? pe.data.rarity : rec.rarity;
    const tier = hexTierOf(rarity);
    return { id: pe.id, name: rec.name || pe.id, desc: rec.desc || '', iconKind: 'hex', iconId: rec.icon, ...counter, ...(tier ? { tier } : {}) };
  }
  if (pe.source === 'band') {
    const band = data.list('bands').find((b) => b && b.effectId === pe.id);
    if (band) return { id: pe.id, name: band.effectName || band.name, desc: band.desc || '', iconKind: 'band', iconId: band.iconId || band.bandId, ...counter };
  }
  const rec = data.lookup('effects', pe.id);
  return { id: pe.id, name: rec?.name || pe.id, desc: rec?.desc || rec?.descRaw || '', iconKind: pe.source || 'choice', iconId: pe.id, ...counter };
}

/** One member's resolved column, or null when the spec carries no `playerEffects` for it (never an empty stand-in). */
function memberEffects(spec, playerId) {
  const p = specPlayer(spec, playerId);
  if (!p || !Array.isArray(p.playerEffects)) return null;
  return p.playerEffects.map(effectEntry).filter(Boolean);
}

/**
 * The watched player's effects column for a battle watched as a display replica (user playtest #2: while spectating,
 * the right column shows the spectated player's effects, not one's own). Undefined where whose column would be
 * ambiguous (a 联防 / boss pair field lists more than one player — the screen then names the player with the bond
 * strip's owner, see `effectsForOwner`) or there are no effects data (a server-run field's meta comes from the server
 * without effects — the column stays empty rather than showing one's own).
 */
export function spectateEffects(spec, members) {
  if (!Array.isArray(members) || members.length !== 1 || !isObj(spec)) return undefined;
  return memberEffects(spec, members[0]) ?? undefined;
}

/**
 * Every member's effects column of a display replica, keyed by playerId — the 联防 / boss pair counterpart of
 * `spectateEffects` (业主 2026-10-31「联防时不能正确显示联防队友的协议源石」: a shared field has no single member, so
 * the column used to be empty; the screen now picks the player it shows, like the bond strip). Members whose spec
 * carries no `playerEffects` are left out; undefined when none has any (an older spec / a server-run field).
 * @param {any} spec Battle spec @param {string[]} members the field's players
 * @returns {Record<string, any[]>|undefined}
 */
export function spectateEffectsByPlayer(spec, members) {
  if (!isObj(spec) || !Array.isArray(members)) return undefined;
  const out = {};
  let any = false;
  for (const pid of members) {
    if (typeof pid !== 'string' || !pid) continue;
    const list = memberEffects(spec, pid);
    if (!list) continue;
    out[pid] = list;
    any = true;
  }
  return any ? out : undefined;
}

/**
 * The effects column of the player on screen (ui/effectsList.js), following the SAME owner as the bond strip
 * (ui/watchBonds.js `bondOwnerId` / `screenStrip().ownerId`): your own m.private.effects for your own board / battle,
 * a teammate's otherwise. A teammate's list comes from the field meta — the per-player map of a display replica
 * (`field.effectsByPlayer`, `spectateEffectsByPlayer`), else the single list the runner / the server's prep scout sends
 * (`field.effects`). Null = an empty column (a field whose players' effects the meta does not carry, e.g. a server-run
 * field) — never one's own.
 * @param {any} field the field meta on screen (store.match.field) @param {any} priv m.private (own effects)
 * @param {string|null|undefined} ownerId whose column (ui/watchBonds.js bondOwnerId) @param {string} myId
 * @returns {any[]|null}
 */
export function effectsForOwner(field, priv, ownerId, myId) {
  if (typeof ownerId !== 'string' || !ownerId || ownerId === myId) return priv?.effects ?? null;
  const by = isObj(field) && isObj(field.effectsByPlayer) ? field.effectsByPlayer : null;
  const mine = by && Array.isArray(by[ownerId]) ? by[ownerId] : null;
  if (mine) return mine;
  return isObj(field) && Array.isArray(field.effects) ? field.effects : null;
}
