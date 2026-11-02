# 融合版 0.3.3 对比 · A：桌面启动器与发行方式

> 问题（业主 2026-11-01）：「`Stronghold-Protocol-v0.3.3-Fusion` 看看这个有什么值得吸取的」
> 融合版材料：`C:\Users\hhyyl\Downloads\卫戍协议融合版-v0.3.3-电脑版\Stronghold-Protocol-v0.3.3-Fusion`（**只读，本次一字节未改**）
> 我方：`Stronghold-Protocol-Forge-协议源石版`（`app/` = 0.19.41，`UPSTREAM_VERSION = '0.3.3'`）
> 分报告：`B-插件与皮肤.md` · `C-表现层.md`
> 本文不含代码改动，只做判断与取舍。

---

## §0 一句话

**融合版的「电脑版」= 169 KB 的 C# WinForms + WebView2 外壳，加 24 KB 启动页（HTML/CSS/JS），源码不在包里。
它解决的是「观感与入口」，不是「能不能玩」；而"能不能玩"那半（便携 node、就绪探测、地址打印、更新包）我方已经有，且比他更完整。**

三件事里两件我方已经领先，真正的增量只有一件：**一个没有地址栏、没有黑窗口的窗口**。

结论分档：

| 档 | 项 | 代价 |
|---|---|---|
| **值得做** | ① 启动器自己的日志文件（`logs/launcher-*.log`）② 失败出口人话化 ③ 把他们的 SEA/Electron 实测结论收进我方结论（省 3–4 周弯路） | **S**（各自 ≤ 半天，不动游戏代码） |
| **只借思路** | ④ WebView2 外壳 + 启动页。**先做 v0「无窗口托盘 exe、开系统浏览器」（S–M），再决定要不要 v1「内嵌窗口」（M）**。v1 的坑有 3 个在我方会放大，见 §4.4 | **M**（v0 半天–1 天；v1 +1.5–2 天） |
| **不值得** | ⑤ Inno Setup 安装包 ⑥ Electron / Tauri / Node SEA ⑦ 启动页里那张「服务器列表」（绑的是他们自己的三台机器）⑧ CDP 禁缓存 ⑨ "数文件"式资源进度条 | — |

**最值钱的一条不是技术，是反面教材**：他们的 `.bat` 与文档已经出现两套真相（`PACKAGING.md:19` 说"需要系统 Node.js 22+"，`开始游戏.bat:19` 其实会回退到包内 `node\node.exe`）。
我方现在有**三个**启动入口，同一个风险已经在门口了 —— 见 §4.4 第 5 条。

---

## §1 它到底是什么（黑盒复原）

### 1.1 包里那台"电脑版"的物理成分

| 文件 | 大小 | 是什么 |
|---|---:|---|
| `Stronghold.exe` | 173,056 B | C# WinForms 宿主。PE32+ / x64 / GUI 子系统 / .NET Framework 2.5 运行时；`.text` 29,184 B（**全部 IL 就这么多**）+ `.rsrc` 143,360 B（几乎正好等于 `launcher/app.ico` 的 141,372 B，即图标） |
| `Microsoft.Web.WebView2.Core.dll` | 703,328 B | WebView2 SDK，`lib/net462`（.NET Framework 4.8 那套），1.0.4314.35 |
| `Microsoft.Web.WebView2.WinForms.dll` | 38,792 B | 同上，WinForms 控件 |
| `WebView2Loader.dll` | 194,912 B | 原生加载器（x64） |
| `launcher/`（app.js 7,085 + index.html 4,837 + loading.html 4,291 + style.css 7,450） | **约 24 KB** | 启动页，**运行期真正用到的全部** |
| `launcher/app.ico` 141,372 B + `launcher/app-source.jpg` 45,284 B | 186 KB | 构建期素材（图标已嵌进 exe），留在包里但运行期不用 |
| `node/node.exe` | 86,973,768 B | v22.23.3，**sha256 `9c9245166b4a…` 与我方 `node/node.exe` 逐字节相同** |

壳的净增量 = **169 KB + 936 KB + 24 KB ≈ 1.3 MB**。Node 运行时双方共用同一份二进制，WebView2 Runtime 不打进包（系统级，本机 156.0.4314.58，与 Edge 同版本）。
→ **体积不是这个决策的变量**，别拿它当理由。

签名状态：`Get-AuthenticodeSignature` = **NotSigned**；`VersionInfo` = `FileVersion 0.0.0.0`，Product/Company/Description 全空。
即 `csc /target:winexe /platform:x64 /win32icon:…` 裸编译出来的原型级产物（构建命令他们自己写在 `docs/start-page.md:130-135`）。

### 1.2 源码不在包里 → 只能黑盒推断 + 复刻自制

`docs/start-page.md:4` 自己写着：代码在 `_merge-work/launcher-build/`。我核过整棵树：**没有** `_merge-work/`、没有 `Program.cs` / `*.csproj` / `*.sln`（全树 `find`）。

所以本文对 C# 那一侧的一切论断**都不是读源码得来的**。我做的是：

1. `file` + 手写 PE/CLR 头解析 → 确认是 .NET Framework 程序集、分区布局、metadata 流（`#~` 4120 / `#Strings` 5952 / `#US` 7440 / `#Blob` 1520）。
2. **导出 `#US` 用户字符串堆**（7,440 B，UTF-16）→ 这一项就把 Program.cs 里所有字面量交出来了：命令行开关、报文键名、全部中文状态文案、注入到网页里的那两段 JS、`taskkill` 的参数形状、配置/日志文件名、WebView2 附加参数。
3. **导出 `#Strings` 标识符堆** → 字段名与方法名（**未混淆**），由此复原出类的形状。
4. `Get-AuthenticodeSignature` / `VersionInfo` → 签名与版本元数据。
5. 读包内**运行后留下**的 `launcher.log`（12 行）与 `launcher-config.json`（1 行）。
6. 读他们自己写的两份文档（`docs/start-page.md` 192 行 / `docs/EXE-打包可行性.md` 180 行）+ `PACKAGING.md`。

**没做的**（诚实交代）：没有真反编译（本机无 ILSpy/dnSpy，也不该为此装工具）、没有运行 `Stronghold.exe`（会往融合版目录写 `launcher.log`，且等于替他们起服务器）。

**还能查到什么**：因为**方法名与字段名全在、无混淆**，拿 ILSpy/dnSpy 能把 `Program` 类近乎逐行还原成 C#（估 600–800 行）。也就是说：**"抄"这件事在技术上没有门槛，可抄的只是方案，代码还得自己写**（§1.3 的表就是那 600 行的目录）。

### 1.3 复原出来的 `Program` 类（方法 / 字段）

方法（`#Strings` 全命中）：

`Main`（异步，内含 `b__1`…`b__c` 十余个 lambda）· `OnMessage` · `LoadConfig` / `SaveConfig` · `StartLocal` · `StartRemote` · `OpenGame` · `OpenList` · `ReturnToLauncher` · `EnterViaLoading` · `SendArtInfo` · `ProbeHttp` · `KillNode` · `Status` · `GetFileSystemEntriesCount` · `argsContain`

字段：`launcherDir` `nodeExe` `payload` `sender` `reason` `target` `baseUrl` `inGame` `inLoadingPage` `closing` `returning` `healthFails` `healthTimer` `bootPct` `autostart` `autostartUsed` `listPending` `listTestUsed` `listFallbackUsed` `lastEnteredAuthority` `configuredServer` `configuredList` `configuredListBackup` `configuredListBackup2` `ConfigPath` `HealthyUrl` `LanUrls` `backBtn`

引用到的框架件：`JavaScriptSerializer`（System.Web.Extensions，即 `csc /r:System.Web.Extensions.dll`）、`HttpWebRequest` + `ServicePointManager.SecurityProtocol`、`GetHostAddresses/GetHostName`（算局域网地址）、`MessageBox`、`Application.EnableVisualStyles`、`SystemIcons`、`ThreadPool.QueueUserWorkItem`、`AddScriptToExecuteOnDocumentCreatedAsync`、`CallDevToolsProtocolMethodAsync`、`SetVirtualHostNameToFolderMapping`、`PostWebMessageAsJson`、`NavigationStarting` / `NavigationCompleted` / `NewWindowRequested` / `WebMessageReceived` / `FormClosing`。

**架构一句话**：WinForms 一个 `WebView2` 控件 = 整个界面；页面通过 `window.chrome.webview.postMessage` 与宿主对话；宿主负责"起 node / 探活 / 导航 / 杀进程"。
启动页不是内嵌资源，是磁盘上的 `launcher/`，用 `SetVirtualHostNameToFolderMapping` 映射成虚拟域 **`https://app.local/`**（`launcher/loading.html:65` 里那行硬编码 `location.replace('https://app.local/index.html')` 就是它的反证）。

### 1.4 宿主 ↔ 启动页 的完整报文（这是唯一值得照抄的东西）

从 `#US` 键名 + `launcher/app.js:124-155` 双向核对出来的：

| `t` | 方向 | 载荷 | 用途 |
|---|---|---|---|
| `ready` | 页→宿 | — | 页面加载完（`app.js:168`） |
| `config` | 宿→页 | `server, list, listBackup, listBackup2, version` | 已存配置 + **版本号（硬编码，见 §4.4-4）** |
| `art` | 宿→页 | `files, checked` | 「本地资源 31601/31601 文件」（`app.js:144-148`） |
| `boot` | 宿→页 | `text, pct` | 启动进度（`app.js:126-127`） |
| `status` | 宿→页 | `kind(wait/ok/bad), text` | 状态行；`bad` 直接进失败态（`app.js:128-131`） |
| `start-local` | 页→宿 | — | 点了「本地游戏」（`app.js:68-73`） |
| `server-started` | 宿→页 | `url, lan` | 服务器就绪，随后宿主自己导航（`app.js:132-138`） |
| `start-remote` | 页→宿 | `addr` | 连别人的服务器（`app.js:91-103`） |
| `open-list` | 页→宿 | — | 打开服务器列表（`app.js:81-89`） |
| `enter-server` | 页→宿 | `url` | **列表页里点了具体服务器**（拦截注入脚本发来） |
| `back` | 页→宿 | — | 注入的「← 返回」按钮 / `Alt+←` |
| `save-server` | 页→宿 | `addr` | 写 `launcher-config.json`（`app.js:105-119`） |
| `error` | 宿→页 | `text` | 失败 |
| `quit` | 页→宿 | — | 退出（`app.js:121`） |

### 1.5 生命周期（他们文档 + 元数据互相印证）

- **启动**：双击 → 窗口加载 `https://app.local/index.html` → 页面发 `ready` → 宿主回 `config` / `art`。
- **本地游戏**（`docs/start-page.md:51-63`）：先探 `http://127.0.0.1:3000/healthz`；已 200 就直接导航；否则 `Process.Start(node server\index.js)`（`PORT` 走环境变量、隐藏窗口）→ 每 500 ms 探一次、最多 90 s → 就绪后回 `server-started{url,lan}` 并导航到游戏。
- **进度档位不是估的**：宿主读 node 的 stdout，按 `[plugins]` / `[versions]` / `[http]` / `Local:` 四个标记推进（`#US` 里这四条都在，配三条中文文案「正在载入外观插件与皮肤…」「正在载入版本数据…」「正在准备网络与房间…」）。**这四条标记我方 `server/http/boot.js:74` 与日志里同样存在** → 复刻时这段逻辑几乎可 1:1 搬。
- **服务器游玩**：`addr` 补默认端口 3000 → 探 `/healthz` → 200 就经 `loading.html?to=…&label=…` 中转一下再 `location.replace`（`launcher/loading.html:80-84`，故意停 1.2 s 给人看"在连"）。
- **服务器列表**：按序探 `https://wei.jiangjiangze.icu/` → `http://121.4.51.247/`（`launcher-config.json:1` 也是这两个），前一个不通换下一个，全不通才报；带 `UA: Mozilla/5.0 StrongholdLauncher`。列表页里点具体服务器（含 `target=_blank`）→ 注入脚本拦下改走 `enter-server`。
- **退出**：`FormClosing` → `taskkill /PID <pid> /T /F`（`#US` 里 `taskkill` / `/PID ` / `/T /F` 三段齐全）。
- **崩溃回启动页**（`docs/start-page.md:187-192`）：监听 node `Exited` + 每 3 s 探 `/healthz`、连续 3 次失败 → 导航回 `https://app.local/index.html?stopped=…`，页面把本地卡片改成「状态：本地服务器已停止」（`app.js:160-165`）。

### 1.6 一条现成的反面证据：`launcher.log` 里就有一次 FATAL

包里留着的 `launcher.log`（12 行，根目录，非我产生）：

```
19:05:49.357 shown; root=…\Stronghold-Protocol-v0.3.3-Fusion launcher=…\launcher
19:05:53.658 FATAL System.Runtime.InteropServices.COMException (0x8000FFFF): 灾难性故障 …
   at Microsoft.Web.WebView2.Core.CoreWebView2Environment.<CreateCoreWebView2ControllerAsync>d__15.MoveNext()
   at Microsoft.Web.WebView2.WinForms.WebView2.<InitCoreWebView2Async>d__25.MoveNext()
   at Program.<<Main>b__3>d__19.MoveNext()
```

三件事读得出来：

1. **本机 WebView2 Runtime 是装着的**（`156.0.4314.58`，我查的注册表 `{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}`）。所以这**不是"缺运行时"**，是创建 controller 失败。
2. 失败点在 `await EnsureCoreWebView2Async(...)`，而且**是从 `Main` 里的 async lambda 抛出来的**（`<Main>b__3>d__19`）—— 典型的 `async void` 处理器裸 await、没 try/catch：异常没人接，直接走 `FATAL` 落日志。
3. 他们的兜底（`docs/start-page.md:143`「没有时弹窗提示安装」+ `:42`「`开始游戏.bat` 保留（无 WebView2 的兜底）」）**是文档承诺，不是宿主行为**：这条路径上宿主只写了日志，没有退回浏览器。

> 这就是"壳的失败面比 bat 大"最硬的证据 —— 而且它是在**业主这台机器上**发生的。

---

## §2 与我方现状逐项对比

我方"电脑版"现状：`协议源石版/` 下 `启动游戏.bat`(11 行) + `启动编辑器.bat`(11 行) + `安装工坊包.bat`(11 行) + `启动游戏-管理后台.bat`(79 行) + `node/`(84 MB) + `README-开箱即用.md`，外加仓库根的 `开始游戏-0.19.0.bat`(68 行) 与 `app/scripts/start-windows.bat`。

| 项 | 融合版 | 我方 | 谁更好 |
|---|---|---|---|
| 双击的观感 | 独立窗口、无地址栏、无黑窗 | 黑 cmd 窗口 + 系统浏览器标签 | **融合版** |
| 运行时 | `node\node.exe` v22.23.3 | `node\node.exe` v22.23.3（**同一 sha256**） | 平 |
| 缺 Node 时 | exe 用它自己的；`开始游戏.bat` 也会回退到包内 node（`:19`） | `启动游戏.bat:6` 优先包内 node；`launch.mjs:12` 还有版本闸（<22 直接报中文） | 平（我方多点版本闸） |
| 已开服时再双击 | 探 `/healthz`，只导航 | `launch.mjs:95/116` `probePort`，只开浏览器 | 平 |
| 端口 | **固定 3000**，未做递增（`start-page.md:170` 自认） | `--port` / `PORT` 环境变量（`launch.mjs:5`） | **我方** |
| 就绪判定 | 宿主轮询 `/healthz` | `launch.mjs` 轮询 `/healthz` 后才开浏览器 | 平 |
| 地址打印 | 启动页页脚显示 LAN 地址 | 控制台 banner `Local:` / `LAN:` / `Studio:`（`server/http/boot.js:74-80`） | 平（我方多 Studio 带钥匙那行） |
| 资源完整性 | **只数文件个数**（31601） | `.cache/asset-hashes.json` + `/data/assets.json` 哈希分段（`server/index.js:18-19`） | **我方** |
| 版本不匹配 | 壳里 CDP 关缓存（`Network.setCacheDisabled`） | `public/js/ui/buildGuard.js`：`/healthz.build` 变了就自动重载、对局中不打断 | **我方** |
| 更新 | **没有**。版本号硬编码在 exe 里 | `UPDATE.json` + `server/update.js` + `launch.mjs` 第 2 步收尾 + `make-update-package.mjs` | **我方** |
| 打包 | 手工整理 + zip（1.0 GiB，带 `.sha256`） | `make-windows-bundle.mjs`：`git ls-files` 清单 + `npm ci --omit=dev` + node.exe 钉 sha256 + **脏工作区拒绝出包** | **我方** |
| 诊断 | 只有 `launcher.log` | `tools/doctor.mjs`（19 KB，端口/地址分类/防火墙建议） | **我方** |
| 保活/开机自启 | 无 | `install-service-windows.ps1`：计划任务 + 防火墙规则 + `logs/server.log` | **我方** |
| 退出语义 | 关窗=`taskkill /T /F` 杀 node 树 | 关 cmd 窗口即结束 node；服务模式另有自重启 | 平 |
| 卸载 | 删文件夹 | 删文件夹（`README-开箱即用.md:93` 明写"不写注册表"） | 平 |
| 依赖 | WebView2 Runtime（系统级） | 只要浏览器（Edge/Chrome 任一） | **我方**（依赖更薄） |
| 签名 | 未签名、无版本资源 | 全是 `.bat`，同样会被 SmartScreen/杀软瞄 | 平（都不乐观） |

**一句话**：发行工程的其余部分我方全面领先；融合版只在**窗口形态**这一格赢。

---

## §3 值得做（S，各自 ≤ 半天）

### 3.1 启动器自己的日志：`logs/launcher-YYYYMMDD.log`

融合版把"启动器干了什么"独立成 `launcher.log`（时间戳格式由其 `#US` 里的 `HH:mm:ss.fff` 决定，首行 `shown; root=… launcher=…`）。
我方 `launch.mjs` 目前只往 stdout 打：**玩家一关 cmd 窗口，现场就没了**，只能靠人复述。服务模式有 `logs\server.log`（`install-service-windows.ps1:12`），本地双击这条路没有。

做法：`launch.mjs` 里 tee 一份 `logs/launcher-<date>.log`（时间戳前缀 + 四步流程 + 最终 URL + 失败原因），失败分支顺手把该路径打印到窗口。
**S**。收益：玩家说"打不开"时，有文件可要。

### 3.2 失败出口人话化

融合版把 18 条中文失败文案写死在宿主里（`#US` 复原）：`服务器进程退出了，请查看 launcher.log` / `服务器 90 秒内没有就绪` / `本地服务器无响应，已返回启动页` / `连不上 <addr>（检查地址/端口/防火墙）` / `服务器列表都连不上（主/备）`。
我方同类情形现在偏少（`server/http/boot.js:99` 的 `EADDRINUSE` 还是英文）。
做法：把 `launch.mjs` 的失败分支补齐中文原因 + 一句"下一步做什么"，并把 `tools/doctor.mjs` 的入口写进去。**S**。

### 3.3 把他们 SEA / Electron 的实测结论抄进我方结论（不写代码）

见 §5。这条**零成本、省 3–4 周**，是本次最实用的"吸取"。

---

## §4 只借思路：WebView2 外壳（M）

### 4.1 前置（本机都齐了）

| 前置 | 状态 |
|---|---|
| .NET Framework 4.8 的 `csc.exe` | **在盒**：`C:\Windows\Microsoft.NET\Framework64\v4.0.30319\csc.exe`（2.57 MB）。不需要装 SDK |
| WebView2 SDK 的 3 个文件 | 从 NuGet `Microsoft.Web.WebView2` 取 `lib/net462/*.dll` + `runtimes/win-x64/native/WebView2Loader.dll`（≈936 KB，随包） |
| WebView2 Evergreen Runtime | 系统级，本机 156.0.4314.58（Win11 / 装过 Edge 的 Win10 一般都有；**LTSC / 精简装机不一定**） |
| 便携 node + 现成启动器 | **我方已有**，而且 `launch.mjs --no-open` 正好是壳要的那层（这一点他们也是这么建议的：`docs/EXE-打包可行性.md:98`「正式版建议把启动器里的 `server\index.js` 换成 `scripts\launch.mjs`」） |

### 4.2 两档最小可行版本

**v0（S–M，半天–1 天）：无窗口 exe，只干四件事** —— 就是他们原型那四件（`docs/EXE-打包可行性.md:80-85`）：定位 root → `launch.mjs --no-open --port N` → 轮询 `/healthz` → 开系统浏览器；退出时 `taskkill /T`。
不碰 WebView2 → 没有 §1.6 那条 FATAL 面、没有 localStorage 分叉、不用重做界面。收益：**双击一个图标就玩，看不见黑窗、不用认出哪个 bat**。
**建议先只做这个**，它对"电脑版"观感的改善占了大部分，风险是小头。

**v1（+1.5–2 天）：换成 WebView2 窗口 + 启动页**（本地游戏 / 地址输入 / 进度 / 回启动页 / LAN 地址）。
启动页那 4 个文件（24 KB）是**可读的源码、可参照**；C# 那侧只能照 §1.3 的形状自己写。

**v2（可选 +1 天）**：窗口内导航拦截 + 注入「← 返回」+ `loading.html` 中转。这三件的注入脚本原文就在 `#US` 里（见 §6 附录），看清了再决定要不要。

### 4.3 三个必须写进设计里的约束

1. **版本号不准进 exe**。他们的 `#US` 里只有一条版本字符串（`version` → `0.3.3`），意味着**每次发版都要重编译 exe**。我方两周一个版本，这条绝对不能学：壳只从 `package.json` / `/healthz.build` 读，自己零版本。
2. **`EnsureCoreWebView2Async` 必须全程 try/catch，失败直接落回 `启动游戏.bat`**。§1.6 就是没这么做的现场。
3. **明确 user data folder 并想清楚 localStorage 分叉**。我方的存档/昵称/皮肤开关/音量都在浏览器 `localStorage`（`README-开箱即用.md:93` 明写）。WebView2 用**自己的 profile**（他们用的是 `%LOCALAPPDATA%\StrongholdProtocol\WebView2`，由 `#US` 的 `StrongholdProtocol` + `WebView2` 两段拼出）→ 老玩家从 bat 换到壳，存档会"消失"。
   **要么 v0（只开系统浏览器，同源同 storage，零分叉）**，要么 v1 里做一次性迁移 + README 讲清。

### 4.4 风险清单（含他们已踩的）

| # | 风险 | 他们那边的证据 | 在我方会怎样 |
|---|---|---|---|
| 1 | SmartScreen / 杀软 | exe **未签名**、`FileVersion 0.0.0.0` | 同病。且我方壳还要 `taskkill /T /F` + 起 `node.exe` 子进程 —— 这是启发式的两条经典特征，360/火绒误报概率**更高**。缓解：继续 zip 分发 + 附 SHA256（我们已有这个习惯），别做"自解压 exe" |
| 2 | WebView2 缺 / 创建失败 | `launcher.log:2-12` 本机就一条 FATAL | 必须 try/catch + 落回 bat（§4.3-2）。不要用 `async void` 裸 await |
| 3 | localStorage 分叉 | 他们的偏好键在壳的 profile 里（`sp.pref.*`，见 B 报告） | 我方存档在浏览器 → 换壳=换档。**这是 v1 唯一的"不可逆"坑** |
| 4 | 版本号钉死在 exe | 唯一一条 `version`=`0.3.3` | 我们发版频率高 → 必须 §4.3-1 |
| 5 | **双入口漂移** | `PACKAGING.md:19`（"需要系统 Node 22+"）与 `开始游戏.bat:19`（会回退包内 node）**已经对不上**；`start-page.md:103` 列的 `listUrl/saveList` 两个 id 在成品 `launcher/index.html:54-60` 里已经不存在 | **我方现在有三个入口**：`协议源石版/启动游戏.bat`、`app/scripts/start-windows.bat`（要系统 node + `npm ci`）、仓库根 `开始游戏-0.19.0.bat`。**做壳之前先把入口收敛成一个**，否则第四个入口只会让漂移更快 |
| 6 | 端口 / 多实例 | 固定 3000、只靠 `healthz` 判重（`start-page.md:169-170`） | 我方 `launch.mjs` 已有 `probePort` + `--port`，**壳直接调用即可，别自己实现一遍** |
| 7 | 观感割裂 | 启动页是启动器自己的绿黑视觉（`docs/assets/start-page.png`） | 如果我方标题页本来就有开场/logo（见 C 报告），再多一层不同风格的启动页会**稀释**而不是加强。要做就沿用我方美术 token，别照抄他们的配色 |

---

## §5 不值得（含"他们替我们踩完的坑"）

> 这一节的实用价值最高：`docs/EXE-打包可行性.md` 是**花钱买来的测量报告**，我们照抄结论就行，不必重做实验。

| 路线 | 他们的结论 | 我方对照 | 判决 |
|---|---|---|---|
| **Node SEA 单文件 exe** | 实测失败：Node 24 的 SEA 只按 CJS 跑入口，`SyntaxError: Cannot use import statement outside a module`（`:46-50`）；且四处"磁盘文件 + 同一 node 可执行文件"的子进程在 SEA 下会变成"exe 跑自己"（`:53-62`）；资源 1.66 GB/4.17 万文件注定外置（`:64-66`） | **我方同样的四处全在**：`server/match/host/index.js:118` `fork(ENTRY)`、`:134` `new Worker(ENTRY)`、`server/plugins/scriptPreflight.js:30` `spawnSync(process.execPath,…)`、`server/plugins/trustedRuntime.js:12` `fork(...)`、`server/studio/trialChild.js:90` `fork(...)` | **不值得**，直接引用他们的实测，别试 |
| **Electron 壳** | +150–200 MB；主进程起服务器、`Worker`/`fork`/asar 路径都要处理；3–5 天（`:33`、`:128-132`） | 我方子进程清单同上 → asar 外置这套活一样躲不掉 | **不值得**（v1 用 WebView2 只加 1.3 MB 就够） |
| **Tauri + Node sidecar** | +10 MB + WebView2 依赖，要 Rust 工具链，4–7 天（`:34`） | 我方无 Rust 经验沉淀 | **不值得** |
| **Inno Setup 安装包** | 压缩后 1.0–1.2 GB（`:32`、`:118-126`） | 我方卖点是"解压即玩、卸载=删文件夹"（`README-开箱即用.md:93`），安装包会把这个优点换成一堆写注册表的动作 | **不值得** |
| 启动页的「服务器列表」+ 注入返回按钮 | 绑的是他们的三台机器（`wei.jiangjiangze.icu` / `121.4.51.247`，`launcher-config.json:1`） | 我方是自建公共服（`05-部署/`）+ 直连地址 | **不值得**（要抄也只抄"地址输入框 + 记住上一次地址"，那部分我方 `launch.mjs` 已有） |
| CDP `Network.setCacheDisabled` | 壳里关 HTTP 缓存（`#US`：`Network.setCacheDisabled` / `{"cacheDisabled":true}`） | 我方 `buildGuard.js` 更强（会主动发现旧构建并按对局状态择机重载） | **不值得** |
| "数文件"式资源进度条 | `GetFileSystemEntriesCount` → 31601 个文件 | 我方有哈希清单 | **不值得**（但"启动页上给一条进度"这个**形式**可以留） |

---

## §6 附录：`#US` 复原的原文（复刻时的规格书）

**命令行开关**：`--root` `--port` `--autostart`（还有两个自测钩子 `--loading-test` `--list-test`）
**文件名**：`launcher-config.json` `launcher.log`（时间戳 `HH:mm:ss.fff`）`server\index.js` `node.exe`
**WebView2**：user data folder `…\StrongholdProtocol\WebView2`；`AdditionalBrowserArguments = --autoplay-policy=no-user-gesture-required`；`AddScriptToExecuteOnDocumentCreatedAsync` 注入；虚拟域 `app.local`
**中文状态**：`正在检查本地服务器…` `服务器已经在运行，正在进入游戏…` `正在启动服务器进程…` `正在等待服务器响应… ` `服务器 90 秒内没有就绪` `服务器进程退出了，请查看 launcher.log` `本地服务器无响应，已返回启动页` `本地服务器已退出` `服务器已就绪，正在进入游戏…` `正在打开服务器列表…` `正在连接服务器列表` `服务器列表都连不上（主/备）` `服务器列表失败：` `在连接 ` `连不上 ` `（检查地址/端口/防火墙）` `先填写服务器地址` `服务器地址格式不对` `地址无效：` `无法启动内嵌浏览器（WebView2）：` `请安装 Microsoft Edge WebView2 Runtime 后重试。`
**注入脚本 1**（跨站链接拦截）：捕获 `a[href]` 点击 → 非 `http(s)` 或同 host 就放过 → 否则 `preventDefault` 并 `postMessage({t:'enter-server',url:h})`
**注入脚本 2**（返回按钮 + 快捷键）：`Alt+←` → `postMessage({t:'back'})`；非 `app.local` 页面左上角插一个 `← 返回`（`z-index:2147483647`、绿框、`Microsoft YaHei`）

---

## §7 要业主拍板的两件事

1. **"电脑版"要的是"不看见黑窗"，还是"不看见浏览器"？**
   前者 = v0（半天–1 天，零新坑）；后者 = v1（+1.5–2 天，必须先解决存档分叉）。我的建议：**先做 v0，跑一个版本看玩家有没有人抱怨"还有地址栏"**。
2. **要不要为这一个窗口接一条新的分发/维护面**（未签名 exe + 杀软误报 + WebView2 依赖 + 每次发版都可能重编译）？
   我方现在这条 `.bat + node` 的面很薄，而且**已经验证过**（`README-开箱即用.md` 全篇按它写）。若拍板"不做壳"，本文的 §3 三件 S 仍然值得做，其余可以归档。
