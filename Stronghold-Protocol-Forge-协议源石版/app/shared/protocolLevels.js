// shared/protocolLevels.js — 协议等级 1–19：叠加在「终极模拟」（ABYSS）之上的一条**数值难度轴**（业主 2026-10-18；
// 19 级是业主 2026-10-29「把这个负面做成 n19」）。
//
// 为什么不做成第 5 个模式：那 4 个「难度」其实是四份不同的官方数据（回合表 / 敌池 / 盟约集合 / 首领回合），
// 各做 19 份 = 76 套数据，无法维护。这里只做**一层乘数**，折进引擎已有的地方（敌方 mods / 首领池 / 收入 / 漏怪 /
// 一回合获得资金的额度），于是：**等级 0（默认）= 引擎一个字节都不动**，golden 不移动。
//
// 口径（业主的决定）：
//   * 只有最高难度（`difficulty === 'ABYSS'`）能开 1–19；其它难度上一律按 0（关闭）处理；
//   * 1–18 同一条曲线，全部由 `node tools/balance.mjs --difficulty ABYSS --level N` 量过一轮
//     （docs/BALANCE.md「协议等级」）：13–18 的「额外敌方源石 / 首领池 / 数量」按级**不回头**——任何一轴在同一级
//     上都不会比上一级轻，于是曲线没有暗坑（12 级原先的 countAdd、16 级后的 extra 空档都已在 2026-10-18 这一轮修掉）；
//     **19 级的敌方数值是 `[ASSUMED]`**：业主 2026-10-29 只点名了它的负面（`fundsGainCap`），数值沿用同一条曲线往上
//     推一格，还没量过；
//   * 匹配严格同级（server/matchmaking.js），战绩按等级分开记（server/matchRecords.js）。
//
// 每一级只动 1–2 个玩家能感知的量，乘法曲线（不是加法），每 3 级一个拐点：
//   1–6   稳定区：只有敌方生命/攻击；
//   7–12  危险区：加防御/法抗、漏怪、每波数量、收入；
//   13–18 深潜区：首领池、额外敌方协议源石（第 1 / 3 / 5 回合分散发，见 PROTOCOL_LEVEL_EXTRA_HEX_ROUNDS）；
//   19    深潜区顶端：数值再抬一格，**并且是唯一带「一回合获得资金上限」的等级**（行里的 `fundsGainCap`）。
//
// 另外，**局内还有一条回合爬升**（业主 2026-10-24「削弱敌方前期加强后期」→「k = 1 落在第 6 回合」）：同一级的乘区
// 在 R1–R5 打折、R6 起满额、R11 起加码，**R13 / R14 / R15 三回合再各抬一档**（业主 2026-10-31「增加 n1-n19，13，14，15
// 回合的敌人加成」）。表值本身不为它改动；首领轮的血池走表里的 `bossPoolMul`，那一列同期一起抬过。
//
// 读点（都从这里取，别在引擎里写第二份）：
//   server/match/gamedata.js   income / bossPoolHp / fundsGainCapPerRound
//   server/match/hextech.js    matchEnemyMods（敌方 mods 折入，预览=实战同一份）
//   server/match/match/settle.js 漏怪损失
//   server/match/match/hexDraft.js 额外敌方协议源石的发放（applyProtocolLevelEnemyHexes）
//   server/match/Match.js      所有者：protocolLevel

/** 最高等级。0 = 关闭。 */
export const PROTOCOL_LEVEL_MAX = 19;

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

/**
 * **额外敌方协议源石的发放回合**（业主 2026-10-22：「额外协议源石分散给，在1，3，5回合给额外的」）。
 *
 * 第 i 张额外源石（0-based）在第 `PROTOCOL_LEVEL_EXTRA_HEX_ROUNDS[i]` 回合发：`extraEnemyHexes = 1` 的等级只在
 * R1 发，2 张的等级在 R1 / R3，3 张（N18）在 R1 / R3 / R5。此前这些卡在开局一次性发完（owner 2026-10-18），
 * N18 等于 R1 就拿到全部 3 张；分散后 R1–R5 的敌方强度逐回合加码，R5 之后与旧口径一致。
 *
 * 表里的 `extraEnemyHexes` 仍是**整局一共几张**，不为此改数值；发放由
 * `MatchHexDraft.applyProtocolLevelEnemyHexes()` 按本表逐回合执行。
 */
export const PROTOCOL_LEVEL_EXTRA_HEX_ROUNDS = Object.freeze([1, 3, 5]);

/**
 * 这一级在 `round` 这一回合应发几张额外敌方协议源石（等级关闭 / 不在发放回合 ⇒ 0）。
 *
 * 表里最多 3 张（正好对应 1 / 3 / 5）；若以后出现更多的等级，多出来的张数全部落在最后一个发放回合。
 * @param {number} level @param {number} round @param {string} [difficulty]
 * @returns {number}
 */
export function protocolLevelExtraHexesAt(level, round, difficulty = 'ABYSS') {
  const mods = protocolLevelMods(level, difficulty);
  if (!mods || !(mods.extraEnemyHexes > 0) || !Number.isInteger(round)) return 0;
  const idx = PROTOCOL_LEVEL_EXTRA_HEX_ROUNDS.indexOf(round);
  if (idx < 0) return 0;
  const extra = mods.extraEnemyHexes;
  if (extra <= PROTOCOL_LEVEL_EXTRA_HEX_ROUNDS.length) return idx < extra ? 1 : 0;
  // 表外余量（当前表走不到）：最后一个发放回合一次发完
  return idx === PROTOCOL_LEVEL_EXTRA_HEX_ROUNDS.length - 1 ? 1 + (extra - PROTOCOL_LEVEL_EXTRA_HEX_ROUNDS.length) : 1;
}

// =====================================================================================================================
// N18 第 10 回合的「彩蛋首领」（业主 2026-10-22：「n18难度增加第10回合会出现黑蛇或梅菲斯特」）
// =====================================================================================================================
//
// 形态（业主当场选的口径）：**普通回合里额外刷一只**，不是第二个首领回合 —— 所以它不碰最终攻势那一整套
// （不合并团队 LP、没有共享血池、没有 BOSS_HIT 播报、R14 照常还是最后一场首领关），只在 R10 的**每个人的
// 自己那场**战斗里多一只领袖：走本回合的某条地面路线、按数据里的血量出场、被打倒或漏掉都按普通敌人结算
// （`lpr` 照扣、破坏完美作战、联席的联防也照常把它带进去）。
//
// 生效范围：**只有 ABYSS 的 18 级**（`protocolLevelActive` 已经保证「非 ABYSS 一律 0」），且只有 R10。
// 所以 0–17 级的每一级、以及其它三个难度，逐字节仍然是原来的对局（golden 不动）。
//
// 为什么从 `seed` 里抽而不是用 `rngWaves`：`rngWaves` 是「本局每一轮出怪表」的随机流，在 R10 多抽一次就会
// 把 R11–R14 的出怪**整体换一份**（同一颗种子打出来的后半局与以前不同，已经不是这条规则的本意了）。
// 这里用种子自己的哈希，抽签与其它任何随机流互不干扰。

/** 彩蛋首领出现在第几回合。 */
export const PROTOCOL_LEVEL_EXTRA_BOSS_ROUND = 10;
/** 从第几级开始有这只彩蛋首领（含）。 */
export const PROTOCOL_LEVEL_EXTRA_BOSS_LEVEL = 18;
/**
 * 候选：手加的两只领袖 —— “不死的黑蛇”（`boss_11`）与梅菲斯特（`boss_12`）。
 * 顺序就是抽签的次序（`seed % 2`），改这个数组就是改抽签结果。
 */
export const PROTOCOL_LEVEL_EXTRA_BOSSES = Object.freeze(['enemy_1515_bsnake', 'enemy_1507_mephi']);

/**
 * R10 这一回合该额外刷哪一只彩蛋首领（`null` = 不刷）。
 *
 * 纯函数：同一 `seed` 必然同一只，不读时钟、不消耗任何随机流。
 * @param {number} level 协议等级（0 = 关闭）
 * @param {number} round 回合
 * @param {string} [difficulty]
 * @param {number} [seed] 对局种子（同一颗种子 ⇒ 同一只）
 * @returns {string|null} enemyKey
 */
export function protocolLevelExtraBossAt(level, round, difficulty = 'ABYSS', seed = 0) {
  if (!protocolLevelActive(level, difficulty)) return null;
  if (!(level >= PROTOCOL_LEVEL_EXTRA_BOSS_LEVEL)) return null;
  if (round !== PROTOCOL_LEVEL_EXTRA_BOSS_ROUND) return null;
  const n = PROTOCOL_LEVEL_EXTRA_BOSSES.length;
  if (!n) return null;
  const idx = (Number(seed) >>> 0) % n;
  return PROTOCOL_LEVEL_EXTRA_BOSSES[idx] || null;
}

// =====================================================================================================================
// 回合爬升（业主 2026-10-24：「调整 n1-18，计划是削弱敌方前期加强后期」，随后定「k = 1 落在第 6 回合」）
// =====================================================================================================================
//
// 为什么要有这一层：18 行表给的是一条**全程恒定**的乘区（N18 生命 2.45 / 攻击 1.88，从 R1 压到 R15），而玩家的成长
// 是斜的。实测（docs/BALANCE.md §8，`tools/balance.mjs --level 18`）：R3 击杀率只有 48 %、R5 漏怪均值 11.75 —— 前期
// 是一堵墙；R11 击杀率 114 %、首领轮四人 @150 s 只啃掉 14 % 池子 —— 后期是一张纸。所以这里不动 18 行表值，只在
// **折入时**按回合缩放「高于 1 的那一段」：
//
//     有效乘区 = 1 + (表值 - 1) × k(回合)
//
// * **k = 1 落在第 6 回合**（业主指定）：R1–R5 是削弱窗口，R6 起与今天的对局逐回合相同，R11 起反过来加码，
//   **R13 / R14 / R15 三回合再各抬一档**（业主 2026-10-30「增加 n1-n19，13，14，15 回合的敌人加成」）——
//   R13 1.20 → 1.35、R14–15 1.35 → 1.55，于是最后三个回合（最后一个普通回合 + 最终攻势 + 隐秘核心）最重。
// * 按**增量**缩放而不是把乘区压回 1，等级之间的差别在任何回合都保得住：同一回合上 N1 < N2 < … < N19。
// * 只作用于 `hpMul / atkMul / atkMulRanged / defMul / resMul`。`countAdd` 走另一条阶梯（protocolLevelCountAddAt）；
//   `bossPoolMul` 只在首领回合生效、本身就是后期杠杆，所以直接写在表里，**不吃 k**（否则与表值重复计算）——
//   业主这次要求「首领轮」也跟着更硬，那是**改表里那几格**（13–19 的 `bossPoolMul`），不是给它乘 k。
// * 回合非法（0 / 非整数）= 不在对局回合里 ⇒ k = 1，旧的平曲线（`matchEnemyMods` 在开局前就是这么被读的）。
export const PROTOCOL_LEVEL_ROUND_RAMP = Object.freeze([
  Object.freeze({ from: 1, k: 0.45 }),
  Object.freeze({ from: 3, k: 0.6 }),
  Object.freeze({ from: 5, k: 0.8 }),
  Object.freeze({ from: 6, k: 1 }),
  Object.freeze({ from: 11, k: 1.2 }),
  Object.freeze({ from: 13, k: 1.35 }),
  Object.freeze({ from: 14, k: 1.55 }),
]);

/**
 * 这条轴的最高档落在哪几个回合（业主 2026-10-30「增加 n1-n19，13，14，15 回合的敌人加成」）：
 * **R13 是最后一个普通回合、R14 最终攻势、R15 隐秘核心**，三回合的 k 一起抬（R13 1.35 / R14–15 1.55）。
 * 界面那份难度介绍拿它说「哪几个回合最重」，不要在文案里写死 13 / 15。
 */
export const PROTOCOL_LEVEL_SPIKE_ROUNDS = Object.freeze([13, 15]);

/** k 第一次等于 1 的回合 —— 削弱窗口是 `1 .. FULL_ROUND - 1`，从这一回合起与今天的对局完全相同。 */
export const PROTOCOL_LEVEL_FULL_ROUND = 6;

/** 从这一回合起反过来加码（k > 1）。 */
export const PROTOCOL_LEVEL_LATE_ROUND = 11;

/** 吃 k 的那几个乘区（`countAdd` 与 `bossPoolMul` 不在此列，各有各的处理）。 */
export const PROTOCOL_LEVEL_RAMPED_KEYS = Object.freeze(['hpMul', 'atkMul', 'atkMulRanged', 'defMul', 'resMul']);

/**
 * 这一回合的爬升系数 k（R1–R2 = 0.45 … R6–R10 = 1 … R11–R12 = 1.2 … R13 = 1.35 … R14+ = 1.55）。
 *
 * 纯函数、不改状态；`round` 缺失或非法（0 / 负数 / 非整数）⇒ **1**（不在对局回合里，按旧口径读整级强度）。
 * @param {number} round
 * @returns {number}
 */
export function protocolLevelRoundK(round) {
  if (!Number.isInteger(round) || round <= 0) return 1;
  let k = PROTOCOL_LEVEL_ROUND_RAMP[0].k;
  for (const step of PROTOCOL_LEVEL_ROUND_RAMP) if (round >= step.from) k = step.k;
  return k;
}

/**
 * 这一回合的「每波额外敌人」—— 表里的 `countAdd` 是**第 6 回合起**的值（业主同一条口径）：
 *
 *   R1–R5 ⇒ 0（前期不加怪）；R6–R10 ⇒ 表值；R11 起 ⇒ 表值 + 1。
 *
 * 只对有 `countAdd` 的等级有意义（当前只有 18 级），其余等级一律 0。
 * @param {number} level @param {number} round
 * @returns {number}
 */
export function protocolLevelCountAddAt(level, round) {
  const row = protocolLevelRow(level);
  const base = row && row.enemy && Number.isFinite(row.enemy.countAdd) ? Math.trunc(row.enemy.countAdd) : 0;
  if (!(base > 0)) return 0;
  if (!Number.isInteger(round) || round <= 0) return base;
  if (round < PROTOCOL_LEVEL_FULL_ROUND) return 0;
  return round >= PROTOCOL_LEVEL_LATE_ROUND ? base + 1 : base;
}

/**
 * 每一级的数值。`hpMul/atkMul/atkMulRanged/defMul/resMul` 是**乘数**，`countAdd` 是每波额外敌人数（加法），`leakLp` /
 * `incomeDelta` / `bossPoolMul` / `extraEnemyHexes` 是规则与绝对增减。
 *
 * `atkMulRanged`（业主 2026-10-30：「给 n1-n19 的远程怪攻击力曲线单独设置」）：**远程怪的攻击力另走一条曲线**，比通用
 * `atkMul` 缓 —— 1–6 级与通用逐值相同（稳定区不动），7 级起增量砍半左右，19 级 1.46 对通用的 1.94。判定口径业主当场
 * 定为**只算 `applyWay === 'RANGED'`**（92 个敌人；`ALL` 与 `MELEE` 仍吃通用那条）。折入见 `server/match/hextech.js`
 * 的 `applyEnemyHexes`：远程怪的 `atkMul` 换成这一格（乘上敌方协议源石给的那份倍率），生命 / 防御 / 法抗 / 速度不变，
 * **领袖（`tag === 'boss'`）不吃这一格** —— 首领轮的血与攻有自己的一整套（`bossPoolMul` + 共享血池）。
 *
 * `fundsGainCap`（业主 2026-10-29「把这个负面做成 n19」）：**一回合最多获得多少资金**，只有 19 级有这一格；没写的等级
 * = 不设上限（`GameData.fundsGainCapPerRound` 返回 0，引擎逐字节回到从前）。它不是乘区、也不吃回合爬升：卡在
 * `PlayerState.addFunds` 一处（全游戏的钱都从那个原语进），口径见 `docs/design/match.md`。
 */
export const PROTOCOL_LEVELS = Object.freeze([
  { level: 1, tier: 'steady', label: 'I', enemy: { hpMul: 1.05, atkMul: 1.03, atkMulRanged: 1.03 } },
  { level: 2, tier: 'steady', label: 'II', enemy: { hpMul: 1.10, atkMul: 1.06, atkMulRanged: 1.06 } },
  { level: 3, tier: 'steady', label: 'III', enemy: { hpMul: 1.15, atkMul: 1.09, atkMulRanged: 1.09 } },
  { level: 4, tier: 'steady', label: 'IV', enemy: { hpMul: 1.20, atkMul: 1.12, atkMulRanged: 1.12 } },
  { level: 5, tier: 'steady', label: 'V', enemy: { hpMul: 1.26, atkMul: 1.16, atkMulRanged: 1.16 } },
  { level: 6, tier: 'steady', label: 'VI', milestone: true, enemy: { hpMul: 1.33, atkMul: 1.20, atkMulRanged: 1.20 } },
  { level: 7, tier: 'danger', label: 'VII', enemy: { hpMul: 1.40, atkMul: 1.25, atkMulRanged: 1.22, defMul: 1.05, resMul: 1.03 } },
  { level: 8, tier: 'danger', label: 'VIII', enemy: { hpMul: 1.48, atkMul: 1.30, atkMulRanged: 1.24, defMul: 1.08, resMul: 1.05 } },
  { level: 9, tier: 'danger', label: 'IX', leakLp: 1, enemy: { hpMul: 1.56, atkMul: 1.35, atkMulRanged: 1.26, defMul: 1.10, resMul: 1.07 } },
  { level: 10, tier: 'danger', label: 'X', incomeDelta: -1, enemy: { hpMul: 1.65, atkMul: 1.40, atkMulRanged: 1.28, defMul: 1.12, resMul: 1.09 } },
  { level: 11, tier: 'danger', label: 'XI', enemy: { hpMul: 1.74, atkMul: 1.45, atkMulRanged: 1.30, defMul: 1.14, resMul: 1.11 } },
  { level: 12, tier: 'danger', label: 'XII', milestone: true, incomeDelta: -1, enemy: { hpMul: 1.83, atkMul: 1.50, atkMulRanged: 1.32, defMul: 1.16, resMul: 1.13 } },
  { level: 13, tier: 'deep', label: 'XIII', incomeDelta: -1, bossPoolMul: 1.35, extraEnemyHexes: 1, enemy: { hpMul: 1.92, atkMul: 1.56, atkMulRanged: 1.34, defMul: 1.17, resMul: 1.14 } },
  { level: 14, tier: 'deep', label: 'XIV', incomeDelta: -2, bossPoolMul: 1.35, extraEnemyHexes: 1, enemy: { hpMul: 2.02, atkMul: 1.62, atkMulRanged: 1.36, defMul: 1.18, resMul: 1.15 } },
  { level: 15, tier: 'deep', label: 'XV', incomeDelta: -2, bossPoolMul: 1.50, extraEnemyHexes: 1, enemy: { hpMul: 2.12, atkMul: 1.68, atkMulRanged: 1.38, defMul: 1.19, resMul: 1.16 } },
  { level: 16, tier: 'deep', label: 'XVI', incomeDelta: -2, bossPoolMul: 1.50, extraEnemyHexes: 2, enemy: { hpMul: 2.23, atkMul: 1.74, atkMulRanged: 1.40, defMul: 1.20, resMul: 1.17 } },
  { level: 17, tier: 'deep', label: 'XVII', incomeDelta: -3, bossPoolMul: 1.70, extraEnemyHexes: 2, enemy: { hpMul: 2.34, atkMul: 1.80, atkMulRanged: 1.42, defMul: 1.21, resMul: 1.18 } },
  { level: 18, tier: 'deep', label: 'XVIII', milestone: true, incomeDelta: -3, bossPoolMul: 2.00, extraEnemyHexes: 3, leakLp: 2, enemy: { hpMul: 2.45, atkMul: 1.88, atkMulRanged: 1.44, defMul: 1.22, resMul: 1.19, countAdd: 1 } },
  // 19 级（业主 2026-10-29「把这个负面做成 n19」）：数值沿 18 级的增量再抬一格（[ASSUMED]，未量），多出来的那一格是
  // 负面 `fundsGainCap` —— 一回合最多获得 30 资金，超出的作废。它是**唯一**带这一格的等级；0–18 级与其它难度照旧不限。
  { level: 19, tier: 'deep', label: 'XIX', incomeDelta: -3, bossPoolMul: 2.10, extraEnemyHexes: 3, leakLp: 2, fundsGainCap: 30, enemy: { hpMul: 2.56, atkMul: 1.94, atkMulRanged: 1.46, defMul: 1.23, resMul: 1.20, countAdd: 1 } },
]);

/** 等级是否是合法整数（0..19）。 */
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
 * @returns {{ level: number, enemy: Record<string, number>, bossPoolMul: number, incomeDelta: number, leakLp: number, extraEnemyHexes: number, fundsGainCap: number }|null}
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
    // 一回合获得资金的额度；0 = 不设上限（除 19 级以外每一级都是 0）
    fundsGainCap: Number.isFinite(row.fundsGainCap) ? Math.max(0, Math.trunc(row.fundsGainCap)) : 0,
  };
}

/**
 * 只取敌方 mods 那半（喂给 shared/hextech.js 的 sumEnemyMods，形如 `{ mods }` 的记录）。
 *
 * **按回合折一次爬升**（业主 2026-10-24）：`hpMul/atkMul/atkMulRanged/defMul/resMul` 走 `1 + (表值 - 1) × k(round)`；
 * `countAdd` 换成 `protocolLevelCountAddAt(level, round)`（R1–R5 = 0、R6–R10 = 表值、R11 起 +1）。
 * `round` 不传 / 不合法 ⇒ k = 1、countAdd = 表值，与 2026-10-24 之前的输出逐字节相同。
 *
 * 返回值里**只带本回合真正要用的键**（`countAdd: 0` 会保留，让折入端知道「前期不加怪」而不是回落到卡牌的加成）——
 * 注意 `sumEnemyMods` 是乘法：N18 前 5 回合的 0 也会把【虫群】那张卡的 `countAdd` 一起压成 0，这是刻意的
 * 「前期不靠怪量堆难度」。
 *
 * `atkMulRanged` **不进 `mods`**：它不是引擎认识的乘区键（引擎只有 `atkMul`），混进去会被当成未知键一路带着走。
 * 它单独作为 `rangedAtkMul` 返回，由 `server/match/hextech.js` 的 `matchEnemyMods` 换成「远程怪那一条曲线乘上卡牌
 * 那份 atkMul」再交给 `applyEnemyHexes` 按 spawn 分流。
 * @param {number} level @param {string} [difficulty] @param {number} [round]
 */
export function protocolLevelEnemyMods(level, difficulty = 'ABYSS', round = 0) {
  const mods = protocolLevelMods(level, difficulty);
  if (!mods) return null;
  const k = protocolLevelRoundK(round);
  const enemy = {};
  let rangedAtkMul = null;
  for (const [key, v] of Object.entries(mods.enemy)) {
    if (!Number.isFinite(v)) continue;
    const val = k !== 1 && PROTOCOL_LEVEL_RAMPED_KEYS.includes(key) ? roundTo4(1 + (v - 1) * k) : v;
    if (key === 'atkMulRanged') rangedAtkMul = val;
    else enemy[key] = val;
  }
  if (Number.isFinite(enemy.countAdd) && enemy.countAdd > 0) enemy.countAdd = protocolLevelCountAddAt(level, round);
  return { mods: enemy, rangedAtkMul };
}

/** 乘法乘区的四位小数口径（和表里的手写值同一个精度，避免 1.6524999 这类尾巴进日志/测试）。 */
function roundTo4(v) {
  return Math.round(v * 10000) / 10000;
}

// =====================================================================================================================
// 「这一级到底改了什么」—— 给人看的逐条说明（业主 2026-10-22：「有人不知道n18的效果，增加难度介绍」）
// =====================================================================================================================
//
// 为什么放在 shared 而不是写死在界面里：这些数字是**表里那几行**的另一面。写死一份文案，表一改文案就开始说谎
// （这个仓库里已经有过：等级表的注释写着「13–18 不再标 experimental」，而界面还在读一个没人写的字段）。
// 这里把每一行翻成一组 `{ msgid, params }`，界面只负责 `t()` 和排版；数字永远从表里现算。
//
// 返回的每一条都对应表里的**一个字段**，顺序是「先数值、再规则」：玩家先看伤害，再看机制。「不是数值」的两条
// （18 级起的 R10 彩蛋首领、19 级的一回合资金上限）也在这里，因为它们分别是 `PROTOCOL_LEVEL_EXTRA_BOSS_*` 与表的
// `fundsGainCap` 的另一面。

/** 深潜区门槛：从这里起才有首领池 / 额外敌方源石（表里第一个带 bossPoolMul 的等级）。 */
export const PROTOCOL_LEVEL_DEEP_FROM = 13;

/**
 * 一级的逐条效果（`[]` = 0 / 非法等级）。
 *
 * 每一条 = `{ id, msgid, params }`：`msgid` 是中文原文（i18n 的 key），`params` 是要代进 `{v}` / `{n}` 的值。
 * 数值一律来自 `PROTOCOL_LEVELS`，不在任何界面里写第二份。
 *
 * 返回的 `msgid` 是**运行时**拼出来的字符串，所以 tools/i18n.mjs 的字面量提取看不到它们 —— 那四张语言包里的
 * 词条是手工补的（`PROTOCOL_LEVEL_EFFECT_TEXT` 旁边有一份清单，`test/match/protocol-levels.test.js` 钉着
 * 「每一个 msgid 都在 en.json 里」）。
 * @param {number} level
 * @returns {Array<{ id: string, msgid: string, params: Record<string, string|number> }>}
 */
export function protocolLevelEffects(level) {
  const row = protocolLevelRow(level);
  if (!row) return [];
  const enemy = row.enemy && typeof row.enemy === 'object' ? row.enemy : {};
  const out = [];
  const pct = (v) => `${Math.round(((v - 1) * 100) * 10) / 10}%`;
  const times = (v) => `×${v.toFixed(2)}`;

  // ---- 回合爬升（业主 2026-10-24：「削弱敌方前期加强后期」，k = 1 落在第 6 回合） ----
  // 这一条排在最前面：下面那些乘区**不是全程生效的**，先让玩家知道「第 6 回合起才是这个数」。
  // 最后那几个回合再各抬一档（业主 2026-10-30「增加 n1-n19，13，14，15 回合的敌人加成」），所以这一句要说清楚
  // 「哪几个回合最重」—— 回合号从 `PROTOCOL_LEVEL_SPIKE_ROUNDS` 现取，不在文案里写死。
  out.push({
    id: 'ramp',
    msgid: '第 1–{end} 回合敌方数值低于本级标称值，第 {from} 回合起满额，第 {late} 回合起再加强，第 {spikeFrom}–{spikeTo} 回合最重',
    params: {
      end: PROTOCOL_LEVEL_FULL_ROUND - 1,
      from: PROTOCOL_LEVEL_FULL_ROUND,
      late: PROTOCOL_LEVEL_LATE_ROUND,
      spikeFrom: PROTOCOL_LEVEL_SPIKE_ROUNDS[0],
      spikeTo: PROTOCOL_LEVEL_SPIKE_ROUNDS[PROTOCOL_LEVEL_SPIKE_ROUNDS.length - 1],
    },
  });

  // ---- 数值（敌方全局乘区） ----
  if (Number.isFinite(enemy.hpMul) && enemy.hpMul > 1) {
    out.push({ id: 'hp', msgid: '敌方生命值 {v}', params: { v: times(enemy.hpMul) } });
  }
  if (Number.isFinite(enemy.atkMul) && enemy.atkMul > 1) {
    out.push({ id: 'atk', msgid: '敌方攻击力 {v}', params: { v: times(enemy.atkMul) } });
  }
  // 远程怪单走一条曲线（业主 2026-10-30）：只在它真的和通用那条不同时才列出来（1–6 级两条相同，写两遍是噪音）
  if (Number.isFinite(enemy.atkMulRanged) && enemy.atkMulRanged > 1 && enemy.atkMulRanged !== enemy.atkMul) {
    out.push({ id: 'atkRanged', msgid: '远程敌人攻击力 {v}（其余敌人按上面那条）', params: { v: times(enemy.atkMulRanged) } });
  }
  if (Number.isFinite(enemy.defMul) && enemy.defMul > 1) {
    out.push({ id: 'def', msgid: '敌方防御力 {v}', params: { v: times(enemy.defMul) } });
  }
  if (Number.isFinite(enemy.resMul) && enemy.resMul > 1) {
    out.push({ id: 'res', msgid: '敌方法术抗性 {v}', params: { v: times(enemy.resMul) } });
  }
  if (Number.isFinite(enemy.countAdd) && enemy.countAdd > 0) {
    out.push({
      id: 'count',
      msgid: '第 {from} 回合起每波敌人数量 +{n}，第 {late} 回合起 +{n2}',
      params: {
        from: PROTOCOL_LEVEL_FULL_ROUND,
        n: Math.trunc(enemy.countAdd),
        late: PROTOCOL_LEVEL_LATE_ROUND,
        n2: Math.trunc(enemy.countAdd) + 1,
      },
    });
  }

  // ---- 规则（漏怪 / 收入 / 首领池 / 额外源石） ----
  if (Number.isFinite(row.leakLp) && row.leakLp > 0) {
    out.push({ id: 'leakLp', msgid: '每漏掉 1 个敌人，额外扣 {n} 点目标生命值', params: { n: Math.trunc(row.leakLp) } });
  }
  if (Number.isFinite(row.incomeDelta) && row.incomeDelta < 0) {
    out.push({
      id: 'income',
      msgid: '第 {from} 回合起，每回合收入 −{n}',
      params: { from: PROTOCOL_LEVEL_INCOME_FREE_ROUNDS + 1, n: Math.abs(Math.trunc(row.incomeDelta)) },
    });
  }
  // 一回合获得资金的额度（业主 2026-10-29「把这个负面做成 n19」）：只有带这一格的等级（当前只有 19）才列出来
  if (Number.isFinite(row.fundsGainCap) && row.fundsGainCap > 0) {
    out.push({
      id: 'fundsCap',
      msgid: '一回合最多获得 {n} 资金，超出的部分作废',
      params: { n: Math.trunc(row.fundsGainCap) },
    });
  }
  if (Number.isFinite(row.bossPoolMul) && row.bossPoolMul > 1) {
    out.push({ id: 'bossPool', msgid: '首领（最终攻势 / 隐秘核心）血量 {v}', params: { v: pct(row.bossPoolMul) } });
  }
  if (Number.isFinite(row.extraEnemyHexes) && row.extraEnemyHexes > 0) {
    const rounds = PROTOCOL_LEVEL_EXTRA_HEX_ROUNDS.slice(0, Math.max(1, Math.trunc(row.extraEnemyHexes)));
    out.push({
      id: 'extraHex',
      msgid: '额外敌方协议源石 {n} 张，分别在第 {rounds} 回合发放',
      params: { n: Math.trunc(row.extraEnemyHexes), rounds: rounds.join(' / ') },
    });
  }

  // ---- 这一级的彩蛋（18 级起有） ----
  if (level >= PROTOCOL_LEVEL_EXTRA_BOSS_LEVEL) {
    out.push({
      id: 'extraBoss',
      msgid: '第 {round} 回合（普通回合）会额外刷出「不死的黑蛇」或梅菲斯特之一，随机决定',
      params: { round: PROTOCOL_LEVEL_EXTRA_BOSS_ROUND },
    });
  }
  return out;
}

/**
 * 每一档的「一句话卖点」—— 界面在等级条顶上用它当摘要（缺省等级返回 null）。
 * 与 `protocolLevelEffects` 分开：摘要要短、要能一眼扫过，逐条列表才是细节。
 * @param {number} level
 * @returns {{ id: string, msgid: string, params: Record<string, string|number> }|null}
 */
export function protocolLevelHeadline(level) {
  const row = protocolLevelRow(level);
  if (!row) return null;
  const tier = row.tier === 'steady' ? 'steady' : row.tier === 'danger' ? 'danger' : 'deep';
  return { id: tier, msgid: tier === 'steady' ? '稳定区：只有敌方生命与攻击' : tier === 'danger' ? '危险区：追加防御、法抗、漏怪与收入' : '深潜区：追加首领池、额外敌方协议源石', params: {} };
}

/**
 * 界面用「强调色 + ★」单独标出来的那几条效果 —— 它们**不是数值**（业主 2026-10-22 的难度介绍里，数值读起来都一样，
 * 真正改变玩法的那两条要一眼看见）：R10 的彩蛋首领（18 级起）、19 级的一回合资金上限。
 * 唯一真源：`public/js/screens/lobby.js` 与 `room.js` 都读它，别在界面里写第二份 id 列表。
 */
export const PROTOCOL_LEVEL_SPECIAL_EFFECT_IDS = Object.freeze(['extraBoss', 'fundsCap']);

/**
 * `protocolLevelEffects` / `protocolLevelHeadline` 会发出的**全部 msgid**（i18n 的一份清单）。
 *
 * 为什么要有这张表：那些 msgid 在运行时按 `id` 拼出来，`tools/i18n.mjs extract` 只认字面量，看不到它们。
 * 这张表是给测试用的 —— `test/match/protocol-levels.test.js` 拿它逐个查 `public/i18n/en.json`，少一条就报。
 * 加一条新的效果时，这里和四个语言包要一起加（漏了的表现是界面上直接显示中文原文，而不是英文/日文）。
 */
export const PROTOCOL_LEVEL_EFFECT_TEXT = Object.freeze([
  '稳定区：只有敌方生命与攻击',
  '危险区：追加防御、法抗、漏怪与收入',
  '深潜区：追加首领池、额外敌方协议源石',
  '第 1–{end} 回合敌方数值低于本级标称值，第 {from} 回合起满额，第 {late} 回合起再加强，第 {spikeFrom}–{spikeTo} 回合最重',
  '敌方生命值 {v}',
  '敌方攻击力 {v}',
  '远程敌人攻击力 {v}（其余敌人按上面那条）',
  '敌方防御力 {v}',
  '敌方法术抗性 {v}',
  '第 {from} 回合起每波敌人数量 +{n}，第 {late} 回合起 +{n2}',
  '每漏掉 1 个敌人，额外扣 {n} 点目标生命值',
  '第 {from} 回合起，每回合收入 −{n}',
  '一回合最多获得 {n} 资金，超出的部分作废',
  '首领（最终攻势 / 隐秘核心）血量 {v}',
  '额外敌方协议源石 {n} 张，分别在第 {rounds} 回合发放',
  '第 {round} 回合（普通回合）会额外刷出「不死的黑蛇」或梅菲斯特之一，随机决定',
]);
