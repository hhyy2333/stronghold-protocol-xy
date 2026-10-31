# Forge 的 mod 层剖析（三层 A/B/C 与它的守卫）

> 对象：`C:\Users\hhyyl\Downloads\Stronghold-Protocol-Forge-0.15.0-0.2.4-win-x64`（Forge 分支，自研 0.15.0 + 上游 0.2.4）
> 对照：`Stronghold-Protocol-repo`（业主 0.3.0 分支）
> 本文只做剖析，**不含任何代码改动**。所有行号已核对到具体位置。

---

## 0. 一句话

Forge 的 mod 层不是「一个加载器」，而是**一套 ABI**：它把「一个第三方包能碰引擎的哪些东西」写成一张**可断言的表**，
每一格表面都锚定到一个真实导出符号、一个实现文件、一份测试和设计稿的一节；并且**双向闭合**——引擎里加了一格而没进表、
或删了一格而表还说它在，**测试当场红**。

这套设计的起因写在文件头（`shared/modSurface.js:4`），是业主的原话：

> **「如果改动引擎，我们的中间层可能又被覆盖，那怎么办呢」**

Forge 的回答是诚实的：**没有任何东西能阻止引擎被上游移植改写**。能做的是让改写**无法悄悄成功**。

---

## 1. 三层裁决（DESIGN §28.1）

| 层 | 是什么 | 谁执行 | 能改对局结果吗 |
|---|---|---|---|
| **A** 内容 | 声明式数据，无代码 | 没人——合进每个人都读的数据里 | 会，但 golden 语料看不见（语料从官方 `data/*.json` 生成） |
| **B** 服务端逻辑 | hooks 与 kits（`workshop/<pack>/kits/<id>.js`） | **只有服务端** | 只能通过它注册的钩子，且要在声明意图通过确定性验证之后 |
| **C** 客户端界面 | 渲染、主题、面板 | 玩家的标签页 | **永不** |

三层是**能力分级**，不是三个目录。判据是「这东西能不能改「谁在玩 / 装了什么 / 这一局的结果」」——
改不了就不要求 `combat: true`（例如 `server.room` 是只读观察面），改得了就必须声明。

---

## 2. 表面表（pack-facing ABI）

### 2.1 一格的形状（`shared/modSurface.js:28-40`）

```js
{
  id: 'server.battle',        // 稳定标识（也是 docs/MOD-SURFACE.md 里那一行）
  layer: 'B',                 // A 内容 / B 服务端 / C 客户端
  decl: 'pack.json.server.battle = { module }',   // 作者写的那一行
  anchors: [{ symbol: 'SERVER_MEMBERS', members: ['battle'] }],  // 承载它的真实导出符号
  requires: ['combat: true', '两端跑同一段字节', '只能 import @battle/ 与 @sim/'],
  files: [...],               // 实现它的引擎文件
  tests: [...],               // 钉死它的测试
  spec: '§28.17',             // 设计稿那一节
}
```

**五样东西缺一不可**：声明 + 符号 + 实现文件 + 测试 + 设计稿。这就是「表面」的定义。

### 2.2 表面清单（按 `docs/MOD-SURFACE.md`）

**A 层：内容**

| id | 声明 | 硬要求 |
|---|---|---|
| `content` | `content[]` + 14 张表 | 记录形状照抄官方；数据不是代码 |
| `overrides` | `overrides[] = "<文件>:<id>"` | 覆盖官方条目**必须显式声明** |
| `units.operators` | `operators`/`support` + `units.json` | 必填字段 `UNIT_REQUIRED_FIELDS` |
| `media.voices` | `voices`/`voiceLangs` + 包内音频 | 只服务登记过的 URL |
| `media.icons` | `bondIcons`/`itemIcons`/`art` | 路径是包内相对路径 |
| `skins` | `skins[]` + 包内素材 | 玩家可用设置**整个关掉**；关掉时解析链与不装包逐字相同 |
| `notices` | `notices = { 栏目: 文本 }` | 纯文本，**append 而非覆盖** |
| `i18n` | `i18n = { 语言码: 包内 .json }` | 文件名必须是语言码 |

**B 层：服务端逻辑**（这一类是 Forge 独有的）

| id | 声明 | 硬要求 |
|---|---|---|
| `server.preDispatch` | `{ module, policy, intercepts }` | `intercepts` 必须是 C2S 里的类型名 |
| `server.meta` | `{ module, registers }` | 改对局逻辑 ⇒ 必须 `combat: true` |
| `server.modules` | `{ module, uses[] }` | 只在 `SERVER_MODULE_USES` 钩子上；源码过确定性扫描 |
| `server.battle` | `{ module }` | `combat: true`；**两端跑同一段字节**；只能 import `@battle/`、`@sim/` |
| `server.room` | `{ module }` | **不**要 `combat: true`——只读观察面，返回值被忽略 |
| `kits.relativeImports` | `kits/<id>.js` 里的 `./…` | 只许**向下**相对；辅助文件字节进身份哈希 |
| `routes` | `[{ path, cache }]` | 路径与缓存策略都在允许集合内 |
| `assets` | `{ container, algorithm, digest, file, server }` | 装载期核对摘要 |

**C 层：客户端界面**

| id | 声明 | 硬要求 |
|---|---|---|
| `client.panels` | `{ id, slot, module, order, gate }` | `slot` 必须是引擎渲染得出的宿主（**九个**） |
| `client.panels.me` | 无需声明：`ctx.me` 总是给 | 只读会话态；**不含** store / match / runner / audio |
| `client.panels.wraps` | `{ component, mode }` | `mode ∈ {wrap, replace}`；任一环坏了退回**它下面那一份**并点名 |
| `client.panels.styles` | `styles[]` | 只服务登记过的 URL |
| `client.theme` | `vars = { --x: 值 }` | 变量名 `--` 开头；值里不许有 `; { } < >` 换行 |
| `client.panels.data` | `data[]` | 表必须在 `CLIENT_PANEL_DATA_TABLES` 里；只读快照 |
| `client.panels.messages` | `messages[]` | 类型名由引擎定（`pack.msg`），通道名由包定；有额度与限流 |
| `client.requires` | `requires[]` | 缺一即「浏览器不支持」，**不是静默不工作** |
| `forms` | `{ chars\|enemies\|tokens: { spineId: { 形态名 } } }` | 第一方 `FORMS` 优先；同名在形状层就拒 |
| `fx.silentPhases` | `fx = { silentPhases: [...] }` | **并集**：第一方两个永远静默，包只能加、取消不了 |

**发行**：`mods.catalog`（客户端 mod 目录 + 房间 `modIds`）。

### 2.3 九个客户端宿主（`CLIENT_PANEL_SLOTS`）

```
root.overlays, root.guide, screen.game.aside, screen.result.footer,
screen.game.shopCard, screen.game.bondStrip, screen.game.hud, screen.game.overlay,
screen.loadout.detail
```

分两种：前四个是**固定浮层**（注册点按需创建容器）；后五个**活在引擎已经渲染的组件里**（组件自己渲染
`[data-mod-slot]`，注册点只**查找**——找不到 = 「还没到」，不是「失败」，更不会在没人认识的位置凭空造一个容器）。

`screen.game.shopCard` 是**可重复**的：每张商店卡一个容器，面板挂进**每一个**，通过 `ctx.hostKey` 知道自己是哪一份。

---

## 3. 五个「缺口」与各自的答案

Forge 把这一层要补的东西叫 gap，逐条有裁决：

### gap 1 · 身份（§28.2）

**问题**：一个包有 `id`（目录名）和自由文本元信息，但**没有任何地方**说得清「这个房间跑的是哪份内容」。

**答案**：一个元组，一个形状，一个地方：

```js
{ id: 'abyss', hash: '<64 hex>', api: '>=1 <2', layer: 'B', combat: true }
```

房间的身份是它那份排序列表的**摘要**：`sha256`(canonical JSON of `[{id, hash}, …]` sorted by id)。
**同一个字符串**被 `welcome`、`/healthz`、BattleSpec、bug 报告四处引用——四个地方不可能各说各话。

**什么参与哈希**（关键设计）：

1. `pack.json`——哈希的是**规范化之后**的清单，不是磁盘字节 ⇒ 两种写法得到同一个摘要；
2. 每个声明并成功解析的内容文件——同样规范化之后；
3. **包目录下每一个普通文件**的原始字节——包括**没有任何声明**、但被某个声明模块 `import` 或运行时读的文件。

**为什么第 3 条要「无排除」**（`server/packFiles.js` 文件头写得很透）：

> 被声明的模块可以 `import` 同目录的兄弟文件、可以在运行时 `fs.readFileSync` 一个数据文件或模板，而 Node 的解析是
> 原生的——所以「这个包会执行/读到哪些文件」**不存在可判定的答案**，除了一整个目录。任何例外
> （`README.md`、`test/`、`*.bak`）都会把要堵的那个洞重新打开。

**为什么是「一个枚举器」**：包摘要必须**恰好**描述「客户端会下载、会执行的那一份」。两份清单各用一条规则生成就会漂移，
而漂移的后果不是「摘要差一点」，是：一个被声明模块 `import` 的文件在两份清单里都没有 ⇒ **干净的客户端根本不会下它**，
服务端跑得好的包在浏览器里连 `import` 都解析不出来。

所以 `server/packFiles.js listPackFiles` 是**唯一**枚举器：递归、按路径排序、**符号链接既不跟随也不列出**、
目录不在就返回 `[]`。`identifyPack` 用它建清单，`modCatalog.catalogFiles` **拒绝**发布一个它没返回的行
⇒ **哈希取的那份清单就是客户端的下载清单**：一份清单，两个消费者，无法漂移。

**刻意不参与哈希的**：kit URL 的 mtime「版本」（那不是内容哈希）、包目录的绝对路径、**任何引擎代码**。
最后一条是重点：如果哈希覆盖了**派生**记录，那每一次引擎改动都会改掉每个包的哈希，
**没有任何包能证明它和昨天是同一个包**。所以：哈希覆盖包自己的字节，**引擎那一半身份是 `api`**。

### gap 2 · 装载（§28.3）：一条「谁赢」的规则

只有两条规则，不是三条：

1. **官方记录绝不在没有声明的情况下被替换。** 没得商量：悄悄重定义一位已发行的干员会毁掉服务器上的每一场对局。
2. **两个包之间，包 id 小的赢——在每一个面上**（data、kit、icon、item icon、art）。

`overrides` 是**替换官方数据的许可，不是覆盖另一个包的许可**——这条细化是最微妙的一条：一个包声明了
`"chess:X"`，但发现另一个包已经贡献了 `X`，它**照样按 id 顺序输**，报告会说明。没有这句话，规则就有一个安静的后门：
id 大的包只要往 `pack.json` 加一行就能抢走记录——正是这一节存在要防的「悄悄重定义别人的内容」。

**归因**：每个冲突错误都带 `{ pack, code, file, id, definedBy, reason }`，`definedBy` 是持有记录的包 id 或字符串
`official`。为什么值得单列一节：数据路径曾经对两种情况都说「**official** data」，因为持有「官方 + 目前已合并的所有包」
的变量叫 `official`。作者的下一步就是去打开 `data/chess.json` 找一个**根本不在那里**的记录。

### gap 3 · 隔离（§28.4）

**服务端权威。** 一个 mod 集合里含任何 `layer: B` 包的房间，`clientCombat = false`——**决策从进程级的 `SP_COMBAT`
环境变量移到房间的 mod 集合**。玩家的标签页于是**永不执行包代码**。

**`SP_VERIFY` 默认 `off` 是被处理的，不是被忽略的**：

- (a) 声明了 `combat: true` 的房间跑服务端权威**且** `verify = 'all'`；
- (b) 没有 mod 集合的房间**不受影响**。

代价被明说而不是藏起来：服务器现在自己跑那些战场，按既有的墙钟预算切片（默认每次回调 8 ms）。
**这就是为什么 `combat: false` 的包重要**——它们保住那条便宜的路径。

**没有文件系统，没有网络。** `KIT_IMPORT` 对白名单之外的任何东西都是错误；环境全局变量已被扫描——
但在今天只是**警告**（`KIT_NONDETERMINISTIC`）。在服务端独占执行下，一个 `Date.now()` 不能再被开脱为
「两边都跑了它」：它是对「对局依赖的重算」的直接威胁。所以设计是：**对 `layer: B` 包，
`KIT_NONDETERMINISTIC` 变成错误**，拒绝时点名那个构造和它所在的行。

**深度，和那个当前在掩盖坏战场的守卫。** `MAX_HOOK_DEPTH = 32`；到达上限时总线会跳过**每一个**嵌套处理器，
**包括引擎自己的 `kill`/`death` 记账**——于是战斗带着错误的状态继续跑，而结果仍被接受。两个决定：

- **守卫本身不改**（它坐在确定性路径上，它的跳过语义正是 golden 语料建立时对照的）；
- **后果改了**：`_handlerError` 已经拿到归属的 unit 或 handle 并记录了 `who`，
  所以「是包的处理器嵌套太深」还是「引擎的」这个信息**已经在手上、目前却被丢进一个去重字符串**。
  一次可归因于包的深度触发必须把该战场结果标为**不可信**，并交给服务器自己跑。

**时间预算。** 没有能打断处理器的超时（一个 tick 是一次同步调用）。设计**不假装**加抢占——
它做的是把预算变得可见且可在装载期强制：包的验证跑（§28.6）测量固定场景列表的墙钟，
一个超过声明预算的 `combat: false` 包被拒。

### gap 4 · 版本（§28.5）

声明**两个范围**：

- `api`——**mod 层 API** 范围，对比 `shared/constants.js MOD_API_VERSION`（当前 `= 1`）。这一半覆盖引擎代码，
  也正是**包的哈希不必覆盖引擎**的原因；
- `game`——**上游游戏版本**范围；
- `gameVersion` 保留一个发行版可读，映射到 `game`，所以没有现存包会坏。

**三档判定，由「差异能做什么」决定**：

| 判定 | 何时 | 后果 |
|---|---|---|
| **refuse** | `layer: B` 包且 `api` 范围不含本 build | 根本不加载；理由点名声明的范围与已装的 API |
| **degrade** | `layer: A` 包且 `game` 范围不含已装游戏版本 | 只加载仍通过既有逐记录校验器的记录，逐 id 报告丢弃项，标记 `compatible: false` |
| **warn** | 其他：没声明范围，或范围含本 build | 正常加载；在启动报告里标记「缺声明」 |

**「引用会腐烂」这件事有守卫**——而且不是假想：写这一节时冒出了三处。其中一处，
`shared/kitAuthoring.js` 的文件头教作者钩子总线在哪，引的是 `server/sim/Battle.js` 的两个行号（583、623），
而 `on`/`emit` 早已搬进 `server/sim/battle/hooks.js`——**被引的文件里两个方法都不再声明，第二个行号还超过了文件末尾**。
修法是 `HOOK_EVENTS` 已经在用的模式：一个**符号**（`HOOK_BUS`）加一个漂移守卫，读源码并要求符号仍在那里。

### gap 5 · 发行（§28.9）

四个面引用**同一个字符串**：

1. `welcome`（来自大厅的 `welcomeInfo()`）——服务器在跑什么；
2. `/healthz`——同一个摘要，给 bug 报告与客户端构建守卫；
3. BattleSpec——**这个战场**跑的是什么；
4. 房间/大厅 UI——「已加装」标记，以及客户端无法确认摘要时的拒绝。

**两个词汇决定**（现在便宜、以后贵）：
- **工坊包**（`workshop/<id>/`）与**内容包**（`packs/<id>/`）是**不同的东西**，却曾在两份文档里共用「pack」一词。
  mod 层在玩家可见文本里把自己的产物叫 **mod**，把「content pack」留给 `packs/` 注册表。
- 一个包的集合**对进程固定**，所以摘要只能在重启时变。这让房间列表成为展示它的正确位置，
  也让「服务器告诉我 X 然后跑了 Y」不可能发生。

---

## 4. 确定性验证（§28.6）——真正的执行机制

**golden 语料不能当这个检查**，理由写进了设计：它从官方 `data/*.json` 生成，
**故意忽略的正是包所添加的东西**。拿官方语料配着包跑再对比存档摘要，会**每一个内容包都失败**——那是设计使然。

所以验证是**对语料自己的场景生成器做差分运行**：

| 包声明 | 检查 | 何时失败 |
|---|---|---|
| `combat: false`（性能/重构 mod） | 同一进程跑两遍固定场景列表——一遍注入包的 kit map，一遍不注入——要求逐场景 `resultDigest` **相等** | 包改变了任何可观测结果。**这是「性能 mod 必须语义保持」的执行** |
| `combat: true` | 带包跑两遍固定场景列表，要求摘要相等，**加上**裁决保留的两条执行路径（服务端无头 vs 浏览器模块列表） | 包不确定，或两条路径不一致 |

**「谁跑它」——一条代码路径，三个调用者**：

1. **作者**，通过 `tools/workshop-validate.mjs` 作为第八层之外的**第九层**，返回编辑器与 AI 自纠环已经在消费的同一个
   `{ field, code, severity, message, hint }` 形状；
2. **服务器在装载时**，必须在 `applyWorkshop` 合并任何东西**之前**拒绝验证失败的包。
   「验证失败 ⇒ 包不加载」是业主的原话，而装载时是**唯一拒绝还很便宜的时刻**；
3. **CI**，跑仓库自己的夹具——CI 没有第三方包，所以这是对**验证器本身**的回归检查，不是对谁家 mod 的审查。

**代价是一个决定，不是意外**：完整语料是 151 场战斗 / 约 20 秒（四线程）；单包检查跑约六个固定场景，
**打印它用了哪份列表**，两条臂在同一进程里跑。理由很实在：一个验证起来很贵的包，就是作者**会更少去跑验证器**的包——
那才是要防的失败模式，而不是那点开销。

拒绝文案长这样：

```
pack "abyss": roster/chess_char_3_18_a diverged from vanilla at game s 42.3 (tick 1269): perPlayer.P2.coins 12 → 13
```

**说清是哪一场、哪一个 tick**——harness 记录第一个不同的 **tick**（语料算逐 tick 状态，只是今天不存）。

---

## 5. 表面守卫：双向闭合（§28.21）

**诚实的那一半先说**：这一层里**没有任何东西能阻止引擎重写**。`server/lobby.js`、`server/match/*`、
`public/js/screens/*` 都是普通引擎文件，一次移植就会替换它们。

**重写做不到的是「悄悄成功」**：包面对的契约被枚举在一张机读表（`shared/modSurface.js MOD_SURFACE`）里，
每一行锚定到一个**真实导出符号**，`test/modSurface.test.js` 断言每一行——符号在、成员在、实现文件在、
钉死它的测试文件在、设计稿那一节还在、`docs/MOD-SURFACE.md` 那一行还在。

**清单在两个方向都是闭合的**。另一个方向才是通常腐烂的那个：**加一格表面**。守卫同时要求
`shared/workshop.js` 里**每一个**「包可声明的名单」（`PACK_FIELDS`、`WORKSHOP_CONTENT_FILES`、
`CLIENT_PANEL_SLOTS`、`SERVER_MEMBERS`……）都被某一行引用。所以一个新声明**不可能**在没有行、没有文档锚点、
没有测试的情况下落地——这是这个文件一年后还成立**唯一**的办法。

**世代，不是发行版**：表属于一个 ABI **世代**（`MOD_API_VERSION`）。

| 变化 | 世代 | 为什么 |
|---|---|---|
| **加**一格表面 | **不动** | 对每个已发布的包都是纯增量；抬数字会拒绝所有写了 `api: "1.x"` 的老包——**那是在惩罚做对了的包** |
| **删 / 改名 / 改语义** | **动**，附迁移说明 | 按旧形状写的包无法被证明仍然安全；`MOD_SURFACE_FROZEN` 记录每个世代的 id，**不抬世代就删 = 测试红** |

**账本规则是一个纯函数**（`surfaceLedgerIssues(ids, generation)`）——理由和其他一切一样：
**一个失败分支从没被执行过的守卫不是守卫**。测试喂它一个删掉一格的列表，要求消息点名那个 id、
并说明删除需要抬世代——所以**规则本身被测**，不只是今天的数据。

**协商已经存在，而且是响的**：这个 build 没实现的表面**不会被忽略**——
`pack.json` 的顶层键与 `server` 的成员都是**闭集**，所以包在装载期被**点名拒绝**
（`PACK_UNKNOWN_FIELD` / `SERVER_UNKNOWN_FIELD`），而一个 `api` 范围不含本 build 的 `layer: B` 包直接被拒。
表补的是作者需要的另一半：**哪一代带哪一格，以及那一格还要求什么**。

### 5.1 刻意**不是**表面的东西

写在这里，因为「不做什么」同样是设计：

- **协议类型**：包不能发明 S2C/C2S 类型。包自己的通道走 `pack.msg`，类型名由引擎定。
- **就地改动引擎文件**：`shared/protocol.js`、`shared/constants.js`、`server/lobby.js` 这类补丁式分发产物
  不是表面，是**发行工件**（社区 mod 的 `*.patch`）。要它们的**效果**，就得先在设计稿里把它变成一格表面。
- **产品功能**：野排匹配、房间保留、**房内聊天与快捷短语**都是**产品功能**，与 mod 层无关——
  它们由引擎自己实现，不开放给包，也不要求任何声明。
- **改对局结果而不声明 `combat: true`**：硬闸门。成绩必须可复算。
- **文件系统与网络**：包内的服务端代码拿不到 `fs`、`path`、`process`、`require`、`eval`。

---

## 6. 实现规模（实测）

| 文件 | 行数 | 作用 |
|---|---:|---|
| `shared/workshop.js` | 3,744 | 清单/内容形状校验与叠加合并（**零执行**） |
| `shared/modSurface.js` | 424 | 表面表 + 冻结账本 |
| `shared/modIdentity.js` | 210 | canonicalJson + 手写 sha256（浏览器安全） |
| `server/workshop.js` | 1,389 | 装载 + **执行**（`await import()`） |
| `server/roomPack.js` | 365 | 房间级钩子装载 |
| `server/modModules.js` | 287 | 服务端模块载荷 |
| `server/modCatalog.js` | 274 | 客户端 mod 目录 |
| `server/modDispatch.js` | 173 | 分发前钩子总线 |
| `server/battlePack.js` | 128 | 战斗逻辑装载 |
| `server/packFiles.js` | 79 | **唯一**文件枚举器 |
| `server/http/mods.js` | 171 | 下载路由 |
| `tools/workshop-pack.mjs` | 1,017 | 打包/导入 |
| `tools/workshop-validate.mjs` | 782 | 八层作者侧校验器 |
| `docs/design/mod-layer.md` | 2,109 | 设计稿（§28） |
| `docs/WORKSHOP.md` | 2,232 | 作者文档 |
| `docs/MOD-SURFACE.md` | 122 | 表面清单（散文版） |
| **合计** | **≈ 13,955** | |

**注意**：发行包里**没有 `test/`**——Forge 的 release 把测试裁掉了。
所以 `shared/modSurface.js` 在发行包里是**死代码**（只有未随包发布的 `test/modSurface.test.js` 引用它）。

---

## 7. 与业主这棵树的对照

| | Forge | 业主 `Stronghold-Protocol-repo` |
|---|---|---|
| 包机制 | `workshop/<id>/` + `pack.json` | `packs/<id>/` + `pack.json`（**类型化**：`lang`/`data`/`assets`） |
| 类型表 | 一个统一 schema | `PACK_TYPES`（`shared/packs.js:62`），逐类型 `status/live/files` |
| `data` 类型 | 是 A 层的一格 | **已落地**（0.3.0，`shared/dataPacks.js`） |
| 身份摘要 | `modIdentity.js` + 包目录全部字节 | `dataPacks.js`：`digest` + `contentDigest` + `packsDigest` |
| 握手 | `welcome.mods` + `/healthz` + BattleSpec | `welcome.contentPacks` + `/healthz`（**BattleSpec 与 UI 标记仍未做**） |
| 房间级子集 | `roomAssets.js forRoom(modSet)` 真正物化 | `room.create.mods` + `dataFor(room)` + `filterData`（**内容 mod**，不是包） |
| 表面表 | `MOD_SURFACE`（424 行 + 守卫） | **不存在** |
| 执行面 | kits / meta / modules / battle / room / panels | **刻意不做** |

### 7.1 业主这棵树的政策原文（为什么执行面被排除）

业主自己的文档已经把这条线画死了，三处互相印证：

- `docs/MODS.md:124`：「**不执行第三方代码**：mod 是数据与注册表条目，不是插件脚本。」
- `docs/PACKS.md:200-202`：「**No third-party code.** The manifest and its files are data (JSON, images, audio, fonts);
  a pack type that runs code is a separate decision of the owner's. **This is why a data pack is only the files above:
  no kit script, no server hook, no client panel.** The Forge branch loads all of those; **we deliberately do not**.」
- `docs/PACKS.md:194-195`：「**Server-side only for gameplay.**」

**Forge 那边是业主后来单独做了那个决定**（设计稿 §28.1 原话：*the owner has now taken that separate decision*）。
所以这不是「Forge 做了、我们没做」，是**两条不同的路线**。

---

## 8. 如果业主想引入 Forge 的 mod 层，值得抄的四样

即便**完全不引入执行面**，这一层里有四样东西是**政策无关**的工程资产：

### 8.1 表面表 + 双向闭合守卫（最有价值）

业主这棵树现在**没有任何东西**阻止一次上游移植悄悄删掉包机制的一格。Forge 的解法可以原样搬：

1. 把「包能依赖的表面」写进一张机读表；
2. 每行锚定一个真实导出符号；
3. 守卫断言符号在、成员在、实现文件在、测试在、设计稿在；
4. **反方向**：`PACK_TYPES` 等每一个「包可声明的名单」都必须被某行引用。

**这一样与「执不执行第三方代码」完全无关**，而且业主这棵树**已经有 `PACK_TYPES` 与 `DATA_ROLES`**
（`shared/packs.js:62`、`shared/dataPacks.js:27`）——正好是被引用的锚点。

### 8.2 唯一枚举器（`packFiles.js` 的纪律）

「包有哪些文件」**只能有一个函数**。业主这棵树走的是「只哈希清单点名的文件」（
[工坊包数据层移植评估.md](工坊包数据层移植评估.md) §9.3 第 3 条已记录这是一次**有意偏离**），
这在**不执行包代码**的前提下是安全的。但那条评估也指出：**一旦引入执行面，这条偏离就必须收回**——
因为「被声明模块 import 的文件」不在清单里，客户端就不会下它。

### 8.3 冲突归因（`definedBy`）

业主这棵树的数据包冲突处理**已经等价**（`PACK_ID_COLLISION` / `OFFICIAL_ID_COLLISION` /
`UNKNOWN_OVERRIDE_FIELD`，见评估 §9.4）。Forge 多给的是**文案纪律**：
错误必须能回答「谁持有它」，否则作者的下一步是去打开一个**根本没有那条记录**的文件。

### 8.4 三档版本判定（refuse / degrade / warn）

业主这棵树有 `appVersionMatches`（`shared/packs.js:123`）与 `compatible: false` 的既有语义。
Forge 把「差异能做什么」写成了判定表：**改对局结果的**拒绝、**只加内容的**降级、**其他**警告。
这套分级对业主的 `data` 类型同样成立（`game` 范围不含已装版本 ⇒ 降级到逐记录校验）。

---

## 9. 结论

1. **Forge 的 mod 层是一套 ABI，不是一个加载器。** 它的核心不是 `import()`，是那张**可断言、双向闭合**的表面表。
2. **它的三层裁决是能力分级**：A 内容 / B 服务端 / C 客户端，判据是「能不能改对局结果」。
   `combat: true` 是那道硬闸门，而 `server.room` 只读观察面**不要求**它——这是**能力而非意图**的判据。
3. **它的执行机制是差分验证，不是 golden。** golden 从官方数据生成、故意忽略包添加的东西，
   所以拿它配包跑会**每个包都失败**。真正管用的是「固定场景列表跑两遍、比 `resultDigest`」。
4. **它最诚实的一句话**：没有任何东西能阻止引擎重写；能做的是让重写**无法悄悄成功**。
5. **与业主这棵树的关系**：业主的 `docs/PACKS.md:200-202` **明文拒绝**执行面，而 Forge 是业主后来单独做的决定。
   两条路线都自洽。但 **§8.1 的表面表与守卫**是政策无关的，且业主已经有现成的锚点——
   **那是这一层里唯一值得、也应该立刻抄的一样。**
