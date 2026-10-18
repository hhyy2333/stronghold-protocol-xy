// shared/protocolLevels.js — 协议等级 1–18：叠加在「终极模拟」（ABYSS）之上的一条**数值难度轴**（业主 2026-10-18）。
//
// 为什么不做成第 5 个模式：那 4 个「难度」其实是四份不同的官方数据（回合表 / 敌池 / 盟约集合 / 首领回合），
// 各做 18 份 = 72 套数据，无法维护。这里只做**一层乘数**，折进引擎已有的地方（敌方 mods / 首领池 / 收入 / 漏怪），
// 于是：**等级 0（默认）= 引擎一个字节都不动**，golden 不移动。
//
// 口径（业主的决定）：
//   * 只有最高难度（`difficulty === 'ABYSS'`）能开 1–18；其它难度上一律按 0（关闭）处理；
//   * 1–18 同一条曲线，全部由 `node tools/balance.mjs --difficulty ABYSS --level N` 量过一轮
//     （docs/BALANCE.md「协议等级」）：13–18 的「额外敌方源石 / 首领池 / 数量」按级**不回头**——任何一轴在同一级
//     上都不会比上一级轻，于是曲线没有暗坑（12 级原先的 countAdd、16 级后的 extra 空档都已在 2026-10-18 这一轮修掉）；
//   * 匹配严格同级（server/matchmaking.js），战绩按等级分开记（server/matchRecords.js）。
//
// 每一级只动 1–2 个玩家能感知的量，乘法曲线（不是加法），每 3 级一个拐点：
//   1–6   稳定区：只有敌方生命/攻击；
//   7–12  危险区：加防御/法抗、漏怪、每波数量、收入；
//   13–18 深潜区：首领池、额外敌方协议源石。
//
// 读点（都从这里取，别在引擎里写第二份）：
//   server/match/gamedata.js   income / bossPoolHp
//   server/match/hextech.js    matchEnemyMods（敌方 mods 折入，预览=实战同一份）
//   server/match/match/settle.js 漏怪损失
//   server/match/Match.js      所有者：protocolLevel

/** 最高等级。0 = 关闭。 */
export const PROTOCOL_LEVEL_MAX = 18;

/**
 * 收入惩罚**豁免的前几个回合**（业主 2026-10-18：「n18 经济惩罚太重」，随后定为「从第 8 回合开始减少钱」）。
 *
 * 收入惩罚是绝对减（`incomeDelta: -3` 就是每回合少 3 金）。**前 7 个回合不罚，第 8 回合起才罚**：
 *   * 开局三回合（4 / 5 / 6 金）是自走棋最脆弱的地方 —— Lv18 的 −3 曾把第 1 回合砍到 1 金（最便宜的
 *     棋子 2 金），那不是「更难」，是开局就什么都做不了；
 *   * 而经济惩罚真正该起作用的位置是**中后期**：那时构筑与利息已经起来，少几金是压力而不是死刑。
 *
 * 于是高等级的强度拆成两段：前 7 回合由敌方数值 / 首领池 / 额外敌方源石承担，第 8 回合起再加入经济压力。
 * `income(round)` 只在 `round > PROTOCOL_LEVEL_INCOME_FREE_ROUNDS` 时折 `incomeDelta`；表里的数值不为此改动。
 */
export const PROTOCOL_LEVEL_INCOME_FREE_ROUNDS = 7;

/** 每一级的数值。`hpMul/atkMul/defMul/resMul` 是**乘数**，`countAdd` 是每波额外敌人数（加法），其余是绝对增减。 */
export const PROTOCOL_LEVELS = Object.freeze([
  { level: 1, tier: 'steady', label: 'I', enemy: { hpMul: 1.05, atkMul: 1.03 } },
  { level: 2, tier: 'steady', label: 'II', enemy: { hpMul: 1.10, atkMul: 1.06 } },
  { level: 3, tier: 'steady', label: 'III', enemy: { hpMul: 1.15, atkMul: 1.09 } },
  { level: 4, tier: 'steady', label: 'IV', enemy: { hpMul: 1.20, atkMul: 1.12 } },
  { level: 5, tier: 'steady', label: 'V', enemy: { hpMul: 1.26, atkMul: 1.16 } },
  { level: 6, tier: 'steady', label: 'VI', milestone: true, enemy: { hpMul: 1.33, atkMul: 1.20 } },
  { level: 7, tier: 'danger', label: 'VII', enemy: { hpMul: 1.40, atkMul: 1.25, defMul: 1.05, resMul: 1.03 } },
  { level: 8, tier: 'danger', label: 'VIII', enemy: { hpMul: 1.48, atkMul: 1.30, defMul: 1.08, resMul: 1.05 } },
  { level: 9, tier: 'danger', label: 'IX', leakLp: 1, enemy: { hpMul: 1.56, atkMul: 1.35, defMul: 1.10, resMul: 1.07 } },
  { level: 10, tier: 'danger', label: 'X', incomeDelta: -1, enemy: { hpMul: 1.65, atkMul: 1.40, defMul: 1.12, resMul: 1.09 } },
  { level: 11, tier: 'danger', label: 'XI', enemy: { hpMul: 1.74, atkMul: 1.45, defMul: 1.14, resMul: 1.11 } },
  { level: 12, tier: 'danger', label: 'XII', milestone: true, incomeDelta: -1, enemy: { hpMul: 1.83, atkMul: 1.50, defMul: 1.16, resMul: 1.13 } },
  { level: 13, tier: 'deep', label: 'XIII', incomeDelta: -1, bossPoolMul: 1.10, extraEnemyHexes: 1, enemy: { hpMul: 1.92, atkMul: 1.56, defMul: 1.17, resMul: 1.14 } },
  { level: 14, tier: 'deep', label: 'XIV', incomeDelta: -2, bossPoolMul: 1.10, extraEnemyHexes: 1, enemy: { hpMul: 2.02, atkMul: 1.62, defMul: 1.18, resMul: 1.15 } },
  { level: 15, tier: 'deep', label: 'XV', incomeDelta: -2, bossPoolMul: 1.20, extraEnemyHexes: 1, enemy: { hpMul: 2.12, atkMul: 1.68, defMul: 1.19, resMul: 1.16 } },
  { level: 16, tier: 'deep', label: 'XVI', incomeDelta: -2, bossPoolMul: 1.20, extraEnemyHexes: 2, enemy: { hpMul: 2.23, atkMul: 1.74, defMul: 1.20, resMul: 1.17 } },
  { level: 17, tier: 'deep', label: 'XVII', incomeDelta: -3, bossPoolMul: 1.30, extraEnemyHexes: 2, enemy: { hpMul: 2.34, atkMul: 1.80, defMul: 1.21, resMul: 1.18 } },
  { level: 18, tier: 'deep', label: 'XVIII', milestone: true, incomeDelta: -3, bossPoolMul: 1.50, extraEnemyHexes: 3, leakLp: 2, enemy: { hpMul: 2.45, atkMul: 1.88, defMul: 1.22, resMul: 1.19, countAdd: 1 } },
]);

/** 等级是否是合法整数（0..18）。 */
export function isProtocolLevel(level) {
  return Number.isInteger(level) && level >= 0 && level <= PROTOCOL_LEVEL_MAX;
}

/** 只有「终极模拟」才允许开等级；其它难度上等级一律按 0 处理（业主口径）。 */
export function protocolLevelActive(level, difficulty) {
  return difficulty === 'ABYSS' && isProtocolLevel(level) && level >= 1;
}

/** 这一级的行（0 / 非法整数 ⇒ null）。 */
export function protocolLevelRow(level) {
  if (!Number.isInteger(level) || level < 1 || level > PROTOCOL_LEVEL_MAX) return null;
  return PROTOCOL_LEVELS[level - 1] || null;
}

/**
 * 这一局的等级效果；关闭（0 / 非终极难度 / 非法值）⇒ null（引擎逐字节不变）。
 * @param {number} level @param {string} [difficulty]
 * @returns {{ level: number, enemy: Record<string, number>, bossPoolMul: number, incomeDelta: number, leakLp: number, extraEnemyHexes: number }|null}
 */
export function protocolLevelMods(level, difficulty = 'ABYSS') {
  if (!protocolLevelActive(level, difficulty)) return null;
  const row = protocolLevelRow(level);
  if (!row) return null;
  return {
    level: row.level,
    enemy: { ...(row.enemy || {}) },
    bossPoolMul: Number.isFinite(row.bossPoolMul) && row.bossPoolMul > 0 ? row.bossPoolMul : 1,
    incomeDelta: Number.isFinite(row.incomeDelta) ? Math.trunc(row.incomeDelta) : 0,
    leakLp: Number.isFinite(row.leakLp) ? Math.max(0, Math.trunc(row.leakLp)) : 0,
    extraEnemyHexes: Number.isFinite(row.extraEnemyHexes) ? Math.max(0, Math.trunc(row.extraEnemyHexes)) : 0,
  };
}

/** 只取敌方 mods 那半（喂给 shared/hextech.js 的 sumEnemyMods，形如 `{ mods }` 的记录）。 */
export function protocolLevelEnemyMods(level, difficulty = 'ABYSS') {
  const mods = protocolLevelMods(level, difficulty);
  return mods ? { mods: { ...mods.enemy } } : null;
}
