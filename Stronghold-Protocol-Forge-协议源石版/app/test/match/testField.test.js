// test/match/testField.test.js — 测试场 (the owner's request of 2026-10-11): the room flag `test` makes two differences,
// and this suite pins both.
//
//   1. the 协议源石 draft never runs (MatchPhases.afterRoundStart), while a same-round 机变 still does;
//   2. `g.testFunds` / `g.testHex` / `g.testHexClear` are accepted — and ONLY in a test field: a normal match answers
//      WRONG_PHASE to all three, which is what keeps the feature from being a gameplay change anywhere else.
//
// The flag itself is created by the lobby (`room.create.test`, SOLO only): the end-to-end half drives the real
// WebSocket lobby, and the engine half drives Match directly on the virtual scheduler (test/match/harness.js).

import { describe, test, before, after, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { makeMatch, DATA } from './harness.js';
import { validateC2S } from '../../shared/protocol.js';
import { ERR, PHASE } from '../../shared/constants.js';
import { hexIdsOf, enemyHexMods, enemyVerbIds } from '../../server/match/hextech.js';
import { hasBattlePart } from '../../server/sim/content/hextech.js';
import { startServer } from '../../server/index.js';
import { StubMatch } from '../../server/match/StubMatch.js';
import { TestClient } from '../helpers/wsClient.js';

/** The player hex ids of the shipped roster, in data order. */
const PLAYER_HEX_IDS = Object.keys(DATA.hextech.playerHexes);
/** The enemy hex ids of the shipped roster, in data order. */
const ENEMY_HEX_IDS = Object.keys(DATA.hextech.enemyHexes);
/** A card whose `onPick` grants funds (战备津贴: 8 on pick), so a granted hex leaves an observable trace. */
const FUNDS_HEX = 'hex_stipend';
/** A card carrying BOTH a `battle` passive and a fifth-batch script key (反击装甲: +18 % DEF / +10 RES + the riposte). */
const BATTLE_HEX = 'hex_armor';
/** An enemy `mods` card (腐蚀甲壳: hpMul 1.08) and an enemy `verb` card (亡语), for both enemy half-paths. */
const ENEMY_MODS_HEX = 'ehex_corrode';
const ENEMY_VERB_HEX = 'ehex_deathrattle';

/** Assert `{ error: code }` while tolerating the optional developer `detail` the server may add. */
function assertErr(res, code, what = '') {
  assert.equal(res.error, code, `${what}: ${JSON.stringify(res)}`);
  assert.equal(res.ok, undefined, what);
}

describe('测试场: the engine (opts.test)', () => {
  test('the 协议源石 draft never runs in a test field, and a same-round 机变 still does', () => {
    const h = makeMatch({ mode: 'solo', difficulty: 'NORMAL', seed: 5, fake: true, test: true }).start();
    const m = h.m;
    assert.equal(m.isTestField(), true);
    assert.equal(m.test, true);
    // R1 is a 协议源石 round (format.rounds 1/6/11) in every mode: a test field goes straight to PREP
    h.drive(() => m.phase === PHASE.PREP && m.round === 1);
    assert.equal(m.phase, PHASE.PREP);
    assert.equal(m.hex, null, 'the draft state was never created');
    assert.equal(hexIdsOf(h.ps('p_0')).length, 0, 'nobody drafted a hex');
    h.m.dispose();
  });

  test('a test field still reaches the 机变 draft of a round that is both (R6 of 险境模拟)', () => {
    // mode_single_normal.spRounds is [6, 9] and R6 is also a 协议源石 round: skipping the draft may not swallow the 机变
    assert.ok(Array.isArray(DATA.config.modes.mode_single_normal.spRounds) && DATA.config.modes.mode_single_normal.spRounds.includes(6),
      'the fixture assumes R6 is a 机变 round');
    const h = makeMatch({ mode: 'solo', difficulty: 'NORMAL', seed: 5, fake: true, test: true }).start();
    const okSp = h.drive(() => h.m.phase === PHASE.SP_DRAFT && h.m.round === 6);
    assert.ok(okSp && h.m.phase === PHASE.SP_DRAFT, `expected SP_DRAFT R6, got ${h.m.phase} R${h.m.round}`);
    assert.equal(h.m.hex, null, 'no 协议源石 draft ran on the way there');
    h.m.dispose();
  });

  test('a normal match still drafts (the flag is the only switch)', () => {
    const h = makeMatch({ mode: 'solo', difficulty: 'NORMAL', seed: 5, fake: true }).start();
    assert.equal(h.m.isTestField(), false);
    const ok = h.drive(() => h.m.phase === PHASE.HEX_DRAFT && h.m.round === 1);
    assert.ok(ok, `expected HEX_DRAFT, got ${h.m.phase}`);
    h.m.dispose();
  });

  test('g.testFunds adds funds in any phase of a test field, and is refused everywhere else', () => {
    const h = makeMatch({ mode: 'solo', difficulty: 'FUNNY', seed: 9, fake: true, test: true }).start();
    const ps = h.ps('p_0');
    const before = ps.funds;
    assert.deepEqual(h.m.handle('p_0', { t: 'g.testFunds', amount: 100 }), { ok: true });
    assert.equal(ps.funds, before + 100);
    // the phase does not matter: INFO_CHECK is where we are, and a later phase takes it too
    h.toPrep(1);
    const atPrep = ps.funds;
    assert.deepEqual(h.m.handle('p_0', { t: 'g.testFunds', amount: 1000 }), { ok: true });
    assert.equal(ps.funds, atPrep + 1000);
    assert.ok(ps.stats.fundsGained >= 1100, 'the grant goes through the ordinary income bookkeeping');
    h.invariants();
    h.m.dispose();

    const normal = makeMatch({ mode: 'solo', difficulty: 'FUNNY', seed: 9, fake: true }).start();
    const funds = normal.ps('p_0').funds;
    assertErr(normal.m.handle('p_0', { t: 'g.testFunds', amount: 100 }), ERR.WRONG_PHASE, 'normal g.testFunds');
    assert.equal(normal.ps('p_0').funds, funds, 'a normal match never gains a fund');
    normal.m.dispose();
  });

  test('g.testBoss jumps a test field straight to the picked leader round, and is refused everywhere else', () => {
    const h = makeMatch({ mode: 'solo', difficulty: 'NORMAL', seed: 21, fake: true, test: true }).start();
    const m = h.m;
    const ps = h.ps('p_0');
    const bossRound = DATA.config.modes.mode_single_normal.bossRound;
    // 业主 2026-10-21: 测试场 can go straight to the boss fight — a leader the mode does draw, and the hand-added boss_11
    for (const bossId of ['boss_7', 'boss_11']) {
      assert.deepEqual(m.handle('p_0', { t: 'g.testBoss', bossId }), { ok: true }, bossId);
      assert.equal(m.phase, PHASE.PREP, `${bossId}: the leader round's prep`);
      assert.equal(m.round, bossRound);
      assert.equal(m.bossId, bossId);
      assert.ok(typeof m.testBossTemplate === 'string' && /_s$/.test(m.testBossTemplate), `${bossId}: solo wave (${m.testBossTemplate})`);
      assert.equal(DATA.waves[m.testBossTemplate].spawns.find((s) => s.tag === 'boss').key, DATA.bosses[bossId].enemyKey,
        `${bossId}: the wave's leader spawn is that leader`);
      // the skipped rounds' economy comes with it: a purse and a shop at the round's level (not a round-1 board)
      assert.ok(ps.funds >= 60, `${bossId}: landed with a purse (${ps.funds})`);
      assert.ok(ps.shop.level >= 5, `${bossId}: shop level ${ps.shop.level}`);
      assert.ok(Array.isArray(ps.shop.slots) && ps.shop.slots.length > 0, `${bossId}: shop rolled`);
    }
    // Ready ends the prep through the ordinary endPrep → the picked leader's own wave, its pool from bloodPoint
    assert.deepEqual(m.handle('p_0', { t: 'g.ready', ready: true }), { ok: true });
    assert.ok(h.drive(() => m.phase === PHASE.FINAL_ASSAULT, 30), `expected FINAL_ASSAULT, got ${m.phase}`);
    assert.equal(m.bossId, 'boss_11');
    assert.equal(m.bossPool.maxHp, DATA.bosses.boss_11.bloodPoint.NORMAL, 'the pool is the leader bloodPoint × the seats alive');
    const wave = DATA.waves[m.testBossTemplate];
    assert.ok(wave, 'the leader round fights the picked leader\'s own wave');
    assert.equal(wave.spawns.find((s) => s.tag === 'boss').key, DATA.bosses.boss_11.enemyKey);
    h.invariants();
    m.dispose();

    // a normal match never accepts it
    const normal = makeMatch({ mode: 'solo', difficulty: 'NORMAL', seed: 21, fake: true }).start();
    assertErr(normal.m.handle('p_0', { t: 'g.testBoss' }), ERR.WRONG_PHASE, 'normal g.testBoss');
    normal.m.dispose();
  });

  test('g.testHex grants a card through the real applyHex path: ref, effect column and battle part; repeatable', () => {
    const h = makeMatch({ mode: 'solo', difficulty: 'FUNNY', seed: 13, fake: true, test: true }).start();
    const ps = h.ps('p_0');
    h.toPrep(1);
    const funds = ps.funds;
    assert.deepEqual(h.m.handle('p_0', { t: 'g.testHex', hexId: FUNDS_HEX }), { ok: true });
    assert.deepEqual(hexIdsOf(ps), [FUNDS_HEX], 'the persistent ref is the hex');
    assert.equal(ps.funds, funds + 3, 'the immediate onPick part ran (战备津贴 grants 3 since §29.20)');
    // the effects column shows it, with the tier so the client draws the 阶位 art
    const eff = ps.privateView().effects.find((e) => e.id === `hex:${FUNDS_HEX}`);
    assert.ok(eff, 'the effect column carries it');
    assert.equal(eff.iconKind, 'hex');
    assert.equal(eff.tier, 1, 'silver → tier 1');
    // a repeat is allowed and runs the immediate part again (that is what a test panel is for), the ref stays single
    assert.deepEqual(h.m.handle('p_0', { t: 'g.testHex', hexId: FUNDS_HEX }), { ok: true });
    assert.deepEqual(hexIdsOf(ps), [FUNDS_HEX], 'never two refs for one card');
    assert.equal(ps.funds, funds + 6, 'the immediate part ran twice');
    h.invariants();
    h.m.dispose();
  });

  test("g.testHex takes a battle card into the next battle's playerEffects (hasBattlePart honored)", () => {
    const h = makeMatch({ mode: 'solo', difficulty: 'FUNNY', seed: 17, fake: true, test: true }).start();
    const ps = h.ps('p_0');
    // 反击装甲 (gold: +18 % DEF / +10 RES since 2026-10-11) is a battle passive carried by `effect.battle`, and it also
    // carries the `armor` script key — this case pins that BOTH halves travel to the battle input together.
    const rec = DATA.hextech.playerHexes[BATTLE_HEX];
    assert.ok(rec && rec.effect && rec.effect.battle, `${BATTLE_HEX} is a battle-passive card`);
    assert.deepEqual(h.m.handle('p_0', { t: 'g.testHex', hexId: BATTLE_HEX }), { ok: true });
    const input = ps.battleInput({ side: 'L', colOffset: 0 });
    const carried = input.playerEffects.find((e) => e.id === `hex:${BATTLE_HEX}`);
    assert.ok(carried, 'the ref reaches the battle input');
    assert.deepEqual(carried.params.battle, rec.effect.battle);
    // the fifth-batch script half travels with it (a ref that lost `armor` would make the card's riposte dead again —
    // the §29.8 trap, where the battle half never ran). `battleInput` carries `params`, not the ref's own `battle` flag.
    assert.deepEqual(carried.params.armor, rec.effect.armor);
    assert.ok(hasBattlePart(carried.params), 'hasBattlePart sees the script key too');
    h.m.dispose();
  });

  test('g.testHex refuses an enemy card, an unknown id and a junk id (BAD_TARGET)', () => {
    const h = makeMatch({ mode: 'solo', difficulty: 'FUNNY', seed: 3, fake: true, test: true }).start();
    const ps = h.ps('p_0');
    const enemyId = Object.keys(DATA.hextech.enemyHexes)[0];
    assertErr(h.m.handle('p_0', { t: 'g.testHex', hexId: enemyId }), ERR.BAD_TARGET, 'an enemy card is not a player card');
    assertErr(h.m.handle('p_0', { t: 'g.testHex', hexId: 'hex_nope' }), ERR.BAD_TARGET, 'unknown id');
    assert.deepEqual(hexIdsOf(ps), [], 'nothing was granted');
    h.m.dispose();
  });

  test('g.testHexClear drops every owned 协议源石 and leaves the rest of the effects alone', () => {
    const h = makeMatch({ mode: 'solo', difficulty: 'FUNNY', seed: 19, fake: true, test: true }).start();
    const ps = h.ps('p_0');
    for (const id of [FUNDS_HEX, BATTLE_HEX, 'hex_armorbreak']) {
      assert.deepEqual(h.m.handle('p_0', { t: 'g.testHex', hexId: id }), { ok: true }, id);
    }
    // a non-hex effect (a 机变 card's own ref) must survive the clear
    ps.effects.push({ id: 'choice:test', key: 'choice:test', name: 'x', desc: '', iconKind: 'choice', iconId: 'test', params: {} });
    assert.equal(hexIdsOf(ps).length, 3);
    assert.deepEqual(h.m.handle('p_0', { t: 'g.testHexClear' }), { ok: true });
    assert.deepEqual(hexIdsOf(ps), []);
    assert.ok(ps.effects.some((e) => e.id === 'choice:test'), 'a non-hex effect stays');
    // clearing twice is fine, and the battle input no longer carries any hex ref
    assert.deepEqual(h.m.handle('p_0', { t: 'g.testHexClear' }), { ok: true });
    assert.equal(ps.battleInput({ side: 'L', colOffset: 0 }).playerEffects.filter((e) => String(e.id).startsWith('hex:')).length, 0);
    h.m.dispose();
  });

  test('every test intent is refused in a normal match, and an eliminated seat gets no grant', () => {
    const normal = makeMatch({ mode: 'solo', difficulty: 'FUNNY', seed: 21, fake: true }).start();
    for (const msg of [
      { t: 'g.testFunds', amount: 10 }, { t: 'g.testHex', hexId: FUNDS_HEX }, { t: 'g.testHexClear' },
      { t: 'g.testEnemyHex', hexId: ENEMY_MODS_HEX }, { t: 'g.testEnemyHexClear' },
    ]) {
      assertErr(normal.m.handle('p_0', msg), ERR.WRONG_PHASE, msg.t);
    }
    assert.deepEqual(normal.m.enemyHexes, [], 'a normal match never gains an enemy hex');
    normal.m.dispose();

    const test1 = makeMatch({ mode: 'solo', difficulty: 'FUNNY', seed: 21, fake: true, test: true }).start();
    const ps = test1.ps('p_0');
    ps.alive = false; // simulate elimination without running the elimination path
    assertErr(test1.m.handle('p_0', { t: 'g.testFunds', amount: 10 }), ERR.ELIMINATED, 'eliminated funds');
    assertErr(test1.m.handle('p_0', { t: 'g.testHex', hexId: FUNDS_HEX }), ERR.ELIMINATED, 'eliminated hex');
    assertErr(test1.m.handle('p_0', { t: 'g.testEnemyHex', hexId: ENEMY_MODS_HEX }), ERR.ELIMINATED, 'eliminated enemy hex');
    ps.alive = true;
    test1.m.dispose();
  });

  test('g.testEnemyHex pushes a mods card onto enemyHexes in the drawn-card shape, and its multiplier reaches the wave', () => {
    const h = makeMatch({ mode: 'solo', difficulty: 'FUNNY', seed: 26, fake: true, test: true }).start();
    const m = h.m;
    assert.deepEqual(m.enemyHexes, [], 'the enemy starts with none (no draft ran)');
    assert.deepEqual(h.m.handle('p_0', { t: 'g.testEnemyHex', hexId: ENEMY_MODS_HEX }), { ok: true });
    // the SAME record shape the draft stores ({ id, round }), so every reader treats it as a drawn card
    assert.equal(m.enemyHexes.length, 1);
    assert.equal(m.enemyHexes[0].id, ENEMY_MODS_HEX);
    assert.equal(m.enemyHexes[0].round, m.round);
    // enemyHexMods (what applyEnemyHexes folds into the spawn list) sees it right away
    assert.deepEqual(enemyHexMods(m), { hpMul: 1.08 });
    // and m.public carries it to every seat at once
    const view = m.publicView().enemyHexes;
    assert.equal(view.length, 1);
    assert.equal(view[0].id, ENEMY_MODS_HEX);
    assert.equal(view[0].drawRound, m.round);
    h.invariants();
    m.dispose();
  });

  test('g.testEnemyHex takes a verb card into flags.enemyHexIds for the next battle', () => {
    const h = makeMatch({ mode: 'solo', difficulty: 'FUNNY', seed: 27, fake: true, test: true }).start();
    const m = h.m;
    assert.deepEqual(enemyVerbIds(m), [], 'no verb before the grant');
    assert.deepEqual(m.handle('p_0', { t: 'g.testEnemyHex', hexId: ENEMY_VERB_HEX }), { ok: true });
    assert.deepEqual(enemyVerbIds(m), [ENEMY_VERB_HEX]);
    // battleOptsWithEnemyHexes is the ONE injection point every battle goes through (combat.js newBattle / _ccField)
    const opts = m.battleOptsWithEnemyHexes({ flags: { layerGainsEnabled: true }, fieldId: 'n:p_0' });
    assert.deepEqual(opts.flags.enemyHexIds, [ENEMY_VERB_HEX]);
    m.dispose();
  });

  test('g.testEnemyHex refuses a repeat (ALREADY: multipliers multiply), a player card and an unknown id', () => {
    const h = makeMatch({ mode: 'solo', difficulty: 'FUNNY', seed: 28, fake: true, test: true }).start();
    const m = h.m;
    assert.deepEqual(m.handle('p_0', { t: 'g.testEnemyHex', hexId: ENEMY_MODS_HEX }), { ok: true });
    // a repeat would double the card's own multiplier — a state no real match can produce (the draft never repeats)
    assertErr(m.handle('p_0', { t: 'g.testEnemyHex', hexId: ENEMY_MODS_HEX }), ERR.ALREADY, 'repeat enemy card');
    assert.equal(m.enemyHexes.length, 1, 'the refused repeat changed nothing');
    // a player card has no `mods` / `verb` the enemy side could read
    assertErr(m.handle('p_0', { t: 'g.testEnemyHex', hexId: FUNDS_HEX }), ERR.BAD_TARGET, 'a player card');
    assertErr(m.handle('p_0', { t: 'g.testEnemyHex', hexId: 'ehex_nope' }), ERR.BAD_TARGET, 'unknown id');
    assert.equal(m.enemyHexes.length, 1);
    m.dispose();
  });

  test('g.testEnemyHexClear drops every enemy card (and is a no-op on an empty list)', () => {
    const h = makeMatch({ mode: 'solo', difficulty: 'FUNNY', seed: 29, fake: true, test: true }).start();
    const m = h.m;
    assert.deepEqual(m.handle('p_0', { t: 'g.testEnemyHexClear' }), { ok: true }, 'clearing nothing is fine');
    for (const id of [ENEMY_MODS_HEX, ENEMY_VERB_HEX]) assert.deepEqual(m.handle('p_0', { t: 'g.testEnemyHex', hexId: id }), { ok: true }, id);
    assert.equal(m.enemyHexes.length, 2);
    assert.deepEqual(m.handle('p_0', { t: 'g.testEnemyHexClear' }), { ok: true });
    assert.deepEqual(m.enemyHexes, []);
    assert.deepEqual(enemyHexMods(m), {}, 'the enemy fights unmodified again');
    assert.deepEqual(enemyVerbIds(m), []);
    // and a card may be granted again after the clear
    assert.deepEqual(m.handle('p_0', { t: 'g.testEnemyHex', hexId: ENEMY_MODS_HEX }), { ok: true });
    assert.deepEqual(enemyHexMods(m), { hpMul: 1.08 });
    h.invariants();
    m.dispose();
  });

  test('the whole enemy pool is grantable at once (24 cards) and every one persists', () => {
    assert.equal(ENEMY_HEX_IDS.length, 24);
    const h = makeMatch({ mode: 'solo', difficulty: 'FUNNY', seed: 30, fake: true, test: true }).start();
    for (const id of ENEMY_HEX_IDS) {
      assert.deepEqual(h.m.handle('p_0', { t: 'g.testEnemyHex', hexId: id }), { ok: true }, id);
    }
    assert.deepEqual(h.m.enemyHexes.map((e) => e.id), ENEMY_HEX_IDS);
    // 10 verb cards reached the battle flag, and the multipliers all multiplied
    assert.equal(enemyVerbIds(h.m).length, 10);
    assert.ok(enemyHexMods(h.m).hpMul > 2, `the hp multipliers multiplied (${enemyHexMods(h.m).hpMul})`);
    h.invariants();
    h.m.dispose();
  });

  test('the enemy-side intents are refused when more than one human seat shares the match', () => {
    // the lobby only ever builds a test field as a solo room (room.create refuses coop + test), so this guard is the
    // safety net for a platform that ever hands a test flag to a shared room — and it is the reason the intent is not
    // simply "everyone may edit the global enemy side"
    const h = makeMatch({ mode: 'coop', difficulty: 'FUNNY', humans: 2, bots: 0, seed: 31, fake: true, test: true }).start();
    assertErr(h.m.handle('p_0', { t: 'g.testEnemyHex', hexId: ENEMY_MODS_HEX }), ERR.WRONG_PHASE, 'shared enemy hex');
    assertErr(h.m.handle('p_0', { t: 'g.testEnemyHexClear' }), ERR.WRONG_PHASE, 'shared enemy hex clear');
    // the per-player intents still work: those are the requester's own state
    assert.deepEqual(h.m.handle('p_0', { t: 'g.testFunds', amount: 10 }), { ok: true });
    assert.deepEqual(h.m.handle('p_0', { t: 'g.testHex', hexId: FUNDS_HEX }), { ok: true });
    assert.deepEqual(h.m.enemyHexes, []);
    h.m.dispose();
  });

  test('m.public carries `test: true` in a test field and omits it in a normal match', () => {
    const t = makeMatch({ mode: 'solo', difficulty: 'FUNNY', seed: 2, fake: true, test: true }).start();
    assert.equal(t.m.publicView().test, true);
    t.m.dispose();
    const n = makeMatch({ mode: 'solo', difficulty: 'FUNNY', seed: 2, fake: true }).start();
    assert.equal(Object.hasOwn(n.m.publicView(), 'test'), false, 'a normal m.public has no `test` key at all');
    n.m.dispose();
  });

  test('the roster the panel offers is the shipped player pool, and every card of it is grantable', () => {
    assert.equal(PLAYER_HEX_IDS.length, 79); // 66 + the 13 cards of 2026-10-13 (docs/history/0.3.0.md §29.34)
    assert.ok(PLAYER_HEX_IDS.includes(FUNDS_HEX));
    const h = makeMatch({ mode: 'solo', difficulty: 'FUNNY', seed: 4, fake: true, test: true }).start();
    for (const id of PLAYER_HEX_IDS) {
      assert.deepEqual(h.m.handle('p_0', { t: 'g.testHex', hexId: id }), { ok: true }, id);
    }
    assert.equal(hexIdsOf(h.ps('p_0')).length, PLAYER_HEX_IDS.length, 'the whole pool can be owned at once');
    h.invariants();
    h.m.dispose();
  });});

describe('测试场: the protocol schema', () => {
  test('room.create.test is an optional boolean; the five test intents are well-formed', () => {
    assert.equal(validateC2S({ t: 'room.create', mode: 'solo', difficulty: 'FUNNY', test: true }), null);
    assert.equal(validateC2S({ t: 'room.create', mode: 'solo', difficulty: 'FUNNY', test: false }), null);
    assert.equal(validateC2S({ t: 'room.create', mode: 'solo', difficulty: 'FUNNY' }), null, 'absent = a normal room');
    assert.notEqual(validateC2S({ t: 'room.create', mode: 'solo', difficulty: 'FUNNY', test: 'yes' }), null);
    assert.equal(validateC2S({ t: 'g.testFunds', amount: 1 }), null);
    assert.equal(validateC2S({ t: 'g.testFunds', amount: 1e6 }), null);
    assert.notEqual(validateC2S({ t: 'g.testFunds', amount: 0 }), null);
    assert.notEqual(validateC2S({ t: 'g.testFunds', amount: 1e6 + 1 }), null);
    assert.notEqual(validateC2S({ t: 'g.testFunds', amount: 1.5 }), null);
    assert.equal(validateC2S({ t: 'g.testHex', hexId: 'hex_stipend' }), null);
    assert.notEqual(validateC2S({ t: 'g.testHex', hexId: '' }), null);
    assert.equal(validateC2S({ t: 'g.testHexClear' }), null);
    assert.equal(validateC2S({ t: 'g.testEnemyHex', hexId: 'ehex_corrode' }), null);
    assert.notEqual(validateC2S({ t: 'g.testEnemyHex', hexId: '' }), null);
    assert.notEqual(validateC2S({ t: 'g.testEnemyHex' }), null);
    assert.equal(validateC2S({ t: 'g.testEnemyHexClear' }), null);
  });
});

describe('测试场: the lobby', () => {
  let srv;
  let pool;
  const cap = { errors: [] };
  /** StubMatch that records the options each match was started with. */
  const started = [];
  class RecordingMatch extends StubMatch {
    constructor(opts) { super(opts); started.push(opts); }
  }
  before(async () => {
    srv = await startServer({
      port: 0, host: '127.0.0.1', MatchClass: RecordingMatch,
      log: { info() {}, warn() {}, debug() {}, error: (...a) => cap.errors.push(a.map(String).join(' ')) },
    });
    pool = new Set();
  });
  afterEach(async () => {
    await Promise.all([...pool].map((c) => c.terminate().catch(() => {})));
    pool.clear();
    started.length = 0;
  });
  after(async () => {
    await srv?.close();
    assert.deepEqual(cap.errors, [], 'no server errors logged');
  });

  async function client(name) {
    const c = await TestClient.connect(`ws://127.0.0.1:${srv.port}/ws`);
    pool.add(c);
    const w = await c.hello(name);
    c.id = w.playerId;
    return c;
  }
  const ok = async (c, msg) => { const r = await c.request(msg); assert.equal(r.t, 'ok', `${msg.t}: ${JSON.stringify(r)}`); return r; };

  test('room.create.test creates a solo test field: room.state.test and opts.test reach the match', async () => {
    const a = await client('Tester');
    await ok(a, { t: 'room.create', mode: 'solo', difficulty: 'FUNNY', test: true });
    const st = await a.waitFor('room.state', (s) => s.mode === 'solo' && s.hostId === a.id);
    assert.equal(st.test, true, 'the room reports the flag');
    await ok(a, { t: 'room.start' });
    assert.equal(started.length, 1);
    assert.equal(started[0].test, true, 'the match was constructed with the room flag');
  });

  test('a co-op create with test is refused (a test field is solo only) and leaves the player with no room', async () => {
    const a = await client('CoopTester');
    const res = await a.request({ t: 'room.create', mode: 'coop', difficulty: 'FUNNY', test: true });
    assert.equal(res.t, 'error', JSON.stringify(res));
    assert.equal(res.code, ERR.BAD_TARGET);
    // the refused create must not have half-created a room (the check runs before the current room is dropped)
    assert.equal([...srv.lobby.rooms.values()].some((r) => r.seatOf(a.id)), false);
    // and the player may still create a normal room afterwards
    await ok(a, { t: 'room.create', mode: 'coop', difficulty: 'FUNNY' });
    assert.equal(started.length, 0, 'nothing started yet');
  });

  test('a room created without test has room.state.test false and a match without opts.test', async () => {
    const a = await client('Normal');
    await ok(a, { t: 'room.create', mode: 'solo', difficulty: 'FUNNY' });
    const st = await a.waitFor('room.state', (s) => s.mode === 'solo' && s.hostId === a.id);
    assert.equal(st.test, false);
    await ok(a, { t: 'room.start' });
    assert.equal(started.length, 1);
    assert.equal(started[0].test, false, 'a normal room hands the match `false`, never undefined-vs-true ambiguity');
  });
});
