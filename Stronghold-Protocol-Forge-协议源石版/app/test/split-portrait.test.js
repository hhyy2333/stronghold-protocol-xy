// test/split-portrait.test.js — tools/split-portrait.mjs: turning ONE flat full-body illustration into the two art kinds
// the game consumes directly (the 半身立绘 at 1:2 and the square 头像), by locating the head and the neck from the image's
// own alpha silhouette.
//
// The tool's Python half is exercised end to end on a SYNTHETIC figure (a drawn blob with a head, a narrow neck and very
// wide arms), so the test needs no art of its own: the silhouette scan must find the HEAD and reject the ARMS, which are
// the widest thing in an arms-out figure — the trap that makes a naive "widest row" pick the shoulders.
// Run: node --test test/split-portrait.test.js

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, existsSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

import { PORTRAIT_SIZE, AVATAR_SIZE } from '../tools/split-portrait.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const TOOL = join(ROOT, 'tools', 'split-portrait.mjs');

/**
 * Whether a child process can be run AND its output captured. A sandbox that denies spawn/pipe is an ENVIRONMENT limit,
 * not a rule failure (the same guard test/match/playtest6-limits.test.js uses), so the tool's end-to-end tests skip there.
 * The probe captures output, because that is the part a confined sandbox denies (piped stdio).
 */
const CAN_SPAWN = (() => {
  try { return spawnSync(process.execPath, ['-e', 'console.log(1)'], { encoding: 'utf8' }).status === 0; } catch { return false; }
})();
const HAS_PY = (() => {
  if (!CAN_SPAWN) return false;
  try { return spawnSync('python', ['-c', 'import PIL; print(1)'], { encoding: 'utf8' }).status === 0; } catch { return false; }
})();
const E2E = { skip: !HAS_PY && 'needs python+Pillow and a spawnable child process (environment limit)' };

test('the official sizes this tool targets', () => {
  assert.deepEqual(PORTRAIT_SIZE, { w: 180, h: 360 });
  assert.deepEqual(AVATAR_SIZE, { w: 180, h: 180 });
});

test('the shipped manifest uses those sizes for a self-made operator', () => {
  const manifest = JSON.parse(readFileSync(join(ROOT, 'data', 'assets.json'), 'utf8'));
  const rec = manifest.chars.char_9002_yana;
  assert.ok(rec, '娅娜 has a chars entry');
  for (const u of [rec.avatar, rec.avatarE2, rec.portrait, rec.portraitE2]) {
    assert.ok(typeof u === 'string' && u.startsWith('/assets/'), `a URL (${u})`);
  }
});

/** Draw a synthetic arms-out chibi figure into `dir`; the arms are 3x the head, so a naive widest-row pick fails. */
function drawFigure(dir) {
  // the drawing lives in a .py fixture (test/fixtures/split-portrait-figure.py) — inlining Python here would need its
  // `#` comments inside JS strings, which is a syntax error waiting to happen
  return spawnSync('python', [join(ROOT, 'test', 'fixtures', 'split-portrait-figure.py'), dir], { encoding: 'utf8' }).status === 0;
}

test('the silhouette scan finds the HEAD, not the arms, and writes the four crops at the official sizes', E2E, () => {
  const dir = mkdtempSync(join(tmpdir(), 'sp-yana-'));
  try {
    assert.ok(drawFigure(dir), 'the synthetic figure was drawn');
    const out = join(dir, 'out');
    const r = spawnSync(process.execPath, [TOOL, join(dir, 'figure.png'), out], { encoding: 'utf8' });
    assert.equal(r.status, 0, `the tool ran: ${r.stderr}`);
    const log = r.stdout;
    // the head is the ~200 px blob, NOT the 600 px arms
    assert.match(log, /widest \d+ px/, 'it reports a head width');
    const widest = Number(log.match(/widest (\d+) px/)[1]);
    assert.ok(widest < 400, `the head width is the head, not the arms (${widest} px; the arms are 600)`);
    // the neck is the 40 px pinch
    const neck = Number(log.match(/neck: y \d+ \(width (\d+)\)/)[1]);
    assert.ok(neck <= 60, `the neck pinch was found (${neck} px)`);

    for (const f of ['avatar.png', 'avatar_2.png', 'portrait_1.png', 'portrait_2.png']) {
      assert.ok(existsSync(join(out, f)), `${f} was written`);
    }
    const sizes = spawnSync('python', ['-c', [
      'from PIL import Image; import sys',
      'for f in ["avatar.png","avatar_2.png","portrait_1.png","portrait_2.png"]:',
      '    print(f, Image.open(sys.argv[1] + "/" + f).size)',
    ].join('\n'), out], { encoding: 'utf8' });
    assert.match(sizes.stdout, /avatar\.png \(180, 180\)/, 'the avatar is 180x180');
    assert.match(sizes.stdout, /avatar_2\.png \(180, 180\)/, 'the E2 avatar is 180x180');
    assert.match(sizes.stdout, /portrait_1\.png \(180, 360\)/, 'the portrait is 180x360');
    assert.match(sizes.stdout, /portrait_2\.png \(180, 360\)/, 'the E2 portrait is 180x360');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('a fully transparent image is refused, not silently cropped', E2E, () => {
  const dir = mkdtempSync(join(tmpdir(), 'sp-yana-'));
  try {
    // a blank PNG, drawn with the bundled Pillow
    const blank = spawnSync('python', ['-c', 'import sys; from PIL import Image; Image.new("RGBA",(100,100),(0,0,0,0)).save(sys.argv[1])', join(dir, 'blank.png')], { encoding: 'utf8' });
    assert.equal(blank.status, 0, `the blank PNG was drawn: ${blank.stderr}`);
    const r = spawnSync(process.execPath, [TOOL, join(dir, 'blank.png'), join(dir, 'out')], { encoding: 'utf8' });
    assert.notEqual(r.status, 0, 'a blank image is an error');
    assert.match(`${r.stdout}${r.stderr}`, /fully transparent/, 'and it says why');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('a missing source file is an error with a clear message', () => {
  const dir = mkdtempSync(join(tmpdir(), 'sp-yana-'));
  try {
    // this path does not need python: the check happens before the crop step
    const r = spawnSync(process.execPath, [TOOL, join(dir, 'nope.png'), join(dir, 'out')], { encoding: 'utf8' });
    if (r.status === null) return;   // spawn denied: nothing to assert
    assert.notEqual(r.status, 0);
    assert.match(`${r.stdout}${r.stderr}`, /no such file/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
