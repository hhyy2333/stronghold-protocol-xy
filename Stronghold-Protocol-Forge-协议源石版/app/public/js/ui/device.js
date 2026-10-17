// Multi-device support (desktop Chrome / Edge / Firefox / Safari, iPad and Android tablets in landscape, phones in
// landscape ≥ 640×360 CSS px). Everything is feature-detected — never UA-sniffed:
//
//   detectFeatures()        { touch, coarse, hover, fullscreen, standalone, reducedMotion, importMaps, … } of this browser
//   installDeviceSupport()  once at boot (main.js): <html> classes (sp-touch / sp-coarse / sp-hover / sp-fs /
//                           sp-standalone / sp-reduced-motion / sp-no-hover / sp-rotatable), kept current when an input device or a
//                           preference changes; blocks page zoom gestures (iOS Safari ignores user-scalable=no:
//                           gesturestart / gesturechange are cancelled, ctrl+wheel / trackpad pinch too; touch-action in
//                           css/devices.css handles the rest); re-fires `resize` once the viewport
//                           settles after a rotation (iOS reports the old size for a few frames) so the field view and
//                           the rem scale re-layout; keeps --sp-vh (the real visible height) for the CSS.
//   fullscreen              { supported(), active(), toggle(), exit() }: Fullscreen API with the webkit-prefixed
//                           variant (iPadOS / older Safari); iPhone Safari has no element fullscreen → unsupported and the
//                           button hides. Android: after entering, the orientation is locked to landscape when allowed.
//   FullscreenButton        HUD / title button (hidden where unsupported), follows fullscreenchange.
//   long-press              a still touch of LONG_PRESS_MS on a DOM control → a synthetic `contextmenu` (= detail) when
//                           the browser sends none (iOS Safari); when a handler took it (preventDefault: detail card,
//                           tooltip) the click of the release is swallowed — otherwise the slow tap stays a tap.
//   reducedMotion()         prefers-reduced-motion (the CSS side lives in css/theme.css + css/devices.css).
// CSS counterpart: public/css/devices.css (safe-area insets, touch-action, overscroll, tap-target expansion).

import { useEffect, useState } from '../../vendor/hooks.module.js';
import { pwaInstall } from '../pwa.js';
import { html, Icon, Button } from './components.js';
import { t } from '../../../shared/i18n.js';

/** A touch held this long without moving opens the detail (contextmenu) on DOM controls. */
export const LONG_PRESS_MS = 520;
const LONG_PRESS_SLOP = 10;

const mq = (win, q) => { try { return !!win.matchMedia?.(q)?.matches; } catch { return false; } };

/**
 * Whether the SCREEN (not the viewport) is in landscape: a split-view iPad or a narrow desktop window has a portrait
 * viewport on a landscape screen — rotating would not help there. screen.orientation (Chrome, Firefox, Safari 16.4+),
 * else window.orientation (older iOS); iOS reports screen.width/height in portrait always, so no size guess there.
 * @param {any} [win]
 * @returns {boolean|null} null when unknown
 */
export function screenLandscape(win = globalThis) {
  try {
    const t = win.screen?.orientation?.type;
    if (typeof t === 'string' && t) return t.startsWith('landscape');
  } catch { /* ignore */ }
  const o = Number(win.orientation);
  if (win.orientation != null && Number.isFinite(o)) return Math.abs(o) === 90;
  return null;
}

/**
 * What this browser / device can do.
 * @param {any} [win]
 */
export function detectFeatures(win = globalThis) {
  const doc = win.document;
  const nav = win.navigator || {};
  const touchPoints = Number(nav.maxTouchPoints) || 0;
  const coarse = mq(win, '(any-pointer: coarse)') || mq(win, '(pointer: coarse)');
  // `(pointer: coarse)` is the PRIMARY pointer — a phone or tablet. `(any-pointer: coarse)` only says a coarse pointer
  // EXISTS, which is also true on a touchscreen laptop whose main input is still a mouse. The rotate hint needs the
  // former; `coarse` keeps feeding sp-coarse (44 px tap targets), where "touch is available" is the right question.
  const coarsePrimary = mq(win, '(pointer: coarse)');
  const fine = mq(win, '(any-pointer: fine)');
  const hover = mq(win, '(any-hover: hover)') || mq(win, '(hover: hover)');
  const el = doc?.documentElement;
  const fsEnabled = !!(doc && (doc.fullscreenEnabled || doc.webkitFullscreenEnabled))
    && !!(el && (typeof el.requestFullscreen === 'function' || typeof el.webkitRequestFullscreen === 'function'));
  let importMaps = false;
  try { importMaps = typeof win.HTMLScriptElement?.supports === 'function' && win.HTMLScriptElement.supports('importmap'); } catch { importMaps = false; }
  return {
    touch: touchPoints > 0 || coarse || 'ontouchstart' in (win || {}),
    coarse,
    coarsePrimary,
    fine,
    hover,
    fullscreen: fsEnabled,
    standalone: mq(win, '(display-mode: standalone)') || mq(win, '(display-mode: fullscreen)') || nav.standalone === true,
    reducedMotion: mq(win, '(prefers-reduced-motion: reduce)'),
    screenLandscape: screenLandscape(win),
    importMaps,
    broadcastChannel: typeof win.BroadcastChannel === 'function',
    pointerEvents: typeof win.PointerEvent === 'function',
    gestureEvents: typeof win.GestureEvent === 'function',   // WebKit only (pinch zoom has to be cancelled by hand)
    visualViewport: !!win.visualViewport,
  };
}

/** The classes installDeviceSupport puts on <html> for a feature set (pure; tested). */
export function featureClasses(f) {
  return {
    'sp-touch': !!f.touch,
    'sp-coarse': !!f.coarse,
    'sp-hover': !!f.hover,
    'sp-no-hover': !f.hover,
    'sp-fs': !!f.fullscreen,
    'sp-standalone': !!f.standalone,
    'sp-reduced-motion': !!f.reducedMotion,
    // The rotate hint (css/theme.css) is for a device you can TURN: a touch screen whose screen is not in landscape —
    // never a desktop browser window that happens to be narrow, nor a split-view iPad. It keys off the PRIMARY pointer,
    // not `f.coarse`: on a touchscreen laptop `(any-pointer: coarse)` is true while the machine still cannot be rotated,
    // which is exactly the window the e2e test 'portrait phone: the rotate hint covers the page' guards against.
    'sp-rotatable': !!f.coarsePrimary && f.screenLandscape !== true,
  };
}

/** prefers-reduced-motion: reduce */
export function reducedMotion(win = globalThis) { return mq(win, '(prefers-reduced-motion: reduce)'); }

/**
 * Keep a class on <html> while a component is mounted and `on` holds (replaces CSS :has(), which Firefox ESR 115 and
 * Safari < 15.4 lack): the match screen sets sp-in-match, the connection banner sp-conn.
 * @param {string} name
 * @param {boolean} [on]
 */
export function useDocClass(name, on = true) {
  useEffect(() => {
    const el = globalThis.document?.documentElement;
    if (!el || !on) return undefined;
    el.classList.add(name);
    return () => el.classList.remove(name);
  }, [name, !!on]);
}

// ---- fullscreen ----------------------------------------------------------------------------------------------------

export const fullscreen = {
  supported(win = globalThis) { return detectFeatures(win).fullscreen; },
  active(win = globalThis) { const d = win.document; return !!(d && (d.fullscreenElement || d.webkitFullscreenElement)); },
  async enter(win = globalThis) {
    const el = win.document?.documentElement;
    if (!el) return false;
    try {
      if (typeof el.requestFullscreen === 'function') await el.requestFullscreen({ navigationUI: 'hide' });
      else if (typeof el.webkitRequestFullscreen === 'function') el.webkitRequestFullscreen();
      else return false;
    } catch { return false; }
    // 进全屏成功 = 用户想要全屏（切后台回来要补回来，见 restoreFullscreen）
    wanted = true;
    // Android Chrome: a landscape game may lock the orientation while fullscreen (refused elsewhere — ignored)
    try { await win.screen?.orientation?.lock?.('landscape'); } catch { /* not allowed here */ }
    return true;
  },
  async exit(win = globalThis) {
    const d = win.document;
    // 用户**主动**退出：清掉「想全屏」的意图，切回来时就不会被自动拉回全屏。
    wanted = false;
    try {
      if (d?.fullscreenElement && typeof d.exitFullscreen === 'function') await d.exitFullscreen();
      else if (d?.webkitFullscreenElement && typeof d.webkitExitFullscreen === 'function') d.webkitExitFullscreen();
    } catch { return false; }
    try { win.screen?.orientation?.unlock?.(); } catch { /* ignore */ }
    return true;
  },
  toggle(win = globalThis) { return this.active(win) ? this.exit(win) : this.enter(win); },
};

// ---- 全屏的「意图」与切后台后的自动恢复 ---------------------------------------------------------------------------
//
// 手机切到别的 app（QQ / 微信）再切回来，浏览器会**自动退出全屏** —— 这是 Fullscreen API 的既定行为，而且它**不会**
// 自动恢复（在页面隐藏时请求全屏会被拒，所以只能在回到前台之后再请求一次）。
//
// 这里记住「用户想要全屏」这个意图，并在回到前台时补一次：
//   * `enter()` 成功 → wanted = true（用户主动进的）；
//   * `exit()` → wanted = false（用户主动退的，别把他拉回去）；
//   * 回到前台且 wanted 仍为 true 但当前不在全屏 → 重新 enter()。
//
// 「用户主动退出」还有一条路：浏览器自己的退出手势（Esc / 系统返回）不会走 `exit()`，但它会派发
// `fullscreenchange`。所以那个事件里要判断：这次退出是不是**用户干的** —— 只有在「页面正在隐藏」时发生的退出才算
// 「系统因为切后台而收走的」，其余一律当成用户意图（清掉 wanted）。
//
// 为什么不在 `visibilitychange` 里立刻恢复：那时页面刚回来，浏览器通常还要一两帧才允许再次请求全屏，
// 直接请求多半被拒（且会吞掉一次用户手势窗口）。所以先等一帧再试，失败就静默放弃 —— 下次切回来还会再试。
let wanted = false;
let restoring = false;

/** 用户是否想要全屏（供测试与调试读）。 */
export function fullscreenWanted() { return wanted; }

/**
 * 切后台回来后把全屏补上（`installDeviceSupport` 注册；也可单独调用）。
 * 只在「用户想要全屏」且当前确实不在全屏时才动手 —— 用户手动退出的（wanted 已清）永远不会被拉回去。
 * @param {any} [win]
 */
export async function restoreFullscreen(win = globalThis) {
  if (!wanted || restoring) return false;
  if (!fullscreen.supported(win) || fullscreen.active(win)) return false;
  restoring = true;
  try {
    // 一帧的余量：切回来的瞬间浏览器常常还没放开全屏请求（在隐藏时请求必然被拒）。
    await new Promise((r) => { try { win.requestAnimationFrame(() => r()); } catch { r(); } });
    return await fullscreen.enter(win);
  } finally { restoring = false; }
}

/** Fullscreen toggle (hidden where the browser has no element fullscreen, e.g. iPhone Safari). */
export function FullscreenButton({ class: cls = '' }) {
  const [on, setOn] = useState(() => fullscreen.active());
  const [ok] = useState(() => fullscreen.supported());
  useEffect(() => {
    const d = globalThis.document;
    if (!d) return undefined;
    const upd = () => setOn(fullscreen.active());
    d.addEventListener('fullscreenchange', upd);
    d.addEventListener('webkitfullscreenchange', upd);
    return () => { d.removeEventListener('fullscreenchange', upd); d.removeEventListener('webkitfullscreenchange', upd); };
  }, []);
  if (!ok) return null;
  const label = on ? t('退出全屏') : t('全屏');
  return html`<button type="button" class=${`fsbtn tapx ${cls}`} aria-label=${label} title=${label} aria-pressed=${on ? 'true' : 'false'}
      onClick=${() => fullscreen.toggle()}>
    <${Icon} name=${on ? 'collapse' : 'expand'} />
  </button>`;
}

/**
 * Only a browser-issued install offer shows a button; installed and unsupported environments stay quiet.
 * `square`: the glyph alone (the lobby's top bar, beside ⚙ / 📖), the name stays title / aria-label.
 */
export function PwaInstallButton({ class: cls = '', size = 'sm', square = false }) {
  const [available, setAvailable] = useState(pwaInstall.available);
  useEffect(() => pwaInstall.subscribe(setAvailable), []);
  if (!available) return null;
  return html`<${Button} variant="secondary" size=${size} icon="homePlus" square=${square} class=${cls}
    title=${t('添加到桌面')} aria-label=${t('添加到桌面')}
    data-testid="pwa-install" onClick=${() => pwaInstall.request()}>${square ? null : t('添加到桌面')}<//>`;
}

export function updateRotateHintPwaI18n(doc = globalThis.document) {
  const btn = doc?.getElementById?.('rotate-hint-pwa');
  if (btn) btn.textContent = t('添加到桌面');
}

// ---- boot-time installation ----------------------------------------------------------------------------------------

let installed = null;

/**
 * Install the device handling on this page (idempotent). Returns a disposer (tests).
 * @param {any} [win]
 */
export function installDeviceSupport(win = globalThis) {
  if (installed) return installed;
  const doc = win.document;
  if (!doc?.documentElement) return () => {};
  const root = doc.documentElement;
  const offs = [];
  const on = (target, ev, fn, opts) => { if (!target?.addEventListener) return; target.addEventListener(ev, fn, opts); offs.push(() => target.removeEventListener(ev, fn, opts)); };

  const apply = () => {
    const cls = featureClasses(detectFeatures(win));
    for (const [k, v] of Object.entries(cls)) root.classList.toggle(k, v);
  };
  apply();
  for (const q of ['(any-pointer: coarse)', '(pointer: coarse)', '(any-hover: hover)', '(prefers-reduced-motion: reduce)', '(display-mode: standalone)']) {
    let m = null;
    try { m = win.matchMedia?.(q); } catch { m = null; }
    if (!m) continue;
    if (typeof m.addEventListener === 'function') on(m, 'change', apply);
    else if (typeof m.addListener === 'function') { m.addListener(apply); offs.push(() => m.removeListener(apply)); }  // Safari < 14
  }

  // visible height (the URL bar of mobile browsers comes and goes): --sp-vh = 1 % of the real visible height
  const setVh = () => {
    const h = win.visualViewport?.height || win.innerHeight || 0;
    if (h > 0) root.style.setProperty('--sp-vh', `${h / 100}px`);
  };
  setVh();
  on(win, 'resize', setVh, { passive: true });
  on(win.visualViewport, 'resize', setVh, { passive: true });

  // 切后台回来的全屏恢复（业主 2026-10-16「手机切 qq 后切回来会退出全屏」）。
  //
  // 两条事件配合：
  //   * `fullscreenchange`：浏览器因切后台收走全屏时也会派发它。用它区分「用户自己退的」与「系统收走的」——
  //     页面正在隐藏（hidden）时的退出就是被系统收走的，保留 wanted；其余情况一律当成用户意图，清掉 wanted。
  //   * `visibilitychange` → visible：回到前台再补一次（隐藏时请求必然被拒）。
  const onFsChange = () => {
    if (fullscreen.active(win)) return;                     // 还在全屏（或刚进）：什么都不用做
    if (doc.visibilityState === 'hidden') return;           // 切后台被系统收走 —— 保留意图，回前台再补
    wanted = false;                                          // 用户自己退的（Esc / 按钮 / 系统返回）：别再拉回去
  };
  on(doc, 'fullscreenchange', onFsChange);
  on(doc, 'webkitfullscreenchange', onFsChange);
  on(doc, 'visibilitychange', () => { if (doc.visibilityState === 'visible') void restoreFullscreen(win); });

  // rotation: the new viewport size settles a few frames late on iOS → one more resize after it settles
  let rotTimer = 0;
  const onRotate = () => {
    apply();
    clearTimeout(rotTimer);
    rotTimer = setTimeout(() => { apply(); setVh(); try { win.dispatchEvent(new win.Event('resize')); } catch { /* ignore */ } }, 350);
  };
  on(win, 'orientationchange', onRotate);
  on(win.screen?.orientation, 'change', onRotate);

  // no page zoom while playing (iOS Safari ignores user-scalable=no): pinch gestures and ctrl+wheel are cancelled
  const cancel = (e) => { if (e.cancelable) e.preventDefault(); };
  on(doc, 'gesturestart', cancel, { passive: false });
  on(doc, 'gesturechange', cancel, { passive: false });
  on(doc, 'gestureend', cancel, { passive: false });
  on(doc, 'wheel', (e) => { if (e.ctrlKey && e.cancelable) e.preventDefault(); }, { passive: false });
  // (double-tap zoom and two-finger pinch on Chromium / Firefox / iOS 13+: `touch-action` in css/devices.css — no
  // scroll-blocking touchmove listener, so lists keep scrolling smoothly)

  // long-press = detail on DOM controls: Android fires `contextmenu` on a long press by itself, iOS Safari never does.
  // A touch held still for LONG_PRESS_MS without a native contextmenu gets a synthetic one (the shop cards, reward cards
  // and the fallback board open their detail cards on it), and the click the release would cause is swallowed. The field
  // canvas handles its own long-press (render/drag.js) and is skipped.
  const lp = { timer: 0, x: 0, y: 0, target: null, native: false, fired: false, swallowUntil: 0 };
  const lpCancel = () => { clearTimeout(lp.timer); lp.timer = 0; lp.target = null; };
  on(doc, 'pointerdown', (e) => {
    lpCancel();
    lp.fired = false;
    if (e.pointerType !== 'touch' || !(e.target instanceof win.Element)) return;
    if (e.target.closest('canvas, .gm__field, .fwheel, .ewheel__viewport, input, textarea, select, [contenteditable="true"]')) return;
    lp.x = e.clientX; lp.y = e.clientY; lp.target = e.target; lp.native = false;
    lp.timer = setTimeout(() => {
      const t = lp.target;
      lp.timer = 0;
      if (!t || lp.native || !t.isConnected) return;
      // Only a HANDLED long press (a detail card / a tooltip took it: the handler called preventDefault) swallows the
      // release. A slow tap on a control without a long-press meaning (准备就绪, 撤退, 出售 …) stays a tap — iOS Safari
      // still sends its click, and swallowing it made those buttons ignore any tap held ≥ LONG_PRESS_MS.
      try {
        const ev = new win.MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: lp.x, clientY: lp.y, button: 2, buttons: 0 });
        lp.fired = t.dispatchEvent(ev) === false || ev.defaultPrevented === true;
      } catch { lp.fired = false; }
    }, LONG_PRESS_MS);
  }, { passive: true, capture: true });
  on(doc, 'pointermove', (e) => { if (lp.timer && Math.hypot(e.clientX - lp.x, e.clientY - lp.y) > LONG_PRESS_SLOP) lpCancel(); }, { passive: true, capture: true });
  // the release of a long press (however long it was held) is not a tap: the click that follows it is swallowed
  on(doc, 'pointerup', () => { if (lp.fired) { lp.fired = false; lp.swallowUntil = Date.now() + 700; } lpCancel(); }, { passive: true, capture: true });
  on(doc, 'pointercancel', () => { lp.fired = false; lpCancel(); }, { passive: true, capture: true });
  on(doc, 'contextmenu', (e) => { if (e.isTrusted) lp.native = true; }, { capture: true });
  on(doc, 'click', (e) => {
    if (lp.swallowUntil && Date.now() < lp.swallowUntil) { lp.swallowUntil = 0; e.preventDefault(); e.stopPropagation(); }
  }, { capture: true });

  const pwaBtn = doc?.getElementById?.('rotate-hint-pwa');
  if (pwaBtn) {
    updateRotateHintPwaI18n(doc);
    offs.push(pwaInstall.subscribe((available) => { pwaBtn.hidden = !available; }));
    on(pwaBtn, 'click', () => { pwaInstall.request(); });
  }

  installed = () => { for (const off of offs.splice(0)) { try { off(); } catch { /* ignore */ } } clearTimeout(rotTimer); installed = null; };
  return installed;
}
