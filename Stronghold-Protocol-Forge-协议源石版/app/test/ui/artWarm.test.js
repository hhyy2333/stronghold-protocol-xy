// test/ui/artWarm.test.js — 资源预加载（public/js/render/artWarm.js）的三条纪律：
// 不阻塞、不持有（Spine 的 acquire/release 必须成对）、不抛错。
import test from 'node:test';
import assert from 'node:assert/strict';
import { pictureUrlOf, warmInfo, warmInfos } from '../../public/js/render/artWarm.js';

/** 一个记录所有调用的 assets 替身。 */
function fakeAssets(over = {}) {
  const calls = { image: [], acquire: [], release: [], peek: 0 };
  const a = {
    calls,
    picture: (id) => (id === 'nope' ? null : '/assets/a/' + id + '.png'),
    image: (u) => { calls.image.push(u); return Promise.resolve({}); },
    spineEntry: (id) => (id === 'nospine' ? null : { skel: '/assets/s/' + id + '.skel' }),
    spine: {
      acquire: (e) => { calls.acquire.push(e.skel); return Promise.resolve({}); },
      release: (e) => { calls.release.push(e.skel); },
      peek: () => { calls.peek++; return null; },
    },
    ...over,
  };
  return a;
}

test('pictureUrlOf: 取值顺序与 units.js 一致（avatar → defId → spine），道具直接用 icon', () => {
  const a = fakeAssets();
  assert.equal(pictureUrlOf(a, { kind: 'op', avatar: 'av', defId: 'def' }), '/assets/a/av.png');
  assert.equal(pictureUrlOf(a, { kind: 'op', defId: 'def', spine: 'sp' }), '/assets/a/def.png');
  assert.equal(pictureUrlOf(a, { kind: 'op', spine: 'sp' }), '/assets/a/sp.png');
  assert.equal(pictureUrlOf(a, { kind: 'op' }), null);
  assert.equal(pictureUrlOf(a, { kind: 'item', icon: '/assets/i/x.png', avatar: 'av' }), '/assets/i/x.png');
  assert.equal(pictureUrlOf(null, { kind: 'op', avatar: 'av' }), null);
});

test('warmInfo: 图片与骨骼都被预热，且 Spine 的 acquire 与 release 成对（不泄漏引用）', async () => {
  const a = fakeAssets();
  warmInfo(a, { kind: 'op', side: 'ally', avatar: 'av', defId: 'def', spine: 'sp' });
  assert.deepEqual(a.calls.image, ['/assets/a/av.png'], '图片按 avatar 取');
  assert.deepEqual(a.calls.acquire, ['/assets/s/sp.skel'], '骨骼按 spine 取');
  await Promise.resolve();
  await Promise.resolve();
  assert.deepEqual(a.calls.release, ['/assets/s/sp.skel'], 'acquire 之后必须 release');
});

test('warmInfo: 已经在缓存里的骨骼不再动引用计数（peek 命中就返回）', () => {
  const a = fakeAssets();
  a.spine.peek = () => { a.calls.peek++; return { loaded: true }; };
  warmInfo(a, { kind: 'op', side: 'ally', avatar: 'av', spine: 'sp' });
  assert.equal(a.calls.acquire.length, 0, '不重复 acquire');
  assert.equal(a.calls.peek, 1);
});

test('warmInfo: 低画质跳过敌方模型，但首领与友方照旧', () => {
  const a = fakeAssets();
  warmInfo(a, { kind: 'enemy', side: 'enemy', spine: 'e1' }, { lowQualityEnemy: true });
  assert.equal(a.calls.acquire.length, 0, '低画质敌方不预热骨骼');
  assert.equal(a.calls.image.length, 1, '但图片照旧');
  const b = fakeAssets();
  warmInfo(b, { kind: 'enemy', side: 'enemy', spine: 'boss1', boss: true }, { lowQualityEnemy: true });
  assert.equal(b.calls.acquire.length, 1, '首领不跳过');
  const c = fakeAssets();
  warmInfo(c, { kind: 'op', side: 'ally', spine: 'op1' }, { lowQualityEnemy: true });
  assert.equal(c.calls.acquire.length, 1, '友方不跳过');
});

test('warmInfo: 缺件 / 异常一律不抛（预加载失败绝不能影响任何一帧）', () => {
  assert.doesNotThrow(() => warmInfo(null, { avatar: 'a' }));
  assert.doesNotThrow(() => warmInfo({}, { avatar: 'a' }));
  assert.doesNotThrow(() => warmInfo({ picture: () => { throw new Error('boom'); } }, { avatar: 'a' }));
  assert.doesNotThrow(() => warmInfo(fakeAssets(), { kind: 'op', spine: 'nospine' }));
  const a = fakeAssets();
  a.spine.acquire = () => Promise.reject(new Error('下载失败'));
  assert.doesNotThrow(() => warmInfo(a, { kind: 'op', avatar: 'av', spine: 'sp' }));
  assert.doesNotThrow(() => warmInfos(fakeAssets(), null));
  assert.doesNotThrow(() => warmInfos(fakeAssets(), [{ kind: 'op', avatar: 'a' }]));
});
