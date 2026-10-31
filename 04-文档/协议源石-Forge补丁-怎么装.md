# 协议源石 → Forge：怎么装

三个文件（都在工作区根目录）：

| 文件 | 说明 |
|---|---|
| `协议源石-Forge补丁.patch` | 141 文件 / 6.3 MB（含 `data/*.json` 四条生成数据与 `tools/custom-assets.mjs`、`tools/set-item-pool.mjs`） |
| `协议源石-Forge新增素材.zip` | 卡面 + 音效（可选） |
| `install-hextech.mjs` | **推荐用这个**（见下） |

---

## ⚠️ 先说一个坑：直接 `git apply` 会骗你

我实测发现：**在不是 git 仓库的目录里，`git apply` 会跳过所有文件，但 exit code 仍然是 0。**

```
# 在一个普通的 Forge 解压目录（没有 .git）里：
$ git apply 协议源石-Forge补丁.patch
$ echo $?
0                          <-- 看起来成功了

# 但实际什么都没改：
$ grep HEX_DRAFT shared/constants.js
(没有输出)                  <-- 补丁根本没应用

# 加 --verbose 才看得见真相：
$ git apply --check --verbose 协议源石-Forge补丁.patch
Skipped patch 'data/hextech.json'.
Skipped patch 'public/js/screens/game.js'.
...                        <-- 全被跳过了，exit 还是 0
```

**原因**：`git apply` 需要仓库来判断路径。没有仓库时它不作声地跳过。

**修法**：先 `git init`，或者用我写的安装器（它会自己 init **并且**核对结果）。

---

## 推荐用法：安装器

### 1. 安装

```bash
cd <协议源石-Forge补丁.patch 所在目录>

node install-hextech.mjs \
  "<Forge 的 app 目录>" \
  "协议源石-Forge补丁.patch" \
  --art "协议源石-Forge新增素材.zip"      # 可选，但不给就没有卡面/音效
```

**Forge 的 app 目录**指的是有 `server/` `shared/` `public/` `data/` `tools/` 的那一层，
即 `Stronghold-Protocol-Forge-0.18.6-0.2.6-win-x64/app/`。

安装器会：

1. 没有 `.git` 就建一个临时的（`git apply` 需要它）——
   **会在 Forge 目录里留下一个 `.git/` 文件夹**（约几 MB）。介意的话装完后 `rm -rf .git` 即可，
   但那之后就不能再用 `--revert` 了（改用备份，或重新解压一份 Forge）；
2. `--check` 先试，失败就**带原因退出**（不是静默跳过）；
3. 应用；
4. **核对磁盘**：确认 `HEX_DRAFT` 进了 `shared/constants.js`、`hextech.js` 建出来了；
5. 解压素材。

### 2. 验证

```bash
cd "<Forge 的 app 目录>"

node tools/build-hextech.mjs
#   -> [hextech] data\hextech.json: 79 player + 24 enemy hexes, 3 draws

node tools/matchrun.mjs --mode solo --difficulty FUNNY --seeds 1 --quiet
#   -> rounds passed: avg 8.00 · engine errors: 0
```

**看到 8 回合 · 0 errors 就是装对了。**（原生 Forge 是 9 回合——第 1/6 回合的协议源石抽取改变了结果。）

### 3. 卸载

```bash
node install-hextech.mjs --revert "<Forge 的 app 目录>" "协议源石-Forge补丁.patch"
```

---

## 不想用安装器：手写 git

```bash
cd "<Forge 的 app 目录>"

git init                                    # 关键：没有它下面的 apply 会静默跳过
git config user.email install@local
git config user.name "hextech install"
git config core.autocrlf false              # 关键：别让 git 改行尾

git apply --check 协议源石-Forge补丁.patch   # 先试
git apply         协议源石-Forge补丁.patch   # 再应用

# 务必自己核对（别信 exit code）：
grep HEX_DRAFT shared/constants.js          # 应该有输出
ls server/sim/content/hextech.js            # 应该存在

# 素材
tar -x -f 协议源石-Forge新增素材.zip -C public/assets/local
```

---

## 素材是可选的

| 素材 | 没有它会怎样 |
|---|---|
| `tier/1.png` 等 3 张卡面 | 卡面回落成**阶位色块** |
| `audio/*.wav` 2 个音效 | 回落成引擎自带的 pick / refresh 音 |
| `item/item_ghost.png` | 物品图标缺失 |

**缺了照样能玩**，只是观感差一些。（`localAsset()` 找不到就返回 null，各调用点都有回落。）

---

## 常见问题

| 症状 | 原因 | 怎么办 |
|---|---|---|
| 说成功但文件没变 | 在非 git 目录里直接 `git apply` | 用安装器，或先 `git init` |
| `patch does not apply` | 目录不对，或已经装过了 | 确认是 app 目录；装过就用 `--revert` |
| 装了但游戏行为没变 | 忘了 `data/hextech.json` | 跑 `node tools/build-hextech.mjs` |
| 对局报错 `unknown top-level key "hex"` | `viewsDelta.js` 没打上 | 重装（这就是那个最关键的缺口） |
| 不想留 `.git` | 安装器为了 `git apply` 建的 | 装完 `rm -rf .git`；之后要卸载就重新解压一份 Forge |

### 如果 Forge 本来就是 git 检出

那就**不用**安装器，直接在你的仓库里：`git apply --check` → `git apply` → `git diff` 看一遍改动。

---

## 升级 Forge 之后怎么办

这个补丁**改的是引擎文件**，Forge 一升级就要重新对一遍。
重点是**七个缺口**（见 [补丁说明](协议源石-Forge补丁说明.md) §7），其中：

- `server/viewsDelta.js` 的 `SCALAR_KEYS` 是**唯一一个不补就报错**的；
- 其余六个不补是「功能没有」（会静默不生效）。

先跑 `git apply --check`，冲突会直接告诉你哪几个文件变了。