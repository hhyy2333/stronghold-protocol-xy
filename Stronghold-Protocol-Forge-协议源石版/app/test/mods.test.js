// test/mods.test.js — 内容 mod (shared/mods.js; owner's decisions of 2026-10-09): one registry, one switch per mod, the
// switch belongs to the ROOM (the host picks it at creation and in the lobby), every mod is ON by default, and with a mod
// off its content is gone from the data the server reads, from the data /data/*.json serves and from every picker.
//
// This build declares two mods but only ONE carries content: `custom-fixed` owns the 固定 original operator 娅娜
// (char_9002_yana, a PRESET chess of the shared shop pool). `custom-ops` (自制干员, the 自选/DIY original operators) is
// still REGISTERED — its id stays valid on the wire and for SP_MODS — but 凛霜 (char_9001_rime) was removed on request,
// so it owns no data records and its switch is hidden (VISIBLE_MOD_IDS). Both facts are asserted below: the registry
// keeps the id, the data carries no mark for it, and turning it off is a no-op.
//
// The end-to-end half drives the real WebSocket lobby: a room created with the mod off never hands 娅娜 to the match,
// while a room that leaves it on does — the two rooms of one server, which is what the room-owned switch means.
import { describe, test, before, after, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import {
  MODS, MOD_IDS, VISIBLE_MOD_IDS, CUSTOM_OPS_MOD, CUSTOM_FIXED_MOD, DEFAULT_MODS, isModId, normalizeMods, modSet,
  parseMods, disabledMods, modOn, modMarks, hasModMarks, filterData, modsInData, anyModOff,
} from '../shared/mods.js';
import { isModList } from '../shared/protocol.js';
import { FIXED_OP_IDS, FIXED_CHESS_IDS, FIXED_GARRISON_IDS } from '../tools/custom-ops.mjs';
import { startServer } from '../server/index.js';
import { StubMatch } from '../server/match/StubMatch.js';
import { TestClient } from './helpers/wsClient.js';
import { ERR } from '../shared/constants.js';

const ROOT = join(import.meta.dirname, '..');
const readJson = (rel) => JSON.parse(readFileSync(join(ROOT, rel), 'utf8'));
const BACKUPS = readJson('data/backups.json');
const ASSETS = readJson('data/assets.json');
const CHESS = readJson('data/chess.json');
const GARRISONS = readJson('data/garrisons.json');
// the shapes the filters touch: `backups` / `assets` (自制干员) and `chess` / `garrisons` (固定干员)
const DATA = Object.freeze({ chess: CHESS, garrisons: GARRISONS, backups: BACKUPS, assets: ASSETS });

/** Whether the 固定 operator's chess records are in a (filtered) data set. */
const hasFixed = (data) => FIXED_CHESS_IDS.every((id) => Object.hasOwn(data.chess || {}, id));

describe('shared/mods.js: the registry and the switch', () => {
  test('the registry is the switch vocabulary: one id per mod, a name and a summary; 自制干员 is registered but hidden', () => {
    assert.deepEqual(MOD_IDS, Object.keys(MODS));
    assert.ok(MOD_IDS.includes(CUSTOM_OPS_MOD), 'the 自制干员 id stays registered');
    assert.ok(MOD_IDS.includes(CUSTOM_FIXED_MOD));
    for (const id of MOD_IDS) {
      const m = MODS[id];
      assert.equal(m.id, id);
      assert.equal(typeof m.name, 'string');
      assert.ok(m.name.length > 0);
      assert.equal(typeof m.summary, 'string');
      assert.ok(m.summary.length > 0);
      assert.equal(typeof m.apply, 'function');
      assert.ok(isModId(id));
    }
    // a hidden mod keeps its id valid (the wire, SP_MODS, a saved preference) but has no row in the window
    assert.equal(MODS[CUSTOM_OPS_MOD].hidden, true, '自制干员 owns no content in this build: its switch is hidden');
    assert.ok(!VISIBLE_MOD_IDS.includes(CUSTOM_OPS_MOD));
    assert.deepEqual(VISIBLE_MOD_IDS, MOD_IDS.filter((id) => !MODS[id].hidden));
    assert.ok(VISIBLE_MOD_IDS.includes(CUSTOM_FIXED_MOD), 'the mod that still has content is visible');
    assert.ok(!isModId('nope') && !isModId('') && !isModId(null) && !isModId('constructor') && !isModId('__proto__'));
  });

  test('the default is every mod on (an install that never mentions mods plays the full content)', () => {
    assert.deepEqual([...DEFAULT_MODS], MOD_IDS);
    assert.deepEqual(normalizeMods(null), MOD_IDS);
    assert.deepEqual(normalizeMods(undefined), MOD_IDS);
    assert.deepEqual(normalizeMods([]), [], 'an explicit empty list means every mod off');
    assert.equal(anyModOff(null), false);
    assert.equal(anyModOff([]), true);
  });

  test('normalizeMods: unknown ids dropped, registry order kept, duplicates collapse, a Set works', () => {
    assert.deepEqual(normalizeMods(['nope', ...MOD_IDS]), MOD_IDS);
    assert.deepEqual(normalizeMods([...MOD_IDS].reverse()), MOD_IDS, 'registry order, whatever the input order');
    assert.deepEqual(normalizeMods([CUSTOM_FIXED_MOD, CUSTOM_FIXED_MOD]), [CUSTOM_FIXED_MOD]);
    assert.deepEqual([...modSet(null)], MOD_IDS);
    assert.equal(modOn([], CUSTOM_FIXED_MOD), false);
    assert.equal(modOn(null, CUSTOM_FIXED_MOD), true);
    assert.deepEqual(disabledMods([]), MOD_IDS);
    assert.deepEqual(disabledMods(null), []);
  });

  test('parseMods: all / none / an allow-list / a diff list, with unknown ids reported (never silently ignored)', () => {
    assert.deepEqual(parseMods('').mods, MOD_IDS);
    assert.deepEqual(parseMods('all').mods, MOD_IDS);
    assert.deepEqual(parseMods('none').mods, []);
    assert.deepEqual(parseMods('-all').mods, []);
    assert.deepEqual(parseMods(CUSTOM_FIXED_MOD).mods, [CUSTOM_FIXED_MOD], 'a plain list is an allow-list of exactly the ids it names');
    assert.deepEqual(parseMods(`-${CUSTOM_FIXED_MOD}`).mods, MOD_IDS.filter((m) => m !== CUSTOM_FIXED_MOD), 'a minus prefix switches one off');
    assert.deepEqual(parseMods(`-${CUSTOM_FIXED_MOD},+${CUSTOM_FIXED_MOD}`).mods, MOD_IDS, 'a later + undoes an earlier -');
    // a HIDDEN id is still a legal value: SP_MODS=custom-ops stays meaningful (it is an allow-list of that one id)
    assert.deepEqual(parseMods(CUSTOM_OPS_MOD).mods, [CUSTOM_OPS_MOD], 'a hidden mod is still addressable by id');
    assert.deepEqual(parseMods(`-${CUSTOM_OPS_MOD}`).mods, [CUSTOM_FIXED_MOD]);
    const typo = parseMods('custom-op');
    assert.deepEqual(typo.unknown, ['custom-op'], 'a typo is reported, never treated as a switch');
    assert.deepEqual(typo.mods, [], 'and it does not silently enable anything');
  });

  test('the wire check: registered ids only, no duplicates, bounded (an unknown id is BAD_MSG, not dropped)', () => {
    assert.equal(isModList(MOD_IDS), true);
    assert.equal(isModList([]), true);
    assert.equal(isModList([CUSTOM_FIXED_MOD]), true);
    assert.equal(isModList([CUSTOM_OPS_MOD]), true, 'a hidden mod is still valid on the wire (saved preferences keep working)');
    assert.equal(isModList([CUSTOM_FIXED_MOD, CUSTOM_FIXED_MOD]), false, 'duplicates refused');
    assert.equal(isModList(['nope']), false);
    assert.equal(isModList('custom-ops'), false);
    assert.equal(isModList(null), false);
    assert.equal(isModList([...MOD_IDS, ...MOD_IDS]), false, 'longer than the registry');
  });

  test('data marks: the mod-owned records stamped by tools/build-data.mjs — only 固定干员 has any', () => {
    assert.ok(hasModMarks(BACKUPS), 'data/backups.json carries the stamp');
    const marks = modMarks(BACKUPS);
    // 娅娜's body is not a backups unit (a PRESET chess has no unit record): the art alias is what `units` names here
    assert.deepEqual([...marks.units].sort(), [...FIXED_OP_IDS].sort());
    assert.deepEqual([...marks.operators].sort(), [], 'no 自选 original operator ships: no diy operator record is marked');
    assert.deepEqual([...marks.tokens], [], 'and no summon');
    // its skill icons are their own ids (skchr_<codename>_<n>), never the charId — the stamp has to name them
    assert.deepEqual([...marks.skills].sort(), ['skchr_yana_1', 'skchr_yana_2', 'skchr_yana_3']);
    // the 自制干员 mod owns nothing in this build, so its stamp is absent
    assert.ok(!Object.hasOwn(BACKUPS.mods, CUSTOM_OPS_MOD), '凛霜 removed: the 自制干员 stamp is gone');
    assert.deepEqual(Object.keys(BACKUPS.mods), [CUSTOM_FIXED_MOD]);
    assert.deepEqual(modsInData({ backups: BACKUPS }), [CUSTOM_FIXED_MOD]);
    // an un-stamped data set filters to nothing (an older build / a hand-made fixture): mods are then a no-op
    assert.deepEqual(modsInData({ backups: { units: {} } }), null);
    assert.equal(hasModMarks({ units: {} }), false);
    assert.deepEqual([...modMarks({}).units], []);
    assert.deepEqual([...modMarks(null).units], []);
  });
});

describe('shared/mods.js: filterData removes exactly the content of a switched-off mod', () => {
  test('every mod on returns the SAME object (no copy, nothing rebuilt)', () => {
    assert.equal(filterData(DATA, null), DATA);
    assert.equal(filterData(DATA, MOD_IDS), DATA);
    assert.equal(filterData(DATA, modSet(MOD_IDS)), DATA);
  });

  test('the 固定 operator leaves the CHESS records (both forms), its own 特质 and its art — nothing else', () => {
    const off = filterData(DATA, [CUSTOM_OPS_MOD]);   // 自制干员 on, 固定干员 off
    for (const id of FIXED_CHESS_IDS) assert.ok(!Object.hasOwn(off.chess, id), `${id}: out of the chess table`);
    for (const gid of FIXED_GARRISON_IDS) assert.ok(!Object.hasOwn(off.garrisons, gid), `${gid}: its 特质 goes with it`);
    for (const id of FIXED_OP_IDS) assert.ok(!Object.hasOwn(off.assets.chars, id), `${id}: its art alias is gone`);
    for (const icon of Object.keys(ASSETS.skills).filter((k) => /^skchr_yana_/.test(k))) {
      assert.ok(!Object.hasOwn(off.assets.skills, icon), `${icon}: its skill icon is gone`);
      assert.ok(!Object.hasOwn(off.assets.skillsById, icon), `${icon}: and its skillsById mapping`);
    }
    // the counts: exactly the two forms less, exactly its own 特质 less, and its 3 skill icons + 1 art entry less
    assert.equal(Object.keys(off.chess).length, Object.keys(DATA.chess).length - FIXED_CHESS_IDS.length);
    assert.equal(Object.keys(off.garrisons).length, Object.keys(DATA.garrisons).length - FIXED_GARRISON_IDS.length);
    assert.equal(Object.keys(off.assets.chars).length, Object.keys(ASSETS.chars).length - FIXED_OP_IDS.length);
    assert.equal(Object.keys(off.assets.skills).length, Object.keys(ASSETS.skills).length - 3);
    // an official chess and its 特质 are untouched, and a shared 特质 would stay (checked by id, see the filter)
    assert.ok(Object.hasOwn(off.chess, 'chess_char_3_21_a'), 'an official chess stays');
    assert.ok(Object.hasOwn(off.garrisons, 'garrison_51_a'), 'an official 特质 stays');
    assert.equal(off.backups, DATA.backups, 'custom-fixed touches no backups record');
    // only the touched objects are copied
    assert.equal(off.assets.audio, ASSETS.audio);
  });

  test('the 自制干员 switch is a no-op on the data (this build declares no 自选 original operator)', () => {
    // 凛霜 was the only one; with her gone, custom-ops owns no marks, so its apply returns the SAME data object
    const off = filterData(DATA, [CUSTOM_FIXED_MOD]);   // 固定干员 on, 自制干员 off
    assert.equal(off, DATA, 'nothing to remove: the input reference comes straight back');
    assert.ok(hasFixed(off), '娅娜 stays in the pool');
    assert.ok(off.backups.diy.ownedPool.includes('char_112_siege'), 'the official 自选 pool is untouched');
  });

  test('the input is never mutated (the server\'s data is deep-frozen and shared)', () => {
    const before = JSON.stringify(BACKUPS);
    const chessBefore = JSON.stringify(CHESS);
    filterData(DATA, []);
    filterData(DATA, [CUSTOM_FIXED_MOD]);
    assert.equal(JSON.stringify(BACKUPS), before);
    assert.equal(JSON.stringify(CHESS), chessBefore);
  });

  test('a data set without the stamp is returned as it was (mods are a no-op there)', () => {
    const plain = { backups: { units: { a: 1 }, diy: { ownedPool: ['a'], operators: { a: 1 } } } };
    assert.equal(filterData(plain, []), plain);
    assert.equal(filterData({}, []).backups, undefined);
    assert.equal(filterData(null, []), null);
  });

  test('turning the mod off reproduces a build that never had the content, field for field', () => {
    // The strongest form of "the switch is real": strip the marked records from the raw data (a build without the
    // 固定 operator) and compare it with filterData(data, []) — they must be identical apart from the `mods` stamp
    // itself, which only says what the build carries. This is CUSTOM-OPS.md §5.4's "prove the diff is additive"
    // discipline, applied to the run-time filter instead of to a regenerated file.
    const marked = modMarks(BACKUPS);
    const strip = (obj, drop) => Object.fromEntries(Object.entries(obj).filter(([k]) => !drop.has(k)));
    const without = {
      backups: { ...BACKUPS, units: strip(BACKUPS.units, marked.units), tokens: strip(BACKUPS.tokens, marked.tokens) },
      assets: {
        ...ASSETS,
        chars: strip(ASSETS.chars, marked.units),
        skills: strip(ASSETS.skills, marked.skills),
        skillsById: strip(ASSETS.skillsById, marked.skills),
      },
    };
    const off = filterData(DATA, []);
    const clone = (v) => JSON.parse(JSON.stringify(v));
    const keysOf = (o) => Object.keys(o).filter((k) => k !== 'mods').sort();
    assert.deepEqual(keysOf(off.backups), keysOf(without.backups));
    for (const k of keysOf(without.backups)) assert.deepEqual(clone(off.backups[k]), clone(without.backups[k]), `backups.${k}`);
    for (const k of Object.keys(without.assets)) assert.deepEqual(clone(off.assets[k]), clone(without.assets[k]), `assets.${k}`);
    assert.equal(Object.keys(off.assets.chars).length, Object.keys(ASSETS.chars).length - 1);
  });
});

// ---- the room-owned switch, end to end over the real lobby ------------------------------------------

class RecordingStub extends StubMatch {
  static instances = [];
  constructor(opts) { super(opts); this.opts = opts; RecordingStub.instances.push(this); }
}

function clientPool(getUrl) {
  const open = new Set();
  return {
    async player(name, token) {
      const c = await TestClient.connect(getUrl());
      open.add(c);
      const w = await c.hello(name, token);
      c.id = w.playerId;
      c.token = w.token;
      c.welcome = w;
      return c;
    },
    async closeAll() {
      await Promise.all([...open].map((c) => c.terminate().catch(() => {})));
      open.clear();
    },
  };
}
const quietLog = () => {
  const errors = [];
  return { errors, log: { info() {}, warn() {}, debug() {}, error: (...a) => errors.push(a.map(String).join(' ')) } };
};
const ok = async (c, msg) => { const r = await c.request(msg); assert.equal(r.t, 'ok', `${msg.t}: ${JSON.stringify(r)}`); return r; };
const err = async (c, msg, code) => { const r = await c.request(msg); assert.equal(r.t, 'error', JSON.stringify(r)); assert.equal(r.code, code, JSON.stringify(r)); return r; };

describe('room.setMods / room.create (lobby, stub match)', () => {
  let srv;
  let pool;
  const cap = quietLog();
  before(async () => {
    srv = await startServer({ port: 0, host: '127.0.0.1', log: cap.log, MatchClass: RecordingStub, heavyBurst: 12, heavyPerSec: 4 });
    pool = clientPool(() => `ws://127.0.0.1:${srv.port}/ws`);
  });
  afterEach(async () => { RecordingStub.instances = []; await pool.closeAll(); });
  after(async () => { await srv?.close(); });

  test('a room created without a mod list plays with every mod on (the 0.3.0 default)', async () => {
    const c = await pool.player('Default');
    await ok(c, { t: 'room.create', mode: 'solo', difficulty: 'NORMAL' });
    const st = await c.waitFor('room.state', (s) => s.hostId === c.id);
    assert.deepEqual(st.mods, [...MOD_IDS]);
    await ok(c, { t: 'room.leave' });
  });

  test('the host picks the mods at creation; the room state carries them to everyone', async () => {
    const host = await pool.player('Host');
    await ok(host, { t: 'room.create', mode: 'coop', difficulty: 'NORMAL', mods: [] });
    const st = await host.waitFor('room.state', (s) => s.hostId === host.id && s.mode === 'coop');
    assert.deepEqual(st.mods, []);
    const guest = await pool.player('Guest');
    await ok(guest, { t: 'room.join', code: st.code });
    const seen = await guest.waitFor('room.state', (s) => s.seats.some((x) => x && x.playerId === guest.id));
    assert.deepEqual(seen.mods, [], 'a joiner sees the room it is about to play, mods included');
  });

  test('room.setMods: host-only, whole-list, un-readies the others, broadcasts, and is refused once the match runs', async () => {
    const host = await pool.player('Host2');
    await ok(host, { t: 'room.create', mode: 'coop', difficulty: 'NORMAL' });
    const st = await host.waitFor('room.state', (s) => s.hostId === host.id);
    const guest = await pool.player('Guest2');
    await ok(guest, { t: 'room.join', code: st.code });
    await guest.waitFor('room.state', (s) => s.seats.some((x) => x && x.playerId === guest.id));
    await ok(guest, { t: 'room.ready', ready: true });
    await host.waitFor('room.state', (s) => s.seats.some((x) => x && x.playerId === guest.id) && s.seats.find((x) => x && x.playerId === guest.id).ready);

    // a non-host may not switch content
    await err(guest, { t: 'room.setMods', mods: [] }, ERR.NOT_HOST);
    // an unknown id is refused (never silently treated as off)
    await err(host, { t: 'room.setMods', mods: ['nope'] }, ERR.BAD_MSG);

    await ok(host, { t: 'room.setMods', mods: [] });
    const after = await guest.waitFor('room.state', (s) => Array.isArray(s.mods) && s.mods.length === 0);
    assert.deepEqual(after.mods, []);
    const gseat = after.seats.find((x) => x && x.playerId === guest.id);
    assert.equal(gseat.ready, false, 'a content change un-readies the others, as a difficulty change does');

    // starting locks the switches: a running match plays the content it started with
    await ok(guest, { t: 'room.ready', ready: true });
    await host.waitFor('room.state', (s) => s.seats.find((x) => x && x.playerId === guest.id)?.ready);
    await ok(host, { t: 'room.start' });
    await host.waitFor('m.public', (p) => p.phase === 'INFO_CHECK');
    await err(host, { t: 'room.setMods', mods: [...MOD_IDS] }, ERR.ROOM_STARTED);
  });

  test('with the mod off the match data has no 固定 operator; with it on the same room keeps her', async () => {
    // The switch is what decides: the SAME room creation, once with the mod off and once on.
    const off = await pool.player('FixedOff');
    await ok(off, { t: 'room.create', mode: 'coop', difficulty: 'NORMAL', mods: [CUSTOM_OPS_MOD] });   // 固定 off
    await off.waitFor('room.state', (s) => s.hostId === off.id && s.mode === 'coop');
    await ok(off, { t: 'room.addBot' });
    await ok(off, { t: 'room.start' });
    await off.waitFor('m.public', (p) => p.phase === 'INFO_CHECK');
    const offData = RecordingStub.instances.at(-1).opts.data;
    assert.ok(!hasFixed(offData), 'the match data has no 固定 operator');
    for (const id of FIXED_CHESS_IDS) assert.ok(!Object.hasOwn(offData.chess, id));

    const on = await pool.player('FixedOn');
    await ok(on, { t: 'room.create', mode: 'coop', difficulty: 'NORMAL', mods: [CUSTOM_FIXED_MOD] });   // 固定 on
    await on.waitFor('room.state', (s) => s.hostId === on.id && s.mode === 'coop');
    await ok(on, { t: 'room.addBot' });
    await ok(on, { t: 'room.start' });
    await on.waitFor('m.public', (p) => p.phase === 'INFO_CHECK');
    const onData = RecordingStub.instances.at(-1).opts.data;
    assert.ok(hasFixed(onData), 'the room that left the mod on carries her');
    assert.ok(onData.chess['chess_char_3_22_a'].visible, 'and she is a visible shop chess there');
  });

  test('two rooms of one server play different content (the switch is the room\'s, not the process\'s)', async () => {
    const withMod = await pool.player('WithMod');
    const withoutMod = await pool.player('WithoutMod');
    await ok(withMod, { t: 'room.create', mode: 'coop', difficulty: 'NORMAL', mods: [CUSTOM_FIXED_MOD] });
    await ok(withoutMod, { t: 'room.create', mode: 'coop', difficulty: 'NORMAL', mods: [] });
    const a = await withMod.waitFor('room.state', (s) => s.hostId === withMod.id);
    const b = await withoutMod.waitFor('room.state', (s) => s.hostId === withoutMod.id);
    assert.notEqual(a.code, b.code);
    assert.deepEqual(a.mods, [CUSTOM_FIXED_MOD]);
    assert.deepEqual(b.mods, []);
    await ok(withMod, { t: 'room.addBot' });
    await ok(withoutMod, { t: 'room.addBot' });
    await ok(withMod, { t: 'room.start' });
    await ok(withoutMod, { t: 'room.start' });
    await withMod.waitFor('m.public', (p) => p.phase === 'INFO_CHECK');
    await withoutMod.waitFor('m.public', (p) => p.phase === 'INFO_CHECK');
    const dataOf = (roomCode) => RecordingStub.instances.find((i) => i.opts.roomCode === roomCode).opts.data;
    assert.ok(hasFixed(dataOf(a.code)), 'the mod room carries the operator');
    assert.ok(!hasFixed(dataOf(b.code)), 'the plain room does not');
    assert.notEqual(dataOf(a.code), dataOf(b.code), 'the two rooms never share one filtered data object');
  });

  test('the 自选 picker list is the build\'s: the removed original operator is gone, the official pool is intact', async () => {
    // welcome carries the build's kit list (a superset); the per-room truth is what room.diy accepts
    const host = await pool.player('Kitted');
    await ok(host, { t: 'room.create', mode: 'solo', difficulty: 'NORMAL' });
    await host.waitFor('room.state', (s) => s.hostId === host.id);
    assert.ok(!host.welcome.diyKitted.includes('char_9001_rime'), '凛霜 has no kit file any more');
    assert.ok(host.welcome.diyKitted.includes('char_112_siege'), 'an official 自选 operator is still offered');
    // a pick naming the removed operator is DROPPED (the roster is lenient), never fielded
    await ok(host, { t: 'room.diy', picks: { chess_char_6_diy1_a: { charId: 'char_9001_rime', skillIndex: 2, uniEquipId: 'uniequip_002_rime' } } });
    assert.deepEqual(host.welcome.diyKitted.filter((id) => id === 'char_9001_rime'), []);
  });

  test('the server\'s own default (SP_MODS / the mods option) decides what a room gets when the host names none', async () => {
    // a second server with SP_MODS-style defaulting: its rooms start with the 固定 operator OFF, but a host may
    // still turn it back on for their own room (the switch stays the room's)
    const off = await startServer({
      port: 0, host: '127.0.0.1', log: quietLog().log, MatchClass: RecordingStub,
      heavyBurst: 12, heavyPerSec: 4, mods: 'none',
    });
    try {
      const c = await TestClient.connect(`ws://127.0.0.1:${off.port}/ws`);
      const w = await c.hello('Defaulted');
      c.id = w.playerId;
      await ok(c, { t: 'room.create', mode: 'solo', difficulty: 'NORMAL' });
      const st = await c.waitFor('room.state', (s) => s.mode === 'solo');
      assert.deepEqual(st.mods, [], 'SP_MODS=none: a room created without a list starts with every mod off');
      // and the host can still switch it on for this room
      await ok(c, { t: 'room.setMods', mods: [CUSTOM_FIXED_MOD] });
      const on = await c.waitFor('room.state', (s) => Array.isArray(s.mods) && s.mods.length === 1);
      assert.deepEqual(on.mods, [CUSTOM_FIXED_MOD]);
      await c.terminate();
    } finally { await off.close(); }
  });

  // The whole SP_MODS surface, one server per value: what a room created WITHOUT a mod list gets, and whether the
  // 固定 operator reaches the match. 'custom-op' (a typo) is the important one: parseMods reads a plain list as an
  // allow-list, so without the fail-safe a wrong id would parse to the EMPTY set and silently strip content from every
  // room of a server. 'custom-ops' (a HIDDEN id) is the other: it stays a legal value even though it has no switch.
  for (const [label, value, wantMods, wantFixed] of [
    ['all', 'all', [...MOD_IDS], true],
    ['none', 'none', [], false],
    ['an id', CUSTOM_FIXED_MOD, [CUSTOM_FIXED_MOD], true],
    ['a hidden id (the 自制干员 switch is gone, the id is not)', CUSTOM_OPS_MOD, [CUSTOM_OPS_MOD], false],
    ['a minus diff', `-${CUSTOM_FIXED_MOD}`, [CUSTOM_OPS_MOD], false],
    ['a typo (the whole value is ignored)', 'custom-op', [...MOD_IDS], true],
  ]) {
    test(`SP_MODS=${label}: a room with no list of its own gets ${wantMods.length ? wantMods.join(',') : 'nothing'}`, async () => {
      const srv = await startServer({
        port: 0, host: '127.0.0.1', log: quietLog().log, MatchClass: RecordingStub,
        heavyBurst: 12, heavyPerSec: 4, mods: value,
      });
      try {
        const c = await TestClient.connect(`ws://127.0.0.1:${srv.port}/ws`);
        const w = await c.hello('SrvDefault');
        c.id = w.playerId;
        await ok(c, { t: 'room.create', mode: 'coop', difficulty: 'NORMAL' });
        const st = await c.waitFor('room.state', (s) => s.hostId === c.id && s.mode === 'coop');
        assert.deepEqual(st.mods, wantMods, `SP_MODS=${value}`);
        await ok(c, { t: 'room.addBot' });
        await ok(c, { t: 'room.start' });
        await c.waitFor('m.public', (p) => p.phase === 'INFO_CHECK');
        const data = RecordingStub.instances.at(-1).opts.data;
        if (wantFixed) assert.ok(hasFixed(data), 'the 固定 operator is fielded');
        else assert.ok(!hasFixed(data), 'the 固定 operator is gone');
        await c.terminate();
      } finally { await srv.close(); }
    });
  }

  test('nothing crashed the server through any of it', () => {
    assert.deepEqual(cap.errors, []);
  });
});

describe('the server and the browser filter with the same rule', () => {
  test('the shared filter is what both sides call (no second copy of the rule)', () => {
    // the client store imports filterData from shared/mods.js; the server imports it from shared/mods.js too
    const client = readFileSync(join(ROOT, 'public/js/data.js'), 'utf8');
    assert.match(client, /from '\.\.\/\.\.\/shared\/mods\.js'/, 'public/js/data.js uses the shared module');
    const lobby = readFileSync(join(ROOT, 'server/lobby.js'), 'utf8');
    assert.match(lobby, /from '\.\.\/shared\/mods\.js'/, 'server/lobby.js uses the shared module');
  });

  test('a room with every mod on serves the same data as before the feature (golden content unchanged)', () => {
    // filterData is the identity for the default mods: the golden corpus and every existing test therefore still run on
    // byte-identical data (this is the guard that keeps the feature from moving the 0.3.0 baseline)
    const on = filterData(DATA, null);
    assert.equal(on, DATA);
    assert.deepEqual(modsInData(on), [CUSTOM_FIXED_MOD]);
  });

  test('the window offers a row per VISIBLE mod, and a hidden mod never appears', () => {
    // the UI reads VISIBLE_MOD_IDS (public/js/ui/mods.js), so the two must agree about what is hidden
    assert.equal(VISIBLE_MOD_IDS.length, MOD_IDS.length - 1);
    assert.deepEqual([...VISIBLE_MOD_IDS], [CUSTOM_FIXED_MOD]);
  });
});
