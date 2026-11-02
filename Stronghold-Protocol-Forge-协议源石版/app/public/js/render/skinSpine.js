// public/js/render/skinSpine.js —— 局内 Spine 换装的**解析层**（刀二；DESIGN §28.28 / `docs/WORKSHOP.md` §1.17）。
//
// 这个模块只回答一个问题：**这个单位现在该用哪套时装的模型**？答案是一个 `{ charId, skinId, sides }`，
// 其中 `sides` 就是 `pack.json.skins[].art.spine` 那一层（`{ front, back }`），交给 `assets.js spineEntry(id, { skin })`。
// 它**不画**任何东西、不加载任何东西、不改任何状态 —— 纯查询，所以能在 Node 里逐条钉住（test/render/skin-spine.test.js）。
//
// WHY THIS EXISTS
//
// 服务端早就把外观发下来了（`room.state.seats[].appearance = { picks?: { <charId>: { skinId } } }`，
// `server/lobby.js`；换装即广播 `room.state`），客户端此前**一处都没读**它。棋盘上的小人换装要的正是这一步：
//
//   单位 → 它属于哪个座位/玩家（`info.ownerId`）→ `seats[].appearance.picks[<charId>].skinId`
//        → `assets.skins[<charId>]` 里那一条 → `art.spine` → `spineEntry(…, { skin })` → `assets.spine.acquire`
//
// **`info.ownerId` 就是座位上的 `playerId`**（`server/match/PlayerState.js`：`this.playerId = seat.playerId`；
// sim 的 `unitInfo` 原样带上它），所以「单位 → 座位」是一次 `playerId` 相等比较，**不需要**给 UnitInfo 加字段、
// 也不需要动 `server/**`。这是本刀选的那条数据通路，理由写在报告的「数据通路」一节。
//
// 三条刻意的取舍：
//
// 1. **自己的那一半先看本机选择（`sp.pref.skins`），再看房间那一份。** 点一下要立刻看到自己的小人换了 —— 房间那一帧
//    要先去抖 500 ms、再等服务端广播回来（`ui/skins.js` 的 `installAppearanceSync`），等它就是「点了没反应」。
//    本机**有**选择时它就是权威：那一套没有模型（只换头像）或清单里没有（包被卸掉）⇒ 原版模型，**不**拿房间里那套
//    旧的顶上（那会画出玩家刚刚换掉的外观）。本机**没有**选择才看房间那一份（另一个标签页换的、偏好被清了）。
//    房间那一份才是**别人**看到你的依据，所以：别人的座位只认房间，自己的两条都认（本机优先）。两份一致时没有差别。
// 2. **关掉「工坊外观」（设置 `settings.workshopSkins`）时这里整个返回 null。** 门控读的是
//    `ui/portraitChain.js` 的 `appearanceFirstEnabled()` —— 头像/立绘那个解析链与局内模型**同一个开关**（唯一写入面
//    是 `ui/settings.js`），否则会出现「头像换了、小人没换」的半开状态（对比报告 §6.4 点过这一条）。
// 3. **键是干员 id（`char_498_inside`），不是棋子 id、也不是骨架 id。** `assets.skins` 与协议都是按干员分的；
//    棋子 id 到干员的映射是 `info.spine`（`data/chess.json` 的 `assets.spine`，替身/自选已经是它自己的干员），
//    带 `_1` / `_2` 艺术版本后缀时再退一步到 `assets.js baseCharId`。
//
// 失败方向（全部 = 「当作没选」⇒ 画原版模型，可见、静默、可解释）：
//   * 没有座位 / 座位里没有 picks / 这个干员没选 → null；
//   * 选了，但清单里没有那一条（包被卸掉、时装改名）→ null（不清玩家的选择：包装回来它就回来了）；
//   * 那一条只有头像（`art` 里没有 `spine`）→ null；
//   * `art.spine.front` 不成形（缺 skel/atlas/anims，`validSpine` 的判据，见 assets.js `outfitUsable`）→ null。
//
// 回退办法：`render/units.js` 不传 `opts.skin`（或删掉本文件与它的 import）⇒ 全仓回到 0.19.41 的样子，一个字节不改；
// 玩家侧则只要关掉设置里的「工坊外观」。
//
// 记忆化：`picksOf` 按 room 对象、`skinRecord` / `outfitOf` 按清单对象各记一层 —— 所以同一 (charId, skinId)
// 每次拿到的是**同一个对象**（`render/units.js` 的 `retryAssets` 会跨帧比较模型，身份不稳会让它反复重载）。
// `appearanceGen()` 是那条「外观帧到了」的廉价信号：每帧一个整数比较，外观表真的变了才 +1。

import { baseCharId, spineSides } from '../assets.js';
import { loadPref, store } from '../store.js';
import { appearanceFirstEnabled } from '../ui/portraitChain.js';

/** 本机选择的偏好键（`sp.pref.skins`）—— 与 `ui/skins.js` 的 `SKINS_PREF` **同一格**；那边是唯一写入面。 */
export const SKINS_PREF = 'skins';

const str = (v) => (typeof v === 'string' && v ? v : null);
const isObj = (v) => !!v && typeof v === 'object' && !Array.isArray(v);

// ---- 座位 → picks ------------------------------------------------------------------------------------------

/** room 对象 → Map(playerId → picks)：一份 `room.state` 帧里座位的 picks 只挑一次（换一帧就是一个新 room 对象）。 */
const picksByRoom = new WeakMap();

/**
 * 一座座位上这个玩家选的外观：`{ [charId]: { skinId } }`，没有就是 null。
 *
 * 形状照 `server/lobby.js toState()`（只有选过才有 `appearance`）；座位数组里的空位（`null`）照常跳过，
 * 所以这个方法对「4 人房」与「100 人房」一视同仁。
 * @param {any} room `room.state` 那一帧
 * @param {string|null} playerId 单位身上的 `ownerId`
 * @returns {Record<string, any>|null}
 */
export function picksOf(room, playerId) {
  const id = str(playerId);
  if (!id || !isObj(room) || !Array.isArray(room.seats)) return null;
  let table = picksByRoom.get(room);
  if (!table) {
    table = new Map();
    for (const seat of room.seats) {
      if (!isObj(seat) || !str(seat.playerId)) continue;
      const picks = isObj(seat.appearance) && isObj(seat.appearance.picks) ? seat.appearance.picks : null;
      if (picks) table.set(seat.playerId, picks);
    }
    picksByRoom.set(room, table);
  }
  return table.get(id) || null;
}

/**
 * 从一张「干员 → 时装」的表里取这个单位的那一条。两种形状都认：
 * 协议的 `picks[charId] = { skinId }`，以及本机偏好的 `entries[charId] = skinId`（裸字符串）。
 * @param {any} table @param {string} id 单位的干员 id（`info.spine`，可能带 `_1` / `_2` 艺术版本后缀）
 * @returns {{ charId: string, skinId: string }|null} `charId` 是**命中的那个键**（清单按它分组）
 */
function pickFrom(table, id) {
  if (!isObj(table)) return null;
  for (const key of [id, baseCharId(id)]) {
    if (!str(key)) continue;
    const entry = table[key];
    const skinId = isObj(entry) ? str(entry.skinId) : str(entry);
    if (skinId) return { charId: key, skinId };
  }
  return null;
}

// ---- 清单（assets.skins） ------------------------------------------------------------------------------------

/** `manifest.skins` 那张表 → Map(`<charId>|<skinId>` → 条目)：清单换一份（装/卸包）就是一个新表对象。 */
const skinIndex = new WeakMap();

/**
 * 清单里这一套时装的**原始记录**（`mergeWorkshopSkins` 的落点：`{ pack, id, name, series?, desc?, art?, voices? }`），或 null。
 * @param {any} manifest `assets.manifest`（带工坊内容视图的那一份；`skins` 与外观叠层无关）
 * @param {string} charId @param {string} skinId
 */
export function skinRecord(manifest, charId, skinId) {
  const c = str(charId), s = str(skinId);
  if (!c || !s || !isObj(manifest) || !isObj(manifest.skins)) return null;
  const table = manifest.skins;
  let index = skinIndex.get(table);
  if (!index) { index = new Map(); skinIndex.set(table, index); }
  const key = `${c}|${s}`;
  if (!index.has(key)) {
    const list = Array.isArray(table[c]) ? table[c] : [];
    index.set(key, list.find((row) => isObj(row) && row.id === s) || null);
  }
  return index.get(key);
}

// ---- 现在穿哪套 ----------------------------------------------------------------------------------------------

/** `${charId}|${skinId}` → 解析结果（清单换一份就整层作废，所以 WeakMap 挂在清单对象上）。 */
const outfitIndex = new WeakMap();

/**
 * 这个单位现在该穿哪套时装的模型。
 *
 * @param {{ side?: string, ownerId?: string|null, spine?: string|null, defId?: string|null }} info
 *   单位的 info（render/app/info.js `renderInfo` 的形状）；`side: 'enemy'` 一律不换装
 * @param {{ manifest?: any, room?: any, me?: string|null, entries?: any }} [world]
 *   **全部可注入**（测试与独立通道用）：`manifest`（默认 null ⇒ 不换装，调用方给 `ctx.assets.manifest`）、
 *   `room`（默认 `store.get().room`）、`me`（默认 `store.get().me.playerId`）、`entries`（默认读 `sp.pref.skins`）
 * @returns {{ charId: string, skinId: string, sides: { front?: object, back?: object } }|null}
 */
export function outfitOf(info, world = {}) {
  if (!isObj(info) || info.side === 'enemy') return null;
  const id = str(info.spine) || str(info.defId);
  if (!id) return null;
  // 设置里的「工坊外观」：与头像/立绘那条解析链**同一个开关**（关掉 ⇒ 头像与小人一起回到原版）
  if (!appearanceFirstEnabled()) return null;
  const manifest = world.manifest === undefined ? null : world.manifest;
  if (!isObj(manifest) || !isObj(manifest.skins)) return null;
  const room = world.room === undefined ? store.get().room || null : world.room;
  const me = world.me === undefined ? str(store.get().me?.playerId) : str(world.me);
  // 自己的单位：本机的选择优先（点一下立刻生效），房间那一份兜底（另一个标签页里换的、本机偏好被清了）
  const mine = info.ownerId == null || (me != null && info.ownerId === me);
  const chosen = (mine ? pickFrom(world.entries === undefined ? loadPref(SKINS_PREF, null) : world.entries, id) : null)
    || pickFrom(picksOf(room, info.ownerId), id);
  if (!chosen) return null;
  const skin = skinRecord(manifest, chosen.charId, chosen.skinId);
  const sides = spineSides(isObj(skin) ? skin.art : null);
  if (!sides) return null;
  let index = outfitIndex.get(manifest);
  if (!index) { index = new Map(); outfitIndex.set(manifest, index); }
  const key = `${chosen.charId}|${chosen.skinId}`;
  let outfit = index.get(key);
  if (!outfit) { outfit = Object.freeze({ charId: chosen.charId, skinId: chosen.skinId, sides }); index.set(key, outfit); }
  return outfit;
}

// ---- 外观帧的代数 --------------------------------------------------------------------------------------------

let lastRoom;        // 上一次看的那一帧（room 对象身份）
let lastKey = '';    // 那一帧里座位外观的签名
let gen = 0;

/** 座位外观的签名（只认 picks：头像那一条不影响模型，不必让整个棋盘重解析）。 */
function picksKey(room) {
  const seats = isObj(room) && Array.isArray(room.seats) ? room.seats : [];
  const parts = [];
  for (const seat of seats) {
    if (!isObj(seat) || !str(seat.playerId)) continue;
    const picks = isObj(seat.appearance) && isObj(seat.appearance.picks) ? seat.appearance.picks : null;
    if (!picks) continue;
    const ids = Object.keys(picks).sort();
    if (!ids.length) continue;
    parts.push(`${seat.playerId}:${ids.map((c) => `${c}=${str(isObj(picks[c]) ? picks[c].skinId : picks[c]) || ''}`).join(',')}`);
  }
  return parts.join('|');
}

/**
 * 外观的**代数**：`room.state` 里座位的外观真的变了才 +1（换一帧同样的外观不算）。
 *
 * 干什么用的：`room.appearance` 的落点是 `room.state` 的广播，而 `render/app.js` 只在「清单变化」与「标签页回到
 * 前台」时让视图重解析（`UnitView.retryAssets`）—— 外观帧不经过那两个口。视图每帧读一个整数（`store.get().room`
 * 的身份比较），落后于它就自己走一次 `retryAssets`，于是**别人**在你面前换装、你在对局中换装都能立刻换上模型。
 * @returns {number}
 */
export function appearanceGen() {
  const room = store.get().room || null;
  if (room === lastRoom) return gen;
  lastRoom = room;
  const key = picksKey(room);
  if (key !== lastKey) { lastKey = key; gen++; }
  return gen;
}

/** 清掉本模块的记忆（测试用；应用里没有第二条写入面）。 */
export function resetSkinSpine() {
  lastRoom = undefined;
  lastKey = '';
  gen = 0;
}
