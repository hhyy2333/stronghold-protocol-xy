// Room screen — mobile layout guards (no browser). Regression test for the user report of 2026-10-11:
//
//   「左下角那块 UI 太挤了，手机上拿浏览器打开压根显示不全 … 一堆东西全怼在左下角那个犄角旮旯，你压我我压你，
//     屏幕小一点直接跑出画面外」
//
// What actually happened, measured in a real headless Edge at 640×360 / 844×390 (see the numbers in the comments):
//   * `.room-bar` was `height: 1.5rem` with `align-items: center`. On a phone in landscape the root scale is clamped
//     at 40 px, so 1.5rem is 60 px — less than ONE row of the difficulty picker.
//   * Its left column was a non-wrapping flex row holding five controls (难度 label + picker, AI switch, 额外内容
//     label + button, 公开 label + switch). Nothing could wrap, so every child was SHRUNK instead: the 公开 switch
//     came out 42 px wide and painted 「当前为私密…」 ONE CHARACTER PER LINE, 148 px tall inside a 60 px bar.
//   * The cluster therefore ended at y=449 on a 360 px-tall screen: everything below y=360 was off-screen and
//     untappable (elementFromPoint returned null for all twelve controls).
//   * `.room-chat` lost the cascade to `.chatpanel { bottom: 1.0rem }` (css/screens/game.css is linked after
//     room.css at equal specificity), so the chat panel sat 40 px from the bottom of the SCREEN — on top of the bar.
//
// The fix: the bar grows (`min-height`, wrapping left cluster, `flex: none` children grouped label+control), the
// chat panel anchors to the bar's real height via `--room-bar-h`, and the 公开 note moved out of the one-line pill.
// These assertions keep the CSS from regressing; the geometry itself is verified by the browser probe.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const roomCss = readFileSync(path.join(ROOT, 'public/css/screens/room.css'), 'utf8');
const browserCss = readFileSync(path.join(ROOT, 'public/css/screens/room-browser.css'), 'utf8');
const gameCss = readFileSync(path.join(ROOT, 'public/css/screens/game.css'), 'utf8');
const roomJs = readFileSync(path.join(ROOT, 'public/js/screens/room.js'), 'utf8');

/** The declaration block of the FIRST rule whose selector is exactly `sel`, with comments stripped. */
function block(css, sel) {
  const at = css.indexOf(`\n${sel} {`);
  const i = at >= 0 ? at : css.indexOf(`${sel} {`);
  assert.ok(i >= 0, `rule ${sel} exists`);
  const open = css.indexOf('{', i);
  const close = css.indexOf('}', open);
  return css.slice(open + 1, close).replace(/\/\*[\s\S]*?\*\//g, '');
}

describe('room screen mobile layout (user report 2026-10-11)', () => {
  test('the bottom bar grows instead of clipping: min-height, never a fixed height', () => {
    const bar = block(roomCss, '.room-bar');
    assert.match(bar, /min-height:\s*1\.5rem/, 'the bar keeps the 1.5rem design height as a MINIMUM');
    // `height: 1.5rem` (and any `max-height`) would re-introduce the clip; `min-height` is the only height allowed.
    assert.ok(!/(^|[^-\w])height:\s*1\.5rem/.test(bar), 'the bar must not have a fixed height');
    assert.ok(!/max-height/.test(bar), 'the bar must not cap its own height');
    // the old grid forced the crowded left cluster into half the bar and wrapped it even on a desktop
    assert.ok(!/grid-template-columns/.test(bar), 'the bar is a flex row, not the 1fr/auto/1fr grid');
  });

  test('the left cluster wraps and none of its children may be squeezed', () => {
    const left = block(roomCss, '.room-bar__left');
    assert.match(left, /flex-wrap:\s*wrap/, 'the crowded left cluster wraps');
    assert.match(left, /flex:\s*1 1 auto/, 'the left cluster is the flexible column');
    assert.match(roomCss, /\.room-bar__left\s*>\s*\*\s*\{[^}]*flex:\s*none/s, 'no direct child of the cluster may shrink');
    // a label travels with its control, so a wrap never separates them
    const group = block(roomCss, '.room-bar__group');
    assert.match(group, /display:\s*flex/, 'label + control are grouped');
    assert.match(roomCss, /\.room-bar__group\s*>\s*\.room-bar__label\s*\{[^}]*flex:\s*none/s, 'the label inside a group is fixed');
    // the centre and the actions keep their natural size (they used to collide once the grid went `auto`)
    assert.match(block(roomCss, '.room-bar__center'), /flex:\s*none/);
    assert.match(block(roomCss, '.room-bar__right'), /flex:\s*none/);
  });

  test('the 公开/私密 switch is a one-line pill — the note never stacks a character per line', () => {
    const toggle = block(browserCss, '.vis-toggle');
    assert.match(toggle, /display:\s*inline-flex/, 'the switch is a single-line pill');
    assert.match(toggle, /flex:\s*none/, 'the switch never shrinks');
    assert.match(toggle, /max-width:\s*100%/);
    // the note is a nowrap ellipsis line, and the room bar hides it (the button's `title` carries it there)
    assert.match(block(browserCss, '.vis-toggle__note'), /white-space:\s*nowrap/);
    assert.match(browserCss, /\.room-bar\s+\.vis-toggle__note\s*\{\s*display:\s*none/);
    assert.match(block(browserCss, '.vis-toggle__state'), /white-space:\s*nowrap/);
    assert.match(block(browserCss, '.vis-toggle__btn'), /white-space:\s*nowrap/);
    // it used to be a flex COLUMN of 11 px width at 1920×1080 — the source of the 306 px-tall note
    assert.ok(!/\.vis-toggle__text\s*\{[^}]*flex-direction:\s*column/s.test(browserCss), 'the text is no longer a column');
  });

  test('the chat panel is anchored above the bar\'s real height, and wins the cascade over .chatpanel', () => {
    // game.css declares `.chatpanel { bottom: 1.0rem }` and is linked AFTER room.css: at equal specificity the room
    // override lost, and the panel covered the bar. The room rule must therefore out-specify it.
    const rule = roomCss.match(/\.room-screen\s+\.room-chat\s*\{([^}]*)\}/s);
    assert.ok(rule, '.room-screen .room-chat exists (higher specificity than .chatpanel)');
    assert.match(rule[1], /bottom:\s*calc\(var\(--room-bar-h/, 'it follows the bar height');
    assert.match(roomCss, /\.room-screen\s+\.room-chat\s*\{[^}]*left:\s*\.6rem/s);
    // the variable is published from the screen, and the effect must re-run when the room arrives (the screen renders
    // null until then — an empty dep array ran the effect against an unmounted ref and never again)
    assert.match(roomJs, /setProperty\('--room-bar-h'/);
    assert.match(roomJs, /ResizeObserver/);
    assert.match(roomJs, /\}, \[hasRoom\]\);/);
    assert.match(roomJs, /const hasRoom = !!room;/);
    assert.match(roomJs, /<footer class="room-bar" ref=\$\{barRef\}>/);
    // the shared default must stay (the match screen uses it): only the room override changed
    assert.match(gameCss, /\.chatpanel\s*\{[^}]*bottom:\s*1\.0rem/s, 'the shared panel default is untouched');
  });

  test('the seats reserve the floating chat panel, so it cannot cover a seat card', () => {
    // the panel is absolutely positioned above the bar and floats OVER the seat grid: on a short phone its 💬 trigger
    // covered the first seat's 「待命中」. Its measured height is published as --room-chat-h and .seats reserves it.
    assert.match(roomJs, /setProperty\('--room-chat-h'/);
    assert.match(block(roomCss, '.seats'), /padding:[^;]*var\(--room-chat-h/, '.seats reserves the panel height');
    // A short landscape phone keeps the log folded down to the trigger (the seats there are tight). Since the fold moved
    // into ui/chatBox.js (`.is-folded` + the `hidden` attribute, test/ui/chat-fold.test.js), this rule backs up the
    // FOLDED state instead of every closed panel: keying it on `:not(.is-active)` would hide the log the chevron was
    // just asked to unfold (an unfolded panel may be closed — that is the ambient log).
    assert.match(roomCss, /\.room-screen\s+\.room-chat\.is-folded\s+\.chatpanel__log\s*\{\s*display:\s*none/);
    assert.doesNotMatch(roomCss, /\.room-screen\s+\.room-chat:not\(\.is-active\)\s+\.chatpanel__log\s*\{\s*display:\s*none/,
      'the fold is the chevron\'s job now, not the panel\'s open state');
  });

  test('label and control are grouped in the markup, one group per option', () => {
    // count ELEMENTS, not the mentions in comments: `class="room-bar__group"` inside an HTML comment is not a group
    const markup = roomJs.replace(/<!--[\s\S]*?-->/g, '');
    const groups = markup.match(/class="room-bar__group"/g) || [];
    assert.equal(groups.length, 3, '难度 / 额外内容 / 公开 each get a group');
    // every group holds exactly one label, and no label is left bare in the cluster
    const left = markup.slice(markup.indexOf('<div class="room-bar__left">'), markup.indexOf('<div class="room-bar__center">'));
    const labels = left.match(/class="room-bar__label"/g) || [];
    assert.equal(labels.length, 3, 'three labelled options');
    assert.equal((left.match(/room-bar__group/g) || []).length, 3);
  });

  test('narrow / short viewports re-flow the bar into rows instead of overflowing', () => {
    // the breakpoint block exists and stacks the cluster above the actions
    assert.match(roomCss, /@media \(max-width: 900px\), \(max-height: 520px\)[\s\S]*?\.room-bar__left\s*\{[^}]*flex:\s*1 1 100%/);
    assert.match(roomCss, /@media \(max-width: 900px\), \(max-height: 520px\)[\s\S]*?\.room-bar__right\s*\{[^}]*flex:\s*none/);
    // and the shortest phones give every option its own line
    assert.match(roomCss, /@media \(max-width: 640px\), \(max-height: 420px\)[\s\S]*?\.dpick\s*\{\s*flex-wrap:\s*wrap/);
  });
});
