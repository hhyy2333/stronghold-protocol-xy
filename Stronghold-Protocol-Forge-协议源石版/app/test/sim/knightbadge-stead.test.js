// test/sim/knightbadge-stead.test.js — 【骑士徽章】(items/knightbadge.js) × 坚守盟约 (bonds/addon/battle.js).
//
// The badge moves 100 % of a 卡西米尔 operator's HP damage to the knight. Both effects used to fight over that hit:
// 坚守 cut 40 % at `hit` and then derived its share from the HP that reached the victim — which the badge leaves at 0 —
// so the 400 simply vanished (1000 → knight 360 + member 240), and when a 坚守 member was also 卡西米尔 (灰毫,
// data/chess.json chess_char_2_18_a) the two redirects ping-ponged until the 32-frame hook-depth guard dropped the chain.
// Now the badge claims the instance at `hit` (`dmg.redirectClaim`) and 坚守 / 浊心斯卡蒂 / 炎烬 leave a claimed instance
// alone, so nothing is cut away and no chain starts. The same guards make a redirect's OUTPUT final
// (`damage.js isRedirectShare`): no effect redirects a share again (owner's rule, 2026-10-29) — 坚守 used to cut the
// share Skadi had already moved (500 → 300 + 200), which is why the 0.2.4 #464 numbers (100 / 400 / 500) did not come
// out of this tree.
import test from 'node:test';
import assert from 'node:assert/strict';
import { makeBattle, chessRec, enemyRec } from '../helpers/battleHarness.js';
import { installKnightBadge } from '../../server/sim/content/items/knightbadge.js';

const ITEM = 'chess_item_9_98_e_a';
const close = (a, b, msg, eps = 1e-6) => assert.ok(Math.abs(a - b) <= eps, `${msg ?? ''} expected ${b}, got ${a}`);
const bond = (tier, layers = 0, count = 2) => ({ count, active: tier > 0, tier, layers });
const op = (id, bonds = []) => chessRec({ id, bonds, profession: 'WARRIOR', skill: null, stats: { maxHp: 200000, atk: 500, def: 0, res: 0, blockCnt: 1, respawnTime: 999 } });
const DUMMY = { e_d: enemyRec({ key: 'e_d', hp: 1e7, atk: 0, def: 0, res: 0, speed: 0 }) };

/** 骑士 (badge) / 卡西米尔 / 坚守成员 / 普通干员 (+ a 坚守 member that is also 卡西米尔, i.e. 灰毫). */
function field({ knightBonds = [], badge = true, steadTier = 2, extraKazStead = false } = {}) {
  const chess = {
    knight: op('knight', knightBonds), kaz: op('kaz', ['kazimierzShip']), std: op('std', ['steadShip']), plain: op('plain'),
    ...(extraKazStead ? { kazstd: op('kazstd', ['steadShip', 'kazimierzShip']) } : {}),
  };
  const units = [
    { uid: 1, kind: 'chess', chessId: 'knight', row: 9, col: 4, ...(badge ? { items: [ITEM] } : {}) },
    { uid: 2, kind: 'chess', chessId: 'kaz', row: 10, col: 4 },
    { uid: 3, kind: 'chess', chessId: 'std', row: 11, col: 4 },
    { uid: 4, kind: 'chess', chessId: 'plain', row: 12, col: 4 },
    ...(extraKazStead ? [{ uid: 5, kind: 'chess', chessId: 'kazstd', row: 11, col: 6 }] : []),
  ];
  return makeBattle({ defs: { chess, enemies: DUMMY }, units,
    bonds: { steadShip: bond(steadTier, 10, extraKazStead ? 3 : 2), indomShip: { count: 1, active: false, tier: 0, layers: 0 } },
    enemies: [{ key: 'e_d', time: 0, pos: [12, 2] }], autoFinish: false, timeLimit: 60 });
}

function ready(opts) {
  const h = field(opts);
  h.run(0.2);
  if (opts?.badge !== false) installKnightBadge(h.b);
  return h;
}
const ids = ['knight', 'kaz', 'std', 'plain', 'kazstd'];
function snap(h) {
  const out = {};
  for (const u of h.b.allyUnits) if (u.kind === 'op' && ids.includes(u.defId)) out[u.defId] = { hp: u.hp, max: u.s.maxHp };
  return out;
}
function hit(h, target, amount, type = 'true') {
  const e = h.b.enemies.find((x) => x.alive);
  const t = h.b.allyUnits.find((u) => u.defId === target);
  const before = snap(h);
  h.b.dealDamage(e, t, { amount, type, canDodge: false });
  const after = snap(h);
  const lost = {};
  for (const k of Object.keys(after)) lost[k] = before[k].hp - after[k].hp;
  return lost;
}

test('徽章 + 坚守 t2: the knight takes the hit whole — 40 % is not cut away, 坚守 takes no share', () => {
  const h = ready();
  const lost = hit(h, 'kaz', 1000);
  close(lost.kaz, 0, 'the 卡西米尔 operator takes nothing');
  close(lost.knight, 1000, 'the knight takes 100 % (before the claim: 360, and 240 went to a 坚守 member)');
  close(lost.std, 0, '坚守 does not cut / re-share a claimed hit');
  assert.equal(h.b.errorCount, 0, 'no handler / hookDepth errors');
});

test('徽章 + 坚守 t2: the same numbers when the knight himself is a 坚守 member', () => {
  const h = ready({ knightBonds: ['steadShip'] });
  const lost = hit(h, 'kaz', 1000);
  close(lost.kaz, 0);
  close(lost.knight, 1000, 'the transfer is not a second share (before the claim: 600, 400 deleted)');
  close(lost.std, 0);
  assert.equal(h.b.errorCount, 0);
});

test('徽章 + 坚守 t2: a 坚守 member that is also 卡西米尔 (灰毫) no longer ping-pongs with the transfer', () => {
  const h = ready({ extraKazStead: true });
  const lost = hit(h, 'kazstd', 1000);          // hit the 灰毫 itself: 坚守 skips members, the badge claims the whole hit
  close(lost.kazstd, 0);
  close(lost.knight, 1000, 'the knight takes it whole');
  close(lost.std, 0);
  assert.equal(h.b.errorCount, 0, 'no hookDepth chain');
  const lost2 = hit(h, 'kaz', 1000);            // and a hit on the other 卡西米尔 operator
  close(lost2.kaz, 0);
  close(lost2.knight, 1000);
  assert.equal(h.b.errorCount, 0);
});

test('坚守 still protects a 卡西米尔 operator when the badge is not in play (t2: 60 / 40)', () => {
  const h = ready({ badge: false });
  const lost = hit(h, 'kaz', 1000);
  close(lost.kaz, 600, 'the non-member keeps 60 %');
  close(lost.std, 400, 'the member takes 40 %');
  close(lost.knight, 0);
  assert.equal(h.b.errorCount, 0);
});

test('the badge alone is unchanged (no 坚守 activated): the knight takes 100 %', () => {
  const h = ready({ steadTier: 0 });
  const lost = hit(h, 'kaz', 1000);
  close(lost.kaz, 0);
  close(lost.knight, 1000);
  close(lost.std, 0);
  assert.equal(h.b.errorCount, 0);
});

test("a 坚守 share landing on a 卡西米尔 member is final: the badge does not take it, nothing re-shares it", () => {
  const h = ready({ extraKazStead: true });
  const lost = hit(h, 'plain', 1000);           // a plain non-member is hit: 坚守 cuts and shares to its 2 members
  close(lost.plain, 600, 'the non-member keeps 60 %');
  close(lost.std, 200, 'share to the 坚守 member');
  close(lost.kazstd, 200, 'the 灰毫 keeps its share — a redirect output is never redirected again');
  close(lost.knight, 0, 'the badge leaves the share where 坚守 sent it');
  assert.equal(h.b.errorCount, 0, 'and no chain starts');
});

test('a redirect output is final: a share-tagged instance is neither cut by 坚守 nor claimed by the badge', () => {
  const h = ready({ extraKazStead: true });
  const e = h.b.enemies.find((x) => x.alive);
  const target = h.b.allyUnits.find((u) => u.defId === 'kazstd');
  const knight = h.b.allyUnits.find((u) => u.defId === 'knight');
  const [hp0, kh0] = [target.hp, knight.hp];
  h.b.dealDamage(e, target, { amount: 1000, type: 'true', canDodge: false, tags: ['transfer'] });
  close(hp0 - target.hp, 1000, 'the share lands whole on the unit it was sent to');
  close(knight.hp, kh0, 'the badge does not take it');
  assert.equal(h.b.errorCount, 0);
});

test('徽章 + 坚守 t2: a lethal hit is conserved too (no free 40 % reduction)', () => {
  const h = ready();
  const lost = hit(h, 'kaz', 99999);
  close(lost.kaz, 0);
  close(lost.knight, 99999, 'the knight accounts for the whole hit');
  close(lost.std, 0);
  const k = h.b.allyUnits.find((u) => u.defId === 'knight');
  assert.equal(k.alive, true, 'the knight survives 99999 of 200000 HP');
  assert.equal(h.b.errorCount, 0);
});
