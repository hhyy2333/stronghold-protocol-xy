#!/usr/bin/env node
// tools/asset-aliases.mjs — 策略头像别名：手写策略之间共用一张图（管理员2 / 管理员3 用管理员的头像）。
//
// 背景：`tools/build-data.mjs CUSTOM_BANDS` 的三条手写策略在官方素材索引里都没有条目。管理员自己那张图是随包发出的
// `public/assets/band/band_admin.png`（`tools/assets/plan.mjs HAND_BAND_ICONS`，叶子没有 URL，`fetch-assets` 按磁盘上
// 的文件发布）。业主 2026-10-31「把管理员2，3策略图像加上，用管理员策略的图像」：管理员2 / 管理员3 不再需要自己的文件，
// 直接指到同一张 —— 也就是清单里 `bands.band_admin2` / `bands.band_admin3` 与 `bands.band_admin` 同一个 URL。
//
// 为什么单独一个工具、而不是直接跑 `node tools/fetch-assets.mjs`：那个命令会**整份重建** `data/assets.json`，而这台机器
// 上没有解包出来的自制素材（娅娜的 spineLocal 等 600 多个条目会被判为丢失，它于是保留旧清单、拒绝写入）。这个工具只做
// 「把别名条目补进现有清单」这一件事：不动别的键、不动别的文件，幂等，并且按 `fetch-assets` 同一套 `contentHash` /
// `stats` 记账（`hash` = 去掉 version / hash / generator / stats 的 body，与 tools/assets/manifest.mjs 逐字一致）。
//
// 别名表只有一处：`tools/assets/plan.mjs HAND_BAND_ICON_ALIASES`。计划侧改过了，一次完整的 `fetch-assets` 重建也会写出
// 同样的条目 —— 这个工具只是让当前清单不必等那次重建。
//
// 用法：  node tools/asset-aliases.mjs [--dry-run] [--check]
//   --dry-run  只打印将要写入的条目
//   --check    缺条目时退出 1（CI / 打包前用）
import { readFileSync, writeFileSync, renameSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { HAND_BAND_ICON_ALIASES } from './assets/plan.mjs';
import { contentHash } from './assets/manifest.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const MANIFEST = join(ROOT, 'data', 'assets.json');

const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run');
const check = args.includes('--check');

const readJson = (p) => JSON.parse(readFileSync(p, 'utf8'));
const writeJson = (p, v) => { const tmp = p + '.tmp'; writeFileSync(tmp, JSON.stringify(v)); renameSync(tmp, p); };

const manifest = readJson(MANIFEST);
const bands = manifest.bands || {};
/** 每个别名要写成的值：目标策略自己的 URL。目标不在清单里 ⇒ 那份素材根本没发出去，直接说清楚而不是写 null。 */
const wanted = [];
const missingTargets = [];
for (const [bandId, of] of Object.entries(HAND_BAND_ICON_ALIASES)) {
  const url = bands[of];
  if (!url) { missingTargets.push(`${bandId} → ${of}`); continue; }
  if (bands[bandId] === url) continue;
  wanted.push([bandId, url]);
}

if (missingTargets.length) {
  console.error(`  清单里没有别名目标的头像: ${missingTargets.join(', ')}\n  先跑 node tools/fetch-assets.mjs（或确认 public/assets/band/<目标>.png 在盘上）。`);
  process.exit(2);
}
if (check) {
  console.log(wanted.length ? `  清单缺别名条目: ${wanted.map(([id]) => id).join(', ')}` : `  清单已包含 ${Object.keys(HAND_BAND_ICON_ALIASES).join(', ')}`);
  process.exit(wanted.length ? 1 : 0);
}
if (dryRun) { console.log(JSON.stringify(Object.fromEntries(wanted), null, 1)); process.exit(0); }
if (!wanted.length) { console.log('  已经写过了，无需改动'); process.exit(0); }

// 追加在 bands 末尾：`tools/assets/plan.mjs` 也是「官方 40 + HAND_BAND_ICONS + 别名」这个顺序，所以一次完整重建给出的
// 键顺序与这里相同（`hash` 是 JSON 序列化的哈希，顺序也算在内）。
for (const [bandId, url] of wanted) bands[bandId] = url;
manifest.bands = bands;
// 与 tools/fetch-assets.mjs 同一个 body：去掉描述构建本身的四个字段。
const { version: _v, hash: _h, generator: _g, stats: _s, ...body } = manifest;
manifest.hash = contentHash(body);
manifest.stats = { ...manifest.stats, bands: Object.keys(bands).length };
writeJson(MANIFEST, manifest);
console.log(`  写入完成: ${wanted.map(([id, url]) => `${id}=${url}`).join(', ')}  hash=${manifest.hash}  stats.bands=${manifest.stats.bands}`);
