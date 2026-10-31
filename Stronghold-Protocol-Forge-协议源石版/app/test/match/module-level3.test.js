// test/match/module-level3.test.js — 协议源石【特限恢复】(hex_mode_modules, 2 阶 / gold) 的 **3 级模组**
// (04-文档/协议源石-突破极限与特限恢复-设计稿-20261031.md §4.1/§4.2): 数据加载 (server/data.js rawModuleLevels) →
// 组合 (shared/loadoutRecord.js withModuleLevel3) → 战斗 (PlayerState.battleInput 的 unit.moduleLevel → simdata
// getChess → 战斗 def) → 备战预览 (g.unitStats 走同一份 battleInput)。
//
// 口径（业主 2026-10-31）：只对**拥有者**生效；「有模组的」= 该干员有模组数据；「所有形态」= 精锐（含不装备）、
// 普通形态（`_a`，本来没有模组）以及自选编队都算。补位干员不算（[ASSUMED]，见 server/match/player/round.js）。
//
// 数据目标：隐现 chess_char_1_01_a / _b（默认模组 uniequip_002_inside “最初的惊喜”，MAR-X）——
//   1 级 attr {maxHp 80, atk 22}、talentChanges 空；3 级 attr {maxHp 160, atk 38}、talentChanges[0] 火力支援
//   「弹药上限 +5 / 其他拉特兰 +1」（talentsBase 是 +3 / +1）。特性文本 1 级与 3 级相同，所以「用的是 3 级记录」由
//   attr / talents / module.level 三处判定，特性由 withModuleLevel3 的单元测试（合成表）判定。
//
// 沙箱里 `node --test` 会 spawn EPERM，用等价方式跑：`node test/match/module-level3.test.js`。

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeMatch, give, legalTileFor, DATA } from './harness.js';
import { DataSource, getDefaultSource, hasGeneratedData } from '../../server/sim/simdata.js';
import { withModuleLevel3, loadoutRecord, resolveRecordLoadout, composeStats } from '../../shared/loadoutRecord.js';
import { rawModuleLevels, getModuleLevel3 } from '../../server/data.js';
import { applyHex } from '../../server/match/hextech.js';
import { unitStatsEntry } from '../../shared/protocol.js';

const REAL = { skip: !hasGeneratedData() || !DATA.moduleLevels };
const A = 'chess_char_1_01_a'; // 隐现 普通形态（module.active === false，默认模组挂在 module.id 上）
const B = 'chess_char_1_01_b'; // 隐现 精锐形态
const MOD = 'uniequip_002_inside'; // 默认模组 “最初的惊喜”
const L3 = DATA.moduleLevels?.[MOD] ?? null;
const L1 = (DATA.chess?.[B]?.modules ?? []).find((m) => m && m.uniEquipId === MOD) ?? null;
const T5A = 'chess_char_5_diy1_a';
const SIEGE = 'char_112_siege'; // 推进之王（owned 6★, 自选编队可选）
const SIEGE_PICK = { charId: SIEGE, skillIndex: 2, uniEquipId: 'uniequip_002_siege' };

/** 一个干净的 solo PREP R1：清空棋盘与手牌，再把 `id` 放到合法格子上。 */
function prepBoard(id, opts = {}) {
  const h = makeMatch({ mode: 'solo', difficulty: 'NORMAL', seed: opts.seed ?? 31, fake: true, ...opts }).start();
  h.toPrep(1);
  const m = h.m;
  const ps = h.ps('p_0');
  for (const p of [...ps.board.values(), ...ps.hand.filter(Boolean)]) if (p.kind === 'chess') ps.returnCopies(p);
  ps.board.clear();
  ps.hand.fill(null);
  ps.recompute();
  const piece = give(m, ps, id, 'board', legalTileFor(m, ps, id));
  return { h, m, ps, piece };
}

test('data/moduleLevels.json：server/data.js rawModuleLevels / getModuleLevel3，DataSource rawModuleLevels / moduleLevel3；缺文件时是空表不报错', REAL, () => {
  const levels = rawModuleLevels();
  assert.ok(Object.keys(levels).length >= 170, `3 级模组记录 ${Object.keys(levels).length} 条`);
  assert.equal(getModuleLevel3(MOD), levels[MOD]);
  assert.equal(getModuleLevel3('uniequip_999_nope'), null);
  assert.equal(getModuleLevel3('constructor'), null, 'own-property 查询，不落 Object.prototype');
  assert.deepEqual([levels[MOD].level, levels[MOD].uniEquipId, levels[MOD].typeName], [3, MOD, 'MAR-X']);
  assert.deepEqual(levels[MOD].attr, { maxHp: 160, atk: 38 });
  // 缺文件（老内容集 / 只有旧 data 的包）：`{}`，不抛错
  assert.deepEqual(rawModuleLevels({}), {});
  assert.deepEqual(rawModuleLevels({ moduleLevels: [] }), {}, '形状不对也当空表');
  // DataSource：本源 → fallback → 进程内的生成数据；一个什么都没有的源给空表
  const ds = new DataSource(DATA);
  assert.equal(ds.moduleLevel3(MOD), levels[MOD]);
  assert.equal(ds.moduleLevel3('none'), null);
  assert.deepEqual(new DataSource({ ...DATA, moduleLevels: {} }).rawModuleLevels(), {});
  assert.equal(getDefaultSource().moduleLevel3(MOD), levels[MOD], '默认源（Node: data/*.json）也读得到');
});

test('withModuleLevel3：不改原记录，stats / trait / talents / module 换成 3 级那份；查不到原样返回同一个对象', REAL, () => {
  const rec = DATA.chess[B];
  const composed = loadoutRecord(rec, resolveRecordLoadout(rec, { moduleId: MOD }));
  // 1 级：statsBase + 1 级 attr，module.level 1
  assert.deepEqual([composed.module.level, composed.stats.maxHp, composed.stats.atk], [1, rec.statsBase.maxHp + L1.attr.maxHp, rec.statsBase.atk + L1.attr.atk]);
  // 合成表：特性与天赋都写成一眼可辨的值，证明它们确实取自 3 级记录
  const fake = {
    [MOD]: {
      uniEquipId: MOD, name: '3 级模组名', typeName: 'MAR-X', level: 3,
      attr: { maxHp: 160, atk: 38 },
      traitOverride: { desc: '3 级特性', bb: { probe: 1 } },
      talentChanges: [{ talentIndex: 0, name: '火力支援', desc: '3 级天赋' }],
    },
  };
  const out = withModuleLevel3(composed, fake);
  assert.notEqual(out, composed, '返回新对象');
  assert.equal(out.trait, fake[MOD].traitOverride, 'trait = 3 级 traitOverride（整个对象）');
  assert.equal(out.stats.maxHp, composeStats(rec.statsBase, fake[MOD].attr).maxHp);
  assert.equal(out.stats.atk, rec.statsBase.atk + 38);
  assert.equal(out.talents.find((t) => t.index === 0)?.desc, '3 级天赋');
  assert.deepEqual(
    [out.module.id, out.module.name, out.module.type, out.module.level, out.module.active],
    [MOD, '3 级模组名', 'MAR-X', 3, true],
  );
  assert.equal(out.modules.find((m) => m.uniEquipId === MOD).level, 3, 'modules 列表里的同一条也换成 3 级（attackRangeGrid 读它）');
  // 原记录没被动过（data/*.json 是冻结的共享数据）
  assert.deepEqual([composed.module.level, composed.stats.maxHp, composed.trait], [1, rec.statsBase.maxHp + L1.attr.maxHp, L1.traitOverride]);
  assert.ok(Object.isFrozen(rec));
  // 查不到 ⇒ 原样返回
  assert.equal(withModuleLevel3(composed, {}), composed);
  assert.equal(withModuleLevel3(composed, { [MOD]: null }), composed);
  assert.equal(withModuleLevel3(composed, fake, 'none'), composed, '不装备模组');
  assert.equal(withModuleLevel3(null, fake), null);
});

test('无卡（不传 moduleLevel）：getChess 与现在逐字段一致 —— module.level 1、stats 不含 3 级 attr', REAL, () => {
  const ds = new DataSource(DATA);
  const rec = DATA.chess[B];
  const d = ds.getChess(B, { moduleId: MOD });
  assert.deepEqual([d.module.id, d.module.level, d.module.active], [MOD, 1, true]);
  assert.deepEqual([d.stats.maxHp, d.stats.atk], [rec.statsBase.maxHp + 80, rec.statsBase.atk + 22]);
  assert.notEqual(d.stats.maxHp, rec.statsBase.maxHp + 160, '1 级 def 没有 3 级 attr');
  assert.equal(d.trait, L1.traitOverride.desc);
  assert.equal(d.talents.length, rec.talentsBase.length, '1 级模组没有 talentChanges：天赋就是 talentsBase');
  assert.equal(d.loadout.moduleLevel, undefined, 'def.loadout 不带标记');
  // 普通形态（不装备）
  const a = ds.getChess(A);
  assert.deepEqual([a.module.active, a.module.level, a.stats.maxHp, a.stats.atk], [false, 0, DATA.chess[A].stats.maxHp, DATA.chess[A].stats.atk]);
});

test('有卡（moduleLevel: 3）：战斗 def 是 3 级 —— stats = statsBase + 3 级 attr、talents 是 3 级版本、module.level 3；与 1 级 def 分开缓存', REAL, () => {
  const ds = new DataSource(DATA);
  const rec = DATA.chess[B];
  const d3 = ds.getChess(B, { moduleId: MOD, moduleLevel: 3 });
  assert.deepEqual([d3.module.id, d3.module.level, d3.module.active], [MOD, 3, true]);
  assert.deepEqual([d3.stats.maxHp, d3.stats.atk], [rec.statsBase.maxHp + L3.attr.maxHp, rec.statsBase.atk + L3.attr.atk]);
  assert.equal(d3.trait, L3.traitOverride.desc);
  const talent = d3.talents.find((t) => t.name === '火力支援');
  assert.equal(talent?.description, L3.talentChanges[0].desc, '3 级天赋（弹药上限 +5，不是 base 的 +3）');
  assert.equal(talent?.bb.self_ammo, 5);
  assert.equal(d3.loadout.moduleLevel, 3, 'def.loadout 说明它为什么不同');
  // 缓存 key 含 moduleLevel：同 (id, loadout) 的 1 级 def 不会被顶掉，也不会命中 3 级那份
  assert.notEqual(ds.getChess(B, { moduleId: MOD }), d3);
  assert.equal(ds.getChess(B, { moduleId: MOD }).module.level, 1);
  assert.equal(ds.getChess(B, { moduleId: MOD, moduleLevel: 3 }), d3, '同一 loadout 命中缓存');
  // 精锐 + 不装备模组：不套（没有模组就没有 3 级数据）
  const none = ds.getChess(B, { moduleId: 'none', moduleLevel: 3 });
  assert.deepEqual([none.module.active, none.stats.maxHp], [false, rec.statsBase.maxHp]);
});

test('普通形态（_a，本来没有模组）也拿到默认模组的 3 级数据；没有 3 级数据的数据源静默不组合', REAL, () => {
  const ds = new DataSource(DATA);
  const rec = DATA.chess[A];
  assert.equal(rec.module.active, false, '前提：普通形态没有模组');
  const d3 = ds.getChess(A, { moduleLevel: 3 });
  assert.deepEqual([d3.module.id, d3.module.level, d3.module.active], [MOD, 3, true]);
  assert.deepEqual([d3.stats.maxHp, d3.stats.atk], [rec.stats.maxHp + L3.attr.maxHp, rec.stats.atk + L3.attr.atk]);
  assert.equal(d3.trait, L3.traitOverride.desc);
  assert.equal(d3.talents.find((t) => t.name === '火力支援')?.description, L3.talentChanges[0].desc);
  // 不传 moduleLevel 时还是那份「没有模组」的记录（同一 id 的两个 def 不互相污染）
  const d1 = ds.getChess(A);
  assert.deepEqual([d1.module.active, d1.stats.maxHp], [false, rec.stats.maxHp]);
  // 数据源里没有 moduleLevels（老内容集）：3 级组合静默不发生，def 与 1 级一致
  const old = new DataSource({ ...DATA, moduleLevels: {} });
  const same = old.getChess(B, { moduleId: MOD, moduleLevel: 3 });
  assert.deepEqual([same.module.level, same.stats.maxHp], [1, DATA.chess[B].statsBase.maxHp + 80]);
  // 补位干员（standIn）不套 3 级：它的模组来自 data/backups.json 的另一个人（[ASSUMED]）
  const stand = ds.getChess(B, { standIn: true, moduleLevel: 3 });
  assert.ok(!stand || stand.loadout.moduleLevel === undefined, 'standIn 的 loadout 不带 moduleLevel');
});

test('battleInput：拥有 hex_mode_modules 时己方 chess 单位带 moduleLevel: 3（自选编队也算），没有卡时不带', REAL, () => {
  // 没有卡
  const plain = prepBoard(B, { seed: 41 });
  const u0 = plain.ps.battleInput({ side: 'L', colOffset: 0 }).units.find((u) => u.kind === 'chess' && u.uid === plain.piece.uid);
  assert.ok(u0 && !('moduleLevel' in u0), '没有卡：unit 不带 moduleLevel');
  plain.m.dispose();
  // 有卡
  const owned = prepBoard(B, { seed: 41 });
  applyHex(owned.m, owned.ps, DATA.hextech.playerHexes.hex_mode_modules);
  const u1 = owned.ps.battleInput({ side: 'L', colOffset: 0 }).units.find((u) => u.kind === 'chess' && u.uid === owned.piece.uid);
  assert.equal(u1.moduleLevel, 3, '有卡：己方 chess 单位带 moduleLevel: 3');
  assert.deepEqual([u1.skillIndex, u1.moduleId], [DATA.chess[B].skill.index, MOD], 'loadout 字段照旧（3 级只是同一模组的另一档）');
  // 普通形态的干员同样带（「所有形态」）
  const aSide = prepBoard(A, { seed: 41 });
  applyHex(aSide.m, aSide.ps, DATA.hextech.playerHexes.hex_mode_modules);
  const ua = aSide.ps.battleInput({ side: 'L', colOffset: 0 }).units.find((u) => u.kind === 'chess' && u.uid === aSide.piece.uid);
  assert.equal(ua.moduleLevel, 3, '普通形态也带');
  aSide.m.dispose();
  owned.m.dispose();
});

test('battleInput：自选编队（diy）的棋子也带 moduleLevel: 3', REAL, () => {
  const seats = [
    { seat: 0, playerId: 'p_0', name: 'P0', isBot: false, connected: true, diy: { [T5A]: SIEGE_PICK } },
    { seat: 1, playerId: 'ai_0', name: 'AI0', isBot: true, connected: true },
  ];
  const h = makeMatch({ mode: 'coop', seats, seed: 13, fake: true }).start();
  h.toPrep(1);
  const m = h.m;
  const ps = h.ps('p_0');
  for (const p of [...ps.board.values(), ...ps.hand.filter(Boolean)]) if (p.kind === 'chess') ps.returnCopies(p);
  ps.board.clear();
  ps.hand.fill(null);
  ps.recompute();
  const piece = give(m, ps, T5A, 'board', legalTileFor(m, ps, T5A));
  assert.ok(ps.diyPickOf(piece.id), '前提：这一格是自选编队填的');
  const before = ps.battleInput({ side: 'L', colOffset: 0 }).units.find((u) => u.kind === 'chess' && u.uid === piece.uid);
  assert.deepEqual(before.diy, SIEGE_PICK, '自选棋子带 pick');
  assert.ok(!('moduleLevel' in before), '没有卡：不带');
  applyHex(m, ps, DATA.hextech.playerHexes.hex_mode_modules);
  const after = ps.battleInput({ side: 'L', colOffset: 0 }).units.find((u) => u.kind === 'chess' && u.uid === piece.uid);
  assert.equal(after.moduleLevel, 3, '有卡：自选棋子也带 moduleLevel: 3');
  // 自选记录的模组来自 data/backups.json 的形态（tier-6 形态本身就是 equipLevel 3 的 attr），不在 moduleLevels 里 ⇒
  // 战斗里仍是那份形态的数据，不会因为 moduleLevel 被换成别的数（幂等）
  const def = getDefaultSource().getChess(piece.id, { diy: SIEGE_PICK, moduleLevel: 3 });
  assert.deepEqual([def.charId, def.raw.module.id], [SIEGE, 'uniequip_002_siege']);
  m.dispose();
});

test('预览与战斗一致：g.unitStats 的数值就是实战 def 的 3 级数值（同一份 battleInput）', REAL, () => {
  /** 同一块棋盘、同一个种子；`card` 决定是否发这张卡。 */
  const board = (card) => {
    const h = makeMatch({ mode: 'solo', difficulty: 'NORMAL', seed: 47 }).start();
    h.toPrep(1);
    const m = h.m;
    const ps = h.ps('p_0');
    for (const p of [...ps.board.values(), ...ps.hand.filter(Boolean)]) if (p.kind === 'chess') ps.returnCopies(p);
    ps.board.clear();
    ps.hand.fill(null);
    ps.recompute();
    const piece = give(m, ps, B, 'board', legalTileFor(m, ps, B));
    if (card) applyHex(m, ps, DATA.hextech.playerHexes.hex_mode_modules);
    return { h, m, ps, piece };
  };
  const withCard = board(true);
  const preview = (() => {
    assert.deepEqual(withCard.m.handle('p_0', { t: 'g.unitStats', seq: 3 }), { ok: true });
    const msg = withCard.h.lastTo('p_0', 'm.unitStats');
    assert.ok(msg, '有回答');
    const u = msg.units.find((x) => x.uid === withCard.piece.uid);
    assert.ok(u, '预览里有这名干员');
    return u;
  })();
  // 实战 def：同一份 battleInput 的 loadout（带 moduleLevel: 3）→ 3 级记录
  const unit = withCard.ps.battleInput().units.find((u) => u.uid === withCard.piece.uid);
  assert.equal(unit.moduleLevel, 3);
  const def = withCard.m.ds.getChess(B, { ...unit });
  assert.deepEqual([def.module.level, def.stats.maxHp, def.stats.atk], [3, DATA.chess[B].statsBase.maxHp + 160, DATA.chess[B].statsBase.atk + 38]);
  // 预览的 base（开战前的属性）= 3 级 def 的数值 × 练度（精英2 Lv.60 = ×1.1，0.2.2）；`atk` 还可能被盟约 / 协议源石再抬
  const mul = withCard.m.ds.cultivateMul(3);
  assert.equal(preview.base.atk, Math.round(def.stats.atk * mul.atk), `预览 base ATK ${preview.base.atk} = 3 级 def 的 ${def.stats.atk} × 练度`);
  assert.equal(preview.base.maxHp, Math.round(def.stats.maxHp * mul.hp), '预览 base maxHp = 3 级 def 的 maxHp × 练度');
  // 与真正跑起来的那一场逐字段一致（预览 = 实战）
  const b = withCard.m.newBattle(withCard.m._normalOpts(withCard.ps));
  b.start();
  const bu = b.allyUnits.find((x) => x.uid === withCard.piece.uid);
  assert.equal(bu.def.module.level, 3, '战斗单位的 def 是 3 级');
  const { id: _id, ...want } = unitStatsEntry(bu, bu.s);
  const { id: _id2, ...have } = preview;
  assert.deepEqual(have, want, '预览 = 实战（同一份 battleInput）');
  // 没有卡的同一条棋盘：base 少掉的正是 3 级与 1 级 attr 的差（16 ATK / 80 HP，再乘练度）
  const without = board(false);
  without.m.handle('p_0', { t: 'g.unitStats', seq: 4 });
  const plain = without.h.lastTo('p_0', 'm.unitStats').units.find((x) => x.uid === without.piece.uid);
  assert.equal(preview.base.atk - plain.base.atk, Math.round((L3.attr.atk - L1.attr.atk) * mul.atk), '3 级比 1 级多 16 ATK（× 练度）');
  assert.equal(preview.base.maxHp - plain.base.maxHp, Math.round((L3.attr.maxHp - L1.attr.maxHp) * mul.hp), '3 级比 1 级多 80 HP（× 练度）');
  withCard.m.dispose();
  without.m.dispose();
});

// 业主 2026-10-31「特限恢复有问题，不生效对没有精锐的干员」：普通形态（棋盘上还没有精锐棋子）在干员调配里选的模组
// 原来会被 resolveLoadout 丢掉（普通记录没有 modules 列表），于是 3 级模组与特限模组的专属效果都落不到普通形态上。
// 现在拥有【特限恢复】时，普通形态也带上那个模组（moduleId）并按 3 级数据打。
const HORN_A = 'chess_char_5_08_a';   // 号角 普通形态
const HORN_ISW = 'uniequip_004_horn'; // 号角特限证章（ISW-A）
const HORN_FORX = 'uniequip_002_horn'; // “典范之人”（FOR-X，默认模组）
const HORN_FORY = 'uniequip_003_horn'; // 旧日新装（FOR-Y，非默认）

test('【特限恢复】普通形态也用干员调配里选的模组：battleInput 补 moduleId、def 是该模组的 3 级（含 ISW 特限模组）', REAL, () => {
  /** 同一块棋盘；`loadout` = 干员调配里的选择，`card` 决定是否发这张卡。 */
  const board = (loadout, card) => {
    const h = makeMatch({ mode: 'solo', difficulty: 'NORMAL', seed: 53, fake: true }).start();
    h.toPrep(1);
    const m = h.m;
    const ps = h.ps('p_0');
    for (const p of [...ps.board.values(), ...ps.hand.filter(Boolean)]) if (p.kind === 'chess') ps.returnCopies(p);
    ps.board.clear();
    ps.hand.fill(null);
    ps.recompute();
    assert.equal(ps.setLoadout(loadout), true, `setLoadout ${JSON.stringify(loadout)}`);
    const piece = give(m, ps, HORN_A, 'board', legalTileFor(m, ps, HORN_A));
    if (card) applyHex(m, ps, DATA.hextech.playerHexes.hex_mode_modules);
    return { h, m, ps, piece };
  };
  const unitOf = (s) => s.ps.battleInput({ side: 'L', colOffset: 0 }).units.find((u) => u.kind === 'chess' && u.uid === s.piece.uid);
  // 没卡：普通形态仍是「没有模组」（选择被丢掉，与改动前逐字段一致）
  const plain = board({ [HORN_A]: { module: HORN_ISW } }, false);
  const u0 = unitOf(plain);
  assert.equal(u0.moduleId, null, '没有卡：普通形态没有模组');
  assert.ok(!('moduleLevel' in u0), '没有卡：不带 moduleLevel');
  plain.m.dispose();
  // 有卡：选中的特限模组补上，战斗 def 是 ISW-A 的 3 级
  const owned = board({ [HORN_A]: { module: HORN_ISW } }, true);
  const u1 = unitOf(owned);
  assert.equal(u1.moduleId, HORN_ISW, '有卡：普通形态也带选中的模组');
  assert.equal(u1.moduleLevel, 3);
  const def = owned.m.ds.getChess(HORN_A, { ...u1 });
  assert.deepEqual([def.module.id, def.module.type, def.module.level], [HORN_ISW, 'ISW-A', 3]);
  const l3 = DATA.moduleLevels[HORN_ISW];
  assert.deepEqual(
    [def.stats.maxHp, def.stats.atk],
    [DATA.chess[HORN_A].stats.maxHp + l3.attr.maxHp, DATA.chess[HORN_A].stats.atk + l3.attr.atk],
    'stats = 普通形态基础值 + 3 级 attr',
  );
  assert.equal(def.trait, l3.traitOverride.desc, 'trait = 3 级 traitOverride');
  assert.ok(Array.isArray(def.raw.modules) && def.raw.modules[0]?.uniEquipId === HORN_ISW, '普通形态也补一条 modules（kits / 攻击范围读它）');
  // 选 FOR-Y（非默认）：普通形态用的是 FOR-Y 的 3 级，不是特限模组
  const fory = board({ [HORN_A]: { module: HORN_FORY } }, true);
  const u2 = unitOf(fory);
  assert.equal(u2.moduleId, HORN_FORY);
  const def2 = fory.m.ds.getChess(HORN_A, { ...u2 });
  assert.deepEqual([def2.module.id, def2.module.type, def2.module.level], [HORN_FORY, 'FOR-Y', 3]);
  fory.m.dispose();
  // 没选（或选的正是默认 FOR-X，setLoadout 会把它当默认丢掉）：普通形态仍按默认模组的 3 级数据（改动前的行为）
  const dflt = board({}, true);
  const u4 = unitOf(dflt);
  assert.equal(u4.moduleId, null, '默认模组不写进 loadout');
  const def4 = dflt.m.ds.getChess(HORN_A, { ...u4 });
  assert.deepEqual([def4.module.id, def4.module.type, def4.module.level], [HORN_FORX, 'FOR-X', 3]);
  dflt.m.dispose();
  // 选了「不装备」：没有模组（默认模组的 3 级也不套）
  const none = board({ [HORN_A]: { module: 'none' } }, true);
  const u3 = unitOf(none);
  assert.equal(u3.moduleId, 'none', '「不装备」原样带给战斗');
  const def3 = none.m.ds.getChess(HORN_A, { ...u3 });
  assert.deepEqual([def3.module.active, def3.module.level], [false, 0]);
  none.m.dispose();
  owned.m.dispose();
});
