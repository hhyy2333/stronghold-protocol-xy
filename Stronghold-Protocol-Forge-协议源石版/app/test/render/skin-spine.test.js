// test/render/skin-spine.test.js —— 刀二（局内 Spine 换装）的**解析层**：`public/js/render/skinSpine.js`。
//
// 这个模块回答的那一问是：「这个单位现在该用哪套时装的模型？」——数据通路是
//
//   单位 → 它的座位/玩家（`info.ownerId` 就是座位的 `playerId`）→ `seats[].appearance.picks[<charId>].skinId`
//        → `assets.skins[<charId>]` 里那一条 → `art.spine`
//
// 它此前在客户端**一处都没被读过**（服务端早就在发了）。这个文件钉七件事：
//
//   1. **座位 → picks**：`picksOf` 只认 `room.state` 那一帧里的 `seats[].appearance.picks`，空位与没有外观的座位
//      安静跳过；一个玩家的单位找的是**他自己**那座；
//   2. **键是干员不是棋子**：`info.spine` 带 `_1` / `_2` 艺术版本后缀时退到 `baseCharId`；
//   3. **自己的那一半本机优先**：点一下立刻生效（不等服务端那 500 ms 去抖 + 广播）；别人的座位只认房间那一份；
//   4. **失败方向全是 null**（画原版模型）：没选 / 清单里没有那一条 / 只有头像没有模型 / 敌方单位；
//   5. **同一个开关**：设置里的「工坊外观」关掉 ⇒ 这里一起返回 null（否则就是「头像换了、小人没换」的半开状态）；
//   6. **记忆化**：同一 (charId, skinId) 每次拿到**同一个对象**（`retryAssets` 跨帧比较模型，身份不稳会反复重载）；
//   7. **`appearanceGen()`**：外观真的变了才 +1 —— 它是「外观帧到达」那条重解析的信号，与 room 帧的其他字段无关。
//
// 注意：本文件直接 `node test/render/skin-spine.test.js` 执行（沙箱里 `node --test` 起不了子进程，spawn EPERM）。
import test from 'node:test';
import assert from 'node:assert/strict';

const OP = 'char_498_inside';
const OTHER = 'char_002_amiya';

// ---- 假 localStorage（要在 import 之前装上：store 与 `loadPref` 都读它） -------------------------------------
const mem = new Map();
globalThis.localStorage = {
  getItem: (k) => (mem.has(k) ? mem.get(k) : null),
  setItem: (k, v) => { mem.set(String(k), String(v)); },
  removeItem: (k) => { mem.delete(String(k)); },
};

const { outfitOf, picksOf, skinRecord, appearanceGen, resetSkinSpine } = await import('../../public/js/render/skinSpine.js');
const { setAppearanceFirst } = await import('../../public/js/ui/portraitChain.js');
const { store } = await import('../../public/js/store.js');

const side = (name, part, anims) => ({
  skel: `/workshop-assets/official-skins/spine/${name}/${part}/${name}.skel`,
  atlas: `/workshop-assets/official-skins/spine/${name}/${part}/${name}.atlas`,
  textures: [`/workshop-assets/official-skins/spine/${name}/${part}/${name}.png`],
  anims,
});
const ANIMS = { idle: 'Idle', deploy: 'Start', attack: { begin: null, loop: 'Attack_A', end: null }, die: 'Die', move: null, stun: null };
/** 一套带模型的时装（`mergeWorkshopSkins` 的落点形状）。 */
const SUMMER = { pack: 'official-skins', id: 'summer', name: '夏日余韵', art: { spine: { front: side('summer', 'front', ANIMS), back: side('summer', 'back', ANIMS) } } };
/** 一套只有头像的时装（`ui/skins.js availableSkins` 收它，这里不该出模型）。 */
const PICTURE_ONLY = { pack: 'official-skins', id: 'photo', name: '只换头像', art: { avatar: '/workshop-assets/official-skins/a.png' } };
const MANIFEST = { chars: {}, skins: { [OP]: [SUMMER, PICTURE_ONLY] } };

const unit = (ownerId = 'p1', over = {}) => ({ id: 7, uid: 7, kind: 'op', side: 'ally', ownerId, defId: 'chess_inside', spine: OP, ...over });
const seat = (playerId, picks) => ({ seat: 0, playerId, name: playerId, ...(picks ? { appearance: { picks } } : {}) });
const picked = (skinId) => ({ [OP]: { skinId } });
const ROOM = { code: 'ABCD', seats: [seat('p1', picked('summer')), seat('p2'), null] };

// ---- 1. 座位 → picks ----------------------------------------------------------------------------------------

test('picksOf: the seat’s appearance.picks, and nothing for an unseated player', () => {
  assert.deepEqual(picksOf(ROOM, 'p1'), picked('summer'));
  assert.equal(picksOf(ROOM, 'p2'), null, 'a seat with no appearance');
  assert.equal(picksOf(ROOM, 'p9'), null, 'not in the room (a spectator, a stale ownerId)');
  assert.equal(picksOf(null, 'p1'), null);
  assert.equal(picksOf(ROOM, null), null);
  assert.equal(picksOf({ seats: 'nope' }, 'p1'), null);
});

test('skinRecord: the outfit from assets.skins, by (charId, skinId)', () => {
  assert.equal(skinRecord(MANIFEST, OP, 'summer'), SUMMER);
  assert.equal(skinRecord(MANIFEST, OP, 'photo'), PICTURE_ONLY);
  assert.equal(skinRecord(MANIFEST, OP, 'nope'), null, 'the pack was uninstalled / the outfit renamed');
  assert.equal(skinRecord(MANIFEST, OTHER, 'summer'), null, 'another operator’s list');
  assert.equal(skinRecord({}, OP, 'summer'), null);
});

// ---- 2. 座位 → 时装模型 --------------------------------------------------------------------------------------

test('outfitOf: another player’s unit wears that player’s pick', () => {
  const o = outfitOf(unit('p1'), { manifest: MANIFEST, room: ROOM, me: 'p2', entries: null });
  assert.equal(o.skinId, 'summer');
  assert.equal(o.charId, OP);
  assert.equal(o.sides, SUMMER.art.spine, 'the spine sides of the outfit, the very manifest object');
});

test('outfitOf: the key is the operator, so an art-version suffix falls back to the charId', () => {
  const o = outfitOf(unit('p1', { spine: `${OP}_2` }), { manifest: MANIFEST, room: ROOM, me: 'p2', entries: null });
  assert.equal(o.charId, OP, 'the key the manifest groups by');
  assert.equal(o.sides, SUMMER.art.spine);
});

test('outfitOf: no pick, no outfit (the unit draws the installation’s model)', () => {
  assert.equal(outfitOf(unit('p2'), { manifest: MANIFEST, room: ROOM, me: 'p1', entries: null }), null, 'seated, chose nothing');
  assert.equal(outfitOf(unit('p9'), { manifest: MANIFEST, room: ROOM, me: 'p1', entries: null }), null, 'not seated at all');
  assert.equal(outfitOf(unit('p1'), { manifest: MANIFEST, room: null, me: 'p2', entries: null }), null, 'no room yet, not my unit');
});

test('outfitOf: an outfit the pack does not have, or one with no model, is no outfit', () => {
  const room = { seats: [seat('p1', picked('gone'))] };
  assert.equal(outfitOf(unit('p1'), { manifest: MANIFEST, room, me: 'p2', entries: null }), null, 'chosen, but the pack is gone');
  const photo = { seats: [seat('p1', picked('photo'))] };
  assert.equal(outfitOf(unit('p1'), { manifest: MANIFEST, room: photo, me: 'p2', entries: null }), null, 'an avatar-only outfit has no model');
});

test('outfitOf: enemies and non-units never wear an outfit', () => {
  assert.equal(outfitOf(unit('p1', { side: 'enemy' }), { manifest: MANIFEST, room: ROOM, me: 'p2', entries: null }), null);
  assert.equal(outfitOf(null, { manifest: MANIFEST, room: ROOM }), null);
  assert.equal(outfitOf({ side: 'ally', ownerId: 'p1' }, { manifest: MANIFEST, room: ROOM }), null, 'no spine / defId: no operator');
  assert.equal(outfitOf(unit('p1'), { manifest: null, room: ROOM, me: 'p2', entries: null }), null, 'no manifest yet: nothing to resolve');
});

// ---- 3. 自己那一半：本机优先 ----------------------------------------------------------------------------------

test('outfitOf: my own unit takes my local choice first, the room’s second', () => {
  // 本机没有选择（清空了 / 另一个标签页换的）：房间那一份接手 —— 那正是别人看到的你
  assert.equal(outfitOf(unit('p1'), { manifest: MANIFEST, room: ROOM, me: 'p1', entries: {} }).skinId, 'summer');
  // 本机刚点的这一套还没发出去（去抖 500 ms + 广播）：立刻用本机的，不等服务端那一帧
  assert.equal(outfitOf(unit('p1'), { manifest: MANIFEST, room: ROOM, me: 'p1', entries: { [OP]: 'summer' } }).skinId, 'summer');
  // 本机选了一套**没有模型**的时装（只换头像）：小人回到原版 —— 不能拿房间里那套旧的模型顶上
  assert.equal(outfitOf(unit('p1'), { manifest: MANIFEST, room: ROOM, me: 'p1', entries: { [OP]: 'photo' } }), null);
  // 本机选的那一套清单里没有（包被卸了）：同样是原版，不是房间里那套旧的
  assert.equal(outfitOf(unit('p1'), { manifest: MANIFEST, room: ROOM, me: 'p1', entries: { [OP]: 'gone' } }), null);
});

test('outfitOf: a summon with no owner id counts as mine (a solo board is all mine)', () => {
  const o = outfitOf(unit(null), { manifest: MANIFEST, room: null, me: 'p1', entries: { [OP]: 'summer' } });
  assert.equal(o.skinId, 'summer');
});

// ---- 4. 一个开关 ----------------------------------------------------------------------------------------------

test('outfitOf: the 工坊外观 switch gates the board too (the same one as the portrait chain)', () => {
  const world = { manifest: MANIFEST, room: ROOM, me: 'p2', entries: null };
  try {
    setAppearanceFirst(false);
    assert.equal(outfitOf(unit('p1'), world), null, 'off ⇒ nobody changes: the board is the installation’s');
  } finally {
    setAppearanceFirst(true);
  }
  assert.equal(outfitOf(unit('p1'), world).skinId, 'summer', 'on again ⇒ the outfit is back');
});

// ---- 5. 记忆化 ------------------------------------------------------------------------------------------------

test('outfitOf: one object per (charId, skinId), across calls and across units', () => {
  const world = { manifest: MANIFEST, room: ROOM, me: 'p2', entries: null };
  const a = outfitOf(unit('p1'), world);
  const b = outfitOf(unit('p1', { id: 99, uid: 99 }), world);
  assert.equal(a, b, 'retryAssets compares models across frames: a fresh object every call would mean a reload every time');
  assert.equal(Object.isFrozen(a), true, 'a cached answer is not something a caller may edit');
});

// ---- 6. 外观帧的代数 ------------------------------------------------------------------------------------------

test('appearanceGen: only a real appearance change bumps it', () => {
  resetSkinSpine();
  store.set({ room: ROOM });
  const g0 = appearanceGen();
  assert.equal(appearanceGen(), g0, 'stable while nothing changes');
  // 同一帧外观、别的东西变了（座位就绪 / 新的一帧 room.state）：不算外观变化
  store.set({ room: { ...ROOM, seats: [seat('p1', picked('summer')), seat('p2'), null], inMatch: true } });
  assert.equal(appearanceGen(), g0, 'the frame changed, the outfits did not');
  // 别人换了装 ⇒ +1
  store.set({ room: { ...ROOM, seats: [seat('p1', picked('winter')), seat('p2'), null] } });
  const g1 = appearanceGen();
  assert.ok(g1 > g0, 'an outfit change is what the views wait for');
  // 有人第一次换装（从前没有 appearance 这个键）⇒ +1
  store.set({ room: { ...ROOM, seats: [seat('p1', picked('winter')), seat('p2', { [OTHER]: { skinId: 'summer' } }), null] } });
  assert.ok(appearanceGen() > g1);
});
