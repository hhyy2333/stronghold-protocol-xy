// test/sim/attack-slot.test.js — attack-class skills take the normal attack's turn (upstream 0.3.2 port:
// DESIGN §37.19 / §37.29 / §37.54 / §37.55). A skill marked `atk: true` is cast in place of a swing (no swing, no skill;
// its cooldown counts from its clip's end) and a skill with a trigger selector of its own (`own`) also takes a ready
// attack's turn with nothing to attack (the official `_allowNoTarget`).
//
// Run: node test/sim/attack-slot.test.js (node --test cannot bind a socket in this sandbox).
import test from 'node:test';
import assert from 'node:assert/strict';
import { makeBattle } from '../helpers/battleHarness.js';
import { abOf, attach } from '../../server/sim/content/enemies.js';

const TICK = 0.05;
const OP = 'chess_char_1_01_a';
const immortal = (b) => b.on('deploy', ({ unit }) => { if (unit.side === 'ally') b.addBuff(unit, { key: 'test:immortal', persist: true, flags: { invulnerable: true } }); });

/** Record 大潮 / 断裂生殖 fx times and the enemy's normal-attack times. */
function watch(b, enemyKey) {
  const rec = { fx: [], attacks: [] };
  const orig = b.fx.bind(b);
  b.fx = (kind, params) => { if (kind === 'tide' || kind === 'tentacle') rec.fx.push({ kind, t: b.time }); return orig(kind, params); };
  b.on('attack', ({ attacker }) => { if (attacker && attacker.defId === enemyKey) rec.attacks.push(b.time); });
  return rec;
}
const times = (rec, kind) => rec.fx.filter((f) => f.kind === kind).map((f) => f.t);
/** The ability carrying the `ab.sk` record of `prefabKey` (identity: the kit passes the record as `sk`). */
function abilOf(b, e, prefabKey) {
  const ab = abOf(b, e);
  const sk = ab.sk[prefabKey];
  return ab.list.find((a) => a && a.sk === sk) || null;
}
/** 昆图斯's third form: HP below 34 % clears both growth thresholds (growup1/2.hp_ratio 0.33). */
function quintus(b, h) {
  h.step(2);
  const e = h.enemy('enemy_1521_dslily');
  assert.ok(e, '昆图斯 spawned');
  e.hp = e.s.maxHp * 0.3;
  h.step(10);                       // two growth ticks (iv 0.25)
  assert.equal(e.mem.ab.list.filter((a) => a && a.stage === 2).length, 4, 'the third form carries four skills');
  return e;
}

test('an attack-class skill waits for the attack’s turn — no target, no cast', () => {
  const plain = [], own = [];
  const b0 = makeBattle({
    units: [{ chessId: OP, row: 12, col: 2 }],
    enemies: [{ key: 'enemy_1000_gopro_2', time: 0, route: 0, pos: [3, 2] }],
    timeLimit: 40,
    extraContent: [{
      install(b) {
        b.on('enemySpawn', ({ enemy }) => {
          enemy.profile = Object.assign({}, enemy.profile, { canTarget: () => false });   // no target: never a swing
          attach(b, enemy, [
            { cd: 1, icd: 0, atk: true, own: false, fire() { plain.push(b.time); } },
            { cd: 1, icd: 0, atk: true, own: true, cond: () => true, fire() { own.push(b.time); } },
          ]);
        });
      },
    }],
  });
  b0.run(10);
  assert.equal(plain.length, 0, 'a skill with the attack’s trigger never fires without a swing');
  assert.ok(own.length >= 1, `a skill with a selector of its own takes a ready attack’s turn (${own.length})`);
});

test('with a target the skill takes the swing’s turn: never both in one turn', () => {
  const casts = [], attacks = [];
  const h = makeBattle({
    units: [{ chessId: OP, row: 10, col: 5 }],
    enemies: [{ key: 'enemy_1000_gopro_2', time: 0, route: 0, pos: [10, 6] }],
    timeLimit: 40,
    extraContent: [{
      install(b) {
        b.on('enemySpawn', ({ enemy }) => {
          b.addBuff(enemy, { key: 'test:tank', persist: true, flags: { invulnerable: true } });   // survives the fight
          attach(b, enemy, [{ cd: 3, icd: 0, atk: true, own: false, fire() { casts.push(b.time); } }]);
          b.on('attack', ({ attacker }) => { if (attacker === enemy) attacks.push(b.time); });
        });
      },
    }],
  });
  h.run(20);
  assert.ok(attacks.length >= 5, `the enemy still attacks (${attacks.length})`);
  assert.ok(casts.length >= 3, `the skill takes turns too (${casts.length})`);
  for (const c of casts) assert.ok(!attacks.some((t) => Math.abs(t - c) < TICK / 2), `the turn at ${c} is the skill’s, not the attack’s`);
  const gaps = casts.slice(1).map((t, i) => t - casts[i]);
  assert.ok(gaps.every((g) => g >= 3 - TICK), `its cooldown restarts from the cast: ${gaps.map((g) => g.toFixed(2)).join(', ')}`);
});

test('昆图斯 third form: 大潮 alternates with the normal attack (about every 7 game s)', () => {
  let rec = null;
  const h = makeBattle({
    units: [{ chessId: OP, row: 10, col: 6 }],
    enemies: [{ key: 'enemy_1521_dslily', time: 0, pos: [10, 9] }],
    timeLimit: 200,
    setup(b) { rec = watch(b, 'enemy_1521_dslily'); immortal(b); },
  });
  quintus(h.b, h);
  rec.fx.length = 0; rec.attacks.length = 0;
  h.run(120);
  const tides = times(rec, 'tide');
  assert.ok(tides.length >= 8, `tides happen (${tides.length})`);
  for (const t of tides) assert.ok(!rec.attacks.some((a) => Math.abs(a - t) < TICK / 2), `the tide at ${t.toFixed(2)} has a turn of its own`);
  const gaps = tides.slice(1).map((t, i) => t - tides[i]);
  assert.ok(gaps.every((g) => g >= 6), `3.5 s cooldown + 1.667 s clip ⇒ a tide no more often than every ~7 s: ${gaps.map((g) => g.toFixed(2)).join(', ')}`);
  assert.ok(rec.attacks.length >= 5, `and the normal attack still happens between two tides (${rec.attacks.length})`);
});

test('no target: 大潮 does not fire, 断裂生殖 still does (_allowNoTarget)', () => {
  let rec = null;
  const h = makeBattle({
    units: [{ chessId: OP, row: 10, col: 6 }],
    enemies: [{ key: 'enemy_1521_dslily', time: 0, pos: [10, 9] }],
    timeLimit: 200,
    setup(b) {
      rec = watch(b, 'enemy_1521_dslily');
      immortal(b);
      b.on('enemySpawn', ({ enemy }) => { if (enemy.defId === 'enemy_1521_dslily') enemy.profile = Object.assign({}, enemy.profile, { canTarget: () => false }); });
    },
  });
  const e = quintus(h.b, h);
  rec.fx.length = 0; rec.attacks.length = 0;
  h.run(60);
  assert.equal(rec.attacks.length, 0, 'no swing at all');
  assert.equal(times(rec, 'tide').length, 0, 'no targets, no 大潮');
  assert.ok(times(rec, 'tentacle').length > 0, '断裂生殖 has a selector of its own and still takes turns');
});

test('“自在” casts 破桎而出 only when it has something to attack', () => {
  const mk = (canTarget) => {
    const h = makeBattle({
      units: [{ chessId: OP, row: 10, col: 6 }],
      enemies: [{ key: 'enemy_1517_xi', time: 0, route: 0, pos: [10, 9] }],
      timeLimit: 60,
      setup(b) { immortal(b); if (!canTarget) b.on('enemySpawn', ({ enemy }) => { if (enemy.defId === 'enemy_1517_xi') enemy.profile = Object.assign({}, enemy.profile, { canTarget: () => false }); }); },
    });
    h.step(2);
    const xi = h.enemy('enemy_1517_xi');
    for (const a of xi.mem.ab.list) if (a && a.cd != null) a.left = 0;   // every skill ready now
    h.run(20);
    return { xi, burst: abilOf(h.b, xi, 'ShieldBurst') };
  };
  const blind = mk(false);
  assert.equal(blind.burst.atk, true, 'the barrier is an attack-class skill (ATTACK_TURN_CLIP)');
  assert.equal(blind.burst.casts ?? 0, 0, 'nothing in reach ⇒ no barrier');
  const seen = mk(true);
  assert.ok((seen.burst.casts ?? 0) >= 1, 'a target in reach ⇒ the barrier comes as the attack’s turn');
});

test('断裂生殖: one tentacle per squad phase, seven phases, then never again', () => {
  let rec = null;
  const branch = { dslily_dstnta: [[], [], [], [], [], [], []] };   // the level's seven squad phases
  const h = makeBattle({
    units: [{ chessId: OP, row: 10, col: 6 }],
    enemies: [{ key: 'enemy_1521_dslily', time: 0, pos: [10, 9] }],
    timeLimit: 400,
    setup(b) {
      rec = watch(b, 'enemy_1521_dslily');
      immortal(b);
      b.on('enemySpawn', ({ enemy }) => { if (enemy.defId === 'enemy_1521_dslily') enemy.profile = Object.assign({}, enemy.profile, { canTarget: () => false }); });
      b.opts = Object.assign({}, b.opts, { waveTemplate: { branches: branch, devices: [] } });
    },
  });
  const e = quintus(h.b, h);
  const tent = abilOf(h.b, e, 'SummonTentacG2');
  assert.ok(tent, 'the third form carries 断裂生殖');
  for (let i = 0; i < 1500; i++) { tent.left = 0; h.step(1); }   // keep it ready: the level branch is what stops it
  assert.equal(tent.casts, 7, 'seven squad actions, seven casts');
  assert.equal(times(rec, 'tentacle').length, 7);
  tent.left = 0;
  h.run(60);
  assert.equal(times(rec, 'tentacle').length, 7, 'no tentacle once the squad actions are used up');
});
test('假想敌：胄 — 【灭顶之灾】takes the attack’s turn (clip 2.333 s)', () => {
  const casts = [], attacks = [];
  const h = makeBattle({
    kind: 'boss',
    units: [{ chessId: OP, row: 10, col: 6 }],
    enemies: [{ key: 'enemy_9013_acstmk', time: 0, pos: [3, 10], tag: 'boss' }],
    timeLimit: 120,
    setup(b) {
      b.on('deploy', ({ unit }) => { if (unit.side === 'ally') b.addBuff(unit, { key: 'test:immortal', persist: true, flags: { invulnerable: true } }); });
      const orig = b._ev.bind(b);
      b._ev = (e) => { if (e && e[0] === 'cast') casts.push(e); return orig(e); };
      b.on('attack', ({ attacker }) => { if (attacker && attacker.defId === 'enemy_9013_acstmk') attacks.push(b.time); });
    },
  });
  h.run(60);
  const shells = casts.filter((c) => c.length === 5 && c[4] === 2.333);
  assert.ok(shells.length >= 1, `灭顶之灾 is an attack-slot cast with its clip (${casts.length} casts)`);
  assert.ok(attacks.length >= 1, `the normal attack still happens between shells (${attacks.length})`);
  // only the attack-class casts carry the fifth field: 死亡集群 (not attack-class) keeps the old three/four-field shape
  for (const c of casts) if (c.length === 5) assert.equal(c[4], 2.333, 'no other 胄 skill is attack-class');
  assert.ok(casts.some((c) => c.length <= 4), '死亡集群 still casts with the old shape');
});

test('阿利斯泰尔 — 【王权号令】/【斥退】 take the attack’s turn (clips 3.667 / 5.667 s)', () => {
  const casts = [];
  const h = makeBattle({
    kind: 'boss',
    units: [{ chessId: OP, row: 10, col: 9 }],
    enemies: [{ key: 'enemy_9032_aclionk', time: 0, pos: [3, 11], tag: 'boss' }],
    timeLimit: 200,
    setup(b) {
      b.on('deploy', ({ unit }) => { if (unit.side === 'ally') b.addBuff(unit, { key: 'test:immortal', persist: true, flags: { invulnerable: true } }); });
      const orig = b._ev.bind(b);
      b._ev = (e) => { if (e && e[0] === 'cast') casts.push(e); return orig(e); };
    },
  });
  h.run(80);
  const clips = new Set(casts.filter((c) => c.length === 5).map((c) => c[4]));
  assert.ok(clips.has(3.667), `王权号令's clip (${[...clips].join(', ')})`);
  for (const c of casts) if (c.length === 5) assert.ok(c[4] === 3.667 || c[4] === 5.667, `only 王权号令 / 斥退 carry the field (${c[4]})`);
});