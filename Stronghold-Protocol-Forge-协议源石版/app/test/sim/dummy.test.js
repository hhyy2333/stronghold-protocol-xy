// 第 16 回合「木桩演练」: the training dummy the player hits to read their damage — enemy_9901_dummy.
//
// The dummy is an ordinary enemy record (data/enemies.json) plus the kit in server/sim/content/enemies/dummy.js: three
// engine primitives and nothing invented —
//   · 不还手        `e.profile.noAttack` (ai.js enemyAttack / attackStand, the 黑蛇 flag) — it never swings;
//   · 不移动/不可阻挡 the SELF_BOUND buff of the 巨型单位 (bosses.js): `noMove` + `selfBound` + `unblockable`
//                   (PRTS 自缚 = 无法移动, deliberately not `bind`);
//   · 自愈          the row's `stats.hpRecoveryPerSec` → units.js `s.hpRegen` → battle/status.js natural regeneration.
//                   No heal is written in the kit, so this test measures the data path, not a hand-rolled heal.
//
// The kit is exercised on a SYNTHETIC record (enemyRec) so these tests need no generated data; the last test pins the real
// data/enemies.json row against the same contract and runs as soon as build-data has generated it.
//
// Run: `node test/sim/dummy.test.js` (the sandbox cannot spawn `node --test` subprocesses).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { makeBattle, chessRec, enemyRec, checkInvariants } from '../helpers/battleHarness.js';
import { KITS, STATS_ONLY } from '../../server/sim/content/enemies.js';
import { DUMMY_KITS } from '../../server/sim/content/enemies/dummy.js';

const E = JSON.parse(fs.readFileSync(new URL('../../data/enemies.json', import.meta.url), 'utf8'));

const KEY = 'enemy_9901_dummy';
/** The contract row's HP pool: 5 × the ABYSS 首领血池 (4,000,000), so a full team cannot empty it inside the round's
 *  measurement window. The kit does not read it — every assertion below is written against `e.s.maxHp`. */
const HP = 32_500_000_000;   // 325 亿, owner 2026-10-30「木桩太脆了，血量改为325亿」
const REGEN = 1000;   // stats.hpRecoveryPerSec of the contract row

/** The contract's row shape, built synthetically (data/enemies.json enemy_9901_dummy is a copy of enemy_9033_acdeer).
 *  def / res are 0 — the dummy is a 量具, not an enemy: with the template's 800 DEF the physical formula
 *  `max(A − D, 5 %·A)` floors every low-ATK operator at the same 5 % (40 a hit at ATK 800), which measures "damage
 *  against an 800 DEF target" instead of the operator's own output. */
function dummyRec(o = {}) {
  const rec = enemyRec({ key: KEY, hp: HP, atk: 0, def: 0, res: 0, speed: 0, bat: 6, lpr: 0, ...o });
  rec.stats.hpRecoveryPerSec = o.regen ?? REGEN;
  return rec;
}

/** A free-walking enemy with the same body and no kit: the control that shows the dummy's stillness is the kit's doing. */
const walkerRec = () => enemyRec({ key: 'enemy_walker', hp: HP, atk: 0, speed: 1, lpr: 0 });

/** A 1-tile-range attacker: on (9,4) facing RIGHT it reaches (9,5). */
const blade = (id = 't_hit', stats = {}) => chessRec({ id, stats: { atk: 100, maxHp: 1e5, blockCnt: 0, ...stats }, rangeGrid: [[0, 1]], skill: null });

function dummyBattle(opts = {}) {
  return makeBattle({
    content: 'full', autoFinish: false, timeLimit: 400, captureNoisy: true,
    hooks: ['attack', 'damaged', 'heal', 'enemyLeak', 'blocked'],
    defs: { chess: { t_hit: blade() }, enemies: { [KEY]: dummyRec(), enemy_walker: walkerRec() } },
    units: [{ chessId: 't_hit', row: 9, col: 4, dir: 'RIGHT' }],
    ...opts,
  });
}

// ---------------------------------------------------------------------------------------------------------------
// registration + the spawn contract

test('the 木桩 key is registered as a kit, and not as stats-only as well (enemies.js asserts one or the other)', () => {
  assert.equal(typeof DUMMY_KITS[KEY], 'function');
  assert.equal(KITS[KEY], DUMMY_KITS[KEY], 'KITS carries the dummy kit (spread into enemies.js)');
  assert.ok(!STATS_ONLY[KEY], 'not in STATS_ONLY: a key in both would attach no ability and eat the kit');
});

test('spawn: 不还手 (noAttack) + 自缚 / 不可阻挡 (noMove + selfBound + unblockable, the SELF_BOUND flags)', () => {
  const h = dummyBattle();
  h.step();
  const e = h.spawn(KEY, { pos: [9, 5], routeIndex: 0 });
  assert.equal(e.profile.noAttack, true, 'noAttack');
  assert.equal(e.s.flags.noMove, true, 'noMove (自缚)');
  assert.equal(e.s.flags.selfBound, true, 'selfBound');
  assert.equal(e.s.flags.unblockable, true, 'unblockable');
  assert.ok(!e.s.flags.bind, '自缚 is not recognised as 束缚');
  h.run(2);
  assert.equal(e.profile.noAttack, true, 'and it stays set (no form change takes it back)');
  assert.equal(h.hooksOf('attack').filter((c) => c.attacker === e).length, 0);
  checkInvariants(h.b);
});

// ---------------------------------------------------------------------------------------------------------------
// 不还手

test('不还手: 30 s next to an operator — the dummy attacks 0 times and the operator loses 0 HP', () => {
  const h = dummyBattle();
  h.step();
  const e = h.spawn(KEY, { pos: [9, 5], routeIndex: 0 });
  const u = h.unit('t_hit');
  const hp0 = u.hp;
  h.run(30);
  assert.ok(h.hooksOf('attack').filter((c) => c.attacker === u).length > 0, 'the operator does hit the dummy (they are adjacent)');
  assert.equal(h.hooksOf('attack').filter((c) => c.attacker === e).length, 0, 'the dummy never attacks');
  assert.equal(h.hooksOf('damaged').filter((c) => c.source === e).length, 0, 'and deals no damage at all');
  assert.equal(u.hp, hp0, 'the operator is untouched');
  assert.ok(e.alive, 'the dummy is still there');
  checkInvariants(h.b);
});

test('不可阻挡: an operator standing on the dummy tile does not block it, and it does not walk off either', () => {
  const wall = chessRec({ id: 't_wall', stats: { atk: 10, maxHp: 1e9, def: 5000, blockCnt: 3 }, rangeGrid: [[0, 0]], skill: null });
  const h = dummyBattle({ defs: { chess: { t_wall: wall }, enemies: { [KEY]: dummyRec() } }, units: [{ chessId: 't_wall', row: 10, col: 6, dir: 'RIGHT' }] });
  h.step();
  const u = h.unit('t_wall');
  const e = h.spawn(KEY, { pos: [u.tileR, u.tileC], routeIndex: 0 });
  h.run(5);
  assert.equal(e.blockedBy, null, 'never blocked');
  assert.equal(u.blocking.length, 0, 'and it holds no block slot on the operator');
  assert.deepEqual([e.y, e.x], [u.tileR, u.tileC], 'it stays on the tile it spawned on');
  checkInvariants(h.b);
});

// ---------------------------------------------------------------------------------------------------------------
// 自愈 / 打不死

test('自愈: the data row\'s hpRecoveryPerSec refills it — 1000 HP per second, no heal written in the kit', () => {
  const h = dummyBattle();
  h.step();
  // Out of the operator's 1-tile reach: this measures the DATA regen alone, so nothing else may touch its HP meanwhile
  // (the operator below is only the source handed to dealDamage). The dummy is 无甲 (def 0), so an adjacent operator —
  // fine for the 不还手 test — would subtract its own DPS from the reading.
  const e = h.spawn(KEY, { pos: [10, 6], routeIndex: 0 });
  const u = h.unit('t_hit');
  assert.equal(e.s.hpRegen, REGEN, 'units.js folds stats.hpRecoveryPerSec into s.hpRegen');
  h.b.dealDamage(u, e, { amount: 40000, type: 'true', canDodge: false });
  assert.ok(Math.abs(e.hp - (HP - 40000)) < 1, `hp after the damage: ${e.hp}`);
  const hits = h.hooksOf('damaged').filter((c) => c.target === e).length;
  const hpLow = e.hp;
  h.run(30);
  assert.equal(h.hooksOf('damaged').filter((c) => c.target === e).length, hits, 'nobody hit it during the measurement');
  const gained = e.hp - hpLow;
  // 30 s × 1000 HP/s; the accumulation gate costs at most one tick
  assert.ok(gained > 29999 && gained <= 30000 + 1e-6, `regenerated ${gained} HP in 30 s (expected 30000)`);
  assert.ok(h.hooksOf('heal').filter((c) => c.target === e).length > 0, 'through the engine\'s natural regeneration');
  checkInvariants(h.b);
});

test('打不死: a single hit of 95 % of its pool leaves it alive, and it starts refilling again right away', () => {
  // The dummy has NO death-prevention: a single hit ≥ maxHp kills it, deliberately — 免死 (invulnerable) would also stop
  // the damage the player is there to measure, and 频次 (setHits) would turn its HP into a hit counter. What keeps the
  // measurement window open is the pool's SIZE (5 × the ABYSS 首领血池) plus the data regen, not a cancel — so this test
  // pins the 95 % hit and the refill, never a fixed number.
  const h = dummyBattle();
  h.step();
  const e = h.spawn(KEY, { pos: [10, 6], routeIndex: 0 });   // out of the operator's reach: the refill is measured alone
  const u = h.unit('t_hit');
  h.b.dealDamage(u, e, { amount: e.s.maxHp * 0.95, type: 'true', canDodge: false });
  assert.ok(e.alive, 'still alive after a hit worth 95 % of its whole pool');
  assert.ok(Math.abs(e.hpRatio - 0.05) < 1e-6, `left at 5 % (${e.hpRatio})`);
  const hits = h.hooksOf('damaged').filter((c) => c.target === e).length;
  const hpLow = e.hp;
  h.run(60);
  assert.equal(h.hooksOf('damaged').filter((c) => c.target === e).length, hits, 'nobody hit it meanwhile');
  assert.ok(e.alive, 'alive a minute later');
  assert.ok(e.hp > hpLow, `and it has been refilling the whole time (${hpLow} → ${e.hp})`);
  assert.equal(h.hooksOf('enemyLeak').filter((c) => c.enemy === e).length, 0, 'it never walks off and leaks either');
  checkInvariants(h.b);
});

test('no 免死 is installed (deliberate): a hit of its whole pool does kill it — the dummy is durable, not invulnerable', () => {
  const h = dummyBattle();
  h.step();
  const e = h.spawn(KEY, { pos: [9, 5], routeIndex: 0 });
  const u = h.unit('t_hit');
  h.b.dealDamage(u, e, { amount: e.s.maxHp, type: 'true', canDodge: false });
  assert.equal(e.alive, false, 'a hit ≥ maxHp is lethal: no invulnerable / 免死 flag on the dummy');
  assert.deepEqual(e.buffs.filter((b) => b.flags && (b.flags.invulnerable || b.flags.untargetable)), [], 'and no such buff either');
  checkInvariants(h.b);
});

// ---------------------------------------------------------------------------------------------------------------
// 不移动

test('不移动: with a route that walks it to the goal, 10 s later the position is unchanged (an identical no-kit enemy does walk)', () => {
  const h = dummyBattle({ units: [] });
  h.step();
  const e = h.spawn(KEY, { routeIndex: 0 });          // flat stage route 0: (9,10) → (9,2)
  const w = h.spawn('enemy_walker', { routeIndex: 1 }); // flat stage route 1: (12,10) → (9,2)
  const at = [e.x, e.y];
  const wAt = [w.x, w.y];
  h.run(10);
  assert.deepEqual([e.x, e.y], at, 'the dummy did not move (selfBound / noMove)');
  assert.ok(w.x !== wAt[0] || w.y !== wAt[1], 'the control enemy did (the route and its speed are fine)');
  assert.equal(h.hooksOf('enemyLeak').filter((c) => c.enemy === e).length, 0, 'and it never reaches the goal');
  checkInvariants(h.b);
});

// ---------------------------------------------------------------------------------------------------------------
// the real row (runs once build-data has generated data/enemies.json enemy_9901_dummy)

test('data: enemy_9901_dummy carries the contract stats (a copy of enemy_9033_acdeer at the dummy numbers)',
  { skip: E[KEY] ? false : 'data/enemies.json has no enemy_9901_dummy yet (generated by build-data)' },
  () => {
    const row = E[KEY];
    assert.equal(row.stats.maxHp, HP, 'maxHp');
    assert.equal(row.stats.atk, 0, 'atk 0 — it cannot hurt anyone even without the flag');
    assert.equal(row.stats.def, 0, 'def 0 — an unarmoured target (the template\'s 800 would floor every low-ATK reading at 5 %)');
    assert.equal(row.stats.res, 0, 'res 0 — same for arts');
    assert.equal(row.stats.moveSpeed, 0, 'moveSpeed 0');
    assert.equal(row.stats.bat, 6, 'bat');
    assert.equal(row.stats.lpr, 0, 'lpr 0 — a leak costs no LP');
    assert.equal(row.stats.hpRecoveryPerSec, REGEN, 'hpRecoveryPerSec — the 自愈');
    // 木桩是 fork 自造的 1 格体，`hitArea` 只给 PRTS 有据的巨型单位（tools/build-data.mjs 的 HIT_AREAS 与 bosses.js 的
    // SELF_BOUND 互为充要，test/sim/playtest5_bossbody.test.js 钉着这条不变量）。The row is a copy of enemy_9033_acdeer —
    // a 巨型单位 — so its body must NOT come along with the copy.
    assert.deepEqual(row.hitArea, { w: 4.95, h: 2.95, dx: 0, dy: 1 }, 'takes 萨米 body: it draws that model on the boss field');
    // the kit must still be the thing that stops it, not the row's speed alone
    assert.equal(KITS[KEY], DUMMY_KITS[KEY]);
  });
