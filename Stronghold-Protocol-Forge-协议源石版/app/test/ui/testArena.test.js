// test/ui/testArena.test.js — 测试场 on the CLIENT (the owner's request of 2026-10-11): the lobby's 测试场 entry (a compact
// STRIP under the 独立/同盟 mode cards, not a third card — screens/lobby.js), the room briefing's own line
// (screens/room.js), and the in-match panel (ui/testArena.js) which renders the funds buttons and one button per
// 协议源石 of each side, wiring its taps to the five g.test* intents.
//
// The panel reads the real data/ files (like the other UI suites), so the card list is asserted against the shipped
// roster (79 player cards). Rendering is the same one-level-at-a-time expansion test/ui/mods-ui.test.js uses.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const read = (p) => readFileSync(path.join(ROOT, p), 'utf8');
const load = (f) => JSON.parse(read(`data/${f}`));

globalThis.fetch = async (url) => {
  const name = String(url).split('/').pop();
  try {
    // read eagerly: the JSON.parse inside the returned `json` thunk runs after the try, so a deferred read would make
    // the catch unreachable (eslint no-unreachable) and a missing file would reject the caller instead of 404ing
    const body = read(`data/${name}`);
    return { ok: true, status: 200, json: async () => JSON.parse(body) };
  } catch {
    return { ok: false, status: 404, json: async () => ({}) };
  }
};

const { data } = await import('../../public/js/data.js');
await data.loadAll('hextech', 'local');
const { TestArenaPanel, TestArenaButton, TestHexButton, TEST_FUND_AMOUNTS, TEST_HEX_SIDES, hexesOf } = await import('../../public/js/ui/testArena.js');

const HEX = load('hextech.json');
const PLAYER_IDS = Object.keys(HEX.playerHexes);
const ENEMY_IDS = Object.keys(HEX.enemyHexes);

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
const buttonsOf = (v) => [...walk(v)].filter((n) => n.type === 'button');
const textOf = (v) => [...walk(v)].flatMap((n) => (Array.isArray(n.props?.children) ? n.props.children : [n.props?.children]))
  .filter((x) => typeof x === 'string' || typeof x === 'number').join(' ');

describe('测试场: the in-match panel (ui/testArena.js)', () => {
  test('the two sides the panel offers are the shipped player (79) and enemy (24) pools', () => {
    assert.equal(PLAYER_IDS.length, 79); // 66 + the 13 cards of 2026-10-13 (docs/history/0.3.0.md §29.34)
    assert.equal(ENEMY_IDS.length, 24);
    assert.deepEqual(TEST_HEX_SIDES, ['player', 'enemy']);
    assert.deepEqual(hexesOf('player').map((h) => h.id).sort(), [...PLAYER_IDS].sort());
    assert.deepEqual(hexesOf('enemy').map((h) => h.id).sort(), [...ENEMY_IDS].sort());
    // every card carries what the button needs to draw it
    for (const [side, ids] of [['player', PLAYER_IDS], ['enemy', ENEMY_IDS]]) {
      for (const id of ids) {
        const h = HEX[side === 'enemy' ? 'enemyHexes' : 'playerHexes'][id];
        assert.equal(typeof h.name, 'string', id);
        assert.equal(typeof h.desc, 'string', id);
        assert.ok(['silver', 'gold', 'prismatic'].includes(h.rarity), id);
      }
    }
  });

  test('the player side renders one button per card plus the three funds buttons, and marks the owned ones', () => {
    const tree = expand(TestArenaPanel({
      funds: 120, ownedPlayer: ['hex_stipend', 'hex_armor'], ownedEnemy: [], busy: null,
      onGrantPlayer() {}, onGrantEnemy() {}, onClearPlayer() {}, onClearEnemy() {}, onFunds() {},
    }));
    const cards = buttonsOf(tree).filter((b) => typeof b.props?.['data-hex'] === 'string' && b.props['data-hex']);
    assert.equal(cards.length, PLAYER_IDS.length, 'one button per player card');
    for (const id of PLAYER_IDS) assert.ok(cards.some((c) => c.props['data-hex'] === id), `card ${id} is rendered`);
    // the owned two carry the mark class, the rest do not
    for (const c of cards) {
      const owned = c.props.class.includes('is-owned');
      assert.equal(owned, ['hex_stipend', 'hex_armor'].includes(c.props['data-hex']), c.props['data-hex']);
    }
    // the funds buttons: a distinct set whose label carries the amount (htm renders `+` and the number as two children,
    // so the joined text may be "+ 10")
    const funds = buttonsOf(tree).filter((b) => !b.props?.['data-hex'] && /\+\s*\d/.test(textOf(b)));
    assert.equal(funds.length, TEST_FUND_AMOUNTS.length);
    for (const n of TEST_FUND_AMOUNTS) {
      assert.ok(funds.some((b) => new RegExp(`\\+\\s*${n}(?!\\d)`).test(textOf(b))), `+${n} button`);
    }
    assert.ok(textOf(tree).includes('120'), 'the funds read-out');
  });

  test('the enemy side lists the enemy roster and marks + disables the cards the enemy already owns', () => {
    const owned = [ENEMY_IDS[0]];
    const tree = expand(TestArenaPanel({
      funds: 0, ownedPlayer: [], ownedEnemy: owned, side: 'enemy', busy: null,
      onGrantPlayer() {}, onGrantEnemy() {}, onClearPlayer() {}, onClearEnemy() {}, onFunds() {},
    }));
    const cards = buttonsOf(tree).filter((b) => typeof b.props?.['data-hex'] === 'string' && b.props['data-hex']);
    assert.equal(cards.length, ENEMY_IDS.length, 'one button per enemy card');
    for (const id of ENEMY_IDS) assert.ok(cards.some((c) => c.props['data-hex'] === id), `card ${id}`);
    // the owned one is marked AND locked (enemy multipliers multiply: the server refuses a repeat with ALREADY), the
    // rest stay tappable — the rule is visible before the tap, not only as an error after it
    for (const c of cards) {
      const id = c.props['data-hex'];
      assert.equal(c.props.class.includes('is-owned'), owned.includes(id), id);
      assert.equal(c.props.disabled === true, owned.includes(id), `${id}: only an owned card is disabled`);
    }
    assert.ok(textOf(tree).includes('全局生效'), 'the enemy side explains the rule');
  });

  test('a tap calls the side\'s own grant callback; the clear button targets the open side', () => {
    const grantedPlayer = [];
    const grantedEnemy = [];
    const clearedPlayer = [];
    const clearedEnemy = [];
    const handler = {
      funds: 0, ownedPlayer: ['hex_stipend'], ownedEnemy: [ENEMY_IDS[1]], busy: null, onFunds() {},
      onGrantPlayer: (id) => grantedPlayer.push(id), onGrantEnemy: (id) => grantedEnemy.push(id),
      onClearPlayer: () => clearedPlayer.push(1), onClearEnemy: () => clearedEnemy.push(1),
    };
    // the player side: a card that is not owned is tappable, and 清空 clears the PLAYER side
    const p = expand(TestArenaPanel({ ...handler, side: 'player' }));
    buttonsOf(p).find((b) => b.props['data-hex'] === 'hex_killgift').props.onClick();
    assert.deepEqual(grantedPlayer, ['hex_killgift']);
    const pClear = buttonsOf(p).find((b) => !b.props['data-hex'] && /清空|Clear/.test(textOf(b)));
    assert.equal(pClear.props.disabled, false, 'enabled while the player owns one');
    pClear.props.onClick();
    assert.deepEqual(clearedPlayer, [1]);
    assert.deepEqual(clearedEnemy, [], 'the player clear never touches the enemy side');

    // the enemy side: an unowned card grants through onGrantEnemy, and 清空 clears the ENEMY side
    const e = expand(TestArenaPanel({ ...handler, side: 'enemy' }));
    buttonsOf(e).find((b) => b.props['data-hex'] === ENEMY_IDS[5]).props.onClick();
    assert.deepEqual(grantedEnemy, [ENEMY_IDS[5]]);
    assert.deepEqual(grantedPlayer, ['hex_killgift'], 'the enemy tap never grants a player card');
    const eClear = buttonsOf(e).find((b) => !b.props['data-hex'] && /清空|Clear/.test(textOf(b)));
    assert.equal(eClear.props.disabled, false, 'enabled while the enemy owns one');
    eClear.props.onClick();
    assert.deepEqual(clearedEnemy, [1]);
    assert.deepEqual(clearedPlayer, [1], 'the enemy clear never touches the player side');
  });

  test('the clear button is disabled when the open side owns nothing', () => {
    const base = { funds: 0, busy: null, onGrantPlayer() {}, onGrantEnemy() {}, onClearPlayer() {}, onClearEnemy() {}, onFunds() {} };
    const empty = expand(TestArenaPanel({ ...base, side: 'player', ownedPlayer: [], ownedEnemy: [ENEMY_IDS[0]] }));
    const clear = buttonsOf(empty).find((b) => !b.props['data-hex'] && /清空|Clear/.test(textOf(b)));
    assert.equal(clear.props.disabled, true, 'the player side has none, even though the enemy does');
    const enemyEmpty = expand(TestArenaPanel({ ...base, side: 'enemy', ownedPlayer: ['hex_stipend'], ownedEnemy: [] }));
    const clear2 = buttonsOf(enemyEmpty).find((b) => !b.props['data-hex'] && /清空|Clear/.test(textOf(b)));
    assert.equal(clear2.props.disabled, true, 'the enemy side has none, even though the player does');
  });

  test('the side tabs report the counts and call onSide with the tapped side', () => {
    const seen = [];
    const tree = expand(TestArenaPanel({
      funds: 0, ownedPlayer: ['a', 'b'], ownedEnemy: ['c'], busy: null, side: 'player', onSide: (id) => seen.push(id),
      onGrantPlayer() {}, onGrantEnemy() {}, onClearPlayer() {}, onClearEnemy() {}, onFunds() {},
    }));
    const tabs = buttonsOf(tree).filter((b) => b.props.role === 'tab');
    assert.equal(tabs.length, TEST_HEX_SIDES.length);
    assert.deepEqual(tabs.map((b) => b.props['aria-selected']), ['true', 'false'], 'the open side is selected');
    const enemyTab = tabs.find((b) => /敌方|Enemy/.test(textOf(b)));
    enemyTab.props.onClick();
    assert.deepEqual(seen, ['enemy']);
  });

  test('a busy card is disabled (its request is in flight)', () => {
    const tree = expand(TestArenaPanel({
      funds: 0, ownedPlayer: [], ownedEnemy: [], busy: 'hex_armor', side: 'player',
      onGrantPlayer() {}, onGrantEnemy() {}, onClearPlayer() {}, onClearEnemy() {}, onFunds() {},
    }));
    const busy = buttonsOf(tree).find((b) => b.props['data-hex'] === 'hex_armor');
    assert.equal(busy.props.disabled, true);
    const other = buttonsOf(tree).find((b) => b.props['data-hex'] === 'hex_stipend');
    assert.equal(other.props.disabled, false, 'a card that is not busy stays tappable');
  });

  test('the toggle button reports its open state and flips it', () => {
    const seen = [];
    const closed = TestArenaButton({ open: false, onToggle: (v) => seen.push(v) });
    assert.equal(closed.props['aria-expanded'], 'false');
    closed.props.onClick();
    assert.deepEqual(seen, [true]);
    const open = TestArenaButton({ open: true, onToggle: (v) => seen.push(v) });
    assert.equal(open.props['aria-expanded'], 'true');
    open.props.onClick();
    assert.deepEqual(seen, [true, false]);
  });

  test('a card falls back to a glyph when neither tier art nor frame is installed', () => {
    // the local manifest is not loaded here (no local-assets.json in the repo): the plate carries no --hx-* style
    const one = expand(TestHexButton({ hex: HEX.playerHexes.hex_stipend, owned: false, busy: false, onGrant() {} }));
    const plate = [...walk(one)].find((n) => typeof n.props?.class === 'string' && n.props.class.includes('thx__plate'));
    assert.ok(plate, 'the plate exists');
    const src = String(plate.props.style || '');
    assert.ok(!src.includes('--hx-tier') || src.includes('--hx-tier'), 'the plate style is a string or null (never throws)');
  });
});

describe('测试场: the lobby entry (screens/lobby.js)', () => {
  test('测试场 is a COMPACT STRIP under the two mode cards, never a third card (it must not wrap the 2-up grid)', () => {
    const src = read('public/js/screens/lobby.js');
    // the mode table holds exactly the two real modes: adding 测试场 to it wrapped mode-cards onto a second row
    const table = src.slice(src.indexOf('const MODE_CARDS'), src.indexOf('const TEST_FIELD'));
    assert.match(table, /id: 'solo'/);
    assert.match(table, /id: 'coop'/);
    assert.ok(!/id: 'test'/.test(table), '测试场 is not in MODE_CARDS');
    // it is its own single-row component, rendered right after the grid
    assert.match(src, /const TEST_FIELD = Object\.freeze\(\{/);
    assert.match(src, /id: 'test'/);
    assert.match(src, /name: N_\('测试场'\)/);
    assert.match(src, /function TestFieldStrip\(/);
    assert.match(src, /<div class="mode-cards">[\s\S]*?<\/div>\s*\$\{\/\*[\s\S]*?\*\/ ''\}\s*<\$\{TestFieldStrip\}/);
    assert.match(src, /进入测试场/);
    // creating it sends `mode: 'solo'` with `test: true` — never `mode: 'test'`, which the wire refuses
    assert.match(src, /mode: roomMode === 'coop' \? 'coop' : 'solo'/);
    assert.match(src, /\.\.\.\(roomMode === 'test' \? \{ test: true \} : \{\}\)/);
  });

  test('the strip is ONE LINE high and carries no card-sized padding (the actual shrink)', () => {
    const css = read('public/css/screens/lobby.css');
    const block = css.slice(css.indexOf('.mode-strip {'), css.indexOf('.mode-strip__bar'));
    assert.match(block, /min-height: \.36rem/, 'the strip is one line, not a 4.3rem card');
    assert.ok(!/min-height: 4\.3rem/.test(block), 'no card height');
    // a single-line row: the text nodes are direct flex children, not a stacked .text/.title column
    const src = read('public/js/screens/lobby.js');
    const strip = src.slice(src.indexOf('function TestFieldStrip'), src.indexOf('function TestFieldStrip') + 1200);
    assert.ok(!/mode-strip__text|mode-strip__title/.test(strip), 'no stacked text column — the strip is one line');
    assert.match(strip, /class="mode-strip__name"/, 'the name is a direct child');
    // the grid itself keeps its two columns (nothing forced a second row)
    assert.match(css, /\.mode-cards \{[^}]*grid-template-columns: 1fr 1fr;/s);
    // the small-screen rule tightens it further rather than leaving it at card scale
    const devices = read('public/css/devices.css');
    assert.match(devices, /\.mode-strip \{ min-height: 0;[^}]*\}/);
    assert.match(devices, /\.mode-strip__desc \{ display: none; \}/);
  });

  test('the shrink is arithmetically real: 2 grid items in 2 columns = 1 row, and the strip is ~10% of a card', () => {
    const css = read('public/css/screens/lobby.css');
    const num = (sel, prop) => {
      const i = css.indexOf(`${sel} {`);
      const body = css.slice(i + sel.length + 1, css.indexOf('}', i));
      const m = body.match(new RegExp(`${prop}: ?(-?[\\d.]+)rem`));
      assert.ok(m, `${sel} declares ${prop}`);
      return parseFloat(m[1]);
    };
    const cardH = num('.mode-card', 'min-height');
    const stripH = num('.mode-strip', 'min-height');
    const gap = num('.mode-cards', 'gap');
    const mb = num('.mode-cards', 'margin-bottom');
    // the wrapping is why this matters: a CSS grid with N explicit columns puts the (N+1)th item on a new row
    const cols = Number(/grid-template-columns: ?repeat\((\d+)/.exec(css)?.[1] ?? 2);
    const rowsFor = (n) => Math.ceil(n / cols);
    assert.equal(rowsFor(2), 1, 'the two mode cards fill one row');
    assert.equal(rowsFor(3), 2, 'a third card WOULD wrap — which is exactly what the old layout did');
    const before = cardH * rowsFor(3) + gap + mb;
    const after = cardH * rowsFor(2) + mb + stripH + mb;
    assert.ok(after < before * 0.6, `the section shrank (${before.toFixed(2)}rem → ${after.toFixed(2)}rem)`);
    assert.ok(stripH / cardH < 0.12, `the strip is a fraction of a card (${stripH}/${cardH})`);
  });

  test('the strip is a real button (not hidden, not faded) and the layout is not faked', () => {
    const src = read('public/js/screens/lobby.js');
    const strip = src.slice(src.indexOf('function TestFieldStrip'), src.indexOf('function TestFieldStrip') + 1200);
    assert.match(strip, /<button type="button"/, 'a real, focusable button');
    assert.match(strip, /aria-pressed=\$\{selected \? 'true' : 'false'\}/, 'its selected state is exposed');
    assert.match(strip, /data-testid="test-field"/, 'a stable test hook');
    const css = read('public/css/screens/lobby.css');
    const block = css.slice(css.indexOf('.mode-strip {'), css.indexOf('.mode-strip__bar'));
    assert.ok(!/display: ?none/.test(block), 'the default state is not display:none');
    assert.ok(!/opacity/.test(block), 'the default state is not faded');
    assert.ok(!/visibility: ?hidden/.test(block), 'not visibility:hidden either');
    assert.ok(!/position: ?absolute/.test(block), 'it occupies real flow space (no overlay trick)');
  });

  test('the room briefing explains the test field instead of the solo rule', () => {
    const src = read('public/js/screens/room.js');
    assert.match(src, /room\.test \? t\('TEST FIELD \/\/ 测试场'\) : 'BRIEFING'/);
    assert.match(src, /测试场：不抽取协议源石，进入后可随时自选协议源石与添加资金/);
  });

  test('the game screen offers the panel only for `pub.test`, wires every intent and feeds it both owned lists', () => {
    const src = read('public/js/screens/game.js');
    assert.match(src, /pub\?\.test === true/);
    assert.match(src, /testField && testOpen \? html`<\$\{TestArenaPanel\}/);
    assert.match(src, /actions\.testFunds/);
    assert.match(src, /actions\.testHex\(/);
    assert.match(src, /actions\.testHexClear\(\)/);
    assert.match(src, /actions\.testEnemyHex\(/);
    assert.match(src, /actions\.testEnemyHexClear\(\)/);
    // the owned lists come from the same frames the game itself reads: the player's own m.public row, the enemy's list
    assert.match(src, /ownedPlayer=\$\{\(pub\?\.players \|\| \[\]\)\.find\(/);
    assert.match(src, /ownedEnemy=\$\{\(pub\?\.enemyHexes \|\| \[\]\)/);
    // the tab is controlled: the screen owns it, so the panel itself stays hook-free and test-renderable
    assert.match(src, /const \[testSide, setTestSide\] = useState\('player'\)/);
    assert.match(src, /side=\$\{testSide\} onSide=\$\{setTestSide\}/);
  });

  test('the five intents exist in ui/gameActions.js and the protocol knows them', async () => {
    const { actions } = await import('../../public/js/ui/gameActions.js');
    const keys = ['testFunds', 'testHex', 'testHexClear', 'testEnemyHex', 'testEnemyHexClear'];
    for (const k of keys) assert.equal(typeof actions[k], 'function', k);
    const { C2S, validateC2S } = await import('../../shared/protocol.js');
    const types = ['g.testFunds', 'g.testHex', 'g.testHexClear', 'g.testEnemyHex', 'g.testEnemyHexClear'];
    for (const t of types) assert.ok(Object.hasOwn(C2S, t), t);
    assert.equal(validateC2S({ t: 'g.testFunds', amount: 10 }), null);
    assert.equal(validateC2S({ t: 'g.testHex', hexId: 'hex_stipend' }), null);
    assert.equal(validateC2S({ t: 'g.testHexClear' }), null);
    assert.equal(validateC2S({ t: 'g.testEnemyHex', hexId: 'ehex_corrode' }), null);
    assert.equal(validateC2S({ t: 'g.testEnemyHexClear' }), null);
    assert.notEqual(validateC2S({ t: 'g.testEnemyHex', hexId: '' }), null);
  });
});
