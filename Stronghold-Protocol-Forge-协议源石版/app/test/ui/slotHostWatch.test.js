// test/ui/slotHostWatch.test.js —— 「宿主容器出现了」这一格（`public/js/ui/slotHostWatch.js`）。
//
// 业主 2026-11-05：「战地商店和证券交易所这俩 mod 的进入那个按钮是在展开商店一段时间之后才刷出来，能不能优化一下
// 他的出现速度」。根因不在两个包里：商店栏的收起 / 展开是**界面局部状态**（`public/js/screens/game.js` 的
// `useState`），收起时整块卸载、展开时 Preact 重建一只新的 `[data-mod-slot]` 宿主，两下都不碰 store；而注册点
// 过去只在 store 变化时重试挂载。这一格把「宿主长出来了」变成一次事件，于是面板在展开的那一帧就挂上。
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { SLOT_HOST_SELECTOR, mutationAddsSlotHost, watchSlotHosts } from '../../public/js/ui/slotHostWatch.js';

/** 一个够用的元素替身：`matches` / `querySelector` 只认那一条属性（别的选择器一律答「不是」）。 */
function fakeEl({ slot = false, child = null } = {}) {
  return {
    nodeType: 1,
    matches: (selector) => selector === SLOT_HOST_SELECTOR && slot,
    querySelector: (selector) => (selector === SLOT_HOST_SELECTOR ? child : null),
  };
}
const fakeText = () => ({ nodeType: 3, textContent: '商店' });

test('mutationAddsSlotHost：新增的节点本身就是宿主，或里面包着宿主，都算', () => {
  assert.equal(mutationAddsSlotHost([{ addedNodes: [fakeEl({ slot: true })] }]), true);
  // Preact 换掉的是整块 <section>，宿主是它里面的一个 <span>：只看顶层节点会漏掉这一种。
  assert.equal(mutationAddsSlotHost([{ addedNodes: [fakeEl({ child: fakeEl({ slot: true }) })] }]), true);
  // 一批记录里只要有一条算数就够了。
  assert.equal(mutationAddsSlotHost([{ addedNodes: [fakeText()] }, { addedNodes: [fakeEl({ slot: true })] }]), true);
});

test('mutationAddsSlotHost：文本、非宿主元素、只有删除 / 属性变化、空输入都不算', () => {
  assert.equal(mutationAddsSlotHost([{ addedNodes: [fakeText()] }]), false, 'text nodes are not hosts');
  assert.equal(mutationAddsSlotHost([{ addedNodes: [fakeEl()] }]), false, 'a plain element is not a host');
  assert.equal(mutationAddsSlotHost([{ removedNodes: [fakeEl({ slot: true })] }]), false, 'removal needs no mount attempt');
  assert.equal(mutationAddsSlotHost([{ type: 'attributes', target: fakeEl({ slot: true }) }]), false, 'attributes are not observed');
  assert.equal(mutationAddsSlotHost([{ addedNodes: null }]), false);
  assert.equal(mutationAddsSlotHost([]), false);
  assert.equal(mutationAddsSlotHost(null), false);
  assert.equal(mutationAddsSlotHost(undefined), false);
});

test('mutationAddsSlotHost：形状奇怪的节点安静地算「不是」，不抛', () => {
  const throwing = { nodeType: 1, matches() { throw new Error('boom'); }, querySelector() { throw new Error('boom'); } };
  assert.equal(mutationAddsSlotHost([{ addedNodes: [throwing] }]), false);
});

test('watchSlotHosts：只有宿主节点出现才回调；退订之后断开观察', () => {
  const created = [];
  class FakeObserver {
    constructor(callback) { this.callback = callback; this.disconnected = false; created.push(this); }
    observe(target, options) { this.target = target; this.options = options; }
    disconnect() { this.disconnected = true; }
  }
  const body = { nodeType: 1 };
  const before = { doc: globalThis.document, mo: globalThis.MutationObserver };
  globalThis.document = { body };
  globalThis.MutationObserver = FakeObserver;
  try {
    let calls = 0;
    const off = watchSlotHosts(() => { calls += 1; });
    assert.equal(created.length, 1, 'exactly one observer for the page');
    assert.equal(created[0].target, body, 'it watches the document body');
    assert.deepEqual(created[0].options, { childList: true, subtree: true });

    created[0].callback([{ addedNodes: [fakeEl()] }]);
    assert.equal(calls, 0, 'a non-host node wakes nothing up');
    created[0].callback([{ addedNodes: [fakeEl({ slot: true })] }]);
    assert.equal(calls, 1, 'a host container appearing is one signal');

    off();
    assert.equal(created[0].disconnected, true);
  } finally {
    globalThis.document = before.doc;
    globalThis.MutationObserver = before.mo;
  }
});

test('watchSlotHosts：没有 document / MutationObserver 的宿主（Node）给一个空退订函数，不抛', () => {
  const before = { doc: globalThis.document, mo: globalThis.MutationObserver };
  delete globalThis.document;
  delete globalThis.MutationObserver;
  try {
    const off = watchSlotHosts(() => { throw new Error('must never be called without a DOM'); });
    assert.equal(typeof off, 'function');
    off();
    assert.equal(typeof watchSlotHosts(null), 'function', 'no callback, no observer');
  } finally {
    globalThis.document = before.doc;
    globalThis.MutationObserver = before.mo;
  }
});
