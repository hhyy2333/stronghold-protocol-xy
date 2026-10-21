// test/ui/hexBans.test.js — the pure half of 协议源石禁用 (业主 2026-10-21): the localStorage shape, the ≤ 3 cap, the
// toggle (a fourth card is refused, never silently replacing one) and the semantic filter against the loaded pool.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  cleanHexBans, parseStoredHexBans, toStoredHexBans, sanitizeHexBans, isHexBanned, toggleHexBan, hexBanPool, HEX_BANS_PREF,
} from '../../public/js/ui/hexBanModel.js';
import { HEX_BANS_LIMIT } from '../../shared/protocol.js';

const pool = ['hex_stipend', 'hex_echo', 'hex_recruit', 'hex_refresh'];

test('cleanHexBans: strings only, de-duplicated, in order, capped at 3', () => {
  assert.deepEqual(cleanHexBans(null), []);
  assert.deepEqual(cleanHexBans('nope'), []);
  assert.deepEqual(cleanHexBans(['hex_a', 3, '', null, 'hex_a', 'hex_b', 'hex_c', 'hex_d']), ['hex_a', 'hex_b', 'hex_c']);
  assert.equal(cleanHexBans(['a', 'b', 'c', 'd']).length, HEX_BANS_LIMIT);
});

test('stored shape: { v: 1, ids } round-trips, junk reads as []', () => {
  assert.equal(HEX_BANS_PREF, 'hexBans');
  assert.deepEqual(parseStoredHexBans(null), []);
  assert.deepEqual(parseStoredHexBans({ v: 1, ids: ['hex_a', 'hex_b'] }), ['hex_a', 'hex_b']);
  assert.deepEqual(parseStoredHexBans({ ids: ['hex_a', 'hex_a'] }), ['hex_a']);
  assert.deepEqual(toStoredHexBans(['hex_a', 'hex_b']), { v: 1, ids: ['hex_a', 'hex_b'] });
});

test('toggle: add / remove; a fourth card is refused and the list is kept', () => {
  let r = toggleHexBan([], 'hex_a');
  assert.deepEqual(r, { ok: true, ids: ['hex_a'] });
  r = toggleHexBan(r.ids, 'hex_a');
  assert.deepEqual(r, { ok: true, ids: [] }, 'clicking again removes it');
  r = toggleHexBan(['hex_a', 'hex_b', 'hex_c'], 'hex_d');
  assert.deepEqual(r, { ok: false, ids: ['hex_a', 'hex_b', 'hex_c'] }, 'the cap refuses, it does not replace');
  assert.ok(isHexBanned(['hex_a'], 'hex_a') && !isHexBanned(['hex_a'], 'hex_b'));
});

test('sanitize: unknown ids are dropped, the legal ones kept, never the whole list refused', () => {
  assert.deepEqual(sanitizeHexBans(['hex_stipend', 'nope', 'hex_echo'], new Set(pool)), ['hex_stipend', 'hex_echo']);
  assert.deepEqual(sanitizeHexBans(['nope'], new Set(pool)), []);
  assert.deepEqual(sanitizeHexBans(['hex_stipend'], []), [], 'no pool ⇒ nothing is legal yet');
  assert.deepEqual(hexBanPool({ playerHexes: { hex_stipend: { id: 'hex_stipend' }, x: null } }), ['hex_stipend']);
  assert.deepEqual(hexBanPool(null), []);
});
