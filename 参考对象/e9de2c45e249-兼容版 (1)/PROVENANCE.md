# 署名与来源 · PROVENANCE

> 本文件随包分发。原作者与本版兼容改写者**分开显示，不抹掉任何一方**。
> 原件未署名的一律写**「原件未署名」**，不代填名字；许可**照实抄**（甲方声明什么就写什么，不替其断言真伪）。

## 一、原作者

**jingjiangze**（原件 `pack.json` 的 `author` 字段，如实照抄，不代填）。

## 二、许可（照实抄）

原件 `pack.json` 声明 `GPL-3.0-or-later`，**照实抄**，本版未改该字段。

## 三、本版兼容改写者

| 角色 | 是谁 |
|---|---|
| 原作者 | jingjiangze |
| 本版兼容改写者 | **Mo233**（Forge 兼容改写：包格式对齐 + 署名文件，改写点见第六节） |
| 本包交付 | 第三方 mod 兼容交付流程，2026-10-12 |

## 四、来源

| 项 | 值 |
|---|---|
| 站点 | sp-modsite（`http://47.103.14.217:25570/`）待审投稿 |
| 记录 id | `2a031cf0f869` |
| 原件 sha256 | `bcf6f231bb0787f6b0b2c8ef32a431cd6c04b69413268a71363f1eb13c64986f` |
| 上传时间 | `2026-10-11T18:11:03.981Z` |
| 上传来源 ip | `119.181.30.24` |
| 原件形态 | `mod.zip`（7（含一层顶层目录 `cdn-source/`） 个条目） |
| 同批早期版本 | `1987d5e03a4e`（v1.0.0，包内测试因 vendor 顶层 import 而红）· `6b351c3c29c5`（v1.0.1）—— 本包取 **v1.0.2** |

## 五、改了什么

本包是**同形状重打 + 两处声明对齐**，`client/cdn.js`、`README.md`、`test/cdn.test.mjs` **逐字节未改**。

原件 `pack.json` 有两处会撞上引擎的**闭枚举**，导致整包被 `PACK_LOAD` 拒绝、连面板都挂不上：

| # | 原件写法 | 引擎判据 | 处置 |
|---|---|---|---|
| 1 | `client.panels[0].data: []` | `shared/workshop.js:619-620` `CLIENT_BAD_PANEL_DATA` —— 「空数组请把键去掉」；`data` 是**非空**数组才算声明 | **删掉 `data` 键**（原件本就读不到那几张表） |
| 2 | `client.requires: ["fetch","PerformanceObserver"]` | `shared/workshop.js:700-701` `CLIENT_UNKNOWN_REQUIRE` —— `CLIENT_REQUIRES` 是闭集 `{serviceWorker, cacheStorage, webCrypto}`（`shared/workshop.js:364`） | **删掉 `requires` 键**（见下「未改什么」） |

另：原件 zip 有一层顶层目录 `cdn-source/`（站点 `WRAPPED` 警告）；本版把 `pack.json` 放到 **zip 根**。

### 未改什么（以及为什么）

**没有**把 `fetch` / `PerformanceObserver` 加进引擎的 `CLIENT_REQUIRES`。作者的原意是「浏览器缺这两个能力时**报错而不是静默**」，
但 `client.requires` 的语义是**这个中间层知道的能力开关**，值域是闭集；加值等于改引擎语义，不在兼容改写范围内。
删掉声明**不带来静默失败**：面板正文用 `fetch`（`client/cdn.js:51`）与 `performance.getEntriesByName`（`client/cdn.js:30`），
两者是**任何浏览器都有的 Web API**，不是需要许可的可选能力；原来的 `requires` 条目本身就是对能力清单的**误归类**。

## 六、自带素材

**无**。本包自带素材为零（无图片 / 音频 / Spine）：只有 `client/cdn.js`（JS）、`README.md`、`test/cdn.test.mjs`。

## 校验

- 本包**单独**装载于干净的 workshop 根（根内只有这一个包）：`node tools/workshop-validate.mjs --workshop <root>`，结果见交付索引。
- 引擎版本：Stronghold-Protocol `0.15.2`（`cb684ee6`），`MOD_API_VERSION` 1。
- **数值一个字节未改**：本包不含任何 `data/*.json` 官方数值改写，`combat` 未声明（不改对局结果）。

---

*English summary: this pack is a compatibility conversion delivered for Stronghold-Protocol. The original author and
the compatibility rewriter are listed separately above; where the original was uncredited it is stated as
"原件未署名 (uncredited original)" rather than being invented. The licence text is copied verbatim from the original.
See the Chinese sections above for the exact source, the list of changes, and the origin of any bundled assets.*
