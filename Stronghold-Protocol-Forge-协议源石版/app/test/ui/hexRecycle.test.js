// test/ui/hexRecycle.test.js — 协议源石 · 刷新 (业主 2026-10-30 原话「在第6回合玩家可以舍弃1-2个协议源石随机获得相同数量的
// 协议源石」，2026-10-31 改成界面：「不要按钮形式，你就搞个界面把有的协议源石放上去点击刷新」「就是选完协议源石，这面板
// 直接出现，用协议源石的界面也行」): the client half of `g.hexRecycle`.
//
// 这一手没有角落按钮：窗口一开面板自己出现，把已拥有的每一张铺成卡，点哪张刷哪张（每局 2 次）。所以这里钉的是
//   * 窗口判据 `hexRecycleAvailable`：第 6 回合 / 存活 / 还有次数 / 至少拥有一张 / (HEX_DRAFT 已选完 或 PREP)；
//   * 剩余次数 `hexRecycleLeft`：读行上的 `hexRecycleLeft`，缺省按 `HEX_RECYCLE_BUDGET`（2）；
//   * 点卡能不能点 `recycleCanRefresh`：还有次数、且没有别的卡在飞；
//   * 面板 `HexRecyclePanel` 是**纯视图**（props 进、回调出，没有 DOM、没有 hooks），所以组件直接当函数调、vnode 树当普通
//     对象读（与 test/ui/hextechDraft.test.js 同一条路子）。
//
// 「PREP 且未准备」里的「未准备」不在这个纯函数的入参里（`priv.ready` 是 m.private 的东西），由 screens/game.js 补在判据
// 外面 —— 下面有一条专门钉住这条缝。

import test from 'node:test';
import assert from 'node:assert/strict';
import { PHASE } from '../../shared/constants.js';
import { HEX_RECYCLE_BUDGET } from '../../shared/hextech.js';
import * as hexOverlay from '../../public/js/ui/hexOverlay.js';
import {
  HEX_RECYCLE_ROUND, RECYCLE_FLASH_MS, playerRowOf, ownHexIds, hexRecycleLeft, draftPicked,
  hexRecycleWindow, hexRecycleAvailable, recycleCanRefresh, recycleCardsOf, HexCard, HexRecyclePanel,
} from '../../public/js/ui/hexOverlay.js';
import { Button } from '../../public/js/ui/components.js';

/** A m.public frame of round 6: the viewer's own row carries `hexes` and `hexRecycleLeft`. */
function pubWith(row = {}, extra = {}) {
  return {
    phase: PHASE.PREP,
    round: HEX_RECYCLE_ROUND,
    players: [{ playerId: 'p_0', name: 'me', alive: true, hexes: ['hex_stipend', 'hex_armor'], hexRecycleLeft: 2, ...row }],
    ...extra,
  };
}

/** A m.public frame of the 协议源石 draft, with the viewer's own pick (null = not picked yet). */
function draftPub({ pick = 0, extraLeft = 0, row = {}, extra = {} } = {}) {
  const hex = { offers: { p_0: [{ idx: 0 }, { idx: 1 }, { idx: 2 }] }, picks: pick == null ? {} : { p_0: pick } };
  if (extraLeft) hex.extraPicksLeft = { p_0: extraLeft };
  return { ...pubWith(row, extra), phase: PHASE.HEX_DRAFT, hex };
}

/** Every vnode of `type` in a tree, in document order. */
function findAll(node, type, out = []) {
  if (Array.isArray(node)) { for (const x of node) findAll(x, type, out); return out; }
  if (!node || typeof node !== 'object') return out;
  if (node.type === type) out.push(node);
  findAll(node.props?.children, type, out);
  return out;
}

/** Every node whose class list holds `cls`. */
function findAllByClass(node, cls, out = []) {
  if (Array.isArray(node)) { for (const x of node) findAllByClass(x, cls, out); return out; }
  if (!node || typeof node !== 'object') return out;
  const own = String(node.props?.class ?? '').split(/\s+/);
  if (own.includes(cls)) out.push(node);
  findAllByClass(node.props?.children, cls, out);
  return out;
}

const CARDS = recycleCardsOf(['hex_stipend', 'hex_armor'], {
  hex_stipend: { id: 'hex_stipend', name: '战备津贴', desc: '获得时立即得到 3 资金。', rarity: 'silver' },
  hex_armor: { id: 'hex_armor', name: '反击装甲', desc: '防御 +15%。', rarity: 'gold' },
});

// ---- 剩余次数 ------------------------------------------------------------------------------------------------

test('hexRecycleLeft: 读行上的 hexRecycleLeft，缺省按每局 2 次', () => {
  assert.equal(HEX_RECYCLE_BUDGET, 2, 'the one number the server and this panel share');
  assert.equal(hexRecycleLeft(pubWith({ hexRecycleLeft: 2 }), 'p_0'), 2);
  assert.equal(hexRecycleLeft(pubWith({ hexRecycleLeft: 1 }), 'p_0'), 1);
  assert.equal(hexRecycleLeft(pubWith({ hexRecycleLeft: 0 }), 'p_0'), 0);
  // 第 6 回合的帧里没有这个键（老服务端 / 混合部署）⇒ 按满额，不是「一上来就用完了」
  const noKey = pubWith();
  delete noKey.players[0].hexRecycleLeft;
  assert.equal(hexRecycleLeft(noKey, 'p_0'), HEX_RECYCLE_BUDGET);
  // 坏值：夹到 0…BUDGET
  assert.equal(hexRecycleLeft(pubWith({ hexRecycleLeft: 9 }), 'p_0'), HEX_RECYCLE_BUDGET);
  assert.equal(hexRecycleLeft(pubWith({ hexRecycleLeft: -3 }), 'p_0'), 0);
  assert.equal(hexRecycleLeft(pubWith({ hexRecycleLeft: 1.7 }), 'p_0'), 1);
  assert.equal(hexRecycleLeft(pubWith({ hexRecycleLeft: 'x' }), 'p_0'), HEX_RECYCLE_BUDGET);
  // 没有自己那一行（观战 / 已淘汰）
  assert.equal(hexRecycleLeft(pubWith(), 'spec_1'), 0);
  assert.equal(hexRecycleLeft(null, 'p_0'), 0);
});

// ---- 窗口的两个时刻 ------------------------------------------------------------------------------------------

test('draftPicked: 抽卡阶段「自己已经选完」（picks 落下、也没欠着额外选牌）', () => {
  assert.equal(draftPicked(draftPub({ pick: 0 }), 'p_0'), true, 'idx 0 是合法槽位');
  assert.equal(draftPicked(draftPub({ pick: 2 }), 'p_0'), true);
  assert.equal(draftPicked(draftPub({ pick: null }), 'p_0'), false, '还没选');
  assert.equal(draftPicked(draftPub({ pick: 1, extraLeft: 1 }), 'p_0'), false, '欠着一手额外选牌 ⇒ 不算选完');
  assert.equal(draftPicked(draftPub({ pick: 1, extraLeft: 0 }), 'p_0'), true);
  assert.equal(draftPicked({}, 'p_0'), false);
  assert.equal(draftPicked(null, 'p_0'), false);
});

test('hexRecycleAvailable: 第 6 回合 · 存活 · 还有次数 · 至少一张 · (抽卡已选完 或 休整期)', () => {
  assert.equal(HEX_RECYCLE_ROUND, 6);
  // 时刻 (a) 业主「选完协议源石，这面板直接出现」
  assert.equal(hexRecycleAvailable(draftPub(), 'p_0'), true);
  assert.equal(hexRecycleAvailable(draftPub({ pick: null }), 'p_0'), false, '自己还没选：抽卡界面先走完');
  // 同回合还有机变（标准 / 同盟标准的 R6）：抽卡一结束就是机变，这里不弹（否则闪一下还盖住机变），等休整期
  assert.equal(hexRecycleAvailable(draftPub({ extra: { spRound: true } }), 'p_0'), false, '机变回合：等休整期');
  assert.equal(hexRecycleAvailable(draftPub({ extra: { spRound: false } }), 'p_0'), true, '不是机变回合：选完就弹');
  // 时刻 (b) 休整期（机变回合夹在中间时的那一次）
  assert.equal(hexRecycleAvailable(pubWith(), 'p_0'), true);
  // 其它阶段一律不弹
  for (const phase of [PHASE.SP_DRAFT, PHASE.COMBAT, PHASE.SETTLE, PHASE.ROUND_START, PHASE.RESULT]) {
    assert.equal(hexRecycleAvailable(pubWith({}, { phase }), 'p_0'), false, phase);
  }
  // 只有第 6 回合
  for (const round of [1, 3, 5, 7, 11]) assert.equal(hexRecycleAvailable(pubWith({}, { round }), 'p_0'), false, `round ${round}`);
  // 次数用完 / 一张都没有 / 已淘汰 / 观战
  assert.equal(hexRecycleAvailable(pubWith({ hexRecycleLeft: 0 }), 'p_0'), false);
  assert.equal(hexRecycleAvailable(pubWith({ hexes: [] }), 'p_0'), false);
  assert.equal(hexRecycleAvailable(pubWith({ alive: false }), 'p_0'), false);
  assert.equal(hexRecycleAvailable(pubWith(), 'spec_1'), false);
  // 坏帧
  assert.equal(hexRecycleAvailable(null, 'p_0'), false);
  assert.equal(hexRecycleAvailable({ players: 'nope' }, 'p_0'), false);
  // 缝：PREP 的「未准备」不在这个纯函数里（`priv.ready` 是 m.private 的），由 screens/game.js 的 recycleWindow 补
  assert.equal(hexRecycleAvailable(pubWith({ ready: true }), 'p_0'), true, 'ready is the screen’s extra guard');
});

test('hexRecycleWindow vs hexRecycleAvailable: 次数用完，阶段窗口还在（面板留得住那句「次数已用完」）', () => {
  // 业主 2026-10-31「次数用完那一刻可以留在面板里显示『次数已用完』，点『完成』关掉」：那一刻服务端已经不受理了
  // （available 假），但阶段窗口还开着（window 真）—— screens/game.js 的 recycleOpen 就是靠这个差值把面板留住的。
  const spent = pubWith({ hexRecycleLeft: 0 });
  assert.equal(hexRecycleAvailable(spent, 'p_0'), false, 'nothing left to spend');
  assert.equal(hexRecycleWindow(spent, 'p_0'), true, 'but the window (phase / round / alive / owns one) is still up');
  // 其它会让面板收掉的东西，两边都假
  assert.equal(hexRecycleWindow(pubWith({ hexRecycleLeft: 0 }, { round: 7 }), 'p_0'), false);
  assert.equal(hexRecycleWindow(pubWith({ hexRecycleLeft: 0 }, { phase: PHASE.COMBAT }), 'p_0'), false);
  assert.equal(hexRecycleWindow(pubWith({ hexRecycleLeft: 0, alive: false }), 'p_0'), false);
  assert.equal(hexRecycleWindow(pubWith({ hexRecycleLeft: 0, hexes: [] }), 'p_0'), false);
  assert.equal(hexRecycleWindow(draftPub({ pick: null, row: { hexRecycleLeft: 0 } }), 'p_0'), false, '还没选完');
  assert.equal(hexRecycleWindow(draftPub({ row: { hexRecycleLeft: 0 } }), 'p_0'), true, '选完了');
  // available 就是 window && 还有次数
  assert.equal(hexRecycleAvailable(pubWith({ hexRecycleLeft: 1 }), 'p_0'), true);
  assert.equal(hexRecycleAvailable(null, 'p_0'), false);
});

test('ownHexIds / playerRowOf: 行上的 hexes 去重、丢非字符串', () => {
  assert.deepEqual(ownHexIds(pubWith(), 'p_0'), ['hex_stipend', 'hex_armor']);
  assert.deepEqual(ownHexIds(pubWith({ hexes: ['a', 'a', 'b', '', null, 3] }), 'p_0'), ['a', 'b']);
  assert.deepEqual(ownHexIds(pubWith({ hexes: undefined }), 'p_0'), []);
  assert.equal(playerRowOf(pubWith(), 'p_0').name, 'me');
  assert.equal(playerRowOf(pubWith(), 'nobody'), null);
});

// ---- 点卡 ----------------------------------------------------------------------------------------------------

test('recycleCanRefresh: 还有次数、且没有别的卡在飞', () => {
  assert.equal(recycleCanRefresh(2, null), true);
  assert.equal(recycleCanRefresh(1), true);
  assert.equal(recycleCanRefresh(0, null), false, '次数用完：整排点不动');
  assert.equal(recycleCanRefresh(2, 'hex_armor'), false, '一张在飞：别的卡等它回来（一次点击只花一次）');
  assert.equal(recycleCanRefresh('2'), true, 'a number-ish string from a frame still counts');
  assert.equal(recycleCanRefresh(null), false);
  assert.equal(recycleCanRefresh(undefined), false);
});

test('recycleCardsOf: 行上的 id → HexCard 的卡面（playerHexes 是以 id 为键的对象）', () => {
  assert.deepEqual(CARDS[0], { id: 'hex_stipend', idx: 0, name: '战备津贴', desc: '获得时立即得到 3 资金。', rarity: 'silver' });
  assert.equal(CARDS[1].rarity, 'gold');
  assert.deepEqual(CARDS.map((c) => c.idx), [0, 1]);
  // 数组形态也认
  assert.deepEqual(recycleCardsOf(['hex_armor'], [{ id: 'hex_armor', name: '反击装甲', desc: '防御 +15%。', rarity: 'gold' }]),
    [{ id: 'hex_armor', idx: 0, name: '反击装甲', desc: '防御 +15%。', rarity: 'gold' }]);
  // 查不到的 id 保留（名字退回 id）：玩家仍然必须能刷它
  const unknown = recycleCardsOf(['hex_ghost'], {});
  assert.equal(unknown[0].name, 'hex_ghost');
  assert.equal(unknown[0].rarity, 'silver');
  assert.deepEqual(recycleCardsOf(null, null), []);
});

// ---- 面板（纯视图） ------------------------------------------------------------------------------------------

test('HexRecyclePanel: 协议源石那套壳 + 已拥有的每一张铺成卡', () => {
  const panel = HexRecyclePanel({ cards: CARDS, left: 2, onRefresh: () => {}, onClose: () => {} });
  assert.ok(panel && typeof panel === 'object');
  const markup = JSON.stringify(panel);
  assert.ok(String(panel.props?.class ?? '').includes('spov'), 'the draft’s own shell');
  for (const part of ['spov__veil', 'spov__inner', 'spov__head', 'spov__title', 'spov__sub', 'spov__grid', 'hxov__foot']) {
    assert.ok(markup.includes(part), `the panel renders ${part}`);
  }
  assert.equal(findAll(panel, HexCard).length, 2, 'one card per owned 协议源石');
  assert.ok(markup.includes('协议源石 · 刷新'), 'the title names the action');
  assert.ok(markup.includes('第 6 回合限定') && markup.includes('每局 2 次'), 'the subtitle spells out the window');
  assert.ok(markup.includes('点击一张，随机换回一张'), 'and what a tap does');
  assert.ok(markup.includes('data-testid":"hex-recycle-panel'));
});

test('HexRecyclePanel: 剩 n 次用菱形数出来，用完那一刻改口「次数已用完」', () => {
  const pipsOf = (panel) => findAllByClass(panel, 'hxrec__pip');
  const two = HexRecyclePanel({ cards: CARDS, left: 2 });
  assert.equal(pipsOf(two).length, HEX_RECYCLE_BUDGET, 'one diamond per budget');
  assert.deepEqual(pipsOf(two).map((p) => String(p.props.class).includes('is-on')), [true, true]);
  assert.ok(JSON.stringify(two).includes('剩 2 次'));
  const one = HexRecyclePanel({ cards: CARDS, left: 1 });
  assert.deepEqual(pipsOf(one).map((p) => String(p.props.class).includes('is-on')), [true, false]);
  assert.ok(JSON.stringify(one).includes('剩 1 次'));
  const none = HexRecyclePanel({ cards: CARDS, left: 0 });
  assert.deepEqual(pipsOf(none).map((p) => String(p.props.class).includes('is-on')), [false, false]);
  assert.ok(JSON.stringify(none).includes('次数已用完'), 'the panel stays, it just says so');
  // 次数用完了，卡就点不动了（面板不自己收：业主还要玩家看见那句话，按「完成」才走）
  for (const c of findAll(none, HexCard)) assert.equal(c.props.onClick, null);
});

test('HexRecyclePanel: 点一张就回调 onRefresh（没有确认按钮），在飞时整排禁用 + 说「刷新中」', () => {
  const asked = [];
  const panel = HexRecyclePanel({ cards: CARDS, left: 2, onRefresh: (id) => asked.push(id) });
  const cards = findAll(panel, HexCard);
  cards[1].props.onClick();
  cards[0].props.onClick();
  assert.deepEqual(asked, ['hex_armor', 'hex_stipend'], 'a tap refreshes THAT card (no selection, no confirm)');
  // 没有确认按钮：只有「完成」
  const labels = findAll(panel, Button).map((b) => String(b.props?.children ?? ''));
  assert.deepEqual(labels, ['完成'], 'no 确认 — the tap IS the confirmation');
  // 一张在飞：整排 onClick 都撤掉（HexCard 于是退回纯展示的 span），那张进「被吸走」的动画，状态行改口
  const busy = HexRecyclePanel({ cards: CARDS, left: 1, busyId: 'hex_armor', onRefresh: () => {} });
  for (const c of findAll(busy, HexCard)) assert.equal(c.props.onClick, null, 'every card waits for the reply');
  const busyCards = findAll(busy, HexCard);
  assert.equal(busyCards[1].props?.vanishing, true, 'the tapped card plays the draft’s suck-in animation');
  assert.equal(busyCards[0].props?.vanishing, false);
  assert.ok(JSON.stringify(busy).includes('刷新中'));
  assert.equal(findAllByClass(busy, 'is-refreshing').length, 1, 'the slot carries the state for the CSS');
});

test('HexRecyclePanel: 新换回来的那张带 is-fresh（入场闪一下）', () => {
  const panel = HexRecyclePanel({ cards: CARDS, left: 1, freshId: 'hex_armor' });
  const fresh = findAllByClass(panel, 'is-fresh');
  assert.equal(fresh.length, 1);
  assert.ok(String(fresh[0].props.class).includes('hxrec__slot'), 'the flash lives on the card slot');
  assert.ok(RECYCLE_FLASH_MS > 0, 'and the CSS animation length follows it');
  // 别的卡不带
  assert.equal(findAllByClass(HexRecyclePanel({ cards: CARDS, left: 1 }), 'is-fresh').length, 0);
});

test('HexRecyclePanel: 完成 / 点 veil 都回调 onClose（Esc 由屏幕接，见 screens/game.js）', () => {
  let closed = 0;
  const panel = HexRecyclePanel({ cards: CARDS, left: 2, onClose: () => { closed++; } });
  findAll(panel, Button).find((b) => String(b.props?.children ?? '').includes('完成')).props.onClick();
  assert.equal(closed, 1, '「完成」closes this round');
  findAllByClass(panel, 'spov__veil')[0].props.onClick();
  assert.equal(closed, 2, 'the veil is a 完成 too');
  // 没有回调也不抛
  const bare = HexRecyclePanel({ cards: CARDS, left: 1 });
  assert.equal(findAll(bare, Button)[0].props.onClick(), undefined);
});

// ---- 入口不再是按钮 ------------------------------------------------------------------------------------------

test('the corner entry is GONE (业主 2026-10-31「不要按钮形式」)', () => {
  assert.equal(hexOverlay.HexRecycleButton, undefined, 'no corner button export');
  const markup = JSON.stringify(HexRecyclePanel({ cards: CARDS, left: 2 }));
  assert.ok(!markup.includes('gm__gear'), 'the panel renders no HUD gear button');
});

// ---- 动作 → 意图 ---------------------------------------------------------------------------------------------

test('actions.hexRecycle sends g.hexRecycle with the ONE tapped id', async () => {
  const { net } = await import('../../public/js/net.js');
  const { actions } = await import('../../public/js/ui/gameActions.js');
  const sent = [];
  const orig = net.request;
  net.request = async (t, f) => { sent.push([t, f]); return {}; };
  try {
    assert.equal(typeof actions.hexRecycle, 'function', 'the 协议源石 UI must have a send point (SYNC-POINTS §1 ④)');
    assert.equal(await actions.hexRecycle(['hex_stipend']), true);
    // 契约仍允许 1–2 个 id（服务端自己收 1–2 个），界面只发 1 个
    assert.equal(await actions.hexRecycle(['hex_stipend', 'hex_armor']), true);
  } finally { net.request = orig; }
  assert.deepEqual(sent, [
    ['g.hexRecycle', { ids: ['hex_stipend'] }],
    ['g.hexRecycle', { ids: ['hex_stipend', 'hex_armor'] }],
  ]);
});
