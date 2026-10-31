// server/sim/content/enemies/dummy.js — 木桩演练 (round 16): the training dummy the player hits to read their damage.
//
// A round that puts one dummy on the field and lets the player measure output needs an enemy that does nothing back —
// no attack, no walk, and a HP pool large enough that the measurement runs to the end of the round. None of those is a
// new mechanic: each one is an engine primitive that already exists, so the kit is three lines of declaration and no
// simulation of its own.
//
//   · 不还手 — `e.profile.noAttack` (ai.js enemyAttack / attackStand return early, the same flag 黑蛇 and the 深溟巢涌者's
//     talent aura use): the dummy never picks a target and never swings.
//   · 不移动 / 不可阻挡 — the persistent buff SELF_BOUND installs for the 巨型单位 (bosses.js): `noMove` + `selfBound`
//     + `unblockable`. 自缚 (PRTS 异常效果 UNMOVABLE_PRIVATE) is "cannot move" and is deliberately not `bind`, so this is
//     not something a 束缚 immunity could cancel either way — the dummy stands on its spawn tile whatever its route
//     says, and no operator can block it (so it is never dragged off the tile the player aims at).
//   · 自愈 — no code here: the data row's `stats.hpRecoveryPerSec` is the engine's own natural regeneration
//     (units.js → `s.hpRegen`, paid out in battle/status.js), exactly like 得意 / 宿主重装士兵 whose regen is data too
//     (enemies.js STATS_ONLY: "regen is data"). Writing a heal in this kit would double it and break determinism-free
//     arithmetic for nothing.
//
// 控制免疫 is likewise left to the data row (the `immunities` copied from its template): whether a 晕眩 / 束缚 can land on
// the dummy changes nothing it does — it is 自缚 and 不还手 anyway — so no immunity is authored here.
//
// Registered through KITS in enemies.js; the key is NOT in STATS_ONLY (enemies.js asserts one or the other, never both).

/**
 * The 木桩: 不还手 (noAttack). 自缚 / 无法被阻挡 come from `bosses.js SELF_BOUND` — the key is on that list because it
 * takes 「萨米的意志」's 4.95 × 2.95 body (owner 2026-10-30「木桩的受击范围」), and that installer runs before the BOSS_KITS
 * early return for exactly this case. 自愈 is the data row's `hpRecoveryPerSec` and needs no ability.
 */
export const DUMMY_KITS = Object.freeze({
  // 木桩 · 木桩演练 (round 16): stands still, hits nothing, refills from its own data regen
  enemy_9901_dummy: () => [{
    spawn(b, e) { e.profile.noAttack = true; },
  }],
});
