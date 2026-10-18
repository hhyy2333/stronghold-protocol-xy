// test/match/watch-retarget.test.js — 多场地一局里，某个场地结束时把看它的人转去还在打的场地（业主 2026-10-18）。
//
// 缺口：`_fieldDone` 只把 `f.live = false`，然后 `_maybeFieldsDone` 等**所有**场地结束；而 `watchers` 是
// `Map<pid, fieldId>`，13 个写入点没有一个处理「被看的场地结束了」。客户端 `b.end` 也只停战斗、从不挑下一个
// 场地。于是多人房分组联防时，观战者（以及自己那队打完的人）会一直盯着一个已经打完的战场，直到整个阶段结束。
//
// 这一份钉住 `_retargetWatchers` 的语义：往哪转、谁被转、什么时候不转。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeMatch } from './harness.js';

/** A match with `n` humans; every player gets a battle field of its own, and one viewer watching one of them. */
function fielded({ humans = 4, seed = 11, spectators = [] } = {}) {
  const h = makeMatch({ mode: 'coop', difficulty: 'NORMAL', humans, bots: 0, seed, fake: true, instant: true, spectators });
  h.autoHumans();
  h.m.start();
  return h;
}

/** Replace the fields with `n` synthetic live ones (id `w<i>`), each owned by one player. */
function syntheticFields(m, n) {
  const ids = [...m.players.keys()].slice(0, n);
  m.fields = ids.map((pid, i) => ({
    fieldId: `w${i}`, kind: 'unite', players: [pid], live: true, done: false, cc: true,
    battleId: `b${i}`, spec: { players: [{ playerId: pid }] }, progress: {},
  }));
  return m.fields;
}

test('a viewer of a finished field is moved to a field that is still running', () => {
  const h = fielded({ humans: 4 });
  const m = h.m;
  const fields = syntheticFields(m, 3);
  const viewer = [...m.players.keys()][3];      // a 4th human who fights nowhere among these
  m.watchers.set(viewer, 'w0');
  // w0 ends while w1 / w2 still run
  fields[0].done = true;
  fields[0].live = false;
  fields[0].result = m.fields[0].result || { leaked: [], perfect: true };
  m._retargetWatchers(fields[0]);
  assert.notEqual(m.watchers.get(viewer), 'w0', 'the view left the finished field');
  const next = m.watchers.get(viewer);
  assert.ok(next === 'w1' || next === 'w2', `moved to a running field, got ${next}`);
  const start = h.lastTo(viewer, 'b.start');
  assert.ok(start, 'a b.start was sent so the client actually switches');
});

test('a player of the finished field follows the rest of the phase too (owner decision), but never as a fighter', () => {
  const h = fielded({ humans: 4 });
  const m = h.m;
  const fields = syntheticFields(m, 2);
  const fighter = fields[0].players[0];
  m.watchers.set(fighter, 'w0');
  fields[0].done = true;
  fields[0].live = false;
  fields[0].result = { leaked: [], perfect: true };
  m._retargetWatchers(fields[0]);
  assert.notEqual(m.watchers.get(fighter), 'w0', 'their own field ended: they are not parked on it');
  const start = h.lastTo(fighter, 'b.start');
  assert.equal(start.fieldId, 'w1');
  assert.equal(start.watch, true, 'shown as a WATCHER of the new field');
  assert.equal(start.authoritative, false, 'never handed the new field authority');
});

test('a viewer who fights on a still-live field goes back to their OWN field, not the first one', () => {
  const h = fielded({ humans: 4 });
  const m = h.m;
  const fields = syntheticFields(m, 3);
  m.watchers.set('p_0', 'w0');           // p_0 watches w0 …
  fields[2].players = ['p_0'];           // … but actually fights on w2 (already live)
  fields[0].done = true;
  fields[0].live = false;
  fields[0].result = { leaked: [], perfect: true };
  m._retargetWatchers(fields[0]);
  assert.equal(m.watchers.get('p_0'), 'w2', 'back to their own battle');
});

test('nothing moves when the whole phase ended (no field left running)', () => {
  const h = fielded({ humans: 3 });
  const m = h.m;
  const fields = syntheticFields(m, 3);
  m.watchers.set('p_0', 'w0');
  for (const f of fields) { f.done = true; f.live = false; f.result = { leaked: [], perfect: true }; }
  const before = new Map(m.watchers);
  m._retargetWatchers(fields[0]);
  assert.deepEqual([...m.watchers], [...before], 'no live field to move to → the view stays (the phase is ending)');
});

test('a field that never launched is never chosen, and views on other fields are left alone', () => {
  const h = fielded({ humans: 4 });
  const m = h.m;
  const fields = syntheticFields(m, 2);
  const other = [...m.players.keys()][3];
  m.watchers.set(other, 'w1');           // watching a DIFFERENT field
  const viewer = [...m.players.keys()][2];
  m.watchers.set(viewer, 'w0');
  fields[0].done = true;
  fields[0].live = false;
  fields[0].result = { leaked: [], perfect: true };
  m._retargetWatchers(fields[0]);
  assert.equal(m.watchers.get(other), 'w1', 'a view on another field is untouched');
  assert.equal(m.watchers.get(viewer), 'w1', 'the only running field is the target');
});

test('the end-to-end path: _fieldDone moves the view (this is the reported bug)', () => {
  const h = fielded({ humans: 4 });
  const m = h.m;
  const fields = syntheticFields(m, 2);
  const viewer = [...m.players.keys()][3];
  m.watchers.set(viewer, 'w0');
  // the client-combat path: `_fieldDone` is what runs when a field's result is released
  fields[0].result = { leaked: [], perfect: true, perPlayer: {} };
  fields[0].progress = {};
  m._fieldDone(fields[0]);
  assert.equal(fields[0].done, true);
  assert.notEqual(m.watchers.get(viewer), 'w0', 'the reported symptom: the view must not stay on the finished field');
  assert.equal(m.watchers.get(viewer), 'w1');
});
