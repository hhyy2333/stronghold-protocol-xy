# B · 皮肤插件与插件平台：融合版 0.3.3 里值得吸的

> 业主原话（2026-11-01）：「`Stronghold-Protocol-v0.3.3-Fusion` 看看这个有什么值得吸取的」。
> 材料：`C:/Users/hhyyl/Downloads/卫戍协议融合版-v0.3.3-电脑版/Stronghold-Protocol-v0.3.3-Fusion`（**只读，本次未写入一个字节**）
> 我方：`Stronghold-Protocol-Forge-协议源石版/app`（0.19.41 / `UPSTREAM_VERSION='0.3.0'`）
> 口径与 [00-总纲与建议.md](../上游0.3.3对比/00-总纲与建议.md) 一致：结论先行、分「值得做 / 只借思路 / 不值得」、**S** ≤半天 / **M** 2–3天 / **L** >1周。
> 本文不含代码改动，只做判断与落点。

---

## §0 一句话

**融合版这一块几乎没有新机制，它的价值全在「内容 + 打包」：它把 302 套官方时装拆成 4 个外观插件，塞进 0.3.3 自带的 `class: cosmetic` 通道，并把整个过程写进 `MERGE-LOG.md` §9（全文 293 行，§9 占 52 行）。代码增量只有 delis 包的 6 个钩子（`csp.js` 75 + `imgProxy.js` 48 + `extImage.js` 61 + `warmPlugins` 22 行 + 3 处接线，合计约 210 行，其中一半我们不需要）。**

而我方**并不缺插件平台** —— `app/server/plugins`（20 文件）、`app/shared/plugins`（23 文件）、`app/plugins/`（`.studio-key` + `AGENTS.md` + `_template`）、`/studio/`（19 个服务端文件，含 targets/templates/trial/watch）**都在**，200MB 单插件上限也**同值**（`shared/plugins/manifest.js:73`，融合版同文件 `:76`）。我方的真缺口只有两个：

1. **皮肤呈现层**：`public/js/ui/skins.js` 15 行 shim、`skinPicker.js` 4 行 shim（**原说法仍成立，而且比 10-30 那份写得更彻底**），`spineEntry` 没有 `skin` 参数，客户端全文 `assets.skins` 零命中；
2. **「谁说了算」那半**：玩家选哪套没地方存（`settings.skinByChar` 只在一行注释里出现过），没有选择器，没有外观提供者实现。

**结论排序**：值得做 = ① 把「换头像/半身像」这一刀补上（**S**，我方通道 3/4 已经通了，只差选择器 + 一个内置提供者）；② 局内 Spine 换装（**M**，要动 `spineEntry` + `render/units.js` 的缓存键）；③ 302 套素材本身（**M**，实测 **276/302 套我方有对应干员、248 套带得动局内模型**，但要走 `.spresources` 容器，不是散文件）。
只借思路 = 融合版的「拆包法」、`warmPlugins` 预取、CSP 声明合并。
不值得 = `/img-proxy` + `extImage`（我方没有外链图的面）、标题页 `/studio/` 按钮（我方工作台是 LAN-only，公网玩家点进去只会看到 404）、把 302 套做成**插件**而不是**工坊包**。

**最硬的一条**：就算把融合版那 4 个插件原样拷进我方 `app/plugins/`，**我方玩家的画面不会有任何变化** —— 服务端会拒掉它（`shared/plugins/visual.js` 全文 `skins` 零命中，overlay 里没有这个容器），就算放行，客户端也没有读 `assets.skins` 的代码。融合版能看见 302 套，靠的是上游 0.3.1 那层皮肤呈现（`skins.js` 259 + `skinPicker.js` 135 + `assets.js`/`render/units.js`/`seatArt.js` 一组改动）加一条同步链路 —— 那是我们 10-30 已判「**L 且不搬**」的同一件东西。**但本次核实也发现，那条同步链路在我方已经换成了自研的 `room.appearance`，所以这件事不再是非 L 不可**（见 §7）。

---

## §1 先把坐标系钉死：我方现在到哪一步

### 1.1 `skins.js` 15 行 shim —— 说法仍然成立，且更彻底

| 文件 | 我方 | 融合版 | 说明 |
|---|---|---|---|
| `public/js/ui/skins.js` | **15 行**（`app/public/js/ui/skins.js:1-15`，自述 "Compat shim (stronghold-ui-hub package)"） | **259 行** | 我方只有 `skinsStore` + `setSkins`；融合版有 `availableSkins` / `hasAnySkinChoices` / `hasSkinChoices` / `chosenSkin` / `setSkin` / `clearSkin` / `parseStoredSkins` |
| `public/js/ui/skinPicker.js` | **4 行**（`app/public/js/ui/skinPicker.js:4` → `export function SkinSection() { return null; }`） | **135 行** | 我方 皮肤 区**永远不渲染** |
| `public/js/cosmetics.js` | 168 行 | 173 行 | 基本同源，差的那 5 行就是皮肤相关 |
| `shared/plugins/visual.js` | 898 行，`skins` **0 命中** | 969 行，`skins` 是 overlay 的一等容器（`:159`） | 差 **89 行**（11 个 hunk） |

**判定**：10-30 那份「我方 skins.js 只有 15 行是 shim」的缺口**没有变化**，而且当时没写完整的一半是：`skinPicker.js` 只有 4 行，比 skins.js 更空。

### 1.2 但我方还有**另一条**通道，10-30 的总纲没有把它算进去

我方仓里有一条**从工坊包一路通到协议**的时装通道，文档叫「皮肤层设计稿 §3 / DESIGN §28.28」：

```
pack.json.skins[i] = { id, charId, name, series?, desc?, art?, voices? }    ← A 层声明（shared/workshop.js:145 / :1896 / :2359-2426）
        │  mergeWorkshopSkins（shared/workshop.js:4225，调用点 :3721）
        ▼
data/assets.json 的 assets.skins[<charId>] = [{ pack, id, name, art… }, …]  ← 按干员分组的一列
        │  客户端 data.get('assets') 读到（client 零改动）
        ▼
portraitChain 步骤 0「提供者先说话」                                        ← public/js/ui/portraitChain.js:15 / :296
        │  门控：settings.workshopSkins（默认 true，gameLogic/settings.js:36）
        │  提供者：C 层面板导出的 appearance(ctx) → { lookup(kind, charId, id) }（ui/extensions.js:679-704）
        ▼
room.appearance { picks: { <charId>: {skinId} | {avatar} }, avatar }        ← shared/protocol.js:445-498 / :733
             服务端存 + 全房广播（server/lobby.js:1249 / :2458-2496）
```

**这条通道的完成度（逐段核实）**：

| 段 | 状态 | 证据 |
|---|---|---|
| `pack.json.skins` 声明与形状校验 | ✅ 已实现 | `shared/workshop.js:145`（`PACK_FIELDS` 含 `skins`）、`:1896`（`SKIN_FIELDS`）、`:1899`（`SKIN_ID_RE`）、`:2359-2426`（逐字段解析，复用 `art.chars` 同一解析器） |
| 并进清单 `assets.skins[charId]` | ✅ 已实现 | `shared/workshop.js:4225` `mergeWorkshopSkins`，`:3721` 调用；`server/workshop.js:1156` 把 `assets` 计入贡献项 |
| 解析链「提供者优先」（步骤 0） | ✅ 已实现 | `portraitChain.js:15` / `:258 setAppearanceFirst` / `:296 appearanceFirst` / `:192 appearanceLookup` |
| 协议「别人看到你」 | ✅ **服务端已实现** | `shared/protocol.js:445-498` 结构判据、`:733` 白名单；`server/lobby.js:2458` 存 session+seat 并 `broadcastState` |
| 选哪套的**存储** | ❌ **不存在** | `settings.skinByChar` 全仓**只有 1 处命中**，是 `shared/workshop.js:1898` 的一句注释；`DEFAULT_SETTINGS`（`gameLogic/settings.js:36`）里没有这一格 |
| 选择器 UI | ❌ shim | `skinPicker.js` 4 行 |
| 外观提供者（把选择接到画面上） | ❌ 无实现 | 需要 C 层面板导出 `appearance(ctx)`；`workshop/` 5 个真包里 0 个实现 |
| 客户端读 `room.state.seats[].appearance` / 发 `room.appearance` | ❌ 无 | `public/js` 里 `room.appearance` 只出现在 `ui/extensions.js:141` 的**允许发送名单**里，没有发送者、没有读者 |
| 局内 Spine 换装 | ❌ 完全没有 | `assets.js:177 spineEntry(m, id, opts)` 只认 `opts.back/local`，无 `skin`；`render/units.js` / `render/spine.js` 全文无 skin |
| 测试 | ❌ **0 命中** | `app/test/` 里 `SKIN_FIELDS` / `pack.skins` / `mergeWorkshopSkins` / `portraitChain` 全部 0 命中；而 `docs/WORKSHOP.md:652` 把 `test/workshopSkins.test.js`、`test/ui/portraitChain.test.js` 当作「✅ 已实现」的证据 —— **这两个文件不在本 checkout** |

> **这张表就是本次分析最有用的一条**：我方的皮肤问题是「**数据层通、决策层空**」，不是「什么都没有」。所以要花的时间不在协议或合并，而在**选择 + 渲染**。

### 1.3 能力矩阵：融合版 vs 我方（逐项）

| 能力 | 融合版 0.3.3 | 我方 0.19.41 | 差距性质 |
|---|---|---|---|
| 换头像 / 半身像（列表、商店卡、结算行…） | ✅ | ⚠️ 通道通、**没人选、没包** | S |
| 换立绘（详情面板） | ✅ | ⚠️ 同上（`portraitChain` 按 kind 分开问，已就绪） | S |
| 局内小人（Spine）换装 | ✅ 273/302 套有模型 | ❌ 无任何代码路径 | M |
| 别人看到你的皮肤 | ✅ `Match.publicView().players[].skins` + `UnitInfo.skin` | ⚠️ `room.appearance` 服务端已转发广播，客户端不读 | S–M |
| 「显示其他玩家的皮肤」开关 | ✅ `settings.otherSkins`（默认开） | ❌ 无（我方只有总开关 `workshopSkins`） | S |
| 按浏览器记住的选择 | ✅ `sp.pref.skins`（`{charId: skinId}`，≤256 条） | ❌ `sp.pref.cosmetics` 只记「哪些外观插件开着」，不记「哪一套」；而且那个开关面板本身也不在（见 §3.3 的注） | S |
| 内容（几套时装） | **302 套 / 193 干员（全部带 Spine）** | **0 套** | M（搬素材） |
| 服务端拒绝坏数据 | ✅ `isSkinId` / `isSkinSelection`，整条拒收 | ✅ `isAppearanceMsg`，整条拒收（`protocol.js:484-498`） | 已对齐 |

---

## §2 融合版的皮肤是「怎么以插件形式装」的（回答问题 1）

### 2.1 四个插件、体积、以及 200MB 上限的意义

```
plugins/official-skins-273/        13 MB    604 张 webp（302 头像 + 302 半身像）+ assets.json 122 KB + lock 96 KB
plugins/official-skins-models-1/   178 MB   97 个骨架
plugins/official-skins-models-2/   151 MB   （合并日志记 404 个骨架）
plugins/official-skins-models-3/   2.3 MB   2 个骨架（Skadi 异格，单面模型）
```

四个 `plugin.json` 的骨架完全一致（`official-skins-273/plugin.json:1-28`）：

```json
{ "manifest": 2, "id": "official-skins-273", "class": "cosmetic", "scope": ["personal"],
  "permissions": ["assets.override"], "assets": "assets.json",
  "app": ">=0.3.0 <0.4.0", "api": 1 }
```

模型包多一条 `"loadAfter": ["official-skins-273"]`。

**为什么非拆四个**：`shared/plugins/manifest.js:76 pluginBytes: 200 * 1024 * 1024`（我方同一行是 `:73`，**同值**）。302 套模型约 320 MB，一个插件装不下；于是按体积切成 175.6 + 146.4 + 2.2 MiB（`MERGE-LOG.md:270`）。

**这个限制的代价不是体积，是玩家侧的三件事**：四个目录、四个开关（少开一个就有一批皮肤没有局内模型）、四次目录扫描。所以融合版才要 `DEFAULT_PERSONAL` 默认全开（见 §2.5）。

**它是 `scope: ["personal"]`，不是 `["room"]`** —— 按 `docs/SKINS.md:100-107` 的设计：房主**不能**把一套皮肤强加给全房，每人的外观来自**自己浏览器**的层，所以同一局里两个人可能看到不同模型。这是上游刻意的取舍（「你画什么是你的事，他看到什么也是他的事」），融合版原样继承。

### 2.2 302 套怎么合成一张清单（overlay，不写 `data/`）

`docs/SKINS.md:13-31` 给的链：

```
plugins/<id>/plugin.json → assets: "assets.json"（overlay）
  chars[<charId>].skins[<skinKey>] = { name, group, avatar, avatarE2, portrait, portraitE2, illust?, spine: { front, back? } }
        │ 服务端按安装自带的 manifest 合成（不是拷一份 manifest）→ GET /vs/<vs16>/overlay.json
        ▼
public/js/cosmetics.js cosmetics.apply 在客户端已有的 manifest 上叠
        ▼
data.get('assets')  → 每个界面读的都是这一份
        ├─ chars[charId].skins[skinKey]      → 选择器的行（ui/skins.js availableSkins）
        └─ chars[charId].skins[skinKey].spine → 模型（assets.js spineEntry { skin }）
```

实测 `official-skins-273/assets.json` 的条目形状（`char_498_inside@kitchen#2`：`name:"甜品大奖"`、`group:"罗德厨房/II"`、`avatar` / `avatarE2` / `portrait` / `portraitE2` 四个路径）。模型包同一个键下换成 `spine.front/back = { skel, atlas, textures }`（`official-skins-models-1/assets.json`）。

> **这里有一条只属于上游的坑，值得记下来**：皮肤名里出现「点 + 字母」（如系列名 `i.t`、`日晒 SS.SP`）会被 `shared/plugins/manifest.js` 的 `inlineAssetFiles()` 当成素材路径，整个插件被判 `skipped`。融合版的绕法是把 overlay 外置成 `assets.json`（`MERGE-LOG.md:271`）。**我方 `shared/plugins/manifest.js` 是同一血脉，同样的启发式大概率也在** —— 如果将来走插件路线，这条要复现一次验证。

### 2.3 动作映射怎么给：`plugin.lock.json`，`pack` 从骨架解析，手写会被拒

这是我认为**最值得抄的一个工程习惯**（虽然机制我方已有）：`docs/SKINS.md` 的「Invariants」和 `plugins/AGENTS.md:31` 都写着「**绝不手写模型的 `animations` / `events` / `hits` / `bounds` / `anims`**，最多写 `"anims": "auto"`，由 `node tools/plugin.mjs pack` 读骨架写入 `plugin.lock.json`；`plugin.lock.json` 绝不手改」。

实测 `official-skins-models-3/plugin.lock.json` 里每个骨架的元数据：

```json
"anims":      { "idle": "Idle", "deploy": "Start",
                "attack": { "loop": "Skill_1_Loop", "via": "skill" },
                "skill": { "begin": "Skill_1_Begin", "loop": "Skill_1_Loop", "index": 0 },
                "die": "Die", "stun": { "begin": "Stun_Begin", "loop": "Stun" }, "move": null },
"animations": { "Idle": 9, "Start": 1, "Skill_1_Loop": 9, "Die": 1, … },   // clip 时长
"events"/"hits": …,  "bounds": { "x": -777.88, "y": -9.908, "width": 1162.285, "height": 532.84 }
```

**我方这边：机制齐、通道没开。** `public/js/render/spine.js:386` 就是 `this.roles = entry.anims || {}` —— 说明我方渲染器**认 `anims`**；`shared/plugins/visual.js:234-235` 同样拒绝手写 `anims/animations/events/hits/bounds` 并要求来自 lock。换句话说「角色→clip」这张表在我方**是既有设施**，只是 `data/assets.json` 的官方 213 个干员条目里没写（`spineEntry` 只返回 skel/atlas/textures，我方靠 `render/units.js:480` 的 `dollRoles(...)` 约定 + 名字回落，`render/spine.js:201-280` 运行时现采 clip bounds）。

**这意味着两件事**（对成本判断很关键）：
- 好的一面：我方**不需要** lock 那套 `bounds`/`hits` 也能把新模型点亮（运行时采）。
- 坏的一面：我方的动作靠**命名约定**。我把三个模型包的 lock 全扫了一遍（598 个骨架）：`idle` 恰好是 `Idle` 的 **598/598**、`deploy` 恰好是 `Start` 的 **596/598**，但**普通攻击被指到非 `Attack*` clip 的有 34 个**（`Skill_1_Loop` 18 / `Skill_Loop` 8 / `Combat` 4 / `Skill_2_Attack` 2 …），另有 291 个没有 `die` 映射、582 个没有 `stun` 映射。**这 34 套换上去以后攻击动作会退化成 idle 或第一帧** —— 要修，就得在皮肤条目里补一格（很小的）角色→clip 映射。

### 2.4 局内小人怎么换：`UnitInfo.skin` → `spineEntry(m, id, { skin })`

`docs/SKINS.md:39-46`：皮肤按**干员**（`charId`）选，不按棋子；渲染器按 `d.spine ?? d.charId ?? u.defId` 解析，替身/自选用 `PlayerState.fieldRecord` 的「有效本体」。链路上要改的是 `server/sim/{units,battle/players,snapshot}.js`（只当不透明数据搬运，**任何规则都不读**，同种子结果不变）+ `server/match/**`（`setSkins` / `markPrivate` / `publicView().players[].skins`）+ `public/js/render/{units,app}.js`（`info.skin` 进 Spine 条目、进图片缓存键）。

**我方可以用便宜得多的路子**：`room.appearance` 已经把「谁的哪个干员选哪套」发到全房并广播（`server/lobby.js:2458-2496`），而 `assets.skins` 已经在客户端清单里。所以**不需要动 `server/sim/` 与 `UnitInfo`** —— 客户端在画的时候自己查 `assets.skins[charId]` 就够了。代价是「别人看到的你」必须能定位到「那个位置属于哪个玩家」，而我方 `room.state.seats[].appearance` 已经有这个信息（只是没人读）。

### 2.5 按浏览器记住的开关：`sp.pref.cosmetics`

上游：`settings.otherSkins`（是否显示别人的皮肤，默认开，永不发送）+ `sp.pref.skins`（`{charId: skinId}`，≤`SKIN_LIMITS.entries` 256 条）。融合版在 `public/js/content.js:203` **自己加了一行上游没有的东西**：

```js
const DEFAULT_PERSONAL = ['official-skins-273', 'official-skins-models-1', 'official-skins-models-2', 'official-skins-models-3'];
```

即「本机还没存过选择时，四个包默认打开」，外加 `sp.pref.cosmetics.models` 一次性迁移标记（`:205-219`）。**这是融合版的私货，不是上游行为**（上游 personal 插件默认关），动机是可理解的开箱即用；代价是「玩家不知道自己开了什么」的默认值。我方 `PERSONAL_PREF` 键名相同（`public/js/content.js:58`），默认 `[]`。

### 2.6 我方现状小结（回答问题 1 的后半）

- **能换头像/半身像吗？** 数据通道能，但**今天换不了**：没有选择器、没有存储、没有提供者实现、没有一个带 `skins` 的包。
- **能换局内 Spine 吗？** **不能**，一行相关代码都没有。
- **插件平台本身在不在？** 在，而且是同一血脉（见 §3.3 对照），连 `pluginBytes` 200MB 都同值、`plugin.lock.json` 那套 `anims/bounds` 也在（`shared/plugins/visual.js:234-235/401-474`）。但**「设置 → 外观插件」那块面板不在**（§3.3 的注），所以走插件路线还得先补它。

---

## §3 我方要拿这 302 款，代价是什么（回答问题 2）

### 3.1 实测可用率：302 → 276（带模型 248）

我把融合版的四份 `assets.json` 与我方 `data/{assets,chess,backups}.json` 对了一次（只读，脚本在正文附注）：

| 口径 | 数字 |
|---|---|
| 融合版：皮肤套数 / 覆盖干员 | **302 套 / 193 名** |
| 我方 manifest 里的干员数 | 216 |
| 我方「局内真有这个干员」的并集（`chess[].backup.charId` ∪ `backups.units` ∪ `diy.ownedPool` ∪ `diy.operators`） | **215** |
| **302 套里落在我方并集内的** | **276 套（91%）** |
| 其中**同时带局内 Spine** 的 | **248 套** |
| **完全用不上的** | **26 套 / 19 名干员**（`char_230_savage`、`char_109_fmout`、`char_215_mantic` … 都是我方 manifest 里没有的老/新干员） |

**读法**：丢掉的 26 套几乎正好是融合版从 `skin_table.json` 补的那批「0.3.3 才有的 229 名干员」的边角。**也就是说：素材能拿 91%，剩下的 9% 不是皮肤的问题，是我方干员数据还停在 0.3.0 —— 那是 A 号（数据差异）那份报告的范围，不该算在皮肤账上。**

### 3.2 素材从哪来（以及合规面）

`MERGE-LOG.md:246-273` 写得很实：

| 部分 | 来源 |
|---|---|
| 273 套的元数据 + 头像/半身像 | 社区 v0.2.6 随包的 `data/skins.json` + `public/assets/char/` |
| 更新的 29 套 | 官方 `skin_table.json`（Kengxxiao/ArknightsGameData）+ `yuanyan3060/ArknightsGameResource` 取图 |
| 战斗 Spine（174 → 全部） | `fexli/ArknightsResource` 的 `spine/<charId>/<stem>/{Front,Back}/` |
| 2 套补不上（Skadi 异格） | 该仓库缺，单独抓成 models-3（单面模型） |
| 图片格式 | 全部转 **WebP q86**（给模型腾额度） |

**两条必须写进决策的东西**：
1. **这些是官方美术**，融合版的 `LICENSE` 字段直接写 `"Official game assets — non-commercial fan use only"`。我方 `NOTICE.md` / `THIRD-PARTY-NOTICES.md` 的既有口径与之一致（同人复刻、非商用），但**把 331 MB 官方模型塞进仓库**是一次量级上的升级，和现在「跟包发官方 op 模型 252 MB」不是一回事（那是运行必需，这是可选外观）。
2. **我方 `public/assets` 已经 1.2 GB**（`spine` 252 MB / `audio` 375 MB / `char` 74 MB）。再加 344 MB 是 **+29%**。走仓库提交、走 `package-update.mjs` 增量更新都会明显变重。

### 3.3 两种落法对比：**插件**（融合版的路）vs **我方的工坊包**（`pack.json.skins`）

**先说一个反直觉的结论：这两条路在我方是两套并行的东西，而且我方两套都有。**

| | 融合版走的路（插件） | 我方的路（工坊包） |
|---|---|---|
| 清单 | `plugins/<id>/plugin.json` + `assets.json`（overlay） | `workshop/<id>/pack.json` 的 `skins: [...]` |
| 服务端 | `server/plugins/registry.js`（我方 **20 文件**）→ `/vs/<hash>/overlay.json` | `server/workshop.js` → 并进 `data/assets.json` 的 `assets.skins` |
| 单包上限 | **200 MB**（`manifest.js:73`，两侧同值） | 格式**没有字节上限**（只有 `matchKinds ≤4` 之类形状上限）；大素材的正解是 `assets.container`（`.spresources` + `tools/make-spresources.mjs`，`docs/WORKSHOP.md:709/1048-1066`） |
| 开关粒度 | 插件级、按浏览器（`设置 → 外观插件`） | 包级、房主按房间（mod 面板，我方已有）；玩家级要靠 `settings` 另做 |
| 我方缺口 | `visual.js` 补 `skins` 容器（**+89 行**）+ 200 MB 拆分 + **`设置 → 外观插件` 面板本身**（见下） | 选择器 + 存储 + 提供者（**0 行现成**） |

> **一个顺手核实出来的缺口**：我方 `public/js/ui/settings.js`（435 行）里**没有** `CosmeticSection`，`content.js` 导出的 `setPersonalPlugin`（`:194`）**全仓无调用方**，`isPersonalCosmetic` / `hasThemeVars` 在我方 `content.js` 里也不存在。`content.js:44` 那句「设置's 外观插件（`ui/settings.js`）」是**过时注释**。融合版这份面板是 `ui/settings.js:279-329` 的 `CosmeticSection`（含「显示其他玩家的皮肤」那一行，约 50 行）。
> 也就是说：**走插件路线的第一笔开销不是 89 行 overlay，而是「先补一个设置面板」**。这让「外观走工坊包」这个选择更站得住。

**字段映射（几乎是机械的）**：

| 融合版 overlay | 我方 `pack.json.skins[i]` |
|---|---|
| `chars[cid].skins[key].name` | `name` ✅ |
| `chars[cid].skins[key].group` | `series` ✅（语义相同：系列名） |
| `avatar` / `avatarE2` / `portrait` / `portraitE2` | 同名字段，放进 `art`（走 `ART_TABLES.chars` 同一个解析器，`shared/workshop.js:2400`）✅ |
| `spine.front/back = {skel, atlas, textures}` | 同形 ✅（我方 `art` 复用 `art.chars` 的 `spine: sides`） |
| `key`（如 `char_102_texas@epoque#7`） | `id`，必须过 `SKIN_ID_RE = /^[A-Za-z0-9][A-Za-z0-9_-]{0,31}$/`（`shared/workshop.js:1899`）—— **`@` `#` `+` `.` 一律不合法**，得用 stem 形式（`char_102_texas_epoque_7`） |
| `charId` | `charId`（过 `RECORD_ID_RE`）✅ |

**四个必须提前知道的卡点**：

1. **skin id 字符集**：我方 `SKIN_ID_RE` 不收 `@#+.`；上游的 `isSkinId` 正是**故意**收它们（`docs/SKINS.md:35-38`：`char_002_amiya@winter#1` 不是 `isId`）。→ 用 stem 形式即可，但要**保证「写的那一端」和「穿的那一端」用同一个串**（`docs/SKINS.md` 反复强调这一点）。
2. **`room.appearance` 的 `isId`**：`shared/protocol.js:38` 是 `/^[A-Za-z0-9_\-.:]+$/`（≤64）—— **允许 `:` `.`**，所以 `<包id>:<皮肤id>` 这种指针**能过协议**；但 `@` `#` 不行。和上一条同一个结论：**统一用 stem 形式 / 用包内 id**。
3. **局内模型要新写**（见 §3.4），这是唯一真正的 M。
4. **`assets.skins` 只有客户端读得到，服务端看不见**（`protocol.js:459-461` 明写「服务端只转发不判定」）—— 所以「玩家选了一个不存在的皮肤」不会报错，只会静默回落到原版。这是设计，不是 bug；但**选择器必须自己校验**，否则玩家会以为坏了。

### 3.4 要改哪些我方文件（清单 + 量级）

**刀一 · 只有头像/立绘（S，约半天）** —— 这条基本只差「决策层」：

| 文件 | 改什么 | 量级 |
|---|---|---|
| `public/js/ui/skins.js` | 从 shim 换成真实现：`availableSkins(charId)`（读 `data.get('assets').skins`）+ `chosenSkin` / `setSkin` / `clearSkin`，存 `sp.pref.skins` | +120~150 行 |
| `public/js/ui/skinPicker.js` | `SkinSection` 真渲染（我方 `screens/loadout.js:2` 已经在 import 它，位置现成） | +80~120 行 |
| 新增一个内置「外观提供者」 | `appearance(ctx) → { lookup(kind, charId, id) }`（按 `sp.pref.skins` 回答）。**注意**：`portraitChain` 的步骤 0 只问**C 层面板注册的那一个**（`portraitChain.js:192/224`，一个进程最多一个），所以这一格要么做成随包面板，要么给我方内置一条注册路径 | +30~60 行 |
| `public/js/ui/settings.js` / 偏好键 | 给 `skinByChar`（或 `sp.pref.skins`）一格 + 一个「显示别人的皮肤」开关 | +20 行 |
| i18n | `皮肤` / `默认` / `套外观` / `显示其他玩家的皮肤` × 4 语言包（`public/i18n/{en,ja,ko,zh-TW}.json`） | 4×~8 条 |
| CSS | 选择器五格网格（融合版 `.lo-skins` 是 `repeat(5, minmax(0,1fr))`，`docs/SKINS.md:237-244`） | +40 行 |

**刀二 · 局内 Spine（M，2–3 天）**：

| 文件 | 改什么 | 量级 |
|---|---|---|
| `public/js/assets.js:177 spineEntry` | 加 `opts.skin`：先按 `chars[charId].skins[skin]` 取，取不到回落原版；`opts.back` 与 skin 的 back 叠加 | +15~25 行 |
| `public/js/render/units.js` | 把「这个单位该穿哪套」传进 `_modelEntry` / `_pictureUrl` / `_loadPicture`；**缓存键必须带 skinId**（10-30 总纲第 10 条「贴图/查表缓存按解析后的图 URL 存，不按 id」是同一条病根，`render/units.js:2513/2525`） | +40~70 行 |
| `public/js/render/app.js` | 收 `room.appearance.picks` → 每单位 skin；`sourceSkin` 与「显示别人皮肤」开关分离（融合版做法见 `docs/SKINS.md:109-131`） | +50~80 行 |
| `public/js/main.js` / `ui/loadoutSync.js` | 发 `room.appearance`（`ui/extensions.js:141` 的 `PANEL_SEND_TYPES` 已允许 `room.appearance`；玩家侧也可以直接走 `ctx.session` 或协议） | +40~60 行 |
| 34 套缺 `Attack*` 的模型 | 补一格角色→clip 映射（我方 `render/spine.js:386` 已认 `entry.anims`，通道是现成的） | +10 行 + 数据 |

**刀三 · 素材落地（M）**：

- 写一个一次性转换脚本：读融合版四份 `assets.json` + `spine/`，按 §3.1 的 276 套过滤 → 生成我方 `pack.json` 的 `skins[]` 与 `<charId>_<key>/{front,back}/` 目录。
  **好消息：目录形状我方与它逐字同形** —— 我方 `public/assets/spine/op/char_003_kalts/{front,back}/char_003_kalts.{skel,atlas,png}`，融合版 `spine/<stem>/{Front,Back}/<stem>.{skel,atlas,png}`，只有大小写差异。
- **大素材别散着放**：我方包格式对 331 MB 的正解是 `assets.container`（`.spresources` + `tools/make-spresources.mjs`，`docs/WORKSHOP.md:1048-1066`），不是 3600 个散文件 —— 否则每次装载期扫描、每台机器全量同步。
- 体积决策：**建议只带图（13 MB）＋按需带模型**，把 248 套模型做成可选的第二个容器。理由：`public/assets` 1.2 GB 已经在压分发；而「换头像」的观感收益 / 体积比远高于「换模型」。

### 3.5 结论

| 分档 | 项 | 代价 | 风险 |
|---|---|---|---|
| **值得做** | 刀一（头像/立绘换装最小闭环） | **S** | 通道**零测试**（§1.2 末行），第一版就是首次彩排；`portraitChain` 步骤 0 只认一个提供者，注册路径要一次做对 |
| **值得做** | 刀二（局内 Spine） | **M** | 缓存键（10-30 第 10 条）；34 套 clip 命名；与 `spineLocal`（自建模型）的优先级要写明 |
| **值得做（但要挑）** | 刀三（276 套素材，先图后模型） | **M** | 体积 +29%；官方美术入仓的合规口径；`.spresources` 工具链要跑通一次 |
| 只借思路 | 走**插件**装皮肤（我方 `visual.js` 补 89 行 + 200 MB 拆分） | S（补容器）+ 拆分 | 两套包系统并行（工坊包 + 插件）本来就是我方现状，再叠一层外观会让「玩家为什么看不到」变成三个可能原因 |
| 不值得 | 把 331 MB 官方模型**提交进仓库** | — | 体积 +29%，且这是「可选外观」而非运行必需；建议只做可下载容器 |
| **不值得** | 原样拷 4 个插件目录进 `app/plugins/` | — | **画面不会变**（`visual.js` 无 `skins` 容器 + 客户端不读 `assets.skins`），纯浪费 344 MB |

---

## §4 插件平台的三处小钩子（回答问题 3）

**总判断：三处都是「给已经有插件内容的部署用」的补丁。我方 `app/plugins/` 只有一个 `_template`（0 个真插件），所以三处今天的收益全部是 0。** 分别说清：

### 4.1 插件 CSP 声明合并（`BUILTIN_ALLOW` / `mergePluginCsp`）

**解决什么**：`img-src` 只有 `'self' data: blob:`，所以「工坊封面 / 试听 / 第三方 cdn 图标」这类外链图在页面里被浏览器直接拦掉。融合版（delis 包）让插件在 `plugin.json` 里声明它需要的跨域源，服务端启动时合并进站点策略：

```js
// 融合版 server/http/csp.js
export function mergePluginCsp(declarations = []) …        // :27  只收明确 https 主机 + http://localhost
export const BUILTIN_ALLOW = Object.freeze({ img: ['https://speedcdn.jiangjiangze.icu', 'https://*.music.126.net', …] })  // :50
export function siteCsp(publicDir, extra = null) …          // :56  把 extra 并进 img-src / media-src / connect-src
// 接线：server/index.js:200-208
const cspDecls = packs.plugins().map((r) => r.manifest.csp).filter(Boolean);
const extraCsp = mergePluginCsp(cspDecls);
… csp: process.env.SP_CSP === 'off' || extraCsp.off ? null : siteCsp(publicDir, extraCsp)
```

**我方现状**：`app/server/http/csp.js` **没有** `mergePluginCsp`、**没有** `BUILTIN_ALLOW`；只有一条**更窄**的自研通道 `assetCdnOrigins()`（`:21-34`，读 `SP_ASSET_CDN` 环境变量，给 CDN 化部署用）与 `siteCsp(publicDir, env)`（`:37`）。全文 `imgProxy|mergePluginCsp|installImageProxy|warmPlugins` 在 `server/ public/ shared/ tools/` **0 命中**。

**值不值**：**只借思路（S，约 40 行）**。而且要做的话必须比它更严：
- `safeSource()` 的 `https://[A-Za-z0-9.*-]+` 允许 `*`，等于把「任何 https 主机」放进 `img-src`；
- **`csp: "off"` 是整站关闭**（`server/index.js:207` 只打一条 warning）—— 一个外观插件就能让 `script-src` 的保护消失。这与我方纪律（`shared/workshop.js:120-138` 那张闭集表的立场：**宁可当场拒绝，也不要收下一份没人读的声明**）正好相反。
- 而且它是**旁路字段**：`V2_FIELDS`（`shared/plugins/manifest.js:188`）里没有 `csp`，schema 里也没有 —— 它只是从 `raw` 里读出来的，检查器会给一条 unknown-field 警告。

**我的建议**：不搬实现；如果将来我方真要「插件带外链图」，做成**只加白名单、永远不许 `off`、且声明进 schema** 的一格，并且优先复用它已经有的 `assets.mirrors`（作者自备 CDN **只镜像本包容器**，`shared/workshop.js:345-355`）—— 那是同一思路的更窄版本，我方已经有了。

### 4.2 `/img-proxy` + `extImage`（客户端那半）

**解决什么**：即使 CSP 放行了，还有**防盗链**（Referer 白名单）问题。融合版加一条同源代理：

```js
// 融合版 server/http/imgProxy.js   GET /img-proxy?u=<https 图片>
const MAX_BYTES = 8 * 1024 * 1024;   // :11
const TIMEOUT_MS = 12000;            // :12
// 只放行 http(s)、只回 image/*、带 `Referer: <目标 origin>/`、Cache-Control 86400、不做本地缓存
// 接线：server/http/routes.js:109（在 /healthz 分发前）
```

客户端 `public/js/ui/extImage.js`（61 行）用 `MutationObserver` 盯 `<img>` / `<image>` / `<source>` / 内联 `style` 的 `background-image`，凡是 `http(s)` 且非同源的，一律改写成 `/img-proxy?u=…`（`extImage.js:46 installImageProxy`，由 `public/js/main.js:474` 在 `installLobbyMedia()` 之后装一次 —— `MERGE-LOG.md:49` 特别说明这一处是**必要接线**，delis 包里没有任何 import 指向它）。

**我方现状**：没有 `/img-proxy`，没有 `extImage.js`；也**没有任何会加载外链图片的面**：`ui/announce.js` 只有文字（无 image 字段）、`ui/modPicker.js` 没有封面、`ui/notices.js` 只认 `https://` **链接**（不是图片）。我方唯一的外部素材通道是 `assets.mirrors`（作者自备 CDN 承载**本包自己的 `.spresources` 容器**，`server/http/assetJump.js` 做 302 兜底）。

**值不值**：**不值得（0 收益，且引入新风险）**。理由三条：
1. 我方没有需求面 —— 这一点和融合版不同，它是为了自家的工坊封面/音乐 mod 才加的；
2. `/img-proxy` 是一个「任意 https URL 由服务器代取」的 SSRF/滥用面（8 MB × 12 s 的上限挡不住被当图床），而我方对这条事的既有立场是**窄通道 + 声明**；
3. 真要外链图，落地应该是「`assetJump` 那条既有路 + 白名单」，不是通用代理。

### 4.3 `warmPlugins` 预取

**解决什么**：大厅一挂载就把 `/plugins/index.json` 拉下来，并把插件自带 js/css 用 `cache: 'force-cache'` 预取，最多 80 个，进房/开局时不用再等网络：

```js
// 融合版 public/js/content.js:140-161
export async function warmPlugins() {
  const plugins = await loadCatalog();
  … for (const k of ['script','style','entry','client','main']) …
  await Promise.allSettled([...urls].slice(0, 80).map((u) => fetch(u, { cache: 'force-cache' }).catch(() => null)));
}
// 挂载点：public/js/screens/lobby.js:684  useEffect(() => { warmPlugins(); }, [])
```

**我方现状**：`loadCatalog` 在 `public/js/content.js:92`，**已经在**被按需调用：`screens/room.js:547/632`、`ui/pluginFrame.js:398`、`ui/pluginPanel.js:107`（融合版还多两处 `ui/settings.js` 与 `ui/notices.js`，那是它自己的面板）；只缺一条「大厅挂载就预热」。`installedPlugins` 的全链路也在（`main.js:303/702` → `store.js:105` → `content.js:122 installedCount`）。

**值不值**：**只借思路（S，代码 22 行）**，但**排在皮肤内容之后**。今天 `app/plugins/` 是空的（只有 `_template`），`warmPlugins` 会拉到一个 0 条目的 `index.json` 然后什么都不做 —— 空转。等真有插件内容（皮肤包 / UI 插件）再上，收益才是「打开插件面板不白屏」。

**一个细节值得抄**：它**先判断 `installedPlugins > 0`** 才值得去拉目录（`content.js:119-137` 的注释与 `installedCount`），没有插件的服务器不会每页多一次请求。这个「空部署零成本」的自律，比我方某些「无条件初始化」的写法好。

### 4.4 三处汇总

| 钩子 | 解决什么 | 我方状态 | 融合版量级 | 判断 | 代价 |
|---|---|---|---|---|---|
| `mergePluginCsp` + `BUILTIN_ALLOW` | 插件声明的跨域源进站点 CSP | 无（只有 `SP_ASSET_CDN` 自研窄通道 `csp.js:21`） | ~40 行 + 2 处接线 | **只借思路**（且要做成只加白名单、禁 `off`、进 schema） | S |
| `/img-proxy` + `extImage` | 外链图绕过 CSP/防盗链 | 无需求面 | ~110 行 + 2 处接线 | **不值得** | — |
| `warmPlugins` | 大厅预热插件目录与 js/css | `loadCatalog` 已有，缺挂载点 | 22 行 + 1 行 | **只借思路**，排在内容之后 | S |

---

## §5 标题页 `/studio/` 双入口（回答问题 4）

**融合版做了什么**：`public/js/screens/title.js:283-287` 在页脚加了一颗「工坊」按钮（`class="title-plugins title-studio"`、`data-testid="title-studio"`、`location.assign('/studio/')`），`public/css/screens/title.css` 加 `.title-studio` 的绿色描边（`MERGE-LOG.md:46-47`）。旁边还有一颗「本服务器安装了 N 个插件」（`:288`）。

**我方现状**：`app/public/js/screens/title.js` 的 `<footer class="title-foot">` 里只有 `ResumeMatchButton` / `PwaInstallButton` / 法务文案 / 版本行（`:289-300`），**没有工坊入口**。而 `/studio/` 本身我方是有的（`server/studio/` **19 个文件**，含 `targets.js`、`templates/`、`trial*.js`、`watch.js`；`public/studio/` 有 `editors/` 与 `forge.js`），**能力上和融合版差距没有想象的大**（它是 32 个文件，多的是 `check / gameplay* / media* / candidate / rulesTrial / fxReplay / console`）。

**判断：不值得（对我方当前形态）**，理由是**入口的语义不同**：

`server/studio/gate.js:1-3` 明写：`/studio/` 与 `/studio/api/*` **只回答本机与局域网**的请求，其他一律返回**与「页面不存在」相同的 404**。融合版是「电脑版」（业主在自己机器上玩），所以每个人都是本机，按钮人人可用。**我方是阿里云公网服务器**：绝大多数玩家点那颗按钮会得到 404 —— 一个看起来像功能的死按钮，比没有更糟。

**如果要做，正确形状是**（**S**，约 20 行）：客户端先探一次（同一个 `gate` 判据的只读端点），只有本机/局域网的会话才渲染这颗按钮；或者干脆放到「设置 → 关于」里做一条 `location.href='/studio/'` 的链接，不占标题页版位。顺带说一句：我方标题页布局与 0.2.4 分支不同（`title-corner` / `title-login` / `title-foot` 三层），直接照抄融合版的 footer 结构会撞样式。

---

## §6 结论排序与落地顺序

### 6.1 分档总表

| # | 项 | 分档 | 代价 | 玩家是否看得见 | 备注 |
|---|---|---|---|---|---|
| 1 | **皮肤决策层最小闭环**（`skins.js` + `skinPicker.js` + 一个内置外观提供者 + `sp.pref.skins` + i18n/CSS） | **值得做** | **S** | 是（干员调配里多一个「皮肤」区，头像/立绘换掉） | 我方通道 3/4 已通（§1.2），只差这一步；**建议先做这个，做完再谈素材** |
| 2 | **局内 Spine 换装**（`spineEntry{skin}` + `render/units.js` 缓存键 + 同房可见） | **值得做** | **M** | 是（棋盘上的小人换模型） | 34 套 clip 命名要补映射；缓存键是 10-30 第 10 条同一病根 |
| 3 | **276 套素材落地**（先图 13 MB，模型 248 套可选） | **值得做（要挑）** | **M** | 是 | 走 `.spresources` 容器，别散文件；官方美术入仓要业主点头 |
| 4 | CSP 声明合并 | 只借思路 | S | 否 | 只做「加白名单」，永不做 `off`，进 schema |
| 5 | `warmPlugins` | 只借思路 | S | 间接 | 等有插件内容再上；抄它的「空部署零成本」自律 |
| 6 | 融合版「拆包法」（200 MB → 图包 + 2 个模型包 + 补丁包） | 只借思路 | — | — | 只有走插件路线才需要；走工坊包不需要 |
| 7 | 融合版 `DEFAULT_PERSONAL`「默认全开」+ 迁移标记 | 只借思路 | S | 是 | 开箱即用 vs 「玩家不知道开了什么」，我方若做应放在**包**层并给一次可见提示 |
| 8 | `/img-proxy` + `extImage` | **不值得** | — | — | 我方无外链图面；引入 SSRF 面 |
| 9 | 标题页 `/studio/` 按钮 | **不值得**（当前形态） | S | 是（但是死的） | 公网部署下 404；要做就做「本机可见」 |
| 10 | 原样拷 4 个插件目录进 `app/plugins/` | **不值得** | — | **否**（画面不变） | 白占 344 MB |

### 6.2 建议顺序

0. **先补一条测试**（`test/ui/portraitChain.test.js` 级别的）—— 这条通道在本 checkout **零覆盖**（§1.2 末行），现在动它等于盲改。
1. **刀一**（S）：选择器 + 存储 + 内置提供者。做完**先放 3–5 套手工皮肤**验证链路（拿融合版 `official-skins-273/skins/` 里挑几张图），不要一上来就搬 276 套。
2. **刀三的一半**（S）：只搬 302 张头像 + 302 张半身像（13 MB，WebP 已经是现成的），做成一个纯图片工坊包。此时玩家已经能「换头像」。
3. **刀二**（M）：局内模型 + 同房可见。
4. 再评估是否搬那 248 套 Spine（344 MB 的决策点，建议独立一个业主拍板）。
5. 最后才是 §4 的两个 S（CSP / warmPlugins）—— 它们只在「我方真有插件内容」时才有意义。

### 6.3 风险清单

| 风险 | 说明 | 缓解 |
|---|---|---|
| **通道零测试** | `docs/WORKSHOP.md:652` 声称的 `test/workshopSkins.test.js`、`test/ui/portraitChain.test.js` 不在本 checkout；`SKIN_FIELDS`/`mergeWorkshopSkins`/`portraitChain` 在 `app/test/` 0 命中 | 动之前先写测试（和第 1 条落地顺序合并） |
| **`portraitChain` 只认一个提供者** | `portraitChain.js:224`「已经有提供者：后注册者被拒」 | 提供者要一次做对，别让两个包抢 |
| **静默回落** | 服务端看不见包内容（`protocol.js:459-461`），选了不存在的皮肤只会画原版 | 选择器自己校验 + 界面上「0 套外观」的显式提示（融合版 `hasAnySkinChoices` 的全局规则值得抄） |
| **缓存键** | 不按解析后的图 URL 存，换装后会串图（10-30 总纲第 10 条已点过 `render/units.js:2513/2525`） | 刀二一并修 |
| **体积** | `public/assets` 1.2 GB，+344 MB = +29% | 分容器、图/模型分开 |
| **版权口径** | 官方美术，融合版自述 non-commercial fan use only | 与我方 `NOTICE.md` / `THIRD-PARTY-NOTICES.md` 对齐后再入仓 |
| **两套包系统** | 工坊包（`pack.json`）+ 插件（`plugin.json`）并行是我方现状；外观再加一层，玩家排障会有三个原因 | 外观只走**一条**通道（建议工坊包），另一条明确不接外观 |

### 6.4 回退

- 刀一：客户端 + 一个偏好键，功能开关就是 `settings.workshopSkins`（已有，默认 true；关掉 = `portraitChain` 步骤 0 整段不存在，与不装逐字相同）。
- 刀二：**要自己接回同一个开关**（`workshopSkins` 只门控解析链，不管 `spineEntry`）；建议把「局内换装」也算进这一格，否则会出现「头像换了、小人没换」的半开状态。
- 刀三：删那个包目录即回到 0 套；`assets.skins` 是 `mergeWorkshopSkins` 在装载期合成的，不写任何 `data/` 文件（`server/workshop.js:190-193`），删包即干净回退。
- 别学融合版的 `DEFAULT_PERSONAL`：它把「默认开」写死在代码常量里，回退要改代码（`MERGE-LOG.md:273` 自己也承认这点）。

---

## §7 与 10-30 总纲的口径差异（哪些结论要改）

10-30 那份（`00-总纲与建议.md:61/160`）写的是：

> 我方 `app/public/js/ui/skins.js` —— **我方 skins.js 只有 15 行，是 shim**（上游 259 行，真皮肤层）
> 第三档不搬：**皮肤呈现层（0.3.1）** … 我方只有 15 行 shim，真皮肤层要 UI + 第四同步引擎 `room.skins`（新帧字段），**L** 且与自有外观叠加冲突

**前半句仍然成立**（15 行 / shim，已复核；且 `skinPicker.js` 只有 4 行，比当时写的更空）。

**后半句要改一半**，这次摸清了三件当时没看到的事：

1. **第四同步引擎已经在位**：`room.appearance { picks?, avatar? }` 已在 `shared/protocol.js:445-498` / `:733` 落地，`server/lobby.js:2458` 存 session+seat 并**全房广播**（我方自研裁决：「换装与头像要对同房的人可见」）。**不需要新帧字段**，所以「L」的前提少了一条。
2. **外观数据的落点已经有两条**：工坊包 `pack.json.skins` → `assets.skins`（全链路已实现，`shared/workshop.js:145/4225`），以及插件 overlay（只差 `visual.js` 的 89 行）。
3. **`portraitChain` 的「提供者先说话」步骤 0 已经写完**（`portraitChain.js:15/296`，开关默认 true），缺的是「有人回答」和「有人来选」。

**所以修正后的判断**：
- 「头像 / 立绘换装」= **S–M，值得做**（不是 L，也不是「不搬」）；
- 「局内 Spine 换装」= **M，值得做但要挑模型**（我方的 `room.appearance` + `assets.skins` 让它可以纯客户端做，不必动 `server/sim/` 与 `UnitInfo`，这比上游那套便宜一个档）；
- 「与自有外观叠加冲突」这条要限定：真正会冲突的是「插件 overlay 的 `chars[charId].spine` 与工坊包的 `art.spine` / `spineLocal` 同时写同一个干员」——所以**外观只走一条通道**这条纪律要写死（§6.3 最后一行）。

---

## §8 附：本文数字怎么来的（可复现）

- 体积：`du -sh plugins/official-skins-{273,models-1,models-2,models-3}` → 13 M / 178 M / 151 M / 2.3 M；文件数用 `ls | wc -l`（273 的 `skins/` = 604；models-1 的 `spine/` = 97）。**未做逐文件清点**。
- 可用率：一次性 Node 脚本读融合版**四份** `assets.json`（273 + models-1/2/3）与我方 `data/{assets,chess,backups}.json`（只读），统计「302 套按 `charId` 是否落在我方并集里」与「模型包是否有该键」。**没有写入任何文件，没有启动服务器，没有 `npm install`。**
- clip 命名：只读 3 个 `plugin.lock.json` 的 `spine.*.anims`，统计 598 个骨架的 `idle`/`deploy`/`attack`/`die`/`stun` 映射形态。
- 所有 `file:line` 均按两侧当前工作树行号（融合版 2026-10-25 打包状态；我方 `app` 为 0.19.41，git 分支 `master`，工作区有未提交改动但与本文涉及文件无关）。
