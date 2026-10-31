# fix-anim — Ⅰ 档动画修复落地记录（A 敌人技能 clip 表 / C 干员普攻片段 / #664 冷启动重试）

> 施工记录，不是计划。对应 Ⅰ 档来自 [E-动画修复清单.md](../E-动画修复清单.md)。
> 路径：`app/` = `Stronghold-Protocol-Forge-协议源石版/app`；`上游:` = `Stronghold-Protocol-Forge-0.21.0-0.3.3/…`（只读）。
> 未 commit；未跑整套 `node --test`（沙箱 EPERM），全部用 `node test/<file>.test.js` 单跑。

## §0 结论

| # | 项 | 状态 | 一句话 |
|---|---|---|---|
| A | 敌人技能 clip 表（8 个模型 / 9 条记录） | **已落地** | `app/tools/assets/spine.mjs` 补 8 张表 + 12 条挂载，`applyRoleFix` 支持 `skills` map；`data/assets.json` 只变 9 个模型 |
| C | 干员普攻片段（5 干员 7 槽 + 瑕光 S2） | **已落地** | 新增 `app/public/js/render/skillAttack.js`，`spine.js _attackClip` 接入，`units.js` 注入查询 |
| E-2 | #664 冷启动超时重试 | **已落地** | `app/public/js/ui/fieldHost.js`：仅超时才重试，2 s / 8 s 各一次，提示只弹一次 |
| — | `node tools/fetch-assets.mjs --offline --add-only` 的规范重建 | **跑不起来（记录在案）** | 见 §2：它拒绝写盘（会丢 643 个条目），改用**同一份** `applyRoleFix`/`PREFAB_SPINE_ROLES` 的作用域重建，并做三重校验 |

## §1 A：敌人技能 clip 表

### 1.1 改了什么

- `app/tools/assets/spine.mjs`：新增 `slotClips` / `slotClip` / `slotMap` 三个助手 + 8 张表
  （`HELM_SKILLS` 胄、`QUINTUS_SKILLS` 昆图斯、`LION_SKILLS` 阿利斯泰尔、`MDROCK_SKILLS` 泥岩、`XI_SKILLS` 自在、
  `HAND_SKILLS` 斩胄之剑/破胄之锤、`MACE_SKILLS` 锏），`PREFAB_SPINE_ROLES` 从 2 条扩到 11 条（多出 `_2` 记录与 8 个敌人）。
- 同文件 `applyRoleFix`：原来只认 `string | clip`，现在按上游写法支持 **`null`（表示没有该角色）** 与
  **`skills` 的槽位 map**（逐槽校验 clip 存在）；clip 缺失仍只记 `missing`、不改角色。
- `app/data/assets.json`：只更新 9 个模型记录的 `spine.anims.skill` / `anims.skills`（§2 的校验）。
- **未搬** 杰斯顿·威廉姆斯（`enemy_1516_jakill`）与“碎铳之簧”（`enemy_9019_actrpb` / `9020_actrpc`）的 4 个
  `strike` 槽：它们的消费者（攻击回合内施法 → `castStrike`）不在本 build，先搬会是无出口的数据（见 §6）。

### 1.2 官方 clip → 我方模型 → 改动前 → 改动后（业主对官方客户端用的那张表）

| 敌人（我方实体键） | 槽位 | 官方 clip | 改动前（name-resolved） | 改动后 |
|---|---|---|---|---|
| 盐风主教昆图斯 `enemy_1521_dslily` | 0 大潮 | `Skill_02` 1.667 s | `Skill_01` 3.0 s（= 崩坍） | **`Skill_02`** |
| 同上 | 1 崩坍 | `Skill_01` 3.0 s | `Skill_02` | **`Skill_01`** |
| 同上 | 2 断裂生殖 | `Skill_03` 2.0 s | `Skill_03` | 不变 |
| 同上 | 3/4/6/7（各形态大潮/崩坍）、5/8（断裂生殖）、9 物种爆发 | `Skill_02`/`Skill_01`/`Skill_03`/`Skill_04` 4.467 s | 只有 0–3 四槽（其余按名无槽） | 补到 **10 槽**：`Skill_02, Skill_01, Skill_03, Skill_02, Skill_01, Skill_03, Skill_02, Skill_01, Skill_03, Skill_04` |
| **主 clip（`anims.skill`）** | — | 大潮 `Skill_02` | `Skill_01` | **`Skill_02`** |
| 假想敌：胄 `enemy_9013_acstmk` / `_2` | "1" 灭顶之灾 / "2" 死亡集群 / "3"（仅 `_2`）Revive | `Skill_1` / **`Skill_3`** 3.833 s / `Revive` 4.433 s | `Skill_1` / `Skill_2` 2.533 s / `Skill_3` | **`Skill_1` / `Skill_3` / `Revive`**（两条记录同改） |
| 阿利斯泰尔 `enemy_9032_aclionk` | 0 equip / 1 store / 2 storeA / 3 equipA / 4 Suicide | `Skill_1`/`Skill_2`/`Skill_2`/`Skill_1`/`Skill_3` | 只有 3 槽（`Skill_1/Skill_2/Skill_3`） | **5 槽** `Skill_1, Skill_2, Skill_2, Skill_1, Skill_3` |
| 泥岩 `enemy_1511_mdrock` | 0 RefreshShield / 1 occupy | `Skill_2` 1.333 s / `Skill_1` | `Skill_1` 1.5 s / `Skill_2`（**两槽互换**） | **`Skill_2` / `Skill_1`**；主 clip `Skill_2` |
| “自在” `enemy_1517_xi` | 0 纬地经天 | `Skill_01_02` | `Skill_01` | **`Skill_01_02`**；主 clip 同步 |
| 同上 | 1/2 破桎而出（两形态） | 官方 `_animKey` 空 → 骨架唯一 `Skill_02_Begin/_Loop/_End` **[ASSUMED]** | 槽 2 无 clip | **两槽都是 `Skill_02_Loop`（带 Begin/End）** |
| “斩胄之剑” `enemy_9014_acstma` / “破胄之锤” `enemy_9015_acstmb` | "1" 掷剑/掷锤 / "2" | `Launch_Begin` 1.367 s / `Back_End` | 无 `skills` map，主 clip `Skill` 1.733 s | **`Launch_Begin` / `Back_End`**，主 clip `Launch_Begin` |
| 锏 `enemy_1525_blkswb` | 0 CircleAttack / 2 CircleAttack2 | `A_Skill2` / `B_Skill2` 2.067 s | 无 `skills` map（攻击角色） | **`A_Skill2` / `B_Skill2`**；1/3 Blink 仍 `A_Attack`/`B_Attack`(`via: attack`) |

（`_2` 记录：上游 `PREFAB_SPINE_ROLES` 没有单独一行，但上游 `data/assets.json` 的 `enemy_9013_acstmk_2` 是修好的；
本仓库按 id 查表，所以显式加了一行 `enemy_9013_acstmk_2: { skills: HELM_SKILLS }`，与上游数据一致。）

## §2 数据重建：规范路径跑不起来，改走等价的作用域重建

### 2.1 规范路径的结果（先试过，记录在案）

```
node tools/fetch-assets.mjs --offline --add-only
→ exit 0，11 s，最后一行：data/assets.json (kept)
```

它**跑得通但拒绝写盘**：本机 `public/assets/`（git-ignored，18441→8441 个文件的那一份）缺文件，
`.cache/assets-report.json` 记 `droppedEntries: 643` —— 写出去会一次性丢 643 个清单条目（远超「只动 12 个模型的
动画指派」的允许范围），工具的 shrink guard 因此保留旧文件。`--allow-shrink` 会真的写小文件，更不能要。

### 2.2 采用的做法（受控、可复现、与工具同源）

用**同一份** `applyRoleFix` + `PREFAB_SPINE_ROLES`（`app/tools/assets/spine.mjs`）对 `data/assets.json` 做作用域重建：
只把命中的模型记录的 `anims.skill`/`anims.skills` 换成表里的值，每个 clip 仍按该模型的 `spine.animations` 校验存在才写。

```js
// 一次性脚本（已删），核心就三行：
const { PREFAB_SPINE_ROLES, applyRoleFix } = await import('…/app/tools/assets/spine.mjs');
const fixed = applyRoleFix(entry.spine.anims, PREFAB_SPINE_ROLES[id], entry.spine.animations);
entry.spine.anims = fixed.roles;           // 其余字段一个不动
```

### 2.3 三重校验（都通过）

1. **字节可逆**：`JSON.stringify(JSON.parse(原始 assets.json)) === 原始文件` → 序列化无格式漂移，
   所以「只改 anims」=「diff 只有 anims」；文件大小 1,385,630 → 1,386,934（+1,304 B，正是新增的 `skills` 段）。
2. **只变 9 个模型**：`data/*.json` + `data/i18n/*.json` 共 26 个文件前后 sha1 逐条对照，**只有 `data/assets.json` 变**；
   `assets.json` 内只有 `enemies.` 下 9 个 id 的 `anims` 变（其余条目数不变：enemies 321、chars 213、tokens 58）。
3. **与上游对齐 + 不动点**：9/9 个模型的 `spine.anims` 现在与 `上游:data/assets.json` **逐字节相同**；
   同一脚本再跑一次零变化（不动点）。仍与上游不同的敌人只剩 3 个 —— 正是本次**故意没搬**的
   `enemy_1516_jakill` / `enemy_9019_actrpb` / `enemy_9020_actrpc`。

> 注：`git status` 会把 `data/` 下一批文件显示为 `M`，那是**我动手之前**工作区就领先 HEAD 的既有状态（0.3.0 底 + 自建内容），
> 不是本次改动；本次的证据是上面第 2 条的 before/after sha1。
> 规范重建的正路仍然是：**在一份完整的 `public/assets/` 上跑 `node tools/fetch-assets.mjs --offline --add-only`**（或联网 `--add-only`）。

## §3 C：干员普攻片段

| 文件 | 改动 |
|---|---|
| `app/public/js/render/skillAttack.js`（新，约 90 行） | 上游 `skillAttackMode` 的移植：`NORMAL_ATTACK_SKILLS` 白名单 + 瑕光 S2 的单独分支。注释保留「为什么不能泛化 raw animKey」的反例（胡摩 S2、百炼嘉维尔 S3） |
| `app/public/js/render/spine.js` `_attackClip()`（原 704 行） | 技能开启时先问 `this.skillAttackMode?.()`：`{animKey:'Attack'}` → 走模型自己的**普攻角色**（含 Begin/End、朝向、皮肤），别的名字 → 该技能的攻击 clip；没有映射时行为与改前**完全一致** |
| `app/public/js/render/units.js`（第 5 个文件，见 §6） | 建 `SpineActor` 后注入 `actor.skillAttackMode = () => …`：只对 `info.kind === 'op'` 生效，`rec` 走 `ctx.lookupDef`（插件/DYI 替换技能不继承官方映射），`down` 由当前朝向给 |

覆盖（与上游 0.3.2 一致）：德克萨斯 S1/S2、伺夜 S1/S2、归溟幽灵鲨 S1、焰影苇草 S2、耀骑士临光 S2 + 0.3.1 的瑕光 S2。
行为边界：**只改「技能期间普攻播哪个 clip」**，不改施法/循环/待机/其他技能槽。

## §4 E-2：#664 冷启动重试

| 位置 | 改动 |
|---|---|
| `app/public/js/ui/fieldHost.js` `withTimeout` | 超时错误打标 `err.timedOut = true`（其余不变） |
| `mountFieldView` | 新增 `{ quiet }` 选项：自动重试的后续尝试不再重复打印「渲染器暂时未能加载」；返回的 fallback 视图带 `fellBackAfterTimeout` |
| `useFieldView` | 只在 `fellBackAfterTimeout` 时排**定时重试**：2 s 一次、8 s 一次（各一次，共 ≤2 次）；页面隐藏/离线不重试；进引擎后计数清零；定时器在 effect 清理里 `clearTimeout`。用户事件（`online` / 切回标签）原有的 2 次上限**独立**保留 |

没有 WebGL / 引擎真的缺失时**不重试**（上游口径：那不是一个会自己好的错误），仍停在简化棋盘。

## §5 守卫与测试（单跑 `node test/<file>.test.js`）

| 测试 | 结果 | 说明 |
|---|---|---|
| `test/assets.test.js` | 55 pass / 9 fail | 我改的那条 `every enemy with numbered skill clips has a clip per slot` **原本钉住了 bug**（断言昆图斯 `Skill_01..04` 与主 clip `Skill_01`），已按官方 clip 更新并补了 6 个模型的断言，现在**通过**。剩下 9 条与本次无关：7 条是 HTTP `.part`/Range 下载用例（沙箱写临时文件失败，报 `range: 'bytes=-1'`），1 条 `DESIGN §16 loadouts` 是我方自建干员（`chess_char_6_21/6_22`）缺技能图标，1 条 pixi-spine 读取某个模型报 `boneData cannot be null`（素材不齐） |
| `test/ui/fieldHost-lifecycle.test.js` | 7 pass / 2 fail | **已用「把 fieldHost.js 还原成 git HEAD 再跑」验证：同样 2 条失败**（它们测的是本分支尚未实现的「按 liveness 而不是 12 s 墙钟」的截止时间），与本次改动无关；验证后已把文件还原 |
| `test/browser-syntax.test.js` | 6 / 6 | 全部通过（含新文件与改动文件） |
| `test/client-imports.test.js` | 4 / 4 | 新文件 `skillAttack.js` 的静态导入图合法 |
| `test/sim/detmath.test.js` | 全通过 | 确定性守护 |
| `test/data.test.js` | 25 pass / 5 fail | 全部是既有问题：`items: 122` 与工作区 126 条不符、`config` modes/rounds 断言、`offline rebuild reproduces data/`（**`spawnSync` 在沙箱里 EPERM**）、build CLI unknown options（同 spawn） |
| `test/client-static.test.js` | 跑不了 | 它的解析检查用 `spawnSync(node --input-type=module --check)`，本沙箱 `spawnSync` → **EPERM**（对**每一个**客户端文件都失败，包括我没碰过的 `boot.js`） |
| `test/fetch-assets-shrink.test.js` | 部分失败 | `--help` / `--prune` 两条都用 spawn（EPERM）；`--strict` 一条通过 |
| `test/docs-paths.test.js` | 2 pass / 5 fail | 既有文档漂移（DESIGN 分节结构、ARCHITECTURE/CONTRIBUTING 里的路径），本次未动文档 |

沙箱限制记一次：`spawnSync` EPERM + `node --test` EPERM ⇒ 任何「子进程 / 起服务器 / 写临时文件」的用例都无法在本机跑绿，
需要在一台正常机器上补跑 `npm run ci` 确认这些是环境失败。

## §6 偏离与待办

1. **改了第 5 个文件 `public/js/render/units.js`**（原计划 4 个）：`skillAttackMode` 必须在**建 `SpineActor` 的那一处**注入才有
   `info`（`diy`/`form`/`kind`）与 `ctx.lookupDef`（插件替换技能的守卫）；上游也是这三个文件
   （`skillAttack.js` + `spine.js` + `units.js`），写进 `spine.js` 反而会丢插件守卫。
2. **改了 1 个测试** `app/test/assets.test.js`：原断言把 bug 钉死（见 §5）。这是本次唯一被动的测试改动，请复核。
3. **没搬的 4 个 `strike` 槽**：杰斯顿 0/1、碎铳之簧 9019/9020 的槽 0 —— 等「攻击回合内施法」（fix-attack-slot）落地后再补表，
   表内容与上游一致（`上游:tools/assets/spine.mjs:171-176`），加两行即可。
4. **规范重建没跑成**（§2.1）：需要一份完整的 `public/assets/`（本机 8441 文件，清单要 16956）。拿到后跑
   `node tools/fetch-assets.mjs --offline --add-only`，预期结果与现在的 `data/assets.json` **逐字节相同**（可用
   `git diff --stat data/assets.json` 对比）。
5. **顺带暴露的缺口**（不在本次范围）：`test/assets.test.js` 的 `DESIGN §16 loadouts` 显示我方自建干员
   `chess_char_6_21_a/b`（结城理）、`chess_char_6_22_a/b`（丰川祥子）**没有技能图标**；这是素材/数据缺口，与动画无关。
