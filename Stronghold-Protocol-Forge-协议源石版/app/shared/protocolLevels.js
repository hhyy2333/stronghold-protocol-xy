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
//   13–18 深潜区：首领池、额外敌方协议源石（第 1 / 3 / 5 回合分散发，见 PROTOCOL_LEVEL_EXTRA_HEX_ROUNDS）。
//
// 读点（都从这里取，别在引擎里写第二份）：
//   server/match/gamedata.js   income / bossPoolHp
//   server/match/hextech.js    matchEnemyMods（敌方 mods 折入，预览=实战同一份）
//   server/match/match/settle.js 漏怪损失
//   server/match/match/hexDraft.js 额外敌方协议源石的发放（applyProtocolLevelEnemyHexes）
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

// =====================================================================================================================
// 「这一级到底改了什么」—— 给人看的逐条说明（业主 2026-10-22：「有人不知道n18的效果，增加难度介绍」）
// =====================================================================================================================
//
// 为什么放在 shared 而不是写死在界面里：这些数字是**表里那几行**的另一面。写死一份文案，表一改文案就开始说谎
// （这个仓库里已经有过：等级表的注释写着「13–18 不再标 experimental」，而界面还在读一个没人写的字段）。
// 这里把每一行翻成一组 `{ msgid, params }`，界面只负责 `t()` 和排版；数字永远从表里现算。
//
// 返回的每一条都对应表里的**一个字段**，顺序是「先数值、再规则」：玩家先看伤害，再看机制。18 级独有那条
// （R10 的彩蛋首领）也在这里，因为它是 `PROTOCOL_LEVEL_EXTRA_BOSS_*` 的另一面。

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

  // ---- 数值（敌方全局乘区） ----
  if (Number.isFinite(enemy.hpMul) && enemy.hpMul > 1) {
    out.push({ id: 'hp', msgid: '敌方生命值 {v}', params: { v: times(enemy.hpMul) } });
  }
  if (Number.isFinite(enemy.atkMul) && enemy.atkMul > 1) {
    out.push({ id: 'atk', msgid: '敌方攻击力 {v}', params: { v: times(enemy.atkMul) } });
  }
  if (Number.isFinite(enemy.defMul) && enemy.defMul > 1) {
    out.push({ id: 'def', msgid: '敌方防御力 {v}', params: { v: times(enemy.defMul) } });
  }
  if (Number.isFinite(enemy.resMul) && enemy.resMul > 1) {
    out.push({ id: 'res', msgid: '敌方法术抗性 {v}', params: { v: times(enemy.resMul) } });
  }
  if (Number.isFinite(enemy.countAdd) && enemy.countAdd > 0) {
    out.push({ id: 'count', msgid: '每波敌人数量 +{n}', params: { n: Math.trunc(enemy.countAdd) } });
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

  // ---- 这一级独有的彩蛋（当前只有 18 级有） ----
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
 * 18 级那一档的「一句话卖点」—— 界面在等级条顶上用它当摘要（缺省等级返回 null）。
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
  '敌方生命值 {v}',
  '敌方攻击力 {v}',
  '敌方防御力 {v}',
  '敌方法术抗性 {v}',
  '每波敌人数量 +{n}',
  '每漏掉 1 个敌人，额外扣 {n} 点目标生命值',
  '第 {from} 回合起，每回合收入 −{n}',
  '首领（最终攻势 / 隐秘核心）血量 {v}',
  '额外敌方协议源石 {n} 张，分别在第 {rounds} 回合发放',
  '第 {round} 回合（普通回合）会额外刷出「不死的黑蛇」或梅菲斯特之一，随机决定',
]);
