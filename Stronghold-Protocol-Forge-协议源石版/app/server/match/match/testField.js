// server/match/match/testField.js — Match methods: the 测试场 test panel (the owner's request of 2026-10-11).
//
// A 测试场 is a room the host created with `room.create.test: true` (server/lobby.js Room.test → Match opts.test). It is a
// NORMAL match in every rule — the same rounds, waves, economy, drafts and settlement — with exactly two differences:
//
//   1. the 协议源石 draft never runs (MatchPhases.afterRoundStart skips `enterHexDraft`), so a tester is never stopped by
//      a card offer; the enemy likewise draws no hex through a draft. Instead the tester picks the cards they want from
//      the panel, one tap each — on either side:
//
//        player side (per seat)         enemy side (match-global)
//        g.testHex { hexId }            g.testEnemyHex { hexId }
//        g.testHexClear {}              g.testEnemyHexClear {}
//
//   2. the intents below are accepted, from the requesting player only, in any phase (a test field is untimed the way
//      独立模拟 is, and a tester wants to change the field while they watch it):
//
//        g.testFunds { amount }   → addFunds: the same primitive every 机变 / 协议源石 income uses (stats.fundsGained
//                                   included, funds floored at 0), so the top bar and the shop update at once.
//        g.testHex { hexId }      → grant ONE player 协议源石 of data/hextech.json `playerHexes`. It goes through the
//                                   production path (server/match/hextech.js applyHex): the immediate `onPick` part runs,
//                                   the persistent `hex:<id>` EffectRef is added (deduplicated, so a repeated tap re-runs
//                                   the immediate part without stacking a second ref), the effect shows in the right-hand
//                                   column, and its battle half reaches every later battle. `applyHexExtras` (镜像协议 /
//                                   二次抽取) runs too, exactly as a drafted pick would.
//        g.testHexClear {}        → drop every `hex:<id>` EffectRef the requester owns. The immediate parts already applied
//                                   (funds, items, operators, layers) are NOT undone — a test field grants state, it does not
//                                   roll the match back; from then on the panel simply shows none and the battle half is gone.
//        g.testEnemyHex { hexId } → push one enemy 协议源石 onto `Match.enemyHexes` in the very shape the draft stores
//                                   (`{ id, round }`), so every reader treats it as a drawn card: `enemyHexMods` folds its
//                                   `mods` into the next wave's spawn list, `enemyVerbIds` puts its `verb` on
//                                   `flags.enemyHexIds` for the next battle, `enemyHexPayout` pays 过路费 at settlement and
//                                   `m.public.enemyHexes` shows it to every seat at once. Refused with ALREADY for a card the
//                                   enemy already owns: enemy multipliers MULTIPLY, so a repeat would double a card no real
//                                   match can ever hold twice (the draft never repeats an owned card).
//        g.testEnemyHexClear {}   → drop every enemy hex (the enemy fights unmodified from the next battle on).
//
// Only `this.test === true` accepts them: outside a test field every call answers ERR.WRONG_PHASE, and no other code path
// reads `this.test` (a normal match differs from 0.3.0 in not one byte of behaviour).
//
// Installed on Match.prototype by server/match/Match.js (a method container: never instantiated; `this` is the match).

import { PHASE, ERR } from '../../../shared/constants.js';
import { applyHex, hexIdsOf } from '../hextech.js';
import { OK, fail } from './common.js';

/** The test panel refuses a single grant larger than this (shared/protocol.js bounds the wire at 1e6 too). */
export const TEST_MAX_FUNDS = 1e6;

/**
 * 测试场 直接到 boss 战 (`g.testBoss`) leaves the tester this much funds after the production income of the leader
 * round, so the leader can be fought with a bought team instead of a round-1 board [ASSUMED test convenience].
 */
export const TEST_BOSS_PURSE = 60;

export class MatchTestField {
  /**
   * Whether the room is a 测试场. The intents below and MatchPhases.afterRoundStart are its only readers.
   * @returns {boolean}
   */
  isTestField() {
    return this.test === true;
  }

  /**
   * g.testFunds { amount } — add `amount` funds to the requester (1 … TEST_MAX_FUNDS).
   * The truncation lives in addFunds (economy.js: `Math.trunc`, floored at 0), so this only checks the bound.
   */
  testFunds(ps, amount) {
    const g = this._testGate(ps);
    if (g) return g;
    const n = Number(amount);
    if (!Number.isInteger(n) || n <= 0 || n > TEST_MAX_FUNDS) return fail(ERR.BAD_TARGET, 'test funds out of range');
    ps.addFunds(n, { reason: 'test' });
    ps.recompute();
    return OK;
  }

  /**
   * g.testHex { hexId } — grant the requester one 协议源石 of the player roster.
   * A non-player id (an enemy card, an unknown id, or a build without the roster) is BAD_TARGET; the same card twice is
   * allowed (`applyHex` dedupes the ref; the immediate part runs again, which is what makes a repeatable test panel work).
   */
  testHex(ps, hexId) {
    const g = this._testGate(ps);
    if (g) return g;
    const hex = typeof hexId === 'string' ? this.gd.hex(hexId) : null;
    // the player roster only: an enemy card's `mods` / `verb` is not a thing a player may own
    const playerPool = this.gd.hexPlayerPool();
    if (!hex || !playerPool.some((h) => h && h.id === hex.id)) return fail(ERR.BAD_TARGET, 'not a player hex');
    try { applyHex(this, ps, hex); } catch (e) { this.reportError(`testHex ${hex.id}`, e); return fail(ERR.INTERNAL); }
    ps.recompute();
    return OK;
  }

  /**
   * g.testHexClear {} — drop every 协议源石 the requester owns. Returns how many refs were removed (0 is still OK: a
   * tester clearing an empty panel is not an error).
   */
  testHexClear(ps) {
    const g = this._testGate(ps);
    if (g) return g;
    const before = hexIdsOf(ps).length;
    ps.effects = (ps.effects || []).filter((e) => !(e && typeof e.key === 'string' && e.key.startsWith('hex:')));
    ps.recompute();
    this.markPrivate(ps);
    void before;
    return OK;
  }

  /**
   * g.testEnemyHex { hexId } — add one ENEMY 协议源石 to the match's enemy side (`Match.enemyHexes`).
   *
   * The enemy side is match-global state, not per-player: every field of every seat fights it. Two consequences the
   * production path already handles, so this writes the SAME shape the draft does (`{ id, round }`):
   *
   *   * the `mods` half is folded into each wave where the spawn list is built (`applyEnemyHexes` — `_normalOpts`,
   *     `bossRounds.js`, 联防, the bot's rehearsal and the stat preview all read it), so a grant lands in the very next
   *     battle with no extra plumbing;
   *   * the `verb` half travels on `flags.enemyHexIds` (`enemyVerbIds` → `battleOptsWithEnemyHexes`), likewise read fresh
   *     at every battle, so a granted verb card runs in the next battle too;
   *   * `payout` (过路费) is read at settlement (`enemyHexPayout`).
   *
   * Because it is shared state, a repeat is not harmless the way a player hex's is: the multipliers MULTIPLY. The same
   * card twice would therefore double its own multiplier, which no real match can ever produce (the draft never repeats
   * an owned card) and which would make a test stop reflecting the game. A card the enemy already owns is refused with
   * ALREADY instead — the panel marks owned cards, so a tester sees why.
   */
  testEnemyHex(ps, hexId) {
    const g = this._testGateEnemy(ps);
    if (g) return g;
    if (!Array.isArray(this.enemyHexes)) this.enemyHexes = [];
    const hex = typeof hexId === 'string' ? this.gd.hex(hexId) : null;
    // the enemy roster only: a player card has no `mods` / `verb` the enemy side could read
    const enemyPool = this.gd.hexEnemyPool();
    if (!hex || !enemyPool.some((h) => h && h.id === hex.id)) return fail(ERR.BAD_TARGET, 'not an enemy hex');
    const owned = this.enemyHexes.map((e) => (e && e.id ? e.id : e));
    if (owned.includes(hex.id)) return fail(ERR.ALREADY, 'the enemy already owns it');
    // the same record shape the draft stores, so every reader (enemyHexMods / enemyVerbIds / enemyHexPayout / the views)
    // treats a test-field grant exactly like a drawn card
    this.enemyHexes.push({ id: hex.id, round: this.round });
    this.hexDrawRound = this.round;
    // every player's private view carries the enemy's list (m.public does), so the UI updates at once
    for (const p of this.order) if (!p.isBot) this.markPrivate(p);
    this.markPublic();
    return OK;
  }

  /**
   * g.testEnemyHexClear {} — drop every enemy 协议源石. The enemy side fights unmodified again from the next battle on:
   * `enemyHexMods` / `enemyVerbIds` / `enemyHexPayout` all read `Match.enemyHexes` fresh, so nothing has to be undone.
   */
  testEnemyHexClear(ps) {
    const g = this._testGateEnemy(ps);
    if (g) return g;
    if (!Array.isArray(this.enemyHexes) || !this.enemyHexes.length) return OK;
    this.enemyHexes = [];
    this.hexDrawRound = 0;
    for (const p of this.order) if (!p.isBot) this.markPrivate(p);
    this.markPublic();
    return OK;
  }

  /**
   * g.testBoss { bossId? } — 测试场 直接到 boss 战（业主 2026-10-21「测试场可以直接到 boss 战」）。
   *
   * Skips every round before the mode's leader round and re-enters that round's prep, so the tester places operators /
   * grants 协议源石 / adds funds and then presses Ready exactly as in the real round; `bossId` names the leader (any
   * data/bosses.json entry, hand-added ones included), absent keeps the leader this match already drew.
   *
   * The leader is fought on ITS OWN wave (`Match.testBossTemplate`, consumed by startFinalAssault): a test field must be
   * able to show a leader the current mode does not draw, and the mode's round templates only cover its own pool.
   * Refused while a battle is running — the field would be torn down under the players — and outside a test field.
   */
  testBoss(ps, bossId) {
    const g = this._testGate(ps);
    if (g) return g;
    const running = [PHASE.COMBAT, PHASE.UNITE, PHASE.FINAL_ASSAULT, PHASE.HIDDEN_CORE, PHASE.RESULT];
    if (running.includes(this.phase)) return fail(ERR.WRONG_PHASE, 'test boss: a battle is running');
    const want = typeof bossId === 'string' && bossId ? bossId : this.bossId;
    const boss = typeof want === 'string' ? this.gd.boss(want) : null;
    if (!boss) return fail(ERR.BAD_TARGET, 'test boss: unknown leader');
    // the leader's own wave: prefer this mode's declaration, else any mode's (the wave's leader spawn is that boss)
    const templates = boss.templates && typeof boss.templates === 'object' ? boss.templates : {};
    const soloRoom = this.isSolo;
    let tpl = (templates[this.modeId] || Object.values(templates)[0] || null)?.template || null;
    if (typeof tpl !== 'string' || !this.gd.wave(tpl)) return fail(ERR.BAD_TARGET, 'test boss: no wave for that leader');
    if (soloRoom && !/_s$/.test(tpl) && this.gd.wave(`${tpl}_s`)) tpl = `${tpl}_s`;
    else if (!soloRoom && /_s$/.test(tpl) && this.gd.wave(tpl.replace(/_s$/, ''))) tpl = tpl.replace(/_s$/, '');
    // drop whatever the skipped rounds left half-done (a draft, a deadline, a queued prep end)
    this.setDeadline(0);
    this._prepEndQueued = false;
    this.draft = null;
    this.sp = null;
    this.round = this.gd.mode.bossRound;
    // land with a fieldable roster: the skipped rounds' economy comes in through the production startRound (income +
    // shop roll) at the shop level a match would roughly have by that round, plus a starting purse [ASSUMED test
    // convenience — a tester came to the leader, not to grind rounds]
    for (const p of this.alivePlayers()) {
      const wantLevel = Math.min(this.gd.maxShopLevel, 1 + Math.floor((this.round - 1) / 3));
      if (p.shop.level < wantLevel) p.shop.level = wantLevel;
      p.startRound(this.round);
      if (p.funds < TEST_BOSS_PURSE) p.addFunds(TEST_BOSS_PURSE - p.funds, { reason: 'test' });
      p.recompute();
    }
    this.bossId = boss.bossId;
    this.testBossTemplate = tpl;
    this.bossWaves = null;
    this.enterPrep();
    return OK;
  }

  /**
   * The shared gate: a test field only, and never for an eliminated or departed seat (a normal intent's own gate is
   * `_gate`, but that one is PREP-only and the panel works in every phase).
   */
  _testGate(ps) {
    if (!this.isTestField()) return fail(ERR.WRONG_PHASE, 'not a test field');
    if (!ps || ps.left) return fail(ERR.NOT_IN_ROOM);
    if (!ps.alive) return fail(ERR.ELIMINATED);
    return null;
  }

  /**
   * The enemy side's gate: `_testGate` plus "exactly one human seat".
   *
   * The enemy 协议源石 is the one piece of test state that is NOT per-player — it belongs to the match, so a grant changes
   * what every other seat's field fights. The lobby only ever creates a test field as a solo room (`room.create` refuses
   * `mode: 'coop'` with `test`), so in practice this is always satisfied; the guard keeps the intent honest if a future
   * platform hands a test flag to a shared room, and gives that case a clear error instead of one player silently editing
   * another's battle.
   */
  _testGateEnemy(ps) {
    const g = this._testGate(ps);
    if (g) return g;
    const humans = this.order.filter((p) => !p.isBot && !p.left);
    if (humans.length > 1) return fail(ERR.WRONG_PHASE, 'the enemy side is shared: a test field is solo only');
    return null;
  }
}

/** The phases the panel is offered in (the client shows it in every non-RESULT phase; kept here for the tests). */
export const TEST_PHASES = Object.freeze([
  PHASE.INFO_CHECK, PHASE.BAND_DRAFT, PHASE.BATTLE_CHECK, PHASE.ROUND_START, PHASE.SP_DRAFT, PHASE.PREP,
  PHASE.COMBAT, PHASE.UNITE, PHASE.SETTLE, PHASE.FINAL_ASSAULT, PHASE.HIDDEN_CORE,
]);
