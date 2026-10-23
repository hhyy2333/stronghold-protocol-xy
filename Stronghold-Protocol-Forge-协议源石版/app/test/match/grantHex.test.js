// test/match/grantHex.test.js — Match.grantHex (DESIGN §28.58): the one engine seam a workshop pack's
// `server.modules[].matchClass` wrapper may call to put a 协议源石 into a player's hands.
//
// Why this method exists: a pack can reach every OTHER purchase path through public Match/PlayerState methods
// (`ps.acquireItem`, `ps.spend`, `this.itemPool`), but a real hex grant is `applyHex` — a module function that builds the
// persistent `hex:<id>` EffectRef, runs the concurrent `onHexPick` handler, folds in 镜像协议 / 二次抽取 / 债务 and the
// battle half. A pack cannot import it (a pack must not import engine internals) and must not re-implement it (a copy of
// those rules drifts silently), so the engine exposes exactly one wrapper. This suite pins that wrapper's contract.
//
// The behaviour it must keep is `g.testHex`'s (test/match/testField.test.js pins the intent): same production path, the
// same card twice is allowed (ref deduped, immediate part re-run), anything outside the PLAYER roster is refused.
//
// Every case below drives a NORMAL match (no `test` flag) — that is the point of the seam — and compares against a
// baseline instead of "no hex at all": a normal match has just run the round-1 draft, so the player owns whatever it
// picked.

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { makeMatch, DATA } from './harness.js';
import { hexIdsOf } from '../../server/match/hextech.js';
import { MatchHexDraft } from '../../server/match/match/hexDraft.js';

/** 战备津贴: its `onPick` grants funds, so a grant leaves an observable trace beyond the ref. */
const FUNDS_HEX = 'hex_stipend';
/** The onPick amount the shipped data gives it (3 since 2026-10-11's §29.20 revision). */
const FUNDS_ON_PICK = 3;
/** The first ENEMY card of the roster: never a thing a player may own. */
const ENEMY_HEX = Object.keys(DATA.hextech.enemyHexes)[0];

/** The ids `ps` owns, sorted (the order of `effects` is not part of the contract). */
const owned = (ps) => hexIdsOf(ps).slice().sort();

describe('Match.grantHex: the pack-facing grant seam (DESIGN §28.58)', () => {
  test('the method lives on MatchHexDraft.prototype and therefore on every Match', () => {
    assert.equal(Object.hasOwn(MatchHexDraft.prototype, 'grantHex'), true, 'defined by the hex-draft container');
    const h = makeMatch({ mode: 'solo', difficulty: 'FUNNY', seed: 41, fake: true }).start();
    assert.equal(typeof h.m.grantHex, 'function', 'installed on Match.prototype by Match.js');
    h.m.dispose();
  });

  test('grants through the production path OUTSIDE a test field: ref, effect column and the immediate part', () => {
    const h = makeMatch({ mode: 'solo', difficulty: 'FUNNY', seed: 43, fake: true }).start();
    h.toPrep(1);
    const ps = h.ps('p_0');
    const before = owned(ps);
    const funds = ps.funds;
    const hex = h.m.grantHex(ps, FUNDS_HEX);
    assert.ok(hex, 'returns the granted record');
    assert.equal(hex.id, FUNDS_HEX);
    assert.deepEqual(owned(ps), [...before, FUNDS_HEX].sort(), 'the persistent ref is the hex');
    assert.equal(ps.funds, funds + FUNDS_ON_PICK, 'the onHexPick handler ran');
    const eff = ps.privateView().effects.find((e) => e.id === `hex:${FUNDS_HEX}`);
    assert.ok(eff, 'the effect column carries it');
    assert.equal(eff.iconKind, 'hex');
    h.invariants();
    h.m.dispose();
  });

  test('the same card twice: one ref, the immediate part re-runs (the g.testHex rule)', () => {
    const h = makeMatch({ mode: 'solo', difficulty: 'FUNNY', seed: 47, fake: true }).start();
    h.toPrep(1);
    const ps = h.ps('p_0');
    const before = owned(ps);
    const funds = ps.funds;
    assert.ok(h.m.grantHex(ps, FUNDS_HEX));
    assert.ok(h.m.grantHex(ps, FUNDS_HEX), 'a repeat is not an error');
    assert.deepEqual(owned(ps), [...before, FUNDS_HEX].sort(), 'never two refs for one card');
    assert.equal(ps.funds, funds + FUNDS_ON_PICK * 2, 'the immediate part ran twice');
    h.invariants();
    h.m.dispose();
  });

  test('refuses anything outside the PLAYER roster, and changes nothing', () => {
    const h = makeMatch({ mode: 'solo', difficulty: 'FUNNY', seed: 53, fake: true }).start();
    h.toPrep(1);
    const ps = h.ps('p_0');
    const before = owned(ps);
    const funds = ps.funds;
    assert.equal(h.m.grantHex(ps, ENEMY_HEX), null, 'an enemy card is not a player card');
    assert.equal(h.m.grantHex(ps, 'hex_nope'), null, 'unknown id');
    assert.equal(h.m.grantHex(ps, ''), null, 'empty id');
    assert.equal(h.m.grantHex(ps, null), null, 'non-string id');
    assert.equal(h.m.grantHex(ps, 42), null, 'non-string id');
    assert.equal(h.m.grantHex(null, FUNDS_HEX), null, 'no player');
    assert.deepEqual(owned(ps), before, 'nothing was granted');
    assert.equal(ps.funds, funds, 'no side effect');
    h.m.dispose();
  });
});
