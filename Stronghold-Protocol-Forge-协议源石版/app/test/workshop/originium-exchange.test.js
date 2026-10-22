// test/workshop/originium-exchange.test.js — 「源石证券交易所」的行情模型、金额口径与面板纯函数。
//
// 业主 2026-10-21：「优化交易所 mod，现在波动性还是太小了」+「不要盟约业绩（股票跟着层数增长轮动）」。
// 这一份钉住三件事：
//   * 行情由「情绪漂移×beta + 共同市场×beta + 个股噪声 + 冷热 + 新闻」组成，单回合夹 ±45%；
//   * 波动**不能再悄悄调小**：固定种子下的中位数/p90/大行情占比有下限（统计回归，不是快照）；
//   * 价格能跌破 1 块之后，「全部」与服务端的金额口径仍然一致（`maxAffordable` 不再整数化）。
//
// 1.4.0（业主 2026-10-22「交易行增加到5倍杠杆」+「增加显示模式（无小数点）」）追加两组：
//   * 杠杆 4x / 5x 的额度，以及**按档位**的维持担保比例（1–3 档一个字都没动，旧手感不回归）；
//   * 显示模式的纯函数（`formatPrice`）与「切换不改成交额」的边界。

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  STOCKS, LIMITS, PRICE_FLOOR, PRICE_CEIL, CLAMP_PCT, REGIME_BLOCK, NEWS_CHANCE,
  regimeAt, marketMoveAt, newsAt, roundPct, nextPrice, stockHeat, dividendOf, interestOf, maxDebtFor, registerServer,
  marginPctFor, liquidateToPctFor,
} from '../../workshop/originium-exchange/server/exchange.mjs';
import {
  feeFor, maxAffordable, maxBuyable, resolveQty, formatPrice, mount as mountPanel,
} from '../../workshop/originium-exchange/ui/exchange.js';

const BONDS = JSON.parse(readFileSync(new URL('../../data/bonds.json', import.meta.url), 'utf8'));

const pctl = (values, p) => {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(p * (sorted.length - 1))];
};
/** 与包内 `round2` 同一口径（两位小数），只在测试里改价时用。 */
const round2Local = (value) => Math.round((Number(value) || 0) * 100) / 100;

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

// =====================================================================================================================
// 1.4.0（业主 2026-10-22「交易行增加到5倍杠杆」）：4x / 5x 与**按档位**的维持担保比例
// =====================================================================================================================

test('1.4.0 杠杆：档位 1..5；4x 借 3 倍净资产、5x 借 4 倍', () => {
  assert.deepEqual([...LIMITS.leverage], [1, 2, 3, 4, 5]);
  assert.equal(maxDebtFor(4, 50), 150, '4x ⇒ 3× equity');
  assert.equal(maxDebtFor(5, 50), 200, '5x ⇒ 4× equity');
  assert.equal(maxDebtFor(9, 50), 0, 'an unknown level never lends');
});

test('1.4.0 维持担保比例按档位：1–3 档仍是 70/50，4x/5x 放宽到 88/93', () => {
  assert.deepEqual({ ...LIMITS.marginByLever }, { 1: 70, 2: 70, 3: 70, 4: 88, 5: 93 });
  assert.deepEqual({ ...LIMITS.liquidateByLever }, { 1: 50, 2: 50, 3: 50, 4: 82, 5: 87 });
  for (const level of [1, 2, 3]) {
    assert.equal(marginPctFor(level), 70, `${level}x keeps the old threshold`);
    assert.equal(liquidateToPctFor(level), 50, `${level}x keeps the old target`);
  }
  assert.equal(marginPctFor(5), 93);
  assert.equal(marginPctFor(99), 70, 'an unknown level falls back to the default');
  // 光加档位是玩不了的：满仓的静止担保比例是 (L-1)/L —— 4x = 75%、5x = 80%。阈值必须在其之上，
  // 否则「满仓一开市就被强平」，那一档等于不存在。
  for (const level of [2, 3, 4, 5]) {
    const stationary = ((level - 1) / level) * 100;
    assert.ok(marginPctFor(level) > stationary, `${level}x: 追保 ${marginPctFor(level)}% must clear the ${stationary.toFixed(1)}% of a full book`);
  }
  // 而放宽也不许变成免费午餐：5x 满仓离 93% 只剩 13 个百分点，一根中位数 8% 的阴线就够触线。
  assert.ok(marginPctFor(5) - 80 <= 15, '5x full book stays within one bad day of the call');
});

test('1.4.0 假 Match：5x 满仓（担保比例 ≈80%）不会被强平，而旧 70% 阈值下它必被平', () => {
  const { m, ps } = fakeMatch(23);
  ps.funds = 200;
  m.startRound(1);
  // 切到 5x，然后**按面板的口径**买满：maxBuyable 用的是服务端下发的 borrowRoom，与实际能借到的完全一致。
  m.handlePackMsg('p1', { pack: 'originium-exchange', channel: 'trade', data: { op: 'lever', level: 5 } });
  assert.equal(lastFrame(m).leverage, 5);
  assert.equal(lastFrame(m).maintainPct, 93, 'the frame carries THIS tier\'s threshold');
  for (const stock of ['kazimierzShip', 'victoriaShip', 'yanShip', 'siracusaShip', 'egirShip', 'kjeragShip']) {
    const frame = lastFrame(m);
    const price = frame.stocks.find((row) => row.id === stock).price;
    const qty = maxBuyable(frame, price, frame.limits.maxShares);
    if (qty > 0) {
      m.handlePackMsg('p1', { pack: 'originium-exchange', channel: 'trade', data: { op: 'buy', stock, qty, lever: 5 } });
    }
  }
  const full = lastFrame(m);
  assert.equal(full.debt > 0, true, 'the book is on margin');
  assert.ok(full.marginPct > 70, `满仓担保比例应超过旧阈值 70%，got ${full.marginPct}`);
  assert.ok(full.marginPct <= 80.5, `5x 满仓的静止担保比例约 80%，got ${full.marginPct}`);
  // 5x 的 93% 阈值：此刻不该平仓（旧代码里 70% 会在这一秒直接平掉一半仓位）。
  assert.equal(m._oexLiquidate(ps), 0, 'no liquidation at the 5x threshold');
  assert.equal(lastFrame(m).debt, full.debt, 'and the debt is untouched');
  // 反证：把价格砍掉 25% 之后必须真的平仓，否则放宽阈值就成了「永不爆仓」。
  const stocks = m._oexState().prices;
  for (const id of Object.keys(stocks)) stocks[id] = round2Local(stocks[id] * 0.75);
  assert.ok(m._oexLiquidate(ps) > 0, 'a 25% crash still liquidates');
});

test('1.4.0 换档：5x 的额度按 4 倍净资产算，下行帧广播全部五档', () => {
  const { m, ps } = fakeMatch(31);
  ps.funds = 100;
  m.startRound(1);
  m.handlePackMsg('p1', { pack: 'originium-exchange', channel: 'trade', data: { op: 'lever', level: 5 } });
  assert.equal(lastFrame(m).leverage, 5);
  // 100 块现金 + 4× 额度 ⇒ 30 股 6 块的谢拉格矿业 = 180 + 手续费 2（≥10 块收 1%，四舍五入）= 182，
  // 自有 100，所以借 82。这仍然远在 4×100 的额度之内。
  m.handlePackMsg('p1', { pack: 'originium-exchange', channel: 'trade', data: { op: 'buy', stock: 'kjeragShip', qty: 30, lever: 5 } });
  const afterBuy = lastFrame(m);
  assert.equal(afterBuy.debt, 82, `付不起的 82 块借下来，got ${afterBuy.debt}`);
  assert.equal(afterBuy.limits.leverage.join(','), '1,2,3,4,5', 'the frame advertises all five tiers');
  assert.deepEqual({ ...afterBuy.limits.marginByLever }, { 1: 70, 2: 70, 3: 70, 4: 88, 5: 93 }, 'and their thresholds');
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
    /** 假 DOM 的事件表：面板把 click 委托在 root 上，测试用 `clickNode` 直接调它。 */
    this.listeners = {};
    /**
     * 滚动位置。真浏览器里 `scrollTop` 有个关键行为：**内容高度归 0 时会被夹回 0** ——
     * 「先清空子节点、再塞回去」这种重画方式会因此丢失滚动位置（业主报的「买完跳回最上端」就是它）。
     * 这里把它模拟出来，回归用例才能真的抓到那个 bug（`_maxScroll` 由测试按行数设置）。
     */
    this.scrollTop = 0;
    this._maxScroll = 0;
  }
  get firstChild() { return this.childNodes[0] || null; }
  appendChild(child) { if (child.parentNode) child.parentNode.removeChild(child); child.parentNode = this; this.childNodes.push(child); return child; }
  /** 清空子节点 = 内容高度归 0 ⇒ 浏览器把 scrollTop 夹到 0（真 DOM 的行为，见上面的注释）。 */
  removeChild(child) {
    const i = this.childNodes.indexOf(child);
    if (i >= 0) this.childNodes.splice(i, 1);
    child.parentNode = null;
    if (!this.childNodes.length) this.scrollTop = 0;
    return child;
  }
  setAttribute(key, value) { this.attributes[key] = String(value); }
  addEventListener(type, fn) { (this.listeners[type] ||= []).push(fn); }
  removeEventListener(type, fn) { this.listeners[type] = (this.listeners[type] || []).filter((f) => f !== fn); }
  /** 只支持面板用到的两个选择器：`[data-action]` / `[data-stock]`（真实 DOM 的 closest 子集）。 */
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

// =====================================================================================================================
// 1.4.0 显示模式（业主 2026-10-22「增加显示模式（无小数点）可在原本与无小数点间切换」，
// 同日口径补充「不显示小数模式是*100（只改变显示）」）
// =====================================================================================================================

test('1.4.0 formatPrice：保留小数是原来的两位；无小数点是把价格 ×100 的整数', () => {
  assert.equal(formatPrice(3, 'decimal'), '3.00');
  assert.equal(formatPrice(3.04, 'decimal'), '3.04');
  assert.equal(formatPrice(0.25, 'decimal'), '0.25');
  assert.equal(formatPrice(99, 'decimal'), '99.00');
  // 无小数点 = 小数点右移两位（两位小数 ⇒ 分），**信息一点不丢**：
  //   3.04 → 304、0.25 → 25、99 → 9900、1 → 100。不是四舍五入 —— 那会把 3.04 抹成 3、0.25 抹成 0。
  assert.equal(formatPrice(3, 'integer'), '300');
  assert.equal(formatPrice(1, 'integer'), '100');
  assert.equal(formatPrice(3.04, 'integer'), '304');
  assert.equal(formatPrice(3.5, 'integer'), '350');
  assert.equal(formatPrice(0.25, 'integer'), '25');
  assert.equal(formatPrice(0.4, 'integer'), '40');
  assert.equal(formatPrice(0, 'integer'), '0');
  assert.equal(formatPrice(99, 'integer'), '9900');
  assert.equal(formatPrice(6.01, 'integer'), '601', 'no 600.9999 tail from the ×100');
  // 同一个价的两种写法必须能互相还原：integer / 100 === decimal 的数值
  for (const price of [0.25, 1, 2.4, 3.04, 6.01, 99]) {
    assert.equal(Number(formatPrice(price, 'integer')) / 100, Math.round(price * 100) / 100, `${price} round-trips`);
  }
  // 模式不认识时按默认（两位小数）：旧面板 / 脏 localStorage 不会画出一堆 NaN
  assert.equal(formatPrice(2.5, 'nope'), '2.50');
  assert.equal(formatPrice(2.5, undefined), '2.50');
});

test('1.4.0 面板假 DOM：杠杆按钮按下发帧建 5 档、追保标 93%、显示模式切换只重画价格', () => {
  const { host } = fakeDoc();
  let onMarket = null;
  const sent = [];
  const ctx = {
    host,
    net: { on: (_channel, fn) => { onMarket = fn; return () => {}; }, send: (channel, data) => { sent.push([channel, data]); return true; } },
    me: { snapshot: () => ({ room: { inMatch: true } }) },
    log: { warn() {} },
  };
  const inst = mountPanel(ctx);
  // 面板把 click 委托在自己的根节点上（`ctx.host` 的第一个子节点），不是 host 本身。
  const root = host.firstChild;
  const click = (selectorNode) => {
    for (const fn of root.listeners.click || []) fn({ target: selectorNode });
  };

  const stocks = STOCKS.map((stock) => ({
    id: stock.id, ticker: stock.ticker, company: stock.company, bondName: stock.bondName,
    price: stock.base, chgPct: 0, history: [stock.base], shares: 0,
  }));
  const frame = (extra = {}) => ({
    type: 'state', kind: 'round', round: 5, phase: 'PREP', closed: false, stocks,
    cash: 40, portfolio: 0, debt: 0, leverage: 5, borrowRoom: 0, netWorth: 40,
    maintainPct: 93, index: { value: 100, chgPct: 0, history: [100] },
    sentiment: { kind: 'calm', label: '平静', driftPct: 0, roundsLeft: 2 },
    marginPct: 0, news: null, dividend: 0, lastOrder: null,
    limits: { maxShares: 60, leverage: [1, 2, 3, 4, 5], maintainPct: 70, marginByLever: { 1: 70, 2: 70, 3: 70, 4: 88, 5: 93 } },
    ...extra,
  });
  onMarket(frame());

  // 五颗杠杆按钮（不是写死的三颗），当前档位高亮
  const levBtns = [];
  const collect = (node) => {
    if (node.dataset && node.dataset.action === 'lever') levBtns.push(node);
    for (const child of node.childNodes || []) collect(child);
  };
  collect(host);
  assert.deepEqual(levBtns.map((btn) => btn.dataset.lever), ['1', '2', '3', '4', '5'], 'the tiers come from limits.leverage');
  assert.equal(levBtns.find((btn) => btn.dataset.lever === '5').classList.contains('is-active'), true, '5x is highlighted');
  // 按下 4x ⇒ 发一帧 lever 订单
  click(levBtns.find((btn) => btn.dataset.lever === '4'));
  assert.deepEqual(sent.pop(), ['trade', { op: 'lever', level: 4 }]);

  // 无负债时的提示：可借额度 / 追保阈值
  assert.match(textOf(host), /追保 93%/);

  // 显示模式：默认两位小数 ⇒ 切换成无小数点后价格文字变了，但没有发出任何一条消息
  assert.match(textOf(host), /6\.00/);
  const dispBtns = [];
  const collectDisp = (node) => {
    if (node.dataset && node.dataset.action === 'display') dispBtns.push(node);
    for (const child of node.childNodes || []) collectDisp(child);
  };
  collectDisp(host);
  assert.deepEqual(dispBtns.map((btn) => btn.dataset.mode), ['decimal', 'integer']);
  assert.equal(dispBtns.find((btn) => btn.dataset.mode === 'decimal').classList.contains('is-active'), true);
  const before = sent.length;
  click(dispBtns.find((btn) => btn.dataset.mode === 'integer'));
  assert.equal(sent.length, before, 'switching the display mode sends nothing to the server');
  const afterText = textOf(host);
  assert.ok(!/6\.00/.test(afterText), `no two-decimal price is left: ${afterText.slice(0, 200)}`);
  assert.match(afterText, /价格 ×100 · 仅显示，成交按两位小数/);
  // 开市价 3 / 2 / 5 / 1 / 6 / 4 ⇒ ×100 之后是 300 / 200 / 500 / 100 / 600 / 400
  assert.match(afterText, /600/);
  assert.match(afterText, /300/);
  inst.unmount();
});

test('1.4.0 显示模式是纯显示：×100 只是写法，成交额一分不差', () => {
  // 这条用例守的是边界：显示模式只影响画出来的字符串。`maxAffordable` / `resolveQty` / 手续费都拿真实价算，
  // 与显示模式无关 —— 「屏幕上写 304 其实是 3.04 块」不会变成「少付 4 分钱」，也不会变成「按 304 块一单」。
  const real = 3.04;
  assert.equal(formatPrice(real, 'integer'), '304', 'the screen shifts the point, it does not round');
  assert.equal(Number(formatPrice(real, 'integer')) / 100, real, '×100 is reversible: no information is lost');
  assert.equal(maxAffordable(10, real, 60), maxAffordable(10, real, 60), 'the arithmetic ignores the mode');
  assert.equal(feeFor(100), 1, 'and so does the fee');
  // 反证：如果有人真按显示出来的 304 去算，能买的股数会差出两个数量级 —— 这不可能是同一个价。
  assert.notEqual(Math.trunc(real), real, 'the displayed integer is not the settlement price');
  assert.ok(maxAffordable(10, real, 60) > maxAffordable(10, 304, 60), 'quoting off the display would tank the count');
});

// =====================================================================================================================
// 滚动位置（业主 2026-10-22 报的「交易所的滑动条在购买后会回到最上端，有bug」）
//
// 病因：`.oex__list` 是 `overflow-y: auto` 的滚动容器，而每收到一帧行情都会 `while (list.firstChild) removeChild(...)`
// 再逐行 append。真浏览器里子节点清空的那一刻内容高度归 0，`scrollTop` 被夹回 0 —— 再塞回同样高的内容也回不去。
// 而每次下单服务端都会回一帧 `state`（买卖回执），所以「买一手就跳回最上面」。
//
// 假 DOM 的 ShimEl.removeChild 把「清空 ⇒ scrollTop 归零」这一条真行为模拟了出来，所以这组用例能真的抓到它。
// =====================================================================================================================

/** 建一个面板 + 一帧行情，返回 { inst, onMarket, list, sent, click }。list 是滚动容器 `.oex__list`。 */
function panelWithStocks() {
  const { host } = fakeDoc();
  let onMarket = null;
  const sent = [];
  const ctx = {
    host,
    net: { on: (_channel, fn) => { onMarket = fn; return () => {}; }, send: (channel, data) => { sent.push([channel, data]); return true; } },
    me: { snapshot: () => ({ room: { inMatch: true } }) },
    log: { warn() {} },
  };
  const inst = mountPanel(ctx);
  const root = host.firstChild;
  const find = (node, pred, out = []) => {
    if (pred(node)) out.push(node);
    for (const child of node.childNodes || []) find(child, pred, out);
    return out;
  };
  const list = find(host, (n) => String(n.className).split(/\s+/).includes('oex__list'))[0];
  const frame = (over = {}) => ({
    type: 'state', kind: 'round', round: 5, phase: 'PREP', closed: false,
    stocks: STOCKS.map((s) => ({ id: s.id, ticker: s.ticker, company: s.company, bondName: s.bondName, price: s.base, chgPct: 0, history: [s.base], shares: 0 })),
    cash: 40, portfolio: 0, debt: 0, leverage: 1, borrowRoom: 0, netWorth: 40, maintainPct: 70,
    index: { value: 100, chgPct: 0, history: [100] },
    sentiment: { kind: 'calm', label: '平静', driftPct: 0, roundsLeft: 2 },
    marginPct: 0, news: null, dividend: 0, lastOrder: null,
    limits: { maxShares: 60, leverage: [1, 2, 3, 4, 5], maintainPct: 70, marginByLever: { 1: 70, 2: 70, 3: 70, 4: 88, 5: 93 } },
    ...over,
  });
  const click = (node) => { for (const fn of root.listeners.click || []) fn({ target: node }); };
  return { inst, onMarket, list, sent, click, frame, find };
}

test('滚动位置：买入后的回执帧不会把列表跳回最上端', () => {
  const { inst, onMarket, list, sent, click, frame, find } = panelWithStocks();
  onMarket(frame());
  assert.ok(list, 'the panel renders a scroll container');
  // 玩家往下滚到第 3 行
  list._maxScroll = 200;
  list.scrollTop = 120;

  // 点「买」⇒ 面板发一帧订单，服务端回一帧 state（买卖回执，kind: 'trade'）
  const buyBtn = find(list, (n) => n.dataset && n.dataset.action === 'buy')[0];
  assert.ok(buyBtn, 'a buy button exists');
  click(buyBtn);
  assert.deepEqual(sent.pop(), ['trade', { op: 'buy', stock: STOCKS[0].id, qty: 1, lever: 1 }]);
  onMarket(frame({ kind: 'trade', lastOrder: { ok: true, text: '买入 1 股' } }));
  assert.equal(list.scrollTop, 120, 'the scroll position survives the receipt frame');
  inst.unmount();
});

test('滚动位置：round / sync 帧、以及切换显示模式也都不动滚动位置', () => {
  const { inst, onMarket, list, click, frame, find } = panelWithStocks();
  onMarket(frame());
  list._maxScroll = 200;
  list.scrollTop = 90;

  // 下一回合的行情帧
  onMarket(frame({ kind: 'round', round: 6 }));
  assert.equal(list.scrollTop, 90, 'a round frame keeps it');
  // 资金变化的补帧
  onMarket(frame({ kind: 'sync', cash: 33 }));
  assert.equal(list.scrollTop, 90, 'a sync frame keeps it');
  // 切换显示模式（纯本机、也走同一条重画路径）
  const dispBtn = find(list.parentNode, (n) => n.dataset && n.dataset.action === 'display')[0];
  assert.ok(dispBtn, 'a display-mode button exists');
  click(dispBtn);
  assert.equal(list.scrollTop, 90, 'switching the display mode keeps it');
  inst.unmount();
});

test('滚动位置：停在顶部时不写回正数（不白触发一次 scroll）', () => {
  const { inst, onMarket, list, frame } = panelWithStocks();
  onMarket(frame());
  list._maxScroll = 200;
  list.scrollTop = 0;
  // 记下每一次写入的值。清空子节点时浏览器自己会把 scrollTop 夹到 0（那是一次合理的写入），
  // 这里要守的是**我们自己不往上面写一个正数** —— 顶部时写回就是白触发一次 scroll 事件。
  const writes = [];
  let current = 0;
  Object.defineProperty(list, 'scrollTop', {
    configurable: true,
    get: () => current,
    set: (v) => { writes.push(v); current = v; },
  });
  onMarket(frame({ kind: 'round', round: 6 }));
  assert.deepEqual(writes.filter((v) => v > 0), [], 'nothing writes back a positive scrollTop');
  inst.unmount();
});

