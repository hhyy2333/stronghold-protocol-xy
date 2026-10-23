// 素材兜底跳转（server/http/assetJump.js）：本机缺的 /assets|fonts 文件 302 到镜像。
//
// 这一层最容易出的错不是「302 到哪」，而是两条边界：**没配置时一个字节都不该变**（普通安装与开发机的常态），
// 以及**不能变成开放重定向**（源表只来自配置，路径逐段校验，请求里的 sp_source 只能是已配置的 id）。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { createStaticHandler } from '../server/index.js';
import {
  createAssetJump, parseMirrors, parseSources, splittable, validPath, allowedExt, stripSourceParam,
} from '../server/http/assetJump.js';

const quiet = { info() {}, warn() {}, error() {}, debug() {} };
/** A jump with two mirrors, no timers, no probe, and a fetch that answers "present" everywhere unless told otherwise. */
function jumpWith({ fetchImpl, env = {}, sources, opts = {} } = {}) {
  return createAssetJump({
    sources: sources || [{ id: 'a', base: 'https://a.example' }, { id: 'b', base: 'https://b.example' }],
    env, log: quiet, fetchImpl: fetchImpl || (async () => ({ ok: true, status: 200 })),
    healthIntervalMs: 0, probeIntervalMs: 0, probePaths: ['/assets/char/avatar/char_003_kalts.png'],
    ...opts,
  });
}
const tick = () => new Promise((r) => setTimeout(r, 10));

test('parseMirrors: order, ids, junk and duplicates', () => {
  assert.equal(parseMirrors(''), null);
  assert.equal(parseMirrors('not a url'), null);
  const m = parseMirrors('https://a.example/, b=https://b.example/cdn/, https://a.example');
  assert.deepEqual(m.order, ['cdn1', 'b']);
  assert.equal(m.byId.get('cdn1'), 'https://a.example');
  assert.equal(m.byId.get('b'), 'https://b.example/cdn');
  // credentials / non-http never make it into the table
  assert.equal(parseMirrors('ftp://x.example'), null);
  assert.equal(parseMirrors('https://user:pw@x.example'), null);
});

test('parseSources: exceptions and prefixRules only accept configured ids', () => {
  const cfg = parseSources({
    sources: [{ id: 'a', base: 'https://a.example' }, { id: 'evil', base: 'javascript:alert(1)' }],
    order: ['a', 'evil'],
    exceptions: { '/assets/x.png': 'a', '/assets/y.png': 'evil', '/assets/z.png': 'https://evil.example' },
    prefixRules: [{ prefix: '/assets/voice/', skip: ['a', 'evil'] }],
  });
  assert.deepEqual(cfg.order, ['a']);
  assert.deepEqual([...cfg.exceptions.keys()], ['/assets/x.png']);   // 'evil' was not a usable source
  assert.deepEqual([...cfg.prefixRules[0].skip], ["a"]);             // only configured ids survive
  assert.throws(() => parseSources({ sources: [] }), /no usable source/);
});

test('path gates: only /assets|fonts + static extensions, never traversal', () => {
  assert.equal(splittable('/assets/x.png'), true);
  assert.equal(splittable('/fonts/fonts.css'), true);
  assert.equal(splittable('/data/x.png'), false);
  assert.equal(validPath('/assets/char/x.png'), true);
  assert.equal(validPath('/assets/../secret.png'), false);
  assert.equal(validPath('/assets/a/./x.png'), false);
  assert.equal(validPath('/assets//x.png'), false);
  assert.equal(validPath('/assets/x.png.'), false);
  assert.equal(allowedExt('/assets/x.png'), true);
  assert.equal(allowedExt('/assets/spine/x/x.skel'), true);
  assert.equal(allowedExt('/assets/x.js'), false);          // code stays local
  assert.equal(allowedExt('/assets/x.json'), false);        // manifests stay local
  assert.equal(allowedExt('/assets/local/scene.json'), true);
  assert.equal(allowedExt('/fonts/fonts.css'), true);
  assert.equal(stripSourceParam('v=1&sp_source=a&x=2'), 'v=1&x=2');
});

test('off by default: no configuration means no jump layer at all', () => {
  assert.equal(createAssetJump({ env: {}, log: quiet }), null);
  assert.equal(createAssetJump({ env: { SP_ASSET_CDN: 'https://a.example' }, log: quiet, disabled: true }), null);
  assert.equal(createAssetJump({ sources: [{ id: 'a', base: 'https://a.example' }], env: { SP_ASSET_JUMP: '0' }, log: quiet }), null);
});

test('jump: 302 to the first source, query forwarded except sp_source', async () => {
  const jump = jumpWith();
  try {
    const out = await jump('/assets/char/x.png', 'v=abc&x=1');
    assert.equal(out.status, 302);
    assert.equal(out.headers.Location, 'https://a.example/assets/char/x.png?v=abc&x=1');
    assert.equal(out.headers['X-SP-Asset-Source'], 'a');
    assert.equal(out.headers['X-SP-Asset-Jump'], '1');
    // not our paths / extensions: null = the caller's 404 stays the caller's 404
    assert.equal(await jump('/data/x.png'), null);
    assert.equal(await jump('/assets/x.js'), null);
    assert.equal(await jump('/assets/../x.png'), null);
    // HEAD is answered the same way (no body is written by static.js)
    assert.equal((await jump('/assets/char/x.png', '', 'HEAD')).status, 302);
  } finally { jump.stop(); }
});

test('jump: sp_source names a configured source only; an unknown name falls back to the order', async () => {
  const jump = jumpWith();
  try {
    assert.equal((await jump('/assets/x.png', 'sp_source=b')).headers.Location, 'https://b.example/assets/x.png');
    assert.equal((await jump('/assets/x.png', 'sp_source=https://evil.example')).headers.Location, 'https://a.example/assets/x.png');
  } finally { jump.stop(); }
});

test('health: a source answering 5xx is skipped, and a recovered one comes back after the TTL', async () => {
  const down = new Set(['a.example']);
  const fetchImpl = async (url) => ({ ok: !down.has(new URL(url).host), status: down.has(new URL(url).host) ? 500 : 200 });
  const jump = jumpWith({ fetchImpl, opts: { healthTtlMs: 60_000 } });
  try {
    await jump.checkHealth();
    assert.equal((await jump('/assets/x.png')).headers.Location, 'https://b.example/assets/x.png');
    assert.equal(jump.health().byHealth >= 0, true);
    down.clear();
    await jump.checkHealth();
    assert.equal((await jump('/assets/x.png')).headers.Location, 'https://a.example/assets/x.png');
  } finally { jump.stop(); }
});

test('health: strikes delay the downgrade (one flaky probe does not move the players)', async () => {
  let aCalls = 0;
  const fetchImpl = async (url) => {
    const host = new URL(url).host;
    if (host === 'a.example') aCalls += 1;
    return { ok: host === 'a.example' ? aCalls > 1 : true, status: host === 'a.example' && aCalls > 1 ? 500 : 200 };
  };
  const jump = jumpWith({ fetchImpl, opts: { healthStrikes: 2 } });
  try {
    await jump.checkHealth();
    assert.equal((await jump('/assets/x.png')).headers.Location, 'https://a.example/assets/x.png');
    await jump.checkHealth();
    assert.equal((await jump('/assets/x.png')).headers.Location, 'https://a.example/assets/x.png');   // 1 strike: still tried
    await jump.checkHealth();
    assert.equal((await jump('/assets/x.png')).headers.Location, 'https://b.example/assets/x.png');   // 2 strikes: skipped
  } finally { jump.stop(); }
});

test('existence: a 404 learned for one mirror makes the next request use the other one', async () => {
  const fetchImpl = async (url, init) => {
    const u = new URL(url);
    if (init?.method === 'HEAD' && u.host === 'a.example' && u.pathname.endsWith('/x.png')) return { ok: false, status: 404 };
    return { ok: true, status: 200 };
  };
  const jump = jumpWith({ fetchImpl });
  try {
    assert.equal((await jump('/assets/x.png')).headers.Location, 'https://a.example/assets/x.png');
    await tick();                                   // the miss is learned in the background
    assert.equal((await jump('/assets/x.png')).headers.Location, 'https://b.example/assets/x.png');
    assert.deepEqual(jump.exists(), { size: 1, known: 1 });
    assert.equal(jump.missing()[0].path, '/assets/x.png');
    assert.deepEqual(jump.missing()[0].sources, ['a']);
  } finally { jump.stop(); }
});

test('fallbacks: Link rel=alternate and X-SP-Fallbacks name the other mirrors', async () => {
  const jump = jumpWith();
  try {
    const out = await jump('/assets/x.png', 'v=1');
    assert.equal(out.headers.Link, '<https://b.example/assets/x.png?v=1>; rel="alternate"');
    assert.equal(out.headers['X-SP-Fallbacks'], 'https://b.example/assets/x.png?v=1');
  } finally { jump.stop(); }
});

test('status(): what the operator needs to see is all there', async () => {
  const jump = jumpWith();
  try {
    await jump('/assets/x.png');
    const s = jump.status();
    assert.equal(s.enabled, true);
    assert.deepEqual(s.order, ['a', 'b']);
    assert.equal(s.sources.length, 2);
    assert.equal(s.jumps, 1);
    assert.equal(typeof s.health.byHealth, 'number');
    assert.equal(Array.isArray(s.probe.missing), true);
    assert.equal(s.missingTotal, 0);
  } finally { jump.stop(); }
});

// ---- static handler integration: the local file always wins, a miss is the only thing that jumps ---------------
function serve(options) {
  const handler = createStaticHandler(options);
  const srv = http.createServer((req, res) => {
    const [p, q] = req.url.split('?');
    handler(req, res, p, q || '');
  });
  return new Promise((resolve) => srv.listen(0, '127.0.0.1', () => resolve(srv)));
}
function get(srv, url, method = 'GET') {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port: srv.address().port, path: url, method }, (res) => {
      let body = '';
      res.setEncoding('utf8');
      res.on('data', (d) => { body += d; });
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body }));
    });
    req.on('error', reject);
    req.end();
  });
}

test('static handler: a missing asset 302s, a present one is served locally, everything else still 404s', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sp-jump-'));
  const publicDir = path.join(root, 'public');
  const dataDir = path.join(root, 'data');
  const sharedDir = path.join(root, 'shared');
  fs.mkdirSync(path.join(publicDir, 'assets'), { recursive: true });
  fs.writeFileSync(path.join(publicDir, 'assets', 'local.png'), 'LOCAL');
  fs.mkdirSync(dataDir, { recursive: true });
  fs.mkdirSync(sharedDir, { recursive: true });
  const jump = jumpWith();
  const srv = await serve({ publicDir, dataDir, sharedDir, assetJump: jump });
  try {
    // present → the bytes come from this machine, never from the mirror
    const local = await get(srv, '/assets/local.png');
    assert.equal(local.status, 200);
    assert.equal(local.headers.location, undefined);
    // missing → 302 to the mirror
    const missing = await get(srv, '/assets/not-here.png');
    assert.equal(missing.status, 302);
    assert.equal(missing.headers.location, 'https://a.example/assets/not-here.png');
    // a non-asset path is not the jump layer's business
    assert.equal((await get(srv, '/data/not-here.json')).status, 404);
    // a non-jumpable extension keeps its 404 even under /assets
    assert.equal((await get(srv, '/assets/not-here.js')).status, 404);
  } finally {
    srv.close();
    jump.stop();
    fs.rmSync(root, { recursive: true, force: true });
  }
});
