// test/ui/room-mods-remember.test.js — 房间模组勾选是「记住的偏好」（owner 2026-10-18）。
//
// 旧行为：勾完建了一间房，下一次建房 / 刷新页面 / 重连之后又得从头勾（main.js 进房时清空 + 模块状态只在内存里）。
// 现在：勾选写进 localStorage（sp.pref.roomMods.selected），每次 welcome 按这台服务器**真有的**包过滤后套用；
// 进房、断线、换房间都不清。这个测试钉住这四条，以及「服务器没有模组时不会误报/误发」。
import test from 'node:test';
import assert from 'node:assert/strict';
import * as roomMods from '../../public/js/roomMods.js';

const KEY = 'sp.pref.roomMods.selected';
const pack = (id) => ({ id, hash: 'h-' + id, layer: 'A', combat: false });
const welcome = (digest, ids) => ({ mods: { digest, packs: ids.map(pack) } });
const pref = () => JSON.parse(globalThis.localStorage.getItem(KEY) || 'null');

test('ticks survive a reset/welcome (reload, reconnect, another room) and are filtered by catalogue', () => {
  const data = new Map();
  globalThis.localStorage = {
    getItem: (k) => (data.has(k) ? data.get(k) : null),
    setItem: (k, v) => { data.set(k, String(v)); },
    removeItem: (k) => { data.delete(k); },
  };
  try {
    roomMods.reset();
    roomMods.setWelcomeMods(welcome('d1', ['a', 'b']));
    assert.deepEqual(roomMods.getSelectedModIds(), [], 'a fresh client starts with nothing ticked');
    roomMods.setSelectedModIds(['b']);
    assert.deepEqual(pref(), ['b'], 'the tick is a persisted preference');

    // a reload: module state gone, the welcome comes again
    roomMods.reset();
    roomMods.setWelcomeMods(welcome('d1', ['a', 'b']));
    assert.deepEqual(roomMods.getSelectedModIds(), ['b'], 'remembered');

    // entering a room clears the LIVE picks only (clearSelection); the preference is what the next welcome restores
    roomMods.clearSelection();
    assert.deepEqual(roomMods.getSelectedModIds(), []);
    roomMods.setWelcomeMods(welcome('d1', ['a', 'b']));
    assert.deepEqual(roomMods.getSelectedModIds(), ['b'], 'still remembered after a room');

    // another server, with another catalogue: only packs it declares are kept, and the pref is untouched
    roomMods.reset();
    roomMods.setWelcomeMods(welcome('d2', ['a', 'c']));
    assert.deepEqual(roomMods.getSelectedModIds(), [], 'b does not exist here');
    assert.deepEqual(pref(), ['b'], 'the preference itself was not rewritten by a welcome');

    // an explicit 清空 IS a preference: it empties the list
    roomMods.setSelectedModIds(['c']);
    roomMods.setSelectedModIds([]);
    assert.deepEqual(pref(), []);
    roomMods.reset();
    roomMods.setWelcomeMods(welcome('d2', ['a', 'c']));
    assert.deepEqual(roomMods.getSelectedModIds(), [], 'nothing was remembered after 清空');
  } finally {
    delete globalThis.localStorage;
  }
});

test('a server without mods sends no modIds and keeps the preference for a modded server later', () => {
  const data = new Map();
  globalThis.localStorage = {
    getItem: (k) => (data.has(k) ? data.get(k) : null),
    setItem: (k, v) => { data.set(k, String(v)); },
    removeItem: (k) => { data.delete(k); },
  };
  try {
    roomMods.reset();
    roomMods.setWelcomeMods(welcome('d1', ['a', 'b']));
    roomMods.setSelectedModIds(['a']);
    roomMods.reset();
    roomMods.setWelcomeMods({}); // a plain install: no mods key
    assert.deepEqual(roomMods.getSelectedModIds(), []);
    assert.deepEqual(roomMods.buildCreatePayload('solo', 'NORMAL'), { mode: 'solo', difficulty: 'NORMAL' }, 'no mods, no modIds');
    assert.deepEqual(JSON.parse(globalThis.localStorage.getItem(KEY)), ['a'], 'the preference is kept for the next modded server');
    roomMods.setWelcomeMods(welcome('d1', ['a', 'b']));
    assert.deepEqual(roomMods.getSelectedModIds(), ['a'], 'and re-applied there');
  } finally {
    delete globalThis.localStorage;
  }
});
