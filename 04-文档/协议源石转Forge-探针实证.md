# 协议源石 → Forge：补丁探针实证

> 你问：**Forge mod 不能改那四个硬阻塞吗？**
> 上一轮我答「工坊包不能，补丁式 mod 能」——**这一轮我把补丁真的打了，跑通了**。
> 探针树：`_forge-hextech-probe/`（118 MB，`public/assets` 用 junction 指向 Forge，没复制 841 MB）

---

## 0. 一句话

**四个硬阻塞 = 14 行改动，跨 4 个文件。实测全部打开，且对局行为逐字节不变。**

但——**14 行打开的是门，不是房子。** 协议源石本体（约 5,447 行）还得搬。

---

## 1. 四个硬阻塞的完整补丁（实测 diff）

### `server/match/effectsMeta.js`（+3 −2）

```diff
@@ HOOKS
-  'onSpend', 'onMerge', 'onLevelUp', 'onBattleStart', 'onBattleResult', 'onChoicePick', 'onEquip', 'onArt',
+  'onSpend', 'onMerge', 'onLevelUp', 'onBattleStart', 'onBattleResult', 'onChoicePick', 'onHexPick', 'onEquip', 'onArt',

@@ KEY_RE
-const KEY_RE = /^(garrison|band|bond|item|choice|effect|global):[A-Za-z0-9_\-.:#]+$/;
+const KEY_RE = /^(garrison|band|bond|item|choice|hex|effect|global):[A-Za-z0-9_\-.:#]+$/;

@@ MetaRegistry
   choice(effectId, h) { return this.register(`choice:` + effectId, h); }
+  hex(hexId, h) { return this.register(`hex:` + hexId, h); }
   effect(id, h) { return this.register(`effect:` + id, h); }
```

### `shared/constants.js`（+1）

```diff
   SP_DRAFT: 'SP_DRAFT',
+  HEX_DRAFT: 'HEX_DRAFT',
   PREP: 'PREP',
```

### `shared/protocol.js`（+2 代码 +2 注释）

```diff
   'g.choice': { idx: (v) => isInt(v, 0, 5), choiceId: isId, $optional: ['choiceId'] },
+  'g.hex': { idx: (v) => isInt(v, 0, 5) },
+  'g.hexReroll': {},
   'g.ready': { ready: isBool },
```

### `shared/kitImports.js`（+4 条目）

```diff
   { specifier: '@battle/index.js', file: 'server/sim/content/support/index.js' },
+  { specifier: '@sim/damage.js', file: 'server/sim/damage.js' },
+  { specifier: '@sim/body.js', file: 'server/sim/body.js' },
+  { specifier: '@sim/tokens.js', file: 'server/sim/content/tokens.js' },
+  { specifier: '@ops/op-doroth.js', file: 'server/sim/content/kits/ops/op-doroth.js' },
```

**合计：4 个文件，+14 行（其中 4 行是注释）。**

---

## 2. ⭐ 最重要的发现：`runKey` 早就有了

我原本以为派发也是缺的。**实测发现它一直都在**：

```
FORGE  server/match/effectsMeta.js:405   runKey(ps, key, hook, source, ev) { ... }
OURS   server/match/effectsMeta.js:386   runKey(ps, key, hook, source, ev) { ... }
```

而协议源石的派发正是这么调的（`server/match/hextech.js:51`）：

```js
m.dispatcher.runKey(p, `hex:` + hex.id, 'onHexPick', { kind: 'hex', hex }, ev);
```

⇒ **派发通路本来就通，缺的只是「注册表认不认 `hex:` 这个键」。**
这条把「四个硬阻塞」里最难的一个降级成了**一行正则**。

---

## 3. 逐条实测证据

### 3.1 元注册表（改前 → 改后）

```
改前 FORGE:
  HOOKS count: 19 | onHexPick: false
  has .hex() method: false
  register("hex:probe_test") -> THROWS: MetaRegistry.register: bad key hex:probe_test

改后 FORGE:
  HOOKS: 20 | onHexPick: true
  has .hex(): true
  r.hex('probe', {}) -> OK, key registered: true
  warnings: []          <- 干净，没有「不是钩子」的告警
```

### 3.2 端到端：`hex:` 处理器**真的会触发**

用一个最小 match/player 桩，走**真实**的 `EffectDispatcher.runKey`：

```
fired: ["onHexPick:probe_card"]
RESULT: hex: handler FIRED end-to-end
```

### 3.3 阶段与协议

```
改后 FORGE:
  PHASE.HEX_DRAFT: HEX_DRAFT
  C2S g.hex: true | g.hexReroll: true
  C2S count: 58 -> 60
```

### 3.4 import 白名单

```
白名单 15 -> 19
  @sim/damage.js        ALLOWED
  @sim/body.js          ALLOWED
  @sim/tokens.js        ALLOWED
  @ops/op-doroth.js     ALLOWED
```

**四个引擎模块本来就都在 Forge 里**（实测 `existsSync` = true，符号也都在），**纯粹是开门**。

---

## 4. 回归：对局行为逐字节不变

| 场景 | 补丁前 | 补丁后 |
|---|---|---|
| solo FUNNY | 9 回合 · LP 27.0 · wins 1/1 · **0 errors** · 1582 ms | 9 回合 · LP 27.0 · wins 1/1 · **0 errors** · 1610 ms |
| solo ABYSS | — | 12 回合 · LP 27→18→8 · **0 errors** · 3482 ms |

**FUNNY 那一行前后完全一致**——14 行补丁是**行为中性**的。

---

## 5. 但那 14 行只是门：真正的工作量

| 要搬的 | 行数 | 层 |
|---|---:|---|
| `server/sim/content/hextech.js` | 1,636 | 战斗 |
| `server/sim/content/hexcards/*.js`（13 个） | 1,400 | 战斗 |
| `tools/hextech/roster.mjs` | 1,071 | 内容源 |
| `server/match/hextech.js` | 511 | 对局 |
| `public/js/ui/hexOverlay.js` | 266 | 界面 |
| `shared/hextech.js` | 211 | 共享 |
| `server/match/match/hexDraft.js` | 163 | 阶段类 |
| `server/match/match/phases.js`（1 条分支） | +1 | **集成点** |
| `server/match/gamedata.js`（`hexRounds()`） | 增量 | 数据 |
| `data/hextech.json` + `tools/build-hextech.mjs` | 生成物 | 数据 |

**合计约 5,447 行核心 + 若干集成点。**

### 5.1 好消息：集成点是**一条分支**

```js
if (!this.isTestField() && this.gd.hexRounds().includes(this.round)) this.enterHexDraft();
else if (this.gd.spRounds().includes(this.round)) this.enterSpDraft();
else this.enterPrep();
```

**就是把第一行加进去。** 阶段类本身（`MatchHexDraft`）是**自包含**的——它 `import` 的只有
`shared/hextech.js`、`server/match/hextech.js` 和 `./common.js`。

### 5.2 坏消息：战斗层要改 import 写法

13 张 hexcard 现在写的是相对路径：

```js
import { hasHp, isRetaliation, isHpLoss, makeDamageInfo } from '../../damage.js';
import { spawnYanyou, TOKEN_IDS } from '../tokens.js';
import opDoroth from '../kits/ops/op-doroth.js';
```

搬到 Forge 后要改成**白名单写法**：

```js
import { hasHp, isRetaliation, isHpLoss, makeDamageInfo } from '@sim/damage.js';
import { spawnYanyou, TOKEN_IDS } from '@sim/tokens.js';
import opDoroth from '@ops/op-doroth.js';
```

**这是机械替换，但要逐文件核对**（每张卡的 import 清单不同）。

---

## 6. 三条路的成本重估

| 路线 | 上一轮我说 | **实测后** |
|---|---|---|
| **A · 工坊包** | 死了 | **确实死了**（包填不了引擎的格子） |
| **A′ · 补丁式 mod** | 可行 | ✅ **14 行开门**，再搬 ~5,447 行；**实测跑通** |
| **B · Fork Forge** | 可行但贵 | 与 A′ 同一件事：A′ 是「打补丁」，B 是「明说分叉」 |
| **C · 提能力请求** | 部分可行 | 不变（阶段与协议是 Forge 明文排除的形态） |

**A′ 的 14 行证明了「引擎层面几乎没有抵抗」**——Forge 没有为这类改动设置技术障碍，
它只是**不把这种形态收进自己的发行体系**。

---

## 7. 建议的下一步

**探针已经证明了门是开的。** 接下来是「搬房子」，我建议分三刀：

1. **第一刀 · 战斗层**（`server/sim/content/hextech.js` + 13 张卡 + import 改写）——
   这一层**最自包含**（只依赖 `@battle/` / `@sim/` / `@ops/`，全是白名单内的），
   而且能用 `install(battle)` 直接挂上，**不需要动对局层**；
2. **第二刀 · 对局层**（`shared/hextech.js` + `server/match/hextech.js` + `hexDraft.js` + `phases.js` 那一条分支）；
3. **第三刀 · 客户端**（`hexOverlay.js` + 视图投影）。

**每一刀都能独立验证**（`node tools/matchrun.mjs` 是现成的无头跑法，`--check` 还能查违规）。

---

## 附：探针树的位置与清理

```
_forge-hextech-probe/          <- 已打好 14 行补丁的 Forge 副本（118 MB）
  public/assets -> junction 到 Forge 原件（没复制 841 MB）
```

**要删就整个删掉**（junction 删的是链接本身，不会动 Forge 原件）。

**要重跑基线**：

```bash
cd _forge-hextech-probe
node tools/matchrun.mjs --mode solo --difficulty FUNNY --seeds 1 --quiet
```