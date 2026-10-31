// test/sim/attack-turn-wlfmster.test.js — 扎罗 enemy_1535_wlfmster: 【溶血骇惧】 takes a normal attack's turn (its cooldown here is the SP cost)
// Upstream 0.3.2 §37.19 / §37.29 (PRTS 技能 「大多数技能自动触发会占用攻击间隔（即可以攻击时不进行攻击，改为触发技能…）」;
// 「触发索敌和普通攻击相同」; 「同一技能的冷却时间于该技能结束时开始计时」): an attack-class skill is cast **in place of a normal
// attack**, only on an attack turn, and the next swing waits for its clip (0 = the ability names no clip). Mechanism:
// content/enemies.js attackSlotSkill / attackTurnSkill / castNow; the kit opts in through archetypes.js skill({ atk, clip, own }).
//
// Evidence for the clip: public/assets/local/fx/index.json units.enemy_1535_wlfmster.skills.FearCage → the official ability class and its
// animKey → data/assets.json enemies.enemy_1535_wlfmster.spine.animations.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeBattle, chessRec } from '../helpers/battleHarness.js';
import { abilityOf, officialAbility, stepToCast, assertTookTheTurn } from '../helpers/attackTurn.js';
import * as enemiesMod from '../../server/sim/content/enemies.js';

const KEY = 'enemy_1535_wlfmster', PREFAB = 'FearCage';
const WALL = (id) => chessRec({ id, profession: 'TANK', stats: { atk: 0, maxHp: 1e7, def: 0, res: 0, blockCnt: 3 }, rangeGrid: [[0, 0]], skill: null });
const NOATK = () => ({ trait: { noAttack: true } });
const CHESS = { t_wall: WALL('t_wall') };
const arena = (o = {}) => makeBattle({
  content: 'generic', extraContent: [enemiesMod], seed: 7, autoFinish: false, timeLimit: 600,
  defs: { chess: CHESS }, kits: { t_wall: NOATK }, captureNoisy: true, ...o,
});
const put = (h, mods = {}) => h.spawn(KEY, { pos: [10,6], routeIndex: 0, mods: { speedMul: 0, ...mods } });

test(`${KEY} ${PREFAB}: an attack-class skill carrying the official clip of its ability`, () => {
  const official = officialAbility(KEY, PREFAB);
  const h = arena({ units: [{ chessId: 't_wall', row: 10, col: 6 }] });
  h.step();
  const e = put(h);
  const a = abilityOf(e, PREFAB);
  assert.equal(a.atk, true, 'cast in the attack turn, not on its own cooldown');
  assert.equal(a.clip, official.clip, `clip = the official animation length (${official.classes.join('+')}, animKey ${official.animKeys.filter(Boolean).join('+') || 'none'})`);
});

test(`${KEY} ${PREFAB}: the cooldown running out is not enough — with nobody on the field there is nothing to cage`, () => {
  const h = arena();
  h.step();
  const e = put(h);
  
  const a = abilityOf(e, PREFAB);
  assert.ok(h.runUntil(() => a.left <= 0, 120), 'its cooldown runs out');
  h.run(3);
  assert.equal(a.casts ?? 0, 0, 'no attack turn, no skill');
});

test(`${KEY} ${PREFAB}: the attack turn after the cooldown casts it instead of the strike, and the next swing waits max(interval, clip)`, () => {
  const h = arena({ units: [{ chessId: 't_wall', row: 10, col: 6 }] });
  h.step();
  const e = put(h);
  
  const a = abilityOf(e, PREFAB);
  assertTookTheTurn(stepToCast(h, e, a, 120), a);
});
