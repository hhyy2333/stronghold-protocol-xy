// ui/store.js —— 「战地商店」工坊包的客户端面板（pack.json.client.panels[].module）。
//
// 面板契约：`export function mount(ctx)`（docs/WORKSHOP.md §1.9.3）。这一层拿到的注入面是**冻结的**：
//   ctx.id / ctx.pack / ctx.slot / ctx.order / ctx.gate / ctx.log
//   ctx.host                    —— 属于这次挂载的 <div>，往里画界面
//   ctx.net.on('store', fn)     —— 收本包、本通道的 `pack.msg`（服务端 -> 面板）
//   ctx.net.send('store', data) —— 发本包、本通道的 `pack.msg`（面板 -> 服务端）
//   ctx.data.get('items'|'assets'|'bonds') —— 引擎数据表的只读快照（pack.json 的 client.panels[].data 声明过）
//   ctx.me.snapshot()           —— 只读会话态（playerId / name / room 快照）
// 面板**没有** store、没有对局对象、没有 socket —— 它画不出正确的东西最多是难看，改不了对局结果。
// **每一分钱都由服务端裁决**：面板只发 `{ op }`，回执与拒绝理由都在下一帧里。
//
// 依赖只有浏览器自带的 DOM；不 import preact 也不 import 引擎模块。
//
// 布局：交易所（originium-exchange）占屏幕右侧，本店占**左边缘**——一枚竖排标签，点开是一列窄抽屉。
// 只在休整期出现：机变 / 协议源石抽取 / 战斗界面的整屏浮层比 aside 低，留在屏幕上会挡住那些按钮
// （交易所 1.4.2 的注释记过这个 bug，这里一开始就按同一条规则来）。
//
// 本文件同时导出几个纯函数（tierLabel / filterCatalog / priceLine），方便在没有浏览器的地方单测口径。

/** 页签 id。 */
const TAB_EQUIP = 'equip';
const TAB_HEX = 'hex';
/** 只在这一相位营业（与 shared/constants.js 的 PHASE.PREP 同值；面板不 import 引擎）。 */
const PHASE_PREP = 'PREP';
/** 二次确认的窗口（毫秒）：第一下「购买」变成「确认」，再点一下才真的下单。 */
const ARM_MS = 4000;
/** 发出去之后到下一帧回来之前，按钮空转这么久（防连点买两份）。 */
const PENDING_MS = 1500;
/** 回执行停留时间。 */
const TOAST_MS = 5000;
/** 罗马数字阶级（装备是 1~6 阶）。 */
const TIER_ROMAN = Object.freeze(['I', 'II', 'III', 'IV', 'V', 'VI']);

/**
 * 阶级角标文字。
 * @param {number} tier
 * @returns {string}
 */
export function tierLabel(tier) {
  const n = Math.trunc(Number(tier) || 0);
  return TIER_ROMAN[n - 1] || String(n);
}

/**
 * 把服务端下发的 `[id, 价格, 剩余]` 三连拼成面板要的货架行（名字 / 描述 / 图标 / 盟约来自数据表）。
 * @param {Array<Array<any>>} catalog
 * @param {{ items?: any, bonds?: any }} tables
 * @returns {Array<{id: string, price: number, left: number, name: string, desc: string, tier: number, iconId: string, bondName: string}>}
 */
export function buildRows(catalog, tables = {}) {
  const items = tables && tables.items && typeof tables.items === 'object' ? tables.items : {};
  const bonds = tables && tables.bonds && typeof tables.bonds === 'object' ? tables.bonds : {};
  const rows = [];
  for (const entry of Array.isArray(catalog) ? catalog : []) {
    if (!Array.isArray(entry)) continue;
    const id = entry[0];
    if (typeof id !== 'string') continue;
    const rec = items[id] || null;
    const bondId = rec && typeof rec.giveBondId === 'string' ? rec.giveBondId : null;
    const bond = bondId && bonds[bondId] ? bonds[bondId] : null;
    rows.push({
      id,
      price: Math.max(0, Math.trunc(Number(entry[1]) || 0)),
      left: Number.isFinite(Number(entry[2])) ? Math.trunc(Number(entry[2])) : -1,
      name: rec && rec.name ? String(rec.name) : id,
      desc: rec && rec.desc ? String(rec.desc) : '',
      tier: rec && Number.isFinite(Number(rec.tier)) ? Math.trunc(Number(rec.tier)) : 0,
      iconId: rec && rec.iconId ? String(rec.iconId) : '',
      bondName: bond && bond.name ? String(bond.name) : '',
    });
  }
  return rows;
}

/**
 * 按阶级与搜索词过滤货架（纯函数）。`tier` 是 'all' 或 1..6；`query` 匹配名字或 id（大小写不敏感）。
 * @param {Array<{id: string, name: string, tier: number}>} rows
 * @param {{ tier?: string|number, query?: string }} filter
 * @returns {Array<any>}
 */
export function filterCatalog(rows, filter = {}) {
  const tier = filter.tier == null || filter.tier === 'all' ? 'all' : Math.trunc(Number(filter.tier));
  const q = String(filter.query || '').trim().toLowerCase();
  return (Array.isArray(rows) ? rows : []).filter((row) => {
    if (!row) return false;
    if (tier !== 'all' && Math.trunc(Number(row.tier)) !== tier) return false;
    if (!q) return true;
    return String(row.name || '').toLowerCase().includes(q) || String(row.id || '').toLowerCase().includes(q);
  });
}

/**
 * 价签上的文案：**就是价格本身**（业主 2026-10-23「直接显示价格不要显示原价1-3」）。
 * 3 倍仍然是规则（服务端 `equipPriceOf` 算的就是它），只是不再把算式写在卡上。纯函数，可单测。
 * @param {number} price 本店价
 * @returns {string}
 */
export function priceLine(price) {
  return String(Math.max(0, Math.trunc(Number(price) || 0)));
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
    if (ctx && ctx.log) ctx.log.warn('[战地商店] no document, panel stays empty');
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
  let frame = null;          // 最近一份 state 帧
  let rows = [];             // 最近一次全量帧拼出来的货架
  let soldOut = new Set();   // 服务端说「没有共享库存」的 id
  let open = false;          // 抽屉是否展开（默认收起：进局不自动弹界面，点按钮才开）
  let tab = TAB_EQUIP;
  let tier = 'all';
  let query = '';
  let armed = null;          // { kind: 'buy'|'draw', id } —— 二次确认
  let armTimer = null;
  let pendingUntil = 0;      // 上一次下单之后按钮空转的截止时刻
  let toastTimer = null;     // 回执行淡出
  let listSignature = '';    // 列表上一次重画的签名（见 renderList）
  let filterSignature = '';  // 只含「看什么」（件数 / 阶级 / 搜索）的签名：它没变就说明这次重画与滚动无关
  let seenState = false;
  let helloAttempts = 0;

  // ---- 数据表（只读快照；只在收到帧之后读，避开 ctx.data.get 的「首次结果含 null 会被缓存」坑）--------------
  const table = (name) => {
    try {
      return ctx.data && typeof ctx.data.get === 'function' ? ctx.data.get(name) : null;
    } catch {
      return null;
    }
  };
  let tables = null;
  const readTables = () => {
    if (tables) return tables;
    tables = { items: table('items'), bonds: table('bonds'), assets: table('assets') };
    return tables;
  };
  /** 一件装备的图标 URL（资产表里没有就退回本地的标准路径；再没有就画一个首字方块）。 */
  const iconUrl = (iconId) => {
    if (!iconId) return '';
    const assets = readTables().assets;
    const mapped = assets && assets.items && typeof assets.items === 'object' ? assets.items[iconId] : '';
    return typeof mapped === 'string' && mapped ? mapped : `/assets/item/${iconId}.png`;
  };

  // ---- 骨架 --------------------------------------------------------------------------------------------------
  const root = el('div', 'fst');
  root.hidden = true;

  // 商店栏按钮行里的一格（`screen.game.shopTools`）：横排、「冻结」左边。收起时它就在那儿，点开是上面的抽屉。
  const tabButton = el('button', 'fst__tab');
  tabButton.type = 'button';
  tabButton.dataset.action = 'toggle';
  tabButton.title = '战地商店（休整期营业）';
  tabButton.appendChild(el('span', 'fst__tab-text', '商店'));
  const tabBadge = el('span', 'fst__tab-badge');
  tabBadge.hidden = true;
  tabButton.appendChild(tabBadge);

  const panel = el('section', 'fst__panel');
  panel.setAttribute('role', 'dialog');
  panel.setAttribute('aria-label', '战地商店');
  panel.hidden = true;

  const head = el('header', 'fst__head');
  const headTitles = el('div', 'fst__head-titles');
  headTitles.appendChild(el('span', 'fst__kicker', 'FIELD STORE'));
  headTitles.appendChild(el('h2', 'fst__title', '战地商店'));
  const roundLine = el('span', 'fst__round', '');
  headTitles.appendChild(roundLine);
  const headActions = el('div', 'fst__head-actions');
  const cashBox = el('div', 'fst__cash');
  cashBox.appendChild(el('span', 'fst__cash-label', '资金'));
  const cashValue = el('span', 'fst__cash-value', '—');
  cashBox.appendChild(cashValue);
  const collapseBtn = el('button', 'fst__collapse', '▾');
  collapseBtn.type = 'button';
  collapseBtn.dataset.action = 'toggle';
  collapseBtn.title = '收起战地商店';
  collapseBtn.setAttribute('aria-label', '收起战地商店');
  headActions.appendChild(cashBox);
  headActions.appendChild(collapseBtn);
  head.appendChild(headTitles);
  head.appendChild(headActions);

  // 页签
  const tabBar = el('nav', 'fst__tabs');
  const equipTabBtn = el('button', 'fst__tab-btn is-active', '装备');
  equipTabBtn.type = 'button';
  equipTabBtn.dataset.action = 'tab';
  equipTabBtn.dataset.tab = TAB_EQUIP;
  const hexTabBtn = el('button', 'fst__tab-btn', '协议源石');
  hexTabBtn.type = 'button';
  hexTabBtn.dataset.action = 'tab';
  hexTabBtn.dataset.tab = TAB_HEX;
  tabBar.appendChild(equipTabBtn);
  tabBar.appendChild(hexTabBtn);

  // 装备页：过滤条 + 列表
  const equipView = el('div', 'fst__view fst__view--equip');
  const filterBar = el('div', 'fst__filters');
  const tierChips = el('div', 'fst__chips');
  const search = el('input', 'fst__search');
  search.type = 'search';
  search.placeholder = '搜索装备名…';
  search.setAttribute('aria-label', '搜索装备名');
  filterBar.appendChild(tierChips);
  filterBar.appendChild(search);
  const list = el('div', 'fst__list');
  const emptyLine = el('div', 'fst__empty', '没有符合条件的装备。');
  emptyLine.hidden = true;
  equipView.appendChild(filterBar);
  equipView.appendChild(list);
  equipView.appendChild(emptyLine);

  // 协议源石页：一张抽卡卡
  const hexView = el('div', 'fst__view fst__view--hex');
  hexView.hidden = true;
  const drawCard = el('div', 'fst__draw');
  drawCard.appendChild(el('div', 'fst__draw-kicker', 'PROTOCOL ORIGINIUM'));
  drawCard.appendChild(el('div', 'fst__draw-title', '抽取协议源石'));
  const drawPriceLine = el('div', 'fst__draw-price', '12 块 / 次 · 随机一张');
  drawCard.appendChild(drawPriceLine);
  const drawRemain = el('div', 'fst__draw-remain', '');
  drawCard.appendChild(drawRemain);
  const drawBtn = el('button', 'fst__draw-btn', '抽取 · 12');
  drawBtn.type = 'button';
  drawBtn.dataset.action = 'draw';
  drawCard.appendChild(drawBtn);
  const drawResult = el('div', 'fst__draw-result', '');
  drawCard.appendChild(drawResult);
  const drawNote = el('div', 'fst__draw-note', '按 1 阶 46% / 2 阶 38% / 3 阶 16% 抽取；已拥有与本局自己禁用的卡不会出现。');
  hexView.appendChild(drawCard);
  hexView.appendChild(drawNote);

  const toastLine = el('div', 'fst__toast');
  toastLine.hidden = true;

  panel.appendChild(head);
  panel.appendChild(tabBar);
  panel.appendChild(equipView);
  panel.appendChild(hexView);
  panel.appendChild(toastLine);
  root.appendChild(tabButton);
  root.appendChild(panel);

  // ---- 视图 --------------------------------------------------------------------------------------------------
  const now = () => Date.now();
  const pending = () => now() < pendingUntil;

  function showToast(order) {
    if (!order || typeof order !== 'object') return;
    const text = String(order.text || '');
    if (!text) {
      toastLine.hidden = true;
      return;
    }
    toastLine.textContent = text;
    toastLine.classList.toggle('is-ok', order.ok === true);
    toastLine.classList.toggle('is-bad', order.ok !== true);
    toastLine.hidden = false;
    if (toastTimer) clearTimeout(toastTimer);
    toastTimer = setTimeout(() => {
      toastTimer = null;
      toastLine.hidden = true;
    }, TOAST_MS);
  }

  function applyOpen(next) {
    open = !!next;
    panel.hidden = !open;
    root.classList.toggle('is-open', open);
    tabButton.classList.toggle('is-on', open);
  }

  function renderCash() {
    cashValue.textContent = frame ? String(Math.max(0, Math.trunc(Number(frame.funds) || 0))) : '—';
  }

  function renderRound() {
    if (!frame) { roundLine.textContent = ''; return; }
    roundLine.textContent = `第 ${frame.round} 回合 · 休整期`;
  }

  function renderTabs() {
    equipTabBtn.classList.toggle('is-active', tab === TAB_EQUIP);
    hexTabBtn.classList.toggle('is-active', tab === TAB_HEX);
    equipView.hidden = tab !== TAB_EQUIP;
    hexView.hidden = tab !== TAB_HEX;
  }

  function renderChips() {
    const counts = new Map();
    for (const row of rows) counts.set(row.tier, (counts.get(row.tier) || 0) + 1);
    const tiers = [...counts.keys()].sort((a, b) => a - b);
    while (tierChips.firstChild) tierChips.removeChild(tierChips.firstChild);
    const all = el('button', 'fst__chip' + (tier === 'all' ? ' is-active' : ''), `全部 ${rows.length}`);
    all.type = 'button';
    all.dataset.action = 'tier';
    all.dataset.tier = 'all';
    tierChips.appendChild(all);
    for (const t of tiers) {
      const chip = el('button', 'fst__chip' + (String(tier) === String(t) ? ' is-active' : ''), `${tierLabel(t)} ${counts.get(t)}`);
      chip.type = 'button';
      chip.dataset.action = 'tier';
      chip.dataset.tier = String(t);
      tierChips.appendChild(chip);
    }
  }

  function canAfford(price) {
    return !!frame && frame.funds >= price;
  }

  function renderList() {
    const visible = filterCatalog(rows, { tier, query });
    // 资金 / 售罄 / 确认态一项没变就不重画（sync 帧会跟着每一次资金变化来，51 行 DOM 不必跟着重建）
    const sig = [rows.length, tier, query, frame ? frame.funds : '', frame && frame.handFull ? 1 : 0, soldOut.size, armed ? `${armed.kind}:${armed.id || ''}` : '', pending() ? 1 : 0].join('|');
    if (sig === listSignature && list.dataset.built === '1') return;
    listSignature = sig;
    list.dataset.built = '1';
    /* 这一层是整块重建（51 行一次换掉），浏览器会把滚动位置丢回顶部 —— 业主 2026-10-26「购买时需要确认，
       但是点一下滚动条会回到最上面」：第一下「购买」只是把 armed 从空变成 {buy,id}，签名一变就整块重画，
       列表弹回顶端，第二下根本点不到原来那一行。
       所以重画前后接住 scrollTop。只有「看什么」变了（件数 / 阶级 / 搜索）才该回到顶部 ——
       那才是真的换了一批内容；资金变化、确认态、售罄、下单空转都属于同一批内容，位置要保住。 */
    const filterSig = [rows.length, tier, query].join('|');
    const keepTop = filterSig === filterSignature ? list.scrollTop : 0;
    filterSignature = filterSig;
    while (list.firstChild) list.removeChild(list.firstChild);
    for (const row of visible) {
      const handFull = !!(frame && frame.handFull);
      const disabled = soldOut.has(row.id) || !canAfford(row.price) || handFull || pending();
      const node = el('div', 'fst__row' + (disabled ? ' is-off' : ''));
      node.dataset.id = row.id;

      const iconWrap = el('div', 'fst__icon');
      const url = iconUrl(row.iconId);
      if (url) {
        const img = el('img', 'fst__icon-img');
        img.src = url;
        img.alt = '';
        img.loading = 'lazy';
        img.addEventListener('error', () => { iconWrap.textContent = String(row.name || '?').slice(0, 1); });
        iconWrap.appendChild(img);
      } else {
        iconWrap.textContent = String(row.name || '?').slice(0, 1);
      }
      node.appendChild(iconWrap);

      const body = el('div', 'fst__body');
      const nameLine = el('div', 'fst__name-line');
      nameLine.appendChild(el('span', 'fst__name', row.name));
      if (row.tier > 0) nameLine.appendChild(el('span', 'fst__tier', tierLabel(row.tier)));
      if (row.bondName) nameLine.appendChild(el('span', 'fst__bond', row.bondName));
      body.appendChild(nameLine);
      const desc = el('div', 'fst__desc', row.desc || '—');
      desc.title = row.desc || row.id;
      body.appendChild(desc);
      node.appendChild(body);

      const side = el('div', 'fst__side');
      side.appendChild(el('div', 'fst__price', priceLine(row.price)));
      const buy = el('button', 'fst__buy');
      buy.type = 'button';
      buy.dataset.action = 'buy';
      buy.dataset.id = row.id;
      if (soldOut.has(row.id)) {
        buy.textContent = '售罄';
        buy.disabled = true;
      } else if (!canAfford(row.price)) {
        buy.textContent = '买不起';
        buy.disabled = true;
      } else if (handFull) {
        buy.textContent = '整备区已满';
        buy.disabled = true;
      } else if (armed && armed.kind === 'buy' && armed.id === row.id) {
        buy.textContent = `确认 · ${row.price}`;
        buy.classList.add('is-armed');
      } else {
        buy.textContent = '购买';
      }
      if (pending()) buy.disabled = true;
      side.appendChild(buy);
      node.appendChild(side);

      list.appendChild(node);
    }
    emptyLine.hidden = visible.length > 0;
    if (!rows.length) emptyLine.textContent = '货架还没送到（等待服务端）。';
    else emptyLine.textContent = '没有符合条件的装备。';
    list.scrollTop = keepTop;   // 重建后把位置放回去；换了内容时 keepTop 就是 0，也就是回到顶部（见上面那段注释）
  }

  function renderHex() {
    if (!frame) return;
    const hex = frame.hex || {};
    const price = Math.max(0, Math.trunc(Number(hex.price) || 0));
    const remain = Math.max(0, Math.trunc(Number(hex.unowned) || 0));
    drawPriceLine.textContent = `${price} 块 / 次 · 随机一张`;
    drawRemain.textContent = remain > 0 ? `还有 ${remain} 张没抽到` : '没有可抽的卡了';
    const armedNow = armed && armed.kind === 'draw';
    drawBtn.textContent = armedNow ? `确认抽取 · ${price}` : `抽取 · ${price}`;
    drawBtn.classList.toggle('is-armed', !!armedNow);
    drawBtn.disabled = remain <= 0 || !canAfford(price) || pending();
    const last = frame.lastOrder;
    if (last && last.ok && last.hex) {
      drawResult.textContent = `上一次：${last.hex.name}（${last.hex.rarity === 'prismatic' ? '3 阶' : last.hex.rarity === 'gold' ? '2 阶' : '1 阶'}）`;
      drawResult.hidden = false;
    }
  }

  function renderBadge() {
    const affordable = rows.some((row) => !soldOut.has(row.id) && canAfford(row.price));
    const canDraw = !!frame && frame.hex && frame.hex.unowned > 0 && canAfford(frame.hex.price);
    tabBadge.hidden = !(affordable || canDraw);
  }

  function renderAll() {
    renderCash();
    renderRound();
    renderTabs();
    renderChips();
    renderList();
    renderHex();
    renderBadge();
  }

  // ---- 网络 --------------------------------------------------------------------------------------------------
  function safeMe() {
    try {
      return ctx.me && typeof ctx.me.snapshot === 'function' ? ctx.me.snapshot() : null;
    } catch {
      return null;
    }
  }

  function sendHello() {
    if (!ctx.net || typeof ctx.net.send !== 'function') return;
    if (ctx.net.send('store', { op: 'hello' })) helloAttempts += 1;
  }

  function tradeable() {
    return !!frame && frame.phase === PHASE_PREP && !frame.closed && frame.alive !== false;
  }

  function onFrame(data) {
    if (disposed || !data || typeof data !== 'object') return;
    if (data.type !== 'state') return;
    seenState = true;
    frame = data;
    if (Array.isArray(data.catalog)) rows = buildRows(data.catalog, readTables());
    if (Array.isArray(data.soldOut)) soldOut = new Set(data.soldOut);
    if (data.lastOrder) showToast(data.lastOrder);
    if (!tradeable()) {
      root.hidden = true;
      if (open) applyOpen(false);
      renderAll();
      return;
    }
    root.hidden = false;
    // 业主 2026-10-23「进局不要自动显示两个界面了」：帧只更新数据，**不替玩家展开抽屉** ——
    // 打开是点按钮那一下的事（原来这里见到第一份 open 帧就自动弹开）。
    renderAll();
  }

  const offFrame = ctx.net && typeof ctx.net.on === 'function' ? ctx.net.on('store', onFrame) : () => {};

  // ---- 交互 --------------------------------------------------------------------------------------------------
  function arm(kind, id) {
    armed = { kind, id: id || null };
    if (armTimer) clearTimeout(armTimer);
    armTimer = setTimeout(() => {
      armTimer = null;
      armed = null;
      renderAll();
    }, ARM_MS);
    renderAll();
  }

  function send(payload) {
    if (!ctx.net || typeof ctx.net.send !== 'function') return false;
    const sent = ctx.net.send('store', payload);
    if (!sent) {
      // 静默失败是这一层最坏的形态（业主 2026-10-20 的「点了没反应」）：连接不在线 / 通道被拒 / 帧没过校验时，
      // 面板必须自己说出来，而不是让玩家以为按钮坏了。
      showToast({ ok: false, text: '操作没有发出去：与服务器的连接不在线或面板通道未接通。请刷新页面后重试。' });
      return false;
    }
    if (sent) {
      pendingUntil = now() + PENDING_MS;
      armed = null;
      setTimeout(() => { if (!disposed) renderAll(); }, PENDING_MS + 20);
    }
    return sent;
  }

  function onRootClick(event) {
    const target = event && event.target;
    const node = target && typeof target.closest === 'function' ? target.closest('[data-action]') : target;
    const action = node && node.dataset ? node.dataset.action : null;
    if (!action) return;
    if (action === 'toggle') {
      applyOpen(!open);
      if (open && !seenState) sendHello();
      return;
    }
    if (action === 'tab') {
      const next = node.dataset.tab === TAB_HEX ? TAB_HEX : TAB_EQUIP;
      if (next === tab) return;
      tab = next;
      armed = null;
      renderAll();
      return;
    }
    if (action === 'tier') {
      const raw = node.dataset.tier;
      tier = raw === 'all' ? 'all' : (Math.trunc(Number(raw)) || 'all');
      renderAll();
      return;
    }
    if (action === 'buy') {
      const id = node.dataset.id;
      if (!id) return;
      if (pending()) return;
      if (!(armed && armed.kind === 'buy' && armed.id === id)) { arm('buy', id); return; }
      send({ op: 'buy', id });
      return;
    }
    if (action === 'draw') {
      if (pending()) return;
      if (!(armed && armed.kind === 'draw')) { arm('draw'); return; }
      send({ op: 'draw' });
    }
  }

  const onSearch = () => {
    query = String(search.value || '');
    renderList();
  };

  root.addEventListener('click', onRootClick);
  search.addEventListener('input', onSearch);

  // ---- 生命周期 ----------------------------------------------------------------------------------------------
  ctx.host.appendChild(root);
  // 初始收起：按钮行里只有一颗「商店」，**不自动弹抽屉**（业主 2026-10-23）。
  applyOpen(false);
  // 面板可能在对局进行中才挂上（重开界面 / 重连）：在房里就先问一次货架。不在房里就等 enterPrep 的下行帧。
  const me = safeMe();
  if (me && me.room && me.room.inMatch) {
    setTimeout(() => { if (!disposed && !seenState) sendHello(); }, 400);
  }

  return {
    unmount() {
      disposed = true;
      if (toastTimer) clearTimeout(toastTimer);
      toastTimer = null;
      if (armTimer) clearTimeout(armTimer);
      armTimer = null;
      try { if (typeof offFrame === 'function') offFrame(); } catch { /* ignore */ }
      try { root.removeEventListener('click', onRootClick); } catch { /* ignore */ }
      try { search.removeEventListener('input', onSearch); } catch { /* ignore */ }
      try {
        while (root.firstChild) root.removeChild(root.firstChild);
        if (root.parentNode) root.parentNode.removeChild(root);
      } catch { /* ignore */ }
    },
  };
}
