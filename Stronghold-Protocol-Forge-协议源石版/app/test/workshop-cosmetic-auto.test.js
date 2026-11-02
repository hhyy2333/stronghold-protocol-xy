// test/workshop-cosmetic-auto.test.js —— 纯外观包（只带 skins / art / voices，`content: []`、`combat: false`）
// **自动进每一间房的模组集合**（业主 2026-11-02「皮肤模组应该自动选择上」）。
//
// 为什么需要这一条：房间的素材集是按 `room.modIds` materialise 的（server/roomAssets.js），房主一旦声明了一个子集、
// 漏勾时装包，那间房的玩家就看不到时装 —— 而这类包不可能影响战果，所以不给勾掉的入口。
//
// 判据与行为各只有一份实现：`shared/workshop.js isCosmeticOnlyPack` 判「是不是纯外观包」，
// `server/lobby.js resolveRoomModSet` 负责把它们的 id 并进集合。
import test from 'node:test';
import assert from 'node:assert/strict';

import { isCosmeticOnlyPack } from '../shared/workshop.js';
import { Lobby, resolveRoomModSet } from '../server/lobby.js';
import { loadWorkshop } from '../server/workshop.js';

const loaded = loadWorkshop();
const byId = new Map(loaded.packs.map((p) => [p.id, p]));
const skinPack = byId.get('official-skins');

test('真实工坊目录：官方时装包是纯外观包，其它包不是', () => {
  assert.ok(skinPack, 'official-skins 在 workshop/ 里（素材不进 git，但 pack.json 在）');
  assert.equal(skinPack.combat, false);
  assert.ok(Array.isArray(skinPack.skins) && skinPack.skins.length > 0);
  assert.equal(isCosmeticOnlyPack(skinPack), true, '只带 skins、content 空、combat false ⇒ 纯外观包');
  // 带内容 / 服务端模块的包都不是（这里用真实目录里的两个，避免写臆造的 fixture）
  for (const id of ['originium-exchange', 'clemnt-addition', 'yana-addition', 'ds-whale', 'field-store']) {
    const p = byId.get(id);
    if (!p) continue;
    assert.equal(isCosmeticOnlyPack(p), false, `${id} 不该被当成纯外观包`);
  }
});

test('判据：改得了对局的包一律不算（content / server / client / overrides / behaviour / variants / forms / fx / combat）', () => {
  const base = { id: 'x', content: [], combat: false, skins: [{ id: 'a', charId: 'char_1_01', name: 'a' }] };
  assert.equal(isCosmeticOnlyPack(base), true);
  for (const patch of [
    { content: ['chess.json'] },
    { combat: true },
    { server: { modules: [] } },
    { client: { panels: [] } },
    { overrides: ['chess:chess_char_1_01_a'] },
    { behaviour: [{ switch: 'unequip' }] },
    { variants: [{ axis: 'level' }] },
    { forms: { chars: {} } },
    { fx: { silentPhases: [] } },
  ]) {
    assert.equal(isCosmeticOnlyPack({ ...base, ...patch }), false, `不该放行 ${Object.keys(patch)[0]}`);
  }
  // 什么都不带（连外观都没有）也不是「纯外观包」
  assert.equal(isCosmeticOnlyPack({ id: 'x', content: [], combat: false }), false);
  // i18n / notices / playtest 这类既不进资产也不改对局，允许
  assert.equal(isCosmeticOnlyPack({ ...base, i18n: { en: 'ui.json' }, playtest: { directToHand: [] } }), true);
});

const catalogue = [
  { id: 'official-skins', hash: 'a'.repeat(64), layer: 'A', combat: false },
  { id: 'yana-addition', hash: 'b'.repeat(64), layer: 'A', combat: false },
  { id: 'field-store', hash: 'c'.repeat(64), layer: 'A', combat: false },
];
const AUTO = new Set(['official-skins']);

test('房主声明了一个不含时装包的子集：时装包仍会被并进去', () => {
  const r = resolveRoomModSet(['yana-addition'], catalogue, AUTO);
  assert.equal(r.ok, true);
  assert.deepEqual(r.modIds, ['official-skins', 'yana-addition']);
  assert.equal(r.modSet.packs.length, 2);
  assert.ok(r.modSet.packs.some((p) => p.id === 'official-skins'), '摘要里也有它（客户端要能校验同一份集合）');
});

test('不声明（空列表）= 跑服务器加载的全部包：不额外造出一个集合', () => {
  const r = resolveRoomModSet([], catalogue, AUTO);
  assert.deepEqual(r, { ok: true, modIds: [], modSet: null });
});

test('房主显式勾了时装包：只出现一次（不重复、顺序仍排序）', () => {
  const r = resolveRoomModSet(['yana-addition', 'official-skins'], catalogue, AUTO);
  assert.deepEqual(r.modIds, ['official-skins', 'yana-addition']);
});

test('未知 id 仍然点名拒绝；时装包的自动并入不会掩盖它', () => {
  const r = resolveRoomModSet(['no-such-pack'], catalogue, AUTO);
  assert.equal(r.ok, false);
  assert.deepEqual(r.unknown, ['no-such-pack']);
});

test('自动集合里有一个服务器没装载的 id：静默忽略，不影响其它包', () => {
  const r = resolveRoomModSet(['yana-addition'], catalogue, new Set(['official-skins', 'gone-pack']));
  assert.equal(r.ok, true);
  assert.deepEqual(r.modIds, ['official-skins', 'yana-addition']);
});

test('房主没勾时装包、也没勾任何可用包（全是未知）：仍然按未知拒绝', () => {
  const r = resolveRoomModSet(['official-skins'], catalogue, AUTO);
  assert.equal(r.ok, true);
  assert.deepEqual(r.modIds, ['official-skins']);
});

test('Lobby 从装载期那份 cosmeticMods 建出自动集合（server/index.js 把判据算一次、Lobby 只读）', () => {
  const lobby = new Lobby({
    registry: null,
    workshop: { mods: [{ id: 'official-skins', hash: 'a'.repeat(64), layer: 'A', combat: false }], cosmeticMods: ['official-skins', 'gone-pack'] },
    options: {},
  });
  assert.deepEqual([...lobby.cosmeticModIds].sort(), ['gone-pack', 'official-skins']);
  assert.equal(lobby.cosmeticModIds instanceof Set, true);
});

test('没有 cosmeticMods（老进程 / 测试桩）时是空集合，行为与从前一致', () => {
  const lobby = new Lobby({ registry: null, workshop: null, options: {} });
  assert.equal(lobby.cosmeticModIds.size, 0);
  assert.deepEqual(resolveRoomModSet(['yana-addition'], catalogue, lobby.cosmeticModIds).modIds, ['yana-addition']);
});
