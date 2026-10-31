# E — 动画/表现修复清单（上游 0.3.1 / 0.3.2 → 我方）

> 只出报告，不改代码。上游基线：`C:/Users/hhyyl/Downloads/Stronghold-Protocol-Forge-0.21.0-0.3.3/...`（记 `上游:`），我方 `Stronghold-Protocol-Forge-协议源石版/app`（记 `app/`）。
> **节号口径**：上游 §37.x = 我方 §39.x（本仓库 §28/§29 是插入的两节，之后一律 +2，见 `app/AGENTS.md`「Section numbers」）。报告里引用上游节号时一律写「上游 §37.x」，落到我方文档时再 +2。
> 本报告的判据：**A/D 那一批敌人技能 clip 全是上游硬编码的字面量表**（`上游:tools/assets/spine.mjs:144-193`），不读本机素材索引 ⇒ **不需要重抽素材**；只有 F 档的 `#679/#680` 音效池与 D 档 `#729` 的 rate 事件是真缺口。

---

## §0 一句话 + 分档速览

**一句话**：这一批「修 bug 的表现项」里，**敌人技能动画错配（A）与干员普攻片段（C）都是「一张字面量表 + 一个消费点」，我方数据与模型 12/12 齐备，属于能立刻做的 Ⅰ 档**；而 B/D/E 三项（攻击回合释放、攻速间隔驱动动画、战后待机/冷启动重试）要动 sim 内核与渲染主线，是 Ⅱ/Ⅲ 档。

| 档 | 条目 | 代价 | 依赖 | 备注 |
|---|---|---|---|---|
| **Ⅰ** | A 敌人技能 clip 表（昆图斯/胄/阿利斯泰尔/泥岩/自在/斩胄之剑·破胄之锤/锏/杰斯顿/碎铳之簧，非 strike 部分） | **S** | 无（模型与 durations 我方齐备） | 一张表 + `applyRoleFix` 6 行 + 重建 `assets.json` |
| **Ⅰ** | C 干员普攻片段（德克萨斯 S1/S2、伺夜 S1/S2、归溟幽灵鲨 S1、焰影苇草 S2、耀骑士临光 S2） | **S** | `vfx/skills.js`（我方已有） | 上游是一个 69 行新文件 |
| **Ⅰ** | E-2 冷启动渲染超时后 2 s / 8 s 自动重试（#664） | **S** | 无 | 我方 `fieldHost.js` 已有 12 s 超时、缺重试 |
| **Ⅱ** | F-1 白面鸮/焰影苇草 S3 技能循环姿势保持（§36.4/36.4.1） | **M** | `spine.js` 状态机 | 修的是「每次治疗重播动画」的观感硬伤 |
| **Ⅱ** | E-1 战斗结束存活干员回待机 + 特效收束（#821） | **M** | 新增 `battlePresentation.finish` | 我方 0 命中 |
| **Ⅱ** | F-3 余 S3 火墙官方特效（`vfx/yuwall.js`） | **M** | 我方无 `yuwall.js`（80 行） | 依赖 gl/glsl 逐效果战场裁剪 |
| **Ⅲ** | B 攻击回合释放的攻击类技能（§37.19/37.29/37.52/37.57） | **L** | sim `attackSlotSkill` + 客户端 `castStrike` + 新 `windup.js` + golden | 与「fix-attack-slot」同一族，建议合并排期 |
| **Ⅲ** | D-2 攻击动画按模拟间隔（#729，§37.82/§37.101） | **L** | 新 `['rate',id,sec]` 事件 + 渲染消费 + **全量 golden 重算** | 我方 sim 侧 0 命中 |
| **Ⅲ** | F-2 攻击/命中音效按官方音库（#679/#680） | **L** | `data/assets.json` 缺 `audio.sfx.pools`（1013 池） | 数据缺口，需上游那份 assets 生成链 |

---

## §1 数据缺口：我方 `data` 到底缺哪些动画字段（决定「能不能只搬代码」）

| # | 上游有、我方无的东西 | 我方实测 | 结论 |
|---|---|---|---|
| 1 | `data/assets.json → enemies.<key>.spine.anims`（角色表：idle/attack/die/skill/**skills[]**） | **字段在，值错**：12 个目标模型全部有 `anims`，动画时长数量与上游一致（8/7/8/12/16/16/18/12/7/7），只是**指派错**（§2-A 逐条表） | ✅ **可只搬代码/表**，重建后即生效 |
| 2 | `public/assets/local/fx/index.json` 的 `units.<key>.skills.<prefab>.abilities[].animKey` | 我方索引是 `version: 3`，但 **`abilities` / `animKey` 命中 0 次**（整个文件 grep 0） | ⚠️ 上游**不依赖它**：clip 名在上游是硬编码常量 ⇒ 我方**不必**重抽就能修 A 档 |
| 3 | `tools/local-extract/`（重抽本机素材的 Python 链，上游 17 个文件：`extract.py`/`fx.py`/`operators.py`…） | **我方整个目录不存在** | ❗️我方**现在无法重抽**；凡是「必须重抽才生效」的项，一律 Ⅲ 档 |
| 4 | `data/assets.json → audio.sfx.pools`（音效按池引用，0.3.1 #680） | 我方 `audio.sfx` 只有 `ui/battle/units`，**没有 `pools`**；单位条目写死 `/assets/audio/...mp3` | Ⅲ 档：要搬上游 `tools/assets/audio.mjs` 那一代生成 + 素材 |
| 5 | `assets.json` 体量（上游 16956 文件 / 229 chars，我方 8441 / 213） | 差的是「四版花名册并集」表现层（上游 0.3.2 §37.109） | 与本批动画修复无关（12 个目标模型都在） |
| 6 | sim 协议里的 `['cast', id, slot, dur, clip]` 第 5 字段、`['rate', id, sec]` | 我方 `castSlot` 只发 3 元组（`app/server/sim/content/enemies.js:291`「display only: the skill slot it uses」），`rate` 事件 0 命中 | 是 B / D-2 的**依赖缺口**，不是数据缺口 |

**所以：A 档的「数据缺口」其实不存在** —— 差的只是 `tools/assets/spine.mjs` 里那张表 + `data/assets.json` 的重建。

---

## §2 逐条清单

### A. 敌人技能动画错配（上游 §37.19 + §37.48）

**上游落点**：`上游:tools/assets/spine.mjs:144`（`slotClips` 助手）、`:147 HELM_SKILLS`（胄）、`:150 QUINTUS_SKILLS`（昆图斯）、`:152 LION_SKILLS`（阿利斯泰尔）、`:158 MDROCK_SKILLS`（泥岩）、`:163-164 XI_SKILLS`（自在）、`:167 HAND_SKILLS`（斩胄之剑/破胄之锤）、`:170 MACE_SKILLS`（锏）、`:176 WARDEN_SKILLS`（杰斯顿/碎铳之簧）、`:177-193 PREFAB_SPINE_ROLES`（12 条挂载）；`:208-214 applyRoleFix` 增加 `skills` map 与 `null` 支持。上游叙述：`上游:docs/history/0.3.2.md:1412`（§37.19）、`:3946`（§37.48，含对照表）。
**我方落点**：`app/tools/assets/spine.mjs:138-143`（`PREFAB_SPINE_ROLES` 只有 2 条：囚犯 `enemy_1116_liprr`、宴 `char_337_utage`）、`app/tools/assets/spine.mjs:153-163`（`applyRoleFix` **不支持 `skills` map**：它按 `begin/loop/end/idle` 取名字，遇到 `{0:{…},1:{…}}` 会全部判 missing）、产物 `app/data/assets.json`。
**归类**：代码逻辑（字面量表）+ 生成数据（`assets.json` 重建）。
**代价**：**S**（表 ~50 行 + `applyRoleFix` 6 行），但必须跑重建（`node tools/fetch-assets.mjs --offline --add-only`，我方有 `public/assets/local/fx/index.json` 与 12 个模型，理论可离线跑；跑不动则只能等，**不许手改 data**）。
**依赖**：无（不依赖 index 的 `abilities`）。**`strike` 属性的 4 个槽是例外**（杰斯顿 0/1、碎铳之簧 9019/9020 的 slot 0）—— 那个属性只有 B 档的 `onCast/castStrike` 会消费，先搬表也不会报错，只是暂时不生效。

**逐条对照（我方 `app/data/assets.json` 现值 vs 上游值；已实测）**

| 敌人 | 槽（prefabKey） | 官方 clip（上游） | 我方现值 | 后果 |
|---|---|---|---|---|
| 盐风主教昆图斯 `enemy_1521_dslily` | 0 大潮 `tidewater*` | `Skill_02` 1.667 s | `Skill_01` 3.0 s | **大潮播崩坍的动画** |
| 同上 | 1 崩坍 `rockfall*` | `Skill_01` 3.0 s | `Skill_02` | 两槽互换 |
| 同上 | 2/5/8 断裂生殖、3/4/6/7 分形态大潮/崩坍、9 物种爆发 | `Skill_03`/`Skill_02`/`Skill_01`/`Skill_04` 4.467 s | 按名配对 | 第三形态大潮播 4.467 s 物种爆发 |
| 阿利斯泰尔 `enemy_9032_aclionk` | 0 equip / 1 store / 2 storeA / 3 equipA / 4 Suicide | `Skill_1`/`Skill_2`/`Skill_2`/`Skill_1`/`Skill_3` | 按名配对（`storeA`→`Skill_3`、`Suicide`→主 clip） | 王权号令/斥退错配 |
| 假想敌：胄 `enemy_9013_acstmk`（+ `_2`） | "1" 灭顶之灾 / "2" 死亡集群 / "3"（仅 `_2`）Revive | `Skill_1` / **`Skill_3`** / `Revive` | 按名 `Skill_2` / `Skill_3` | 死亡集群播 2.533 s 的 `Skill_2`（应 3.833 s `Skill_3`）；`_2` 的 slot 2 播错 |
| 泥岩 `enemy_1511_mdrock` | 0 RefreshShield / 1 occupy | `Skill_2` 1.333 s / `Skill_1` | `Skill_1` 1.5 s / `Skill_2` | 两槽互换 |
| “自在” `enemy_1517_xi` | 0 CrossAttack（纬地经天） | `Skill_01_02` | `Skill_01` | 播错片段 |
| 同上 | 1/2 ShieldBurst / ShieldBurstReborn（破桎而出） | 官方 `_animKey` 空 → 用骨架唯一 `Skill_02_Begin/_Loop/_End`（[ASSUMED]） | slot 2 无 clip（播 CrossAttack 的 `Skill_01`） | 破桎而出无姿势 |
| 斩胄之剑/破胄之锤 `enemy_9014_acstma`/`9015_acstmb` | "1" 掷剑/掷锤 / "2" | `Launch_Begin` 1.367 s / `Back_End` | `Skill` 1.733 s（两槽） | 掷出/收回都播同一个 |
| 锏 `enemy_1525_blkswb` | 0 CircleAttack / 2 CircleAttack2 | `A_Skill2` / `B_Skill2` 2.067 s | 攻击角色（无 clip） | 肆虐风雪无技能动作 |
| 同上 | 1 Blink / 3 Blink2（速杀） | 官方无 clip → 保持攻击角色（`via: 'attack'`） | 攻击角色 | 一致，无需改 |
| 杰斯顿·威廉姆斯 `enemy_1516_jakill` | 0 ironsandstorm / 1 armorpiercing | `C1_Skill` 2.067 s / `C2_Skill` 1.133 s，**`strike`** | 攻击 clip | 需 B 档才生效 |
| 碎铳之簧 `enemy_9019_actrpb`/`9020_actrpc` | 0 | `Skill_b` 3.0 s / `Skill_c` 6.967 s，**`strike`** | 攻击 clip | 需 B 档才生效 |

**建议**：**做**。Ⅰ 档，收益最高（老板能直接看出「大潮播崩坍」这类错配）。分两步：先搬非 `strike` 的 8 个模型（昆图斯/阿利斯泰尔/胄/泥岩/自在/斩胄破胄/锏），`strike` 的 4 槽等 B 档。

### B. 敌人在攻击回合释放的攻击类技能（上游 §37.19 Now / §37.29 / §37.52 / §37.57）

**上游落点**：sim —— `上游:server/sim/content/enemies.js:211`（tick 里让位给 `attackSlotSkill`）、`:234 attackSlotSkill`（挥击伤害帧处改放技能）、`:275 castNow`（冷却从 clip 结束起算）；`上游:server/sim/content/bosses.js:1028 QUINTUS_CLIP`、`:187 atkSkill`、`:982 atk: true`。客户端 —— `上游:public/js/render/units.js:1588 onCast`、`:1624 windUpCast`、`:232 STRIKE_WINDOW`；`上游:public/js/render/spine.js:812 castStrike`、`:819 skillAttackMode`、`:1034`；新文件 `上游:public/js/render/app/windup.js`；协议 `['cast', id, slot, dur, clip]` 5 元组（`上游:docs/history/0.3.2.md:4309` §37.57）。
**我方落点**：**全部缺失**（grep 实测：`attackSlotSkill` 0、`castNow` 0、`QUINTUS_CLIP` 0、`castStrike` 0、`STRIKE_WINDOW` 0、`onCast` 0、`windUpCast` 0；`app/public/js/render/app/` 无 `windup.js`；我方仍是 `app/server/sim/content/enemies.js:170 on('tick')` 的独立冷却计时——**正是上游 §37.19 判定的成因**）。
**归类**：代码逻辑（sim 内核 + 渲染）+ 协议字段。
**代价**：**L**。**依赖**：golden（§37.19 让 5 个昆图斯场景结果变了：`上游:docs/history/0.3.2.md:1586-1593`；§37.57 只有 `events.cast` 变）；与「fix-attack-slot」强相关（同一族）。
**建议**：本批**不做**，与 fix-attack-slot 合并排期。**A 档先落地不受它阻塞**。

### C. 干员普攻片段按官方技能/模式/皮肤表（上游 §37.20，0.3.2；含 0.3.1 §36.31 的瑕光单行）

**上游落点**：`上游:public/js/render/skillAttack.js:19-25 NORMAL_ATTACK_SKILLS`（德克萨斯 `0:'skcom_charge_cost',1:'skchr_texas_2'`、伺夜 `0/1`、归溟幽灵鲨 `0:'skchr_ghost2_1'`、焰影苇草 `1:'skchr_reed2_2'`、耀骑士临光 `1:'skchr_nearl2_2'`）、`:37-69 skillAttackMode`（含 `char_423_blemsh` 瑕光 S2 的单独分支 `:59-68`）；被 `上游:public/js/render/spine.js:816 _attackClip` 消费（`:819 const mode = this.skillOn ? this.skillAttackMode?.() : null;`）。叙述 `上游:docs/history/0.3.2.md:1603`；0.3.1 的瑕光首版 `上游:docs/history/0.3.1.md:1156`（`:1269` 明确「Only the 瑕光 S2 row ships in 0.3.1」）。
**我方落点**：**无 `app/public/js/render/skillAttack.js`**；`app/public/js/render/spine.js:704 _attackClip()` 是旧路径（技能期间一律返回技能角色），`app/public/js/render/vfx/skills.js` 已有 `resolveSkill`。
**归类**：代码逻辑。**代价**：**S**（69 行新文件 + `_attackClip` 一处调用）。**依赖**：无。
**建议**：**做**（Ⅰ 档）。注意只搬「已核验的 5 干员 7 槽 + 瑕光 S2」，不要泛化原始 `animKey`（上游 `:28-36` 有明确警告：胡摩 S2、百炼嘉维尔 S3 等反例）。

### D-1. 朝上施放技能时背面缺技能动作（#786，上游 §37.90）

**上游落点**：`上游:public/js/render/spine.js:761 _skillLoopHeld` / `:812 castStrike` / `:600` 一线的 `setSkill`（Front-only 技能 clip 保留完整可见窗口）；说明 `上游:docs/history/0.3.2.md:4778`（薄，PR #786 合并文）。
**我方落点**：`app/public/js/render/spine.js:749 setSkill(on)`、`:724 _skillIdle()`，**无 `_skillLoopHeld`、无 Front 回退分支**（grep 0）。
**归类**：代码逻辑。**代价**：**M**（要跟 F-1 的技能循环状态机一起改，两者同一段代码）。**依赖**：F-1。
**建议**：与 F-1 合并成一次 `spine.js` 技能姿势专项（Ⅱ 档）。

### D-2. 攻击动画直接使用模拟间隔（#729，上游 §37.82 + §37.101）

**上游落点**：sim —— `上游:server/sim/battle/events.js:31/39/49-51`（`_emitRateChanges`：`['rate', id, seconds]`）、`上游:server/sim/snapshot.js:33`（出生时 `_rateSent` 初值）；渲染 —— 说明 `上游:docs/history/0.3.2.md:4711`（§37.82）、`:4892`（§37.101：同批多帧只取**最后一个**间隔）。
**我方落点**：**sim 侧 0 命中**（`_rateSent`/`'rate'` 无）；渲染层用出生快照的攻速。
**归类**：代码逻辑（sim 事件 + 渲染）+ 全量 golden 重算。**代价**：**L**。**依赖**：无（但改动面大：上游说 4 个版本的 golden 里 `events.rate` 全部新增）。
**建议**：**不做/后置**。它修的是「首个攻速变化/同帧前摇/批内最后攻速」的时序观感，收益可见但代价与风险最高。

### E-1. 战斗结束表现（#821，上游 §37.16）

**上游落点**：`上游:public/js/render/app.js:2148 finishBattle()` → `presentation.finish()`；`上游:public/js/render/battlePresentation.js:10 finish()`；调用点 `上游:public/js/screens/game.js:686`；叙述 `上游:docs/history/0.3.2.md:749`（存活单位从战斗/异常姿势回 idle、持续特效停止、一次性特效 2 s 上限 [ASSUMED]）。
**我方落点**：`finishBattle` 0 命中（`app/public/js/render/` 与 `app/public/js/screens/` 都没有）。
**归类**：代码逻辑。**代价**：**M**（新增 `battlePresentation.finish` + 在单位视图上逐个收束 + 结束钩子）。**依赖**：无（不动 sim、不动 golden）。
**建议**：**做，但排 Ⅱ**（观感收尾，老板说的「功能动画」里最容易被看见的一条）。

### E-2. 冷启动渲染超时后自动重试（#664，上游 §37.17）

**上游落点**：`上游:docs/history/0.3.2.md:753`（只有超时才重试，2 s / 8 s 两次；缺 WebGL 不重试；事件重试上限 2；提示每次挂载只弹一次）。实现落点在上游 `public/js/ui/fieldHost.js` 的 stage 超时分支。
**我方落点**：`app/public/js/ui/fieldHost.js:17 LOAD_TIMEOUT_MS = 12000`（有 12 s 超时，**无任何重试**；全文件只有 1 处超时常量）。
**归类**：代码逻辑。**代价**：**S**。**依赖**：无。**建议**：**做**（Ⅰ 档，纯前端、无协议无数据）。

### F. 0.3.1 那批（上游 §36.4 / §36.5 / §36.6 / §36.10 / §36.25 / §36.31 / §36.32）

| 项 | 上游落点 | 我方落点 | 归类 | 代价 | 建议 |
|---|---|---|---|---|---|
| F-1 白面鸮 S2 / 焰影苇草 S3 的 Begin-Loop-End 姿势保持（每次治疗不再重播） | `上游:docs/history/0.3.1.md:276`（§36.4）、`:285`（§36.4.1 OnAttack 在循环里）；实现 `上游:public/js/render/spine.js:761 _skillLoopHeld`、`:816 _attackClip` | `app/public/js/render/spine.js:704 _attackClip()`、`:724 _skillIdle()`、`:885-887`（attack 分支：`const clip = this._attackClip() \|\| this.roles.attack`）；**无 `_skillLoopHeld`** | 代码逻辑 | **M** | 做（Ⅱ）：这是「技能期间站着不动又跳回去」的硬伤，与 D-1 #786 同一段代码，合并做 |
| F-2 攻击/命中音效按官方音库（#679 `§36.10`、#680 `§36.25`） | `上游:docs/history/0.3.1.md:723`、`:1034`；数据 `data/assets.json → audio.sfx.pools`（1013 池） | `app/data/assets.json` 无 `pools`；单位条目写死路径 | 素材/数据需生成链 | **L** | 不做（Ⅲ）：要搬上游 `tools/assets/audio.mjs` + 素材本体 |
| F-3 余 S3 灶里乾坤·火墙官方特效 | `上游:docs/history/0.3.1.md:1182-1207`；新文件 `上游:public/js/render/vfx/yuwall.js`（80 行）+ `glsl.js/gl.js/system.js` 逐效果战场裁剪 | 我方 `app/public/js/render/vfx/` **24 个文件、无 `yuwall.js`**（上游 29 个） | 代码逻辑（新 vfx 模块） | **M** | 排期（Ⅱ）：单独一个 vfx 模块，可独立做 |
| F-4 缪尔赛思 S3 流形攻击形态（攻击的复制体变球） | `上游:docs/history/0.3.1.md:1209-1226`（官方 `token_10030_mlyss_wtrman` 的 `_replaceAnimPairs`：Melee 用 `A_*`、Range 用 `B_*`、切换用 `Change_A/B`；索引侧给 c2/c3_attack_start_01 等）。**实现落点 [待复核]**：上游 `units.js` 里搜不到 `mlyss`，说明不在 `FORMS` 而在索引模式/skillfx 解析一侧 | `app/public/js/render/units.js:448 FORMS` 存在，无流形条目 | 代码逻辑 | **M** | 排期（Ⅱ），先补落点再动手 |
| F-5 瑕光 S2 攻击动作（含「睡着的人不再挨打」的 kit 侧） | `上游:docs/history/0.3.1.md:1156`（`:1269` 只发这一行）、`:1289`（§36.32）；实现即 C 档 `skillAttack.js` 的 blemsh 分支（`上游:public/js/render/skillAttack.js:59-68`） | 同 C：无 `skillAttack.js` | 代码逻辑 | **S** | 与 C 一起做 |
| F-6 荒芜拉普兰德 / 能天使 / 安洁莉娜 / 回环射手的特效位置 | `上游:docs/history/0.3.1.md:434`（§36.6：站立、从武器发出、回头的特效） | `app/public/js/render/vfx/wiring.js`（我方存在） | 代码逻辑 | **M** | 排期（Ⅱ）；需逐条核 4 个特效的挂点 |
| F-7 持续区域（毒/火/腐蚀/治疗场/光环/死亡云）在官方特效下 | `上游:docs/history/0.3.1.md:294`（§36.5，逐类审计；`pollution` 带 `src`） | 我方有 `vfx/skills.js`/`skillfx.js`，无 `ENEMY_FX_COVER`（grep 0） | 代码逻辑 | **M** | 与 A 档一起看：`ENEMY_FX_COVER`（`上游:public/js/render/vfx/skills.js:1521`）是「昆图斯 大潮 不再被通用 tide 遮挡」的开关，属同一主题 |
| F-8 野鬃 S2 突刺方向 | 特效朝向：`上游:docs/history/0.3.1.md:1161-1180`（§36.31，`wiring.js::_casts/_orient` 用 `useFourDirectionalFace`）；推的方向：`上游:docs/history/0.3.2.md:363`（§37.10，#782，**sim** 去掉 `keepDir`） | 特效：`app/public/js/render/vfx/wiring.js` 无 `fourFace`（实测只有 `effect.js:161 _useFourDir` 这个不同字段）；推：我方 `server/sim/content/kits` 仍有 `keepDir` [待复核具体行] | 代码（特效朝向，S）+ 代码（sim 方向，M，会动 golden） | S / M | 特效朝向可跟 F-6 一起做；**推的方向是 gameplay 改动、动 golden**，单独排期 |

---

## §3 分档结论（排期建议）

**Ⅰ 档（本批立刻做，S，纯代码或纯表）**
1. **A 档敌人技能 clip 表**（非 `strike` 的 8 个模型）—— `app/tools/assets/spine.mjs` 表 + `applyRoleFix` 支持 `skills`，再重建 `app/data/assets.json`。收益：大潮/崩坍、泥岩两槽、死亡集群、掷剑/掷锤、肆虐风雪全部归位。
2. **C 档干员普攻片段**（含 0.3.1 的瑕光 S2）—— 新增 `app/public/js/render/skillAttack.js` + `spine.js:704 _attackClip` 接一个 `skillAttackMode()`。
3. **E-2 冷启动重试**（#664）—— `app/public/js/ui/fieldHost.js` 超时分支加 2 s / 8 s 两次重试。

**Ⅱ 档（要排期，M）**
4. `spine.js` 技能姿势专项：**F-1 循环保持 + D-1 #786 背面回退**（同一段代码，一起做）。
5. **E-1 战斗结束表现**（#821）：新增 `battlePresentation.finish` + 结束钩子。
6. **F-3 余 S3 火墙** `vfx/yuwall.js`；**F-4 缪尔赛思流形**；**F-6 四个特效位置**；可选 **F-7 `ENEMY_FX_COVER`**（与 A 同主题）。
7. **F-8 野鬃 S2 推的方向**（sim，动 golden）。

**Ⅲ 档（先重抽素材或先搬内核，L）**
8. **B 档攻击回合释放**（§37.19/37.29/37.52/37.57）：sim `attackSlotSkill`/`castNow` + 客户端 `castStrike`/`onCast`/`windUp.js` + `cast` 5 元组；与 fix-attack-slot 合并。
9. **D-2 #729 攻速间隔驱动动画**：`rate` 事件 + 全量 golden 重算。
10. **F-2 音效按官方池**（#679/#680）：需要重做 `assets.json` 的 audio 段 + 素材。

---

## §4 与「fix-attack-slot」（别人在做）的边界

- 他做的是 **B/D-2 的 sim 侧时序**（攻击槽、攻速间隔、批内最后一帧），落点 `server/sim/`。
- 我做的是 **A / C / E / F 的表现侧**（动画片段选择、姿势、特效、重试、收尾），落点 `tools/assets/spine.mjs`、`public/js/render/`、`public/js/ui/fieldHost.js`。
- **唯一交叠**：A 档的 `strike` 4 槽（杰斯顿 ×2、碎铳之簧 ×2）—— 表可以先搬，但**要等他的 sim 发出 `['cast', id, slot, dur, clip]` 且渲染有 `onCast`** 才生效。建议：A 分两次合入（非 strike 先、strike 后跟他的 PR）。
- 另一处交叠：**F-7 `ENEMY_FX_COVER`** 属于「官方特效开关」，与 A 档同主题但独立文件，可并行。

---

## §5 未定/待复核

| 项 | 状态 |
|---|---|
| `#786` 的确切前端实现（§37.90 只有合并文，没写文件/行） | 已定位到 `上游:public/js/render/spine.js:761/812` 一段，但「Front-only 回退」的具体分支行号 **[待复核]** |
| 我方野鬃 `keepDir` 所在行 | **[待复核]**（未在本次取证范围内逐行核对 `server/sim/content/kits`） |
| 我方 `assets.json` 重建能否离线跑通（`fetch-assets --offline --add-only`） | **[待复核]**：本次未跑（纪律：不跑耗时/不写代码）；前置条件（`public/assets/local/fx/index.json`、12 个模型、`spine.animations`）已实测齐备 |
| 上游 `public/assets/local/fx/index.json` | 上游包内**没有**该文件（`.gitignore`），无法与我们逐字段对照；本报告的「我方索引无 `abilities/animKey`」是我方文件的事实，不是与上游的 diff |
