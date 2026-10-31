// shared/goalPoint.js — 保护目标点（stage 图例 tile_end）与号角特限模组「可以部署在目标点」。
//
// 官方 号角 特限模组「号角特限证章」(ISW-A) 的特性追加行：「在集成战略中，可以部署在目标点且可以攻击隐匿敌人」。
// 卫戍协议里的「目标点」= **保护目标点**（stage 图例 `tile_end`，敌人路径的终点、漏怪扣 LP 的那一格）。平时它
// buildable NONE，任何干员都不能站（server/match/board.js buildDeployMap 只认 ALL / MELEE / RANGED）。
//
// 协议源石【特限恢复】`hex_mode_modules` 生效时，号角（char_4039_horn）装备 **ISW- 特限模组** 就可以站上去 ——
// 服务端（server/match/player/placement.js `_legal`）、客户端（public/js/ui/gameLogic/placement.js `tileAllows`）
// 与测试读的都是这一份规则，两边不会漂。
//
// [ASSUMED]（设计稿 04-文档/协议源石-号角特限模组-设计稿-20261031.md §3-5）：
//   1. 只有号角本人：charId 必须是 char_4039_horn（补位形态是别的角色记录 ⇒ 不适用；自选编队选了号角则适用）；
//   2. 必须拥有【特限恢复】，且当前模组 `active` 且 type 以 ISW 开头（普通形态没有模组 ⇒ 不适用）；
//   3. 目标点**不是阻挡地形**（grid.blockable false）：她站在那里不挡路，敌人照常走进去漏掉 —— 模组给的是
//      「可以部署」这一个位置，不是「可以在目标点拦截」；
//   4. 一张图可能有多个 tile_end（不同部署场），一律按部署场映射后的棋盘坐标算。
import { GEO } from './constants.js';
import { fieldTileOf, layoutOf } from './layout.js';

/** 号角的角色 id（本作 5 阶重装·要塞，棋子 chess_char_5_08_a / _b）。 */
export const GOAL_POINT_CHAR_ID = 'char_4039_horn';
/** 【特限恢复】的卡 id（协议源石，2 阶 / gold）。 */
export const MODE_MODULES_HEX_ID = 'hex_mode_modules';
/** 特限模组的类型前缀（ISW = 集成战略）。 */
export const GOAL_POINT_MODULE_PREFIX = 'ISW';

const key = (r, c) => `${r},${c}`;

/**
 * 保护目标点的棋盘坐标（'r,c'），按部署场映射：`stage` 里图例 `tileKey === 'tile_end'` 的格子。
 * @param {any} stage data/stages.json record（没有 rows / tiles 时返回空集）
 * @param {'normal'|'bossL'|'bossR'} [field] 部署场（board.js DEPLOY_FIELDS）
 * @param {any} [layout] shared/layout.js 的布局（缺省 layoutOf(stage)）
 * @returns {Set<string>} 棋盘坐标 'r,c'（rows 9–12, cols 2–10）
 */
export function goalPointKeys(stage, field = 'normal', layout = null) {
  const out = new Set();
  const rows = stage && Array.isArray(stage.rows) ? stage.rows : null;
  const tiles = stage && stage.tiles && typeof stage.tiles === 'object' ? stage.tiles : null;
  if (!rows || !tiles) return out;
  const L = layout || layoutOf(stage);
  for (let r = GEO.FIELD.r0; r <= GEO.FIELD.r1; r++) {
    for (let c = GEO.FIELD.c0; c <= GEO.FIELD.c1; c++) {
      const [sr, sc] = fieldTileOf(L, field, r, c);
      const line = typeof rows[sr] === 'string' ? rows[sr] : '';
      const t = tiles[line[sc]];
      if (t && t.tileKey === 'tile_end') out.add(key(r, c));
    }
  }
  return out;
}

/**
 * 这条（已经过 loadout 组合的）干员记录能不能站上保护目标点：号角 + 启用中的 ISW- 特限模组 + 拥有【特限恢复】。
 * @param {{ record: any, module?: any, ownsModeModules: boolean }} o `record` = loadoutRecord(chess, resolveRecordLoadout(...))
 *   （或数据里那条默认记录）；`module` = 覆盖用的模组对象（普通形态没有模组列表，玩家在干员调配里选的那个由
 *   shared/loadoutRecord.js `selectedModuleOf` 给出）；`ownsModeModules` = 玩家是否拥有 hex_mode_modules
 * @returns {boolean}
 */
export function canStandOnGoalPoint({ record, module = null, ownsModeModules }) {
  if (!ownsModeModules || !record || typeof record !== 'object') return false;
  if (record.charId !== GOAL_POINT_CHAR_ID) return false;
  const m = module || record.module;
  if (!m || m.active !== true) return false;
  return typeof m.type === 'string' && m.type.toUpperCase().startsWith(GOAL_POINT_MODULE_PREFIX);
}
