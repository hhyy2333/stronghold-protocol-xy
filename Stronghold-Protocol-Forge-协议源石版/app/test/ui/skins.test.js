// test/ui/skins.test.js —— 皮肤的**决策层**：清单（`assets.skins`）、选择、持久化、发帧、内置外观提供者。
//
// 这条通道在本检出原本一行为零覆盖（docs/WORKSHOP.md 点名的 `test/workshopSkins.test.js` 也不在仓里），
// 而它三面都通、只缺「谁来决定哪一套」：数据层（`pack.json.skins` → `assets.skins[<charId>]`，`shared/workshop.js`）、
// 解析链（`ui/portraitChain.js` 步骤 0）、协议（`room.appearance`，`shared/protocol.js` + `server/lobby.js`）。
// 这个文件钉的就是补上的那一面，五件事：
//
//   1. **清单**：只把「真的有图」的时装算作可选（一套只有模型的时装换不了任何一张图 ⇒ 不承诺）；
//   2. **选择**：按**干员**记（`{ [charId]: skinId }`），越界的 id / 超上限的条数在解析时丢掉；
//   3. **持久化**：`sp.pref.skins`（与仓里其它偏好同一条 `loadPref` / `savePref`）；
//   4. **发帧**：`room.appearance { picks }`，**只在房间上下文发**，且形状必须过 `isAppearanceMsg`（协议那一层唯一的判据）；
//   5. **内置提供者**：注册进 `portraitChain`，把一个干员选的那套交回链 —— 于是「头像换掉」不再需要任何插件面板。
//
// 注意：本文件直接 `node test/ui/skins.test.js` 执行（沙箱里 `node --test` 起不了子进程）。
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { isAppearanceMsg, APPEARANCE_LIMITS } from '../../shared/protocol.js';
import {
  clearAppearanceLookup, setAppearanceFirst, currentAppearanceLookup,
} from '../../public/js/ui/portraitChain.js';
import { avatarUrlOf, portraitUrlOf } from '../../public/js/ui/portraitChain.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

// ---- 假 localStorage（要在 import skins.js **之前**装上：它开机时读一次 `sp.pref.skins`） --------------
const mem = new Map();
globalThis.localStorage = {
  getItem: (k) => (mem.has(k) ? mem.get(k) : null),
  setItem: (k, v) => { mem.set(String(k), String(v)); },
  removeItem: (k) => { mem.delete(String(k)); },
};
// ---- 假 fetch（`data.load('assets')` 要一个真响应；内置提供者读的是 `data.get('assets')`，即应用里那一份）----
globalThis.fetch = async (url) => {
  const name = String(url).split('/').pop();
  try {
    const body = readFileSync(path.join(ROOT, 'data', name), 'utf8');
    return { ok: true, status: 200, json: async () => JSON.parse(body) };
  } catch {
    return { ok: false, status: 404, json: async () => ({}) };
  }
};

const S = await import('../../public/js/ui/skins.js');
const P = await import('../../public/js/ui/skinProvider.js');
const { skinSectionModel, skinSectionTree } = await import('../../public/js/ui/skinPicker.js');
const { data } = await import('../../public/js/data.js');

/** `mergeWorkshopSkins` 的落盘形状（`assets.skins[<charId>] = [{ pack, id, name, … }]`）。 */
const INSIDE = 'char_498_inside';
const MANIFEST = {
  chars: {
    [INSIDE]: {
      avatar: '/assets/char/avatar/char_498_inside.png',
      portrait: '/assets/char/portrait/char_498_inside_1.png',
    },
  },
  skins: {
    [INSIDE]: [
      {
        pack: 'demo-skins', id: 'inside-summer', name: '夏日', series: '珊瑚海岸',
        art: { avatar: '/ws/demo-skins/inside/summer-avatar.png', portrait: '/ws/demo-skins/inside/summer-portrait.png' },
      },
      // 只有模型：本树的链只画头像 / 立绘（局内 Spine 换装是另一刀），所以它不算「可选」
      { pack: 'demo-skins', id: 'inside-model', name: '仅模型', art: { spine: { front: { skel: 'a.skel', atlas: 'a.atlas', png: 'a.png' } } } },
      // 只有元数据：连 art 都没有（形状层允许，画面不承诺）
      { pack: 'demo-skins', id: 'inside-meta', name: '仅名称' },
    ],
  },
};

// 内置提供者读的是 **`data.get('assets')`**（应用里那一份：内容集视图叠过之后的那张清单），所以这里照
// `public/js/content.js` 的做法把清单换成夹具：先让文件真的「加载」一次（`get` 只对已加载的文件套视图），
// 再 `setView` 叠上我们自己的那份。生产上做的就是这件事 —— 只是那时叠的是工坊包合并进来的真清单。
await data.load('assets');
data.setView('assets', () => MANIFEST);

test.beforeEach(() => {
  mem.clear();
  clearAppearanceLookup();
  setAppearanceFirst(true);
  S.setSkins({});
});
test.after(() => { clearAppearanceLookup(); setAppearanceFirst(true); S.setSkins({}); data.setView('assets', null); });

// ---- 1. 选择表 -------------------------------------------------------------------------------------------

test('parseStoredSkins：只留「两个非空 id」，并按上限截断', () => {
  assert.deepEqual(S.parseStoredSkins(null), {});
  assert.deepEqual(S.parseStoredSkins('nope'), {});
  assert.deepEqual(S.parseStoredSkins({ [INSIDE]: 'inside-summer', x: '', y: 3, z: null }), { [INSIDE]: 'inside-summer' });
  const many = Object.fromEntries(Array.from({ length: APPEARANCE_LIMITS.picks + 50 }, (_, i) => [`char_${i}`, `skin_${i}`]));
  const capped = S.parseStoredSkins(many);
  assert.equal(Object.keys(capped).length, APPEARANCE_LIMITS.picks, '上限就是协议的上限（同一格，不是第二份数字）');
  assert.equal(S.SKIN_PICKS_LIMIT, APPEARANCE_LIMITS.picks);
  // 脏值不花预算：混在里面的坏值不占名额，好值仍然进得来
  const dirty = { ...Object.fromEntries(Array.from({ length: 60 }, (_, i) => [`bad ${i}`, 'x'])), [INSIDE]: 'inside-summer' };
  assert.deepEqual(Object.keys(S.parseStoredSkins(dirty)), [INSIDE]);
});

test('上限量的是「整份干员名单」，不是一间房的座位数（业主 2026-11-04：官方时装三样都受上限限制）', () => {
  // 现象：官方时装包覆盖 174 名干员，玩家按干员一套套选下去 —— 旧上限 64 让第 65 名起**静默消失**
  // （头像、立绘、局内模型三样一起不生效，界面上没有任何提示）。这条钉的是「覆盖整份名单」这个口径。
  // 两个数字都从**真数据**读，不写死在测试里：`assets.json` 的干员表是整份名单，官方时装包的 `charId` 去重
  // 是它真正覆盖的那一批（见 `workshop/official-skins/PROVENANCE.md`）。
  const realManifest = JSON.parse(readFileSync(path.join(ROOT, 'data', 'assets.json'), 'utf8'));
  const ROSTER = Object.keys(realManifest.chars || {}).length;
  const pack = JSON.parse(readFileSync(path.join(ROOT, 'workshop', 'official-skins', 'pack.json'), 'utf8'));
  const OFFICIAL_CHARS = new Set((pack.skins || []).map((s) => s.charId)).size;
  assert.ok(OFFICIAL_CHARS > 64, `官方时装包要覆盖超过旧上限 64 名干员（实测 ${OFFICIAL_CHARS} 名）—— 否则这条钉不住当时的症状`);
  assert.ok(APPEARANCE_LIMITS.picks >= ROSTER, `上限 ${APPEARANCE_LIMITS.picks} 要装得下整份干员名单（${ROSTER} 名）`);

  // 每个干员挑官方包里的第一套（174 套都带头像与立绘，`availableSkins` 那一条判据在这里等于全覆盖）
  const official = {};
  for (const s of pack.skins) if (s.charId && s.id && !Object.hasOwn(official, s.charId)) official[s.charId] = s.id;
  S.setSkins(official);
  assert.equal(Object.keys(S.skinEntries()).length, OFFICIAL_CHARS, `官方时装覆盖的 ${OFFICIAL_CHARS} 名干员一套都不许丢`);
  // 发帧也不能把第 65 名起截掉：那才是「头像/立绘换了、模型没换」的真正来源
  const payload = S.appearancePayload();
  assert.equal(Object.keys(payload.picks).length, OFFICIAL_CHARS);
  assert.equal(isAppearanceMsg(payload), true, '发出去的每一帧都得过服务端那一道形状判据');

  // 最坏情况仍要在 WebSocket 的 64 KB 单帧上限之内（server/http/websocket.js WS_MAX_PAYLOAD）
  const worst = {};
  for (let i = 0; i < APPEARANCE_LIMITS.picks; i++) worst[`${'a'.repeat(58)}${String(i).padStart(6, '0')}`] = { skinId: 'b'.repeat(64) };
  const bytes = JSON.stringify({ picks: worst }).length;
  assert.ok(bytes < 64 * 1024, `上限 ${APPEARANCE_LIMITS.picks} 条的最坏一帧 ${bytes} B 必须小于 64 KB`);
});

test('setSkin / clearSkin / skinFor：按干员记，写进 store 与 localStorage', () => {
  S.setSkin(INSIDE, 'inside-summer');
  assert.equal(S.skinFor(INSIDE), 'inside-summer');
  assert.equal(S.skinFor('char_other'), null);
  assert.equal(mem.get('sp.pref.skins'), JSON.stringify({ [INSIDE]: 'inside-summer' }), '持久化键名 sp.pref.skins');
  S.setSkin(INSIDE, '');
  assert.equal(S.skinFor(INSIDE), 'inside-summer', '空 id 不是一次清除（clearSkin 才是）');
  S.clearSkin(INSIDE);
  assert.equal(S.skinFor(INSIDE), null);
  assert.equal(mem.get('sp.pref.skins'), '{}');
  S.clearSkin(INSIDE); // 清第二次不报错、不写坏
  assert.equal(mem.get('sp.pref.skins'), '{}');
});

test('setSkins 的输入也过同一份解析（导入来的脏表不会漏进 store）', () => {
  S.setSkins({ [INSIDE]: 'inside-summer', bad: 1, 'x y': 'z' });
  assert.deepEqual(S.skinsStore.get().entries, { [INSIDE]: 'inside-summer' });
  assert.deepEqual(S.parseStoredSkins(S.skinsStore.get().entries), S.skinsStore.get().entries);
});

// ---- 2. 清单 ---------------------------------------------------------------------------------------------

test('availableSkins：只把「真的有图」的时装算作可选，并把图解析成 URL', () => {
  const rows = S.availableSkins(INSIDE, { manifest: MANIFEST });
  assert.deepEqual(rows.map((r) => r.id), ['inside-summer'], '只有模型的、只有元数据的都不算可选');
  const [summer] = rows;
  assert.equal(summer.name, '夏日');
  assert.equal(summer.series, '珊瑚海岸');
  assert.equal(summer.pack, 'demo-skins');
  assert.equal(summer.portrait, '/ws/demo-skins/inside/summer-portrait.png');
  assert.equal(summer.avatar, '/ws/demo-skins/inside/summer-avatar.png');
  assert.equal(S.availableSkins('char_nobody', { manifest: MANIFEST }).length, 0);
  assert.deepEqual(S.availableSkins(INSIDE, { manifest: null }), [], '清单没到 ⇒ 没有可选外观');
});

test('一套只有精锐立绘 / 只有头像的时装也是可选的（放哪个换哪个）', () => {
  const partial = {
    chars: MANIFEST.chars,
    skins: { [INSIDE]: [
      { pack: 'p', id: 'only-e2', name: 'E2', art: { portraitE2: '/ws/p/e2.png' } },
      { pack: 'p', id: 'only-face', name: '脸', art: { avatar: '/ws/p/face.png' } },
    ] },
  };
  const rows = S.availableSkins(INSIDE, { manifest: partial });
  assert.deepEqual(rows.map((r) => r.id), ['only-e2', 'only-face']);
  assert.equal(rows[0].portrait, '/ws/p/e2.png', '只有 E2 立绘时它自己顶上');
  assert.equal(rows[0].avatar, null);
  assert.equal(rows[1].avatar, '/ws/p/face.png');
});

test('hasSkinChoices / hasAnySkinChoices：单选与全局两个问题分开问', () => {
  assert.equal(S.hasSkinChoices(INSIDE, { manifest: MANIFEST }), true);
  assert.equal(S.hasSkinChoices('char_nobody', { manifest: MANIFEST }), false);
  assert.equal(S.hasAnySkinChoices({ manifest: MANIFEST }), true);
  assert.equal(S.hasAnySkinChoices({ manifest: { chars: MANIFEST.chars, skins: { [INSIDE]: [MANIFEST.skins[INSIDE][2]] } } }), false, '只有元数据 ⇒ 全局也算没有');
  assert.equal(S.hasAnySkinChoices({ manifest: null }), false);
});

test('chosenSkin：选的那套必须**是这个干员的、而且现在还有图**，否则当作没选（条目本身留着）', () => {
  const entries = { [INSIDE]: 'inside-summer' };
  assert.equal(S.chosenSkin(INSIDE, entries, { manifest: MANIFEST }), 'inside-summer');
  assert.equal(S.chosenSkin(INSIDE, { [INSIDE]: 'inside-model' }, { manifest: MANIFEST }), null, '只有模型的不算选上了');
  assert.equal(S.chosenSkin(INSIDE, { [INSIDE]: 'gone' }, { manifest: MANIFEST }), null, '包被卸掉 ⇒ 回落原版，条目留着');
  assert.equal(S.chosenSkin('char_other', entries, { manifest: MANIFEST }), null, '别的干员的 id 不串门');
  assert.equal(S.skinsStore.get().entries[INSIDE], undefined, 'chosenSkin 只读不写');
});

// ---- 3. 发帧 ---------------------------------------------------------------------------------------------

test('appearancePayload：形状就是 room.appearance 的 picks，且过协议判据', () => {
  S.setSkins({ [INSIDE]: 'inside-summer', char_010_chen: 'chen-summer' });
  const payload = S.appearancePayload();
  assert.deepEqual(payload, { picks: { [INSIDE]: { skinId: 'inside-summer' }, char_010_chen: { skinId: 'chen-summer' } } });
  // `isAppearanceMsg` 是服务端唯一的判据（shared/protocol.js:484）：形状不对整条 BAD_MSG
  assert.equal(isAppearanceMsg(payload), true, '服务端必须收得下这条消息');
  assert.equal(S.appearancePayload({}), null, '没选任何外观 ⇒ 没有消息可发（不是发一条空的）');
  // 撤回是**另一件事**，也合法：空的 `picks` 在协议上是「我没有任何换装」（`isMap` 允许空表）
  const cleared = S.appearancePayload({}, { clear: true });
  assert.deepEqual(cleared, { picks: {} });
  assert.equal(isAppearanceMsg(cleared), true, '清空选择要说得出去（否则同房的人永远看着你的旧外观）');
  S.setSkins({});
  assert.equal(S.appearancePayload(), null);
});

test('appearancePayload：超过协议上限的条数在这里就截断（不是让服务端整条拒收）', () => {
  const many = Object.fromEntries(Array.from({ length: APPEARANCE_LIMITS.picks + 50 }, (_, i) => [`char_${i}`, `skin_${i}`]));
  S.setSkins(many);
  const payload = S.appearancePayload();
  assert.equal(Object.keys(payload.picks).length, APPEARANCE_LIMITS.picks);
  assert.equal(isAppearanceMsg(payload), true);
});

test('sendAppearance：不在房间里什么都不发（标题页 / 大厅里不该产生这个消息）', async () => {
  const sent = [];
  const net = { request: (t, fields) => { sent.push([t, fields]); return Promise.resolve({ t: 'ok' }); } };
  S.setSkin(INSIDE, 'inside-summer');
  assert.equal(await S.sendAppearance({ net, room: null }), false);
  assert.deepEqual(sent, [], '没有房间 ⇒ 一个字节都不发');
  assert.equal(await S.sendAppearance({ net, room: { code: 'ABCD' } }), true);
  assert.deepEqual(sent, [['room.appearance', { picks: { [INSIDE]: { skinId: 'inside-summer' } } }]]);
});

// ---- 4. 同步引擎 -----------------------------------------------------------------------------------------

/** 手摇定时器：不 sleep、不依赖真实时钟。 */
function fakeTimers() {
  const q = [];
  return {
    setTimeout: (fn) => { q.push(fn); return q.length; },
    clearTimeout: () => {},
    run: () => { for (const fn of q.splice(0)) fn(); },
    get size() { return q.length; },
  };
}
const tick = () => new Promise((r) => setTimeout(r, 0));

test('installAppearanceSync：改动去抖后发一次；同样的内容不重复发；room.state 到达后再发一次', async () => {
  const sent = [];
  const handlers = new Map();
  const net = {
    request: (t, fields) => { sent.push([t, fields]); return Promise.resolve({ t: 'ok' }); },
    on: (type, fn) => { handlers.set(type, fn); return () => handlers.delete(type); },
  };
  const timers = fakeTimers();
  let room = null;
  const engine = S.installAppearanceSync({ net, target: S.skinsStore, roomOf: () => room, timers });
  try {
    S.setSkin(INSIDE, 'inside-summer');
    assert.equal(timers.size, 1, '一次编辑只排一次发送');
    timers.run();
    await tick();
    assert.equal(sent.length, 0, '不在房间 ⇒ 不发（但改动本身不丢）');

    room = { code: 'ABCD' };
    S.setSkin(INSIDE, 'inside-summer'); // 同一个值：store 不变 ⇒ 不排新的发送
    assert.equal(timers.size, 0, '同一份内容再点一次不排发送');
    S.setSkin('char_010_chen', 'chen-summer');
    timers.run();
    await tick();
    assert.equal(sent.length, 1);
    assert.deepEqual(Object.keys(sent[0][1].picks).sort(), ['char_010_chen', INSIDE].sort());
    assert.equal(S.skinsStore.get().sync, 'synced');

    // 进房间 / 重连（room.state 到达）：服务端的会话可能已经换了，把选择重发一次
    handlers.get('room.state')?.({ t: 'room.state', code: 'ABCD' });
    timers.run();
    await tick();
    assert.equal(sent.length, 2, 'room.state 之后重发（同一个值也要发：新会话手里没有）');
    assert.equal(S.skinsStore.get().sync, 'synced');

    // 清空：撤回也要说得出去（`{ picks: {} }`，协议上合法），否则同房的人永远看着你的旧外观
    S.setSkins({});
    timers.run();
    await tick();
    assert.equal(sent.length, 3);
    assert.deepEqual(sent[2][1], { picks: {} }, '撤回一条空 picks');
    assert.equal(isAppearanceMsg(sent[2][1]), true);
  } finally {
    engine.dispose();
  }
  assert.equal(handlers.size, 0, 'dispose 之后不再订阅');
});

test('installAppearanceSync：服务器拒收（RATE / BAD_MSG）不影响本地选择，状态可解释', async () => {
  const net = {
    request: () => Promise.reject(Object.assign(new Error('rate'), { code: 'RATE' })),
    on: () => () => {},
  };
  const timers = fakeTimers();
  const engine = S.installAppearanceSync({ net, target: S.skinsStore, roomOf: () => ({ code: 'ABCD' }), timers });
  try {
    S.setSkin(INSIDE, 'inside-summer');
    timers.run();
    await tick();
    assert.equal(S.skinsStore.get().entries[INSIDE], 'inside-summer', '发不出去不改本地选择');
    assert.ok(['error', 'idle', 'pending'].includes(S.skinsStore.get().sync), `sync=${S.skinsStore.get().sync}`);
  } finally {
    engine.dispose();
  }
});

// ---- 5. 内置外观提供者 -----------------------------------------------------------------------------------

test('installBuiltinSkinProvider：注册进解析链（只一次），把选好的那套交回链', () => {
  assert.equal(P.skinProviderInstalled(), false);
  assert.equal(P.installBuiltinSkinProvider(), true);
  assert.equal(P.skinProviderInstalled(), true);
  assert.equal(P.installBuiltinSkinProvider(), false, '第二个注册者被拒（进程内最多一个提供者）');
  assert.equal(currentAppearanceLookup(), P.builtinSkinLookup);

  // 与真实数据同形：非精锐棋子的 `assets.avatar` 是裸 charId ⇒ 步骤 0 走得到
  const chess = { chessId: `chess_${INSIDE}_a`, charId: INSIDE, assets: { avatar: INSIDE, portrait: `${INSIDE}_1` } };
  const real = { chars: MANIFEST.chars, skins: MANIFEST.skins };
  assert.equal(avatarUrlOf(real, chess), MANIFEST.chars[INSIDE].avatar, '没选外观 ⇒ 官方头像');
  S.setSkin(INSIDE, 'inside-summer');
  assert.equal(avatarUrlOf(real, chess), '/ws/demo-skins/inside/summer-avatar.png', '选了外观 ⇒ 那套的头像');
  // 立绘那一条同样是通的（`_1` 后缀不再挡住提供者，见 test/ui/portraitChain.test.js）
  assert.equal(portraitUrlOf(real, chess), '/ws/demo-skins/inside/summer-portrait.png', '选了外观 ⇒ 那套的立绘');

  clearAppearanceLookup();
  assert.equal(P.skinProviderInstalled(), false);
});

test('内置提供者：不认识的干员 / 没选 / 选了不存在的 id 都回 null（链继续走官方回落）', () => {
  P.installBuiltinSkinProvider();
  assert.equal(P.builtinSkinLookup('avatar', 'char_nobody', 'char_nobody'), null);
  assert.equal(P.builtinSkinLookup('avatar', INSIDE, INSIDE), null, '没有选择');
  S.setSkin(INSIDE, 'gone');
  assert.equal(P.builtinSkinLookup('avatar', INSIDE, INSIDE), null, '选了一个不存在的 id');
  assert.equal(P.builtinSkinLookup('chars', INSIDE, INSIDE), null, '步骤 4 那一条口同一条判据');
});

test('关掉「工坊外观」时内置提供者也不被问（设置开关仍然是整条通道的总闸）', () => {
  P.installBuiltinSkinProvider();
  S.setSkin(INSIDE, 'inside-summer');
  const real = { chars: MANIFEST.chars, skins: MANIFEST.skins };
  const chess = { chessId: `chess_${INSIDE}_a`, charId: INSIDE, assets: { avatar: INSIDE } };
  setAppearanceFirst(false);
  assert.equal(avatarUrlOf(real, chess), MANIFEST.chars[INSIDE].avatar);
  setAppearanceFirst(true);
  assert.equal(avatarUrlOf(real, chess), '/ws/demo-skins/inside/summer-avatar.png');
});

test('闭环（真实数据形状）：给一个真棋子装上一套工坊外观，头像那一条就换成它', () => {
  // 这条是「刀一最小闭环」的证据本身：清单（`assets.skins`，工坊包合并进来的形状）→ 选择 → 内置提供者 → 解析链。
  // 用真的 `data/chess.json` / `data/assets.json` 记录，只有时装那一格是夹具（本仓今天没有任何包带 `skins`）。
  const realChess = JSON.parse(readFileSync(path.join(ROOT, 'data', 'chess.json'), 'utf8'));
  const realManifest = JSON.parse(readFileSync(path.join(ROOT, 'data', 'assets.json'), 'utf8'));
  const record = realChess.chess_char_1_01_a;      // 普通棋子：`assets.avatar` 是裸 charId ⇒ 步骤 0 走得到
  const charId = record.charId;
  const withSkin = {
    ...realManifest,
    skins: { [charId]: [{ pack: 'demo-skins', id: 'demo-look', name: '演示',
      art: { avatar: '/ws/demo-skins/look-avatar.png', portrait: '/ws/demo-skins/look-portrait.png' } }] },
  };
  P.installBuiltinSkinProvider();
  data.setView('assets', () => withSkin);
  try {
    assert.equal(avatarUrlOf(realManifest, record), realManifest.chars[charId].avatar, '没选 ⇒ 官方头像');
    assert.equal(S.hasSkinChoices(charId), true, '清单里有 ⇒ 这个干员有可选外观');
    const model = skinSectionModel(record, { manifest: withSkin, entries: {}, enabled: true });
    assert.equal(model.count, 1, '「皮肤」区会因为这一套外观出现');
    S.setSkin(charId, 'demo-look');
    assert.equal(avatarUrlOf(realManifest, record), '/ws/demo-skins/look-avatar.png', '选了 ⇒ 头像换成那套');
    assert.equal(portraitUrlOf(realManifest, record), '/ws/demo-skins/look-portrait.png', '选了 ⇒ 立绘也换成那套（`_1` 后缀不再挡）');
    assert.equal(S.chosenSkin(charId), 'demo-look');
  } finally {
    data.setView('assets', () => MANIFEST);
  }
});

// ---- 6. 「皮肤」区的那份模型（组件本身只画它） -------------------------------------------------------------
test('skinSectionModel：没有可选外观 / 开关关掉 / 清单没到 ⇒ null（与今天逐字相同）', () => {
  const chess = { chessId: `chess_${INSIDE}_a`, charId: INSIDE };
  assert.equal(skinSectionModel(chess, { manifest: null, entries: {}, enabled: true }), null);
  assert.equal(skinSectionModel(chess, { manifest: { chars: {}, skins: {} }, entries: {}, enabled: true }), null);
  assert.equal(skinSectionModel({ chessId: 'x', charId: 'char_nobody' }, { manifest: MANIFEST, entries: {}, enabled: true }), null);
  assert.equal(skinSectionModel(chess, { manifest: MANIFEST, entries: {}, enabled: false }), null, '开关关掉 ⇒ 整段不画');
  assert.equal(skinSectionModel(null, { manifest: MANIFEST, entries: {}, enabled: true }), null);
});

test('skinSectionModel：默认格在最前、选中的那一格带标记、计数不算默认格', () => {
  const chess = { chessId: `chess_${INSIDE}_a`, charId: INSIDE };
  const none = skinSectionModel(chess, { manifest: MANIFEST, entries: {}, enabled: true });
  assert.equal(none.count, 1, '「{n} 套外观」只数时装，不数默认格');
  assert.deepEqual(none.rows.map((r) => r.own), [true, false]);
  assert.equal(none.rows[0].id, '', '默认格 = 不使用时装（点它就是 clearSkin）');
  assert.equal(none.chosenId, null);
  assert.equal(none.rows[0].art, MANIFEST.chars[INSIDE].portrait, '默认格画这个干员自己的立绘');

  const picked = skinSectionModel(chess, { manifest: MANIFEST, entries: { [INSIDE]: 'inside-summer' }, enabled: true });
  assert.equal(picked.chosenId, 'inside-summer');
  assert.equal(picked.rows[1].art, '/ws/demo-skins/inside/summer-portrait.png');
});

test('标记树：类名就是 css/screens/loadout.css 里那组 .lo-skin*（不新增 CSS，也不需要浏览器）', () => {
  // 组件本身只做「读 store + 交给这两个纯函数」，所以这里能像测数据一样测标记：
  // 结构错了（少了 .lo-skin__art、少了 data-skin、选了却没有 is-on）在这里就红。
  const chess = { chessId: `chess_${INSIDE}_a`, charId: INSIDE };
  const pickedRow = [];
  const model = skinSectionModel(chess, { manifest: MANIFEST, entries: { [INSIDE]: 'inside-summer' }, enabled: true });
  const tree = skinSectionTree(model, (row) => pickedRow.push(row));
  assert.equal(tree.type, 'section');
  assert.equal(tree.props.class, 'lo-sec lo-sec--skin');
  assert.equal(tree.props['data-testid'], 'skin-section');

  /** 收集一棵 vnode 树里所有 `type === tag` 的节点（htm 的 children 可能是数组套数组）。 */
  const collect = (node, tag, out = []) => {
    if (Array.isArray(node)) { for (const n of node) collect(n, tag, out); return out; }
    if (!node || typeof node !== 'object' || node.type === undefined) return out;
    if (node.type === tag) out.push(node);
    collect(node.props?.children, tag, out);
    return out;
  };
  const sections = collect(tree, 'section');
  assert.equal(sections.length, 1);
  const tiles = collect(tree, 'button');
  assert.equal(tiles.length, 2, '默认格 + 一套时装');
  assert.deepEqual(tiles.map((b) => b.props['data-skin']), ['', 'inside-summer']);
  assert.deepEqual(tiles.map((b) => b.props['aria-checked']), ['false', 'true'], '选中的那一格是 aria-checked=true');
  assert.equal(tiles[1].props.class, 'lo-skin is-on', '选中态就是 CSS 里那个 .is-on');
  assert.equal(tiles[0].props.class, 'lo-skin', '默认格没选中时没有 is-on');
  // 右侧「使用中」徽标只长在选中的那一格上
  const badges = collect(tree, 'span').filter((s) => s.props.class === 'lo-skin__badge');
  assert.equal(badges.length, 1);
  // 每一格都有左边那个小图槽（`.lo-skin__art`），有图时是 <Img>，没图时是 `.lo-skin__art--none`
  const arts = collect(tree, 'span').filter((s) => s.props.class === 'lo-skin__art');
  assert.equal(arts.length, 2);
  // 点一下把整行交回调用方（组件据此 clearSkin / setSkin）
  tiles[1].props.onClick();
  assert.deepEqual(pickedRow.map((r) => r.id), ['inside-summer']);
});
