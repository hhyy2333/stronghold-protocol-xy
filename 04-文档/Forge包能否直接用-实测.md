# 能直接用 Forge 的 mod 吗？——实测回答

> 问题：把业主这棵树按 Forge 的形态改，**能不能直接用他的 mod？**
> 方法：**不是推断，是实测**。把 Forge 0.18.6 发行包里真实的 `pack.json` 喂进业主这棵树的
> `shared/dataPacks.js` 校验器与 `applyDataPacks` 合并管线，看结果。

---

## 0. 结论（三句话）

1. **不能直接用，但不是因为「差得远」——差的是清单，不是内容。**
   Forge 包的 **`chess.json` 等数据文件在业主这棵树里逐条通过校验**（实测 `problems: []`），
   唯一被拒的是 `pack.json` 的**字段名与字段集**。
2. **改造成本很低**：一个 Forge 包改写清单后**能真的跑起来**（实测合并成功，棋子进了 `data.chess`）。
   差异是 **6 个字段名 + 一个角色名**，不是架构。
3. **但有 4 张表业主这棵树不支持**（`units` / `factions` / `choices` / `variants`）——
   用这 4 张表的包**改造也跑不起来**，必须先在业主这棵树上补实现。

---

## 1. 实测：Forge 的包喂进我们的校验器

### 1.1 三个真实样本，全部被拒

```
===== demo-workshop        （Forge 官方最小示例包）
  problems: ["unknown field \"author\"", "unknown field \"gameVersion\"", "unknown field \"content\""]
  accepted: false

===== my-first-pack         （Forge 0.18.6 的入门模板包）
  problems: ["unknown field \"author\"", "unknown field \"api\"", "unknown field \"art\"",
             "no files: a data pack names at least one role"]
  accepted: false

===== clementia             （社区 mod 的端到端夹具）
  problems: ["unknown field \"author\"", "… \"gameVersion\"", "… \"layer\"", "… \"content\"",
             "… \"operators\"", "… \"voices\"", "… \"voiceLangs\"", "… \"art\""]
  accepted: false
```

**全部被拒**。但注意拒的理由——**每一条都是 `unknown field`**，即「我不认识这个键」，
而不是「这个键的值不对」或「内容有问题」。

### 1.2 但内容文件**逐条通过**

同一个包里，数据文件喂进业主这棵树的 `normalizeContent`：

```
forge demo-workshop/chess.json: 2 条记录
  sample record keys: chessId, baseId, goldenId, isGolden, tier, identifier, isHidden,
                      isDiy, visible, chessType, shopSortId, charId
  我们的 normalizeContent problems: []
  accepted: true          ← 逐条通过
```

**这是整件事的关键**：Forge 与业主这棵树的**记录形状是同一套**（都是从官方 `data/*.json` 抄的）。
差异**只在清单层**。

### 1.3 把清单翻译一下，包**真的能跑**

把 `demo-workshop` 的清单按业主这棵树的格式改写（`author` → `authors[]`、`content[]` → `files{}`、
补 `type: "data"`、`gameVersion` → `app`），然后走**真实的** `applyDataPacks`：

```
translated manifest problems: []
accepted: true

content chess.json -> OK (2 records)
applied: demo-workshop added={"chess":2}
skipped: []
resulting chess ids: chess_char_ws_demo_01_a, chess_char_ws_demo_01_b
```

**合并成功，两个棋子进了数据。** 所以「能直接用吗」的答案是：
**不能原样用，但改造路径是通的，而且短。**

---

## 2. 字段对照表（实测）

### 2.1 两边都认识的（形状兼容）

```
id, name, version, license, description, overrides
```

### 2.2 Forge 有、我们没有（**30 个**）

```
author          gameVersion     game            api             layer
combat          content         voices          voiceLangs      bondIcons
itemIcons       art             skins           support         operators
i18n            forms           fx              notices         playtest
enabled         variants        behaviour       assets          client
server          routes          target          dependencies    conflicts
```

其中**大部分是执行面**（`server` / `client` / `assets` / `routes` / `behaviour` / `forms` / `fx` / `skins` …），
业主这棵树**政策上就不做**（`docs/PACKS.md:200-202`）。真正需要单独判断的是**内容面那几个**（见 §4）。

### 2.3 我们有、Forge 不认识的（**6 个**）

```
type, englishName, app, authors, credits, files
```

**反向也一样**：业主这棵树自己的包（`packs/clemnt-addition/pack.json`，实测）
会被 Forge 以 `type` / `englishName` / `app` / `authors` / `files` **5 个未知键拒掉**。

⇒ **两个宿主是「同一套内容、两套清单」，不是「一个能用另一个的包」。**

---

## 3. 数据表（角色）对照

| | 数量 | 清单 |
|---|---:|---|
| 业主这棵树 `DATA_ROLES` | **11** | chess, bonds, garrisons, items, bands, effects, enemies, waves, stages, bosses, tokens |
| Forge `WORKSHOP_CONTENT_FILES` | **15** | 上面 11 张 **全部都有** + units, factions, choices, variants |

**实测：业主这棵树的 11 张表在 Forge 里一张不缺**（`ours-not-in-forge: (none)`）。
反向，Forge 多 4 张，业主这棵树**明确拒绝**：

| Forge 多出的表 | 业主这棵树的态度 | 出处 |
|---|---|---|
| `units` | 拒绝：`backups` 的 `units` 是**嵌套路径**，需要自己的 mod 交互规则（标 P2） | `shared/dataPacks.js:56` |
| `factions` | 拒绝：是 `{types, entries}` **容器**，不是 `{id: record}` 映射 | `:58` |
| `choices` | 拒绝：同上（`{events, cards}`） | `:57` |
| `variants` | **不存在**（Forge 0.18.6 新增的口径层） | — |

**这是「能直接用吗」的真正分水岭**：用了这 4 张表的 Forge 包，**改造清单也没用**——
必须先在这棵树上实现它们。而 `variants` 尤其值得注意：它是 Forge 0.18.6 的新格，
业主这棵树**连概念都没有**。

---

## 4. 那么「这样改」到底能不能用他的 mod？

要分三种情况回答，因为「他的 mod」不是一个东西：

### 情况 A · 纯内容包（只用 11 张表里那些）

**能，改造量小。** 实测 `demo-workshop` 已经跑通。
改造清单：

| Forge 写法 | 业主这棵树写法 |
|---|---|
| `"author": "某人"` | `"authors": ["某人"]` |
| `"content": ["chess","items"]` | `"files": { "chess": "chess.json", "items": "items.json" }` |
| `"gameVersion": "0.1.3"` | `"app": ">=0.3.0"`（语义不同，见 §5） |
| `"layer": "A"` | 删掉（这棵树没有 ABI 概念） |
| （无） | 补 `"type": "data"` |

**注意 `overrides` 语义两边一致**（`"<角色>:<id>"`），实测也通过——这一格是白送的。

### 情况 B · 用了执行面的包（`kits` / `server.meta` / `client.panels` …）

**不能，而且不是改造问题，是政策问题。** 业主这棵树**明文拒绝执行第三方代码**
（`docs/PACKS.md:200-202`：*"no kit script, no server hook, no client panel. The Forge branch loads all of those;
we deliberately do not."*）。

**改清单没用——那部分功能在这棵树上没有落点。** 要支持就得先推翻自己的政策。

### 情况 C · 用了 `units` / `factions` / `choices` / `variants` 的包

**改造清单不够，要补实现。** 这 4 张表是**业主这棵树自己标了 P2 没做**的（或没有概念的）。

---

## 5. ⚠️ 一个不能忽略的语义陷阱：`gameVersion` vs `app`

两边的「版本声明」**名字像，含义完全不同**：

| | Forge | 业主这棵树 |
|---|---|---|
| 字段 | `gameVersion` / `game` / `api` | `app` |
| 比的是什么 | `game` 对**上游游戏版本**；`api` 对 **MOD_API_VERSION** | 对 **本引擎的 APP_VERSION**（`shared/packs.js:123 appVersionMatches`） |
| 越界后果 | **refuse**（`layer:B`）/ **degrade**（`layer:A`）/ **warn** | 不在范围内 ⇒ `compatible: false`，仍加载、能力降级 |

**机械翻译 `gameVersion` → `app` 是错的**：一个是「针对哪个上游版本」，一个是「要求哪个引擎版本」。
正确做法是**按目标引擎重写**（`>=0.3.0`），并在包里说明这是移植版。

---

## 6. 还有一个工程硬点：包目录位置

| | Forge | 业主这棵树 |
|---|---|---|
| 目录 | `workshop/<id>/` | `packs/<id>/` |
| 发现 | `server/workshop.js loadWorkshop` 扫 `workshop/` | `server/packs.js scanPacks` 扫 `packs/` |
| 类型 | 统一 schema | **类型化**（`lang` / `data` / `assets`） |

**`workshop/` 与 `packs/` 是两个不同的目录**，两个注册表互不认识。
所以即使清单翻译好了，**包也要换个目录放**（或者给业主这棵树加一个扫 `workshop/` 的兼容入口）。

---

## 7. 回答

> **「这样改，能直接用他的 mod 吗？」**

**不能直接 `drop-in`，但「能用的那部分」改造量很小；「不能用的那部分」不是改造能解决的。**

| | 结论 |
|---|---|
| 纯内容包（11 张表内） | ✅ **能**，实测已跑通。改 5 处清单字段 + 换目录 |
| 执行面包（kits / hooks / panels） | ❌ **不能**，且**是政策问题**——改清单无用，要推翻 `PACKS.md:200` |
| 用 `units`/`factions`/`choices`/`variants` 的包 | ❌ **不能**，要**先补实现**（这 4 张表这棵树没有） |
| 业主这棵树的包给 Forge 用 | ❌ 同样不行（Forge 拒我们的 5 个键） |

**一句话**：两边的**内容格式是同一套**（都抄官方），**清单是两套**，
**能力面是两条路线**。所以「直接用」不成立，但**「用同一个内容生态」是可能的**——
前提是有人写一个**清单翻译器**（把 `pack.json` 在两种格式间转换），
而那正是一个**成本很低、收益很直接**的工具。

---

## 8. 建议

如果业主的目标是「**能用社区做好的内容包**」，那么**最省事的路**不是移植 Forge 的 mod 层，而是：

1. **写一个清单翻译器**（`tools/forge-pack-import.mjs`）：
   读 Forge 的 `pack.json` → 输出业主这棵树的 `pack.json` + 把内容文件抄进 `packs/<id>/`；
2. **明确拒绝表**：用了执行面或那 4 张表的包，**点名拒绝并说清原因**（不静默丢弃）；
3. **补 `units` 表**（这一张最有价值：它是「加干员」的正路，而业主这棵树现在只能加棋子）。

第 3 条是**唯一需要动引擎**的一项，而且它**不涉及执行面**——`units` 是纯数据
（Forge §28.10 的 `operators` / `support` + `units.json`），与 `PACKS.md:200` 那条政策不冲突。

**我的建议：先做 1 + 2（零引擎改动，立刻能用一部分社区包），把 3 单列。**
