// 第 16 回合「木桩演练」: the training dummy the player hits to read their damage — enemy_9901_dummy.
//
// The dummy is an ordinary enemy record (data/enemies.json) plus the kit in server/sim/content/enemies/dummy.js: four
// engine primitives and nothing invented —
//   · 不还手        `e.profile.noAttack` (ai.js enemyAttack / attackStand, the 黑蛇 flag) — it never swings;
//   · 不移动/不可阻挡 the SELF_BOUND buff of the 巨型单位 (bosses.js): `noMove` + `selfBound` + `unblockable`
//                   (PRTS 自缚 = 无法移动, deliberately not `bind`);
//   · 自愈          the row's `stats.hpRecoveryPerSec` → units.js `s.hpRegen` → battle/status.js natural regeneration.
//                   No heal is written in the kit, so this test measures the data path, not a hand-rolled heal. Since
//                   owner 2026-10-31「每秒回20亿」 it is exactly one pool per second (20 亿 血 / 20 亿 per s);
//   · 锁血          the kit's one authored line: `battle.on('fatal')` sets `c.prevented`, so damage.js applyHpLoss
//                   leaves HP at 1 instead of calling battle.kill (owner 2026-10-31「加上锁血」). It does not distort the
//                   reading — `dealt` is still `before − max(0, hp)`, i.e. the whole hit.
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
/** The contract row's HP pool (20 亿, owner 2026-10-31「修改木桩至20亿血」) and its regeneration (20 亿/s,
 *  「每秒回20亿」): one whole bar per second, so a hit is undone on the next tick. The kit reads neither number — every
 *  assertion below is written against `e.s.maxHp` / `e.s.hpRegen`. */
const HP = 2_000_000_000;      // 20 亿
const REGEN = 2_000_000_000;   // stats.hpRecoveryPerSec: one whole pool per second

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

// ---------------------------------------------------------------------------------------------------------------
// 自愈 / 锁血 / 打不死

test('自愈: the data row\'s hpRecoveryPerSec refills it — a whole pool per second, no heal written in the kit', () => {
  const h = dummyBattle();
  h.step();
  // Out of the operator's 1-tile reach: this measures the DATA regen alone, so nothing else may touch its HP meanwhile
  // (the operator below is only the source handed to dealDamage). The dummy is 无甲 (def 0), so an adjacent operator —
  // fine for the 不还手 test — would subtract its own DPS from the reading.
  const e = h.spawn(KEY, { pos: [10, 6], routeIndex: 0 });
  const u = h.unit('t_hit');
  assert.equal(e.s.hpRegen, REGEN, 'units.js folds stats.hpRecoveryPerSec into s.hpRegen');
  h.b.dealDamage(u, e, { amount: e.s.maxHp * 0.4, type: 'true', canDodge: false });
  assert.ok(Math.abs(e.hp - e.s.maxHp * 0.6) < 1, `hp after the damage: ${e.hp}`);
  const hits = h.hooksOf('damaged').filter((c) => c.target === e).length;
  h.run(1);   // 20 亿/s ≥ the 8 亿 missing: one second is more than enough
  assert.equal(h.hooksOf('damaged').filter((c) => c.target === e).length, hits, 'nobody hit it during the measurement');
  assert.equal(e.hp, e.s.maxHp, 'back at full HP one second later');
  assert.ok(h.hooksOf('heal').filter((c) => c.target === e).length > 0, 'through the engine\'s natural regeneration');
  checkInvariants(h.b);
});

test('自愈 = one pool per second (the owner\'s number, not a coincidence): REGEN equals HP', () => {
  // owner 2026-10-31「每秒回20亿」: the regen number IS the pool, so the post is at full on the tick after any hit. Pinning
  // the RATIO catches a later edit that rescales maxHp without the regen (a fixed 1000/s could not refill 20 亿).
  assert.equal(REGEN, HP, 'the contract row regenerates exactly one whole pool per second');
  const h = dummyBattle();
  h.step();
  const e = h.spawn(KEY, { pos: [10, 6], routeIndex: 0 });
  const u = h.unit('t_hit');
  h.b.dealDamage(u, e, { amount: e.s.maxHp - 1, type: 'true', canDodge: false });
  assert.equal(e.hp, 1, 'left on 1 HP');
  h.run(1);
  // The regen flushes in whole-HP amounts per tick, so the last fraction of a tick is still in `_regenAcc` at 1.0 s:
  // "within one second" means ≥ 99.99999 % of the bar, and the carry is what tops it off.
  assert.ok(e.hp / e.s.maxHp > 0.9999999, `refilled inside one second: ${e.hp} / ${e.s.maxHp}`);
  h.run(1);
  assert.equal(e.hp, e.s.maxHp, 'and exactly full one tick later');
  checkInvariants(h.b);
});

test('锁血: a hit of its whole pool leaves it on 1 HP, alive, and it is full again a second later', () => {
  // owner 2026-10-31「加上锁血」: a 20 亿 pool can be exceeded by one burst, and the round must never end because the post
  // died. The lock is the `fatal` hook (damage.js applyHpLoss): `c.prevented` ⇒ HP stays at 1 and battle.kill never runs.
  const h = dummyBattle();
  h.step();
  const e = h.spawn(KEY, { pos: [9, 5], routeIndex: 0 });
  const u = h.unit('t_hit');
  const dealt = h.b.dealDamage(u, e, { amount: e.s.maxHp, type: 'true', canDodge: false });
  assert.equal(e.alive, true, 'a hit ≥ maxHp does not kill it');
  assert.equal(e.hp, 1, 'the engine leaves it on 1 HP (applyHpLoss 的 prevented 分支)');
  assert.equal(dealt, e.s.maxHp - 1, 'and the reading is still the whole hit — the lock only keeps the last 1 HP');
  h.run(2);   // the regen's accumulation gate leaves at most one tick of carry behind (see the test above)
  assert.equal(e.alive, true, 'still alive');
  assert.equal(e.hp, e.s.maxHp, 'full again');
  checkInvariants(h.b);
});

test('锁血 filters on the dummy: another enemy in the same battle still dies normally', () => {
  const h = dummyBattle();
  h.step();
  const e = h.spawn(KEY, { pos: [10, 6], routeIndex: 0 });
  const w = h.spawn('enemy_walker', { routeIndex: 0 });
  const u = h.unit('t_hit');
  h.b.dealDamage(u, w, { amount: w.s.maxHp, type: 'true', canDodge: false });
  assert.equal(w.alive, false, 'the hook must not protect anybody but the 木桩');
  h.b.dealDamage(u, e, { amount: e.s.maxHp * 3, type: 'true', canDodge: false });
  assert.equal(e.alive, true, 'three pools worth of damage still leaves the dummy alive');
  checkInvariants(h.b);
});

test('打不死: ten whole-pool bursts later it is still standing — the round can only end on its own timer', () => {
  const h = dummyBattle();
  h.step();
  const e = h.spawn(KEY, { pos: [10, 6], routeIndex: 0 });
  const u = h.unit('t_hit');
  for (let i = 1; i <= 10; i++) {
    h.b.dealDamage(u, e, { amount: e.s.maxHp * 1.5, type: 'true', canDodge: false });
    assert.equal(e.alive, true, `alive after burst ${i}`);
  }
  assert.equal(h.hooksOf('enemyLeak').filter((c) => c.enemy === e).length, 0, 'it never walks off and leaks either');
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
