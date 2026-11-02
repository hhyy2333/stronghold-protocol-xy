// 业主 2026-10-25 的两张卡：
//   玩偶批发商 — 「在获得时，获得一个玩偶」 (was: one every round start)
//   复制 (2阶/gold) — 「随机复制一个拥有协议源石，自身消失」；业主 2026-11-01「加个第一个时保留效果」：
//   手上还没有别的协议源石可复制时它**不消失**，留到下一次获得协议源石时复制**那一枚**再消失。
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

// 玩偶批发商 (业主 2026-10-25「增加每回合获得一个」): the 获得时 half stays, and the per-round half is back on top of
// it — one on pick, then one at every round start.
test('玩偶批发商: one doll on gain, then one at every round start', () => {
  const { h, m, ps } = prep();
  const card = m.gd.hex('hex_dollwholesale');
  assert.deepEqual(card.effect.onPick.randomItem.ids, DOLLS, 'the card grants one of the two dolls on pick');
  assert.deepEqual(card.effect.onRoundStart.randomItem.ids, DOLLS, 'and another one every round start');

  const before = itemsInHand(ps).filter((id) => DOLLS.includes(id)).length;
  applyHex(m, ps, card);
  const afterPick = itemsInHand(ps).filter((id) => DOLLS.includes(id)).length;
  assert.equal(afterPick - before, 1, 'exactly one doll on gain');

  // a round later: one more (the drip is intentional now)
  h.toPrep(2);
  assert.equal(itemsInHand(ps).filter((id) => DOLLS.includes(id)).length, afterPick + 1, 'one more doll at the round start');
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

test('复制 (业主 2026-11-01「第一个时保留效果」): 手上没有别的协议源石时**不消失**，留到下一枚再复制它', () => {
  const { h, m, ps } = prep(9003);
  // strip whatever the match started us with, so 复制 is the only card
  ps.effects = (ps.effects || []).filter((e) => !(e && typeof e.key === 'string' && e.key.startsWith('hex:')));
  const selfRefs = () => (ps.effects || []).filter((e) => e && e.key === 'hex:hex_replicate');
  const copies = () => (ps.effects || []).filter((e) => e && String(e.id).includes('#') && e.key.startsWith('hex:'));

  applyHex(m, ps, m.gd.hex('hex_replicate'));
  assert.equal(selfRefs().length, 1, '没得复制 ⇒ 复制不消失，留在收藏里等');
  assert.ok(hexesOwned(ps).includes('hex_replicate'), '收藏里仍然有它');
  assert.equal(copies().length, 0, '这一拍什么都不复制');

  // 下一枚协议源石到手 ⇒ 复制**那一枚**，然后【复制】才消失
  applyHex(m, ps, m.gd.hex('hex_armor'));
  assert.equal(selfRefs().length, 0, '兑现后【复制】消失');
  assert.ok(!hexesOwned(ps).includes('hex_replicate'), '收藏里也不再有它');
  assert.equal(copies().length, 1, 'exactly one copy);'.slice(0, 0) + '复制了一份');
  assert.equal(copies()[0].data.hexId, 'hex_armor', '复制的是刚到手的那一枚（不是随机挑）');
  h.invariants();
  m.dispose();
});

test('复制: 再拿一枚【复制】不会叠出第二个 ref（addHexRef 去重），留着的这枚下次获得只兑现一次', () => {
  const { h, m, ps } = prep(9005);
  ps.effects = (ps.effects || []).filter((e) => !(e && typeof e.key === 'string' && e.key.startsWith('hex:')));
  const selfRefs = () => (ps.effects || []).filter((e) => e && e.key === 'hex:hex_replicate');
  const copies = () => (ps.effects || []).filter((e) => e && String(e.id).includes('#') && e.key.startsWith('hex:'));

  applyHex(m, ps, m.gd.hex('hex_replicate'));
  applyHex(m, ps, m.gd.hex('hex_replicate'));
  assert.equal(selfRefs().length, 1, '同一张卡每个玩家只有一个 ref（引擎 addHexRef 的去重），不会叠成两枚');
  assert.equal(copies().length, 0, '不自我复制');

  applyHex(m, ps, m.gd.hex('hex_echo'));
  assert.equal(copies().length, 1, '兑现一次：就一张');
  assert.equal(copies()[0].data.hexId, 'hex_echo', '复制的是刚到手的那一枚');
  assert.equal(selfRefs().length, 0, '兑现后消失');
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
