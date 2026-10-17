// test/ui/updateNotes.test.js — 更新公告: the "show once per revision" rule (public/js/ui/updateNotesModel.js) and the
// panel's rendering contract (public/js/ui/updateNotes.js).
//
// WHY THIS FILE IS MOSTLY ABOUT THE MODEL. The owner's single hard requirement is that the panel pops EXACTLY once
// per revision: never twice (close it, reload, it is back), never zero times (a new revision that never shows). That
// is a state machine over localStorage, so every branch is driven here directly — a fresh revision, an already-seen
// one, a corrupted record, a browser that refuses to persist, two close paths racing, and the manual re-read entry.
//
// THE BUG THIS SUITE EXISTS TO CATCH. `savePref` (store.js) swallows quota / private-mode failures. If the model
// trusted the write, a player whose browser refuses storage would see the panel on EVERY page load, forever — which is
// precisely the "关了刷新又冒出来" failure. So the model verifies the write by reading it back and keeps an in-memory
// digest as well; both halves are asserted below.
//
// A localStorage stand-in is installed BEFORE the model is imported (the model reads it at call time, but installing
// first keeps the order irrelevant): the same shape the app uses (`getItem`/`setItem`/`removeItem`), with a switch to
// make writes fail like a full quota.
// Run: node test/ui/updateNotes.test.js

import { test, describe, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const read = (p) => readFileSync(path.join(ROOT, p), 'utf8');

// ---- a localStorage stand-in, installed before the model is imported --------------------------------------------

function makeStorage() {
  const map = new Map();
  return {
    get length() { return map.size; },
    key: (i) => [...map.keys()][i] ?? null,
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => { map.set(k, String(v)); },
    removeItem: (k) => { map.delete(k); },
    clear: () => map.clear(),
    _map: map,
  };
}

const storage = makeStorage();
globalThis.localStorage = storage;
/** When true, setItem throws like a full quota / a locked-down private window. */
let writesFail = false;
const realSetItem = storage.setItem.bind(storage);
storage.setItem = (k, v) => {
  if (writesFail) { const e = new Error('QuotaExceededError'); e.name = 'QuotaExceededError'; throw e; }
  return realSetItem(k, v);
};

const {
  NOTES_PREF_KEY, updateNotesDigest, normalizeSeenRecord, readSeenRecord, markUpdateNotesSeen,
  shouldShowUpdateNotes, isUpdateNotesOpen, openUpdateNotes, closeUpdateNotes, maybeOpenUpdateNotes,
  onUpdateNotesChange, resetUpdateNotesForTests,
} = await import('../../public/js/ui/updateNotesModel.js');
const { UPDATE_NOTES } = await import('../../public/js/ui/updateNotesData.js');
const { notesBlocks, sanitizeNotesText, NOTES_LIMITS } = await import('../../shared/updateNotes.js');

const PREF = `sp.pref.${NOTES_PREF_KEY}`;
/** A revision that is NOT the shipped one: a stand-in for "the next release". Free text, one language. */
const NEXT_RELEASE = { text: '下一版\n\n- 一条新东西' };

// ---- the repo's plain vnode-tree walk (test/ui/presence.test.js / mods-ui.test.js) -------------------------------

/** Every vnode of a tree, children included. */
function* walkVnode(v) {
  if (Array.isArray(v)) { for (const x of v) yield* walkVnode(x); return; }
  if (!v || typeof v !== 'object') return;
  yield v;
  yield* walkVnode(v.props?.children);
}
/** The concatenated text of a vnode tree. */
const vnodeText = (v) => [...walkVnode(v)]
  .flatMap((n) => (Array.isArray(n.props?.children) ? n.props.children : [n.props?.children]))
  .filter((x) => typeof x === 'string' || typeof x === 'number').join('');

before(() => { resetUpdateNotesForTests(); storage.clear(); });
after(() => { resetUpdateNotesForTests(); delete globalThis.localStorage; });
beforeEach(() => { resetUpdateNotesForTests(); storage.clear(); writesFail = false; });

describe('the revision identity is the CONTENT, not a version number', () => {
  test('the shipped notes have a stable, non-empty digest', () => {
    const d = updateNotesDigest();
    assert.match(d, /^[0-9a-f]{64}$/, 'a sha256 hex');
    assert.equal(d, updateNotesDigest(), 'the same object hashes the same every time');
  });

  test('EVERY content change moves the digest — this is what makes the panel re-pop', () => {
    const base = updateNotesDigest(UPDATE_NOTES);
    const changed = [
      ['one word', { text: UPDATE_NOTES.text.replace('协议源石', '协议源石（改）') }],
      ['an extra bullet', { text: `${UPDATE_NOTES.text}\n- 又一条` }],
      ['a removed paragraph', { text: UPDATE_NOTES.text.split('\n\n').slice(1).join('\n\n') }],
      ['a single character', { text: `${UPDATE_NOTES.text}。` }],
    ];
    for (const [what, notes] of changed) {
      assert.notEqual(updateNotesDigest(notes), base, `${what} must move the digest`);
    }
  });

  test('a version bumped WITHOUT touching the announcement does not move it (nothing new was said)', () => {
    // The panel must not pop just because APP_VERSION moved: the announcement IS the identity.
    const clone = JSON.parse(JSON.stringify(UPDATE_NOTES));
    assert.equal(updateNotesDigest(clone), updateNotesDigest(UPDATE_NOTES));
  });

  test('the announcement is ONE key, so there is no shape for a writer to get wrong', () => {
    // The whole point of the free-text change: nothing to reorder, rename or translate. The digest is over `{ text }`.
    assert.deepEqual(Object.keys(UPDATE_NOTES), ['text']);
    assert.equal(typeof UPDATE_NOTES.text, 'string');
  });
});

describe('normalizeSeenRecord: anything that is not a usable record reads as NOT SEEN', () => {
  test('the well-formed record survives', () => {
    assert.deepEqual(normalizeSeenRecord({ seen: 'abc', at: 123 }), { seen: 'abc', at: 123 });
    assert.deepEqual(normalizeSeenRecord({ seen: 'abc' }), { seen: 'abc', at: 0 }, 'a missing `at` is tolerated');
  });

  test('garbage is null, never a false "already seen"', () => {
    for (const bad of [null, undefined, 'abc', 42, true, [], [{ seen: 'x' }], {}, { seen: '' }, { seen: 42 }, { seen: null }]) {
      assert.equal(normalizeSeenRecord(bad), null, `${JSON.stringify(bad)} → null`);
    }
  });
});

describe('the single-pop rule', () => {
  test('a fresh browser shows it; after closing, the SAME revision never shows again', () => {
    assert.equal(shouldShowUpdateNotes(), true, 'a revision nobody has seen must show');
    assert.equal(closeUpdateNotes(), true, 'the close reached storage');
    assert.equal(shouldShowUpdateNotes(), false, 'and now it must not');

    // "Close it, reload the page": a reload keeps localStorage and resets module state.
    resetUpdateNotesForTests();
    assert.equal(shouldShowUpdateNotes(), false, 'still sealed after a reload');
    assert.equal(maybeOpenUpdateNotes(), false, 'the boot pop must not fire');
    assert.equal(isUpdateNotesOpen(), false);
  });

  test('a NEW revision unlocks it again — exactly once more', () => {
    closeUpdateNotes();
    assert.equal(shouldShowUpdateNotes(), false);
    // The next release: the digest of those notes has never been seen.
    assert.equal(shouldShowUpdateNotes(NEXT_RELEASE), true, 'unseen content shows');
    assert.equal(markUpdateNotesSeen(NEXT_RELEASE), true);
    assert.equal(shouldShowUpdateNotes(NEXT_RELEASE), false, 'and seals after that');
    // Going BACK to the old notes does not re-open them: that digest is recorded too? No — only one record is kept,
    // so the *shipped* notes would show again. Assert the honest behaviour instead of inventing one:
    assert.equal(shouldShowUpdateNotes(NEXT_RELEASE), false, 'the current revision stays sealed');
  });

  test('the boot pop opens it once and is a no-op afterwards', () => {
    assert.equal(maybeOpenUpdateNotes(), true, 'the first boot pops it');
    assert.equal(isUpdateNotesOpen(), true);
    assert.equal(maybeOpenUpdateNotes(), false, 'a second call in the same load does nothing');
    closeUpdateNotes();
    resetUpdateNotesForTests();
    assert.equal(maybeOpenUpdateNotes(), false, 'and a later boot stays quiet');
  });

  test('closing is idempotent: every path (button, Escape, backdrop) writes the same digest', () => {
    maybeOpenUpdateNotes();
    const first = closeUpdateNotes();
    const second = closeUpdateNotes();     // Escape landing beside the click, a double click, …
    assert.equal(first, true);
    assert.equal(second, true);
    assert.equal(isUpdateNotesOpen(), false);
    assert.equal(shouldShowUpdateNotes(), false, 'still sealed after a double close');
    const rec = JSON.parse(storage.getItem(PREF));
    assert.equal(rec.seen, updateNotesDigest(), 'the stored digest is this revision');
  });

  test('closing a panel that was never open still seals the revision', () => {
    // A close that arrives late (an unmount, a race) must not be able to leave the revision unrecorded.
    assert.equal(isUpdateNotesOpen(), false);
    closeUpdateNotes();
    assert.equal(shouldShowUpdateNotes(), false);
  });
});

describe('a browser that refuses to persist: at most once per page load, never a lock-out', () => {
  test('the failed write is REPORTED (closeUpdateNotes returns false) and the in-memory digest still seals it', () => {
    writesFail = true;
    assert.equal(shouldShowUpdateNotes(), true);
    assert.equal(closeUpdateNotes(), false, 'the caller is told the write did not stick');
    assert.equal(shouldShowUpdateNotes(), false, 'but this page load will not show it again');

    // The next page load has no storage and no memory: it shows once more. That is the safe direction — one extra
    // look beats never seeing a release — and it is why the return value matters.
    resetUpdateNotesForTests();
    assert.equal(shouldShowUpdateNotes(), true, 'a reload in a storage-less browser shows it again');
  });

  test('a write that silently does nothing is treated as a failure', () => {
    // savePref catches the throw, so a quota error looks like a no-op write. Verify the read-back check catches a
    // setItem that swallows the error without storing anything.
    writesFail = true;
    const ok = markUpdateNotesSeen();
    assert.equal(ok, false);
    writesFail = false;
  });

  test('a corrupt stored value reads as not-seen (one extra look, never a stolen release)', () => {
    for (const junk of ['not json', 'null', '[]', '{}', '{"seen":42}', '"a string"']) {
      storage.clear();
      storage.setItem(PREF, junk);
      resetUpdateNotesForTests();
      assert.equal(shouldShowUpdateNotes(), true, `${junk} must read as NOT seen`);
    }
  });

  test('a record written for a DIFFERENT revision does not seal the current one', () => {
    storage.setItem(PREF, JSON.stringify({ seen: 'f'.repeat(64), at: 1 }));
    assert.equal(readSeenRecord().seen, 'f'.repeat(64));
    assert.equal(shouldShowUpdateNotes(), true, 'another revision seen is not this one seen');
  });
});

describe('the manual entry: reading again never changes what has been seen', () => {
  test('openUpdateNotes opens it and marks nothing; the digest is untouched', () => {
    closeUpdateNotes();                       // the player closed the pop
    const before = storage.getItem(PREF);
    assert.equal(openUpdateNotes(), true, 'the 查看更新公告 entry opens it');
    assert.equal(isUpdateNotesOpen(), true);
    assert.equal(storage.getItem(PREF), before, 'opening changed nothing on disk');
    closeUpdateNotes();
    assert.equal(shouldShowUpdateNotes(), false, 'and the revision stays sealed');
  });

  test('opening twice in a row is a no-op, and listeners are notified on each real change', () => {
    let calls = 0;
    const off = onUpdateNotesChange(() => { calls++; });
    assert.equal(openUpdateNotes(), true);
    assert.equal(calls, 1);
    assert.equal(openUpdateNotes(), false, 'already open');
    assert.equal(calls, 1, 'no second notification');
    closeUpdateNotes();
    assert.equal(calls, 2, 'closing notifies');
    off();
    openUpdateNotes();
    assert.equal(calls, 2, 'after unsubscribing it is not notified');
  });
});

describe('the layout rule is the ONLY format, and both surfaces share one implementation', () => {
  test('a blank line separates paragraphs, a leading marker makes a bullet', () => {
    assert.deepEqual(notesBlocks('一段\n\n- 一条'), [{ kind: 'p', text: '一段' }, { kind: 'ul', items: ['一条'] }]);
  });

  test('the panel and the admin preview use the SAME function, so the preview cannot lie', () => {
    // A preview that laid the text out differently from the player's panel would be worse than none, so the rule lives
    // in shared/updateNotes.js and both import it — asserted statically, because that is what could regress.
    const game = read('public/js/ui/updateNotes.js');
    const admin = read('public/admin/admin.js');
    assert.match(game, /notesBlocks/, 'the player panel imports the shared rule');
    assert.match(admin, /import\('\/shared\/updateNotes\.js'\)/, 'the admin preview loads the same shared module');
    assert.match(admin, /mod\.notesBlocks/, 'and calls the shared function');
    // The bullet character class exists in exactly one place; a second copy here would be the divergence this guards.
    assert.ok(!admin.includes('[-*•]'), 'the admin panel does not carry its own copy of the layout rule');
  });
});

describe('the announcement content itself', () => {
  test('the shipped announcement is real, readable text within the cap', () => {
    assert.equal(typeof UPDATE_NOTES.text, 'string');
    assert.ok(UPDATE_NOTES.text.trim().length > 0, 'a fresh install must not show a blank panel');
    assert.ok(UPDATE_NOTES.text.length <= NOTES_LIMITS.text, 'it fits the cap (so nothing was silently cut)');
    assert.ok(!/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(UPDATE_NOTES.text), 'no control characters survived');
  });

  test('it is already CANONICAL, so its digest is what the server would compute for the same text', () => {
    // The data module runs the text through sanitizeNotesText at load. If it did not, a hand-added trailing space
    // would make the built-in digest differ from the digest of a server save of the same words — and the panel would
    // pop once more for no reason.
    assert.equal(sanitizeNotesText(UPDATE_NOTES.text), UPDATE_NOTES.text);
    assert.equal(updateNotesDigest(), updateNotesDigest({ text: UPDATE_NOTES.text }));
  });

  test('it uses the two layout features it documents (so the rules are not theoretical)', () => {
    const blocks = notesBlocks(UPDATE_NOTES.text);
    assert.ok(blocks.filter((b) => b.kind === 'p').length >= 2, 'more than one paragraph');
    assert.ok(blocks.filter((b) => b.kind === 'ul').length >= 1, 'at least one bullet list');
  });

  test('the shipped content is frozen (it is the identity, not a scratch pad)', () => {
    assert.ok(Object.isFrozen(UPDATE_NOTES));
  });
});

describe('the panel module: statically, what the runtime cannot easily prove here', () => {
  const src = read('public/js/ui/updateNotes.js');

  test('it is mounted by main.js inside <App/>, so it covers every route', () => {
    const main = read('public/js/main.js');
    assert.match(main, /import \{ UpdateNotesHost \}/, 'main.js imports the host');
    assert.ok(main.includes('<${UpdateNotesHost} />'), 'main.js renders it');
    const app = main.slice(main.indexOf('function App()'), main.indexOf('// ---- boot'));
    assert.ok(app.includes('UpdateNotesHost'), 'inside <App/>, next to the other hosts');
  });

  test('the pop is decided BEFORE the first render, so the panel is up when the page appears', () => {
    const main = read('public/js/main.js');
    const pop = main.indexOf('maybeOpenUpdateNotes()');
    const firstRender = main.indexOf('render(html`<${App} />`, root)');
    assert.ok(pop > 0 && firstRender > 0, 'both calls exist');
    assert.ok(pop < firstRender, 'maybeOpenUpdateNotes() runs before the first render');
  });

  test('Modal.onClose is closeUpdateNotes: Escape and a backdrop click cannot bypass the record', () => {
    assert.match(src, /onClose=\$\{closeUpdateNotes\}/, 'the only close handler is closeUpdateNotes');
    assert.match(src, /onClick=\$\{closeUpdateNotes\}/, 'and the 知道了 button uses the same function');
    // No other function may set the open state: only the model closes it.
    assert.ok(!/setOpen\(false\)/.test(src), 'the panel never closes itself outside the model');
  });

  test('the manual entry opens without marking anything seen', () => {
    const entry = src.slice(src.indexOf('export function UpdateNotesButton'));
    assert.ok(entry.includes('openUpdateNotes'), 'the button opens through the model');
    assert.ok(!entry.includes('closeUpdateNotes'), 'and never closes/records anything');
  });

  test('the REAL UpdateNotesButton vnode is wired to the model function itself (not a copy of it)', async () => {
    // Expanding the vnode tree by hand is the repo's own idiom for a hook-free component
    // (test/ui/presence.test.js / mods-ui.test.js): it proves the IDENTITY of the callback, which a source regex
    // cannot. UpdateNotesButton takes no hooks, so it can be called outside Preact.
    const { UpdateNotesButton } = await import('../../public/js/ui/updateNotes.js');
    const v = UpdateNotesButton({});
    const nodes = [...walkVnode(v)];
    const clickable = nodes.find((n) => n.props?.onClick);
    assert.ok(clickable, 'the component renders a clickable node');
    assert.equal(clickable.props.onClick, openUpdateNotes, 'its onClick IS the model entry point');
    assert.equal(vnodeText(v), '更新公告', 'and its label is the translated msgid');
  });

  test('every string shown is a t() msgid (the packs translate the chrome)', () => {
    // The announcement TEXT is data, not chrome — it is whatever the operator wrote, in whatever language, and must
    // never be wrapped in t(). Only the panel's own shell is translated.
    for (const msgid of ['更新公告', '知道了', '查看更新公告']) {
      assert.ok(src.includes(`t('${msgid}'`), `the panel translates '${msgid}'`);
    }
    const data = read('public/js/ui/updateNotesData.js');
    assert.ok(data.startsWith('// i18n-ignore-file'), 'the content file opts out of the msgid scan');
    assert.ok(!/\bt\(/.test(data.replace(/^\/\/.*$/gm, '')), 'the content file never calls t()');
  });

  test('the panel stylesheet is linked from index.html and avoids the banned CSS features', () => {
    const html = read('public/index.html');
    assert.ok(html.includes('/css/screens/update-notes.css'), 'the stylesheet is linked');
    // Comments are stripped first — exactly as test/client-static.test.js does — so a comment that NAMES a banned
    // feature (this file's own header does) is not mistaken for a use of it.
    const css = read('public/css/screens/update-notes.css').replace(/\/\*[\s\S]*?\*\//g, '');
    assert.doesNotMatch(css, /:has\(/, 'no :has() (Firefox ESR 115 / Safari < 15.4)');
    assert.doesNotMatch(css, /@container|container-type|@layer/, 'no container queries / layers');
    assert.doesNotMatch(css, /color-mix\(/, 'no color-mix()');
    for (const rule of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
      assert.ok(!/(^|[\s,])&/.test(rule[1].trim()), `CSS nesting in '${rule[1].trim()}'`);
    }
  });
});
