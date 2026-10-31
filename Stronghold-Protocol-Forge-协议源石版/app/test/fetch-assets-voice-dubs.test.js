// test/fetch-assets-voice-dubs.test.js — 重建清单时不要丢掉盘上已装的配音。
//
// 事故（0.19.x，data/assets.json 缺 audio.voiceLang / audio.voiceLangs）：中文 / 英文 / 韩文三档配音的文件一直在
// public/assets/audio/voice/{cn,en,kr}/ 里，但清单里没有它们的条目，玩家在 设置 → 配音语言 里选「中文」实际听到的
// 还是默认档（日文）—— 客户端读清单，不读磁盘。根因是 tools/assets/plan.mjs 只在 extraLangs 非空时才写
// voiceLang / voiceLangs，而 fetch-assets 的 --voice-langs 默认是空的：一次不带旗标的重建就静默丢了三档。
//
// 这里锁三件事（都只在 os.tmpdir() 里造目录，不碰真的 public/assets，CI 上没有素材也照跑）：
//   1. dubsOnDisk —— 什么样的目录才算「盘上已装的一档」；
//   2. mergeVoiceLangs —— 显式 --voice-langs ∪ 盘上已装的，去掉默认档（它已经是 audio.voice），去重排序；
//   3. downloadableLeaves —— 自动发现的档只「列出」不「下载」，否则重建清单会顺手把 ≈200 MB 配音全下下来。
// Run: node --test test/fetch-assets-voice-dubs.test.js

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { dubsOnDisk, mergeVoiceLangs, downloadableLeaves } from '../tools/fetch-assets.mjs';
import { VOICE_DIRS } from '../tools/assets/audio.mjs';

/**
 * 一个假的 public/assets/audio/voice/：`files` 是相对它的文件路径（会建出中间的 charId 目录），`dirs` 是只建空目录的
 * 名字（测「空目录不算装好」）。返回这个 voice 目录本身，正好是 dubsOnDisk() 的入参。
 * @param {{files?: string[], dirs?: string[]}} o
 * @returns {string}
 */
function fixture({ files = [], dirs = [] } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sp-voice-dubs-'));
  for (const f of files) {
    const abs = path.join(root, f);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, 'x');
  }
  for (const d of dirs) fs.mkdirSync(path.join(root, d), { recursive: true });
  return root;
}

test('dubsOnDisk: a VOICE_DIRS folder that holds a real file is an installed dub; an empty or foreign folder is not', () => {
  const root = fixture({
    files: ['cn/char_003_kalts/cn_019.mp3', 'jp/char_003_kalts/cn_019.mp3', 'en/char_003_kalts/cn_019.mp3'],
    // kr 空目录（没装完 / 只建了目录）、native 与 sfx 不是配音档、voice_custom 也不是 VOICE_DIRS 的名字
    dirs: ['kr', 'native/char_102_texas_ita', 'sfx', 'voice_custom'],
  });
  assert.deepEqual(dubsOnDisk(root), ['cn', 'en', 'jp'], '只认有文件的 VOICE_DIRS 目录，并且排好序');

  const partial = fixture({ files: ['kr/char_003_kalts/cn_019.mp3.part'] });
  assert.deepEqual(dubsOnDisk(partial), [], '只有 .part 的目录是没下完的下载，不是一档配音');

  const notADir = fixture({ files: ['en/char_003_kalts/cn_019.mp3'] });
  fs.writeFileSync(path.join(notADir, 'kr'), 'x');
  assert.deepEqual(dubsOnDisk(notADir), ['en'], '同名文件不是配音目录');

  assert.deepEqual(dubsOnDisk(path.join(root, 'does-not-exist')), [], '目录不存在：空表，不抛（CI 上没有 public/assets）');
  assert.deepEqual(dubsOnDisk(''), [], '空路径同样只是空表');

  // 真实布局的一档：audio/voice/cn/char_003_kalts/cn_019.mp3（文件名每档都一样，只换目录）
  const nested = fixture({ files: ['cn/char_003_kalts/cn_019.mp3', 'cn/char_003_kalts/cn_020.mp3', 'cn/char_102_texas/cn_001.mp3'] });
  assert.deepEqual(dubsOnDisk(nested), ['cn'], '一档里多少文件都算一档');
  assert.deepEqual(Object.keys(VOICE_DIRS).sort(), ['cn', 'en', 'jp', 'kr'], '判据就是 audio.mjs 的 VOICE_DIRS');
});

test('mergeVoiceLangs: explicit --voice-langs ∪ what is on disk, minus the default dub, de-duplicated and sorted', () => {
  assert.deepEqual(mergeVoiceLangs([], ['cn', 'en', 'kr'], 'jp'), ['cn', 'en', 'kr'],
    '不带 --voice-langs 也把盘上已装的三档写进清单（这次事故要修的那一条）');
  assert.deepEqual(mergeVoiceLangs(['cn'], ['cn', 'kr'], 'jp'), ['cn', 'kr'], '并集去重');
  assert.deepEqual(mergeVoiceLangs(['kr', 'cn'], [], 'jp'), ['cn', 'kr'], '显式点名的档即使盘上没有也照旧规划（要下载），并排序');
  assert.deepEqual(mergeVoiceLangs(['cn', 'cn'], ['cn'], 'jp'), ['cn'], '同一档在两处出现只算一次');
  assert.deepEqual(mergeVoiceLangs([], ['jp'], 'jp'), [], '默认档不进 voiceLangs：它就是 audio.voice，两棵树不能重叠');
  assert.deepEqual(mergeVoiceLangs(['en', 'cn'], [], 'cn'), ['en'], '默认档由 --voice-lang 决定，不是写死的 jp');
  assert.deepEqual(mergeVoiceLangs(['native', 'xx', 3, null], ['cn'], 'jp'), ['cn'], '不是 VOICE_DIRS 的名字一律丢掉');
  assert.deepEqual(mergeVoiceLangs(undefined, null, 'jp'), [], '参数缺省就是空表');
  assert.deepEqual(mergeVoiceLangs(['en', 'cn', 'kr', 'jp'], ['cn', 'jp'], 'jp'), ['cn', 'en', 'kr'], '四档齐全时的完整清单');
});

const leafAt = (p) => ({ path: p, leaf: { alts: [] } });

test('downloadableLeaves: an auto-discovered dub is listed but never downloaded; --voice-langs is what fetches one', () => {
  const leaves = [
    leafAt('chars.char_003_kalts.avatar'),
    leafAt('audio.voice.char_003_kalts.1'),
    leafAt('audio.voiceJp.char_003_kalts.1'),
    leafAt('audio.voiceLangs.cn.char_003_kalts.1'),
    leafAt('audio.voiceLangs.en.char_003_kalts.1'),
    leafAt('audio.voiceLangs.en.char_003_kalts.2'),
  ];
  const paths = (ls) => ls.map((l) => l.path);

  assert.deepEqual(paths(downloadableLeaves(leaves, [])), [
    'chars.char_003_kalts.avatar',
    'audio.voice.char_003_kalts.1',
    'audio.voiceJp.char_003_kalts.1',
  ], '不带旗标：盘上已装的档留在 plan 里（清单会有它），但不进下载列表');

  assert.deepEqual(paths(downloadableLeaves(leaves, ['en'])), [
    'chars.char_003_kalts.avatar',
    'audio.voice.char_003_kalts.1',
    'audio.voiceJp.char_003_kalts.1',
    'audio.voiceLangs.en.char_003_kalts.1',
    'audio.voiceLangs.en.char_003_kalts.2',
  ], '--voice-langs=en：只有 en 下载，cn（自动发现的那档）仍然只列出');

  assert.deepEqual(paths(downloadableLeaves(leaves, ['cn', 'en'])), paths(leaves), '两档都显式点名：全都下载');
  assert.equal(downloadableLeaves(leaves, []).length + 3, leaves.length, '滤掉的正好是 voiceLangs 的那三行');
  assert.equal(leaves.length, 6, 'filter 不改动入参：plan 本身仍然带着那些行（resolveTemplate 要用它们）');

  // 前缀必须精确：别的键（audio.voiceLangsX…）和表头本身不能被当成某一档
  const near = [leafAt('audio.voiceLangsX.cn.char_003_kalts.1'), leafAt('audio.voiceLangs'), leafAt('audio.voiceLangs.cn')];
  assert.deepEqual(paths(downloadableLeaves(near, [])), paths(near), '只按 audio.voiceLangs.<lang>. 这个前缀判定');
});
