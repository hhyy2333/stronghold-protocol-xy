# 两个 mod 的「进入」按钮出现速度 · 前后对照

日期：2026-11-05 · 业主原话：「战地商店和证券交易所这俩 mod 的进入那个按钮是在展开商店一段时间之后才刷出来，
能不能优化一下他的出现速度」。

改动落在两处（两个包自己**没有**入口时机的问题）：

| 位置 | 改动 |
|---|---|
| `public/js/ui/slotHostWatch.js`（新增）+ `public/js/ui/extensions.js` | 组件渲染出 `[data-mod-slot]` 宿主的那一刻就触发一次挂载尝试（登记一个 `MutationObserver`，`dispose()` 收回去）。以前只在 **store 变化** 时重试，而商店栏的「收起 / 展开」是 `screens/game.js` 的 `useState`，一个字节都不写 store |
| `workshop/field-store/ui/store.js`、`workshop/originium-exchange/ui/exchange.js` | 面板挂上就**立刻**向服务端要一份状态（以前分别是 400 ms / 1200 ms 之后才问），拿到一帧就停 |

## 对照图（同一场景、同一视口、同一主题、同一相位）

| 文件 | 说明 |
|---|---|
| `before-expanded-150ms.png` | **改动前**（HEAD `be1fb2d`）。收起商店栏 → 再展开，**+150 ms** 时截图：按钮行里只有 `冻结 / 刷新`，两个 mod 的按钮都不在 |
| `after-expanded-150ms.png` | **改动后**。同样收起 → 展开，同样 **+150 ms**：`¥ 交易所` 与 `商店` 已经并排在 `冻结` 左边 |

两张都是**真的应用**（真服务器、真对局、真 `welcome.modPanels`、真的两个工坊包），1280×720，单人模拟（`?playtest=1`）
一路点到休整期（PREP；机变 / 协议源石抽取那两段面板本来就该藏着），面板默认收起，点「收起」再点「展开」后取一帧。

## 实测数字（同一条脚本，两个 checkout）

`node public/dev/mod-entry/measure.mjs <label>`：rAF 轮询 `.fst__tab` / `.oex__tab` 什么时候真的可见（8 s 封顶）。

| | 面板挂上 | `商店` 可见 | `¥ 交易所` 可见 |
|---|---|---|---|
| 改动前（HEAD，`git worktree`）循环 1 | 1346 ms | 1346 ms | 2551 ms |
| 改动前 循环 2 | 420 ms | 420 ms | 1626 ms |
| **改动后** 循环 1 | **9 ms** | **24 ms** | **35 ms** |
| **改动后** 循环 2 | **6 ms** | **21 ms** | **26 ms** |

改动前那两列是**碰运气**的：它等的是「下一次对局状态变化」，所以 0.4 s ~ 3.8 s 之间飘，玩家看到的就是「过一会儿
才刷出来」。改动后按钮在展开的那一帧就回来（几次运行的区间：面板 6–12 ms、`商店` 21–29 ms、`¥ 交易所` 26–40 ms；
后者多等一帧行情，因为它在 `root.hidden` 里等第一份 `market`）。

## 怎么重跑

```bash
# 改动后
node public/dev/mod-entry/measure.mjs after
# 改动前：在基线 checkout 里跑同一个脚本（例如 git worktree add ../base HEAD）
node public/dev/mod-entry/measure.mjs before
```

需要 `npm ci`（`puppeteer-core` 是 devDependency）、一个本机 Chromium（默认找 Edge，`CHROME_PATH` 可覆盖）。
脚本会自己起服务器（随机端口）并在结束时关掉；截图写在**本文件所在的目录**，标签就是文件名前缀。
