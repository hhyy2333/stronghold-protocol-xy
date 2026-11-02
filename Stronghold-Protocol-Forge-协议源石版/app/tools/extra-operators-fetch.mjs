#!/usr/bin/env node
// tools/extra-operators-fetch.mjs — 抓取「本地数据表还没有的官方干员」的官方行，写进 tools/extra-operators.json
//
// 为什么需要：协议源石版的三个自选干员（塔露拉 char_4247_oxi / 冻河 char_4244_tocka / 国度 char_4246_dminon）
// 来自《明日方舟》客户端 26-10-20-11-10-38-04170990（v79），而本树 .cache/gamedata 里的官方表停在
// char_4237_jcinta（比 v79 早）。整包升级 dump 会连带改掉所有干员/棋子/盟约的数据（golden 与一堆测试计数全变），
// 所以这里只把这三个干员的官方行单独取下来，由 tools/extra-operators.mjs 在 build-data 时注入（数据本身照官方原值走）。
//
// 用法（维护者；只在需要刷新这三个干员的数据时跑）：
//   node tools/extra-operators-fetch.mjs            # 默认取 Kengxxiao/ArknightsGameData master 的 zh_CN 表
//   node tools/extra-operators-fetch.mjs --rev <sha># 钉在某次提交上（可复现）
// 产物：tools/extra-operators.json（提交进仓库；build-data --offline 读它，不联网）
//
// 取什么：character_table 的三条角色行、skill_table 的九条技能行、range_table 里它们用到的范围行，
// 以及 uniequip_table.subProfDict 里它们的分支名（本地表已有则不必，缺了才补）。
// 不取：uniequip_table.charEquip / battle_equip_table —— 三人在 v79 没有模组（业主 2026-11-01 口径：不加模组）。
import { writeFile } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { downloadUrls } from './assets/sources.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(ROOT, 'tools', 'extra-operators.json');

const OPERATORS = ['char_4247_oxi', 'char_4244_tocka', 'char_4246_dminon'];

const args = process.argv.slice(2);
let rev = 'master';
let source = 'direct';
for (let i = 0; i < args.length; i++) {
  if (args[i] === '--rev') rev = args[++i];
  else if (args[i] === '--source') source = args[++i];
}
const BASE = `https://raw.githubusercontent.com/Kengxxiao/ArknightsGameData/${rev}/zh_CN/gamedata/excel/`;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
// Same download policy as tools/fetch-assets.mjs (tools/assets/sources.mjs): direct, then the opt-in GitHub proxy,
// then jsDelivr — raw.githubusercontent.com is unreachable from some networks.
const get = async (file, tries = 2) => {
  const urls = downloadUrls(BASE + file, { source });
  let last;
  for (let i = 1; i <= tries; i++) {
    for (const url of urls) {
      try {
        const res = await fetch(url, { headers: { 'user-agent': 'stronghold-protocol' } });
        if (!res.ok) throw new Error(`${file}: HTTP ${res.status} (${url})`);
        return await res.json();
      } catch (e) {
        last = e;
      }
    }
    if (i < tries) await sleep(1200 * i);
  }
  throw last;
};

const main = async () => {
  const [charTable, skillTable, rangeTable, uniequip] = await Promise.all([
    get('character_table.json'), get('skill_table.json'), get('range_table.json'), get('uniequip_table.json'),
  ]);

  const operators = {};
  const skills = {};
  const ranges = {};
  const subProfessions = {};
  const missing = [];

  const needRange = (id) => {
    if (!id || ranges[id]) return;
    const row = rangeTable[id];
    if (!row) { missing.push(`range ${id}`); return; }
    ranges[id] = row;
  };

  for (const id of OPERATORS) {
    const ch = charTable[id];
    if (!ch) { missing.push(`character ${id}`); continue; }
    operators[id] = ch;
    for (const ph of ch.phases || []) needRange(ph.rangeId);
    for (const s of ch.skills || []) {
      const sk = skillTable[s.skillId];
      if (!sk) { missing.push(`skill ${s.skillId}`); continue; }
      skills[s.skillId] = sk;
      for (const lv of sk.levels || []) needRange(lv.rangeId);
    }
    const sub = uniequip.subProfDict?.[ch.subProfessionId];
    if (sub) subProfessions[ch.subProfessionId] = sub;
  }

  if (missing.length) throw new Error(`upstream is missing: ${missing.join(', ')}`);

  const doc = {
    version: 1,
    note: '官方行，逐字节照抄；由 tools/extra-operators-fetch.mjs 抓取，tools/extra-operators.mjs 在 build-data 时注入。',
    source: `${BASE} (Kengxxiao/ArknightsGameData ${rev}, zh_CN)`,
    fetchedAt: new Date().toISOString().slice(0, 10),
    operators,
    skills,
    ranges,
    subProfessions,
  };
  await writeFile(OUT, `${JSON.stringify(doc)}\n`);
  const sizes = Object.fromEntries(Object.entries({ operators, skills, ranges, subProfessions }).map(([k, v]) => [k, Object.keys(v).length]));
  console.log(`wrote ${OUT}: ${JSON.stringify(sizes)}, ${(JSON.stringify(doc).length / 1024).toFixed(0)} KB`);
};

await main();
