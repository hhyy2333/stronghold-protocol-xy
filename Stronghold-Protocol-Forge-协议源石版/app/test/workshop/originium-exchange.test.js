// test/workshop/originium-exchange.test.js — 「源石证券交易所」1.3.0 的行情模型、金额口径与面板纯函数。
//
// 业主 2026-10-21：「优化交易所 mod，现在波动性还是太小了」+「不要盟约业绩（股票跟着层数增长轮动）」。
// 这一份钉住三件事：
//   * 行情由「情绪漂移×beta + 共同市场×beta + 个股噪声 + 冷热 + 新闻」组成，单回合夹 ±45%；
//   * 波动**不能再悄悄调小**：固定种子下的中位数/p90/大行情占比有下限（统计回归，不是快照）；
//   * 价格能跌破 1 块之后，「全部」与服务端的金额口径仍然一致（`maxAffordable` 不再整数化）。

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  STOCKS, LIMITS, PRICE_FLOOR, PRICE_CEIL, CLAMP_PCT, REGIME_BLOCK, NEWS_CHANCE,
  regimeAt, marketMoveAt, newsAt, roundPct, nextPrice, stockHeat, dividendOf, interestOf, maxDebtFor, registerServer,
} from '../../workshop/originium-exchange/server/exchange.mjs';
import {
  feeFor, maxAffordable, maxBuyable, resolveQty, mount as mountPanel,
} from '../../workshop/originium-exchange/ui/exchange.js';

const BONDS = JSON.parse(readFileSync(new URL('../../data/bonds.json', import.meta.url), 'utf8'));

const pctl = (values, p) => {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(p * (sorted.length - 1))];
};

// =====================================================================================================================
// 数据与常量
// =====================================================================================================================

test('六支股票绑的是 data/bonds.json 里的盟约；beta / vol / base 合法', () => {
  assert.equal(STOCKS.length, 6);
  for (const stock of STOCKS) {
    assert.ok(BONDS[stock.id], `${stock.id} is a bond id`);
    assert.ok(stock.beta > 0 && stock.beta <= 2, `${stock.id} beta ${stock.beta}`);
    assert.ok(stock.vol > 0 && stock.vol <= 3, `${stock.id} vol ${stock.vol}`);
    assert.ok(stock.base >= PRICE_FLOOR && stock.base <= PRICE_CEIL, `${stock.id} base ${stock.base}`);
  }
  assert.equal(PRICE_FLOOR, 0.25);
  assert.equal(PRICE_CEIL, 99);
  assert.equal(CLAMP_PCT, 45);
  assert.equal(NEWS_CHANCE, 0.45);
});

// =====================================================================================================================
// 市场情绪 / 共同市场 / 新闻：确定性与边界
// =====================================================================================================================

test('市场情绪按 3 回合一块，块内恒定、可复现，三种情绪都会出现', () => {
  for (let seed = 1; seed <= 50; seed += 1) {
    const first = regimeAt(seed, 1);
    assert.ok(['bull', 'bear', 'calm'].includes(first.kind), first.kind);
    assert.equal(first.roundsLeft, REGIME_BLOCK);
    for (let round = 1; round <= REGIME_BLOCK; round += 1) {
      const again = regimeAt(seed, round);
      assert.equal(again.kind, first.kind, `seed ${seed} round ${round}: same block`);
      assert.equal(again.driftPct, first.driftPct);
      assert.equal(again.volMul, first.volMul);
      assert.equal(again.roundsLeft, REGIME_BLOCK - (round - 1));
    }
    assert.equal(regimeAt(seed, 4).roundsLeft, REGIME_BLOCK, 'next block starts a new countdown');
    assert.deepEqual(regimeAt(seed, 7), regimeAt(seed, 7), 'deterministic');
  }
  const kinds = new Set();
  for (let seed = 1; seed <= 200; seed += 1) kinds.add(regimeAt(seed, 1).kind);
  assert.deepEqual([...kinds].sort(), ['bear', 'bull', 'calm'], 'all three moods appear');
});

test('共同市场因子在 ±15 内、有肥尾、可复现', () => {
  const moves = [];
  for (let seed = 1; seed <= 200; seed += 1) {
    for (let round = 2; round <= 14; round += 1) {
      const move = marketMoveAt(seed, round);
      assert.ok(Number.isFinite(move) && move >= -15 && move <= 15, `seed ${seed} round ${round}: ${move}`);
      assert.equal(move, marketMoveAt(seed, round), 'deterministic');
      moves.push(Math.abs(move));
    }
  }
  const rare = moves.filter((move) => move >= 5).length / moves.length;
  assert.ok(rare > 0.12 && rare < 0.28, `大行情占比应接近 20%，got ${rare.toFixed(3)}`);
  assert.ok(pctl(moves, 0.5) < 3.5, `多数回合是温和的，median ${pctl(moves, 0.5).toFixed(2)}`);
});

test('新闻：45% 左右出现，幅度 10..30%，股票合法、可复现', () => {
  let hits = 0;
  let total = 0;
  for (let seed = 1; seed <= 200; seed += 1) {
    for (let round = 1; round <= 14; round += 1) {
      total += 1;
      const news = newsAt(seed, round);
      if (!news) continue;
      hits += 1;
      assert.ok(Math.abs(news.pct) >= 10 && Math.abs(news.pct) <= 30, `news pct ${news.pct}`);
      assert.ok(STOCKS.some((stock) => stock.id === news.stockId), `news stock ${news.stockId}`);
      assert.ok(news.text.includes(news.company), 'the headline names the company');
      assert.equal(news.pct, newsAt(seed, round).pct, 'deterministic');
    }
  }
  const rate = hits / total;
  assert.ok(rate > 0.38 && rate < 0.52, `news rate ${rate.toFixed(3)}`);
});

// =====================================================================================================================
// 每回合涨跌 / 价格
// =====================================================================================================================

test('单回合涨跌恒在 ±45%，同 seed 同回合同股可复现', () => {
  for (const stock of STOCKS) {
    for (let seed = 1; seed <= 30; seed += 1) {
      const pct = roundPct({ seed, round: 5, stock, heat: 4, newsPct: 20 });
      assert.ok(Number.isFinite(pct) && Math.abs(pct) <= CLAMP_PCT, `${stock.id}: ${pct}`);
      assert.equal(pct, roundPct({ seed, round: 5, stock, heat: 4, newsPct: 20 }), 'deterministic');
    }
  }
  assert.notEqual(
    roundPct({ seed: 1, round: 5, stock: STOCKS[0] }),
    roundPct({ seed: 2, round: 5, stock: STOCKS[0] }),
    'different seeds move differently',
  );
});

test('价格两位小数，夹在 0.25..99.00；KAZ 的 1.00 开市价能跌', () => {
  assert.equal(nextPrice(3, 10), 3.3);
  assert.equal(nextPrice(1, -100), PRICE_FLOOR, 'the floor is now below KAZ\'s open');
  assert.equal(nextPrice(100, 100), PRICE_CEIL);
  assert.equal(nextPrice(0.25, -10), PRICE_FLOOR, 'a penny stock cannot go below the floor');
  assert.equal(nextPrice(2.4, 0), 2.4);
});

test('盟约冷热公式不变（业主同日否决「层数增长轮动」，只保留绝对层数/持有人）', () => {
  assert.equal(stockHeat(0, 0), -0.3);
  assert.equal(stockHeat(1, 0), 0.5);
  assert.equal(stockHeat(4, 100), 6, 'clamped at +6');
  assert.equal(stockHeat(0, -100), -2, 'clamped at -2');
});

// =====================================================================================================================
// 波动统计回归：固定种子，阈值比实测低一档，防止以后误调回「太小」
// =====================================================================================================================

test('1.3.0 波动下限：单回合中位数 ≥7.5%、p90 ≥17%、≥10% 占 ≥35%，13 次改价累计中位数 ≥25%', () => {
  const moves = [];
  const totals = [];
  let down = 0;
  for (let seed = 1; seed <= 200; seed += 1) {
    for (const stock of STOCKS) {
      let price = stock.base;
      for (let round = 2; round <= 14; round += 1) {
        const news = newsAt(seed, round);
        const newsPct = news && news.stockId === stock.id ? news.pct : 0;
        const pct = roundPct({ seed, round, stock, heat: 0, newsPct });
        const next = nextPrice(price, pct);
        moves.push(Math.abs(((next - price) / price) * 100));
        price = next;
      }
      const total = ((price - stock.base) / stock.base) * 100;
      totals.push(Math.abs(total));
      if (total < 0) down += 1;
    }
  }
  const median = pctl(moves, 0.5);
  const p90 = pctl(moves, 0.9);
  const bigShare = moves.filter((move) => move >= 10).length / moves.length;
  const totalMedian = pctl(totals, 0.5);
  const totalP90 = pctl(totals, 0.9);
  const downShare = down / totals.length;
  assert.ok(median >= 7.5, `单回合中位数 ${median.toFixed(2)}% (need ≥7.5)`);
  assert.ok(p90 >= 17, `单回合 p90 ${p90.toFixed(2)}% (need ≥17)`);
  assert.ok(bigShare >= 0.35, `|涨跌| ≥10% 占 ${(bigShare * 100).toFixed(1)}% (need ≥35)`);
  assert.ok(totalMedian >= 25, `13 次改价累计中位数 ${totalMedian.toFixed(1)}% (need ≥25)`);
  assert.ok(totalP90 >= 65, `13 次改价累计 p90 ${totalP90.toFixed(1)}% (need ≥65)`);
  assert.ok(downShare > 0.35 && downShare < 0.65, `下跌收场占 ${(downShare * 100).toFixed(1)}% (need 35–65)`);
});

// =====================================================================================================================
// 金额 / 数量：价格跌破 1 块之后，面板与服务端必须同一口径
// =====================================================================================================================

test('手续费与分红/利息/杠杆额度口径不变', () => {
  assert.equal(feeFor(9.99), 0);
  assert.equal(feeFor(10), 1);
  assert.equal(feeFor(5), 0);
  assert.equal(dividendOf(5, 10), Math.floor(5 * 10 * LIMITS.dividendBps));
  assert.equal(interestOf(0), 0);
  assert.equal(interestOf(100), 12);
  assert.equal(maxDebtFor(1, 50), 0);
  assert.equal(maxDebtFor(2, 50), 50);
  assert.equal(maxDebtFor(3, 50), 100);
});

test('价格 0.25 / 2.40 时「全部」按精确价计算，不再被 Math.trunc 放大或缩小', () => {
  // 10 块买 0.25 的股票：40 股刚好 10 块但要 1 块手续费 ⇒ 39 股（39 × 0.25 = 9.75，免手续费）。
  assert.equal(maxAffordable(10, 0.25), 39, 'old code said 10');
  assert.equal(maxAffordable(4, 0.25), 16);
  // 7 块买 2.40 的股票：3 股 7.20 超了 ⇒ 2 股（旧实现按整数价 2 算会给出 3 股，服务端必拒）。
  assert.equal(maxAffordable(7, 2.4, 60), 2, 'old code said 3');
  assert.equal(maxBuyable({ cash: 4, borrowRoom: 0, limits: { maxShares: 60 } }, 0.25), 16);
  const state = { cash: 4, borrowRoom: 0, limits: { maxShares: 60 }, stocks: [{ id: 'x', price: 0.25, shares: 0 }] };
  assert.equal(resolveQty('max', state, 'x', 'buy'), 16);
});

// =====================================================================================================================
// 假 Match：开市 → 买入 → 下一回合（分红/改价/大盘/情绪）→ 收盘
// =====================================================================================================================

class FakeBase {
  constructor() {
    this.seed = 0;
    this.round = 1;
    this.phase = 'PREP';
    this.players = new Map();
    this.sent = [];
    this.tickers = [];
  }
  startRound(round) { this.round = round; this.phase = 'PREP'; }
  enterPrep() {}
  startCombat() { this.phase = 'COMBAT'; }
  flush() {}
  finish() { this.phase = 'RESULT'; }
  handlePackMsg() { return false; }
  tickerText(text) { this.tickers.push(text); }
  sendTo(playerId, frame) { this.sent.push({ playerId, frame }); }
  reportError(where, error) { throw error; }
}

function fakeMatch(seed = 11) {
  let Wrapped = null;
  registerServer({ matchClass: (fn) => { Wrapped = fn(FakeBase); return true; } });
  assert.ok(Wrapped, 'registerServer wraps the match class');
  const m = new Wrapped();
  m.seed = seed;
  const ps = {
    playerId: 'p1', name: 'P1', seat: 0, isBot: false, left: false, alive: true,
    funds: 100, bonds: {}, layers: {},
    addFunds(amount) { this.funds += amount; },
  };
  m.players.set('p1', ps);
  return { m, ps };
}

const lastFrame = (m) => m.sent[m.sent.length - 1].frame.data;

test('假 Match：开市价=base、大盘=100；买入扣款；下一回合出分红/新价/大盘/情绪；收盘带大盘', () => {
  const { m, ps } = fakeMatch(11);
  m.startRound(1);
  const open = lastFrame(m);
  assert.equal(open.type, 'state');
  assert.equal(open.kind, 'open');
  assert.deepEqual(open.stocks.map((stock) => stock.price), STOCKS.map((stock) => stock.base));
  assert.equal(open.index.value, 100);
  assert.equal(open.index.chgPct, 0);
  assert.equal(open.sentiment.kind, regimeAt(11, 1).kind);
  assert.equal(open.marginPct, 0);

  m.handlePackMsg('p1', { pack: 'originium-exchange', channel: 'trade', data: { op: 'buy', stock: 'yanShip', qty: 2 } });
  assert.equal(ps.funds, 94, '2 × 3 块，成交额 6 块免手续费');
  const afterBuy = lastFrame(m);
  assert.equal(afterBuy.stocks.find((stock) => stock.id === 'yanShip').shares, 2);
  assert.equal(afterBuy.kind, 'trade');

  m.startRound(2);
  const round = lastFrame(m);
  assert.equal(round.kind, 'round');
  assert.equal(round.round, 2);
  assert.ok(round.stocks.every((stock) => Number.isFinite(stock.price) && stock.price >= PRICE_FLOOR && stock.price <= PRICE_CEIL));
  assert.ok(Number.isFinite(round.index.value) && round.index.value > 0);
  assert.ok(Number.isFinite(round.index.chgPct));
  assert.ok(['bull', 'bear', 'calm'].includes(round.sentiment.kind));
  assert.equal(round.limits.priceFloor, PRICE_FLOOR);
  assert.equal(round.limits.clampPct, CLAMP_PCT);

  // 同 seed 两局：价格序列必须完全一致（行情由 seed 决定，不读时钟）。
  const twin = fakeMatch(11);
  twin.m.startRound(1);
  twin.m.startRound(2);
  assert.deepEqual(round.stocks.map((stock) => stock.price), lastFrame(twin.m).stocks.map((stock) => stock.price));

  m.finish();
  const close = lastFrame(m);
  assert.equal(close.type, 'close');
  assert.ok(Number.isFinite(close.indexReturnPct));
  assert.equal(close.indexEnd, round.index.value);
  assert.ok(Array.isArray(close.rows));
});

// =====================================================================================================================
// 面板（假 DOM）：行情带、追保颜色、收盘大盘 —— 1.3.0 新增的渲染路径不抛错
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
  }
  get firstChild() { return this.childNodes[0] || null; }
  appendChild(child) { if (child.parentNode) child.parentNode.removeChild(child); child.parentNode = this; this.childNodes.push(child); return child; }
  removeChild(child) { const i = this.childNodes.indexOf(child); if (i >= 0) this.childNodes.splice(i, 1); child.parentNode = null; return child; }
  setAttribute(key, value) { this.attributes[key] = String(value); }
  addEventListener() {}
  removeEventListener() {}
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

/** 收集整棵假 DOM 里的 textContent（叶子节点）。 */
function textOf(node) {
  const out = [];
  const walk = (n) => { if (n.textContent) out.push(n.textContent); for (const child of n.childNodes || []) walk(child); };
  walk(node);
  return out.join(' ');
}

test('面板假 DOM：行情带（大盘/情绪）、追保预警与收盘大盘都按新帧渲染', () => {
  const { host } = fakeDoc();
  let onMarket = null;
  const ctx = {
    host,
    net: { on: (_channel, fn) => { onMarket = fn; return () => {}; }, send: () => true },
    me: { snapshot: () => ({ room: { inMatch: true } }) },
    log: { warn() {} },
  };
  const inst = mountPanel(ctx);
  assert.equal(typeof onMarket, 'function', 'the panel subscribes to market');

  const stocks = STOCKS.map((stock, i) => ({
    id: stock.id, ticker: stock.ticker, company: stock.company, bondName: stock.bondName,
    price: Math.round((stock.base + i * 0.1) * 100) / 100, chgPct: i % 2 ? -2 : 3,
    history: [stock.base, stock.base + 0.1], shares: i === 0 ? 2 : 0,
  }));
  onMarket({
    type: 'state', kind: 'round', round: 4, phase: 'PREP', closed: false, stocks,
    cash: 10, portfolio: 20, debt: 13, leverage: 2, borrowRoom: 0, netWorth: 17,
    index: { value: 112.4, chgPct: 3.1, history: [100, 112.4] },
    sentiment: { kind: 'bull', label: '牛市', driftPct: 2.5, roundsLeft: 2 },
    marginPct: 65, news: { text: '深海作业发生事故', stockId: 'egirShip', pct: -12 },
    dividend: 0, lastOrder: null, limits: { maxShares: 60 },
  });

  const text = textOf(host);
  assert.match(text, /源石指数 112\.4 \+3\.1%/, text.slice(0, 300));
  assert.match(text, /市场情绪 牛市 · 剩 2 回合/);
  assert.match(text, /负债率 65% · 追保 70%/);
  assert.match(text, /单回合 ±45%/, 'footer carries the new rules');

  onMarket({
    type: 'close', out: false, netWorth: 17, rank: 1, ofPlayers: 2, debt: 13, liquidation: 0,
    rows: [{ name: 'P1', seat: 0, netWorth: 17, isMe: true }], stocks: [],
    feesPaid: 0, interestPaid: 0, dividendsPaid: 0, indexEnd: 112.4, indexReturnPct: 8.6,
  });
  assert.match(textOf(host), /本局大盘 \+8\.6%/);
  inst.unmount();
});

