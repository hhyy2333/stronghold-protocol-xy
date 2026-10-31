// test/sim/attack-turn-2.test.js — 高准度伦蒂尼姆城防自行炮 enemy_1273_stmgun_2: Cannon takes a normal attack's turn (upstream 0.3.2 §37.52)
// Upstream 0.3.2 §37.19 / §37.29 (PRTS 技能 「大多数技能自动触发会占用攻击间隔（即可以攻击时不进行攻击，改为触发技能…）」;
// 「触发索敌和普通攻击相同」; 「同一技能的冷却时间于该技能结束时开始计时」): an attack-class skill is cast **in place of a normal
// attack**, only on an attack turn, and the next swing waits for its clip. Mechanism: content/enemies.js
// attackSlotSkill / attackTurnSkill / castNow; the kit opts in through archetypes.js skill({ atk, clip, own }).
//
// Evidence for the clip: public/assets/local/fx/index.json units.enemy_1273_stmgun_2.skills.Cannon → the official ability class and its
// animKey → data/assets.json enemies.enemy_1273_stmgun_2.spine.animations.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeBattle, chessRec } from '../helpers/battleHarness.js';
import { abilityOf, officialAbility, skillDataOf, stepToCast } from '../helpers/attackTurn.js';
import * as enemiesMod from '../../server/sim/content/enemies.js';

const KEY = 'enemy_1273_stmgun_2', PREFAB = 'Cannon';
const WALL = (id) => chessRec({ id, profession: 'TANK', stats: { atk: 0, maxHp: 1e7, def: 0, res: 0, blockCnt: 3 }, rangeGrid: [[0, 0]], skill: null });
const NOATK = () => ({ trait: { noAttack: true } });
const arena = (o = {}) => makeBattle({
  content: 'generic', extraContent: [enemiesMod], seed: 7, autoFinish: false, timeLimit: 600,
  defs: { chess: { t_wall: WALL('t_wall') } }, kits: { t_wall: NOATK }, captureNoisy: true, ...o,
});
const put = (h) => h.spawn(KEY, { pos: [11,6], routeIndex: 0, mods: { speedMul: 0 } });
const near = (h) => arena({ units: [{ chessId: 't_wall', row: 11, col: 3 }], ...h });
const approx = (a, b, eps = 1e-6, msg = '') => assert.ok(Math.abs(a - b) <= eps * Math.max(1, Math.abs(b)), `${msg} ${a} ≈ ${b}`);

test(`${KEY} ${PREFAB}: an attack-class skill carrying the official clip of its ability`, () => {
  const official = officialAbility(KEY, PREFAB);
  const h = near({});
  h.step();
  const e = put(h);
  const a = abilityOf(e, PREFAB);
  assert.equal(a.atk, true, 'cast in the attack turn, not on its own cooldown');
  assert.equal(a.clip, official.clip, `clip = the official animation length (${official.animKeys.join('+') || 'no animKey'})`);
});

test(`${KEY} ${PREFAB}: with no target in range the cooldown runs out and nothing is cast (no free-running cast)`, () => {
  const h = arena();
  h.step();
  const e = put(h);
  const a = abilityOf(e, PREFAB);
  const s = skillDataOf(KEY, PREFAB);
  h.run(s.initCooldown + 1);
  assert.ok(a.left <= 0, 'cooldown over');
  h.run(5);
  assert.equal(a.casts ?? 0, 0, 'no target, no attack turn, no skill');
});

test(`${KEY} ${PREFAB}: the attack turn after the cooldown casts it instead of the strike, and the next swing waits max(interval, clip)`, () => {
  const h = near({});
  h.step();
  const e = put(h);
  const a = abilityOf(e, PREFAB);
  const cast = stepToCast(h, e, a, 60);
  assert.ok(cast, 'it is cast');
  assert.equal(cast.attacks, cast.attacksBefore, 'that swing did not land as a normal attack: the skill took the turn');
  assert.equal(a.casts, 1);
  approx(cast.atkCd, Math.max(cast.interval, a.clip), 0.05, 'the next swing waits for the clip');
  assert.ok(cast.left > a.cd - 0.1, 'its cooldown restarted (one tick of this tick already spent)');
  assert.ok(cast.left <= a.cd + a.clip + 1e-9, "counted from the clip end");
});
