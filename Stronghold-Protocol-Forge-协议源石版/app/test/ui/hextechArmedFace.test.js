// test/ui/hextechArmedFace.test.js — 协议源石 card face, ARMED state (DESIGN §29; found 2026-10-09 with a real browser).
//
// The bug: a card's 阶位 art (`.hxcard.has-tier`, the owner's own 1/2/3 images) was DESTROYED the moment a player tapped
// it. `.hxcard.is-armed` sets `background:` as a SHORTHAND, which resets `background-position` / `background-size` /
// `background-repeat` to their initial values (`0% 0%` / `auto` / `repeat`); the more specific
// `.hxcard.has-tier.is-armed` rule then re-stated only `background-color` and `background-image`, so the numeral was
// drawn at its native pixel size in the top-left corner and tiled — the card appeared to break exactly on the feature's
// signature gesture (tap to arm). `.hxcard.has-tier.is-armed` is the rule that has to survive it.
//
// Verified in headless Edge against the real stylesheet: armed reported `background-size:auto; position:0% 0%;
// repeat:repeat` before the fix and `cover / 50% 50% / no-repeat` after. This test pins the ROOT CAUSE (the longhands
// must be re-stated in the `.has-tier` armed rule, and must not be absent in any `has-tier` state rule), so a later
// refactor that reintroduces the shorthand reset fails here instead of shipping.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const CSS = readFileSync(path.join(ROOT, 'public/css/screens/game-panels.css'), 'utf8');

/** Body of the first rule whose selector list contains `sel` (flat, comment-stripped). */
function ruleBody(css, sel) {
  const clean = css.replace(/\/\*[\s\S]*?\*\//g, '');
  const re = new RegExp(`([^{}]*\\${sel}[^{}]*)\\{([^}]*)\\}`, 'g');
  let m;
  while ((m = re.exec(clean))) {
    const sels = m[1].split(',').map((s) => s.trim());
    if (sels.includes(sel)) return m[2];
  }
  return null;
}

describe('协议源石 card face survives the armed (tap-to-select) state', () => {
  test('the armed rule re-states the background longhands the shorthand would reset', () => {
    const body = ruleBody(CSS, '.hxcard.has-tier.is-armed');
    assert.ok(body, '.hxcard.has-tier.is-armed exists');
    assert.match(body, /background-position:\s*center/, 'armed keeps the numeral centred');
    assert.match(body, /background-size:\s*cover/, 'armed keeps `cover` (the art must not drop to native px)');
    assert.match(body, /background-repeat:\s*no-repeat/, 'armed must not tile the art');
  });

  test('every `has-tier` state rule that sets background-image also pins position/size/repeat', () => {
    const clean = CSS.replace(/\/\*[\s\S]*?\*\//g, '');
    // all rules whose selector mentions a has-tier state (is-armed / is-picked / is-busy / hover) and sets a background-image
    const re = /([^{}]*(?:has-tier)[^{}]*)\{([^}]*)\}/g;
    let m;
    let checked = 0;
    while ((m = re.exec(clean))) {
      const sels = m[1].split(',').map((s) => s.trim());
      const isState = sels.some((s) => /\.has-tier[^,]*\.(is-armed|is-picked|is-busy|is-tappable)/.test(s));
      if (!isState) continue;
      const body = m[2];
      if (!/background-image|--hx-tier/.test(body)) continue;
      checked += 1;
      assert.match(body, /background-size:\s*cover/, `${sels.join(', ')} pins background-size`);
      assert.match(body, /background-position:\s*center/, `${sels.join(', ')} pins background-position`);
      assert.match(body, /background-repeat:\s*no-repeat/, `${sels.join(', ')} pins background-repeat`);
    }
    assert.ok(checked >= 1, 'at least the armed tier rule is checked');
  });

  test('the base tier rule and the compact chip agree (cover / center / no-repeat)', () => {
    for (const sel of ['.hxcard.has-tier', '.hxcard.hxcard--compact.has-tier']) {
      const body = ruleBody(CSS, sel);
      assert.ok(body, `${sel} exists`);
      assert.match(body, /background-size:\s*cover/, `${sel} cover`);
      assert.match(body, /background-position:\s*center/, `${sel} center`);
      assert.match(body, /background-repeat:\s*no-repeat/, `${sel} no-repeat`);
    }
  });
});
