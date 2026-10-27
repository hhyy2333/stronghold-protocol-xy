// 百变 (锻炉) 离开干员之后仍然写得出「是哪两件」（业主 2026-10-27：「『锻炉』的百变取下来后看不到是哪两个装备」）。
//
// 症状：干员身上的两件装备融成百变之后，把干员卖掉（装备回到整备区，仍是那一件百变），再点开它 —— 道具卡只有
// 百变自己的通用文本，没有「【锻炉】融合的两件装备：」那一段。
//
// 根因：`merged` 只跟着**干员身上那一行**（player/views.js pieceView 的 `items[]`）发出去；百变自己作为一件
// **道具片**回到整备区时，它的 view 里没有 `merged`，而道具卡读的正是 `piece.merged`（detailPanel ItemDetail →
// FusedFrom）⇒ 客户端拿到 `undefined`，`FusedFrom` 什么都不画。
//
// 这里走的是**真正的那条路**：真一局 match → 融合 → 卖干员 → `m.private` 的整备区 → resolveDetail → 道具卡。
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

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
const { resolveDetail, ItemDetail } = await import('../../public/js/ui/detailPanel.js');
const { indexPieces } = await import('../../public/js/ui/gameLogic/placement.js');
const { makeMatch, give, giveItem, chessOfTier, legalTileFor } = await import('../match/harness.js');
const { applyHex, FORGE_ITEM_ID } = await import('../../server/match/hextech.js');

const HAMMER = 'chess_item_1_01_e_a';   // 维式重锤
const SHIELD = 'chess_item_1_02_e_a';   // 坚守盾牌

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

/** A started solo match at the prep of round 1. */
function solo1(seed) {
  const h = makeMatch({ mode: 'solo', difficulty: 'NORMAL', humans: 1, bots: 0, seed, fake: true });
  h.start();
  const ok = h.drive(() => h.ended != null || (h.m.phase === 'PREP' && h.m.round === 1));
  assert.ok(ok && h.m.phase === 'PREP' && h.m.round === 1, 'expected PREP R1');
  return { h, m: h.m, ps: h.ps('p_0') };
}

describe('百变 (锻炉): off the operator, the item card still names its two components', () => {
  test('a sold carrier returns the 百变 to the reserve, and its card names 维式重锤 + 坚守盾牌', () => {
    const { h, m, ps } = solo1(157);
    applyHex(m, ps, m.gd.hex('hex_forge'));
    const chessId = chessOfTier(1)[0];
    const tile = legalTileFor(m, ps, chessId);
    assert.ok(tile, 'a legal tile (premise)');
    const piece = give(m, ps, chessId, 'board', tile);
    assert.deepEqual(ps.equip(giveItem(m, ps, HAMMER).uid, piece.uid), { ok: true });
    assert.deepEqual(ps.equip(giveItem(m, ps, SHIELD).uid, piece.uid), { ok: true });
    const fused = piece.items[0];
    assert.equal(fused.id, FORGE_ITEM_ID, 'premise: the two fused into 百变');
    // 「取下来」：卖掉干员，装备回到整备区（还是那一件百变）
    assert.deepEqual(ps.sell(piece.uid), { ok: true });
    const priv = ps.privateView();
    const pieces = indexPieces(priv);
    const loc = pieces.get(fused.uid);
    assert.ok(loc && loc.piece.kind === 'item' && loc.piece.id === FORGE_ITEM_ID, 'the 百变 is a reserve piece now');
    // what the player's tap resolves to (game.js pieceClick → { kind: 'piece', uid })
    const detail = resolveDetail({ kind: 'piece', uid: fused.uid }, pieces, { priv });
    assert.equal(detail.type, 'item');
    assert.deepEqual(detail.piece.merged, [HAMMER, SHIELD], 'the card is handed the two component ids');
    const body = textOf(ItemDetail({ item: detail.item, piece: detail.piece, editable: true, onDestroy() {}, offBonds: null }));
    assert.match(body, /【锻炉】融合的两件装备：/);
    assert.match(body, /维式重锤/, 'component A by name');
    assert.match(body, /坚守盾牌/, 'component B by name');
    h.invariants();
    m.dispose();
  });

  test('a plain item in the reserve gains no such line (the card is unchanged)', () => {
    const { h, m, ps } = solo1(158);
    const plain = giveItem(m, ps, HAMMER);
    const priv = ps.privateView();
    const pieces = indexPieces(priv);
    const detail = resolveDetail({ kind: 'piece', uid: plain.uid }, pieces, { priv });
    assert.equal(detail.type, 'item');
    assert.equal(detail.piece.merged, undefined, 'no merged on an ordinary piece');
    const body = textOf(ItemDetail({ item: detail.item, piece: detail.piece, editable: true, onDestroy() {}, offBonds: null }));
    assert.doesNotMatch(body, /融合的两件装备/);
    h.invariants();
    m.dispose();
  });
});
