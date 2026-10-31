// test/content/feedback8-indom-instant.test.js — 不屈 rolls once per KNOCK-OUT, not once per instant.
//
// Owner's report 2026-10-30 「不屈盟约100%时有概率不生效」: at 100 % (≥ 205 layers) an operator sometimes stayed on the
// ground. Cause: the death hook bailed out on `u.mem[ID.indom] === battle.time`, and `battle.time` is fixed for a whole
// tick (TICK = 1/30 s) — so a SECOND knock-out inside the same tick never rolled. Two ranged enemies of one wave walk in
// lockstep and fire in the same tick, which is exactly the case a player meets: the first shot is answered by 不屈, the
// second one in the same tick was swallowed and the operator lay there for its whole redeploy timer.
//
// The guard's real job — a revive that dies again INSIDE its own `redeploy` call (a deploy hook that kills) must not
// loop — is now a re-entrancy flag (`u.mem.indomBusy`), not a timestamp.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeBattle, chessRec, enemyRec, checkInvariants } from '../helpers/battleHarness.js';

const bondOn = (count, layers = 0, tier = null, thresholds = [2, 3]) => ({
  count, active: count >= thresholds[0], tier: tier ?? thresholds.filter((t) => count >= t).length, layers,
});
/** 不屈 at p = 1 (0.18 + 0.004 × 300 > 1). */
const INDOM = (layers = 300, count = 2) => ({ indomShip: bondOn(count, layers) });
const groundOp = (id, extra = {}) => chessRec({ id, profession: 'WARRIOR', skill: null, bonds: ['indomShip'], stats: { atk: 1, maxHp: 500, def: 0, respawnTime: 70 }, ...extra });
/** A ranged enemy: it stops at range and shoots, so two of one wave fire in the same tick. */
const shooter = (id) => enemyRec({ key: id, name: id, hp: 100000, atk: 900, def: 0, speed: 1, range: 2.5, dmgType: 'phys', aspd: 100 });

test('不屈 at p = 1: two ranged enemies of one wave fire in the same tick — the second knock-out rolls too (owner 2026-10-30)', () => {
  for (let seed = 1; seed <= 8; seed++) {
    const h = makeBattle({
      seed, stageId: 'flat',
      defs: { chess: { t_a: groundOp('t_a') }, enemies: { e1: shooter('e1'), e2: shooter('e2') } },
      units: [{ chessId: 't_a', row: 9, col: 5 }],
      bonds: INDOM(300),
      enemies: [{ key: 'e1', time: 1, route: 0 }, { key: 'e2', time: 1, route: 0 }],
      timeLimit: 60, autoFinish: false,
    });
    // every knock-out of the operator, with the instant it happened at
    const hits = [];
    h.b.on('death', (c) => { if (c.unit && c.unit.defId === 't_a') hits.push({ t: h.b.time, back: c.unit.alive }); }, { priority: -50 });
    h.runToEnd(60);
    const u = h.unit('t_a');
    assert.ok(hits.length >= 2, `seed ${seed}: the operator was knocked out more than once (${hits.length})`);
    // the case the report is about: two knock-outs inside ONE tick — both must come back
    const sameTick = hits.filter((x) => hits.some((y) => y !== x && y.t === x.t));
    assert.ok(sameTick.length >= 2, `seed ${seed}: a same-instant knock-out pair exists (${JSON.stringify(hits)})`);
    assert.ok(u.alive && u.deployed, `seed ${seed}: the operator ends on the field, not on the ground`);
    checkInvariants(h.b);
  }
});

test('不屈 at p = 1: two knock-outs in one instant by direct damage — each rolls (the old guard swallowed the second)', () => {
  const h = makeBattle({
    defs: { chess: { t_a: groundOp('t_a') } }, units: [{ chessId: 't_a', row: 9, col: 5 }],
    bonds: INDOM(300), autoFinish: false, timeLimit: 60,
  });
  h.step();
  const u = h.unit('t_a');
  h.b.dealDamage(null, u, { amount: 1e9, type: 'true' });
  assert.ok(u.alive, 'the first knock-out: 不屈 brought it back');
  const t = h.b.time;
  h.b.dealDamage(null, u, { amount: 1e9, type: 'true' });
  assert.equal(h.b.time, t, 'still the same instant');
  assert.ok(u.alive && u.deployed, 'the second knock-out in the same instant rolls on its own and brings it back');
  checkInvariants(h.b);
});

test('不屈: a knock-out that arrives INSIDE its own revive (a deploy hook that kills) does not loop', () => {
  const h = makeBattle({
    defs: { chess: { t_a: groundOp('t_a') } }, units: [{ chessId: 't_a', row: 9, col: 5 }],
    bonds: INDOM(300), autoFinish: false, timeLimit: 20,
    extraContent: [{
      install(battle) {
        // every redeployment of the operator is lethal: the revive's own call stack must not recurse
        battle.on('deploy', (c) => { if (c.unit && c.unit.defId === 't_a' && !c.initial) battle.kill(c.unit); });
      },
    }],
  });
  h.step();
  const u = h.unit('t_a');
  h.b.dealDamage(null, u, { amount: 1e9, type: 'true' });
  assert.ok(h.b.time < 1, 'the battle clock is not stuck in a revive loop');
  assert.ok(!u.alive, 'the nested knock-out is refused (one revive per call), so it stays down');
  h.run(2);
  assert.ok(h.b.time > 2, 'the battle keeps running');
});

test('不屈 at p = 1: the tier-2 +5 SP still counts a knock-out that is answered at once', () => {
  const h = makeBattle({
    defs: { chess: { t_a: groundOp('t_a'), t_b: groundOp('t_b', { skill: { duration: 5, spCost: 50, initSp: 0, bb: { atk: 1 } } }) } },
    units: [{ chessId: 't_a', row: 9, col: 5 }, { chessId: 't_b', row: 9, col: 7 }],
    bonds: { indomShip: bondOn(3, 300, null, [2, 3]) }, autoFinish: false, timeLimit: 60,
  });
  h.step();
  const [a, b] = [h.unit('t_a'), h.unit('t_b')];
  const sp0 = b.skill.sp;
  h.b.dealDamage(null, a, { amount: 1e9, type: 'true' });
  assert.ok(a.alive, 'back at once');
  assert.ok(b.skill.sp > sp0, 'the tier-2 line pays its +5 SP');
  checkInvariants(h.b);
});
