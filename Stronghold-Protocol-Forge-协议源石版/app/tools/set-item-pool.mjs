#!/usr/bin/env node
// tools/set-item-pool.mjs — 把 data/config.json 的**装备库存上限**同步成 tools/build-data.mjs 里那一档。
//
// 背景（业主 2026-10-16「解除装备数量限制」）：官方的 `economy.itemPoolCopies`（按阶级的份数）与
// `itemPoolCopiesOverrides`（逐件微调）是**全队共享的装备库存** —— 商店买一件（不够就 SOLD_OUT）、机变发一件、
// 商店装备格的抽取，全都按它算「还剩几份」。业主要的是**解除这个限制**：想买多少买多少、机变想发多少发多少。
//
// 真源在 tools/build-data.mjs（`itemPoolCopies: null` / `itemPoolCopiesOverrides: null`）。
// 那支工具要联网抓官方表，本机跑不了，所以这里做**最小同步**：只动 config.json 里那两个字段，
// 其余字节逐字不动（config.json 没有 hash/version 之类的头部字段，不需要重算摘要）。
//
// `null` 正是代码里「不限」的写法：gamedata.js `itemPoolCopies` 对 null 返回 null，
// `SharedItemPool.left()` 拿到 null 的 cap 返回 `Infinity`，于是 `canGain` 恒真 —— 商店不再售罄、机变不再缺卡。
//
// 用法：  node tools/set-item-pool.mjs [--restore] [--dry-run]
//   --restore   改回官方的份数表与逐件微调（下面 OFFICIAL_* 两份常量）
//   --dry-run   只打印将要写入的值
import { readFileSync, writeFileSync, renameSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const CONFIG = join(ROOT, 'data', 'config.json');

/** 官方的份数表（tools/build-data.mjs 原来的那两行，留一份以便 --restore）。 */
const OFFICIAL_COPIES = Object.freeze({ 1: 4, 2: 6, 3: 7, 4: 8, 5: 7, 6: 3 });
const OFFICIAL_OVERRIDES = Object.freeze({
  chess_item_2_06_e_a: 5, chess_item_4_02_e_a: 6, chess_item_4_05_e_a: 6, chess_item_4_10_e_a: 6,
  chess_item_4_01_e_a: 7, chess_item_4_04_e_a: 7, chess_item_4_08_e_a: 7, chess_item_5_07_e_a: 2,
});

const args = process.argv.slice(2);
const restore = args.includes('--restore');
const dryRun = args.includes('--dry-run');

const doc = JSON.parse(readFileSync(CONFIG, 'utf8'));
if (!doc.economy || typeof doc.economy !== 'object') { console.error('config.json 里没有 economy 段'); process.exit(2); }
const next = restore ? { ...OFFICIAL_COPIES } : null;
const nextOverrides = restore ? { ...OFFICIAL_OVERRIDES } : null;
const before = JSON.stringify({ copies: doc.economy.itemPoolCopies ?? null, overrides: doc.economy.itemPoolCopiesOverrides ?? null });
const after = JSON.stringify({ copies: next, overrides: nextOverrides });
if (dryRun) { console.log(`  现在是 ${before}`); console.log(`  将写入 ${after}`); process.exit(0); }
if (before === after) { console.log('  已经是这个值，无需改动'); process.exit(0); }
doc.economy.itemPoolCopies = next;
doc.economy.itemPoolCopiesOverrides = nextOverrides;
const tmp = CONFIG + '.tmp';
writeFileSync(tmp, JSON.stringify(doc));
renameSync(tmp, CONFIG);
console.log(`  装备库存上限：${restore ? '已恢复官方份数表' : '已解除（null = 不限）'}`);
console.log(`    itemPoolCopies=${JSON.stringify(next)}`);
console.log(`    itemPoolCopiesOverrides=${JSON.stringify(nextOverrides)}`);
