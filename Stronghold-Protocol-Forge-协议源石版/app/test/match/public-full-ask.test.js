// test/match/public-full-ask.test.js — `g.publicFull` 真的会补发「整份」状态。
//
// 业主 2026-10-21（玩家反馈「选悬赏 页面直接没了，只能看着场地发呆」）：这条请求是 DESIGN §8.2 的自愈路径，以前
// ① 根本没有 handler（回 BAD_MSG），② 就算有，旧的实现也只补 m.public —— 而 `_sendPrivate` 是按 `ps._lastPriv` 去重
// 的：一帧 m.private 没送到客户端之后，服务端认为它已经送过了，之后只要私有视图序列化结果相同就永远不再发。玩家于是
// 停在「看得见场地、没有任何可操作界面」的状态。
//
// 这一条钉住两件事：请求返回 OK，而且回答里同时有 m.public（全帧）与该玩家的 m.private。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeMatch } from './harness.js';
import { PHASE } from '../../shared/constants.js';

test('g.publicFull answers with a FULL m.public AND the asking player\'s own m.private', () => {
  const h = makeMatch({ mode: 'coop', difficulty: 'NORMAL', humans: 3, bots: 0, seed: 11, captureFrames: false });
  h.autoHumans();
  const m = h.m;
  h.start();
  h.run(() => (m.phase === PHASE.PREP && m.round >= 1) || h.ended != null, { maxSteps: 3e6 });
  assert.equal(m.phase, PHASE.PREP, 'premise: a live prep round');
  // what the client already has is irrelevant — the ask is answered fresh
  h.sent.length = 0;
  const res = m.handle('p_0', { t: 'g.publicFull' });
  assert.deepEqual(res, { ok: true }, 'the ask is accepted (it used to be BAD_MSG: no handler at all)');
  const frames = h.sent.filter(([id]) => id === 'p_0').map(([, msg]) => msg.t);
  assert.ok(frames.includes('m.public'), 'a full m.public came back, got ' + frames.join(','));
  assert.ok(frames.includes('m.private'), 'and the private view — the one the prep UI is built from, got ' + frames.join(','));
  const priv = h.sent.find(([, msg]) => msg.t === 'm.private')[1];
  assert.equal(priv.playerId, 'p_0');
  assert.ok('shop' in priv || 'board' in priv || 'hand' in priv, 'it is the prep view, keys: ' + Object.keys(priv).join(','));
  m.dispose();
});
