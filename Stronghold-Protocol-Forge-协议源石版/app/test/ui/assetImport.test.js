// 导入素材包(标题界面)在“这个页面根本导入不了”时直接隐藏（业主 2026-10-18 「隐藏该按钮」）。
//
// 判据只有一份：assetCache.js 的 importSupport()（纯函数：安全上下文 + Service Worker + Cache Storage +
// SubtleCrypto）。页面是普通 http 时它报 insecure —— 那时按钮唯一能做的事（导入）已经被浏览器拒绝，再把按钮画成
// 置灰 + 「导入需要 HTTPS 或 localhost。」读起来像是功能坏了；现在直接不画，HTTPS/localhost 上照旧出现。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { importSupport } from '../../public/js/assetCache.js';
import { importButtonShown } from '../../public/js/ui/assetImport.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const nav = { serviceWorker: {} };

test('importSupport: insecure / unsupported / ok', () => {
  const saved = globalThis.caches;
  try {
    globalThis.caches = {};
    assert.deepEqual(importSupport(nav, false), { ok: false, reason: 'insecure' }, 'plain http');
    assert.deepEqual(importSupport({}, true), { ok: false, reason: 'unsupported' }, 'secure, but no Service Worker');
    assert.deepEqual(importSupport(nav, true), { ok: true }, 'HTTPS/localhost + the APIs');
    globalThis.caches = undefined;
    assert.deepEqual(importSupport(nav, true), { ok: false, reason: 'unsupported' }, 'no Cache Storage');
  } finally {
    globalThis.caches = saved;
  }
});

test('importButtonShown: exactly where an import can run', () => {
  assert.equal(importButtonShown({ ok: true }), true);
  assert.equal(importButtonShown({ ok: false, reason: 'insecure' }), false, 'http page: hidden');
  assert.equal(importButtonShown({ ok: false, reason: 'unsupported' }), false, 'old browser: hidden');
  assert.equal(importButtonShown(null), false);
  assert.equal(importButtonShown(undefined), false, 'default = the page\'s own verdict (http here)');
});

test('the component really returns null on that verdict (no disabled button, no hint)', () => {
  const src = readFileSync(path.join(ROOT, 'public/js/ui/assetImport.js'), 'utf8');
  assert.ok(src.includes('if (!importButtonShown(support)) return null;'), 'the guard is wired into AssetImportButton');
  assert.ok(!src.includes("t('导入需要 HTTPS 或 localhost。')"), 'the old disabled-button hint is gone');
  assert.ok(!src.includes('data-testid="asset-import-unavailable"'), 'the unreachable "cannot import" branch is gone');
});
