// The team panel's 20-seat mode scrolls its rows; the emote bubble hangs to the RIGHT of a row. If the column
// itself scrolled, the bubble would be clipped and would add a horizontal scrollbar (owner report 2026-10-17
// "表情也在槽里还要往右了"). So the rows are their own scroller and many-mode bubbles are painted by a sibling
// layer positioned by JS from each row's rect.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const read = (p) => readFileSync(join(ROOT, p), 'utf8');

test('team panel: the rows scroll, the panel itself does not clip the side bubbles', () => {
  const js = read('public/js/ui/teamPanel.js');
  assert.match(js, /class="team__rows" ref=\$\{listRef\}/, 'the rows need their own scroll container');
  assert.match(js, /class="team__bubbles"/, 'many-mode bubbles need an unclipped layer');
  assert.match(js, /data-team-pid=\$\{p\.playerId\}/, 'bubbles are placed from the row rects');
  assert.match(js, /const placeBubbles = \(\) =>/, 'the layer positions itself from the scrolled rows');

  const css = read('public/css/screens/game.css');
  const aside = css.match(/\.team \{[\s\S]*?\n\}/)?.[0] || '';
  assert.ok(!/overflow/.test(aside), 'the .team column itself must not create a scroll container');
  const many = css.match(/\.team--many \{[\s\S]*?\n\}/)?.[0] || '';
  assert.ok(!/overflow/.test(many), 'the many modifier must not scroll/clip the column');
  assert.match(css, /\.team--many \.team__rows \{[\s\S]*?overflow-y: auto/s, 'the rows scroll');
  assert.match(css, /\.team--many \.team__rows \{[\s\S]*?pointer-events: auto/s, 'wheel/touch needs the pointer');
  assert.match(css, /\.team__bubbles \{ position: absolute; inset: 0;/, 'the bubble layer covers the column');
  assert.match(css, /\.team__bubble-slot \{ position: absolute; transform: translateY\(-50%\)/, 'a slot is centred on its row');
  assert.match(css, /\.team__bubbles \.team__bubble-slot \.team__bubble \{ position: static/, 'inside the layer the bubble is in normal flow');
});
