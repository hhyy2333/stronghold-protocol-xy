// test/render/charge-ring.test.js — the 技能充能层数 ring of the battle HUD (render/units.js `chargeRingName`).
//
// A charge skill (data/chess.json `maxChargeTime` 2: 87 operators, 3: 11) stores up to `maxCharges` uses; the official
// client shows them as a segmented ring whose picture is `<segments>_<lit segments>` under the local client's `ui/battle`
// group. The renderer needs PIXI and a browser, so only the "which picture" decision is exported and tested here — plus a
// check that every name it can ever return is a picture that really exists (art and code pinned together).
//
// Run directly: node test/render/charge-ring.test.js   (`node --test` cannot spawn in this sandbox: EPERM)

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chargeRingName } from '../../public/js/render/units.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const GROUP_DIR = path.join(ROOT, 'public/assets/local/ui/battle');
const MANIFEST = path.join(ROOT, 'data/local-assets.json');
/** The ring pictures the game data can ask for (maximum 1..4, lit 1..maximum) plus the one empty ring `1_0`. */
const EVERY_RING = [
  '1_0', '1_1',
  '2_1', '2_2',
  '3_1', '3_2', '3_3',
  '4_1', '4_2', '4_3', '4_4',
];

describe('chargeRingName: which picture the HUD draws', () => {
  test('the stored count lights that many segments of a ring cut into `maximum`', () => {
    assert.equal(chargeRingName(0, 2), '1_0');
    assert.equal(chargeRingName(2, 2), '2_2');
    assert.equal(chargeRingName(1, 2), '2_1');
    assert.equal(chargeRingName(1, 3), '3_1');
    assert.equal(chargeRingName(2, 3), '3_2');
    assert.equal(chargeRingName(3, 3), '3_3');
    assert.equal(chargeRingName(4, 4), '4_4');
  });

  test('nothing stored is the empty ring whatever the maximum (the pictures have no `<n>_0`)', () => {
    for (const max of [1, 2, 3, 4]) assert.equal(chargeRingName(0, max), '1_0', `maximum ${max}`);
    // a skill that stores a single charge draws the one-segment ring when it holds it
    assert.equal(chargeRingName(1, 1), '1_1');
    assert.equal(chargeRingName(0, 1), '1_0');
  });

  test('a stored count past the maximum is clamped to it (a stale or rounded snapshot)', () => {
    assert.equal(chargeRingName(5, 2), '2_2');
    assert.equal(chargeRingName(9, 3), '3_3');
    assert.equal(chargeRingName(99, 4), '4_4');
    assert.equal(chargeRingName(1.9, 3), '3_1', 'fractions truncate, they never ask for a missing picture');
  });

  test('a maximum is clamped to 1..4: 1 is the plain SP bar, 4 is the widest picture', () => {
    assert.equal(chargeRingName(3, 9), '4_3');
    assert.equal(chargeRingName(4, 5), '4_4');
    assert.equal(chargeRingName(1, 0), '1_1', 'a nonsense maximum still lands on a real picture');
    assert.equal(chargeRingName(0, -3), '1_0');
  });

  test('junk never throws and still lands on a real picture', () => {
    for (const [stored, max] of [
      [NaN, NaN], [undefined, undefined], [null, null], [-5, -1], [-5, 3], ['2', '3'], ['', ''], [Infinity, Infinity],
      [1, 'nope'], [true, false],
    ]) {
      const name = chargeRingName(stored, max);
      assert.equal(typeof name, 'string', `${stored} / ${max}`);
      assert.ok(EVERY_RING.includes(name), `${stored} / ${max} → ${name} is a picture the local client has`);
    }
    assert.equal(chargeRingName(undefined, undefined), '1_0');
    assert.equal(chargeRingName(NaN, NaN), '1_0');
    assert.equal(chargeRingName('2', '3'), '3_2', 'a numeric string from a plugin / older snapshot still works');
  });

  test('every (stored, maximum) an operator can report maps to one of the eleven pictures', () => {
    for (let max = 1; max <= 4; max++) {
      for (let stored = 0; stored <= max; stored++) assert.ok(EVERY_RING.includes(chargeRingName(stored, max)), `${stored}/${max}`);
    }
  });
});

describe('the pictures are really there (art and code pinned together)', () => {
  test("every returned name has its '.png' in public/assets/local/ui/battle/", (t) => {
    // public/assets/ is git-ignored (no game art in git): a checkout without the local client art cannot check this
    if (!existsSync(GROUP_DIR)) {
      t.diagnostic('public/assets/local/ui/battle/ is not installed here — install the local client art to run this check');
      return;
    }
    for (let max = 1; max <= 4; max++) {
      for (let stored = 0; stored <= max; stored++) {
        const name = chargeRingName(stored, max);
        assert.ok(existsSync(path.join(GROUP_DIR, `${name}.png`)), `${name}.png is missing from public/assets/local/ui/battle/`);
      }
    }
    // and the other way round: no ring picture on disk that the renderer could never draw
    const onDisk = readdirSync(GROUP_DIR).filter((f) => /^[1-4]_[0-4]\.png$/.test(f)).map((f) => f.replace(/\.png$/, '')).sort();
    assert.deepEqual(onDisk, [...EVERY_RING].sort());
  });

  test('the local art manifest (data/local-assets.json) lists them under ui/battle, extension-less keys', (t) => {
    // per-machine file, untracked: a checkout that never ran the local extraction has no manifest
    if (!existsSync(MANIFEST)) {
      t.diagnostic('data/local-assets.json is not installed here — install the local client art to run this check');
      return;
    }
    const group = JSON.parse(readFileSync(MANIFEST, 'utf8')).groups?.['ui/battle'];
    assert.ok(group && typeof group === 'object', 'the manifest has the ui/battle group');
    for (const name of EVERY_RING) {
      const entry = group[name];
      assert.ok(entry && typeof entry.path === 'string', `ui/battle/${name} is listed`);
      assert.equal(entry.path, `/assets/local/ui/battle/${name}.png`, `ui/battle/${name} points at its file`);
    }
  });

  test('the HUD goes through this function and through the asset store, not a second copy of the rule', () => {
    const src = readFileSync(path.join(ROOT, 'public/js/render/units.js'), 'utf8');
    assert.match(src, /export function chargeRingName\(stored, maximum\)/);
    // the per-frame path: the view's [stored, maximum] → the name → a cached texture from the localUrl of 'ui/battle'
    assert.match(src, /chargeRingName\(ch\[0\], ch\[1\]\)/);
    assert.match(src, /localUrl\(CHARGE_RING_GROUP, name\)/);
    assert.match(src, /const CHARGE_RING_GROUP = 'ui\/battle';/);
  });
});
