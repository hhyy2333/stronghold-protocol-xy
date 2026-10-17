// test/custom-ops.test.js — the 自制干员 pipeline (tools/custom-ops.mjs, tools/custom-assets.mjs): an ORIGINAL operator
// declared in the official table shapes and built by tools/build-data.mjs through the same code path as every official
// character, landing in data/backups.json `diy.ownedPool` as an ordinary owned 6★ pick; and the art alias that gives it
// a real operator's already-shipped art (it has no upstream art of its own).
// Run: node --test test/custom-ops.test.js

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { CUSTOM_OP_IDS, FIXED_OP_IDS, FIXED_CHESS_IDS, FIXED_GARRISON_IDS, customArt, fixedArt, applyCustomOps, applyFixedChess } from '../tools/custom-ops.mjs';
import { customArtEntries, addCustomArtEntries, missingCustomArt, applyCustomArt, ART_ALIAS_IDS } from '../tools/custom-assets.mjs';
import { diyPool } from '../shared/diy.js';
import { unitForm } from '../shared/standIn.js';
import { KITTED_CHARS, OPERATOR_KITS } from '../server/sim/content/kits/index.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const load = (f) => JSON.parse(readFileSync(join(ROOT, 'data', `${f}.json`), 'utf8'));
const BACKUPS = load('backups');
const CHESS = load('chess');
const ASSETS = load('assets');
const CACHE = join(ROOT, '.cache', 'gamedata');
const raw = (f) => JSON.parse(readFileSync(join(CACHE, 'excel', `${f}.json`), 'utf8'));
const hasCache = (() => { try { raw('character_table'); return true; } catch { return false; } })();

// the fixed operator's ids, derived from the exported lists (the module exports ids, not names)
const NIYA_B = FIXED_CHESS_IDS.find((id) => /_b$/.test(id));
const NIYA_A = FIXED_CHESS_IDS.find((id) => !/_b$/.test(id));
const [NIYA_GA, NIYA_GB] = FIXED_GARRISON_IDS;

test('applyCustomOps: a custom operator is merged into the official tables and builds through the same path', { skip: !hasCache && 'no .cache/gamedata' }, () => {
  const act = raw('activity_table').activity.AUTOCHESS_SEASON.act2autochess;
  const ctx = {
    act: { ...act, charChessDataDict: { ...act.charChessDataDict }, charShopChessDatas: { ...act.charShopChessDatas }, chessNormalIdLookupDict: { ...act.chessNormalIdLookupDict }, garrisonDataDict: { ...act.garrisonDataDict } },
    charTable: raw('character_table'), skillTable: raw('skill_table'), rangeTable: raw('range_table'),
    uniequip: raw('uniequip_table'), battleEquip: raw('battle_equip_table'),
  };
  const before = { chars: Object.keys(ctx.charTable).length, skills: Object.keys(ctx.skillTable).length };
  const added = applyCustomOps(ctx);
  assert.deepEqual(added, [...CUSTOM_OP_IDS], 'the declared 自选 operators are added');
  assert.equal(Object.keys(ctx.charTable).length, before.chars + CUSTOM_OP_IDS.length + FIXED_OP_IDS.length, 'the 自选 and the 固定 operators both join character_table');
  assert.ok(Object.keys(ctx.skillTable).length > before.skills, 'their skills join skill_table');
  // a module is registered on its owner with the ORIGINAL slot first, as on every official character
  for (const id of CUSTOM_OP_IDS) {
    const equips = ctx.uniequip.charEquip[id] || [];
    assert.ok(equips.length >= 2, `${id}: an INITIAL slot and an ADVANCED module`);
    assert.equal(ctx.uniequip.equipDict[equips[0]].type, 'INITIAL', `${id}: INITIAL first`);
    assert.ok(ctx.uniequip.equipDict[equips[1]].type === 'ADVANCED' && ctx.battleEquip[equips[1]], `${id}: the module has its battle_equip row`);
  }
  // idempotent: a second call never overrides what is already there
  assert.deepEqual(applyCustomOps(ctx), [], 'a second apply is a no-op');
});

test('applyFixedChess: a 固定 operator joins the three activity_table maps, with no module and its own 特质', { skip: !hasCache && 'no .cache/gamedata' }, () => {
  const act = raw('activity_table').activity.AUTOCHESS_SEASON.act2autochess;
  const ctx = {
    act: { ...act, charChessDataDict: { ...act.charChessDataDict }, charShopChessDatas: { ...act.charShopChessDatas }, chessNormalIdLookupDict: { ...act.chessNormalIdLookupDict }, garrisonDataDict: { ...act.garrisonDataDict }, bondInfoDict: JSON.parse(JSON.stringify(act.bondInfoDict)) },
    charTable: raw('character_table'), skillTable: raw('skill_table'), rangeTable: raw('range_table'),
    uniequip: raw('uniequip_table'), battleEquip: raw('battle_equip_table'),
  };
  const added = applyFixedChess(ctx);
  assert.deepEqual(added, [...FIXED_CHESS_IDS]);
  for (const id of FIXED_OP_IDS) {
    const a = ctx.act.charChessDataDict[NIYA_A];
    assert.equal(a.chessId, NIYA_A, 'the normal form is added');
    assert.equal(a.upgradeChessId, NIYA_B, 'it upgrades into the elite');
    assert.deepEqual(a.bondIds, ['preciShip'], 'the 精准 bond comes from the row');
    assert.deepEqual(a.garrisonIds, ['garrison_161_a'], 'its 特质 comes from the row');
    // the shop row is a PRESET that is its own backup (always fielded as itself)
    const shop = ctx.act.charShopChessDatas[NIYA_A];
    assert.equal(shop.chessType, 'PRESET');
    assert.equal(shop.charId, id, 'the shop row names the operator');
    assert.equal(shop.backupCharId, id, 'a PRESET is its own backup');
    assert.equal(shop.defaultUniEquipId, null, 'the operator ships no module');
    assert.equal(shop.chessLevel, 3, 'tier 3');
    assert.equal(ctx.act.chessNormalIdLookupDict[NIYA_B], NIYA_A, 'the elite resolves to the normal form');
    // both 特质 rows are injected and own their chess
    for (const [gid, want] of [[NIYA_GA, 4], [NIYA_GB, 8]]) {
      const g = ctx.act.garrisonDataDict[gid];
      assert.ok(g, `${gid}: declared`);
      assert.equal(g.eventType, 'SERVER_PREP_FIN');
      assert.equal(g.effectType, 'SERVER_ADD_BOND_CHESS_ALL');
      assert.equal(g.blackboard.find((b) => b.key === 'count').value, want, `${gid}: +${want}`);
    }
    // 盟约 membership: both forms are appended to bondInfoDict.preciShip.chessIdList (the official list carries `_b` ids
    // too — 12 of its 24); tools/build-data.mjs buildBonds then filters the goldens out of the built `members`
    const members = ctx.act.bondInfoDict.preciShip.chessIdList;
    assert.ok(members.includes(NIYA_A), 'the bond lists the normal form');
    assert.ok(members.includes(NIYA_B), 'and the elite form, as the official list does');
  }
  // idempotent
  assert.deepEqual(applyFixedChess(ctx), [], 'a second apply is a no-op');
});

test('applyFixedChess without an activity table is a no-op, never a crash (a minimal test context)', () => {
  const ctx = { charTable: {}, skillTable: {}, uniequip: {}, battleEquip: {} };
  assert.deepEqual(applyFixedChess(ctx), []);
});

test('the built data: no 自选 original operator ships, and every declared one would be a full owned-6★ pick', () => {
  // This build declares NO 自选 (DIY) original operator: 凛霜 (char_9001_rime) was the only one and was removed on
  // request, so CUSTOM_OP_IDS is empty and nothing of hers survives in the built data. The loop below is the shape a
  // future 自选 operator must satisfy — it simply has no iterations today (the FIXED operator 娅娜 is covered by
  // applyFixedChess / test/match/fixed-op-match.test.js).
  assert.deepEqual(CUSTOM_OP_IDS, [], 'no 自选 original operator is declared in this build');
  assert.ok(!BACKUPS.units['char_9001_rime'], '凛霜 is not in the built units');
  assert.ok(!BACKUPS.diy.ownedPool.includes('char_9001_rime'), 'nor in the 自选 pool');
  assert.ok(!BACKUPS.diy.operators['char_9001_rime'], 'nor does her faction record linger');
  assert.ok(!BACKUPS.mods['custom-ops'], 'and the build stamps no 自制干员 content');
  for (const id of CUSTOM_OP_IDS) {
    const u = BACKUPS.units[id];
    assert.ok(u, `${id}: a unit`);
    assert.deepEqual([u.charId, u.rarity, u.isNotObtainable, u.standsIn], [id, 6, false, []], `${id}: identity`);
    assert.ok(u.name && u.profession && u.subProfessionId && u.subProfessionName && u.position, `${id}: identity`);
    assert.deepEqual(Object.keys(u.forms), ['2/1/4/0', '2/60/7/1', '2/60/7/3'], `${id}: the three DIY statuses`);
    assert.ok(BACKUPS.diy.ownedPool.includes(id), `${id}: in ownedPool`);
    assert.ok(BACKUPS.diy.operators[id]?.bonds?.length, `${id}: derived bonds`);
    assert.equal(typeof OPERATOR_KITS[id], 'function', `${id}: a kit file`);
    assert.ok(KITTED_CHARS.includes(id), `${id}: may fill a 自选 slot`);
    for (const t of [5, 6]) assert.ok(diyPool(t, { data: { chess: CHESS, backups: BACKUPS }, kitted: KITTED_CHARS }).includes(id), `${id}: tier ${t}`);
    // every skill is authored by the kit (a 自选 piece has no default skill)
    for (const [key, f] of Object.entries(u.forms)) {
      assert.equal(f.skills.length, 3, `${id}@${key}: three skills`);
      assert.ok(Array.isArray(f.talents) && f.talents.length > 0, `${id}@${key}: talents`);
      assert.ok(f.trait?.desc && f.rangeGrid?.length, `${id}@${key}: trait / range`);
      if (f.status.equipLevel === 0) assert.equal(f.modules, undefined, `${id}@${key}: no module phase`);
      else assert.ok(f.modules.length > 0, `${id}@${key}: modules at the stage`);
    }
  }
});

test('the data the operator does not have: no official table row, and a full regeneration adds nothing else', { skip: !hasCache && 'no .cache/gamedata' }, () => {
  const CT = raw('character_table');
  // every original operator (自选 or 固定) is absent from the official tables — that is what "original" means
  for (const id of [...CUSTOM_OP_IDS, ...FIXED_OP_IDS]) assert.equal(CT[id], undefined, `${id}: not in the official character_table`);
  // the removed 自选 operator is gone from the build entirely
  assert.equal(CT['char_9001_rime'], undefined, '凛霜 was never an official row either');
  assert.equal(BACKUPS.units['char_9001_rime'], undefined, 'and it is out of the built data');
  // the 自选 pipeline builds its records through buildUnitForm, so a 自选 pick WOULD have a backups unit. The FIXED
  // operator does not: a PRESET chess is its own body (no `units` record), so this asserts the shape on the chess table
  // instead — the same three-skill / trait / range completeness a 自选 form must have.
  const chessRec = CHESS['chess_char_3_22_a'];
  assert.ok(chessRec, 'the FIXED operator is a chess record');
  assert.equal(chessRec.skills.length, 3, 'three skills');
  assert.ok(chessRec.trait?.desc && chessRec.rangeGrid?.length, 'trait / range');
  assert.equal(typeof OPERATOR_KITS[FIXED_OP_IDS[0]], 'undefined', 'a FIXED operator is not a 自选 operator kit');
  // and the 自选 form builder itself still works on an official operator (the pipeline the removal did not touch)
  const f = unitForm(BACKUPS, 'char_112_siege', { phase: 2, level: 60, skillLevel: 7, equipLevel: 1 });
  assert.ok(f && f.stats.maxHp > 0 && f.rangeGrid.length > 0 && f.skills.length === 3, 'a complete form');
  assert.deepEqual(f.status, { phase: 2, level: 60, skillLevel: 7, equipLevel: 1 });
});

test('art: the alias points at an operator that ships, so an original operator draws instead of a plain diamond', () => {
  for (const id of [...CUSTOM_OP_IDS, ...FIXED_OP_IDS]) {
    const a = customArt(id) ?? fixedArt(id);
    assert.ok(a, `${id}: declared an art alias`);
    assert.ok(ASSETS.chars[a.chars], `${id}: the alias source ${a.chars} is in the manifest`);
    // the manifest entry is the source's art: same URLs, plus the `*Local` OVERLAY metadata when the author drew their
    // own pictures (tools/custom-spine.mjs; 娅娜 has one). The alias URLs must match the source exactly.
    const entry = ASSETS.chars[id], src = ASSETS.chars[a.chars];
    for (const k of ['avatar', 'avatarE2', 'portrait', 'portraitE2', 'spine']) {
      if (src[k] !== undefined) assert.deepEqual(entry[k], src[k], `${id}: ${k} is the source's`);
    }
    for (const [iconId, from] of Object.entries(a.skills || {})) {
      assert.ok(ASSETS.skills[iconId], `${id}: ${iconId} in the manifest`);
      assert.equal(ASSETS.skills[iconId], ASSETS.skills[from], `${id}: ${iconId} borrows ${from}`);
      assert.equal(ASSETS.skillsById[iconId], iconId, `${id}: ${iconId} resolves by id`);
    }
  }
  // the removed operator's aliases are gone from the committed manifest
  assert.equal(ASSETS.chars['char_9001_rime'], undefined, '凛霜 has no art entry any more');
  for (const icon of ['skchr_rime_1', 'skchr_rime_2', 'skchr_rime_3']) {
    assert.equal(ASSETS.skills[icon], undefined, `${icon}: its skill icon is gone`);
    assert.equal(ASSETS.skillsById[icon], undefined, `${icon}: and its skillsById mapping`);
  }
  assert.deepEqual(missingCustomArt(ASSETS), [], 'nothing missing');
});

test('the art alias is idempotent and survives a manifest rebuild (tools/fetch-assets.mjs re-applies it)', () => {
  const body = JSON.parse(JSON.stringify(ASSETS));
  // a rebuilt manifest body that has no custom entries yet: strip the aliases of every original operator that has one
  const ids = [...CUSTOM_OP_IDS, ...FIXED_OP_IDS];
  const stripped = JSON.parse(JSON.stringify(body));
  for (const id of ids) {
    delete stripped.chars[id];
    for (const iconId of Object.keys((customArt(id) ?? fixedArt(id))?.skills || {})) { delete stripped.skills[iconId]; delete stripped.skillsById[iconId]; }
  }
  assert.ok(missingCustomArt(stripped).length > 0, 'the stripped body is missing them');
  const { added, missing } = addCustomArtEntries(stripped);
  assert.deepEqual(missing, []);
  assert.deepEqual(added.chars, ids, 're-applying restores every original operator\'s alias');
  assert.deepEqual(missingCustomArt(stripped), [], 're-applying fills every entry');
  // the copied entries equal the source's
  for (const id of ids) assert.deepEqual(stripped.chars[id], body.chars[(customArt(id) ?? fixedArt(id)).chars]);
  // idempotent: a second apply adds nothing and changes nothing
  const again = addCustomArtEntries(stripped);
  assert.deepEqual(again.added, { chars: [], skills: [] });
  assert.deepEqual(stripped, (() => { const c = JSON.parse(JSON.stringify(stripped)); addCustomArtEntries(c); return c; })());
  // applyCustomArt recomputes hash + stats to the same shape tools/fetch-assets.mjs writes
  const doc = JSON.parse(JSON.stringify(stripped));
  applyCustomArt(doc);
  assert.equal(typeof doc.hash, 'string');
  assert.equal(doc.hash.length, 12);
  assert.equal(doc.stats.chars, Object.keys(doc.chars).length);
  assert.equal(doc.stats.skills, Object.keys(doc.skills).length);
});

test('customArtEntries refuses an alias whose source is not in the manifest (a clear error, never a broken entry)', () => {
  const { chars, missing } = customArtEntries({ chars: {}, skills: {} });
  assert.deepEqual(chars, {});
  assert.ok(missing.length >= ART_ALIAS_IDS.length, 'every original operator reports its missing source');
  const r = addCustomArtEntries({ chars: {}, skills: {} });
  assert.deepEqual(r.added, { chars: [], skills: [] }, 'nothing is written when a source is missing');
  assert.ok(r.missing.length > 0);
});

test('tools/custom-assets.mjs is importable: tools/fetch-assets.mjs imports it, so its CLI must not parse the importer\'s argv', async () => {
  // a regression guard: CLI parsing at module scope made `node tools/fetch-assets.mjs --offline …` fail with
  // "unknown option --offline" (the imported module read the importer's process.argv)
  const argv = process.argv;
  process.argv = ['node', join(ROOT, 'tools', 'fetch-assets.mjs'), '--offline', '--add-only', '--prune'];
  try {
    const mod = await import('../tools/custom-assets.mjs');
    assert.equal(typeof mod.addCustomArtEntries, 'function');
    assert.equal(typeof mod.applyCustomArt, 'function');
    assert.equal(typeof mod.missingCustomArt, 'function');
  } finally {
    process.argv = argv;
  }
});
