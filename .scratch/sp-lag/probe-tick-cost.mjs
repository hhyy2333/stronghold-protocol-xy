// probe-tick-cost.mjs — 量「一场战斗里单 tick 的 sim 成本」，用来判断客户端补帧 / 服务端 headless 会不会
// 一次性阻塞事件循环。
//
// 为什么要量这个：客户端 runner 在落后时一帧最多补 CATCHUP_TICKS=240 个 tick（public/js/battle/runner.js），
// 服务端 FieldRunner 每个 interval 最多 8 个 tick（server/match/fields.js MAX_TICKS_PER_INTERVAL）。
// 若单 tick 在高回合（16 单位 + 大量敌人/激励）要 1ms 以上，240 tick 就是 240ms —— 一帧 240ms 会直接
// 让浏览器主线程停摆，心跳 ping 量出来的就是秒级假延迟。
//
// 用法：node .scratch/sp-lag/probe-tick-cost.mjs
// 只读：读 public/dev/perf/*.json（仓库里已有的录制 spec），跑 server/sim，不写任何文件。
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, '..', '..', 'Stronghold-Protocol-repo');
const mod = (rel) => pathToFileURL(path.join(REPO, rel)).href;

const { getData } = await import(mod('server/data.js'));
const { DataSource } = await import(mod('server/sim/simdata.js'));
const { createBattleFromSpec } = await import(mod('server/sim/spec.js'));

const dir = path.join(REPO, 'public/dev/perf');
const index = JSON.parse(readFileSync(path.join(dir, 'index.json'), 'utf8'));

const ds = new DataSource(getData({ log: { warn() {}, error() {}, info() {} } }), null);

// 每 tick 计时：performance.now() 有 ~microsecond 分辨率，够用。
const pct = (a, p) => { const s = [...a].sort((x, y) => x - y); return s[Math.min(s.length - 1, Math.floor((p / 100) * s.length))]; };

const CATCHUP_TICKS = 240;      // public/js/battle/runner.js
const SERVER_CAP_TICKS = 8;     // server/match/fields.js MAX_TICKS_PER_INTERVAL
const FRAME_BUDGET_MS = 16.7;   // 60fps
const HEAVY_FRAME_MS = 50;      // 超过这个就是肉眼可见的顿

const rows = [];
for (const s of index) {
  const msg = JSON.parse(readFileSync(path.join(dir, `${s.name}.json`), 'utf8'));
  const b = createBattleFromSpec(msg.spec, ds, { recordEvents: true });

  const perTick = [];
  let i = 0;
  const cap = 60 * 60; // 最多 60 游戏秒（1800 tick）
  while (!b.finished && i < cap) {
    const t0 = performance.now();
    b.step();
    perTick.push(performance.now() - t0);
    i++;
  }

  const total = perTick.reduce((a, x) => a + x, 0);
  const avg = total / perTick.length;
  const worst = Math.max(...perTick);
  const p99 = pct(perTick, 99);
  // 240 tick 补帧按「平均成本 + 最坏成本」两种口径估算
  const catchupAvg = avg * CATCHUP_TICKS;
  const catchupWorst = worst * CATCHUP_TICKS;
  // 用最坏 240 tick 滑窗的真实耗时（更贴近实际卡顿：一段连续重负载）
  let slideWorst = 0;
  for (let k = 0; k + CATCHUP_TICKS <= perTick.length; k += Math.max(1, Math.floor(CATCHUP_TICKS / 4))) {
    let sum = 0;
    for (let j = k; j < k + CATCHUP_TICKS; j++) sum += perTick[j];
    if (sum > slideWorst) slideWorst = sum;
  }

  rows.push({
    name: s.name, title: s.title, kind: s.kind, units: s.units, players: s.players,
    steps: perTick.length, gameSeconds: +(perTick.length / 30).toFixed(1),
    totalMs: +total.toFixed(1), avgMs: +avg.toFixed(4), p99Ms: +p99.toFixed(3), worstMs: +worst.toFixed(2),
    catchupAvgMs: +catchupAvg.toFixed(1), catchupWorstMs: +catchupWorst.toFixed(1), catchupSlideWorstMs: +slideWorst.toFixed(1),
  });
}

console.log('# 单 tick sim 成本（本地机器，仅作数量级参考；线上是 2 vCPU 共享核）\n');
console.log('spec'.padEnd(20) + 'kind'.padEnd(8) + 'steps'.padStart(6) + 'gameS'.padStart(7) + 'totalMs'.padStart(9)
  + 'avgTick'.padStart(10) + 'p99Tick'.padStart(9) + 'worstTick'.padStart(11)
  + '| 240tick(avg)'.padStart(15) + '240tick(最坏)'.padStart(15) + '240tick(滑窗)'.padStart(16));
for (const r of rows) {
  console.log(
    r.name.padEnd(20) + r.kind.padEnd(8) + String(r.steps).padStart(6) + String(r.gameSeconds).padStart(7)
    + String(r.totalMs).padStart(9) + String(r.avgMs).padStart(10) + String(r.p99Ms).padStart(9) + String(r.worstMs).padStart(11)
    + ('| ' + r.catchupAvgMs + ' ms').padStart(15) + (r.catchupWorstMs + ' ms').padStart(15) + (r.catchupSlideWorstMs + ' ms').padStart(16),
  );
}

console.log('\n## 判读');
console.log(`   客户端一帧补帧预算 CATCHUP_TICKS=${CATCHUP_TICKS} tick，一帧可用 16.7ms（60fps）、可接受的顿 ${HEAVY_FRAME_MS}ms。`);
console.log(`   服务端每 interval 上限 ${SERVER_CAP_TICKS} tick（=266ms 游戏时间 @2x），单 interval 的 CPU 预算是 ${(SERVER_CAP_TICKS * (rows[0]?.avgMs ?? 0)).toFixed(2)}ms 量级。`);
for (const r of rows) {
  const verdict = r.catchupSlideWorstMs > HEAVY_FRAME_MS ? '⚠ 一次补帧就可能造成肉眼可见的顿' : 'ok';
  console.log(`   ${r.name.padEnd(20)} 最坏连续 240 tick = ${r.catchupSlideWorstMs} ms  → ${verdict}`);
}
