// test/ui/hextechTierArt.test.js — the 协议源石 draft card's FACE (DESIGN §29, owner's decision 2026-10-08): the
// rarity → 阶位 art mapping the client reads from data/hextech.json (`rarities[].tier`) and data/local-assets.json
// (`hextech/tier/<tier>`, installed by tools/hextech-tier-import.mjs from the owner's own 1阶 / 2阶 / 3阶 images).
//
// Two things have to hold or the draft silently draws the wrong card:
//   * the tier is DATA (silver → 1, gold → 2, prismatic → 3) and the card takes it from the roster, not from a
//     hard-coded rarity list in the client;
//   * the card takes the art's OWN aspect ratio from the manifest, because the supplied images are landscape and a
//     fixed portrait card would crop the numeral away.
// The fallback chain is pinned too: no local manifest → the drawn plate with the name's first character, never a broken
// image (the third-party rune / frame fallback was removed 2026-10-12).

import { test, describe, before } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const DATA = path.join(ROOT, 'data');
const readJson = (f) => JSON.parse(readFileSync(path.join(DATA, f), 'utf8'));

const HEXTECH = readJson('hextech.json');
/** data/local-assets.json is optional (a machine without the local art has none). */
const LOCAL = (() => { try { return readJson('local-assets.json'); } catch { return null; } })();

// serve the real data files in the browser store's shape
globalThis.fetch = async (url) => {
  const u = String(url);
  const name = u.split('/').pop();
  const files = { 'hextech.json': HEXTECH, 'local-assets.json': LOCAL };
  if (files[name]) return { ok: true, status: 200, json: async () => files[name] };
  return { ok: false, status: 404, json: async () => ({}) };
};

const wantTier = { silver: 1, gold: 2, prismatic: 3 };

describe('协议源石 card face: rarity → 阶位 art', () => {
  let hexOverlay;
  before(async () => {
    const { data } = await import('../../public/js/data.js');
    await Promise.all(['hextech', 'local'].map(async (n) => { await data.invalidate(n); await data.load(n); }));
    hexOverlay = await import('../../public/js/ui/hexOverlay.js');
  });

  test('the roster carries a tier per rarity and the display name IS that tier', () => {
    const byId = Object.fromEntries(HEXTECH.rarities.map((r) => [r.id, r]));
    for (const [id, tier] of Object.entries(wantTier)) {
      assert.ok(byId[id], `rarity ${id} exists`);
      assert.equal(byId[id].tier, tier, `${id} → ${tier}阶`);
      assert.equal(byId[id].name, `${tier}阶`, `${id} shows its tier number`);
    }
    // an adjacent-rarity fallback needs the escalation order intact
    assert.deepEqual(HEXTECH.rarities.map((r) => r.id), ['silver', 'gold', 'prismatic']);
  });

  test('rarityTier / rarityTierArt resolve 1阶/2阶/3阶 from the roster', () => {
    for (const [id, tier] of Object.entries(wantTier)) {
      assert.equal(hexOverlay.rarityTier(id), tier, `${id} tier`);
      const url = hexOverlay.rarityTierArt(id);
      if (!LOCAL?.groups?.['hextech/tier']) { assert.equal(url, null, 'no local manifest → no tier art'); continue; }
      assert.equal(url, LOCAL.groups['hextech/tier'][String(tier)].path, `${id} → the ${tier}阶 image`);
    }
    assert.equal(hexOverlay.rarityTier('nope'), null);
    assert.equal(hexOverlay.rarityTierArt('nope'), null);
  });

  test('the three 阶位 images are installed and match the manifest dimensions', () => {
    const g = LOCAL?.groups?.['hextech/tier'];
    if (!g) return;                                   // optional local art (a clean checkout)
    for (const tier of [1, 2, 3]) {
      const e = g[String(tier)];
      assert.ok(e, `hextech/tier/${tier} is listed`);
      const file = path.join(ROOT, 'public', e.path.replace(/^\/assets\//, 'assets/'));
      assert.ok(existsSync(file), `${e.path} is on disk`);
      const buf = readFileSync(file);
      assert.equal(buf.readUInt32BE(0), 0x89504e47, 'a PNG');
      assert.equal(buf.readUInt32BE(16), e.w, 'manifest width matches the file');
      assert.equal(buf.readUInt32BE(20), e.h, 'manifest height matches the file');
    }
  });

  test('the card takes the tier art AND its own aspect ratio (cover would crop a portrait card)', () => {
    if (!LOCAL?.groups?.['hextech/tier']) return;
    const hex = { id: 'hex_armor', name: '反击装甲', desc: '防御 +15%。', rarity: 'gold', icon: 'adamantRune' };
    const card = hexOverlay.HexCard({ hex });
    const cls = String(card.props?.class ?? '');
    assert.ok(cls.includes('has-tier'), cls);
    assert.ok(!cls.includes('has-frame'), 'the tier face replaces the framed fallback');
    const style = String(card.props?.style ?? '');
    const e = LOCAL.groups['hextech/tier']['2'];
    assert.ok(style.includes(`--hx-tier:url("${e.path}")`), style);
    assert.ok(style.includes(`--hx-tier-ar:${e.w / e.h}`), `aspect ratio from the manifest: ${style}`);
    // the numeral must never be cropped: the ratio the card adopts IS the image's
    assert.ok(Math.abs((e.w / e.h) - 1.26) < 0.05, `the supplied art is landscape (${e.w}x${e.h})`);
  });

  test('the rune plate is dropped on a full tier card AND on a compact enemy chip (user report 2026-10-08)', () => {
    if (!LOCAL?.groups?.['hextech/tier']) return;
    const hex = { id: 'ehex_fury', name: '狂攻', desc: '攻击 +15%。', rarity: 'gold', icon: 'berserkRune' };
    const full = hexOverlay.HexCard({ hex });
    assert.ok(String(full.props?.class ?? '').includes('has-tier'));
    const compact = hexOverlay.HexCard({ hex, compact: true });
    const ccls = String(compact.props?.class ?? '');
    assert.ok(ccls.includes('hxcard--compact'), ccls);
    // The enemy chip shows the TIER art now, not the mod's rune: keeping the rune left the third-party 海克斯 icon as the
    // last hextech-looking art in the game after the rename (user report). The chip is a square tile drawing the art
    // `cover`, the same treatment the effects column uses.
    assert.ok(ccls.includes('has-tier'), `a chip shows its tier art too: ${ccls}`);
    assert.ok(!ccls.includes('has-frame'), 'not the framed fallback');
    const style = String(compact.props?.style ?? '');
    assert.ok(style.includes('--hx-tier:url('), `the chip carries the tier background: ${style}`);
    assert.ok(!JSON.stringify(compact).includes('hxcard__plate'), 'no rune plate on a tier chip');
  });

  test('without the local manifest the card falls back to the frame (never a broken image)', async () => {
    // a store with no data/local-assets.json at all (404): the tier art must resolve to null, not to a 404 URL
    globalThis.fetch = async (url) => (String(url).endsWith('hextech.json')
      ? { ok: true, status: 200, json: async () => HEXTECH }
      : { ok: false, status: 404, json: async () => ({}) });
    const { data: store, localAsset } = await import('../../public/js/data.js');
    await store.invalidate('local');
    await store.load('local');
    assert.equal(localAsset('hextech/tier', '1'), null, 'no manifest → no URL, so nothing is ever requested');
    assert.equal(hexOverlay.rarityTierArt('silver'), null);
    assert.equal(hexOverlay.rarityTier('silver'), 1, 'the tier still resolves from the roster alone');
    // rarityName still answers (the roster record drives it), and the frame is the fallback when local art exists nowhere
    assert.equal(hexOverlay.rarityName('silver'), '1阶');
  });
});
