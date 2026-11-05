// 第16回合「木桩演练」(docs/research/17-dummy-round.json, Lead 2026-10-29): the dummy round that comes AFTER the
// Hidden Core — data (round / wave / enemy row), the five server-wiring points, and the end-to-end flow
// 「R15 清完 → R16 → finish（不是 startRound(17)）」with roundsPassed pinned at 15 (i.e. the dummy round must NOT move
// the settlement, the rewards or the trophies).
//
// The data side is checked through the REAL build output (test/match/harness.js DATA = data/*.json), so a stale or
// hand-edited data/ tree fails here as well as in test/data.test.js.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PHASE } from '../../shared/constants.js';
import { GameData } from '../../server/match/gamedata.js';
import { buildNormalWave } from '../../server/match/waves.js';
import { matchEnemyMods } from '../../server/match/hextech.js';
import { createRng } from '../../server/sim/rng.js';
import { buildBattleSpec, createBattleFromSpec } from '../../server/sim/spec.js';
import { attachAudit } from '../../server/match/audit.js';
import { FakeBattle } from './fakeBattle.js';
import { DATA, makeMatch, checkInvariants } from './harness.js';

/** The six modes with a hidden core — the only ones that get a dummy round. */
const DUMMY_MODES = ['mode_single_normal', 'mode_single_hard', 'mode_single_abyss', 'mode_multi_normal', 'mode_multi_hard', 'mode_multi_abyss'];
/** Modes without a hidden core: no R15, therefore no R16. */
const NO_DUMMY_MODES = ['mode_single_funny', 'mode_multi_funny', 'mode_training_1'];

const normalFields = (round) => FakeBattle.instances.filter((b) => b.kind === 'normal' && b.round === round);

test('data: the six hidden-core modes have rounds["16"] + dummyRound; lastRound / bossRound / hiddenRound are untouched', () => {
  for (const modeId of DUMMY_MODES) {
    const gd = new GameData(DATA, modeId);
    const rc = gd.roundCfg(16);
    assert.ok(rc, `${modeId}: rounds["16"]`);
    assert.equal(gd.dummyRound, 16, `${modeId}: gd.dummyRound`);
    assert.equal(rc.template, 'custom_dummy', `${modeId}: template`);
    assert.equal(rc.bossTemplates, null, `${modeId}: not a leader round`);
    // 65 real seconds = the measurement window (60 s) + the 自爆 window (5 s) = 130 game s (× combatTimeScale 2)
    assert.equal(rc.combatTimeLimit, 65, `${modeId}: combatTimeLimit`);
    assert.equal(rc.levelMaxPlayTime, 65, `${modeId}: levelMaxPlayTime`);
    assert.equal(gd.combatTimeLimit(16), 130, `${modeId}: 130 game seconds`);
    // owner 2026-11-05「给这个木桩怪物加一个到时间自动爆炸」＋「把第16回合的时间加5秒钟，并且在最后5秒内所有怪物强制自杀」:
    // the 自爆 moment is the OLD limit (60 real s = 120 game s), so it lands INSIDE the round and the survivors die as
    // deaths instead of being counted as 漏怪 by the time limit. The measurement window (and therefore every DPS reading)
    // is the same 60 real seconds it always was.
    assert.equal(rc.enemySelfDestructAt, 60, `${modeId}: 自爆 at 60 real s`);
    assert.equal(gd.enemySelfDestructAt(16), 120, `${modeId}: 120 game seconds`);
    assert.ok(gd.enemySelfDestructAt(16) < gd.combatTimeLimit(16), `${modeId}: the 自爆 lands inside the round`);
    assert.equal(rc.isBoss, false, `${modeId}: isBoss`);
    assert.equal(rc.isHidden, false, `${modeId}: isHidden`);
    assert.equal(rc.isDummy, true, `${modeId}: isDummy`);
    assert.equal(rc.bossOvertimeAfter, null, `${modeId}: no overtime drain`);
    assert.equal(rc.prepTimeData, 195, `${modeId}: prepTimeData`);
    // SINGLE is untimed (docs/DATA.md §1.1; prep.js prepDeadlineSeconds), MULTI takes the research's 195
    assert.equal(rc.prepTime, gd.isSolo ? null : 195, `${modeId}: prepTime`);
    // the three round markers are exactly what they were before the dummy round existed
    assert.equal(gd.lastRound, 14, `${modeId}: lastRound`);
    assert.equal(gd.bossRound, 14, `${modeId}: bossRound`);
    assert.equal(gd.hiddenRound, 15, `${modeId}: hiddenRound`);
    // neutral enemy multipliers: any other value would scale the dummy's 2,000,000,000 (enemyScaleFor clamps a round past
    // the table to its last row — ABYSS kHp 7 ⇒ hp ×2.87 — and waves.js templateSpawns multiplies every non-leader spawn)
    assert.deepEqual(gd.enemyScale(16), { hpMul: 1, atkMul: 1, speedMul: 1 }, `${modeId}: neutral enemyScale`);
    // …and the 自爆 rule belongs to round 16 alone: no official round declares one
    for (let r = 1; r <= 15; r++) assert.equal(gd.enemySelfDestructAt(r), null, `${modeId}: round ${r} has no 自爆`);
    assert.equal(gd.enemySelfDestructAt(17), null, `${modeId}: no round 17`);
  }
  for (const modeId of NO_DUMMY_MODES) {
    const gd = new GameData(DATA, modeId);
    assert.equal(gd.dummyRound, null, `${modeId}: no dummyRound`);
    assert.equal(gd.roundCfg(16), null, `${modeId}: no rounds["16"]`);
    assert.equal(DATA.config.modes[modeId].dummyRound, undefined, `${modeId}: no data field`);
  }
});

test('data: the dummy enemy row — 木桩, ELITE, 2,000,000,000 HP + 2,000,000,000/s regen, lpr 0, acdeer\'s art, no hitArea', () => {
  const gd = new GameData(DATA, 'mode_multi_hard');
  const e = gd.enemy('enemy_9901_dummy');
  assert.ok(e, 'enemy_9901_dummy is in enemies.json');
  assert.equal(e.name, '木桩');
  // rank ELITE, not BOSS: the sim decides 首领 by the spawn's tag, and a BOSS rank would make the CLIENT draw a leader
  assert.equal(e.rank, 'ELITE');
  assert.equal(e.stats.maxHp, 2000000000, '20 亿 (owner 2026-10-31)');
  assert.equal(e.stats.atk, 0, 'does not fight back');
  assert.equal(e.stats.moveSpeed, 0, 'does not move');
  // def 0 / res 0 = an unarmoured target: `max(A − D, 5 %·A)` would otherwise compress every low-ATK operator's reading
  // to 5 % or less (acdeer's own 800 / 40 is exactly that trap) and the round could not compare them at all
  assert.equal(e.stats.def, 0);
  assert.equal(e.stats.res, 0);
  assert.equal(e.stats.bat, 6);
  assert.equal(e.stats.blockCnt, 1);
  assert.equal(e.stats.massLevel, 10);
  // lpr 0: a leaked dummy must cost no LP — that is what makes a measurement-only round possible
  assert.equal(e.stats.lpr, 0);
  assert.equal(e.stats.hpRecoveryPerSec, 2000000000, '每秒回 20 亿 = 一整个血条／秒');
  // 锁血 is a KIT rule, not a data column: `enemies.json` has no death-prevention field, so
  // server/sim/content/enemies/dummy.js installs it through the `fatal` hook (test/sim/dummy.test.js pins the behaviour).
  // What must stay absent here is a `staticBody` / invulnerability flag — those are different rules (a body that cannot
  // be moved vs a unit that takes no damage at all).
  assert.equal(e.staticBody, undefined);
  // 素材照抄萨米（客户端实际绘制走 data/assets.json 的 spine/spineAliasOf，由 tools/fetch-assets.mjs 产生）
  assert.equal(e.iconId, 'enemy_9033_acdeer');
  assert.equal(e.spine, 'enemy_9033_acdeer');
  // hitArea is the HIT_AREAS marker (⇔ bosses.js SELF_BOUND): the dummy takes 「萨米的意志」's 4.95 × 2.95 body because it
  // draws that model and stands where a leader stands (owner 2026-10-30「木桩的受击范围」).
  assert.deepEqual(e.hitArea, { w: 4.95, h: 2.95, dx: 0, dy: 1 });
  // the whole rest of the row is the template enemy's (「用萨米的意志复制改改」)
  const src = gd.enemy('enemy_9033_acdeer');
  assert.deepEqual(e.talents, src.talents);
  assert.deepEqual(e.skills, src.skills);
  assert.equal(e.applyWay, src.applyWay);
});

test('wave: custom_dummy has exactly ONE spawn — the dummy itself, not a leader and not replaced by the round\'s pool', () => {
  // Lead 2026-10-29 修正 2: waves.js templateSpawns looks a normal spawn up in `placeholderMap` and REPLACES it with the
  // round's drawn enemy when it hits. The dummy is not in that table, so it must come through untouched — this
  // assertion is the guard against someone ever registering it in a faction pool.
  const gd = new GameData(DATA, 'mode_multi_hard');
  const wave = buildNormalWave(gd, createRng(1), gd.factions, 16);
  assert.equal(wave.templateId, 'custom_dummy');
  assert.equal(wave.spawns.length, 1, 'one spawn, always');
  const sp = wave.spawns[0];
  assert.equal(sp.enemyKey, 'enemy_9901_dummy');
  assert.equal(sp.count, 1);
  assert.equal(sp.time, 0, 'on the field from the first game second');
  assert.equal(sp.tag, undefined, 'neither 首领 nor 零件 —— 首领会被并进共享血池，零件不计入本回合总数');
  assert.deepEqual(sp.mods, { hpMul: 1, atkMul: 1, speedMul: 1, slot: 'E' }, 'neutral multipliers: 2,000,000,000 arrives as is');
  assert.equal(wave.routes.length, 1);
  // 业主 2026-10-30「16回合没有设置成boss回合，导致地图有问题」: the post stands where a LEADER stands — on the arena
  // rows of the official leader wave (act1autochess_h07_07's route 8, [3,10] → [2,2]) — because the round is played on
  // the BOSS DEPLOY FIELD. It is not on the normal lane's (9,9) any more.
  assert.deepEqual(wave.routes[0].start, [3, 10], 'stands in the arena, on the official leader route');
  assert.deepEqual(wave.routes[0].end, [2, 2]);
  // …and that tile is walkable on EVERY stage a mode can draw (never a wall # / the hard divider X)
  for (const [id, st] of Object.entries(DATA.stages)) {
    const ch = st.rows && st.rows[3] && st.rows[3][10];
    assert.ok(ch && ch !== '#' && ch !== 'X', `${id}: the dummy's tile (3,10) must be walkable, got ${ch}`);
  }
  assert.equal(wave.timeLimit, 130, '65 real seconds × the forced 2× speed');
  // owner 2026-11-05「到时间自动爆炸」: the round's own 自爆 moment travels with the wave (game seconds), so `_normalOpts`
  // can put it on the battle opts / BattleSpec without the battle having to know what round it is.
  assert.equal(wave.enemySelfDestructAt, 120, 'the old 60 real-second limit: the 自爆 window is the last 5 s of the round');
  // the data file agrees with what the runtime built
  const tpl = gd.wave('custom_dummy');
  assert.equal(tpl.kind, 'normal');
  assert.equal(tpl.maxPlayTime, 65);
  assert.equal(tpl.spawns.length, 1);
  assert.deepEqual(tpl.usedBy.map((u) => [u.modeId, u.round, u.bossId]), DUMMY_MODES.map((m) => [m, 16, null]));
});

for (const [label, opts] of [
  ['coop 2 humans', { mode: 'coop', difficulty: 'NORMAL', humans: 2, seed: 61 }],
  ['solo HARD', { mode: 'solo', difficulty: 'HARD', seed: 62 }],
]) {
  test(`${label}: 隐藏核心清完 → 第16回合（普通回合、无首领配对）→ 打完 finish，roundsPassed 仍 = 15`, () => {
    const h = makeMatch({ ...opts, fake: true, script: (b) => (b.kind === 'boss' || b.kind === 'hidden' ? { bossDps: 1e9 } : {}) }).start();
    const m = h.m;
    assert.equal(m.gd.dummyRound, 16);
    h.toPrep(14);
    h.drive(() => m.phase === PHASE.FINAL_ASSAULT);
    m.hiddenLayerSum = 1e6; // the Hidden Core opens (same route as test/match/followups.test.js)
    h.drive(() => m.phase === PHASE.PREP && m.round === 16);
    assert.equal(m.round, 16, 'the dummy round follows the hidden core');
    assert.equal(m.phase, PHASE.PREP);
    assert.equal(m.hiddenReached, true);
    // the hidden core's result travels across the extra round: settle.js reads it when it finally finishes the match
    assert.equal(m.hiddenCoreCleared, true);
    assert.equal(m.bossPool, null, 'no shared leader pool during the dummy round');
    // 业主 2026-10-30: the round must stand on the BOSS DEPLOY FIELD (that was the map complaint) while staying a
    // NORMAL combat — so bossWaves carries the group for deployFieldOf / the pairing preview, and nothing else:
    // no pool (no bloodPoint override of the 20 亿), no BOSS_HIT 限伤, no overtime LP drain.
    assert.ok(Array.isArray(m.bossWaves) && m.bossWaves.length > 0, 'the dummy round registers a boss-field group');
    assert.equal(m.bossWaves[0].wave, m.wave, 'the group carries the very wave the combat spawns from');
    assert.equal(m.bossPool, null, 'still no shared leader pool');
    for (const ps of m.alivePlayers()) assert.ok(['bossL', 'bossR'].includes(m.deployFieldOf(ps)), `${ps.name} deploys on the boss field`);
    assert.equal(m.wave.templateId, 'custom_dummy');
    assert.equal(m.wave.spawns.length, 1);
    assert.equal(m.wave.spawns[0].enemyKey, 'enemy_9901_dummy');
    // the client can tell the round apart
    assert.equal(h.publicView().dummyRound, 16, 'm.public carries dummyRound');
    // single-player prep is untimed by convention (prep.js prepDeadlineSeconds) — the data's prepTime is 195 only for MULTI
    assert.equal(m.prepDeadlineSeconds(), m.gd.isSolo ? null : 195);
    // the dummy is the only enemy of the round, and the battle window is the 65 real seconds the round declares — with
    // the 自爆 at the old 60 s mark riding on the battle opts (owner 2026-11-05)
    h.drive(() => m.phase === PHASE.COMBAT && m.round === 16);
    const fields = normalFields(16);
    assert.ok(fields.length >= 1, 'the round\'s battles were created');
    // the enemy 协议源石 (敌方的 ehex_* cards) buff every enemy of the round, the dummy included — so the field's
    // multiplier is the wave's own (1, asserted above) times the drawn card's. Nothing else may scale it.
    const hex = matchEnemyMods(m);
    const hexHp = Number.isFinite(hex.hpMul) ? hex.hpMul : 1;
    for (const f of fields) {
      assert.equal(f.opts.waveId, 'custom_dummy');
      assert.equal(f.opts.timeLimit, 130);
      // 业主 2026-11-05「到时间自动爆炸」: the field carries the 自爆 moment, so the server-run battle, the client's
      // BattleSpec and the 复算 all end the round the same way.
      assert.equal(f.opts.enemySelfDestructAt, 120, `${f.opts.fieldId}: 自爆 at 120 game s`);
      const dummy = f.opts.spawns.filter((s) => s.enemyKey === 'enemy_9901_dummy');
      assert.equal(dummy.length, 1, `${f.opts.fieldId}: one dummy spawn group`);
      assert.ok(dummy[0].count >= 1);
      assert.equal(dummy[0].tag, undefined);
      // 虫群 (countAdd) is the only card that may raise the count; no other enemy card may turn the dummy into a second one
      if (!Number.isFinite(hex.countAdd)) assert.equal(dummy[0].count, 1);
      assert.equal(dummy[0].mods.hpMul, 1 * hexHp, 'the round scale is neutral; only the enemy hex may add to it');
      assert.equal(dummy[0].mods.atkMul, 1 * (Number.isFinite(hex.atkMul) ? hex.atkMul : 1));
    }
    // …and the dummy round ENDS the match instead of starting round 17
    const end = h.runToEnd();
    assert.equal(m.phase, PHASE.RESULT);
    assert.equal(m.ended, true);
    assert.equal(m.round, 16, 'no round 17 was started');
    assert.equal(end.victory, true);
    assert.equal(end.hiddenCleared, true, 'the hidden core result survives the extra round');
    assert.equal(end.hiddenReached, true);
    // results.js: teamRounds = bossRound + hiddenCleared = 14 + 1 = 15 — the dummy round moves nothing
    assert.equal(end.roundsPassed, 15);
    for (const row of end.players) assert.equal(row.roundsPassed, 15, `${row.playerId}: roundsPassed`);
    checkInvariants(m);
    m.dispose();
  });
}

test('mode without a hidden core (FUNNY): the match still ends at the Final Assault, no round 16 is reached', () => {
  const h = makeMatch({ mode: 'coop', difficulty: 'FUNNY', humans: 2, seed: 63, fake: true, script: (b) => (b.kind === 'boss' ? { bossDps: 1e9 } : {}) }).start();
  const m = h.m;
  assert.equal(m.gd.dummyRound, null);
  const end = h.runToEnd();
  assert.equal(end.victory, true);
  assert.equal(end.roundsPassed, 14, 'bossRound only — there is no hidden core to clear');
  assert.equal(m.round, 14);
  checkInvariants(m);
  m.dispose();
});

// ---------------------------------------------------------------------------------------------------------------
// 到时间自爆 / LP 锁定 (owner 2026-11-05「第十六回合结束时会扣3点血…回合结束后玩家血量锁定不变」)

test('solo HARD: 第16回合结算不扣 LP —— 就算这一回合漏了 3 只（旧口径 3 点，协议等级 18 / 19 再 +2）也一点不扣', () => {
  // The reported bug: the round's time limit counted every surviving enemy as a 漏怪 (the dummy + the 悬赏 / 协议源石
  // enemies of the round), the settle charged one LP per counted leak, and on the match's LAST round that eliminated the
  // player and showed 游戏失败. The field-side 自爆 empties the field; this pins the belt-and-braces half: the settlement
  // itself charges nothing there, so even an enemy that leaked EARLIER in the round costs no LP.
  const h = makeMatch({
    mode: 'solo', difficulty: 'HARD', seed: 64, fake: true,
    script: (b) => (b.kind === 'boss' || b.kind === 'hidden' ? { bossDps: 1e9 } : b.round === 16 ? { leaks: { p_0: 3 } } : {}),
  }).start();
  const m = h.m;
  // the rule auditor (`tools/matchrun.mjs --check` uses the same attachAudit) checks the settlement's LP charge: its
  // settle rule knows the dummy round charges 0 (server/match/audit.js), so a regression on either side fails here.
  attachAudit(m);
  h.toPrep(14);
  h.drive(() => m.phase === PHASE.FINAL_ASSAULT);
  m.hiddenLayerSum = 1e6;
  h.drive(() => m.phase === PHASE.PREP && m.round === 16);
  const ps = m.players.get('p_0');
  const lp0 = ps.lp;
  const lost0 = ps.stats.lpLost;
  h.drive(() => h.ended != null);
  assert.ok(h.ended, 'the match finished');
  assert.equal(m.round, 16, 'it ended on the dummy round');
  assert.equal(m.lastResults.get('p_0').leaked.length, 3, 'the scripted leaks really happened');
  assert.equal(ps.lp, lp0, 'LP is unchanged: the dummy round locks it');
  assert.equal(ps.stats.lpLost, lost0, 'and the panel reports no fake loss');
  assert.equal(h.ended.victory, true, 'the round is still a victory');
  assert.equal(h.ended.hiddenCleared, true);
  assert.equal(h.ended.roundsPassed, 15);
  checkInvariants(m);
  m.dispose();
});

test('a normal round still charges LP for its leaks — the lock is the dummy round only', () => {
  const h = makeMatch({
    mode: 'solo', difficulty: 'HARD', seed: 66, fake: true,
    script: (b) => (b.kind === 'boss' || b.kind === 'hidden' ? { bossDps: 1e9 } : b.round === 13 ? { leaks: { p_0: 3 } } : {}),
  }).start();
  const m = h.m;
  h.toPrep(13);
  const ps = m.players.get('p_0');
  const lp0 = ps.lp;
  h.toPrep(14);
  assert.equal(ps.lp, lp0 - 3, 'R13 charged min(lpCapPerRound, 3 counted leaks) = 3, exactly as before');
  checkInvariants(m);
  m.dispose();
});

test('spec: the 自爆 moment survives the BattleSpec round trip — the server run, the client and 复算 all see it', () => {
  // The client fights from this spec and the server re-simulates it (server/match/match/clientCombat.js _specBattle): a
  // key that stopped at one of the two sides would end the round differently on each, which the verifier reports as a
  // dishonest result. `createBattleFromSpec` reads it back into the battle option.
  const spec = buildBattleSpec({ seed: 3, kind: 'normal', round: 16, timeLimit: 130, players: [], spawns: [], routes: [], enemySelfDestructAt: 120 });
  assert.equal(spec.enemySelfDestructAt, 120);
  assert.equal(createBattleFromSpec(spec, DATA).enemySelfDestructAt, 120);
  // every other round / an old data set: the key is absent and the battle behaves exactly as before
  const plain = buildBattleSpec({ seed: 3, kind: 'normal', round: 1, timeLimit: 120, players: [], spawns: [], routes: [] });
  assert.equal('enemySelfDestructAt' in plain, false, 'no key ⇒ byte-for-byte the old spec');
  assert.equal(createBattleFromSpec(plain, DATA).enemySelfDestructAt, null);
});
