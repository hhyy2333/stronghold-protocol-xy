// test/sim/hex-stone-wiring.test.js — 第 7 回合盟约专属协议（第十九批 + 第二十批）在生产 install() 里全部装得上、跑得动。
// 这里不测具体数值（各自的 hex-stone-*.test.js 测），只测「10 张卡同时在场时 install() 不报错、战斗能推进」。
import test from 'node:test';
import assert from 'node:assert/strict';
import { makeBattle, chessRec, enemyRec } from '../helpers/battleHarness.js';
import { BATTLE_SPEC_KEYS, HEX_SCRIPT_KEYS } from '../../server/sim/content/hextech.js';

/** 每张专属卡：脚本键 + 卡面参数（模块只读卡面，所以这里给的是最小可用参数）。 */
const CARDS = {
  hex_yan_ember: { key: 'yanEmber', effect: { burnPct: 2, burstLayer: 200, steadLayer: 300, steadRatio: 40, thorn: 850, thornPerLayer: 10, fragile: 40, fragileSec: 5, cd: 0.2 } },
  hex_sargon_oasis: { key: 'sargonOasis', effect: { shieldPct: 100 } },
  hex_kjerag_thaw: { key: 'kjeragThaw', effect: { layers: 5, coldMul: 180, frozenMul: 360, slowPct: 60, slowSec: 6, buffLayer: 75, atkPct: 50, hpPct: 50 } },
  hex_laterano_sanctuary: { key: 'lateranoSanctuary', effect: { shieldPct: 5, shieldHits: 1, aspd: 50, atkPct: 80, snipeEvery: 3, snipePerAmmo: 325 } },
  hex_egir_symbiosis: { key: 'egirSymbiosis', effect: { statPct: 80 } },
  hex_siracusa_godfather: { key: 'siracusaGodfather', effect: { vulnPct: 10, maxPct: 200 } },
  // twentieth batch (业主 2026-10-31): the two 2 阶 exclusive cards
  hex_victoria_decay: {
    key: 'victoriaDecay',
    effect: {
      equipCount: 3, drainPct: 0.5, buffCount: 5, buffHpPct: 80,
      hpFlat: 50, hpPerLayer: 10, defFlat: 50, defPerLayer: 3, atkFlat: 100, atkPerLayer: 5, aspd: 7, aspdPerLayer: 0.5,
      extraDrainPct: 0.5, hammerKeys: ['chess_item_1_01_e'], highCount: 7, highDrainPct: 1,
      decaySec: 8, decayKills: 3, decayAtkPct: 100, decayAspd: 7, decayAspdPerLayer: 0.5, decayHealPct: 50,
    },
  },
  hex_yan_beasts: {
    key: 'yanBeasts',
    effect: {
      spCostPct: 5, spCostTierPct: 5, censerKey: 'chess_item_6_03_e',
      summonPct: 80, summonPerLayerPct: 0.4, regenCount: 5, regen: 20, regenPerLayer: 0.5,
      flameCount: 7, flameTargets: 2, flameScale: 60, flameScalePerLayer: 0.2,
    },
  },
  // twenty-first batch (业主 2026-10-31；2026-11-01 改口径：霜寒 10 层、八格真伤、5 秒窗口)
  hex_kjerag_frostdeath: {
    key: 'kjeragFrostDeath',
    effect: {
      unlockCount: 3, frostMax: 10, defPctPerStack: 5, aspdPerStack: 5, sealSec: 5, idleFrostSec: 5,
      sealedAuraDmg: 100, sealedAuraDmgPerLayer: 40, sealedAuraRadius: 1, sealedAuraKillLayers: 1,
      highCount: 6, deathFreezeSec: 5, deathRemoveStacks: 4,
      allSealedDmg: 100, allSealedDmgPerLayer: 50, allSealedSec: 5, allSealedColdSec: 5, allSealedKillLayers: 2,
    },
  },
  // twenty-second batch (业主 2026-10-31): 卡西米尔 2 阶专属
  hex_kazimierz_knightgold: {
    key: 'kazimierzKnightGold',
    effect: {
      killStep: 4, goldBase: 1, goldPerLayer: 50, goldCap: 9, highCount: 5,
      atkFlat: 30, atkPerLayer: 1, rangeExtend: 1,
      enemyTiers: [
        { min: 0, key: 'enemy_1183_mlasrt', count: 1 }, { min: 50, key: 'enemy_1183_mlasrt', count: 1 },
        { min: 100, key: 'enemy_1184_cadkgt_3', count: 1 }, { min: 200, key: 'enemy_1513_dekght', count: 1 },
        { min: 300, key: 'enemy_1513_dekght_2', count: 1 },
      ],
      sevenCount: 7,
    },
  },
  // twenty-third batch (业主 2026-10-31): 普通卡【特限恢复】（ISW + RA 两个脚本共用一个 key）
  hex_mode_modules: { key: 'modeModules', effect: { level: 3, types: ['ISW', 'SO', 'RA'] } },
  // twenty-fourth batch (业主 2026-10-31): 3 阶普通卡【死亡之舞】
  hex_deathdance: { key: 'deathDance', effect: { delaySec: 3, tickSec: 0.5, healPct: 5 } },
};
const refOf = (id, { key, effect }) => ({
  id: 'hex:' + id, key: 'hex:' + id, name: id, desc: '', iconKind: 'hex', iconId: null, counter: null, battle: true,
  params: { [key]: { ...effect }, hexId: id },
  data: { hexId: id },
});

test('all twelve battle scripts are declared in BATTLE_SPEC_KEYS and HEX_SCRIPT_KEYS', () => {
  for (const [id, card] of Object.entries(CARDS)) {
    assert.ok(BATTLE_SPEC_KEYS.includes(card.key), id + ': ' + card.key + ' in BATTLE_SPEC_KEYS');
    assert.equal(HEX_SCRIPT_KEYS[id], card.key, id + ': ' + card.key + ' in HEX_SCRIPT_KEYS');
  }
});

test('a real battle with all thirteen cards installed runs without engine errors', () => {
  const op = (id, bonds) => chessRec({ id, bonds, skill: null, stats: { atk: 500, maxHp: 5000, def: 100, res: 0, blockCnt: 1 } });
  const defs = {
    chess: {
      yan1: op('yan1', ['yanShip']), yan2: op('yan2', ['yanShip']), yan3: op('yan3', ['yanShip']),
      sargon: op('sargon', ['sargonShip']), kjerag1: op('kjerag1', ['kjeragShip']),
      kjerag2: op('kjerag2', ['kjeragShip']), kjerag3: op('kjerag3', ['kjeragShip']),
      laterano: op('laterano', ['lateranoShip']), egir: op('egir', ['egirShip']), siracusa: op('siracusa', ['siracusaShip']),
      kazimierz: op('kazimierz', ['kazimierzShip']),
      victoria1: op('victoria1', ['victoriaShip']), victoria2: op('victoria2', ['victoriaShip']), victoria3: op('victoria3', ['victoriaShip']),
    },
    enemies: { e_d: enemyRec({ key: 'e_d', hp: 1e7, atk: 0, def: 0, res: 0, speed: 0 }) },
  };
  const effects = Object.entries(CARDS).map(([id, card]) => refOf(id, card));
  effects.push({ id: 'hex:hex_kazimierz_knight', key: 'hex:hex_kazimierz_knight', name: '骑士', desc: '', iconKind: 'hex', counter: null, battle: true, params: { kazimierzKnight: { transferPct: 100, trueMul: 2, indomLayers: 5, lockSec: 5 }, hexId: 'hex_kazimierz_knight' }, data: { hexId: 'hex_kazimierz_knight' } });
  const h = makeBattle({
    defs,
    players: [{ playerId: 'p1', seat: 0, side: 'L', colOffset: 0, bonds: {}, playerEffects: effects, units: [
      { uid: 1, kind: 'chess', chessId: 'yan1', row: 9, col: 2 },
      { uid: 2, kind: 'chess', chessId: 'sargon', row: 10, col: 2 },
      { uid: 3, kind: 'chess', chessId: 'kjerag1', row: 11, col: 2 },
      { uid: 4, kind: 'chess', chessId: 'laterano', row: 12, col: 2 },
      { uid: 5, kind: 'chess', chessId: 'egir', row: 9, col: 3 },
      { uid: 6, kind: 'chess', chessId: 'siracusa', row: 10, col: 3 },
      { uid: 7, kind: 'chess', chessId: 'kazimierz', row: 11, col: 3, items: ['chess_item_9_98_e_a'] },
      // 第二十批的两张卡要「在场 3 名不同」才会点亮：3 名**不同 id**的维多利亚 + 3 名不同 id 的炎
      { uid: 8, kind: 'chess', chessId: 'victoria1', row: 12, col: 3 },
      { uid: 9, kind: 'chess', chessId: 'victoria2', row: 9, col: 4 },
      { uid: 10, kind: 'chess', chessId: 'victoria3', row: 10, col: 4 },
      { uid: 11, kind: 'chess', chessId: 'yan2', row: 11, col: 4 },
      { uid: 12, kind: 'chess', chessId: 'yan3', row: 12, col: 4 },
      // 第二十一批：谢拉格也要 3 名不同
      { uid: 13, kind: 'chess', chessId: 'kjerag2', row: 9, col: 5 },
      { uid: 14, kind: 'chess', chessId: 'kjerag3', row: 10, col: 5 },
    ] }],
    enemies: [{ key: 'e_d', time: 0, pos: [12, 8] }],
    autoFinish: false, timeLimit: 5,
  });
  h.run(2);
  h.invariants();
  assert.equal(h.b.aliveEnemies().length, 1, 'the battle still runs');
  // 第二十批：两张卡的生产接线真的点着了（不只是「没报错」）
  assert.ok(h.b.allyUnits.some((u) => u.defId === 'enemy_9012_acloon'), '炎百兽 为每名炎干员召唤了炎佑');
  assert.ok(h.b.allyUnits.some((u) => u.defId === 'victoria1' && u.hp < u.s.maxHp), '衰朽的骄矜 的每秒流失在掉血');
});
