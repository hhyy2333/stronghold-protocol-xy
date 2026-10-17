// test/admin-feedback.test.js — 玩家反馈: an expanded 诊断信息 must SURVIVE the 2 s poll (public/admin/admin.js).
//
// THE BUG THIS PINS (reported 2026-10-12: 「点击诊断过几秒诊断详细界面会自动关闭」). The panel polls every 2 s and
// re-rendered the whole feedback list with `replaceChildren()` on every poll, so the `<details>` an operator had just
// opened was thrown away and rebuilt closed within two seconds. Reading a long diagnostics report was impossible.
//
// The fix reconciles by the server's own report id: a card already on screen is left untouched (its open <details>,
// its text selection and the scroll position survive), a new report is prepended, and a report the server no longer
// lists is removed. Asserting that means running the REAL renderFeedback against a DOM stand-in — the assertions are
// on node IDENTITY, which is the only way to tell "left alone" from "rebuilt with the same content".
//
// The DOM stand-in deliberately implements childNodes / children / firstElementChild / nextElementSibling /
// insertBefore / dataset / classList, because the reconciler reads all of them. Anything missing here would make the
// test pass for the wrong reason, so `El` also asserts on the operations the fix must NOT use.
// Run: node test/admin-feedback.test.js

import { test, describe, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

// ---- a DOM stand-in ----------------------------------------------------------------------------------------------

class El {
  constructor(tag) {
    this.tagName = String(tag).toUpperCase();
    this.childNodes = [];
    this.parentNode = null;
    this.dataset = {};
    this.style = {};
    this.attributes = {};
    this._text = '';
    this._cls = '';
    this.hidden = false;
    this.disabled = false;
    this.title = '';
    /** The class set, wired to `className` both ways (the panel sets one and reads the other). */
    const set = new Set();
    this.classList = {
      add: (...cs) => { for (const c of cs) set.add(c); this._cls = [...set].join(' '); },
      contains: (c) => set.has(c),
      remove: (...cs) => { for (const c of cs) set.delete(c); this._cls = [...set].join(' '); },
      get _s() { return set; },
    };
    this.className = '';
    /** How many times `replaceChildren` wiped this node — the fix must not do this to the list on a no-op poll. */
    this.wipes = 0;
  }
  set textContent(v) { this._text = String(v ?? ''); this.childNodes = []; }
  get textContent() { return this.childNodes.length ? this.childNodes.map((c) => c.textContent).join('') : this._text; }
  set className(v) {
    this._cls = String(v ?? '');
    const keep = this.classList?._s;
    if (keep) { keep.clear(); for (const c of this._cls.split(/\s+/).filter(Boolean)) keep.add(c); }
  }
  get className() { return this._cls; }
  get children() { return this.childNodes.filter((n) => n.nodeType !== 3); }
  get firstElementChild() { return this.children[0] || null; }
  get childElementCount() { return this.children.length; }
  get nextElementSibling() {
    if (!this.parentNode) return null;
    const sibs = this.parentNode.children;
    return sibs[sibs.indexOf(this) + 1] || null;
  }
  append(...nodes) { for (const n of nodes) { n.parentNode = this; this.childNodes.push(n); } }
  appendChild(n) { this.append(n); return n; }
  insertBefore(n, ref) {
    if (n.parentNode) n.parentNode.removeChild(n);
    n.parentNode = this;
    const i = ref ? this.childNodes.indexOf(ref) : -1;
    if (i < 0) this.childNodes.push(n); else this.childNodes.splice(i, 0, n);
    return n;
  }
  removeChild(c) { const i = this.childNodes.indexOf(c); if (i >= 0) this.childNodes.splice(i, 1); c.parentNode = null; return c; }
  remove() { if (this.parentNode) this.parentNode.removeChild(this); }
  replaceChildren(...nodes) { this.wipes++; this.childNodes = []; this.append(...nodes); }
  setAttribute(k, v) { this.attributes[k] = String(v); }
  removeAttribute(k) { delete this.attributes[k]; }
  addEventListener() {}
  removeEventListener() {}
  querySelector(sel) {
    if (sel === '.empty') return this.children.find((c) => c.classList.contains('empty')) || null;
    return null;
  }
  querySelectorAll() { return []; }
  closest() { return null; }
  matches(sel) { return sel === ':disabled' ? this.disabled : false; }
}

const host = new El('div');
const countEl = new El('span');
/** Every id admin.js touches at module scope, plus the two this suite drives. A missing one fails the import. */
const byId = new Map([
  ['feedback-list', host], ['feedback-count', countEl],
  ...['badge-version', 'badge-state', 'btn-lang', 'btn-logout', 'login', 'login-form', 'login-error', 'token',
    'dashboard', 'stat-sockets', 'stat-sessions', 'stat-clients', 'stat-rooms', 'stat-matches', 'stat-population',
    'stat-cpu', 'stat-load', 'stat-rss', 'stat-heap', 'rooms-count', 'rooms-body', 'announce-text', 'announce-count',
    'announce-status', 'announce-form', 'announce-send', 'announce-withdraw', 'announce-list', 'notes-count',
    'notes-ver', 'notes-digest', 'notes-text', 'notes-preview', 'notes-form', 'notes-save', 'notes-reset',
    'notes-clear', 'notes-size', 'notes-status', 'log-console', 'foot-build', 'foot-node'].map((id) => [id, new El('div')]),
]);

globalThis.document = {
  documentElement: new El('html'),
  getElementById: (id) => byId.get(id) ?? null,
  createElement: (tag) => new El(tag),
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

const { renderFeedback } = await import('../public/admin/admin.js');

// ---- fixtures ---------------------------------------------------------------------------------------------------

/** A report as server/feedback.js stores it (id, at, meta, description, report). */
const report = (id, over = {}) => ({
  id,
  at: Date.parse('2026-10-12T21:18:00+08:00'),
  meta: { room: 'QEBD', version: '0.3.0', phase: 'COMBAT', round: 7, mode: 'coop' },
  description: `反馈 ${id}`,
  report: `诊断正文 ${id}\n第二行`,
  ...over,
});

const detailsOf = (card) => card.children.find((c) => c.tagName === 'DETAILS');
const cardOf = (id) => host.children.find((c) => c.dataset.fbId === id);

beforeEach(() => { host.replaceChildren(); host.wipes = 0; });

describe('玩家反馈: an open 诊断信息 survives the poll', () => {
  test('a poll returning the SAME reports does not touch the DOM (the reported bug)', () => {
    const items = [report('a1'), report('a2'), report('a3')];
    renderFeedback(items);
    assert.equal(host.children.length, 3);

    const cards = host.children.slice();
    const details = cards.map(detailsOf);
    assert.ok(details.every(Boolean), 'every card has its 诊断信息 block');
    details[0].open = true;                 // the operator expands one
    const wipesAfterFirst = host.wipes;

    // Five more polls with identical data — what the panel does over ten seconds.
    for (let i = 0; i < 5; i++) renderFeedback([report('a1'), report('a2'), report('a3')]);

    assert.equal(host.children.length, 3, 'still three cards');
    assert.equal(host.wipes, wipesAfterFirst, 'the list was NOT wiped by an unchanged poll');
    for (let i = 0; i < cards.length; i++) {
      assert.equal(host.children[i], cards[i], `card ${i} is the SAME node (not rebuilt)`);
      assert.equal(detailsOf(host.children[i]), details[i], `card ${i}'s <details> is the same node`);
    }
    assert.equal(details[0].open, true, 'and the opened one is STILL OPEN');
  });

  test('a new report is prepended; the cards already on screen keep their identity and open state', () => {
    renderFeedback([report('b1'), report('b2')]);
    const [c1, c2] = host.children.slice();
    detailsOf(c1).open = true;

    renderFeedback([report('b0'), report('b1'), report('b2')]);   // b0 is newer, so it comes first

    assert.equal(host.children.length, 3);
    assert.equal(host.children[0].dataset.fbId, 'b0', 'the new report is at the top (newest first)');
    assert.equal(host.children[1], c1, 'b1 is the same node');
    assert.equal(host.children[2], c2, 'b2 is the same node');
    assert.equal(detailsOf(c1).open, true, 'the open one stayed open through the insertion');
    assert.equal(countEl.textContent, '3', 'the count follows the list');
  });

  test('a report the server no longer lists is removed, the rest untouched', () => {
    renderFeedback([report('c1'), report('c2'), report('c3')]);
    const c1 = cardOf('c1');
    const c3 = cardOf('c3');
    detailsOf(c3).open = true;

    renderFeedback([report('c1'), report('c3')]);   // c2 aged out

    assert.equal(host.children.length, 2);
    assert.equal(cardOf('c2'), undefined, 'the dropped report is gone');
    assert.equal(cardOf('c1'), c1, 'c1 is the same node');
    assert.equal(cardOf('c3'), c3, 'c3 is the same node');
    assert.equal(detailsOf(c3).open, true, 'and its open 诊断信息 survived');
  });

  test('an empty poll shows the empty row once, and does not wipe it on every later poll', () => {
    renderFeedback([]);
    assert.equal(host.children.length, 1);
    assert.ok(host.children[0].classList.contains('empty'), 'the dashed empty row');
    const before = host.wipes;
    renderFeedback([]);
    renderFeedback([]);
    assert.equal(host.wipes, before, 'an empty poll does not keep rebuilding the empty row');
  });

  test('the empty row is replaced by real reports, and comes back when they go away', () => {
    renderFeedback([]);
    renderFeedback([report('d1')]);
    assert.equal(host.children.length, 1);
    assert.equal(cardOf('d1').dataset.fbId, 'd1');
    assert.equal(host.querySelector('.empty'), null, 'the empty row was taken down');
    detailsOf(cardOf('d1')).open = true;
    renderFeedback([]);
    assert.ok(host.children[0].classList.contains('empty'), 'back to the empty row');
  });
});

describe('玩家反馈: the reconciler is robust about what the server sends', () => {
  test('a record with no id still renders, and a repeat poll does not duplicate it', () => {
    // An older / hand-edited line has no id. It must appear, and it must not be re-added on every 2 s poll.
    const noId = { at: 1_760_000_000_000, description: '手改的行', report: 'x' };
    renderFeedback([noId]);
    assert.equal(host.children.length, 1);
    const first = host.children[0];
    renderFeedback([noId]);
    renderFeedback([noId]);
    assert.equal(host.children.length, 1, 'no duplicate cards for an id-less record');
    assert.equal(host.children[0], first, 'literally the same node');
  });

  test('two id-less records at the same timestamp stay distinct', () => {
    const at = 1_760_000_000_000;
    renderFeedback([{ at, description: '第一条', report: 'aa' }, { at, description: '第二条', report: 'bbbb' }]);
    assert.equal(host.children.length, 2, 'they are two different reports, not one');
    assert.notEqual(host.children[0].dataset.fbId, host.children[1].dataset.fbId);
  });

  test('a report without a 诊断正文 gets no <details> (nothing to open, nothing to snap shut)', () => {
    renderFeedback([report('e1', { report: '' })]);
    assert.equal(detailsOf(cardOf('e1')), undefined);
    assert.ok(cardOf('e1').children.some((c) => c.classList.contains('fb__desc')), 'its words are still shown');
  });

  test('the chips are built from the meta block, tolerating one that is missing', () => {
    renderFeedback([report('f1'), report('f2', { meta: undefined })]);
    const chips = cardOf('f1').children[0].children.filter((c) => c.classList.contains('fb__chip'));
    assert.deepEqual(chips.map((c) => c.textContent), ['#QEBD', 'v0.3.0', 'COMBAT · R7', 'coop']);
    assert.equal(cardOf('f2').children.length >= 1, true, 'a report with no meta still renders its card');
  });

  test('the newest report always ends up first, however the list arrives', () => {
    renderFeedback([report('g2'), report('g3')]);
    renderFeedback([report('g1'), report('g2'), report('g3')]);   // g1 arrives late but is newest
    assert.deepEqual(host.children.map((c) => c.dataset.fbId), ['g1', 'g2', 'g3']);
  });
});
