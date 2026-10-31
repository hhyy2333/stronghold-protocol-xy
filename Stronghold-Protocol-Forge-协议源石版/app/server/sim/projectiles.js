// server/sim/projectiles.js — projectile flight & impact (DESIGN §5.4 addProjectile).
//
// A projectile homes on `target` (a unit) or flies to a fixed point `to` ({x,y}). On arrival `onHit(ctx)` runs
// with ctx = { battle, projectile, target (null if it died / point shot), x, y }. When a homing target dies
// mid-flight the projectile fizzles, unless `hitDead: true` (then it lands at the last known position).
//
// `steer` (0..1, default 1) is the 转向速度 (PRTS 弹道 §3): the weight with which the flight direction turns to the
// target each tick, `d' = d·(B−A)/B + t·(A/B)` with A/B = steer. 1 = dead-on homing (every existing projectile); a
// smaller weight makes the shot arc in slowly, so it can overshoot or orbit until its 最大存在时间 runs out — where it
// still "arrives" and its onHit runs (PRTS 弹道 §4: 到期仍未击中视为击中; 丰川祥子的音符 uses this).

import { PROJECTILE_SPEED } from './constants.js';
import { hypot } from './detmath.js';

let seq = 0;
const fin = (v, d) => (typeof v === 'number' && Number.isFinite(v) ? v : d);
/** A heading component ({x,y}) as a number, or null when absent / not finite. */
const unitVec = (h, k) => (h && typeof h === 'object' && Number.isFinite(Number(h[k])) ? Number(h[k]) : null);

export class ProjectileSystem {
  constructor(battle) {
    this.battle = battle;
    /** @type {object[]} */
    this.list = [];
  }

  add(p) {
    const from = p.from || { x: 0, y: 0 };
    // non-finite coordinates would never "arrive" (NaN distance) and leak the projectile for maxAge
    const fx = fin(from.x, 0), fy = fin(from.y, 0);
    const target = p.target && typeof p.target === 'object' ? p.target : null;
    const proj = {
      id: ++seq,
      x: fx,
      y: fy,
      target,
      // the target "life" it was fired at: an op that dies and is redeployed mid-flight is a new target (fizzle)
      tseq: target ? target.deploySeq : 0,
      tx: fin(p.to ? p.to.x : (target ? target.x : fx), fx),
      ty: fin(p.to ? p.to.y : (target ? target.y : fy), fy),
      speed: p.speed > 0 ? p.speed : PROJECTILE_SPEED,
      onHit: p.onHit ?? null,
      visual: p.visual ?? 'arrow',
      source: p.source ?? (p.from && p.from.id != null ? p.from : null),
      hitDead: !!p.hitDead,
      data: p.data ?? null,
      // 转向速度 (0..1): the per-tick weight of the turn toward the target — 1 is the engine's dead-on homing
      steer: p.steer == null ? 1 : Math.max(0, Math.min(1, Number(p.steer) || 0)),
      // unit heading while steering (null = straight at the target); `heading` seeds it, so a shot can leave at an
      // angle (丰川祥子的音符扇面 = 天赋黑板 attack@angle) and curve back onto its target with the steering weight
      vx: unitVec(p.heading, 'x'), vy: unitVec(p.heading, 'y'),
      age: 0,
      maxAge: p.maxAge > 0 ? p.maxAge : 10,
    };
    this.list.push(proj);
    return proj;
  }

  update(dt) {
    if (!this.list.length) return;
    const keep = [];
    const arrived = [];
    for (const p of this.list) {
      p.age += dt;
      if (p.target) {
        if (p.target.alive && !p.target.hidden && p.target.deploySeq === p.tseq) { p.tx = fin(p.target.x, p.tx); p.ty = fin(p.target.y, p.ty); }
        else if (!p.hitDead) continue; // fizzle
        else p.target = null;
      }
      const dx = p.tx - p.x, dy = p.ty - p.y;
      const d = hypot(dx, dy);
      const step = p.speed * dt;
      if (d <= step || p.age >= p.maxAge) {
        p.x = p.tx; p.y = p.ty;
        arrived.push(p);
      } else {
        // 转向速度: blend the current heading toward the target (steer 1 = straight at it, the old behaviour)
        let ux = dx / d, uy = dy / d;
        if (p.steer < 1) {
          const px = Number.isFinite(p.vx) ? p.vx : ux, py = Number.isFinite(p.vy) ? p.vy : uy;
          ux = px * (1 - p.steer) + ux * p.steer;
          uy = py * (1 - p.steer) + uy * p.steer;
          const n = hypot(ux, uy);
          if (n > 1e-6) { ux /= n; uy /= n; } else { ux = dx / d; uy = dy / d; }
          p.vx = ux; p.vy = uy;
        }
        p.x += ux * step;
        p.y += uy * step;
        keep.push(p);
      }
    }
    this.list = keep;
    for (const p of arrived) {
      if (!p.onHit) continue;
      const t = p.target && p.target.alive && p.target.deploySeq === p.tseq ? p.target : null;
      this.battle._safe(() => p.onHit({ battle: this.battle, projectile: p, target: t, x: p.x, y: p.y }), 'projectile.onHit', p.source);
    }
  }

  clear() { this.list = []; }
}
