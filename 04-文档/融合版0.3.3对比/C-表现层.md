# 融合版 0.3.3 对比 · C：表现层（开场动画 / 大厅背景与自选媒体 / 图像代理）

> 问题（业主 2026-11-01）：「`...\Stronghold-Protocol-v0.3.3-Fusion` 看看这个有什么值得吸取的」。
> 融合版：`C:\Users\hhyyl\Downloads\卫戍协议融合版-v0.3.3-电脑版\Stronghold-Protocol-v0.3.3-Fusion`（**只读**，本次未改一字节、未起服务）。
> 我方：`Stronghold-Protocol-Forge-协议源石版/app`（0.19.41，Forge 系 + 协议源石）。
> 口径与分档沿用 [../上游0.3.3对比/00-总纲与建议.md](../上游0.3.3对比/00-总纲与建议.md)：结论先行、三档（值得做 / 只借思路 / 不值得）、**S** ≤ 半天 · **M** ≤ 2–3 天 · **L** > 1 周。
> 本文只写判断与代价，不写代码改动。

---

## §0 一句话

**这层真正值得拿的只有一件：那支 2.8 秒的开场动画（`allianceScene.js` + `lobbyIntro.js`）。它需要的东西——8 张入场贴图、1 个入场音效、Bender 字体、音频管理器的 7 个接口——已经全部躺在我方树里，改动面是「2 个新文件 + `main.js` 一行 + 3 处适配」，S 级，且**不碰我方的标题页与大厅布局**。
其余两项都不值得搬：大厅背景与自选媒体是**同一份代码的后代**（我方是超集的那一半），图像代理的客户端那半在我方还没有插件外链图之前是零收益。**

分档速览：

| # | 项 | 档 | 代价 | 一句话 |
|---|---|---|---|---|
| 1 | 开场动画（金字塔 logo / ALLIANCE / 点击跳过） | **值得做** | S | 素材/音频/字体我方全有，纯新增，不动布局 |
| 2 | 自选背景支持**动图**（GIF/APNG/动画 WebP/AVIF） | 只借思路 | S | 我方把所有图一律重编码成 JPEG，动图被拍成静帧 |
| 3 | 自选音乐**6 分钟上限 + 解码校验** | 只借思路 | S | 我方只按 20MB 卡，20MB 能塞 40 分钟 |
| 4 | 「背景」与「音乐」并成**一个对话框** | 只借思路 | S | 我方现在是顶栏两个入口 |
| 5 | `hubScene.js` + `lobbyMedia.js` 整包搬 | **不值得** | — | 同源后代、类名同族，装了会双背景双音乐 |
| 6 | 「盟约」20 秒昼夜循环背景（`mountAllianceBackdrop`） | **不值得** | M | 融合版里是**死代码**，且已被官方整图取代 |
| 7 | `extImage.js`（`/img-proxy` 的客户端那半）现在就接 | **不值得** | S | 我方没有插件外链图，接了不改变任何观感 |
| 8 | `extImage.js` 等插件平台落地时再接 | 只借思路 | S | 契约一行 `/img-proxy?u=`，但有 2 个坑（见 §4） |

---

## §1 证据基线：谁是谁

同一个功能在两棵树里叫不同名字，先对齐，否则后面每一条结论都会歪。

| 能力 | 融合版 | 我方 | 关系 |
|---|---|---|---|
| 开场动画 | `public/js/ui/allianceScene.js`（754 行）+ `public/js/ui/lobbyIntro.js`（203 行） | **无** | 我方缺件 |
| 大厅程序化背景（四景） | `public/js/ui/hubScene.js`（141 行） | `public/js/ui/hubBackdrop.js` `Scene`（`hubBackdrop.js:233`） | **同源**：同一批 `FAR/MID/NEAR` 种子、同一段山脊 SVG |
| 自选背景 / 音乐 | `public/js/ui/lobbyMedia.js`（526 行） | `hubBackdrop.js`（自选图/视频）+ `lobbyMusic.js`（146 行，自选音乐） | **同源后代**，各有胜负 |
| 外链图代理（客户端） | `public/js/ui/extImage.js`（61 行） | **无** | 我方缺件（服务端 `/img-proxy` 也没有，见 §4） |
| 转场 | `public/js/ui/transitions.js` | `public/js/ui/transitions.js`（70 行） | 同名不同版（我方多 `useRise`/`usePresence`），无缺口 |

两处关键事实：

1. **融合版自己已经对这条血脉下过一次判断**：`MERGE-LOG.md` §2.1 ——「Forge 的 `HubBackdrop` 是这套东西的**前身**，0.3.3 的 `hubScene + lobbyMedia` 是它的超集……硬塞 Forge 版会与 0.3.3 的 `hub-bg__glow/__ship/__own` 类名和 `.hub-bg` 根节点冲突」。**这句话反过来同样成立**，而今天往回看，**超集其实在我方这边**（§3.2）。
2. 融合版的「盟约昼夜循环」是**没接线的代码**：`mountAllianceBackdrop`（`allianceScene.js:297`）全仓只有它自己第 301 行的递归引用，唯一 import 它的 `lobbyIntro.js:14` 只取了 `mountAllianceIntro`。融合版大厅真正的背景是 `screens/lobby.js:461` 里那张静态 `entry_bkg_01` + `entry_bkg_02`。所以 `allianceScene.js` 的 754 行里，**约 150 行（大厅循环 `lobbyState/lobbyFrame/lobbyIdle/mountAllianceBackdrop`）只有开场动画最后一秒当作「假大厅」在用**。

---

## §2 开场动画：值得做（S）

### 2.1 它是什么

不是视频文件，是**逐帧重放的 DOM 动画**：`allianceScene.js` 按官方活动录屏的秒数打表（注释里写明「Rebuilt frame by frame from a recording of the official event (30 fps)」，`allianceScene.js:1-8`），用单调三次插值（`curve()`，`:52-70`）把每帧的位移/缩放/透明度算出来，画在 1280×720 的舞台上（`.spa-stage`，`:80`）。外框是一个 `<dialog>`（顶层，能盖住全屏引导），`lobbyIntro.js:97-114`。

时间轴（都以录屏秒数计）：

| 常量 | 值 | 含义 |
|---|---|---|
| `INTRO_SPAN` | `from 1.2 / fadeAt 3.45 / to 4.0`（`allianceScene.js:425`） | 实际播 2.8 秒，最后 0.55 秒淡出到下面的页面 |
| `INTRO_AUDIO` | `sfxAt 1.6856 / bgmAt 2.1444`（`:423`） | 入场音效点、大厅音乐起点 |
| 跳过 | 点击 / 任意键 / Esc（`lobbyIntro.js:139-142`） | 跳过后音效 0.08 s 收掉，音乐立刻从头上 |

播放条件（`lobbyIntro.js:198-203`）：**每次打开页面播一次**；`room` / `game` 路由、带 `?room=` 邀请（`ui.pendingJoin`）不播；手机只在横屏播（`:35-54`）；`prefers-reduced-motion` **不拦**（作者的判断：那多半只是性能开关，真嫌烦点一下跳过即可）。

### 2.2 依赖清单：逐项对我方树核对，全部命中

这是「值不值得做」的分水岭，所以逐项验过：

| 依赖 | 融合版位置 | 我方是否有 | 证据 |
|---|---|---|---|
| 8 张入场贴图 | `SPRITES`（`allianceScene.js:12-15`）：`entry/entry_bkg_01`、`entry/entry_bkg_02`、`entry/season_logo`、`entry/bkg_01`、`entry/bkg_02`、`entry/bg_mountains_tiled`、`prepareBkg/img_screen_line_repeat`、`prepareBkg/img_bkg_cross` | **全有** | `app/data/assets.json` 里 `entry/*` 8 键、`prepareBkg/*` 5 键齐全；文件在 `app/public/assets/ui/entry/`（8 个）与 `ui/prepareBkg/`（5 个） |
| 贴图 URL 解析 | `spriteUrl()`（`:31-35`）读 `data.get('assets').ui[key]` | 同形 | 我方 `screens/title.js:71-93` 的 `findUiAsset()` 就是同一套读法（`ui` 按 `group/key` 索引） |
| 入场音效 | `/assets/audio/sfx/customse/act1autochess/act1autochess_g_ui_load.mp3`（`lobbyIntro.js:16`） | **有** | 文件在 `app/public/assets/audio/sfx/customse/act1autochess/`，且已进 `app/data/assets.json` |
| 大厅乐（intro+loop） | `resolveBgm(assets,'lobby')` → `{intro, loop}`（`lobbyIntro.js:60-62`） | **有** | `app/public/js/audio.js:186-199` 返回同一形状；`assets.json` 的 `audio.bgm.lobby` 有 `intro` 与 `loop` 两个键 |
| 字体 | `document.fonts.load('300 40px Bender' / '400 40px Bender')`（`lobbyIntro.js:144-146`） | **有** | `app/public/fonts/bender-light.woff2`、`bender-regular.woff2`（`fonts.css` 已在 `css/theme.css` 引用） |
| 音频接口 | `audio.ctx` / `bgmSilent` / `playBgm` / `volumes` / `_buffer` / `sfxGain` / `_fadeOutBgm` / `bgmToken` / `lastBgmKey` / `lobbyMusicOverride` | **全有** | `app/public/js/audio.js:746-751, 777, 876, 987, 999-1006, 1019, 1097-1141`；`lobbyMusicOverride` 由 `ui/lobbyMusic.js:91` 安装 |
| 路由/状态 | `selectRoute` / `store`（`lobbyIntro.js:11`） | 有，语义相同 | `app/public/js/store.js:152-163`（多一道 `entryGateBlocked`，不影响「不播」判定） |

**结论：这是一件「零内容缺件、零数据依赖」的移植**——这也是它和 0.3.3 那一串规则/数据项最大的不同（后者每一条都要动生成器）。

### 2.3 搬到我方要改几处

| # | 位置 | 改什么 | 量 |
|---|---|---|---|
| 1 | 新增 `app/public/js/ui/allianceScene.js` | 原样取（754 行）。若只做实开场、不要假大厅结尾，可裁到 ≈400 行（见 2.4⑤） | 新文件 |
| 2 | 新增 `app/public/js/ui/lobbyIntro.js` | 原样取（203 行）+ 3 处适配（下表） | 新文件 |
| 3 | `app/public/js/main.js` | import 两处（比邻 `main.js:53-77` 那一片）+ **一处调用**：放在 `render(html\`<${App} />\`, root)`（`main.js:683`）之后、`splash` 淡出（`:687-691`）附近，与融合版 `main.js:489-491` 同一位置 | **+3 行** |
| 4 | `app/public/js/screens/title.js` / `lobby.js` | **一行都不用改**（见 2.4①） | 0 |

三处必须适配（否则会踩空）：

| 适配点 | 融合版写法 | 我方要换成 |
|---|---|---|
| 素材就绪判定 | `resourcesReady = () => true`（`allianceScene.js:17`，理由见 `:16` 注释「0.3.3 serves /assets from the game server itself」） | 我方素材可能是**没下载**的（标题页本来就有「CSS/SVG 兜底」与「下载完整素材」两条路：`screens/title.js:9-12, 263-266`）。改成：`sprite 预加载结果 ≥ 全部 8 张` 才播，否则静默跳过。**这是本移植唯一真正的技术活**（`preloadSprites` 目前永远 resolve `undefined`，要让它把成功数交出来，≈20 行） |
| 自己音乐的在播判定 | `audio.lobbyTrack`（`lobbyIntro.js:72`，融合版 `lobbyMedia` 的字段） | 我方没有这个字段，等价物是 `audio.lobbyMusicOverride`（`ui/lobbyMusic.js:91`）+ `record.enabled` |
| 「点击进入 / TAP TO START」 | `PACKAGING.md:146` 说要点一下 | **代码已经改了**：`lobbyIntro.js:104-112` 现在主动 `audio.ctx.resume()`，500 ms 拿不到就**静音放**；`CSS` 里的 `.spa-entry__gate`（`:25-29`）成了没人用的死样式。**以代码为准，别按文档做 Tap 闸门** |

### 2.4 风险与坑

① **「我方标题页/大厅布局与那份 0.2.4 分支不同，硬套会丢功能」——这条风险在开场动画上不成立，但要说清为什么。**
开场动画是**盖在整个页面之上的一层 modal**，不看也不改页面里有什么。我方标题页比融合版多出来的一堆东西一件都不会丢：`下载完整素材` / `导入素材包`（`title.js:263-266`）、通知 / 语言 / 统计（`:230-233`）、全屏（`:279`）、复活对局 / 装到桌面（`:291-292`）、邀请提示（`:251-254`）；大厅侧更多：无限火力（`lobby.js` 15 处）、局域网找房（`lobby.js:2` 处）、协议源石禁用入口、好友 / 账户 / 成就、素材闸门（`lobby.js:1094`）。
**真正会丢功能的做法是另一件**：顺手把融合版的 `title.js`（297 行）/ `lobby.js`（808 行）换过来 —— 我方是 302 / **1415** 行，换过去等于删掉上面这半屏功能。**做开场动画 ≠ 换前端**，这条边界要写进任务单。

② **素材没下载的机器会黑 2.8 秒。** 融合版靠 `whenResourcesReady(15000)` → `preloadSprites(undefined, 3000)` 兜（`lobbyIntro.js:147-152`），但它的 `resourcesReady()` 恒真，等于没兜。我方必须自己兜（见 2.3 适配点 1）。

③ **文档与代码漂移**：`PACKAGING.md:146` 的「第一次需要点一下」已过期（见上）。搬的时候只信代码。

④ **演出观感风险**：那块"外星字母"行是运行时生成的多边形（`allianceScene.js:428-448`），在截图里读起来就是**一排白块**（`03-opening-film.png`，见 §5）。业主或玩家有一定概率把它当成「字体没加载」。若要降低误解，最省的做法是把它压暗一点或干脆不画（一处 `show()`）；不建议重做。

⑤ **结尾的"假大厅"要不要留？** 融合版最后 0.35 秒在 film 内部画了一个重建的「盟约大厅」画面（`introHTML()` 里的 `lobby` 层 `allianceScene.js:464`，`render()` 里 `lobbyFrame` `:744`），然后整层淡出露出真正的页面。这招只对「下面正好是同一个大厅」才自然；融合版下面其实是**标题页**（`main.js:489` 先 render 标题，`:491` 才播开场），所以它其实是"假大厅 → 真标题页"的淡切，靠两边都是深青色调蒙过去。
我方建议：**保留**（观感更完整，且我方标题背景本来就是 `entry/bkg_01` 那套素材，色温一致），但要接受"它画的不是我们的大厅"；想省事就裁掉 `lobby` 层，让 logo 直接淡出（少 ≈150 行，接缝略硬）。

⑥ **每次打开都播**：融合版是每次 page load 一次（`lobbyIntro.js:193-203`）。我方若担心频繁刷新的玩家烦，加一个 `localStorage` 开关即可（`loadPref/savePref`，`hubBackdrop.js:8` 已有同款用法），S 级增量。

### 2.5 回退办法

- 最小回退：删 `ui/lobbyIntro.js` + `ui/allianceScene.js`，删 `main.js` 那 3 行 —— 完全不接触其它文件，零残留。
- 柔和回退：留文件，`main.js` 里调用处加一个 pref 开关（`sp.pref.lobby.intro !== false`），出问题让业主一键关。

---

## §3 大厅程序化背景 + 自选媒体：不值得整搬，只借 3 个小点

### 3.1 能力矩阵（逐项对比）

| 能力 | 融合版 | 我方 | 谁在前 |
|---|---|---|---|
| 程序化四景（夜巡/霜原/烬野/静默） | `hubScene.js:10-16` | `hubBackdrop.js:13-23` 的 `Scene` | 平（同源） |
| 官方「默认背景」 | `entry_bkg_01` glow + `entry_bkg_02` ship，`screens/lobby.js:461-469`，CSS `lobby.css:44-46`（`mix-blend-mode:screen`，opacity .2/.4） | **官方「始发」整图**（`bg_rogue_3` 左右半预拼，`hubBackdrop.js:17, 313-315`，`tools/home-theme-sheet.py`） | **我方**（见 §5 截图对比） |
| 自选图片 | `lobbyMedia.js` | `hubBackdrop.js:79-102` | 平（都是 IndexedDB + 最长边 2560） |
| 自选**动图**（GIF/APNG/动画 WebP/AVIF） | **支持**：`isAnimatedImage()` `:97-118`，动图不重编码、超 2560 直接拒；reduced-motion 用 canvas 停在第 1 帧（`StillPicture` `:402`） | **不支持**：一切图片都过 `shrink()` → canvas → **JPEG**（`hubBackdrop.js:79-102`），动图被拍成静帧、透明被填 `#0b1110` | **融合版** ← 借 |
| 自选视频 | 60MB / ≤1080p / 静音循环（`:31-33`） | 60MB / ≤1080p / 可开声音（`hubBackdrop.js:265-276`）+ **视频声与 BGM 互让**（`HubVideo` + `sp:lobby-video-audio` 事件，`:277-304`，`lobbyMusic.js:97`） | **我方** |
| 暗化 | 0–80（`setBackdropDim` `:394`） | 0–85（`hubBackdrop.js:47`） | 平 |
| 模糊 / 战术网格 | 无 | 有（`:48-49, 416-419`） | **我方** |
| 动效开关 | 只跟随 `prefers-reduced-motion` | 独立开关（`:50, 421`），关掉后雷达扫描也停（`hubBackdrop.js:330-338`） | **我方** |
| 音乐 | 解码成 PCM 缓冲 + **6 分钟上限**（`probeMusic` `:319`），全站生效（标题/大厅/房间/简报/结算/协议启动） | `<audio>` 元素 + `MediaElementSource`，**只按 20MB 卡**（`lobbyMusic.js:8, 34-47`），只在 `inMusicArea()` 放（`lobbyMusic.js:14`：大厅 / 房间 / 战前准备阶段），**有 10 秒交接**给对局 BGM（`:65-82`） | 各有所长 |
| 失效回退 | 加载失败自动关掉并 toast（`OwnBackdrop` `broken()` `lobbyMedia.js:439`） | 视频失败静音重试（`hubBackdrop.js:292-294`）；图片是 CSS 背景，**没有失败提示** | 融合版略好 |
| 偏好键 | `lobby.media`（`backdrop/music/dim/scene`） | `hub.backdrop`（`hubBackdrop.js:24`，含一次性迁移 `:26-44`）+ IndexedDB `sp-lobby-music` | — |
| IndexedDB | `sp-lobby-media` / 表 `files`，两个槽 | `sp-hub-backdrop` / `kv` + `sp-lobby-music` / `tracks` | — |
| 入口 | 一个按钮 → 「大厅背景与音乐」对话框（`LobbyMediaDialog` `:497`） | 两个入口：🎨「大厅背景」`lobby.js:1313` + ♫「大厅音乐」`lobby.js:1316` | 融合版更省事 |

> 行的对应关系：融合版 `screens/lobby.js:461` 是它的 `HubBackdrop`，把 `LobbyScene`（程序化四景）与 `OwnBackdrop`（自选图/视频）**都装在** `.hub-bg` 里；我方等价物在 `hubBackdrop.js:307`，由 `lobby.js:1304` 挂载。所以两边的"背景根节点"是同构的，这正是下一节冲突的由来。

### 3.2 结论

**同源、各有胜负，整体在我方这边。** 融合版是把这个功能从 `hubBackdrop` 那个血统里拆出来重写的一版（`lobbyMedia.js:1-4` 的注释自陈是 PR #643 的 split 8），它多了「动图」与「音乐上限/校验」，但丢了我方的官方整图、模糊/网格、视频声与 BGM 让位、迁移逻辑。

**整包搬的直接后果（不是推测，是两边代码冲突）**：

1. **类名同族**：两边都用 `.hub-bg__*`、`[data-hub-theme]`，根节点都叫 `.hub-bg`（融合版 `screens/lobby.js:462` / 我方 `hubBackdrop.js:316`）。同时存在 = 两层背景、两层雷达、双份 `hub-fog-0` 等渐变 id。
2. **两套媒体各管各的**：`lobby.media` 与我方 `hub.backdrop` 互不认，玩家的自选图会在其中一套里"丢"。
3. **两套音乐引擎抢 BGM**：融合版走 `audio.setLobbyTrack`，我方走 `audio.lobbyMusicOverride` + `media.pause()` 交接逻辑；同时装会互相 fade。
4. 融合版这一侧其实**自己已经发现过同一件事**（`MERGE-LOG.md` §2.1，反过来看）。

### 3.3 只借的 3 个小点（都是 S，各改一处）

| 借什么 | 融合版出处 | 我方落点 | 具体做法 | 收益 |
|---|---|---|---|---|
| ① 动图不被拍成静帧 | `isAnimatedImage()` `lobbyMedia.js:97-118`（60 行，纯前端嗅探前 64KB：GIF / APNG 的 `acTL` / WebP VP8X 动画位 / AVIF `avis`） | `hubBackdrop.js:127-135` 的 `setImage()` | 是动图就不进 `shrink()`，原样存；超 2560 直接拒并提示 | 玩家能放 GIF 大厅背景了 |
| ② 自选音乐 6 分钟上限 + 解码校验 | `probeMusic()` `lobbyMedia.js:319-345` | `lobbyMusic.js:34-47` 的 `validate()` | 现在只看 `loadedmetadata` 的 duration —— **加一条 `duration > 360s` 拒绝**即可（解码校验可选） | 防 40 分钟的 20MB 长音频 |
| ③ 失效回退要说话 | `OwnBackdrop` 的 `broken()` `lobbyMedia.js:429-433` | `hubBackdrop.js:307-327` | 图片那条路（CSS `background-image`）加一次 `<img>` 预探测，失败 toast + 回退 | "我的背景白屏了"这类报障 |

另外一件 UX 小改（借思路，S）：把「大厅背景」与「大厅音乐」并成**一个**「大厅背景与音乐」对话框（我方现在拆在两个入口：`lobby.js:1316` 的 🎨 与 ♫；`BackdropSettings` 在 `hubBackdrop.js:368`，`LobbyMusicButton` 在 `lobbyMusic.js:123`）——注意我方的背景对话框比融合版**更丰富**（多了模糊、网格、视频声、暂停视频、动效），合并时是"把音乐那一块塞进我方对话框"，不要反过来。

---

## §4 图像代理的客户端那半（extImage）：现在不值得，等插件平台

### 4.1 它解决什么

页面 CSP 是 `img-src 'self' data: blob:`，工坊/插件引用的第三方贴图会被浏览器直接拦掉。`extImage.js`（61 行）用 `MutationObserver` 盯 `<img>`、SVG `<image>`、`<source>` 与内联 `style` 的 `url(...)`，把一切 `http(s)` 且非同源的地址改写成 `/img-proxy?u=<encodeURIComponent(url)>`（`extImage.js:6-9, 11-30, 46-61`）。**因此它不只绕 CSP，还顺带解决防盗链（Referer 变成我方服务器）与混合内容。**

### 4.2 我方现状：没有等价物，但现在也不需要

- 我方**既没有 `extImage.js`，也没有服务端 `/img-proxy`**：`grep -rn "img-proxy\|imgProxy" app/server app/public/js` = 0 命中。
- 我方页面里出现的外链图 = 0：素材走同源 `/assets/**`（`data/assets.json` 的 `ui` 键全是 `/assets/...`），装饰插件（cosmetics）的 URL 是**只认同源**的（`cosmetics.js:36-46` 的 `plainUrl()`：非同源直接返回 `null`）。
- 我方 CSP（`app/server/http/csp.js:48`）：`img-src 'self' data: blob:` + CDN 源。**也就是说，我方现在没有任何一张"跨源图"需要救。**

所以：**客户端这半搬过来是零观感的改动**（真正让工坊封面能显示的是服务端 `/img-proxy` + 工坊内容，那是 B 报告的活）。按 `00-总纲` 的口径，这属于「看明白但不搬」。

### 4.3 真要接的时候，两个坑

1. **它是"无差别改道"的**：`rewriteSrc` 只排除 `location.origin`（`:14`）。哪天我方把某类素材写成**绝对 CDN 地址**（现在 `SP_ASSET_CDN` 是 nginx 的 302，DOM 里的 `src` 仍是同源路径，所以暂时安全），这些地址会被改写成走本机 `/img-proxy` —— 等于把 1.2 GB 素材绕回 node 进程转发。接之前必须先加白名单（同源 + `assetCdnOrigins()`）。
2. **和我方的失败记账错位**：`cosmetics.js` 的 `failed` 集合是按**同源路径**记账的（`plainUrl()`，`:36-46`），`content.js` 用 `cosmetics.fail(url)` 记住"这个文件坏了"。`extImage` 在 DOM 层把 `src` 换掉之后，报障回调拿到的仍是原始 URL（它改的是属性，不改我们传入的值），因此**不会**直接坏掉 —— 但只要有人顺手在 `extImage` 里也上报失败，就会写进一个永远对不上的键。这是一条要写进 review 注意事项的细节。

### 4.4 顺带一个真实待验项：我方 `media-src` 没有 `blob:`

融合版为「自选大厅视频 / 自选音乐」**专门**在 CSP 里放了 `blob:`，并在注释里点明原因（`server/http/csp.js:4` 文件头注释、`:71-73` 的 `const media = " media-src 'self' blob:" + …` —— "blob: 是玩家自己的大厅视频与自选音乐的对象 URL"）。
我方的同一行是 `media-src 'self'${extra}`（`app/server/http/csp.js:48`，`extra` 只加 CDN 源），而 **`img-src` 那边我方早就写了 `blob:`** —— 同一个作者、同一份策略里，只有 media 这一半没写。
我方自选视频/音乐**都是** `<video src=blob:>` / `<audio src=blob:>`（`hubBackdrop.js:303`、`lobbyMusic.js:51-52`），所以**理论上会被拦**。
**本次按要求没有起服务，所以未实测**。若实测确实被拦，这是一行修复（`media-src 'self' blob:`），且正好是融合版踩过并留下注释的坑。这条建议直接进第一档待验清单。

---

## §5 观感评估（截图，判断"值不值得为它改前端"的关键证据）

看了 `merge-shots/` 四张（`read_image` 实看）：

**`03-opening-film.png`（开场动画运行帧，1600×900）**
- 构图**成立**：正中一块奶白卡片 + 黑色点阵金字塔，外框一对细括号；下面 `STRONGHOLD PROTOCOL`（细描边、灰白渐变）→ 青绿 `: ALLIANCE :`（两侧小方块点）；再下一行是那块"外星字母"；右下角极淡的「点击跳过」。
- 质感对：卡片有横向扫描线，字是描边字 + 渐变填充，青绿是 `#47c9a9` 那一档，与整个游戏 UI 同色系。**这是一支"像官方活动开场"的片子，不像自制。**
- 两个观感折扣：① 那块外星字母行**读起来就是一排白方块**，容易被当成字体缺失（见 §2.4④）；② 画面上半与四周大片近黑（雾/舰影层压得很低），静止帧显得空 —— 动起来才补得回来，所以**截图不占优势，实机比截图好**。
- 结论：**首次进入的收益是真的**。这是玩家看见的第一帧游戏画面，目前我方这个位置什么都没有（直接进标题页）。

**`02-backdrop-scene-night.png`（程序化「夜巡」）**
- 分层干净：远山脊 + 要塞剪影（亮窗、信标、探照灯光柱）+ 中景雾 + 近景山脊，中央一枚点阵徽记压在雷达环里，标题「卫戍协议：盟约」压在中线下。左四卡、右二卡、右下两枚大按钮。
- 这套**我方本来就是同源实现**（同种子同 SVG），不需为它改任何东西。

**`05-final-lobby.png`（融合版的默认大厅背景 = 官方入场帧当底图）**
- 这是 `entry_bkg_01`（雾光）+ `entry_bkg_02`（舰影）用 `mix-blend-mode:screen`、opacity .2/.4 摊在整个大厅后面（`screens/lobby.js:461-469`，`lobby.css:44-46`）。截图里它表现为**一整片发白的灰雾团**，把中央徽记和标题的对比度全吃掉了，反而不如 `02` 干净。
- **判断：这张底图不值得学。** 我方默认是官方「始发」整图（`hubBackdrop.js:17`，业主 2026-10-26 指定），是一张正经的大厅主视觉；融合版这两张是**入场动画的中间帧**，当背景用本身就不对路。
- 附带结论：**"值得为它改前端"的答案是"不为背景改"**。

**`05-final-title.png`（标题页）**
- 与 `03` 同一套语汇：左上角 micro label、右上「统计 / 中文」、正中徽记 + `STRONGHOLD PROTOCOL / ALLIANCE` + 巨大「卫戍协议：盟约」+ 副标题 + 代号输入框 + 开始 + 连接状态/玩法说明/设置/全屏 + 下载完整素材/导入素材包 + 页脚。
- **它证明接缝是成立的**：从 `03` 那种近黑 + 青绿的画面淡出到这张标题页，色温与构图完全对得上。我方标题页（`screens/title.js:203-301`）是同一套骨架，**接缝只会更顺**（我方标题背景直接就是 `entry/bkg_01`）。

**总的观感判断**：这支片子值得拿；它带来的收益是「第一次进入的那 3 秒」，而它需要的改动**不碰任何界面布局** —— 这两点加在一起，才让它是 S 而不是 M。

---

## §6 总排序（含代价与回退）

| 序 | 项 | 档 | 代价 | 改动面 | 回退办法 |
|---|---|---|---|---|---|
| 1 | **开场动画**（`allianceScene.js` + `lobbyIntro.js`） | **值得做** | **S**（半天，含适配与自测） | 2 新文件 + `main.js` +3 行 + 素材就绪判定 ≈20 行 | 删 2 文件 + 删 3 行；或 pref 开关关掉 |
| 2 | 自选背景支持**动图** | 只借思路 | S（2–3 h） | `hubBackdrop.js` 的 `setImage()` 一处分支 | 保留旧 `shrink()` 分支，删嗅探函数即可 |
| 3 | 自选音乐**6 分钟上限** | 只借思路 | S（1 h） | `lobbyMusic.js` 的 `validate()` 加一条判断 | 删那一行 |
| 4 | 背景 + 音乐**并成一个对话框** | 只借思路 | S（半天，纯 UI） | `screens/lobby.js` 两个入口、`BackdropSettings`/`LobbyMusicButton` | 保留旧的两个按钮 |
| 5 | 失效回退 toast（自选图） | 只借思路 | S（1 h） | `hubBackdrop.js` 图片渲染处 | 删预探测 |
| 6 | `hubScene.js` / `lobbyMedia.js` 整包搬 | **不值得** | — | — | — |
| 7 | 「盟约」20s 昼夜循环当第 6 个主题 | **不值得** | M（渲染循环 + 一套主题 token + 与 `data-motion` 联动） | `allianceScene.js` 150 行 + `lobby.css` 一组 token | — |
| 8 | `extImage.js` + `/img-proxy` 现在接 | **不值得** | — | — | — |
| 9 | `extImage.js`（等插件平台） | 只借思路 | S（客户端）+ B 报告的服务端 | 1 文件 + `main.js` 1 行 | 删文件删行 |
| 10 | `media-src` 加 `blob:` | **待验后可能属第一档** | S（1 行） | `server/http/csp.js:48` | 删 `blob:` |

**为什么 7 不建议**：这段代码在融合版里**根本没接线**（`mountAllianceBackdrop` 零调用点，见 §1 事实 2），且业主已用官方的「始发」整图取代了它这一类"重建背景"；为它开一个主题 = 引入 150 行没人维护的渲染循环，还要在 `lobby.css` 里再养一套 `spa-*` / `--sky-*` token，收益是"多一种背景"，代价是 M，不划算。**唯一值得从那 150 行里借的东西是一条性能模式**：静止段用 `setTimeout` 睡过去、`visibilitychange` 唤醒、`ResizeObserver` 重排（`allianceScene.js:316-334`）—— 我方 `hubBackdrop` 现在是纯 CSS 动画，无此问题，故也不急。

---

## §7 建议的动手顺序（若业主点头）

1. **先做开场动画的最小版**（半天）：
   - 取 `allianceScene.js`（可裁 `lobby` 层）+ `lobbyIntro.js`；
   - 把 `resourcesReady()` 换成「8 张 sprite 全部 decode 成功」；<br>
   - `main.js` 在 `render()` 之后调用，外面套 `try/catch`（融合版 `main.js:491` 就是 `try` 的，不要省）；
   - 加一个 `sp.pref.lobby.intro` 开关（默认开）。
   - **自测 6 条**：① 素材齐全的机器 → 播 2.8 s 后淡入标题；② 素材缺失的机器 → 静默跳过、不黑屏；③ 静音/未交互 → 画面照走、音乐在淡出点接上；④ 点一下/按任意键/Esc → 立刻收；⑤ `?room=XXXX` 进页面、或刷新后在对局中 → 不播；⑥ 手机竖屏 → 不播，转横屏后再播（`whenPhoneReady` 已含 400 ms 沉降）。
2. **三个小点**（§3.3 的 ①②③，一天内）——与开场动画无耦合，可并行。
3. **插件平台落地时**再评估 `/img-proxy` + `extImage`（等 B 报告）；顺手验一次 `media-src blob:`。

---

## §8 需要业主/实测拍板的三件事

1. **开场动画是"每次打开都播"还是"每次启动/首次安装播一次"？** 融合版是每次 page load；我方刷新频率更高的玩家可能觉得烦。建议做成设置项，默认「每次」。
2. **「点击跳过」要不要更显眼？** 现在右下角 `rgba(220,240,236,.45)`、12px（`lobbyIntro.js:30-31`），在近黑画面上确实很淡 —— 融合版的截图里几乎看不见。这是刻意低调（想让人看完），但也可以接受"显眼一点"。
3. **`media-src` 的 `blob:` 是否真拦自选视频/音乐？** 需要一次真浏览器实测（本次按要求未起服务）。若拦，这是一行修复，且优先级高于本文其它小项。
