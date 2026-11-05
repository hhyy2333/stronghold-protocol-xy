// test/workshop/field-store.test.js — 「战地商店」工坊包（workshop/field-store）。
//
// 三层：
//   1. 纯函数：价格口径（原价 ×3）、货架（全部可上架装备，不含协议源石专属那 7 件）、抽卡加权与引擎
//      `rollOffers(..., count: 1)` 逐位等价、确定性随机流；
//   2. 真实引擎：把包的服务端层套在真 Match 上（harness 的 `MatchClass` 选项），开一局走到休整期，买装备 /
//      抽卡 / 一条条拒绝路径 —— 钱与 `effects` 一字节都不能动；
//   3. 假 DOM：面板能画货架、能过滤、两段确认会发通道消息、离开休整期整块收起。
//
// 包的服务端模块**零 import**（同一份字节要在服务器上跑），所以这里直接从 `workshop/field-store/server/store.mjs`
// 拿导出，和引擎测试用同一份宿主 API。

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeMatch, DATA } from '../match/harness.js';
import { Match } from '../../server/match/Match.js';
import { GameData } from '../../server/match/gamedata.js';
import { hexIdsOf } from '../../server/match/hextech.js';
import { rollOffers } from '../../shared/hextech.js';
import {
  EQUIP_MUL, HEX_PRICE, FRAME_BYTES,
  catalogOf, equipPriceOf, frameBytes, ownedHexIds, pickUnownedHex, refusalText, seededRng,
  registerServer,
} from '../../workshop/field-store/server/store.mjs';
import {
  buildRows, filterCatalog, mount as mountPanel, priceLine, tierLabel,
} from '../../workshop/field-store/ui/store.js';

const PACK = 'field-store';
const CHANNEL = 'store';
/** The engine's data view over the raw bundle (the harness's DATA is the raw bundle; the pack reads this shape). */
const GD = new GameData(DATA);
const PLAYER_HEX_COUNT = Object.keys(DATA.hextech.playerHexes).length;

/** The 7 items only 协议源石 grants (hideInShop, price 0) — never on this shelf. */
const HEX_ONLY_ITEMS = [
  'chess_item_9_90_e_a', 'chess_item_9_91_e_a', 'chess_item_9_92_e_a', 'chess_item_9_93_e_a',
  'chess_item_9_94_e_a', 'chess_item_9_95_e_a', 'chess_item_9_96_e_a',
];

/** The pack's MatchClass layer, wrapped around the REAL engine class. */
let WrappedMatch = null;
registerServer({ matchClass: (fn) => { WrappedMatch = fn(Match); return true; } });
assert.equal(typeof WrappedMatch, 'function', 'registerServer wraps the match class');

// =====================================================================================================================
// 纯函数
// =====================================================================================================================

test('价格口径：装备原价 ×3（业主），四舍五入不做、0 与垃圾输入一律 0', () => {
  assert.equal(EQUIP_MUL, 3);
  assert.equal(equipPriceOf(1), 3);
  assert.equal(equipPriceOf(2), 6);
  assert.equal(equipPriceOf(5), 15);
  assert.equal(equipPriceOf(3.9), 9, 'a fractional base truncates, never rounds up');
  assert.equal(equipPriceOf(0), 0);
  assert.equal(equipPriceOf(-2), 0);
  assert.equal(equipPriceOf('x'), 0);
  assert.equal(equipPriceOf(undefined), 0);
});

test('货架 = 全部可上架装备（51 件），不含协议源石专属的 7 件、不含金卡', () => {
  const rows = catalogOf(GD);
  assert.equal(rows.length, 51);
  for (const id of HEX_ONLY_ITEMS) assert.equal(rows.some((row) => row.id === id), false, `${id} must never be sold`);
  const byTier = {};
  for (const row of rows) byTier[row.tier] = (byTier[row.tier] || 0) + 1;
  assert.deepEqual(byTier, { 1: 5, 2: 6, 3: 10, 4: 11, 5: 8, 6: 11 });
  for (const row of rows) {
    const rec = DATA.items[row.id];
    assert.equal(row.price, rec.price * 3, `${row.id}: 本店价 = 原价 ×3`);
    assert.equal(row.base, rec.price);
    assert.ok(row.name && row.name !== row.id, `${row.id} carries a display name`);
    assert.equal(row.tier, rec.tier);
    assert.equal(DATA.items[row.id].hideInShop, false);
    assert.equal(DATA.items[row.id].isGolden !== true, true);
  }
  // 顺序稳定（tier → 原价 → id）：面板与测试都按这个顺序读
  const again = catalogOf(GD);
  assert.deepEqual(again.map((row) => row.id), rows.map((row) => row.id));
  for (let i = 1; i < rows.length; i++) {
    const a = rows[i - 1];
    const b = rows[i];
    assert.ok(a.tier < b.tier || (a.tier === b.tier && (a.base < b.base || (a.base === b.base && a.id <= b.id))), 'sorted by (tier, base, id)');
  }
});

test('ownedHexIds 与引擎 hexIdsOf 同一口径（只认 hex: 前缀 ref 的 data.hexId）', () => {
  const effects = [
    { key: 'hex:hex_stipend', data: { hexId: 'hex_stipend' } },
    { key: 'choice:something', data: {} },
    { key: 'effect:hexdebt', data: {} },
    { key: 'hex:hex_armor' }, // malformed: falls back to the key suffix
    null,
    {},
  ];
  assert.deepEqual(ownedHexIds(effects), ['hex_stipend', 'hex_armor']);
  assert.deepEqual(ownedHexIds(null), []);
});

test('抽卡与引擎 rollOffers(count: 1) 逐位等价（同一 rng ⇒ 同一张卡）', () => {
  const pool = DATA.hextech.playerHexes;
  const ids = Object.keys(pool);
  const weights = DATA.hextech.format.weights;
  for (let seed = 1; seed <= 40; seed++) {
    const owned = ids.filter((_, i) => i % 7 === seed % 7);
    const bans = [ids[seed % ids.length]];
    const usable = Object.keys(pool).filter((id) => !bans.includes(id)).map((id) => pool[id]);
    const engineRng = seededRng(['engine', seed]);
    const packRng = seededRng(['engine', seed]);
    const expected = rollOffers(engineRng, { pool: usable, owned, weights, count: 1 })[0] || null;
    const actual = pickUnownedHex(packRng, { pool: usable, owned, weights });
    assert.equal(actual, expected, `seed ${seed}`);
  }
});

test('抽卡跳过已拥有：池子里只剩没拥有的可抽', () => {
  const pool = [
    { id: 'a', rarity: 'silver' },
    { id: 'b', rarity: 'gold' },
    { id: 'c', rarity: 'prismatic' },
  ];
  const rng = seededRng(['only-one']);
  const id = pickUnownedHex(rng, { pool, owned: ['a', 'c'], weights: { silver: 0.46, gold: 0.38, prismatic: 0.16 } });
  assert.equal(id, 'b');
  assert.equal(pickUnownedHex(seededRng(['empty']), { pool, owned: ['a', 'b', 'c'] }), null);
  assert.equal(pickUnownedHex(seededRng(['none']), { pool: [], owned: [] }), null);
});

test('确定性随机流：同种子同序列，不同种子不同序列，且不借引擎随机流', () => {
  const one = seededRng([7, 3, 'p_0', 'store-draw', 0]);
  const two = seededRng([7, 3, 'p_0', 'store-draw', 0]);
  const a = [one(), one(), one()];
  const b = [two(), two(), two()];
  assert.deepEqual(a, b);
  assert.ok(a.every((v) => v >= 0 && v < 1));
  const other = seededRng([7, 3, 'p_0', 'store-draw', 1]);
  assert.notDeepEqual([other(), other(), other()], a);
});

test('拒绝理由是有话直说的中文（资金不足会报差额）', () => {
  assert.match(refusalText('funds', { need: 4 }), /还差 4 块/);
  assert.match(refusalText('phase'), /休整期/);
  assert.match(refusalText('hand'), /整备区/);
  assert.match(refusalText('noHex'), /没有可抽/);
  assert.equal(refusalText('nope').length > 0, true);
});

// =====================================================================================================================
// 真实引擎：套上包的服务端层
// =====================================================================================================================

/** Start a real match with the pack's MatchClass layer and drive it to the prep phase of round `round`. */
function boot(seed = 7, round = 1) {
  const h = makeMatch({ mode: 'solo', difficulty: 'FUNNY', seed, fake: true, MatchClass: WrappedMatch }).start();
  h.toPrep(round);
  return h;
}

/** Every frame the pack sent to one player, in order. */
function framesTo(h, id = 'p_0') {
  return h.sent
    .filter(([pid, msg]) => pid === id && msg && msg.t === 'pack.msg' && msg.pack === PACK && msg.channel === CHANNEL)
    .map(([, msg]) => msg);
}
const lastFrame = (h, id = 'p_0') => framesTo(h, id).at(-1) || null;
const lastData = (h, id = 'p_0') => lastFrame(h, id)?.data || null;
/** The most recent frame that carries the shelf (`sync` frames do not repeat the 51 rows). */
const shelfOf = (h, id = 'p_0') => framesTo(h, id).filter((frame) => Array.isArray(frame.data.catalog)).at(-1)?.data || null;
const op = (h, data, id = 'p_0') => h.m.handlePackMsg(id, { pack: PACK, channel: CHANNEL, data });

/** The cheapest catalogue row (what a poor player could still afford). */
function cheapest(frame) {
  return frame.catalog.slice().sort((a, b) => a[1] - b[1])[0];
}

test('走到休整期：包装器推一帧 open，货架是 51 件全量、抽卡价 12', () => {
  const h = boot();
  const frame = lastFrame(h);
  assert.ok(frame, 'enterPrep pushed a frame');
  assert.equal(frame.data.type, 'state');
  assert.equal(frame.data.kind, 'open');
  assert.equal(frame.data.phase, 'PREP');
  assert.equal(frame.data.closed, false);
  assert.equal(frame.data.catalog.length, 51);
  assert.equal(frame.data.hex.price, HEX_PRICE);
  assert.equal(frame.data.hex.price, 12);
  assert.ok(frame.data.hex.unowned > 0, 'there are cards left to draw');
  assert.ok(frameBytes(frame) < FRAME_BYTES, `frame is ${frameBytes(frame)} bytes`);
  h.invariants();
  h.m.dispose();
});

test('买装备：扣 3× 原价、进手牌 / 整备区、回执带名字', () => {
  const h = boot();
  const ps = h.ps('p_0');
  ps.addFunds(60);
  h.m.flush();
  const data = shelfOf(h);
  const [id, price] = cheapest(data);
  const row = catalogOf(GD).find((r) => r.id === id);
  assert.equal(price, row.price);
  const before = ps.funds;
  op(h, { op: 'buy', id });
  assert.equal(ps.funds, before - price, 'exactly the shelf price');
  const pieces = [...ps.hand, ...ps.temp].filter(Boolean).map((piece) => piece.id);
  assert.ok(pieces.includes(id), 'the piece is in hand / temp');
  const after = lastData(h);
  assert.equal(after.lastOrder.ok, true);
  assert.equal(after.lastOrder.id, id);
  assert.equal(after.lastOrder.price, price);
  assert.equal(after.lastOrder.name, row.name);
  h.invariants();
  h.m.dispose();
});

test('买装备的拒绝：未知 id、钱不够、手牌满、共享库存见底、非休整期、AI 座位 —— 一分钱都不扣', () => {
  const h = boot();
  const ps = h.ps('p_0');
  ps.addFunds(100);
  h.m.flush();
  const frame = shelfOf(h);
  const [id] = cheapest(frame);
  const funds = ps.funds;

  op(h, { op: 'buy', id: 'no_such_item' });
  assert.equal(lastData(h).lastOrder.ok, false);
  assert.equal(lastData(h).lastOrder.code, 'item');
  assert.equal(ps.funds, funds);

  // 一件买不起的（把资金压到 0，挑最贵的一件）
  const [dear, dearPrice] = frame.catalog.slice().sort((a, b) => b[1] - a[1])[0];
  const keep = ps.funds;
  ps.funds = Math.max(0, dearPrice - 1);
  op(h, { op: 'buy', id: dear });
  assert.equal(lastData(h).lastOrder.code, 'funds');
  assert.match(lastData(h).lastOrder.text, new RegExp(`还差 1 块`));
  ps.funds = keep;

  // 整备区满：与 economy.buy 同一条判据
  const hand = ps.hand;
  ps.hand = new Array(hand.length).fill({ uid: 'filler' });
  op(h, { op: 'buy', id });
  assert.equal(lastData(h).lastOrder.code, 'hand');
  assert.equal(ps.funds, keep);
  ps.hand = hand;

  // 共享库存见底
  const canGain = h.m.itemPool.canGain.bind(h.m.itemPool);
  h.m.itemPool.canGain = (itemId) => itemId !== id;
  op(h, { op: 'buy', id });
  assert.equal(lastData(h).lastOrder.code, 'stock');
  assert.equal(ps.funds, keep);
  h.m.itemPool.canGain = canGain;

  // 非休整期
  const phase = h.m.phase;
  h.m.phase = 'COMBAT';
  op(h, { op: 'buy', id });
  assert.equal(lastData(h).lastOrder.code, 'phase');
  assert.equal(ps.funds, keep);
  h.m.phase = phase;

  // AI 座位（观战者 / 机器人不进商店）。引擎的 sendTo 本来就不给机器人单播，所以这里直接断言闸门
  // （消息投递的裁剪是引擎的事，商店只负责「不成交、不扣钱」）。
  const isBot = ps.isBot;
  ps.isBot = true;
  assert.equal(h.m._fsGate(ps), 'seat', 'the gate names the seat, not a silent no-op');
  op(h, { op: 'buy', id });
  assert.equal(ps.funds, keep);
  ps.isBot = isBot;

  h.m.dispose();
});

test('抽协议源石：扣 12、真发到手上（hex ref + 即时效果）、播报一条', () => {
  const h = boot();
  const ps = h.ps('p_0');
  ps.addFunds(40);
  h.m.flush();
  const ownedBefore = hexIdsOf(ps);
  const funds = ps.funds;
  op(h, { op: 'draw' });
  assert.equal(ps.funds, funds - HEX_PRICE);
  const owned = hexIdsOf(ps);
  assert.equal(owned.length, ownedBefore.length + 1, 'exactly one card granted');
  const drawn = owned.find((id) => !ownedBefore.includes(id));
  assert.ok(drawn && DATA.hextech.playerHexes[drawn], 'a real player card');
  const data = lastData(h);
  assert.equal(data.lastOrder.ok, true);
  assert.equal(data.lastOrder.op, 'draw');
  assert.equal(data.lastOrder.hex.id, drawn);
  assert.equal(data.hex.unowned, PLAYER_HEX_COUNT - owned.length);
  // 一条播报（`m.ticker` 广播，不是单播帧 —— 全桌都看得见谁抽到了什么）
  assert.ok(h.bc.some((msg) => msg && msg.t === 'm.ticker' && JSON.stringify(msg).includes('抽到了协议源石')), 'a ticker went out');
  h.invariants();
  h.m.dispose();
});

test('抽卡的拒绝：钱只有 11 时拒绝且不扣钱；池子全拥有时 noHex 且不扣钱', () => {
  const h = boot();
  const ps = h.ps('p_0');
  ps.funds = 11;
  h.m.flush();
  const funds = ps.funds;
  const owned = hexIdsOf(ps);
  op(h, { op: 'draw' });
  assert.equal(lastData(h).lastOrder.ok, false);
  assert.equal(lastData(h).lastOrder.code, 'funds');
  assert.equal(ps.funds, funds, 'no charge on refusal');
  assert.deepEqual(hexIdsOf(ps), owned, 'no card granted');

  // 全部拥有 ⇒ 没得抽（用 ref 形状直接标记拥有，不必真的发 111 张）
  ps.effects = Object.keys(DATA.hextech.playerHexes).map((id) => ({ key: `hex:${id}`, data: { hexId: id } }));
  ps.addFunds(12);
  h.m.flush();
  const rich = ps.funds;
  op(h, { op: 'draw' });
  assert.equal(lastData(h).lastOrder.code, 'noHex');
  assert.equal(ps.funds, rich, 'no charge when the pool is empty');
  h.m.dispose();
});

test('抽卡尊重局外禁用：禁掉 1 阶/2 阶之后只剩 3 阶可抽', () => {
  const h = boot();
  const ps = h.ps('p_0');
  ps.addFunds(60);
  h.m.flush();
  const pool = Object.values(DATA.hextech.playerHexes);
  ps.hexBans = pool.filter((hex) => hex.rarity !== 'prismatic').map((hex) => hex.id);
  op(h, { op: 'draw' });
  const data = lastData(h);
  assert.equal(data.lastOrder.ok, true);
  assert.equal(DATA.hextech.playerHexes[data.lastOrder.hex.id].rarity, 'prismatic', 'only the unbanned rarity was drawn');
  assert.equal(data.hex.unowned, pool.filter((hex) => hex.rarity === 'prismatic').length - 1, 'the count follows the bans (minus the one just drawn)');
  h.m.dispose();
});

test('资金同步：现金一变补一帧 sync（货架不重复下发），拆开看帧体仍是小的', () => {
  const h = boot();
  const ps = h.ps('p_0');
  const countBefore = framesTo(h).length;
  ps.addFunds(5);
  h.m.flush();
  const frames = framesTo(h);
  assert.equal(frames.length, countBefore + 1, 'a sync frame went out');
  const data = frames.at(-1).data;
  assert.equal(data.kind, 'sync');
  assert.equal(data.catalog, null, 'the lean frame does not repeat 51 rows');
  assert.equal(data.funds, ps.funds);
  assert.ok(frameBytes(frames.at(-1)) < 512, `lean frame is ${frameBytes(frames.at(-1))} bytes`);
  h.m.dispose();
});

test('hello 回一帧；本局结束之后任何操作都被拒绝', () => {
  const h = boot();
  const before = framesTo(h).length;
  op(h, { op: 'hello' });
  assert.equal(framesTo(h).length, before + 1);

  h.m.finish({ victory: false, reason: 'defeat' });
  const ps = h.ps('p_0');
  ps.addFunds(100);
  const funds = ps.funds;
  const shelf = shelfOf(h);
  op(h, { op: 'buy', id: shelf && shelf.catalog.length ? shelf.catalog[0][0] : 'x' });
  assert.equal(lastData(h).lastOrder.code, 'closed');
  assert.equal(ps.funds, funds);
  h.m.dispose();
});

// =====================================================================================================================
// 面板（假 DOM）
// =====================================================================================================================

class ShimEl {
  constructor(tag) {
    this.tagName = tag;
    this.childNodes = [];
    this.parentNode = null;
    this.dataset = {};
    this.hidden = false;
    this.disabled = false;
    this.textContent = '';
    this.className = '';
    this.attributes = {};
    this.ownerDocument = null;
    this.listeners = {};
    this.value = '';
  }
  get firstChild() { return this.childNodes[0] || null; }
  appendChild(child) {
    if (child.parentNode) child.parentNode.removeChild(child);
    child.parentNode = this;
    this.childNodes.push(child);
    return child;
  }
  removeChild(child) {
    const i = this.childNodes.indexOf(child);
    if (i >= 0) this.childNodes.splice(i, 1);
    child.parentNode = null;
    return child;
  }
  setAttribute(key, value) { this.attributes[key] = String(value); }
  addEventListener(type, fn) { (this.listeners[type] ||= []).push(fn); }
  removeEventListener(type, fn) { this.listeners[type] = (this.listeners[type] || []).filter((f) => f !== fn); }
  closest(selector) {
    const key = /^\[data-([a-z]+)\]$/.exec(String(selector || ''))?.[1];
    if (!key) return null;
    for (let node = this; node; node = node.parentNode) {
      if (node.dataset && node.dataset[key] != null) return node;
    }
    return null;
  }
  get classList() {
    const self = this;
    const list = () => self.className.split(/\s+/).filter(Boolean);
    return {
      add(name) { if (!list().includes(name)) self.className = [...list(), name].join(' '); },
      remove(name) { self.className = list().filter((x) => x !== name).join(' '); },
      toggle(name, force) {
        const has = list().includes(name);
        const want = force === undefined ? !has : !!force;
        if (want && !has) this.add(name);
        if (!want && has) this.remove(name);
      },
      contains(name) { return list().includes(name); },
    };
  }
}

function fakeDoc() {
  const doc = { createElement: (tag) => new ShimEl(tag), createElementNS: (_ns, tag) => new ShimEl(tag) };
  const host = new ShimEl('div');
  host.ownerDocument = doc;
  return { doc, host };
}

function walk(node, out = []) {
  out.push(node);
  for (const child of node.childNodes || []) walk(child, out);
  return out;
}
const findAll = (root, pred) => walk(root).filter(pred);
const rowsOf = (root) => findAll(root, (n) => String(n.className).split(/\s+/).includes('fst__row'));
const clickOn = (root, node) => {
  const handlers = root.listeners.click || [];
  assert.ok(handlers.length, 'the panel delegates clicks on the root');
  for (const fn of handlers) fn({ target: node });
};

/** A real frame the panel can render (the pack's own server produced it, shelf included). */
function sampleFrame() {
  const h = boot(11);
  const ps = h.ps('p_0');
  ps.addFunds(80);
  h.m.flush();
  const frame = shelfOf(h);
  h.m.dispose();
  return { ...frame, funds: 80, lastOrder: null };
}

function mountWith(sendLog = []) {
  const { host } = fakeDoc();
  let onFrame = null;
  let offCalls = 0;
  const ctx = {
    host,
    net: {
      on: (_channel, fn) => { onFrame = fn; return () => { offCalls += 1; }; },
      send: (channel, payload) => { sendLog.push({ channel, payload }); return true; },
    },
    me: { snapshot: () => ({ room: { inMatch: true } }) },
    data: {
      get: (name) => (name === 'items' ? DATA.items : name === 'bonds' ? DATA.bonds : name === 'assets' ? DATA.assets : null),
    },
    log: { warn() {} },
  };
  const inst = mountPanel(ctx);
  assert.equal(typeof onFrame, 'function', 'the panel subscribes to its channel');
  // 挂载即握手（业主 2026-11-05：不再等 400 ms，见下面那条用例）—— 那一条单独断言，其余用例只看「玩家点的那些帧」。
  const mountHellos = sendLog.filter((frame) => frame.payload && frame.payload.op === 'hello');
  sendLog.length = 0;
  return { host, inst, deliver: (data) => onFrame(data), offCalls: () => offCalls, mountHellos };
}

test('面板：一挂上就立刻问一次货架 —— 不在 400 ms 之后再问（业主 2026-11-05「进入按钮要展开商店一段时间之后才刷出来」）', () => {
  const sendLog = [];
  const { inst, mountHellos } = mountWith(sendLog);
  // 面板在房里（`me.room.inMatch`）挂上时，握手必须**同步**发出去：商店栏每收起再展开，宿主都会被 Preact 整块
  // 换掉、注册点会先摘掉再挂一次，那一下正是玩家等着按钮出现的时候。
  assert.equal(mountHellos.length, 1, 'exactly one hello, sent while mounting');
  assert.equal(mountHellos[0].channel, CHANNEL);
  assert.deepEqual(mountHellos[0].payload, { op: 'hello' });
  inst.unmount();
});

test('面板：第一帧 open 就画出 51 件，价签只写价格本身（不再写「原价 n → 3n」）', () => {
  const { host, inst, deliver } = mountWith();
  const frame = sampleFrame();
  deliver(frame);
  assert.equal(host.childNodes[0].hidden, false, 'the panel shows up in PREP');
  const rows = rowsOf(host);
  assert.equal(rows.length, 51);
  // 每一行都有一颗价签，文字是纯数字（业主 2026-10-23：直接显示价格）
  const prices = findAll(host, (n) => String(n.className).split(/\s+/).includes('fst__price'));
  assert.equal(prices.length, 51);
  assert.ok(prices.every((n) => /^\d+$/.test(String(n.textContent))), prices.map((n) => n.textContent).join(','));
  const texts = findAll(host, (n) => n.textContent).map((n) => n.textContent).join(' ');
  assert.doesNotMatch(texts, /原价/);
  inst.unmount();
});

test('面板：阶级过滤与搜索都只留匹配行', () => {
  const { host, inst, deliver } = mountWith();
  deliver(sampleFrame());
  const chips = findAll(host, (n) => n.dataset && n.dataset.action === 'tier');
  assert.ok(chips.length >= 7, '全部 + I..VI');
  const six = chips.find((n) => n.dataset.tier === '6');
  clickOn(host.childNodes[0], six);
  assert.equal(rowsOf(host).length, 11, 'tier 6 has 11 items');
  const all = findAll(host, (n) => n.dataset && n.dataset.action === 'tier').find((n) => n.dataset.tier === 'all');
  clickOn(host.childNodes[0], all);

  const search = findAll(host, (n) => n.tagName === 'input')[0];
  search.value = '重锤';
  search.listeners.input[0]();
  const rows = rowsOf(host);
  assert.ok(rows.length >= 1 && rows.length < 51);
  assert.ok(rows.every((row) => findAll(row, (n) => n.tagName === 'span').some((n) => String(n.textContent).includes('重锤'))));
  inst.unmount();
});

test('面板：买装备要两段确认（第一下只变文字，第二下才发 { op: "buy" }）', () => {
  const sendLog = [];
  const { host, inst, deliver } = mountWith(sendLog);
  const frame = sampleFrame();
  deliver(frame);
  const root = host.childNodes[0];

  let buy = rowsOf(host)[0] && findAll(rowsOf(host)[0], (n) => n.dataset && n.dataset.action === 'buy')[0];
  assert.ok(buy, 'a buy button exists');
  const id = buy.dataset.id;
  clickOn(root, buy);
  assert.equal(sendLog.length, 0, 'the first tap only arms');
  buy = findAll(rowsOf(host)[0], (n) => n.dataset && n.dataset.action === 'buy')[0];
  assert.match(buy.textContent, /^确认 · \d+$/);
  clickOn(root, buy);
  assert.equal(sendLog.length, 1);
  assert.equal(sendLog[0].channel, CHANNEL);
  assert.deepEqual(sendLog[0].payload, { op: 'buy', id });
  inst.unmount();
});

test('面板：协议源石页签写着 12 块，两段确认后发 { op: "draw" }', () => {
  const sendLog = [];
  const { host, inst, deliver } = mountWith(sendLog);
  deliver(sampleFrame());
  const root = host.childNodes[0];
  const tabs = findAll(host, (n) => n.dataset && n.dataset.action === 'tab');
  const hexTab = tabs.find((n) => n.dataset.tab === 'hex');
  clickOn(root, hexTab);
  const text = findAll(host, (n) => n.textContent).map((n) => n.textContent).join(' ');
  assert.match(text, /12 块 \/ 次/);
  let draw = findAll(host, (n) => n.dataset && n.dataset.action === 'draw')[0];
  clickOn(root, draw);
  assert.equal(sendLog.length, 0, 'the first tap only arms');
  draw = findAll(host, (n) => n.dataset && n.dataset.action === 'draw')[0];
  assert.match(draw.textContent, /^确认抽取 · 12$/);
  clickOn(root, draw);
  assert.equal(sendLog.length, 1);
  assert.deepEqual(sendLog[0].payload, { op: 'draw' });
  inst.unmount();
});

test('面板：离开休整期整块收起；unmount 退订并摘掉根节点', () => {
  const { host, offCalls, inst, deliver } = mountWith();
  const frame = sampleFrame();
  deliver(frame);
  const root = host.childNodes[0];
  assert.equal(root.hidden, false);
  deliver({ ...frame, phase: 'COMBAT' });
  assert.equal(root.hidden, true, 'hidden outside PREP');
  deliver({ ...frame, phase: 'PREP', alive: false });
  assert.equal(root.hidden, true, 'hidden for an eliminated seat');
  deliver(frame);
  assert.equal(root.hidden, false);
  inst.unmount();
  assert.equal(offCalls(), 1, 'the channel subscription was released');
  assert.equal(root.parentNode, null, 'the root was detached');
});

test('面板：第一下「购买」进入确认态时不许把列表滚回顶端（业主 2026-10-26「点一下滚动条会回到最上面」）', () => {
  const { host, inst, deliver } = mountWith();
  deliver(sampleFrame());
  const root = host.childNodes[0];
  const list = findAll(host, (n) => n.className === 'fst__list')[0];
  assert.ok(list, 'the equipment list exists');

  // 玩家把列表滚到中间，点第 6 行的「购买」
  list.scrollTop = 260;
  let buys = findAll(host, (n) => String(n.className).split(/\s+/).includes('fst__buy'));
  const targetId = buys[5].dataset.id;
  clickOn(root, buys[5]);
  assert.equal(list.scrollTop, 260, '确认态的重画把滚动位置丢了（整块重建 51 行时浏览器会回到顶部）');

  // 变成确认态的是同一行，第二下才真的下单
  const armed = findAll(host, (n) => String(n.className).split(/\s+/).includes('is-armed'));
  assert.equal(armed.length, 1, 'exactly one row is armed');
  assert.equal(armed[0].dataset.id, targetId);
  assert.match(armed[0].textContent, /^确认 · \d+$/);

  // 资金到账的帧（服务端 sync）也是同一批内容，位置同样要保住
  deliver({ ...sampleFrame(), funds: 3 });
  assert.equal(list.scrollTop, 260, '资金变化的重画同样不该跳顶');

  // 换阶级是真的换了一批内容，这时才该回到顶部
  const chip = findAll(host, (n) => n.dataset && n.dataset.action === 'tier' && n.dataset.tier === '3')[0];
  clickOn(root, chip);
  assert.equal(list.scrollTop, 0, '换阶级回顶部');
  inst.unmount();
});

// =====================================================================================================================
// 面板纯函数
// =====================================================================================================================

test('面板纯函数：阶级罗马数字、价格行、过滤（名字 / id / 阶级）', () => {
  assert.equal(tierLabel(1), 'I');
  assert.equal(tierLabel(6), 'VI');
  assert.equal(tierLabel(9), '9');
  assert.equal(priceLine(15), '15');
  assert.equal(priceLine(4), '4');
  const rows = buildRows([[ 'chess_item_1_01_e_a', 3, -1 ]], { items: DATA.items, bonds: DATA.bonds });
  assert.equal(rows[0].name, '维式重锤');
  assert.equal(rows[0].tier, 1);
  assert.equal(rows[0].bondName, '维多利亚');
  assert.equal(filterCatalog(rows, { tier: 1 }).length, 1);
  assert.equal(filterCatalog(rows, { tier: 2 }).length, 0);
  assert.equal(filterCatalog(rows, { query: '重锤' }).length, 1);
  assert.equal(filterCatalog(rows, { query: '不存在' }).length, 0);
  assert.equal(filterCatalog(rows, { query: 'chess_item_1' }).length, 1);
});
