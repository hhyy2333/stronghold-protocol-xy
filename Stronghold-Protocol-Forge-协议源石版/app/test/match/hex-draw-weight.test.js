// test/match/hex-draw-weight.test.js — 不屈余烬 (hex_indomember) 的**抽卡池权重**（业主 2026-11-01「抽到不屈余烬的概率
// 增加」/「不屈叠层超 200 后增加出现不屈余烬机会增加 20%」）。
//
// 口径：`data/hextech.json` 的 `playerHexes.hex_indomember.effect.drawBoost = { bond: 'indomShip', fromLayers: 200,
// pct: 20 }` —— 该玩家〖不屈〗**实时层数 > 200** 时，这张卡在**同阶位内**的权重 ×1.2（`1 + pct/100`），否则 ×1。
// 这是抽卡权重，不是发放阶梯：`indomEmberGift { base: 200, step: 150 }`（每 150 层一件装备）一个字都不动。
//
// 四层验证：
//   ① `hexDrawWeight(ps, rec)` 的单元口径（200 → 1、201 → 1.2、别的卡 / 没有 drawBoost → 1、圣约回响的里程碑视图不参与）；
//   ② `rollOffers(..., { weightOf })` 真的按权重抽（3:1 ⇒ 固定种子的 400 次给出 304/96，均匀会接近 200/200）；
//   ③ 不传 `weightOf` 时**逐字**保持原路径（同 seed 与改动前的实现输出相等，且 rng 调用次数相同）；
//   ④ 权重只在**同阶位内**生效（阶位那一步的抽取与不传 `weightOf` 完全一致）；
//   ⑤ 接线：真驱动一次 draft，坐席自己的〖不屈〗层数确实改变了它拿到的牌（另有 二次抽取 / 无私奉献 的静态接线检查）。

import test from 'node:test';
import assert from 'node:assert/strict';
import { rollOffers, pickRarity, pickOne } from '../../shared/hextech.js';
import { createRng } from '../../server/sim/rng.js';
import { hexDrawWeight, bondLayerViewMulOf } from '../../server/match/hextech.js';
import { makeMatch, DATA } from './harness.js';

/** The hex records of the real roster, keyed by id (the data the server actually hands to `rollOffers`). */
const HEXES = DATA.hextech.playerHexes;
const INDOM = HEXES.hex_indomember;
/** The roster's rarity weights (data/hextech.json `rarities`). */
const RARITY_WEIGHTS = Object.fromEntries(DATA.hextech.rarities.map((r) => [r.id, r.weight]));

/** A PlayerState-shaped stub: `bonds[bondId].layers` is the STORED layer count `computeBonds` reports. */
function psAt(indomLayers, extra = {}) {
  return {
    bonds: { indomShip: { layers: indomLayers, active: true, count: 3, tier: 1 } },
    layers: { indomShip: indomLayers },
    ...extra,
  };
}

// ── ① 单元口径 ────────────────────────────────────────────────────────────────────────────────────────────────

test('hexDrawWeight: 不屈层数 200 → 1、201 → 1.2；没有 drawBoost / 别的卡 / 缺字段一律 1', () => {
  assert.deepEqual(INDOM.effect.drawBoost, { bond: 'indomShip', fromLayers: 200, pct: 20 }, 'the card face carries the rule');
  // the threshold is STRICTLY above: 「超过 200 层后」
  assert.equal(hexDrawWeight(psAt(0), INDOM), 1);
  assert.equal(hexDrawWeight(psAt(199), INDOM), 1);
  assert.equal(hexDrawWeight(psAt(200), INDOM), 1);
  assert.equal(hexDrawWeight(psAt(201), INDOM), 1.2);
  assert.equal(hexDrawWeight(psAt(999), INDOM), 1.2, 'a deeper bond keeps the same +20% (it is not a 阶梯)');
  // cards without the rule are never re-weighed — 别的卡 = 1 is what makes the boost a SAME-TIER re-weight
  assert.equal(hexDrawWeight(psAt(201), HEXES.hex_stipend), 1);
  assert.equal(hexDrawWeight(psAt(201), HEXES.hex_immortal), 1);
  assert.equal(hexDrawWeight(psAt(201), { id: 'x', rarity: 'gold', effect: {} }), 1, 'an effect without drawBoost');
  assert.equal(hexDrawWeight(psAt(201), { id: 'y', rarity: 'gold' }), 1, 'no effect at all');
  assert.equal(hexDrawWeight(psAt(201), null), 1);
  assert.equal(hexDrawWeight(null, INDOM), 1, 'no player state ⇒ no bias');
  assert.equal(hexDrawWeight({}, INDOM), 1);
  // the bond the record names does not exist on this player / its layers are junk
  assert.equal(hexDrawWeight({ bonds: {} }, INDOM), 1);
  assert.equal(hexDrawWeight({ bonds: { indomShip: { layers: 'nope' } } }, INDOM), 1);
  // a PlayerState whose bonds view was not recomputed yet falls back to the stored `ps.layers`
  assert.equal(hexDrawWeight({ layers: { indomShip: 201 } }, INDOM), 1.2);
  // a broken parameter record is inert instead of NaN
  assert.equal(hexDrawWeight(psAt(201), { effect: { drawBoost: { bond: '', fromLayers: 200, pct: 20 } } }), 1);
  assert.equal(hexDrawWeight(psAt(201), { effect: { drawBoost: { bond: 'indomShip', pct: 20 } } }), 1);
  assert.equal(hexDrawWeight(psAt(201), { effect: { drawBoost: { bond: 'indomShip', fromLayers: 200, pct: 0 } } }), 1);
});

test('hexDrawWeight reads the STORED layers, not 圣约回响\'s milestone view (bonds layers ≠ bondLayerViewPct)', () => {
  // 150 stored layers ×1.5 view = 225 "milestone layers" — above the 200 rung, but the DRAW must not see it.
  const echoed = psAt(150, { effects: [{ id: 'hex:hex_covenantecho', key: 'hex:hex_covenantecho', params: { bondLayerViewPct: 50 } }] });
  assert.equal(bondLayerViewMulOf(echoed), 1.5, 'the milestone view really is +50% here');
  assert.equal(hexDrawWeight(echoed, INDOM), 1, 'the draw weight follows the real layer count');
  // …and the 201 that DOES cross the threshold is read off the same stored field
  assert.equal(hexDrawWeight(psAt(201, { effects: echoed.effects }), INDOM), 1.2);
});

// ── ② 传 weightOf 时确实偏置 ───────────────────────────────────────────────────────────────────────────────

/** Two same-rarity cards — the only pair the hook may ever re-weigh against each other. */
const PAIR = Object.freeze([{ id: 'a', rarity: 'gold' }, { id: 'b', rarity: 'gold' }]);

test('rollOffers: weightOf 在同阶位内加权抽（3:1 ⇒ 固定种子 400 次 304/96，均匀则是 200/200）', () => {
  const weightOf = (rec) => (rec.id === 'a' ? 3 : 1);
  const rng = createRng(1234);
  const counts = { a: 0, b: 0 };
  const N = 400;
  for (let i = 0; i < N; i++) {
    const [id] = rollOffers(rng, { pool: PAIR, owned: [], count: 1, weightOf });
    counts[id] += 1;
  }
  // deterministic (mulberry32 + a fixed seed): the 3:1 pool lands on 304/96, i.e. 79.2% ≈ 3/(3+1)
  assert.deepEqual(counts, { a: 304, b: 96 });
  assert.ok(counts.a > counts.b * 3, 'the boosted card is drawn about three times as often');
  // the same seed WITHOUT the hook splits the pair evenly — the hook is what moves it
  const plain = createRng(1234);
  const flat = { a: 0, b: 0 };
  for (let i = 0; i < N; i++) {
    const [id] = rollOffers(plain, { pool: PAIR, owned: [], count: 1 });
    flat[id] += 1;
  }
  assert.ok(Math.abs(flat.a - flat.b) < N * 0.15, `no hook ⇒ roughly even (${flat.a}/${flat.b})`);
});

test('rollOffers: weightOf 的 0 权重 = 排除该卡，全 0 时退回均匀（同 pickRarity 的口径）', () => {
  const rng = createRng(4242);
  const only = { a: 0, b: 0 };
  for (let i = 0; i < 50; i++) {
    const [id] = rollOffers(rng, { pool: PAIR, owned: [], count: 1, weightOf: (rec) => (rec.id === 'b' ? 0 : 1) });
    only[id] += 1;
  }
  assert.deepEqual(only, { a: 50, b: 0 }, 'a 0 weight is never drawn while another card has weight');
  const rng0 = createRng(77);
  const fallback = { a: 0, b: 0 };
  for (let i = 0; i < 50; i++) {
    const [id] = rollOffers(rng0, { pool: PAIR, owned: [], count: 1, weightOf: () => 0 });
    assert.ok(id === 'a' || id === 'b', 'all-zero weights still return a card');
    fallback[id] += 1;
  }
  assert.ok(fallback.a > 0 && fallback.b > 0, 'all-zero weights fall back to a uniform draw');
});

// ── ③ 不传 weightOf ⇒ 与改动前逐字一致 ────────────────────────────────────────────────────────────────────

/**
 * `rollOffers` BEFORE the hook, copied verbatim from shared/hextech.js at the time the hook was added. The hook must not
 * touch this path: same output AND same number of `rng()` draws for every seed, or every existing caller's determinism
 * (replays, goldens, seeded suites) would shift.
 */
function legacyRollOffers(rng, { pool, owned = [], weights = null, count = 3 }) {
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

test('rollOffers: 不传 weightOf 时与改动前逐字一致（同 seed 同输出、同 rng 调用次数）', () => {
  const pool = Object.values(HEXES);
  for (let seed = 1; seed <= 40; seed++) {
    let callsLegacy = 0;
    let callsNow = 0;
    const legacyRng = createRng(seed);
    const nowRng = createRng(seed);
    const before = legacyRollOffers(() => { callsLegacy += 1; return legacyRng(); }, { pool, weights: RARITY_WEIGHTS, count: 3 });
    const now = rollOffers(() => { callsNow += 1; return nowRng(); }, { pool, weights: RARITY_WEIGHTS, count: 3 });
    assert.deepEqual(now, before, `seed ${seed}: the hook-less path must stay byte-identical`);
    assert.equal(callsNow, callsLegacy, `seed ${seed}: same rng draws (${callsLegacy})`);
    // an undefined/null `weightOf` is the same as omitting it
    const nullRng = createRng(seed);
    assert.deepEqual(
      rollOffers(() => nullRng(), { pool, weights: RARITY_WEIGHTS, count: 3, weightOf: null }),
      before,
      `seed ${seed}: weightOf: null is the old path`,
    );
  }
  // owned / count / an exhausted pool / unknown rarities go through the same guards as before
  const rngA = createRng(9001);
  const rngB = createRng(9001);
  const owned = ['hex_stipend', 'hex_echo'];
  for (const args of [
    { pool, weights: RARITY_WEIGHTS, owned, count: 3 },
    { pool: pool.slice(0, 2), weights: RARITY_WEIGHTS, count: 3 },
    { pool: [{ id: 'z', rarity: 'bogus' }], weights: RARITY_WEIGHTS, count: 3 },
  ]) {
    assert.deepEqual(rollOffers(rngA, args), legacyRollOffers(rngB, args), JSON.stringify(args.count));
  }
});

// ── ④ 只在同阶位内 ──────────────────────────────────────────────────────────────────────────────────────

test('rollOffers: weightOf 只重排同一阶位，阶位那一步的抽取不变（银卡数量一模一样）', () => {
  const pool = [
    { id: 'a', rarity: 'gold' },
    { id: 'b', rarity: 'gold' },
    { id: 'c', rarity: 'silver' },
  ];
  const boosted = createRng(9001);
  const plain = createRng(9001);
  const withHook = { a: 0, b: 0, c: 0 };
  const withoutHook = { a: 0, b: 0, c: 0 };
  for (let i = 0; i < 300; i++) {
    const [x] = rollOffers(boosted, { pool, weights: RARITY_WEIGHTS, count: 1, weightOf: (rec) => (rec.id === 'a' ? 1e6 : 1) });
    withHook[x] += 1;
    const [y] = rollOffers(plain, { pool, weights: RARITY_WEIGHTS, count: 1 });
    withoutHook[y] += 1;
  }
  // 阶位抽的是 weights（这里只有 gold 0.38 / silver 0.46 可用 ⇒ silver 0.46/0.84 ≈ 54.8%）：两次完全相同
  assert.equal(withHook.c, withoutHook.c, 'the rarity step is untouched by the hook');
  assert.equal(withHook.c, 161);
  // 阶位内的分配被权重整个改写：金卡几乎全是 a（b 从 79 掉到 0）
  assert.equal(withoutHook.b, 79);
  assert.equal(withHook.a, 139);
  assert.equal(withHook.b, 0);
});

// ── ⑤ 接线：真驱动一次 draft ──────────────────────────────────────────────────────────────────────────────

/** 不屈余烬 + 同阶位的另两张卡（三张都是 3 阶），三选一改成单抽，抽取结果只取决于阶位内的权重。 */
const WIRE_IDS = ['hex_indomember', 'hex_immortal', 'hex_overlord'];

/**
 * A data copy whose 海克斯 pool is those three 3-阶 cards with a single-card offer. `pct` is the card's own `drawBoost`
 * percentage: the roster's 20 for the real reading, a huge value for the *magnitude* probe below (one draft then proves
 * the channel is wired — the real +20% is a statistic, not a single-draw assertion).
 */
function wireData(pct) {
  const playerHexes = Object.fromEntries(WIRE_IDS.map((id) => [id, HEXES[id]]));
  playerHexes.hex_indomember = {
    ...INDOM,
    effect: { ...INDOM.effect, drawBoost: { ...INDOM.effect.drawBoost, pct } },
  };
  return { ...DATA, hextech: { ...DATA.hextech, format: { ...DATA.hextech.format, offer: 1 }, playerHexes } };
}

/** Drive a solo match to R1's HEX_DRAFT and return the offer `p_0` was dealt (its own 〖不屈〗 layers preset). */
function firstOffer({ layers = 0, seed, data }) {
  const h = makeMatch({ mode: 'solo', difficulty: 'NORMAL', humans: 1, bots: 0, seed, fake: true, data });
  h.start();
  const ps = h.ps('p_0');
  if (layers > 0) ps.setLayers('indomShip', layers);
  const ok = h.drive(() => h.ended != null || (h.m.phase === 'HEX_DRAFT' && h.m.round === 1));
  assert.ok(ok && h.m.phase === 'HEX_DRAFT', `expected the R1 draft, got ${h.m.phase} R${h.m.round}`);
  const offer = h.m.hexOfferOf('p_0').slice();
  h.m.dispose();
  return offer;
}

test('接线：坐席自己的〖不屈〗层数确实改变了 draft 抽到的牌（201 → 加权，200 → 不偏置）', () => {
  const data = wireData(100000);
  // 1001 : 1 : 1 —— 加权时这张卡几乎必然出现，同 seed 的均匀路径则看运气（seed 2 / 3 抽到别的卡）
  const boosted = [2, 3].map((seed) => firstOffer({ layers: 201, seed, data }));
  for (const offer of boosted) assert.deepEqual(offer, ['hex_indomember'], 'a deep 不屈 seat drafts the boosted card');
  const flat = [2, 3].map((seed) => firstOffer({ layers: 200, seed, data }));
  const moved = boosted.filter((offer, i) => JSON.stringify(offer) !== JSON.stringify(flat[i]));
  assert.equal(moved.length, boosted.length, `layers 200 ⇒ no boost (${JSON.stringify(flat)})`);
  // and the REAL roster numbers: 200 layers is not enough, 201 is
  const real = wireData(20);
  assert.ok(firstOffer({ layers: 200, seed: 2, data: real }).length, 'the 200-layer seat still drafts');
  assert.equal(hexDrawWeight(psAt(201), INDOM), 1.2);
});

test('接线：真实 PlayerState 上 bonds.indomShip.layers 就是那个判据（读实际层数，且不越权到装备阶梯）', () => {
  const h = makeMatch({ mode: 'solo', difficulty: 'NORMAL', humans: 1, bots: 0, seed: 31, fake: true });
  h.start();
  const ps = h.ps('p_0');
  ps.setLayers('indomShip', 201);
  const ok = h.drive(() => h.ended != null || (h.m.phase === 'HEX_DRAFT' && h.m.round === 1));
  assert.ok(ok && h.m.phase === 'HEX_DRAFT');
  assert.equal(ps.bonds.indomShip.layers, 201, 'the bonds view reports the stored layers');
  assert.equal(ps.layers.indomShip, 201);
  assert.equal(hexDrawWeight(ps, h.m.gd.hex('hex_indomember')), 1.2);
  assert.equal(hexDrawWeight(ps, h.m.gd.hex('hex_stipend')), 1, 'and only that card is re-weighed');
  // 这是权重不是准入：无论层数多少，这张卡都留在池子里（它没有 requiresBond）
  const pool = h.m._hexPoolFor(ps);
  assert.ok(pool.some((r) => r.id === 'hex_indomember'), '仍然在池子里（权重不是准入）');
  // 发放阶梯（indomEmberGift）不归这里管：卡面参数原样还在
  assert.deepEqual(h.m.gd.hex('hex_indomember').effect.onPick.indomEmberGift, { base: 200, step: 150 });
  h.m.dispose();
});

test('接线：二次抽取 / 无私奉献 也走同一个判据（静态检查，两处都传 weightOf）', async () => {
  const ds = await import('node:fs/promises');
  const src = await ds.readFile(new URL('../../server/match/hextech.js', import.meta.url), 'utf8');
  // 二次抽取: the PICKER's own pool
  assert.match(src, /randomHexes[\s\S]{0,400}?weightOf: \(h\) => hexDrawWeight\(ps, h\)/, 'randomHexes passes the picker\'s weight');
  // 无私奉献: each TARGET teammate's own ps (not the picker's)
  assert.match(src, /otherRandomHexes[\s\S]{0,400}?weightOf: \(h\) => hexDrawWeight\(mate, h\)/, 'otherRandomHexes passes the target\'s weight');
  const draft = await ds.readFile(new URL('../../server/match/match/hexDraft.js', import.meta.url), 'utf8');
  const calls = draft.split('rollOffers(').length - 1;
  const wired = draft.split('weightOf: (h) => hexDrawWeight(ps, h)').length - 1;
  assert.equal(wired, calls, 'every rollOffers call in the draft passes weightOf');
});
