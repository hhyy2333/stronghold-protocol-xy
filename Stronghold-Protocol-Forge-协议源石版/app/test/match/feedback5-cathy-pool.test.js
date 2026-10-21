// Community report of 2026-10-06 「凯瑟琳装备池没有超出商店等级的装备，原版凯瑟琳1升2都能有6本装备」 (item 43): the 凯瑟琳 strategy
// (定向投放, up_shop_add_special_goods {count 3, choice 1, pool pool_equip_kathe}) offered only items up to the shop level —
// data/choices.json pool_equip_kathe maxTier 'shopLevel', an [ASSUMED] cap (the pool is server-side). The players' first-hand
// account: tier VI items show at the 1 → 2 upgrade. The pool is every shop-eligible item now (uniform [ASSUMED]).

// 2026-10-21 复查（业主「继续」）：这条测试原来一刀切要求「每个候选都是商店可买的装备」，而 `data/choices.json` 里
// `pool_equip_kathe` 的声明是 `{ rule: 'shopEligible', also: ['chess_item_5_08_e_a'] }` —— 「特殊商品」池按名字就该带特殊
// 装备，`also` 那一条就是数据自己声明的例外（突变细胞，商店里买不到）。判据改成「商店可买 **或者** 本池 `also` 声明过」：
// 既不再把合法数据判红，也不会放过池子里冒出别的不可购买物品。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { makeMatch, DATA } from './harness.js';

/** 出厂数据里这个池自己声明的特殊条目（`also`；`rule` 展开前的形状）。 */
const OFFICIAL_CHOICES = JSON.parse(readFileSync(new URL('../../data/choices.json', import.meta.url), 'utf8'));
const KATHE_ALSO = new Set((OFFICIAL_CHOICES.pools && OFFICIAL_CHOICES.pools.pool_equip_kathe && OFFICIAL_CHOICES.pools.pool_equip_kathe.also) || []);

test('凯瑟琳 定向投放: the level 1 → 2 offer draws from every tier, the special items never', () => {
  assert.equal(DATA.choices.pools.pool_equip_kathe.maxTier, undefined, 'no shop-level cap in the data');
  const tiers = new Map();
  for (let seed = 1; seed <= 12; seed++) {
    const h = makeMatch({ mode: 'solo', difficulty: 'NORMAL', humans: 1, seed, fake: true }).start();
    h.toPrep(1, { band: 'band_cathy' });
    const ps = h.ps('p_0');
    ps.funds = 50;
    assert.deepEqual(h.m.handle('p_0', { t: 'g.levelUp' }), { ok: true });
    assert.equal(ps.shop.level, 2);
    const offer = ps.offers[ps.offers.length - 1];
    assert.ok(offer, `seed ${seed}: an offer`);
    const ids = (offer.slots ?? []).filter((s) => s && s.kind === 'item').map((s) => s.id);
    assert.equal(ids.length, 3, `seed ${seed}: 3 items`);
    for (const id of ids) {
      const rec = h.m.gd.item(id);
      assert.ok(rec && (!rec.shopExcluded || KATHE_ALSO.has(id)), `seed ${seed}: ${id} is a shop item or a declared special`);
      tiers.set(rec.tier, (tiers.get(rec.tier) || 0) + 1);
    }
  }
  assert.ok([...tiers.keys()].some((t) => t > 2), `items above the shop level (the parent: tiers I–II only) — ${JSON.stringify([...tiers])}`);
  assert.ok(tiers.has(6), 'tier VI among them');
});
