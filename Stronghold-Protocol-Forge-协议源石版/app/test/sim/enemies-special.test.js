// test/sim/enemies-special.test.js — the three enemy-behaviour fixes ported from upstream 0.3.2 (see
// 04-文档/上游0.3.3对比/C-0.3.2.md §1.1 #8/#9 and 移植/fix-sim-enemies.md):
//   · 血珀 (enemy_1367_dseed, upstream §37.107 / PR #720): with no 唤血祭坛 / 沥血王座 on the field it loses
//     Passive.hp_ratio (10 %) of its max HP every second — a true 流失 (Battle.loseHp: no DEF/RES, no dodge, no shield,
//     无来源) that can kill it. It stays 自缚 / 失衡免疫 / 不攻击 / 无法被阻挡, and the 骸骨拷打者's two stay where they fell
//     and are not counted.
//   · 心虚设计师 (enemy_10097_crshd, §37.108 / #869): blocked, its front is the blocker's side and the −80 % front cut
//     turns with it; unblocked, it faces its walk. A blocker on the same column keeps the last facing [ASSUMED].
//   · 假想敌：淤困 (enemy_9007_acelem, §37.95 / PR #803): the attachment blinks onto the blocker's tile centre and is
//     self-bound until the block ends; a 'teleport' fx (fromX/fromY) is published for the client.
// The three sit in content/enemies/special.js (the first two) and content/enemies/element.js (淤困); this file drives them
// through the real data records with inert synthetic walls (Sim testing, docs/SIM.md).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { makeBattle, chessRec, checkInvariants } from '../helpers/battleHarness.js';
import * as enemiesMod from '../../server/sim/content/enemies.js';

const E = JSON.parse(fs.readFileSync(new URL('../../data/enemies.json', import.meta.url), 'utf8'));
const tb = (key, k) => E[key].talents.bb[k];
const approx = (a, b, eps = 1e-6, msg = '') => assert.ok(Math.abs(a - b) <= eps * Math.max(1, Math.abs(b)), `${msg} ${a} ≈ ${b}`);
const WALL = (id) => chessRec({ id, profession: 'TANK', stats: { atk: 0, maxHp: 1e7, def: 0, res: 0, blockCnt: 3 }, rangeGrid: [[0, 0]], skill: null });
const NOATK = () => ({ trait: { noAttack: true } });
const CHESS = { t_wall: WALL('t_wall'), t_wall2: WALL('t_wall2'), t_wall3: WALL('t_wall3') };
const KITS = { t_wall: NOATK, t_wall2: NOATK, t_wall3: NOATK };
/** Real enemies with their content (enemies.js spreads every kit family, 淤困's element.js included) vs inert walls. */
const arena = (o = {}) => makeBattle({
  content: 'generic', extraContent: [enemiesMod], seed: 7, autoFinish: false, timeLimit: 600,
  defs: { chess: CHESS }, kits: KITS, captureNoisy: true, ...o,
});
/** Spawn a pinned enemy (speed ×0) at a tile. */
const put = (h, key, pos, mods = {}) => h.spawn(key, { pos, routeIndex: 0, mods: { speedMul: 0, ...mods } });

// ---------------------------------------------------------------------------------------------------------------
// 血珀 (enemy_1367_dseed)

test(`${E.enemy_1367_dseed.name} (enemy_1367_dseed): 自缚 / 失衡免疫 / 不攻击 / 无法被阻挡, and it 流失 ${tb('enemy_1367_dseed', 'Passive.hp_ratio') * 100} % max HP every second`, () => {
  const h = arena({ units: [{ chessId: 't_wall', row: 9, col: 5 }] });
  h.step();
  const e = put(h, 'enemy_1367_dseed', [9, 5]);            // on the wall's own tile: 无法被阻挡 must leave it free
  const maxHp = e.s.maxHp;
  approx(maxHp, E.enemy_1367_dseed.stats.maxHp, 1e-9, 'data maxHp');
  assert.equal(e.profile.noAttack, true, '不攻击');
  const f = e.s.flags;
  assert.ok(f.selfBound, '自缚');
  assert.ok(f.noMove, 'does not move');
  assert.ok(f.unblockable, '无法被阻挡');
  assert.ok(f.noDisplace, '失衡免疫');
  assert.equal(e.blockedBy, null, 'the wall on its tile holds nothing');
  const x0 = e.x, y0 = e.y, n0 = e.stats.attacks;
  h.run(1.05);                                             // the first loss lands at t = 1 s
  assert.ok(e.alive);
  approx(maxHp - e.hp, maxHp * tb('enemy_1367_dseed', 'Passive.hp_ratio'), 1e-6, 'one second');
  h.run(1.0);
  approx(maxHp - e.hp, 2 * maxHp * tb('enemy_1367_dseed', 'Passive.hp_ratio'), 1e-6, 'two seconds');
  // a true 流失: nothing mitigates it (DEF 3000 / RES 90 are irrelevant to it)
  assert.ok(maxHp - e.hp > 0);
  approx(e.x, x0, 1e-9, 'stays where it fell');
  approx(e.y, y0, 1e-9, 'stays where it fell');
  assert.equal(e.stats.attacks, n0, 'not one attack');
  checkInvariants(h.b);
});

test(`${E.enemy_1367_dseed.name}: bleeds out in 10 s; the knock-out is not counted (no altar, no bounty)`, () => {
  const h = arena();
  h.step();
  const total0 = h.b.total, killed0 = h.b.killed;
  const e = h.spawn('enemy_1367_dseed', { pos: [9, 5], routeIndex: 0, countInTotal: false });   // 骸骨拷打者's spawn path
  const maxHp = e.s.maxHp;
  h.run(9.05);                                             // 9 losses ⇒ 10 % left
  assert.ok(e.alive, 'alive after 9 s');
  approx(e.hp, maxHp * (1 - 9 * tb('enemy_1367_dseed', 'Passive.hp_ratio')), 1e-6);
  h.run(1.1);                                              // the 10th second kills it
  assert.equal(e.alive, false, 'bleeds to death');
  assert.equal(e.hp, 0);
  assert.equal(h.b.total, total0, 'not counted in the capsule');
  assert.equal(h.b.killed, killed0, 'no knock-out credited');
  checkInvariants(h.b);
});

// ---------------------------------------------------------------------------------------------------------------
// 心虚设计师 (enemy_10097_crshd)

/** Front / back share of one arts instance from an ally standing left / right of the enemy. */
function frontBack(h, e, left, right, amount = 1000) {
  const hp = e.s.maxHp;
  e.hp = hp;
  h.b.dealDamage(left, e, { amount, type: 'arts' });
  const front = hp - e.hp;
  e.hp = hp;
  h.b.dealDamage(right, e, { amount, type: 'arts' });
  const back = hp - e.hp;
  e.hp = hp;
  return { front, back };
}

test(`${E.enemy_10097_crshd.name} (enemy_10097_crshd): blocked ⇒ the front is the blocker's side, and the ${tb('enemy_10097_crshd', 'weakness.damage_resistance') * 100} % front cut turns with it`, () => {
  const cut = tb('enemy_10097_crshd', 'weakness.damage_resistance');
  assert.ok(cut > 0, 'data: 减少来自正面的物理/法术伤害');
  // the blocker stands to its LEFT (t_wall at col 5, the enemy in contact at col 5.6)
  const hl = arena({ units: [{ chessId: 't_wall', row: 9, col: 5 }, { chessId: 't_wall2', row: 11, col: 5 }, { chessId: 't_wall3', row: 11, col: 9 }] });
  hl.step();
  const el = put(hl, 'enemy_10097_crshd', [9, 5.6]);
  hl.step(2);
  assert.equal(el.blockedBy, hl.unit('t_wall'), 'blocked');
  assert.equal(el.facing, -1, 'the front is the blocker side (left)');
  const a = frontBack(hl, el, hl.unit('t_wall2'), hl.unit('t_wall3'));
  approx(a.front, a.back * (1 - cut), 1e-6, 'front −80 %, back untouched');
  checkInvariants(hl.b);
  // the blocker stands to its RIGHT (t_wall at col 9, the enemy in contact at col 8.4): the front turns over
  const hr = arena({ units: [{ chessId: 't_wall', row: 9, col: 9 }, { chessId: 't_wall2', row: 11, col: 5 }, { chessId: 't_wall3', row: 11, col: 11 }] });
  hr.step();
  const er = put(hr, 'enemy_10097_crshd', [9, 8.4]);
  hr.step(2);
  assert.equal(er.blockedBy, hr.unit('t_wall'), 'blocked');
  assert.equal(er.facing, 1, 'the front turned to the blocker (right) — it used to keep the walk sign');
  const b2 = frontBack(hr, er, hr.unit('t_wall3'), hr.unit('t_wall2'));   // front = the blocker's side (right)
  approx(b2.front, b2.back * (1 - cut), 1e-6, 'front −80 % on the blocker side');
  checkInvariants(hr.b);
});

test(`${E.enemy_10097_crshd.name}: unblocked it faces its walk; a blocker on the same column keeps the last facing [ASSUMED]`, () => {
  const h = arena({ enemies: [
    { key: 'enemy_10097_crshd', pos: [9, 9], route: { motion: 'WALK', start: [9, 9], end: [9, 2], checkpoints: [] } },
    { key: 'enemy_10097_crshd', pos: [12, 2], route: { motion: 'WALK', start: [12, 2], end: [12, 9], checkpoints: [] } },
  ] });
  h.step();
  const [left, right] = h.enemies();
  h.run(1);
  assert.equal(left.blockedBy, null);
  assert.equal(right.blockedBy, null);
  assert.equal(left.facing, -1, 'walking left');
  assert.equal(right.facing, 1, 'walking right');
  // same column ([ASSUMED]: PRTS names the front, not a same-column tie): a pinned designer over its blocker keeps −1
  const s = arena({ units: [{ chessId: 't_wall', row: 10, col: 6 }] });
  s.step();
  const pinned = put(s, 'enemy_10097_crshd', [9.4, 6]);      // directly above the wall: dx = 0
  s.step(2);
  assert.equal(pinned.blockedBy, s.unit('t_wall'), 'blocked from below, same column');
  assert.equal(pinned.facing, -1, 'keeps the previous sign (no side to turn to)');
  checkInvariants(s.b);
});

// ---------------------------------------------------------------------------------------------------------------
// 假想敌：淤困 (enemy_9007_acelem)

test(`${E.enemy_9007_acelem.name} (enemy_9007_acelem): the attachment blinks onto the blocker's tile centre and self-binds until the block ends`, () => {
  const h = arena({ units: [{ chessId: 't_wall', row: 9, col: 5 }] });
  h.step();
  const w = h.unit('t_wall');
  const e = h.spawn('enemy_9007_acelem', { pos: [9, 8], routeIndex: 0 });   // walks left into the wall
  assert.ok(h.runUntil(() => !!e.findBuff('ab:parasiteAttached'), 30), 'attaches once it is blocked');
  assert.equal(e.blockedBy, w, 'the blocker is what it attaches to');
  assert.ok(w.findBuff('ab:parasite'), '…and the host carries the parasite debuff');
  approx(e.x, w.tileC, 1e-9, 'x = the blocker tile centre');
  approx(e.y, w.tileR, 1e-9, 'y = the blocker tile centre');
  assert.ok(e.s.flags.noMove && e.s.flags.selfBound, '自缚 while attached');
  const tel = h.eventsOf('fx').filter((f) => f[1] === 'teleport' && f[4] && f[4].kind === 'parasite');
  assert.equal(tel.length, 1, 'one teleport fx for the client');
  assert.ok(tel[0][4].fromX > e.x, 'from the position it walked in at (right of the blocker)');
  const x = e.x, y = e.y;
  h.run(2);
  approx(e.x, x, 1e-9, 'pinned while the block holds');
  approx(e.y, y, 1e-9, 'pinned while the block holds');
  // the block ends (the host falls): the self-bind goes and the move resumes from the new tile
  h.b.dealDamage(null, w, { amount: 1e9, type: 'true' });
  h.run(2);
  assert.equal(w.alive, false, 'host down');
  assert.ok(!e.findBuff('ab:parasiteAttached'), 'the self-bind ends with the block');
  assert.ok(Math.abs(e.x - x) > 0.05, 'it moves again from where it blinked to');
  checkInvariants(h.b);
});
