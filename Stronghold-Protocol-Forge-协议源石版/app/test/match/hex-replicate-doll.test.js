// 业主 2026-10-25 的两张卡：
//   玩偶批发商 — 「在获得时，获得一个玩偶」 (was: one every round start)
//   复制 (2阶/gold) — 「随机复制一个拥有协议源石，自身消失」
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeMatch } from './harness.js';
import { applyHex } from '../../server/match/hextech.js';

const DOLLS = ['chess_item_2_05_e_a', 'chess_item_2_07_e_a'];

function prep(seed = 9001) {
  const h = makeMatch({ mode: 'solo', difficulty: 'FUNNY', seed, fake: true }).start();
  h.toPrep(1);
  return { h, m: h.m, ps: h.ps('p_0') };
}
const itemsInHand = (ps) => {
  const out = [];
  for (const p of ps.hand || []) if (p && p.kind === 'item') out.push(p.id);
  for (const p of ps.temp || []) if (p && p.kind === 'item') out.push(p.id);
  return out;
};
const hexesOwned = (ps) => (ps.effects || [])
  .filter((e) => e && typeof e.key === 'string' && e.key.startsWith('hex:'))
  .map((e) => (e.data && e.data.hexId) || e.key.slice(4));

// ---------------------------------------------------------------------------------------------------------------
// 玩偶批发商

test('玩偶批发商: ONE doll on gain, and nothing per round afterwards', () => {
  const { h, m, ps } = prep();
  assert.deepEqual(m.gd.hex('hex_dollwholesale').effect.onPick.randomItem.ids, DOLLS, 'the card grants one of the two dolls on pick');
  assert.equal(m.gd.hex('hex_dollwholesale').effect.onRoundStart, undefined, 'and no longer every round');

  const before = itemsInHand(ps).filter((id) => DOLLS.includes(id)).length;
  applyHex(m, ps, m.gd.hex('hex_dollwholesale'));
  const afterPick = itemsInHand(ps).filter((id) => DOLLS.includes(id)).length;
  assert.equal(afterPick - before, 1, 'exactly one doll on gain');

  // a round later: still exactly one (no drip)
  h.toPrep(2);
  assert.equal(itemsInHand(ps).filter((id) => DOLLS.includes(id)).length, afterPick, 'no extra doll at the round start');
  h.invariants();
  m.dispose();
});

// ---------------------------------------------------------------------------------------------------------------
// 复制

test('复制: duplicates ONE random owned card, then removes itself', () => {
  const { h, m, ps } = prep(9002);
  // own a few cards first so there is something to copy (and so 复制 is not alone)
  for (const id of ['hex_stipend', 'hex_echo', 'hex_armor']) applyHex(m, ps, m.gd.hex(id));
  const ownedBefore = hexesOwned(ps).filter((id) => id !== 'hex_replicate');
  assert.ok(ownedBefore.length >= 3, `premise: owns ${ownedBefore.length} cards`);

  applyHex(m, ps, m.gd.hex('hex_replicate'));

  // 1) 自身消失 — no ref whose key is 复制 survives
  const selfRefs = (ps.effects || []).filter((e) => e && e.key === 'hex:hex_replicate');
  assert.equal(selfRefs.length, 0, '复制 removed itself');
  assert.ok(!hexesOwned(ps).includes('hex_replicate'), 'and it is not in the collection any more');

  // 2) exactly one card gained a SECOND ref (a copy shares the original's `key`, its id gets `#<n>`)
  const copies = (ps.effects || []).filter((e) => e && typeof e.id === 'string' && e.id.includes('#'));
  const hexCopies = copies.filter((e) => e.key.startsWith('hex:'));
  assert.equal(hexCopies.length, 1, `exactly one copied card (saw ${hexCopies.map((e) => e.id).join(',')})`);
  const copiedId = (hexCopies[0].data && hexCopies[0].data.hexId) || hexCopies[0].key.slice(4);
  assert.ok(ownedBefore.includes(copiedId), `the copy is one of the cards I owned (${copiedId})`);
  assert.notEqual(copiedId, 'hex_replicate', 'and never 复制 itself');

  // 3) the copy is the SAME card: its key matches the original's ref
  assert.equal(hexCopies[0].key, `hex:${copiedId}`, 'the copy keeps the card key so every hook settles twice');
  h.invariants();
  m.dispose();
});

test('复制: with nothing else owned it just vanishes (no crash, no copy)', () => {
  const { h, m, ps } = prep(9003);
  // strip whatever the match started us with, so 复制 is the only card
  ps.effects = (ps.effects || []).filter((e) => !(e && typeof e.key === 'string' && e.key.startsWith('hex:')));
  applyHex(m, ps, m.gd.hex('hex_replicate'));
  assert.equal((ps.effects || []).filter((e) => e && e.key === 'hex:hex_replicate').length, 0, 'it still removes itself');
  assert.equal((ps.effects || []).filter((e) => e && String(e.id).includes('#')).length, 0, 'and copies nothing');
  h.invariants();
  m.dispose();
});

test('复制 is a 2阶 (gold) card in the roster', () => {
  const { m } = prep(9004);
  const rec = m.gd.hex('hex_replicate');
  assert.ok(rec, 'the card exists');
  assert.equal(rec.rarity, 'gold', '2阶');
  assert.equal(rec.effect.onPick.copyOwnedHex, true, 'carries the new primitive');
  m.dispose();
});
