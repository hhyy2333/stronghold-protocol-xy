// 上游 Forge 0.3.2 §37.27 / GitHub #845 —— 隐秘核心（R15）重新抽分组：不复用最终攻势（R14）的搭档，抽签用独立 salt
// `boss-pairs:<round>`；该回合的**首次**规划才重抽，同回合内有人退出时只为落单者重新配对（以及业主 2026-10-16
// 「按座位序配对」的决定 —— 见 server/match/finalAssault.js:63-84 与 docs/design/match.md）。
//
// 我方原状：phases.js _planBossWaves 用 'boss-pairs' + this.bossPairs 作 previous ⇒ R15 直接沿用 R14 的组。
// 【有意偏差】上游「重新抽左右」(组内随机洗牌) **不搬**：业主 2026-10-16 决定配对按座位序、座位小者在左半场 L，
// 因为客户端 m.public.bossPairs 缺席时的兜底 prepPair 就是座位序相邻两两，随机配对会让「boss 波摆人会卡回道中」。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { bossPairSalt } from '../../server/match/match/phases.js';
import { createRegistry } from '../../server/match/effectsMeta.js';
import { DATA, makeMatch } from '../match/harness.js';

const QUIET = { warn() {}, error() {}, info() {} };
const REG = createRegistry({ log: QUIET });

function fourSeatMatch(seed = 9090) {
  const h = makeMatch({ mode: 'coop', humans: 2, bots: 2, seed, registry: REG, fake: true }).start();
  const m = h.m;
  // seat order (the pairing rule's own order: the smaller seat of a pair is the left half)
  const ids = m.order.map((ps) => ps.playerId);
  assert.equal(ids.length, 4, 'four seats');
  assert.ok(m.gd.bossRound > 0 && m.gd.hiddenRound > m.gd.bossRound, 'this mode has a Final Assault and a Hidden Core');
  return { h, m, ids };
}

test('#845 配对盐：最终攻势仍用 boss-pairs（R14 不变），隐秘核心用 boss-pairs:<round>', () => {
  const { m } = fourSeatMatch();
  const gd = m.gd;
  assert.equal(bossPairSalt(gd, gd.bossRound), 'boss-pairs', 'the Final Assault keeps its draw (R14 is unchanged)');
  assert.equal(bossPairSalt(gd, gd.hiddenRound), 'boss-pairs:' + gd.hiddenRound, 'the Hidden Core draws from a stream of its own');
  assert.notEqual(bossPairSalt(gd, gd.bossRound), bossPairSalt(gd, gd.hiddenRound));
  // a normal round is not a boss round: the default salt is what any later boss round would use
  assert.equal(bossPairSalt(gd, 1), 'boss-pairs');
});

test('#845 隐秘核心的首次规划不沿用最终攻势的搭档（R14 保 previous，R15 重抽）', () => {
  const { m, ids } = fourSeatMatch();
  const [p0, p1, p2, p3] = ids;
  // R14: a pairing saved through the Final Assault's prep/combat is KEPT (a departure re-pairs only the orphan) —
  // here a non-seat pairing, so "kept" and "drawn anew" are visibly different
  m.round = m.gd.bossRound;
  m.bossPairsRound = m.gd.bossRound;
  m.bossPairs = [[p2, p3], [p0, p1]];
  m._planBossWaves();
  assert.deepEqual(m.bossPairs, [[p2, p3], [p0, p1]], 'R14 keeps the saved pairing (and its field order)');

  // R15: its FIRST plan draws anew — the Final Assault's partners are not reused
  m.round = m.gd.hiddenRound;
  m._planBossWaves();
  assert.deepEqual(m.bossPairs, [[p0, p1], [p2, p3]], 'R15 pairs by seat anew, ignoring R14\'s [p2,p3] / [p0,p1]');
  assert.equal(m.bossPairsRound, m.gd.hiddenRound, 'the round remembers that it planned');
  assert.deepEqual(m.bossWaves.map((w) => w.players), m.bossPairs, 'the field preview follows the new pairing');
});

test('#845 同一个隐秘核心回合内的再规划：只重配落单者，成型的组不动', () => {
  const { m, ids } = fourSeatMatch();
  const [p0, p1, p2, p3] = ids;
  m.round = m.gd.hiddenRound;
  m.bossPairsRound = m.gd.hiddenRound;   // this round's plan already drew
  m.bossPairs = [[p2, p3], [p0, p1]];    // … and a departure reshuffled it
  m._planBossWaves();
  assert.deepEqual(m.bossPairs, [[p2, p3], [p0, p1]], 'a re-plan inside the round keeps the intact pairs (bossPairsRound === round ⇒ previous is used)');
  // the guard is what makes the difference: on the round's FIRST plan the same saved pairs would be ignored
  m.bossPairsRound = null;
  m.bossPairs = [[p2, p3], [p0, p1]];
  m._planBossWaves();
  assert.deepEqual(m.bossPairs, [[p0, p1], [p2, p3]], 'a new round draws anew');
});

test('#845 配对仍是座位序（业主 2026-10-16 的决定）：不洗牌、座位小者在左半场 L', () => {
  const { m, ids } = fourSeatMatch();
  const [p0, p1, p2, p3] = ids;
  for (const round of [m.gd.bossRound, m.gd.hiddenRound]) {
    m.round = round;
    m.bossPairsRound = null;
    m.bossPairs = null;
    m._planBossWaves();
    assert.deepEqual(m.bossPairs, [[p0, p1], [p2, p3]], `R${round}: seat order, no shuffle`);
  }
  // … and the field's L/R sides follow the seat (infra bossGroupOf: the group's first id is 'L')
  assert.equal(m.bossWaves[0].players[0], p0, 'the smaller seat of the first field is on the left');
});
