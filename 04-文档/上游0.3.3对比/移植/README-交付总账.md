# 交付总账 · 上游 0.3.1→0.3.3 的「修 bug + 功能动画」

> 业主 2026-10-30：「**这些修bug的我要**」＋「**功能动画也要**」。
> 本文是这一轮的**账**：改了什么、测试数字、哪些明知不搬、哪些还没做。
> 分工与逐条证据在 `移植/` 下各子报告（`lead-穿透与buff.md` · `fix-sim-enemies.md` · `fix-attack-slot.md` ·
> `fix-bands-match.md` · `fix-client-l10n.md` · `fix-client-render.md` · `fix-anim.md` · `fix-client-consumers.md`）。
> 分析阶段的四份总账在上一级：`00-总纲与建议.md` / `A-数据差异.md` / `B-0.3.1.md` / `C-0.3.2.md` / `D-0.3.3与热修复试移植.md` / `E-动画修复清单.md`。
> **没有 git commit**，改动都在工作区，等业主过目。

---

## §1 已落地（按上游出处排）

| # | 上游 | 改了什么 | 落点 | 测试 |
|---|---|---|---|---|
| 1 | §37.30 / #798 | **固定穿透先减、百分比后乘**（PRTS 公式；我方原来是反的） | `server/sim/damage.js` `mitigate()` 物理/法术各一行 | `sim/fork-fixes-penetration-and-buffs` 4/4；`sim/core` 10/10（老断言按官方顺序更新） |
| 2 | §37.5 / round49 | **重入式 buff 移除崩溃**：onRemove 里再移除别的 buff 时按索引走会读 undefined | `server/sim/battle/status.js` `removeBuff()` 改快照+按身份定位 | 同上（两条重入用例） |
| 3 | §37.107 / #720 | **血珀**每秒流失 10% 最大生命（可致死、无来源、不吃 DEF/RES/闪避/屏障），自缚/不动/不可阻挡 | `sim/content/enemies/special.js` 新 kit；`content/enemies.js` 删 STATS_ONLY 那一行 | `sim/enemies-special` 5/5（回退→0/5 已验证红→绿） |
| 4 | §37.108 / #869 | **心虚设计师**被阻挡时正面朝向阻挡者（80% 减伤跟着转），同列保持上次朝向 [ASSUMED] | `special.js` `faceCrshd` | 同上 |
| 5 | §37.95 / #803 | **淤困**附着时闪现至阻挡者格心并自缚 + `teleport` fx（sim 侧 fromX/fromY） | `sim/content/enemies/element.js` | 同上 |
| 6 | §37.19/29/52/54/55 | **攻击类技能占用普通攻击的回合**（机制 + 昆图斯主线 + 管/弦/萨米/卢西恩 + 自在需要目标） | `sim/content/enemies.js`（`attackSlotSkill`/`attackTurnSkill`/`castNow`/`ATTACK_TURN_CLIP`）、`sim/content/bosses.js` | `sim/attack-slot` 6/6；`sim/battle` 27/27；`content/enemies_bosses` **287/287** |
| 7 | §37.26 / #839 | **鸭爵每回合只抽一次**（四人同量、同敌人、同种类） | `sim/content/bands/meta.js`（`duckPicks`/`duckGlobal`）+ `match/effectsMeta.js` 的 `ctx.seedFor('duck:<round>')` | `match/feedback1-ducklord` 5/5；`content/bands` 39/39 |
| 8 | §37.24/§37.53 / #851 | **「进入休整期时」改到机变选择之后**（老鲤 2/4 阶、preparation_start 类策略、干员特质） | `bands/meta.js`（5 个 key）+ `match/effectsMeta.js` 的 `GARRISON_HOOK`→`onPrepStart` | `content/fork-fixes-prep-start` 6/6；`content/garrisons_meta` 32/32 |
| 9 | §37.27 / #845 | **隐秘核心 R15 重新配对**（独立 salt + 不复用最终攻势搭档）；**有意偏差**：不加随机洗牌（业主 2026-10-16 的座位序配对决定，`finalAssault.js:63-84`） | `match/match/phases.js`（`bossPairSalt` / `previous:null` / `bossPairsRound`）+ `Match.js` 2 行 | `match/fork-fixes-hidden-core-pairs` 4/4；`finalAssault` 12/12 |
| 10 | #677 | **凯瑟琳突变细胞每玩家每局一次** | `bands/meta.js`（抽卡排除）+ `match/player/prep.js pickReward`（拿到才计数）；`gamedata.js`/`spDraft.js` 实为注释，无需改 | `match/fork-fixes-catherine-cell` 4/4；`cathy-pool` 1/1；`fuzz` 2/2 |
| 11 | #675 | **联防只给漏过来的那一波记账**（分裂/召唤子体不再抬 ×N 扣 LP） | `match/fields.js`、`match/unite.js` + `sim/battle/{spawns,deploy}.js`、`sim/spec.js` 的 `uniteRuntime` 标记 | `match/fork-fixes-unite-runtime` 4/4；`unite*` 9/3/5；`sim/battle` 27/27 |
| 12 | 0.3.1 #676 | **非简体中文下的高台部署**：我方只匹配中文「可以放置于远程位」⇒ en/ja/ko/繁中 全判地面（服务端照收，前后端不一致） | `shared/highGround.js`（`placeOnRangedOf` / `withPlaceOnRanged`）、`public/js/data.js`（从未本地化记录派生）、`shared/standIn.js`（自选温蒂） | `shared/highGround-i18n` 12/12；中文路径 1601 组 **0 差异** |
| 13 | 0.3.1 #700 | **非简体中文下的攻击范围预览**：三处正则跑在译文上 | `shared/loadoutRecord.js`（`skillCarriesOwnRange` / `moduleWidensRange` / `withRangeFlags`）、`public/js/data.js` | 同上；派生结果与上游 21 实体 ×27 布尔逐条相等 |
| 14 | §38.3 | **贴图/查表缓存按解析出来的图 URL 存**（原来把 item id 当图片身份） | `public/js/render/units.js`、`textures.js`、`render/app/host.js` | `render/content-set-cache` 8/8（撤改动→6 红） |
| 15 | §38.1 | **第一期商店装备位**：服务端私有视图补发 `shop.layout`，客户端按实际位数分栏、空位画空卡（不抄上游"整列消失"） | `server/match/player/views.js`、`public/js/ui/shopBar.js`（`shopColumns`） | `ui/shop-columns` 11/11、`match/feedback5-shop-levelslots` 3/3 |
| 16 | §35.19/§35.48/§35.57 | **敌人技能动画 clip 表**（昆图斯大潮/崩坍互换、胄死亡集群、泥岩两槽、自在、斩胄/破胄、锏、阿利斯泰尔） | `tools/assets/spine.mjs`（8 张表 + `slotClips`）、`data/assets.json` **只变 9 个模型** | `test/assets.test.js`（老断言按官方 clip 更新，已绿） |
| 17 | §35.20–§35.21 | **干员普攻片段**（德克萨斯 S1/S2、伺夜 S1/S2、归溟幽灵鲨 S1、焰影苇草 S2、耀骑士临光 S2、瑕光 S2） | 新增 `public/js/render/skillAttack.js` + `spine.js _attackClip` | 无映射时行为与改前完全一致 |
| 18 | #664 | **冷启动渲染超时后 2 s / 8 s 各重试一次**，提示只弹一次 | `public/js/ui/fieldHost.js` | `ui/fieldHost-lifecycle` 7/2（2 条先存，已用 HEAD 版文件证明） |
| 19 | §37.108 / §37.95 客户端半边 | **逐 tick 朝向**走 `b.snap.face` 可选列表 + **淤困 teleport 切断插值** | `server/sim/battle/events.js`、`public/js/render/interp.js`、`render/units.js` | 断言脚本 5/5；`content/facing` 14/14、`sim/battle` 27/27 |
| 20 | —（我方自己的） | **确定性守卫的红**：`kits/ops/chess_char_6_22-oblvns.js` 用 `Math.hypot/atan2/sin/cos/pow` ⇒ `detmath` 守卫一直红 | 该 kit 改用 `detmath`（分数指数改按参考帧取整后 `powi`） | `sim/detmath` 7/7（改前 6/7） |
| 24 | §37.19 一族 | **13 个敌人的 kit 改成「施放即占攻击回合」**：鼠王（2 技能）/ 锏（2 技能）/ 腐败骑士（`own:false`）/ 凋零骑士 / 陷落雪祀 / 扎罗 / 重弩突袭者 / 节日爵士乐手 / 黑云（kit 侧 `pr:1`）/ 自行炮 / 萨卡兹术师 / W / 迷路的巨像。clip 全部从**我方数据**复算（`fx/index.json` 的 `animKey` → `data/assets.json` 的 `spine.animations`），测试直接读这两份文件断言 | `sim/content/enemies/{archetypes,element,fly,invisible,leaders,special}.js`（`skill({atk, clip, own, pr})`） | `attack-turn-*` **13 个文件 39/39**；`enemies_bosses` 287/287；`combat` 24/24；`extra-enemies` 13/13 |
| 22 | §35.19 尾巴 | **杰斯顿 / 碎铳之簧 的 4 个 strike 槽**（表内容补齐，`data/assets.json` 只变这 3 个模型） | `tools/assets/spine.mjs`（`WARDEN_SKILLS`） | `assets.test.js` 55/64（9 条先存）；`cast-turnclip` 3/3 |
| 23 | §37.29 | **假想敌：胄【灭顶之灾】2.333 s、阿利斯泰尔【王权号令】3.667 s /【斥退】5.667 s** 改为占攻击回合（号令从 SP tick 挪到普攻伤害帧） | `sim/content/bosses.js` | `sim/attack-slot` **8/8**；`enemies_bosses` 287/287 |
| 21 | §35.57 表现半边 | **攻击回合里的施放播官方技能动画**：`cast` 事件加**可选第 5 字段 `turnClip`**（只在占用攻击回合时带），客户端持有该槽位剪辑、跳过这一回合的普攻动画；不声明就没有（旧形状逐字节不变，`PROTOCOL_VERSION` 未动） | `sim/content/enemies/helpers.js`（`castSlot`）、`enemies.js`（`castNow`）、`public/js/render/app.js`（cast/atk 两个分支）、`render/units.js`（`castHoldSeconds`/`holdCast`） | `sim/cast-turnclip` 3/3；`attack-slot` 6/6；`enemies_bosses` 287/287 |

---

## §2 明知不搬（与业主确认过的取舍）

- **分阶段结算内核**（§37.32/33/34/35，`server/sim/attack/`）：上游这一节就动 118/288 场景，我方自有内容挂在同一批钩子上几乎全动；
  L 级、要单独立项。折中已做：#1（穿透顺序）＋建议后续 #16/#17（伤判有序队列、红字口径）。
- **官方四版本** `data/versions/`：我方是「单季 + 自有内容」结构，多一版 = 自有内容叠三遍。要老内容应"并入单套数据"。
- **`PLUGIN_API` 抬 3**：本质是分阶段结算的下游，单独抬 = 放行语义对不上的插件。
- **皮肤呈现层 / 测试房间 / 结算页与事件 UI 重排**：我方有自研替代或 UI 已整体分叉。
- **§36.32 琳琅诗怀雅 S3 回官方**：与业主 2026-10-04 的决定正面冲突。

---

## §3 已知缺口 / 下一步（按建议顺序）

0. ~~杰斯顿 / 碎铳之簧 的 4 个 strike 槽~~ → **已做**（见 §1 第 22 行）。
1. ~~攻击回合内技能的「表现」~~ → **已做**（业主 2026-10-30 追加「3」）：`cast` 加可选 `turnClip`，客户端播该槽位官方剪辑并跳过这一回合普攻。
   **残留**：剪辑内的起手/命中帧、以及按技能 Ability 的 `animKey` 播，仍由既有 `spine.js` 播放器决定（上游是 `UnitView.onCast` 的做法）——属渲染层后续项，不影响机制与事件契约。
2. ~~其余敌人 kit 改写~~ → **已做**：**15 个敌人**（胄 / 阿利斯泰尔在 `bosses.js`；其余 13 个在 `content/enemies/*.js`），见 §1 第 23、24 行。
   **残留一条形状差**：我方 slot `{cd,icd,sp,bb,bs,slot}` 不接受数据里的 `priority`，`attackTurnSkill` 读 `a.pr ?? a.sk.pr ?? 0` ——
   黑云那种「两技能不同优先级」本轮在 kit 里显式写 `pr`；将来若搬上游 `attackTurnSkill` 的形状再统一。
   原口径：上游两张表里另外 20 余个敌人（胄/阿利斯泰尔/术师/腐败骑士/凋零骑士/重弩突袭者/黑云/城防炮/W/鼠王/巨像/雪祀/锏/扎罗/节日爵士乐手…）
   仍是旧行为（技能自己按冷却放）。**不许只打标不改 kit**（会变成"既不放技能也不攻击"），随各自 kit 改写再做。
3. ~~杰斯顿 / 碎铳之簧 的 4 个 strike 槽~~ → **已做**（见 §1 第 22 行）。
4. **`data/*.json` 的正路重建**：本轮 `assets.json` 是"作用域重建"（三重校验：字节可逆 / 与上游逐字节相同 / 不动点），
   给一份完整 `public/assets` 后应重跑一次 `fetch-assets` 确认逐字节相同。
5. **文档**：`docs/I18N.md` / `docs/DATA.md` 已补（旗标不落盘、载入时派生）；**DESIGN 的 §40 还没建**
   （上游 §38 在我方是 §40），`docs/history` 的修订条与 CHANGELOG 节要随发版一起写。
6. **可选"正本清源"**：把 `placeOnRanged/passiveRange/rangeExpand/modeOnly` 按上游做法派生进 `build-data` → `data/chess.json`，
   读端一行都不用改（字段名已与上游一致）。

---

## §3.5 这一轮**没有**做的事（明确写出来，别当成漏了）

- **没有 git commit**：所有改动留在工作区，按仓库规矩"一题一提交"，等业主过目后再分批提交。
- **没有动 CHANGELOG**：顶层节数就是游戏内公告条数（`server/notices.js` 取前 8 节），写节必须和发版/抬版本号一起做。
- **没有建 DESIGN §40**：上游 §38 在我方是 §40，建节要动 `docs/DESIGN.md` 索引 + `docs-paths` 守卫，属整批发版收尾。
- **没有改 `data/*.json` 的手工内容**：唯一的数据变化是 `assets.json` 里 9 个模型的 anim 指派（由生成器改表后重建，见 §3 第 4 条）。

## §3.6 版本号与文档收尾（2026-10-30 已做）

- `APP_VERSION` **0.19.36 → 0.19.37**；`UPSTREAM_VERSION` **'0.3.0' → '0.3.3'**；`package.json` 的 `version` / `release` 与 `package-lock`
  的 `version` / `packages[""].version` 同步；README 的徽章与「版本号怎么读」表跟着改。
- **新增 `docs/history/0.3.3.md`（DESIGN §40）**：只记录**我们移植了的那部分**（§40.1 规则 / §40.2 对局与敌人 / §40.3 表现 / §40.4 明确不搬 / §40.5 版本号口径）。
  §38 / §39 留给将来把上游 0.3.1 / 0.3.2 整章搬进来时用 —— 我们这次是"摘件"，不是"整章转抄"，所以不占那两个号。
- `docs/DESIGN.md` 索引加一行；`CHANGELOG.md` 顶部加 `## 0.19.37 — 2026-10-30`（高层节数仍 >8，公告窗口不受影响）。
- 文档守卫：`docs-consistency` 16/25、`docs-paths` 2/7（**与改动前完全相同**，都是先存红；`docs-paths` 的 5 条是沙箱 `spawnSync` EPERM）。
- `test/version.test.js` **6/6 绿**（它钉着 package.json / lockfile / APP_VERSION / CHANGELOG 首节四处一致）。

## §3.7 出包与提交准备（2026-10-30 21:2x）

- **华为云包已出**：`05-部署/sp-01937-20261030.tar.gz`（2,317 文件 / 41,809,825 B / sha256 `5df0958b…a519d`），
  由 `05-部署/pack-01937.mjs`（工作树出包、纯 Node）生成，闸门全过（本轮 7 道 + 沿用 0.19.36 的 68 模型 / 131 协议源石 / 充能环 / 熔断 / 木桩 / boss_13·14）。
  包内抽查：`APP_VERSION '0.19.37'`、`UPSTREAM_VERSION '0.3.3'`、`damage.js` 的新公式注释都在。
- **阿里云包已出并上线**：`服务器/sp-deploy-01937.tar.gz`（894,711,187 B / 45,171 条目 / sha256 `438ade95…1831d`，按 `pack-forge-linux.ps1` 的排除规则用 GNU tar 打，额外剔掉 `.scratch` / `pip-*` / `.pyenv` 这些本地垃圾），21:52 蓝绿切到槽 b（build `d1d328115920`），旧槽等对局打完自然排空。
- **上线记录**：`05-部署/0.19.37-上线记录-20261030.md`（阿里云 / 华为云两张表留了「待执行」，含核对项与回滚）。
- **提交脚本已备好但没跑**：`05-部署/commit-01937.sh`（三段提交、逐路径显式 `git add`）。没自动跑的原因见 §4 第一条下面的「工作区里不是本轮的东西」。

## §4 验证方式与这棵树的限制（重要，别误读数字）

- **本 checkout 没有 `test/golden/` 与 `test/fixtures/`** ⇒ `npm run golden` **跑得起来但无从比对**：实测 `node tools/golden.mjs` 跑完 99.97 s，
  每个场景都报 `(not in the golden file)`。`golden:update` 可以从当前行为**生成**语料（约 2–4 分钟），但那等于把现在这套行为钉成基线 ——
  **这是业主的决定，我没有替你跑**。要恢复回归网，先在一个干净 checkout 核对完再 `golden:update`。所有 golden 预算（"上游动几个场景"）
  目前只能人工对照；**发版前必须在完整仓复核**。
- **沙箱里 `node --test <file>` 会 EPERM**（它 spawn 子进程）⇒ 本轮一律 `node test/xxx.test.js` 单文件跑。
  `npm run ci` 的 `test` 步骤、`client-static`（它 `spawnSync(node --check)`）在本机跑不了，需正常机器补跑。
- **既有红灯**（与本轮无关，各人用"回退改动重跑计数不变"证过）：`hexcards-armor` 7、`data.test` 5、`i18n.test` 2、
  `i18n-packs` 2、`match/loadout` 2、`match/feedback1-placement` 1、`content/op_cgbird` 1、`ui/playtest2` 1、
  `sim/feedback1e-skillrange` 2、`docs-consistency` 9、`docs-paths` 5、`economy` 3、`scroll-copy-merge` 2、`connection` 1、
  `hardening` 1、`standin-ui` 1、`hud-readouts` 2、`assets.test` 9（HTTP `.part` 用例 / 自建干员缺技能图标 / pixi-spine boneData null）、
  `sim/feedback1-transform` 1（深池逐火 ember）、`sim/feedback1f-liftoff` 1（胄的刺胄之弹）—— 后者两条由 fix-sim-enemies 用「把 13 个 `atk` 标记临时全关」证过与本轮无关；
  **`test/diag.test.js` 与 `public/js/diag.js` 已经整份对不上**（两个文件都未改动 ⇒ 提交树里就不一致，不是本轮引入）。2026-10-30 已做**可逆收口**：
  导入行去掉 4 个已不存在的名字，8 条描述「旧 API」的用例标 `test.skip` 并在文件头写明原因 —— 现在 19 条：**11 pass / 8 skip / 0 fail**（原来是整个文件 SyntaxError）。
  三处漂移需要业主拍板：① `diagnosticsPayload`（POST /api/feedback 的 body）已随「诊断只在本机、复制到剪贴板」的改版删除；
  ② `isDomEvent` / `isResourceEvent` / `eventLabel` 三个导出已删（Event 读数并入 `messageOf`）；
  ③ **房间号从「保留」变成「替换」** —— 模块头与设置页提示都写「房间号会被替换」，而旧规格坚持「owner 要知道是哪个房间」。
  要么按现行实现重写那 8 条，要么把 4 个导出与「保留房间号」恢复回来。
  **`hexcards-armor` 那 7 条已按业主口径收口（2026-10-30，业主答「期望 200%」）**：卡片数据 `data/hextech.json` 的
  `hex_armor.effect.armor = { defRatio: 200, onDealt: true }`（「受到**或造成**伤害时对敌人造成 **200%** 防御力真伤」，
  业主 2026-10-15 的重做），是**测试还停在旧口径**（100% / 只有「受到」半边）。已把 7 条断言改成 2×DEF，
  并把「打敌人不触发」那条按卡面改写成「造成伤害半边也会回一发」；`test/sim/hexcards-armor.test.js` 现 **15/15**。
  代码一行没改。
