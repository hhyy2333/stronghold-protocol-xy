// 上游 Forge 0.3.1 §36.19 / GitHub #675 —— 联防只给**漏过来的那一波**记账：战斗中途生出来的敌人（分裂子体、召唤、
// 变身复制、首领幻影）没有被任何玩家漏进联防，所以既不该抬 HUD 的 ×N，也不该扣任何人的 LP。
// 做法（上游最小路径）：联防战场给运行时生成的敌人打 `uniteRuntime`（sim/battle/spawns.js），leak 条目把它带出来
// （sim/battle/deploy.js），结算与 HUD 的读数一律过滤它（match/unite.js uniteSurvivors、sim/spec.js uniteLeft），
// 计费上限只数**漏进来的**（match/fields.js uniteBillBounds 只用 keySourceCounts）；客户端结果校验仍收下它
// （validateClientResult 只花「子体额度」），所以诚实的战报不会被判伪。
//
// 我方原状：uniteBillBounds = keySourceCounts + derivedSourceCounts（×N 被抬高），uniteSurvivors / uniteLeft 没有
// 任何标记 ⇒ 子体被当逃逸者 ×N 并扣 LP。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Battle } from '../../server/sim/Battle.js';
import { uniteBillBounds, validateClientResult } from '../../server/match/fields.js';
import { uniteSurvivors } from '../../server/match/unite.js';
import { uniteLeft } from '../../server/sim/spec.js';
import { createRegistry } from '../../server/match/effectsMeta.js';
import { DATA, makeMatch } from '../match/harness.js';

const QUIET = { warn() {}, error() {}, info() {} };
const REG = createRegistry({ log: QUIET });
/** A real splitter: its data says 3 children per parent (talents.bbStr '….enemy_key' + '….cnt'). */
const PARENT = 'enemy_1197_sfshu';
const CHILD = 'enemy_1198_msfshu';

const solo = (seed = 31) => {
  const h = makeMatch({ mode: 'solo', humans: 1, seed, registry: REG, fake: true }).start();
  h.toPrep(1);
  return h;
};

test('#675 计费上限只数漏进来的：分裂子体不再抬高 uniteBillBounds（旧口径 1 + 3）', () => {
  const h = solo();
  const spawns = [{ enemyKey: PARENT, sourcePlayerId: 'p_0', count: 1, routeIndex: 0, time: 0 }];
  const bounds = uniteBillBounds(spawns, h.m.gd);
  assert.equal(bounds.get('p_0'), 1, 'one enemy crossed p_0\'s goal ⇒ at most one survivor is billable');
  // two leakers keep their own lines
  const two = uniteBillBounds([{ enemyKey: PARENT, sourcePlayerId: 'p_0', count: 2, routeIndex: 0 }, { enemyKey: PARENT, sourcePlayerId: 'p_1', count: 1, routeIndex: 0 }], h.m.gd);
  assert.deepEqual([...two.entries()].sort(), [['p_0', 2], ['p_1', 1]]);
});

test('#675 结算：带 uniteRuntime 的漏怪不扣任何人的 LP（uniteSurvivors / uniteLeft）', () => {
  const plan = { notReentered: new Map(), leakers: ['p_0'], helpers: ['p_1'] };
  const leak = (extra = {}) => ({ enemyKey: CHILD, sourcePlayerId: 'p_0', counted: true, lpr: 1, ...extra });
  const result = (leaked) => ({ perPlayer: { p_0: { leaked } }, unspawned: [] });
  // unchanged: two leaks, both the wave's own ⇒ two survivors
  assert.equal(uniteSurvivors(plan, result([leak(), leak({ enemyKey: PARENT })])).get('p_0'), 2);
  // the split child born mid-field is flagged and billed to nobody
  assert.equal(uniteSurvivors(plan, result([leak({ enemyKey: PARENT }), leak({ uniteRuntime: true })])).get('p_0'), 1);
  assert.equal(uniteSurvivors(plan, result([leak({ uniteRuntime: true })])).get('p_0'), undefined, 'nobody pays');
  // the HUD\'s ×N (uniteLeft) reads the same flag — live enemies first
  const live = {
    finished: false, _pending: [],
    enemies: [
      { alive: true, counted: true, sourcePlayerId: 'p_0' },
      { alive: true, counted: true, sourcePlayerId: 'p_0', uniteRuntime: true },
      { alive: true, counted: true, sourcePlayerId: 'p_0', uniteRuntime: true },
    ],
    _perPlayer: { p_0: { leaked: [] } },
  };
  assert.deepEqual(uniteLeft(live), { p_0: 1 }, 'only the enemy the wave sent in is still "left"');
  // … and a finished battle\'s reported leaks
  const done = { finished: true, result: () => result([leak({ enemyKey: PARENT, counted: true }), leak({ uniteRuntime: true, counted: true })]) };
  assert.deepEqual(uniteLeft(done), { p_0: 1 });
});

test('#675 战场标记：联防场的运行时生成敌人带 uniteRuntime，排定出怪不带；普通场一个都不带', () => {
  const h = solo();
  const ps = h.ps('p_0');
  const opts = h.m._normalOpts(ps);
  const build = (kind) => new Battle({ data: h.m.ds, content: h.m.battleContent, logger: QUIET, ...opts, kind, spawns: [], players: opts.players });
  const unite = build('unite');
  const runtime = unite.spawnEnemy(PARENT, {});
  assert.equal(runtime.uniteRuntime, true, 'a 联防 field tags what appears while it runs');
  const scheduled = unite.spawnEnemy(PARENT, { _scheduled: true });
  assert.equal(scheduled.uniteRuntime, undefined, 'the stage\'s own queue is not tagged');
  const normal = build('normal');
  assert.equal(normal.spawnEnemy(PARENT, {}).uniteRuntime, undefined, 'a normal field never tags');
});

test('#675 客户端结果校验：带标记的漏怪只花「子体额度」，伪造标记会被拒（服务端复算）', () => {
  const h = solo();
  const gd = h.m.gd;
  const spec = {
    kind: 'unite', round: 5, timeLimit: 60, flags: {},
    spawns: [{ enemyKey: PARENT, sourcePlayerId: 'p_0', count: 1, routeIndex: 0, time: 0 }],
    players: [{ playerId: 'p_0', units: [] }],
  };
  const res = (leaked) => ({
    reason: 'timeout', time: 10,
    perPlayer: { p_0: { killed: 0, total: 0, leaked, perfect: leaked.length === 0, layerGains: {}, coins: 0, unitsEnd: [], unitStats: [] } },
  });
  const child = { enemyKey: CHILD, sourcePlayerId: 'p_0', counted: true, lpr: 1 };
  // an honest runtime leak: accepted, and the flag reaches the stored result (so settlement skips it)
  const flagged = validateClientResult(spec, res([{ ...child, uniteRuntime: true }]), { gd });
  assert.equal(flagged.ok, true, flagged.reason);
  assert.equal(flagged.result.perPlayer.p_0.leaked[0].uniteRuntime, true);
  // the same leak WITHOUT the flag is still accepted (offspring budget) but stays billable
  const plain = validateClientResult(spec, res([child]), { gd });
  assert.equal(plain.ok, true, plain.reason);
  assert.equal(plain.result.perPlayer.p_0.leaked[0].uniteRuntime, undefined);
  // the flag on a key that no enemy of the wave can have left behind: refused, so the server re-simulates
  const forged = validateClientResult(spec, res([{ enemyKey: PARENT, sourcePlayerId: 'p_0', counted: true, lpr: 1, uniteRuntime: true }]), { gd });
  assert.deepEqual(forged, { ok: false, reason: 'unite runtime' });
});
