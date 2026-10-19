// test/records-only.test.js — 只开战绩、不开账号（SP_RECORDS=1）。
//
// 背景：排行榜（stats → 排行榜，按 (难度, 协议等级) 分榜）只需要 MatchRecords 的 journal，不需要 `hello` 的登录段。
// 但 server/index.js 以前把两者绑在同一个 SP_ACCOUNTS 上；而当前客户端没有登录界面，直接 SP_ACCOUNTS=1 会让所有
// 新连接吃 AUTH_REQUIRED。这里钉住新开关的三件事：
//   1. SP_RECORDS=1 / startServer({ records: true, accounts: false }) 构造 MatchRecords，但 accounts 仍是 null；
//   2. 不带头 auth/password 的 hello 正常拿到 welcome（没有 AUTH_REQUIRED）—— 握手与没开战绩时逐字节相同；
//   3. records.board 能应答（哪怕空榜），排行榜 UI 因此可用。
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { startServer } from '../server/index.js';
import { resolveAccountConfig } from '../server/accountConfig.js';
import { TestClient } from './helpers/wsClient.js';

test('resolveAccountConfig: SP_RECORDS opens records without opening accounts', () => {
  const root = '/tmp/records-only-config';
  assert.equal(resolveAccountConfig({}, root, {}).enabled, false);
  assert.equal(resolveAccountConfig({}, root, {}).recordsEnabled, false, 'default: both off');
  const recordsOnly = resolveAccountConfig({}, root, { SP_RECORDS: '1' });
  assert.equal(recordsOnly.enabled, false, 'accounts stay off');
  assert.equal(recordsOnly.recordsEnabled, true, 'records on');
  assert.equal(resolveAccountConfig({}, root, { SP_RECORDS: 'yes' }).recordsEnabled, true);
  assert.equal(resolveAccountConfig({}, root, { SP_RECORDS: '0' }).recordsEnabled, false);
  const accounts = resolveAccountConfig({}, root, { SP_ACCOUNTS: '1' });
  assert.equal(accounts.enabled, true);
  assert.equal(accounts.recordsEnabled, true, 'accounts imply records (old behaviour)');
  assert.equal(resolveAccountConfig({ records: true }, root, {}).recordsEnabled, true, 'explicit startServer option');
});

test('records-only server: hello needs no auth, accounts is null, records.board answers', async () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'sp-records-only-'));
  const recordsFile = path.join(dir, 'match-records.jsonl');
  const srv = await startServer({ port: 0, quiet: true, accounts: false, records: true, recordsFile });
  try {
    assert.equal(srv.accounts, null, 'SP_RECORDS must not construct AccountStore');
    assert.ok(srv.records, 'records store is constructed');
    const c = await TestClient.connect(`ws://127.0.0.1:${srv.port}/ws`);
    try {
      // accounts 若被误开，这里会是 error AUTH_REQUIRED，而不是 welcome
      const w = await c.hello('排行榜测试');
      assert.ok(w.playerId && w.token, 'hello without auth still gets a session');
      const reply = await c.request({ t: 'records.board', difficulty: 'ABYSS', level: 18, limit: 20 });
      assert.equal(reply.t, 'ok', 'the direct reply is ok; the board itself is a records.board frame');
      const board = await c.waitFor('records.board');
      assert.equal(board.difficulty, 'ABYSS');
      assert.equal(board.level, 18);
      assert.equal(board.total, 0);
      assert.deepEqual(board.entries, []);
    } finally { await c.close(); }
  } finally {
    await srv.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
