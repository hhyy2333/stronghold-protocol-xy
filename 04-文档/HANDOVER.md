# 交接说明 · Stronghold-Protocol 0.3.0（海克斯）

> 面向接手本项目的下一个 AI 代理（或人）。读完这一份就能继续干活；所有路径都相对
> `C:\Users\hhyyl\Downloads\Stronghold-Protocol-v0.2.1`（工作区根），除非写明绝对路径。
>
> 生成时间：2026-10-08 · 当前代码状态：**未提交**（工作树改动，见 §3）

> ## ⚠ 2026-10-11 结构变更（读本文时先看这条）
>
> `Stronghold-Protocol\`（v0.2.1 发行整合包）**已被合并进 `Stronghold-Protocol-repo\` 并删除**。本文以下内容因此过时（按内容找，不看行号）：
>
> - 「两个目录」的说法、§1 的目录树、以及「美术通过目录联接来自整合包」「源码树里的 `public\assets`/`public\fonts` 是 junction」这些描述 —— 现在只有**一棵自包含的树**：`Stronghold-Protocol-repo\public\assets`（545 MB）与 `public\fonts` 已是**真实目录**（原先是 junction）。
> - 「只玩整合包」那一节与它的 `cd "$WS\Stronghold-Protocol"; npm start` —— **该目录已不存在，这条命令会失败**；能玩的只有 `cd "$WS\Stronghold-Protocol-repo"; npm start`。
> - 「整合包的程序文件一个都没动」与「绝对不要删掉…整合包内容」—— 现在的状态是：整合包的程序文件**已删除**（`node_modules`/`data`/`server`/`docs`/`tools`/`shared`/`public\{js,css,i18n,vendor}` 等，共 92.5 MB，对 0.3.0 零引用）；只保留了它的美术与身份文件。
> - 原 `Stronghold-Protocol\public\assets\local\hextech\**`（32 文件）→ 现在在 `Stronghold-Protocol-repo\public\assets\local\hextech\**`；`Stronghold-Protocol\data\local-assets.json` → 现在在 `Stronghold-Protocol-repo\data\local-assets.json`。
> - v0.2.1 的 `MANIFEST.json` + `package.json` 留档在 `Stronghold-Protocol-repo\.cache\v0.2.1-release\`（`.cache/` 被 git 忽略）。
>
> 新的目录说明见工作区根的 [00-目录说明.md](../00-目录说明.md)。


---

## 0. 一页速览

| 事项 | 现状 |
|---|---|
| 项目是什么 | 《明日方舟》「卫戍协议：盟约」的非官方同人网页复刻（塔防自走棋，1–4 人联机，Node 单进程 + 浏览器端模拟战斗），GPL-3.0-or-later（素材除外） |
| 上游仓库 | `https://github.com/sganggs/Stronghold-Protocol`（master = tag `v0.2.1`，commit `c2a2ef7`） |
| 两个目录 | `Stronghold-Protocol\` = **发行整合包 0.2.1**（含全部美术，直接能玩）；`Stronghold-Protocol-repo\` = **git 克隆的源码树**（测试、设计文档都在这里），已在其上完成 0.3.0 |
| 已做的工作 | 新增**海克斯**系统（**11** 玩家 + 12 敌方，第 1/6/11 回合三选一 + 1 次刷新，敌方同稀有度、整局累计），版本升到 **0.3.0**，素材由 `HextechRunes.pck` 解包接入；随后按反馈把**选择界面改成与机变同款的官方选牌版式**（官方稀有度卡框 + 圣物图标 + 官方刷新按钮/音效），把**敌方已获得的海克斯**放到顶栏、敌方情报页与选择界面底部，并做了一轮**数值调整**（见 §4.6） |
| 验证状态 | 新增 3 个测试文件全绿；20+ 个既有套件全绿；golden 已按有意改动重新生成（仅 `matches.json` 变化）；`check:imports` 通过；eslint 0 error |
| 未做 | 浏览器 e2e（需 Chrome；本机 Edge 在沙箱内起不来）、正式打 0.3.0 发布包、**提交到 git** |
| 能不能马上玩 | 能：`cd Stronghold-Protocol-repo; npm start` → <http://localhost:3000>（美术通过目录联接来自整合包）；想看新界面不用打到第 6 回合，直接开 <http://localhost:3000/dev/game-mock.html?phase=HEX_DRAFT> |

---

## 1. 两个目录分别是什么

```
Stronghold-Protocol-v0.2.1\
├─ Stronghold-Protocol\        发行整合包 v0.2.1（用户下载的那份，628 MB）
│   ├─ server\ public\ data\ tools\ scripts\ docs\ node_modules\ …   程序文件（未改动）
│   ├─ MANIFEST.json           6443 个文件的 sha256（程序文件的完整性清单）
│   └─ public\assets\          532 MB 美术/音频（含官方素材 + 本地提取素材）
│       └─ local\hextech\      ← 本次新增：32 个海克斯图标/边框/音效
├─ Stronghold-Protocol-repo\   源码树（= 上游 v0.2.1 + 本次 0.3.0 改动）
│   ├─ .git\                   上游 master 历史（792 commits，未提交本次改动）
│   ├─ node_modules\           已 npm ci 装好
│   ├─ public\assets →         目录联接（junction）指向整合包的 public\assets
│   ├─ public\fonts →          目录联接指向整合包的 public\fonts
│   └─ data\local-assets.json  从整合包复制（1630 项，含 hextech 分组）
└─ HextechRunes\               第三方 Godot mod「Hextech Mayhem / 海克斯大乱斗」（素材来源，23.7 MB）
    ├─ HextechRunes.pck        17.9 MB，图标/边框/音效都在里面
    ├─ HextechRunes.dll  lib\  mod 的程序集（本次**没有**用到）
    └─ HextechRunes.json        mod 元信息（作者 Natsuki，v0.9.7）
```

要点：
- **测试、设计文档、CI、golden 只在源码树里有**（发行包按设计不带这些）。
- **源码树里的 `public\assets`、`public\fonts` 是 junction**，不是实体目录；删掉源码树不会影响整合包，反之亦然。若要脱离整合包独立玩，需要 `npm run setup` 重新下载素材（约 460 MB）。
- 整合包的程序文件**一个都没动**，所以它的 `MANIFEST.json` 仍然有效；只加了美术和 `data/local-assets.json`（这两者被 `server/update.js` 的 `isSetupArt` 排除在完整性校验之外，不会影响启动校验）。

### 1.1 上手阅读顺序（强烈建议照这个顺序读，能省几个小时）

1. `README.md`（中文，254 行）——玩法、部署、端口、联机方式。
2. `docs/DESIGN.md`（**索引**，35 行）——章节号 → 文件。现行规则在 `docs/design/*.md`（overview / geometry-time /
   engine / match / network / client），各版本修订与依据在 `docs/history/*.md`。**代码注释里到处都是 `DESIGN §N` 引用**，
   顺着查最快。
3. `docs/ARCHITECTURE.md`（193 行，英文）——代码地图：哪个规则在哪个文件、数据流、黄金结果。
4. `docs/META.md`（对局与经济引擎）、`docs/SIM.md`（战斗模拟）、`docs/DATA.md`（生成数据）、`docs/BALANCE.md`（难度）。
5. 代码风格：**每个文件头部都有一大段注释**说明契约与出处，`server/match/Match.js`、`server/match/match/*.js`
   （类的方法容器，按原型安装）、`server/sim/**`（浏览器与服务器共用，禁止 Node API）是这个项目的骨架。
6. 测试约定：`test/match/harness.js`（虚拟时钟 + `makeMatch` / `drive` / `toPrep` / `runToEnd` / `invariants`）是
   大多数对局测试的入口；`test/match/fakeBattle.js` 提供零成本的假战斗。

---

## 2. 这个环境里的坑（都已有可用解法）

1. **GitHub 全域被 hosts 沉到 127.0.0.1**（`github.com`、`api.github.com`、`raw.githubusercontent.com` …）。所以：
   - 不能 `git clone https://github.com/...`，也不能 `web_fetch` github 域名；
   - 可用镜像：`git clone https://ghproxy.net/https://github.com/sganggs/Stronghold-Protocol.git`（加 `-c http.sslBackend=openssl`）；
   - 读单个文件可用 jsDelivr：`https://cdn.jsdelivr.net/gh/sganggs/Stronghold-Protocol@0.2.1/<path>`、目录树 `https://data.jsdelivr.com/v1/packages/gh/sganggs/Stronghold-Protocol@0.2.1`；
   - `raw.githubusercontent.com` 等被屏蔽，`tools/build-i18n.mjs`（要下官方数据表）在本机**跑不了**。
2. **npm 用不了用户目录缓存**（沙箱只允许写工作区）：`npm ci` 会 `EPERM ...\AppData\Local\npm-cache`。改用
   `npm ci --cache .npm-cache`（源码树 `.gitignore` 已忽略 `.npm-cache/`）。
3. **`node --test` 在本机必然失败**：测试运行器为每个文件 spawn 带 IPC（命名管道）的子进程，沙箱禁止 → 全线 `spawn EPERM`。两种替代：
   - **推荐**：逐文件直接跑，例如 `node test/match/hextech.test.js`（等于单文件、单进程）；
   - 或 `node --test --test-isolation=none`（但有 ~74 个既有失败，多是需要独立进程的 render / 打包工具用例，与本次改动无关）。
4. **WMI/CIM 不可用**：`Get-NetIPAddress`、`Get-NetFirewallProfile` 会报「无法从客户端中访问 CIM 资源」；用 `ipconfig`、`netsh`（需管理员）或项目自带 `npm run doctor` 代替。
5. **PowerShell 是 pwsh 7**：没有 `Get-Content -Encoding Byte`（用 `-AsByteStream` 或 `[System.IO.File]::ReadAllBytes`）；绑二进制解析用内联 Python 更省事。
6. **内置 Python**（项目脚本需要时）：`C:\Users\hhyyl\.dsh\dsh-runtimes\dsh-primary-runtime\dependencies\python\python.exe`（系统里没有 `python`）。
7. 依赖**已装好**（源码树 196 包，`public/vendor` 已由 postinstall 生成）；不要随意 `npm install` 新依赖，项目刻意保持零构建、极少依赖。

---

## 3. 当前变更状态（未提交）

源码树相对上游 `v0.2.1`：

- **47 个改动文件 + 13 个新增文件**（`git -C Stronghold-Protocol-repo status --porcelain`）。
- 新增（`??`）：`data/hextech.json`、`docs/history/0.3.0.md`、`public/js/ui/hexOverlay.js`、`server/match/hextech.js`、
  `server/match/match/hexDraft.js`、`server/sim/content/hextech.js`、`shared/hextech.js`、
  `test/content/hextech.test.js`、`test/match/hextech.test.js`、`test/ui/hextechDraft.test.js`、
  `tools/build-hextech.mjs`、`tools/hextech-import.mjs`、`tools/hextech/`。
- **没有 commit、没有 push**。上游是别人的仓库（sganggs），不要直接推；要么本地 commit，要么走 fork + PR。
- 工作区根还多了：`Stronghold-Protocol\public\assets\local\hextech\**`（32 文件）与改写过的
  `Stronghold-Protocol\data\local-assets.json`（1598 → 1630 项）。

---

## 4. 本次交付：海克斯（DESIGN §27）

### 4.1 规则

- **时机**：第 **1 / 6 / 11** 回合的 `ROUND_START` 之后、`PREP` 之前（`data/hextech.json format.rounds`）。
  与机变同回合时（6/11）**两个都跑，海克斯在先**（`MatchHexDraft.afterHexDraft`）。
- **玩家**：**并行**抽取——每人拿到自己的 3 枚（不轮流、不共享池），选 1 枚；**每人 1 次刷新**；
  3 枚不含自己已拥有的；按稀有度权重抽（白银 .60 / 黄金 .30 / 棱彩 .10）；计时 30 秒，超时随机取一枚；
  `soloUntimed`（单人 / 单个真人）不计时；AI 自动选（`botPickHex`）；重连后仍是同一组三枚。
- **敌方**：每回合选定后获得 **1 枚**（多人也只有 1 枚），稀有度从**本回合各玩家所选**里随机取；
  不与已有的重复，该稀有度池空则顺延相邻稀有度；**持续到对局结束**（累计 ≤3 枚，乘区相乘）。
- **领袖**：`hpMul` 不影响领袖共享血池（沿用官方规则）；ATK/DEF/RES/移速生效；领袖召唤物通过
  `flags.enemyMods` 全额继承。
- **数值上界**：单枚 `≤1.35`，累计 `ΠhpMul ≤ 2`（`test/content/hextech.test.js` 断言）。

### 4.2 内容与文件地图

| 区域 | 文件 | 说明 |
|---|---|---|
| 名单 | `tools/hextech/roster.mjs` | **66 枚玩家** + 24 枚敌方的**唯一手写来源**（名字/描述/稀有度/效果；2026-10-12 起名单不再带图标字段） |
| 生成 | `tools/build-hextech.mjs` → `data/hextech.json` | `npm run build-hextech`；`--check` 校验；**不依赖官方数据表** |
| 纯逻辑 | `shared/hextech.js` | 抽取/顺延/合并（无中文、无数据依赖，前后端共用） |
| 对局 | `server/match/match/hexDraft.js` | 阶段、竞态、超时、AI、敌方结算 |
| 对局辅助 | `server/match/hextech.js` | `applyHex`（立即效果 + 持久 EffectRef）、视图、`enemyHexMods`、`applyEnemyHexes`、`firstLeakFree` |
| 内容 | `server/sim/content/hextech.js` | `hex:<id>` 处理器（预备期）+ `install(battle)`（战斗被动） |
| 接线 | `server/match/Match.js`（`rngHex`、状态、模块表）、`server/match/match/{phases,views,intents,platform,settle,combat,bossRounds,audit}.js`、`server/match/{waves,effectsMeta,bot,gamedata}.js`、`server/sim/content/{index,bosses}.js` | |
| 客户端 | `public/js/ui/hexOverlay.js`（弹窗 + 卡面 + 敌方图标带 + 素材查找）、`public/js/ui/{hud,enemyDrawer}.js`（顶栏 / 敌方情报页的敌方海克斯）、`public/js/ui/gameLogic/{draft,phases}.js`、`public/js/screens/game.js`、`public/js/ui/gameActions.js`（g.hex / g.hexReroll + 官方音效）、`public/js/audio.js`（`playUrl`）、`public/js/ui/gameComponents.js`（`GAME_FILES` 加 `hextech`）、`public/css/screens/game-panels.css`、`public/dev/game-mock.js`（`?phase=HEX_DRAFT` 预览） | 弹窗沿用机变那套 `.spov` 外框，卡面为绘制底板 + 名字首字（2026-10-12 起不再用 mod 符文图标与边框），刷新按钮用官方三态图，敌方累计在三处可见 |
| 协议 | `g.hex {idx 0..2}`、`g.hexReroll {}`、`m.public.hex` / `enemyHexes` / `players[].hexes`、`ERR.NO_REROLL`、`PHASE.HEX_DRAFT` | `shared/{protocol,constants}.js` |
| 素材 | `tools/hextech-import.mjs`、`public/assets/local/hextech/**`、`data/local-assets.json` | 见 §4.4 |
| 文案 | `public/i18n/{en,ja,ko,zh-TW}.json` | 12 个 UI msgid 进四语包；名单文案以中文原文为 msgid 进 en，ja/ko/zh-TW 回退中文——**截至 2026-10-12 有 22 条没进 en**（见 §6 第 5 条） |
| 文档 | `docs/history/0.3.0.md`（§27）、`docs/{DESIGN,META,BALANCE,ASSETS}.md`、`NOTICE.md`、`README.md`、`CHANGELOG.md` | |

### 4.3 验证（都可复现）

```powershell
cd C:\Users\hhyyl\Downloads\Stronghold-Protocol-v0.2.1\Stronghold-Protocol-repo

# 本次新增
node test/content/hextech.test.js        # 15/15
node test/match/hextech.test.js          # 5/5
node test/ui/hextechDraft.test.js        # 8/8

# 关键回归（都应为 fail 0）
node test/match/draft.test.js            # 8/8（含 R6 同回合的 海克斯→机变 串联）
node test/match/connection.test.js       # 12/12
node test/match/hardening.test.js        # 21/21
node test/match/fullmatch.test.js        # 8/8
node test/match/fuzz.test.js             # 2/2
node test/match/clientCombat.test.js     # 20/20
node test/match/playtest6-matchflow.test.js  # 15/15
node test/match/{leftovers,temp,spectator,results}.test.js
node test/content/choices.test.js        # 26/26
node test/lobby.test.js                  # 65/65
node test/assets.test.js                 # 53/53
node test/{i18n,i18n-data,docs-consistency,version}.test.js
node test/golden.test.js                 # 9/9（golden 已重新生成）
npm run --silent check:imports           # 通过
npx eslint <改动的 js 文件>               # 0 error（4 warning，2 个为既有）
node tools/doctor.mjs                    # 会显示「海克斯素材（可选）5 项（自制阶位图 + 音效）」

# 运行冒烟（美术经 junction 来自整合包）
$env:PORT=3998; node server/index.js
# /healthz → app 0.3.0；/data/hextech.json、/data/local-assets.json、
# /assets/local/hextech/audio/selectGold.wav 都应 200
```

> 注意：上面必须**逐文件**跑，理由见 §2.3。

### 4.4 素材是怎么进来的

- 自写的 Godot PCK 解析器在 `tools/hextech-import.mjs` 里（格式：`GDPC` + pack v3；偏移 32 处 u64 = 目录位置；
  目录项 `{u32 路径长, 路径, 4 字节对齐, u64 偏移, u64 大小, 16 字节 md5, u32 flags}`；**数据地址 = 128 + 偏移**，
  本 pck 未加密、PNG 原样存储）。
- 用法：
  ```powershell
  node tools/hextech-import.mjs            # 默认读 ..\HextechRunes\HextechRunes.pck，写 public/assets + 合并 data/local-assets.json
  node tools/hextech-import.mjs --check    # 只校验（CI/测试用）
  node tools/hextech-import.mjs --force    # 强制重解
  ```
  也可 `--pck/--out/--manifest` 指定；`npm run hextech:import` 是同一个工具。
- 产物**只进本机**：`public/assets/` 与 `data/local-assets.json` 都在 `.gitignore` 里；仓库与发布包不含这些图。
  缺图时游戏照常运行，卡片退化为绘制底板 + 名称首字。
- 版权：**2026-10-12 起不再使用该 mod 的图标与边框**：75 张符文图标 + 三档稀有度边框 + 三张按钮图已从项目移除，
  本地备份同日删除（源 pck 早已不在本机，不可恢复）。只保留 2 个抽取/刷新音效——业主判断（LoL 音效、同人不盈利）
  可继续随包分发，来源仍记在 `NOTICE.md` / `docs/ASSETS.md`；卡名与描述是本作自写。

### 4.5 界面（反馈后的改版）

用户看过实机后提了两点，已实现：

1. **敌方海克斯要看得见**（`m.public.enemyHexes`，每抽取一次 +1、整局累计，最多 3 枚）。现在**三处同显**，每条都带 `title` 提示（名称 + 效果）：
   - **顶栏**：`ui/hud.js` 的 `TopBar` 在敌方情报按钮旁渲染 `EnemyHexStrip`（``<span class="hxstrip hxstrip--labeled">`：金色「敌方海克斯」标签 + 每枚一个 `.hxcard--compact` 小卡）。任何阶段、任何座位都可见；
   - **敌方情报页**：`ui/enemyDrawer.js` 的「敌方情报」页把同一组件放在小结行右侧（`class="edrawer__hex"`，原来自动用 `margin-left:auto`）；
   - **选择界面底部**：`HexOverlay` 的 footer 左半边列「敌方海克斯 N」+ 小卡，右半边是规则提示「敌人会获得同稀有度的海克斯」。
2. **画风贴本作**：选择界面不再用自绘小方框，而是复用**机变阶段那套官方选牌外框**（`ui/choiceOverlay.js` 的 `.spov`：蒙版 `.spov__veil` + `.spov__inner` + 标题栏 + 三卡网格 + 两段式「点一下选中、再点一下确认」+ 进度条 `选择中`）。差别只在 `.hxov` 自己的部分：
   - 卡面 `.hxcard` **就是那枚官方整卡边框**：`hextech/frame/{silver,gold,prismatic}.png` 是 512×512 画布里的 312×512 竖版卡（画布左右各留 100px 透明），内窗四边**均匀内缩 6.7%**（用 Pillow 量过）。所以 CSS 是
     `aspect-ratio: 312 / 512` + `background: var(--hx-frame) center / cover` + `padding: 6.7%`——因为 512/312 = 1.641 正好等于卡的高宽比，`cover` 会把左右留白正好裁掉，内容框与内窗对齐；卡内自上而下是符文（占内容宽 58%）、名称、稀有度 chip、效果文字。没有素材时退回稀有度配色面板 + 方形符文底（`.hxcard:not(.has-frame)`）；
   - 刷新按钮用**游戏自己的那颗**（`public/js/ui/shopBar.js` 的 `toolbtn toolbtn--amber`：官方 `shopPanel/refresh_icon` 图 + 「刷新」+ 徽标，徽标放剩余次数）。**注意**：`hextech/ui/{reroll,rerollHover,rerollUsed}.png` 虽然解包了但**客户端没有用**（第一次实机反馈：那颗按钮画风和商店不一致）；
   - 音效走 `hextech/audio/{selectGold,reroll}.wav`（新增 `audio.playUrl(url)`，`ui/gameActions.js` 里 `sfxUrl` 优先于命名音效；没有素材时仍是原来的 pick / refresh 声）；
   - 三档配色：银 `#c9d4dd` / 金 `--gold` / 棱彩 `#b07ce8`，通过 `--hx-c`、`--hx-c-lo` 变量驱动。
   - **点「确认选择」无效的坑（已修）**：根节点上的 `onPointerDown` 会「点空白处取消选中」，而确认按钮当时不在白名单里 → 它自己的 pointerdown 先把选中状态清掉、按钮随即被卸载，click 永远到不了。现在白名单是 `keepsArmed(target)`（`.hxcard, .hxov__reroll, .spov__confirm`），并有 `test/ui/hextechDraft.test.js` 的回归用例。机变那边（`ui/choiceOverlay.js`）本来就是这么写的。

**不用打到第 6 回合就能看**（dev mock 加了 `HEX_DRAFT` 阶段与 `g.hex`/`g.hexReroll` 应答，`public/dev/game-mock.js`）：

```text
http://localhost:3000/dev/game-mock.html?phase=HEX_DRAFT                  # 4 人、30 秒计时、敌方 1 枚
http://localhost:3000/dev/game-mock.html?phase=HEX_DRAFT&variant=solo     # 单人、不计时
http://localhost:3000/dev/game-mock.html?phase=HEX_DRAFT&variant=picked   # 我已选完（另一张淡出）
http://localhost:3000/dev/game-mock.html?phase=HEX_DRAFT&variant=enemy3   # 敌方 3 枚（满累计）
http://localhost:3000/dev/game-mock.html?phase=HEX_DRAFT&variant=noroll   # 刷新已用完
```

另外：`GAME_FILES`（`ui/gameComponents.js`）补上了 `hextech`，否则 `test/ui/playtest3.test.js` 会报「读了这个数据文件但比赛画面没等它」。

### 4.6 数值调整（用户两次反馈）

名单只改 `tools/hextech/roster.mjs`，改完 `node tools/build-hextech.mjs` 重新生成 `data/hextech.json`（测试断言磁盘内容 == 生成内容）。

**第一轮**

| 卡 | 改前 | 改后 |
|---|---|---|
| 盟约回响（白银） | 每回合随机 1 个盟约 +1 层 | **每回合所有已激活盟约 +5 层**（`allActiveLayers: 5`） |
| 盟约编织（黄金） | 每回合随机 2 个盟约各 +1 层 | **删除**（与上重复） |
| 量产线（黄金） | 每回合 1 名随机 1 阶干员 | 每回合 1 名**当前调度中心等级阶**干员（`chess: { tier: 'level' }`） |
| 精锐预兆（白银） | 获得时 1 名 2 阶 + 每 4 回合 1 名 1 阶 | 获得时 **3 张同一名当前等级阶**干员（三张同名直接合成） |
| 精锐训练（黄金） | 「攻速 +8%」 | 「攻击速度 +8」——**攻速点数**（`effect.battle.aspd`，`interval = bat × 100 / aspd`）；数据键 `aspdPct` → `aspd`（旧名仍可读） |

**第二轮**（本次，池子 19 玩家 + 14 敌方 = 33 张）

| 卡 | 机制 |
|---|---|
| 盟约之主（棱彩，改） | 每回合 **所有已激活盟约 +5 层**，且**人数最多的盟约所需人数 −1**（`mainBondCount`，就是 `ctx.setBondCountBonus`，和「调和」同一机制；每回合重挑，旧的清零） |
| 源石红利（白银，改） | **每消耗 5 资金，下回合 +1 资金**（`onSpend: { rebateAccrue }` 记花费 + `onRoundStart: { rebatePay }` 结算，余数保留） |
| 传承（白银，原「废料熔铸」改名） | **每出售 1 名干员，场上拥有其任一盟约的干员永久 +2% 攻击力**（`onSold: { bondAtkPct }`，按盟约累加在该卡自己的 EffectRef `params.battle.bondAtk` 上，战斗开始时只发给盟约相交的干员） |
| 调度直播（黄金，改） | 每回合把**商店第 1 格**换成 **1 名你场上随机的干员**（`shopSlot: { index: 0, pick: 'board' }`；是替换不是加格，价格正常） |
| 先锋之势（黄金，改） | 每场战斗**第一次击倒敌人**时，若击杀者是**先锋**（`profession === 'PIONEER'`）→ **结算后 +3 资金**（`battle.addCoins` → 战果 `coins` → 下回合资金，走悬赏通道） |
| 镜像协议（黄金，新） | 获得时**复制随机一名队友已拥有的一枚海克斯**（优先高稀有度）；匹配层 `applyHexExtras`，深度≤2 |
| 二次抽取（棱彩，新） | 获得时**额外随机获得两枚海克斯**（加权、不重复） |
| 共鸣协议（棱彩，新） | **团队卡**：每回合你和所有队友各 +2 次免费刷新（`effect.team: true`，机制照抄机变团队卡） |
| 战损回收（白银，新） | 每场战斗每漏 1 个敌人，下回合 +3 资金（上限 12） |
| 虫群（黄金，敌方，新） | 每个普通敌组 **+1 名**（`countAdd`），但敌人最大生命值 **−8%**（交易式倍率 <1，校验已放宽到 0.5 < v ≤ 1.35） |
| 过路费（棱彩，敌方，新） | 敌人最大生命值 +20%，**你每漏 1 个敌人下回合 +1 资金**（敌方 `payout`，在 `settle.js` 里按本人 counted 漏怪发钱） |

引擎侧要点（都在这几个文件里）：
- `server/sim/content/hextech.js`：`HANDLER_HOOKS`/`HEX_HOOKS` 白名单把 15 个没用过的 dispatcher 钩子接上（`onSpend/onSold/onBattleResult/…`）；`applySpec(ctx, spec, hex, hook)` 新增 `rebateAccrue/rebatePay/shopSlot/bondAtkPct/perLeak/mainBondCount`；`install()` 新增战斗脚本（首杀先锋 `addCoins`）与按盟约过滤的被动。
- `server/match/effectsMeta.js`：ctx 加 `event()`（只读暴露当前钩子的事件）。
- `server/match/hextech.js`：`applyHex` 支持团队目标（照 `choices.js applyCard` 的写法）、`applyHexExtras`（镜像/二次抽取）、EffectRef **稳定 id `hex:<id>` + 去重**、`applyEnemyHexes` 支持 `countAdd`（不动领袖/器物）、新增 `enemyHexPayout`。
- `server/match/match/settle.js`：敌方 `payout` 按 counted 漏怪发 `pendingFunds`。
- `server/match/match/views.js` **容易漏**：`nextEnemiesFor`（备战预览 / 敌方栏）也必须过一遍 `applyEnemyHexes`，否则 `countAdd` 只在实际战斗里生效、预览会少报敌人（本次一开始就漏了，靠 `test/match/hextech.test.js` 的「虫群也进预览」用例兜住）。
- `server/match/fields.js` **关键**：`specBounds` 必须把玩家自己 `firstKillBy.coins` 的额度加进 `coins` 上限，否则**诚实的客户端战果会被判为不合理而拒收**（fullmatch/clientCombat 就是这样红的）。
- `tools/hextech-import.mjs`：`DEFAULT_OUT` 修正为 `public/assets`（原来少了这一级，配 `rel` 的 `local/` 前缀会写到 `public/assets/local/local/**`）；`public/assets` 在仓库里是指向整合包的 junction，所以错写的文件落在整合包里——本次已删掉那棵 `local/local` 树。
- 素材：新卡各有一枚独立符文，`npm run hextech:import` 会从 pck（约 400 个 relic）解出新图标，manifest 的 `hextech/*` 组重建为 33 + 3 + 3 + 2 = 41 项（`doctor` 显示 41）。

- 数值改动会影响对局结果 → **golden 按流程重跑**（`npm run golden:update`，只应看到 `test/golden/matches.json` 变化）。`test/match/draft.test.js` 那条把「+8 层」写死的用例改成了量增量（R1 自动抽到的海克斯可能直接给干员、干员自带盟约层数）。
- **精锐预兆已定案**：用户选「同一名 3 张」→ `chess: { tier: 'level', count: 3, same: true }`（`applySpec` 只 roll 一次、连发 3 张，三张同名立即合成）。盟约回响与盟约之主现在都是「全 +5」，棱彩那张靠阈值 −1 区分——若嫌重复，可把盟约回响降到 +3。

---

## 4.7 第三批玩家海克斯（本次新增，用户给的 19 张）

同一次交付里把玩家池从 **19 张扩到 38 张**（敌方仍是 14 张，抽取规则不变）。19 张全部落进
`tools/hextech/roster.mjs` 的第三段；规则与实现见 `docs/history/0.3.0.md` **§27.7**（逐张一张表 + 新增的引擎面）。

> 本节记的是**当时**那批交付的规模。经第五～十批（§29.17–§29.27）与敌方动词卡，**当前池子是 66 + 24**；
> 唯一权威数字以 `data/hextech.json` 为准（`test/content/hextech.test.js` 断言 66 / 24）。
要点速记：

- **盟约可被改写**：盟约共鸣（相邻共享，`bondsMeta.membership` + 战斗输入的 `unit.bonds` → sim `unitBonds` 读
  `mem.extraBonds`）、因小失大（附加/核心盟约人数 ±1，走 `setBondCountBonus`）、层数转移（**只改该场战斗的输入快照**）、
  盟约裂变（`computeBonds` 只留层数最高的 2 个 + 其叠层 ×3）。
- **战斗内条件被动**：击倒馈赠（每次击杀叠 +10% 攻击）、装甲破坏（每次物理命中 −20 防御）、北境长城（最右列护盾）、
  技能层涌（开技能给自身盟约加层）、深度吞噬（吞噬额外拿一半防御）、不屈余烬（不屈触发后 4s 锁血 + 阻挡 +1）、
  孤注一掷（`battleForRounds`：EffectRef 带 `params.expireRound`，过期后 `install` 跳过）、精准穿透（精准每 10 层
  给精准 + 全体远程 2% 穿防/穿抗）。
- **商店/装备/经济**：精英共鸣（买干员按场上精锐数 5x% 直接精锐）、悬赏倍增（悬赏通道 ×3，过路费不算悬赏）、
  商店契约（刷新后首个干员 −1，`onPrice` 只读计数器保持纯函数）、装备转化（弃置返还购买价，
  `PlayerState.destroy` 新增玩家级 `onDestroy` 派发）、整装待发（`ps.equipCap()` 取代所有硬编码 2；服务端 + 不变量 +
  harness + 客户端 `m.private.equipCap`）、远见透支（远见里程碑层数减半 + 每次折扣购买 1 LP，**下限 1**）、
  特质扩散（最左/最下干员的 IN_BATTLE 特质复制给相邻，走 ADD_BOND 那套授予机制）。
- **新原语**：`ctx.hexOwned(id)`、`ctx.spendLp(n)`（`effectsMeta.js`）；hex 现在可以挂 `onPrice`；盟约模块新增两个
  `battle.emit` 事件：`devourGain`（阿戈尔）、`bondTrigger`（不屈）；`fields.js layerAllowanceOf` 把
  技能层涌 / 盟约裂变的阵容视为无上限（否则诚实客户端战果会被拒收）。
- **素材**：19 枚新图标已 `npm run hextech:import`（manifest `hextech/*` 从 41 → 60 项，doctor 显示 60）。
- **测试**：`test/content/hextech.test.js` 22 例、`test/match/hextech.test.js` 12 例全绿；`test/match/harness.js` 新增
  `withoutHextech()`——**凡是把经济/盟约数值写死的用例**（choices / economy / feedback1-bounty /
  sim/feedback1b-arcane）现在都用它把抽卡关掉，因为名单一变、种子抽到的海克斯就变（§27.5 早写过这个坑）。
- **golden**：已 `npm run golden:update`，只有 `test/golden/matches.json` 变（有意改动）。
- **已知与本次无关的红**（本机环境/0.3.0 既有）：`test/match/loadout.test.js`（机变 m.public 被节流合并，开/不开
  hextech 都红）、`test/match/lobby-integration.test.js`（websocket 用例不答 HEX_DRAFT，§6.2 记过）、
  `test/match/playtest6-limits.test.js`（`spawnSync` 在本沙箱 EPERM）、`check:imports`（`server/sim/nodeData.js`
  初始导入就有）、以及所有走子进程/网络的 package / docs-paths / i18n-packs / data CLI 用例。

---

## 5. 项目自身的铁律（不遵守就会红）

1. **文档是受测的**：`test/docs-consistency.test.js`、`test/docs-paths.test.js` 会校验 `docs/design/*.md`、`docs/history/*.md`
   与代码里的 DESIGN §N 引用。改规则必须同批改文档，章节号全局唯一、只增不改。
2. **`data/*.json` 是生成的**，不要手改；本次新增的 `data/hextech.json` 由 `tools/build-hextech.mjs` 生成
   （`test/content/hextech.test.js` 断言磁盘内容 == 生成内容）。
3. **i18n 字面量**：`public/js`、`shared`、`server` 里不允许出现未被 `t()`/`N_()`/`msg()` 包裹的中文
   （`test/i18n.test.js`），且每个 msgid 必须存在于 `public/i18n/en.json`。中文放 `data/hextech.json`/`tools/` 是安全的。
4. **素材永不入库**（`.gitignore`：`public/assets/`、`public/fonts/`、`data/local-assets.json`），
   `data/assets.json` 里**绝不能出现 `/assets/local/` 路径**（`test/feedback1d-models.test.js`）。
5. **黄金结果**：只重构不改玩法的提交不得改变 `test/golden/*.json`；有意改玩法时 `npm run golden:update`，
   人工看过差异再一起提交（`test/golden/README.md`）。本次已按此流程执行。
6. **新增阶段/意图的测试面**：`test/match/harness.js drive()`、`test/match/fuzz.test.js randomIntent`、
   `test/lobby.test.js gTypes`、`test/match/audit.js` 五处都要同步（本次都做了）。
7. **设计文档受测**（`test/docs-consistency.test.js`、`test/docs-paths.test.js`）：`docs/design/*.md`、`docs/history/*.md`
   里每个 `## N.` 标题必须**全局唯一**，文件首行必须是 `# DESIGN §N(, §M…) — 标题`，第二段必须是
   `Part of [DESIGN.md](../DESIGN.md)…`，子小节用 `### N.x`（写成 `## 27.1` 会被当成两个 §27 而报错——本次踩过并已修）。
   `docs/DESIGN.md` 的索引表每行 = 一个文件 + 它持有的全部 § 号。改完跑 `node test/docs-consistency.test.js`。
8. 代码/注释用英文；面向玩家的文本默认简体中文，走 i18n；提交信息一行说清改动、加 issue 号，
   不加 `Co-Authored-By` 之类的署名尾行（上游约定，见 `CONTRIBUTING.md`）。

---

## 6. 待办（建议优先级）

1. **提交**：本地 `git add -A && git commit`（一条信息说清 0.3.0 海克斯）；如需上游合并，先 fork（GitHub 不可直连，用 ghproxy 镜像或让用户在本机操作）。
   可直接用的提交信息：
   ```
   0.3.0 海克斯：开局与第 6/11 回合的三选一（每人 1 次刷新），敌人获得同稀有度海克斯并累计到对局结束（DESIGN §27）
   ```
2. **浏览器 e2e**（需本机 Chrome，`CHROME_PATH` 可指定）：`SP_E2E=1 node test/ui/mock.e2e.test.js` 等。
   **solo / coop / result 三个循环已补上 `HEX_DRAFT` 分支**（`pickHex()` + `HEX_DRAFT` 分支）：R1 先停在海克斯抽取，
   单人局又不计时，不答就会挂到超时。`?phase=HEX_DRAFT` 变体见 §4.5。
   **本机仍未跑过**：沙箱里 Chrome 起不来（`spawn EPERM`），这段是照 DOM 选择器（`.hxcard.is-tappable` /
   `.hxcard.is-armed`，与 `hexOverlay.js` 对照过）写的，上机第一次跑请留意这一分支。
3. **正式发布包**：完整包的 `artPlan` 见到 `data/local-assets.json` 就会把 `public/assets/local/**` 一起打包，
   `formatSummary` 会打印一行提醒。**2026-10-12 起本地素材只剩 5 项**：业主自制的 3 张阶位图 + 2 个海克斯音效
   （第三方 mod 的 75 张符文图标、三档边框与三张按钮图已删除）。业主判断这 2 个音效在同人不盈利的前提下可随包分发；
   若要绝对干净，用 `npm run package:lite`（本地素材一概不带）或先移除 `data/local-assets.json`。更新包用
   `node tools/package.mjs --update --from <旧包> --out <目录>`。
4. **平衡回看**：数值已按多次实机反馈调过；`docs/BALANCE.md` §8 已同步到 **66 张**，并把「盟约回响（1阶）与盟约之主
   （棱彩）都是全体 +5 层」记为**下一轮调整的候选**（建议把盟约回响降到 +3 —— 需用户拍板）。再调只改
   `tools/hextech/roster.mjs`，然后 `node tools/build-hextech.mjs && npm run golden:update`。
   **注意**：2026-10-12 起名单不再引用任何素材，改名单只需 `node tools/build-hextech.mjs`（+ `npm run golden:update`）；
   `npm run hextech:import` 现在只维护 2 个音效与 3 张阶位图，不再随名单变化（第二、三批漏重跑的坑见 §4.7）。
5. 可选：把 `hextech` 注册进 `tools/build-i18n.mjs` 的 `DATA_FILES`/`NAME_PRIORITY`，等有官方数据缓存时改走官方式 overlay；
   现在用 UI msgid 通道（离线可维护）。**2026-10-13 复查：缺口已补齐** —— 66 枚玩家 + 24 枚敌方的 `name`/`desc` 共
   **180 条已全部进 `public/i18n/en.json`**（此前记的「174 条里 22 条没进」已不成立）。
6. 可选：`test/ui` 的纯视图用例再补一条（现在覆盖 `normalizeHex` 与 `HexCard`，未渲染整个 `HexOverlay`）。

### 6.1 本轮（2026-10-08 复盘）已修

外部评审列出的缺口里，除「提交」和「队友海克斯可见性」外都已处理，逐条见下表。**golden 未重新生成**（无玩法改动，
`test/golden/*.json` 的 mtime 仍是 06:46，`test/golden.test.js` 9/9）。

| 问题 | 处理 |
|---|---|
| 战斗侧 10 个机制零测试 | 新增 `test/sim/hextech-battle.test.js`（22 例，跑真模拟）；**逐条变异验证**：故意破坏击倒馈赠/北境长城/装甲破坏/盟约裂变各一处，套件都会红 |
| 文档数字过期（10 处） | 全部改成 38+14=52、52 枚符文；`CHANGELOG.md` 补上第三批 19 张的完整条目（原来只字未提） |
| `pendingLp` 没算不灭壁垒的「首漏免费」 | `views.js` / `hud.js pendingLoss` / `teamPanel rowLp` / `ownRoundLoss` 全都减掉 1；m.public `players[].freeLeak` + m.private `freeLeak` 下发标志。实测复现过「显示 −3，结算只扣 −2」 |
| 协议把选项数写死 0..2 | 改成 `HEX_MAX_OFFER`（shared/hextech.js，=6）；`idx=3/4/5` 现在被接受，`6` 被拒 |
| `bondCapOf/fissionBondIds` 两份实现 | 合一到 `shared/hextech.js fissionBondIds`，**顺序显式传入**（原来一边按 `ps.bonds` 插入序、一边按数据序，只是碰巧一致） |
| `withoutHextech()` 会连坐跳过同回合机变 | `enterHexDraft` 空池时走 `afterHexDraft()` 而不是 `enterPrep()`；补了断言 R6 机变仍在 |
| `loadout.test.js` 那条红 | **真因是 0.3.0**：R6 海克斯+机变挤在同一个 100ms 节流窗口，`SP_DRAFT` 那一帧被合并掉（真人玩不会遇到）。测试改成从比赛状态读阶段（不再只看 m.public），断言的是「机变跑过且不计时」 |
| e2e 三个循环等 R1 直接进 PREP | 三个循环都补了 `HEX_DRAFT` 分支（见上面第 2 条） |

**仍未做**（需要用户拍板或本机环境）：
- **两个决策**：① 盟约回响是否降到 +3（与盟约之主重复）；② ~~第三方 mod 图标是否随正式包分发~~ —— **2026-10-12 按业主决定执行**：该 mod 的 75 张符文图标、三档稀有度边框与三张按钮图已从项目与本机素材中删除，只剩 2 个抽取/刷新音效；这 2 个音效经业主 2026-10-12 明确**保留**（LoL 音效、同人不盈利），删除前的本地备份 `_removed-hextech-mod-art-20261012\` 也于同日彻底删除（源 pck 早已不在本机，故不可恢复）。详见 NOTICE.md §2 与 tools/hextech-import.mjs。
- **`players[].hexes` 的队友海克斯 UI**：服务端已下发、客户端无人读（按用户要求跳过）。
- **上机跑一遍 e2e**：本沙箱起不了 Chrome。

---

## 7. 速查

```powershell
$WS  = 'C:\Users\hhyyl\Downloads\Stronghold-Protocol-v0.2.1'
$REPO= "$WS\Stronghold-Protocol-repo"

# 玩（唯一入口；源码树已自包含——素材在 public\assets，不再是 junction）
cd $REPO; npm start                       # → http://localhost:3000

# 只玩整合包：2026-10-11 起 Stronghold-Protocol\ 已合并进 repo 并删除，这条不再可用。

# 生成/校验数据
npm run build-hextech; node tools/build-hextech.mjs --check

# 素材
npm run hextech:import; node tools/hextech-import.mjs --check
npm run doctor

# 黄金结果
npm run golden:update                     # 约 45 秒

# 单文件测试（本机唯一可靠姿势）
node test/match/hextech.test.js
```

**绝对不要**：删掉源码树里 `public/assets`/`public/fonts` 这两个 junction 之外的整合包内容；手改 `data/*.json`；
把 `public/assets/**` 提交进 git；把 `/assets/local/...` 写进 `data/assets.json`；直接向 `sganggs/Stronghold-Protocol` push。
