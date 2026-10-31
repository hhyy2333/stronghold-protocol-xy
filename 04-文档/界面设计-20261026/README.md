# 界面完善设计稿 · 标题 / 大厅 / 战绩

> 目标：用「其他解包文件（用户界面素材、交互界面切图等）」这批官方 UI 切图，把**标题屏、大厅屏、战绩屏**
> 三屏的界面补完。基准平台：**PC 横屏为主，兼顾手机横屏**（与工程现有 root scale 一致）。
>
> 工程根：`Stronghold-Protocol-Forge-协议源石版\app`（下称 `app/`）
> 解包根：`C:\Users\hhyyl\Downloads\其他解包文件：用户界面素材、交互界面切图等\其他解包文件：用户界面素材、交互界面切图等`（下称 `解包/`）
>
> 生成日期：2026-10-26 · 依据：源码 + CSS + `data/assets.json` + `data/local-assets.json` + 磁盘素材核对

---

## 0. 交付清单

| 文件 | 内容 |
|---|---|
| [README.md](README.md) | 本文：结论摘要、设计系统基线、素材三条通道、适配基准、本次改动 |
| [01-标题屏.md](01-标题屏.md) | 标题屏：结构 → 布局 → 组件 → 状态 → 视觉 → 文案 → 可访问性 → 素材方案 |
| [02-大厅屏.md](02-大厅屏.md) | 大厅屏：同上，重点在「模式入口卡 + 招募房间 + 匹配中」三块 |
| [03-战绩屏.md](03-战绩屏.md) | 战绩屏：同上，重点在评语六边形与官方统计框 |
| [04-素材接入映射表.md](04-素材接入映射表.md) | 逐条映射：界面位置 → 素材键/文件 → 现状态 → 接入方式 → 尺寸 → 降级 |
| [05-落地清单与验收.md](05-落地清单与验收.md) | 分三批落地顺序、改动文件、验收命令、风险 |
| [06-大厅场景背景.md](06-大厅场景背景.md) | **大厅背景已换成官方战场场景**：复用了什么、降级链、换场景、性能、验收 |

---

## 1. 结论摘要（先看这四条）

1. **战绩屏的官方素材全部掉线（已修，1 条命令）。**
   `app/data/assets.json` 的 `ui` 里**没有一条 `statistics/*` 键**（0 条），而
   `app/public/assets/ui/statistics/` 下**37 个文件真实存在**（`heading-bar.png`、`title-mask.svg`、
   `count-glow.png`、`achievement-tier-1..6.png`、`number-font.woff2` …）。
   后果：`stats.js` 里 20 处 `uiUrl(manifest, 'statistics/…')` 全部返回 `null` → 成就标题条、评语六边形的
   遮罩与光晕、稀有度框、精英框、官方数字字体**全部静默降级成 CSS 画的样子**。
   对照：`参考\20261016-093237\Stronghold-Protocol-v0.3.0\...\data\assets.json` 里有这 37 条（639 − 602 = 37）。
   **本次已用仓库自带工具修复**：`node tools/fetch-stats-assets.mjs`（详见 §5）。

2. **大厅的官方切图几乎一张没用上。**
   `data/local-assets.json` 的 `ui/outer` 有 **659 条**、`ui/battle` **389 条**、`ui/common` **160 条**，
   但被代码引用的只有 **10 / 47 / 6** 条。也就是说 **649 条 `ui/outer` 官方图躺在盘上没人用**——
   其中包括整套模式选择美术（`normal_chess_01..03`、`abyss_rhodes_island`、`hard_desc_text`、
   `funny_id_card`、`*_thorn_*`、`*_link_line_*`）、匹配横幅（`banner_matching_*`）、
   房间选择（`room_select_*`）、玩家卡（`player_card_*`）、准备态（`bg_top_ready` / `icon_prepared`）。
   大厅现在的模式入口卡是**纯 CSS 渐变 + 图标**（`lobby.css:954 .hub-entry`），这是最大的观感落差来源。

3. **标题屏的官方底图已在用，但只有一张、且分辨率偏低。**
   `title.js:62` 的 `BACKDROP_KEYS = ['titleBackdrop','entry/bkg_01','entry/bkg_02']` 命中
   `entry/bkg_01.png`（**1024×460**，`app/public/assets/ui/entry/bkg_01.png`）——
   在 1920×1080 上等于放大约 1.9×。`titleBackdrop` 这个键**没有登记**，所以永远走不到。
   解包里有更好的原料：`解包/其他解包文件更新9/活动 (activity)/entry_bg[#1].png`（**1566×965** 完整插画）、
   `entry_bg_tree[#1].png`、`entry_bg_bird[#1].png`、`entry_lines.png`、`entry_line_input.png`、
   `rain.png` / `snow.png` / `glow.png` / `spark.png` / `light_left|right.png` —— 正是官方登录页的分层视差素材。

4. **解包里还有 30 张「转场/遮罩」切图没进清单**，它们只做视觉过渡，不影响玩法：
   `ui/outer` 缺 19 张（`img_uifx_sweep_01`、`img_uifx_wipe_tech_01`、`img_uifx_wipe_polar_grad`、
   `img_fx_hori_dissolve`、`blank_dissolve`、`dissolve_triangle`、`mosaic_disturb`、`img_fx_spritesheet` …），
   `ui/battle` 缺 11 张（`both_mask_v`、`head_mask_v`、`bottom_mask_v`、`img_uifx_star_4`、`splitter` …）。
   用途见 [04-素材接入映射表.md](04-素材接入映射表.md) §4。

---

## 2. 设计系统基线（照抄，不要另起一套）

全部取自 `app/public/css/theme.css`，**新界面只准用这些 token**。

### 2.1 尺寸基准

| 项 | 规则 | 出处 |
|---|---|---|
| 设计像素 | `1rem = 100 设计px`（1920×1080 下） | `theme.css:120-124` |
| root 缩放 | `font-size: clamp(40px, min(100vw/19.2, 100svh/10.8), 240px)` | 同上 |
| 文字根 | `--t`（默认 `1rem`；设置里 小/中/大/特大 = `1 / 64px / 76px / 88px`） | `theme.css:142-145` |
| 写法 | 布局写 `.24rem`，字号写 `calc(.18 * var(--t))`，手机必须 `max(.18rem, 12px)` | `theme.css:156`、`stats.css:6` |
| 1px 线 | 永远写 `1px`，不要写 `.01rem` | `theme.css:7` |

### 2.2 颜色

| 用途 | Token | 值 |
|---|---|---|
| 底层/面板 | `--bg-0..4` | `#0c0f0e` `#141816` `#1e2421` `#252c29` `#2d3632` |
| 玻璃 | `--bg-glass` | `rgba(16,20,18,.82)` |
| 分隔线 | `--line` `--line-2` `--line-3` | `#2f3a35` `#3e4b45` `#58675f` |
| 主强调（薄荷） | `--mint-500` `--mint-400` `--mint-600` `--mint-glow` `--mint-700/800/900` | `#4ed8af` `#59f4ca` `#35d8b4` `#17f9b7` `#2a9e7f/#145443/#0d2c24` |
| 价格/稀有 | `--gold` `--gold-2` `--amber` | `#ffc600` `#f2bd3e` `#f6a329` |
| 警示 | `--orange` `--orange-hi` `--red` `--red-abyss` `--red-premium` | `#e85a1a` `#ff7a33` `#e73118` `#ff0024` `#ff5454` |
| 冷色 | `--ice` `--ice-900` | `#9fd4ff` `#14283a` |
| 文字 | `--text-hi` `--text-md` `--text-lo` `--text-dim` `--text-on-mint` | `#f2f2f2` `#c3cbc7` `#8a948f` `#5d6863` `#06110d` |
| 难度 | `--diff-funny/normal/hard/abyss` | `#f6a329` `#e85a1a` `#e73118` `#ff0024` |
| 阶位 I–VI | `--tier-1..6` | `#a8a8a8 #f2f2f2 #34e6b2 #34b8d8 #f8bf00 #f88000` |

### 2.3 字体与字号阶梯

| 用途 | Token / 值 |
|---|---|
| 中文正文 | `--font-cjk`（Noto Sans SC → PingFang SC → …） |
| 数字/等宽 | `--font-num`（Bender / Rajdhani / Oxanium，`tabular-nums`） |
| 展示标题 | `--font-display`（Novecento Wide / Oxanium，`letter-spacing:.12em` + 大写） |
| 微标签 | `.micro`：`calc(.11*var(--t))` / `letter-spacing:.18em` / 大写 / `--text-dim` |
| 标题 | `.title-cn` `calc(.46*var(--t))` 级、`font-weight:900` |
| 正文 | `calc(.18*var(--t))`（`body` 默认） |
| 说明 | `calc(.15*var(--t))` `--text-lo` |

### 2.4 组件基线（直接复用，不要新造）

| 组件 | 规格 | 出处 |
|---|---|---|
| `.btn` | 高 `.5rem`、`padding 0 .26rem`、`border 1px`、字号 `.18t`、四角 `.1rem` 括号 | `components.css:10` |
| `.btn--sm/lg/xl` | `.36 / .64 / .84rem` | `components.css:167-169` |
| `.panel` | 扫描线 + 深色渐变 + `1px --line` + `0 .12rem .3rem rgba(0,0,0,.35)` | `components.css:178` |
| `.tabs` | 底边 `1px --line`，选中 `--mint-400` + 下划线 scaleX | `components.css:551` |
| `.field` | label `.15t --text-lo`；box hover `--line-2`、focus `--mint-700` + 括号变 `--mint-400` | `components.css:887` |
| 括号角 `.brackets` | `--bk-c` 色、`--bk-l .14rem`、`--bk-w 2px`，用 8 段渐变画 L 形角 | `theme.css:203` |
| 扫描线 `.fx-scan` | `repeating-linear-gradient` + `mix-blend-mode:screen` | `theme.css:222` |
| 噪点 `.fx-noise` | 内联 SVG `feTurbulence` | `theme.css:233` |

### 2.5 动效与层级

| 项 | 值 |
|---|---|
| 缓动 | `--ease-out: cubic-bezier(.2,.8,.2,1)`、`--ease-in-out: cubic-bezier(.6,0,.3,1)` |
| 时长 | `--t-fast 150ms` / `--t-med 200ms` / `--t-slow 250ms` |
| 层级 | screen 1 < banner 40 < conn 60 < announce 78 < modal 80 < toast 90 < tooltip 95 < rotate 100 |
| 减动效 | 所有动画必须能被 `@media (prefers-reduced-motion: reduce)` 关掉（现有三屏都做了，新加的要跟） |

---

## 3. 素材的三条通道（选型规则）

界面要图时，**按这个顺序找，不要新开通道**：

| 通道 | 清单 | 读取函数 | 适用 |
|---|---|---|---|
| ① 官方通用 UI | `data/assets.json` → `ui['group/name']` | `uiUrl(manifest,'group/name')`（`js/ui/assetUrls.js:36`） | 官方 webview / 官方 UI 图，**随仓库走**，任何机器都有 |
| ② 本机客户端提取 | `data/local-assets.json` → `groups['ui/outer'\|'ui/battle'\|'ui/common'][name].path` | `localAsset(group,name)`（`js/data.js:538` 附近） | 官方客户端解包图，**只在本机**（`public/assets/` 被 git 忽略） |
| ③ CSS/SVG 画 | — | 直接写样式 | 前两者都没有时的兜底，必须留 |

**硬规则**（来自 `app/AGENTS.md` + `docs/ASSETS.md`）：

- `public/assets/**` 永不进 git；`data/assets.json` 由 `tools/fetch-assets.mjs` 生成，**不要手改**（要改就改工具再跑）。
- 每条取图调用都必须有**降级**：`uiUrl`/`localAsset` 返回 `null` 时画出 CSS 形状或字形，绝不留空白框。
- 玩家可见文案走 `t('中文')`，五个语言包都要有（`public/i18n/*.json`）。
- 界面若被插件插槽引用（`data-ui-slot`），新组件不要破坏 `slot` 位置。

---

## 4. 适配基准与断点（三屏通用）

| 断点 | 含义 | 现状 |
|---|---|---|
| 1920×1080 | 设计基准（`1rem = 100px`） | 主战场 |
| ≥1280×720 | 桌面窗口化 | 正常 |
| 高度 ≤660 / ≤560 / ≤520 | 矮窗口（手机横屏、笔记本分屏） | `title.css:636/648/673` 逐级压缩 |
| 宽高比 ≤1/1 | 竖屏 | `title.css:687`、`lobby.css:1033`、`stats.css` |
| 触屏（`.sp-touch/.sp-coarse`） | 手指目标 ≥ 32–36px | `lobby.css:1044+` 已放大入口卡 |
| 文字大小 中/大/特大 | 只动 `--t`，不动布局 | `theme.css:143-145` |

**新增元素的验收尺寸**（照现有值，别自创）：

- 可点区域 ≥ `.36rem`（36 设计px），手机 ≥ 32px 实际像素；
- 卡片圆角/括号角 ≥ `.1rem`；卡片间距 `.12–.24rem`；
- 图标 `.17–.24rem`（列表）/ `.44–.46rem`（大按钮）；
- 主按钮高 `.84rem`（`--xl`），次按钮 `.5rem`，工具按钮 `.36rem`。

---

## 5. 本次已做的改动（2 组，均可回滚）

### 5.1 战绩屏 37 条 `statistics/*` 素材键（批次 0）

**改动**：把 37 条 `statistics/*` 键写回 `app/data/assets.json`（`ui` 键 602 → 639，**0 条被删**）。

**命令**（仓库自带工具，不联网也能跑，37 个文件都在盘上 → 全部 `skip`）：

```powershell
cd C:\Users\hhyyl\Downloads\Stronghold-Protocol-v0.2.1\Stronghold-Protocol-Forge-协议源石版\app
..\node\node.exe tools/fetch-stats-assets.mjs
```

**验证结果**（本次实测）：

- `ui` 键 `602 → 639`，新增 37，删除 0；
- `statistics/titleMask` → `/assets/ui/statistics/title-mask.svg`（文件存在）；
- `statistics/fontStyles` → `/assets/ui/statistics/fonts.css`（文件存在）；
- `statistics/headingBar` → `/assets/ui/statistics/heading-bar.png`（文件存在）；
- **端到端实测**：新起的服务端 `GET /data/assets.json` **含** `statistics/titleMask`（响应体比改动前大 3,305 字节）；
  改动前的老进程仍返回旧清单（服务端在启动时读一次清单并缓存）→ **改完必须重启服务器才生效**。
- `test/asset-paths.test.js` 2/2 通过；`test/ui/assetUrls.test.js` + `test/ui/stats.test.js`
  **改动前后同为 44 通过 / 5 失败**（那 5 条是既有失败：`chess_char_6_21_a`、`band_admin2` 等本机自制内容缺条目，与本次无关）。

> 顺带核过 `node tools/doctor.mjs`：它报的 ✘ 是「410 个文件与 v0.18.6 底座不一致」——
> 这棵树本来就是**打了协议源石补丁**的成品，属既有状态；且 `data/assets.json` **不在** `MANIFEST.json` 的校验清单里，
> 本次改动不影响这条。

**回滚**：

```powershell
cd C:\Users\hhyyl\Downloads\Stronghold-Protocol-v0.2.1\Stronghold-Protocol-Forge-协议源石版\app
git checkout -- data/assets.json          # 回到提交版（会丢掉你本地其它 assets.json 改动，先确认）
# 或只回滚本次：用本次备份
copy ..\..\.scratch\assets.json.bak data\assets.json
```

> 注意：`app/data/assets.json` 在本机**本来就有未提交改动**（`git status` 显示 `M`）。
> 上面第一条 `git checkout` 会把那些改动一起丢掉；只想回滚本次就用第二条。

### 5.2 批次 1 的 4 处界面改动（2026-10-26）

| 文件 | 改了什么 | 回滚 |
|---|---|---|
| `public/js/screens/lobby.js` | `HubEntry` 加官方陆行舰剪影底纹（`HUB_ENTRY_ART`，`localAsset('ui/outer', …)`，取不到就不渲染） | `git checkout -- <文件>` |
| `public/css/screens/lobby.css` | 新增 `.hub-entry__art` 规则组（去色 22% 透明度 + 左渐隐遮罩 + hover/减动效/手机横屏分支） | 同上 |
| `public/js/screens/stats.js` | 空态换成 `.st-emptybox`（官方装饰图 + 文案 + 导入按钮）；页签补 `id`/`aria-controls`，`<main>` 变 `role="tabpanel"` | 同上 |
| `public/css/screens/stats.css` | 新增 `.st-emptybox` 规则组 | 同上 |
| `public/js/screens/title.js` | 代号「填了东西但仍无效」时行内标红 + 提示（`invalid`/`hint`） | 同上 |
| `public/css/components.css` | `.field.is-invalid .field__hint { color: var(--red-premium) }` | 同上 |

**验证**：`node --check` 三个 JS 全 OK；`eslint` 0 error（8 条既有 warning）；
`test/ui/stats.test.js` + `test/ui/difficulty-remember.test.js` → 44 通过 / 3 失败（3 条为既有失败）；
**没有新增任何 i18n 键**（复用了 `请输入博士代号` / `还没有记录…` / `导入`，四语包均已存在）；
起服务实测 8 个 URL 全 200。

**降级演练（务必做一次）**：把 `public/assets/local/ui/outer/normal_rhodes_island.png` 临时改名后刷新大厅 ——
入口卡应回到原来的玻璃砖，**不出现破图或空白**。做完改回来。

---

## 6. 假设与未做的事（写清楚，免得误读）

- **假设**：`解包/` 这批图是官方客户端的 UI 切图，用途按文件名 + 与官方界面截图对照推断；
  个别图的官方用途没有权威出处，文档里标了 `[推断]`。
- **没做**：本沙箱里无头 Edge 起不来（`mojo platform_channel` 被拒），**无法出实时截图**。
  本稿的现状判断全部来自源码/CSS/清单/磁盘核对，视觉结论引用的是工程里已有的历史截图
  （`04-文档/截图-0.19发布-20261017/`、`Stronghold-Protocol-Forge-协议源石版/app/.scratch/lobby-01913*.png`）。
- **没做**：本稿只出设计与接入方案 + 1 条已验证的素材登记修复，**不改任何 CSS/JS 视觉实现**；
  落地批次见 [05-落地清单与验收.md](05-落地清单与验收.md)。
