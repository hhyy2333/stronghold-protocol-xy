// server/match/match/settle.js — Match methods: SETTLE (the LP loss — a leaker's 联防 survivors —, stats, bounty coins,
// the IN_BATTLE layer gains clamped by layerGainRoom, CHAR_DAMAGE tickers, eliminations, the 联防 outcome the SETTLE
// view carries) and RESULT (finish: m.result to every human still here, onEnd).
// Installed on Match.prototype by server/match/Match.js (a method container: never instantiated; `this` is the match).

import { PHASE, layerGainRoom } from '../../../shared/constants.js';
import { uniteSurvivors } from '../unite.js';
import { uniteLayerGainsOn } from './unitePhase.js';
import { buildResult } from '../results.js';
import { FLOW_TICKER_PRIORITY, DELAYS } from './common.js';
import { msg } from '../../../shared/i18n.js';
import { onSettle, resetRoundCounters } from '../botEmotes.js';
import { creditedKillsOf } from '../../sim/spec.js';
import { bankThiefPenalty, enemyHexPayoutFor, bountyMultiplier, lpLockedIn, bondLayerCapOf } from '../hextech.js';

export class MatchSettle {
  settle(plan, uniteResult) {
    this.phase = PHASE.SETTLE;
    this.runner = null;
    this._stopClientCombat();
    // the pending in-battle gains the views showed become persistent below (alive players) or lapse (DESIGN §20.15)
    for (const ps of this.order) if (ps.pendingLayerGains) { ps.pendingLayerGains = null; ps.dirty(); }
    const cap = this.gd.lpCapPerRound;
    // a 联防 battle that could not run at all (synthetic result) must not wipe the leakers' losses: charge their own leaks
    const uniteRan = !!(plan && uniteResult && !uniteResult.synthetic);
    const survivors = uniteRan ? uniteSurvivors(plan, uniteResult) : null;
    // The 联防's outcome as data for the SETTLE view (m.public.uniteResult, views.js; GitHub #235, PR #112 by @Convey123):
    // each client pops the official result box from it (ui/gameLogic/phases.js uniteResultBox) — `through` = the leakers'
    // enemies that still got through (uncapped; only decides whether 「全员无伤！」 is true), `losses` = every alive
    // player's own LP charge of this round, the same `loss` deducted below, so the box and the LP bar never disagree. A
    // leaker's own battle leaks are not its charge in a 联防 round, which is why the client cannot work the number out
    // itself. No ticker line: the official reports the outcome in the one dialog. null when no 联防 resolved.
    this.uniteResultView = uniteRan && plan.leakers.length ? {
      through: plan.leakers.reduce((n, lk) => n + Math.max(0, survivors.get(lk.playerId) || 0), 0),
      helpers: plan.helpers.map((p) => p.playerId),
      leakers: plan.leakers.map((p) => p.playerId),
      losses: {},
    } : null;
    const alive = this.alivePlayers();
    for (const ps of alive) {
      const r = this.lastResults.get(ps.playerId) || { leaked: [], perfect: true, coins: 0, layerGains: {}, killed: 0, damageDealt: 0 };
      const counted = (r.leaked || []).filter((l) => l && l.counted !== false).length;
      const levelLeak = this.gd.protocolLevelMods ? this.gd.protocolLevelMods.leakLp : 0;
      const rawLoss = uniteRan && plan.leakers.includes(ps) ? (survivors.get(ps.playerId) || 0) : counted;
      // 背水一战 (业主 2026-10-24): 「锁血两回合」 — while the card's window is open the target life does NOT drop, however
      // many enemies leaked. The stats count what was actually charged (0), so the panel never reports a fake loss.
      const locked = lpLockedIn(ps, this.round);
      const loss = locked ? 0 : Math.min(cap, rawLoss + (rawLoss > 0 ? levelLeak : 0));
      if (this.uniteResultView) this.uniteResultView.losses[ps.playerId] = loss;
      ps.lp -= loss;
      ps.stats.lpLost += loss;
      ps.stats.leaks += counted;
      ps.stats.kills += Number(r.killed) || 0;
      ps.stats.dmgDealt += Number(r.damageDealt) || 0;
      ps.stats.healing += Number(r.healingDone) || 0;
      // Per-unit totals for the settlement's MVP (results.js mvpOf; owner's rule 2026-10-06: the result screen speaks
      // with each player's OWN team MVP). The verified battle report (fields.js `unitStats`) is the only place per-unit
      // damage/kills exist, so they are summed per defId here — and never leave the server except as the chosen MVP.
      const mergeUnits = (list) => {
        for (const u of Array.isArray(list) ? list : []) {
          if (!u || typeof u.defId !== 'string') continue;
          const cur = ps.stats.unitStats.get(u.defId) || { dmg: 0, kills: 0, heal: 0 };
          cur.dmg += Math.max(0, Number(u.dmg) || 0);
          cur.kills += Math.max(0, Math.trunc(Number(u.kills) || 0));
          cur.heal += Math.max(0, Number(u.heal) || 0);
          ps.stats.unitStats.set(u.defId, cur);
        }
      };
      mergeUnits(r.unitStats);
      if (r.perfect !== false && counted === 0) ps.stats.perfectRounds++;
      // bounty coins (own battle + unite kills) are credited to the next prep.
      // 悬赏倍增 (业主 2026-10-20): the BOUNTY half of this settlement is multiplied by the card's number. The reader
      // existed since the card landed but NOTHING called it, so owning 悬赏倍增 only ever put a ref in the effects
      // column — 「无效」. Everything that is not a bounty (过路费's leak money below, a card's own rebate) is added
      // AFTER this, so it keeps its own number: the card reads 「你获得的悬赏资金」.
      const bountyMul = bountyMultiplier(ps);
      const bounty = (v) => Math.max(0, Math.trunc(Number(v) || 0)) * bountyMul;
      let coins = bounty(r.coins);
      const up = uniteResult && uniteResult.perPlayer && uniteResult.perPlayer[ps.playerId];
      if (up) {
        coins += bounty(up.coins);
        ps.stats.dmgDealt += Number(up.damageDealt) || 0;
        ps.stats.kills += Number(up.killed) || 0;
        // 本局累计伤害统计: the 联防 field's own per-unit numbers join the player's match-long totals (round.js _addCumStats).
        // The player's own battle was already folded when its result came in (_finishCombat) — this is the 联防 battle,
        // a separate one, so nothing is counted twice.
        ps._addCumStats(up);
        mergeUnits(up.unitStats);   // 联防 kills count for the MVP too
      }
      ps.creditedKills += creditedKillsOf(r) + creditedKillsOf(up);
      // perfect-payout bounties (战术特训): own phase perfect
      for (const b of ps.bounties) if (b.card.payout === 'perfect' && counted === 0 && r.perfect !== false) coins += bounty(b.card.coin);
      // 过路费 (业主 2026-10-20): the enemy card pays for what leaked — the same coin channel the bounties use (next
      // prep's pendingFunds), capped per battle. Counted off the battle's OWN `leaked` list so the LP charge and the
      // payment always speak about the same enemies (a 器物 / 首领漏怪 costs no LP and therefore buys no funds).
      const hexPayout = enemyHexPayoutFor(this, r.leaked);
      coins += hexPayout;
      if (coins > 0) { ps.pendingFunds += coins; ps.stats.fundsGained += coins; }
      // 悬赏通道里的**协议源石**那一份（业主 2026-11-01「海克斯提供的钱不计入 n19 的 30 块上限」）：
      //   ① 骑士金神的击杀金币（battle.addCoins(pid, 1, { hex: true }) → 战报的 `coinsHex`，sim/battle/economy.js）；
      //   ② 过路费（`hexPayout`，纯协议源石来源）。
      // 这两笔与真悬赏金在同一条 `pendingFunds` 里，所以另记一份 `pendingHexFunds`：回合开始时 round.js startRound
      // 把 income + pending 合成一笔 `addFunds(…, 'income')`，economy.js `_hexFundsExempt` 按这一份豁免上限。
      // 只豁免**协议源石那部分** —— `r.coins` / `up.coins` 里剩下的、以及战术特训的 perfect 悬赏照旧计入额度；
      // `bountyMul`（悬赏倍增）只乘在悬赏上，所以 `coinsHex` 按**原始数**豁免：被乘出来的零头仍计入额度。
      const hexCoins = Math.max(0, Math.trunc(Number(r.coinsHex) || 0))
        + Math.max(0, Math.trunc(Number(up && up.coinsHex) || 0))
        + hexPayout;
      if (hexCoins > 0) ps.pendingHexFunds = (ps.pendingHexFunds || 0) + hexCoins;
      for (const b of ps.bounties) b.roundsLeft--;
      ps.bounties = ps.bounties.filter((b) => b.roundsLeft > 0);
      // IN_BATTLE layer gains: the player's own battle, plus — for a 【突破极限】 owner only (业主 2026-11-01) — the 联防
      // field's gains (the unite spec turns them on per player: flags.layerGainsByPlayer, unitePhase.js). At most the
      // room left under THIS player's cap (BOND_LAYER_CAP 999 — 9999 with the card, hextech.js bondLayerCapOf; the
      // battle's live copy clamped the same way, Battle.addLayers); a bond at the cap gains nothing and dispatches nothing.
      // A NON-owner's 联防 gains are dropped even when a report carries them: the client-result check refuses them first
      // (fields.js), this is the second gate.
      const layerCap = bondLayerCapOf(ps);
      const battleGains = { ...(r.layerGains || {}) };
      if (up && up.layerGains && uniteLayerGainsOn(ps)) {
        for (const [bondId, n] of Object.entries(up.layerGains)) {
          const v = Number(n);
          if (!Number.isFinite(v) || v <= 0) continue;
          battleGains[bondId] = (battleGains[bondId] || 0) + v;
        }
      }
      for (const [bondId, n] of Object.entries(battleGains)) {
        if (!this.gd.bond(bondId) || !(n > 0)) continue;
        const before = ps.layers[bondId] || 0;
        const add = layerGainRoom(before, Math.floor(n), layerCap);
        if (!(add > 0)) continue;
        ps.layers[bondId] = before + add;
        this.dispatch(ps, 'onLayers', { bondId, from: before, to: ps.layers[bondId], reason: 'battle' });
      }
      this._charDamageTickers(ps, r);
      // 窃贼 (业主 2026-10-19): the knock-outs this battle counted become next round's income penalty, capped. Banked
      // per player BEFORE onBattleResult so a card that reads the bank sees the same number the income pass will.
      try { bankThiefPenalty(this, ps, Number(r && r.deaths) || 0); } catch (e) { this.reportError('thief bank', e); }
      this.dispatch(ps, 'onBattleResult', { result: r, lpLoss: loss, perfect: counted === 0 && r.perfect !== false, unite: uniteResult || null });
      ps.recompute();
    }
    for (const ps of alive) {
      if (ps.lp <= 0) {
        ps.lp = 0;
        ps.eliminate(this.round);
        this.toast(ps, 'error', '你的目标生命值耗尽，已被淘汰');
        this.tickerText(msg('{name}博士的目标生命值已耗尽', { name: ps.name }), FLOW_TICKER_PRIORITY);
      }
    }
    this.fields = [];
    this.watchers.clear();
    this.markPublic();
    onSettle(this); // one emote per alive AI per round (enabled by default; SP_BOT_EMOTES=0 silences it)
    this.setDeadline(DELAYS.SETTLE / 1000, () => this.afterSettle(), { silent: this.soloUntimed });
  }

  /**
   * CHAR_DAMAGE tickers: one per board unit of the battle (its highest threshold); units created in battle (summons,
   * no board uid) count once per unit type (the highest of them) — a result can never announce more units than the
   * lineup has kinds of.
   */
  _charDamageTickers(ps, r) {
    const steps = (Array.isArray(this.gd.config.broadcasts) ? this.gd.config.broadcasts : []).filter((b) => b.type === 'CHAR_DAMAGE' && Array.isArray(b.params)).map((b) => Number(b.params[0])).filter((n) => n > 0).sort((a, b) => b - a);
    if (!steps.length) return;
    const board = new Set();
    for (const p of ps.board.values()) board.add(p.uid);
    const best = new Map();
    for (const u of r.unitStats || []) {
      if (!u) continue;
      const key = Number.isInteger(u.uid) && board.has(u.uid) ? `uid:${u.uid}` : `def:${u.defId}`;
      const cur = best.get(key);
      if (!cur || (Number(u.dmg) || 0) > (Number(cur.dmg) || 0)) best.set(key, u);
    }
    for (const u of best.values()) {
      const hit = steps.find((s) => (u.dmg || 0) >= s);
      if (hit) this.tickerFor('CHAR_DAMAGE', [ps.name, u.name || u.defId, String(hit)], { playerId: ps.playerId, param: String(hit) });
    }
  }

  afterSettle() {
    if (!this.alivePlayers().length) { this.finish({ victory: false, reason: 'eliminated' }); return; }
    // 第16回合「木桩演练」(docs/research/17-dummy-round.json, Lead 2026-10-29): the round after the Hidden Core is the
    // match's LAST round, so its settlement ends the match instead of starting round 17. The result is the one the team
    // already earned — a victory with the hidden core cleared (that is the only way into this round; bossRounds.js
    // _finishFinal sets `hiddenCoreCleared`) — so roundsPassed stays bossRound + 1 = 15 (results.js), and the rewards /
    // trophies / medals do not see the dummy round at all. A team that loses every seat in the dummy round is
    // eliminated by the branch above and gets the ordinary defeat, exactly like a normal round.
    if (this.gd.dummyRound != null && this.round === this.gd.dummyRound) {
      this.finish({ victory: true, hiddenCleared: this.hiddenCoreCleared === true, reason: 'victory' });
      return;
    }
    resetRoundCounters(this); // AI bot merge-counter resets each round (server/match/botEmotes.js)
    this.startRound(this.round + 1);
  }

  finish({ victory, hiddenCleared = false, reason = 'defeat' }) {
    if (this.ended || this.disposed) return;
    this.ended = true;
    if (this.runner) { try { this.runner.stop(); } catch { /* ignore */ } this.runner = null; }
    this._stopClientCombat();
    this.cancel(this._phaseTimer);
    this.cancel(this._turnTimer);
    for (const h of this._timers) { try { this.sched.clearTimeout(h); } catch { /* ignore */ } }
    this._timers.clear();
    this.phase = PHASE.RESULT;
    this.deadline = 0;
    for (const f of this.fields) f.live = false;
    this.outcome = { victory: !!victory, hiddenReached: this.hiddenReached, hiddenCleared: !!hiddenCleared, reason };
    let result;
    try {
      result = buildResult(this, this.outcome);
    } catch (e) {
      this.reportError('buildResult', e);
      result = { t: 'm.result', victory: !!victory, roundsPassed: 0, reason, modeId: this.modeId, difficulty: this.difficulty, players: [] };
    }
    this.lastResultMsg = result;
    // the match's LAST m.public is sent in full: the lobby keeps that frame and replays it to a resume / reload that
    // comes back to the result screen without a baseline to merge into (a delta there could not be applied — DESIGN
    // §8.2, incremental frame)
    this.markPublicFull();
    this.markPublic();
    try { this.flush(true); } catch (e) { this.reportError('flush', e); }
    // every human still here gets the settlement — the spectator seats the same public rows (none of them their own)
    for (const ps of this._viewers()) this.sendTo(ps.playerId, { ...result, playerId: ps.playerId });
    const { t, ...summary } = result;
    void t;
    summary.errors = this.errorCount;
    // 走的是哪条路径，不许静默 (业主裁令 2026-10-12): 参与人数决定超容变体（每人独立池 / 分小队联防），
    // 所以结算日志里必须看得到人数与闸门状态。
    this.log?.info?.(`[match] ${this.roomCode} settled (${summary.reason}) participants=${this.participants} variant=${this.variant === true}`);
    try { this.onEndFn(summary); } catch (e) { this.reportError('onEnd', e); }
  }
}
