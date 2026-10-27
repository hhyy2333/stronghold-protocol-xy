// test/match/hextech.test.js — the 海克斯 draft in a real match (DESIGN §29): a parallel 3-of-1 draft with one reroll
// on rounds 1 / 3 / 6 / 11, and one enemy hex per draw that persists to the end of the match.
//
// The match runs on the virtual scheduler with the fake battle (test/match/harness.js), so a full round costs nothing.

import test from 'node:test';
import assert from 'node:assert/strict';
import { makeMatch, DATA, withoutHextech, give, giveItem, chessOfTier, legalTileFor } from './harness.js';
import { makeBattle, chessRec, enemyRec } from '../helpers/battleHarness.js';
import { enemyHexMods, applyHex, lpLockUntilOf, lpLockedIn, hexPoolFor, hexAvailableTo, applyForgeFusion, FORGE_ITEM_ID, equipSlotsOf, bondCapOf, layerGainMulOf, bountyMultiplier, ownsHex, enemyVerbIds, enemyPrepLpCost, resolveMirrorCopies, bondLayerViewMulOf } from '../../server/match/hextech.js';
import { computeBonds, pieceBonds } from '../../server/match/bondsMeta.js';
import { tileKey, canPlace, placeClass } from '../../server/match/board.js';
import { buildBattleSpec, createBattleFromSpec } from '../../server/sim/spec.js';
import { BATTLE_SPEC_KEYS, HEX_SCRIPT_KEYS, hasBattlePart } from '../../server/sim/content/hextech.js';
import { hasBattleEffect } from '../../server/sim/content/items/battle.js';
import { enemyHexWantedKey, bankThiefPenalty, applyThiefIncomeCut, applyBandHexCopy } from '../../server/match/hextech.js';
import { createRng } from '../../server/sim/rng.js';

/** Start a match and drive the humans to the 海克斯 draft of `round`. */
function toHexDraft(h, round) {
  const ok = h.drive(() => h.ended != null || (h.m.phase === 'HEX_DRAFT' && h.m.round === round));
  assert.ok(ok && h.m.phase === 'HEX_DRAFT' && h.m.round === round, `expected HEX_DRAFT R${round}, got ${h.m.phase} R${h.m.round}`);
  return h;
}

/** Drive on to the prep phase of `round`. */
function toPrep(h, round) {
  const ok = h.drive(() => h.ended != null || (h.m.phase === 'PREP' && h.m.round === round));
  assert.ok(ok && h.m.phase === 'PREP' && h.m.round === round, `expected PREP R${round}, got ${h.m.phase} R${h.m.round}`);
  return h;
}

test('the draft runs at R1/R6/R11, offers three hexes per player and allows exactly one reroll', () => {
  const h = makeMatch({ mode: 'coop', difficulty: 'NORMAL', humans: 1, bots: 1, seed: 11, fake: true });
  h.start();
  toHexDraft(h, 1);
  const m = h.m;
  assert.equal(m.phase, 'HEX_DRAFT');
  assert.deepEqual(Object.keys(m.hex.offers).sort(), ['ai_0', 'p_0']);
  for (const pid of ['p_0', 'ai_0']) {
    const offer = m.hexOfferOf(pid);
    assert.equal(offer.length, 3, `${pid} was offered three`);
    assert.equal(new Set(offer).size, 3);
  }
  assert.equal(m.hex.rerolls.p_0, 1);
  // 刷新必须换掉**这一批**（业主 2026-10-16「刷新会有重复海克斯」）：`rollOffers` 的 `owned` 以前只传 `hexIdsOf(ps)`
  // （玩家已拥有的），不含当前 offer 的三张 —— 于是新抽的可能是刚被换掉的那几张。池子越小越明显。
  const offerBefore = m.hexOfferOf('p_0').slice();
  // the pick is the player's own slot, so any index below the offer is legal and nothing is shared
  assert.deepEqual(m.handle('p_0', { t: 'g.hexReroll' }), { ok: true });
  assert.equal(m.hex.rerolls.p_0, 0);
  const offerAfter = m.hexOfferOf('p_0').slice();
  assert.equal(offerAfter.length, 3, 'the reroll still offers three');
  assert.equal(new Set(offerAfter).size, 3, 'and three distinct ones');
  assert.deepEqual(offerAfter.filter((id) => offerBefore.includes(id)), [], 'no card of the replaced batch comes back');
  assert.deepEqual(m.handle('p_0', { t: 'g.hexReroll' }), { error: 'NO_REROLL' });
  assert.deepEqual(m.handle('p_0', { t: 'g.hex', idx: 3 }), { error: 'BAD_TARGET' });
  assert.deepEqual(m.handle('p_0', { t: 'g.hex', idx: 0 }), { ok: true });
  assert.deepEqual(m.handle('p_0', { t: 'g.hex', idx: 1 }), { error: 'ALREADY' });
  const pickedId = m.hex.offers.p_0[m.hex.picks.p_0];
  // the bot answers on its own after DELAYS.BOT_ACTION, so capture its OFFERS now and read its pick off its refs below
  const botOffers = m.hex.offers.ai_0.slice();
  toPrep(h, 1);
  const refs = h.ps('p_0').effects.filter((e) => e.key.startsWith('hex:'));
  assert.equal(refs.length, 1, 'p_0 owns one hex');
  assert.equal(refs[0].key, `hex:${pickedId}`);
  // Two cards of the roster grant MORE than one ref: 镜像协议 (copies a random hex a teammate owns) and 二次抽取 (two extra
  // random hexes). Pinning "exactly 1" made this fail the moment a new card shifted the draft draw — the fourth batch did
  // exactly that (the bot took 镜像协议). Assert what that pick actually grants instead.
  const botRefs = h.ps('ai_0').effects.filter((e) => e.key.startsWith('hex:'));
  const botPick = botOffers.find((id) => botRefs.some((e) => e.key === `hex:${id}`));
  assert.ok(botPick, `the bot owns one of its offers (${botOffers.join(', ')})`);
  const extra = botPick === 'hex_double' ? 2 : botPick === 'hex_mirror' ? 1 : 0;
  assert.equal(botRefs.length, 1 + extra, `${botPick} grants its own ref plus ${extra}`);
  h.invariants();
  m.dispose();
});

test('g.hexReroll { idx } replaces only that slot (业主 2026-10-20「把刷新按钮改成分别刷新每个」)', () => {
  const h = makeMatch({ mode: 'coop', difficulty: 'NORMAL', humans: 1, bots: 1, seed: 12, fake: true });
  h.start();
  toHexDraft(h, 1);
  const m = h.m;
  const before = m.hexOfferOf('p_0').slice();
  assert.equal(before.length, 3);
  const rerolls0 = m.hex.rerolls.p_0;
  // an out-of-range slot is refused BEFORE the reroll is spent (checked while one is still available)
  assert.deepEqual(m.handle('p_0', { t: 'g.hexReroll', idx: 9 }), { error: 'BAD_TARGET' });
  assert.equal(m.hex.rerolls.p_0, rerolls0, 'a refused slot costs nothing');
  assert.deepEqual(m.hexOfferOf('p_0'), before, 'and changes nothing on the board');
  assert.equal(m.hex.slotRerolls.p_0.length, 3, 'one budget per card');
  assert.deepEqual(m.hex.slotRerolls.p_0, [1, 1, 1], 'every card may be rerolled once (业主 2026-10-20「3个都能刷一次」)');
  assert.deepEqual(m.handle('p_0', { t: 'g.hexReroll', idx: 1 }), { ok: true });
  const after = m.hexOfferOf('p_0').slice();
  assert.deepEqual(m.hex.slotRerolls.p_0, [1, 0, 1], 'only slot 1 spent its reroll');
  assert.equal(m.hex.rerolls.p_0, rerolls0, 'the whole-batch reroll is a SEPARATE budget and was not touched');
  assert.equal(after.length, 3, 'the offer still holds three cards');
  assert.equal(new Set(after).size, 3, 'and three distinct ones');
  assert.equal(after[0], before[0], 'slot 0 is untouched');
  assert.equal(after[2], before[2], 'slot 2 is untouched');
  assert.notEqual(after[1], before[1], 'only slot 1 was replaced');
  assert.ok(!before.includes(after[1]), 'and the replaced card never comes back as the new one');
  // that one card is spent now; the other two still each have theirs
  assert.deepEqual(m.handle('p_0', { t: 'g.hexReroll', idx: 1 }), { error: 'NO_REROLL' });
  assert.deepEqual(m.handle('p_0', { t: 'g.hexReroll', idx: 0 }), { ok: true }, 'slot 0 still has its own');
  assert.deepEqual(m.handle('p_0', { t: 'g.hexReroll', idx: 2 }), { ok: true }, 'so does slot 2');
  assert.deepEqual(m.hex.slotRerolls.p_0, [0, 0, 0], 'all three cards have now been rerolled once each');
  // the whole-batch form (the request older clients send, no idx) is still available — its own budget, untouched
  assert.deepEqual(m.handle('p_0', { t: 'g.hexReroll' }), { ok: true });
  assert.deepEqual(m.handle('p_0', { t: 'g.hexReroll' }), { error: 'NO_REROLL' });
  m.dispose();
});

test('the whole-batch g.hexReroll (no idx) still replaces all three — the request an older client sends', () => {
  const h = makeMatch({ mode: 'coop', difficulty: 'NORMAL', humans: 1, bots: 1, seed: 13, fake: true });
  h.start();
  toHexDraft(h, 1);
  const m = h.m;
  const before = m.hexOfferOf('p_0').slice();
  assert.deepEqual(m.handle('p_0', { t: 'g.hexReroll' }), { ok: true });
  const after = m.hexOfferOf('p_0').slice();
  assert.deepEqual(after.filter((id) => before.includes(id)), [], 'every card of the old batch is gone');
  assert.equal(new Set(after).size, 3, 'and the new batch is three distinct cards');
  m.dispose();
});

test('one enemy hex per draw, of a rarity a player picked, never a repeat, and it persists across rounds', () => {
  const h = makeMatch({ mode: 'coop', difficulty: 'NORMAL', humans: 2, bots: 0, seed: 23, fake: true });
  h.start();
  const m = h.m;
  const pickedRarities = [];
  const seen = [];
  // 第 7 回合是盟约专属协议回合（业主 2026-10-26），仍然是一次抽取 —— 敌方也照常得到一张。
  for (const round of [1, 3, 6, 7, 11]) {
    toHexDraft(h, round);
    // the harness drives the human seats (g.hex idx 0); both humans answer
    const ok = h.drive(() => m.hex == null || m.phase !== 'HEX_DRAFT');
    assert.ok(ok, `R${round} draft finished`);
    const rarities = ['p_0', 'p_1'].map((pid) => {
      // the newest ref (a player keeps every hex they picked: R1's, R6's, …)
      const refs = h.ps(pid).effects.filter((e) => e.key.startsWith('hex:'));
      assert.ok(refs.length, `${pid} owns a hex after R${round}`);
      return m.gd.hex(refs[refs.length - 1].data.hexId).rarity;
    });
    pickedRarities.length = 0;
    pickedRarities.push(...rarities);
    toPrep(h, round);
    assert.equal(m.enemyHexes.length, seen.length + 1, `exactly one enemy hex after R${round}`);
    // only the hex drawn THIS round has to match this round's picks (the earlier ones keep the rarity they were drawn at)
    const newest = m.enemyHexes[m.enemyHexes.length - 1];
    assert.ok(pickedRarities.includes(m.gd.hex(newest.id).rarity), `${newest.id} matches a picked rarity`);
    assert.ok(!seen.includes(newest.id), `${newest.id} was not drawn twice`);
    assert.equal(newest.round, round);
    seen.length = 0;
    seen.push(...m.enemyHexes.map((e) => e.id));
  }
  assert.equal(m.enemyHexes.length, 5);
  // The enemy side is a MIX of shapes (DESIGN §29.10): `mods` cards feed the wave multipliers, `verb` cards drive
  // battle scripts. With five draws the side may hold only verbs, so the guarantee is the union — every owned hex
  // contributes something, and each one is one of the two known shapes.
  const owned = m.enemyHexes.map((e) => m.gd.hex(e.id));
  assert.ok(owned.length === 5, 'five enemy hexes');
  for (const rec of owned) {
    const hasMods = rec.mods && Object.keys(rec.mods).length > 0;
    assert.ok(hasMods || typeof rec.verb === 'string', `${rec.id} carries mods or a verb`);
  }
  const mods = owned.filter((r) => r.mods && Object.keys(r.mods).length);
  if (mods.length) assert.ok(Object.keys(enemyHexMods(m)).length > 0, 'the enemy side has multipliers');
  else assert.deepEqual(Object.keys(enemyHexMods(m)), [], 'an all-verb draw adds no wave multipliers');
  assert.deepEqual(enemyVerbIds(m).sort(), owned.filter((r) => r.verb).map((r) => r.id).sort(), 'exactly the verb cards reach the battle');
  h.invariants();
  m.dispose();
});

test('the draft is a phase of its own: the round start reaches it, and the view carries the offers and the enemy hexes', () => {
  const h = makeMatch({ mode: 'coop', difficulty: 'NORMAL', humans: 1, bots: 1, seed: 5, fake: true });
  h.start();
  toHexDraft(h, 1);
  const pub = h.lastBc('m.public');
  assert.ok(pub, 'm.public was broadcast');
  assert.ok(pub.hex, 'm.public.hex rides along');
  assert.equal(pub.hex.offers.p_0.length, 3);
  // a single human (同盟 room started alone / with AI teammates only) is never timed — same rule as 机变 / 策略轮选
  assert.equal(pub.hex.untimed, true);
  assert.equal(pub.hex.timerSec, 0);
  assert.deepEqual(pub.hex.rerollsLeft, { p_0: 1, ai_0: 1 });
  assert.equal(pub.hex.picks.p_0, undefined);
  // two humans: the draft is timed (30 s) and publishes its deadline
  const coop = makeMatch({ mode: 'coop', difficulty: 'NORMAL', humans: 2, seed: 9, fake: true });
  coop.start();
  toHexDraft(coop, 1);
  const cpub = coop.lastBc('m.public');
  assert.equal(cpub.hex.untimed, false);
  assert.equal(cpub.hex.timerSec, 30);
  assert.ok(cpub.hex.turnDeadline > 0, 'the deadline is published');
  coop.m.dispose();
  // The rune icons were retired on 2026-10-12 (the card face is the owner's own 阶位 art), so `icon` is no longer part
  // of a card the view has to carry — the client falls back to the tier art wherever it is missing.
  for (const c of pub.hex.offers.p_0) {
    assert.ok(c.id && c.name && c.desc && c.rarity, `card ${c.idx} is complete`);
  }
  // a solo match publishes no countdown (the draft is untimed there, like 机变 / 策略轮选)
  const solo = makeMatch({ mode: 'solo', difficulty: 'NORMAL', humans: 1, seed: 3, fake: true });
  solo.start();
  toHexDraft(solo, 1);
  assert.equal(solo.lastBc('m.public').hex.untimed, true);
  assert.equal(solo.lastBc('m.public').hex.timerSec, 0);
  solo.m.dispose();
  h.m.dispose();
});

test('a 9-round solo mode drafts on R1, R3 and R6 only (no R11)', () => {
  const h = makeMatch({ mode: 'solo', difficulty: 'FUNNY', humans: 1, seed: 17, fake: true });
  h.start();
  toHexDraft(h, 1);
  toPrep(h, 1);
  assert.equal(h.m.round, 1);
  // R3 is a draft round since 2026-10-19 (owner: 「在第三回合加一次选择协议源石」)
  toHexDraft(h, 3);
  toPrep(h, 3);
  toHexDraft(h, 6);
  toPrep(h, 6);
  assert.equal(h.m.enemyHexes.length, 3);
  h.m.dispose();
});

test('withoutHextech(): no hex is drawn, but a same-round 机变 still runs (R6 does not skip it)', () => {
  // the fixture empties the POOLS, never the schedule: R6 is both a 海克斯 and a 机变 round, so a match with no roster
  // must still reach SP_DRAFT there (a fixture that silently drops the rule under test is worse than a noisy number)
  const seen = (h) => {
    const set = new Set();
    // PORT NOTE (2026-10-16): this tree's `m.public` is DELTA-shaped — most messages carry `{ delta, phase, players }`
    // and NO `round` (the browser merges them onto the last full state). Reading `msg.round` straight off the message
    // therefore recorded `undefined:SP_DRAFT` and the assertion below could never be satisfied, however healthy the
    // match was. Fold the messages the way the client does and the round survives.
    //
    // The rule under test is untouched: R6 is both a 海克斯 and a 机变 round, so a match with an EMPTY hextech pool must
    // still reach SP_DRAFT there. (Verified independently: the match drives to PREP R7 and `m.phase` passes through
    // SP_DRAFT at R6 either way — only this observation was wrong.)
    let cur = {};
    const take = (msg) => {
      if (msg.t !== 'm.public') return;
      cur = { ...cur, ...msg };
      if (cur.round != null && cur.phase) set.add(`${cur.round}:${cur.phase}`);
    };
    h.onBroadcast.push(take);
    for (const msg of h.bc) take(msg);
    return set;
  };
  const h = makeMatch({ mode: 'solo', difficulty: 'NORMAL', humans: 1, seed: 12, fake: true, instant: false, data: withoutHextech() });
  h.start();
  const phases = seen(h);
  assert.ok(h.drive(() => h.m.phase === 'PREP' && h.m.round === 7), 'reached PREP R7');
  h.flushAll();
  assert.ok(!phases.has(`1:${'HEX_DRAFT'}`), 'R1 draws nothing at all');
  assert.ok(phases.has(`6:${'SP_DRAFT'}`), 'R6 机变 is NOT swallowed by the empty 海克斯 pool');
  assert.equal(h.m.enemyHexes.length, 0, 'no enemy hex either');
  // the unchanged schedule is what keeps this honest
  assert.deepEqual(h.m.gd.hexRounds(), DATA.hextech.format.rounds);
  h.m.dispose();
});

test('the effects column carries the rarity tier of a 协议源石 effect (the card face, §29)', () => {
  const h = makeMatch({ mode: 'coop', difficulty: 'NORMAL', humans: 1, bots: 1, seed: 41, fake: true });
  h.start();
  toPrep(h, 1);
  const m = h.m;
  const ps = h.ps('p_0');
  // the roster is the source of the tier, and every rarity has a distinct one
  const byId = Object.fromEntries(m.gd.hexRarities().map((r) => [r.id, r]));
  assert.deepEqual([byId.silver.tier, byId.gold.tier, byId.prismatic.tier], [1, 2, 3]);
  assert.equal(m.gd.hexTier('gold'), 2);
  assert.equal(m.gd.hexTier('nope'), null);
  assert.equal(m.gd.hexTier(null), null);
  assert.equal(m.gd.hexTier(undefined), null);
  // a 协议源石 effect's view entry names its tier, so the client can draw hextech/tier/<tier>.png
  const own = ps.effects.find((e) => e.iconKind === 'hex');
  assert.ok(own, 'the R1 pick is an owned hex effect');
  const view = ps.effectsView().find((e) => e.id === own.id);
  assert.equal(view.iconKind, 'hex');
  assert.equal(view.tier, m.gd.hexTier(own.data.rarity), `${own.data.hexId} (${own.data.rarity})`);
  assert.ok([1, 2, 3].includes(view.tier));
  // a non-hex effect never carries a tier
  for (const e of ps.effectsView()) if (e.iconKind !== 'hex') assert.equal(e.tier, undefined, e.id);
  h.m.dispose();
});

test('the second batch: a team hex reaches teammates, 镜像协议 copies one of theirs, 二次抽取 adds two', () => {  const h = makeMatch({ mode: 'coop', difficulty: 'NORMAL', humans: 2, seed: 31, fake: true });
  h.start();
  toPrep(h, 1); // both seats answered the R1 draft, so each owns one hex
  const m = h.m;
  const p0 = h.ps('p_0');
  const p1 = h.ps('p_1');
  const owned = (ps) => ps.effects.filter((e) => typeof e.key === 'string' && e.key.startsWith('hex:')).map((e) => e.data.hexId);
  assert.equal(owned(p0).length, 1);
  assert.equal(owned(p1).length, 1);

  // 共鸣协议 (team: true): the picker AND the teammate end up owning it, each with its own EffectRef
  applyHex(m, p0, m.gd.hex('hex_resonance'));
  assert.ok(owned(p0).includes('hex_resonance'));
  assert.ok(owned(p1).includes('hex_resonance'), 'the teammate owns it too');
  assert.equal(owned(p1).filter((id) => id === 'hex_resonance').length, 1, 'exactly one ref per player (dedupe)');

  // 镜像协议: the pick itself plus one copy of a hex the teammate owns and the picker does not
  const before = owned(p0).length;
  const mine = new Set(owned(p0));
  applyHex(m, p0, m.gd.hex('hex_mirror'));
  assert.equal(owned(p0).length, before + 2, 'the pick + one copied hex');
  const copied = owned(p0).filter((id) => id !== 'hex_mirror' && !mine.has(id));
  assert.equal(copied.length, 1, `copied ${JSON.stringify(copied)}`);
  assert.ok(owned(p1).includes(copied[0]), 'the copy came from the teammate');

  // 二次抽取: the pick plus two more random hexes, and never itself again
  const beforeDouble = owned(p0).length;
  applyHex(m, p0, m.gd.hex('hex_double'));
  assert.equal(owned(p0).length, beforeDouble + 3, 'the pick + two extra hexes');
  assert.equal(owned(p0).filter((id) => id === 'hex_double').length, 1, 'the extra draw never re-grants itself');
  assert.equal(new Set(owned(p0)).size, owned(p0).length, 'no duplicate hex');
  h.invariants();
  m.dispose();
});

// Owner report 2026-10-12: 「镜像协议第一个选择时，当其他人没有协议源石时不生效。修改效果使其当之后可以获得别人的」 — the draft is
// PARALLEL, so the seat that answers first looked at an empty ally pool, copied nothing, and the card was dead for the
// rest of the match (the pick-time copy had no second chance). It is now ARMED and paid out the moment a teammate owns
// something copyable.

/** The 协议源石 ids a player owns. */
const mirrorOwned = (ps) => ps.effects.filter((e) => typeof e.key === 'string' && e.key.startsWith('hex:')).map((e) => e.data.hexId);
/** Drop every 协议源石 ref of a seat: the fixture starts from a known empty ally pool (R1 drafts one card each). */
const clearHexes = (ps) => { ps.effects = ps.effects.filter((e) => !(typeof e.key === 'string' && e.key.startsWith('hex:'))); };

test('镜像协议: a pick with no teammate-owned card is armed, not wasted, and pays out on the teammate’s later gain', () => {
  const h = makeMatch({ mode: 'coop', difficulty: 'NORMAL', humans: 2, seed: 31, fake: true });
  h.start();
  toPrep(h, 1);
  const m = h.m;
  const p0 = h.ps('p_0');
  const p1 = h.ps('p_1');
  // the teammate answers AFTER p_0 in the parallel draft: it owns nothing yet at p_0's pick
  clearHexes(p0);
  clearHexes(p1);
  assert.equal(mirrorOwned(p1).length, 0, 'premise: the teammate owns no 协议源石');

  applyHex(m, p0, m.gd.hex('hex_mirror'));
  assert.deepEqual(mirrorOwned(p0), ['hex_mirror'], 'the pick is owned, but there was nothing to copy yet');
  assert.equal(m.pendingMirror.length, 1, 'the copy is ARMED — the old code dropped it here');
  assert.equal(m.pendingMirror[0].pickerId, 'p_0');

  // the teammate gains a card afterwards ⇒ the armed copy pays out, from that teammate
  applyHex(m, p1, m.gd.hex('hex_stipend'));
  assert.deepEqual(mirrorOwned(p0).slice().sort(), ['hex_mirror', 'hex_stipend'], 'the copy landed once the teammate owned one');
  assert.ok(mirrorOwned(p1).includes('hex_stipend'), 'and the teammate keeps its own card');
  assert.equal(m.pendingMirror.length, 0, 'the arm is spent after it paid');
  // …and it pays exactly ONCE: a further teammate gain adds no second copy
  applyHex(m, p1, m.gd.hex('hex_bulwark'));
  assert.deepEqual(mirrorOwned(p0).slice().sort(), ['hex_mirror', 'hex_stipend'], 'no second copy');
  h.invariants();
  m.dispose();
});

// 业主 2026-10-27「ban 了的协议源石能被潘多拉摇出来」：禁用是「我的抽取跳过它」。潘多拉 / 二次抽取本身走
// `hexPoolFor`（已过滤禁用），但换牌之后可能给出【镜像协议】—— 而镜像协议挑的是**队友**的卡，原来完全不看我的
// 禁用列表，于是「我 ban 的卡」从这条边回到了我手上。现在它也跳过被禁用的 id。
test('镜像协议: 不复制自己 ban 掉的协议源石（业主 2026-10-27）', () => {
  const h = makeMatch({ mode: 'coop', difficulty: 'NORMAL', humans: 2, seed: 43, fake: true });
  h.start();
  toPrep(h, 1);
  const m = h.m;
  const p0 = h.ps('p_0');
  const p1 = h.ps('p_1');
  clearHexes(p0);
  clearHexes(p1);
  p0.hexBans = Object.freeze(['hex_bulwark']);   // 本房禁用的协议源石
  applyHex(m, p0, m.gd.hex('hex_mirror'));
  assert.equal(m.pendingMirror.length, 1, 'premise: 镜像协议已上膛');
  // 队友手里只有那张被 ban 的 ⇒ 复制不出来（旧的会直接复制过来）
  applyHex(m, p1, m.gd.hex('hex_bulwark'));
  assert.deepEqual(mirrorOwned(p0), ['hex_mirror'], '被 ban 的卡不会被复制过来');
  assert.equal(m.pendingMirror.length, 1, '还在等一张能复制的');
  // 队友再拿一张没被 ban 的 ⇒ 这次付得出
  applyHex(m, p1, m.gd.hex('hex_stipend'));
  assert.deepEqual(mirrorOwned(p0).slice().sort(), ['hex_mirror', 'hex_stipend'], '没被 ban 的照常复制');
  h.invariants();
  m.dispose();
});

// 同一个报告的正面回归：潘多拉自己走的是 `hexPoolFor`（bans + 专属），这条用例把「它确实不摇被 ban 的」钉住，
// 免得以后有人绕开 `hexPoolFor` 取池子。
test('潘多拉: 不会摇出被 ban 的协议源石（业主 2026-10-27）', () => {
  const h = makeMatch({ mode: 'solo', difficulty: 'NORMAL', humans: 1, seed: 47, fake: true });
  h.start();
  toPrep(h, 1);
  const m = h.m;
  const ps = h.ps('p_0');
  const bans = ['hex_artifactkit', 'hex_pandora', 'hex_echo'];
  ps.hexBans = Object.freeze(bans.slice());
  clearHexes(ps);
  applyHex(m, ps, m.gd.hex('hex_pandora'));
  const owned = mirrorOwned(ps);
  assert.ok(owned.length >= 1, `premise: 潘多拉换了牌 (${JSON.stringify(owned)})`);
  assert.deepEqual(owned.filter((id) => bans.includes(id)), [], '换出来的牌里没有一张是禁用的');
  assert.ok(!owned.includes('hex_pandora'), '连潘多拉自己也不会回来');
  h.invariants();
  m.dispose();
});

test('镜像协议: the arm is retried at the next round start, so an out-of-band teammate gain still pays out', () => {
  const h = makeMatch({ mode: 'coop', difficulty: 'NORMAL', humans: 2, seed: 37, fake: true });
  h.start();
  toPrep(h, 1);
  const m = h.m;
  const p0 = h.ps('p_0');
  const p1 = h.ps('p_1');
  clearHexes(p0);
  clearHexes(p1);
  applyHex(m, p0, m.gd.hex('hex_mirror'));
  assert.equal(m.pendingMirror.length, 1, 'premise: armed with nothing to copy');

  // the teammate owns a card now, but NOT through applyHex (so nothing resolves in between — the round start must)
  p1.effects.push({
    id: 'hex:hex_bulwark', key: 'hex:hex_bulwark', name: '坚壁', desc: '', iconKind: 'hex', counter: null,
    battle: false, params: {}, data: { hexId: 'hex_bulwark', rarity: 'silver' },
  });
  assert.deepEqual(mirrorOwned(p0), ['hex_mirror'], 'still just the pick before the round start');

  resolveMirrorCopies(m);
  assert.ok(mirrorOwned(p0).includes('hex_bulwark'), `the retry paid the armed copy out (${JSON.stringify(mirrorOwned(p0))})`);
  assert.equal(m.pendingMirror.filter((e) => e.pickerId === 'p_0').length, 0, 'the arm is spent');
  h.invariants();
  m.dispose();
});

test('镜像协议: solo (no teammate) stays armed harmlessly, and the pick itself still lands', () => {
  const h = makeMatch({ mode: 'solo', difficulty: 'NORMAL', humans: 1, seed: 41, fake: true });
  h.start();
  toPrep(h, 1);
  const m = h.m;
  const ps = h.ps('p_0');
  clearHexes(ps);
  applyHex(m, ps, m.gd.hex('hex_mirror'));
  assert.deepEqual(mirrorOwned(ps), ['hex_mirror'], 'the card is owned');
  assert.equal(m.pendingMirror.length, 1, 'armed: a teammate may still be found later (nobody left, so it just waits)');
  // a retry with the arm outstanding must not throw or invent a copy
  resolveMirrorCopies(m);
  assert.deepEqual(mirrorOwned(ps), ['hex_mirror'], 'no copy was invented');
  h.invariants();
  m.dispose();
});

test('虫群 (countAdd) also reaches the prep preview, so the round is never under-reported', () => {
  const h = makeMatch({ mode: 'coop', difficulty: 'NORMAL', humans: 1, bots: 1, seed: 77, fake: true });
  h.start();
  toPrep(h, 1);
  const m = h.m;
  const total = () => m.nextEnemiesFor(h.ps('p_0')).reduce((n, e) => n + (Number(e.count) || 0), 0);
  const before = total();
  assert.ok(before > 0, `the preview lists enemies (${before})`);
  m.enemyHexes = [{ id: 'ehex_swarm', round: 1 }];
  const withSwarm = total();
  assert.ok(withSwarm > before, `虫群 adds enemies to the preview (${before} → ${withSwarm})`);
  // the multiplier half rides along too (hpMul 0.92 × the wave's own scale), and the enemy owns it for the match
  assert.ok(Object.keys(enemyHexMods(m)).includes('countAdd'));
  h.invariants();
  m.dispose();
});

// ---- enemy verbs (DESIGN §29.10) ---------------------------------------------------------------------------------------

test('enemy verbs: newBattle attaches the enemy’s verb ids to EVERY field kind, and a mods-only card is never one', () => {
  const h = makeMatch({ mode: 'coop', difficulty: 'NORMAL', humans: 2, seed: 5, fake: false });
  h.start();
  h.toPrep(1);
  const m = h.m;
  // one verb card and one plain multiplier: only the verb may reach the battle flag
  m.enemyHexes = [{ id: 'ehex_ironwall' }, { id: 'ehex_corrode' }];
  assert.deepEqual(enemyVerbIds(m), ['ehex_ironwall'], 'only the verb card is a battle script');
  // record the flags the CONSTRUCTED battle ends up with (`newBattle` injects them internally, so the caller's opts
  // are pre-injection and would show nothing)
  const built = [];
  const orig = m.newBattle.bind(m);
  m.newBattle = (opts) => { const b = orig(opts); built.push({ kind: opts.kind, flags: b && b.flags }); return b; };
  h.setStage('act2autochess_m04');
  m._normalBattle(h.ps('p_0'));
  assert.ok(built.length >= 1, 'the normal field was built');
  for (const b of built) {
    assert.deepEqual(b.flags.enemyHexIds, ['ehex_ironwall'], `${b.kind}: the verb id is attached`);
  }
  h.invariants();
  m.dispose();
});

test('enemy verbs: the ids survive into the BattleSpec, so the client’s own simulation installs the same scripts', () => {
  // The client re-simulates from the spec and SP_VERIFY compares the digests, so a verb that ran on the server but not
  // in the browser (or vice versa) would be rejected. `flags` is the channel; confirm it serializes untouched.
  const h = makeBattle({
    flags: { enemyHexIds: ['ehex_ironwall', 'ehex_echo'] },
    players: [{ playerId: 'p1', seat: 0, side: 'L', colOffset: 0, bonds: {}, playerEffects: [], units: [] }],
    spawns: [], timeLimit: 30, recordEvents: false,
  });
  const spec = buildBattleSpec(h.battle);
  assert.deepEqual(spec.flags.enemyHexIds, ['ehex_ironwall', 'ehex_echo'], 'the flag round-trips through the spec');
  // and a battle rebuilt from that spec installs them again
  const back = createBattleFromSpec(spec, undefined, { logger: { warn() {}, error() {}, info() {}, log() {} } });
  assert.equal(back._enemyVerbsInstalled, true, 'the rebuilt battle installed the verbs');
});

// ---- third batch (0.3.0 playtest #3) ----------------------------------------------------------------------------------

test('因小失大: the pick shifts every bond’s member requirement (add-on +1, core −1)', () => {
  const h = makeMatch({ mode: 'coop', difficulty: 'NORMAL', humans: 1, bots: 1, seed: 41, fake: true });
  h.start();
  toPrep(h, 1);
  const m = h.m;
  const ps = h.ps('p_0');
  applyHex(m, ps, m.gd.hex('hex_pyrrhic'));
  assert.equal(ps.bondCountBonus.yanShip, -1, 'core bonds need one more member');
  assert.equal(ps.bondCountBonus.preciShip, 1, 'add-on bonds need one fewer');
  assert.equal(ps.bondCountBonus.maniShip ?? 0, 0, '调和 is left out');
  assert.equal(ps.bondCountBonus.soloShip ?? 0, 0, '独行 (exactly one) is left out');
  h.invariants();
  m.dispose();
});

test('整装待发: an operator carries three equipment, and the private view publishes the cap', () => {
  const h = makeMatch({ mode: 'solo', difficulty: 'NORMAL', seed: 43, fake: true });
  h.start();
  toPrep(h, 1);
  const m = h.m;
  const ps = h.ps('p_0');
  assert.equal(ps.equipCap(), m.gd.equipPerChess, 'the data cap without the hex');
  applyHex(m, ps, m.gd.hex('hex_fullkit'));
  assert.equal(ps.equipCap(), 3);
  assert.equal(ps.privateView().equipCap, 3);
  const itemIds = Object.values(DATA.items).filter((i) => i.itemType === 'EQUIP' && !i.isGolden && typeof i.kind === 'string' && !i.kind.startsWith('consume_on_equip')).slice(0, 3).map((i) => i.id);
  assert.equal(itemIds.length, 3, 'three equipment records exist');
  const carrierId = chessOfTier(1)[0];
  const tile = legalTileFor(m, ps, carrierId);
  const target = give(m, ps, carrierId, 'board', tile);
  assert.ok(target, 'the carrier is on the board');
  for (const id of itemIds) {
    const it = giveItem(m, ps, id);
    assert.ok(it, `gave ${id}`);
    assert.deepEqual(m.handle(ps.playerId, { t: 'g.equip', itemUid: it.uid, targetUid: target.uid }), { ok: true }, `equip ${id}`);
  }
  const loc = ps.find(target.uid);
  assert.equal(loc.piece.items.length, 3, 'all three stay equipped (no replace)');
  assert.equal(equipSlotsOf(ps, 2), 3);
  h.invariants();
  m.dispose();
});

test('装备转化: discarding an item refunds its price; the ownership predicates read the refs', () => {
  const h = makeMatch({ mode: 'solo', difficulty: 'NORMAL', seed: 47, fake: true });
  h.start();
  toPrep(h, 1);
  const m = h.m;
  const ps = h.ps('p_0');
  const itemId = Object.values(DATA.items).find((i) => i.itemType === 'EQUIP' && !i.isGolden).id;
  const before = ps.funds;
  const it = giveItem(m, ps, itemId);
  const price = m.gd.itemPrice(it.id);
  assert.deepEqual(m.handle(ps.playerId, { t: 'g.destroy', uid: it.uid }), { ok: true });
  assert.equal(ps.funds, before, 'no refund without the hex');
  applyHex(m, ps, m.gd.hex('hex_itemrefund'));
  assert.ok(ownsHex(ps, 'hex_itemrefund'));
  const it2 = giveItem(m, ps, itemId);
  assert.deepEqual(m.handle(ps.playerId, { t: 'g.destroy', uid: it2.uid }), { ok: true });
  assert.equal(ps.funds, before + price, 'the discarded item pays its price back');
  h.invariants();
  m.dispose();
});

test('孤注一掷: the ref carries the four-round expiry; 商店契约/盟约裂变/悬赏倍增 expose their numbers', () => {
  const h = makeMatch({ mode: 'coop', difficulty: 'NORMAL', humans: 1, bots: 1, seed: 53, fake: true });
  h.start();
  toPrep(h, 1);
  const m = h.m;
  const ps = h.ps('p_0');
  applyHex(m, ps, m.gd.hex('hex_allin'));
  const ref = ps.effects.find((e) => e.id === 'hex:hex_allin');
  assert.ok(ref, 'the ref exists');
  assert.equal(ref.battle, true);
  assert.deepEqual(ref.params.battle, { atkPct: 200 });
  assert.equal(ref.params.expireRound, m.round + 3, 'active in the pick round and the three after it');
  applyHex(m, ps, m.gd.hex('hex_bondfission'));
  assert.equal(bondCapOf(ps), 2);
  assert.equal(layerGainMulOf(ps, null), 3);
  applyHex(m, ps, m.gd.hex('hex_bountytriple'));
  assert.equal(bountyMultiplier(ps), 3);
  h.invariants();
  m.dispose();
});

test('every battle-side hex reaches the battle input (a ref addHexRef marks prep-only never runs — 装甲破坏)', () => {
  // Regression: addHexRef derived `battle` from `params.battle` alone, so the third batch's conditional passives
  // (装甲破坏 / 击倒馈赠 / 北境长城 / 精准穿透 / 深度吞噬 / 不屈余烬 / 技能层涌 / 盟约裂变 / 特质扩散) and 传承 — whose
  // battle part is accumulated later, on a sale — were stored with `battle: false` and dropped by battleInput. The cards
  // drafted, showed in the effects column, and did nothing in battle. test/sim/hextech-battle.test.js hand-built its
  // refs with `battle: true`, so it could not see this: the ones below are made by the REAL pick path.
  const h = makeMatch({ mode: 'coop', difficulty: 'NORMAL', humans: 1, bots: 1, seed: 71, fake: true });
  h.start();
  toPrep(h, 1);
  const m = h.m;
  const ps = h.ps('p_0');
  // every player hex whose mechanic the sim/content modules read off the ref (either the `battle` passive or the
  // ownership/conditional keys server/sim/content/hextech.js install() handles)
  const BATTLE_HEXES = [
    'hex_drill', 'hex_armor', 'hex_immortal', 'hex_vanguard', 'hex_allin',       // params.battle passives
    'hex_armorbreak', 'hex_killgift', 'hex_skillflow', 'hex_northwall', 'hex_precisionpen',
    'hex_deepdevour', 'hex_indomember', 'hex_bondfission', 'hex_traitspread',     // conditional / ownership-only
    'hex_heritage',                                                              // accumulates params.battle on a sale
    'hex_echoform', 'hex_serpentform',                                           // eighth batch: charges / battle-start kills
    // 业主 2026-10-26: 悬赏倍增 grew a battle half (对悬赏怪 +30% 伤害) — its `bountyDamage` spec key is in
    // BATTLE_SPEC_KEYS, so the ref has to reach the battle (before this it was prep-only: only `bountyMul`, settled).
    'hex_bountytriple',
    // 恶魔形态 is NOT here any more: its per-second ATK growth moved onto its equipment 恶魔之契 (items/protocol.js), so
    // the card itself is prep-only now (业主 2026-10-26).
  ];
  for (const id of BATTLE_HEXES) {
    applyHex(m, ps, m.gd.hex(id));
    const input = ps.battleInput();
    assert.ok(input.playerEffects.some((e) => e.data && e.data.hexId === id), `${id} must reach the battle`);
  }
  // …and the prep-only cards stay out (the flag still means something)
  // 业主 2026-10-26: the four equipment-granting cards, 心之钢 and 恶魔形态 are prep-only — their battle half is the
  // EQUIPMENT's (server/sim/content/items/protocol.js), so no ref has to reach a battle for them.
  for (const id of [
    'hex_stipend', 'hex_echo', 'hex_itemrefund', 'hex_fullkit', 'hex_mirror', 'hex_voidform',
    'hex_heavenform', 'hex_ghostform',
    'hex_canlight', 'hex_warding', 'hex_voidreturn', 'hex_corpsehill', 'hex_heartsteel', 'hex_demonform',
  ]) {
    applyHex(m, ps, m.gd.hex(id));
    const input = ps.battleInput();
    assert.ok(!input.playerEffects.some((e) => e.data && e.data.hexId === id), `${id} must stay in prep`);
  }
  h.invariants();
  m.dispose();
});

test('装甲破坏: the dice in a real pick+fight — allied physical hits shred DEF through the real battle input', () => {
  // the end-to-end shape of the regression above: the ref built by applyHex, fed to a real Battle, must shred DEF
  const h = makeMatch({ mode: 'coop', difficulty: 'NORMAL', humans: 1, bots: 1, seed: 73, fake: true });
  h.start();
  toPrep(h, 1);
  const m = h.m;
  const ps = h.ps('p_0');
  applyHex(m, ps, m.gd.hex('hex_armorbreak'));
  const marcher = () => enemyRec({ key: 'enemy_dummy', hp: 100000, atk: 1, def: 150, speed: 1 });
  const guard = () => chessRec({ id: 'test_guard', stats: { maxHp: 2000, atk: 500, def: 200, blockCnt: 1, respawnTime: 20 }, skill: null });
  const fight = (effects) => {
    const hb = makeBattle({
      defs: { chess: { test_guard: guard() }, enemies: { enemy_dummy: marcher() } },
      players: [{ playerId: 'p_0', seat: 0, side: 'L', colOffset: 0, bonds: {}, playerEffects: effects, units: [{ uid: 1, kind: 'chess', chessId: 'test_guard', row: 9, col: 6 }] }],
      enemies: [{ key: 'enemy_dummy', time: 0, route: 0 }], autoFinish: false, timeLimit: 20, hooks: ['hit'], captureNoisy: true,
    });
    assert.ok(hb.runUntil(() => hb.hooksOf('hit').length > 0, 20), 'the operator engaged (premise)');
    hb.run(4);
    const hits = hb.hooksOf('hit').filter((c) => c.source && c.source.side === 'ally' && c.target && c.target.side === 'enemy' && c.dmg && c.dmg.type === 'phys');
    return { def: hb.battle.enemies[0].s.def, hits: hits.length };
  };
  const plain = fight([]);
  const withHex = fight(ps.battleInput().playerEffects);
  assert.ok(withHex.hits > 0, 'the allies landed physical hits (premise)');
  assert.equal(withHex.def, plain.def - 20 * withHex.hits, `20 DEF per allied physical hit: ${plain.def} − 20×${withHex.hits}`);
  h.invariants();
  m.dispose();
});

test('盟约共鸣: adjacent operators share each other’s bonds for the count and in the battle input', () => {
  const h = makeMatch({ mode: 'solo', difficulty: 'FUNNY', seed: 59, fake: true });
  h.start();
  toPrep(h, 1);
  const m = h.m;
  const ps = h.ps('p_0');
  // two normal operators with disjoint, this-mode-active single bonds, side by side on the board
  const normals = Object.values(DATA.chess).filter((c) => c.chessId && !c.isGolden && Array.isArray(c.bonds) && c.bonds.length === 1 && !m.gd.modeInactiveBonds.has(c.bonds[0]));
  const a = normals[0];
  const b = normals.find((c) => c.bonds[0] !== a.bonds[0]);
  assert.ok(a && b, 'two single-bond operators exist');
  ps.board.clear();
  // a pair of adjacent legal tiles, one for each of the two operators
  const map = ps.deployMap();
  const canA = (r, c) => canPlace(map, placeClass(ps, ps.gd.chess(a.chessId)), r, c);
  const canB = (r, c) => canPlace(map, placeClass(ps, ps.gd.chess(b.chessId)), r, c);
  let t1 = null;
  let t2 = null;
  for (let r = 9; r <= 12 && !t1; r++) for (let c = 2; c <= 10 && !t1; c++) if (canA(r, c) && canB(r, c + 1)) { t1 = tileKey(r, c); t2 = tileKey(r, c + 1); }
  assert.ok(t1 && t2, 'two adjacent legal tiles exist');
  ps.board.set(t1, ps.newPiece('chess', a.chessId));
  ps.board.set(t2, ps.newPiece('chess', b.chessId));
  ps.recompute();
  const before = computeBonds(ps.gd, ps);
  assert.equal(before[a.bonds[0]].count, 1);
  assert.equal(before[b.bonds[0]].count, 1);
  applyHex(m, ps, m.gd.hex('hex_bondresonance'));
  const after = computeBonds(ps.gd, ps);
  assert.equal(after[a.bonds[0]].count, 2, `${a.bonds[0]} now counts the neighbour`);
  assert.equal(after[b.bonds[0]].count, 2, `${b.bonds[0]} now counts the neighbour`);
  // further apart: no sharing. A legal tile that is not orthogonally adjacent to the other operator
  const [t2r, t2c] = t2.split(',').map(Number);
  let far = null;
  for (let r = 9; r <= 12 && !far; r++) for (let c = 2; c <= 10 && !far; c++) if (canA(r, c) && (Math.abs(r - t2r) + Math.abs(c - t2c)) > 1) far = tileKey(r, c);
  assert.ok(far && far !== t1, 'a non-adjacent legal tile exists');
  const moved = ps.board.get(t1);
  ps.board.delete(t1);
  ps.board.set(far, moved);
  ps.recompute();
  const apart = computeBonds(ps.gd, ps);
  assert.equal(apart[b.bonds[0]].count, 1, 'not adjacent any more');
  // the battle input carries the grant for the sim (unitBonds reads it)
  ps.board.delete(far);
  ps.board.set(t1, moved);
  ps.recompute();
  const input = ps.battleInput();
  const unit = input.units.find((u) => u.chessId === a.chessId);
  assert.ok(unit.bonds && unit.bonds.includes(b.bonds[0]), 'the shared bond rides on the unit entry');
  assert.deepEqual(pieceBonds(ps.gd, { id: a.chessId, items: [] }), a.bonds, 'pieceBonds itself is unchanged');
  h.invariants();
  m.dispose();
});

test('盟约裂变: only the two bonds with the most layers stay active, and they gain ×3 layers', () => {
  const h = makeMatch({ mode: 'coop', difficulty: 'NORMAL', humans: 1, bots: 1, seed: 61, fake: true });
  h.start();
  toPrep(h, 1);
  const m = h.m;
  const ps = h.ps('p_0');
  const bonds = m.gd.bondIds.slice(0, 3);
  for (const [i, id] of bonds.entries()) { ps.layers[id] = 10 * (i + 1); ps.bondCountBonus[id] = 9; }
  ps.recompute();
  const all = bonds.filter((id) => ps.bonds[id].active);
  assert.equal(all.length, 3, 'all three are active before the pick');
  applyHex(m, ps, m.gd.hex('hex_bondfission'));
  const active = bonds.filter((id) => ps.bonds[id].active);
  assert.deepEqual(active.slice().sort(), [bonds[1], bonds[2]].sort(), 'the two with the most layers stay (20 / 30)');
  assert.equal(ps.bonds[bonds[0]].active, false, 'the 10-layer bond is suppressed');
  assert.equal(ps.bonds[bonds[0]].count > 0, true, 'it keeps its count for the views');
  // 叠层速度 +200 %: a 5-layer gain adds 15
  const before = ps.layers[bonds[2]];
  assert.equal(ps.addLayers(bonds[2], 5), 15);
  assert.equal(ps.layers[bonds[2]], before + 15);
  assert.equal(ps.addLayers(bonds[0], 5), 5, 'a suppressed bond gains normally');
  h.invariants();
  m.dispose();
});

// Player report (2026-10-12): 「道中如果叠了别的盟约且层数高于想开的盟约，下干员也无法激活」 — 坚守 100 layers, 灵巧 99,
// and putting the 灵巧 operators down still could not activate it. The keep-set used to be ranked on `ps.bonds`, which is
// the PREVIOUS post-suppression state (computeBonds assigns it only after it returns), so a bond the cap had switched off
// was filtered out of the ranking and could never come back — however many layers it held. It must rank the counts this
// recompute just produced.
test('盟约裂变: the keep-set is ranked on the fresh counts, so a suppressed bond can be swapped back in', () => {
  const h = makeMatch({ mode: 'coop', difficulty: 'NORMAL', humans: 1, bots: 1, seed: 61, fake: true });
  h.start();
  toPrep(h, 1);
  const m = h.m;
  const ps = h.ps('p_0');
  const bonds = m.gd.bondIds.slice(0, 4);
  for (const [i, id] of bonds.entries()) { ps.layers[id] = 40 - 10 * i; ps.bondCountBonus[id] = 9; }
  ps.recompute();
  applyHex(m, ps, m.gd.hex('hex_bondfission'));
  assert.deepEqual(bonds.filter((id) => ps.bonds[id].active).sort(), [bonds[0], bonds[1]].sort(), 'the top two stay (40 / 30)');
  assert.equal(ps.bonds[bonds[2]].active, false, 'the 20-layer bond is suppressed (premise)');
  assert.equal(ps.bonds[bonds[3]].active, false, 'so is the 10-layer one (premise)');
  // the player now abandons the 40-layer bond's operators and stacks the bond the cap had switched off: it holds by far
  // the most layers, and the suppressed pair both have a count again (3 candidates for 2 slots)
  ps.layers[bonds[2]] = 100;
  ps.bondCountBonus[bonds[0]] = 0;
  ps.recompute();
  assert.equal(ps.bonds[bonds[0]].active, false, 'the abandoned bond really did leave');
  assert.equal(ps.bonds[bonds[2]].active, true, 'the 100-layer bond takes a slot — it is not stuck suppressed');
  assert.equal(ps.bonds[bonds[1]].active, true, 'and the 30-layer bond keeps the other');
  assert.equal(ps.bonds[bonds[3]].active, false, 'the 10-layer bond is the one the cap drops');
  h.invariants();
  m.dispose();
});

// ---- sixth batch (the owner's list of 2026-10-11) --------------------------------------------------------------

test('债务: the teammate gains 3 funds and a watcher; their purchase grants the picker an identical operator', () => {
  const h = makeMatch({ mode: 'coop', difficulty: 'NORMAL', humans: 2, bots: 0, seed: 71, fake: true });
  h.start();
  toPrep(h, 1);
  const m = h.m;
  const p0 = h.ps('p_0');
  const p1 = h.ps('p_1');
  const f0 = p0.funds;
  const f1 = p1.funds;
  applyHex(m, p0, m.gd.hex('hex_debt'));
  assert.equal(p0.funds, f0, 'the picker pays nothing');
  assert.equal(p1.funds, f1 + 3, 'the only living teammate gets +3 (the card’s own number)');
  const watcher = p1.effects.find((e) => e.key === 'effect:hexdebt');
  assert.ok(watcher, 'the watcher sits on the BUYER (the dispatcher only runs a player’s own effects)');
  assert.equal(watcher.params.ownerId, 'p_0', 'and names the picker');
  assert.equal(watcher.params.untilRound, m.round + 2, '3 rounds, the pick’s own round counted first');

  const id = chessOfTier(1)[0];
  assert.ok(id, 'a tier-1 operator to buy');
  const held = () => p0.hand.some((x) => x && x.id === id) || p0.temp.some((x) => x && x.id === id);
  assert.equal(held(), false, 'premise: p_0 does not hold it yet');
  m.dispatch(p1, 'onBuy', { piece: { id, uid: 9999 }, slot: null, price: 1, kind: 'chess' });
  assert.equal(held(), true, 'p_0 was granted the identical operator');
  h.invariants();
  m.dispose();
});

test('债务: the grant only answers OPERATOR purchases, and only inside the window', () => {
  const h = makeMatch({ mode: 'coop', difficulty: 'NORMAL', humans: 2, bots: 0, seed: 72, fake: true });
  h.start();
  toPrep(h, 1);
  const m = h.m;
  const p0 = h.ps('p_0');
  const p1 = h.ps('p_1');
  applyHex(m, p0, m.gd.hex('hex_debt'));
  const watcher = p1.effects.find((e) => e.key === 'effect:hexdebt');
  const id = chessOfTier(1)[0];
  const held = () => p0.hand.some((x) => x && x.id === id) || p0.temp.some((x) => x && x.id === id);
  // an ITEM purchase is not 干员
  m.dispatch(p1, 'onBuy', { piece: { id: 'not-a-chess', uid: 1 }, slot: null, price: 1, kind: 'item' });
  assert.equal(held(), false, 'no grant for an item');
  // a lapsed window: nothing is granted and the watcher removes itself
  watcher.params.untilRound = m.round - 1;
  m.dispatch(p1, 'onBuy', { piece: { id, uid: 9999 }, slot: null, price: 1, kind: 'chess' });
  assert.equal(held(), false, 'no grant after the window');
  assert.equal(p1.effects.some((e) => e.key === 'effect:hexdebt'), false, 'the watcher cleaned itself up');
  h.invariants();
  m.dispose();
});

test('债务: solo (no living teammate) pays the player itself and watches nobody', () => {
  const h = makeMatch({ mode: 'solo', difficulty: 'NORMAL', humans: 1, bots: 0, seed: 73, fake: true });
  h.start();
  toPrep(h, 1);
  const m = h.m;
  const ps = h.ps('p_0');
  const before = ps.funds;
  applyHex(m, ps, m.gd.hex('hex_debt'));
  assert.equal(ps.funds, before + 3, 'the first half falls on the player itself');
  assert.equal(ps.effects.some((e) => e.key === 'effect:hexdebt'), false, 'no watcher with nobody to watch');
  h.invariants();
  m.dispose();
});

// =====================================================================================================================
// eighth batch (the owner's list of 2026-10-12, §29.23)

/** A started solo match at R1 with a clean prep, the four prep-side cards' shared fixture. */
function solo1(seed) {
  const h = makeMatch({ mode: 'solo', difficulty: 'NORMAL', humans: 1, bots: 0, seed, fake: true });
  h.start();
  toPrep(h, 1);
  return { h, m: h.m, ps: h.ps('p_0') };
}

test('虚空形态: the pick empties the purse, and the round after it refunds exactly one spend', () => {
  const { h, m, ps } = solo1(101);
  ps.funds = 20;
  applyHex(m, ps, m.gd.hex('hex_voidform'));
  assert.equal(ps.funds, 0, 'the pick takes every coin');
  assert.equal(ps.counters['hex:hex_voidform:freeSpend'], 0, 'and the pick’s own round is not armed');
  assert.equal(ps.counters['hex:hex_voidform:pickRound'], m.round, 'the pick remembers which round it happened in');
  m.dispatch(ps, 'onRoundStart', { round: 2 });
  assert.equal(ps.counters['hex:hex_voidform:freeSpend'], 1, 'the round after the pick arms the free spend');
  ps.funds = 10;
  ps.spend(3); ps._afterSpend(3, 'refresh');
  assert.equal(ps.funds, 10, 'the first spend of that round costs nothing');
  ps.spend(3); ps._afterSpend(3, 'refresh');
  assert.equal(ps.funds, 7, 'the second one is paid in full');
  m.dispatch(ps, 'onRoundStart', { round: 3 });
  ps.spend(2); ps._afterSpend(2, 'buy');
  assert.equal(ps.funds, 7, 'a new round re-arms it');
  h.invariants();
  m.dispose();
});

test('天人形态: free 调度中心 levels at each PREP start, the grant growing by one every round (1, 2, 3 …)', () => {
  const { h, m, ps } = solo1(103);
  ps.funds = 0;
  const lv0 = ps.shop.level;
  const cap = m.gd.maxShopLevel;
  applyHex(m, ps, m.gd.hex('hex_heavenform'));
  m.dispatch(ps, 'onPrepStart', { round: 2 });
  assert.equal(ps.shop.level, Math.min(cap, lv0 + 1), 'the first grant is one level');
  assert.equal(ps.funds, 0, 'and the card paid for it');
  m.dispatch(ps, 'onPrepStart', { round: 3 });
  assert.equal(ps.shop.level, Math.min(cap, lv0 + 3), 'the second grant is two levels');
  m.dispatch(ps, 'onPrepStart', { round: 4 });
  assert.equal(ps.shop.level, Math.min(cap, lv0 + 6), 'the third is three');
  assert.equal(ps.funds, 0, 'still free throughout');
  h.invariants();
  m.dispose();
});

test('恶魔形态: the takeover buys 调度中心 levels and spends through the AI', () => {
  const { h, m, ps } = solo1(107);
  ps.funds = 40;
  const lv0 = ps.shop.level;
  const spent0 = ps.stats.gold;
  applyHex(m, ps, m.gd.hex('hex_demonform'));
  // the hook is the PREP start (the owner's report of 2026-10-12): every action the takeover takes is phase-gated,
  // and onRoundStart runs while the match is still in ROUND_START
  assert.equal(ps.shop.level, lv0, 'nothing at the pick itself');
  m.dispatch(ps, 'onRoundStart', { round: 2 });
  assert.equal(ps.shop.level, lv0, 'and nothing at a round start — the card no longer listens there');
  m.dispatch(ps, 'onPrepStart', { round: 2 });
  assert.ok(ps.shop.level > lv0, `the AI levelled the 调度中心 (${lv0} → ${ps.shop.level})`);
  assert.ok(ps.stats.gold > spent0, 'and it spent real gold doing it');
  // the card's own prep counter is what makes it every OTHER prep
  assert.equal(ps.counters['hex:hex_demonform:preps'], 1, 'the first prep start fired');
  const lv1 = ps.shop.level;
  m.dispatch(ps, 'onPrepStart', { round: 3 });
  assert.equal(ps.counters['hex:hex_demonform:preps'], 2, 'the second one was skipped');
  assert.equal(ps.shop.level, lv1, 'so the 调度中心 did not move');
  h.invariants();
  m.dispose();
});

test('恶魔形态: in a REAL match the takeover runs at the next round’s prep start (owner report 2026-10-12)', () => {
  const h = makeMatch({ mode: 'solo', difficulty: 'NORMAL', humans: 1, bots: 0, seed: 107, fake: true });
  h.start();
  h.autoHumans();
  toPrep(h, 1);
  const m = h.m;
  const ps = h.ps('p_0');
  ps.funds = 60;
  applyHex(m, ps, m.gd.hex('hex_demonform'));
  const lv0 = ps.shop.level;
  const buys0 = ps.stats.buys;
  h.drive(() => h.ended != null || (m.round === 2 && m.phase === 'PREP'));
  assert.equal(m.round, 2, 'the match reached R2’s prep');
  assert.ok(ps.shop.level > lv0 || ps.stats.buys > buys0, `the AI acted at the prep start (level ${lv0} → ${ps.shop.level}, buys ${buys0} → ${ps.stats.buys})`);
  m.dispose();
});

test('群蛇形态: a sale banks half an enemy, and the battle it arms spends the whole ones', () => {
  const { h, m, ps } = solo1(109);
  applyHex(m, ps, m.gd.hex('hex_serpentform'));
  for (let i = 0; i < 5; i++) m.dispatch(ps, 'onSold', { piece: { kind: 'chess', id: 'test' }, gain: 1 });
  assert.equal(ps.counters['hex:hex_serpentform:serpent'], 2.5, 'five sales bank 2.5 enemies');
  const input = ps.battleInput();
  m.dispatch(ps, 'onBattleStart', { input, kind: 'normal', round: m.round, spawns: [] });
  const killsOf = (i) => {
    const ref = i.playerEffects.find((e) => e.data && e.data.hexId === 'hex_serpentform');
    return ref && ref.params && ref.params.serpentKills ? ref.params.serpentKills.count : null;
  };
  assert.equal(killsOf(input), 2, 'two whole points → two enemies killed at the battle’s start');
  assert.equal(ps.counters['hex:hex_serpentform:serpent'], 0.5, 'and the halves stay banked');
  const input2 = ps.battleInput();
  m.dispatch(ps, 'onBattleStart', { input: input2, kind: 'normal', round: m.round, spawns: [] });
  assert.equal(killsOf(input2), 0, 'no whole point in the bank ⇒ nothing killed (no stale count)');
  h.invariants();
  m.dispose();
});

test('幽魂形态: the pick grants the remake’s own 幽魂 equipment through the real pick path', () => {
  const { h, m, ps } = solo1(113);
  applyHex(m, ps, m.gd.hex('hex_ghostform'));
  const held = [...(ps.hand || []), ...(ps.temp || [])].filter((p) => p && p.kind === 'item' && p.id === 'chess_item_9_90_e_a');
  // 业主 2026-10-24:「发两件」 → two copies arrive on the pick.
  assert.equal(held.length, 2, 'exactly two 幽魂 arrive (the hand, or the overflow temp)');
  const rec = m.gd.item('chess_item_9_90_e_a');
  assert.equal(rec.name, '幽魂');
  assert.equal(rec.shopExcluded, true, 'the shop never offers it');
  assert.equal(rec.mergeable, false, 'and it never merges');
  assert.equal(rec.params.dmgCap, 100, 'the cap the battle behaviour reads');
  // the item reaches a battle through the ITEM, not through the hex ref (the card has no battle part)
  assert.equal(ownsHex(ps, 'hex_ghostform'), true);
  const input = ps.battleInput();
  assert.ok(!input.playerEffects.some((e) => e.data && e.data.hexId === 'hex_ghostform'), 'the card itself stays in prep');
  h.invariants();
  m.dispose();
});

test('a later pick never re-runs an owned card’s immediate part (owner report 2026-10-12)', () => {
  // `applyHex` re-dispatches `onHexPick` to every OTHER persistent effect (so garrisons / items / bands can observe the
  // pick), and every hex handler carries an `onHexPick`: without the own-pick guard in handlerOf(), each owned card
  // re-ran its `onPick` on every later pick — 「获得幽魂形态后，每获得一个协议源石都会再给一个装备幽魂」.
  const { h, m, ps } = solo1(127);
  const ghosts = () => [...(ps.hand || []), ...(ps.temp || [])].filter((p) => p && p.kind === 'item' && p.id === 'chess_item_9_90_e_a').length;
  applyHex(m, ps, m.gd.hex('hex_ghostform'));
  assert.equal(ghosts(), 2, 'the pick itself grants two 幽魂 (业主 2026-10-24)');
  const funds = ps.funds;
  applyHex(m, ps, m.gd.hex('hex_stipend'));
  assert.equal(ghosts(), 2, 'gaining another card does not hand out another pair of 幽魂');
  applyHex(m, ps, m.gd.hex('hex_bulwark'));
  assert.equal(ps.funds, funds + 3, 'and 战备津贴 paid at its own pick only — never once per later pick');
  h.invariants();
  m.dispose();
});

// =====================================================================================================================
// §29.32 (the owner's report of 2026-10-13): 后勤整备 granted nothing at all, 恶魔形态 sold the owner's operators and
// stalled on 调度中心 levels. Both run through the REAL match path here, which is what the fake-ctx ladder test in
// test/content/hextech.test.js cannot see.

test('后勤整备: the pick grants a Tier-1 进阶 (golden) item and the ladder climbs one tier every 2 rounds', () => {
  const { h, m, ps } = solo1(211);
  /** The 进阶装备 this player holds right now (hand + overflow temp). */
  const goldens = () => [...(ps.hand || []), ...(ps.temp || [])].filter((p) => p && p.kind === 'item' && m.gd.isGolden(p.id));
  /** Their tiers, ascending — the hand keeps the newest first, so order is not the assertion. */
  const tiers = () => goldens().map((p) => m.gd.tierOf(p.id)).sort((a, b) => a - b);
  applyHex(m, ps, m.gd.hex('hex_logistics'));
  assert.deepEqual(tiers(), [1], 'the pick itself grants one 1阶 进阶装备 (it used to grant nothing: gd.goldenIdOf never resolved an ITEM id)');
  assert.equal(ps.counters['hex:hex_logistics:goldenTier'], 1, 'the ladder remembers the tier it granted');
  m.dispatch(ps, 'onRoundStart', { round: 3 });
  assert.deepEqual(tiers(), [1, 2], 'the first due round start grants one tier above the last one');
  m.dispatch(ps, 'onRoundStart', { round: 4 });
  assert.deepEqual(tiers(), [1, 2], 'the interleaved round is what `everyRounds: 2` skips');
  assert.equal(ps.counters['hex:hex_logistics:goldenTier'], 2, 'and a skipped round does not move the ladder');
  m.dispatch(ps, 'onRoundStart', { round: 5 });
  assert.deepEqual(tiers(), [1, 2, 3], 'the next due round climbs a second time');
  h.invariants();
  m.dispose();
});

test('恶魔形态: the pick grants 恶魔之契, and the takeover never sells an operator the player owns (§29.32)', () => {
  const { h, m, ps } = solo1(213);
  applyHex(m, ps, m.gd.hex('hex_demonform'));
  const held = [...(ps.hand || []), ...(ps.temp || [])].filter((p) => p && p.kind === 'item' && p.id === 'chess_item_9_91_e_a');
  assert.equal(held.length, 1, 'exactly one 恶魔之契 arrives (the hand, or the overflow temp)');
  const rec = m.gd.item('chess_item_9_91_e_a');
  assert.equal(rec.name, '恶魔之契');
  assert.equal(rec.shopExcluded, true, 'the shop never offers it');
  assert.equal(rec.mergeable, false, 'and it never merges');
  // 业主 2026-10-26「所有协议装备都依靠对应的协议源石生效的bug这个还没修」: the per-second growth is the EQUIPMENT's
  // (server/sim/content/items/protocol.js), so the card no longer needs to reach a battle at all — the item alone decides
  // who grows, which is what makes 神器整备's / the workshop's 恶魔之契 work.
  const input = ps.battleInput();
  assert.equal(input.playerEffects.find((e) => e.data && e.data.hexId === 'hex_demonform'), undefined,
    'the 恶魔形态 ref stays in prep: its battle half moved onto 恶魔之契');
  const demon = m.gd.hex('hex_demonform');
  assert.equal(demon.effect.onPick.item.id, 'chess_item_9_91_e_a', 'the pick hands out the equipment that fights');
  assert.equal(demon.effect.onPrepStart.demonTakeover, true, 'and the prep takeover stays the card’s own half');

  // A FULL hand is what used to make the takeover shed the owner's weakest bench piece. Fill every free slot, then run
  // the takeover: nothing may be sold, and nothing may arrive either (every purchase needs a free slot, and no pair
  // merges — the pieces are distinct singles).
  for (const id of chessOfTier(1).slice(0, ps.hand.filter((x) => x == null).length)) give(m, ps, id, 'hand');
  assert.equal(ps.hand.filter(Boolean).length, m.gd.benchSize, 'the hand is full (premise)');
  const owned = ps.allChess().map((p) => `${p.uid}:${p.id}`).sort();
  ps.funds = 40;
  const sold0 = ps.stats.sells;
  m.dispatch(ps, 'onPrepStart', { round: 2 });
  assert.equal(ps.stats.sells, sold0, 'the takeover never sells (it used to shed the weakest hand piece)');
  assert.deepEqual(ps.allChess().map((p) => `${p.uid}:${p.id}`).sort(), owned, 'and every owned operator is still there');
  assert.ok(ps.shop.level > 1, 'it still levelled the 调度中心, as the card says');
  h.invariants();
  m.dispose();
});

test('恶魔形态: a takeover with barely enough funds levels the 调度中心 instead of only buying (§29.32)', () => {
  const { h, m, ps } = solo1(217);
  applyHex(m, ps, m.gd.hex('hex_demonform'));
  // the purse holds the upgrade plus the one-operator floor and nothing more: the ordinary bot routine's `funds >=
  // price + 14` / full-board gates would leave the level alone and buy operators instead (the owner's report)
  const lv0 = ps.shop.level;
  ps.funds = Math.max(0, ps.shop.upgradePrice) + 2;
  m.dispatch(ps, 'onPrepStart', { round: 2 });
  assert.equal(ps.shop.level, lv0 + 1, `the takeover spent the funds on the 调度中心 (${lv0} → ${ps.shop.level})`);
  h.invariants();
  m.dispose();
});

test('恶魔形态: 「有钱就升」 — the takeover spends the last coin on the 调度中心 and holds nothing back (§29.39)', () => {
  // The owner's instruction of 2026-10-14: the level-up is no longer reserved against (it used to hold 2 funds back,
  // the cheapest operator). A purse of exactly the upgrade price must therefore buy the level and end at 0 funds — the
  // old `funds >= price + TAKEOVER_OPERATOR_FLOOR` gate left the level alone and the money on the table.
  const { h, m, ps } = solo1(219);
  applyHex(m, ps, m.gd.hex('hex_demonform'));
  const lv0 = ps.shop.level;
  const price = Math.max(0, ps.shop.upgradePrice);
  assert.ok(price > 0, 'the upgrade costs something at this level (premise)');
  ps.funds = price;
  m.dispatch(ps, 'onPrepStart', { round: 2 });
  assert.equal(ps.shop.level, lv0 + 1, `an exactly-affordable upgrade was taken (${lv0} → ${ps.shop.level})`);
  assert.equal(ps.funds, 0, 'and the whole purse went into it — nothing is held back for an operator');
  h.invariants();
  m.dispose();
});

// =====================================================================================================================
// §29.34 (the owner's own list of 2026-10-13): the eleven batch's prep-side cards through the REAL match path.

test('转职大师 / 赌狗大师 / 人力部资源 / 博士投影: the four item grants land through the real shared pool', () => {
  const { h, m, ps } = solo1(139);
  const held = (id) => [...(ps.hand || []), ...(ps.temp || [])].filter((p) => p && p.kind === 'item' && p.id === id).length;
  const cases = [
    ['hex_mastermorph', 'chess_item_6_09_e_a', 3], // 变形同构体 (转职球), tier 6, pool 3 — the card takes all three
    ['hex_mastergamble', 'chess_item_5_05_e_a', 2], // 拟态物质
    ['hex_hrsupply', 'chess_item_6_08_e_a', 1], // 人事部文档
    ['hex_docproject', 'chess_item_5_06_e_a', 1], // 博士投影
  ];
  for (const [hexId, itemId, n] of cases) {
    const rec = m.gd.item(itemId);
    assert.ok(rec, `${itemId} exists`);
    applyHex(m, ps, m.gd.hex(hexId));
    assert.equal(held(itemId), n, `${hexId} grants ${n} × ${itemId}`);
  }
  h.invariants();
  m.dispose();
});

test('升级刷新: the refresh costs 2, the private view agrees, and a 1-fund purse cannot pay it', () => {
  const { h, m, ps } = solo1(149);
  const base = ps.refreshPriceNow();
  assert.equal(base, m.gd.refreshPrice, 'without the card the mode price');
  applyHex(m, ps, m.gd.hex('hex_upgraderefresh'));
  assert.equal(ps.refreshPriceNow(), 2, 'the card overrides the price');
  assert.equal(ps.privateView().shop.refreshPrice, 2, 'and the client is told the same number');
  ps.funds = 1;
  assert.equal(ps.refresh().error, 'NO_FUNDS', '1 fund cannot pay 2');
  ps.funds = 2;
  assert.deepEqual(ps.refresh(), { ok: true });
  assert.equal(ps.funds, 0, 'exactly 2 paid');
  h.invariants();
  m.dispose();
});

test('电表倒转·改: a free slot costs nothing, and a REAL buy spends no funds', () => {
  const { h, m, ps } = solo1(151);
  ps.rollShop();
  const n = ps.freeShopChess();
  assert.ok(n > 0, `${n} chess slots were marked free`);
  const chess = ps.shop.slots.filter((s) => s && s.kind === 'chess' && !s.sold);
  for (const s of chess) assert.equal(ps.priceOf(s), 0, 'every operator of this refresh is free');
  const idx = ps.shop.slots.indexOf(chess[0]);
  ps.funds = 5;
  assert.deepEqual(m.handle('p_0', { t: 'g.buy', slot: idx }), { ok: true });
  assert.equal(ps.funds, 5, 'the buy cost nothing');
  // the next refresh re-rolls the slot objects, so the flag can never outlive its own refresh
  ps.rollShop();
  for (const s of ps.shop.slots) if (s && s.kind === 'chess') assert.ok(ps.priceOf(s) >= 0 && s.free !== true, 'a fresh roll carries no free flag');
  h.invariants();
  m.dispose();
});

test('圣约回响: bond-layer milestones read a +50 % VIEW — 远见 latches its 150-layer tier at 100 stored layers', () => {
  const { h, m, ps } = solo1(311);
  // 远见 must be ACTIVE for its milestones to run at all: two members are enough (thresholds [2], BOARD_AND_DECK)
  give(m, ps, 'chess_char_3_03_a', 'temp', 0);
  give(m, ps, 'chess_char_3_14_a', 'temp', 1);
  ps.recompute();
  assert.equal(ps.bonds.visiShip.active, true, 'premise: 远见 is active');
  /** Latch 远见's discount tier from the current layers (the milestone reads `ctx.layers`). */
  const latch = () => {
    ps.counters['bondaddon:visi:disc'] = 0;
    m.dispatch(ps, 'onRoundStart', { round: 2 });
    return ps.counters['bondaddon:visi:disc'];
  };
  ps.layers.visiShip = 100;
  assert.equal(latch(), 1, '100 stored layers reach the 80-layer milestone only');
  applyHex(m, ps, m.gd.hex('hex_covenantecho'));
  assert.equal(bondLayerViewMulOf(ps), 1.5, 'the card scales the layer VIEW');
  ps.layers.visiShip = 100;
  assert.equal(ps.layers.visiShip, 100, 'premise: the stored layers are the real ones');
  assert.equal(latch(), 2, '100 × 1.5 = 150 reaches the 150-layer milestone');
  assert.equal(ps.layers.visiShip, 100, 'and the stored layers never moved (the card is a view)');
  h.invariants();
  m.dispose();
});

// 业主 report 2026-10-14: 「均衡盟约不应该均衡绝技和独行这种层数没意义的」 — the card used to set EVERY active bond to the
// average, including the bonds.json `noStack` ones (独行 / 绝技 / 调和 / 协防干员) whose layer count the game never shows and
// no rule ever reads. They were trivially active next to a real layer bond, so they took most of the pool AND banked a
// number the player can neither see nor spend. This drives the real card through the real round start.
test('均衡盟约: the noStack bonds are left out of the redistribution, and the layer bonds split only their own total', () => {
  const { h, m, ps } = solo1(409);
  // The four bonds are made active through the same per-bond count bonus the 盟约裂变 test uses (the pieces themselves
  // are irrelevant here): 独行 is a DOWNWARD bond (active only while the count is exactly 1, so it needs bonus 1), the
  // other three are ordinary upward thresholds.
  ps.bondCountBonus.soloShip = 1;
  ps.bondCountBonus.suntShip = 2;
  ps.bondCountBonus.preciShip = 2;
  ps.bondCountBonus.swiftShip = 2;
  ps.recompute();
  assert.equal(ps.bonds.soloShip.active, true, 'premise: 独行 is active');
  assert.equal(ps.bonds.suntShip.active, true, 'premise: 绝技 is active');
  assert.equal(ps.bonds.preciShip.active, true, 'premise: 精准 is active');
  assert.equal(ps.bonds.swiftShip.active, true, 'premise: 迅捷 is active');
  for (const id of ['soloShip', 'suntShip']) assert.equal(m.gd.bond(id).noStack, true, `premise: ${id} shows no layers`);
  // give every active bond layers: the two noStack ones hold a lot, the two layer bonds hold 20 + 10
  ps.layers.soloShip = 40;
  ps.layers.suntShip = 30;
  ps.layers.preciShip = 20;
  ps.layers.swiftShip = 10;
  ps.recompute();
  applyHex(m, ps, m.gd.hex('hex_bondequalize'));
  m.dispatch(ps, 'onRoundStart', { round: 2 });
  assert.equal(ps.layers.preciShip, 15, 'the layer bonds split their own 30 (20 + 10) in two');
  assert.equal(ps.layers.swiftShip, 15, '向上取整 leaves 15 here too');
  assert.equal(ps.layers.soloShip, 40, '独行 keeps the layers it had — the card never touches it');
  assert.equal(ps.layers.suntShip, 30, '绝技 keeps the layers it had');
  h.invariants();
  m.dispose();
});

// 业主 report 2026-10-15: 「盟约寄生会在点击干员后多次触发」. Opening an own operator's detail card in PREP asks the server
// for its start-of-battle stats (g.unitStats → intents.js _unitStatsOf), which dispatches the real onBattleStart handlers
// with `preview: true`. 群蛇形态 spent its whole banked point counter on the first one. docs/META.md states the contract
// ("with ev.preview true a handler must NOT change match state or draw match rng"); the dispatcher enforces it.
// (盟约寄生 no longer has a battle-start half — 业主 2026-10-21 moved it to the round start; its own test follows.)
test('the stats preview runs the battle-start cards without changing the match (群蛇形态)', () => {
  const { h, m, ps } = solo1(733);
  applyHex(m, ps, m.gd.hex('hex_serpentform'));
  ps.counters['hex:hex_serpentform:serpent'] = 3; // two banked enemies at 0.5 each
  ps.recompute();
  const bankedBefore = ps.counters['hex:hex_serpentform:serpent'];
  assert.equal(bankedBefore, 3, 'premise: 群蛇形态 has banked points');
  // ask for the stats three times, exactly as the client does while the card stays open
  for (let i = 0; i < 3; i++) {
    m._unitStatsCache = null;
    assert.deepEqual(m.handle('p_0', { t: 'g.unitStats', seq: i }), { ok: true });
  }
  assert.equal(ps.counters['hex:hex_serpentform:serpent'], bankedBefore, '群蛇形态 spends nothing on a preview');
  // the REAL battle start (no preview flag) cashes the bank in, once
  const realInput = ps.battleInput({ side: 'L', colOffset: 0 });
  const realEv = { input: realInput, kind: 'normal', round: m.round, spawns: [] };
  m.dispatch(ps, 'onBattleStart', realEv);
  assert.equal(ps.counters['hex:hex_serpentform:serpent'], 0, '群蛇形态 cashes its 3 points in');
  h.invariants();
  m.dispose();
});

test('盟约寄生 (rework): the picker gets an even share of the teammate’s NEW layers each round', () => {
  const h = makeMatch({ mode: 'coop', difficulty: 'NORMAL', humans: 2, bots: 0, seed: 77, fake: true });
  h.start();
  toPrep(h, 1);
  const m = h.m;
  const a = h.ps('p_0');
  const b = h.ps('p_1');
  // the picker fields three 炎 operators, so 炎 is the one active stackable bond they own
  give(m, a, 'chess_char_1_03_a', 'board', [9, 3]);
  give(m, a, 'chess_char_2_04_a', 'board', [9, 4]);
  give(m, a, 'chess_char_3_03_a', 'board', [9, 5]);
  a.recompute();
  assert.equal(a.bonds.yanShip?.active, true, 'premise: 炎 is active');
  applyHex(m, a, m.gd.hex('hex_bondparasite'));
  const ref = a.effects.find((e) => e && e.key === 'hex:hex_bondparasite');
  assert.ok(ref, 'the pick created the ref');
  const parasite = ref.params.parasite;
  assert.equal(typeof parasite.partnerId, 'string', 'a random living teammate was chosen');
  assert.notEqual(parasite.partnerId, 'p_0');
  assert.equal(parasite.baseline, 0, 'the baseline is the teammate’s layers at pick time');
  // the teammate gains 7 layers of a stackable bond; the picker owns ONE active stackable bond ⇒ ceil(7 / 1) = 7
  const partner = m.players.get(parasite.partnerId);
  partner.layers.yanShip = 7;
  partner.recompute();
  const before = a.layers.yanShip || 0;
  m.dispatch(a, 'onRoundStart', { round: 2 });
  assert.equal((a.layers.yanShip || 0) - before, 7, 'the only active stackable own bond takes the whole delta');
  assert.equal(ref.params.parasite.baseline, 7, 'the new total is the next baseline');
  // a round with no new teammate layers grants nothing
  const mid = a.layers.yanShip || 0;
  m.dispatch(a, 'onRoundStart', { round: 3 });
  assert.equal(a.layers.yanShip || 0, mid, 'no new layers ⇒ no share');
  h.invariants();
  m.dispose();
});

// 业主 2026-10-27「多个盟约寄生有bug，好像是只会寄生最后一个人」：一份百变式的第二份 ref（策略「管理员」/ 复制）本该
// 各记各的寄生对象与基准线，但两侧都按**基础 id** 找 ref ——
//   · 备战侧（server/match/hextech.js applyHexExtras `pickTeammate`）：`find(e.id === 'hex:<id>' || e.key === …)`
//     命中的永远是第一份 ⇒ 第二份的寄生对象被写进第一份（后选的那位才是唯一被寄生的）；
//   · 回合侧（server/sim/content/hextech.js `parasiteShare`）：`ctx.effect('hex:<id>')` 同样只认基础 id ⇒ 第二份
//     读的是第一份的 partner/baseline，而第一份刚把基准线推上去，增量恒为 0 ⇒ 两份只当一份用。
// 现在两边都用「这一次派发自己的 ref」（ctx.selfRef()），于是两份各自寄生、各自结算。
test('盟约寄生: a second copy keeps its OWN partner and drains on its own (业主 2026-10-27)', () => {
  const h = makeMatch({ mode: 'coop', difficulty: 'NORMAL', humans: 3, bots: 0, seed: 91, fake: true });
  h.start();
  toPrep(h, 1);
  const m = h.m;
  const a = h.ps('p_0');
  // the picker owns one ACTIVE stackable bond (炎, three operators), so every ref pays out in full
  for (const chessId of ['chess_char_1_03_a', 'chess_char_2_04_a', 'chess_char_3_03_a']) {
    const tile = legalTileFor(m, a, chessId);
    assert.ok(tile, `a legal tile for ${chessId}`);
    give(m, a, chessId, 'board', tile);
  }
  a.recompute();
  assert.equal(a.bonds.yanShip?.active, true, 'premise: 炎 is active');
  // the copy seam (a workshop pack / 复制 still calls it): the player's band is armed for one copy
  const realBand = m.gd.band(a.bandId);
  m.gd.band = (id) => (id === a.bandId ? { ...(realBand || {}), bandId: a.bandId, buffs: [{ key: 'band_hex_copy_once', bb: { count: 1 }, bbStr: {} }] } : realBand);
  applyHex(m, a, m.gd.hex('hex_bondparasite'));
  applyBandHexCopy(m, a, m.gd.hex('hex_bondparasite'));
  const refs = a.effects.filter((e) => e && e.key === 'hex:hex_bondparasite');
  assert.deepEqual(refs.map((r) => r.id).sort(), ['hex:hex_bondparasite', 'hex:hex_bondparasite#2'], 'two refs: the card and its copy');
  for (const r of refs) {
    assert.ok(r.params && r.params.parasite, `${r.id} carries its own parasite slot`);
    assert.equal(typeof r.params.parasite.partnerId, 'string', `${r.id} picked a partner of its own`);
  }
  // the effects column names the pairing per ref: one row per DISTINCT 寄生对象 (identical pairings still merge into ×2)
  const rows = a.effectsView().filter((e) => e.iconKind === 'hex' && e.name === '盟约寄生');
  const distinct = new Set(refs.map((r) => r.params.parasite.partnerId));
  assert.equal(rows.length, distinct.size, `one row per distinct 寄生对象 (got ${rows.length}, distinct ${distinct.size})`);
  // every partner gains 7 layers; each ref pays its own partner's delta in full (7 per ref)
  const partners = [...new Set(refs.map((r) => r.params.parasite.partnerId))].map((id) => m.players.get(id));
  for (const p of partners) { p.layers.yanShip = (p.layers.yanShip || 0) + 7; p.recompute(); }
  const before = a.layers.yanShip || 0;
  m.dispatch(a, 'onRoundStart', { round: 2 });
  const gained = (a.layers.yanShip || 0) - before;
  assert.equal(gained, refs.length * 7, `both refs paid out (got ${gained})`);
  for (const r of refs) assert.equal(Number(r.params.parasite.baseline), 7, `${r.id} re-baselined on its own`);
  // …and a round with no new layers pays nothing, again per ref
  m.dispatch(a, 'onRoundStart', { round: 3 });
  assert.equal(a.layers.yanShip || 0, before + refs.length * 7, 'no new layers ⇒ no share');
  h.invariants();
  m.dispose();
});

test('room.hexBans: each player’s own draft offer and reroll skip their ≤ 3 bans', () => {
  const seats = [
    { seat: 0, playerId: 'p_0', name: 'P0', isBot: false, connected: true, hexBans: ['hex_stipend', 'hex_echo'] },
    { seat: 1, playerId: 'p_1', name: 'P1', isBot: false, connected: true, hexBans: [] },
  ];
  const h = makeMatch({ mode: 'coop', difficulty: 'NORMAL', seats, seed: 31, fake: true });
  h.start();
  toHexDraft(h, 1);
  const m = h.m;
  const bans = ['hex_stipend', 'hex_echo'];
  assert.deepEqual(h.ps('p_0').hexBans, bans, 'the seat’s bans reach the player state');
  const offer = m.hexOfferOf('p_0');
  for (const id of bans) assert.ok(!offer.includes(id), `p_0 is never offered the banned ${id}`);
  // a single-card reroll also skips them
  for (let i = 0; i < 3; i++) {
    m.handle('p_0', { t: 'g.hexReroll', idx: 0 });
    for (const id of bans) assert.ok(!m.hexOfferOf('p_0').includes(id), `reroll ${i + 1} skips ${id}`);
    m.hex.slotRerolls.p_0[0] = 1; // refill the per-card budget so the loop exercises three draws
  }
  // the teammate is NOT filtered by p_0's bans
  assert.equal(h.ps('p_1').hexBans.length, 0);
  h.invariants();
  m.dispose();
});

test('可露希尔大降价: 三次刷新免费，且这三次刷新内的购买一律免费（业主 2026-10-18 的口径）', () => {
  const { h, m, ps } = solo1(151);
  ps.funds = 20;
  // the R1 draft may already have handed this seat a 免费刷新 card (the harness auto-picks), so start from a clean shop
  ps.shop.freeRefreshes = 0;
  ps.shop.freeBuyWindow = 0;
  applyHex(m, ps, m.gd.hex('hex_bigdiscount'));
  assert.equal(ps.shop.freeRefreshes, 3, 'three free refreshes');
  assert.equal(ps.shop.freeBuyWindow, 3, 'the free-purchase window IS those three refreshes');
  assert.equal(ps.privateView().shop.freeBuyWindow, 3, 'the client is told the window');
  const allFree = () => ps.shop.slots.every((s) => !s || s.sold || ps.priceOf(s) === 0);
  assert.ok(allFree(), 'every slot of the shop shown at pick time reads 0');
  const buy = (pred) => {
    const idx = ps.shop.slots.findIndex((s) => s && !s.sold && pred(s));
    assert.ok(idx >= 0, 'a slot to buy');
    const price = ps.priceOf(ps.shop.slots[idx]);
    const f0 = ps.funds;
    assert.deepEqual(m.handle('p_0', { t: 'g.buy', slot: idx }), { ok: true });
    return { price, paid: f0 - ps.funds };
  };
  // the window is opened by the CARD and spent by REFRESHES — buying does not touch it
  assert.deepEqual(buy((s) => s.kind === 'item'), { price: 0, paid: 0 }, 'equipment bought for nothing');
  assert.deepEqual(buy((s) => s.kind === 'chess'), { price: 0, paid: 0 }, 'operator bought for nothing');
  assert.equal(ps.shop.freeBuyWindow, 3, 'a purchase does not spend the window');
  // each of the three refreshes keeps the next shop free and shaves the window by one
  for (const left of [2, 1]) {
    assert.deepEqual(m.handle('p_0', { t: 'g.refresh' }), { ok: true });
    assert.equal(ps.shop.freeRefreshes, left);
    assert.equal(ps.shop.freeBuyWindow, left, 'the window and the free refreshes run out together');
    assert.ok(allFree(), `the shop after refresh ${3 - left} reads 0`);
    assert.deepEqual(buy((s) => s.kind === 'chess'), { price: 0, paid: 0 }, 'still free inside the window');
  }
  // the third refresh uses the last one: the shop it produces is the first that costs again
  assert.deepEqual(m.handle('p_0', { t: 'g.refresh' }), { ok: true });
  assert.equal(ps.shop.freeRefreshes, 0);
  assert.equal(ps.shop.freeBuyWindow, 0, 'the window closes with the last free refresh');
  const four = buy(() => true);
  assert.ok(four.price > 0, `outside the window a purchase is priced again (${four.price})`);
  assert.equal(four.paid, four.price);
  h.invariants();
  m.dispose();
});

// =====================================================================================================================
// 第十四批（业主 2026-10-19）：集成门禁 + 万物归虚的备战期半边
// =====================================================================================================================

/** The four cards of the batch whose battle half is a CARD-level script (no equipment involved). */
const BATCH15_CARD = [
  ['hex_glasscannon', 'glasscannon'], ['hex_heavyload', 'heavyload'],
  ['hex_umbrellabreak', 'umbrellabreak'], ['hex_oldpower', 'oldpower'],
];

test('batch15: the four CARD-level scripts are wired end to end (record → BATTLE_SPEC_KEYS → HEX_SCRIPT_KEYS)', () => {
  for (const [hexId, key] of BATCH15_CARD) {
    const rec = DATA.hextech.playerHexes[hexId];
    assert.ok(rec, hexId + ': the record exists');
    assert.ok(rec.effect[key] !== undefined, hexId + ': carries its spec key ' + key);
    assert.ok(BATTLE_SPEC_KEYS.includes(key), hexId + ': ' + key + ' is in BATTLE_SPEC_KEYS (or the ref never reaches a battle)');
    assert.equal(HEX_SCRIPT_KEYS[hexId], key, hexId + ': HEX_SCRIPT_KEYS maps it to ' + key);
    assert.ok(hasBattlePart({ [key]: rec.effect[key] }) || rec.effect.onPick, hexId + ': the card is battle-visible');
  }
});

test('batch15: the four equipment-granting cards fight through their EQUIPMENT, not through a card script', () => {
  // 业主 2026-10-26「所有协议装备都依靠对应的协议源石生效的bug这个还没修」: these four only hand an item out; the battle half is
  // the item's (server/sim/content/items/protocol.js), so 神器整备 / 工坊 / 测试面板 can give the item without the card.
  for (const [hexId, itemId] of [
    ['hex_canlight', 'chess_item_9_92_e_a'], ['hex_warding', 'chess_item_9_93_e_a'],
    ['hex_voidreturn', 'chess_item_9_94_e_a'], ['hex_corpsehill', 'chess_item_9_95_e_a'],
  ]) {
    const rec = DATA.hextech.playerHexes[hexId];
    assert.ok(rec, hexId + ': the record exists');
    assert.deepEqual(rec.effect.onPick, { item: { id: itemId, count: 1 } }, hexId + ' grants its own equipment');
    const item = DATA.items[itemId];
    assert.ok(item, hexId + ': ' + itemId + ' exists in data/items.json');
    assert.equal(item.hideInShop, true, itemId + ' is not sold in the shop');
    assert.equal(item.price, 0, itemId + ' costs nothing (granted only)');
    assert.equal(hasBattleEffect(item), true, itemId + ': the EQUIPMENT carries the battle behaviour');
    assert.equal(HEX_SCRIPT_KEYS[hexId], undefined, hexId + ': no card-side battle script any more');
    assert.equal(hasBattlePart(rec.effect), false, hexId + ': the ref never has to reach a battle');
  }
});

test('万物归虚: EQUIPPING the item empties the reserve (备战区) and banks the count on the item piece', () => {
  const h = makeMatch({ mode: 'coop', difficulty: 'NORMAL', humans: 1, bots: 1, seed: 31, fake: true });
  h.start();
  toPrep(h, 1);
  const m = h.m;
  const ps = h.ps('p_0');
  // operators in the RESERVE (the hand) are what the item removes — the 备战区 of the owner's wording
  give(m, ps, chessOfTier(1)[0]);
  give(m, ps, chessOfTier(1)[1]);
  ps.recompute();
  const before = (ps.hand || []).filter((x) => x && x.kind === 'chess').length;
  assert.ok(before > 0, 'premise: there are operators in the reserve');
  // 业主 2026-10-26: no 万物归虚 card at all — the EQUIPMENT is what empties the reserve and keeps the count.
  assert.equal(ownsHex(ps, 'hex_voidreturn'), false, 'premise: the player never picked the card');
  const carrier = give(m, ps, chessOfTier(1)[0], 'board', [10, 5]);
  const item = giveItem(m, ps, 'chess_item_9_94_e_a');
  assert.deepEqual(m.handle('p_0', { t: 'g.equip', itemUid: item.uid, targetUid: carrier.uid }), { ok: true });
  assert.equal((ps.hand || []).filter((x) => x && x.kind === 'chess').length, 0, 'the reserve holds no operator any more');
  const banked = item.state && item.state['chess_item_9_94_e_a'] && item.state['chess_item_9_94_e_a'].voidLayers;
  assert.equal(banked, before, 'the count of removed operators is banked on the ITEM piece, got ' + banked);
  assert.equal(ps.effects.some((e) => e && e.data && e.data.hexId === 'hex_voidreturn'), false, 'and no card ref was ever made');
  // a SECOND equip counts again (the count is additive, as the card's 「装备时」 wording implies)
  give(m, ps, chessOfTier(1)[1]);
  ps.recompute();
  const second = giveItem(m, ps, 'chess_item_9_94_e_a');
  const carrier2 = give(m, ps, chessOfTier(1)[0], 'board', [10, 6]);
  assert.deepEqual(m.handle('p_0', { t: 'g.equip', itemUid: second.uid, targetUid: carrier2.uid }), { ok: true });
  const banked2 = second.state && second.state['chess_item_9_94_e_a'] && second.state['chess_item_9_94_e_a'].voidLayers;
  assert.equal(banked2, 1, 'the second equip banked the one operator it removed, got ' + banked2);
  m.dispose();
});

test('万物归虚: the banked layers ride the battle input into the next battle (装备 → battleInput → 战斗)', () => {
  const h = makeMatch({ mode: 'coop', difficulty: 'NORMAL', humans: 1, bots: 1, seed: 32, fake: true });
  h.start();
  toPrep(h, 1);
  const m = h.m;
  const ps = h.ps('p_0');
  give(m, ps, chessOfTier(1)[0]);
  give(m, ps, chessOfTier(1)[1]);
  ps.recompute();
  const before = (ps.hand || []).filter((x) => x && x.kind === 'chess').length;
  assert.ok(before > 0, 'premise: two operators in the reserve');
  const carrier = give(m, ps, chessOfTier(1)[0], 'board', [10, 5]);
  const item = giveItem(m, ps, 'chess_item_9_94_e_a');
  assert.deepEqual(m.handle('p_0', { t: 'g.equip', itemUid: item.uid, targetUid: carrier.uid }), { ok: true });
  // 1) the match layer: the count travels with the SAME input the client replays (per concrete item id)
  const input = ps.battleInput();
  const unit = input.units.find((u) => u.uid === carrier.uid);
  assert.ok(unit, 'the carrier is in the battle input');
  assert.ok(unit.items.includes('chess_item_9_94_e_a'), 'and the item is on it');
  assert.deepEqual(unit.itemState, { chess_item_9_94_e_a: { voidLayers: before } }, 'the count rides the input');
  // 2) the sim layer: the operator starts the battle with +20 % ATK per layer
  const bt = makeBattle({ players: [input], enemies: [], autoFinish: false, timeLimit: 20 });
  bt.run(0.3);
  const u = bt.b.allyUnits.find((x) => x.uid === carrier.uid);
  assert.ok(u, 'the operator deployed');
  const buff = (u.buffs || []).find((b) => typeof b.key === 'string' && b.key.startsWith('item:chess_item_9_94_e_a'));
  assert.ok(buff, 'the layer buff is installed from the equipment');
  assert.ok(Math.abs(buff.mods.atkPct - 0.2 * before) < 1e-9, 'two layers -> +40 % ATK, got ' + buff.mods.atkPct);
  m.dispose();
});

// =====================================================================================================================
// 通缉令 / 窃贼 的 match 层半边（server/match/hextech.js）
// =====================================================================================================================

/** coin price of every bounty enemy the picker may return (the highest price any of its cards carries). */
function bountyCoins(gd) {
  const coinOf = new Map();
  const cards = gd.choices && gd.choices.cards ? gd.choices.cards : {};
  const lists = Array.isArray(cards) ? cards : Object.values(cards);
  for (const list of lists) for (const c of Array.isArray(list) ? list : []) {
    const coin = Number(c && c.coin);
    if (!c || typeof c.enemyKey !== 'string' || !c.enemyKey || !Number.isFinite(coin)) continue;
    coinOf.set(c.enemyKey, Math.max(coinOf.get(c.enemyKey) ?? 0, coin));
  }
  return coinOf;
}

test('通缉令: the match picks one 惊变 enemy whose coin price is 1..5', () => {
  const h = makeMatch({ mode: 'coop', difficulty: 'NORMAL', humans: 1, bots: 1, seed: 41, fake: true });
  h.start();
  const m = h.m;
  m.enemyHexes.push({ id: 'ehex_wanted', round: 1 });
  const key = enemyHexWantedKey(m, 9);
  assert.ok(typeof key === 'string' && key, 'an enemy key came back, got ' + key);
  assert.ok(m.gd.enemy(key), 'and it is a real enemy record: ' + key);
  const coin = bountyCoins(m.gd).get(key);
  assert.ok(coin >= 1 && coin <= 5, 'the pick is a 1~5 块 bounty enemy, got ' + coin);
  m.dispose();
});

test('通缉令: 价值上限按回合分档（前 3 回合 1 块 / 前 5 回合 1~2 / 前 7 回合 1~3 / 之后 1~5，业主 2026-10-22）', () => {
  const h = makeMatch({ mode: 'coop', difficulty: 'NORMAL', humans: 1, bots: 1, seed: 45, fake: true });
  h.start();
  const m = h.m;
  m.enemyHexes.push({ id: 'ehex_wanted', round: 1 });
  // one enemy may be sold by several cards at different prices, so the admission test is
  // 「这张卡（敌人）有没有一个 ≤ 上限的价格」，不是「它最贵的那个价格 ≤ 上限」。
  const coinsOf = new Map();
  const cards = m.gd.choices && m.gd.choices.cards ? m.gd.choices.cards : {};
  for (const list of (Array.isArray(cards) ? cards : Object.values(cards))) {
    for (const c of (Array.isArray(list) ? list : [])) {
      const coin = Number(c && c.coin);
      if (!c || typeof c.enemyKey !== 'string' || !c.enemyKey || !Number.isFinite(coin)) continue;
      if (!coinsOf.has(c.enemyKey)) coinsOf.set(c.enemyKey, new Set());
      coinsOf.get(c.enemyKey).add(coin);
    }
  }
  const admitted = (key, cap) => {
    const set = coinsOf.get(key);
    return !!set && [...set].some((c) => c >= 1 && c <= cap);
  };
  // R1~3 只能是 1 块；R4~5 1~2；R6~7 1~3
  for (const [round, cap] of [[1, 1], [2, 1], [3, 1], [4, 2], [5, 2], [6, 3], [7, 3]]) {
    for (let seed = 1; seed <= 40; seed++) {
      const mt = { gd: m.gd, round, seed, enemyHexes: m.enemyHexes };
      for (const fieldId of ['n:p_0', 'n:p_1', 'u']) {
        const key = enemyHexWantedKey(mt, round, fieldId);
        assert.ok(admitted(key, cap), 'R' + round + ' ' + fieldId + ' picked ' + key + ' (' + [...(coinsOf.get(key) || [])].sort().join('/') + ' 块) over the ' + cap + '-coin cap');
      }
    }
  }
  // 第 8 回合起放开 4/5 块 —— 必须真的能抽到
  const seen = new Map();
  for (let seed = 1; seed <= 400; seed++) {
    const key = enemyHexWantedKey({ gd: m.gd, round: 8, seed, enemyHexes: m.enemyHexes }, 8, 'n:p_0');
    seen.set(key, coinsOf.get(key));
  }
  assert.ok([...seen.values()].some((set) => set && [...set].some((c) => c > 3)), 'R8 can reach a 4/5 块 bounty');
  m.dispose();
});

test('通缉令: the BATTLE round decides the cap, and the pick is a pure function of (seed, round, field)', () => {
  const h = makeMatch({ mode: 'coop', difficulty: 'NORMAL', humans: 1, bots: 1, seed: 47, fake: true });
  h.start();
  const m = h.m;
  m.enemyHexes.push({ id: 'ehex_wanted', round: 1 });
  const priced = bountyCoins(m.gd);
  const at = (round, fieldId = 'n:p_0') => enemyHexWantedKey({ gd: m.gd, round, seed: 99, enemyHexes: m.enemyHexes }, round, fieldId);
  // the same card drawn in R1 fights on: only the battle's own round matters
  for (const round of [1, 3, 5]) assert.ok(priced.get(at(round)) <= 3, 'R' + round + ' drew ' + at(round));
  assert.ok(priced.get(at(6)) >= 1, 'R6 still picks something');
  // 业主 2026-10-20: the pick must be a PURE function of (seed, round, fieldId) — it used to draw off `rngWaves`, which
  // is consumed once per battle and therefore diverged between the client-run and the server-run paths. Nothing is
  // drawn off the match at all now: a stand-in whose rngWaves would blow up proves the split.
  const mt = { gd: m.gd, round: 4, seed: 123, enemyHexes: m.enemyHexes, rngWaves: () => { throw new Error('the wanted pick must not touch rngWaves'); } };
  const first = enemyHexWantedKey(mt, 4, 'n:p_0');
  assert.equal(enemyHexWantedKey({ ...mt }, 4, 'n:p_0'), first, 'same seed + round + field -> same pick');
  // no fieldId is its own (empty) field id — a different salt, but just as determined
  assert.equal(enemyHexWantedKey({ ...mt }, 4), enemyHexWantedKey({ ...mt }, 4, ''), 'a missing fieldId === the empty one');
  // a different field is allowed to draw differently (each battle is its own pick), but always from the same pool
  for (const fieldId of ['n:p_0', 'n:p_1', 'n:ai_0', 'u', 'u0', 'U1']) assert.ok(priced.has(enemyHexWantedKey(mt, 4, fieldId)), fieldId);
  m.dispose();
});

test('通缉令: without the card the match picks nothing', () => {
  const h = makeMatch({ mode: 'coop', difficulty: 'NORMAL', humans: 1, bots: 1, seed: 42, fake: true });
  h.start();
  assert.equal(enemyHexWantedKey(h.m), undefined);
  h.m.dispose();
});

test('窃贼: knock-outs bank a capped income penalty that the next round consumes', () => {
  const h = makeMatch({ mode: 'coop', difficulty: 'NORMAL', humans: 1, bots: 1, seed: 43, fake: true });
  h.start();
  const m = h.m;
  const ps = h.ps('p_0');
  m.enemyHexes.push({ id: 'ehex_thief', round: 1 });
  // three knock-outs -> 6%
  assert.equal(bankThiefPenalty(m, ps, 3), 6);
  assert.equal(ps.thiefPctLost, 6);
  // the cap: 20 more deaths cannot push past 30%
  bankThiefPenalty(m, ps, 20);
  assert.equal(ps.thiefPctLost, 30, 'capped at 30%');
  // the income cut applies and is consumed
  const ev = { income: 100 };
  assert.equal(applyThiefIncomeCut(ps, ev), true);
  assert.equal(ev.income, 70, '100 income - 30% = 70, got ' + ev.income);
  assert.equal(ps.thiefPctLost, 0, 'the bank is consumed by the next round');
  assert.equal(applyThiefIncomeCut(ps, { income: 100 }), false, 'nothing left to cut');
  m.dispose();
});

test('窃贼: without the card nothing is banked or cut', () => {
  const h = makeMatch({ mode: 'coop', difficulty: 'NORMAL', humans: 1, bots: 1, seed: 44, fake: true });
  h.start();
  const m = h.m;
  const ps = h.ps('p_0');
  assert.equal(bankThiefPenalty(m, ps, 5), 0);
  assert.equal(ps.thiefPctLost, undefined);
  const ev = { income: 100 };
  assert.equal(applyThiefIncomeCut(ps, ev), false);
  assert.equal(ev.income, 100, 'no card -> no cut');
  m.dispose();
});


test('投资天才: +1 获得时 trigger (投资人 ×2/×3 → ×3/×4) and two members activate 投资人', () => {
  const h = makeMatch({ mode: 'solo', difficulty: 'NORMAL', humans: 1, bots: 0, seed: 91, fake: true });
  h.start();
  toPrep(h, 1);
  const m = h.m;
  const ps = h.ps('p_0');
  assert.equal(m.dispatcher.investRepeat(ps), 1, 'no 投资人, no card: one trigger');
  applyHex(m, ps, m.gd.hex('hex_investgenius'));
  assert.equal(m.dispatcher.investRepeat(ps), 2, 'the card alone: 1 + 1');
  // two real members now activate 投资人 (the data threshold is 3)
  give(m, ps, 'chess_char_1_16_a', 'board', [9, 3]);
  give(m, ps, 'chess_char_2_19_a', 'board', [9, 4]);
  ps.recompute();
  assert.equal(ps.bonds.investShip?.active, true, 'the card’s need shift activates 投资人 at 2 members');
  assert.equal(m.dispatcher.investRepeat(ps), 3, '投资人 ×2 + the card’s extra trigger');
  ps.layers.investShip = 100;
  ps.bonds.investShip.layers = 100;
  assert.equal(m.dispatcher.investRepeat(ps), 4, '投资人 ×3 at 100 layers + the extra trigger');
  h.invariants();
  m.dispose();
});

test('传承: a GAIN banks +1 % for that operator’s bonds on the card’s own ref', () => {
  const h = makeMatch({ mode: 'solo', difficulty: 'NORMAL', humans: 1, bots: 0, seed: 93, fake: true });
  h.start();
  toPrep(h, 1);
  const m = h.m;
  const ps = h.ps('p_0');
  applyHex(m, ps, m.gd.hex('hex_heritage'));
  const gained = give(m, ps, 'chess_char_2_03_a', 'board', [9, 3]); // 崖心: two bonds
  m.dispatch(ps, 'onGain', { piece: gained, kind: 'chess', source: 'test' });
  const ref = ps.effects.find((e) => e && e.key === 'hex:hex_heritage');
  const acc = ref.params.battle.bondAtk;
  const rec = m.gd.chess('chess_char_2_03_a');
  for (const b of rec.bonds) assert.equal(acc[b], 1, `${b}: one gain ⇒ +1 %`);
  h.invariants();
  m.dispose();
});

test('盟约获得: the dispatcher measures the trait’s own layer gain and gives half to the ACTIVE bonds', () => {
  const h = makeMatch({ mode: 'solo', difficulty: 'NORMAL', humans: 1, bots: 0, seed: 95, fake: true });
  h.start();
  toPrep(h, 1);
  const m = h.m;
  const ps = h.ps('p_0');
  // three 谢拉格 operators, so 谢拉格 is active; 崖心 (the gained one) carries 谢拉格 + 不屈
  give(m, ps, 'chess_char_1_02_a', 'board', [9, 3]);
  give(m, ps, 'chess_char_2_05_a', 'board', [9, 4]);
  give(m, ps, 'chess_char_3_14_a', 'board', [9, 5]);
  ps.recompute();
  assert.equal(ps.bonds.kjeragShip?.active, true, 'premise: 谢拉格 is active');
  applyHex(m, ps, m.gd.hex('hex_bondgain'));
  const gained = give(m, ps, 'chess_char_2_03_a', 'board', [9, 6]);
  m.dispatch(ps, 'onGain', { piece: gained, kind: 'chess', source: 'test' });
  ps.recompute();
  // 崖心's 获得时 trait gives +3 to each of its own bonds; 盟约获得 halves that to 1 and gives it to the ACTIVE
  // stackable bonds only (谢拉格). 不屈 stays inactive and gets only the trait's own +3.
  assert.equal(ps.layers.kjeragShip || 0, 4, '谢拉格: trait 3 + card 1');
  assert.equal(ps.layers.indomShip || 0, 3, '不屈: trait 3 only (inactive ⇒ no share)');
  h.invariants();
  m.dispose();
});

// =====================================================================================================================
// §29.40 — the sixteenth batch (业主 2026-10-24): the match-level halves.
// =====================================================================================================================

test('无私奉献: every OTHER teammate gains a random hex — the picker does not', () => {
  const h = makeMatch({ mode: 'coop', difficulty: 'NORMAL', humans: 2, bots: 0, seed: 77, fake: true });
  h.start();
  toPrep(h, 1);
  const m = h.m;
  const a = h.ps('p_0');
  const b = h.ps('p_1');
  const hexesOf = (ps) => ps.effects.filter((e) => e && typeof e.key === 'string' && e.key.startsWith('hex:')).length;
  const bBefore = hexesOf(b);
  const aBefore = hexesOf(a);
  applyHex(m, a, m.gd.hex('hex_selfless'));
  assert.equal(hexesOf(b), bBefore + 1, 'the teammate gained exactly one extra card');
  assert.equal(hexesOf(a), aBefore + 1, 'the picker gained only the card itself (its earlier draft pick stays)');
  assert.equal(ownsHex(a, 'hex_selfless'), true);
  m.dispose();
});

test('背水一战: the pick SETS the LP to 1 and opens a two-round 锁血 window', () => {
  const { h, m, ps } = solo1(131);
  ps.lp = 12;
  applyHex(m, ps, m.gd.hex('hex_lastditch'));
  assert.equal(ps.lp, 1, '「目标生命自动变为1」');
  assert.equal(lpLockUntilOf(ps), m.round + 1, 'the pick counts as the first of the two locked rounds');
  assert.equal(lpLockedIn(ps, m.round), true);
  assert.equal(lpLockedIn(ps, m.round + 1), true);
  assert.equal(lpLockedIn(ps, m.round + 2), false, 'and it lapses after two');
  h.invariants();
  m.dispose();
});

// =====================================================================================================================
// §29.41 — 第十七批：核心盟约专属协议 · 维多利亚 · 锻炉（业主 2026-10-24）
// =====================================================================================================================

test('锻炉: 专属卡只在【维多利亚】激活时进卡池，掉线后也不会被再抽到', () => {
  const { h, m, ps } = solo1(151);
  const rec = m.gd.hex('hex_forge');
  assert.equal(rec.requiresBond, 'victoriaShip');
  assert.equal(hexAvailableTo(ps, rec), false, 'no 维多利亚 ⇒ not available');
  assert.ok(!hexPoolFor(ps, m.gd).some((x) => x.id === 'hex_forge'), 'the offer pool leaves it out');
  // the bond becomes active (a member joined) ⇒ the card enters the pool
  ps.bonds = { ...ps.bonds, victoriaShip: { count: 3, active: true, tier: 1, layers: 0 } };
  assert.equal(hexAvailableTo(ps, rec), true);
  assert.ok(hexPoolFor(ps, m.gd).some((x) => x.id === 'hex_forge'), 'and now it is offered');
  // an inactive record (members but below the threshold) is out again
  ps.bonds = { ...ps.bonds, victoriaShip: { count: 1, active: false, tier: 0, layers: 0 } };
  assert.equal(hexAvailableTo(ps, rec), false);
  // the same rule narrows the REAL draft of round 1 (this player has no 维多利亚 member at all)
  ps.bonds = { ...ps.bonds, victoriaShip: undefined };
  // the patches above are test-local: recompute before the invariant check so `ps.bonds` is the computed one again
  ps.recompute();
  assert.equal(hexAvailableTo(ps, rec), false);
  h.invariants();
  m.dispose();
});

test('锻炉: two worn items fuse into 百变 — one item, both effects, never fused again', () => {
  const { h, m, ps } = solo1(153);
  applyHex(m, ps, m.gd.hex('hex_forge'));
  const chessId = chessOfTier(1)[0];
  const tile = legalTileFor(m, ps, chessId);
  assert.ok(tile, 'a legal tile (premise)');
  const piece = give(m, ps, chessId, 'board', tile);
  const a = giveItem(m, ps, 'chess_item_1_01_e_a');   // 维式重锤
  const b = giveItem(m, ps, 'chess_item_1_02_e_a');   // 坚守盾牌
  assert.deepEqual(ps.equip(a.uid, piece.uid), { ok: true }, 'the first item lands normally');
  assert.equal(piece.items.length, 1, 'one item so far');
  assert.deepEqual(ps.equip(b.uid, piece.uid), { ok: true }, 'the second one lands');
  assert.equal(piece.items.length, 1, 'and the two fure into ONE item');
  assert.equal(piece.items[0].id, FORGE_ITEM_ID, '百变');
  assert.deepEqual(piece.items[0].merged, ['chess_item_1_01_e_a', 'chess_item_1_02_e_a'], 'it remembers both components');
  // 「百变的效果是两件被融合装备的效果」: the BATTLE input carries both original ids, so the sim installs both items
  const input = ps.battleInput();
  const u = input.units.find((x) => x.uid === piece.uid);
  assert.deepEqual([...u.items].sort(), ['chess_item_1_01_e_a', 'chess_item_1_02_e_a'], 'both records reach the battle');
  // 「百变不会被融合」: a scan finds no second unfused pair on that operator
  assert.equal(applyForgeFusion(ps, piece), 0, 'no re-fusion');
  assert.equal(piece.items.length, 1);
  // … and the fused piece can still be unequipped (it moves as ONE item), fusion does not come back
  const before = piece.items[0].uid;
  ps.equip(giveItem(m, ps, 'chess_item_3_01_e_a').uid, piece.uid);
  assert.ok(piece.items.length <= 2, 'the carrier never exceeds its slots');
  assert.ok(piece.items.some((it) => it.merged), 'the 百变 survived a later equip');
  void before;
  h.invariants();
  m.dispose();
});

test('锻炉: 百变回到整备区后，道具卡仍写得出是哪两件（业主 2026-10-27）', () => {
  const { h, m, ps } = solo1(157);
  applyHex(m, ps, m.gd.hex('hex_forge'));
  const chessId = chessOfTier(1)[0];
  const tile = legalTileFor(m, ps, chessId);
  assert.ok(tile, 'a legal tile (premise)');
  const piece = give(m, ps, chessId, 'board', tile);
  assert.deepEqual(ps.equip(giveItem(m, ps, 'chess_item_1_01_e_a').uid, piece.uid), { ok: true });   // 维式重锤
  assert.deepEqual(ps.equip(giveItem(m, ps, 'chess_item_1_02_e_a').uid, piece.uid), { ok: true });   // 坚守盾牌
  const fused = piece.items[0];
  assert.deepEqual(fused.merged, ['chess_item_1_01_e_a', 'chess_item_1_02_e_a'], 'premise: a fused 百变');
  // 「取下来」: selling the carrier returns its equipment to the 整备区 — as ONE piece (the 百变), not as its two components
  assert.deepEqual(ps.sell(piece.uid), { ok: true });
  const back = [...(ps.hand || []), ...(ps.temp || [])].filter(Boolean).find((p) => p && p.uid === fused.uid);
  assert.ok(back && back.kind === 'item' && back.id === FORGE_ITEM_ID, 'the 百变 is in the reserve, still one item');
  // the card the player opens reads the PIECE VIEW (detailPanel ItemDetail → FusedFrom ← piece.merged): without `merged`
  // here the card showed the generic 百变 text and named no component (业主 2026-10-27 的截图)
  const view = ps.pieceView(back);
  assert.deepEqual(view.merged, ['chess_item_1_01_e_a', 'chess_item_1_02_e_a'], 'the client is told which two it fused');
  const priv = ps.privateView();
  const inFrame = [...(priv.hand || []), ...(priv.temp || [])].filter(Boolean).find((p) => p && p.uid === fused.uid);
  assert.deepEqual(inFrame.merged, ['chess_item_1_01_e_a', 'chess_item_1_02_e_a'], 'and the frame it receives carries it');
  // every other piece is unchanged: an ordinary item has no `merged` key at all (an older client reads it as before)
  const plain = giveItem(m, ps, 'chess_item_1_01_e_a');
  assert.equal('merged' in ps.pieceView(plain), false, 'an ordinary item view is byte-identical');
  h.invariants();
  m.dispose();
});

// 业主 2026-10-27「改备战侧的坚守人数/激活」：燎原 300 层后炎干员算进坚守人数 ⇒ 坚守真的激活，战斗输入带着这个 tier
// （坚守模块只在 tier ≥ 2 时装上，炎干员由 bonds/addon/battle.js 并进它的成员名单，40% 分担 / 反伤因此生效）。
test('燎原: 300 层后坚守真的激活，战斗输入带着这个 tier（业主 2026-10-27）', () => {
  const { h, m, ps } = solo1(163);
  applyHex(m, ps, m.gd.hex('hex_yan_ember'));
  for (const chessId of ['chess_char_1_03_a', 'chess_char_2_04_a', 'chess_char_3_03_a']) {
    const tile = legalTileFor(m, ps, chessId);
    assert.ok(tile, `a legal tile for ${chessId}`);
    give(m, ps, chessId, 'board', tile);
  }
  ps.layers.yanShip = 299;
  ps.recompute();
  assert.equal(ps.bonds.steadShip?.active ?? false, false, '299 层还不够');
  ps.layers.yanShip = 300;
  ps.recompute();
  assert.equal(ps.bonds.steadShip.count, 3, '3 名炎干员算进坚守人数');
  assert.equal(ps.bonds.steadShip.active, true, '坚守因此激活');
  assert.equal(ps.bonds.steadShip.tier, 2, '3 名 ⇒ 2 阶');
  // 客户端画的那条（m.private.bonds）跟着变
  const strip = ps.privateView().bonds.find((b) => b.bondId === 'steadShip');
  assert.equal(strip.active, true);
  assert.equal(strip.count, 3);
  // 战斗输入：坚守模块只在 tier ≥ 2 装上
  assert.equal(ps.battleInput({ side: 'L', colOffset: 0 }).bonds.steadShip.tier, 2);
  h.invariants();
  m.dispose();
});
// ---- 记录部抑制 (enemy hex `ehex_records`): the prep-phase LP charge and the line the player sees ---------------

test('记录部抑制: a prep deploy costs LP and the seat is TOLD (业主 2026-10-24「触发时给个明显提示」)', () => {
  const h = makeMatch({ mode: 'solo', difficulty: 'NORMAL', humans: 1, seed: 7, fake: true });
  h.start();
  toPrep(h, 1);
  const m = h.m;
  const ps = h.ps('p_0');
  m.enemyHexes = [{ id: 'ehex_records', round: 1 }];   // the shape the 海克斯 draft and the test field both store
  assert.equal(enemyPrepLpCost(m, m.round), 1, 'R1 is the first tick of everyRounds: 4');
  const chessId = chessOfTier(1).find((id) => m.pool.has(id));
  const piece = give(m, ps, chessId);
  const [row, col] = legalTileFor(m, ps, chessId);
  const lpBefore = ps.lp;
  assert.deepEqual(m.handle(ps.playerId, { t: 'g.move', uid: piece.uid, to: { area: 'board', row, col } }), { ok: true });
  assert.equal(ps.lp, lpBefore - 1, 'the deploy charged 1 LP');
  // the line the player sees: a `hex` toast — ui/toasts.js holds it longer, main.js flashes the screen and the LP tower
  const frame = h.lastTo('p_0', 'm.toast');
  assert.equal(frame.kind, 'hex');
  assert.equal(frame.hex, 'ehex_records', 'the frame names the card');
  assert.equal(frame.msgid, '记录部抑制：部署干员消耗 {n} 点策略生命（剩余 {rest}）');
  assert.deepEqual(frame.params, { n: 1, rest: ps.lp });
  assert.equal(frame.text, `记录部抑制：部署干员消耗 1 点策略生命（剩余 ${ps.lp}）`);
  // a REFUSED deploy (an illegal tile) must not cost LP — the whole reason the charge happens after the move
  const toastsNow = h.allTo('p_0', 'm.toast').length;
  const refused = m.handle(ps.playerId, { t: 'g.move', uid: piece.uid, to: { area: 'board', row: -1, col: -1 } });
  assert.ok(refused && refused.error, `expected a refusal, got ${JSON.stringify(refused)}`);
  assert.equal(ps.lp, lpBefore - 1, 'the refused deploy charged nothing');
  assert.equal(h.allTo('p_0', 'm.toast').length, toastsNow, 'and said nothing');
  h.invariants();
  m.dispose();
});

test('记录部抑制: without the card, or on a round that is not its tick, a deploy is free and silent', () => {
  const h = makeMatch({ mode: 'solo', difficulty: 'NORMAL', humans: 1, seed: 7, fake: true });
  h.start();
  toPrep(h, 1);
  const m = h.m;
  const ps = h.ps('p_0');
  const chessId = chessOfTier(1).find((id) => m.pool.has(id));
  const piece = give(m, ps, chessId);
  const [row, col] = legalTileFor(m, ps, chessId);
  const lpBefore = ps.lp;
  assert.deepEqual(m.handle(ps.playerId, { t: 'g.move', uid: piece.uid, to: { area: 'board', row, col } }), { ok: true });
  assert.equal(ps.lp, lpBefore);
  assert.equal(h.lastTo('p_0', 'm.toast'), null, 'no enemy card ⇒ no line at all');
  // owning it still charges only on its ticks (everyRounds: 4 ⇒ R1, R5, R9 …)
  m.enemyHexes = [{ id: 'ehex_records', round: 1 }];
  assert.equal(enemyPrepLpCost(m, 2), 0);
  assert.equal(enemyPrepLpCost(m, 5), 1);
  h.invariants();
  m.dispose();
});

// =====================================================================================================================
// 策略「管理员」(业主 2026-10-26)：「当你获得协议源石时，复制一个。限一次。」
// =====================================================================================================================

// 业主 2026-10-26「好多协议源石被'管理员'复制后只会触发1个」：复制必须让这张卡的**每一条腿**都算两份。
// 旧实现只重放 onPick、且 addHexRef 按 hexId 去重（一人一张）⇒ 盟约回响 / 量产线 / 神器整备这些「每回合」或「阶梯」
// 的卡复制后毫无变化。复制 = 同一张卡的**第二个 ref**（id `hex:<id>#2`、key 不变），派发器逐个 ref 跑，于是
// 每回合类 ×2；makeCtx 按 ref id 给计数器加命名空间，两套阶梯互不覆盖。
//
// 2026-10-25: 管理员 no longer copies on gain (「管理员策略改成第一回合多选择一次海克斯」), so these call
// `applyBandHexCopy` DIRECTLY — they pin the copy MECHANISM (the seam a workshop pack may still call), not the band.
// The mechanism still asks the player's band for `band_hex_copy_once`, so the fixture arms that buff itself.
const armCopyBuff = (h, ps) => {
  const real = h.m.gd.band(ps.bandId);
  h.m.gd.band = (id) => (id === ps.bandId
    ? { ...(real || {}), bandId: ps.bandId, buffs: [{ key: 'band_hex_copy_once', bb: { count: 1 }, bbStr: {} }] }
    : real);
};
test('复制机制: a copied 神器整备 runs TWO independent ladders (2 refs, per-ref counters)', () => {
  const h = makeMatch({ mode: 'solo', difficulty: 'FUNNY', seed: 11, fake: true }).start();
  h.toPrep(1);
  const ps = h.ps('p_0');
  armCopyBuff(h, ps);
  const items = () => {
    const out = [];
    for (const p of ps.hand || []) if (p && p.kind === 'item') out.push(p.id);
    for (const p of ps.temp || []) if (p && p.kind === 'item') out.push(p.id);
    return out.sort();
  };
  const countOf = (id) => items().filter((x) => x === id).length;
  applyHex(h.m, ps, h.m.gd.hex('hex_artifactkit'));
  applyBandHexCopy(h.m, ps, h.m.gd.hex('hex_artifactkit'));
  // two refs of the same card, one of them the copy
  const refs = ps.effects.filter((e) => e.key === 'hex:hex_artifactkit');
  assert.deepEqual(refs.map((r) => r.id).sort(), ['hex:hex_artifactkit', 'hex:hex_artifactkit#2'], 'the copy is its own ref');
  assert.equal(countOf('chess_item_9_93_e_a'), 2, 'R1: two 加护, one per ref');
  // both ladders have their own counters (no overwrite)
  assert.equal(ps.counters['hex:hex_artifactkit:stage'], 1, 'the original ladder is at rung 1');
  assert.equal(ps.counters['hex:hex_artifactkit#2::hex:hex_artifactkit:stage'], 1, 'and the copy keeps its own rung 1');
  h.toPrep(2);
  assert.equal(countOf('chess_item_9_92_e_a'), 2, 'R2: two 残光 — each copy walked its own 2阶 rung');
  h.toPrep(4);
  assert.equal(countOf('chess_item_9_92_e_a'), 2, 'no extra 2阶 later');
  const t3 = ['chess_item_9_90_e_a', 'chess_item_9_91_e_a', 'chess_item_9_94_e_a', 'chess_item_9_95_e_a', 'chess_item_9_96_e_a'];
  assert.equal(t3.reduce((n, id) => n + countOf(id), 0), 2, 'R4: two 3阶 artifacts, one per ladder');
  h.invariants();
  h.m.dispose();
});

// 管理员 no longer touches a gain at all: the strategy's own replacement is the round-1 extra pick
// (test/match/admin-extra-pick.test.js). Gaining two cards with 管理员 chosen must leave BOTH un-copied.
test('管理员: gaining cards no longer copies anything (the mechanic moved to the draft)', () => {
  const h = makeMatch({ mode: 'solo', difficulty: 'FUNNY', seed: 12, fake: true }).start();
  h.toPrep(1);
  const ps = h.ps('p_0');
  ps.bandId = 'band_admin';
  applyHex(h.m, ps, h.m.gd.hex('hex_stipend'));   // 获得时 +3 资金，之后再每回合 +2
  assert.ok(!ps.effects.some((e) => e.id === 'hex:hex_stipend#2'), 'no copy on the first gain');
  const refsAfterFirst = ps.effects.filter((e) => e.key.startsWith('hex:hex_')).length;
  applyHex(h.m, ps, h.m.gd.hex('hex_echo'));
  assert.ok(!ps.effects.some((e) => e.id === 'hex:hex_echo#2'), 'no copy on the second gain either');
  assert.equal(ps.effects.filter((e) => e.key.startsWith('hex:hex_')).length, refsAfterFirst + 1, 'only the new card itself joined');
  assert.equal(ps.counters['band_hex_copy:used'], undefined, 'the old once-per-match counter is never written');
  h.invariants();
  h.m.dispose();
});

// 业主 2026-10-26「背水一战锁血没触发」：卡在获得时把 LP 设为 1 并开一个 2 回合的锁血窗口
// （applyHexExtras 把 `window = 获得回合 + lockRounds - 1` 写进 ref）。战斗开始时 sim 的
// `onBattleStart.lastDitchArm` 会往同一个 ref 上盖 `lastDitch` —— 它原本是**照记录重建**（记录里没有 `window`），
// 于是第一场战斗一打完窗口就丢了，锁血只护住获得的那一回合，第二回合照样掉血。这条用例专门盯这个覆盖。
test('背水一战: the 锁血 window survives the battles it arms (2 rounds, not 1)', () => {
  const h = makeMatch({ mode: 'solo', difficulty: 'FUNNY', seed: 31, fake: true }).start();
  h.toPrep(1);
  const ps = h.ps('p_0');
  applyHex(h.m, ps, h.m.gd.hex('hex_lastditch'));
  assert.equal(ps.lp, 1, 'the pick sets LP to 1');
  assert.equal(lpLockUntilOf(ps), 2, 'window = pick round + lockRounds − 1');
  assert.equal(lpLockedIn(ps, 1), true, 'the pick round is locked');
  h.toPrep(2);   // one battle (and one lastDitchArm) later
  assert.equal(lpLockUntilOf(ps), 2, 'the window is still there after the battle armed the card');
  assert.equal(lpLockedIn(ps, 2), true, 'the SECOND round is locked too (the bug: it was not)');
  h.toPrep(3);
  assert.equal(lpLockedIn(ps, 3), false, 'and the window closes after that');
  h.invariants();
  h.m.dispose();
});

// 业主 2026-10-26 追问：`lastDitchArm` 那种「照记录重建 params」是**一类**风险 —— 同一个 EffectRef 有两个写者
// （match 在获得时写窗口，sim 的战斗/回合钩子后写同一份）。现在在引擎层把它堵死：`ctx.addEffect` 对已存在的 ref
// **合并** params，而不是整体替换，于是任何只写自己那部分的写者都不会再抹掉别人的字段。
test('addEffect merges nested params, so a partial write cannot erase another owner\'s field', async () => {
  const { makeCtx } = await import('../../server/match/effectsMeta.js');
  const h = makeMatch({ mode: 'solo', difficulty: 'FUNNY', seed: 41, fake: true }).start();
  h.toPrep(1);
  const ps = h.ps('p_0');
  const ref = { id: 'hex:probe', key: 'hex:probe', params: { window: 2, keep: 'yes' } };
  ps.effects.push(ref);
  const ctx = makeCtx(h.m, ps, { kind: 'effect', key: 'hex:probe', ref }, 'onBattleStart', null);
  ctx.addEffect({ id: 'hex:probe', params: { active: true } });
  assert.deepEqual(ref.params, { window: 2, keep: 'yes', active: true }, 'the partial write kept the other owner\'s fields');
  ctx.addEffect({ id: 'hex:probe', params: { window: 9 } });
  assert.deepEqual(ref.params, { window: 9, keep: 'yes', active: true }, 'and a later write of the same key wins for its own field only');
  h.invariants();
  h.m.dispose();
});

// 业主 2026-10-24「为什么二次抽取只生效了一个」：复制只重放了卡自己的 onHexPick，而「额外随机两枚」那半边在
// `applyHexExtras` 里 —— 于是复制出来的那份只拿到一个空 ref，随机两枚只发了一次。现在副本也走 extras。
// (2026-10-25: 管理员 no longer copies on gain; this drives the copy seam directly.)
test('复制机制 + 二次抽取: the copy rolls its own 额外随机两枚 too (four random cards, not two)', () => {
  const h = makeMatch({ mode: 'solo', difficulty: 'FUNNY', seed: 71, fake: true }).start();
  h.toPrep(1);
  const ps = h.ps('p_0');
  armCopyBuff(h, ps);
  applyHex(h.m, ps, h.m.gd.hex('hex_double'));
  applyBandHexCopy(h.m, ps, h.m.gd.hex('hex_double'));
  const refs = ps.effects.filter((e) => typeof e.key === 'string' && e.key.startsWith('hex:'));
  assert.equal(refs.filter((e) => e.key === 'hex:hex_double').length, 2, '二次抽取 itself is a double');
  // the match's own starting card is neither of them; ignore it
  const before = 1;
  const randoms = refs.filter((e) => e.key !== 'hex:hex_double' && e.key !== 'hex:hex_weaponmaster');
  // Each of the two copies rolls its own 「额外随机两枚」 ⇒ four cards. The COUNT is what this pins; the identities are
  // drawn from the live pool and change whenever the roster grows (e.g. 复制 joined it on 2026-10-25). A random draw may
  // itself be a card that grants more (复制 copies another card), so allow the pool's own effects to add a little: the
  // floor is 4 and the assertion on distinct ids below still holds.
  assert.ok(randoms.length >= 4, `each copy rolls two, so at least four random hexes (got ${randoms.length}: ${randoms.map((e) => e.key).join(',')})`);
  assert.equal(new Set(randoms.map((e) => e.data.hexId)).size, randoms.length, 'no duplicated random card');
  h.invariants();
  h.m.dispose();
});
