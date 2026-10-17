// test/update-notes-server.test.js — 更新公告 as SERVER state: the shape rules (shared/updateNotes.js), the store
// (server/notesStore.js), and the endpoints (GET /api/notes, POST /api/admin/notes[/clear]).
//
// WHAT THIS SUITE DEFENDS. Moving the announcement out of a shipped module and into server state introduced exactly two
// ways to lose the feature's one hard requirement ("只弹一次") or the safety of the whole server:
//   1. THE DIGEST MUST STAY THE IDENTITY. A browser stores the digest of what it read. If the server and the client
//      hashed differently — or if normalization were not stable, so the same edit produced two digests — the panel
//      would either re-pop forever or never pop again. Asserted directly: the server's digest equals the client's,
//      computed from the same shared recipe, and normalization is idempotent.
//   2. THE TEXT IS UNTRUSTED INPUT. It arrives from a textarea, is stored on disk, read back on the next boot and handed
//      to every player. So: a bad save is REFUSED (the working revision survives), a corrupt file is IGNORED (the
//      built-in revision applies), and nothing that reaches a client can hold a non-string.
//
// THE ANNOUNCEMENT IS FREE TEXT, ONE LANGUAGE (owner's decision 2026-10-13: 「要有固定格式写我不喜欢，应该自由写，然后
// 不需要多语言」). So the shape rules below are deliberately thin — that IS the feature — and what is left to defend is
// cleaning (never a non-string, never an unbounded body) and the layout rule the writer relies on (blank line =
// paragraph, `- ` = bullet).
//
// It runs the REAL store against a temp directory and the REAL HTTP routes against a real server, so the wiring is
// exercised, not just the units.
// Run: node test/update-notes-server.test.js

import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  normalizeNotes, sanitizeNotesText, notesDigest, notesErrorText, notesBlocks, NOTES_LIMITS,
} from '../shared/updateNotes.js';
import { createNotesStore, defaultNotesDir, NOTES_FILE } from '../server/notesStore.js';
import { createRequestHandler } from '../server/http/routes.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');

/** A minimal valid revision, and a helper to tweak it. Free text: one string. */
const base = () => ({ text: '本次更新\n\n- 修了一处\n- 加了一处' });

const silent = { warn() {}, info() {}, error() {}, debug() {} };

// =================================================================================================
// shared/updateNotes.js — the shape rules
// =================================================================================================

describe('shared/updateNotes: what counts as a usable revision', () => {
  test('a revision normalizes to exactly one key: the text', () => {
    const r = normalizeNotes(base());
    assert.equal(r.ok, true);
    assert.deepEqual(Object.keys(r.notes), ['text'], 'one field, one key order — that is the whole shape');
    assert.equal(r.notes.text, base().text);
  });

  test('a BARE STRING is accepted too, so a hand-written curl or file needs no envelope', () => {
    const r = normalizeNotes('随便写一段');
    assert.equal(r.ok, true);
    assert.deepEqual(r.notes, { text: '随便写一段' });
    // …and the two doors land on the same digest.
    assert.equal(notesDigest(r.notes), notesDigest(normalizeNotes({ text: '随便写一段' }).notes));
  });

  test('the digest is stable and moves for every real content change', () => {
    const d = notesDigest(normalizeNotes(base()).notes);
    assert.match(d, /^[0-9a-f]{64}$/);

    // Cosmetic-only differences must NOT move it: trailing spaces, CRLF, an extra blank line, a lost trailing newline.
    const cosmetic = [
      ['trailing spaces', { text: '本次更新\n\n- 修了一处   \n- 加了一处' }],
      ['CRLF', { text: '本次更新\r\n\r\n- 修了一处\r\n- 加了一处' }],
      ['too many blank lines', { text: '本次更新\n\n\n\n- 修了一处\n- 加了一处' }],
      ['a trailing newline', { text: `${base().text}\n\n` }],
    ];
    for (const [what, notes] of cosmetic) {
      assert.equal(notesDigest(normalizeNotes(notes).notes), d, `${what} is not content and must not move the digest`);
    }

    // A real edit does.
    const moves = [
      ['a word', { text: '本次更新\n\n- 修了一处（改过）\n- 加了一处' }],
      ['one more bullet', { text: `${base().text}\n- 又一条` }],
      ['a reordered paragraph', { text: '- 加了一处\n- 修了一处\n\n本次更新' }],
      ['a bullet marker turned into plain text', { text: base().text.replace('- 加了一处', '· 加了一处') }],
      ['a full stop', { text: `${base().text}。` }],
    ];
    for (const [what, notes] of moves) {
      assert.notEqual(notesDigest(normalizeNotes(notes).notes), d, `${what} must move the digest`);
    }
  });

  test('normalization is IDEMPOTENT — normalize(normalize(x)) hashes the same', () => {
    // This is what keeps the server's digest and the client's digest equal: the client re-normalizes what it fetched.
    const once = normalizeNotes(base()).notes;
    const twice = normalizeNotes(once).notes;
    assert.deepEqual(twice, once);
    assert.equal(notesDigest(twice), notesDigest(once));
  });

  test('awkward input is cleaned, not refused: control characters, runs of spaces, an over-long body', () => {
    const messy = { text: `  标题\u0000  with\u0007control  \n\n\n\n${'a'.repeat(NOTES_LIMITS.text + 10)}` };
    const r = normalizeNotes(messy);
    assert.equal(r.ok, true);
    assert.ok(r.notes.text.startsWith('标题 with control'), 'control characters are stripped and spaces collapsed');
    assert.equal(r.notes.text.length, NOTES_LIMITS.text, 'the text is capped');
    assert.ok(r.warnings.includes('TEXT_TRUNCATED'), 'and the truncation is reported');
  });

  test('whitespace-only cleaning does NOT report truncation (only the cap does)', () => {
    // A false TEXT_TRUNCATED would tell an operator their words were cut when they were merely re-spaced.
    const r = normalizeNotes({ text: 'a   \n\n\n\n   b' });
    assert.equal(r.ok, true);
    assert.deepEqual(r.warnings, [], 'nothing was cut');
    assert.equal(r.notes.text, 'a\n\nb');
  });

  test('BAD input is refused by name, so the panel can say why', () => {
    const bad = [
      ['BAD_NOTES', null],
      ['BAD_NOTES', 42],
      ['BAD_NOTES', {}],
      ['BAD_NOTES', { text: 42 }],
      ['BAD_NOTES', { text: { zh: 'old shape' } }],
      ['BAD_NOTES', ['an', 'array']],
      ['EMPTY', ''],
      ['EMPTY', '   \n\n  '],
      ['EMPTY', { text: '' }],
      ['EMPTY', { text: '\u0000\u0007' }],
    ];
    for (const [code, input] of bad) {
      const r = normalizeNotes(input);
      assert.equal(r.ok, false, `expected ${code} for ${JSON.stringify(input)}`);
      assert.equal(r.error, code);
      assert.ok(notesErrorText(code).length > 0, `${code} has a human message`);
    }
  });

  test('an over-long body is CUT to the cap rather than refused (a long paste still ships something readable)', () => {
    const r = normalizeNotes({ text: 'x'.repeat(NOTES_LIMITS.text * 3) });
    assert.equal(r.ok, true);
    assert.equal(r.notes.text.length, NOTES_LIMITS.text);
  });

  test('sanitizeNotesText keeps paragraph breaks and line breaks, and strips what a browser cannot render', () => {
    assert.equal(sanitizeNotesText('a\n  b  \n\nc'), 'a\nb\n\nc', 'inner line breaks and the paragraph break survive');
    assert.equal(sanitizeNotesText('a\n\n\n\n\nb'), 'a\n\nb', 'a long run of blank lines collapses to one');
    assert.equal(sanitizeNotesText('  \n a \n  '), 'a', 'leading and trailing blank space goes');
    assert.equal(sanitizeNotesText('   '), '');
    assert.equal(sanitizeNotesText(42), '');
    assert.equal(sanitizeNotesText('a\u0000b\u001fc'), 'a b c');
  });
});

describe('shared/updateNotes: the free-text layout rule (the only format there is)', () => {
  test('a blank line separates paragraphs; a leading - / * / • makes a bullet', () => {
    assert.deepEqual(notesBlocks('一段\n\n另一段'), [
      { kind: 'p', text: '一段' }, { kind: 'p', text: '另一段' },
    ]);
    assert.deepEqual(notesBlocks('- 甲\n- 乙'), [{ kind: 'ul', items: ['甲', '乙'] }]);
    assert.deepEqual(notesBlocks('- 甲\n\n- 乙'), [
      { kind: 'ul', items: ['甲'] }, { kind: 'ul', items: ['乙'] },
    ], 'a blank line ends the list');
    for (const mark of ['*', '•']) assert.deepEqual(notesBlocks(`${mark} 甲`), [{ kind: 'ul', items: ['甲'] }]);
  });

  test('line breaks INSIDE a paragraph are preserved — the operator\'s layout is part of what they wrote', () => {
    assert.deepEqual(notesBlocks('第一行\n第二行'), [{ kind: 'p', text: '第一行\n第二行' }]);
  });

  test('a paragraph and a list can interleave, and empty input is no blocks', () => {
    assert.deepEqual(notesBlocks('标题\n- 一条\n\n收尾'), [
      { kind: 'p', text: '标题' }, { kind: 'ul', items: ['一条'] }, { kind: 'p', text: '收尾' },
    ]);
    assert.deepEqual(notesBlocks(''), []);
    assert.deepEqual(notesBlocks('  \n \n'), []);
    assert.deepEqual(notesBlocks(undefined), []);
  });

  test('a dash that is NOT followed by a space is ordinary text (no surprise bullets)', () => {
    assert.deepEqual(notesBlocks('5-3 领先'), [{ kind: 'p', text: '5-3 领先' }]);
  });
});

// =================================================================================================
// server/notesStore.js — the disk
// =================================================================================================

describe('server/notesStore: persistence and the trust boundary', () => {
  /** A temp dir per test, so nothing touches the real ~/sp-notes. */
  const mk = () => fs.mkdtempSync(path.join(os.tmpdir(), 'sp-notes-'));
  const dirs = [];
  const store = (dir) => createNotesStore({ dir, log: silent, now: () => 1_700_000_000_000 });

  test('a fresh directory reads as "nothing saved"', () => {
    const dir = mk(); dirs.push(dir);
    assert.equal(store(dir).read(), null);
  });

  test('save -> read back round-trips, and the file lands where it says', () => {
    const dir = mk(); dirs.push(dir);
    const s = store(dir);
    const r = s.save(base(), { by: '1.2.3.4' });
    assert.equal(r.ok, true);
    assert.equal(s.file, path.join(dir, NOTES_FILE));
    const back = s.read();
    assert.equal(back.notes.text, base().text);
    assert.equal(back.by, '1.2.3.4');
    assert.equal(back.at, 1_700_000_000_000);
    assert.deepEqual(back.notes, normalizeNotes(base()).notes, 'the stored document is the normalized one');
  });

  test('a REFUSED save writes nothing and leaves the working revision alone', () => {
    const dir = mk(); dirs.push(dir);
    const s = store(dir);
    s.save(base());
    const before = fs.readFileSync(s.file, 'utf8');
    const r = s.save({ text: '   ' });
    assert.equal(r.ok, false);
    assert.equal(r.error, 'EMPTY');
    assert.equal(fs.readFileSync(s.file, 'utf8'), before, 'the file is byte-for-byte unchanged');
    assert.equal(s.read().notes.text, base().text);
  });

  test('a save reports the digest of what it stored', () => {
    const dir = mk(); dirs.push(dir);
    const r = store(dir).save(base());
    assert.equal(r.digest, notesDigest(r.notes));
    assert.match(r.digest, /^[0-9a-f]{64}$/);
  });

  test('clear removes the live copy (the built-in revision applies again)', () => {
    const dir = mk(); dirs.push(dir);
    const s = store(dir);
    s.save(base());
    assert.ok(s.read());
    s.clear();
    assert.equal(s.read(), null);
  });

  test('a corrupt file reads as absent, never as a crash', () => {
    for (const junk of ['not json', '[]', '{"current":42}', '{"current":{"text":42}}', '{"current":{}}', '{"current":null}']) {
      const dir = mk(); dirs.push(dir);
      fs.writeFileSync(path.join(dir, NOTES_FILE), junk, 'utf8');
      assert.equal(store(dir).read(), null, `${junk} reads as absent`);
    }
  });

  test('a HAND-EDITED file whose text is not a string is rejected on read', () => {
    // This is the trust boundary: the file is outside the process, and its content goes to every player's screen.
    for (const evil of [{ object: true }, 42, ['lines'], null, true]) {
      const dir = mk(); dirs.push(dir);
      fs.writeFileSync(path.join(dir, NOTES_FILE), JSON.stringify({ current: { text: evil } }), 'utf8');
      assert.equal(store(dir).read(), null, `${JSON.stringify(evil)} is not a usable announcement`);
    }
  });

  test('a hand-edited file holding a BARE STRING still works (the shape is forgiving on purpose)', () => {
    const dir = mk(); dirs.push(dir);
    fs.writeFileSync(path.join(dir, NOTES_FILE), JSON.stringify({ current: '手写的一段公告' }), 'utf8');
    assert.equal(store(dir).read().notes.text, '手写的一段公告');
  });

  test('an unwritable directory degrades to "live but not persisted" instead of throwing', () => {
    // A file where the directory should be: mkdir fails, so the save reports unwritable and nothing throws.
    const dir = mk(); dirs.push(dir);
    const blocked = path.join(dir, 'blocked');
    fs.writeFileSync(blocked, 'x', 'utf8');
    const s = createNotesStore({ dir: blocked, log: silent });
    const r = s.save(base());
    assert.equal(r.ok, true, 'the save is still live for this process');
    assert.equal(r.unwritable, true, 'and it says the disk did not take it');
    assert.equal(s.read(), null, 'nothing was written');
  });

  test('the write is atomic: no .tmp file is left behind, and a half-write cannot be read', () => {
    const dir = mk(); dirs.push(dir);
    const s = store(dir);
    s.save(base());
    assert.deepEqual(fs.readdirSync(dir), [NOTES_FILE], 'only the document remains (the .tmp was renamed)');
  });

  test('the default directory is NOT inside the install tree (a deploy would delete it)', () => {
    const d = defaultNotesDir();
    assert.ok(path.isAbsolute(d), 'absolute');
    assert.ok(!d.startsWith(ROOT), `default notes dir must live outside the checkout, got ${d}`);
    const prev = process.env.SP_NOTES_DIR;
    try {
      process.env.SP_NOTES_DIR = path.join(os.tmpdir(), 'custom-notes');
      assert.equal(defaultNotesDir(), path.join(os.tmpdir(), 'custom-notes'), 'SP_NOTES_DIR overrides it');
    } finally {
      if (prev === undefined) delete process.env.SP_NOTES_DIR; else process.env.SP_NOTES_DIR = prev;
    }
  });

  after(() => { for (const d of dirs) fs.rmSync(d, { recursive: true, force: true }); });
});

// =================================================================================================
// the HTTP surface — a real server, the real routes
// =================================================================================================

describe('the 更新公告 endpoints', () => {
  let server, port, dir, notesStore;
  const TOKEN = 'test-admin-token-value';
  const H = { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' };

  /** An AdminService with the notes store, which is all these routes need. */
  async function makeAdmin() {
    const { AdminService } = await import('../server/admin.js');
    return new AdminService({ secret: TOKEN, notesStore, log: silent });
  }

  before(async () => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sp-notes-http-'));
    notesStore = createNotesStore({ dir, log: silent });
    const admin = await makeAdmin();
    const handler = createRequestHandler({
      serveStatic: (req, res) => { res.statusCode = 404; res.end('{}'); },
      health: { startedAt: Date.now(), network: { connectionCount: 0 }, registry: { size: 0 }, lobby: { stats: () => ({}), modsInBuild: () => [] } },
      log: silent,
      admin,
      notes: notesStore,
    });
    const http = await import('node:http');
    server = http.createServer(handler);
    await new Promise((r) => server.listen(0, '127.0.0.1', r));
    port = server.address().port;
  });

  after(async () => {
    await new Promise((r) => server.close(r));
    fs.rmSync(dir, { recursive: true, force: true });
  });

  const req = async (method, p, { body, headers = {} } = {}) => {
    const res = await fetch(`http://127.0.0.1:${port}${p}`, {
      method, headers: { ...headers }, ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    const text = await res.text();
    let parsed = null;
    try { parsed = JSON.parse(text); } catch { /* not json */ }
    return { status: res.status, body: parsed, text, allow: res.headers.get('allow') };
  };

  test('GET /api/notes is public and answers the live revision', async () => {
    await req('POST', '/api/admin/notes', { body: { text: base().text }, headers: H });
    const r = await req('GET', '/api/notes');       // deliberately NO token
    assert.equal(r.status, 200);
    assert.equal(r.body.ok, true);
    assert.equal(r.body.notes.text, base().text);
    assert.equal(typeof r.body.at, 'number');
  });

  test('with nothing saved it answers notes: null (the client uses its built-in copy)', async () => {
    notesStore.clear();
    const r = await req('GET', '/api/notes');
    assert.equal(r.status, 200);
    assert.equal(r.body.notes, null);
    assert.equal(r.body.at, null);
  });

  test('the body may be { text }, { notes: { text } } or a bare string — the operator\'s shape is not the wire\'s', async () => {
    for (const body of [{ text: '甲的公告' }, { notes: { text: '甲的公告' } }, '甲的公告']) {
      const r = await req('POST', '/api/admin/notes', { body, headers: H });
      assert.equal(r.status, 200, `${JSON.stringify(body)} is accepted`);
      assert.equal(r.body.notes.text, '甲的公告');
      assert.equal((await req('GET', '/api/notes')).body.notes.text, '甲的公告');
    }
  });

  test('POST /api/admin/notes requires the token', async () => {
    assert.equal((await req('POST', '/api/admin/notes', { body: base() })).status, 401);
    assert.equal((await req('POST', '/api/admin/notes', { body: base(), headers: { Authorization: 'Bearer wrong', 'Content-Type': 'application/json' } })).status, 401);
    assert.equal((await req('POST', '/api/admin/notes/clear', {})).status, 401);
    assert.equal((await req('GET', '/api/admin/notes')).status, 401);
  });

  test('an empty announcement is a 400 with the reason, and the good one survives', async () => {
    await req('POST', '/api/admin/notes', { body: base(), headers: H });
    const r = await req('POST', '/api/admin/notes', { body: { text: '   \n  ' }, headers: H });
    assert.equal(r.status, 400);
    assert.equal(r.body.ok, false);
    assert.equal(r.body.error, 'EMPTY');
    assert.match(r.body.message, /empty/i);
    assert.equal((await req('GET', '/api/notes')).body.notes.text, base().text, 'the working revision is intact');
  });

  test('the digest the admin sees equals the one the client computes from what it fetched', async () => {
    // THE regression guard for "只弹一次": the digest is the identity, so both sides must agree exactly.
    await req('POST', '/api/admin/notes', { body: base(), headers: H });
    const admin = await req('GET', '/api/admin/notes', { headers: H });
    const client = await req('GET', '/api/notes');
    assert.equal(admin.body.digest, notesDigest(client.body.notes), 'server digest == digest of the served body');
    // …and re-normalizing the served body (what the client does) does not move it.
    assert.equal(notesDigest(normalizeNotes(client.body.notes).notes), admin.body.digest, 'normalizing is idempotent');
  });

  test('the save records where it came from', async () => {
    await req('POST', '/api/admin/notes', { body: base(), headers: H });
    const r = await req('GET', '/api/admin/notes', { headers: H });
    assert.equal(typeof r.body.by, 'string');
    assert.ok(r.body.by.length > 0, `expected a client address, got ${JSON.stringify(r.body.by)}`);
  });

  test('clear drops the live revision', async () => {
    await req('POST', '/api/admin/notes', { body: base(), headers: H });
    const r = await req('POST', '/api/admin/notes/clear', { headers: H });
    assert.equal(r.status, 200);
    assert.equal(r.body.cleared, true);
    assert.equal((await req('GET', '/api/notes')).body.notes, null);
  });

  test('only GET/HEAD/POST reach it, and a wrong verb advertises POST', async () => {
    for (const method of ['PUT', 'DELETE', 'PATCH']) {
      const r = await req(method, '/api/admin/notes', { headers: H });
      assert.equal(r.status, 405, `${method} is refused`);
      assert.equal(r.allow, 'GET, HEAD, POST');
    }
    // An unknown admin path keeps the plain read-only advertisement.
    const r = await req('PUT', '/api/admin/overview', { headers: H });
    assert.equal(r.status, 405);
    assert.equal(r.allow, 'GET, HEAD');
  });

  test('the announcement endpoints are untouched by the notes work', async () => {
    // Both live in the same method gate; a regression there would take the older write down with it.
    const put = await req('PUT', '/api/admin/announce', { headers: H });
    assert.equal(put.status, 405);
    assert.equal(put.allow, 'GET, HEAD, POST');
  });

  test('an oversized body is refused before it is parsed', async () => {
    const huge = 'x'.repeat(300 * 1024);
    const r = await req('POST', '/api/admin/notes', { body: { text: huge }, headers: H });
    assert.equal(r.status, 413);
    assert.equal(r.body.error, 'too-large');
  });

  test('the panel read reports whether the store is writable', async () => {
    const r = await req('GET', '/api/admin/notes', { headers: H });
    assert.equal(r.body.writable, true);
    // A service with no store says so instead of pretending the panel can save.
    const { AdminService } = await import('../server/admin.js');
    const noStore = new AdminService({ secret: TOKEN, notesStore: null, log: silent });
    assert.equal(noStore.getNotes().writable, false);
    assert.equal(noStore.saveNotes(base()).ok, false);
    assert.equal(noStore.saveNotes(base()).error, 'DISABLED');
  });
});

// =================================================================================================
// the client side of the same contract
// =================================================================================================

describe('the client fetches the live revision and keeps the digest as the identity', () => {
  test('the model exposes the loader and the active revision', () => {
    const src = read('public/js/ui/updateNotesModel.js');
    assert.match(src, /export const NOTES_URL = '\/api\/notes'/, 'the endpoint is a named constant');
    assert.match(src, /export function loadUpdateNotes/, 'the loader is exported');
    assert.match(src, /export function getActiveNotes/, 'and so is the active revision');
    assert.match(src, /export function installNotes/, 'installing a revision is its own step');
  });

  test('boot loads the live revision BEFORE deciding to pop', () => {
    // The order is the point: the digest the close records must belong to the notes the player actually read.
    const main = read('public/js/main.js');
    const load = main.indexOf('loadUpdateNotes()');
    const pop = main.indexOf('maybeOpenUpdateNotes()');
    assert.ok(load > 0 && pop > 0, 'both calls exist');
    assert.ok(load < pop, 'the fetch comes first');
  });

  test('a failed fetch leaves the built-in revision in place instead of breaking boot', async () => {
    const { loadUpdateNotes, resetUpdateNotesForTests, resetUpdateNotesLoadForTests, getActiveNotes } =
      await import('../public/js/ui/updateNotesModel.js');
    resetUpdateNotesForTests();
    resetUpdateNotesLoadForTests();
    const builtin = getActiveNotes();

    // Every failure shape a network can produce, plus a body that is not a usable revision.
    const cases = [
      ['network error', async () => { throw new Error('offline'); }],
      ['not ok', async () => ({ ok: false, status: 503, json: async () => ({}) })],
      ['notes: null', async () => ({ ok: true, status: 200, json: async () => ({ notes: null }) })],
      ['the old structured shape', async () => ({ ok: true, status: 200, json: async () => ({ notes: { version: '1', date: '2026-01-01', sections: [] } }) })],
      ['an empty body', async () => ({ ok: true, status: 200, json: async () => ({ notes: { text: '' } }) })],
    ];
    for (const [what, fetchFn] of cases) {
      resetUpdateNotesForTests();
      const r = await loadUpdateNotes({ fetchFn });
      assert.equal(r.source, 'builtin', `${what} falls back to the built-in revision`);
      assert.equal(getActiveNotes(), builtin, `${what} leaves the built-in revision active`);
    }
  });

  test('a valid body installs, and the digest then matches the server\'s', async () => {
    const { loadUpdateNotes, resetUpdateNotesForTests, resetUpdateNotesLoadForTests, getActiveNotes, updateNotesDigest } =
      await import('../public/js/ui/updateNotesModel.js');
    resetUpdateNotesForTests();
    resetUpdateNotesLoadForTests();
    const served = normalizeNotes({ text: '服务端的公告\n\n- 一条' }).notes;
    const r = await loadUpdateNotes({ fetchFn: async () => ({ ok: true, status: 200, json: async () => ({ notes: served }) }) });
    assert.equal(r.source, 'server');
    assert.equal(getActiveNotes().text, served.text);
    assert.equal(updateNotesDigest(), notesDigest(served), 'the client hashes what the server served');
    resetUpdateNotesForTests();
  });

  test('the panel renders the ACTIVE revision, not the built-in one, and has no language picker left', () => {
    const panel = read('public/js/ui/updateNotes.js');
    assert.match(panel, /getActiveNotes/, 'it reads the active revision from the model');
    assert.ok(!/UPDATE_NOTES\./.test(panel), 'it never reaches past the model into the built-in file');
    assert.ok(!/pickLocalized|NOTES_LANGS/.test(panel), 'the multi-language fallback is gone (one text, one language)');
    assert.ok(!/notes\.sections|notes\.version|notes\.headline/.test(panel), 'and so is the structured shape');
  });
});
