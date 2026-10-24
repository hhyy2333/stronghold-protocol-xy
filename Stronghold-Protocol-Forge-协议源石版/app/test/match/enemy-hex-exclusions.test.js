// 业主 2026-10-24「不要让敌方协议隐匿和势不可挡一起出现」：抽取时必须互斥。
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { pickEnemyHex, enemyHexConflicts, ENEMY_HEX_EXCLUSIONS } from '../../shared/hextech.js';
import { createRng } from '../../server/sim/rng.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const HEXTECH = JSON.parse(readFileSync(path.join(ROOT, 'data', 'hextech.json'), 'utf8'));
const POOL = Object.values(HEXTECH.enemyHexes || {});
const RARITIES = [...new Set(POOL.map((h) => h.rarity))].sort();

test('隐匿 / 势不可挡: the exclusion table names the pair and the card ids resolve', () => {
  assert.deepEqual(ENEMY_HEX_EXCLUSIONS, [['ehex_stealth', 'ehex_unstoppable']]);
  for (const id of ENEMY_HEX_EXCLUSIONS[0]) assert.ok(HEXTECH.enemyHexes[id], `${id} is in the roster`);
  assert.equal(enemyHexConflicts('ehex_unstoppable', ['ehex_stealth']), true, 'stealth first ⇒ 势不可挡 is refused');
  assert.equal(enemyHexConflicts('ehex_stealth', ['ehex_unstoppable']), true, 'and the other order too');
  assert.equal(enemyHexConflicts('ehex_stealth', ['ehex_stealth']), false, 'the same card is not a conflict');
  assert.equal(enemyHexConflicts('ehex_hush', ['ehex_stealth']), false, 'unrelated cards stay available');
});

test('隐匿 / 势不可挡: a long run of draws never yields both', () => {
  for (let seed = 1; seed <= 200; seed++) {
    const rng = createRng(seed);
    const owned = [];
    for (let i = 0; i < 14; i++) {
      const rarity = RARITIES[Math.floor(rng() * RARITIES.length)] || RARITIES[0];
      const id = pickEnemyHex(rng, { pool: POOL, owned, rarity });
      if (!id) break;
      owned.push(id);
    }
    const both = owned.includes('ehex_stealth') && owned.includes('ehex_unstoppable');
    assert.equal(both, false, `seed ${seed} drew both: ${owned.join(',')}`);
  }
});

test('隐匿 / 势不可挡: the pool still offers the other one once the first is owned', () => {
  const rng = createRng(7);
  // with 隐匿 owned, a draw aimed at 势不可挡's rarity must fall back to another card of that rarity (or nothing)
  const id = pickEnemyHex(rng, { pool: POOL, owned: ['ehex_stealth'], rarity: HEXTECH.enemyHexes.ehex_unstoppable.rarity });
  assert.notEqual(id, 'ehex_unstoppable', `drew ${id}`);
});
