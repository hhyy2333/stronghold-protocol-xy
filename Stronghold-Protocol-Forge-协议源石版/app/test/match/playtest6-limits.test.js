// Official limits on the match side (docs/research/11-limits-official.md): bond layers stop at 999 per bond
// (shared/constants.js BOND_LAYER_CAP: PlayerState.addLayers, the settle of the in-battle gains, the client-result
// check, the invariants) and the boss-hit limit 限伤 (BOSS_HIT_LIMIT 300000) in a real Final Assault / Hidden Core with a
// 999-layer board.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PHASE, BOND_LAYER_CAP, BOSS_HIT_LIMIT } from '../../shared/constants.js';
import { Battle } from '../../server/sim/Battle.js';
import { validateClientResult } from '../../server/match/fields.js';
import { collectViolations } from '../../server/match/invariants.js';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { makeMatch, give, legalTileFor, DATA, withoutHextech } from './harness.js';
import { planBoard, applyBoard, makeMatch as balanceMatch, withoutTuning } from '../../tools/balance.mjs';
import { buildNormalWave } from '../../server/match/waves.js';
import { createRng } from '../../server/sim/rng.js';
import { buildBattleSpec, createBattleFromSpec } from '../../server/sim/spec.js';
import { specBattleOpts } from '../../server/match/match/battleOpts.js';

/** A solo match (fake battles) at PREP R1 with an empty layer table; onLayers dispatches are recorded. */
function prepMatch(seed = 71, o = {}) {
  const h = makeMatch({ mode: 'solo', difficulty: 'HARD', seed, fake: true, ...o }).start();
  h.toPrep(1);
  const m = h.m;
  const ps = h.ps('p_0');
  ps.layers = {};
  ps.recompute();
  const onLayers = [];
  const dispatch = m.dispatch.bind(m);
  m.dispatch = (p, hook, ev, opts) => { if (hook === 'onLayers') onLayers.push({ ...ev }); return dispatch(p, hook, ev, opts); };
  return { h, m, ps, onLayers };
}

test('PlayerState.addLayers: a gain stops at 999; onLayers reports the clamped count; a gain at the cap adds 0 and dispatches nothing', () => {
  const { m, ps, onLayers } = prepMatch();
  assert.equal(ps.addLayers('yanShip', 1500), BOND_LAYER_CAP);
  assert.equal(ps.layers.yanShip, 999);
  assert.deepEqual(onLayers.map((e) => [e.bondId, e.from, e.to]), [['yanShip', 0, 999]]);
  assert.equal(ps.bonds.yanShip.layers, 999, 'the bond view shows the capped count');
  assert.equal(ps.addLayers('yanShip', 5), 0);
  assert.equal(onLayers.length, 1, 'no onLayers at the cap');
  // each bond on its own
  assert.equal(ps.addLayers('kjeragShip', 40), 40);
  assert.equal(ps.layers.kjeragShip, 40);
  ps.layers.lateranoShip = 996;
  assert.equal(ps.addLayers('lateranoShip', 10), 3);
  assert.equal(ps.layers.lateranoShip, 999);
  // what the client sees: m.private bonds and the public bond list
  const priv = ps.privateView();
  assert.equal(priv.bonds.find((b) => b.bondId === 'yanShip').layers, 999);
  assert.deepEqual(collectViolations(m), []);
  m.dispose();
});

test('a real prep 特质 at the cap: 烛煌 获得时 炎 / 维多利亚 +5 adds 2 to a 997-layer 炎 and 5 to 维多利亚', () => {
  const { m, ps, onLayers } = prepMatch(72);
  ps.layers.yanShip = 997;
  ps.recompute();
  ps.acquireChess('chess_char_5_03_a', { source: 'test' });
  assert.equal(ps.layers.yanShip, 999);
  assert.equal(ps.layers.victoriaShip, 5);
  assert.deepEqual(onLayers.filter((e) => e.bondId === 'yanShip').map((e) => [e.from, e.to]), [[997, 999]]);
  ps.acquireChess('chess_char_5_03_a', { source: 'test' });
  assert.equal(ps.layers.yanShip, 999, 'nothing more');
  assert.equal(ps.layers.victoriaShip, 10);
  assert.equal(onLayers.filter((e) => e.bondId === 'yanShip').length, 1);
  m.dispose();
});

test('settle: in-battle layer gains are clamped at 999 (once at the line, then nothing — no onLayers for a capped bond)', () => {
  const { h, m, ps, onLayers } = prepMatch(73, { script: (b) => (b.kind === 'normal' ? { duration: 1, layerGains: { p_0: { yanShip: 50, kjeragShip: 7 } } } : {}) });
  ps.layers.yanShip = 980;
  ps.recompute();
  onLayers.length = 0;
  h.toPrep(2);
  assert.equal(ps.layers.yanShip, 999, '980 + 50 → 999');
  assert.equal(ps.layers.kjeragShip, 7);
  assert.deepEqual(onLayers.filter((e) => e.reason === 'battle').map((e) => [e.bondId, e.from, e.to]), [['yanShip', 980, 999], ['kjeragShip', 0, 7]]);
  onLayers.length = 0;
  h.toPrep(3);
  assert.equal(ps.layers.yanShip, 999);
  assert.equal(ps.layers.kjeragShip, 14);
  assert.deepEqual(onLayers.filter((e) => e.reason === 'battle').map((e) => e.bondId), ['kjeragShip'], 'the capped bond dispatches nothing');
  h.invariants();
  m.dispose();
});

test('client-result check: a reported layer gain may not pass 999 from the bond\'s starting layers', () => {
  const { m } = prepMatch(74);
  const spec = {
    kind: 'normal', round: 5, timeLimit: 60, spawns: [], flags: { layerGainsEnabled: true },
    players: [{ playerId: 'p_0', units: [], bonds: { yanShip: { count: 3, active: true, tier: 1, layers: 990 }, kjeragShip: { count: 2, active: true, tier: 1, layers: 0 } } }],
  };
  const res = (gains) => ({ reason: 'cleared', time: 10, perPlayer: { p_0: { killed: 0, total: 0, leaked: [], perfect: true, layerGains: gains, coins: 0, unitsEnd: [], unitStats: [] } } });
  const ok = validateClientResult(spec, res({ yanShip: 9, kjeragShip: 80 }), { gd: m.gd });
  assert.equal(ok.ok, true, ok.reason);
  assert.deepEqual(ok.result.perPlayer.p_0.layerGains, { yanShip: 9, kjeragShip: 80 });
  assert.deepEqual(validateClientResult(spec, res({ yanShip: 10 }), { gd: m.gd }), { ok: false, reason: 'layer bound' }, '990 + 10 > 999');
  assert.deepEqual(validateClientResult(spec, res({ kjeragShip: 81 }), { gd: m.gd }), { ok: false, reason: 'layer bound' }, 'the per-round bound 60 + 4·5 still holds');
  const capped = { ...spec, players: [{ ...spec.players[0], bonds: { yanShip: { count: 3, active: true, tier: 1, layers: 999 } } }] };
  assert.deepEqual(validateClientResult(capped, res({ yanShip: 1 }), { gd: m.gd }), { ok: false, reason: 'layer bound' }, 'a capped bond gains nothing');
  assert.equal(validateClientResult(capped, res({ yanShip: 0 }), { gd: m.gd }).ok, true);
  m.dispose();
});

test('invariants: a bond above 999 is a violation (no writer may pass the cap)', () => {
  const { m, ps } = prepMatch(75);
  ps.layers.yanShip = 1000;
  ps.recompute();
  assert.ok(collectViolations(m).some((v) => /yanShip layers 1000/.test(v)));
  ps.layers.yanShip = 999;
  ps.recompute();
  assert.deepEqual(collectViolations(m), []);
  m.dispose();
});

// ---- a real Final Assault (and Hidden Core) with a 999-layer board ----------------------------------------------

const YAN = ['chess_char_6_15_a', 'chess_char_5_12_a', 'chess_char_4_17_a', 'chess_char_3_03_a'];
/** Every enemy takes ×K damage — a stand-in for the 999-layer debuffs of a real board (谢拉格 ×11.34 vs cold / frozen,
 * 奥术 ×11.19 arts taken): with 炎 at 999 (ATK ×10.22) the hits land far past 300000. Once `relentAfter` leader hits
 * were cancelled the leaders lose the stand-in so the fight can finish. */
const K = 2000;
function limitBattleClass(log, relentAfter = 6) {
  return class extends Battle {
    constructor(opts) {
      const user = opts.setup;
      super({ ...opts, setup: (b) => {
        if (typeof user === 'function') user(b);
        if (b.kind !== 'boss' && b.kind !== 'hidden') return;
        const rec = { kind: b.kind, battle: b, caps: [], leaderHits: [], credits: [], relented: false };
        log.push(rec);
        const fx0 = b.fx.bind(b);
        b.fx = (k, p) => {
          if (k === 'hitCap') {
            rec.caps.push(p.n);
            if (!rec.relented && rec.caps.length >= relentAfter) {
              rec.relented = true;
              b.after(0, () => { for (const e of b.enemies) if (e.isBoss) b.removeBuff(e, 'test:999debuffs'); });
            }
          }
          return fx0(k, p);
        };
        b.on('enemySpawn', ({ enemy }) => { if (!(enemy.isBoss && rec.relented)) b.addBuff(enemy, { key: 'test:999debuffs', mods: { dmgTakenMul: K } }); });
        b.on('damaged', (c) => {
          if (!c.target || !c.target.isBoss || c.type === 'element') return;
          rec.leaderHits.push(c.amount);
        }, { priority: -1000 });
        if (b.sharedBoss) {
          const pool = b.sharedBoss;
          const dmg = pool.damage.bind(pool);
          pool.damage = (pid, amount) => { rec.credits.push(amount); return dmg(pid, amount); };
        }
      } });
    }
  };
}

test('Final Assault + Hidden Core with a 999-layer 炎 board (real sim, server-run): every leader hit of ≥ 300000 deals 0 and nothing of it reaches the pool; the hits under the line win', () => {
  // `withoutHextech`: the fixture clears the leader with a FIXED `bossHpMul` of 0.1, so the absolute pool size is what
  // makes the 999-layer board win. Since 2026-10-14 (the owner's 总协议源石阶数 ÷ 人数 rule) a seed-driven hex draft would
  // enlarge it by a factor this fixture does not model — the draft ROUNDS still run (harness.js withoutHextech).
  const h = makeMatch({ mode: 'solo', difficulty: 'HARD', seed: 76, fake: true, captureFrames: false, data: withoutHextech(), script: (b) => (b.kind === 'normal' ? { duration: 1 } : {}) });
  const m = h.m;
  m.bossId = 'boss_6';       // 阿利斯泰尔 walks into the board
  m.hiddenBossId = 'boss_9'; // 假想敌：铳 (完全形态) with its three springs
  m.gd.bossHpMul = () => 0.1; // pools the 4-operator board clears once the stand-in debuff leaves the leaders
  h.start();
  h.toPrep(14);
  const ps = h.ps('p_0');
  for (const p of [...ps.board.values()]) if (p.kind === 'chess') ps.returnCopies(p);
  ps.board.clear();
  const used = new Set();
  for (const id of YAN) {
    const at = legalTileFor(m, ps, id, used);
    used.add(`${at[0]},${at[1]}`);
    give(m, ps, id, 'board', at);
  }
  const before = ps.layers.yanShip || 0;
  assert.equal(ps.addLayers('yanShip', 5000), 999 - before);
  assert.equal(ps.layers.yanShip, 999);
  ps.recompute();
  assert.ok(ps.bonds.yanShip.active, '炎 is active');
  ps.lp = 200;
  const log = [];
  m.BattleClass = limitBattleClass(log);
  h.drive(() => m.phase === PHASE.FINAL_ASSAULT || h.ended != null);
  assert.equal(m.phase, PHASE.FINAL_ASSAULT);
  h.drive(() => h.ended != null, { maxSteps: 8e6 }); // the Final Assault, the Hidden Core's prep (999 activated layers > 350) and fight
  const end = h.ended;
  assert.ok(end, `the match ended (${m.phase} R${m.round})`);
  assert.ok(log.length >= 1, 'a real boss field ran');
  const fa = log[0];
  assert.equal(fa.kind, 'boss');
  const input = fa.battle.getPlayer('p_0');
  assert.equal(input.bonds.yanShip.layers, 999, 'the battle got the capped count');
  const op = fa.battle.allyUnits.find((u) => u.kind === 'op' && u.defId === YAN[0]);
  assert.ok(op, 'the operator fought');
  for (const rec of log) {
    assert.ok(rec.caps.length > 0, `${rec.kind}: hits past the line were cancelled (${rec.caps.length})`);
    assert.ok(rec.caps.every((n) => n >= BOSS_HIT_LIMIT));
    assert.ok(rec.leaderHits.every((a) => Math.ceil(a) < BOSS_HIT_LIMIT), `${rec.kind}: no leader hit of ≥ 300000 landed (max ${Math.max(0, ...rec.leaderHits)})`);
    assert.ok(rec.credits.every((a) => a < BOSS_HIT_LIMIT), `${rec.kind}: nothing ≥ 300000 reached the shared pool`);
    assert.ok(rec.leaderHits.length > 0, `${rec.kind}: hits under the line landed`);
    assert.equal(rec.battle.sharedBoss.hp, 0, `${rec.kind}: the pool was emptied by those`);
    assert.equal(rec.battle.reason, 'cleared');
  }
  assert.equal(end.victory, true, 'the board still won once its hits stayed under the line');
  assert.equal(m.errorCount, 0);
  m.dispose();
});

// ---- the limit has to reach EVERY battle of a boss round, not just the server-run one --------------------------

/**
 * The shape 业主 2026-10-25 reported (「打boss伤害过高时圣聆初雪吞伤害」): a board whose hits are pushed past the line —
 * 999 谢拉格 ×(1.35 + 0.01·L) vs cold / 奥术 ×(1.2 + 0.01·L) arts taken — so her S3 hits 300000+. With 限伤 off
 * (`SP_BOSS_HIT_LIMIT=off`, which every unit in 05-部署 ships and scripts/launch.mjs sets for a local double-click) they
 * must land; with the official default they must be swallowed exactly as before.
 */
const LIMIT_BOARD = ['chess_char_6_02_a'];   // 圣聆初雪 (阵法术师, S3 群山俯首)
/** A real Final Assault (client-side combat, so the spec is what the browser runs) with `bossHitLimit` as configured. */
function limitMatch(bossHitLimit, seed = 78) {
  const h = makeMatch({ mode: 'solo', difficulty: 'HARD', seed, fake: true, captureFrames: false, clientCombat: true, clients: false,
    data: withoutHextech(), script: (b) => (b.kind === 'normal' ? { duration: 1 } : {}) });
  if (bossHitLimit !== undefined) h.m.bossHitLimit = bossHitLimit;
  h.m.bossId = 'boss_6';
  h.m.gd.bossHpMul = () => 0.1;
  h.start();
  h.toPrep(14);
  const ps = h.ps('p_0');
  for (const p of [...ps.board.values()]) if (p.kind === 'chess') ps.returnCopies(p);
  ps.board.clear();
  const used = new Set();
  for (const id of LIMIT_BOARD) {
    const at = legalTileFor(h.m, ps, id, used);
    used.add(`${at[0]},${at[1]}`);
    give(h.m, ps, id, 'board', at);
  }
  for (const b of ['kjeragShip', 'arcaneShip']) { ps.addLayers(b, 5000); assert.equal(ps.layers[b], 999); }
  ps.recompute();
  ps.lp = 200;
  h.drive(() => h.m.phase === PHASE.FINAL_ASSAULT || h.ended != null);
  assert.equal(h.m.phase, PHASE.FINAL_ASSAULT);
  return h;
}

test('限伤 off (SP_BOSS_HIT_LIMIT=off) reaches a CLIENT-run boss field: the browser\'s own battle must have the override too', () => {
  const h = limitMatch(Infinity);
  const m = h.m;
  const f = m.fields[0];
  assert.equal(f.kind, 'boss');
  assert.ok(Object.hasOwn(f.spec, 'bossHitLimit'), 'the client-run boss BattleSpec carries the 限伤 override');
  assert.equal(f.spec.bossHitLimit, null, 'null on the wire = Infinity (JSON has no Infinity)');
  // the browser rebuilds exactly this spec and nothing else (public/js/battle/runner.js → createBattleFromSpec)
  const browser = createBattleFromSpec(f.spec, m.ds);
  assert.equal(browser.kind, 'boss');
  assert.equal(browser.bossHitLimit, Infinity, 'the field the browser fights has 限伤 off');
  // …and so does the server's re-computation / takeover of the same field (`specBattleOpts` hands opts.bossHitLimit).
  // Built with the REAL Battle class: this fixture runs a FakeBattle (no price for the sim), which does not carry the
  // option at all — the fallback below is what `createBattleFromSpec` does with no BattleClass.
  const sopts = { ...specBattleOpts(m, { sharedBoss: null }), BattleClass: undefined };
  assert.equal(sopts.bossHitLimit, Infinity, 'specBattleOpts hands the override to the re-computation');
  const server = createBattleFromSpec(f.spec, m.ds, sopts);
  assert.equal(server.bossHitLimit, Infinity);
  m.dispose();
});

test('限伤 off: a hit past the line on a leader LANDS in the browser-run boss battle (圣聆初雪 stops being swallowed)', () => {
  const h = limitMatch(Infinity);
  const b = createBattleFromSpec(h.m.fields[0].spec, h.m.ds);
  for (let i = 0; i < 200 && !(b.enemies || []).some((e) => e.isBoss); i++) b.step();
  const leader = b.enemies.find((e) => e.isBoss);
  const op = b.allyUnits.find((u) => u.kind === 'op');
  assert.ok(leader && op, 'the leader and her operator are both on the field');
  assert.equal(op.defId, 'chess_char_6_02_a', 'the board is 圣聆初雪');
  // the reported board (999 谢拉格 + 奥术) pushes her S3 hits far past 300000; this fixture's pool is small, so the whole
  // bar is the most a hit can remove — the point is that NOTHING is cancelled
  const caps = [];
  const fx0 = b.fx.bind(b);
  b.fx = (k, p) => { if (k === 'hitCap') caps.push(p.n); return fx0(k, p); };
  const bar0 = b.sharedBoss ? b.sharedBoss.hp : leader.hp;
  const hit = BOSS_HIT_LIMIT + 100000;
  const dealt = b.dealDamage(op, leader, { amount: hit, type: 'true' });
  assert.equal(caps.length, 0, 'no hitCap — the hit was not swallowed');
  assert.equal(dealt, Math.min(hit, bar0), 'the whole hit landed (up to what the bar still had)');
  assert.ok(dealt > 0, 'the leader took damage');
  h.m.dispose();
});

test('the official default is unchanged: with no override the client-run boss spec carries no key and the hit is still swallowed', () => {
  const h = limitMatch(undefined);
  const m = h.m;
  const f = m.fields[0];
  assert.equal(m.bossHitLimit, undefined);
  assert.ok(!Object.hasOwn(f.spec, 'bossHitLimit'), 'an unconfigured server sends the spec it always sent');
  const b = createBattleFromSpec(f.spec, m.ds);
  assert.equal(b.bossHitLimit, undefined, 'the battle falls back to BOSS_HIT_LIMIT');
  for (let i = 0; i < 200 && !(b.enemies || []).some((e) => e.isBoss); i++) b.step();
  const leader = b.enemies.find((e) => e.isBoss);
  const op = b.allyUnits.find((u) => u.kind === 'op');
  assert.ok(leader && op);
  const bar0 = leader.hp;
  assert.equal(b.dealDamage(op, leader, { amount: BOSS_HIT_LIMIT, type: 'true' }), 0, 'the official 300000 line still cancels');
  assert.equal(leader.hp, bar0, 'nothing removed');
  // a hit under the line lands (a small fixture pool caps what the bar can give back — the point is the line is not it)
  assert.equal(b.dealDamage(op, leader, { amount: BOSS_HIT_LIMIT - 1, type: 'true' }), Math.min(BOSS_HIT_LIMIT - 1, bar0));
  m.dispose();
});

test('createBattleFromSpec honours an explicit opts.bossHitLimit when the spec has no key (specBattleOpts has always passed one)', () => {
  const spec = buildBattleSpec({ kind: 'boss', seed: 1, players: [], spawns: [], routes: [], timeLimit: null, content: 'none' });
  assert.ok(!Object.hasOwn(spec, 'bossHitLimit'), 'no key from a caller that did not set one');
  assert.equal(createBattleFromSpec(spec, undefined).bossHitLimit, undefined, 'absent both ways ⇒ the BOSS_HIT_LIMIT default');
  assert.equal(createBattleFromSpec(spec, undefined, { bossHitLimit: Infinity }).bossHitLimit, Infinity, 'the option is honoured');
  assert.equal(createBattleFromSpec(spec, undefined, { bossHitLimit: 1234 }).bossHitLimit, 1234);
  // the spec's own key still wins when it has one: the wire is the decision, the option is only the fallback
  const withKey = buildBattleSpec({ kind: 'boss', seed: 1, players: [], spawns: [], routes: [], timeLimit: null, content: 'none', bossHitLimit: 5000 });
  assert.equal(createBattleFromSpec(withKey, undefined, { bossHitLimit: Infinity }).bossHitLimit, 5000);
});

// ---- the dev tools write layers too: they stop at the cap like every gain ---------------------------------------

test('tools/balance.mjs applyBoard: any --profile keeps every bond ≤ 999 (the R14 core bond at ×20 sits at the cap)', () => {
  const m = balanceMatch({ data: withoutTuning(DATA), mode: 'coop', difficulty: 'HARD', seed: 9, players: 1, rehearsal: 0 });
  const r = 14;
  m.round = r;
  m.wave = buildNormalWave(m.gd, m.rngWaves, m.factions, r);
  const rng = createRng(314);
  const plan = planBoard(m, r, rng, { profile: 20 });
  const ps = m.order[0];
  applyBoard(m, ps, plan, r, rng, { profile: 20 });
  assert.ok(plan.core, 'a core bond');
  assert.equal(ps.layers[plan.core], BOND_LAYER_CAP, 'core curve 150 × 20 → 999');
  for (const [id, v] of Object.entries(ps.layers)) assert.ok(v > 0 && v <= BOND_LAYER_CAP, `${id} ${v}`);
  assert.deepEqual(collectViolations(m).filter((v) => /layers/.test(v)), []);
  m.dispose();
});

test('tools/matchrun.mjs --layers 2000 --check: the boost stops at 999 (no invariant violation through the Hidden Core)', () => {
  const tool = fileURLToPath(new URL('../../tools/matchrun.mjs', import.meta.url));
  const r = spawnSync(process.execPath, [tool, '--mode', 'solo', '--difficulty', 'HARD', '--lp', '500', '--layers', '2000', '--check', '--rehearsal', '0', '--seed', '1'], { encoding: 'utf8', timeout: 120000 });
  // A sandbox that blocks the child's stdio pipes leaves `stdout` undefined and `error` set (EPERM on Windows): report
  // that as the failure instead of a `Cannot read properties of undefined (reading 'slice')` that hides the real cause.
  const out = typeof r.stdout === 'string' ? r.stdout : '';
  const err = typeof r.stderr === 'string' ? r.stderr : '';
  assert.equal(r.error, undefined, `could not run matchrun.mjs: ${r.error && r.error.code} (a sandbox that denies spawn/pipe is an environment limit, not a rule failure)`);
  assert.equal(r.status, 0, out.slice(-2000) + err.slice(-2000));
  assert.match(out, /no violations/);
  assert.doesNotMatch(out, /layers \d{4}/);
});
