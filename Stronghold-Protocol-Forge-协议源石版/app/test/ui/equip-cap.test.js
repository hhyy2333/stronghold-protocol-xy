// 整装待发 (\`hex_fullkit\`, prismatic) 的**客户端那一半** —— 业主 2026-10-18 报「这个好像不生效」。
//
// 服务端从 0.3.0 移植起就允许一名干员带 3 件：\`PlayerState.equipCap()\` → \`hextech.equipSlotsOf\`，私有视图发布
// \`privateView().equipCap\`（test/match/hextech.test.js 已钉住）。但客户端从没读过那个字段：
//   * \`ui/gameLogic/placement.js\` 的 \`equipReplaces\` 用 \`slot.slotCap(2)\` 判「满了」⇒ 身上已有两件时拖第三件上去
//     弹的是**替换对话框**（要销毁一件），于是永远装不上第三件；
//   * \`ui/detailPanel.js\` 的 \`EQUIP n/2\`、空槽提示「最多 2 件」、装备卡「每名干员最多 2 件」同样写死 2。
// 修法：\`priv.equipCap\` 进 \`placementContext\`（缺项 / 旧服务端 / 手搓 priv ⇒ 仍是数据里的 2），替换判据与卡片分母
// 都读它；文案换成已存在的 \`{n}\` 版 msgid。装备位的「不占位 / 谁来顶替」仍由 \`shared/morph.js\` 的策略回答，未动。
//
// 卡片括号里那句「装备变形同构体与两个阵营装备时，两边的阵营盟约都会生效」是 3 格的**结论**：变形同构体在官方档下占
// 一格（\`shared/morph.js\` official），3 格 ⇒ 它 + 两件不同阵营的 \`giveBondId\` 装备，\`grantedBondsByMorph\` 按官方档
// 「每一件都授予」。这里一并钉住。
import { test, describe } from 'node:test';
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

const { placementContext, equipReplaces, grantedBonds } = await import('../../public/js/ui/gameLogic.js');
const { data } = await import('../../public/js/data.js');
await data.loadAll('bonds', 'chess', 'items', 'assets', 'garrisons', 'config');
const { ChessDetail, ItemDetail } = await import('../../public/js/ui/detailPanel.js');

const items = load('items.json');
const chess = load('chess.json');
const getItem = (id) => items[id] || null;

const WEARER = 'chess_char_1_01_a';     // 隐现 (拉特兰 / 迅捷) — any chess with the 装备 section
const MACE = 'chess_item_1_01_e_a';     // 维式重锤 → 维多利亚
const MORPH = 'chess_item_6_09_e_a';    // 变形同构体
const CLIP = 'chess_item_4_08_e_a';     // 拉特兰桥夹 → 拉特兰
const INCOMING = 'chess_item_2_03_e_a'; // 战栗维式重锤 (a third, distinct item)

const carrier = (carried) => ({ uid: 9, kind: 'chess', id: WEARER, golden: false, tier: 1, items: carried });
const ctxOf = (priv) => placementContext({ priv, stage: null, editable: true, getItem, getChess: () => null });
/** A context whose hand holds INCOMING as uid 3 (equipReplaces reads its record through ctx.pieces). */
const equipCtx = (equipCap) => ctxOf({ equipCap, hand: [{ uid: 3, kind: 'item', id: INCOMING }] });

/** The text of a vnode tree; the panel's own hook-free components are expanded (RichText & co. stay unexpanded). */
const EXPAND = new Set(['Section', 'ItemRow', 'MorphPairings', 'MorphGrantLine']);
const textOf = (v) => {
  if (v == null || typeof v === 'boolean') return '';
  if (typeof v === 'string' || typeof v === 'number') return String(v);
  if (Array.isArray(v)) return v.map(textOf).join('');
  if (typeof v.type === 'function' && EXPAND.has(v.type.name)) return textOf(v.type(v.props));
  if (typeof v.type === 'function' && v.type.name === 'RichText') return String(v.props.text || '');
  return textOf(v.props?.children);
};

describe('整装待发 (hex_fullkit): the client reads the player\'s own equipment cap', () => {
  test('placementContext carries priv.equipCap; a priv without it (older server, a test\'s stand-in) keeps the data\'s 2', () => {
    assert.equal(ctxOf({}).equipCap, 2, 'no field → 2');
    assert.equal(ctxOf({ equipCap: 3 }).equipCap, 3);
    for (const bad of [undefined, null, 0, -1, 2.5, '3', NaN]) assert.equal(ctxOf({ equipCap: bad }).equipCap, 2, String(bad));
  });

  test('with two carried and cap 3 a third item just attaches; with the data\'s 2 it still opens the replace dialog', () => {
    const two = carrier([{ uid: 1, id: MACE }, { uid: 2, id: MORPH }]);
    assert.equal(equipReplaces(equipCtx(2), 3, two), true, 'cap 2: full → the dialog picks what to destroy');
    assert.equal(equipReplaces(equipCtx(3), 3, two), false, 'cap 3: the third slot is free → no dialog');
    // exactly AT the cap: 3 carried, cap 3 → replace again
    const three = carrier([{ uid: 1, id: MACE }, { uid: 2, id: MORPH }, { uid: 4, id: CLIP }]);
    assert.equal(equipReplaces(equipCtx(3), 3, three), true);
    // and the card's parenthetical: 变形同构体 + two faction items grants BOTH bonds under the official pairing
    assert.deepEqual(grantedBonds([MACE, CLIP, MORPH], getItem), ['victoriaShip', 'lateranoShip']);
  });

  test('the detail card reads EQUIP n/<cap> and says 最多 <cap> 件', () => {
    const two = carrier([{ uid: 1, id: MACE }, { uid: 2, id: MORPH }]);
    const blockOf = (tree) => tree.find((b) => b?.key === 'equip');
    assert.equal(blockOf(ChessDetail({ chess: chess[WEARER], piece: two, editable: false, bonds: [], loadout: null, equipCap: 3 })).props.micro, 'EQUIP 2/3');
    assert.equal(blockOf(ChessDetail({ chess: chess[WEARER], piece: two, editable: false, bonds: [], loadout: null })).props.micro, 'EQUIP 2/2', 'default stays the data\'s 2');
    const empty = blockOf(ChessDetail({ chess: chess[WEARER], piece: carrier([]), editable: false, bonds: [], loadout: null, equipCap: 3 }));
    assert.match(textOf(empty), /最多 3 件/);
    const card = ItemDetail({ item: items[MACE], piece: null, editable: false, onDestroy() {}, offBonds: null, equipCap: 3 });
    assert.match(textOf(card), /每名干员最多 3 件/);
    const card2 = ItemDetail({ item: items[MACE], piece: null, editable: false, onDestroy() {}, offBonds: null });
    assert.match(textOf(card2), /每名干员最多 2 件/);
  });
});
