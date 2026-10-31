// 破财消灾 的按钮与两击确认（业主 2026-10-30「修复」；按钮本身是 2026-10-25 加的）。
//
// 它是一个**负索引伪卡**：不在 `sp.cards` 里、不进 `taken`、每个玩家各能用一次。这里守的是客户端的那个坑 ——
// `ChoiceOverlay.tap()` 原本一律拿 `sp.cards.find(idx)` 交给 `cardPickable()`，-1 找不到牌 ⇒ pickable 恒为 false
// ⇒ `spTap()` 原样返回，按钮亮着却**既选不中也发不出去**（服务端那套 `g.choice { idx: -1 }` 从来没有被调用过）。
// 现在 tap 走 `payoffPickable()`，两击（选中 → 确认）与真卡一致。

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const read = (p) => readFileSync(path.join(ROOT, p), 'utf8');

// the browser data store reads the real data files from disk (the card renders below)
globalThis.fetch = async (url) => {
  const name = String(url).split('/').pop();
  try {
    return { ok: true, status: 200, json: async () => JSON.parse(read(`data/${name}`)) };
  } catch {
    return { ok: false, status: 404, json: async () => ({}) };
  }
};

const { ChoiceView, spTap, payoffPickable, armedCard, cardPickable } = await import('../../public/js/ui/choiceOverlay.js');

const PAYOFF = -1;

/** Every vnode of a preact tree (htm output), depth first; hook-free components are expanded in place. */
function* walk(v, expand = new Set()) {
  if (Array.isArray(v)) { for (const x of v) yield* walk(x, expand); return; }
  if (!v || typeof v !== 'object') return;
  yield v;
  if (typeof v.type === 'function' && expand.has(v.type.name)) { yield* walk(v.type(v.props), expand); return; }
  yield* walk(v.props?.children, expand);
}
const textOf = (v) => {
  if (v == null || typeof v === 'boolean') return '';
  if (typeof v === 'string' || typeof v === 'number') return String(v);
  if (Array.isArray(v)) return v.map(textOf).join('');
  return typeof v === 'object' ? textOf(v.props?.children) : '';
};
const hasClass = (v, c) => typeof v?.props?.class === 'string' && v.props.class.split(/\s+/).includes(c);

/** A 悬赏决策 draft as `normalizeSp()` hands it to the overlay. */
const sp = (o = {}) => ({
  family: 'bounty', name: '悬赏决策', desc: '', untimed: true, order: ['me', 'p2'], turnPid: 'me',
  pickOf: new Map(), cards: [{ idx: 0, name: 'A', desc: 'a', takenBy: null }, { idx: 1, name: 'B', desc: 'b', takenBy: null }],
  payoff: { idx: PAYOFF, cost: 1 },
  ...o,
});
const me = { myId: 'me', solo: false };
const pub = { players: [{ playerId: 'me', seat: 0, name: 'Me' }, { playerId: 'p2', seat: 1, name: 'P2' }], deadline: 0 };

test('破财消灾: payoffPickable is 「轮到我 + 还没选 + 没有请求在飞」, and only when the draft offers it', () => {
  const s = sp();
  assert.equal(payoffPickable(s, me), true);
  assert.equal(payoffPickable(s, { myId: 'p2', solo: false }), false, 'not my turn');
  assert.equal(payoffPickable(sp({ pickOf: new Map([['me', 0]]) }), me), false, 'I already picked');
  assert.equal(payoffPickable(s, { ...me, busyIdx: PAYOFF }), false, 'a pick is in flight');
  assert.equal(payoffPickable(sp({ payoff: null }), me), false, 'a non-bounty draft has none');
  assert.equal(payoffPickable(s, { myId: 'me', solo: true }), true, 'solo is always my turn');
  assert.equal(payoffPickable(null, me), false);
  assert.equal(payoffPickable(s, {}), false, 'no player id yet');
});

test('破财消灾: two taps — the first selects it, the second sends g.choice { idx: -1 }', () => {
  const s = sp();
  // the failure mode this guards: the pseudo card is NOT in `sp.cards`, so the card-based gate says no
  assert.equal(s.cards.find((c) => c.idx === PAYOFF), undefined, 'premise: not a drafted card');
  assert.equal(cardPickable(s, undefined, me), false, 'premise: the old path had nothing to judge');

  // `ChoiceOverlay.tap(-1)` now feeds `payoffPickable` to `spTap` instead of that false
  let r = spTap(null, PAYOFF, payoffPickable(s, me));
  assert.deepEqual(r, { armed: PAYOFF, pick: null }, 'first tap: selected, nothing sent');
  const armed = armedCard(r.armed, s, me);
  assert.equal(armed, PAYOFF, 'the selection survives the re-render (armedCard knows the pseudo card)');
  r = spTap(armed, PAYOFF, payoffPickable(s, me));
  assert.deepEqual(r, { armed: null, pick: PAYOFF }, 'second tap: sent');
});

test('破财消灾: the selection drops the moment the button would be disabled', () => {
  const s = sp();
  assert.equal(armedCard(PAYOFF, s, me), PAYOFF);
  assert.equal(armedCard(PAYOFF, sp({ pickOf: new Map([['me', PAYOFF]]) }), me), null, 'already picked');
  assert.equal(armedCard(PAYOFF, s, { ...me, busyIdx: PAYOFF }), null, 'request in flight');
  assert.equal(armedCard(PAYOFF, s, { myId: 'p2', solo: false }), null, 'no longer my turn');
  assert.equal(armedCard(PAYOFF, sp({ payoff: null }), me), null, 'no payoff on this round');
});

test('破财消灾: the overlay draws it under the grid, says the money leaves next round, and taps back -1', () => {
  const taps = [];
  const armedNone = [...walk(ChoiceView({ pub, sp: sp(), ...me, onTap: (i) => taps.push(i) }))];
  const btn = armedNone.find((n) => hasClass(n, 'spov__payoff'));
  assert.ok(btn, 'a payoff button is drawn on a bounty draft');
  assert.equal(btn.props.disabled, false, 'tappable on my turn');
  assert.match(btn.props['aria-label'], /下回合开始支付 1 资金/, 'the label names WHEN the 1 资金 is charged');
  assert.match(textOf(btn), /下回合开始支付 1 资金/);
  btn.props.onClick();
  assert.deepEqual(taps, [PAYOFF], 'the button hands the pseudo index to the overlay');

  // armed: solid frame + the same 确认选择 · 再次点击 strip the cards get
  const armed = [...walk(ChoiceView({ pub, sp: sp(), ...me, armed: PAYOFF, onTap: () => {} }))];
  assert.ok(armed.some((n) => hasClass(n, 'spov__payoff') && hasClass(n, 'is-armed')));
  assert.ok(armed.some((n) => hasClass(n, 'spcard__confirm')), 'the confirm strip');

  // after my pick / on someone else's turn: drawn but disabled, and a non-bounty round does not draw it at all
  const picked = [...walk(ChoiceView({ pub, sp: sp({ pickOf: new Map([['me', PAYOFF]]) }), ...me }))];
  assert.equal(picked.find((n) => hasClass(n, 'spov__payoff')).props.disabled, true, 'done picking');
  const other = [...walk(ChoiceView({ pub, sp: sp({ turnPid: 'p2' }), ...me }))];
  assert.equal(other.find((n) => hasClass(n, 'spov__payoff')).props.disabled, true, 'not my turn');
  const plain = [...walk(ChoiceView({ pub, sp: sp({ family: 'supply', payoff: null }), ...me }))];
  assert.equal(plain.some((n) => hasClass(n, 'spov__payoff')), false, 'no payoff outside a 悬赏决策 round');
});
