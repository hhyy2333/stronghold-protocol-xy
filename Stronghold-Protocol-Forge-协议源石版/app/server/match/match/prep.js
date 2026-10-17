// server/match/match/prep.js — Match methods: the PREP phase — its start (deferred item merges, onPrepStart), the AI
// seats' sliced preps (scheduleBotPrep: economy + layout, rehearsal, Ready), Ready and the deadline, and its end
// (onPrepEnd, PlayerState.endPrep, then COMBAT or the Final Assault / Hidden Core).
// Installed on Match.prototype by server/match/Match.js (a method container: never instantiated; `this` is the match).

import { PHASE } from '../../../shared/constants.js';
import { botPrepBeginSteps, botPrepEndSteps, botSpendOnly as runBotSpendOnly } from '../bot.js';
import { DELAYS } from './common.js';

export class MatchPrep {
  enterPrep() {
    this.phase = PHASE.PREP;
    this.sp = null;
    const alive = this.alivePlayers();
    for (const ps of alive) {
      ps.ready = false;
      // Items gained as the previous prep ended waited unmerged (acquireItem deferMerge). Merge them now, before
      // this prep's onPrepStart grants and before the player acts — not in endPrep, which runs in the same prep
      // that granted them and would take an equipped copy off for the fight about to start.
      ps.checkItemMerges();
      ps.recompute();
      this.dispatch(ps, 'onPrepStart', { round: this.round });
      ps.recompute();
    }
    // A co-op room waits for every alive seat's Ready (maybeEndPrep), so a human able to press it must have a
    // deadline — otherwise that human's silence stalls the match forever (docs/PS100-MIGRATION.md §5, the
    // 「1 真人 + N AI」 room: `prepFallbackGuard`). `soloUntimed` still governs the OTHER phases (INFO_CHECK,
    // BAND_DRAFT, SP_DRAFT and the silent presentation steps); here the guard only hands that lone human the co-op
    // prep timer it was missing.
    //
    // The round's own prepTime decides 0 vs a deadline, exactly as before: a round that declares `prepTime: null`
    // means UNTIMED and stays untimed (the config is the authority on whether this round is timed at all — the
    // zero-delay ordering of `verification-slices.test.js` depends on it). The `infoCheck` 25 s guard is used ONLY
    // for the lone-human room, and never to time a round the data leaves untimed for anyone else.
    this.setDeadline(this.prepDeadlineSeconds(), () => this.prepDeadline());
    let i = 0;
    for (const ps of alive) if (ps.botControlled) this.scheduleBotPrep(ps, i++);
    this.markPublic();
    this.maybeEndPrep();
  }

  /**
   * Seconds of this round's prep deadline (null = untimed). The SINGLE definition of the rule, so the prep and the
   * `attachAudit` check can never drift apart:
   *
   *   * solo (and any room with no seat able to press Ready) → null: nobody waits on anybody, and there is no Ready
   *     gate that could stall;
   *   * solo, or the 「1 真人 + N AI」 同盟房 (`prepFallbackGuard`) → null: **不限时**（业主 2026-10-16 的决定，见下）；
   *   * 否则这一轮声明了 `prepTime` → 就是那个值（今天的常规行为，未变）；
   *   * 否则 → null：数据没给时限，就一直不限时。
   *
   * PORT NOTE 2026-10-16（业主：「同盟单人带人机不限时」）：这一档本来会在**轮次没声明时限**时退到官方
   * `timers.infoCheck`（25 s）兜底，理由是「那个人不按 Ready 就把整局卡死」（docs/PS100-MIGRATION.md hunk #4）。
   * 业主现在明确要求**不限时** —— 单人带人机是「自己跟自己玩」，不该被闹钟催，也不该在自己没准备好的时候被推进下一轮。
   * 所以那一档直接返回 null，且**优先于**轮次声明的 `prepTime`（本树每一轮都声明了 65/95/100…，不优先就盖不住）。
   * 代价是那个「防卡死」的兜底没了：一个人 + 人机的房里，房主不按 Ready 会一直留在休整期 —— 这是业主的选择。
   * §prepFallbackGuard§ 这个 getter 保留（它仍然准确描述「哪一个房间形态是独狼同盟房」），只是不再用来加时限。
   * @returns {number|null}
   */
  prepDeadlineSeconds() {
    // SOLO 与「1 真人 + N AI」的同盟房都不限时（业主 2026-10-16）。
    // 注意用 `prepFallbackGuard`（= !isSolo && loneHuman）而不是 `soloUntimed`：后者还包含「一个能按 Ready 的座位都没有」
    // 的情形，那一种本来就没有 Ready 门可卡，行为不变。
    if (this.isSolo || this.prepFallbackGuard) return null;
    return this.gd.prepTime(this.round) ?? null;
  }

  /**
   * 恶魔形态's takeover (协议源石 ctx.demonTakeover, DESIGN §29.23/§29.32): the AI spends this round FOR the named seat
   * — 调度中心 upgrades first, then operators with refreshes — and leaves placement, equipment and Ready to the player.
   * Refused outside a live match or for an eliminated seat. Returns the number of actions taken (0 when it could not
   * run), which is what the ctx primitive reports back to the card.
   * @param {import('../PlayerState.js').PlayerState} ps
   * @returns {number}
   */
  botSpendOnly(ps) {
    if (!ps || !ps.alive || this.ended) return 0;
    try {
      return runBotSpendOnly(this, ps);
    } catch (e) {
      this.reportError(`bot spend-only ${ps.playerId}`, e);
      return 0;
    }
  }

  /**
   * The bot plays a prep in three stages, every one in slices of ≤ botSliceMs wall-clock ms (one scheduler callback
   * each, so other rooms' battles and every player's requests keep flowing): economy + the default layout
   * (bot.js botPrepBeginSteps — shop decisions and layout planning, 50–120 ms late in a 4-bot match), the layout
   * rehearsal (whole simulated battles, 0.2–1 s of CPU per bot late in a match), then botPrepEndSteps (the rehearsed
   * layout, temp, Ready). The step generators run the same actions in the same order as the one-shot routine (same
   * rng draws, same decisions); in virtual time (botSliceMs unbounded) each stage runs at once. The prep ending first
   * (deadline) or a newer schedule for the seat drops the job (a step never leaves a transient board behind).
   * A rehearsal offered to the host's browser (botRehearsalDelegate, DESIGN §14 — AI teammates only) is not stepped
   * here: the job stays `pending` until MatchRehearsal accepts the host's pick (`done`, the layout ready to apply) or
   * takes it over, and only a takeover runs `job.run` — the server's slices, never a second simulation of what the host
   * already ran; a pick accepted before this driver subscribed to the job is applied just the same (`job.done`). Either
   * outcome is applied once the generator that offered the task has finished — it still places the default layout after
   * the delegation — which is why the continuation is installed here and not with the frame.
   */
  scheduleBotPrep(ps, i = 0) {
    const round = this.round;
    const token = (ps._botPrepToken = (ps._botPrepToken || 0) + 1);
    const valid = () => this.phase === PHASE.PREP && this.round === round && ps.alive && !ps.ready && ps.botControlled && ps._botPrepToken === token;
    const bounded = Number.isFinite(this.botSliceMs);
    const now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());
    /** Step a generator until done or the slice budget is used; `then(value)` once it is done (null on an error). */
    const drive = (gen, label, then) => {
      const t0 = now();
      let r = null;
      try {
        do r = gen.next(); while (!r.done && !(bounded && now() - t0 >= this.botSliceMs)); // loop-cap: generator and the bot time slice
      } catch (e) {
        this.reportError(`bot ${ps.playerId}${label}`, e);
        then(null);
        return;
      }
      if (r.done) { then(r.value); return; }
      this.later(0, () => { if (valid()) drive(gen, label, then); });
    };
    const ready = () => {
      if (!ps.ready) {
        this.autoPickPersonalChoice(ps, 'random');
        ps.resolveTemp();
        ps.setReady(true);
      }
    };
    const end = (job) => {
      let gen = null;
      try { gen = botPrepEndSteps(this, ps, job); } catch (e) { this.reportError(`bot ${ps.playerId}`, e); }
      if (!gen) { ready(); return; }
      drive(gen, '', ready);
    };
    /** The layout the finished job chose is applied in a callback of its own (bounded slices end one stage per call). */
    const finish = (job) => {
      if (bounded) this.later(0, () => { if (valid()) end(job); });
      else end(job);
    };
    /** The rehearsal's slices, once the job simulates locally (nobody answered, or the server took it over). */
    const runJob = (job) => {
      const slice = () => {
        if (!valid()) return;
        let done = true;
        try { done = job.run(this.botSliceMs); } catch (e) { this.reportError(`bot ${ps.playerId} rehearsal`, e); }
        if (done) finish(job);
        else this.later(0, slice);
      };
      // bounded slices start in a callback of their own (the economy + default layout above already used this one)
      if (bounded) this.later(0, slice);
      else slice();
    };
    this.later(this.scaled(DELAYS.BOT_ACTION + i * DELAYS.BOT_STAGGER), () => {
      if (!valid()) return;
      drive(botPrepBeginSteps(this, ps, { delegate: this.botRehearsalDelegate }), '', (job) => {
        if (!job) { end(null); return; }
        // A job is finished when it has nothing left to simulate: the server's own run over the candidates, or — with a
        // delegated one — the host's pick, which MatchRehearsal accepts as soon as it arrives, possibly while the
        // generator above was still placing the default layout (its `done` is already true here). Either way the layout
        // is ready: it is applied, never simulated again, and a later local run cannot overwrite the accepted pick.
        if (job.done) { finish(job); return; }
        // delegated and unanswered: MatchRehearsal calls back here — `done`, the pick already in `job.best`, nothing
        // left to simulate — or after the server took the job over, whose own slices follow; never once the prep ended.
        // The continuation is installed here rather than when the frame went out: the generator that offered the task
        // still places the default layout after the delegation returns (`applyPlanSteps`), so an outcome applied earlier
        // would set the seat Ready and drop those steps — an answer that arrived in the meantime is the `done` above.
        if (job.pending) {
          job.onSettled = () => {
            if (!valid()) return;
            if (job.done) finish(job);
            else { job.takeOver(); runJob(job); }
          };
          return;
        }
        runJob(job);
      });
    });
  }

  onReadyChanged(ps) {
    this.markPublic();
    void ps;
    this.maybeEndPrep();
  }

  maybeEndPrep() {
    if (this.phase !== PHASE.PREP || this._prepEndQueued) return;
    const allReady = () => { const alive = this.alivePlayers(); return alive.length > 0 && alive.every((p) => p.ready); };
    if (!allReady()) return;
    const round = this.round;
    this._prepEndQueued = true;
    // the prep deadline stays armed until the phase really ends: a player may un-ready before this runs
    this.later(0, () => {
      this._prepEndQueued = false;
      if (this.phase === PHASE.PREP && this.round === round && allReady()) this.endPrep();
    });
  }

  prepDeadline() {
    if (this.phase !== PHASE.PREP) return;
    for (const ps of this.alivePlayers()) {
      if (ps.ready) continue;
      this.autoPickPersonalChoice(ps, 'random');
      ps.resolveTemp();
      ps.ready = true;
      ps.dirty();
    }
    this.endPrep();
  }

  endPrep() {
    if (this.phase !== PHASE.PREP) return;
    // rehearsals still waiting for a host's answer die with the prep: their bots place the default layout, a late answer
    // is ignored (Match._takeOverRehearsal / MatchRehearsal) and nothing of them runs after the phase ended
    this._cancelRehearsal();
    this.setDeadline(0);
    const alive = this.alivePlayers();
    for (const ps of alive) this.dispatch(ps, 'onPrepEnd', { round: this.round });
    for (const ps of alive) ps.endPrep();
    const r = this.round;
    if (r === this.gd.bossRound) {
      this.hiddenLayerSum = alive.reduce((s, p) => s + p.activatedLayers(), 0);
      this.startFinalAssault(false);
    } else if (r === this.gd.hiddenRound) {
      this.startFinalAssault(true);
    } else {
      this.startCombat();
    }
  }
}
