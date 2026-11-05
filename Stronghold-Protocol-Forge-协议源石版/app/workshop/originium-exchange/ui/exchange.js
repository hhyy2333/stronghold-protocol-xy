// ui/exchange.js —— 「源石证券交易所」工坊包的客户端面板（pack.json.client.panels[].module）。
//
// 面板契约：`export function mount(ctx)`（docs/WORKSHOP.md §1.9.3）。这一层拿到的注入面是**冻结的**：
//   ctx.id / ctx.pack / ctx.slot / ctx.order / ctx.gate / ctx.log
//   ctx.host                    —— 属于这次挂载的 <div>，往里画界面
//   ctx.net.on('market', fn)    —— 收本包、本通道的 `pack.msg`（服务端 -> 面板）
//   ctx.net.send('trade', data) —— 发本包、本通道的 `pack.msg`（面板 -> 服务端；通道必须先在
//                                  pack.json.client.panels[].messages 里声明过）
//   ctx.me.snapshot()           —— 只读会话态（playerId / name / room 快照）
// 面板**没有** store、没有对局对象、没有 socket —— 它画不出正确的东西最多是难看，改不了对局结果。
//
// 依赖只有浏览器自带的 DOM；不 import preact 也不 import 引擎模块（面板模块是包里的文件，
// 装载期只被当成一份会被 import 的 .js 服务出去）。
//
// 本文件同时导出两个纯函数（resolveQty / maxAffordable），方便在没有浏览器的地方单测交易数量口径。

/** 交易数量档位：1 / 5 / 10 / 全部。 */
const QTY_MODES = Object.freeze([1, 5, 10, 'max']);

/** 相位中文名（只用于标题栏的小字；引擎的 i18n 不在面板的注入面里）。 */
const PHASE_TEXT = Object.freeze({
  LOBBY: '等待中',
  INFO_CHECK: '准备中',
  BAND_DRAFT: '选策略',
  BATTLE_CHECK: '协议启动',
  ROUND_START: '回合开始',
  SP_DRAFT: '机变阶段',
  HEX_DRAFT: '协议源石',
  PREP: '休整期',
  COMBAT: '作战中',
  UNITE: '联防',
  SETTLE: '结算',
  FINAL_ASSAULT: '最终攻势',
  HIDDEN_CORE: '隐秘核心',
  RESULT: '已结束',
});

const clampInt = (value, lo, hi) => Math.max(lo, Math.min(hi, Math.trunc(value)));
const round2 = (value) => Math.round((Number(value) || 0) * 100) / 100;
const fmt = (value) => {
  const n = Math.round(Number(value) || 0);
  return n.toLocaleString('zh-CN');
};
/** 股价保留两位小数（服务端就是两位小数口径；`.00` 也照显示，免得「7」和「7.04」看起来像两个精度）。 */
const fmtPrice2 = (value) => (Math.round((Number(value) || 0) * 100) / 100).toFixed(2);
/**
 * 股价的**两种显示模式**（业主 2026-10-22「增加显示模式（无小数点）可在原本与无小数点间切换」，
 * 同日的口径补充：「不显示小数模式是*100（只改变显示）」）。
 *
 *   * `'decimal'`（默认，也就是 1.3.x 的样子）：两位小数 —— 3.04、0.25、99.00；
 *   * `'integer'`（无小数点）：**把价格 ×100 之后按整数显示** —— 3.04 → `304`、0.25 → `25`、99 → `9900`。
 *
 * 为什么是 ×100 而不是四舍五入到整数：价格是两位小数口径（`PRICE_DECIMALS = 2`），×100 正好把它抬成
 * 「分」的整数，**信息一点不丢** —— 304 和 3.04 是同一个价的两种写法，25 和 0.25 也是。四舍五入会把 3.04
 * 抹成 3、把 0.25 抹成 0，屏幕和成交价对不上，那才是最坏的一种显示。所以这个模式就是小数点右移两位、
 * 去掉那个点。
 *
 * 这是**纯显示**：算钱、算可买股数、下单、强平全用服务端的两位小数真实价，切换不会改变任何一单的成交额。
 */
const PRICE_MODES = Object.freeze(['decimal', 'integer']);
const PRICE_MODE_KEY = 'sp.oex.priceMode';
/** 无小数点模式的价格倍率：两位小数 ⇒ 分。 */
const INTEGER_SCALE = 100;
/**
 * 股价按当前显示模式格式化（纯函数，可单测）。
 * @param {number} value 真实价（两位小数）
 * @param {'decimal'|'integer'} mode
 * @returns {string}
 */
export function formatPrice(value, mode) {
  const raw = Math.round((Number(value) || 0) * 100) / 100;
  if (mode !== 'integer') return raw.toFixed(2);
  // ×100 之后四舍五入到整数：raw 已经是两位小数，所以这一步是精确的（没有 303.99999 这种尾数）。
  return String(Math.round(raw * INTEGER_SCALE));
}
const fmtPrice = formatPrice;
/** 面板里那一颗显示模式按钮的文案。 */
const PRICE_MODE_TEXT = Object.freeze({ decimal: '保留小数', integer: '无小数点（×100）' });
/** 源石大盘保留一位小数（100 起）。 */
const fmtIndex = (value) => (Math.round((Number(value) || 0) * 10) / 10).toFixed(1);

/**
 * 金额（持仓市值 / 负债 / 总资产 / 现金）的显示：**两位小数**， тысяче分位。
 *
 * 业主 2026-10-25：「让持仓和负债可以显示小数」。持仓 = Σ(股数 × 股价)，而股价本身就是两位小数
 * （3 股 × 3.07 = 9.21），取整会把这个数悄悄抹成 9 —— 面板上看到的「持仓」和真正值钱的数字对不上。
 * 负债是整数元（`_oexSetDebt` 存整数），但同样留两位小数显示，两栏才对得齐。
 *
 * 与价格共用同一个显示模式开关（用户切到「无小数点（×100）」时，金额也 ×100 显示成整数）。
 * @param {number} value
 * @param {'decimal'|'integer'} mode
 */
export function formatMoney(value, mode = 'decimal') {
  const raw = Math.round((Number(value) || 0) * 100) / 100;
  if (mode === 'integer') return String(Math.round(raw * INTEGER_SCALE));
  const abs = Math.abs(raw);
  const [intPart, frac] = abs.toFixed(2).split('.');
  const grouped = intPart.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return `${raw < 0 ? '-' : ''}${grouped}.${frac}`;
}
/** 面板当前用的金额格式化（闭包里绑定当前显示模式）。 */
let moneyMode = 'decimal';
const fmtMoney = (value) => formatMoney(value, moneyMode);

/** 市场情绪中文名（服务端下行帧里也有 `label`，这里只是兜底）。 */
const SENTIMENT_TEXT = Object.freeze({ bull: '牛市', bear: '熊市', calm: '平静' });

/**
 * 买入时「现有资金最多买几股」——含 1% 手续费（向上取整、最少 1）。纯函数，可单测。
 * @param {number} cash
 * @param {number} price
 * @param {number} maxShares
 * @returns {number}
 */
/**
 * 与 server/exchange.mjs 的 `feeCentsOf` 同一口径（**分**）：
 * 成交额 ≥ 10 元才收，1%，四舍五入、至少 1 元。返回「分」。
 */
export function feeCentsFor(grossCents) {
  if (!(grossCents >= 1000)) return 0;
  return Math.max(100, Math.round((grossCents * 100) / 10000));
}

/** 手续费（元），给面板显示用。 */
export function feeFor(gross) {
  return feeCentsFor(Math.round((Number(gross) || 0) * 100)) / 100;
}

/**
 * 预算内最多买几股（纯函数）。与 server/exchange.mjs 的 `affordableShares` **同一口径**：
 * 金额算到「分」，再换回整数元支付 —— 服务端真的会扣 `ceil(cost分 − 尾差) / 100`，
 * 面板若用小数预算判断，就会出现「面板说能买、点下去被拒」。
 *
 * @param {number} budgetYuan 现金 + 可借额度（整数元）
 * @param {number} price
 * @param {number} maxShares
 * @param {number} carryCents 交易所尾差（分，正 = 交易所欠你），会抵扣这一单
 */
export function maxAffordable(budgetYuan, price, maxShares = 300, carryCents = 0) {
  const budget = Math.max(0, Math.trunc(Number(budgetYuan) || 0));
  const unit = Math.round((Number(price) || 0) * 100);
  if (!(unit > 0)) return 0;
  const capByBudget = Math.floor(((budget + Math.max(0, Number(carryCents) || 0) / 100) * 100) / unit);
  let qty = clampInt(Math.min(maxShares, capByBudget), 0, maxShares);
  while (qty > 0) {
    const grossCents = unit * qty;
    const costCents = grossCents + feeCentsFor(grossCents);
    const pay = Math.max(0, Math.ceil((costCents - (Number(carryCents) || 0)) / 100));
    if (pay <= budget) return qty;
    qty -= 1;
  }
  return 0;
}

/**
 * 这一单在**含杠杆**之后最多能买几股（纯函数）。`state.borrowRoom` 是服务端算好的剩余额度，
 * 面板不自己重算额度（两份判据会漂）：现金 + 尾差 + 可用额度 = 预算上限。
 */
export function maxBuyable(state, price, maxShares = 300) {
  if (!state) return 0;
  const cash = Math.max(0, Math.trunc(Number(state.cash) || 0));
  const room = Math.max(0, Math.trunc(Number(state.borrowRoom) || 0));
  const carryCents = Math.round((Number(state.carry) || 0) * 100);
  return maxAffordable(cash + room, price, maxShares, carryCents);
}

/**
 * 把「数量档位 + 当前状态 + 股票 + 方向」解析成这一单的真实股数（0 = 下不了单）。纯函数，可单测。
 * @param {number|'max'} mode
 * @param {{ cash?: number, limits?: { maxShares?: number }, stocks?: Array<{ id: string, price: number, shares: number }> }} state
 * @param {string} stockId
 * @param {'buy'|'sell'} op
 * @returns {number}
 */
export function resolveQty(mode, state, stockId, op) {
  if (!state || !Array.isArray(state.stocks)) return 0;
  const stock = state.stocks.find((row) => row && row.id === stockId);
  if (!stock) return 0;
  const maxShares = clampInt((state.limits && state.limits.maxShares) || 300, 1, 9999);
  const held = clampInt(stock.shares || 0, 0, maxShares);
  const buyable = Math.max(0, Math.min(maxShares - held, maxBuyable(state, stock.price, maxShares)));
  const available = op === 'buy' ? buyable : held;
  if (available <= 0) return 0;
  if (mode === 'max') return available;
  const wanted = clampInt(Number(mode) || 1, 1, maxShares);
  return Math.min(wanted, available);
}

/**
 * 读显示模式偏好（`localStorage` 的 `sp.oex.priceMode`）。读不到 / 值不认识 / 存储不可用 ⇒ 默认 `'decimal'`。
 *
 * 面板的注入面里没有 storage，但**浏览器自己的 `localStorage` 是可用的**（面板模块就是站点上的一个
 * ES 模块，不是 worker）：这里只存一个显示偏好的字符串，不碰对局状态（WORKSHOP §1.9.3 的那条边界讲的是
 * 「面板改不了对局结果」，不是「面板不许记自己长什么样」——引擎自己的 `sp.pref.*` 偏好也是这么存的）。
 * 全部包 try/catch：隐私模式下 `localStorage` 会抛异常，那时静默退回默认值即可。
 */
export function readPriceMode() {
  try {
    if (typeof localStorage === 'undefined') return 'decimal';
    const raw = localStorage.getItem(PRICE_MODE_KEY);
    return PRICE_MODES.includes(raw) ? raw : 'decimal';
  } catch {
    return 'decimal';
  }
}

/** 写显示模式偏好（失败就静默：偏好丢了不影响这一局）。 */
function writePriceMode(mode) {
  try {
    if (typeof localStorage === 'undefined') return;
    localStorage.setItem(PRICE_MODE_KEY, mode);
  } catch { /* storage unavailable */ }
}

/** 迷你走势图（SVG polyline）。没有 createElementNS 的环境（测试 stub）退化成一根横线。 */
function drawSparkline(doc, history, up) {
  const width = 64;
  const height = 18;
  const series = Array.isArray(history) && history.length ? history.map((n) => Number(n) || 0) : [0];
  const min = Math.min(...series);
  const max = Math.max(...series);
  const span = max - min || 1;
  const points = series.length === 1
    ? `0,${height / 2} ${width},${height / 2}`
    : series.map((value, index) => {
      const x = (index / (series.length - 1)) * width;
      const y = height - 2 - ((value - min) / span) * (height - 4);
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    }).join(' ');
  if (typeof doc.createElementNS !== 'function') {
    const fallback = doc.createElement('div');
    fallback.className = 'oex__spark-fallback';
    return fallback;
  }
  const svg = doc.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('class', up ? 'oex__spark is-up' : 'oex__spark is-down');
  svg.setAttribute('viewBox', `0 0 ${width} ${height}`);
  svg.setAttribute('width', String(width));
  svg.setAttribute('height', String(height));
  svg.setAttribute('aria-hidden', 'true');
  const line = doc.createElementNS('http://www.w3.org/2000/svg', 'polyline');
  line.setAttribute('points', points);
  line.setAttribute('fill', 'none');
  line.setAttribute('stroke-width', '1.6');
  line.setAttribute('stroke-linecap', 'round');
  line.setAttribute('stroke-linejoin', 'round');
  svg.appendChild(line);
  return svg;
}

/**
 * 面板入口。
 * @param {any} ctx 引擎的面板注入面（docs/WORKSHOP.md §1.9.3）
 * @returns {{ unmount: () => void }}
 */
export function mount(ctx) {
  const doc = ctx && ctx.host && ctx.host.ownerDocument
    ? ctx.host.ownerDocument
    : (typeof document !== 'undefined' ? document : null);
  if (!doc || !ctx || !ctx.host) {
    if (ctx && ctx.log) ctx.log.warn('[源石证交所] no document, panel stays empty');
    return { unmount() {} };
  }

  const el = (tag, cls, text) => {
    const node = doc.createElement(tag);
    if (cls) node.className = cls;
    if (text != null) node.textContent = String(text);
    return node;
  };

  // ---- 视图状态 -----------------------------------------------------------------------------------------------
  let disposed = false;
  let state = null;          // 最近一份 state 帧
  let closing = null;        // 最近一份 close 帧
  let open = false;          // 抽屉是否展开（默认收起：进局不自动弹界面，点按钮才开）
  let qtyMode = 1;           // 1 / 5 / 10 / 'max'
  let priceMode = readPriceMode(); // 'decimal' | 'integer'（纯显示，见 PRICE_MODES）
  let toast = null;          // { text, ok }
  let toastTimer = null;
  let seenState = false;
  let helloAttempts = 0;
  let roomPolls = 0;

  // ---- 骨架 --------------------------------------------------------------------------------------------------
  const root = el('div', 'oex');
  root.hidden = true;

  // 入口是商店栏按钮行里的一颗横排按钮（`screen.game.shopTools`，冻结的左边，与「商店」并排）。
  const tab = el('button', 'oex__tab');
  tab.type = 'button';
  tab.dataset.action = 'toggle';
  tab.title = '源石证券交易所（休整期营业）';
  tab.appendChild(el('span', 'oex__tab-glyph', '¥'));
  tab.appendChild(el('span', 'oex__tab-text', '交易所'));

  const panel = el('section', 'oex__panel');
  panel.setAttribute('role', 'dialog');
  panel.setAttribute('aria-label', '源石证券交易所');
  panel.hidden = true;

  const head = el('header', 'oex__head');
  const headTitles = el('div', 'oex__head-titles');
  const kicker = el('span', 'oex__kicker', 'ORIGINIUM EXCHANGE');
  const title = el('h2', 'oex__title', '源石证券交易所');
  const roundLine = el('span', 'oex__round', '');
  headTitles.appendChild(kicker);
  headTitles.appendChild(title);
  headTitles.appendChild(roundLine);
  const headActions = el('div', 'oex__head-actions');
  const collapseBtn = el('button', 'oex__collapse');
  collapseBtn.type = 'button';
  collapseBtn.dataset.action = 'toggle';
  collapseBtn.title = '收起交易所';
  collapseBtn.setAttribute('aria-label', '收起交易所');
  collapseBtn.textContent = '▾';
  headActions.appendChild(collapseBtn);
  head.appendChild(headTitles);
  head.appendChild(headActions);

  // 行情带：源石大盘 + 市场情绪（服务端下发 `index` / `sentiment`，缺字段时整条隐藏）。
  const tape = el('div', 'oex__tape');
  const indexText = el('span', 'oex__index', '');
  const sentimentText = el('span', 'oex__sentiment', '');
  tape.appendChild(indexText);
  tape.appendChild(sentimentText);

  const summary = el('div', 'oex__summary');
  const netWorthBox = el('div', 'oex__metric oex__metric--main');
  const netWorthLabel = el('span', 'oex__metric-label', '总资产');
  const netWorthValue = el('span', 'oex__metric-value', '—');
  netWorthBox.appendChild(netWorthLabel);
  netWorthBox.appendChild(netWorthValue);
  const cashBox = el('div', 'oex__metric');
  cashBox.appendChild(el('span', 'oex__metric-label', '现金'));
  const cashValue = el('span', 'oex__metric-value', '—');
  cashBox.appendChild(cashValue);
  const portfolioBox = el('div', 'oex__metric');
  portfolioBox.appendChild(el('span', 'oex__metric-label', '持仓'));
  const portfolioValue = el('span', 'oex__metric-value', '—');
  portfolioBox.appendChild(portfolioValue);
  const debtBox = el('div', 'oex__metric oex__metric--debt');
  debtBox.appendChild(el('span', 'oex__metric-label', '负债'));
  const debtValue = el('span', 'oex__metric-value', '—');
  debtBox.appendChild(debtValue);
  summary.appendChild(netWorthBox);
  summary.appendChild(cashBox);
  summary.appendChild(portfolioBox);
  summary.appendChild(debtBox);

  const newsBar = el('div', 'oex__news');
  const newsText = el('span', 'oex__news-text', '等待开市…');
  const dividendText = el('span', 'oex__dividend', '');
  newsBar.appendChild(newsText);
  newsBar.appendChild(dividendText);

  const qtyBar = el('div', 'oex__qty');
  qtyBar.appendChild(el('span', 'oex__qty-label', '每单手数'));
  const qtyButtons = el('div', 'oex__qty-buttons');
  for (const mode of QTY_MODES) {
    const btn = el('button', 'oex__qty-btn' + (mode === qtyMode ? ' is-active' : ''), mode === 'max' ? '全部' : String(mode));
    btn.type = 'button';
    btn.dataset.action = 'qty';
    btn.dataset.qty = String(mode);
    qtyButtons.appendChild(btn);
  }
  qtyBar.appendChild(qtyButtons);

  const levBar = el('div', 'oex__lever');
  levBar.appendChild(el('span', 'oex__qty-label', '杠杆'));
  const levButtons = el('div', 'oex__qty-buttons');
  // 档位**不在面板里写死**：从下发的 `limits.leverage` 建按钮（1.4.0 起是 1..5）。
  // 第一帧之前用 1.3.x 那三档兜底，帧一到就按真实表重建 —— 老引擎（没有 4x / 5x）不会画出两个按了被拒的按钮。
  let levModes = [1, 2, 3];
  const buildLevButtons = (modes) => {
    levModes = Array.isArray(modes) && modes.length ? modes : [1, 2, 3];
    while (levButtons.firstChild) levButtons.removeChild(levButtons.firstChild);
    for (const level of levModes) {
      const btn = el('button', 'oex__qty-btn oex__lev-btn', `${level}x`);
      btn.type = 'button';
      btn.dataset.action = 'lever';
      btn.dataset.lever = String(level);
      levButtons.appendChild(btn);
    }
  };
  buildLevButtons(levModes);
  levBar.appendChild(levButtons);
  const levHint = el('span', 'oex__lev-hint', '');
  levBar.appendChild(levHint);

  // 显示模式（业主 2026-10-22）：股价「保留小数」/「无小数点」之间切换，偏好存在 localStorage。
  const dispBar = el('div', 'oex__display');
  dispBar.appendChild(el('span', 'oex__qty-label', '显示'));
  const dispButtons = el('div', 'oex__qty-buttons');
  for (const mode of PRICE_MODES) {
    const btn = el('button', 'oex__qty-btn oex__disp-btn', PRICE_MODE_TEXT[mode]);
    btn.type = 'button';
    btn.dataset.action = 'display';
    btn.dataset.mode = mode;
    dispButtons.appendChild(btn);
  }
  dispBar.appendChild(dispButtons);
  const dispHint = el('span', 'oex__lev-hint', '');
  dispBar.appendChild(dispHint);

  const list = el('div', 'oex__list');

  const foot = el('footer', 'oex__foot');
  const footHint = el('span', 'oex__foot-hint', '休整期才能交易 · 单回合 ±45% · 新闻 45% · 手续费 1% · 分红 1.2% · 息 0.4%');
  foot.appendChild(footHint);

  const toastBar = el('div', 'oex__toast');
  toastBar.hidden = true;

  // 收盘结算层（盖在面板里）
  const closeLayer = el('div', 'oex__close');
  closeLayer.hidden = true;
  const closeHead = el('div', 'oex__close-head');
  const closeTitle = el('strong', 'oex__close-title', '本局收盘');
  const closeRank = el('span', 'oex__close-rank', '');
  closeHead.appendChild(closeTitle);
  closeHead.appendChild(closeRank);
  const closeList = el('ol', 'oex__close-list');
  const closeFoot = el('div', 'oex__close-foot');
  const closeBtn = el('button', 'oex__close-btn', '收起');
  closeBtn.type = 'button';
  closeBtn.dataset.action = 'toggle';
  closeFoot.appendChild(closeBtn);
  closeLayer.appendChild(closeHead);
  closeLayer.appendChild(closeList);
  closeLayer.appendChild(closeFoot);

  panel.appendChild(head);
  panel.appendChild(tape);
  panel.appendChild(summary);
  panel.appendChild(newsBar);
  panel.appendChild(qtyBar);
  panel.appendChild(levBar);
  panel.appendChild(dispBar);
  panel.appendChild(list);
  panel.appendChild(toastBar);
  panel.appendChild(foot);
  panel.appendChild(closeLayer);
  root.appendChild(tab);
  root.appendChild(panel);
  ctx.host.appendChild(root);

  // ---- 渲染 --------------------------------------------------------------------------------------------------
  function applyOpen(next) {
    open = next;
    root.classList.toggle('is-open', open);
    panel.hidden = !open;
    tab.classList.toggle('is-on', open);
  }

  function renderQtyButtons() {
    const buttons = qtyButtons.childNodes || [];
    for (const btn of buttons) {
      if (!btn || !btn.dataset) continue;
      btn.classList.toggle('is-active', String(btn.dataset.qty) === String(qtyMode));
    }
  }

  function renderDisplayButtons() {
    for (const btn of dispButtons.childNodes || []) {
      if (!btn || !btn.dataset) continue;
      btn.classList.toggle('is-active', String(btn.dataset.mode) === priceMode);
    }
    dispHint.textContent = priceMode === 'integer' ? '价格 ×100 · 仅显示，成交按两位小数' : '按两位小数显示';
  }

  function renderToast() {
    if (!toast) {
      toastBar.hidden = true;
      toastBar.textContent = '';
      return;
    }
    toastBar.hidden = false;
    toastBar.textContent = toast.text;
    toastBar.className = 'oex__toast ' + (toast.ok ? 'is-ok' : 'is-bad');
  }

  function showToast(order) {
    if (!order || !order.text) return;
    toast = { text: order.text, ok: !!order.ok };
    renderToast();
    if (toastTimer) clearTimeout(toastTimer);
    toastTimer = setTimeout(() => {
      toastTimer = null;
      toast = null;
      if (!disposed) renderToast();
    }, 5200);
  }

  /**
   * 重画股票列表，**并保住滚动位置**（业主 2026-10-22「交易所的滑动条在购买后会回到最上端，有bug」）。
   *
   * 原来的写法是先 `while (list.firstChild) removeChild(...)` 再逐行 append。`list` 是 `overflow-y: auto`
   * 的滚动容器（`.oex__list`），子节点全清空的那一刻内容高度归 0，浏览器随即把 `scrollTop` 置 0 ——
   * 哪怕紧接着又塞回六行同样高的内容，滚动位置也已经回不去了。而每次下单服务端都会回一帧 `state`
   *（买/卖回执），下一回合还有 `round` / `sync` 帧，于是「买一手就跳回最上面」。
   *
   * 所以：重建前记下 `scrollTop`，重建后写回去。列表高度没变的常见情形下这是一次精确还原；如果这一帧
   * 让列表变短（例如某一行不再渲染），浏览器会把 `scrollTop` 夹到新的上限，这是期望行为。
   *
   * 顺带把两处重复的重建逻辑收成一个入口（`renderState` 与显示模式切换原来各写了一遍）。
   */
  function renderStockList(stocks) {
    const top = Number(list.scrollTop) || 0;
    while (list.firstChild) list.removeChild(list.firstChild);
    for (const stock of stocks || []) list.appendChild(renderStockRow(stock));
    // 写回：只有在真的滚过时才动它（顶部时保持原样，免得白白触发一次 scroll 事件）。
    if (top > 0) list.scrollTop = top;
  }

  function renderStockRow(stock) {
    const row = el('div', 'oex__row');
    const up = Number(stock.chgPct) >= 0;
    const chg = el('span', 'oex__chg ' + (up ? 'is-up' : 'is-down'), `${up ? '+' : ''}${(Number(stock.chgPct) || 0).toFixed(1)}%`);
    const idBox = el('div', 'oex__id');
    idBox.appendChild(el('span', 'oex__ticker', stock.ticker || '???'));
    idBox.appendChild(el('span', 'oex__company', stock.company || ''));
    const priceBox = el('div', 'oex__price-box');
    priceBox.appendChild(el('span', 'oex__price', fmtPrice(stock.price, priceMode)));
    priceBox.appendChild(chg);
    const chart = drawSparkline(doc, stock.history, up);
    const hold = el('span', 'oex__hold', `持 ${fmt(stock.shares || 0)}`);
    const actions = el('div', 'oex__actions');
    const buy = el('button', 'oex__trade oex__trade--buy', '买');
    buy.type = 'button';
    buy.dataset.action = 'buy';
    buy.dataset.stock = stock.id;
    const sell = el('button', 'oex__trade oex__trade--sell', '卖');
    sell.type = 'button';
    sell.dataset.action = 'sell';
    sell.dataset.stock = stock.id;
    const tradeable = !!(state && state.phase === 'PREP' && !state.closed);
    buy.disabled = !tradeable;
    sell.disabled = !tradeable || (stock.shares || 0) <= 0;
    actions.appendChild(buy);
    actions.appendChild(sell);
    row.appendChild(idBox);
    row.appendChild(priceBox);
    row.appendChild(chart);
    row.appendChild(hold);
    row.appendChild(actions);
    return row;
  }

  function renderState(data) {
    state = data;
    roundLine.textContent = `第 ${data.round ?? '?'} 回合 · ${PHASE_TEXT[data.phase] || data.phase || ''}${data.closed ? ' · 已收盘' : ''}`;
    // 行情带：源石大盘 + 市场情绪（缺字段的旧帧整条留空）。
    if (data.index && Number.isFinite(Number(data.index.value))) {
      const idxUp = Number(data.index.chgPct) >= 0;
      indexText.textContent = `源石指数 ${fmtIndex(data.index.value)} ${idxUp ? '+' : ''}${(Number(data.index.chgPct) || 0).toFixed(1)}%`;
      indexText.className = 'oex__index ' + (idxUp ? 'is-up' : 'is-down');
    } else {
      indexText.textContent = '';
      indexText.className = 'oex__index';
    }
    if (data.sentiment && data.sentiment.kind) {
      const label = SENTIMENT_TEXT[data.sentiment.kind] || data.sentiment.label || '';
      const left = Number(data.sentiment.roundsLeft) || 0;
      sentimentText.textContent = `市场情绪 ${label}${left > 0 ? ` · 剩 ${left} 回合` : ''}`;
      sentimentText.className = 'oex__sentiment is-' + data.sentiment.kind;
    } else {
      sentimentText.textContent = '';
      sentimentText.className = 'oex__sentiment';
    }
    moneyMode = priceMode;
    netWorthValue.textContent = fmtMoney(data.netWorth);
    cashValue.textContent = fmtMoney(data.cash);
    portfolioValue.textContent = fmtMoney(data.portfolio);
    const debt = Number(data.debt) || 0;
    const marginPct = Number(data.marginPct) || 0;
    debtValue.textContent = debt > 0 ? `-${fmtMoney(debt)}` : '0.00';
    // 追保距离：**按这一档的**维持担保比例算（服务端下行帧的 `maintainPct`；1x–3x 是 70，4x/5x 更宽）。
    // 黄线 = 阈值 −15 个百分点，红线 = 阈值 −5。旧代码把 55/65/70 三个数字写死，加了 4x/5x 之后
    // 5x 的 88% 会在「还没到 65%」时就把人强平，面板却一个字都不预警 —— 那是最坏的一种谎。
    const maintainPct = Number(data.maintainPct) || Number(data.limits && data.limits.maintainPct) || 70;
    const warnPct = Math.max(0, maintainPct - 15);
    const dangerPct = Math.max(0, maintainPct - 5);
    debtBox.classList.toggle('is-warn', debt > 0 && marginPct >= warnPct && marginPct < dangerPct);
    debtBox.classList.toggle('is-danger', debt > 0 && marginPct >= dangerPct);
    // 杠杆：档位按钮按服务端的 `limits.leverage` 建过一次就照用，当前档位高亮 + 还能借多少。
    const limits = data.limits || {};
    if (Array.isArray(limits.leverage) && limits.leverage.join(',') !== levModes.join(',')) buildLevButtons(limits.leverage);
    const level = Number(data.leverage) || 1;
    for (const btn of levButtons.childNodes || []) {
      if (!btn || !btn.dataset) continue;
      btn.classList.toggle('is-active', Number(btn.dataset.lever) === level);
    }
    const room = Number(data.borrowRoom) || 0;
    levHint.textContent = debt > 0
      ? `负债率 ${marginPct.toFixed(0)}% · 追保 ${maintainPct}%`
      : level > 1
        ? (room > 0 ? `可借 ${fmtMoney(room)}` : `额度已用满 · 追保 ${maintainPct}%`)
        : '不借钱';
    if (data.news && data.news.text) {
      newsText.textContent = `${data.news.text}（${data.news.pct > 0 ? '+' : ''}${data.news.pct}%）`;
      newsText.className = 'oex__news-text ' + (data.news.pct > 0 ? 'is-up' : 'is-down');
    } else {
      newsText.textContent = '今日风平浪静，行情跟着各盟约的冷热走。';
      newsText.className = 'oex__news-text';
    }
    dividendText.textContent = data.dividend > 0 ? `分红 +${fmtMoney(data.dividend)}` : '';
    if (typeof data.closed === 'boolean' && data.closed) footHint.textContent = '本局已收盘 · 下一局重新开市';
    else footHint.textContent = '休整期才能交易 · 单回合 ±45% · 新闻 45% · 手续费 1% · 分红 1.2% · 息 0.4%';
    renderStockList(data.stocks);
    renderQtyButtons();
    renderDisplayButtons();
    // sync 帧是「资金变了，行情没变」的补帧：只更新数字，不弹订单回执。
    if (data.lastOrder && data.kind !== 'sync') showToast(data.lastOrder);
    if (closing) renderClose(closing);
  }

  function renderClose(data) {
    closing = data;
    closeLayer.hidden = false;
    const idxReturn = Number(data.indexReturnPct);
    const indexLine = Number.isFinite(idxReturn) ? ` · 本局大盘 ${idxReturn >= 0 ? '+' : ''}${idxReturn.toFixed(1)}%` : '';
    // 出局的人没有名次（服务端发 rank: null + out: true），但仍然看到本局的排行榜。
    closeRank.textContent = (data.out
      ? `已出局 · 本局排行共 ${data.ofPlayers} 人`
      : `第 ${data.rank} 名 / 共 ${data.ofPlayers} 人 · 总资产 ${fmtMoney(data.netWorth)}`) + indexLine;
    while (closeList.firstChild) closeList.removeChild(closeList.firstChild);
    for (const row of data.rows || []) {
      const item = el('li', 'oex__close-row' + (row.isMe ? ' is-me' : ''));
      item.appendChild(el('span', 'oex__close-name', `${row.seat != null ? `${row.seat + 1}. ` : ''}${row.name || '???'}`));
      item.appendChild(el('span', 'oex__close-worth', fmtMoney(row.netWorth)));
      closeList.appendChild(item);
    }
  }

  function reset() {
    state = null;
    closing = null;
    seenState = false;
    toast = null;
    if (toastTimer) { clearTimeout(toastTimer); toastTimer = null; }
    root.hidden = true;
    applyOpen(false);
    panel.hidden = true;
    closeLayer.hidden = true;
    renderToast();
  }

  // ---- 网络：下行 + hello ------------------------------------------------------------------------------------
  function safeMe() {
    try {
      return ctx.me && typeof ctx.me.snapshot === 'function' ? ctx.me.snapshot() : null;
    } catch {
      return null;
    }
  }

  function sendHello() {
    if (!ctx.net || typeof ctx.net.send !== 'function') return;
    const sent = ctx.net.send('trade', { op: 'hello' });
    if (sent) helloAttempts += 1;
  }

  function pollRoom() {
    if (disposed) return;
    roomPolls += 1;
    const me = safeMe();
    const room = me && me.room ? me.room : null;
    if (!seenState && room && room.inMatch && helloAttempts < 3) sendHello();
    // 对局结束了：本局有收盘帧就把它留住（玩家还在结算屏上），否则清空面板。
    // 下一局的第一帧开市（kind: 'open'）会把上一局的结算层收掉。
    if (seenState && (!room || room.inMatch === false)) {
      if (closing) return;
      reset();
    }
    if (roomPolls < 40) setTimeout(pollRoom, 1500);
  }

  const onMarket = (data) => {
    if (disposed || !data || typeof data !== 'object') return;
    if (data.type === 'close') {
      closing = data;
      if (state) renderClose(data);
      else {
        // 极端情况：面板在收盘之后才挂上（重连）——把结算层准备好，但**不替玩家把抽屉弹开**（进局/重连都不自动
        // 显示界面；点一下按钮就能看到）。
        root.hidden = false;
        closeLayer.hidden = false;
        renderClose(data);
      }
      return;
    }
    if (data.type !== 'state') return;
    seenState = true;
    // 新一局开市：上一局的结算层收掉，否则它会盖在新行情上面。
    if (data.kind === 'open' && closing) {
      closing = null;
      closeLayer.hidden = true;
    }
    // 业主 2026-10-22（玩家反馈）：「手机端搞交易所，发现投不进钱，关上以后发现在悬赏页面选不了」。
    //
    // 病因是**任何一份 state 帧都自动展开**：离开休整期之后面板仍然盖在机变 / 悬赏界面上，牌被挡住点不到、
    // 下单又被服务端按相位拒掉；玩家手动收起它，下一帧行情回来它又自己弹开。
    //
    // 交易所本来就只在休整期能下单，所以非休整期整块收起来（连按钮一起）：不占屏、不挡任何界面。
    // 业主 2026-10-23「进局不要自动显示两个界面了」：回到休整期也**不自动展开** —— 收起状态才是默认状态，
    // 玩家点按钮才打开。1.4.3 起按钮住在商店栏（`screen.game.shopTools`），商店栏本来也只在休整期渲染，
    // 所以下面这条 root.hidden 是双保险（相位切换的那一帧先藏起来，别等卸载）。
    const tradeable = data.phase === 'PREP' && !data.closed;
    if (!tradeable) {
      if (open) applyOpen(false);
      root.hidden = true;
      renderState(data);   // 数字照旧更新，回到休整期时直接是新的
      return;
    }
    root.hidden = false;
    renderState(data);
  };

  const off = ctx.net && typeof ctx.net.on === 'function' ? ctx.net.on('market', onMarket) : () => {};

  // ---- 交互 --------------------------------------------------------------------------------------------------
  function currentStockId(target) {
    const node = target && typeof target.closest === 'function' ? target.closest('[data-stock]') : target;
    return node && node.dataset ? node.dataset.stock || null : null;
  }

  function onRootClick(event) {
    const target = event && event.target;
    const actionNode = target && typeof target.closest === 'function' ? target.closest('[data-action]') : target;
    const action = actionNode && actionNode.dataset ? actionNode.dataset.action : null;
    if (!action) return;
    if (action === 'toggle') {
      applyOpen(!open);
      return;
    }
    if (action === 'qty') {
      const raw = actionNode.dataset.qty;
      qtyMode = raw === 'max' ? 'max' : (Number(raw) || 1);
      renderQtyButtons();
      return;
    }
    if (action === 'lever') {
      const level = Number(actionNode.dataset.lever);
      if (!Number.isInteger(level) || !ctx.net) return;
      ctx.net.send('trade', { op: 'lever', level });
      return;
    }
    if (action === 'display') {
      // 显示模式是**纯本机偏好**：不发帧、不问服务端，只重画列表（价格文字随之变化）。
      const mode = actionNode.dataset.mode;
      if (!PRICE_MODES.includes(mode) || mode === priceMode) return;
      priceMode = mode;
      writePriceMode(mode);
      renderDisplayButtons();
      // 金额（持仓 / 负债 / 总资产 / 现金）与价格共用这个开关，所以整块重画一次而不是只画股票列表。
      if (state) renderState(state);
      return;
    }
    if (action === 'buy' || action === 'sell') {
      const stockId = currentStockId(actionNode);
      if (!stockId || !state) return;
      const qty = resolveQty(qtyMode, state, stockId, action);
      if (!qty) {
        showToast({
          ok: false,
          text: action === 'buy'
            ? ((Number(state.borrowRoom) || 0) > 0 ? '这一档额度下买不起这一手了。' : '资金不足或该股票已满仓。')
            : '你没有这支股票的持仓。',
        });
        return;
      }
      if (!ctx.net || typeof ctx.net.send !== 'function') return;
      // 带上传给服务端的杠杆档：面板选中的那一档就是这一单要用的额度。
      ctx.net.send('trade', { op: action, stock: stockId, qty, ...(action === 'buy' ? { lever: Number(state.leverage) || 1 } : {}) });
    }
  }

  root.addEventListener('click', onRootClick);

  // ---- 生命周期 ----------------------------------------------------------------------------------------------
  // 初始收起：面板一挂上时页面上只有按钮行里那一颗「交易所」，**不自动弹抽屉**（业主 2026-10-23）。
  applyOpen(false);
  renderDisplayButtons();
  // **立刻**问一次行情（以前是 1.2 s 之后才问）：面板不仅在开局 / 重连时挂上，商店栏每收起再展开一次，宿主就被
  // Preact 换掉、注册点先摘掉再挂一次 —— 那一下正是玩家点开商店、等着按钮出现的时候（业主 2026-11-05「进入按钮
  // 要展开商店一段时间之后才刷出来」）。`pollRoom` 自己会按 1.5 s 重试到上限（连接没上线时 `send()` 返回 false）。
  pollRoom();

  return {
    unmount() {
      disposed = true;
      if (toastTimer) clearTimeout(toastTimer);
      toastTimer = null;
      try { if (typeof off === 'function') off(); } catch { /* ignore */ }
      try { root.removeEventListener('click', onRootClick); } catch { /* ignore */ }
      try {
        while (root.firstChild) root.removeChild(root.firstChild);
        if (root.parentNode) root.parentNode.removeChild(root);
      } catch { /* ignore */ }
    },
  };
}
