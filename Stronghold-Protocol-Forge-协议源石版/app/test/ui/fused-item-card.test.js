// 百变 (锻炉) 的卡片要写出「由哪两件装备融合」（业主 2026-10-24「我希望百变的描述里有由哪两个装备融合」）。
//
// 百变是**一件共享记录**（data/items.json `chess_item_9_97_e_a`）：它的 `desc` 不可能写出合成它的那两件 —— 每一件百变
// 吃的都是不同的两件。两个 id 在**棋子**上（`merged: [idA, idB]`，server/match/hextech.js applyForgeFusion →
// player/views.js pieceView），所以卡片从那里读：detailPanel 的 `FusedFrom` 把两件装备的名字与**各自的效果文本**列在
// 百变的效果下面 —— 「百变的效果是两件装备的效果」这句话因此就写在玩家读它的地方。
//
// 这里钉的是**用户看到的那三处**：干员卡的装备行、点开百变时的道具卡、以及「没有 merged」（图鉴 / 商店，一件没有合成
// 过的百变记录）时不多画任何东西。
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

const { data } = await import('../../public/js/data.js');
await data.loadAll('bonds', 'chess', 'items', 'assets', 'garrisons', 'config');
const { ChessDetail, ItemDetail, FusedFrom } = await import('../../public/js/ui/detailPanel.js');

const items = load('items.json');
const chess = load('chess.json');
const WEARER = 'chess_char_1_01_a';       // 隐现 — any chess with the 装备 section
const HAMMER = 'chess_item_1_01_e_a';     // 维式重锤 (+15% 攻击力)
const SHIELD = 'chess_item_1_02_e_a';     // 坚守盾牌 (+20% 防御力)
const FUSED = 'chess_item_9_97_e_a';      // 百变

/** The text of a vnode tree; the panel's own hook-free components are expanded (RichText stays unexpanded). */
const EXPAND = new Set(['Section', 'ItemRow', 'MorphPairings', 'MorphGrantLine', 'FusedFrom']);
const textOf = (v) => {
  if (v == null || typeof v === 'boolean') return '';
  if (typeof v === 'string' || typeof v === 'number') return String(v);
  if (Array.isArray(v)) return v.map(textOf).join('');
  if (typeof v.type === 'function' && EXPAND.has(v.type.name)) return textOf(v.type(v.props));
  if (typeof v.type === 'function' && v.type.name === 'RichText') return String(v.props.text || '');
  return textOf(v.props?.children);
};
/** Every vnode of a tree, depth first — expanding the panel's own hook-free components like `textOf` does. */
function* walk(v) {
  if (Array.isArray(v)) { for (const x of v) yield* walk(x); return; }
  if (!v || typeof v !== 'object') return;
  yield v;
  if (typeof v.type === 'function' && EXPAND.has(v.type.name)) { yield* walk(v.type(v.props)); return; }
  yield* walk(v.props?.children);
}

const carrier = (carried) => ({ uid: 9, kind: 'chess', id: WEARER, golden: false, tier: 1, items: carried });
const fusedPiece = (merged) => ({ uid: 21, kind: 'item', id: FUSED, ...(merged ? { merged } : null) });
const equipBlock = (piece) => ChessDetail({ chess: chess[WEARER], piece, editable: false, bonds: [], loadout: null }).find((b) => b?.key === 'equip');

describe('百变 (锻炉): the card names the two items it fused', () => {
  test('the operator card\'s 装备 row lists both components by name, with their own effect texts', () => {
    const body = textOf(equipBlock(carrier([fusedPiece([HAMMER, SHIELD])])));
    assert.match(body, /百变/, 'the fused item itself is still the row');
    assert.match(body, /【锻炉】融合的两件装备/, 'the lead line says where the two came from');
    assert.match(body, /维式重锤/, 'component A by name');
    assert.match(body, /坚守盾牌/, 'component B by name');
    assert.match(body, /攻击力<@ba\.vup>\+15%<\/>/, 'and its own effect, so 「两件装备的效果」 is readable on the 百变');
    assert.match(body, /防御力<@ba\.vup>\+20%<\/>/, 'likewise the second');
  });

  test('the item card of the fused piece names them too, under its own effect', () => {
    const body = textOf(ItemDetail({ item: items[FUSED], piece: fusedPiece([HAMMER, SHIELD]), editable: false, onDestroy() {}, offBonds: null }));
    assert.match(body, /【锻炉】融合的两件装备：/);
    assert.ok(body.indexOf('【锻炉】融合的两件装备：') > body.indexOf('不会再被融合'), 'after the 百变 text, as its detail');
    assert.match(body, /维式重锤/);
    assert.match(body, /坚守盾牌/);
  });

  test('without a `merged` (the codex / a shop card / the record alone) the card is unchanged', () => {
    assert.equal(FusedFrom({ merged: null }), null);
    assert.equal(FusedFrom({}), null);
    assert.equal(FusedFrom({ merged: [] }), null);
    assert.equal(FusedFrom({ merged: [HAMMER] }), null, 'one id is not a fusion');
    assert.equal(FusedFrom({ merged: [HAMMER, null] }), null, 'a bad entry is not printed either');
    const plain = textOf(equipBlock(carrier([{ uid: 22, id: HAMMER }])));
    assert.doesNotMatch(plain, /融合的两件装备/, 'an ordinary item gains no line');
    const codex = textOf(ItemDetail({ item: items[FUSED], piece: null, editable: false, onDestroy() {}, offBonds: null }));
    assert.doesNotMatch(codex, /融合的两件装备/);
    assert.match(codex, /不会再被融合/, 'the record\'s own text is still the card');
  });

  test('the two components are marked with their ids (what a page / test can key on)', () => {
    const rows = [...walk(equipBlock(carrier([fusedPiece([HAMMER, SHIELD])])))].filter((v) => v.props?.['data-item']);
    assert.deepEqual(rows.map((v) => v.props['data-item']), [HAMMER, SHIELD]);
    const box = [...walk(equipBlock(carrier([fusedPiece([HAMMER, SHIELD])])))].find((v) => v.props?.['data-fused']);
    assert.equal(box.props['data-fused'], `${HAMMER}|${SHIELD}`);
  });

  test('a hand-edited / older payload cannot break the card: merged is read defensively', () => {
    // an unknown id (a pack's item that this client has no record for): the row still names it by id
    const body = textOf(equipBlock(carrier([fusedPiece([HAMMER, 'chess_item_pack_only'])])));
    assert.match(body, /chess_item_pack_only/);
    // not an array at all (a corrupt frame) — no crash, no line
    assert.equal(FusedFrom({ merged: 'chess_item_1_01_e_a' }), null);
  });
});
