// test/match/room-data-files.test.js —— `/room-data/<房间摘要>/<文件>.json` 的**文件名白名单**必须覆盖浏览器模拟要的每
// 一份数据（业主 2026-11-02 有人报「三个独立摘要都缺同一个文件：moduleLevels 404」）。
//
// 事故形状：路由的白名单原先直接复用 `DATA_FILES`（「缺文件时喊一声」的**必存在**清单），而 `moduleLevels` 是**可选**
// 文件（`data/moduleLevels.json` 由 build-data 额外产出，老内容集合法地没有它），所以不在 `DATA_FILES` 里；但浏览器的
// `SIM_DATA_FILES` **需要它**（协议源石【特限恢复】的 3 级模组）。于是每一个**声明了模组集合的房间**取
// `/room-data/<digest>/moduleLevels.json` 都是 404：
//   * 0.19.42 及以前：`loadBrowserSim` 缺文件直接抛 → 整场不模拟 → 服务端 60 秒后按 timeout 接管 → 「进对局不出怪」；
//   * 0.19.43 起：回落到全局 `/data/`（能打，但可能与被声明子集不同步）。
// 这条测试钉住「两份清单不可能再漂」。
import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { DATA_FILES, ROOM_DATA_FILES, loadData } from '../../server/data.js';
import { SIM_DATA_FILES } from '../../public/js/battle/simLoader.js';
import { loadWorkshop } from '../../server/workshop.js';
import { createRoomAssets } from '../../server/roomAssets.js';
import { modSetOf } from '../../shared/modIdentity.js';

const APP = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

test('浏览器模拟要的每一份数据，房间数据面都必须能送（SIM_DATA_FILES ⊆ ROOM_DATA_FILES）', () => {
  const missing = SIM_DATA_FILES.filter((n) => !ROOM_DATA_FILES.includes(n));
  assert.deepEqual(missing, [], `房间数据面缺这些文件：${missing.join(', ')}`);
});

test('moduleLevels 是「可选」文件：不在必存在清单里，但一定在房间数据面的白名单里', () => {
  assert.equal(DATA_FILES.includes('moduleLevels'), false, 'DATA_FILES 只用于「缺文件时喊一声」，moduleLevels 缺了是合法的');
  assert.equal(ROOM_DATA_FILES.includes('moduleLevels'), true, '但浏览器需要它 ⇒ 路由白名单必须有');
});

test('房间物化出来的数据里真的带着 moduleLevels（不是空表）', () => {
  const globalData = loadData(path.join(APP, 'data'));
  const official = loadData(path.join(APP, 'data'), { workshopDir: null });
  assert.ok(globalData.moduleLevels && Object.keys(globalData.moduleLevels).length > 100, '全局面有 3 级模组表');
  const packs = loadWorkshop().packs || [];
  const roomAssets = createRoomAssets({
    official, processData: globalData, packs, kits: {}, kitOwners: new Map(), tokenKits: {}, tokenKitOwners: new Map(), modules: [],
  });
  const subset = packs.filter((p) => p.id === 'official-skins');
  const set = modSetOf(subset.map((p) => ({ id: p.id, hash: p.hash, layer: p.layer, combat: p.combat })));
  const { data } = roomAssets.forRoom(set);
  assert.ok(data.moduleLevels && Object.keys(data.moduleLevels).length > 100, '声明了集合的房间也带着它');
});

test('白名单里其它文件仍在（白名单只加不减）', () => {
  for (const n of DATA_FILES) assert.ok(ROOM_DATA_FILES.includes(n), `${n} 被漏掉了`);
});
