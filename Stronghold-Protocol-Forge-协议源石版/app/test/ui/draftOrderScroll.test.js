// The 决策顺序 column is a per-player list: a 20-seat room has 20 rows, so it must scroll inside
// the screen instead of running off the bottom (owner report 2026-10-17 "这个要滚动条"). The rows
// live in their own list so the heading, the 本局信息 button and the tip stay put.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const read = (p) => readFileSync(join(ROOT, p), 'utf8');

test('the decision-order rows scroll instead of overflowing the screen', () => {
  const js = read('public/js/screens/bandDraft.js');
  assert.match(js, /class="draft-order__list"/, 'the rows need their own scroll container');
  assert.match(js, /<\/div>\s*<\$\{Button\} variant="secondary" icon="search"/, 'the info button stays outside the list');

  const css = read('public/css/screens/draft.css');
  assert.match(css, /\.draft__main\s*\{[^}]*grid-template-rows:\s*minmax\(0,\s*1fr\)/s, 'the grid row must be bounded');
  assert.match(css, /\.draft-order__list\s*\{[^}]*overflow-y:\s*auto/s, 'the list must scroll');
  assert.match(css, /\.draft-order__list\s*\{[^}]*min-height:\s*0/s, 'a flex child needs min-height 0 to scroll');
  assert.match(css, /\.draft-order__list > \.dorder\s*\{[^}]*flex:\s*0 0 auto/s, 'rows keep their size');
  assert.match(css, /\.draft-order__list::-webkit-scrollbar/, 'a visible scrollbar on WebKit');
});
