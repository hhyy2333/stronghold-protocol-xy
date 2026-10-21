// test/match/intent-coverage.test.js — every client→server 对局意图 must have a HANDLER.
//
// 业主 2026-10-21（玩家反馈「选悬赏 页面直接没了，只能看着场地发呆」）：根因之一是 `g.publicFull` —— 客户端在增量帧
// 合并失败时发它自愈（DESIGN §8.2），而 `_handle` 的 switch 里**没有这条 case**，于是每次都回 `BAD_MSG`、服务端一帧都
// 不补；`resendPublic` 写好了却从来没被调用过。同一类漏还有 `g.unequip`（行为开关 `unequip: "allow"` 打开的房间点
// 「卸下」只会拿到 `BAD_MSG`）。
//
// 这两条都不会被「有转发、有校验」的测试抓到：`validateC2S` 通过、`handle` 也正常返回（只是回了个错误）。所以这里
// 按**协议表**逐条点名：`shared/protocol.js` 的 C2S 里每一个 `g.*` / `b.*` 都必须在 `server/match/match/intents.js` 的
// switch 里有一个 `case`，或者被明确列在下面的白名单里（有意的例外）。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { C2S } from '../../shared/protocol.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

/** 有意不经过 `_handle` 的意图（由别处在到达 switch 之前处理，或根本不该到服务端）。 */
const HANDLED_ELSEWHERE = new Set([
  'g.leave',   // 房间层（server/lobby.js）拦下，永远不到 match.handle
]);

test('every client→server match intent has a handler in intents.js (no silent BAD_MSG)', () => {
  const src = readFileSync(path.join(ROOT, 'server/match/match/intents.js'), 'utf8');
  const cases = new Set([...src.matchAll(/case '([a-z][A-Za-z.]+)':/g)].map((m) => m[1]));
  const gameTypes = Object.keys(C2S).filter((t) => t.startsWith('g.') || t.startsWith('b.'));
  assert.ok(gameTypes.length > 30, 'premise: the protocol still carries the match intents, got ' + gameTypes.length);
  const missing = gameTypes.filter((t) => !cases.has(t) && !HANDLED_ELSEWHERE.has(t));
  assert.deepEqual(missing, [], 'these intents would answer BAD_MSG: ' + missing.join(', '));
});
