// tools/extra-operators.mjs — 把「官方表里还没有、但玩家手里已经有」的干员行注入 build-data 的上下文
//
// 背景：协议源石版的三个自选干员（塔露拉 char_4247_oxi / 冻河 char_4244_tocka / 国度 char_4246_dminon）
// 出自《明日方舟》客户端 v79，而本树 .cache/gamedata 的官方表停在 char_4237_jcinta。
//
// 为什么不整包升级 dump：那会连带改掉所有干员/棋子/盟约数据（golden 与一堆测试计数全变、商店与平衡口径一起动）。
// 这里只把这三人的**官方行逐字节照抄**进内存表，其余数据一个字节不动：
//   * character_table[charId]  —— 面板/范围/特性/天赋（含潜能档）/潜能/技能列表/prefab 里的召唤物；
//   * skill_table[skillId]     —— 三个技能各 10 级的黑板、SP、范围、技能类型；
//   * range_table[rangeId]     —— 它们用到的范围行；
//   * uniequip_table.subProfDict —— 分支名（本地表已有就不动）。
// 生成逻辑一行不改：buildBackups 照它平时读官方表的路径读，于是这三人自动进 data/backups.json 的
// units / diy.ownedPool / diy.operators（业主 2026-11-01 口径）。
//
// 不注入 charEquip / battle_equip_table：三人在 v79 没有模组（业主 2026-11-01：不加模组）。
// 数据来源与刷新方法见 tools/extra-operators-fetch.mjs（结果提交在 tools/extra-operators.json）。
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const FILE = join(ROOT, 'tools', 'extra-operators.json');

/** @returns {{operators:object, skills:object, ranges:object, subProfessions:object}} */
export const EXTRA = JSON.parse(readFileSync(FILE, 'utf8'));

export const EXTRA_OPERATOR_IDS = Object.freeze(Object.keys(EXTRA.operators).sort());

/**
 * Merge the extra operators into the in-memory official tables (ctx from tools/build-data.mjs loadContext).
 * Mutates ctx; returns the ids actually added (already present in the dump ⇒ skipped, the dump wins).
 * @param {object} ctx
 */
export function applyExtraOperators(ctx) {
  const added = [];
  for (const [id, row] of Object.entries(EXTRA.operators)) {
    if (ctx.charTable[id]) continue;
    ctx.charTable[id] = row;
    for (const s of row.skills || []) {
      const skill = EXTRA.skills[s.skillId];
      if (skill && !ctx.skillTable[s.skillId]) ctx.skillTable[s.skillId] = skill;
    }
    const sub = ctx.uniequip.subProfDict?.[row.subProfessionId] || EXTRA.subProfessions[row.subProfessionId];
    if (sub && ctx.uniequip.subProfDict && !ctx.uniequip.subProfDict[row.subProfessionId]) {
      ctx.uniequip.subProfDict[row.subProfessionId] = sub;
    }
    added.push(id);
  }
  for (const [id, row] of Object.entries(EXTRA.ranges)) if (!ctx.rangeTable[id]) ctx.rangeTable[id] = row;
  return added;
}
