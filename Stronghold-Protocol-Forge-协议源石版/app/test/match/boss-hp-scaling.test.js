// The Final Assault / Hidden Core leader pool = bloodPoint[difficulty] × the players alive when the fight starts (solo
// × 1) — the owner's decision of 2026-10-06, adopting PR #209 by @qingjingshenghuo (these tests are ported from it);
// it replaces the fixed pool of 「保持固定血量」 (DESIGN §20.9 / §20.10), which config bossHpScale still restores
// (DESIGN §25.13.4, server/match/gamedata.js bossPoolShareOf).
// The owner's addition of 2026-10-13 multiplies that by 总协议源石阶数 ÷ 人数 (floored at 1): a real match whose seats
// drafted cards therefore has a LARGER pool than the raw table value, which is why the match-level assertions below go
// through `bossPoolHpFor` (the one call bossRounds/audit use) instead of the plain formula.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeMatch, DATA } from './harness.js';
import { GameData } from '../../server/match/gamedata.js';
import { bossPoolHp, SharedBossPool } from '../../server/match/finalAssault.js';
import { bossHexTierMul, bossPoolHpFor } from '../../server/match/hextech.js';
import { makeBattle } from '../helpers/battleHarness.js';

const DIFFS = ['FUNNY', 'NORMAL', 'HARD', 'ABYSS'];

test('every leader and difficulty: bloodPoint × the players alive (co-op), × 1 solo', () => {
  for (const difficulty of DIFFS) {
    const gd = new GameData(DATA, `mode_multi_${difficulty.toLowerCase()}`);
    const solo = new GameData(DATA, `mode_single_${difficulty.toLowerCase()}`);
    for (const id of Object.keys(DATA.bosses)) {
      const base = DATA.bosses[id].bloodPoint[difficulty];
      for (const n of [1, 2, 3, 4]) assert.equal(bossPoolHp(gd, id, n), base * n, `${id} ${difficulty} ×${n}`);
      assert.equal(bossPoolHp(solo, id, 1), base, `${id} ${difficulty} solo`);
    }
  }
});

// 协议源石 (the owner's request of 2026-10-13, halved on 2026-10-14): the pool is also × (总协议源石阶数 ÷ 人数 ÷ 2),
// floored at 1. The rule and its reading of the owner's words live in server/match/hextech.js bossHexTierMul.
test('the 协议源石 multiplier is 总阶数 ÷ 人数 ÷ 2, floored at 1, and only the PLAYER side counts', () => {
  const h = makeMatch({ mode: 'coop', difficulty: 'NORMAL', humans: 2, bots: 0, fake: true }).start();
  h.toPrep(1);
  const m = h.m;
  const [a, b] = m.alivePlayers();
  const gd = m.gd;
  const isHexRef = (e) => e && typeof e.key === 'string' && e.key.startsWith('hex:');
  // no cards at all: 1 (a table that has drawn nothing never shrinks the leader)
  for (const ps of m.players.values()) ps.effects = ps.effects.filter((e) => !isHexRef(e));
  assert.equal(bossHexTierMul(m, [a, b]), 1, 'no cards ⇒ ×1');
  // two 1阶 cards across two players: (1+1)/2 = 1, halved to 0.5 → the floor keeps it at 1 (the halving scales GROWTH)
  a.effects.push({ key: 'hex:hex_stipend', data: { hexId: 'hex_stipend', rarity: 'silver' } });
  b.effects.push({ key: 'hex:hex_echo', data: { hexId: 'hex_echo', rarity: 'silver' } });
  assert.equal(bossHexTierMul(m, [a, b]), 1, '(1 + 1) / 2 / 2 = 0.5 → floored to 1');
  // a 3阶 card: (1 + 1 + 3) / 2 / 2 = 1.25 — the multiplier is fractional, the pool rounds
  b.effects.push({ key: 'hex:hex_double', data: { hexId: 'hex_double', rarity: 'prismatic' } });
  assert.equal(bossHexTierMul(m, [a, b]), 1.25, '(1 + 1 + 3) / 2 / 2');
  // the SAME cards read as a 1-player set: 4 / 1 / 2 = 2 (the denominator is the players handed in)
  assert.equal(bossHexTierMul(m, [b]), 2, 'one player owning a 1阶 and a 3阶 card');
  // four 3阶 cards across two players: (12) / 2 / 2 = 3 — the halving is visible once the table is carded up
  const four = makeMatch({ mode: 'coop', difficulty: 'NORMAL', humans: 2, bots: 0, fake: true }).start();
  four.toPrep(1);
  const [c, d] = four.m.alivePlayers();
  for (const ps of four.m.players.values()) ps.effects = ps.effects.filter((e) => !isHexRef(e));
  for (const ps of [c, d]) for (const id of ['hex_double', 'hex_bondfission']) ps.effects.push({ key: `hex:${id}`, data: { hexId: id, rarity: 'prismatic' } });
  assert.equal(bossHexTierMul(four.m, [c, d]), 3, '(3 × 4) / 2 players / 2');
  four.m.dispose();
  // enemy hexes are the ENEMY's cards: they never raise the players' numerator
  m.enemyHexes.push({ id: 'ehex_echo', round: 1 });
  assert.equal(bossHexTierMul(m, [a, b]), 1.25, 'the enemy side is not counted');
  // and the pool itself takes the factor (bloodPoint × alive × the halved ratio)
  const base = gd.boss(m.bossId).bloodPoint[gd.difficulty];
  assert.equal(bossPoolHpFor(m, m.bossId, [a, b]), Math.round(base * 2 * 1.25), 'bloodPoint × 2 alive × 1.25');
  assert.equal(bossPoolHpFor(m, m.bossId, [a]), base, 'a one-player table with one 1阶 card: the floor holds it at 1');
  // the floor: the multiplier can never fall below 1, whatever the caller passes
  assert.equal(bossPoolHp(gd, m.bossId, 2, 0.1), base * 2, 'a factor under 1 is ignored');
  m.dispose();
});

for (const hidden of [false, true]) {
  test(`R${hidden ? 15 : 14}: the round's pool leaves out two departed players`, () => {
    const h = makeMatch({ humans: 4, difficulty: 'HARD', fake: true, instant: false }).start();
    h.toPrep(1);
    const m = h.m;
    m.onLeave('p_2');
    m.onLeave('p_3');
    assert.equal(m.alivePlayers().length, 2);
    assert.equal(h.ps('p_2').alive, false);
    m.round = hidden ? 15 : 14;
    m.teamLp = 50;
    m.bossId = 'boss_1';
    m.hiddenBossId = 'boss_9';
    m._planBossWaves();
    m.startFinalAssault(hidden);
    const id = hidden ? m.hiddenBossId : m.bossId;
    assert.equal(m.bossPool.maxHp, bossPoolHpFor(m, id, m.alivePlayers()), 'bloodPoint × 2 alive × the 协议源石 factor');
    m.dispose();
  });
}

test('disconnected players (AI 托管) and bots count; an eliminated player does not', () => {
  const h = makeMatch({ humans: 3, bots: 1, fake: true, instant: false }).start();
  h.toPrep(1);
  h.m.onDisconnect('p_1');
  h.ps('p_2').eliminate(1);
  h.m.round = 14;
  h.m._planBossWaves();
  h.m.startFinalAssault(false);
  assert.equal(h.m.alivePlayers().length, 3);
  assert.equal(h.m.bossPool.maxHp, bossPoolHpFor(h.m, h.m.bossId, h.m.alivePlayers()), 'bloodPoint × 3 alive × the 协议源石 factor');
  h.m.dispose();
});

test('config restores the fixed pool of 0.1.x (perPlayer false, solo 0.25) — GameData and the plain-object fallback agree', () => {
  const data = structuredClone(DATA);
  data.config.bossHpScale = { ...data.config.bossHpScale, perPlayer: false, solo: 0.25 };
  for (const modeId of ['mode_single_abyss', 'mode_multi_abyss']) {
    const gd = new GameData(data, modeId);
    const base = data.bosses.boss_8.bloodPoint.ABYSS;
    const expected = gd.isSolo ? base * 0.25 : base;
    for (const n of [1, 2, 3, 4]) {
      assert.equal(gd.bossPoolHp('boss_8', n), expected, `${modeId} ×${n}`);
      assert.equal(bossPoolHp(gd, 'boss_8', n), expected);
      // a caller's game-data object without bossPoolShare reads the same config through bossPoolShareOf
      const plain = { boss: (id) => gd.boss(id), difficulty: gd.difficulty, mode: gd.mode, config: gd.config, isSolo: gd.isSolo };
      assert.equal(bossPoolHp(plain, 'boss_8', n), expected);
    }
  }
  // and the per-player rule through the same fallback
  const gd = new GameData(DATA, 'mode_multi_abyss');
  const plain = { boss: (id) => gd.boss(id), difficulty: gd.difficulty, mode: gd.mode, config: gd.config, isSolo: false };
  assert.equal(bossPoolHp(plain, 'boss_8', 3), DATA.bosses.boss_8.bloodPoint.ABYSS * 3);
});

test('only the leader\'s pool scales: escorts and the Hidden Core\'s parts keep their stats', () => {
  for (const kind of ['boss', 'hidden']) {
    const bossKey = kind === 'boss' ? 'enemy_9013_acstmk' : 'enemy_9013_acstmk_2';
    const snapshot = (n) => {
      const h = makeBattle({
        kind, content: 'none', sharedBoss: new SharedBossPool(7200000 * n), autoFinish: false,
        enemies: [{ key: bossKey, tag: 'boss', pos: [3, 10] }, { key: 'enemy_1427_lrnazg', pos: [2, 10] }, { key: 'enemy_9014_acstma', pos: [4, 10] }],
      });
      h.step();
      return [bossKey, 'enemy_1427_lrnazg', 'enemy_9014_acstma'].map((key) => {
        const e = h.enemy(key);
        assert.ok(e, `spawned ${key}`);
        return { hp: e.s.maxHp, atk: e.s.atk, def: e.s.def };
      });
    };
    const one = snapshot(1), four = snapshot(4);
    assert.equal(four[0].hp, one[0].hp * 4, `${kind}: the leader shows the pool`);
    assert.equal(four[0].atk, one[0].atk);
    assert.equal(four[0].def, one[0].def);
    assert.deepEqual(four.slice(1), one.slice(1), `${kind}: escort and part unchanged`);
  }
});
