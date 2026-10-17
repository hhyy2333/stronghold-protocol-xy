// Owner 2026-10-12: 分裂怪穿模到地图外，直接进入蓝门. A split copy is born at the parent's position plus a
// ±0.1 offset (spawnChildren). If that offset leaves the copy's rounded tile void or outside the battle rect,
// it is in neither flow field (ai.js legField), so planLeg keeps the leg target as the only waypoint — on the
// last leg the blue door — and the copy walks straight through terrain and leaks. A displaced parent parks at
// `n + 0.4999…`, so a +0.1 copy leaves the lane constantly. 战场#05(下半) act2autochess_m01 is the reported
// map: its walk lane starts at col 10, the rect's right edge, and the copy clamped to x = 10.5 — tile col 11,
// outside the map (rect {r0:9,r1:12,c0:0,c1:10}, goal [9,2], void columns r9c6 / r10-11c6,c8,c10 / r12c8).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeBattle, enemyRec } from '../helpers/battleHarness.js';
import { spawnChildren } from '../../server/sim/content/enemies.js';
import { straightClear } from '../../server/sim/grid.js';
import { hasGeneratedData } from '../../server/sim/simdata.js';

const REAL = { skip: !hasGeneratedData() };
const STAGE = 'act2autochess_m01';
const KEY = 'enemy_walk_test';
const GOAL = [9, 2];
const FRACS = [-0.49, -0.25, 0, 0.25, 0.49]; // the parent stays on its own tile, at every edge of it

function battle() {
  return makeBattle({
    stageId: STAGE, kind: 'normal', autoFinish: false, timeLimit: 900,
    defs: { enemies: { [KEY]: enemyRec({ key: KEY, hp: 4700, atk: 0, def: 0, speed: 1, motion: 'WALK' }) } },
    enemies: [],
  });
}

/** A stand-in parent: spawnChildren only reads its position, motion, route and mods. */
function walkParent(y, x) {
  return {
    y, x, motion: 'WALK', mods: null,
    route: { legs: [{ t: 'move', r: GOAL[0], c: GOAL[1], final: true }], legIdx: 0, waitLeft: null, pts: null, ptIdx: 0 },
  };
}

test('a ±offset split copy is always born on ground a walking copy can stand on', REAL, () => {
  const h = battle();
  const b = h.b, g = b.grid;
  const tiles = [];
  for (let r = g.rect.r0; r <= g.rect.r1; r++) for (let c = g.rect.c0; c <= g.rect.c1; c++) if (g.walkable(r, c)) tiles.push([r, c]);
  assert.ok(tiles.length >= 10, `${STAGE} has standable tiles (${tiles.length})`);
  let copies = 0, moved = 0;
  for (const [r, c] of tiles) {
    for (const f of FRACS) {
      const n0 = b.enemies.length;
      const parent = walkParent(r + f, c + f);
      for (const k of spawnChildren(b, parent, KEY, 2)) {
        const kr = Math.round(k.y), kc = Math.round(k.x);
        assert.ok(g.walkable(kr, kc), `a copy of the parent at (${r + f},${c + f}) is born on (${kr},${kc})`);
        if (Math.abs(Math.abs(k.x - parent.x) - 0.1) < 1e-9) moved++; // the visual separation survives where it can
        copies++;
      }
      b.enemies.length = n0; // the sweep only inspects the copies it just made
    }
  }
  assert.ok(copies >= tiles.length * FRACS.length * 2 - 2, `swept ${copies} copies`);
  assert.ok(moved > 0, 'the offset is still applied where it leaves the copy on ground');
});

test('a copy of a parent pushed onto the lane edge walks the field chain instead of arrowing into the door', REAL, () => {
  const h = battle();
  const b = h.b, g = b.grid;
  const parent = b.spawnEnemy(KEY, { pos: [9, 10], route: { motion: 'WALK', start: [9, 10], end: GOAL, checkpoints: [] } });
  h.step(1);
  assert.ok(b.displace(parent, { x: 1, y: 0 }, 5) > 0, 'the parent is pushed right, to the lane edge');
  const kids = spawnChildren(b, parent, KEY, 2);
  assert.equal(kids.length, 2);
  for (const k of kids) assert.ok(g.walkable(Math.round(k.y), Math.round(k.x)), 'born on ground');

  h.step(1);
  for (const k of kids) {
    const pts = k.route.pts ?? [];
    assert.ok(pts.length > 1, `the copy follows a chain, not a single straight waypoint (${pts.length})`);
    assert.ok(straightClear(g, k.x, k.y, pts[0]), 'the first step is clear');
    for (let i = 1; i < pts.length; i++) assert.ok(straightClear(g, pts[i - 1].x, pts[i - 1].y, pts[i]), `leg ${i} is clear`);
  }

  const off = [];
  for (let i = 0; i < 60 * 60 && kids.some((k) => k.alive); i++) {
    h.step(1);
    for (const k of kids) if (k.alive && !g.walkable(Math.round(k.y), Math.round(k.x))) off.push(`${k.id} on (${Math.round(k.y)},${Math.round(k.x)})`);
  }
  assert.deepEqual(off.slice(0, 3), [], 'no copy ever stands off-ground');
  assert.ok(kids.every((k) => !k.alive), 'both copies reach the door');
});
