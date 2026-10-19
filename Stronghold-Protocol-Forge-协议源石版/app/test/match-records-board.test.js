// 排行榜 (owner's call 2026-10-18: 按协议等级分榜) 与战绩日志的关系。
//
// 榜单是**派生数据**：`MatchRecords.board({difficulty, level})` 从 journal 里重建（装载时与每次 index 都更新），
// 不另落一份文件、也不给公开面任何 playerId。这里用真实文件 + 真实装载路径验证：
//   * 一张榜只收同一 (难度, 等级) 的局，等级 0（关闭）与 1–18 各自成榜；
//   * 每名真人只留最好的一局（胜 > 回合多 > 更早达成），不重复占位；
//   * 公开面没有 playerId；重启（新实例读同一份文件）后榜单能重建；运行中 index 一局立刻进榜。
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { MatchRecords } from '../server/matchRecords.js';

const quiet = { info() {}, warn() {}, error() {} };

function record({ code = 'ABCD', finishedAt = 1, difficulty = 'ABYSS', level = 0, victory = true, roundsPassed = 10, players = [] } = {}) {
  return {
    v: 1, code, matchNo: 1, finishedAt, mode: 'coop', difficulty, level, victory, roundsPassed,
    players: players.map((p) => ({
      seat: p.seat ?? 0, playerId: p.playerId, name: p.name, isBot: !!p.isBot,
      victory: p.victory ?? victory, roundsPassed: p.roundsPassed ?? roundsPassed,
      stats: {}, bonds: [], purchases: [], damageSharePct: 0,
    })),
  };
}

test('a board is per (difficulty, level), one best row per player, rebuilt from the journal', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'sp-board-'));
  const file = path.join(dir, 'records.jsonl');
  const alice = { playerId: 'a', name: 'Alice' };
  const bob = { playerId: 'b', name: 'Bob' };
  const rows = [
    record({ finishedAt: 1, level: 6, roundsPassed: 8, victory: false, players: [alice] }),
    record({ finishedAt: 2, level: 6, roundsPassed: 12, victory: true, players: [alice] }),
    record({ finishedAt: 3, level: 6, roundsPassed: 9, victory: true, players: [bob] }),
    record({ finishedAt: 4, level: 7, roundsPassed: 3, victory: false, players: [bob] }),
    record({ finishedAt: 5, level: 0, roundsPassed: 14, victory: true, players: [alice] }),
    record({ finishedAt: 6, difficulty: 'HARD', level: 0, roundsPassed: 11, victory: true, players: [bob] }),
  ];
  writeFileSync(file, rows.map((r) => JSON.stringify(r)).join('\n') + '\n', 'utf8');

  const store = new MatchRecords(file, quiet);
  const six = store.board({ difficulty: 'ABYSS', level: 6 });
  assert.equal(six.total, 2);
  assert.deepEqual(six.entries.map((e) => e.name), ['Alice', 'Bob'], 'wins first');
  assert.equal(six.entries[0].victory, true);
  assert.equal(six.entries[0].roundsPassed, 12, 'Alice keeps her best, not the first/last');
  assert.ok(!('playerId' in six.entries[0]), 'the public board carries no playerId');

  assert.deepEqual(store.board({ difficulty: 'ABYSS', level: 7 }).entries.map((e) => e.name), ['Bob'], 'levels are separate boards');
  assert.deepEqual(store.board({ difficulty: 'ABYSS', level: 0 }).entries.map((e) => e.name), ['Alice'], 'level 0 is its own board');
  assert.deepEqual(store.board({ difficulty: 'HARD', level: 0 }).entries.map((e) => e.name), ['Bob'], 'difficulties are separate');
  assert.equal(store.board({ difficulty: 'NORMAL', level: 0 }).entries.length, 0, 'empty board, not an error');

  // restart: a fresh instance derives the same boards from the journal
  const again = new MatchRecords(file, quiet);
  assert.deepEqual(again.board({ difficulty: 'ABYSS', level: 6 }).entries.map((e) => e.name), ['Alice', 'Bob']);
  // a live settlement (index) enters the board immediately
  again.index(record({ finishedAt: 7, level: 8, roundsPassed: 4, victory: false, players: [{ playerId: 'c', name: 'Cara' }] }));
  assert.deepEqual(again.board({ difficulty: 'ABYSS', level: 8 }).entries.map((e) => e.name), ['Cara']);
  rmSync(dir, { recursive: true, force: true });
});

test('level:"all" merges every level: one best row per player, sorted level-first, top 50 cap, rows carry level', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'sp-board-all-'));
  const file = path.join(dir, 'records.jsonl');
  const rows = [
    record({ finishedAt: 10, level: 18, victory: false, roundsPassed: 3, players: [{ playerId: 'a', name: 'Alice' }] }),
    record({ finishedAt: 11, level: 18, victory: true, roundsPassed: 14, players: [{ playerId: 'b', name: 'Bob' }] }),
    record({ finishedAt: 12, level: 10, victory: true, roundsPassed: 14, players: [{ playerId: 'a', name: 'Alice' }] }),
    record({ finishedAt: 13, level: 0, victory: true, roundsPassed: 14, players: [{ playerId: 'c', name: 'Cara' }] }),
    record({ finishedAt: 14, level: 6, victory: true, roundsPassed: 14, players: [{ playerId: 'd', name: 'Dan' }] }),
  ];
  writeFileSync(file, rows.map((r) => JSON.stringify(r)).join('\n') + '\n', 'utf8');
  const store = new MatchRecords(file, quiet);
  const all = store.board({ difficulty: 'ABYSS', level: 'all', limit: 50 });
  assert.equal(all.level, 'all');
  assert.deepEqual(all.entries.map((e) => e.name), ['Bob', 'Alice', 'Dan', 'Cara'], 'level 18 first; Alice keeps her 18 row, not her 10 win');
  assert.deepEqual(all.entries.map((e) => e.level), [18, 18, 6, 0]);
  assert.deepEqual(all.levels, [18, 6, 0]);
  assert.ok(!('playerId' in all.entries[0]), 'the public board carries no playerId');
  const capped = store.board({ difficulty: 'ABYSS', level: 'all', limit: 2 });
  assert.deepEqual(capped.entries.map((e) => e.name), ['Bob', 'Alice'], 'only the first N rows');
  assert.equal(capped.total, 4, 'total is still the whole merged board');
  rmSync(dir, { recursive: true, force: true });
});
