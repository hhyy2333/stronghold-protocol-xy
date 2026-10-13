# A-模拟核心：0.2.5 把「受击格取整」和「浮游/要塞」两条线重写了，其余是零冲突的整段搬运

> 覆盖 14 个文件 / 33 个 hunk；CLEAN-APPLY 13 个，DIVERGED 1 个，新增 0 个。
>
> 全区**真撞车 hunk = 0**（依 `overlap-exact.csv`，`server/sim/damage.js` 判 `自由可搬`）。
> 唯一 DIVERGED 的 `server/sim/damage.js` 我实测过三方合并：`git merge-file` 退出码 **0，零冲突**，且两边改动都保住。
> 但**有一个前提必须说清楚，否则会出事** —— 见第二节 1 的「怎么合」。

---

## 一、结论速览

| # | 文件 | 分类 | 修的是啥 | 来源 | 搬运建议 |
|---|---|---|---|---|---|
| 1 | `server/sim/damage.js` | DIVERGED | 官方伤害红字（`mark='r'`）+ 闪避 MISS 分类 | #412 | **可整段照搬官方 3 个 hunk（无冲突）**；但**不许整文件覆盖**，否则抹掉我们的 `isRetaliation`/`hpLoss` |
| 2 | `server/sim/body.js` | CLEAN-APPLY | 受击格改四舍六入五成双 | #25 / PR #520 | 直接覆盖 |
| 3 | `server/sim/detmath.js` | CLEAN-APPLY | 新增 `roundHalfEven`；`powi` 对 ±0 对齐 `Math.pow` | #25 / PR #520、#43 / PR #519 | 直接覆盖（**先于** 2/3/4/12/13 落地） |
| 4 | `server/sim/battle/queries.js` | CLEAN-APPLY | 敌人分桶取整同上 | #25 / PR #520 | 直接覆盖 |
| 5 | `server/sim/targeting.js` | CLEAN-APPLY | `tileKeyOf` 取整同上 | #25 / PR #520 | 直接覆盖 |
| 6 | `server/sim/constants.js` | CLEAN-APPLY | 新增 `FIELD_EDGE_INSET`（场地边缘内缩 2^-20） | #25 / PR #520 | 直接覆盖 |
| 7 | `server/sim/battle/spawns.js` | CLEAN-APPLY | `_clampPos` 用新边缘内缩，边缘敌人留在边缘格 | #25 / PR #520 | 直接覆盖 |
| 8 | `server/sim/battle/deploy.js` | CLEAN-APPLY | 预备地图角色索敌序 + 联防开场恢复时点 | #18 / PR #523、#11 | 直接覆盖 |
| 9 | `server/sim/battle/lifecycle.js` | CLEAN-APPLY | 联防在 `battleStart` 之后统一恢复 HP 比例/技力 | #11 | 直接覆盖 |
| 10 | `server/sim/battle/summons.js` | CLEAN-APPLY | 透传 `preBattleAggroSeq` | #18 / PR #523 | 直接覆盖 |
| 11 | `server/sim/units.js` | CLEAN-APPLY | `aggroSeq` 注释同步 | #18 / PR #523（纯注释） | 直接覆盖 |
| 12 | `server/sim/ai.js` | CLEAN-APPLY | 要塞本格近战格 + 浮游「本体一击＋附加」分流 | #15 / PR #502、#21~#24 / PR #535~#537 | 直接覆盖（**须与 B 区同批**，见三） |
| 13 | `server/sim/professions.js` | CLEAN-APPLY | 浮游倍率 `dmgMul`→`funnelMul`，换目标/再部署即重置 | #21~#24 / PR #535~#537 | 直接覆盖 |
| 14 | `server/sim/skills.js` | CLEAN-APPLY | 要塞本格近战范围也满足开技条件 | #15 / PR #502 | 直接覆盖 |

**分类自洽性已机械复核**：13 个 CLEAN-APPLY 文件的 `yours` 与官方 `base-024` **SHA-256 逐字节相同**，且 `base-025` 与更新包原件逐字节相同 —— 所以「直接覆盖」对这批文件是零风险的。

---

## 二、逐文件明细

### 1. `server/sim/damage.js`　【DIVERGED】

**官方改了什么**（0.2.4 → 0.2.5，hunk 3 处，+76/−19）

```diff
@@ -260,12 +260,67 @@ export function absorbShields(battle, target, amount, type = null) {
+/**
+ * Official red-number test (PRTS 作战机制 「伤害红字（暴击）」, https://prts.wiki/w/作战机制).
+ * A red integer is shown when 最终伤害 ≥ 期望伤害 × 1.5. `1e-9` only absorbs a binary rounding crumb.
+ * 0 ≥ 0 × 1.5 is red: an invulnerable hit still shows red 0 in the official client. This function reports that;
+ * `dealDamage` does not emit a new event for it (a new `dmg` tuple would change golden counts and play an impact).
+ * @returns {'r'|null}
+ */
+export function officialDamageMark(finalAmount, expectedAmount) {
+  const fin = Number.isFinite(finalAmount) ? Math.max(0, finalAmount) : 0;
+  const exp = Number.isFinite(expectedAmount) ? Math.max(0, expectedAmount) : 0;
+  return fin + 1e-9 >= exp * 1.5 ? 'r' : null;
+}
+
+/**
+ * Expected damage for the red-number test. Same mitigation as the hit, without DEF/RES penetration and without
+ * the multipliers applied after mitigation (source dmgDealtMul / phys/artsDealtMul, target dmgTakenMul and the
+ * type-taken multipliers, shields, hpDamage rewrites, hit-count replacement).
+ * [ASSUMED] `dmg.amount` is already the attack's stated ATK × 攻击倍率 — callers bake `atkScaleMul` in, and this
+ * does not divide it back out. `dmg.mul` stays on both sides (the instance's own scale, including a skill-hit
+ * fraction). Cached-ATK expected damage (raw ATK only), forced red, blue numbers and yellow BLOCK have no
+ * DamageInfo flag here and are not applied.
+ */
+function officialExpectedAmount(dmg, type, ts, target) {
+  const base = mitigate(dmg.amount, type, ts, {
+    defIgnorePct: 0, defIgnoreFlat: 0, resIgnorePct: 0, resIgnoreFlat: 0,
+    elementalRes: type === 'elemental' ? (target.def?.epDamageResistance ?? 0) : 0,
+  });
+  const mul = Number.isFinite(dmg.mul) ? dmg.mul : 1;
+  const exp = base * mul;
+  return Number.isFinite(exp) && exp > 0 ? exp : 0;
+}
+
+/** Pre-shield damage after mitigation and the post-mitigation multipliers. Identical to the inline formula it replaced. */
+function landedPreShield(dmg, type, ts, ss, target) {
+  let final = mitigate(dmg.amount, type, ts, {
+    defIgnorePct: dmg.defIgnorePct + (ss ? ss.defIgnorePct : 0),
+    defIgnoreFlat: dmg.defIgnoreFlat + (ss ? ss.defIgnoreFlat : 0),
+    resIgnorePct: dmg.resIgnorePct + (ss ? ss.resIgnorePct : 0),
+    resIgnoreFlat: dmg.resIgnoreFlat + (ss ? ss.resIgnoreFlat : 0),
+    elementalRes: type === 'elemental' ? (target.def?.epDamageResistance ?? 0) : 0,
+  });
+  let mul = dmg.mul * (type === 'elemental' ? 1 : ts.dmgTakenMul);
+  if (ss) mul *= ss.dmgDealtMul * (type === 'phys' ? ss.physDealtMul : type === 'arts' ? ss.artsDealtMul : 1);
+  mul *= type === 'phys' ? ts.physTakenMul : type === 'arts' ? ts.artsTakenMul : type === 'elemental' ? ts.elementalTakenMul : ts.trueTakenMul;
+  final *= mul;
+  if (!(final > 0) || !Number.isFinite(final)) final = 0;
+  return final;
+}
+
+/** Source stats for a display-only dodge classification. Reading `source.s` while dirty rescales HP (units.js). */
+function peekStats(unit) {
+  if (!unit) return null;
+  return unit._dirty ? (unit._s || null) : unit.s;
+}
+
 /**
  * Full damage pipeline. Returns the HP actually removed (0 when dodged/cancelled/absorbed).
  */
```

```diff
@@ -281,60 +336,59 @@ export function dealDamage(battle, source, target, dmgIn) {
-  // dodge
+  // dodge. The yellow MISS (PRTS: a hit that would have been red, dodged) is classified after the existing roll
+  // and does not roll again. Source stats are peeked so a dirty attacker is not refreshed just to label the dodge.
   if (dmg.canDodge && (type === 'phys' || type === 'arts')) {
     const p = type === 'phys' ? ts.dodgePhys : ts.dodgeArts;
     if (p > 0 && battle.rng() < p) {
-      battle.fx('dodge', { x: target.x, y: target.y, id: target.id });
+      const peeked = !dmg.sourceless ? peekStats(source) : null;
+      const red = officialDamageMark(landedPreShield(dmg, type, ts, peeked, target), officialExpectedAmount(dmg, type, ts, target)) === 'r';
+      battle.fx('dodge', red
+        ? { x: target.x, y: target.y, id: target.id, num: 'm' }
+        : { x: target.x, y: target.y, id: target.id });
       if (battle._hooks.dodge) battle.emit('dodge', { source, target, dmg });
       return 0;
     }
   }
   // 频次 units (flags hitCount / hitCountArts): every damage instance removes exactly 1 HP (maxHp = hits needed);
   // hitCountArts ignores physical instances. The instance keeps its own DamageInfo, so `damaged` handlers still
   // recognise their own (tagged) damage — never re-create such a loss with a fresh loseHp.
+  // The red test compares that 1 (or 0) with the ordinary expected damage: 特殊生命值机制均不考虑 on the expected side.
   if (ts.flags.hitCount || ts.flags.hitCountArts) {
     const counts = !(ts.flags.hitCountArts && !ts.flags.hitCount && type === 'phys');
-    return applyHpLoss(battle, source, target, absorbShields(battle, target, counts ? 1 : 0, type), dmg);
+    const instance = counts ? 1 : 0;
+    const mark = officialDamageMark(instance, officialExpectedAmount(dmg, type, ts, target));
+    return applyHpLoss(battle, source, target, absorbShields(battle, target, instance, type), dmg, mark);
   }
   // 无来源 damage (element bursts) takes nothing from its source's stats; the source still gets the credit below
   const ss = source && source.s && !dmg.sourceless ? source.s : null;
-  let final = mitigate(dmg.amount, type, ts, {
-    defIgnorePct: dmg.defIgnorePct + (ss ? ss.defIgnorePct : 0),
-    defIgnoreFlat: dmg.defIgnoreFlat + (ss ? ss.defIgnoreFlat : 0),
-    resIgnorePct: dmg.resIgnorePct + (ss ? ss.resIgnorePct : 0),
-    resIgnoreFlat: dmg.resIgnoreFlat + (ss ? ss.resIgnoreFlat : 0),
-    elementalRes: type === 'elemental' ? (target.def?.epDamageResistance ?? 0) : 0,
-  });
-  // 脆弱 / "受到的伤害±" (dmgTakenMul) scale 物理、法术、真实 only; 元素伤害 takes 元素脆弱 alone (header)
-  let mul = dmg.mul * (type === 'elemental' ? 1 : ts.dmgTakenMul);
-  if (ss) mul *= ss.dmgDealtMul * (type === 'phys' ? ss.physDealtMul : type === 'arts' ? ss.artsDealtMul : 1);
-  mul *= type === 'phys' ? ts.physTakenMul : type === 'arts' ? ts.artsTakenMul : type === 'elemental' ? ts.elementalTakenMul : ts.trueTakenMul;
-  final *= mul;
-  if (!(final > 0) || !Number.isFinite(final)) final = 0;
+  let final = landedPreShield(dmg, type, ts, ss, target);
+  // The 1.5× test uses this pre-shield total. The integer on the dmg event is whatever remains after shields and
+  // hpDamage (PRTS can show a number that differs from the HP delta; [ASSUMED] the shown value stays that integer).
+  const mark = officialDamageMark(final, officialExpectedAmount(dmg, type, ts, target));
   // 限伤: a leader's hit of ≥ BOSS_HIT_LIMIT in a boss / hidden battle is cancelled before it reaches shields / HP — what
   // ran before it (the attack, its SP, `hit` hook effects, separate element 损伤) stays; nothing after it happens
   if (final > 0 && leaderHitCancelled(battle, target, final)) return 0;
   final = absorbShields(battle, target, final, type);
   // 伤判效果 after the barriers (header): a handler may lower what reaches the HP — never raise it (a 流失 skips this)
   if (final > 0 && battle._hooks.hpDamage) {
     const hctx = { source: hs, target, amount: final, dmg, credit: source };
     battle.emit('hpDamage', hctx);
     if (Number.isFinite(hctx.amount)) final = Math.max(0, Math.min(final, hctx.amount));
   }
-  return applyHpLoss(battle, source, target, final, dmg);
+  return applyHpLoss(battle, source, target, final, dmg, mark);
 }
```

```diff
@@ -366,13 +420,16 @@ export function applyHpLoss(battle, source, target, amount, dmg) {
-export function applyHpLoss(battle, source, target, amount, dmg) {
+export function applyHpLoss(battle, source, target, amount, dmg, mark) {
   if (!target.alive) return 0;
   let dealt = 0;
   const hs = dmg && dmg.sourceless ? null : source; // the source hooks see (无来源: none; `credit` keeps it)
   if (target.bossPool) {
     const pool = target.bossPool;
     const before = pool.hp;
     ...
     target.stats.taken += dealt;
     target.lastHitAt = battle.time;
     if (dmg && !dmg.silent && amount >= 0.5) {
       const shown = dmg.type === 'element' ? dmg.element : dmg.type === 'elemental' ? (dmg.element || 'true') : dmg.type;
-      battle._ev(['dmg', target.id, Math.round(amount), shown]);
+      // 'r' is display-only (official red number). Absent on every other hit, so the tuple stays four elements.
+      const ev = ['dmg', target.id, Math.round(amount), shown];
+      if (mark === 'r') ev.push('r');
+      battle._ev(ev);
     }
```

（为可读性，第三段省略了 `bossPool` 路由的未改动上下文行；被 `-`/`+` 标注的行一字未改。）

**为什么改**：`#412`（「设置新增『官方伤害数字』（默认关闭）：打开后只按 PRTS『伤害红字（暴击）』显示红色整数，以及本该出红字却被闪避的 MISS」）。

- **症状**：官方客户端只在「最终伤害 ≥ 期望伤害 × 1.5」时弹红字；本该弹红字却被闪避的那一下显示黄色 MISS。我们这边是每一次命中都弹一个数字，也没有红/MISS 之分。
- **根因**：伤害管线里既没有「期望伤害」这个概念（只有被减伤后的实际值），也没有把「这一下算不算红字」传给表现层；闪避分支在掷骰后直接返回 0，不区分「普通闪避」和「本该红字却被闪」。
- **修完什么样**：`dealDamage` 在减伤处顺带算一个 `mark`（`'r'` 或 `null`），经 `applyHpLoss` 塞进 `dmg` 事件的第 5 个元素；闪避时若本该是红字，`dodge` 事件带上 `num: 'm'`。表现层（客户端，D 区）据此只画红整数和 MISS。

**我们这边的情况**：该文件老板已改（`yours` 39506 字节 vs 官方 0.2.4 的 37342，**多 2164 字节**）。我们的改动集中在两处：

- `applyHpLoss` 函数开头：新增 `let amt = amount;` + `hpLoss` 钩子派发（HP 归零前的最后一道口子，覆盖 `battle.loseHp` 流失路径）—— 旧行 `335`、`342`、`351`、`355`；
- `redirectShare` 之后：新增 `RETALIATION_TAGS` / `isRetaliation`（反击/反伤不再互相触发）—— 旧行 `166`；
- 文件头注释 —— 旧行 `11`。

**怎么合**：官方这 3 个 hunk 与我们的改动**逐行不重叠**，可整段照搬。我用 0.2.4 当共同祖先跑了三方合并，**退出码 0、零冲突**，结果里 `isRetaliation`、`liftoffEvades`、`hpLoss` 派发与官方的 `officialDamageMark`/`landedPreShield`/`peekStats`/`mark === 'r'` **同时存在**。

> ⚠️ **两点必须照做，否则会把老板的东西弄丢**：
>
> 1. **不要整文件覆盖**。`damage.js` 是 DIVERGED，直接 `copy` 官方的 `damage.js` 过去会把我们的 `isRetaliation`、`hpLoss` 派发、`liftoffEvades` 一起抹掉。要搬的是**官方那 3 个 hunk**，不是整个文件。
> 2. **别用 `git apply` 盲打这个 patch**。我用 `git apply -p2 --check` 实测**失败**（`patch does not apply`）—— 因为我们在 `applyHpLoss` 的 `if (!target.alive) return 0;` 和 `let dealt = 0;` 之间插了 9 行，正好落在官方第 3 个 hunk 的上下文窗口里。**要用三方合并**（`git merge-file` / `git merge` 带 0.2.4 祖先），或照上面三段手工落 3 处。

> 📌 **口径修正（与队长口头结论有出入，以实测为准）**：队长说「官方动的是 `dealDamage`、我们动的是 `applyHpLoss`」。实测**不准确**：官方第 3 个 hunk **也改了 `applyHpLoss`**（签名加 `mark` 形参 + `dmg` 事件元组加第 5 元素）。准确说法是：**两边都改 `applyHpLoss`，但改的是不相邻的行**（官方改签名行与 `_ev` 元组，我们改函数体的 `amount`→`amt` 与 `hpLoss` 块）。结论不变（`CollideHunks = 0`、可整段搬），但照搬时请按 hunk 逐段落，别以为 `applyHpLoss` 整段都不用动。

**搬运动作**：用三方合并落 3 个 hunk（或手工照搬上面三段）。

**B 区点名的依赖，已确认**：`server/sim/content/items/battle.js` 的幽魂 `chess_item_9_90_e` 依赖 `damage.js` 的 `hpLoss` 派发。我核对过 `base-025/server/sim/damage.js`：**里面只有 `_hooks.hpDamage`，没有 `_hooks.hpLoss`** —— `hpLoss` 派发完全是我们的改动，官方这 3 个 hunk 一个字都不碰它。**照搬安全，`hpLoss` 派发不受影响。**

**跨区提示（不影响本次搬运，但会影响「什么时候看得见」）**：官方这套是**服务端发标记 + 客户端画**。我们这棵树里客户端还没接：`public/js/render/fx/numbers.js` 的签名是 `damage(view, amount, type, srcView)`（没有 `mark` 形参），`public/js/render/app.js` 调用处只传 4 个实参。所以：
- **先搬 A 区是安全的** —— 多出来的第 5 个元组元素和 `num: 'm'` 属性，旧客户端只是忽略，不会崩。
- 但要**真正看到**红字/MISS，还得等 D 区把 `numbers.js`、`app.js`、`fx/simfx.js`、`ui/fallbackField.js`、`ui/settings.js`、`public/i18n/*` 一起搬过去（`officialDamageNumbers` 开关）。

---

### 2~14. 13 个 CLEAN-APPLY 文件

这 13 个文件**我们与官方 0.2.4 逐字节相同**（SHA-256 已验），所以可以**直接整文件覆盖**，零冲突。下面按文件把 30 个 hunk 逐条交底（hunk 行号为 0.2.4 侧旧行号）。

#### 2. `server/sim/body.js`　【CLEAN-APPLY】5 hunk（+7/−6）

| hunk | 旧行 | 位置 | 改了什么 / 为什么 |
|---|---|---|---|
| 1 | 1–11 | 文件头注释 | 把「tile containing their position `(round(y), round(x))`」改写为「rounded half to even（`detmath roundHalfEven`；PRTS 作战机制 四舍六入五成双）」—— 记录取整规则换了 |
| 2 | 21–33 | `import` 区 | 从 `./detmath.js` 追加导入 `roundHalfEven` |
| 3 | 44–56 | `hitRect` 后的 `posKey` | `posKey` 里 `Math.round` → `roundHalfEven`（点状单位所属格） |
| 4 | 65–77 | `bodyKeys` / `bodyOnTile` | `bodyOnTile` 的退化分支同样换 `roundHalfEven` |
| 5 | 97–109 | `bodyInRadius` / `bodyTileReach` | `bodyTileReach` 同样换 `roundHalfEven` |

**为什么改**：挂 `#25`（「受击格按官方四舍六入五成双取整，被挡在场地边缘的敌人留在边缘那一格」，**PR #520**）。**症状**：坐标正好落在 .5 上时（典型是站在两格分界线/场地边缘的敌人），`Math.round` 一律向上取，和官方的 banker's rounding 差一格 —— 表现为「明明在范围内却打不到」或「边缘敌人所属格跳变」。**根因**：JS 的 `Math.round` 是 half-up，官方 `round` 是四舍六入五成双。**修完**：所有「位置 → 所属格」都走同一个 `roundHalfEven`。

#### 3. `server/sim/detmath.js`　【CLEAN-APPLY】3 hunk（+15/−1）

| hunk | 旧行 | 位置 | 改了什么 / 为什么 |
|---|---|---|---|
| 1 | 7–18 | 文件头注释 | 函数清单里补一行 `roundHalfEven(x)` 的说明 |
| 2 | 43–54 | `hypot` 之后 | **新增** `roundHalfEven(x)`：`Math.floor` 取整，恰好 .5 时按「偶进」；注释引用 PRTS 作战机制「受击方坐标经 round 函数取整（四舍六入五成双）得到其所属格坐标」 |
| 3 | 64–82 | `mul2` / `powi` | `powi` 补 `x === 0` 分支：`n === 0 → 1`、正奇次幂保留 `−0`、负奇次幂 `1/x`、正偶次幂 `0`、负偶次幂 `Infinity` —— 对齐 `Math.pow` |

**为什么改**：hunk 1–2 挂 `#25` / **PR #520**（同上，这是新取整函数的**落地点**）；hunk 3 挂 `#43`（「powi 对 ±0 的结果与 `Math.pow` 一致」，**PR #519**）。**症状**：`powi(0, n)` 走双倍-双倍累乘会丢掉 `−0` 的符号（`(−0)¹ = −0`、`(−0)⁻¹ = −∞`），与 `Math.pow` 不一致；确定性数学层要求逐位可复现。**修完**：零底数直接短路到 `Math.pow` 的精确结果。

> 📌 **同区依赖**：`roundHalfEven` 是本文件**新增**的导出，`body.js`、`battle/queries.js`、`targeting.js` 都 `import` 它。**必须先落（或同批落）`detmath.js`，否则那 3 个文件一覆盖就报 import 失败。**

#### 4. `server/sim/battle/queries.js`　【CLEAN-APPLY】2 hunk（+2/−1）

| hunk | 旧行 | 位置 | 改了什么 / 为什么 |
|---|---|---|---|
| 1 | 3–14 | 头注释 / `import` 区 | 追加 `import { roundHalfEven } from '../detmath.js'` |
| 2 | 18–30 | `_eb`（敌人分桶） | 点状敌人的格 `Math.round(e.y/x)` → `roundHalfEven`，注释「the tile body.js gives a point enemy」 |

**为什么改**：挂 `#25` / **PR #520**。分桶必须与 `body.js` 的所属格判定**用同一套取整**，否则「能打到」和「在哪一格」两套坐标各说各话。

#### 5. `server/sim/targeting.js`　【CLEAN-APPLY】4 hunk（+6/−4）

| hunk | 旧行 | 位置 | 改了什么 / 为什么 |
|---|---|---|---|
| 1 | 1–11 | 文件头注释 | 取整说明改为「rounded half to even, `detmath roundHalfEven`」 |
| 2 | 14–25 | `import` 区 | 追加 `import { roundHalfEven } from './detmath.js'` |
| 3 | 47–61 | `absoluteRangeKeys` / `tileKeyOf` | `tileKeyOf` 里 `Math.round` → `roundHalfEven` |
| 4 | 221–233 | `sortEnemyTargets` 前的 `sortAllyTargets` 注释 | 敌人索敌注释补一句：预备 `外勤医疗` 地图角色保留更早的 `aggroSeq` |

**为什么改**：hunk 1–3 挂 `#25` / **PR #520**（`tileKeyOf` 与 `body.js` 同源）。hunk 4 挂 `#18` / **PR #523**（「外勤医疗的预备地图角色在开战时保持比普通初始干员更早的索敌顺序」，本项**纯注释**，实现见 `deploy.js`/`summons.js`）。

#### 6. `server/sim/constants.js`　【CLEAN-APPLY】1 hunk（+9/−0）

| hunk | 旧行 | 位置 | 改了什么 / 为什么 |
|---|---|---|---|
| 1 | 217–228 | `MAX_HOOK_DEPTH` / `MAX_ALIVE_ENEMIES` 附近 | **新增** `export const FIELD_EDGE_INSET = 1 / 1048576;`（2^-20），注释说明：场地矩形边缘正好在「两格之间」，而所属格按四舍六入五成双取决于行列奇偶；内缩这么多恰好让边缘敌人留在边缘格，且 2^-20 在二进制里精确、不足以推动 0.1 格的滑步（1/1024 会推动） |

**为什么改**：挂 `#25` / **PR #520**（同一处修复的配套常量）。

#### 7. `server/sim/battle/spawns.js`　【CLEAN-APPLY】2 hunk（+6/−6）

| hunk | 旧行 | 位置 | 改了什么 / 为什么 |
|---|---|---|---|
| 1 | 1–13 | 头注释 / `import` | 导入追加 `FIELD_EDGE_INSET` |
| 2 | 198–214 | `_clampPos` | 边缘钳制从 `R.c0 - 0.5`（正好压在中线）改为 `R.c0 - m`，`m = 0.5 - FIELD_EDGE_INSET` |

**为什么改**：挂 `#25` / **PR #520**。**症状**：被挡在场地边缘的敌人，旧钳制把它按在「两格正中的分界线」上，四舍六入五成双下所属格会在奇偶之间跳（边缘那一格 / 里面那一格）。**修完**：敌人被留在**边缘那一格**内，也就是 CHANGELOG 说的「被挡在场地边缘的敌人留在边缘那一格」。

#### 8. `server/sim/battle/deploy.js`　【CLEAN-APPLY】3 hunk（+12/−8）

| hunk | 旧行 | 位置 | 改了什么 / 为什么 |
|---|---|---|---|
| 1 | 10–22 | `_deploy` 的 JSDoc / 签名 | 形参表追加 `preBattleAggroSeq = null` |
| 2 | 34–61 | `_deploy` 主体 | ① `u.aggroSeq = preBattleAggroSeq ?? u.deploySeq;`（**保留** `deploySeq` 作为本次部署的身份，只让索敌序更早）；② 联防开场把 HP/SP 恢复**推迟**到 `Battle.start` 末尾（`restoreLater`，`hpPct` 不再夹 `0.01` 下限、不再 `Math.max(1, …)`）；③ `skill.reset(restoreLater ? null : cs)` |
| 3 | 65–79 | `_deploy` 尾部 | 联防开场的 SP 恢复同样推迟（原本部署后立刻 `setSpTotal`） |

**为什么改**：hunk 2 的 `preBattleAggroSeq` 挂 `#18` / **PR #523**。hunk 2 的其余部分与 hunk 3 的**联防延迟恢复**挂 `#11`（「修复联防阿戈尔继承残血后再次结算开场吞噬、误触发复活的问题，保留准确生命比例和技力」）。**症状**：联防第二阶段继承上一阶段的残血，但「部署时立刻回填」会让开场的吞噬/复活类效果**带着回填后的血量再结算一次**；而且旧代码 `Math.max(1, …)` 会把不足 1 HP / 不足 1% 的合法幸存者**奶回 1 HP**。**根因**：恢复时点早于 `battleStart` 的开场效果。**修完**：`Battle.start` 里所有开场效果建立完新数值后**统一恢复一次**，且保留分数血量。

#### 9. `server/sim/battle/lifecycle.js`　【CLEAN-APPLY】1 hunk（+9/−0）

| hunk | 旧行 | 位置 | 改了什么 / 为什么 |
|---|---|---|---|
| 1 | 47–58 | `BattleLifecycle.start`，`emit('battleStart')` 之后 | 联防（`kind === 'unite'`）遍历己方单位，在 `battleStart` **之后**按 `u.carry` 恢复 `hp = maxHp * hpPct`（保留分数血量、不设 1 HP 下限）与 `setSpTotal(cs.sp)`；跳过 `cs.down`/未部署/`deploySeq <= seq0` 的 |

**为什么改**：挂 `#11`（同 `deploy.js` 的联防修复）。**这是那处修复真正落地的地方** —— 注释原文说明「联防在全部开场效果建立新数值之后再恢复上一阶段状态；尤其是阿戈尔重建吞噬属性时，不会带着继承目标再吃一次开场伤害」。

#### 10. `server/sim/battle/summons.js`　【CLEAN-APPLY】1 hunk（+1/−1）

| hunk | 旧行 | 位置 | 改了什么 / 为什么 |
|---|---|---|---|
| 1 | 57–69 | `spawnToken` | `this._deploy(u, { initial: false, preBattleAggroSeq: opts.preBattleAggroSeq })` —— 把调用方给的索敌序透传下去 |

**为什么改**：挂 `#18` / **PR #523**。预备地图角色（`content/tokens.js` 的 `spawnMapChar`）走 summon 路径创建，需要把「更早的索敌序」传进 `_deploy`。

#### 11. `server/sim/units.js`　【CLEAN-APPLY】1 hunk（+1/−1）

| hunk | 旧行 | 位置 | 改了什么 / 为什么 |
|---|---|---|---|
| 1 | 74–86 | `Unit` 构造函数 | `aggroSeq` 的**行尾注释**从「= deploySeq, except summons of the initial deployment」改为「usually deploySeq; initial summons and prepared map characters are exceptions」 |

**为什么改**：挂 `#18` / **PR #523**，**纯注释同步**，无行为改动。

#### 12. `server/sim/ai.js`　【CLEAN-APPLY】3 hunk（+30/−3）

| hunk | 旧行 | 位置 | 改了什么 / 为什么 |
|---|---|---|---|
| 1 | 168–179 | `acquireTargets` | 要塞（Fortress）在**没有任何其它候选**时，拿自己的格子 `[tileR*COLS+tileC]` 再选一次，能打到**它挡不住的**脚下敌人；记 `prof._fortressMelee`，按优先级排序后取 1 个 |
| 2 | 222–234 | `performAttack` | 把本次射击的 `fortressMelee: !!prof._fortressMelee` 快照进 `info`（选敌会改写 `prof`，炮弹在飞时模式不能被改） |
| 3 | 304–332 | `resolveHit` | ① 浮游改「本体一击 + 附加伤害」：`funnelMul` 与 `dmgMul` 分离，`attachedFunnel`（`funnelBodyHits !== 0`）时先打 `funnelBodyHits` 次本体，再让浮游附加（`tags` 加 `addition`/`funnel`、`isAttack` 置位）；`funnelBodyHits === 0` 是「只出浮游」的退出阀；② 溅射门控 `(!info.fortressMelee \|\| prof.fortressMeleeSplash)` |

**为什么改**：
- hunk 1、2 与 hunk 3 的**溅射门控**挂 `#15`（「修复…**号角不攻击脚下不可阻挡敌人**…（**PR #502**）」）。**症状**：号角（要塞）脚下的敌人若不可阻挡，她不打；且她把脚下敌人当近战攻击时，溅射也会被错误地一起掐掉。**修完**：给她一个「本格近战格」，并在 profile 显式要求时（`fortressMeleeSplash`）保留溅射。
- hunk 3 的**浮游分流**挂 `#21`~`#24`（**PR #537**「驭械术师未释放的浮游改为本体攻击再加一份附加伤害（初始相当于攻击力 20%，同一目标每次 +15，上限 110%）」；`#22`「只改普攻的技能保留干员自己的那一击」；`#23`「干员再部署时浮游倍率回到初始值」（重置点在 `professions.js`）；`#24` / **PR #535**「洛洛二技能放出的浮游在目标离开攻击范围后继续锁定」）。

> ⚠️ **跨区硬依赖（B 区）**：hunk 3 的溅射门控读 `prof.fortressMeleeSplash`，而**设置它的行在 B 区的 `server/sim/content/kits/ops/chess_char_5_08-horn.js`**（0.2.4 无、0.2.5 有 —— 我核对过：`base-024` 0 处、`base-025` 1 处）。**A 区 `ai.js` 必须与 B 区 `horn.js` 同批落地**，否则号角近战模式下的溅射会被这条门控**单方面掐掉**（官方是靠 `fortressMeleeSplash: true` 放行的）。
>
> ⚠️ **跨区硬依赖（B 区，浮游）**：hunk 3 让引擎改读 `prof.funnelMul`（旧读 `dmgMul`）。B 区的 `chess_char_2_10-rockr.js`、`3_13-malist.js`、`3_20-kjera.js`、`6_18-whitw2.js` 会改成设 `funnelMul`。**两边必须同批**：只落 B 区 kits（设 `funnelMul`）而不落 A 区 `ai.js`，0.2.4 的 `ai.js` 只读 `dmgMul` → **浮游倍率整段失效**（浮游伤害退化为不吃 ramp）；只落 A 区则不生效但不致错。

#### 13. `server/sim/professions.js`　【CLEAN-APPLY】3 hunk（+15/−3）

| hunk | 旧行 | 位置 | 改了什么 / 为什么 |
|---|---|---|---|
| 1 | 18–29 | 文件头 profile 字段清单 | 补 `funnelMul(battle, unit, target) → number` 与 `funnelBodyHits n` 两条（含「省略即为 1、0 = 只出浮游（荒芜拉普兰德 S2）、>0 = 该次数的本体（至简 S2）」） |
| 2 | 382–395 | `installTactician` / `installFunnel` | `installFunnel` 抽出 `reset()`（清 `funnelTarget`、回 `funnelScale = init`、清 `funnelMap`），并挂 `deploy` 钩子：**非 `move`** 的部署（＝真再部署）立即重置；自由移动保留 ramp |
| 3 | 505–517 | `SUB` 的 `funnel` 分支 | 浮游倍率从 `dmgMul` **改名**为 `funnelMul`（函数体逻辑不变） |

**为什么改**：挂 `#23`（「干员再部署时浮游倍率回到初始值，并清掉按目标记住的倍率；自由移动仍保留。已经飞出的浮游按命中时的倍率结算（**PR #536**）」）与 `#21`/`#22`（**PR #537** 的引擎侧配套）。hunk 1 的字段文档同步 `#21`~`#24`。**症状**：再部署后浮游倍率不归零，或对同一目标继续累积。**修完**：换目标/再部署立即重置，`funnelMap`（耶拉、至简的按目标记倍率）随之清空。

#### 14. `server/sim/skills.js`　【CLEAN-APPLY】1 hunk（+5/−0）

| hunk | 旧行 | 位置 | 改了什么 / 为什么 |
|---|---|---|---|
| 1 | 490–501 | `SkillRuntime` 的「基本开技条件」判定 | 非治疗技能且 `u.profile?.fortress` 时，用**自己那一格** `[u.tileR*COLS + u.tileC]` 再判一次「范围内有敌 / 有可选友方」，满足则允许开技 |

**为什么改**：挂 `#15` / **PR #502**（与 `ai.js` hunk 1 同一处修复的服务端另一半）。注释原文：「The branch's own-tile melee range also satisfies the basic cast condition for unblockable fragments」—— 要塞挡住不可阻挡的碎片时，本格近战范围也要能算作「有目标」，否则自动开技永远不触发。

---

## 三、搬运顺序与跨区约束（A 区结论）

1. **第一批（A 区内部，可一次性覆盖）**：`detmath.js` → `constants.js` → `body.js` → `targeting.js` → `battle/queries.js` → `battle/spawns.js`。
   `detmath.js` 必须与后四个**同批或更早**（`roundHalfEven` 是新增导出）。
2. **`damage.js` 单独处理**：用三方合并落 3 个 hunk，**不要整文件覆盖、不要 `git apply` 盲打**（见二·1）。三点确认：① 合并后 `isRetaliation`/`liftoffEvades`/`hpLoss` 派发都还在；② `base-025` 无 `hpLoss`，官方 hunk 不碰它，**照搬安全**；③ 旧客户端忽略第 5 个元组元素与 `num: 'm'`，**先搬服务端不会崩**，红字要等 D 区才可见。
3. **`ai.js` + `professions.js` 必须与 B 区同批**：
   - `ai.js` 溅射门控 ↔ `content/kits/ops/chess_char_5_08-horn.js`（少一个 → 号角近战溅射被掐）；
   - `ai.js`/`professions.js` 的 `funnelMul` ↔ `chess_char_2_10-rockr.js`、`3_13-malist.js`、`3_20-kjera.js`、`4_03-kjera.js`、`6_18-whitw2.js`（少 A 区 → 浮游倍率整段失效）。
4. 其余 7 个文件（`deploy.js`、`lifecycle.js`、`summons.js`、`units.js`、`skills.js`、`constants.js`、`body.js` 等）互相无外部依赖，可独立覆盖。

**没有做的事**：A 区只审不改。本报告未触碰任何源码，也未改动 `.scratch\audit-025\` 下的共享证据。

**不确定项（不编）**：
- `ai.js` hunk 2（`info.fortressMelee` 快照）与 hunk 3 的溅射门控，CHANGELOG **未单列**，推断为 `PR #502` 一族为「炮弹在飞行中选敌改写 profile」所做的伴随加固。编号只能挂到 `PR #502` 这一族，无法确认是否同一 commit。
- `detmath.js` hunk 1（头注释补 `roundHalfEven`）与 `units.js` hunk 1（`aggroSeq` 注释）属纯文档改动，分别随 `PR #520`、`PR #523` 进入，CHANGELOG 未单列。
