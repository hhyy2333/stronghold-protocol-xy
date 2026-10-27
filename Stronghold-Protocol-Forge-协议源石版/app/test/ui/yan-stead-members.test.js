// 燎原 (hex_yan_ember, 业主 2026-10-27「改备战侧的坚守人数/激活」)：「【炎】达到 300 层时，【炎】干员视为【坚守】干员」。
//
// 在场 / 激活 / 阶 三个数字由服务端算（server/match/bondsMeta.js `yanSteadLayerGate` 把炎干员算进坚守人数，
// test/match/bonds.test.js 钉住那一半）；这条钉**显示侧**：坚守弹窗的成员行里也要有这些炎干员，否则条上写着
// 「已激活 2 阶」而名单里一个人都没有。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
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
const { bondMembers, memberHeadCount } = await import('../../public/js/ui/gameLogic/bonds.js');

const STEAD = data.lookup('bonds', 'steadShip');
const YAN_OPS = ['chess_char_1_03_a', 'chess_char_2_04_a', 'chess_char_3_03_a'];   // 三名只有【炎】（不带坚守）的干员
const getChess = (id) => data.lookup('chess', id);
const getItem = (id) => data.lookup('items', id);
const hasBond = (id) => !!data.lookup('bonds', id);
const CARD = { id: 'hex:hex_yan_ember', name: '燎原', iconKind: 'hex' };
const priv = ({ layers, card = true }) => ({
  board: YAN_OPS.map((id) => ({ kind: 'chess', id })),
  hand: [], temp: [],
  bonds: [{ bondId: 'yanShip', count: 3, active: true, tier: 1, layers }],
  effects: card ? [CARD] : [],
});
const rowsOf = (p) => bondMembers(STEAD, p, [], getChess, getItem, null, hasBond);

test('燎原: 300 层时坚守弹窗的成员行里有炎干员', () => {
  const rows = rowsOf(priv({ layers: 300 }));
  const viaHex = rows.filter((r) => r.viaHex === 'hex_yan_ember');
  assert.deepEqual(viaHex.map((r) => r.id).sort(), [...YAN_OPS].sort(), '三名炎干员都列进坚守名单');
  assert.ok(viaHex.every((r) => r.onBoard && r.owned), '按在场成员画（不是「授予」那种行）');
  assert.equal(memberHeadCount(rows), 3, '成员表头的在场数跟着算');
});

test('不到 300 层、或者没有燎原时名单不变', () => {
  assert.equal(rowsOf(priv({ layers: 299 })).filter((r) => r.viaHex).length, 0, '299 层不列');
  assert.equal(rowsOf(priv({ layers: 300, card: false })).filter((r) => r.viaHex).length, 0, '没有卡不列');
});

test('别的盟约的名单不受影响', () => {
  const yan = data.lookup('bonds', 'yanShip');
  const rows = bondMembers(yan, priv({ layers: 300 }), [], getChess, getItem, null, hasBond);
  assert.equal(rows.filter((r) => r.viaHex).length, 0, '炎自己的名单里不会多画一行');
});
