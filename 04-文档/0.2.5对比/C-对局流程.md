# C-对局流程：首领配对改成每局随机、固定赠品不再被库存卡死、已展示的牌不再领取失败——其中「首领随机配对」和「Touch 外勤医疗」老板树整条都还没有

> 覆盖 18 个文件 / 32 个 hunk；CLEAN-APPLY 5 个，DIVERGED 13 个，新增 0 个。
> **本区没有一处真撞车**：18 个文件的 `CollideHunks` 全为 0（`overlap-exact.csv`），32 个 hunk 全部**自由可搬**。
> 但 C 区的风险不在文本冲突，而在**跨文件接口耦合**：有一处必须**同批落地**、有一处合并**方向会被做反**。
> 这两件事集中在下面 **〇.2「C 区真正的两个雷」**，动手前必读。

---

## 〇、先说一件必须知道的事（它决定了这一区怎么合）

老板这棵树 `Stronghold-Protocol-repo\package.json` 的版本是 **`0.3.0`**，不是 0.2.4。
`CHANGELOG.md` 第 3 行写明：0.3.0 于 2026-10-08 成型，2026-10-10 才把上游 **v0.2.2** 三方合并（共同祖先 = tag `v0.2.1`）。

这带来两个后果，C 区尤其明显：

1. **老板树里有一批官方 0.2.5 根本没有的东西**，比如 `server/match/hextech.js`（协议源石／内部键仍叫 hextech，官方没有这套玩法）、
   `server/match/match/testField.js`（测试场）。`base-024` 和 `base-025` 里都**不存在** `hextech.js`。
   → 这就是为什么 C 区 13 个 DIVERGED 文件里有 11 个的 `.vs-025.diff` 会冒出 `hextech` / `test` 的改动。
2. **0.2.5 的几处修复，老板树整条都没有**（不是改了、是从来没有），因为它们是 0.2.1 之后才进上游的：
   - **首领配对每局随机**（0.2.5 规则条目，第 10 行）
   - **Touch 外勤医疗按本局团队权益保留**（第 12 行）
   - **#498 已展示的牌不因库存耗尽领取失败**
   - **#488/#491/#495 固定赠品不被共享库存阻断**

   → 对这四处，`base-025` 里是**新增功能**，老板树里是**旧行为**；合并方向是「把官方那几行搬进来」，
   不是「两边对着改」。别把它当成双方都改过、需要折中。

---

## 〇.2、C 区真正的两个雷（撞车为 0，风险全在这里）

`overlap-exact.csv` 用 `unified=0` + 插入点感知重算后，**C 区 18 个文件的 `CollideHunks` 全为 0**，
`real-collisions.csv` 里也**没有任何 `server/match/` 条目**。
所以之前按 `merge-worksheet.csv`（`unified=6` 上下文）标出的那 8 个「撞车」hunk
—— `audit.js 41-53`、`Match.js 370-381`、`bossRounds.js 3-15/63-75`、`phases.js 4-15`、
`views.js 83-94`、`economy.js 1-13/44-55` —— **全部是「紧邻但不同行」的误报，已降级为自由可搬**。
（`unified=6` 会把上下 6 行内、其实不重叠的改动算成撞车。）

**结论要改口：C 区不是「撞车重灾区」，而是「照抄很安全、但有两处一抄就崩」。** 雷在这两处：

### 雷 1（最要紧）：`pairPlayers` 换了签名，`server/` 内 5 文件必须同批落地

0.2.5 把 `pairPlayers(alive)` 改成 **`pairPlayers(alive, rng, previous = null)`**
（`base-025\server\match\finalAssault.js:60`），函数体里：

```js
} else singles = sorted.length > 1 ? rng.shuffle(sorted) : sorted;
```

**`rng` 没有默认值**，而老板树**所有 `server/` 调用点都还只传 1 个参数**。
全表（已用 `grep` 全仓复核，leader 亦复核）：

| 文件 | 行 | 性质 | 在官方发行包内？ |
|---|---|---|---|
| `server/match/finalAssault.js` | 59 | 定义 | 是 |
| `server/match/match/bossRounds.js` | 70 | 调用 | 是 |
| `server/match/match/phases.js` | 301 | 调用 | 是 |
| `server/match/audit.js` | **47（import）／461（调用）** | import＋调用，**两处都要动** | 是 |
| `tools/balance.mjs` | 372 | 调用 | **否（我们自己带）** |
| `test/match/finalAssault.test.js` | 14–17 | 调用×4 | **否** |
| `test/ui/gameLogic.test.js` | 774 | 调用 | **否** |
| `public/dev/game-mock.js`、`public/js/ui/gameLogic/camera.js` | — | 仅注释引用，**不用改** | — |

**关于最后一列（重要）**：`test/` 与 `tools/balance.mjs` **不在官方发行包内**——
官方 0.2.4 发行 `MANIFEST.json`（6476 条）里 `"test/` 出现 **0** 次、无 `tools/balance.mjs`；
0.2.5 更新包 `UPDATE.json`（206 条）里同样 **0** 次。
（我验过：`base-024` 是 tag 的 `git archive`，本身**带** `test/`（628 个文件），所以才会出现「树里有、发行包里没有」的错位。）
⇒ 所以**不能**说「官方 0.2.5 自己漏了同步」；是这些文件**根本不属于发行范围，官方不会替我们同步，必须我们自己跟进**。

官方对应的传参（`base-025`）：`bossRounds.js:69`、`phases.js:297` 都改成
`pairPlayers(..., createRng(deriveSeed(this.seed, 'boss-pairs')), this.bossPairs)`。

所以：**单独覆盖 `finalAssault.js` 会让服务端 `TypeError`**（`rng` 为 `undefined`）。
只有「场上只剩 1 人」时才恰好不触发，因为 `sorted.length > 1` 才走 `shuffle`。

**`server/` 内必须同批落地的 5 个文件（顺序即有向）**：

> `4 finalAssault.js`（新签名＋实现） → `7 Match.js`（加 `this.bossPairs` 字段） →
> `10 match/phases.js`（`_planBossWaves` 传 rng + 写 `bossPairs`） → `8 match/bossRounds.js`（开局传 rng + 写 `bossPairs`） →
> `1 audit.js`（**改 47 行 import + 461 行调用**，两处一起）

### 雷 1 之附：`audit.js` 的 hunk 2「不是文本冲突，但必须手工跟进」

`audit.js` 官方 hunk 2（旧 41-53）在文本上**只删掉 import 里的 `pairPlayers` 一个词**，
`CollideHunks=0`，纯文本层面可以照搬。但它与 hunk 3（把 461 行改成读 `m.bossPairs`）**是一件事的两端**——
`audit.js` 有**两处**要动：**47 行 import** 与 **461 行调用**。四种做法里只有一种不坏：

| 做法 | 后果 |
|---|---|
| 两个 hunk **都搬** | ✅ 正确：导入删了、461 行也改成读 `m.bossPairs`，自洽 |
| 只搬 hunk 2（删导入），**不搬 hunk 3** | ❌ `audit.js:461` 仍在调 `pairPlayers` → **`ReferenceError`** |
| 只搬 hunk 3（改 461 行），**不搬 hunk 2** | ⚠️ 能跑，但 `pairPlayers` 成了**未使用的导入**（lint 噪音，且与官方不一致） |
| **两个都不搬** | ❌ `finalAssault.js` 已换签名，461 行仍只传 1 个参数 → **`TypeError`** |

**唯一正确的做法**：hunk 2 与 hunk 3 **一起**照搬。
这也是为什么 `audit.js` 在「同批 5 文件」里排最后（它依赖前面全部落地）。

### 雷 2（最容易被做反）：`economy.js` 的 #498 合并方向是「反向操作」

老板在 `player/economy.js` 里**把官方 #498 的修复退回成了 0.2.4 的旧行为**（恢复了
`pool.left(base) < need → SOLD_OUT` 那段判断）。所以这一处：

- **不是**「两边各改一半、取个折中」；
- **而是**要把老板恢复的那 4 行**再删一次**，换回官方的注释与放行逻辑。

`areas.csv` 只标 `DIVERGED`，`threeway.csv` 只给字节数，**都看不出方向**。只有读 `.vs-025.diff` 才发现老板是「往回改的」。

配套：`player/prep.js`（#15，CLEAN-APPLY）管奖励牌，`pool.js`（#17）只是注释。
三处任缺其一，会出现「奖励牌能领、商店牌却买不了」或「注释说能透支、代码却拦住」的半吊子状态。

### 附：我们自己的树里还有 3 个 `pairPlayers` 调用点会跟着崩（必须我们自己跟进）

`grep` 全仓，除上面 `server/` 的调用点外，**我们自己树上**还有 3 处仍是老的单参写法，换签名后同样 `TypeError`：

- `tools/balance.mjs:372` — `pairPlayers(m.alivePlayers())`
- `test/match/finalAssault.test.js:14–17` — 4 条断言里 3 条传 ≥ 2 人 → 会走 `shuffle`
- `test/ui/gameLogic.test.js:774` — `left.filter(...)` 最多 4 人

**这 3 处不在官方发行包内**（官方 0.2.4 `MANIFEST.json`（6476 条）与 0.2.5 更新包 `UPDATE.json`（206 条）
均**无 `test/`**、**无 `tools/balance.mjs`**），所以官方不会替我们同步，**必须我们自己跟进**。

补充一处**不用改**的：`public/dev/game-mock.js`、`public/js/ui/gameLogic/camera.js` 里出现的 `pairPlayers`
只是注释里的说明性引用，不是调用，**不必动**。

这 3 处**不在我 C 区 18 个文件内**，我只做事实报告、未改任何文件；
建议 leader 派给 `test/` 与 `tools/` 的归属区一并处理，否则我们自己的 `npm test` 与平衡工具会在升级后立刻炸。

---

## 一、结论速览

| # | 文件 | 分类 | 修的是啥 | 来源 | 搬运建议 |
|---|---|---|---|---|---|
| 1 | `server/match/audit.js` | DIVERGED | 审计改查「保存下来的配对」；老板这边另加了海克斯首漏豁免 | 0.2.5 第10行 + 老板自有 | 自由可搬；⚠️ **不是冲突但要跟手**：`pairPlayers` 的 **47 行 import 与 461 行调用要一起改**（〇.2 雷 1 附） |
| 2 | `server/match/bot.js` | DIVERGED | AI 选策略／构筑时软性让开队友已选阵营 | #514 / PR #518（第37行） | 自由可搬：官方 2 处整段照抄，保留老板 hextech 导入 |
| 3 | `server/match/effectsMeta.js` | DIVERGED | ctx 增加 `teamMedicGranted` 只读项 | 0.2.5 第12行 | 自由可搬：官方 +2 行直接加（须配 #9 / #12） |
| 4 | `server/match/finalAssault.js` | **CLEAN-APPLY** | 配对改为种子随机 + 沿用上一轮配对 | 0.2.5 第10行 | ⚠️ **不可单独覆盖**，必须与 #7/#8/#10/#1 同批（〇.2 雷 1） |
| 5 | `server/match/gamedata.js` | DIVERGED | 固定赠品清单 `isUnlimitedGiftItem` | #488/#491/#495（第13行） | 自由可搬：官方 2 处整段加，别碰老板 hextech 块 |
| 6 | `server/match/invariants.js` | DIVERGED | 固定赠品允许超库存（不报不变量） | #488/#491/#495（第13行） | 自由可搬：改 item 校验行 + 注释，须配 #5 |
| 7 | `server/match/Match.js` | DIVERGED | 新增 `this.bossPairs = null` 字段 | 0.2.5 第10行 | 自由可搬：**只插 1 行**，勿照抄上下文（会挤掉老板 hextech 字段） |
| 8 | `server/match/match/bossRounds.js` | DIVERGED | 开局配对注入种子 rng，并记住配对 | 0.2.5 第10行 | 自由可搬：改 import 行 + 配对 2 行，保留老板 `enemyHexMods` 包装 |
| 9 | `server/match/match/infra.js` | **CLEAN-APPLY** | `teamMedicGranted()` 本局团队权益 | 0.2.5 第12行 | 可直接覆盖；但 #3/#11 要跟着改 |
| 10 | `server/match/match/phases.js` | DIVERGED | 赛前就定死配对（准备期预览用同一份） | 0.2.5 第10行 | 自由可搬：加 `createRng` 导入 + 换 `_planBossWaves` 开头，保留老板 hex 分支 |
| 11 | `server/match/match/views.js` | DIVERGED | 对外公布 `bossPairs`；医疗预备位改用团队权益 | 0.2.5 第10、12行 | 自由可搬：插 `bossPairs` 行 + 换 `prepMapChars` 判断，保留老板 test/hex 字段 |
| 12 | `server/match/player/acquire.js` | DIVERGED | 赠品可透支库存；晋升奖励改抽 `diyStockEntries` | #488/#491/#495 + #515/§30.23 | 自由可搬：官方 2 处整段照抄（须配 #5） |
| 13 | `server/match/player/diy.js` | DIVERGED | 奖励刷新改用 `diyStockEntries` 的说明 | #515 / PR #544（第20行） | 自由可搬：官方**纯注释**改动 |
| 14 | `server/match/player/economy.js` | DIVERGED | 叠层提示音只在「活的」阶段播；已展示牌可买 | #482（第28行）、#498（第14行） | 自由可搬，但 ⚠️ **#498 方向是反向**：要再删一次旧的库存闸门（〇.2 雷 2） |
| 15 | `server/match/player/prep.js` | **CLEAN-APPLY** | 奖励牌不再因库存耗尽领取失败 | #498（第14行） | 可直接覆盖；须与 #14 同批 |
| 16 | `server/match/PlayerState.js` | DIVERGED | 合并奖励注释补「自选同阶可入池」 | #515 / PR #544（第20行） | 自由可搬：官方**纯注释**改动 |
| 17 | `server/match/pool.js` | **CLEAN-APPLY** | 卡池注释：道具买不到、干员牌可透支 | #498（第14行） | 可直接覆盖（纯注释，**不代表 #498 已实现**） |
| 18 | `server/match/unite.js` | **CLEAN-APPLY** | 联防继承血量下限 0.01 → 0（保住准确血量比） | 0.2.5 第11行 | 可直接覆盖（纯修正，务必做） |

分类统计自洽核对：DIVERGED 13 = #1,2,3,5,6,7,8,10,11,12,13,14,16；CLEAN-APPLY 5 = #4,9,15,17,18；新增 0。
hunk 数 26 + 6 = 32，与 `areas.csv`（C-match：18 文件 32 hunk）和 `merge-worksheet.csv`（32 行）一致。

---

## 二、逐文件明细

### 1. `server/match/audit.js`　【DIVERGED】　官方 3 hunk，+12/−4

**官方改了什么**（0.2.4 → 0.2.5）

hunk 1（旧 27-39，`CollideHunks=0`）——开头文档行，配对说明改了：

```diff
-//   final assault fields pair alive players by seat, team LP = Σ alive LP, boss pool = bossPoolHp(); hidden core only
+//   final assault fields follow the saved per-match pairs, team LP = Σ alive LP, boss pool = bossPoolHp(); hidden core only
```

hunk 2（旧 41-53，`CollideHunks=0`）——import 块：

```diff
-import { pairPlayers, bossPoolHp, hiddenEligible } from './finalAssault.js';
+import { bossPoolHp, hiddenEligible } from './finalAssault.js';
```

hunk 3（旧 446-466，`CollideHunks=0`）——把「按座位现算配对」换成「查保存的配对」：

```diff
   wrap(m, 'startFinalAssault', function (orig, hidden) {
     const alive = m.alivePlayers();
+    const before = m.bossPairs?.map(g => g.slice()) ?? null;
     const lpSum = alive.reduce((s, p) => s + Math.max(0, p.lp), 0);
     const teamLp0 = m.teamLp;
     const res = orig(hidden);
     runInvariants();
     check('final assault', () => {
       if (!alive.length) return;
-      const groups = pairPlayers(alive).map((g) => g.map((p) => p.playerId).join(','));
+      const pairs = m.bossPairs || [];
+      const memberIds = pairs.flat();
+      if (pairs.length !== Math.ceil(alive.length / 2) || pairs.some(g => g.length < 1 || g.length > 2)
+        || new Set(memberIds).size !== memberIds.length
+        || JSON.stringify([...memberIds].sort()) !== JSON.stringify(alive.map(p => p.playerId).sort())) fail('boss pairing does not cover every alive player once');
+      if (before && before.flat().every(id => alive.some(p => p.playerId === id)) && before.flat().length === alive.length
+        && JSON.stringify(before) !== JSON.stringify(pairs)) fail('boss pairing changed after preparation');
+      const groups = pairs.map(g => g.join(','));
       const fields = m.fields.map((f) => f.players.join(','));
-      if (JSON.stringify(groups) !== JSON.stringify(fields)) fail(`boss fields ${fields.join(' | ')} != seat pairs ${groups.join(' | ')}`);
+      if (JSON.stringify(groups) !== JSON.stringify(fields)) fail(`boss fields ${fields.join(' | ')} != saved pairs ${groups.join(' | ')}`);
```

**为什么改**：配套「首领配对改为每局随机，准备期至开战固定，隐藏首领沿用同局分组」（0.2.5 规则第 10 行，**该条 CHANGELOG 未单列 `#编号`，推断为 PR 未标号**）。
审计以前是**自己再按座位算一遍**去对答案；配对变成随机后，重算必然对不上，所以改成**校验「保存下来的那份配对」自身合法**，并额外断言「准备期之后不许再变」。

**老板这边的情况**：该文件老板已改（`yours` 31334 字节 vs 官方 0.2.4 的 31104、0.2.5 的 31755）。
老板的改动**与官方 hunk 无一落在同一行**（`overlap-exact.csv`：`CollideHunks=0`），两处各自紧邻：
- **紧邻**（hunk 2，import 块）：老板在 `finalAssault.js` 那行下面**新增了** `import { firstLeakFree } from './hextech.js';`
- **未动**（hunk 3，`startFinalAssault`）：老板在这里**没有**改动——0.2.4 的 446-466 与老板树逐行相同（我核对过）。
  老板的海克斯「不灭壁垒」首漏免费加在**上面那个 `settle` 检查块**里，不在这一段：
  ```js
  // 海克斯 不灭壁垒 (DESIGN §29): the round's first leak is free, so settle charges one less
  const charged = Math.max(0, counted - (firstLeakFree(ps) ? 1 : 0));
  const max = uniteRan && plan.leakers.includes(ps) ? cap : Math.min(cap, charged);
  ```

**怎么合**：两处都**自由可搬**，但须**一次做完**（见 〇.2 雷 1 附）；`startFinalAssault` 那段与 import 是一件事的两端。
- import 块并成：
  ```js
  import { bossPoolHp, hiddenEligible } from './finalAssault.js';
  import { helperOrder } from './unite.js';
  import { firstLeakFree } from './hextech.js';
  ```
  即：**去掉 `pairPlayers`**（官方删的），**保留 `firstLeakFree`**（老板加的）。去 `pairPlayers` 的前提是 hunk 3 一起搬。
- `startFinalAssault` 检查块：把官方那 9 行整段搬进来。老板的首漏逻辑在**隔壁** `settle` 检查块里，两边是不同 `wrap`，互不干扰。
  搬完后 `pairPlayers` 在本文件已无引用，和 import 的删除自洽。

**搬运动作**：手工编辑 `Stronghold-Protocol-repo\server\match\audit.js`（本文件不可整覆盖，因为老板的海克斯 settle 逻辑会被冲掉）。

---

### 2. `server/match/bot.js`　【DIVERGED】　官方 2 hunk，+21/−8

**官方改了什么**

hunk 1（旧 135-156，`CollideHunks=0`）——AI 选开局策略时，给「队友已经选了的阵营」降权：

```diff
+const SOFT_BAND_RESERVE = 0.25;
 export function botPickBand(m, ps) {
   const gd = ps?.gd || m.gd;
   const ids = gd.bandIds();
   if (!ids.length) return gd.defaultBandId;
   const lateFunds = (id) => /暂存/.test(String(gd.band(id)?.desc || ''));
-  const offBond = (id) => gd.bandBondIds(id).some((b) => gd.modeInactiveBonds.has(b));
-  const pairs = ids.map((id) => [id, offBond(id) ? 0 : Math.max(1, (gd.startLp(id) - 18) ** 2) * (m.isSolo && lateFunds(id) ? 0.02 : 1)]);
+  const reserved = new Set(ps && typeof m.alivePlayers === 'function'
+    ? m.alivePlayers().filter((p) => p !== ps).flatMap((p) => gd.bandBondIds(p.bandId))
+    : []);
+  const inactive = (id) => gd.bandBondIds(id).some((b) => gd.modeInactiveBonds.has(b));
+  const pairs = ids.map((id) => {
+    if (inactive(id)) return [id, 0];
+    const w = Math.max(1, (gd.startLp(id) - 18) ** 2) * (m.isSolo && lateFunds(id) ? 0.02 : 1);
+    return [id, gd.bandBondIds(id).some((b) => reserved.has(b)) ? w * SOFT_BAND_RESERVE : w];
+  });
```

hunk 2（旧 345-369，`CollideHunks=0`）——构筑重心也避开队友阵营，并把队友阵营写进缓存 key：

```diff
 export function bondPlan(m, ps, owned = ownedBonds(m, ps)) {
-  const key = `${m.round}|${ps.shop.level}|${[...owned.counts.entries()].map(([k, v]) => k + v).join()}`;
+  const livingBands = m.alivePlayers().filter((p) => p !== ps).flatMap((p) => m.gd.bandBondIds(p.bandId)).sort().join();
+  const key = `${m.round}|${ps.shop.level}|${[...owned.counts.entries()].map(([k, v]) => k + v).join()}|${livingBands}`;
   if (ps._botFocus && ps._botFocus.key === key) return ps._botFocus;
   const prev = ps._botFocusId ?? null;
   const mates = new Set();
   for (const p of m.alivePlayers()) {
     if (p === ps) continue;
     const b = mainCoreBond(m, p);
     if (b) mates.add(b);
+    for (const id of m.gd.bandBondIds(p.bandId)) mates.add(id);
   }
```

**为什么改**：挂 **#514 / PR #518**（CHANGELOG 第 37 行「人机」段）：AI 会**软性**让开队友已选阵营，队友淘汰后取消，不锁库存、不阻止立刻合成。
关键在「软」：权重不是 0，而是 ×0.25（`SOFT_BAND_RESERVE`），所以仍可能抽到——这正是 `[ASSUMED]` 注释说明的。

**老板这边的情况**：该文件老板已改（`yours` 101325 vs 0.2.4 的 100270）。
但老板的改动是**另外的 3 个地方**：import 加了 `import { applyEnemyHexes, enemyHexModes } from './hextech.js'`、
`createRehearsalSteps` 里排兵用 `applyEnemyHexes(...)` 包了一层、以及新增 `botSpendOnly()`（海克斯「恶魔形态」托管花钱）。

**怎么合**：与官方这两块**不重叠**（`overlap-exact.csv`：`CollideHunks=0`）→ **官方两块可整段照搬**。
照搬后注意 `botSpendOnly` 引用的 `ps.stats.buys` / `ps.stats.refreshes` 不受影响，`enemyHexModes` 也与本次改动无关。

**搬运动作**：手工把官方两段贴进 `Stronghold-Protocol-repo\server\match\bot.js`（保留老板的 hextech import 与 `botSpendOnly`）。

---

### 3. `server/match/effectsMeta.js`　【DIVERGED】　官方 2 hunk，+2/−0

**官方改了什么**

hunk 1（旧 477-488，`CollideHunks=0`）与 hunk 2（旧 566-577，`CollideHunks=0`）都是**同一件事的读/用两端**：

```diff
     bandId: () => ps.bandId,
+    teamMedicGranted: () => m.teamMedicGranted(),
     shopLevel: () => ps.shop.level,
```

```diff
       const p = ps.acquireItem(itemId, {
         source: opts.source || source.key || 'effect',
         toTemp: !!opts.toTemp,
         deferMerge: ps._deferItemMerge > 0,
+        requirePool: opts.requirePool !== false,
       });
```

**为什么改**：
- 第一处给效果脚本一个只读口子 `ctx.teamMedicGranted()`，配合第 12 行「Touch 外勤医疗按本局团队权益保留」。
- 第二处把 `requirePool` 透传下去，配合第 13 行固定赠品（#488/#491/#495）——这个口子是 #12 的 `acquireItem` 用的。

**老板这边的情况**：该文件老板已改（`yours` 41117 vs 0.2.5 的 38502，是 C 区里相对官方涨得最多的之一），
改动集中在 ctx：新增 `hexOwned` / `event`、`spendLp` / `zeroFunds` / `levelUpFree` / `demonTakeover`、
`rollGoldenItem`，以及 `HOOKS` 加 `onHexPick`、`KEY_RE` 加 `hex:`、`MetaRegistry.hex()`。
`overlap-exact.csv`：`CollideHunks=0`。

**怎么合**：不重叠 → 官方两行直接加。
- `teamMedicGranted: () => m.teamMedicGranted(),` 加在 `bandId` 之后（其定义在 #9 `infra.js`）。
- `requirePool: opts.requirePool !== false,` 加在 `grantItem` 的 `acquireItem` 参数里（其消费在 #12 `acquire.js`）。
两处都必须跟着 #9 / #12 一起落，否则一个是空指针、一个是死参数。

**搬运动作**：手工在 `Stronghold-Protocol-repo\server\match\effectsMeta.js` 的 ctx 里加这两行。

---

### 4. `server/match/finalAssault.js`　【CLEAN-APPLY】　官方 2 hunk，+16/−4

**官方改了什么**

hunk 1（旧 1-12，`CollideHunks=0`）——头部注释：

```diff
-//   * Pairing: alive players by seat → (1,2), (3,4); an odd player is alone on its own field with the `_s` template
+//   * Pairing: shuffled once per match before Final Assault prep; Hidden Core keeps those pairs. If players leave,
+//     intact pairs stay together and the remaining single players pair up. An odd player uses the `_s` template
```

hunk 2（旧 52-68，`CollideHunks=0`）——`pairPlayers` 换实现：

```diff
-/** Pair alive players by seat: [[a, b], [c, d]] / [[a, b], [c]] / [[a]]. */
-export function pairPlayers(alive) {
+/** Seeded initial pairing; `previous` carries player-id pairs through prep, combat and Hidden Core. */
+export function pairPlayers(alive, rng, previous = null) {
   const sorted = alive.slice().sort((a, b) => a.seat - b.seat);
   const groups = [];
-  for (let i = 0; i < sorted.length; i += 2) groups.push(sorted.slice(i, i + 2));
+  let singles;
+  if (Array.isArray(previous)) {
+    const remaining = new Map(sorted.map(p => [p.playerId, p]));
+    singles = [];
+    for (const ids of previous) {
+      const group = [];
+      for (const id of ids) if (remaining.has(id)) { group.push(remaining.get(id)); remaining.delete(id); }
+      if (group.length === 2) groups.push(group); else singles.push(...group);
+    }
+    singles.push(...remaining.values());
+  } else singles = sorted.length > 1 ? rng.shuffle(sorted) : sorted;
+  for (let i = 0; i < singles.length; i += 2) groups.push(singles.slice(i, i + 2));
   return groups;
 }
```

**为什么改**：第 10 行「首领配对改为每局随机，准备期至开战固定，隐藏首领沿用同局分组」。
`rng.shuffle` 做首轮随机；`previous` 让**准备期到开战再到隐藏首领都用同一份**；有人中途离场时**完整的对子保留**，落单的再两两配。

**老板这边的情况**：`overlap-exact.csv` 判 `你未动`（旧 `overlap.csv` 的 `UNTOUCHED-BY-YOU`），且我用 SHA256 验过：
`Stronghold-Protocol-repo\server\match\finalAssault.js` 与 `base-024` 的官方 0.2.4 **逐字节一致**。
（`yours` 8877 = 0.2.4 的 8877，0.2.5 是 9530。）

**怎么合**：文件本身零冲突，**可以直接整份覆盖**。
但 ⚠️ **覆盖完这一份，`server` 立刻是坏的**：0.2.5 的 `pairPlayers` 在 `previous == null` 时走 `rng.shuffle(sorted)`，
而老板树的调用方 #8 `match/bossRounds.js` 和 #10 `match/phases.js` **只传 `alive`**，`rng` 是 `undefined` → `TypeError`。
所以本文件必须和 #7 / #8 / #10 / #1 **同一批**落地。

**搬运动作**：`copy 参考对象\Stronghold-Protocol-v0.2.5-update\Stronghold-Protocol\server\match\finalAssault.js → Stronghold-Protocol-repo\server\match\finalAssault.js`（**必须与 #7/#8/#10/#1 同批**）

---

### 5. `server/match/gamedata.js`　【DIVERGED】　官方 2 hunk，+7/−0

**官方改了什么**

hunk 1（旧 97-108，`CollideHunks=0`）——构造时收集「固定赠品」物品集合：

```diff
     this._items = this.raw.items && typeof this.raw.items === 'object' ? this.raw.items : {};
+    // Fixed operator gifts are unlimited outputs, but every produced normal/advanced item still occupies 1/2 copies
+    // (card-pool experiment BV1eLXXBqEgF, maintainer-confirmed 2026-10-11). Random subset gifts are not exempt.
+    this._fixedGiftItems = new Set(Object.values(this.raw.garrisons || {})
+      .filter(g => g.effectKey === 'SERVER_GAIN_EQUIP').map(g => g.bbStr?.chess).filter(id => this._items[id]));
     this._bonds = this.raw.bonds && typeof this.raw.bonds === 'object' ? this.raw.bonds : {};
```

hunk 2（旧 309-320，`CollideHunks=0`）——对外查询：

```diff
+  /** Whether a fixed trait gift may be produced beyond stock (including the advanced version of that item). */
+  isUnlimitedGiftItem(id) { return this._fixedGiftItems.has(this.baseIdOf(id)); }
+
   /** Copies needed to merge (0 = never merges: golden chess). */
```

**为什么改**：第 13 行前半段，挂 **#488 / #491 / #495**（思路来自 PR #496）。
「固定赠品不再被共享库存阻断……仍计入库存，达到上限也会继续发放」——注意**只是不再阻断发放**，
道具**照样占 1 / 2 份库存**（`isUnlimitedGiftItem` 只被「能不能发」和「不变量放不放行」两处用）。
hunk 2 用 `baseIdOf` 是为了让**进阶版**也命中同一份清单。

**老板这边的情况**：该文件老板已改（`yours` 33160 vs 0.2.5 的 30387），
改的是 `GameData` 里**另一大块**：新增整套 `hextech` 访问器（`hexFormat` / `hexRounds` / `hexOfferCount` /
`hexRerolls` / `hexTimer` / `hexRarities` / `hexWeights` / `hexTier` / `hexPlayerPool` / `hexEnemyPool` / `hex`）。
`.vs-025.diff` 还显示老板**没有** `_fixedGiftItems` / `isUnlimitedGiftItem`（0.2.1 之后才进上游）。

**怎么合**：不重叠（`OverlapLines=0`，`DISJOINT`）→ 官方 2 处整段加。
`_fixedGiftItems` 加在 `this._items = ...` 之后；`isUnlimitedGiftItem` 加在 `mergeCount` 之前。
两者都别碰老板的 hextech 块。

**搬运动作**：手工在 `Stronghold-Protocol-repo\server\match\gamedata.js` 加这两段。

---

### 6. `server/match/invariants.js`　【DIVERGED】　官方 1 hunk，+3/−2

**官方改了什么**

hunk 1（旧 199-218，`CollideHunks=0`）——道具库存校验放过固定赠品：

```diff
-  // Shared shop equipment. The chess pool above may go negative (Mimic). Item stock may not: held ≤ cap.
+  // Fixed operator gifts may overdraw equipment stock; ownership still counts and keeps shop availability at zero.
+  // Other item families retain their cap. The chess pool above also permits explicit overdraw (Mimic).
   if (m.itemPool && gd.raw.items) {
     for (const [id, rec] of Object.entries(gd.raw.items)) {
       if (!rec || rec.isGolden) continue;
       const cap = m.itemPool.cap(id);
       if (!Number.isInteger(cap)) continue;
       const h = m.itemPool.held(id);
-      if (h > cap) fail(`item ${id}: held ${h} > cap ${cap}`);
+      if (h > cap && !gd.isUnlimitedGiftItem(id)) fail(`item ${id}: held ${h} > cap ${cap}`);
     }
   }
```

**为什么改**：这是第 13 行「固定赠品……达到上限也会继续发放」的**配套放行**。
赠品会**故意把库存撑到 cap 之上**（超出部分算欠账），不变量要是还照旧判 `held > cap` 就会把合法局面报成违规。
注意**只放过固定赠品**，其他道具族照旧卡 cap（0.2.5 注释明说「Other item families retain their cap」，例如商业包装）。

**老板这边的情况**：该文件老板已改（`yours` 15036，反而**比 0.2.5 的 15301 还小**）。
老板动了两处：头部注释把 pool 一行从「0 ≤ left ≤ cap」改写成「raw balance ≤ cap」的口径；
真正的代码改动是**装备上限改成可被玩家覆写**——`p.items.length > (typeof ps.equipCap === 'function' ? ps.equipCap() : gd.equipPerChess)`。
`DISJOINT`。

**怎么合**：官方改的是 item 校验段（旧 199-218），老板改的是上面的装备段和头部注释 → **不重叠**，官方那 3 行可整段照抄。
但**必须和 #5 `gamedata.js` 同批**，否则 `gd.isUnlimitedGiftItem` 不存在 → 每次收集不变量都抛 `TypeError`。

**搬运动作**：手工在 `Stronghold-Protocol-repo\server\match\invariants.js` 的 item 校验处加 `&& !gd.isUnlimitedGiftItem(id)`，并把注释换成官方那两行。

---

### 7. `server/match/Match.js`　【DIVERGED】　官方 1 hunk，+1/−0

**官方改了什么**

hunk 1（旧 370-381，`CollideHunks=0`）：

```diff
     this.wave = null;
     this.bossWaves = null;
+    this.bossPairs = null; // drawn once per match; the hidden round retains partners and sides
     this.fields = [];
```

**为什么改**：第 10 行随机配对的**状态字段**。配对要在准备期就算出来并固定（`_planBossWaves`），
所以要有个地方存 `playerId` 分组；隐藏首领（R15）沿用同一份。

**老板这边的情况**：该文件老板已改（`yours` 31829 vs 0.2.5 的 29740），改动很多且**就在紧邻位置**：
新增 `opts.test` 测试场开关、`this.test`、`this.rngHex`、
`this.hex` / `this.enemyHexes` / `this.pendingMirror` / `this.hexDrawRound`，
以及模块表加入 `MatchHexDraft` / `MatchTestField`。
**关键**：老板树**没有** `this.bossPairs`（`grep` 全 `server/` 无此标识符），
而且 `.vs-025.diff` 显示老板是在 `this.bossWaves = null;` 之后**直接**接 `this.fields = []`。
`overlap-exact.csv`：`CollideHunks=0`（`this.bossWaves = null;` 只是 `unified=6` 下的共同上下文，不是重叠行）。

**怎么合**：**自由可搬**，实际是个「插一行」的小活。官方要的落点是 `this.bossWaves = null;` 的下一行，
老板的 hextech 字段（`this.hex` 等）都在 `this.wave = null;` **之前**，不争这几行。
→ 在 `this.bossWaves = null;` 与 `this.fields = [];` 之间插入：
```js
this.bossPairs = null; // drawn once per match; the hidden round retains partners and sides
```
**别照抄整个 hunk 上下文**，那会把老板的 hextech 字段挤掉。

**搬运动作**：手工在 `Stronghold-Protocol-repo\server\match\Match.js` 插入这 1 行（与 #4/#8/#10/#1 同批）。

---

### 8. `server/match/match/bossRounds.js`　【DIVERGED】　官方 2 hunk，+3/−2

**官方改了什么**

hunk 1（旧 3-15，`CollideHunks=0`）——import：

```diff
-import { deriveSeed } from '../../sim/rng.js';
+import { createRng, deriveSeed } from '../../sim/rng.js';
```

hunk 2（旧 63-75，`CollideHunks=0`）——开局配对改成带种子、并记住：

```diff
     this.bossPool = pool;
-    const groups = pairPlayers(alive);
+    const groups = pairPlayers(alive, createRng(deriveSeed(this.seed, 'boss-pairs')), this.bossPairs);
+    this.bossPairs = groups.map(g => g.map(p => p.playerId));
     const reuse = this.bossWaves && ...;
```

**为什么改**：第 10 行。用**独立的种子流** `deriveSeed(this.seed, 'boss-pairs')`——注释和 #10 都强调
「consuming no shop, wave, draft or battle randomness」，即随机配对**不能扰动**商店、波次、抓取和战斗的随机序列，
否则同一个种子会整体走样。`this.bossPairs` 存下来给 R15 隐藏首领和审计用。

**老板这边的情况**：该文件老板已改（`yours` 29559 vs 0.2.5 的 28965），
改动**恰好压在这两块上/紧邻**：
- import 块：老板在 `rng.js` 那行之后新增 `import { applyEnemyHexes, enemyHexModes, bountyMultiplier } from '../hextech.js';`
- 配对段：老板是 `const groups = pairPlayers(alive);`，紧接着在 `wave.spawns` 上包了
  `const hexMods = enemyHexModes(this); const spawns = applyEnemyHexes(...)`，`flags` 里加了 `enemyMods: hexMods`；
  另外 `_settleBossBounties` 改成 `bounty * bountyMultiplier(ps)`。
两处 `CollideHunks=0`（`overlap-exact.csv`；旧 `merge-worksheet.csv` 记为 YES 是 `unified=6` 的误报）。
`.vs-025.diff` 显示老板树**没有** `bossPairs`，配对仍是旧的按座位版。

**怎么合**：**两处都自由可搬**，但都要在老板的 hextech 改动旁边落位。
- import 行改成 `import { createRng, deriveSeed } from '../../sim/rng.js';`，**保留**下面的 hextech import。
- 配对段：把 `pairPlayers(alive)` 换成官方那两行，**保留**紧随其后的 `hexMods` / `applyEnemyHexes` 包装。
  合并后大致：
  ```js
  this.bossPool = pool;
  const groups = pairPlayers(alive, createRng(deriveSeed(this.seed, 'boss-pairs')), this.bossPairs);
  this.bossPairs = groups.map(g => g.map(p => p.playerId));
  const reuse = this.bossWaves && ...;
  this.fields = groups.map((g, i) => {
    const solo = this.isSolo || g.length === 1;
    const wave = reuse ? ... : buildBossWave(...);
    const hexMods = enemyHexModes(this);
    const spawns = applyEnemyHexes(wave.spawns.map(...), hexMods);
    ...
  ```
**顺序有讲究**：`this.bossPairs` 必须先于任何读它的地方赋值；老板的 `hexMods` 与配对无耦合，位置不动即可。

**搬运动作**：手工编辑 `Stronghold-Protocol-repo\server\match\match\bossRounds.js`（与 #4/#10/#1 同批，否则 rng 参数失配）。

---

### 9. `server/match/match/infra.js`　【CLEAN-APPLY】　官方 1 hunk，+4/−1

**官方改了什么**

hunk 1（旧 85-98，`CollideHunks=0`）：

```diff
   humans() { return this.order.filter((p) => !p.isBot && !p.left); }
 
+  /** [ASSUMED] Touch's initial, match-long team grant survives its holder's elimination/quit; focus alone grants none. */
+  teamMedicGranted() { return this.order.some(p => p.bandId === 'band_amedic'); }
+
   /**
-   * The boss-round group of a player (`bossWaves`: the seat pairs of finalAssault.js pairPlayers, planned in startRound
+   * The boss-round group of a player (`bossWaves`: the per-match random pairs, planned in startRound
```

**为什么改**：第 12 行「Touch 外勤医疗按本局团队权益保留，持有者淘汰或退出后不再使下一场医疗消失
（维护者已确认保留，原作寿命规则仍待实测确证）」。
要害是**判定口径**：以前查「**现在还有没有一个活着的** `band_amedic` 玩家」（`p.alive && ...`），
人一淘汰／退出，下一场医疗就没了；官方改成查**本局是否发放过**（`order` 里有没有这个策略），与死活解耦。
功能上只有这一处真代码。

**老板这边的情况**：`UNTOUCHED-BY-YOU`，SHA256 验过与官方 0.2.4 **逐字节一致**（`yours` 6226 = 0.2.4 的 6226）。
`.vs-025.diff` 反向印证：老板树里**没有** `teamMedicGranted()`，`bossGroupOf` 注释还写着「seat pairs」。

**怎么合**：直接整份覆盖，零冲突。但覆盖后 #11 `views.js` 和 #3 `effectsMeta.js` **要跟着改成调用
`this.teamMedicGranted()`**——否则医疗位仍按旧口径判断（功能没坏，是「改了没用上」）。

**搬运动作**：`copy 参考对象\Stronghold-Protocol-v0.2.5-update\Stronghold-Protocol\server\match\match\infra.js → Stronghold-Protocol-repo\server\match\match\infra.js`

---

### 10. `server/match/match/phases.js`　【DIVERGED】　官方 2 hunk，+6/−2

**官方改了什么**

hunk 1（旧 4-15，`CollideHunks=0`）——import 加 `createRng`：

```diff
 import { pairPlayers } from '../finalAssault.js';
+import { createRng, deriveSeed } from '../../sim/rng.js';
 import { botPickBand } from '../bot.js';
```

hunk 2（旧 285-301，`CollideHunks=0`）——准备期就把配对定死：

```diff
-  /** The boss round's fields (seat pairs of the alive players) and their templates, generated for the prep preview. */
+  /** Stable per-match pairs and their templates, generated before the prep preview / board validation. */
   _planBossWaves() {
     const r = this.round;
     const bossId = r === this.gd.hiddenRound && r !== this.gd.bossRound ? this.hiddenBossId : this.bossId;
-    this.bossWaves = pairPlayers(this.alivePlayers()).map((g) => ({
+    // Pairing uses an independent seeded draw, consuming no shop, wave, draft or battle randomness.
+    const groups = pairPlayers(this.alivePlayers(), createRng(deriveSeed(this.seed, 'boss-pairs')), this.bossPairs);
+    this.bossPairs = groups.map(g => g.map(p => p.playerId));
+    this.bossWaves = groups.map((g) => ({
       players: g.map((p) => p.playerId),
       wave: buildBossWave(this.gd, this.rngWaves, this.factions, r, { bossId, solo: this.isSolo || g.length === 1 }),
     }));
   }
```

**为什么改**：第 10 行「**准备期**至开战固定」。
`_planBossWaves` 在 `startRound` 里、玩家 `roundStart` **之前**跑（注释说明 `recompute()` 要靠它判断该拿哪张场地做棋盘校验），
所以配对必须在这里就抽定并写进 `this.bossPairs`，之后开战（#8）与 R15 都读这一份，不再重抽。
同样用 `'boss-pairs'` 独立种子流，保证不扰动别的随机。

**老板这边的情况**：该文件老板已改（`yours` 15802 vs 0.2.5 的 14474）。
改动**正好卡在两块 hunk 上**：
- import 块：老板没加 `rng.js`，而是在此位置加了 `import { resolveMirrorCopies } from '../hextech.js';`
- `startRound`：老板加了 `this.hex = null;`，并在 `for (const ps of alive) ps.recompute();` 之后
  加了 `try { resolveMirrorCopies(this); } catch (e) { ... }`（海克斯镜像协议）
- `afterRoundStart`：老板改成先走海克斯草稿 `enterHexDraft()`，并加了 `isTestField()` 分支
`overlap-exact.csv`：`CollideHunks=0`。`.vs-025.diff` 显示老板树 `pairPlayers` 仍是单参调用。

**怎么合**：
- hunk 1 **重叠**：加 `import { createRng, deriveSeed } from '../../sim/rng.js';`，**同时保留**老板的 `resolveMirrorCopies` import。
- hunk 2 **不重叠**：官方那段整段替换 `_planBossWaves` 开头即可，老板的 `this.hex = null;`、
  `resolveMirrorCopies(...)`、`afterRoundStart` 的海克斯分支都不在这几行里，别动。

**搬运动作**：手工编辑 `Stronghold-Protocol-repo\server\match\match\phases.js`（与 #4/#8/#1 同批）。

---

### 11. `server/match/match/views.js`　【DIVERGED】　官方 2 hunk，+2/−1

**官方改了什么**

hunk 1（旧 83-94，`CollideHunks=0`）——对外公布配对，给客户端棋盘／队友框用：

```diff
       bossRound: this.gd.bossRound,
       hiddenRound: this.gd.hiddenRound,
+      bossPairs: this.bossWaves ? this.bossWaves.map(w => w.players.slice()) : this.bossPairs ? this.bossPairs.map(ids => ids.slice()) : null,
       spRound: this.gd.spRounds().includes(this.round),
```

hunk 2（旧 245-257，`CollideHunks=0`）——预备位医疗改用团队权益口径：

```diff
   prepMapChars(ps) {
-    if (!ps?.alive || this.phase !== PHASE.PREP || !this.order.some((p) => p.alive && p.bandId === 'band_amedic')) return [];
+    if (!ps?.alive || this.phase !== PHASE.PREP || !this.teamMedicGranted()) return [];
```

**为什么改**：
- hunk 1 是第 10 行「**客户端棋盘和队友框同步实际配对**」的出口：把配对照实发出去，客户端才能画出真实分组。
  三目写法保证准备期（有 `bossWaves`）与其它时刻（只有 `bossPairs`）都能给。
- hunk 2 是第 12 行在**视图侧**的落点，和 #9 的 `teamMedicGranted()` 配套。

**老板这边的情况**：该文件老板已改（`yours` 27356 vs 0.2.5 的 24505，0.2.5 只加了 105 字节，老板多了近 3KB）。
改动压在 hunk 1 同一段 public 对象上：老板加了
`...(this.isTestField() ? { test: true } : {})`（测试场标记）、玩家项加 `hexes` / `freeLeak`，
另外加了整套 `v.enemyHexes` / `v.hex`、`_pendingLpView` 的首漏扣减、`nextEnemiesFor` 的 `applyEnemyHexes` 折叠、
以及 hunk 2 那行的**旧写法**（`.vs-025.diff` 显示老板仍是 `this.order.some((p) => p.alive && ...)`）。
`overlap-exact.csv`：`CollideHunks=0`。

**怎么合**：
- hunk 1 **重叠**：在 `hiddenRound` 之后插入官方那行 `bossPairs: ...`，**保留**老板的 `...(this.isTestField() ...)` 展开。
  顺序上 `bossPairs` 放在 `spRound` 前、test 展开之后都行，但别让两个键互相覆盖（键名不同，安全）。
- hunk 2 **不重叠**：把 `prepMapChars` 那行整句换成 `!this.teamMedicGranted()` 版本即可。
  前提是 #9 `infra.js` 已覆盖（否则 `teamMedicGranted` 未定义）。

**搬运动作**：手工编辑 `Stronghold-Protocol-repo\server\match\match\views.js`。

---

### 12. `server/match/player/acquire.js`　【DIVERGED】　官方 2 hunk，+11/−5

**官方改了什么**

hunk 1（旧 212-237，`CollideHunks=0`）——晋升奖励改用 `diyStockEntries`：

```diff
-   * The player's slotted 自选 pieces join the draw like in its shop (player/diy.js diyRollEntries: once the 调度中心 is at
-   * the slot's level) — the reward is a temporary refresh of the shop ("临时刷新3名…干员") [ASSUMED].
+   * The player's slotted 自选 pieces of the reward tier join the draw (player/diy.js diyStockEntries: copies left, then
+   * the roll's tier — not the ordinary shop's shopLevel gate). 卫戍协议/帮助 干员晋升 names one temporary refresh one tier
+   * above the 调度中心 and no separate pool; the owner decided on 2026-10-12 that the refresh includes 自选 of the newly
+   * reached tier. 0.2.0 had [ASSUMED] the shop-level gate on this refresh too (DESIGN §25); §30.23 reverses that.
+   * An offer built from explicit `ids` does not roll.
    */
   pushRewardOffer(source = 'merge', { tier = null, ids = null, label = null } = {}) {
     ...
-        for (let tt = t; tt >= 1 && !id; tt--) id = this.m.pool.roll(this.m.rngShop, { tier: tt, filter: fresh, extra: this.diyRollEntries() });
+        for (let tt = t; tt >= 1 && !id; tt--) id = this.m.pool.roll(this.m.rngShop, { tier: tt, filter: fresh, extra: this.diyStockEntries() });
```

hunk 2（旧 282-297，`CollideHunks=0`）——`acquireItem` 增加 `requirePool`：

```diff
-  acquireItem(itemId, { source = 'grant', toTemp = false, silent = false, deferMerge = false } = {}) {
+  acquireItem(itemId, { source = 'grant', toTemp = false, silent = false, deferMerge = false, requirePool = true } = {}) {
     const rec = this.gd.item(itemId);
     if (!rec) return null;
-    if (!this.m.itemPool.canGain(itemId)) {
+    // Only the fixed operator-gift families can overdraw. Several unrelated strategy grants also pass
+    // requirePool:false; they must retain their stock limit (for example commercial packaging).
+    const unlimitedGift = !requirePool && this.gd.isUnlimitedGiftItem(itemId);
+    if (!unlimitedGift && !this.m.itemPool.canGain(itemId)) {
       this.m.toast(this, 'warn', '装备库存不足，未获得该装备');
       return null;
     }
```

**为什么改**：
- hunk 1 是第 20 行「调度中心 4 级的五阶晋升奖励可以出现五阶自选，5 级的六阶晋升奖励可以出现六阶自选」（**#515**，同样修复见 **PR #544**）。
  0.2.5 之前晋升刷新也套了普通商店的 `shopLevel` 闸门（`diyRollEntries`），现在改成**只看奖励档位**（`diyStockEntries`），
  于是五阶自选在调度中心 4 级就能出现——**比普通商店早一级**。CHANGELOG 也明说「普通商店仍在 5 / 6 级才刷出」。
- hunk 2 是第 13 行 #488/#491/#495 的消费端：**只有**「固定赠品族」且显式传 `requirePool:false` 时才能透支库存，
  注释特意警告**别的策略赠品也传 false，必须保留各自上限**（举例商业包装）。这个「双重条件」是安全阀，别简化成一元判断。

**老板这边的情况**：该文件老板已改（`yours` 21042 vs 0.2.5 的 21628——老板**比 0.2.5 还小**）。
改动：`upgradeItem` 前多了一行重复注释 `/** Normal item → golden version in place (整备). */`；
两处 `this.gd.equipPerChess` 换成 `this.equipCap()`；另有海克斯相关的注入。
`.vs-025.diff` 显示老板**没有** `requirePool`，`pushRewardOffer` 仍用 `diyRollEntries()`（旧口径）。
`DISJOINT`。

**怎么合**：不重叠 → 官方 2 处整段照搬。
- hunk 1：`extra: this.diyRollEntries()` → `extra: this.diyStockEntries()`，并换上官方注释。
- hunk 2：加上 `requirePool = true` 形参、`unlimitedGift` 两行判断、注释三行。
**前提**：#5 `gamedata.js` 的 `isUnlimitedGiftItem` 必须先落，否则 `gd.isUnlimitedGiftItem` 未定义就抛错。
另外顺手把老板那行**重复的 `upgradeItem` 注释**删掉（纯噪音，不属于本次合并，但既然动了这文件可以清理——若要严格「只合本次改动」也可以留着）。

**搬运动作**：手工编辑 `Stronghold-Protocol-repo\server\match\player\acquire.js`（与 #5、#3 同批）。

---

### 13. `server/match/player/diy.js`　【DIVERGED】　官方 2 hunk，+16/−9

**官方改了什么**

hunk 1（旧 18-34，`CollideHunks=0`）与 hunk 2（旧 203-228，`CollideHunks=0`）**都是注释**，把「自选入池」的两条路径讲清楚：

```diff
-//   * the shop's draws (diyRollEntries): the stock of each slotted slot joins this player's copy-weighted rolls — the
-//     shop's chess slots and the reward offers' temporary refreshes [ASSUMED] — weighted like any chess of its tier, once
-//     the 调度中心 has reached the slot's shopLevel (activity_table shopLevelDisplayDataDict lists the tier-5 slots at
-//     level 5 and the tier-6 slots at level 6; PRTS 帮助 "仅在调度中心等级 ≥ 干员所在等阶"). The price is the slot's (any
-//     chess of its tier: 4).
+//   * the shop's draws (diyRollEntries): the stock of each slotted slot joins this player's copy-weighted shop rolls,
+//     weighted like any chess of its tier, once the 调度中心 has reached the slot's shopLevel (activity_table
+//     shopLevelDisplayDataDict lists the tier-5 slots at level 5 and the tier-6 slots at level 6; PRTS 帮助 "仅在调度中心
+//     等级 ≥ 干员所在等阶" is that persistent shop). The price is the slot's (any chess of its tier: 4).
+//   * the promotion reward (pushRewardOffer with no explicit ids) draws diyStockEntries() under the reward tier
+//     min(shopLevel + 1, 6): a tier-5 自选 piece can appear when the 调度中心 reaches 4, a tier-6 piece when it reaches
+//     5, one shop level before the ordinary shop. 卫戍协议/帮助 干员晋升 names that refresh and no second pool; the owner
+//     decided on 2026-10-12 that it includes 自选 of the newly reached tier. 0.2.0 had [ASSUMED] the shop-level gate
+//     for this refresh too (DESIGN §25); §30.23 reverses it. A piece is not guaranteed. Banned slots and `left <= 0`
+//     stay out. Explicit-id offers do not use this draw.
```

```diff
-   * The stock entries this player's shop draws from now ([baseId, entry] with copies left and the 调度中心 at the slot's
-   * shopLevel), or null (none — the shared pool's roll alone, exactly as without picks).
+   * The stock entries this player's ordinary shop draws from now ([baseId, entry] with copies left and the 调度中心 at
+   * the slot's shopLevel), or null (none — the shared pool's roll alone, exactly as without picks). The promotion
+   * reward does not use this gate (`diyStockEntries`).
```

```diff
-   * The stock entries a random grant of this player draws besides the shared pool (see the header): every slotted piece
-   * with copies left, whatever the 调度中心 level (the roll's own tier rules apply), or null (none).
+   * The stock entries a random grant, and the promotion reward's temporary refresh, draw besides the shared pool
+   * (see the header): every slotted piece with copies left, whatever the 调度中心 level (the roll's own tier rules
+   * apply), or null (none).
```

**为什么改**：第 20 行 **#515 / PR #544** 的**文档面**。`diyStockEntries` 这个函数 0.2.4 就有，
0.2.5 没改它的实现，只是**把它也接到晋升奖励上**（实现在 #12 `acquire.js`），于是注释里要补上这条用途，
并把 `diyRollEntries` 的职责收敛成「只管普通商店」。

**老板这边的情况**：该文件老板已改（`yours` 16644 vs 0.2.5 的 14592）。
`.vs-025.diff` 显示老板**保留了旧注释**（还写着奖励不用这个闸门），即 0.2.5 新增的那几句在老板树里没有；
此外老板在文件尾部**新增了两个方法**：`hasDiySlot(id)` 和 `setDiyPick(id, e)`（休整期自由更换自选干员的技能／模组），
import 行也从 `checkDiyPicks` 换成 `checkDiyPick, diyRecord, ...`。`DISJOINT`。

**怎么合**：官方两处都是注释，**不重叠**，可直接照抄注释文本。
老板尾部新增的 `hasDiySlot` / `setDiyPick` 完全不受影响，别动。
注意：**只改注释不会带来 #515 的行为**，行为在 #12；这两个文件要一起看。

**搬运动作**：手工把官方两段注释贴进 `Stronghold-Protocol-repo\server\match\player\diy.js`。

---

### 14. `server/match/player/economy.js`　【DIVERGED】　官方 3 hunk，+8/−5

**官方改了什么**

hunk 1（旧 1-13，`CollideHunks=0`）——import 加 `PHASE`：

```diff
-import { ERR, layerGainRoom } from '../../../shared/constants.js';
+import { ERR, PHASE, layerGainRoom } from '../../../shared/constants.js';
```

hunk 2（旧 44-55，`CollideHunks=0`）——叠层提示音只在「活着的」阶段播：

```diff
     this.layers[bondId] = before + add;
     this.recompute();
+    // A live prep gain, not a view delta: reconnects and combat-result backfill must not replay the cue.
+    if ([PHASE.ROUND_START, PHASE.SP_DRAFT, PHASE.PREP].includes(this.m.phase)) {
+      this.m.sendTo(this.playerId, { t: 'm.layer', playerId: this.playerId, bondId, add });
+    }
     this.m.dispatch(this, 'onLayers', { bondId, from: before, to: before + add, reason });
```

hunk 3（旧 138-153，`CollideHunks=0`）——卖／买**去掉库存闸门**：

```diff
       if (!rec || (rec.isDiy && !rec.diyFor)) return fail(ERR.BAD_TARGET);
-      const base = this.gd.baseIdOf(slot.id);
-      const need = rec.isGolden ? this.gd.goldenCopies : 1;
-      const pool = this.poolOf(base);
-      if (pool.has(base) && pool.left(base) < need) return fail(ERR.SOLD_OUT);
+      // Already displayed operators stay purchasable after stock runs out (#498; 路标月报#2,
+      // BV1eLXXBqEgF 2:50–2:57: nine owned + four shop offers => thirteen owned).
+      // acquireChess records every copy, including the deficit; future rolls still exclude empty stock.
       if (handFull) return fail(ERR.HAND_FULL);
```

**为什么改**：
- hunk 1+2 是第 28 行 **#482**「补齐回合开始、机变、休整期和战斗中的盟约叠层提示音；同类最多播放一路，
  新触发替换旧声音，**重连和结算回填不补播**」。补播禁区就是靠 `PHASE` 白名单实现的——只有
  `ROUND_START / SP_DRAFT / PREP` 才算「活的操作」，别的阶段（重连、结算回填）一声不响。
- hunk 3 是第 14 行 **#498**「已展示的干员商店牌和奖励牌不再因随后库存耗尽而领取失败；道具购买与奖励保留库存检查」。
  干员牌**去掉** `pool.left < need` 的 `SOLD_OUT`；道具那一支**保留** `itemPool.canGain`。
  `acquireChess` 会把欠账记进 `poolCopies`（0.2.4 起就是 `take(..., { overdraw: true })`），未来抽取仍排除空库存。

**老板这边的情况**：该文件老板已改（`yours` 11876 vs 0.2.5 的 11672）。两块都**紧邻**官方 hunk（`CollideHunks=0`）：
- hunk 1：老板的 import 是 `import { ERR, layerGainRoom } from ...`，**紧跟着**加了
  `import { layerGainMulOf } from '../hextech.js';`
- hunk 2：老板在 `addLayers` 里把增益改成 `layerGainRoom(before, Math.floor(n) * layerGainMulOf(this, bondId))`（海克斯「盟约裂变」），
  并且**把官方那段 `PHASE` 提示音删掉了**——`.vs-025.diff` 显示老板树没有 `m.layer` 广播、`PHASE` 也没 import。
- hunk 3：老板**恢复了**旧的 `pool.left < need` 闸门（`.vs-025.diff` 明确显示老板把 #498 那段换回了 0.2.4 的老代码）。
`overlap-exact.csv`：`CollideHunks=0`。**注意方向**：hunk 3 老板是「往回改的」，见 〇.2 雷 2。

**怎么合**：**三处都要手工**，其中 hunk 1、2 是**真冲突**（同一函数、同一件事被两边各改一半）：
- import：并成 `import { ERR, PHASE, layerGainRoom } from '../../../shared/constants.js';`
  **并保留** `import { layerGainMulOf } from '../hextech.js';`。
- `addLayers` 合并后（两边都要）：
  ```js
  const add = layerGainRoom(before, Math.floor(n) * layerGainMulOf(this, bondId));
  if (add <= 0) return 0;
  this.layers[bondId] = before + add;
  this.recompute();
  // A live prep gain, not a view delta: reconnects and combat-result backfill must not replay the cue.
  if ([PHASE.ROUND_START, PHASE.SP_DRAFT, PHASE.PREP].includes(this.m.phase)) {
    this.m.sendTo(this.playerId, { t: 'm.layer', playerId: this.playerId, bondId, add });
  }
  this.m.dispatch(this, 'onLayers', { bondId, from: before, to: before + add, reason });
  ```
  即：**倍率 + 提示音都留**。只留一个就是丢功能（留倍率丢播报 / 留播报丢倍率）。
- hunk 3：把老板恢复的那 4 行 `pool.left < need` 判断**再删掉一次**，换成官方注释。
  ⚠️ 这是**反向操作**，最容易被漏掉——`areas.csv` 把本文件标 DIVERGED，但这一处老板是「**退回了旧行为**」，
  合并方向是把 #498 重新做一遍。删掉后 #15 `prep.js`（CLEAN-APPLY）的奖励牌改动才与之自洽。

**搬运动作**：手工编辑 `Stronghold-Protocol-repo\server\match\player\economy.js`（#15 同批）。

---

### 15. `server/match/player/prep.js`　【CLEAN-APPLY】　官方 1 hunk，+4/−6

**官方改了什么**

hunk 1（旧 30-50，`CollideHunks=0`）：

```diff
       if (!this.m.itemPool.canGain(slot.id)) return fail(ERR.SOLD_OUT);
       if (handFull) return fail(ERR.HAND_FULL);
-    } else {
+    } else if (slot.kind === 'chess') {
       const rec = this.gd.chess(slot.id);
       if (!rec || (rec.isDiy && !rec.diyFor)) return fail(ERR.BAD_TARGET);
-      const base = this.gd.baseIdOf(slot.id);
-      const need = rec.isGolden ? this.gd.goldenCopies : 1;
-      const pool = this.poolOf(base); // the shared pool, or this player's 自选 stock
-      if (pool.has(base) && pool.left(base) < need) return fail(ERR.SOLD_OUT);
+      // Owner decision 2026-10-11 (#498): already displayed operator rewards survive stock exhaustion.
+      // acquireChess records the deficit. Item rewards above still require itemPool.canGain.
       if (handFull) return fail(ERR.HAND_FULL);
-    }
+    } else return fail(ERR.BAD_TARGET);
```

**为什么改**：第 14 行 **#498** 的**奖励牌那一半**（商店牌那一半在 #14 `economy.js`）。
干员奖励**去掉**库存闸门；道具奖励在上面的 `item` 分支里**仍然** `canGain`——
CHANGELOG「道具购买与奖励保留库存检查」正是指这个。
顺带把 `else` 收窄成 `else if (slot.kind === 'chess')`，给未知 kind 一个明确的 `BAD_TARGET`，不再静默当作干员处理。

**老板这边的情况**：`UNTOUCHED-BY-YOU`，SHA256 验过与官方 0.2.4 **逐字节一致**。
（注意 0.2.5 让本文件**变小**：+4/−6，所以 `threeway.csv` 里 `Size025` 4300 < `Size024` 4314。）

**怎么合**：直接整份覆盖，零冲突。覆盖后 #14 `economy.js` 的 hunk 3 要一起做，否则出现
「奖励牌能领、商店牌不能买」的半吊子状态。

**搬运动作**：`copy 参考对象\Stronghold-Protocol-v0.2.5-update\Stronghold-Protocol\server\match\player\prep.js → Stronghold-Protocol-repo\server\match\player\prep.js`

---

### 16. `server/match/PlayerState.js`　【DIVERGED】　官方 2 hunk，+3/−2

**官方改了什么**

hunk 1（旧 23-35，`CollideHunks=0`）与 hunk 2（旧 113-125，`CollideHunks=0`）**都是注释**：

```diff
-//     playtest #6 item 19; a short tier tops up from the tier below; pick 1, expires at prep end; an offer earned
+//     playtest #6 item 19; a short tier tops up from the tier below; the player's stocked 自选 of that tier joins,
+//     §30.23; pick 1, expires at prep end; an offer earned
```

```diff
-//                 DIY draws (diyRollEntries), the pick of a piece (diyPickOf)
+//                 DIY draws (diyRollEntries) and the reward / grant draws (diyStockEntries), the pick of a piece (diyPickOf)
```

**为什么改**：第 20 行 **#515 / PR #544** 的说明面；并在模块清单里把 `diyStockEntries` 的用途补上。
纯注释，无行为。

**老板这边的情况**：该文件老板已改（`yours` 21564 vs 0.2.5 的 20095），
改动是新增：`this.bondOrder`（盟约裂变按数据序取并列）、整套 `this.cumStats = new Map()`
（本局累计伤害统计）、以及 `_addCumStats` 的调用面。`DISJOINT`。

**怎么合**：官方两处注释**不重叠**，照抄注释文本即可；老板的 `bondOrder` / `cumStats` 不动。

**搬运动作**：手工把官方两段注释贴进 `Stronghold-Protocol-repo\server\match\PlayerState.js`。

---

### 17. `server/match/pool.js`　【CLEAN-APPLY】　官方 1 hunk，+5/−3

**官方改了什么**

hunk 1（旧 3-24，`CollideHunks=0`）——**头部注释**，讲清「展示不占库存、但干员牌可以透支」：

```diff
-//     do NOT reserve copies; buying fails (SOLD_OUT) when left = 0.
+//     do NOT reserve copies. An item buy fails (SOLD_OUT) when left = 0; an operator card already shown in the shop or a
+//     reward can still be taken and overdraws (a negative raw left, the debt — GitHub #498, the owner's decision).
```

```diff
-// (`extra`, after its own): one player's 自选 stock (0.2.0, player/diy.js diyRollEntries) — weighted by its copies like
-// any chess, drawn by that player's shop only.
+// (`extra`, after its own): one player's 自选 stock — the ordinary shop passes diyRollEntries (the shopLevel gate);
+// the promotion reward and random grants pass diyStockEntries (the roll's own tier, DESIGN §30.23). Weighted by its
+// copies like any chess, drawn by that player only.
```

**为什么改**：第 14 行 **#498** 与第 20 行 **#515** 的文档面——把「谁能透支库存」和「两条 `extra` 通道」写明白。
**纯注释，零行为**（`pool.js` 的实现没动）。

**老板这边的情况**：`UNTOUCHED-BY-YOU`，SHA256 验过与官方 0.2.4 **逐字节一致**。

**怎么合**：可直接整份覆盖，零冲突（因为它本来就等于 0.2.4，覆盖只是换注释）。
**别以为覆盖它就实现了 #498**——行为在 #14 / #15。

**搬运动作**：`copy 参考对象\Stronghold-Protocol-v0.2.5-update\Stronghold-Protocol\server\match\pool.js → Stronghold-Protocol-repo\server\match\pool.js`

---

### 18. `server/match/unite.js`　【CLEAN-APPLY】　官方 1 hunk，+1/−1

**官方改了什么**

hunk 1（旧 136-148，`CollideHunks=0`）：

```diff
-      carry.set(u.uid, { hpPct: Number.isFinite(u.hpPct) ? Math.max(0.01, Math.min(1, u.hpPct)) : 1, sp });
+      carry.set(u.uid, { hpPct: Number.isFinite(u.hpPct) ? Math.max(0, Math.min(1, u.hpPct)) : 1, sp });
```

**为什么改**：第 11 行「修复联防阿戈尔继承残血后再次结算开场吞噬、误触发复活的问题，**保留准确生命比例**和技力」。
联防把参战单位带进下一场时，血量比被**下限 0.01 抬高了**——残血单位于是不是真的残血。
抬到 0.01 会让「开场吞噬」之类按血量比触发的机制误判（并误触发复活）。改成下限 **0**，血量比照实带过去。

**老板这边的情况**：`UNTOUCHED-BY-YOU`，SHA256 验过与官方 0.2.4 **逐字节一致**。

**怎么合**：直接整份覆盖，零冲突。这一处**必须做**——它是 C 区唯一一处「老板树和官方都停在错误行为」的纯修正，
不涉及任何老板自有改动。

**搬运动作**：`copy 参考对象\Stronghold-Protocol-v0.2.5-update\Stronghold-Protocol\server\match\unite.js → Stronghold-Protocol-repo\server\match\unite.js`

---

## 三、搬运顺序与陷阱

> 本区**没有文本冲突**（32 hunk 全部自由可搬），所以下面讲的**全是「顺序错了就崩」**，
> 不是「冲突了怎么合」。最要紧的两条已在 **〇.2** 展开，这里给可执行的批次表。

### 3.1 必须同批落地的五个批次

`finalAssault.js` 是 C 区唯一的「CLEAN-APPLY 但有跨文件接口变化」的文件。
0.2.5 的 `pairPlayers(alive, rng, previous = null)` 在 `previous == null` 时会调 `rng.shuffle(sorted)`；
而老板树 `server/` 的调用点（`bossRounds.js:70`、`phases.js:301`，加 `audit.js` 的 47 行 import / 461 行调用，加定义处 `finalAssault.js:59`）
都还是 `pairPlayers(alive)` —— `rng` 是 `undefined`。

**单独覆盖 `finalAssault.js` 会让服务端直接 `TypeError`**（配对时 `rng` 为 `undefined`；只有「只剩 1 人」时才恰好不触发，
因为 `sorted.length > 1` 才走 `shuffle`）。这 5 个文件必须**同一批、按此顺序**落地：

| 批次 | 文件（按落地顺序） | 为什么必须同批 |
|---|---|---|
| **配对批**（〇.2 雷 1） | 4 `finalAssault.js` → 7 `Match.js` → 10 `match/phases.js` → 8 `match/bossRounds.js` → 1 `audit.js` | 新签名＋字段＋**`server/` 内 3 处调用**（含 `audit.js` 的 47/461 两行）；少一个就 `TypeError` 或断言失败 |
| **赠品批** | 5 `gamedata.js` → 12 `player/acquire.js` → 3 `effectsMeta.js` → 6 `invariants.js` | 清单定义 → 消费 → ctx 透传 → 不变量放行 |
| **#498 批**（〇.2 雷 2） | 14 `player/economy.js`（hunk 3，**方向是反向：要再删一次**）＋ 15 `player/prep.js` ＋ 17 `pool.js` | 商店牌＋奖励牌＋注释；只做一半会出现「奖励能领、商店不能买」 |
| **Touch 批** | 9 `match/infra.js` → 11 `match/views.js`（hunk 2）＋ 3 `effectsMeta.js` | 定义 → 视图调用 → ctx 读取 |
| **#515 批** | 12 `player/acquire.js`（hunk 1）＋ 13 `player/diy.js` ＋ 16 `PlayerState.js` | 实现＋注释 |

**若只做「配对批」里的 `finalAssault.js`，服务端立刻起不来**——这是 C 区最容易踩的一脚。

### 3.2 三个最容易犯的错

1. **把 `economy.js` 的 #498 当成「已经修好了」。** 老板树现在是**旧行为**（`pool.left < need` 那一套），
   合并不是「折中」，而是**按官方再删一遍**。`areas.csv` 只标 DIVERGED，看不出来方向（详见 〇.2 雷 2）。
2. **照抄 `Match.js` / `audit.js` / `bossRounds.js` / `phases.js` 的整个 hunk 上下文。**
   这几处官方 hunk 的上下文里紧挨着老板的 `hextech` / `test` 新增行（`views.js` 同理由）——它们**不是真重叠**，但整块照抄仍会误伤。
   官方 diff 的上下文是**官方文件的行**，直接整块贴过来会把老板的功能挤掉。**只贴官方新增/删除的那几行。**
3. **以为覆盖 `pool.js` / `diy.js` / `PlayerState.js` 就实现了 #498 / #515。** 这三处官方改动**全是注释**，
   行为分别在 `economy.js` / `prep.js` 和 `acquire.js` 里。覆盖注释文件等于零功能。

### 3.3 老板树有、官方没有的东西（合并时必须保留）

合并时**一律不要**因为「官方没有」就删掉这些，它们不属于本次更新范围：

- `server/match/hextech.js` 及其全部调用面（`Match.js`、`gamedata.js`、`views.js`、`phases.js`、`bossRounds.js`、
  `bot.js`、`effectsMeta.js`、`PlayerState.js`、`invariants.js` 都有份）
- `server/match/match/testField.js` 与 `opts.test` / `isTestField()`
- `player/acquire.js` 的 `this.equipCap()` 装备上限口径
- `player/diy.js` 的 `hasDiySlot` / `setDiyPick`（休整期换自选技能／模组）
- `PlayerState.js` 的 `bondOrder` / `cumStats`
- `invariants.js` 的 `ps.equipCap()` 判定

### 3.4 一条不确定，如实记下

- 第 10 行「首领配对改为每局随机……」、第 11 行「修复联防阿戈尔……」、第 12 行「Touch 外勤医疗……」
  这三条 CHANGELOG **都没有 `#编号`**（只有第 11 行提到机制名，第 12 行提到维护者确认）。
  按 BRIEF 第 3 节规则，我按「CHANGELOG 未单列编号，按所在段落定位」处理，**没有替它们编造 issue 号**。
- `audit.js` 的 hunk 3 里那句 `fail('boss pairing does not cover every alive player once')`
  在 0.2.5 里是**新断言**；我按「配套第 10 行的审计加固」归类，未找到单独的 CHANGELOG 条目。
- 老板树 `player/acquire.js` 第 200 行有一处**重复的 `upgradeItem` 注释**（两行完全一样），
  与本次 0.2.5 改动**无关**，不是官方引入的；是否顺手清理由业主定。
