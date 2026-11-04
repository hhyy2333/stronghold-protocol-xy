// public/js/ui/skins.js —— 工坊时装的**决策层**（清单 / 选择 / 持久化 / 发帧）。DESIGN §28.28（`docs/design/mod-layer.md`）。
//
// WHY THIS EXISTS
//
// 这条通道在 0.19.41 里**三面都通、只缺决策**：
//   * **数据**：`pack.json.skins` 并进清单 `assets.skins[<charId>] = [{ pack, id, name, series?, desc?, art?, voices? }]`
//     （`shared/workshop.js` 的 `mergeWorkshopSkins`，形状层 `SKIN_FIELDS`）—— 客户端零改动就读得到；
//   * **解析**：`public/js/ui/portraitChain.js` 的步骤 0「提供者先说话」已经写完（`setAppearanceLookup`）；
//   * **协议**：`room.appearance { picks?, avatar? }`（`shared/protocol.js`）服务端存+全房广播（`server/lobby.js`）。
//
// 缺的三样正是本文件与它两个邻居给出的一半：
//   * **清单**：`availableSkins(charId)` —— 这个干员有哪几套**真的有图**（`assets.skins` 是唯一真相）；
//   * **选择**：`{ [charId]: skinId }`，按**干员**记（不是按棋子），持久化在 `sp.pref.skins`；
//   * **发帧**：`room.appearance { picks }` —— 只在**房间上下文**发（标题页 / 大厅里没有那个消息的读者）。
// 另一半（回答解析链的那一问、画那一个「皮肤」区）在 `skinProvider.js` 与 `skinPicker.js`。
//
// 三条刻意的取舍，逐条写在这里：
//
// 1. **键是干员 id（`char_498_inside`），不是棋子 id。** `assets.skins` 按干员分组（同一套外观对该干员的
//    普通 / 精锐 / 自选棋子都成立），协议也是 `picks: { <charId>: { skinId } }`。旧 shim 的注释写的是
//    「chessId → skinId」，但那时**没有任何 UI 能写它**（`skinPicker.js` 只有 4 行、`settings.skinByChar` 全仓
//    只有一句注释），所以这里没有要迁移的既有数据，改的是注释与语义，不是玩家的选择。
//
// 2. **只有「真有图」的时装算可选。** 本树的解析链只画头像 / 立绘（局内 Spine 换装是另一刀，`assets.js
//    spineEntry` 今天不认 `skin`）。一套只带模型的时装选上去**什么都不会变**，把它摆进选择器就是承诺一件做不到的事
//    —— 所以 `availableSkins` 只收 `art` 里有 `avatar` / `avatarE2` / `portrait` / `portraitE2` 的那些。
//    哪天刀二（Spine 换装）落地，把这条判据放宽即可（一处）。
//
// 3. **没选 = 不发消息；清空 = 发一条空的 `picks`。** `room.appearance` 是**展示**消息：`{ picks: {} }` 在协议上
//    合法（`isAppearanceMsg` 的 `isMap` 允许空表），它的语义是「我没有任何换装」——服务端会用浅合并把它replace掉，
//    于是同房的人看到你回到原版。**一次都没选过的玩家不发**（没人在等这个消息，多一条就是白噪音）。
//    见 `appearancePayload` 的 `clear` 参数与 `installAppearanceSync` 里那一条 `lastSent`。
//
// 与设置里那个总闸的关系：`settings.workshopSkins`（默认 true）**不在这里读** —— 它是解析链的门控
// （`portraitChain.setAppearanceFirst`，唯一写入面是 `ui/settings.js`）。关掉时整条链回到「没装」的样子，而本文件
// 仍然记着玩家的选择、也仍然把它发给同房的人（外观是**别人看到你**，本地开关不该替别人决定）。选择器那一侧
// 会自己读链的门控值来隐藏整块（`skinPicker.js` 的模型），这样就不会出现「开关关了、面板还在卖时装」。

import { createStore, loadPref, savePref, store } from '../store.js';
import { data } from '../data.js';
import { net as appNet } from '../net.js';
import { APPEARANCE_LIMITS } from '../../../shared/protocol.js';

/** localStorage 偏好键（`sp.pref.skins`，与仓里其它偏好同一条 `loadPref` / `savePref`）。 */
export const SKINS_PREF = 'skins';
/** store 里放选择的那个字段：`{ [charId]: skinId }`。保留旧 shim 的名字（`screens/loadout.js` 的导出 / 导入读它）。 */
export const SKINS_KEY = 'entries';
/** store 里放同步状态的字段：'idle' | 'pending' | 'sending' | 'synced' | 'error'。 */
export const SKINS_SYNC_KEY = 'sync';
/**
 * 一条 `room.appearance` 最多带几位干员 —— 就是协议的上限（同一格，不另造一个数字）。
 *
 * 它量的是**整份干员名单**，不是「一间房的座位数」：0.19.41 写 64 是照着官方房间 1–4 人想当然，而官方时装包
 * 覆盖 **174 名干员** —— 玩家按干员一套套选下去，第 65 名起就在下面 `parseStoredSkins` 里被**静默截掉**
 * （头像 / 立绘 / 局内模型三样一起不生效，界面上一句话都不说）。数字（256）与两条依据（名单规模、64 KB 单帧）
 * 在 `shared/protocol.js` 的 `APPEARANCE_LIMITS` 上，这里只是引用它，不再存第二份数字。
 */
export const SKIN_PICKS_LIMIT = APPEARANCE_LIMITS.picks;
/** 改动去抖：一次点击一个文件，不需要一条消息一次。 */
export const SYNC_DEBOUNCE_MS = 500;
/** 进房间 / 重连之后的重发延迟：等 `room.state` 那一帧先把 `store.room` 落定。 */
export const ROOM_RESEND_MS = 50;

/** 与 `shared/protocol.js` 的 `isId` 同形（那边不导出，判据只有一份的纪律在这里退让一次：这是本地解析）。 */
const ID_RE = /^[A-Za-z0-9_\-.:]{1,64}$/;
const str = (v) => (typeof v === 'string' && v ? v : null);
const isObj = (v) => !!v && typeof v === 'object' && !Array.isArray(v);

/**
 * 一套时装的「图」：只认这一层认识的四个字段（与 `ART_TABLES.chars` 同形，见 `shared/workshop.js`）。
 * `portrait` 一支在只有 E2 立绘时拿 `portraitE2` 顶上（「放哪个换哪个」），头像那支同理。
 */
function picturesOf(art) {
  if (!isObj(art)) return null;
  const portrait = str(art.portrait) || str(art.portraitE2);
  const avatar = str(art.avatar) || str(art.avatarE2);
  return portrait || avatar ? { portrait, avatar } : null;
}

/**
 * 把存下来的那一份解析成 `{ [charId]: skinId }`：两个非空 id、最多 `SKIN_PICKS_LIMIT` 条。
 *
 * 上限就是协议的上限，因为**这是选择唯一的解析点**（store 的初值、每次编辑、发出去的那一份都过这里）：
 * 超限不是「服务端帮忙截断」，而是一条 `BAD_MSG` 整条拒收、同步永远 error（见 `installAppearanceSync`）。
 * 脏键（空串、带空格的 id）不花预算 —— 手改 localStorage 的人不该把好条目挤出去。
 * @param {unknown} raw
 * @returns {Record<string, string>}
 */
export function parseStoredSkins(raw) {
  const out = {};
  if (!isObj(raw)) return out;
  let kept = 0;
  for (const [charId, skinId] of Object.entries(raw)) {
    if (kept >= SKIN_PICKS_LIMIT) break;
    const skin = str(skinId);
    if (!skin || !ID_RE.test(charId) || !ID_RE.test(skin)) continue;
    out[charId] = skin;
    kept++;
  }
  return out;
}

/** 两份选择是不是同一份（`setSkins` 用它避免「同一个值再点一次」也通知 / 也发帧）。 */
function sameEntries(a, b) {
  const ka = Object.keys(a || {}), kb = Object.keys(b || {});
  if (ka.length !== kb.length) return false;
  for (const k of ka) if (!Object.hasOwn(b || {}, k) || a[k] !== b[k]) return false;
  return true;
}

/**
 * 这台机器上这个玩家的选择，以及它的同步状态。
 *
 * 与 `loadoutStore` 分开、又是同一个理由（`ui/loadoutSync.js`）：它必须在房间 / 对局重置时**活着** ——
 * 换一间房、打一局回来，玩家选的那几套还在。字段名沿用旧 shim 的 `entries` / `sync`，
 * `screens/loadout.js` 的导出 / 导入与「皮肤」区都读 `entries`。
 */
export const skinsStore = createStore({
  [SKINS_KEY]: parseStoredSkins(loadPref(SKINS_PREF, null)),
  [SKINS_SYNC_KEY]: 'idle',
});

/**
 * 整份替换选择（立刻落盘；同步引擎随后会把改动发出去）。
 * @param {Record<string, string>} entries
 * @returns {Record<string, string>} 落下去的那一份（解析过的那份，调用方可以拿它显示）
 */
export function setSkins(entries) {
  const next = parseStoredSkins(entries);
  if (sameEntries(next, skinsStore.get()[SKINS_KEY])) return next;
  try { savePref(SKINS_PREF, next); } catch { /* 隐私模式：这一次会话里照样生效 */ }
  skinsStore.set({ [SKINS_KEY]: next });
  return next;
}

/**
 * 给一个干员选一套外观。空 / 坏 id 不算一次选择（清除请用 `clearSkin`）。
 * @param {string} charId @param {string} skinId
 * @returns {boolean} 是否真的写进去了
 */
export function setSkin(charId, skinId) {
  const id = str(charId), skin = str(skinId);
  if (!id || !skin || !ID_RE.test(id) || !ID_RE.test(skin)) return false;
  const cur = skinsStore.get()[SKINS_KEY] || {};
  if (cur[id] === skin) return true;               // 同一个值：不重写、不通知、不发帧
  setSkins({ ...cur, [id]: skin });
  return true;
}

/**
 * 清掉一个干员的选择（他回到原版外观）。条目**没了**才算清除 —— 与「选了一套今天解析不出来的时装」不同：
 * 后者条目留着，包装回来它就回来了（见 `chosenSkin`）。
 * @param {string} charId
 * @returns {boolean} 是否真的删掉了一条
 */
export function clearSkin(charId) {
  const id = str(charId);
  const cur = skinsStore.get()[SKINS_KEY] || {};
  if (!id || !Object.hasOwn(cur, id)) return false;
  const next = { ...cur };
  delete next[id];
  setSkins(next);
  return true;
}

/** 这个干员选了哪一套（原始条目，不判断它今天还解析得出来），或 null。 */
export const skinFor = (charId) => (str(charId) ? (skinsStore.get()[SKINS_KEY] || {})[charId] || null : null);

/**
 * 清单（`assets.skins`）里这套时装的**原始记录**，或 null。给提供者用（它要按 kind 取字段）。
 * @param {string} charId @param {string} skinId @param {{ manifest?: any }} [opts]
 */
export function skinById(charId, skinId, opts = {}) {
  const id = str(charId), want = str(skinId);
  if (!id || !want) return null;
  const man = manifestOf(opts);
  const list = isObj(man) && isObj(man.skins) ? man.skins[id] : null;
  if (!Array.isArray(list)) return null;
  return list.find((s) => isObj(s) && s.id === want) || null;
}

/** 清单：`opts.manifest`（测试 / 独立通道）优先，否则 `data.get('assets')`（应用里那一份，含内容集视图）。 */
function manifestOf(opts) {
  return opts && Object.hasOwn(opts, 'manifest') ? opts.manifest : data.get('assets');
}

/**
 * 这个干员**可选**的外观（有图的那些，见文件头第 2 条取舍），按清单自己的次序（`mergeWorkshopSkins` 已按
 * `(包 id, 时装 id)` 排好，所以列表次序不取决于加载次序）。
 *
 * 每一行的图已经解析成 URL，空的那一支是 `null`（**不**回落成占位图：画的一方自己决定怎么表示「这套没有头像」）。
 * @param {string} charId
 * @param {{ manifest?: any }} [opts]
 * @returns {{ id: string, pack: string, name: string, series: string|null, desc: string|null,
 *   portrait: string|null, avatar: string|null }[]}
 */
export function availableSkins(charId, opts = {}) {
  const id = str(charId);
  if (!id) return [];
  const man = manifestOf(opts);
  const list = isObj(man) && isObj(man.skins) ? man.skins[id] : null;
  if (!Array.isArray(list) || !list.length) return [];
  const rows = [];
  for (const skin of list) {
    if (!isObj(skin) || !str(skin.id)) continue;
    const pics = picturesOf(skin.art);
    if (!pics) continue;                            // 只有模型 / 只有元数据：选上去什么都不会变
    rows.push({
      id: skin.id,
      pack: str(skin.pack) || '',
      name: str(skin.name) || skin.id,
      series: str(skin.series),
      desc: str(skin.desc),
      portrait: pics.portrait,
      avatar: pics.avatar,
    });
  }
  return rows;
}

/** 这个干员有没有可选的外观（「皮肤」区为不为他出现的那一问）。 */
export const hasSkinChoices = (charId, opts = {}) => availableSkins(charId, opts).length > 0;

/** 整份清单里**有没有任何一个**干员有可选外观（空部署 = 整条通道不存在的那一问）。 */
export function hasAnySkinChoices(opts = {}) {
  const man = manifestOf(opts);
  const table = isObj(man) && isObj(man.skins) ? man.skins : null;
  if (!table) return false;
  return Object.keys(table).some((charId) => hasSkinChoices(charId, opts));
}

/**
 * 这个干员**现在真的穿在身上的**那套外观，或 null（原版）。
 *
 * 三种「当作没选」都不清条目：包被卸掉 / 时装被改名 / 那套今天只剩模型 —— 包装回来它自己就回来了
 * （与解析链的回落同一条纪律：可见、可解释，而不是把玩家的选择偷偷删掉）。
 * @param {string} charId
 * @param {Record<string, string>|null} [entries] 默认用这台机器当前的选择
 * @param {{ manifest?: any }} [opts]
 * @returns {string|null}
 */
export function chosenSkin(charId, entries = null, opts = {}) {
  const id = str(charId);
  if (!id) return null;
  const table = entries && isObj(entries) ? entries : skinsStore.get()[SKINS_KEY] || {};
  const want = str(table[id]);
  if (!want) return null;
  return availableSkins(id, opts).some((r) => r.id === want) ? want : null;
}

/** 把清单拉起来（「皮肤」区要它；`data.load` 是幂等的，已就绪时立刻兑现）。 */
export function loadSkinData() {
  return data.load('assets').catch(() => null);
}

/**
 * `room.appearance` 的载荷 —— 形状见 `shared/protocol.js` 的 `isAppearanceMsg`。
 *
 * 空表那一条（`clear`）是**撤回**：`{ picks: {} }` 在协议上合法，服务端浅合并后你回到原版外观。没有 `clear`
 * 时返回 null —— 一次都没选过的玩家不该发一条什么都没说的消息（服务端也不认识「取其一」这种写法）。
 * @param {Record<string, string>|null} [entries]
 * @param {{ clear?: boolean }} [opts]
 * @returns {{ picks: Record<string, { skinId: string }> } | null}
 */
export function appearancePayload(entries = null, { clear = false } = {}) {
  const table = parseStoredSkins(entries === null || entries === undefined ? skinsStore.get()[SKINS_KEY] : entries);
  const picks = {};
  let n = 0;
  for (const [charId, skinId] of Object.entries(table)) {
    if (n >= SKIN_PICKS_LIMIT) break;
    picks[charId] = { skinId };
    n++;
  }
  if (!n && !clear) return null;
  return { picks };
}

/**
 * 发一条 `room.appearance`。**只在房间上下文发**（标题页 / 大厅里没有读者：服务端会把消息存在会话上，但那是
 * 「进房后谁会看见」的一种浪费，而 `room.state` 到达时我们本来就重发一次）。
 * @param {{ net?: any, room?: any, entries?: Record<string, string>|null, clear?: boolean }} [deps]
 *   `room` 显式给了就用它（`null` = 明确地「不在房间」），没给就读 `store.room`。
 * @returns {Promise<boolean>} 真的发出去没有
 */
export async function sendAppearance({ net = appNet, room, entries = null, clear = false } = {}) {
  const where = room === undefined ? store.get().room : room;
  if (!where) return false;
  const payload = appearancePayload(entries, { clear });
  if (!payload) return false;
  await net.request('room.appearance', payload);
  return true;
}

/**
 * 把选择**持续**发给服务端：改动去抖后发一条；`welcome`（新会话 / 重连）与 `room.state`（进房）之后重发一次
 * —— 服务端把外观存在**会话**上，换了会话它手里就没有了，而玩家不会为了这个再点一次。
 *
 * 依赖全部可注入（`net` / `target` / `roomOf` / `timers`），所以测试里不碰真 socket、不 sleep。
 * 应用里由 `skinPicker.js` 在开机时装一次（`main.js` 不需要改：`screens/loadout.js` 在开机时 import 它）。
 * @param {{ net?: any, target?: ReturnType<typeof createStore>, roomOf?: () => any,
 *   timers?: { setTimeout: Function, clearTimeout: Function } }} [deps]
 * @returns {{ flush: () => Promise<void>, dispose: () => void }}
 */
export function installAppearanceSync({ net = appNet, target = skinsStore, roomOf, timers } = {}) {
  const T = timers || { setTimeout: (fn, ms) => globalThis.setTimeout(fn, ms), clearTimeout: (id) => globalThis.clearTimeout(id) };
  const roomNow = roomOf || (() => store.get().room);
  let timer = null;
  let lastSent = null;   // 上一次服务端收下的那份（JSON）—— `json === lastSent` 时不再发
  let disposed = false;

  const setState = (sync) => { if (target.get()[SKINS_SYNC_KEY] !== sync) target.set({ [SKINS_SYNC_KEY]: sync }); };
  const schedule = (ms = SYNC_DEBOUNCE_MS) => {
    if (disposed) return;
    T.clearTimeout(timer);
    setState('pending');
    timer = T.setTimeout(() => { timer = null; void flush(); }, ms);
  };

  async function flush() {
    if (disposed) return;
    const entries = target.get()[SKINS_KEY] || {};
    // 没有选择时：只有「上次说过话」的那一次才值得撤回（否则什么都不发，见 appearancePayload）
    const payload = appearancePayload(entries, { clear: lastSent != null });
    if (!payload) { setState('idle'); return; }
    const json = JSON.stringify(payload);
    if (json === lastSent) { setState('synced'); return; }
    if (!roomNow()) { setState('idle'); return; }   // 不在房间：改动留着，`room.state` 到达时重发
    setState('sending');
    try {
      await sendAppearance({ net, room: roomNow(), entries, clear: entries && Object.keys(entries).length === 0 });
      lastSent = json;
      setState('synced');
    } catch (err) {
      const code = err && err.code;
      // RATE / TIMEOUT / OFFLINE 是「等会儿再试」（下一次改动或下一次 room.state 会重发），其余是坏形状：点名留在状态里
      setState(code === 'RATE' || code === 'TIMEOUT' || code === 'OFFLINE' ? 'pending' : 'error');
    }
  }

  const offStore = target.subscribe((s, prev) => { if (s[SKINS_KEY] !== prev[SKINS_KEY]) schedule(); });
  const onArrive = () => { lastSent = null; schedule(ROOM_RESEND_MS); };
  const offRoom = net.on('room.state', onArrive);
  const offWelcome = net.on('welcome', onArrive);

  return {
    flush,
    dispose() {
      disposed = true;
      T.clearTimeout(timer);
      timer = null;
      offStore?.();
      offRoom?.();
      offWelcome?.();
    },
  };
}

/** 这台机器当前的选择（`{ [charId]: skinId }` 的快照；屏幕 / 测试读它，不猜 store 的形状）。 */
export const skinEntries = () => ({ ...(skinsStore.get()[SKINS_KEY] || {}) });
