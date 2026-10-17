// test/match/draft-many-players.test.js — 7 人以上的房：机变草稿的第 7 张卡必须真的能选。
//
// 业主 2026-10-17：「超过6个人的时候前6个以外的悬赏选不了，说无效的请求」。
//
// 根因是**两层各写了一份卡数**：
//   * 服务端 2026-10-16 已经改成 `generateDraft` 按 max(6, 存活人数) 铺牌（choices.js），7 人房的第 7 张卡 idx = 6；
//   * 但 `shared/protocol.js` 的 `g.choice` 还写着 `isInt(idx, 0, 5)`，于是 idx 6 在**协议校验**就被判
//     `ERR.BAD_MSG`（界面「无效的请求」），根本到不了 `pickCard` 的业务校验。
//
// 本文件钉住两件事：协议上界跟着 `DRAFT_CARDS_MAX` 走；7 人房从头到尾每人一张、且真的取到了 idx ≥ 6 的卡。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PHASE, DRAFT_CARDS_MAX } from '../../shared/constants.js';
import { validateC2S } from '../../shared/protocol.js';
import { makeMatch } from './harness.js';

test('协议层：g.choice.idx 的上界跟草稿卡数同源，不再是写死的 0..5', () => {
  for (let i = 0; i < DRAFT_CARDS_MAX; i++) {
    assert.equal(validateC2S({ t: 'g.choice', idx: i }), null, `idx ${i} 必须合法（草稿最多 ${DRAFT_CARDS_MAX} 张）`);
  }
  assert.equal(typeof validateC2S({ t: 'g.choice', idx: DRAFT_CARDS_MAX }), 'string', '越界仍要拒');
  assert.equal(typeof validateC2S({ t: 'g.choice', idx: -1 }), 'string', '负数仍要拒');
  // 教鞭的 personal choice 走同一个字段，也必须照旧能过
  assert.equal(validateC2S({ t: 'g.choice', idx: 2, choiceId: 'x.choice.1' }), null);
});

test('7 人房：草稿铺 7 张，每人一张，且 idx ≥ 6 的卡真的能选（业主 2026-10-17 的报错）', () => {
  const h = makeMatch({ mode: 'coop', difficulty: 'NORMAL', humans: 7, seed: 5, fake: true }).start();
  const m = h.m;
  h.drive(() => m.phase === PHASE.SP_DRAFT);
  assert.equal(m.phase, PHASE.SP_DRAFT, '到了机变阶段');
  assert.equal(m.sp.cards.length, 7, '7 人房铺 7 张（6 人及以下仍是官方那 6 张）');

  const picked = [];
  for (let guard = 0; guard < 40 && m.phase === PHASE.SP_DRAFT; guard++) {
    const pid = m.spTurn();
    if (!pid) break;
    const avail = m.sp.cards.map((c) => c.idx).filter((k) => m.sp.taken[k] == null);
    if (!avail.length) break;
    // 取**最后**一张可用的：这样一定会轮到 idx ≥ 6，正是从前会被判 BAD_MSG 的那些
    const idx = avail[avail.length - 1];
    assert.equal(validateC2S({ t: 'g.choice', idx }), null, `idx ${idx} 必须能过协议校验（从前这里回 BAD_MSG）`);
    assert.deepEqual(m.handle(pid, { t: 'g.choice', idx }), { ok: true }, `${pid} 取第 ${idx + 1} 张`);
    picked.push(idx);
  }
  assert.equal(picked.length, 7, '7 个人各取走一张');
  assert.ok(Math.max(...picked) >= 6, `确实取到了 idx ≥ 6 的卡（实际 ${picked.join(',')}）`);
  m.dispose();
});
