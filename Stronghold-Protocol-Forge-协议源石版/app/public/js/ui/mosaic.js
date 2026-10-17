// public/js/ui/mosaic.js — 情报部抑制 (enemy hex `ehex_mosaic`): 机变（以及同类的选择浮层）看不清。
//
// 协议源石版 port, ninth batch (the owner's list of 2026-10-15)。这条敌人协议源石没有引擎那半 ——
// 它的全部效果都是表现层的（shared/hextech.js 列出这个 verb 让构建接受记录，sim 找不到脚本是正常的）。
//
// 驱动方式。服务端在普通的 public 视图里下发敌方持有的卡（`m.public.enemyHexes`，server/match/match/views.js），
// 所以客户端不需要新帧：`ehex_mosaic` 在那张列表里时开着，卡不在（或对局结束）时自己关掉。
//
// **范围改过（业主 2026-10-16「改成只有敌人形象和机变看不清」）**。原来是**全屏**的一层 `backdrop-filter`
// 马赛克，盖住了战场、HUD 和机变浮层 —— 于是敌人形象和机变一起糊。业主选定的新范围是「**只糊机变**」：
// 这里不再渲染任何层，只给 `<html>` 挂一个类；CSS（css/theme.css 的 `.sp-mosaic` 那一段）用那个类去糊
// **机变浮层**（`.spov`，以及共用同一形态的其它选择浮层）。战场、敌人、HUD 全部保持清晰可读。
//
// 为什么不用全屏层糊「敌人形象」：敌人画在 canvas 里（three.js / Pixi），而 `backdrop-filter` 是 DOM 的东西，
// 只能作用于某个元素的**下方区域** —— 没有任何办法把它裁剪到「canvas 里的敌人模型」。要糊到敌人就只能糊整块
// 战场 canvas（自己的干员和地形会一起糊），那就还是「看不清战场」，正是业主要摆脱的效果。所以这一版收窄到
// 唯一能精确命中的対象：机变浮层（DOM）。
//
// 实现用类而不是元素：`useDocClass` 已经是这个仓库里「随状态给 <html> 加类」的既有做法（ui/device.js），
// 这样 CSS 能选择性地作用到浮层上，而且不引入一个永不消失的全屏合成层（`backdrop-filter` 全屏是每帧的合成开销）。

import { store, useStore } from '../store.js';
import { useDocClass } from './device.js';

/** The enemy hex id that turns the layer on. */
export const MOSAIC_HEX_ID = 'ehex_mosaic';

/**
 * Whether the mosaic is on right now: the enemy side owns the card in the CURRENT public view.
 * @param {{ match?: { public?: { enemyHexes?: Array<{ id?: string }> } } } }} s
 * @returns {boolean}
 */
export function mosaicActive(s) {
  const list = s && s.match && s.match.public ? s.match.public.enemyHexes : null;
  if (!Array.isArray(list)) return false;
  return list.some((h) => h && h.id === MOSAIC_HEX_ID);
}

/**
 * 挂 `<html>` 上的类名。CSS（css/theme.css）用 `.sp-mosaic .spov { … }` 去糊机变浮层。
 * 常量导出，方便测试与（将来）别的选择浮层复用。
 */
export const MOSAIC_CLASS = 'sp-mosaic';

/**
 * 开着的时候给 `<html>` 挂 `MOSAIC_CLASS`，关掉时摘掉。**不渲染任何元素** ——
 * 所以没有这张卡的局与从前逐字节相同，且不会留一个全屏合成层在那里（那是每帧的开销）。
 * `useDocClass` 是仓库里既有的「随状态给 <html> 加类」的做法（ui/device.js）。
 */
export function MosaicOverlay() {
  const on = useStore(mosaicActive);
  useDocClass(MOSAIC_CLASS, on);
  return null;
}

/** Test hook: read the flag off the live store without a component. */
export const mosaicActiveNow = () => mosaicActive(store.get());
