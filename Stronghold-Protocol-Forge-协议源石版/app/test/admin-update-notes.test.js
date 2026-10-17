// test/admin-update-notes.test.js — 管理面板里的「更新公告」编辑器与预览 (public/admin/*).
//
// The announcement is FREE TEXT, ONE LANGUAGE (owner's decision 2026-10-13: 「要有固定格式写我不喜欢，应该自由写，然后
// 不需要多语言」), so the panel is a plain textarea — no JSON to paste, no version/date/headline/sections fields and no
// per-language columns. The three things worth pinning, and why:
//
//   1. ONE SOURCE. The panel imports the very file the client imports for its fallback copy, so the preview cannot
//      drift from what a player sees. If someone ever copies the text into the panel, this fails.
//   2. ONE LAYOUT RULE. The preview and the player's panel must lay the text out identically — they call the same
//      shared function, and the panel must not grow a second copy of the rule.
//   3. ONE LOOK. The section must reuse the 全体公告 shell (same `.panel`, the same frame tone, the same
//      `announce__*` pieces) so the two read as siblings. A hand-rolled block of default divs is the failure the
//      owner named, and it is exactly what a "just make it render" edit would produce.
//
// It also checks the digest the panel shows is the same value a browser stores as "seen" — computed here from the
// client's own primitives, so a change of hash recipe on one side alone turns this red.
// Run: node test/admin-update-notes.test.js

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => readFileSync(path.join(ROOT, p), 'utf8');

const HTML = read('public/admin/index.html');
const JS = read('public/admin/admin.js');
const CSS = read('public/admin/admin.css');

const { UPDATE_NOTES } = await import('../public/js/ui/updateNotesData.js');
// 协议源石版: upstream imports these from `shared/dataPacks.js`, which this tree does not have. `shared/modIdentity.js`
// ships the same sorted-key canonical form and the same SHA-256 (verified byte-identical digests before the repoint),
// so the digest assertions below still test what they were written to test.
const { canonicalJson, sha256Hex } = await import('../shared/modIdentity.js');
const { updateNotesDigest } = await import('../public/js/ui/updateNotesModel.js');

/** The `<section>` of one panel, by its marker class (crude but enough to keep the assertions local). */
function section(marker) {
  const start = HTML.indexOf(marker);
  assert.ok(start >= 0, `index.html has a ${marker} section`);
  const open = HTML.lastIndexOf('<section', start);
  const end = HTML.indexOf('</section>', start);
  return HTML.slice(open, end);
}

describe('更新公告 editor: the panel section', () => {
  test('it exists, sits next to 全体公告, and carries the ids the renderer writes to', () => {
    const s = section('panel--notes');
    for (const id of ['notes-count', 'notes-ver', 'notes-digest', 'notes-text', 'notes-preview', 'notes-size', 'notes-status']) {
      assert.ok(s.includes(`id="${id}"`), `the section has #${id}`);
    }
    assert.match(s, /data-t="notesTitle"/, 'its heading is a translated label');
    assert.match(s, /data-t="notesHint"/, '和 全体公告 一样有一行说明');
    // Right AFTER the announcement panel, so the two operator-facing blocks read together in one column.
    const announce = HTML.indexOf('panel--announce');
    const notes = HTML.indexOf('panel--notes');
    assert.ok(announce >= 0 && notes > announce, 'it follows the 全体公告 section');
    assert.ok(HTML.indexOf('feedback-list') > notes, 'and it comes before 玩家反馈');
  });

  test('the editor is a plain TEXTAREA — there is no JSON field left to fill in', () => {
    const s = section('panel--notes');
    assert.match(s, /<textarea id="notes-text"/, 'one free-text box');
    assert.ok(!/notes-json/.test(s), 'the JSON textarea id is gone');
    assert.ok(!/notes-json/.test(JS), 'and nothing in the panel still reads it');
    assert.match(s, /data-t-placeholder="notesPlaceholder"/, 'with a placeholder that shows the two layout rules');
  });

  test('every static label in the section has a zh AND an en string (the panel is bilingual)', () => {
    const s = section('panel--notes');
    const keys = [...s.matchAll(/data-t="([^"]+)"/g)].map((m) => m[1]);
    assert.ok(keys.length >= 2, `labels found: ${keys.join(', ')}`);
    const zh = JS.slice(JS.indexOf('  zh: {'), JS.indexOf('  en: {'));
    const en = JS.slice(JS.indexOf('  en: {'));
    for (const k of keys) {
      assert.ok(new RegExp(`^\\s*${k}:`, 'm').test(zh), `zh has ${k}`);
      assert.ok(new RegExp(`^\\s*${k}:`, 'm').test(en), `en has ${k}`);
    }
    // And the dynamic strings the renderer fills in.
    for (const k of ['notesLive', 'notesBuiltinOnlyShort', 'notesDigest', 'notesNone']) {
      assert.ok(new RegExp(`^\\s*${k}:`, 'm').test(zh), `zh has ${k}`);
      assert.ok(new RegExp(`^\\s*${k}:`, 'm').test(en), `en has ${k}`);
    }
    // The strings that belonged to the JSON editor are GONE, in both languages.
    for (const gone of ['notesVersion', 'notesItems', 'notesBadJson']) {
      assert.ok(!new RegExp(`^\\s*${gone}:`, 'm').test(zh), `zh no longer carries ${gone}`);
      assert.ok(!new RegExp(`^\\s*${gone}:`, 'm').test(en), `en no longer carries ${gone}`);
    }
  });
});

describe('更新公告 editor: one source with the player panel', () => {
  test('it takes the live revision from the API, and the BUILT-IN file is only the fallback', () => {
    // The announcement is server state (server/notesStore.js). The panel reads `GET /api/admin/notes` and shows that;
    // the shipped module is what it falls back to when the server has nothing saved or the request fails.
    assert.match(JS, /apiGet\('\/api\/admin\/notes'\)/, 'the live revision comes from the admin API');
    assert.match(JS, /import\('\/js\/ui\/updateNotesData\.js'\)/, 'and the built-in file is still the fallback');
    const refresh = JS.slice(JS.indexOf('async function refreshUpdateNotes'), JS.indexOf('/** POST the edited text'));
    assert.ok(refresh.includes('builtinNotes()'), 'the fallback is used when the server has nothing');
    // A copy of the announcement's own words would mean the two sources had diverged; there is none.
    const sample = UPDATE_NOTES.text.split('\n').find((l) => l.trim().length > 20) || UPDATE_NOTES.text.slice(0, 20);
    assert.ok(!JS.includes(sample), `the announcement text is not duplicated into the panel (${sample.slice(0, 24)}…)`);
  });

  test('the digest it shows is the same value a browser stores as seen', async () => {
    // The panel renders the digest the SERVER reports, and that digest is computed by the same shared recipe the
    // client uses — assert the recipes agree, so a change on one side alone fails here.
    const viaShared = sha256Hex(canonicalJson(UPDATE_NOTES));
    assert.match(viaShared, /^[0-9a-f]{64}$/);
    assert.equal(viaShared, updateNotesDigest(), 'the built-in revision hashes identically on both sides');
    assert.match(JS, /notes-digest/, 'the panel shows a digest');
    assert.match(read('server/admin.js'), /notesDigest\(doc\.notes\)/, 'the server computes it with the shared recipe');
  });

  test('the panel is a browser module: no Node builtins, and it loads the shared rule by URL', () => {
    assert.ok(!/node:crypto|require\(/.test(JS), 'no Node builtins in the panel');
    // It loads the layout rule (a pure function) by URL, but never the server-side validator: the panel displays what
    // the server reports, it does not re-implement the rules.
    assert.match(JS, /import\('\/shared\/updateNotes\.js'\)/, 'the shared layout rule is loaded by URL');
    assert.ok(!/from '\.\.\/\.\.\/shared\//.test(JS), 'no static import of a server-side module');
  });

  test('a missing server copy degrades to the built-in revision, never to an empty box', () => {
    const fn = JS.slice(JS.indexOf('async function refreshUpdateNotes'), JS.indexOf('/** POST the edited text'));
    assert.match(fn, /if \(data === null\)/, 'a failed request is handled');
    assert.match(fn, /builtinNotes\(\)/, 'and falls back to the built-in revision');
    const load = JS.slice(JS.indexOf('async function builtinNotes'), JS.indexOf('/** Character count of the textarea'));
    assert.match(load, /try\s*\{/, 'the import is guarded');
    assert.match(load, /catch/, 'and catches');
  });
});

describe('更新公告 editor: editable, and wired like the rest of the panel', () => {
  test('saving POSTs the TEXT to /api/admin/notes; clearing POSTs to /api/admin/notes/clear', () => {
    assert.match(JS, /fetch\('\/api\/admin\/notes', \{[\s\S]{0,220}method: 'POST'/, 'the save is a POST');
    assert.match(JS, /fetch\('\/api\/admin\/notes\/clear'/, 'clearing is its own endpoint');
    // The textarea's value goes straight through: no JSON to parse, so there is no "not valid JSON" path to report.
    assert.match(JS, /JSON\.stringify\(\{ text: box\.value \}\)/, 'the box text is the payload');
    assert.ok(!/JSON\.parse\(box\.value\)/.test(JS), 'nothing parses the box as JSON any more');
    // The endpoints exist on the server and are registered as writable.
    const routes = read('server/http/routes.js');
    assert.match(routes, /ADMIN_NOTES_PATH = '\/api\/admin\/notes'/, 'the route constant exists');
    assert.ok(/ADMIN_PATHS = new Set\(\[[^\]]*'\/api\/admin\/notes'/.test(routes), 'and it is in the GET whitelist');
    assert.match(routes, /isNotesSave/, 'the POST branch is wired');
  });

  test('a refresh never overwrites typing in progress', () => {
    // The same class of bug as the feedback panel's collapsing <details>, with a worse consequence: lost work.
    assert.match(JS, /notesDirty/, 'a dirty flag exists');
    const body = JS.slice(JS.indexOf('function renderNotes'), JS.indexOf('/** `notesBlocks` from the shared module'));
    assert.ok(body.length > 0, 'the renderer slice is non-empty');
    assert.match(body, /force \|\| !notesDirty/, 'the textarea is only overwritten when clean or forced');
  });

  test('it loads on sign-in, re-renders on a language switch, and is wired once', () => {
    const startPolling = JS.slice(JS.indexOf('function startPolling'), JS.indexOf('// wiring'));
    assert.match(startPolling, /refreshUpdateNotes\(\)/, 'loaded when the dashboard opens');
    const from = JS.indexOf("$('btn-lang').addEventListener");
    const langHandler = JS.slice(from, JS.indexOf('\n});', from));
    assert.match(langHandler, /refreshUpdateNotes\(\)/, 're-rendered when the language changes');
    assert.match(JS, /wireUpdateNotes\(\)/, 'its controls are wired at boot');
  });

  test('the preview uses the SHARED layout rule, so it cannot lay the text out differently from the panel', () => {
    const fn = JS.slice(JS.indexOf('function renderNotes'), JS.indexOf('/** `notesBlocks` from the shared module'));
    assert.ok(fn.length > 0, 'the renderer slice is non-empty');
    assert.match(fn, /notesBlocksFor\(text\)/, 'the preview splits the text with the shared rule');
    const loader = JS.slice(JS.indexOf('let notesBlocksFn'), JS.indexOf('async function refreshUpdateNotes'));
    assert.match(loader, /import\('\/shared\/updateNotes\.js'\)/, 'which it loads from the shared module');
    assert.match(loader, /mod\.notesBlocks/, 'and calls there');
    assert.ok(!JS.includes('[-*•]'), 'the panel carries no second copy of the bullet rule');
    // The panel renders the same three classes the player's panel does.
    for (const cls of ['notes__p', 'notes__ul', 'notes__li']) {
      assert.ok(JS.includes(`'${cls}'`), `the preview renders ${cls}`);
    }
  });

  test('the shared rule is fetched at WIRE time and RE-DRAWS the preview when it lands', () => {
    // The first paint must not be stuck on the one-paragraph fallback: the dynamic import resolves after that paint,
    // so something has to redraw. Both halves are asserted because either one alone leaves a wrong preview on screen
    // until an unrelated event refreshes the section.
    const wire = JS.slice(JS.indexOf('function wireUpdateNotes'), JS.indexOf('async function poll'));
    assert.match(wire, /loadNotesBlocks\(\)/, 'the load is kicked off when the controls are wired');
    const loader = JS.slice(JS.indexOf('function loadNotesBlocks'), JS.indexOf('/** @param {string} text */'));
    assert.match(loader, /renderNotesPreview\(box\.value\)/, 'and it redraws from the textarea once the rule arrives');
    // The redraw must never write to the box: that is the operator's typing.
    assert.ok(!/box\.value\s*=/.test(loader), 'the redraw never overwrites what the operator typed');
  });
});

describe('更新公告 editor: the shell matches 全体公告 (one look, not two)', () => {
  test('the markup uses the SAME panel/border classes, not a fresh set of divs', () => {
    const s = section('panel--notes');
    assert.match(s, /<section class="panel panel--notes">/, 'it is a .panel, like every other section');
    assert.match(s, /class="panel__head"/, 'with the shared heading');
    assert.match(s, /class="muted announce__hint"/, 'and 全体公告\'s own hint class');
    assert.match(s, /class="announce__row"/, 'and its action row');
  });

  test('the empty state reuses the announcement panel\'s own class', () => {
    assert.match(JS, /'notes__empty muted'/, 'the empty preview borrows the muted tone');
  });

  test('the stylesheet gives the notes section the same mint frame as the announcement one', () => {
    const notesBlock = CSS.slice(CSS.indexOf('/* ---- 更新公告'));
    assert.match(notesBlock, /\.panel--notes \{ border-color: #2f4a3f; \}/, 'the same frame tone as .panel--announce');
    assert.match(notesBlock, /\.panel--notes \.panel__head \{ border-bottom-color: #2f4a3f; \}/, 'and the same head rule');
    // The token the frame tone comes from is 全体公告's, so a change there moves both.
    assert.match(CSS, /\.panel--announce \{ border-color: #2f4a3f; \}/, 'the announcement panel keeps that tone');
  });

  test('the notes styling reuses the shared pieces instead of restyling a block from scratch', () => {
    // The editor keeps the announcement field shell; the preview keeps the announcement's mint bullet marker.
    assert.match(CSS, /\.notes__text \{/, 'the textarea has its own proportional type (it is prose, not JSON)');
    assert.match(CSS, /\.notes__meta/, 'plus the one thing the announcement panel has no equivalent of');
    assert.match(CSS, /\.notes__p \{[\s\S]*?white-space: pre-wrap/, 'and the preview preserves the writer\'s line breaks');
  });

  test('no new colour literals beyond the SIBLING\'s own frame tone', () => {
    const notesBlock = CSS.slice(CSS.indexOf('/* ---- 更新公告'));
    // Reusing `#2f4a3f` is the point — it is exactly what .panel--announce uses, so the two frames match. Anything
    // ELSE hard-coded is a drift away from the panel's token set.
    const literal = [...notesBlock.matchAll(/#[0-9a-fA-F]{3,8}\b/g)].map((m) => m[0]);
    for (const c of literal) {
      assert.equal(c, '#2f4a3f', `a hard-coded colour that is not the sibling panel's frame tone: ${c}`);
    }
    assert.match(notesBlock, /var\(--mint\)/, 'the accent is the panel token');
    assert.match(notesBlock, /var\(--muted\)/, 'and the secondary text too');
  });
});
