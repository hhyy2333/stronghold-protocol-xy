# F 区（数据、文档与工具）：打包链接改写与 6 个文件的可抄更新

> 覆盖 23 个文件 / 67 个 hunk（官方 0.2.4 → 0.2.5，+337 −133）；CLEAN-APPLY 6 个，DIVERGED 14 个，新增（MISSING-IN-YOURS）3 个。
> 真撞车（精确口径）**10 个 hunk / 7 个文件**，是全场撞车最集中的区。

---

## 0. 两条必须先看的口径说明（否则下面的结论会被误用）

### 0.1 `base-025` 不是纯 0.2.5 源码树，而是「0.2.4 源码树 + 0.2.5 更新包覆盖」

更新包（`参考对象\Stronghold-Protocol-v0.2.5-update\`）只含**发行版会带**的 206 个文件；维护者专用的
`test/`、`.github/`、`types/`、`tools/package.mjs`、`tools/build-data.mjs`、`docs/design|history/` 等
**不在更新包里**，因此 `base-025` 里这些文件仍是 **0.2.4 的旧内容**。

证据（机械验证）：

| 事实 | 结果 |
|---|---|
| `base-025\package.json` 与更新包、完整包的 `package.json` | **逐字节相同** |
| `base-025\.github\workflows\ci.yml` 是否调用 `npm run lint` / `check:imports` / `typecheck` | 调用（`:88`/`:91`/`:94`） |
| 这三个脚本在 `base-025\package.json` 的 `scripts` 里是否存在 | **都不存在** |
| `tools\package.mjs` 在 `base-024` 与 `base-025` | 字节相同（44227 B），且**不在** `UPDATE.json` 里 |
| `tools\build-data.mjs` 在 `base-024` 与 `base-025` | 字节相同，且不在 `UPDATE.json` 里 |

**推论（重要）**：CI 自己调用的脚本不可能不存在于真正的 0.2.5 **源码** manifest 里；
所以 `base-025\package.json` 是**打包器裁剪过的玩家包版本**。同理，`README.md`、`CHANGELOG.md`、
`docs/PLAYING.md`、`docs/DEPLOY.md`、`THIRD-PARTY-NOTICES.md` 的 diff 里混进了
**打包时的链接改写**（`docs/DEPLOY.md` §7 明确写着：指向包外文件的相对链接改成该版本 GitHub 标签的绝对地址，
「源码仓库里的这些文件仍是相对链接」）。

**对老板的直接影响：这些绝对链接（`https://github.com/sganggs/Stronghold-Protocol/blob/v0.2.5/…`、
`…/raw/v0.2.5/…`、`../../releases/latest` → Releases 地址）一个字都不要抄进源码树。**
你自己的树现在是相对链接（`docs/img/room.jpg`、`../../releases/latest`），那是**正确**的源码形态。

### 0.2 撞车口径已收紧（旧 `merge-worksheet.csv` 的 `Collides` 列作废）

旧的 `Collides=YES`（unified=6）把**相邻但不相邻的**改动误报成撞车。按新的 `overlap-exact.csv` +
`real-collisions.csv`：

- 本区**真撞车 = 7 个文件 / 10 个 hunk**；
- **降级为「自由可搬」（无冲突）**：`docs/DEPLOY.md`、`shared/protocol.js`、`tools/doctor.mjs`。

---

## 一、结论速览

| # | 文件 | 分类 | 修的是啥 | 来源 | 搬运建议 |
|---|---|---|---|---|---|
| 1 | `CHANGELOG.md` | DIVERGED | 追加 0.2.5 段（1–45 行）；旧段里是打包链接改写 | 0.2.5 段本身 / #531·#530（链接） | **手合**：只把 0.2.5 段整体抄进去，旧段链接一律不动 |
| 2 | `README.md` | DIVERGED | 版本徽章、当前版本摘要、完整包体积+场景、LP 文案；含大量打包链接改写 | #532、#412、#479、#488 等 | **手合**：挑内容句抄，链接别抄 |
| 3 | `THIRD-PARTY-NOTICES.md` | CLEAN-APPLY | **只有**一处打包链接改写，无实质变更 | — | **不必抄**（0 实质变更） |
| 4 | `data/choices.json` | CLEAN-APPLY | 洛洛 / 焰尾子池改为实测权重 | PR #497 | **直接覆盖** |
| 5 | `data/i18n/en.json` | CLEAN-APPLY | 维多利亚英文表述 + `corrections-en` 回退链 | PR #499 | **直接覆盖** |
| 6 | `docs/DEPLOY.md` | DIVERGED→**自由可搬** | 完整包体积、各战场场景段落、§7 打包说明 | #533、#534、#531 | **挑内容抄**（0 撞车） |
| 7 | `docs/PLAYING.md` | DIVERGED | 刷新等待、库存、晋升奖励、首领随机配对、伤害数字 | #501、#515、#412 | **手合**（1 处撞车，插入点） |
| 8 | `node_modules/.package-lock.json` | DIVERGED（伪） | 打包产物（92 包 vs 你的 196 包） | — | **忽略**，见 §3.1 |
| 9 | `package-lock.json` | DIVERGED | 仅 `version` 0.2.4→0.2.5 | — | **手合**：保留 `0.3.0` |
| 10 | `package.json` | DIVERGED | `version` + 打包器裁剪脚本 | #531、#530 | **手合**：自有脚本一个都别删，见 §3.2 |
| 11 | `packs/index.json` | MISSING-IN-YOURS | 生成物（写死 `"app": "0.2.5"`） | — | **重新生成**，别抄 |
| 12 | `public/i18n/en.json` | DIVERGED | 新增 4 条界面文案 | #543、#412、#501 | **挑 4 条抄** |
| 13 | `public/i18n/ja.json` | DIVERGED | 同上 4 条（日文） | 同上 | **挑 4 条抄** |
| 14 | `public/i18n/ko.json` | DIVERGED | 新增 4 条 + **49 条重译** | #490 | **手合**（1 处撞车） |
| 15 | `public/i18n/zh-TW.json` | DIVERGED | 新增 4 条（繁中） | 同上 | **挑 4 条抄** |
| 16 | `scripts/start-windows.bat` | CLEAN-APPLY | Node 版本检测在 Volta 下误报 | #539 / PR #541 | **直接覆盖** |
| 17 | `shared/constants.js` | DIVERGED | `APP_VERSION` 0.2.4→0.2.5（**唯一改动**） | — | **不要抄**：保留 `0.3.0`，见 §3.3 |
| 18 | `shared/protocol.js` | DIVERGED→**自由可搬** | S2C 增加 `'m.layer'` | #482 | **抄那 2 行**（但依赖 C/D/E 区一起做） |
| 19 | `tools/doctor.mjs` | DIVERGED→**自由可搬** | 本地素材行增加「各战场官方场景」 | #533 | **抄那一段** |
| 20 | `tools/local-extract/extract.py` | CLEAN-APPLY | 法线贴图按 Unity 方式解（BC5 + DXT5nm） | PR #534 | **直接覆盖** |
| 21 | `tools/local-extract/fetch_scenes.py` | MISSING-IN-YOURS | **全新文件**：从官方 CDN 下载赛季场景包 | #533 | **必须新增** |
| 22 | `tools/local-extract/scenes.py` | MISSING-IN-YOURS | **全新文件**：场景导出器 | #533 | **必须新增** |
| 23 | `tools/setup.mjs` | CLEAN-APPLY | 新增第 7 步 `--scenes` 下载并提取场景 | #533 | **直接覆盖** |

---

## 二、逐文件明细

### 1. `CHANGELOG.md`　【DIVERGED】— 真撞车 1 处

**官方改了什么**（0.2.4 → 0.2.5，9 个 hunk，+52 −9）

hunk 1（旧行 `1-7`）是最要紧的：把原本的 H1 换成整个 0.2.5 段。

```diff
@@ -1,7 +1,50 @@
-# 更新记录
+## 0.2.5 — 2026-10-12
+
+### 新功能
+- 3D 棋盘按战场显示官方场景：……（#532、PR #533，感谢 @andrew05060414）。……可以用 `node tools/setup.mjs --scenes` 在本机下载并提取……
+- 设置新增「官方伤害数字」（默认关闭）：……（#412，感谢 @ZizhaoNi、@andrew05060414）。
+- 标题画面页脚新增「项目仓库」链接，在新标签页打开本项目仓库（#543）。
+
+### 规则（按官方）
+……（14 条）
+### 界面
+……（6 条）
+### 人机
+- AI 选开局策略和构筑重心时，会软性让开仍在场队友已经选择的阵营……（#514、PR #518，感谢 @IceCodeNew）。
+### 工具与开发
+- 玩家包里的 package.json 只保留指向包内文件的脚本；`npm test` 不再在没有测试的情况下显示通过。……（#531、#530，感谢 @modusensus）。
+- 本地提取按 Unity 的方式解法线贴图，BC5 和 DXT5nm 两种存法都能得到正确结果……（PR #534，感谢 @andrew05060414）。
+- Windows 启动脚本的 Node 版本检测在 Volta 等版本管理器下不再误报版本过旧（#539、PR #541，感谢 @BowenJXD）。
+- 增加开发用模拟一致性检查页 `/dev/sim-check.html`（PR #492）；powi 对 ±0 的结果与 Math.pow 一致（PR #519）……
+- PR 标题以 fix / feat / docs 开头时自动加上类型标签（PR #517，感谢 @Xinglan233）。
```

**其余 8 个 hunk**（旧行 `17-29`、`50-62`、`164-176`、`202-214`、`315-327`、`394-406`、`455-467`、`497-509`）
**全部是同一类改动**：把旧版本段落里指向包外文件的**相对链接**改成绝对 GitHub 链接，例如

```diff
-- 自选编队新增六星克莱门莎……写在[设计记录 §28](docs/history/0.2.3.md)，以后按资料校正。
+- 自选编队新增六星克莱门莎……写在[设计记录 §28](https://github.com/sganggs/Stronghold-Protocol/blob/v0.2.5/docs/history/0.2.3.md)，以后按资料校正。
```

**为什么改**：hunk 1 是**真实的内容更新**（0.2.5 版本段，就是"官方修了什么"的权威清单，挂全 25 条 `#`/PR）。
其余 8 个 hunk 是**打包器行为**（`docs/DEPLOY.md` §7 / #531、#530），不是 0.2.5 的源码改动。

**老板这边的情况**：你改过这个文件（`yours` 比 0.2.4 多约 79 KB），改动集中在**文件头部**——
你保留了 `# 更新记录` H1 并自己维护了 0.3.0 的版本段。

**怎么合**：把 `## 0.2.5 — 2026-10-12` 整段（**45 行**，从 `base-025\CHANGELOG.md` 第 1–45 行原样取）
插到你的 `# 更新记录` 之下、`## 0.3.0` 段之上。**不要**把旧段落的链接改写抄进来。

**真撞车点**：旧行 `23`（`### 新功能` 一带的首个内容行）—— 官方要在这里插入新段，你这一带也在改。

**搬运动作**：打开 `参考对象\Stronghold-Protocol-v0.2.5-update\Stronghold-Protocol\CHANGELOG.md`，
复制 1–45 行，粘进你的 CHANGELOG 顶部（H1 之后）。

---

### 2. `README.md`　【DIVERGED】— 真撞车 2 处

**官方改了什么**（6 个 hunk，+29 −29）

| hunk | 旧行 | 内容 | 性质 |
|---|---|---|---|
| 1 | `1-31` | 版本徽章 `0.2.4`→`0.2.5`；Releases / 图片链接改写 | **混合** |
| 2 | `34-46` | 「当前版本」摘要句改成 0.2.5 | 内容 |
| 3 | `51-83` | 功能一览：LP 文案改成「红字 + −N，结算时才扣除」 | 内容 |
| 4 | `172-194` | 完整包 505 MB→550 MB、「各战场的官方场景」 | 内容 |
| 5 | `198-212` | 测试命令区的链接改写 | 打包 |
| 6 | `224-258` | 文档表 / 致谢 / 贡献段的链接改写 | 打包 |

**为什么改**：内容部分对应 0.2.5 的三条新功能与一条界面修复——
3D 场景（#532/PR #533）、官方伤害数字（#412）、项目仓库链接（#543）、
LP 显示改为结算时扣除（#479/PR #504）；另外「固定赠品不再被库存阻断」（#488/#491/#495、PR #496/#497）
也反映在功能描述里。

**老板这边的情况**：你改过（多约 2.3 KB），你在「当前版本」写的是 **0.2.3**，并新增了协议源石 / 测试场等功能段。

**怎么合**（**挑着抄，不要覆盖**）：

1. 徽章行改成 `0.3.0`（**不是** 0.2.5）：
   ```diff
   -![version](https://img.shields.io/badge/version-0.2.4-2ea44f)
   +![version](https://img.shields.io/badge/version-0.2.5-2ea44f)
   ```
   → 你要写 `0.3.0`（与 `package.json` 一致）。
2. 「当前版本」摘要句：把官方 0.2.5 那句的可抄要点（3D 场景、官方伤害数字、首领随机配对、固定赠品）并进你的 0.3.0 句。
3. 「交互细节」LP 句：官方把「实时减少」改成「红字 + −N，结算时才扣」，**这条可以照抄**（对应 #479）。
4. 完整包体积：官方写 550 MB / 780 MB（含各战场场景）。你若不上场景包，**不要抄**这个数字。
5. 图片/文档链接：**一处都别抄**（打包器改写）。

**真撞车点**：旧行 `5`（版本徽章）与旧行 `40`（`English summary: [below](#english).` 附近的「当前版本」句）——
两处你都已改过。

---

### 3. `THIRD-PARTY-NOTICES.md`　【CLEAN-APPLY】— 但**没有实质变更**

**官方改了什么**（1 个 hunk）

```diff
-| [Node.js](https://nodejs.org/) | v22.23.3 (pinned in `scripts/make-windows-bundle.mjs`) | MIT | …… the integration bundle in [Releases](../../releases/latest) ships no `node.exe`) ……
+| [Node.js](https://nodejs.org/) | v22.23.3 (pinned in `scripts/make-windows-bundle.mjs`) | MIT | …… the integration bundle in [Releases](https://github.com/sganggs/Stronghold-Protocol/releases/latest) ships no `node.exe`) ……
```

**为什么改**：**打包时的链接改写**（#531/#530 那条的配套），不是 0.2.5 的内容变更。
0.2.4 与 0.2.5 的依赖清单（PixiJS / pixi-spine / Preact / htm / three.js / ws / UnityPy 等版本号）**完全一致**。

**老板这边的情况**：你与官方 0.2.4 逐字节一致（未动过）。

**怎么合**：**建议不搬**。若搬，只会向源码树引入一个绝对链接。要搬也行（覆盖后把
`https://github.com/sganggs/Stronghold-Protocol/releases/latest` 改回 `../../releases/latest`）。

---

### 4. `data/choices.json`　【CLEAN-APPLY】

**官方改了什么**（1 个 hunk，但这个文件是**单行 JSON**，所以 diff 只有 1 行 = 整文件）

逐字节定位到唯一实质差异在 `pools` 里的两个子池：

```diff
-pool_equip_rockr：{"kind":"equip","items":["chess_item_4_09_e_a","chess_item_3_09_e_a","chess_item_3_10_e_a","chess_item_2_03_e_a"],"assumed":true}
+pool_equip_rockr：{"kind":"equip","weighted":[["chess_item_1_01_e_a",10],["chess_item_2_03_e_a",2],["chess_item_3_09_e_a",2],["chess_item_3_10_e_a",2],["chess_item_4_09_e_a",2],["chess_item_4_03_e_a",1],["chess_item_4_11_e_a",4],["chess_item_3_03_e_a",4]],"assumed":true}

-pool_char_pinus：{"kind":"chess","weighted":[["chess_char_1_19_a",45],["chess_char_2_18_a",45],["chess_char_4_20_a",10]],"assumed":true}
+pool_char_pinus：{"kind":"chess","weighted":[["chess_char_1_19_a",10],["chess_char_2_18_a",10],["chess_char_4_20_a",3]],"assumed":true}
```

（`pool_equip_rockr` 是**洛洛**特质「随机制造 1 件洛洛的定制品」，`pool_char_pinus` 是**焰尾**的
「野鬃 / 灰毫，小概率远牙」。两者分别挂在 `garrison_91_a/_b` 与 `garrison_149_a/_b` 上。）

**为什么改**：CHANGELOG 0.2.5 第 13 行——「洛洛、焰尾〈获得时〉的**子池按路标月报#2 的实测权重抽取**（PR #497，感谢 @2321Robin）」。
原先只是「等概率从 4 / 3 个里抽」，现在改成了带权重的抽取。

**老板这边的情况**：你与官方 0.2.4 逐字节一致（未动过），**可以直接覆盖**。

**怎么合**：直接覆盖。

**搬运动作**：
`copy 参考对象\Stronghold-Protocol-v0.2.5-update\Stronghold-Protocol\data\choices.json → Stronghold-Protocol-repo\data\choices.json`

> ⚠️ 但见 §5 的证据局限：`data/choices.json` 是**生成物**，而 0.2.5 的生成器
> `tools/build-data.mjs` 不在更新包里（`base-025` 里那份是旧版，仍写着 `items:` 的旧定义）。
> 所以**覆盖是能生效的**（客户端只读 JSON），但如果你以后重跑 `npm run build-data`，
> 需要同时把生成器里的这两处也改成 `weighted`，否则会被生成回旧定义。**推荐做法：改 `tools/build-data.mjs`
> 后重新生成，而不是只覆盖 JSON**（AGENTS.md 第 33 行的硬规矩：`data/*.json` 是生成物，禁止手改）。

---

### 5. `data/i18n/en.json`　【CLEAN-APPLY】

**官方改了什么**（1 个 hunk，同样是单行 JSON 整文件）

把整份文件的**元数据**改动如下（其余内容逐字节相同，机械验证）：

| 位置 | 0.2.4 | 0.2.5 |
|---|---|---|
| `meta.fallback` | `tools/i18n/fallback-remake.json …` | **`tools/i18n/corrections-en.json (before the official texts), tools/i18n/fallback-remake.json …`** |
| `meta.coverage.bonds.official` | 138 | 136 |
| `meta.coverage.effects.official` | 1083 | 1081 |
| `meta.totals.official` | 23158 | 23154 |
| `files.bonds.victoriaShip` / `files.effects.bondeffect_victoria` | 「All [Victoria] Operators carrying equipment gain increased ATK, with an extra increase if equipment is upgraded」 | **「[Victoria] Operators gain +50% ATK per equipment carried, or +80% per upgraded equipment」** |

（`version` / `lang` / `names`（742 条）以及 `files` 其余 15 组键值**逐字节相同**。）

**为什么改**：CHANGELOG 0.2.5 第 30 行——「**维多利亚的英文效果改为按装备逐件加成的表述**（PR #499，感谢 @YuriRestia）」。
`corrections-en.json` 是 0.2.5 新引入的**人工校正层**（优先级高于官方文本）——它与
`files.*.victoriaShip` 的新表述是同一件事的两面。

**老板这边的情况**：你与官方 0.2.4 逐字节一致（未动过），可以直接覆盖。

**怎么合**：直接覆盖。

**⚠️ 注意**：`meta.fallback` 指向的 `tools/i18n/corrections-en.json` **在 `base-025`、
完整包、更新包里都不存在**（见 §5）——它是生成器用的开发文件，不随发行包走。
所以覆盖之后这行引用是"悬空"的，需要你用生成器重建时才生效。

---

### 6. `docs/DEPLOY.md`　【DIVERGED → 自由可搬，0 撞车】

**官方改了什么**（3 个 hunk，+9 −3）

| hunk | 旧行 | 内容 |
|---|---|---|
| 1 | `23-35` | 完整包 505 MB→550 MB、「官方 3D 棋盘、各战场官方场景等本地客户端素材」 |
| 2 | `297-318` | 素材表新增一行「各战场的官方场景（沙地等 11 个战场，0.2.5 素材包…）」 |
| 3 | `320-331` | §7 打包提示：新增场景包打包说明、`packs/index.json` 链接改为绝对地址、新增「玩家包里的脚本和文档链接」整条 |

hunk 2 新增的一行是：

```diff
+| 各战场的官方场景（沙地等 11 个战场，0.2.5 素材包；完整包在提取后带上，精简包和源码可在本机下载并提取，见下） | 3D 棋盘用程序生成的金属地块 |
```

并**新增了一整段正文**（`**各战场的官方场景**（0.2.5 素材包，维护者 2026-10-12：可以进完整包…）`），
说明 11 个战场、赛季版本 `26-04-13-12-31-42_e9b560` 的 33 个包共 22,801,308 字节、
`fetch_scenes.py` + `extract.py --only scene` 两步法等。

**为什么改**：CHANGELOG 0.2.5 新功能第 1 条（#532、PR #533）与工具第 2 条（PR #534）的文档配套；
hunk 3 的「玩家包里的脚本和文档链接」对应 #531、#530。

**老板这边的情况**：你改过（多约 8 KB），你新增了 **§8 监控后台（`/admin/`）** 与 **§9 玩家反馈（`/api/feedback`）**——
这是你自己加的功能。官方那三处改动落在不同位置，**不重叠**。

**怎么合**：**可以直接抄官方这三处**，但要注意：

- hunk 1 的体积数字（550 MB / 780 MB）**只在你会上场景包时才抄**；
- hunk 3 里的 `[PACKS.md](https://github.com/sganggs/Stronghold-Protocol/blob/v0.2.5/docs/PACKS.md)`
  与 `[WINDOWS.md](https://…)` 是**打包改写**，抄的时候请保留你自己的相对链接
  （`[PACKS.md](PACKS.md)`、`[WINDOWS.md](WINDOWS.md)`）；
- 「玩家包里的脚本和文档链接」这一整条**是真实文档内容**（描述打包器行为），**建议抄**——
  它正好解释了为什么你**不能**手删 `package.json` 里的脚本。

---

### 7. `docs/PLAYING.md`　【DIVERGED】— 真撞车 1 处

**官方改了什么**（5 个 hunk，+11 −5）

| hunk | 旧行 | 内容 |
|---|---|---|
| 1 | `1-11` | research 链接改写（打包） |
| 2 | `21-33` | 机变段无改动；真正变化在别处 |
| 3 | `56-74` | **新增「刷新等待」条** + **公共卡池 / 装备库存两条重写** |
| 4 | `121-133` | **最终攻势改为每局随机两两配对**；加时扣血 150 秒措辞 |
| 5 | `171-186` | **新增「伤害数字」整段** + §12 新增「项目仓库」行 |

可抄的三处正文：

```diff
+- **刷新等待**：按下「刷新」后按钮会变暗，本次请求结束（成功或失败）后恢复可点；等待期间再点按钮或按 R 都不会重复发送，避免高延迟时连点多次扣费（GitHub #501）。
```
```diff
+- **最终攻势**（第 14 回合；独立标准为第 9 回合）：每局开始时随机两两配对（准备期到开战固定，隐秘核心沿用同一分组）……
```
```diff
+**伤害数字**：标题画面、大厅、房间和对局里的「设置」有「显示伤害数字」（默认打开……）和「官方伤害数字」（默认关闭）。打开「官方伤害数字」后，只在伤害达到 [PRTS 作战机制](https://prts.wiki/w/作战机制)「伤害红字（暴击）」的条件时显示红色整数……
```

**为什么改**：刷新等待（#501、PR #507）、公共卡池与装备库存（0.2.4 的规则条目在 0.2.5 文档里被改写）、
晋升奖励自选阶级（#515、PR #544）、首领随机配对（0.2.5 规则第 2 条）、伤害数字（#412）、项目仓库（#543）。

**老板这边的情况**：你改过（`YourHunks=1`，但改动内容多），你：

- **没有**「官方伤害数字」功能（你的设置里只有「显示伤害数字」）→ 官方那段伤害数字文案**你现在不要抄**；
- 你的 LP 说明仍是**旧措辞**（「会**立即**显示扣除后的数值」），官方 0.2.5 改成「先不变，结算时才显示」；
- 你的 §12 反馈小节已改成你自己的「**发送给服主**」（`POST /api/feedback`），与官方的
  「复制诊断信息到 GitHub issue」**方向不同**。

**怎么合**：

1. **刷新等待**、**首领随机配对**两处 → 直接抄，与你的改动无关。
2. **伤害数字整段** → **等你自己做完「官方伤害数字」功能再抄**（否则文档会描述不存在的功能）。
   若要做，跨 F 区（`public/i18n/*` 的 2 条新 msgid）+ D/E 区（`ui/settings.js`、渲染层）。
3. LP 措辞 → 与 **C 区**一起决定：官方 0.2.5 是「结算时才扣」，你若是「立即扣」，
   **保持你自己的措辞**，不要抄官方那句。
4. §12 → 保留你自己的版本。

**真撞车点**：旧行 `179-180`（`## 12. 反馈问题` 之前的插入点）—— 官方要在这里插入「伤害数字」段与
「项目仓库」行，你这一带已经改成自己的反馈流程。

---

### 8. `node_modules/.package-lock.json`　【DIVERGED（伪）】

**事实（机械验证，本条修正队长上一轮的"纯换行符差异"判断）**：

| 树 | 存在 | 大小 | 版本字段 | 包数 | dev 包 |
|---|---|---|---|---|---|
| `base-024` | **不存在** | — | — | — | — |
| `base-025` | 存在 | 41,856 B | `0.2.5` | 92 | **0**（已被 `npm ci --omit=dev` 裁掉） |
| `yours` / 仓库 | 存在 | 87,086 B | `0.2.1` | 196 | **104** |

`base-025` 与 `yours` 的内容**不相同**，也不是换行符差异（归一化后仍不等，41,856 B vs 87,086 B）。

**为什么不同**：这是 npm 在安装时自动写的**本机产物**，且**被 `.gitignore` 忽略**
（`.gitignore:2` 的 `node_modules/`）。`base-025` 那份是打包阶段 `npm ci --omit=dev` 之后产生的，
所以只有 92 个运行时包；你那份是本机装了 dev 依赖（eslint / typescript / puppeteer-core / acorn…）之后的。

**怎么处理**：**忽略**。它不是源码、不进版本库、不参与发布；覆盖或保留都无意义。
（队长的结论"可直接覆盖"在**操作层面**上无害，但**理由是错的**——它不是换行符差异，而是
"发行包只装运行时依赖" vs "你本机装了完整依赖"。请以本条为准。）

---

### 9. `package-lock.json`　【DIVERGED】— 真撞车 2 处

**官方改了什么**（1 个 hunk，+2 −2）

```diff
   "name": "stronghold-protocol-alliance",
-  "version": "0.2.4",
+  "version": "0.2.5",
   "lockfileVersion": 3,
   "requires": true,
   "packages": {
     "": {
       "name": "stronghold-protocol-alliance",
-      "version": "0.2.4",
+      "version": "0.2.5",
```

**为什么改**：纯粹是版本号跟随 `package.json`，没有依赖变化
（`three` 0.186.1、`ws` 8.22.0 等全部不变）。

**老板这边的情况**：你改过（`YourHunks=3`）：你把两处 `version` 改成 `0.3.0`，并**新增了 `acorn`** 到 `devDependencies`
（对应你 `package.json` 里的 `acorn: ^8.18.0`）。

**怎么合**：**保留 `0.3.0`**，不要抄 `0.2.5`。若你后续把 `acorn` 装过了，确保它仍留在 lock 里。

**真撞车点**：旧行 `3` 与旧行 `9`（两个 `version` 字段）—— 两边都在改同一个位置。

**搬运动作**：无（不需要从 0.2.5 抄任何东西）。

---

### 10. `package.json`　【DIVERGED】— 真撞车 2 处（本区最重要的一条）

**官方改了什么**（2 个 hunk，+2 −12）

```diff
@@ -1,9 +1,9 @@
   "name": "stronghold-protocol-alliance",
-  "version": "0.2.4",
+  "version": "0.2.5",
```
```diff
@@ -22,28 +22,18 @@
   "scripts": {
     "start": "node server/index.js",
     "dev": "node --watch server/index.js",
-    "test": "node --test",
-    "golden": "node tools/golden.mjs",
-    "golden:update": "node tools/golden.mjs --update",
     "vendor": "node tools/vendor.mjs",
-    "build-data": "node tools/build-data.mjs",
     "assets": "node tools/vendor.mjs && node tools/fetch-assets.mjs",
     "postinstall": "node tools/vendor.mjs",
     "setup": "node tools/setup.mjs",
     "doctor": "node tools/doctor.mjs",
-    "launch": "node scripts/launch.mjs",
-    "lint": "eslint .",
-    "typecheck": "tsc --noEmit --checkJs -p jsconfig.json",
-    "check:imports": "node tools/check-imports.mjs",
-    "ci": "node tools/ci.mjs",
-    "package": "node tools/package.mjs",
-    "package:lite": "node tools/package.mjs --lite"
+    "launch": "node scripts/launch.mjs"
   },
```

**逐条：删了哪些脚本、为什么（挂 #531 / #530）**

被删的 **10 个**：`test`、`golden`、`golden:update`、`build-data`、`lint`、`typecheck`、
`check:imports`、`ci`、`package`、`package:lite`。
保留的 **8 个**：`start`、`dev`、`vendor`、`assets`、`postinstall`、`setup`、`doctor`、`launch`。

原因见 CHANGELOG 0.2.5 第 40 行（**#531、#530**）：

> 玩家包里的 `package.json` 只保留指向包内文件的脚本；`npm test` 不再在没有测试的情况下显示通过。

也就是说：发行包（zip）里没有 `test/`、没有 `tools/golden.mjs`、没有 `eslint` 配置，
所以这些脚本在玩家机器上必然失败；打包器就把它们裁掉了。

**⚠️ 关键判断（必须看）**：**这个裁剪是打包器行为，不是 0.2.5 的源码改动。**
证据：`base-025` 里保留着 `.github/workflows/ci.yml`，而它**自己**在第 88/91/94 行调用
`npm run lint` / `npm run check-imports` / `npm run typecheck`——这三个脚本在 `base-025\package.json` 里却是**不存在**的。
一个自洽的官方源码树不可能同时如此。所以 `base-025\package.json` 是**打包后的玩家包版本**
（与更新包、完整包里的那份逐字节相同），真正的 0.2.5 **源码** manifest 必然仍带这些脚本。

**老板这边的情况**：你改过（`YourHunks=4`），你有 **23 个脚本**：
`start / dev / test / golden / golden:update / vendor / build-data / build-hextech / hextech:import /
hextech:tier / hextech:item / assets / postinstall / setup / doctor / launch / lint / typecheck /
check:imports / ci / package / package:lite / update-notes`，
外加 `"release": "0.3.0-0.2.3"` 与 `devDependencies.acorn`。

**怎么合**（明确建议）：

- **一个脚本都不要删。** 你这些脚本在你的**源码仓库**里全部有效（`test/`、`tools/`、`eslint.config.js` 都在）。
  删了只会毁掉你自己的 CI 与测试流程。打包器会在打包时自动裁剪（`tools/package.mjs` 里
  `PLAYER_NPM_SCRIPTS = ['start','setup','doctor','launch','postinstall','vendor','assets']`，
  见 `base-024\tools\package.mjs:95`）。
- `version` **保留 `0.3.0`**，不要抄 0.2.5（`shared/constants.js` 的 `APP_VERSION` 必须与它一致，
  `test/version.test.js` 会核对）。
- `launch` 脚本官方 0.2.5 也保留了，你也有，无需动作。
- `build-hextech` / `hextech:*` / `update-notes` / `release` 是你自己的东西，官方没有，保留。

**真撞车点**：旧行 `3`（`version`）与旧行 `37-43`（`launch` 之后那一串脚本，官方要在这里删、
你已经在这里加了 `lint`/`typecheck`/`check:imports`/`ci`/`package`/`package:lite`）。

**搬运动作**：**不需要从 0.2.5 抄任何一行**。（若你日后要做发行包，确认 `tools/package.mjs` 的
`PLAYER_NPM_SCRIPTS` 已按 #531/#530 更新——注意它不在更新包里，见 §5。）

---

### 11. `packs/index.json`　【MISSING-IN-YOURS】

**这是什么**：内容包（语言包）索引，由 `node tools/packs.mjs index` 生成，供**纯静态托管**
（GitHub Pages 之类不能跑服务器的托管）使用；服务器自己会实时列出（`server/packs.js`），不需要这个文件。
0.2.5 的那份内容如下（节选）：

```json
{
  "version": 1,
  "app": "0.2.5",
  "packs": [
    { "id": "en", "type": "lang", "name": "English", "strings": 1203,
      "files": { "ui": "/i18n/en.json", "data": "/data/i18n/en.json" } },
    … ja / ko / zh-TW（各 1203 条）…
  ]
}
```

**为什么你的树里没有**：它被 **`.gitignore:29` 忽略**（`packs/index.json`），属于生成物，
只在打包时写进发行 zip（`docs/DEPLOY.md` §7 有说明）。

**不搬会怎样**：**没有影响**。你不做纯静态托管就用不到它；服务器会实时列包。

**怎么处理**：**不要**照抄 0.2.5 那份（它写死 `"app": "0.2.5"`，与你的 0.3.0 不符）。
需要时重新生成：

```powershell
node tools/packs.mjs index
```

（你的仓库里 `tools/packs.mjs` 与 `packs/README.md` 都在。）

---

### 12–15. `public/i18n/{en,ja,ko,zh-TW}.json`　【均 DIVERGED】

**官方改了什么**（合并成表；这些文件的价值低，逐条列完即止）

四个语言包**各自新增同样的 4 条 msgid**（0.2.4 各 1199 条 → 0.2.5 各 1203 条），**没有删除任何键**：

| msgid | en | 来源 |
|---|---|---|
| `项目仓库` | `Repository` | #543 |
| `官方伤害数字` | `Official Damage Numbers` | #412 |
| `只显示达到官方暴击条件的红色数字。关闭时仍显示每一次命中。` | `Show only red numbers that meet the official crit rule. While off, every hit still shows a number.` | #412 |
| `正在刷新…` | `Refreshing…` | #501 / PR #507 |

另外 `ko.json` 还有 **49 条既有译文被重译**（hunk 数因此远多于其他三包），属于
CHANGELOG 0.2.5 第 30 行的「**韩语界面修正**（PR #490，感谢 @D-Roote）」，
包括 `问题反馈`→`문제 제보`、`称号`→`칭호`、`对局记录`→`전적`、`清空`→`초기화`、
统计页若干句末句号补齐等。`en` / `ja` / `zh-TW` **没有任何既有译文被改动**（机械验证：
`retranslated = 0`）。

**老板这边的情况**（重要）：

| 文件 | 你的键数 | 0.2.5 新增 4 条你是否已有 | 0.2.5 的 49 条韩文重译你是否已有 |
|---|---|---|---|
| `en.json` | 1542 | **0 / 4** | — |
| `ja.json` | 1310 | **0 / 4** | — |
| `ko.json` | 1310 | **0 / 4** | **0 / 49（你全还是 0.2.4 旧文）** |
| `zh-TW.json` | 1323 | **0 / 4** | — |

**怎么合**：

1. 四个包各补上那 **4 条新 msgid**（照上表的官方译文抄；`zh-TW` 用 `專案儲存庫` / `官方傷害數字` /
   `只顯示達到官方暴擊條件的紅色數字。關閉時仍顯示每一次命中。` / `正在更新…`，`ja` 用 `リポジトリ` /
   `公式ダメージ数値` / … / `更新中…`，`ko` 用 `저장소` / `공식 대미지 수치` / … / `갱신 중…`）。
   > ⚠️ 其中 `官方伤害数字` 与那条描述**只在你真的实现该功能后才加**（见 §7 第 2 点），
   > 否则会引入没人使用的 msgid（`test/i18n.test.js` 会核对"用到的 msgid"与"存在的 msgid"，多出来的通常不报错，
   > 但 `i18n.mjs check` 的统计会不一致）。
2. `ko.json` 的 49 条重译：**可以整批抄**（它们是纯译文改进，与你的功能无关）。
   唯一的真撞车点是旧行 `1213-1217`（见下）。
3. 不要用 0.2.5 的整份文件覆盖——你的键数（1310–1542）远多于官方的 1203，
   覆盖会**丢掉你自己几百条新增文案**。

**真撞车点（`ko.json`）**：旧行 `1213-1217`，即文件**末尾**这 5 行：

```diff
   "只能部署在召唤者相邻四格": "소환자와 상하좌우로 인접한 4칸에만 배치할 수 있습니다",
   "{names}只能部署在召唤者相邻四格，已退回整备区": "…",
   "{names}只能部署在召唤者相邻四格，整备区已满，下回合返还": "…",
   "装备库存不足，未获得该装备": "장비 재고가 부족하여 획득하지 못했습니다",
   "库存不足": "재고 부족"
```

官方在这 5 行**加了句末句号**并把 `"渲染器暂时未能加载…"` 一行的位置调整；你的文件末尾
也在这附近加了新键（你自己的文案）。**按行对照逐个并入**，别整块替换。

**搬运动作**（四个包都适用）：只把上表 4 条（`ko` 再加 49 条改值）加到你的对应文件里。

---

### 16. `scripts/start-windows.bat`　【CLEAN-APPLY】

**官方改了什么**（1 个 hunk，+1 −1）

```diff
 where node >nul 2>nul
 if errorlevel 1 goto :nonode
-node -e "process.exit(Number(process.versions.node.split('.')[0])>=22?0:1)"
+node -e "process.exit(Math.max(0, Math.sign(22 - parseInt(process.versions.node))))"
 if errorlevel 1 goto :oldnode
```

**为什么改**：CHANGELOG 0.2.5 工具第 3 条——「Windows 启动脚本的 Node 版本检测在 **Volta 等版本管理器**下
不再误报版本过旧（#539、PR #541，感谢 @BowenJXD）」。旧写法假设 `node -v` 输出形如 `v22.x.y`，
某些版本管理器给出的是别的形状，导致 `split('.')[0]` 取到非数字、误判为过旧。

**老板这边的情况**：与官方 0.2.4 逐字节一致（未动过）。

**怎么合**：直接覆盖（改动就这一行）。

---

### 17. `shared/constants.js`　【DIVERGED】— 真撞车 1 处 ⚠️ **不要照搬**

**官方改了什么**（1 个 hunk，+1 −1）——**整份文件只有这一处改动**：

```diff
@@ -2,13 +2,13 @@
 import { N_ } from './i18n.js';
 export const PROTOCOL_VERSION = 1;
 /** Release version shown to players (title screen, server banner, /healthz). Kept equal to package.json "version"
  * (test/version.test.js); PROTOCOL_VERSION above is the separate wire-format number. */
-export const APP_VERSION = '0.2.4';
+export const APP_VERSION = '0.2.5';
```

**为什么改**：跟随版本号，无其它语义（`PROTOCOL_VERSION` 仍是 `1`，协议没变）。

**老板这边的情况**：你改过（`YourHunks=6`），你的这行是 `export const APP_VERSION = '0.3.0';`。

**怎么合**：**保留 `'0.3.0'`，千万不要把 0.2.5 抄进来。**
照搬会把版本号打回 `0.2.5`，与你的 `package.json`（`0.3.0`）冲突，
`test/version.test.js` 与 title 画面、服务器 banner、`/healthz` 都会显示错版本。
0.2.5 的「版本语义」由 `package.json` 与 `CHANGELOG.md` 的 0.2.5 段体现即可。

**真撞车点**：旧行 `8`（`APP_VERSION` 所在行）—— 两边改的是同一行。

**搬运动作**：无（**明确不要抄**）。

---

### 18. `shared/protocol.js`　【DIVERGED → 自由可搬，0 撞车】

**官方改了什么**（1 个 hunk，+2 −0）——在 `S2C` 列表里加了一条：

```diff
   'm.public', 'm.private', 'm.field', 'm.toast', 'm.ticker', 'm.emote', 'm.result',
+  // m.layer { playerId, bondId, add } — own live prep layer gain; ephemeral, never replayed on resync.
+  'm.layer',
   // m.unitStats { seq, round, units: [unitStatsEntry] } — the answer to g.unitStats (the requester only)
   'm.unitStats',
```

**为什么改**：CHANGELOG 0.2.5 界面第 1 条——「补齐回合开始、机变、休整期和战斗中的**盟约叠层提示音**；
同类最多播放一路，新触发替换旧声音，重连和结算回填不补播（#482）」。
`m.layer` 就是"自己实时的休整期叠层"这条新消息。

**老板这边的情况**：你改过（`YourHunks=11`，你加了很多自己的协议），但你**没有** `m.layer`
（经核验：`shared/protocol.js`、`server/match/player/economy.js`、`public/js/main.js`、`public/js/audio.js`
四处你都是 0 处命中——整个 #482 功能你都没有）。

**怎么合**：这 2 行可以整段抄（**零冲突**）。但**光抄这 2 行没有用**——`m.layer` 是跨区功能：

| 环节 | 文件 | 区 |
|---|---|---|
| 定义 | `shared/protocol.js` | **F（本区）** |
| 发送 | `server/match/player/economy.js` | C-match |
| 接收/处理 | `public/js/main.js` | D-client-render |
| 播放（音频） | `public/js/audio.js` | D-client-render |

**建议：与 C / D 区一起整条做**（#482 是"补齐提示音"的完整功能，拆开抄会得到一条没人处理的消息）。

**搬运动作**：在你的 `S2C` 数组里 `'m.result'` 之后插入上面那 3 行（含注释）即可。

---

### 19. `tools/doctor.mjs`　【DIVERGED → 自由可搬，0 撞车】

**官方改了什么**（1 个 hunk，+1 −1）——「本地客户端美术」那一行多报一项：

```diff
   row(local.manifest ? 'ok' : 'skip', '本地客户端美术（可选）', local.manifest
-    ? `${local.count} 项${local.board3d ? '，3D 棋盘可用' : '，无棋盘贴图（2D 棋盘）'}${local.board3d && !local.tiles ? '；缺 tiles.json → node tools/setup.mjs' : ''}`
+    ? `${local.count} 项${local.board3d ? '，3D 棋盘可用' : '，无棋盘贴图（2D 棋盘）'}${local.scenes ? '，已提取各战场官方场景' : '，无各战场官方场景（3D 棋盘用金属地块；node tools/setup.mjs --scenes）'}${local.board3d && !local.tiles ? '；缺 tiles.json → node tools/setup.mjs' : ''}`
     : client ? `检测到 ${client.kind} 客户端 → node tools/setup.mjs --local` : `未提取：${LOCAL_ART_FALLBACK}（${LOCAL_ART_COPY_HINT}）`);
```

**为什么改**：CHANGELOG 0.2.5 新功能第 1 条（#532 / PR #533）的配套——把"场景已提取/未提取"
报给玩家，并提示 `--scenes`。依赖 `checkLocal()` 新增的 `scenes: has('scene/act')` 字段
（那个字段在 `tools/setup.mjs` 里，属 CLEAN-APPLY）。

**老板这边的情况**：你改过（`YourHunks=1`），你在同一行**后面**加了「海克斯素材」等行——
但注意 `checkLocal()` 的 `scenes` 字段你没有，所以**不能只抄这一行**：抄了会引用 `undefined`
（显示为"无各战场官方场景"，不算报错，但语义不对）。**正确顺序是先覆盖 `tools/setup.mjs`**（它提供 `scenes`），
再抄这一行。

**怎么合**：先覆盖 `tools/setup.mjs`，再把这一行的 `local.scenes` 判断并入你的版本。

---

### 20. `tools/local-extract/extract.py`　【CLEAN-APPLY】

**官方改了什么**（7 个 hunk，+65 −13）——两件独立的事：

**(a) 法线贴图解码对齐 Unity（PR #534）**：核心是 `derive_normal_rg()` 的重写。

```diff
-def derive_normal_rg(img):
-    """RGB tangent-space normal map from a two-channel (BC5: R = X, G = Y, B unused) one: Z rebuilt per pixel."""
-    from PIL import Image
-    rgb = img.convert('RGB')
-    r, g, _ = rgb.split()
+def derive_normal_rg(img):
+    """RGB tangent-space normal map from Unity's two-channel one: Z rebuilt per pixel. X and Y are read the way Unity's
+    shaders unpack them (UnityCG.cginc UnpackNormalmapRGorAG: x = R · A, y = G), which covers both layouts a client
+    build holds: BC5 (R = X, G = Y, B unused, no alpha → A = 1) and DXT5nm (R = 1, G = Y, A = X — the map_autochess
+    bundle before the client update of 2026-10)."""
+    from PIL import Image, ImageChops
+    r, g, _, a = img.convert('RGBA').split()
+    x = ImageChops.multiply(r, a)  # exact when either factor is 255
     table = _normal_z_table()
-    z = bytes(table[(x << 8) | y] for x, y in zip(r.tobytes(), g.tobytes()))
-    return Image.merge('RGB', (r, g, Image.frombytes('L', rgb.size, z)))
+    z = bytes(table[(xb << 8) | yb] for xb, yb in zip(x.tobytes(), g.tobytes()))
+    return Image.merge('RGB', (x, g, Image.frombytes('L', img.size, z)))
```

为什么改：CHANGELOG 0.2.5 工具第 2 条——「本地提取按 Unity 的方式解法线贴图，**BC5 和 DXT5nm 两种存法**
都能得到正确结果，**修复 3D 金属棋盘发灰**；2026-10 客户端更新之前提取过素材的，需要重新提取一次
map/autochess（PR #534，感谢 @andrew05060414）」。旧代码只认 BC5（`R = X, G = Y`），
遇到 DXT5nm 存法（`A = X, G = Y`）会把 X 当成 1，法线全错 → 金属地块发灰。

**(b) 场景导出（PR #533）**：新增 `import scenes`、`scene_ids()`、`scene_roots()`、`export_scenes()`、
`--scenes <dir>` 参数，并在 `--print-jobs` 输出里加上 `scenes` 块。

**老板这边的情况**：与官方 0.2.4 逐字节一致（未动过，`--scenes` / `DXT5nm` 都是 0 处命中）。

**怎么合**：**直接覆盖**。注意 (b) 依赖新文件 `scenes.py`（见 §22），要**一起**搬。

**搬运动作**：
`copy 参考对象\…\tools\local-extract\extract.py → Stronghold-Protocol-repo\tools\local-extract\extract.py`

---

### 21. `tools/local-extract/fetch_scenes.py`　【MISSING-IN-YOURS】★ 全新文件

**这是什么**：从官方 CDN 下载**赛季期间**才分发的场景包（101 行）。

- 目标赛季版本常量：`VERSION = '26-04-13-12-31-42_e9b560'`，`PLATFORM = 'Android'`；
- CDN：`https://ak.hycdn.cn/assetbundle/official/{platform}/assets/{version}/`；
- 先读该版本的 `hot_update_list.json`，按 `scenes.SCENES` 的 11 个战场筛出属于场景的 33 个包；
- 每个包按 CDN 命名规则（路径去扩展名、`/`→`_`、`#`→`__`，后缀 `.dat`，其实是个 zip）下载，
  解出内层文件，**用 `hot_update_list.json` 里的 md5 校验**；
- 落到 `.cache/official-scenes/<version>/<bundle 路径>`，供 `extract.py --only scene` 读取；
- `--list` 只看清单不下载；`--version` / `--platform` / `--out` 可覆盖；
- **不依赖 UnityPy / lz4**（纯 `urllib` + `zipfile` + `hashlib`），只要 Python 3.8+。

**为什么必须搬**：CHANGELOG 0.2.5 新功能第 1 条（#532 / PR #533）明确要求精简包与源码可以
「用 `node tools/setup.mjs --scenes` 在本机下载并提取」。仓库「本身不存放官方文件」，
所以**下载脚本是这套功能的入口**——没有它，玩家在赛季外就永远拿不到场景。
`docs/DEPLOY.md` §7 还特别写道：「`tools/local-extract/scenes.py` 和 `fetch_scenes.py` **必须先提交**：
打包读的是 `git ls-files`，未提交的脚本不会进玩家包。」

**不搬会怎样**：`tools/setup.mjs` 会找不到 `FETCH_SCENES_PY`，
`--scenes` 那一步直接失败（场景永远提不出来）；`tools/local-extract/` 目录不完整；
打包时 `sceneInstallPlan` 的"下载"路径必然报错。**3D 棋盘仍能用金属地块，但官方式各战场场景功能全废。**

**搬运动作**：
`copy 参考对象\…\tools\local-extract\fetch_scenes.py → Stronghold-Protocol-repo\tools\local-extract\fetch_scenes.py`

---

### 22. `tools/local-extract/scenes.py`　【MISSING-IN-YOURS】★ 全新文件

**这是什么**：战场场景导出器（457 行），把 Unity 场景包转成 three.js 能用的数据。

- `SCENES`：11 个战场的表——`act1autochess_m01…m07`（7 个，沙地）、
  `act2autochess_m01…m04`（4 个，含叙拉古街区 / 工业风），以及每个场景依赖的主题 bundle；
- 每个战场输出到 `scene/<stageId>/`：`scene.json`（版本、光照、材质、分组、chunk 表）、
  `scene.bin`（板面空间顶点数据：position / uv / lightmap uv / normal i8×4 / colour u8×4 / 索引）、
  `lm<i>.png`（+ WebP 副本，RGBM 光照图，A 通道是烘焙阴影）；
- 贴图落在 `scene/tex/`（各场景共享）；
- `scene_bundle()` / `find_scene()`：在客户端 AB 根、`--scenes` 目录、`.cache/official-scenes/*`
  依次找场景包（赛季外的客户端没有）；
- 自带纯 Python 的 3×4 仿射矩阵小工具（`trs` / `mul` 等），不依赖 numpy；
- 光照解码用 `decode_rgbm`、`LIGHT_RANGE = 8.0`。

**为什么必须搬**：与 §21 同理，是 #532 / PR #533 的**导出端**。
`extract.py` 新增的 `import scenes` 直接依赖它——**缺了它，`extract.py` 连 import 都会失败**，
`--print-jobs` 也会一起挂掉（不只是场景功能）。

**不搬会怎样**：比 §21 更严重——若你搬了 `extract.py` 却没搬 `scenes.py`，
`tools/local-extract/extract.py` 会在**第 57 行 `import scenes` 直接 ImportError**，
整个本地提取（包括原本正常的棋盘贴图 / Spine / 表情）全部不可用。

**搬运动作**：
`copy 参考对象\…\tools\local-extract\scenes.py → Stronghold-Protocol-repo\tools\local-extract\scenes.py`

---

### 23. `tools/setup.mjs`　【CLEAN-APPLY】

**官方改了什么**（5 个 hunk，+92 −3）——新增第 7 步「可选的官方战场场景」：

| hunk | 内容 |
|---|---|
| 1 | 文件头注释新增第 7 步说明；选项新增 `--scenes` / `--no-scenes`；`--no-local` 说明补充"场景步仍会跑" |
| 2 | 新增常量 `FETCH_SCENES_PY` |
| 3 | `checkLocal()` 增加 `scenes: has('scene/act')`；`localGaps()` 增加「各战场官方场景」；**新增导出函数 `sceneInstallPlan(o)`** |
| 4 | `parseArgs()` 增加 `scenes: 'ask'` 与 `--scenes` / `--no-scenes` 解析 |
| 5 | `main()` 末尾新增第 7 步：询问/强制下载 + 提取，并写 `summary` 行 |

`sceneInstallPlan()` 是本条的核心（纯函数，判断"该不该跑"），返回
`{ run, state: 'ok'|'skip'|'warn'|'ask', detail }`，覆盖：
已提取 / `--check` / 客户端不完整 / 无客户端 / 无 Python / 依赖没装 / 已拒绝 / 询问 / 强制。

**为什么改**：CHANGELOG 0.2.5 新功能第 1 条（#532、PR #533）——精简包和源码安装可以
`node tools/setup.mjs --scenes` 在本机下载并提取；「提取依赖缺失时继续用金属地块」。

**老板这边的情况**：与官方 0.2.4 逐字节一致（未动过；`sceneInstallPlan` 0 处命中）。

**怎么合**：**直接覆盖**。但要注意 **`base-025` 的这份也可能被"打包"影响**——
不过 `tools/setup.mjs` 是玩家运行的工具、**在 `UPDATE.json` 里**，属真实 0.2.5 源码，可放心覆盖。

**覆盖后连带生效**：`tools/doctor.mjs`（§19）与 `docs/DEPLOY.md`（§6）的相关行才能正确反映场景状态。

**搬运动作**：
`copy 参考对象\…\tools\setup.mjs → Stronghold-Protocol-repo\tools\setup.mjs`

---

## 三、三个 MUST-HAVE 的搬运清单（按优先级）

### 3.1 立刻搬、零冲突（4 步：一次拿到 3D 场景 + 法线修复）

这四个文件是**一套**，缺一个就残废（尤其 `scenes.py` 缺了会让整个本地提取挂掉）：

```powershell
$SRC = "参考对象\Stronghold-Protocol-v0.2.5-update\Stronghold-Protocol"
$DST = "Stronghold-Protocol-repo"
copy "$SRC\tools\local-extract\scenes.py"       "$DST\tools\local-extract\scenes.py"
copy "$SRC\tools\local-extract\fetch_scenes.py" "$DST\tools\local-extract\fetch_scenes.py"
copy "$SRC\tools\local-extract\extract.py"      "$DST\tools\local-extract\extract.py"
copy "$SRC\tools\setup.mjs"                     "$DST\tools\setup.mjs"
```

外加 `scripts\start-windows.bat`（Node 版本检测，1 行）也在 CLEAN-APPLY，可同批覆盖。

### 3.2 手合、但只有一句/一处

| 文件 | 动作 |
|---|---|
| `shared/constants.js` | **什么都不做**（保留 `0.3.0`） |
| `package.json` / `package-lock.json` | **什么都不做**（保留 `0.3.0` 与全部脚本） |
| `shared/protocol.js` | 抄 3 行（`m.layer` 注释 + 值），与 C/D 区一起做 |
| `tools/doctor.mjs` | 抄 1 行（`local.scenes` 判断），务必在覆盖 `setup.mjs` 之后 |

### 3.3 挑内容抄（4 个文档 + 4 个 i18n）

`README.md` / `CHANGELOG.md` / `docs/PLAYING.md` / `docs/DEPLOY.md`：
只抄正文段落，**绝对链接一处不抄**；`docs/PLAYING.md` 的「伤害数字」段先别抄（功能没做）。

`public/i18n/{en,ja,ko,zh-TW}.json`：各加 4 条；`ko` 另加 49 条改值。

---

## 四、真撞车 10 个 hunk 逐条（本区必须手合的全部）

| # | 文件 | 旧行 | 官方要做什么 | 你这边是什么 | 处理 |
|---|---|---|---|---|---|
| 1 | `CHANGELOG.md` | 23 | 插入 `## 0.2.5` 段 | 你已有 `# 更新记录` + `## 0.3.0` 段 | 把 0.2.5 段（45 行）插到 0.3.0 之上 |
| 2 | `README.md` | 5 | 版本徽章 `0.2.4`→`0.2.5` | 你写 `0.2.3` | 改成 **0.3.0** |
| 3 | `README.md` | 40 | 「当前版本」摘要句改为 0.2.5 | 你的 0.2.3 摘要句 | 并成 0.3.0 一句 |
| 4 | `package.json` | 3 | `version` → `0.2.5` | 你是 `0.3.0` | **保留 `0.3.0`** |
| 5 | `package.json` | 37-43 | 删 6 个脚本（`lint`/`typecheck`/`check:imports`/`ci`/`package`/`package:lite`） | 你正好在这里有这 6 个 | **一个都别删** |
| 6 | `package-lock.json` | 3 | `version` → `0.2.5` | 你是 `0.3.0` | **保留 `0.3.0`** |
| 7 | `package-lock.json` | 9 | 同上（`packages[""].version`） | 同上 | **保留 `0.3.0`** |
| 8 | `public/i18n/ko.json` | 1213-1217 | 末尾 5 行加句号、调整一行位置 | 你在文件末尾也加了新键 | 逐行并入，别整块换 |
| 9 | `docs/PLAYING.md` | 179-180 | 在 `## 12` 前插入伤害数字段 + 项目仓库行 | 你已把 §12 改成自己的反馈流程 | 只并入「刷新等待 / 首领配对」；伤害数字段暂缓 |
| 10 | `shared/constants.js` | 8 | `APP_VERSION` → `'0.2.5'` | 你是 `'0.3.0'` | **不要抄**，保留 `'0.3.0'` |

---

## 五、不确定与证据局限（**不许编**，这里如实列出）

1. **`base-025` 对"维护者专用文件"是过期的。**
   更新包不含 `test/`、`.github/`、`types/`、`tools/package.mjs`、`tools/build-data.mjs`、
   `docs/design|history/` 等，所以 `base-025` 里这些仍是 0.2.4 内容。
   → 因此我**无法**验证 0.2.5 的 `tools/build-data.mjs`（生成器）到底改了什么。
   这直接影响下面两条。

2. **`data/choices.json` 的 `weighted` 改动在生成器里找不到对应。**
   `base-024/tools/build-data.mjs` 与 `base-025/tools/build-data.mjs` **字节相同**，
   第 3504 行仍写着 `<pool_equip_rockr> items: [...]`（无权重）。
   而 `data/choices.json`（生成物）却变成了 `weighted`。两种可能：
   (a) 0.2.5 的**真实**生成器改了，但因为它不进更新包，`base-025` 里那份是旧的；
   (b) 维护者手改了生成物（违反自家 AGENTS.md 第 33 行）。
   我倾向 (a)（因为该改动有对应 PR #497 与 CHANGELOG 条目），但**没有直接证据**，无法证实。
   → **建议**：把 `tools/build-data.mjs` 里那两处也改成 `weighted` 再重新生成，而不是只手覆盖 JSON。

3. **`data/i18n/en.json` 引用的 `tools/i18n/corrections-en.json` 在任何树里都不存在**
   （`base-024`、`base-025`、完整包、更新包、你的仓库都没有；也没有被 `.gitignore` 忽略）。
   它是生成器用的开发文件。→ 覆盖 `data/i18n/en.json` 后这行引用是"悬空"的；
   只有在跑 `tools/build-i18n.mjs` 时才有意义。**这不影响游戏运行**（那个字段只是元数据注释）。

4. **`base-025/CHANGELOG.md` 没有 `# 更新记录` H1**（`base-024` 与你的仓库都有）。
   官方 0.2.5 是**真的删了这个 H1**，还是打包器顺手去掉的，我无法区分——
   打包器会改写 CHANGELOG 的链接，是否存在"顺带改标题"的行为我没找到代码证据
   （`tools/package.mjs` 在两个版本里字节相同，且我在其中**没有**找到链接改写代码，
   说明 base-025 里那份 `package.mjs` 本身也是旧的 0.2.4 版本，见第 1 条）。
   → **建议**：保留你自己的 `# 更新记录` H1（不动就不会错），只把 0.2.5 段插进去。

5. **`node_modules/.package-lock.json` 纠正。**
   队长上一轮的全局结论说它是"哈希不一致但文本完全相同，纯换行符差异 → 可直接覆盖"。
   **实测不是**：`base-025` 41,856 B / 92 包 / 0 个 dev 包；你的 87,086 B / 196 包 / 104 个 dev 包；
   归一化行尾后仍不相等。正确解释是"发行包只装运行时依赖"。操作上仍是**忽略**它，但结论的理由要改。

6. **hunk 计数口径**：本节"67 个 hunk"取自 `diffstat.csv`（官方 unified diff 的 hunk 数）。
   `overlap-exact.csv` 用 unified=0 重算，同一文件会得到更多 hunk
   （例如 `tools/local-extract/extract.py`：diffstat 7 vs overlap-exact 12），
   两者**不矛盾**，只是切分粒度不同。撞车判定以 `overlap-exact.csv` / `real-collisions.csv` 为准。

7. **我没做的**：没跑构建、没装依赖、没启动服务、没改任何源码；没有对 0.2.5 的
   `tools/build-data.mjs` / `tools/package.mjs` / `tools/i18n.mjs` 的"真实版本"下结论
   （它们不在证据里）。上面对"官方源码里应当还有哪些脚本"的推断，依据是
   `base-025/.github/workflows/ci.yml` 与 `base-025/package.json` 的**自相矛盾**，属逻辑推论而非直接观测。
