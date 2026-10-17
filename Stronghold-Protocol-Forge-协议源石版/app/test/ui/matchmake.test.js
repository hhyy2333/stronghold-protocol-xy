// test/ui/matchmake.test.js — 多人匹配 on the CLIENT (ui/matchmake.js; DESIGN §30): the 「匹配在线博士」 button sends
// `room.quickmatch { mode, difficulty }`, marks itself 搜索中… while the search runs, and the status row reports the
// elapsed seconds (from the searching slice's `at`) and then the room code the server matched the player into.
//
// The two frozen exports are hook-free by design, so this suite renders them directly with the mods-ui / testArena tree
// expansion and never needs a DOM: `useStore()` throws outside a Preact render in Node ("Cannot read properties of
// undefined (reading '__H')"), which is exactly why the store is read through plain `store.get()` inside the components.
//
// net is the app singleton (`public/js/net.js`); the request is monkey-patched the way test/ui/playtest3.test.js and
// test/ui/facing.test.js already do, and always restored in a `finally`.
//
// Run: node test/ui/matchmake.test.js   (`node --test` cannot spawn in this sandbox: EPERM)
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const read = (p) => readFileSync(path.join(ROOT, p), 'utf8');
const EN = JSON.parse(read('public/i18n/en.json'));

const { net } = await import('../../public/js/net.js');
const { store } = await import('../../public/js/store.js');
const {
  QuickMatchButton, MatchSearchPanel, sendQuickMatch, quickMatchIntent, matchElapsedSeconds,
} = await import('../../public/js/ui/matchmake.js');
const { setLang, setMessages } = await import('../../shared/i18n.js');
/** The slice every render reads, back to idle (the components default to the app store). */
const reset = (patch = {}) => {
  store.set({ matchmaking: { status: 'idle', mode: null, difficulty: null, roomCode: null, matched: 0, target: 0, at: 0, error: null, ...patch } });
};

// ---- component helpers (the same expansion the other UI suites use) ----------------------------------------------
function* walk(v) {
  if (Array.isArray(v)) { for (const x of v) yield* walk(x); return; }
  if (!v || typeof v !== 'object') return;
  yield v;
  yield* walk(v.props?.children);
}
function expand(v, depth = 8) {
  if (Array.isArray(v)) return v.map((x) => expand(x, depth));
  if (!v || typeof v !== 'object') return v;
  if (typeof v.type === 'function' && depth > 0) {
    try { return expand(v.type(v.props || {}), depth - 1); } catch { return v; }
  }
  const children = v.props?.children;
  return children === undefined ? v : { ...v, props: { ...v.props, children: expand(children, depth) } };
}
const nodesOf = (v) => [...walk(v)];
const buttonsOf = (v) => nodesOf(v).filter((n) => n.type === 'button');
const textOf = (v) => nodesOf(v).flatMap((n) => (Array.isArray(n.props?.children) ? n.props.children : [n.props?.children]))
  .filter((x) => typeof x === 'string' || typeof x === 'number').join(' ');
const hasClass = (v, c) => typeof v?.props?.class === 'string' && v.props.class.split(/\s+/).includes(c);

/** Run `fn` with net.request replaced; always restore the real method. */
async function withFakeNet(impl, fn) {
  const orig = net.request;
  net.request = impl;
  try { return await fn(); } finally { net.request = orig; }
}

describe('多人匹配: the button (ui/matchmake.js QuickMatchButton)', () => {
  test('idle it offers 匹配在线博士, and a tap sends room.quickmatch with the caller\'s mode and difficulty', async () => {
    reset();
    const sent = [];
    await withFakeNet(async (t, fields) => { sent.push([t, fields]); return {}; }, async () => {
      const btn = expand(QuickMatchButton({ mode: 'coop', difficulty: 'HARD' }));
      const button = buttonsOf(btn)[0];
      assert.ok(button, 'a button is rendered');
      assert.equal(textOf(btn).includes('匹配在线博士'), true, 'the idle label');
      assert.equal(button.props.disabled, false, 'tappable while idle');
      button.props.onClick();
      // the request is fire-and-forget from the click: let the microtask queue drain
      await new Promise((r) => setTimeout(r, 0));
    });
    assert.deepEqual(sent, [['room.quickmatch', { mode: 'coop', difficulty: 'HARD' }]], 'the frozen intent shape');
  });

  test('an omitted difficulty falls back to the lobby pick / FUNNY — never an invalid value', () => {
    // the fallback is what the lobby remembers (screens/lobby.js `loadPref('lobby.difficulty', 'FUNNY')`)
    delete globalThis.localStorage;
    assert.equal(quickMatchIntent({ mode: 'coop' }).difficulty, 'FUNNY');
    assert.equal(quickMatchIntent({}).mode, 'coop', 'mode defaults to co-op: a 多人匹配 is a co-op search');
    // localStorage holding a valid pick is used; a bogus one is not
    globalThis.localStorage = { getItem: () => JSON.stringify('NORMAL'), setItem() {} };
    try {
      assert.equal(quickMatchIntent({ difficulty: undefined }).difficulty, 'NORMAL');
      globalThis.localStorage = { getItem: () => JSON.stringify('NOT_A_DIFFICULTY'), setItem() {} };
      assert.equal(quickMatchIntent({}).difficulty, 'FUNNY', 'a bad remembered value falls back');
      // an explicit valid value always wins over the remembered one
      assert.equal(quickMatchIntent({ difficulty: 'ABYSS' }).difficulty, 'ABYSS');
    } finally { delete globalThis.localStorage; }
  });

  test('searching: it shows 搜索中…, is loading/disabled and refuses a repeat tap', async () => {
    reset({ status: 'searching', difficulty: 'FUNNY', at: Date.now() });
    const sent = [];
    await withFakeNet(async (t, fields) => { sent.push([t, fields]); return {}; }, async () => {
      const btn = expand(QuickMatchButton({ mode: 'coop', difficulty: 'FUNNY' }));
      const button = buttonsOf(btn)[0];
      assert.equal(textOf(btn).includes('搜索中…'), true, 'the searching label');
      assert.equal(button.props.disabled, true, 'a search in flight cannot be re-tapped');
      // Button renders its own loading state: aria-busy + .is-loading + the .btn__busy sweep
      assert.equal(button.props['aria-busy'], 'true', 'the button shows its loading state');
      assert.ok(hasClass(button, 'is-loading'), 'the loading class');
      assert.ok(nodesOf(btn).some((n) => hasClass(n, 'btn__busy')), 'the loading bar is rendered');
      assert.equal(button.props['data-status'], 'searching');
      assert.ok(hasClass(button, 'is-searching'), 'the searching accent class');
      button.props.onClick();
      await new Promise((r) => setTimeout(r, 0));
    });
    assert.deepEqual(sent, [], 'the repeat tap sent nothing');
  });

  test('a refused search toasts and puts the slice back to idle (the button is tappable again)', async () => {
    reset();
    const err = Object.assign(new Error('quickmatch is a co-op search'), { code: 'BAD_TARGET' });
    await withFakeNet(async () => { throw err; }, async () => {
      const ok = await sendQuickMatch({ mode: 'coop', difficulty: 'FUNNY' });
      assert.equal(ok, false, 'a refusal reports false');
    });
    assert.equal(store.get().matchmaking.status, 'idle', 'the slice is honest again');
    // and the button renders idle, so the player can retry
    const btn = expand(QuickMatchButton({ mode: 'coop', difficulty: 'FUNNY' }));
    assert.equal(buttonsOf(btn)[0].props.disabled, false);
    assert.ok(!textOf(btn).includes('搜索中…'), 'no leftover searching state');
  });

  test('an accepted search leaves the slice to the server (the found push wins)', async () => {
    reset();
    await withFakeNet(async () => ({}), async () => {
      // the server pushes match.status BEFORE its ok arrives (server/lobby.js quickmatch)
      const run = sendQuickMatch({ mode: 'coop', difficulty: 'FUNNY' });
      store.patch('matchmaking', { status: 'found', roomCode: 'AC-7' });
      assert.equal(await run, true);
    });
    assert.equal(store.get().matchmaking.status, 'found', 'the accepted request must not clobber the found push');
    assert.equal(store.get().matchmaking.roomCode, 'AC-7');
  });

  test('the labels are translated (English shows the pack, not the Chinese msgid)', () => {
    reset();
    setLang('zh');
    const zh = textOf(expand(QuickMatchButton({ mode: 'coop', difficulty: 'FUNNY' })));
    setMessages('en', EN);
    setLang('en');
    try {
      const english = textOf(expand(QuickMatchButton({ mode: 'coop', difficulty: 'FUNNY' })));
      assert.notEqual(english, zh, 'the English pack changes the label');
      assert.ok(english.includes(EN['匹配在线博士']), `the English label (${EN['匹配在线博士']})`);
    } finally { setLang('zh'); setMessages('en', {}); }
  });
});

describe('多人匹配: the search panel (ui/matchmake.js MatchSearchPanel)', () => {
  test('idle renders nothing at all', () => {
    reset();
    assert.equal(MatchSearchPanel(), null, 'no row while nothing is searched');
    assert.equal(MatchSearchPanel({ status: 'idle' }), null, 'an explicit idle too');
  });

  test('searching renders the status line and the seconds counted from `at`', () => {
    const at = 1_000_000;
    reset({ status: 'searching', at, difficulty: 'FUNNY' });
    const tree = expand(MatchSearchPanel({ now: at + 7_400 }));
    assert.equal(tree.props['data-status'], 'searching');
    assert.ok(textOf(tree).includes(EN['正在为你寻找同盟…']) || /正在为你寻找同盟…/.test(textOf(tree)), 'the status line');
    const elapsed = nodesOf(tree).find((n) => hasClass(n, 'qm-search__elapsed'));
    assert.ok(elapsed, 'the elapsed read-out exists');
    assert.equal(String(elapsed.props.children), '7', 'whole seconds since `at`');
    // an explicit elapsed wins (the host ticks it)
    const pinned = expand(MatchSearchPanel({ now: at, elapsed: 42 }));
    assert.equal(String(nodesOf(pinned).find((n) => hasClass(n, 'qm-search__elapsed')).props.children), '42');
  });

  test('matchElapsedSeconds is whole, non-negative and defensive about a missing clock', () => {
    const at = 1_000_000;
    assert.equal(matchElapsedSeconds(at, at), 0);
    assert.equal(matchElapsedSeconds(at, at + 999), 0, 'sub-second counts as 0');
    assert.equal(matchElapsedSeconds(at, at + 1_000), 1);
    assert.equal(matchElapsedSeconds(at, at + 59_999), 59);
    assert.equal(matchElapsedSeconds(at, at - 5_000), 0, 'a clock that went backwards never shows a negative');
    assert.equal(matchElapsedSeconds(0, at), 0, 'no start time: 0, never NaN');
    assert.equal(matchElapsedSeconds(undefined, at), 0);
  });

  test('found renders the room code and no searching row', () => {
    reset({ status: 'found', roomCode: 'AC-42', at: Date.now() });
    const tree = expand(MatchSearchPanel());
    assert.equal(tree.props['data-status'], 'found');
    const text = textOf(tree);
    assert.ok(text.includes('AC-42'), `the room code is shown (${text})`);
    assert.ok(!hasClass(tree, 'is-searching'), 'not the searching row');
    assert.ok(!text.includes(EN['正在为你寻找同盟…']) && !/正在为你寻找同盟…/.test(text), 'the searching line is gone');
    // the template msgid is filled, not shown raw
    assert.ok(!text.includes('{code}'), 'the {code} placeholder is filled');
  });

  test('the found line is translated through t() with the code as a param', () => {
    reset({ status: 'found', roomCode: 'AC-9' });
    setMessages('en', EN);
    setLang('en');
    try {
      const text = textOf(expand(MatchSearchPanel()));
      assert.ok(text.includes('AC-9'), 'the code rides through');
      assert.ok(text.includes(EN['已找到同盟：{code}'].replace('{code}', 'AC-9')), `the English template (${text})`);
    } finally { setLang('zh'); setMessages('en', {}); }
  });

  test('the searching line is translated too', () => {
    reset({ status: 'searching', at: Date.now() });
    setMessages('en', EN);
    setLang('en');
    try {
      const text = textOf(expand(MatchSearchPanel({ now: Date.now() })));
      assert.ok(text.includes(EN['正在为你寻找同盟…']), `the English line (${text})`);
    } finally { setLang('zh'); setMessages('en', {}); }
  });

  test('the panel reads the store by default and takes overrides when given them', () => {
    reset({ status: 'searching', at: 5_000 });
    // default source: the store
    const fromStore = expand(MatchSearchPanel({ now: 5_000 + 3_000 }));
    assert.equal(fromStore.props['data-status'], 'searching');
    assert.equal(String(nodesOf(fromStore).find((n) => hasClass(n, 'qm-search__elapsed')).props.children), '3');
    // an explicit status wins over the slice (a parent / a test pinning a state)
    const pinned = MatchSearchPanel({ status: 'idle' });
    assert.equal(pinned, null, 'the override is honoured');
    const found = expand(MatchSearchPanel({ status: 'found', roomCode: 'ZZ-1' }));
    assert.equal(found.props['data-status'], 'found');
  });
});

describe('多人匹配: the module itself', () => {
  test('exactly the frozen exports exist with their frozen signatures', async () => {
    const mod = await import('../../public/js/ui/matchmake.js');
    assert.equal(typeof mod.QuickMatchButton, 'function');
    assert.equal(typeof mod.MatchSearchPanel, 'function');
    // the frozen signatures: a single optional object, both callable with no arguments
    assert.doesNotThrow(() => mod.QuickMatchButton());
    assert.doesNotThrow(() => mod.MatchSearchPanel());
    assert.equal(mod.QuickMatchButton.length, 0, 'QuickMatchButton({ ... } = {})');
    assert.equal(mod.MatchSearchPanel.length, 0, 'MatchSearchPanel({ ... } = {})');
  });

  test('every Chinese literal goes through t() (the i18n scan)', () => {
    const src = read('public/js/ui/matchmake.js');
    // no raw Chinese inside a string that is not a t()/N_() argument: the scanner's own rule, checked here narrowly
    const chinese = [...src.matchAll(/(['"`])([^'"`\n]*[一-鿿][^'"`\n]*)\1/g)].map((m) => m[2]);
    for (const lit of chinese) {
      const wrapped = src.includes(`t('${lit}'`) || src.includes(`t("${lit}"`) || src.includes(`N_('${lit}'`);
      assert.ok(wrapped, `Chinese literal not wrapped in t(): ${lit}`);
    }
    // and the module only uses msgids the packs carry (en.json is the reference pack)
    for (const msgid of [...src.matchAll(/\bt\(\s*'([^']*[一-鿿][^']*)'/g)].map((m) => m[1])) {
      assert.ok(EN[msgid], `en.json lacks the msgid used by matchmake.js: ${msgid}`);
    }
    for (const msgid of ["多人匹配", "匹配在线博士", "搜索中…", "正在为你寻找同盟…", "已找到同盟：{code}"]) {
      assert.ok(src.includes(msgid), `matchmake.js should use ${msgid}`);
      assert.ok(EN[msgid], `en.json lacks ${msgid}`);
    }
  });

  test('the placeholder stylesheet was replaced with real rules', () => {
    const css = read('public/css/screens/matchmake.css');
    assert.ok(css.length > 400, 'the placeholder is gone');
    assert.match(css, /\.qm-search\b/, 'the status row is styled');
    assert.match(css, /\.qm-search__dot\b/, 'the dot is styled');
    assert.match(css, /\.qm-btn\b/, 'the button is styled');
    assert.match(css, /@keyframes\s+qm-pulse/, 'the dot breathes');
    assert.match(css, /prefers-reduced-motion/, 'and respects reduced motion');
  });

  test('every custom property this stylesheet reads is either defined by the game sheets or has a fallback', () => {
    // A undefined `var(--token)` fails SILENTLY: the browser drops the whole declaration with no error, so the mint
    // searching button, the breathing dot and the elapsed read-out would all just not paint — and neither this suite
    // (which only reads the js tree) nor client-static (which checks color-mix fallbacks / :has() / nesting, i.e.
    // syntax and compatibility) can see it. Checked here instead: `--mint` lives only in public/admin/admin.css, which
    // public/index.html never loads, so it must be `--mint-500` (public/css/theme.css). Scanning public/css/** covers
    // exactly the game stylesheets and excludes that admin sheet by location.
    const defs = new Set();
    const walkCss = (dir) => {
      for (const e of readdirSync(dir, { withFileTypes: true })) {
        const p = path.join(dir, e.name);
        if (e.isDirectory()) walkCss(p);
        else if (e.name.endsWith('.css')) {
          for (const m of read(p.replace(`${ROOT}${path.sep}`, '').split(path.sep).join('/')).matchAll(/(--[A-Za-z0-9_-]+)\s*:/g)) defs.add(m[1]);
        }
      }
    };
    walkCss(path.join(ROOT, 'public/css'));
    assert.ok(defs.has('--mint-500'), 'the theme token table was found');
    assert.ok(!defs.has('--mint'), '--mint is defined only in the never-loaded admin sheet');

    const css = read('public/css/screens/matchmake.css');
    const missing = [];
    for (const m of css.matchAll(/var\(\s*(--[A-Za-z0-9_-]+)\s*(,)?/g)) {
      if (m[2]) continue; // an explicit fallback makes it safe whatever the theme says
      if (!defs.has(m[1])) missing.push(m[1]);
    }
    assert.deepEqual(missing, [], `matchmake.css reads undefined variables without a fallback: ${missing.join(', ')}`);
    // and it really is on the mint token scale the game defines
    assert.ok(css.includes('var(--mint-500)'), 'the mint colour comes from the theme scale');
  });
});
