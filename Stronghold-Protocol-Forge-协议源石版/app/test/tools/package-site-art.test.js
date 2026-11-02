// test/tools/package-site-art.test.js — 素材包（`npm run package -- --assets`）要收下包声明的**站点素材**（0.19.45）。
//
// 「导入素材包」只收服务器清单里列出、且带内容哈希的文件（public/js/assetPack.js 的 plan/校验）。时装那 2 193 个
// 文件搬进 `public/assets/skins/` 之后，它们出现在**合并后**的 `/data/assets.json` 里，但磁盘上那份 `data/assets.json`
// 一个字都没变 —— 而打包机读的是磁盘上那三份清单。少一条缝（`tools/package.mjs packSiteArt`）的后果很具体：
// 素材包少 2 193 个文件、不报错，玩家导入之后仍然要在对局里下 321 MB。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { packSiteArt, importableArt } from '../../tools/package.mjs';

function tree(files) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sp-pack-site-'));
  for (const [rel, content] of Object.entries(files)) {
    const p = path.join(dir, rel);
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, content);
  }
  return dir;
}

const PACK = {
  id: 'site-skins', name: '站点素材时装', version: '1.0.0', author: 'a', license: 'l', content: [],
  skins: [{
    id: 'x_1', charId: 'c', name: '测试外观',
    art: {
      avatar: '/assets/skins/art/s.webp',
      portrait: 'art/in-pack.webp', // 包内相对路径：不是站点素材，素材包不该把它算进来（它在包自己的 assets/ 里）
      spine: {
        front: {
          skel: '/assets/skins/spine/s/Front/s.skel',
          atlas: '/assets/skins/spine/s/Front/s.atlas',
          textures: ['/assets/skins/spine/s/Front/s.png'],
          anims: { idle: 'Idle' },
        },
      },
    },
  }],
};

const root = tree({
  'data/assets.json': JSON.stringify({ chars: { c: { name: 'c', avatar: '/assets/char/a.png' } } }),
  'workshop/site-skins/pack.json': JSON.stringify(PACK),
  'workshop/not-a-pack/readme.txt': 'x',
});

test('packSiteArt: 只收 /assets/ 起的 URL，Spine 整组当成一个模型；包内相对路径与别的根都不进来', () => {
  const site = packSiteArt(root);
  const strings = site.site.filter((x) => typeof x === 'string');
  const models = site.site.filter((x) => typeof x === 'object');
  assert.deepEqual(strings, ['/assets/skins/art/s.webp'], '一张独立文件（头像）');
  assert.equal(models.length, 1, JSON.stringify(models));
  assert.equal(models[0].skel, '/assets/skins/spine/s/Front/s.skel');
  assert.deepEqual(models[0].textures, ['/assets/skins/spine/s/Front/s.png']);
  assert.ok(!site.site.some((x) => JSON.stringify(x).includes('art/in-pack.webp')), '包内相对路径不进站点素材');
  // 没有 workshop/ 的 checkout（服务端分发包）不该炸
  assert.deepEqual(packSiteArt(tree({ 'package.json': '{}' })), { site: [] });
});

test('importableArt: 带上站点素材之后，这些文件才进得了素材包（哈希由 rewrite 那一步盖上）', () => {
  const assets = JSON.parse(fs.readFileSync(path.join(root, 'data/assets.json'), 'utf8'));
  const without = importableArt(assets, null, null);
  const withSite = importableArt(assets, null, null, packSiteArt(root));
  assert.deepEqual(without, ['public/assets/char/a.png'], '磁盘上的清单里没有这批站点素材 —— 这正是缺口');
  assert.deepEqual(withSite, [
    'public/assets/char/a.png',
    'public/assets/skins/art/s.webp',
    'public/assets/skins/spine/s/Front/s.atlas',
    'public/assets/skins/spine/s/Front/s.png',
    'public/assets/skins/spine/s/Front/s.skel',
  ]);
  // 一份没有站点素材的 checkout：第四个参数缺省或为空，结果逐字不变
  assert.deepEqual(importableArt(assets, null, null, { site: [] }), without);
});

test('现成的包声明（本仓 workshop/official-skins）真的会被认成站点素材', () => {
  const app = path.resolve(import.meta.dirname, '../..');
  const manifest = path.join(app, 'workshop/official-skins/pack.json');
  if (!fs.existsSync(manifest)) return; // 服务端分发包没有包目录
  const site = packSiteArt(app);
  const models = site.site.filter((x) => typeof x === 'object');
  assert.ok(site.site.length > 1000, `expected the official skins to declare site art, got ${site.site.length}`);
  assert.ok(models.length > 200, `expected Spine models among them, got ${models.length}`);
});
