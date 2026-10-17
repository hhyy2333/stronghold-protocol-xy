// 本局累计伤害统计 (the DAMAGE REPORT panel's 修整期 view): the per-operator totals a match accumulates from every battle
// result it accepts (server/match/player/round.js _addCumStats), the m.private `cumStats` view that carries them to the
// client (server/match/player/views.js), and the client-side helpers that turn them into panel rows
// (public/js/ui/damageReport.js cumulativeRows).
//
// Unit tests of the accumulation rules (keyed by chess id, summons folded, every metric) plus one end-to-end match that
// proves the wiring: a real match runs rounds, the panel's rows cover the result's own unitStats, and the totals grow
// with the next round instead of resetting.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PHASE } from '../../shared/constants.js';
import { PlayerState } from '../../server/match/PlayerState.js';
import { GameData } from '../../server/match/gamedata.js';
import { DATA, makeMatch } from './harness.js';
import { cumulativeRows, REPORT_METRICS, rankRows, reportTotal } from '../../public/js/ui/damageReport.js';

/** A real PlayerState (the methods under test live on its prototype) with no match behind it. */
function stubPs(board = []) {
  const gd = new GameData(DATA, { warn() {}, error() {}, info() {} });
  const ps = new PlayerState({ gd, dispatch() {}, markPrivate() {} }, { playerId: 'p1', seat: 0, name: 'P', isBot: false, connected: true });
  let next = 1, slot = 0;
  for (const b of board) ps.board.set(`0,${++slot}`, { kind: 'chess', id: b.id, uid: b.uid ?? next++ });
  return ps;
}

/** Real operator ids from the shipped data: one with a summon token, one plain, and its elite. */
const SUMMONER = Object.values(DATA.chess).find((c) => c.visible && !c.isGolden && Array.isArray(c.tokens) && c.tokens.length && c.tier === 2);
const PLAIN = Object.values(DATA.chess).find((c) => c.visible && !c.isGolden && (!c.tokens || !c.tokens.length) && c.tier === 1);

test('_addCumStats: sums every metric per operator, keyed by the base chess id on the board', () => {
  const ps = stubPs([{ id: SUMMONER.chessId, uid: 7 }, { id: PLAIN.chessId, uid: 8 }]);
  assert.equal(ps._addCumStats({ unitStats: [
    { uid: 7, defId: SUMMONER.chessId, dmg: 100.4, taken: 50.5, heal: 0, kills: 2 },
    { uid: 8, defId: PLAIN.chessId, dmg: 0, taken: 900, heal: 0, kills: 0 },
  ] }), 2);
  // a later battle keeps accumulating
  ps._addCumStats({ unitStats: [
    { uid: 7, defId: SUMMONER.chessId, dmg: 99.6, taken: 49.5, heal: 10, kills: 1 },
    { uid: 8, defId: PLAIN.chessId, dmg: 0, taken: 0, heal: 300, kills: 0 },
  ] });
  const rows = ps.cumStatsView();
  const a = rows.find((r) => r.defId === SUMMONER.chessId);
  assert.equal(a.dmg, 200, 'floats summed, then rounded');
  assert.equal(a.taken, 100);
  assert.equal(a.heal, 10);
  assert.equal(a.kills, 3);
  assert.equal(a.kind, 'op');
  const b = rows.find((r) => r.defId === PLAIN.chessId);
  assert.equal(b.taken, 900);
  assert.equal(b.heal, 300);
  assert.equal(b.tier, PLAIN.tier);
});

test('_addCumStats: a merge builds a new uid, but the row is the base chess id — one operator, one row', () => {
  const eliteId = SUMMONER.goldenId || `${SUMMONER.chessId.replace(/_a$/, '')}_b`;
  const ps = stubPs([{ id: SUMMONER.chessId, uid: 7 }]);
  ps._addCumStats({ unitStats: [{ uid: 7, defId: SUMMONER.chessId, dmg: 500, taken: 0, heal: 0, kills: 1 }] });
  // the merge consumed the piece: a NEW piece, a new uid, the elite id — the row must follow
  ps.board.clear();
  ps.board.set('0,1', { kind: 'chess', id: eliteId, uid: 21 });
  ps._addCumStats({ unitStats: [{ uid: 21, defId: eliteId, dmg: 700, taken: 0, heal: 0, kills: 2 }] });
  const rows = ps.cumStatsView();
  assert.equal(rows.length, 1, 'one operator, one row');
  assert.equal(rows[0].dmg, 1200, 'the totals keep counting into it');
});

test('_addCumStats: a battle-created summon folds into the operator whose record lists the token', () => {
  const tokenId = SUMMONER.tokens[0];
  const ps = stubPs([{ id: SUMMONER.chessId, uid: 7 }]);
  ps._addCumStats({ unitStats: [
    { uid: 7, defId: SUMMONER.chessId, dmg: 100, taken: 0, heal: 0, kills: 0 },
    // no board uid: a summon created in battle
    { uid: null, defId: tokenId, dmg: 400, taken: 20, heal: 5, kills: 1 },
  ] });
  const rows = ps.cumStatsView();
  assert.equal(rows.length, 1, 'the summon did not make a second row');
  assert.equal(rows[0].defId, SUMMONER.chessId);
  assert.equal(rows[0].dmg, 500);
  assert.equal(rows[0].taken, 20);
});

test('_addCumStats: a summon no board piece claims gets its own def: row; junk is skipped', () => {
  const ps = stubPs([{ id: SUMMONER.chessId, uid: 7 }]);
  const unclaimed = Object.values(DATA.tokens).find((t) => !SUMMONER.tokens.includes(t.tokenId));
  ps._addCumStats({ unitStats: [
    { uid: null, defId: unclaimed.tokenId, dmg: 300, taken: 0, heal: 0, kills: 0 },
    { uid: 7, defId: SUMMONER.chessId, dmg: 0, taken: 0, heal: 0, kills: 0 },  // nothing in any metric
    null,
    { uid: 999, defId: null, dmg: 50, taken: 0, heal: 0, kills: 0 },          // no board uid, no defId
  ] });
  const rows = ps.cumStatsView();
  assert.deepEqual(rows.map((r) => [r.key, r.dmg, r.kind]), [[`def:${unclaimed.tokenId}`, 300, 'token']]);
  assert.equal(ps._addCumStats(null), 0, 'no result: nothing folded');
  assert.equal(ps._addCumStats({ unitStats: [] }), 0);
});

test('_addCumStats: a row is kept for an operator the board no longer holds (sold / transformed away)', () => {
  const ps = stubPs([{ id: SUMMONER.chessId, uid: 7 }]);
  ps._addCumStats({ unitStats: [{ uid: 7, defId: SUMMONER.chessId, dmg: 400, taken: 0, heal: 0, kills: 0 }] });
  ps.board.clear(); // sold before the next battle
  const unclaimed = Object.values(DATA.tokens).find((t) => !SUMMONER.tokens.includes(t.tokenId));
  ps._addCumStats({ unitStats: [{ uid: null, defId: unclaimed.tokenId, dmg: 10, taken: 0, heal: 0, kills: 0 }] });
  const rows = ps.cumStatsView();
  assert.ok(rows.some((r) => r.defId === SUMMONER.chessId && r.dmg === 400), 'the earned row survives');
  assert.ok(rows.some((r) => r.defId === unclaimed.tokenId), 'the unclaimed summon gets its own row');
});

test('cumStatsView: ordered by damage → knock-outs → id, rounded, and it names what the client draws', () => {
  const ps = stubPs([{ id: SUMMONER.chessId, uid: 7 }, { id: PLAIN.chessId, uid: 8 }]);
  ps._addCumStats({ unitStats: [
    { uid: 7, defId: SUMMONER.chessId, dmg: 100, taken: 0, heal: 0, kills: 0 },
    { uid: 8, defId: PLAIN.chessId, dmg: 100, taken: 0, heal: 0, kills: 5 },
  ] });
  const rows = ps.cumStatsView();
  assert.deepEqual(rows.map((r) => r.defId), [PLAIN.chessId, SUMMONER.chessId], '100 with more kills first, then 100');
  for (const r of rows) {
    for (const k of ['key', 'defId', 'name', 'kind', 'tier', 'golden', 'dmg', 'taken', 'heal', 'kills']) {
      assert.ok(k in r, `${r.defId} carries ${k}`);
    }
    assert.ok(r.name, 'a name the panel can draw');
  }
});

test('the client helpers turn m.private.cumStats into panel rows for each metric', () => {
  const cum = [
    { key: 'chess_a', defId: 'chess_a', name: 'A', kind: 'op', tier: 3, golden: false, dmg: 1000, taken: 200, heal: 0, kills: 4 },
    { key: 'chess_b', defId: 'chess_b', name: 'B', kind: 'op', tier: 1, golden: false, dmg: 400, taken: 0, heal: 900, kills: 0 },
  ];
  const rows = cumulativeRows(cum);
  assert.equal(rows.length, 2);
  assert.equal(reportTotal(rows, 'dmg'), 1400);
  assert.equal(reportTotal(rows, 'taken'), 200);
  assert.equal(reportTotal(rows, 'heal'), 900);
  assert.deepEqual(rankRows(rows, 'dmg').map((r) => r.defId), ['chess_a', 'chess_b']);
  assert.deepEqual(rankRows(rows, 'heal').map((r) => r.defId), ['chess_b'], 'A healed nothing: no 治疗 row');
  for (const m of REPORT_METRICS) assert.ok(rankRows(rows, m.id).length >= 1, m.id);
});

test('a real match: every round folds its result into m.private.cumStats, and the totals never reset', () => {
  const h = makeMatch({ mode: 'solo', difficulty: 'NORMAL', humans: 1, seed: 4201, captureFrames: false }).start();
  const m = h.m;
  const ps = m.players.get('p_0');
  h.autoHumans();
  h.toPrep(1);
  assert.deepEqual(ps.cumStatsView(), [], 'nothing has fought yet');
  // R1's battle runs; its result reaches _finishCombat, which folds it in
  h.run(() => m.phase === PHASE.SETTLE || m.phase === PHASE.UNITE || h.ended != null);
  const r1 = m.lastResults.get('p_0');
  const after1 = ps.cumStatsView();
  assert.ok(r1 && Array.isArray(r1.unitStats), 'the round produced a result with per-unit stats');
  if (r1.unitStats.length) {
    assert.ok(after1.length > 0, 'the round\'s per-unit numbers became rows');
    // the fold loses nothing: every row's totals are covered by the result's own unitStats
    const sum = (f) => r1.unitStats.reduce((n, u) => n + (Number(u[f]) || 0), 0);
    const rowsSum = (f) => after1.reduce((n, r) => n + r[f], 0);
    for (const f of ['dmg', 'taken', 'heal']) {
      assert.equal(rowsSum(f), Math.round(sum(f)), `${f}: rows vs result`);
    }
    for (const r of after1) {
      assert.ok(Number.isInteger(r.dmg) && Number.isInteger(r.taken) && Number.isInteger(r.heal), 'whole numbers');
      assert.ok(typeof r.defId === 'string' && r.defId, 'a defId the client can draw');
      assert.ok(Number.isInteger(r.kills) && r.kills >= 0);
    }
  }
  // the m.private frame the client reads carries the same rows (JSON-safe, like every frame)
  const priv = ps.privateView();
  assert.ok(Array.isArray(priv.cumStats), 'm.private.cumStats');
  assert.deepEqual(priv.cumStats, after1);
  assert.ok(!/NaN|Infinity/.test(JSON.stringify(priv.cumStats).replace(/"[^"]*"/g, '')));
  // R2 must ADD to the totals, never restart them
  const before = ps.cumStatsView();
  const total = (rows) => rows.reduce((n, r) => n + r.dmg, 0);
  if (total(before) > 0) {
    h.toPrep(2);
    h.run(() => m.phase === PHASE.SETTLE || m.phase === PHASE.UNITE || h.ended != null);
    const after2 = ps.cumStatsView();
    assert.ok(total(after2) >= total(before), `the match total grew or held (${total(before)} → ${total(after2)})`);
    for (const r of before) {
      const now = after2.find((x) => x.key === r.key);
      assert.ok(now, `${r.key} still has a row`);
      assert.ok(now.dmg >= r.dmg && now.taken >= r.taken && now.heal >= r.heal, `${r.key} kept its totals`);
    }
  }
});
