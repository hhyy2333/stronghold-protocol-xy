// test/workshop-site-art.test.js — 时装/外观素材可以声明「站点素材」（`/assets/…`）而不是包内文件（0.19.45）。
//
// 为什么搬：276 套时装那 2 193 个文件是 321 MB。这一批美术放在包里有**两头都吃亏**的地方 —— `/workshop-assets/`
// 不在 `shared/assetPaths.js` 的内容哈希根里（浏览器没法长缓存、预载也存不进按地址分开的缓存），而「导入素材包」
// 只收服务器清单列出的、带内容哈希的文件（`public/js/assetPack.js`）。搬进 `public/assets/skins/` 之后，合并后的
// `/data/assets.json` 会给每条 URL 盖上哈希（`server/http/assetViews.js`），预载与导入因此免费得到。
//
// 这个文件钉住四条判据（任何一条错了，症状都是「包校验通过、时装也列出来了，图上不去」——静默失效）：
//   1. `isSiteArtPath`：只认 `/assets/…` 这一个绝对根，无穿越 / 无查询串 / 不自带内容哈希段；
//   2. 校验：`art` 与 `skins[].art` 都接受站点路径，**不需要**包里有一个 `assets/` 文件夹（`ART_NEEDS_ASSETS`
//      只对包内相对路径成立）；
//   3. 拒绝：别的绝对根（`/workshop-assets/…`、`/data/…`、`/etc/…`）一条都不行 —— 否则一个包能把任意 URL 塞进清单；
//   4. 合并：站点路径**原样**进 `assets.skins` / `assets.chars`（绝不再拼 `/workshop-assets/`），相对路径照旧拼。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isSiteArtPath, isArtPath, workshopArtUrl, normalizePackManifest, applyWorkshop } from '../shared/workshop.js';

const SITE_SKEL = '/assets/skins/spine/char_1_x/Front/char_1_x.skel';
const SITE_PNG = '/assets/skins/art/char_1_x.webp';

/** 一个只声明时装的最小包（其余字段给齐，好让失败落在被测的那一条判据上）。 */
function skinPack(art, extra = {}) {
  return {
    id: 'site-skins',
    name: '站点素材时装',
    version: '1.0.0',
    author: 'test',
    license: 'test only',
    content: [],
    skins: [{ id: 'x_1', charId: 'char_1_x', name: '测试外观', art }],
    ...extra,
  };
}

test('isSiteArtPath: 只认 /assets/ 这一个绝对根，且每一段都是死的', () => {
  // 合法：站点素材（时装图、Spine 三件套）
  assert.equal(isSiteArtPath(SITE_PNG), true);
  assert.equal(isSiteArtPath(SITE_SKEL), true);
  assert.equal(isSiteArtPath('/assets/skins/spine/a/Front/a.atlas'), true);
  // 别的绝对根一律不是「站点素材」：这条判据若放宽，一个包就能把任意 URL 写进客户端清单
  for (const bad of ['/workshop-assets/p/x.png', '/data/assets.json', '/etc/passwd', '/vendor/x.js', '/assetsx/y.png']) {
    assert.equal(isSiteArtPath(bad), false, bad);
  }
  // 穿越 / 空段 / 反斜杠 / 查询串 / 百分号编码的穿越
  for (const bad of ['/assets/../x.png', '/assets/skins/./x.png', '/assets//x.png', '/assets/skins\\x.png',
    '/assets/skins/x.png?v=1', '/assets/skins/x.png#a', '/assets/%2e%2e/x.png', '/assets/skins/%2Fx.png']) {
    assert.equal(isSiteArtPath(bad), false, bad);
  }
  // 自带内容哈希段：哈希由服务器按磁盘字节算，写死在清单里就是一份会漂的副本
  assert.equal(isSiteArtPath('/assets/~0123456789abcdef/skins/art/x.webp'), false);
  // 只有根、没有文件；不是字符串；超长
  assert.equal(isSiteArtPath('/assets/'), false);
  assert.equal(isSiteArtPath('/assets'), false);
  assert.equal(isSiteArtPath(null), false);
  assert.equal(isSiteArtPath(`/assets/${'a'.repeat(400)}.png`), false);
  // 相对路径不是站点路径（但它仍然是合法的**包内**路径，见下一条）
  assert.equal(isSiteArtPath('skins/x.webp'), false);
  assert.equal(isArtPath('skins/x.webp'), true);
  assert.equal(isArtPath('/workshop-assets/p/x.png'), false);
});

test('校验: skins[].art 与 art.chars 都可以写站点素材，且不需要包里有 assets/', () => {
  const hashed = { avatar: SITE_PNG, portrait: SITE_PNG, spine: { front: { skel: SITE_SKEL, atlas: SITE_SKEL.replace(/\.skel$/, '.atlas'), textures: [SITE_SKEL.replace(/\.skel$/, '.png')], anims: { idle: 'Idle' } } } };
  // hasAssets 缺省（false）：包里一个文件都没有，校验照旧通过
  const one = normalizePackManifest(skinPack(hashed), 'site-skins', {});
  assert.equal(one.ok, true, one.detail);
  assert.equal(one.pack.skins[0].art.avatar, SITE_PNG, '站点路径原样保留（不裁剪、不改写）');
  assert.equal(one.pack.skins[0].art.spine.front.skel, SITE_SKEL);
  // art.chars 是同一条判据（与 skins[].art 共用 parseArtEntry）
  const withArt = normalizePackManifest({ id: 'p', name: 'p', version: '1', author: 'a', license: 'l', content: [], art: { chars: { char_1_x: hashed } } }, 'p', {});
  assert.equal(withArt.ok, true, withArt.detail);
  // 混写：同一套里站点图 + 包内图
  const mixed = normalizePackManifest(skinPack({ avatar: SITE_PNG, portrait: 'skins/p.webp' }), 'site-skins', { hasAssets: true });
  assert.equal(mixed.ok, true, mixed.detail);
});

test('校验: 包内相对路径照旧要包里真有 assets/（ART_NEEDS_ASSETS 的判据从「声明了 art」收窄到「声明了包内路径」）', () => {
  const relative = normalizePackManifest({ id: 'p', name: 'p', version: '1', author: 'a', license: 'l', content: [], art: { chars: { char_1_x: { avatar: 'art/a.png' } } } }, 'p', {});
  assert.equal(relative.ok, false);
  assert.equal(relative.error, 'ART_NEEDS_ASSETS');
  // 站点素材不需要 assets/：同一个包换成 /assets/… 就通过
  const site = normalizePackManifest({ id: 'p', name: 'p', version: '1', author: 'a', license: 'l', content: [], art: { chars: { char_1_x: { avatar: SITE_PNG } } } }, 'p', {});
  assert.equal(site.ok, true, site.detail);
  // 一个包的 art 全在站点上时，`anims` 里的动画名（"Idle"）不能被当成「包内路径」
  const animsOnly = normalizePackManifest({ id: 'p', name: 'p', version: '1', author: 'a', license: 'l', content: [], art: { chars: { char_1_x: { spine: { front: { skel: SITE_SKEL, atlas: SITE_SKEL.replace(/\.skel$/, '.atlas'), anims: { idle: 'Idle' } } } } } } }, 'p', {});
  assert.equal(animsOnly.ok, true, animsOnly.detail);
});

test('校验: 别的绝对根被点名拒绝（SITE_PATH 不是「任何绝对路径」）', () => {
  for (const bad of ['/workshop-assets/other/x.png', '/etc/passwd', '/data/assets.json']) {
    const r = normalizePackManifest(skinPack({ avatar: bad }), 'site-skins', {});
    assert.equal(r.ok, false, bad);
    assert.equal(r.error, 'ART_PATH_UNSAFE', bad);
  }
});

test('合并: 站点路径原样进 assets.skins，包内路径照旧拼 /workshop-assets/<包>/', () => {
  const site = normalizePackManifest(skinPack({ avatar: SITE_PNG, spine: { front: { skel: SITE_SKEL, atlas: SITE_SKEL.replace(/\.skel$/, '.atlas'), textures: [SITE_SKEL.replace(/\.skel$/, '.png')], anims: { idle: 'Idle' } } } }), 'site-skins', {}).pack;
  // 另一个包：同一名干员的**另一套** id（同 id 会走 SKIN_COLLISION「包 id 小的赢」，测不到两条 URL 规则）
  const local = normalizePackManifest({
    ...skinPack({ avatar: 'skins/x.webp' }, { id: 'local-skins' }),
    skins: [{ id: 'x_2', charId: 'char_1_x', name: '测试外观（包内）', art: { avatar: 'skins/x.webp' } }],
  }, 'local-skins', { hasAssets: true }).pack;
  const base = { assets: { chars: { char_1_x: { name: 'x' } } } };
  const { data } = applyWorkshop(base, [site, local]);
  const mine = data.assets.skins.char_1_x;
  const byPack = Object.fromEntries(mine.map((s) => [s.pack, s]));
  assert.equal(byPack['site-skins'].art.avatar, SITE_PNG, '站点素材原样（绝不再拼 /workshop-assets/）');
  assert.equal(byPack['site-skins'].art.spine.front.skel, SITE_SKEL);
  assert.equal(
    byPack['local-skins'].art.avatar,
    '/workshop-assets/local-skins/skins/x.webp',
    '包内相对路径照旧走包素材路由',
  );
});

test('workshopArtUrl: 两条通道的拼法只此一处', () => {
  assert.equal(workshopArtUrl('p', SITE_PNG), SITE_PNG);
  assert.equal(workshopArtUrl('p', 'skins/a b.webp'), '/workshop-assets/p/skins/a%20b.webp');
  assert.equal(workshopArtUrl('p', 'skins/a.webp', '/other/'), '/other/p/skins/a.webp');
});
