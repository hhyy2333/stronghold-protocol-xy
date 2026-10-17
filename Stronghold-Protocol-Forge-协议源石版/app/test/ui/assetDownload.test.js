// test/ui/assetDownload.test.js — 标题页「预载素材」（public/js/assetDownload.js）与浏览器缓存的关系：
// 已经下载过的素材（上一次预载、上一局玩过的）不该再请求一遍，进度条也不该每次从 0 开始。
// 判断手段是 fetch(url, { cache: 'only-if-cached' })：只查 HTTP 缓存，不发请求。
import test from 'node:test';
import assert from 'node:assert/strict';
import { createAssetDownload, isAudioUrl } from '../../public/js/assetDownload.js';

const MANIFEST = {
  chars: {
    a: { avatar: '/assets/img/a.png', portrait: '/assets/img/b.png' },
    b: { avatar: '/assets/img/c.png' },
  },
  voice: { a: { cn: '/assets/audio/voice/a/cn.mp3' } },
};
const VISUAL = ['/assets/img/a.png', '/assets/img/b.png', '/assets/img/c.png'];

/** 一个会记账的假服务器 + 浏览器 HTTP 缓存。only-if-cached 只查缓存，普通请求才会走「网络」。 */
function fakeBrowser({ cached = [] } = {}) {
  const httpCache = new Set(cached);
  const requests = [];
  const probes = [];
  const logs = { network: [], unsupportedProbe: false };
  const json = (body) => new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } });
  const bytes = (url) => new TextEncoder().encode('bytes:' + url);
  const fetch = async (url, opts = {}) => {
    const path = new URL(url, 'http://localhost').pathname;
    if (!/^\/(?:assets|media)\//.test(url)) {
      if (path === '/data/assets.json') return json(MANIFEST);
      return new Response('', { status: 404 });
    }
    if (opts.cache === 'only-if-cached') {
      probes.push(url);
      if (logs.unsupportedProbe) throw new TypeError('unsupported cache mode');
      if (httpCache.has(url)) return new Response(bytes(url), { status: 200, headers: { 'Content-Type': 'image/png' } });
      throw new TypeError('Failed to fetch');
    }
    requests.push(url);
    logs.network.push(url);
    httpCache.add(url);
    return new Response(bytes(url), { status: 200, headers: { 'Content-Type': 'image/png' } });
  };
  return { fetch, httpCache, requests, probes, logs };
}

const download = (browser, extra = {}) => createAssetDownload({ fetch: browser.fetch, concurrency: 4, lookupImported: () => new Set(), ...extra });

test('isAudioUrl: /media/ 前缀（mediaUrl 改写过的语音）与音频扩展名都算语音', () => {
  assert.equal(isAudioUrl('/media/~0123456789abcdef/voice/a'), true);
  assert.equal(isAudioUrl('/assets/audio/voice/a.mp3'), true);
  assert.equal(isAudioUrl('/assets/img/a.png'), false);
});

test('缓存为空：三个画面素材都走网络，进度从 0 走到 3', async () => {
  const browser = fakeBrowser();
  const d = download(browser);
  await d.start('visual');
  const s = d.get();
  assert.equal(s.phase, 'complete');
  assert.equal(s.total, 3, '画面档不含语音');
  assert.equal(s.done, 3);
  assert.equal(s.reused, 0, '一个都没命中缓存');
  assert.deepEqual([...browser.requests].sort(), VISUAL);
});

test('全都下载过：一个都不再请求，进度立刻就满', async () => {
  const browser = fakeBrowser({ cached: VISUAL });
  const d = download(browser);
  await d.start('visual');
  const s = d.get();
  assert.equal(s.phase, 'complete');
  assert.equal(s.done, 3);
  assert.equal(s.reused, 3, '三个都来自浏览器 HTTP 缓存');
  assert.deepEqual(browser.requests, [], '命中缓存就不再发请求');
  assert.equal(s.bytes, 0);
});

test('只缓存了一部分：只补缺的那几个', async () => {
  const browser = fakeBrowser({ cached: ['/assets/img/b.png'] });
  const d = download(browser);
  await d.start('visual');
  const s = d.get();
  assert.equal(s.phase, 'complete');
  assert.equal(s.done, 3);
  assert.equal(s.reused, 1);
  assert.deepEqual([...browser.requests].sort(), ['/assets/img/a.png', '/assets/img/c.png']);
});

test('浏览器不支持 only-if-cached：当作未命中，照旧全部下载', async () => {
  const browser = fakeBrowser();
  browser.logs.unsupportedProbe = true;
  const d = download(browser);
  await d.start('visual');
  const s = d.get();
  assert.equal(s.phase, 'complete');
  assert.equal(s.done, 3, '不会因为探测失败而漏文件');
  assert.deepEqual([...browser.requests].sort(), VISUAL);
});

test('本地导入过的素材直接算就绪，也不请求', async () => {
  const browser = fakeBrowser();
  const imported = new Set(['/assets/img/a.png']);
  const d = download(browser, { lookupImported: () => imported });
  await d.start('visual');
  const s = d.get();
  assert.equal(s.phase, 'complete');
  assert.equal(s.done, 3);
  assert.equal(s.reused, 1, '导入的那个不下载');
  assert.equal(s.cached, 1);
  assert.deepEqual([...browser.requests].sort(), ['/assets/img/b.png', '/assets/img/c.png']);
});

test('含语音档把 /media/ 语音也算进来，缓存命中的同样跳过', async () => {
  const browser = fakeBrowser({ cached: ['/media/voice/a/cn'] });
  const d = download(browser);
  await d.start('all');
  const s = d.get();
  assert.equal(s.total, 4);
  assert.equal(s.done, 4);
  assert.equal(s.reused, 1);
  assert.deepEqual([...browser.requests].sort(), VISUAL);
});
