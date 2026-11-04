// ui/gameLogic/modeModules.js — 协议源石【特限恢复】`hex_mode_modules` 的唯一判据（客户端）.
//
// 效果：拥有这张卡的玩家，其**自己的**干员用 3 级模组数据（data/moduleLevels.json，shared/loadoutRecord.js
// withModuleLevel3）。服务端那一半在 server/match/player/round.js battleInput 与 server/sim/simdata.js getChess
// （`loadout.moduleLevel === 3`）；客户端原先只有局内详情卡传了 `moduleLevel` / `moduleLevels`，商店卡徽标、
// 详情卡画到棋盘上的攻击范围、落位轮盘仍然按 1 级算 —— 三处口径不一致。
//
// 判据**只有一份**：m.private 的 effects 列表是客户端唯一的所有权来源（server/match/hextech.js addHexRef：
// `{ iconKind: 'hex', id: 'hex:<cardId>'[#<copySeq>] }`，server/match/player/views.js 把 `iconId` 补成 ref id）。
// 这个文件被 placement.js（`ownsModeModules`）与各调用点共用：standIn.js 不能反向 import placement.js
// （placement.js 要 import standIn.js 的 deployedRecord，会成环），所以判据落在两者之上。
//
// 补位干员（standIn.js `deployedRecord` 的 stand-in 分支）与队友的干员（另一名玩家的数据）都不带 —— 调用点传
// `moduleLevel: null` 即可，不传时行为逐字段与改动前一致。
import { MODE_MODULES_HEX_ID } from '../../../../shared/goalPoint.js';
import { isObj } from './shared.js';

/**
 * 3 级模组的档位，或 null：拥有【特限恢复】`hex_mode_modules` 时为 3（数据只生成 equipLevel 3），否则 null。
 * @param {any} priv m.private（`effects` 是唯一的所有权来源）
 * @returns {3|null}
 */
export function modeModuleLevel(priv) {
  for (const e of Array.isArray(priv?.effects) ? priv.effects : []) {
    if (!isObj(e) || e.iconKind !== 'hex') continue;
    const id = String(e.iconId || e.id || '').replace(/^hex:/, '').split('#')[0];
    if (id === MODE_MODULES_HEX_ID) return 3;
  }
  return null;
}

/**
 * The player owns 【特限恢复】`hex_mode_modules`?（placement.js 的目标点规则与 3 级模组读同一个判据）
 * @param {any} priv m.private
 */
export function ownsModeModules(priv) {
  return modeModuleLevel(priv) === 3;
}
