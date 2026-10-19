// test/match/public-delta.test.js — the CLIENT half of the incremental m.public frame
// (public/js/matchDelta.js; the server half is server/viewsDelta.js).
//
// 业主 2026-10-19：「之前修的 boss 地图问题没有解决妥善。现在会在视角会跳来跳去」。
//
// 根因在 **FULL 帧的物化**：`clonePublic` 对顶层数组只做了一层 `{ ...x }`，于是嵌套数组
// （`bossPairs: [[p_0,p_1],[p_2,p_3]]`）被摊成了普通对象 `{ 0:'p_0', 1:'p_1' }`。
// 客户端于是认为「配对里没有我」（`Array.isArray(g)` 为假），boss 休整期的取景退回道中；
// 更糟的是两条取景路径对同一份状态给出不同答案（见下），两个 effect 每帧互相纠正 —— 镜头来回跳。
//
// 这一份钉住三件事：
//   1. FULL 帧物化后，嵌套数组仍是数组（其余 JSON 形状也按值拷贝，不与线上帧共享引用）；
//   2. 物化后的 boss 配对对**每一个**读配对的消费者都还认得出（取景 / 部署场 / 队伍绿框）；
//   3. 同一个半场的两条取景路径（带「上次半场」兜底的 prepCamera 与 foldCamera）不会互相打架。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { applyPublic, clonePublic } from '../../public/js/matchDelta.js';
import { prepCamera, foldCamera, deployFieldOf, teamFrameIds } from '../../public/js/ui/gameLogic.js';
import { PHASE } from '../../shared/constants.js';
import { makeMatch } from './harness.js';

/** A FULL m.public frame of the Final Assault prep, six humans paired by seat (the wire shape). */
const fullBossPrep = (round = 14) => ({
  t: 'm.public',
  phase: PHASE.PREP,
  round,
  bossRound: round,
  hiddenRound: round + 1,
  bossPairs: [['p_0', 'p_1'], ['p_2', 'p_3'], ['p_4', 'p_5']],
  players: [0, 1, 2, 3, 4, 5].map((seat) => ({ playerId: `p_${seat}`, seat, name: `P${seat}`, alive: true, lp: 10 })),
  fields: [],
  factions: ['A'],
  disabledBonds: [],
  drawnDisabledBonds: [],
  bannedChess: [],
});

test('a FULL frame is materialized with its nested arrays intact (never an object with numeric keys)', () => {
  const state = applyPublic(null, fullBossPrep()).state;
  assert.ok(Array.isArray(state.bossPairs), 'the pairing list stays an array');
  for (const group of state.bossPairs) assert.ok(Array.isArray(group), `a pair stays an array, got ${JSON.stringify(group)}`);
  assert.deepEqual(state.bossPairs, [['p_0', 'p_1'], ['p_2', 'p_3'], ['p_4', 'p_5']]);
});

test('the materialized state never aliases the frame it was built from (the wire object is not the store)', () => {
  const frame = fullBossPrep();
  const state = clonePublic(frame);
  frame.bossPairs[0][0] = 'somebody-else';
  frame.players[0].name = 'renamed';
  frame.factions.push('B');
  assert.deepEqual(state.bossPairs, [['p_0', 'p_1'], ['p_2', 'p_3'], ['p_4', 'p_5']], 'the pairs are a copy, one level deeper than before');
  assert.equal(state.players[0].name, 'P0', 'a player row is a copy');
  assert.deepEqual(state.factions, ['A'], 'a flat list is a copy');
});

test('every consumer of the pairing still reads it after a FULL frame (camera / deploy field / team frames)', () => {
  const pub = applyPublic(null, fullBossPrep()).state;
  assert.deepEqual(prepCamera(pub, 'p_1'), { kind: 'bossPrep', opts: { side: 'R' } }, 'the right-hand player of pair 1');
  assert.deepEqual(prepCamera(pub, 'p_2'), { kind: 'bossPrep', opts: { side: 'L' } }, 'the left-hand player of pair 2');
  assert.equal(deployFieldOf(pub, 'p_1'), 'bossR', 'legality reads the right half');
  assert.deepEqual([...teamFrameIds(pub, 'p_1')], ['p_0', 'p_1'], 'the team panel frames the pair');
});

test('the two camera paths never disagree (the camera-key effect vs the fold effect): that is the jump', () => {
  const pub = applyPublic(null, fullBossPrep()).state;
  // path A: the render body / the reassert effect — remembers the last boss half (screens/game.js bossSideRef)
  const a = prepCamera(pub, 'p_1', null, 'R');
  // path B: gameLogic foldCamera, which the shop-fold effect runs with the same remembered half
  const b = foldCamera({ pub, myId: 'p_1', folded: false, ownPrep: true, pen: false, busy: false, current: null, layout: null, fallbackSide: 'R' });
  assert.deepEqual(a, { kind: 'bossPrep', opts: { side: 'R' } });
  assert.equal(b.kind, 'bossPrep', 'the fold path asks for the same half, not the own board');
  assert.equal(b.opts.side, 'R');
  // and the deploy field the drag / placement code reads must agree with both
  assert.equal(deployFieldOf(pub, 'p_1', null, 'R'), 'bossR');
});

test('a pairing the frame has not delivered yet keeps the remembered half on BOTH paths (the >4-player room)', () => {
  // m.public of that frame has no bossPairs at all: prepPair must infer by seat, and if the seat is unknown both paths
  // fall back to the half the player had a moment ago — never to the own board
  const pub = { phase: PHASE.PREP, round: 14, bossRound: 14, hiddenRound: 15, players: [{ playerId: 'p_0', seat: 0, alive: true }, { playerId: 'p_1', seat: 1, alive: true }] };
  assert.deepEqual(prepCamera(pub, 'p_1', null, 'R'), { kind: 'bossPrep', opts: { side: 'R' } });
  const b = foldCamera({ pub, myId: 'p_1', folded: true, ownPrep: true, pen: false, busy: false, current: null, layout: null, fallbackSide: 'R' });
  assert.deepEqual([b.kind, b.opts.side], ['bossPrep', 'R'], 'the fold path keeps the half too');
  assert.equal(deployFieldOf(pub, 'p_1', null, 'R'), 'bossR');
});

test('接线：商店折叠那条 effect 把记住的半场一起交给 foldCamera（否则它与重设 effect 每帧互相纠正）', () => {
  const src = readFileSync(new URL('../../public/js/screens/game.js', import.meta.url), 'utf8');
  assert.ok(src.includes('fallbackSide: alive ? bossSideRef.current : null'), 'foldCamera is asked with the remembered boss half');
  assert.match(src, /deployFieldOf\(pub, myId, stageLayout, alive \? bossSideRef\.current : null\)/, 'the deploy field keeps it too');
});

test('端到端：一场 6 人同盟的最终攻势休整期，FULL 帧物化后六个人各自的取景都是 boss 半场且与部署场一致', () => {
  const h = makeMatch({ mode: 'coop', difficulty: 'NORMAL', humans: 6, bots: 0, seed: 7, fake: true, instant: true });
  h.autoHumans();
  h.start();
  h.drive(() => h.m.phase === PHASE.PREP && h.m.round === h.m.gd.bossRound, { ready: true });
  const m = h.m;
  assert.equal(m.round, m.gd.bossRound, 'reached the Final Assault prep');
  // the server's full view, materialized exactly the way the browser does on a FULL frame
  const pub = applyPublic(null, { ...m.publicView(), t: 'm.public' }).state;
  const pairs = m.bossWaves.map((w) => w.players.slice());
  assert.deepEqual(pub.bossPairs, pairs, 'the pairing survives the FULL-frame materialization');
  for (const [i, group] of pairs.entries()) {
    assert.equal(group.length, 2, `pair ${i} has two players`);
    group.forEach((pid, j) => {
      const want = j === 1 ? 'R' : 'L';
      assert.deepEqual(prepCamera(pub, pid), { kind: 'bossPrep', opts: { side: want } }, `${pid}: the boss prep camera on its own half`);
      assert.equal(deployFieldOf(pub, pid), want === 'R' ? 'bossR' : 'bossL', `${pid}: legality reads the same half`);
      assert.deepEqual([...teamFrameIds(pub, pid)], group, `${pid}: the pair is framed`);
    });
  }
  m.dispose();
});
