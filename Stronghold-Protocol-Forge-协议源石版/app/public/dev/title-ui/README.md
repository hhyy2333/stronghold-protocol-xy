# 开始界面（标题页）视觉改版 · 未来感版

日期：2026-10-24 · 改动：`public/css/screens/title.css`（重写）+ `public/js/screens/title.js`（加 3 个装饰节点 / 4 个分组容器，无逻辑改动）

打开 `compare.html` 拖动中间的分割线即可左右对照。右上「左侧对照」可以切 **上一版·战术** 或 **原始版**；左侧是旧版，右侧永远是本版。

| 文件 | 用途 |
|---|---|
| `compare.html` + `compare.js` | 交互对照（分割线；可切 1600×900 / 1366×768 / 844×390 / 1080p） |
| `title-preview.html` + `title-preview.js` | 单屏预览。`?v=before\|tactical\|after`，`?only=console` 只看控制台 1:1，`?probe=1` 输出实测坐标 |
| `title.before.css` | 最初版的 `title.css` 快照 |
| `title.tactical.css` | 上一版（战术 / 版式稿）的 `title.css` 快照 |
| `fx-1600.png` / `fx-real.png` / `fx-phone.png` | 本版整屏（1600×900 静态稿 / 1920×1080 实机 / 844×390 实机） |
| `fx-console.png` | 本版控制台 1:1 |
| `shot-before.png` / `shot-after.png` / `console-*.png` | 前两版的对照图 |
| `shot.mjs` | CDP 截图脚本（`node shot.mjs <url> <out.png> <w> <h>`，`SP_TYPE=xxx` 可真实键入代号） |

> 预览页脚本都在外部 `.js`：站点 CSP 是 `script-src 'self'`（`server/http/csp.js`），内联 `<script>` 会被拦掉。

---

## 一、本版的视觉语言（未来感）

上一版是"战术终端 / 军用纸张"：炭黑 + 薄荷绿、直角、细描边、克制。本版换成 **全息控制台**：

| 手段 | 做法 |
|---|---|
| **霓虹** | 主色提到 `#35ffc4`（比 `--mint-500` 更亮更青），副高光用冰蓝 `#7ce7ff`；页面其余部分压到近黑，让霓虹成为唯一光源 |
| **透视网格地面** | `.title-bg__grid`：一个 `rotateX(65deg)` 的网格平面，父级 `perspective: 44rem` + `perspective-origin: 50% 52%` 定住消失点，缓慢向前漂移（18 s 一格） |
| **玻璃控制台** | 1px 霓虹边 + 顶部角光 + 内投影 + 外发光 + `backdrop-filter` 磨砂；内部叠扫 1px/3px 描线，每 7 s 一次光带扫过 |
| **斜切几何** | 顶边一条 2.4rem 的斜切导光条；`开始` 按钮右下角 `clip-path` 切角（硬件键而不是矩形）；右上 / 左下各一道冰蓝短刻度 |
| **HUD 标尺** | 副标题下压一条带刻度的标尺线；状态行分隔线改为左亮右隐的霓虹渐变；在线指示点改成呼吸光 |
| **发光层次** | 徽标背后加径向光晕，圆点矩阵自带 mint drop-shadow；`ALLIANCE` 与 `盟约` 三层叠加光晕 |

排版（层级、对齐、8px 网格、响应式断点）沿用上一版，没有回退。

## 二、沿用的排版结论

- **层级**：角标 → 品牌块（徽标 / 英文名 / 中文标题 / 副标题）→ 控制台（身份 → 开始 → 素材 → 状态｜工具）→ 页脚
- **对齐**（1920×1080 实测）：输入框 / 开始 / 素材 / 状态行左右边界完全重合（`713 — 1207`）；全页中轴 `x=960`；右上工具行与 TARGET POINT 右边缘同为 1852
- **节奏**：8px 网格（`.08 / .16 / .24`），控制台内距 `.22 / .32 / .2`
- **按钮三级**：主 `.78rem`（mint 实心 + 切角）/ 次 `.4rem`（透明 + 霓虹细边）/ 工具 `.36rem`（ghost 与 ⚙⛶ 同尺寸）
- **响应式**：`≤660px` 高降档；`≤520px` 隐藏徽标 / 副标题 / 小字，玩法说明收成图标钮；竖屏控制台吃满宽度。844×390 实测 `overflow = 0`

## 三、仍然免不了的三个硬伤修复（上一版已修，本版保留）

1. 素材行原本 `width: 4.9rem` 撑在 `4.9rem` 面板里，比内容区宽 53px、顶到边框 → `width: 100%`
2. 状态行六个元素挤一行导致「已连接服务器」折行 → 面板 4.9→5.6rem、拆左右两组 + 分隔线
3. `test/ui/fsGate.test.js` 要求的 `.title-foot { pointer-events: none }` / `.title-foot a, .title-foot button { pointer-events: auto }` 在现行 CSS 里已丢失 → 补回（短屏时页脚会压住 ⚙ / ⛶ 的点击区）

## 四、手机端（2026-10-24 第二修）

手机上暴露了三个问题，都在 `@media (max-height: 560px)` 这一段里解决：

1. **素材行留半个空位**：Android 浏览器没有 File System API，`ui/assetImport.js` 的 `importButtonShown()` 为假，
   「导入素材包」整个不渲染；而 `.title-assets` 原本写死 `grid-template-columns: repeat(2, 1fr)`，于是「预载素材」
   只占左半格，右边一个空洞。改成 `grid-auto-flow: column` + `grid-auto-columns: minmax(0,1fr)`：有几个入口就分几列，
   只剩一个时占满整行。
2. **页脚掉出屏幕**：`1rem` 在手机上被 `clamp` 卡在 40px，19.2×10.8 张画布比可见高度高，而页脚是
   `position: absolute; bottom: .3rem`——直接落到屏幕外面（截图里那行版权被切掉一半）。560px 高以下页脚回到文档流
   （`position: static` + `align-self: stretch`），`.title-main` 取 `flex: 1` 并在剩余高度里自己居中，页面怎么裁都不会丢页脚。
3. **横屏 2:1 的宽度白扔**：单列时卡片只有屏宽的四分之一，两边全是空的。`min-width: 620px` 且高度 ≤560px 时整页转成
   左右双栏——左边品牌块（右对齐贴着卡片），右边控制台（加宽到 6.2rem）。竖屏仍走单列。

实测（1082×487，模拟触屏 `pointer: coarse`）：素材行单入口时按钮宽 254 = 卡片内容宽，页脚 top 464 / 视口 487；
1920×1080 桌面端完全不变（面板 560、四行边界 713—1207、`overflow = 0`）。

## 五、性能与降级

- 网格漂移、雷达扫描、面板光带都在 `prefers-reduced-motion: reduce` 下停掉（光带直接隐藏）
- 全部是 CSS 渐变 / 变换，没有新增图片请求；新增 DOM 只有 `<div class="title-bg__grid">` 和 `<i class="title-login__holo">`
- 有背景大图时（`title-bg.has-art`）网格与雷达会压在图上，网格透明度已按此调过

## 六、怎么在本机看

游戏进程开着时直接访问：

```
http://127.0.0.1:3000/dev/title-ui/compare.html
```

游戏没开时，在 `app/public` 下起静态服务（字体走 `/fonts/…` 绝对路径，必须以 `public` 为根）：

```sh
cd app/public && python -m http.server 8792
```

> `sw.js` 会缓存静态资源，改完 CSS 记得 Ctrl+F5 或清一次 service worker。
