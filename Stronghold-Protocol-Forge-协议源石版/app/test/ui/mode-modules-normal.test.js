// test/ui/mode-modules-normal.test.js — 协议源石【特限恢复】下**未精锐（普通形态）**的模组：卡片上始终看得到、
// 而且能就地更换（业主 2026-11-03「有特限恢复时，未精锐干员只有 1、2 技能能显示模组，而且不能更换。完善」）。
//
// 原来的三条缝（这一页钉住它们不再回来）：
//   ① 只有 loadout 里**有**这条干员的条目（= 技能不等于默认技能）时才画模组块 —— 默认技能那一档整块消失，所以看起来
//      「只有 1、2 技能显示模组」（号角默认技能是 S3）。见 shared/protocol.js checkLoadout：条目等于默认值就被丢掉。
//   ② 「休整期更换」的模组行取 `loadoutOptions(base, golden)`，普通形态传 null ⇒ modules=[] ⇒ 永远不出现。
//   ③ 选「不装备」时客户端仍套了默认模组的 3 级数据（服务端不套）—— 卡片说一套、战斗打另一套。
//
// 判据只有一份：shared/loadoutRecord.js normalFormModuleOf（服务端 simdata.getChess 的缺省 moduleId 与它同源口径）。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const load = (f) => JSON.parse(readFileSync(path.join(ROOT, 'data', f), 'utf8'));

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
const { normalFormModuleOf } = await import('../../shared/loadoutRecord.js');

const CHESS = load('chess.json');
const LEVELS = load('moduleLevels.json');
const HORN_A = 'chess_char_5_08_a';      // 号角 普通形态（没有 modules 列表；默认技能是 S3）
const HORN_FORX = 'uniequip_002_horn';   // “典范之人”（默认模组）
const HORN_ISW = 'uniequip_004_horn';    // 号角特限证章（ISW-A）
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
const piece = { kind: 'chess', uid: 1, items: [] };
const render = (loadout, extra = {}) => textOf(ChessDetail({
  chess: CHESS[HORN_A], piece, editable: true, loadout, bonds: [], moduleLevel: 3, ...extra,
}));
const swapsIn = (txt) => (txt.match(/休整期更换/g) || []).length;

test('normalFormModuleOf：选了用选的、没选用精锐的默认模组、明说不装备 ⇒ none、精锐没有模组 ⇒ null', () => {
  const dflt = normalFormModuleOf(CHESS[HORN_A], {}, getChess);
  assert.deepEqual([dflt.id, dflt.none, dflt.isDefault], [HORN_FORX, false, true], '没选过 ⇒ 精锐的默认模组');
  const picked = normalFormModuleOf(CHESS[HORN_A], { [HORN_A]: { module: HORN_ISW } }, getChess);
  assert.deepEqual([picked.id, picked.typeName, picked.isDefault], [HORN_ISW, 'ISW-A', false]);
  const none = normalFormModuleOf(CHESS[HORN_A], { [HORN_A]: { module: 'none' } }, getChess);
  assert.deepEqual([none.id, none.none], ['none', true], '「不装备」是一个明确的答案，不是「没有」');
  // 一个没有模组的精锐（蒂比）：普通形态也拿不到模组
  const tibby = CHESS['chess_char_2_13_a'];
  assert.equal(normalFormModuleOf(tibby, {}, getChess), null);
  assert.equal(normalFormModuleOf(CHESS['chess_char_5_08_b'], {}, getChess), null, '精锐记录本身不是「普通形态」');
});

test('chessLoadout：普通形态在【特限恢复】下始终有一个模组 —— 与技能无关（默认技能那一档也一样）', () => {
  for (const skill of [0, 1, 2]) {
    const lo = chessLoadout(CHESS[HORN_A], { [HORN_A]: { skill } }, getChess, { moduleLevel: 3, moduleLevels: LEVELS });
    assert.deepEqual([lo.module.id, lo.module.typeName], [HORN_FORX, 'FOR-X'], `S${skill + 1}: 默认模组`);
    assert.equal(lo.defaultModule, true, `S${skill + 1}: 它就是默认模组`);
    assert.equal(lo.record.module.level, 3, `S${skill + 1}: 记录是 3 级那份`);
  }
  // 没有条目（连技能也没改）也照样有模组 —— 原来这一档整块不画
  const bare = chessLoadout(CHESS[HORN_A], {}, getChess, { moduleLevel: 3, moduleLevels: LEVELS });
  assert.equal(bare.module.id, HORN_FORX);
  assert.equal(bare.record.module.level, 3);
  // 选了特限模组：那个模组的 3 级
  const isw = chessLoadout(CHESS[HORN_A], { [HORN_A]: { module: HORN_ISW } }, getChess, { moduleLevel: 3, moduleLevels: LEVELS });
  assert.deepEqual([isw.module.id, isw.module.typeName, isw.defaultModule], [HORN_ISW, 'ISW-A', false]);
  // 选了「不装备」：不画、也不套 3 级（与战斗同一条：simdata.getChess 收到 moduleId='none'）
  const none = chessLoadout(CHESS[HORN_A], { [HORN_A]: { module: 'none' } }, getChess, { moduleLevel: 3, moduleLevels: LEVELS });
  assert.equal(none.module.none, true);
  assert.equal(none.record.module.active, false, '不装备 ⇒ 记录上也没有启用的模组');
  assert.equal(none.record.stats.atk, CHESS[HORN_A].stats.atk, '不装备 ⇒ 基础攻击力（不是 3 级的）');
  // 没有这张卡：普通形态仍然「没有模组」，逐字段与改动前一致
  const plain = chessLoadout(CHESS[HORN_A], { [HORN_A]: { skill: 0 } }, getChess, {});
  assert.equal(plain.module, null);
});

test('ChessDetail：普通形态的卡片在**任何**技能下都画「模组」块，并且给得出更换行', () => {
  for (const skill of [0, 1, 2]) {
    const shown = render({ [HORN_A]: { skill } });
    assert.match(shown, /模组/, `S${skill + 1}: 有「模组」块`);
    assert.match(shown, /典范之人/, `S${skill + 1}: 模组名`);
    assert.match(shown, /FOR-X/, `S${skill + 1}: 模组类型`);
    assert.match(shown, /号角特限证章/, `S${skill + 1}: 更换行里列出其它模组（模组表在精锐记录上）`);
    assert.equal(swapsIn(shown), 2, `S${skill + 1}: 技能行 + 模组行`);
  }
  // 什么都没选（默认技能 + 默认模组）：仍然有块，但没有「已调配」这个标记
  const bare = render({});
  assert.match(bare, /典范之人/);
  assert.ok(!bare.includes('已调配'), '默认模组不标「已调配」');
  // 明说「不装备」：块在（它是一条选择），记录是基础值
  const none = render({ [HORN_A]: { module: 'none' } });
  assert.match(none, /模组/);
  assert.match(none, /未装备模组/);
});

test('没有【特限恢复】时这条路完全关掉：普通形态的卡片没有模组块，也没有更换行', () => {
  const plain = textOf(ChessDetail({ chess: CHESS[HORN_A], piece, editable: true, loadout: { [HORN_A]: { skill: 0 } }, bonds: [] }));
  assert.ok(!plain.includes('MODULE'), '没有卡 ⇒ 不画模组块');
  assert.ok(!plain.includes('典范之人'));
  assert.equal(swapsIn(plain), 1, '只有技能那一行更换');
});
