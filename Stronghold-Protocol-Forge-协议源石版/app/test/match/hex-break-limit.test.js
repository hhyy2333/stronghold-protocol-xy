// test/match/hex-break-limit.test.js — 【突破极限】(`hex_break_limit`, 设计稿 §3): 每玩家的盟约叠层上限 9999，**只对拥有者**。
//
// 口径（四处必须同一个数，业主 2026-10-31「全部」）：
//   1. shared/constants.js `layerGainRoom(before, n, cap = BOND_LAYER_CAP)` —— 唯一的截断实现，缺省仍是官方 999；
//   2. server/match/hextech.js `bondLayerCapOf(ps)` —— 每玩家上限：默认 BOND_LAYER_CAP，拥有带 `params.bondCap.cap` 的卡时
//      `max(BOND_LAYER_CAP, cap)`（卡只抬高、不压低；只认自己的 `ps.effects`，所以只对拥有者）；
//   3. 备战侧：`ps.addLayers` / `layerGainOf`（预览）/ `setLayers`、`bondsMeta.bondsWithGains`（界面预览）、
//      `match/settle.js`（战斗内加层结算）、`fields.js`（客户端结果校验）、`invariants.js`（层数不变量）；
//   4. 战斗侧：`PlayerBattleInput.bondLayerCap`（player/round.js battleInput）→ `sim/battle/economy.js addLayers`；
//      客户端 `public/js/ui/watchBonds.js withLiveLayers` 用 runner 的 `state().bondCaps`。
//
// 卡面记录优先用真实 data/hextech.json（Lead 负责接线）；没有就用手写的等价记录 —— 两者走的是同一条
// `addHexRef` 路径（`params = { ...hex.effect, hexId, rarity }`），所以机制测试不依赖卡面文案 / 阶位。

import test from 'node:test';
import assert from 'node:assert/strict';
import { DATA, makeMatch, checkInvariants } from './harness.js';
import { FakeBattle } from './fakeBattle.js';
import { applyHex, bondLayerCapOf, BREAK_LIMIT_HEX_ID } from '../../server/match/hextech.js';
import { BOND_LAYER_CAP, PHASE, layerGainRoom } from '../../shared/constants.js';
import { bondsWithGains } from '../../server/match/bondsMeta.js';
import { specBounds, validateClientResult } from '../../server/match/fields.js';
import { collectViolations } from '../../server/match/invariants.js';
import { withLiveLayers } from '../../public/js/ui/watchBonds.js';
import { makeBattle } from '../helpers/battleHarness.js';

/** 真实卡面记录（Lead 接线后存在），否则手写一份等价记录。 */
const CARD = (DATA.hextech && DATA.hextech.playerHexes && DATA.hextech.playerHexes[BREAK_LIMIT_HEX_ID])
  || { id: BREAK_LIMIT_HEX_ID, name: '突破极限', desc: '盟约叠层上限提升至 9999', rarity: 'prismatic', effect: { bondCap: { cap: 9999 } } };

const fresh = (o = {}) => makeMatch({ mode: 'coop', difficulty: 'NORMAL', humans: 1, bots: 1, seed: 41, fake: true, ...o }).start();

// ---- 1. the clamp itself ------------------------------------------------------------------------------------------------

test('layerGainRoom: the third argument is the per-player cap — 999 by default, 9999 for 【突破极限】', () => {
  assert.equal(BOND_LAYER_CAP, 999, '前提：官方上限没动');
  // 默认行为不变（既有调用点一个都没传第三个参数）
  assert.equal(layerGainRoom(995, 10), 4);
  assert.equal(layerGainRoom(999, 1), 0);
  assert.equal(layerGainRoom(1200, 3), 0, 'over the cap: gains 0 and is never lowered');
  assert.equal(layerGainRoom(0, Infinity), 999, 'Infinity = the room left');
  // 9999：999 之上还能加，到 9999 为止
  assert.equal(layerGainRoom(999, 500, 9999), 500);
  assert.equal(layerGainRoom(9000, 5000, 9999), 999);
  assert.equal(layerGainRoom(9999, 1, 9999), 0);
  assert.equal(layerGainRoom(0, Infinity, 9999), 9999);
  // 0 / 负数 / 非有限数 = 无上限（与 BOND_LAYER_CAP = 0 的既有约定一致）
  for (const none of [0, -1, NaN, Infinity]) assert.equal(layerGainRoom(5000, 7, none), 7, `cap ${none} = no cap`);
});

// ---- 2. bondLayerCapOf: per player, owner only, only upwards ------------------------------------------------------------

test('bondLayerCapOf: BOND_LAYER_CAP without the card, 9999 with it — only the owner, and the card never lowers 999', () => {
  const ref = (params, data) => ({ id: `hex:${BREAK_LIMIT_HEX_ID}`, key: `hex:${BREAK_LIMIT_HEX_ID}`, params, data });
  assert.equal(bondLayerCapOf(null), BOND_LAYER_CAP);
  assert.equal(bondLayerCapOf({ effects: [] }), BOND_LAYER_CAP);
  assert.equal(bondLayerCapOf({ effects: [ref({ bondCap: { cap: 9999 } }, { hexId: BREAK_LIMIT_HEX_ID })] }), 9999);
  assert.equal(bondLayerCapOf({ effects: [ref({ bondCap: { cap: 500 } }, { hexId: BREAK_LIMIT_HEX_ID })] }), BOND_LAYER_CAP, 'a smaller number never lowers the official cap');
  assert.equal(bondLayerCapOf({ effects: [ref({ bondCap: { cap: 'x' } }, { hexId: BREAK_LIMIT_HEX_ID })] }), BOND_LAYER_CAP, 'a non-numeric cap is ignored');
  assert.equal(bondLayerCapOf({ effects: [ref({ bondCap: { cap: -5 } }, { hexId: BREAK_LIMIT_HEX_ID })] }), BOND_LAYER_CAP);
  assert.equal(bondLayerCapOf({ effects: [{ id: 'hex:hex_somethingelse', key: 'hex:hex_somethingelse', params: { bondCap: { cap: 9999 } }, data: { hexId: 'hex_somethingelse' } }] }), BOND_LAYER_CAP, 'another card does not raise it');
  // 认 key 的老 ref（没有 data.hexId）
  assert.equal(bondLayerCapOf({ effects: [{ key: `hex:${BREAK_LIMIT_HEX_ID}`, params: { bondCap: { cap: 9999 } } }] }), 9999);
  // 策略「管理员」的复制：第二张 ref 的 id 带 #1，key / data.hexId 仍是本卡
  assert.equal(bondLayerCapOf({ effects: [{ id: `hex:${BREAK_LIMIT_HEX_ID}#1`, key: `hex:${BREAK_LIMIT_HEX_ID}`, params: { bondCap: { cap: 9999 } }, data: { hexId: BREAK_LIMIT_HEX_ID, copySeq: 1 } }] }), 9999);
});

// ---- 3. 备战侧: addLayers / 预览 / setLayers ----------------------------------------------------------------------------

test('备战: 拥有者的加层越过 999（999 + 500 → 1499），停在 9999；没有卡的玩家仍然 999', () => {
  const h = fresh();
  const m = h.m;
  const owner = h.ps('p_0');
  const plain = h.ps('ai_0');
  applyHex(m, owner, CARD);
  assert.equal(bondLayerCapOf(owner), 9999, '拥有者：9999');
  assert.equal(bondLayerCapOf(plain), BOND_LAYER_CAP, '没卡：999（只对拥有者）');

  owner.layers.yanShip = BOND_LAYER_CAP;
  owner.recompute();
  assert.equal(owner.layerGainOf('yanShip', 500), 500, '预览：999 之上还有 500 的空间');
  assert.equal(owner.addLayers('yanShip', 500), 500, '真正的加层与预览同一个数');
  assert.equal(owner.layers.yanShip, 1499, '999 + 500 = 1499');
  assert.equal(owner.layerGainOf('yanShip', 10000), 8500, '预览：到 9999 还剩 8500');
  assert.equal(owner.addLayers('yanShip', 10000), 8500);
  assert.equal(owner.layers.yanShip, 9999, 'never past 9999');
  assert.equal(owner.addLayers('yanShip', 1), 0, 'at 9999: nothing, no cue');
  owner.layers.yanShip = BOND_LAYER_CAP;
  owner.recompute();
  assert.equal(owner.setLayers('yanShip', 12000), 9999, 'setLayers 用同一个上限');

  plain.layers.yanShip = BOND_LAYER_CAP;
  plain.recompute();
  assert.equal(plain.layerGainOf('yanShip', 500), 0, 'no card: still 999');
  assert.equal(plain.addLayers('yanShip', 500), 0);
  plain.layers.yanShip = 100;
  plain.recompute();
  assert.equal(plain.setLayers('yanShip', 5000), BOND_LAYER_CAP, 'setLayers: still 999 without the card');
  checkInvariants(m);
  m.dispose();
});

// ---- 4. 战斗 input + 结算 -----------------------------------------------------------------------------------------------

test('战斗: PlayerBattleInput 带拥有者的 cap；settle 按同一个上限结算战斗内加层', () => {
  const h = makeMatch({
    mode: 'coop', humans: 2, seed: 97, fake: true,
    script: (b) => (b.round === 1 && b.kind === 'normal' ? { layerGains: { p_0: { yanShip: 500 }, p_1: { yanShip: 500 } } } : {}),
  }).start();
  const m = h.m;
  const owner = h.ps('p_0');
  const plain = h.ps('p_1');
  applyHex(m, owner, CARD);
  h.toPrep(1);
  owner.layers.yanShip = BOND_LAYER_CAP;
  plain.layers.yanShip = BOND_LAYER_CAP;
  owner.recompute();
  plain.recompute();
  const first = FakeBattle.instances.length;
  h.drive(() => m.phase === PHASE.PREP && m.round === 2);
  const inputOf = (pid) => FakeBattle.instances.slice(first)
    .filter((x) => x.kind === 'normal' && x.round === 1)
    .map((x) => (Array.isArray(x.opts.players) ? x.opts.players : []).find((p) => p && p.playerId === pid))
    .find(Boolean);
  assert.equal(inputOf('p_0').bondLayerCap, 9999, 'the owner\'s battle input carries 9999');
  assert.equal(inputOf('p_1').bondLayerCap, BOND_LAYER_CAP, 'a player without the card carries 999');
  assert.equal(owner.layers.yanShip, 1499, 'settle: 999 + 500 (the owner\'s cap)');
  assert.equal(plain.layers.yanShip, BOND_LAYER_CAP, 'settle: a player without the card gains nothing at 999');
  checkInvariants(m);
  m.dispose();
});

// ---- 5. 战斗内: sim addLayers -------------------------------------------------------------------------------------------

test('战斗内: Battle.addLayers 停在 input 的 bondLayerCap（9999），没有它就是 999', () => {
  const bonds = () => ({ yanShip: { count: 3, active: true, tier: 1, layers: 995 } });
  const owner = makeBattle({ content: 'none', bonds: bonds() });
  owner.step();
  owner.b.getPlayer('p1').input.bondLayerCap = 9999;
  assert.equal(owner.b.addLayers('p1', 'yanShip', 500, 'test'), 500, 'the owner passes 999');
  assert.equal(owner.b.getPlayer('p1').bonds.yanShip.layers, 1495);
  assert.equal(owner.b.addLayers('p1', 'yanShip', 10000, 'test'), 8504, 'room left to 9999');
  assert.equal(owner.b.getPlayer('p1').bonds.yanShip.layers, 9999);
  assert.equal(owner.b.addLayers('p1', 'yanShip', 1, 'test'), 0, 'at 9999: nothing');

  const plain = makeBattle({ content: 'none', bonds: bonds() });
  plain.step();
  assert.equal(plain.b.addLayers('p1', 'yanShip', 500, 'test'), 4, 'no cap in the input: 995 → 999');
  assert.equal(plain.b.addLayers('p1', 'yanShip', 1, 'test'), 0);

  // battle 级字段（没有 per-player input 时的来源，workshop / 直接构 battle 的调用方）
  const battleWide = makeBattle({ content: 'none', bonds: bonds() });
  battleWide.step();
  battleWide.b.bondLayerCap = 9999;
  assert.equal(battleWide.b.addLayers('p1', 'yanShip', 500, 'test'), 500);
});

// ---- 6. 结算预览 + 校验 + 不变量 ----------------------------------------------------------------------------------------

test('bondsMeta.bondsWithGains: 界面预览按同一个上限（缺省 999，拥有者 9999）', () => {
  const bonds = { yanShip: { count: 3, active: true, tier: 1, layers: BOND_LAYER_CAP } };
  const gains = { yanShip: 500 };
  assert.equal(bondsWithGains(bonds, gains).yanShip.layers, BOND_LAYER_CAP, 'default: at the cap, nothing');
  assert.equal(bondsWithGains(bonds, gains, 9999).yanShip.layers, 1499, 'the owner: 999 + 500');
  assert.equal(bondsWithGains(bonds, gains, 9999).yanShip.layers, 1499, 'and again (pure: no mutation)');
  assert.equal(bonds.yanShip.layers, BOND_LAYER_CAP, 'the input object is untouched');
  assert.equal(bondsWithGains(bonds, null, 9999), bonds, 'no gains: the same object');
});

test('客户端结果校验: 拥有者的 9999 允许的加层被接受，同样的加层没有卡就被拒', () => {
  const gd = DATA;
  // 从 995 层开始：官方的房间是 4（→999），拥有者是 9004（→9999）；这一场的平铺上限是 60 + 4·round = 80
  const spec = (cap) => ({
    kind: 'normal', round: 5, timeLimit: 60, flags: { layerGainsEnabled: true }, spawns: [],
    players: [{
      playerId: 'p_0', seat: 0, side: 'L', colOffset: 0, units: [],
      bonds: { yanShip: { count: 3, active: true, tier: 1, layers: 995 } },
      ...(cap == null ? {} : { bondLayerCap: cap }),
    }],
  });
  const raw = {
    reason: 'cleared', time: 10,
    perPlayer: { p_0: { killed: 0, total: 0, leaked: [], perfect: true, coins: 0, layerGains: { yanShip: 50 }, unitsEnd: [], unitStats: [] } },
  };
  assert.equal(specBounds(spec(9999), gd).players.get('p_0').bondLayerCap, 9999, 'specBounds 读 input 的 cap');
  assert.equal(specBounds(spec(null), gd).players.get('p_0').bondLayerCap, BOND_LAYER_CAP, 'missing → 官方 999');
  assert.equal(specBounds(spec(0), gd).players.get('p_0').bondLayerCap, BOND_LAYER_CAP, 'a non-positive cap → 官方 999');
  const ok = validateClientResult(spec(9999), raw, { gd });
  assert.equal(ok.ok, true, `the owner's +50 under 9999 is accepted (got ${JSON.stringify(ok)})`);
  assert.equal(ok.result.perPlayer.p_0.layerGains.yanShip, 50);
  const no = validateClientResult(spec(null), raw, { gd });
  assert.equal(no.ok, false, 'without the card the same +50 passes the 4 layers left under 999');
  assert.equal(no.reason, 'layer bound');
});

test('不变量: 1499 层在拥有者身上合法，在没有卡的人身上是违规', () => {
  const h = fresh({ seed: 43 });
  const m = h.m;
  const owner = h.ps('p_0');
  const plain = h.ps('ai_0');
  applyHex(m, owner, CARD);
  owner.layers.yanShip = 1499;
  owner.recompute();
  const layersOf = (pid) => collectViolations(m).filter((v) => v.startsWith(`${pid}: `) && v.includes('layers'));
  assert.deepEqual(layersOf('p_0'), [], 'the owner\'s 1499 is legal under 9999');
  plain.layers.yanShip = 1499;
  plain.recompute();
  assert.deepEqual(layersOf('p_0'), [], 'still legal for the owner');
  assert.equal(layersOf('ai_0').length, 1, 'without the card 1499 violates the 999 cap');
  m.dispose();
});

// ---- 7. 客户端显示 -----------------------------------------------------------------------------------------------------

test('客户端: 盟约条按拥有者的上限显示实时层数（缺省 999，拥有者 9999）', () => {
  const list = [{ bondId: 'yanShip', count: 3, active: true, tier: 1, layers: 900 }];
  assert.equal(withLiveLayers(list, { yanShip: 1500 })[0].layers, BOND_LAYER_CAP, 'default: clamped at 999');
  assert.equal(withLiveLayers(list, { yanShip: 1500 }, 9999)[0].layers, 1500, 'the owner sees 1500');
  assert.equal(withLiveLayers(list, { yanShip: 12000 }, 9999)[0].layers, 9999, 'never past 9999');
  assert.equal(withLiveLayers(list, { yanShip: 1500 }, 0)[0].layers, 1500, '0 = no cap');
  // a bond that gained without being listed joins the list, clamped the same way
  const joined = withLiveLayers(list, { indomShip: 12000 }, 9999);
  assert.equal(joined.find((b) => b.bondId === 'indomShip').layers, 9999);
});
