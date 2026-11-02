// test/match/hex-recycle.test.js — 第 6 回合的「点卡刷新」(业主 2026-10-30「在第6回合玩家可以舍弃1-2个协议源石随机获得
// 相同数量的协议源石」，2026-10-31「把有的协议源石放上去，点哪张刷哪张」「选完协议源石，这面板直接出现」)。
//
// 口径：第 6 回合的三选一照常，**选完就能换**（抽卡阶段 `picks` 已落下、或进了休整期），每局共 2 张（点一次花一次）；
// 换回的牌按 1/2/3 阶抽取权重完全随机，不会再是刚换掉的那张；已经发出去的一次性收益（资金 / 部署位 / 装备）不回收。
//
// 规则实现在 `server/match/match/hexDraft.js recycleHex` / `_hexRecycleGate`，意图 `g.hexRecycle { ids }` 在
// shared/protocol.js，余数写在 `m.public.players[]` 的 `hexRecycleLeft`（只在第 6 回合的帧里）。

import test from 'node:test';
import assert from 'node:assert/strict';
import { makeMatch } from './harness.js';
import { hexIdsOf, applyBandHexCopy } from '../../server/match/hextech.js';
import { HEX_RECYCLE_BUDGET } from '../../shared/hextech.js';

/** Drive the match to the prep phase of `round`. */
function toPrep(h, round) {
  const ok = h.drive(() => h.ended != null || (h.m.phase === 'PREP' && h.m.round === round));
  assert.ok(ok && h.m.phase === 'PREP' && h.m.round === round, `expected PREP R${round}, got ${h.m.phase} R${h.m.round}`);
  return h;
}

/** Drive to the 协议源石 draft of `round`. */
function toHexDraft(h, round) {
  const ok = h.drive(() => h.ended != null || (h.m.phase === 'HEX_DRAFT' && h.m.round === round));
  assert.ok(ok && h.m.phase === 'HEX_DRAFT' && h.m.round === round, `expected HEX_DRAFT R${round}, got ${h.m.phase} R${h.m.round}`);
  return h;
}

/** The `hex:<id>` EffectRefs a player owns (copies included — 复制 writes `hex:<id>#<n>`). */
function hexRefs(ps) {
  return (ps.effects || []).filter((e) => e && typeof e.key === 'string' && e.key.startsWith('hex:'));
}

/** The public row of one seat (what the client's panel reads). */
function rowOf(m, pid) {
  return m.publicView().players.find((p) => p && p.playerId === pid);
}

/**
 * 策略「管理员」的复制（`applyBandHexCopy`）要读玩家自己的 `band_hex_copy_once` buff；本用例只钉复制**机制**，所以给这个
 * 座位把 buff 挂上（与 test/match/hextech.test.js 的 armCopyBuff 同一条 fixture）。
 */
function armCopyBuff(h, ps) {
  const real = h.m.gd.band(ps.bandId);
  h.m.gd.band = (id) => (id === ps.bandId
    ? { ...(real || {}), bandId: ps.bandId, buffs: [{ key: 'band_hex_copy_once', bb: { count: 1 }, bbStr: {} }] }
    : real);
}

test('选完协议源石就能换：抽卡阶段里点一张换一张，抽卡的 offer / picks 一个字节都不动', () => {
  const h = makeMatch({ mode: 'solo', difficulty: 'NORMAL', humans: 1, seed: 71, fake: true });
  h.start();
  toHexDraft(h, 6);
  const m = h.m;
  const ps = h.ps('p_0');
  const ownedBefore = hexIdsOf(ps);
  // 抽卡阶段里本回合那张还没落袋：此刻拥有的是 R1 / R3 的两张
  assert.ok(ownedBefore.length >= 2, `owns the R1 / R3 cards (${ownedBefore.join(', ')})`);

  // 还没选：面板不该出现，服务端也不受理
  const early = m.handle('p_0', { t: 'g.hexRecycle', ids: [ownedBefore[0]] });
  assert.equal(early.error, 'WRONG_PHASE');
  assert.equal(early.detail, 'pick first');

  // 选一张 —— 抽卡本身照常
  const offerBefore = m.hexOfferOf('p_0').slice();
  assert.deepEqual(m.handle('p_0', { t: 'g.hex', idx: 0 }), { ok: true });
  const picked = offerBefore[0];
  assert.equal(m.hex.picks.p_0, 0, 'picks 照旧');
  assert.deepEqual(m.hexOfferOf('p_0'), offerBefore, 'offer 照旧');
  assert.equal(rowOf(m, 'p_0').hexRecycleLeft, HEX_RECYCLE_BUDGET, '第 6 回合的帧里带剩余次数');
  // 没有重复的卡 ⇒ 行上不带 hexRefs（帧与从前逐字节一致，业主 2026-11-02 那条只加在有重复的时候）
  assert.equal('hexRefs' in rowOf(m, 'p_0'), false, '没有同名的两张就不写这个键');

  // 换掉刚选的那张：换回来一张新牌
  assert.deepEqual(m.handle('p_0', { t: 'g.hexRecycle', ids: [picked] }), { ok: true });
  assert.equal(ps.hexRecycleLeft, HEX_RECYCLE_BUDGET - 1);
  assert.equal(hexRefs(ps).some((e) => e.data && e.data.hexId === picked), false, '被换掉那张的 ref 已经摘掉');
  assert.equal(hexIdsOf(ps).includes(picked), false);
  assert.equal(m.hex.picks.p_0, 0, '换牌不改 picks');
  assert.deepEqual(m.hexOfferOf('p_0'), offerBefore, '换牌不改 offer');
  // 第 6 回合的帧里余数立刻跟着走（客户端的「剩 n 次」读它）
  assert.equal(rowOf(m, 'p_0').hexRecycleLeft, HEX_RECYCLE_BUDGET - 1);

  // 第二次：再换一张（每局共 2 张）
  const second = hexIdsOf(ps)[0];
  assert.deepEqual(m.handle('p_0', { t: 'g.hexRecycle', ids: [second] }), { ok: true });
  assert.equal(ps.hexRecycleLeft, 0);
  // 第三次：ALREADY
  assert.equal(m.handle('p_0', { t: 'g.hexRecycle', ids: [hexIdsOf(ps)[0]] }).error, 'ALREADY');

  toPrep(h, 6);
  assert.equal(rowOf(m, 'p_0').hexRecycleLeft, 0, '进了休整期还是 0（这一局用完了）');
  h.invariants();
  m.dispose();
});

test('休整期里也能换，而且可以一次换 2 张（每局共 2 张）', () => {
  const h = makeMatch({ mode: 'solo', difficulty: 'NORMAL', humans: 1, seed: 72, fake: true });
  h.start();
  toPrep(h, 6);
  const m = h.m;
  const ps = h.ps('p_0');
  const before = hexIdsOf(ps);
  assert.ok(before.length >= 3, `owns the drafted cards (${before.join(', ')})`);
  assert.equal(rowOf(m, 'p_0').hexRecycleLeft, HEX_RECYCLE_BUDGET);

  const drop = before.slice(0, 2);
  assert.deepEqual(m.handle('p_0', { t: 'g.hexRecycle', ids: drop }), { ok: true });
  assert.equal(ps.hexRecycleLeft, 0);
  const after = hexIdsOf(ps);
  assert.deepEqual(after.filter((id) => drop.includes(id)), [], '两张都摘掉了');
  const fresh = after.filter((id) => !before.includes(id));
  // `>= 2` 而不是 `=== 2`：换回的卡本身可能再发牌（二次抽取 / 镜像协议），那是那张卡的效果，不是这次交换多发。
  assert.ok(fresh.length >= 2, `两张都换回了新卡（新 ${fresh.join(', ')}）`);
  assert.equal(rowOf(m, 'p_0').hexRecycleLeft, 0);
  h.invariants();
  m.dispose();
});

test('同名的两张协议源石就是两张：点一次只走一张、只换回一张', () => {
  const h = makeMatch({ mode: 'solo', difficulty: 'NORMAL', humans: 1, seed: 78, fake: true });
  h.start();
  toPrep(h, 6);
  const m = h.m;
  const ps = h.ps('p_0');
  // 造出「同一张卡的两个 ref」：正常拿一张，再走复制（第二个 ref `hex:<id>#2`）
  const card = 'hex_stipend';
  assert.ok(m.grantHex(ps, card), '先正常拿到一张');
  armCopyBuff(h, ps);
  assert.equal(applyBandHexCopy(m, ps, m.gd.hex(card)), 1, '复制出第二个 ref');
  const refsOf = (id) => hexRefs(ps).filter((e) => e.data && e.data.hexId === id);
  assert.deepEqual(refsOf(card).map((e) => e.id).sort(), [`hex:${card}`, `hex:${card}#2`], '两个 ref、同一张卡');
  assert.equal(hexIdsOf(ps).filter((id) => id === card).length, 1, 'hexIdsOf 依旧去重（别的读者读的是拥有列表）');
  // 视图：hexes 不变，hexRefs 里同 id 出现两次（客户端的刷新面板靠它铺两个槽）
  const row = rowOf(m, 'p_0');
  assert.deepEqual(row.hexes.filter((id) => id === card), [card], 'hexes 不变');
  assert.deepEqual(row.hexRefs.filter((id) => id === card), [card, card], 'hexRefs 里同 id 出现两次');
  assert.deepEqual(row.hexRefs, hexRefs(ps).map((e) => e.data.hexId), '展开顺序 = ps.effects 顺序');
  // 点一次：只掉一个 ref、还留一张同名卡、只换回一张、次数只 −1
  const left0 = ps.hexRecycleLeft;
  const ownedBefore = hexIdsOf(ps);
  assert.deepEqual(m.handle('p_0', { t: 'g.hexRecycle', ids: [card] }), { ok: true });
  assert.equal(ps.hexRecycleLeft, left0 - 1, '只花一次次数');
  assert.equal(refsOf(card).length, 1, '只摘掉一个 ref（以前两个一起没）');
  assert.ok(hexIdsOf(ps).includes(card), '同名卡还剩一张');
  const fresh = hexIdsOf(ps).filter((id) => !ownedBefore.includes(id));
  assert.ok(fresh.length >= 1, `换回一张新卡（新 ${fresh.join(', ')}）`);
  const refIdsAfter = hexRefs(ps).map((e) => e.data.hexId);
  const stillDup = refIdsAfter.length > new Set(refIdsAfter).size;
  assert.equal('hexRefs' in rowOf(m, 'p_0'), stillDup, '键的取舍只看「还有没有同名的两张」');
  // 再点一次：剩下的那张同名卡才跟着走
  assert.deepEqual(m.handle('p_0', { t: 'g.hexRecycle', ids: [card] }), { ok: true });
  assert.equal(refsOf(card).length, 0, '第二下才摘掉剩下的那个 ref');
  assert.equal(hexIdsOf(ps).includes(card), false);
  assert.equal(ps.hexRecycleLeft, 0);
  h.invariants();
  m.dispose();
});

test('剩余次数只在第 6 回合的帧里出现（其它回合逐字节不变）', () => {
  const h = makeMatch({ mode: 'solo', difficulty: 'NORMAL', humans: 1, seed: 73, fake: true });
  h.start();
  toPrep(h, 1);
  const m = h.m;
  assert.equal(rowOf(m, 'p_0').hexRecycleLeft, undefined, '第 1 回合不带这个键');
  h.invariants();
  m.dispose();
});

test('拒绝：回合 / 阶段 / 已准备 / 张数超过余量 / 不是自己的 / 池子凑不出同样数量', () => {
  const h = makeMatch({ mode: 'solo', difficulty: 'NORMAL', humans: 1, seed: 74, fake: true });
  h.start();
  const m = h.m;
  const ps = h.ps('p_0');

  // R1 的休整期：回合不对
  toPrep(h, 1);
  const r1 = m.handle('p_0', { t: 'g.hexRecycle', ids: [hexIdsOf(ps)[0]] });
  assert.equal(r1.error, 'WRONG_PHASE');
  assert.equal(r1.detail, 'round 6');

  toPrep(h, 6);
  const owned = hexIdsOf(ps);
  assert.ok(owned.length >= 3);
  // 数量：0 张 / 3 张都不行
  assert.equal(m.handle('p_0', { t: 'g.hexRecycle', ids: [] }).error, 'BAD_TARGET');
  assert.equal(m.handle('p_0', { t: 'g.hexRecycle', ids: owned.slice(0, 3) }).error, 'BAD_TARGET');
  // 不是自己的牌
  assert.equal(m.handle('p_0', { t: 'g.hexRecycle', ids: ['hex_not_owned'] }).error, 'BAD_TARGET');
  // 张数超过余量：先用掉 1 张，再想一次换 2 张
  assert.deepEqual(m.handle('p_0', { t: 'g.hexRecycle', ids: [owned[0]] }), { ok: true });
  assert.equal(ps.hexRecycleLeft, 1);
  const over = m.handle('p_0', { t: 'g.hexRecycle', ids: [hexIdsOf(ps)[0], hexIdsOf(ps)[1]] });
  assert.equal(over.error, 'BAD_TARGET');
  assert.equal(over.detail, 'budget');
  assert.equal(ps.hexRecycleLeft, 1, '被拒绝的请求不扣次数');

  // 池子凑不出「同样数量」的替代牌：直接拒绝，一张牌都不动、次数也不扣
  const ownedNow = hexIdsOf(ps);
  const realPoolFor = m._hexPoolFor.bind(m);
  m._hexPoolFor = () => m.gd.hexPlayerPool().filter((rec) => ownedNow.includes(rec.id));
  const exhausted = m.handle('p_0', { t: 'g.hexRecycle', ids: [ownedNow[0]] });
  assert.equal(exhausted.error, 'BAD_TARGET');
  assert.equal(exhausted.detail, 'pool exhausted');
  m._hexPoolFor = realPoolFor;
  assert.equal(ps.hexRecycleLeft, 1);
  assert.deepEqual(hexIdsOf(ps), ownedNow, '被拒绝的请求一张牌都不动');

  // 已准备之后不能再改牌（与其它备战期动作同一条闸门）
  assert.deepEqual(m.handle('p_0', { t: 'g.ready', ready: true }), { ok: true });
  const ready = m.handle('p_0', { t: 'g.hexRecycle', ids: [ownedNow[0]] });
  assert.equal(ready.error, 'WRONG_PHASE');
  assert.equal(ready.detail, 'ready');
  h.invariants();
  m.dispose();
});

test('换牌不回收已经给过的一次性收益（与 g.testHexClear 同一条口径）', () => {
  const h = makeMatch({ mode: 'solo', difficulty: 'NORMAL', humans: 1, seed: 75, fake: true });
  h.start();
  toPrep(h, 6);
  const m = h.m;
  const ps = h.ps('p_0');
  // 战备津贴 `onPick.funds: 3`：发牌那一刻就把钱给了；换牌只摘持续 ref
  const fundsBefore = ps.funds;
  assert.ok(m.grantHex(ps, 'hex_stipend'));
  const fundsAfterGrant = ps.funds;
  assert.ok(fundsAfterGrant >= fundsBefore, '发牌时确实给了钱');
  assert.deepEqual(m.handle('p_0', { t: 'g.hexRecycle', ids: ['hex_stipend'] }), { ok: true });
  assert.equal(hexRefs(ps).some((e) => e.data && e.data.hexId === 'hex_stipend'), false, '持续 ref 没了');
  assert.equal(ps.funds, fundsAfterGrant, '已经到手的钱不回收');
  h.invariants();
  m.dispose();
});

test('确定性：同一个种子下，换同一张换回同一张（走本局的 rngHex）', () => {
  const run = () => {
    const h = makeMatch({ mode: 'solo', difficulty: 'NORMAL', humans: 1, seed: 76, fake: true });
    h.start();
    toPrep(h, 6);
    const m = h.m;
    const ps = h.ps('p_0');
    const drop = hexIdsOf(ps)[0];
    assert.deepEqual(m.handle('p_0', { t: 'g.hexRecycle', ids: [drop] }), { ok: true });
    const after = hexIdsOf(ps).filter((id) => id !== drop);
    m.dispose();
    return { drop, after };
  };
  const a = run();
  const b = run();
  assert.equal(a.drop, b.drop, '两次的牌面本身相同');
  assert.deepEqual(a.after, b.after, '同种子 ⇒ 换回的牌相同');
});
