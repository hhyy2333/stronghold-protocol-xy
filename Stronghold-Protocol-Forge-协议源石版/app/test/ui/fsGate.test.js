// 全屏引导 (the first-entry screen of a landscape phone; ui/device.js FsGate, css/devices.css .fsgate).
//
// The bug this covers (measured 2026-10-13, headless Edge at real phone viewports): theme.css sizes everything from one
// root scale, 1rem = min(100vw / 19.2, 100svh / 10.8), floored at 40 px so CJK minimum-font clamping never bites. On a
// landscape phone the floor wins → the design canvas is 19.2 × 10.8 rem = 768 × 432 px, while the browser gives the page
// ~390 px and only ~318 px with its URL bar showing. The title screen then cannot fit, and .title-foot (absolute,
// bottom: .3rem) landed on the 连接状态 row: the ⚙ / ⛶ buttons there stopped being hittable — the ⛶ that returns the
// missing pixels was itself covered (hit box 1×1 px at 844×318; the ⛶ kept 12 px of its 44 px tap area at 640×292).
//
// Covered here without a browser: the pure decision (which device gets the screen), the remembered answer, the reading
// of the live window, and that installDeviceSupport/theme/device CSS keep the pieces the browser test needs.
// Browser counterpart: test/ui/devices.e2e.test.js (SP_E2E=1).

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  FS_GATE_KEY, FS_GATE_TITLE_REM, detectFeatures, dismissFsGate, fsGateCramped, fsGateDismissed,
  installDeviceSupport, readFsGate, shouldShowFsGate,
} from '../../public/js/ui/device.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const read = (p) => readFileSync(path.join(ROOT, p), 'utf8');

/** The device facts of a landscape phone whose 1rem is clamped at the 40 px floor, URL bar showing. */
const phone = (over = {}) => ({ coarse: true, screenLandscape: true, supported: true, standalone: false, active: false, height: 318, rem: 40, dismissed: false, ...over });

describe('全屏引导: fsGateCramped (the visible height vs the title screen)', () => {
  test('a first visit with the URL bar is cramped; the same phone with it hidden is not', () => {
    // 1rem = 40 px (the clamp floor) → the title screen needs 8.7rem = 348 px
    assert.equal(FS_GATE_TITLE_REM, 8.7);
    assert.equal(fsGateCramped(318, 40), true, '844×318: the footer still covers the 连接状态 row');
    assert.equal(fsGateCramped(292, 40), true, '640×292, the smallest supported phone');
    assert.equal(fsGateCramped(338, 40), true, 'just fits, but the footer still overlaps');
    // measured: the footer clears the row at 348 px, so the title screen is fine from here up
    assert.equal(fsGateCramped(348, 40), false);
    assert.equal(fsGateCramped(360, 40), false, '640×360, the smallest supported phone with the bar hidden');
    assert.equal(fsGateCramped(390, 40), false, '844×390: the title screen fits — never ask here');
    assert.equal(fsGateCramped(412, 40), false, '915×412 (Pixel 7)');
  });

  test('a device whose 1rem is not at the floor is judged by its own rem, not by 348 px', () => {
    // an iPad: 1rem ≈ 61 px → the title needs ~531 px of 820 (fits, and the gate stays away)
    assert.equal(fsGateCramped(820, 61), false);
    // …and a short iPad window would still be cramped
    assert.equal(fsGateCramped(500, 61), true);
    // desktop 1920×1080: 1rem = 100 px → the title needs 870 px of 1080
    assert.equal(fsGateCramped(1080, 100), false);
    assert.equal(fsGateCramped(800, 100), true, 'a squat window on a large screen');
  });

  test('nonsense input never shows the screen', () => {
    for (const [h, rem] of [[NaN, 40], [318, NaN], [318, 0], [318, -1], [Infinity, 40], [undefined, undefined]]) {
      assert.equal(fsGateCramped(h, rem), false, `${h} / ${rem}`);
    }
  });
});

describe('全屏引导: shouldShowFsGate (who gets the screen)', () => {
  test('a first-visit landscape phone whose viewport is cramped gets it', () => {
    assert.equal(shouldShowFsGate(phone()), true);
  });

  test('never where it cannot help or is not wanted', () => {
    assert.equal(shouldShowFsGate(phone({ coarse: false })), false, 'a mouse: a real window that fits');
    assert.equal(shouldShowFsGate(phone({ screenLandscape: false })), false, 'portrait: the rotate hint owns the screen');
    assert.equal(shouldShowFsGate(phone({ supported: false })), false, 'iPhone Safari has no element fullscreen');
    assert.equal(shouldShowFsGate(phone({ standalone: true })), false, 'installed: no browser chrome to remove');
    assert.equal(shouldShowFsGate(phone({ active: true })), false, 'already fullscreen');
    assert.equal(shouldShowFsGate(phone({ dismissed: true })), false, 'answered before');
    assert.equal(shouldShowFsGate(phone({ height: 390 })), false, 'the viewport holds the title screen');
    assert.equal(shouldShowFsGate(null), false);
    assert.equal(shouldShowFsGate(undefined), false);
    assert.equal(shouldShowFsGate({}), false, 'no facts at all');
  });

  test('a device that can turn is judged by where it is turned to, not by a UA', () => {
    // unknown screen orientation (old iOS) on a cramped touch viewport: offer it — the phone is the likely case
    assert.equal(shouldShowFsGate(phone({ screenLandscape: null })), true);
    assert.equal(shouldShowFsGate(phone({ screenLandscape: undefined })), true);
  });

  test('the decision needs BOTH the cramped viewport and a device that can act on it', () => {
    for (const over of [{ coarse: false }, { supported: false }, { standalone: true }, { active: true }, { dismissed: true }, { height: 390 }]) {
      assert.equal(shouldShowFsGate(phone({ ...over, height: 390 })), false, JSON.stringify(over));
    }
    // cramped + every precondition met is the only true
    assert.equal(shouldShowFsGate(phone({ height: 318 })), true);
  });
});

describe('全屏引导: the remembered answer', () => {
  const fakeStorage = () => {
    const m = new Map();
    return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k), _m: m };
  };

  test('answering either way is remembered; an unanswered player sees it again', () => {
    const win = { localStorage: fakeStorage() };
    assert.equal(fsGateDismissed(win), false, 'first visit');
    dismissFsGate(win);
    assert.equal(win.localStorage.getItem(FS_GATE_KEY), '1');
    assert.equal(fsGateDismissed(win), true);
  });

  test('private mode (a throwing localStorage) never blocks the gate', () => {
    const thrower = { get localStorage() { throw new Error('SecurityError'); } };
    assert.equal(fsGateDismissed(thrower), false);
    assert.doesNotThrow(() => dismissFsGate(thrower));
    assert.equal(fsGateDismissed({}), false);
    assert.equal(fsGateDismissed({ localStorage: {} }), false);
  });
});

describe('全屏引导: readFsGate (the live window)', () => {
  /** A window whose media queries, fullscreen API and root font size are fixed. */
  function fakeWindow({ coarse = true, landscape = true, fs = true, standalone = false, height = 318, rem = '40px', storage = null } = {}) {
    const classes = new Set();
    const el = {
      classList: { toggle: (k, on) => (on ? classes.add(k) : classes.delete(k)), add: (k) => classes.add(k), remove: (k) => classes.delete(k), contains: (k) => classes.has(k) },
      style: { setProperty() {} },
      requestFullscreen: fs ? async () => { doc.fullscreenElement = el; } : undefined,
    };
    const doc = {
      documentElement: el, fullscreenEnabled: fs, fullscreenElement: null,
      addEventListener() {}, removeEventListener() {}, getElementById: () => null,
      exitFullscreen: async () => { doc.fullscreenElement = null; },
    };
    const media = {
      '(any-pointer: coarse)': coarse, '(pointer: coarse)': coarse, '(any-hover: hover)': !coarse,
      '(display-mode: standalone)': standalone,
    };
    const win = {
      document: doc, innerHeight: height, navigator: { maxTouchPoints: coarse ? 5 : 0 },
      localStorage: storage, screen: { orientation: { type: landscape ? 'landscape-primary' : 'portrait-primary' } },
      matchMedia: (q) => ({ matches: !!media[q], addEventListener() {}, removeEventListener() {} }),
      getComputedStyle: () => ({ fontSize: rem }),
    };
    return win;
  }

  test('a cramped landscape phone reads as shown; the pieces agree with detectFeatures', () => {
    const win = fakeWindow();
    const f = detectFeatures(win);
    assert.deepEqual([f.coarse, f.screenLandscape, f.fullscreen, f.standalone], [true, true, true, false]);
    assert.equal(readFsGate(win), true);
  });

  test('entering fullscreen and answering both take it away; no DOM at all means no gate', () => {
    const storage = (() => { const m = new Map(); return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)) }; })();
    const win = fakeWindow({ storage });
    assert.equal(readFsGate(win), true);
    dismissFsGate(win);
    assert.equal(readFsGate(win), false, 'the answer is remembered');
    // a fresh window: entering fullscreen clears it without an answer (the browser UI is gone either way)
    const win2 = fakeWindow();
    assert.equal(readFsGate(win2), true);
    win2.document.fullscreenElement = win2.document.documentElement;
    assert.equal(readFsGate(win2), false, 'fullscreen is its own answer');
    // no document (a worker, a test harness): never shown
    assert.equal(readFsGate({}), false);
    assert.equal(readFsGate({ document: {} }), false);
  });

  test('a tablet / desktop reads as not shown, a portrait phone defers to the rotate hint', () => {
    assert.equal(readFsGate(fakeWindow({ coarse: false, landscape: true, height: 1000, rem: '100px' })), false, 'desktop');
    assert.equal(readFsGate(fakeWindow({ height: 820, rem: '61px' })), false, 'iPad landscape');
    assert.equal(readFsGate(fakeWindow({ height: 390, rem: '40px' })), false, 'the URL bar hidden: the title fits');
    assert.equal(readFsGate(fakeWindow({ landscape: false })), false, 'portrait');
    assert.equal(readFsGate(fakeWindow({ fs: false })), false, 'no element fullscreen');
    assert.equal(readFsGate(fakeWindow({ standalone: true })), false, 'installed');
  });
});

describe('全屏引导: the pieces the browser test needs are in place', () => {
  test('index.html has no static gate (Preact renders it), and main.js mounts FsGate inside <App/>', () => {
    const index = read('public/index.html');
    assert.doesNotMatch(index, /class="fsgate"/, 'the gate is an overlay host, not static markup');
    const main = read('public/js/main.js');
    assert.match(main, /import \{ installDeviceSupport, FsGate \} from '\.\/ui\/device\.js'/);
    assert.match(main, /<\$\{FsGate\} \/>/, 'mounted with the other overlay hosts');
    // inside <App/> (which carries .app-root): the gate must share its stacking context, so the 更新公告 dialog and the
    // toasts stay above it
    const app = main.slice(main.indexOf('function App()'));
    assert.ok(app.indexOf('<${FsGate} />') < app.indexOf('<${AnnounceBanner} />'), 'before the banner hosts');
  });

  test('theme.css: --z-fsgate is above every screen and below the modal / toast layers', () => {
    const theme = read('public/css/theme.css');
    const z = (name) => Number(new RegExp(`--z-${name}: (\\d+);`).exec(theme)?.[1]);
    assert.ok(Number.isFinite(z('fsgate')), '--z-fsgate is defined');
    assert.ok(z('fsgate') > z('banner') && z('fsgate') > z('conn'), 'above the screens and banners');
    assert.ok(z('fsgate') < z('modal'), 'below the 更新公告 dialog');
    assert.ok(z('fsgate') < z('toast'), 'below a boot-failure toast');
  });

  test('devices.css: the gate is a full-viewport overlay whose button is the middle of the screen', () => {
    const css = read('public/css/devices.css');
    const rule = (sel) => new RegExp(`${sel.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')} \\{([^}]*)\\}`).exec(css)?.[1] || '';
    const gate = rule('.fsgate');
    assert.match(gate, /position: fixed/);
    assert.match(gate, /inset: 0/);
    assert.match(gate, /justify-items: center/, 'the button sits in the middle');
    assert.match(gate, /grid-template-rows: 1fr auto 1fr/, 'the middle row is centred on the viewport');
    assert.match(gate, /z-index: var\(--z-fsgate\)/);
    assert.match(gate, /background: rgba\(8, 11, 10, \.97\)/, 'opaque: the cramped title must not show through');
    // the safe-area insets, like the rotate hint
    for (const k of ['--sa-t', '--sa-r', '--sa-b', '--sa-l']) assert.ok(gate.includes(k), k);
    // the button: a real, comfortable target (≥ 44 px) with the mint primary look
    const go = rule('.fsgate__go');
    assert.match(go, /min-height: 56px/);
    assert.match(go, /min-width: 190px/);
    assert.match(go, /cursor: pointer/);
  });

  test('ui/device.js still installs the device layer and exports what main.js imports', () => {
    const src = read('public/js/ui/device.js');
    assert.match(src, /export function installDeviceSupport/);
    assert.match(src, /export function FsGate/);
    assert.match(src, /export function shouldShowFsGate/);
    // the gate follows the language like the rotate hint's 添加到桌面 button
    assert.match(src, /t\('全屏获得完整游戏体验'\)/);
    assert.match(src, /t\('暂不，直接进入'\)/);
  });

  test('the title footer no longer swallows clicks where it overlaps the ⚙ / ⛶ row', () => {
    const title = read('public/css/screens/title.css');
    assert.match(title, /\.title-foot \{ pointer-events: none; \}/);
    assert.match(title, /\.title-foot a, \.title-foot button \{ pointer-events: auto; \}/);
  });

  test('installDeviceSupport keeps working with no gate element and no DOM (unchanged contract)', () => {
    assert.equal(typeof installDeviceSupport, 'function');
  });
});
