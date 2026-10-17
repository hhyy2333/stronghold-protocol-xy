# 协议源石 → Forge 补丁（106 文件 / +16939 行）

> 这是三刀移植的**可应用成果**。
> 目标：**Forge 0.18.6 / 上游 0.2.6**（`参考对象/Stronghold-Protocol-Forge-0.18.6-0.2.6-win-x64/app`）
> 补丁文件：**`协议源石-Forge补丁.patch`**（2.13 MB / 106 文件）；另附 `协议源石-Forge新增素材.zip`（卡面/音效）。

---

## 1. 怎么用

> **详细说明见 [协议源石-Forge补丁-怎么装.md](协议源石-Forge补丁-怎么装.md)。**

⚠️ **直接 `git apply` 会骗你**（2026-10-16 实测更正）：它把补丁里的相对路径解析到**它发现的那个仓库的根目录**，
不是你所在的目录。所以**即使目标 app 目录自己有 `\`.git\`，只要它的某级上级也有一个仓库，路径就会跑到上级去** ——
全部 Skipped，**exit 0**。**先 `git init` 目标 app 目录**（安装器会做），或 `GIT_CEILING_DIRECTORIES=<上级> git apply …`；
然后用 **`git apply --stat`** 复核：显示 `106 files changed` 才算真认出来了，显示 `0 files changed` 就是又被跳过了。

```bash
# 推荐：安装器（自动 git init + 核对磁盘 + 支持 --revert）
node install-hextech.mjs "<Forge 的 app 目录>" "协议源石-Forge补丁.patch" \
  --art "协议源石-Forge新增素材.zip"

# 验证
cd "<Forge 的 app 目录>"
node tools/build-hextech.mjs
node tools/matchrun.mjs --mode solo --difficulty FUNNY --seeds 1 --quiet
#   -> 8 回合 · engine errors: 0   （原生 Forge 是 9 回合）

# 卸载
node install-hextech.mjs --revert "<Forge 的 app 目录>" "协议源石-Forge补丁.patch"
```

---

## 2. 实测验证（**第一版 39 文件时的记录**，数字未随批次更新，保留作历史）

| 项 | 结果 |
|---|---|
| `git apply --check` | **exit 0** |
| `git apply` | **exit 0** |
| `git apply --reverse --check` | **exit 0** |
| 应用后与探针树比对 | **38/38 文件 SHA-256 逐字节相同** |
| 对局 | solo FUNNY **8 回合 · 0 errors** |
| 全配置 | solo ×4 难度 + coop ×2 = **6/6 · 0 errors** |
| 语法 | 客户端 8 个 + 服务端 12 个文件 **全部 OK** |
| 生成器自洽 | `node tools/build-hextech.mjs` **SHA-256 不变** |

---

## 3. 补丁包含什么（106 文件）

### 新增（21）

| 文件 | 作用 |
|---|---|
| `server/sim/content/hextech.js` | 战斗层主体（1,636 行） |
| `server/sim/content/hexcards/*.js`（13） | 卡牌实现 |
| `shared/hextech.js` | 共享规则（抽取 / 加权） |
| `data/hextech.json` | 79 张玩家 + 24 张敌方卡的数据 |
| `server/match/hextech.js` | 对局层（applyHex / 视图） |
| `server/match/match/hexDraft.js` | 阶段类 `MatchHexDraft` |
| `public/js/ui/hexOverlay.js` | 客户端浮层 + 卡面 |
| `tools/build-hextech.mjs` | **数据生成器** |
| `tools/hextech/roster.mjs` | 卡牌数值源（1,076 行） |

> ⚠️ **不含 `testArena.js`（测试场）**：这是**另一项 0.3.0 功能**，不是协议源石的一部分。
> 它的依赖链是 `testField.js`(179) + `traps.js`(38) + `testArena.js`(127) + 5 条 `g.test*` 协议消息 + `opts.test`，
> 且 `intents.js` / `protocol.js` / `game.js` 都要改。**本轮按决定不搬。**
> （我第一版补丁误带了 `testArena.js`，它是**死代码**——Forge 的 `game.js` 不 import 它、服务端没有 `testField.js`、协议里没有 `g.testHex`。已移除。）

### 改动（18，共 +299 行）

| 文件 | 行 | 缺口 |
|---|---:|---|
| `server/match/gamedata.js` | +83 | 10 个 `hex*` 读取方法 |
| `public/js/ui/gameLogic/draft.js` | +46 | `normalizeHex` / `normalizeEnemyHexes` |
| `server/match/match/views.js` | +42 | 视图投影 |
| `server/sim/damage.js` | +21 | `isRetaliation` |
| `server/match/Match.js` | +19 | 接线 + `rngHex` + 状态字段 |
| `public/js/ui/gameActions.js` | +13 | `g.hex` / `g.hexReroll` 动作 |
| `server/match/effectsMeta.js` | +12 | `hex` 键 / 钩子 / `ctx.event()` |
| `server/match/match/phases.js` | +12 | `afterRoundStart` 那条分支 |
| `public/js/screens/game.js` | +12 | 浮层接线 |
| `public/js/ui/enemyDrawer.js` | +7 | 敌方卡列表 |
| `shared/kitImports.js` | +6 | 4 条白名单 |
| `server/viewsDelta.js` | +6 | **`SCALAR_KEYS`** |
| `public/js/ui/hud.js` | +5 | 顶栏敌方条 |
| `shared/protocol.js` | +4 | 2 条 C2S |
| `server/sim/content/index.js` | +4 | `DOMAIN_NAMES` |
| `server/match/match/intents.js` | +2 | `g.hex` dispatch |
| `shared/constants.js` | +1 | `PHASE.HEX_DRAFT` |
| `public/js/ui/gameLogic.js` | +1 | 一条 re-export |

---

## 4. ⚠️ 不在补丁里的东西

| 缺什么 | 为什么 | 怎么办 |
|---|---|---|
| **卡面 / 音效**（6 个文件，5.3 MB） | `public/assets/**` 被 `.gitignore` 忽略，且含官方素材 | **单独打包**为 `协议源石-Forge新增素材.zip`（见 §5） |
| 协议源石的测试（13,600 行） | 未搬 | 需要时单列 |
| golden 语料 | 探针树是发行包，不含 `test/` | 在完整仓库里跑 |

---

## 5. 素材清单（需单独放置）

```
public/assets/local/hextech/
  tier/1.png          1.31 MB    阶位卡面
  tier/2.png          0.72 MB
  tier/3.png          1.79 MB
  audio/reroll.wav    0.29 MB    重摇音
  audio/selectGold.wav 0.77 MB   选中音
  item/item_ghost.png 0.30 MB    【幽魂】物品图标
```

**六个文件都是可选的**：`localAsset()` 找不到就返回 null，音效回落成引擎自带的 pick/refresh，
卡面回落成阶位色块。**没有素材也能跑。**

---

## 6. 移植的性质（重要）

这个补丁**修改了引擎文件**（`Match.js` / `gamedata.js` / `viewsDelta.js` / `protocol.js` …）。
按 Forge 自己的分类，这属于**就地补丁式 mod**，不是**工坊包**：

| | 工坊包 | 本补丁 |
|---|---|---|
| Forge 的投稿体系 | 支持 | **明确不采纳这种形态** |
| 引擎升级时 | 包不动（`MOD_API_VERSION` 协商） | **要重新对一遍** |
| 内容哈希对齐 | 有 | **没有** |

⇒ **它能让协议源石在 Forge 上跑起来，但它不是「可以投稿的包」。**
如果 Forge 之后升级到 0.19/0.2.7，这个补丁需要重新核对——重点看那七个缺口的位置。

---

## 7. 七个缺口（升级时重点看这些）

1. `server/sim/damage.js` — `isRetaliation`
2. `server/match/Match.js` — `rngHex` + 4 个状态字段 + `MatchHexDraft` 接线
3. `server/match/effectsMeta.js` — `KEY_RE` 的 `hex` + `onHexPick` + `registry.hex()` + `ctx.event()`
4. `server/match/gamedata.js` — 10 个 `hex*` 方法
5. `server/match/match/views.js` — 视图投影 4 处
6. **`server/viewsDelta.js` — `SCALAR_KEYS` 加 `hex` / `enemyHexes`**（唯一一个不补就报错的）
7. `server/match/match/intents.js` — `g.hex` / `g.hexReroll` 的 dispatch

---

## 8. 三刀的原始记录

- [探针实证（14 行打开四个硬阻塞）](协议源石转Forge-探针实证.md)
- [第一刀 · 战斗层](协议源石转Forge-第一刀战斗层.md)
- [第二刀 · 对局层](协议源石转Forge-第二刀对局层.md)
- [第三刀 · 客户端](协议源石转Forge-第三刀客户端.md)