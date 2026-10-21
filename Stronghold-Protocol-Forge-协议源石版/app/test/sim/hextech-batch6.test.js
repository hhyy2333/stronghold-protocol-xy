// test/sim/hextech-batch6.test.js — the sixth batch of 协议源石 (the owner's list of 2026-10-11), run through the real
// simulation: 人祭 / 债务 / 近大远小 / 雷区 / 破隐 / 神经毒素 / 跳弹.
//
// Same shape as test/sim/hextech-battle.test.js: every case builds the playerEffects ref exactly as
// server/match/hextech.js `addHexRef` does and drives the real Battle through test/helpers/battleHarness.js. 债务 is the
// one card of the batch with no battle part — its watcher is covered by test/match/hextech.test.js.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { makeBattle, chessRec, enemyRec } from '../helpers/battleHarness.js';
import { spawnYanyou } from '../../server/sim/content/tokens.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const HEXTECH = JSON.parse(readFileSync(path.join(ROOT, 'data', 'hextech.json'), 'utf8'));

/** The hex record of data/hextech.json, or a clear failure. */
function hex(id) {
  const rec = HEXTECH.playerHexes[id];
  assert.ok(rec, `data/hextech.json has no ${id}`);
  return rec;
}

/** One playerEffects entry, the shape server/match/hextech.js addHexRef writes. */
const refOf = (hexId, over = {}) => {
  const rec = hex(hexId);
  return {
    id: `hex:${hexId}`, key: `hex:${hexId}`, name: rec.name, desc: rec.desc, iconKind: 'hex', iconId: rec.icon,
    counter: null, battle: true, params: { ...rec.effect, hexId, rarity: rec.rarity }, data: { hexId, rarity: rec.rarity },
    ...over,
  };
};

const guard = (o = {}) => chessRec({ id: 'test_guard', stats: { maxHp: 2000, atk: 500, def: 200, res: 0, blockCnt: 1, respawnTime: 20 }, skill: null, ...o });
const sniper = (o = {}) => chessRec({ id: 'test_sniper', profession: 'SNIPER', stats: { maxHp: 1200, atk: 400, def: 0, res: 0, blockCnt: 1, respawnTime: 20 }, skill: null, ...o });
const dummy = (o = {}) => enemyRec({ key: 'enemy_dummy', hp: 100000, atk: 0, speed: 0, ...o });

/** One player with `hexes` on the board and one enemy, deployed next to each other on the flat stage. */
function soloBattle({ hexes = [], units = null, enemies = null, bonds = {}, defs = null, ...opts } = {}) {
  const effects = hexes.map((h) => (typeof h === 'string' ? refOf(h) : h));
  return makeBattle({
    defs: defs || { chess: { test_guard: guard(), test_sniper: sniper() }, enemies: { enemy_dummy: dummy() } },
    players: [{
      playerId: 'p1', seat: 0, side: 'L', colOffset: 0, bonds, playerEffects: effects,
      units: units || [{ uid: 1, kind: 'chess', chessId: 'test_guard', row: 9, col: 6 }],
    }],
    enemies: enemies || [{ key: 'enemy_dummy', time: 0, pos: [9, 7] }],
    autoFinish: false,
    timeLimit: opts.timeLimit ?? 20,
    ...opts,
  });
}

const ops = (h) => h.battle.allyUnits.filter((u) => u && u.kind === 'op' && u.side === 'ally');
const buffsOf = (u, key) => (u.buffs || []).filter((b) => b.key === key);

// =====================================================================================================================
// 破隐

test('破隐: every enemy on the field is revealed — an enemy carrying its own 隐匿 is targetable', () => {
  const h = soloBattle({ hexes: ['hex_breaker'] });
  h.run(1);
  const e = h.enemies()[0];
  assert.ok(e, 'the dummy is on the field');
  const b = buffsOf(e, 'hex:breaker');
  assert.equal(b.length, 1, 'one reveal buff');
  assert.equal(b[0].flags.reveal, true, 'the engine’s 反隐 flag');
  // with 隐匿 on AND the flag off, the engine calls it stealthed; the card's flag turns that off
  h.battle.addBuff(e, { key: 'ab:stealth', flags: { stealth: true }, persist: true });
  assert.equal(e.s.flags.stealth, true, 'premise: the enemy carries 隐匿');
  assert.equal(e.s.flags.reveal, true, 'and 破隐');
  h.invariants();
});

test('破隐: an enemy spawned after the battle started is revealed too', () => {
  const h = soloBattle({ hexes: ['hex_breaker'], enemies: [] });
  h.run(1);
  const e = h.spawn('enemy_dummy', { pos: [9, 8] });
  assert.ok(e, 'spawned');
  assert.equal(buffsOf(e, 'hex:breaker').length, 1, 'the enemySpawn hook covers it');
  h.invariants();
});

test('破隐: without the card nothing is revealed', () => {
  const h = soloBattle({});
  h.run(1);
  assert.equal(buffsOf(h.enemies()[0], 'hex:breaker').length, 0);
});

// =====================================================================================================================
// 近大远小

test('近大远小: 180% at 1 tile, 100% at 2, 80% at 3 and beyond (0 counts as 1)', () => {
  const h = soloBattle({ hexes: ['hex_rangedist'] });
  h.run(1);
  const u = ops(h)[0];
  const factor = (dist) => u.profile.dmgMul(h.battle, u, { side: 'enemy', tileR: u.tileR + dist, tileC: u.tileC });
  assert.ok(Math.abs(factor(0) - 1.8) < 1e-9, `dist 0 (melee) → 1.8, got ${factor(0)}`);
  assert.ok(Math.abs(factor(1) - 1.8) < 1e-9, `dist 1 → 1.8, got ${factor(1)}`);
  assert.ok(Math.abs(factor(2) - 1.0) < 1e-9, `dist 2 → 1.0, got ${factor(2)}`);
  assert.ok(Math.abs(factor(3) - 0.8) < 1e-9, `dist 3 → 0.8, got ${factor(3)}`);
  assert.ok(Math.abs(factor(9) - 0.8) < 1e-9, `dist 9 → 0.8 (the curve stops falling), got ${factor(9)}`);
  h.invariants();
});

test('近大远小: it composes with the operator’s own dmgMul instead of replacing it', () => {
  const h = soloBattle({ hexes: ['hex_rangedist'] });
  h.run(1);
  const u = ops(h)[0];
  const before = u.profile.dmgMul;
  u.profile.dmgMul = (b, unit, target) => 2 * before(b, unit, target);
  const v = u.profile.dmgMul(h.battle, u, { side: 'enemy', tileR: u.tileR, tileC: u.tileC });
  assert.ok(Math.abs(v - 3.6) < 1e-9, `2 × 1.8 = 3.6, got ${v}`);
});

test('近大远小: without the card the profile is untouched', () => {
  const h = soloBattle({});
  h.run(1);
  assert.equal(ops(h)[0].profile.dmgMul, undefined);
});

// =====================================================================================================================
// 雷区

test('雷区: six 共振装置 mines stand on deployable tiles at battle start', () => {
  const h = soloBattle({ hexes: ['hex_minefield'] });
  h.run(1);
  const mines = h.battle.allyUnits.filter((u) => u && u.defId === 'token_10025_doroth_recttp' && u.alive);
  assert.equal(mines.length, 6, 'the card’s own count');
  for (const m of mines) {
    assert.equal(m.kind, 'token');
    assert.ok(h.battle.grid.canStand(m.tileR, m.tileC), `mine on a deployable tile (${m.tileR},${m.tileC})`);
  }
  const tiles = new Set(mines.map((m) => `${m.tileR},${m.tileC}`));
  assert.equal(tiles.size, 6, 'six DIFFERENT tiles');
  // the mine carries 多萝西's S2 blackboard (the maxed variant: atk_scale 2.6, duration 2.5, duration_2 5), not her S1
  const bb = mines[0].def.skill && mines[0].def.skill.bb;
  assert.ok(bb, 'the token carries a skill');
  assert.equal(bb.atk_scale, 2.6, 'S2’s 260 %');
  assert.equal(bb.duration_2, 5, 'S2’s alternate 束缚 duration');
  assert.equal(bb.duration, 2.5, 'S2’s base 束缚 duration');
  h.invariants();
});

test('雷区: without the card no mine is placed', () => {
  const h = soloBattle({});
  h.run(1);
  assert.equal(h.battle.allyUnits.filter((u) => u && u.defId === 'token_10025_doroth_recttp').length, 0);
});

test('雷区: the card’s 1000 ATK × S2’s 2.6 = 2600, and a single victim is 束缚 10 s', () => {
  const h = soloBattle({ hexes: ['hex_minefield'], enemies: [], hooks: ['statusApplied'], captureNoisy: true });
  h.run(0.2);
  const mine = h.battle.allyUnits.find((u) => u && u.defId === 'token_10025_doroth_recttp' && u.alive);
  assert.ok(mine, 'premise: a mine stands on the field');
  assert.equal(mine.s.atk, 1000, 'the CARD’s attack power — not the token record’s 100');
  const e = h.spawn('enemy_dummy', { pos: [mine.tileR, mine.tileC] });   // a ground enemy on the mine
  const before = e.hp;
  h.run(0.5);
  assert.equal(e.hp, before - 2600, `1000 × 2.6 = 2600 (hp ${before} → ${e.hp})`);
  const bound = h.hooksOf('statusApplied').filter((c) => c.target === e && c.status === 'bind');
  assert.equal(bound.length, 1, 'the trap bound it once');
  assert.equal(bound[0].duration, 10, 'exactly one victim ⇒ the card’s bindSingle');
  h.invariants();
});

test('雷区: after the opening volley, one more mine every 5 s (业主 2026-10-21)', () => {
  const h = soloBattle({ hexes: ['hex_minefield'], enemies: [] });
  h.run(1);
  const count = () => h.battle.allyUnits.filter((u) => u && u.defId === 'token_10025_doroth_recttp' && u.alive).length;
  assert.equal(count(), 6, 'the opening six');
  h.run(5);            // t ≈ 6: the t = 5 period is due
  assert.equal(count(), 7, 'one more at 5 s');
  h.run(5);            // t ≈ 11: the t = 10 period is due
  assert.equal(count(), 8, 'and another at 10 s');
  h.invariants();
});

test('雷区: two victims are 束缚 5 s each (bindSingle is only for exactly one)', () => {
  const h = soloBattle({ hexes: ['hex_minefield'], enemies: [], hooks: ['statusApplied'], captureNoisy: true });
  h.run(0.2);
  const mine = h.battle.allyUnits.find((u) => u && u.defId === 'token_10025_doroth_recttp' && u.alive);
  assert.ok(mine, 'premise: a mine stands on the field');
  h.spawn('enemy_dummy', { pos: [mine.tileR, mine.tileC] });
  h.spawn('enemy_dummy', { pos: [mine.tileR, mine.tileC + 1] });         // 1.0 away: inside the 1.2 blast
  h.run(0.5);
  const durs = h.hooksOf('statusApplied').filter((c) => c.status === 'bind').map((c) => c.duration);
  assert.deepEqual(durs, [5, 5], 'two victims ⇒ the card’s bind');
  h.invariants();
});

// =====================================================================================================================
// 神经毒素

test('神经毒素: an operator’s attack poisons the target; one arts tick a second of 115 + 2 % max HP, capped at 1万', () => {
  const h = soloBattle({ hexes: ['hex_neurotoxin'] });
  h.run(1);
  const e = h.enemies()[0];
  assert.ok(h.runUntil(() => buffsOf(e, 'hex:neurotoxin').length > 0, 20), 'the poison landed');
  const b = buffsOf(e, 'hex:neurotoxin')[0];
  assert.equal(b.duration, 3, '3 s');
  assert.equal(b.interval, 1, 'one tick a second');
  // 115 + 2 % of 100000 = 2115 (below the 1万 cap)
  const before = e.hp;
  assert.ok(h.runUntil(() => e.hp < before, 5), 'a tick dealt damage');
  h.invariants();
});

test('神经毒素: the tick is capped at 1万 against a huge target', () => {
  const h = soloBattle({ hexes: ['hex_neurotoxin'], defs: { chess: { test_guard: guard() }, enemies: { enemy_dummy: dummy({ hp: 100000000 }) } } });
  const ticks = [];
  h.battle.on('damaged', (c) => {
    const d = c && c.dmg;
    if (d && Array.isArray(d.tags) && d.tags.includes('hexNeurotoxin')) ticks.push(c.amount);
  });
  h.run(1);
  const e = h.enemies()[0];
  assert.ok(h.runUntil(() => buffsOf(e, 'hex:neurotoxin').length > 0, 20), 'the poison landed');
  assert.ok(h.runUntil(() => ticks.length > 0, 5), 'a tick landed');
  // 115 + 2 % of 1e8 is far above the 1万 ceiling, so every tick is exactly the cap
  for (const t of ticks) assert.ok(Math.abs(t - 10000) < 1e-6, `capped tick, got ${t}`);
  h.invariants();
});

test('神经毒素: 不可叠加 — a second hit while one is running adds no instance', () => {
  const h = soloBattle({ hexes: ['hex_neurotoxin'] });
  h.run(1);
  const e = h.enemies()[0];
  assert.ok(h.runUntil(() => buffsOf(e, 'hex:neurotoxin').length > 0, 20), 'the poison landed');
  h.run(2.5); // the operator keeps attacking inside the 3 s window
  assert.equal(buffsOf(e, 'hex:neurotoxin').length, 1, 'still one poison');
  h.invariants();
});

// =====================================================================================================================
// 跳弹

test('跳弹: a ranged operator’s ranged attack chains for floor(精准/20)+1 ricochets, 30 % falloff each', () => {
  const h = soloBattle({
    hexes: ['hex_ricochet'],
    units: [{ uid: 1, kind: 'chess', chessId: 'test_sniper', row: 9, col: 6 }],
    bonds: { preciShip: { layers: 45, active: true, count: 3 } },
  });
  h.run(1);
  const u = ops(h)[0];
  assert.ok(u.profile.chain, 'a chain was written');
  assert.equal(u.profile.chain.count, 4, 'floor(45/20)+1 = 3 ricochets + the main target');
  assert.ok(Math.abs(u.profile.chain.falloff - 0.3) < 1e-9, 'each bounce −30 %');
  h.invariants();
});

test('跳弹: 0 精准 layers still ricochets once, and the cap is 6', () => {
  const h = soloBattle({
    hexes: ['hex_ricochet'],
    units: [{ uid: 1, kind: 'chess', chessId: 'test_sniper', row: 9, col: 6 }],
    bonds: { preciShip: { layers: 0, active: false, count: 0 } },
  });
  h.run(1);
  assert.equal(ops(h)[0].profile.chain.count, 2, 'floor(0/20)+1 = 1 ricochet');

  const h2 = soloBattle({
    hexes: ['hex_ricochet'],
    units: [{ uid: 1, kind: 'chess', chessId: 'test_sniper', row: 9, col: 6 }],
    bonds: { preciShip: { layers: 400, active: true, count: 9 } },
  });
  h2.run(1);
  assert.equal(ops(h2)[0].profile.chain.count, 7, 'the cap: 6 ricochets + the main target');
});

test('跳弹: a melee operator is untouched', () => {
  const h = soloBattle({ hexes: ['hex_ricochet'], bonds: { preciShip: { layers: 45, active: true, count: 3 } } });
  h.run(1);
  const c = ops(h)[0].profile.chain;
  assert.ok(!c, `「远程干员」 only (got ${JSON.stringify(c)})`);
});

// =====================================================================================================================
// 人祭

test('人祭: a knocked-out own operator summons a 炎佑 built from its ATK ×0.5 and max HP ×0.8', () => {
  const h = soloBattle({ hexes: ['hex_humanrite'], enemies: [] });
  h.run(1);
  const u = ops(h)[0];
  assert.ok(u, 'the operator deployed');
  const atk = u.s.atk;
  const maxHp = u.s.maxHp;
  // a real knock-out (a 无来源 lethal hit), not a retreat: the `death` hook must carry reason 'killed'
  h.battle.dealDamage(null, u, { amount: maxHp * 2, type: 'true', canDodge: false, tags: ['test'] });
  assert.equal(u.removeReason, 'killed', 'the operator was knocked out (premise)');
  const yanyou = h.battle.allyUnits.filter((y) => y && y.defId === 'enemy_9012_acloon');
  assert.equal(yanyou.length, 1, 'exactly one 炎佑');
  const y = yanyou[0];
  // spawnYanyou ADDS the shares to the template (600 ATK / 12000 HP): the 炎 bond's 最终加算 rule
  assert.ok(Math.abs(y.s.atk - (600 + atk * 0.5)) < 1e-6, `炎佑 ATK = 600 + 0.5 × ${atk} (got ${y.s.atk})`);
  assert.ok(Math.abs(y.s.maxHp - (12000 + maxHp * 0.8)) < 1e-6, `炎佑 HP = 12000 + 0.8 × ${maxHp} (got ${y.s.maxHp})`);
  h.invariants();
});

test('人祭: a retreat (not a knock-out) summons nothing', () => {
  const h = soloBattle({ hexes: ['hex_humanrite'], enemies: [] });
  h.run(1);
  h.battle.retreat(ops(h)[0], { reason: 'retreat' });
  assert.equal(h.battle.allyUnits.filter((y) => y && y.defId === 'enemy_9012_acloon').length, 0);
});

// =====================================================================================================================
// 人祭's cap (owner, 2026-10-12): 场上最多同时存在 9 只炎佑

/** A battle with `n` deployed operators (the cap tests need more knock-outs than one operator can supply). */
function capBattle(n = 12) {
  const tiles = [[9, 4], [9, 5], [9, 6], [9, 7], [10, 4], [10, 5], [10, 6], [10, 7], [11, 4], [11, 5], [11, 6], [11, 7]];
  return soloBattle({
    hexes: ['hex_humanrite'],
    enemies: [],
    units: tiles.slice(0, n).map((t, i) => ({ uid: i + 1, kind: 'chess', chessId: 'test_guard', row: t[0], col: t[1] })),
  });
}

/** The 炎佑 standing on the field (alive + deployed, the shared `onField` reading). */
const standing = (h) => h.battle.allyUnits.filter((y) => y && y.defId === 'enemy_9012_acloon' && y.alive && y.deployed);

/** Knock out one deployed operator (a real 'killed' death, not a retreat). Returns the operator, or null. */
function knockOutOne(h) {
  const u = ops(h).find((o) => o.alive);
  if (!u) return null;
  h.battle.dealDamage(null, u, { amount: (u.s.maxHp || 1) * 2, type: 'true', canDodge: false, tags: ['test'] });
  return u;
}

test('人祭: its 炎佑 cap at 9 standing at once — a tenth knock-out summons nothing', () => {
  const h = capBattle(12);
  h.run(1);
  assert.equal(ops(h).length, 12, 'premise: twelve operators are on the field');
  let summoned = 0;
  for (let i = 0; i < 12; i++) {
    const before = standing(h).length;
    const u = knockOutOne(h);
    assert.ok(u, `knock-out ${i + 1} has an operator to kill`);
    assert.equal(u.removeReason, 'killed', 'a real knock-out (premise)');
    if (standing(h).length > before) summoned++;
  }
  // 12 knock-outs, one per knock-out but capped: exactly the first 9 summon, the last 3 are refused
  assert.equal(summoned, 9, `nine knock-outs summoned, the rest hit the cap (got ${summoned})`);
  assert.equal(standing(h).length, 9, 'exactly 9 stand at the ceiling');
  h.invariants();
});

test('人祭: the cap is the field’s state, not a per-battle budget — a 炎佑 that dies frees its slot', () => {
  const h = capBattle(12);
  h.run(1);
  for (let i = 0; i < 9; i++) assert.ok(knockOutOne(h), `knock-out ${i + 1}`);
  assert.equal(standing(h).length, 9, 'premise: the field is at the cap');
  // one 炎佑 leaves the field, so the next knock-out may summon again (nothing was "spent")
  h.battle.dealDamage(null, standing(h)[0], { amount: 1e9, type: 'true', canDodge: false, tags: ['test'] });
  assert.equal(standing(h).length, 8, 'premise: a slot is free');
  assert.ok(knockOutOne(h), 'a tenth operator is still deployable');
  assert.equal(standing(h).length, 9, 'the freed slot is used again');
  h.invariants();
});

test('人祭: a 炎佑 the 炎 bond itself summoned counts against the card’s cap', () => {
  const h = capBattle(1);
  h.run(1);
  // the 炎 bond's own channel writes the SAME token id, so nine of them already fill the card's ceiling
  for (let i = 0; i < 9; i++) spawnYanyou(h.battle, 'p1', { atk: 1, hp: 1, count: 1 });
  assert.equal(standing(h).length, 9, 'premise: nine 炎佑 from the 炎 bond');
  assert.ok(knockOutOne(h), 'the operator is knocked out');
  assert.equal(standing(h).length, 9, 'the knock-out added none: the cap counts every 炎佑 on the field');
  h.invariants();
});

test('人祭: the cap comes from the card’s own spec, and the owner’s value is the fallback', () => {
  // the card ships cap 9 (tools/hextech/roster.mjs); this is the record the server and the client both read
  assert.equal(HEXTECH.playerHexes.hex_humanrite.effect.humanRite.cap, 9, 'the roster carries the owner’s cap');
  const h = capBattle(3);
  h.run(1);
  // a battle whose ref predates the key still caps at 9 (the module's documented fallback)
  const ref = h.battle.players[0].playerEffects.find((e) => e.data?.hexId === 'hex_humanrite');
  delete ref.params.humanRite.cap;
  for (let i = 0; i < 3; i++) assert.ok(knockOutOne(h), `knock-out ${i + 1}`);
  assert.equal(standing(h).length, 3, 'three knock-outs, three 炎佑 — below the cap either way');
  h.invariants();
});

test('人祭: without the card a knock-out summons nothing', () => {
  const h = soloBattle({ enemies: [] });
  h.run(1);
  h.battle.retreat(ops(h)[0], { reason: 'killed' });
  assert.equal(h.battle.allyUnits.filter((y) => y && y.defId === 'enemy_9012_acloon').length, 0);
});
