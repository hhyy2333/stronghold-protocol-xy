// test/sim/hextech-directive.test.js — 指令之意 / 指令之意·改 must **show what they rolled**.
//
// Both cards decide their effect with a coin flip at battle start (「作战开始时随机指定一种职业 / 一种伤害类型」). The
// roll used to be invisible — the buff landed on whoever it landed on. content/hexcards/batch10.js now records it on
// the battle, sim/battle/events.js publishes it as `snap.dirs`, and ui/combatHud.js renders it beside the DP counter.
// This drives the REAL Battle through the harness (the same shape as test/sim/hextech-batch6.test.js) and checks the
// whole path, including the two properties that a naive implementation gets wrong: the roll must be published ONCE
// (not re-rolled every tick) and the two cards must not overwrite each other.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { makeBattle, chessRec, enemyRec } from '../helpers/battleHarness.js';
import { snapHud } from '../../public/js/ui/gameLogic/format.js';
import { COLS } from '../../server/sim/constants.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const HEXTECH = JSON.parse(readFileSync(path.join(ROOT, 'data', 'hextech.json'), 'utf8'));

/** The hex record of data/hextech.json, or a clear failure. */
function hex(id) {
  const rec = HEXTECH.playerHexes[id];
  assert.ok(rec, `data/hextech.json has no ${id}`);
  return rec;
}

/** One playerEffects entry, the shape server/match/hextech.js addHexRef writes. */
const refOf = (hexId) => {
  const rec = hex(hexId);
  return {
    id: `hex:${hexId}`, key: `hex:${hexId}`, name: rec.name, desc: rec.desc, iconKind: 'hex', iconId: rec.icon,
    counter: null, battle: true, params: { ...rec.effect, hexId, rarity: rec.rarity }, data: { hexId, rarity: rec.rarity },
  };
};

const melee = (o = {}) => chessRec({ id: 'test_melee', profession: 'WARRIOR', dmgType: 'phys', stats: { maxHp: 3000, atk: 500, def: 200, res: 0, blockCnt: 2, respawnTime: 20 }, skill: null, ...o });
const caster = (o = {}) => chessRec({ id: 'test_caster', profession: 'CASTER', dmgType: 'arts', stats: { maxHp: 1200, atk: 400, def: 0, res: 0, blockCnt: 1, respawnTime: 20 }, skill: null, ...o });
const sniper = (o = {}) => chessRec({ id: 'test_sniper', profession: 'SNIPER', dmgType: 'phys', position: 'RANGED', stats: { maxHp: 1200, atk: 450, def: 0, res: 0, blockCnt: 0, respawnTime: 20 }, skill: null, ...o });
const dummy = (o = {}) => enemyRec({ key: 'enemy_dummy', hp: 100000, atk: 0, speed: 0, ...o });

/** One player carrying `hexes`, the three professions the card may roll on the board, one harmless enemy. */
function battle({ hexes = [], units = null } = {}) {
  return makeBattle({
    defs: { chess: { test_melee: melee(), test_caster: caster(), test_sniper: sniper() }, enemies: { enemy_dummy: dummy() } },
    players: [{
      playerId: 'p1', seat: 0, side: 'L', colOffset: 0, bonds: {},
      playerEffects: hexes.map(refOf),
      units: units || [
        { uid: 1, kind: 'chess', chessId: 'test_melee', row: 9, col: 6 },
        { uid: 2, kind: 'chess', chessId: 'test_caster', row: 9, col: 8 },
        { uid: 3, kind: 'chess', chessId: 'test_sniper', row: 9, col: 10 },
      ],
    }],
    enemies: [{ key: 'enemy_dummy', time: 0, pos: [9, 14] }],
    autoFinish: false,
    timeLimit: 20,
  });
}

/** My rows of snap.dirs, i.e. what ui/combatHud.js HexDirectives would draw. */
const dirsFor = (h, pid = 'p1') => (h.snapshot().dirs || []).filter((r) => r[0] === pid);

// =====================================================================================================================
// the two rolls reach the snapshot

test('指令之意: the profession it rolled is published, and the buff lands on that same profession', () => {
  const h = battle({ hexes: ['hex_directive'] });
  h.run(1);
  const rows = dirsFor(h);
  assert.equal(rows.length, 1, 'exactly one row for the one card I own');
  const [pid, hexId, kind, pick, amount] = rows[0];
  assert.equal(pid, 'p1');
  assert.equal(hexId, 'hex_directive', 'the row names the card, so the HUD can label it');
  assert.equal(kind, 'prof', 'the value is a profession code');
  // 业主 2026-10-21: the roll is among SNIPER / WARRIOR / CASTER, independent of who is fielded
  assert.ok(['SNIPER', 'WARRIOR', 'CASTER'].includes(pick), `rolled one of the three named professions, got ${pick}`);
  assert.equal(amount, 50, 'the strength comes from the card spec');
  // the buff agrees with the published roll — the chip may never disagree with who actually got stronger
  const buffed = h.battle.allyUnits.filter((u) => (u.buffs || []).some((b) => b.key === 'hex:directive'));
  assert.ok(buffed.length >= 1, 'somebody was buffed');
  for (const u of buffed) assert.equal(u.def.profession, pick, 'every buffed operator is of the rolled profession');
});

test('指令之意·改: the damage type it rolled is published, and only phys / arts are candidates', () => {
  const h = battle({ hexes: ['hex_directive2'] });
  h.run(1);
  const rows = dirsFor(h);
  assert.equal(rows.length, 1);
  const [, hexId, kind, pick, amount] = rows[0];
  assert.equal(hexId, 'hex_directive2');
  assert.equal(kind, 'dmg', 'the value is a damage type');
  assert.ok(['phys', 'arts'].includes(pick), `rolled one of the two damage types, got ${pick}`);
  assert.equal(amount, 200, '业主 2026-10-21: 150 % → 200 %');
});

test('owning BOTH cards publishes one row each — a per-player slot would let the second overwrite the first', () => {
  const h = battle({ hexes: ['hex_directive', 'hex_directive2'] });
  h.run(1);
  const rows = dirsFor(h);
  assert.equal(rows.length, 2, 'both cards report');
  assert.deepEqual(rows.map((r) => r[1]).sort(), ['hex_directive', 'hex_directive2']);
  assert.deepEqual(rows.map((r) => r[2]).sort(), ['dmg', 'prof']);
});

test('the roll is published once — later ticks do not re-roll it', () => {
  const h = battle({ hexes: ['hex_directive', 'hex_directive2'] });
  h.run(1);
  const first = JSON.stringify(dirsFor(h));
  h.run(5);
  h.run(10);
  assert.equal(JSON.stringify(dirsFor(h)), first, 'the published roll is stable for the whole battle');
});

test('nothing is published before an operator is on the field (the roll is not made yet)', () => {
  // no operators deployed: batch10 re-rolls every tick until one is, and publishing those would make the chip flicker
  const h = battle({ hexes: ['hex_directive'], units: [] });
  h.run(3);
  assert.equal(dirsFor(h).length, 0, 'no row until the roll is final');
});

test('a battle without these cards publishes no dirs at all — a hextech-less battle is unchanged', () => {
  const h = battle({ hexes: ['hex_armor'] });
  h.run(2);
  assert.equal(h.snapshot().dirs, undefined, 'snap.dirs is absent, not an empty list');
});

// =====================================================================================================================
// the client path

test('snapHud carries dirs through to the HUD untouched', () => {
  const rows = [['p1', 'hex_directive', 'prof', 'WARRIOR', 50]];
  assert.deepEqual(snapHud({ dp: 3, dirs: rows }).dirs, rows);
  assert.equal(snapHud({ dp: 3 }).dirs, null, 'absent → null, so the chip renders nothing');
  assert.equal(snapHud({ dp: 3, dirs: 'nonsense' }).dirs, null, 'a malformed field is ignored, not trusted');
});

test('the HUD draws it, and the CSS keeps it off the effects column', () => {
  const hud = readFileSync(path.join(ROOT, 'public/js/ui/combatHud.js'), 'utf8');
  assert.match(hud, /<\$\{HexDirectives\} hud=\$\{hud\} myId=\$\{myId\} \/>/, 'CombatHud renders the chip');
  assert.match(hud, /hexId === 'hex_directive2'/, 'and names the card it came from');
  const css = readFileSync(path.join(ROOT, 'public/css/screens/game.css'), 'utf8');
  const grab = (re, what) => { const m = re.exec(css); assert.ok(m, `layout: ${what} not found`); return Number(m[1]); };
  const colRight = grab(/^\.gm__effects \{[^}]*\bright: ([\d.]+)rem/m, '.gm__effects right');
  const tile = grab(/^\.effect \{\s*position: relative; width: ([\d.]+)rem/m, '.effect width');
  const chipRight = grab(/^\.hexdirs \{[^}]*\bright: ([\d.]+)rem/m, '.hexdirs right');
  assert.ok(chipRight >= colRight + tile + 0.25,
    `the chip (right ${chipRight}rem) must clear the effects column (left edge at right ${colRight + tile}rem)`);
});

// =====================================================================================================================
// the harness invariant involved (test/helpers/battleHarness.js)

test('the occupancy invariant uses the sim key space, not the 21-wide field', () => {
  // Regression guard: the checker hardcoded `* 21` (GEO.COLS, the semantic field width) while the sim keys `_occ` on
  // `r * COLS + c` with COLS = GEO.CANVAS_COLS = 33. Every column past 21 read the wrong cell and correct boards threw
  // "occupancy map out of sync" — which is what made ~68 cases of test/sim/hextech-*.test.js fail.
  assert.equal(COLS, 33, 'the canvas is 33 columns wide');
  const src = readFileSync(path.join(ROOT, 'test/helpers/battleHarness.js'), 'utf8');
  assert.match(src, /b\._occ\[u\.tileR \* COLS \+ u\.tileC\]/, 'the checker reads the same stride the sim writes');
});
