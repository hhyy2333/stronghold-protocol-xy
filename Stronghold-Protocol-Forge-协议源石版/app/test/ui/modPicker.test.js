// test/ui/modPicker.test.js — the room-mod rows shared by the lobby picker and the room's edit panel
// (public/js/ui/modPicker.js, W-A/G3 DESIGN §28.9/§28.16).
//
// What has to hold:
//   * a row is ONE selectable control (`role="checkbox"` + aria-checked), not a styled text button;
//   * the author's catalogue name is shown when it is known, with the pack id kept underneath (the id is what the
//     server and every refusal message name, so it must not disappear);
//   * the layer is translated and the combat intent is a separate attribute — the one thing a player must notice;
//   * `ModList` keeps one row per declared pack and reports the clicked id unchanged.
//
// The styles are asserted statically: this repository has no CSS build step, so a removed block is a silently unstyled
// component (which is exactly how the picker shipped before this test).
// Run: node --test test/ui/modPicker.test.js
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readFileSync as readSource } from 'node:fs';
import { ModChip, ModList, ModalActions, LAYER_TEXT, splitModName } from '../../public/js/ui/modPicker.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const read = (p) => readFileSync(path.join(ROOT, p), 'utf8');

/** The vnode walker the UI suites use: assert on the tree, never render a component that uses hooks. */
function* walk(v) {
  if (Array.isArray(v)) { for (const x of v) yield* walk(x); return; }
  if (!v || typeof v !== 'object') return;
  yield v;
  yield* walk(v.props?.children);
}
const textOf = (v) => [...walk(v)].map((n) => n.props?.children).flat()
  .filter((c) => typeof c === 'string' || typeof c === 'number').join('');
const classOf = (v) => (typeof v?.props?.class === 'string' ? v.props.class : '');

const CLEMNT = { id: 'clemnt-addition', layer: 'A', combat: true };
const YANA = { id: 'yana-addition', layer: 'A', combat: true };

describe('ModChip: one pack is one checkbox row', () => {
  test('off: role/state, translated layer, combat warning, and the id under the name', () => {
    const row = ModChip({ pack: CLEMNT, name: '克莱门莎 addition', selected: false });
    assert.equal(row.type, 'button');
    assert.equal(row.props.role, 'checkbox');
    assert.equal(row.props['aria-checked'], 'false');
    assert.ok(!classOf(row).includes('is-on'));
    const text = textOf(row);
    assert.ok(text.includes('克莱门莎 addition'), 'the catalogue name');
    assert.ok(text.includes('clemnt-addition'), 'the pack id stays visible');
    assert.ok(text.includes(LAYER_TEXT.A), 'the layer label');
    assert.ok(text.includes('会改动战斗结果'), 'the combat intent');
  });

  test('on: aria-checked and the is-on class move together (the mint box is CSS, not a second state)', () => {
    const row = ModChip({ pack: CLEMNT, name: '克莱门莎 addition', selected: true });
    assert.equal(row.props['aria-checked'], 'true');
    assert.ok(classOf(row).includes('is-on'));
  });

  test('no catalogue name yet: the pack id is the label, and it is not printed twice', () => {
    const row = ModChip({ pack: YANA, selected: false });
    const text = textOf(row);
    assert.ok(text.includes('yana-addition'));
    assert.equal(text.split('yana-addition').length - 1, 1, 'the id appears once while the name is unknown');
  });

  test('a click reports the pack id (the id the wire uses), never the display name', () => {
    const seen = [];
    const row = ModChip({ pack: CLEMNT, name: '克莱门莎 addition', selected: false, onToggle: (id) => seen.push(id) });
    row.props.onClick();
    assert.deepEqual(seen, [CLEMNT.id]);
  });

  test('combat is optional: a non-combat pack carries no amber warning', () => {
    const row = ModChip({ pack: { id: 'ui-pack', layer: 'C', combat: false }, selected: false });
    assert.ok(!textOf(row).includes('会改动战斗结果'));
  });
});

describe('splitModName: the author name keeps its description as its own line', () => {
  test('the trailing parenthetical is split off, both halves kept', () => {
    assert.deepEqual(splitModName('克莱门莎 addition（5星干员 + 驻守特质）'),
      { head: '克莱门莎 addition', detail: '5星干员 + 驻守特质' });
    assert.deepEqual(splitModName('娅娜 addition (6★ FIXED)'), { head: '娅娜 addition', detail: '6★ FIXED' }, 'ASCII parens too');
    assert.deepEqual(splitModName('plain-name'), { head: 'plain-name', detail: '' });
  });

  test('the row shows both halves (the full string never has to wrap mid-word)', () => {
    const row = ModChip({ pack: CLEMNT, name: '克莱门莎 addition（5星干员 + 驻守特质）', selected: false });
    const text = textOf(row);
    assert.ok(text.includes('克莱门莎 addition'));
    assert.ok(text.includes('5星干员 + 驻守特质'));
  });
});

describe('ModList: the rows of the declared catalogue', () => {
  test('one row per pack, in the server order, with selected state applied by id', () => {
    const tree = ModList({ packs: [CLEMNT, YANA], selected: [YANA.id] });
    const rows = [...walk(tree)].filter((n) => n.type === ModChip);
    assert.deepEqual(rows.map((r) => r.props.pack.id), [CLEMNT.id, YANA.id]);
    assert.deepEqual(rows.map((r) => r.props.selected), [false, true]);
  });
});

describe('the picker is ONE button that opens the list (业主 2026-10-20: 占空间 → 一个按钮)', () => {
  const src = readSource(path.join(ROOT, 'public/js/ui/modPicker.js'), 'utf8');

  test('the inline block is a button with aria-haspopup / aria-expanded, not the open list', () => {
    assert.ok(src.includes('class="mod-open"'), 'the trigger is the .mod-open button');
    assert.ok(src.includes('aria-haspopup="dialog"'), 'it announces that it opens a dialog');
    assert.ok(src.includes('aria-expanded='), 'and reports its state');
    assert.ok(src.includes('<${Modal} open=${open}'), 'the list lives in the Modal, opened by that state');
    const inline = src.slice(src.indexOf('return html`<div class="mod-picker"'), src.indexOf('<${Modal}'));
    assert.ok(!inline.includes('ModList'), 'no inline list above the modal');
  });

  test('the modal footer applies live and 完成 only closes (nothing to lose on Esc)', () => {
    const seen = [];
    const acts = ModalActions({ count: 1, total: 2, allOn: false, onAll: () => seen.push('all'), onClear: () => seen.push('clear'), onDone: () => seen.push('done') });
    const btns = [...walk(acts)].filter((n) => n.type === 'button');
    assert.equal(btns.length, 3, '全选 / 清空 / 完成');
    for (const b of btns) b.props.onClick();
    assert.deepEqual(seen, ['all', 'clear', 'done']);
    const one = [...walk(ModalActions({ count: 1, total: 1, allOn: true, onAll: () => {}, onClear: () => {}, onDone: () => {} }))].filter((n) => n.type === 'button');
    assert.equal(one.length, 1, 'one pack -> only the close button');
  });
});

describe('the picker has a stylesheet (a class family with no CSS is the bug this test guards)', () => {
  test('components.css styles the row, the selected state, the combat tag and the NEW trigger', () => {
    const css = read('public/css/components.css');
    for (const sel of ['.mod-open {', '.mod-open__label', '.mod-open__state', '.mod-chip {', '.mod-chip.is-on', '.mod-chip__tag--combat', '.mod-act', '.mod-act--done']) {
      assert.ok(css.includes(sel), `${sel} is styled`);
    }
  });

  test('the lobby side column no longer centres overflowing content above its own top (header under the title)', () => {
    assert.match(read('public/css/screens/lobby.css'), /\.ally-side\s*\{[^}]*justify-content:\s*safe center/s);
  });
});
