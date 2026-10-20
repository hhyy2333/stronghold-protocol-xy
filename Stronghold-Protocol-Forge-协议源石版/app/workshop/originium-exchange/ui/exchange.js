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
const fmt = (value) => {
  const n = Math.round(Number(value) || 0);
  return n.toLocaleString('zh-CN');
};
/** 股价保留两位小数（服务端就是两位小数口径；`.00` 也照显示，免得「7」和「7.04」看起来像两个精度）。 */
const fmtPrice = (value) => (Math.round((Number(value) || 0) * 100) / 100).toFixed(2);

/**
 * 买入时「现有资金最多买几股」——含 1% 手续费（向上取整、最少 1）。纯函数，可单测。
 * @param {number} cash
 * @param {number} price
 * @param {number} maxShares
 * @returns {number}
 */
/** 与 server/exchange.mjs 的 feeOf 同一口径：成交额 < 10 不收，否则 1% 四舍五入、至少 1。 */
export function feeFor(gross) {
  if (!(gross >= 10)) return 0;
  return Math.max(1, Math.round((gross * 100) / 10000));
}

export function maxAffordable(cash, price, maxShares = 60) {
  const budget = Math.max(0, Math.trunc(Number(cash) || 0));
  const unit = Math.max(1, Math.trunc(Number(price) || 0));
  let qty = clampInt(Math.floor(budget / unit), 0, maxShares);
  while (qty > 0) {
    const gross = unit * qty;
    if (gross + feeFor(gross) <= budget) return qty;
    qty -= 1;
  }
  return 0;
}

/**
 * 这一单在**含杠杆**之后最多能买几股（纯函数）。`state.borrowRoom` 是服务端算好的剩余额度，
 * 面板不自己重算额度（两份判据会漂）：现金 + 可用额度 = 预算上限。
 */
export function maxBuyable(state, price, maxShares = 60) {
  if (!state) return 0;
  const cash = Math.max(0, Math.trunc(Number(state.cash) || 0));
  const room = Math.max(0, Math.trunc(Number(state.borrowRoom) || 0));
  return maxAffordable(cash + room, price, maxShares);
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
  const maxShares = clampInt((state.limits && state.limits.maxShares) || 60, 1, 999);
  const held = clampInt(stock.shares || 0, 0, maxShares);
  const buyable = Math.max(0, Math.min(maxShares - held, maxBuyable(state, stock.price, maxShares)));
  const available = op === 'buy' ? buyable : held;
  if (available <= 0) return 0;
  if (mode === 'max') return available;
  const wanted = clampInt(Number(mode) || 1, 1, maxShares);
  return Math.min(wanted, available);
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
  let open = false;          // 抽屉是否展开
  let userCollapsed = false; // 用户手动收起之后，新行情不自动弹开
  let qtyMode = 1;           // 1 / 5 / 10 / 'max'
  let toast = null;          // { text, ok }
  let toastTimer = null;
  let seenState = false;
  let helloAttempts = 0;
  let roomPolls = 0;

  // ---- 骨架 --------------------------------------------------------------------------------------------------
  const root = el('div', 'oex');
  root.hidden = true;

  const tab = el('button', 'oex__tab');
  tab.type = 'button';
  tab.dataset.action = 'toggle';
  tab.title = '打开源石证券交易所';
  tab.appendChild(el('span', 'oex__tab-glyph', '¥'));
  tab.appendChild(el('span', 'oex__tab-text', '源石证交所'));

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
  const LEV_MODES = [1, 2, 3];
  for (const level of LEV_MODES) {
    const btn = el('button', 'oex__qty-btn oex__lev-btn', `${level}x`);
    btn.type = 'button';
    btn.dataset.action = 'lever';
    btn.dataset.lever = String(level);
    levButtons.appendChild(btn);
  }
  levBar.appendChild(levButtons);
  const levHint = el('span', 'oex__lev-hint', '');
  levBar.appendChild(levHint);

  const list = el('div', 'oex__list');

  const foot = el('footer', 'oex__foot');
  const footHint = el('span', 'oex__foot-hint', '休整期才能交易 · 手续费 1% · 每回合分红 1.2% · 负债每回合计息 12%（可加 2x / 3x 杠杆）');
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
  panel.appendChild(summary);
  panel.appendChild(newsBar);
  panel.appendChild(qtyBar);
  panel.appendChild(levBar);
  panel.appendChild(list);
  panel.appendChild(toastBar);
  panel.appendChild(foot);
  panel.appendChild(closeLayer);
  root.appendChild(tab);
  root.appendChild(panel);
  ctx.host.appendChild(root);

  // ---- 渲染 --------------------------------------------------------------------------------------------------
  function applyOpen(next, userInitiated = false) {
    open = next;
    // 只有**用户自己**收起时才记住「别再自动弹开」；初始状态与离开房间的重置都不算。
    if (userInitiated) userCollapsed = !next;
    else if (next) userCollapsed = false;
    root.classList.toggle('is-open', open);
    panel.hidden = !open;
    tab.hidden = !!open;
  }

  function renderQtyButtons() {
    const buttons = qtyButtons.childNodes || [];
    for (const btn of buttons) {
      if (!btn || !btn.dataset) continue;
      btn.classList.toggle('is-active', String(btn.dataset.qty) === String(qtyMode));
    }
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

  function renderStockRow(stock) {
    const row = el('div', 'oex__row');
    const up = Number(stock.chgPct) >= 0;
    const chg = el('span', 'oex__chg ' + (up ? 'is-up' : 'is-down'), `${up ? '+' : ''}${(Number(stock.chgPct) || 0).toFixed(1)}%`);
    const idBox = el('div', 'oex__id');
    idBox.appendChild(el('span', 'oex__ticker', stock.ticker || '???'));
    idBox.appendChild(el('span', 'oex__company', stock.company || ''));
    const priceBox = el('div', 'oex__price-box');
    priceBox.appendChild(el('span', 'oex__price', fmtPrice(stock.price)));
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
    netWorthValue.textContent = fmt(data.netWorth);
    cashValue.textContent = fmt(data.cash);
    portfolioValue.textContent = fmt(data.portfolio);
    const debt = Number(data.debt) || 0;
    debtValue.textContent = debt > 0 ? `-${fmt(debt)}` : '0';
    debtBox.classList.toggle('is-warn', debt > 0);
    // 杠杆：当前档位高亮 + 还能借多少（服务端算好的 borrowRoom，面板不重算）。
    const level = Number(data.leverage) || 1;
    for (const btn of levButtons.childNodes || []) {
      if (!btn || !btn.dataset) continue;
      btn.classList.toggle('is-active', Number(btn.dataset.lever) === level);
    }
    const room = Number(data.borrowRoom) || 0;
    levHint.textContent = level > 1
      ? (room > 0 ? `可借 ${fmt(room)}` : '额度已用满')
      : '不借钱';
    if (data.news && data.news.text) {
      newsText.textContent = `${data.news.text}（${data.news.pct > 0 ? '+' : ''}${data.news.pct}%）`;
      newsText.className = 'oex__news-text ' + (data.news.pct > 0 ? 'is-up' : 'is-down');
    } else {
      newsText.textContent = '今日风平浪静，行情跟着各盟约的冷热走。';
      newsText.className = 'oex__news-text';
    }
    dividendText.textContent = data.dividend > 0 ? `分红 +${fmt(data.dividend)}` : '';
    if (typeof data.closed === 'boolean' && data.closed) footHint.textContent = '本局已收盘 · 下一局重新开市';
    else footHint.textContent = '休整期才能交易 · 手续费 1% · 每回合分红 1.2% · 负债每回合计息 12%（可加 2x / 3x 杠杆）';
    while (list.firstChild) list.removeChild(list.firstChild);
    for (const stock of data.stocks || []) list.appendChild(renderStockRow(stock));
    renderQtyButtons();
    // sync 帧是「资金变了，行情没变」的补帧：只更新数字，不弹订单回执。
    if (data.lastOrder && data.kind !== 'sync') showToast(data.lastOrder);
    if (closing) renderClose(closing);
  }

  function renderClose(data) {
    closing = data;
    closeLayer.hidden = false;
    // 出局的人没有名次（服务端发 rank: null + out: true），但仍然看到本局的排行榜。
    closeRank.textContent = data.out
      ? `已出局 · 本局排行共 ${data.ofPlayers} 人`
      : `第 ${data.rank} 名 / 共 ${data.ofPlayers} 人 · 总资产 ${fmt(data.netWorth)}`;
    while (closeList.firstChild) closeList.removeChild(closeList.firstChild);
    for (const row of data.rows || []) {
      const item = el('li', 'oex__close-row' + (row.isMe ? ' is-me' : ''));
      item.appendChild(el('span', 'oex__close-name', `${row.seat != null ? `${row.seat + 1}. ` : ''}${row.name || '???'}`));
      item.appendChild(el('span', 'oex__close-worth', fmt(row.netWorth)));
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
    applyOpen(false, false);
    userCollapsed = false;
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
        // 极端情况：面板在收盘之后才挂上（重连）——直接开面板显示结算。
        root.hidden = false;
        if (!userCollapsed) applyOpen(true, false);
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
    // 两条症状同一个原因：这一层挂在 `screen.game.aside`（z-index 62），比机变 / 悬赏那一整屏的浮层（`.spov`，z 20）
    // 还高，而它**收到任何一份 state 帧都会自动展开**（原来下面那两行是无条件的）。于是离开休整期之后面板仍然盖在
    // 机变 / 战斗界面上：牌被面板挡住点不到（选不了），按买 / 卖又因为不在休整期被服务端拒掉（投不进钱）；
    // 玩家手动收起它，下一帧行情回来它又自己弹开 —— 看起来就是「关上也没用」。
    //
    // 交易所本来就只在休整期能下单，所以非休整期整块收起来（连那颗标签一起）：不占屏、不挡任何界面；回到休整期
    // 的那一帧照常自动展开（玩家自己收起过的仍然尊重 `userCollapsed`）。
    const tradeable = data.phase === 'PREP' && !data.closed;
    if (!tradeable) {
      if (open) applyOpen(false, false);
      root.hidden = true;
      renderState(data);   // 数字照旧更新，回到休整期时直接是新的
      return;
    }
    root.hidden = false;
    if (!userCollapsed && !open) applyOpen(true, false);
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
      applyOpen(!open, true);
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
  // 初始收起：面板一挂上时页面上**什么都不多**（第一份 state 帧到达才出现抽屉）。
  applyOpen(false, false);
  setTimeout(pollRoom, 1200);

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
