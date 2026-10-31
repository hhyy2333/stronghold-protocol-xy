// test/ui/damageReportDps.test.js — 伤害统计面板的第四个指标「秒伤」(DPS)，第 16 回合木桩演练要读的那个数。
//
// 要守住的东西：
//   * 指标顺序 伤害 / 秒伤 / 承伤 / 治疗（秒伤紧跟伤害）；
//   * 秒伤＝该行 dmg ÷ 本场战斗时长 elapsed，排行按这个数降序；elapsed 是**调用方**给的，面板不读时钟；
//   * elapsed 为 null / 0 / 负数 / NaN 时：不崩、秒伤格显示占位「—」、排行回退按 dmg（不是按 0 重排）；
//   * 合计 = Σdmg ÷ elapsed（同一段时长），取整与其它指标一致；
//   * 渲染输出里没有 NaN / Infinity（没有时长时最容易漏掉的那种坏数字）；
//   * 秒伤行的占比仍然按 dmg ÷ Σdmg（elapsed 约掉），不引入第二套归一；
//   * 面板保持纯视图：不读时钟，时长只从 props 来。
//
// Run: node test/ui/damageReportDps.test.js
//      （本沙箱里 `node --test` 会 spawn EPERM，必须直接 node 跑文件）

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  DamageReportPanel, DamageReportRow, rankRows, reportTotal, metricValue, dpsOf, elapsedSec, metricOf,
  methodLines, REPORT_METRICS,
} from '../../public/js/ui/damageReport.js';

const read = (url) => readFileSync(new URL(url, import.meta.url), 'utf8');

/**
 * Text of a vnode tree in document order — the repo convention (test/ui/damageReport.test.js): the tree is walked,
 * never rendered, so a pure component can be called directly.
 */
function* walk(v) {
  if (Array.isArray(v)) { for (const x of v) yield* walk(x); return; }
  if (!v || typeof v !== 'object') return;
  yield v;
  yield* walk(v.props?.children);
}
const textOf = (v) => [...walk(v)].map((n) => n.props?.children).flat()
  .filter((c) => typeof c === 'string' || typeof c === 'number').join('');
/** The row vnodes a panel rendered (their props are the rows). */
const rowVnodes = (v) => [...walk(v)].filter((n) => n.type === DamageReportRow);

/** 三名干员：甲 900 伤害，乙 300 伤害（还击杀 1），丙 0 伤害 / 500 治疗（伤害栏里不该出现）。 */
const rows = [
  { key: 'u1', uid: 1, kind: 'op', defId: 'chess_a', name: '甲', ownerId: 'p1', dmg: 900, taken: 0, heal: 0, kills: 0, folded: 0 },
  { key: 'u2', uid: 2, kind: 'op', defId: 'chess_b', name: '乙', ownerId: 'p1', dmg: 300, taken: 0, heal: 0, kills: 1, folded: 0 },
  { key: 'u3', uid: 3, kind: 'op', defId: 'chess_c', name: '丙', ownerId: 'p1', dmg: 0, taken: 0, heal: 500, kills: 0, folded: 0 },
];

describe('秒伤 metric: the record and the helpers', () => {
  test('指标顺序：秒伤紧跟在伤害之后', () => {
    assert.deepEqual(REPORT_METRICS.map((m) => m.id), ['dmg', 'dps', 'taken', 'heal']);
    const dps = metricOf('dps');
    assert.equal(dps.label, '秒伤');
    assert.equal(dps.perSecond, true, 'marked as a per-second metric (it divides by elapsed)');
    assert.equal(dps.field, 'dmg', 'rows carry no dps field: the number is derived from dmg at draw time');
    assert.ok(dps.total && dps.column && dps.value, 'it has its own captions');
    assert.ok(methodLines('dps').length >= 3, 'and its own 统计口径 lines');
    assert.ok(methodLines('dps').some((s) => s.includes('秒伤')), JSON.stringify(methodLines('dps')));
  });

  test('elapsedSec: 只认正数，其余一律「没有时长」', () => {
    assert.equal(elapsedSec(12.5), 12.5);
    assert.equal(elapsedSec(null), null);
    assert.equal(elapsedSec(undefined), null);
    assert.equal(elapsedSec(0), null, 'a battle on its first frame has no length yet');
    assert.equal(elapsedSec(-3), null);
    assert.equal(elapsedSec(NaN), null);
    assert.equal(elapsedSec(Infinity), null);
  });

  test('dpsOf / metricValue: 秒伤＝伤害 ÷ 时长，没有时长时是 null 而不是 0', () => {
    assert.equal(dpsOf(900, 3), 300);
    assert.equal(dpsOf(900, null), null, 'null, not 0: "unknown" is not "dealt nothing"');
    assert.equal(dpsOf(900, 0), null);
    const row = rows[0];
    assert.equal(metricValue(row, 'dps', 3), 300);
    assert.equal(metricValue(row, 'dps', null), null);
    assert.equal(metricValue(row, 'dmg', null), 900, 'the other metrics never divide');
  });
});

describe('秒伤 排行与合计', () => {
  test('rankRows(dps): 按 dmg/elapsed 降序，没有伤害的行不出现', () => {
    const list = rankRows(rows, 'dps', { elapsed: 3 });
    assert.deepEqual(list.map((r) => r.key), ['u1', 'u2'], '丙 (0 dmg) has no 秒伤 row');
    assert.equal(metricValue(list[0], 'dps', 3), 300);
    assert.equal(metricValue(list[1], 'dps', 3), 100);
    assert.ok(metricValue(list[0], 'dps', 3) > metricValue(list[1], 'dps', 3));
    // a different battle length keeps the order (elapsed is one constant) but moves every number
    const short = rankRows(rows, 'dps', { elapsed: 2 });
    assert.deepEqual(short.map((r) => r.key), ['u1', 'u2']);
    assert.equal(metricValue(short[0], 'dps', 2), 450);
  });

  test('elapsed 为 null / 0 / 坏数时：排行回退按 dmg，不按 0 重排', () => {
    const byDmg = rankRows(rows, 'dmg').map((r) => r.key);
    for (const bad of [null, undefined, 0, -1, NaN, Infinity]) {
      const list = rankRows(rows, 'dps', { elapsed: bad });
      assert.deepEqual(list.map((r) => r.key), byDmg, `elapsed=${String(bad)} falls back to dmg order`);
      for (const r of list) assert.equal(metricValue(r, 'dps', bad), null, 'every 秒伤 cell is a placeholder');
    }
    // and metricValue never yields a bad number on its own
    for (const r of rows) for (const bad of [null, 0, NaN]) {
      const v = metricValue(r, 'dps', bad);
      assert.ok(v === null || Number.isFinite(v), `metricValue(${r.key}, dps, ${String(bad)}) = ${v}`);
    }
  });

  test('reportTotal(dps) = Σdmg ÷ elapsed（取整与其它指标一致）', () => {
    assert.equal(reportTotal(rows, 'dps', null, 4), 300, '(900 + 300) / 4');
    assert.equal(reportTotal(rows, 'dps', null, 3), 400, '1200 / 3');
    assert.equal(reportTotal(rows, 'dmg'), 1200, 'the damage total itself does not change');
    // 3 人分担的不同份额，合计仍然只按「同一段时长」除一次
    assert.equal(reportTotal(rows.slice(0, 2), 'dps', ['p1'], 8), 150, '1200 / 8, the 联防 half filter still applies');
    // 没有时长：0 是 reportTotal 的回答，面板会把它画成「—」（见下面的渲染断言）
    assert.equal(reportTotal(rows, 'dps', null, null), 0);
  });

  test('秒伤行的占比仍是 dmg ÷ Σdmg（elapsed 约掉，不引入第二套归一）', () => {
    const tree = DamageReportPanel({ rows, metric: 'dps', elapsed: 4, round: 1 });
    const txt = textOf(tree);
    const nodes = rowVnodes(tree);
    assert.deepEqual(nodes.map((n) => n.props.row.key), ['u1', 'u2']);
    assert.ok(txt.includes('300'), `the team dps total: ${txt}`);
    // 每一行都给到了时长，行自己会把 dmg 除出来
    assert.ok(nodes.every((n) => n.props.elapsed === 4), 'the panel hands elapsed down to every row');
    // 行的 markup 要直接调行组件才看得到（vnode 的 props 不是 children）：甲的 900 / 4 s = 225，占 900/1200 = 75 %
    const a = textOf(DamageReportRow({ row: rows[0], rank: 1, total: 300, metric: 'dps', elapsed: 4, shareTotal: 1200 }));
    assert.ok(a.includes('225'), a);
    assert.ok(a.includes('75%'), a);
    const b = textOf(DamageReportRow({ row: rows[1], rank: 2, total: 300, metric: 'dps', elapsed: 4, shareTotal: 1200 }));
    assert.ok(b.includes('75') && b.includes('25%'), b);
    // 同一行在 伤害 栏里的占比一模一样：秒伤没有引入第二套归一
    const dmgRow = textOf(DamageReportRow({ row: rows[0], rank: 1, total: 1200, metric: 'dmg', elapsed: 4 }));
    assert.ok(dmgRow.includes('75%'), dmgRow);
    assert.ok(dmgRow.includes('900'), dmgRow);
  });
});

describe('渲染：没有时长时不能出现 NaN / Infinity', () => {
  test('未传 elapsed：秒伤列与合计都是「—」，没有战斗时长那行', () => {
    const tree = DamageReportPanel({ rows, metric: 'dps', round: 1 });
    const txt = textOf(tree);
    assert.ok(!/NaN|Infinity/.test(txt), `no bad numbers in the output: ${txt}`);
    assert.ok(txt.includes('—'), `the placeholder: ${txt}`);
    const hasDuration = [...walk(tree)].some((n) => n.props?.['data-testid'] === 'damage-report-duration');
    assert.equal(hasDuration, false, 'no 战斗时长 line without a length');
    assert.ok(!txt.includes('NaN') && !txt.includes('undefined'), txt);
    // 排行仍然按 dmg（秒伤没有时长时不住排序）
    assert.deepEqual(rowVnodes(tree).map((n) => n.props.row.key), ['u1', 'u2']);
    // 行自己渲染时同样不能崩
    const row = DamageReportRow({ row: rows[0], rank: 1, total: null, metric: 'dps' });
    const rowTxt = textOf(row);
    assert.ok(!/NaN|Infinity/.test(rowTxt), rowTxt);
    assert.ok(rowTxt.includes('—'), rowTxt);
  });

  test('elapsed 为 0 / 负数 / NaN：与「没传」完全一样', () => {
    for (const bad of [0, -1, NaN]) {
      const txt = textOf(DamageReportPanel({ rows, metric: 'dps', elapsed: bad, round: 1 }));
      assert.ok(!/NaN|Infinity/.test(txt), `elapsed=${String(bad)}: ${txt}`);
      assert.ok(txt.includes('—'), `elapsed=${String(bad)}: ${txt}`);
    }
  });

  test('有 elapsed：面板写出战斗时长，秒伤列是 dmg ÷ 时长', () => {
    const tree = DamageReportPanel({ rows, metric: 'dps', elapsed: 4, round: 1 });
    const txt = textOf(tree);
    assert.ok(txt.includes('战斗时长 4.0 秒'), txt);
    assert.ok(txt.includes('300'), `the team dps total 1200 / 4 s: ${txt}`);
    assert.ok(!/NaN|Infinity/.test(txt), txt);
    const dur = [...walk(tree)].find((n) => n.props?.['data-testid'] === 'damage-report-duration');
    assert.ok(dur, 'the battle length has its own line');
    // 行的数字（vnode 的 props 不是 children，所以直接调行组件）
    const row = textOf(DamageReportRow({ row: rows[0], rank: 1, total: 300, metric: 'dps', elapsed: 4, shareTotal: 1200 }));
    assert.ok(row.includes('225'), `甲 900 / 4 s = 225: ${row}`);
    assert.ok(!/NaN|Infinity/.test(row), row);
  });

  test('面板是纯视图：不读时钟，时长只从 props 来', () => {
    const src = read('../../public/js/ui/damageReport.js');
    assert.doesNotMatch(src, /Date\.now|performance\.now|new Date\(/, 'the panel must not read a clock');
    const game = read('../../public/js/screens/game.js');
    // 调用方把时长传进去，并且和行一起冻结（冻结后 elapsed 不能再涨）
    assert.match(game, /elapsed=\$\{reportElapsed\}/);
    assert.match(game, /elapsed: liveElapsed \}/, 'the frozen report snapshots elapsed next to its rows');
  });
});
