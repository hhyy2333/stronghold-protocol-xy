// test/ui/mods-ui.test.js — 内容 mod on the CLIENT (shared/mods.js; owner's decisions of 2026-10-09). The static files
// at /data/*.json are the same for every room, so the browser has to filter them itself: with a mod off, its content
// must leave every picker, detail card and list at once. This is the UI-honesty half of the switch — the server refuses
// the content regardless (test/mods.test.js), but the UI must never offer what the server would drop.
//
// This build declares two mods and only `custom-fixed` carries content (the 固定 operator 娅娜). `custom-ops` (自制干员,
// the 自选/DIY originals) is still registered — its id stays valid on the wire and for SP_MODS — but 凛霜 was removed, so
// it owns nothing and its switch is HIDDEN: the window must render exactly one row, for the mod that still has content.
//
// The data store reads the real data/ files from disk (like the other UI tests), so the assertions are about the real
// build and the real 72-operator pool (0.2.3 adds 克莱门莎).
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const load = (f) => JSON.parse(readFileSync(path.join(ROOT, 'data', f), 'utf8'));

globalThis.fetch = async (url) => {
  const name = String(url).split('/').pop();
  try {
    const body = readFileSync(path.join(ROOT, 'data', name), 'utf8');
    return { ok: true, status: 200, json: async () => JSON.parse(body) };
  } catch {
    return { ok: false, status: 404, json: async () => ({}) };
  }
};

const { data } = await import('../../public/js/data.js');
const { MOD_IDS, VISIBLE_MOD_IDS, CUSTOM_OPS_MOD, CUSTOM_FIXED_MOD, MODS } = await import('../../shared/mods.js');
const { diySlotList, pickOptions } = await import('../../public/js/ui/diyModel.js');
const { KITTED_CHARS } = await import('../../server/sim/content/kits/index.js');
const { ModsPanel } = await import('../../public/js/ui/mods.js');
const { setLang, setMessages } = await import('../../shared/i18n.js');

const BACKUPS = load('backups.json');
/** The shipped English pack (the msgids the picker shows). */
const EN = JSON.parse(readFileSync(path.join(ROOT, 'public/i18n/en.json'), 'utf8'));
/** The 固定 operator of this build — the only content any mod still owns. */
const FIXED = 'char_9002_yana';
const FIXED_CHESS = ['chess_char_3_22_a', 'chess_char_3_22_b'];
/** The removed 自选 original operator: gone from the build, but its id stays a registered mod id. */
const RIME = 'char_9001_rime';
const T6A = 'chess_char_6_diy1_a';

/** The 自选 model's data view, exactly as screens/diy.js builds it. */
const diyData = () => ({ chess: data.get('chess'), backups: data.get('backups') });

/** The unit record of an operator in the current (filtered) backups view — how the UI reads a body. */
const unitOf = (id) => data.get('backups').units[id];

// ---- component helpers (the same expansion the other UI suites use) ----------------------------------------------
function* walk(v) {
  if (Array.isArray(v)) { for (const x of v) yield* walk(x); return; }
  if (!v || typeof v !== 'object') return;
  yield v;
  yield* walk(v.props?.children);
}
/** Render a component tree one level of function components deep at a time (htm vnodes with function types). */
function expand(v, depth = 6) {
  if (Array.isArray(v)) return v.map((x) => expand(x, depth));
  if (!v || typeof v !== 'object') return v;
  if (typeof v.type === 'function' && depth > 0) {
    try { return expand(v.type(v.props || {}), depth - 1); } catch { return v; }
  }
  const children = v.props?.children;
  return children === undefined ? v : { ...v, props: { ...v.props, children: expand(children, depth) } };
}
const textOf = (v) => [...walk(v)].flatMap((n) => (Array.isArray(n.props?.children) ? n.props.children : [n.props?.children]))
  .filter((x) => typeof x === 'string' || typeof x === 'number').join('');
/** Every button of the tree (the rows are buttons with role="switch"). */
const buttonsOf = (v) => [...walk(v)].filter((n) => n.type === 'button');
const classOf = (v) => (typeof v?.props?.class === 'string' ? v.props.class : '');

describe('the client filters its data by the room\'s mods', () => {
  test('all mods on (no room yet): the 固定 operator is in the pool, as the build has it', async () => {
    data.setMods(null);
    await data.loadAll('chess', 'backups', 'assets');
    const pool = data.get('backups').diy.ownedPool;
    assert.equal(pool.length, BACKUPS.diy.ownedPool.length);
    assert.ok(pool.includes('char_112_siege'), 'an official 自选 operator is offered');
    assert.ok(Object.hasOwn(data.get('chess'), FIXED_CHESS[0]), 'the 固定 operator is in the shop pool');
  });

  test('with custom-fixed off the client drops the 固定 operator\'s art alias (its chess rows are the server\'s job)', async () => {
    // The client store filters exactly the files it can: `backups` / `assets` (public/js/data.js modView). The 固定
    // operator's CHESS records live in data/chess.json, which the client does not filter — the server does, through
    // dataFor(room) (asserted in test/mods.test.js). This test pins both sides of that boundary.
    data.setMods([CUSTOM_OPS_MOD]);   // 固定干员 off
    assert.equal(data.get('assets').chars[FIXED], undefined, 'its art alias is gone (the client filters assets)');
    assert.ok(Object.hasOwn(data.get('chess'), FIXED_CHESS[0]), 'the raw chess table is the server\'s to filter');
    // the official pool is untouched
    assert.equal(data.get('backups').diy.ownedPool.length, 72);
    assert.ok(data.get('backups').diy.ownedPool.includes('char_112_siege'), 'an official operator is still there');
    assert.ok(unitOf('char_112_siege'), 'and its body resolves');
  });

  test('the 自选 picker lists only kitted operators: the removed original is never offered', async () => {
    const list = () => pickOptions(T6A, {}, diyData(), KITTED_CHARS).map((o) => o.charId);
    data.setMods(null);
    assert.ok(!list().includes(RIME), '凛霜 has no kit file any more');
    assert.ok(list().includes('char_112_siege'), 'an official 自选 operator is still listed');
    data.setMods([CUSTOM_OPS_MOD]);
    assert.ok(!list().includes(RIME), 'and it stays absent with custom-fixed off');
    // the slot itself is still there: only the operator left
    assert.ok(diySlotList(diyData()).length > 0);
  });

  test('the filtered view follows the switch back and forth, and the subscribers are notified', async () => {
    let notified = 0;
    const off = data.subscribe((name) => { if (name === 'assets') notified++; });
    data.setMods([CUSTOM_OPS_MOD]);
    assert.equal(data.get('assets').chars[FIXED], undefined, 'off: the alias is dropped');
    data.setMods(null);
    assert.ok(data.get('assets').chars[FIXED], 'on: the alias is back');
    off();
    assert.ok(notified >= 1, 'the UI re-renders on a switch');
  });

  test('setMods is a no-op when the enabled set did not change (a repeated room.state never re-renders)', () => {
    data.setMods(null);
    assert.equal(data.setMods([...MOD_IDS]), false, 'an explicit all-on list means the same as nothing said');
    assert.equal(data.setMods(null), false);
    assert.equal(data.setMods([]), true);
    assert.equal(data.setMods([]), false, 'the same list twice changes nothing');
    assert.equal(data.setMods(null), true, 'back to every mod on');
    assert.deepEqual(data.mods(), MOD_IDS);
    assert.deepEqual(data.disabledMods(), []);
    assert.equal(data.modOn(CUSTOM_FIXED_MOD), true);
  });

  test('the raw getter is filtered too (a screen reading getRaw must not see switched-off content)', () => {
    data.setMods([CUSTOM_OPS_MOD]);
    assert.equal(data.getRaw('assets').chars[FIXED], undefined, 'off: the raw view drops it too');
    data.setMods(null);
    assert.ok(data.getRaw('assets').chars[FIXED], 'on: back');
  });
});

describe('the mod switch on screen (ui/mods.js menu)', () => {
  test('it renders one row per VISIBLE mod — the hidden 自制干员 has none', () => {
    const tree = expand(ModsPanel({ selected: MOD_IDS, onToggle() {} }));
    const rows = buttonsOf(tree).filter((b) => b.props.role === 'switch');
    assert.equal(rows.length, VISIBLE_MOD_IDS.length, 'one row per visible mod');
    assert.equal(rows.length, 1, 'only custom-fixed still has content');
    for (const id of VISIBLE_MOD_IDS) {
      const name = MODS[id].name;
      const row = rows.find((b) => textOf(b).includes(name));
      assert.ok(row, `${id}: a row named ${name}`);
      assert.equal(row.props['aria-checked'], 'true', `${id}: on`);
      assert.ok(classOf(row).includes('is-on'));
    }
    // the hidden mod's name never reaches the window
    assert.ok(!textOf(tree).includes(MODS[CUSTOM_OPS_MOD].name), 'the hidden 自制干员 row is not rendered');
    assert.ok(textOf(tree).includes('启用'), 'the state word is the enabled one');
  });

  test('a mod off is a row that reads off, and a read-only picker still shows the state', () => {
    const off = expand(ModsPanel({ selected: [], onToggle() {} }));
    const rows = buttonsOf(off).filter((b) => b.props.role === 'switch');
    assert.equal(rows.length, VISIBLE_MOD_IDS.length, 'every visible mod is still listed when off (the switch stays visible)');
    for (const row of rows) {
      assert.equal(row.props['aria-checked'], 'false');
      assert.ok(!classOf(row).includes('is-on'));
    }
    assert.ok(textOf(off).includes('停用'), 'the off word');
    // read-only (a guest in the room): the rows are disabled but keep the state
    const ro = expand(ModsPanel({ selected: [], readOnly: true }));
    for (const row of buttonsOf(ro).filter((b) => b.props.role === 'switch')) {
      assert.equal(row.props.disabled, true, 'a guest cannot switch content');
    }
  });

  test('toggling a row reports its mod id (the id the wire and the registry use)', () => {
    const seen = [];
    const tree = expand(ModsPanel({ selected: [], onToggle: (id) => seen.push(id) }));
    const rows = buttonsOf(tree).filter((b) => b.props.role === 'switch');
    for (const row of rows) row.props.onClick();
    assert.deepEqual(seen, VISIBLE_MOD_IDS, 'every visible row reports its own id, in registry order');
  });

  test('the labels are translated (English shows the pack, not the Chinese msgid)', () => {
    // the msgids are resolved through t(); switching the language must change what the row shows
    setLang('zh');
    const zh = textOf(expand(ModsPanel({ selected: MOD_IDS })));
    setMessages('en', EN);
    setLang('en');
    try {
      const english = textOf(expand(ModsPanel({ selected: MOD_IDS })));
      assert.notEqual(english, zh, 'the English pack changes the row');
      assert.ok(english.includes(EN[MODS[CUSTOM_FIXED_MOD].name]), `the English name (${EN[MODS[CUSTOM_FIXED_MOD].name]})`);
    } finally { setLang('zh'); setMessages('en', {}); }
  });

  test('flipping a row changes the WINDOW itself, not just the caller (reported 2026-10-09: the row never moved)', async () => {
    // The bug: the window kept the list it was opened with, and a click only called the screen's callback — so the row
    // the user clicked stayed on 停用 and the switch looked dead. The window now owns the flip and hands the caller the
    // whole next list. This asserts the state the WINDOW renders after a click, which is what the user sees.
    const { modsStore, openMods, closeMods, toggleModInWindow } = await import('../../public/js/ui/mods.js');
    const calls = [];
    openMods({ selected: [], onToggle: (id, next) => calls.push([id, [...next]]) });

    // the row starts off…
    const before = expand(ModsPanel({ selected: modsStore.get().selected }));
    assert.equal(buttonsOf(before).find((b) => b.props.role === 'switch').props['aria-checked'], 'false');

    // …clicking it flips the WINDOW's own state…
    toggleModInWindow(CUSTOM_FIXED_MOD);
    assert.deepEqual([...modsStore.get().selected], [CUSTOM_FIXED_MOD], 'the window changed');
    const after = expand(ModsPanel({ selected: modsStore.get().selected }));
    const row = buttonsOf(after).find((b) => b.props.role === 'switch');
    assert.equal(row.props['aria-checked'], 'true', 'the row now reads on');
    assert.ok(classOf(row).includes('is-on'), 'and is styled as on');

    // …and reports the whole next list to the caller (which stores / sends it, never recomputes it)
    assert.deepEqual(calls, [[CUSTOM_FIXED_MOD, [CUSTOM_FIXED_MOD]]]);
    // and it flips back
    toggleModInWindow(CUSTOM_FIXED_MOD);
    assert.deepEqual([...modsStore.get().selected], []);
    assert.deepEqual(calls[1], [CUSTOM_FIXED_MOD, []]);

    // read-only (a guest) and a busy window refuse the flip
    openMods({ selected: [], readOnly: true, onToggle: () => calls.push(['GUEST', null]) });
    toggleModInWindow(CUSTOM_FIXED_MOD);
    assert.deepEqual([...modsStore.get().selected], [], 'a guest cannot flip');
    assert.ok(!calls.some((c) => c[0] === 'GUEST'), 'and the caller is not told');
    closeMods();
  });

  test('a refused flip reverts the window (server says ROOM_STARTED → the row goes back)', async () => {
    // The window flips optimistically, so a refusal must be rolled back or it would keep showing a switch that did not
    // take. The room screen does this in its catch (syncModsWindow(room.mods)); this asserts the store side of it.
    const { modsStore, openMods, closeMods, syncModsWindow } = await import('../../public/js/ui/mods.js');
    const real = [CUSTOM_FIXED_MOD];                     // what the room really has (locked: the match started)
    openMods({ room: true, selected: real, onToggle() {} });
    modsStore.set({ selected: [] });                     // the optimistic flip the window made on the click
    assert.deepEqual([...modsStore.get().selected], [], 'optimistic');
    syncModsWindow(real);                                // the catch: the server refused, put it back
    assert.deepEqual([...modsStore.get().selected], real, 'reverted to the room');
    closeMods();
  });

  test('the switches live in a WINDOW, never inline in the room bar (a third mod would overflow it)', () => {
    // Regression guard for a layout bug found on 2026-10-09: the switches were first drawn inline in the room's bottom
    // bar, which is a FIXED 1.5rem with no overflow — a row is ~0.58rem, so from the THIRD mod on they spilled out of
    // the bar and covered the 开始模拟 button. (With one mod it looked fine, which is why it shipped that way.) The menu
    // is bounded by the viewport instead (Modal's body scrolls), so any number of mods fits.
    const roomCss = readFileSync(path.join(ROOT, 'public/css/screens/room.css'), 'utf8');
    const roomJs = readFileSync(path.join(ROOT, 'public/js/screens/room.js'), 'utf8');
    const lobbyJs = readFileSync(path.join(ROOT, 'public/js/screens/lobby.js'), 'utf8');

    // the bar is a single row of fixed MINIMUM height that grows with its content: the reason the menu exists at all.
    // (It used to be a hard `height: 1.5rem`, which clipped its own content as soon as the left cluster needed a second
    // line — see the 2026-10-11 mobile fix in the same stylesheet. The menu is still the only place mod rows live.)
    assert.match(roomCss, /\.room-bar\s*\{[^}]*min-height:\s*1\.5rem/s, 'the room bar keeps a 1.5rem minimum height');
    assert.ok(!/\.room-bar\s*\{[^}]*[^-]height:\s*1\.5rem/s.test(roomCss), 'the room bar is never a fixed height again');
    // neither screen renders the MOD rows inline: they open the window (a button), not a list of switches.
    // (A non-mod switch in the bar — the 0.2.2 「AI 队友最后选择」 toggle — is a single row and not what this guards.)
    for (const [file, src] of [['room.js', roomJs], ['lobby.js', lobbyJs]]) {
      assert.ok(!/class="mod-row"/.test(src) && !/VISIBLE_MOD_IDS\.map|MOD_IDS\.map/.test(src), `${file}: no inline mod switches (the rows live in ui/mods.js)`);
      assert.match(src, /from '\.\.\/ui\/mods\.js'/, `${file}: imports the menu`);
    }
    assert.ok(roomJs.includes('<${ModsButton}'), 'the room bar has the menu trigger');
    assert.ok(lobbyJs.includes('<${ModsButton}'), 'the lobby has the menu trigger');
    assert.ok(!/class="mod-picker/.test(roomCss), 'the removed inline picker CSS is gone');
    // the window's own body is the scrollable thing, so any number of mods fits
    const menuJs = readFileSync(path.join(ROOT, 'public/js/ui/mods.js'), 'utf8');
    assert.match(menuJs, /ModsPanel[\s\S]*VISIBLE_MOD_IDS\.map/, 'the panel iterates the VISIBLE registry (a new mod needs no UI change)');
  });

  test('the menu is openable imperatively and reports the store it opened with', async () => {
    const { modsStore, openMods, closeMods, syncModsWindow } = await import('../../public/js/ui/mods.js');
    closeMods();
    assert.equal(modsStore.get().open, false);
    openMods({ room: true, selected: [], readOnly: true, onToggle() {} });
    const s = modsStore.get();
    assert.equal(s.open, true);
    assert.equal(s.room, true);
    assert.equal(s.readOnly, true);
    assert.deepEqual([...s.selected], [], 'null / absent means the defaults; an explicit list is kept');
    // a room.state push updates an open window (the host's own change, or another client's)
    syncModsWindow(MOD_IDS);
    assert.deepEqual([...modsStore.get().selected], MOD_IDS);
    // …but only while it describes a room: a lobby-opened window is the local preference, not the server's
    openMods({ selected: MOD_IDS });
    syncModsWindow([]);
    assert.deepEqual([...modsStore.get().selected], MOD_IDS, 'a lobby window is not overwritten by room state');
    closeMods();
    assert.equal(modsStore.get().open, false);
  });
});

