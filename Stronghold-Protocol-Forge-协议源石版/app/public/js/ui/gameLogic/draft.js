// ui/gameLogic/draft.js — 机变 and band-draft normalisation. Re-exported from ../gameLogic.js.

import { isObj } from './shared.js';
import { PHASE, DRAFT_CARDS_MAX } from '../../../../shared/constants.js';
import { t } from '../../../../shared/i18n.js';


// ---- 机变 / band draft normalisation ----------------------------------------------------------------------

/**
 * Normalise m.public.draft ({order, turn, picks, skips?}) — tolerant of index/playerId turns and
 * object/array picks.
 * @param {any} draft
 * @param {any[]} [players]
 * @returns {{ order: string[], turnPid: string|null, picks: Map<string,string>, skipsLeft: Map<string, number>, done: boolean }}
 */
export function normalizeDraft(draft, players = []) {
  const ids = (Array.isArray(players) ? players : []).filter(isObj).map((p) => p.playerId);
  const order = Array.isArray(draft?.order) && draft.order.length ? draft.order.filter((x) => typeof x === 'string') : ids;
  let turnPid = null;
  if (typeof draft?.turn === 'string') turnPid = draft.turn;
  else if (Number.isInteger(draft?.turn) && draft.turn >= 0 && draft.turn < order.length) turnPid = order[draft.turn];
  const picks = new Map();
  const src = draft?.picks;
  if (Array.isArray(src)) {
    src.forEach((v, i) => {
      if (typeof v === 'string' && order[i]) picks.set(order[i], v);
      else if (isObj(v) && typeof v.playerId === 'string' && typeof v.bandId === 'string') picks.set(v.playerId, v.bandId);
    });
  } else if (isObj(src)) {
    for (const [k, v] of Object.entries(src)) if (typeof v === 'string' && v) picks.set(k, v);
  }
  const skipsLeft = new Map();
  const sk = draft?.skipsLeft ?? draft?.skips;
  if (isObj(sk)) for (const [k, v] of Object.entries(sk)) if (Number.isFinite(v)) skipsLeft.set(k, v);
  const done = order.length > 0 && order.every((pid) => picks.has(pid));
  return { order, turnPid, picks, skipsLeft, done };
}

/**
 * Normalise m.public.sp ({family, cards, turn, picks, order?}).
 * Cards: string ids or objects; picks: {playerId: cardIdx} | [{playerId, idx}] | card.takenBy.
 * @param {any} sp
 * @param {any[]} [players]
 */
export function normalizeSp(sp, players = []) {
  if (!isObj(sp)) return null;
  const ids = (Array.isArray(players) ? players : []).filter(isObj).map((p) => p.playerId);
  const order = Array.isArray(sp.order) && sp.order.length ? sp.order.filter((x) => typeof x === 'string') : ids;
  // 卡数由服务端定（choices.js generateDraft: max(6, 存活人数)，>6 人的房间每人一张）。
  // 这里曾经写死 \`.slice(0, 6)\` —— 服务端铺了 7 张、客户端收下就砍掉第 7 张，业主报的
  // 「惊变选择时只能看到 6 个」正是它（而且下面 add() 的 idx 越界校验会把第 7 人的合法选择判成无效）。
  // 上限只保留一个防御性的 DRAFT_CARDS_MAX，**与服务端同源**（shared/constants.js）——
  // 服务端铺牌、协议校验、客户端渲染三处读同一个数，才不会再出现「服务端铺了 7 张、某一层砍到 6 张」。
  const cards = (Array.isArray(sp.cards) ? sp.cards : []).slice(0, DRAFT_CARDS_MAX).map((c, idx) => {
    const card = typeof c === 'string' ? { id: c } : isObj(c) ? { ...c } : {};
    return { ...card, idx, takenBy: typeof card.takenBy === 'string' ? card.takenBy : null };
  });
  const takenBy = new Map(); // idx → playerId
  const pickOf = new Map(); // playerId → idx
  const src = sp.picks;
  const add = (pid, idx) => {
    if (typeof pid !== 'string' || !Number.isInteger(idx) || idx < 0 || idx >= cards.length) return;
    takenBy.set(idx, pid);
    pickOf.set(pid, idx);
  };
  if (Array.isArray(src)) src.forEach((v, i) => { if (isObj(v)) add(v.playerId, v.idx); else if (Number.isInteger(v) && order[i]) add(order[i], v); });
  else if (isObj(src)) for (const [k, v] of Object.entries(src)) add(k, v);
  if (isObj(sp.taken)) for (const [k, v] of Object.entries(sp.taken)) add(v, Number(k));
  for (const c of cards) if (c.takenBy) add(c.takenBy, c.idx);
  for (const c of cards) c.takenBy = takenBy.get(c.idx) ?? null;
  let turnPid = null;
  if (typeof sp.turn === 'string') turnPid = sp.turn;
  else if (Number.isInteger(sp.turn) && sp.turn >= 0 && sp.turn < order.length) turnPid = order[sp.turn];
  return {
    family: typeof sp.family === 'string' ? sp.family : null,
    name: typeof sp.name === 'string' && sp.name ? sp.name : null,
    desc: typeof sp.desc === 'string' && sp.desc ? sp.desc : null,
    untimed: !!sp.untimed,
    cards, order, turnPid, pickOf, takenBy, pickedCount: pickOf.size,
  };
}

/** Adapt only the recipient's current PREP choice; never write it into the public draft. */
export function normalizePersonalChoice(pub, priv, myId) {
  const choice = priv?.personalChoice;
  if (pub?.phase !== PHASE.PREP || !priv || priv.playerId !== myId || priv.alive === false
    || !choice || choice.round !== pub.round) return null;
  return {
    ...normalizeSp({ family: 'bounty', name: t('教鞭 · 战术特训'), desc: t('请选择一项战术特训'),
      cards: choice.cards, turn: myId, order: [myId], picks: {} }),
    id: choice.id,
  };
}

/**
 * Normalise m.public.hex (DESIGN §29) — the 协议源石 draft. A PARALLEL draft: m.public.hex.offers is keyed by player id,
 * everyone decides at once, and there is no turn order. Returns null outside the draft, so a caller can use its
 * truthiness as "the draft is on".
 *
 * Ported from the 0.3.0 tree for the Hextech port. `myId` is only used to pick out the viewer's own offer / pick /
 * rerolls; `_players` is unused but kept so the call sites stay identical to the 0.3.0 ones.
 * @param {any} hex
 * @param {string|null} myId
 * @returns {null | { offers: Map<string, any[]>, picks: Map<string, number>, rerollsLeft: Map<string, number>,
 *   myOffer: any[], myPick: number|null, myRerolls: number, untimed: boolean, turnDeadline: number, timerSec: number,
 *   decided: boolean }}
 */
export function normalizeHex(hex, myId = null, _players = []) {
  if (!isObj(hex)) return null;
  const offers = new Map();
  const src = isObj(hex.offers) ? hex.offers : {};
  for (const [pid, list] of Object.entries(src)) {
    if (!Array.isArray(list)) continue;
    offers.set(pid, list.filter(isObj).map((c, i) => ({ ...c, idx: Number.isInteger(c.idx) ? c.idx : i })));
  }
  const picks = new Map();
  if (isObj(hex.picks)) for (const [k, v] of Object.entries(hex.picks)) if (Number.isInteger(v)) picks.set(k, v);
  const rerollsLeft = new Map();
  if (isObj(hex.rerollsLeft)) for (const [k, v] of Object.entries(hex.rerollsLeft)) if (Number.isFinite(v)) rerollsLeft.set(k, v);
  const mine = myId && offers.has(myId) ? offers.get(myId) : [];
  const decided = [...offers.keys()].every((pid) => picks.has(pid));
  return {
    offers,
    picks,
    rerollsLeft,
    myOffer: mine,
    myPick: myId && picks.has(myId) ? picks.get(myId) : null,
    myRerolls: myId && rerollsLeft.has(myId) ? rerollsLeft.get(myId) : 0,
    untimed: !!hex.untimed,
    turnDeadline: Number(hex.turnDeadline) || 0,
    timerSec: Number(hex.timerSec) || 0,
    decided,
  };
}

/** The enemy side's accumulated 协议源石 (m.public.enemyHexes): [{ id, name, desc, rarity, icon, drawRound }]. */
export function normalizeEnemyHexes(list) {
  return (Array.isArray(list) ? list : []).filter((h) => isObj(h) && typeof h.id === 'string');
}
