#!/usr/bin/env node
// tools/custom-assets.mjs — 自制干员（作坊包里的那一个）的素材清单条目。
//
// 背景：`workshop/yana-addition/` 里的娅娜（char_9002_yana）是**自制**干员 —— 官方表里没有她，
// tools/fetch-assets.mjs 也就永远下载不到她的立绘/战斗模型。没有清单条目时客户端会回落成
// 「稀有度菱形里的头像」（public/js/render/textures.js）：能打，但不是干员的样子。
//
// 她的素材是**两层**的（与 repo 那棵树同一套设计）：
//   * 别名：头像/立绘/spine 指向一个**已随包发出**的官方干员（char_113_cqbw），清单里复制它的 `chars` 条目；
//   * 自制：public/assets/local/char/char_9002_yana/ 下真正是她自己的头像与立绘 —— 清单里写成 `*Local`
//     **元数据**（`{ group, name }`），真实 URL 落在 data/local-assets.json。
//
// 为什么 URL 不能直接写进 data/assets.json：那是**提交进仓库**的文件，塞一条 /assets/local/… 就等于把
// 某台机器的路径写死进去（tools/setup.mjs 会去下载它、tools/doctor.mjs 会报缺失、tools/package.mjs 会拒绝打包）。
// 所以 `chars[id]` 里只放 `*Local` 元数据，URL 的通道是 git-ignored 的 data/local-assets.json。
//
// 数据来自另一棵树（Stronghold-Protocol-repo）：她的自制素材与清单条目在那里是「正本」。
//
// 用法：  node tools/custom-assets.mjs [--from <repo 路径>] [--dry-run] [--check]
//   --dry-run  只打印将要写入的条目
//   --check     缺条目时退出 1（CI 用）
import { readFileSync, writeFileSync, renameSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const MANIFEST = join(ROOT, 'data', 'assets.json');
const LOCAL_MANIFEST = join(ROOT, 'data', 'local-assets.json');
/** 自制干员的 id 与它的别名源（官方、已随包发出）。 */
const CUSTOM = Object.freeze({ charId: 'char_9002_yana', aliasOf: 'char_113_cqbw', skillIcons: ['skchr_yana_1', 'skchr_yana_2', 'skchr_yana_3'] });
const LOCAL_GROUP = 'char/char_9002_yana';

const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run');
const check = args.includes('--check');
const fromIdx = args.indexOf('--from');
const FROM = fromIdx >= 0 ? args[fromIdx + 1] : join(ROOT, '..', '..', 'Stronghold-Protocol-repo');

const readJson = (p) => JSON.parse(readFileSync(p, 'utf8'));
const writeJson = (p, v) => { const tmp = p + '.tmp'; writeFileSync(tmp, JSON.stringify(v)); renameSync(tmp, p); };
/** 与 tools/assets/manifest.mjs contentHash 同一算法。 */
const contentHash = (v) => createHash('sha1').update(JSON.stringify(v)).digest('hex').slice(0, 12);
/** 与 repo 的工具同一套统计形状；本树 stats 多出来的键（voiceLangs 等）由调用方保留。 */
function countStats(m, bytes, files) {
  const vals = (o) => Object.values(o || {});
  const spines = new Set();
  for (const c of vals(m.chars)) for (const s of vals(c.spine || {})) spines.add(s.skel);
  for (const e of vals(m.enemies)) if (e.spine) spines.add(e.spine.skel);
  for (const t of vals(m.tokens)) if (t.spine) spines.add(t.spine.skel);
  return {
    files, bytes,
    chars: Object.keys(m.chars || {}).length,
    charsWithBack: vals(m.chars).filter((c) => c.spine?.back).length,
    enemies: Object.keys(m.enemies || {}).length,
    enemiesWithSpine: vals(m.enemies).filter((e) => e.spine).length,
    tokens: Object.keys(m.tokens || {}).length,
    tokensWithSpine: vals(m.tokens).filter((t) => t.spine).length,
    spineModels: spines.size,
    bonds: Object.keys(m.bonds || {}).length,
    items: Object.keys(m.items || {}).length,
    bands: Object.keys(m.bands || {}).length,
    skills: Object.keys(m.skills || {}).length,
    modules: Object.keys(m.modules || {}).length,
    ui: Object.keys(m.ui || {}).length,
    sfxUnits: Object.keys(m.audio?.sfx?.units || {}).length,
    voiceChars: Object.keys(m.audio?.voice || {}).length,
  };
}

if (!existsSync(join(FROM, 'data', 'assets.json'))) {
  console.error(`找不到正本: ${FROM}/data/assets.json\n用 --from <repo 路径> 指定 Stronghold-Protocol-repo 的位置。`);
  process.exit(2);
}
const src = readJson(join(FROM, 'data', 'assets.json'));
const srcLocal = readJson(join(FROM, 'data', 'local-assets.json'));
const alias = src.chars[CUSTOM.aliasOf];
const custom = src.chars[CUSTOM.charId];
const group = srcLocal.groups[LOCAL_GROUP];
if (!alias || !custom || !group) { console.error('正本里缺 ' + (!alias ? '别名源 ' : '') + (!custom ? '她的 chars 条目 ' : '') + (!group ? '她的 local group' : '')); process.exit(2); }

const manifest = readJson(MANIFEST);
const local = readJson(LOCAL_MANIFEST);
const added = { chars: [], skills: [], localGroup: false };
manifest.chars = manifest.chars || {};
manifest.skills = manifest.skills || {};
manifest.skillsById = manifest.skillsById || {};
local.groups = local.groups || {};
if (!manifest.chars[CUSTOM.charId]) { manifest.chars[CUSTOM.charId] = JSON.parse(JSON.stringify(custom)); added.chars.push(CUSTOM.charId); }
for (const iconId of CUSTOM.skillIcons) {
  if (!manifest.skills[iconId] && src.skills[iconId]) { manifest.skills[iconId] = src.skills[iconId]; added.skills.push(iconId); manifest.skillsById[iconId] = iconId; }
}
if (!local.groups[LOCAL_GROUP]) { local.groups[LOCAL_GROUP] = JSON.parse(JSON.stringify(group)); added.localGroup = true; }

if (check) {
  const ok = added.chars.length === 0 && added.skills.length === 0 && !added.localGroup;
  console.log(ok ? '  清单已包含 ' + CUSTOM.charId : '  清单缺条目: ' + JSON.stringify(added));
  process.exit(ok ? 0 : 1);
}
if (dryRun) { console.log(JSON.stringify(added, null, 1)); process.exit(0); }
if (!added.chars.length && !added.skills.length && !added.localGroup) { console.log('  已经写过了，无需改动'); process.exit(0); }

// `hash` 的算法与 tools/fetch-assets.mjs 逐字一致：body = 清单去掉 hash / stats / version / generator。
const { hash: _h, stats: _s, version: _v, generator: _g, ...body } = manifest;
manifest.hash = contentHash(body);
manifest.stats = { ...manifest.stats, ...countStats(manifest, manifest.stats?.bytes ?? 0, manifest.stats?.files ?? 0) };
local.count = Object.values(local.groups).reduce((n, g) => n + Object.keys(g).length, 0);
writeJson(MANIFEST, manifest);
writeJson(LOCAL_MANIFEST, local);
console.log('  写入完成: ' + JSON.stringify(added) + '  hash=' + manifest.hash + '  stats.chars=' + manifest.stats.chars + '  local.count=' + local.count);
