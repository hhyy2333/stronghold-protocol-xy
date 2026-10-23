// server/store.mjs —— 「战地商店」工坊包的服务端模块（pack.json.server.modules[].entry）。
//
// 装载点：`uses: ["matchClass"]`（docs/WORKSHOP.md §1.12，DESIGN §28.14）。引擎在装载期先做一次源码静态扫描
// （process / globalThis / require / eval / new Function 一律拒），再 `import()` 并调用 `registerServer(host)`；
// 宿主把这里返回的那一层按包 id 次序套在 MatchClass 上。**这是唯一能碰到整局对局的挂载点**，所以 pack.json
// 必须同时声明 `combat: true`（MODULES_NEED_COMBAT）—— 进房间摘要闸门，两端字节一致。
//
// 规则（业主 2026-10-23 定的三条，本文件照做）：
//   1. 装备：**每回合上架全部装备** —— 不轮换、不抽 3 件、没有「换一批」。装备范畴 = 引擎自己的可上架装备
//      （`gd.shopItemsByTier` = EQUIP && !isGolden && !hideInShop && !shopExcluded），因此天然排除「协议源石的
//      装备」那 7 件（幽魂 / 恶魔之契 / 残光 / 加护 / 万物归虚 / 尸山 / 心之钢；它们 hideInShop 且 price 0）。
//      这里**不另写一份筛选规则**：数据长大之后货架自动跟着长。
//   2. 价格：装备 = 原价 ×3（整数，原价 1~5 ⇒ 3~15）；抽取协议源石 = **12 块一次**。
//   3. 抽卡是「随机 1 张」：按 1/2/3 阶权重（`gd.hexWeights()`，46 % / 38 % / 16 %），档内均匀，跳过已拥有与该
//      玩家自己的局外禁用（与草稿池的 `poolFor` 同一条规则）。
//
// 这个文件**零 import**：常量、随机源、记账全在同一个文件里 —— 包的入口模块不跨包 import，也不 import 引擎内部
// （同一份字节要在服务器上跑，就得自己带齐）。所有覆写都包在 try/catch 里：商店坏了最多是「商店不动」，绝不
// 允许把一局打崩。
//
// 确定性：本文件不读时钟、不用 `Math.random`、不借 `m.rngShop` / `m.rngHex`。装备货架是全集（**没有随机**）；
// 抽卡用本文件自己的 mulberry32 流，种子 = (本局 seed, 回合, 玩家 id, 该玩家第几次抽) —— 同一局面重放拿到同一
// 张卡，而且不扰动引擎自己的抽取 / 商店随机流。
//
// 唯一的引擎依赖是 `Match.grantHex(ps, hexId)`（DESIGN §28.58）：正式抽取路径（onPick 即时效果 + 持久
// `hex:<id>` EffectRef + 战斗半边 + 镜像协议等 extras）在引擎里，包不该也不能自己拼一份会静默漂移的副本。

/** 包 id（线上 `pack.msg` 的 `pack` 字段；必须与 pack.json 的 id 逐字相同）。 */
const PACK_ID = 'field-store';
/** 面板 → 服务端，以及服务端 → 面板，都走这一个通道（面板 `messages` 与 server.modules[].channels 都声明过）。 */
const CHANNEL = 'store';
/** 可以买东西的对局相位：只有休整期。字符串与 shared/constants.js 的 PHASE.PREP 同值（不 import 引擎）。 */
const PHASE_PREP = 'PREP';

/** 业主：装备价格是原来的 3 倍。 */
export const EQUIP_MUL = 3;
/** 业主：抽取协议源石 12 块一次。 */
export const HEX_PRICE = 12;
/** 一帧 `pack.msg` 里 `data` 的字节上限（shared/protocol.js 的 PACK_MSG_LIMITS.bytes）。 */
export const FRAME_BYTES = 4096;

/** 二阶 / 三阶的中文名，给回执与播报用（面板自己也有一份，这里只用于服务端文本）。 */
const RARITY_TEXT = Object.freeze({ silver: '1 阶', gold: '2 阶', prismatic: '3 阶' });

// ===== 纯函数（导出给测试钉口径） ===========================================================================

/**
 * 一件装备在本店的售价：原价 ×3，整数、非负。`gd.itemPrice` 已经兜底过缺价（默认 2），这里只做倍率。
 * @param {number} base 原价（data/items.json 的 price）
 * @returns {number}
 */
export function equipPriceOf(base) {
  const n = Number(base);
  if (!Number.isFinite(n) || n <= 0) return 0;
  return Math.trunc(n) * EQUIP_MUL;
}

/**
 * 一名玩家已拥有的协议源石 id（与引擎 `hexIdsOf` 同一判据：`hex:` 前缀 ref 的 `data.hexId`）。
 * 包不 import 引擎，所以这里复刻的是**数据形状**而不是规则：形状由 shared/hextech.js `hexEffectKey` 定义。
 * @param {Array<{key?: string, data?: {hexId?: string}}>} effects
 * @returns {string[]}
 */
export function ownedHexIds(effects) {
  const out = [];
  for (const e of Array.isArray(effects) ? effects : []) {
    if (!e || typeof e.key !== 'string' || !e.key.startsWith('hex:')) continue;
    const id = e.data && typeof e.data.hexId === 'string' ? e.data.hexId : e.key.slice(4);
    if (id) out.push(id);
  }
  return out;
}

/** Rarity order, weakest first (shared/hextech.js RARITY_ORDER). */
const RARITY_ORDER = Object.freeze(['silver', 'gold', 'prismatic']);

/** Position of a rarity in the escalation order, or -1 (shared/hextech.js rarityRank). */
function rarityRank(id) {
  return RARITY_ORDER.indexOf(String(id));
}

/** Uniform pick from an array (shared/hextech.js pickOne). */
function pickOne(rng, list) {
  if (!Array.isArray(list) || !list.length) return null;
  const i = Math.min(list.length - 1, Math.max(0, Math.floor(rng() * list.length)));
  return list[i];
}

/** One rarity, weighted by `weights` (shared/hextech.js pickRarity — same order of `rng()` calls). */
function pickRarity(rng, available, weights) {
  const ids = [...new Set(available)].filter((id) => rarityRank(id) >= 0);
  if (!ids.length) return null;
  const w = ids.map((id) => {
    const v = weights && Number.isFinite(weights[id]) ? weights[id] : 1;
    return v > 0 ? v : 0;
  });
  const total = w.reduce((s, v) => s + v, 0);
  if (total <= 0) return pickOne(rng, ids);
  let roll = rng() * total;
  for (let i = 0; i < ids.length; i++) {
    roll -= w[i];
    if (roll < 0) return ids[i];
  }
  return ids[ids.length - 1];
}

/**
 * One unowned 协议源石 id, drawn exactly like a one-card draft offer
 * (`rollOffers(rng, { pool, owned, weights, count: 1 })[0]` in shared/hextech.js): rarity by weight, then uniform
 * inside that rarity. Kept here rather than imported because a pack module must not import engine internals.
 * @param {() => number} rng
 * @param {{ pool?: Array<{id: string, rarity: string}>, owned?: Iterable<string>, weights?: Record<string, number> }} args
 * @returns {string|null}
 */
export function pickUnownedHex(rng, { pool, owned = [], weights = null } = {}) {
  const taken = new Set(owned);
  const candidates = (Array.isArray(pool) ? pool : []).filter((h) => h && !taken.has(h.id));
  if (!candidates.length) return null;
  const available = [...new Set(candidates.map((h) => h.rarity))];
  const rarity = pickRarity(rng, available, weights);
  if (!rarity) return null;
  const picked = pickOne(rng, candidates.filter((h) => h.rarity === rarity));
  return picked ? picked.id : null;
}

/**
 * 本店的货架：`gd.shopItemsByTier` 摊平（可上架装备全集），按 (tier, 原价, id) 排序 —— 顺序稳定，面板与测试
 * 都按这个顺序断言。每行带着价格，面板不需要自己乘。
 * @param {any} gd GameData
 * @returns {Array<{id: string, tier: number, name: string, desc: string, iconId: string, bondId: string|null, base: number, price: number}>}
 */
export function catalogOf(gd) {
  const out = [];
  const byTier = (gd && gd.shopItemsByTier) || {};
  const tiers = Object.keys(byTier).map(Number).filter((t) => Number.isFinite(t)).sort((a, b) => a - b);
  for (const tier of tiers) {
    for (const id of byTier[tier] || []) {
      const rec = gd.item(id);
      if (!rec) continue;
      const base = gd.itemPrice(id);
      out.push({
        id,
        tier,
        name: String(rec.name || id),
        desc: String(rec.desc || ''),
        iconId: String(rec.iconId || ''),
        bondId: typeof rec.giveBondId === 'string' ? rec.giveBondId : null,
        base,
        price: equipPriceOf(base),
      });
    }
  }
  out.sort((a, b) => (a.tier - b.tier) || (a.base - b.base) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  return out;
}

/** UTF-8 byte length without Buffer (a pack module may be imported by tests in any order). */
export function utf8Length(str) {
  let n = 0;
  for (let i = 0; i < str.length; i++) {
    const c = str.charCodeAt(i);
    if (c < 0x80) n += 1;
    else if (c < 0x800) n += 2;
    else if (c >= 0xd800 && c <= 0xdbff) { n += 4; i += 1; }
    else n += 3;
  }
  return n;
}

/** The byte size of one frame (what the protocol layer would measure). */
export function frameBytes(frame) {
  return utf8Length(JSON.stringify(frame));
}

/**
 * A deterministic PRNG for the draw: FNV-1a over the seed parts, then mulberry32. Integer-only math, so it gives the
 * same sequence everywhere and never touches an engine stream.
 * @param {Array<string|number>} parts
 * @returns {() => number} uniform in [0, 1)
 */
export function seededRng(parts) {
  let h = 2166136261 >>> 0;
  for (const part of parts) {
    const s = String(part);
    for (let i = 0; i < s.length; i++) {
      h ^= s.charCodeAt(i) & 0xffff;
      h = Math.imul(h, 16777619) >>> 0;
    }
    h ^= 0x9e3779b9;
    h = Math.imul(h, 16777619) >>> 0;
  }
  let a = h >>> 0;
  return function next() {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** 拒绝理由的中文文案（面板原样显示在回执行里）。 */
export function refusalText(code, extra = {}) {
  switch (code) {
    case 'phase': return '只在休整期营业。';
    case 'closed': return '本局已经结束了。';
    case 'dead': return '你已经被淘汰了。';
    case 'seat': return '这一格不是真人在玩。';
    case 'item': return '货架上没有这件装备。';
    case 'stock': return '这件装备的共享库存已经见底了。';
    case 'funds': return `资金不足（还差 ${Math.max(0, Math.trunc(extra.need || 0))} 块）。`;
    case 'hand': return '整备区已满，先腾出一格。';
    case 'noHex': return '没有可抽的协议源石了（已全部拥有 / 被禁用）。';
    case 'grant': return '这张协议源石没有发下来，钱没有扣。';
    case 'unknown': return '未知操作。';
    default: return '这笔交易没有完成。';
  }
}

// ===== 服务端模块入口 ======================================================================================

/**
 * 服务端模块入口（宿主约定：`export function registerServer(host)`）。
 * @param {{ matchClass: (fn: (Base: Function) => Function) => boolean }} host
 */
export function registerServer(host) {
  host.matchClass((Base) =>
    class FieldStoreMatch extends Base {
      // ---- 生命周期覆写：先让引擎把这一回合该做的做完，再动商店 ---------------------------------------------

      startRound(round) {
        const result = super.startRound(round);
        try {
          this._fsEnsure();
        } catch (error) {
          this._fsSwallow('startRound', error);
        }
        return result;
      }

      enterPrep() {
        const result = super.enterPrep();
        try {
          this._fsEnsure();
          this._fsPushAll('open');
        } catch (error) {
          this._fsSwallow('enterPrep', error);
        }
        return result;
      }

      startCombat() {
        const result = super.startCombat();
        try {
          const st = this._fsState();
          if (st) this._fsPushAll('combat');
        } catch (error) {
          this._fsSwallow('startCombat', error);
        }
        return result;
      }

      /**
       * 资金同步：引擎把资金放在 `m.private` 里，面板拿不到 store（注入面只有 net.on / net.send），所以现金
       * 变化由服务端补帧 —— 挂在引擎已有的 `flush()` 上，按「这名玩家上一次发出去的现金」去重。零轮询、零定时器。
       */
      flush(forcePublic = false) {
        const result = super.flush(forcePublic);
        try {
          this._fsSyncCash();
        } catch (error) {
          this._fsSwallow('flush', error);
        }
        return result;
      }

      finish(options) {
        try {
          const st = this._fsState();
          if (st) {
            st.closed = true;
            this._fsPushAll('close');
          }
        } catch (error) {
          this._fsSwallow('finish', error);
        }
        return super.finish(options);
      }

      /**
       * 包通道的**唯一**接收入口（docs/WORKSHOP.md §1.9.6 / §1.12）：引擎在限流之后、转发之前调一次。
       * 返回 true = 已消费（本店的消息不给同房其他人看）。
       */
      handlePackMsg(playerId, msg) {
        try {
          if (!msg || msg.pack !== PACK_ID || msg.channel !== CHANNEL) return false;
          const ps = this.players && this.players.get ? this.players.get(playerId) : null;
          if (!ps) return true;
          this._fsEnsure();
          const data = msg.data && typeof msg.data === 'object' ? msg.data : {};
          const op = data.op;
          if (op === 'hello') { this._fsPush(ps, 'open'); return true; }
          if (op === 'buy') { this._fsBuy(ps, data.id); return true; }
          if (op === 'draw') { this._fsDraw(ps); return true; }
          this._fsPush(ps, 'sync', { ok: false, op: String(op || ''), text: refusalText('unknown') });
          return true;
        } catch (error) {
          // [诊断 2026-10-24] 以前这里静默吞掉：一条抛错的购买会让面板永远等不到回执。
          console.error('[field-store] handler threw', error);
          this._fsSwallow('handlePackMsg', error);
          return true;
        }
      }

      // ---- 状态 ------------------------------------------------------------------------------------------

      /** 商店状态懒创建：装载期什么都不做（干净安装为零影响）。 */
      _fsState() {
        return this._fieldStore || null;
      }

      _fsEnsure() {
        if (this._fieldStore) return this._fieldStore;
        this._fieldStore = {
          closed: false,
          /** 货架（可上架装备全集，含价格）—— 只依赖 GameData，整局不变。 */
          rows: null,
          /** id → row */
          byId: null,
          /** 每名玩家上一次发出去的现金（`_fsSyncCash` 去重凭它）。 */
          cashSent: new Map(),
          /** 每名玩家第几次抽卡（抽卡随机流的种子之一，也让同一回合的多次抽取各不相同）。 */
          drawSeq: new Map(),
        };
        return this._fieldStore;
      }

      /** 货架（懒建一次）。 */
      _fsRows() {
        const st = this._fsEnsure();
        if (!st.rows) {
          st.rows = catalogOf(this.gd);
          st.byId = new Map(st.rows.map((row) => [row.id, row]));
        }
        return st.rows;
      }

      /** 本局所有还坐在座位上的真人（AI 不进商店，观战者不在 players 里）。 */
      _fsHumans() {
        const out = [];
        if (!this.players || typeof this.players.values !== 'function') return out;
        for (const ps of this.players.values()) {
          if (ps && !ps.isBot && !ps.left) out.push(ps);
        }
        return out;
      }

      _fsSwallow(where, error) {
        try {
          this.reportError(`field-store:${where}`, error);
        } catch { /* console-less environments */ }
      }

      // ---- 闸门 ------------------------------------------------------------------------------------------

      /** 一笔交易的前置条件；返回拒绝码，或 null（可以继续）。所有闸门都在扣钱之前。 */
      _fsGate(ps) {
        const st = this._fsState();
        if (!st || st.closed) return 'closed';
        if (this.phase !== PHASE_PREP) return 'phase';
        if (!ps || !ps.alive) return 'dead';
        if (ps.isBot || ps.left) return 'seat';
        return null;
      }

      _fsRefuse(ps, op, code, extra) {
        this._fsPush(ps, 'sync', { ok: false, op, code, text: refusalText(code, extra) });
      }

      // ---- 买装备 ----------------------------------------------------------------------------------------

      /**
       * op 'buy' { id } —— 装备是**全集**上架，所以这里没有「售罄格」：共享库存说话（`itemPool.canGain`），
       * 手牌满则拒（与引擎 `economy.buy` 同一判据），钱不够则拒。全买得起就扣钱 → 走引擎的 `acquireItem`
       * （合并、进整备区、库存记账都是它），然后补 onBuy / onSpend（整备 / 债务这类卡要看见「买了东西」）。
       * @param {any} ps
       * @param {any} id
       */
      _fsBuy(ps, id) {
        const gate = this._fsGate(ps);
        if (gate) return this._fsRefuse(ps, 'buy', gate);
        const st = this._fsEnsure();
        this._fsRows();
        const row = typeof id === 'string' && st.byId ? st.byId.get(id) : null;
        if (!row) return this._fsRefuse(ps, 'buy', 'item');
        const price = row.price;
        if (!(price > 0)) return this._fsRefuse(ps, 'buy', 'item');
        // 共享库存（默认数据是无限库存；有上限的服里别家抽空之后这里会说「见底」）。
        if (this.itemPool && typeof this.itemPool.canGain === 'function' && !this.itemPool.canGain(row.id)) {
          return this._fsRefuse(ps, 'buy', 'stock');
        }
        if (!(ps.funds >= price)) return this._fsRefuse(ps, 'buy', 'funds', { need: price - ps.funds });
        // 与 economy.buy 同一条「整备区已满」判据（装备可以进整备区，但手牌满时引擎一律拒绝购买）。
        const handFull = !(Array.isArray(ps.hand) && ps.hand.some((slot) => slot == null));
        if (handFull) return this._fsRefuse(ps, 'buy', 'hand');
        const piece = ps.acquireItem(row.id, { source: 'shop' });
        if (!piece) return this._fsRefuse(ps, 'buy', 'stock');
        ps.spend(price);
        try {
          ps.stats.buys += 1;
          ps.round.buys += 1;
        } catch { /* stats are engine-owned; a missing counter must not break the purchase */ }
        try {
          this.dispatch(ps, 'onBuy', { piece, slot: { kind: 'item', id: row.id, price }, price, kind: 'item' });
          this.dispatch(ps, 'onSpend', { amount: price, reason: 'shop', total: ps.stats.gold });
        } catch (error) {
          this._fsSwallow('dispatch-buy', error);
        }
        try { ps.recompute(); } catch (error) { this._fsSwallow('recompute-buy', error); }
        this._fsPush(ps, 'buy', { ok: true, op: 'buy', id: row.id, name: row.name, price });
      }

      // ---- 抽协议源石 ------------------------------------------------------------------------------------

      /**
       * op 'draw' {} —— 12 块抽 1 张。顺序是「先确认真的抽得到，再抽，最后扣钱」：抽不到（池子空了 / 已全拥有）
       * 或 `grantHex` 失败都**不扣钱**。抽到的卡走 `Match.grantHex`（DESIGN §28.58）—— 正式路径。
       * @param {any} ps
       */
      _fsDraw(ps) {
        const gate = this._fsGate(ps);
        if (gate) return this._fsRefuse(ps, 'draw', gate);
        const gd = this.gd;
        const base = gd.hexPlayerPool();
        const bans = Array.isArray(ps.hexBans) ? ps.hexBans : [];
        const pool = bans.length ? base.filter((h) => h && !bans.includes(h.id)) : base;
        const owned = ownedHexIds(ps.effects);
        const taken = new Set(owned);
        const candidates = pool.filter((h) => h && !taken.has(h.id));
        if (!candidates.length) return this._fsRefuse(ps, 'draw', 'noHex');
        if (!(ps.funds >= HEX_PRICE)) return this._fsRefuse(ps, 'draw', 'funds', { need: HEX_PRICE - ps.funds });
        const st = this._fsEnsure();
        const seq = st.drawSeq.get(ps.playerId) || 0;
        const rng = seededRng([Number(this.seed) >>> 0, this.round, ps.playerId, 'store-draw', seq]);
        const id = pickUnownedHex(rng, { pool, owned, weights: gd.hexWeights() });
        if (!id) return this._fsRefuse(ps, 'draw', 'noHex');
        if (typeof this.grantHex !== 'function') return this._fsRefuse(ps, 'draw', 'grant');
        const hex = this.grantHex(ps, id);
        if (!hex) return this._fsRefuse(ps, 'draw', 'grant');
        ps.spend(HEX_PRICE);
        st.drawSeq.set(ps.playerId, seq + 1);
        try {
          this.dispatch(ps, 'onSpend', { amount: HEX_PRICE, reason: 'shop', total: ps.stats.gold });
        } catch (error) {
          this._fsSwallow('dispatch-draw', error);
        }
        try {
          const who = ps.name || ps.playerId;
          this.tickerText(`【战地商店】${who} 抽到了协议源石「${hex.name}」（${RARITY_TEXT[hex.rarity] || hex.rarity}）。`, 4);
        } catch (error) {
          this._fsSwallow('ticker', error);
        }
        this._fsPush(ps, 'draw', {
          ok: true,
          op: 'draw',
          price: HEX_PRICE,
          hex: { id: hex.id, name: hex.name, desc: hex.desc, rarity: hex.rarity },
        });
      }

      // ---- 下发 ------------------------------------------------------------------------------------------

      /** 一名玩家的状态帧。`kind: 'sync'` 是省钱版：只带现金 + 已经没有库存的 id（货架面板自己留着）。 */
      _fsFrame(ps, kind, lastOrder) {
        const st = this._fsEnsure();
        const rows = this._fsRows();
        const lean = kind === 'sync';
        const catalog = [];
        const soldOut = [];
        for (const row of rows) {
          const left = this.itemPool && typeof this.itemPool.left === 'function' ? this.itemPool.left(row.id) : -1;
          const canGain = this.itemPool && typeof this.itemPool.canGain === 'function' ? this.itemPool.canGain(row.id) : true;
          if (!lean) catalog.push([row.id, row.price, left === Infinity || !Number.isFinite(left) ? -1 : Math.trunc(left)]);
          if (!canGain) soldOut.push(row.id);
        }
        return {
          t: 'pack.msg',
          pack: PACK_ID,
          channel: CHANNEL,
          data: {
            type: 'state',
            kind,
            round: this.round,
            phase: this.phase,
            closed: !!st.closed,
            alive: !!(ps && ps.alive),
            /**
             * 手牌（整备区）是否已满 —— 与 _fsBuy / economy.buy 同一条判据。面板拿它把「购买」按钮直接改成
             * 「整备区已满」并禁用，而不是让玩家点两下、服务端拒绝、界面又只闪一行小字。
             */
            handFull: !(Array.isArray(ps && ps.hand) && ps.hand.some((slot) => slot == null)),
            funds: Math.max(0, Math.trunc(Number(ps && ps.funds) || 0)),
            /** 全集货架（[id, 本店价, 剩余库存(-1 = 不限)]）。只有全量帧带；`sync` 帧不重复 51 行。 */
            catalog: lean ? null : catalog,
            soldOut,
            hex: { price: HEX_PRICE, unowned: this._fsUnownedCount(ps) },
            lastOrder: lastOrder || null,
          },
        };
      }

      _fsUnownedCount(ps) {
        try {
          const gd = this.gd;
          const bans = Array.isArray(ps && ps.hexBans) ? ps.hexBans : [];
          const owned = new Set(ownedHexIds(ps && ps.effects));
          return gd.hexPlayerPool().filter((h) => h && !owned.has(h.id) && !bans.includes(h.id)).length;
        } catch {
          return 0;
        }
      }

      _fsPush(ps, kind, lastOrder) {
        if (!ps || typeof ps.playerId !== 'string') return;
        const frame = this._fsFrame(ps, kind, lastOrder);
        if (!frame) return;
        const st = this._fsState();
        if (st) st.cashSent.set(ps.playerId, frame.data.funds);
        // 帧体上限：真超了（正常不会）就把货架让出去，保留现金与回执，绝不发一条会被协议层拒掉的帧。
        if (frameBytes(frame) > FRAME_BYTES && Array.isArray(frame.data.catalog)) {
          frame.data.catalog = null;
          frame.data.catalogOmitted = true;
        }
        this.sendTo(ps.playerId, frame);
      }

      _fsSyncCash() {
        const st = this._fsState();
        if (!st || st.closed) return;
        for (const ps of this._fsHumans()) {
          if (!ps.alive) continue;
          const cash = Math.max(0, Math.trunc(Number(ps.funds) || 0));
          if (st.cashSent.get(ps.playerId) === cash) continue;
          this._fsPush(ps, 'sync');
        }
      }

      _fsPushAll(kind) {
        if (!this._fsState()) return;
        for (const ps of this._fsHumans()) this._fsPush(ps, kind);
      }
    },
  );
}
