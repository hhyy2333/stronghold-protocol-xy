// test/ui/effectsColumn.test.js — the right-hand effects column's 协议源石 tile (DESIGN §29, 2026-10-08): a card a
// player owns shows its TIER's 阶位 art (the same image the draft card is faced with), not the mod's rune.
//
// What has to hold:
//   * a hex effect entry carrying a tier renders the tier image and gets the `cover` tile classes;
//   * without the tier art the tile keeps the rune and the plain `.effect` look (no `cover`, nothing distorted);
//   * with no local manifest at all it stays the plain tile (never `cover` styling for a bolt glyph);
//   * the other effect kinds are untouched.
import { test, describe, before } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const read = (p) => readFileSync(path.join(ROOT, p), 'utf8');
const readJson = (f) => JSON.parse(readFileSync(path.join(ROOT, 'data', f), 'utf8'));

const HEXTECH = readJson('hextech.json');
const LOCAL = (() => { try { return readJson('local-assets.json'); } catch { return null; } })();
const ASSETS = readJson('assets.json');
const hasTierArt = !!LOCAL?.groups?.['hextech/tier'];

describe('effects column: a 协议源石 shows its 阶位 art', () => {
  let EffectsList, effectsList;
  before(async () => {
    globalThis.fetch = async (url) => {
      const name = String(url).split('/').pop();
      const files = { 'hextech.json': HEXTECH, 'local-assets.json': LOCAL, 'assets.json': ASSETS };
      if (files[name]) return { ok: true, status: 200, json: async () => files[name] };
      return { ok: false, status: 404, json: async () => ({}) };
    };
    const { data } = await import('../../public/js/data.js');
    await Promise.all(['hextech', 'local', 'assets'].map(async (n) => { await data.invalidate(n); await data.load(n); }));
    effectsList = await import('../../public/js/ui/effectsList.js');
    EffectsList = effectsList.EffectsList;
  });

  /** Every `class=` string in a rendered vnode tree. */
  function classes(node, out = []) {
    if (Array.isArray(node)) { for (const x of node) classes(x, out); return out; }
    if (!node || typeof node !== 'object') return out;
    if (typeof node.props?.class === 'string') out.push(node.props.class);
    if (node.props?.children !== undefined) classes(node.props.children, out);
    return out;
  }

  const hexEntry = (tier) => ({ id: 'hex:hex_armor', name: '反击装甲', desc: '防御力 +15%。', iconKind: 'hex', iconId: 'adamantRune', ...(tier ? { tier } : {}) });

  test('a hex effect with a tier gets the tier tile (cover) and the tier image', () => {
    if (!hasTierArt) return;                              // the owner's own optional art
    const tier = HEXTECH.rarities.find((r) => r.id === 'gold').tier;
    const tree = EffectsList({ effects: [hexEntry(tier)] });
    const cls = classes(tree);
    assert.ok(cls.some((c) => c.includes('effect--hex')), cls.join(' | '));
    assert.ok(cls.some((c) => c.includes('effect--hextier')), 'the cover tile class');
    assert.ok(cls.some((c) => c.includes(`effect--tier${tier}`)), `the tier tint`);
    assert.ok(JSON.stringify(tree).includes(LOCAL.groups['hextech/tier'][String(tier)].path), 'the tier image URL');
  });

  test('a hex effect WITHOUT a tier keeps the plain tile (the rune was retired on 2026-10-12)', () => {
    const tree = EffectsList({ effects: [hexEntry(null)] });
    const cls = classes(tree).join(' | ');
    assert.ok(cls.includes('effect--hex'), cls);
    assert.ok(!cls.includes('effect--hextier'), `no cover styling: ${cls}`);
    // a hex tile's only image source is its tier's 阶位 art (ui/assetUrls.js `effectIconUrl` → `hexTierArtUrl`); without a
    // tier — or without the owner's art — there is none and the tile draws its bolt glyph. The third-party rune this test
    // used to pin was retired by the owner on 2026-10-12 (docs/history/0.3.0.md §29.3), so no rune may reappear here.
    assert.ok(!JSON.stringify(tree).includes('hextech/tier'), 'no tier art without a tier');
    assert.ok(!JSON.stringify(tree).includes('Rune'), 'the retired rune fallback is gone');
  });

  test('other effect kinds are untouched', () => {
    const tree = EffectsList({ effects: [
      { id: 'a', name: '机变', desc: 'd', iconKind: 'choice', iconId: 'icon_player_buff' },
      { id: 'b', name: '策略', desc: 'd', iconKind: 'band', iconId: 'band_bldsk' },
    ] });
    const cls = classes(tree).join(' | ');
    assert.ok(cls.includes('effect--choice') && cls.includes('effect--band'), cls);
    assert.ok(!cls.includes('hextier'), 'no tier styling on the others');
  });

  test('no effects ⇒ nothing rendered', () => {
    assert.equal(EffectsList({ effects: [] }), null);
    assert.equal(EffectsList({ effects: null }), null);
  });

  test('the tile CSS is `cover` with no padding, and only for the tier class', () => {
    const css = read('public/css/screens/game.css');
    assert.match(css, /\.effect--hextier\s*\{[^}]*padding:\s*0/);
    assert.match(css, /\.effect--hextier img\s*\{[^}]*object-fit:\s*cover/);
    // the tier tints match the draft card's chip colours
    for (const [cls, colour] of [['tier1', '#c9d4dd'], ['tier2', 'var(--gold)'], ['tier3', '#b07ce8']]) {
      assert.match(css, new RegExp(`\\.effect--${cls}\\s*\\{[^}]*${colour.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`), cls);
    }
  });
});

// ---------------------------------------------------------------------------------------------------
// the combat DP counter: the effects column must never run into it (owner's reports of 2026-10-13,
// 「战斗时费用显示位置遮挡己方buff」 + 「计数器左移一些」). The counter sits on the official right-edge middle, and the
// column grows down the same right edge from 2.4rem, so from the fifth tile on the counter's opaque plate hid the
// player's own 协议源石 / 策略 tiles. The fix is a HORIZONTAL split: the counter is inset far enough left that its whole
// box lies left of a tile, whatever the window height. The offsets below are parsed out of the CSS and checked against
// each other, so sliding either element back into the other fails here without a browser.
// ---------------------------------------------------------------------------------------------------

describe('the combat DP counter never covers the effects column', () => {
  const grab = (css, re, what) => {
    const m = re.exec(css);
    assert.ok(m, `layout: ${what} not found — update this test with the rule`);
    return Number(m[1]);
  };

  test('the counter is inset left of the column (a horizontal split, independent of the window height)', () => {
    const css = read('public/css/screens/game.css');
    // both are anchored to the screen's right edge: the column is a .5rem tile at right .3rem, the counter's own box grows
    // further LEFT from its right edge — so its width never matters, only that its right edge is past the column's LEFT one
    const colRight = grab(css, /^\.gm__effects \{[^}]*\bright: ([\d.]+)rem/m, '.gm__effects right');
    const tile = grab(css, /^\.effect \{\s*position: relative; width: ([\d.]+)rem/m, '.effect width');
    const counterRight = grab(css, /^\.dpbox \{\s*position: absolute; right: ([\d.]+)rem/m, '.dpbox right');
    const colLeft = colRight + tile;
    const gap = counterRight - colLeft;
    assert.ok(counterRight > colLeft, `the counter (right ${counterRight}rem) still reaches into the tiles (their left edge is at right ${colLeft}rem)`);
    assert.ok(gap >= 0.25, `only ${gap.toFixed(2)}rem of daylight between the counter and the tiles`);
    assert.ok(counterRight <= 1.6, `the counter stays on the right edge (right ${counterRight}rem), not out in the field`);
  });

  test('and it keeps the official right-edge middle (research 06 §4.5 / §D3), vertically centred', () => {
    const css = read('public/css/screens/game.css');
    const top = grab(css, /^\.dpbox \{[^}]*\btop: ([\d.]+)%/m, '.dpbox top');
    assert.equal(top, 50, 'the counter is centred on the right edge');
    assert.match(css, /^\.dpbox \{[^}]*transform: translateY\(-50%\)/m, 'and translated by half its own height');
  });

  test('the counter is combat-only, so the prep shop bar (the same right edge, at the bottom) never coexists', () => {
    // prep owns the bottom-right (the shop bar); the counter is rendered by CombatHud only
    assert.match(read('public/js/ui/combatHud.js'), /<\\?\$\{DpCounter\}/);
    assert.match(read('public/js/screens/game.js'), /combat \|\| mode === 'settle' \? html`<\$\{CombatHud\}/);
    assert.match(read('public/js/screens/game.js'), /const showShop = [^;]*PHASE\.PREP[^;]*;/);
  });
});
