// test/render/damage-number-style.test.js — the damage-number styles (public/js/render/style.js + fx/numbers.js) and the
// 【圣佑】snipe number (业主 2026-11-05「战斗中实时对狙击伤害以蓝色数字跳字」).
//
// The renderer itself needs PIXI and a browser, so what is pinned here is the pure part: every style owns its bitmap
// font (fx/fonts.js generates one per DMG_STYLE entry), the snipe style is the blue one, and the renderer takes the
// number style from the event's own slot instead of guessing it from the damage type.
//
// Run: node --test test/render/damage-number-style.test.js

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DMG_STYLE, HIT_TINT, dmgStyleKey } from '../../public/js/render/style.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const read = (p) => readFileSync(path.join(ROOT, p), 'utf8');

describe('damage-number styles', () => {
  test('every style has its own bitmap font, fill and stroke (fx/fonts.js builds one per entry)', () => {
    for (const [key, st] of Object.entries(DMG_STYLE)) {
      assert.match(st.font, /^sp-dmg-/, key);
      assert.equal(st.fill.length, 2, key);
      assert.match(st.stroke, /^#[0-9a-f]{6}$/i, key);
    }
    const fonts = new Set(Object.values(DMG_STYLE).map((s) => s.font));
    assert.equal(fonts.size, Object.keys(DMG_STYLE).length, 'no two styles share a font');
  });

  test('the snipe style is blue and keeps its own hit tint', () => {
    assert.ok(DMG_STYLE.snipe, 'a style for 圣佑的狙击');
    assert.equal(DMG_STYLE.snipe.font, 'sp-dmg-snipe');
    assert.equal(DMG_STYLE.snipe.fill[1], '#4ea8ff', 'the blue the number is drawn in');
    assert.ok(HIT_TINT.snipe > 0, 'its glow has a colour of its own');
    assert.notEqual(dmgStyleKey('phys'), 'snipe', 'a normal physical hit is NOT blue');
    assert.notEqual(dmgStyleKey('arts'), 'snipe');
  });

  test('the renderer takes the event\'s style slot; without one it falls back to the damage type', () => {
    const numbers = read('public/js/render/fx/numbers.js');
    assert.match(numbers, /damage\(view, amount, type, srcView, mark, o, styleKey\)/);
    assert.match(numbers, /const style = styleKey && DMG_STYLE\[styleKey\] \? styleKey : dmgStyleKey\(type\);/);
    const app = read('public/js/render/app.js');
    assert.match(app, /fx\.damage\(v, amt, e\[3\], src, e\[4\], official \? NO_SPARK : undefined, e\[5\]\)/,
      'the event\'s 6th slot reaches the number');
    // the sim puts it there: a display-only numStyle on the DamageInfo → the 6th slot of the dmg tuple
    const damage = read('server/sim/damage.js');
    assert.match(damage, /numStyle: d\.numStyle \?\? null/);
    assert.match(damage, /if \(dmg\.numStyle\) \{ if \(ev\.length < 5\) ev\.push\(null\); ev\.push\(dmg\.numStyle\); \}/);
  });
});
