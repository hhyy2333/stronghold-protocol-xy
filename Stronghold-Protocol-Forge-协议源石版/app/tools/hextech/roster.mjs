// tools/hextech/roster.mjs — the hand-authored 协议源石 (Protocol Originium) roster (DESIGN §29).
//
// (Named 海克斯 until 2026-10-08: the owner renamed the feature 协议源石 — 源石 is the game's own word for Originium —
// and renamed its three rarity tiers 白银 / 黄金 / 棱彩 to 1阶 / 2阶 / 3阶 when the card art became the supplied 阶位
// images. The internal keys stay `hextech` / `hex` / silver|gold|prismatic: display-only rename, no save break.)
//
// This is the source of truth of the feature's CONTENT: 66 player cards and 24 enemy cards, their rarity and the effect
// the engine applies. It names no art: the third-party mod's rune icons, rarity frames and button sprites were removed
// from the project on 2026-10-12 (owner's decision) — their source pack carries no licence file, so the project has no
// right to redistribute them. The card face is the owner's own 阶位 image (`hextech/tier`, not in this file);
// `tools/hextech-import.mjs` keeps only the two draft sound cues. tools/build-hextech.mjs turns this file into
// data/hextech.json — the file the server and the client read; data/*.json is generated, never hand-edited
// (CONTRIBUTING §3).
//
// The names and descriptions are the remake's own: the mod's own texts describe a card game and mean nothing here.
// English translation lives in public/i18n/en.json under the same msgid (docs/I18N.md), with ja / ko / zh-TW falling
// back to it or to the Chinese msgid.
//
// Effect vocabulary (docs/META.md §2, applied by server/match/hextech.js and server/sim/content/hextech.js):
//   effect.onPick        — runs once, when the player picks the hex
//   effect.onRoundStart  — runs at the start of every prep phase the player is alive for (everyRounds: N throttles it)
//   effect.<other hook>  — any other dispatcher event (onSpend / onSold / onBattleResult / onGain / …) with its own spec
//   effect.battle        — a passive carried into every battle (attack / defence / max HP / the first leak / scripted)
//   effect.team          — true: the pick reaches every alive teammate too (each through their own ctx, as 机变 team cards)
//   mods                 — enemy hexes only: multiplied into spawns[].mods (wave hpMul/atkMul/... semantics)
//   payout               — enemy hexes only: what the players are paid at settlement (e.g. per counted leak)
// Every key maps to a ctx primitive (funds / item / layers / freeRefresh / chess / lp / shop / counter), so no new
// mutation surface is introduced. `chess.tier` is a tier number, or the token 'level' = the player's current 调度中心
// level (the draw then escalates with the shop); `chess.same: true` rolls ONCE and grants `count` copies of it (three
// identical operators merge on the spot). The tier token is validated by tools/build-hextech.mjs.
// `effect.battle.aspd` is ASPD POINTS (the flat `aspd` stat, interval = bat × 100 / aspd), not a percentage.
//
// Second batch (0.3.0 playtest #2) spec keys, all engine-side (`server/sim/content/hextech.js applySpec`):
//   rebate { per, gain }        — accrue `per`-fund spends, pay `gain` per step at the next round start
//   rebatePay true             — the paying half of `rebate`
//   shopSlot { index, pick }   — rewrite one shop slot (`pick: 'board'` = a random operator from the own board)
//   bondAtkPct N               — every sale: +N % ATK, permanently, for the operators sharing a sold bond
//   perLeak { perLeak, cap }   — at settlement: funds per counted leak (cap per round)
//   mainBondCount N            — the own most-numerous bond needs N fewer operators (the 调和 mechanism)
//   firstKillBy { profession, coins } — first kill of a battle by that profession credits coins (bounty channel)
//   firstAttackBy { profession, atkPct, seconds } — battle: each own operator of that profession's own first
//                                     attack buffs itself with atkPct for `seconds`
//   copyAllyHex true           — on pick: copy a random teammate-owned hex (highest rarity first). The draft is
//                                 PARALLEL, so the first seat to pick sees none of the others' cards yet: the card is
//                                 ARMED rather than dropped and resolved the moment a teammate owns one
//                                 (server/match/hextech.js resolveMirrorCopies — after every pick, and at each round
//                                 start), so pick order can never waste it
//   randomHexes N              — on pick: gain N extra random hexes
//   countAdd N (enemy)         — +N enemies per normal spawn group, before the preview
//
// Third batch (0.3.0 playtest #3) spec keys, all engine-side (server/sim/content/hextech.js applySpec + install, plus
// the ownership predicates of server/match/hextech.js):
//   bondCountShift { small, big }   — on pick: 附加盟约 (= 小盟约, 调和 and 独行 left out) +small members, 核心盟约
//                                     (= 大盟约) +big (a negative value makes a bond harder: it adds to the count)
//   layerTransfer true              — on battle start: half the layers of the lowest active bond move to the highest one
//   shopContractArm / shopContractDiscount / shopContractSpend — 商店契约's arm / price / consume halves
//   eliteBuy { pctPerElite }        — on buy: pctPerElite % per elite operator on the board to promote the purchase
//   itemRefund true                 — on destroy (player discard): refund the item's price
//   foresightDebt { lp }            — on buy: pay `lp` life for a 远见-discounted purchase
//   battleForRounds { rounds, battle } — on pick: a battle passive that lapses after `rounds` rounds
//   bondShare true                  — ownership: adjacent board operators share each other's bonds
//   devourTarget { maxTargets }     — ownership: 阿戈尔's devour gives the devourer +maxTargets attack targets
//   indomEmber { seconds, block }   — ownership: after 不屈 fires, that operator survives `seconds` (HP floored at 1)
//   traitSpread true                — ownership: the leftmost-bottom operator copies its IN_BATTLE 特质 to an adjacent one
//   killGift { atkPct }             — ownership: every knock-out in battle adds atkPct
//   skillFlow { layers }            — ownership: every skill a member opens adds `layers` to its own active bonds
//   bountyMul N                     — ownership: bounty income at settlement ×N
//   equipSlots N                    — ownership: an operator carries N equipment (the data's equipPerChess when absent)
//   northWall { shieldPct, stepPct, capPct } — ownership: the operators of the rightmost own column start with a
//                                     `shieldPct`% max-HP shield that gains `stepPct`% a second up to `capPct`%
//   immortalRevive { count }        — ownership: each own operator revives `count` time(s) per battle
//   armorBreak { defFlat }          — ownership: every allied physical hit lowers the enemy's DEF by defFlat
//   bondFission { cap, mul }        — ownership: only `cap` bonds stay active (highest layers first), they gain ×mul
//   foresightHalve true             — ownership: 远见's price-discount milestones need half the layers
//   precisionPen { perLayers, pct } — ownership: 精准 layers give 精准 + ranged operators DEF/RES penetration

/**
 * Rarity tiers (order = the escalation order used by the adjacent-rarity fallback).
 *
 * `name` is what the card shows: the owner renamed the three tiers to 1阶 / 2阶 / 3阶 when the card art became the
 * supplied dot-matrix 阶位 images (user decision, 2026-10-08 — the tier number IS the card's face now). `tier` is that
 * number, and the key of the `hextech/tier` art group in data/local-assets.json; the `id` stays the internal key every
 * server/client lookup and every saved match uses, so a rename here is display-only.
 */
export const RARITIES = [
  { id: 'silver', name: '1阶', weight: 0.60, tier: 1 },
  { id: 'gold', name: '2阶', weight: 0.30, tier: 2 },
  { id: 'prismatic', name: '3阶', weight: 0.10, tier: 3 },
];

/** When a draft happens, how many options, how many rerolls, and how the enemy side is fed. */
export const FORMAT = {
  rounds: [1, 6, 11],
  offer: 3,
  rerolls: 1,
  timerSec: 30,
  timeout: 'random',
  enemyPerDraw: 1,
  enemyPersist: 'match',
};

/**
 * The 51 player hexes (19 + 19 + 13 third/fourth batches; the second batch folded into the first block).
 *
 * Fourth batch (2026-10-09) spec keys, all engine-side (`server/sim/content/hextech.js`):
 *   perKill { per, gain, cap }        — at settlement: funds per `per` knock-outs (cap per round)
 *   sellBonus { gain, cap }           — on a sale: +gain funds (cap per round)
 *   levelRefund { pct }               — on a level-up: refund `pct`% of the price paid
 *   item { pool, count }             — grant `count` items drawn from a choices.json equip pool (the pool's own
 *                                      `maxTier` is what makes 军械库 "不高于调度中心等级"; ctx.rollPool injects shopLevel)
 *   goldenItem { tier, count }       — grant `count` GOLDEN (进阶) items of that tier; `tier: 'next'` = one above the
 *                                      last one GRANTED (the hex's own counter), clamped 1-6. A golden takes TWO spare
 *                                      copies of its base item out of the shared pool, so a grant with no stock does
 *                                      nothing and does NOT advance the ladder (后勤整备).
 *   battle.spRecoveryFlat N          — +N SP/s (a flat mod, `units.js` spRecovery)
 *   battle.blockCnt N                — +N block slots
 *   battle.spCostFlat N              — skill SP cost +N (negative = cheaper)
 *   holdLine { stepPct, def, max }   — every `stepPct`% of HP lost adds `def` DEF, at most `max` stacks (battle script)
 *   rangedExtend { profession, extend } — +`extend` attack range for that profession (battle script)
 *   lastStand { seconds }            — HP cannot drop below 1 for the first `seconds` (battle script)
 *   overdrive { selfDmgPct }         — on every skill start the caster loses that % of max HP (battle script)
 *   fieldHospital { healPct }        — on every knock-out heal the lowest-HP ally by that % of its max HP (battle script)
 *   elemAmp { elemTakenMul, erosionPerSec } — enemies take that multiplier on ELEMENT GAUGE damage, and every second
 *                                     every enemy on the field takes `erosionPerSec` erosion element damage (battle script;
 *                                     the per-second half added by §29.32)
 */
export const PLAYER_HEXES = [
  {
    id: 'hex_stipend',
    name: '战备津贴',
    desc: '获得时立即得到 3 资金；之后每回合开始时额外得到 2 资金。',
    rarity: 'silver',
    effect: { onPick: { funds: 3 }, onRoundStart: { funds: 2 } },
  },
  {
    id: 'hex_logistics',
    name: '后勤整备',
    desc: '获得时立即得到 1 件随机 1 阶进阶装备；之后每 2 回合开始时再得到 1 件进阶装备，其阶级比上次获得的装备高 1 阶（最高 6 阶）。',
    rarity: 'silver',
    effect: {
      onPick: { goldenItem: { tier: 1, count: 1 } },
      onRoundStart: { everyRounds: 2, goldenItem: { tier: 'next', count: 1 } },
    },
  },
  {
    id: 'hex_echo',
    name: '盟约回响',
    desc: '每回合开始时，所有已激活盟约 +5 层。',
    rarity: 'silver',
    effect: { onRoundStart: { allActiveLayers: 5 } },
  },
  {
    id: 'hex_refresh',
    name: '免费刷新',
    desc: '获得时立即得到 6 次免费刷新；之后每回合开始时再得到 2 次。',
    rarity: 'silver',
    effect: { onPick: { freeRefresh: 6 }, onRoundStart: { freeRefresh: 2 } },
  },
  {
    id: 'hex_recruit',
    name: '精锐预兆',
    desc: '获得时立即得到 3 张同一名当前等级阶的干员。',
    rarity: 'silver',
    effect: { onPick: { chess: { tier: 'level', count: 3, same: true } } },
  },
  {
    id: 'hex_bulwark',
    name: '坚壁',
    desc: '获得时目标生命值上限 +10。',
    rarity: 'silver',
    effect: { onPick: { lp: 10 } },
  },
  {
    id: 'hex_massprod',
    name: '量产线',
    desc: '每回合开始时，随机获得 1 名当前等级阶的干员。',
    rarity: 'gold',
    effect: { onRoundStart: { chess: { tier: 'level', count: 1 } } },
  },
  {
    id: 'hex_drill',
    name: '精锐训练',
    desc: '作战中，己方所有干员攻击力 +20%、攻击速度 +10；并根据当前回合 x 额外获得 5x% 攻击力与 4x 攻击速度。',
    rarity: 'gold',
    // fifth batch (2026-10-11): the static half stays a plain `battle` passive; the per-round half is the `drill` script
    // (server/sim/content/hexcards/drill.js, wired by server/sim/content/hextech.js installDrillPart).
    effect: { battle: { atkPct: 20, aspd: 10 }, drill: { atkPerRound: 5, aspdPerRound: 4 } },
  },
  {
    id: 'hex_armor',
    name: '反击装甲',
    // Owner's rebalance of 2026-10-15: the riposte now fires on damage DEALT as well as taken, at 200 % (was 100 %,
    // taken only). `onDealt` is read by hexcards/armor.js.
    desc: '作战中，己方所有干员防御力 +18%、法术抗性 +10；受到伤害或造成伤害时，对伤害来源造成 200% 防御力的真实伤害。',
    rarity: 'gold',
    // fifth batch: static +18 % DEF / +10 RES + the riposte script (hexcards/armor.js).
    effect: { battle: { defPct: 18, resFlat: 10 }, armor: { defRatio: 200, onDealt: true } },
  },
  {
    id: 'hex_overlord',
    name: '盟约之主',
    desc: '每回合开始时，所有已激活盟约 +5 层，且你人数最多的盟约所需人数 −1。',
    rarity: 'prismatic',
    effect: { onRoundStart: { allActiveLayers: 5, mainBondCount: 1 } },
  },
  {
    id: 'hex_immortal',
    name: '不灭壁垒',
    desc: '作战中，己方所有干员生命值上限 +12%；每场战斗中，己方每名干员各有 1 次复活机会。',
    rarity: 'prismatic',
    effect: { battle: { maxHpPct: 12 }, immortalRevive: { count: 1 } },
  },
  // ---- second batch (0.3.0 playtest #2) ---------------------------------------------------------------
  {
    id: 'hex_dividend',
    name: '源石红利',
    desc: '你每消耗 5 资金，下回合开始时额外得到 1 资金。',
    rarity: 'silver',
    effect: { onSpend: { rebateAccrue: true }, onRoundStart: { rebatePay: { per: 5, gain: 1 } } },
  },
  {
    id: 'hex_recovery',
    name: '战损回收',
    desc: '每场战斗每漏掉 1 个敌人，下回合开始时额外得到 1 资金；若该回合的联防失败并扣除了你的目标生命值，则每漏掉 1 个敌人额外得到 2 资金（每回合最多 12）。',
    rarity: 'silver',
    effect: { onBattleResult: { perLeak: 1, perLeakAfterLoss: 2, cap: 12 } },
  },
  {
    id: 'hex_heritage',
    name: '传承',
    desc: '你每出售 1 名干员，场上拥有其任一盟约的干员永久 +2% 攻击力。',
    rarity: 'silver',
    effect: { onSold: { bondAtkPct: 2 } },
  },
  {
    id: 'hex_broadcast',
    name: '调度直播',
    desc: '每回合开始时，把商店的第一格换成 1 名你场上随机的干员。',
    rarity: 'gold',
    effect: { onRoundStart: { shopSlot: { index: 0, pick: 'board' } } },
  },
  {
    id: 'hex_vanguard',
    name: '先锋之势',
    desc: '每场战斗中，己方第一次击倒敌人时，若该次击杀来自先锋干员，你在结算后得到 4 资金；己方先锋干员首次攻击时攻击力 +30%，持续 10 秒。',
    rarity: 'gold',
    effect: { battle: { firstKillBy: { profession: 'PIONEER', coins: 4 }, firstAttackBy: { profession: 'PIONEER', atkPct: 30, seconds: 10 } } },
  },
  {
    id: 'hex_mirror',
    name: '镜像协议',
    desc: '获得时，随机复制一名队友已拥有的一枚协议源石（优先阶位更高的一枚）；若队友尚未拥有，则在之后其获得时补上。',
    rarity: 'gold',
    effect: { onPick: { copyAllyHex: true } },
  },
  {
    id: 'hex_double',
    name: '二次抽取',
    desc: '获得时，额外随机获得两枚协议源石。',
    rarity: 'prismatic',
    effect: { onPick: { randomHexes: 2 } },
  },
  {
    id: 'hex_resonance',
    name: '共鸣协议',
    desc: '每回合开始时，你和所有队友各获得 2 次免费刷新。',
    rarity: 'prismatic',
    effect: { team: true, onRoundStart: { freeRefresh: 2 } },
  },
  // ---- third batch (0.3.0 playtest #3): the user's own list of 19 -------------------------------------
  {
    id: 'hex_bondresonance',
    name: '盟约共鸣',
    desc: '你战场上的干员与其上下左右相邻的干员共享彼此的盟约。',
    rarity: 'prismatic',
    effect: { bondShare: true },
  },
  {
    id: 'hex_layershift',
    name: '层数转移',
    desc: '战斗开始时，你层数最低的已激活盟约把一半层数转移给层数最高的已激活盟约。',
    rarity: 'silver',
    effect: { onBattleStart: { layerTransfer: true } },
  },
  {
    id: 'hex_pyrrhic',
    name: '因小失大',
    desc: '本局中，附加盟约（调和与独行除外）的激活条件减少 1 名干员，核心盟约的激活条件增加 1 名干员。',
    // 二阶 since 2026-10-13 (the owner's list): the shift is worth a full 阶位 — it hands every 附加盟约 one free member
    // and only taxes the 核心 ones. Data-only move: the mechanic is unchanged (`bondCountShift`).
    rarity: 'gold',
    effect: { onPick: { bondCountShift: { small: 1, big: -1 } } },
  },
  {
    id: 'hex_deepdevour',
    name: '深度吞噬',
    desc: '〖阿戈尔〗干员吞噬时，其攻击目标数 +1。',
    rarity: 'gold',
    effect: { devourTarget: { maxTargets: 1 } },
  },
  {
    id: 'hex_indomember',
    name: '不屈余烬',
    desc: '〖不屈〗盟约效果触发后，该干员获得 6 秒阻挡数 +2。',
    rarity: 'silver',
    effect: { indomEmber: { seconds: 6, block: 2 } },
  },
  {
    id: 'hex_traitspread',
    name: '特质扩散',
    desc: '战斗开始时，你最靠左（同列更靠下）的干员把自身的战斗特质复制给最近的干员（优先右边）。',
    rarity: 'gold',
    effect: { traitSpread: true },
  },
  {
    id: 'hex_killgift',
    name: '击倒馈赠',
    desc: '作战中，你的干员每击倒 1 个敌人，该干员攻击力 +10%（本场战斗内叠加）。',
    rarity: 'silver',
    effect: { killGift: { atkPct: 10 } },
  },
  {
    id: 'hex_skillflow',
    name: '技能层涌',
    desc: '作战中，你的干员每次开启技能时，其所属的已激活盟约层数 +1（单场战斗中每个盟约最多通过此效果叠加 40 层）。',
    rarity: 'silver',
    effect: { skillFlow: { layers: 1, maxLayersPerBond: 40 } },
  },
  {
    id: 'hex_eliteresonance',
    name: '精英共鸣',
    desc: '场上每有 1 名精锐干员（数量 x），你购买干员时有 5x% 概率直接获得其精锐形态。',
    rarity: 'gold',
    effect: { onBuy: { eliteBuy: { pctPerElite: 5 } } },
  },
  {
    id: 'hex_bountytriple',
    name: '悬赏倍增',
    desc: '本局中，你获得的悬赏资金 ×3。',
    rarity: 'gold',
    effect: { bountyMul: 3 },
  },
  {
    id: 'hex_shopcontract',
    name: '商店契约',
    desc: '获得时立即得到 3 次免费刷新；每次刷新后你购买的第一名干员价格 −1（最低 0 费）。',
    rarity: 'gold',
    effect: {
      onPick: { freeRefresh: 3 },
      onRefresh: { shopContractArm: true },
      onPrice: { shopContractDiscount: 1 },
      onBuy: { shopContractSpend: true },
    },
  },
  {
    id: 'hex_itemrefund',
    name: '装备转化',
    desc: '你弃置装备时，返还其购买价格。',
    rarity: 'silver',
    effect: { onDestroy: { itemRefund: true } },
  },
  {
    id: 'hex_fullkit',
    name: '整装待发',
    desc: '干员可装备 3 个装备（装备变形同构体与两个阵营装备时，两边的阵营盟约都会生效）。',
    rarity: 'prismatic',
    effect: { equipSlots: 3 },
  },
  {
    id: 'hex_northwall',
    name: '北境长城',
    desc: '战斗开始时，你最右一列的干员获得可吸收相当于其最大生命值 50% 的护盾；此后每秒增加 5%，最多到其最大生命值的 100%。',
    rarity: 'silver',
    effect: { northWall: { shieldPct: 50, stepPct: 5, capPct: 100 } },
  },
  {
    id: 'hex_armorbreak',
    name: '装甲破坏',
    desc: '作战中，你的干员造成物理伤害时，使该敌人防御力 −20（本场战斗内叠加）。',
    rarity: 'gold',
    effect: { armorBreak: { defFlat: 20 } },
  },
  {
    id: 'hex_allin',
    name: '孤注一掷',
    desc: '获得后的 4 个回合内，己方所有干员攻击力 +200%，随后失效。',
    rarity: 'prismatic',
    effect: { battleForRounds: { rounds: 4, battle: { atkPct: 200 } } },
  },
  {
    id: 'hex_bondfission',
    name: '盟约裂变',
    desc: '本局中你只能激活 2 个盟约（层数最高的优先），但这 2 个盟约的叠层速度提升 200%。',
    rarity: 'prismatic',
    effect: { bondFission: { cap: 2, mul: 3 } },
  },
  {
    id: 'hex_foresightdebt',
    name: '远见透支',
    desc: '本局中〖远见〗购买价格降低效果所需层数减半，但你每次通过〖远见〗折扣购买干员时消耗 1 点目标生命值（不会降至 0 以下）。',
    rarity: 'silver',
    effect: { foresightHalve: true, onBuy: { foresightDebt: { lp: 1 } } },
  },
  {
    id: 'hex_precisionpen',
    name: '精准穿透',
    desc: '〖精准〗每叠加 10 层，〖精准〗干员及你所有远程干员的攻击额外无视目标 2% 的防御力与法术抗性。',
    rarity: 'silver',
    effect: { precisionPen: { perLayers: 10, pct: 2 } },
  },
  // ---- fourth batch (0.3.0 playtest #4, the owner's review of 2026-10-09): 13 more player hexes -------------
  // The batch deliberately opens the axes the first 38 do not touch: kills as income, the sell/level-up actions
  // themselves, SP recovery and SP cost, attack range, block count, the deploy cap, redeploy time, healing,
  // element damage and the shop-level-scaled equipment roll. Enemy side unchanged (the 10 redesigns stay designs).
  {
    id: 'hex_merit',
    name: '战功簿',
    desc: '作战结束时，每击倒 5 名敌人，下回合开始时额外得到 1 资金（每回合至多 4）。',
    rarity: 'silver',
    effect: { onBattleResult: { perKill: { per: 5, gain: 1, cap: 4 } } },
  },
  {
    id: 'hex_rationing',
    name: '配给制',
    desc: '你出售干员时，额外得到 1 资金（每回合至多额外 5）。',
    rarity: 'silver',
    effect: { onSold: { sellBonus: { gain: 1, cap: 5 } } },
  },
  {
    id: 'hex_quartermaster',
    name: '军需官',
    desc: '每次提升调度中心等级时，返还该次升级费用的一半（向下取整）。',
    rarity: 'silver',
    effect: { onLevelUp: { levelRefund: { pct: 50 } } },
  },
  {
    id: 'hex_drillsergeant',
    name: '教官批注',
    desc: '作战中，己方所有干员每秒额外回复 0.3 点技力。',
    rarity: 'silver',
    effect: { battle: { spRecoveryFlat: 0.3 } },
  },
  {
    id: 'hex_holdline',
    name: '浴血',
    desc: '作战中，己方干员每损失 25% 生命值，防御力 +40（本场战斗内叠加，最多 4 层）。',
    rarity: 'silver',
    effect: { holdLine: { stepPct: 25, def: 40, max: 4 } },
  },
  {
    id: 'hex_firingline',
    name: '火力延伸',
    desc: '作战中，己方狙击干员的攻击距离 +1。',
    rarity: 'gold',
    effect: { rangedExtend: { profession: 'SNIPER', extend: 1 } },
  },
  {
    id: 'hex_shieldwall',
    name: '盾墙',
    desc: '作战中，己方所有干员阻挡数 +1，生命值上限 +20%；相邻的己方单位受到的伤害与治疗，按 50% 分摊给每个相邻的【重装】干员。',
    rarity: 'gold',
    // fifth batch: static +1 block / +20 % max HP; the adjacent-重装 split is the `shieldwall` script
    // (hexcards/shieldwall.js). `ratio` is a PERCENTAGE (50 = 50 %). Only 4-neighbour, same-owner 重装 join the pool.
    effect: { battle: { blockCnt: 1, maxHpPct: 20 }, shieldwall: { ratio: 50 } },
  },
  {
    id: 'hex_arsenal',
    name: '军械库',
    desc: '每回合开始时，随机获得 1 件不高于你调度中心等级的装备。',
    rarity: 'gold',
    effect: { onRoundStart: { item: { pool: 'pool_equip_normal', count: 1 } } },
  },
  {
    id: 'hex_laststand',
    name: '先驱',
    desc: '作战中，战斗开始后的前 30 秒，己方所有干员生命值不会降至 1 以下。',
    rarity: 'gold',
    effect: { lastStand: { seconds: 30 } },
  },
  {
    id: 'hex_overdrive',
    name: '超载协议',
    desc: '作战中，己方干员的技能消耗技力 −3；每次开启技能后，该干员失去自身最大生命值的 4% 生命。',
    rarity: 'gold',
    effect: { battle: { spCostFlat: -3 }, overdrive: { selfDmgPct: 4 } },
  },
  {
    id: 'hex_fieldhospital',
    name: '战地医院',
    desc: '作战中，你的干员每击倒 1 名敌人，为当前生命值比例最低的己方干员回复其最大生命值的 10%。',
    rarity: 'gold',
    effect: { fieldHospital: { healPct: 10 } },
  },
  {
    id: 'hex_lossamp',
    name: '损伤加强',
    desc: '作战中，敌人受到的元素损伤 +50%；场上所有敌人每秒额外受到 100 点侵蚀损伤。',
    rarity: 'gold',
    effect: { elemAmp: { elemTakenMul: 1.5, erosionPerSec: 100 } },
  },
  {
    id: 'hex_warmachine',
    name: '战争机器',
    desc: '获得时：你和所有队友的目标生命值 +5；作战中，你和所有队友的干员攻击力 +16%；联防时，团队所有干员攻击力 +30%、防御力 +30%、生命值上限 +30%。',
    rarity: 'prismatic',
    // fifth batch: the pick / always-on halves are data; the 联防 aura is the `warmachine` script
    // (hexcards/warmachine.js) — it reads the three PERCENTAGE values below, keyed `hex:warmachine:unite` so it never
    // collides with this card's own `battle` passive (`hex:hex_warmachine`).
    effect: { team: true, onPick: { lp: 5 }, battle: { atkPct: 16 }, warmachine: { atkPct: 30, defPct: 30, hpPct: 30 } },
  },
  // ---- sixth batch (owner's list, 2026-10-11): 7 more player hexes ------------------------------------------
  // The names, the tier of each card and the description TEXT are the owner's, copied verbatim — including the
  // half-width `+3` / `115+2％` spellings and 破隐's one-clause text. Only the `effect` spec keys below are the
  // remake's own (they are what the engine reads); each one is documented beside its reader in
  // server/sim/content/hextech.js / server/sim/content/hexcards/.
  //
  //   humanRite  { atkPct, hpPct, cap }       人祭: an own operator's knock-out summons a 炎佑 built from that
  //                                           operator's ATK × atkPct/100 and max HP × hpPct/100, at most `cap` standing
  //                                           on the field at once (hexcards/humanrite.js; §29.30)
  //   onPick.debt { funds, rounds }           债务: on pick, a random living teammate +`funds`; for `rounds` rounds
  //                                           (the 孤注一掷 window: the pick's own round counts as the first) every
  //                                           operator that teammate buys is granted to the picker too
  //                                           (server/match/hextech.js applyHexExtras + effect:hexdebt)
  //   rangedist  { nearPct, midPct, farPct }  近大远小: the attack's damage multiplier by tile distance
  //                                           (≤1 → nearPct, 2 → midPct, ≥3 → farPct; hexcards/rangedist.js)
  //   minefield  { count, atk, bind, bindSingle }
  //                                           雷区: at battle start, `count` 多萝西-S2 mines on random deployable
  //                                           tiles; each mine's own ATK is `atk` (owner 2026-10-12: 1000, not the
  //                                           token record's 100) and it 束缚s for `bind` seconds, or `bindSingle`
  //                                           when it caught exactly one enemy (hexcards/minefield.js)
  //   breaker    true                         破隐: every enemy's 隐匿 is off (a persistent `reveal` flag)
  //                                           (hexcards/breaker.js)
  //   neurotoxin { flat, pct, seconds, cap }  神经毒素: an own operator's attack poisons the target; once a second
  //                                           for `seconds` s it takes min(cap, flat + pct% of its max HP) arts
  //                                           damage; never stacks (hexcards/neurotoxin.js)
  //   ricochet   { falloffPct, layersPerBounce, maxBounces }
  //                                           跳弹: a ranged operator's ranged attack ricochets to the nearest enemy,
  //                                           each bounce ×(1 − falloffPct/100); the ricochet count is
  //                                           floor(〖精准〗layers / layersPerBounce) + 1, at most maxBounces
  //                                           (hexcards/ricochet.js)
  //
  // Art note [ASSUMED]: HextechRunes.pck ships exactly 75 relic PNGs and the previous 75 cards use all of them
  // one-to-one. The seven icons below are deliberately reused from that set (each is thematically the closest);
  // give them their own art when a pack with spare runes is available. tools/hextech-import.mjs --check still
  // passes, because every name it is asked for is already unpacked.
  //
  // Eighth batch (the owner's list of 2026-10-12, §29.23): five 3阶 「形态」 cards. All five are engine-side:
  //   battle.extraCharges N         回响形态: at battle start every own operator's skill gains N charges of headroom
  //                                 (`Skill.maxCharges + N`), and a skill that could not hold a charge becomes a
  //                                 `charges` skill so it can hold N + 1 (server/sim/content/hextech.js install)
  //   zeroFunds true                虚空形态 (onPick): the pick zeroes the player's funds (ctx.zeroFunds)
  //   freeSpendArm true             虚空形态 (onRoundStart): arm this round's one free spend — the pick's own round is
  //                                 held back, so the first free spend is the round AFTER the pick
  //   freeSpendRefund true          虚空形态 (onSpend): the first spend of an armed round is refunded in full
  //   demonTakeover true            恶魔形态 (onPrepStart, everyPreps 2): the AI plays this round's spending —
  //                                 shop level-ups first (as far as the funds allow, so it never just buys while a level
  //                                 is affordable — §29.32), then buys and refreshes until the funds run out; it NEVER
  //                                 sells an operator the player owns (§29.32: it used to shed the weakest hand piece,
  //                                 which is how the owner lost a key operator). Placement and equipment stay the
  //                                 player's (server/match/bot.js botSpendOnly). NOTE the hook: PREP start, not ROUND
  //                                 start — every action it takes is phase-gated (PlayerState `_gate` needs PREP) and
  //                                 onRoundStart runs while the match is still in ROUND_START. Same for freeLevelUps.
  //   onPick.item { id }            恶魔形态 (2026-10-13, §29.32): the card grants its own equipment 恶魔之契
  //                                 (`chess_item_9_91_e_a`, a CUSTOM_ITEMS record), which is what decides WHO the battle
  //                                 half buffs — it replaced "a random own operator" on the owner's request.
  //   demonForm { atkPctPerSec N }  恶魔形态 (battle): every own operator CARRYING 恶魔之契 gains +N % ATK every second,
  //                                 uncapped; no carrier on the field ⇒ no growth at all
  //   freeLevelUps { step N }       天人形态 (onPrepStart): N free 调度中心 levels, the count growing by N every
  //                                 round (1, 2, 3 …) until the cap (ctx.levelUpFree pays the price itself)
  //   serpentPoints { per N }       群蛇形态 (onSold): every sale banks N enemy-points (0.5)
  //   serpentArm true               群蛇形态 (onBattleStart): floor(points) × perPoint enemies are killed at that
  //                                 battle's start and those points are spent (the count rides the ref's params)
  //   serpentKills { perPoint N }   群蛇形态: the per-point kill rate, and the ref key that makes the card
  //                                 battle-visible (BATTLE_SPEC_KEYS)
  //
  // Ninth card (the owner's list of 2026-10-12, §29.24): 幽魂形态 grants the remake's OWN equipment 幽魂
  // (`item.id` names one items.json record outright — no roll, no pool). The item is authored in
  // tools/build-data.mjs (CUSTOM_ITEMS) because the official tables cannot describe it; its mechanic (阻挡数 0 +
  // every instance of damage taken capped at 100, 流失 included) lives in server/sim/content/items/battle.js
  // (`BY_ITEM['chess_item_9_90_e']`, the `hpLoss` hook of damage.js).
  //
  // Tenth batch (the owner's list of 2026-10-12, §29.27): two 3阶 cards, both engine-side (no `effect.battle` passive —
  // each is an ownership-only mechanic, so both keys MUST stay in BATTLE_SPEC_KEYS or the ref never reaches a battle):
  //   logos   { atkPct N, damage M }   逻各斯 (server/sim/content/hexcards/logos.js): an aura over every own operator's
  //                                    CURRENT attack range — an enemy inside it whose HP is below N% of that operator's
  //                                    ATK (unit.s.atk, every buff included) takes M 无来源 true damage. That instance
  //                                    (type 'true', sourceless, canDodge false, NOT isAttack) is what no 闪避 / 格挡 /
  //                                    未命中 can cancel. The retry rule is 逻各斯 S1 殁亡's own (op-logos.js): one try
  //                                    per enemy per entry into the range, and a survivor is never tried again.
  //   oneBody { dmgPct N }             你我一体 (server/sim/content/hexcards/onebody.js): identical operators fielded
  //                                    more than once (one base chess id) sum their max HP into ONE shared pool, and
  //                                    while two or more of them have attacked the same enemy each of their attacks on
  //                                    it deals N% (150%) damage.
  {
    id: 'hex_humanrite',
    name: '人祭',
    desc: '作战中，己方干员阵亡时，根据自身攻击力（0.5）和生命上限（0.8）召唤一只炎佑，场上最多同时存在 9 只。',
    rarity: 'prismatic',
    effect: { humanRite: { atkPct: 50, hpPct: 80, cap: 9 } },
  },
  {
    id: 'hex_debt',
    name: '债务',
    desc: '获得时选取一名队友，队友金钱+3，3回合内队友购买干员时你获得一个相同干员。',
    rarity: 'prismatic',
    effect: { onPick: { debt: { funds: 3, rounds: 3 } } },
  },
  {
    id: 'hex_rangedist',
    name: '近大远小',
    desc: '干员造成伤害时根据和敌人距离，伤害提升至180%－80%（最近时伤害最高，2格时伤害不变，3格时80%）。',
    rarity: 'gold',
    effect: { rangedist: { nearPct: 180, midPct: 100, farPct: 80 } },
  },
  {
    id: 'hex_minefield',
    name: '雷区',
    desc: '战斗开始时，在6个随机可部署地块，放置多萝西的2技能的召唤物地雷（地雷攻击力1000，命中后束缚5秒；只命中1名敌人时束缚10秒）。',
    rarity: 'silver',
    effect: { minefield: { count: 6, atk: 1000, bind: 5, bindSingle: 10 } },
  },
  {
    id: 'hex_breaker',
    name: '破隐',
    desc: '敌人隐匿效果失效',
    rarity: 'silver',
    effect: { breaker: true },
  },
  {
    id: 'hex_neurotoxin',
    name: '神经毒素',
    desc: '干员攻击使目标中毒，在3秒内每秒受到115+2％目标最大生命（不可叠加，伤害最高为1万）点法术伤害。',
    rarity: 'gold',
    effect: { neurotoxin: { flat: 115, pct: 2, seconds: 3, cap: 10000 } },
  },
  {
    id: 'hex_ricochet',
    name: '跳弹',
    desc: '远程干员的远程攻击在命中敌人后，会弹射到最近的敌人，每次弹射伤害衰减30%。弹射次数等于已激活精准盟约层数÷20+1（向下取整，上限6次）。',
    rarity: 'gold',
    effect: { ricochet: { falloffPct: 30, layersPerBounce: 20, maxBounces: 6 } },
  },
  // ---- eighth batch (the owner's list of 2026-10-12, §29.23): five 3阶 「形态」 cards -------------------------------
  {
    id: 'hex_echoform',
    name: '回响形态',
    desc: '作战中，己方所有干员的技能额外获得 1 次充能上限；原本不能蓄力的技能也可以蓄力 1 次。',
    rarity: 'prismatic',
    effect: { battle: { extraCharges: 1 } },
  },
  {
    id: 'hex_voidform',
    name: '虚空形态',
    desc: '获得时立即清空你的资金；从下回合开始，每回合第一次花费资金时不消耗。',
    rarity: 'prismatic',
    effect: { onPick: { zeroFunds: true }, onRoundStart: { freeSpendArm: true }, onSpend: { freeSpendRefund: true } },
  },
  {
    id: 'hex_demonform',
    name: '恶魔形态',
    desc: '获得时立即得到装备【恶魔之契】。每隔一回合，休整期的资金由瓦库接管：优先升级调度中心（有钱就升），再购买干员并刷新，直到没钱为止。作战中，装备【恶魔之契】的己方干员每过一秒攻击力 +10%（本场战斗内叠加，无上限）。',
    rarity: 'prismatic',
    effect: {
      onPick: { item: { id: 'chess_item_9_91_e_a', count: 1 } },
      onPrepStart: { everyPreps: 2, demonTakeover: true },
      demonForm: { atkPctPerSec: 10 },
    },
  },
  {
    id: 'hex_heavenform',
    name: '天人形态',
    desc: '每回合开始时免费升级调度中心：第一次 +1 级，此后每次比上次多 1 级（+2、+3…），直到满级。',
    rarity: 'prismatic',
    effect: { onPrepStart: { freeLevelUps: { step: 1 } } },
  },
  {
    id: 'hex_serpentform',
    name: '群蛇形态',
    desc: '每卖出一个干员累积 0.5 个敌人；战斗开始时，按累积的整数部分每 1 个敌人杀死 1 个敌人，并扣掉这部分累积。',
    rarity: 'prismatic',
    effect: {
      onSold: { serpentPoints: { per: 0.5 } },
      onBattleStart: { serpentArm: true },
      serpentKills: { perPoint: 1 },
    },
  },
  {
    id: 'hex_ghostform',
    name: '幽魂形态',
    desc: '获得时立即得到装备【幽魂】：阻挡数变为 0，每次受到的伤害不超过 100。',
    rarity: 'prismatic',
    effect: { onPick: { item: { id: 'chess_item_9_90_e_a', count: 1 } } },
  },
  // ---- tenth batch (the owner's list of 2026-10-12, §29.27): two 3阶 cards -------------------------------------
  // Both are ENGINE-side, each a module under server/sim/content/hexcards/ dispatched by installHexCards:
  //   logos   { atkPct, damage }   逻各斯: an AURA over every own operator's attack range — an enemy inside it whose
  //                                current HP is below atkPct% of that operator's ATK is struck for `damage` (9999999)
  //                                无来源 true damage, whatever the operator is doing (no attack needed). The retry rule
  //                                is 逻各斯 S1 殁亡's own (op-logos.js): one try per enemy per entry into the range, and
  //                                an enemy that SURVIVED one (不死, a 频次 unit, 限伤 on a leader) is never tried again.
  //   oneBody { dmgPct }           你我一体: identical operators (one base chess id, fielded more than once) have their
  //                                max HP SUMMED into a pool they share; while two or more of them have attacked the
  //                                same enemy, each of their attacks on it deals dmgPct% (150%) damage.
  {
    id: 'hex_logos',
    name: '逻各斯',
    desc: '作战中，己方干员的攻击范围内，生命值低于该干员攻击力 120% 的敌人立刻倒下：造成 9999999 点无来源真实斩杀伤害，无法被闪避、格挡或未命中取消。此效果为光环效果，不依赖攻击行为。',
    rarity: 'prismatic',
    effect: { logos: { atkPct: 120, damage: 9999999 } },
  },
  {
    id: 'hex_onebody',
    name: '你我一体',
    desc: '作战中，你场上相同的干员生命上限叠加、生命共享；这些干员攻击同一名敌人时，伤害提高至 150%。',
    rarity: 'prismatic',
    effect: { oneBody: { dmgPct: 150 } },
  },
  // ---- eleventh batch (the owner's own list of 2026-10-13, §29.34): 13 more player hexes ---------------------------
  // The names, tiers and effects are the owner's list; the `desc` keeps the owner's own wording (only the shorthand
  // 「给三个转职球」-style lines are spelled out as the grant they mean). The spec keys this batch introduces, each
  // documented beside its reader in server/sim/content/hextech.js / server/match/*.js:
  //
  //   bondLayerViewPct N              圣约回响: bond-LAYER thresholds and milestones read a VIEW of the layer count
  //                                   scaled by (1 + N/100); the stored layers never move (盟约 activation itself is a
  //                                   MEMBER count and is deliberately untouched).
  //   onRefresh.miracleZeroCostPct    电表倒转·改: on a FREE refresh (奇迹), that percentage chance that every operator
  //                                   this refresh shows costs 0 funds. [ASSUMED: 「奇迹」 is the owner's name for the
  //                                   free refresh the 奇迹 bond hands out, so the trigger is "this refresh was free".]
  //   prismLayers { per }             盟约棱镜: each round start, once per DISTINCT non-core bond among the board
  //                                   operators, +per layers to every CORE bond.
  //   onSold.eliteGrant { funds }     紧急拨款: selling an ELITE operator pays `funds` at once and arms the next
  //                                   refresh's guaranteed slot (`onRefresh.eliteGrantRefresh` spends the arm).
  //   bondEqualize true               均衡盟约: each round start, every ACTIVE bond that HOLDS layers gets the
  //                                   rounded-up average of THEIR total (向上取整). A bonds.json `noStack` bond
  //                                   (独行 / 绝技 / 调和 / 协防干员) is out of both sides of the sum — its layers are
  //                                   never shown, so a share handed to it would be invisible AND unspendable
  //                                   (业主 2026-10-14: 「不应该均衡绝技和独行这种层数没意义的」).
  //   lastDitch { lpBelow, layerMul, freeRefresh }
  //                                   背水一战: while the own LP is BELOW lpBelow, every bond layer gain is ×layerMul
  //                                   (prep: `layerGainMulOf`; battle: the `layerGain` hook, armed per battle by
  //                                   `onBattleStart.lastDitchArm` — the sim has no LP, so the match stamps whether the
  //                                   window is open) and the first refresh of each round is free
  //                                   (`onRoundStart.lastDitchRefresh`).
  //   onBattleStart.parasiteLayers { per }
  //                                   盟约寄生: at battle start, +per layers to the highest ACTIVE bond for every chess in
  //                                   the 整备区 (the hand — 备战区 read as the bench, [ASSUMED]). Hook-declared like
  //                                   层数转移: it patches the battle input's own bonds snapshot, so the ref stays
  //                                   prep-side.
  //   onMerge.eliteBondGrant true     三连透支: merging an elite operator grants one ELITE operator carrying the board's
  //                                   most numerous bond, then the card lapses FOR THAT ROUND (the counter is keyed by
  //                                   the round number, like 配给制's sell cap, so it re-arms next round).
  //   shopTune { refreshPrice, buyDiscount, firstRefreshTopBond }
  //                                   升级刷新: the refresh costs `refreshPrice` funds (`PlayerState.refreshPriceNow`),
  //                                   every operator costs `buyDiscount` less (`onPrice.shopTunePrice`), and the first
  //                                   refresh of each round shows one operator of the own most-numerous bond
  //                                   (`onRefresh.shopTuneRefresh`).
  //   后勤整备-style item grants      转职大师 / 赌狗大师 / 人力部资源 / 博士投影: the plain `item { id, count }` shape
  //                                   (【变形同构体】 is the item players call 转职球 — docs/history/0.1.1.md §21.7).
  {
    id: 'hex_covenantecho',
    name: '圣约回响',
    desc: '你的「盟约」叠层在判定阈值奖励时额外视为 +50%（不改变实际层数）。',
    rarity: 'prismatic',
    effect: { bondLayerViewPct: 50 },
  },
  {
    id: 'hex_meterflip',
    name: '电表倒转·改',
    desc: '当你触发「奇迹」（免费刷新）时，有 15% 概率使本次刷新出现的干员费用变为 0。',
    rarity: 'gold',
    effect: { onRefresh: { miracleZeroCostPct: 15 } },
  },
  {
    id: 'hex_bondprism',
    name: '盟约棱镜',
    desc: '每回合开始时，你场上非核心盟约每有一个不同阵营，你的核心盟约层数 +3。',
    rarity: 'gold',
    effect: { onRoundStart: { prismLayers: { per: 3 } } },
  },
  {
    id: 'hex_emergencygrant',
    name: '紧急拨款',
    // Owner's rebalance of 2026-10-15: the payout is 2 funds (was 6). The rest of the card is unchanged.
    desc: '每当你卖出一名精锐（三星）干员，立刻获得 2 资金；下一次刷新必定出现你场上人数最多盟约的干员。',
    rarity: 'gold',
    effect: { onSold: { eliteGrant: { funds: 2 } }, onRefresh: { eliteGrantRefresh: true } },
  },
  {
    id: 'hex_bondequalize',
    name: '均衡盟约',
    desc: '每回合开始时，所有已激活盟约的层数均摊（总值 ÷ 已激活数量，向上取整；不显示层数的盟约不参与）。',
    rarity: 'gold',
    effect: { onRoundStart: { bondEqualize: true } },
  },
  {
    id: 'hex_lastditch',
    name: '背水一战',
    desc: '目标生命值低于 5 时，所有盟约的叠层速度翻倍，且每回合第一次刷新免费。',
    rarity: 'gold',
    effect: {
      lastDitch: { lpBelow: 5, layerMul: 2, freeRefresh: true },
      onRoundStart: { lastDitchRefresh: true },
      onBattleStart: { lastDitchArm: true },
    },
  },
  {
    id: 'hex_bondparasite',
    name: '盟约寄生',
    desc: '战斗开始时，你的整备区每有一名干员，你层数最高的已激活盟约 +2 层。',
    rarity: 'silver',
    // The hook-declared shape (like 层数转移's `onBattleStart.layerTransfer`): the mechanic patches the battle input's
    // OWN bonds snapshot, so the ref never needs to reach the sim and the card is NOT a BATTLE_SPEC_KEYS entry.
    effect: { onBattleStart: { parasiteLayers: { per: 2 } } },
  },
  {
    id: 'hex_tripleoverdraft',
    name: '三连透支',
    desc: '你合成精锐干员时，随机获得一名你场上人数最多盟约的精锐干员，然后本回合失效。',
    rarity: 'gold',
    effect: { onMerge: { eliteBondGrant: true } },
  },
  {
    id: 'hex_upgraderefresh',
    name: '升级刷新',
    desc: '刷新费用变为 2 资金；购买干员所需费用 −1；每回合第一次刷新必定出现一名你场上人数最多盟约的干员。',
    rarity: 'gold',
    effect: {
      shopTune: { refreshPrice: 2, buyDiscount: 1, firstRefreshTopBond: true },
      onRefresh: { shopTuneRefresh: true },
      onPrice: { shopTunePrice: true },
    },
  },
  {
    id: 'hex_mastermorph',
    name: '转职大师',
    desc: '获得时立即得到 3 件【变形同构体】（转职球）。',
    rarity: 'gold',
    effect: { onPick: { item: { id: 'chess_item_6_09_e_a', count: 3 } } },
  },
  {
    id: 'hex_mastergamble',
    name: '赌狗大师',
    desc: '获得时立即得到 2 件【拟态物质】。',
    rarity: 'gold',
    effect: { onPick: { item: { id: 'chess_item_5_05_e_a', count: 2 } } },
  },
  {
    id: 'hex_hrsupply',
    name: '人力部资源',
    desc: '获得时立即得到 1 件【人事部文档】。',
    rarity: 'gold',
    effect: { onPick: { item: { id: 'chess_item_6_08_e_a', count: 1 } } },
  },
  {
    id: 'hex_docproject',
    name: '博士投影',
    desc: '获得时立即得到 1 件【博士投影】。',
    rarity: 'gold',
    effect: { onPick: { item: { id: 'chess_item_5_06_e_a', count: 1 } } },
  },
  // ---- tenth batch (the owner's list of 2026-10-15): 13 more player hexes ----
  {
    id: 'hex_weaponmaster',
    name: '武器大师',
    desc: '获得时立即得到装备【天马之盔】与【天马之枪】各一件。',
    rarity: 'gold',
    // item.ids (added for this card): one of EACH named record, in order — the single-id form cannot hand out two
    // different pieces, and the pool/tier forms roll. Both ids are official 5/6 阶 equipment (items.json).
    effect: { onPick: { item: { ids: ['chess_item_5_09_e_a', 'chess_item_6_01_e_a'] } } },
  },
  {
    id: 'hex_beacon',
    name: '共享信标',
    desc: '获得时你和所有队友各得到装备【信标】一件。',
    rarity: 'silver',
    // team: true — every alive teammate runs the same handler through its OWN ctx, so each keeps its own copy
    // (the mechanism 共鸣协议 / 战争机器 use).
    effect: { team: true, onPick: { item: { id: 'chess_item_5_04_e_a', count: 1 } } },
  },
  {
    id: 'hex_pandora',
    name: '潘多拉魔盒',
    desc: '获得时，将你已拥有的所有协议源石（含本张）随机更换为 3 阶协议源石。',
    rarity: 'prismatic',
    effect: { onPick: { pandora: true } },
  },
  {
    id: 'hex_blockwall',
    name: '挡挡',
    desc: '不屈盟约的层数超过 100 层后，不屈干员阻挡数 +1；此后每多出 150 层，阻挡数再 +1。',
    rarity: 'silver',
    effect: { blockwall: { base: 100, step: 150 } },
  },
  {
    id: 'hex_sharepain',
    name: '不区区！',
    desc: '作战中，不屈干员会为其他干员分担 50% 的伤害。',
    rarity: 'gold',
    effect: { sharePain: { pct: 50 } },
  },
  {
    id: 'hex_terramourn',
    name: '泰拉在上',
    desc: '作战中，己方干员阵亡时对周围 8 格造成其攻击力 200% 的法术伤害，并附加灼燃损伤。',
    rarity: 'gold',
    effect: { deathBlast: { atkPct: 200, radius: 1 } },
  },
  {
    id: 'hex_directive',
    name: '指令之意',
    desc: '作战开始时随机指定一种职业，该职业的己方干员攻击力 +50%。',
    rarity: 'gold',
    effect: { directiveAtk: { atkPct: 50 } },
  },
  {
    id: 'hex_directive2',
    name: '指令之意·改',
    desc: '作战开始时随机指定一种伤害类型，己方干员造成该类型伤害时提升至 150%。',
    rarity: 'prismatic',
    effect: { directiveType: { mul: 150 } },
  },
  {
    id: 'hex_bigdiscount',
    name: '可露希尔大降价',
    desc: '获得时，本回合内接下来 3 次刷新免费，且购买干员与装备免费。',
    rarity: 'gold',
    effect: { onPick: { discount: { refreshes: 3, buys: 3 } } },
  },
  {
    id: 'hex_rabbithead',
    name: '兔头',
    desc: '作战中，己方攻击力最高的干员攻击力 +50%，攻击力最低的干员攻击力 −30%。',
    rarity: 'silver',
    effect: { rabbitHead: { top: 50, bottom: -30 } },
  },
  {
    id: 'hex_profresonance',
    name: '职业共鸣',
    desc: '作战中，每有一名与自身相同职业的己方干员，该干员攻击力与防御力 +10%。',
    rarity: 'silver',
    effect: { profResonance: { pct: 10 } },
  },
];

/**
 * The 24 enemy hexes. Two shapes (DESIGN §29.10):
 *
 *  * **`mods`** — the wave vocabulary (server/match/waves.js roundMods): hpMul / atkMul / defMul / resMul / speedMul /
 *    supplyHpMul, plus `countAdd` (the spawn fold adds that many enemies per normal group). Folded into a battle's spawn
 *    list where the wave is built, so it needs no flag.
 *  * **`verb`** — a script (`server/sim/content/hextech.js installEnemyVerbs`), with its tuning in `params`. The ids
 *    travel on `flags.enemyHexIds` (server/match/match/combat.js newBattle). Before this batch every enemy card was a
 *    multiplier, which is why the enemy side read as "a bit more HP / ATK / speed" no matter the draw.
 *
 * The leader's shared HP pool is never scaled by hpMul (waves.js:339), so the pools the Final Assault and the Hidden
 * Core fight over come from the official table only. `payout` is what the players are paid at settlement (过路费).
 *
 * Two verb cards carry an owner's gate beyond their `params` (both read the unit, not the record): 隐匿 (§29.29) never
 * opens on a 器物 / 次数怪, and 回响 (§29.33) never splits one — 木制瑞印 and its 13 siblings are hit-count objects, so a
 * copy is neither a body nor an enemy the stage scheduled (`isHitCount`, server/sim/content/enemies/helpers.js).
 */
// 铁壁 (owner's rebalance of 2026-10-14, §29.39): the reflect is a share of the ENEMY'S OWN ATK (20 %), not of the
// damage it just took — the card no longer scales with the player's own damage output, and a high-DEF operator is no
// longer punished into the 5 % mitigation floor (§29.15).
export const ENEMY_HEXES = [
  {
    id: 'ehex_corrode',
    name: '腐蚀甲壳',
    desc: '敌人最大生命值 +8%。',
    rarity: 'silver',
    mods: { hpMul: 1.08 },
  },
  {
    id: 'ehex_fang',
    name: '尖牙',
    desc: '敌人攻击力 +8%。',
    rarity: 'silver',
    mods: { atkMul: 1.08 },
  },
  {
    id: 'ehex_swift',
    name: '疾行',
    desc: '敌人移动速度 +8%。',
    rarity: 'silver',
    mods: { speedMul: 1.08 },
  },
  {
    id: 'ehex_hard',
    name: '硬化外壳',
    desc: '敌人防御力 +15%。',
    rarity: 'silver',
    mods: { defMul: 1.15 },
  },
  {
    id: 'ehex_ward',
    name: '源石抗性',
    desc: '敌人法术抗性 +15%。',
    rarity: 'silver',
    mods: { resMul: 1.15 },
  },
  {
    id: 'ehex_rations',
    name: '补给充盈',
    desc: '本回合的器物需要更多次击打才能击破。',
    rarity: 'silver',
    mods: { supplyHpMul: 1.10 },
  },
  {
    id: 'ehex_blood',
    name: '血怒',
    desc: '敌人最大生命值 +15%。',
    rarity: 'gold',
    mods: { hpMul: 1.15 },
  },
  {
    id: 'ehex_fury',
    name: '狂攻',
    desc: '敌人攻击力 +15%。',
    rarity: 'gold',
    mods: { atkMul: 1.15 },
  },
  {
    id: 'ehex_siege',
    name: '攻城训练',
    desc: '敌人最大生命值 +10%、防御力 +20%。',
    rarity: 'gold',
    mods: { hpMul: 1.10, defMul: 1.20 },
  },
  {
    id: 'ehex_hunt',
    name: '猎杀本能',
    desc: '敌人攻击力 +10%、移动速度 +10%。',
    rarity: 'gold',
    mods: { atkMul: 1.10, speedMul: 1.10 },
  },
  {
    id: 'ehex_abyss',
    name: '深渊灌注',
    desc: '敌人最大生命值 +25%、攻击力 +15%。',
    rarity: 'prismatic',
    mods: { hpMul: 1.25, atkMul: 1.15 },
  },
  {
    id: 'ehex_colossus',
    name: '巨兽之魂',
    desc: '敌人最大生命值 +35%、移动速度 +10%，器物需要更多次击打。',
    rarity: 'prismatic',
    mods: { hpMul: 1.35, speedMul: 1.10, supplyHpMul: 1.20 },
  },
  // ---- second batch (0.3.0 playtest #2): the first enemy verbs beyond plain multipliers ------------------
  {
    id: 'ehex_swarm',
    name: '虫群',
    desc: '敌人数量增加，但最大生命值 −8%。',
    rarity: 'gold',
    mods: { countAdd: 1, hpMul: 0.92 },
  },
  {
    id: 'ehex_toll',
    name: '过路费',
    desc: '敌人最大生命值 +20%；你每漏掉 1 个敌人，下回合开始时得到 1 资金。',
    rarity: 'prismatic',
    mods: { hpMul: 1.20 },
    payout: { perLeak: 1 },
  },
  // ---- third batch (0.3.0 playtest #4): the first enemy VERBS (DESIGN §29.10) -------------------------
  // `verb` names a script in server/sim/content/hextech.js `installEnemyVerbs`; the ids ride into every battle on
  // `flags.enemyHexIds` (server/match/match/combat.js newBattle). `params` tunes the script. None of them carries
  // `hpMul`, so the cumulative-HP bound of test/content/hextech.test.js is untouched.
  {
    id: 'ehex_deathrattle',
    name: '亡语',
    desc: '敌人被击倒时，对周围四格内的我方干员造成其攻击力 120% 的法术伤害。',
    rarity: 'silver',
    verb: 'deathrattle',
    params: { ratio: 1.2, shape: 'plus', radius: 1 },
  },
  {
    id: 'ehex_armorbreak',
    name: '破甲弹',
    desc: '敌人的物理攻击命中我方干员时，使该干员防御力 −25，本场战斗内叠加，最多 8 层。',
    rarity: 'silver',
    verb: 'armorbreak',
    params: { flat: 25, max: 8 },
  },
  {
    id: 'ehex_venom',
    name: '淬毒',
    desc: '敌人的攻击额外附带其攻击力 8% 的侵蚀元素损伤。',
    rarity: 'silver',
    verb: 'venom',
    params: { ratio: 0.08, element: 'erosion' },
  },
  {
    id: 'ehex_ironwall',
    name: '铁壁',
    // 业主 2026-10-16：反弹比例 20% → **10%**（sim 侧 content/hextech.js 的 ironwall() 缺省值同步改）。
    desc: '敌人受到物理伤害时，向攻击者反弹其攻击力 10% 的伤害。',
    rarity: 'silver',
    verb: 'ironwall',
    params: { ratio: 0.1 },
  },
  {
    id: 'ehex_corrodefield',
    name: '腐蚀领域',
    desc: '每 4 秒在我方一名干员脚下生成腐蚀区域，2 秒后爆炸，对范围内我方干员造成 80+25x 点真实伤害（x 为当前回合数）。',
    rarity: 'gold',
    verb: 'corrode',
    params: { period: 4, fuse: 2, radius: 1.5, damage: 80, damagePerRound: 25 },
  },
  {
    id: 'ehex_bloodthirst',
    name: '嗜血',
    desc: '敌人造成伤害时，回复该次伤害量 40% 的生命值。',
    rarity: 'gold',
    verb: 'bloodthirst',
    params: { ratio: 0.4 },
  },
  {
    id: 'ehex_frenzy',
    name: '狂化',
    desc: '敌人生命值低于 50% 时，攻击速度 +70。',
    rarity: 'gold',
    verb: 'frenzy',
    params: { thresholdPct: 50, aspd: 70 },
  },
  {
    id: 'ehex_stealth',
    name: '隐匿',
    desc: '仅地面非首领敌人开场处于隐匿状态；被阻挡时解除，脱离阻挡 3 秒后恢复。',
    rarity: 'gold',
    verb: 'stealth',
    params: { restore: 3 },
  },
  {
    id: 'ehex_echo',
    name: '回响',
    // 业主 2026-10-16：分裂体的**攻击力减半**（sim 侧 content/hextech.js 的 echo() 里对 k.s.atk 与 k.base.atk 各乘 0.5）。
    desc: '敌人被击倒时，有 10%+10x% 的概率分裂成 2 个生命值为其 50%、攻击力减半的同种敌人，并继续沿原路线前进（x 为当前回合数；器物不受影响）。',
    rarity: 'prismatic',
    verb: 'echo',
    params: { count: 2, hpRatio: 0.5, atkRatio: 0.5, chance: 0.1, chancePerRound: 0.1 },
  },
  {
    id: 'ehex_banner',
    name: '军旗',
    desc: '每有 1 名敌人被击倒，其余敌人的攻击力 +2%（本场战斗内叠加，最多 +40%）。',
    rarity: 'prismatic',
    verb: 'banner',
    params: { atkPct: 2, max: 40 },
  },
  // ---- ninth batch (the owner's list of 2026-10-15): 14 enemy cards ----
  {
    id: 'ehex_mosaic',
    name: '情报部抑制',
    desc: '给画面加一层马赛克滤镜。',
    rarity: 'prismatic',
    verb: 'mosaic',
  },
  {
    id: 'ehex_records',
    name: '记录部抑制',
    desc: '每 4 回合，修整期部署干员时减少 1 点策略生命。',
    rarity: 'prismatic',
    verb: 'records',
    params: {"everyRounds":4,"lp":1},
  },
  {
    id: 'ehex_leine',
    name: '莱茵护甲',
    desc: '敌人获得一层次数盾（可抵挡 3 次攻击）。',
    rarity: 'silver',
    verb: 'hitShield',
    params: {"hits":3},
  },
  {
    id: 'ehex_unstoppable',
    name: '势不可挡',
    desc: '敌人所需的阻挡数 +1，但移动速度降低 50%。',
    rarity: 'prismatic',
    verb: 'blockDemand',
    params: {"add":1},
    mods: {"speedMul":0.5},
  },
  {
    id: 'ehex_scavenge',
    name: '食尸',
    desc: '敌人死亡时，治疗附近敌人其最大生命值 5% 的生命。',
    rarity: 'gold',
    verb: 'cannibalize',
    params: {"pct":5,"radius":1},
  },
  {
    id: 'ehex_hush',
    name: '静默',
    desc: '每过 35 秒，我方随机 1 名干员受到 1000 点凋亡损伤。',
    rarity: 'prismatic',
    verb: 'silence',
    params: {"period":35,"damage":1000},
  },
  {
    id: 'ehex_gravewound',
    name: '重伤',
    desc: '敌人的攻击使我方干员受到的受治疗量降低 20%，持续 4 秒。',
    rarity: 'gold',
    verb: 'healCut',
    params: {"pct":20,"seconds":4},
  },
  {
    id: 'ehex_elite',
    name: '精英化',
    desc: '敌人数量减少 10%，但攻击力、防御力和生命力上升 30%。',
    rarity: 'silver',
    mods: {"atkMul":1.3,"defMul":1.3,"hpMul":1.3,"countSub":1},
  },
  {
    id: 'ehex_adaptive',
    name: '自适应',
    desc: '敌人每次受到攻击提高 2% 防御力，最高 30%。',
    rarity: 'silver',
    verb: 'adaptive',
    params: {"perHit":2,"max":30},
  },
  {
    id: 'ehex_transmute',
    name: '物转法',
    desc: '物理敌人攻击力降低 30%，但是造成法术伤害。',
    rarity: 'gold',
    verb: 'transmute',
    mods: {"atkMul":0.7},
  },
  {
    id: 'ehex_brittle',
    name: '易碎铠甲',
    desc: '出场敌人防御力提高 50%，移动速度降低 20%，每次受到攻击降低 5% 防御力（至多降低至原值）。',
    rarity: 'silver',
    verb: 'brittleArmor',
    params: {"defPct":50,"speedPct":20,"shavePct":5},
  },
  {
    id: 'ehex_restless',
    name: '无头苍蝇',
    desc: '敌人移动速度增加 50%，但是每过 10 秒受到一次 2 秒恐惧（boss 和隐匿敌人除外）。',
    rarity: 'silver',
    verb: 'restless',
    params: {"period":10,"seconds":2},
    mods: {"speedMul":1.5},
  },
  {
    id: 'ehex_drowse',
    name: 'zzz',
    desc: '每过 20 秒，我方随机 1 名干员陷入沉睡 2 秒。',
    rarity: 'gold',
    verb: 'drowse',
    params: {"period":20,"seconds":2},
  },
  {
    id: 'ehex_originium',
    name: '源石附身',
    desc: '敌人获得活性原石效果。',
    rarity: 'silver',
    verb: 'originium',
    params: {"duration":200,"atkPct":50,"aspd":40,"dps":40},
  },
];

/**
 * The one piece of that third-party pack the project still unpacks: the two draft sound cues (tools/hextech-import.mjs,
 * `hextech/audio`). Its rune icons (`hextech/relic`), rarity frames (`hextech/frame`) and button sprites (`hextech/ui`)
 * were removed on 2026-10-12 — the card face is the owner's own 阶位 art, so they were at most an invisible fallback.
 * `key` is the WAV basename inside HextechRunes.pck `audio/`.
 */
export const UI_AUDIO = [
  { name: 'reroll', key: 'hextechReroll' },
  { name: 'selectGold', key: 'hextechSelectGold' },
];
