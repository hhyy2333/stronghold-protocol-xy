// test/modPanelHostWatch.test.js —— C 层面板**什么时候**挂到「组件自己渲染的宿主」上（DESIGN §28.8 / §1.9.3）。
//
// 业主 2026-11-05：「战地商店和证券交易所这俩 mod 的进入那个按钮是在展开商店一段时间之后才刷出来，能不能优化一下
// 他的出现速度」。根因不在两个包里：商店栏收起 / 展开是 `public/js/screens/game.js` 的 `useState`，宿主由 Preact
// 整块换掉，**store 一个字节都没变**；而注册点过去只在 store 变化时重试，于是面板要等「别人的一帧」才挂得上。
//
// 这一组用例把那条规矩钉住：宿主一出现就挂（不需要任何 store 变化），宿主被换掉之后重挂，`dispose()` 收回观察者。
// 假 DOM + 假 MutationObserver：注册点本来就注入着 `createElement` / `slotHosts`，这一层只在 Node 里跑。
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { createPanelRegistry } from '../public/js/ui/extensions.js';

/** 一个够用的元素替身（只实现注册点与观察者真的会用到的那几格）。 */
class FakeElement {
  constructor(tag, doc) {
    this.nodeType = 1;
    this.tagName = String(tag).toUpperCase();
    this.childNodes = [];
    this.parentNode = null;
    this.attrs = {};
    this.className = '';
    this.style = {};
    this.ownerDocument = doc || null;
    this.isConnected = true;
  }
  get firstChild() { return this.childNodes[0] || null; }
  appendChild(node) {
    if (node.parentNode) node.parentNode.removeChild(node);
    node.parentNode = this;
    this.childNodes.push(node);
    return node;
  }
  removeChild(node) {
    const at = this.childNodes.indexOf(node);
    if (at >= 0) this.childNodes.splice(at, 1);
    node.parentNode = null;
    return node;
  }
  remove() {
    if (this.parentNode) this.parentNode.removeChild(this);
    markDetached(this);
  }
  setAttribute(name, value) { this.attrs[name] = String(value); }
  getAttribute(name) { return Object.hasOwn(this.attrs, name) ? this.attrs[name] : null; }
  addEventListener() { /* the registry does not delegate anything here */ }
  removeEventListener() {}
  matches(selector) {
    if (selector === '[data-mod-slot]') return Object.hasOwn(this.attrs, 'data-mod-slot');
    return false;
  }
  querySelector(selector) {
    for (const child of this.childNodes) {
      if (child.nodeType === 1 && (child.matches(selector) || child.querySelector(selector))) return child;
    }
    return null;
  }
}

/** 把整棵子树标成「不在文档里」（`pruneDetachedHosts` 看的就是 `isConnected === false`）。 */
function markDetached(el) {
  el.isConnected = false;
  for (const child of el.childNodes) markDetached(child);
}

/** 造一块新的商店栏宿主容器（`[data-mod-slot="screen.game.shopTools"]`）。 */
function slotHost(doc, slot = 'screen.game.shopTools') {
  const el = new FakeElement('span', doc);
  el.setAttribute('data-mod-slot', slot);
  return el;
}

/** 一帧 store：够注册点订阅用（这一组用例**从不**把它弄脏 —— 那正是要证明的事）。 */
function fakeStore() {
  const state = {};
  const subscribers = new Set();
  return {
    get: () => state,
    subscribe(fn) { subscribers.add(fn); return () => subscribers.delete(fn); },
    patch(key, value) { Object.assign(state, { [key]: value }); for (const fn of [...subscribers]) fn(state, state); },
    subscribers: () => subscribers.size,
  };
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

/**
 * 一支装好的注册点：假 DOM、假宿主列表、假模块、假 MutationObserver。
 * `containers` 就是「这一刻页面上渲染出了哪些宿主容器」—— 组件重画时测试自己 push / 清空它。
 */
async function boot() {
  const doc = { createElement: (tag) => new FakeElement(tag) };
  const body = new FakeElement('body', doc);
  const observers = [];
  class FakeMutationObserver {
    constructor(callback) { this.callback = callback; this.disconnected = false; observers.push(this); }
    observe(target, options) { this.target = target; this.options = options; }
    disconnect() { this.disconnected = true; }
  }
  const before = { doc: globalThis.document, mo: globalThis.MutationObserver };
  globalThis.document = { body };
  globalThis.MutationObserver = FakeMutationObserver;

  const containers = [];
  const mounts = [];
  const unmounts = [];
  const store = fakeStore();
  const registry = createPanelRegistry({
    store,
    net: { on: () => () => {}, send: () => true },
    slotHost: () => null,
    slotHosts: (slot) => containers.filter((c) => c.slot === slot).map((c) => c.el),
    createElement: (tag) => new FakeElement(tag, doc),
    importModule: async () => ({
      mount: (ctx) => {
        mounts.push(ctx.hostKey);
        ctx.host.appendChild(new FakeElement('button', doc));
        return { unmount() { unmounts.push(ctx.hostKey); } };
      },
    }),
    log: { info() {}, warn() {}, error() {} },
    env: {},
  });

  /** 组件渲染出了一块宿主（**不**碰 store）。 */
  async function renderHost(slot = 'screen.game.shopTools') {
    const el = slotHost(doc, slot);
    containers.push({ slot, el });
    for (const observer of observers) observer.callback([{ type: 'childList', addedNodes: [el] }]);
    await settle();
    return el;
  }
  /** 组件整块卸载（收起商店栏）：宿主连同挂在上面的东西一起离开文档。 */
  async function removeHosts() {
    for (const c of containers) { c.el.parentNode = null; markDetached(c.el); }
    containers.length = 0;
    for (const observer of observers) observer.callback([{ type: 'childList', removedNodes: [body] }]);
    await settle();
  }
  function restore() {
    globalThis.document = before.doc;
    globalThis.MutationObserver = before.mo;
  }
  return { registry, observers, containers, mounts, unmounts, store, body, renderHost, removeHosts, restore };
}

const PANEL = [{
  id: 'tab',
  pack: 'demo',
  slot: 'screen.game.shopTools',
  url: '/workshop-panels/demo/ui/tab.js',
}];

test('宿主一出现就挂上 —— 不需要任何 store 变化（业主 2026-11-05：按钮不再等别人的一帧）', async () => {
  const h = await boot();
  try {
    h.registry.apply(PANEL);
    await settle();
    assert.deepEqual(h.registry.mounted(), [], 'no container yet ⇒ nothing to mount into');
    assert.equal(h.observers.length, 1, 'the registry watches the DOM once it has a panel to mount');

    const el = await h.renderHost();
    assert.deepEqual(h.registry.mounted(), ['demo/tab'], 'the panel mounted the moment its container appeared');
    assert.equal(el.childNodes.length, 1, 'and it filled that container');
    assert.equal(h.store.subscribers(), 1, 'premise: the store was left alone (only its own subscription exists)');
  } finally {
    h.registry.dispose();
    h.restore();
  }
});

test('商店栏收起又展开（宿主被换掉）：旧的那份先摘掉，新容器立刻重新挂上', async () => {
  const h = await boot();
  try {
    h.registry.apply(PANEL);
    await settle();
    const first = await h.renderHost();
    assert.equal(h.registry.mounted().length, 1);
    assert.equal(h.unmounts.length, 0);

    await h.removeHosts();
    assert.equal(first.isConnected, false);
    const second = await h.renderHost();
    assert.equal(h.unmounts.length, 1, 'the detached mount was released (its channel subscription goes with it)');
    assert.equal(h.registry.mounted().length, 1, 'exactly one panel is mounted again');
    assert.equal(second.childNodes.length, 1, 'the new container got the panel');
  } finally {
    h.registry.dispose();
    h.restore();
  }
});

test('没有宿主的那一帧不挂；非宿主节点的 DOM 变化不叫醒注册点', async () => {
  const h = await boot();
  try {
    h.registry.apply(PANEL);
    await settle();
    // 一个普通节点（不是宿主）长出来：没有任何挂载尝试。
    const plain = new FakeElement('div', { createElement: (tag) => new FakeElement(tag) });
    for (const observer of h.observers) observer.callback([{ type: 'childList', addedNodes: [plain] }]);
    await settle();
    assert.deepEqual(h.registry.mounted(), []);

    // 宿主出现才挂。
    await h.renderHost();
    assert.deepEqual(h.registry.mounted(), ['demo/tab']);
  } finally {
    h.registry.dispose();
    h.restore();
  }
});

test('dispose() 收回观察者与订阅：之后宿主再出现也不会挂', async () => {
  const h = await boot();
  try {
    h.registry.apply(PANEL);
    await settle();
    await h.renderHost();
    assert.equal(h.unmounts.length, 0);

    h.registry.dispose();
    assert.equal(h.unmounts.length, 1, 'dispose unmounts what it mounted');
    assert.ok(h.observers.every((o) => o.disconnected), 'every observer is disconnected');
    assert.equal(h.store.subscribers(), 0, 'the store subscription is gone too');

    await h.renderHost();
    assert.deepEqual(h.registry.mounted(), []);
  } finally {
    h.registry.dispose();
    h.restore();
  }
});

test('干净安装（服务端没有包声明面板）：一个观察者都不装', async () => {
  const h = await boot();
  try {
    h.registry.apply([]);
    await settle();
    assert.equal(h.observers.length, 0, 'no packs ⇒ no panel ⇒ no DOM watcher at all');
    assert.equal(h.store.subscribers(), 0);
  } finally {
    h.registry.dispose();
    h.restore();
  }
});
