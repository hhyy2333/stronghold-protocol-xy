#!/usr/bin/env node
// tools/custom-op-art.mjs — 结城理 / 丰川祥子（tools/custom-ops.mjs 的两个固定干员）的素材清单条目。
//
// 为什么需要它：这两名干员的立绘与战斗模型**只在本机**（从《明日方舟》客户端解出来的那一份，落在
// public/assets/local/char/<charId>/ 下）。data/assets.json 是提交进仓库的清单，public/assets 是 git-ignored，
// 所以清单里只写 *Local **元数据**（{group, name}），真实 URL 走 data/local-assets.json（同样 git-ignored）——
// 与娅娜（tools/custom-assets.mjs）同一套通道，见 docs/CUSTOM-ART.md。
//
// 本工具做三件事（幂等）：
//   1. 把 public/assets/local/char/<charId>/ 下的文件登记成 data/local-assets.json 的 char/<charId> 组；
//   2. 在 data/assets.json 的 chars[<charId>] 里写 spineLocal / avatarLocal / portraitLocal 等元数据；
//   3. 把技能图标从工作坊包复制进 public/assets/skill/，并在清单的 skills / skillsById 里登记。
//
// 用法： node tools/custom-op-art.mjs [--check] [--dry-run]
import { readFileSync, writeFileSync, renameSync, existsSync, readdirSync, statSync, mkdirSync, copyFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseSkel } from './assets/skel.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const MANIFEST = join(ROOT, 'data', 'assets.json');
const LOCAL_MANIFEST = join(ROOT, 'data', 'local-assets.json');
const ART_ROOT = join(ROOT, 'public', 'assets', 'local', 'char');
const SKILL_DIR = join(ROOT, 'public', 'assets', 'skill');
const PACKS = [join(ROOT, 'workshop', 'makoto-yuki', 'assets'), join(ROOT, 'workshop', 'ave-mujica', 'assets')];

/**
 * 两名干员的素材声明。`anims` 抄自工作坊包里同一具 skeleton 的声明（包作者对着 skeleton 的 clip 名校过）：
 * 结城理的替身动画是 Doll_Skill_1/2/3 三套，丰川祥子的技能动画是 Skill_1/2/3。
 */
const OPS = Object.freeze({
  char_4217_makoto: Object.freeze({
    skills: ['skchr_makoto_1', 'skchr_makoto_2', 'skchr_makoto_3'],
    anims: {
      idle: 'Idle', deploy: 'Start',
      attack: { begin: null, loop: 'Attack_A', end: null },
      attackDown: null,
      skill: { begin: null, loop: 'Doll_Skill_2_Loop', end: null, index: 0, idle: null },
      die: null, move: null, stun: 'Stun',
      skills: {
        0: { begin: null, loop: 'Doll_Skill_1_Idle', end: null, index: 0, idle: null },
        1: { begin: null, loop: 'Doll_Skill_2_Loop', end: null, index: 1, idle: null },
        2: { begin: null, loop: 'Doll_Skill_3_P1_Idle', end: null, index: 2, idle: null },
      },
    },
  }),
  char_4182_oblvns: Object.freeze({
    skills: ['skchr_oblvns_1', 'skchr_oblvns_2', 'skchr_oblvns_3'],
    // 工作坊包里的图标名是 am_oblivionis_1/2/3，与官方技能号的对应关系取自包的 kits/chess_char_6_30_a.js：
    // S1 新月的苏醒 = am_oblivionis_1，S2 满月的舞会 = am_oblivionis_3，S3 残月的余响 = am_oblivionis_2
    iconOf: { skchr_oblvns_1: 'skchr_am_oblivionis_1', skchr_oblvns_2: 'skchr_am_oblivionis_3', skchr_oblvns_3: 'skchr_am_oblivionis_2' },
    anims: {
      idle: 'Idle', deploy: 'Start',
      attack: { begin: null, loop: 'Attack', end: null },
      attackDown: null,
      skill: { begin: null, loop: 'Skill_1', end: null, index: 0, idle: null },
      die: 'Die', move: null, stun: null,
      skills: {
        0: { begin: null, loop: 'Skill_1', end: null, index: 0, idle: null },
        1: { begin: 'Skill_2_Start', loop: 'Skill_2_Idle_A', end: null, index: 1, idle: null },
        2: { begin: 'Skill_3_Begin', loop: 'Skill_3_Loop', end: 'Skill_3_End', index: 2, idle: 'Skill_3_Idle' },
      },
    },
  }),
});

const args = process.argv.slice(2);
const check = args.includes('--check');
const dryRun = args.includes('--dry-run');

const readJson = (p) => JSON.parse(readFileSync(p, 'utf8'));
const writeJson = (p, v) => { const tmp = p + '.tmp'; writeFileSync(tmp, JSON.stringify(v)); renameSync(tmp, p); };
const contentHash = (v) => createHash('sha1').update(JSON.stringify(v)).digest('hex').slice(0, 12);

/** PNG 的宽高（IHDR 就在文件头）。 */
function pngSize(file) {
  const b = readFileSync(file);
  if (b.length < 24 || b.toString('ascii', 1, 4) !== 'PNG') return null;
  return { w: b.readUInt32BE(16), h: b.readUInt32BE(20) };
}

/** 一个 charId 的本地素材组（data/local-assets.json 的 groups['char/<charId>']）。 */
function groupOf(charId) {
  const dir = join(ART_ROOT, charId);
  const group = {};
  const add = (rel, kind) => {
    const abs = join(dir, rel);
    if (!existsSync(abs)) return;
    const url = `/assets/local/char/${charId}/${rel.replace(/\\/g, '/')}`;
    const entry = { path: url, kind };
    if (kind === 'Sprite') {
      const s = pngSize(abs);
      if (s) { entry.w = s.w; entry.h = s.h; }
    }
    group[rel.replace(/\\/g, '/')] = entry;
  };
  for (const f of ['avatar.png', 'avatar_2.png', 'portrait_1.png', 'portrait_2.png']) add(f, 'Sprite');
  for (const side of ['front', 'back']) {
    const d = join(dir, 'spine', side);
    if (!existsSync(d)) continue;
    for (const f of readdirSync(d).sort()) add(`spine/${side}/${f}`, f.endsWith('.png') ? 'Sprite' : 'TextAsset');
  }
  return group;
}

/** spineLocal 的一侧：group + 文件名 + 解析出来的 anims / animations / events / hits / bounds。 */
function spineSide(charId, side, anims) {
  const dir = join(ART_ROOT, charId, 'spine', side);
  if (!existsSync(dir)) return null;
  const files = readdirSync(dir);
  const skel = files.find((f) => f.endsWith('.skel'));
  const atlas = files.find((f) => f.endsWith('.atlas'));
  if (!skel || !atlas) return null;
  const parsed = parseSkel(readFileSync(join(dir, skel)));
  const textures = files.filter((f) => f.endsWith('.png')).sort();
  return {
    group: `char/${charId}`,
    skel: `spine/${side}/${skel}`,
    atlas: `spine/${side}/${atlas}`,
    textures: textures.map((f) => `spine/${side}/${f}`),
    pma: false,
    anims,
    animations: parsed.durations,
    events: parsed.events,
    hits: parsed.hits,
    ...(parsed.bounds ? { bounds: parsed.bounds } : null),
  };
}

const manifest = readJson(MANIFEST);
const local = readJson(LOCAL_MANIFEST);
manifest.chars = manifest.chars || {};
manifest.skills = manifest.skills || {};
manifest.skillsById = manifest.skillsById || {};
local.groups = local.groups || {};
const added = { chars: [], skills: [], groups: [], copiedIcons: [] };

mkdirSync(SKILL_DIR, { recursive: true });
for (const [charId, spec] of Object.entries(OPS)) {
  const groupKey = `char/${charId}`;
  const group = groupOf(charId);
  if (!Object.keys(group).length) { console.warn(`  ${charId}: no local art under public/assets/local/char/${charId} — skipped`); continue; }
  if (JSON.stringify(local.groups[groupKey]) !== JSON.stringify(group)) {
    local.groups[groupKey] = group;
    added.groups.push(groupKey);
  }
  const front = spineSide(charId, 'front', spec.anims);
  const back = spineSide(charId, 'back', spec.anims);
  const entry = {
    ...(front ? { spine: { front: { skel: '', atlas: '', textures: [] } } } : null), // placeholder, replaced below
  };
  delete entry.spine;
  const rec = manifest.chars[charId] || {};
  rec.avatarLocal = { group: groupKey, name: 'avatar.png' };
  rec.avatarE2Local = { group: groupKey, name: 'avatar_2.png' };
  rec.portraitLocal = { group: groupKey, name: 'portrait_1.png' };
  rec.portraitE2Local = { group: groupKey, name: 'portrait_2.png' };
  rec.spineLocal = { ...(front ? { front } : null), ...(back ? { back } : null) };
  if (!rec.spine) {
    // 别名：清单里必须有一个**能发出去的** spine 兜底（本机没有 local 清单时退回官方干员的模型）。
    // 这里指向同分支的官方干员（傀儡师 风丸 / 领主 银灰），只是兜底，正常走 spineLocal。
    const alias = charId === 'char_4217_makoto' ? 'char_4016_kazema' : 'char_172_svrash';
    const a = manifest.chars[alias];
    if (a && a.spine) rec.spine = JSON.parse(JSON.stringify(a.spine));
  }
  if (JSON.stringify(manifest.chars[charId]) !== JSON.stringify(rec)) { manifest.chars[charId] = rec; added.chars.push(charId); }
  // 技能图标：工作坊包 assets/skill/<id>.png → public/assets/skill/<id>.png
  for (const iconId of spec.skills) {
    const file = (spec.iconOf && spec.iconOf[iconId]) || iconId;
    const src = PACKS.map((p) => join(p, 'skill', `${file}.png`)).find((p) => existsSync(p));
    if (!src) { console.warn(`  ${iconId}: no icon in the workshop packs`); continue; }
    const dst = join(SKILL_DIR, `${iconId}.png`);
    if (!existsSync(dst) || statSync(dst).size !== statSync(src).size) { copyFileSync(src, dst); added.copiedIcons.push(iconId); }
    const url = `/assets/skill/${iconId}.png`;
    if (manifest.skills[iconId] !== url) { manifest.skills[iconId] = url; added.skills.push(iconId); }
    if (manifest.skillsById[iconId] !== iconId) manifest.skillsById[iconId] = iconId;
  }
}

const changed = added.chars.length || added.skills.length || added.groups.length;
if (check) {
  console.log(changed ? `  missing: ${JSON.stringify(added)}` : '  manifest is up to date');
  process.exit(changed ? 1 : 0);
}
if (dryRun) { console.log(JSON.stringify(added, null, 1)); process.exit(0); }
if (!changed) { console.log('  nothing to do'); process.exit(0); }

// 统计与 hash（与 tools/fetch-assets.mjs 同一算法：去掉 hash / stats / version / generator 后序列化）
const { hash: _h, stats: _s, version: _v, generator: _g, ...body } = manifest;
manifest.hash = contentHash(body);
const vals = (o) => Object.values(o || {});
const spines = new Set();
for (const c of vals(manifest.chars)) for (const s of vals(c.spine || {})) if (s && s.skel) spines.add(s.skel);
manifest.stats = {
  ...manifest.stats,
  chars: Object.keys(manifest.chars).length,
  charsWithBack: vals(manifest.chars).filter((c) => c.spine?.back).length,
  skills: Object.keys(manifest.skills).length,
};
local.count = Object.values(local.groups).reduce((n, g) => n + Object.keys(g).length, 0);
writeJson(MANIFEST, manifest);
writeJson(LOCAL_MANIFEST, local);
console.log(`  wrote ${JSON.stringify(added)}  hash=${manifest.hash}  stats.chars=${manifest.stats.chars}  local.count=${local.count}`);
