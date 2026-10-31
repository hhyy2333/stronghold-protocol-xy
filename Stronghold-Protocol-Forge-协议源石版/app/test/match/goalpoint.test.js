// test/match/goalpoint.test.js — 号角特限模组「可以部署在目标点」（shared/goalPoint.js）。
//
// 设计稿：04-文档/协议源石-号角特限模组-设计稿-20261031.md §3-5。官方 号角 特限模组「号角特限证章」(ISW-A) 的特性
// 追加行「在集成战略中，可以部署在目标点且可以攻击隐匿敌人」：卫戍协议的「目标点」= 保护目标点（stage 图例
// tile_end，棋盘 (9,2)），平时 buildable NONE、谁都不能站；拥有【特限恢复】`hex_mode_modules` 且号角装着 ISW-
// 特限模组时，它是唯一的例外。服务端（player/placement.js `_mayStandOnGoalPoint`）与客户端
// （ui/gameLogic/placement.js `goalPointAllowed`）读同一份规则。
//
// [ASSUMED]（设计稿 §3-5）：1) 只认号角本人（charId char_4039_horn）；2) 必须有卡 + 启用中的 ISW- 模组（普通形态
// 没有模组 ⇒ 不适用）；3) 目标点不是阻挡地形，她站在那里不挡路、敌人照常漏；4) 补位形态是别的角色记录 ⇒ 不适用。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DATA, makeMatch, give, checkInvariants, withoutHextech } from './harness.js';
import { applyHex } from '../../server/match/hextech.js';
import { ERR } from '../../shared/constants.js';
import { tileKey } from '../../server/match/board.js';
import { canStandOnGoalPoint, goalPointKeys, GOAL_POINT_CHAR_ID } from '../../shared/goalPoint.js';
import { placementContext, canPlace as clientCanPlace, boardTargets } from '../../public/js/ui/gameLogic.js';

const STAGE = 'act1autochess_m01';
const GOAL = '9,2';                       // 保护目标点（stage 图例 tile_end 映射到棋盘）
const HORN_N = 'chess_char_5_08_a';
const HORN_E = 'chess_char_5_08_b';       // 号角 精锐：模组只挂在精锐上
const HORN_BASE = 'chess_char_5_08_a';    // loadout 的键（baseId）
const ISW = 'uniequip_004_horn';          // 号角特限证章（ISW-A）
const FORX = 'uniequip_002_horn';         // “典范之人”（FOR-X，默认模组）
const OTHER_TANK = 'chess_char_5_15_b';   // 引星棘刺（5 阶近战，拿来当「别人」）

const board = (r, c) => ({ area: 'board', row: r, col: c });
const move = (m, uid, to, dir) => m.handle('p_0', { t: 'g.move', uid, to, ...(dir ? { dir } : {}) });

/** 一个安静的备战局：清空棋盘与手牌，拿到的棋子都从手牌开始摆。 */
function prep(stageId = STAGE) {
  const h = makeMatch({ mode: 'solo', difficulty: 'NORMAL', seed: 11, data: withoutHextech() }).start();
  h.toPrep(1);
  h.setStage(stageId);
  const ps = h.ps('p_0');
  for (const p of [...ps.board.values(), ...ps.hand.filter(Boolean)]) if (p.kind === 'chess') ps.returnCopies(p);
  ps.board.clear();
  ps.hand.fill(null);
  ps.recompute();
  return { h, m: h.m, ps };
}

/** 号角精锐 + 选中的模组 + 是否给【特限恢复】。 */
function hornWith(m, ps, { module = ISW, card = true } = {}) {
  const piece = give(m, ps, HORN_E);
  assert.equal(ps.setLoadout({ [HORN_BASE]: { module } }), true, `setLoadout ${module}`);
  if (card) applyHex(m, ps, DATA.hextech.playerHexes.hex_mode_modules);
  return piece;
}

const clientCtx = (m, ps, field = 'normal') => placementContext({
  priv: ps.privateView(), stage: m.stage, editable: true, field,
  getChess: (id) => DATA.chess[id] ?? null, getToken: (id) => DATA.tokens[id] ?? null, getItem: (id) => DATA.items[id] ?? null,
});

// ---------------------------------------------------------------------------------------------------------------------
// 规则本体

test('shared/goalPoint：目标点 = stage 图例 tile_end 映射到棋盘 (9,2)；只有「号角 + ISW- 特限模组 + 有卡」成立', () => {
  const { m } = prep();
  const goal = goalPointKeys(m.stage, 'normal', m.layout);
  assert.deepEqual([...goal], [GOAL], 'act1autochess_m01 的保护目标点在棋盘 (9,2)');
  const horn = DATA.chess[HORN_E];
  const isw = horn.modules.find((x) => x.uniEquipId === ISW);
  const forx = horn.modules.find((x) => x.uniEquipId === FORX);
  assert.equal(isw.typeName, 'ISW-A');
  const asMod = (rec, m2) => ({ ...rec, module: { id: m2.uniEquipId, type: m2.typeName, active: true } });
  assert.equal(canStandOnGoalPoint({ record: asMod(horn, isw), ownsModeModules: true }), true);
  assert.equal(canStandOnGoalPoint({ record: asMod(horn, isw), ownsModeModules: false }), false, '没有【特限恢复】⇒ 不生效');
  assert.equal(canStandOnGoalPoint({ record: asMod(horn, forx), ownsModeModules: true }), false, 'FOR-X 不是特限模组');
  assert.equal(canStandOnGoalPoint({ record: { ...horn, module: { id: null, type: null, active: false } }, ownsModeModules: true }), false, '普通形态没有模组');
  assert.equal(canStandOnGoalPoint({ record: asMod(DATA.chess[OTHER_TANK], isw), ownsModeModules: true }), false, '别人装上也不算');
  assert.equal(canStandOnGoalPoint({ record: { ...asMod(horn, isw), charId: 'char_600_cpione' }, ownsModeModules: true }), false, 'charId 不是号角');
  assert.equal(DATA.chess[HORN_E].charId, GOAL_POINT_CHAR_ID);
  m.dispose();
});

// ---------------------------------------------------------------------------------------------------------------------
// 服务端

test('server：号角精锐 + 特限证章 + 【特限恢复】可以摆到 (9,2)；换 FOR-X / 没卡 / 普通形态 / 别人 都被拒', () => {
  {
    const { m, ps } = prep();
    const horn = hornWith(m, ps, { module: ISW, card: true });
    assert.deepEqual(move(m, horn.uid, board(9, 2), 'UP'), { ok: true }, '目标点可以部署');
    assert.equal(ps.board.get(GOAL), horn);
    checkInvariants(m);
    assert.equal(ps.battleInput().units.find((u) => u.uid === horn.uid)?.row, 9, '战斗输入带着它');
    assert.equal(ps.battleInput().units.find((u) => u.uid === horn.uid)?.col, 2);
    m.dispose();
  }
  {
    const { m, ps } = prep();
    const horn = hornWith(m, ps, { module: FORX, card: true });
    assert.equal(move(m, horn.uid, board(9, 2)).error, ERR.BAD_TILE, 'FOR-X 不行');
    m.dispose();
  }
  {
    const { m, ps } = prep();
    const horn = hornWith(m, ps, { module: ISW, card: false });
    assert.equal(move(m, horn.uid, board(9, 2)).error, ERR.BAD_TILE, '没有【特限恢复】不行');
    m.dispose();
  }
  {
    const { m, ps } = prep();
    const normal = give(m, ps, HORN_N);
    applyHex(m, ps, DATA.hextech.playerHexes.hex_mode_modules);
    assert.equal(move(m, normal.uid, board(9, 2)).error, ERR.BAD_TILE, '普通形态没有模组');
    assert.deepEqual(move(m, normal.uid, board(9, 3)), { ok: true }, '普通地格照旧');
    m.dispose();
  }
  {
    const { m, ps } = prep();
    applyHex(m, ps, DATA.hextech.playerHexes.hex_mode_modules);
    const other = give(m, ps, OTHER_TANK);
    assert.equal(move(m, other.uid, board(9, 2)).error, ERR.BAD_TILE, '别的干员不行');
    m.dispose();
  }
});

test('server：站上去以后照常可以换位 / 收回，并且 recompute 不会把人赶走', () => {
  const { m, ps } = prep();
  const horn = hornWith(m, ps, { module: ISW, card: true });
  assert.deepEqual(move(m, horn.uid, board(9, 2), 'UP'), { ok: true });
  ps.recompute();
  checkInvariants(m);
  assert.equal(ps.board.get(GOAL), horn, 'recompute 后还在目标点');
  assert.deepEqual(move(m, horn.uid, { area: 'hand', idx: 0 }), { ok: true }, '可以收回手牌');
  assert.equal(ps.board.has(GOAL), false);
  assert.deepEqual(move(m, horn.uid, board(9, 2), 'UP'), { ok: true }, '可以再摆回去');
  m.dispose();
});

// ---------------------------------------------------------------------------------------------------------------------
// 客户端镜像（拖拽高亮 / canPlace）

test('client：高亮与 canPlace 和服务端一致 —— 只有「号角 + 特限证章 + 有卡」点亮 (9,2)', () => {
  const { m, ps } = prep();
  const horn = hornWith(m, ps, { module: ISW, card: true });
  const ctx = clientCtx(m, ps);
  assert.equal(ctx.goal.has(GOAL), true, '客户端也算出了目标点');
  assert.equal(clientCanPlace(ctx, horn.uid, board(9, 2)).ok, true, '可以拖到目标点');
  const lit = boardTargets(ctx, horn.uid).legal.map(([r, c]) => tileKey(r, c));
  assert.ok(lit.includes(GOAL), '拖拽高亮包含目标点');

  // 换 FOR-X：客户端同步拒绝
  assert.equal(ps.setLoadout({ [HORN_BASE]: { module: FORX } }), true);
  const ctx2 = clientCtx(m, ps);
  assert.equal(clientCanPlace(ctx2, horn.uid, board(9, 2)).ok, false, 'FOR-X 不点亮');
  assert.equal(clientCanPlace(ctx2, horn.uid, board(9, 3)).ok, true, '普通地格照旧');
  m.dispose();

  // 没卡：客户端也拒绝
  const b = prep();
  const horn2 = give(b.m, b.ps, HORN_E);
  assert.equal(b.ps.setLoadout({ [HORN_BASE]: { module: ISW } }), true);
  const ctx3 = clientCtx(b.m, b.ps);
  assert.equal(clientCanPlace(ctx3, horn2.uid, board(9, 2)).ok, false, '没有【特限恢复】不点亮');
  b.m.dispose();
});
