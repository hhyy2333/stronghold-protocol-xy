// test/ui/roomVisibility.test.js — the 公开 / 私密 switch (public/js/ui/roomBrowser.js VisibilityToggle; DESIGN §30,
// docs/design/rooms.md). This is the feature's one rule that may not be softened, so it is asserted hardest here:
//
//   `room.create` ALWAYS makes a 私密 room (shared/constants.js DEFAULT_ROOM_VISIBILITY; the wire has no visibility
//   field), and `room.state.visibility` is ALWAYS present. So a room screen that has not been flipped MUST read 私密,
//   and the words that claim the listed state (已公开 / 当前为公开…) must not appear anywhere in that tree. A UI that
//   defaulted to 公开 would tell a host their key-only alliance is browsable when it is not — the failure this whole
//   feature exists to prevent.
//
// The switch is NOT optimistic: the label renders `room.visibility` (the server's own field) and the only 已公开 /
// 已设为私密 wording in the module is the confirmation toast, which reports a transition the server accepted. So
// "a refusal reverts the UI" is really "the UI never moved off the server's value" — asserted below, including the
// rejected-request path where a rollback would be needed if the component had flipped locally.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const SRC = readFileSync(path.join(ROOT, 'public/js/ui/roomBrowser.js'), 'utf8');

const { store } = await import('../../public/js/store.js');
const { net } = await import('../../public/js/net.js');
const { VisibilityToggle } = await import('../../public/js/ui/roomBrowser.js');
const { errorLog, clearErrorLog } = await import('../../public/js/diag.js');

// ---- helpers (the same expansion the other UI suites use) ---------------------------------------------------------
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
const buttonsOf = (v) => nodes(v).filter((n) => n.type === 'button');
const toggleOf = (v) => nodes(v).find((n) => classOf(n).split(/\s+/).includes('vis-toggle'));

/** A `room.state` payload as server/lobby.js Room.toState() sends it. */
const roomState = (over = {}) => ({ t: 'room.state', code: 'K7Q2', hostId: 'P-host', mode: 'coop', difficulty: 'NORMAL',
  test: false, inMatch: false, seats: [], spectators: [], ...over });

/** Sign in the store as a given player (me.playerId decides host vs guest). */
const asPlayer = (playerId) => store.set({ me: { playerId, name: '博士', token: null } });

/** Run fn with net.request replaced; collects [type, fields], resolves or rejects per impl. */
async function withNet(impl, fn) {
  const had = Object.hasOwn(net, 'request');
  const orig = net.request;
  const calls = [];
  net.request = (t, f) => { calls.push([t, f]); return impl ? impl(t, f) : Promise.resolve({ ok: true }); };
  try { return await fn(calls); } finally {
    if (had) net.request = orig; else delete net.request;
  }
}

/** Await the microtask queue enough for the request promise chain (.then/.catch) to settle. */
const settle = async () => { for (let i = 0; i < 6; i++) await Promise.resolve(); };

describe('公开 / 私密: the iron rule — a new room is 私密', () => {
  test('visibility="private" reads 私密 and NEVER shows the listed-state words', () => {
    asPlayer('P-host');
    const tree = expand(VisibilityToggle({ room: roomState({ visibility: 'private' }) }));
    const text = textOf(tree);
    assert.equal(toggleOf(tree).props['data-visibility'], 'private', 'the hook the room screen and tests read');
    assert.ok(text.includes('私密'), 'the state word is 私密');
    assert.ok(text.includes('当前为私密：只有知道密钥的博士能加入'), 'the private explanation');
    // the whole point: nothing may claim this room is listed
    assert.ok(!text.includes('已公开'), 'never 已公开 for a private room');
    assert.ok(!text.includes('当前为公开'), 'never the public explanation');
    assert.ok(!text.includes('公开后所有博士都能在房间一览中看到并加入'), 'never the public promise');
  });

  test('an absent or unknown visibility is normalised DOWN to 私密, never up to 公开', () => {
    asPlayer('P-host');
    for (const vis of [undefined, null, '', 'PUBLIC', 'yes', 0, 'listing']) {
      const tree = expand(VisibilityToggle({ room: roomState({ visibility: vis }) }));
      const text = textOf(tree);
      assert.equal(toggleOf(tree).props['data-visibility'], 'private', `visibility=${String(vis)}: normalised to private`);
      assert.ok(!text.includes('已公开'), `visibility=${String(vis)}: no listed claim`);
      assert.ok(text.includes('私密'), `visibility=${String(vis)}: reads 私密`);
    }
  });

  test('a genuinely public room reads 公开 with its own explanation', () => {
    asPlayer('P-host');
    const text = textOf(expand(VisibilityToggle({ room: roomState({ visibility: 'public' }) })));
    assert.ok(text.includes('公开'), 'the public state word');
    assert.ok(text.includes('当前为公开：所有博士都能在房间一览中看到并加入'), 'the public explanation');
    assert.ok(!text.includes('当前为私密'), 'and not the private one');
  });

  test('no room at all renders nothing (there is no honest state to show before room.state)', () => {
    store.set({ room: null });
    asPlayer('P-host');
    assert.equal(VisibilityToggle({}), null);
  });

  test('without an explicit room the component reads store.get().room', () => {
    asPlayer('P-host');
    store.set({ room: roomState({ visibility: 'private' }) });
    const tree = expand(VisibilityToggle({}));
    assert.equal(toggleOf(tree).props['data-visibility'], 'private', 'the store room is used');
  });

  test('the module never defaults to the public state in source (a default is the one fix that would slip through)', () => {
    // a guard on the intent itself: the only place a bare 'public' may appear is a comparison against the wire value
    assert.ok(!/visibility\s*(?:\?\?|\|\|)\s*'public'/.test(SRC), 'no `?? \'public\'` / `|| \'public\'` default');
    assert.ok(!/\bpublic\b\s*:\s*true/.test(SRC), 'no public-by-default flag');
    assert.match(SRC, /ROOM_VISIBILITY\.PUBLIC \? ROOM_VISIBILITY\.PUBLIC : ROOM_VISIBILITY\.PRIVATE/, 'the downward normalisation');
  });
});

describe('公开 / 私密: host vs guest', () => {
  test('a guest gets a read-only statement, no switch at all', () => {
    asPlayer('P-guest');
    const tree = expand(VisibilityToggle({ room: roomState({ hostId: 'P-host', visibility: 'private' }) }));
    assert.equal(buttonsOf(tree).length, 0, 'no button for a non-host');
    assert.ok(nodes(tree).some((n) => classOf(n).includes('is-readonly')), 'marked read-only');
    assert.ok(textOf(tree).includes('仅凭密钥加入'), 'a private room a guest cannot advertise says so');
  });

  test('the host gets the switch and it carries the frozen hooks', () => {
    asPlayer('P-host');
    const tree = expand(VisibilityToggle({ room: roomState({ hostId: 'P-host', visibility: 'private' }) }));
    const btn = buttonsOf(tree)[0];
    assert.ok(btn, 'a button');
    assert.ok(classOf(btn).includes('vis-toggle__btn'), 'class="vis-toggle__btn"');
    assert.equal(btn.props['aria-pressed'], 'false', 'pressed = the room is public');
    assert.equal(btn.props['aria-label'], '切换为公开', 'the label names the transition, not the state');
    assert.ok(textOf(tree).includes('切换为公开'));
  });

  test('an unknown host or a missing playerId is never treated as the host', () => {
    store.set({ me: { playerId: null, name: '', token: null } });
    const tree = expand(VisibilityToggle({ room: roomState({ hostId: 'P-host' }) }));
    assert.equal(buttonsOf(tree).length, 0, 'nobody is the host without an identity');
  });
});

describe('公开 / 私密: the request and its outcome', () => {
  test('a host on a private room asks for public — the exact intent the server expects', async () => {
    asPlayer('P-host');
    const tree = expand(VisibilityToggle({ room: roomState({ hostId: 'P-host', visibility: 'private' }) }));
    await withNet(undefined, async (calls) => {
      buttonsOf(tree)[0].props.onClick();
      await settle();
      assert.deepEqual(calls, [['room.setVisibility', { visibility: 'public' }]], 'private → public');
    });
  });

  test('a host on a public room asks for private', async () => {
    asPlayer('P-host');
    const tree = expand(VisibilityToggle({ room: roomState({ hostId: 'P-host', visibility: 'public' }) }));
    await withNet(undefined, async (calls) => {
      buttonsOf(tree)[0].props.onClick();
      await settle();
      assert.deepEqual(calls, [['room.setVisibility', { visibility: 'private' }]], 'public → private');
    });
  });

  test('the success confirmation is a transition word, and only fires for the value the server took', async () => {
    asPlayer('P-host');
    const seen = [];
    const tree = expand(VisibilityToggle({ room: roomState({ hostId: 'P-host', visibility: 'private' }), onChanged: (v) => seen.push(v) }));
    await withNet(undefined, async (calls) => {
      buttonsOf(tree)[0].props.onClick();
      await settle();
      assert.deepEqual(seen, ['public'], 'onChanged reports the new value');
      assert.deepEqual(calls.map(([t]) => t), ['room.setVisibility']);
    });
  });

  test('a refused flip leaves the label on the server value and reports the error (no optimistic move to revert)', async () => {
    asPlayer('P-host');
    const seen = [];
    clearErrorLog();
    const tree = expand(VisibilityToggle({ room: roomState({ hostId: 'P-host', visibility: 'private' }), onChanged: (v) => seen.push(v) }));
    await withNet(() => Promise.reject(Object.assign(new Error('only the host'), { code: 'NOT_HOST' })), async () => {
      buttonsOf(tree)[0].props.onClick();
      await settle();
    });
    // the component rendered from room.visibility, which never changed: the tree still says 私密 with no listed claim
    assert.ok(textOf(tree).includes('私密'), 'still 私密 after the refusal');
    assert.ok(!textOf(tree).includes('已公开'), 'no listed claim after the refusal');
    assert.deepEqual(seen, [], 'onChanged is not called for a refusal');
    assert.ok(errorLog().some((e) => e.source === 'request'), 'the error reached the diagnostics log via toastError');
    // and re-rendering against the server's unchanged room keeps that honesty
    assert.equal(toggleOf(expand(VisibilityToggle({ room: roomState({ hostId: 'P-host', visibility: 'private' }) }))).props['data-visibility'], 'private');
  });

  test('the request is only sent by a host tap — a guest cannot reach the intent', () => {
    asPlayer('P-guest');
    let sent = 0;
    const had = Object.hasOwn(net, 'request');
    const orig = net.request;
    net.request = () => { sent++; return Promise.resolve({ ok: true }); };
    try {
      const tree = expand(VisibilityToggle({ room: roomState({ hostId: 'P-host', visibility: 'private' }) }));
      for (const b of buttonsOf(tree)) b.props.onClick();
      assert.equal(sent, 0, 'no request without a host switch');
    } finally { if (had) net.request = orig; else delete net.request; }
  });
});
