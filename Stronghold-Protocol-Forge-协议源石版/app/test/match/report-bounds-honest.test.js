// test/match/report-bounds-honest.test.js — 上界校验的「诚实结果」与「伪造」两侧（server/match/fields.js specBounds /
// validateClientResult）。
//
// 三条线上实测的判伪（阿里云 3 小时 43 局：layer bound 8 / coins 5 / leak key 3）在这里各钉一对：
//   ① 内容可以**链式**产出：敌方 verb 卡刷出来的身体自己还会召唤 / 分裂（通缉令 的 俗心 → 小说卷轴 ×3）。
//      校验器只从「排定的刷怪」与「卡面自己点名的 key」取一层子体，链的第二环不在 derived 里 ⇒ 诚实的那具子体
//      一漏怪就被判 'leak key'。
//   ② 玩家 协议源石 卡可以在战斗里付钱（骑士金神：击杀 4 个得 1 金，每场最多到 9），战报的 `coins` 因此可以超过
//      「刷怪悬赏」那条上界 ⇒ 诚实结果被判 'coins'。
//   ③ 装备也能在战斗里加层（心之钢：坚守干员每 3 秒的那次攻击 +2 层【坚守】），没有 garrison 承担这一段 ⇒
//      实打实的 128 / 154 层被判 'layer bound'。
// 每一条都配一条「伪造仍然被拒」的断言：多报层数 / 凭空金币 / 排程里没有的 key 都必须继续打回服务端复算。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildBattleSpec } from '../../server/sim/spec.js';
import { validateClientResult, specBounds } from '../../server/match/fields.js';
import { GameData } from '../../server/match/gamedata.js';
import { DATA } from './harness.js';

const gd = new GameData(DATA, 'mode_multi_hard');

/** 一条只在刷怪表里出现、数据里没有任何子体关系的 key（与 clientCombat-review.test.js 的 plainKey 同一口径）。 */
const plainKey = Object.keys(DATA.enemies).find((k) => {
  const e = gd.enemy(k);
  return e && !e.notCountInTotal && specBounds({ spawns: [{ enemyKey: k, count: 1 }] }, gd).derived.size === 0;
});

/** 一条数据里真实存在、但本 spec 既没刷也不该由内容产出的 key（伪造用）。 */
const unreachableKey = Object.keys(DATA.enemies).find((k) => k !== plainKey && gd.enemy(k) && !gd.enemy(k).notCountInTotal
  && !specBounds({ spawns: [{ enemyKey: plainKey, count: 1 }], flags: {} }, gd).derived.has(k));

const perPlayer = (o = {}) => ({ killed: 0, total: 4, leaked: [], perfect: true, layerGains: {}, coins: 0, damageDealt: 0, bossDamage: 0, healingDone: 0, deaths: 0, unitsEnd: [], unitStats: [], ...o });

const specOf = (o = {}) => buildBattleSpec({
  battleId: 'v', fieldId: 'n:p', kind: 'normal', seed: 7, round: 11, timeLimit: 230,
  players: [{ playerId: 'p', units: [], bonds: {} }],
  spawns: [{ enemyKey: plainKey, count: 2, time: 1 }],
  flags: { layerGainsEnabled: true }, ...o,
});

// ---- ① 内容链式产出：leak key --------------------------------------------------------------------------------------

/** 俗心 (enemy_1197_sfshu) 死时 DeadSpawn 3 只 小说卷轴 (enemy_1198_msfshu)：这条链的第二环是「内容可以产出」的。 */
const CARD_BODY = 'enemy_1197_sfshu';
const CARD_BODY_CHILD = 'enemy_1198_msfshu';

test('leak key: a body a CARD spawns may leak its own offspring (enemy_1197_sfshu → enemy_1198_msfshu)', () => {
  assert.ok(plainKey && unreachableKey);
  assert.ok(gd.enemy(CARD_BODY) && gd.enemy(CARD_BODY_CHILD));
  // 通缉令 (敌方 verb 卡) 在战斗里刷出俗心：刷怪表里没有它，只有 flags.enemyHexWanted 点名
  const spec = specOf({ flags: { layerGainsEnabled: true, enemyHexWanted: CARD_BODY } });
  const B = specBounds(spec, gd);
  assert.ok(B.derived.has(CARD_BODY), 'the card body itself is content-spawned');
  assert.ok(B.derived.has(CARD_BODY_CHILD), 'its offspring is content-spawned too (one derivation level is not enough)');

  const raw = (leaked, perfect = false) => ({
    reason: 'timeout', time: 30, killed: 0, total: 2, errors: 0,
    perPlayer: { p: perPlayer({ total: 2, leaked, perfect }) },
  });
  const honest = validateClientResult(spec, raw([{ enemyKey: CARD_BODY_CHILD, counted: true, lpr: 1 }]), { gd });
  assert.equal(honest.ok, true, `an honest leak of the card body's offspring is accepted (${JSON.stringify(honest)})`);
  // 伪造照旧：数据里存在、但这一场没有任何来源的 key
  assert.deepEqual(validateClientResult(spec, raw([{ enemyKey: unreachableKey, counted: true, lpr: 1 }]), { gd }), { ok: false, reason: 'leak key' });
  // 伪造照旧：链外的 key 也不能因此被放行
  assert.deepEqual(validateClientResult(specOf(), raw([{ enemyKey: CARD_BODY_CHILD, counted: true, lpr: 1 }]), { gd }), { ok: false, reason: 'leak key' },
    'without the card in this spec the child has no source at all');
});

test('leak source (联防): a helper who sent in the parent is billed for the card body\'s offspring', () => {
  const unite = (o = {}) => specOf({ kind: 'unite', flags: { layerGainsEnabled: true, enemyHexWanted: CARD_BODY, ...(o.flags || {}) },
    spawns: [{ enemyKey: plainKey, count: 1, time: 1, sourcePlayerId: 'p_1' }], ...o });
  const spec = unite();
  const raw = (leaked) => ({
    reason: 'cleared', time: 30, killed: 1, total: 1, errors: 0,
    perPlayer: { p: perPlayer({ total: 1, killed: 1, leaked, perfect: false }) },
  });
  const honest = validateClientResult(spec, raw([{ enemyKey: CARD_BODY_CHILD, counted: true, lpr: 1, sourcePlayerId: 'p_1' }]), { gd });
  assert.equal(honest.ok, true, `the offspring budget reaches the card body's children (${JSON.stringify(honest)})`);
  // 伪造照旧：这个 leaker 没送进任何能产生它的东西 —— 额度只有数据给的 DeadSpawn 3 只，第 4 只就打回
  const forged = raw(Array.from({ length: 12 }, () => ({ enemyKey: CARD_BODY_CHILD, counted: true, lpr: 1, sourcePlayerId: 'p_1' })));
  assert.equal(validateClientResult(spec, forged, { gd }).ok, false, 'the offspring budget is finite (DeadSpawn 3 per parent)');
});

// ---- ② 战斗内付钱：coins -------------------------------------------------------------------------------------------

/** 骑士金神 (hex_kazimierz_knightgold)：击杀 4 个敌人得 1 金，每场最多 1 + floor(层数/50)，上限 9。 */
const COIN_CARD = 'hex_kazimierz_knightgold';

test('coins: a card that pays INSIDE the battle is part of the bound (骑士金神)', () => {
  const effect = DATA.hextech.playerHexes[COIN_CARD].effect;
  assert.equal(effect.kazimierzKnightGold.goldCap, 9, 'the card record declares its own per-battle cap');
  const withCard = specOf({ players: [{ playerId: 'p', units: [], bonds: {}, playerEffects: [{ id: `hex:${COIN_CARD}`, key: `hex:${COIN_CARD}`, params: effect }] }] });
  assert.equal(specBounds(withCard, gd).bountyCoins, 9, 'the card\'s cap is budgeted (no spawn carries that bounty)');
  const raw = (coins) => ({ reason: 'cleared', time: 30, killed: 0, total: 2, errors: 0, perPlayer: { p: perPlayer({ coins, perfect: true }) } });
  assert.equal(validateClientResult(withCard, raw(1), { gd }).ok, true, 'an honest coin the card paid is accepted');
  assert.deepEqual(validateClientResult(withCard, raw(10), { gd }), { ok: false, reason: 'coins' }, 'more than the card can ever pay is a forgery');
  // 伪造照旧：没有这张卡时，一分钱也不能凭空多出来
  const noCard = specOf();
  assert.equal(specBounds(noCard, gd).bountyCoins, 0);
  assert.deepEqual(validateClientResult(noCard, raw(1), { gd }), { ok: false, reason: 'coins' });
});

// ---- ③ 卡面加层：layer bound（协议源石卡按击杀返层） ------------------------------------------------------------- ---------------------------------------------------------------------------------------

/** 心之钢 (chess_item_9_96_e): 「【坚守】盟约干员每隔 3 秒的攻击…增加自身最大生命值 150 点、【坚守】层数 2 层」。 */
const HEARTSTEEL = 'chess_item_9_96_e_a';
/** 一名自带【坚守】的干员（data 的 bonds 里有 steadShip）。 */
const STEAD_CHESS = 'chess_char_3_16_a';

test('layer bound: an equipment\'s in-battle layer gain is part of the bound (心之钢)', () => {
  assert.ok(DATA.items[HEARTSTEEL], 'the equipment record exists');
  assert.ok(gd.chess(STEAD_CHESS), 'the operator record exists');
  const spec = (units) => specOf({ players: [{ playerId: 'p', units, bonds: { steadShip: { layers: 5 } } }] });
  const withItem = spec([{ uid: 1, kind: 'op', chessId: STEAD_CHESS, items: [HEARTSTEEL] }]);
  const withoutItem = spec([{ uid: 1, kind: 'op', chessId: STEAD_CHESS }]);
  const raw = (n) => ({ reason: 'cleared', time: 200, killed: 30, total: 40, errors: 0, perPlayer: { p: perPlayer({ total: 40, killed: 30, layerGains: { steadShip: n } }) } });
  // 实测（coop/ABYSS Lv19 seed 2 R11）：128 层
  assert.equal(validateClientResult(withItem, raw(128), { gd }).ok, true, 'an honest 128-layer gain is accepted');
  assert.equal(validateClientResult(withItem, raw(154), { gd }).ok, true, '154 layers at R12 is honest too');
  // 伪造照旧：一场 230 s、一件心之钢，最多 77 次触发 × 2 层 = 154 层，还叠着 60 + 4·round 的底子
  assert.deepEqual(validateClientResult(withItem, raw(999), { gd }), { ok: false, reason: 'layer bound' }, 'claiming the cap is still a forgery');
  // 没有这件装备时上界一个字节都不动：105 > 60 + 4·11
  assert.deepEqual(validateClientResult(withoutItem, raw(105), { gd }), { ok: false, reason: 'layer bound' }, 'no equipment, no extra allowance');
  assert.equal(validateClientResult(withoutItem, raw(104), { gd }).ok, true);
  // 伪造照旧：没有这件装备的玩家拿到的是「60 + 4·round + 特质额度」那条老上界
  assert.equal(specBounds(withItem, gd).layerCap, 104);
});

test('layer bound: the equipment allowance only covers the bond the equipment feeds', () => {
  // 同一件心之钢不会给别的盟约开额度（只有 steadShip）
  const spec = specOf({ players: [{ playerId: 'p', units: [{ uid: 1, kind: 'op', chessId: STEAD_CHESS, items: [HEARTSTEEL] }], bonds: { steadShip: { layers: 5 }, kjeragShip: { layers: 5 } } }] });
  const raw = (gains) => ({ reason: 'cleared', time: 200, killed: 0, total: 40, errors: 0, perPlayer: { p: perPlayer({ total: 40, layerGains: gains }) } });
  assert.ok(validateClientResult(spec, raw({ steadShip: 150 }), { gd }).ok, 'steadShip carries the equipment allowance');
  assert.deepEqual(validateClientResult(spec, raw({ kjeragShip: 150 }), { gd }), { ok: false, reason: 'layer bound' }, 'kjeragShip does not');
});

/** 困毙之雪 (hex_kjerag_frostdeath)：被真伤杀死的敌人使【谢拉格】层数 +1（3 名档）／ +2（6 名档）。 */
const KJERAG_CARD = 'hex_kjerag_frostdeath';

test('layer bound: a card that pays layers per kill is part of the bound (困毙之雪)', () => {
  const rec = DATA.hextech.playerHexes[KJERAG_CARD];
  assert.equal(rec.requiresBond, 'kjeragShip', 'the card names the bond it feeds');
  assert.equal(rec.effect.kjeragFrostDeath.allSealedKillLayers, 2);
  const spec = (effects) => specOf({
    round: 9, spawns: [{ enemyKey: plainKey, count: 4, time: 1 }],
    players: [{ playerId: 'p', units: [], bonds: { kjeragShip: { layers: 5 } }, ...(effects ? { playerEffects: effects } : {}) }],
  });
  const card = [{ id: `hex:${KJERAG_CARD}`, key: `hex:${KJERAG_CARD}`, params: rec.effect }];
  const raw = (n) => ({ reason: 'cleared', time: 200, killed: 40, total: 40, errors: 0, perPlayer: { p: perPlayer({ total: 40, killed: 40, layerGains: { kjeragShip: n } }) } });
  // 实测（coop/ABYSS Lv19 seed 2 R9）：152 层，上界 96
  assert.equal(validateClientResult(spec(card), raw(152), { gd }).ok, true, 'an honest 152-layer gain is accepted');
  assert.deepEqual(validateClientResult(spec(card), raw(999), { gd }), { ok: false, reason: 'layer bound' }, 'claiming the cap is still a forgery');
  assert.deepEqual(validateClientResult(spec(null), raw(152), { gd }), { ok: false, reason: 'layer bound' }, 'without the card nothing changes');
});

/** 冰雪消融 (hex_kjerag_thaw)：「攻击寒冷/冻结敌人时解除状态，获得 1 层谢拉格」。 */
test('layer bound: 冰雪消融 per-hit layer is budgeted too (a hit count, not a kill count)', () => {
  const rec = DATA.hextech.playerHexes.hex_kjerag_thaw;
  assert.equal(rec.effect.kjeragThaw.layers, 1);
  const card = [{ id: 'hex:hex_kjerag_thaw', key: 'hex:hex_kjerag_thaw', params: rec.effect }];
  const spec = specOf({ round: 11, spawns: [{ enemyKey: plainKey, count: 8, time: 1 }],
    players: [{ playerId: 'p', units: [], bonds: { kjeragShip: { layers: 5 } }, playerEffects: card }] });
  const raw = (n) => ({ reason: 'cleared', time: 200, killed: 40, total: 60, errors: 0, perPlayer: { p: perPlayer({ total: 60, killed: 40, layerGains: { kjeragShip: n } }) } });
  assert.equal(validateClientResult(spec, raw(152), { gd }).ok, true, 'an honest 152-layer gain is accepted (bound 104 before)');
  assert.deepEqual(validateClientResult(spec, raw(999), { gd }), { ok: false, reason: 'layer bound' }, 'the cap is still out of reach');
});
