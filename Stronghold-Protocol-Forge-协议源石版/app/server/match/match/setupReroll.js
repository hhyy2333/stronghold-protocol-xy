// INFO_CHECK setup reroll: the HOST redraws the opening immediately, with no consent vote (业主 2026-10-30
// 「重刷开局改成联机房主重刷，不用投票」). The room, seats, settings and connections stay.
// [ASSUMED] Remake convenience, not an official mode rule: the lobby authorizes the host, a 300 ms request guard and a
// seed-derived reroll stream. Installed on Match.prototype like the other method containers.
import { PHASE, ERR } from '../../../shared/constants.js';
import { createRng, deriveSeed } from '../../sim/rng.js';
import { setupMatchWaves } from '../waves.js';
import { drawDisabledBonds, SharedPool } from '../pool.js';
import { OK, fail } from './common.js';

export class MatchSetupReroll {
  /**
   * Redraw the opening for everybody. The lobby's `room.rerollSetup` already refused every non-host sender; the match
   * re-checks the host it knows (`hostId`, which follows a migration) and refuses a stale `setupRevision` — a host
   * acting on an old briefing frame would otherwise overwrite a newer opening.
   * @param {string} playerId the requesting host @param {number} revision the `m.public.setupRevision` it saw
   */
  requestSetupReroll(playerId, revision) {
    if (this.disposed || this.ended || this.phase !== PHASE.INFO_CHECK) return fail(ERR.WRONG_PHASE);
    const ps = this.players.get(playerId);
    if (!ps || ps.isBot || ps.left || !ps.connected) return fail(ERR.NOT_IN_ROOM);
    if (this.hostId && ps.playerId !== this.hostId) return fail(ERR.NOT_HOST);
    if (revision !== this.setupRevision) return fail(ERR.BAD_TARGET, 'setup revision changed');
    const now = this.sched.now();
    if (now - this._lastSetupRerollAt < 300) return fail(ERR.RATE);
    this._lastSetupRerollAt = now;
    return this.completeSetupReroll();
  }

  /**
   * The transactional replacement: every data-dependent piece (setup, bans, pool, each seat's DIY stock) is built
   * before any opening or player field is touched, so a failed preparation leaves the old opening intact.
   */
  completeSetupReroll() {
    let prepared;
    try {
      const rng = createRng(deriveSeed(this.seed, `reroll-setup:${this.setupRevision + 1}`));
      const setup = setupMatchWaves(this.gd, rng);
      const stage = setup.stageId ? this.gd.stage(setup.stageId) : null;
      const bans = drawDisabledBonds(this.gd, rng);
      const pool = new SharedPool(this.gd, { banned: bans.banned });
      if (!pool.entries.size) throw new Error('rerolled chess pool is empty');
      const off = new Set([...bans.drawn, ...bans.staticOff]);
      const stocks = this.order.map((ps) => ps.buildDiyStock(off));
      prepared = { setup, stage, bans, pool, stocks };
    } catch (e) {
      this.reportError('reroll setup', e);
      return fail(ERR.INTERNAL);
    }
    // Every human's Ready is cleared by the redraw, so a transition queued by the OLD setup (all ready ⇒ BAND_DRAFT in
    // one tick) must not fire under the new one. Cancelled only now: a failed preparation above leaves the old opening —
    // and the transition it queued — exactly as it was.
    this.cancel(this._infoAdvanceTimer);
    this._infoAdvanceTimer = null;
    // All data-dependent work succeeds before any opening or player state changes.
    const { setup, stage, bans, pool, stocks } = prepared;
    this.stageId = setup.stageId;
    this.stage = stage;
    this.factions = setup.factions;
    this.bossId = setup.bossId;
    this.hiddenBossId = setup.hiddenBossId;
    this.disabledBonds = bans.drawn;
    this.staticInactiveBonds = bans.staticOff;
    this.bannedChess = bans.banned;
    this.pool = pool;
    this._botPath = null;
    for (const [i, ps] of this.order.entries()) {
      ps.diyStock = stocks[i].stock;
      ps.diyBanned = stocks[i].banned;
      ps.invalidateDeployMap();
      ps.infoReady = ps.botControlled;
    }
    this.setupRevision++;
    this.enterInfoCheck();
    return OK;
  }
}
