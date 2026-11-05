// public/js/ui/slotHostWatch.js —— 「一个 `[data-mod-slot]` 宿主出现了」这件事本身，也是一次该试试挂载的信号。
//
// 为什么需要这一格（DESIGN §28.8 / docs/WORKSHOP.md §1.9.3）：十一个挂载点里有七个由**组件自己**渲染
// `[data-mod-slot]`，而注册点（`public/js/ui/extensions.js`）过去只在 **store 变化** 时重试「容器到了没」。
// 但容器不是 store 画的：商店栏的「收起 / 展开」是玩家界面的**局部状态**（`public/js/screens/game.js` 的
// `useState`），收起时整块卸载、展开时由 Preact 重建一只新的宿主 —— 两下都不碰 store。于是面板要等到下一次
// 对局状态变化才挂得上去：业主 2026-11-05 报的「战地商店 / 证券交易所的进入按钮要展开商店一段时间之后才
// 刷出来」，等的是别人的一帧，不是它自己的渲染。
//
// 三条性质：
//   * **零声明零工作**：没有包声明 `client.panels` 时注册点根本不 `subscribe()`，这里也就不会被调到 ——
//     干净安装的页面上不装观察者、不多一次回调。
//   * **只认 childList 且只认宿主**：属性 / 文本变化不观察；新增节点里没有 `[data-mod-slot]` 就什么都不做 ——
//     面板自己往宿主里画按钮不会触发自己（那些节点没有这个属性），所以这里不会与注册点的 flush 互相叫醒。
//   * **Node 里什么也不做**：没有 `document` / `MutationObserver` 的宿主（服务端测试、非浏览器壳）拿到一个
//     空退订函数，不抛、不编造。
//
// 这个文件**零 import**：注册点必须能在 Node 下整套跑，而「宿主长出来了」的判据只有两个 DOM API 的名字。

/** 任何一块宿主容器（十一个槽位共用一个 `data-mod-slot` 属性；这里不需要知道具体是哪一个）。 */
export const SLOT_HOST_SELECTOR = '[data-mod-slot]';

/**
 * 这个节点是宿主容器，或者**包含**一块宿主容器吗？
 *
 * 两段都要看：Preact 新增的节点常常是一个外层 `<div>`，宿主在它里面（商店栏就是这样：整块 `<section>`
 * 被换掉，`[data-mod-slot]` 是它里面的一个 `<span>`）。节点不是元素（文本 / 注释节点）时直接为假。
 * @param {any} node
 * @returns {boolean}
 */
function isSlotHostNode(node) {
  if (!node || node.nodeType !== 1) return false;
  try {
    if (typeof node.matches === 'function' && node.matches(SLOT_HOST_SELECTOR)) return true;
    return typeof node.querySelector === 'function' && !!node.querySelector(SLOT_HOST_SELECTOR);
  } catch {
    // 一个形状奇怪的节点（测试里的替身、已经拆掉的元素）不是宿主：安静地说「不是」，不抛。
    return false;
  }
}

/**
 * 一批 MutationRecord 里有没有「新长出来一块宿主」。纯函数，所以挂载时机那一条规矩可以单测。
 * @param {any} records MutationObserver 交回来的那批记录
 * @returns {boolean}
 */
export function mutationAddsSlotHost(records) {
  for (const record of Array.isArray(records) ? records : []) {
    const added = record && record.addedNodes ? record.addedNodes : null;
    if (!added || typeof added.length !== 'number') continue;
    for (const node of added) if (isSlotHostNode(node)) return true;
  }
  return false;
}

/**
 * 盯住整页：有宿主容器长出来就调用一次 `onHost()`（注册点在那里 `flush()`）。
 *
 * 观察的是 `document.body` 的整棵子树：宿主可能出现在任何一层组件里，而它们的共同点只有那个属性
 * （`SLOT_HOST_SELECTOR`）。回调**不**合并节流：注册点的 `flush()` 本来就是幂等的、可重入的
 * （`flushing` / `dirty`），多叫一次只会是一次「还是那些面板、还是没有新容器」的空转。
 * @param {() => void} onHost
 * @returns {() => void} 退订函数（`dispose()` 要收回去；没有 DOM 的宿主上是一个空函数）
 */
export function watchSlotHosts(onHost) {
  if (typeof onHost !== 'function') return () => {};
  const doc = globalThis.document;
  const Observer = globalThis.MutationObserver;
  if (!doc || typeof Observer !== 'function') return () => {};
  const target = doc.body || doc.documentElement;
  if (!target || typeof target.nodeType !== 'number') return () => {};
  const observer = new Observer((records) => {
    if (mutationAddsSlotHost(records)) onHost();
  });
  observer.observe(target, { childList: true, subtree: true });
  return () => {
    try { observer.disconnect(); } catch { /* the observer is already gone: nothing to release */ }
  };
}
