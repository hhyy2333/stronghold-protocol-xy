# fix-anim-strike — 杰斯顿 / 碎铳之簧 的 4 个 `strike` 动画槽

> 施工记录。[E-动画修复清单.md](../E-动画修复清单.md) Ⅰ 档里当时**故意没搬**的尾巴；上一轮 fix-anim 已把其余 8 个模型搬完。
> 现在 `cast` 的第 5 字段 `turnClip` 消费者已就位（`app/server/sim/content/enemies/helpers.js:114-117`、
> `app/public/js/render/app.js:1715-1719`、`app/public/js/render/units.js:1509 holdCast`），所以这 4 槽可以接表。

## §1 改了什么

| 文件 | 改动 |
|---|---|
| `app/tools/assets/spine.mjs` | 新增 `WARDEN_SKILLS`（杰斯顿 2 槽，带 `strike: true`）与 3 条挂载：`enemy_1516_jakill`、`enemy_9019_actrpb`、`enemy_9020_actrpc` |
| `app/data/assets.json` | 作用域重建：只给这 3 个模型补 `spine.anims.skills`（其余一律不动，见 §3） |

## §2 对照表（模型 → 槽位 → 官方 clip → 改前 → 改后）

| 模型（我方实体键） | 槽位（prefabKey） | 官方 clip | 改前 | 改后 |
|---|---|---|---|---|
| 杰斯顿·威廉姆斯 `enemy_1516_jakill` | 0 ironsandstorm | `C1_Skill` 2.067 s | 无 `skills` ⇒ 普攻 clip `C1_Attack` | `{ loop: 'C1_Skill', strike: true }` |
| 同上 | 1 armorpiercing | `C2_Skill` 1.133 s | 无 `skills` ⇒ 普攻 clip `C1_Attack` | `{ loop: 'C2_Skill', strike: true }` |
| “碎铳之簧” `enemy_9019_actrpb`（元素护盾形态） | 0 "1" | `Skill_b` 3.0 s | 无 `skills` ⇒ 普攻 clip `Attack` | `{ loop: 'Skill_b', strike: true }` |
| “碎铳之簧” `enemy_9020_actrpc`（频次护盾形态） | 0 "1" | `Skill_c` 6.967 s | 无 `skills` ⇒ 普攻 clip `Attack` | `{ loop: 'Skill_c', strike: true }` |

三个模型的**主 clip（`anims.skill`）一个都没动**（杰斯顿 `C1_Attack` via attack；两形态 `Attack` via attack），
与上游一致：这次只补「技能槽 → clip」的映射。

关于 `strike: true`：本仓库客户端目前**没有读这个标记**的代码（上游用它选 `castStrike`）；我们的播放路径是
`cast` 事件第 5 字段 `turnClip` → `setSkillSlot(slot)`（`spine.js _attackClip` 已切到该槽 clip）→ `holdCast` 按官方
时长放一次。标记保留是为了**与上游数据逐字节一致**（校验 ② 要求），也让以后接 `strike` 语义时不用再改数据。

## §3 重建（与上一轮同样的三重校验）

1. **规范路径先试**：`node tools/fetch-assets.mjs --offline --add-only` → exit 0、4 s，仍然 `data/assets.json (kept)`：
   本机 `public/assets/` 不完整，报告记 `droppedEntries: 643`，shrink guard 拒绝写小清单（`--allow-shrink` 会真丢 643 条，不能要）。
2. **作用域重建**：同一份 `applyRoleFix` + `PREFAB_SPINE_ROLES`（`app/tools/assets/spine.mjs`）替换命中记录的
   `anims.skills`，逐槽按该模型的 `spine.animations` 校验 clip 存在。

| 校验 | 结果 |
|---|---|
| ① 原文件 `JSON.parse` + `JSON.stringify` 字节可逆 | **true**（1,386,934 B 原样复现 ⇒ 写出的 diff 只有 anims） |
| ② 本次被改模型 | **3 个**：`enemy_1516_jakill`、`enemy_9019_actrpb`、`enemy_9020_actrpc`（各只多一个 `skills`），其余 26 个 data 文件 sha1 全未变 |
| ② 与上游 `data/assets.json` 对应条目 | 表内 **14/14** 个敌人记录的 `spine.anims` 逐字节相同（含本轮 3 个） |
| ③ 再跑一次 | **不动点**（changed models: 0） |
| clip 存在性 | `C1_Skill` / `C2_Skill` / `Skill_b` / `Skill_c` 都在各自模型的 `animations` 里，`problems: none` |
| 体积 | 1,386,934 → 1,387,301 B（+367 B，正是 3 个 `skills` 段） |

## §4 测试（`node test/<file>.test.js`，沙箱内单跑）

| 测试 | 数字 | 说明 |
|---|---|---|
| `node test/assets.test.js` | **64 项，55 pass / 9 fail** | 9 条是既有/沙箱问题，与上一轮完全相同、与本次无关：7 条 HTTP `.part`/Range 下载用例（沙箱写临时文件失败）、`DESIGN §16 loadouts`（我方自建干员 结城理/丰川祥子 缺技能图标）、pixi-spine `boneData cannot be null`。上一轮我更新过的 `every enemy with numbered skill clips has a clip per slot` **仍然通过** |
| `node test/sim/cast-turnclip.test.js` | **3 项，3 pass / 0 fail** | `turnClip` 消费者的守卫，本轮数据接上后全绿 |
| `node test/content/enemies_bosses.test.js` | **287 项，287 pass / 0 fail** | lead 给的 `test/sim/enemies_bosses.test.js` 在本仓库不存在，实际路径在 `test/content/`（已按实际路径跑） |
| `node test/sim/enemies-special.test.js`（附带） | 5 项，5 pass / 0 fail | 特训敌人/召唤物，顺手跑 |

## §5 备注

- 未 commit；临时脚本（作用域重建那 20 行）用完已删，做法与命令同上一轮 [fix-anim.md](fix-anim.md) §2。
- 规范重建的正路不变：拿一份完整的 `public/assets/` 跑 `node tools/fetch-assets.mjs --offline --add-only`，
  预期与现在的 `data/assets.json` 逐字节相同。
- 现在 `PREFAB_SPINE_ROLES` 共 16 条（囚犯 ×2、8 个技能槽敌人 + 胄 `_2`、杰斯顿、碎铳之簧 ×2、宴），
  与上游 0.3.3 的 14 条相比多出 `enemy_9013_acstmk_2`（上游靠模型共享拿到，我们按 id 查表）与本仓库自有的
  `enemy_1116_liprr*` / `char_337_utage`。
