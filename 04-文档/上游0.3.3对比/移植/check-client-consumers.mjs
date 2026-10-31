// 04-文档/上游0.3.3对比/移植/check-client-consumers.mjs — L 号（task-12）的可运行断言。
//
// 两条，各对应一个改法：
//   A. 服务端事件形状：心虚设计师（enemy_10097_crshd）被阻挡时朝向改了 → 快照带 `face: [[id, ±1]]`，**只在那帧**；
//      不改的帧不带这个键（"不声明就没有"）。
//   B. 客户端插值切断：淤困的短距离瞬移（`fx teleport` + `kind: 'parasite'`）在纯函数 SnapshotBuffer 上必须
//      "停住 → 落到新位置 ≠ 滑过去"，并且 `face` 是 edge（只有变化的帧给 ±1，其余帧 null）。
//
// 跑法：`node "04-文档/上游0.3.3对比/移植/check-client-consumers.mjs"`（在本仓库根目录；不需要浏览器、不需要 PIXI）。
// 入库建议：A 移到 `app/test/content/facing-crshd.test.js`，B 移到 `app/test/render/interp-face-teleport.test.js`。
import assert from 'node:assert/strict';
import { makeBattle, chessRec } from '../../../Stronghold-Protocol-Forge-协议源石版/app/test/helpers/battleHarness.js';
import { SnapshotBuffer, normalizeSnapshot } from '../../../Stronghold-Protocol-Forge-协议源石版/app/public/js/render/interp.js';

const results = [];
const check = (name, fn) => {
  try { fn(); results.push(['ok  ', name]); }
  catch (err) { results.push(['FAIL', name, err && err.message]); }
};

// ---------------------------------------------------------------------------------------------------------------
// A. 服务端：`face` 只发变化的帧

check('A 快照 face: 朝向没变的帧不带 face，变了的那一帧带 [[id, ±1]]', () => {
  const blocker = chessRec({
    id: 'blk_a', profession: 'TANK', bonds: [], tier: 1, skill: null, rangeGrid: [[0, 0]],
    stats: { maxHp: 1e6, atk: 0, def: 0, res: 0, aspd: 100, bat: 1, blockCnt: 3, respawnTime: 20 },
  });
  const h = makeBattle({
    defs: { chess: { blk_a: blocker } },
    // route 0 of the flat stage walks low along row 9 (from the right side, so the enemy faces LEFT): the blocker stands
    // in that lane, two tiles in
    units: [{ chessId: 'blk_a', row: 9, col: 6 }],
    enemies: [{ key: 'enemy_10097_crshd', time: 0, route: 0 }],
    hooks: [],
  });
  h.runUntil(() => { const e = h.enemy('enemy_10097_crshd'); return !!e && !!e.blockedBy; }, 20);
  const e = h.enemy('enemy_10097_crshd');
  assert.ok(e, 'the enemy spawned');
  // which side the lane spawns from is the stage's business — read the sign off the blocker instead of assuming one
  const side = e.blockedBy.x > e.x ? 1 : -1;
  assert.equal(e.facing, side, "its front is the blocker's side");
  h.snapshot();                      // records the sign it is born with
  h.step(1);
  assert.equal(h.snapshot().face, undefined, 'a frame that changes nothing carries no face list');
  // what a 位移 leaves behind: facing AWAY from its blocker. The frame that sees that publishes it …
  e.dir = side > 0 ? 'LEFT' : 'RIGHT';
  assert.deepEqual(h.snapshot().face, [[e.id, -side]], 'the frame that flips the sign publishes it');
  // … and the next tick of the content's tick-level face (content/enemies/special.js faceCrshd) turns it back, which the
  // client gets as its own one-frame edge (this is the turn the model never saw before: it kept the spawn sign).
  h.step(1);
  assert.equal(e.facing, side, 'faceCrshd turned it back toward its blocker');
  assert.deepEqual(h.snapshot().face, [[e.id, side]], 'the turn back is published once');
  assert.equal(h.snapshot().face, undefined, 'and the next frame says nothing again');
});

// ---------------------------------------------------------------------------------------------------------------
// B. 客户端：插值切断 + face 是 edge

const snapAt = (t, x, extra) => ({ t, units: [[1, x, 10, 100, 100, 0, 0, 0, 0]], ...extra });
const hopper = () => {
  const b = new SnapshotBuffer({ rate: 1, delay: 0 });
  b.push(snapAt(0, 10), 0);
  b.push(snapAt(0.1, 10.2), 0.1);   // 0.2 tiles in one snapshot: under the `teleport` threshold, so it "walks"
  return b;
};

check('B1 没有 teleport fx 时，0.2 格的位移是被插值的（对照）', () => {
  const s = hopper().sample(0.05).get(1);
  assert.ok(Math.abs(s.x - 10.1) < 1e-9, `slide halfway: x = ${s.x}`);
  assert.ok(Math.abs(s.vx) > 0, 'it has a velocity');
});

check('B2 带 kind:parasite 的 teleport fx 时：切断插值，停在旧格 → 直接落到新格', () => {
  const b = hopper();
  b.pushEvents([['fx', 'teleport', 10.2, 10, { id: 1, fromX: 10, fromY: 10, kind: 'parasite' }]], 0.1, 0.1);
  const mid = b.sample(0.05).get(1);
  assert.equal(mid.x, 10, 'cut: it is still on the old tile while the interval runs');
  assert.equal(mid.vx, 0, 'and it is not sliding');
  assert.equal(b.sample(0.1).get(1).x, 10.2, 'at the blink time it stands on the new tile');
  assert.equal(b.sample(0.2).get(1).x, 10.2, 'and does not extrapolate across the blink either');
});

check('B3 别的 teleport fx（kind 不是 parasite）保留正常的距离规则', () => {
  const b = hopper();
  b.pushEvents([['fx', 'teleport', 10.2, 10, { id: 1, kind: 'blink' }]], 0.1, 0.1);
  assert.ok(Math.abs(b.sample(0.05).get(1).x - 10.1) < 1e-9, 'still interpolated');
});

check('B4 face 是 edge：变化帧给 ±1，其余帧 null；坏条目被丢掉', () => {
  const b = new SnapshotBuffer({ rate: 1, delay: 0 });
  b.push(snapAt(0, 1, { face: [[1, -1]] }), 0);
  assert.equal(b.sample(0).get(1).face, -1, 'the frame that changes the sign hands it out');
  b.push(snapAt(0.1, 1), 0.1);
  assert.equal(b.sample(0.1).get(1).face, null, 'a frame without an entry means "as before"');
  const n = normalizeSnapshot({ t: 0, units: [[1, 1, 1, 1, 1, 0, 0, 0, 0]], face: [[1, 2], [99, 1], 'x'] });
  assert.equal(n.face, null, 'a sign that is not ±1 and an id the snapshot does not list are dropped');
});

for (const [tag, name, msg] of results) console.log(`${tag} ${name}${msg ? ` — ${msg}` : ''}`);
const bad = results.filter(([t]) => t === 'FAIL').length;
console.log(`\n${results.length - bad}/${results.length} 通过`);
process.exit(bad ? 1 : 0);
