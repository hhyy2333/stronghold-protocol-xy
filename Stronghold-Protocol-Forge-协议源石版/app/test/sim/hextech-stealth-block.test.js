// 隐匿 (ehex_stealth) 与「无法被阻挡」的关系（业主 2026-10-20：「隐匿不应该把不能阻挡的怪隐匿」）。
//
// 这张卡解除隐匿的**唯一**途径是「被阻挡」。一个引擎永远不肯阻挡的单位（无法阻挡 / BLOCK_FREE、浮空、恐惧、沉睡）
// 就永远解不掉 —— 整片场地没有任何干员能选中它。这跟 2026-10-12 那条 次数怪 的裁决是同一个理由，只是判据换成
// 「blocking.js _checkBlock 拒收的那四个 flag」。
import test from 'node:test';
import assert from 'node:assert/strict';
import { makeBattle, chessRec, enemyRec } from '../helpers/battleHarness.js';

const guard = () => chessRec({ id: 'test_guard', stats: { maxHp: 2000, atk: 500, def: 200, res: 0, blockCnt: 1 }, skill: null });
const marcher = (key, over = {}) => enemyRec({ key, hp: 100000, atk: 100, def: 0, speed: 1, ...over });

function battle(enemyKey, over = {}, setup = null) {
  return makeBattle({
    defs: { chess: { test_guard: guard() }, enemies: { [enemyKey]: marcher(enemyKey, over) } },
    players: [{ playerId: 'p1', seat: 0, side: 'L', colOffset: 0, bonds: {}, playerEffects: [],
      units: [{ uid: 1, kind: 'chess', chessId: 'test_guard', row: 9, col: 6 }] }],
    enemies: [{ key: enemyKey, time: 0, route: 0 }],
    autoFinish: false, timeLimit: 30, captureNoisy: true, hooks: ['damaged'],
    flags: { enemyHexIds: ['ehex_stealth'] },
    setup,
  });
}

test('隐匿：一个天生无法阻挡的敌人不进入隐匿（否则整场点不到）', () => {
  const KEY = 'enemy_hardblock';
  // the kit layer runs at priority 100, ahead of the card's spawn hook: the flag is already there when 隐匿 looks
  const h = battle(KEY, {}, (b) => {
    b.on('enemySpawn', ({ enemy }) => {
      if (!enemy || enemy.defId !== KEY) return;
      b.addBuff(enemy, { key: 'ab:unblockable', persist: true, flags: { unblockable: true } });
    }, { priority: 100 });
  });
  h.run(0.5);
  const e = h.enemies()[0];
  assert.ok(e, 'the enemy is on the field (premise)');
  assert.equal(e.s.flags.unblockable, true, 'it really is unblockable (premise)');
  assert.ok(!e.findBuff('ab:stealth'), '隐匿 skips a unit the engine will never block');
  h.invariants();
});

test('隐匿：普通地面怪照旧开局隐匿（这条门没有放宽成「谁都不隐匿」）', () => {
  const h = battle('enemy_plain');
  h.run(0.5);
  const e = h.enemies()[0];
  assert.ok(e, 'premise: the enemy spawned');
  assert.ok(!e.s.flags.unblockable, 'premise: nothing blocks-free about it');
  assert.ok(e.findBuff('ab:stealth'), 'a blockable ground enemy still opens hidden');
  h.invariants();
});