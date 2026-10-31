// test/render/content-set-cache.test.js — the caches that key on CONTENT, not on identity (upstream 0.3.3 §38.3).
//
// Swapping the content set (public/js/data.js setContent: every data file replaced under the same ids) keeps the module
// state of the page, so a cache keyed by an id hands back the picture / record of the RETIRED tables:
//   * render/textures.js itemTexture — the pedestal composite, keyed by the resolved image URL (never by an item id);
//   * render/units.js ItemView — the hand item's plate asks for its ICON URL, and the plain pedestal until it loads;
//   * render/app/host.js makeData — the composed 补位 / 自选 records, revalidated against the chess and backups OBJECTS
//     they were composed over.
// Headless: a canvas + PIXI stub (textures.js wants both at call time, never at import time).
//
// Run: node test/render/content-set-cache.test.js

import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const read = (p) => readFileSync(path.join(ROOT, p), 'utf8');
const tick = () => new Promise((r) => setImmediate(r));

/** A 2D context that accepts every call: the composites only draw, the test only reads the cache keys. */
const ctx2d = () => new Proxy({}, {
  get: (t, k) => (k in t ? t[k] : () => {}),
  set: (t, k, v) => { t[k] = v; return true; },
});
const canvasStub = () => ({ width: 0, height: 0, getContext: () => ctx2d() });

let textures, units, host;
before(async () => {
  globalThis.document = { createElement: () => canvasStub() };
  globalThis.PIXI = { Texture: { from: (canvas) => ({ canvas, stub: true }) } };
  textures = await import('../../public/js/render/textures.js');
  units = await import('../../public/js/render/units.js');
  host = await import('../../public/js/render/app/host.js');
});
after(() => {
  delete globalThis.document;
  delete globalThis.PIXI;
});

/** The slice of PIXI an ItemView touches. */
const fakeP = () => {
  class Sprite {
    constructor(texture) { this.texture = texture; this.anchor = { set: () => {} }; this.scale = { set: () => {} }; this.position = { set: () => {} }; }
    destroy() {}
  }
  class Container {
    constructor() { this.children = []; this.position = { set: () => {} }; }
    addChild(c) { this.children.push(c); }
    destroy() {}
  }
  return { Sprite, Container };
};
const layer = () => ({ children: [], addChild(c) { this.children.push(c); } });

describe('the item pedestal cache keys on the image URL', () => {
  test('two URLs of one colour are two pedestals; one URL is one pedestal', () => {
    const a = textures.itemTexture('setA/icon/item_1.png', null, 0x9aa5a0);
    assert.equal(textures.itemTexture('setA/icon/item_1.png', null, 0x9aa5a0), a, 'the same picture is composed once');
    const b = textures.itemTexture('setB/icon/item_1.png', null, 0x9aa5a0);
    assert.notEqual(b, a, 'an id kept across a content-set swap still resolves to its own new URL');
    assert.notEqual(textures.itemTexture('none', null, 0x9aa5a0), a, 'the plain pedestal is its own entry');
    assert.notEqual(textures.itemTexture('setA/icon/item_1.png', { width: 64, height: 64 }, 0x9aa5a0), a, 'the loaded image is another entry');
  });

  test('itemTexture takes the picture URL (a comment and a name, the key was always the argument)', () => {
    assert.match(read('public/js/render/textures.js'), /export function itemTexture\(url, img, color\)/);
  });
});

describe('a hand item asks for its icon URL, not for its id', () => {
  const mkCtx = () => ({
    P: fakeP(),
    layers: { shadow: layer(), units: layer() },
    shadowTex: { width: 256, height: 96 },
    assets: { image: async () => ({ width: 64, height: 64 }) },
  });

  test('a slot with no icon yet shows the plain pedestal (no id in its texture key)', () => {
    const v = new units.ItemView(mkCtx(), { defId: 'chess_item_2_07_e_a', color: 0xff8844 });
    assert.equal(v.plate.texture, textures.itemTexture('none', null, 0xff8844));
    assert.notEqual(v.plate.texture, textures.itemTexture('chess_item_2_07_e_a', null, 0xff8844),
      'the id is not a picture identity');
  });

  test('one id, two content sets: the plate follows the icon URL', async () => {
    const ctx = mkCtx();
    const one = new units.ItemView(ctx, { defId: 'chess_item_2_07_e_a', icon: 'setA/item_2_07.png', color: 0xff8844 });
    await tick(); await tick();
    const two = new units.ItemView(ctx, { defId: 'chess_item_2_07_e_a', icon: 'setB/item_2_07.png', color: 0xff8844 });
    await tick(); await tick();
    assert.equal(one.plate.texture, textures.itemTexture('setA/item_2_07.png', { width: 64, height: 64 }, 0xff8844));
    assert.equal(two.plate.texture, textures.itemTexture('setB/item_2_07.png', { width: 64, height: 64 }, 0xff8844));
    assert.notEqual(two.plate.texture, one.plate.texture, 'the retired set\'s canvas must not be reused');
  });

  test('units.js hands itemTexture a URL (and\'none\') — never a defId', () => {
    const src = read('public/js/render/units.js');
    assert.doesNotMatch(src, /itemTexture\(String\((?:this\.)?info\.defId/);
    assert.doesNotMatch(src, /itemTexture\(String\(this\.info\.defId\)/);
    assert.match(src, /new P\.Sprite\(itemTexture\('none', null, info\.color/);
    assert.match(src, /this\.plate\.texture = itemTexture\(url, img, this\.info\.color/);
  });
});

// ---- makeData: the composed 补位 / 自选 records are cached per source object -------------------------------

const FORM_SKILL = { index: 0, iconId: 'skill_x' };
const form = (level, skillLevel, equipLevel) => ({
  stats: { hp: 1000 }, traits: null, talents: [], skills: [FORM_SKILL], modules: null, tokens: [], anims: {},
  __form: `${level}/${skillLevel}/${equipLevel}`,
});
const CHESS = 'chess_char_1_01_a';
const SLOT = 'chess_char_5_diy1_a';
const SLOT_B = 'chess_char_5_diy1_b';
const DIY_CHAR = 'char_x';

/** A synthetic data set: one droppable chess (a 补位 stand-in) and one 自选 slot. */
const makeData = () => {
  const chess = {
    [CHESS]: {
      chessId: CHESS, charId: 'char_own', baseId: CHESS, chessType: 'NORMAL', tier: 3, isDiy: false, isGolden: false,
      bonds: ['b1'], status: { phase: 2, level: 60, skillLevel: 7, equipLevel: 0 },
      backup: { charId: 'char_stand', skillIndex: 0, uniEquipId: null },
    },
    [SLOT]: {
      chessId: SLOT, charId: SLOT, baseId: SLOT, goldenId: SLOT_B, chessType: 'NORMAL', tier: 5, isDiy: true, isGolden: false,
      bonds: [], price: 4, status: { phase: 2, level: 1, skillLevel: 4, equipLevel: 0 },
    },
    [SLOT_B]: {
      chessId: SLOT_B, charId: SLOT_B, baseId: SLOT, chessType: 'NORMAL', tier: 5, isDiy: true, isGolden: true,
      bonds: [], price: 8, status: { phase: 2, level: 60, skillLevel: 7, equipLevel: 1 },
    },
  };
  const unit = { charId: DIY_CHAR, name: '自选干员', assets: {} };
  const backups = {
    units: {
      char_stand: { charId: 'char_stand', name: '补位干员', assets: {}, forms: { '2/60/7/0': form(60, 7, 0) } },
      [DIY_CHAR]: { ...unit, forms: { '2/1/4/0': form(1, 4, 0), '2/60/7/1': form(60, 7, 1) } },
    },
    diy: {
      slots: { [SLOT]: { goldenId: SLOT_B, tier: 5, shopLevel: 5 } },
      ownedPool: [], prototypes: { 5: [DIY_CHAR], 6: [] },
      operators: { [DIY_CHAR]: { bonds: ['f1'] } },
      locked: { 5: { [DIY_CHAR]: { skillIndex: 0, uniEquipId: null } } },
    },
  };
  return { chess, backups };
};

/**
 * A data source shaped like the client's `data` store (public/js/data.js): `lookup(file, id)` + `get(file)`. It reads
 * `tables` at CALL time, which is how setContent swaps the content set in one page (it replaces the entry of a file, so
 * the renderer's source keeps returning the old object until the swap — then the new one).
 */
const source = (tables) => ({
  lookup(file, id) { const m = tables[file]; return m && Object.hasOwn(m, id) ? m[id] : null; },
  get(file) { return tables[file] ?? null; },
});

describe('makeData: 补位 / 自选 records are validated against their source objects', () => {
  test('the stand-in record is reused while the tables stay, recomposed when backups is swapped', () => {
    const tables = makeData();
    const d = host.makeData(source(tables));
    const rec = d.standIn(CHESS);
    assert.ok(rec && rec.name === '补位干员', 'the stand-in composes');
    assert.equal(d.standIn(CHESS), rec, 'same tables, same record (no recomposition)');
    tables.backups = { ...tables.backups };  // a content-set swap: another object, the same content here
    const rec2 = d.standIn(CHESS);
    assert.notEqual(rec2, rec, 'a swapped backups object must not hand back the retired record');
    assert.equal(rec2.name, '补位干员');
  });

  test('the 自选 record is reused while chess and backups stay, recomposed when either is swapped', () => {
    const tables = makeData();
    const d = host.makeData(source(tables));
    const pick = { charId: DIY_CHAR };
    const rec = d.diy(SLOT, pick);
    assert.ok(rec && rec.diyFor === SLOT && rec.skill, 'the 自选 record composes');
    assert.equal(d.diy(SLOT, pick), rec);
    tables.chess = { ...tables.chess };
    const rec2 = d.diy(SLOT, pick);
    assert.notEqual(rec2, rec, 'a swapped chess map invalidates the cached record');
    assert.equal(d.diy(SLOT, pick), rec2, 'and the new one is cached');
    tables.backups = { ...tables.backups };
    assert.notEqual(d.diy(SLOT, pick), rec2, 'a swapped backups object invalidates it again');
  });

  test('host.js validates both source objects (the shape of the fix)', () => {
    const src = read('public/js/render/app/host.js');
    assert.match(src, /if \(cached\?\.backups === b\) return cached\.rec;/);
    assert.match(src, /if \(cached\?\.chess === chess && cached\?\.backups === b\) return cached\.rec;/);
    assert.match(src, /standIns\.set\(c, \{ backups: b, rec \}\);/);
    assert.match(src, /diys\.set\(key, \{ chess, backups: b, rec \}\);/);
  });
});
