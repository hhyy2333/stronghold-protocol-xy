// 自动补齐模组 (owner's decision 2026-10-18: 自动补齐，不自动准备). The room screen starts the fetch itself the moment
// the alignment verdict says this client is short — the button nobody found (「补齐mod文件按钮不明显」) is gone, but the
// run must stay visible, cancellable and retried by hand, and it must never ready the player up.
//
// What is tested here is the decision (pure, no DOM) and the size the progress line / the old button used to hide:
// planAlignment has to say how many BYTES are missing, not only how many files.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { shouldAutoFill, autoFillDigest, AUTO_FILL_DELAY_MS } from '../../public/js/mods/autoFill.js';
import { planAlignment } from '../../public/js/mods/align.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const DIGEST = 'a'.repeat(64);
const short = (over = {}) => ({ needed: true, ok: false, digest: DIGEST, packs: [], unknown: [], missingFiles: 3, missingBytes: 4096, ...over });
/** A store that holds nothing — enough for the alignment plan (it only asks has/read). */
const emptyStore = () => ({ has: async () => false, read: async () => null, write: async () => {}, list: async () => [] });

test('shouldAutoFill: only when the verdict really says this device is short', () => {
  assert.equal(shouldAutoFill({ plan: short() }), true, 'missing files → start by itself');
  assert.equal(shouldAutoFill({ plan: short({ ok: true }) }), false, 'already held');
  assert.equal(shouldAutoFill({ plan: short({ needed: false }) }), false, 'the room declared nothing');
  assert.equal(shouldAutoFill({ plan: short({ missingFiles: 0 }) }), false, 'nothing missing (only a hash mismatch left)');
  assert.equal(shouldAutoFill({ plan: null }), false, 'no verdict yet');
  assert.equal(shouldAutoFill({}), false, 'no arguments');
});

test('shouldAutoFill: never for a pack this server does not carry (nothing to download), never twice, never after 取消', () => {
  assert.equal(shouldAutoFill({ plan: short({ unknown: ['ghost-pack'] }) }), false);
  assert.equal(shouldAutoFill({ plan: short(), busy: true }), false, 'one run at a time');
  assert.equal(shouldAutoFill({ plan: short(), tried: DIGEST }), false, 'one automatic attempt per digest');
  assert.equal(shouldAutoFill({ plan: short(), dismissed: DIGEST }), false, 'the player cancelled this digest');
  assert.equal(shouldAutoFill({ plan: short({ digest: 'b'.repeat(64) }), tried: DIGEST }), true, 'a NEW set is a new decision');
  assert.equal(shouldAutoFill({ plan: short(), tried: null, dismissed: null }), true);
});

test('autoFillDigest: the key an attempt is remembered by', () => {
  assert.equal(autoFillDigest(short()), DIGEST);
  assert.equal(autoFillDigest(short({ digest: null })), null);
  assert.equal(autoFillDigest(null), null);
  assert.ok(AUTO_FILL_DELAY_MS >= 0 && AUTO_FILL_DELAY_MS < 5000, 'a short delay, not a scheduled download');
});

test('planAlignment publishes the missing BYTES (the progress line and the old button only ever showed a count)', async () => {
  const catalog = { packs: [{ id: 'p1', hash: 'x', files: [
    { path: 'pack.json', sha256: 'a'.repeat(64), canonical: 'c1', bytes: 100 },
    { path: 'assets/a.png', sha256: 'b'.repeat(64), canonical: 'c2', bytes: 2000 },
  ] }] };
  const mods = { digest: DIGEST, packs: [{ id: 'p1', hash: 'x' }] };
  const plan = await planAlignment({ catalog, mods, store: emptyStore() });
  assert.equal(plan.missingFiles, 2);
  assert.equal(plan.missingBytes, 2100);
  assert.equal(plan.ok, false);
  assert.equal(plan.needed, true);
});

test('the room panel wires the automatic run: start, cancel and manual retry — and never 准备就绪', () => {
  const room = readFileSync(path.join(ROOT, 'public/js/screens/room.js'), 'utf8');
  assert.ok(room.includes('shouldAutoFill({ plan: next'), 'the alignment verdict starts the run');
  assert.ok(room.includes('void fillRef.current?.({ auto: true })'), 'through the panel\'s own fill()');
  assert.ok(room.includes('autoRef.current.dismissed = digest'), '取消 remembers the digest');
  assert.ok(room.includes('signal: controller ? controller.signal : null'), 'the run can be aborted');
  assert.ok(room.includes("t('取消自动补齐')") && room.includes("t('已暂停自动补齐')"), 'the state is visible');
  assert.ok(!/fill[\s\S]{0,400}toggleReady/.test(room), '补齐 never presses 准备就绪 (owner: 不自动准备)');
});
