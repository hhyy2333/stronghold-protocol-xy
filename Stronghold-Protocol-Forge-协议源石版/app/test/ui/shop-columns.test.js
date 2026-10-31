// test/ui/shop-columns.test.js — which shop slot belongs to which column (upstream 0.3.3 §38.1).
//
// The bar used to split its slots by the cards' own `kind`, so every `null` slot (an empty slot opened by a 调度中心
// upgrade, a sold one) counted as an operator: the equipment slot a level newly opens moved to the operator column and
// the equipment column — empty — was drawn as one SOLD OUT / 已购买 frame. The server publishes the REAL slot counts
// (m.private shop.layout) and the bar splits by them; a frame without a layout falls back to the kinds.
//
// shopColumns is pure and exported for this test (the rest of the bar needs a DOM); the render branches around it are
// checked in the source, where they live.
//
// Run: node test/ui/shop-columns.test.js

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { shopColumns } from '../../public/js/ui/shopBar.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const shopBar = readFileSync(path.join(ROOT, 'public/js/ui/shopBar.js'), 'utf8');

const chess = (id) => ({ kind: 'chess', id, price: 2 });
const item = (id, sold = false) => ({ kind: 'item', id, price: 3, sold });
const idx = (rows) => rows.map(({ i }) => i);

describe('shopColumns: the columns follow the server\'s slot counts', () => {
  test('the empty equipment slot a level just opened stays in the equipment column', () => {
    // 1–4 级 have three operator slots and no equipment slot; the 4 → 5 upgrade opens one, EMPTY (_openLevelSlots)
    const slots = [chess('a'), chess('b'), chess('c'), null];
    const cols = shopColumns(slots, { chess: 3, item: 1 });
    assert.deepEqual(idx(cols.chessSlots), [0, 1, 2], 'the operator column ends at layout.chess');
    assert.deepEqual(idx(cols.itemSlots), [3], 'the empty slot is the equipment column\'s');
    assert.equal(cols.itemSlots[0].s, null, 'empty — a bare frame, never SOLD OUT');
    assert.equal(cols.itemOpen, true);
  });

  test('an empty OPERATOR slot stays in the operator column', () => {
    const slots = [chess('a'), null, chess('c'), item('i')];
    const cols = shopColumns(slots, { chess: 3, item: 1 });
    assert.deepEqual(idx(cols.chessSlots), [0, 1, 2]);
    assert.deepEqual(idx(cols.itemSlots), [3]);
  });

  test('a bought equipment card still reads as the equipment column (the bar draws it 已购买)', () => {
    const cols = shopColumns([chess('a'), chess('b'), chess('c'), item('i', true)], { chess: 3, item: 1 });
    assert.deepEqual(idx(cols.itemSlots), [3]);
    assert.equal(cols.itemSlots[0].s.sold, true);
  });

  test('a level with no equipment slot at all (layout.item 0) reports the column closed', () => {
    const slots = [chess('a'), chess('b'), chess('c')];
    const cols = shopColumns(slots, { chess: 3, item: 0 });
    assert.deepEqual(idx(cols.chessSlots), [0, 1, 2]);
    assert.deepEqual(cols.itemSlots, []);
    assert.equal(cols.itemOpen, false, 'no equipment column: draw none, not a SOLD OUT frame');
  });

  test('two equipment slots (a mode that opens two) both stay on the equipment side', () => {
    const cols = shopColumns([chess('a'), item('i1'), item('i2')], { chess: 1, item: 2 });
    assert.deepEqual(idx(cols.chessSlots), [0]);
    assert.deepEqual(idx(cols.itemSlots), [1, 2]);
    assert.equal(cols.itemOpen, true);
  });
});

describe('shopColumns: a frame without a layout falls back to the cards\' kinds [ASSUMED: the pre-0.3.3 rule]', () => {
  const slots = [chess('a'), chess('b'), null, item('i')];

  test('no layout at all (an older server, the dev mock)', () => {
    for (const layout of [undefined, null]) {
      const cols = shopColumns(slots, layout);
      assert.deepEqual(idx(cols.chessSlots), [0, 1, 2], 'every null counts as an operator slot');
      assert.deepEqual(idx(cols.itemSlots), [3]);
      assert.equal(cols.itemOpen, null, 'unknown: keep the pre-0.3.3 frame');
    }
  });

  test('a malformed layout is ignored (integers only, never negative)', () => {
    for (const layout of [{ chess: 3 }, { chess: 3, item: '1' }, { chess: -1, item: 1 }, { chess: 1.5, item: 1 }]) {
      const cols = shopColumns(slots, layout);
      assert.deepEqual(idx(cols.chessSlots), [0, 1, 2], JSON.stringify(layout));
      assert.deepEqual(idx(cols.itemSlots), [3]);
      assert.equal(cols.itemOpen, null);
    }
  });

  test('no slots at all is no column', () => {
    const cols = shopColumns(null, { chess: 0, item: 0 });
    assert.deepEqual([cols.chessSlots, cols.itemSlots, cols.itemOpen], [[], [], false]);
  });
});

describe('the bar uses the columns (source)', () => {
  test('the columns come from shopColumns(slots, shop.layout)', () => {
    assert.match(shopBar, /const \{ chessSlots, itemSlots \} = shopColumns\(slots, shop\.layout\);/);
    assert.doesNotMatch(shopBar, /const chessSlots = slots\.map/, 'no second, kind-only split');
  });

  test('an empty equipment slot is a bare frame, not SOLD OUT / 已购买', () => {
    const lines = shopBar.split('\n');
    const empty = lines.findIndex((l) => l.includes('EmptyCard') && l.includes('item=${true}'));
    const sold = lines.findIndex((l) => l.includes('SoldCard') && l.includes('item=${true}'));
    assert.ok(empty > 0, 'the equipment column draws an EmptyCard for a null slot');
    assert.ok(sold > empty, 'the sold branch comes after it (a null slot has no `sold`)');
  });

  test('the equipment column is never dropped, and never says 已购买 where the level has no equipment slot', () => {
    assert.match(shopBar, /\$\{showReward \? null : html`<div class="shopbar__item">/, 'the column keeps its place');
    // the frame of a shop with no equipment slot at all: an EMPTY frame — upstream 0.3.3 drew SOLD OUT / 已购买 there
    // while its own changelog says 未开放的装备位不画售罄卡 (D report 1.a); this port keeps the column but never the lie
    assert.match(shopBar, /: html`<\$\{EmptyCard\} item=\$\{true\} \/>`\}/);
    assert.doesNotMatch(shopBar, /html`<\$\{SoldCard\} item=\$\{true\} \/>`/, 'no SOLD OUT frame in the equipment column');
  });
});
