// tools/asset-pack-doctor.mjs — 判断「已经发出去的素材包，对现在这台服务器还能不能用」。
//
// 这个工具的价值全在判据对不对，所以测试锁的也是判据：
//   * Spine 的哈希判据（模型哈希而不是成员哈希）—— 用成员哈希比会得到 2141 条假阳性，这是实测踩出来的；
//   * 「覆盖率」而不是「能不能用」—— 素材变了不该判定整包作废；
//   * 不认识的东西一律拒收，绝不猜（坏快照、旧格式、遍历路径）。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  MANIFESTS, SNAPSHOT_FORMAT, splitHashed, collectAcceptable, acceptableFromDocs,
  snapshotOf, compareSnapshot, fetchManifests, main,
  hashesFromPack,
} from '../../tools/asset-pack-doctor.mjs';

const H = (n) => String(n).padStart(16, 'a').slice(-16);

test('splitHashed: 只认带 16 位内容哈希的 /assets|/fonts URL', () => {
  assert.deepEqual(splitHashed(`/assets/~${H(1)}/char/a.png`), { rel: 'assets/char/a.png', hash: H(1) });
  assert.deepEqual(splitHashed(`/fonts/~${H(2)}/bender.woff2`), { rel: 'fonts/bender.woff2', hash: H(2) });
  // 不带哈希的、别的目录的、不是字符串的：都不是我们的事
  assert.equal(splitHashed('/assets/char/a.png'), null);
  assert.equal(splitHashed(`/media/~${H(3)}/x.mp3`), null);
  assert.equal(splitHashed(undefined), null);
  assert.equal(splitHashed(42), null);
  // 15 位 / 17 位都不算（哈希长度是契约的一部分）
  assert.equal(splitHashed('/assets/~aaaaaaaaaaaaaaa/char/a.png'), null);
  assert.equal(splitHashed('/assets/~aaaaaaaaaaaaaaaaa/char/a.png'), null);
  // 穿越拒绝
  assert.equal(splitHashed(`/assets/~${H(4)}/../secret`), null);
  assert.equal(splitHashed(`/assets/~${H(4)}/char/../../etc/passwd`), null);
});

test('splitHashed: 百分号转义按清单的 plain rel 还原', () => {
  const hit = splitHashed(`/assets/~${H(5)}/char/a%20b.png`);
  assert.deepEqual(hit, { rel: 'assets/char/a b.png', hash: H(5) });
});

test('collectAcceptable: 普通文件记自己的哈希', () => {
  const doc = { char: { avatar: { a: `/assets/~${H(1)}/char/a.png` } } };
  const table = collectAcceptable(doc);
  assert.deepEqual([...table.get('assets/char/a.png')], [H(1)]);
});

test('collectAcceptable: Spine 三个成员记**模型**哈希，不记各自的文件哈希', () => {
  const model = H(9);
  const doc = {
    spine: {
      front: {
        skel: `/assets/~${model}/spine/x/front/x.skel`,
        atlas: `/assets/~${model}/spine/x/front/x.atlas`,
        textures: [`/assets/~${model}/spine/x/front/x.png`],
      },
    },
  };
  const table = collectAcceptable(doc);
  for (const rel of ['assets/spine/x/front/x.skel', 'assets/spine/x/front/x.atlas', 'assets/spine/x/front/x.png']) {
    assert.deepEqual([...table.get(rel)], [model], `${rel} 应记模型哈希`);
  }
});

test('collectAcceptable: Spine 成员哈希不一致时退回按文件各算各的（不猜）', () => {
  const doc = {
    spine: { front: { skel: `/assets/~${H(1)}/spine/x.skel`, atlas: `/assets/~${H(2)}/spine/x.atlas` } },
  };
  const table = collectAcceptable(doc);
  assert.deepEqual([...table.get('assets/spine/x.skel')], [H(1)]);
  assert.deepEqual([...table.get('assets/spine/x.atlas')], [H(2)]);
});

test('collectAcceptable: 没列 textures 时按 <skel 去掉 .skel>.png 推导（与服务端一致）', () => {
  const model = H(7);
  const doc = { spine: { front: { skel: `/assets/~${model}/spine/x.skel`, atlas: `/assets/~${model}/spine/x.atlas` } } };
  const table = collectAcceptable(doc);
  assert.deepEqual([...table.get('assets/spine/x.png')], [model]);
});

test('collectAcceptable: 同一个 rel 出现多次且哈希不同 → 两个都可接受（清单里 duplicate）', () => {
  const doc = { a: `/assets/~${H(1)}/char/a.png`, b: `/assets/~${H(2)}/char/a.png` };
  const table = collectAcceptable(doc);
  assert.deepEqual([...table.get('assets/char/a.png')].sort(), [H(1), H(2)].sort());
});

test('acceptableFromDocs: 多份清单合并', () => {
  const table = acceptableFromDocs({
    'assets.json': { a: `/assets/~${H(1)}/char/a.png` },
    'local-fx.json': { b: `/assets/~${H(2)}/fx/b.png` },
    'missing.json': null,
  });
  assert.equal(table.size, 2);
});

test('compareSnapshot: 全对时覆盖率 100%、零漂移', () => {
  const live = new Map([['assets/a.png', new Set([H(1)])], ['assets/b.png', new Set([H(2)])]]);
  const snap = { 'assets/a.png': [H(1)], 'assets/b.png': [H(2)] };
  const r = compareSnapshot(snap, live);
  assert.equal(r.kept, 2);
  assert.equal(r.changed, 0);
  assert.equal(r.coverage, 100);
  assert.equal(r.drift, 0);
});

test('compareSnapshot: 一个文件换了 → 只有它算漂移，不是整包作废', () => {
  const live = new Map([['assets/a.png', new Set([H(1)])], ['assets/b.png', new Set([H(3)])]]);
  const snap = { 'assets/a.png': [H(1)], 'assets/b.png': [H(2)] };
  const r = compareSnapshot(snap, live);
  assert.equal(r.kept, 1);
  assert.equal(r.changed, 1);
  assert.equal(r.drift, 50);
  assert.deepEqual(r.samples.changed, ['assets/b.png']);
});

test('compareSnapshot: 新增/删除分别记账，且都不算「变了」', () => {
  const live = new Map([['assets/a.png', new Set([H(1)])], ['assets/new.png', new Set([H(5)])]]);
  const snap = { 'assets/a.png': [H(1)], 'assets/gone.png': [H(9)] };
  const r = compareSnapshot(snap, live);
  assert.equal(r.kept, 1);
  assert.equal(r.added, 1);
  assert.equal(r.removed, 1);
  assert.equal(r.changed, 0);
  // 覆盖率按**线上**总数算：2 个里有 1 个由包回答
  assert.equal(r.liveTotal, 2);
  assert.equal(r.coverage, 50);
});

test('compareSnapshot: 一个 rel 有多个可接受哈希时，命中任意一个都算 kept', () => {
  const live = new Map([['assets/a.png', new Set([H(2)])]]);
  const r = compareSnapshot({ 'assets/a.png': [H(1), H(2)] }, live);
  assert.equal(r.kept, 1);
  assert.equal(r.drift, 0);
});

test('snapshotOf: 形状与格式版本', () => {
  const table = new Map([['assets/b.png', new Set([H(2)])], ['assets/a.png', new Set([H(1)])]]);
  const snap = snapshotOf(table, { live: 'http://127.0.0.1', appVersion: '0.19.5 / abc' });
  assert.equal(snap.format, SNAPSHOT_FORMAT);
  assert.equal(snap.count, 2);
  assert.equal(snap.live, 'http://127.0.0.1');
  // rel 排序，哈希排序：同样的输入产出同样的字节（快照可以进版本库）
  assert.deepEqual(Object.keys(snap.files), ['assets/a.png', 'assets/b.png']);
});

test('MANIFESTS: 与服务端改写的四份清单一致', () => {
  assert.deepEqual([...MANIFESTS], ['assets.json', 'local-assets.json', 'emotes.json', 'local-fx.json']);
});

/** 一个最小的 fetch 替身：`routes` 是 url → { status, body, type }。 */
function fakeFetch(routes, { failFirst = {} } = {}) {
  const calls = [];
  const fn = async (url, opts) => {
    calls.push(url);
    const name = String(url).split('/').pop();
    const fail = failFirst[name] ?? 0;
    if (fail > 0) { failFirst[name] = fail - 1; throw Object.assign(new Error('timed out'), { name: 'TimeoutError' }); }
    const r = routes[name];
    if (!r) return { ok: false, status: 404, headers: { get: () => 'application/json' }, json: async () => ({}) };
    return {
      ok: r.status ? r.status < 400 : true,
      status: r.status || 200,
      headers: { get: (h) => (h.toLowerCase() === 'content-type' ? (r.type || 'application/json') : null) },
      json: async () => r.body,
    };
  };
  fn.calls = calls;
  return fn;
}

test('fetchManifests: 404 的清单被跳过（local-fx 是可选的）', async () => {
  const doFetch = fakeFetch({
    'assets.json': { body: { a: `/assets/~${H(1)}/char/a.png` } },
    'local-assets.json': { body: {} },
    'emotes.json': { body: {} },
    // local-fx.json 不在表里 → 404
  });
  const { docs, errors } = await fetchManifests('http://x', { doFetch });
  assert.deepEqual(errors, []);
  assert.deepEqual(Object.keys(docs).sort(), ['assets.json', 'emotes.json', 'local-assets.json']);
});

test('fetchManifests: 超时会重试，重试成功就不算错误', async () => {
  const doFetch = fakeFetch({
    'assets.json': { body: { a: `/assets/~${H(1)}/char/a.png` } },
  }, { failFirst: { 'assets.json': 2 } });
  const logs = [];
  const { docs, errors } = await fetchManifests('http://x', { doFetch, attempts: 3, log: (s) => logs.push(s) });
  assert.deepEqual(errors, []);
  assert.ok(docs['assets.json']);
  assert.equal(logs.length, 2, '两次失败各留一行');
});

test('fetchManifests: 重试用尽后把错误报出来（不静默吞掉）', async () => {
  const doFetch = fakeFetch({
    'assets.json': { body: {} },
  }, { failFirst: { 'assets.json': 99 } });
  const { docs, errors } = await fetchManifests('http://x', { doFetch, attempts: 2 });
  assert.equal(docs['assets.json'], undefined);
  assert.equal(errors.length, 1);
  assert.match(errors[0], /assets\.json/);
});

test('fetchManifests: 返回 HTML（路径不对的典型症状）要报错，不能当成清单', async () => {
  const doFetch = fakeFetch({ 'assets.json': { body: {}, type: 'text/html; charset=utf-8' } });
  const { docs, errors } = await fetchManifests('http://x', { doFetch, attempts: 1 });
  assert.equal(docs['assets.json'], undefined);
  assert.match(errors.join(' '), /HTML/);
});

/** 在一个临时目录里跑 main()，给出指定的 fetch 替身。 */
async function runMain(argv) {
  const out = [];
  const write = process.stdout.write.bind(process.stdout);
  process.stdout.write = (s) => { out.push(String(s)); return true; };
  try {
    const code = await main(argv);
    return { code, text: out.join('') };
  } finally {
    process.stdout.write = write;
  }
}

test('main: 未知子命令给用法并退出 1', async () => {
  const { code, text } = await runMain(['wat']);
  assert.equal(code, 1);
  assert.match(text, /usage/);
});

test('main: --help 退出 0', async () => {
  const { code, text } = await runMain(['--help']);
  assert.equal(code, 0);
  assert.match(text, /max-drift/);
});

test('main: check 缺 --snapshot 退出 1', async () => {
  const { code, text } = await runMain(['check']);
  assert.equal(code, 1);
  assert.match(text, /snapshot/);
});

test('main: check 格式版本不认识就拒绝（不猜）', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'apd-'));
  const file = path.join(dir, 'snap.json');
  fs.writeFileSync(file, JSON.stringify({ format: 999, files: {} }));
  const { code, text } = await runMain(['check', '--snapshot', file]);
  assert.equal(code, 1);
  assert.match(text, /格式/);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('main: check 遇到不存在的快照退出 1', async () => {
  const { code, text } = await runMain(['check', '--snapshot', path.join(os.tmpdir(), 'nope-xyz.json')]);
  assert.equal(code, 1);
  assert.match(text, /找不到/);
});

// 2026-10-19 事故的回归测试：`hashesFromPack` 曾经用 `fs.readFileSync` 整包读进内存，在一台 1.6 GB 的
// 服务器上检查 727 MB 的素材包时把内存吃干、内核杀掉进程、连带打死了线上槽（玩家 20 分钟进不去）。
// 现在它必须按偏移流式读：**读一个比堆上限还大的包也不能 OOM**。
//
// 这个测试造一个「声明很大、其实全是同一段字节」的 zip 不现实，所以反过来验：
// 跑一次真实的读，然后断言 RSS 的增量远小于文件大小。造包用的是 stored 条目，一个 file 里重复同一段内容，
// 这样「整包驻留」会立刻体现成 RSS 暴涨。
test('hashesFromPack: 不整包驻留内存（事故回归）', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'apd-mem-'));
  const zip = path.join(dir, 'big.zip');
  try {
    writeStoredZip(zip, [
      ['assets/a.bin', Buffer.alloc(4 * 1024 * 1024, 1)],
      ['assets/b.bin', Buffer.alloc(4 * 1024 * 1024, 2)],
      ['assets/c.bin', Buffer.alloc(4 * 1024 * 1024, 3)],
      ['assets/d.bin', Buffer.alloc(4 * 1024 * 1024, 4)],
      ['assets/e.bin', Buffer.alloc(4 * 1024 * 1024, 5)],
      ['assets/f.bin', Buffer.alloc(4 * 1024 * 1024, 6)],
    ]);
    const size = fs.statSync(zip).size;
    assert.ok(size > 24 * 1024 * 1024, `样本包应有 24 MB+，实际 ${size}`);

    global.gc?.();
    const before = process.memoryUsage().rss;
    const { own, files, bytes } = hashesFromPack(zip);
    const grew = process.memoryUsage().rss - before;

    assert.equal(files, 6);
    assert.equal(bytes, 24 * 1024 * 1024);
    assert.equal(own.size, 6);
    // 整包 readFileSync 会让 RSS 至少涨一个包大小；流式读只涨「一条 + 目录」。
    // 给到包大小的一半作为宽松上限，仍然能抓住「整包读入」这个错误。
    assert.ok(grew < size / 2, `RSS 增长了 ${(grew / 1048576).toFixed(1)} MB（包 ${(size / 1048576).toFixed(1)} MB）—— 疑似整包读入内存`);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

/** 写一个只含 stored 条目的最小 zip（够 readZipDirectory / readZipEntry 读）。 */
function writeStoredZip(file, entries) {
  const chunks = [];
  const central = [];
  let offset = 0;
  for (const [name, body] of entries) {
    const nameBuf = Buffer.from(name, 'utf8');
    const crc = crc32(body);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);          // version needed
    local.writeUInt16LE(0, 6);           // flags
    local.writeUInt16LE(0, 8);           // method = stored
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(body.length, 18);
    local.writeUInt32LE(body.length, 22);
    local.writeUInt16LE(nameBuf.length, 26);
    chunks.push(local, nameBuf, body);
    const cd = Buffer.alloc(46);
    cd.writeUInt32LE(0x02014b50, 0);
    cd.writeUInt16LE(20, 4);
    cd.writeUInt16LE(20, 6);
    cd.writeUInt16LE(0, 8);
    cd.writeUInt16LE(0, 10);             // method = stored
    cd.writeUInt32LE(crc, 16);
    cd.writeUInt32LE(body.length, 20);
    cd.writeUInt32LE(body.length, 24);
    cd.writeUInt16LE(nameBuf.length, 28);
    cd.writeUInt32LE(offset, 42);
    central.push(Buffer.concat([cd, nameBuf]));
    offset += local.length + nameBuf.length + body.length;
  }
  const cdBuf = Buffer.concat(central);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(entries.length, 8);
  eocd.writeUInt16LE(entries.length, 10);
  eocd.writeUInt32LE(cdBuf.length, 12);
  eocd.writeUInt32LE(offset, 16);
  fs.writeFileSync(file, Buffer.concat([...chunks, cdBuf, eocd]));
}

/** IEEE CRC-32（zip 要它，但本工具不校验，随便给对的就行）。 */
function crc32(data) {
  let c = 0xffffffff;
  for (let i = 0; i < data.length; i++) {
    c ^= data[i];
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  }
  return (c ^ 0xffffffff) >>> 0;
}
