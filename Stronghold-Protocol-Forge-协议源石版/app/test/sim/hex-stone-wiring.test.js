// test/sim/hex-stone-wiring.test.js — 第八批（第 7 回合盟约专属协议）在生产 install() 里全部装得上、跑得动。
// 这里不测具体数值（各自的 hex-stone-*.test.js 测），只测「8 张卡同时在场时 install() 不报错、战斗能推进」。
import test from 'node:test';
import assert from 'node:assert/strict';
import { makeBattle, chessRec, enemyRec } from '../helpers/battleHarness.js';
import { BATTLE_SPEC_KEYS, HEX_SCRIPT_KEYS } from '../../server/sim/content/hextech.js';

const CARDS = {
  hex_yan_ember: 'yanEmber', hex_sargon_oasis: 'sargonOasis', hex_kjerag_thaw: 'kjeragThaw',
  hex_laterano_sanctuary: 'lateranoSanctuary', hex_egir_symbiosis: 'egirSymbiosis', hex_siracusa_godfather: 'siracusaGodfather',
};
const refOf = (id, key) => ({
  id: 'hex:' + id, key: 'hex:' + id, name: id, desc: '', iconKind: 'hex', iconId: null, counter: null, battle: true,
  params: { [key]: { healPct: 5, shieldHits: 1, shieldPct: 100, burnPct: 2, burstLayer: 200, steadLayer: 300, statPct: 80, vulnPct: 10, maxPct: 200, layers: 5, coldMul: 180, frozenMul: 360, slowPct: 60, slowSec: 6, buffLayer: 75, atkPct: 50, hpPct: 50 }, hexId: id },
  data: { hexId: id },
});

test('all six battle scripts are declared in BATTLE_SPEC_KEYS and HEX_SCRIPT_KEYS', () => {
  for (const [id, key] of Object.entries(CARDS)) {
    assert.ok(BATTLE_SPEC_KEYS.includes(key), id + ': ' + key + ' in BATTLE_SPEC_KEYS');
    assert.equal(HEX_SCRIPT_KEYS[id], key, id + ': ' + key + ' in HEX_SCRIPT_KEYS');
  }
});

test('a real battle with all eight cards installed runs without engine errors', () => {
  const op = (id, bonds) => chessRec({ id, bonds, skill: null, stats: { atk: 500, maxHp: 5000, def: 100, res: 0, blockCnt: 1 } });
  const defs = {
    chess: {
      yan: op('yan', ['yanShip']), sargon: op('sargon', ['sargonShip']), kjerag: op('kjerag', ['kjeragShip']),
      laterano: op('laterano', ['lateranoShip']), egir: op('egir', ['egirShip']), siracusa: op('siracusa', ['siracusaShip']),
      kazimierz: op('kazimierz', ['kazimierzShip']),
    },
    enemies: { e_d: enemyRec({ key: 'e_d', hp: 1e7, atk: 0, def: 0, res: 0, speed: 0 }) },
  };
  const effects = Object.entries(CARDS).map(([id, key]) => refOf(id, key));
  effects.push({ id: 'hex:hex_kazimierz_knight', key: 'hex:hex_kazimierz_knight', name: '骑士', desc: '', iconKind: 'hex', counter: null, battle: true, params: { kazimierzKnight: { transferPct: 100, trueMul: 3, indomLayers: 5, lockSec: 5 }, hexId: 'hex_kazimierz_knight' }, data: { hexId: 'hex_kazimierz_knight' } });
  const h = makeBattle({
    defs,
    players: [{ playerId: 'p1', seat: 0, side: 'L', colOffset: 0, bonds: {}, playerEffects: effects, units: [
      { uid: 1, kind: 'chess', chessId: 'yan', row: 9, col: 2 },
      { uid: 2, kind: 'chess', chessId: 'sargon', row: 10, col: 2 },
      { uid: 3, kind: 'chess', chessId: 'kjerag', row: 11, col: 2 },
      { uid: 4, kind: 'chess', chessId: 'laterano', row: 12, col: 2 },
      { uid: 5, kind: 'chess', chessId: 'egir', row: 9, col: 3 },
      { uid: 6, kind: 'chess', chessId: 'siracusa', row: 10, col: 3 },
      { uid: 7, kind: 'chess', chessId: 'kazimierz', row: 11, col: 3, items: ['chess_item_9_98_e_a'] },
    ] }],
    enemies: [{ key: 'e_d', time: 0, pos: [12, 8] }],
    autoFinish: false, timeLimit: 5,
  });
  h.run(2);
  h.invariants();
  assert.equal(h.b.aliveEnemies().length, 1, 'the battle still runs');
});
