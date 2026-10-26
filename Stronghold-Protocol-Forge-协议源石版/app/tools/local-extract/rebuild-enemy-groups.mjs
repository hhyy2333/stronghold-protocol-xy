#!/usr/bin/env node
// tools/local-extract/rebuild-enemy-groups.mjs — 从 public/assets/local/spine/enemy/ 的模型重建
// data/local-assets.json 里 `spine/enemy/<id>` 那一批 group 条目。
//
// 为什么需要它：`data/local-assets.json` 是**本机状态**（git-ignored），由 extract.py 写出；客户端给
// `spineLocal` 拼 URL 的方式是「拿 group + 文件名去这个清单里查」（public/js/assets.js localSpineEntry →
// localAssetUrl）。清单里少了某个 group，客户端就只能回落到 web spine —— 而这批敌人**只有**本机客户端模型，
// 于是敌人照常刷出来、画面上却是空的。2026-10-24 业主报「新的怪刷新了还是看不见」就是它：第二批量 6 个敌方
// 模型是用一次性脚本抽的，脚本把自己的清单当整份写回，把第一批 21 个 `spine/enemy/*` group 一起换掉了
// （数据 data/assets.json 里的 spineLocal 引用还在，所以两边对不上）。
//
// 它按 extract.py write_spine() 的同一种条目形状重建：
//   .skel / .atlas  → { path: '/assets/local/<group>/<file>', kind: 'TextAsset' }
//   .png            → { path, w, h, kind: 'Texture2D' }（宽高读 PNG 的 IHDR）
// 只动 `spine/enemy/*` 这些 group，别的（表情、立绘、棋盘、召唤物…）原样保留；`count` 跟着重算（setup 自己
// 从 groups 数，这个字段只是给人看的）。
//
// 用法：node tools/local-extract/rebuild-enemy-groups.mjs [--check]
//   --check  不写文件，只在有 group 缺失/不一致时退出 1（CI 与发布前的守卫）
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const MFST = path.join(ROOT, 'data', 'local-assets.json');
const DIR_ROOT = path.join(ROOT, 'public', 'assets', 'local', 'spine', 'enemy');
const SUB = 'spine/enemy';

/** PNG 宽高（IHDR）。 */
function pngSize(file) {
  const b = fs.readFileSync(file);
  if (b.length < 24 || b.toString('latin1', 1, 4) !== 'PNG') return null;
  return { w: b.readUInt32BE(16), h: b.readUInt32BE(20) };
}

/** 期望的 group → 条目表（从磁盘上那 29 个模型目录读）。 */
export function enemyGroups(dirRoot = DIR_ROOT) {
  if (!fs.existsSync(dirRoot)) return {};
  const out = {};
  const ids = fs.readdirSync(dirRoot, { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => e.name).sort();
  for (const id of ids) {
    const sub = `${SUB}/${id}`;
    const dir = path.join(dirRoot, id);
    const files = fs.readdirSync(dir).filter((f) => /\.(skel|atlas|png)$/i.test(f)).sort();
    const has = (ext) => files.some((f) => f.toLowerCase().endsWith(ext));
    if (!has('.skel') || !has('.atlas') || !has('.png')) {
      throw new Error(`${sub}: incomplete model (need .skel + .atlas + .png), has ${JSON.stringify(files)}`);
    }
    const grp = {};
    for (const f of files) {
      const p = `/assets/local/${sub}/${f}`;
      if (/\.png$/i.test(f)) {
        const size = pngSize(path.join(dir, f));
        if (!size) throw new Error(`${sub}/${f}: not a PNG`);
        grp[f] = { path: p, w: size.w, h: size.h, kind: 'Texture2D' };
      } else {
        grp[f] = { path: p, kind: 'TextAsset' };
      }
    }
    out[sub] = grp;
  }
  return out;
}

/** 缺失或条目不一致的 group（用于 --check 与测试）。 */
export function enemyGroupGaps(manifest, dirRoot) {
  const groups = (manifest && manifest.groups) || {};
  const want = enemyGroups(dirRoot);
  const gaps = [];
  for (const [g, entries] of Object.entries(want)) {
    const have = groups[g];
    if (!have) { gaps.push(`${g}: missing`); continue; }
    const miss = Object.keys(entries).filter((n) => !have[n]);
    if (miss.length) gaps.push(`${g}: ${miss.join(', ')} not listed`);
  }
  return gaps;
}

export function main(argv = process.argv.slice(2), log = console) {
  const check = argv.includes('--check');
  if (!fs.existsSync(MFST)) {
    log.log('[local-assets] no data/local-assets.json on this machine (no local-client art) — nothing to do');
    return 0;
  }
  const manifest = JSON.parse(fs.readFileSync(MFST, 'utf8'));
  const want = enemyGroups();
  const before = Object.values(manifest.groups || {}).reduce((n, g) => n + Object.keys(g || {}).length, 0);
  const gaps = enemyGroupGaps(manifest, DIR_ROOT);
  if (check) {
    if (gaps.length) {
      for (const g of gaps) log.error(`[local-assets] ${g}`);
      log.error('[local-assets] run: node tools/local-extract/rebuild-enemy-groups.mjs');
      return 1;
    }
    log.log(`[local-assets] ${Object.keys(want).length} enemy groups, all listed (${before} entries)`);
    return 0;
  }
  manifest.groups = manifest.groups || {};
  // 只加不删是不够的：敌人被撤下时（2026-10-26 撤下畸变体傀儡 enemy_1130_infstr）磁盘上的模型目录没了，
  // 但清单里那条 `spine/enemy/<id>` group 会留着，指向三个已经不存在的文件。它不会让游戏报错（客户端只在
  // 有 spineLocal 引用时才查 group，而 data/assets.json 里那条引用也一起删了），但它是一份「指向空处」的
  // 状态：rebuild 的语义是「让 spine/enemy 这批 group 与磁盘一致」，所以这里也要**删掉**已经没有目录的条目。
  const dropped = [];
  for (const g of Object.keys(manifest.groups)) {
    if (!g.startsWith(`${SUB}/`)) continue;
    if (!Object.hasOwn(want, g)) { delete manifest.groups[g]; dropped.push(g.slice(SUB.length + 1)); }
  }
  for (const [g, entries] of Object.entries(want)) manifest.groups[g] = entries;
  manifest.count = Object.values(manifest.groups).reduce((n, g) => n + Object.keys(g || {}).length, 0);
  fs.writeFileSync(MFST, `${JSON.stringify(manifest, null, 1)}\n`, 'utf8');
  log.log(`[local-assets] rebuilt ${Object.keys(want).length} enemy groups — ${before} → ${manifest.count} entries` +
    (dropped.length ? ` (dropped ${dropped.length} with no model dir: ${dropped.join(', ')})` : ''));
  return 0;
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url))) {
  process.exit(main());
}
