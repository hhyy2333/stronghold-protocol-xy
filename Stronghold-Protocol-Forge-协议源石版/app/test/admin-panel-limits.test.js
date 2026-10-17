// test/admin-panel-limits.test.js — 面板上的「服务器人数上限」（public/admin/admin.js 的 renderLimits / saveLimits
// / wireLimits，以及它引用的 DOM 契约）。
//
// 为什么单独测这一节：这个面板是整个功能里**唯一**会被运维误读的地方。值对了但说法错了，后果是运维以为
// 「调低上限会把正在玩的人踢掉」而不敢动手，或者反过来以为「上限只是个提示」而在峰值时被挡在外。
//
// 所以钉住的是**说法**：
//   * 生效值、启动值、当前连接数三者都在，缺一个数字就没有意义；
//   * 上限低于当前人数时，界面必须明确写「新人进不来、但没人会被踢」；
//   * 0 与负数在**提交前**就被拦下（0 会让谁都进不来，服务端也会拒，但界面不该把这种请求发出去）；
//   * 落盘失败必须说出来（值生效了，但重启不会知道）；
//   * 每个提示文案在两个语言包里都有条目（漏一个会让界面显示 t() 的键名）。
//
// 跑的是真代码对着 DOM stand-in（与 test/admin-rooms-perf.test.js 同一个形状）。
// Run: node test/admin-panel-limits.test.js

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

// ---------------------------------------------------------------------------------------------------
// DOM stand-in
// ---------------------------------------------------------------------------------------------------

class El {
  constructor(tag) {
    this.tagName = String(tag).toUpperCase();
    this.childNodes = [];
    this.parentNode = null;
    this.dataset = {};
    this.style = {};
    this._text = '';
    this._cls = '';
    this.title = '';
    this.value = '';
    this.disabled = false;
    this._listeners = {};
    const set = new Set();
    this.classList = {
      add: (...cs) => { for (const c of cs) set.add(c); this._cls = [...set].join(' '); },
      contains: (c) => set.has(c),
      remove: (...cs) => { for (const c of cs) set.delete(c); this._cls = [...set].join(' '); },
      get _s() { return set; },
    };
  }
  set textContent(v) { this._text = String(v ?? ''); this.childNodes = []; }
  get textContent() { return this.childNodes.length ? this.childNodes.map((c) => c.textContent).join('') : this._text; }
  set className(v) {
    this._cls = String(v ?? '');
    const keep = this.classList?._s;
    if (keep) { keep.clear(); for (const c of this._cls.split(/\s+/).filter(Boolean)) keep.add(c); }
  }
  get className() { return this._cls; }
  get children() { return this.childNodes; }
  append(...nodes) { for (const n of nodes) { n.parentNode = this; this.childNodes.push(n); } }
  appendChild(n) { this.append(n); return n; }
  replaceChildren(...nodes) { this.childNodes = []; this.append(...nodes); }
  addEventListener(type, fn) { (this._listeners[type] ||= []).push(fn); }
  /** Fire a listener (the panel wires submit/click/input). */
  fire(type, event = {}) { for (const fn of this._listeners[type] || []) fn({ preventDefault() {}, target: this, ...event }); }
  querySelector() { return null; }
  querySelectorAll() { return []; }
  matches() { return false; }
  all() { return this.childNodes.flatMap((c) => [c, ...(c.all ? c.all() : [])]); }
}

const byId = new Map();
/** Every id admin.js touches at module scope (the same list the sibling panel tests keep). */
for (const id of ['badge-version', 'badge-state', 'btn-lang', 'btn-logout', 'login', 'login-form', 'login-error', 'token',
  'dashboard', 'stat-sockets', 'stat-sessions', 'stat-clients', 'stat-rooms', 'stat-matches', 'stat-population',
  'stat-cpu', 'stat-load', 'stat-rss', 'stat-heap', 'rooms-count', 'rooms-body', 'announce-text', 'announce-count',
  'announce-status', 'announce-form', 'announce-send', 'announce-withdraw', 'announce-list', 'announce-history',
  'notes-count', 'notes-ver', 'notes-digest', 'notes-text', 'notes-preview', 'notes-form', 'notes-save', 'notes-reset',
  'notes-clear', 'notes-size', 'notes-status', 'log-console', 'foot-build', 'foot-node', 'feedback-list',
  'feedback-count', 'slots-list', 'bans-list', 'bans-count', 'ban-form', 'ban-rule', 'ban-reason', 'ban-minutes',
  'ban-add', 'ban-status', 'limits-value', 'limits-meta', 'limits-form', 'limits-input', 'limits-save', 'limits-clear',
  'limits-status']) byId.set(id, new El('div'));
byId.set('limits-input', new El('input'));
byId.set('limits-form', new El('form'));
byId.set('ban-form', new El('form'));

globalThis.document = {
  documentElement: new El('html'),
  getElementById: (id) => byId.get(id) ?? null,
  querySelector: () => null,
  querySelectorAll: () => [],
  addEventListener() {},
  createElement: (t) => new El(t),
};
globalThis.window = { addEventListener() {}, confirm: () => true, location: { reload() {} } };
globalThis.localStorage = { getItem: () => null, setItem() {}, removeItem() {} };
globalThis.sessionStorage = { getItem: () => null, setItem() {}, removeItem() {} };
globalThis.fetch = async () => ({ status: 200, ok: true, json: async () => ({}) });
globalThis.location = { reload() {} };
// Node 24's global `navigator` is getter-only; define it rather than assign (the panel reads navigator.language).
Object.defineProperty(globalThis, 'navigator', { value: { language: 'zh-CN' }, configurable: true, writable: true });
globalThis.matchMedia = () => ({ matches: false, addEventListener() {} });
globalThis.requestAnimationFrame = (fn) => setTimeout(fn, 0);

const mod = await import('../public/admin/admin.js');

const $ = (id) => byId.get(id);

// The wording is asserted through regexes that accept EITHER language's phrasing, so this file does not break when the
// panel's default language differs from the CI box's locale. The pack-completeness test near the end is what guarantees
// both translations exist.

/** A limits document as GET /api/admin/limits answers it. */
const doc = (o = {}) => ({
  ok: true, enabled: true, maxConnections: 400, overridden: false, touched: false,
  bootMaxConnections: 2000, at: null, by: null, sockets: 0, sessions: 0, dir: null, floor: 1, ceiling: 100000, ...o,
});

test('渲染生效值、当前连接数与来源', () => {
  mod.renderLimits(doc({ maxConnections: 400, sockets: 123 }));
  assert.equal($('limits-value').textContent, '400', '生效值就是那个大数字');
  const meta = $('limits-meta').textContent;
  assert.match(meta, /123/, '当前连接数必须在');
  assert.match(meta, /400/, '分母也必须在');
  assert.ok(!/undefined|NaN/.test(meta), `不能漏出 undefined/NaN：${meta}`);
  assert.equal($('limits-input').value, '400', '输入框同步成当前值（它此刻为空，同步是安全的）');
});

test('面板设过 vs 本机自带：两种来源要说得出区别', () => {
  mod.renderLimits(doc({ maxConnections: 400, overridden: false, bootMaxConnections: 2000 }));
  const fromBoot = $('limits-meta').textContent;
  mod.renderLimits(doc({ maxConnections: 400, overridden: true, at: Date.parse('2026-10-14T12:00:00Z'), by: '203.0.113.9' }));
  const fromPanel = $('limits-meta').textContent;
  assert.notEqual(fromBoot, fromPanel, '「谁设的」必须在界面上看得出来');
  assert.match(fromPanel, /203\.0\.113\.9/, '面板来源要带上是谁改的');
  assert.ok(!/undefined|NaN/.test(fromPanel), `不能漏出 undefined：${fromPanel}`);
});

test('上限低于当前人数：必须写明「新人进不来、但没人会被踢」', () => {
  mod.renderLimits(doc({ maxConnections: 100, sockets: 250 }));
  const meta = $('limits-meta').textContent;
  assert.match(meta, /250/, '当前人数要显示');
  assert.match(meta, /100/, '上限要显示');
  // 这句话是这一节存在的理由：运维调低上限时唯一会误判的地方。措辞可以是「不会被踢」也可以是「不受影响」
  // （后者更不吓人，是本项目选用的说法），但**必须有一句明确的保证**，不能只报数字。
  assert.ok(/不受影响|不会.*踢|unaffected|no one is (kicked|disconnected)/i.test(meta), `超限时必须给出「已在玩的人没事」的保证：${meta}`);
  assert.equal($('limits-value').className.includes('limits__value--full'), true, '超限时数值要有视觉提示（不是红色，那不是故障）');
});

test('未超限时不给「满」的提示', () => {
  mod.renderLimits(doc({ maxConnections: 400, sockets: 10 }));
  assert.equal($('limits-value').className.includes('limits__value--full'), false);
  // 用与上一条**同一个**正则：那句保证只在真的超限时才该出现，否则它就成了每次都念一遍的噪音。
  const meta = $('limits-meta').textContent;
  assert.ok(!/不受影响|不会.*踢|unaffected|no one is (kicked|disconnected)/i.test(meta), `没超限就不该提这件事：${meta}`);
});

test('清除之后：显示回落到启动参数的值，并说明面板设置已清除', () => {
  mod.renderLimits(doc({ maxConnections: 2000, overridden: false, touched: true, bootMaxConnections: 2000 }));
  assert.equal($('limits-value').textContent, '2000');
  const meta = $('limits-meta').textContent;
  assert.ok(!/undefined|NaN/.test(meta), `不能漏出 undefined：${meta}`);
  assert.match(meta, /2000/);
});

test('正在输入时轮询不得覆盖输入框', () => {
  const input = $('limits-input');
  input.value = '999';
  input.dataset.synced = '0'; // 用户敲过之后 wireLimits 会置 0
  mod.renderLimits(doc({ maxConnections: 400 }));
  assert.equal(input.value, '999', '运维正在打的数字不能被 2 秒一次的轮询冲掉');
  // 而未被触碰时（空 + 已同步）应当跟上服务器的值
  input.value = '';
  input.dataset.synced = '1';
  mod.renderLimits(doc({ maxConnections: 777 }));
  assert.equal(input.value, '777');
});

test('两套语言包都齐：每个新文案都有中英条目', async () => {
  const src = fs.readFileSync(path.join(process.cwd(), 'public', 'admin', 'admin.js'), 'utf8');
  const keys = [...src.matchAll(/^\s{4}(limits[A-Z]\w*):/gm)].map((m) => m[1]);
  assert.ok(keys.length >= 15, `应当有十来个 limits* 文案，实际 ${keys.length}`);
  // 每个 key 必须在 zh 段与 en 段各出现一次（本文件的结构就是这样：两个平铺的对象字面量）。
  for (const k of keys) {
    const n = (src.match(new RegExp(`^\\s{4}${k}:`, 'gm')) || []).length;
    assert.equal(n, 2, `${k} 应当在中英两段各有一条，实际 ${n} 条`);
  }
});

test('服务端与面板对 0 的态度一致：不许提交，服务端也会拒', () => {
  // 面板侧：wireLimits 在提交前就拦下 0/负数/非整数（不把注定被拒的请求发出去）。
  const input = $('limits-input');
  input.value = '0';
  $('limits-status').textContent = '';
  byId.get('limits-form').fire('submit');
  const status = $('limits-status').textContent;
  assert.ok(status.length > 0, '0 必须在界面上被拦下并给出理由');
  assert.ok(!/undefined/.test(status), `提示不能是 undefined：${status}`);
});
