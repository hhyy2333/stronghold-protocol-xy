// shared/battleBounds.js — 战斗结果的**上界**里那几个「内容自己有、但记录里没有」的数字。
//
// 为什么单独一个文件：这类上界有两端必须**同一个数** —— 一端是战斗里的行为（真的发出多少层盟约 / 多少金币），
// 另一端是校验器（server/match/fields.js `specBounds` 允许多少）。两端读不同的常量，就会漂成两种事故：
// 宽了放行伪造，窄了把**诚实的**战报判成伪造、整场退回服务端复算（玩家侧观感 = 战场不对 / 没有敌人 / 卡住）。
// 所以数字只写在这里一份，行为与校验器都 import 它 —— 与 `shared/hextech.js` 的 `verbSpawnMods` 同一条理由
// （预览 / 实战 / 校验同源）。
//
// 只放**记录里读不到**的数字。能读到的都留在原处、由 `specBounds` 直接读：
//   * 刷怪的悬赏 —— `spec.spawns[].bounty.coins`；
//   * 协议源石卡的每场付钱上限 —— 卡面 `<slot>.goldCap`（data/hextech.json，`tools/hextech/roster.mjs` 是源）；
//   * 克制型特质的加层次数上限 —— `max_add_count_per_battle`（data/garrisons.json，`layerAllowanceOf` 读）。
// 一张**新**的、在战斗里付钱或加层的内容，请按上面三种之一把数字写进它自己的记录；只有「记录里本来就没有这一
// 格、数值只存在于代码里」的装备才放进本文件。

/**
 * 装备（data/items.json）本身就能给某个盟约加层的那几件，以及它自己的触发节奏。
 *
 * 每条是：`bond` 被加层的盟约；`every` 秒一次触发（每名干员各挂自己的时钟 —— 战斗里是
 * `src.mem.heartsteelAt`，见 server/sim/content/items/protocol.js）；`layers` 每次触发加几层。
 * 校验器按「每分钟能触发几次 × 每次几层 × 场上有几名该盟约成员」折算一场的上界；行为侧读同一份数当作
 * 记录 `params` 缺省值，于是两端不可能对不上。
 *
 * 关键：`data/items.json` 的 `chess_item_9_96_e_a` **params 是空的**，数值只写在卡面文字里
 * （`tools/build-data.mjs` 的 CUSTOM_ITEMS 没给这一格），所以这里的数就是唯一一份。
 */
export const ITEM_LAYER_SOURCES = Object.freeze({
  /** 心之钢： 「【坚守】盟约干员每隔 3 秒的攻击附带…增加自身最大生命值 150 点、【坚守】层数 2 层」。 */
  chess_item_9_96_e: Object.freeze({ bond: 'steadShip', every: 3, layers: 2 }),
});

/**
 * 协议源石**卡**在战斗里给某个盟约加层的那几张，以及它的数字在自己的记录里叫什么。
 *
 * `data/hextech.json` 的卡面记录（源：`tools/hextech/roster.mjs`）只写数字、不写「这层算谁的盟约」，所以这里补上
 * `bond` 与数字所在的槽名；数字本身仍然从记录里读（**不复制**），改数值只动 roster 一处。
 *
 * 每条的 `match` 是「一次收益给几层」那些字段名；一场最多触发几次由校验器按击杀数的上界 `maxTotal` 折算
 * （见 server/match/fields.js `cardLayerAllowance`）。
 */
export const CARD_LAYER_SOURCES = Object.freeze({
  /** 冰雪消融：「【谢拉格】干员攻击寒冷/冻结敌人时，解除其寒冷/冻结，获得 1 层谢拉格」（每次命中一次收益）。 */
  hex_kjerag_thaw: Object.freeze({ bond: 'kjeragShip', slot: 'kjeragThaw', match: /^layers$/ }),
  /** 困毙之雪：「被该真伤杀死的敌人使【谢拉格】层数 +1」（3 名档）／ 「+2」（6 名档），一次击杀只会走其中一条。 */
  hex_kjerag_frostdeath: Object.freeze({ bond: 'kjeragShip', slot: 'kjeragFrostDeath', match: /Layers$/ }),
});

/**
 * 一个装备 id（可能是 `_a` / `_b` 变体）对应的加层记录，没有则 null。
 * @param {string} id @returns {{bond: string, every: number, layers: number} | null}
 */
export function itemLayerSource(id) {
  const key = String(id ?? '').replace(/_[ab]$/, '');
  return ITEM_LAYER_SOURCES[key] || null;
}
