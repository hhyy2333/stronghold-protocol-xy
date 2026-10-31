// public/dev/fire-rain.js — 不息恶火 (boss_11 / enemy_1515_bsnake) 火雨的渲染 demo。
//
// 复刻 server/sim/content/bosses.js fireWave(): 每 2 个游戏秒，从场地左侧 (rect.c0-1) 的每一行发出一颗火球，
// 飞到右侧 (rect.c1+1)，dur = 宽度 / B_SNAKE.fireballSpeed(8)；渲染侧走 render/fx/simfx.js case 'fireball' →
// projectiles.js fireball() 的彗星（贴图 bsnake_10 头 + bsnake_05 尾焰 + bsnake_12 入场火环）。
// 只画表现：不跑伤害。Query: ?interval=<ms 每波> &waves=<波数> &stage=<stageId> &cam=boss|normal
import { createFieldView } from '../js/render/app.js';
import { data } from '../js/data.js';
import { assets } from '../js/assets.js';
import { GEO } from '../../shared/constants.js';

const q = new URLSearchParams(location.search);
const api = { ready: false, error: null, waves: 0, pushes: 0, startedAt: 0 };
window.__rain = api;

async function main() {
  await data.loadAll('chess', 'tokens', 'items', 'enemies', 'stages', 'bonds', 'config');
  await assets.ready();
  const view = await createFieldView(document.getElementById('field'), { data, assets, settings: { quality: 'high', damageNumbers: false } });
  api.view = view;
  const stageId = q.get('stage') || 'act1autochess_m01';
  const stage = data.lookup('stages', stageId) || data.list('stages')[0];
  const rect = { ...GEO.BOSS_RECT };
  view.setStage(stage);
  const pick = (name) => data.list('chess').find((c) => c.name === name && !c.isGolden);
  const op = (id, name, x, y) => { const c = pick(name); return c ? { id, kind: 'op', side: 'ally', defId: c.chessId, name, tier: c.tier, golden: false, spine: c.assets?.spine, avatar: c.assets?.avatar, x, y, facing: 1, maxHp: 3200 } : null; };
  const en = (id, key, x, y, extra = {}) => { const e = data.lookup('enemies', key); return { id, kind: 'enemy', side: 'enemy', defId: key, name: e?.name || key, tier: 1, golden: false, spine: e?.spine || key, avatar: e?.iconId || key, x, y, facing: -1, maxHp: 90000, ...extra }; };
  const units = [
    en(1, 'enemy_1515_bsnake', 7.2, 3.4, { boss: true }),
    op(2, '银灰', 4.2, 2), op(3, '能天使', 5.1, 4), op(4, '塞雷娅', 6.3, 3),
    op(5, '史尔特尔', 3.4, 5), op(6, '莫斯提马', 8.3, 2),
  ].filter(Boolean);
  view.enterBattle({ fieldId: 'rain', kind: 'boss', rect, stageId: stage?.id || stageId, units });
  if (q.get('cam') === 'normal') view.setCamera('normal', { rect });
  else view.setCamera('boss', { rect, side: 'L' });
  // one snapshot so the units stand on the field while the fx play
  const tuple = (u) => [u.id, u.x, u.y, u.maxHp, u.maxHp, 0, u.kind === 'op' ? 20 : 0, 0, u.side === 'enemy' ? 2 : 0];
  view.pushSnapshot({ t: 'b.snap', fieldId: 'rain', gt: 0, units: units.map(tuple), dp: 30, killed: 0, total: 12 });

  const fireKind = q.get('kind') || 'bsnakeFire';
  const c0 = rect.c0 - 1, c1 = rect.c1 + 1;
  const flight = Math.max(0.05, (c1 - c0) / 8);             // B_SNAKE.fireballSpeed = 8 tiles/s (游戏秒)
  const interval = Math.max(200, Number(q.get('interval')) || 1000);   // 真实毫秒 / 波（游戏里是每 2 游戏秒一波）
  const maxWaves = Math.max(1, Number(q.get('waves')) || 60);
  api.ready = true;
  api.startedAt = performance.now();
  // The view's battle clock advances with SNAPSHOTS (render/interp.js drops events ahead of it), so one snapshot per
  // 50 ms tick — otherwise the pushed fx would queue behind a clock stuck at gt 0 and never play.
  let gt = 0, wave = 0, lastWaveGt = -Infinity, last = performance.now();
  const waveGap = Math.max(0.2, interval / 500);          // 游戏秒：interval 毫秒 × 2（战斗 2× 速度）/ 1000
  const tick = () => {
    const now = performance.now();
    gt += Math.min(0.25, (now - last) / 1000) * 2;        // 2× battle speed, as the game runs it
    last = now;
    view.pushSnapshot({ t: 'b.snap', fieldId: 'rain', gt, units: units.map(tuple), dp: 30, killed: 0, total: 12 });
    if (gt - lastWaveGt >= waveGap && wave < maxWaves) {
      wave += 1; lastWaveGt = gt; api.waves = wave;
      const ev = [];
      for (let r = rect.r0; r <= rect.r1; r++) {
        if (fireKind === 'bsnakeFire') ev.push(['fx', 'bsnakeFire', c0, r, { tx: c1, ty: r, dur: flight, row: r }]);
        else ev.push(['fx', 'shell', c0, r, { kind: 'bsnakeFire', tx: c1, ty: r, dur: flight, row: r }]);
      }
      view.pushEvents({ t: 'b.ev', fieldId: 'rain', gt, ev });
      api.pushes += 1;
    }
    if (wave >= maxWaves && wave > 0) api.done = true;
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
}
main().catch((e) => { api.error = String((e && e.message) || e); console.error(e); });
