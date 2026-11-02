// test/sim/simloader-room-fallback.test.js —— 房间数据面（`/room-data/<digest>/`）取不到时，模拟数据回落到
// 全局 `/data/`（0.19.43，业主 2026-11-02「还是有人不出怪」）。
//
// 为什么要有这一条：`/room-data/<digest>/` 是**进程内存**里的物化结果（server/roomAssets.js 的 byDigest）。服务重启、
// 房间的模组集合在玩家打开页面之后又改过、或者那个摘要从没被物化过，这一面就会 404；而 `loadBrowserSim` 在缺文件时
// 是直接抛错的 ⇒ 这一场一次模拟都跑不起来 ⇒ 服务端 60 秒后按 timeout 接管 ⇒ 玩家看到「进对局不出怪」。
// 回落最多是数据与房间声明的子集有出入（服务端有校验与重算兜底），比整场空白好。
import test from 'node:test';
import assert from 'node:assert/strict';

import { loadSimData, SIM_DATA_FILES } from '../../public/js/battle/simLoader.js';

test('房间面整体 404：回落到 /data/，并且把用到的面报回来', async () => {
  const seen = [];
  const fetchFn = async (url) => {
    seen.push(url);
    if (url.startsWith('/room-data/')) return { ok: false, json: async () => null };
    return { ok: true, json: async () => ({ file: url }) };
  };
  const r = await loadSimData({ dataBase: '/room-data/abc123/', fetchFn });
  assert.equal(r.fellBack, true);
  assert.equal(r.dataBase, '/data/');
  assert.equal(r.files.length, SIM_DATA_FILES.length);
  for (const [i, f] of r.files.entries()) assert.deepEqual(f, { file: `/data/${SIM_DATA_FILES[i]}.json` });
  assert.ok(seen.some((u) => u.startsWith('/room-data/')), '先试过房间面');
  assert.ok(seen.some((u) => u.startsWith('/data/')), '然后回落到全局面');
});

test('房间面只有一部分缺失：仍然整体回落（不混用两个面的文件）', async () => {
  const fetchFn = async (url) => {
    if (url.startsWith('/room-data/')) {
      return SIM_DATA_FILES.some((n) => url.endsWith(`${n}.json`)) && !url.endsWith(`${SIM_DATA_FILES[0]}.json`)
        ? { ok: true, json: async () => ({ from: 'room' }) }
        : { ok: false, json: async () => null };
    }
    return { ok: true, json: async () => ({ from: 'global' }) };
  };
  const r = await loadSimData({ dataBase: '/room-data/abc123/', fetchFn });
  assert.equal(r.fellBack, true);
  assert.ok(r.files.every((f) => f && f.from === 'global'), '回落时整份都是全局面');
});

test('两个面都取不到：交回 null（调用方仍然抛「simulation data unavailable」），不假装成功', async () => {
  const fetchFn = async () => ({ ok: false, json: async () => null });
  const r = await loadSimData({ dataBase: '/room-data/abc123/', fetchFn });
  assert.equal(r.fellBack, false);
  assert.equal(r.dataBase, '/room-data/abc123/');
  assert.ok(r.files.every((f) => f == null));
});

test('本来就是全局面：不额外多取一遍（房间外的对局与从前逐字节相同）', async () => {
  let calls = 0;
  const r = await loadSimData({ dataBase: '/data/', fetchFn: async () => { calls++; return { ok: true, json: async () => ({}) }; } });
  assert.equal(r.fellBack, false);
  assert.equal(r.dataBase, '/data/');
  assert.equal(calls, SIM_DATA_FILES.length * 1, '每个文件只取一次');
});

test('房间内容集给了结构化数据：一次网络请求都不发', async () => {
  let calls = 0;
  const data = Object.fromEntries(SIM_DATA_FILES.map((n) => [n, { n }]));
  const r = await loadSimData({ dataBase: '/room-data/abc/', data, fetchFn: async () => { calls++; return { ok: true, json: async () => ({}) }; } });
  assert.equal(calls, 0);
  assert.equal(r.fellBack, false);
  assert.equal(r.files.length, SIM_DATA_FILES.length);
});
