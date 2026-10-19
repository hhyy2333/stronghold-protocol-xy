// test/content/hextech.test.js — 海克斯 (Hextech) content and rolls (DESIGN §29).
//
// Covers: data/hextech.json is exactly what tools/build-hextech.mjs generates, the roster's invariants (52 hexes, known
// rarities, an icon per hex, bounded enemy multipliers), that every player hex has a `hex:<id>` handler registered
// (including the `tier: 'level'` operator grants of 量产线 / 精锐预兆), and the pure draft rolls of shared/hextech.js
// (weighted, no repeats, adjacent-rarity fallback).

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { DATA } from '../match/harness.js';
import { getDefaultRegistry } from '../../server/match/effectsMeta.js';
import { buildHextech, hextechText, validateHextech, OUT_FILE } from '../../tools/build-hextech.mjs';
import { hexIds, battleModsOf, BATTLE_SPEC_KEYS, hasBattlePart, HEX_SCRIPT_KEYS } from '../../server/sim/content/hextech.js';
import { applyEnemyHexes, enemyHexPayout } from '../../server/match/hextech.js';
import {
  rollOffers, pickEnemyRarity, pickEnemyHex, sumEnemyMods, rarityFallbackOrder, RARITY_ORDER, HEX_ROUNDS, hexEffectKey,
  ENEMY_VERBS,
} from '../../shared/hextech.js';
import { createRng } from '../../server/sim/rng.js';

const HEXTECH = DATA.hextech;
const PLAYER = Object.values(HEXTECH.playerHexes);
const ENEMY = Object.values(HEXTECH.enemyHexes);

test('data/hextech.json is what tools/build-hextech.mjs generates (run: node tools/build-hextech.mjs)', () => {
  assert.equal(fs.readFileSync(OUT_FILE, 'utf8'), hextechText(buildHextech()));
});

test('roster: 100 player + 38 enemy hexes, unique ids, known rarities and an effect each (no art named)', () => {
  assert.deepEqual(validateHextech(buildHextech()), []);
  // tenth batch (the owner's list of 2026-10-15): 11 more player cards (79 -> 90) — 反击装甲 and 紧急拨款 are
  // REBALANCES of existing records, not additions, so they do not move the count.
  // thirteenth batch (业主 2026-10-19): 10 more player cards (90 -> 100).
  assert.equal(PLAYER.length, 100);
  // ninth batch (the same list): 14 more enemy cards. 24 -> 38.
  assert.equal(ENEMY.length, 38);
  const ids = new Set([...PLAYER, ...ENEMY].map((h) => h.id));
  assert.equal(ids.size, 138);
  const rarities = new Set(HEXTECH.rarities.map((r) => r.id));
  assert.deepEqual([...rarities], [...RARITY_ORDER]);
  for (const h of PLAYER) {
    assert.ok(rarities.has(h.rarity), h.id);
    // the roster names no art: the third-party rune icons were removed on 2026-10-12 (the card face is the tier art)
    assert.equal(h.icon, undefined, `${h.id} must not name a rune`);
    // any effect key counts: the third batch has ownership-only cards (`bondShare`, `killGift`, `bountyMul`, …) next to
    // the hook-driven ones (onPick / onRoundStart / onBuy / …)
    assert.ok(h.effect && Object.keys(h.effect).length > 0, `${h.id} has an effect`);
  }
  for (const h of ENEMY) {
    assert.ok(rarities.has(h.rarity), h.id);
    // an enemy hex is EITHER a wave-scale `mods` card OR a `verb` script (DESIGN §29.10) — the third batch added verbs,
    // so `mods` alone is no longer required (and a verb card needs no `mods` at all)
    const verb = typeof h.verb === 'string' ? h.verb : '';
    assert.ok(verb || Object.keys(h.mods || {}).length, `${h.id} needs mods or a verb`);
    if (verb) assert.ok(ENEMY_VERBS.includes(verb), `${h.id}: unknown verb ${verb}`);
    for (const [k, v] of Object.entries(h.mods || {})) {
      assert.ok(['hpMul', 'atkMul', 'defMul', 'resMul', 'speedMul', 'supplyHpMul', 'countAdd', 'countSub'].includes(k), `${h.id}: ${k}`);
      // countAdd / countSub are absolute bodies; the multipliers are trade-offs now, so < 1 is allowed
      if (k === 'countAdd' || k === 'countSub') assert.ok(Number.isInteger(v) && v >= 1 && v <= 3, `${h.id}: ${k} = ${v}`);
      // move speed is its own axis (tools/build-hextech.mjs carries the reasoning): ±50 % is the owner's own number
      else if (k === 'speedMul') assert.ok(v > 0.25 && v <= 2, `${h.id}: ${k} = ${v}`);
      else assert.ok(v > 0.5 && v <= 1.35, `${h.id}: ${k} = ${v}`);
    }
    if (h.payout) assert.ok(Number.isInteger(h.payout.perLeak) && h.payout.perLeak >= 1, `${h.id}: payout.perLeak`);
  }
  // every verb of the shared vocabulary is exercised by the roster (a dead id in ENEMY_VERBS is a lie the sim tells
  // itself: `installEnemyVerbs` would look it up and find nothing)
  assert.deepEqual([...new Set(ENEMY.filter((h) => h.verb).map((h) => h.verb))].sort(), [...ENEMY_VERBS].sort());
  // the schedule the engine reads (config-style round list)
  assert.deepEqual(HEXTECH.format.rounds, [...HEX_ROUNDS]);
  assert.equal(HEXTECH.format.offer, 3);
  assert.equal(HEXTECH.format.rerolls, 1);
  assert.equal(HEXTECH.format.enemyPerDraw, 1);
});

test('every player hex has a registered hex: handler with onHexPick and onRoundStart (choices.test.js style)', () => {
  const reg = getDefaultRegistry();
  const ids = hexIds();
  assert.equal(ids.length, 100);
  for (const id of ids) {
    const h = reg.get(hexEffectKey(id));
    assert.ok(h, `hex:${id} handler`);
    assert.equal(typeof h.onHexPick, 'function', `${id}.onHexPick`);
    assert.equal(typeof h.onRoundStart, 'function', `${id}.onRoundStart`);
  }
});

/** A ctx stub for the prep-side spec branches (only what each branch touches). */
function ctxStub(over = {}) {
  const s = {
    funds: 0, pending: 0, counters: {}, effects: {}, slot: null, bonuses: {}, ev: null, lp: 12, price: null, promoted: [],
    round: 3,
    addFunds(n) { s.funds += n; }, addPendingFunds(n) { s.pending += n; },
    grantFreeRefresh(n = 1) { s.freeRefresh = (s.freeRefresh || 0) + n; return s.freeRefresh; },
    spendLp(n) { s.lp = Math.max(1, s.lp - n); return s.lp; },
    incCounter(k, n = 1) { s.counters[k] = (s.counters[k] || 0) + n; return s.counters[k]; },
    counter: (k) => s.counters[k] || 0,
    setCounter(k, n) { s.counters[k] = n; return n; },
    effect: (id) => s.effects[id] || null,
    addEffect(ref) { s.effects[ref.id] = { ...(s.effects[ref.id] || {}), ...ref }; return s.effects[ref.id]; },
    setShopSlot(i, slot) { s.slot = { i, slot }; return true; },
    setBondCountBonus(bondId, n) { s.bonuses[bondId] = n; },
    modifyPrice(delta) { if (s.ev) s.ev.price = Math.max(0, (s.ev.price || 0) + delta); s.price = s.ev ? s.ev.price : null; return s.price; },
    promote(uid) { s.promoted.push(uid); return true; },
    bondActive: () => false,
    chessRecord: () => null,
    board: () => [{ kind: 'chess', id: 'chess_char_1_01' }],
    rng: () => 0,
    shopLevel: () => 3,
    event: () => s.ev,
    bonds: () => ({}),
    gd: DATA,
    ...over,
  };
  return s;
}

test('源石红利: it accrues what the round spends and pays 1 per 5 at the next round start (remainder kept)', () => {
  const reg = getDefaultRegistry();
  const h = reg.get(hexEffectKey('hex_dividend'));
  const ctx = ctxStub();
  ctx.ev = { amount: 7, reason: 'refresh' };
  h.onSpend(ctx);
  ctx.ev = { amount: 5, reason: 'levelUp' };
  h.onSpend(ctx);
  assert.equal(ctx.counter('hex:hex_dividend:spent'), 12);
  h.onRoundStart(ctx);
  assert.equal(ctx.funds, 2, '12 spent → 2 funds');
  assert.equal(ctx.counter('hex:hex_dividend:spent'), 2, 'the remainder carries over');
  h.onRoundStart(ctx);
  assert.equal(ctx.funds, 2, 'less than 5 spent pays nothing');
});

test('调度直播: it rewrites the first shop slot with a random own-board operator', () => {
  const reg = getDefaultRegistry();
  const ctx = ctxStub({ board: () => [{ kind: 'chess', id: 'chess_char_1_01' }, { kind: 'token', id: 't' }] });
  reg.get(hexEffectKey('hex_broadcast')).onRoundStart(ctx);
  assert.deepEqual(ctx.slot, { i: 0, slot: { kind: 'chess', id: 'chess_char_1_01' } });
  const empty = ctxStub({ board: () => [] });
  reg.get(hexEffectKey('hex_broadcast')).onRoundStart(empty);
  assert.equal(empty.slot, null, 'an empty board writes nothing');
});

test('传承: every sale adds +2 % to the bonds of the sold operator, on the hex’s own ref', () => {
  const reg = getDefaultRegistry();
  const h = reg.get(hexEffectKey('hex_heritage'));
  const chess = Object.values(DATA.chess).find((c) => Array.isArray(c.bonds) && c.bonds.length === 2);
  assert.ok(chess, 'a two-bond operator exists');
  const ctx = ctxStub({ gd: { chess: (id) => DATA.chess[id] || null } });
  ctx.effect('hex:hex_heritage');
  ctx.effects['hex:hex_heritage'] = { id: 'hex:hex_heritage', params: {} };
  ctx.ev = { piece: { kind: 'chess', id: chess.chessId } };
  h.onSold(ctx);
  h.onSold(ctx);
  const acc = ctx.effects['hex:hex_heritage'].params.battle.bondAtk;
  for (const b of chess.bonds) assert.equal(acc[b], 4, `${b} accumulated twice`);
});

test('战损回收: 2 funds per LP actually charged this round, capped at 12', () => {
  const reg = getDefaultRegistry();
  const h = reg.get(hexEffectKey('hex_recovery'));
  const leak = (counted) => ({ enemyKey: 'e', counted });
  // Owner's decision 2026-10-18: the card pays for the damage TAKEN, not for the leaks — 2 per LP, cap 12.
  // `ev.lpLoss` is the settlement's own number (settle.js), so a 联防 leaker charged only for what got past the
  // helpers, and a protocol level's extra leak LP, both count through this one reading.
  const at = (lpLoss) => {
    const ctx = ctxStub();
    ctx.ev = { result: { leaked: [leak(true), leak(true)] }, lpLoss };
    h.onBattleResult(ctx);
    return ctx.pending;
  };
  assert.equal(at(1), 2, '1 LP × 2');
  assert.equal(at(2), 4, '2 LP × 2');
  assert.equal(at(3), 6, '3 LP × 2');
  // the cap is per round, unchanged at 12
  assert.equal(at(5), 10);
  assert.equal(at(6), 12, '6 LP × 2 = 12, exactly the cap');
  assert.equal(at(9), 12, '9 LP × 2 = 18 is capped at 12');
  // nothing charged ⇒ nothing paid (a perfect round, or a 联防 that held)
  assert.equal(at(0), 0, 'no LP charged pays nothing');
  assert.equal(at(undefined), 0, 'an event without lpLoss pays nothing');
  // leaks alone no longer pay: 9 leaks with 0 LP charged is 0 (the old shape paid 9)
  const leakOnly = ctxStub();
  leakOnly.ev = { result: { leaked: Array.from({ length: 9 }, () => leak(true)) }, lpLoss: 0 };
  h.onBattleResult(leakOnly);
  assert.equal(leakOnly.pending, 0, 'leaks alone pay nothing now — the LP charged is what pays');
  // the bundled card no longer carries the old keys
  const decl = HEXTECH.playerHexes.hex_recovery;
  assert.deepEqual(decl.effect.onBattleResult, { perLpLoss: 2, cap: 12 });
  assert.ok(!('perLeak' in decl.effect.onBattleResult), 'the leak-counting keys are gone from the bundled card');
});

test('盟约之主: the most numerous bond needs 1 fewer operator, and the bonus follows the board', () => {
  const reg = getDefaultRegistry();
  const h = reg.get(hexEffectKey('hex_overlord'));
  const ids = DATA.config ? Object.keys(DATA.bonds).slice(0, 3) : [];
  const counts = { [ids[0]]: 1, [ids[1]]: 4, [ids[2]]: 2 };
  const ctx = ctxStub({ bonds: () => counts, bond: (id) => ({ count: counts[id] || 0, active: true }), gd: { ...DATA, bondIds: ids } });
  h.onRoundStart(ctx);
  assert.deepEqual(ctx.bonuses, { [ids[1]]: 1 }, 'the 4-operator bond is the main one');
  counts[ids[2]] = 6;
  h.onRoundStart(ctx);
  assert.deepEqual(ctx.bonuses, { [ids[1]]: 0, [ids[2]]: 1 }, 'the old bonus is cleared when the main bond moves');
});

// ---- third batch (0.3.0 playtest #3): the prep-side specs -------------------------------------------------------------

test('因小失大: 附加盟约 need one fewer member, 核心盟约 one more (调和 and 独行 left out)', () => {
  const reg = getDefaultRegistry();
  const bonds = {
    yanShip: { bondId: 'yanShip', isCore: true },
    preciShip: { bondId: 'preciShip', isCore: false },
    maniShip: { bondId: 'maniShip', isCore: false },
    soloShip: { bondId: 'soloShip', isCore: false },
  };
  const ctx = ctxStub({ gd: { bondIds: Object.keys(bonds), bond: (id) => bonds[id] || null } });
  reg.get(hexEffectKey('hex_pyrrhic')).onHexPick(ctx);
  assert.deepEqual(ctx.bonuses, { yanShip: -1, preciShip: 1 }, 'core −1 member (harder), add-on +1 (easier)');
});

test('层数转移: battle start moves half the lowest active bond’s layers to the highest one', () => {
  const reg = getDefaultRegistry();
  const ctx = ctxStub();
  ctx.ev = { input: { bonds: { yanShip: { active: true, layers: 10 }, preciShip: { active: true, layers: 31 }, dead: { active: false, layers: 99 } } } };
  reg.get(hexEffectKey('hex_layershift')).onBattleStart(ctx);
  assert.equal(ctx.ev.input.bonds.yanShip.layers, 5, 'the lowest (10 → 5) pays half into the highest');
  assert.equal(ctx.ev.input.bonds.preciShip.layers, 36, '31 + 5');
  assert.equal(ctx.ev.input.bonds.dead.layers, 99, 'an inactive bond never takes part');
  const solo = ctxStub();
  solo.ev = { input: { bonds: { yanShip: { active: true, layers: 9 } } } };
  reg.get(hexEffectKey('hex_layershift')).onBattleStart(solo);
  assert.equal(solo.ev.input.bonds.yanShip.layers, 9, 'one active bond: nothing to transfer');
});

test('商店契约: free refreshes, and the first operator after a refresh costs 1 less', () => {
  const reg = getDefaultRegistry();
  const h = reg.get(hexEffectKey('hex_shopcontract'));
  const ctx = ctxStub();
  h.onHexPick(ctx);
  assert.equal(ctx.counter('hex:hex_shopcontract:armed'), 0, 'nothing is armed before a refresh');
  ctx.ev = { kind: 'chess', price: 4, slot: { id: 'chess_char_1_01' } };
  h.onPrice(ctx);
  assert.equal(ctx.ev.price, 4, 'no discount without a refresh');
  ctx.ev = { slots: [], free: false, price: 1 };
  h.onRefresh(ctx);
  ctx.ev = { kind: 'chess', price: 4, slot: { id: 'chess_char_1_01' } };
  h.onPrice(ctx);
  assert.equal(ctx.ev.price, 3, 'the first operator after the refresh is 1 cheaper');
  ctx.ev = { piece: { kind: 'chess', uid: 1 }, slot: { id: 'chess_char_1_01' }, price: 3, kind: 'chess' };
  h.onBuy(ctx);
  ctx.ev = { kind: 'chess', price: 4, slot: { id: 'chess_char_2_01' } };
  h.onPrice(ctx);
  assert.equal(ctx.ev.price, 4, 'only the first purchase is discounted');
});

test('精英共鸣: 5 % per elite on the board promotes the operator just bought', () => {
  const reg = getDefaultRegistry();
  const h = reg.get(hexEffectKey('hex_eliteresonance'));
  const board = [{ kind: 'chess', golden: true }, { kind: 'chess', golden: true }, { kind: 'chess', golden: false }];
  const hit = ctxStub({ board: () => board, rng: () => 0.05 });
  hit.ev = { kind: 'chess', piece: { kind: 'chess', uid: 7 } };
  h.onBuy(hit);
  assert.deepEqual(hit.promoted, [7], '2 elites → 10 %; the roll 0.05 promotes');
  const miss = ctxStub({ board: () => board, rng: () => 0.5 });
  miss.ev = { kind: 'chess', piece: { kind: 'chess', uid: 8 } };
  h.onBuy(miss);
  assert.deepEqual(miss.promoted, [], '0.5 ≥ 10 %: no promotion');
  const none = ctxStub({ board: () => board, rng: () => 0 });
  const noBoard = ctxStub({ board: () => [], rng: () => 0 });
  noBoard.ev = { kind: 'chess', piece: { kind: 'chess', uid: 9 } };
  h.onBuy(noBoard);
  assert.deepEqual(noBoard.promoted, [], 'no elite on the board: 0 %');
  void none;
});

test('装备转化: a discarded (player) item pays its price back; a replaced one does not', () => {
  const reg = getDefaultRegistry();
  const h = reg.get(hexEffectKey('hex_itemrefund'));
  const gd = { ...DATA, itemPrice: () => 2 };
  const ctx = ctxStub({ gd });
  ctx.ev = { item: { kind: 'item', id: 'chess_item_1_01_e_a' }, reason: 'player' };
  h.onDestroy(ctx);
  assert.equal(ctx.funds, 2, 'the price comes back');
  const replace = ctxStub({ gd });
  replace.ev = { item: { kind: 'item', id: 'chess_item_1_01_e_a' }, reason: 'replace' };
  h.onDestroy(replace);
  assert.equal(replace.funds, 0, 'a replaced item is not a discard');
});

test('远见透支: a 远见-discounted purchase costs 1 life', () => {
  const reg = getDefaultRegistry();
  const h = reg.get(hexEffectKey('hex_foresightdebt'));
  const data = { bonds: { visiShip: { buffs: [{ key: 'bond_multi_layer_char_goods_price_bond_discount', bb: { discount: 1, bond: 'visiShip' } }] } } };
  const ctx = ctxStub({
    data, bondActive: (id) => id === 'visiShip', chessRecord: () => ({ bonds: ['visiShip'] }),
    counters: { 'bondaddon:visi:disc': 1 },
  });
  ctx.ev = { kind: 'chess', price: 2, slot: { id: 'chess_char_1_01' } };
  h.onBuy(ctx);
  assert.equal(ctx.lp, 11, '1 life paid');
  const other = ctxStub({
    data, bondActive: (id) => id === 'visiShip', chessRecord: () => ({ bonds: ['yanShip'] }),
    counters: { 'bondaddon:visi:disc': 1 },
  });
  other.ev = { kind: 'chess', price: 3, slot: { id: 'chess_char_2_01' } };
  h.onBuy(other);
  assert.equal(other.lp, 12, 'tier 1 only discounts 远见 operators: someone else pays nothing');
});

test('孤注一掷: the data declares a four-round battle passive (the ref carries the expiry)', () => {
  const reg = getDefaultRegistry();
  assert.equal(typeof reg.get(hexEffectKey('hex_allin')).onHexPick, 'function');
  const rec = HEXTECH.playerHexes.hex_allin;
  assert.deepEqual(rec.effect.battleForRounds, { rounds: 4, battle: { atkPct: 200 } });
});

test('chess grants: `tier: \'level\'` draws the current 调度中心 level tier (量产线 / 精锐预兆)', () => {
  const reg = getDefaultRegistry();
  /** A ctx stub recording the tiers and how many operators were asked for. */
  const ctxAt = (level) => {
    const rolls = [];
    const grants = [];
    return {
      rolls, grants, level,
      shopLevel: () => level,
      rollChess: ({ tier }) => { rolls.push(tier); return `chess_char_${tier}_01`; },
      grantChess: (id) => { grants.push(id); return { id }; },
    };
  };
  for (const level of [1, 3, 6]) {
    const mass = ctxAt(level);
    reg.get(hexEffectKey('hex_massprod')).onRoundStart(mass);
    assert.deepEqual(mass.rolls, [level], `量产线 at level ${level}`);
    assert.equal(mass.grants.length, 1);
    // 精锐预兆 grants three copies of ONE operator (同名 3 张 → it merges on the spot)
    const recruit = ctxAt(level);
    const h = reg.get(hexEffectKey('hex_recruit'));
    h.onHexPick(recruit);
    assert.deepEqual(recruit.rolls, [level], `精锐预兆 rolls once at level ${level}`);
    assert.deepEqual(recruit.grants, [`chess_char_${level}_01`, `chess_char_${level}_01`, `chess_char_${level}_01`], 'three copies of the same operator');
    recruit.rolls.length = 0;
    h.onRoundStart(recruit);
    assert.deepEqual(recruit.rolls, [], '精锐预兆 has no per-round part any more');
  }
});

test('rollOffers: 3 distinct hexes the player does not own, drawn by rarity weight', () => {
  const rng = createRng(4242);
  const weights = Object.fromEntries(HEXTECH.rarities.map((r) => [r.id, r.weight]));
  const first = rollOffers(rng, { pool: PLAYER, weights, owned: [], count: 3 });
  assert.equal(first.length, 3);
  assert.equal(new Set(first).size, 3);
  for (const id of first) assert.ok(PLAYER.some((h) => h.id === id), id);
  // owned hexes are never offered again
  const again = rollOffers(rng, { pool: PLAYER, weights, owned: first, count: 3 });
  for (const id of again) assert.ok(!first.includes(id), `${id} was already owned`);
  // the weights favour silver over prismatic (seeded, deterministic)
  const rng2 = createRng(7);
  let silver = 0;
  let prismatic = 0;
  for (let i = 0; i < 200; i++) {
    for (const id of rollOffers(rng2, { pool: PLAYER, weights, owned: [], count: 3 })) {
      const h = PLAYER.find((x) => x.id === id);
      if (h.rarity === 'silver') silver++;
      else if (h.rarity === 'prismatic') prismatic++;
    }
  }
  assert.ok(silver > prismatic * 2, `silver ${silver} vs prismatic ${prismatic}`);
  // an exhausted pool gives fewer than `count`
  assert.equal(rollOffers(rng, { pool: PLAYER.slice(0, 2), weights, owned: [], count: 3 }).length, 2);
});

test('enemy draws: one hex of the picked rarity, never a repeat, adjacent rarity when that pool is empty', () => {
  const rng = createRng(99);
  assert.equal(pickEnemyRarity(rng, ['gold', 'silver', 'gold']), pickEnemyRarity(createRng(99), ['gold', 'silver', 'gold']), 'deterministic');
  const rarity = pickEnemyRarity(rng, ['silver']);
  assert.equal(rarity, 'silver');
  const first = pickEnemyHex(rng, { pool: ENEMY, owned: [], rarity: 'silver' });
  assert.equal(ENEMY.find((h) => h.id === first).rarity, 'silver');
  // every silver hex owned → falls through to the adjacent rarity instead of repeating
  const allSilver = ENEMY.filter((h) => h.rarity === 'silver').map((h) => h.id);
  const next = pickEnemyHex(rng, { pool: ENEMY, owned: allSilver, rarity: 'silver' });
  assert.ok(next && !allSilver.includes(next), `fell back to ${next}`);
  // the whole pool owned → null
  assert.equal(pickEnemyHex(rng, { pool: ENEMY, owned: ENEMY.map((h) => h.id), rarity: 'prismatic' }), null);
  assert.deepEqual(rarityFallbackOrder('prismatic'), ['prismatic', 'gold', 'silver']);
  assert.deepEqual(rarityFallbackOrder('silver'), ['silver', 'gold', 'prismatic']);
});

test('sumEnemyMods multiplies the owned hexes, with the cumulative bound kept sane', () => {
  // a verb card carries no `mods` at all (DESIGN §29.10), so the HP sweep only looks at the multiplier cards
  const hp = ENEMY.filter((h) => h.mods && h.mods.hpMul).sort((a, b) => b.mods.hpMul - a.mods.hpMul);
  const merged = sumEnemyMods(hp.slice(0, 3));
  // The worst three draws. This WAS 2.025 (1.35 × 1.25 × 1.20: 巨兽之魂 / 深渊灌注 / 过路费) with a 2.05 ceiling.
  //
  // 精英化 (the owner's list of 2026-10-15) enters at +30 % HP, so the new worst case is 1.35 × 1.30 × 1.25 = 2.19375
  // and the ceiling moves to 2.20. That is a DELIBERATE widening, not a drift: the card was given as "+30 % ATK / DEF /
  // HP" and it pays for it with 10 % fewer bodies (countSub), which is exactly the trade 虫群 makes in the other
  // direction. Recorded here and in docs/BALANCE.md §8 so the next data change cannot move it silently.
  assert.ok(merged.hpMul > 1 && merged.hpMul <= 2.20, `three HP hexes = ${merged.hpMul}`);
  assert.deepEqual(sumEnemyMods([]), {});
  assert.deepEqual(sumEnemyMods([{ mods: { atkMul: 1.1 } }, { mods: { atkMul: 1.2, speedMul: 1.1 } }]), { atkMul: 1.32, speedMul: 1.1 });
  // A verb card CAN carry a small trade-off multiplier (the ninth batch's 物转法 −30 % ATK, 势不可挡 −50 % speed), so
  // the check is not "verbs are empty" — it is the thing that actually matters: a verb card can never move the HP
  // ceiling. (It used to read `deepEqual(sumEnemyMods(verbs), {})`, which the new cards made false without any
  // balance meaning: no HP multiplier is involved.)
  const verbs = ENEMY.filter((h) => h.verb);
  assert.ok(verbs.length > 0, 'the roster has verb cards');
  assert.deepEqual(sumEnemyMods(verbs).hpMul, undefined, 'a verb card carries no HP multiplier');
});

test('the battle part of a hex ref becomes operator mods (directMods vocabulary)', () => {
  // the fifth batch (2026-10-11) put a script key beside the passive: `drill` / `armor` are BATTLE_SPEC_KEYS, not mods,
  // so battleModsOf keeps reading only the `battle` half (a script key that leaked into `mods` would corrupt the stats).
  assert.deepEqual(battleModsOf({ battle: { atkPct: 20, aspd: 10 }, drill: { atkPerRound: 5, aspdPerRound: 4 } }), { atkPct: 0.2, aspd: 10 });
  // the v0.3.0 name of the ASPD field is still read (an already-built data set)
  assert.deepEqual(battleModsOf({ battle: { atkPct: 10, aspdPct: 8 } }), { atkPct: 0.1, aspd: 8 });
  assert.deepEqual(battleModsOf({ battle: { defPct: 18, resFlat: 10 }, armor: { defRatio: 100 } }), { defPct: 0.18, resFlat: 10 });
  assert.deepEqual(battleModsOf({ battle: { maxHpPct: 12, firstLeakFree: true } }), { hpPct: 0.12 });
  assert.equal(battleModsOf({}), null);
  assert.equal(battleModsOf(null), null);
});

test('虫群 (countAdd) adds enemies to the normal groups and keeps the leader alone', () => {
  const spawns = [
    { enemyKey: 'e1', count: 4, tag: null, mods: { hpMul: 1.1, slot: 'N' } },
    { enemyKey: 'boss', count: 1, tag: 'boss', mods: { atkMul: 1.1, slot: 'N' } },
  ];
  const out = applyEnemyHexes(spawns, { countAdd: 1, hpMul: 0.92 });
  assert.equal(out[0].count, 5, 'one more of the normal group');
  assert.ok(Math.abs(out[0].mods.hpMul - 1.1 * 0.92) < 1e-9, 'the trade-off multiplier rides along');
  assert.equal(out[1].count, 1, 'the leader is never multiplied out');
  assert.equal(out[1].mods.atkMul, 1.1, 'and keeps the leader mod set (no hpMul)');
  assert.equal(spawns[0].count, 4, 'copy-on-write: the shared wave spec is untouched');
  // no hex at all: the same array comes back
  assert.equal(applyEnemyHexes(spawns, null), spawns);
});

test('enemyHexPayout reads the enemy side’s paying hex (过路费)', () => {
  const m = { gd: { hex: (id) => HEXTECH.enemyHexes[id] || null }, enemyHexes: [{ id: 'ehex_toll' }] };
  assert.deepEqual(enemyHexPayout(m), { perLeak: 1, cap: Infinity });
  assert.equal(enemyHexPayout({ ...m, enemyHexes: [{ id: 'ehex_fury' }] }), null);
  assert.equal(enemyHexPayout({ ...m, enemyHexes: [] }), null);
});

// ---- fourth batch (the owner's review of 2026-10-09): the 13 new player hexes ----------------------------------------

test('战功簿: funds per 5 knock-outs, capped a round (the mirror of 战损回收)', () => {
  const reg = getDefaultRegistry();
  const h = reg.get(hexEffectKey('hex_merit'));
  const at = (killed) => {
    const ctx = ctxStub();
    ctx.ev = { result: { killed, leaked: [], perfect: true } };
    h.onBattleResult(ctx);
    return ctx.pending;
  };
  assert.equal(at(4), 0, 'below the step pays nothing');
  assert.equal(at(5), 1, 'exactly 5 → 1');
  assert.equal(at(14), 2, 'floor(14/5) = 2');
  assert.equal(at(100), 4, 'capped at 4 a round');
  assert.equal(at(0), 0, 'a battle without kills pays nothing');
});

test('配给制: a sale pays +1, at most 5 a round, and the cap resets with the round', () => {
  const reg = getDefaultRegistry();
  const h = reg.get(hexEffectKey('hex_rationing'));
  const ctx = ctxStub();
  ctx.ev = { piece: { kind: 'chess', id: 'chess_char_1_01_a' }, gain: 1 };
  for (let i = 0; i < 6; i++) h.onSold(ctx);
  assert.equal(ctx.funds, 5, 'five sales pay, the sixth is capped');
  // an item is never a sale of an operator
  const items = ctxStub();
  items.ev = { piece: { kind: 'item', id: 'chess_item_1_01_e_a' }, gain: 1 };
  h.onSold(items);
  assert.equal(items.funds, 0, 'an item sale pays nothing');
  // the counter is keyed by the round: the next round pays again
  ctx.round = 4;
  h.onSold(ctx);
  assert.equal(ctx.funds, 6, 'a new round resets the cap');
});

test('军需官: a level-up refunds half the price paid (floored)', () => {
  const reg = getDefaultRegistry();
  const h = reg.get(hexEffectKey('hex_quartermaster'));
  const at = (price) => {
    const ctx = ctxStub();
    ctx.ev = { level: 4, price };
    h.onLevelUp(ctx);
    return ctx.funds;
  };
  assert.equal(at(8), 4, '8 → 4');
  assert.equal(at(5), 2, '5 → floor(2.5) = 2');
  assert.equal(at(0), 0, 'a free level-up refunds nothing');
  assert.equal(at(undefined), 0, 'no price in the event → nothing');
});

test('军械库: the item spec names a choices.json pool, not a tier (the pool carries "≤ shop level")', () => {
  const rec = HEXTECH.playerHexes.hex_arsenal;
  assert.deepEqual(rec.effect.onRoundStart, { item: { pool: 'pool_equip_normal', count: 1 } });
  // the pool the card names is the shop-eligible one capped at the shop level
  const pool = DATA.choices.pools.pool_equip_normal;
  assert.ok(pool, 'pool_equip_normal exists');
  assert.equal(pool.kind, 'equip');
  assert.equal(pool.maxTier, 'shopLevel', 'the pool itself is what caps the tier at the 调度中心 level');
});

test('军械库 through the real ctx: the pool branch rolls and grants; 后勤整备 walks the 进阶 tier ladder', () => {
  const reg = getDefaultRegistry();
  // a ctx recording whether the pool path was taken and what was granted
  const rolls = [];
  const grants = [];
  const ctx = ctxStub({
    rollPool: (poolId) => { rolls.push(poolId); return { kind: 'item', id: 'chess_item_2_01_e_a' }; },
    rollItem: () => 'chess_item_1_01_e_a',
    grantItem: (id) => { grants.push(id); return { id }; },
  });
  reg.get(hexEffectKey('hex_arsenal')).onRoundStart(ctx);
  assert.deepEqual(rolls, ['pool_equip_normal'], 'the pool branch is taken');
  assert.deepEqual(grants, ['chess_item_2_01_e_a'], 'the rolled item is granted');
  // 后勤整备 (2026-10-12 rebalance) takes NEITHER branch: it grants a GOLDEN (进阶) item, and the every-2-rounds half
  // asks for one tier above the last one it actually granted (x = 上次获得装备阶级)
  const asked = [];
  const golden = [];
  const ladder = ctxStub({
    rollPool: () => { throw new Error('后勤整备 must not use the pool path'); },
    rollItem: () => { throw new Error('后勤整备 must not use the base-item path'); },
    rollGoldenItem: ({ tier }) => { asked.push(tier); return `golden_t${tier}`; },
    grantItem: (id) => { golden.push(id); return { id }; },
  });
  reg.get(hexEffectKey('hex_logistics')).onHexPick(ladder);
  assert.deepEqual(asked, [1], 'the pick grants a 1 阶进阶装备');
  assert.deepEqual(golden, ['golden_t1'], 'the golden item is granted');
  reg.get(hexEffectKey('hex_logistics')).onRoundStart(ladder);
  assert.deepEqual(asked, [1, 2], 'x = 上次获得装备阶级 + 1');
  assert.deepEqual(golden, ['golden_t1', 'golden_t2']);
  // a golden takes TWO spare copies of its base item out of the shared stock, so a round with none grants nothing and
  // does NOT advance the ladder — the next scheduled round asks for the same tier again
  const dry = [];
  const barren = ctxStub({
    rollGoldenItem: ({ tier }) => { dry.push(tier); return null; },
    grantItem: () => { throw new Error('a null roll grants nothing'); },
  });
  barren.counters['hex:hex_logistics:goldenTier'] = 3;
  reg.get(hexEffectKey('hex_logistics')).onRoundStart(barren);
  assert.deepEqual(dry, [4], 'the tier is asked for again');
  assert.equal(barren.counters['hex:hex_logistics:goldenTier'], 3, 'a failed roll leaves the ladder where it was');
});

test('battle mods of the fourth batch: blockCnt / spRecoveryFlat / spCostFlat pass through verbatim', () => {
  assert.deepEqual(battleModsOf({ battle: { blockCnt: 1, maxHpPct: 20 } }), { hpPct: 0.2, blockCnt: 1 });
  assert.deepEqual(battleModsOf({ battle: { spRecoveryFlat: 0.15 } }), { spRecoveryFlat: 0.15 });
  assert.deepEqual(battleModsOf({ battle: { spCostFlat: -3 } }), { spCostFlat: -3 });
  // unchanged behaviour for the first three batches
  assert.deepEqual(battleModsOf({ battle: { atkPct: 16 } }), { atkPct: 0.16 });
});

test('every fourth-batch card that acts in battle declares a BATTLE_SPEC_KEYS key (the 装甲破坏 regression gate)', () => {
  const reg = getDefaultRegistry();
  const BATTLE = ['hex_holdline', 'hex_firingline', 'hex_laststand', 'hex_overdrive', 'hex_fieldhospital', 'hex_lossamp'];
  for (const id of BATTLE) {
    const rec = HEXTECH.playerHexes[id];
    const spec = Object.keys(rec.effect);
    assert.ok(spec.some((k) => BATTLE_SPEC_KEYS.includes(k)), `${id} (${spec.join(',')}) must be declared in BATTLE_SPEC_KEYS`);
    // and the registered handler exists
    assert.ok(reg.get(hexEffectKey(id)), `hex:${id} handler`);
  }
  // the `battle`-only cards of the batch need no extra key (教官批注; 盾墙 / 战争机器 grew a script key in the fifth batch
  // and are covered by the gate below, so they are asserted to carry their passive here and their key there)
  for (const id of ['hex_shieldwall', 'hex_drillsergeant', 'hex_warmachine']) {
    assert.ok(HEXTECH.playerHexes[id].effect.battle, `${id} carries a battle passive`);
  }
});

test('every fifth-batch card that acts in battle declares a BATTLE_SPEC_KEYS key (2026-10-11 gate)', () => {
  const reg = getDefaultRegistry();
  // the four cards of the owner's 2026-10-11 review, with the script key each one's module reads
  const BATTLE = {
    hex_drill: 'drill', hex_armor: 'armor', hex_shieldwall: 'shieldwall', hex_warmachine: 'warmachine',
  };
  for (const [id, key] of Object.entries(BATTLE)) {
    const rec = HEXTECH.playerHexes[id];
    assert.ok(rec, `${id} is in the roster`);
    assert.ok(Object.keys(rec.effect).includes(key), `${id} declares the ${key} script key`);
    // the gate itself: a script key not declared in BATTLE_SPEC_KEYS makes the ref `battle: false` and the module never
    // runs (the §29.8 trap) — hasBattlePart is what addHexRef asks
    assert.ok(BATTLE_SPEC_KEYS.includes(key), `${key} must be declared in BATTLE_SPEC_KEYS`);
    assert.ok(hasBattlePart(rec.effect), `${id}: the ref must reach the battle`);
    assert.ok(rec.effect.battle, `${id} keeps its static passive alongside the script`);
    assert.ok(reg.get(hexEffectKey(id)), `hex:${id} handler`);
  }
});

test('every sixth-batch card that acts in battle declares a BATTLE_SPEC_KEYS key (the owner’s 2026-10-11 list)', () => {
  const reg = getDefaultRegistry();
  // 雷区 / 破隐 are 1阶, 近大远小 / 神经毒素 / 跳弹 2阶 and 人祭 / 债务 3阶 — the owner's tiers, verbatim. 债务 is the only
  // card of the batch with no battle part at all (its watcher is a prep-phase `effect:hexdebt` ref on the teammate).
  const BATTLE = {
    hex_humanrite: 'humanRite',
    hex_rangedist: 'rangedist',
    hex_minefield: 'minefield',
    hex_breaker: 'breaker',
    hex_neurotoxin: 'neurotoxin',
    hex_ricochet: 'ricochet',
  };
  for (const [id, key] of Object.entries(BATTLE)) {
    const rec = HEXTECH.playerHexes[id];
    assert.ok(rec, `${id} is in the roster`);
    assert.ok(Object.keys(rec.effect).includes(key), `${id} declares the ${key} script key`);
    // the gate itself: a script key not declared in BATTLE_SPEC_KEYS makes the ref `battle: false` and the module never
    // runs (§29.8) — hasBattlePart is what addHexRef asks
    assert.ok(BATTLE_SPEC_KEYS.includes(key), `${key} must be declared in BATTLE_SPEC_KEYS`);
    assert.ok(hasBattlePart(rec.effect), `${id}: the ref must reach the battle`);
    assert.ok(reg.get(hexEffectKey(id)), `hex:${id} handler`);
  }
  // 债务 and the tiers/rarities the owner gave
  const tiers = {
    hex_humanrite: 'prismatic', hex_debt: 'prismatic', hex_rangedist: 'gold', hex_minefield: 'silver',
    hex_breaker: 'silver', hex_neurotoxin: 'gold', hex_ricochet: 'gold',
  };
  for (const [id, rarity] of Object.entries(tiers)) {
    assert.equal(HEXTECH.playerHexes[id].rarity, rarity, `${id} is ${rarity}`);
  }
  assert.equal(hasBattlePart(HEXTECH.playerHexes.hex_debt.effect), false, '债务 never reaches a battle');
  assert.ok(reg.get(hexEffectKey('hex_debt')), 'hex:hex_debt handler');
});

test('幽魂形态: the item spec names ONE items.json record — the remake’s own 幽魂, and the id branch grants it', () => {
  const rec = HEXTECH.playerHexes.hex_ghostform;
  assert.deepEqual(rec.effect.onPick, { item: { id: 'chess_item_9_90_e_a', count: 1 } });
  // the id must resolve in the GENERATED data (the roster cannot check that itself, so the test does)
  const item = DATA.items['chess_item_9_90_e_a'];
  assert.ok(item, 'the id resolves in data/items.json');
  assert.equal(item.name, '幽魂');
  assert.equal(item.itemType, 'EQUIP');
  assert.equal(item.shopExcluded, true, 'no shop / 道具补给 / pool_equip_* draw can offer it');
  assert.equal(item.mergeable, false, 'and it never merges');
  assert.equal(item.upgradeNum, 100, 'the official "never merges" marker (突变细胞)');
  assert.equal(item.params.dmgCap, 100, 'the battle half reads this number (items/battle.js BY_ITEM)');
  assert.equal(hasBattlePart(rec.effect), false, 'the card itself never reaches a battle — its ITEM does');
  // the real ctx: the id branch grants exactly that record and rolls nothing
  const reg = getDefaultRegistry();
  const grants = [];
  const ctx = ctxStub({
    rollPool: () => { throw new Error('an explicit id must not roll a pool'); },
    rollItem: () => { throw new Error('an explicit id must not roll a base item'); },
    grantItem: (id) => { grants.push(id); return { id }; },
  });
  reg.get(hexEffectKey('hex_ghostform')).onHexPick(ctx);
  assert.deepEqual(grants, ['chess_item_9_90_e_a'], 'the record the card names is what lands in the hand');
  assert.ok(reg.get(hexEffectKey('hex_ghostform')), 'hex:hex_ghostform handler');
});

test('every tenth-batch card that acts in battle declares a BATTLE_SPEC_KEYS key (the owner’s 2026-10-12 list)', () => {
  const reg = getDefaultRegistry();
  // 逻各斯 / 你我一体 are 3阶, the owner's tiers verbatim. Both act ONLY in battle: 逻各斯 is an aura over every own
  // operator's range, 你我一体 a shared HP pool + a focus-fire multiplier. Neither carries a `params.battle` passive, so
  // each is exactly the §29.8 trap the BATTLE_SPEC_KEYS declaration exists to close.
  const BATTLE = { hex_logos: 'logos', hex_onebody: 'oneBody' };
  for (const [id, key] of Object.entries(BATTLE)) {
    const rec = HEXTECH.playerHexes[id];
    assert.ok(rec, `${id} is in the roster`);
    assert.equal(rec.rarity, 'prismatic', `${id} is 3阶`);
    assert.ok(Object.keys(rec.effect).includes(key), `${id} declares the ${key} script key`);
    assert.ok(BATTLE_SPEC_KEYS.includes(key), `${key} must be declared in BATTLE_SPEC_KEYS`);
    assert.ok(hasBattlePart(rec.effect), `${id}: the ref must reach the battle`);
    assert.equal(rec.effect.battle, undefined, `${id} is an ownership-only mechanic (no static passive)`);
    assert.ok(reg.get(hexEffectKey(id)), `hex:${id} handler`);
  }
  // the owner's numbers, verbatim: 120 % of ATK / 9999999, and ×1.5
  assert.deepEqual(HEXTECH.playerHexes.hex_logos.effect.logos, { atkPct: 120, damage: 9999999 });
  assert.deepEqual(HEXTECH.playerHexes.hex_onebody.effect.oneBody, { dmgPct: 150 });
});

// =====================================================================================================================
// §29.34 — the eleventh batch (the owner's own list of 2026-10-13): 13 cards, driven here through their REAL handlers
// with the ctx stub (the fast half; the match-level behaviour is in test/match/hextech.test.js).

test('the eleventh batch: 79 player hexes, the owner’s names and tiers verbatim', () => {
  const names = {
    hex_covenantecho: ['圣约回响', 'prismatic'], hex_meterflip: ['电表倒转·改', 'gold'],
    hex_bondprism: ['盟约棱镜', 'gold'], hex_emergencygrant: ['紧急拨款', 'gold'],
    hex_bondequalize: ['均衡盟约', 'gold'], hex_lastditch: ['背水一战', 'gold'],
    hex_bondparasite: ['盟约寄生', 'silver'], hex_tripleoverdraft: ['三连透支', 'gold'],
    hex_upgraderefresh: ['升级刷新', 'gold'], hex_mastermorph: ['转职大师', 'gold'],
    hex_mastergamble: ['赌狗大师', 'gold'], hex_hrsupply: ['人力部资源', 'gold'], hex_docproject: ['博士投影', 'gold'],
  };
  for (const [id, [name, rarity]] of Object.entries(names)) {
    const rec = HEXTECH.playerHexes[id];
    assert.ok(rec, `${id} is in the roster`);
    assert.equal(rec.name, name, `${id} name`);
    assert.equal(rec.rarity, rarity, `${id} tier`);
  }
  assert.equal(Object.keys(HEXTECH.playerHexes).length, 100, '100 player hexes after the thirteenth batch');
});


// =====================================================================================================================
// thirteenth batch (业主 2026-10-19): ten player cards whose whole mechanic is a battle script. What this block pins is
// the INTEGRATION (the scripts themselves are driven on the real sim in hexcards-14a / hexcards-14b):
//   * the record carries its spec key (a missing key gates the script off — silently);
//   * the key is declared in BATTLE_SPEC_KEYS (without it, addHexRef marks the ref prep-only and the battle never sees it);
//   * the id is wired in HEX_SCRIPT_KEYS to that same key (a typo there is the same silent no-op).
test('the thirteenth batch: ten battle-script cards are wired end to end (record → BATTLE_SPEC_KEYS → HEX_SCRIPT_KEYS)', () => {
  const BATCH = {
    hex_untouchable: ['你摸不到', 'prismatic', 'untouchable'],
    hex_pearlglove: ['珠光护手', 'prismatic', 'pearlglove'],
    hex_physarts: ['物法皆修', 'prismatic', 'physarts'],
    hex_quantum: ['量子计算', 'prismatic', 'quantum'],
    hex_tapdance: ['踢踏舞', 'prismatic', 'tapdance'],
    hex_ultrefresh: ['终极刷新', 'prismatic', 'ultrefresh'],
    hex_omenpact: ['不祥契约', 'prismatic', 'omenpact'],
    hex_proteinshake: ['蛋白粉奶昔', 'prismatic', 'proteinshake'],
    hex_frostghost: ['冰霜幽灵', 'silver', 'frostghost'],
    hex_heavyhitter: ['重量级打击手', 'silver', 'heavyhitter'],
  };
  for (const [id, [name, rarity, key]] of Object.entries(BATCH)) {
    const rec = HEXTECH.playerHexes[id];
    assert.ok(rec, id + ' is in the roster');
    assert.equal(rec.name, name, id + ' name');
    assert.equal(rec.rarity, rarity, id + ' tier');
    assert.ok(rec.effect && rec.effect[key] !== undefined, id + ` record carries the '${key}' spec`);
    assert.ok(BATTLE_SPEC_KEYS.includes(key), key + ' is declared in BATTLE_SPEC_KEYS');
    assert.equal(HEX_SCRIPT_KEYS[id], key, id + ' is wired to its script key');
    assert.ok(hasBattlePart(rec.effect), id + ' is battle-visible (hasBattlePart)');
  }
  // the card text itself (owner's wording) — a rewrite of the roster must not silently change it
  assert.equal(HEXTECH.playerHexes.hex_frostghost.desc, '每 12 秒束缚全场敌人 3 秒。');
  assert.equal(HEXTECH.playerHexes.hex_heavyhitter.desc, '作战中，己方干员的攻击额外造成相当于自身最大生命值 10% 的物理伤害。');
});

test('转职大师 / 赌狗大师 / 人力部资源 / 博士投影: the four plain item grants name the owner’s items', () => {
  const reg = getDefaultRegistry();
  const grants = [];
  const ctx = ctxStub({ grantItem: (id, o) => { grants.push([id, o && o.source]); return { id }; } });
  const want = {
    hex_mastermorph: ['chess_item_6_09_e_a', 3], // 变形同构体, the item players call 转职球 (docs/history/0.1.1.md §21.7)
    hex_mastergamble: ['chess_item_5_05_e_a', 2], // 拟态物质
    hex_hrsupply: ['chess_item_6_08_e_a', 1], // 人事部文档 (「人事部档案」 is the owner's shorthand)
    hex_docproject: ['chess_item_5_06_e_a', 1], // 博士投影
  };
  for (const [id, [itemId, count]] of Object.entries(want)) {
    grants.length = 0;
    reg.get(hexEffectKey(id)).onHexPick(ctx);
    assert.deepEqual(grants, Array.from({ length: count }, () => [itemId, 'hex']), `${id} grants ${count} × ${itemId}`);
  }
});

test('盟约棱镜: each distinct NON-CORE bond on the board adds +3 layers to every CORE bond', () => {
  const reg = getDefaultRegistry();
  const gd = { bondIds: Object.keys(DATA.bonds), bond: (id) => DATA.bonds[id] || null };
  const cores = gd.bondIds.filter((id) => gd.bond(id).isCore);
  const nonCores = gd.bondIds.filter((id) => !gd.bond(id).isCore);
  const adds = [];
  const ctx = ctxStub({
    gd, addLayers: (b, n) => { adds.push([b, n]); return n; },
    board: () => [{ kind: 'chess', id: 'x' }, { kind: 'chess', id: 'y' }, { kind: 'token', id: 't' }],
    // two board pieces carrying three distinct non-core bonds between them (one is shared: it counts once)
    chessRecord: (id) => (id === 'x' ? { bonds: [nonCores[0], nonCores[1]] } : { bonds: [nonCores[1], nonCores[2]] }),
  });
  reg.get(hexEffectKey('hex_bondprism')).onRoundStart(ctx);
  assert.deepEqual(adds.map(([b]) => b), cores, 'every core bond got layers, in data order');
  for (const [, n] of adds) assert.equal(n, 9, 'three distinct non-core bonds × 3');
  const none = ctxStub({ gd, board: () => [], addLayers: (b, n) => { adds.push([b, n]); return n; } });
  adds.length = 0;
  reg.get(hexEffectKey('hex_bondprism')).onRoundStart(none);
  assert.deepEqual(adds, [], 'an empty board grants nothing');
});

test('紧急拨款: an ELITE sale pays 6 funds and arms the next refresh’s guaranteed slot; a normal sale pays nothing', () => {
  const reg = getDefaultRegistry();
  const gd = { isGolden: (id) => /_b$/.test(id) };
  const slots = [];
  const ctx = ctxStub({ gd, setShopSlot: (i, s) => { slots.push([i, s]); return true; }, topMemberBond: () => 'preciShip', rollChess: () => 'chess_char_1_01' });
  ctx.ev = { piece: { kind: 'chess', id: 'chess_char_1_01_a' }, gain: 1 };
  reg.get(hexEffectKey('hex_emergencygrant')).onSold(ctx);
  assert.equal(ctx.funds, 0, 'a normal operator pays nothing');
  ctx.ev = { piece: { kind: 'chess', id: 'chess_char_1_01_b' }, gain: 3 };
  reg.get(hexEffectKey('hex_emergencygrant')).onSold(ctx);
  // Owner's rebalance of 2026-10-15: the payout is 2 funds (was 6).
  assert.equal(ctx.funds, 2, 'an elite sale pays the card’s 2 funds at once');
  assert.equal(ctx.counter('hex:hex_emergencygrant:nextTopBond'), 1, 'and arms the guarantee');
  reg.get(hexEffectKey('hex_emergencygrant')).onRefresh(ctx);
  assert.deepEqual(slots, [[0, { kind: 'chess', id: 'chess_char_1_01' }]], 'the next refresh writes slot 0 with the top bond’s operator');
  assert.equal(ctx.counter('hex:hex_emergencygrant:nextTopBond'), 0, 'the arm is spent');
  slots.length = 0;
  reg.get(hexEffectKey('hex_emergencygrant')).onRefresh(ctx);
  assert.deepEqual(slots, [], 'a later refresh writes nothing without an arm');
});

test('均衡盟约: every ACTIVE bond is set to the rounded-up average of the active total (向上取整)', () => {
  const reg = getDefaultRegistry();
  // a / b / c are LAYER bonds of the real roster, so the noStack guard lets them through
  const LAYERED = { a: 'yanShip', b: 'sargonShip', c: 'victoriaShip' };
  const sets = [];
  const ctx = ctxStub({
    bonds: () => ({ [LAYERED.a]: { active: true, layers: 10 }, [LAYERED.b]: { active: true, layers: 5 }, [LAYERED.c]: { active: true, layers: 0 }, kjeragShip: { active: false, layers: 99 } }),
    setLayers: (b, n) => { sets.push([b, n]); return n; },
  });
  reg.get(hexEffectKey('hex_bondequalize')).onRoundStart(ctx);
  assert.deepEqual(sets, [[LAYERED.a, 5], [LAYERED.b, 5], [LAYERED.c, 5]], '15 ÷ 3 = 5 for every active bond (the inactive one is untouched)');
  // 10 / 5 → ceil(7.5) = 8
  const sets2 = [];
  const two = ctxStub({ bonds: () => ({ [LAYERED.a]: { active: true, layers: 10 }, [LAYERED.b]: { active: true, layers: 5 } }), setLayers: (b, n) => { sets2.push([b, n]); return n; } });
  reg.get(hexEffectKey('hex_bondequalize')).onRoundStart(two);
  assert.deepEqual(sets2, [[LAYERED.a, 8], [LAYERED.b, 8]], '向上取整');
  const one = ctxStub({ bonds: () => ({ [LAYERED.a]: { active: true, layers: 10 } }), setLayers: () => { throw new Error('a single active bond needs no equalizing'); } });
  reg.get(hexEffectKey('hex_bondequalize')).onRoundStart(one);
});

// 业主 report 2026-10-14: 「均衡盟约不应该均衡绝技和独行这种层数没意义的」. 独行 / 绝技 (and 调和 / 协防干员) are bonds.json
// `noStack` bonds: the game never shows a layer count for them and no rule reads one, so a share handed to them is
// invisible AND unspendable — while their two sentences are trivially active on the boards the card is aimed at, so they
// used to eat most of the pool. They now take no part: not in the denominator, not in the payout.
test('均衡盟约: a noStack bond (独行 / 绝技 / 调和 / 协防干员) takes no part — it is never set and never counted', () => {
  const reg = getDefaultRegistry();
  // the data really marks the four as layer-less (the guard's premise)
  for (const id of ['soloShip', 'suntShip', 'maniShip', 'emptyShip']) {
    assert.equal(DATA.bonds[id].noStack, true, `premise: ${id} is a noStack bond`);
    assert.deepEqual(DATA.bonds[id].layerMilestones, [], `premise: ${id} has no layer milestone`);
  }
  const sets = [];
  // 独行 (solo, thresholds [1]) and 绝技 (sunt, [2,5]) are ACTIVE and hold layers the player can never spend; 精准 and
  // 迅捷 are real layer bonds. The pool is 20 + 10 = 30 over TWO bonds → 15 each; 独行 / 绝技 are never written.
  const ctx = ctxStub({
    bonds: () => ({
      soloShip: { active: true, layers: 40 },
      suntShip: { active: true, layers: 30 },
      preciShip: { active: true, layers: 20 },
      swiftShip: { active: true, layers: 10 },
    }),
    setLayers: (b, n) => { sets.push([b, n]); return n; },
  });
  reg.get(hexEffectKey('hex_bondequalize')).onRoundStart(ctx);
  assert.deepEqual(sets, [['preciShip', 15], ['swiftShip', 15]], 'only the layer bonds are set, to 30 ÷ 2');
  // … and they are out of the DENOMINATOR too: one layer bond plus two noStack bonds leaves nothing to redistribute
  const sets2 = [];
  const alone = ctxStub({
    bonds: () => ({ soloShip: { active: true, layers: 40 }, suntShip: { active: true, layers: 30 }, preciShip: { active: true, layers: 20 } }),
    setLayers: (b, n) => { sets2.push([b, n]); return n; },
  });
  reg.get(hexEffectKey('hex_bondequalize')).onRoundStart(alone);
  assert.deepEqual(sets2, [], 'a single layer-holding bond needs no equalizing (the noStack ones are not participants)');
});

test('背水一战: below the LP threshold the round’s first refresh is free, and above it nothing happens', () => {
  const reg = getDefaultRegistry();
  const h = reg.get(hexEffectKey('hex_lastditch'));
  const low = ctxStub({ lp: () => 4 });
  h.onRoundStart(low);
  assert.equal(low.freeRefresh, 1, 'LP 4 < 5 ⇒ one free refresh');
  const edge = ctxStub({ lp: () => 5 });
  h.onRoundStart(edge);
  assert.equal(edge.freeRefresh, undefined, 'LP 5 is NOT below 5');
  // the battle arm the sim reads: the match stamps whether the window is open on the ref and on the input’s copy
  const input = { playerEffects: [{ key: 'hex:hex_lastditch', data: { hexId: 'hex_lastditch' }, params: {} }] };
  const arm = ctxStub({ lp: () => 3 });
  arm.effects['hex:hex_lastditch'] = { id: 'hex:hex_lastditch', params: {} };
  arm.ev = { input };
  h.onBattleStart(arm);
  assert.equal(arm.effects['hex:hex_lastditch'].params.lastDitch.active, true, 'the ref carries active: true');
  assert.equal(input.playerEffects[0].params.lastDitch.active, true, 'and the battle input’s own copy too');
  const arm2 = ctxStub({ lp: () => 9 });
  arm2.effects['hex:hex_lastditch'] = { id: 'hex:hex_lastditch', params: {} };
  arm2.ev = { input: { playerEffects: [] } };
  h.onBattleStart(arm2);
  assert.equal(arm2.effects['hex:hex_lastditch'].params.lastDitch.active, false, 'above the threshold the arm says closed');
});

test('盟约寄生: at battle start the bench gives the highest ACTIVE bond `per` layers, patched into this battle’s input', () => {
  const reg = getDefaultRegistry();
  const adds = [];
  const input = { bonds: { preciShip: { count: 2, active: true, tier: 1, layers: 10 } } };
  const ctx = ctxStub({
    hand: () => [{ kind: 'chess', id: 'a' }, { kind: 'chess', id: 'b' }, { kind: 'token', id: 't' }, null],
    topLayerBond: () => 'preciShip',
    addLayers: (b, n) => { adds.push([b, n]); return n; },
    ev: { input },
  });
  reg.get(hexEffectKey('hex_bondparasite')).onBattleStart(ctx);
  assert.deepEqual(adds, [['preciShip', 4]], 'two bench operators × 2 layers');
  assert.equal(input.bonds.preciShip.layers, 14, 'the battle that is starting sees them too');
  const empty = ctxStub({ hand: () => [], topLayerBond: () => 'preciShip', addLayers: () => { throw new Error('an empty bench grants nothing'); } });
  reg.get(hexEffectKey('hex_bondparasite')).onBattleStart(empty);
});

test('三连透支: an elite merge grants an elite of the board’s most numerous bond, and the card lapses for THAT ROUND', () => {
  const reg = getDefaultRegistry();
  const got = [];
  const mk = (round) => ctxStub({
    round,
    topMemberBond: () => 'preciShip',
    rollChess: (o) => { assert.equal(o.bond, 'preciShip', 'rolled from the top bond'); return 'chess_char_1_01'; },
    grantChess: (id, o) => { got.push([id, o && o.golden]); return { id }; },
    ev: { kind: 'chess', piece: { kind: 'chess', id: 'chess_char_1_01_b' }, baseId: 'chess_char_1_01' },
  });
  const h = reg.get(hexEffectKey('hex_tripleoverdraft'));
  // R3: the first elite merge pays…
  const r3 = mk(3);
  h.onMerge(r3);
  assert.deepEqual(got, [['chess_char_1_01', true]], 'an ELITE of the top bond');
  assert.equal(r3.counter('hex:hex_tripleoverdraft:eliteGrant:3'), 1, 'the card is spent FOR ROUND 3');
  // …a second merge in the SAME round pays nothing (本回合失效)…
  h.onMerge(r3);
  assert.equal(got.length, 1, 'a second merge in the same round grants nothing');
  // …but the NEXT round arms it again (the owner's 2026-10-14 wording replaced 「此后失效」 with 「然后本回合失效」)
  const r4 = mk(4);
  h.onMerge(r4);
  assert.deepEqual(got, [['chess_char_1_01', true], ['chess_char_1_01', true]], 'the next round pays once more');
  assert.equal(r4.counter('hex:hex_tripleoverdraft:eliteGrant:4'), 1, 'spent for round 4 too');
  h.onMerge(r4);
  assert.equal(got.length, 2, 'and only once per round');
  // the round-keyed cap is what re-arms it: a shot at a LATER round with no merge yet also pays
  const r9 = mk(9);
  h.onMerge(r9);
  assert.equal(got.length, 3, 'every round arms the card again');
  // an ITEM merge is not an elite operator merge
  const item = ctxStub({ ev: { kind: 'item', piece: { kind: 'item', id: 'x' } }, grantChess: () => { throw new Error('an item merge is not an elite operator merge'); } });
  h.onMerge(item);
});

test('升级刷新: every operator costs 1 less, and the round’s first refresh guarantees a slot of the top bond', () => {
  const reg = getDefaultRegistry();
  const h = reg.get(hexEffectKey('hex_upgraderefresh'));
  const price = ctxStub();
  price.ev = { kind: 'chess', price: 3 };
  h.onPrice(price);
  assert.equal(price.ev.price, 2, '3 − 1');
  const item = ctxStub();
  item.ev = { kind: 'item', price: 4 };
  h.onPrice(item);
  assert.equal(item.ev.price, 4, 'only operators are discounted');
  const slots = [];
  const ctx = ctxStub({
    roundStats: () => ({ refreshes: 1 }), topMemberBond: () => 'preciShip', rollChess: () => 'chess_char_1_01',
    setShopSlot: (i, s) => { slots.push([i, s]); return true; },
  });
  h.onRefresh(ctx);
  assert.deepEqual(slots, [[0, { kind: 'chess', id: 'chess_char_1_01' }]], 'the first refresh of the round writes slot 0');
  slots.length = 0;
  const later = ctxStub({
    roundStats: () => ({ refreshes: 2 }), topMemberBond: () => 'preciShip', rollChess: () => 'chess_char_1_01',
    setShopSlot: (i, s) => { slots.push([i, s]); return true; },
  });
  h.onRefresh(later);
  assert.deepEqual(slots, [], 'the second refresh of the round writes nothing');
});

test('电表倒转·改: on a FREE refresh the card has a 15 % chance to make this refresh’s operators cost 0', () => {
  const reg = getDefaultRegistry();
  const h = reg.get(hexEffectKey('hex_meterflip'));
  const hit = ctxStub({ rng: () => 0.1, freeShopChess: () => { hit.freed = true; return 4; } });
  hit.ev = { free: true, price: 0 };
  h.onRefresh(hit);
  assert.equal(hit.freed, true, 'a hit frees the operators');
  const miss = ctxStub({ rng: () => 0.9, freeShopChess: () => { miss.freed = true; return 4; } });
  miss.ev = { free: true, price: 0 };
  h.onRefresh(miss);
  assert.notEqual(miss.freed, true, 'a miss changes nothing');
  const paid = ctxStub({ rng: () => 0.1, freeShopChess: () => { paid.freed = true; return 4; } });
  paid.ev = { free: false, price: 3 };
  h.onRefresh(paid);
  assert.notEqual(paid.freed, true, 'a paid refresh is not 奇迹');
});


