# 协议源石 → Forge：第二刀（对局层）实证

> 承接 [第一刀（战斗层）](协议源石转Forge-第一刀战斗层.md) 与 [14 行补丁探针](协议源石转Forge-探针实证.md)。
> 本文是**第二刀**：对局层搬完，**协议源石真的发牌了**。

---

## 0. 一句话

**协议源石在 Forge 上跑起来了。** 实测：draft 在第 1、6 回合触发、完成、每局发出 2 张敌方卡；
**6 种配置（4 难度 solo + 2 难度 coop）全部 0 错误**。

引擎侧总改动：**9 个文件 +162 行**，加上 5 项新文件。

---

## 1. 第二刀搬了什么

### 新增文件

| 文件 | 体积 |
|---|---:|
| `server/match/hextech.js` | 27,847 B |
| `server/match/match/hexDraft.js` | 7,876 B |

### 改动的现有文件（第二刀部分）

| 文件 | 改动 | 做什么 |
|---|---:|---|
| `server/match/gamedata.js` | +83 | 10 个 `hex*` 读取方法（自包含块） |
| `server/match/Match.js` | +19 | `MatchHexDraft` 接线 + `rngHex` + 4 个状态字段 |
| `server/match/match/phases.js` | +12 | `afterRoundStart` 那条分支 |
| `server/match/effectsMeta.js` | +12 | 上一刀的 3 行 + **`ctx.event()`** |

---

## 2. ⚠️ 第二刀又发现三个引擎缺口（都不在第一刀的清单里）

第一刀我以为「引擎侧只有一个缺口（`isRetaliation`）」。**第二刀推翻了这个结论**——
对局层一接上，又暴露出三个：

| # | 缺口 | 症状 | 修法 |
|---|---|---|---|
| 1 | 没有 `this.rngHex` | `rng is not a function`，对局 0 回合就失败 | 加一个独立的 rng 流（1 行） |
| 2 | 没有 `hex` / `enemyHexes` / `pendingMirror` / `hexDrawRound` | `Cannot read properties of undefined (reading 'map')`（finishHexDraft） | 4 个构造器字段（+19 行含注释） |
| 3 | `ctx.event()` 不存在 | `ctx.event is not a function`（`hex_lastditch.onBattleStart`） | makeCtx 加一行（`ev` 本来就是它的参数，只是没暴露） |

### 2.1 第 3 条特别值得说：`ev` 一直都在

Forge 的 `makeCtx(m, ps, source, hook, ev = null)` **本来就有 `ev` 参数**，只是从没有读者。
0.3.0 把它暴露成 `ctx.event()`：

```js
event: () => (ev && typeof ev === 'object' ? ev : null),
```

⇒ **纯增量**：既有 handler 一个都不受影响（它们本来就不读它）。

### 2.2 还有一个：`isTestField` —— 我删掉了那个守卫

0.3.0 的分支是：

```js
if (!this.isTestField() && this.gd.hexRounds().includes(this.round)) this.enterHexDraft();
```

但 `isTestField` 来自 `testField.js`（**测试场**），而 Forge **根本没有测试场这个概念**。
我最初照抄了那个守卫，结果 `isTestField is not a function`。

**处理**：删掉守卫，并留一条注释说明「如果将来移植了测试场，把守卫加回来」。
理由：协议源石没有理由依赖一个**不相关的功能**。

---

## 3. 实测：它真的发牌了

### 3.1 用 instrumentation 直接数

```
enterHexDraft calls: 2 at rounds [1, 6]
finishHexDraft calls: 2
enemyHexes drawn: 2
```

这是**决定性的证据**：draft 真的在第 1、6 回合进了，真的完成了（不是卡住），
而且每局发出 **2 张敌方协议源石**（`format.enemyPerDraw = 1` × 2 轮）。

### 3.2 对局数据（第一刀 vs 第二刀）

| 阶段 | solo FUNNY |
|---|---|
| 无补丁（**原始 Forge**） | 9 回合 · LP 27 · wins 1/1 |
| 第一刀（战斗层） | 9 回合 · LP 27（**与基线逐字一致**——战斗层没接上） |
| **第二刀 + 数据** | **8 回合 · LP 27 → 0 · wins 0/1**（**draft 生效**） |
| 第二刀但**移除 data/hextech.json** | **9 回合 · LP 27 · wins 1/1**（**与原始 Forge 逐字一致**） |

**LP 从 27 掉到 0** 说明：第 1、6 回合发的卡真的进入了这一局。

### 3.2.1 ⭐ 最后那一行是最重要的证据

我一度以为「装上代码就会有副作用」，于是做了一次**隔离对照**：**把数据文件移走、代码全留着**。

```
patched, NO data   : rounds passed: avg 9.00 · min 9 · max 9 · wins 1/1   <- 与原始 Forge 逐字一致
patched, WITH data : rounds passed: avg 8.00 · min 8 · max 8 · wins 0/1   <- draft 生效
```

⇒ **代码是行为中性的，只有「数据在」才改变对局。** 这正是 `hexRounds()` 返回 `[]` 时那条分支不触发的结果。
**这条对照同时说明：不带数据跑的 golden 语料不会移动。**

### 3.3 全配置回归：6/6 干净

```
solo FUNNY : engine errors: 0 · meta errors: 0 · sim errors: 0
solo NORMAL: engine errors: 0 · meta errors: 0 · sim errors: 0
solo HARD  : engine errors: 0 · meta errors: 0 · sim errors: 0
solo ABYSS : engine errors: 0 · meta errors: 0 · sim errors: 0
coop FUNNY : engine errors: 0 · meta errors: 0 · sim errors: 0
coop ABYSS : engine errors: 0 · meta errors: 0 · sim errors: 0
```

> ⚠️ **co-op 一开始是 1 engine + 9 meta errors**（就是 §2.1 那个 `ctx.event`）。
> 补上后归零。**我没有把它藏起来**——第一次全套跑就是红的，修完才是绿的。

---

## 4. 完整改动清单（两刀合计）

### 新增文件（5 项 + 13 张卡）

| 文件 | 体积 | 刀 |
|---|---:|---|
| `server/sim/content/hextech.js` | 102,286 B | 一 |
| `server/sim/content/hexcards/*.js`（13） | ~1,400 行 | 一 |
| `shared/hextech.js` | 10,751 B | 一 |
| `data/hextech.json` | 25,841 B | 一 |
| `server/match/hextech.js` | 27,847 B | 二 |
| `server/match/match/hexDraft.js` | 7,876 B | 二 |

### 改动的现有文件（9 个，+162 行）

| 文件 | 行 | 缺口 |
|---|---:|---|
| `server/match/gamedata.js` | +83 | 10 个 `hex*` 方法 |
| `server/sim/damage.js` | +21 | `isRetaliation` |
| `server/match/Match.js` | +19 | 接线 + `rngHex` + 状态字段 |
| `server/match/effectsMeta.js` | +12 | `hex` 键 / 钩子 / `ctx.event()` |
| `server/match/match/phases.js` | +12 | 那一条分支 |
| `shared/kitImports.js` | +6 | 4 条白名单 |
| `shared/protocol.js` | +4 | `g.hex` / `g.hexReroll` |
| `server/sim/content/index.js` | +4 | `DOMAIN_NAMES` |
| `shared/constants.js` | +1 | `PHASE.HEX_DRAFT` |

**合计：+162 行改动、5 项新文件、13 张卡。**

---

## 5. ⚠️ 还差什么（诚实清单）

跑起来了 ≠ 做完了。以下是**已知没做的**：

| 缺什么 | 影响 | 难度 |
|---|---|---|
| **客户端**（`hexOverlay.js` 266 行 + 视图投影） | 玩家**看不到**卡、点不了选 | 中（第三刀） |
| **`g.hex` 的 handler** | 协议消息定义了，但**没有落点**接它 | 低 |
| **协议源石的测试** | 13,600 行测试没搬（`test/match/hextech.test.js` 等） | 中 |
| **`gamespec` / 视图字段** | 客户端要读的 `m.public.hex` 投影 | 低 |
| **golden 语料** | **这一刀没跑过 golden**（探针树是发行包，**不含 ' + String.fromCharCode(96) + 'test/' + String.fromCharCode(96) + '**）。§3.2.1 的隔离对照**只能说明代码是行为中性的**，不等于 golden 已验——那是第三刀之外单独一件事 | 低 |

### 5.1 L.P 掉到 0 这件事要解释

第二刀之后 solo FUNNY 是「8 回合 · LP 27 → 0」。这**看起来像变差了**，但它是**协议源石生效的正常结果**：

- 敌方协议源石在第 1、6 回合各发一张（实测 2 张）；
- 那些卡**会削弱玩家**（这就是它的设计）；
- 所以 LP 掉得更快。

**要判定「是否平衡」得跑 golden 与更多种子**，那不在这一刀的范围里。

---

## 6. 一句话总结

**两刀合计：引擎侧 +162 行、9 个文件、5 项新文件——协议源石在 Forge 上真的发牌了。**

过程中发现**四个引擎缺口**，全部是**纯增量**：

1. `isRetaliation`（判定函数，标记早就在发）
2. `rngHex`（独立随机流）
3. 四个 `hex*` 状态字段
4. `ctx.event()`（`ev` 本来就是参数，只是没暴露）

**没有一个是「Forge 做不到」，全部是「Forge 还没有」。**
这印证了上一轮的判断：Forge 对这类改动**没有技术抵抗**，它只是不把这种形态收进发行体系。

---

## 附：探针树

```
_forge-hextech-probe/    118 MB（public/assets 是 junction）
  node tools/matchrun.mjs --mode solo --difficulty FUNNY --seeds 1 --quiet
    -> 8 回合 · 0 errors · draft 在第 1、6 回合触发
```

**已知未做**：客户端界面（第三刀）、`g.hex` 的 handler、协议源石的测试。