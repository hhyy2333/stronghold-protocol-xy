// server/sim/battle/combat.js — Battle methods: damage, heal and HP loss (the guarded entry points of the damage.js
// pipeline), projectiles and forced attacks (ai.js performAttack).
// Installed on Battle.prototype by server/sim/Battle.js (a method container: never instantiated; `this` is the battle).

import { dealDamage as pipeDamage, heal as pipeHeal, applyHpLoss, makeDamageInfo, reduceElement, leaderHitCancelled } from '../damage.js';
import { effectiveProfile, performAttack, acquireTargets } from '../ai.js';

export class BattleCombat {
  dealDamage(source, target, dmg) {
    if (this._overDamageBudget()) return 0;
    try { return pipeDamage(this, source, target, dmg); } catch (e) { this._internalError('dealDamage', e); return 0; }
  }

  /**
   * The per-tick work budget (server/sim/constants.js MAX_TICK_DAMAGE_INSTANCES): every damage instance this tick costs
   * one, and a tick that resolves more than the cap force-ends the battle as a timeout. A mutual-damage loop
   * (A reflects into B, B into A) does exactly that — unbounded instances inside one `step()` — while raising no error
   * at all, so the error caps cannot see it (2026-10-30). Counts only: deterministic, so a replay ends on the same tick.
   * @returns {boolean} true when the tick is over budget (the caller drops the instance)
   */
  _overDamageBudget() {
    const cap = this.maxTickDamageInstances;
    if (!(cap > 0) || (this.dmgInstances = (this.dmgInstances || 0) + 1) <= cap) return false;
    if (!this.finished && !this._forcing) {
      this._forcing = true;
      try {
        this.logger.error?.(`[sim] battle force-ended as a timeout: ${this.dmgInstances} damage instances in one tick (cap ${cap})`);
        this.forceEnd('timeout');
      } catch { this._hardFinish('timeout'); }
    }
    return true;
  }

  heal(source, target, amount, opts = {}) {
    try { return pipeHeal(this, source, target, amount, opts); } catch (e) { this._internalError('heal', e); return 0; }
  }

  /**
   * HP loss that ignores DEF/RES, dodge and shields (流失). May kill. opts: { source, silent, tags, from } — `from` = the
   * DamageInfo this loss derives from (damage passed on to a leader, split, shared…): its tags are inherited and it is
   * kept as `dmg.origin`, so `damaged` handlers that skip their own tagged damage also skip what it turned into; a loss
   * derived from 无来源 damage (`from.sourceless`, element bursts) is 无来源 too (hooks see no source, `source` is credited).
   * `sourceless: true` makes the loss itself 无来源 ("受到等量的无来源生命流失": hooks see no source; `source` keeps the
   * credit — the stats and the per-player shared-pool tally).
   * On a leader in a boss / hidden battle a loss of ≥ BOSS_HIT_LIMIT is cancelled like a hit (damage.js leaderHitCancelled)
   * — except with `noHitLimit: true`: a share of the leader's pool that is no hit (胄's 死亡集群 drone link, content/bosses.js).
   */
  loseHp(target, amount, { source = null, silent = false, tags = null, from = null, sourceless = false, noHitLimit = false } = {}) {
    if (!target || !target.alive || !(amount > 0)) return 0;
    if (this._overDamageBudget()) return 0;   // 流失 is a damage instance too (the per-tick cap above)
    // 限伤 (shared/constants.js BOSS_HIT_LIMIT): a loss passed on to a leader (the parts' 传递) is one hit too
    if (!noHitLimit && leaderHitCancelled(this, target, amount)) return 0;
    const t = ['hpLoss'];
    for (const list of [from && from.tags, tags]) if (Array.isArray(list)) for (const x of list) if (!t.includes(x)) t.push(x);
    return applyHpLoss(this, source, target, amount, { type: 'true', tags: t, noSp: true, silent, origin: from ?? null, sourceless: !!sourceless || !!(from && from.sourceless) });
  }

  reduceElement(target, amount, element = null) { return reduceElement(target, amount, element); }

  makeDamage(d) { return makeDamageInfo(d); }

  addProjectile(p) { return this.projectiles.add(p); }

  // exposed for ai/content convenience
  effectiveProfile(u) { return effectiveProfile(u); }

  /**
   * Perform an immediate attack with a unit's current profile (content: "立即攻击", extra attacks, counters). It is an
   * attack in every respect (hooks, attack SP, a running ammo skill's bullet) — except with `noAmmo: true`: an extra
   * attack that spends no ammo (no `ammoUsed`, the skill never ends on it; 圣约送葬人 "不额外消耗弹药").
   * Returns true when an attack was made.
   */
  forceAttack(u, targets = null, { noAmmo = false } = {}) {
    if (!u || !u.alive || !u.profile) return false;
    const prof = effectiveProfile(u);
    const t = targets ?? acquireTargets(this, u, prof);
    if (!t || !t.length) return false;
    const n0 = u.stats.attacks;
    performAttack(this, u, prof, t, noAmmo ? { noAmmo: true } : null);
    return u.stats.attacks > n0;
  }
}
