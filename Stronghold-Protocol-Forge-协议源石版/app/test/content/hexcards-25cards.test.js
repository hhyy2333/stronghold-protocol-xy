// test/content/hexcards-25cards.test.js — 业主 2026-10-25 报的三条卡牌 bug，每条都钉住「改前红、改后绿」的那一面。
//
//   1.「两个装备尸山应该能合成」      → 尸山(_a) upgradeNum 2 + golden 指向 尸山·极(_b)；两件真的合成；
//                                       合成后的 _b 是「属性 ×1.5、技力 +2、回血 2%/s」（业主定下的数值）。
//   2.「好多盟约复制了没效果」        → 复制是第二份 EffectRef，纯被动卡也要按份生效：
//                                       盟约之主 被复制后 bondCountBonus 是 2 而不是 1。
//   3.「因小失大 + 盟约之主 一起出 bug」→ setBondCountBonus 改成**按来源**记账再求和：盟约之主 每回合
//                                       重置自己的选择时，不再擦掉 因小失大 放在同一盟约上的值。
//
// 驱动方式与 test/content/hexcards-15b.test.js 相同：真实 Battle + 生产同源的 hexHooks。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { makeBattle, chessRec, enemyRec } from '../helpers/battleHarness.js';
import { hexHooks } from '../../server/sim/content/hexcards/hooks.js';

const DATA = {
  hextech: JSON.parse(readFileSync(new URL('../../data/hextech.json', import.meta.url), 'utf8')),
  items: JSON.parse(readFileSync(new URL('../../data/items.json', import.meta.url), 'utf8')),
};

const A = 'chess_item_9_95_e_a';   // 尸山
const B = 'chess_item_9_95_e_b';   // 尸山·极

const refOf = (hexId) => {
  const rec = DATA.hextech.playerHexes[hexId];
  return { id: `hex:${hexId}`, key: `hex:${hexId}`, name: rec.name, desc: rec.desc, iconKind: 'hex',
    params: { ...rec.effect, hexId, rarity: rec.rarity }, data: { hexId, rarity: rec.rarity } };
};
const guard = (id, stats) => chessRec({ id, profession: 'WARRIOR', stats, skill: null });

// ---------------------------------------------------------------------------------------------------------------
// 1. 尸山 → 尸山·极

test('尸山 合成对: _a merges (upgradeNum 2, golden → _b), _b is a terminal form with the owner\'s numbers', () => {
  const a = DATA.items[A];
  const b = DATA.items[B];
  assert.ok(a && b, 'both 尸山 and 尸山·极 exist');
  assert.equal(a.mergeable, true, '_a merges');
  assert.equal(a.upgradeNum, 2, 'two copies');
  assert.equal(a.goldenId, B, '_a names its golden twin');
  assert.equal(a.upgradeChessId, B);
  assert.equal(b.mergeable, false, '_b does not merge further');
  assert.equal(b.params.attrScale, 1.5, '×1.5 attributes (业主 2026-10-25)');
  assert.equal(b.params.spRecovery, 2, '技力回复 +2');
  assert.equal(b.params.regenPct, 2, '回血 2%/s');
  assert.equal(a.params.attrScale, 1, '_a keeps ×1');
});

/** A carrier wearing `itemId` next to one mate it can eat; returns the carrier's post-battleStart stats. */
function corpsehill(itemId) {
  const h = makeBattle({
    defs: {
      chess: {
        test_carrier: guard('test_carrier', { maxHp: 2000, atk: 500, def: 200, res: 0, blockCnt: 1, spRecovery: 0 }),
        test_mate: guard('test_mate', { maxHp: 1500, atk: 300, def: 100, res: 10, blockCnt: 2, spRecovery: 0 }),
      },
      enemies: { enemy_dummy: enemyRec({ key: 'enemy_dummy', hp: 100000, atk: 0, speed: 0 }) },
    },
    players: [{
      playerId: 'p1', seat: 0, side: 'L', colOffset: 0, bonds: {}, playerEffects: [refOf('hex_corpsehill')],
      units: [
        { uid: 1, kind: 'chess', chessId: 'test_carrier', row: 10, col: 4, items: [itemId] },
        { uid: 2, kind: 'chess', chessId: 'test_mate', row: 11, col: 4 },
      ],
    }],
    enemies: [], content: 'full', autoFinish: false, timeLimit: 30,
  });
  h.b.hexHooks = hexHooks(h.b);
  h.step(3);
  const carrier = h.b.allyUnits.find((u) => u.uid === 1);
  const mate = h.b.allyUnits.find((u) => u.uid === 2);
  return {
    maxHp: carrier.s.maxHp, atk: carrier.s.atk, def: carrier.s.def, block: carrier.s.blockCnt,
    spRec: carrier.s.spRecovery, regen: carrier.s.hpRegen, ateMate: !mate.alive || !!mate.removed,
  };
}

test('尸山: the carrier eats its mates; 尸山·极 gives 1.5× their attributes, 技力+2, 回血 2%/s', () => {
  const plain = corpsehill(A);
  const merged = corpsehill(B);
  assert.equal(plain.ateMate, true, 'the carrier killed its mate (both items behave the same way)');
  assert.equal(merged.ateMate, true);
  // base 2000 + mate 1500 = 3500 for _a; ×1.5 of the mate for _b
  assert.equal(plain.maxHp, 3500, '_a: 2000 + 1500');
  assert.equal(merged.maxHp, 4250, '_b: 2000 + 1500×1.5');
  assert.equal(merged.atk - 500, (plain.atk - 500) * 1.5, 'atk scales ×1.5');
  assert.equal(plain.spRec, 1, '_a 技力回复 +1');
  assert.equal(merged.spRec, 2, '_b 技力回复 +2');
  // hpRegen = hpRecoveryPerSec + hpRegenRatio × maxHp → 1% and 2% of the carrier's own max HP
  assert.ok(Math.abs(plain.regen - 3500 * 0.01) < 0.5, `_a regen 1% (got ${plain.regen})`);
  assert.ok(Math.abs(merged.regen - 4250 * 0.02) < 0.5, `_b regen 2% (got ${merged.regen})`);
});

// ---------------------------------------------------------------------------------------------------------------
// 2 + 3. 复制 / 两张卡抢同一盟约
// These run on the real match dispatcher (the prep side), which is where bondCountBonus lives.

const { makeMatch, DATA: MATCH_DATA, give, legalTileFor } = await import('../match/harness.js');
const { applyBandHexCopy } = await import('../../server/match/hextech.js');

/** A solo match at PREP R1 with `bondId` operators fielded and the 管理员 band armed. */
/**
 * A solo match at PREP R1 with `bondId` operators fielded.
 * `admin` arms the 管理员 band (which auto-copies the first hex gained) — only the copy test wants that; the
 * 因小失大 × 盟约之主 test must NOT have it, or every card arrives twice and the numbers double for an unrelated reason.
 */
function prepWithBoard(bondId = 'preciShip', n = 4, seed = 4242, { admin = false } = {}) {
  const h = makeMatch({ mode: 'solo', difficulty: 'NORMAL', seed, fake: true, captureFrames: false }).start();
  h.toPrep(1);
  const ps = h.ps('p_0');
  if (admin) ps.bandId = 'band_admin';   // 管理员: the band that grants a copy
  const used = new Set();
  let placed = 0;
  for (const id of Object.keys(MATCH_DATA.chess)) {
    if (placed >= n) break;
    if (!(MATCH_DATA.chess[id].bonds || []).includes(bondId)) continue;
    try { const t = legalTileFor(h.m, ps, id, used); used.add(`${t[0]},${t[1]}`); give(h.m, ps, id, 'board', t); placed++; } catch { /* skip */ }
  }
  return { h, m: h.m, ps };
}

test('复制「盟约之主」: a copy is a second EffectRef and its bond-count line is added twice', () => {
  const { m, ps } = prepWithBoard('preciShip', 4, 4242, { admin: true });
  m.grantHex(ps, 'hex_overlord');
  applyBandHexCopy(m, ps, m.gd.hextech.playerHexes.hex_overlord);
  const refs = (ps.effects || []).filter((e) => (e.key || '').includes('hex_overlord'));
  assert.equal(refs.length, 2, 'the copy is its own ref');
  for (let r = 2; r <= 3; r++) { m.round = r; m.dispatch(ps, 'onRoundStart', { round: r }); }
  const lines = ps.bondCountBonusBySource || {};
  assert.equal(Object.keys(lines).length, 2, 'each ref keeps its own line');
  const bonus = ps.bondCountBonus || {};
  assert.equal(bonus.preciShip, 2, 'the two copies sum to 2 ("复制后效果翻倍")');
  m.dispose();
});

test('因小失大 + 盟约之主: 盟约之主\'s round-start reset never erases 因小失大\'s value for the same bond', () => {
  const { m, ps } = prepWithBoard();        // no 管理员 band: one ref per card, so the numbers are readable
  m.grantHex(ps, 'hex_pyrrhic');            // 因小失大: every 附加盟约 +1, every 核心盟约 −1
  const afterPyrrhic = { ...(ps.bondCountBonus || {}) };
  assert.equal(afterPyrrhic.preciShip, 1, '因小失大 wrote +1 for the 附加盟约');
  assert.equal(afterPyrrhic.yanShip, -1, '…and −1 for a 核心盟约');

  m.grantHex(ps, 'hex_overlord');           // 盟约之主: its pick gets −1 every round start
  for (let r = 2; r <= 4; r++) { m.round = r; m.dispatch(ps, 'onRoundStart', { round: r }); }
  const now = ps.bondCountBonus || {};

  // THE BUG: the reset used to assign 0 and wipe 因小失大's +1 (measured 1 → 0 before the fix)
  assert.ok(now.preciShip >= afterPyrrhic.preciShip,
    `因小失大's +1 must survive 盟约之主's round starts (got ${now.preciShip}, want ≥ ${afterPyrrhic.preciShip})`);
  assert.equal(now.yanShip, -1, 'a bond 盟约之主 never picks keeps exactly 因小失大\'s value');
  // and nothing else gained or lost a contribution
  for (const [bondId, v] of Object.entries(afterPyrrhic)) {
    assert.ok((now[bondId] ?? 0) >= v, `${bondId}: ${now[bondId]} must not fall below 因小失大's ${v}`);
  }
  // every contribution is accounted for per source
  const lines = ps.bondCountBonusBySource || {};
  assert.deepEqual(Object.keys(lines).sort(), ['hex:hex_overlord', 'hex:hex_pyrrhic'],
    'one line per source, and only the cards that wrote one');
  m.dispose();
});
