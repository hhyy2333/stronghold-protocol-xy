// test/match/hex-owner-2026-11-01.test.js — 业主 2026-11-01 报的四条，全部在 match 侧：
//   1. 【复制】复制出来的 **team 卡**（三阶【战争机器】）只给复制者发，队友拿不到第二次 +5 目标生命；
//   2. 【绿洲】的层数里程碑（60 层给缇缇、325 层给黄沙罗盘）有时候要拖到下一回合才发 —— 而且被【复制】/策略「管理员」
//      复制后会重复发；
//   3. 协议源石（海克斯）发的钱不该计入协议等级 19 的「一回合最多获得 30 资金」上限；
//   4. 【特限恢复】二阶新效果：有特限模组（ISW / SO / RA）的干员购买价格 −2，最低 1。
//
// 沙箱里 `node --test` 会 spawn EPERM，用等价方式跑：`node test/match/hex-owner-2026-11-01.test.js`。
//
// 用到的真数据（data/hextech.json，roster 生成）：hex_warmachine（team:true, onPick.lp 5）、hex_replicate
// （onPick.copyOwnedHex）、hex_sargon_oasis（onLayers.layerGift，60/325）、hex_stipend（onPick.funds 3）、
// hex_recovery（onBattleResult.perLpLoss 2 / firstLeak 2）、hex_massprod（onPick.chess + onRoundStart.chess）、
// hex_mode_modules（onPrice.specialLimitDiscount −2 / min 1 / types ISW,SO,RA）。

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeMatch, DATA } from './harness.js';
import { applyHex, specialLimitPriceOf, specialLimitDiscountOf, hasSpecialLimitModule } from '../../server/match/hextech.js';

const HEX = (DATA.hextech && DATA.hextech.playerHexes) || {};
const WARMACHINE = HEX.hex_warmachine;      // 三阶 / team: onPick.lp +5（本人 + 每个存活队友）
const REPLICATE = HEX.hex_replicate;        // 二阶 / 复制: onPick.copyOwnedHex
const OASIS = HEX.hex_sargon_oasis;         // 二阶 / 绿洲: onLayers.layerGift（60 层缇缇 / 325 层黄沙罗盘）
const STIPEND = HEX.hex_stipend;            // 一阶 / 战备津贴: onPick.funds 3（协议源石发钱）
const RECOVERY = HEX.hex_recovery;          // 一阶 / 战损回收: onBattleResult → pendingFunds（协议源石发钱，下回合到账）
const MASSPROD = HEX.hex_massprod;          // 二阶 / 量产线: onPick.chess + onRoundStart.chess
const MODE_MODULES = HEX.hex_mode_modules;  // 二阶 / 特限恢复

const TITI = 'chess_char_5_02_a';           // 缇缇（绿洲 60 层）
const COMPASS = 'chess_item_6_07_e_a';      // 黄沙罗盘（绿洲 325 层）
const SWIRE2 = 'chess_char_3_04_a';         // 琳琅诗怀雅（有 ISW-A 特限模组，tier 3 = 3 资金）
const INSIDE = 'chess_char_1_01_a';         // 隐现（没有特限模组，tier 1 = 2 资金）

/** A fresh coop match (humans + bots as asked), driven to PREP R1. */
function prep({ humans = 1, bots = 1, difficulty = 'NORMAL', protocolLevel = null, seed = 9 } = {}) {
  const h = makeMatch({ mode: 'coop', difficulty, humans, bots, seed, fake: true, ...(protocolLevel ? { protocolLevel } : null) }).start();
  h.toPrep(1);
  return { h, m: h.m };
}
/** 只留下这一张卡：第 1 回合的协议源石抽卡是随机发给每个座位的，抽到别的卡会干扰「复制挑哪一张」的确定性。 */
function onlyOwn(ps, hexId) {
  ps.effects = (ps.effects || []).filter((e) => e && e.data && e.data.hexId === hexId);
  return ps;
}
/**
 * 把这张卡标成**自选**（业主 2026-11-04「让协议源石复制只能复制自选协议」）。
 *
 * 正式路径上只有协议源石抽卡的 `g.hex` 会写 `data.selfPicked`（`hexDraft.js _applyHex` 传 `selfPicked: true`）。
 * 这些用例是在**已经开好的对局里**直接 `applyHex` 塞卡，所以「我挑的」这件事要自己标一下，否则【复制】按新口径
 * 认为它不是我选的、拒绝复制 —— 那是另一条用例（见文件末尾「只能复制自选协议」那一组）。
 */
function markSelfPicked(ps, hexId) {
  for (const e of ps.effects || []) if (e && e.data && e.data.hexId === hexId) e.data.selfPicked = true;
  return ps;
}
const lp = (ps) => ps.lp;
const countChess = (ps, id) => ps.allChess().filter((p) => p.id === id).length;
const countItems = (ps, id) => [...(ps.hand || []), ...(ps.temp || [])].filter((p) => p && p.kind === 'item' && p.id === id).length;
const refIds = (ps) => (ps.effects || []).map((e) => e.id);

// =====================================================================================================================
// 1. 【复制】复制 team 卡：每个队友都要再拿一次（业主：三阶【战争机器】被复制后队友没拿到第二次 +5 目标生命）
// =====================================================================================================================

test('【复制】复制 team 卡【战争机器】：复制者与每个存活队友各再 +5 目标生命，各拿一份第二 ref；复制自身消失', () => {
  const { m } = prep({ humans: 2, bots: 0 });
  const p0 = m.players.get('p_0'), p1 = m.players.get('p_1');
  // 先正常获得【战争机器】（team: 本人 + 队友各 +5）
  const base = [lp(p0), lp(p1)];
  applyHex(m, p0, WARMACHINE);
  assert.deepEqual([lp(p0) - base[0], lp(p1) - base[1]], [5, 5], '获得时本人与队友各 +5');
  // 复制只挑「已经拥有的别的卡」：把两人的收藏清到只剩【战争机器】，让选择确定
  onlyOwn(p0, 'hex_warmachine');
  onlyOwn(p1, 'hex_warmachine');
  // 业主 2026-11-04 之后【复制】只认自选卡：这里的【战争机器】是测试直接塞进 p0 的，标成自选才符合「我挑的那张」
  markSelfPicked(p0, 'hex_warmachine');
  // 再获得【复制】：候选只有【战争机器】一张（复制自己不算），于是复制它的 team 半段
  const before = [lp(p0), lp(p1)];
  applyHex(m, p0, REPLICATE);
  assert.deepEqual([lp(p0) - before[0], lp(p1) - before[1]], [5, 5], '复制出来的 team 卡也要给队友发（修复前队友是 0）');
  // 两个人都拿到第二份 ref（复制 = 同一张卡的第二个 EffectRef）
  assert.ok(refIds(p0).includes('hex:hex_warmachine#2'), '复制者拿到第二份 ref');
  assert.ok(refIds(p1).includes('hex:hex_warmachine#2'), '队友也拿到第二份 ref');
  // 复制者自己只发一次：+5 不是 +10
  assert.equal(lp(p0) - before[0], 5, '复制者自己只发一次');
  // 「自身消失」不变
  assert.ok(!refIds(p0).some((id) => id.startsWith('hex:hex_replicate')), '复制自身从复制者的收藏里消失');
  assert.ok(!refIds(p1).some((id) => id.startsWith('hex:hex_replicate')), '复制不会留在队友身上');
  m.dispose();
});

test('【复制】不发给已经死亡的队友（team 卡的 targets = 复制者 + 存活队友）', () => {
  const { m } = prep({ humans: 2, bots: 0 });
  const p0 = m.players.get('p_0'), p1 = m.players.get('p_1');
  applyHex(m, p0, WARMACHINE);
  onlyOwn(p0, 'hex_warmachine');
  onlyOwn(p1, 'hex_warmachine');
  markSelfPicked(p0, 'hex_warmachine');
  const p1Lp = lp(p1);
  p1.eliminate(1); // 队友出局
  assert.equal(p1.alive, false);
  const before = lp(p0);
  applyHex(m, p0, REPLICATE);
  assert.equal(lp(p0) - before, 5, '复制者自己照常 +5');
  assert.equal(lp(p1), p1Lp, '死掉的队友不再发（连 ref 也不加）');
  assert.ok(!refIds(p1).includes('hex:hex_warmachine#2'));
  m.dispose();
});

// =====================================================================================================================
// 2. 【绿洲】层数里程碑：过线那一刻就发（含「获得时层数已经过线」），同一 rung 只发一次、复制不重复发
// =====================================================================================================================

test('【绿洲】获得时层数已经过线：60 层的缇缇当场就到手（修复前要等下一次加层 / 下一回合）', () => {
  const { m } = prep();
  const ps = m.players.get('p_0');
  ps.layers.sargonShip = 61;
  ps.recompute();
  assert.equal(countChess(ps, TITI), 0, '前提：还没有缇缇');
  applyHex(m, ps, OASIS);
  assert.equal(countChess(ps, TITI), 1, '拿到卡的瞬间就发（runOnPick 的「层数已经过线」那一半）');
  assert.equal(Number(ps.counters['hex:hex_sargon_oasis:layerGift:60']), 1, 'rung 的计数器按模拟器那一套记');
  // 之后再加层不会发第二次
  ps.addLayers('sargonShip', 1, { reason: 'later' });
  assert.equal(countChess(ps, TITI), 1, '同一 rung 只发一次');
  m.dispose();
});

test('【绿洲】获得时同时过 60 与 325 两档：缇缇与黄沙罗盘都在获得时到手', () => {
  const { m } = prep();
  const ps = m.players.get('p_0');
  ps.layers.sargonShip = 330;
  ps.recompute();
  applyHex(m, ps, OASIS);
  assert.equal(countChess(ps, TITI), 1, '60 层档：缇缇');
  assert.equal(countItems(ps, COMPASS), 1, '325 层档：黄沙罗盘');
  m.dispose();
});

test('【绿洲】被复制（第二份 ref）后同一档不重复发；真正加层时也仍然只发一次', () => {
  const { m } = prep();
  const ps = m.players.get('p_0');
  ps.layers.sargonShip = 59;
  ps.recompute();
  applyHex(m, ps, OASIS);
  assert.equal(countChess(ps, TITI), 0, '59 层还没到');
  // 模拟「复制 / 管理员」造出的第二份 ref：与原件共用计数器（addHexRef 打的 data.sharedCounters）
  const ref = ps.effects.find((e) => e.data && e.data.hexId === 'hex_sargon_oasis');
  assert.ok(ref && ref.data.sharedCounters === true, '里程碑卡的 ref 带 sharedCounters 标记');
  ps.effects.push({ ...ref, id: 'hex:hex_sargon_oasis#2', data: { ...ref.data, copySeq: 2 } });
  // 战斗内加层跨过 60（settle 走的就是这个 dispatch）
  m.dispatch(ps, 'onLayers', { bondId: 'sargonShip', from: 59, to: 61, reason: 'battle' });
  assert.equal(countChess(ps, TITI), 1, '两份 ref 只发一只缇缇');
  // 再来一次加层
  ps.layers.sargonShip = 62;
  m.dispatch(ps, 'onLayers', { bondId: 'sargonShip', from: 61, to: 62, reason: 'battle' });
  assert.equal(countChess(ps, TITI), 1, '不会因为第二份 ref 再发一次');
  m.dispose();
});

// =====================================================================================================================
// 3. 协议源石发的钱不计入 n19 的一回合 30 资金上限
// =====================================================================================================================

/** A solo ABYSS match at protocol level 19 (the only difficulty the level axis runs on). */
function abyss19(seed = 21) {
  const h = makeMatch({ mode: 'solo', difficulty: 'ABYSS', humans: 1, seed, fake: true, protocolLevel: 19 }).start();
  h.toPrep(1);
  return { h, m: h.m, ps: h.ps('p_0') };
}

test('n19：协议源石直接发的钱（hex / hex_debt）不占额度、不被削；回合收入 / 卖出照旧受限', () => {
  const { m, ps } = abyss19();
  assert.equal(m.gd.fundsGainCapPerRound, 30, '前提：n19 的一回合上限是 30');
  ps.funds = 0;
  ps.addFunds(30, { reason: 'income' });           // 这一回合的额度用满
  assert.equal(ps.round.fundsGained, 30);
  assert.equal(ps.addFunds(10, { reason: 'income' }), 0, '回合收入照旧被上限削掉');
  assert.equal(ps.addFunds(5, { reason: 'sell' }), 0, '卖出返还照旧受限');
  assert.equal(ps.addFunds(3, { reason: 'hex' }), 3, '协议源石发的 3 资金全额到账');
  assert.equal(ps.addFunds(3, { reason: 'hex_debt' }), 3, '债务（hex_debt）也全额到账');
  assert.equal(ps.addFunds(3, { reason: 'hex:hex_something' }), 3, 'hex: 前缀同样豁免');
  assert.equal(ps.round.fundsGained, 30, 'hex 的钱不占额度');
  m.dispose();
});

test('n19：真卡发的钱也不被削 —— 战备津贴（onPick.funds 3）在上限用满时仍到账', () => {
  const { m, ps } = abyss19(23);
  ps.funds = 0;
  ps.addFunds(30, { reason: 'income' });
  assert.equal(ps.round.fundsGained, 30);
  const before = ps.funds;
  applyHex(m, ps, STIPEND);
  assert.equal(ps.funds - before, 3, '战备津贴的 3 资金全额到账（走 ctx.addFunds(…, \'hex\')）');
  m.dispose();
});

test('n19：协议源石结算到下回合的钱（战损回收）在回合开始时按协议源石那部分豁免', () => {
  const { h, m, ps } = abyss19(25);
  applyHex(m, ps, RECOVERY);
  // 一场漏了 1 只敌人的战斗结果：perLpLoss 2 × 1 + firstLeak 2 = 4，两笔都进 pendingFunds
  m.dispatch(ps, 'onBattleResult', { result: { leaked: [{ counted: true }], perfect: false }, lpLoss: 1 });
  const pending = ps.pendingFunds;
  assert.equal(pending, 4, '协议源石的钱先记进 pendingFunds');
  assert.equal(ps.pendingHexFunds, 4, '其中协议源石那一部分单独记着（addPendingFunds 的来源是 hex:<id>）');
  // 下一回合开始：round.js 把 income + pending 合成一笔 'income' 付出来，协议源石那 4 点要豁免。
  // 备战结束时资金会被清零（没带「保留余额」的盟约），所以看这一笔的实际到账额，而不是资金差。
  const income = m.gd.income(2);
  let incomeCall = null;
  const orig = ps.addFunds.bind(ps);
  ps.addFunds = (n, o = {}) => {
    const r = orig(n, o);
    if (o && o.reason === 'income') incomeCall = { n, r };
    return r;
  };
  h.drive(() => m.phase === 'PREP' && m.round === 2, { ready: true });
  assert.ok(incomeCall, '下一回合的回合收入走 addFunds(…, { reason: \'income\' })');
  assert.equal(incomeCall.n, income + pending, '这一笔 = 回合收入 + 上回合结算里协议源石的钱');
  assert.equal(incomeCall.r, income + pending, '全额到账（协议源石那 4 点没被上限削掉）');
  assert.equal(ps.round.fundsGained, income, '只有回合收入占额度（协议源石那 4 点不占）');
  assert.equal(ps.pendingHexFunds, 0, '豁免用掉即清');
  m.dispose();
});

// =====================================================================================================================
// 4. 【特限恢复】：有特限模组的干员购买价格 −2，最低 1
// =====================================================================================================================

const priceOf = (m, ps, id) => ps.priceOf({ kind: 'chess', id, basePrice: m.gd.chessPrice(id) });

test('【特限恢复】有特限模组的干员 −2（最低 1），没有特限模组的干员与装备不变；没卡时都不变', () => {
  const { m } = prep();
  const ps = m.players.get('p_0');
  assert.equal(m.gd.chessPrice(SWIRE2), 3, '前提：琳琅诗怀雅 3 资金');
  assert.equal(priceOf(m, ps, SWIRE2), 3, '没有卡：原价');
  assert.equal(priceOf(m, ps, INSIDE), m.gd.chessPrice(INSIDE), '没有卡：原价');
  applyHex(m, ps, MODE_MODULES);
  assert.equal(priceOf(m, ps, SWIRE2), 1, '有 ISW-A 特限模组：3 − 2 = 1');
  assert.equal(priceOf(m, ps, 'chess_char_3_04_b'), 1, '精锐 id 同样认（同一个干员）');
  assert.equal(priceOf(m, ps, INSIDE), m.gd.chessPrice(INSIDE), '没有特限模组的干员：原价');
  assert.equal(ps.priceOf({ kind: 'item', id: 'chess_item_1_01_e_a', basePrice: m.gd.itemPrice('chess_item_1_01_e_a') }),
    m.gd.itemPrice('chess_item_1_01_e_a'), '装备不受影响');
  m.dispose();
});

test('【特限恢复】折扣的下限与数值都来自卡面（delta / min 改成别的数照样生效）', () => {
  const { m } = prep();
  const ps = m.players.get('p_0');
  const rec = { ...MODE_MODULES, effect: { ...MODE_MODULES.effect, onPrice: { specialLimitDiscount: { delta: -5, min: 1, types: ['ISW'] } } } };
  applyHex(m, ps, rec);
  assert.deepEqual(specialLimitPriceOf(ps), { delta: -5, min: 1, types: ['ISW'] }, '参数从 params.onPrice.specialLimitDiscount 读');
  assert.equal(priceOf(m, ps, SWIRE2), 1, '3 − 5 被 min 1 兜住');
  // types 只写 ISW ⇒ 只有 ISW 的干员打折（RA 的百炼嘉维尔不打）
  assert.equal(hasSpecialLimitModule(m.gd, 'chess_char_4_23_a', ['ISW']), false, '百炼嘉维尔是 RA-A，不在 ISW 里');
  assert.equal(hasSpecialLimitModule(m.gd, 'chess_char_4_23_a', ['ISW', 'SO', 'RA']), true);
  assert.equal(specialLimitDiscountOf(ps, 'chess_char_4_23_a'), null, 'types 不含 RA ⇒ 不打折');
  m.dispose();
});

test('【特限恢复】被复制（第二份 ref）不会叠成 −4', () => {
  const { m } = prep();
  const ps = m.players.get('p_0');
  applyHex(m, ps, MODE_MODULES);
  const ref = ps.effects.find((e) => e.data && e.data.hexId === 'hex_mode_modules');
  ps.effects.push({ ...ref, id: 'hex:hex_mode_modules#2', data: { ...ref.data, copySeq: 2 } });
  assert.equal(priceOf(m, ps, SWIRE2), 1, '3 − 2 = 1，不是 3 − 4');
  m.dispose();
});

// =====================================================================================================================
// 回归：roster 这次同时给【量产线】加了 onPick.chess（复用已有的 onPick.chess 通道），onPick 与 onRoundStart 要都生效
// =====================================================================================================================

test('【量产线】onPick.chess 与 onRoundStart.chess 同时存在时都生效（各发 1 名当前调度中心等级的干员）', () => {
  const { m } = prep({ humans: 1, bots: 0 });
  const ps = m.players.get('p_0');
  const before = ps.allChess().length;
  applyHex(m, ps, MASSPROD);
  assert.equal(ps.allChess().length, before + 1, '获得时的那 1 名（onPick.chess）');
  m.dispatch(ps, 'onRoundStart', { round: m.round + 1 });
  assert.equal(ps.allChess().length, before + 2, '每回合开始的那 1 名（onRoundStart.chess）照旧');
  m.dispose();
});
