// test/workshop-site-art-server.test.js — 站点素材走完服务器那四步：合并 → 视图 → 内容哈希 → 长缓存（0.19.45）。
//
// 时装那 2 193 个文件（321 MB）从包里搬进了 `public/assets/skins/`，包只声明 `/assets/…` 的 URL。搬家的收益全在
// 这条链上，而链上任何一环断了都不会报错 —— 图还是能出来，只是每次都回源：
//
//   pack.json `/assets/skins/…`
//     ├─► applyWorkshop 合并进 `data.assets.skins`（`shared/workshop.js mergeWorkshopSkins`）
//     ├─► `/data/assets.json`（合并体分支）套 `rewriteManifest`：每个文件、整组 Spine 一个模型哈希
//     ├─► `assetIndex.setModels` 认得这些模型（`assetViews.js siteModels` + `server/index.js` 的 `extraModels`）
//     └─► `/room-data/<digest>/assets.json`（对局中客户端真正读的那一份）同样带哈希
//
// 最后一步曾经漏着：`/room-data/` 那条分支把物化好的数据原样发出去，URL 全是裸路径。进了对局以后预载一个都命中不了，
// 321 MB 会在每局重下 —— 所以这里逐个钉住：**视图有哈希、派生出的 atlas URL 是 immutable、房间面也有哈希**。
import { test, before, after, describe } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { startServer } from '../server/index.js';
import { siteModels } from '../server/http/assetViews.js';
import { hash16 } from '../server/http/assetIndex.js';

const IMMUTABLE = 'public, max-age=31536000, immutable';
const sha16 = (buf) => createHash('sha256').update(buf).digest('hex').slice(0, 16);
const DIGEST = 'd'.repeat(64);

function tree(files) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sp-site-art-'));
  for (const [rel, content] of Object.entries(files)) {
    const p = path.join(dir, rel);
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, content);
  }
  return dir;
}

function get(port, p) {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port, path: p, agent: false }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks) }));
    });
    req.on('error', reject);
    req.end();
  });
}

const skel = Buffer.from('SKELETON-BYTES');
const atlas = Buffer.from('atlas\nsize: 1,1\n');
const page = Buffer.from('PNG-PAGE');
const art = Buffer.from('WEBP-ART');
const official = Buffer.from('OFFICIAL-AVATAR');

const SKIN = {
  id: 'x_1',
  charId: 'c',
  name: '测试外观',
  art: {
    avatar: '/assets/skins/art/s.webp',
    spine: {
      front: {
        skel: '/assets/skins/spine/s/Front/s.skel',
        atlas: '/assets/skins/spine/s/Front/s.atlas',
        textures: ['/assets/skins/spine/s/Front/s.png'],
        anims: { idle: 'Idle' },
      },
    },
  },
};

describe('a pack that declares site art', () => {
  let dir;
  let srv;
  before(async () => {
    dir = tree({
      'public/assets/char/c/a.png': official,
      'public/assets/skins/art/s.webp': art,
      'public/assets/skins/spine/s/Front/s.skel': skel,
      'public/assets/skins/spine/s/Front/s.atlas': atlas,
      'public/assets/skins/spine/s/Front/s.png': page,
      'data/assets.json': JSON.stringify({ chars: { c: { name: 'c', avatar: '/assets/char/c/a.png' } } }),
      'data/config.json': '{}',
      'shared/x.js': 'export const y = 2;',
      'workshop/site-skins/pack.json': JSON.stringify({
        id: 'site-skins', name: '站点素材时装', version: '1.0.0', author: 'test', license: 'test only',
        content: [], skins: [SKIN],
      }),
      // 第二个包只为让「房间声明的子集」不等于「进程集合」：`server/roomAssets.js forRoom` 在两者相等时直接把进程
      // 数据原样交出去（`isProcess`），那样一局里就没有 room face 可验，这条测试会变成假绿灯。
      'workshop/z-other/pack.json': JSON.stringify({
        id: 'z-other', name: '另一个包', version: '1.0.0', author: 'test', license: 'test only',
        content: [], skins: [{ id: 'o_1', charId: 'o', name: '另一名干员的外观' }],
      }),
    });
    srv = await startServer({
      port: 0, host: '127.0.0.1', quiet: true,
      publicDir: path.join(dir, 'public'), dataDir: path.join(dir, 'data'), sharedDir: path.join(dir, 'shared'),
      workshopDir: path.join(dir, 'workshop'), assetIndex: { delayMs: 0 },
    });
    await srv.assetIndex.whenReady();
    await srv.views.rebuildAll();
  });
  after(async () => {
    await srv?.close();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  const skinOf = async (url) => {
    const doc = JSON.parse((await get(srv.port, url)).body);
    return { doc, skin: doc.skins.c[0], model: hash16([skel, atlas, page].map(sha16).join('\n')) };
  };

  test('/data/assets.json: 站点素材的每条 URL 都带内容哈希，Spine 整组共用一个模型哈希', async () => {
    const { skin, model } = await skinOf('/data/assets.json');
    assert.ok(skin, 'the pack skins are merged into the served manifest');
    assert.equal(skin.art.avatar, `/assets/~${sha16(art)}/skins/art/s.webp`, 'own hash for a standalone file');
    const front = skin.art.spine.front;
    assert.deepEqual(
      [front.skel, front.atlas, front.textures[0]],
      ['skel', 'atlas', 'png'].map((ext) => `/assets/~${model}/skins/spine/s/Front/s.${ext}`),
      'one model hash for skeleton + atlas + page',
    );
    assert.deepEqual(front.anims, { idle: 'Idle' }, 'the metadata rides along untouched');
  });

  test('模型在索引里登记了（extraModels）：派生出来的 atlas URL 是 immutable，而不是「对的字节、每次回源」', async () => {
    const { skin } = await skinOf('/data/assets.json');
    const front = skin.art.spine.front;
    for (const url of [front.skel, front.atlas, front.textures[0], front.skel.replace(/\.skel$/, '.atlas')]) {
      const r = await get(srv.port, url);
      assert.equal(r.status, 200, url);
      assert.equal(r.headers['cache-control'], IMMUTABLE, url);
    }
    // 自己不认识的哈希段：字节照发，但不给长缓存（与 assetIndex 的既有判据一致）
    const stale = await get(srv.port, front.atlas.replace(/~[0-9a-f]{16}/, '~0000000000000000'));
    assert.equal(stale.status, 200);
    assert.equal(stale.headers['cache-control'], 'no-cache');
  });

  test('/room-data/<digest>/assets.json: 对局中客户端读的那一份同样带哈希（否则预载一局都命中不了）', async () => {
    const roomAssets = srv.lobby?.workshop?.roomAssets;
    assert.ok(roomAssets, 'this server runs packs, so it has a room face');
    roomAssets.forRoom({ digest: DIGEST, packs: [{ id: 'site-skins' }] });
    const { skin, model } = await skinOf(`/room-data/${DIGEST}/assets.json`);
    assert.ok(skin, 'the room face carries the declared pack skins too');
    assert.equal(skin.art.avatar, `/assets/~${sha16(art)}/skins/art/s.webp`);
    assert.equal(skin.art.spine.front.skel, `/assets/~${model}/skins/spine/s/Front/s.skel`);
    const r = await get(srv.port, skin.art.spine.front.atlas);
    assert.equal(r.headers['cache-control'], IMMUTABLE);
  });
});

test('siteModels: 只收 /assets/ 起的 Spine 模型，别的来源（包素材路由）不进来', () => {
  const catalog = {
    chars: {
      a: { avatar: '/assets/a.png', spine: { front: { skel: '/assets/x/a.skel', atlas: '/assets/x/a.atlas', textures: ['/assets/x/a.png'] } } },
      b: { spine: { front: { skel: '/workshop-assets/p/x/b.skel', atlas: '/workshop-assets/p/x/b.atlas' } } },
    },
    skins: { c: [{ art: { spine: { front: { skel: '/assets/skins/spine/s/Front/s.skel', atlas: '/assets/skins/spine/s/Front/s.atlas' } } } }] },
  };
  const models = siteModels(catalog);
  assert.equal(models.length, 2, JSON.stringify(models));
  assert.deepEqual(models[0], ['assets/x/a.skel', 'assets/x/a.atlas', 'assets/x/a.png']);
  assert.deepEqual(models[1], ['assets/skins/spine/s/Front/s.skel', 'assets/skins/spine/s/Front/s.atlas', 'assets/skins/spine/s/Front/s.png'],
    'a model that lists no textures names the default <skel>.png page, exactly like the server hashes it');
});
