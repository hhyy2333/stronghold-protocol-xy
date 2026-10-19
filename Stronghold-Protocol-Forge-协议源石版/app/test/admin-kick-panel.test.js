// test/admin-kick-panel.test.js — 面板上的「移出」（后台踢人，public/admin/admin.js 的 kickButton / renderRooms /
// kickFromPanel，以及它引用的 DOM 契约与 POST /api/admin/rooms/kick）。
//
// 为什么单独测这一节：这是整个面板里**唯一一颗会改变别人对局的按钮**，而且它紧挨着「封禁 IP」（同样的座位标签、
// 同一张表、完全不同的后果：移出能立刻加回来，封禁不能）。所以钉住的是**它靶子对不对、话说得对不对**：
//
//   * 按钮只出现在真人座位与观战席上（AI 座位没有「移出」——AI 由房主自己用「加电脑/减电脑」管）；
//   * 按钮自己带着房间号与 playerId（服务端会复核，椅子在 2 秒轮询之间换了人也踢不到别人）；
//   * **必须先过确认框**——一次误点不该把在线玩家踢出房间，对局中的确认文案还要点明「等于中途退出」；
//   * 取消确认 = 一个请求都不发；
//   * 失败照抄服务端给的理由（旧行说「人已不在房里」，不说「失败」）；
//   * 每个新文案在中英两个语言包里都有条目（漏一个会让界面显示 t() 的键名）。
//
// 跑的是真代码对着 DOM stand-in（与 test/admin-panel-limits.test.js 同一个形状）。
// Run: node test/admin-kick-panel.test.js

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
  fire(type, event = {}) { for (const fn of this._listeners[type] || []) fn({ preventDefault() {}, target: this, ...event }); }
  /** The panel's click handler walks up from the event target with `closest(selector)`. */
  closest(selector) {
    const attr = /^\[([a-z-]+)\]$/.exec(selector);
    if (!attr) return null;
    // `data-kick-player` → `dataset.kickPlayer`, exactly like a real DOM element.
    const key = attr[1].replace(/^data-/, '').replace(/-([a-z])/g, (_, c) => c.toUpperCase());
    for (let node = this; node; node = node.parentNode) if (node.dataset && key in node.dataset) return node;
    return null;
  }
  querySelector() { return null; }
  querySelectorAll() { return []; }
  matches() { return false; }
  focus() {}
  scrollIntoView() {}
  /** Every descendant, for asserting on nested classes. */
  all() { return this.childNodes.flatMap((c) => [c, ...(c.all ? c.all() : [])]); }
}

const byId = new Map();
/** Every id admin.js touches at module scope (the same list the sibling panel tests keep). */
for (const id of ['badge-version', 'badge-state', 'btn-lang', 'btn-logout', 'login', 'login-form', 'login-error', 'token',
  'dashboard', 'stat-sockets', 'stat-sessions', 'stat-clients', 'stat-rooms', 'stat-matches', 'stat-population',
  'stat-cpu', 'stat-load', 'stat-rss', 'stat-heap', 'rooms-count', 'rooms-body', 'rooms-status', 'announce-text', 'announce-count',
  'announce-status', 'announce-form', 'announce-send', 'announce-withdraw', 'announce-list', 'announce-history',
  'notes-count', 'notes-ver', 'notes-digest', 'notes-text', 'notes-preview', 'notes-form', 'notes-save', 'notes-reset',
  'notes-clear', 'notes-size', 'notes-status', 'log-console', 'foot-build', 'foot-node', 'feedback-list',
  'feedback-count', 'slots-list', 'bans-list', 'bans-count', 'ban-form', 'ban-rule', 'ban-reason', 'ban-minutes',
  'ban-add', 'ban-status', 'limits-value', 'limits-meta', 'limits-form', 'limits-input', 'limits-save', 'limits-clear',
  'limits-status']) byId.set(id, new El('div'));
byId.set('ban-form', new El('form'));

globalThis.document = {
  documentElement: new El('html'),
  getElementById: (id) => byId.get(id) ?? null,
  querySelector: () => null,
  querySelectorAll: () => [],
  addEventListener() {},
  createElement: (t) => new El(t),
  createTextNode: (t) => { const n = new El('#text'); n.textContent = t; return n; },
};
/** `confirm` is driven per test; `location`/`matchMedia` are what the panel's boot path touches. */
globalThis.window = { addEventListener() {}, confirm: () => true, location: { reload() {} } };
globalThis.localStorage = { getItem: () => null, setItem() {}, removeItem() {} };
globalThis.sessionStorage = { getItem: () => null, setItem() {}, removeItem() {} };
globalThis.location = { reload() {} };
Object.defineProperty(globalThis, 'navigator', { value: { language: 'zh-CN' }, configurable: true, writable: true });
globalThis.matchMedia = () => ({ matches: false, addEventListener() {} });
globalThis.requestAnimationFrame = (fn) => setTimeout(fn, 0);

/** Requests the panel made through fetch (the panel posts every write through `apiPost`). */
const calls = [];
let nextReply = () => ({ status: 200, body: { ok: true } });
globalThis.fetch = async (url, init = {}) => {
  calls.push({ url: String(url), method: init.method || 'GET', body: init.body ? JSON.parse(init.body) : null });
  const reply = nextReply(String(url), init);
  return { status: reply.status, ok: reply.status >= 200 && reply.status < 300, json: async () => reply.body ?? null };
};

const mod = await import('../public/admin/admin.js');
const $ = (id) => byId.get(id);
const clearCalls = () => { calls.length = 0; };
const posts = () => calls.filter((c) => c.method === 'POST');

// ---------------------------------------------------------------------------------------------------
// fixtures
// ---------------------------------------------------------------------------------------------------

/** A /api/admin/rooms row: the host, one human guest, one bot, one empty seat, one spectator. */
const roomRow = (o = {}) => ({
  code: 'K7Q2',
  host: 'p_host',
  hostName: 'Host',
  mode: 'coop',
  difficulty: 'NORMAL',
  inMatch: false,
  seats: [
    { seat: 0, playerId: 'p_host', name: 'Host', isBot: false, ready: false, connected: true, addr: '203.0.113.1' },
    { seat: 1, playerId: 'p_guest', name: 'Guest', isBot: false, ready: true, connected: true, addr: '203.0.113.2' },
    { seat: 2, playerId: 'ai_abcd', name: 'AI·1', isBot: true, ready: true, connected: true, addr: null },
    null,
  ],
  spectators: [{ playerId: 'p_spec', name: 'Watcher', connected: true }],
  match: null,
  perf: null,
  createdAt: 0,
  ...o,
});

const kickButtons = () => $('rooms-body').all().filter((el) => el.dataset && el.dataset.kickPlayer);

// ---------------------------------------------------------------------------------------------------
// 靶子：按钮长在谁旁边
// ---------------------------------------------------------------------------------------------------

test('renderRooms：每个真人座位与观战席一颗「移出」，AI 座位没有', () => {
  mod.renderRooms([roomRow()]);
  const buttons = kickButtons();
  assert.deepEqual(buttons.map((b) => b.dataset.kickPlayer).sort(), ['p_guest', 'p_host', 'p_spec'],
    '两个真人座位 + 一个观战席；AI 座位与空座位都没有「移出」');

  const guest = buttons.find((b) => b.dataset.kickPlayer === 'p_guest');
  assert.equal(guest.dataset.kickCode, 'K7Q2', '按钮自带房间号');
  assert.equal(guest.dataset.kickName, 'Guest', '按钮自带名字（确认框要能点名）');
  assert.equal(guest.dataset.kickInMatch, '', '备战期没有对局标记');
  assert.equal(guest.dataset.kickOffline, undefined, '在线的人没有「离线」标记');
  assert.match(guest.title, /Guest/, '悬停提示点名是谁');
});

test('renderRooms：掉线的人（宽限期内还占着座位）标成离线，确认框要说清「他下次回来才看到」', async () => {
  const row = roomRow();
  row.seats[1] = { ...row.seats[1], connected: false };
  mod.renderRooms([row]);
  const guest = kickButtons().find((b) => b.dataset.kickPlayer === 'p_guest');
  assert.equal(guest.dataset.kickOffline, '1', '离线标记');

  clearCalls();
  nextReply = () => ({ status: 200, body: { ok: true, kick: { room: 'K7Q2', playerId: 'p_guest', name: 'Guest', inMatch: false, deferred: false } } });
  const confirmed = [];
  const realConfirm = globalThis.window.confirm;
  globalThis.window.confirm = (text) => { confirmed.push(text); return false; };
  try {
    await press(guest);
  } finally { globalThis.window.confirm = realConfirm; }
  assert.equal(confirmed.length, 1);
  assert.match(confirmed[0], /离线|offline/i, `离线的人要被说出来：${confirmed[0]}`);
  assert.equal(posts().length, 0, '取消仍然不发请求');
});

test('renderRooms：对局中标记在按钮上（确认文案要据此改口）', () => {
  mod.renderRooms([roomRow({ inMatch: true, match: { phase: 'PREP', round: 2, paused: false } })]);
  const guest = kickButtons().find((b) => b.dataset.kickPlayer === 'p_guest');
  assert.equal(guest.dataset.kickInMatch, '1');
});

test('renderRooms：已经离开的人（对局中还占着座位）没有「移出」按钮 —— 服务端只会回 BAD_TARGET', () => {
  const row = roomRow({ inMatch: true, match: { phase: 'PREP', round: 2, paused: false } });
  row.seats[1] = { ...row.seats[1], connected: false, left: true };
  mod.renderRooms([row]);
  assert.deepEqual(kickButtons().map((b) => b.dataset.kickPlayer).sort(), ['p_host', 'p_spec'],
    '离开的座位与 AI 座位一样不该长出按钮');
});

test('renderRooms：没有活动房间时是空态，不长出任何按钮', () => {
  mod.renderRooms([]);
  assert.equal(kickButtons().length, 0);
  assert.match($('rooms-body').textContent, /暂无活动房间|No active rooms/);
});

// ---------------------------------------------------------------------------------------------------
// 提交：确认框、请求体、回报
// ---------------------------------------------------------------------------------------------------

/** Drive one button: put it on screen, let the click handler see it, return the promise of the POST. */
async function press(button) {
  const synthetic = { target: button };
  $('rooms-body').fire('click', synthetic);
  // kickFromPanel awaits the POST; let the microtask queue drain.
  await new Promise((r) => setTimeout(r, 0));
}

test('确认框：取消就一个请求都不发（一次误点不该把在线玩家踢出房间）', async () => {
  clearCalls();
  nextReply = () => ({ status: 200, body: { ok: true, kick: { room: 'K7Q2', playerId: 'p_guest', name: 'Guest', deferred: false, inMatch: false } } });
  const confirmed = [];
  const realConfirm = globalThis.window.confirm;
  globalThis.window.confirm = (text) => { confirmed.push(text); return false; };
  try {
    mod.renderRooms([roomRow()]);
    await press(kickButtons().find((b) => b.dataset.kickPlayer === 'p_guest'));
  } finally { globalThis.window.confirm = realConfirm; }
  assert.equal(posts().length, 0, '取消 = 不发请求');
  assert.equal(confirmed.length, 1, '但确认框确实问了一次');
  assert.match(confirmed[0], /Guest/, '确认框点名要踢谁');
  assert.match(confirmed[0], /K7Q2/, '也点名哪间房');
});

test('确认后：POST /api/admin/rooms/kick，body 就是 { code, playerId }，成功后说清楚踢了谁', async () => {
  clearCalls();
  nextReply = (url) => (url === '/api/admin/rooms/kick'
    ? { status: 200, body: { ok: true, kick: { room: 'K7Q2', playerId: 'p_guest', name: 'Guest', seat: 1, spectator: false, inMatch: false, deferred: false } } }
    : { status: 404, body: null });
  mod.renderRooms([roomRow()]);
  await press(kickButtons().find((b) => b.dataset.kickPlayer === 'p_guest'));

  const sent = posts();
  assert.equal(sent.length, 1, `一个 POST：${JSON.stringify(sent)}`);
  assert.equal(sent[0].url, '/api/admin/rooms/kick');
  assert.deepEqual(sent[0].body, { code: 'K7Q2', playerId: 'p_guest' }, '房间里的一切都由服务端复核，这里只交出两个 id');
  assert.match($('rooms-status').textContent, /Guest/, '提示点名被移出的人');
  assert.match($('rooms-status').textContent, /K7Q2/);
  assert.ok(!/undefined|NaN/.test($('rooms-status').textContent), `不能漏出 undefined：${$('rooms-status').textContent}`);
});

test('对局中的确认文案点明「等于中途退出」，不是普通的一句话', async () => {
  clearCalls();
  nextReply = () => ({ status: 200, body: { ok: true, kick: { room: 'K7Q2', playerId: 'p_guest', name: 'Guest', inMatch: true, deferred: false } } });
  const confirmed = [];
  const realConfirm = globalThis.window.confirm;
  globalThis.window.confirm = (text) => { confirmed.push(text); return false; };
  try {
    mod.renderRooms([roomRow({ inMatch: true, match: { phase: 'PREP', round: 2, paused: false } })]);
    await press(kickButtons().find((b) => b.dataset.kickPlayer === 'p_guest'));
  } finally { globalThis.window.confirm = realConfirm; }
  assert.equal(confirmed.length, 1);
  // 这句话是本功能唯一容易被误读的地方：对局中踢人 = 那人这一局没了，不是暂停、不是稍后回来。
  assert.match(confirmed[0], /中途退出|mid-match exit/i, `对局中必须点明后果：${confirmed[0]}`);
});

test('失败：照抄服务端给的理由，而不是笼统一句「失败」', async () => {
  clearCalls();
  nextReply = () => ({ status: 404, body: { ok: false, error: 'ROOM_NOT_FOUND', message: '找不到这个房间（可能已经解散）· No such room (it may already be gone)' } });
  mod.renderRooms([roomRow()]);
  await press(kickButtons().find((b) => b.dataset.kickPlayer === 'p_guest'));

  const status = $('rooms-status').textContent;
  assert.match(status, /找不到这个房间/, `服务端的理由要原样传到界面：${status}`);
  assert.equal($('rooms-status').className.includes('is-error'), true, '失败要是错误态');
});

test('延迟生效（对局跑在独立进程里）：不许说成「已经踢掉了」', async () => {
  clearCalls();
  nextReply = () => ({ status: 200, body: { ok: true, kick: { room: 'K7Q2', playerId: 'p_guest', name: 'Guest', inMatch: true, deferred: true } } });
  mod.renderRooms([roomRow({ inMatch: true, match: { phase: 'PREP', round: 2, paused: false } })]);
  await press(kickButtons().find((b) => b.dataset.kickPlayer === 'p_guest'));
  const status = $('rooms-status').textContent;
  assert.match(status, /请求|queued|shortly/i, `deferred 必须说成「已请求」：${status}`);
  assert.ok(!/已经移出|has been removed/i.test(status), `deferred 时不能说成已完成：${status}`);
});

// ---------------------------------------------------------------------------------------------------
// 文案与页面契约
// ---------------------------------------------------------------------------------------------------

test('中英两个语言包都齐：每个 kick* / rooms* 文案在 zh 与 en 各一条', () => {
  const src = fs.readFileSync(path.join(process.cwd(), 'public', 'admin', 'admin.js'), 'utf8');
  // 两段是平铺的对象字面量，所以按 `  zh: {` / `  en: {` 切开分别查 —— 只数总条数是**测不出**「中文写了两遍、
  // 英文一条没有」的（那正好也是 2 条），而那正是这个测试要防的 bug。
  const zhStart = src.indexOf('  zh: {');
  const enStart = src.indexOf('  en: {');
  assert.ok(zhStart >= 0 && enStart > zhStart, '面板的两个语言段都在');
  const zh = src.slice(zhStart, enStart);
  const en = src.slice(enStart);
  for (const key of ['roomsHint', 'kickSeat', 'kickSeatTitle', 'kickConfirm', 'kickConfirmOffline', 'kickConfirmInMatch',
    'kickBusy', 'kicked', 'kickedDeferred', 'kickFailed']) {
    assert.match(zh, new RegExp(`^\\s{4}${key}:`, 'm'), `zh 段缺 ${key}`);
    assert.match(en, new RegExp(`^\\s{4}${key}:`, 'm'), `en 段缺 ${key}`);
  }
});

test('页面契约：房间面板有说明与状态行（面板要能说出「踢了谁」）', () => {
  const html = fs.readFileSync(path.join(process.cwd(), 'public', 'admin', 'index.html'), 'utf8');
  // 按 id 找那个元素再看它的 class：属性顺序是排版自由，不该被一条测试钉死。
  const row = /<[^>]*id="rooms-status"[^>]*>/.exec(html);
  assert.ok(row, '状态行');
  assert.match(row[0], /class="announce__status"/, '状态行复用公告那一节的「操作结果」样式');
  assert.match(html, /data-t="roomsHint"/, '这就是「移出 ≠ 封禁」的唯一说明书');
});

test('说明文字不含 Markdown 记号：面板用 textContent 写它，`**` 会原样显示给运维', () => {
  const src = fs.readFileSync(path.join(process.cwd(), 'public', 'admin', 'admin.js'), 'utf8');
  const zhStart = src.indexOf('  zh: {');
  const enStart = src.indexOf('  en: {');
  for (const [name, blob] of [['zh', src.slice(zhStart, enStart)], ['en', src.slice(enStart)]]) {
    for (const key of ['roomsHint', 'kickConfirm', 'kickConfirmOffline', 'kickConfirmInMatch', 'kickedDeferred']) {
      const line = new RegExp(`^\\s{4}${key}: (.*)$`, 'm').exec(blob);
      assert.ok(line, `${name}.${key}`);
      assert.ok(!/\*\*/.test(line[1]), `${name}.${key} 里有 Markdown 粗体记号，textContent 会把它原样显示`);
    }
  }
});
