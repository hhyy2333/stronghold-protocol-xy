// test/ui/roomBrowser.test.js — 房间一览 on the CLIENT (public/js/ui/roomBrowser.js; DESIGN §30, docs/design/rooms.md).
//
// The browser is a pure view of ONE store slice (`lobbyStats`), which main.js fills from BOTH the `lobby.stats` push and
// the answer to `room.list` — so these tests drive it exactly the way the app does: write the slice, expand the tree.
//
// Rendering is the same one-level-at-a-time expansion the other UI suites use (test/ui/mods-ui.test.js,
// test/ui/testArena.test.js). roomBrowser.js reads the store through a useStore-that-degrades-to-store.get() helper, so a
// plain expansion renders the real component instead of an empty tree (see the note on useSlice in the module).
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
/** The shipped English pack: the msgids these components show must resolve through it. */
const EN = JSON.parse(readFileSync(path.join(ROOT, 'public/i18n/en.json'), 'utf8'));

const { store } = await import('../../public/js/store.js');
const { net } = await import('../../public/js/net.js');
const { RoomBrowser, RoomCard } = await import('../../public/js/ui/roomBrowser.js');
const { setLang, setMessages } = await import('../../shared/i18n.js');

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
const nodes = (v) => [...walk(v)];
const textOf = (v) => nodes(v).flatMap((n) => (Array.isArray(n.props?.children) ? n.props.children : [n.props?.children]))
  .filter((x) => typeof x === 'string' || typeof x === 'number').join(' ');
const classOf = (n) => (typeof n?.props?.class === 'string' ? n.props.class : '');
const cardsOf = (v) => nodes(v).filter((n) => classOf(n).split(/\s+/).includes('rb-card'));

/** A room summary exactly as server/lobby.js publicRooms() builds one. */
const room = (over = {}) => ({
  code: 'K7Q2', mode: 'coop', difficulty: 'NORMAL', visibility: 'public',
  hostName: '阿米娅', hostId: 'P-host', humans: 2, seats: 4, spectators: 0,
  inMatch: false, test: false, mods: [], createdAt: 1000, seq: 1, ...over,
});

/** Put a lobby snapshot in the store, the way main.js applyLobbyStats does. */
const put = (over = {}) => store.set({
  lobbyStats: { online: 3, listedTotal: 0, totalRooms: 0, matches: 0, rooms: [], at: 0, ...over },
});

/** Run fn with net.request replaced; collects [type, fields] and restores the prototype method afterwards. */
async function withNet(impl, fn) {
  const had = Object.hasOwn(net, 'request');
  const orig = net.request;
  const calls = [];
  net.request = (t, f) => { calls.push([t, f]); return impl ? impl(t, f) : Promise.resolve({ ok: true }); };
  try { await fn(calls); } finally {
    if (had) net.request = orig; else delete net.request;
  }
}

describe('房间一览: the list', () => {
  test('an empty list renders the empty note, not a blank panel', () => {
    put({ rooms: [], listedTotal: 0 });
    const tree = expand(RoomBrowser({}));
    assert.equal(textOf(tree).includes('暂无公开同盟房间'), true, 'the empty note');
    assert.ok(nodes(tree).some((n) => classOf(n).split(/\s+/).includes('rb-empty')), 'class="rb-empty"');
    assert.equal(cardsOf(tree).length, 0, 'no cards');
  });

  test('a public room renders its code, host, difficulty, seats and state', () => {
    put({ rooms: [room()], listedTotal: 1 });
    const tree = expand(RoomBrowser({}));
    const text = textOf(tree);
    assert.equal(cardsOf(tree).length, 1, 'one card');
    assert.ok(text.includes('K7Q2'), 'the room code');
    assert.ok(text.includes('阿米娅'), 'the host name');
    assert.ok(text.includes('险境模拟'), 'the difficulty via DIFFICULTY_NAMES + DifficultyTag');
    assert.ok(text.includes('人数'), 'the t(\'人数\') label');
    assert.ok(text.includes('等待中'), 'a waiting room says 等待中');
    assert.ok(!text.includes('进行中'), 'and never 进行中');
  });

  test('the card carries the data-* hooks the integration and these tests rely on', () => {
    put({ rooms: [room({ code: 'AB12', humans: 3, visibility: 'public', inMatch: true })], listedTotal: 1 });
    const card = cardsOf(expand(RoomBrowser({})))[0];
    assert.equal(card.props['data-code'], 'AB12');
    assert.equal(card.props['data-visibility'], 'public');
    assert.equal(card.props['data-humans'], 3);
    assert.equal(card.props['data-inmatch'], 'true');
  });

  test('the head shows the heading, the listed total and a manual refresh that asks the server', async () => {
    put({ rooms: [room()], listedTotal: 7 });
    const tree = expand(RoomBrowser({}));
    assert.ok(textOf(tree).includes('公开同盟'), 'the heading');
    assert.ok(textOf(tree).includes('7'), 'the listed count, not the array length (the list can be capped)');
    assert.ok(nodes(tree).some((n) => classOf(n).includes('rb-refresh')), 'class="rb-refresh"');
    // the refresh is a backstop: it must issue the one request that answers with data
    await withNet(undefined, async (calls) => {
      const btn = nodes(tree).find((n) => classOf(n).includes('rb-refresh'));
      btn.props.onClick();
      await Promise.resolve();
      assert.deepEqual(calls, [['room.list', undefined]], 'room.list, and nothing else');
    });
  });

  test('a rejected refresh is swallowed (the push is the mechanism, the button only a backstop)', async () => {
    put({ rooms: [room()] });
    const tree = expand(RoomBrowser({}));
    await withNet(() => Promise.reject(new Error('OFFLINE')), async () => {
      nodes(tree).find((n) => classOf(n).includes('rb-refresh')).props.onClick();
      await Promise.resolve();
      await Promise.resolve();
    });
    assert.ok(true, 'no unhandled rejection escaped');
  });

  test('a malformed frame cannot blank the panel (defensive reads)', () => {
    store.set({ lobbyStats: { online: null, listedTotal: undefined, rooms: [null, 'x', room()], at: 0 } });
    const tree = expand(RoomBrowser({}));
    assert.equal(cardsOf(tree).length, 1, 'only the well-formed summary draws');
    assert.ok(textOf(tree).includes('暂无公开同盟房间') === false, 'the list is not empty');
  });
});

describe('房间一览: the two actions a card offers', () => {
  test('a waiting room offers 加入 and not 观战', () => {
    put({ rooms: [room({ inMatch: false })] });
    const tree = expand(RoomBrowser({}));
    assert.ok(nodes(tree).some((n) => classOf(n).includes('rb-join')), 'class="rb-join"');
    assert.ok(!nodes(tree).some((n) => classOf(n).includes('rb-spectate')), 'no 观战');
    assert.ok(textOf(tree).includes('加入'), 'the 加入 label');
  });

  test('a room in a match offers only 观战 — its seats are gone and the match is under way', () => {
    put({ rooms: [room({ inMatch: true })] });
    const tree = expand(RoomBrowser({}));
    assert.ok(nodes(tree).some((n) => classOf(n).includes('rb-spectate')), 'class="rb-spectate"');
    assert.ok(!nodes(tree).some((n) => classOf(n).includes('rb-join')), '加入 is not offered');
    assert.ok(textOf(tree).includes('进行中'), 'the live state is stated');
  });

  test('the actions report the room code to their own callback', () => {
    const joined = [];
    const spectated = [];
    put({ rooms: [room({ code: 'Z9Y8' }), room({ code: 'W1X2', inMatch: true })] });
    const tree = expand(RoomBrowser({ onJoin: (c) => joined.push(c), onSpectate: (c) => spectated.push(c) }));
    nodes(tree).find((n) => classOf(n).includes('rb-join')).props.onClick();
    nodes(tree).find((n) => classOf(n).includes('rb-spectate')).props.onClick();
    assert.deepEqual(joined, ['Z9Y8'], 'the waiting room, by code');
    assert.deepEqual(spectated, ['W1X2'], 'the running room, by code');
  });

  test('without callbacks the buttons are inert rather than a crash', () => {
    put({ rooms: [room(), room({ code: 'W1X2', inMatch: true })] });
    const tree = expand(RoomBrowser({}));
    assert.doesNotThrow(() => nodes(tree).find((n) => classOf(n).includes('rb-join')).props.onClick());
    assert.doesNotThrow(() => nodes(tree).find((n) => classOf(n).includes('rb-spectate')).props.onClick());
  });

  test('the card itself is renderable alone (the lobby reuses it)', () => {
    const tree = expand(RoomCard({ room: room({ code: 'AB12' }), onJoin() {} }));
    assert.equal(cardsOf(tree)[0].props['data-code'], 'AB12');
  });
});

describe('房间一览: the labels are translated', () => {
  test('the browser follows the language pack', () => {
    put({ rooms: [], listedTotal: 0 });
    setLang('zh');
    const zh = textOf(expand(RoomBrowser({})));
    assert.ok(zh.includes('暂无公开同盟房间'), 'Chinese by default');
    try {
      // setLang() alone only switches the language: the pack has to be loaded, exactly as main.js does it
      setMessages('en', EN);
      setLang('en');
      const en = textOf(expand(RoomBrowser({})));
      assert.notEqual(en, zh, 'the pack changes the rendered text');
      assert.ok(!en.includes('暂无公开同盟房间'), 'the msgid is not shown in English');
      assert.ok(en.includes(EN['暂无公开同盟房间']), `the English value (${EN['暂无公开同盟房间']})`);
    } finally { setLang('zh'); setMessages('en', {}); }
  });
});
