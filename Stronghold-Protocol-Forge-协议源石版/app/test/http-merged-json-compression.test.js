// test/http-merged-json-compression.test.js — 装了包的服务器：合并过的 /data/*.json 也必须压缩（owner 2026-10-18）。
//
// 背景：workshop 包会改写 /data/chess.json、assets.json 等（官方 + 包的合并体）。那三个 handler 以前自己拼 headers
// 直接 res.end(buf)，绕开了 serveBuffer 的压缩缓存 —— unmerged 的小文件走 br/gzip，而 1.9 MB 的 chess.json /
// 1.8 MB 的 assets.json **原样**发出去。在 5 Mbps 的公网带宽上，这就是「页面很慢」的主因。
//
// 这里用真的 createStaticHandler + 一张合成的 workshopJson 表验证：br / gzip 都生效、解压后是合并体、ETag 随
// 编码变化且 304 仍然工作。
import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';
import { createStaticHandler } from '../server/http/static.js';

const quiet = { info() {}, warn() {}, error() {}, debug() {} };

function get(port, p, headers = {}) {
  return new Promise((resolve, reject) => {
    http.get({ host: '127.0.0.1', port, path: p, headers }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks) }));
    }).on('error', reject);
  });
}

test('merged /data JSON is compressed (br and gzip) and still revalidates by ETag', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sp-merged-json-'));
  for (const d of ['public', 'data', 'shared', 'sim']) fs.mkdirSync(path.join(root, d), { recursive: true });
  // a body well over the 512-byte compression floor, shaped like data/chess.json
  const records = {};
  for (let i = 0; i < 80; i++) records['chess_' + i] = { chessId: 'chess_' + i, name: '干员 ' + i, desc: '官方记录 '.repeat(3) };
  records.chess_pack = { chessId: 'chess_pack', name: 'P' };
  // the map is keyed by the DATA FILE NAME without '.json' (workshop.js buildMergedData): '/data/chess.json' → 'chess'
  const merged = new Map([['chess', Buffer.from(JSON.stringify(records))]]);
  const serve = createStaticHandler({
    publicDir: path.join(root, 'public'), dataDir: path.join(root, 'data'),
    sharedDir: path.join(root, 'shared'), simDir: path.join(root, 'sim'),
    workshopJson: merged, log: quiet,
  });
  const server = http.createServer((req, res) => serve(req, res, req.url.split('?')[0], ''));
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const port = server.address().port;
  try {
    const br = await get(port, '/data/chess.json', { 'accept-encoding': 'gzip, deflate, br' });
    assert.equal(br.status, 200);
    assert.equal(br.headers['content-encoding'], 'br', 'brotli wins when the client accepts it');
    assert.deepEqual(JSON.parse(zlib.brotliDecompressSync(br.body).toString('utf8')), records, 'the merged body survives compression');
    assert.ok(br.body.length < JSON.stringify(records).length / 2, 'brotli shrinks a real merged data file by more than half');
    assert.match(br.headers.etag, /^"ws-[0-9a-f]{20}-br"$/);
    assert.equal(br.headers['cache-control'], 'no-cache', 'revalidated, not no-store');

    const gz = await get(port, '/data/chess.json', { 'accept-encoding': 'gzip' });
    assert.equal(gz.headers['content-encoding'], 'gzip');
    assert.deepEqual(JSON.parse(zlib.gunzipSync(gz.body).toString('utf8')), records);
    assert.match(gz.headers.etag, /-gz"$/);

    const plain = await get(port, '/data/chess.json');
    assert.equal(plain.headers['content-encoding'], undefined, 'a client that accepts nothing gets the raw body');
    assert.deepEqual(JSON.parse(plain.body.toString('utf8')), records);

    const again = await get(port, '/data/chess.json', { 'accept-encoding': 'gzip', 'if-none-match': gz.headers.etag });
    assert.equal(again.status, 304, 'the ETag still revalidates');
    assert.equal(again.body.length, 0);
  } finally {
    await new Promise((r) => server.close(r));
    fs.rmSync(root, { recursive: true, force: true });
  }
});

// Owner's report 2026-10-18（第二层）：装了包的服务器上 `/data/assets.json` 的 19 434 个美术 URL 全是**裸路径**。
// 原因：工坊合并分支（static.js 的 `/data/*.json`）排在清单视图（`views`）**之前**，所以包一改动 assets.json，
// 那三条声明就永远走不到 `assetViews` 的 hash 改写 —— 合并体是原始数据。后果是浏览器无法长缓存素材（线上实测
// 96 分钟 135 212 次 assets 请求、3.23 GB，38 % 是全量重传）。
//
// 这里钉住：合并过的美术清单也带内容哈希；非美术清单（chess 等）一个字节都不动。
test('a MERGED art manifest still gets its content-hash URLs (the workshop branch shadows the view)', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sp-merged-hash-'));
  for (const d of ['public', 'data', 'shared', 'sim']) fs.mkdirSync(path.join(root, d), { recursive: true });
  const assets = {
    version: 1,
    chars: {
      char_x: {
        avatar: '/assets/char/avatar/char_x.png',
        portrait: '/assets/char/portrait/char_x.png',
        spine: { skel: '/assets/spine/op/char_x/front/char_x.skel', atlas: '/assets/spine/op/char_x/front/char_x.atlas', textures: ['/assets/spine/op/char_x/front/char_x.png'] },
      },
    },
  };
  const ART = '/assets/char/avatar/char_x.png';
  // a fake index: it knows exactly one file, and no models (so the spine block stays plain — the documented fallback).
  // `hashOf` is called with the index's rel path, which KEEPS the mount segment: '/assets/a.png' → 'assets/a.png'.
  const assetIndex = {
    ready: true, size: 1,
    hashOf: (rel) => (rel === 'assets/char/avatar/char_x.png' ? '0123456789abcdef' : null),
    modelHash: () => null,
  };
  const merged = new Map([['assets', Buffer.from(JSON.stringify(assets))]]);
  const serve = createStaticHandler({
    publicDir: path.join(root, 'public'), dataDir: path.join(root, 'data'),
    sharedDir: path.join(root, 'shared'), simDir: path.join(root, 'sim'),
    workshopJson: merged, assetIndex, log: quiet,
  });
  const server = http.createServer((req, res) => serve(req, res, req.url.split('?')[0], ''));
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const port = server.address().port;
  try {
    const r = await get(port, '/data/assets.json');
    assert.equal(r.status, 200);
    const body = JSON.parse(r.body.toString('utf8'));
    assert.equal(body.chars.char_x.avatar, '/assets/~0123456789abcdef/char/avatar/char_x.png', 'the hashed URL the index knows');
    assert.equal(r.body.toString('utf8').includes(`"${ART}"`), false, 'the plain form is gone');
    // a URL the index does NOT know stays as it is (the documented fallback, never a 404)
    assert.equal(body.chars.char_x.portrait, '/assets/char/portrait/char_x.png');
    // a spine model whose member is unknown keeps every URL plain (rewriteManifest's own rule)
    assert.equal(body.chars.char_x.spine.skel, '/assets/spine/op/char_x/front/char_x.skel');
  } finally {
    await new Promise((r) => server.close(r));
    fs.rmSync(root, { recursive: true, force: true });
  }
});

// The other half: a merged NON-art data file is passed through byte for byte (the hash step must not touch chess etc.).
test('a merged non-art data file is untouched by the hash step', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sp-merged-plain-'));
  for (const d of ['public', 'data', 'shared', 'sim']) fs.mkdirSync(path.join(root, d), { recursive: true });
  const chess = { chess_1: { chessId: 'chess_1', avatar: '/assets/should/not/be/touched.png' } };
  const merged = new Map([['chess', Buffer.from(JSON.stringify(chess))]]);
  const serve = createStaticHandler({
    publicDir: path.join(root, 'public'), dataDir: path.join(root, 'data'),
    sharedDir: path.join(root, 'shared'), simDir: path.join(root, 'sim'),
    workshopJson: merged,
    // an index that WOULD hash that path if it were asked
    assetIndex: { ready: true, size: 1, hashOf: () => '0123456789abcdef', modelHash: () => null },
    log: quiet,
  });
  const server = http.createServer((req, res) => serve(req, res, req.url.split('?')[0], ''));
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const port = server.address().port;
  try {
    const r = await get(port, '/data/chess.json');
    assert.deepEqual(JSON.parse(r.body.toString('utf8')), chess, 'only the three art manifests are rewritten');
  } finally {
    await new Promise((r) => server.close(r));
    fs.rmSync(root, { recursive: true, force: true });
  }
});
