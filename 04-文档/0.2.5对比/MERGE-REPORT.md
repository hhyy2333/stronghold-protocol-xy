# 0.2.5 合并执行报告

> 执行时间：2026-10-12
> 搬运源：`参考对象\Stronghold-Protocol-v0.2.5`（完整包，6476/6476 逐 sha256 与官方 MANIFEST 一致）
> 目标：`Stronghold-Protocol-repo`（你的 0.2.4 改版树，版本号 0.3.0）

---

## 一、结果总览

| 项 | 结果 |
|---|---|
| 改动文件 | **113 个**（111 改内容 + 2 新增） |
| 整文件覆盖 | **61 个** ✅ 逐字节等于官方 0.2.5 |
| 三方合并 | **38 个** ✅ 零冲突 |
| 手工解冲突 | **10 个** ✅ 无残留标记 |
| 新增文件 | **3 个** ✅ 等于官方 |
| 官方场景资源 | **92 个 / 61.4 MB** ✅ |
| `local-assets.json` | 按 group 合并（67 + 12 = 79 组）✅ |
| **golden 基线** | **全部对齐（`ok`）** ✅ |
| 版本号一致性 | `package.json` / `package-lock.json` / `shared/constants.js` 均 **0.3.0** ✅ |
| 打包链接泄漏 | **0 处** ✅ |
| lint（我改的文件） | **0 errors** ✅ |

**合并完整性已逐项核验**：61 个覆盖文件哈希 100% 匹配官方；3 个新增文件哈希匹配；10 个冲突文件零标记；场景资源 92 个文件到位。

---

## 二、备份与回滚

| 内容 | 位置 |
|---|---|
| 合并前逐文件备份（110 个） | `.scratch\audit-025\backup-premerge\` |
| 合并前 git 状态 | `.scratch\audit-025\git-status-before.txt` |
| 合并后快照（113 个） | `.scratch\audit-025\_before-after\after\` |
| golden 更新前基线（6 个） | `.scratch\audit-025\golden-before\` |
| 作业清单（机器可读） | `.scratch\audit-025\plan.json` |

**整体回滚**：`git stash` 无效（改动太多），逐文件还原：
```powershell
$bk = "C:\Users\hhyyl\Downloads\Stronghold-Protocol-v0.2.1\.scratch\audit-025\backup-premerge"
$R  = "C:\Users\hhyyl\Downloads\Stronghold-Protocol-v0.2.1\Stronghold-Protocol-repo"
Get-ChildItem -Recurse -File $bk | ForEach-Object {
  $rel = $_.FullName.Substring($bk.Length+1)
  Copy-Item -Force $_.FullName "$R\$rel"
}
```

---

## 三、10 个冲突的裁定（逐个说明）

| 文件 | 裁定 | 理由 |
|---|---|---|
| `shared/constants.js` | 保留 `0.3.0` | 官方只改版本号；照搬会打回 0.2.5，`version.test.js` 会红 |
| `package.json` | 保留你的 23 个脚本 | 官方删的 10 个脚本是**打包器行为**（`PLAYER_NPM_SCRIPTS`），不是源码改动 |
| `package-lock.json` | 保留 `0.3.0` | 同上；依赖未变，无需 `npm install` |
| `README.md` | 逐块保留你的 | 4 块全是官方**打包链接改写**，已还原为相对路径 |
| `CHANGELOG.md` | 保留你的 | 官方 0.2.5 段落已由三方合并干净插入（文件头） |
| `docs/PLAYING.md` | **两边都要** | 保留官方 #543「项目仓库」+ 你的「服主反馈」 |
| `public/i18n/ko.json` | **逐键合并** | 采纳 49 条官方韩语修正 + 10 个新键，保留你 117 个自有键（协议源石） |
| `public/css/theme.css` | `--z-conn: 75` + `--z-announce: 78` | 采纳官方抬高连接条（修 #511 遮罩挡按钮），公告层跟着抬到 78 守住原注释语义 |
| `public/js/battle/runner.js` | 两边拼接 | 同一 JSDoc 块各加各的 |
| `public/js/ui/components.js` | **并两个特性** | `aside`（官方 18 处）+ `tapShow`（你的 9 处）；官方那两处定时器改写成 `hideTimer.current`，避免踩掉你的显示延迟 |

---

## 四、耦合组同步（关键，漏了就静默失效）

### `pairPlayers` 新签名（`(alive, rng, previous = null)`，`rng` 无默认值）

官方发行包内的调用点已随更新同步；**官方发行包外的 3 处必须自己改**（已改）：

| 文件 | 改动 |
|---|---|
| `test/match/finalAssault.test.js` | 加 `createRng` 导入；测试改为验证「种子洗牌 + 每个存活者恰好配对一次 + `previous` 优先」 |
| `test/ui/gameLogic.test.js` | 加 `createRng` 导入；用 `previous` 把配对钉住（全单人标记 ⇒ 回落座位序） |
| `tools/balance.mjs` | 传 `createRng(deriveSeed(seed,'boss-pairs'))`，与比赛同源 |

### 其它耦合组
- **浮游模型**：B 区 6 个 kit 声明 `funnelMul`/`funnelBodyHits` ↔ A 区 `professions.js`/`ai.js` 读取 —— 两侧都在 ✅
- **号角近战溅射**：`ai.js` 读 `prof fortressMeleeSplash` ↔ `horn.js` 设置 —— 两侧都在 ✅
- **受击格取整**：`detmath.js` 导出 `roundHalfEven` ↔ `body.js`/`queries.js`/`targeting.js` 消费 —— 都在 ✅
- **3D 场景**：`board3d/*` 代码 + 92 个资源 + `local-assets.json` 索引 —— 三者同批 ✅

---

## 五、⚠️ 需要你决定的一件事：自研测试期望值未同步

我做了**严格的 before/after 对照**（用备份整体还原为合并前，跑同一批测试，再恢复）：

| 测试文件 | 合并前 | 合并后 | 判定 |
|---|---|---|---|
| `kits_alt_t2` | 0 失败 | 2 失败 | 0.2.5 浮游重构 |
| `kits_alt_t6` | 0 | 1 | 同上 |
| `kits_t1t2` | 0 | 1 | 同上 |
| `kits_t3` | 0 | 5 | 同上 |
| `kits_t4` | 0 | 2 | 同上 |
| `kits_t6` | 0 | 2 | 同上 |
| `op_gdglow` | 0 | 1 | 同上 |
| `op_wang` | 0 | 1 | 0.2.5 索敌/范围取整 |
| `chess_char_3_22-yana` | 0 | 1 | 同上 |
| `feedback5-wv-summon-triggers` | 0 | 1 | 同上 |
| `bonds_core` | 0 | 1 | 0.2.5 阿戈尔开场吞噬豁免（有意） |
| `garrisons_meta` | **2 失败** | **2 失败** | ⚠️ **合并前就红，与本次合并无关** |

**共 18 个失败是 0.2.5 有意改变行为**（浮游从「倍率修饰本体攻击」改成「本体一击 + 独立附加伤害」，`PR #535–537`），自研测试的期望值停留在旧语义。

**为什么我没有直接改这 18 处**：它们是在断言**具体数值语义**（如 `0.35` vs `0.2` 的倍率归属）。按仓库 `AGENTS.md`「官方优先」原则，正确做法是**先对照 PRTS/官方资料确认新语义，再改测试**——这是规则判断，不该我替你拍板。逐条清单在 `.scratch\audit-025\test-content.log`。

**golden 基线我已更新**（`npm run golden:update`，`AGENTS.md` 硬规则要求有意玩法改动同批更新）。更新后 `npm run golden` **全部 6 个家族对齐**。

> `garrisons_meta` 那 2 个失败（`garrison_94_b seed 3` 物品数 3≠2）**合并前就存在**，是你原有的问题，不受本次影响。

---

## 六、建议的下一步

```powershell
cd C:\Users\hhyyl\Downloads\Stronghold-Protocol-v0.2.1\Stronghold-Protocol-repo

# 1. 看这次合并改了什么（排除资源）
git status --short

# 2. 跑 golden（已对齐）
npm run golden

# 3. 跑非浏览器全量测试，对照 §5 的 18 处
node --test --test-isolation=none (Get-ChildItem -Recurse -File test -Include *.test.js | Where-Object { $_.Name -notmatch 'browser|e2e' } | ForEach-Object { $_.FullName.Substring((Get-Location).Path.Length+1).Replace('\','/') })
```

**注意**：沙箱下 `node --test`（默认多进程）会 `spawn EPERM`，用 `--test-isolation=none` 单进程跑。
