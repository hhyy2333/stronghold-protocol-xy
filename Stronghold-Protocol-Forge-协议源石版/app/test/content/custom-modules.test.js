// test/content/custom-modules.test.js — 官方表里还没有的模组（tools/custom-modules.mjs 合成注入的那几张）
//
// 口径：04-文档/协议源石-号角特限模组-设计稿-20261031.md §2。号角（char_4039_horn，本作 5 阶重装·要塞，棋子
// chess_char_5_08_a / _b）的 ISW-A 特限模组「号角特限证章」uniequip_004_horn 在官方 gamedata 里不存在，由
// tools/custom-modules.mjs 合成官方形状的记录注入内存表，tools/build-data.mjs 正常生成三份 data：
//   * data/chess.json          精锐 chess_char_5_08_b 的 modules[] 多出第 4 个可选模组（1 级：面板 + 特性追加行，
//                              天赋不动）；
//   * data/moduleLevels.json   3 级记录（面板 + 特性追加行 + 天赋【军事要塞】的「在集成战略中…」那半）；
//   * data/backups.json        不变（号角是 PRESET 棋子，不是补位 / 自选，backups 只收那两类角色）。
//
// 这里断言的是**生成结果**（数据层），战斗落地在 test/sim/hex-mode-modules-isw.test.js。
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { DATA } from '../match/harness.js';
import {
  applyCustomModules, CUSTOM_UNIEQUIPS, CUSTOM_BATTLE_EQUIPS,
  HORN_CHAR_ID, HORN_ISW_A_ID, HORN_TRAIT_ADDED, HORN_TALENT_L2, HORN_TALENT_L3,
} from '../../tools/custom-modules.mjs';

const MOD = HORN_ISW_A_ID;          // uniequip_004_horn
const NORMAL = 'chess_char_5_08_a'; // 号角 普通形态
const GOLDEN = 'chess_char_5_08_b'; // 号角 精锐形态（模组只挂在精锐上）
const DEFAULT_MOD = 'uniequip_002_horn'; // FOR-X “典范之人”，默认模组，不许动

test('data/chess.json：号角精锐的 modules 含号角特限证章（ISW-A），1 级只有面板与特性追加行', () => {
  const g = DATA.chess[GOLDEN];
  assert.ok(g && g.isGolden, '前提：chess_char_5_08_b 是精锐');
  const mods = g.modules || [];
  assert.ok(Array.isArray(mods) && mods.length >= 3, `号角精锐至少 3 个可选模组（实际 ${mods.length}）`);
  const m = mods.find((x) => x.uniEquipId === MOD);
  assert.ok(m, 'modules 里必须有 uniequip_004_horn');
  assert.equal(m.name, '号角特限证章');
  assert.equal(m.typeName, 'ISW-A', 'typeName1 ISW + typeName2 A 归一成 ISW-A');
  assert.equal(m.typeIcon, 'isw-a');
  assert.equal(m.icon, MOD);
  assert.equal(m.isDefault, false, '不是默认模组');
  assert.equal(m.level, 1, '可选模组列表按精锐的 equipLevel 1 生成');
  // 面板（[ASSUMED]，设计稿 §2.1）：1 级 生命 +150 / 攻击 +55
  assert.deepEqual(m.attr, { maxHp: 150, atk: 55 });
  // 特性：本体不变，追加一行「在集成战略中…」
  assert.equal(m.traitOverride.desc, '不阻挡敌人时优先远程群体物理攻击');
  assert.ok(m.traitOverride.moduleDesc.includes('可以攻击隐匿敌人'), `模组追加行：${m.traitOverride.moduleDesc}`);
  assert.ok(m.traitOverride.moduleDesc.includes('可以部署在目标点'), '「可以部署在目标点」只进文本（本作不落地）');
  // 1 级不改天赋【军事要塞】
  assert.deepEqual(m.talentChanges, [], '1 级没有天赋 part');
  // 默认模组没被动过（精锐默认仍是 FOR-X）
  assert.deepEqual(
    [g.module.id, g.module.type, g.module.level, g.module.active],
    [DEFAULT_MOD, 'FOR-X', 1, true],
  );
  assert.equal(mods.filter((x) => x.isDefault).length, 1, '默认模组唯一');
  // 普通形态没有模组列表（模组只挂在精锐上）
  assert.equal(DATA.chess[NORMAL].modules, undefined);
});

test('data/moduleLevels.json：号角特限证章的 3 级记录（面板 + 特性 + 军事要塞「在集成战略中…」）', () => {
  const levels = DATA.moduleLevels || {};
  const rec = levels[MOD];
  assert.ok(rec, 'moduleLevels 里必须有 uniequip_004_horn');
  assert.equal(rec.name, '号角特限证章');
  assert.deepEqual([rec.uniEquipId, rec.level, rec.typeName, rec.typeIcon], [MOD, 3, 'ISW-A', 'isw-a']);
  // 3 级面板（[ASSUMED]）：生命 +230 / 攻击 +85
  assert.deepEqual(rec.attr, { maxHp: 230, atk: 85 });
  // 特性追加行（三级同一条）
  assert.ok(rec.traitOverride.moduleDesc.includes('可以攻击隐匿敌人'));
  assert.equal(rec.traitOverride.desc, '不阻挡敌人时优先远程群体物理攻击', '特性本体不变');
  // 天赋 0 = 军事要塞：2 级文本 + 3 级的部署技力
  const tal = (rec.talentChanges || []).find((t) => t.talentIndex === 0);
  assert.ok(tal, 'talentChanges 里必须有 talentIndex 0（军事要塞）');
  assert.equal(tal.name, '军事要塞');
  assert.ok(tal.desc.includes('在集成战略中'), `3 级天赋文本：${tal.desc}`);
  assert.ok(tal.desc.startsWith('在场时所有重装干员的攻击力+23%（+3%）'), '军事要塞原值保留（满潜 +23%）');
  assert.ok(tal.desc.includes('自身部署时立即获得10点技力（本场最多20点）'), '3 级另加部署技力');
  assert.equal(tal.desc, HORN_TALENT_L3);
  assert.equal(tal.hidden, false, '不是隐藏天赋');
  // 黑板块：光环 / 身前格数 / 技力（战斗层 stone_mode_modules_isw.js 的 numOf 读这些键）
  assert.deepEqual(tal.bb, {
    atk: 0.23, horn_aura_atk: 0.08, horn_aura_hp: 0.12,
    horn_front_range: 1, horn_front_targets: 1, horn_sp: 10, horn_sp_cap: 20,
  });
  // 号角原有的两张模组仍在（没有替换）
  for (const id of [DEFAULT_MOD, 'uniequip_003_horn']) assert.ok(levels[id], `${id} 的 3 级记录还在`);
  // 记录条数：只在原表上多这一条（data/moduleLevels.json 由 tools/build-data.mjs 生成）
  assert.ok(Object.keys(levels).length >= 176, `3 级模组记录 ${Object.keys(levels).length} 条`);
});

test('tools/custom-modules.mjs：合成记录的形状、2 级文本、applyCustomModules 幂等且不动默认模组', () => {
  const meta = CUSTOM_UNIEQUIPS[MOD];
  assert.equal(meta.uniEquipId, MOD);
  assert.equal(meta.charId, HORN_CHAR_ID);
  assert.equal(meta.charEquipOrder, 4, '接在官方 001/002/003 之后');
  assert.deepEqual([meta.typeName1, meta.typeName2, meta.typeIcon, meta.type], ['ISW', 'A', 'isw-a', 'ADVANCED']);
  assert.equal(meta.isSpecialEquip, true, 'ISW-A 特限证章：适配限定模式');
  assert.equal(meta.specialEquipDesc, '适配限定模式');
  assert.deepEqual([meta.showEvolvePhase, meta.unlockEvolvePhase, meta.showLevel, meta.unlockLevel], ['PHASE_2', 'PHASE_2', 1, 60]);
  assert.deepEqual(meta.missionList, []);
  assert.deepEqual(meta.unlockFavors, { 1: 0, 2: 2732, 3: 10070 });
  assert.deepEqual(Object.keys(meta.itemCost), ['1', '2', '3']);
  assert.deepEqual(meta.itemCost['1'], [{ id: 'mod_unlock_token', count: 1, type: 'MATERIAL' }]);

  // 战斗数据：三级，每级都有特性 part；1 级没有天赋 part，2/3 级各一条
  const phases = CUSTOM_BATTLE_EQUIPS[MOD].phases;
  assert.deepEqual(phases.map((p) => p.equipLevel), [1, 2, 3]);
  assert.deepEqual(phases.map((p) => p.attributeBlackboard.map((b) => b.value)), [[150, 55], [190, 70], [230, 85]]);
  for (const ph of phases) {
    const trait = ph.parts.filter((p) => p.overrideTraitDataBundle?.candidates?.length);
    assert.equal(trait.length, 1, `level ${ph.equipLevel} 一条特性 part`);
    assert.equal(trait[0].target, 'DISPLAY');
    assert.equal(trait[0].isToken, false);
    assert.equal(trait[0].overrideTraitDataBundle.candidates[0].additionalDescription, HORN_TRAIT_ADDED);
    assert.deepEqual(trait[0].overrideTraitDataBundle.candidates[0].unlockCondition, { phase: 'PHASE_2', level: 60 });
    const talent = ph.parts.filter((p) => p.addOrOverrideTalentDataBundle?.candidates?.length);
    assert.equal(talent.length, ph.equipLevel === 1 ? 0 : 1, `level ${ph.equipLevel} 天赋 part 条数`);
    for (const pt of talent) {
      const c = pt.addOrOverrideTalentDataBundle.candidates[0];
      assert.equal(pt.target, 'TALENT');
      assert.equal(c.talentIndex, 0);
      assert.equal(c.name, '军事要塞');
      assert.equal(c.prefabKey, '10_root');
      assert.equal(c.requiredPotentialRank, 0, '满潜与低潜都能拿到（模组不改潜能档）');
      assert.equal(c.upgradeDescription, ph.equipLevel === 2 ? HORN_TALENT_L2 : HORN_TALENT_L3);
    }
  }
  assert.ok(HORN_TALENT_L3.startsWith(HORN_TALENT_L2), '3 级文本 = 2 级文本 + 部署技力');

  // applyCustomModules：就地合并、幂等、不动默认模组
  const ctx = {
    uniequip: { equipDict: {}, charEquip: { [HORN_CHAR_ID]: ['uniequip_001_horn', DEFAULT_MOD] } },
    battleEquip: {},
  };
  assert.deepEqual(applyCustomModules(ctx), [MOD], '第一次加一条');
  assert.deepEqual(ctx.uniequip.charEquip[HORN_CHAR_ID], ['uniequip_001_horn', DEFAULT_MOD, MOD], '追加在已有模组之后');
  assert.equal(ctx.uniequip.equipDict[MOD], CUSTOM_UNIEQUIPS[MOD]);
  assert.equal(ctx.battleEquip[MOD], CUSTOM_BATTLE_EQUIPS[MOD]);
  assert.deepEqual(applyCustomModules(ctx), [], '第二次什么都不加（幂等）');
  assert.equal(ctx.uniequip.charEquip[HORN_CHAR_ID].filter((id) => id === MOD).length, 1, '不重复追加');
  // 形状不对：缺 ctx / 缺表 ⇒ 抛错（不静默生成半截数据）
  assert.throws(() => applyCustomModules({}), /needs \{ uniequip, battleEquip \}/);
  // 表里已经有同名记录（将来官方自己出了这张模组）：不覆盖、不重复追加，合成记录让位给官方
  const existing = {
    uniequip: { equipDict: { [MOD]: { uniEquipId: MOD, charId: HORN_CHAR_ID } }, charEquip: { [HORN_CHAR_ID]: [MOD] } },
    battleEquip: { [MOD]: { phases: [] } },
  };
  assert.deepEqual(applyCustomModules(existing), []);
  assert.deepEqual(existing.uniequip.equipDict[MOD], { uniEquipId: MOD, charId: HORN_CHAR_ID });
  assert.deepEqual(existing.battleEquip[MOD], { phases: [] });
  assert.deepEqual(existing.uniequip.charEquip[HORN_CHAR_ID], [MOD]);
});

test('data/moduleLevels.json 是 tools/build-data.mjs 的生成物：3 级记录与合成表逐字段一致', () => {
  // 生成物不能手改（AGENTS.md「Generated data」）：3 级记录里的面板 / 特性 / 天赋必须能从合成表推出来。
  const rec = DATA.moduleLevels[MOD];
  const l3 = CUSTOM_BATTLE_EQUIPS[MOD].phases.find((p) => p.equipLevel === 3);
  assert.deepEqual(rec.attr, Object.fromEntries(l3.attributeBlackboard.map((b) => [b.key === 'max_hp' ? 'maxHp' : 'atk', b.value])));
  const traitPart = l3.parts.find((p) => p.overrideTraitDataBundle?.candidates?.length);
  assert.equal(rec.traitOverride.moduleDesc, traitPart.overrideTraitDataBundle.candidates[0].additionalDescription.replace(/<@ba\.kw>|<\/>/g, ''));
  const talentPart = l3.parts.find((p) => p.addOrOverrideTalentDataBundle?.candidates?.length);
  assert.equal(rec.talentChanges[0].desc, talentPart.addOrOverrideTalentDataBundle.candidates[0].upgradeDescription);
  // 文件本体也读一遍：数据文件与 server/data.js 看到的是同一份
  const onDisk = JSON.parse(fs.readFileSync('data/moduleLevels.json', 'utf8'));
  assert.deepEqual(onDisk[MOD], rec);
});
