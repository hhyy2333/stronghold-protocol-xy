# 协议源石 → Forge：第三刀（客户端）实证

> 承接 [第一刀（战斗层）](协议源石转Forge-第一刀战斗层.md) 与 [第二刀（对局层）](协议源石转Forge-第二刀对局层.md)。
> 本文是**第三刀**：客户端 + 服务端视图投影。

---

## 0. 一句话

**客户端接通了。** 服务端发的 `m.public.hex` / `.enemyHexes` 帧，
客户端的 `normalizeHex` 真的能读、能变成可渲染的 offer；
**6 种配置（4 难度 solo + 2 难度 coop）全部 0 错误**。

引擎侧这一刀：**客户端 +84 行（6 个文件）+ 服务端 +48 行（2 个文件）+ 2 个新文件**。

---

## 1. ⚠️ 第三刀最重要的发现：一个**结构性**的陷阱

### 1.1 我一开始做错了，而且错得很危险

我第一反应是「把客户端的文件整个复制过去」。结果实测 diff：

```
public/js/screens/game.js    +201 -35
public/js/audio.js           +26 -59
public/js/ui/hud.js          +17 -33
public/js/ui/guide.js        +125 -13
```

**这不是「移植协议源石」，这是「把 0.3.0 的一半客户端搬过去」。**
那些 diff 里混着 **morph 形态、terrain noteUnits、settings 的 voiceLangs** 等等**与协议源石无关**的 0.3.0 功能。

⇒ 我**全部回滚**，改成**只挑 hextech 那几行**。

### 1.2 修正后的 diff

```
public/js/ui/gameLogic/draft.js    +46   <- 两个 normalizer 函数
public/js/ui/gameActions.js        +13   <- g.hex / g.hexReroll 动作 + 音效
public/js/screens/game.js          +12   <- import + hexBusy + hexDraft + 渲染
public/js/ui/enemyDrawer.js        +7    <- 敌方卡的 chip + 文字列表
public/js/ui/hud.js                +5    <- 顶栏的敌方协议源石条
public/js/ui/gameLogic.js          +1    <- 一条 re-export
────────────────────────────────────────
TOTAL                              +84
```

**从 +400 降到 +84，而且每一行都真的是协议源石的。**

> **教训**：**「整个文件复制」是移植里最贵的错误形式**——它看起来最快，
> 但它把**你没打算移植的东西**一起带过来，而那些东西**没有任何测试会告诉你它不该来**。

---

## 2. 这一刀又发现两个引擎缺口

### 2.1 `views.js`：服务端视图没有 hex 投影

客户端要读 `m.public.hex`，但 Forge 的 `publicView()` **根本不发这个字段**。
补了 4 处（`views.js` +42 行）：

| 位置 | 补什么 |
|---|---|
| `statusOf()` | `case PHASE.HEX_DRAFT` ⇒ `'ready'` / `'deciding'`（并行轮选，没有 `'acting'`） |
| `publicPlayerView()` | `hexes` + `freeLeak`（不灭壁垒的免漏怪标记） |
| `publicView()` | `enemyHexes`（每阶段）+ `hex`（仅 `HEX_DRAFT`） |
| `nextEnemiesFor()` | 把敌方协议源石折进预告（`applyEnemyHexes`） |

### 2.2 ⚠️ `SCALAR_KEYS`：这正是 `NET-TUNING.md` 警告的那个坑

补完 `views.js` 之后，对局立刻报 **6 个错误**：

```
[match RUN] public delta: unknown top-level key "hex"
```

**根因**：Forge 的增量帧有一个 **27 键的白名单** `SCALAR_KEYS`。
一个**既不在白名单、客户端基线里也没有**的顶层键，会让 diff **拒绝这一帧**并回落成全量帧。

而 Forge 自己的 `docs/NET-TUNING.md` 早写过：

> **`SCALAR_KEYS` 的维护是隐式契约。** 新增一个顶层字段却忘了登记，它的变化**不会**进增量帧……

补法是 6 行（两个键 + 注释）：

```js
  'hex', 'enemyHexes',
```

**补完 6 个错误归零。** 这是三刀里**唯一一个「不加就报错」的缺口**——
其他缺口不补是「功能没有」，这个不补是**每一帧都降级成全量帧**（性能问题，而不是功能问题）。

---

## 3. 实测：服务端 ↔ 客户端的契约是通的

### 3.1 服务端真的发帧了

用 instrumentation 数 `publicView()` 的输出：

```
publicView frames carrying .hex        : 4
  sample: {"offers":{"ai_0":[{"id":"hex_armor","name":"反击装甲",...
publicView frames carrying .enemyHexes : 46
  sample: {"id":"ehex_siege","name":"攻城训练","desc":"敌方最大生命值 +10%...","drawRound":1}
```

**帧里真的有卡**——offer 带着 id / 名字 / 描述 / 稀有度 / idx，敌方卡带着 drawRound。

### 3.2 客户端的 normalizer 真的能读

把**服务端真实帧的形状**喂给客户端的 `normalizeHex`：

```
normalizeHex(server frame):
  myOffer length : 2
  myPick         : null
  myRerolls      : 1
  decided        : false
  first card     : {"id":"hex_armor","name":"反击装甲","desc":"…","rarity":"gold","idx":0}
normalizeEnemyHexes: [{"id":"ehex_siege","name":"攻城训练",...,"drawRound":1}]
normalizeHex(null): null       <- 不在 draft 时不渲染浮层
```

**契约通了**：服务端发什么，客户端就读到什么。

### 3.3 最终全配置回归

```
solo FUNNY : engine errors: 0 · meta errors: 0 · sim errors: 0
solo NORMAL: engine errors: 0 · meta errors: 0 · sim errors: 0
solo HARD  : engine errors: 0 · meta errors: 0 · sim errors: 0
solo ABYSS : engine errors: 0 · meta errors: 0 · sim errors: 0
coop FUNNY : engine errors: 0 · meta errors: 0 · sim errors: 0
coop ABYSS : engine errors: 0 · meta errors: 0 · sim errors: 0
```

---

## 4. 三刀合计总账

### 新增文件

| 文件 | 层 |
|---|---|
| `server/sim/content/hextech.js` | 战斗 |
| `server/sim/content/hexcards/*.js`（13） | 战斗 |
| `shared/hextech.js` | 共享 |
| `data/hextech.json` | 数据 |
| `server/match/hextech.js` | 对局 |
| `server/match/match/hexDraft.js` | 对局 |
| `public/js/ui/hexOverlay.js` | 客户端 |

### 改动的现有文件

| 文件 | 行 | 缺口 |
|---|---:|---|
| `server/match/gamedata.js` | +83 | 10 个 `hex*` 方法 |
| `public/js/ui/gameLogic/draft.js` | +46 | 2 个 normalizer |
| `server/match/match/views.js` | +42 | 视图投影 |
| `server/sim/damage.js` | +21 | `isRetaliation` |
| `server/match/Match.js` | +19 | 接线 + rng + 状态 |
| `public/js/ui/gameActions.js` | +13 | 2 个动作 |
| `server/match/effectsMeta.js` | +12 | hex 键 / 钩子 / `ctx.event()` |
| `server/match/match/phases.js` | +12 | 那条分支 |
| `public/js/screens/game.js` | +12 | 浮层接线 |
| `public/js/ui/enemyDrawer.js` | +7 | 敌方卡列表 |
| `shared/kitImports.js` | +6 | 4 条白名单 |
| `server/viewsDelta.js` | +6 | **`SCALAR_KEYS`** |
| `public/js/ui/hud.js` | +5 | 顶栏条 |
| `shared/protocol.js` | +4 | 2 条 C2S |
| `server/sim/content/index.js` | +4 | `DOMAIN_NAMES` |
| `shared/constants.js` | +1 | `PHASE.HEX_DRAFT` |
| `public/js/ui/gameLogic.js` | +1 | 一条 re-export |

**合计约 +294 行改动、7 项新文件、13 张卡。**（`testArena.js` 属于测试场，**已移出**——见 [补丁说明](协议源石-Forge补丁说明.md) §3 的说明。）

---

## 5. ⚠️ 还差什么（第三刀之后的诚实清单）

| 缺什么 | 影响 | 难度 |
|---|---|---|
| ~~`g.hex` / `g.hexReroll` 的服务端 handler~~ | ✅ **本轮已补**：`intents.js` 缺两条 dispatch（`pickHex` / `rerollHex` 本来就在）。见 §5.1 | 已完成 |
| **协议源石的测试** | 13,600 行测试没搬 | 中 |
| **golden 语料** | 三刀都**没跑过**（探针树是发行包，不含 `test/`） | 低 |
| **游戏内实机验证** | 我**没有真的打开浏览器**点过那张卡 —— 全部验证都是 Node 层面的 | **中** |

> ⚠️ **最后一条必须说清**：我验证的是「服务端发帧、客户端函数能读」。
> **我没有真的在浏览器里渲染过 HexOverlay。** 那需要 `SP_E2E=1` 与 Chrome，
> 而发行包不含测试基建。**「能渲染」是推断，不是实测。**

---

## 6. 一句话总结

**三刀之后，协议源石在 Forge 上：战斗层跑通、对局层发牌、客户端能读帧。**

**引擎侧总计约 +294 行、7 项新文件**，发现的缺口全部是**纯增量**：

1. `isRetaliation`（判定函数）
2. `rngHex`（独立随机流）
3. 4 个 `hex*` 状态字段
4. `ctx.event()`（参数本来就有）
5. 10 个 `hex*` gamedata 方法
6. `views.js` 的视图投影
7. **`SCALAR_KEYS` 的两个键**（唯一一个不补就报错的）

**没有一个是「Forge 做不到」，全部是「Forge 还没有」。**

---

## 附：探针树

```
_forge-hextech-probe/
  node tools/matchrun.mjs --mode solo --difficulty FUNNY --seeds 1 --quiet
    -> 8 回合 · 0 errors
```

**下一步（如果要继续）**：搬测试、跑 golden、**实机验证**。

---

## 7. 收尾时补掉的第五个缺口：`intents.js` 没有 dispatch

写完客户端后我回头核对了一遍，发现 **`g.hex` / `g.hexReroll` 在 Forge 里没有 dispatch 分支**：

```
OURS  intents.js:42   case 'g.hex': return this.pickHex(ps, msg.idx);
OURS  intents.js:43   case 'g.hexReroll': return this.rerollHex(ps);

FORGE intents.js      （没有这两行）
```

而 `pickHex` / `rerollHex` **本来就在**（第二刀搬进来的 `MatchHexDraft` 里）。
所以缺的只是**两条 dispatch**——纯接线，不是新功能。

补完实测：`'g.hex'` 出现在 `MatchIntents` 源码里、`Match.prototype.pickHex` 是 function、对局仍 0 错误。

> **这条不在我原本的清单里，是写文档时回头核对才发现的。**
> 只按计划走的话，玩家点卡片会**静默无效**——协议消息定义了、动作定义了、handler 也在，**只是没人把三者接起来**。