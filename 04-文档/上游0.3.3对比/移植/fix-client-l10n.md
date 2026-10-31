# fix-client-l10n · 本地化下的高台部署与攻击范围预览（上游 0.3.1 #676 / #700）

> 任务：**task-9**（原先给的 task-7 不存在，lead 改为 task-9）。
> 依据：`04-文档/上游0.3.3对比/B-0.3.1.md` §2.1 / §2.2、`A-数据差异.md` §3（上游 21 个棋实体 × 27 个新布尔 = 验收基准）；
> 上游 `docs/history/0.3.1.md` §36.9（:714-721）、§36.13.1（:753-760）。
> 改了的文件：`app/shared/highGround.js`、`app/shared/loadoutRecord.js`、`app/public/js/data.js`、`app/shared/standIn.js`（lead 批准的收尾一行），
> 新增 `app/test/shared/highGround-i18n.test.js`。**没动 `app/tools/build-data.mjs`、没动 `data/*.json`、没 commit。**

## 1. 病根（我方 + 上游同一处）

| # | 我方证据 | 现象 |
|---|---|---|
| #676 | `shared/highGround.js:30-31` 只匹配中文「可以放置于远程位」；客户端拿**本地化后**的棋表判（`public/js/data.js:296 applyFileOverlay` → `ui/gameLogic/placement.js:243 meleeOnHighGround`） | en/ja/ko/zh-TW 下 歌蕾蒂娅 / 崖心 / 见行者（普通+精锐）一律判「地面」；服务端读中文数据照收 ⇒ 客户端画不出合法格、服务端却接受（前后端不一致） |
| #700 | `shared/loadoutRecord.js:140 / :142 / :157-161` 三处正则跑在**译文**上 | 精锐莱恩哈特 SPC-X 预览少一格（10 → 9）；引星棘刺 S3「被动效果：攻击范围扩大」不生效（13 而不是 19）；空弦 ISW-A「集成战略」反而 +1 |

译文实测（`data/i18n/en.json`）：`trait.desc` → "Can be deployed on Ranged Tiles"、`moduleDesc` → "Attack Range expands"、
技能 desc → "Passive Effect: Attack Range increases"、ISW 模组的 `moduleDesc` → "In Integrated Strategies"。三处中文行都不在了。

## 2. 改了什么（零数据改动：旗标在**载入时**从原始记录派生，缓存到本地化记录上）

### 2.1 `app/shared/highGround.js`

| 位置 | 内容 |
|---|---|
| `:12-19` 头部注释 | #676 的来历、旗标是什么、为什么客户端要它、与上游同名字段的对齐说明 |
| `:34-42` `placeOnRangedOf(rec, position = rec.position)` | 中文读数（MELEE + `traitBase\|\|trait` 命中）。`position` 可外部给：**补位 form 自己没有 position**（在 unit 上） |
| `:44-58` `withPlaceOnRanged(rec, zh, position)` | 从 `zh`（本地化前的同一条记录）派生并把 `placeOnRanged: true` 挂到本地化记录**副本**上；不命中就原样返回（不复制） |
| `:60-73` `meleeOnHighGround` | **旗标优先、中文文本兜底**；非 `true` 一律落到文本（照上游 §36.13.1 的 `[ASSUMED]` 口径） |

### 2.2 `app/shared/loadoutRecord.js`

| 位置 | 内容 |
|---|---|
| `:10-18` 头部注释 | #700 的三处读数、旗标口径、「上游字段名」说明 |
| `:133-146` `skillCarriesOwnRange(sk)` | 「被动效果：攻击范围扩大」+ 非空 `rangeGrid`；`sk.passiveRange === true` 优先，其它值（含 `false`）落回文本 |
| `:148-158` `moduleWidensRange(trait)` | `trait.rangeExpand === true` 优先，否则 `moduleDesc` 命中「攻击范围扩大」 |
| `:160-187` `attackRangeGrid` | 原三处内联正则换成上面两个 helper（**与上游 0.3.3 的 `shared/loadoutRecord.js` 同形**） |
| `:189-203` `traitRangeExtend` | `trait.modeOnly === true` 与「集成战略」同权（本地化记录也能拒绝 +N） |
| `:205-270` `withRangeFlags(rec, zh)` | 派生并缓存 `passiveRange`（每个 skill + `skill` 指针）、`rangeExpand` / `modeOnly`（记录的 `trait` 与每个 `modules[].traitOverride`）。**只沿「会加布尔」的路径复制**，其它记录与 `value` 共享；zh 侧按 `index` / `uniEquipId` 对位 |

### 2.3 `app/public/js/data.js`

| 位置 | 内容 |
|---|---|
| `:30-35` 头部注释 | 为什么「读中文行的规则」不能在本地化记录上读 |
| `:50-51` | 引入 `withPlaceOnRanged` / `withRangeFlags` |
| `:296-312` `localizedEntry` | 生成某种语言的棋表时，把 `zh`（`e.value`，本地化前）的读数派生到 `value` 上：`withReadings(name, e.value, value)` |
| `:314-360` `withReadings(name, zh, value)` | `chess`：逐条 `withRangeFlags(withPlaceOnRanged(rec, base), base)`，只有变了的 id 才换（表按需浅拷贝）。`backups`（补位，DATA.md §18）：逐 unit × form 做同样的事，`position` 取 unit 的 |

### 2.4 `app/shared/standIn.js`（lead 批准的收尾，一行）

| 位置 | 内容 |
|---|---|
| `:104-109` `composeUnitRecord` | 补位记录把 form 的 `placeOnRanged` 带过来（`if (form.placeOnRanged === true) out.placeOnRanged = true;`，照上游 `shared/standIn.js:87` 的形状）—— 自选温蒂（读「可以放置于远程位」的补位 body）在 en 下也能上高台 |
| `:43-51` JSDoc | 补一句 `placeOnRanged` 的来源 |

**为什么这样不动中文**：`localizedEntry` 在 `locale === 'zh'`（或没有该文件的 overlay）时直接返回 null，中文永远走原始记录 + 文本匹配。
派生只发生在「某种语言的副本」上，而 `getRaw` / `lookupRaw` 仍是下载下来的那份（测试有断言钉住）。

## 3. 依据 / 验收基准

**上游 0.3.1 自己怎么存**：`data/chess.json` 里就是这四个布尔（`placeOnRanged` 顶层、`skill.passiveRange`、
`trait.rangeExpand` / `trait.modeOnly` 以及同样的键在 `modules[].traitOverride` 上），派生点在
`上游:server/plugins/officialUnitBuilder.js:465 / :786 / :797 / :529-533`、`上游:shared/chessAuthoring.js:494-495`。
我方**照抄字段名**（这样以后谁把派生搬进 build-data，读端一行都不用改），只把派生时机从「构建时」挪到「载入时」。

**21 实体 × 27 布尔逐条对齐**（脚本比对上游 `data/chess.json` 与我们的派生结果；测试里钉成常量表）：

```
chess_char_2_03_a 崖心            placeOnRanged
chess_char_2_03_b 崖心            placeOnRanged
chess_char_3_04_b 琳琅诗怀雅      module:uniequip_004_swire2:modeOnly
chess_char_3_07_a 见行者          placeOnRanged
chess_char_3_07_b 见行者          placeOnRanged
chess_char_3_21_b 空弦            module:uniequip_004_archet:modeOnly
chess_char_4_02_b 莫斯提马        module:uniequip_003_mostma:rangeExpand
chess_char_4_08_b 瑰盐            module:uniequip_002_rosesa:rangeExpand, trait:rangeExpand
chess_char_4_09_b 水月            module:uniequip_004_mizuki:modeOnly
chess_char_4_12_a 歌蕾蒂娅        placeOnRanged
chess_char_4_12_b 歌蕾蒂娅        placeOnRanged
chess_char_4_13_b 灵知            module:uniequip_004_gnosis:modeOnly
chess_char_4_14_b 莱恩哈特        module:uniequip_002_lionhd:rangeExpand, trait:rangeExpand
chess_char_4_21_b 白面鸮(4-21)    module:uniequip_002_plosis:rangeExpand, trait:rangeExpand
chess_char_5_12_b 夕              module:uniequip_002_dusk:rangeExpand, module:uniequip_004_dusk:modeOnly, trait:rangeExpand
chess_char_5_13_b 归溟幽灵鲨      module:uniequip_004_ghost2:modeOnly
chess_char_5_15_a 引星棘刺        skills[2]:passiveRange
chess_char_5_15_b 引星棘刺        skills[2]:passiveRange
chess_char_5_16_b 白面鸮(5-16)    module:uniequip_002_plosis:rangeExpand, trait:rangeExpand
chess_char_5_20_b 安洁莉娜        module:uniequip_004_aglina:modeOnly
chess_char_6_12_b 迷迭香          module:uniequip_003_rosmon:modeOnly
```

我方派生结果与之**逐条相等（21 条 / 27 个布尔，且没有别的棋带旗标）**——见测试「the readings are upstream 0.3.1's」。
注：`chess_char_3_04_b`（琳琅诗怀雅）命中的是它 ISW 模组的「集成战略」，与业主 2026-10-04 的 S3 决定**无关**，不冲突、未改。

## 4. [ASSUMED]（代码里都标了）

1. 插件可以只给 `placeOnRanged: true` / `passiveRange: true` / `rangeExpand` / `modeOnly` 而不给那行中文（照上游）。
2. 除 `true` 以外的任何值（含 `false`）都不算读数，一律落回文本 —— 这样插件写 `false` 也关不掉官方范围。
3. 没有「中文孪生记录」的棋（插件自有棋）不派生，继续靠文本判；因此纯译文 + 无旗标的记录仍是「上不了高台 / 范围不扩」。
4. 补位（`data/backups.json`）的 form 自己没有 `position`，取所属 unit 的（`withPlaceOnRanged(rec, zh, position)`）。

## 5. 测试与结果（单文件直跑：沙箱里 `node --test` 会 EPERM）

### 5.0 本任务相关（全绿）

新增 `app/test/shared/highGround-i18n.test.js`（12 项）：zh/en 同判（266 条棋逐条）、266 条棋 × 全部 loadout（>1600 组）
范围预览同判、上游 21×27 对齐、旗舰三例（引星棘刺 S3 19 格 / 莱恩哈特 SPC-X 10 格 / 空弦 ISW-A 不加距离 vs 信仰搅拌机
SPT-Y 照加）、「译文行不算读数」的对照、**真实 store 端到端**（`createDataStore` + 磁盘 fetch：`setLocale('en')` 后判据与
服务端一致、`getRaw` 不被污染、`setLocale('zh')` 回到纯文本路径）、补位 forms 同理、以及**自选温蒂**（`composeUnitRecord` 组出来的补位记录，zh/en 都判能上高台）。

| 命令 | 结果 |
|---|---|
| `node test/shared/highGround-i18n.test.js` | **12 pass / 0 fail** |
| `node test/ui/feedback1e-range.test.js` | 7 / 0 |
| `node test/ui/loadout-stats.test.js` | 10 / 0 |
| `node test/ui/feedback5-module-trait.test.js` | 6 / 0 |
| `node test/ui/loadout.test.js` | 21 / 0 |
| `node test/ui/inspect-range.test.js` | 6 / 0 |
| `node test/ui/lang.test.js` | 10 / 0 |
| `node test/match/board.test.js` | 10 / 0 |
| `node test/match/prep-loadout.test.js` | 11 / 0 |
| `node test/i18n-data.test.js` | 9 / 0 |
| `node test/backups.test.js` / `test/content/standin.test.js` / `test/match/standin-ownership.test.js` / `test/diy.test.js` | 12 / 0、12 / 0、7 / 0、7 / 0 |
| `node test/content/op_weedy.test.js` | 10 / 0 |
| `node test/sim/detmath.test.js` | 7 / 0 |
| `node test/browser-syntax.test.js` / `test/client-imports.test.js` / `node tools/check-imports.mjs` | 6 / 0、4 / 0、EXIT 0 |
| `node node_modules/eslint/bin/eslint.js shared/highGround.js shared/loadoutRecord.js shared/standIn.js public/js/data.js test/shared/highGround-i18n.test.js` | EXIT 0 |

**中文零变化（硬证明，不只是断言）**：把替换前的三个实现（`attackRangeGrid` / `traitRangeExtend` 的旧代码）与新的对
**266 条棋 × 全部 loadout = 1601 组**逐一比较 → **0 差异**。所以下面这些红都不可能是本改动引起的。

### 5.1 与我无关的既有红（文件 + fail 数，供 lead 对账；lead 2026-10-30 要求照实记为先存）

`data/*.json`、`public/i18n`、kits、docs 都在别人手上；这些失败项里没有 highGround / loadoutRecord / standIn：

| 命令 | 结果 | 失败项 |
|---|---|---|
| `node test/sim/feedback1e-skillrange.test.js` | 15 / 2 | ① `chess_char_6_22_a` S3 残月的余响审计（数据 16 格 vs kit 8 格，我方自有干员）② 烛煌 BattleSpec 真实波次目标选择（1 个目标落在 4-11 外）。该文件只用中文数据 → 我的改动在这条路径 0 差异 |
| `node test/data.test.js` | 25 / 5 | items / config / 数值再派生（`data/*.json` 正在被别人改） |
| `node test/i18n.test.js` | 8 / 2 | 58 条未包 `t()` 的字面量，全在 room.js / protocolLevels.js / admin.js / assetDownload.js / combatHud.js |
| `node test/i18n-packs.test.js` | 12 / 2 | pack manifest 的 planned/supported、template 工具 |
| `node test/match/loadout.test.js` | 9 / 2 | `117 !== 122` 可见棋数量（数据）、solo BAND_DRAFT 无 deadline |
| `node test/match/feedback1-placement.test.js` | 16 / 1 | #9 hand and temp full（HAND_FULL，不是高台那几条；高台两条全绿） |
| `node test/content/op_cgbird.test.js` | 9 / 1 | 夜莺治疗幻影（kit） |
| `node test/ui/playtest2.test.js` | 23 / 1 | 相机 pen 区 |
| `node test/docs-consistency.test.js` / `docs-paths.test.js` | 16 / 9、2 / 5 | 别人的文档改动（AI 上限、语音、DESIGN 章节号、ARCHITECTURE/CONTRIBUTING 路径） |

## 6. 没做 / 做不了（要 lead 决定）

1. ~~`app/shared/standIn.js` 缺一行（自选温蒂的 高台）~~ —— **已补（lead 2026-10-30 批准）**：
   `composeUnitRecord` 里加了 `if (form.placeOnRanged === true) out.placeOnRanged = true;`（照上游 `shared/standIn.js:87` 的形状），
   并在 `app/test/shared/highGround-i18n.test.js` 里钉了一条：自选 slot × `char_400_weedy` 的 form，zh / en 下
   `meleeOnHighGround(composed)` 都为 true，且 en 的 `trait.desc` 已经没有那行中文。
2. **`app/tools/build-data.mjs`（可选的正本清源）**：把四个布尔派生进 `data/chess.json`（上游做法），读端不用改
   （字段名一致）。风险：本 checkout 重建 `data/*.json` 会连带内容哈希与其它数据差异，**本轮没做、也没提交方案**；若要做，
   建议独立任务：「只加四个键、生成器只改一处、其余字段逐字节不变」，并先确认重建工具链在本机可靠。
3. **文档**（`app/docs/` 不在我的写范围）：
   - `app/docs/I18N.md:249`「`shared/highGround.js` reads the trait text 「可以放置于远程位」」→ 改成「读载入时缓存的
     `placeOnRanged` 布尔，文本兜底」。
   - `app/docs/DATA.md:164`（`placement` 行）：补一句「这四个布尔**不落盘**，由 `public/js/data.js withReadings` 在
     本地化副本上派生」；`docs/design/geometry-time.md:15`、`docs/design/match.md:155` 只说规则本身、语义未变，可不改。
   - `app/docs/history/0.3.0.md` 加一条本次修订（我方章节号 §38.x；若加标题要同步 `docs/DESIGN.md` 索引）。
4. **没搬**：上游同批但与本任务无关的 #701（建插件对话框 id 报错）、§36.15 外壳映射等，不在本任务范围。

## 7. 风险 / 注意

- **开销**：某语言的棋表只对真的带旗标的那 21 条多一层浅拷贝；其余记录与 `applyFileOverlay` 的结果共享，没有整表深拷贝。
- **切语言**：`setLocale` 清 `localized` 缓存 → 下次 `get` 重新派生；切回 zh 直接读原始记录（无旗标）。
- **内容集（`setContent`）**：包自己的 chess / backups 也走同一条 `localizedEntry`，派生基准是该包自己的「本地化前」文件；
  包若直接写英文原文，则派生不到旗标 → 落回文本（与今天相同）。
- **服务端**：零改动。服务端数据永远是中文，`meleeOnHighGround` / `attackRangeGrid` 在那边走文本分支，结论不变。
