# B 区 · 干员与内容：浮游单元模型重构是主菜，外加敌人/赠品几处小修

> 覆盖 **23 个文件 / 32 个 hunk**；CLEAN-APPLY **20 个**，DIVERGED **3 个**，新增 **0 个**（B 区没有 MISSING-IN-YOURS）。
>
> **一句话结论**：B 区 32 个官方 hunk **没有一个撞上我的改动**（`merge-worksheet.csv` 的 `Collides` 全 `no`）。20 个文件可直接覆盖；3 个 DIVERGED 文件也全部是 `DISJOINT`（`overlap.csv` 重叠 0 行，最近间隔 11 / 35 / 64 行），可用标准三方合并自动通过。
>
> 主菜是 **驭械术师「浮游单元（drone）」模型的整体重构**：把浮游从「本体那次攻击的倍率修饰」拆成「本体一击 + 一份独立附加伤害」（`funnelMul` / `funnelBodyHits`），并让技能放出的浮游变成独立开火的对象（洛洛 / 耶拉 / 荒芜拉普兰德）。附带几处独立小修：沉默与污染秽蚀（#470）、自在重生无敌不被锁定（#510）、固定赠品不受库存拦截（#488/#491/#495）、自动开技判定（无编号）。

> **引用约定**：下文 `CHANGELOG 第 N 条` 一律指更新包 `CHANGELOG.md` 第 1–45 行 **0.2.5 段内按顺序编号的条目**（共 33 条，与 `.scratch\audit-025\changelog-025.txt` 的 `N|` 编号一致），**不是文件行号**。挂不上条目的写「未单列，推断为伴随改动」，绝不编编号。

---

## 一、结论速览

### 1.1 CLEAN-APPLY（20 个文件，可直接整份覆盖，零冲突）

| # | 文件 | 分类 | 修的是啥 | 来源 | 搬运建议 |
|---|---|---|---|---|---|
| 1 | `server/sim/content/bands/battle.js` | CLEAN-APPLY | Touch 外勤医疗改按「本局团队权益」保留；预备医疗索敌顺序提前 | 第 7 / 13 条，PR #523 | 直接抄 |
| 2 | `server/sim/content/enemies.js` | CLEAN-APPLY | 注释：沉默与【污染秽蚀】的判定口径改写 | #470（第 14 条，伴随） | 直接抄 |
| 3 | `server/sim/content/enemies/archetypes.js` | CLEAN-APPLY | `reborn()` 新增 `invincibleUntargetable`；枯朽战士污染秽蚀注释重写 | 第 12 / 14 条 | 直接抄 |
| 4 | `server/sim/content/enemies/leaders.js` | CLEAN-APPLY | 自在（Xi）重生无敌期同时不可被锁定 | 第 12 条（#510） | 直接抄 |
| 5 | `server/sim/content/enemies/special.js` | CLEAN-APPLY | 自制投石机溅射半径固定为 1.5 | 第 10 条（PR #502） | 直接抄 |
| 6 | `server/sim/content/garrisons/meta.js` | CLEAN-APPLY | 固定赠品发放不再受共享库存拦截 | 第 8 条（#488/#491/#495） | 直接抄 |
| 7 | `server/sim/content/kits/ops/chess_char_2_10-rockr.js` | CLEAN-APPLY | 洛洛二技能浮游脱范围后继续锁定 | 第 19 条（PR #535） | 直接抄 |
| 8 | `server/sim/content/kits/ops/chess_char_3_13-malist.js` | CLEAN-APPLY | 至简：浮游倍率与本体倍率拆成两路 | 第 16 条（PR #537） | 直接抄 |
| 9 | `server/sim/content/kits/ops/chess_char_3_18-vulpis.js` | CLEAN-APPLY | 忍冬第一笔伤害也结算追凶附加法伤 | 第 10 条（PR #502） | 直接抄 |
| 10 | `server/sim/content/kits/ops/chess_char_3_20-kjera.js` | CLEAN-APPLY | 耶拉二技能重写：放出的浮游独立开火 | 第 16 / 17 条 | 直接抄 |
| 11 | `server/sim/content/kits/ops/chess_char_4_03-kjera.js` | CLEAN-APPLY | 隐藏耶拉复用同一套浮游实现 | 第 17 条 | 直接抄 |
| 12 | `server/sim/content/kits/ops/chess_char_5_08-horn.js` | CLEAN-APPLY | 号角二技能近战位也吃溅射 | 第 10 条（PR #502） | 直接抄 |
| 13 | `server/sim/content/kits/ops/chess_char_6_18-whitw2.js` | CLEAN-APPLY | 荒芜拉普兰德：本体一击 + 两份未释放浮游 | 第 16 / 17 条 | 直接抄 |
| 14 | `server/sim/content/kits/ops/op-aglna2.js` | CLEAN-APPLY | 予愿安洁莉娜三技能周身范围自动开技 | 第 4 条（无编号） | 直接抄 |
| 15 | `server/sim/content/kits/ops/op-clemnt.js` | CLEAN-APPLY | 克莱门莎三技能不再被友方侵蚀爆条触发 | 第 10 条（PR #502） | 直接抄 |
| 16 | `server/sim/content/kits/ops/op-gdglow.js` | CLEAN-APPLY | 注释：本体一击 + 一份浮游附加 | 第 16 条（伴随） | 直接抄 |
| 17 | `server/sim/content/kits/ops/op-hsgma2.js` | CLEAN-APPLY | 斩业星熊三技能扩展范围对空 | 第 4 条（无编号） | 直接抄 |
| 18 | `server/sim/content/kits/ops/op-leizi2.js` | CLEAN-APPLY | 司霆惊蛰二技能水域范围对空 | 第 4 条（无编号） | 直接抄 |
| 19 | `server/sim/content/support/meta.js` | CLEAN-APPLY | `matchBands` 带上保留的医疗团队权益 | 第 7 条（PR #523） | 直接抄 |
| 20 | `server/sim/content/tokens.js` | CLEAN-APPLY | `spawnMapChar` 支持 `preBattleAggroSeq` | 第 13 条（PR #523） | 直接抄 |

### 1.2 DIVERGED（3 个文件，官方与我各改各的 → 三方合并自动通过）

| # | 文件 | 分类 | 修的是啥 | 来源 | 搬运建议 |
|---|---|---|---|---|---|
| 21 | `server/sim/content/bonds/core.js` | DIVERGED | 联防阿戈尔继承残血不再二次吞噬 | 第 6 条（无编号） | 手动合：官方改 `devour()` 尾部，我改同函数头部（隔 11 行，不重叠） |
| 22 | `server/sim/content/items/battle.js` | DIVERGED | 谢拉格不融冰 / 催泪瓦斯改为「造成伤害时」 | 第 11 条（#489 / PR #526） | 手动合：官方改 3 处，我加 `chess_item_9_90_e` 幽魂（隔 64 行，不重叠） |
| 23 | `server/sim/content/support/index.js` | DIVERGED | 官方只改注释；我改 `unitBonds()` 实体逻辑 | 第 7 条（伴随） | 手动合：官方这处是**纯注释**，取注释即可，我代码照留（隔 35 行） |

> **总搬运动作（CLEAN-APPLY 20 个文件）**：以 `$U = 参考对象\Stronghold-Protocol-v0.2.5-update\Stronghold-Protocol`、`$R = Stronghold-Protocol-repo` 为准，逐条
> `Copy-Item -Force "$U\server\sim\content\..." "$R\server\sim\content\..."`。完整 20 条清单见 §五。
> 更新包**只读**；BRIEF §1 明确要贴"原文"时从更新包原件取，**不要**从 `base-025` 贴。

---

## 二、逐文件明细

### 21. `server/sim/content/bonds/core.js`　【DIVERGED】

**官方改了什么**（0.2.4 → 0.2.5，hunk 1 处，+5 / −1）

```diff
@@ -454,13 +454,17 @@ function devour(battle, pid, bb, members) {
   for (const [m, t] of marks) {
     // every mark resolves whatever became of its marker — knocked out by an earlier mark (and revived or not), or down
     // since its own combat (downAtStart); a mark on a unit knocked out during the pass, or lying down since the 联防
     // start, resolves nothing (`knocked`: it is off the field)
     if (knocked(t)) continue;
     S.fxOn(battle, 'devour', t, 'bond:egirShip', 'devour', { from: m.id });
-    if (amount > 0) battle.loseHp(t, mitigate(amount, 'phys', t.s), { source: m, tags: ['bond:egir:devour'] });
+    // The maintainer's 2026-10-11 联防 carry decision: reconstruct marks/attributes, but do not apply a second
+    // opening HP loss (or trigger deaths/revives) to an operator restored from the previous field. Battle.start
+    // applies its exact HP ratio and SP after the opening hooks. Fresh units and all other battle kinds still pay.
+    const restored = battle.kind === 'unite' && Number.isFinite(t.carry?.hpPct) && t.carry.hpPct > 0;
+    if (amount > 0 && !restored) battle.loseHp(t, mitigate(amount, 'phys', t.s), { source: m, tags: ['bond:egir:devour'] });
     if (!layered.has(t)) {
       layered.add(t);
       S.gainLayers(battle, { playerId: pid, bonds: 'egirShip', n: S.tierOf(t), source: m, reason: 'bond' });
     }
   }
 }
```

**为什么改**：挂 `CHANGELOG 第 6 条`（**无编号**）——「修复联防阿戈尔继承残血后再次结算开场吞噬、误触发复活的问题，保留准确生命比例和技力」。
- **症状**：联机联防（`kind === 'unite'`）里，带残血从上一场继承进来的干员，开局又被阿戈尔（`bond:egirShip` 吞噬）白扣一次血；血少时还会被误判"击倒"，白白吃掉一次复活。
- **根因**：`devour()` 对每个 mark 无条件调 `battle.loseHp`，而联防的 `carry`（上一场继承的生命比例）是在开场钩子**之后**才由 `Battle.start` 精确施加的 → 同一份"开场伤害"被算了两次。
- **修完什么样**：`restored` 为真（联防 + 带正的生命继承比例）时跳过这次扣血，`fxOn`/叠层照旧；新建单位与其他战斗类型仍然照扣。

**老板这边的情况**：该文件老板已改（`yours` 比官方 0.2.4 多 224 字节），改动落在 `devour()` **头部**、旧行 442-444，新增 2 行：

```diff
@@ -442,4 +442,6 @@ function devour(battle, pid, bb, members) {
     if (block > 0) mods.blockCnt = block;
     if (Object.keys(mods).length) S.passiveBuff(battle, m, 'bond:egir:devour', mods);
+    // 海克斯 深度吞噬 (DESIGN §29): the markers / the devoured units are handed to any content that rides on the devour
+    if (battle.hasHook('devourGain')) battle.emit('devourGain', { marker: m, targets: mine });
   }
   const amount = num(bb.damage_value, 0);
   const layered = new Set();
```

**怎么合**：官方改**旧行 454-466**，老板改**旧行 442-444** → **不重叠**（`overlap.csv`：官方 1 hunk / 老板 1 hunk / 重叠 0 行 = `DISJOINT`；最近间隔 **11 行**）。`merge-worksheet.csv` 该行 `Collides=no`。→ 官方整段搬入，老板的 `devourGain` 那两行原样保留。合完 `devour()` 头部有老板的 `devourGain` 派发、尾部有官方的 `restored` 守卫，互不干扰。

**搬运动作**：官方这处只加 4 行、改 1 行 → 直接在老板文件里按上面 diff 贴 `restored` 三行 + 改 `if` 条件即可（不必走 `merge-file`）。

---

### 22. `server/sim/content/items/battle.js`　【DIVERGED】

**官方改了什么**（0.2.4 → 0.2.5，hunk 3 处，+15 / −5）

hunk 1（旧行 30-42，注释）：
```diff
@@ -30,13 +30,13 @@
 // 骑士戒律's free in-skill undying runs early (20). Flat damage reduction 'hit' −10 (after the other damage modifiers).
-// Proc damage dealt by items carries the tag 'item' and never re-triggers item procs.
+// Proc damage dealt by items carries the tag 'item'; damage-producing item riders exclude it to avoid recursion.
 //
```

hunk 2（旧行 386-397，新增工具函数）：
```diff
@@ -386,12 +386,21 @@ function onAttackEnemies(S, u, fn) {
     if (c.attacker !== u) return;
     const ts = c.targets;
     for (let i = 0; i < ts.length; i++) { const t = ts[i]; if (t && t.side === 'enemy' && t.alive) fn(t, c); }
   });
 }
 
+/** Actual carrier damage to enemies, including DoT/skill/splash. Element gauge fill and HP loss are not damage. */
+function onDamageEnemies(S, u, fn) {
+  S.on('damaged', (c) => {
+    if (c.source !== u || c.type === 'element' || isHpLoss(c.dmg) || !(c.amount > 0)
+      || !c.target || c.target.side !== 'enemy' || !hasHp(c.target)) return;
+    fn(c.target, c);
+  });
+}
+
 /** Generic buff-key behaviours (shared by several items). */
 const BY_BUFF = {
```

hunk 3（旧行 633-656，两个装备改判定时机）：
```diff
@@ -633,24 +642,25 @@ const BY_ITEM = {
     S.on('death', (c) => {
       if (c.unit !== u || used >= max || !reviveNow(battle, c, 'item')) return;
       used++;
       fxOn(battle, 'revive', u, 'item:chess_item_4_12_e', rec.id, { left: max - used });
     }, PRIO_RESPAWN); // a knock-out: after every 不死 (the hammer's lock), whatever the equip order (header)
   },
-  // 催泪瓦斯: on attack prob ⇒ 1 麻痹 stack
+  // PRTS 盟约记录 corrects both items' "攻击时" to "造成伤害时" (#489); no attack event is required.
+  // 催泪瓦斯: on damage prob ⇒ 1 麻痹 stack
   chess_item_5_01_e(battle, u, rec, S) {
     const p = bp(rec, 'act1autochess_equip_acarm058_global_buff');
     const pr = p ? num(p.prob) : 0;
-    if (pr > 0) onAttackEnemies(S, u, (t) => { if (chance(battle, pr)) battle.applyStatus(t, 'palsy', { value: 1, source: u }); });
+    if (pr > 0) onDamageEnemies(S, u, (t) => { if (chance(battle, pr)) battle.applyStatus(t, 'palsy', { value: 1, source: u }); });
   },
-  // 谢拉格不融冰: on attack prob ⇒ 寒冷 `cold` s
+  // 谢拉格不融冰: on damage prob ⇒ 寒冷 `cold` s
   chess_item_5_02_e(battle, u, rec, S) {
     const p = bp(rec, 'act1vautochess_equip_acarm003_global_buff');
     if (!p) return;
     const pr = num(p.prob), d = num(p.cold);
-    if (pr > 0 && d > 0) onAttackEnemies(S, u, (t) => { if (chance(battle, pr)) battle.applyStatus(t, 'cold', { duration: d, source: u }); });
+    if (pr > 0 && d > 0) onDamageEnemies(S, u, (t) => { if (chance(battle, pr)) battle.applyStatus(t, 'cold', { duration: d, source: u }); });
   },
```

**为什么改**：挂 `CHANGELOG 第 11 条`（**#489**，PR #526）——「谢拉格不融冰、催泪瓦斯改为造成伤害时判定，包含阿斯卡纶的持续伤害」。
- **症状**：这两件装备按 PRTS 盟约记录应当是「**造成伤害时**」触发，此前做成了「攻击时」触发 → 阿斯卡纶这类**靠持续伤害（DoT）而不靠普攻**的来源根本触发不了装备效果。
- **根因**：原实现挂在 `attack` 事件（`onAttackEnemies`）上，只认"一次攻击结算"；DoT / 技能 / 溅射伤害不经过该事件。
- **修完什么样**：新增 `onDamageEnemies`，监听 `damaged` 事件，并明确**排除**元素条填充（`c.type === 'element'`）、`流失`（`isHpLoss`）、非正伤害与非敌人目标 → 装备改为在任何真实伤害（含 DoT / 技能 / 溅射）落地时按概率触发。
- **hunk 1 的注释**是**伴随改动**（CHANGELOG 未单列，推断为伴随改动）：把"装备 proc 伤害永不重复触发装备 proc"的旧描述，改成"产生伤害的装备骑乘效果要排除 `item` 标签以避免递归"——因为新的 `damaged` 监听必须自己防重入，措辞随之更新。

**老板这边的情况**：该文件老板已改（`yours` 比官方 0.2.4 多 1114 字节），改动落在旧行 459-475 —— 新增老板自研装备 **幽魂** `chess_item_9_90_e`：

```diff
@@ -459,6 +459,22 @@ const BY_BUFF = {
 
 /** Item-key behaviours. */
 const BY_ITEM = {
+  /**
+   * 幽魂 (the remake's own item, DESIGN §29.24 — granted only by the 协议源石 幽魂形态): the carrier blocks nothing and
+   * no single instance of damage may take more than `params.dmgCap` HP off it.
+   *   * 阻挡数 0 — one passive with a huge negative `blockCnt`; units.js clamps the aggregated stat at 0
+   *     (`Math.max(0, round(base + ΣblockCnt))`), so the carrier stops blocking and walking enemies pass it.
+   *   * the cap rides the `hpLoss` hook (damage.js applyHpLoss), the single HP-loss funnel: it therefore covers
+   *     ordinary damage AND a 流失 (`battle.loseHp`, which never enters dealDamage — an explicit owner decision of
+   *     2026-10-12). Shields still absorb first (dealDamage runs them before applyHpLoss), so the cap applies to what
+   *     is left.
+   */
+  chess_item_9_90_e(battle, u, rec, S) {
+    S.stat('ghost:block', { blockCnt: -999 });
+    const cap = Number(rec && rec.params && rec.params.dmgCap);
+    if (!(Number.isFinite(cap) && cap >= 0)) return;
+    S.on('hpLoss', (c) => { if (c.target === u && c.amount > cap) c.amount = cap; });
+  },
   // 精准狙击镜: damage ×damage_scale against targets ≥ radius tiles away
   chess_item_3_02_e(battle, u, rec, S) {
```

**怎么合**：官方改**旧行 30-42 / 386-397 / 633-656**，老板改**旧行 459-475** → 三处全**不重叠**（`overlap.csv`：官方 3 hunk / 老板 1 hunk / 重叠 0 行 = `DISJOINT`；最近间隔 **64 行**）。`merge-worksheet.csv` 三行均 `Collides=no`。
→ **官方三处整段搬入**，老板的 `chess_item_9_90_e` 原样保留。落地后 `催泪瓦斯` / `谢拉格不融冰` 两个 handler 从 `onAttackEnemies` 切到 `onDamageEnemies`，**与幽魂不相邻**，无冲突。

**⚠️ 跨区依赖（重要：B 区自己合不出可用结果）**：幽魂的伤害上限依赖 `hpLoss` 钩子，而该钩子**只在老板自己的 `server/sim/damage.js` 里存在**（A 区文件，也是官方 36 个撞车 hunk 之一）：
- `.scratch\audit-025\base-024\server\sim\damage.js`：`applyHpLoss()` **不派发** `hpLoss` 事件（只有 `isHpLoss` 标签工具）。
- `.scratch\audit-025\yours\server\sim\damage.js`：`applyHpLoss()` 在扣血前 `battle.emit('hpLoss', lctx)`（第 ~359-364 行）。
→ 合并 A 区 `damage.js`（#520 受击格取整撞车点）时**必须保住** `yours` 版的 `hpLoss` 派发，否则幽魂的 `S.on('hpLoss', ...)` **静默失效**（不报错、只是不生效）。请 A 区负责人与验收一起盯这一条。

**搬运动作**：官方 hunk 1/2 直接贴；hunk 3 实际只改 3 行有效代码（两处 `onAttackEnemies` → `onDamageEnemies` + 两行注释），手贴即可。

---

### 23. `server/sim/content/support/index.js`　【DIVERGED】

**官方改了什么**（0.2.4 → 0.2.5，hunk 1 处，+1 / −1，**纯注释**）

```diff
@@ -126,13 +126,13 @@ export function topActiveBond(battle, pid) {
 
 /** Prep-side facts for this player's battle (support/meta.js `global:contentb_info`), or {} when absent (tests). */
 export function contentInfo(battle, pid) {
   const ci = player(battle, pid)?.input?.contentInfo;
   return ci && typeof ci === 'object' ? ci : {};
 }
-/** Band ids of every alive player of the match (own first); falls back to this battle's players. */
+/** Alive players' bands (own first), plus a retained Touch team grant; falls back to this battle's players. */
 export function matchBands(battle, pid) {
   const mb = contentInfo(battle, pid).matchBands;
   if (Array.isArray(mb) && mb.length) return mb;
   return (battle.players || []).map((p) => p.bandId).filter(Boolean);
 }
```

**为什么改**：CHANGELOG **未单列**（推断为伴随改动）——它是 `CHANGELOG 第 7 条`（Touch 外勤医疗按本局团队权益保留）的**文档同步**：`matchBands` 的返回值不再只是「场上存活玩家的阵营」，还可能含一个**保留的医疗团队权益**（`band_amedic`），注释随之更新。实现改动在本区 `support/meta.js`（#19）与 `bands/battle.js`（#1）。
- **注意**：这处**只有注释变、函数体一行没动**。所以它虽被机械分类为 `DIVERGED`，实质是「官方改注释 + 老板改别处」。

**老板这边的情况**：该文件老板已改（`yours` 比官方 0.2.4 多 339 字节），改动落在旧行 171-180 —— `unitBonds()` 支持 `u.mem.extraBonds`（海克斯 盟约共鸣借来的阵营），并把缓存 key 扩成含 extra 的形式：

```diff
@@ -171,5 +171,6 @@ const BONDS = new WeakMap();
 /**
  * A unit's own bonds: the chess's data bonds + bonds granted by 变形同构体 (an item with `canGiveBond` worn together
- * with an item that has a `giveBondId`; same rule as server/match/bondsMeta.js pieceBonds). Tokens / enemies: [].
+ * with an item that has a `giveBondId`; same rule as server/match/bondsMeta.js pieceBonds) + the bonds 海克斯 盟约共鸣
+ * lent it from an adjacent operator (`u.mem.extraBonds`, set from the battle input's `bonds`). Tokens / enemies: [].
  */
 export function unitBonds(u) {
@@ -177,7 +178,9 @@ export function unitBonds(u) {
   const cached = BONDS.get(u);
   const items = itemsOf(u);
-  const key = items.join('|');
+  const extra = Array.isArray(u.mem?.extraBonds) ? u.mem.extraBonds : null;
+  const key = `${items.join('|')}#${extra ? extra.join(',') : ''}`;
   if (cached && cached.key === key) return cached.bonds;
   const out = [...(Array.isArray(u.def?.bonds) ? u.def.bonds : Array.isArray(u.def?.raw?.bonds) ? u.def.raw.bonds : [])];
+  if (extra) for (const b of extra) if (typeof b === 'string' && !out.includes(b)) out.push(b);
   if (items.length >= 2) {
```

**怎么合**：官方改**旧行 126-138**，老板改**旧行 171-180** → **不重叠**（`overlap.csv`：官方 1 hunk / 老板 3 hunk / 重叠 0 行 = `DISJOINT`；最近间隔 **35 行**）。`merge-worksheet.csv` 该行 `Collides=no`。
→ 用官方那行注释替换老板的同名注释即可；**老板 `unitBonds()` 的代码一行都不要动**。（`areas.csv` / `merge-worksheet.csv` 把本文件标为 `DIVERGED`，是因为两边哈希都变了；但两边改的是不同函数、不同行。）

**搬运动作**：只改 1 行注释（上面 diff 的 `-` / `+` 两行）。

---

## 三、CLEAN-APPLY 20 个文件（逐 hunk 一句话）

> 这 20 个文件已**逐字节核验**：`yours` 与 `base-024` 的 SHA256 **全部相同**（23 个 B 区文件里 20 个 CLEAN-APPLY 无一例外）→ 用更新包整份覆盖，不可能冲突。
> 下面把**全部 27 个 CLEAN-APPLY hunk** 列全，保证 B 区 32 个 hunk 无遗漏（27 + DIVERGED 5 = 32）。

### 3.1 敌人与内容（5 个文件 / 6 hunk）

| 文件 | hunk | 官方改了什么（一句话） | 挂哪条 |
|---|---|---|---|
| `enemies.js` | 1（旧 14-27） | 注释：沉默判定口径改写——把「萨卡兹枯朽战士/组长死亡爆炸是 NORMAL 行的例外」改成「【污染秽蚀】是唯一也被沉默的 NORMAL 行」，点名 `enemy_1267_nhpbr` / `_2`，补维护者 2026-10-12 实机回忆 | 第 14 条（#470） |
| `enemies/archetypes.js` | 1（旧 334-357） | `reborn()` 参数新增 `invincibleUntargetable = false`；为真时在重生无敌 buff 的 flags 里加 `untargetable: true` | 第 12 条（#510） |
| `enemies/archetypes.js` | 2（旧 653-671） | `kitPolluted` 注释重写：列出**不是**这团雾的其他枯朽能力（战车秽蚀轰击、枯朽之种自爆、萃聚使徒召唤、前锋源石污染区、蚀裂死亡云、高能源石虫死亡爆炸），说明「已被沉默时死亡不留雾」的理由改记为维护者回忆，与「不可沉默」相反 | 第 14 条（#470） |
| `enemies/leaders.js` | 1（旧 470-481） | `kitXi` 调 `reborn({...})` 时传 `invincibleUntargetable: true`（自在重生无敌期同时不可被锁定） | 第 12 条（#510） |
| `enemies/special.js` | 1（旧 409-421） | 自制投石机：溅射半径从 `T(ab,'Attack.attack@projectile_range')`（0.5）改为**固定 1.5** | 第 10 条（PR #502） |
| `garrisons/meta.js` | 1（旧 236-248） | `SERVER_GAIN_EQUIP` 的 `ctx.grantItem(bbStr.chess)` 改为 `ctx.grantItem(bbStr.chess, { requirePool: false })` | 第 8 条（#488/#491/#495） |

**为什么**：
- **第 14 条（#470）**：枯朽战士/组长**已显示沉默图标时被击倒，不再留下污染秽蚀**。0.2.0 起行为已如此，这版**只改「为什么这样记」**（改记为维护者 2026-10-12 实机回忆，并明确与 PRTS / 游戏内文字「不可沉默」相反），代码 `sil: true` 未动 → **纯注释/文档改动**。
- **第 12 条（#510）**：自在（Xi）重生后的**无敌期不该再被普攻或需要可选目标的自动技能锁定**。原实现只有 `invulnerable`（挡伤害但不挡选中）→ 新增可选参数 `invincibleUntargetable`，只给 Xi 显式开启（引擎通用语义保持不变）。
- **第 10 条（PR #502）**：「自制投石机溅射半径」——原来错用了天赋的 `projectile_range`(0.5)，那是「入戏」随机偏移攻击的参数、不是本模式普通齐射；正常石块溅射是**半径 1.5**。
- **第 8 条（#488/#491/#495）**：固定赠品不该被共享库存拦住 → `requirePool: false`。

### 3.2 干员 kit（12 个文件 / 15 hunk）

| 文件（干员） | hunk | 官方改了什么（一句话） | 挂哪条 |
|---|---|---|---|
| `chess_char_2_10-rockr.js`（洛洛） | 1（旧 1-60，+55/−18） | 二技能大重写：删 `onDefaultSkill`/`bodyInKeys`/beforeAttack 锁敌，新增 `DRONE_TAG`、`firstTarget()`、`unit.mem.rockDrone`；放出浮游后**目标离范围仍继续锁定**，只在击杀/技能结束返回；浮游自己按 interval 开火（`isSkill: true, isAttack: false`）；技能期间本体不再叠未释放浮游的附加伤害（`funnelMul`/`dmgMul` 临时置 null，结束时还原） | 第 19 条（PR #535） |
| `chess_char_3_13-malist.js`（至简） | 1（旧 9-24） | `trait` 从 `dmgMul: (…)=> funnelMap(…)*insight(…)` 拆成 **`funnelMul: funnelMap` + `dmgMul: insight`**；技能 attack 加 **`funnelBodyHits: hits`**（本体保留 hits 次命中，浮游倍率另算） | 第 16 条（PR #537） |
| `chess_char_3_18-vulpis.js`（忍冬） | 1（旧 91-104） | `marks.get(e.id)` 为 null 时**不再直接 return**，改为记时间戳后**继续**走结算 → 第一笔伤害也吃追凶附加法伤 | 第 10 条（PR #502） |
| `chess_char_3_20-kjera.js`（耶拉） | 1（旧 1-46，+120/−28） | 整文件重构：新增 `DRONE_TAG`、`stepMap()`（同 tick 同目标共享档位）、`acquire()`（锁定分配），导出 **`kjeraRelease(bb,{restart,announce})`**；技能期间本体照常攻击，放出 `1+attack@cnt` 个浮游独立开火，寒冷对本体与浮游各判一次 | 第 16 / 17 条 |
| `chess_char_3_20-kjera.js`（耶拉） | 2（旧 49-58） | 低眉天赋块随之上移/收尾，删掉旧的 `targeting: { maxTargets: 1 + extra }` 与 beforeAttack 拼目标逻辑 | 第 16 / 17 条 |
| `chess_char_4_03-kjera.js`（隐藏耶拉） | 1（旧 1-77，−56） | 删掉整段自带浮游实现，改为 `import { kjeraRelease }` 并 `kjeraRelease(bb, { restart: true, announce: true })`（隐藏版每发浮游从初始倍率起算、不回写） | 第 17 条 |
| `chess_char_5_08-horn.js`（号角） | 1（旧 47-59） | 二技能 attack 加 `fortressMeleeSplash: true` → 近战位也结算溅射 | 第 10 条（PR #502） |
| `chess_char_6_18-whitw2.js`（荒芜拉普兰德） | 1（旧 121-134） | S1 注释改写：切换技能会重新索敌，但文本没说本体停手 → 本体与两份未释放浮游都保留 | 第 17 条 |
| `chess_char_6_18-whitw2.js`（荒芜拉普兰德） | 2（旧 140-152） | S2 的 `dmgMul` 改名 **`funnelMul`** 并加 **`funnelBodyHits: 0`**（浮游单元放出的那份，本体不吃第二击） | 第 16 / 17 条 |
| `op-aglna2.js`（予愿安洁莉娜） | 1（旧 226-237） | S3 加 `trigger: { rule: 'ACTIVE_RANGE', grid: g39x4 }` → 开技判定含周身八格 | 第 4 条（无编号） |
| `op-clemnt.js`（克莱门莎） | 1（旧 219-231） | `elementBurst` 回调加 `target?.side !== 'enemy'` 早退 → **友方的侵蚀爆条不再触发**三技能 | 第 10 条（PR #502） |
| `op-gdglow.js`（澄闪） | 1（旧 14-26） | 注释：特性说明改为「本体一击 + 一份浮游附加」 | 第 16 条（伴随） |
| `op-hsgma2.js`（斩业星熊） | 1（旧 50-62） | import 加 `absoluteRangeKeys` | 第 4 条（无编号） |
| `op-hsgma2.js`（斩业星熊） | 2（旧 253-264） | install 里 S3 加 `addTriggerRange(... { canHitFly: true })` → 三技能扩展范围**不继承地面-only 的失效 profile**，可对空 | 第 4 条（无编号） |
| `op-leizi2.js`（司霆惊蛰） | 1（旧 291-302） | 二技能加 `addTriggerRange`：以 `floodGrid` 实际水域范围构造，且**仅当严格包含初始范围**时返回（否则保留 SEARCH），profile 为 `AIR`（`{canHitFly:true}`） | 第 4 条（无编号） |

**为什么（浮游单元这一大块）**：这是 0.2.5 的**结构性重构**，不是单点修复，横跨 A 区 `professions.js` / `ai.js` 与 B 区 6 个 kit 文件：
- **症状**：驭械术师（澄闪/耶拉/至简/洛洛/荒芜拉普兰德…）的浮游被建模成「本体那次攻击的伤害倍率修饰」。由此三类错：①**本体那一击消失**——浮游把本体的攻击"顶掉"了；②浮游**不能脱离本体/范围独立开火**；③**再部署后倍率不回零**。
- **根因**：`professions.js` 只有 `dmgMul` 一个乘子，浮游与本体共用，无法表达「本体一击 + 浮游附加」这两笔独立伤害。
- **修完什么样**：`professions.js` 拆出 **`funnelMul`**（浮游专用斜坡，与本体乘子分开）与 **`funnelBodyHits`**（本体保留几次命中；省略=1，`0`=纯浮游无本体，`>0`=保留 n 次），`ai.js` 按此结算。对应日志：
  - **第 16 条（PR #537）**：未释放的浮游 = **本体攻击 + 一份附加伤害**（初值 20% 攻击力，同目标每次 +15%，上限 110%）；技能放出的浮游**仍算技能伤害**。
  - **第 17 条（无编号）**：**只改普攻的技能保留干员自己的那一击**——耶拉二技能（基础与隐藏）放出浮游时仍打 100% 普攻，寒冷对自身与浮游各判一次；荒芜拉普兰德一技能开启后仍是本体一击 + 两份未释放浮游；只由浮游出手的技能不另加这一击。
  - **第 18 条（PR #536）**：再部署时浮游倍率回初始、清掉按目标记的倍率，自由移动保留，已飞出的按命中时倍率结算。
  - **第 19 条（PR #535）**：洛洛二技能浮游离范围后继续锁定，只在击杀/技能结束返回；技能期间不再叠未释放浮游的附加伤害。
- **跨区提醒**：#18（PR #536）的「再部署清零」实现落在 **A 区 `professions.js`** 的 `installFunnel`（新增 `reset()` + `battle.on('deploy', … !ctx.move …)`），以及 `dmgMul → funnelMul` 改名。B 区这些 kit 声明的 `funnelMul` **只有 A 区 `professions.js` / `ai.js` 一起搬才有人读取**——**只搬 B 区会全盘失效**。这是本区最重要的搬运耦合，请与 A 区同批上线。

**为什么（另外两块）**：
- **第 10 条（PR #502）**：克莱门莎三技能**被友方侵蚀爆条触发**（`elementBurst` 当时不区分敌我）+ 号角**不攻击脚下不可阻挡敌人**（近战位漏溅射）+ 忍冬**第一笔伤害漏掉追凶附加**。三处都是「判定对象 / 时机差一点」。
- **第 4 条（无编号）**：**自动开技判定**补齐——司霆惊蛰二技能、斩业星熊三技能对空，予愿安洁莉娜三技能周身范围。根因是这些技能的实际生效范围是**动态的**（水域 / 飞行 / 周身），而开技判定只看了静态 `rangeId` → 改为 `addTriggerRange` 提供运行时范围。

### 3.3 支援 / 地图角色（3 个文件 / 6 hunk）

| 文件 | hunk | 官方改了什么（一句话） | 挂哪条 |
|---|---|---|---|
| `support/meta.js` | 1（旧 3-15） | 注释：`matchBands` 说明补「plus a retained Touch team grant」 | 第 7 条 |
| `support/meta.js` | 2（旧 23-46） | `contentb_info` 里先算 `matchBands` 局部量；若 `ctx.teamMedicGranted?.()` 为真且未含 `band_amedic` 则 push 进去 | 第 7 条 |
| `tokens.js` | 1（旧 1563-1577） | `spawnMapChar()` 参数加 `preBattleAggroSeq = null`，注释说明「准备阶段角色可借此让索敌顺序早于普通开战部署」 | 第 13 条（PR #523） |
| `tokens.js` | 2（旧 1582-1594） | `battle.spawnToken(...)` 透传 `preBattleAggroSeq` | 第 13 条（PR #523） |
| `bands/battle.js` | 1（旧 28-44） | 头部注释：Touch 外勤医疗从「场上有存活玩家持有 `band_amedic`」改为「本局一旦选出，其保留的团队权益持续生效」；补 `[ASSUMED]` 索敌顺序说明 | 第 7 / 13 条 |
| `bands/battle.js` | 2（旧 235-252） | `installMapChars()`：先把所有待生成角色收集进 `chars`，再按序 `spawnMapChar(..., { preBattleAggroSeq: i - chars.length })`（负数 → 排在普通初始干员之前） | 第 13 条（PR #523） |

**为什么**：`CHANGELOG 第 7 条`（Touch 外勤医疗按本局团队权益保留）+ `第 13 条`（PR #523）：
- **症状 A**：医疗策略的持有者**被淘汰或退出后，下一场医疗就消失了**，与「本局团队权益」不符。
- **症状 B**：外勤医疗的预备地图角色（预备干员-医疗 / Touch）在开战时**索敌顺序被普通初始干员挤到后面**。
- **根因 A**：`matchBands` 只从「当前存活玩家」推阵营，持有者一死 `band_amedic` 就没了。
- **根因 B**：`spawnMapChar` 用默认 `deploySeq` 分配 `aggroSeq`，而准备阶段的角色理应更早。
- **修完什么样**：A → `matchBands` 依据 `teamMedicGranted()` 保留 `band_amedic`（持有者已淘汰/退出也保留）；B → `spawnMapChar` 接受 `preBattleAggroSeq`，`bands/battle.js` 传 `i - chars.length`（负数）让全体预备角色排在普通初始干员之前。
- **注**：`support/meta.js` 与 `bands/battle.js` 里的 `[ASSUMED]` 是官方自己标注的**待实测假设**（原作寿命规则官方仍在实测确证中）。据实转述，不做超出证据的断言。

---

## 四、B 区自查

| 核对项 | 结果 |
|---|---|
| `areas.csv` 里 B 区文件数 | 23（全部 `^server/sim/content/`）✅ |
| `areas.csv` 的 Hunks 求和 | 32 ✅ |
| `merge-worksheet.csv` 里 B 区 hunk 行数 | 32（逐条对齐）✅ |
| 本报告说明的 hunk 数 | CLEAN-APPLY 27（§3：6+15+6）+ DIVERGED 5（1+3+1） = **32** ✅ |
| `Collides=YES` 的 hunk | **0 个**（32 行全 `no`）✅ |
| `threeway.csv` 分类 | CLEAN-APPLY 20 / DIVERGED 3 / MISSING-IN-YOURS 0 ✅ |
| CLEAN-APPLY 是否真与官方 0.2.4 逐字节一致 | 20/20 SHA256 全同 ✅ |
| DIVERGED 是否真无重叠 | 3/3 `overlap.csv` = `DISJOINT`，重叠 0 行 ✅ |
| 每个 hunk 是否都有下文 | 是：CLEAN-APPLY 逐 hunk 列表（§3），DIVERGED 逐 hunk 贴 diff + 说明（§2）✅ |
| 有编号的改动是否都挂了条目 | 已挂 #470 / #510 / #502 / #489 / #488 / #491 / #495 / PR #526 / #535 / #537；无编号者逐条标注「第 N 条（无编号）」或「未单列，推断为伴随改动」✅ |
| 是否碰了源码 / 别人的区 / 共享证据 | 否，只写本文件 ✅ |

**两处需与别的区联动（本区无法自行保证）**：
1. **浮游模型**：B 区 6 个 kit 声明 `funnelMul` / `funnelBodyHits`，读取方在 **A 区** `professions.js`（`dmgMul → funnelMul` 改名 + `installFunnel` 重置）与 `ai.js`（结算）。**必须同批上线**，否则 B 区这些改动全盘失效。
2. **幽魂的 `hpLoss` 依赖**：B 区 `items/battle.js` 的 `chess_item_9_90_e` 依赖 **A 区** `damage.js` 的 `hpLoss` 派发（`yours` 有、`base-024` 无）。合并 A 区 `damage.js`（#520 撞车点）时**务必保住该派发**，否则幽魂静默失效。

---

## 五、搬运清单（可直接执行）

```powershell
$U = "C:\Users\hhyyl\Downloads\Stronghold-Protocol-v0.2.1\参考对象\Stronghold-Protocol-v0.2.5-update\Stronghold-Protocol"
$R = "C:\Users\hhyyl\Downloads\Stronghold-Protocol-v0.2.1\Stronghold-Protocol-repo"

# —— 第 1 类：CLEAN-APPLY，零冲突，直接覆盖（20 条） ——
Copy-Item -Force "$U\server\sim\content\bands\battle.js"                          "$R\server\sim\content\bands\battle.js"
Copy-Item -Force "$U\server\sim\content\enemies.js"                               "$R\server\sim\content\enemies.js"
Copy-Item -Force "$U\server\sim\content\enemies\archetypes.js"                    "$R\server\sim\content\enemies\archetypes.js"
Copy-Item -Force "$U\server\sim\content\enemies\leaders.js"                       "$R\server\sim\content\enemies\leaders.js"
Copy-Item -Force "$U\server\sim\content\enemies\special.js"                       "$R\server\sim\content\enemies\special.js"
Copy-Item -Force "$U\server\sim\content\garrisons\meta.js"                        "$R\server\sim\content\garrisons\meta.js"
Copy-Item -Force "$U\server\sim\content\kits\ops\chess_char_2_10-rockr.js"        "$R\server\sim\content\kits\ops\chess_char_2_10-rockr.js"
Copy-Item -Force "$U\server\sim\content\kits\ops\chess_char_3_13-malist.js"       "$R\server\sim\content\kits\ops\chess_char_3_13-malist.js"
Copy-Item -Force "$U\server\sim\content\kits\ops\chess_char_3_18-vulpis.js"       "$R\server\sim\content\kits\ops\chess_char_3_18-vulpis.js"
Copy-Item -Force "$U\server\sim\content\kits\ops\chess_char_3_20-kjera.js"        "$R\server\sim\content\kits\ops\chess_char_3_20-kjera.js"
Copy-Item -Force "$U\server\sim\content\kits\ops\chess_char_4_03-kjera.js"        "$R\server\sim\content\kits\ops\chess_char_4_03-kjera.js"
Copy-Item -Force "$U\server\sim\content\kits\ops\chess_char_5_08-horn.js"         "$R\server\sim\content\kits\ops\chess_char_5_08-horn.js"
Copy-Item -Force "$U\server\sim\content\kits\ops\chess_char_6_18-whitw2.js"       "$R\server\sim\content\kits\ops\chess_char_6_18-whitw2.js"
Copy-Item -Force "$U\server\sim\content\kits\ops\op-aglna2.js"                    "$R\server\sim\content\kits\ops\op-aglna2.js"
Copy-Item -Force "$U\server\sim\content\kits\ops\op-clemnt.js"                    "$R\server\sim\content\kits\ops\op-clemnt.js"
Copy-Item -Force "$U\server\sim\content\kits\ops\op-gdglow.js"                    "$R\server\sim\content\kits\ops\op-gdglow.js"
Copy-Item -Force "$U\server\sim\content\kits\ops\op-hsgma2.js"                    "$R\server\sim\content\kits\ops\op-hsgma2.js"
Copy-Item -Force "$U\server\sim\content\kits\ops\op-leizi2.js"                    "$R\server\sim\content\kits\ops\op-leizi2.js"
Copy-Item -Force "$U\server\sim\content\support\meta.js"                          "$R\server\sim\content\support\meta.js"
Copy-Item -Force "$U\server\sim\content\tokens.js"                                "$R\server\sim\content\tokens.js"

# —— 第 2 类：DIVERGED，三方合并（3 条；均不冲突，禁止整份覆盖） ——
# 21. bonds/core.js    ：官方加 restored「不二次扣血」守卫（旧 454-466）；我的 devourGain 在旧 442-444 → 直接贴官方守卫
# 22. items/battle.js  ：官方 3 处（新增 onDamageEnemies + 两装备改判定，#489）；我的幽魂在旧 459-475 → 贴官方 3 处
# 23. support/index.js ：官方只改 1 行注释（旧 126-138）；我的 unitBonds 在旧 171-180 → 换注释，代码不动
```

**验收提醒**：本次是纯审计交付，**未改任何源码**（BRIEF §5 纪律）。上面 `Copy-Item` **只适用于第 1 类**；第 2 类 3 个文件**不要**用 `Copy-Item` 覆盖，会丢掉老板自己的改动（`devourGain` / 幽魂 / `unitBonds` 的 extraBonds）。合并后按官方第 5 步验收：`npm test`、`npm run lint`、`npm run golden`（规则类改动最容易在黄金回放露馅）。
