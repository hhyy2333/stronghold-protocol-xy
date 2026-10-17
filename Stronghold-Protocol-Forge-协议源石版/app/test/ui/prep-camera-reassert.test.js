// test/ui/prep-camera-reassert.test.js — 休整期「取景 ↔ 棋盘半场」一致性兜底。
//
// 业主 2026-10-17（>4 人的房）：「boss 战前休整期点干员有概率把地图从 boss 地图变成道中地图。
// 直到战斗开始恢复」——地图与道中**是同一张**，差别只在取景：bossPrep 把战场行 2–5 当棋盘行 9–12 画，
// 普通 prep 是恒等映射。两者必须同源（render/app.js setCamera → setPrepField）。
//
// 客户端只在「相机键（kind:side）」变化时重新请求镜头，所以一旦渲染器被留在另一套取景里，
// viewModeRef 已记着 'prep' 就再也不会纠正 —— 这个兜底直接拿 view.prepField() 的实际状态比对。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { prepFieldMismatch } from '../../public/js/ui/gameLogic.js';

const boss = (side) => ({ kind: 'bossPrep', opts: { side, shop: true } });
const normal = () => ({ kind: 'prep', opts: { rect: { r0: 7, r1: 12, c0: 0, c1: 10 }, side: 'L', shop: true } });

test('渲染器还停在道中（board）而该帧是 boss 休整期：要重新请求', () => {
  // 就是业主看到的那一幕：镜头/布局退回道中，棋子站回道中的位置
  assert.equal(prepFieldMismatch({ kind: 'board', side: 'L', mirror: false }, boss('L')), true);
  assert.equal(prepFieldMismatch({ kind: 'board', side: 'L', mirror: false }, boss('R')), true);
});

test('渲染器停在 boss 半场而该帧是普通 prep：也要重新请求（反方向）', () => {
  assert.equal(prepFieldMismatch({ kind: 'bossPrep', side: 'L', mirror: false }, normal()), true);
});

test('半场（L/R）不一致：boss 休整期会把棋子镜像到另一半，同样要重来', () => {
  assert.equal(prepFieldMismatch({ kind: 'bossPrep', side: 'L', mirror: false }, boss('R')), true);
  assert.equal(prepFieldMismatch({ kind: 'bossPrep', side: 'R', mirror: true }, boss('L')), true);
});

test('已经对上了：不动镜头（这条保证兜底不会每帧重设相机）', () => {
  assert.equal(prepFieldMismatch({ kind: 'bossPrep', side: 'L', mirror: false }, boss('L')), false);
  assert.equal(prepFieldMismatch({ kind: 'bossPrep', side: 'R', mirror: true }, boss('R')), false);
  assert.equal(prepFieldMismatch({ kind: 'board', side: 'L', mirror: false }, normal()), false);
  // 半场只有 boss 休整期才参与判断
  assert.equal(prepFieldMismatch({ kind: 'board', side: 'R', mirror: false }, normal()), false);
});

test('渲染器不报告（老视图 / 还没准备好）：不主动改镜头', () => {
  assert.equal(prepFieldMismatch(null, boss('L')), false);
  assert.equal(prepFieldMismatch(undefined, boss('L')), false);
  assert.equal(prepFieldMismatch({ kind: 'bossPrep', side: 'L' }, null), false);
});

test('接线：休整期分支拿 view.prepField() 与 prepCameraFor 比对，不一致就 setCam', () => {
  const src = readFileSync(new URL('../../public/js/screens/game.js', import.meta.url), 'utf8');
  assert.match(src, /typeof view\.prepField === 'function'/, 'must read the renderer state');
  assert.match(src, /prepFieldMismatch\(pf, want\)/, 'must judge through the pure helper');
  assert.match(src, /if \(prepFieldMismatch\(pf, want\)\) setCam\(want\.kind, want\.opts\)/, 'must re-request the camera');
  assert.match(src, /if \(!drag && !facing\)/, 'deferred while a piece is dragged or its direction is chosen (as foldCamera does)');
  // 延后的那次必须真的会再跑：拖拽/方向轮结束要重新触发这个 effect，否则兜底只在选中时生效
  assert.match(src, /holdSeq, !!drag, !!facing\]\),?/, 'the effect re-runs when the drag or the wheel ends');
  assert.match(src, /const want = prepCameraFor\(pub, myId, shopFolded, stageLayout\)/, 'the wanted camera is the same one the entry path asks for');
});
