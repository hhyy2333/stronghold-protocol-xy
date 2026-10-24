// public/js/ui/hexHit.js — 敌方协议源石触发时的一次醒目提示（记录部抑制 `ehex_records` 是第一个用它的人）。
//
// 业主 2026-10-24「记录部抑制触发时给个明显提示」。这条卡的扣血发生在备战期的一次 `g.move` 里
// （server/match/match/intents.js `_moveWithDeployCost`）：服务端扣了 LP，客户端只看到数字变小，
// 屏幕上没有任何一行字解释它。现在服务端随扣血下发一条 `kind: 'hex'` 的 m.toast，这里负责把它
// 做成**看得见**的那一下：
//
//   1. 给 `<html>` 挂 `sp-hex-hit` 一段时间 —— CSS 用它去脉冲目标生命值（.lp，css/screens/game.css）；
//   2. 渲染一层屏幕四周的红晕（`.hex-hit`，纯装饰、pointer-events: none、1 秒左右自己淡掉）。
//
// 为什么是「挂类 + 一层」而不是常驻一层：没有触发的局里 DOM 里什么都不多，也就没有每帧的合成开销
// （情报部抑制的 ui/mosaic.js 是同一个取舍，只是它要的是**持续**状态，所以只挂类、不渲染）。
//
// 文案不在本文件：文字走 m.toast 的既有通道（shared/i18n.js translateWire），所以四种语言都覆盖，
// 旧客户端不认识 `hex` 这个 kind 时也会退回普通 toast，不会静音。

import { h } from '../../vendor/preact.module.js';
import { useEffect, useReducer } from '../../vendor/hooks.module.js';
import htm from '../../vendor/htm.module.js';

// no shared static vnodes (see components.js hFresh: htm's static cache would retain unmounted DOM)
function hFresh(type, props, ...children) {
  if (this && typeof this === 'object') this[0] = 3;
  return h(type, props, ...children);
}
const html = htm.bind(hFresh);

/** The class `flashHexHit` puts on `<html>` (CSS: the LP tower pulse). */
export const HEX_HIT_CLASS = 'sp-hex-hit';

/** How long the flash stays (ms) — the toast itself lives longer (ui/toasts.js DEFAULT_MS.hex). */
export const HEX_HIT_MS = 1100;

let seq = 0;                      // 0 = nothing showing; >0 = which flash it is (also the vnode key, so the animation replays)
let timer = null;
const listeners = new Set();

const emit = () => { for (const fn of [...listeners]) { try { fn(); } catch (err) { console.error(err); } } };

/**
 * Play the flash once. A second call while one is showing restarts it (the class is removed and re-added so the CSS
 * animation runs again, and the key changes so the overlay mounts fresh).
 * @param {number} [ms]
 * @returns {number} the flash seq (0 when there is no document — a test / SSR context: the class work is skipped, the
 *   listeners still fire so a test can read `hexHitActive()`)
 */
export function flashHexHit(ms = HEX_HIT_MS) {
  const el = typeof document !== 'undefined' ? document.documentElement : null;
  if (timer) clearTimeout(timer);
  if (el) {
    el.classList.remove(HEX_HIT_CLASS);
    void el.offsetHeight;          // a reflow, so re-adding the class restarts the animation
    el.classList.add(HEX_HIT_CLASS);
  }
  seq += 1;
  emit();
  timer = setTimeout(() => {
    timer = null;
    seq = 0;
    if (el) el.classList.remove(HEX_HIT_CLASS);
    emit();
  }, Math.max(200, Number(ms) || HEX_HIT_MS));
  return seq;
}

/** Whether a flash is on screen right now (tests, and anything that wants to read the state without a component). */
export function hexHitActive() { return seq > 0; }

/** Test hook: clear the flash at once (no animation, no listeners left waiting). */
export function resetHexHit() {
  if (timer) { clearTimeout(timer); timer = null; }
  seq = 0;
  const el = typeof document !== 'undefined' ? document.documentElement : null;
  if (el) el.classList.remove(HEX_HIT_CLASS);
  emit();
}

/**
 * Mount once near the app root (main.js App). Renders the red vignette while a flash runs and nothing at all otherwise.
 */
export function HexHitFlash() {
  const [, force] = useReducer((c) => c + 1, 0);
  useEffect(() => {
    listeners.add(force);
    return () => listeners.delete(force);
  }, []);
  if (!seq) return null;
  return html`<div class="hex-hit" key=${seq} aria-hidden="true"></div>`;
}
