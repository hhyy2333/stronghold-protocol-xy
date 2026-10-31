// test/shared/highGround-i18n.test.js — the two rules that read a Chinese *line* of a record, and the language the
// interface is in (upstream 0.3.1 GitHub #676 + #700, docs 04-文档/上游0.3.3对比/B-0.3.1.md §2.1 / §2.2).
//
// The client judges the records the game-text overlay has translated (public/js/data.js setLocale): the 高台 rule matches
// 「可以放置于远程位」 (shared/highGround.js) and the attack-range preview matches 「被动效果：攻击范围扩大」 /
// 「攻击范围扩大」 / 「集成战略」 (shared/loadoutRecord.js). None of the three survives translation — en says "Can be
// deployed on Ranged Tiles", "Attack Range expands", "In Integrated Strategies" — so in en / ja / ko / zh-TW (which writes
// 於) 歌蕾蒂娅 / 崖心 / 见行者 could not take a 高台 (the server, reading the Chinese data, accepted it: the client drew no
// legal tile and the server took the move — the two disagreed), 精锐莱恩哈特's preview lost a tile (10 → 9), 引星棘刺 S3
// stopped widening it and 空弦 ISW-A's 集成战略 module started adding one.
//
// The fix keeps the data files untouched (app/AGENTS.md: data/*.json are generated): the localized copy carries the
// Chinese record's reading as a boolean — placeOnRanged / passiveRange / rangeExpand / modeOnly — and both modules take
// the boolean first and the Simplified line as the fallback. Chinese never builds a localized copy, so it is unchanged
// down to the byte; this file pins that a language cannot change the answer (上/下 two languages, same verdict), and that
// the readings are the ones upstream 0.3.1 stores in its own data (21 records × 27 booleans — the acceptance baseline
// from 04-文档/上游0.3.3对比/A-数据差异.md §3).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { applyFileOverlay } from '../../shared/i18nData.js';
import { meleeOnHighGround, withPlaceOnRanged } from '../../shared/highGround.js';
import { attackRangeGrid, loadoutRecord, resolveRecordLoadout, traitRangeExtend, withRangeFlags } from '../../shared/loadoutRecord.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const ZH = JSON.parse(readFileSync(path.join(ROOT, 'data', 'chess.json'), 'utf8'));
const EN_OVERLAY = JSON.parse(readFileSync(path.join(ROOT, 'data', 'i18n', 'en.json'), 'utf8')).files.chess;

/** The English chess table as the store builds it today: texts only, no readings (what the interface used to judge). */
const EN_PLAIN = applyFileOverlay(ZH, EN_OVERLAY).value;
/** The English chess table as public/js/data.js hands it out since the fix: the Chinese readings cached on the records. */
const EN = (() => {
  const out = {};
  for (const [id, rec] of Object.entries(EN_PLAIN)) out[id] = withRangeFlags(withPlaceOnRanged(rec, ZH[id]), ZH[id]);
  return out;
})();

const cells = (grid) => (grid || []).map(([r, c]) => r + ',' + c).sort();
const rawCells = (rec) => cells(rec && rec.rangeGrid);
/** A record as the loadout makes it (skillIndex / moduleId), for the record of either language. */
const at = (rec, lo = null) => loadoutRecord(rec, resolveRecordLoadout(rec, lo));

const GLAD = ['chess_char_4_12_a', 'chess_char_4_12_b'];   // 歌蕾蒂娅, normal and elite
const CLIFF = ['chess_char_2_03_a', 'chess_char_2_03_b'];  // 崖心
const FORCER = ['chess_char_3_07_a', 'chess_char_3_07_b']; // 见行者
const HOLDERS = [...GLAD, ...CLIFF, ...FORCER];

// ---- 高台 placement (GitHub #676) -----------------------------------------------------------------------------------

test('高台: the six 钩索师 / 推击手 records take a 高台 in Chinese, and in English once the reading is cached', () => {
  for (const id of HOLDERS) {
    assert.equal(meleeOnHighGround(ZH[id]), true, id + ': Chinese');
    assert.equal(meleeOnHighGround(EN[id]), true, id + ': English');
    assert.equal(EN[id].placeOnRanged, true, id + ': the boolean');
    assert.equal(ZH[id].placeOnRanged, undefined, id + ': the Chinese data file keeps no such field');
  }
});

test('高台: the defect — with nothing but the translated texts, 歌蕾蒂娅 / 崖心 / 见行者 are ground-only in English', () => {
  // the record's own trait line, in English, no longer holds the Simplified one
  for (const id of HOLDERS) {
    assert.ok(!String(EN_PLAIN[id].trait?.desc || '').includes('可以放置于远程位'), id + ': the English trait');
    if (EN_PLAIN[id].placeOnRanged !== true) assert.equal(meleeOnHighGround(EN_PLAIN[id]), false, id + ': the old answer');
  }
});

test('高台: every chess of the data answers the same in Chinese and in English', () => {
  const ids = Object.keys(ZH);
  assert.ok(ids.length > 200, 'the data has chess (' + ids.length + ')');
  for (const id of ids) assert.equal(meleeOnHighGround(EN[id]), meleeOnHighGround(ZH[id]), id);
  // and the flag is the only difference: no record gains a 高台 it did not have
  assert.deepEqual(Object.values(EN).filter((c) => meleeOnHighGround(c)).map((c) => c.chessId).sort(), HOLDERS.slice().sort());
});

// ---- attack range preview (GitHub #700) -----------------------------------------------------------------------------

test('范围预览: 引星棘刺 S3 「被动效果：攻击范围扩大」 keeps its grid in English (13 tiles → 19)', () => {
  for (const id of ['chess_char_5_15_a', 'chess_char_5_15_b']) {
    const zh = at(ZH[id], { skillIndex: 2 });
    const en = at(EN[id], { skillIndex: 2 });
    assert.equal(zh.skill.index, 2, id + ': S3');
    assert.equal(cells(zh.skill.rangeGrid).length, 19, id + ': her own 3-9 grid');
    assert.deepEqual(cells(en.skill.rangeGrid), cells(zh.skill.rangeGrid), id + ': the same grid either way');
    assert.equal(en.skill.passiveRange, true, id + ': the reading');
    assert.deepEqual(cells(attackRangeGrid(en)), cells(attackRangeGrid(zh)), id + ': the preview');
    assert.equal(cells(attackRangeGrid(zh)).length, 19, id + ': the skill range, not the base 13');
    // the defect: the translated text alone leaves the operator on her own range
    assert.deepEqual(cells(attackRangeGrid(at(EN_PLAIN[id], { skillIndex: 2 }))), rawCells(ZH[id]), id + ': without the reading');
  }
});

test('范围预览: 精锐莱恩哈特 SPC-X 「攻击范围扩大」 keeps its 10 tiles in English', () => {
  const id = 'chess_char_4_14_b';
  assert.equal(ZH[id].module.id, 'uniequip_002_lionhd', 'the default module is SPC-X');
  assert.equal(cells(attackRangeGrid(ZH[id])).length, 10, 'the 3×3 caster range + the centre tile');
  assert.deepEqual(cells(attackRangeGrid(EN[id])), cells(attackRangeGrid(ZH[id])));
  assert.equal(EN[id].trait.rangeExpand, true, 'the reading');
  assert.notDeepEqual(cells(attackRangeGrid(EN[id])), cells(EN[id].rangeGrid), 'the module’s widened grid, not the base 9');
  // the defect: 10 → 9 in English
  assert.equal(cells(attackRangeGrid(EN_PLAIN[id])).length, 9, 'without the reading');
});

test('范围预览: 空弦 ISW-A 「在集成战略中」 adds no 攻击距离 in English, and a module that is not 集成战略 still does', () => {
  const id = 'chess_char_3_21_b';
  const ISW = 'uniequip_004_archet';
  assert.equal(traitRangeExtend(at(ZH[id], { moduleId: ISW })), 0, 'Chinese: 集成战略 only');
  assert.equal(traitRangeExtend(at(EN[id], { moduleId: ISW })), 0, 'English: the same');
  assert.deepEqual(cells(attackRangeGrid(at(EN[id], { moduleId: ISW }))), cells(attackRangeGrid(at(ZH[id], { moduleId: ISW }))));
  // the defect: the translated 「In Integrated Strategies」 no longer matches and the +1 is applied
  assert.equal(traitRangeExtend(at(EN_PLAIN[id], { moduleId: ISW })), 1, 'without the reading');
  assert.notDeepEqual(cells(attackRangeGrid(at(EN_PLAIN[id], { moduleId: ISW }))), cells(attackRangeGrid(at(ZH[id], { moduleId: ISW }))));
  // the positive case: 信仰搅拌机 SPT-Y 「攻击距离+1」 is not 集成战略, so it applies in both languages
  const RM = 'chess_char_4_01_b';
  const SPT = 'uniequip_003_rmixer';
  for (const table of [ZH, EN]) assert.equal(traitRangeExtend(at(table[RM], { moduleId: SPT })), 1, 'SPT-Y +1');
  assert.deepEqual(cells(attackRangeGrid(at(EN[RM], { moduleId: SPT }))), cells(attackRangeGrid(at(ZH[RM], { moduleId: SPT }))));
});

test('范围预览: every chess and every loadout (skills, modules) previews the same range in Chinese and in English', () => {
  let checked = 0;
  for (const [id, zh] of Object.entries(ZH)) {
    const en = EN[id];
    const skills = [null, ...(Array.isArray(zh.skills) ? zh.skills.map((s) => s.index) : [])];
    const mods = [null, ...(Array.isArray(zh.modules) ? zh.modules.map((m) => m.uniEquipId) : [])];
    for (const skillIndex of skills) for (const moduleId of mods) {
      const lo = { ...(skillIndex != null ? { skillIndex } : {}), ...(moduleId ? { moduleId } : {}) };
      const a = at(zh, lo), b = at(en, lo);
      assert.deepEqual(cells(attackRangeGrid(b)), cells(attackRangeGrid(a)), id + ' S' + skillIndex + ' ' + (moduleId || 'default'));
      assert.equal(traitRangeExtend(b), traitRangeExtend(a), id + ' S' + skillIndex + ' ' + (moduleId || 'default') + ': 攻击距离');
      checked++;
    }
  }
  assert.ok(checked > 1000, 'loadouts checked (' + checked + ')');
});

// ---- the readings themselves (upstream 0.3.1's data is the baseline) -----------------------------------------------

/**
 * The booleans upstream 0.3.1 stores in its own data/chess.json — the 21 chess × 27 booleans the port is measured
 * against (04-文档/上游0.3.3对比/A-数据差异.md §3, "上游 21 个棋实体 ×27 个新布尔"). A fork operator that legitimately
 * gains one (a module reading 攻击范围扩大 / 集成战略) belongs in this table.
 */
const UPSTREAM_READINGS = {
  chess_char_2_03_a: ['placeOnRanged'],
  chess_char_2_03_b: ['placeOnRanged'],
  chess_char_3_04_b: ['module:uniequip_004_swire2:modeOnly'],
  chess_char_3_07_a: ['placeOnRanged'],
  chess_char_3_07_b: ['placeOnRanged'],
  chess_char_3_21_b: ['module:uniequip_004_archet:modeOnly'],
  chess_char_4_02_b: ['module:uniequip_003_mostma:rangeExpand'],
  chess_char_4_08_b: ['module:uniequip_002_rosesa:rangeExpand', 'trait:rangeExpand'],
  chess_char_4_09_b: ['module:uniequip_004_mizuki:modeOnly'],
  chess_char_4_12_a: ['placeOnRanged'],
  chess_char_4_12_b: ['placeOnRanged'],
  chess_char_4_13_b: ['module:uniequip_004_gnosis:modeOnly'],
  chess_char_4_14_b: ['module:uniequip_002_lionhd:rangeExpand', 'trait:rangeExpand'],
  chess_char_4_21_b: ['module:uniequip_002_plosis:rangeExpand', 'trait:rangeExpand'],
  chess_char_5_12_b: ['module:uniequip_002_dusk:rangeExpand', 'module:uniequip_004_dusk:modeOnly', 'trait:rangeExpand'],
  chess_char_5_13_b: ['module:uniequip_004_ghost2:modeOnly'],
  chess_char_5_15_a: ['skills[2]:passiveRange'],
  chess_char_5_15_b: ['skills[2]:passiveRange'],
  chess_char_5_16_b: ['module:uniequip_002_plosis:rangeExpand', 'trait:rangeExpand'],
  chess_char_5_20_b: ['module:uniequip_004_aglina:modeOnly'],
  chess_char_6_12_b: ['module:uniequip_003_rosmon:modeOnly'],
};

/** The readings the derivation puts on one Chinese record, named as in UPSTREAM_READINGS. */
function readingsOf(rec) {
  const flagged = withRangeFlags(withPlaceOnRanged(rec, rec), rec);
  const out = [];
  if (flagged.placeOnRanged === true) out.push('placeOnRanged');
  if (flagged.trait?.rangeExpand === true) out.push('trait:rangeExpand');
  if (flagged.trait?.modeOnly === true) out.push('trait:modeOnly');
  for (const m of flagged.modules || []) {
    if (m.traitOverride?.rangeExpand === true) out.push('module:' + m.uniEquipId + ':rangeExpand');
    if (m.traitOverride?.modeOnly === true) out.push('module:' + m.uniEquipId + ':modeOnly');
  }
  if (flagged.skill?.passiveRange === true) out.push('skill:passiveRange');
  for (const s of flagged.skills || []) if (s.passiveRange === true) out.push('skills[' + s.index + ']:passiveRange');
  return out.sort();
}

test('the readings are upstream 0.3.1’s: 21 records × 27 booleans, no other chess', () => {
  const got = {};
  for (const [id, rec] of Object.entries(ZH)) {
    const r = readingsOf(rec);
    if (r.length) got[id] = r;
  }
  const want = Object.fromEntries(Object.entries(UPSTREAM_READINGS).map(([id, r]) => [id, r.slice().sort()]));
  assert.deepEqual(got, want);
  assert.equal(Object.values(got).reduce((n, r) => n + r.length, 0), 27, '27 booleans');
});

test('a reading is derived from the Chinese record only: a translated line is never matched, a false is not a reading', () => {
  // the whole table: every record of EN gets its readings from ZH, so an English copy of a Chinese trait text would not
  // change one. A hand-made English record without a Chinese twin keeps the text (a plugin's own chess).
  const plugin = { chessId: 'chess_plugin_1', position: 'MELEE', trait: { desc: 'Can be deployed on Ranged Tiles' } };
  assert.equal(meleeOnHighGround(plugin), false, 'a translation alone');
  assert.equal(meleeOnHighGround({ ...plugin, placeOnRanged: true }), true, '[ASSUMED] a plugin may set the boolean');
  assert.equal(meleeOnHighGround({ ...plugin, placeOnRanged: false }), false, 'false is not a reading');
  assert.equal(withPlaceOnRanged(plugin, null), plugin, 'no Chinese twin: unchanged');
  const skill = { index: 2, desc: 'Passive Effect: Attack Range increases', rangeGrid: [[0, 1]] };
  const rec = { rangeGrid: [[0, 0]], skill };
  assert.deepEqual(cells(attackRangeGrid(rec)), ['0,0'], 'a translated line is not the rule: the record keeps its own range');
  assert.deepEqual(cells(attackRangeGrid({ ...rec, skill: { ...skill, passiveRange: true } })), ['0,1'], '[ASSUMED] the boolean alone');
  assert.equal(traitRangeExtend({ trait: { moduleDesc: 'In Integrated Strategies', bb: { ability_range_forward_extend: 1 } } }), 1, 'a translated line adds the extend');
  assert.equal(traitRangeExtend({ trait: { moduleDesc: 'In Integrated Strategies', bb: { ability_range_forward_extend: 1 }, modeOnly: true } }), 0, '[ASSUMED] the boolean refuses it');
});

// ---- the store the interface reads (public/js/data.js) --------------------------------------------------------------

/** A store over the real files on disk: /data/<name>.json and /data/i18n/<lang>.json. */
function diskStore() {
  return import('../../public/js/data.js').then(({ createDataStore }) => createDataStore({
    retryDelays: [],
    fetch: async (url) => {
      const rel = String(url).replace(/^\/data\//, '');
      try {
        const body = readFileSync(path.join(ROOT, 'data', rel), 'utf8');
        return { ok: true, status: 200, json: async () => JSON.parse(body) };
      } catch {
        return { ok: false, status: 404, json: async () => ({}) };
      }
    },
  }));
}

test('public/js/data.js: the localized chess the interface reads answers as the Chinese one, and keeps the files clean', async () => {
  const store = await diskStore();
  await store.load('chess');
  assert.equal(store.status('chess'), 'ready');
  const zhHigh = store.lookup('chess', 'chess_char_4_12_a');
  assert.equal(meleeOnHighGround(zhHigh), true, 'Chinese');
  assert.equal(zhHigh.placeOnRanged, undefined, 'Chinese: no boolean, the text is read');
  assert.equal(store.locale(), 'zh');

  assert.equal(await store.setLocale('en'), 'en');
  assert.equal(store.locale(), 'en');
  for (const id of HOLDERS) assert.equal(meleeOnHighGround(store.lookup('chess', id)), true, id + ': English 高台');
  // the same answers as the Chinese table, record by record
  for (const id of Object.keys(ZH)) {
    assert.equal(meleeOnHighGround(store.lookup('chess', id)), meleeOnHighGround(ZH[id]), id);
  }
  assert.equal(cells(attackRangeGrid(store.lookup('chess', 'chess_char_4_14_b'))).length, 10, 'English preview: 10 tiles');
  const s3 = store.lookup('chess', 'chess_char_5_15_a');
  assert.equal(cells(attackRangeGrid(loadoutRecord(s3, resolveRecordLoadout(s3, { skillIndex: 2 })))).length, 19, 'English preview: her S3 range');
  // the downloaded file is not touched: the readings live on the localized copy only
  assert.equal(store.getRaw('chess').chess_char_4_12_a.placeOnRanged, undefined);
  assert.equal(store.getRaw('chess').chess_char_4_14_b.trait.rangeExpand, undefined);
  assert.equal(store.getRaw('chess').chess_char_5_15_a.skills[2].passiveRange, undefined);

  // back to Chinese: the record is the downloaded one again, judged on its text as before
  assert.equal(await store.setLocale('zh'), 'zh');
  const back = store.lookup('chess', 'chess_char_4_12_a');
  assert.equal(meleeOnHighGround(back), true, 'Chinese again');
  assert.equal(back.placeOnRanged, undefined, 'and still no boolean on it');
});

test('public/js/data.js: the 补位 forms of data/backups.json carry the readings too (自选 温蒂 is a 推击手)', async () => {
  const store = await diskStore();
  await store.load('backups');
  assert.equal(await store.setLocale('en'), 'en');
  const weedy = store.get('backups').units['char_400_weedy'];
  assert.equal(weedy.position, 'MELEE');
  const forms = Object.values(weedy.forms);
  assert.equal(forms.length, 3, 'the three 补位 forms of 温蒂');
  for (const f of forms) {
    assert.equal(f.placeOnRanged, true, 'the 高台 line, read off the Chinese form');
    assert.ok(f.placeOnRanged === true && !String(f.trait.desc).includes('可以放置于远程位'), 'the English trait');
  }
  // the file itself is clean, and Chinese keeps none of it
  assert.equal(store.getRaw('backups').units['char_400_weedy'].forms['2/1/4/0'].placeOnRanged, undefined);
  await store.setLocale('zh');
  assert.equal(store.get('backups').units['char_400_weedy'].forms['2/1/4/0'].placeOnRanged, undefined);
});

test('自选 温蒂 (a 补位 body): the composed record takes a 高台 in English as it does in Chinese', async () => {
  const { composeUnitRecord } = await import('../../shared/standIn.js');
  const store = await diskStore();
  await store.load('backups');
  const identity = ZH.chess_char_6_diy1_a; // a 自选 slot: identity from the chess record, body and form from the 补位 data
  assert.ok(identity, 'the 自选 slot record');
  /** The stand-in record the board sees: composed from the backup unit at the slot's status (shared/standIn.js). */
  const compose = (backups) => {
    const unit = backups.units['char_400_weedy'];
    const form = unit.forms['2/1/4/0'];
    return composeUnitRecord(identity, unit, form, { skillIndex: 1, standInFor: identity.chessId });
  };
  const zhRec = compose(store.getRaw('backups'));
  assert.equal(zhRec.position, 'MELEE', '温蒂 is a 推击手');
  assert.equal(meleeOnHighGround(zhRec), true, 'Chinese: the trait line');
  assert.equal(zhRec.placeOnRanged, undefined, 'Chinese: no boolean anywhere');

  await store.setLocale('en');
  const enRec = compose(store.get('backups'));
  assert.ok(!String(enRec.trait.desc).includes('可以放置于远程位'), 'the English trait line is gone');
  assert.equal(enRec.placeOnRanged, true, 'the form’s reading comes across (shared/standIn.js)');
  assert.equal(meleeOnHighGround(enRec), true, 'English: a 高台 is legal — the same answer as the server');
});
