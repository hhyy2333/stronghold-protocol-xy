// test/admin-rooms-perf.test.js — the panel's per-room cost cell (性能消耗) in public/admin/admin.js.
//
// The cell is where the operator actually reads the number, so what is pinned here is what the cell is allowed to
// claim, not how it looks:
//
//   * A room with no match says 未开打 — it never shows a fake 0 %.
//   * A match whose first reading has arrived says 测量中 — totals are known but a RATE is not (a rate needs two
//     readings), and showing "0.0 %" for a busy room would be actively misleading.
//   * A measured rate shows the share, and the bar saturates rather than overflowing past 100 %.
//   * The tooltip names only the buckets that actually spent time, heaviest first — a six-item list of zeroes teaches
//     the operator nothing.
//
// Runs the real perfCell against a DOM stand-in (the same shape test/admin-feedback.test.js uses).
// Run: node test/admin-rooms-perf.test.js

import { test } from 'node:test';
import assert from 'node:assert/strict';

// ---- a DOM stand-in (only what perfCell touches) ------------------------------------------------------------------

class El {
  constructor(tag) {
    this.tagName = String(tag).toUpperCase();
    this.childNodes = [];
    this.parentNode = null;
    this.dataset = {};
    this.style = {};
    this._text = '';
    this._cls = '';
    this.title = '';
    const set = new Set();
    this.classList = {
      add: (...cs) => { for (const c of cs) set.add(c); this._cls = [...set].join(' '); },
      contains: (c) => set.has(c),
      remove: (...cs) => { for (const c of cs) set.delete(c); this._cls = [...set].join(' '); },
      get _s() { return set; },
    };
  }
  set textContent(v) { this._text = String(v ?? ''); this.childNodes = []; }
  get textContent() { return this.childNodes.length ? this.childNodes.map((c) => c.textContent).join('') : this._text; }
  set className(v) {
    this._cls = String(v ?? '');
    const keep = this.classList?._s;
    if (keep) { keep.clear(); for (const c of this._cls.split(/\s+/).filter(Boolean)) keep.add(c); }
  }
  get className() { return this._cls; }
  get children() { return this.childNodes; }
  append(...nodes) { for (const n of nodes) { n.parentNode = this; this.childNodes.push(n); } }
  appendChild(n) { this.append(n); return n; }
  replaceChildren(...nodes) { this.childNodes = []; this.append(...nodes); }
  addEventListener() {}
  querySelector() { return null; }
  querySelectorAll() { return []; }
  matches() { return false; }
  /** Every descendant, for asserting on nested classes. */
  all() { return this.childNodes.flatMap((c) => [c, ...(c.all ? c.all() : [])]); }
}

const byId = new Map();
/** Every id admin.js touches at module scope (the same list test/admin-feedback.test.js keeps): a missing one fails
 *  the import, which is the point — the panel must not be importable in a half-wired state. */
for (const id of ['badge-version', 'badge-state', 'btn-lang', 'btn-logout', 'login', 'login-form', 'login-error', 'token',
  'dashboard', 'stat-sockets', 'stat-sessions', 'stat-clients', 'stat-rooms', 'stat-matches', 'stat-population',
  'stat-cpu', 'stat-load', 'stat-rss', 'stat-heap', 'rooms-count', 'rooms-body', 'announce-text', 'announce-count',
  'announce-status', 'announce-form', 'announce-send', 'announce-withdraw', 'announce-list', 'announce-history',
  'notes-count', 'notes-ver', 'notes-digest', 'notes-text', 'notes-preview', 'notes-form', 'notes-save', 'notes-reset',
  'notes-clear', 'notes-size', 'notes-status', 'log-console', 'foot-build', 'foot-node', 'feedback-list',
  'feedback-count']) byId.set(id, new El('div'));
globalThis.document = {
  documentElement: new El('html'),
  getElementById: (id) => byId.get(id) ?? null,
  createElement: (tag) => new El(tag),
  createTextNode: (t) => { const n = new El('#text'); n.textContent = t; return n; },
  querySelector: () => null,
  querySelectorAll: () => [],
  addEventListener() {},
};
globalThis.window = { addEventListener() {} };
globalThis.sessionStorage = { getItem: () => null, setItem() {}, removeItem() {} };
globalThis.fetch = async () => ({ status: 404, ok: false, json: async () => null });
globalThis.setInterval = () => 0;
globalThis.clearInterval = () => {};
globalThis.location = { search: '' };

const { perfCell } = await import('../public/admin/admin.js');

/** A /api/admin/rooms `perf` object, as server/admin.js builds it. */
const perfOf = (o = {}) => ({
  windowSec: 2,
  totalMs: 1200,
  deltaMs: 40,
  sharePercent: 2,
  matchUptimeSec: 300,
  frames: 9000,
  maxDepth: 2,
  buckets: Object.fromEntries(['battle', 'bots', 'verify', 'serverRun', 'intents', 'views', 'core']
    .map((k) => [k, { ms: 0, sharePercent: null }])),
  ...o,
});

const textOf = (el) => el.all().map((n) => n._text).join(' ');

test('a room with no match says 未开打 and draws no bar', () => {
  const td = perfCell(null);
  assert.match(textOf(td), /未开打/);
  assert.equal(td.all().some((n) => n.classList.contains('perf__bar')), false, 'no bar without a counter');
});

test('a first reading with no rate yet says 测量中 — it never claims 0.0 %', () => {
  const td = perfCell(perfOf({ sharePercent: null, windowSec: 0, deltaMs: 0 }));
  const text = textOf(td);
  assert.match(text, /测量中/);
  assert.ok(!/\d+\.\d+%/.test(text), 'no percentage is shown before one has been measured');
  const bar = td.all().find((n) => n.classList.contains('perf__bar'));
  assert.ok(bar, 'the bar is present as a placeholder');
  assert.ok(bar.classList.contains('perf__bar--warm'), 'drawn in the "not known yet" tone');
  assert.match(text, /累计 1200/, 'the totals that ARE known are still shown');
});

test('a measured rate shows the share and a bar sized against one core', () => {
  const td = perfCell(perfOf({ sharePercent: 12.5 }));
  assert.match(textOf(td), /12\.5% 单核/);
  const fill = td.all().find((n) => n.classList.contains('perf__fill'));
  assert.equal(fill.style.width, '12.5%', 'the bar is the share of ONE core');
  // the tooltip carries the WINDOW total (the share itself is on the cell's own line, in front of the operator)
  assert.match(td.title, /40/, 'the window\'s own total is in the tooltip');
});

test('the bar saturates at 100 % instead of overflowing the cell', () => {
  const fill = perfCell(perfOf({ sharePercent: 340 })).all().find((n) => n.classList.contains('perf__fill'));
  assert.equal(fill.style.width, '100%', 'a room using three cores fills the bar, it does not spill out');
});

test('the tone tracks the load: cool, warm, hot', () => {
  const toneOf = (share) => {
    const bar = perfCell(perfOf({ sharePercent: share })).all().find((n) => n.classList.contains('perf__bar'));
    return ['perf__bar--cool', 'perf__bar--warm', 'perf__bar--hot'].find((c) => bar.classList.contains(c));
  };
  assert.equal(toneOf(1), 'perf__bar--cool');
  assert.equal(toneOf(10), 'perf__bar--warm');
  assert.equal(toneOf(80), 'perf__bar--hot');
});

test('the tooltip names only the buckets that spent time in the window, heaviest first', () => {
  const td = perfCell(perfOf({
    sharePercent: 20,
    buckets: {
      battle: { ms: 5, sharePercent: 0.25 },
      bots: { ms: 90, sharePercent: 4.5 },
      verify: { ms: 0, sharePercent: 0 },
      serverRun: { ms: 2, sharePercent: 0.1 },
      intents: { ms: 1, sharePercent: 0.05 },
      views: { ms: 3, sharePercent: 0.15 },
      core: { ms: 60, sharePercent: 3 },
    },
  }));
  const tip = td.title;
  assert.match(tip, /本窗口：.*AI演练 4\.5%/, 'the heaviest window bucket is named under 本窗口');
  assert.match(tip, /流程 3\.0%/, 'and the next one');
  assert.match(tip, /战场 0\.3%/);
  assert.ok(!/本窗口：[^\n]*校验/.test(tip), 'a bucket that spent nothing in the window is left out of 本窗口');
  assert.ok(tip.indexOf('AI演练') < tip.indexOf('流程'), 'heaviest first');
  assert.match(tip, /9000 次回调/, 'the frame count is reported');
  assert.match(tip, /过去 2 秒/, 'the window is reported');
});

// ---------------------------------------------------------------------------------------------------
// 全程累计 (owner's report 2026-10-14)
// ---------------------------------------------------------------------------------------------------
//
// The screenshot that started this: a room whose counter read 「累计 48831，31915 次回调」 showed a tooltip saying
// 「合计 0」 and nothing else, because the old tip listed only buckets with a WINDOW share > 0 — and a pulse bucket
// (AI rehearsal at the end of a prep turn, take-over when someone is away) is 0 in a given 2-second window while
// dominating the match's whole lifetime. These pin the second view.

test('the tooltip lists the match LIFETIME per bucket, heaviest first by accumulated ms', () => {
  const td = perfCell(perfOf({
    matchUptimeSec: 2940,
    totalMs: 48861,
    frames: 31935,
    sharePercent: 0.1,
    deltaMs: 14,
    // Exactly the live shape that produced 「合计 0」: bots and serverRun are huge in ms but 0 in the window.
    buckets: {
      battle: { ms: 0, sharePercent: 0 },
      bots: { ms: 27526.9, sharePercent: 0 },
      verify: { ms: 0, sharePercent: 0 },
      serverRun: { ms: 12711.01, sharePercent: 0 },
      intents: { ms: 669.06, sharePercent: 0.1 },
      views: { ms: 1751.54, sharePercent: 0.1 },
      core: { ms: 6202.57, sharePercent: 0 },
    },
  }));
  const tip = td.title;
  assert.match(tip, /全程累计：/, 'the lifetime line exists');
  // The two pulse buckets MUST survive the window filter — this is the whole bug.
  assert.match(tip, /全程累计：[^\n]*AI演练 27\.5s/, 'AI演练 is named from its accumulated ms even at a 0 window share');
  assert.match(tip, /托管 12\.7s/, 'and 托管 too');
  assert.match(tip, /流程 6\.2s/, 'the next heaviest');
  assert.match(tip, /视图 1\.8s/);
  assert.match(tip, /操作 669ms/, 'sub-second buckets read in ms');
  assert.ok(!/全程累计：[^\n]*校验/.test(tip), 'a bucket that never spent anything stays out of the lifetime line');
  assert.ok(tip.indexOf('AI演练') < tip.indexOf('托管'), 'heaviest lifetime bucket first');
  assert.match(tip, /对局已跑约 49 分钟/, 'how long the match has been up');
  assert.ok(!/undefined|NaN|\{d\}|\{buckets\}|\{window\}|\{lifetime\}|\{uptime\}|\{minutes\}/.test(tip), `no placeholder or NaN leaks: ${tip}`);
});

test('the SERVER-WIDE aggregate shape (flat bucket numbers, no matchUptimeSec) still renders', () => {
  // GET /api/admin/overview sends `buckets[k] = 12345.6` (a number, not {ms, sharePercent}) and has no single match,
  // so it carries no matchUptimeSec. The overview load card feeds that object to the same renderer.
  const td = perfCell(perfOf({
    sharePercent: 3.2,
    deltaMs: 64,
    totalMs: 91000,
    frames: 42000,
    matchUptimeSec: undefined,
    buckets: { battle: 0, bots: 31000.5, verify: 0, serverRun: 12711, intents: 669, views: 1751, core: 6202 },
  }));
  const tip = td.title;
  assert.match(tip, /全程累计：AI演练 31s · 托管 12\.7s · 流程 6\.2s · 视图 1\.8s · 操作 669ms/, 'flat numbers are read too');
  assert.match(tip, /本窗口：—/, 'the aggregate carries no per-window share, so that line is an explicit dash');
  assert.ok(!/对局已跑约/.test(tip), 'no per-match uptime is claimed for a server-wide aggregate');
  assert.ok(!/undefined|NaN|\{uptime\}/.test(tip), `no placeholder leaks: ${tip}`);
});

test('a busy room no longer reports 「合计 0」 with an empty breakdown', () => {
  // The exact regression: a big counter + a quiet window must still describe where the time went.
  const td = perfCell(perfOf({
    sharePercent: 0.1, deltaMs: 14, totalMs: 48831, frames: 31915, matchUptimeSec: 2942,
    buckets: Object.fromEntries(['battle', 'bots', 'verify', 'serverRun', 'intents', 'views', 'core']
      .map((k) => [k, { ms: k === 'bots' ? 27526 : 0, sharePercent: k === 'bots' ? 0 : 0 }])),
  }));
  const tip = td.title;
  assert.ok(!/合计 0\n\n全程累计：—/.test(tip), 'an empty pair is not the answer for a room with 27 s of AI rehearsal');
  assert.match(tip, /AI演练 27\.5s/, 'the lifetime view answers it');
});

test('a match with no bucket measured says so rather than printing an empty list', () => {
  const td = perfCell(perfOf({ sharePercent: null }));
  assert.ok(td.title.length > 0, 'the tooltip is still there');
  assert.ok(!/undefined|NaN/.test(td.title), `no undefined leaks into the tooltip: ${td.title}`);
  assert.match(td.title, /全程累计：—/, 'both views fall back to an explicit dash, never an empty string');
});

test('shortMs: ms under a second, one decimal for every second-scale figure, minutes above a minute', () => {
  // Rounded in the tooltip, so it is pinned through perfTip (shortMs itself is not exported).
  const tipAt = (ms) => perfCell(perfOf({
    buckets: Object.fromEntries(['battle', 'bots', 'verify', 'serverRun', 'intents', 'views', 'core']
      .map((k) => [k, { ms: k === 'views' ? ms : 0, sharePercent: 0 }])),
  })).title;
  assert.match(tipAt(400), /视图 400ms/, 'a sub-second bucket reads in ms');
  assert.match(tipAt(1751.54), /视图 1\.8s/, 'a second-scale bucket keeps one decimal');
  assert.match(tipAt(27526.9), /视图 27\.5s/, 'and keeps it past ten seconds, so two rooms stay comparable');
  assert.match(tipAt(150000), /视图 2m 30s/, 'minutes above a minute');
  assert.match(tipAt(120000), /视图 2m\b/, 'a whole number of minutes drops the seconds');
});
