// test/ui/difficulty-remember.test.js — 难度是「记住的偏好」，而且记的是**真正开局时的那个**（业主 2026-10-20）。
//
// 业主原话：「手机上每次退出重开，都要重新选择难度，不知道为什么默认最低难度」。根因在同盟模拟这条路上：
//   * 选择同盟方式 那张卡上没有难度可选，只写「难度：{name}（可在同盟内更改）」；房主点「创建同盟」时用的是内存 state，
//     直接 room.create —— 从没经过会落盘的 pickDifficulty；
//   * 同盟里唯一能改难度的地方（房间底栏的房子图标 → room.setDifficulty）也只改房间、不写偏好。
// 所以这个测试钉住两件事：开局面板里点一下仍然会记住（旧行为，别退），以及真正开局 / 房内改难度也会记住（新修的），
// 顺带钉住 lastDifficulty 这个兜底（玩过什么默认什么，而不是永远 FUNNY）。
import test from 'node:test';
import assert from 'node:assert/strict';

const KEY = 'sp.pref.lobby.difficulty';
const LAST = 'sp.pref.lobby.lastDifficulty';
const FP = 'sp.pref.lobby.firepowerDifficulty';

function withStorage(fn) {
  const data = new Map();
  globalThis.localStorage = {
    getItem: (k) => (data.has(k) ? data.get(k) : null),
    setItem: (k, v) => { data.set(k, String(v)); },
    removeItem: (k) => data.delete(k),
  };
  const get = (k) => (data.has(k) ? JSON.parse(data.get(k)) : undefined);
  return Promise.resolve(fn(get)).finally(() => { delete globalThis.localStorage; });
}

const lobby = () => import('../../public/js/screens/lobby.js');

test('rememberPlayedDifficulty writes the per-mode key AND the played fallback', () => withStorage(async (get) => {
  const { rememberPlayedDifficulty, lastDifficulty } = await lobby();
  assert.equal(lastDifficulty(), 'FUNNY', 'a browser that never played anything falls back to 标准');
  rememberPlayedDifficulty('ABYSS');
  assert.equal(get(KEY), 'ABYSS', 'the mode key the start sheet already reads');
  assert.equal(get(LAST), 'ABYSS', 'and the played fallback');
  assert.equal(lastDifficulty(), 'ABYSS');
  rememberPlayedDifficulty('HARD', { random: true });
  assert.equal(get(FP), 'HARD', '无限火力 keeps its own key (it has its own cards)');
  assert.equal(get(KEY), 'ABYSS', 'and does not overwrite the normal mode key');
  assert.equal(get(LAST), 'HARD', 'but the played fallback follows what was played');
  rememberPlayedDifficulty('NOT_A_DIFFICULTY');
  assert.equal(get(LAST), 'HARD', 'a bogus value never lands');
}));

test('lastDifficulty sanitises a hand-edited value back to FUNNY', () => withStorage(async () => {
  localStorage.setItem(LAST, JSON.stringify('ULTRA'));
  const { lastDifficulty } = await lobby();
  assert.equal(lastDifficulty(), 'FUNNY');
  localStorage.setItem(LAST, '"NORMAL"');
  assert.equal(lastDifficulty(), 'NORMAL');
}));

test('the sheet opens on the played difficulty, and a real pick in that mode still wins', () => withStorage(async () => {
  const { startDifficulty } = await lobby();
  const save = (k, v) => localStorage.setItem(`sp.pref.${k}`, JSON.stringify(v));
  // 独立模拟 never picked here, but this browser played 终极模拟 before: the sheet opens on 终极模拟, not 标准
  save('lobby.lastDifficulty', 'ABYSS');
  assert.equal(startDifficulty('solo'), 'ABYSS');
  assert.equal(startDifficulty('coop'), 'ABYSS', 'and the co-op card (which shows the same number) too');
  // a pick made in THIS mode outranks the fallback, both ways round
  save('lobby.difficulty', 'NORMAL');
  assert.equal(startDifficulty('solo'), 'NORMAL');
  save('lobby.lastDifficulty', 'HARD');
  assert.equal(startDifficulty('solo'), 'NORMAL', 'the per-mode pick still wins');
  // 无限火力 reads its own key, and falls back to the played difficulty when it has none
  assert.equal(startDifficulty('firepower'), 'HARD');
  save('lobby.firepowerDifficulty', 'ABYSS');
  assert.equal(startDifficulty('firepower'), 'ABYSS');
}));