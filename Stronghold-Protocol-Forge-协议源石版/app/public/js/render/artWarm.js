// public/js/render/artWarm.js — 资源预加载（业主 2026-10-16 要求「增加资源预加载」）
//
// 只做一件事：把 UnitView **即将**用到的美术在当前帧之外先拉起来，这样它真正建视图时命中缓存，
// 而不是先画一个菱形占位再等图 —— 那个观感问题就记在 units.js `_loadPicture` / `_loadSpine` 的注释里
// （「the view keeps its fallback diamond」）。
//
// 三条纪律，都是为了「预加载**绝不能**让事情变坏」：
//   1. **不阻塞**：全部 fire-and-forget —— 不 await、不进渲染路径、不影响任何一帧；
//   2. **不持有**：Spine 走 acquire → 立刻 release（骨架进 LRU，引用计数归还 0），不泄漏引用；
//      图片走 `assets.image`，它自带 LRU 与去重，重复调用只是一次 Map 查；
//   3. **不抛错**：任何一个 URL 取不到，只是这次预热没成，视图照旧按需加载（与从前逐字相同）。
//
// 取值顺序与 units.js 完全一致（picture(avatar) → picture(defId) → picture(spine)），所以「预热过的」
// 与「视图要的」不会各拉一份。入口 `warmInfo` 吃的是**和 UnitView 同一个形状的 info** ——
// 也就是 app.js `pieceInfo()` 与敌方预览那个循环的产物。

/** UnitView 认的美术键 → 要预热的图片 URL（没有就 null）。与 units.js `_loadPicture` 同一套取值顺序。 */
export function pictureUrlOf(assets, info) {
  if (!assets || !info) return null;
  if (info.kind === 'item') return info.icon || null;   // 道具：app.js pieceInfo 已经解析好了
  if (!assets.picture) return null;
  const pick = (v) => (v ? assets.picture(v) : null);
  return pick(info.avatar) || pick(info.defId) || pick(info.spine) || null;
}

/**
 * 预热一个 info 的图片与骨骼。**永不抛错、永不等待**。
 * @param {any} assets assets.js 的 `assets` 单例（或测试里的替身）
 * @param {any} info UnitView 形状的 info（`{ kind, defId, avatar, spine, side, boss, icon }`）
 * @param {{ lowQualityEnemy?: boolean }} [opts] `lowQualityEnemy` = 低画质下跳过敌方模型，
 *   与 units.js `_loadSpine` 的取舍一致（低画质 + 拥挤时不加载敌方模型，省的是同一份带宽）
 */
export function warmInfo(assets, info, opts = {}) {
  if (!assets || !info) return;
  try {
    const url = pictureUrlOf(assets, info);
    if (url && assets.image) { const p = assets.image(url); if (p && p.catch) p.catch(() => {}); }
    if (opts.lowQualityEnemy && info.side === 'enemy' && !info.boss) return;
    const spineId = info.spine || info.defId;
    if (!spineId || !assets.spineEntry || !assets.spine) return;
    const entry = assets.spineEntry(spineId, { back: false });
    if (!entry) return;
    // 已经在缓存里就别再动引用计数（peek 是同步的，不用 acquire）
    if (assets.spine.peek && assets.spine.peek(entry)) return;
    const acq = assets.spine.acquire(entry);
    if (!acq || !acq.then) return;
    acq.then(() => { try { assets.spine.release(entry); } catch { /* 归还失败不是错误 */ } }, () => {});
  } catch { /* 预热失败不是错误 */ }
}

/**
 * 预热一批**已经解析好的 URL**（UI 侧的卡片图：立绘 / 职业图标 / 道具图 —— 它们由 assetUrls.js 直接给 URL，
 * 不像战场那样要给 id 让 assets 自己解析）。这里是现成的 `assets.preload` 正好对口的场景：它去重、并发、
 * 汇报进度，且**永不 reject**。
 * @param {any} assets @param {(string|null|undefined)[]} urls @param {(done:number,total:number,url:string)=>void} [onProgress]
 */
export function warmUrls(assets, urls, onProgress) {
  if (!assets || !Array.isArray(urls)) return;
  try {
    const list = urls.filter((u) => typeof u === 'string' && u);
    if (!list.length) return;
    if (assets.preload) { const p = assets.preload(list, onProgress); if (p && p.catch) p.catch(() => {}); return; }
    for (const u of list) warmInfo(assets, { kind: 'item', icon: u });
  } catch { /* 预热失败不是错误 */ }
}

/** 批量预热。同一条纪律：不阻塞、不持有、不抛错。 */
export function warmInfos(assets, infos, opts = {}) {
  if (!Array.isArray(infos)) return;
  for (const info of infos) warmInfo(assets, info, opts);
}
