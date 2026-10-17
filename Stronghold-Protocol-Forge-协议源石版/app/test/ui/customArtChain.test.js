// test/ui/customArtChain.test.js — 自制美术（docs/CUSTOM-ART.md）在**统一解析链**里的那一段。
//
// 业主 2026-10-16 报的「娅娜的立绘不对」：她的 `assets.portrait` 是 `char_9002_yana_1`，正本清单里
// `chars.char_9002_yana` 的别名是缠丸（char_113_cqbw）—— 移植到本树时链少了「`*Local` 覆盖层优先」这
// 一格，于是 `_1` 分支直接命中别名的那张图，她自己画的立绘永远轮不到（数据一直都在，只是没人读）。
//
// 两条不变量，一正一反：
//   * 有 `opts.local` 时：自制美术**放哪个换哪个**（立绘 / 头像 / 精锐各一档）；
//   * 没有时：258 个官方干员的解析结果**逐字不变**（这条是回归闸门 —— 链是九处渲染路径的唯一入口）。
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { portraitUrlOf, avatarUrlOf, localArtUrl, setLocalManifest, localManifestOf } from '../../public/js/ui/portraitChain.js';
import { chessPortraitUrl, chessAvatarUrl } from '../../public/js/ui/assetUrls.js';
import { localSpineEntry, spineEntry } from '../../public/js/assets.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const load = (f) => JSON.parse(readFileSync(path.join(ROOT, 'data', f), 'utf8'));

const m = load('assets.json');
const local = (() => { try { return load('local-assets.json'); } catch { return null; } })();
const YANA = 'char_9002_yana';
/** 娅娜在作坊包里的 chess 记录（workshop/yana-addition/chess.json）形状。 */
const yanaA = { charId: YANA, assets: { portrait: `${YANA}_1`, avatar: YANA } };
const yanaB = { charId: YANA, assets: { portrait: `${YANA}_2`, avatar: `${YANA}_2` }, isGolden: true };

test('localArtUrl: { group, name } 元数据 → data/local-assets.json 里的 path', () => {
  const man = { groups: { 'char/x': { 'portrait_1.png': { path: '/assets/local/char/x/portrait_1.png' } } } };
  assert.equal(localArtUrl(man, { group: 'char/x', name: 'portrait_1.png' }), '/assets/local/char/x/portrait_1.png');
  assert.equal(localArtUrl(man, { group: 'char/x', name: 'nope.png' }), null);
  assert.equal(localArtUrl(man, { group: 'char/y', name: 'portrait_1.png' }), null);
  assert.equal(localArtUrl(null, { group: 'char/x', name: 'portrait_1.png' }), null, '没有清单 → null（走别名）');
  assert.equal(localArtUrl(man, null), null);
  assert.equal(localArtUrl(man, {}), null, '元数据不完整不算一条');
});

test('娅娜：自制立绘 / 头像在链里优先于别名', { skip: !local?.groups?.[`char/${YANA}`] && 'no data/local-assets.json group' }, () => {
  // 没有清单时就是别名缠丸 —— 这正是业主报的那张图
  setLocalManifest(null);
  const alias = localArtUrl(local, m.chars[YANA]?.portraitLocal);
  assert.ok(alias, '她的清单里有自制立绘');
  assert.notEqual(portraitUrlOf(m, yanaA), alias, '没有清单 → 别名（旧行为）');
  assert.equal(portraitUrlOf(m, yanaA), m.chars[YANA].portrait, '没有清单 → 逐字回落到别名的 portrait');

  setLocalManifest(local);
  assert.equal(portraitUrlOf(m, yanaA), alias, '普通立绘 = 她自己那张');
  assert.equal(portraitUrlOf(m, yanaB), localArtUrl(local, m.chars[YANA].portraitE2Local), '精锐立绘 = 她的 portrait_2');
  assert.equal(avatarUrlOf(m, yanaA), localArtUrl(local, m.chars[YANA].avatarLocal), '头像 = 她自己的');
  assert.equal(portraitUrlOf(m, yanaA, { variant: 'elite' }), localArtUrl(local, m.chars[YANA].portraitE2Local), 'variant: elite 同样优先自制');
  setLocalManifest(null);
  assert.equal(localManifestOf(), null, '清掉之后链回到原样');
});

test('自制战斗模型：服务端逐文件发哈希时，skel/atlas 的名称校验仍然成立', () => {
  // 服务端（server/http/assetViews.js）只给 \`spine/…\` **组**里的文件一个共享模型哈希；自制干员的模型挂在
  // \`char/<charId>\` 组下，三个文件各拿**自己的**哈希 —— 于是「skel 去掉 .skel 就是 atlas」这条名称校验
  // 在比对**原始 URL** 时永远不成立，\`spineLocal\` 对自制干员就是死代码（业主 2026-10-16 报的立绘问题顺带查到）。
  const man = { groups: { 'char/x': {
    'spine/front/m.skel': { path: '/assets/~aaaaaaaaaaaaaaaa/char/x/spine/front/m.skel' },
    'spine/front/m.atlas': { path: '/assets/~bbbbbbbbbbbbbbbb/char/x/spine/front/m.atlas' },
    'spine/front/m.png': { path: '/assets/~cccccccccccccccc/char/x/spine/front/m.png' },
  } } };
  const sl = { group: 'char/x', skel: 'spine/front/m.skel', atlas: 'spine/front/m.atlas', textures: ['spine/front/m.png'], pma: false, anims: { idle: 'Idle' } };
  const e = localSpineEntry(sl, man, null);
  assert.ok(e, '哈希不同的 skel/atlas 仍解析成一条模型');
  assert.equal(e.skel, man.groups['char/x']['spine/front/m.skel'].path);
  // 真·不匹配的名字照样拒绝（这不是「不再校验」）
  const bad = localSpineEntry({ ...sl, atlas: 'spine/front/other.atlas' }, man, null);
  assert.equal(bad, null, 'atlas 对不上 skel 一律拒绝');
  // 缺一个文件也拒绝
  const missing = localSpineEntry(sl, { groups: { 'char/x': { 'spine/front/m.skel': { path: '/assets/~aaaaaaaaaaaaaaaa/char/x/spine/front/m.skel' } } } }, null);
  assert.equal(missing, null);
});

test('官方干员：带不带清单，解析结果逐字相同（258 个）', () => {
  const chess = load('chess.json');
  let n = 0;
  for (const c of Object.values(chess)) {
    if (!c.charId || c.isDiy || !c.assets) continue;
    n++;
    assert.equal(chessPortraitUrl(m, c), chessPortraitUrl(m, c, local), `portrait ${c.chessId}`);
    assert.equal(chessAvatarUrl(m, c), chessAvatarUrl(m, c, local), `avatar ${c.chessId}`);
  }
  assert.ok(n >= 200, `checked ${n} official chess`);
});
