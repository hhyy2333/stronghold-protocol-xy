// 按钮点击音 (owner request 2026-11-01 「添加按钮的点击音效」): public/js/audio.js plays one of four cues — 普通点击
// `click-n` / 返回·取消·关闭 `click-back` / 确认·主操作·危险 `click-confirm` / 复选框·开关 `click-tick` — for every press
// on the client's own controls, from ONE delegated listener on the document (`installButtonCues`) instead of a call site
// per button (the client renders ~356 `<button>`s of its own plus `.btn` / checkbox / tab / switch shapes).
//
// What this file guards, and why each part is fragile:
//   1. `buttonCueFor` — the judgement. It reads the CONTROL and not the handler, so a wrong rule is silent (a press
//      plays the wrong file, or none): the four variants of ui/components.js Button (secondary / ghost / primary /
//      danger) map to three different cues, `.gtop__exit` is a `danger` button that must still be a 返回 (the back
//      marks win over the confirm ones), a frozen shop card is still purchasable (`is-frozen` is NOT a disabled mark:
//      ui/shopBar.js fills `disabled` from its own reason and paints the frost on top), and the settings Toggle /
//      the tab bars / the `<button role="radio">` cards of 干员调配 are ticks and not clicks.
//   2. `buttonCueElement` — where the press lands. A click inside a `<button><span>` is the button (closest), the text
//      of a `<label>` that wraps a checkbox ticks that checkbox (5 of the client's 6 checkboxes are written that way:
//      screens/lobby.js 私密房间, screens/room.js rs-opt, ui/hubBackdrop.js bgset__check ×3), while a label around a
//      text field or the settings slider stays silent — and a disabled control is no press at all.
//   3. `buttonCue` — the four files of the local `ui/sfx` group through `installAudio({ buttonCueUrl })`, each at its
//      own gain. A machine without the group resolves null and the client must stay silent-but-working.
//   4. The dedupe (BUTTON_CUE_DEDUPE_MS): an explicit cue of the press wins. `sfx` / `playUrl` mark the press when the
//      element's own handler plays a cue, `markPress()` marks it from `act()`'s entry (ui/gameActions.js — the request's
//      own `buy` / `refresh` / `ready` cue lands a round trip LATER, so a 120 ms window cannot bridge it; the mark has
//      to be taken inside the press), and `_onCuePress` (pointerdown / keydown, capture) clears it so the NEXT press
//      sounds. Without that clear a fast double press would be swallowed for 120 ms.
//   5. The listener wiring: one install, three listeners (pointerdown / keydown capture, click bubble — the element
//      handlers run before the document's click, which is what makes the mark usable).
//
// No browser and no new dependency: a stub element implements only what the judgement reads (closest / getAttribute /
// className / tagName / control), a stub document records the listeners, and `_play` is monkeypatched so a cue is an
// entry in an array. `cueNow` is module-private, so the timing cases set `_cueAt` through the same clock the
// implementation reads (performance.now, else Date.now) instead of sleeping.

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  AudioManager, BUTTON_CUE_FILES, BUTTON_CUE_VOLUME, BUTTON_CUE_DEDUPE_MS, BUTTON_CUE_SELECTOR,
  buttonCueFor, buttonCueElement, buttonCueDisabled,
} from '../../public/js/audio.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const read = (p) => readFileSync(path.join(ROOT, p), 'utf8');

// ---- stub elements ---------------------------------------------------------------------------------------------
//
// A `closest(sel)` that understands exactly the selectors this feature uses (a comma list of `button`, `.btn`,
// `input[type="…"]`, `[attr]`, `[attr="value"]`, `label`), walking the stub's own `parent` chain.

/** @param {any} node @param {string} sel @returns {boolean} */
function stubMatches(node, sel) {
  if (sel === 'button') return node.tagName === 'BUTTON';
  if (sel === 'a') return node.tagName === 'A';
  if (sel === 'label') return node.tagName === 'LABEL';
  if (sel === 'select') return node.tagName === 'SELECT';
  if (sel === '.btn') return String(node.className).split(/\s+/).includes('btn');
  let m = /^input\[type="([^"]*)"\]$/.exec(sel);
  if (m) return node.tagName === 'INPUT' && node.getAttribute('type') === m[1];
  m = /^\[([\w-]+)="([^"]*)"\]$/.exec(sel);
  if (m) return node.getAttribute(m[1]) === m[2];
  m = /^\[([\w-]+)\]$/.exec(sel);
  if (m) return node.getAttribute(m[1]) !== null;
  return false;
}

/** @param {any} node @param {string} sel comma-separated selector list @returns {any|null} */
function stubClosest(node, sel) {
  const parts = String(sel).split(',').map((s) => s.trim()).filter(Boolean);
  for (let cur = node; cur; cur = cur.parent) for (const part of parts) if (stubMatches(cur, part)) return cur;
  return null;
}

/**
 * One stub element. `attrs` feed `getAttribute` verbatim (so `aria-disabled="true"` and `data-sfx="back"` are strings);
 * `disabled` is a property like the DOM's own, and `_inner` / `control` are the two ways a `<label>` names its input.
 * @param {string} tag @param {string} [className] @param {Record<string, string>} [attrs] @param {any} [parent]
 */
function mk(tag, className = '', attrs = {}, parent = null) {
  const self = {
    tagName: String(tag).toUpperCase(),
    className,
    parent,
    disabled: false,
    control: null,
    _inner: null,
    getAttribute: (k) => (Object.hasOwn(attrs, k) ? attrs[k] : null),
    // the label's own input, but only when it matches the query — a label around a text field or the settings slider
    // answers null to `input[type="checkbox"], input[type="radio"]` (the real DOM does, and `labelCueControl` relies on it)
    querySelector: (sel) => (self._inner && String(sel).split(',').some((part) => stubMatches(self._inner, part.trim())) ? self._inner : null),
    closest: (sel) => stubClosest(self, sel),
  };
  return self;
}

/** A plain `<button class="…">` of the client. */
const btn = (cls, attrs = {}, parent = null) => mk('BUTTON', cls, attrs, parent);
/** The `<span>` / `<img>` text inside a control (a click there must resolve to the control). */
const inside = (parent, tag = 'SPAN', cls = '') => mk(tag, cls, {}, parent);

// ---- stub audio manager ----------------------------------------------------------------------------------------

const MANIFEST = Object.freeze({
  audio: {
    sfx: {
      ui: { click: '/assets/manifest/g_ui_btn_h.mp3', back: '/assets/manifest/g_ui_btn_u.mp3', buy: '/assets/manifest/b_char_tokenset.mp3' },
    },
  },
});

/** The four local files, as `installAudio({ buttonCueUrl })` resolves them on a machine that has the group. */
const CUE_URL = (file) => `/assets/local/ui/sfx/${file}.mp3`;

/** A document that records what the feature registers, so a press can be driven phase by phase. */
function fakeDoc() {
  /** @type {{ type: string, capture: boolean }[]} */
  const added = [];
  /** @type {Map<string, Function>} */
  const listeners = new Map();
  const document = {
    hidden: false,
    addEventListener(type, fn, opts) {
      added.push({ type, capture: opts?.capture === true });
      listeners.set(`${type}:${opts?.capture === true ? 'capture' : 'bubble'}`, fn);
    },
    removeEventListener() {},
  };
  return {
    document,
    added,
    /** the capture phases: a new press / a new key */
    press: () => listeners.get('pointerdown:capture')?.({ target: null }),
    key: () => listeners.get('keydown:capture')?.({ target: null }),
    /** the bubble phase: every element handler of the press has run */
    click: (target) => listeners.get('click:bubble')?.({ target }),
    get registered() { return added.length; },
  };
}

/**
 * An AudioManager wired to a stub document, with `_play` replaced by a recorder.
 * @param {{ resolve?: (file: string) => string|null }} [o]
 */
function setup(o = {}) {
  const doc = fakeDoc();
  const am = new AudioManager({ win: { document: doc.document }, getManifest: () => MANIFEST });
  /** @type {{ url: string, volume: number }[]} */
  const played = [];
  am._play = (url, opts) => { played.push({ url, volume: opts?.volume }); };
  const resolve = o.resolve === undefined ? CUE_URL : o.resolve;
  am.installButtonCues(typeof resolve === 'function' ? resolve : undefined);
  return { am, doc, played };
}

/** The clock the implementation reads (`cueNow`, audio.js), so the timing cases need no sleep. */
const now = () => (typeof performance !== 'undefined' && typeof performance.now === 'function' ? performance.now() : Date.now());

// ---- the shapes the client actually renders --------------------------------------------------------------------

describe('buttonCueFor：元素形态判定表', () => {
  /** @type {[string, any, string|null][]} */
  const CASES = [
    // ui/components.js Button — the four variants the client uses (secondary 53 / ghost 31 / primary 21 / danger 7)
    ['Button variant="secondary" → 普通点击', btn('btn btn--secondary btn--md'), 'click'],
    ['Button variant="amber"（详情卡 出售）→ 普通点击', btn('btn btn--amber btn--md'), 'click'],
    ['Button variant="ice" → 普通点击', btn('btn btn--ice btn--md'), 'click'],
    ['Button variant="ghost"（Modal 取消 / 清空）→ 返回', btn('btn btn--ghost btn--md'), 'back'],
    ['Button variant="primary"（确认框 确定）→ 确认', btn('btn btn--primary btn--md'), 'confirm'],
    ['Button variant="danger"（危险操作 确定）→ 确认', btn('btn btn--danger btn--md'), 'confirm'],
    ['btn--square 不该被读成任何标记 → 普通点击', btn('btn btn--secondary btn--square btn--sm'), 'click'],

    // the HUD's 离开 is the danger variant but a BACK press (ui/hud.js gtop__exit): back marks are read before confirm
    ['HUD 离开（danger + gtop__exit）→ 返回', btn('btop gtop__exit btn btn--danger btn--lg'), 'back'],
    ['gtop__exit 单独（class 顺序无关）→ 返回', btn('btn btn--primary gtop__exit'), 'back'],
    ['HUD CheckBtn 返回态（is-back）→ 返回', btn('gtop__iconbtn is-back tapx'), 'back'],
    ['HUD CheckBtn 普通态 → 普通点击', btn('gtop__iconbtn tapx'), 'click'],

    // ui/shopBar.js — a frozen card is buyable, a disabled one is not
    ['商店卡（冻结 = 冻住不刷新，仍可买）→ 普通点击', btn('scard scard--t3 is-frozen'), 'click'],
    ['商店卡（冻结 + 已武装两段确认）→ 普通点击', btn('scard scard--t3 is-frozen is-armed'), 'click'],
    ['商店卡（买不起，点开详情）→ 不响', btn('scard scard--t3 is-disabled'), 'null'],
    ['升级卡（资金不足，shopBar.js lvcard）→ 不响', btn('lvcard is-max is-disabled', { 'aria-disabled': 'true' }), 'null'],

    // disabled is expressed four ways in this client; three of them are read here (pointer-events:none is decoration)
    ['disabled 属性 → 不响', Object.assign(btn('btn btn--secondary btn--md'), { disabled: true }), 'null'],
    ['aria-disabled="true"（HUD CheckBtn 灰态）→ 不响', btn('enemybtn is-grey tapx', { 'aria-disabled': 'true' }), 'null'],
    ['aria-disabled="false" 不等于禁用 → 普通点击', btn('gtop__iconbtn tapx', { 'aria-disabled': 'false' }), 'click'],
    ['.is-disabled（盟约钮 BondDisc）→ 不响', btn('bond bond--sm is-disabled is-clickable'), 'null'],
    ['.is-loading（Button loading）→ 不响', btn('btn btn--primary btn--md is-loading'), 'null'],
    ['.is-busy（ReadyToggle 在请求中）→ 不响', btn('readybtn tapx is-busy'), 'null'],

    // tick shapes: the settings Toggle, the tab bars, the radio cards
    ['role="switch"（设置 → Toggle）→ 勾选', btn('set-toggle is-on', { role: 'switch' }), 'tick'],
    ['role="switch"（插件面板）→ 勾选', btn('set-toggle plugrow__switch is-on', { role: 'switch' }), 'tick'],
    ['role="tab"（页签）→ 勾选', btn('lo-tab is-on', { role: 'tab' }), 'tick'],
    ['role="radio"（干员调配 技能格）→ 勾选', btn('lo-skill is-on', { role: 'radio' }), 'tick'],
    ['role="checkbox" → 勾选', btn('chip is-on', { role: 'checkbox' }), 'tick'],
    ['class 带 toggle（无 role 的开关）→ 勾选', btn('set-toggle is-on'), 'tick'],

    // a checkbox / radio input, and the label around it
    ['input[type=checkbox] 本体 → 勾选', mk('INPUT', '', { type: 'checkbox' }), 'tick'],
    ['input[type=radio] 本体 → 勾选', mk('INPUT', '', { type: 'radio' }), 'tick'],
    ['复选框 label 里的文字（label.control）→ 勾选', (() => {
      const label = mk('LABEL', 'bgset__check');
      label.control = mk('INPUT', '', { type: 'checkbox' });
      return inside(label);
    })(), 'tick'],
    ['复选框 label 里的文字（querySelector 兜底）→ 勾选', (() => {
      const label = mk('LABEL', 'st-field-row');
      label._inner = mk('INPUT', '', { type: 'checkbox' });
      return inside(label);
    })(), 'tick'],
    ['包着禁用复选框的 label → 不响', (() => {
      const label = mk('LABEL', 'rs-opt');
      label.control = Object.assign(mk('INPUT', '', { type: 'checkbox' }), { disabled: true });
      return inside(label);
    })(), 'null'],
    ['包着文本框的 label（ui/components.js field）→ 不响', (() => {
      const label = mk('LABEL', 'field field--md');
      label._inner = mk('INPUT', '', { type: 'text' });
      return inside(label);
    })(), 'null'],
    ['设置 → 音量滑杆的 label → 不响（range 不是点击音）', (() => {
      const label = mk('LABEL', 'set-row');
      label._inner = mk('INPUT', '', { type: 'range' });
      return inside(label);
    })(), 'null'],

    // presses that are not interface presses
    ['<select>（插件设置的枚举行）→ 不响', mk('SELECT', '', {}), 'null'],
    ['<select> 在 label 里（同一行没有复选框）→ 不响', (() => {
      const label = mk('LABEL', 'st-field-row plugin-settings__row');
      const select = mk('SELECT', '', {}, label);
      return select;
    })(), 'null'],
    ['棋盘 canvas（closest 无命中）→ 不响', (() => {
      const host = mk('DIV', 'gm__field');
      return mk('CANVAS', '', {}, host);
    })(), 'null'],
    ['棋盘整体带 data-nosfx → 不响', (() => {
      const host = mk('DIV', 'gm__field', { 'data-nosfx': '' });
      return mk('DIV', 'gm__field__inner', {}, host);
    })(), 'null'],
    ['text 节点所在的普通 div → 不响', mk('DIV', 'modal__text'), 'null'],

    // data-sfx overrides
    ['data-sfx="confirm" 覆盖 secondary 的判定 → 确认', btn('btn btn--secondary', { 'data-sfx': 'confirm' }), 'confirm'],
    ['data-sfx="back" 覆盖 primary 的判定 → 返回', btn('btn btn--primary', { 'data-sfx': 'back' }), 'back'],
    ['data-sfx 大小写与空格容错 → 勾选', btn('btn btn--secondary', { 'data-sfx': ' TICK ' }), 'tick'],
    ['data-sfx="none" → 不响', btn('btn btn--secondary', { 'data-sfx': 'none' }), 'null'],
    ['data-sfx 拼错（原型链上的名字）→ 不响', btn('btn btn--secondary', { 'data-sfx': 'constructor' }), 'null'],
    ['data-sfx="none" 的祖先吞掉整块 → 不响', (() => {
      const wrap = mk('DIV', 'shopwrap', { 'data-sfx': 'none' });
      return btn('btn btn--secondary', {}, wrap);
    })(), 'null'],
    ['禁用优先于 data-sfx（不点就不响）', Object.assign(btn('btn btn--secondary', { 'data-sfx': 'back' }), { disabled: true }), 'null'],

    // the press lands on a child element
    ['<button> 里的 <span> → 普通点击', (() => {
      const b = btn('btn btn--secondary btn--md');
      return inside(b);
    })(), 'click'],
    ['<button> 里的 <span> + .btn--ghost → 返回', (() => {
      const b = btn('btn btn--ghost btn--md');
      return inside(b);
    })(), 'back'],
    ['.btn 样式的 <a> → 普通点击', mk('A', 'btn btn--secondary', { href: '#x' }), 'click'],
    ['type="submit" 的表单按钮 → 确认', mk('BUTTON', 'formbtn', { type: 'submit' }), 'confirm'],
  ];

  for (const [why, el, want] of CASES) {
    test(why, () => assert.equal(buttonCueFor(el), want === 'null' ? null : want));
  }

  test('不在控件里 / 没有 closest 的 target：一律 null（不抛错）', () => {
    assert.equal(buttonCueElement(null), null);
    assert.equal(buttonCueElement(undefined), null);
    assert.equal(buttonCueElement({}), null);
    assert.equal(buttonCueFor({}), null);
    assert.equal(buttonCueFor({ closest: () => { throw new Error('boom'); } }), null);
  });

  test('buttonCueDisabled：非对象算禁用，is-frozen 不算', () => {
    assert.equal(buttonCueDisabled(null), true);
    assert.equal(buttonCueDisabled('button'), true);
    assert.equal(buttonCueDisabled(btn('scard is-frozen')), false);
    assert.equal(buttonCueDisabled(btn('scard is-disabled')), true);
  });
});

// ---- the four files --------------------------------------------------------------------------------------------

describe('buttonCue：四个音与增益', () => {
  test('四个名字 → 四个文件，各按自己的增益播放', () => {
    const { am, played } = setup();
    for (const name of ['click', 'back', 'confirm', 'tick']) {
      const ok = am.buttonCue(name);
      assert.equal(ok, true, `${name} 应当播出`);
      assert.deepEqual(played.at(-1), { url: CUE_URL(BUTTON_CUE_FILES[name]), volume: BUTTON_CUE_VOLUME[name] }, name);
    }
    assert.deepEqual(played.map((p) => p.url), [
      '/assets/local/ui/sfx/click-n.mp3', '/assets/local/ui/sfx/click-back.mp3',
      '/assets/local/ui/sfx/click-confirm.mp3', '/assets/local/ui/sfx/click-tick.mp3',
    ]);
  });

  test('确认比普通响、勾选比普通轻（一行复选框不该读成按钮）', () => {
    assert.ok(BUTTON_CUE_VOLUME.confirm > BUTTON_CUE_VOLUME.click);
    assert.ok(BUTTON_CUE_VOLUME.tick < BUTTON_CUE_VOLUME.click);
  });

  test('这台机器没有 ui/sfx 组（resolver 返回 null）⇒ 不播、返回 false、不抛错', () => {
    const { am, played } = setup({ resolve: () => null });
    for (const name of ['click', 'back', 'confirm', 'tick']) assert.equal(am.buttonCue(name), false);
    assert.equal(played.length, 0);
  });

  test('未知名字不播（buttonCue 只认 BUTTON_CUE_FILES 的键）', () => {
    const { am, played } = setup();
    assert.equal(am.buttonCue('bogus'), false);
    assert.equal(am.buttonCue('none'), false);
    assert.equal(played.length, 0);
    // 注：buttonCue 的守卫是 `name in BUTTON_CUE_FILES`，所以原型链上的名字（toString / constructor）今天仍会通过
    // 那一道，再被 resolver 挡掉（本机 ui/sfx 组里没有那个键）。改成 Object.hasOwn 是一处一行的收口；在那之前，
    // 可达路径由下一条测试守：_onCueClick 只交 buttonCueFor 认过的名字。
  });

  test('_onCueClick 只把 buttonCueFor 认的名字交给 buttonCue（原型链上的名字进不来）', () => {
    const { am, doc, played } = setup({ resolve: () => '/x.mp3' });   // 一个什么都答的 resolver，最宽松的情形
    for (const junk of ['toString', 'constructor', 'hasOwnProperty']) {
      doc.press();
      doc.click(btn('btn btn--secondary', { 'data-sfx': junk }));
    }
    assert.equal(played.length, 0);
    doc.press();
    doc.click(btn('btn btn--secondary', { 'data-sfx': 'back' }));
    assert.deepEqual(played.map((p) => p.url), ['/x.mp3'], '认得的名字照常响');
    assert.ok(am);
  });

  test('resolver 拿到的是文件名而不是角色名（本机 ui/sfx 组的键是 click-n 之类）', () => {
    const asked = [];
    const { am } = setup({ resolve: (file) => { asked.push(file); return CUE_URL(file); } });
    am.buttonCue('click');
    am.buttonCue('tick');
    assert.deepEqual(asked, ['click-n', 'click-tick']);
    assert.deepEqual(BUTTON_CUE_FILES, { click: 'click-n', back: 'click-back', confirm: 'click-confirm', tick: 'click-tick' });
  });
});

// ---- the dedupe ------------------------------------------------------------------------------------------------

describe('一次按下只响一声：显式音优先', () => {
  test('元素处理器同步播了 sfx() ⇒ document 的 click 不再补一声', () => {
    const { am, doc, played } = setup();
    const b = btn('btn btn--secondary');
    doc.press();
    am.sfx('click');                       // 处理器里的那一声（HUD CheckBtn / 盟约钮 / 朝向轮 ✕ …）
    doc.click(b);
    assert.deepEqual(played.map((p) => p.url), ['/assets/manifest/g_ui_btn_h.mp3']);
  });

  test('playUrl() 打的是同一个标（协议源石 hexCue 那一路）', () => {
    const { am, doc, played } = setup();
    doc.press();
    am.playUrl('/assets/local/hextech/audio/selectGold.mp3');
    doc.click(btn('scard scard--t3'));
    assert.equal(played.length, 1);
    assert.equal(played[0].url, '/assets/local/hextech/audio/selectGold.mp3');
  });

  test('markPress()（act() 入口）之后，这次 click 不补声：业务音在往返之后自己会响', () => {
    const { am, doc, played } = setup();
    doc.press();
    am.markPress();                        // ui/gameActions.js act() 第一行
    doc.click(btn('scard scard--t3'));
    assert.equal(played.length, 0, 'click 不该在 buy 音之前再响一次');
    am.sfx('buy');                         // 请求回来之后才播的那一声
    assert.deepEqual(played.map((p) => p.url), ['/assets/manifest/b_char_tokenset.mp3']);
  });

  test('下一次按下清零标记：连按两次，第二次照常响', () => {
    const { am, doc, played } = setup();
    const b = btn('btn btn--secondary');
    doc.press();
    am.markPress();
    doc.click(b);
    assert.equal(played.length, 0);
    doc.press();                           // 新的一次按下
    doc.click(b);
    assert.deepEqual(played.map((p) => p.url), [CUE_URL('click-n')]);
  });

  test('键盘激活（keydown 无 pointerdown）也清零，Space 按下的按钮照常响', () => {
    const { am, doc, played } = setup();
    am.markPress();                        // 上一次动作留下的标
    doc.key();
    doc.click(btn('btn btn--primary'));
    assert.deepEqual(played.map((p) => p.url), [CUE_URL('click-confirm')]);
  });

  test(`窗口内（< ${BUTTON_CUE_DEDUPE_MS}ms）不补声，窗口外照常响`, () => {
    const { am, doc, played } = setup();
    const b = btn('btn btn--secondary');
    am._cueAt = now() - (BUTTON_CUE_DEDUPE_MS - 40);
    doc.click(b);
    assert.equal(played.length, 0);
    am._cueAt = now() - (BUTTON_CUE_DEDUPE_MS + 40);
    doc.click(b);
    assert.deepEqual(played.map((p) => p.url), [CUE_URL('click-n')]);
  });

  test('去重窗口短于一次真实往返：窗口本身不许跨网络（act 必须用 markPress）', () => {
    assert.ok(BUTTON_CUE_DEDUPE_MS > 0 && BUTTON_CUE_DEDUPE_MS <= 200,
      '太宽会把下一次按下一起吞掉');
  });

  test('落点不是控件（棋盘 canvas）时 click 什么也不做，标记也不消耗', () => {
    const { am, doc, played } = setup();
    am.markPress();
    doc.click(mk('CANVAS', '', {}, mk('DIV', 'gm__field')));
    assert.equal(played.length, 0);
    assert.ok(am._cueAt, 'markPress 打的标还在，等下一次真正的按下清零');
  });
});

// ---- the wiring ------------------------------------------------------------------------------------------------

describe('installButtonCues：一条委托监听', () => {
  test('注册三条监听：pointerdown / keydown 在 capture（先到的相位），click 在 bubble（后到的相位）', () => {
    const { doc } = setup();
    assert.deepEqual(doc.added, [
      { type: 'pointerdown', capture: true },
      { type: 'keydown', capture: true },
      { type: 'click', capture: false },
    ]);
  });

  test('装两次只注册一份监听', () => {
    const media = fakeDoc();
    const am = new AudioManager({ win: { document: media.document }, getManifest: () => MANIFEST });
    am._play = () => {};
    am.installButtonCues(CUE_URL);
    am.installButtonCues(CUE_URL);
    am.installButtonCues(CUE_URL);
    assert.equal(media.registered, 3);
    assert.equal(am.cuesInstalled, true);
  });

  test('非函数 resolver 不覆盖已装好的那一个', () => {
    const { am } = setup();
    const before = am.cueUrl;
    am.installButtonCues('nope');
    am.installButtonCues(42);
    assert.equal(am.cueUrl, before);
  });

  test('没有 document（Node / 老浏览器）时不抛错、也不假装装好了', () => {
    const am = new AudioManager({ win: {}, getManifest: () => MANIFEST });
    am.installButtonCues(CUE_URL);
    assert.equal(am.cuesInstalled, false);
  });

  test('一次完整按下：pointerdown → 处理器 → document click，听到的正好一声', () => {
    const { am, doc, played } = setup();
    doc.press();
    doc.click(btn('btn btn--ghost btn--md'));
    assert.deepEqual(played, [{ url: CUE_URL('click-back'), volume: BUTTON_CUE_VOLUME.back }]);
    // 双击的第二下：上次的标已被新的 pointerdown 清掉
    doc.press();
    doc.click(btn('btn btn--ghost btn--md'));
    assert.equal(played.length, 2);
    assert.equal(am.unlocked, false, '放音不该顺手解锁 AudioContext');
  });
});

// ---- the selector's coverage -----------------------------------------------------------------------------------

describe('BUTTON_CUE_SELECTOR：会响的形态都在里面', () => {
  test('四个 class / 标签形态一个都不能少（少一个就等于整类控件静音）', () => {
    const sel = BUTTON_CUE_SELECTOR;
    for (const part of ['button', '.btn', 'input[type="checkbox"]', 'input[type="radio"]',
      '[role="button"]', '[role="switch"]', '[role="checkbox"]', '[role="tab"]']) {
      assert.ok(sel.includes(part), `选择器缺 ${part}`);
    }
    assert.ok(!sel.includes('select'), '<select> 有意不在里面（它没有“按下”的一刻）');
  });
});

// ---- the cancel buttons that must sound like 返回 ---------------------------------------------------------------

describe('取消 / 返回按钮带 data-sfx="back"（源码扫描）', () => {
  // ui/components.js Button 的 variant 只有六个（primary / secondary / danger / amber / ice / ghost），而「取消」在
  // 这个客户端里几乎都是 secondary（＝普通点击）：这几个按下就关掉一个弹窗/流程的地方因此显式标 back。这里守的是
  // 那几处标记不被顺手删掉——删了不会报错，只会让「取消」听起来和「确定」一样。
  const SITES = [
    ['public/js/ui/components.js', 1, 'DialogHost 的取消（confirmDialog / alertDialog）'],
    ['public/js/ui/equipReplace.js', 1, '装备替换弹窗的取消'],
    ['public/js/ui/matchChrome.js', 2, '对局外壳的两处取消'],
    ['public/js/screens/lobby.js', 1, '大厅的「取消搜寻」'],
    ['public/js/ui/hud.js', 1, '观战席弹窗的「关闭」'],
    ['public/js/ui/lobbyMusic.js', 1, '大厅音乐弹窗的「关闭」'],
    ['public/js/ui/matchInfo.js', 1, '本局信息弹窗的「关闭」'],
  ];
  for (const [file, count, why] of SITES) {
    test(`${file}：${why}仍带 data-sfx="back"`, () => {
      const hits = read(file).split('\n').filter((line) => /variant="secondary"[^>]*data-sfx="back"/.test(line));
      assert.equal(hits.length, count, `${file} 里 variant="secondary" + data-sfx="back" 的行数变了`);
    });
  }

  test('两个对话框的取消在源码里确实指向 back（不是 primary / danger）', () => {
    const dialog = read('public/js/ui/components.js');
    assert.match(dialog, /isConfirm \? html`<\$\{Button\} variant="secondary" data-sfx="back" onClick=\$\{\(\) => closeDialog\(d\.id, false\)\}/);
  });
});
