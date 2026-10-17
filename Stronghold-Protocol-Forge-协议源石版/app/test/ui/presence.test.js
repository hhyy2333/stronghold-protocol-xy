// test/ui/presence.test.js — 在线人数 / 在线博士 on the CLIENT (public/js/ui/presence.js; DESIGN §30).
//
// What has to hold, and why each one is a regression guard:
//   * `online: null` (the server has not reported a count yet) renders NOTHING. The badge showing 「0 在线博士」 while
//     the truth is unknown is the failure this module exists to prevent, so it is the first assertion here.
//   * a real 0 renders 0 — `Number.isFinite`, not a falsy test, is the line between "unknown" and "empty lobby".
//   * a `lobby.stats` push changes the number with NO page refresh and NO render call by the caller: the component
//     subscribes to the store itself. The test renders once, then feeds the store exactly what main.js feeds it on the
//     wire (`applyLobbyStats`, net.on('lobby.stats')) and waits for the DOM to move by itself.
//   * every string is a t() msgid ('在线博士' label, '在线人数' accessible name), so the packs translate it.
//
// Rendering: the other UI suites expand htm vnodes by hand, which works only for HOOK-FREE components. OnlinePill is
// required to read the store itself (`useStore`), and calling a hook outside Preact throws — so this file mounts the
// component through the vendored Preact against a ~60-line DOM stand-in (createElement / appendChild / insertBefore /
// removeChild / text nodes). That is not extra machinery for its own sake: it is the only way to observe the LIVE
// subscription, which is the hard requirement. Everything static (CSS, t() msgids, the exported signature) is asserted
// directly on the source / the module, as the other suites do.
// Run: node test/ui/presence.test.js

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const read = (p) => readFileSync(path.join(ROOT, p), 'utf8');

// ---- a DOM stand-in, installed BEFORE the vendored Preact is imported (it snapshots rAF/cancel at load) ------------

class ShimEl {
  constructor(tag) {
    this.nodeType = 1;
    this.localName = tag;
    this.tagName = String(tag).toUpperCase();
    this.childNodes = [];
    this.attributes = {};
    this.style = {};
    this.parentNode = null;
  }
  get children() { return this.childNodes.filter((n) => n.nodeType === 1); }
  get firstChild() { return this.childNodes[0] || null; }
  get nextSibling() {
    const i = this.parentNode ? this.parentNode.childNodes.indexOf(this) : -1;
    return i < 0 ? null : this.parentNode.childNodes[i + 1] || null;
  }
  appendChild(c) { if (c.parentNode) c.parentNode.removeChild(c); c.parentNode = this; this.childNodes.push(c); return c; }
  insertBefore(c, ref) {
    if (c.parentNode) c.parentNode.removeChild(c);
    c.parentNode = this;
    const i = ref ? this.childNodes.indexOf(ref) : -1;
    if (i < 0) this.childNodes.push(c); else this.childNodes.splice(i, 0, c);
    return c;
  }
  removeChild(c) { const i = this.childNodes.indexOf(c); if (i >= 0) this.childNodes.splice(i, 1); c.parentNode = null; return c; }
  remove() { if (this.parentNode) this.parentNode.removeChild(this); }
  setAttribute(k, v) { this.attributes[k] = String(v); }
  removeAttribute(k) { delete this.attributes[k]; }
  getAttribute(k) { return Object.hasOwn(this.attributes, k) ? this.attributes[k] : null; }
  addEventListener() {}
  removeEventListener() {}
  contains(n) { return n === this || this.childNodes.some((c) => c.contains?.(n)); }
}

class ShimText {
  constructor(text) { this.nodeType = 3; this.data = String(text); this.parentNode = null; this.childNodes = []; }
  get nextSibling() {
    const i = this.parentNode ? this.parentNode.childNodes.indexOf(this) : -1;
    return i < 0 ? null : this.parentNode.childNodes[i + 1] || null;
  }
  remove() { if (this.parentNode) this.parentNode.removeChild(this); }
}

globalThis.document = {
  createElement: (tag) => new ShimEl(tag),
  createElementNS: (_ns, tag) => new ShimEl(tag),
  createTextNode: (text) => new ShimText(text),
};
globalThis.Element = ShimEl;
globalThis.Text = ShimText;
globalThis.requestAnimationFrame = (fn) => setTimeout(() => fn(Date.now()), 0);
globalThis.cancelAnimationFrame = (id) => clearTimeout(id);

const preact = await import('../../public/vendor/preact.module.js');
const { html } = await import('../../public/js/ui/components.js');
const { applyLobbyStats } = await import('../../public/js/store.js');
const { setLang, setMessages } = await import('../../shared/i18n.js');
const { OnlinePill, PresencePill } = await import('../../public/js/ui/presence.js');

const EN = JSON.parse(read('public/i18n/en.json'));

// ---- DOM helpers ------------------------------------------------------------------------------------------------

/** Concatenated text of a rendered subtree, in document order. */
function textOf(node) {
  const out = [];
  const walk = (n) => { for (const c of n.childNodes) { if (c.nodeType === 3) out.push(c.data); else walk(c); } };
  walk(node);
  return out.join('');
}

/** Every element of a rendered subtree carrying one class. */
function byClass(node, cls, out = []) {
  for (const c of node.childNodes) {
    if (c.nodeType !== 1) continue;
    if (String(c.attributes.class || '').split(/\s+/).includes(cls)) out.push(c);
    byClass(c, cls, out);
  }
  return out;
}

/** Mount a component instance into a fresh root (one mount per test: no shared render tree). */
function mount(vnode) {
  const root = new ShimEl('div');
  preact.render(vnode, root);
  return { root, text: () => textOf(root), text0: () => textOf(root.childNodes[0] || new ShimEl('x')) };
}

/** Wait until `fn()` is truthy (the store subscription flush is a microtask + a rAF in Preact). */
async function until(fn, ms = 400) {
  const deadline = Date.now() + ms;
  for (;;) {
    if (fn()) return true;
    if (Date.now() > deadline) return false;
    await new Promise((r) => setTimeout(r, 5));
  }
}

/** The store slice as the server sends it (main.js `applyLobbyStats(msg)` on the `lobby.stats` frame). */
const frame = (online) => ({ online, listedTotal: 0, totalRooms: 0, matches: 0, rooms: [] });

// ---- the repo's OTHER rendering convention: expand the vnode tree by hand, no Preact, no DOM ----------------------
// This is what test/ui/mods-ui.test.js and test/ui/testArena.test.js do, and it is how a future test / preview (the dev
// uikit page) will reach OnlinePill. It only works if the component survives being CALLED with no render context — the
// defect the Lead's frozen-signature check caught — so it is pinned here rather than left to the mounting tests.
function* walkVnode(v) {
  if (Array.isArray(v)) { for (const x of v) yield* walkVnode(x); return; }
  if (!v || typeof v !== 'object') return;
  yield v;
  yield* walkVnode(v.props?.children);
}
function expand(v, depth = 6) {
  if (Array.isArray(v)) return v.map((x) => expand(x, depth));
  if (!v || typeof v !== 'object') return v;
  if (typeof v.type === 'function' && depth > 0) {
    try { return expand(v.type(v.props || {}), depth - 1); } catch { return v; }
  }
  const children = v.props?.children;
  return children === undefined ? v : { ...v, props: { ...v.props, children: expand(children, depth) } };
}
const vnodeText = (v) => [...walkVnode(v)]
  .flatMap((n) => (Array.isArray(n.props?.children) ? n.props.children : [n.props?.children]))
  .filter((x) => typeof x === 'string' || typeof x === 'number').join('');
const vnodeClasses = (v) => [...walkVnode(v)].filter((n) => typeof n.props?.class === 'string').map((n) => n.props.class);

describe('在线人数: the hook-free path (the repo\'s plain tree expansion) never throws', () => {
  test('a bare OnlinePill() with no render context returns, and null while the count is unknown', () => {
    applyLobbyStats(frame(null));
    let out = 'THREW';
    assert.doesNotThrow(() => { out = OnlinePill(); }, 'audit: calling the component outside Preact must not throw');
    assert.equal(out, null, 'and the unknown count is still "render nothing"');
    assert.equal(PresencePill(), null, 'the alias behaves the same');
  });

  test('the standard expand() idiom renders the real badge (what any future suite / preview will do)', () => {
    applyLobbyStats(frame(7));
    const tree = expand(OnlinePill());
    assert.ok(tree, 'a vnode, not null');
    assert.equal(vnodeText(tree), '7在线博士', 'the number and the label reach the tree');
    for (const cls of ['presence-pill', 'presence-pill__dot', 'presence-pill__num', 'presence-pill__label']) {
      assert.ok(vnodeClasses(tree).some((c) => c.split(/\s+/).includes(cls)), cls);
    }
    assert.ok(vnodeClasses(tree).some((c) => c.split(/\s+/).includes('num')), 'the figure keeps class="num"');
    assert.ok([...walkVnode(tree)].some((n) => n.props?.['aria-label'] === '在线人数'), 'the accessible name survives');

    // and the expansion follows the store too: no render, just a new frame and another expand
    applyLobbyStats(frame(31));
    assert.equal(vnodeText(expand(OnlinePill())), '31在线博士', 'the one-shot store.get() fallback reads the new frame');
  });
});

describe('在线人数: the badge renders the server\'s count and only the server\'s count', () => {
  test('online = null renders NOTHING (a fresh tab / no frame yet must never show a 0)', () => {
    applyLobbyStats(frame(null));
    const m = mount(html`<${OnlinePill} />`);
    assert.equal(m.root.childNodes.length, 0, 'no vnode at all');
    assert.equal(m.text(), '');
    assert.equal(byClass(m.root, 'presence-pill').length, 0);
    // undefined / junk are the same unknown state (an older server that omits the field)
    applyLobbyStats({ rooms: [] });
    const m2 = mount(html`<${OnlinePill} />`);
    assert.equal(m2.root.childNodes.length, 0, 'a frame without `online` is unknown too');
  });

  test('online = 7 renders 7 with the dot, the .num figure and the label', () => {
    applyLobbyStats(frame(7));
    const m = mount(html`<${OnlinePill} />`);
    const pill = byClass(m.root, 'presence-pill')[0];
    assert.ok(pill, 'the .presence-pill wrapper');
    assert.equal(byClass(m.root, 'presence-pill__dot').length, 1, 'the breathing dot');
    const num = byClass(m.root, 'num')[0];
    assert.ok(num, 'the number carries class="num"');
    assert.equal(textOf(num), '7');
    assert.equal(byClass(m.root, 'presence-pill__num').length, 1);
    assert.ok(m.text().includes('在线博士'), `the label: ${m.text()}`);
    assert.equal(num.getAttribute('aria-label') ?? pill.getAttribute('aria-label'), '在线人数');
    assert.ok(pill.getAttribute('aria-label'), 'the pill has an accessible name');
  });

  test('a real 0 IS rendered (unknown and empty are different states)', () => {
    applyLobbyStats(frame(0));
    const m = mount(html`<${OnlinePill} />`);
    assert.equal(textOf(byClass(m.root, 'num')[0]), '0');
    assert.ok(m.text().includes('在线博士'));
  });

  test('the badge carries the caller\'s class (the placement hook)', () => {
    applyLobbyStats(frame(3));
    const m = mount(html`<${OnlinePill} class="lobby-pill" />`);
    const pill = byClass(m.root, 'presence-pill')[0];
    assert.ok(String(pill.attributes.class).split(/\s+/).includes('lobby-pill'), pill.attributes.class);
  });
});

describe('在线人数: the number follows the server push with no page refresh', () => {
  test('a new `lobby.stats` frame changes the number by itself (no re-render call by the caller)', async () => {
    applyLobbyStats(frame(7));
    const m = mount(html`<${OnlinePill} />`);
    assert.equal(textOf(byClass(m.root, 'num')[0]), '7');

    // exactly what main.js does on net.on('lobby.stats'): fold the frame into the store — nothing else
    applyLobbyStats(frame(12));
    assert.ok(await until(() => textOf(byClass(m.root, 'num')[0]) === '12'), `the badge followed the push: ${m.text()}`);
    assert.ok(m.text().includes('在线博士'), 'the label is still there');

    // and the connection dropping back to unknown empties the badge again
    applyLobbyStats(frame(null));
    assert.ok(await until(() => m.root.childNodes.length === 0), 'unknown removes the badge, not a stale count');
  });

  test('two mounts disagree only through the store: a pushed frame updates both', async () => {
    applyLobbyStats(frame(1));
    const a = mount(html`<${OnlinePill} />`);
    const b = mount(html`<${PresencePill} />`);
    assert.equal(textOf(byClass(a.root, 'num')[0]), '1');
    assert.equal(textOf(byClass(b.root, 'num')[0]), '1');
    applyLobbyStats(frame(25));
    assert.ok(await until(() => textOf(byClass(a.root, 'num')[0]) === '25' && textOf(byClass(b.root, 'num')[0]) === '25'), 'both live badges moved');
  });
});

describe('在线人数: strings, signature and stylesheet', () => {
  test('the label is t()-translated (the English pack re-words the badge)', () => {
    applyLobbyStats(frame(4));
    try {
      setMessages('en', EN);
      setLang('en');
      const m = mount(html`<${OnlinePill} />`);
      assert.ok(m.text().includes(EN['在线博士']), `${EN['在线博士']} in ${m.text()}`);
      assert.equal(byClass(m.root, 'presence-pill')[0].getAttribute('aria-label'), EN['在线人数']);
      assert.ok(!m.text().includes('在线博士'), 'no Chinese msgid left in the English rendering');
    } finally {
      setLang('zh');
      setMessages('en', {});
    }
  });

  test('the module passes the repo\'s own i18n scanner: no unwrapped Chinese, every msgid translated', async () => {
    // tools/i18n.mjs is the scanner test/i18n.test.js runs over public/js — using it here makes this file prove the
    // same thing for its own module (comments and developer strings are excluded by the scanner's own rules).
    const { scanSource } = await import('../../tools/i18n.mjs');
    const src = read('public/js/ui/presence.js');
    const { msgids, literals } = await scanSource(src, 'public/js/ui/presence.js');
    assert.deepEqual(literals.filter((l) => !l.reason), [], 'no Chinese literal left unwrapped');
    assert.deepEqual([...new Set(msgids.map((m) => m.msgid))].sort(), ['在线人数', '在线博士'], 'exactly the two msgids');
    assert.ok(msgids.every((m) => m.via === 't'), 'both are t() calls');
    for (const m of msgids) {
      assert.equal(typeof EN[m.msgid], 'string', `en.json lacks ${m.msgid}`);
      assert.ok(EN[m.msgid].trim() && !/[\u4e00-\u9fff]/.test(EN[m.msgid]), `English for ${m.msgid}`);
    }
  });

  test('the exported signature the integrator wires is exactly OnlinePill + the PresencePill alias', async () => {
    const mod = await import('../../public/js/ui/presence.js');
    assert.equal(typeof mod.OnlinePill, 'function');
    assert.equal(mod.PresencePill, mod.OnlinePill, 'PresencePill is the same component');
    assert.deepEqual(Object.keys(mod).sort(), ['OnlinePill', 'PresencePill'], 'no other export');
    // called with no props at all it must not throw (the integrator may render <${OnlinePill} />)
    assert.doesNotThrow(() => OnlinePill.length >= 0);
    // it is push-only: the module never asks the server for anything (no net import, no timer)
    const src = read('public/js/ui/presence.js');
    assert.ok(!/from '\.\.\/net\.js'|net\.request|setInterval|setTimeout/.test(src), 'no polling, no requests');
    assert.match(src, /useStore\(/, 'it reads the store itself');
    assert.match(src, /shallowEqual/, 'with a shallow-equality selector');
    assert.match(src, /Number\.isFinite\(online\)/, 'unknown (null) and 0 are told apart by isFinite');
  });

  test('the stylesheet carries the pill, the dot, the counter and the reduced-motion opt-out', () => {
    const css = read('public/css/screens/presence.css');
    for (const sel of ['.presence-pill {', '.presence-pill__dot {', '.presence-pill__num {', '.presence-pill__label {']) {
      assert.ok(css.includes(sel), sel);
    }
    assert.match(css, /@keyframes presence-breathe/, 'the dot breathes');
    assert.match(css, /animation: presence-breathe[^;]*infinite/, 'and keeps breathing');
    assert.match(css, /prefers-reduced-motion[\s\S]*\.presence-pill__dot \{ animation: none; \}/, 'reduced motion stops it');
    // the repo-wide browser rules the static suite enforces on every stylesheet (its own check strips comments first)
    const rules = css.replace(/\/\*[\s\S]*?\*\//g, '');
    assert.doesNotMatch(rules, /:has\(|@container|@layer/);
  });

  test('index.html already loads the stylesheet (the integrator\'s wiring stays as the Lead left it)', () => {
    assert.match(read('public/index.html'), /<link rel="stylesheet" href="\/css\/screens\/presence\.css"/);
  });
});
