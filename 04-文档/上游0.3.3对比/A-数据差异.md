# A — 数据层差异：我方 `app/data/*.json` vs 上游 0.3.3 `data/` 与 `data/versions/*`

> 比对对象
> - 我方（fork，下文记「我方」）：`Stronghold-Protocol-Forge-协议源石版/app`（package.json 0.19.36 / release `0.19.33-0.3.0` / `UPSTREAM_VERSION='0.3.0'`）。下文路径一律从我方 app 根写起，如 `app/data/chess.json`。
> - 上游（只读）：`C:/Users/hhyyl/Downloads/Stronghold-Protocol-Forge-0.21.0-0.3.3/...`（package.json 0.21.0，跟踪官方 0.3.3）。下文记 `上游:<路径>`。
> - 我方 `data/*.json` 全是**单行压缩 JSON**，无法给行号，条目一律以实体键定位（如 `chess.json → chess_char_5_15_a`）；上游文档/脚本给行号。

---

## §0 一句话结论 + 上游 data 布局语义（决定基线）

**一句话**：上游 0.3.1 → 0.3.3 对「默认版本」的数据**几乎没有数值改动**——可以「整条搬」的新实体是 **0 条**；数据层的真实收获只有 **5 类新字段 + 1 张新表 + 2 处数值**，加上 `data/versions/` 那 14.3 MB 的**官方历史季快照**（它属于 0.3.2 的「版本机制」，不是新内容）。所以数据层不是本次升级的主菜，**结构（新字段）与版本机制才是**。

### 0.1 上游 `data/` 与 `data/versions/*` 各是什么

| 路径 | 大小 / 文件数 | 是什么 | 证据 |
|---|---|---|---|
| `上游:data/*.json` | 9.11 MB / 19 个 | **默认版本 = 第二期下半（`act2autochess` V2_2）**，不是「共享层」 | `上游:docs/DATA.md:799-800`（`DEFAULT_VERSION = 'act2autochess'`，data/rooms/logs 不带版本号即此版）、`上游:docs/DATA.md:804`（表里 `act2autochess` → data 目录写作 `data/` (unchanged)） |
| `上游:data/versions/act1autochess/` | 4.62 MB / 16 个 | 第一期下半（官方 `act1autochess` 最终子版 V1_2） | `上游:docs/DATA.md:806` |
| `上游:data/versions/act1autochess-v1_1/` | 4.53 MB / 16 个 | 第一期上半 V1_1（含 11-18 热修） | `上游:docs/DATA.md:807`、`:832`、`:835-847` |
| `上游:data/versions/act2autochess-v2_1/` | 5.14 MB / 16 个 | 第二期上半 V2_1 | `上游:docs/DATA.md:805`、`:833` |

- 三个版本目录由 `node tools/build-data.mjs --version <slug>` 生成（`上游:docs/DATA.md:19`），每个目录**只有 16 个文件**：没有 `assets.json`、`i18n/`、`support.json`；每个版本的 `config.json` 多一个 `version` 门闩键（实测：`{"id":"act1autochess","family":"covenant","rules":{...}}`，`act2autochess@V2_1` 的 `rules` 是空对象）。
- 版本注册表不在数据里，在代码里：`DEFAULT_VERSION` 是**代码常量、不是服务器设置**（`上游:docs/DATA.md:799`）；目录名用 slug 而不是 `@id`（`:816-818`）。
- 语义要点：**`data/` 不是四版共享层，三个 versions 也不是「以后的内容」**，它们是**同一活动三个更早的时间切片**（2025-11-14 / 2025-11-25 / 2026-03-14），时间上全部早于默认版本（2026-03-27 起）。

### 0.2 基线选定：用 `上游:data/`（默认版本）

实测「我方文件 vs 各候选基线」的**逐字节相同实体数**（我写脚本全量比对，见 §0.4 方法）：

| 文件 | vs `上游:data/` | vs `versions/act1autochess` | vs `versions/act2autochess-v2_1` |
|---|---|---|---|
| items | **115 / 115 全同** | 0 / 89 | 0 / 115 |
| garrisons | **249 / 249 全同** | 43 / 174 | 169 / 229 |
| stages | **13 / 13 全同** | 2 / 9 | 6 / 13 |
| waves | **38 / 38 全同**（我方另加 9） | 2 / 36 | 5 / 38 |
| effects | **361 / 361 全同**（我方另加 13） | 157 / 281 | 350 / 361 |
| tuning / bands / support / emotes | **全同**（bands 我方另加 3） | — | — |
| chess | 245 / 266 | 2 / 200 | 15 / 240 |

同时 `config.json → season` 两边都是 `act2autochess`（我方 `app/data/config.json`，单行；上游同）。**结论：我方 data 是 0.3.0 的「第二期下半」底，上游 `data/` 是同一底的最新版 → 用它做基线；`versions/` 与我方完全不是同一支数据，不能当基线。**

### 0.3 我方 data 是「生成物」，不是手写物（决定「怎么搬」）

| 事实 | 证据 |
|---|---|
| 我方 data 由**被我方魔改过的** `build-data` 生成 | `app/tools/build-data.mjs` 5058 行 / 322 KB；`上游:tools/build-data.mjs` 3405 行 / 221 KB |
| 我方独有构建表：自建效果 / 自建装备 / 自建策略 / 波次追加 | `app/tools/build-data.mjs:1923`（`CUSTOM_EFFECTS`）、`:2262`（`CUSTOM_ITEMS`）、`:2530`（`CUSTOM_BANDS`）、`:3779`（`attachWaveEnemies`） |
| 我方有「重建 data 并与改动前逐字节对照」的既有规程 | `app/CHANGELOG.md:209-221`（`node tools/build-data.mjs --offline` 比对，只有 enemies/factions 变） |
| 我方甚至有「build-data 跑不起来时就地补条目、并断言能逐字节复现」的先例 | `app/CHANGELOG.md:1289` |

**因此：任何「搬数据」都要落成对 `app/tools/build-data.mjs` 的改动再重建，禁止整文件覆盖 `app/data/*.json`** —— 否则 11 件自建装备、4 个自建首领、205 个 `{fork:true}` 特训池位会被抹平（§4）。

### 0.4 口径：没有 0.3.0 原件，所以用「三重判据」做双向标注

我方的 `app/data` 只被提交过一次（`git log -- Stronghold-Protocol-Forge-协议源石版/app/data/chess.json` → 只有 `31900e3`「把协议源石版源码树纳入仓库」），仓库里**没有**任何中立基线（0.3.0 原样文件；`data/i18n` 虽是官方文本但两边 sha1 相同 ⇒ 无法区分方向）。所以差异方向不用「单边 diff」判，而用三条证据：

1. **上游 build-data 有构建函数、我方 build-data 没有** ⇒ 上游新增（例：`handbookLevels` `上游:tools/build-data.mjs:2260/2335`；`dailyMission` `:2888-2899`；`milestones` `:3093-3094`）。
2. **我方 build-data 里有注释/自建表** ⇒ 我方改动（例：`itemPoolCopies: null` 有业主注释，`app/tools/build-data.mjs:4713-4717`：「现在整份设成 null = 不限…要恢复官方：把这两行换回 `{1:4,2:6,3:7,4:8,5:7,6:3}`」）。
3. **我方自有前缀/标记** ⇒ 我方内容（`custom_*`、`forkbounty_*`、`chess_item_9_9x_*`、`band_admin*`、`{fork:true}`）。

单条判不准的一律标 **[待复核]**，不硬下结论。比对脚本为临时脚本（`04-文档/上游0.3.3对比/_tmp/diff2.cjs`，逐实体 + 深层字段 + 数组按 id 对齐），用完已删。

---

## §1 总览表

「仅我方有 / 仅上游有 / 不同」= 顶层实体键口径；`不同` 里再细分是否只是**新增字段**。

| 数据文件 | 我方实体 | 上游实体 | 仅我方 | 仅上游 | 不同 | 其中只是「新增字段」 | 我方 MB | 上游 MB | 判定 |
|---|---|---|---|---|---|---|---|---|---|
| `chess.json`（干员） | 270 | 266 | 4 | 0 | 21 | **21/21** | 1.83 | 1.79 | 零数值差异，全是上游新字段 |
| `items.json` | 126 | 115 | 11 | 0 | **0** | — | 0.18 | 0.16 | 官方 115 条逐字节相同 |
| `enemies.json` | 318 | 249 | 69 | 0 | 2 | 0（2 处数值） | 0.49 | 0.39 | 官方 249 条里 2 个实体有数值差 |
| `bosses.json` | 14 | 10 | 4 | 0 | 0 | — | 0.02 | 0.02 | 官方 10 条全同 |
| `stages.json` | 13 | 13 | 0 | 0 | **0** | — | 0.25 | 0.25 | 全同 |
| `waves.json` | 47 | 38 | 9 | 0 | **0** | — | 0.17 | 0.13 | 官方 38 条全同 |
| `choices.json` | 9 | 9 | 0 | 0 | 2 | — | 0.13 | 0.12 | 仅我方往池里加卡 |
| `bonds.json` | 23 | 23 | 0 | 0 | 2 | — | 0.08 | 0.08 | 仅我方往成员表加人 |
| `effects.json` | 374 | 361 | 13 | 0 | **0** | — | 0.25 | 0.24 | 官方 361 条全同 |
| `tuning.json` | 3 | 3 | 0 | 0 | **0** | — | ~0 | ~0 | 全同 |
| `garrisons.json` | 249 | 249 | 0 | 0 | **0** | — | 0.14 | 0.14 | 全同（我方从未碰过） |
| `config.json` | 23 | 23 | 0 | 0 | 3 | 1（`rewards` 少 2 键） | 0.06 | 0.06 | `modes` 我方改，`economy/rewards` 上游扩 |
| `bands.json` | 43 | 40 | 3 | 0 | 0 | — | 0.04 | 0.03 | 官方 40 条全同 |
| `backups.json` | 3 | 3 | 0 | 0 | 2 | 19 处新字段 + 3 处数值 + 1 数组长 | 1.96 | 1.96 | 上游新字段（+ 我方 diy 排除表 `diy.excluded` 5 vs 7） |
| `tokens.json` | 24 | 22 | 2 | 0 | 0 | — | 0.14 | 0.13 | 官方 22 条全同 |
| `factions.json`（特训敌人池） | 4 | 5 | 0 | 1（`handbookLevels`） | 2 | +205 我方池位 | 0.03 | 0.02 | 上游新表 + 我方池位/说明 |
| `support.json` | 7 | 7 | 0 | 0 | 0 | — | ~0 | ~0 | 全同 |
| `assets.json`（素材索引） | 17 | 17 | 0 | 0 | 9 | 音效改「按池引用」 | **1.32** | **3.58** | 最大结构差异，见 §2.2/§5 |
| `emotes.json` | 6 | 6 | 0 | 0 | 0 | — | 0.01 | 0.01 | 全同 |
| `i18n/{en,ja,ko,zh-TW}.json` | — | — | — | — | **0** | — | 11.80 | 11.80 | **四个语言包 sha1 完全相同** |

**文件级增减**

| 差异 | 文件 | 说明 |
|---|---|---|
| 仅我方有 | `app/data/hextech.json`(48 KB)、`app/data/local-assets.json`(195 KB)、`app/data/local-fx.json`(1.2 MB) | 上游这两个「本机素材提取」产物**在 .gitignore 里、发布包不带**（`上游:CHANGELOG.md:858-859` 明确「两者都在 .gitignore 里」）；`hextech` 是我方自建 |
| 仅上游有 | `上游:data/versions/`（3 目录 × 16 文件，14.29 MB） | 0.3.2 新增，我方没有对应目录 |

---

## §2 官方侧改动清单（能确定是上游改的）

### 2.1 数值改动：**只有 2 处**（这是本节最硬的结论）

| 实体 | 字段 | 0.3.0（我方现值） | 0.3.3（上游） | 影响 | 证据 |
|---|---|---|---|---|---|
| `enemy_1305_mhslim`（灼热源石虫） | `attackAnim.dur` | `1` | `0.767` | 出手动作时长（秒）；sim 读它决定攻击动作窗口 | 上游 0.3.2 重做过敌人攻击槽表：`上游:docs/history/0.3.2.md:2256-2257`、`:4179`（`test/content/enemy-attack-slot.test.js` 拿表对 `data/enemies.json`） |
| `enemy_1305_mhslim` | `attackAnim.hit` | `0.667` | `0.333` | 命中判定在动作内的相对时刻 | 同上 |
| `enemy_1305_mhslim_2` | `attackAnim.dur` / `.hit` | `1` / `0.667` | `0.767` / `0.333` | 同上（同族） | 同上 |
| `backups.json → units.char_4231_clemnt`（克莱门莎）forms `2/1/4/0`、`2/60/7/1`、`2/60/7/3` | `skills["与海为敌"].bb.projectile_life_time` | `3.5` | `5` | 弹道存活时间（秒）；影响该技能的覆盖/延迟判定 | 我方 `CHANGELOG.md` 与 `docs/research/` 里**没有任何**针对克莱门莎/与海为敌的平衡记录（grep 仅命中插件名 `clemnt-addition`，`app/CHANGELOG.md:1161`）⇒ 倾向「上游改的」，但仍标 **[待复核]**（需 C/D 报告交叉） |

**除以上 4 条外，`data/*.json` 里没有任何官方数值被改动**：`chess` 21 个实体的 27 处差异**全部是布尔字段新增**（`upOnlyField`，零 `value`）；`items`/`effects`/`garrisons`/`stages`/`waves`/`tuning`/`bands`/`tokens`/`emotes`/`support` 的官方条目**逐字节相同**。

> 与上游 CHANGELOG 的互证：0.3.1「215 提交 / 537 文件」、0.3.2「491 提交 / 915 文件」、0.3.3「6 提交 / 38 文件」（`上游:CHANGELOG.md:14-15`、`:47`、`:180`），但这些提交的落点几乎都在 `server/`、`public/js/`、`public/assets/`、`tools/`，**不在 `data/*.json` 的数值上**；0.3.3 那节直接写明「只改行为、不改数据规模 …… `build-data` 依旧零差异」（`上游:CHANGELOG.md:14-15`）。

### 2.2 新增字段 / 新表（结构改动，本报告的重点）

| # | 新东西 | 位置 / 条数 | 引入版本 | 证据 | 我方现状 |
|---|---|---|---|---|---|
| 1 | `placeOnRanged: true`（近战干员可放远程位） | `chess.json` 6 个干员：`chess_char_2_03_a/_b`、`3_07_a/_b`、`4_12_a/_b`；`backups.json` 温蒂的 3 个形态 | **0.3.1** | `上游:docs/history/0.3.1.md:719-720`（「build-data sets `placeOnRanged: true` from that Chinese trait without a module … 温蒂's three」） | 无此字段 |
| 2 | `trait.rangeExpand: true`（攻击范围扩大） | `chess.json` 5 个干员的 `trait`（`4_08_b`、`4_14_b`、`4_21_b`、`5_12_b`、`5_16_b`） | **0.3.1** | `上游:docs/history/0.3.1.md:758` | 无此字段 |
| 3 | `modules[].traitOverride.rangeExpand` | `chess.json` 6 处模组（资深万国信使定制斗篷 / 多彩盐漠生活 / 传承与开拓 / 医疗环境分析装置 ×2 / 无题长卷）+ `backups.json`（19 处新字段的整体分布见下一行） | **0.3.1** | 同上；上游 `CHANGELOG.md:231`（派生模组补 `modeOnly`/`rangeExpand`） | 无此字段 |
| 4 | `modules[].traitOverride.modeOnly` | `chess.json` 8 处（琳琅诗怀雅/空弦/水月/灵知/夕/归溟幽灵鲨/安洁莉娜/迷迭香 各特限证章）+ `backups.json` 多处 | **0.3.1** | `上游:docs/history/0.3.1.md:758` | 无此字段 |
| 5 | `skills[].passiveRange: true`（被动改攻击范围） | `chess_char_5_15_a/_b → skills["“我的海疆”"]` | **0.3.1** | 同上（`0.3.2.md:4932` 有对应用法说明：`attackRangeGrid` 只对 `passiveRange` 或「被动效果：攻击范围扩大」替换网格） | 无此字段 |
| 6 | `config.rewards.milestones`（功勋 60 级表，累计卫戍认证） | `config.json → rewards.milestones`（60 项） | 0.3.1/0.3.2（上游 0.3.2 文档点名） | `上游:docs/history/0.3.2.md:1893-1896`（「`config.rewards.milestones`（the settlement's LV strip）」）；构建函数 `上游:tools/build-data.mjs:3093-3094`；我方 build-data **没有**此函数 | **整键缺失** |
| 7 | `config.rewards.daily`（每日防卫目标：200 → +300，04:00 重置） | `config.json → rewards.daily` | 同上 | 构建函数 `上游:tools/build-data.mjs:2888-2899`（`dailyMission`，从 `constData.dailyMission*` 读）；`上游:docs/DATA.md:146` | **整键缺失** |
| 8 | `factions.handbookLevels`（图鉴 10 档 `E/D/C/B/B+/A/A+/S/S+/SS` 的属性区间表） | `factions.json → handbookLevels`（实测 10 档：`maxHp/atk/def/res/moveSpeed/interval/elementRes/elementDmgRes` 各带 `[min,max)`） | 0.3.1–0.3.3 之间 **[待复核具体版本]** | 构建函数 `上游:tools/build-data.mjs:2260-2335`（读 `enemy_handbook_table.levelInfoList`）；我方 build-data 无 | **整键缺失** |
| 9 | `economy.itemPoolCopies` / `itemPoolCopiesOverrides` 变成实测表 | `{1:4,2:6,3:7,4:8,5:7,6:3}` + 8 条例外（如 `chess_item_4_01_e_a:7`） | 上游为官方值 | 语义见 `上游:docs/DATA.md:120`（共享商店装备归属，DESIGN §31.8） | **我方主动设 `null`（= 不限）**，见 `app/tools/build-data.mjs:4713-4717` |
| 10 | `assets.audio.sfx.pools`（音效改「按池引用」，1013 个池）+ 单位条目改记 `pools/attackPools` | `assets.json`：上游 `audio.sfx` 多一个 `pools` 段；单位条目形如 `{"attack":"...mp3","pools":{"attack":"battle.ON_ABILITY_ON.char_x.attack"}}` | **0.3.1**（#680） | `上游:CHANGELOG.md:194-195`（「攻击/受击音效改成按池引用 … 941 个池、484 个单位」；0.3.3 实测 1013 池） | 我方仍是「每个单位写死路径」的 0.3.0 形状（`app/data/assets.json`，单行） |
| 11 | `factions.generation.notes` 第 6 条（我方加的） | 见 §4 | 我方 | — | 我方已有 |

### 2.3 「没有变」的部分（列出来，防止把历史差异误当新改动）

- `data/i18n/{en,ja,ko,zh-TW}.json`：**四个语言包与我方 sha1 完全相同**（en `5f387ed19578`、ja `ef4215093eb8`、ko `2d38df76a1df`、zh-TW `cdb1685c726b`，各 2.4–3.5 MB）。⇒ 官方**文本层** 0.3.0→0.3.3 一字未动。（也意味着我方自建内容从来没有进过 `data/i18n`：`chess_item_9_90_e_a` 在 `en.json` 里 0 命中。）
- `tuning.json`(3 键)、`support.json`(7 键)、`emotes.json`(6 键)、`garrisons.json`(249 条)、`stages.json`(13 条)、`waves.json`(官方 38 条)、`items.json`(官方 115 条)、`effects.json`(官方 361 条)、`bands.json`(官方 40 条)、`tokens.json`(官方 22 条)、`bosses.json`(官方 10 条)：逐字节相同。
- `chess.json` 官方 266 条里 245 条逐字节相同、21 条差异全是新布尔字段 —— **没有一条官方干员数值被上游改动**。
- 上游 `assets.json` 与素材体量差异（8441 文件/1.32 MB → 16956 文件/3.58 MB、`chars` 213→229）属于 0.3.2 的「四个版本花名册并集」**表现层扩张**（`上游:docs/DATA.md:779-782`），不是数值数据改动。

---

## §3 仅上游有的实体（可整条搬的）

### 3.1 默认版本（第二期下半）：**0 条**

逐文件核对，`onlyUp` 只有一处：`factions.json → handbookLevels`（是**新键/新表**，不是新实体，见 §2.2 #8）。`chess / items / enemies / bosses / stages / waves / bonds / effects / bands / tokens / garrisons` 的「仅上游有」**全部为空**。
⇒ **本次升级没有「新干员 / 新敌人 / 新道具 / 新关卡 / 新事件」可以整条搬。** 老板想要的「拿来用的」，在数据层的默认版本里就是不存在的。

### 3.2 三个历史版本快照里「我方没有」的实体（第一期专属，共 46 条 + 1 键）

这些只存在于 `data/versions/act1autochess{,-v1_1}/`（两个目录的集合相同），**默认版本里没有，我方也没有**：

| 类别 | 条数 | 键 | 名称 | 说明 |
|---|---|---|---|---|
| 道具 | 6 | `chess_item_2_08_e_a/_b`、`2_09_e_a/_b`、`2_10_e_a/_b` | 有限加速器 / 激光发射器 / 蜂鸣器 | 第一期商店装备（第二期换成别的 id） |
| 敌人 | 6 | `enemy_1201_sfzhi`、`enemy_1249_lysdb`、`enemy_1254_lypa`、`enemy_1275_dwlock`、`enemy_1373_ltnhor_2`、`enemy_1376_ltndru` | 墨浪 / 莱茵生命防卫科成员 / 实验用动力装甲 / 萨卡兹王庭军术师 / 巫王乐团圆号手 / 残党乐团鼓手 | 第一期专属敌人 |
| 干员部署体 | 30 | `garrison_{17,20,27,33,36,44,45,52,58,66,74,83,87,88,97}_{a,b}` | — | 第一期「干员特训」条目（带 `desc/descRaw/effectKey/battleRuneKey`） |
| 策略 | 1 | `band_zumama` | 森蚺 | 第一期策略（`totalHp:38`, `effectId:aceffect_band_43`） |
| 召唤物 | 3 | `token_10029_slent2_protrb`、`token_10032_jesca2_jckshd`、`token_10043_necras_skeltn` | 夜灯 / 机动盾牌 / 悲叹的仆役 | 第一期召唤物 |
| 配置键 | 1 | `config.version` | — | 版本门闩（`上游:docs/history/0.3.2.md:1970`「`config.version` is the gate」） |

**注意**：这 46 条实体**只有在第一期规则下才有意义**（上半的盟约激活条件、商店 5–6 级装备位、上半 garrison 池、`adapter: bondActiveType / launchModes / launchMilestones` —— `上游:docs/DATA.md:856-869`）。单独抄实体不抄机制 = 悬空数据（§5 表第 7 项）。

---

## §4 仅我方有的实体（自有内容，别被上游覆盖）

| 文件 | 数量 | 键 / 名称 | 我方证据 |
|---|---|---|---|
| `chess.json` | 4 | `chess_char_6_21_a/_b` 结城理、`chess_char_6_22_a/_b` 丰川祥子 | 键不在上游任何版本 |
| `items.json` | 11 | `chess_item_9_90_e_a` 幽魂、`9_91` 恶魔之契、`9_92` 残光、`9_93` 加护、`9_94` 万物归虚、`9_95_e_a/_b` 尸山/尸山·极、`9_96` 心之钢、`9_97` 百变、`9_98` 骑士徽章、`9_99` 不屈余烬 | 由 `CUSTOM_ITEMS` 生成，`app/tools/build-data.mjs:2262`；`app/CHANGELOG.md:420,1238,1288` |
| `effects.json` | 13 | `eff_item_{ghost,demon,canlight,ward,void,corpsehill,heartsteel,versatile,knightbadge,indomember}`、`aceffect_band_admin{,2,3}` | `CUSTOM_EFFECTS`，`app/tools/build-data.mjs:1923` |
| `bands.json` | 3 | `band_admin` / `band_admin2` / `band_admin3` 管理员 | `CUSTOM_BANDS`，`app/tools/build-data.mjs:2530`、断言在 `:4902` |
| `bosses.json` | 4 | `boss_11`「不死的黑蛇」、`boss_12` 梅菲斯特、`boss_13` 伤心的大锁、`boss_14` 曼弗雷德 | `customBossDefs`；`app/CHANGELOG.md:931` |
| `waves.json` | 9 | `custom_boss_11..14` 各含 `_s` 单排版、`custom_dummy` | 同上；`custom_dummy` 是「第 16 轮木桩」用 |
| `tokens.json` | 2 | `token_makoto_orpheus` 俄耳甫斯、`token_makoto_thanatos` 塔纳托斯 | 键不在上游任何版本 |
| `choices.json` | 14 张卡 | `forkbounty_1..14`（爆破攻坚手组长 / 倾轧者 / 水手重艇 / 「方便快餐」/「红标」根除者 / 赏金猎人「大骑士」/ 优雅刀技厨师 / 剧场组装体 / 搏命养家者 / 爱国者 / 狂躁异质裂兽 / 迷路的巨像 / 撼地遗众 /「交通亭」量产型）；`bounty` 池 143 vs 上游 129；`bountyDrafts.boss.groups` 7 vs 6 | `effectId` 前缀 `forkbounty_` |
| `enemies.json` | 69 | 5 条被自建波次直接使用：`enemy_1507_mephi` 梅菲斯特、`1515_bsnake`「不死的黑蛇」、`1528_manfri` 曼弗雷德、`2018_csdoll` 伤心的大锁、`9901_dummy` 木桩；其余 64 条是官方图鉴敌人（`enemy_1004_mslime` 酸液源石虫…），**上游三个版本一个都不收**，我方 build 收了并把它们塞进特训池 | `attachWaveEnemies`，`app/tools/build-data.mjs:3779`；`app/CHANGELOG.md:843`（「追加到特训条目的 N/E 池尾部，官方 key 恒在 [0]，同类同档、强度带 [0.85,1.25]」） |
| `factions.json` | 205 个池位 + 1 条说明 | `entries[*].{N,E,...}` 里 205 处 `{"key":"enemy_xxx","fork":true}`；`generation.notes` 第 6 条（fork wave enemies 的追加规则） | 同上 `app/CHANGELOG.md:843` |
| `bonds.json` | 2 实体 | `lateranoShip`（members 12 vs 11、visibleMembers 11 vs 10）、`miraShip`（12 vs 11、9 vs 8）里多了 `chess_char_6_21_a`、`6_22_a` | 自建干员进盟约成员表 |
| `config.json` | `modes` | 8 个正式模式各加 `bossWeights.boss_11..14 = 4` + `rounds.{9,14}.bossTemplates.boss_11..14`（`custom_boss_1x[_s]`）；6 个模式（single/multi × normal/hard/abyss）加 `dummyRound: 16` + `rounds["16"]`（`custom_dummy`，60 秒）+ `combatTimeLimit["16"]` + `enemyScale["16"]` | `app/data/config.json` 单行；训练模式未改 |
| 独有文件 | 3 | `hextech.json`(48 KB)、`local-assets.json`(195 KB)、`local-fx.json`(1.2 MB) | 后两个上游也生成但**.gitignore、发布包不带**（`上游:CHANGELOG.md:858-859`） |

**风险提示**：`bonds.json`、`config.json`、`factions.json`、`choices.json` 这 4 个文件是「官方骨架 + 我方增量」混在一起的，**最容易被「上游整份覆盖」这种操作毁掉**；`app/data/config.json` 的 `modes` 尤其（丢了 `boss_11..14` 与第 16 轮，4 个自建首领与木桩轮直接进不去）。

---

## §5 建议（哪些能「只搬数据不搬架构」，哪些必须先有 0.3.2 的版本机制）

| # | 项 | 只搬数据够吗 | 代价 | 前置 | 做法 / 说明 |
|---|---|---|---|---|---|
| 1 | `enemy_1305_mhslim(_2)` 的 `attackAnim` 两处 | **够** | **S** | 无 | 两条纯数值，抄进我们 build 的产物即完事；不影响我方自建内容 |
| 2 | `rewards.milestones`（60 级功勋）+ `rewards.daily`（每日目标） | **够**（数据层） | **M** | 结算界面 LV 条 + 每日重置逻辑（上游在 `public/js/screens/settle.js`，我方同名屏需核） | 移植上游 `build-data.mjs:2888-2899`（`dailyMission`）与 `:3093-3094`（`milestones`），再重建 `config.json`；**只搬 JSON 不搬函数，下次重建就丢** |
| 3 | `factions.handbookLevels`（图鉴等级 E–S 区间） | **够**（纯展示/筛选数据） | **S** | 需我方有图鉴/图例 UI 真读它，否则是死数据 | 移植 `上游:tools/build-data.mjs:2260-2335` |
| 4 | 范围/部署五组布尔（`placeOnRanged`、`passiveRange`、`trait.rangeExpand`、`traitOverride.rangeExpand`、`traitOverride.modeOnly`） | **数据可先搬，行为要另配** | **S（数据）+ M（sim/UI）** | 上游在**同一个 0.3.1 版本**里同时改了 build-data、部署 overlay、`rangeRec`、预览 | 数据先搬**不会**改变现有行为（我方读不到就当 false），可作第一步；真正生效要接 `server/sim/` 的部署/范围判定（详见 B/D 报告）。**注意**：这一组是「干员能不能上高台/远程位、范围怎么扩」，属**玩家可感知的规则修复**，价值高于它的规模 |
| 5 | `clemnt` 的 `projectile_life_time` 3.5 → 5 | **够** | **S** | 需先确认方向（[待复核]） | 若确为上游还原官方值，抄；若是我方平衡改动，勿动 |
| 6 | `assets.audio.sfx.pools`（音效按池引用，1013 池）+ 上游那份 3.58 MB `assets.json` | **不够** | **L** | `tools/fetch-assets.mjs` 计划器 + 客户端音效加载器 + **素材本体**（上游 16956 文件 vs 我方 8441）同改 | **不建议搬**：收益是体积与复用，成本是整条素材链；我方也没有那批素材 |
| 7 | `data/versions/**` 三个历史快照（14.29 MB / 48 文件）+ `act1autochess` 那 46 条第一期专属实体 | **不够** | **L** | 必须先有 0.3.2 的版本机制：`shared/versions.js` 注册表、`server/data.js` 的 `versionDataDir/getVersionData`、每版 `i18n` 与 `cs` 哈希、客户端版本选择器与投票、`config.version.rules` 的读写（`上游:docs/history/0.3.2.md:1968-1976`、`上游:docs/DATA.md:790-834`） | 数据可以「先搬不用」（上游自己不 enable 就 404，`DATA.md:790`），但 14.29 MB 进包/进 Docker 有成本，且**我方 `data/` 本身是自建生成物、不是官方版**，接入第三方版本目录会让「默认版本」口径复杂化。**建议：本次不动，等 0.3.2 机制整体评估（C 报告）后再决定** |
| 8 | `itemPoolCopies` 官方表 | **够** | **S** | 无 | 我方是**故意**设 `null`（共享装备不限量，`app/tools/build-data.mjs:4713-4717` 有业主注释）。**建议保留我方口径**，只在报告里记账，不搬 |

### Top 5「拿来用」（按性价比）

1. **范围/部署五组布尔**（`placeOnRanged` / `passiveRange` / `rangeExpand` / `modeOnly`）— 数据 S + 行为 M，**唯一有玩家可感知规则收益的数据项**（温蒂能上高台、迷迭香/菲亚梅塔特限证章生效等）。
2. **`rewards.milestones` + `rewards.daily`**（功勋 60 级 + 每日防卫目标）— M，补上结算成长线与每日留存钩子，我方目前整键缺失。
3. **`factions.handbookLevels`**（图鉴等级区间）— S，补齐特训敌人的图鉴分级展示。
4. **`enemy_1305_mhslim(_2)` attackAnim + `clemnt` projectile_life_time** — S，四处纯数值，风险最低。
5. **`data/versions/**` 与第一期 46 条专属实体** — L，价值最高但门槛最高：**必须与 0.3.2 的版本机制一起做**，单独搬数据无意义。

### 一句话给老板

数据层这次**没有「新内容」，只有「新字段 + 一处数值修正 + 一大堆历史季快照」**；真正值得抄的是**那五组布尔背后的规则修复**（干员上高台/范围扩大/特限证章）与**功勋/每日两张缺失的表**，两者都可以「只搬数据」，但前者生效需要 sim/UI 配合。
