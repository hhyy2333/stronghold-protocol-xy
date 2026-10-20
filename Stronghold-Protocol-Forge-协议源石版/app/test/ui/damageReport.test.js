// test/ui/damageReport.test.js — the in-battle DAMAGE REPORT (伤害统计, ui/damageReport.js and the sim side it reads).
//
// What has to hold:
//   * server/sim/spec.js damageReport: one row per operator, biggest first, a summon's damage folded into the operator
//     that deployed it, an unowned summon / a device on its own row, and Σ rows = the player's `damageDealt` (the result
//     screen's 造成伤害);
//   * snapshot.js damageView + b.snap `dmg` carry the same per-unit rows (display only: the nine-field tuples stay);
//   * the client joins those rows with the field meta's UnitInfo (snapshotDamageRows) and folds / orders / caps them the
//     same way (normalizeRows), so both combat modes read identically;
//   * the panel's pure helpers: the share percentages, the 随当前视角同步 filter (a 联防 half), the total;
//   * the panel and its HUD button render the official captions, and the CSS carries the panel.
// Run: node --test test/ui/damageReport.test.js

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { makeBattle, enemyRec } from '../helpers/battleHarness.js';
import { damageReport } from '../../server/sim/spec.js';
import { damageView } from '../../server/sim/snapshot.js';
import {
  snapshotDamageRows, cumulativeRows, normalizeRows, rankRows, filterByPlayers, reportTotal, shareFrac, sharePct,
  fmtDamage, metricOf, methodLines, DamageReportPanel, DamageReportRow, DamageReportButton, DamageTypeDetail, REPORT_METRICS,
  REPORT_MAX_ROWS,
} from '../../public/js/ui/damageReport.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const read = (p) => readFileSync(path.join(ROOT, p), 'utf8');

/** A battle with a damage dealer, a summon and an idle operator. */
function battleWithSummon() {
  const h = makeBattle({
    defs: { enemies: { enemy_dummy: enemyRec({ key: 'enemy_dummy', hp: 1e9, speed: 0, atk: 0 }) } },
    units: [
      { chessId: 'chess_char_1_01_a', row: 10, col: 3, uid: 1 },
      // 凯尔希: her Mon3tr is a real summon (ownerUnit), so it is a token with an owner
      { chessId: 'chess_char_1_02_a', row: 11, col: 3, uid: 2 },
    ],
    enemies: [{ key: 'enemy_dummy', pos: [10, 6] }],
    timeLimit: 40, seed: 11,
  });
  return h;
}

/**
 * Text of a vnode tree in document order — the repo convention (test/ui/moduleIcons.test.js): the tree is walked, never
 * rendered, so a component that uses hooks is never invoked outside Preact. A nested component's own children (a
 * `MicroLabel`'s text, a `<summary>`'s) are reachable; a component's PROPS are not, so a row's content is asserted by
 * calling `DamageReportRow` directly.
 */
function* walk(v) {
  if (Array.isArray(v)) { for (const x of v) yield* walk(x); return; }
  if (!v || typeof v !== 'object') return;
  yield v;
  yield* walk(v.props?.children);
}
const textOf = (v) => [...walk(v)].map((n) => n.props?.children).flat()
  .filter((c) => typeof c === 'string' || typeof c === 'number').join('');
const classes = (v, out = []) => {
  for (const n of walk(v)) if (typeof n.props?.class === 'string') out.push(n.props.class);
  return out;
};
/** The row vnodes a panel rendered (their props are the rows; the tree itself is not rendered). */
const rowVnodes = (v) => [...walk(v)].filter((n) => n.type === DamageReportRow);

describe('sim: damageReport', () => {
  test('one row per unit that dealt damage, biggest first, Σ rows = the player\'s damageDealt', () => {
    const h = battleWithSummon();
    h.runUntil(() => h.b.time > 14, 14);
    const rows = damageReport(h.b);
    assert.ok(rows.length >= 1, JSON.stringify(rows));
    for (const r of rows) assert.ok(r.dmg > 0, `${r.defId}: only damage dealers`);
    const sorted = [...rows].sort((a, b) => b.dmg - a.dmg);
    assert.deepEqual(rows.map((r) => r.key), sorted.map((r) => r.key), 'descending');
    const sum = rows.reduce((n, r) => n + r.dmg, 0);
    assert.equal(sum, Math.round(h.b.result().perPlayer.p1.damageDealt), 'the panel total is the result screen\'s 造成伤害');
    const u = rows[0];
    assert.equal(u.kind, 'op');
    assert.equal(u.ownerId, 'p1');
    assert.equal(typeof u.name, 'string');
    assert.ok(u.uid >= 1, 'the board uid (the panel keys a row by it)');
  });

  test('a summon\'s numbers fold into the operator that deployed it; an ownerless token and a device get their own row', () => {
    const h = battleWithSummon();
    h.runUntil(() => h.b.time > 14, 14);
    const op = h.unit('chess_char_1_01_a');
    // give the operator a summon that acted, and an ownerless one: the fold must reach the operator, the ownerless token
    // must keep its own row. All three metrics must fold, not only damage.
    const st = (dmg, taken, heal, kills) => ({ dmg, taken, heal, kills });
    const tok = { id: 9001, uid: null, kind: 'token', defId: 'token_x', name: '召唤', ownerId: 'p1', side: 'ally', def: {}, stats: st(500, 120, 30, 2), ownerUnit: op };
    const lone = { id: 9002, uid: null, kind: 'token', defId: 'token_y', name: '野召唤', ownerId: 'p1', side: 'ally', def: {}, stats: st(300, 40, 0, 1), ownerUnit: null };
    const dev = { id: 9003, uid: null, kind: 'device', defId: 'trap_turret', name: '射击台', ownerId: 'p1', side: 'ally', def: {}, stats: st(200, 10, 5, 0), ownerUnit: null };
    const list = [...h.b.allyUnits, tok, lone, dev];
    const rows = damageReport({ allyUnits: list });
    const opRow = rows.find((r) => r.uid === 1);
    assert.ok(opRow, 'the operator row');
    assert.equal(opRow.dmg, Math.round(op.stats.dmg) + 500, 'the summon\'s 500 folded in');
    assert.equal(opRow.taken, Math.round(op.stats.taken) + 120, 'its 120 taken folded in too');
    assert.equal(opRow.heal, Math.round(op.stats.heal) + 30, 'and its 30 healing');
    assert.equal(opRow.kills, (op.stats.kills | 0) + 2);
    assert.equal(opRow.folded, 1, 'one summon absorbed');
    assert.ok(rows.some((r) => r.defId === 'token_y' && r.dmg === 300), 'the ownerless token keeps its own row');
    assert.ok(rows.some((r) => r.defId === 'trap_turret' && r.dmg === 200), 'the device keeps its own row');
    // `playerId` narrows to one player's units (a 联防 / boss field holds several)
    assert.deepEqual(damageReport({ allyUnits: list }, 'other'), [], 'nobody of that player acted');
    assert.ok(damageReport({ allyUnits: list }, 'p1').length >= 3);
  });

  test('a row survives on ANY metric: a pure healer and a pure tank are listed, a unit with nothing is not', () => {
    const rows = damageReport({ allyUnits: [
      { id: 1, uid: 1, kind: 'op', defId: 'healer', name: 'H', ownerId: 'p1', side: 'ally', def: {}, stats: { dmg: 0, taken: 0, heal: 900, kills: 0 } },
      { id: 2, uid: 2, kind: 'op', defId: 'tank', name: 'T', ownerId: 'p1', side: 'ally', def: {}, stats: { dmg: 0, taken: 5000, heal: 0, kills: 0 } },
      { id: 3, uid: 3, kind: 'op', defId: 'idle', name: 'I', ownerId: 'p1', side: 'ally', def: {}, stats: { dmg: 0, taken: 0, heal: 0, kills: 0 } },
    ] });
    assert.deepEqual(rows.map((r) => r.defId).sort(), ['healer', 'tank'], 'the idle one is not a row');
    assert.equal(rows.find((r) => r.defId === 'healer').heal, 900);
    assert.equal(rows.find((r) => r.defId === 'tank').taken, 5000);
  });

  test('a unit that acted in nothing is not listed; no battle / no allyUnits is []', () => {
    assert.deepEqual(damageReport(null), []);
    assert.deepEqual(damageReport({}), []);
    const h = battleWithSummon();
    h.run(0.2);                                   // before the first attack lands
    assert.deepEqual(damageReport(h.b), [], 'nothing happened yet');
  });

  test('damageView: b.snap `dmg` carries the same rows as wire tuples, display only', () => {
    const h = battleWithSummon();
    h.runUntil(() => h.b.time > 14, 14);
    const view = damageView(h.b.allyUnits);
    assert.ok(Array.isArray(view) && view.length >= 1);
    for (const t of view) {
      assert.equal(t.length, 6, 'id, dealt, taken, heal, kills, foldId');
      assert.ok(Number.isInteger(t[0]) && Number.isInteger(t[1]) && Number.isInteger(t[2]) && Number.isInteger(t[3]) && Number.isInteger(t[4]));
      assert.ok(t[5] === null || Number.isInteger(t[5]), 'foldId');
    }
    assert.deepEqual(h.b.snapshot().dmg, view, 'the snapshot carries it');
    // the nine-field unit tuples are unchanged by it
    for (const t of h.b.snapshot().units) assert.equal(t.length, 9);
    assert.equal(damageView([]), null, 'nothing happened: no list at all');
  });

  test('damageView lists a unit that only took damage or only healed (the 承伤 / 治疗 columns)', () => {
    const view = damageView([
      { id: 1, side: 'ally', kind: 'op', stats: { dmg: 0, taken: 700, heal: 0, kills: 0 } },
      { id: 2, side: 'ally', kind: 'op', stats: { dmg: 0, taken: 0, heal: 400, kills: 0 } },
      { id: 3, side: 'ally', kind: 'op', stats: { dmg: 0, taken: 0, heal: 0, kills: 0 } },
      { id: 4, side: 'enemy', kind: 'op', stats: { dmg: 999, taken: 999, heal: 999, kills: 9 } },
    ]);
    assert.deepEqual(view, [[1, 0, 700, 0, 0, null], [2, 0, 0, 400, 0, null]], 'allies only, and only the ones with something');
  });
});

describe('client: snapshotDamageRows joins a b.snap `dmg` list with the field meta', () => {
  const UNITS = [
    { id: 1, uid: 11, kind: 'op', side: 'ally', ownerId: 'p1', defId: 'chess_a', name: 'A', tier: 3 },
    { id: 2, uid: 12, kind: 'op', side: 'ally', ownerId: 'p2', defId: 'chess_b', name: 'B', tier: 1 },
    { id: 3, uid: null, kind: 'token', side: 'ally', ownerId: 'p1', defId: 'token_x', name: '召唤' },
    { id: 4, uid: null, kind: 'device', side: 'ally', ownerId: 'p1', defId: 'turret', name: '射击台' },
  ];

  test('rows read the meta for name / defId / kind / owner, and fold a summon onto its owner', () => {
    const rows = snapshotDamageRows(UNITS, [[1, 800, 40, 0, 2, null], [3, 200, 10, 0, 1, 1], [2, 300, 0, 0, 0, null], [4, 50, 5, 0, 0, null]]);
    assert.deepEqual(rows.map((r) => r.dmg), [1000, 300, 50], 'A folded its summon (800 + 200)');
    const a = rows[0];
    assert.equal(a.name, 'A');
    assert.equal(a.uid, 11);
    assert.equal(a.folded, 1);
    assert.equal(a.ownerId, 'p1');
    assert.equal(a.taken, 50, 'taken folded too (40 + 10)');
    assert.equal(a.kills, 3);
    assert.equal(rows[2].kind, 'device');
  });

  test('the 承伤 / 治疗 columns come through the join, and a row with only those is kept', () => {
    const rows = snapshotDamageRows(UNITS, [[1, 0, 500, 0, 0, null], [2, 0, 0, 250, 0, null]]);
    assert.deepEqual(rows.map((r) => [r.name, r.dmg, r.taken, r.heal]), [['A', 0, 500, 0], ['B', 0, 0, 250]]);
  });

  test('a row whose unit the meta does not name is kept (never dropped)', () => {
    const rows = snapshotDamageRows(UNITS, [[99, 700, 30, 0, 1, null]]);
    assert.equal(rows.length, 1);
    assert.equal(rows[0].dmg, 700);
    assert.equal(rows[0].taken, 30);
    assert.equal(rows[0].defId, null, 'no meta: nothing to name it with');
    assert.equal(rows[0].name, '', 'the panel falls back to its own 未知单位');
  });

  test('junk is ignored; the same key from two rows folds into one', () => {
    const rows = snapshotDamageRows(UNITS, [[1, 100, 10, 0, 0, null], [1, 50, 5, 0, 1, null], 'x', null, [null, 5], [2, -3, 0, 0, 0, null]]);
    assert.equal(rows.length, 1);
    assert.equal(rows[0].dmg, 150);
    assert.equal(rows[0].taken, 15);
    assert.equal(rows[0].kills, 1);
  });
});

describe('client: the pure helpers', () => {
  test('shareFrac / sharePct: whole percents from 10 % up, one decimal below, 0 without a total', () => {
    assert.equal(shareFrac(50, 100), 0.5);
    assert.equal(shareFrac(0, 100), 0);
    assert.equal(shareFrac(10, 0), 0);
    assert.equal(shareFrac(200, 100), 1, 'clamped');
    assert.equal(sharePct(0.5), '50%');
    assert.equal(sharePct(0.099), '9.9%');
    assert.equal(sharePct(0.004), '0.4%');
    assert.equal(sharePct(0), '0%');
    assert.equal(sharePct(NaN), null);
  });

  test('filterByPlayers / reportTotal: a 联防 half narrows the list, an ownerless row stays', () => {
    const rows = [
      { key: 'a', ownerId: 'p1', dmg: 100, taken: 10, heal: 1 },
      { key: 'b', ownerId: 'p2', dmg: 60, taken: 20, heal: 2 },
      { key: 'c', ownerId: null, dmg: 40, taken: 30, heal: 3 },
    ];
    assert.deepEqual(filterByPlayers(rows, null).map((r) => r.key), ['a', 'b', 'c']);
    assert.deepEqual(filterByPlayers(rows, ['p1']).map((r) => r.key), ['a', 'c'], 'p1 + the field device');
    assert.deepEqual(filterByPlayers(rows, []).map((r) => r.key), ['a', 'b', 'c'], 'no filter');
    assert.equal(reportTotal(rows, 'dmg', ['p1']), 140);
    assert.equal(reportTotal(rows, 'dmg'), 200);
    // the metric picks the column (the same rows, a different sum)
    assert.equal(reportTotal(rows, 'taken'), 60);
    assert.equal(reportTotal(rows, 'heal'), 6);
    assert.equal(reportTotal(rows, 'taken', ['p2']), 50, 'filtered (b + the ownerless device), then summed by the metric');
  });

  test('rankRows: the selected metric orders the list, and the rows with nothing in it drop out', () => {
    const rows = [
      { key: 'a', uid: 1, dmg: 100, taken: 900, heal: 0, kills: 0 },
      { key: 'b', uid: 2, dmg: 0, taken: 0, heal: 500, kills: 0 },
      { key: 'c', uid: 3, dmg: 300, taken: 10, heal: 50, kills: 0 },
    ];
    assert.deepEqual(rankRows(rows, 'dmg').map((r) => r.key), ['c', 'a'], 'b only heals: no 伤害 row');
    assert.deepEqual(rankRows(rows, 'taken').map((r) => r.key), ['a', 'c'], 'b took nothing');
    assert.deepEqual(rankRows(rows, 'heal').map((r) => r.key), ['b', 'c'], 'a healed nothing');
    assert.deepEqual(rankRows(rows, 'nonsense').map((r) => r.key), ['c', 'a'], 'an unknown metric falls back to 伤害');
    assert.deepEqual(rankRows([], 'dmg'), []);
  });

  test('normalizeRows: rounds, drops the empty rows, orders by damage → knock-outs → uid — and does NOT cap', () => {
    const rows = normalizeRows([
      { key: 'u9', uid: 9, dmg: 100.4, kills: 0 },
      { key: 'u2', uid: 2, dmg: 100.4, kills: 3 },
      { key: 'u1', uid: 1, dmg: 0, kills: 9 },
      { key: 'u3', uid: 3, dmg: 250, kills: 0 },
    ]);
    assert.deepEqual(rows.map((r) => [r.key, r.dmg]), [['u3', 250], ['u2', 100], ['u9', 100]], 'kills break the tie, then uid');
    assert.equal(normalizeRows([]).length, 0);
    // a row kept only for 承伤 / 治疗 still normalises (every metric rounds)
    const mixed = normalizeRows([{ key: 'x', taken: 10.6, heal: 2.4 }]);
    assert.deepEqual([mixed[0].taken, mixed[0].heal, mixed[0].dmg], [11, 2, 0]);
    // the cap is rankRows' job: capping by damage here would hide the top healers of a 治疗 view
    const many = normalizeRows(Array.from({ length: 20 }, (_, i) => ({ key: `u${i}`, uid: i, dmg: 100 - i })));
    assert.equal(many.length, 20, 'normalizeRows keeps them all');
    assert.equal(rankRows(many, 'dmg').length, REPORT_MAX_ROWS, 'rankRows caps');
  });

  test('the cap follows the selected metric: a top healer outside the top-12 by damage is still listed under 治疗', () => {
    // 14 damage dealers, then a healer with almost no damage — a damage-first cap would drop it
    const rows = Array.from({ length: 14 }, (_, i) => ({ key: `d${i}`, uid: i, dmg: 1000 - i * 10, taken: 0, heal: 0, kills: 0 }));
    rows.push({ key: 'healer', uid: 99, dmg: 5, taken: 0, heal: 9000, kills: 0 });
    assert.equal(rankRows(rows, 'dmg').some((r) => r.key === 'healer'), false, 'not a top-12 damage row');
    const heal = rankRows(rows, 'heal');
    assert.equal(heal.length, 1);
    assert.equal(heal[0].key, 'healer', 'the 治疗 view finds it');
    // and the panel wires that through (its rows come from rankRows, not from a pre-capped list)
    const panel = DamageReportPanel({ rows, metric: 'heal', total: null, onMetric: () => {} });
    assert.deepEqual(rowVnodes(panel).map((n) => n.props.row.key), ['healer']);
  });

  test('cumulativeRows: the server\'s 本局累计 rows (m.private.cumStats) normalise for the panel', () => {
    const rows = cumulativeRows([
      { key: 'chess_a', defId: 'chess_a', name: 'A', kind: 'op', tier: 3, golden: false, dmg: 1000, taken: 200, heal: 0, kills: 4 },
      { key: 'def:token_x', defId: 'token_x', name: '召唤', kind: 'token', tier: 1, golden: false, dmg: 0, taken: 0, heal: 300, kills: 0 },
      { defId: 'junk' },
    ]);
    assert.deepEqual(rows.map((r) => r.key), ['chess_a', 'def:token_x']);
    assert.equal(rows[0].dmg, 1000);
    assert.equal(rows[0].ownerId, null, 'the cumulative rows belong to one player: no camera filter');
    assert.equal(rows[1].kind, 'token');
    assert.deepEqual(cumulativeRows(null), []);
  });

  test('fmtDamage: thousands separators (the panel shows the digits, not the HUD\'s 万 compaction)', () => {
    assert.equal(fmtDamage(1320), '1,320');
    assert.equal(fmtDamage(0), '0');
    assert.equal(fmtDamage(1234567), '1,234,567');
    assert.equal(fmtDamage(12.6), '13');
    assert.equal(fmtDamage(NaN), '0');
  });

  test('REPORT_METRICS: three metrics, each with its own labels, and metricOf falls back to 伤害', () => {
    assert.deepEqual(REPORT_METRICS.map((m) => m.id), ['dmg', 'taken', 'heal']);
    assert.equal(metricOf('taken').field, 'taken');
    assert.equal(metricOf('nope').id, 'dmg');
    for (const m of REPORT_METRICS) assert.ok(m.label && m.total && m.column && m.value, m.id);
    // every metric explains itself
    for (const m of REPORT_METRICS) assert.ok(methodLines(m.id).length >= 3, m.id);
  });
});

describe('the panel and its HUD button', () => {
  const rows = [
    { key: 'u1', uid: 1, kind: 'op', defId: 'chess_a', name: '德克萨斯', ownerId: 'p1', dmg: 660, taken: 100, heal: 0, kills: 0, folded: 0, tier: 1 },
    { key: 'u2', uid: 2, kind: 'op', defId: 'chess_b', name: '波登可', ownerId: 'p1', dmg: 660, taken: 100, heal: 0, kills: 0, folded: 0, tier: 1 },
  ];
  /** The metric tab buttons of a panel tree. */
  const tabs = (tree) => [...walk(tree)].filter((v) => v.type === 'button' && String(v.props.class).includes('dmgrep__tab'));

  test('the header, the total, the column captions and the 统计口径 footer (the official DAMAGE REPORT layout)', () => {
    const tree = DamageReportPanel({ rows, total: 1320, round: 1, live: true, onClose: () => {}, onToggleLive: () => {} });
    const txt = textOf(tree);
    for (const s of ['DAMAGE REPORT', '累计伤害', '1,320', '第 1 回合 · 实时累计', '随当前视角同步', '干员 / 伤害占比', '实际伤害', '实时', '统计口径']) {
      assert.ok(txt.includes(s), `the panel shows ${s}: ${txt}`);
    }
    const cls = classes(tree).join(' | ');
    assert.ok(cls.includes('dmgrep'), cls);
    assert.ok(cls.includes('dmgrep__method'), 'the footer');
    // one row vnode per row, in order, each carrying its own row (the panel is a pure view of them)
    const rowNodes = rowVnodes(tree);
    assert.deepEqual(rowNodes.map((n) => n.props.row.key), ['u1', 'u2']);
    assert.deepEqual(rowNodes.map((n) => n.props.rank), [1, 2]);
    assert.ok(rowNodes.every((n) => n.props.total === 1320), 'every row shares the panel total');
    // the rows' own markup (name, damage, share, the top-rank cue)
    const rowTxt = textOf(DamageReportRow({ row: rows[0], rank: 1, total: 1320 }));
    for (const s of ['德克萨斯', '660', '50%']) assert.ok(rowTxt.includes(s), `the row shows ${s}: ${rowTxt}`);
    assert.ok(classes(DamageReportRow({ row: rows[0], rank: 1, total: 1320 })).join(' ').includes('is-top'));
    const summonRow = DamageReportRow({ row: { ...rows[0], folded: 2 }, rank: 1, total: 1320 });
    assert.ok(textOf(summonRow).includes('含召唤'), textOf(summonRow));
  });

  test('the metric switch: three tabs, the selected one drives the captions, the total and the rows', () => {
    const mixed = [
      { key: 'a', uid: 1, kind: 'op', defId: 'chess_a', name: '德克萨斯', ownerId: 'p1', dmg: 660, taken: 200, heal: 0, kills: 0, folded: 0 },
      { key: 'b', uid: 2, kind: 'op', defId: 'chess_b', name: '波登可', ownerId: 'p1', dmg: 0, taken: 0, heal: 300, kills: 0, folded: 0 },
    ];
    const tabs = (tree) => [...walk(tree)].filter((v) => v.type === 'button' && String(v.props.class).includes('dmgrep__tab'));
    let picked = null;
    const dmg = DamageReportPanel({ rows: mixed, metric: 'dmg', onMetric: (id) => { picked = id; } });
    assert.deepEqual(tabs(dmg).map((t) => t.props['data-metric']), ['dmg', 'taken', 'heal']);
    assert.deepEqual(tabs(dmg).map((t) => t.props['aria-selected']), ['true', 'false', 'false']);
    assert.ok(textOf(dmg).includes('干员 / 伤害占比') && textOf(dmg).includes('实际伤害'));
    assert.deepEqual(rowVnodes(dmg).map((n) => n.props.row.key), ['a'], '波登可 only healed: no 伤害 row');
    tabs(dmg)[1].props.onClick();
    assert.equal(picked, 'taken', 'the tab asks for its metric');

    const taken = DamageReportPanel({ rows: mixed, metric: 'taken', total: null, onMetric: () => {} });
    assert.ok(textOf(taken).includes('累计承伤') && textOf(taken).includes('干员 / 承伤占比') && textOf(taken).includes('承受伤害'), textOf(taken));
    assert.deepEqual(rowVnodes(taken).map((n) => n.props.row.key), ['a']);

    const heal = DamageReportPanel({ rows: mixed, metric: 'heal', total: null, onMetric: () => {} });
    assert.ok(textOf(heal).includes('累计治疗') && textOf(heal).includes('干员 / 治疗占比') && textOf(heal).includes('治疗量'), textOf(heal));
    assert.deepEqual(rowVnodes(heal).map((n) => n.props.row.key), ['b'], '德克萨斯 healed nothing');
    assert.equal(rowVnodes(heal)[0].props.total, 300, 'the total is that metric\'s sum');
    // the row carries its metric (the CSS accent) and the metric's own number
    const row = DamageReportRow({ row: mixed[1], rank: 1, total: 300, metric: 'heal' });
    assert.ok(classes(row).join(' ').includes('dmgrow--heal'));
    assert.ok(textOf(row).includes('300') && textOf(row).includes('100%'));
  });

  test('the 实时 toggle and the empty state', () => {
    const frozen = DamageReportPanel({ rows, total: 1320, round: 3, live: false, onToggleLive: () => {} });
    assert.ok(textOf(frozen).includes('第 3 回合 · 已冻结'), textOf(frozen));
    assert.ok(textOf(frozen).includes('已暂停'), 'the toggle reads 已暂停');
    const empty = DamageReportPanel({ rows: [], total: 0, round: 2 });
    assert.ok(textOf(empty).includes('本次战斗还没有统计数据'), textOf(empty));
    assert.equal(rowVnodes(empty).length, 0);
  });

  test('the 本局累计 view (修整期): its own captions, no 实时 toggle, the same rows and switch', () => {
    const cum = [
      { key: 'chess_a', uid: null, kind: 'op', defId: 'chess_a', name: 'A', ownerId: null, dmg: 1000, taken: 200, heal: 50, kills: 3, folded: 0, tier: 1 },
      { key: 'chess_b', uid: null, kind: 'op', defId: 'chess_b', name: 'B', ownerId: null, dmg: 400, taken: 0, heal: 900, kills: 0, folded: 0, tier: 1 },
    ];
    const tree = DamageReportPanel({ rows: cum, total: 1400, metric: 'dmg', cumulative: true, onMetric: () => {}, onToggleLive: () => {} });
    const txt = textOf(tree);
    assert.ok(txt.includes('本局累计') && txt.includes('本局至今'), txt);
    assert.ok(txt.includes('1,400'), txt);
    assert.ok(!txt.includes('实时'), `no live toggle in the cumulative view: ${txt}`);
    assert.ok(tabs(tree).length === 3, 'the switch still works there');
    // the same rows, switched to 治疗
    const heal = DamageReportPanel({ rows: cum, metric: 'heal', total: null, cumulative: true, onMetric: () => {} });
    assert.deepEqual(rowVnodes(heal).map((n) => n.props.row.key), ['chess_b', 'chess_a'], 'ranked by healing');
    // the row's own markup carries the number (a vnode's props are not children)
    assert.ok(textOf(DamageReportRow({ row: cum[1], rank: 1, total: 900, metric: 'heal' })).includes('900'));
    // the cumulative empty state reads its own line
    assert.ok(textOf(DamageReportPanel({ rows: [], total: 0, cumulative: true })).includes('本局还没有统计数据'));
  });

  test('a 联防 half filters the rows and the total together (随当前视角同步)', () => {
    const mixed = [...rows, { key: 'u3', uid: 3, kind: 'op', defId: 'chess_c', name: 'C', ownerId: 'p2', dmg: 400, taken: 0, kills: 0, heal: 0, folded: 0 }];
    const all = DamageReportPanel({ rows: mixed, total: 1720, round: 4 });
    assert.equal(rowVnodes(all).length, 3);
    assert.ok(textOf(all).includes('1,720'));
    // the half: only p2's rows, and the total follows the visible rows
    const half = DamageReportPanel({ rows: mixed, total: null, round: 4, players: ['p2'] });
    const halfRows = rowVnodes(half);
    assert.deepEqual(halfRows.map((n) => n.props.row.key), ['u3']);
    assert.equal(halfRows[0].props.total, 400, 'the total is the visible rows\' sum');
    assert.ok(textOf(half).includes('400'), textOf(half));
    // that row then reads 100 % of the half (the row's own markup, called directly: a vnode's props are not children)
    assert.ok(textOf(DamageReportRow({ row: halfRows[0].props.row, rank: 1, total: halfRows[0].props.total })).includes('100%'));
  });

  test('the 统计口径 footer is collapsed and carries the selected metric\'s lines', () => {
    const tree = DamageReportPanel({ rows, total: 1320, round: 1, metric: 'taken' });
    const detail = [...walk(tree)].find((v) => v.type === 'details');
    assert.ok(detail && String(detail.props.class).includes('dmgrep__method'));
    const summary = [...walk(tree)].find((v) => v.type === 'summary');
    assert.ok(summary, 'a <summary>');
    assert.ok(textOf(summary).includes('统计口径'));
    const lines = [...walk(tree)].filter((v) => v.type === 'li').map((v) => v.props.children);
    assert.deepEqual(lines, [...methodLines('taken')], 'the 承伤 method notes');
    assert.ok(lines.length >= 3);
    // each metric has its own explanation
    for (const id of ['dmg', 'taken', 'heal']) {
      const t2 = DamageReportPanel({ rows, total: 1320, metric: id });
      const ls = [...walk(t2)].filter((v) => v.type === 'li').map((v) => v.props.children);
      assert.deepEqual(ls, [...methodLines(id)], id);
    }
  });

  test('the HUD button toggles and badges its row count', () => {
    const closed = DamageReportButton({ open: false, onToggle: () => {}, count: 3 });
    assert.ok(classes(closed).join(' ').includes('gm__dmgrep'));
    assert.equal(closed.props['aria-expanded'], 'false');
    assert.ok(textOf(closed).includes('3'), 'the row count badge');
    const open = DamageReportButton({ open: true, onToggle: () => {} });
    assert.equal(open.props['aria-expanded'], 'true');
    let seen = null;
    const btn = DamageReportButton({ open: false, onToggle: (v) => { seen = v; } });
    btn.props.onClick();
    assert.equal(seen, true, 'the click asks to open');
  });
});

describe('wiring and CSS', () => {
  test('the game screen computes the report from the runner (client combat) or the snapshot (server-run), and the cumulative view in 修整期', () => {
    const game = read('public/js/screens/game.js');
    assert.match(game, /battleRunner\.damageReport\(null, reportFieldId\)/);
    assert.match(game, /snapshotDamageRows\(\[\.\.\.unitInfosRef\.current\.values\(\)\], dmgListRef\.current\)/);
    assert.match(game, /cumulativeRows\(priv\?\.cumStats\)/);
    assert.match(game, /const cumulative = !inBattle;/);
    assert.match(game, /const reportAvail = \(inBattle && !!reportFieldId\) \|\| cumulative;/);
    assert.match(game, /<\$\{DamageReportPanel\b/);
    assert.match(game, /<\$\{DamageReportButton\b/);
    assert.match(game, /dmgListRef\.current = Array\.isArray\(snap\.dmg\) \? snap\.dmg : null;/);
    // the metric switch is wired, and the panel gets it
    assert.match(game, /const \[dmgMetric, setDmgMetric\] = useState\('dmg'\);/);
    assert.match(game, /metric=\$\{dmgMetric\}/);
    assert.match(game, /onMetric=\$\{\(id\) => \{ setDmgMetric\(id\); setDmgDetailRow\(null\); \}\}/);
    // 业主 2026-10-20「点击干员头像可以看他的详细伤害类型」: the expanded row lives in the screen (the panel is a pure view)
    assert.match(game, /const \[dmgDetailRow, setDmgDetailRow\] = useState\(null\);/);
    assert.match(game, /detailRow=\$\{dmgDetailRow\} onDetail=\$\{setDmgDetailRow\}/);
    // Escape closes it, like the chat panel and the emote wheel
    assert.match(game, /else if \(L\.dmgOpen\) setDmgOpen\(false\);/);
  });

  test('点头像看详细伤害类型（业主 2026-10-20）：行内只有摘要，展开后每一类都有数值与占比', () => {
    const row = {
      key: 'u1', uid: 1, defId: 'char_1033_swire', name: '空弦', kind: 'op', dmg: 65330, taken: 2100, heal: 0, kills: 4,
      phys: 52330, arts: 0, true: 13000, elem: 4200, absorbed: 8600, folded: 0,
    };
    // collapsed: no detail, and the row keeps its inline summary
    const closed = JSON.stringify(DamageReportRow({ row, rank: 1, total: 65330, metric: 'dmg' }));
    assert.ok(!closed.includes('damage-detail'), 'collapsed: no detail block');
    assert.ok(closed.includes('元素损伤'), 'collapsed: the inline sub-figures are shown');
    // expanded: the avatar is the toggle (and says so), and the detail block is rendered as its child
    const open = JSON.stringify(DamageReportRow({ row, rank: 1, total: 65330, metric: 'dmg', detailOpen: true, onDetail: () => {} }));
    assert.ok(open.includes('damage-detail-toggle') && open.includes('aria-expanded'), 'the avatar is the toggle');
    assert.ok(!open.includes('dmgrow__extra'), 'expanded: the inline summary gives way to the detail block');
    // the block itself is a pure function component, so its output can be read directly
    const detail = JSON.stringify(DamageTypeDetail({ row }));
    assert.ok(detail.includes('damage-detail'), 'the detail block exists');
    assert.ok(detail.includes('物理') && detail.includes('52,330') && detail.includes('80.1%'), '物理 with its number and share');
    assert.ok(detail.includes('真实') && detail.includes('13,000') && detail.includes('19.9%'), '真实 with its number and share');
    assert.ok(!detail.includes('法术'), 'a type with zero damage is not listed');
    assert.ok(detail.includes('元素损伤') && detail.includes('护盾吸收'), 'the two non-HP figures are in the detail');
    assert.ok(detail.includes('击杀'), 'and the kill count');
  });

  test('the runner exposes damageReport (read-only, field-scoped)', () => {
    const runner = read('public/js/battle/runner.js');
    assert.match(runner, /damageReport\(playerId = null, fieldId = null\)/);
    assert.match(runner, /e\.sim\.spec\.damageReport\(e\.battle, playerId\)/);
    assert.match(runner, /if \(!e \|\| !e\.sim \|\| !e\.battle \|\| \(fieldId != null && e\.fieldId !== fieldId\)\) return null;/);
  });

  test('the server accumulates the match-long totals per operator and sends them in m.private', () => {
    const ps = read('server/match/PlayerState.js');
    const round = read('server/match/player/round.js');
    const views = read('server/match/player/views.js');
    assert.match(ps, /this\.cumStats = new Map\(\);/);
    assert.match(round, /_addCumStats\(pp\)/);
    assert.match(round, /cumStatsView\(\)/);
    assert.match(views, /cumStats: this\.cumStatsView\(\),/);
    // every battle result the match accepts folds in: own field, 联防 field, boss field
    assert.match(read('server/match/match/combat.js'), /if \(ps && pp\) ps\._addCumStats\(pp\);/);
    assert.match(read('server/match/match/bossRounds.js'), /ps\._addCumStats\(pp\);/);
    assert.match(read('server/match/match/settle.js'), /ps\._addCumStats\(up\);/);
    // keyed by the BASE chess id: a merge / 升华 builds a new uid AND the elite id, so neither can be the key
    assert.match(round, /const b = base\(p\.id\);/);
    assert.match(round, /byUid\.set\(p\.uid, b\)/);
    assert.match(round, /this\.gd\.baseIdOf\(id\)/);
  });

  test('the sim tracks all three metrics and the snapshot carries them', () => {
    const spec = read('server/sim/spec.js');
    assert.match(spec, /row\.dmg \+= Number\(st\.dmg\) \|\| 0;/);
    assert.match(spec, /row\.taken \+= Number\(st\.taken\) \|\| 0;/);
    assert.match(spec, /row\.heal \+= Number\(st\.heal\) \|\| 0;/);
    assert.match(spec, /if \(row\.dmg > 0 \|\| row\.taken > 0 \|\| row\.heal > 0\) out\.push\(row\);/);
    const snap = read('server/sim/snapshot.js');
    assert.match(snap, /\[u\.id, dealt, taken, healed, Math\.max\(0, Math\.trunc\(Number\(u\.stats\.kills\) \|\| 0\)\), fold\]/);
  });

  test('the panel\'s CSS is in game-panels.css, next to the other HUD plates', () => {
    const css = read('public/css/screens/game-panels.css');
    assert.match(css, /\.dmgrep \{/);
    assert.match(css, /\.dmgrep__total \{/);
    assert.match(css, /\.dmgrow__fill \{/);
    assert.match(css, /\.gm__dmgrep \{/);
    // the metric switch and its three accents
    assert.match(css, /\.dmgrep__tabs \{/);
    for (const cls of ['dmg', 'taken', 'heal']) assert.match(css, new RegExp(`\\.dmgrep__tab--${cls}\\.is-on`), cls);
    for (const cls of ['taken', 'heal']) assert.match(css, new RegExp(`\\.dmgrow--${cls} \\.dmgrow__fill`), cls);
    // the corner button keeps the gear size the corner row lays out
    assert.match(read('public/css/screens/game.css'), /\.gm__gear \{\n {2}width: \.56rem; height: \.56rem;/);
  });

  test('every panel string is a translated msgid', () => {
    const en = JSON.parse(read('public/i18n/en.json'));
    const keys = [
      '伤害统计', '累计伤害', '随当前视角同步', '干员 / 伤害占比', '实际伤害', '统计口径', '未知单位', '含召唤',
      '本次战斗还没有统计数据', '实时累计', '已冻结',
      // the new metrics and the cumulative view
      '伤害', '承伤', '治疗', '累计承伤', '累计治疗', '干员 / 承伤占比', '干员 / 治疗占比', '承受伤害', '治疗量',
      '本局累计', '本局至今', '统计项目', '本局还没有统计数据',
    ];
    for (const k of keys) assert.ok(en[k], `en.json lacks ${k}`);
    for (const m of REPORT_METRICS) for (const s of methodLines(m.id)) assert.ok(en[s], `en.json lacks the ${m.id} method line ${s}`);
    for (const s of methodLines('dmg')) assert.ok(en[s], `en.json lacks the method line ${s}`);
  });
});
