// test/export-third-party.test.js — tools/export-third-party.mjs (third-party/README.md, NOTICE.md §2). No network, and
// no walk of the real 270 MB asset tree: the collector and the bundle writer are exercised in-process on a small
// temporary tree. The one spawned-CLI test skips itself where the sandbox blocks a piped child process (spawn EPERM).
// Run: node --test test/export-third-party.test.js

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { THIRD_PARTY_SOURCES, collectFiles, exportBundle } from '../tools/export-third-party.mjs';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const TOOL = path.join(ROOT, 'tools', 'export-third-party.mjs');

const BYTES = { png: Buffer.from([0x89, 0x50, 0x4e, 0x47, 1, 2, 3]), text: Buffer.from('x\n') };

/** A throwaway tree shaped like the real one, so `collectFiles(root)` sees the repo's relative paths unchanged. */
function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sp-3p-'));
  const put = (rel, buf = BYTES.text) => {
    const abs = path.join(root, rel);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, buf);
  };
  // exported
  put('public/assets/char/a.png', BYTES.png);
  put('public/assets/local/hextech/audio/reroll.wav', BYTES.png);
  put('public/fonts/x.woff2', BYTES.png);
  put('data/chess.json', Buffer.from('{"a":1}'));
  put('data/local-assets.json', Buffer.from('{"version":1}'));
  put('data/i18n/en.json', Buffer.from('{"k":"v"}'));
  put('docs/research/01-core-rules.md');
  put('docs/img/combat.jpg', BYTES.png);
  put('public/dev/recordings/one.json', Buffer.from('{}'));
  put('test/fixtures/official-waves.json', Buffer.from('[]'));
  // deliberately NOT exported
  put('data/support.json', Buffer.from('{}'));
  put('test/fixtures/other.json', Buffer.from('[]'));
  put('docs/research/README.txt');
  put('server/index.js');
  put('public/js/main.js');
  return root;
}

const rels = (root) => collectFiles(root).map((f) => f.rel).sort();

const EXPECTED = [
  'data/chess.json',
  'data/i18n/en.json',
  'data/local-assets.json',
  'docs/img/combat.jpg',
  'docs/research/01-core-rules.md',
  'docs/research/README.txt',
  'public/assets/char/a.png',
  'public/assets/local/hextech/audio/reroll.wav',
  'public/dev/recordings/one.json',
  'public/fonts/x.woff2',
  'test/fixtures/official-waves.json',
].sort();

const withFixture = async (fn) => {
  const root = fixture();
  try { return await fn(root); } finally { fs.rmSync(root, { recursive: true, force: true }); }
};

test('collector: official data, art, fonts, research, screenshots, recordings and official-* fixtures only', async () => {
  await withFixture((root) => {
    assert.deepEqual(rels(root), EXPECTED);
    // hand-written server config, non-official fixtures and our own code stay on the GPL side
    for (const gone of ['data/support.json', 'test/fixtures/other.json', 'server/index.js', 'public/js/main.js']) {
      assert.ok(!rels(root).includes(gone), `${gone} must not be exported`);
    }
  });
});

test('collector: every entry carries its declared source and a non-empty `why`, and the order is deterministic', async () => {
  await withFixture((root) => {
    const a = collectFiles(root);
    assert.deepEqual(a.map((f) => f.rel), collectFiles(root).map((f) => f.rel));
    for (const f of a) {
      assert.ok(f.why && f.why.length > 0, `why missing for ${f.rel}`);
      assert.ok(THIRD_PARTY_SOURCES.some((s) => s.path === f.src), `unknown src ${f.src}`);
      assert.ok(fs.statSync(f.abs).isFile(), f.abs);
    }
  });
});

test('collector: a missing source is skipped, not fatal', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sp-3p-'));
  try {
    assert.deepEqual(collectFiles(root), []);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('exportBundle: dry-run reports what it would write, hashes nothing and writes nothing', async () => {
  await withFixture(async (root) => {
    const out = path.join(root, 'bundle');
    const report = await exportBundle({ root, out, dryRun: true });
    assert.equal(report.dryRun, true);
    assert.equal(report.written, false);
    assert.equal(report.files, EXPECTED.length);
    assert.ok(report.bytes > 0);
    assert.deepEqual(Object.keys(report.bySource).sort(),
      ['data', 'data/i18n', 'data/local-assets.json', 'docs/img', 'docs/research', 'public/assets', 'public/dev/recordings', 'public/fonts', 'test/fixtures'].sort());
    assert.equal(report.sample[0].sha256, undefined, 'dry-run must not read file contents');
    assert.ok(!fs.existsSync(out), 'dry-run must not create the output directory');
  });
});

test('exportBundle: a real run writes the bundle, NOTICE.md and a MANIFEST.json that matches the files on disk', async () => {
  await withFixture(async (root) => {
    const out = path.join(root, 'bundle');
    const report = await exportBundle({ root, out });
    assert.equal(report.written, true);
    assert.ok(fs.statSync(path.join(out, 'NOTICE.md')).size > 0, 'the bundle explains itself');
    const manifest = JSON.parse(fs.readFileSync(path.join(out, 'MANIFEST.json'), 'utf8'));
    assert.deepEqual(manifest.files.map((f) => f.path).sort(), EXPECTED, 'the manifest lists exactly what was selected');
    for (const e of manifest.files) {
      assert.match(e.sha256, /^[0-9a-f]{64}$/, e.path);
      assert.equal(fs.statSync(path.join(out, e.path)).size, e.bytes, `${e.path}: manifest bytes match the file`);
    }
    assert.ok(manifest.files.every((e) => e.why && e.why.length > 0), 'each exported file still says why it is here');
  });
});

test('CLI: an unknown option exits 2 (skipped where the sandbox forbids a piped child process)', (t) => {
  const r = spawnSync(process.execPath, [TOOL, '--nope'], { cwd: ROOT, encoding: 'utf8' });
  if (r.error && r.error.code === 'EPERM') return t.skip('sandbox blocks spawning a child process with piped stdio');
  assert.equal(r.status, 2, r.stderr);
  assert.match(String(r.stderr) + String(r.stdout), /unknown option --nope/);
});
