// test/ui/mode-modules-detail.test.js — 协议源石【特限恢复】的**客户端详情卡**：普通形态（没有精锐棋子）也要显示
// 干员调配里选的模组与它的 3 级数据（业主 2026-10-31「特限恢复有问题，不生效对没有精锐的干员」）。
//
// 服务端那一半在 test/match/module-level3.test.js（battleInput + simdata.getChess）。这一页钉的是卡片：
// `ChessDetail({ moduleLevel: 3 })` → `chessLoadout(..., { moduleLevel, moduleLevels })` → 记录用
// shared/loadoutRecord.js withModuleLevel3 组合，模组区块照常画（原来是 `golden && lo.module` 才画，普通形态永远没有）。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const load = (f) => JSON.parse(readFileSync(path.join(ROOT, 'data', f), 'utf8'));

// the browser data store reads the real data files from disk
globalThis.fetch = async (url) => {
  const name = String(url).split('/').pop();
  try {
    const body = readFileSync(path.join(ROOT, 'data', name), 'utf8');
    return { ok: true, status: 200, json: async () => JSON.parse(body) };
  } catch {
    return { ok: false, status: 404, json: async () => ({}) };
  }
};

const { data } = await import('../../public/js/data.js');
await data.loadAll('bonds', 'chess', 'items', 'assets', 'garrisons', 'config', 'moduleLevels', 'local');
const { ChessDetail } = await import('../../public/js/ui/detailPanel.js');
const { chessLoadout } = await import('../../public/js/ui/gameLogic.js');

const CHESS = load('chess.json');
const LEVELS = load('moduleLevels.json');
const HORN_A = 'chess_char_5_08_a';      // 号角 普通形态（没有 modules 列表）
const HORN_ISW = 'uniequip_004_horn';    // 号角特限证章（ISW-A）
const LOADOUT = { [HORN_A]: { module: HORN_ISW } };
const getChess = (id) => CHESS[id] || null;

/** The text of a vnode tree; the panel's own hook-free components are expanded (RichText's text prop included). */
const EXPAND = new Set(['Section', 'ItemRow', 'MorphPairings', 'MorphGrantLine']);
const textOf = (v) => {
  if (v == null || typeof v === 'boolean') return '';
  if (typeof v === 'string' || typeof v === 'number') return String(v);
  if (Array.isArray(v)) return v.map(textOf).join('');
  if (typeof v.type === 'function' && v.type.name === 'RichText') return String(v.props?.text ?? '');
  if (typeof v.type === 'function' && EXPAND.has(v.type.name)) return textOf(v.type(v.props));
  return textOf(v.props?.children);
};
const render = (props) => textOf(ChessDetail({ chess: CHESS[HORN_A], piece: null, editable: false, loadout: LOADOUT, bonds: [], ...props }));

test('chessLoadout：普通形态 + moduleLevel 3 用干员调配里选的模组（模组对象 + 3 级记录）', () => {
  const lo = chessLoadout(CHESS[HORN_A], LOADOUT, getChess, { moduleLevel: 3, moduleLevels: LEVELS });
  assert.deepEqual([lo.module.id, lo.module.typeName, lo.module.none], [HORN_ISW, 'ISW-A', false]);
  assert.equal(lo.defaultModule, false, '来自干员调配 ⇒ 不是默认模组');
  assert.equal(lo.record.module.level, 3, '记录是 3 级那份');
  const l3 = LEVELS[HORN_ISW];
  assert.deepEqual(
    [lo.record.stats.maxHp, lo.record.stats.atk],
    [CHESS[HORN_A].stats.maxHp + l3.attr.maxHp, CHESS[HORN_A].stats.atk + l3.attr.atk],
    'stats = 普通形态基础值 + 3 级 attr',
  );
  assert.equal(lo.record.trait.moduleDesc, l3.traitOverride.moduleDesc, '特性追加行来自 3 级记录');
  // 没有 moduleLevel（没卡）：普通形态仍是「没有模组」，与改动前逐字段一致
  const plain = chessLoadout(CHESS[HORN_A], LOADOUT, getChess, {});
  assert.equal(plain.module, null);
  assert.equal(plain.record.module.active, false);
});

test('ChessDetail：普通形态的卡片也画「模组」区块（名字 / ISW-A / 已调配），并显示 3 级的天赋与特性追加行', () => {
  const shown = render({ moduleLevel: 3 });
  assert.match(shown, /模组/, '有「模组」区块');
  assert.match(shown, /号角特限证章/, '模组名');
  assert.match(shown, /ISW-A/, '模组类型');
  assert.match(shown, /已调配/, '来自干员调配的标记');
  assert.match(shown, /可以攻击隐匿敌人/, '特性追加行（3 级记录）');
  assert.match(shown, /在集成战略中，在场时额外使重装干员攻击力\+8%/, '天赋【军事要塞】的 3 级文本');
  // 没有卡：普通形态的卡片没有模组区块
  const plain = render({});
  assert.ok(!plain.includes('号角特限证章'), '没有【特限恢复】就不画这个模组');
  assert.ok(!plain.includes('ISW-A'));
});
