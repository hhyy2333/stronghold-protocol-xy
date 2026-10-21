// server/exchange.mjs —— 「源石证券交易所」工坊包的服务端模块（pack.json.server.modules[].entry）。
//
// 装载点：`uses: ["matchClass"]`（docs/WORKSHOP.md §1.12，DESIGN §28.14）。引擎在装载期先做一次源码静态扫描
// （process / globalThis / require / eval / new Function 一律拒），再 `import()` 并调用 `registerServer(host)`；
// 宿主把这里返回的那一层按包 id 次序套在 MatchClass 上。**这是唯一能碰到整局对局的挂载点**，所以包的
// pack.json 必须同时声明 `combat: true`（MODULES_NEED_COMBAT）—— 进房间摘要闸门，两端字节一致。
//
// 交易所的一切都在服务端裁决：行情、分红、利息、爆仓、手续费、持股、资金增减。客户端面板只画、只发自己的通道
// 消息（docs/WORKSHOP.md §1.9.3/§1.9.6：面板拿不到 store、拿不到对局对象，改不了对局结果）。
//
// 这个文件**零 import**：常量、行情、随机源、记账全在同一个文件里 —— 包的入口模块不跨包 import，也不 import
// 引擎内部（同一份字节要在服务器上跑，就得自己带齐）。所有覆写都包在 try/catch 里：mod 的行情坏了最多是
// 「交易所不动」，绝不允许把一局打崩。
//
// ===== 为什么股价是 1..6 块，以及为什么有杠杆（业主 2026-10-20 口径；基础价各减 2 之后的区间）=====
// 引擎的经济是**每回合重置**的：`data/config.json` 的 `economy.income` 是 0/4/5/6/…/12，而且
// `economy.leftoverFundsLost = true` —— 休整期结束时没用完的钱直接清零（只有 `band_cannot` 留得住）。
// 所以「每股 100 块」在这个经济里是**一单都买不起**的摆设：整局总收入约 130，一单起步就 100。
// 1..6 块让「每回合买 1~3 股」成为真选择；杠杆让「借钱建仓、以后用分红还」成为真赌注 ——
// 利息、维持担保比例、爆仓都在下面，全部由服务端裁决。

/** 包 id（线上 `pack.msg` 的 `pack` 字段；必须与 pack.json 的 id 逐字相同）。 */
const PACK_ID = 'originium-exchange';
/** 面板 → 服务端（面板 `messages` 声明过；server.modules[].channels 里也声明过）。 */
const TRADE_CHANNEL = 'trade';
/** 服务端 → 面板（只下发；服务端模块不需要声明一个自己**接收**的通道）。 */
const MARKET_CHANNEL = 'market';
/** 可以交易的对局相位：只有休整期。字符串与 shared/constants.js 的 PHASE.PREP 同值（不 import 引擎）。 */
const PHASE_PREP = 'PREP';

/**
 * 六支「盟约概念股」。`bond` 是官方 data/bonds.json 里的盟约 id —— 这里**只读**它判断冷热
 * （有几名玩家在玩这个盟约、叠了多少层），一个字节都不改官方数据。
 * `vol` 是个股波动倍率：越「故事多」的股票摆得越大。`base` 是开市价（1..6，理由见文件头）。
 *
 * 业主 2026-10-20：「股票的基础价格都减少 2」→ 7/6/9/5/10/8 → 5/4/7/3/8/6；同日「基础价格都再减 2」→
 *   5/4/7/3/8/6 → **3/2/5/1/6/4**（1~6 块一股）。
 *   注：KAZ 开市价正好 1.00，1.3.0 把 `PRICE_FLOOR` 降到 0.25 之后它终于能跌了。
 * 业主 2026-10-20（同日）：「波动率增加」：每一支的 `vol` 统一 ×1.5（0.95/1.1/1.2/1.25/0.85/1.3 →
 *   1.43/1.65/1.8/1.88/1.28/1.95），个股之间的相对性格不变（谢拉格最稳、阿戈尔最野）。
 *
 * ===== v1.3.0（业主 2026-10-21「波动性还是太小了」）=====
 * 纯 IID 噪声太安静，行情像锯齿。现在每回合的涨跌由三块乘区加两块基本面组成：
 *   `pct = clamp( 情绪漂移×beta + 共同市场×beta + 个股噪声 + 盟约冷热 + 新闻, -45, +45 )`
 *   * **市场情绪**：3 回合一块（35% 牛市 +2.5%/回合、30% 熊市 -2.5%、35% 平静），块内方向不变 —— 行情有趋势；
 *   * **共同市场**：80% 幅度 0..5%、20% 幅度 5..15%，方向对半 —— 六支一起大起大落；
 *   * **个股噪声**：(2u−1)×`IDIO_PCT`×`vol`×情绪波动倍率；
 *   * **盟约冷热**：原公式（绝对层数/持有人，业主同日明确**不要**「层数增长轮动」的业绩机制）；
 *   * **新闻**：45% 一回合一条，单股 ±10~30%。
 * 单回合夹 ±45%、股价 0.25..99.00（地板从 1.00 降下来，KAZ 才跌得动）；「源石大盘」= 六支 (price/base) 的等权均值。
 * 实测（300 种子）：单回合 |涨跌| 中位数 5.7% → 8.1%（p90 11.2% → 19.5%），13 次改价累计中位数 17.0% → 29.0%。
 */
export const STOCKS = Object.freeze([
  // `beta` 是这支股票对共同市场因子的敏感度：谢拉格矿业最稳，阿戈尔深海科技最野。
  { id: 'yanShip', ticker: 'YAN', company: '尚蜀重工', bondName: '炎', base: 3, vol: 1.43, beta: 0.8 },
  { id: 'victoriaShip', ticker: 'VIC', company: '伦蒂尼姆兵工', bondName: '维多利亚', base: 2, vol: 1.65, beta: 1.0 },
  { id: 'siracusaShip', ticker: 'SIR', company: '叙拉古食品', bondName: '叙拉古', base: 5, vol: 1.8, beta: 1.1 },
  { id: 'kazimierzShip', ticker: 'KAZ', company: '卡西米尔骑士竞技', bondName: '卡西米尔', base: 1, vol: 1.88, beta: 1.4 },
  { id: 'kjeragShip', ticker: 'KJE', company: '谢拉格矿业', bondName: '谢拉格', base: 6, vol: 1.28, beta: 0.6 },
  { id: 'egirShip', ticker: 'AEG', company: '阿戈尔深海科技', bondName: '阿戈尔', base: 4, vol: 1.95, beta: 1.5 },
]);

/**
 * 交易规则。数值都在这里，UI 从下发帧的 `limits` 里读同一份（面板不写死第二份）。
 *
 * 杠杆：
 *   * `leverage` 是可选档位，1 = 不借钱；2 / 3 = 最多借到 (档位-1) 倍净资产；
 *   * `interestBps` 每回合对未清负债计息（12%），付不出就**资本化进负债**（利滚利）；
 *   * `maintainPct` 维持担保比例：负债 / 持仓市值 超过 70% ⇒ **强制平仓**，卖到 ≤ 50% 为止。
 *
 * **分红率必须显著低于借款利率**（2026-10-20 收益测试）：分红按**全部持仓**发，利息只按**负债**收 ——
 * 只要分红率 > 利率 × 负债/持仓，借钱满仓就是正期望的印钞机（实测 30/30 全胜）。
 * 现在 1.2% 对 12%：2x 档满仓时负债 ≈ 1× 净资产，利息 ≈ 持仓市值的 12%，
 * 分红只有 1.2% —— 借钱买股变成真赌注，而且**红利本身也不再是免费午餐**。
 */
export const LIMITS = Object.freeze({
  maxShares: 60,
  commissionBps: 100,
  dividendBps: 120,
  leverage: Object.freeze([1, 2, 3]),
  interestBps: 1200,
  maintainPct: 70,
  liquidateToPct: 50,
});
export const PRICE_FLOOR = 0.25;
export const PRICE_CEIL = 99;
/** 价格保留两位小数（见 nextPrice 的说明）。 */
const PRICE_DECIMALS = 2;
const HISTORY_LENGTH = 15;
/** 单回合涨跌幅夹逼（百分点）。1.3.0 从 ±25 放宽到 ±45。 */
export const CLAMP_PCT = 45;

/** 市场情绪：每 3 回合一块，块内方向与波动倍率不变。 */
export const REGIME_BLOCK = 3;
const REGIMES = Object.freeze({
  bull: Object.freeze({ kind: 'bull', label: '牛市', driftPct: 2.5, volMul: 1.15 }),
  bear: Object.freeze({ kind: 'bear', label: '熊市', driftPct: -2.5, volMul: 1.25 }),
  calm: Object.freeze({ kind: 'calm', label: '平静', driftPct: 0, volMul: 1 }),
});
/** 块内抽取：r < 0.35 牛市、r < 0.65 熊市、否则平静（35% / 30% / 35%）。 */
const REGIME_BULL_BELOW = 0.35;
const REGIME_BEAR_BELOW = 0.65;

/** 个股噪声幅度：±IDIO_PCT × vol × 情绪波动倍率。 */
const IDIO_PCT = 8;
/** 共同市场因子：80% 幅度 0..5，20% 幅度 5..15，方向对半。 */
const MARKET_COMMON_SHARE = 0.8;
const MARKET_COMMON_MAX = 5;
const MARKET_RARE_MAX = 15;

/** 每回合出新闻的概率（45%）；单股幅度 10..30%。 */
export const NEWS_CHANCE = 0.45;
const NEWS_MIN = 10;
const NEWS_MAX = 30;
/** 手续费门槛：低于这个成交额不收（5 块的单收 1 块等于 20%，那不是手续费是惩罚）。 */
const FEE_FREE_BELOW = 10;

/** 新闻模板：`dir` 是方向（利好 +1 / 利空 -1），幅度每次在 10..30% 里抽。 */
const NEWS = Object.freeze([
  { text: '拿到一笔跨城大单', dir: 1 },
  { text: '挖到一条新矿脉', dir: 1 },
  { text: '新产品被抢购一空', dir: 1 },
  { text: '联赛夺冠，赞助商追加预算', dir: 1 },
  { text: '拿到一笔政策补贴', dir: 1 },
  { text: '科考队带回重大发现', dir: 1 },
  { text: '矿区发生塌方，供给中断', dir: -1 },
  { text: '订单被竞争对手截胡', dir: -1 },
  { text: '被曝出财务丑闻', dir: -1 },
  { text: '主力干员转会离队', dir: -1 },
  { text: '深海作业发生事故', dir: -1 },
  { text: '监管新规收紧，成本上升', dir: -1 },
]);

// =====================================================================================================================
// 确定性随机（不碰 Math.random、不读时钟）
// =====================================================================================================================

/** FNV-1a 32 位：把股票 id / 盐混进种子。 */
function fnv1a(text) {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i += 1) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

/** mulberry32：32 位状态、无浮点累积误差；同一 seed ⇒ 同一序列。 */
function mulberry32(state) {
  let a = state >>> 0;
  return function rand() {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** 一局 × 一回合 × 一支股票 = 一条独立、可复现的随机流。 */
function rngAt(matchSeed, round, salt) {
  const seed = ((matchSeed >>> 0) ^ fnv1a(String(salt)) ^ Math.imul(round >>> 0, 0x9e3779b1)) >>> 0;
  return mulberry32(seed);
}

const clamp = (value, lo, hi) => Math.max(lo, Math.min(hi, value));

/** 手续费：成交额 ≥ FEE_FREE_BELOW 才收，万分之 commissionBps（1%），四舍五入，至少 1。 */
function feeOf(amount) {
  if (!(amount >= FEE_FREE_BELOW)) return 0;
  return Math.max(1, Math.round((amount * LIMITS.commissionBps) / 10000));
}

/** 百分比口径统一到一位小数，避免下发帧里出现 3.1000000000000005。 */
const oneDecimal = (value) => Math.round(value * 10) / 10;
const nonNegInt = (value) => (Number.isFinite(value) && value > 0 ? Math.trunc(value) : 0);

/**
 * 一支股票本回合的「盟约冷热」偏移（百分点）。
 * 玩这个盟约的人越多、叠的层越高，越看涨；没人玩的盟约阴跌一点点。
 *
 * 那个常数项曾经是 **−1.0**（2026-10-20 收益测试前）：solo 局只有一个玩家、最多激活两三个盟约，
 * 于是**大部分股票每回合被拖 −1%**，9 回合下来整盘阴跌（实测 kazimierzShip −42.6%）。
 * 改成 **−0.3** 并把下限收到 −2：没人在玩仍然略微看跌，但不至于让「整个市场长期向下」。
 * @param {number} holders 本局活着的、激活了这个盟约的玩家数（真人 + AI）
 * @param {number} layers 这些玩家在该盟约上的累计层数
 */
export function stockHeat(holders, layers) {
  return clamp(holders * 0.8 + layers * 0.1 - 0.3, -2, 6);
}

/**
 * 市场情绪（纯函数）：每 `REGIME_BLOCK` 回合一块，同块内 `kind / driftPct / volMul` 恒定。
 * 用块号（而不是回合号）做随机盐，所以「第 4~6 回合是牛市」这种节奏是确定的、可复现的。
 * @param {number} seed 对局种子
 * @param {number} round 回合（1 起）
 * @returns {{ kind: string, label: string, driftPct: number, volMul: number, block: number, roundsLeft: number }}
 */
export function regimeAt(seed, round) {
  const r = Number.isFinite(round) ? Math.max(1, Math.trunc(round)) : 1;
  const block = Math.floor((r - 1) / REGIME_BLOCK);
  const draw = rngAt(Number(seed) >>> 0, block, 'regime')();
  const regime = draw < REGIME_BULL_BELOW ? REGIMES.bull : draw < REGIME_BEAR_BELOW ? REGIMES.bear : REGIMES.calm;
  return { ...regime, block, roundsLeft: REGIME_BLOCK - ((r - 1) % REGIME_BLOCK) };
}

/**
 * 共同市场因子（纯函数）：六支股票本回合共同吃到的涨跌（百分点）。
 * 80% 的回合是 0..5 的温和波动，20% 是 5..15 的大行情；方向对半。
 */
export function marketMoveAt(seed, round) {
  const draw = rngAt(Number(seed) >>> 0, Number.isFinite(round) ? Math.trunc(round) : 1, 'market')();
  const sign = draw < 0.5 ? 1 : -1;
  const u = Math.abs(draw * 2 - 1);
  const mag = u < MARKET_COMMON_SHARE
    ? (u / MARKET_COMMON_SHARE) * MARKET_COMMON_MAX
    : MARKET_COMMON_MAX + ((u - MARKET_COMMON_SHARE) / (1 - MARKET_COMMON_SHARE)) * (MARKET_RARE_MAX - MARKET_COMMON_MAX);
  return sign * mag;
}

/**
 * 本回合新闻（纯函数）：45% 概率一条，命中一支股票，幅度 10..30%，方向对半。
 * @returns {{ stockId: string, ticker: string, company: string, text: string, dir: number, pct: number } | null}
 */
export function newsAt(seed, round) {
  const s = Number(seed) >>> 0;
  const r = Number.isFinite(round) ? Math.trunc(round) : 1;
  if (!(rngAt(s, r, 'news')() < NEWS_CHANCE)) return null;
  const stock = STOCKS[Math.floor(rngAt(s, r, 'newsi')() * STOCKS.length) % STOCKS.length];
  const template = NEWS[Math.floor(rngAt(s, r, 'newst')() * NEWS.length) % NEWS.length];
  const magnitude = NEWS_MIN + Math.floor(rngAt(s, r, 'newsm')() * (NEWS_MAX - NEWS_MIN + 1));
  const dir = rngAt(s, r, 'newsd')() < 0.5 ? 1 : -1;
  return {
    stockId: stock.id,
    ticker: stock.ticker,
    company: stock.company,
    text: `${stock.company}${template.text}`,
    dir,
    pct: dir * magnitude,
  };
}

/**
 * 一支股票本回合的涨跌幅（纯函数）：情绪漂移×beta + 共同市场×beta + 个股噪声 + 冷热 + 新闻，夹在 ±45%。
 * 个股噪声用 `rngAt(seed, round, stock.id)`，与市场/新闻/情绪的随机流互相独立。
 * @param {{ seed: number, round: number, stock: any, heat?: number, newsPct?: number }} args
 * @returns {number} 百分点
 */
export function roundPct({ seed, round, stock, heat = 0, newsPct = 0 } = {}) {
  if (!stock || !Number.isFinite(stock.vol) || !Number.isFinite(stock.beta)) return 0;
  const s = Number(seed) >>> 0;
  const r = Number.isFinite(round) ? Math.trunc(round) : 1;
  const regime = regimeAt(s, r);
  const idio = (rngAt(s, r, stock.id)() * 2 - 1) * IDIO_PCT * stock.vol * regime.volMul;
  const market = marketMoveAt(s, r) * stock.beta;
  const pct = regime.driftPct * stock.beta + market + idio + heat + newsPct;
  return clamp(pct, -CLAMP_PCT, CLAMP_PCT);
}

/** 源石大盘：六支 (price / base) 的等权平均，开市 100。 */
function indexValue(prices) {
  let sum = 0;
  for (const stock of STOCKS) {
    const raw = prices ? Number(prices[stock.id]) : NaN;
    const price = Number.isFinite(raw) ? raw : stock.base;
    sum += (price / stock.base) * 100;
  }
  return sum / STOCKS.length;
}

/**
 * 一支股票的下一价（纯函数，方便单测）：**两位小数**，夹在 0.25..99.00。
 *
 * 为什么不是整数：股价只有 1~6 块时，±7% 的噪声在整数上常常四舍五入成 0 —— 行情会变成一条直线，
 * 「盟约冷热」也就没有意义了（实测：7 块的股票连涨 3 回合还是 7）。两位小数让 1 个百分点的波动看得见。
 * 1.3.0 把地板从 1.00 降到 0.25：KAZ 开市价正好 1.00，旧地板让它数学上只能涨不能跌。
 */
export function nextPrice(prev, pct) {
  const raw = prev * (1 + pct / 100);
  return clamp(Math.round(raw * 100) / 100, PRICE_FLOOR, PRICE_CEIL);
}

/** 金额口径：两位小数（价格是两位小数，`2.4 × 3` 的浮点尾数不能把刚好买得起的单拒掉）。 */
const round2 = (value) => Math.round((Number(value) || 0) * 100) / 100;

/** 预算内最多买几股（含手续费；服务端拒绝提示用，与面板 maxAffordable 同一口径）。 */
function affordableShares(budget, price, cap = LIMITS.maxShares) {
  const unit = Number(price);
  if (!(unit > 0)) return 0;
  let qty = Math.min(cap, Math.floor(Math.max(0, budget) / unit));
  while (qty > 0) {
    const gross = round2(unit * qty);
    if (gross + feeOf(gross) <= budget) return qty;
    qty -= 1;
  }
  return 0;
}

/**
 * 分红（纯函数）：返回**万分之一元**的整数（不做最终取整）。
 *
 * 为什么要带上这个「分之一元」的单位：股价是 1~6 块、分红率 1.2%，5 元 × 12 股 × 1.2% = 0.72 元 ——
 * 直接 `floor` 就变成 0，**小额持仓永远吃不到分红**（2026-10-20 收益测试实测：满仓策略分红 0.0）。
 * 所以分红按这个最小单位算，由调用方**累计**（`dividendCarry`），攒够 1 元才真的发下去 ——
 * 小数不丢，长期收益仍然正确，而且同一份种子还是同一条账。
 */
export function dividendOf(price, shares) {
  if (!(price > 0) || !(shares > 0)) return 0;
  return Math.floor(price * shares * LIMITS.dividendBps);
}

/** 每回合利息（纯函数）：负债 × interestBps，四舍五入；有负债就至少 1。 */
export function interestOf(debt) {
  const d = nonNegInt(debt);
  if (!d) return 0;
  return Math.max(1, Math.round((d * LIMITS.interestBps) / 10000));
}

/**
 * 这一档杠杆最多能借多少（纯函数）。`equity` = 现金 + 持仓市值 − 负债。
 * 档位 1 = 不借；2x ⇒ 最多借 1× 净资产；3x ⇒ 最多借 2× 净资产。
 */
export function maxDebtFor(level, equity) {
  const lv = LIMITS.leverage.includes(level) ? level : 1;
  if (lv <= 1) return 0;
  return Math.max(0, Math.trunc((lv - 1) * Math.max(0, equity)));
}

// =====================================================================================================================
// 模块入口
// =====================================================================================================================

/**
 * 服务端模块入口（宿主约定：`export function registerServer(host)`）。
 * @param {{ matchClass: (fn: (Base: Function) => Function) => boolean }} host
 */
export function registerServer(host) {
  host.matchClass((Base) =>
    class OriginiumExchangeMatch extends Base {
      // -----------------------------------------------------------------------------------------------------------
      // 生命周期覆写：每个都先让引擎把这一回合该做的做完，再动交易所（顺序错一天，账就对不上）
      // -----------------------------------------------------------------------------------------------------------

      startRound(round) {
        const result = super.startRound(round);
        try {
          this._oexRoundStart(round);
        } catch (error) {
          this._oexSwallow('startRound', error);
        }
        return result;
      }

      enterPrep() {
        const result = super.enterPrep();
        try {
          this._oexPushAll('prep');
        } catch (error) {
          this._oexSwallow('enterPrep', error);
        }
        return result;
      }

      startCombat() {
        const result = super.startCombat();
        try {
          this._oexPushAll('combat');
        } catch (error) {
          this._oexSwallow('startCombat', error);
        }
        return result;
      }

      /**
       * 资金变化同步（业主 2026-10-19 报的「休整期资金改变不会同步到交易所」）。
       *
       * 引擎把**资金**放在 `m.private` 里，而面板拿不到 store、也不该去解析对局私有帧（§1.9.3 的注入面只给了
       * `net.on` / `net.send`）。所以这条同步由服务端驱动：引擎每次 `dirty()` 之后都会 `flush()`，这里在
       * **原 flush 跑完之后**按「这名玩家上一次发出去的现金」去重，变了就补一帧 `state`（kind: 'sync'）。
       * 于是休整期买棋子 / 刷新商店 / 卖棋子带来的资金变化，交易所在下一步就跟着动，`borrowRoom` 也重新算。
       *
       * 三条性质：
       *   * **零轮询**：不读时钟、不起定时器 —— 挂在引擎已有的 flush 上；
       *   * **去重**：只有现金真的变了才发（`_oexCashSent` 记每个玩家上次发出的现金）；
       *   * **不干扰**：只在交易所已开市、且这名玩家在座时补帧；`super.flush` 抛错也不受影响（try/catch）。
       */
      flush(forcePublic = false) {
        const result = super.flush(forcePublic);
        try {
          this._oexSyncCash();
        } catch (error) {
          this._oexSwallow('flush', error);
        }
        return result;
      }

      finish(options) {
        // 收盘结算必须赶在 engine 的结束流程之前下发（finish() 之后会走 onEnd，房间可能随即把它拆掉）。
        try {
          this._oexClose();
        } catch (error) {
          this._oexSwallow('finish', error);
        }
        return super.finish(options);
      }

      /**
       * 包通道的**唯一**接收入口（docs/WORKSHOP.md §1.9.6/§1.12）：引擎在限流之后、转发之前调一次。
       * 返回 true = 已消费（不再转发给同房其他人）—— 订单是给交易所的，不是给其他玩家的。
       */
      handlePackMsg(playerId, msg) {
        try {
          if (!msg || msg.pack !== PACK_ID || msg.channel !== TRADE_CHANNEL) return false;
          this._oexOrder(playerId, msg.data);
          return true;
        } catch (error) {
          this._oexSwallow('handlePackMsg', error);
          return true;
        }
      }

      // -----------------------------------------------------------------------------------------------------------
      // 交易所状态
      // -----------------------------------------------------------------------------------------------------------

      /** 交易所状态懒创建：第一回合 startRound 时才开市（装载期什么都不做，干净安装为零影响）。 */
      _oexState() {
        return this._originiumExchange || null;
      }

      /** 本局所有还坐在座位上的真人（AI 不交易，但他们也在玩盟约 —— 冷热统计里算）。 */
      _oexHumans() {
        const out = [];
        for (const ps of this.players.values()) {
          if (ps && !ps.isBot && !ps.left) out.push(ps);
        }
        return out;
      }

      /** 冷热统计：活着的全部玩家（真人 + AI）。 */
      _oexHeatFor(stock) {
        let holders = 0;
        let layers = 0;
        for (const ps of this.players.values()) {
          if (!ps || !ps.alive) continue;
          const bond = ps.bonds && ps.bonds[stock.id];
          if (bond && bond.active) holders += 1;
          const layer = ps.layers && ps.layers[stock.id];
          if (Number.isFinite(layer) && layer > 0) layers += layer;
        }
        return { holders, layers };
      }

      /** 开市：初始价、历史、持股表、负债表。 */
      _oexOpen() {
        const prices = {};
        const history = {};
        const change = {};
        for (const stock of STOCKS) {
          prices[stock.id] = stock.base;
          history[stock.id] = [stock.base];
          change[stock.id] = 0;
        }
        this._originiumExchange = {
          openedRound: this.round || 1,
          closed: false,
          prices,
          history,
          change,
          shares: new Map(),
          debt: new Map(),
          lever: new Map(),
          lastDividend: new Map(),
          /** 每名玩家本局累计拿到的分红（close 帧与收益观测用）。 */
          dividendsPaid: new Map(),
          /** 分红的小数余额（万分之一元）：不够 1 元的部分留到下一回合，见 dividendOf。 */
          dividendCarry: new Map(),
          /** 每名玩家「上一次发出去的现金」—— flush 之后的对账凭它去重（见 _oexSyncCash）。 */
          cashSent: new Map(),
          lastNews: null,
          /** 源石大盘：六支 (price / base) 的等权平均，开市 100。 */
          index: { value: 100, prev: 100, chgPct: 0, history: [100] },
          /** 最近一块市场情绪（块切换时上滚动条）。 */
          lastRegime: regimeAt(Number(this.seed) >>> 0, this.round || 1).kind,
          feesPaid: new Map(),
          interestPaid: new Map(),
          liquidations: 0,
          orders: 0,
        };
      }

      _oexSharesOf(playerId) {
        const st = this._oexState();
        if (!st) return {};
        let row = st.shares.get(playerId);
        if (!row) {
          row = {};
          st.shares.set(playerId, row);
        }
        return row;
      }

      _oexDebtOf(playerId) {
        const st = this._oexState();
        if (!st) return 0;
        return nonNegInt(st.debt.get(playerId));
      }

      _oexSetDebt(playerId, value) {
        const st = this._oexState();
        if (!st) return;
        const next = nonNegInt(value);
        if (next > 0) st.debt.set(playerId, next);
        else st.debt.delete(playerId);
      }

      _oexPortfolioOf(playerId) {
        const st = this._oexState();
        if (!st) return 0;
        const row = st.shares.get(playerId) || {};
        let total = 0;
        for (const stock of STOCKS) {
          const shares = row[stock.id] || 0;
          if (shares > 0) total += shares * (st.prices[stock.id] || 0);
        }
        return round2(total);
      }

      /** 净资产 = 现金 + 持仓市值 − 负债。淘汰者按 0 计（见下面的注释）。 */
      _oexNetWorth(ps) {
        if (!ps) return 0;
        // 淘汰者的资金被引擎清零（server/match/player/round.js eliminate），持仓也不该再算进资产：
        // 否则「淘汰者带着资金/净值」既是个说不通的口径，也会踩 invariants.js 的 eliminated-with-funds。
        if (!ps.alive) return 0;
        const cash = Math.max(0, Math.trunc(ps.funds));
        const portfolio = this._oexPortfolioOf(ps.playerId);
        const debt = this._oexDebtOf(ps.playerId);
        return round2(cash + portfolio - debt);
      }

      // -----------------------------------------------------------------------------------------------------------
      // 每回合行情
      // -----------------------------------------------------------------------------------------------------------

      /** startRound 之后：开市 / 分红 / 利息 / 新闻 / 涨跌 / 爆仓 / 推状态。 */
      _oexRoundStart(round) {
        const st = this._oexState();
        if (!st) {
          this._oexOpen();
          const opened = this._oexState();
          this._oexTicker('【源石证交所】开市：六支盟约概念股挂牌，休整期可交易；单回合涨跌最高 ±45%，0.25~99 块一股（支持 2x / 3x 杠杆）。');
          this._oexPushAll('open');
          if (opened) opened.openedRound = round;
          return;
        }
        if (st.closed) return;
        const seed = Number(this.seed) >>> 0;

        // 1) 先按旧价分红（持股者拿到钱，然后价格再动）。
        st.lastDividend = new Map();
        for (const ps of this._oexHumans()) {
          // 出局者的持仓直接作废：引擎在淘汰那一刻就把资金清零，再发分红会造出
          // 「eliminated with funds」（server/match/invariants.js），而一个已经出局的人也不该再领钱。
          if (!ps.alive) {
            st.shares.delete(ps.playerId);
            st.debt.delete(ps.playerId);
            st.lever.delete(ps.playerId);
            st.dividendCarry.delete(ps.playerId);
            continue;
          }
          const row = st.shares.get(ps.playerId) || {};
          // 按「万分之一元」累计：整数部分这一回合发下去，小数部分留到下一回合（见 dividendOf 的注释）。
          let carry = (st.dividendCarry.get(ps.playerId) || 0);
          for (const stock of STOCKS) {
            const shares = row[stock.id] || 0;
            if (shares <= 0) continue;
            carry += dividendOf(st.prices[stock.id], shares);
          }
          const total = Math.floor(carry / 10000);
          st.dividendCarry.set(ps.playerId, carry - total * 10000);
          if (total > 0) {
            this._oexSafeAddFunds(ps, total, 'exchange-dividend');
            st.lastDividend.set(ps.playerId, total);
            st.dividendsPaid.set(ps.playerId, (st.dividendsPaid.get(ps.playerId) || 0) + total);
          }
        }

        // 2) 利息：先扣现金，付不出就资本化进负债（利滚利）。放在分红之后（先拿到钱再还息）。
        for (const ps of this._oexHumans()) {
          if (!ps.alive) continue;
          const debt = this._oexDebtOf(ps.playerId);
          if (!debt) continue;
          const interest = interestOf(debt);
          const cash = Math.max(0, Math.trunc(ps.funds));
          const paid = Math.min(cash, interest);
          if (paid > 0) ps.addFunds(-paid, { reason: 'exchange-interest' });
          this._oexSetDebt(ps.playerId, debt + (interest - paid));
          st.interestPaid.set(ps.playerId, (st.interestPaid.get(ps.playerId) || 0) + interest);
        }

        // 3) 市场情绪（3 回合一块）与新闻（最多一条）。
        const regime = regimeAt(seed, round);
        if (regime.kind !== st.lastRegime) {
          st.lastRegime = regime.kind;
          const verb = regime.driftPct > 0 ? '看涨' : regime.driftPct < 0 ? '看跌' : '横盘';
          this._oexTicker(`【源石证交所】市场情绪转为${regime.label}，接下来 ${REGIME_BLOCK} 回合概念股整体${verb}。`);
        }
        const news = newsAt(seed, round);
        st.lastNews = news;

        // 4) 每支股票：情绪漂移×beta + 共同市场×beta + 个股噪声 + 冷热 + 新闻，夹在 ±45%。
        for (const stock of STOCKS) {
          const { holders, layers } = this._oexHeatFor(stock);
          const heat = stockHeat(holders, layers);
          const newsPct = news && news.stockId === stock.id ? news.pct : 0;
          const pct = roundPct({ seed, round, stock, heat, newsPct });
          const previous = st.prices[stock.id];
          const price = nextPrice(previous, pct);
          st.prices[stock.id] = price;
          st.change[stock.id] = previous > 0 ? oneDecimal(((price - previous) / previous) * 100) : 0;
          const series = st.history[stock.id] || [price];
          series.push(price);
          while (series.length > HISTORY_LENGTH) series.shift();
          st.history[stock.id] = series;
        }

        // 4b) 源石大盘：六支 (price / base) 的等权平均，开市 100。
        if (!st.index) st.index = { value: 100, prev: 100, chgPct: 0, history: [100] };
        const indexNow = indexValue(st.prices);
        st.index.chgPct = st.index.prev > 0 ? oneDecimal(((indexNow - st.index.prev) / st.index.prev) * 100) : 0;
        st.index.value = round2(indexNow);
        st.index.prev = indexNow;
        st.index.history.push(st.index.value);
        while (st.index.history.length > HISTORY_LENGTH) st.index.history.shift();

        // 5) 爆仓检查（价格已经动完）：负债 / 持仓市值 超过维持担保比例 ⇒ 强制平仓。
        for (const ps of this._oexHumans()) {
          if (!ps.alive) continue;
          const liquidated = this._oexLiquidate(ps);
          if (liquidated > 0) {
            st.liquidations += 1;
            this._oexTicker(`【源石证交所】${ps.name || ps.playerId} 的账户触及维持担保比例，被强制平仓 ${liquidated} 股。`);
          }
        }

        // 6) 新闻播一条 ticker（引擎自己的滚动条，全房间可见）；没有新闻就不播。
        if (news) {
          const verb = news.dir > 0 ? '上涨' : '下跌';
          this._oexTicker(`【源石证交所】${news.text}，${news.company}股价${verb} ${Math.abs(news.pct)}%。`);
        }
        // 6b) 单回合大行情也上滚动条：不开面板的人也看得见。
        const mover = STOCKS.reduce((best, stock) => {
          const chg = st.change[stock.id] || 0;
          return Math.abs(chg) > Math.abs(best.chg) ? { stock, chg } : best;
        }, { stock: STOCKS[0], chg: st.change[STOCKS[0].id] || 0 });
        if (Math.abs(mover.chg) >= 20) {
          this._oexTicker(`【源石证交所】${mover.stock.ticker} ${mover.stock.company} 本回合 ${mover.chg > 0 ? '+' : ''}${mover.chg}%。`);
        }

        // 7) 把新行情推给每个真人（各自带自己的持股、负债与现金）。
        this._oexPushAll('round');
      }

      /**
       * 强制平仓：负债 / 持仓市值 > maintainPct% 时，从最不值钱的那支开始卖，
       * 卖到负债 / 持仓市值 ≤ liquidateToPct%（或者卖光）为止。返回卖掉的总股数。
       */
      _oexLiquidate(ps) {
        const st = this._oexState();
        if (!st) return 0;
        const row = st.shares.get(ps.playerId) || {};
        let debt = this._oexDebtOf(ps.playerId);
        if (!debt) return 0;
        let portfolio = this._oexPortfolioOf(ps.playerId);
        if (!portfolio) return 0;
        if (debt * 100 <= portfolio * LIMITS.maintainPct) return 0;
        // 每一轮都重新挑「市值最小」的那一支卖 1 股，再重算担保比例 —— 整数股、有限轮，
        // 最多卖到清仓（`maxShares` 是单支上限，总持仓受六支之和约束，所以这个 guard 只会多不会少）。
        let sold = 0;
        const guardLimit = LIMITS.maxShares * STOCKS.length + 1;
        for (let guard = 0; guard < guardLimit; guard += 1) {
          if (debt <= 0) break;
          if (portfolio <= 0) break;
          if (debt * 100 <= portfolio * LIMITS.liquidateToPct) break;
          const pick = STOCKS
            .map((stock) => ({ stock, shares: row[stock.id] || 0, price: st.prices[stock.id] || 0 }))
            .filter((entry) => entry.shares > 0 && entry.price > 0)
            .sort((a, b) => a.shares * a.price - b.shares * b.price || (a.stock.id < b.stock.id ? -1 : 1))[0];
          if (!pick) break;
          const gross = round2(pick.price);
          const fee = feeOf(gross);
          const proceeds = round2(Math.max(0, gross - fee));
          const repay = Math.min(debt, proceeds);
          debt = round2(debt - repay);
          const cashIn = round2(proceeds - repay);
          if (cashIn > 0) ps.addFunds(cashIn, { reason: 'exchange-liquidate' });
          row[pick.stock.id] = (row[pick.stock.id] || 0) - 1;
          if (row[pick.stock.id] <= 0) delete row[pick.stock.id];
          portfolio = round2(portfolio - pick.price);
          sold += 1;
        }
        this._oexSetDebt(ps.playerId, debt);
        return sold;
      }

      // -----------------------------------------------------------------------------------------------------------
      // 交易
      // -----------------------------------------------------------------------------------------------------------

      /** 处理一条订单（已经过引擎的通道名与限流判据）。 */
      _oexOrder(playerId, data) {
        const st = this._oexState();
        const ps = this.players.get(playerId);
        const op = data && typeof data === 'object' ? data.op : null;
        // hello：面板挂载 / 重连时补一份自己的状态。没有订单语义，只回帧。
        if (op === 'hello') {
          if (ps && !ps.isBot && !ps.left) this._oexPush(ps, 'sync');
          return;
        }
        if (!ps || ps.isBot || ps.left) return;
        if (!st) {
          this._oexReply(ps, { ok: false, code: 'closed', text: '本局交易所还没有开盘。' });
          return;
        }
        if (st.closed) {
          this._oexReply(ps, { ok: false, code: 'closed', text: '本局交易所已经收盘了。' });
          return;
        }
        if (this.phase !== PHASE_PREP) {
          this._oexReply(ps, { ok: false, code: 'phase', text: '只有休整期才能下单。' });
          return;
        }
        if (!ps.alive) {
          this._oexReply(ps, { ok: false, code: 'seat', text: '你已经出局，不能再交易。' });
          return;
        }
        // 杠杆档位：`op:'lever'` 改自己的默认档（每单也可以自带 lever）。
        if (op === 'lever') {
          this._oexSetLever(ps, data && data.level);
          return;
        }
        const stock = STOCKS.find((entry) => entry.id === (data && data.stock));
        if (!stock) {
          this._oexReply(ps, { ok: false, code: 'stock', text: '没有这支股票。' });
          return;
        }
        const qty = data && data.qty;
        if (!Number.isInteger(qty) || qty < 1 || qty > LIMITS.maxShares) {
          this._oexReply(ps, { ok: false, code: 'qty', text: `数量必须是 1..${LIMITS.maxShares} 的整数。`, stock: stock.id });
          return;
        }
        if (op === 'buy') this._oexBuy(ps, stock, qty, data && data.lever);
        else if (op === 'sell') this._oexSell(ps, stock, qty);
        else this._oexReply(ps, { ok: false, code: 'phase', text: '未知的下单操作。', stock: stock.id });
      }

      /** 改自己的默认杠杆档（1 / 2 / 3）。档位只影响**能借多少**，不强制借钱。 */
      _oexSetLever(ps, level) {
        const st = this._oexState();
        if (!st) return;
        if (!LIMITS.leverage.includes(level)) {
          this._oexReply(ps, { ok: false, code: 'lever', text: `杠杆只能选 ${LIMITS.leverage.join(' / ')} 倍。` });
          return;
        }
        // 降档时如果当前负债已经超过新档位的额度，拒绝（先还钱再降档），而不是悄悄改掉一个还不上的额度。
        const equity = this._oexNetWorth(ps);
        const debt = this._oexDebtOf(ps.playerId);
        const room = maxDebtFor(level, equity);
        if (debt > room) {
          this._oexReply(ps, {
            ok: false, code: 'lever', lever: level,
            text: `当前负债 ${debt} 超过 ${level}x 档位的额度 ${room}：先卖出还一部分再降档。`,
          });
          return;
        }
        if (level > 1) st.lever.set(ps.playerId, level);
        else st.lever.delete(ps.playerId);
        this._oexReply(ps, { ok: true, op: 'lever', lever: level, text: `杠杆档位已切到 ${level}x。` });
      }

      _oexBuy(ps, stock, qty, leverOverride) {
        const st = this._oexState();
        const row = this._oexSharesOf(ps.playerId);
        const held = row[stock.id] || 0;
        if (held + qty > LIMITS.maxShares) {
          this._oexReply(ps, {
            ok: false, code: 'shares', op: 'buy', stock: stock.id, qty,
            text: `每股最多持有 ${LIMITS.maxShares} 股，你现在有 ${held} 股。`,
          });
          return;
        }
        const price = st.prices[stock.id];
        const gross = round2(price * qty);
        const fee = feeOf(gross);
        const total = round2(gross + fee);
        const cash = Math.max(0, Math.trunc(ps.funds));
        const debt = this._oexDebtOf(ps.playerId);
        const level = LIMITS.leverage.includes(leverOverride) ? leverOverride : (st.lever.get(ps.playerId) || 1);
        const equity = round2(cash + this._oexPortfolioOf(ps.playerId) - debt);
        const room = Math.max(0, maxDebtFor(level, equity) - debt);
        const borrow = Math.max(0, round2(total - cash));
        if (borrow > room) {
          const affordable = Math.min(total, cash + room);
          this._oexReply(ps, {
            ok: false, code: 'funds', op: 'buy', stock: stock.id, qty, price, fee,
            text: borrow > 0 && level > 1
              ? `超出 ${level}x 杠杆额度：这一单还要借 ${borrow}，但只剩 ${room} 的额度（现金 ${cash}）。`
              : `资金不足：需要 ${total}（股价 ${gross} + 手续费 ${fee}），现在只有 ${cash}。`,
            cash, debt, lever: level, maxBuy: affordableShares(affordable, price),
          });
          return;
        }
        const pay = Math.min(cash, total);
        if (pay > 0) ps.addFunds(-pay, { reason: 'exchange-buy' });
        if (borrow > 0) this._oexSetDebt(ps.playerId, round2(debt + borrow));
        row[stock.id] = held + qty;
        st.orders += 1;
        st.feesPaid.set(ps.playerId, (st.feesPaid.get(ps.playerId) || 0) + fee);
        this._oexReply(ps, {
          ok: true, op: 'buy', stock: stock.id, qty, price, fee, lever: level,
          ...(borrow > 0 ? { borrowed: borrow } : {}),
          text: borrow > 0
            ? `买入 ${stock.company} ${qty} 股 @${price}，手续费 ${fee}，其中 ${borrow} 是借的（${level}x）。`
            : `买入 ${stock.company} ${qty} 股 @${price}，手续费 ${fee}。`,
        });
      }

      _oexSell(ps, stock, qty) {
        const st = this._oexState();
        const row = this._oexSharesOf(ps.playerId);
        const held = row[stock.id] || 0;
        if (held < qty) {
          this._oexReply(ps, {
            ok: false, code: 'shares', op: 'sell', stock: stock.id, qty,
            text: `持仓不足：你有 ${held} 股，想卖 ${qty} 股。`,
          });
          return;
        }
        const price = st.prices[stock.id];
        const gross = round2(price * qty);
        const fee = feeOf(gross);
        const proceeds = round2(Math.max(0, gross - fee));
        // 卖出的钱先还债，剩下的进现金（引擎里现金每回合清零，还债才是「留住价值」的那条路）。
        const debt = this._oexDebtOf(ps.playerId);
        const repay = Math.min(debt, proceeds);
        const cashIn = round2(proceeds - repay);
        if (repay > 0) this._oexSetDebt(ps.playerId, round2(debt - repay));
        if (cashIn > 0) ps.addFunds(cashIn, { reason: 'exchange-sell' });
        row[stock.id] = held - qty;
        if (row[stock.id] <= 0) delete row[stock.id];
        st.orders += 1;
        st.feesPaid.set(ps.playerId, (st.feesPaid.get(ps.playerId) || 0) + fee);
        this._oexReply(ps, {
          ok: true, op: 'sell', stock: stock.id, qty, price, fee,
          ...(repay > 0 ? { repaid: repay } : {}),
          text: repay > 0
            ? `卖出 ${stock.company} ${qty} 股 @${price}，到手 ${proceeds}，先还债 ${repay}${cashIn > 0 ? `，余 ${cashIn}` : ''}。`
            : `卖出 ${stock.company} ${qty} 股 @${price}，到手 ${proceeds}（手续费 ${fee}）。`,
        });
      }

      // -----------------------------------------------------------------------------------------------------------
      // 下发
      // -----------------------------------------------------------------------------------------------------------

      /** 给一名玩家回一份带 lastOrder 的状态帧。 */
      _oexReply(ps, order) {
        this._oexPush(ps, 'trade', order);
      }

      /** 当前行情 + 这名玩家的持仓 = 一帧 `state`。 */
      _oexFrame(ps, kind, lastOrder) {
        const st = this._oexState();
        if (!st) return null;
        const row = st.shares.get(ps.playerId) || {};
        const debt = this._oexDebtOf(ps.playerId);
        const level = st.lever.get(ps.playerId) || 1;
        let portfolio = 0;
        const stocks = STOCKS.map((stock) => {
          const price = st.prices[stock.id] || stock.base;
          const shares = row[stock.id] || 0;
          portfolio += shares * price;
          return {
            id: stock.id,
            ticker: stock.ticker,
            company: stock.company,
            bondName: stock.bondName,
            price,
            chgPct: st.change[stock.id] || 0,
            history: (st.history[stock.id] || [price]).slice(),
            shares,
          };
        });
        const cash = Math.max(0, Math.trunc(ps.funds));
        portfolio = round2(portfolio);
        const equity = round2(cash + portfolio - debt);
        const regime = regimeAt(Number(this.seed) >>> 0, this.round || st.openedRound);
        const marginPct = portfolio > 0 ? oneDecimal((debt * 100) / portfolio) : 0;
        return {
          t: 'pack.msg',
          pack: PACK_ID,
          channel: MARKET_CHANNEL,
          data: {
            type: 'state',
            kind,
            round: this.round || st.openedRound,
            phase: this.phase,
            closed: !!st.closed,
            stocks,
            cash,
            portfolio,
            debt,
            leverage: level,
            borrowRoom: Math.max(0, maxDebtFor(level, equity) - debt),
            netWorth: equity,
            index: {
              value: st.index ? st.index.value : 100,
              chgPct: st.index ? st.index.chgPct : 0,
              history: st.index ? st.index.history.slice() : [100],
            },
            sentiment: { kind: regime.kind, label: regime.label, driftPct: regime.driftPct, roundsLeft: regime.roundsLeft },
            marginPct,
            news: st.lastNews
              ? { text: st.lastNews.text, stockId: st.lastNews.stockId, pct: st.lastNews.pct }
              : null,
            dividend: st.lastDividend.get(ps.playerId) || 0,
            lastOrder: lastOrder || null,
            limits: {
              maxShares: LIMITS.maxShares,
              commissionBps: LIMITS.commissionBps,
              dividendBps: LIMITS.dividendBps,
              leverage: [...LIMITS.leverage],
              interestBps: LIMITS.interestBps,
              maintainPct: LIMITS.maintainPct,
              clampPct: CLAMP_PCT,
              priceFloor: PRICE_FLOOR,
              priceCeil: PRICE_CEIL,
              newsChance: NEWS_CHANCE,
            },
          },
        };
      }

      _oexPush(ps, kind, lastOrder) {
        const frame = this._oexFrame(ps, kind, lastOrder);
        if (!frame) return;
        const st = this._oexState();
        // 记下「这名玩家上一次收到的现金」：flush 之后凭它判断要不要补帧（见 _oexSyncCash）。
        if (st) st.cashSent.set(ps.playerId, Math.max(0, Math.trunc(ps.funds)));
        this.sendTo(ps.playerId, frame);
      }

      /**
       * flush 之后的对账：现金与上次发出的不一样 ⇒ 补一帧 `state`（kind: 'sync'）。
       * 只在开市、且该玩家活着时补；淘汰者/观战者不补。
       */
      _oexSyncCash() {
        const st = this._oexState();
        if (!st || st.closed) return;
        for (const ps of this._oexHumans()) {
          if (!ps.alive) continue;
          const cash = Math.max(0, Math.trunc(ps.funds));
          if (st.cashSent.get(ps.playerId) === cash) continue;
          this._oexPush(ps, 'sync');
        }
      }

      _oexPushAll(kind) {
        if (!this._oexState()) return;
        for (const ps of this._oexHumans()) this._oexPush(ps, kind);
      }

      /** 收盘：算总资产、排名，给每个真人一帧 close + 一条「股神」ticker。 */
      _oexClose() {
        const st = this._oexState();
        if (!st || st.closed) return;
        st.closed = true;
        const rows = this._oexHumans().filter((ps) => ps.alive).map((ps) => ({
          playerId: ps.playerId,
          name: ps.name || ps.playerId,
          seat: ps.seat,
          netWorth: this._oexNetWorth(ps),
        }));
        rows.sort((a, b) => b.netWorth - a.netWorth || String(a.playerId).localeCompare(String(b.playerId)));
        const stocks = STOCKS.map((stock) => ({
          id: stock.id,
          ticker: stock.ticker,
          company: stock.company,
          price: st.prices[stock.id] || stock.base,
          chgPct: st.change[stock.id] || 0,
        }));
        for (const ps of this._oexHumans()) {
          const out = !ps.alive;
          const mineIndex = rows.findIndex((row) => row.playerId === ps.playerId);
          const mine = mineIndex >= 0 ? rows[mineIndex] : null;
          const frame = {
            t: 'pack.msg',
            pack: PACK_ID,
            channel: MARKET_CHANNEL,
            data: {
              type: 'close',
              round: this.round,
              out,
              netWorth: out ? 0 : (mine ? mine.netWorth : 0),
              rank: out ? null : (mineIndex >= 0 ? mineIndex + 1 : rows.length),
              ofPlayers: rows.length,
              debt: out ? 0 : this._oexDebtOf(ps.playerId),
              liquidation: st.liquidations,
              rows: rows.map((row) => ({
                name: row.name,
                seat: row.seat,
                netWorth: row.netWorth,
                isMe: row.playerId === ps.playerId,
              })),
              stocks,
              indexEnd: st.index ? st.index.value : 100,
              indexReturnPct: st.index ? oneDecimal(st.index.value - 100) : 0,
              feesPaid: st.feesPaid.get(ps.playerId) || 0,
              interestPaid: st.interestPaid.get(ps.playerId) || 0,
              dividendsPaid: st.dividendsPaid.get(ps.playerId) || 0,
            },
          };
          this.sendTo(ps.playerId, frame);
        }
        if (rows.length) {
          const best = rows[0];
          this._oexTicker(`【源石证交所】收盘：${best.name} 以 ${best.netWorth} 总资产拿下本局「股神」。`);
        }
      }

      // -----------------------------------------------------------------------------------------------------------
      // 工具
      // -----------------------------------------------------------------------------------------------------------

      _oexTicker(text) {
        if (typeof this.tickerText !== 'function') return;
        try {
          this.tickerText(text, 10);
        } catch (error) {
          this._oexSwallow('ticker', error);
        }
      }

      /** 包自己的资金写入 + 失败兜底（addFunds 是引擎唯一的写口；负数就是花钱）。 */
      _oexSafeAddFunds(ps, amount, reason) {
        try {
          ps.addFunds(amount, { reason });
        } catch (error) {
          this._oexSwallow('addFunds', error);
        }
      }

      /** mod 的错误只进日志（Match.reportError 是引擎自己的错误计数），绝不冒泡打断对局。 */
      _oexSwallow(where, error) {
        try {
          if (typeof this.reportError === 'function') this.reportError(`originium-exchange:${where}`, error);
        } catch { /* ignore */ }
      }
    },
  );
}
