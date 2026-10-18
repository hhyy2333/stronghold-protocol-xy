// test/admin-panel-network.test.js — 后台面板的「网络」显示（owner 2026-10-18）。
//
// 面板是静态页 + 只读 JSON API：overview 现在带 `network`（累计量 + 距上次刷新的速率），页面加两张卡。
// 这里钉住「服务端真的接线」「两张卡的 id 与中英文字符串都在」——单纯删掉一段渲染，页面只会静悄悄回到旧样子。
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => readFileSync(path.join(ROOT, p), 'utf8');
const HTML = read('public/admin/index.html');
const UI = read('public/admin/admin.js');
const SERVER = read('server/admin.js');
const INDEX = read('server/index.js');

test('the admin overview builds the network block from the traffic counter', () => {
  assert.match(INDEX, /const traffic = createTrafficCounter\(\);/);
  assert.match(INDEX, /new AdminService\(\{[\s\S]*?traffic,/, 'the counter reaches the admin service');
  assert.ok(SERVER.includes('networkOverview()'), 'the method exists');
  assert.match(SERVER, /network: this\.networkOverview\(\)/, 'getOverview publishes it');
});

test('the panel renders two network cards (label, value, sub) in zh AND en', () => {
  for (const key of ['statNetWs', 'statNetHttp']) {
    assert.match(HTML, new RegExp(`data-t="${key}"`), `the ${key} label`);
  }
  for (const id of ['stat-net-ws', 'stat-net-ws-sub', 'stat-net-http', 'stat-net-http-sub']) {
    assert.ok(HTML.includes(`id="${id}"`), id);
  }
  const zh = UI.slice(UI.indexOf('  zh: {'), UI.indexOf('  en: {'));
  const en = UI.slice(UI.indexOf('  en: {'));
  for (const key of ['statNetWs', 'netWsSub', 'netWsSubNoRate', 'statNetHttp', 'netHttpSub']) {
    assert.ok(new RegExp(`^\\s*${key}:`, 'm').test(zh), `zh has ${key}`);
    assert.ok(new RegExp(`^\\s*${key}:`, 'm').test(en), `en has ${key}`);
  }
  assert.ok(UI.includes("setText('stat-net-ws'") && UI.includes("setText('stat-net-http'"), 'the renderer fills them');
});
