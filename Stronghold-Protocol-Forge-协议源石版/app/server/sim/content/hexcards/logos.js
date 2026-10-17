// server/sim/content/hexcards/logos.js — 逻各斯 (hex_logos) battle script.
//
// CARD (the owner's list of 2026-10-12, §29.27, copied verbatim): 「作战中，己方干员的攻击范围内，生命值低于该干员攻击力
// 120% 的敌人立刻倒下：造成 9999999 点无来源真实斩杀伤害，无法被闪避、格挡或未命中取消。此效果为光环效果，不依赖攻击
// 行为。」
//
// This is the 自选 operator kit of 逻各斯' own S1 殁亡, lifted from one operator's skill to a card that every own operator
// carries (server/sim/content/kits/ops/op-logos.js is the source of the reading — the official skill text is
// 「使攻击范围内生命值低于逻各斯攻击力120%的敌人立刻倒下」 at Lv7, and its 备注 calls the blow 「无来源真实斩杀伤害」).
// The two readings the card's own text settles, and the two it does not:
//   * 「攻击范围内」 = the operator's CURRENT attack range (`unit.rangeKeys`, rebuilt by Battle._refreshRange), so a
//     skill that widens the range widens the aura with it. The range test goes through the engine's own query
//     (`battle.enemiesInKeys`), which is also what decides selectability: an enemy that is 隐匿, 无法选择 or 沉睡 is not
//     "in the range" for any other attack either [the official S1 reads it the same way, ANY = canHitFly].
//   * 「生命值低于…120%」 = a STRICT comparison of the enemy's current HP against 1.2 × the operator's CURRENT ATK
//     (`unit.s.atk`, every buff included) — `e.hp < thr`, exactly as the official S1 writes it.
//   * 「立刻倒下…9999999 无来源真实斩杀伤害」 = one `type: 'true'` damage instance of `damage` (9999999) that is
//     `sourceless` (the hooks see no source; the operator keeps the credit and the kill), `canDodge: false` and NOT an
//     attack. That combination is what makes it uncancellable by the three named mechanics, and the reason is structural,
//     not a special case: 闪避 is a `phys` / `arts` roll (damage.js), and every 格挡 / 未命中 implementation in the
//     content tree cancels only `phys` / `arts` ATTACKS. A `true` non-attack instance is invisible to all of them. It is
//     also unmitigated (`mitigate` returns `amount` for `true`).
//   * 「不依赖攻击行为」 = the aura is a per-tick scan, not a rider on an attack: an operator that is disarmed, stunned or
//     simply between attacks still executes.
//   * RETRY [ASSUMED — the card text does not say, so the official S1's own rule is kept]: one try per enemy per ENTRY
//     into the operator's range. An enemy that left the range may be tried again on a later entry, and an enemy that
//     SURVIVED a blow (不死 / 重生, a 频次 unit, or a leader whose hit was cancelled by 限伤) is never tried again.
//   * 限伤 [ASSUMED, the official behaviour]: a leader (`isBoss`) in a boss / hidden battle cancels any hit of
//     ceil(amount) ≥ 300000 (shared/constants.js BOSS_HIT_LIMIT), so 9999999 does NOT execute a leader there — the blow
//     is swallowed whole and the enemy is added to `spared`. That is exactly what op-logos.js documents ("卫戍协议的最终
//     攻势Boss…只能以常规的「当前生命值」处理斩杀的触发"), so the card inherits it rather than inventing an exception.
//
// CONTRACT: export function installLogos(hooks) — hooks is the shared `hexHooks(battle)` bundle (see hooks.js).
// Returns 0 (the scan runs on the battle clock; nothing happens at install time).

import { hasHp } from '../../damage.js';

/** The card's own fallbacks, used only when its spec omits them (the owner's numbers). */
const DEFAULT = Object.freeze({ atkPct: 120, damage: 9999999 });
/** The official S1's target profile: the aura reaches air units, and every selectability rule still applies. */
const ANY = Object.freeze({ canHitFly: true });

/**
 * 逻各斯: every own operator's attack range is an execution aura.
 *
 * @param {any} hooks the shared `hexHooks(battle)` bundle — `battle` / `ownersOf` / `opsOf` / `specOf` / `optNumber` /
 *   `onField` are read here.
 * @returns {number} 0 (nothing happens at install time).
 */
export function installLogos(hooks) {
  if (!hooks || typeof hooks !== 'object') return 0;
  const { battle, ownersOf, opsOf, specOf, optNumber } = hooks;
  if (!battle || typeof battle.on !== 'function') return 0;
  if (typeof ownersOf !== 'function' || typeof opsOf !== 'function') return 0;

  const owners = ownersOf('hex_logos');
  if (!owners.length) return 0;

  /** ownerId → { thr (the atkPct ratio), dmg }. */
  const plan = new Map();
  for (const pid of owners) {
    const spec = typeof specOf === 'function' ? specOf(pid, 'hex_logos', 'logos') : null;
    const num = (k, d) => (typeof optNumber === 'function' ? optNumber(spec, k, d) : d);
    plan.set(pid, { thr: num('atkPct', DEFAULT.atkPct) / 100, dmg: num('damage', DEFAULT.damage) });
  }

  /**
   * The per-operator memory: `tried` = the enemies tried since they last entered the range (an id is dropped when the
   * enemy leaves, so a new entry may try again), `spared` = the enemies that SURVIVED a blow — never tried again for
   * the rest of the battle. `mem` survives a redeploy, like the official S1's state.
   */
  const stateOf = (u) => (u.mem.hexLogos ??= { tried: new Set(), spared: new Set() });

  battle.on('tick', () => {
    for (const pid of owners) {
      const p = plan.get(pid);
      if (!p || !(p.dmg > 0)) continue;
      for (const u of opsOf(pid)) {
        if (!u.alive || !u.deployed || !u.rangeKeys) continue;
        const st = stateOf(u);
        const inRange = battle.enemiesInKeys(u.rangeKeys, u, ANY);
        const ids = new Set(inRange.map((e) => e.id));
        // an enemy that left the range forgets its try: a later entry is a new chance (the official S1's own rule)
        for (const id of st.tried) if (!ids.has(id)) st.tried.delete(id);
        const thr = p.thr * u.s.atk;
        for (const e of inRange) {
          if (st.tried.has(e.id) || st.spared.has(e.id)) continue;
          if (!e.alive || !hasHp(e) || !(e.hp < thr)) continue;
          st.tried.add(e.id);
          battle.fx('logosExecute', { x: e.x, y: e.y, id: u.id, target: e.id });
          // 无来源 true damage, not an attack: no 闪避 roll (phys/arts only), and every 格挡 / 未命中 implementation in
          // the content tree cancels phys/arts attacks alone — so none of the three can cancel this instance.
          battle.dealDamage(u, e, {
            amount: p.dmg, type: 'true', canDodge: false, sourceless: true, isSkill: true,
            tags: ['hex', 'logos', 'execute'],
          });
          if (e.alive) st.spared.add(e.id); // survived (不死, a 频次 unit, 限伤 …): never tried again
          if (!u.alive || !u.deployed) break;
        }
      }
    }
  });

  return 0;
}
